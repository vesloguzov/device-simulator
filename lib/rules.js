'use strict';

function parseDelimiter(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw);
  // hex:FF or hex:DD EE FF
  if (/^hex:/i.test(s)) {
    const { hexToBuffer } = module.exports;
    return hexToBuffer(s.slice(4)).toString('binary');
  }
  s = s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\0/g, '\0');
  return s;
}

function normalizeHex(str) {
  const cleaned = String(str || '').replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of digits');
  }
  return cleaned.toUpperCase();
}

function hexToBuffer(str) {
  const hex = normalizeHex(str);
  return Buffer.from(hex, 'hex');
}

function bufferToHex(buf) {
  return Buffer.from(buf)
    .toString('hex')
    .toUpperCase()
    .replace(/(..)/g, '$1 ')
    .trim();
}

function formatPayload(encoding, data) {
  if (encoding === 'hex') {
    return bufferToHex(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return String(data);
}

function findRule(rules, encoding, incoming) {
  const list = Array.isArray(rules) ? rules : [];
  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    if (!rule || rule.enabled === false) continue;
    if (matchesRule(rule, encoding, incoming)) {
      return { rule, index: i };
    }
  }
  return null;
}

/** For TCP hex streams: match prefix of buffer and report bytes to consume. */
function findRuleInHexStream(rules, buffer) {
  const list = Array.isArray(rules) ? rules : [];
  let best = null;

  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    if (!rule || rule.enabled === false) continue;

    let needle;
    try {
      needle = hexToBuffer(rule.match);
    } catch (_) {
      continue;
    }
    if (!needle.length) continue;

    const mode = rule.matchMode || 'exact';

    if (mode === 'exact' || mode === 'startsWith') {
      if (buffer.length < needle.length) continue;
      if (buffer.subarray(0, needle.length).equals(needle)) {
        const hit = { rule, index: i, consume: needle.length };
        if (!best || hit.consume > best.consume) best = hit;
      }
    } else if (mode === 'contains') {
      const idx = buffer.indexOf(needle);
      if (idx >= 0) {
        const consume = idx + needle.length;
        const hit = { rule, index: i, consume };
        if (!best || hit.consume < best.consume) best = hit;
      }
    }
  }

  return best;
}

function matchesRule(rule, encoding, incoming) {
  const mode = rule.matchMode || 'exact';

  if (encoding === 'hex') {
    let needle;
    let hay;
    try {
      needle = hexToBuffer(rule.match);
      hay = Buffer.isBuffer(incoming) ? incoming : hexToBuffer(incoming);
    } catch (_) {
      return false;
    }

    if (mode === 'exact') return hay.equals(needle);
    if (mode === 'startsWith') {
      return hay.length >= needle.length && hay.subarray(0, needle.length).equals(needle);
    }
    if (mode === 'contains') return hay.includes(needle);
    return false;
  }

  const hay = typeof incoming === 'string' ? incoming : Buffer.from(incoming).toString('utf8');
  const needle = String(rule.match == null ? '' : rule.match);

  if (mode === 'exact') return hay === needle;
  if (mode === 'startsWith') return hay.startsWith(needle);
  if (mode === 'contains') return hay.includes(needle);
  return false;
}

function endsWithBuffer(buf, suffix) {
  if (!suffix || !suffix.length) return true;
  if (buf.length < suffix.length) return false;
  return buf.subarray(buf.length - suffix.length).equals(suffix);
}

function buildResponse(rule, encoding, txDelimiter) {
  const delayMs = Math.max(0, Number(rule.delayMs) || 0);
  const delimBuf = txDelimiter ? Buffer.from(txDelimiter, 'binary') : Buffer.alloc(0);

  if (encoding === 'hex') {
    let payload = hexToBuffer(rule.response || '');
    if (delimBuf.length && !endsWithBuffer(payload, delimBuf)) {
      payload = Buffer.concat([payload, delimBuf]);
    }
    return { delayMs, payload };
  }

  // Как в разделителях: \r \n \xFF внутри ответа → реальные байты
  let text = parseDelimiter(String(rule.response == null ? '' : rule.response));
  const textBuf = Buffer.from(text, 'binary');
  if (delimBuf.length && !endsWithBuffer(textBuf, delimBuf)) {
    return { delayMs, payload: Buffer.concat([textBuf, delimBuf]) };
  }
  return { delayMs, payload: textBuf };
}

module.exports = {
  parseDelimiter,
  normalizeHex,
  hexToBuffer,
  bufferToHex,
  formatPayload,
  findRule,
  findRuleInHexStream,
  matchesRule,
  buildResponse,
};
