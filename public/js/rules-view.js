// Список правил ответа.
//
// Карточка строится один раз и дальше живёт: при обновлении ей подставляют
// другое правило, а не пересобирают разметку. Поэтому карточка привязана к
// объекту правила, а не к его номеру — номер она спрашивает у списка в момент
// действия. Раньше номер был захвачен в замыкании, и любая вставка или
// удаление делали все карточки недействительными: отсюда и бралась полная
// перерисовка на каждый пакет с сервера.

import { MSG } from './messages.js';
import { ICONS } from './icons.js';
import { els } from './elements.js';
import { setValue, setText, setDisabled, setChecked, fromTemplate, orderChildren } from './html.js';
import { isDragging, createSortable } from './drag.js';

const TEMPLATE =
  '<div class="rule-card">' +
    '<div class="rule-line rule-line-main">' +
      '<button type="button" class="rule-handle" data-drag title="' + MSG.dragRule + '">' + ICONS.grip + '</button>' +
      '<label class="switch" title="' + MSG.on + '">' +
        '<input type="checkbox" data-k="enabled" />' +
        '<span class="track"></span>' +
      '</label>' +
      '<input class="field-input rule-note" data-k="note" placeholder="' + MSG.notePh + '" />' +
      '<select class="field-input rule-mode" data-k="matchMode" title="' + MSG.mode + '">' +
        '<option value="exact">' + MSG.exact + '</option>' +
        '<option value="startsWith">' + MSG.starts + '</option>' +
        '<option value="contains">' + MSG.contains + '</option>' +
      '</select>' +
      '<span class="rule-delay" title="' + MSG.delay + '">' +
        '<input class="field-input" data-k="delayMs" type="number" min="0" />' +
        '<span class="unit">мс</span>' +
      '</span>' +
      '<button type="button" class="rule-tool" data-copy title="' + MSG.copyRule + '">' + ICONS.copy + '</button>' +
      '<button type="button" class="rule-tool rule-tool-danger" data-del title="' + MSG.delRule + '">' + ICONS.close + '</button>' +
    '</div>' +
    '<div class="rule-line rule-line-io">' +
      '<button type="button" class="io-tag" data-io="match" title="' + MSG.ioExpand + '">RX</button>' +
      '<textarea class="field-input" data-k="match" rows="1" spellcheck="false" placeholder="' + MSG.cmd + '"></textarea>' +
      '<button type="button" class="io-tag" data-io="response" title="' + MSG.ioExpand + '">TX</button>' +
      '<textarea class="field-input" data-k="response" rows="1" spellcheck="false" placeholder="' + MSG.resp + '"></textarea>' +
    '</div>' +
  '</div>';

/** Поля RX и TX разворачиваются в несколько строк по клику на ярлык. */
function setIoExpanded(field, expanded) {
  field.classList.toggle('expanded', expanded);
  const tag = field.previousElementSibling;
  if (tag && tag.hasAttribute('data-io')) {
    tag.classList.toggle('active', expanded);
    tag.title = expanded ? MSG.ioCollapse : MSG.ioExpand;
  }
  if (!expanded) {
    field.scrollTop = 0;
    field.style.height = '';
  }
}

/**
 * @param {{
 *   indexOf: (rule: object) => number,
 *   onEdit: (kind: 'rules' | 'enabled') => void,
 *   onRemove: (index: number) => void,
 *   onCopy: (index: number) => void,
 * }} host
 */
