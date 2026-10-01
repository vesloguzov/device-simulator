'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TcpSimulator } = require('./tcp-sim');
const { UdpSimulator } = require('./udp-sim');
const { parseDelimiter, buildResponse } = require('./rules');

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function pickDelim(body, base, key, legacyDefault) {
  if (body[key] != null) return String(body[key]);
  if (base[key] != null) return String(base[key]);
  // migrate old single "delimiter"
  if (body.delimiter != null) return String(body.delimiter);
  if (base.delimiter != null) return String(base.delimiter);
  return legacyDefault;
}

function sanitizeCommands(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    note: c && c.note != null ? String(c.note) : '',
    body: c && c.body != null ? String(c.body) : '',
  }));
}

/** Сериализация с устойчивым порядком ключей — чтобы сравнивать содержимое. */
function stableJson(value) {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    return Object.keys(val).sort().reduce((acc, key) => {
      acc[key] = val[key];
      return acc;
    }, {});
  });
}

/**
 * Одинаковы ли устройства по содержимому.
 *
 * Нужно потому, что интерфейс перед запуском на всякий случай досылает
 * настройки целиком — даже когда их не трогали. Без этой проверки такой
 * пустой PUT переписывал файл и отмечал проект изменённым, и выходило,
 * что дата обновления растёт от одних только запусков.
 */
function sameDevice(a, b) {
  return stableJson(a) === stableJson(b);
}

function sanitizeDeviceInput(body, existing) {
  const base = existing || {};
  const protocol = body.protocol === 'udp' ? 'udp' : 'tcp';
  const encoding = body.encoding === 'hex' ? 'hex' : 'text';
  const port = Number(body.port != null ? body.port : base.port);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('port must be an integer 1..65535');
  }

  const rules = Array.isArray(body.rules)
    ? body.rules.map((r) => ({
        note: r.note == null ? '' : String(r.note),
        match: r.match == null ? '' : String(r.match),
        matchMode: ['exact', 'contains', 'startsWith'].includes(r.matchMode)
          ? r.matchMode
          : 'exact',
        response: r.response == null ? '' : String(r.response),
        delayMs: Math.max(0, Number(r.delayMs) || 0),
        enabled: r.enabled !== false,
      }))
    : base.rules || [];

  const commands = Array.isArray(body.commands)
    ? sanitizeCommands(body.commands)
    : Array.isArray(base.commands)
      ? base.commands
      : [];

  const defaultRx = encoding === 'text' ? '\\r\\n' : '';
  const defaultTx = encoding === 'text' ? '\\r\\n' : '\\r';

  return {
    id: base.id || newId(),
    name: String(body.name != null ? body.name : base.name || 'Device').trim() || 'Device',
    bindHost: String(body.bindHost != null ? body.bindHost : base.bindHost || '0.0.0.0').trim() || '0.0.0.0',
    port,
    protocol,
    encoding,
    rxDelimiter: pickDelim(body, base, 'rxDelimiter', defaultRx),
    txDelimiter: pickDelim(body, base, 'txDelimiter', defaultTx),
    rules,
    commands,
  };
}

