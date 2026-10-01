// Общая обвязка над Sortable: один набор настроек на все три списка
// и защита от обновления вида посреди броска.

let dragging = false;

export function isDragging() {
  return dragging;
}

export function beginDrag() {
  dragging = true;
}

/**
 * Работу после броска всегда откладываем на следующий тик.
 *
 * Sortable в момент onEnd ещё не убрал свой клон из <body>, и если тут же
 * тронуть список, клон остаётся сиротой поверх всего. Заодно подчищаем
 * такие клоны, если предыдущий бросок всё же их оставил.
 */
export function afterDrag(work) {
  setTimeout(function () {
    dragging = false;
    document.querySelectorAll('.sortable-fallback, .rule-mirror, .device-mirror')
      .forEach(function (el) {
        if (el.parentNode === document.body) el.remove();
      });
    work();
  }, 0);
}

/**
 * Создать список с перетаскиванием. Возвращает объект с методом setEnabled:
 * экземпляр живёт всё время жизни панели, а блокировка переключается флагом —
 * пересоздавать его на каждое изменение больше не нужно.
 *
 * @param {HTMLElement} container
 * @param {{ prefix: string, draggable?: string, onEnd: (from: number, to: number) => void }} opts
 */
export function createSortable(container, opts) {
  if (typeof Sortable === 'undefined') {
    return { setEnabled: function () {}, destroy: function () {} };
  }

  const instance = Sortable.create(container, Object.assign({
    handle: '.' + opts.prefix + '-handle',
    animation: 160,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    ghostClass: opts.prefix + '-ghost',
    chosenClass: opts.prefix + '-chosen',
    dragClass: opts.prefix + '-drag',
    forceFallback: true,
    fallbackClass: opts.prefix + '-mirror',
    fallbackOnBody: true,
    fallbackTolerance: 4,
    swapThreshold: 0.65,
    filter: 'input,textarea,select',
    preventOnFilter: false,
    onStart: function () {
      beginDrag();
      if (opts.onStart) opts.onStart();
    },
    onEnd: function (evt) {
      const from = evt.oldIndex;
      const to = evt.newIndex;
      afterDrag(function () {
        if (from == null || to == null || from === to) return;
        opts.onEnd(from, to);
      });
    },
  }, opts.draggable ? { draggable: opts.draggable } : null));

  return {
    setEnabled: function (on) {
      instance.option('disabled', !on);
    },
    destroy: function () {
      instance.destroy();
    },
  };
}
