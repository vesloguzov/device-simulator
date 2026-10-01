// Лог обмена.
//
// Хранится много (MAX_ENTRIES на устройство), а на экране — окно из
// нескольких сотен строк. Цена отрисовки растёт с числом строк на экране, а не
// в памяти: 2000 строк на экране уже дёргали окно на 130 мс при каждом опросе.
//
// Как ведёт себя окно:
// - смотришь вниз — новые строки дописываются пачкой раз за кадр, старые сверху
//   отрезаются, чтобы на экране оставалось WINDOW_LINES;
// - отмотал вверх — окно замирает: новые не дописываются, внизу появляется
//   кнопка «↓ N новых». Так чтение истории не мешает потоку, а поток — чтению;
// - долистал до края окна — подгружается следующая пачка из памяти, а то,
//   что было перед глазами, остаётся на месте.

import { MSG } from './messages.js';
import { els } from './elements.js';
import { setText } from './html.js';
import { state, selected } from './state.js';
import { loadSettings } from './app-settings.js';

/** Сколько записей помнить на устройство. */
const MAX_ENTRIES = 5000;

/**
 * Массив записей подрезаем не на каждой новой, а когда он вырос на столько —
 * иначе на потоке каждое сообщение сдвигало бы тысячи элементов.
 */
const TRIM_SLACK = 500;

/** Строк на экране, пока следишь за хвостом. */
const WINDOW_LINES = 500;

/** Сколько строк подгружать за раз, когда долистал до края окна. */
const CHUNK_LINES = 500;

/**
 * Предел строк на экране, пока листаешь историю. Дальше пачки с другого края
 * отрезаются — иначе на глубине в тысячи строк каждая подгрузка снова
 * становилась бы дорогой.
 */
const MAX_DOM_LINES = 1500;

/** Считаем, что человек «внизу», если до конца меньше строки. */
const STICK_PX = 24;

/** За сколько пикселей до края окна подгружать следующую пачку. */
const LOAD_PX = 300;

/**
 * Кадр в скрытом или свёрнутом окне не приходит вовсе. Чтобы лог не ждал,
 * пока окно покажут, есть запасной таймер — пачка всё равно одна.
 */
const FALLBACK_MS = 100;

// ── Хранение ─────────────────────────────────────────────

/**
 * Одинаковые строки храним одной копией. На опросе ответ и запрос у тысяч
 * записей совпадают до символа, а приходят по WebSocket каждый раз новой
 * строкой: у 91 панели с JSON-ответом это были бы сотни мегабайт копий.
 */
const pool = new Map();
const POOL_MAX = 5000;

function intern(value) {
  if (typeof value !== 'string' || !value) return value;
  const known = pool.get(value);
  if (known !== undefined) return known;
  if (pool.size >= POOL_MAX) pool.clear();
  pool.set(value, value);
  return value;
}

/** Поля, которые нужны логу. Остальное из сообщения не храним. */
const KEEP = ['ts', 'type', 'kind', 'message', 'payload', 'request', 'response',
  'note', 'commandNote', 'matched', 'ruleNote', 'ruleIndex'];

/** Сквозной номер записи: по нему окно знает, какой кусок истории показывает. */
let nextSeq = 1;

function compact(entry) {
  const out = { seq: nextSeq++ };
  for (const key of KEEP) {
    const value = entry[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = intern(value);
  }
  return out;
}

/** Первый индекс, у которого seq больше заданного (записи идут по возрастанию). */
function indexAfter(list, seq) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].seq <= seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Строки ───────────────────────────────────────────────

function shouldShowEntry(entry) {
  if (entry.type === 'status') return true;
  if (entry.kind === 'raw' || entry.kind === 'pending') return state.showRaw;
  return true;
}

function pad(n, w) {
  return String(n).padStart(w, '0');
}

function formatLogTime(entry, withMs) {
  const d = new Date(entry.ts || Date.now());
  const hms = pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  return withMs ? hms + '.' + pad(d.getMilliseconds(), 3) : hms;
}

