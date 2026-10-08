/* XENO Workspace — the history's logic, with no browser in it (XENO FRAMEWORK - DECISION.md, milestone 1).
   createHistory(ports) returns the undo/redo model for one workspace. Every browser touchpoint arrives through ports
   (storage, clock, the reload chain, toasts, the drawer, the location and the error log), so this file runs in a
   bare JavaScript context: the tests load it with vm and fake ports. The adapter (history.js) keeps every DOM effect.
   An entry is plain data. The area's undo function lives in a private map, released when the entry leaves the stacks.
   Classic script: it sets one global, XENO_HIST_CORE, and nothing else. */
(function (root) {
  'use strict';
  const MAX = 100;
  const COPY = {
    cantUndo: 'That couldn’t be undone',
    nothingUndo: 'Nothing to undo',
    nothingRedo: 'Nothing to redo',
    kept: 'Undone — kept a change someone else made since',
    keptRedo: 'Redone — kept a change someone else made since',
    undid: (label) => `Undid: ${label}`,
    redid: (label) => `Redid: ${label}`,
  };
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  const pick = (from, keys) => Object.fromEntries(keys.map((k) => [k, from[k] ?? null]));
  const isWorkspaceKey = (k) => !!k && k.startsWith('xw.') && !k.startsWith('xw.live.');
  const isUndoKey = (key, mod) => !!mod && /^[zyh]$/i.test(String(key));
  // which history action a key press asks for; the adapter has already checked the modifier and the focus
  function keyIntent({ key, shift, mod }) {
    if (!mod) return null;
    const k = String(key).toLowerCase();
    if (k === 'z' && !shift) return 'undo';
    if ((k === 'z' && shift) || (k === 'y' && !shift)) return 'redo';
    if (k === 'h' && shift) return 'drawer';
    return null;
  }
  const ago = (t, now) => { const s = Math.round((now - t) / 1000); return s < 50 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

  function createHistory(ports) {
    const past = [], future = [], log = []; // log keeps every entry, undone ones too, for the drawer
    const inverses = new Map();             // entry id -> the area's function that takes the change back
    let seq = 0, gen = 0;                   // gen counts reloads of the in-memory store
    const snap = () => {
      const o = {};
      try { for (const k of ports.kv.keys()) if (isWorkspaceKey(k)) o[k] = ports.kv.get(k); } catch {}
      return o;
    };
    let pre = snap();                       // the reading the next change is measured from
    const forget = (e) => { inverses.delete(e.id); };
    // writes the stored values back; a value is only written if it still holds what the history left there
    function write(vals, expect) {
      let kept = 0;
      Object.entries(vals).forEach(([k, v]) => { const cur = ports.kv.get(k); if (expect && cur !== expect[k]) { kept++; return; } if (v == null) ports.kv.remove(k); else ports.kv.set(k, v); });
      ports.reloadHooks();
      return kept;
    }
    function record(label, fn, opts = {}) {
      const e = { id: ++seq, label: String(label), at: ports.clock.now(), by: 'you', state: 'done', area: opts.area || ports.area() };
      ports.watch(); e.gen = gen;
      try { ports.persist(); } catch {}
      const now = snap(), keys = diff(pre, now);
      if (keys.length) { e.before = pick(pre, keys); e.after = pick(now, keys); }
      pre = now;
      future.forEach(forget); future.length = 0;   // a new change ends the redo stack, whatever it is
      log.unshift(e); if (log.length > MAX) log.pop();
      // a change with nothing stored and no function cannot be taken back: it is logged, and it is not on the stack
      if (!keys.length && typeof fn !== 'function') { e.state = 'inert'; ports.toast(label); ports.refresh(); return e.id; }
      if (typeof fn === 'function') inverses.set(e.id, fn);
      past.push(e); if (past.length > MAX) forget(past.shift());
      ports.toast(label, { entryId: e.id, undo: true }); ports.refresh();
      return e.id;
    }
    // a generation: while an entry's generation is current its own undo function is safe (its closures still point at
    // live objects) and is preferred; after any reload only the recorded values are trusted
    function undoEntry(e) {
      if (!e || e.state !== 'done') return false;
      ports.watch();
      const fn = inverses.get(e.id);
      if (!fn && !e.before) { ports.toast(COPY.cantUndo); return false; }
      if (!e.used && fn && (e.gen === gen || !e.before)) {  // the area's own undo, then measure what it changed
        const s1 = snap();
        try { fn(); } catch (err) { ports.logError(err); ports.toast(COPY.cantUndo); return false; }
        try { ports.persist(); } catch {}
        const s2 = snap(), keys = diff(s1, s2);
        if (keys.length) { e.after = pick(s1, keys); e.before = pick(s2, keys); }
        e.used = true;
      } else {
        const kept = write(e.before, e.after);
        if (kept) ports.toast(COPY.kept);
      }
      e.state = 'undone'; return true;
    }
    function redoEntry(e) {
      if (!e || e.state !== 'undone' || !e.after) return false;
      const kept = write(e.after, e.before); if (kept) ports.toast(COPY.keptRedo);
      e.state = 'done'; return true;
    }
    function undo() {
      const e = past.pop(); if (!e) { ports.toast(COPY.nothingUndo); return false; }
      if (!undoEntry(e)) return false;
      future.push(e); ports.dismiss(e.id); ports.toast(COPY.undid(e.label), { redo: true }); ports.refresh();
      return true;
    }
    function redo() {
      const e = future.pop(); if (!e) { ports.toast(COPY.nothingRedo); return false; }
      if (!redoEntry(e)) return false;
      past.push(e); ports.toast(COPY.redid(e.label), { entryId: e.id, undo: true }); ports.refresh();
      return true;
    }
    // jump: go to the state right after an entry; id 0 is the start of the session, before any of these changes
    function jump(id) {
      if (id === 0) { while (past.length) undo(); return; }
      const p = past.findIndex((e) => e.id === id); if (p >= 0) { while (past.length > p + 1) undo(); return; }
      const f = future.findIndex((e) => e.id === id); if (f >= 0) while (future.length > f) redo();
    }
    // the Undo on a toast: the newest change is undone; an older one is jumped to
    function undoFromToast(id) {
      const i = past.findIndex((e) => e.id === id);
      if (i === past.length - 1) return undo();
      if (i >= 0) jump(id);
      return undefined;
    }
    return {
      record, undo, redo, jump, undoFromToast,
      gesture() { pre = snap(); },
      noteReload() { gen++; },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      list: () => log.map((e) => ({ ...e })),
      view: () => ({ log: log.slice(), past: past.length, future: future.length, top: past[past.length - 1] }),
      stats: () => ({ past: past.length, future: future.length, log: log.length, inverses: inverses.size }),
    };
  }

  root.XENO_HIST_CORE = { createHistory, COPY, MAX, diff, pick, isWorkspaceKey, isUndoKey, keyIntent, ago };
})(this);
