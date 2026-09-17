/**
 * A suspended account is refused EVERYWHERE a credential is presented — not only
 * on routes that remembered to check. Real Postgres (real migrations), the real
 * gate mounted exactly as index.js mounts it, in front of (a) the real /api/auth
 * router, whose /me resolves the token by hand, and (b) a route behind the real
 * authMiddleware.
 *
 * Dogfooding 2026-09-17 (F21, journey 4): with the owner suspended, its agent
 * answered 200 on /api/v2/me and SPENT the owner's credits on /api/ai/chat; the
 * owner's own bearer kept answering 200 on /api/auth/me.
 *
 * Mutations: remove `app.use('/api/', suspensionGate(pool))` from the mount ->
 * "the owner's own token on the hand-rolled /me" fails. Drop the owner cascade
 * (resolvePrincipal) from the gate -> "the agent's key with the owner suspended"
 * fails. Put `is_active = true` back in resolveAuthedUser's SELECT -> the
 * hand-rolled /me test fails (the gate cannot tell suspended from unknown).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { suspensionGate } from '../middleware/suspensionGate.js';
import { authMiddleware } from '../middleware/auth.js';
import authRoutes from '../routes/authRoutes.js';
import { createAgent, resolvePrincipal } from '../services/agentIdentity.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

async function main() {
  await runAllMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active)
    VALUES ('susp@xeno.test','susp_t','Susp','x', true, true) RETURNING id`)).rows[0].id;
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'pro', 'active')", [owner]);
  const ownerToken = jwt.sign({ userId: owner }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const ownerPrincipal = await resolvePrincipal(pool, owner);
  const { apiKey: agentKey } = await createAgent(pool, ownerPrincipal, { name: 'bot', agentRole: 'other', agentOrigin: 'manual' });
  // The owner's own API key (a developer key on a human account).
  const rawKey = `xeno-${crypto.randomBytes(24).toString('hex')}`;
  await pool.query(
    `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, is_active) VALUES ($1, 'k', $2, $3, true)`,
    [owner, rawKey.slice(0, 16), crypto.createHash('sha256').update(rawKey).digest('hex')],
  );

  const app = express();
  app.use(express.json());
  app.use('/api/', (req, _res, next) => { req.db = pool; next(); });
  app.use('/api/', suspensionGate(pool));
  app.use('/api/auth', authRoutes);
  app.get('/api/guarded', authMiddleware, (req, res) => res.json({ ok: true, id: req.user.id }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });

  try {
    ok((await get('/api/auth/me', ownerToken)).status === 200, 'active owner: hand-rolled /me answers 200');
    ok((await get('/api/guarded', agentKey)).status === 200, 'active owner: the agent key passes authMiddleware');
    ok((await get('/api/guarded', rawKey)).status === 200, 'active owner: the developer key passes');

    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [owner]);

    const me = await get('/api/auth/me', ownerToken);
    ok(me.status === 401 && (await me.json()).error === 'account_suspended', "the owner's own token on the hand-rolled /me is refused (401 account_suspended)");
    const ag = await get('/api/guarded', agentKey);
    const agBody = await ag.json();
    ok(ag.status === 403 && agBody.error === 'owner_suspended' && /owner account is suspended/.test(agBody.message),
      `the agent's key with the owner suspended is refused with WHY (${ag.status} ${agBody.error})`);
    const dk = await get('/api/guarded', rawKey);
    ok(dk.status === 401 && (await dk.json()).error === 'account_suspended', "the owner's developer key is refused");
    ok((await get('/api/auth/me', ownerToken)).status === 401, 'and it stays refused on the second request (no cache lets it through)');
    ok((await fetch(`${base}/api/auth/me`)).status === 401, 'no credential at all is still the route\'s own 401, untouched');
    const bogus = await get('/api/guarded', 'xeno-not-a-real-key-000000000000000000000000000000');
    ok(bogus.status === 401 && (await bogus.json()).error !== 'account_suspended', 'an unknown key is refused by the route, not mislabelled as suspended');

    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [owner]);
    ok((await get('/api/auth/me', ownerToken)).status === 200 && (await get('/api/guarded', agentKey)).status === 200, 'reinstating the owner restores both, immediately — the cascade is derived, not stored');
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} suspension-gate: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch(async (e) => { console.error('FATAL', e); await pool.end().catch(() => {}); process.exitCode = 1; });
