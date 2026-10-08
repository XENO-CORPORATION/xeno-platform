// Characterization of the history core (C3): what history.js does today, with no browser. Behaviour that a later fix
// changes is marked "(today)" and is replaced by that fix's own test when it lands.
import test from 'node:test'; import assert from 'node:assert/strict';
import { loadCore, plain, fakeHistoryPorts } from './load-core.mjs';

const H = loadCore('history-core.js').XENO_HIST_CORE;
function make(initial = {}) {
  const f = fakeHistoryPorts(initial);
  return { ...f, h: H.createHistory(f.ports) };
}

test('diff reports the keys that changed, were added or were removed', () => {
  assert.deepEqual(plain(H.diff({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })), ['b', 'c']);
  assert.deepEqual(plain(H.diff({ a: '1' }, {})), ['a']);
  assert.deepEqual(plain(H.diff({ a: '1' }, { a: '1' })), []);
});

test('ago reads the clock it is given', () => {
  assert.equal(H.ago(0, 10_000), 'just now');
  assert.equal(H.ago(0, 120_000), '2 min ago');
  assert.equal(H.ago(0, 7_200_000), '2 h ago');
});

test('keyIntent maps undo, redo and the drawer, and needs the modifier', () => {
  assert.equal(H.keyIntent({ key: 'z', shift: false, mod: true }), 'undo');
  assert.equal(H.keyIntent({ key: 'Z', shift: true, mod: true }), 'redo');
  assert.equal(H.keyIntent({ key: 'y', shift: false, mod: true }), 'redo');
  assert.equal(H.keyIntent({ key: 'h', shift: true, mod: true }), 'drawer');
  assert.equal(H.keyIntent({ key: 'h', shift: false, mod: true }), null);
  assert.equal(H.keyIntent({ key: 'z', shift: false, mod: false }), null);
});

test('isUndoKey matches z, y and h only with the modifier', () => {
  assert.equal(H.isUndoKey('z', true), true);
  assert.equal(H.isUndoKey('H', true), true);
  assert.equal(H.isUndoKey('a', true), false);
  assert.equal(H.isUndoKey('z', false), false);
});

test('the Undo on a toast for one change names that change (F-09)', () => {
  const { h, store, effects } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  assert.equal(h.undoThrough(a), true);
  assert.equal(store.get('xw.n'), '0');
  assert.equal(effects.toasts.at(-1).msg, 'Undid: a');
  assert.equal(effects.toasts.at(-1).spec.entryId, a);
});

test('the Redo on a toast restores the older undone change first, then the named one, under one summary (F-10)', () => {
  const { h, store, effects } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  h.gesture(); store.set('xw.n', '2'); const b = h.record('b', () => store.set('xw.n', '1'));
  h.undo(); h.undo();
  assert.equal(store.get('xw.n'), '0');
  assert.equal(h.redoThrough(b), true);
  assert.equal(store.get('xw.n'), '2');
  assert.equal(effects.toasts.at(-1).msg, 'Redid 2 changes');
  assert.equal(effects.toasts.at(-1).spec.entryId, b);
});

test('walkLength counts the named change and every newer one, for an Undo and for a Redo (F-09, F-10)', () => {
  const { h, store } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  h.gesture(); store.set('xw.n', '2'); const b = h.record('b', () => store.set('xw.n', '1'));
  h.gesture(); store.set('xw.n', '3'); const c = h.record('c', () => store.set('xw.n', '2'));
  assert.equal(h.walkLength(c, 'undo'), 1);
  assert.equal(h.walkLength(b, 'undo'), 2);
  assert.equal(h.walkLength(a, 'undo'), 3);
  assert.equal(h.walkLength(999, 'undo'), 0);
  h.undoThrough(a);
  assert.equal(h.walkLength(a, 'redo'), 1);
  assert.equal(h.walkLength(b, 'redo'), 2);
  assert.equal(h.walkLength(c, 'redo'), 3);
  assert.equal(h.walkLength(a, 'undo'), 0, 'an undone change is not on the undo stack');
});

test('the Redo on a toast whose change is not undone says so (F-10)', () => {
  const { h, effects } = make({});
  assert.equal(h.redoThrough(42), false);
  assert.equal(effects.toasts.at(-1).msg, 'Nothing to redo');
});

