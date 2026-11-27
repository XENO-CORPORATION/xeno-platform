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
  // A PRODUCT HOST (owner, 2026-11-21: "a full viewport render for the tasks alone, with a header, fast"): the same
  // workspace page served on a product's own host, showing that product alone. On tasks.xenosystem.ai the address is
  // the product's own: `/` is the board, `/T-4` a task, `/My tasks` a list. A place that is not the product's opens in
  // the full workspace on the main site. `tasks.localhost` is the same host in development and the browser tests.
  // chat.xenosystem.ai (owner, 2026-11-22: "a dedicated chat … full screen … its own thing, like the Gemini web app … with
  // the new chat, library, images, scheduled, corpus"): the chat, and the places a person reaches from it, on one host.
  // storage.xenosystem.ai (owner, 2026-11-21: "the same for storage.xenosystem.ai … that drive-like interface … that made
  // people be familiar with, but under our XENO system logic for his account"): the account's files alone, the way Drive is.
  const PRODUCT = (() => { const m = /^(tasks|chat|storage)\.(xenosystem\.ai|xenostudio\.ai|localhost)$/.exec(location.hostname); return m ? m[1] : null; })();
  // What each product host shows, as [host prefix, kind, id, area]: the first route with the empty prefix is the product
  // itself (its items are the host's own paths); the others are the places it keeps in the same window. A kind/id
  // without an area matches it in any area. Anything else is the full workspace, on the main site.
  const HOST_ROUTES = {
    tasks: [['', 'g', 'tasks']],
    chat: [['', 'p', 'chat'], ['library', 'g', 'library'], ['images', 'p', 'image']],
    storage: [['', 'p', 'storage']],
  };
  // the chat's own items read as its addresses: a conversation is /c/<id>, a project's are /projects/<pid>[/c/<id>]
  // Storage's (platform-storage.js `here`): '' My files, Recent/Starred/Shared/Trash/Usage, f/<id> a folder, t/<id> a
  // team's files, read on the host as /, /recent, /starred, /shared, /trash, /usage, /folders/<id>, /teams/<id>
  const STORAGE_VIEWS = ['Recent', 'Starred', 'Shared', 'Trash', 'Usage'];
  const ITEM_OUT = {
    chat: (it) => (/^projects\//.test(it) || !it ? it : 'c/' + it),
    storage: (it) => (STORAGE_VIEWS.includes(it) ? it.toLowerCase() : it.replace(/^f\//, 'folders/').replace(/^t\//, 'teams/')),
  };
  const ITEM_IN = {
    chat: (p) => p.replace(/^c\//, ''),
    storage: (p) => STORAGE_VIEWS.find((v) => v.toLowerCase() === p.toLowerCase()) || p.replace(/^folders\//, 'f/').replace(/^teams\//, 't/'),
  };
  const WORKSPACE_ORIGIN = location.hostname.endsWith('.localhost') ? location.origin.replace(/\/\/[^.]+\./, '//') : 'https://' + location.hostname.replace(/^[^.]+\./, '');
  if (PRODUCT) document.documentElement.dataset.product = PRODUCT;
  // The phone drawer (app.js drawerSync) adds one history entry when it opens, so the back gesture closes it. That Back is
  // not a navigation: caught here, before every other popstate listener (this script loads first), and handed to the drawer.
  addEventListener('popstate', (e) => {
    const r = document.documentElement, mark = r.dataset.drawerEntry; if (mark !== '1' && mark !== 'closing') return;
    delete r.dataset.drawerEntry; e.stopImmediatePropagation();
    if (mark === '1') window.XENO_DRAWER_POP?.();   // 'closing': the drawer already closed itself and stepped back
  });
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
  // The product host's own addresses (see PRODUCT). Its place is <area>/g/<product>[/<item>], shown as /<item>; any
  // other place is the full workspace's, on the main site (a different origin, so it is opened, never pushed).
  const ROUTES = HOST_ROUTES[PRODUCT] || [];
  const hostPath = (h) => {
    const [route, q] = split(String(h || '#/')); const [area, kind, id, ...rest] = route.replace(/^#?\/?/, '').split('/');
    const r = ROUTES.find(([, k, i, a]) => k === kind && i === id && (!a || a === area));
    if (!r) return WORKSPACE_ORIGIN + toPath(h);
    const item = rest.join('/'), out = r[0] ? (item ? r[0] + '/' + item : r[0]) : (ITEM_OUT[PRODUCT] ? ITEM_OUT[PRODUCT](item) : item);
    return '/' + out + q;
  };
  const hostHash = (p) => {
    const [path, q] = split(String(p || '')); if (path === BASE || path.startsWith(BASE + '/')) return toHash(p);
    const parts = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
    const r = ROUTES.find(([pre]) => pre && pre === parts[0]) || ROUTES.find(([pre]) => !pre);
    const rest = r[0] ? parts.slice(1).join('/') : (ITEM_IN[PRODUCT] ? ITEM_IN[PRODUCT](parts.join('/')) : parts.join('/'));
    return `#/${r[3] || 'overview'}/${r[1]}/${r[2]}${rest ? '/' + rest : ''}${q}`;
  };
  const outPath = PRODUCT ? hostPath : toPath, inHash = PRODUCT ? hostHash : toHash;
  const away = (p) => /^https?:/.test(p);
  const legacy = () => (location.hash && location.hash.startsWith('#/') ? location.hash : null);
  /** where the person is, in the router's internal form */
  const current = () => legacy() || inHash(location.pathname + location.search);
  // the selected workspace rides EVERY address as ?ws=<id> (platform-work.js sets it): the router builds paths from
  // its own state, so the workspace is carried here, once, rather than in every place that makes a link
  let WS = null;
  const withWs = (p) => { if (!WS) return p; const [path, q] = split(p); const sp = new URLSearchParams(q.replace(/^\?/, '')); sp.set('ws', WS); return path + '?' + sp.toString(); };
  const push = (h, state = null) => { const p = withWs(outPath(h)); if (away(p)) return location.assign(p); history.pushState(state, '', p); };
  const replace = (h, state = history.state) => { const p = withWs(outPath(h)); if (away(p)) return; history.replaceState(state, '', p); };
  /** set the workspace every address carries (null: the personal workspace, no ?ws) */
  // a deliberate switch (`step`) is a new history entry, so Back returns to the workspace you came from; reading the
  // workspace from the address on load only aligns it (no step)
  const setWorkspace = (id, step = false) => { WS = id || null; try { const u = new URL(location.href); if ((u.searchParams.get('ws') || null) === WS) return; if (WS) u.searchParams.set('ws', WS); else u.searchParams.delete('ws'); if (step) history.pushState(history.state, '', u); else history.replaceState(history.state, '', u); } catch {} };
  /** go somewhere by internal form: a new history step, and the router told (as a real navigation would) */
  function go(h) {
    if (current() === h) return;
    if (away(outPath(h))) return location.assign(withWs(outPath(h)));
    push(h);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    dispatchEvent(new HashChangeEvent('hashchange'));
  }
  /** a full, shareable URL for an internal form */
  const url = (h) => { const p = withWs(outPath(h)); return away(p) ? p : location.origin + p; };
  // an old "#/…" address (a bookmark, a link from before, a test setting location.hash) is honoured, then upgraded
  const upgrade = () => { const h = legacy(); if (h && !away(outPath(h))) history.replaceState(history.state, '', outPath(h)); };
  addEventListener('hashchange', () => setTimeout(upgrade, 0));
  // a division's old address (/workspace[/<area>]/workspace/Divisions/<id>) is the same place: show its own address
  try { if (!legacy() && /\/workspace\/Divisions(\/|$)/.test(location.pathname)) history.replaceState(history.state, '', toPath(toHash(location.pathname)) + location.search); } catch {}
  window.XENO_ADDR = { BASE, RESERVED, GLOBALS, toPath, toHash, current, push, replace, go, url, upgrade, setWorkspace, workspace: () => WS, product: PRODUCT, workspaceOrigin: WORKSPACE_ORIGIN };
})();
