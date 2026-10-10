/* address.js — the workspace's real addresses (loaded before every other module).
 *
 * The router (app.js) thinks in one internal form, "#/<area>/<kind>/<id>/<item>?query". The address bar shows a clean
 * path instead, so every page is a real deep link that survives refresh, Back/Forward and sharing (Linear, Notion):
 *
 *   #/overview                      /workspace
 *   #/adaptive                      /workspace/adaptive
 *   #/studio                        /workspace/studio
 *   #/studio/g/tasks/T-4            /workspace/studio/tasks/T-4          (overview: /workspace/tasks/T-4)
 *   #/studio/p/pixel                /workspace/studio/apps/pixel         (overview: /workspace/apps/pixel)
 *   #/studio/z/write                /workspace/studio/spaces/write       (overview: /workspace/spaces/write)
 *
 * An old "#/…" link still works: it is read as it is and the address is upgraded to the clean path in place.
 * The first path segment is an area unless it is one of RESERVED, so an area can never be named after one of them.
 */
(() => {
  const BASE = '/workspace';
  const GLOBALS = ['anima', 'community', 'market', 'library', 'projects', 'tasks', 'workspace', 'inbox', 'settings', 'places'];
  const RESERVED = [...GLOBALS, 'apps', 'spaces', 'adaptive', 'overview'];
  const KIND_OUT = { p: 'apps', z: 'spaces' }, KIND_IN = { apps: 'p', spaces: 'z' };
  const split = (s) => { const i = s.indexOf('?'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)]; };

  /** internal "#/…" → "/workspace/…" (query kept) */
  function toPath(h) {
    const [route, q] = split(String(h || '#/'));
    const [m, kind, id, ...rest] = route.replace(/^#?\/?/, '').split('/');
    const item = rest.length ? '/' + rest.join('/') : '';
    if (!m || (m === 'overview' && !kind)) return BASE + q;
    if (m === 'adaptive') return BASE + '/adaptive' + q;
    const area = m === 'overview' ? '' : '/' + m;
    if (!kind || !id) return BASE + area + q;
    const seg = kind === 'g' ? '/' + id : '/' + (KIND_OUT[kind] || kind) + '/' + id;
    return BASE + area + seg + item + q;
  }
  /** "/workspace/…" → internal "#/…" (query kept); anything outside /workspace reads as the Overview home */
  function toHash(p) {
    const [path, q] = split(String(p || ''));
    if (!path.startsWith(BASE)) return '#/overview' + q;
    const parts = path.slice(BASE.length).split('/').filter(Boolean);
    if (!parts.length) return '#/overview' + q;
    if (parts[0] === 'adaptive') return '#/adaptive' + q;
    let area = 'overview';
    if (!RESERVED.includes(parts[0]) || parts[0] === 'overview') area = parts.shift();
    if (area === 'overview' && parts[0] === 'overview') parts.shift();
    if (!parts.length) return '#/' + area + q;
    const [a, b, ...rest] = parts;
    if (GLOBALS.includes(a)) return `#/${area}/g/${a}${[b, ...rest].filter((x) => x != null).length ? '/' + [b, ...rest].filter((x) => x != null).join('/') : ''}${q}`;
    if (KIND_IN[a] && b) return `#/${area}/${KIND_IN[a]}/${b}${rest.length ? '/' + rest.join('/') : ''}${q}`;
    return '#/' + area + q;
  }
  const legacy = () => (location.hash && location.hash.startsWith('#/') ? location.hash : null);
  /** where the person is, in the router's internal form */
  const current = () => legacy() || toHash(location.pathname + location.search);
  const push = (h, state = null) => history.pushState(state, '', toPath(h));
  const replace = (h, state = history.state) => history.replaceState(state, '', toPath(h));
  /** go somewhere by internal form: a new history step, and the router told (as a real navigation would) */
  function go(h) {
    if (current() === h) return;
    push(h);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    dispatchEvent(new HashChangeEvent('hashchange'));
  }
  /** a full, shareable URL for an internal form */
  const url = (h) => location.origin + toPath(h);
  // an old "#/…" address (a bookmark, a link from before, a test setting location.hash) is honoured, then upgraded
  const upgrade = () => { const h = legacy(); if (h) history.replaceState(history.state, '', toPath(h)); };
  addEventListener('hashchange', () => setTimeout(upgrade, 0));
  window.XENO_ADDR = { BASE, RESERVED, GLOBALS, toPath, toHash, current, push, replace, go, url, upgrade };
})();