// Направление читается из колонки-жёлоба теми же словами, что в правиле: RX и TX.
function formatLogText(entry) {
  if (entry.type === 'status') {
    return { cls: 'status', mark: '··', text: entry.message || '' };
  }

  if (entry.kind === 'raw') {
    return { cls: 'raw', mark: 'RX', text: entry.payload || '' };
  }

  if (entry.kind === 'pending') {
    return {
      cls: 'raw',
      mark: 'RX',
      text: MSG.buffer + ' ' + (entry.request || '') + (entry.note ? '  ' + entry.note : ''),
    };
  }

  if (entry.kind === 'command') {
    const label = entry.commandNote ? '«' + entry.commandNote + '»' : '«без имени»';
    return { cls: 'tx', mark: 'TX', text: MSG.sentCmd + ' ' + label };
  }

  if (entry.matched) {
    const ruleLabel = entry.ruleNote
      ? '«' + entry.ruleNote + '»'
      : '#' + ((entry.ruleIndex != null ? entry.ruleIndex : 0) + 1);
    return { cls: 'exchange', mark: 'TX', text: MSG.ruleFired + ' ' + ruleLabel };
  }

  return {
    cls: 'exchange fail',
    mark: '!',
    text: MSG.noRule + (entry.request ? '  ' + entry.request : ''),
  };
}

/** В RAW-режиме под записью показываем сами байты, ушедшие клиенту. */
function sentPayload(entry) {
  if (!state.showRaw) return '';
  if (entry.kind === 'command') return entry.payload || '';
  if (entry.kind === 'exchange' || entry.matched) return entry.response || '';
  return '';
}

/** Строки, в которые разворачивается запись: ни одной, одна или две. */
function linesOf(entry) {
  if (!shouldShowEntry(entry)) return [];
  const lines = [formatLogText(entry)];
  const sent = sentPayload(entry);
  if (sent) lines.push({ cls: 'raw', mark: 'TX', text: sent });
  return lines;
}

function lineNode(seq, time, line) {
  const node = document.createElement('div');
  node.className = 'line ' + line.cls;
  // по номеру записи окно понимает, какой кусок истории сейчас на экране
  node.dataset.seq = seq;

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = time;

  const d = document.createElement('span');
  d.className = 'd';
  d.textContent = line.mark;

  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = line.text;

  node.appendChild(t);
  node.appendChild(d);
  node.appendChild(v);
  return node;
}

/** Фрагмент из записей list[from..to) — все их строки по порядку. */
function fragmentOf(list, from, to) {
  const withMs = !!loadSettings().logMs;
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) {
    const entry = list[i];
    const lines = linesOf(entry);
    if (!lines.length) continue;
    const time = formatLogTime(entry, withMs);
    for (const line of lines) frag.appendChild(lineNode(entry.seq, time, line));
  }
  return frag;
}

/**
 * С какого индекса начать, чтобы записи до end дали около maxLines строк.
 * Идём от end назад и считаем строки — строить лишнее, чтобы выбросить, не нужно.
 */
function startForLines(list, end, maxLines) {
  let count = 0;
  let i = end;
  while (i > 0 && count < maxLines) {
    i -= 1;
    count += linesOf(list[i]).length;
  }
  return i;
}

/** Докуда дойти от start, чтобы набралось около maxLines строк. */
function endForLines(list, start, maxLines) {
  let count = 0;
  let i = start;
  while (i < list.length && count < maxLines) {
    count += linesOf(list[i]).length;
    i += 1;
  }
  return i;
}

// ── Окно ─────────────────────────────────────────────────

/** Какой кусок истории выбранного устройства сейчас на экране: seq включительно. */
let firstSeq = 0;
let lastSeq = 0;

/** Следим за хвостом или читаем историю. */
let following = true;

/** Сколько записей пришло, пока читал историю. */
let unseen = 0;

let pending = [];
let frame = 0;
let timer = 0;
let scrollFrame = 0;

function currentList() {
  const d = selected();
  return d ? state.logsByDevice[d.id] || [] : [];
}

function lineCount() {
  return els.log.childElementCount;
}

/**
 * Убрать строки сверху, пока их не станет keep, — целыми записями: у записи
 * в RAW две строки, и разрезать её между ними значило бы потерять заголовок.
 * Возвращает, на сколько пикселей укоротился лог сверху.
 */
