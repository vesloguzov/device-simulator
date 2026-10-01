// Мелкие помощники работы с разметкой.
//
// Установщики намеренно «ленивые»: присваивают только когда значение реально
// изменилось. Из-за этого обновление карточки на пришедшем по WebSocket
// пакете не двигает каретку в поле и не сбрасывает выделение.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Значение поля ввода. Не трогаем узел, если текст тот же — иначе слетит каретка. */
export function setValue(input, value) {
  const next = value == null ? '' : String(value);
  if (input.value !== next) input.value = next;
}

export function setText(node, value) {
  const next = value == null ? '' : String(value);
  if (node.textContent !== next) node.textContent = next;
}

export function setDisabled(node, flag) {
  const next = !!flag;
  if (node.disabled !== next) node.disabled = next;
}

export function setChecked(input, flag) {
  const next = !!flag;
  if (input.checked !== next) input.checked = next;
}

export function setTitle(node, value) {
  const next = value == null ? '' : String(value);
  if (node.title !== next) node.title = next;
}

export function setClass(node, name, on) {
  node.classList.toggle(name, !!on);
}

/** Создать узел из готовой разметки — шаблон карточки строится один раз. */
export function fromTemplate(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

/**
 * Поставить узлы в контейнере ровно в порядке списка, двигая только то,
 * что реально стоит не на месте.
 */
export function orderChildren(container, nodes) {
  nodes.forEach(function (node, i) {
    if (container.children[i] !== node) {
      container.insertBefore(node, container.children[i] || null);
    }
  });
}

/** Скачать объект файлом — и устройства, и проекты выгружаются одинаково. */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Прочитать выбранный файл как JSON; вернёт null, если это не JSON. */
export async function readJsonFile(file) {
  try {
    return JSON.parse(await file.text());
  } catch (_) {
    return null;
  }
}
