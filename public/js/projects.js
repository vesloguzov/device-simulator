// Страница списка проектов.

import { api, post, put, del } from './http.js';
import { escapeHtml, setText, downloadJson, readJsonFile } from './html.js';
import { openPickDialog } from './pick-dialog.js';
import { initNetworkPanel } from './network-panel.js';

const ICONS = {
  rename:
    '<svg class="project-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash:
    '<svg class="project-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  // ящик со стрелкой внутрь — в архив
  archive:
    '<svg class="project-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8"/><path d="M12 11v6"/><path d="m9 14 3 3 3-3"/></svg>',
  // тот же ящик со стрелкой наружу — вернуть
  unarchive:
    '<svg class="project-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8"/><path d="M12 17v-6"/><path d="m9 14 3-3 3 3"/></svg>',
  // стрелка вниз в лоток — скачать файл
  download:
    '<svg class="project-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
};

const TAB_STORAGE_KEY = 'projectsTab';

const listEl = document.getElementById('projectList');
const createDialog = document.getElementById('createDialog');
const createForm = document.getElementById('createForm');
const renameDialog = document.getElementById('renameDialog');
const renameForm = document.getElementById('renameForm');

let projectsCache = [];

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function clockOf(d) {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function dayOf(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Короткая дата для карточки: свежее интересно с точностью до минут, старое — нет. */
function shortDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';

  const today = dayOf(new Date());
  const that = dayOf(d);
  if (that === today) return 'сегодня, ' + clockOf(d);
  if (that === today - DAY_MS) return 'вчера, ' + clockOf(d);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/** Полная дата — для подсказки, где место не жмёт. */
function fullDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' ' + clockOf(d);
}

function datesTitle(p) {
  const lines = [];
  if (p.createdAt) lines.push('Создан: ' + fullDate(p.createdAt));
  if (p.updatedAt) lines.push('Изменён: ' + fullDate(p.updatedAt));
  return lines.join('\n');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function statChips(s) {
  if (!s) return '';
  const chips = [];

  chips.push(
    '<span class="stat">' + s.devices + ' ' +
    plural(s.devices, 'устройство', 'устройства', 'устройств') + '</span>'
  );

  if (s.running) {
    chips.push('<span class="stat stat-on">' + s.running + ' запущено</span>');
  }

  if (s.clients) {
    chips.push(
      '<span class="stat stat-on">' + s.clients + ' ' +
      plural(s.clients, 'клиент', 'клиента', 'клиентов') + '</span>'
    );
  }

  if (s.portMin != null) {
    chips.push(
      '<span class="stat">' +
      (s.portMin === s.portMax ? 'порт ' + s.portMin : 'порты ' + s.portMin + '–' + s.portMax) +
      '</span>'
    );
  }

  return chips.join('');
}

/** Дата изменения — такой же чип, как остальные сведения о проекте. */
function dateChip(p) {
  const text = shortDate(p.updatedAt);
  if (!text) return '';
  return '<span class="stat stat-date" title="' + escapeHtml(datesTitle(p)) + '">' +
    'изменён ' + escapeHtml(text) + '</span>';
}

/** У архивного проекта рядом с датой изменения — с какого дня он в архиве. */
function archivedChip(p) {
  if (!p.archivedAt) return '';
  return '<span class="stat stat-archived" title="В архиве с ' + escapeHtml(fullDate(p.archivedAt)) + '">' +
    'в архиве с ' + escapeHtml(shortDate(p.archivedAt)) + '</span>';
}

// ── Экспорт ──────────────────────────────────────────────

/** Метка времени для имени файла: без двоеточий — Windows их в именах не пускает. */
function fileStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * Один проект — сразу в файл, без окна выбора. Формат тот же, что у общего
 * экспорта, поэтому файл берёт обычный «Импорт». В имени — адрес проекта:
 * по нему файл потом легко узнать среди загрузок.
 */
async function exportOne(p) {
  try {
    const payload = await post('/api/projects/export', { ids: [p.id] });
    downloadJson('device-simulator-' + p.slug + '-' + fileStamp() + '.json', payload);
  } catch (err) {
    alert(err.message);
  }
}

// ── Архив ────────────────────────────────────────────────

function loadTab() {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === 'archive' ? 'archive' : 'current';
  } catch (_) {
    return 'current';
  }
}

let currentTab = loadTab();

function saveTab(tab) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch (_) {
    // в приватном режиме хранилища нет — вкладка просто не запомнится
  }
}

