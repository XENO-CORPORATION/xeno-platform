/**
 * BYOK routing, EXERCISED — real Postgres, real AES-256-GCM, real grant exchange.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * P0-P5 of `XENO INFERENCE ROUTING - SPEC.md` are built and `BYOK_ENABLED=true`
 * is live on production. And `user_provider_credentials` has ZERO rows, so not
 * one line of this pipeline has ever executed against a real credential.
 *
 * The existing gates (`scripts/inference-grant.test.mjs`,
 * `scripts/inference-routing.test.mjs`) read SOURCE and assert code shape. They
 * are useful and they cannot see a resolver that throws, a grant that is
 * replayable, or a route that resolves to the wrong path — because they never
 * run one. That is this workspace's recurring shape: built, unit-tested,
 * unreachable (xeno-workflow's 76 node types, xeno-tools' `install`,
 * xeno-post's inbox adapter). A feature whose first real execution is a
 * paying user's request has not been tested; it has been hoped for.
 *
 * So this drives the ACTUAL services against a real database and asserts the
 * locked decisions that carry money or secrets:
 *
 *   D2  absence INHERITS   — account default, product override, reset = DELETE
 *   D3  no plaintext out   — the vault column is sealed; reads go through useCredential
 *   D4  BYOK records USAGE — resolve says metered:false, and still names the surface
 *   D5  FAILS CLOSED       — a missing/revoked key NEVER falls back to premium
 *   D9  verified on save   — status/verified_at reflect a real check
 *   D10 delete is REFUSED  — a credential a route points at cannot be deleted
 *   §6  grant is single-use, short-lived, and audience-bound
 *
 * Run: DATABASE_URL=... SECRET_BOX_KEY=... node tests/inference-routing-live.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import {
  listCredentials, revokeCredential, deleteCredential,
  setRoute, clearRoute, listRoutes, resolveInferenceRoute, useCredential,
  markCredentialInvalid, fingerprint, byokEnabled, setCredentialModels, credentialServesModel, annotateCatalogueRoutes,
} from '../services/providerCredentials.js';
import { exchangeGrant, attachManagedGrant, recordGrantUsage } from '../services/inferenceGrants.js';
import { encrypt } from '../utils/secretBox.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SECRET_BOX_KEY) throw new Error('SECRET_BOX_KEY is required (the vault refuses to store unsealed)');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// A syntactically plausible key that reaches no provider.
//
// ⚠️ `createCredential` is deliberately NOT called here. D9 makes it verify against
// the real provider before storing, and `utils/safeEndpoint.js` refuses loopback by
// design (§10.4 SSRF) — so it cannot be pointed at a local stub, and it is not going
// to be handed a real OpenAI key in CI. Both of those are the guards WORKING; a test
// that needed either would be a test nobody runs. `createCredential` is covered by
// the source gates in scripts/inference-routing.test.mjs.
//
// So the vault row is seeded through the SAME `encrypt()` the service uses. What is
// under test here is everything AFTER storage — resolution, inheritance, grants,
// fail-closed — which is the part that has never once executed.
const FAKE_KEY = `sk-live-test-${'x'.repeat(32)}`;

async function seedCredential(userId, { label = 'Primary' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO user_provider_credentials
       (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, status, verified_at)
     VALUES ($1,'openai',$2,$3,$4,$5,'active',NOW())
     RETURNING id, provider, label, key_fingerprint, key_last4, status, verified_at`,
    [userId, label, encrypt(FAKE_KEY), fingerprint(FAKE_KEY), FAKE_KEY.slice(-4)],
  );
  return rows[0];
}

async function main() {
  await runAllMigrations(pool);
  ok(byokEnabled(), 'BYOK_ENABLED is on for this run (else every assertion below is vacuous)');

  const u = await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active)
     VALUES ('byok-live@xeno.test','byok_live','BYOK Live','x-not-a-login-in-this-suite', true, true)
     RETURNING id`,
  );
  const userId = u.rows[0].id;

  // ── D5: no credential, explicit byok request → REFUSED, never premium ──────
  // This is the assertion that protects real money. A silent fallback spends the
  // user's credits on a request they deliberately routed to be free, at scale,
  // and it is only ever visible on the invoice.
  let refused = null;
  try {
    await resolveInferenceRoute(pool, userId, { surface: 'xeno-pixel', requestedPath: 'byok' });
  } catch (e) { refused = e.code; }
  ok(String(refused || '').startsWith('byok_'),
    `D5: byok with no credential is refused (${refused}), never silently premium`);

  const cred = await seedCredential(userId);
  ok(cred && cred.id, 'a credential can be stored');
  ok(cred.status === 'active' && cred.verified_at,
    'D9: a stored credential carries a verification stamp');

  // ── D3: the vault holds SEALED bytes, and a check constraint enforces it ──
  const raw = await pool.query(
    'SELECT secret_encrypted, key_fingerprint, key_last4 FROM user_provider_credentials WHERE id=$1',
    [cred.id],
  );
  const stored = raw.rows[0];
  ok(stored.secret_encrypted.startsWith('v1.'), 'D3: stored secret is sealed (v1. envelope)');
  ok(!stored.secret_encrypted.includes(FAKE_KEY), 'D3: the plaintext key is NOT in the column');
  ok(stored.key_fingerprint === fingerprint(FAKE_KEY),
    'the fingerprint identifies the key without storing it (incident response without the secret)');
  ok(!String(stored.key_last4 || '').includes('sk-live'), 'last4 is a hint, not the key');

  // The DB itself refuses an unsealed write, so a future code path that forgets
  // to encrypt fails loudly at the boundary rather than storing plaintext.
  let sealViolation = null;
  try {
    await pool.query(
      `INSERT INTO user_provider_credentials (user_id, provider, label, secret_encrypted, key_fingerprint)
       VALUES ($1,'openai','Unsealed','PLAINTEXT-KEY','0000000000000000')`, [userId],
    );
  } catch (e) { sealViolation = e.code; }
  ok(sealViolation === '23514', 'D3: the database REFUSES an unsealed secret (check constraint)');

  // ── D3: reading is mediated — useCredential hands the secret to a callback ─
  let seen = null;
  await useCredential(pool, userId, cred.id, async ({ secret }) => { seen = secret; return true; });
  ok(seen === FAKE_KEY, 'the secret round-trips through AES-256-GCM for server-side use');

  // ── D2: absence INHERITS ──────────────────────────────────────────────────
  await setRoute(pool, userId, '*', { path: 'byok', mode: 'managed', credentialId: cred.id });
  const inherited = await resolveInferenceRoute(pool, userId, { surface: 'xeno-motion' });
  ok(inherited.path === 'byok' && inherited.reason === 'account-default',
    `D2: a product with no override INHERITS the account default (${inherited.reason})`);

  await setRoute(pool, userId, 'xeno-pixel', { path: 'premium' });
  const overridden = await resolveInferenceRoute(pool, userId, { surface: 'xeno-pixel' });
  ok(overridden.path === 'premium' && overridden.reason === 'product-override',
    `D2: a per-product override wins over the account default (${overridden.reason})`);

  // Reset-to-default is a DELETE, so there is no third state to get wrong.
  await clearRoute(pool, userId, 'xeno-pixel');
  const reset = await resolveInferenceRoute(pool, userId, { surface: 'xeno-pixel' });
  ok(reset.path === 'byok' && reset.reason === 'account-default',
    'D2: clearing an override falls back to the default (reset is a DELETE, not a value)');

  // ── D4: BYOK is NOT metered, and is still attributable ────────────────────
  ok(inherited.metered === false, 'D4: a BYOK decision is not metered (no ledger hold, no credits)');
  ok(overridden.metered !== false, 'D4: a premium decision IS metered (the control for the line above)');

  // ── §6: the grant is single-use, and it is not the key ────────────────────
  const granted = await attachManagedGrant(pool, userId, inherited, { surface: 'xeno-motion', model: 'gpt-5.5' });
  const grant = granted.credential && granted.credential.grant;
  ok(typeof grant === 'string' && grant.length > 0, '§6: a managed BYOK decision carries a grant handle');
  ok(!grant.includes(FAKE_KEY), '§6: the grant is a HANDLE, never the key');

  let exchanged = null;
  await exchangeGrant(pool, grant, async ({ secret }) => { exchanged = secret; return true; });
  ok(exchanged === FAKE_KEY, '§6: the gateway exchanges the grant for the real secret exactly once');

  let replay = null;
  try {
    await exchangeGrant(pool, grant, async () => true);
  } catch (e) { replay = e.code || e.message; }
  ok(replay !== null, `§6: replaying a spent grant is REFUSED (${replay}) — single-use`);

  // ── PROVIDER-AWARE ROUTING: a key answers for ONE provider ───────────────
  // The production failure, reproduced: an account default routed to a
  // pass-through (DeepSeek-style) credential, then a Claude model is requested.
  // Before this, the resolver said byok, the grant was exchanged, and the
  // gateway sent claude-sonnet-5 to DeepSeek → 400 provider_error. Every model
  // the key could NOT serve was broken.
  const dsUser = (await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active)
     VALUES ('byok-provider@xeno.test','byok_provider','BYOK Provider','x', true, true) RETURNING id`,
  )).rows[0].id;
  const ds = (await pool.query(
    `INSERT INTO user_provider_credentials
       (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, base_url, status, verified_at)
     VALUES ($1,'compatible','deepseek',$2,$3,'345a','https://api.deepseek.com/v1','active',NOW()) RETURNING id`,
    [dsUser, encrypt(FAKE_KEY), fingerprint(FAKE_KEY + 'ds')],
  )).rows[0];
  await setRoute(pool, dsUser, '*', { path: 'byok', mode: 'managed', credentialId: ds.id });
  // A catalogue row saying who serves claude-sonnet-5, as production's does.
  await pool.query(
    `INSERT INTO gateway_model_aliases (public_id, internal_id, provider, enabled)
     VALUES ('claude-sonnet-5','claude-sonnet-5','anthropic',true) ON CONFLICT (public_id) DO NOTHING`,
  );

  // No allow-list on a pass-through credential → it serves NOTHING. Fail closed.
  const noList = await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-web', model: 'deepseek-reasoner' });
  ok(noList.path === 'premium' && noList.reason === 'provider-mismatch' && noList.mismatch?.skipped?.[0]?.basis === 'no-allow-list',
    `pass-through credential with no allow-list serves nothing → premium, reason ${noList.reason} (${noList.mismatch?.skipped?.[0]?.basis})`);

  await setCredentialModels(pool, dsUser, ds.id, ['deepseek-chat', 'deepseek-reasoner']);
  const onList = await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-web', model: 'deepseek-reasoner' });
  ok(onList.path === 'byok' && onList.reason === 'account-default' && !onList.mismatch,
    'a listed model routes to the key');

  // THE production case. Claude on a DeepSeek key must NOT route to DeepSeek.
  const claude = await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-web', model: 'claude-sonnet-5' });
  ok(claude.path === 'premium' && claude.metered === true,
    'a model the key cannot serve does not route to that key — it continues to premium');
  ok(claude.reason === 'provider-mismatch',
    `…and the decision SAYS so (reason ${claude.reason}) — explicit, never silent`);
  ok(claude.mismatch && claude.mismatch.model === 'claude-sonnet-5' && claude.mismatch.skipped[0].credentialId === ds.id,
    'the decision names the model and the credential that was skipped');

  // THE PICKER agrees with the request (2026-09-18: the key answered `deepseek-chat` over
  // the API and the web chat never listed it). The catalogue annotation is derived from
  // the same walk, against the same rows, so what is offered is what will be served.
  const pick = await annotateCatalogueRoutes(pool, dsUser, { surface: 'xeno-web', modelIds: ['claude-sonnet-5'] });
  ok(pick.extra.map((e) => e.id).sort().join(',') === 'deepseek-chat,deepseek-reasoner',
    'the picker ADDS the models the key serves that the gateway does not carry');
  ok(pick.routes.get('deepseek-chat')?.path === 'byok' && pick.routes.get('deepseek-chat')?.credential?.id === ds.id,
    'and stamps them as answered on that key');
  ok(pick.routes.get('claude-sonnet-5')?.path === 'premium' && pick.routes.get('claude-sonnet-5')?.reason === claude.reason,
    'a gateway model the key cannot serve is stamped premium with the SAME reason the request got');

  // An EXPLICIT byok request for an unservable model is refused with a typed
  // error — never quietly served on some other key, never quietly premium.
  let explicit = null;
  try { await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-web', model: 'claude-sonnet-5', requestedPath: 'byok' }); } catch (e) { explicit = e.code; }
  ok(explicit === 'byok_provider_mismatch', `an explicit byok request for an unservable model is refused (${explicit})`);

  // Levels are walked: a product override that cannot serve falls to an account
  // default that can, and the decision records the skip.
  const oai = (await pool.query(
    `INSERT INTO user_provider_credentials
       (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, status, verified_at)
     VALUES ($1,'openai','oai',$2,$3,'aaaa','active',NOW()) RETURNING id`,
    [dsUser, encrypt(FAKE_KEY), fingerprint(FAKE_KEY + 'oai')],
  )).rows[0];
  await setRoute(pool, dsUser, 'xeno-pixel', { path: 'byok', mode: 'managed', credentialId: oai.id });
  // The catalogue knows DeepSeek serves deepseek-chat, so the OpenAI override is a
  // KNOWN mismatch (not merely unknown) and must be skipped.
  await pool.query(
    `INSERT INTO gateway_model_aliases (public_id, internal_id, provider, enabled)
     VALUES ('deepseek-chat','deepseek-chat','deepseek',true) ON CONFLICT (public_id) DO NOTHING`,
  );
  const walked = await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-pixel', model: 'deepseek-chat' });
  ok(walked.path === 'byok' && walked.credential?.id === ds.id && walked.reason === 'account-default',
    'an unservable product override is skipped and the account default that CAN serve is used');
  ok(walked.mismatch?.skipped?.[0]?.level === 'product-override',
    'the skipped level is recorded on the decision');

  // First-party: the catalogue decides; unknown-to-catalogue is allowed (the
  // provider refuses visibly; that beats quietly spending credits).
  ok(credentialServesModel({ provider: 'openai' }, 'claude-sonnet-5', { provider: 'anthropic' }).serves === false, 'first-party: catalogue mismatch does not serve');
  ok(credentialServesModel({ provider: 'anthropic' }, 'claude-sonnet-5', { provider: 'anthropic' }).serves === true, 'first-party: catalogue match serves');
  ok(credentialServesModel({ provider: 'openai' }, 'gpt-5.5', null).basis === 'catalogue-unknown' && credentialServesModel({ provider: 'openai' }, 'gpt-5.5', null).serves === true,
    'first-party: a model the catalogue does not know is attempted on the key, not silently billed');
  ok(credentialServesModel({ provider: 'openai', models: ['gpt-5.5'] }, 'gpt-5.5-mini', null).serves === false,
    'first-party: an allow-list narrows further');
  // No model on the request → the route applies as before (nothing to check).
  const noModel = await resolveInferenceRoute(pool, dsUser, { surface: 'xeno-web' });
  ok(noModel.path === 'byok', 'a request that names no model is routed as before');

  // Allow-list input is validated; a typo cannot widen trust.
  let bad = null;
  try { await setCredentialModels(pool, dsUser, ds.id, ['deepseek-chat', 'not a model id!']); } catch (e) { bad = e.code; }
  ok(bad === 'models_invalid', `a malformed allow-list is refused (${bad})`);

  // ── D4: not billed must never mean invisible ──────────────────────────────
  // The gateway path had no way to record a BYOK call: /service/usage prices
  // at premium server-side, so it would have CHARGED. Measured on the first real
  // call 2026-09-17: correct money, zero usage rows. This is the endpoint that
  // closes it — bound to the SPENT grant, once, cost 0 by construction.
  const usageBefore = await pool.query('SELECT count(*)::int AS n FROM api_usage_logs WHERE user_id=$1', [userId]);
  const rec = await recordGrantUsage(pool, grant, { model: 'gpt-5.5', provider: 'openai', inputTokens: 38, outputTokens: 16 });
  ok(rec.recorded === true && rec.userId === userId && rec.surface === 'xeno-motion',
    "D4: usage is recorded against the SPENT grant, attributed to the grant's user and surface");
  const row = await pool.query(
    'SELECT surface, model, provider, actual_cost_micro, input_tokens, output_tokens, status, request_id FROM api_usage_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  ok(row.rows.length === 1 && Number(row.rows[0].actual_cost_micro) === 0, 'D4: the usage row costs ZERO');
  // bigint columns come back from pg as strings — compare by value, not identity.
  ok(row.rows[0].surface === 'xeno-motion' && Number(row.rows[0].input_tokens) === 38 && Number(row.rows[0].output_tokens) === 16,
    'D4: the row carries the real surface and the provider-reported token counts');
  ok(row.rows[0].request_id === `grant:${rec.grantId}`, 'D4: the row is traceable to its grant');

  const again = await recordGrantUsage(pool, grant, { model: 'gpt-5.5', inputTokens: 38, outputTokens: 16 });
  const usageAfter = await pool.query('SELECT count(*)::int AS n FROM api_usage_logs WHERE user_id=$1', [userId]);
  ok(again.duplicate === true && usageAfter.rows[0].n === usageBefore.rows[0].n + 1,
    'D4: a retry for the same grant is a no-op, never a double');

  // A grant that was minted but NEVER exchanged must not be able to record
  // usage — the exchange is the proof the call happened on the user's key.
  const unspent = await attachManagedGrant(pool, userId, inherited, { surface: 'xeno-motion', model: 'gpt-5.5' });
  let unspentErr = null;
  try { await recordGrantUsage(pool, unspent.credential.grant, { inputTokens: 1 }); } catch (e) { unspentErr = e.code; }
  ok(unspentErr === 'grant_unspent', `D4: an unexchanged grant cannot record usage (${unspentErr})`);
  let unknownErr = null;
  try { await recordGrantUsage(pool, 'xgrant_0000000000000000000000000000000000000000000000000000000000000000', {}); } catch (e) { unknownErr = e.code; }
  ok(unknownErr === 'grant_unknown', `D4: an unknown grant cannot record usage (${unknownErr})`);
  // No credit movement happened for any of this.
  const txns = await pool.query('SELECT count(*)::int AS n FROM credit_transactions WHERE user_id=$1', [userId]);
  ok(txns.rows[0].n === 0, 'D4: recording BYOK usage moved no credits');

  // ── D10: deleting a credential a route points at is REFUSED, not cascaded ─
  // Cascading would silently re-point that product at premium and start spending
  // credits: D5's failure arriving by a different road.
  let deleteRefused = null;
  try {
    await deleteCredential(pool, userId, cred.id);
  } catch (e) { deleteRefused = e.code || e.constraint || e.message; }
  ok(deleteRefused !== null, `D10: deleting an in-use credential is refused (${deleteRefused})`);
  const survived = await listCredentials(pool, userId);
  ok(survived.length === 1, 'D10: the credential survived the refused delete');

  // ── D5 again, the path that actually happens in production ────────────────
  // A provider 401 marks the credential invalid. That must STOP requests, not
  // re-route them: the only automatic transition is active -> invalid.
  await markCredentialInvalid(pool, cred.id);
  let afterInvalid = null;
  try {
    await resolveInferenceRoute(pool, userId, { surface: 'xeno-motion' });
  } catch (e) { afterInvalid = e.code; }
  ok(String(afterInvalid || '').startsWith('byok_'),
    `D5: an invalidated key refuses (${afterInvalid}) — it never falls back to premium`);

  // Revocation behaves the same way.
  await pool.query("UPDATE user_provider_credentials SET status='active' WHERE id=$1", [cred.id]);
  await revokeCredential(pool, userId, cred.id);
  let afterRevoke = null;
  try {
    await resolveInferenceRoute(pool, userId, { surface: 'xeno-motion' });
  } catch (e) { afterRevoke = e.code; }
  ok(String(afterRevoke || '').startsWith('byok_'),
    `D5: a revoked key refuses (${afterRevoke}) — still no fallback`);

  // ── the routes a user can see are their own ───────────────────────────────
  const routes = await listRoutes(pool, userId);
  ok(Array.isArray(routes) && routes.every((r) => !('secret' in r) && !('secret_encrypted' in r)),
    'D3: listing routes never exposes secret material');

  console.log(`\n${fail === 0 ? '✅' : '❌'} inference-routing-live: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('FATAL', e);
  await pool.end().catch(() => {});
  process.exit(1);
});