test('a write that fails keeps the entry on the stack, and its second failure in a row retires it (F-04)', () => {
  const { h, store, setFailWrites } = make({ 'xw.a': '1' });
  h.gesture(); store.set('xw.a', '2'); h.record('set a', () => {});
  h.noteReload();
  setFailWrites(true);
  assert.equal(h.undo(), false);
  assert.equal(h.canUndo(), true, 'the first failure keeps the entry');
  assert.equal(h.undo(), false);
  assert.equal(h.canUndo(), false, 'the second failure retires it');
  assert.equal(h.list()[0].state, 'retired');
});

test('a write that succeeds after a failure clears the count and takes the change back (F-04)', () => {
  const { h, store, setFailWrites } = make({ 'xw.a': '1' });
  h.gesture(); store.set('xw.a', '2'); h.record('set a', () => {});
  h.noteReload();
  setFailWrites(true); h.undo(); setFailWrites(false);
  assert.equal(h.undo(), true);
  assert.equal(store.get('xw.a'), '1');
  assert.equal(h.list()[0].state, 'undone');
});

test('a function that throws retires its entry at once, and its error is logged (F-04)', () => {
  const { h, effects } = make({});
  h.gesture();
  h.record('throws', () => { throw new Error('x'); });
  assert.equal(h.undo(), false);
  assert.equal(h.canUndo(), false);
  assert.equal(h.list()[0].state, 'retired');
  assert.equal(effects.errors.length, 1);
});

test('jump stops at the first failing step, so a failure cannot loop (F-04)', () => {
  const { h, store, setFailWrites, attempts } = make({ 'xw.n': '0' });
  const ids = [];
  for (const v of ['1', '2', '3']) { h.gesture(); store.set('xw.n', v); ids.push(h.record(`set ${v}`, () => {})); }
  h.noteReload();
  setFailWrites(true);
  h.jump(ids[0]);
  assert.equal(attempts(), 1, 'one attempt, then the walk stops');
  assert.equal(h.canUndo(), true);
});

test('a redo of a change that stored nothing is dropped at once, and says so (F-05)', () => {
  const { h, effects } = make({});
  h.gesture();
  h.record('mem', () => {});
  assert.equal(h.undo(), true);
  assert.equal(h.redo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.list()[0].state, 'retired');
  assert.equal(effects.toasts.at(-1).msg, 'That couldn’t be redone');
});

test('a redo whose write fails keeps the entry, and its second failure retires it (F-05)', () => {
  const { h, store, setFailWrites } = make({ 'xw.a': '1' });
  h.gesture(); store.set('xw.a', '2'); h.record('set a', () => store.set('xw.a', '1'));
  h.noteReload(); h.undo();
  setFailWrites(true);
  assert.equal(h.redo(), false);
  assert.equal(h.canRedo(), true, 'the first failure keeps the entry');
  assert.equal(h.redo(), false);
  assert.equal(h.canRedo(), false, 'the second failure retires it');
  assert.equal(h.list()[0].state, 'retired');
});

test('a reload hook that throws is logged, and the undo still counts as done (F-04)', () => {
  const f = fakeHistoryPorts({ 'xw.a': '1' });
  const h = H.createHistory({ ...f.ports, reloadHooks: () => { throw new Error('render'); } });
  h.gesture(); f.store.set('xw.a', '2'); h.record('set a', () => {});
  h.noteReload();
  assert.equal(h.undo(), true);
  assert.equal(f.store.get('xw.a'), '1');
  assert.equal(f.effects.errors.length, 1);
  assert.equal(h.list()[0].state, 'undone');
});

test('after an undo, the next record does not claim the undo\u2019s own writes (F-07)', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture(); store.set('xw.a', '2'); h.record('set a', () => store.set('xw.a', '1'));
  h.noteReload(); h.undo();
  h.record('probe', null);
  assert.equal(h.list()[0].before, undefined, 'the probe changed nothing; it holds no before');
});

