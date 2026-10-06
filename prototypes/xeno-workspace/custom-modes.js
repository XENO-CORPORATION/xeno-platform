/* Custom modes (MODES SPEC §8): a mode is a MANIFEST — name, sections → products — and a custom mode is simply one the
 * person owns. So it is registered into the SAME structures the six built-in modes use (XENO_MODES, XENO_MODE_ZONES,
 * XENO_MODE_MARKS) and the one shell renders it: rail, sidebar, home, logo cycle, search, deep links. Never a fork.
 * Its areas group its products by where they come from ("From Studio", "From Social").
 * Platform: GET/POST/PATCH/DELETE /api/v2/me/modes (stored on the account; shareable within a workspace later).
 */
(() => {
  const KEY = 'xw.customs', DEFAULT = [{ id: 'c-agency', name: 'Video agency', products: ['motion', 'post', 'audience', 'image'] }];
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? v : DEFAULT; } catch { return DEFAULT; } };
  const write = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };
  const MODES = window.XENO_MODES, Z = window.XENO_MODE_ZONES, MK = window.XENO_MODE_MARKS, PR = window.XENO_PRODUCTS;
  const builtIn = () => MODES.filter((m) => !m.custom);
  const homeOf = (pid) => builtIn().find((m) => m.sections.some(([, ids]) => ids.includes(pid)));
  function manifest(c) {
    const groups = new Map();
    c.products.filter((p) => PR[p]).forEach((p) => { const h = homeOf(p)?.id || 'tools'; if (!groups.has(h)) groups.set(h, []); groups.get(h).push(p); });
    const sections = [...groups.entries()].map(([h, ids]) => [`From ${MK[h]?.name || h}`, ids]);
    const live = c.products.filter((p) => PR[p] && PR[p].status !== 'soon');
    return { id: c.id, key: '', custom: true, products: c.products.slice(), persona: `Your mode — ${c.products.length} products`, start: live[0] || c.products[0], pins: live.slice(0, 3), sections, metric: null };
  }
  function register(c) {
    unregister(c.id);
    const m = manifest(c); MODES.push(m);
    Z[c.id] = m.sections.map(([label, ids], i) => ({ id: `${c.id}-${i}`, label, icon: 'grid', blurb: `${ids.length} product${ids.length === 1 ? '' : 's'} from ${label.replace(/^From /, '')}`, products: ids, work: null }));
    MK[c.id] = { name: c.name, color: '#f4f4f4', svg: MK.xeno.svg, custom: true };
  }
  function unregister(id) { const i = MODES.findIndex((m) => m.id === id); if (i >= 0) MODES.splice(i, 1); delete Z[id]; delete MK[id]; }
  read().forEach(register);
  window.XENO_CUSTOM = {
    list: read,
    get: (id) => read().find((c) => c.id === id),
    save(c) { const l = read().filter((x) => x.id !== c.id); const i = read().findIndex((x) => x.id === c.id); l.splice(i < 0 ? l.length : i, 0, c); write(l); register(c); },
    remove(id) { write(read().filter((x) => x.id !== id)); unregister(id); },
    isCustom: (id) => !!MODES.find((m) => m.id === id && m.custom),
  };
})();
