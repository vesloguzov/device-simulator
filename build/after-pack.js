'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Чистка распакованной сборки перед упаковкой в exe.
 * Всё удаляемое относится к Chromium, а не к приложению.
 */

// Локали интерфейса Chromium (~42 МБ на 55 файлов). Своя локализация у нас в HTML,
// от Chromium нужны только системные строки контекстного меню и диалогов.
const KEEP_LOCALES = new Set(['en-US.pak', 'ru.pak']);

// Компилятор шейдеров DirectX. Нужен Dawn/WebGPU; приложение — обычный DOM без 3D.
// Если после обновления Electron что-то начнёт падать на старте — убери отсюда.
const DROP_FILES = ['dxcompiler.dll', 'dxil.dll'];

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch (_) {
    return 0;
  }
}

function drop(file) {
  const size = sizeOf(file);
  if (!size) return 0;
  fs.rmSync(file, { force: true });
  return size;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const out = context.appOutDir;
  let freed = 0;

  const localesDir = path.join(out, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const name of fs.readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(name)) continue;
      freed += drop(path.join(localesDir, name));
    }
  }

  for (const name of DROP_FILES) {
    freed += drop(path.join(out, name));
  }

  console.log(`  • after-pack: освобождено ${(freed / 1024 / 1024).toFixed(1)} МБ`);
};
