// Каркас рабочего экрана: ширины колонок, сворачивание блоков, заголовок.
// Ничего не знает про устройства — только про геометрию и подписи.

import { MSG } from './messages.js';
import { els } from './elements.js';
import { setText, setTitle, setDisabled, setClass } from './html.js';
import { state } from './state.js';
import { PROJECT_SLUG } from './api.js';
import { updateSettingsSummary } from './settings-form.js';

// Пределы перетаскивания сплиттеров. Нижние границы совпадают с расчётом
// --layout-min в styles.css: уже них колонки не сжимаются.
const COL_DEVICES = { min: 250, max: 480 };
const COL_LOG = { min: 300, max: 900 };
const COL_DEVICES_COLLAPSED = 52;

const SECTIONS = {
  settings: { block: 'settingsBlock', button: 'btnToggleSettings', flag: 'settingsCollapsed', store: 'settingsCollapsed' },
  rules: { block: 'rulesBlock', button: 'btnToggleRules', flag: 'rulesCollapsed', store: 'rulesCollapsed' },
  commands: { block: 'commandsBlock', button: 'btnToggleCommands', flag: 'commandsCollapsed', store: 'commandsCollapsed' },
};

// Шеврон — svg, его поворачивает CSS по классу collapsed.
function applySection(name) {
  const section = SECTIONS[name];
  const block = document.getElementById(section.block);
  if (!block) return;
  setClass(block, 'collapsed', state[section.flag]);
  if (name === 'settings') updateSettingsSummary();
}

export function applyColumnWidths() {
  const devicesW = state.devicesCollapsed ? COL_DEVICES_COLLAPSED : state.colDevices;
  els.layout.style.setProperty('--col-devices', devicesW + 'px');
  els.layout.style.setProperty('--col-log', state.colLog + 'px');
}

export function applyDevicesCollapsed() {
  setClass(els.layout, 'devices-collapsed', state.devicesCollapsed);
  setTitle(els.btnToggleDevices, state.devicesCollapsed ? MSG.expand : MSG.collapse);
  applyColumnWidths();
}

function initSplitters() {
  function bind(el, which) {
    if (!el) return;
    el.addEventListener('mousedown', function (e) {
      if (which === 'devices' && state.devicesCollapsed) return;
      e.preventDefault();
      const startX = e.clientX;
      const startDevices = state.colDevices;
      const startLog = state.colLog;
      el.classList.add('dragging');
      document.body.classList.add('resizing');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        if (which === 'devices') {
          state.colDevices = Math.min(COL_DEVICES.max, Math.max(COL_DEVICES.min, startDevices + dx));
        } else {
          state.colLog = Math.min(COL_LOG.max, Math.max(COL_LOG.min, startLog - dx));
        }
        applyColumnWidths();
      }

      function onUp() {
        el.classList.remove('dragging');
        document.body.classList.remove('resizing');
        localStorage.setItem('colDevices', String(state.colDevices));
        localStorage.setItem('colLog', String(state.colLog));
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  bind(document.getElementById('splitDevices'), 'devices');
  bind(document.getElementById('splitLog'), 'log');
}

/** Кнопки «Запустить все» / «Остановить все» зависят от всего списка сразу. */
export function updateRunAllButtons() {
  if (!els.btnStartAll || !els.btnStopAll) return;
  const any = state.devices.length > 0;
  const anyRunning = state.devices.some(function (d) { return d.running; });
  const anyStopped = state.devices.some(function (d) { return !d.running; });
  setDisabled(els.btnStartAll, !any || !anyStopped);
  setDisabled(els.btnStopAll, !anyRunning);
}

export function updateRunButton(d) {
  if (!d) return;
  setText(els.btnToggleRun, d.running ? MSG.run : MSG.start);
  els.btnToggleRun.className = 'btn ' + (d.running ? 'btn-run-on' : 'btn-run-off');
}

export function applyProjectTitle() {
  const title = document.getElementById('pageTitle');
  if (!title) return;
  const name = (state.project && state.project.name) || PROJECT_SLUG;
  setText(title, name);
  document.title = name + ' — ' + MSG.simPrefix;
  if (window.syncTitlebarText) window.syncTitlebarText();

  const hint = document.getElementById('pageHint');
  const description = state.project && state.project.description;
  if (hint) setText(hint, description ? description : MSG.defaultHint);
}

/** Развесить переключатели блоков и сплиттеры, применить сохранённое состояние. */
export function initWorkspace() {
  els.btnToggleDevices.addEventListener('click', function () {
    state.devicesCollapsed = !state.devicesCollapsed;
    localStorage.setItem('devicesCollapsed', state.devicesCollapsed ? '1' : '0');
    applyDevicesCollapsed();
  });

  Object.keys(SECTIONS).forEach(function (name) {
    const section = SECTIONS[name];
    const button = document.getElementById(section.button);
    if (button) {
      button.addEventListener('click', function () {
        state[section.flag] = !state[section.flag];
        localStorage.setItem(section.store, state[section.flag] ? '1' : '0');
        applySection(name);
      });
    }
    applySection(name);
  });

  applyDevicesCollapsed();
  initSplitters();
}
