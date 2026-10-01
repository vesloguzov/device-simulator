'use strict';

const dgram = require('dgram');
const {
  formatPayload,
  findRule,
  buildResponse,
  parseDelimiter,
  bufferToHex,
} = require('./rules');

class UdpSimulator {
  constructor(device, onLog, getRules) {
    this.device = device;
    this.onLog = onLog;
    this.getRules = getRules;
    this.socket = null;
    this.encoding = device.encoding === 'hex' ? 'hex' : 'text';
    this.rxDelimiter = device.rxDelimiter != null ? device.rxDelimiter : device.delimiter || '';
    this.txDelimiter = device.txDelimiter != null ? device.txDelimiter : device.delimiter || '';
    this.lastPeer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.on('error', (err) => {
        if (!this.socket) reject(err);
        else {
          this.onLog({
            type: 'status',
            deviceId: this.device.id,
            message: `udp error: ${err.message}`,
          });
        }
      });

      socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));

      socket.bind(this.device.port, this.device.bindHost || '0.0.0.0', () => {
        this.socket = socket;
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      const socket = this.socket;
      this.socket = null;
      socket.close(() => resolve());
    });
  }

  clientCount() {
    return this.lastPeer ? 1 : 0;
  }

  /** Send payload to the last known UDP peer (same as rule response). */
  sendPayload(payload, meta) {
    meta = meta || {};
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (!this.socket) {
      throw Object.assign(new Error('udp не запущен'), { status: 409 });
    }
    if (!this.lastPeer) {
      throw Object.assign(new Error('нет известного UDP-клиента — сначала дождись пакета'), {
        status: 409,
      });
    }

    const peer = this.lastPeer;
    const commandNote = meta.note || '';
    this.socket.send(buf, peer.port, peer.address, (err) => {
      if (err) {
        this.onLog({
          type: 'status',
          deviceId: this.device.id,
          message: `udp send failed: ${err.message}`,
        });
        return;
      }
      this.onLog({
        type: 'traffic',
        kind: 'command',
        deviceId: this.device.id,
        commandNote,
        clients: 1,
        payload: formatPayload(this.encoding, buf),
      });
    });

    return { clients: 1, bytes: buf.length };
  }

  _onMessage(msg, rinfo) {
    this.lastPeer = { address: rinfo.address, port: rinfo.port };
    const asHex = bufferToHex(msg);
    const asText = msg
      .toString('utf8')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');

    this.onLog({
      type: 'traffic',
      kind: 'raw',
      deviceId: this.device.id,
      payload: this.encoding === 'hex' ? asHex : asText,
    });

    const incoming = this.encoding === 'hex' ? msg : msg.toString('utf8');
    const rules = this.getRules();
    const hit = findRule(rules, this.encoding, incoming);
    const request = formatPayload(this.encoding, incoming);

    if (!hit) {
      this.onLog({
        type: 'traffic',
        kind: 'exchange',
        deviceId: this.device.id,
        request,
        response: null,
        matched: false,
        note: `from ${rinfo.address}:${rinfo.port}`,
      });
      return;
    }

    let built;
    try {
      built = buildResponse(
        hit.rule,
        this.encoding,
        parseDelimiter(this.txDelimiter)
      );
    } catch (err) {
      this.onLog({
        type: 'status',
        deviceId: this.device.id,
        message: `ошибка ответа в правиле #${hit.index + 1}: ${err.message}`,
      });
      return;
    }

    const send = () => {
      if (!this.socket) return;
      this.socket.send(built.payload, rinfo.port, rinfo.address, (err) => {
        if (err) {
          this.onLog({
            type: 'status',
            deviceId: this.device.id,
            message: `udp send failed: ${err.message}`,
          });
          return;
        }
        this.onLog({
          type: 'traffic',
          kind: 'exchange',
          deviceId: this.device.id,
          request,
          response: formatPayload(this.encoding, built.payload),
          matched: true,
          ruleIndex: hit.index,
          ruleNote: hit.rule.note || '',
          note: `${rinfo.address}:${rinfo.port}`,
        });
      });
    };

    if (built.delayMs > 0) setTimeout(send, built.delayMs);
    else send();
  }
}

module.exports = { UdpSimulator };
