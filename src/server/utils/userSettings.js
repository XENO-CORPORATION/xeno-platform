const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizeSettingPath(path) {
  if (typeof path !== 'string') throw new TypeError('Setting path must be a string');
  const rawSegments = path.split(/[.,]/);
  if (rawSegments.some((segment) => !segment.trim())) throw new TypeError('Setting path is invalid');
  const segments = rawSegments.map((segment) => segment.trim());
  if (segments.length === 0 || segments.length > 8) throw new TypeError('Setting path is invalid');
  for (const segment of segments) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment) || FORBIDDEN_SEGMENTS.has(segment)) {
      throw new TypeError('Setting path is invalid');
    }
  }
  return segments;
}

export function setNestedSetting(settings, path, value) {
  const segments = Array.isArray(path) ? path : normalizeSettingPath(path);
  const next = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? structuredClone(settings)
    : {};
  let cursor = next;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    cursor[segment] = child && typeof child === 'object' && !Array.isArray(child) ? child : {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
  return next;
}
