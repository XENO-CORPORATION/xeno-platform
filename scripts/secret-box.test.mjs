/**
 * secret-box.test.mjs — regression tests for at-rest secret encryption.
 *
 * These exist because the failure they guard against is silent. An encryption
 * helper that quietly falls back to storing plaintext, or that decrypts a
 * tampered value into garbage, looks exactly like a working one until the day
 * it matters. Every assertion below is about that: fail loudly, never silently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, isEncrypted, isConfigured } from '../src/server/utils/secretBox.js';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');
const SECRET = 'ya29.a0AfB_by-REAL-LOOKING-TOKEN-1234567890';

test('with no key configured, encrypt REFUSES rather than storing plaintext', () => {
  delete process.env.SECRET_BOX_KEY;
  assert.equal(isConfigured(), false);
  assert.throws(() => encrypt(SECRET), /not configured/i,
    'encrypt must throw without a key — a silent plaintext fallback is the exact bug this guards');
});

test('with no key, legacy plaintext still reads (so this deploys before the backfill)', () => {
  delete process.env.SECRET_BOX_KEY;
  assert.equal(decrypt('ya29.legacy-plaintext'), 'ya29.legacy-plaintext');
});

test('round-trips exactly, and the plaintext never appears in the envelope', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  const sealed = encrypt(SECRET);
  assert.equal(decrypt(sealed), SECRET);
  assert.ok(!sealed.includes(SECRET), 'plaintext leaked into the stored value');
  assert.equal(isEncrypted(sealed), true);
  assert.equal(isEncrypted(SECRET), false);
});

test('the same input encrypts differently each time (IV is not reused)', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  assert.notEqual(encrypt(SECRET), encrypt(SECRET));
});

test('encrypting an already-encrypted value is a no-op (backfill is re-runnable)', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  const once = encrypt(SECRET);
  assert.equal(encrypt(once), once);
});

test('null and empty pass through untouched (columns stay nullable)', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(''), '');
  assert.equal(decrypt(null), null);
});

test('a TAMPERED ciphertext throws instead of decrypting to garbage', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  const parts = encrypt(SECRET).split('.');
  const data = Buffer.from(parts[3], 'base64');
  data[0] ^= 0xff;
  parts[3] = data.toString('base64');
  // This is why GCM and not CBC: garbage would otherwise be sent upstream as a
  // bearer token.
  assert.throws(() => decrypt(parts.join('.')));
});

test('the WRONG key throws instead of decrypting to garbage', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  const sealed = encrypt(SECRET);
  process.env.SECRET_BOX_KEY = KEY_B;
  assert.throws(() => decrypt(sealed));
});

test('a malformed envelope throws', () => {
  process.env.SECRET_BOX_KEY = KEY_A;
  assert.throws(() => decrypt('v1.notbase64'));
});

test('a key of the wrong length is rejected, not padded', () => {
  process.env.SECRET_BOX_KEY = Buffer.from('short').toString('base64');
  assert.throws(() => encrypt(SECRET), /32 bytes/i);
  process.env.SECRET_BOX_KEY = KEY_A;
});

test('hex-encoded keys are accepted as well as base64', () => {
  process.env.SECRET_BOX_KEY = Buffer.alloc(32, 3).toString('hex');
  assert.equal(decrypt(encrypt(SECRET)), SECRET);
  process.env.SECRET_BOX_KEY = KEY_A;
});
