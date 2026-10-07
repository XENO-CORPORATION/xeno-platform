/* XENO Workspace — select many and act on them, the same way in every list (XENO MODES - SPEC §7w).
   A list declares which rows it has and what can be done to several of them:
     XENO_SEL.list({ key, sel, id: (row) => '…', noun: ['thread', 'threads'], actions: (ids) => [[{ label, icon, run }], …] })
   Plain click keeps doing what it did (opens the row). Ctrl/⌘-click adds or removes a row, Shift-click selects the
   range from the anchor, X toggles the focused row, Shift ↑/↓ extends, Ctrl A selects every row on screen, Esc clears,
   and leaving the page clears (Gmail, Linear, Finder). The action bar and the right-click menu are drawn from the SAME
   actions(ids) list, so they can never disagree. The Library keeps its own selection model and shows its bar through
   XENO_SEL.show(). Production: bulk verbs become one request with the list of ids (POST …/batch), all-or-nothing. */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n) => window.XCM?.H?.ic ? window.XCM.H.ic(n) : (window.XICON?.(n) || '');
  const LISTS = [];
  let cur = null;            // { def, ids:Set, anchor }
  let ext = null;            // a list that keeps its own model (the Library) — { count, noun, sections, clear }
  const rows = (def) => [...document.querySelectorAll(`#main ${def.sel}`)];
  const which = (node) => { for (const d of LISTS) { const r = node.closest?.(`#main ${d.sel}`); if (r) return [d, r]; } return []; };
  const state = (def) => { if (!cur || cur.def !== def) cur = { def, ids: new Set(), anchor: null }; return cur; };
  function paint() {
    document.querySelectorAll('#main [data-xs]').forEach((n) => { n.removeAttribute('data-xs'); n.removeAttribute('aria-selected'); });
    if (cur) rows(cur.def).forEach((r) => { if (cur.ids.has(cur.def.id(r))) { r.setAttribute('data-xs', ''); r.setAttribute('aria-selected', 'true'); } });
    bar();
  }
  function clear() { if (cur) { cur = null; paint(); } }
  function toggle(def, r) { const s = state(def), id = def.id(r); s.ids.has(id) ? s.ids.delete(id) : s.ids.add(id); s.anchor = id; if (!s.ids.size) cur = null; paint(); }
  function range(def, r) { const s = state(def), list = rows(def).map(def.id), a = list.indexOf(s.anchor ?? def.id(r)), b = list.indexOf(def.id(r)); if (a < 0) return toggle(def, r); const [lo, hi] = a < b ? [a, b] : [b, a]; list.slice(lo, hi + 1).forEach((id) => s.ids.add(id)); paint(); }
  function all(def) { const s = state(def); rows(def).forEach((r) => s.ids.add(def.id(r))); paint(); }
  const words = (def, n) => `${n} ${n === 1 ? def.noun[0] : def.noun[1]}`;
  function sections() {
    if (ext) return ext.sections();
    if (!cur) return [];
    const ids = [...cur.ids], done = () => clear();
    return (cur.def.actions(ids) || []).map((g) => g.filter(Boolean).map((it) => ({ ...it, run: async (...a) => { const r = await it.run?.(...a); if (!it.keep) done(); return r; } }))).filter((g) => g.length);
  }
  function count() { return ext ? ext.count : cur ? cur.ids.size : 0; }
  // the bar: the count, the common verbs, More (the full list, same as right-click), Clear
  function bar() {
    let b = document.getElementById('xs-bar'); const n = count();
    document.body.classList.toggle('xs-on', n > 0);
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'xs-bar'; b.setAttribute('role', 'toolbar'); document.body.appendChild(b);
      b.addEventListener('click', (e) => { const t = e.target.closest('[data-xs-i],[data-xs-more],[data-xs-clear]'); if (!t) return;
        if (t.dataset.xsClear !== undefined) { ext ? ext.clear() : clear(); return; }
        const secs = sections();
        if (t.dataset.xsMore !== undefined) { const r = t.getBoundingClientRect(); window.XCM?.show(secs, { x: r.left, y: r.top - 8, label: 'Selection', opener: t }); return; }
        const [g, i] = t.dataset.xsI.split('.').map(Number); const it = secs[g]?.[i]; if (!it) return;
        if (it.sub) { const r = t.getBoundingClientRect(); window.XCM?.show(typeof it.sub === 'function' ? it.sub() : it.sub, { x: r.left, y: r.top - 8, label: it.label, opener: t }); } else it.run(); }); }
    const secs = sections(), noun = ext ? ext.noun : cur.def.noun, label = ext ? `${n} ${n === 1 ? noun[0] : noun[1]}` : words(cur.def, n);
    // up to four verbs on the bar, dangerous ones last and set apart; everything is also under More
    const flat = secs.flatMap((g, gi) => g.map((it, i) => ({ it, k: `${gi}.${i}` }))).filter(({ it }) => !/^Clear selection$/.test(it.label) && !it.disabled);
    const pick = [...flat.filter(({ it }) => !it.danger).slice(0, 3), ...flat.filter(({ it }) => it.danger).slice(0, 1)];
    b.setAttribute('aria-label', `${label} selected`);
    b.innerHTML = `<b>${esc(label)} selected</b><span class="xs-sep"></span>${pick.map(({ it, k }) => `<button data-xs-i="${k}"${it.danger ? ' class="xs-danger"' : ''}>${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`).join('')}${flat.length > pick.length ? '<button data-xs-more aria-haspopup="menu">More</button>' : ''}<span class="xs-sep"></span><button data-xs-clear aria-label="Clear selection">Clear<kbd>Esc</kbd></button>`;
  }
  function list(def) { def = { noun: ['item', 'items'], ...def }; LISTS.push(def);
    // right-click on a selected row acts on the whole selection, with the same verbs as the bar
    window.XCM?.register({ id: 'sel-' + def.key, sel: def.sel, priority: 8, when: (n) => cur && cur.def === def && cur.ids.size > 1 && cur.ids.has(def.id(n)), build: () => sections() });
  }
  // pointer: modifiers select, plain click is untouched
  document.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) || e.target.closest('a[href],button,input,textarea,select')) return;
    const [def, r] = which(e.target); if (!def) return;
    e.preventDefault(); e.stopImmediatePropagation(); window.getSelection?.()?.removeAllRanges();
    e.shiftKey ? range(def, r) : toggle(def, r);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea,select,[contenteditable]') || document.querySelector('.xd')) return;
    if (e.key === 'Escape' && count()) { if (window.XCM?.isOpen()) return; e.preventDefault(); ext ? ext.clear() : clear(); return; }
    const [def, r] = which(e.target);
    if (!def) return;
    const k = e.key.toLowerCase();
    if (k === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggle(def, r); }
    else if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); all(def); }
    else if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const L = rows(def), i = L.indexOf(r), nx = L[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (!nx) return; e.preventDefault();
      const s = state(def); if (!s.ids.size) { s.ids.add(def.id(r)); s.anchor = def.id(r); } s.ids.add(def.id(nx)); nx.focus(); paint();
    }
  }, true);
  window.addEventListener('hashchange', () => { cur = null; paint(); });
  // a re-render replaces the rows; put the marks back on the new ones
  new MutationObserver(() => { if (cur && rows(cur.def).some((r) => cur.ids.has(cur.def.id(r)) && !r.hasAttribute('data-xs'))) paint(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.XENO_SEL = { list, clear, count, ids: () => (cur ? [...cur.ids] : []),
    show(x) { ext = x && x.count > 1 ? x : null; if (ext) cur = null; bar(); } };
})();
