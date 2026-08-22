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

// ═══════════════════════════════════════════════════════════════════════════
// v2 — the code path, and the GET/POST split that is the whole security fix
// ═══════════════════════════════════════════════════════════════════════════

const routes = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');

test('🔴 GET /activate does NOT commit — a mail scanner must not activate anyone', () => {
  // The defect this replaces: v1 activated on GET, and Defender Safe Links,
  // Proofpoint and Mimecast pre-fetch every URL in an inbound message. A
  // scanner manufactured the exact proof of intent the gate exists to require.
  const get = routes.slice(
    routes.indexOf("router.get('/activate'"),
    routes.indexOf("router.post('/activate'"),
  );
  assert.ok(get.length > 0, 'the GET /activate route is missing');
  assert.doesNotMatch(get, /activateAccount\s*\(/,
    'GET /activate calls activateAccount — a link scanner can now activate accounts silently');
  // The form markup lives in the activationPage() helper, so assert the GET
  // route RENDERS that page and that the page posts. Checking only the route
  // body looked for the form where it is not, which is how this assertion
  // failed while the behaviour was already correct.
  assert.match(get, /activationPage\(/,
    'GET /activate does not render the confirmation page, so there is no way to activate');
  assert.match(routes, /function activationPage\([\s\S]*?method="POST"/,
    'the confirmation page has no POST form — the link would be decorative');
});

test('POST /activate is what commits', () => {
  const post = routes.slice(routes.indexOf("router.post('/activate'"));
  assert.match(post.slice(0, 1600), /activateAccount\s*\(/,
    'POST /activate does not activate — the link is now decorative');
});

test('the code endpoint requires a SESSION as well as the code', () => {
  const seg = routes.slice(routes.indexOf("router.post('/activate/code'"));
  const body = seg.slice(0, 1800);
  assert.match(body, /jwt\.verify/,
    'anyone could submit codes for any account, and the endpoint would leak which addresses exist');
  assert.match(body, /sessionRevoked/,
    'a revoked session could still activate');
});

test('the three code failures stay distinguishable', () => {
  const seg = routes.slice(routes.indexOf("router.post('/activate/code'"));
  for (const reason of ['expired', 'too_many_attempts', 'wrong']) {
    assert.ok(seg.includes(reason), `no distinct message for "${reason}" — "invalid" sends all three to support`);
  }
});

// ── the service's own rules ────────────────────────────────────────────────

const svc = readFileSync(new URL('../src/server/services/accountActivation.js', import.meta.url), 'utf8');

test('codes are HASHED, never stored in the clear', () => {
  assert.match(svc, /bcrypt\.hash\(code/, 'the code is stored in the clear — a table dump becomes a set of working codes');
  assert.doesNotMatch(svc, /INSERT INTO account_activation_codes[^;]*VALUES[^;]*\$2[^;]*\)\s*,\s*\[\s*userId,\s*code\b/,
    'the plaintext code is being inserted');
});

test('attempts are counted in the DATABASE, before the comparison', () => {
  // In-memory counting resets on restart and does not survive replicas, so it
  // is not a limit. Counting after the compare hands back a free guess if the
  // process dies mid-verify.
  const verify = svc.slice(svc.indexOf('export async function verifyCode'));
  const incAt = verify.indexOf('attempts = attempts + 1');
  const cmpAt = verify.indexOf('bcrypt.compare');
  assert.ok(incAt > -1, 'attempts are never incremented');
  assert.ok(incAt < cmpAt, 'the attempt is counted AFTER the comparison — a crash mid-verify is a free guess');
});

test('a code is single-use and time-boxed', () => {
  const verify = svc.slice(svc.indexOf('export async function verifyCode'));
  assert.match(verify, /consumed_at = NOW\(\)/, 'codes are never consumed, so they are replayable');
  assert.match(verify, /expires_at/, 'expiry is never checked');
});

test('minting invalidates the previous live code', () => {
  const mint = svc.slice(svc.indexOf('export async function mintCode'), svc.indexOf('export async function verifyCode'));
  assert.match(mint, /UPDATE account_activation_codes SET consumed_at = NOW\(\)/,
    'a resend leaves the old code live — which doubles the guess surface and makes "resend" a lie');
});

test('the database enforces at most one live code', () => {
  const mig = readFileSync(
    new URL('../src/server/database/migrations/20260816200000-activation-codes.sql', import.meta.url), 'utf8');
  assert.match(mig, /CREATE UNIQUE INDEX[\s\S]*?account_activation_codes\(user_id\)[\s\S]*?WHERE consumed_at IS NULL/,
    'nothing stops two live codes existing — application-only checks lose the race between concurrent resends');
  assert.match(mig, /REFERENCES users\(id\) ON DELETE CASCADE/,
    'codes outlive deleted accounts — the same defect that left 24 live refresh tokens behind on 2026-08-16');
});

// ── the frontend must actually surface the gate ────────────────────────────

test('🔴 something in the CLIENT handles account_not_activated', () => {
  // Shipped without this once: the gate was enforced and invisible, so an
  // unactivated user hit a bare 403 with the remedy unread in their inbox.
  const it = readFileSync(new URL('../src/lib/activationInterceptor.ts', import.meta.url), 'utf8');
  assert.match(it, /account_not_activated/, 'the interceptor does not look for the gate code');
  assert.match(it, /res\.clone\(\)/,
    'the interceptor reads the original body, draining it — every other 403 path in the app would break');
  assert.match(it, /!==\s*ACTIVATION_PATH|ACTIVATION_PATH\s*!==/,
    'no loop guard — a 403 on the activation page would bounce it against itself');

  // 🔴 Comments must be stripped FIRST. The initial version of this assertion
  // matched the raw file, so commenting the call out still passed — a gate that
  // breaks open, which is precisely the defect it exists to catch. Found by
  // mutation-checking it; it would never have been found by running it.
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(main, /installActivationInterceptor\(\)/,
    'the interceptor is never installed — built, tested and unreachable');
});

test('the waiting page exists and is routed', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/auth\/activate"/, 'no route renders the waiting page');
  assert.match(app, /import ActivateAccount/, 'the page is not imported');
});
