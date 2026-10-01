// Рабочий экран проекта: связывает состояние, виды и сервер.
//
// Здесь и только здесь меняется state.devices / state.draft*, после чего
// затронутым видам говорят обновиться. Сами виды ничего не решают — они
// показывают то, что им дали, и сообщают о действиях пользователя обратно.

import { MSG } from './messages.js';
import { els } from './elements.js';
import { setText, setValue, setClass } from './html.js';
import { PROJECT_SLUG, projectApi, devicesApi } from './api.js';
import { api, post, del } from './http.js';
import {
  state, selected, setSelectedId, loadDrafts, adoptRemote,
  isEditingDraft, rememberedDeviceId,
} from './state.js';
import {
  initWorkspace, applyProjectTitle, updateRunButton, updateRunAllButtons,
} from './workspace.js';
import { fillSettingsForm, setSettingsLock, updateSettingsSummary } from './settings-form.js';
import { createSaver } from './saver.js';
import { createDeviceMenu } from './device-menu.js';
import { createDeviceList } from './device-list.js';
import { createRulesView } from './rules-view.js';
import { createCommandsView } from './commands-view.js';
import { pushLog, renderLog, clearLog, initLogView } from './log-view.js';
import { nextFreePort, deviceExportPayload, DEFAULT_PORT } from './device-actions.js';
import { initTransfer } from './transfer.js';

const WS_RETRY_MS = 1200;

// ── Сохранение ───────────────────────────────────────────

const saver = createSaver(async function afterSave() {
  const data = await api(devicesApi());
  state.devices = data.devices || [];
  syncDeviceList();
  const fresh = selected();
  if (fresh) updateRunButton(fresh);
});

// ── Виды ─────────────────────────────────────────────────

const deviceMenu = createDeviceMenu({
  getDevice: function (id) {
    return state.devices.find(function (x) { return x.id === id; }) || null;
  },
  onCopy: copyDevice,
  onDelete: deleteDevice,
});

const deviceList = createDeviceList({
  onSelect: function (d) {
    deviceMenu.close();
    setSelectedId(d.id);
    loadDrafts(d);
    syncDeviceList();
    showDetail();
    renderLog();
  },
  onMenu: function (d, btn) {
    if (deviceMenu.isOpen(d.id)) deviceMenu.close();
    else deviceMenu.open(d.id, btn);
  },
  onDragStart: function () {
    deviceMenu.close();
  },
  onReorder: function (from, to) {
    const moved = state.devices.splice(from, 1)[0];
    state.devices.splice(to, 0, moved);
    const ids = state.devices.map(function (d) { return d.id; });
    post(devicesApi('/reorder'), { ids: ids })
      .then(function (data) {
        if (data && data.devices) state.devices = data.devices;
        syncDeviceList();
      })
      .catch(function (err) {
        alert(err.message);
        refresh().catch(function () {});
      });
  },
});

const rulesView = createRulesView({
  onEdit: function (kind) {
    saver.scheduleSave(kind);
  },
  onRemove: function (index) {
    state.draftRules.splice(index, 1);
    syncDrafts();
    saver.scheduleSave('rules');
  },
  onCopy: function (index) {
    const copy = Object.assign({}, state.draftRules[index]);
    copy.note = (copy.note || '') + '(1)';
    state.draftRules.splice(index + 1, 0, copy);
    syncDrafts();
    saver.scheduleSave('rules');
  },
  onReorder: function (from, to) {
    const moved = state.draftRules.splice(from, 1)[0];
    state.draftRules.splice(to, 0, moved);
    syncDrafts();
    saver.scheduleSave('rules');
  },
});

const commandsView = createCommandsView({
  onEdit: function () {
    saver.scheduleSave('commands');
  },
  onRemove: function (index) {
    state.draftCommands.splice(index, 1);
    syncDrafts();
    saver.scheduleSave('commands');
  },
  onReorder: function (from, to) {
    const moved = state.draftCommands.splice(from, 1)[0];
    state.draftCommands.splice(to, 0, moved);
    syncDrafts();
    saver.scheduleSave('commands');
  },
  onSend: function (command) {
    const d = selected();
    if (!d) return;
    post(devicesApi('/' + d.id + '/send'), {
      body: command.body || '',
      note: command.note || '',
    }).catch(function (err) { alert(err.message); });
  },
});

// ── Обновление вида ──────────────────────────────────────

function syncDeviceList() {
  deviceList.sync(state.devices, {
    filter: state.deviceFilter,
    selectedId: state.selectedId,
  });
  updateRunAllButtons();
  deviceMenu.verify();
}

/** Правила и команды показывают текущий черновик выбранного устройства. */
function syncDrafts() {
  const running = !!(selected() || {}).running;
  rulesView.sync(state.draftRules, running);
  commandsView.sync(state.draftCommands, running);
}

/** Шапка, кнопка запуска и блокировка формы — всё, что зависит от статуса. */
function applyDeviceStatus(d) {
  setText(els.detailTitle, d.name);
  updateRunButton(d);
  setSettingsLock(!!d.running);
}

