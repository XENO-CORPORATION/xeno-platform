/* XENO Workspace — drag to reorder and to move, with a keyboard way to do the same (XENO MODES - SPEC §7x).
   Two kinds of drag, both driven by the verbs the right-click menu already has, so a drop can never do something the
   menu can't (and the keyboard path is the menu itself):
     XENO_DRAG.sort({ sel, label })                  — reorder in place: runs "Move up"/"Move down" until it lands
     XENO_DRAG.move({ sel, into, label, verb })      — drop a row onto a container: runs the menu item `verb(target)`
   Pointer: press, move 6 px, a ghost follows and a line or highlight shows where it will land; Esc cancels. Keyboard:
   Alt ↑/↓ moves the focused item one place (Notion, Linear). Every move is announced and lands in the one history
   (§7v) — Ctrl Z puts it back. Production: a reorder is one PATCH with the new order; a move is the same request the
   menu sends. */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SORTS = [], MOVES = [];
  const say = (m) => { let r = document.getElementById('xw-live'); if (!r) { r = document.createElement('div'); r.id = 'xw-live'; r.className = 'sr-only'; r.setAttribute('aria-live', 'polite'); document.body.appendChild(r); } r.textContent = ''; setTimeout(() => { r.textContent = m; }, 40); };
  // find a menu item on a node by its label, looking inside sub-menus too
  function verb(node, test) {
    const res = window.XCM?.resolve(node); if (!res) return null;
    const walk = (secs) => { for (const g of secs) for (const it of g) { if (test(it.label)) return it; if (it.sub) { const f = walk(typeof it.sub === 'function' ? it.sub() : it.sub); if (f) return f; } } return null; };
    return walk(res.sections);
  }
  const live = (it) => it && !it.disabled;
  // while drag drives the menu's verbs it records the move itself, once — the verbs must not record each step
  const API = { busy: false };
  function step(def, node, dir) { const it = verb(node, (l) => l === (dir < 0 ? 'Move up' : 'Move down')); if (!live(it)) return false; API.busy = true; try { it.run(); } finally { API.busy = false; } return true; }
  const items = (def) => [...document.querySelectorAll(def.sel)].filter((n) => n.offsetHeight > 0);   // as the person sees them — an empty section is not a position
  const idOf = (n) => n.dataset.hsec ?? n.dataset.chat ?? n.dataset.id ?? n.textContent.trim();
  // reorder to a target index by stepping — re-resolving the node each time, because a step re-renders the list
  function reorder(def, node, to) {
    const key = idOf(node), find = () => items(def).find((n) => idOf(n) === key);
    let cur = items(def).indexOf(node), guard = 50;
    while (cur !== to && guard--) { const n = find(); if (!n || !step(def, n, to < cur ? -1 : 1)) break; cur = items(def).indexOf(find()); }
    return find();
  }
  function done(label, node, def) {
    const n = items(def).indexOf(node) + 1, total = items(def).length;
    window.XENO_HIST?.record(label, null);   // no undo function: the history inverts the recorded values
    say(`${label} — position ${n} of ${total}`);
  }
  // ---------- pointer engine ----------
  let d = null; // { kind, def, node, x0, y0, on, ghost, line, to, target }
  const interactive = (t) => t.closest('a[href],button,input,textarea,select,[contenteditable],[data-more],[data-no-drag]');
  function source(t) {
    for (const def of SORTS) { const n = t.closest(def.sel); if (n) return { kind: 'sort', def, node: n }; }
    for (const def of MOVES) { const n = t.closest(def.sel); if (n) return { kind: 'move', def, node: n }; }
    return null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const s = source(e.target); if (!s || (s.kind === 'sort' && interactive(e.target) && !e.target.closest('[data-drag-handle]'))) return;
    d = { ...s, x0: e.clientX, y0: e.clientY, on: false };
  }, true);
  function start(e) {
    d.on = true; document.body.classList.add('xd-dragging');
    const g = document.createElement('div'); g.className = 'xg-ghost'; g.textContent = d.def.label(d.node); document.body.appendChild(g); d.ghost = g;
    d.node.classList.add('xg-src');
    if (d.kind === 'sort') { const l = document.createElement('div'); l.className = 'xg-line'; document.body.appendChild(l); d.line = l; }
  }
  document.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!d.on) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return; start(e); }
    e.preventDefault(); d.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
    if (d.kind === 'sort') {
      // where it lands = how many of the OTHER items sit above the pointer
      const L = items(d.def), others = L.filter((n) => n !== d.node), rs = others.map((n) => n.getBoundingClientRect());
      d.to = rs.filter((r) => r.top + r.height / 2 < e.clientY).length;
      const y = d.to < rs.length ? rs[d.to].top - 4 : rs[rs.length - 1].bottom + 4, ref = rs[Math.min(d.to, rs.length - 1)];
      Object.assign(d.line.style, { top: `${y}px`, left: `${ref.left}px`, width: `${ref.width}px` });
    } else {
      document.querySelectorAll('.xg-over').forEach((n) => n.classList.remove('xg-over'));
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest(d.def.into);
      d.target = under && live(verb(d.node, (l) => l === d.def.verb(under))) ? under : null;
      d.target?.classList.add('xg-over'); d.ghost.classList.toggle('xg-no', !d.target);
    }
  }, true);
  function end(commit) {
    const s = d; d = null; if (!s) return;
    if (!s.on) return;
    s.ghost?.remove(); s.line?.remove(); s.node.classList.remove('xg-src'); document.body.classList.remove('xd-dragging');
    document.querySelectorAll('.xg-over').forEach((n) => n.classList.remove('xg-over'));
    // the click that ends a drag must not also open the row
    const eat = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); }; document.addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', eat, true), 0);
    if (!commit) { say('Move cancelled'); return; }
    const label = s.def.label(s.node);
    if (s.kind === 'sort') { const from = items(s.def).indexOf(s.node); if (s.to == null || s.to === from) return; const n = reorder(s.def, s.node, s.to); if (n) done(`Moved “${label}”`, n, s.def); }
    else if (s.target) { const name = s.def.verb(s.target), it = verb(s.node, (l) => l === name); if (live(it)) { API.busy = true; try { it.run(); } finally { API.busy = false; } window.XENO_HIST?.record(`Moved “${label}” to ${name}`, null); say(`Moved ${label} to ${name}`); } }
  }
  document.addEventListener('pointerup', () => end(true), true);
  document.addEventListener('pointercancel', () => end(false), true);
  document.addEventListener('keydown', (e) => {
    if (d && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(false); return; }
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    for (const def of SORTS) {
      const n = e.target.closest?.(def.sel); if (!n) continue; e.preventDefault();
      const key = idOf(n), label = def.label(n);
      if (!step(def, n, e.key === 'ArrowUp' ? -1 : 1)) { say(e.key === 'ArrowUp' ? `“${label}” is already at the top` : `“${label}” is already at the bottom`); return; }
      const m = items(def).find((x) => idOf(x) === key); if (m) { if (!m.hasAttribute('tabindex')) m.tabIndex = -1; m.focus(); done(`Moved “${label}”`, m, def); }
      return;
    }
  }, true);
  window.XENO_KEYS?.add('Moving things', 'Alt ↑ ↓', 'Move the focused section'); window.XENO_KEYS?.add('Moving things', 'Esc', 'Cancel a drag');
  window.XENO_DRAG = Object.assign(API, { sort: (def) => SORTS.push(def), move: (def) => MOVES.push(def), dragging: () => !!(d && d.on) });
})();
