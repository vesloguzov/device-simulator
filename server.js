'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { ProjectHub } = require('./lib/project-hub');
const { listAddresses, noteLocalAddress } = require('./lib/net-info');

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function handleError(res, err) {
  const status = err.status || 400;
  sendJson(res, status, { error: err.message || String(err) });
}

/**
 * @param {{ port?: number, dataDir?: string, publicDir?: string, host?: string }} [options]
 * @returns {Promise<{ port: number, url: string, stop: () => Promise<void>, hub: import('./lib/project-hub').ProjectHub }>}
 */
function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT) || 3920;
  const host = options.host || '0.0.0.0';
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const publicDir = options.publicDir || path.join(__dirname, 'public');

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Если интерфейс открыли с другого компьютера — адрес, на который пришёл запрос,
  // тоже проверенно рабочий. Свои же обращения с localhost сюда не считаются.
  app.use((req, _res, next) => {
    noteLocalAddress(req.socket.localAddress, 'ui');
    next();
  });

  const hub = new ProjectHub(dataDir);

  function withManager(req, res, fn) {
    try {
      const { project, manager } = hub.managerBySlug(req.params.slug);
      return fn(project, manager);
    } catch (err) {
      handleError(res, err);
    }
  }

  app.get('/api/network', (_req, res) => {
    sendJson(res, 200, { addresses: listAddresses() });
  });

  app.get('/api/projects', (_req, res) => {
    sendJson(res, 200, { projects: hub.listProjects() });
  });

  app.post('/api/projects', (req, res) => {
    try {
      const body = req.body || {};
      const project = hub.createProject(body.name, body.slug, body.description);
      sendJson(res, 201, { project });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put('/api/projects/:id', (req, res) => {
    try {
      const body = req.body || {};
      const project = hub.updateProject(req.params.id, {
        name: body.name,
        description: body.description,
      });
      sendJson(res, 200, { project });
    } catch (err) {
      handleError(res, err);
    }
  });

  // { archived: true } — в архив, { archived: false } — вернуть в текущие.
  app.post('/api/projects/:id/archive', async (req, res) => {
    try {
      const archived = !(req.body && req.body.archived === false);
      const project = await hub.setArchived(req.params.id, archived);
      sendJson(res, 200, { project });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get('/api/projects/by-slug/:slug', (req, res) => {
    const project = hub.getProjectBySlug(req.params.slug);
    if (!project) {
      handleError(res, Object.assign(new Error('проект не найден'), { status: 404 }));
      return;
    }
    sendJson(res, 200, { project });
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      await hub.deleteProject(req.params.id);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/projects/export', (req, res) => {
    try {
      const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : [];
      const payload = hub.exportProjects(ids);
      sendJson(res, 200, payload);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/projects/import', (req, res) => {
    try {
      const body = req.body || {};
      const list = Array.isArray(body)
        ? body
        : Array.isArray(body.projects)
          ? body.projects
          : null;
      if (!list) {
        throw Object.assign(new Error('ожидается JSON с массивом projects'), { status: 400 });
      }
      const result = hub.importProjects(list);
      sendJson(res, 201, result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get('/api/p/:slug/devices', (req, res) => {
    withManager(req, res, (_project, manager) => {
      sendJson(res, 200, { devices: manager.list() });
    });
  });

  app.post('/api/p/:slug/devices/reorder', (req, res) => {
    withManager(req, res, (_project, manager) => {
      try {
        const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : null;
        const devices = manager.reorder(ids);
        sendJson(res, 200, { devices });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices', (req, res) => {
    withManager(req, res, (_project, manager) => {
      try {
        const device = manager.create(req.body || {});
        sendJson(res, 201, { device });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.put('/api/p/:slug/devices/:id', (req, res) => {
    withManager(req, res, (_project, manager) => {
      try {
        const device = manager.update(req.params.id, req.body || {});
        sendJson(res, 200, { device });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.delete('/api/p/:slug/devices/:id', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        await manager.remove(req.params.id);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices/:id/start', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        const device = await manager.start(req.params.id);
        sendJson(res, 200, { device });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices/:id/stop', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        const device = await manager.stop(req.params.id);
        sendJson(res, 200, { device });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices/start-all', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        const result = await manager.startAll();
        sendJson(res, 200, result);
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices/stop-all', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        await manager.stopAll();
        sendJson(res, 200, { devices: manager.list() });
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.post('/api/p/:slug/devices/:id/send', async (req, res) => {
    withManager(req, res, async (_project, manager) => {
      try {
        const result = await manager.sendCommand(
          req.params.id,
          req.body && req.body.body,
          req.body && req.body.note
        );
        sendJson(res, 200, result);
      } catch (err) {
        handleError(res, err);
      }
    });
  });

  app.get('/', (_req, res) => {
    res.redirect(302, '/projects');
  });

  app.get('/projects', (_req, res) => {
    res.sendFile(path.join(publicDir, 'projects.html'));
  });

  app.get('/settings', (_req, res) => {
    res.sendFile(path.join(publicDir, 'settings.html'));
  });

  app.get('/p/:slug', (req, res) => {
    const project = hub.getProjectBySlug(req.params.slug);
    if (!project) {
      res.status(404).type('html').send(
        `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Не найден — Симулятор TCP/UDP устройств</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="stylesheet" href="/styles.css"></head><body>
        <header class="app-header"><div><h1>Проект не найден</h1>
        <p class="hint">Нет проекта со slug «${String(req.params.slug).replace(/[<>&]/g, '')}»</p></div>
        <div class="app-actions"><a class="btn" href="/projects">Проекты</a></div></header></body></html>`
      );
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(express.static(publicDir));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const slug = url.searchParams.get('project') || '';
    const project = hub.getProjectBySlug(slug);
    if (!project) {
      ws.send(JSON.stringify({ type: 'status', message: 'проект не найден' }));
      ws.close();
      return;
    }

    hub.subscribe(slug, ws);
    const { manager } = hub.managerBySlug(slug);
    ws.send(JSON.stringify({ type: 'devices', devices: manager.list(), project }));

    ws.on('close', () => hub.unsubscribe(ws));
  });

  let stopping = null;

  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      await hub.stopAll();

      // wss.close() не рвёт уже открытые веб-сокеты, а пока жив хоть один,
      // http-сервер не закроется — интерфейс держит соединение постоянно.
      for (const ws of wss.clients) {
        try {
          ws.terminate();
        } catch (_) {
          /* сокет уже мёртв */
        }
      }

      await new Promise((resolve) => {
        try {
          wss.close(() => resolve());
        } catch (_) {
          resolve();
        }
        setTimeout(resolve, 500);
      });

      // То же и с keep-alive соединениями браузера: без принудительного
      // разрыва close() ждёт их до истечения таймаута.
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }

      await new Promise((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 1500);
      });
    })();
    return stopping;
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const url = `http://127.0.0.1:${port}`;
      console.log(`Device simulator: ${url}/projects`);
      resolve({
        port,
        url,
        host,
        dataDir,
        publicDir,
        hub,
        stop,
        server,
      });
    });
  });
}

async function main() {
  const runtime = await startServer({
    port: Number(process.env.PORT) || 3920,
    dataDir: path.join(__dirname, 'data'),
    publicDir: path.join(__dirname, 'public'),
  });

  async function shutdown() {
    console.log('Shutting down…');
    try {
      await runtime.stop();
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { startServer };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
