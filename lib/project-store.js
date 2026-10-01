'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 64;

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function now() {
  return new Date().toISOString();
}

/** Дата из чужого JSON: берём только то, что разбирается, иначе — ничего. */
function readDate(raw) {
  if (!raw) return null;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function translitSlug(name) {
  let out = '';
  const s = String(name || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (MAP[ch] != null) out += MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[-\s_./\\]/.test(ch)) out += '-';
    else out += '';
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return out || 'project';
}

class ProjectStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.projectsPath = path.join(dataDir, 'projects.json');
    this.projectsDir = path.join(dataDir, 'projects');
    this.legacyDevicesPath = path.join(dataDir, 'devices.json');
    this.projects = new Map();
    fs.mkdirSync(this.projectsDir, { recursive: true });
    this._load();
    this._migrateLegacy();
  }

  /**
   * В старых projects.json дат может не быть вовсе. Тогда подставляем текущую —
   * и сразу перезаписываем файл, иначе при каждом запуске «дата создания»
   * оказывалась бы новой и поехала бы вслед за запусками.
   */
  _load() {
    try {
      const raw = fs.readFileSync(this.projectsPath, 'utf8');
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;

      let filledIn = false;
      const stamp = now();

      for (const p of list) {
        if (!p || !p.id || !p.slug) continue;
        const createdAt = readDate(p.createdAt);
        // Проект, менявшийся до появления этого поля, считаем изменённым
        // в момент создания — придумывать ему другую дату не из чего.
        const updatedAt = readDate(p.updatedAt) || createdAt;
        if (!createdAt || !updatedAt) filledIn = true;
        this.projects.set(p.id, {
          id: p.id,
          name: p.name || p.slug,
          slug: p.slug,
          description: String(p.description || ''),
          createdAt: createdAt || stamp,
          updatedAt: updatedAt || stamp,
          // Нет поля — проект текущий: так и все созданные до появления архива.
          archivedAt: readDate(p.archivedAt),
        });
      }

      if (filledIn) this._save();
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to load projects.json:', err.message);
      }
      this._save();
    }
  }

  _save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const list = this.list();
    fs.writeFileSync(this.projectsPath, JSON.stringify(list, null, 2), 'utf8');
  }

  _migrateLegacy() {
    if (!fs.existsSync(this.legacyDevicesPath)) return;
    if (this.projects.size > 0) return;

    const project = this.create('Основной', 'main');
    const dest = this.devicesPath(project.id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(this.legacyDevicesPath, dest);
    console.log(`Migrated devices.json → project "${project.name}" (${project.slug})`);
  }

  list() {
    return [...this.projects.values()].sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
  }

  getById(id) {
    return this.projects.get(id) || null;
  }

  getBySlug(slug) {
    const s = String(slug || '');
    for (const p of this.projects.values()) {
      if (p.slug === s) return p;
    }
    return null;
  }

  /** Адрес, заданный руками, не подгоняем под свободный — иначе человек получит не то, что ввёл. */
  checkSlug(raw) {
    const slug = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX) {
      throw Object.assign(
        new Error('адрес: латиница, цифры и дефис, например ien-266'),
        { status: 400 }
      );
    }
    if (this.getBySlug(slug)) {
      throw Object.assign(new Error(`адрес /p/${slug} уже занят`), { status: 409 });
    }
    return slug;
  }

  uniqueSlug(base) {
    let slug = translitSlug(base);
    if (!this.getBySlug(slug)) return slug;
    let n = 2;
    while (this.getBySlug(`${slug}-${n}`)) n += 1;
    return `${slug}-${n}`;
  }

  /**
   * @param {string} name
   * @param {string} [slugHint] подсказка: приводится к виду slug и дополняется -2 при совпадении
   * @param {{ exact?: boolean, description?: string,
   *           createdAt?: string, updatedAt?: string }} [options]
   *   exact — взять slug как есть или упасть с ошибкой;
   *   даты передаёт импорт, чтобы сохранить историю из файла
   */
  create(name, slugHint, options) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      throw Object.assign(new Error('укажи имя проекта'), { status: 400 });
    }

    const id = newId();
    const slug = options && options.exact
      ? this.checkSlug(slugHint)
      : this.uniqueSlug(slugHint || trimmed);
    const stamp = now();
    const createdAt = readDate(options && options.createdAt) || stamp;
    const project = {
      id,
      name: trimmed,
      slug,
      description: String((options && options.description) || '').trim(),
      createdAt,
      updatedAt: readDate(options && options.updatedAt) || createdAt,
      archivedAt: null,
    };

    fs.mkdirSync(path.join(this.projectsDir, id), { recursive: true });
    const devicesFile = this.devicesPath(id);
    if (!fs.existsSync(devicesFile)) {
      fs.writeFileSync(devicesFile, '[]', 'utf8');
    }

    this.projects.set(id, project);
    this._save();
    return project;
  }

  /** Поля, которых нет в patch, остаются как были. */
  update(id, patch) {
    const project = this.projects.get(id);
    if (!project) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    const body = patch || {};
    let changed = false;

    if (body.name !== undefined) {
      const trimmed = String(body.name || '').trim();
      if (!trimmed) {
        throw Object.assign(new Error('укажи имя проекта'), { status: 400 });
      }
      if (project.name !== trimmed) changed = true;
      project.name = trimmed;
    }

    if (body.description !== undefined) {
      const description = String(body.description || '').trim();
      if (project.description !== description) changed = true;
      project.description = description;
    }

    // Пересохранение без правок дату не двигает: иначе «изменён» показывал бы
    // не работу над проектом, а то, что кто-то открыл и закрыл диалог.
    if (changed) project.updatedAt = now();

    this.projects.set(id, project);
    this._save();
    return project;
  }

  /**
   * Отметить, что содержимое проекта изменилось. Зовётся, когда правят
   * устройства: они лежат в отдельном файле, а дату держит запись проекта.
   */
  /**
   * Проставить даты из файла — нужно импорту. Отдельным вызовом, а не через
   * create(), потому что добавление устройств по пути дёргает touch()
   * и затирает пришедшую дату изменения.
   */
  setTimestamps(id, dates) {
    const project = this.projects.get(id);
    if (!project) return null;
    const createdAt = readDate(dates && dates.createdAt);
    const updatedAt = readDate(dates && dates.updatedAt);
    // Архивный проект из файла и после импорта остаётся в архиве.
    const archivedAt = readDate(dates && dates.archivedAt);
    if (!createdAt && !updatedAt && !archivedAt) return project;
    if (createdAt) project.createdAt = createdAt;
    if (updatedAt) project.updatedAt = updatedAt;
    if (archivedAt) project.archivedAt = archivedAt;
    this._save();
    return project;
  }

  /**
   * Перенести в архив или вернуть. Дату изменения не трогаем: архив — это
   * место в списке, а не правка проекта. Повторный перенос в архив не
   * переписывает дату, с которой проект там лежит.
   */
  setArchived(id, archived) {
    const project = this.projects.get(id);
    if (!project) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    const next = archived ? project.archivedAt || now() : null;
    if (project.archivedAt === next) return project;
    project.archivedAt = next;
    this._save();
    return project;
  }

  touch(id) {
    const project = this.projects.get(id);
    if (!project) return null;
    project.updatedAt = now();
    this._save();
    return project;
  }

  remove(id) {
    const project = this.projects.get(id);
    if (!project) {
      throw Object.assign(new Error('проект не найден'), { status: 404 });
    }
    this.projects.delete(id);
    this._save();

    const dir = path.join(this.projectsDir, id);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to remove project dir:', err.message);
    }
    return project;
  }

  devicesPath(projectId) {
    return path.join(this.projectsDir, projectId, 'devices.json');
  }
}

module.exports = { ProjectStore, translitSlug };
