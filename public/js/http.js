// Обращения к API. Общие для всех страниц: ошибку сервера превращаем
// в исключение с его же текстом, чтобы вызывающему было что показать.

export async function api(path, options) {
  options = options || {};
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' },
  }, options));
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** POST с пустым телом — сервер всё равно ждёт JSON. */
export function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body || {}) });
}

export function put(path, body) {
  return api(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function del(path) {
  return api(path, { method: 'DELETE' });
}
