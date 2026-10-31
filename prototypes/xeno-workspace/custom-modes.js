/* Custom modes (MODES SPEC §8, §8c): a mode is a MANIFEST — name, sections → products — and a custom mode is simply one the
 * person (or their workspace) owns. So it is registered into the SAME structures the six built-in modes use (XENO_MODES,
 * XENO_MODE_ZONES, XENO_MODE_MARKS) and the one shell renders it: rail, sidebar, home, logo cycle, search, deep links.
 * Never a fork. Its areas group its products by where they come from ("From Studio", "From Social").
 *
 * Storage: the platform. GET/POST/PATCH/DELETE /api/v2/me/modes (the account's own modes) and, for a mode a business
 * setup added to a workspace, PATCH /api/v2/workspaces/<wid>/modes/items/<id> (services/modeApply.js — one service).
 * The browser's localStorage is only the offline copy: opened from disk, or while the platform does not answer, the
 * last list is shown. When the platform first answers, modes that exist only in this browser are COPIED up (never
 * moved: the local copy is left as it was).
 */
(() => {
  const KEY = 'xw.customs', SERVED = !!window.XENO_PLATFORM?.served, DEFAULT = SERVED ? [] : [{ id: 'c-agency', name: 'Video agency', products: ['motion', 'post', 'audience', 'image'] }];
  const readLocal = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? (SERVED ? v.filter((c) => c.id !== 'c-agency') : v) : DEFAULT; } catch { return DEFAULT; } };
  const writeLocal = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };
  const MODES = window.XENO_MODES, Z = window.XENO_MODE_ZONES, MK = window.XENO_MODE_MARKS, PR = window.XENO_PRODUCTS;
  const builtIn = () => MODES.filter((m) => !m.custom);
  const homeOf = (pid) => builtIn().find((m) => m.sections.some(([, ids]) => ids.includes(pid)));
  function manifest(c) {
    const groups = new Map();
    c.products.filter((p) => PR[p]).forEach((p) => { const h = homeOf(p)?.id || 'tools'; if (!groups.has(h)) groups.set(h, []); groups.get(h).push(p); });
    const sections = [...groups.entries()].map(([h, ids]) => [`From ${MK[h]?.name || h}`, ids]);
    const live = c.products.filter((p) => PR[p] && PR[p].status !== 'soon');
    return { id: c.id, key: '', custom: true, products: c.products.slice(), persona: c.workspaceId ? `Your business setup — ${c.products.length} products` : `Your mode — ${c.products.length} products`, start: live[0] || c.products[0], pins: live.slice(0, 3), sections, metric: null };
  }
  function register(c) {
    unregister(c.id);
    const m = manifest(c); MODES.push(m);
    Z[c.id] = m.sections.map(([label, ids], i) => ({ id: `${c.id}-${i}`, label, icon: 'grid', blurb: `${ids.length} product${ids.length === 1 ? '' : 's'} from ${label.replace(/^From /, '')}`, products: ids, work: null }));
    MK[c.id] = { name: c.name, color: '#f4f4f4', svg: MK.xeno.svg, custom: true };
  }
  function unregister(id) { const i = MODES.findIndex((m) => m.id === id); if (i >= 0) MODES.splice(i, 1); delete Z[id]; delete MK[id]; }

  let list = readLocal(), server = false;
  // a link to a mode this browser has never seen (a fresh browser, a colleague's link) is resolved once the platform answers
  const ASKED = (/(?:^|[/#])(c-[a-z0-9][a-z0-9-]{0,39})(?=$|[/?#])/.exec(location.pathname + location.hash) || [])[1] || null;
  const P = window.XENO_PLATFORM;
  const api = (m, u, b) => (P && P.api ? P.api(m, u, b) : Promise.resolve({ status: 0, ok: false, d: {} }));
  const pick = (c) => ({ id: c.id, name: c.name, products: c.products.slice(), ...(c.workspaceId ? { workspaceId: c.workspaceId, applicationId: c.applicationId || null } : {}) });
  const set = (next) => { for (const c of list) unregister(c.id); list = next; list.forEach(register); };
  list.forEach(register);
  const repaint = () => { try { window.XW?.refreshSwitcher?.(); window.XW?.render?.(); } catch {} };
  const fail = (what) => { try { window.XW?.toast?.(`${what} did not save — try again`); } catch {} };

  /** Read the platform's list; copy up anything that so far lived only in this browser. */
  async function hydrate() {
    const r = await api('GET', '/api/v2/me/modes');
    if (r.status !== 200 || !r.ok || !Array.isArray(r.d.modes)) return false;
    server = true;
    const have = new Set(r.d.modes.map((c) => c.id));
    const local = readLocal().filter((c) => !c.workspaceId && !have.has(c.id) && c.id !== 'c-agency');
    const up = [];
    for (const c of local) { const w = await api('POST', '/api/v2/me/modes', pick(c)); if (w.ok && w.d.mode) up.push(w.d.mode); }
    set([...r.d.modes, ...up, ...(r.d.workspaceModes || [])].map(pick));
    window.XENO_CUSTOM.workspaces = r.d.workspaces || [];
    writeLocal(list); repaint();
    if (ASKED && list.some((c) => c.id === ASKED) && !(location.pathname + location.hash).includes(ASKED)) { try { window.XW?.go?.('mode', { mode: ASKED }); } catch {} }
    return true;
  }

  window.XENO_CUSTOM = {
    list: () => list.slice(),
    get: (id) => list.find((c) => c.id === id),
    get server() { return server; },
    workspaces: [],
    hydrate,
    save(c) {
      const prev = list.find((x) => x.id === c.id), i = list.findIndex((x) => x.id === c.id);
      const next = list.filter((x) => x.id !== c.id), row = { ...(prev || {}), ...c };
      next.splice(i < 0 ? next.length : i, 0, row); set(next); writeLocal(list);
      if (!server) return Promise.resolve(true);
      const req = row.workspaceId ? api('PATCH', `/api/v2/workspaces/${row.workspaceId}/modes/items/${row.id}`, { name: row.name, products: row.products })
        : prev ? api('PATCH', `/api/v2/me/modes/${row.id}`, { name: row.name, products: row.products }) : api('POST', '/api/v2/me/modes', pick(row));
      return req.then((r) => { if (!r.ok) fail(row.name); return r.ok; });
    },
    remove(id) {
      const c = list.find((x) => x.id === id); set(list.filter((x) => x.id !== id)); writeLocal(list);
      if (!server || !c || c.workspaceId) return Promise.resolve(true);
      return api('DELETE', `/api/v2/me/modes/${id}`).then((r) => { if (!r.ok) fail(c.name); return r.ok; });
    },
    isCustom: (id) => !!MODES.find((m) => m.id === id && m.custom),
  };
  if (P && P.served) P.ready.then((u) => { if (u) P.first(hydrate()); });
})();
