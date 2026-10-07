/* XENO Workspace — one registry of keyboard shortcuts (XENO MODES - SPEC §7y).
   Each module declares the keys it handles, next to the code that handles them:
     XENO_KEYS.add('Undo and history', 'Ctrl Z', 'Undo')
   The shortcuts sheet (Ctrl / or ?) is drawn from this registry, so it can only list keys some module declared.
   Loaded before every other module. A key string is space-separated keys ("Ctrl ⇧ Z"); "or" separates
   alternatives ("Ctrl ⇧ Z or Ctrl Y"). */
(() => {
  const ORDER = ['General', 'Moving around', 'Undo and history', 'Selecting', 'Moving things', 'Library and lists', 'Notifications', 'Prototype'];
  const groups = new Map();
  function add(group, keys, label) {
    if (!groups.has(group)) groups.set(group, []);
    const g = groups.get(group); if (!g.some((x) => x.keys === keys && x.label === label)) g.push({ keys, label });
  }
  const list = () => [...groups.entries()].sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));
  window.XENO_KEYS = { add, list, all: () => list().flatMap(([g, rows]) => rows.map((r) => ({ group: g, ...r }))) };
})();
