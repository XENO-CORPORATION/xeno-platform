// Characterization of the selection core (C4): what select.js does today, with no browser. Behaviour that a later fix
// changes is marked "(today)" and is replaced by that fix's own test when it lands.
import test from 'node:test'; import assert from 'node:assert/strict';
import { loadCore, plain } from './load-core.mjs';

const S = loadCore('select-core.js').XENO_SEL_CORE;

// rows: { key: [ids on screen, in order] }. The effects record what the model asked the page to do.
function fakeSelection(rows = {}) {
  const effects = { paints: 0, bars: 0, urls: [], copies: 0, errors: [] };
  const store = { rows: { ...rows } };
  const core = S.createSelection({
    rowIds: (def) => (store.rows[def.key] || []).slice(),
    paint: () => { effects.paints += 1; },
    urlWrite: (ids) => { effects.urls.push([...ids]); },
    bar: () => { effects.bars += 1; },
    copyLink: () => { effects.copies += 1; return 'copied'; },
    logError: (err) => { effects.errors.push(err); },
  });
  return { core, effects, store };
}
const ids = (c) => (c.current() ? [...c.current().ids] : []);

test('words says the count with the right noun', () => {
  assert.equal(S.words(['thread', 'threads'], 1), '1 thread');
  assert.equal(S.words(['thread', 'threads'], 3), '3 threads');
});

test('rangeIds runs between the anchor and the target in list order; no anchor on the list means a toggle', () => {
  assert.deepEqual(plain(S.rangeIds(['a', 'b', 'c', 'd'], 'b', 'd')), ['b', 'c', 'd']);
  assert.deepEqual(plain(S.rangeIds(['a', 'b', 'c'], 'c', 'a')), ['a', 'b', 'c']);
  assert.deepEqual(plain(S.rangeIds(['a', 'b', 'c'], null, 'c')), ['c']);
  assert.equal(S.rangeIds(['a', 'b'], 'zz', 'b'), null);
});

test('extendNext returns the neighbour in the direction, or null at the edge', () => {
  assert.equal(S.extendNext(['a', 'b', 'c'], 'a', 1), 'b');
  assert.equal(S.extendNext(['a', 'b', 'c'], 'c', 1), null);
  assert.equal(S.extendNext(['a', 'b', 'c'], 'a', -1), null);
});

test('flatten drops Clear selection and disabled actions; barPick takes three ordinary verbs and one dangerous one', () => {
  const groups = [
    [{ label: 'Copy' }, { label: 'Clear selection' }, { label: 'Gone', disabled: true }],
    [{ label: 'Move to trash', danger: true }],
    [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
  ];
  const flat = S.flatten(groups);
  assert.deepEqual(plain(flat.map((x) => x.k)), ['0.0', '1.0', '2.0', '2.1', '2.2']);
  const pick = S.barPick(flat);
  assert.deepEqual(plain(pick.map((x) => x.it.label)), ['Copy', 'A', 'B', 'Move to trash']);
  assert.equal(flat.length > pick.length, true, 'More is offered when there is more than the bar shows');
});

test('clickIntent: a plain click is left alone, an interactive control is left alone, a modifier selects, shift makes a range', () => {
  assert.equal(S.clickIntent({ mods: false, interactive: false, shift: false }), null);
  assert.equal(S.clickIntent({ mods: true, interactive: true, shift: false }), null);
  assert.equal(S.clickIntent({ mods: true, interactive: false, shift: false }), 'toggle');
  assert.equal(S.clickIntent({ mods: true, interactive: false, shift: true }), 'range');
});

test('keyIntent: Escape clears only with something selected and no menu open; X, Ctrl A and Shift arrows select', () => {
  assert.equal(S.keyIntent({ key: 'Escape', count: 2, menuOpen: false }), 'clear');
  assert.equal(S.keyIntent({ key: 'Escape', count: 0, menuOpen: false }), null);
  assert.equal(S.keyIntent({ key: 'Escape', count: 2, menuOpen: true }), null);
  assert.equal(S.keyIntent({ key: 'x' }), 'toggle');
  assert.equal(S.keyIntent({ key: 'X', alt: true }), null);
  assert.equal(S.keyIntent({ key: 'a', ctrl: true }), 'all');
  assert.equal(S.keyIntent({ key: 'a', meta: true }), 'all');
  assert.equal(S.keyIntent({ key: 'ArrowDown', shift: true }), 'down');
  assert.equal(S.keyIntent({ key: 'ArrowUp', shift: true }), 'up');
  assert.equal(S.keyIntent({ key: 'ArrowDown' }), null);
});

test('Alt selects nothing: Ctrl A and Shift arrows with Alt are not selection keys (F-13)', () => {
  assert.equal(S.keyIntent({ key: 'a', ctrl: true, alt: true }), null);
  assert.equal(S.keyIntent({ key: 'ArrowDown', shift: true, alt: true }), null);
});

test('toggle adds, moves the anchor, and clearing the last id ends the selection; every change paints and writes the address', () => {
  const { core, effects } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'b');
  assert.deepEqual(plain(ids(core)), ['b']);
  assert.equal(core.current().anchor, 'b');
  assert.deepEqual(effects.urls.at(-1), ['b']);
  core.toggle(L, 'b');
  assert.equal(core.current(), null);
  assert.deepEqual(effects.urls.at(-1), []);
  assert.equal(effects.paints, 2);
});

