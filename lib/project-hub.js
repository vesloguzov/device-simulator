'use strict';

const { SimulatorManager } = require('./simulator-manager');
const { ProjectStore } = require('./project-store');

class ProjectHub {
  constructor(dataDir) {
    this.store = new ProjectStore(dataDir);
    this.managers = new Map(); // projectId -> SimulatorManager
    this.rooms = new Map(); // slug -> Set<ws>
  }

  listProjects() {
    return this.store.list().map((project) => ({
      ...project,
      stats: this.projectStats(project),
    }));
  }

  projectStats(project) {
    const devices = this.managerFor(project).list();
    let running = 0;
    let clients = 0;
    let portMin = null;
    let portMax = null;

    for (const d of devices) {
      if (d.running) running += 1;
      clients += Number(d.clients) || 0;
      const port = Number(d.port);
      if (!port) continue;
      if (portMin == null || port < portMin) portMin = port;
      if (portMax == null || port > portMax) portMax = port;
    }

    return { devices: devices.length, running, clients, portMin, portMax };
  }

  getProjectBySlug(slug) {
    return this.store.getBySlug(slug);
  }

  getProjectById(id) {
    return this.store.getById(id);
  }

  createProject(name, slug, description) {
    const explicit = String(slug == null ? '' : slug).trim();
    if (explicit) return this.store.create(name, explicit, { exact: true, description });
    return this.store.create(name, undefined, { description });
  }

  updateProject(id, patch) {
    return this.store.update(id, patch);
  }

  /**
   * В архив — значит, с проектом закончили: работающие устройства останавливаем,
   * чтобы забытый в архиве проект не держал порты. Возврат ничего не запускает.
   */
  async setArchived(id, archived) {
    if (!this.store.getById(id)) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    if (archived) {
      const manager = this.managers.get(id);
      if (manager) await manager.stopAll();
    }
    return this.store.setArchived(id, archived);
  }

  async deleteProject(id) {
    const project = this.store.getById(id);
    if (!project) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    const manager = this.managers.get(id);
    if (manager) {
      await manager.stopAll();
      this.managers.delete(id);
    }
    this.rooms.delete(project.slug);
    return this.store.remove(id);
  }

  _exportDevice(device) {
    return {
      name: device.name,
      bindHost: device.bindHost || '0.0.0.0',
      port: device.port,
      protocol: device.protocol,
      encoding: device.encoding,
      rxDelimiter: device.rxDelimiter != null ? device.rxDelimiter : '',
      txDelimiter: device.txDelimiter != null ? device.txDelimiter : '',
      rules: Array.isArray(device.rules)
        ? device.rules.map((r) => ({
            note: r.note || '',
            match: r.match || '',
            matchMode: r.matchMode || 'exact',
            response: r.response || '',
            delayMs: Number(r.delayMs) || 0,
            enabled: r.enabled !== false,
          }))
        : [],
      commands: Array.isArray(device.commands)
        ? device.commands.map((c) => ({
            note: c.note || '',
            body: c.body || '',
          }))
        : [],
    };
  }

  exportProjects(ids) {
    const wanted = Array.isArray(ids) && ids.length
      ? new Set(ids.map(String))
      : null;
    const projects = [];

    for (const project of this.store.list()) {
      if (wanted && !wanted.has(project.id)) continue;
      const manager = this.managerFor(project);
      projects.push({
        name: project.name,
        slug: project.slug,
        description: project.description || '',
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        archivedAt: project.archivedAt || null,
        devices: manager.list().map((d) => this._exportDevice(d)),
      });
    }

    if (!projects.length) {
      throw Object.assign(new Error('нет проектов для экспорта'), { status: 400 });
    }

    return {
      version: 1,
      app: 'device-simulator',
      kind: 'projects',
      exportedAt: new Date().toISOString(),
      projects,
    };
  }

  importProjects(rawProjects) {
    if (!Array.isArray(rawProjects) || !rawProjects.length) {
      throw Object.assign(new Error('в файле нет проектов'), { status: 400 });
    }

    const created = [];
    const errors = [];

    for (const item of rawProjects) {
      if (!item || typeof item !== 'object') {
        errors.push('пропущен некорректный элемент');
        continue;
      }
      try {
        const name = String(item.name || item.slug || 'Проект').trim() || 'Проект';
        const slugHint = item.slug ? String(item.slug) : undefined;
        const project = this.store.create(name, slugHint, { description: item.description });
        const manager = this.managerFor(project);
        const devices = Array.isArray(item.devices) ? item.devices : [];
        let deviceCount = 0;
        for (const d of devices) {
          try {
            manager.create(this._exportDevice(d));
            deviceCount += 1;
          } catch (devErr) {
            errors.push(
              name + ' / ' + (d && d.name ? d.name : '?') + ': ' + (devErr.message || String(devErr))
            );
          }
        }
        // После устройств: их запись успела отметить проект изменённым сейчас,
        // а из файла могла прийти своя история — её и возвращаем.
        this.store.setTimestamps(project.id, {
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          archivedAt: item.archivedAt,
        });

        created.push({
          id: project.id,
          name: project.name,
          slug: project.slug,
          devices: deviceCount,
        });
      } catch (err) {
        errors.push((item.name || item.slug || '?') + ': ' + (err.message || String(err)));
      }
    }

    if (!created.length) {
      throw Object.assign(
        new Error(errors.length ? errors.join('; ') : 'не удалось импортировать'),
        { status: 400 }
      );
    }

    return { created, errors };
  }

  managerFor(project) {
    let manager = this.managers.get(project.id);
    if (manager) return manager;

    const broadcast = (msg) => this.broadcast(project.slug, msg);
    const onChanged = () => this.store.touch(project.id);
    manager = new SimulatorManager(this.store.devicesPath(project.id), broadcast, onChanged);
    this.managers.set(project.id, manager);
    return manager;
  }

  managerBySlug(slug) {
    const project = this.store.getBySlug(slug);
    if (!project) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    return { project, manager: this.managerFor(project) };
  }

  subscribe(slug, ws) {
    if (!this.rooms.has(slug)) this.rooms.set(slug, new Set());
    this.rooms.get(slug).add(ws);
    ws._projectSlug = slug;
  }

  unsubscribe(ws) {
    const slug = ws._projectSlug;
    if (!slug) return;
    const room = this.rooms.get(slug);
    if (!room) return;
    room.delete(ws);
    if (!room.size) this.rooms.delete(slug);
  }

  broadcast(slug, msg) {
    const room = this.rooms.get(slug);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const ws of room) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  async stopAll() {
    for (const manager of this.managers.values()) {
      await manager.stopAll();
    }
  }
}

module.exports = { ProjectHub };
