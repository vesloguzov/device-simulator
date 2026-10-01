// Список команд, которые можно послать подключённому клиенту.
// Устроен так же, как список правил: карточка живёт, ей подставляют команду.

import { MSG } from './messages.js';
import { ICONS } from './icons.js';
import { els } from './elements.js';
import { setValue, setText, setDisabled, setTitle, fromTemplate, orderChildren } from './html.js';
import { isDragging, createSortable } from './drag.js';

const TEMPLATE =
  '<div class="command-card">' +
    '<button type="button" class="rule-handle" data-drag title="' + MSG.dragCommand + '">' + ICONS.grip + '</button>' +
    '<input class="field-input command-note" data-k="note" placeholder="' + MSG.cmdNotePh + '" />' +
    '<input class="field-input command-body" data-k="body" placeholder="' + MSG.cmdBody + '" />' +
    '<button type="button" class="btn btn-primary" data-send>' + MSG.send + '</button>' +
    '<button type="button" class="rule-tool rule-tool-danger" data-del title="' + MSG.delCommand + '">' + ICONS.close + '</button>' +
  '</div>';

function createCard(host) {
  const el = fromTemplate(TEMPLATE);
  const fields = {
    note: el.querySelector('[data-k="note"]'),
    body: el.querySelector('[data-k="body"]'),
  };
  const btnSend = el.querySelector('[data-send]');
  const btnDel = el.querySelector('[data-del]');

  let command = null;
  let canSend = null;

  el.querySelectorAll('[data-k]').forEach(function (input) {
    const key = input.getAttribute('data-k');
    function apply() {
      if (!command) return;
      command[key] = input.value;
      host.onEdit();
    }
    input.addEventListener('change', apply);
    input.addEventListener('input', apply);
  });

  btnSend.addEventListener('click', function () {
    if (!command) return;
    if (!canSend) {
      alert(MSG.needRun);
      return;
    }
    host.onSend(command);
  });

  btnDel.addEventListener('click', function () {
    if (!command) return;
    const index = host.indexOf(command);
    const label = command.note || command.body || '#' + (index + 1);
    if (!confirm(MSG.delCommand + ' «' + label + '»?')) return;
    host.onRemove(index);
  });

  return {
    el: el,
    bind: function (next) {
      command = next;
      setValue(fields.note, next.note);
      setValue(fields.body, next.body);
    },
    setCanSend: function (allowed) {
      if (canSend === allowed) return;
      canSend = allowed;
      setDisabled(btnSend, !allowed);
      setTitle(btnSend, allowed ? MSG.send : MSG.needRun);
    },
    detach: function () {
      el.remove();
    },
  };
}

export function createCommandsView(host) {
  const container = els.commandsTable;
  const cards = [];
  let list = [];

  const empty = document.createElement('p');
  empty.className = 'muted rules-empty';
  empty.textContent = MSG.noCommands;

  const cardHost = {
    indexOf: function (command) { return list.indexOf(command); },
    onEdit: host.onEdit,
    onRemove: host.onRemove,
    onSend: host.onSend,
  };

  const sortable = createSortable(container, {
    prefix: 'rule',
    draggable: '.command-card',
    onEnd: function (from, to) {
      cards.splice(to, 0, cards.splice(from, 1)[0]);
      host.onReorder(from, to);
    },
  });

  return {
    sync: function (commands, canSend) {
      if (isDragging()) return;
      list = commands;
      setText(els.commandsCount, commands.length);
      container.classList.toggle('drag-single', commands.length < 2);

      if (!commands.length) {
        while (cards.length) cards.pop().detach();
        if (empty.parentNode !== container) container.appendChild(empty);
        sortable.setEnabled(false);
        return;
      }

      empty.remove();

      for (let i = 0; i < commands.length; i++) {
        if (!cards[i]) {
          cards[i] = createCard(cardHost);
          container.appendChild(cards[i].el);
        }
        cards[i].bind(commands[i]);
        cards[i].setCanSend(canSend);
      }
      while (cards.length > commands.length) cards.pop().detach();

      orderChildren(container, cards.map(function (c) { return c.el; }));
      sortable.setEnabled(commands.length > 1);
    },
  };
}
