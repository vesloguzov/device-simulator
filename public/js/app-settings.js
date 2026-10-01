// Настройки приложения: тема и точность времени в логе.
// Живут в localStorage и общие для всех проектов, поэтому и ключ один.

const STORAGE_KEY = 'deviceSim.settings';

/**
 * Темы. Добавить новую — значит дописать сюда строку и блок
 * [data-theme='<id>'] в styles.css; больше нигде ничего менять не нужно:
 * цвета системной шапки окно берёт из самой палитры.
 */
export const THEMES = [
  { id: 'dark', label: 'Тёмная' },
  { id: 'light', label: 'Светлая' },
  { id: 'vscode', label: 'VS Code' },
];

/**
 * Шрифты интерфейса. Как и с темами: новый — строка сюда и блок
 * [data-font='<id>'] в styles.css. Только системные шрифты: офлайн.
 */
export const FONTS = [
  { id: 'din-wide', label: 'DIN, обычный' },
  { id: 'din', label: 'DIN, сжатый' },
  { id: 'segoe', label: 'Segoe UI' },
];

const DEFAULT_THEME = 'dark';
const DEFAULT_FONT = 'din-wide';
const DEFAULTS = { theme: DEFAULT_THEME, font: DEFAULT_FONT, logMs: false };

function known(list, id, spare) {
  return list.some(function (x) { return x.id === id; }) ? id : spare;
}

function knownTheme(id) {
  return known(THEMES, id, DEFAULT_THEME);
}

function knownFont(id) {
  return known(FONTS, id, DEFAULT_FONT);
}

export function loadSettings() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {
    raw = null;
  }
  const settings = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
  settings.theme = knownTheme(settings.theme);
  settings.font = knownFont(settings.font);
  return settings;
}

export function applyTheme(settings) {
  const theme = knownTheme(settings && settings.theme);
  document.documentElement.setAttribute('data-theme', theme);
  // Окно перекрашивает свою шапку под палитру — цвета оно считает со стилей.
  if (window.electronShell) window.electronShell.setTheme(theme);
}

export function applyFont(settings) {
  document.documentElement.setAttribute('data-font', knownFont(settings && settings.font));
}

/** Всё, что влияет на вид. Разметку уже проставил инлайновый скрипт в <head>;
 *  здесь — повторно, после того как настройку поменяли. */
export function applyAppearance(settings) {
  applyTheme(settings);
  applyFont(settings);
}

export function saveSettings(partial) {
  const next = Object.assign(loadSettings(), partial || {});
  next.theme = knownTheme(next.theme);
  next.font = knownFont(next.font);
  next.logMs = !!next.logMs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyAppearance(next);
  return next;
}
