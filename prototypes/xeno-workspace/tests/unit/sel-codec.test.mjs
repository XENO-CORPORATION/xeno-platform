// The ?sel= address codec (F-03): every id round-trips, a comma and a percent are not separators or errors, and the
// codec this replaces is kept verbatim as a witness, so the round-trip tests are not passing against an invented defect.
import test from 'node:test'; import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadCore, plain } from './load-core.mjs';

const S = loadCore('select-core.js').XENO_SEL_CORE;
const ROUND = ['a,b', '50%', 'a b', 'a+b', 'a&b', 'a#b', 'a?b=c', 'ünï ✓', 'x%y,z', '%2C'];

test('every id round-trips through the address, including commas, percents, spaces, plus, ampersands, hashes and unicode', () => {
  const address = `#/overview/g/community?view=1&sel=${S.formatSel(ROUND)}`;
  assert.deepEqual(plain(S.parseSel(S.selRaw(address.split('?')[1]))), ROUND);
});

test('formatSel encodes each id and joins with a literal comma', () => {
  assert.equal(S.formatSel(['a,b', '50%']), 'a%2Cb,50%25');
  assert.equal(S.formatSel([]), '');
});

test('parseSel splits on a literal comma before it decodes, so an encoded comma stays inside its id', () => {
  assert.deepEqual(plain(S.parseSel('a%2Cb,50%25')), ['a,b', '50%']);
});

test('a plus is a space, as it is in a query string; an encoded plus stays a plus', () => {
  assert.deepEqual(plain(S.parseSel('a+b')), ['a b']);
  assert.deepEqual(plain(S.parseSel('a%2Bb')), ['a+b']);
});

test('a part that is not valid percent-encoding is kept as written, and empty parts are dropped', () => {
  assert.deepEqual(plain(S.parseSel('50%')), ['50%']);
  assert.deepEqual(plain(S.parseSel(',a,,b,')), ['a', 'b']);
  assert.deepEqual(plain(S.parseSel('')), []);
});

test('selRaw reads the sel parameter the way a query string is read: decoded names, the first equals sign splits', () => {
  assert.equal(S.selRaw('view=1&sel=a%2Cb'), 'a%2Cb');
  assert.equal(S.selRaw('%73el=x'), 'x', 'an encoded name matches');
  assert.equal(S.selRaw('sel=a=b'), 'a=b', 'only the first equals sign splits');
  assert.equal(S.selRaw('sel'), '', 'a bare name is an empty selection');
  assert.equal(S.selRaw('x=1'), null, 'no sel parameter at all');
  assert.equal(S.selRaw(''), null);
});

test('selRaw keeps a malformed name as written and carries on to the next parameter', () => {
  assert.equal(S.selRaw('%E0%A4%A=1&sel=2'), '2');
});

test('the first sel parameter wins, as URLSearchParams.get does', () => {
  assert.equal(S.selRaw('sel=first&sel=second'), 'first');
});

test('witness: the codec this replaces, verbatim from app.js (before C5), splits an id that holds a comma and throws on a percent', () => {
  // app.js:1211 at HEAD before C5, unchanged: URLSearchParams decodes, then the value is split and decoded again
  const ctx = vm.createContext({ URLSearchParams, location: { hash: '#/p?sel=a%2Cb' } });
  vm.runInContext("var getOld = () => { const q = location.hash.split('?')[1] || ''; const v = new URLSearchParams(q).get('sel'); return v ? v.split(',').map((x) => decodeURIComponent(x)).filter(Boolean) : []; };", ctx);
  assert.deepEqual(plain(ctx.getOld()), ['a', 'b'], 'one id, a,b, comes back as two');
  ctx.location.hash = '#/p?sel=50%25';
  assert.throws(() => ctx.getOld(), (e) => e.name === 'URIError', 'the percent decodes once in URLSearchParams and again in the codec');
});