function createCard(host) {
  const el = fromTemplate(TEMPLATE);
  const fields = {
    enabled: el.querySelector('[data-k="enabled"]'),
    note: el.querySelector('[data-k="note"]'),
    matchMode: el.querySelector('[data-k="matchMode"]'),
    delayMs: el.querySelector('[data-k="delayMs"]'),
    match: el.querySelector('[data-k="match"]'),
    response: el.querySelector('[data-k="response"]'),
  };
  const handle = el.querySelector('[data-drag]');
  const btnCopy = el.querySelector('[data-copy]');
  const btnDel = el.querySelector('[data-del]');

  let rule = null;
  let locked = null;

  el.querySelectorAll('[data-k]').forEach(function (input) {
    const key = input.getAttribute('data-k');

    function apply() {
      if (!rule) return;
      if (key === 'enabled') {
        rule.enabled = input.checked;
        host.onEdit('enabled');
        return;
      }
      // На запущенном устройстве правим только сами команды и ответы:
      // остальное поедет на сервер только после остановки.
      if (locked && key !== 'match' && key !== 'response') return;
      if (key === 'delayMs') rule.delayMs = Number(input.value) || 0;
      else rule[key] = input.value;
      host.onEdit('rules');
    }

    input.addEventListener('change', apply);
    if (input.tagName === 'TEXTAREA' || (input.tagName === 'INPUT' && input.type !== 'checkbox')) {
      input.addEventListener('input', apply);
    }
  });

  el.querySelectorAll('[data-io]').forEach(function (tag) {
    const field = fields[tag.getAttribute('data-io')];
    if (!field) return;

    // Без preventDefault поле потеряет фокус до клика и схлопнется само.
    tag.addEventListener('mousedown', function (e) { e.preventDefault(); });

    tag.addEventListener('click', function (e) {
      e.preventDefault();
      const expand = !field.classList.contains('expanded');
      setIoExpanded(field, expand);
      if (expand) field.focus();
    });

    field.addEventListener('blur', function () {
      setIoExpanded(field, false);
    });

    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !field.classList.contains('expanded')) {
        // в одну строку перенос не видно — сначала разворачиваем
        e.preventDefault();
        setIoExpanded(field, true);
        return;
      }
      if (e.key === 'Escape' && field.classList.contains('expanded')) {
        e.preventDefault();
        setIoExpanded(field, false);
        field.blur();
      }
    });
  });

  btnDel.addEventListener('click', function () {
    if (locked || !rule) return;
    const index = host.indexOf(rule);
    const label = rule.note || rule.match || '#' + (index + 1);
    if (!confirm(MSG.delRule + ' «' + label + '»?')) return;
    host.onRemove(index);
  });

  btnCopy.addEventListener('click', function () {
    if (locked || !rule) return;
    host.onCopy(host.indexOf(rule));
  });

  return {
    el: el,
    /** Показать другое правило в этой же карточке. */
    bind: function (next) {
      rule = next;
      setChecked(fields.enabled, next.enabled !== false);
      setValue(fields.note, next.note);
      setValue(fields.matchMode, next.matchMode || 'exact');
      setValue(fields.match, next.match);
      setValue(fields.response, next.response);
      setValue(fields.delayMs, next.delayMs || 0);
    },
    setLock: function (lock) {
      if (locked === lock) return;
      locked = lock;
      // Выключатель, RX и TX остаются живыми и на запущенном устройстве.
      [handle, fields.note, fields.matchMode, fields.delayMs, btnCopy, btnDel]
        .forEach(function (node) { setDisabled(node, lock); });
    },
    detach: function () {
      el.remove();
    },
  };
}

export function createRulesView(host) {
  const container = els.rulesTable;
  const cards = [];
  let list = [];

  const empty = document.createElement('p');
  empty.className = 'muted rules-empty';
  empty.textContent = MSG.noRules;

  const cardHost = {
    indexOf: function (rule) { return list.indexOf(rule); },
    onEdit: host.onEdit,
    onRemove: host.onRemove,
    onCopy: host.onCopy,
  };

  const sortable = createSortable(container, {
    prefix: 'rule',
    draggable: '.rule-card',
    onEnd: function (from, to) {
      // DOM уже переставил Sortable — приводим в тот же порядок карточки
      // и список, чтобы следующий sync ничего не двигал.
      cards.splice(to, 0, cards.splice(from, 1)[0]);
      host.onReorder(from, to);
    },
  });

  return {
    /**
     * Показать список правил. Вызывается на каждое изменение — и локальное,
     * и пришедшее с сервера; разметку при этом не пересобирает.
     */
    sync: function (rules, lock) {
      if (isDragging()) return;
      list = rules;
      setText(els.rulesCount, rules.length);
      container.classList.toggle('drag-single', rules.length < 2);

      if (!rules.length) {
        while (cards.length) cards.pop().detach();
        if (empty.parentNode !== container) container.appendChild(empty);
        sortable.setEnabled(false);
        return;
      }

      empty.remove();

      for (let i = 0; i < rules.length; i++) {
        if (!cards[i]) {
          cards[i] = createCard(cardHost);
          container.appendChild(cards[i].el);
        }
        cards[i].bind(rules[i]);
        cards[i].setLock(lock);
      }
      while (cards.length > rules.length) cards.pop().detach();

      orderChildren(container, cards.map(function (c) { return c.el; }));
      // Одно правило переставлять не с чем, а на ходу — нельзя.
      sortable.setEnabled(!lock && rules.length > 1);
    },
  };
}