test('after the area\u2019s own undo, the next record does not claim its writes (F-07, function path)', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture(); store.set('xw.a', '2'); h.record('set a', () => store.set('xw.a', '1'));
  assert.equal(h.undo(), true);
  h.record('probe', null);
  assert.equal(h.list()[0].before, undefined, 'the probe changed nothing; it holds no before');
});

test('a change another window made is not claimed by the next record of this window (F-18)', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture();
  store.set('xw.a', '5');
  h.observe('xw.a', '5');
  h.record('probe', null);
  assert.equal(h.list()[0].before, undefined, 'the other window\u2019s change is the reading, not this record');
});

test('the drawer offers Back to here only for a change on the undo stack, and Redo to here only for an undone one on the redo stack (F-11)', () => {
  const { h, store } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  h.gesture(); store.set('xw.n', '2'); const b = h.record('b', () => store.set('xw.n', '1'));
  const at = (id) => h.view().log.find((x) => x.id === id);
  assert.equal(h.view().action(at(b)), 'current');
  assert.equal(h.view().action(at(a)), 'back');
  h.undo();
  assert.equal(h.view().action(at(b)), 'redo');
  h.gesture(); store.set('xw.m', '1'); h.record('c', () => {});
  assert.equal(h.view().action(at(b)), null, 'a later change overtook the undone one');
});

test('an inert change offers no drawer action (F-11)', () => {
  const { h } = make({});
  h.record('nothing', null);
  const inert = h.view().log.find((x) => x.label === 'nothing');
  assert.equal(h.view().action(inert), null);
});

test('Alt is not a history key, so an AltGr character never undoes (F-13)', () => {
  assert.equal(H.keyIntent({ key: 'z', shift: false, mod: true, alt: true }), null);
  assert.equal(H.isUndoKey('z', true, true), false);
});

test('an inert record still ends the redo stack', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture();
  store.set('xw.a', '2');
  h.record('one', () => store.set('xw.a', '1'));
  h.noteReload();
  h.undo();
  assert.equal(h.canRedo(), true);
  h.gesture();
  h.record('nothing', null);
  assert.equal(h.list()[0].state, 'inert', 'the record is inert, so the test exercises the inert path');
  assert.equal(h.canRedo(), false);
});

test('record stores the values it changed, and nothing when the store did not change', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture();
  store.set('xw.a', '2');
  const id = h.record('set a', () => store.set('xw.a', '1'));
  const [e] = h.list();
  assert.equal(e.id, id);
  assert.deepEqual(plain(e.before), { 'xw.a': '1' });
  assert.deepEqual(plain(e.after), { 'xw.a': '2' });
  h.record('nothing', null);
  const inert = h.list()[0];
  assert.equal(inert.before, undefined);
  assert.equal(inert.after, undefined);
  assert.equal(h.canUndo(), true);
});

test('undo runs the area’s own function while its generation is current, then measures what it changed', () => {
  const { h, store, effects } = make({ 'xw.a': '1' });
  let ran = 0;
  h.gesture();
  store.set('xw.a', '2');
  h.record('set a', () => { ran += 1; store.set('xw.a', '1'); store.set('xw.b', '9'); });
  assert.equal(h.undo(), true);
  assert.equal(ran, 1);
  assert.equal(store.get('xw.a'), '1');
  assert.equal(store.get('xw.b'), '9');
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), true);
  assert.equal(effects.toasts.at(-1).msg, 'Undid: set a');
});

test('after a reload the recorded values are written back and the function is not run', () => {
  const { h, store } = make({ 'xw.a': '1' });
  let ran = 0;
  h.gesture();
  store.set('xw.a', '2');
  h.record('set a', () => { ran += 1; });
  h.noteReload();
  assert.equal(h.undo(), true);
  assert.equal(ran, 0);
  assert.equal(store.get('xw.a'), '1');
});

test('a stored value someone else changed since the history left it is kept, and says so', () => {
  const { h, store, effects } = make({ 'xw.a': '1' });
  h.gesture();
  store.set('xw.a', '2');
  h.record('set a', () => {});
  store.set('xw.a', '5');
  h.noteReload();
  assert.equal(h.undo(), true);
  assert.equal(store.get('xw.a'), '5');
  assert.equal(effects.toasts.some((t) => t.msg === 'Undone — kept a change someone else made since'), true);
});

