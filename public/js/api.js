// Адреса API страницы проекта. Слаг живёт в адресе страницы (/p/<slug>),
// поэтому все пути строятся от него, а не от какого-то глобала.

const slugMatch = location.pathname.match(/^\/p\/([^/]+)\/?$/);

export const PROJECT_SLUG = slugMatch ? decodeURIComponent(slugMatch[1]) : null;

/** @param {string} [pathSuffix] хвост после .../devices, уже с ведущим слэшем */
export function devicesApi(pathSuffix) {
  return '/api/p/' + encodeURIComponent(PROJECT_SLUG) + '/devices' + (pathSuffix || '');
}

export function projectApi() {
  return '/api/projects/by-slug/' + encodeURIComponent(PROJECT_SLUG);
}
