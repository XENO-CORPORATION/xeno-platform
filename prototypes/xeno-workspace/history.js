/* XENO Workspace — one undo/redo history for every area (XENO MODES - SPEC §7v).
   An area records an action with the words it already shows and the function that takes it back:
     XENO_HIST.record('Moved “Brief” to Trash', () => { f.trashedAt = null; sync(); })
   The history takes a reading of the stored workspace just before every click or key press, so when the action is
   recorded it knows exactly which stored values that action changed, and undo and redo write those values back. The
   area's function is only the fallback for an action that changed nothing stored — closures over in-memory objects go
   stale as soon as the store reloads (a redo, a teammate's change), so they cannot be the primary path. A value is only written back if it still holds what the history left there —
   so undoing or redoing never erases a change somebody else made in the meantime (same rule as §7u's rollback).
   Production: the same entries become server operations with inverse ops; the drawer reads the server's log. */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X = () => window.XW;
  const MAX = 100, SHOW = 3, LIFE = 6000;
  const past = [], future = [], log = []; // log keeps every entry, including undone ones, for the drawer
  let seq = 0;
  const snap = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('xw.') && !k.startsWith('xw.live.')) o[k] = localStorage.getItem(k); } } catch {} return o; };
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  function write(vals, expect) {
    let kept = 0;
    Object.entries(vals).forEach(([k, v]) => { const cur = localStorage.getItem(k); if (expect && cur !== expect[k]) { kept++; return; } if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    window.XENO_DB?.reload?.(); window.XENO_WF?.reload?.(); window.XD?.applyPrefs?.(); window.XENO_PG_SYNC_NAV?.(); X()?.render?.();
    return kept;
  }
  // the reading taken at the start of each user gesture — the state before whatever that gesture is about to do
  let pre = snap();
  const take = () => { pre = snap(); };
  document.addEventListener('pointerdown', take, true); document.addEventListener('keydown', (e) => { if (!((e.ctrlKey || e.metaKey) && /^[zyh]$/i.test(e.key))) take(); }, true);
  function record(label, fn, opts = {}) {
    const e = { id: ++seq, label: String(label), fn, at: Date.now(), by: 'you', state: 'done', area: opts.area || (location.hash.split('/')[3] || location.hash.split('/')[1] || 'workspace') };
    watch(); e.gen = gen;
    try { window.XENO_DB?.save?.(); } catch {}
    const now = snap(), keys = diff(pre, now);
    if (keys.length) { e.before = Object.fromEntries(keys.map((k) => [k, pre[k] ?? null])); e.after = Object.fromEntries(keys.map((k) => [k, now[k] ?? null])); }
    pre = now;
    past.push(e); if (past.length > MAX) past.shift(); future.length = 0; log.unshift(e); if (log.length > MAX) log.pop();
    toast(label, e); drawer(true); return e.id;
  }
  // a generation counter: every reload of the in-memory store bumps it. While an entry's generation is current its
  // own undo function is safe (its closures still point at live objects) and is preferred, because the area then
  // repaints itself; after any reload only the recorded values are trusted.
  let gen = 0; const watch = () => { const D = window.XENO_DB; if (D && !D.__hist) { const r = D.reload; D.reload = (...a) => { gen++; return r.apply(D, a); }; D.__hist = true; } };
  function undoEntry(e) {
    if (!e || e.state !== 'done') return false;
    watch();
    if (!e.fn && !e.before) { toast('That couldn’t be undone'); return false; }
    if (!e.used && e.fn && (e.gen === gen || !e.before)) { // the area's own undo, then measure what it changed
      const s1 = snap(); try { e.fn(); } catch (err) { console.error(err); toast('That couldn’t be undone'); return false; }
      try { window.XENO_DB?.save?.(); } catch {}
      const s2 = snap(), keys = diff(s1, s2); if (keys.length) { e.after = Object.fromEntries(keys.map((k) => [k, s1[k] ?? null])); e.before = Object.fromEntries(keys.map((k) => [k, s2[k] ?? null])); }
      e.used = true;
    } else { const kept = write(e.before, e.after); if (kept) toast('Undone — kept a change someone else made since'); }
    e.state = 'undone'; return true;
  }
  function redoEntry(e) {
    if (!e || e.state !== 'undone' || !e.after) return false;
    const kept = write(e.after, e.before); if (kept) toast('Redone — kept a change someone else made since');
    e.state = 'done'; return true;
  }
  function undo() { const e = past.pop(); if (!e) { toast('Nothing to undo'); return false; } if (!undoEntry(e)) return false; future.push(e); dismiss(e.id); toast(`Undid: ${e.label}`, null, { redo: true }); drawer(true); return true; }
  function redo() { const e = future.pop(); if (!e) { toast('Nothing to redo'); return false; } if (!redoEntry(e)) return false; past.push(e); toast(`Redid: ${e.label}`, e); drawer(true); return true; }
  // jump: go to the state right after an entry (Photoshop's History panel) — undo what is newer, or redo up to it;
  // id 0 is the start of the session, before any of these changes
  function jump(id) { if (id === 0) { while (past.length) undo(); return; } const p = past.findIndex((e) => e.id === id); if (p >= 0) { while (past.length > p + 1) undo(); return; } const f = future.findIndex((e) => e.id === id); if (f >= 0) while (future.length > f) redo(); }

  // ---------- the toast stack: several at once, each keeps its own Undo ----------
  function host() { let h = document.getElementById('xw-toasts'); if (!h) { h = document.createElement('div'); h.id = 'xw-toasts'; h.setAttribute('role', 'region'); h.setAttribute('aria-label', 'Notifications'); h.setAttribute('aria-live', 'polite'); document.body.appendChild(h); } return h; }
  function dismiss(id) { document.querySelectorAll(`#xw-toasts [data-hid="${id}"]`).forEach((n) => n.remove()); }
  function toast(msg, e, o = {}) {
    const h = host(), n = document.createElement('div'); n.className = 'xh-toast'; n.setAttribute('role', 'status'); if (e) n.dataset.hid = e.id;
    n.innerHTML = `<span>${esc(msg)}</span>${e ? '<button data-h="undo">Undo</button><kbd>Ctrl Z</kbd>' : o.redo ? '<button data-h="redo">Redo</button><kbd>Ctrl ⇧ Z</kbd>' : ''}<button class="xh-x" data-h="close" aria-label="Dismiss">×</button>`;
    let t = 0; const arm = () => { clearTimeout(t); t = setTimeout(() => n.remove(), LIFE); };
    n.addEventListener('pointerenter', () => clearTimeout(t)); n.addEventListener('pointerleave', arm); n.addEventListener('focusin', () => clearTimeout(t)); n.addEventListener('focusout', arm);
    n.addEventListener('click', (ev) => { const b = ev.target.closest('[data-h]'); if (!b) return; n.remove();
      if (b.dataset.h === 'undo' && e) { const i = past.indexOf(e); if (i === past.length - 1) undo(); else if (i >= 0) jump(e.id); }
      if (b.dataset.h === 'redo') redo(); });
    h.appendChild(n); while (h.children.length > SHOW) h.firstElementChild.remove(); arm();
  }

  // ---------- the history drawer: every change, yours and your teammates', and you can jump to any of yours ----------
  let open = false, filter = 'mine';
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 50 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  function drawer(refresh) {
    let d = document.getElementById('xw-history');
    if (refresh && !d) return;
    if (!d) { d = document.createElement('aside'); d.id = 'xw-history'; d.setAttribute('aria-label', 'History'); d.tabIndex = -1; document.body.appendChild(d);
      d.addEventListener('click', (ev) => { const b = ev.target.closest('[data-h]'); if (!b) return; const a = b.dataset.h;
        if (a === 'close') toggle(false); else if (a === 'f') { filter = b.dataset.v; drawer(true); } else if (a === 'jump') jump(+b.dataset.id); else if (a === 'undo') undo(); else if (a === 'redo') redo(); }); }
    const others = (window.XENO_LIVE_LOG || []).filter((x) => x.tab !== 'self').map((x) => ({ id: 'r' + x.at, label: x.what, by: x.by, at: x.at, state: 'theirs' }));
    const rows = (filter === 'mine' ? log : [...log, ...others].sort((a, b) => b.at - a.at));
    const top = past[past.length - 1];
    d.innerHTML = `<header><b>History</b><span class="xh-seg" role="group" aria-label="Show">${[['mine', 'Yours'], ['all', 'Everyone']].map(([v, l]) => `<button data-h="f" data-v="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}</span><button class="xh-x" data-h="close" aria-label="Close history">×</button></header>
      <div class="xh-acts"><button data-h="undo" ${past.length ? '' : 'disabled'}>Undo<kbd>Ctrl Z</kbd></button><button data-h="redo" ${future.length ? '' : 'disabled'}>Redo<kbd>Ctrl ⇧ Z</kbd></button></div>
      ${rows.length ? `<ol>${rows.map((e) => `<li class="xh-${e.state}${e === top ? ' xh-now' : ''}"><div><b>${esc(e.label)}</b><small>${esc(e.by === 'you' ? 'You' : e.by)} · ${ago(e.at)}${e.state === 'undone' ? ' · undone' : ''}</small></div>${e.state === 'theirs' ? '' : e === top ? '<span class="xh-tag">Current</span>' : `<button data-h="jump" data-id="${e.id}">${e.state === 'undone' ? 'Redo to here' : 'Back to here'}</button>`}</li>`).join('')}${filter === 'mine' ? `<li class="xh-start${past.length ? '' : ' xh-now'}"><div><b>Start of this session</b><small>Before any of these changes</small></div>${past.length ? '<button data-h="jump" data-id="0">Back to here</button>' : '<span class="xh-tag">Current</span>'}</li>` : ''}</ol>`
        : `<p class="xh-empty">Nothing yet. Changes you can take back appear here — Ctrl Z undoes the latest, Ctrl ⇧ Z brings it back.</p>`}`;
  }
  function toggle(on = !open) { open = on; if (on) { drawer(); const d = document.getElementById('xw-history'); d.classList.add('on'); d.focus(); } else document.getElementById('xw-history')?.classList.remove('on'); }

  const typing = (t) => t.closest && t.closest('input,textarea,select,[contenteditable]');
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || typing(e.target) || document.querySelector('.xd')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) { e.preventDefault(); redo(); } else if (k === 'h' && e.shiftKey) { e.preventDefault(); toggle(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && document.getElementById('xw-history')?.contains(document.activeElement)) toggle(false); });

  window.XENO_HIST = { record, undo, redo, jump, toggle, toast, list: () => log.map(({ fn, ...e }) => e), canUndo: () => past.length > 0, canRedo: () => future.length > 0 };
})();
