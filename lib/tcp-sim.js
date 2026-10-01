'use strict';

const net = require('net');
const {
  parseDelimiter,
  formatPayload,
  findRule,
  buildResponse,
  bufferToHex,
} = require('./rules');
const { noteLocalAddress } = require('./net-info');

function escapeVisible(str) {
  let out = '';
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0d) out += '\\r';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x00) out += '\\0';
    else if (c === 0x5c) out += '\\\\';
    else if (c < 0x20 || c > 0x7e) out += '\\x' + c.toString(16).toUpperCase().padStart(2, '0');
    else out += s[i];
  }
  return out;
}

class TcpSimulator {
  constructor(device, onLog, getRules) {
    this.device = device;
    this.onLog = onLog;
    this.getRules = getRules;
    this.server = null;
    this.clients = new Set();
    this.encoding = device.encoding === 'hex' ? 'hex' : 'text';
    this.rxDelimiter = parseDelimiter(device.rxDelimiter != null ? device.rxDelimiter : device.delimiter);
    this.txDelimiter = parseDelimiter(device.txDelimiter != null ? device.txDelimiter : device.delimiter);
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this._onConnection(socket));
      server.on('error', reject);
      server.listen(this.device.port, this.device.bindHost || '0.0.0.0', () => {
        this.server = server;
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const socket of this.clients) {
        try {
          socket.destroy();
        } catch (_) {}
      }
      this.clients.clear();

      if (!this.server) {
        resolve();
        return;
      }

      const server = this.server;
      this.server = null;
      server.close(() => resolve());
    });
  }

  clientCount() {
    return this.clients.size;
  }

  /** Send payload to all connected clients (same as rule response). */
  sendPayload(payload, meta) {
    meta = meta || {};
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const alive = [...this.clients].filter((s) => !s.destroyed);
    if (!alive.length) {
      throw Object.assign(new Error('нет подключённых клиентов'), { status: 409 });
    }

    for (const socket of alive) {
      socket.write(buf);
    }

    this.onLog({
      type: 'traffic',
      kind: 'command',
      deviceId: this.device.id,
      commandNote: meta.note || '',
      clients: alive.length,
      payload:
        this.encoding === 'hex'
          ? formatPayload('hex', buf)
          : escapeVisible(buf.toString('binary')),
    });

    return { clients: alive.length, bytes: buf.length };
  }

  _logRaw(chunk) {
    const asHex = bufferToHex(chunk);
    const asText = escapeVisible(chunk.toString('binary'));
    this.onLog({
      type: 'traffic',
      kind: 'raw',
      deviceId: this.device.id,
      payload: this.encoding === 'hex' ? asHex : asText,
    });
  }

  _onConnection(socket) {
    this.clients.add(socket);
    // Локальный конец сокета — это тот адрес компьютера, по которому до нас
    // достучался клиент. Единственный способ узнать рабочий адрес наверняка.
    noteLocalAddress(socket.localAddress, 'client');
    this.onLog({
      type: 'status',
      deviceId: this.device.id,
      message: `client connected ${socket.remoteAddress}:${socket.remotePort}`,
    });

    let buffer = this.encoding === 'hex' ? Buffer.alloc(0) : '';

    socket.on('data', (chunk) => {
      this._logRaw(chunk);

      if (this.encoding === 'hex') {
        // Без RX-delimiter каждый TCP-чанк = кадр (как шлёт iRidi на ТВ)
        if (!this.rxDelimiter) {
          this._processMessage(socket, chunk);
          return;
        }

        buffer = Buffer.concat([buffer, chunk]);
        buffer = this._splitHexByDelimiter(socket, buffer);
        if (buffer.length) {
          this.onLog({
            type: 'traffic',
            kind: 'pending',
            deviceId: this.device.id,
            request: formatPayload('hex', buffer),
            note: `ожидание разделителя приёма (${buffer.length}B)`,
          });
        }
      } else {
        buffer += chunk.toString('binary');
        buffer = this._handleTextBuffer(socket, buffer);
        if (buffer.length) {
          const hit = findRule(this.getRules(), 'text', buffer);
          if (hit) {
            const msg = buffer;
            buffer = '';
            this._reply(socket, msg, hit);
          } else {
            this.onLog({
              type: 'traffic',
              kind: 'pending',
              deviceId: this.device.id,
              request: escapeVisible(buffer),
              note: this.rxDelimiter
                ? `ожидание разделителя приёма ${escapeVisible(this.rxDelimiter)}`
                : 'нет подходящего правила',
            });
          }
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      this.onLog({
        type: 'status',
        deviceId: this.device.id,
        message: `client disconnected ${socket.remoteAddress}:${socket.remotePort}`,
      });
    });

    socket.on('error', (err) => {
      this.onLog({
        type: 'status',
        deviceId: this.device.id,
        message: `socket error: ${err.message}`,
      });
    });
  }

  _splitHexByDelimiter(socket, buffer) {
    const delim = Buffer.from(this.rxDelimiter, 'binary');
    let idx = buffer.indexOf(delim);
    while (idx >= 0) {
      const message = buffer.subarray(0, idx);
      buffer = buffer.subarray(idx + delim.length);
      this._processMessage(socket, message);
      idx = buffer.indexOf(delim);
    }
    return buffer;
  }

  _handleTextBuffer(socket, buffer) {
    const delim = this.rxDelimiter;
    if (!delim) {
      if (buffer.length) {
        this._processMessage(socket, buffer);
      }
      return '';
    }

    let eol = buffer.indexOf(delim);
    while (eol >= 0) {
      const chunk = buffer.slice(0, eol);
      buffer = buffer.slice(eol + delim.length);
      this._processMessage(socket, chunk);
      eol = buffer.indexOf(delim);
    }
    return buffer;
  }

  _processMessage(socket, message) {
    const rules = this.getRules();
    const hit = findRule(rules, this.encoding, message);
    this._reply(socket, message, hit);
  }

  _reply(socket, message, hit) {
    const request =
      this.encoding === 'hex'
        ? formatPayload('hex', message)
        : escapeVisible(typeof message === 'string' ? message : message.toString('binary'));

    if (!hit) {
      this.onLog({
        type: 'traffic',
        kind: 'exchange',
        deviceId: this.device.id,
        request,
        response: null,
        matched: false,
      });
      return;
    }

    let built;
    try {
      built = buildResponse(hit.rule, this.encoding, this.txDelimiter);
    } catch (err) {
      this.onLog({
        type: 'status',
        deviceId: this.device.id,
        message: `ошибка ответа в правиле #${hit.index + 1}: ${err.message}`,
      });
      return;
    }

    const send = () => {
      if (socket.destroyed) return;
      socket.write(built.payload);
      const response =
        this.encoding === 'hex'
          ? formatPayload('hex', built.payload)
          : escapeVisible(built.payload.toString('binary'));
      this.onLog({
        type: 'traffic',
        kind: 'exchange',
        deviceId: this.device.id,
        request,
        response,
        matched: true,
        ruleIndex: hit.index,
        ruleNote: hit.rule.note || '',
      });
    };

    if (built.delayMs > 0) setTimeout(send, built.delayMs);
    else send();
  }
}

module.exports = { TcpSimulator };
