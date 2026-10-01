// Состояние рабочего экрана. Здесь только данные и правила их изменения —
// ничего, что трогает DOM, кроме проверки «пользователь сейчас печатает».

import { els } from './elements.js';
import { PROJECT_SLUG } from './api.js';

export const state = {
  project: null,
  devices: [],
  selectedId: null,
  draftRules: [],
  draftCommands: [],
  saving: false,
  dirty: false,
  draftsFor: null,
  suppressAutosave: false,
  devicesCollapsed: localStorage.getItem('devicesCollapsed') === '1',
  // Фильтр намеренно не сохраняем: после перезапуска скрытый фильтр
  // выглядел бы как пропавшие устройства.
  deviceFilter: '',
  showRaw: localStorage.getItem('showRaw') === '1',
  logsByDevice: {},
  colDevices: Math.max(250, Number(localStorage.getItem('colDevices')) || 250),
  colLog: Math.max(300, Number(localStorage.getItem('colLog')) || 440),
  settingsCollapsed: localStorage.getItem('settingsCollapsed') === '1',
  rulesCollapsed: localStorage.getItem('rulesCollapsed') === '1',
  commandsCollapsed: localStorage.getItem('commandsCollapsed') === '1',
};

function lastDeviceStorageKey() {
  return 'ds:lastDevice:' + PROJECT_SLUG;
}

export function rememberedDeviceId() {
  return localStorage.getItem(lastDeviceStorageKey());
}

export function setSelectedId(id) {
  state.selectedId = id || null;
  if (id) localStorage.setItem(lastDeviceStorageKey(), id);
  else localStorage.removeItem(lastDeviceStorageKey());
}

export function selected() {
  return state.devices.find(function (d) { return d.id === state.selectedId; }) || null;
}

export function cloneRules(rules) {
  return (rules || []).map(function (r) { return Object.assign({}, r); });
}

export function cloneCommands(commands) {
  return (commands || []).map(function (c) { return Object.assign({}, c); });
}

/** Черновики принадлежат одному устройству; при смене — перечитываем с сервера. */
export function loadDrafts(d) {
  state.draftRules = d ? cloneRules(d.rules) : [];
  state.draftCommands = d ? cloneCommands(d.commands) : [];
  state.draftsFor = d ? d.id : null;
  state.dirty = false;
}

/**
 * Принять данные с сервера, не затерев свои несохранённые правки.
 * Без этой проверки сообщение по WebSocket (клиент подключился, устройство
 * запустилось) откатывало только что добавленное правило к серверной копии.
 *
 * @returns {boolean} менялись ли черновики — вызывающему решать, обновлять ли вид
 */
export function adoptRemote(d) {
  if (!d) return false;
  if (state.draftsFor !== d.id) {
    loadDrafts(d);
    return true;
  }
  if (state.dirty || state.saving || isEditingDraft()) return false;
  state.draftRules = cloneRules(d.rules);
  state.draftCommands = cloneCommands(d.commands);
  return true;
}

/** Стоит ли курсор в поле, которое мы собираемся обновить с сервера. */
export function isEditingDraft() {
  const active = document.activeElement;
  return !!(
    active &&
    (els.settingsForm.contains(active) ||
      els.rulesTable.contains(active) ||
      els.commandsTable.contains(active))
  );
}
