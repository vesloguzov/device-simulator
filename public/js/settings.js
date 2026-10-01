// Страница настроек приложения.

import { loadSettings, saveSettings, applyAppearance } from './app-settings.js';

applyAppearance(loadSettings());

const settings = loadSettings();

/** Группа переключателей, отвечающая за одну настройку. */
function bindRadioGroup(key) {
  document.querySelectorAll('input[name="' + key + '"]').forEach(function (input) {
    input.checked = input.value === settings[key];
    input.addEventListener('change', function () {
      if (input.checked) saveSettings({ [key]: input.value });
    });
  });
}

bindRadioGroup('theme');
bindRadioGroup('font');

const chkLogMs = document.getElementById('chkLogMs');
if (chkLogMs) {
  chkLogMs.checked = !!settings.logMs;
  chkLogMs.addEventListener('change', function () {
    saveSettings({ logMs: chkLogMs.checked });
  });
}

// Раздел про окно имеет смысл только в приложении: в браузере шапки нет.
const shellSection = document.getElementById('shellSection');
const chkNative = document.getElementById('chkNativeTitleBar');
if (window.electronShell && shellSection && chkNative) {
  shellSection.classList.remove('hidden');
  chkNative.checked = !!window.electronShell.nativeTitleBar;
  chkNative.addEventListener('change', function () {
    // Окно пересоздаётся: вид шапки задаётся только при его создании.
    window.electronShell.setNativeTitleBar(chkNative.checked);
  });
}
