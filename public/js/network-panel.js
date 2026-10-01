// Колонка с адресами компьютера на странице проектов.
//
// Смысл — не искать адрес в ipconfig, когда настраиваешь панель. «Главный»
// адрес не угадывается (при VPN маршрут в интернет и локальная сеть — разные
// интерфейсы), поэтому показываем все и помечаем: виртуальные — чтобы увести
// взгляд, проверенные — чтобы к нему привести.

import { api } from './http.js';
import { setText, setTitle, fromTemplate, orderChildren } from './html.js';

const REFRESH_MS = 10000;

const TEMPLATE =
  '<button type="button" class="net-row" title="Скопировать адрес">' +
    '<span class="net-addr"></span>' +
    '<span class="net-iface"></span>' +
    '<span class="net-tag"></span>' +
  '</button>';

const REACHED_HINT = {
  client: 'По этому адресу к симулятору уже подключался клиент',
  ui: 'По этому адресу открывали интерфейс с другого компьютера',
};

/**
 * Копирование без буфера обмена: по локальной сети страница открыта по http,
 * а там navigator.clipboard недоступен — контекст незащищённый.
 */
function copyFallback(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_) {
    ok = false;
  }
  area.remove();
  return ok;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // разрешения нет — пробуем по-старому
    }
  }
  return copyFallback(text);
}

function createRow(onCopy) {
  const el = fromTemplate(TEMPLATE);
  const addr = el.querySelector('.net-addr');
  const iface = el.querySelector('.net-iface');
  const tag = el.querySelector('.net-tag');

  let item = null;

  el.addEventListener('click', function () {
    if (item) onCopy(item.address, el);
  });

  return {
    el: el,
    bind: function (next) {
      item = next;
      setText(addr, next.address);
      setText(iface, next.iface);

      el.classList.toggle('net-row-virtual', next.virtual);
      el.classList.toggle('net-row-reached', !!next.reached);

      if (next.reached) {
        setText(tag, 'проверен');
        tag.className = 'net-tag net-tag-live';
        setTitle(el, REACHED_HINT[next.reached.source] || 'Адрес проверен');
      } else if (next.linkLocal) {
        setText(tag, 'без сети');
        tag.className = 'net-tag';
        setTitle(el, 'Адрес 169.254.x назначается, когда не отвечает DHCP');
      } else if (next.virtual) {
        setText(tag, 'виртуальный');
        tag.className = 'net-tag';
        setTitle(el, 'Адаптер VPN или виртуальной машины — панель сюда вряд ли достучится');
      } else {
        setText(tag, '');
        tag.className = 'net-tag';
        setTitle(el, 'Скопировать адрес');
      }
    },
    detach: function () {
      el.remove();
    },
  };
}

export function initNetworkPanel() {
  const container = document.getElementById('networkList');
  const note = document.getElementById('networkNote');
  if (!container) return;

  const rows = [];
  const defaultNote = note ? note.textContent : '';
  let noteTimer = null;

  function flash(message) {
    if (!note) return;
    clearTimeout(noteTimer);
    setText(note, message);
    note.classList.add('net-note-flash');
    noteTimer = setTimeout(function () {
      note.classList.remove('net-note-flash');
      setText(note, defaultNote);
    }, 1600);
  }

  function onCopy(address) {
    copyText(address).then(function (ok) {
      flash(ok ? address + ' — скопировано' : 'Скопировать не удалось, выдели вручную');
    });
  }

  function render(addresses) {
    if (!addresses.length) {
      while (rows.length) rows.pop().detach();
      setText(container, 'Сетевых адресов не найдено');
      container.classList.add('muted');
      return;
    }

    container.classList.remove('muted');
    if (!rows.length) container.textContent = '';

    for (let i = 0; i < addresses.length; i++) {
      if (!rows[i]) {
        rows[i] = createRow(onCopy);
        container.appendChild(rows[i].el);
      }
      rows[i].bind(addresses[i]);
    }
    while (rows.length > addresses.length) rows.pop().detach();

    orderChildren(container, rows.map(function (r) { return r.el; }));
  }

  function refresh() {
    return api('/api/network')
      .then(function (data) { render(data.addresses || []); })
      .catch(function () {});
  }

  // Адреса меняются сами: переподключение Wi-Fi, поднятый VPN. И пометка
  // «проверен» появляется в момент, когда панель впервые достучалась.
  setInterval(function () {
    if (document.visibilityState === 'visible') refresh();
  }, REFRESH_MS);

  window.addEventListener('focus', refresh);

  return refresh();
}