class SimulatorManager {
  /**
   * @param {string} dataPath файл devices.json проекта
   * @param {(msg: object) => void} broadcast рассылка по WebSocket
   * @param {() => void} [onChanged] вызывается, когда содержимое записано на диск;
   *   по нему проект отмечает дату изменения. Запуск и остановка сюда не
   *   попадают намеренно — это состояние, а не правка.
   */
  constructor(dataPath, broadcast, onChanged) {
    this.dataPath = dataPath;
    this.broadcast = broadcast;
    this.onChanged = typeof onChanged === 'function' ? onChanged : null;
    this.devices = new Map();
    this.runtimes = new Map();
    this.loading = true;
    this._load();
    this.loading = false;
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          const device = sanitizeDeviceInput(item, { id: item.id || newId() });
          this.devices.set(device.id, device);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to load devices.json:', err.message);
      }
      this._save();
    }
  }

  _save() {
    const dir = path.dirname(this.dataPath);
    fs.mkdirSync(dir, { recursive: true });
    const list = [...this.devices.values()];
    fs.writeFileSync(this.dataPath, JSON.stringify(list, null, 2), 'utf8');
    // Создание пустого файла при первом чтении — не правка проекта.
    if (this.onChanged && !this.loading) this.onChanged();
  }

  list() {
    return [...this.devices.values()].map((d) => this._public(d));
  }

  reorder(ids) {
    if (!Array.isArray(ids) || !ids.length) {
      throw Object.assign(new Error('нужен массив id устройств'), { status: 400 });
    }
    if (ids.length !== this.devices.size) {
      throw Object.assign(new Error('список устройств неполный'), { status: 400 });
    }
    const next = new Map();
    for (const rawId of ids) {
      const id = String(rawId);
      const device = this.devices.get(id);
      if (!device) {
        throw Object.assign(new Error('устройство не найдено: ' + id), { status: 400 });
      }
      if (next.has(id)) {
        throw Object.assign(new Error('дублируется id: ' + id), { status: 400 });
      }
      next.set(id, device);
    }
    this.devices = next;
    this._save();
    this.broadcast({ type: 'devices', devices: this.list() });
    return this.list();
  }

  get(id) {
    const d = this.devices.get(id);
    return d ? this._public(d) : null;
  }

  _public(device) {
    const rt = this.runtimes.get(device.id);
    return {
      ...device,
      running: !!rt,
      clients: rt ? rt.clientCount() : 0,
    };
  }

  create(body) {
    const device = sanitizeDeviceInput(body, { id: newId() });
    this._assertPortFree(device.port, device.protocol, null);
    this.devices.set(device.id, device);
    this._save();
    this.broadcast({ type: 'devices', devices: this.list() });
    return this._public(device);
  }

  update(id, body) {
    const existing = this.devices.get(id);
    if (!existing) throw Object.assign(new Error('device not found'), { status: 404 });

    const running = this.runtimes.has(id);

    if (running) {
      let next = { ...existing };
      let changed = false;

      if (body.commands != null) {
        next.commands = sanitizeCommands(body.commands);
        changed = true;
      }

      if (body.rules != null) {
        if (!Array.isArray(body.rules) || body.rules.length !== existing.rules.length) {
          throw Object.assign(
            new Error('while running only match/response/enabled of existing rules can change'),
            { status: 409 }
          );
        }
        for (let i = 0; i < existing.rules.length; i++) {
          const prev = existing.rules[i];
          const nextRule = body.rules[i];
          if (
            String(nextRule.note || '') !== String(prev.note || '') ||
            (nextRule.matchMode || 'exact') !== (prev.matchMode || 'exact') ||
            (Number(nextRule.delayMs) || 0) !== (Number(prev.delayMs) || 0)
          ) {
            throw Object.assign(
              new Error('при работе можно менять только команду, ответ и вкл/выкл правила'),
              { status: 409 }
            );
          }
        }

        next = {
          ...next,
          rules: existing.rules.map((r, i) => ({
            ...r,
            enabled: body.rules[i].enabled !== false,
            match: String(body.rules[i].match == null ? '' : body.rules[i].match),
            response: String(body.rules[i].response == null ? '' : body.rules[i].response),
          })),
        };
        changed = true;
      }

      if (!changed || sameDevice(next, existing)) {
        return this._public(existing);
      }

      this.devices.set(id, next);
      this._save();
      this.broadcast({ type: 'devices', devices: this.list() });
      return this._public(next);
    }

    const next = sanitizeDeviceInput(
      { ...existing, ...body, rules: body.rules != null ? body.rules : existing.rules },
      existing
    );

    // Ничего не поменялось — не трогаем ни файл, ни дату изменения проекта.
    if (sameDevice(next, existing)) {
      return this._public(existing);
    }

    if (next.port !== existing.port || next.protocol !== existing.protocol) {
      this._assertPortFree(next.port, next.protocol, id);
    }

    this.devices.set(id, next);
    this._save();
    this.broadcast({ type: 'devices', devices: this.list() });
    return this._public(next);
  }

  sendCommand(id, bodyRaw, note) {
    const device = this.devices.get(id);
    if (!device) throw Object.assign(new Error('device not found'), { status: 404 });
    const sim = this.runtimes.get(id);
    if (!sim) {
      throw Object.assign(new Error('сначала запусти устройство'), { status: 409 });
    }

    const raw = String(bodyRaw == null ? '' : bodyRaw);
    if (!raw.trim()) {
      throw Object.assign(new Error('пустое тело команды'), { status: 400 });
    }

    let built;
    try {
      built = buildResponse(
        { response: raw, delayMs: 0 },
        device.encoding,
        parseDelimiter(device.txDelimiter)
      );
    } catch (err) {
      throw Object.assign(new Error(err.message || String(err)), { status: 400 });
    }

    if (typeof sim.sendPayload !== 'function') {
      throw Object.assign(new Error('отправка не поддерживается'), { status: 500 });
    }

    const result = sim.sendPayload(built.payload, {
      note: note == null ? '' : String(note),
    });
    return { ok: true, bytes: built.payload.length, clients: result.clients };
  }

  remove(id) {
    if (!this.devices.has(id)) {
      throw Object.assign(new Error('device not found'), { status: 404 });
    }
    return this.stop(id).then(() => {
      this.devices.delete(id);
      this._save();
      this.broadcast({ type: 'devices', devices: this.list() });
    });
  }

  async start(id) {
    const device = this.devices.get(id);
    if (!device) throw Object.assign(new Error('device not found'), { status: 404 });
    if (this.runtimes.has(id)) return this._public(device);

    this._assertPortFree(device.port, device.protocol, id);

    const onLog = (entry) => {
      const event = {
        ...entry,
        ts: Date.now(),
        deviceName: this.devices.get(id)?.name || device.name,
      };
      this.broadcast(event);
    };

    const getRules = () => this.devices.get(id)?.rules || [];

    const sim =
      device.protocol === 'udp'
        ? new UdpSimulator(device, onLog, getRules)
        : new TcpSimulator(device, onLog, getRules);

    try {
      await sim.start();
    } catch (err) {
      throw Object.assign(new Error(`failed to bind ${device.protocol} ${device.bindHost}:${device.port}: ${err.message}`), {
        status: 500,
      });
    }

    this.runtimes.set(id, sim);
    onLog({ type: 'status', deviceId: id, message: `listening ${device.protocol.toUpperCase()} ${device.bindHost}:${device.port}` });
    this.broadcast({ type: 'devices', devices: this.list() });
    return this._public(device);
  }

  async stop(id) {
    const sim = this.runtimes.get(id);
    if (!sim) {
      if (!this.devices.has(id)) {
        throw Object.assign(new Error('device not found'), { status: 404 });
      }
      return this._public(this.devices.get(id));
    }

    await sim.stop();
    this.runtimes.delete(id);
    this.broadcast({
      type: 'status',
      ts: Date.now(),
      deviceId: id,
      deviceName: this.devices.get(id)?.name,
      message: 'stopped',
    });
    this.broadcast({ type: 'devices', devices: this.list() });
    return this._public(this.devices.get(id));
  }

  async stopAll() {
    const ids = [...this.runtimes.keys()];
    for (const id of ids) {
      await this.stop(id);
    }
  }

  async startAll() {
    const errors = [];
    for (const [id, device] of this.devices) {
      if (this.runtimes.has(id)) continue;
      try {
        await this.start(id);
      } catch (err) {
        errors.push({
          id,
          name: device.name,
          message: err.message,
        });
      }
    }
    return { devices: this.list(), errors };
  }

  _assertPortFree(port, protocol, exceptId) {
    for (const [id, d] of this.devices) {
      if (exceptId && id === exceptId) continue;
      if (d.port === port && d.protocol === protocol && this.runtimes.has(id)) {
        throw Object.assign(
          new Error(`port ${port}/${protocol} already in use by "${d.name}"`),
          { status: 409 }
        );
      }
      if (d.port === port && d.protocol === protocol && id !== exceptId) {
        // allow defining same port if not both running — OS bind will fail on start
        // but warn only when another is running; for config uniqueness prefer unique port+proto
      }
    }
  }
}

module.exports = { SimulatorManager };