function showDetail() {
  const d = selected();
  if (!d) {
    setClass(els.detailEmpty, 'hidden', false);
    setClass(els.detailBody, 'hidden', true);
    return;
  }

  setClass(els.detailEmpty, 'hidden', true);
  setClass(els.detailBody, 'hidden', false);
  applyDeviceStatus(d);
  fillSettingsForm(d);
  setText(els.settingsNote, '');

  // Раньше здесь пустой черновик пополнялся серверной копией — из-за чего
  // удалённое последнее правило возвращалось на следующем обновлении.
  if (state.draftsFor !== d.id) loadDrafts(d);
  syncDrafts();
}

async function refresh() {
  const data = await api(devicesApi());
  const prevId = state.selectedId;
  state.devices = data.devices || [];
  if (prevId) {
    const d = state.devices.find(function (x) { return x.id === prevId; });
    if (d) {
      adoptRemote(d);
    } else {
      setSelectedId(null);
      loadDrafts(null);
    }
  }
  syncDeviceList();
  showDetail();
  renderLog();
}

/**
 * Пришло сообщение о смене статуса: перечитываем список и подтягиваем
 * серверную копию, если пользователь сейчас ничего не правит.
 */
function syncFromServer() {
  api(devicesApi())
    .then(function (data) {
      state.devices = data.devices || [];
      syncDeviceList();
      const d = selected();
      if (!d) return;
      applyDeviceStatus(d);
      setText(els.settingsNote, '');
      if (isEditingDraft()) return;
      adoptRemote(d);
      syncDrafts();
    })
    .catch(function () {});
}

/**
 * Не чаще раза в SYNC_MIN_MS. Сервер не присылает список устройств, когда
 * клиент подключается или отваливается, — а счётчик «подкл» обновить надо.
 * Раньше за списком ходили на каждое такое сообщение: драйвер, который
 * переподключается на каждую команду, давал по два запроса на обмен.
 * Теперь пачка сообщений сливается в один запрос, но последний не теряется.
 */
const SYNC_MIN_MS = 300;
let syncTimer = 0;
let lastSyncAt = 0;

function requestSyncFromServer() {
  if (syncTimer) return;
  const wait = Math.max(0, lastSyncAt + SYNC_MIN_MS - Date.now());
  syncTimer = setTimeout(function () {
    syncTimer = 0;
    lastSyncAt = Date.now();
    syncFromServer();
  }, wait);
}

// ── Действия над устройствами ────────────────────────────

async function deleteDevice(d) {
  if (!d) return;
  if (!confirm(MSG.delDevice + ' «' + d.name + '»?')) return;
  try {
    await del(devicesApi('/' + d.id));
    if (state.selectedId === d.id) {
      setSelectedId(null);
      loadDrafts(null);
    }
    delete state.logsByDevice[d.id];
    await refresh();
    renderLog();
  } catch (err) {
    alert(err.message);
  }
}

async function copyDevice(d) {
  if (!d) return;
  try {
    const body = deviceExportPayload(d);
    body.name = (d.name || '') + '(1)';
    body.port = nextFreePort(d.protocol || 'tcp', (Number(d.port) || DEFAULT_PORT) + 1);
    const result = await post(devicesApi(), body);
    setSelectedId(result.device.id);
    loadDrafts(result.device);
    await refresh();
    renderLog();
  } catch (err) {
    alert(err.message);
  }
}

// ── Поиск по списку ──────────────────────────────────────

function applyFilterClear() {
  setClass(els.btnClearFilter, 'hidden', !els.deviceFilter.value);
}

function setDeviceSearch(open) {
  setClass(els.deviceFilterWrap, 'hidden', !open);
  setClass(els.devicesTitle, 'hidden', open);
  setClass(els.btnSearchDevices, 'active', open);
  els.btnSearchDevices.title = open ? MSG.searchClose : MSG.search;

  if (open) {
    els.deviceFilter.focus();
    els.deviceFilter.select();
    applyFilterClear();
    return;
  }

  if (state.deviceFilter) {
    state.deviceFilter = '';
    setValue(els.deviceFilter, '');
    syncDeviceList();
  }
  applyFilterClear();
}

function setFilter(value) {
  state.deviceFilter = value;
  applyFilterClear();
  syncDeviceList();
}

// ── Развеска обработчиков ────────────────────────────────

function initSettingsForm() {
  els.settingsForm.addEventListener('submit', function (e) { e.preventDefault(); });
  ['change', 'input'].forEach(function (type) {
    els.settingsForm.addEventListener(type, function () {
      updateSettingsSummary();
      saver.scheduleSave('settings');
    });
  });
}

function initSearch() {
  els.btnSearchDevices.addEventListener('click', function () {
    setDeviceSearch(els.deviceFilterWrap.classList.contains('hidden'));
  });

  els.deviceFilter.addEventListener('input', function () {
    setFilter(els.deviceFilter.value);
  });

  // Крестик чистит запрос, но поле оставляет открытым — обычно ищут дальше.
  els.btnClearFilter.addEventListener('click', function () {
    setValue(els.deviceFilter, '');
    setFilter('');
    els.deviceFilter.focus();
  });

  els.deviceFilter.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setDeviceSearch(false);
    }
  });
}

