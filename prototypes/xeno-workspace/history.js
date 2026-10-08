/* XENO Workspace — one undo/redo history for every area (XENO MODES - SPEC §7v).
   An area records an action with the words it already shows and the function that takes it back:
     XENO_HIST.record('Moved “Brief” to Trash', () => { f.trashedAt = null; sync(); })
   The model is history-core.js: framework-free, and tested without a browser. This file is the browser half: the stored
   workspace, the reload chain, the toasts, the drawer and the keys. A change is measured from the last reading of the
   stored workspace, which is taken at the start of each click or key press and after every change the history records.
   Undo and redo write back the values the change stored, and only where they still hold what the history left there, so
   they never erase a change somebody else made in the meantime. The area's function is the first choice for an undo
   only while its reading is current; it is never the only record of what changed.
   Production: the same entries become server operations with inverse ops; the drawer reads the server's log. */
(() => {
  const C = window.XENO_HIST_CORE;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SHOW = 3, LIFE = 6000;
  const core = C.createHistory({
    kv: {
      keys: () => { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; },
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
      remove: (k) => localStorage.removeItem(k),
    },
    clock: { now: () => Date.now() },
    persist: () => window.XENO_DB?.save?.(),
    reloadHooks: () => { window.XENO_DB?.reload?.(); window.XENO_WF?.reload?.(); window.XD?.applyPrefs?.(); window.XENO_PG_SYNC_NAV?.(); window.XW?.render?.(); },
    watch: () => { const D = window.XENO_DB; if (D && !D.__hist) { const r = D.reload; D.reload = (...a) => { core.noteReload(); return r.apply(D, a); }; D.__hist = true; } },
    area: () => location.hash.split('/')[3] || location.hash.split('/')[1] || 'workspace',
    toast: (msg, spec) => showToast(msg, spec),
    dismiss: (id) => dismiss(id),
    refresh: () => drawer(true),
    logError: (err) => console.error(err),
  });
  // the reading taken at the start of each user gesture: the state before whatever that gesture is about to do
  document.addEventListener('pointerdown', () => core.gesture(), true);
  document.addEventListener('keydown', (e) => { if (!C.isUndoKey(e.key, e.ctrlKey || e.metaKey)) core.gesture(); }, true);

  // ---------- the toast stack: several at once, each keeps its own Undo ----------
  function host() { let h = document.getElementById('xw-toasts'); if (!h) { h = document.createElement('div'); h.id = 'xw-toasts'; h.setAttribute('role', 'region'); h.setAttribute('aria-label', 'Notifications'); h.setAttribute('aria-live', 'polite'); document.body.appendChild(h); } return h; }
  function dismiss(id) { document.querySelectorAll(`#xw-toasts [data-hid="${id}"]`).forEach((n) => n.remove()); }
  // spec: { entryId } gives a change its own Undo; { redo } gives the Redo of an undone change
  function showToast(msg, spec = {}) {
    const h = host(), n = document.createElement('div'); n.className = 'xh-toast'; n.setAttribute('role', 'status');
    const own = spec.entryId != null; if (own) n.dataset.hid = spec.entryId;
    n.innerHTML = `<span>${esc(msg)}</span>${own ? '<button data-h="undo">Undo</button><kbd>Ctrl Z</kbd>' : spec.redo ? '<button data-h="redo">Redo</button><kbd>Ctrl ⇧ Z</kbd>' : ''}<button class="xh-x" data-h="close" aria-label="Dismiss">×</button>`;
    let t = 0; const arm = () => { clearTimeout(t); t = setTimeout(() => n.remove(), LIFE); };
    n.addEventListener('pointerenter', () => clearTimeout(t)); n.addEventListener('pointerleave', arm); n.addEventListener('focusin', () => clearTimeout(t)); n.addEventListener('focusout', arm);
    n.addEventListener('click', (ev) => { const b = ev.target.closest('[data-h]'); if (!b) return; n.remove();
      if (b.dataset.h === 'undo' && own) core.undoFromToast(spec.entryId);
      if (b.dataset.h === 'redo') core.redo(); });
    h.appendChild(n); while (h.children.length > SHOW) h.firstElementChild.remove(); arm();
  }

  // ---------- the history drawer: every change, yours and your teammates', and you can jump to any of yours ----------
  let open = false, filter = 'mine';
  const ago = (t) => C.ago(t, Date.now());
  function drawer(refresh) {
    let d = document.getElementById('xw-history');
    if (refresh && !d) return;
    if (!d) { d = document.createElement('aside'); d.id = 'xw-history'; d.setAttribute('aria-label', 'History'); d.tabIndex = -1; document.body.appendChild(d);
      d.addEventListener('click', (ev) => { const b = ev.target.closest('[data-h]'); if (!b) return; const a = b.dataset.h;
        if (a === 'close') toggle(false); else if (a === 'f') { filter = b.dataset.v; drawer(true); } else if (a === 'jump') core.jump(+b.dataset.id); else if (a === 'undo') core.undo(); else if (a === 'redo') core.redo(); }); }
    const view = core.view();
    const others = (window.XENO_LIVE_LOG || []).filter((x) => x.tab !== 'self').map((x) => ({ id: 'r' + x.at, label: x.what, by: x.by, at: x.at, state: 'theirs' }));
    const rows = (filter === 'mine' ? view.log : [...view.log, ...others].sort((a, b) => b.at - a.at));
    const top = view.top;
    d.innerHTML = `<header><b>History</b><span class="xh-seg" role="group" aria-label="Show">${[['mine', 'Yours'], ['all', 'Everyone']].map(([v, l]) => `<button data-h="f" data-v="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}</span><button class="xh-x" data-h="close" aria-label="Close history">×</button></header>
      <div class="xh-acts"><button data-h="undo" ${view.past ? '' : 'disabled'}>Undo<kbd>Ctrl Z</kbd></button><button data-h="redo" ${view.future ? '' : 'disabled'}>Redo<kbd>Ctrl ⇧ Z</kbd></button></div>
      ${rows.length ? `<ol>${rows.map((e) => `<li class="xh-${e.state}${e === top ? ' xh-now' : ''}"><div><b>${esc(e.label)}</b><small>${esc(e.by === 'you' ? 'You' : e.by)} · ${ago(e.at)}${e.state === 'undone' ? ' · undone' : ''}</small></div>${e.state === 'theirs' || e.state === 'inert' ? '' : e === top ? '<span class="xh-tag">Current</span>' : `<button data-h="jump" data-id="${e.id}">${e.state === 'undone' ? 'Redo to here' : 'Back to here'}</button>`}</li>`).join('')}${filter === 'mine' ? `<li class="xh-start${view.past ? '' : ' xh-now'}"><div><b>Start of this session</b><small>Before any of these changes</small></div>${view.past ? '<button data-h="jump" data-id="0">Back to here</button>' : '<span class="xh-tag">Current</span>'}</li>` : ''}</ol>`
        : `<p class="xh-empty">Nothing yet. Changes you can take back appear here — Ctrl Z undoes the latest, Ctrl ⇧ Z brings it back.</p>`}`;
  }
  function toggle(on = !open) { open = on; if (on) { drawer(); const d = document.getElementById('xw-history'); d.classList.add('on'); d.focus(); } else document.getElementById('xw-history')?.classList.remove('on'); }

  const typing = (t) => t.closest && t.closest('input,textarea,select,[contenteditable]');
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || typing(e.target) || document.querySelector('.xd')) return;
    const k = C.keyIntent({ key: e.key, shift: e.shiftKey, mod: true });
    if (k === 'undo') { e.preventDefault(); core.undo(); } else if (k === 'redo') { e.preventDefault(); core.redo(); } else if (k === 'drawer') { e.preventDefault(); toggle(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && document.getElementById('xw-history')?.contains(document.activeElement)) toggle(false); });

  window.XENO_KEYS?.add('Undo and history', 'Ctrl Z', 'Undo'); window.XENO_KEYS?.add('Undo and history', 'Ctrl ⇧ Z or Ctrl Y', 'Redo'); window.XENO_KEYS?.add('Undo and history', 'Ctrl ⇧ H', 'Show the history');
  // the public surface, as before
  window.XENO_HIST = {
    record: (label, fn, opts) => core.record(label, fn, opts), undo: () => core.undo(), redo: () => core.redo(), jump: (id) => core.jump(id),
    toggle: (on) => toggle(on), toast: (msg, e, o = {}) => showToast(msg, { entryId: e ? e.id : undefined, redo: !!o.redo }),
    list: () => core.list(), canUndo: () => core.canUndo(), canRedo: () => core.canRedo(),
  };
})();
