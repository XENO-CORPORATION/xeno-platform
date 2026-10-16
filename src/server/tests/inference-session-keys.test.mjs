/**
 * Short-lived model keys (services/inferenceSessionKeys.js, routes/inferenceSessionKeyRoutes.js) — the key XENO Spawn's
 * XENO mode puts in one Claude Code process. Real Postgres with every migration, the real authMiddleware, real OIDC
 * access tokens minted through the device grant, and real DPoP proofs.
 *
 * What the gateway relies on is asserted on the ROWS, because the gateway reads rows: an `api_keys` row (prefix,
 * sha256, expires_at) linked through `external_api_keys` (source 'xeno_private_api') to the person's default API project.
 *
 * Run: DATABASE_URL=postgresql://… node tests/inference-session-keys.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { authMiddleware } from '../middleware/auth.js';
import sessionKeyRoutes from '../routes/inferenceSessionKeyRoutes.js';
import { startDeviceAuthorization, approveDevice, deviceTokenGrant } from '../utils/oidcProvider.js';
import { jwkThumbprint, accessTokenHash } from '../utils/dpop.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { issuer } from '../config/hosts.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const dpopKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) }; };
const dpopProof = (key, htm, htu, accessToken) => jwt.sign(
  { jti: crypto.randomUUID(), htm, htu, iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(accessToken) },
  key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } });

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);   // the ledger (credit_grants) and the OIDC tables, as production boot does
  const user = async (name, extra = '') => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash${extra ? ', role' : ''})
     VALUES ($1, $2, $1, true, true, 'x'${extra ? `, '${extra}'` : ''}) RETURNING id, username, email`, [name, `${name}@xeno.test`])).rows[0];
  const rich = await user('sk_rich'), broke = await user('sk_broke'), other = await user('sk_other'), svc = await user('sk_service', 'service');
  const agent = await user('sk_agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1, $2, 'personal', 'api', 'active')`, [agent.id, rich.id]);
  for (const u of [rich, other]) await addGrant(pool, u.id, { amountMicro: 50_000_000, kind: 'paid' });

  // a first-party client with and without inference:run
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES
      ('sk-spawn', 'Spawn test', ARRAY['http://127.0.0.1/callback'], ARRAY['openid','profile','email','inference:run','ledger:read'], 'sk-spawn', true),
      ('sk-reader', 'Reader test', ARRAY['http://127.0.0.1/callback'], ARRAY['openid','profile','email','ledger:read'], 'sk-reader', true)
    ON CONFLICT (client_id) DO NOTHING`);
  const oidcToken = async (u, clientId, scope, jkt = null) => {
    const start = await startDeviceAuthorization(pool, { clientId, scope });
    await approveDevice(pool, { userCode: start.user_code, userId: u.id });
    return (await deviceTokenGrant(pool, { deviceCode: start.device_code, clientId, dpopJkt: jkt })).access_token;
  };
  const legacy = (u) => jwt.sign({ userId: u.id, email: u.email, username: u.username }, JWT_SECRET, { expiresIn: '1h' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/inference/session-keys', authMiddleware, sessionKeyRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v2/inference/session-keys`;
  const call = async (method, path, auth, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...auth }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json().catch(() => ({})) };
  };
  const bearer = (t) => ({ authorization: `Bearer ${t}` });

  try {
    // ── the contract Spawn reads ──
    const made = await call('POST', '/', bearer(legacy(rich)), { ttlMinutes: 60, label: 'spawn op-1' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const k = made.body.key;
    assert.match(k.token, /^xeno-[0-9a-f]{48}$/); assert.match(k.id, /^[0-9a-f-]{36}$/);
    assert.match(k.baseUrl, /^https:\/\//, 'the base URL is https');
    assert.deepEqual(Object.keys(k.models).sort(), ['haiku', 'opus', 'sonnet']);
    const ttlMs = new Date(k.expiresAt).getTime() - Date.now();
    assert.ok(ttlMs > 58 * 60_000 && ttlMs <= 60 * 60_000 + 5_000, 'it expires in the asked hour');
    assert.equal(made.cache, 'no-store', 'a reply with a live key is never cached');

    // ── what the gateway reads: the same two rows a portal key has, and no plaintext anywhere ──
    const row = (await pool.query(`SELECT ak.user_id, ak.key_prefix, ak.key_hash, ak.is_active, ak.expires_at, eak.source_system, eak.platform_project_id, eak.metadata, bp.slug, bw.owner_user_id, bw.workspace_type
        FROM api_keys ak JOIN external_api_keys eak ON eak.platform_api_key_id = ak.id JOIN billing_projects bp ON bp.id = eak.platform_project_id JOIN billing_workspaces bw ON bw.id = bp.workspace_id
       WHERE ak.id = $1`, [k.id])).rows[0];
    assert.equal(row.user_id, rich.id); assert.equal(row.key_prefix, k.token.slice(0, 16)); assert.equal(row.key_hash, sha256(k.token));
    assert.equal(row.is_active, true); assert.ok(row.expires_at, 'expires_at is set, which the gateway enforces');
    assert.equal(row.source_system, 'xeno_private_api'); assert.equal(row.metadata.source, 'session-key');
    assert.equal(row.slug, 'default-api-project'); assert.equal(row.owner_user_id, rich.id); assert.equal(row.workspace_type, 'personal');
    const anywhere = await pool.query(`SELECT count(*)::int AS n FROM api_keys WHERE key_hash = $1 OR name = $1 OR key_prefix = $1`, [k.token]);
    assert.equal(anywhere.rows[0].n, 0, 'the plaintext is stored nowhere');
    const audit = (await pool.query(`SELECT metadata FROM security_events WHERE event_type = 'session_key_issued' AND user_id = $1`, [rich.id])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].metadata.keyId, k.id); assert.ok(!JSON.stringify(audit[0].metadata).includes(k.token), 'the audit names the key, never its secret');

    // ── a second key reuses the same project (no duplicate workspace or project) ──
    const second = await call('POST', '/', bearer(legacy(rich)), {});
    assert.equal(second.status, 200);
    assert.equal(new Date(second.body.key.expiresAt).getTime() - Date.now() <= 60 * 60_000 + 5_000, true, 'no ttl means 60 minutes');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM billing_workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal'`, [rich.id])).rows[0].n, 1);

    // ── refusals ──
    assert.equal((await call('POST', '/', {}, {})).status, 401, 'not signed in');
    assert.equal((await call('POST', '/', bearer(legacy(rich)), { ttlMinutes: 1 })).body.error.code, 'INVALID_TTL');
    assert.equal((await call('POST', '/', bearer(legacy(rich)), { ttlMinutes: 721 })).body.error.code, 'INVALID_TTL');
    assert.equal((await call('POST', '/', bearer(legacy(rich)), { ttlMinutes: 30.5 })).body.error.code, 'INVALID_TTL');
    assert.equal((await call('POST', '/', bearer(legacy(rich)), { label: 'x'.repeat(65) })).body.error.code, 'INVALID_LABEL');
    const noCredits = await call('POST', '/', bearer(legacy(broke)), {});
    assert.equal(noCredits.status, 402); assert.equal(noCredits.body.error.code, 'NO_CREDITS');
    const byAgent = await call('POST', '/', bearer(legacy(agent)), {});
    assert.equal(byAgent.status, 403, 'an agent cannot mint a key that bills a person'); assert.equal(byAgent.body.error.code, 'NOT_A_PERSON');
    assert.equal((await call('POST', '/', bearer(legacy(svc)), {})).body.error.code, 'NOT_A_PERSON', 'nor can a service account');

    // ── the live limit: five live keys, a sixth is 429, an expired or revoked one frees a place ──
    const three = [];
    for (let i = 0; i < 3; i += 1) three.push((await call('POST', '/', bearer(legacy(rich)), { label: `k${i}` })).body.key);
    const sixth = await call('POST', '/', bearer(legacy(rich)), {});
    assert.equal(sixth.status, 429); assert.equal(sixth.body.error.code, 'SESSION_KEY_LIMIT');
    await pool.query(`UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1`, [three[0].id]);
    assert.equal((await call('POST', '/', bearer(legacy(rich)), {})).status, 200, 'an expired key does not count');
    assert.equal((await call('POST', '/', bearer(legacy(rich)), {})).status, 429);
    // concurrency: with one place free, two at once make exactly one key
    assert.equal((await call('DELETE', `/${three[1].id}`, bearer(legacy(rich)))).status, 200);
    const race = await Promise.all([call('POST', '/', bearer(legacy(rich)), {}), call('POST', '/', bearer(legacy(rich)), {})]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 429], 'two mints racing for the last place: one wins');

    // ── revoke: only the owner, only session keys, gone is 404 ──
    assert.equal((await call('DELETE', `/${k.id}`, bearer(legacy(other)))).status, 404, 'another person cannot revoke it (and is not told it exists)');
    const rv = await call('DELETE', `/${k.id}`, bearer(legacy(rich)));
    assert.equal(rv.status, 200); assert.equal(rv.body.revoked, true);
    assert.equal((await pool.query('SELECT is_active FROM api_keys WHERE id = $1', [k.id])).rows[0].is_active, false, 'the gateway stops accepting it');
    assert.equal((await pool.query(`SELECT legacy_status FROM external_api_keys WHERE platform_api_key_id = $1`, [k.id])).rows[0].legacy_status, 'REVOKED');
    assert.equal((await call('DELETE', `/${k.id}`, bearer(legacy(rich)))).status, 404, 'revoking twice is 404, which Spawn reads as already gone');
    assert.equal((await call('DELETE', '/not-a-uuid', bearer(legacy(rich)))).status, 404);
    const portalKey = (await pool.query(`INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1, 'xeno-portalkey01', $2, 'portal') RETURNING id::text AS id`, [rich.id, sha256('portal-key')])).rows[0].id;
    // linked exactly as the portal links its keys, so only the session-key marker tells them apart
    await pool.query(`INSERT INTO external_api_keys (source_system, external_key_id, platform_api_key_id, platform_project_id, key_prefix, legacy_status, metadata)
       VALUES ('xeno_private_api', $1, $2::uuid, $3::uuid, 'xeno-portalkey01', 'ACTIVE', '{"source":"api-portal"}'::jsonb)`, [`portal:${crypto.randomUUID()}`, portalKey, row.platform_project_id]);
    assert.equal((await call('DELETE', `/${portalKey}`, bearer(legacy(rich)))).status, 404, 'a long-lived portal key is not revoked here (the portal owns those)');
    assert.equal((await pool.query('SELECT is_active FROM api_keys WHERE id = $1', [portalKey])).rows[0].is_active, true);

    // ── OIDC: the client must have been granted inference:run; a DPoP-bound token must present its proof ──
    const noScope = await oidcToken(other, 'sk-reader', 'openid profile email ledger:read');
    const ns = await call('POST', '/', bearer(noScope), {});
    assert.equal(ns.status, 403); assert.equal(ns.body.error.code, 'INSUFFICIENT_SCOPE');
    const key = dpopKey(), jkt = jwkThumbprint(key.publicJwk);
    const bound = await oidcToken(other, 'sk-spawn', 'openid profile email inference:run', jkt);
    assert.equal((await call('POST', '/', { authorization: `DPoP ${bound}` }, {})).status, 401, 'a bound token without its proof is refused');
    const htu = `${issuer()}/api/v2/inference/session-keys`;
    const withProof = await fetch(base, {   // no trailing slash: Spawn posts to exactly the path it signs
 method: 'POST', headers: { 'content-type': 'application/json', authorization: `DPoP ${bound}`, dpop: dpopProof(key, 'POST', htu, bound) }, body: '{"ttlMinutes":30,"label":"spawn"}' });
    const wp = await withProof.json();
    assert.equal(withProof.status, 200, JSON.stringify(wp));
    assert.equal((await pool.query(`SELECT metadata->>'clientId' AS c FROM external_api_keys WHERE platform_api_key_id = $1`, [wp.key.id])).rows[0].c, 'sk-spawn', 'the asking client is recorded');
    const delHtu = `${issuer()}/api/v2/inference/session-keys/${wp.key.id}`;
    const del = await fetch(`${base}/${wp.key.id}`, { method: 'DELETE', headers: { authorization: `DPoP ${bound}`, dpop: dpopProof(key, 'DELETE', delHtu, bound) } });
    assert.equal(del.status, 200, 'and revokes it the same way');

    console.log('inference-session-keys: all checks passed');
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
