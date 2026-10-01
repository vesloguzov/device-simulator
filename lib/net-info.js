'use strict';

const os = require('os');

/**
 * Адреса компьютера — чтобы не искать их в ipconfig, когда настраиваешь панель.
 *
 * Определить «главный» адрес автоматически нельзя: маршрут по умолчанию ведёт
 * в интернет, а панели нужна локальная сеть, и при поднятом VPN это разные
 * интерфейсы. Поэтому показываем все, помечаем заведомо виртуальные — и
 * отдельно отмечаем те, по которым до нас реально достучались: это уже не
 * догадка, а факт.
 */

// Имена виртуальных адаптеров. Список неполный по определению, поэтому
// основной признак — нулевой MAC, а имя лишь дополняет его.
const VIRTUAL_NAME = /virtual|vethernet|hyper-?v|virtualbox|vmware|vpn|tap-?windows|tunnel|wsl|docker|xray|wintun|tailscale|zerotier|radmin|bluetooth|loopback/i;

const ZERO_MAC = '00:00:00:00:00:00';

/** Адреса, засветившиеся как «наш конец» входящего соединения. */
const reached = new Map();

const LOOPBACK = '127.0.0.1';

/** IPv4 из того, что отдал Node: у сокета адрес бывает в виде ::ffff:10.0.0.1 */
function toIPv4(raw) {
  if (!raw) return null;
  const addr = String(raw).replace(/^::ffff:/i, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(addr) ? addr : null;
}

/**
 * Запомнить адрес, на который к нам пришло соединение.
 * @param {string} raw локальный конец сокета
 * @param {'client' | 'ui'} source кто пришёл: клиент устройства или браузер
 */
function noteLocalAddress(raw, source) {
  const address = toIPv4(raw);
  if (!address || address === LOOPBACK) return;
  reached.set(address, { source, at: Date.now() });
}

function classify(name, info) {
  const linkLocal = info.address.startsWith('169.254.');
  const virtual = info.mac === ZERO_MAC || VIRTUAL_NAME.test(name);
  return { virtual, linkLocal };
}

/**
 * Порядок осмысленный, а не алфавитный: сверху то, что вероятнее нужно.
 * Подтверждённый адрес всегда первый — он единственный проверенный.
 */
function rank(item) {
  if (item.reached) return 0;
  if (item.virtual) return 3;
  if (item.linkLocal) return 2;
  return 1;
}

/**
 * @returns {Array<{ iface: string, address: string, mac: string,
 *                   virtual: boolean, linkLocal: boolean,
 *                   reached: { source: string, at: number } | null }>}
 */
function listAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();

  for (const [iface, list] of Object.entries(interfaces)) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal) continue;
      const { virtual, linkLocal } = classify(iface, info);
      out.push({
        iface,
        address: info.address,
        mac: info.mac,
        virtual,
        linkLocal,
        reached: reached.get(info.address) || null,
      });
    }
  }

  out.sort((a, b) => rank(a) - rank(b) || a.iface.localeCompare(b.iface));
  return out;
}

module.exports = { listAddresses, noteLocalAddress, toIPv4 };
