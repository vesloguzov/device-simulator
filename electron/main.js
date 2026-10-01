'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, Menu, ipcMain, nativeTheme } = require('electron');
const { startServer } = require('../server');
const { freePortIfBusy } = require('./free-port');

const PORT = Number(process.env.PORT) || 3920;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {{ stop: () => Promise<void>, url: string } | null} */
let runtime = null;
let quitting = false;
let recreating = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resolvePublicDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'public');
  }
  return path.join(__dirname, '..', 'public');
}

// Высота полосы заголовка окна. Должна совпадать с --titlebar-h в styles.css:
// страница рисует в ней своё имя окна, Windows — кнопки справа.
const TITLEBAR_H = 34;

function shellConfigPath() {
  return path.join(app.getPath('userData'), 'shell.json');
}

function readShellConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(shellConfigPath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeShellConfig(patch) {
  const next = Object.assign(readShellConfig(), patch);
  try {
    fs.mkdirSync(path.dirname(shellConfigPath()), { recursive: true });
    fs.writeFileSync(shellConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('Не удалось сохранить shell.json:', err.message);
  }
  return next;
}

function usesNativeTitleBar() {
  return !!readShellConfig().nativeTitleBar;
}

function resolveDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(resolvePublicDir(), 'favicon.ico'),
    path.join(resolvePublicDir(), 'favicon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function parentWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function restoreWindowFocus() {
  const win = parentWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.focus();
}

// Цвета системных кнопок окна приходят со страницы: она берёт их из
// применённой палитры (--bench и --ink-dim). Здесь лежит только запасной
// вариант на случай, когда своих цветов ещё нет — до первой загрузки страницы.
const SHELL_FALLBACK = {
  dark: { base: 'dark', color: '#0f1216', symbolColor: '#9aa4ae' },
  light: { base: 'light', color: '#eaedf1', symbolColor: '#57606a' },
};

const HEX = /^#[0-9a-f]{3,8}$/i;

function normalizeShellTheme(raw) {
  const base = raw && raw.base === 'light' ? 'light' : 'dark';
  const fallback = SHELL_FALLBACK[base];
  const pick = (value, spare) => (HEX.test(String(value)) ? String(value) : spare);
  return {
    base,
    color: pick(raw && raw.color, fallback.color),
    symbolColor: pick(raw && raw.symbolColor, fallback.symbolColor),
  };
}

/** Цвета шапки для только что создаваемого окна: те же, что были в прошлый раз. */
function savedShellTheme() {
  const saved = readShellConfig().shellTheme;
  if (saved) return normalizeShellTheme(saved);
  return SHELL_FALLBACK[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

function applyShellTheme(raw) {
  const theme = normalizeShellTheme(raw);
  nativeTheme.themeSource = theme.base;

  // Запоминаем, чтобы следующее окно открылось сразу в этих цветах,
  // а не мигнуло стандартными до загрузки страницы.
  const saved = readShellConfig().shellTheme;
  if (!saved || saved.color !== theme.color || saved.symbolColor !== theme.symbolColor) {
    writeShellConfig({ shellTheme: theme });
  }

  const win = parentWindow();
  if (!win || typeof win.setTitleBarOverlay !== 'function') return;
  try {
    win.setTitleBarOverlay({ color: theme.color, symbolColor: theme.symbolColor });
  } catch (_) {
    // окно создано без наложения — не наша забота
  }
}

function installThemeHandler() {
  nativeTheme.themeSource = savedShellTheme().base;
  ipcMain.on('theme:set', (_event, theme) => applyShellTheme(theme));
}

/**
 * titleBarStyle задаётся только при создании окна, менять на лету нельзя.
 * Поэтому пересоздаём окно, сохранив адрес страницы и геометрию.
 */
async function recreateWindow() {
  const old = parentWindow();
  if (!old) return;

  const url = old.webContents.getURL();
  const bounds = old.getBounds();
  const maximized = old.isMaximized();

  recreating = true;
  mainWindow = null;
  old.destroy();

  try {
    await createWindow(url, { bounds: maximized ? null : bounds, maximized });
  } finally {
    recreating = false;
  }
}

function installShellHandlers() {
  ipcMain.on('shell:titlebar:get', (event) => {
    event.returnValue = usesNativeTitleBar();
  });

  ipcMain.on('shell:titlebar:set', (event, native) => {
    const changed = usesNativeTitleBar() !== !!native;
    writeShellConfig({ nativeTitleBar: !!native });
    event.returnValue = true;
    if (changed) recreateWindow().catch((err) => console.error(err));
  });
}

function installDialogHandlers() {
  ipcMain.on('dialog:alert', (event, message) => {
    dialog.showMessageBoxSync(parentWindow(), {
      type: 'info',
      title: 'Device Simulator',
      message: String(message == null ? '' : message),
      buttons: ['OK'],
      noLink: true,
    });
    event.returnValue = true;
    restoreWindowFocus();
  });

  ipcMain.on('dialog:confirm', (event, message) => {
    const result = dialog.showMessageBoxSync(parentWindow(), {
      type: 'question',
      title: 'Device Simulator',
      message: String(message == null ? '' : message),
      buttons: ['OK', 'Отмена'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    event.returnValue = result === 0;
    restoreWindowFocus();
  });
}

function installAppMenu() {
  // Полное удаление меню на Windows ломает Edit-роли и иногда ввод в полях.
  // Оставляем скрытое меню с базовыми ролями (копировать/вставить и т.д.).
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(url, restore) {
  const winOpts = {
    width: 1280,
    height: 840,
    // Не уже рабочего экрана проекта (--layout-min в styles.css) плюс рамка:
    // иначе окно можно сжать так, что колонки уедут под горизонтальную прокрутку.
    minWidth: 1010,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // без этого при загрузке мигает белым; берём фон выбранной палитры,
    // чтобы не мигало и чужим тёмным
    backgroundColor: savedShellTheme().color,
    title: 'Симулятор TCP/UDP устройств',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (!usesNativeTitleBar()) {
    // Системная полоса прячется, остаются только кнопки окна поверх страницы:
    // роль шапки берёт на себя заголовок приложения. Рамка и системное
    // изменение размера сохраняются — это не frame: false.
    winOpts.titleBarStyle = 'hidden';
    const shell = savedShellTheme();
    winOpts.titleBarOverlay = {
      height: TITLEBAR_H,
      color: shell.color,
      symbolColor: shell.symbolColor,
    };
  }

  const icon = resolveAppIcon();
  if (icon) winOpts.icon = icon;
  if (restore && restore.bounds) Object.assign(winOpts, restore.bounds);

  mainWindow = new BrowserWindow(winOpts);
  if (restore && restore.maximized) mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    restoreWindowFocus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(url);
}

async function startServerWithPortRecovery(options) {
  await freePortIfBusy(PORT);
  try {
    return await startServer(options);
  } catch (err) {
    if (!err || err.code !== 'EADDRINUSE') throw err;
    await freePortIfBusy(PORT);
    return await startServer(options);
  }
}

async function boot() {
  const publicDir = resolvePublicDir();
  const dataDir = resolveDataDir();

  try {
    runtime = await startServerWithPortRecovery({
      port: PORT,
      host: '0.0.0.0',
      publicDir,
      dataDir,
    });
  } catch (err) {
    const message =
      err && err.code === 'EADDRINUSE'
        ? `Порт ${PORT} уже занят. Закрой другой симулятор или задай PORT.`
        : err && err.message
          ? err.message
          : String(err);
    await dialog.showErrorBox('Device Simulator', message);
    app.quit();
    return;
  }

  await createWindow(runtime.url + '/projects');
}

if (gotTheLock) {
  app.whenReady().then(() => {
    installAppMenu();
    installThemeHandler();
    installShellHandlers();
    installDialogHandlers();
    boot().catch(async (err) => {
      await dialog.showErrorBox('Device Simulator', err.message || String(err));
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    // окно пересоздаётся при смене вида шапки — это не выход из программы
    if (recreating) return;
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting || !runtime) return;
    event.preventDefault();
    quitting = true;

    // Крайний срок: что бы ни случилось с остановкой, процесс обязан умереть,
    // иначе порт 3920 и порты устройств останутся занятыми до перезагрузки.
    const deadline = setTimeout(() => app.exit(0), 3000);

    runtime
      .stop()
      .catch(() => {})
      .finally(() => {
        clearTimeout(deadline);
        runtime = null;
        app.exit(0);
      });
  });
}