/**
 * Сколько устройств проекта работает прямо сейчас. Не из списка на экране:
 * он мог устареть — устройства запускают и из другой вкладки, и с другого
 * компьютера, — а остановить их молча было бы хуже лишнего запроса.
 */
async function runningNow(p) {
  try {
    const data = await api('/api/projects');
    const fresh = (data.projects || []).find(function (x) { return x.id === p.id; });
    return fresh && fresh.stats ? fresh.stats.running : 0;
  } catch (_) {
    return p.stats ? p.stats.running : 0;
  }
}

async function setArchived(p, archived) {
  // Архив — это «закончил». Работающие устройства сервер остановит; чтобы это
  // не случилось молча, спрашиваем — только если есть что останавливать.
  const running = archived ? await runningNow(p) : 0;
  if (running) {
    const what = running + ' ' + plural(running, 'устройство', 'устройства', 'устройств');
    const fate = plural(running, 'оно будет остановлено', 'они будут остановлены', 'они будут остановлены');
    if (!confirm('В проекте «' + p.name + '» запущено ' + what + ' — ' + fate + '. Отправить в архив?')) return;
  }
  try {
    await post('/api/projects/' + encodeURIComponent(p.id) + '/archive', { archived: archived });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

function openRename(p) {
  renameForm.reset();
  renameForm.querySelector('[name="id"]').value = p.id;
  renameForm.querySelector('[name="name"]').value = p.name;
  renameForm.querySelector('[name="description"]').value = p.description || '';

  const dates = document.getElementById('renameDates');
  if (dates) {
    setText(dates, p.createdAt
      ? 'Создан ' + fullDate(p.createdAt) + ' · изменён ' + fullDate(p.updatedAt)
      : '');
  }

  renameDialog.showModal();
  setTimeout(function () {
    const input = renameForm.querySelector('[name="name"]');
    if (input) {
      input.focus();
      input.select();
    }
  }, 0);
}

function projectCard(p) {
  const url = '/p/' + encodeURIComponent(p.slug);
  const card = document.createElement('div');
  card.className = 'project-card';
  const description = String(p.description || '');

  card.innerHTML =
    '<div class="project-card-main">' +
    '<a class="project-name" href="' + url + '">' + escapeHtml(p.name) + '</a>' +
    (description ? '<div class="project-desc">' + escapeHtml(description) + '</div>' : '') +
    '<div class="project-meta"><a href="' + url + '">' + escapeHtml(url) + '</a></div>' +
    '<div class="project-stats">' + statChips(p.stats) + archivedChip(p) + dateChip(p) + '</div>' +
    '</div>' +
    '<div class="project-card-actions">' +
    '<button type="button" class="project-tool" data-rename title="Изменить имя и описание">' + ICONS.rename + '</button>' +
    '<button type="button" class="project-tool" data-export title="Экспортировать проект в файл">' + ICONS.download + '</button>' +
    (p.archivedAt
      ? '<button type="button" class="project-tool" data-archive="0" title="Вернуть в текущие">' + ICONS.unarchive + '</button>'
      : '<button type="button" class="project-tool" data-archive="1" title="В архив">' + ICONS.archive + '</button>') +
    '<button type="button" class="project-tool project-tool-danger" data-del title="Удалить">' + ICONS.trash + '</button>' +
    '</div>';

  card.querySelector('[data-rename]').addEventListener('click', function (e) {
    e.preventDefault();
    openRename(p);
  });

  card.querySelector('[data-export]').addEventListener('click', function (e) {
    e.preventDefault();
    exportOne(p);
  });

  const archiveBtn = card.querySelector('[data-archive]');
  archiveBtn.addEventListener('click', function (e) {
    e.preventDefault();
    setArchived(p, archiveBtn.getAttribute('data-archive') === '1');
  });

  card.querySelector('[data-del]').addEventListener('click', async function (e) {
    e.preventDefault();
    if (!confirm('Удалить проект «' + p.name + '» и все его устройства?')) return;
    try {
      await del('/api/projects/' + p.id);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  // Клик по всей плашке открывает проект; кнопки и ссылки обрабатывают себя сами.
  card.addEventListener('click', function (e) {
    if (e.target.closest('.project-card-actions') || e.target.closest('a')) return;
    location.href = url;
  });

  return card;
}

const EMPTY_TEXT = {
  current: 'Текущих проектов нет. Создай новый — в нём будут жить устройства-имитаторы.',
  archive: 'Архив пуст. Сюда переносят проекты, с которыми закончили работать, — кнопкой с ящиком в карточке.',
};

/** Свежее — сверху: в архиве первыми идут те, что убраны последними. */
function byArchivedDesc(a, b) {
  return String(b.archivedAt).localeCompare(String(a.archivedAt));
}

function renderTabs(current, archived) {
  document.querySelectorAll('.project-tab').forEach(function (tab) {
    const on = tab.getAttribute('data-tab') === currentTab;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  setText(document.getElementById('countCurrent'), current.length);
  setText(document.getElementById('countArchive'), archived.length);
}

// ── Поиск ────────────────────────────────────────────────

const filterInput = document.getElementById('projectFilter');
const filterClear = document.getElementById('btnClearProjectFilter');

/**
 * Запрос не запоминаем между запусками — как и поиск по устройствам: забытый
 * фильтр выглядел бы как пропавшие проекты.
 */
let query = '';

function matchesQuery(p) {
  return !query || String(p.name || '').toLowerCase().includes(query);
}

const TAB_LABEL = { current: 'В текущих', archive: 'В архиве' };

/**
 * Пусто по запросу. Если совпадения есть в соседней вкладке — говорим об
 * этом и даём перейти: иначе легко решить, что проекта нет, а он в архиве.
 */
function renderNoMatches(otherTab, otherCount) {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'Ничего не найдено.';
  if (otherCount) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'link-btn';
    jump.textContent = TAB_LABEL[otherTab] + ' ' + otherCount + ' ' +
      plural(otherCount, 'совпадение', 'совпадения', 'совпадений');
    jump.addEventListener('click', function () { switchTab(otherTab); });
    empty.appendChild(document.createTextNode(' '));
    empty.appendChild(jump);
  }
  listEl.appendChild(empty);
}

function render(projects) {
  const current = projects.filter(function (p) { return !p.archivedAt; });
  const archived = projects.filter(function (p) { return !!p.archivedAt; }).sort(byArchivedDesc);
  renderTabs(current, archived);

  const all = currentTab === 'archive' ? archived : current;
  const shown = all.filter(matchesQuery);
  listEl.innerHTML = '';

  if (!all.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = EMPTY_TEXT[currentTab];
    listEl.appendChild(empty);
    return;
  }

  if (!shown.length) {
    const otherTab = currentTab === 'archive' ? 'current' : 'archive';
    const other = otherTab === 'archive' ? archived : current;
    renderNoMatches(otherTab, other.filter(matchesQuery).length);
    return;
  }

  shown.forEach(function (p) { listEl.appendChild(projectCard(p)); });
}

async function refresh() {
  const data = await api('/api/projects');
  projectsCache = data.projects || [];
  render(projectsCache);
}

function switchTab(next) {
  if (next === currentTab) return;
  currentTab = next;
  saveTab(next);
  render(projectsCache);
  // Новая вкладка — новый список, читать его с начала. А вот после переноса
  // в архив позицию не сбрасываем: человек стоит посреди своего списка.
  listEl.scrollTop = 0;
}

document.querySelectorAll('.project-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    switchTab(tab.getAttribute('data-tab'));
  });
});

function setQuery(value) {
  query = String(value || '').trim().toLowerCase();
  filterClear.classList.toggle('hidden', !filterInput.value);
  render(projectsCache);
  listEl.scrollTop = 0;
}

filterInput.addEventListener('input', function () {
  setQuery(filterInput.value);
});

// Крестик чистит запрос, но оставляет курсор в поле — обычно ищут дальше.
filterClear.addEventListener('click', function () {
  filterInput.value = '';
  setQuery('');
  filterInput.focus();
});

// Esc: сначала очистить, повторно — уйти из поля.
filterInput.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (filterInput.value) {
    filterInput.value = '';
    setQuery('');
  } else {
    filterInput.blur();
  }
});

// ── Создание и переименование ────────────────────────────

const slugField = document.getElementById('slugField');
const autoSlugInput = createForm.querySelector('[name="autoSlug"]');
const slugInput = createForm.querySelector('[name="slug"]');

function applyAutoSlug() {
  const auto = autoSlugInput.checked;
  slugField.classList.toggle('hidden', auto);
  // required на скрытом поле намертво блокирует отправку формы
  slugInput.required = !auto;
  if (auto) slugInput.value = '';
}

autoSlugInput.addEventListener('change', function () {
  applyAutoSlug();
  if (!autoSlugInput.checked) slugInput.focus();
});

slugInput.addEventListener('input', function () {
  const cleaned = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (cleaned !== slugInput.value) slugInput.value = cleaned;
});

document.getElementById('btnNewProject').addEventListener('click', function () {
  createForm.reset();
  applyAutoSlug();
  createDialog.showModal();
  const input = createForm.querySelector('[name="name"]');
  if (input) setTimeout(function () { input.focus(); }, 0);
});

document.getElementById('btnCancelCreate').addEventListener('click', function () {
  createDialog.close();
});

document.getElementById('btnCancelRename').addEventListener('click', function () {
  renameDialog.close();
});

createForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  const fd = new FormData(createForm);
  const payload = {
    name: fd.get('name'),
    description: String(fd.get('description') || ''),
  };
  if (!autoSlugInput.checked) payload.slug = String(fd.get('slug') || '').trim();
  try {
    const { project } = await post('/api/projects', payload);
    createDialog.close();
    location.href = '/p/' + encodeURIComponent(project.slug);
  } catch (err) {
    alert(err.message);
  }
});

renameForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  const fd = new FormData(renameForm);
  try {
    await put('/api/projects/' + encodeURIComponent(fd.get('id')), {
      name: fd.get('name'),
      description: String(fd.get('description') || ''),
    });
    renameDialog.close();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

// ── Экспорт и импорт ─────────────────────────────────────

document.getElementById('btnExportProjects').addEventListener('click', async function () {
  if (!projectsCache.length) {
    alert('Нет проектов для экспорта');
    return;
  }

  const chosen = await openPickDialog({
    title: 'Экспорт проектов',
    hint: 'Отметь проекты, которые попадут в JSON-файл',
    items: projectsCache,
    getLabel: function (p) { return p.name; },
    // в экспорт попадают и архивные — помечаем, чтобы было видно, что берёшь
    getMeta: function (p) { return '/p/' + p.slug + (p.archivedAt ? ' · в архиве' : ''); },
  });
  if (!chosen || !chosen.length) return;

  try {
    const payload = await post('/api/projects/export', {
      ids: chosen.map(function (p) { return p.id; }),
    });
    downloadJson('device-simulator-projects-' + fileStamp() + '.json', payload);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btnImportProjects').addEventListener('click', function () {
  const input = document.getElementById('importProjectsFile');
  input.value = '';
  input.click();
});

document.getElementById('importProjectsFile').addEventListener('change', async function (ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;

  const parsed = await readJsonFile(file);
  if (!parsed) {
    alert('Не удалось прочитать JSON');
    return;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.projects)
      ? parsed.projects
      : null;

  if (!list || !list.length) {
    alert('В файле нет проектов');
    return;
  }

  const chosen = await openPickDialog({
    title: 'Импорт проектов',
    hint: 'Файл: ' + file.name + '. Выбери, что добавить (создаются новые копии)',
    items: list,
    getLabel: function (p) { return p.name || p.slug || 'Без имени'; },
    getMeta: function (p) {
      const n = Array.isArray(p.devices) ? p.devices.length : 0;
      return (p.slug ? '/p/' + p.slug + '   ' : '') + n + ' устройств';
    },
  });
  if (!chosen || !chosen.length) return;

  try {
    const result = await post('/api/projects/import', { projects: chosen });
    await refresh();
    const lines = (result.created || []).map(function (p) {
      return '«' + p.name + '» → /p/' + p.slug + ' (' + p.devices + ' уст.)';
    });
    let msg = 'Импортировано:\n' + lines.join('\n');
    if (result.errors && result.errors.length) {
      msg += '\n\nОшибки:\n' + result.errors.join('\n');
    }
    alert(msg);
  } catch (err) {
    alert(err.message);
  }
});

// Возврат со страницы проекта может прийти из bfcache — статистику надо перечитать.
window.addEventListener('pageshow', function (e) {
  if (e.persisted) refresh().catch(function () {});
});

initNetworkPanel();

refresh().catch(function (err) {
  listEl.innerHTML = '';
  const note = document.createElement('p');
  note.className = 'muted';
  setText(note, err.message);
  listEl.appendChild(note);
});
