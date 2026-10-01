// Экспорт и импорт устройств в JSON-файл, через общий диалог выбора.

import { MSG } from './messages.js';
import { state } from './state.js';
import { devicesApi } from './api.js';
import { post } from './http.js';
import { downloadJson, readJsonFile } from './html.js';
import { openPickDialog } from './pick-dialog.js';
import { deviceExportPayload, importedDevicePayload } from './device-actions.js';

function deviceMeta(d) {
  return String(d.protocol || 'tcp').toUpperCase() +
    ' · ' + (d.encoding === 'hex' ? 'HEX' : MSG.textEnc) +
    ' · :' + (d.port || '?') +
    ' · ' + MSG.rulesCount + ' ' + (d.rules || []).length;
}

async function exportDevices() {
  if (!state.devices.length) {
    alert(MSG.noExport);
    return;
  }

  const chosen = await openPickDialog({
    title: MSG.exportTitle,
    hint: MSG.exportHint,
    items: state.devices,
    getLabel: function (d) { return d.name; },
    getMeta: deviceMeta,
  });
  if (!chosen || !chosen.length) return;

  const payload = {
    version: 1,
    app: 'device-simulator',
    exportedAt: new Date().toISOString(),
    devices: chosen.map(deviceExportPayload),
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadJson('device-simulator-export-' + stamp + '.json', payload);
}

async function importDevices(file, onImported) {
  const parsed = await readJsonFile(file);
  if (!parsed) {
    alert(MSG.badJson);
    return;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.devices)
      ? parsed.devices
      : null;

  if (!list || !list.length) {
    alert(MSG.emptyFile);
    return;
  }

  const chosen = await openPickDialog({
    title: MSG.importTitle,
    hint: MSG.importHintPrefix + ': ' + file.name + '. ' + MSG.importHintSuffix,
    items: list,
    getLabel: function (d) { return d.name || MSG.noName; },
    getMeta: deviceMeta,
  });
  if (!chosen || !chosen.length) return;

  const errors = [];
  let ok = 0;
  let lastId = null;

  for (const raw of chosen) {
    try {
      const result = await post(devicesApi(), importedDevicePayload(raw));
      ok += 1;
      lastId = result.device.id;
    } catch (err) {
      errors.push((raw.name || '?') + ': ' + err.message);
    }
  }

  await onImported(lastId);

  if (errors.length) {
    alert(MSG.importedPartial + ': ' + ok + '\n' + MSG.errors + ':\n' + errors.join('\n'));
  } else {
    alert(MSG.imported + ': ' + ok);
  }
}

/** @param {(lastId: string | null) => Promise<void>} onImported */
export function initTransfer(onImported) {
  const fileInput = document.getElementById('importFile');

  document.getElementById('btnExport').addEventListener('click', function () {
    exportDevices().catch(function (err) { alert(err.message); });
  });

  document.getElementById('btnImport').addEventListener('click', function () {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', function (ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    importDevices(file, onImported).catch(function (err) { alert(err.message); });
  });
}
