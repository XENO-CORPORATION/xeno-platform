/**
 * inference-routing.test.mjs — gates for the provider-key vault and the
 * per-product routing decision.
 *
 * Spec: `XENO INFERENCE ROUTING - SPEC.md`. Hygiene: `XENO CREDENTIAL HYGIENE -
 * PLAYBOOK.md`.
 *
 * WHAT THESE ARE FOR
 *
 * Two of the failures guarded here are silent by nature, which is the whole
 * reason they are pinned rather than trusted:
 *
 *   1. A BYOK request that quietly falls back to premium looks exactly like a
 *      working one. The user gets their completion; the difference shows up on
 *      an invoice weeks later, as credits spent on requests they deliberately
 *      routed to be free. Nothing in the response distinguishes the two.
 *
 *   2. A leaked provider key looks like nothing at all until the user's provider
 *      bill arrives. So "the secret is never selected, returned or logged" is
 *      asserted against SOURCE, not against behaviour — a runtime test passes
 *      right up until someone adds a convenience field.
 *
 * Every gate below has been mutation-checked: broken deliberately, observed
 * failing, restored. A test that cannot fail is not evidence.
 *
 * Run: node --test scripts/inference-routing.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'server');
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8');

const {
  resolveInferenceRoute, fingerprint, byokEnabled, DEFAULT_SURFACE, SUPPORTED_PROVIDERS,
} = await import('../src/server/services/providerCredentials.js');
const {
  isForbiddenAddress, assertSafeEndpointUrl,
} = await import('../src/server/utils/safeEndpoint.js');

/**
 * A pg stub that answers the one SELECT `resolveInferenceRoute` makes, and
 * records what it was asked. Rows are supplied in the shape the query returns.
 */
function fakeDb(rows = []) {
  const seen = [];
  return {
    seen,
    query: async (sql, params = []) => {
      seen.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows };
    },
  };
}

const CRED = {
  credential_id: 'cred-1', provider: 'openai', base_url: null,
  credential_status: 'active', key_fingerprint: 'abcdef0123456789',
};

const withByok = async (on, fn) => {
  const prev = process.env.BYOK_ENABLED;
  process.env.BYOK_ENABLED = on ? 'true' : '';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.BYOK_ENABLED; else process.env.BYOK_ENABLED = prev;
  }
};

// ── The flag fails CLOSED ────────────────────────────────────────────────────

test('BYOK_ENABLED unset means OFF — an unset flag never means on', () => {
  const prev = process.env.BYOK_ENABLED;
  delete process.env.BYOK_ENABLED;
  assert.equal(byokEnabled(), false);
  process.env.BYOK_ENABLED = 'TRUE';
  assert.equal(byokEnabled(), false, 'only the exact string "true" enables it — no truthiness');
  process.env.BYOK_ENABLED = 'true';
  assert.equal(byokEnabled(), true);
  if (prev === undefined) delete process.env.BYOK_ENABLED; else process.env.BYOK_ENABLED = prev;
});

test('byok is refused while the flag is off, even with a valid credential row', async () => {
  await withByok(false, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED }]);
    await assert.rejects(
      () => resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' }),
      (e) => e.code === 'byok_disabled' && e.http === 503,
      'a disabled server must refuse, not silently serve premium'
    );
  });
});

// ── Three-level resolution (spec D2) ─────────────────────────────────────────

test('no rows at all → premium, and the reason says so', async () => {
  const r = await resolveInferenceRoute(fakeDb([]), 'u1', { surface: 'xeno-pixel' });
  assert.equal(r.path, 'premium');
  assert.equal(r.reason, 'platform-default');
  assert.equal(r.metered, true);
  assert.equal(r.credential, null);
});

test('account default applies to a product with no override', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED }]);
    const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' });
    assert.equal(r.path, 'byok');
    assert.equal(r.reason, 'account-default');
    assert.equal(r.credential.id, 'cred-1');
  });
});

test('a product override BEATS the account default', async () => {
  await withByok(true, async () => {
    const db = fakeDb([
      { surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED },
      { surface: 'xeno-motion', path: 'premium', mode: 'managed', credential_id: null },
    ]);
    const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-motion' });
    assert.equal(r.path, 'premium');
    assert.equal(r.reason, 'product-override');
  });
});

test('absence INHERITS — clearing an override is a DELETE, not a stored value', async () => {
  await withByok(true, async () => {
    // Same account default, no row for this surface: it must inherit, not fall to premium.
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED }]);
    const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-sound' });
    assert.equal(r.path, 'byok');
    assert.equal(r.reason, 'account-default');
  });
});

