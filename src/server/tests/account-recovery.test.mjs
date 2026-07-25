/**
 * Account recovery + verification + signup-credit idempotency (B2b/B2c/B2d).
 *
 * Mounts the REAL authRoutes router over an ephemeral Postgres and drives the
 * endpoints over HTTP. Reset/verify tokens are inserted directly (the raw token
 * only ever exists in the email, never in the DB), so the token-consume paths are
 * exercised end-to-end against the real handler SQL.
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55499/t node tests/account-recovery.test.mjs
 */
import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import authRoutes from '../routes/authRoutes.js';

// Same default the server uses when JWT_SECRET is unset (non-production test env).
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const BASE = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE, email text UNIQUE, password_hash text, display_name text, avatar_url text,
  email_verified boolean DEFAULT false, is_active boolean DEFAULT true,
  credits bigint DEFAULT 0, bonus_credits_claimed boolean DEFAULT false,
  status text DEFAULT 'active', role text DEFAULT 'user', plan text DEFAULT 'free',
  recovery_email text, workspace_activated_at timestamptz,
  last_login timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, token_hash text, session_token text, expires_at timestamptz,
  ip_address text, user_agent text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, token_hash varchar(255) NOT NULL,
  expires_at timestamp NOT NULL, used_at timestamp, created_at timestamp DEFAULT now());
CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, email varchar(255) NOT NULL,
  token_hash varchar(255) NOT NULL, expires_at timestamp NOT NULL, verified_at timestamp, created_at timestamp DEFAULT now());
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY, user_id uuid, to_email text, template text, subject text,
  status text, error text, sent_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool); // credit_grants + uq_credit_txn_ref (the idempotency index)

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/auth', authRoutes);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const get = async (path, headers = {}) => {
    const res = await fetch(base + path, { headers });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uid = async (email) => (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0]?.id;
  const grantCount = async (userId, ref) => (await pool.query('SELECT count(*)::int n FROM credit_grants WHERE user_id=$1 AND source_ref=$2', [userId, ref])).rows[0].n;

  // ---- B2d: signup-credit grant is per-user idempotent (the sourceRef fix) ----
  const r1 = await post('/register', { username: 'u1', email: 'u1@t.example', password: 'password1', display_name: 'U One' });
  ok(r1.status === 201 && r1.json.success, 'register user1 → 201');
  const r2 = await post('/register', { username: 'u2', email: 'u2@t.example', password: 'password1', display_name: 'U Two' });
  ok(r2.status === 201 && r2.json.success, 'register user2 → 201');
  const id1 = await uid('u1@t.example'), id2 = await uid('u2@t.example');
  // The bug this proves: a CONSTANT sourceRef:'signup' collided on uq_credit_txn_ref for
  // user2, so pre-fix user2 got ZERO signup credits. Both must now have their own grant.
  ok((await grantCount(id1, `signup:${id1}`)) === 1, 'user1 has a signup grant (signup:<id1>)');
  ok((await grantCount(id2, `signup:${id2}`)) === 1, 'user2 ALSO has a signup grant (idempotency-collision fixed)');

  // ---- B2c: register issues an email-verification token ----
  ok((await pool.query('SELECT count(*)::int n FROM email_verifications WHERE user_id=$1', [id1])).rows[0].n === 1, 'register issued an email_verifications token');
  ok((await pool.query('SELECT email_verified FROM users WHERE id=$1', [id1])).rows[0].email_verified === false, 'new user starts unverified (soft-gate)');

  // ---- Session-backed tokens: sid claim + hashed session row, logout revokes ----
  const login1 = await post('/login', { email: 'u2@t.example', password: 'password1' });
  ok(login1.status === 200 && login1.json.token, 'login u2 → 200 with token');
  const loginDecoded = jwt.decode(login1.json.token);
  ok(typeof loginDecoded?.sid === 'string' && loginDecoded.sid.length > 0, 'login token carries a sid claim');
  const sessRow = (await pool.query('SELECT token_hash, session_token FROM user_sessions WHERE id=$1 AND user_id=$2', [loginDecoded.sid, id2])).rows[0];
  ok(!!sessRow, 'login created a user_sessions row with id = sid');
  ok(sessRow.token_hash === sha256(login1.json.token), 'session row stores sha256(jwt) as token_hash');
  ok(sessRow.session_token == null, 'plaintext JWT is NOT stored (session_token is NULL)');
  const v1 = await get('/validate', { Authorization: `Bearer ${login1.json.token}` });
  ok(v1.status === 200 && v1.json.success, 'validate (live session) → 200');
  const lo = await post('/logout', {}, { Authorization: `Bearer ${login1.json.token}` });
  ok(lo.status === 200 && lo.json.success, 'logout → 200');
  ok((await pool.query('SELECT count(*)::int n FROM user_sessions WHERE id=$1', [loginDecoded.sid])).rows[0].n === 0, 'logout deleted the session row');
  const v2 = await get('/validate', { Authorization: `Bearer ${login1.json.token}` });
  ok(v2.status === 401, 'logged-out token → 401 (revocation actually works now)');
  const me2 = await get('/me', { Authorization: `Bearer ${login1.json.token}` });
  ok(me2.status === 401, 'logged-out token → 401 on /me too');

  // ---- Legacy (no-sid) tokens issued pre-deploy keep working until they age out ----
  const legacyToken = jwt.sign({ userId: id2, email: 'u2@t.example', username: 'u2' }, JWT_SECRET, { expiresIn: '1h' });
  const vLegacy = await get('/validate', { Authorization: `Bearer ${legacyToken}` });
  ok(vLegacy.status === 200 && vLegacy.json.success, 'legacy no-sid token still accepted (backward compat)');

  // ---- B2b: forgot-password never leaks account existence ----
  const f1 = await post('/forgot-password', { email: 'u1@t.example' });
  ok(f1.status === 200 && f1.json.success === true, 'forgot-password (real account) → generic 200');
  ok((await pool.query('SELECT count(*)::int n FROM password_resets WHERE user_id=$1', [id1])).rows[0].n === 1, 'forgot-password created a reset token for the real account');
  const before = (await pool.query('SELECT count(*)::int n FROM password_resets')).rows[0].n;
  const f2 = await post('/forgot-password', { email: 'ghost@t.example' });
  const after = (await pool.query('SELECT count(*)::int n FROM password_resets')).rows[0].n;
  ok(f2.status === 200 && f2.json.success === true && JSON.stringify(f1.json) === JSON.stringify(f2.json), 'forgot-password (unknown email) → identical generic 200 (no enumeration)');
  ok(after === before, 'forgot-password (unknown email) created no token');

  // ---- B2b: reset-password consumes a single-use, unexpired token ----
  await pool.query(`INSERT INTO user_sessions (user_id, token_hash, session_token, expires_at) VALUES ($1,'h','s', now()+interval '7 days')`, [id1]);
  await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id1, sha256('RESET_ME')]);
  const rp = await post('/reset-password', { token: 'RESET_ME', password: 'brandnew123' });
  ok(rp.status === 200 && rp.json.success, 'reset-password (valid token) → 200');
  const newHash = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [id1])).rows[0].password_hash;
  ok(await bcrypt.compare('brandnew123', newHash), 'password actually updated to the new value');
  ok((await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id=$1', [id1])).rows[0].n === 0, 'reset revoked all existing sessions');
  // The register-time token (a sid token) must be DEAD after the reset revoked its session.
  const vOld = await get('/validate', { Authorization: `Bearer ${r1.json.token}` });
  ok(vOld.status === 401, 'pre-reset sid token → 401 after password reset (stolen tokens die)');
  const rp2 = await post('/reset-password', { token: 'RESET_ME', password: 'againagain1' });
  ok(rp2.status === 400 && !rp2.json.success, 'reset-password (reused token) → 400 single-use');
  await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now()-interval '1 hour')`, [id1, sha256('EXPIRED')]);
  const rp3 = await post('/reset-password', { token: 'EXPIRED', password: 'whatever12' });
  ok(rp3.status === 400 && !rp3.json.success, 'reset-password (expired token) → 400');
  const rp4 = await post('/reset-password', { token: 'RESET_ME', password: 'short' });
  ok(rp4.status === 400, 'reset-password (password < 6) → 400');

  // ---- B2c: verify-email consumes a single-use token; soft (login never blocked) ----
  await pool.query(`INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES ($1,$2,$3, now()+interval '24 hours')`, [id2, 'u2@t.example', sha256('VERIFY_ME')]);
  const ve = await post('/verify-email', { token: 'VERIFY_ME' });
  ok(ve.status === 200 && ve.json.success, 'verify-email (valid token) → 200');
  ok((await pool.query('SELECT email_verified FROM users WHERE id=$1', [id2])).rows[0].email_verified === true, 'user marked email_verified=true');
  const ve2 = await post('/verify-email', { token: 'VERIFY_ME' });
  ok(ve2.status === 400 && !ve2.json.success, 'verify-email (reused token) → 400');
  const ve3 = await post('/verify-email', { token: 'bogus' });
  ok(ve3.status === 400 && !ve3.json.success, 'verify-email (bogus token) → 400');

  // ---- B2c: resend-verification requires auth; re-issues for the logged-in user ----
  const noauth = await post('/resend-verification', {});
  ok(noauth.status === 401, 'resend-verification (no token) → 401');
  const beforeV = (await pool.query('SELECT count(*)::int n FROM email_verifications WHERE user_id=$1', [id1])).rows[0].n;
  // r1's original token died with the password reset above — sign in again for a live one.
  const relogin1 = await post('/login', { email: 'u1@t.example', password: 'brandnew123' });
  ok(relogin1.status === 200 && relogin1.json.token, 'u1 re-login with the NEW password → 200');
  const resend = await post('/resend-verification', {}, { Authorization: `Bearer ${relogin1.json.token}` });
  ok(resend.status === 200 && resend.json.success, 'resend-verification (authed, unverified) → 200');
  ok((await pool.query('SELECT count(*)::int n FROM email_verifications WHERE user_id=$1', [id1])).rows[0].n === beforeV + 1, 'resend-verification issued a fresh token');

  console.log(`\n${fail === 0 ? '✅' : '❌'} account-recovery: ${pass} passed, ${fail} failed`);
  server.close();
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