test('a new record clears the redo stack, and redo writes the stored after values', () => {
  const { h, store } = make({ 'xw.a': '1' });
  h.gesture();
  store.set('xw.a', '2');
  h.record('one', () => store.set('xw.a', '1'));
  h.noteReload();
  h.undo();
  assert.equal(store.get('xw.a'), '1');
  assert.equal(h.canRedo(), true);
  h.noteReload();
  assert.equal(h.redo(), true);
  assert.equal(store.get('xw.a'), '2');
  h.noteReload();
  h.undo();
  h.gesture();
  store.set('xw.b', '7');
  h.record('two', null);
  assert.equal(h.canRedo(), false);
});

test('the history keeps at most 100 entries and releases the functions it drops', () => {
  const { h, store } = make({});
  for (let i = 0; i < 150; i += 1) { h.gesture(); store.set('xw.n', String(i)); h.record(`step ${i}`, () => {}); }
  assert.deepEqual(plain(h.stats()), { past: 100, future: 0, log: 100, inverses: 100 });
  assert.equal(h.list().length, 100);
});

test('undo on an empty history says so and returns false', () => {
  const { h, effects } = make({});
  assert.equal(h.undo(), false);
  assert.equal(effects.toasts.at(-1).msg, 'Nothing to undo');
});

test('jump to an entry undoes what is newer; jump to the start undoes everything; jump forward redoes', () => {
  const { h, store } = make({ 'xw.n': '0' });
  const ids = [];
  for (const v of ['1', '2', '3']) { h.gesture(); const prev = store.get('xw.n'); store.set('xw.n', v); ids.push(h.record(`set ${v}`, () => store.set('xw.n', prev))); }
  h.jump(ids[0]);
  assert.equal(store.get('xw.n'), '1');
  h.jump(0);
  assert.equal(store.get('xw.n'), '0');
  h.jump(ids[2]);
  assert.equal(store.get('xw.n'), '3');
});

test('the Undo on an older toast takes back that change and the newer ones, under one summary (F-09)', () => {
  const { h, store, effects } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  h.gesture(); store.set('xw.n', '2'); h.record('b', () => store.set('xw.n', '1'));
  h.undoThrough(a);
  assert.equal(store.get('xw.n'), '0');
  assert.equal(h.canUndo(), false);
  assert.equal(effects.toasts.at(-1).msg, 'Undid 2 changes');
});

test('the Undo on a toast whose change is no longer recorded says so (F-09)', () => {
  const { h, effects } = make({});
  h.undoThrough(999);
  assert.equal(effects.toasts.at(-1).msg, 'Nothing to undo');
});

test('list returns entries without their functions, and view describes the stacks', () => {
  const { h, store } = make({});
  h.gesture(); store.set('xw.a', '1'); h.record('one', () => {});
  const [e] = h.list();
  assert.equal('fn' in e, false);
  assert.equal(e.label, 'one');
  assert.equal(e.state, 'done');
  const v = h.view();
  assert.equal(v.past, 1);
  assert.equal(v.future, 0);
  assert.equal(v.log.length, 1);
  assert.equal(v.top.label, 'one');
});

test('a gesture takes the reading the next change is measured from', () => {
  const { h, store } = make({ 'xw.a': '1' });
  store.set('xw.a', '2');            // changed with no gesture: the next record must not claim it
  h.gesture();
  store.set('xw.a', '3');
  h.record('three', null);
  assert.deepEqual(plain(h.list()[0].before), { 'xw.a': '2' });
  assert.deepEqual(plain(h.list()[0].after), { 'xw.a': '3' });
});

test('a record with nothing to take back is logged, is not on the stack, and offers no Undo (F-06)', () => {
  const { h, effects } = make({});
  h.record('nothing stored', null);
  assert.equal(h.canUndo(), false);
  assert.equal(h.list()[0].state, 'inert');
  assert.equal(effects.toasts.at(-1).spec, null, 'the toast has no Undo');
  assert.equal(h.undo(), false);
  assert.equal(effects.toasts.some((t) => t.msg === 'Nothing to undo'), true);
});
