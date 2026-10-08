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

test('the Undo on an older toast jumps to that change, which undoes the newer ones (today)', () => {
  const { h, store } = make({ 'xw.n': '0' });
  h.gesture(); store.set('xw.n', '1'); const a = h.record('a', () => store.set('xw.n', '0'));
  h.gesture(); store.set('xw.n', '2'); h.record('b', () => store.set('xw.n', '1'));
  h.undoFromToast(a);
  assert.equal(store.get('xw.n'), '1');
  assert.equal(h.canUndo(), true);
});

test('the Undo on a toast whose change is no longer recorded, with nothing left, says Nothing to undo (today)', () => {
  const { h, effects } = make({});
  h.undoFromToast(999);
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

test('a record with nothing stored and no function stays on the stack, and its undo fails (today)', () => {
  const { h, effects } = make({});
  h.record('nothing stored', null);
  assert.equal(h.canUndo(), true);
  assert.equal(h.undo(), false);
  assert.equal(effects.toasts.some((t) => t.msg === 'That couldn’t be undone'), true);
});