function trimTop(keep) {
  const box = els.log;
  let excess = box.childElementCount - keep;
  if (excess <= 0) return 0;
  let end = box.children[excess];
  const lastRemoved = box.children[excess - 1].dataset.seq;
  while (end && end.dataset.seq === lastRemoved) end = end.nextElementSibling;
  const before = box.scrollHeight;
  const range = document.createRange();
  range.setStartBefore(box.firstElementChild);
  if (end) range.setEndBefore(end);
  else range.setEndAfter(box.lastElementChild);
  range.deleteContents();
  firstSeq = box.firstElementChild ? Number(box.firstElementChild.dataset.seq) : lastSeq + 1;
  return before - box.scrollHeight;
}

/** То же снизу. Нужно, только пока листаешь историю вверх. */
function trimBottom(keep) {
  const box = els.log;
  const excess = box.childElementCount - keep;
  if (excess <= 0) return;
  let start = box.children[box.childElementCount - excess];
  const firstRemoved = start.dataset.seq;
  while (start.previousElementSibling && start.previousElementSibling.dataset.seq === firstRemoved) {
    start = start.previousElementSibling;
  }
  const range = document.createRange();
  range.setStartBefore(start);
  range.setEndAfter(box.lastElementChild);
  range.deleteContents();
  lastSeq = box.lastElementChild ? Number(box.lastElementChild.dataset.seq) : firstSeq - 1;
}

function hasOlder(list) {
  return list.length > 0 && list[0].seq < firstSeq;
}

