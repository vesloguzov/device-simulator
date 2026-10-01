// Общий диалог «отметь, что берём»: им пользуются и экспорт устройств
// на странице проекта, и экспорт проектов на странице списка.

/**
 * @param {{ title: string, hint?: string, items: any[],
 *           getLabel: (item: any) => string, getMeta: (item: any) => string }} opts
 * @returns {Promise<any[] | null>} null — если отменили
 */
export function openPickDialog(opts) {
  return new Promise(function (resolve) {
    const dialog = document.getElementById('pickDialog');
    const list = document.getElementById('pickList');
    const btnOk = document.getElementById('btnPickOk');
    const btnCancel = document.getElementById('btnPickCancel');
    const btnAll = document.getElementById('btnPickAll');
    const btnNone = document.getElementById('btnPickNone');

    document.getElementById('pickTitle').textContent = opts.title;
    document.getElementById('pickHint').textContent = opts.hint || '';
    list.innerHTML = '';

    const boxes = opts.items.map(function (item) {
      const label = document.createElement('label');
      label.className = 'pick-item';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;

      const text = document.createElement('span');
      const name = document.createElement('div');
      name.className = 'name-row text-sm';
      name.textContent = opts.getLabel(item);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = opts.getMeta(item);
      text.appendChild(name);
      text.appendChild(meta);

      label.appendChild(box);
      label.appendChild(text);
      list.appendChild(label);
      return box;
    });

    function setAll(checked) {
      boxes.forEach(function (box) { box.checked = checked; });
    }

    function finish(result) {
      btnOk.onclick = null;
      btnCancel.onclick = null;
      btnAll.onclick = null;
      btnNone.onclick = null;
      dialog.close();
      resolve(result);
    }

    btnAll.onclick = function () { setAll(true); };
    btnNone.onclick = function () { setAll(false); };
    btnCancel.onclick = function () { finish(null); };
    btnOk.onclick = function () {
      finish(opts.items.filter(function (_item, i) { return boxes[i].checked; }));
    };

    dialog.showModal();
  });
}
