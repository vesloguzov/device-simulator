// Форма настроек устройства и её свёрнутая однострочная сводка.

import { MSG } from './messages.js';
import { els } from './elements.js';
import { setValue, setText, setDisabled } from './html.js';
import { state, selected } from './state.js';

/** Поля формы — они же ключи payload'а и они же блокируются на ходу. */
export const FIELDS = ['name', 'bindHost', 'port', 'protocol', 'encoding', 'rxDelimiter', 'txDelimiter'];

export function updateSettingsSummary() {
  const el = els.settingsSummary;
  if (!el) return;

  const d = selected();
  if (!d) {
    setText(el, '');
    return;
  }

  const f = els.settingsForm;
  const protocol = String(f.protocol.value || d.protocol || 'tcp').toUpperCase();
  const encoding = (f.encoding.value || d.encoding) === 'hex' ? 'HEX' : MSG.textEnc;
  const host = f.bindHost.value || d.bindHost || '0.0.0.0';
  const port = f.port.value || d.port;
  const rx = f.rxDelimiter.value;
  const tx = f.txDelimiter.value;

  setText(el,
    protocol + ' · ' + encoding + ' · :' + port + ' · ' + host +
    '\n' + 'RX ' + (rx || '—') + ' · TX ' + (tx || '—'));
}

/**
 * Заполнить форму с сервера. Автосохранение на время заливки выключено,
 * иначе каждое присваивание улетало бы обратно на сервер.
 */
export function fillSettingsForm(d) {
  const f = els.settingsForm;
  state.suppressAutosave = true;
  setValue(f.name, d.name);
  setValue(f.bindHost, d.bindHost || '0.0.0.0');
  setValue(f.port, d.port);
  setValue(f.protocol, d.protocol);
  setValue(f.encoding, d.encoding);
  setValue(f.rxDelimiter, d.rxDelimiter != null ? d.rxDelimiter : '');
  setValue(f.txDelimiter, d.txDelimiter != null ? d.txDelimiter : '');
  state.suppressAutosave = false;
  updateSettingsSummary();
}

/** На запущенном устройстве настройки не меняют — только правила и команды. */
export function setSettingsLock(lock) {
  FIELDS.forEach(function (name) {
    setDisabled(els.settingsForm[name], lock);
  });
  setDisabled(els.btnAddRule, lock);
  els.btnAddRule.style.opacity = lock ? '0.45' : '1';
}

export function collectSettingsPayload() {
  const f = els.settingsForm;
  return {
    name: f.name.value,
    bindHost: f.bindHost.value,
    port: Number(f.port.value),
    protocol: f.protocol.value,
    encoding: f.encoding.value,
    rxDelimiter: f.rxDelimiter.value,
    txDelimiter: f.txDelimiter.value,
    rules: state.draftRules,
    commands: state.draftCommands,
  };
}
