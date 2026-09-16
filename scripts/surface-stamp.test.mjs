/**
 * The web client names itself on every API call (INFERENCE ROUTING spec D6).
 *
 * `api_usage_logs.surface` was 134,156 of 134,226 rows (99.95%) `xeno_api` — a
 * TRANSPORT label, not a product identity. The server already fixes this at the
 * boundary (`utils/requestSurface.js`) and falls back to `legacy:xeno_api` when
 * nothing names the caller. That fallback is correct and it is not a solution:
 * a product that cannot name itself cannot be routed per-product and cannot
 * appear on the usage page.
 *
 * The platform's own web app is the single largest inference consumer here and
 * sent no surface at all, so its traffic was indistinguishable from every legacy
 * caller. It is stamped in the fetch interceptor rather than per-service, for
 * the same reason auth and CSRF are: a header added at each call site is one
 * that a new call site forgets.
 *
 * Mutations: delete the `x-xeno-surface` line in authSession.ts -> test 1 fails.
 * Change it to a value outside the server's SURFACE_RE -> test 2 fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestSurface, LEGACY_SURFACE } from '../src/server/utils/requestSurface.js';

const authSession = readFileSync('src/lib/authSession.ts', 'utf8');

test('the web client stamps its product surface on API requests', () => {
  assert.match(authSession, /headers\.set\('x-xeno-surface'/,
    'the fetch interceptor no longer stamps a surface — platform traffic falls back to legacy');
  // Stamped in the interceptor, not in one service, so every call carries it.
  const interceptor = authSession.slice(authSession.indexOf('installAuthenticatedFetch'));
  assert.ok(interceptor.includes("x-xeno-surface"),
    'the surface stamp must live in the interceptor, where every /api/ call passes');
  // Never clobber a caller that named itself more specifically.
  assert.match(authSession, /!headers\.has\('x-xeno-surface'\)/,
    'the stamp must not overwrite a surface a caller already set');
});

test('the stamped value is one the SERVER actually accepts', () => {
  // The real parser, not a copy of its regex — a copy drifts and then this gate
  // proves something about the test instead of about the product.
  const match = authSession.match(/headers\.set\('x-xeno-surface',\s*'([^']+)'\)/);
  assert.ok(match, 'could not read the stamped surface value');
  const stamped = match[1];
  const resolved = requestSurface({ headers: { 'x-xeno-surface': stamped } });
  assert.equal(resolved, stamped,
    `the server rejects '${stamped}' and would file it as ${LEGACY_SURFACE}`);
  assert.notEqual(resolved, LEGACY_SURFACE, 'the stamp must not resolve to the legacy bucket');
});

test('an unnamed caller still degrades to the legacy bucket, never to a crash', () => {
  // The grandfathering half: old callers keep working and stay visible AS legacy.
  assert.equal(requestSurface({ headers: {} }), LEGACY_SURFACE);
  assert.equal(requestSurface({}), LEGACY_SURFACE);
  assert.equal(requestSurface({ headers: { 'x-xeno-surface': 'not a surface!' } }), LEGACY_SURFACE);
});
