/**
 * API-key → user resolution in resolveAuthedUser / authMiddleware.
 *
 * Mounts the REAL authMiddleware over an ephemeral Postgres and drives a tiny
 * `/api/v2/me`-style route. Inserts a user + an api_keys row hashed with the
 * SAME scheme the gateway/portal mint under (key_prefix = rawKey.slice(0,16),
 * key_hash = sha256(rawKey) hex), then asserts:
 *   1. a valid API key            → 200 + correct user
 *   2. a legacy HS256 JWT         → 200 (no regression)
 *   3. unknown / inactive / expired key → 401
 *   4. malformed / missing token  → 401
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:PORT/t node tests/api-key-auth.test.mjs
 */
import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Mint a raw key + its at-rest columns exactly like the gateway/portal do.
function mintKey() {
  const rawKey = 'xeno-' + crypto.randomBytes(24).toString('hex');
  return { rawKey, keyPrefix: rawKey.slice(0, 16), keyHash: sha256(rawKey) };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE, email text UNIQUE, display_name text, avatar_url text,
  email_verified boolean DEFAULT false, is_active boolean DEFAULT true,
  role text DEFAULT 'user', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, expires_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key_prefix varchar(16) NOT NULL,
  key_hash varchar(255) NOT NULL UNIQUE,
  name varchar(100) DEFAULT 'Default Key' NOT NULL,
  is_active boolean DEFAULT true,
  last_used_at timestamp, usage_count bigint DEFAULT 0,
  created_at timestamp DEFAULT now(), expires_at timestamp);
`;

async function main() {
  await pool.query(SCHEMA);

  // --- Seed a user, plus a second inactive user, and various api_keys rows ---
  const u = (await pool.query(
    `INSERT INTO users (username, email, display_name) VALUES ('cliuser','cli@t.example','CLI User') RETURNING id`,
  )).rows[0];
  const uInactive = (await pool.query(
    `INSERT INTO users (username, email, display_name, is_active) VALUES ('dead','dead@t.example','Dead', false) RETURNING id`,
  )).rows[0];

  const valid = mintKey();
  await pool.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1,$2,$3,'valid')`,
    [u.id, valid.keyPrefix, valid.keyHash],
  );
  const inactiveKey = mintKey();
  await pool.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, is_active) VALUES ($1,$2,$3,'inactive', false)`,
    [u.id, inactiveKey.keyPrefix, inactiveKey.keyHash],
  );
  const expiredKey = mintKey();
  await pool.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, expires_at) VALUES ($1,$2,$3,'expired', now() - interval '1 hour')`,
    [u.id, expiredKey.keyPrefix, expiredKey.keyHash],
  );
  // A valid key whose OWNER is deactivated — must be rejected.
  const deadOwnerKey = mintKey();
  await pool.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1,$2,$3,'deadowner')`,
    [uInactive.id, deadOwnerKey.keyPrefix, deadOwnerKey.keyHash],
  );

  // --- Tiny app mounting the REAL authMiddleware on a v2-style route ---
  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.get('/api/v2/me', authMiddleware, (req, res) => res.json({ success: true, user: req.user }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (headers = {}) => {
    const res = await fetch(base + '/api/v2/me', { headers });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  // 1. Valid API key → 200 + correct user
  const r1 = await get({ Authorization: `Bearer ${valid.rawKey}` });
  ok(r1.status === 200 && r1.json.user?.id === u.id, 'valid API key → 200 with correct user');
  ok(r1.json.user?.email === 'cli@t.example', 'resolved user has expected email');
  ok(r1.json.user?.password_hash === undefined, 'user shape does not leak secret columns');
  // last_used_at best-effort bump landed
  await new Promise((r) => setTimeout(r, 50));
  const used = (await pool.query('SELECT last_used_at, usage_count FROM api_keys WHERE key_hash=$1', [valid.keyHash])).rows[0];
  ok(used.last_used_at != null && Number(used.usage_count) === 1, 'last_used_at set + usage_count bumped');

  // 2. Legacy HS256 JWT still works (no regression)
  const legacyToken = jwt.sign({ userId: u.id, email: 'cli@t.example', username: 'cliuser' }, JWT_SECRET, { expiresIn: '1h' });
  const r2 = await get({ Authorization: `Bearer ${legacyToken}` });
  ok(r2.status === 200 && r2.json.user?.id === u.id, 'legacy HS256 JWT → 200 (no regression)');

  // 3a. Unknown key → 401
  const r3 = await get({ Authorization: `Bearer ${mintKey().rawKey}` });
  ok(r3.status === 401, 'unknown API key → 401');
  // 3b. Inactive key → 401
  const r4 = await get({ Authorization: `Bearer ${inactiveKey.rawKey}` });
  ok(r4.status === 401, 'inactive API key → 401');
  // 3c. Expired key → 401
  const r5 = await get({ Authorization: `Bearer ${expiredKey.rawKey}` });
  ok(r5.status === 401, 'expired API key → 401');
  // 3d. Valid key but deactivated owner → 401
  const r6 = await get({ Authorization: `Bearer ${deadOwnerKey.rawKey}` });
  ok(r6.status === 401, 'valid key with deactivated owner → 401');

  // 4a. Malformed / random non-JWT token → 401 (no crash)
  const r7 = await get({ Authorization: 'Bearer not-a-real-token-just-garbage' });
  ok(r7.status === 401, 'malformed non-JWT token → 401');
  // 4b. Garbage JWT-shaped token → 401
  const r8 = await get({ Authorization: 'Bearer aaa.bbb.ccc' });
  ok(r8.status === 401, 'garbage JWT-shaped token → 401');
  // 4c. Missing token → 401
  const r9 = await get({});
  ok(r9.status === 401, 'missing token → 401');

  console.log(`\n${fail === 0 ? '✅' : '❌'} api-key-auth: ${pass} passed, ${fail} failed`);
  server.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
