/* XENO Workspace — the history's logic, with no browser in it (XENO FRAMEWORK - DECISION.md, milestone 1).
   createHistory(ports) returns the undo/redo model for one workspace. Every browser touchpoint arrives through ports
   (storage, clock, the reload chain, toasts, the drawer, the location and the error log), so this file runs in a
   bare JavaScript context: the tests load it with vm and fake ports. The adapter (history.js) keeps every DOM effect.
   An entry is plain data. The area's undo function lives in a private map, released when the entry leaves the stacks.
   Classic script: it sets one global, XENO_HIST_CORE, and nothing else. */
(function (root) {
  'use strict';
  const MAX = 100;
  const MAX_UNDO_FAILURES = 2;   // a write that fails this many times in a row retires its entry
  const COPY = {
    cantUndo: 'That couldn’t be undone',
    cantRedo: 'That couldn’t be redone',
    nothingUndo: 'Nothing to undo',
    nothingRedo: 'Nothing to redo',
    kept: 'Undone — kept a change someone else made since',
    keptRedo: 'Redone — kept a change someone else made since',
    undid: (label) => `Undid: ${label}`,
    redid: (label) => `Redid: ${label}`,
    undidMany: (n) => `Undid ${n} changes`,
    redidMany: (n) => `Redid ${n} changes`,
  };
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  const pick = (from, keys) => Object.fromEntries(keys.map((k) => [k, from[k] ?? null]));
  const isWorkspaceKey = (k) => !!k && k.startsWith('xw.') && !k.startsWith('xw.live.');
  const isUndoKey = (key, mod, alt) => !!mod && !alt && /^[zyh]$/i.test(String(key));
  // which history action a key press asks for; the adapter has already checked the modifier and the focus
  function keyIntent({ key, shift, mod, alt }) {
    if (!mod || alt) return null;   // Alt is a character key on some layouts (AltGr), never a history key
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
      try {
        Object.entries(vals).forEach(([k, v]) => { const cur = ports.kv.get(k); if (expect && cur !== expect[k]) { kept++; return; } if (v == null) ports.kv.remove(k); else ports.kv.set(k, v); });
      } finally {
        // the reading moves to what the store holds now, even after a failed write, so the next change is not charged with these writes
        try { ports.reloadHooks(); } catch (err) { ports.logError(err); }   // the values are written by now: a render that fails is logged, not a failed undo
        pre = snap();
      }
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
    // a retired entry keeps its log row, but it cannot be taken back again and its function is released
    function retire(e) { e.state = 'retired'; forget(e); ports.toast(COPY.cantUndo); return false; }
    function undoEntry(e) {
      if (!e || e.state !== 'done') return false;
      ports.watch();
      const fn = inverses.get(e.id);
      if (!fn && !e.before) return retire(e);
      if (!e.used && fn && (e.gen === gen || !e.before)) {  // the area's own undo, then measure what it changed
        const s1 = snap();
        try { fn(); } catch (err) { ports.logError(err); return retire(e); }
        try { ports.persist(); } catch {}
        const s2 = snap(), keys = diff(s1, s2); pre = s2;   // what the area's own undo left is the new reading
        if (keys.length) { e.after = pick(s1, keys); e.before = pick(s2, keys); }
        e.used = true;
      } else {
        try { const kept = write(e.before, e.after); if (kept) ports.toast(COPY.kept); }
        catch (err) { ports.logError(err); e.failures = (e.failures || 0) + 1; if (e.failures >= MAX_UNDO_FAILURES) return retire(e); ports.toast(COPY.cantUndo); return false; }
        e.failures = 0;
      }
      e.state = 'undone'; return true;
    }
    // a redo that cannot be written is dropped: the entry is retired, and the toast says it could not be redone
    function retireRedo(e) { e.state = 'retired'; forget(e); ports.toast(COPY.cantRedo); return false; }
    function redoEntry(e) {
      if (!e || e.state !== 'undone') return false;
      if (!e.after) return retireRedo(e);   // nothing was stored, so there is nothing to write
      try { const kept = write(e.after, e.before); if (kept) ports.toast(COPY.keptRedo); }
      catch (err) { ports.logError(err); e.failures = (e.failures || 0) + 1; if (e.failures >= MAX_UNDO_FAILURES) return retireRedo(e); ports.toast(COPY.cantRedo); return false; }
      e.failures = 0; e.state = 'done'; return true;
    }
    // one step of each: the entry it moved, or null. A quiet step leaves its toast to the caller that sums up several.
    function undoStep(quiet) {
      const e = past.pop(); if (!e) { if (!quiet) ports.toast(COPY.nothingUndo); return null; }
      if (!undoEntry(e)) { if (e.state === 'done') past.push(e); return null; }
      future.push(e); ports.dismiss(e.id);
      if (!quiet) { ports.toast(COPY.undid(e.label), { entryId: e.id, redo: true }); ports.refresh(); }
      return e;
    }
    function redoStep(quiet) {
      const e = future.pop(); if (!e) { if (!quiet) ports.toast(COPY.nothingRedo); return null; }
      if (!redoEntry(e)) { if (e.state === 'undone') future.push(e); return null; }
      past.push(e);
      if (!quiet) { ports.toast(COPY.redid(e.label), { entryId: e.id, undo: true }); ports.refresh(); }
      return e;
    }
    function undo() { return undoStep(false) !== null; }
    function redo() { return redoStep(false) !== null; }
    // the Undo on a toast takes back the named change and every newer one, newest first, under one summary. A step that
    // fails ends the walk. The summary's Redo names the newest change taken back, so it restores all of them.
    function undoThrough(id) {
      if (!past.some((e) => e.id === id)) { ports.toast(COPY.nothingUndo); return false; }
      const done = [];
      while (past.some((e) => e.id === id)) { const e = undoStep(true); if (!e) break; done.push(e); }
      if (!done.length) return false;
      ports.toast(done.length === 1 ? COPY.undid(done[0].label) : COPY.undidMany(done.length), { entryId: done[0].id, redo: true });
      ports.refresh();
      return true;
    }
    // the Redo on a toast restores the older undone changes first, then the named one, under one summary
    function redoThrough(id) {
      if (!future.some((e) => e.id === id)) { ports.toast(COPY.nothingRedo); return false; }
      const done = [];
      while (future.some((e) => e.id === id)) { const e = redoStep(true); if (!e) break; done.push(e); }
      if (!done.length) return false;
      ports.dismiss(id);
      ports.toast(done.length === 1 ? COPY.redid(done[0].label) : COPY.redidMany(done.length), { entryId: done[done.length - 1].id, undo: true });
      ports.refresh();
      return true;
    }
    // jump: go to the state right after an entry; id 0 is the start of the session, before any of these changes
    function jump(id) {
      if (id === 0) { while (past.length && undo()) { /* a failing step ends the walk */ } return; }
      const p = past.findIndex((e) => e.id === id); if (p >= 0) { while (past.length > p + 1 && undo()) { /* a failing step ends the walk */ } return; }
      const f = future.findIndex((e) => e.id === id); if (f >= 0) while (future.length > f && redo()) { /* a failing step ends the walk */ }
    }
    // what a drawer row offers: Current for the top change; Back to here for a change still on the undo stack; Redo to
    // here for an undone change still on the redo stack; nothing for anything else (inert, retired, or overtaken)
    function drawerAction(e) {
      if (past.length && past[past.length - 1] === e) return 'current';
      if (past.includes(e)) return 'back';
      if (future.includes(e)) return 'redo';
      return null;
    }
    return {
      record, undo, redo, jump, undoThrough, redoThrough,
      gesture() { pre = snap(); },
      // another window changed a key: this window's reading of it moves with the store, so its next record does not claim the change
      observe(key, value) { if (key == null) { pre = snap(); return; } if (!isWorkspaceKey(key)) return; if (value == null) delete pre[key]; else pre[key] = value; },
      noteReload() { gen++; },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      list: () => log.map((e) => ({ ...e })),
      view: () => ({ log: log.slice(), past: past.length, future: future.length, top: past[past.length - 1], action: drawerAction }),
      // how many changes a toast's Undo (kind 'undo') or Redo (kind 'redo') takes back: the named change and every newer one
      walkLength(id, kind) { const stack = kind === 'redo' ? future : past; const i = stack.findIndex((e) => e.id === id); return i < 0 ? 0 : stack.length - i; },
      stats: () => ({ past: past.length, future: future.length, log: log.length, inverses: inverses.size }),
    };
  }

  root.XENO_HIST_CORE = { createHistory, COPY, MAX, diff, pick, isWorkspaceKey, isUndoKey, keyIntent, ago };
})(this);
