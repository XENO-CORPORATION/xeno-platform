/**
 * The R2 client's write-once call, against R2's real answers. An in-memory store in ledger-chain.test.mjs cannot show
 * this: on a retention-locked key R2 answers 409 ObjectLockedByBucketPolicy, not the 412 a conditional write gets
 * elsewhere (measured on production 2026-10-30), and treating that as a failure stopped every checkpoint after the first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { _internal } from '../src/server/services/artifactStorage.js';
import { checkpointKey, keyObjectKey } from '../src/server/services/ledgerChainAnchor.js';

const store = (status, seen = []) => _internal.r2Backend({
  accountId: 'acct', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'xeno-artifacts',
  fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response(status === 200 ? '' : '<Error/>', { status }); },
});

test('a free key is written, conditionally', async () => {
  const seen = [];
  assert.equal(await store(200, seen).putNew(checkpointKey(1), Buffer.from('x')), true);
  assert.equal(seen[0].init.headers['if-none-match'], '*');
  assert.match(seen[0].url, /\/xeno-artifacts\/ledger-anchors\/checkpoints\/000000000001\.json$/);
});

test('an existing key is left alone: 412, and 409 when it is retention-locked', async () => {
  assert.equal(await store(412).putNew(checkpointKey(1), Buffer.from('x')), false);
  assert.equal(await store(409).putNew(keyObjectKey('61c2d99badc8f5c4'), Buffer.from('x')), false);
});

test('anything else is an error, not "already there"', async () => {
  await assert.rejects(store(403).putNew(checkpointKey(1), Buffer.from('x')), /failed: 403/);
  await assert.rejects(store(500).putNew(checkpointKey(1), Buffer.from('x')), /failed: 500/);
});

test('the anchor stays inside its locked prefix', () => {
  assert.throws(() => store(200).putNew('checkpoints/000000000001.json', Buffer.from('x')).then(() => {}) && _internal.assertKey('checkpoints/000000000001.json'));
  assert.doesNotThrow(() => _internal.assertKey(checkpointKey(1)));
  assert.doesNotThrow(() => _internal.assertKey(keyObjectKey('61c2d99badc8f5c4')));
});
