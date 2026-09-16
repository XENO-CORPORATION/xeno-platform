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

  // The password-change case gets its OWN account on purpose: it rotates the
  // credential, and the injected-failure block below still signs in as the first
  // user. Sharing one account would couple the two by execution order.
  const changePassword = 'Bff-change-test-42!';
  await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
     VALUES ('bff_change', 'bff-change@xeno.test', $1, 'BFF Change', true, true)`,
    [await bcrypt.hash(changePassword, 4)],
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

    // ── SIGN IN → RELOAD → CHANGE PASSWORD ────────────────────────────────
    //
    // The reload is the whole point. `src/lib/authSession.ts` keeps the bearer in
    // MEMORY, so after a page load `getAccessToken()` returns COOKIE_SESSION_MARKER
    // and `installAuthenticatedFetch` strips it from the header — deliberately, since
    // a marker is not a credential. Only the cookies survive. `PUT /api/auth/password`
    // used to read `req.headers.authorization` and verify an HS256 token itself, so it
    // saw nothing and answered 401 "Authentication token required" for every signed-in
    // user who had reloaded the page. Sending no Authorization header here reproduces
    // that exactly; the route must authenticate through the unified resolver instead.
    const reloginForChange = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: 'bff-change@xeno.test', password: changePassword }),
    });
    assert.equal(reloginForChange.status, 200);
    const changeCookies = cookieJar(reloginForChange.headers.getSetCookie());

    // A SECOND device, signed in before the change. Without it, "other sessions are
    // revoked" would pass against an account that only ever had one session — the
    // assertion would be unfalsifiable.
    const otherDevice = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: 'bff-change@xeno.test', password: changePassword }),
    });
    assert.equal(otherDevice.status, 200);
    const otherCookies = cookieJar(otherDevice.headers.getSetCookie());
    const otherBefore = await fetch(`${base}/api/auth/validate`, { headers: { cookie: otherCookies } });
    assert.equal(otherBefore.status, 200, 'the second device is signed in before the change');

    const noCsrf = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: changeCookies },
      body: JSON.stringify({ current_password: changePassword, new_password: 'Bff-change-test-43!' }),
    });
    assert.equal(noCsrf.status, 403, 'a cookie alone is not authority for a state change');

    const wrongCurrent = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: changeCookies, 'x-xeno-csrf': csrfFrom(changeCookies) },
      body: JSON.stringify({ current_password: 'not-the-password', new_password: 'Bff-change-test-43!' }),
    });
    assert.equal(wrongCurrent.status, 400, 'a valid session still cannot change a password without the current one');

    const changed = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: changeCookies, 'x-xeno-csrf': csrfFrom(changeCookies) },
      body: JSON.stringify({ current_password: changePassword, new_password: 'Bff-change-test-43!' }),
    });
    assert.equal(changed.status, 200, 'a reloaded browser session must be able to change its own password');

    // THE SESSION THAT MADE THE CHANGE SURVIVES, WITH NEW SECRETS.
    //
    // Revoking the caller's own session logged the user out of the tab they were
    // working in, while the UI still believed it was signed in — so the next click
    // returned a bare 401 and a SUCCESSFUL change presented as a failure. The
    // response must say so explicitly rather than leaving the client to infer it.
    const changedBody = await changed.json();
    assert.equal(changedBody.signedOut, false, 'a browser session is re-issued, not revoked');
    const rotatedCookies = cookieJar(changed.headers.getSetCookie());
    assert.match(rotatedCookies, /(?:__Host-)?xeno_session=/, 'the change must hand back a fresh session cookie');

    const staleCookie = await fetch(`${base}/api/auth/validate`, { headers: { cookie: changeCookies } });
    assert.equal(staleCookie.status, 401, 'the OLD cookie secret must be dead after the change');

    const freshCookie = await fetch(`${base}/api/auth/validate`, { headers: { cookie: rotatedCookies } });
    assert.equal(freshCookie.status, 200, 'the re-issued cookie keeps the user signed in where they are');

    // And every OTHER device is gone — that is the part the security rule is about.
    const otherAfter = await fetch(`${base}/api/auth/validate`, { headers: { cookie: otherCookies } });
    assert.equal(otherAfter.status, 401, 'the second device must be signed out by the password change');
    const others = await pool.query(
      `SELECT count(*)::int AS n FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = 'bff-change@xeno.test'`,
    );
    assert.equal(others.rows[0].n, 1, 'exactly one session survives a password change: the caller’s');

    const oldPassword = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: 'bff-change@xeno.test', password: changePassword }),
    });
    assert.equal(oldPassword.status === 200, false, 'the old password must stop working');

    const newPassword = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: 'bff-change@xeno.test', password: 'Bff-change-test-43!' }),
    });
    assert.equal(newPassword.status, 200, 'the new password must work');

    // An operator-initiated change is only auditable if it is recorded.
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM security_events se
        JOIN users u ON u.id = se.user_id
       WHERE u.email = 'bff-change@xeno.test' AND se.event_type = 'password_changed'`,
    );
    assert.equal(audit.rows[0].n, 1, 'a password change must leave exactly one audit event');

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
    console.log("✅ browser BFF session: opaque cookie, no browser bearer, CSRF, revocation, and reload→password-change passed");
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
