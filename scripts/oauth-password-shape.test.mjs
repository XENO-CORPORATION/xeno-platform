/**
 * An OAuth account HAS a password_hash. Everything that asks "does this user
 * have a password?" has to know that, and for a while nothing did.
 *
 * `users.password_hash` is NOT NULL. `findOrCreateOAuthUser` therefore writes
 * `crypto.randomBytes(32).toString('hex')` — a 64-character hex string that is
 * truthy and is not a bcrypt hash. So `!user.password_hash`, the obvious way to
 * spell the question, is FALSE for every Google account that has ever existed.
 *
 * Measured on production 2026-09-10: 26 accounts — 21 bcrypt, 5 with exactly
 * that 64-hex placeholder, 0 empty, 0 null.
 *
 * Two things went wrong on that assumption, and only one of them was visible:
 *
 *   1. `settingFirstPassword` could never be true, so the recovery email built
 *      for people who have never had a password would have told them "your
 *      current password still works". The feature was written, tested and
 *      unreachable — the same shape this ecosystem has now hit eight times, and
 *      this instance was introduced and found in the same session.
 *   2. A malformed hash reaches `bcrypt.compare` and is rejected in
 *      MICROSECONDS, where a real comparison costs ~100 ms. That is a timing
 *      oracle separating OAuth accounts from password accounts — precisely what
 *      `ABSENT_PASSWORD_HASH` was added to prevent, left open for the accounts
 *      it was written to protect.
 *
 * Both now go through one predicate. These assertions are about the DATA SHAPE,
 * because that is the part an implementation can silently stop matching.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasUsablePassword } from '../src/server/routes/authRoutes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'src/server/routes/authRoutes.js'), 'utf8');

test('the OAuth placeholder is recognised as NOT a password', () => {
  // The exact shape findOrCreateOAuthUser writes.
  const placeholder = 'a3f9'.repeat(16);
  assert.equal(placeholder.length, 64);
  assert.equal(hasUsablePassword(placeholder), false,
    'a 64-hex placeholder is what every OAuth account carries; treating it as a password is the bug');
  assert.equal(hasUsablePassword(''), false);
  assert.equal(hasUsablePassword(null), false);
  assert.equal(hasUsablePassword(undefined), false);
  assert.equal(hasUsablePassword('not a hash at all'), false);
});

test('a real bcrypt hash IS recognised', () => {
  for (const real of [
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    '$2y$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  ]) {
    assert.equal(hasUsablePassword(real), true, `${real.slice(0, 7)} must be accepted`);
  }
  /* If this ever rejected a real hash, every password login on the platform
   * would fail closed at once — so it is asserted separately from the negative
   * cases rather than folded in with them. */
});

test('OAuth signup still writes the placeholder this predicate expects', () => {
  /* The predicate is only correct while the producer keeps producing that shape.
   * If someone changes the placeholder — to an empty string, a fixed sentinel, a
   * real hash of a random password — this pairing has to be revisited, and a
   * silent change is exactly how the original assumption went stale. */
  assert.match(AUTH, /const oauthPlaceholderPassword = crypto\.randomBytes\(32\)\.toString\('hex'\)/,
    'findOrCreateOAuthUser no longer writes a 64-hex placeholder. Re-check hasUsablePassword against '
    + 'whatever it writes now, and against the production data, before changing this test.');
  assert.match(AUTH, /schema requires password_hash/,
    'the comment explaining WHY a placeholder exists is what stops the next reader "cleaning it up" '
    + 'into a null the NOT NULL column would reject');
});

test('the recovery email asks the predicate, never the truthiness of the column', () => {
  assert.doesNotMatch(AUTH, /settingFirstPassword\s*=\s*!user\.password_hash/,
    '`!user.password_hash` is false for every OAuth account — the variant could never fire');
  assert.match(AUTH, /settingFirstPassword = !hasUsablePassword\(user\.password_hash\)/,
    'the email variant and the login check must ask the same question');
});

test('login routes every unusable hash through the dummy comparison', () => {
  /* Not just null and empty. The placeholder is the case that matters, and it
   * used to reach the real compare — fast-rejecting a malformed hash in
   * microseconds and leaking which accounts are OAuth-only by timing alone. */
  assert.match(AUTH, /if \(!hasUsablePassword\(hashedPassword\)\) \{[\s\S]{0,200}?ABSENT_PASSWORD_HASH/,
    'an unusable hash must still pay for a full bcrypt comparison');
  assert.doesNotMatch(AUTH, /typeof hashedPassword !== 'string' \|\| hashedPassword\.length === 0/,
    'the old null-or-empty check let the 64-hex placeholder through to the real compare');
});

test('the forgot-password path is reachable for an account with no usable password', () => {
  /* It used to be gated on `user.password_hash`, which excluded exactly the
   * people who need recovery most: someone who signed in with Google and has no
   * password to reset. */
  assert.match(AUTH, /if \(user && user\.is_active\) \{/,
    'recovery must be offered on the basis of the account being usable, not on it already having a password');
  assert.doesNotMatch(AUTH, /if \(user && user\.password_hash\)/,
    'gating recovery on having a password denies it to the accounts that cannot log in without it');
});