test('a request-level path beats both', async () => {
  const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED }]);
  const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel', requestedPath: 'premium' });
  assert.equal(r.path, 'premium');
  assert.equal(r.reason, 'request-override');
});

test('the resolver scopes by user AND asks for both surfaces in one query', async () => {
  const db = fakeDb([]);
  await resolveInferenceRoute(db, 'user-42', { surface: 'xeno-pixel' });
  assert.equal(db.seen.length, 1, 'one query, not one per level');
  assert.equal(db.seen[0].params[0], 'user-42');
  assert.deepEqual(db.seen[0].params[1], ['xeno-pixel', '*']);
});

// ── 🔴 FAIL CLOSED (spec D5) — the money gate ────────────────────────────────

test('byok with NO credential throws — it does not return premium', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', credential_id: null }]);
    await assert.rejects(
      () => resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' }),
      (e) => e.code === 'byok_credential_missing' && e.http === 409
    );
  });
});

test('byok with a REVOKED credential throws revoked, not invalid, not premium', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED, credential_status: 'revoked' }]);
    await assert.rejects(
      () => resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' }),
      (e) => e.code === 'byok_credential_revoked'
    );
  });
});

test('byok with an INVALID credential throws — the user is told, not billed', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED, credential_status: 'invalid' }]);
    await assert.rejects(
      () => resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' }),
      (e) => e.code === 'byok_credential_invalid'
    );
  });
});

test('NO byok input, however broken, can ever resolve to a metered path', async () => {
  await withByok(true, async () => {
    const broken = [
      { surface: '*', path: 'byok', mode: 'managed', credential_id: null },
      { surface: '*', path: 'byok', mode: 'managed', ...CRED, credential_status: 'revoked' },
      { surface: '*', path: 'byok', mode: 'managed', ...CRED, credential_status: 'invalid' },
      { surface: '*', path: 'byok', mode: 'managed', ...CRED, credential_status: 'pending' },
    ];
    for (const row of broken) {
      let out = null;
      try { out = await resolveInferenceRoute(fakeDb([row]), 'u1', { surface: 'xeno-pixel' }); } catch { /* expected */ }
      assert.equal(out, null, `a broken byok row resolved instead of refusing: ${JSON.stringify(row)}`);
    }
  });
});

test('a satisfied byok decision is never metered (spec D4)', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'managed', ...CRED }]);
    const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-pixel' });
    assert.equal(r.metered, false, 'billing a byok request is the defect this whole feature exists to avoid');
  });
});

test('local mode resolves without a credential and stays unmetered (spec D8)', async () => {
  await withByok(true, async () => {
    const db = fakeDb([{ surface: DEFAULT_SURFACE, path: 'byok', mode: 'local', credential_id: null }]);
    const r = await resolveInferenceRoute(db, 'u1', { surface: 'xeno-browser' });
    assert.equal(r.mode, 'local');
    assert.equal(r.credential, null, 'local mode means the key never reaches us — there is nothing to resolve');
    assert.equal(r.metered, false);
  });
});

// ── Fingerprints (hygiene §6) ────────────────────────────────────────────────

test('fingerprint is 16 hex chars, stable, and does not contain the secret', () => {
  const secret = 'sk-proj-REAL-LOOKING-KEY-abcdefghijklmnop';
  const fp = fingerprint(secret);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(fp, fingerprint(secret), 'must be stable — it is the dedupe key');
  assert.notEqual(fp, fingerprint(secret + 'x'));
  assert.ok(!secret.includes(fp) && !fp.includes(secret.slice(0, 8)),
    'a fingerprint that carries the secret defeats its own purpose');
});

// ── SSRF guard (spec §10.4) ──────────────────────────────────────────────────

test('every private / loopback / link-local / metadata address is refused', () => {
  for (const ip of [
    '127.0.0.1', '127.9.9.9', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    'not-an-ip', '',
  ]) {
    assert.equal(isForbiddenAddress(ip), true, `${ip} must be refused`);
  }
});

test('ordinary public addresses are allowed — the guard is not just "deny all"', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '104.18.0.1', '2606:4700::1111']) {
    assert.equal(isForbiddenAddress(ip), false, `${ip} should be reachable`);
  }
});

test('IPv4-mapped IPv6 is decoded before checking — the classic bypass', () => {
  assert.equal(isForbiddenAddress('::ffff:169.254.169.254'), true,
    'checking only the v6 form lets the metadata service through');
});

