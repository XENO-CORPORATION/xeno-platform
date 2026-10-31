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
 *   #/overview/g/workspace/Divisions/<id>   /workspace/divisions/<id>     a division's HOME, by id (the old
 *                                   /workspace/workspace/Divisions/<id> still opens it and is rewritten in place)
 *
 * An old "#/…" link still works: it is read as it is and the address is upgraded to the clean path in place.
 * The first path segment is an area unless it is one of RESERVED, so an area can never be named after one of them.
 */
(() => {
  const BASE = '/workspace';
  const GLOBALS = ['anima', 'community', 'market', 'library', 'projects', 'tasks', 'workspace', 'inbox', 'settings', 'places', 'support', 'releases', 'shell'];
  const RESERVED = [...GLOBALS, 'apps', 'spaces', 'adaptive', 'overview', 'divisions'];
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
    // Enhance improves a result that already exists, so it is its own Studio section, not one of the Generate pages
    if (m === 'studio' && kind === 'p' && /^enhance-(image|video|audio|3d)$/.test(id)) return `${BASE}/studio/enhance/${id.slice(8)}${item.replace(/^\/g\//, '/e/').replace(/^\/Library$/, '/library')}${q}`;
    if (m === 'studio' && kind === 'p' && ['image', 'video', 'audio', '3d'].includes(id)) return `${BASE}/studio/generate/${id}${item.replace(/^\/(Library|Favorites)$/, (s) => s.toLowerCase())}${q}`;
    // divisions have their own top-level address: /workspace/divisions[/<id>] (parent in the path: the workspace)
    if (kind === 'g' && id === 'workspace' && /^\/Divisions(\/|$)/.test(item)) return BASE + area + '/divisions' + item.slice(10) + q;
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
    // one Enhance page per type; the single shared page it was for a day opens the image one
    if (area === 'studio' && a === 'enhance' && ['image', 'video', 'audio', '3d'].includes(b)) return `#/studio/p/enhance-${b}${rest[0] === 'e' && rest[1] ? '/g/' + rest[1] : /^library$/i.test(rest[0] || '') ? '/Library' : ''}${q}`;
    if (area === 'studio' && a === 'enhance') return `#/studio/p/enhance-image${b === 'e' && rest[0] ? '/g/' + rest[0] : ''}${q}`;
    // the address Enhance had for a day, under Generate, still opens it
    if (area === 'studio' && a === 'generate' && b === 'enhance') return `#/studio/p/enhance-image${rest[0] === 'g' && rest[1] ? '/g/' + rest[1] : ''}${q}`;
    if (area === 'studio' && a === 'generate' && ['image', 'video', 'audio', '3d'].includes(b)) return `#/studio/p/${b}${/^(library|favorites)$/i.test(rest[0] || '') && rest.length === 1 ? '/' + rest[0][0].toUpperCase() + rest[0].slice(1).toLowerCase() : rest.length ? '/' + rest.join('/') : ''}${q}`;
    if (a === 'divisions') return `#/${area}/g/workspace/Divisions${[b, ...rest].filter((x) => x != null).length ? '/' + [b, ...rest].filter((x) => x != null).join('/') : ''}${q}`;
    if (GLOBALS.includes(a)) return `#/${area}/g/${a}${[b, ...rest].filter((x) => x != null).length ? '/' + [b, ...rest].filter((x) => x != null).join('/') : ''}${q}`;
    if (KIND_IN[a] && b) return `#/${area}/${KIND_IN[a]}/${b}${rest.length ? '/' + rest.join('/') : ''}${q}`;
    return '#/' + area + q;
  }
  const legacy = () => (location.hash && location.hash.startsWith('#/') ? location.hash : null);
  /** where the person is, in the router's internal form */
  const current = () => legacy() || toHash(location.pathname + location.search);
  // the selected workspace rides EVERY address as ?ws=<id> (platform-work.js sets it): the router builds paths from
  // its own state, so the workspace is carried here, once, rather than in every place that makes a link
  let WS = null;
  const withWs = (p) => { if (!WS) return p; const [path, q] = split(p); const sp = new URLSearchParams(q.replace(/^\?/, '')); sp.set('ws', WS); return path + '?' + sp.toString(); };
  const push = (h, state = null) => history.pushState(state, '', withWs(toPath(h)));
  const replace = (h, state = history.state) => history.replaceState(state, '', withWs(toPath(h)));
  /** set the workspace every address carries (null: the personal workspace, no ?ws) */
  // a deliberate switch (`step`) is a new history entry, so Back returns to the workspace you came from; reading the
  // workspace from the address on load only aligns it (no step)
  const setWorkspace = (id, step = false) => { WS = id || null; try { const u = new URL(location.href); if ((u.searchParams.get('ws') || null) === WS) return; if (WS) u.searchParams.set('ws', WS); else u.searchParams.delete('ws'); if (step) history.pushState(history.state, '', u); else history.replaceState(history.state, '', u); } catch {} };
  /** go somewhere by internal form: a new history step, and the router told (as a real navigation would) */
  function go(h) {
    if (current() === h) return;
    push(h);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    dispatchEvent(new HashChangeEvent('hashchange'));
  }
  /** a full, shareable URL for an internal form */
  const url = (h) => location.origin + withWs(toPath(h));
  // an old "#/…" address (a bookmark, a link from before, a test setting location.hash) is honoured, then upgraded
  const upgrade = () => { const h = legacy(); if (h) history.replaceState(history.state, '', toPath(h)); };
  addEventListener('hashchange', () => setTimeout(upgrade, 0));
  // a division's old address (/workspace[/<area>]/workspace/Divisions/<id>) is the same place: show its own address
  try { if (!legacy() && /\/workspace\/Divisions(\/|$)/.test(location.pathname)) history.replaceState(history.state, '', toPath(toHash(location.pathname)) + location.search); } catch {}
  window.XENO_ADDR = { BASE, RESERVED, GLOBALS, toPath, toHash, current, push, replace, go, url, upgrade, setWorkspace, workspace: () => WS };
})();
