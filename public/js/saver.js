// Автосохранение черновика устройства.

import { state, selected } from './state.js';
import { devicesApi } from './api.js';
import { put } from './http.js';
import { collectSettingsPayload } from './settings-form.js';

const DEBOUNCE_MS = 280;

/** Что можно сохранять, пока устройство запущено. */
const HOT_KINDS = ['enabled', 'commands', 'rules'];

/** @param {() => Promise<void> | void} onSaved вызывается после успешного PUT */
export function createSaver(onSaved) {
  let timer = null;
  let pending = null;

  async function saveNow(kind) {
    const d = selected();
    if (!d) return;

    // Пока идёт предыдущее сохранение, новое не выбрасываем, а запоминаем:
    // раньше при быстром добавлении правил второе просто терялось.
    if (state.saving) {
      pending = kind;
      return;
    }

    state.saving = true;
    try {
      if (d.running) {
        if (!HOT_KINDS.includes(kind)) {
          state.dirty = false;
          return;
        }
        await put(devicesApi('/' + d.id), kind === 'commands'
          ? { commands: state.draftCommands }
          : { rules: state.draftRules });
      } else {
        await put(devicesApi('/' + d.id), collectSettingsPayload());
      }
      // Снимаем «грязь» только после успешного PUT: иначе обновление
      // с сервера вправе затереть правки, которые ещё не доехали.
      state.dirty = false;
      await onSaved();
    } finally {
      state.saving = false;
      if (pending) {
        const next = pending;
        pending = null;
        saveNow(next).catch(function (err) { alert(err.message); });
      }
    }
  }

  function scheduleSave(kind) {
    if (state.suppressAutosave) return;
    if (!selected()) return;
    state.dirty = true;
    clearTimeout(timer);
    timer = setTimeout(function () {
      saveNow(kind).catch(function (err) { alert(err.message); });
    }, DEBOUNCE_MS);
  }

  return { scheduleSave: scheduleSave, saveNow: saveNow };
}
