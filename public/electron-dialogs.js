(function () {
  if (window.electronDialog) {
    window.alert = function (message) {
      window.electronDialog.alertSync(message);
    };
    window.confirm = function (message) {
      return window.electronDialog.confirmSync(message);
    };
  }

  if (!window.electronShell) return;

  // Тему страницы уже проставил инлайновый скрипт в <head> — сообщаем её окну,
  // чтобы системная шапка была той же, что и приложение. Имя отдаём как есть:
  // конкретные цвета окно считает со стилей само.
  window.electronShell.setTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  // Своя полоса заголовка нужна только когда системная спрятана.
  document.documentElement.setAttribute(
    'data-titlebar',
    window.electronShell.nativeTitleBar ? 'native' : 'custom'
  );

  // Имя окна в полосе держим тем же, что и в document.title
  window.syncTitlebarText = function () {
    const el = document.getElementById('titlebarText');
    if (el) el.textContent = document.title;
  };
  window.syncTitlebarText();
})();
