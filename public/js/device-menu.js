// Меню устройства («Скопировать» / «Удалить») — один поповер на всё приложение,
// живущий в <body>.
//
// В самом списке он обрезался бы: там overflow:auto и position:sticky, то есть
// свой контекст наложения. Вынесенный в body поповер переживает и обновление
// списка — раньше меню закрывалось само, стоило клиенту подключиться.

import { MSG } from './messages.js';
import { els } from './elements.js';

export function createDeviceMenu(host) {
  const pop = document.createElement('div');
  pop.className = 'device-menu-pop';
  pop.setAttribute('role', 'menu');
  pop.innerHTML =
    '<button type="button" class="device-menu-item" data-act="copy">' + MSG.copyDevice + '</button>' +
    '<button type="button" class="device-menu-item device-menu-danger" data-act="del">' + MSG.delDeviceShort + '</button>';
  document.body.appendChild(pop);

  let currentId = null;
  let anchorBtn = null;

  // клик внутри меню не должен долетать до document и закрывать его
  pop.addEventListener('click', function (e) { e.stopPropagation(); });

  function act(handler) {
    return function () {
      const device = host.getDevice(currentId);
      close();
      if (device) handler(device);
    };
  }

  pop.querySelector('[data-act="copy"]').addEventListener('click', act(host.onCopy));
  pop.querySelector('[data-act="del"]').addEventListener('click', act(host.onDelete));

  function place(btn) {
    pop.style.visibility = 'hidden';
    pop.style.left = '0px';
    pop.style.top = '0px';

    const anchor = btn.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const gap = 6;
    const edge = 8;

    let left = anchor.right + gap;
    if (left + box.width > window.innerWidth - edge) left = anchor.left - gap - box.width;
    if (left < edge) left = Math.max(edge, window.innerWidth - box.width - edge);

    let top = anchor.top;
    if (top + box.height > window.innerHeight - edge) top = window.innerHeight - box.height - edge;
    if (top < edge) top = edge;

    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
    pop.style.visibility = '';
  }

  function open(id, btn) {
    if (anchorBtn) anchorBtn.classList.remove('open');
    currentId = id;
    anchorBtn = btn;
    btn.classList.add('open');
    pop.classList.add('open');
    place(btn);
  }

  function close() {
    if (anchorBtn) anchorBtn.classList.remove('open');
    currentId = null;
    anchorBtn = null;
    pop.classList.remove('open');
  }

  function isOpen(id) {
    if (currentId === null) return false;
    return id === undefined || currentId === id;
  }

  /**
   * Строки списка теперь переживают обновление, и кнопка-якорь остаётся той же.
   * Проверяем только, не исчезло ли устройство совсем — тогда закрываем.
   */
  function verify() {
    if (currentId === null) return;
    if (!anchorBtn || !anchorBtn.isConnected || !els.deviceList.contains(anchorBtn)) close();
  }

  return { open: open, close: close, isOpen: isOpen, verify: verify };
}