function hasNewer(list) {
  return list.length > 0 && list[list.length - 1].seq > lastSeq;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function updateBadge() {
  const badge = els.logNew;
  if (!badge) return;
  const show = !following && unseen > 0;
  badge.classList.toggle('hidden', !show);
  if (show) setText(badge, '↓ ' + unseen + ' ' + plural(unseen, 'новое', 'новых', 'новых'));
}

function cancelFlush() {
  if (frame) cancelAnimationFrame(frame);
  if (timer) clearTimeout(timer);
  frame = 0;
  timer = 0;
}

function flush() {
  cancelFlush();
  if (!pending.length) return;
  const batch = pending;
  pending = [];

  // Пока пачка ждала кадра, человек мог отмотать вверх, а обработчик прокрутки
  // ещё не успел это заметить. Проверяем по факту, до вставки: раскладка ещё
  // чистая, и чтение ничего не стоит. Иначе лог дёрнул бы читающего вниз.
  if (following && fromBottom(els.log) >= STICK_PX) following = false;

  if (!following) {
    for (const item of batch) if (linesOf(item).length) unseen += 1;
    updateBadge();
    return;
  }

  const box = els.log;
  const start = startForLines(batch, batch.length, WINDOW_LINES);
  if (start > 0) {
    // На потоке за кадр копятся тысячи записей. Прежние строки окна всё равно
    // уйдут — строим только хвост пачки, а не всё, чтобы тут же выбросить.
    box.textContent = '';
    box.appendChild(fragmentOf(batch, start, batch.length));
    firstSeq = batch[start].seq;
  } else {
    // Окно лишь растёт вниз: начало не трогаем, даже если строк в нём ещё не
    // было, — оно покрывает и записи без строк (сырые байты при выключенном RAW).
    box.appendChild(fragmentOf(batch, 0, batch.length));
    trimTop(WINDOW_LINES);
  }
  lastSeq = batch[batch.length - 1].seq;
  box.scrollTop = box.scrollHeight;
}

function scheduleFlush() {
  if (frame || timer) return;
  frame = requestAnimationFrame(flush);
  timer = setTimeout(flush, FALLBACK_MS);
}

/** Подгрузить пачку истории над окном; то, что было перед глазами, не двигаем. */
function loadOlder(list) {
  const box = els.log;
  const end = indexAfter(list, firstSeq - 1);
  const start = startForLines(list, end, CHUNK_LINES);
  if (start >= end) return;

  const before = box.scrollHeight;
  box.insertBefore(fragmentOf(list, start, end), box.firstElementChild);
  firstSeq = list[start].seq;
  box.scrollTop += box.scrollHeight - before;

  if (lineCount() > MAX_DOM_LINES) trimBottom(MAX_DOM_LINES);
}

/** Подгрузить пачку под окном — когда листаешь историю обратно к свежему. */
function loadNewer(list) {
  const box = els.log;
  const start = indexAfter(list, lastSeq);
  const end = endForLines(list, start, CHUNK_LINES);
  if (start >= end) return;

  box.appendChild(fragmentOf(list, start, end));
  lastSeq = list[end - 1].seq;

  if (lineCount() > MAX_DOM_LINES) box.scrollTop -= trimTop(MAX_DOM_LINES);
}

function fromBottom(box) {
  return box.scrollHeight - box.scrollTop - box.clientHeight;
}

function onScrollFrame() {
  const box = els.log;
  const list = currentList();

  // Сначала подгружаем, потом по фактическому положению решаем, где человек:
  // подгрузка сверху держит видимое на месте, и кто был внизу — там и остался.
  if (box.scrollTop < LOAD_PX && hasOlder(list)) loadOlder(list);
  else if (fromBottom(box) < LOAD_PX && hasNewer(list)) loadNewer(list);

  if (fromBottom(box) < STICK_PX && !hasNewer(list)) {
    // Вернулся к хвосту — снова следим за ним, а лишнюю историю сверху отпускаем.
    following = true;
    unseen = 0;
    if (lineCount() > WINDOW_LINES) {
      trimTop(WINDOW_LINES);
      box.scrollTop = box.scrollHeight;
    }
  } else {
    following = false;
  }
  updateBadge();
}

let scrollTimer = 0;

function runScroll() {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollFrame = 0;
  scrollTimer = 0;
  onScrollFrame();
}

/** Как и вывод строк: кадр, а если кадров нет (окно скрыто) — запасной таймер. */
function onScroll() {
  if (scrollFrame || scrollTimer) return;
  scrollFrame = requestAnimationFrame(runScroll);
  scrollTimer = setTimeout(runScroll, FALLBACK_MS);
}

// ── Снаружи ──────────────────────────────────────────────

/** Запомнить запись и, если она про открытое устройство, показать. */
export function pushLog(entry) {
  const id = entry.deviceId;
  if (!id) return;

  const item = compact(entry);
  let list = state.logsByDevice[id];
  if (!list) list = state.logsByDevice[id] = [];
  list.push(item);
  if (list.length > MAX_ENTRIES + TRIM_SLACK) list.splice(0, list.length - MAX_ENTRIES);

  if (id !== state.selectedId) return;

  if (!following) {
    // Считаем только то, что появится на экране: сырые байты при выключенном
    // RAW в кнопку «новых» не входят.
    if (linesOf(item).length) {
      unseen += 1;
      updateBadge();
    }
    return;
  }

  pending.push(item);
  // Пока окно не рисует, копить больше, чем покажем, незачем.
  if (pending.length > MAX_ENTRIES) pending.splice(0, pending.length - MAX_ENTRIES);
  scheduleFlush();
}

/** Показать хвост лога: смена устройства, очистка, переключение RAW, «↓ новые». */
export function renderLog() {
  cancelFlush();
  pending = [];
  following = true;
  unseen = 0;

  const box = els.log;
  box.textContent = '';
  updateBadge();

  const d = selected();
  if (!d) {
    setText(els.logTitle, MSG.log);
    const hint = document.createElement('p');
    hint.className = 'muted log-empty';
    hint.textContent = MSG.pickLog;
    box.appendChild(hint);
    firstSeq = 0;
    lastSeq = 0;
    return;
  }

  setText(els.logTitle, MSG.log + ' · ' + d.name);
  const list = state.logsByDevice[d.id] || [];
  const start = startForLines(list, list.length, WINDOW_LINES);
  box.appendChild(fragmentOf(list, start, list.length));
  firstSeq = start < list.length ? list[start].seq : nextSeq;
  lastSeq = list.length ? list[list.length - 1].seq : nextSeq - 1;
  box.scrollTop = box.scrollHeight;
}

export function clearLog() {
  const d = selected();
  if (d) state.logsByDevice[d.id] = [];
  renderLog();
}

/** Развесить прокрутку и кнопку «↓ новые» — один раз при загрузке страницы. */
export function initLogView() {
  els.log.addEventListener('scroll', onScroll, { passive: true });
  if (els.logNew) els.logNew.addEventListener('click', renderLog);
}
