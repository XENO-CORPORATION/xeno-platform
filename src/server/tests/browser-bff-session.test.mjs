/** Real-Postgres qualification for the browser BFF session lifecycle. */
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import pg from 'pg';
import authRoutes from '../routes/authRoutes.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const cookieJar = (setCookies = []) => setCookies.map((value) => value.split(';', 1)[0]).join('; ');
const csrfFrom = (cookie) => decodeURIComponent(cookie.split('; ').find((value) => /^(?:__Host-)?xeno_csrf=/.test(value)).split('=')[1]);

async function main() {
  await runAllMigrations(pool);
  const password = 'Bff-session-test-42!';
  await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
     VALUES ('bff_test', 'bff-session@xeno.test', $1, 'BFF Test', true, true)`,
    [await bcrypt.hash(password, 4)],
  );

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: 'bff-session@xeno.test', password }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.success, true);
    assert.equal(loginBody.token, null, 'browser response must not expose a bearer');
    const cookies = cookieJar(login.headers.getSetCookie());
    assert.match(cookies, /(?:__Host-)?xeno_session=/);
    assert.match(cookies, /(?:__Host-)?xeno_csrf=/);

    const validate = await fetch(`${base}/api/auth/validate`, { headers: { cookie: cookies } });
    assert.equal(validate.status, 200, 'opaque cookie authenticates a safe request');

    const rejectedLogout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: cookies } });
    assert.equal(rejectedLogout.status, 403, 'unsafe request without CSRF is refused');

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookies, 'x-xeno-csrf': csrfFrom(cookies) },
    });
    assert.equal(logout.status, 200);

    const revoked = await fetch(`${base}/api/auth/validate`, { headers: { cookie: cookies } });
    assert.equal(revoked.status, 401, 'logout revokes the server-held session');

    // A credential does not exist until its revocation row exists. Reproduce a
    // storage failure at the real route boundary and prove neither the legacy
    // bearer path nor the browser-cookie path can fail open.
    await pool.query(`CREATE OR REPLACE FUNCTION xeno_test_reject_session_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session persistence failure'; END $$`);
    await pool.query(`CREATE TRIGGER xeno_test_reject_session_insert
      BEFORE INSERT ON user_sessions FOR EACH ROW EXECUTE FUNCTION xeno_test_reject_session_insert()`);
    try {
      const bearerFailure = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'bff-session@xeno.test', password }),
      });
      assert.equal(bearerFailure.status, 500, 'bearer login fails when the session row cannot be stored');
      const bearerBody = await bearerFailure.json();
      assert.equal(bearerBody.success, false);
      assert.equal(Object.hasOwn(bearerBody, 'token'), false, 'failed login cannot expose a fallback bearer');
      assert.deepEqual(bearerFailure.headers.getSetCookie(), [], 'failed bearer login sets no session cookie');

      const browserFailure = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
        body: JSON.stringify({ email: 'bff-session@xeno.test', password }),
      });
      assert.equal(browserFailure.status, 500, 'browser login fails when the session row cannot be stored');
      const browserBody = await browserFailure.json();
      assert.equal(browserBody.success, false);
      assert.equal(Object.hasOwn(browserBody, 'token'), false);
      assert.deepEqual(browserFailure.headers.getSetCookie(), [], 'failed browser login sets no session cookie');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS xeno_test_reject_session_insert ON user_sessions');
      await pool.query('DROP FUNCTION IF EXISTS xeno_test_reject_session_insert()');
    }
    console.log('✅ browser BFF session: opaque cookie, no browser bearer, CSRF, and revocation passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('FATAL', error);
  await pool.end().catch(() => {});
  process.exit(1);
});
