/**
 * An account created with Google can add a password and then sign in either way.
 *
 * 162 of 218 accounts arrived through "Sign in with Google" and therefore have no
 * password_hash. Until 2026-09-10 every one of them was excluded from recovery by
 * a single condition in /forgot-password — `user.password_hash` — so the flow was:
 *
 *   ask to recover  ->  "If an account exists, a link is on its way."  ->  nothing.
 *
 * The generic response exists to stop email enumeration, and it did its job so
 * well that a total dead end was indistinguishable from a working one. Nobody
 * could report it as broken because it never said anything was wrong.
 *
 * The second defect was quieter and worse: bcrypt.compare(password, null) THROWS,
 * so an OAuth-only account attempting password login got a 500 while a genuinely
 * wrong password got a 401 — a status-code oracle for which accounts have no
 * password set.
 *
 * These are source-level assertions, deliberately. The behaviour they protect is
 * exercised against a real database and a real HTTP server in
 * src/server/tests/account-recovery.test.mjs; what rots here is the CONDITION —
 * one `&& user.password_hash` put back would close the door again silently, and
 * that is what this file is watching.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import service from '../src/server/services/emailService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authRoutes = fs.readFileSync(path.join(ROOT, 'src/server/routes/authRoutes.js'), 'utf8');

/** The body of one route handler, so an assertion cannot match a different one. */
function handler(method, route) {
  const start = authRoutes.indexOf(`router.${method}('${route}'`);
  assert.ok(start > 0, `no ${method.toUpperCase()} ${route} handler`);
  const next = authRoutes.indexOf('\nrouter.', start + 1);
  return authRoutes.slice(start, next === -1 ? authRoutes.length : next);
}

test('forgot-password does not require an existing password', () => {
  const body = handler('post', '/forgot-password');
  assert.match(body, /if \(user && user\.is_active\)/,
    'an active account gets a link whether or not it already has a password');
  assert.doesNotMatch(body, /user && user\.is_active && user\.password_hash/,
    'the password_hash condition excluded every Google account from recovery');
  // It must still refuse a suspended account, and still say nothing either way.
  assert.match(body, /is_active/, 'a suspended account must not receive a reset link');
  assert.match(body, /If an account exists for that email/,
    'the response stays generic, so the endpoint cannot enumerate addresses');
});

test('the reset link is issued and mailed on the same path as before', () => {
  const body = handler('post', '/forgot-password');
  assert.match(body, /INSERT INTO password_resets/, 'a single-use token row is written');
  assert.match(body, /expires_at\s*\)?\s*\n?\s*VALUES[\s\S]*INTERVAL '1 hour'/,
    'the token still expires');
  assert.match(body, /sendEmail\(req\.db, 'password_reset'/, 'the mail is still sent');
  assert.match(body, /settingFirstPassword/, 'the template is told which situation this is');
});

test('setting the password writes to the same account row, so the two sign-ins converge', () => {
  const body = handler('post', '/reset-password');
  assert.match(body, /UPDATE users SET password_hash = \$1/,
    'the password lands on the users row — the same row oauth_accounts points at');
  assert.match(body, /DELETE FROM user_sessions WHERE user_id = \$1/,
    'a recovery still revokes every existing session');
  assert.match(body, /used_at = NOW\(\)[\s\S]*used_at IS NULL/,
    'the token is still single-use and claimed atomically');
});

test('password login finds the account by email, not by credential type', () => {
  const body = handler('post', '/login');
  assert.match(body, /FROM users\s*\n?\s*WHERE email = ANY/,
    'login resolves the same users row an OAuth sign-in resolves');
  assert.doesNotMatch(body, /oauth_accounts/,
    'login must not exclude accounts that also have a provider linked');
});

test('a missing password hash is a failed login, never a 500 and never a timing tell', () => {
  const verify = authRoutes.slice(
    authRoutes.indexOf('async function verifyPassword'),
    authRoutes.indexOf('async function verifyPassword') + 700,
  );
  /* This asserted the literal `typeof hashedPassword !== 'string' ||
   * hashedPassword.length === 0` until 2026-09-10. The NAME of the test was
   * right and that expression turned out to be too narrow to satisfy it: an
   * OAuth account's hash is neither absent nor empty — `users.password_hash` is
   * NOT NULL, so signup writes a 64-hex placeholder — and a malformed hash
   * reaches bcrypt, which rejects it in microseconds against ~100 ms for a real
   * comparison. The timing tell this test is named after was open for exactly
   * the accounts it was written to protect.
   *
   * So it now asserts the OUTCOME: every unusable hash, placeholder included,
   * goes through the dummy comparison. `hasUsablePassword` is checked against
   * real data shapes in scripts/oauth-password-shape.test.mjs. */
  assert.match(verify, /if \(!hasUsablePassword\(hashedPassword\)\)/,
    'the unusable-hash case — absent, empty, OR the OAuth placeholder — is handled before bcrypt sees it');
  assert.match(verify, /await bcrypt\.compare\([\s\S]*?ABSENT_PASSWORD_HASH\)/,
    'the absent case still pays for a full comparison, or the status oracle just '
    + 'becomes a timing oracle');
  assert.match(verify, /return false;/, 'and it resolves false rather than throwing');
  assert.match(authRoutes, /const ABSENT_PASSWORD_HASH = bcrypt\.hashSync\(/,
    'the dummy hash is real bcrypt work, not a constant string');
});

test('the email tells a Google user the truth about what changes', () => {
  const first = service.templates.password_reset({
    displayName: 'Ana', resetUrl: 'https://xenostudio.ai/reset-password?token=t',
    expiresIn: '1 hour', settingFirstPassword: true,
  });
  assert.match(first.subject, /Set a password/, '"reset" is wrong for someone who never had one');
  assert.match(first.html, /signs in with Google today and has no password yet/);
  assert.match(first.html, /You keep both/, 'the fear is losing Google access; answer it');
  assert.match(first.html, /still signs in with Google exactly as before/,
    'the did-not-request case must not imply Google stopped working');

  const ordinary = service.templates.password_reset({
    displayName: 'Ana', resetUrl: 'https://xenostudio.ai/reset-password?token=t', expiresIn: '1 hour',
  });
  assert.match(ordinary.subject, /Reset your XENO password/);
  assert.doesNotMatch(ordinary.html, /You keep both/,
    'an ordinary reset must not mention Google');
  assert.match(ordinary.html, /Your current password still works/);
});

test('both variants are the same mechanism — only the words differ', () => {
  const url = 'https://xenostudio.ai/reset-password?token=identical';
  const a = service.templates.password_reset({ displayName: 'A', resetUrl: url, expiresIn: '1 hour', settingFirstPassword: true });
  const b = service.templates.password_reset({ displayName: 'A', resetUrl: url, expiresIn: '1 hour' });
  for (const mail of [a, b]) {
    assert.ok(mail.html.includes(url), 'same link');
    assert.match(mail.html, /expires in 1 hour/, 'same expiry');
    assert.match(mail.html, /treat it like the password itself/, 'same warning');
  }
});
