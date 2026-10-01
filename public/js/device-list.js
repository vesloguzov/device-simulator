// Левая колонка со списком устройств.
//
// Строки сопоставляются по id устройства и переживают обновление: пакет
// «клиент подключился» меняет у строки только лампочку и счётчик подключений,
// а не пересобирает колонку целиком. Благодаря этому и открытое меню строки
// больше не слетает само собой.

import { MSG } from './messages.js';
import { ICONS } from './icons.js';
import { els } from './elements.js';
import { setText, setDisabled, setTitle, setClass, fromTemplate, orderChildren } from './html.js';
import { isDragging, createSortable } from './drag.js';

const TEMPLATE =
  '<div class="device-item-wrap">' +
    '<button type="button" class="device-handle">' + ICONS.grip + '</button>' +
    '<button type="button" class="device-item">' +
      '<div class="name-row">' +
        '<span class="led"></span>' +
        '<span class="device-name"></span>' +
      '</div>' +
      '<div class="device-meta"></div>' +
    '</button>' +
    '<button type="button" class="device-menu-btn" title="' + MSG.deviceMenu + '">' + ICONS.gear + '</button>' +
  '</div>';

function metaLine(d) {
  const enc = d.encoding === 'hex' ? 'HEX' : MSG.textEnc;
  return d.protocol.toUpperCase() + ' · ' + enc + ' · :' + d.port +
    (d.running && d.protocol === 'tcp' ? ' · ' + MSG.clients + ': ' + d.clients : '');
}

function createRow(host) {
  const el = fromTemplate(TEMPLATE);
  const handle = el.querySelector('.device-handle');
  const item = el.querySelector('.device-item');
  const led = el.querySelector('.led');
  const name = el.querySelector('.device-name');
  const meta = el.querySelector('.device-meta');
  const menuBtn = el.querySelector('.device-menu-btn');

  let device = null;

  // Нажатие на ручку перетаскивания не должно выбирать устройство.
  handle.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  item.addEventListener('click', function () {
    if (device) host.onSelect(device);
  });

  menuBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (device) host.onMenu(device, menuBtn);
  });

  return {
    el: el,
    bind: function (next, opts) {
      device = next;
      el.dataset.id = next.id;
      menuBtn.dataset.id = next.id;
      setClass(el, 'active', opts.active);
      setClass(led, 'led-on', next.running);
      setText(name, next.name);
      setText(meta, metaLine(next));
      setTitle(item, next.name + (next.running ? MSG.running : MSG.stopped));
      // Sortable переставляет по индексам в state.devices, а при фильтре
      // индексы в DOM им не соответствуют — поэтому перетаскивание выключено.
      setDisabled(handle, opts.filtering);
      setTitle(handle, opts.filtering ? MSG.dragOffWhileSearch : MSG.dragDevice);
    },
    detach: function () {
      el.remove();
    },
  };
}

export function createDeviceList(host) {
  const container = els.deviceList;
  /** @type {Map<string, ReturnType<typeof createRow>>} */
  const rows = new Map();

  const empty = document.createElement('p');
  empty.className = 'muted';

  const sortable = createSortable(container, {
    prefix: 'device',
    draggable: '.device-item-wrap',
    onStart: host.onDragStart,
    onEnd: host.onReorder,
  });

  return {
    sync: function (devices, opts) {
      if (isDragging()) return;

      const filter = opts.filter.trim().toLowerCase();
      const visible = filter
        ? devices.filter(function (d) {
            return String(d.name || '').toLowerCase().includes(filter);
          })
        : devices;

      // Считаем видимые строки: при поиске ручки и так выключены и объясняют
      // почему подсказкой, но у единственной найденной объяснять нечего.
      container.classList.toggle('drag-single', visible.length < 2);

      if (!visible.length) {
        rows.forEach(function (row) { row.detach(); });
        rows.clear();
        empty.textContent = filter ? MSG.noMatches : MSG.noDevices;
        if (empty.parentNode !== container) container.appendChild(empty);
        sortable.setEnabled(false);
        return;
      }

      empty.remove();

      const alive = new Set();
      visible.forEach(function (d) {
        alive.add(d.id);
        let row = rows.get(d.id);
        if (!row) {
          row = createRow(host);
          rows.set(d.id, row);
          container.appendChild(row.el);
        }
        row.bind(d, { active: d.id === opts.selectedId, filtering: !!filter });
      });

      rows.forEach(function (row, id) {
        if (alive.has(id)) return;
        row.detach();
        rows.delete(id);
      });

      orderChildren(container, visible.map(function (d) { return rows.get(d.id).el; }));
      sortable.setEnabled(!filter && devices.length > 1);
    },
  };
}