test('range keeps the anchor where the toggle left it; with no anchor a range is just the target', () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c', 'd'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'b');
  core.range(L, 'd');
  assert.deepEqual(plain(ids(core)), ['b', 'c', 'd']);
  assert.equal(core.current().anchor, 'b', 'range does not move the anchor');
  core.clearSelection();
  core.range(L, 'c');
  assert.deepEqual(plain(ids(core)), ['c']);
  assert.equal(core.current().anchor, null);
});

test('a range from an anchor that is not on the list becomes a toggle of the target (today; a ghost id stays)', () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'zz');
  core.range(L, 'c');
  assert.deepEqual(plain(ids(core)), ['zz', 'c']);
  assert.equal(core.current().anchor, 'c');
});

test('selectAll adds every row on screen and leaves the anchor alone', () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'b');
  core.selectAll(L);
  assert.deepEqual(plain(ids(core)).sort(), ['a', 'b', 'c']);
  assert.equal(core.current().anchor, 'b');
});

test('extend seeds from the focused row when nothing is selected, then adds the next row', () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.extend(L, 'a', 'b');
  assert.deepEqual(plain(ids(core)), ['a', 'b']);
  assert.equal(core.current().anchor, 'a');
  core.extend(L, 'b', 'c');
  assert.deepEqual(plain(ids(core)), ['a', 'b', 'c']);
  assert.equal(core.current().anchor, 'a');
});