function initDeviceDialog() {
  document.getElementById('btnAdd').addEventListener('click', function () {
    els.addDialog.showModal();
  });

  document.getElementById('btnCancelAdd').addEventListener('click', function () {
    els.addDialog.close();
  });

  els.addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(els.addForm);
    try {
      const result = await post(devicesApi(), {
        name: fd.get('name'),
        port: Number(fd.get('port')),
        protocol: fd.get('protocol'),
        encoding: fd.get('encoding'),
        rxDelimiter: fd.get('rxDelimiter'),
        txDelimiter: fd.get('txDelimiter'),
        rules: [],
        commands: [],
      });
      setSelectedId(result.device.id);
      loadDrafts(result.device);
      els.addDialog.close();
      els.addForm.reset();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
}

function initDraftButtons() {
  els.btnAddRule.addEventListener('click', function () {
    const d = selected();
    if (!d || d.running) return;
    state.draftRules.push({
      note: '',
      enabled: true,
      matchMode: 'exact',
      match: '',
      response: '',
      delayMs: 0,
    });
    syncDrafts();
    saver.scheduleSave('rules');
  });

  els.btnAddCommand.addEventListener('click', function () {
    if (!selected()) return;
    state.draftCommands.push({ note: '', body: '' });
    syncDrafts();
    saver.scheduleSave('commands');
  });
}

function initRunButtons() {
  els.btnToggleRun.addEventListener('click', async function () {
    const d = selected();
    if (!d) return;
    try {
      if (d.running) {
        await post(devicesApi('/' + d.id + '/stop'));
      } else {
        await saver.saveNow('settings');
        await post(devicesApi('/' + d.id + '/start'));
      }
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  els.btnStartAll.addEventListener('click', async function () {
    if (!state.devices.length) return;
    try {
      if (selected()) await saver.saveNow('settings');
      const result = await post(devicesApi('/start-all'));
      if (result.errors && result.errors.length) {
        alert(
          MSG.startAllPartial + ':\n' +
          result.errors.map(function (e) { return e.name + ': ' + e.message; }).join('\n')
        );
      }
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  els.btnStopAll.addEventListener('click', async function () {
    if (!state.devices.some(function (d) { return d.running; })) return;
    try {
      await post(devicesApi('/stop-all'));
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
}

function initLogPanel() {
  initLogView();
  els.chkShowRaw.checked = state.showRaw;

  document.getElementById('btnClearLog').addEventListener('click', clearLog);

  els.chkShowRaw.addEventListener('change', function () {
    state.showRaw = els.chkShowRaw.checked;
    localStorage.setItem('showRaw', state.showRaw ? '1' : '0');
    renderLog();
  });
}

function initGlobalHandlers() {
  document.addEventListener('click', function () {
    deviceMenu.close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') deviceMenu.close();
  });

  // fixed-поповер не едет вместе со списком — проще закрыть, чем пересчитывать.
  els.deviceList.addEventListener('scroll', function () {
    deviceMenu.close();
  });

  window.addEventListener('resize', function () {
    deviceMenu.close();
  });
}

// ── Связь с сервером ─────────────────────────────────────

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(
    proto + '://' + location.host + '/ws?project=' + encodeURIComponent(PROJECT_SLUG)
  );

  ws.addEventListener('close', function () { setTimeout(connectWs, WS_RETRY_MS); });

  ws.addEventListener('message', function (ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }

    if (msg.type !== 'devices') {
      pushLog(msg);
      if (msg.type === 'status') requestSyncFromServer();
      return;
    }

    if (msg.project) {
      state.project = msg.project;
      applyProjectTitle();
    }
    state.devices = msg.devices || [];
    syncDeviceList();

    const d = selected();
    if (!d || isEditingDraft()) return;
    applyDeviceStatus(d);
    adoptRemote(d);
    syncDrafts();
  });
}

// ── Запуск ───────────────────────────────────────────────

function boot() {
  initWorkspace();
  initSettingsForm();
  initSearch();
  initDeviceDialog();
  initDraftButtons();
  initRunButtons();
  initLogPanel();
  initGlobalHandlers();
  initTransfer(async function onImported(lastId) {
    await refresh();
    if (!lastId) return;
    setSelectedId(lastId);
    loadDrafts(selected());
    syncDeviceList();
    showDetail();
    renderLog();
  });

  return api(projectApi())
    .then(function (data) {
      state.project = data.project;
      applyProjectTitle();
      const remembered = rememberedDeviceId();
      if (remembered) state.selectedId = remembered;
      return refresh();
    })
    .then(connectWs);
}

if (!PROJECT_SLUG) {
  location.replace('/projects');
} else {
  boot().catch(function (err) {
    console.error(err);
    alert(err.message || String(err));
    location.replace('/projects');
  });
}
