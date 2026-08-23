/**
 * inference-grant.test.mjs — P2/P3/P4 gates.
 *
 * Spec §6. Hygiene playbook §8 D4. Every gate below has a named mutation:
 * what you break, and which test must fail.
 *
 * Run: node --test scripts/inference-grant.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'server');
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const {
  mintGrant, spendGrant, hashGrant, GRANT_TTL_SECONDS, GRANT_PREFIX, attachManagedGrant,
} = await import('../src/server/services/inferenceGrants.js');
const { requestSurface, LEGACY_SURFACE } = await import('../src/server/utils/requestSurface.js');
const { SENSITIVE_PATHS } = await import('../src/server/middleware/requestLogger.js');

function grantDb() {
  const store = new Map();
  return {
    store,
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ');
      if (s.includes('INSERT INTO inference_grants')) {
        store.set(params[0], {
          hash: params[0],
          user_id: params[1],
          surface: params[2],
          model: params[3],
          credential_id: params[4],
          expires_at: params[5],
          spent_at: null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('UPDATE inference_grants') && s.includes('spent_at')) {
        const g = store.get(params[0]);
        if (g && !g.spent_at && new Date(g.expires_at).getTime() > Date.now()) {
          g.spent_at = new Date();
          return { rows: [{
            user_id: g.user_id, surface: g.surface, model: g.model, credential_id: g.credential_id,
          }] };
        }
        return { rows: [] };
      }
      if (s.includes('SELECT spent_at FROM inference_grants')) {
        const g = store.get(params[0]);
        return { rows: g ? [{ spent_at: g.spent_at }] : [] };
      }
      return { rows: [] };
    },
  };
}

// ── Grant mint + single-use (break by skipping the spend marker) ─────────────

test('a minted grant is hashed, prefixed, and bound', async () => {
  const db = grantDb();
  const minted = await mintGrant(db, 'user-1', { surface: 'xeno-pixel', model: 'gpt-4o', credentialId: 'cred-1' });
  assert.ok(minted.grant.startsWith(GRANT_PREFIX));
  assert.ok(!db.store.has(minted.grant), 'the raw grant must never be stored');
  assert.ok(db.store.has(hashGrant(minted.grant)));
  const row = db.store.get(hashGrant(minted.grant));
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.surface, 'xeno-pixel');
  assert.equal(row.model, 'gpt-4o');
  assert.equal(row.credential_id, 'cred-1');
});

test('GRANT_TTL_SECONDS is ≤ 60 — a longer grant is a standing credential', () => {
  assert.ok(GRANT_TTL_SECONDS > 0 && GRANT_TTL_SECONDS <= 60);
});

test('second spend is 410 grant_spent, even from the same caller', async () => {
  const db = grantDb();
  const minted = await mintGrant(db, 'user-1', { surface: 'xeno-pixel', model: 'gpt-4o', credentialId: 'cred-1' });
  const first = await spendGrant(db, minted.grant);
  assert.equal(first.credential_id, 'cred-1');
  await assert.rejects(
    () => spendGrant(db, minted.grant),
    (e) => e.code === 'grant_spent' && e.http === 410,
  );
});

test('an unknown grant is 410, not 404 — existence is not leaked', async () => {
  await assert.rejects(
    () => spendGrant(grantDb(), `${GRANT_PREFIX}${'ab'.repeat(32)}`),
    (e) => e.http === 410,
  );
});

test('spendGrant source actually writes spent_at in the same UPDATE that returns the row', () => {
  const src = read('services', 'inferenceGrants.js');
  const fn = src.slice(src.indexOf('export async function spendGrant'));
  const body = fn.slice(0, fn.indexOf('\nexport async function exchangeGrant'));
  assert.match(body, /SET spent_at = NOW\(\)/);
  assert.match(body, /AND spent_at IS NULL AND expires_at > NOW\(\)/);
  assert.match(body, /RETURNING/);
});

test('attachManagedGrant mints only for managed byok', async () => {
  const db = grantDb();
  const premium = await attachManagedGrant(db, 'u', { path: 'premium', mode: 'managed', credential: null });
  assert.equal(premium.credential, null);
  assert.equal(db.store.size, 0);
  const local = await attachManagedGrant(db, 'u', { path: 'byok', mode: 'local', credential: null });
  assert.equal(local.mode, 'local');
  assert.equal(db.store.size, 0);
  const managed = await attachManagedGrant(db, 'u', {
    path: 'byok', mode: 'managed',
    credential: { id: 'cred-1', provider: 'openai' },
  }, { surface: 'xeno-pixel', model: 'gpt-4o' });
  assert.ok(managed.credential.grant.startsWith(GRANT_PREFIX));
  assert.ok(managed.credential.expiresAt);
});

// ── Secret never logged (break by logging plaintext on resolve / exchange) ───

test('the grant table has no secret column', () => {
  const sql = readFileSync(join(SRC, 'database', 'migrations', '20260822120000-inference-grants.sql'), 'utf8');
  const columns = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\bsecret\b/i.test(columns), 'a grant that stores the key is just the key');
  assert.match(sql, /grant_hash\s+CHAR\(64\)/);
  assert.match(sql, /-- DOWN/);
});

test('user-facing vault routes never RETURN a secret', () => {
  const routes = stripComments(read('routes', 'v2InferenceRoutes.js'));
  assert.ok(!/secret_encrypted/.test(routes));
  assert.ok(!/res\.json\([^)]*secret/.test(routes));
  assert.ok(!/credential:\s*\{[^}]*secret/.test(routes));
});

test('exchange is the ONE route that may put secret on a 200, and it is no-store', () => {
  const src = read('routes', 'inferenceCredentialRoutes.js');
  assert.match(src, /Cache-Control.*no-store/);
  assert.match(src, /secret/);
  assert.ok(!/console\.(log|info|debug|warn|error)\([^)]*body/.test(src));
  assert.ok(!/console\.(log|info|debug|warn|error)\([^)]*secret/.test(src));
});

test('request logger treats the whole /api/v2/inference family as sensitive', () => {
  assert.ok(SENSITIVE_PATHS.some((p) => '/api/v2/inference/credential'.startsWith(p)));
  assert.ok(SENSITIVE_PATHS.some((p) => '/api/v2/inference/credentials'.startsWith(p)));
});

test('grant token is its own secret, fail-closed, not the ledger token', () => {
  const auth = read('routes', 'inferenceGrantAuth.js');
  assert.match(auth, /INFERENCE_GRANT_TOKEN/);
  assert.ok(!/LEDGER_SERVICE_TOKEN/.test(auth));
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /if \(!expected\) return unauthorized/);
});

test('index never mentions SECRET_BOX_KEY next to the gateway-facing mounts', () => {
  const index = read('index.js');
  const cred = index.indexOf("app.use('/api/v2/inference/credential'");
  const window = index.slice(cred, cred + 800);
  assert.ok(!/SECRET_BOX_KEY/.test(window));
});

// ── BYOK never meters (break by setting cost_micro > 0) ──────────────────────

test('the byok chat branch returns cost_micro: 0 and never calls the meter', () => {
  const src = read('routes', 'aiRoutes.js');
  const start = src.indexOf("if (inferencePath === 'byok')");
  assert.ok(start !== -1, 'the byok branch must exist');
  const rest = src.slice(start);
  // next sibling branch
  const end = rest.indexOf("if (inferencePath === 'inhouse')");
  const body = rest.slice(0, end === -1 ? rest.length : end);
  assert.match(body, /cost_micro:\s*0/);
  assert.ok(!/meterPremiumChat/.test(body), 'metering a byok request is the defect');
  assert.ok(!/path:\s*'premium'/.test(body), 'silent fallback to premium');
});

test('recordInferenceUsage hardcodes cost 0 — a parameter cannot raise it', () => {
  const src = read('utils', 'recordInferenceUsage.js');
  assert.match(src, /const costMicro = 0/);
  assert.ok(!/event\.cost/.test(src));
});

test('flag-off + explicit byok is still today\'s 400 byok_unavailable', () => {
  const src = read('routes', 'aiRoutes.js');
  assert.match(src, /requestedPath === 'byok' && !byokEnabled\(\)/);
  assert.match(src, /error: 'byok_unavailable'/);
});

test('the stream route resolves before it meters — a stored byok cannot be billed', () => {
  const src = read('routes', 'aiRoutes.js');
  const start = src.indexOf("router.post('/chat/stream'");
  assert.ok(start !== -1, 'stream route must exist');
  const hold = src.indexOf('meter = await meterPremiumChatStream', start);
  assert.ok(hold > start, 'the stream hold must exist');
  const body = src.slice(start, hold);
  assert.match(body, /resolveInferenceRoute/);
  assert.match(body, /streamDecision\.path !== 'premium'/);
});

// ── No silent fallback (break by catching a missing key and calling premium) ─

test('a byok resolve refusal stays a 409 — it does not fall into premium', () => {
  const src = read('routes', 'aiRoutes.js');
  assert.match(src, /error\.http \|\| 409/);
  assert.match(src, /byok_credential_missing/);
  // The catch that handles byok_* returns; it must not assign path = premium.
  const catchBlock = src.slice(src.indexOf('String(code).startsWith(\'byok_\')'), src.indexOf('const inferencePath'));
  assert.ok(!/premium/.test(catchBlock));
});

// ── Surface stamp (P4) ───────────────────────────────────────────────────────

test('missing or garbage surface grandfather as legacy:xeno_api', () => {
  assert.equal(requestSurface({ headers: {}, body: {} }), LEGACY_SURFACE);
  assert.equal(requestSurface({ headers: { 'x-xeno-surface': 'xeno-pixel' }, body: {} }), 'xeno-pixel');
  assert.equal(requestSurface({ headers: {}, body: { surface: 'xeno-motion' } }), 'xeno-motion');
  assert.equal(requestSurface({ headers: { 'x-xeno-surface': 'not a surface!!' }, body: {} }), LEGACY_SURFACE);
});

test('premium metering receives the request surface, not a hardcoded transport label', () => {
  const src = read('routes', 'aiRoutes.js');
  assert.match(src, /meterPremiumChat\([\s\S]*surface,/);
});

// ── Schema / SSRF still sealed (break by inserting unsealed / 169.254) ───────

test('vault seal + SSRF guard files still exist after the grant work', () => {
  const sql = readFileSync(join(SRC, 'database', 'migrations', '20260822110000-inference-routing.sql'), 'utf8');
  assert.match(sql, /upc_secret_is_sealed/);
  const safe = read('utils', 'safeEndpoint.js');
  assert.match(safe, /169\.254|link-local/);
});
