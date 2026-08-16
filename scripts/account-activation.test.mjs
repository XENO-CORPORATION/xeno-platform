/**
 * Pins the account-activation gate.
 *
 * The gate exists because one-click Google signup produced ~95% dead accounts,
 * and neither existing field could express "this person meant it":
 *
 *   users.email_verified          hardcoded TRUE on the OAuth insert — every
 *                                 Google account is verified before anything is
 *                                 verified. Not a lie (Google did confirm the
 *                                 address); simply a different question.
 *   users.workspace_activated_at  already a TRACTION METRIC, set by
 *                                 v2MeRoutes on the first /api/v2/me call.
 *                                 Gating on it would corrupt the metric and
 *                                 auto-satisfy the gate.
 *
 * So the tests below assert the two things that make this gate real: it FAILS
 * CLOSED, and it is not wired to anything that would open it by accident.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activationToken, verifyActivationToken, activationUrl, requireActivated,
} from '../src/server/services/accountActivation.js';

const UID = '890c7130-93ef-43dc-af41-877f08cbb5a1';

// ── the token ──────────────────────────────────────────────────────────────

test('a token verifies for its own user and nobody else', () => {
  const t = activationToken(UID);
  assert.equal(verifyActivationToken(UID, t), true);
  assert.equal(verifyActivationToken('00000000-0000-0000-0000-000000000000', t), false,
    'a token minted for one account activates another — that is account takeover');
});

test('garbage, empty and truncated tokens are refused', () => {
  for (const bad of ['', null, undefined, 'x', activationToken(UID).slice(0, -1), `${activationToken(UID)}x`]) {
    assert.equal(verifyActivationToken(UID, bad), false, `accepted a bad token: ${JSON.stringify(bad)}`);
  }
});

test('the URL carries both halves and points at the API, not the SPA', () => {
  const u = activationUrl(UID);
  assert.match(u, /\/api\/auth\/activate\?/, 'must hit the API — the SPA cannot verify an HMAC');
  assert.match(u, new RegExp(`u=${UID}`));
  assert.match(u, /[?&]t=[A-Za-z0-9_-]+$/);
});

// ── the gate ───────────────────────────────────────────────────────────────

function res() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const nextSpy = () => { const f = () => { f.called = true; }; f.called = false; return f; };

test('an ACTIVATED user passes', async () => {
  const r = res(); const next = nextSpy();
  requireActivated({ user: { id: UID }, db: { query: async () => ({ rows: [{ '?column?': 1 }] }) } }, r, next);
  await new Promise((s) => setTimeout(s, 5));
  assert.equal(next.called, true, 'an activated user was blocked');
  assert.equal(r.code, null);
});

test('an UNACTIVATED user is refused 403 — with a remedy, not a dead end', async () => {
  const r = res(); const next = nextSpy();
  requireActivated({ user: { id: UID }, db: { query: async () => ({ rows: [] }) } }, r, next);
  await new Promise((s) => setTimeout(s, 5));
  assert.equal(next.called, false, 'an unactivated user reached the platform');
  assert.equal(r.code, 403);
  assert.equal(r.body.code, 'account_not_activated');
  assert.equal(r.body.remedy, 'resend_activation',
    'a bare 403 with no remedy sends the user to support instead of to the fix');
});

test('🔴 the gate FAILS CLOSED when its own check breaks', async () => {
  // The direction that matters. A gate that opens when it cannot check is not a
  // gate, and this ecosystem has shipped exactly that before.
  const r = res(); const next = nextSpy();
  requireActivated({ user: { id: UID }, db: { query: async () => { throw new Error('db gone'); } } }, r, next);
  await new Promise((s) => setTimeout(s, 5));
  assert.equal(next.called, false, 'the gate OPENED when the database was unreachable');
  assert.equal(r.code, 503);
});

test('an unauthenticated request is 401, never silently allowed', async () => {
  const r = res(); const next = nextSpy();
  requireActivated({ user: null, db: {} }, r, next);
  await new Promise((s) => setTimeout(s, 5));
  assert.equal(next.called, false);
  assert.equal(r.code, 401);
});

// ── wiring: the gate must be REACHABLE, and not on the wrong doors ─────────

const idx = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');

test('the gate is actually applied to platform routes', () => {
  // Built-but-unwired is this codebase's most repeated defect: xeno-workflow's
  // 76 node types, xeno-tools' uncalled install, the forum's unwritable
  // subscriptions. A middleware nothing mounts is the same shape.
  const gated = ['/api/xeno', '/api/image', '/api/video', '/api/conversion', '/api/workspaces'];
  for (const m of gated) {
    const line = idx.split('\n').find((l) => l.includes(`app.use('${m}'`) && l.includes('authMiddleware'));
    assert.ok(line, `no authed mount found for ${m}`);
    assert.match(line, /requireActivated/, `${m} is not behind the activation gate`);
  }
});

test('🔴 the gate is NOT on the doors that would lock people out', () => {
  // Blocking these turns "confirm your email" into "your account is broken".
  for (const m of ["'/api/auth'", "'/api/email'", "'/api/forum'", "'/api/billing'"]) {
    const line = idx.split('\n').find((l) => l.includes(`app.use(${m}`));
    if (!line) continue;
    assert.doesNotMatch(line, /requireActivated/,
      `${m} is behind the activation gate — an unactivated user could not sign in, `
      + 'read the public Record, unsubscribe, or pay');
  }
});

test('the welcome email is what delivers the activation link', () => {
  // The mail stopped being a courtesy the moment it became the only way in.
  const svc = readFileSync(new URL('../src/server/services/emailService.js', import.meta.url), 'utf8');
  assert.match(svc, /activateUrl:\s*activationUrl\(user\.id\)/,
    'sendWelcomeEmail does not pass an activation link — new accounts would have no way to activate');
  assert.match(svc, /activateUrl \|\|/,
    'the template does not consume activateUrl');
});
