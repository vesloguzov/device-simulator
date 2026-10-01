'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronDialog', {
  alertSync(message) {
    ipcRenderer.sendSync('dialog:alert', String(message == null ? '' : message));
  },
  confirmSync(message) {
    return !!ipcRenderer.sendSync('dialog:confirm', String(message == null ? '' : message));
  },
});

contextBridge.exposeInMainWorld('electronShell', {
  /**
   * Тема окна: Windows красит системную шапку по ней.
   *
   * Цвета берём прямо из применённой палитры, а не из списка в main.js —
   * иначе каждая новая тема требовала бы второй, руками синхронизируемой
   * копии тех же значений. Светлая тема от тёмной отличается по color-scheme,
   * который в styles.css и так объявлен у каждой палитры.
   */
  setTheme(theme) {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => String(style.getPropertyValue(name) || '').trim();
    ipcRenderer.send('theme:set', {
      name: String(theme || ''),
      base: read('color-scheme') === 'light' ? 'light' : 'dark',
      color: read('--bench'),
      symbolColor: read('--ink-dim'),
    });
  },
  // Вид шапки читаем синхронно: разметке он нужен до первой отрисовки
  nativeTitleBar: !!ipcRenderer.sendSync('shell:titlebar:get'),
  setNativeTitleBar(value) {
    ipcRenderer.sendSync('shell:titlebar:set', !!value);
  },
});
