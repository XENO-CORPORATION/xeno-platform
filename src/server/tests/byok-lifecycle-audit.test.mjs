/**
 * Every BYOK credential-lifecycle op leaves an audit row, in the SAME
 * transaction as the op — real Postgres, real router, real HTTP.
 *
 * Vault's rule, borrowed: no secret operation without an audit record. Before
 * this, v2InferenceRoutes.js had ZERO recordSecurityEvent calls — a key could be
 * created, re-routed, revoked and deleted with nothing on the trail, so a leaked
 * key could not be traced to the actor who stored it or the moment it moved.
 *
 * Why HTTP and not the service functions: the audit lives at the route layer,
 * where the actor (req.user, ip, user-agent) is known. Calling the services
 * directly would pass with no audit at all — the exact gap being closed.
 *
 * Mutation: remove the audit write from `audited()` in v2InferenceRoutes.js ->
 * "every lifecycle op has exactly one audit row" fails. Make the audit
 * best-effort (swallow) -> "an op whose audit cannot be written does not happen"
 * fails.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import v2InferenceRoutes from '../routes/v2InferenceRoutes.js';
import { oidcAuth } from '../middleware/oidcAuth.js';
import { encrypt } from '../utils/secretBox.js';
import { fingerprint } from '../services/providerCredentials.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SECRET_BOX_KEY) throw new Error('SECRET_BOX_KEY is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

async function main() {
  await runAllMigrations(pool);
  const userId = (await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active)
     VALUES ('byok-audit@xeno.test','byok_audit','BYOK Audit','x', true, true) RETURNING id`,
  )).rows[0].id;
  // A legacy HS256 platform token: resolveAuthedUser accepts it without a sid.
  const token = jwt.sign({ userId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  // createCredential verifies against the live provider and safeEndpoint refuses
  // loopback (both the guards working), so the credential is seeded directly —
  // the same way inference-routing-live does — and the CREATE audit is asserted
  // by shape on the route source below. Everything after creation goes over HTTP.
  const FAKE = `sk-audit-${'x'.repeat(32)}`;
  const cred = (await pool.query(
    `INSERT INTO user_provider_credentials (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, status, verified_at)
     VALUES ($1,'compatible','ds',$2,$3,'xxxx','active',NOW()) RETURNING id`,
    [userId, encrypt(FAKE), fingerprint(FAKE)],
  )).rows[0].id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/inference', oidcAuth, v2InferenceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v2/inference`;
  const call = (method, path, body) => fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'AuditProbe/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const events = async () => (await pool.query(
    `SELECT event_type, metadata, user_agent FROM security_events WHERE user_id=$1 AND event_type LIKE 'byok_%' ORDER BY created_at`, [userId],
  )).rows;

  try {
    // models
    let r = await call('PUT', `/credentials/${cred}/models`, { models: ['deepseek-chat'] });
    ok(r.status === 200, `PUT models → ${r.status}`);
    // route set
    r = await call('PUT', '/routes/xeno-pixel', { path: 'byok', mode: 'managed', credentialId: cred });
    ok(r.status === 200, `PUT route → ${r.status}`);
    // route clear
    r = await call('DELETE', '/routes/xeno-pixel');
    ok(r.status === 200, `DELETE route → ${r.status}`);
    // revoke
    r = await call('POST', `/credentials/${cred}/revoke`);
    ok(r.status === 200, `POST revoke → ${r.status}`);
    // delete (no route points at it now)
    r = await call('DELETE', `/credentials/${cred}`);
    ok(r.status === 200, `DELETE credential → ${r.status}`);

    const rows = await events();
    const types = rows.map((x) => x.event_type);
    ok(JSON.stringify(types) === JSON.stringify([
      'byok_credential_models_set', 'byok_route_set', 'byok_route_cleared', 'byok_credential_revoked', 'byok_credential_deleted',
    ]), `every lifecycle op has exactly one audit row, in order (${types.join(', ')})`);
    ok(rows.every((x) => x.user_agent === 'AuditProbe/1.0'), 'each row carries the actor context (user-agent)');
    const routeRow = rows.find((x) => x.event_type === 'byok_route_set');
    ok(routeRow && routeRow.metadata.surface === 'xeno-pixel' && routeRow.metadata.path === 'byok' && routeRow.metadata.credentialId === cred,
      'the route audit names surface, path and credential');
    const revokeRow = rows.find((x) => x.event_type === 'byok_credential_revoked');
    ok(revokeRow && revokeRow.metadata.fingerprint === fingerprint(FAKE), 'the revoke audit carries the key FINGERPRINT');
    const deleteRow = rows.find((x) => x.event_type === 'byok_credential_deleted');
    ok(deleteRow && deleteRow.metadata.fingerprint === fingerprint(FAKE) && deleteRow.metadata.provider === 'compatible',
      'the delete audit carries provider + fingerprint (the row is gone; the trail is not)');
    const blob = JSON.stringify(rows);
    ok(!blob.includes(FAKE) && !blob.includes('xxxx'), 'no audit row carries the key or its last4');

    // ── the transaction: an op whose audit cannot be written does not happen ──
    const cred2 = (await pool.query(
      `INSERT INTO user_provider_credentials (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, status, verified_at)
       VALUES ($1,'compatible','ds2',$2,$3,'yyyy','active',NOW()) RETURNING id`,
      [userId, encrypt(FAKE + '2'), fingerprint(FAKE + '2')],
    )).rows[0].id;
    await pool.query(`CREATE OR REPLACE FUNCTION xeno_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type LIKE 'byok_%' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER xeno_test_reject_audit BEFORE INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION xeno_test_reject_audit()');
    try {
      const rr = await call('POST', `/credentials/${cred2}/revoke`);
      ok(rr.status >= 500, `revoke with a failing audit answers ${rr.status}, not success`);
      const still = await pool.query('SELECT status FROM user_provider_credentials WHERE id=$1', [cred2]);
      ok(still.rows[0].status === 'active', 'an op whose audit cannot be written does not happen — the credential is still active');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS xeno_test_reject_audit ON security_events');
      await pool.query('DROP FUNCTION IF EXISTS xeno_test_reject_audit()');
    }

    // ── create: asserted by shape, for the reason above ──
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/v2InferenceRoutes.js', import.meta.url), 'utf8');
    const createBlock = src.slice(src.indexOf("router.post('/credentials'"), src.indexOf("router.put('/credentials/:id/models'"));
    ok(/audited\(req, EVENTS\.BYOK_CREDENTIAL_CREATED/.test(createBlock), 'credential creation is wrapped in the audited transaction');
    ok(!/createCredential\(req\.db/.test(createBlock), 'credential creation no longer runs unaudited on the pool');
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} byok-lifecycle-audit: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error('FATAL', e); await pool.end().catch(() => {}); process.exit(1); });
