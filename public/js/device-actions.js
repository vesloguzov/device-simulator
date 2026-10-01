// Операции над устройством, не зависящие от разметки.

import { state, cloneRules, cloneCommands } from './state.js';

export const DEFAULT_PORT = 8000;

/** Первый порт того же протокола, который ещё никем не занят в проекте. */
export function nextFreePort(protocol, preferred) {
  const used = {};
  state.devices.forEach(function (x) {
    if (x.protocol === protocol) used[x.port] = true;
  });
  let port = Number(preferred) || DEFAULT_PORT;
  if (port < 1) port = 1;
  while (used[port] && port < 65535) port += 1;
  if (used[port]) throw new Error('нет свободного порта');
  return port;
}

/** Полный набор полей устройства — и для экспорта в файл, и для копии. */
export function deviceExportPayload(d) {
  return {
    name: d.name,
    bindHost: d.bindHost || '0.0.0.0',
    port: d.port,
    protocol: d.protocol,
    encoding: d.encoding,
    rxDelimiter: d.rxDelimiter != null ? d.rxDelimiter : '',
    txDelimiter: d.txDelimiter != null ? d.txDelimiter : '',
    rules: cloneRules(d.rules || []),
    commands: cloneCommands(d.commands || []),
  };
}

/** Привести запись из файла к виду, который принимает сервер. */
export function importedDevicePayload(raw) {
  const delim = raw.delimiter != null ? raw.delimiter : '';
  return deviceExportPayload({
    name: raw.name || 'Device',
    bindHost: raw.bindHost || '0.0.0.0',
    port: Number(raw.port),
    protocol: raw.protocol || 'tcp',
    encoding: raw.encoding || 'text',
    rxDelimiter: raw.rxDelimiter != null ? raw.rxDelimiter : delim,
    txDelimiter: raw.txDelimiter != null ? raw.txDelimiter : delim,
    rules: raw.rules || [],
    commands: raw.commands || [],
  });
}