test('endpoint URLs: https only, no embedded credentials, no literal private host', () => {
  assert.ok(assertSafeEndpointUrl('https://api.openai.com/v1'));
  const cases = [
    ['http://api.openai.com/v1', 'endpoint_not_https'],
    ['https://user:pw@api.openai.com/v1', 'endpoint_has_credentials'],
    ['https://127.0.0.1:8317/v1', 'endpoint_forbidden_address'],
    ['https://169.254.169.254/latest/meta-data', 'endpoint_forbidden_address'],
    ['not a url', 'endpoint_invalid'],
  ];
  for (const [url, code] of cases) {
    assert.throws(() => assertSafeEndpointUrl(url), (e) => e.code === code, `${url} → ${code}`);
  }
});

// ── Source gates: the secret never leaves (hygiene §3, spec §10.2) ───────────

test('listCredentials excludes the secret AT THE QUERY, and uses no SELECT *', () => {
  const svc = read('services', 'providerCredentials.js');
  const fn = svc.slice(svc.indexOf('export async function listCredentials'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.ok(!/secret_encrypted/.test(body),
    'listCredentials must not name the secret column at all');
  assert.ok(!/SELECT\s+\*/i.test(body),
    'SELECT * would start returning the secret the moment the column list changes');
});

/**
 * ⚠️ Strip comments before matching. The first version of this gate searched the
 * whole file and failed on the route module's OWN doc comment, which says there
 * will never be a reveal endpoint — the gate flagged the sentence promising the
 * property it was checking for. A source gate that reads prose as code fails for
 * the wrong reason, which is indistinguishable from the gate working.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no route handler can return plaintext — there is no reveal endpoint', () => {
  const routes = stripComments(read('routes', 'v2InferenceRoutes.js'));
  assert.ok(!/secret_encrypted/.test(routes), 'the route layer must never name the secret column');
  assert.ok(!/\breveal\b|\bdisclose\b|\bshow-?secret\b/i.test(routes),
    'a "reveal my key" endpoint is refused by design — a lost key is re-entered');
});

test('only ONE function decrypts, and it does not return the plaintext', () => {
  const svc = read('services', 'providerCredentials.js');
  const calls = svc.match(/\bdecrypt\(/g) || [];
  assert.equal(calls.length, 1, `exactly one decrypt call expected, found ${calls.length}`);
  const fn = svc.slice(svc.indexOf('export async function useCredential'));
  assert.ok(/return await use\(/.test(fn),
    'useCredential must hand the secret to a callback, never return it — a returning ' +
    'version gets copied into a route handler within a week');
});

// ── Source gates: the schema enforces what prose cannot ──────────────────────

test('the migration seals secrets and makes an unsatisfiable byok row impossible', () => {
  const sql = readFileSync(
    join(SRC, 'database', 'migrations', '20260822110000-inference-routing.sql'), 'utf8');
  assert.match(sql, /upc_secret_is_sealed CHECK \(secret_encrypted LIKE 'v1\.%'\)/,
    'the database itself must refuse an unsealed secret');
  assert.match(sql, /ir_byok_needs_credential/,
    'byok-without-a-key must be unrepresentable, not a runtime surprise');
  assert.match(sql, /REFERENCES user_provider_credentials\(id\) ON DELETE RESTRICT/,
    'RESTRICT, not CASCADE — deleting a key must never silently re-route products to premium');
  assert.match(sql, /REFERENCES users\(id\) ON DELETE CASCADE/,
    'an orphaned credential is a way in (the 2026-08-16 purge left 9 keys behind)');
  assert.match(sql, /-- DOWN/, 'every migration is reversible');
});

test('the mount is authenticated and carries the do-not-log warning', () => {
  const index = read('index.js');
  assert.match(index, /app\.use\('\/api\/v2\/inference', databaseMiddleware, oidcAuth, v2InferenceRoutes\)/,
    'the vault must sit behind oidcAuth — an unauthenticated vault is not a vault');
  assert.match(index, /CARRIES A USER'S PROVIDER KEY/,
    'the next person to add a body logger has to read this first');
  assert.match(index, /app\.use\('\/api\/v2\/inference\/credential', databaseMiddleware, inferenceCredentialRoutes\)/,
    'grant exchange is service-token, not oidcAuth — the gateway has no user session');
  const credMount = index.indexOf("app.use('/api/v2/inference/credential'");
  const vaultMount = index.indexOf("app.use('/api/v2/inference', databaseMiddleware, oidcAuth");
  assert.ok(credMount !== -1 && credMount < vaultMount,
    'credential must be mounted BEFORE the oidc vault or oidcAuth steals the path');
});

test('supported providers are declared, not improvised', () => {
  assert.deepEqual(
    [...SUPPORTED_PROVIDERS].sort(),
    ['anthropic', 'azure-openai', 'compatible', 'google', 'openai', 'openrouter']
  );
});
