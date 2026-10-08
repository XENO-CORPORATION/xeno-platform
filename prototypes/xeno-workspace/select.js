/* XENO Workspace — select many and act on them, the same way in every list (XENO MODES - SPEC §7w).
   A list declares which rows it has and what can be done to several of them:
     XENO_SEL.list({ key, sel, id: (row) => '…', noun: ['thread', 'threads'], actions: (ids) => [[{ label, icon, run }], …] })
   Plain click keeps doing what it did (opens the row). Ctrl/⌘-click adds or removes a row, Shift-click selects the
   range from the anchor, X toggles the focused row, Shift ↑/↓ extends, Ctrl A selects every row on screen, Esc clears,
   and leaving the page clears (Gmail, Linear, Finder). The action bar and the right-click menu are drawn from the SAME
   actions(ids) list, so they can never disagree. The Library keeps its own selection model and shows its bar through
   XENO_SEL.show(). The model is select-core.js (framework-free, tested without a browser); this file maps the page's
   rows to ids and back, and keeps the pointer, keyboard and menu wiring. Production: bulk verbs become one request with
   the list of ids (POST …/batch), all-or-nothing. */
(() => {
  const C = window.XENO_SEL_CORE;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n) => window.XCM?.H?.ic ? window.XCM.H.ic(n) : (window.XICON?.(n) || '');
  const rows = (def) => [...document.querySelectorAll(`#main ${def.sel}`)];
  const which = (node) => { for (const d of core.defs()) { const r = node.closest?.(`#main ${d.sel}`); if (r) return [d, r]; } return []; };
  const core = C.createSelection({
    rowIds: (def) => rows(def).map((r) => def.id(r)),
    paint: () => paint(),
    urlWrite: (ids) => window.XENO_URLSEL?.set(ids),
    bar: () => bar(),
    copyLink: () => window.XCM?.H?.copy(location.href, 'Link to the selection copied'),
    logError: (err) => console.error(err),
  });
  // paints the marks on the rows that are selected, then the bar
  function paint() {
    document.querySelectorAll('#main [data-xs]').forEach((n) => { n.removeAttribute('data-xs'); n.removeAttribute('aria-selected'); });
    const c = core.current();
    if (c) rows(c.def).forEach((r) => { if (c.ids.includes(c.def.id(r))) { r.setAttribute('data-xs', ''); r.setAttribute('aria-selected', 'true'); } });
    bar();
  }
  // the bar: the count, the common verbs, More (the full list, same as right-click), Clear
  function bar() {
    let b = document.getElementById('xs-bar'); const n = core.count();
    document.body.classList.toggle('xs-on', n > 0);
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'xs-bar'; b.setAttribute('role', 'toolbar'); document.body.appendChild(b);
      b.addEventListener('click', (e) => { const t = e.target.closest('[data-xs-i],[data-xs-more],[data-xs-clear]'); if (!t) return;
        if (t.dataset.xsClear !== undefined) { core.dismissFromBar(); return; }
        if (t.dataset.xsMore !== undefined) { const r = t.getBoundingClientRect(); window.XCM?.show(core.sections(), { x: r.left, y: r.top - 8, label: 'Selection', opener: t }); return; }
        const it = core.itemAt(t.dataset.xsI, t.dataset.xsLabel);
        if (!it) { paint(); return; }   // what was drawn is no longer selected: repaint, and run nothing
        if (it.sub) { const r = t.getBoundingClientRect(); window.XCM?.show(typeof it.sub === 'function' ? it.sub() : it.sub, { x: r.left, y: r.top - 8, label: it.label, opener: t }); } else it.run(); }); }
    const m = core.barModel();
    b.setAttribute('aria-label', `${m.label} selected`);
    b.innerHTML = `<b>${esc(m.label)} selected</b><span class="xs-sep"></span>${m.pick.map(({ it, k }) => `<button data-xs-i="${k}" data-xs-label="${esc(it.label)}"${it.danger ? ' class="xs-danger"' : ''}>${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`).join('')}${m.more ? '<button data-xs-more aria-haspopup="menu">More</button>' : ''}<span class="xs-sep"></span><button data-xs-clear aria-label="Clear selection">Clear<kbd>Esc</kbd></button>`;
  }
  function list(def) { const d = core.list(def);
    // right-click on a selected row acts on the whole selection, with the same verbs as the bar
    window.XCM?.register({ id: 'sel-' + d.key, sel: d.sel, priority: 8, when: (n) => core.selectedIn(d, d.id(n)), build: () => core.sections() });
  }
  // pointer: modifiers select, plain click is untouched
  document.addEventListener('click', (e) => {
    const intent = C.clickIntent({ mods: e.ctrlKey || e.metaKey || e.shiftKey, interactive: !!e.target.closest('a[href],button,input,textarea,select'), shift: e.shiftKey });
    if (!intent) return;
    const [def, r] = which(e.target); if (!def) return;
    e.preventDefault(); e.stopImmediatePropagation(); window.getSelection?.()?.removeAllRanges();
    if (intent === 'range') core.range(def, def.id(r)); else core.toggle(def, def.id(r));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea,select,[contenteditable]') || document.querySelector('.xd')) return;
    const intent = C.keyIntent({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, count: core.count(), menuOpen: !!window.XCM?.isOpen?.() });
    if (intent === 'clear') { e.preventDefault(); core.dismissFromBar(); return; }
    if (!intent) return;
    const [def, r] = which(e.target);
    if (!def) return;
    if (intent === 'toggle') { e.preventDefault(); core.toggle(def, def.id(r)); return; }
    if (intent === 'all') { e.preventDefault(); core.selectAll(def); return; }
    const L = rows(def), ids = L.map(def.id), nid = C.extendNext(ids, def.id(r), intent === 'down' ? 1 : -1);
    if (nid == null) return;
    e.preventDefault(); L[ids.indexOf(nid)].focus(); core.extend(def, def.id(r), nid);
  }, true);
  window.addEventListener('hashchange', () => core.leavePlace({ inApp: false }));
  window.addEventListener('xeno:place', () => core.leavePlace({ inApp: true }));   // the app is changing place (app.js go)
  window.addEventListener('popstate', () => { core.leavePlace({ inApp: false }); setTimeout(restore, 0); });
  // a re-render replaces the rows; put the marks back on the new ones
  // opening a link with ?sel= (or Back/Forward to one) selects those rows once they are on screen — once per address
  function restore() {
    const r = core.restore(window.XENO_URLSEL?.get() || [], location.hash);
    if (!r) return;
    paint(); rows(r.def).find((x) => r.def.id(x) === r.first)?.scrollIntoView({ block: 'nearest' });
  }
  new MutationObserver(() => { restore(); const c = core.current(); if (c && rows(c.def).some((x) => c.ids.includes(c.def.id(x)) && !x.hasAttribute('data-xs'))) paint(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  [['Ctrl Click', 'Add or remove a row'], ['⇧ Click', 'Select a range'], ['X', 'Select the focused row'], ['⇧ ↑ ↓', 'Extend the selection'], ['Ctrl A', 'Select every row'], ['Esc', 'Clear the selection']].forEach(([k, l]) => window.XENO_KEYS?.add('Selecting', k, l));
  window.XENO_SEL = { list, clear: () => { core.clearSelection(); }, count: () => core.count(), ids: () => core.ids(), onLeave: (fn) => core.onLeave(fn),
    show: (x) => core.show(x) };
})();