test('clearSelection says whether it cleared; a clear with nothing selected writes nothing', () => {
  const { core, effects } = fakeSelection({ list: ['a'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  assert.equal(core.clearSelection(), false);
  assert.equal(effects.urls.length, 0);
  core.toggle(L, 'a');
  assert.equal(core.clearSelection(), true);
  assert.deepEqual(effects.urls.at(-1), []);
  assert.equal(core.count(), 0);
});

test('selectedIn is true only for a selection of more than one that holds the row', () => {
  const { core } = fakeSelection({ list: ['a', 'b'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'a');
  assert.equal(core.selectedIn(L, 'a'), false, 'one selected is not a selection');
  core.toggle(L, 'b');
  assert.equal(core.selectedIn(L, 'a'), true);
  assert.equal(core.selectedIn(L, 'z'), false);
});

test('show takes an owner with more than one item, which replaces the core selection; a single item is no owner', () => {
  const { core, effects } = fakeSelection({ list: ['a'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'a');
  const owner = { count: 2, noun: ['file', 'files'], sections: () => [[{ label: 'Trash', run() {} }]], clear() {} };
  core.show(owner);
  assert.equal(core.current(), null, 'the core selection is cleared');
  assert.equal(core.count(), 2);
  assert.equal(effects.bars, 1);
  core.show({ count: 1, clear() {} });
  assert.equal(core.count(), 0, 'one item is not an owner');
});

test('dismissFromBar clears the owner when there is one, and the core selection otherwise', () => {
  const { core, effects } = fakeSelection({ list: ['a', 'b'] });
  let cleared = 0;
  core.show({ count: 2, noun: ['file', 'files'], sections: () => [], clear() { cleared += 1; } });
  core.dismissFromBar();
  assert.equal(cleared, 1);
  assert.equal(effects.urls.length, 0, 'the owner writes its own address');
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'a');
  core.show(null);
  core.dismissFromBar();
  assert.equal(core.count(), 0);
});

test('sections: a verb runs, and afterwards the selection clears unless the verb keeps it; the link keeps it', async () => {
  const { core, effects } = fakeSelection({ list: ['a', 'b'] });
  const ran = [];
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: (xs) => [[{ label: `Copy ${xs.length}`, run: () => { ran.push(xs.length); } }]] });
  core.toggle(L, 'a');
  const secs = core.sections();
  assert.equal(secs[0][0].label, 'Copy 1');
  assert.equal(secs.at(-1)[0].label, 'Copy link to this selection');
  assert.equal(secs.at(-1)[0].keep, true);
  await secs[0][0].run();
  assert.deepEqual(ran, [1]);
  assert.equal(core.count(), 0, 'a verb that does not keep the selection clears it');
  core.toggle(L, 'b');
  await core.sections().at(-1)[0].run();
  assert.equal(effects.copies, 1);
  assert.equal(core.count(), 1, 'the link keeps the selection');
});

test('an owner with a missing group still shows its other groups (F-17)', () => {
  const { core } = fakeSelection({ list: ['a'] });
  core.show({ count: 2, noun: ['file', 'files'], sections: () => [null, [{ label: 'Trash' }]], clear() {} });
  assert.deepEqual(plain(core.sections().map((g) => g.map((x) => x.label))), [['Trash'], ['Copy link to this selection']]);
});

test('sections with an owner: the owner groups, then the link', () => {
  const { core } = fakeSelection({ list: ['a'] });
  core.show({ count: 2, noun: ['file', 'files'], sections: () => [[{ label: 'Trash' }]], clear() {} });
  const secs = core.sections();
  assert.deepEqual(plain(secs.map((g) => g[0].label)), ['Trash', 'Copy link to this selection']);
});

test('a missing action group is skipped, not fatal (F-17)', () => {
  const { core } = fakeSelection({ list: ['a', 'b'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => [null, [{ label: 'Solo' }]] });
  core.toggle(L, 'a');
  const secs = core.sections();
  assert.deepEqual(plain(secs.map((g) => g.map((x) => x.label))), [['Solo'], ['Copy link to this selection']]);
});

test('barModel gives the label, the verbs on the bar and whether More is needed; null when nothing is selected', () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => [[{ label: 'Copy' }, { label: 'Share' }, { label: 'Tag' }, { label: 'Pin' }], [{ label: 'Trash', danger: true }]] });
  assert.equal(core.barModel(), null);
  core.toggle(L, 'a'); core.toggle(L, 'b');
  const m = core.barModel();
  assert.equal(m.label, '2 rows');
  assert.deepEqual(plain(m.pick.map((x) => x.it.label)), ['Copy', 'Share', 'Tag', 'Trash']);
  assert.equal(m.more, true);
});

test('restore selects the ids on screen in the order of the address, the first hit is the anchor, once per address', () => {
  const { core, store } = fakeSelection({ list: ['a', 'b', 'c'] });
  core.list({ key: 'list', noun: ['row', 'rows'] });
  const r = core.restore(['c', 'a'], '#/p');
  assert.deepEqual(plain(r.first), 'c');
  assert.deepEqual(plain(ids(core)), ['c', 'a']);
  assert.equal(core.current().anchor, 'c');
  assert.equal(core.restore(['c'], '#/p'), null, 'a selection is already there');
  core.clearSelection();
  assert.equal(core.restore(['a'], '#/p'), null, 'the same address is not applied twice');
  store.rows.list = ['x'];
  assert.equal(core.restore(['a'], '#/p2'), null, 'an address with nothing on screen is not applied');
});

test('restore remembers an address only when it applied something (today)', () => {
  const { core, store } = fakeSelection({ list: ['a'] });
  core.list({ key: 'list', noun: ['row', 'rows'] });
  assert.equal(core.restore(['zz'], '#/h'), null);
  store.rows.list = ['a', 'zz'];
  assert.deepEqual(plain(core.restore(['zz'], '#/h').first), 'zz');
});

test('leavePlace drops the selection and repaints, and writes no address', () => {
  const { core, effects } = fakeSelection({ list: ['a'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'] });
  core.toggle(L, 'a');
  const urls = effects.urls.length;
  core.leavePlace();
  assert.equal(core.current(), null);
  assert.equal(effects.urls.length, urls, 'no address write');
  assert.ok(effects.paints >= 2);
});

test('a finished action clears only a selection that did not change while it ran (F-14)', async () => {
  const { core } = fakeSelection({ list: ['a', 'b', 'c'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => [[{ label: 'Slow', run: () => new Promise((res) => setTimeout(res, 5)) }]] });
  core.toggle(L, 'a');
  const pending = core.sections()[0][0].run();
  core.toggle(L, 'b');
  await pending;
  assert.deepEqual(plain(ids(core)).sort(), ['a', 'b']);
});

test('a rejected action is logged, keeps the selection, and reports not ok (F-15)', async () => {
  const { core, effects } = fakeSelection({ list: ['a', 'b'] });
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => [[{ label: 'Boom', run: () => Promise.reject(new Error('refused')) }]] });
  core.toggle(L, 'a'); core.toggle(L, 'b');
  const r = await core.sections()[0][0].run();
  assert.equal(r.ok, false);
  assert.equal(effects.errors.length, 1);
  assert.deepEqual(plain(ids(core)).sort(), ['a', 'b']);
});

test('the bar runs the action it showed: the same label at the same place runs (F-16)', async () => {
  const { core } = fakeSelection({ list: ['a', 'b'] });
  const ran = [];
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => [[{ label: 'Copy', run: () => { ran.push('copy'); } }]] });
  core.toggle(L, 'a');
  const it = core.itemAt('0.0', 'Copy');
  assert.ok(it, 'the action is found');
  await it.run();
  assert.deepEqual(ran, ['copy']);
});

test('a changed action at the place the bar drew runs nothing (F-16)', () => {
  const { core } = fakeSelection({ list: ['a', 'b'] });
  let n = 0; const ran = [];
  const L = core.list({ key: 'list', noun: ['row', 'rows'], actions: () => { n += 1; return [[{ label: `Verb ${n}`, run: () => { ran.push(n); } }]]; } });
  core.toggle(L, 'a');
  core.barModel();                                  // the bar draws Verb 1
  assert.equal(core.itemAt('0.0', 'Verb 1'), null, 'the place now holds another label');
  assert.deepEqual(ran, []);
});

test('list fills in the default noun when none is given', () => {
  const { core } = fakeSelection({});
  const d = core.list({ key: 'x' });
  assert.deepEqual(plain(d.noun), ['item', 'items']);
  assert.equal(core.defs().length, 1);
});
