/* XENO Workspace — the selection's logic, with no browser in it (XENO FRAMEWORK - DECISION.md, milestone 1).
   createSelection(ports) owns one selection, the lists that can hold one, and the owner that keeps its own model (the
   Library). Every browser touchpoint arrives through ports: the rows on screen, the marks and the bar, the address and
   the copy helper. So the model runs in a bare JavaScript context, and the tests load it with vm and fake ports. The
   adapter (select.js) maps DOM to ids and keeps the pointer, keyboard and right-click wiring. Classic script: it sets
   one global, XENO_SEL_CORE, and nothing else. */
(function (root) {
  'use strict';
  const words = (noun, n) => `${n} ${n === 1 ? noun[0] : noun[1]}`;
  // the ids between an anchor and a target, in list order; null when there is no anchor on the list (a toggle)
  const rangeIds = (ordered, anchor, target) => {
    const a = ordered.indexOf(anchor ?? target), b = ordered.indexOf(target);
    if (a < 0) return null;
    return a < b ? ordered.slice(a, b + 1) : ordered.slice(b, a + 1);
  };
  const extendNext = (ordered, focusedId, dir) => ordered[ordered.indexOf(focusedId) + dir] || null;
  // the bar's candidates: every action that is not Clear and not disabled, with its position in the groups
  const flatten = (groups) => groups.flatMap((g, gi) => g.map((it, i) => ({ it, k: `${gi}.${i}` }))).filter(({ it }) => !/^Clear selection$/.test(it.label) && !it.disabled);
  // up to three ordinary verbs on the bar, then one dangerous one set apart; everything is also under More
  const barPick = (flat) => [...flat.filter(({ it }) => !it.danger).slice(0, 3), ...flat.filter(({ it }) => it.danger).slice(0, 1)];
  // what a click asks for: a modifier selects, shift selects a range, and an interactive control is left alone
  const clickIntent = ({ mods, interactive, shift }) => (!mods || interactive ? null : shift ? 'range' : 'toggle');
  // what a key press asks for; the adapter has already checked the focus and the open dialog
  function keyIntent({ key, ctrl, meta, alt, shift, count, menuOpen }) {
    if (key === 'Escape') return count > 0 && !menuOpen ? 'clear' : null;
    const k = String(key).toLowerCase();
    if (k === 'x' && !ctrl && !meta && !alt) return 'toggle';
    if (alt) return null;   // Alt is a character key on some layouts (AltGr): it selects nothing
    if ((ctrl || meta) && k === 'a') return 'all';
    if (shift && (key === 'ArrowDown' || key === 'ArrowUp')) return key === 'ArrowDown' ? 'down' : 'up';
    return null;
  }

  // the ?sel= address codec: the raw value of the sel parameter, read the way a query string is read (names are decoded,
  // the first '=' splits, '+' is a space); each id is written with encodeURIComponent and the ids join with a literal comma
  const decodePart = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  function selRaw(query) {
    for (const part of String(query ?? '').split('&')) {
      const eq = part.indexOf('=');
      if (decodePart((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' ')) === 'sel') return eq < 0 ? '' : part.slice(eq + 1);
    }
    return null;
  }
  // the separator is a literal comma, and only then is each id decoded; a part that is not valid percent-encoding is kept as written
  const parseSel = (raw) => String(raw ?? '').split(',').map((p) => decodePart(p.replace(/\+/g, ' '))).filter(Boolean);
  const formatSel = (ids) => ids.map((id) => encodeURIComponent(id)).join(',');
  // the groups a list or an owner hands out may hold a missing group or a missing action: both are skipped
  const groupsOf = (groups, wrap = (it) => it) => (groups || []).filter(Boolean).map((g) => g.filter(Boolean).map(wrap)).filter((g) => g.length);
  function createSelection(ports) {
    const lists = [];       // the lists, in registration order; the core reads only noun and actions from each
    let cur = null;         // { def, ids: Set, anchor }
    let ext = null;         // a list that keeps its own model (the Library): { count, noun, sections, clear }
    let restored = '';      // the address whose ?sel= has been applied
    let rev = 0;            // counts every change: an action that finishes after one does not clear the new selection
    const leaveHooks = [];  // what a page keeps that a place change must forget (the Library's picks)
    // every change is shown and written to the address; leaving a place only repaints (it never writes an address)
    const changed = () => { rev += 1; ports.paint(); ports.urlWrite(cur ? [...cur.ids] : []); };
    const state = (def) => { if (!cur || cur.def !== def) cur = { def, ids: new Set(), anchor: null }; return cur; };
    // the address of exactly this selection (Drive, Linear)
    const linkItem = () => ({ label: 'Copy link to this selection', icon: 'share', keep: true, run: () => ports.copyLink() });
    function clearSelection() { if (!cur) return false; cur = null; changed(); return true; }
    function sections() {
      if (ext) return [...groupsOf(ext.sections()), [linkItem()]];
      if (!cur) return [];
      const ids = [...cur.ids], done = () => { clearSelection(); };
      const wrap = (it) => ({ ...it, run: async (...a) => {
        const seen = rev;
        try { const r = await it.run?.(...a); if (!it.keep && rev === seen) done(); return { ok: true, value: r }; }
        catch (err) { ports.logError(err); return { ok: false, error: err }; }   // a rejected action is contained: the selection stays
      } });
      return [...groupsOf(cur.def.actions(ids), wrap), [linkItem()]];
    }
    const count = () => (ext ? ext.count : cur ? cur.ids.size : 0);
    // what the bar shows: null when nothing is selected, else its label, its verbs and whether More is needed
    function barModel() {
      const n = count(); if (!n) return null;
      const secs = sections();
      const label = ext ? words(ext.noun, n) : words(cur.def.noun, n);
      const flat = flatten(secs), pick = barPick(flat);
      return { label, pick, more: flat.length > pick.length };
    }
    function list(def) { const d = { noun: ['item', 'items'], ...def }; lists.push(d); return d; }
    function toggle(def, id) { const s = state(def); s.ids.has(id) ? s.ids.delete(id) : s.ids.add(id); s.anchor = id; if (!s.ids.size) cur = null; changed(); }
    function range(def, id) {
      const s = state(def), ids = rangeIds(ports.rowIds(def), s.anchor, id);
      if (!ids) return toggle(def, id);
      ids.forEach((x) => s.ids.add(x)); changed();
    }
    function selectAll(def) { const s = state(def); ports.rowIds(def).forEach((x) => s.ids.add(x)); changed(); }
    function extend(def, focusedId, nextId) { const s = state(def); if (!s.ids.size) { s.ids.add(focusedId); s.anchor = focusedId; } s.ids.add(nextId); changed(); }
    // a list with its own model shows its bar only with more than one item; the bar then belongs to it
    function show(x) { ext = x && x.count > 1 ? x : null; if (ext) cur = null; ports.bar(); }
    // Escape and the bar's Clear: the owner clears its own model; otherwise the core's selection clears
    function dismissFromBar() { if (ext) { ext.clear(); return; } clearSelection(); }
    // a place is left (hash or Back): the selection and its restore memo go, and the marks are repainted
    // a place is left: the selection, the owner's bar and the restore memo go, and each hook forgets what it keeps. The
    // address is never written here: a hash change already carries one. inApp says the app itself changed place.
    function leavePlace({ inApp = false } = {}) {
      cur = null; ext = null; restored = '';
      for (const h of leaveHooks) { try { h({ inApp }); } catch (err) { ports.logError(err); } }
      ports.paint();
    }
    function onLeave(fn) { leaveHooks.push(fn); }
    // a link with ?sel= selects the ids that are on screen, once per address, in the first list that has any
    function restore(want, hash) {
      if (!want.length || cur || restored === hash) return null;
      for (const def of lists) {
        const have = ports.rowIds(def), hit = want.filter((id) => have.includes(id));
        if (hit.length) { restored = hash; cur = { def, ids: new Set(hit), anchor: hit[0] }; return { def, first: hit[0] }; }
      }
      return null;
    }
    // the action drawn at a bar position, if it is still there with the label that was drawn; null otherwise
    function itemAt(key, label) { const [g, i] = String(key).split('.').map(Number); const it = sections()[g]?.[i]; return it && it.label === label ? it : null; }
    function current() { return cur ? { def: cur.def, ids: [...cur.ids], anchor: cur.anchor } : null; }
    const selectedIn = (def, id) => !!(cur && cur.def === def && cur.ids.size > 1 && cur.ids.has(id));
    return {
      list, toggle, range, selectAll, extend, clearSelection, dismissFromBar, show, leavePlace, restore, itemAt, onLeave,
      sections, barModel, count, ids: () => (cur ? [...cur.ids] : []), current, selectedIn, defs: () => lists.slice(),
    };
  }

  root.XENO_SEL_CORE = { createSelection, words, rangeIds, extendNext, flatten, barPick, clickIntent, keyIntent, selRaw, parseSel, formatSel };
})(this);
