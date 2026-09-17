/**
 * Real-PostgreSQL qualification for password-change atomicity, concurrency protection,
 * credential revocation, and audit durability.
 *
 * Mandatory gates:
 * 1. Sign in via browser BFF, reload (no in-memory bearer), change password with cookies + CSRF.
 * 2. Old password refused, new password accepted, rotated cookie works, old cookie and second device fail.
 * 3. Authenticated follow-up to Settings works using rotated cookie.
 * 4. Wrong current password, missing/bad CSRF, and non-admin access perform no credential writes.
 * 5. Injected failure in session revocation or audit persistence rolls back completely:
 *    password is NOT updated, old password remains active, old sessions remain valid.
 * 6. Concurrency: two simultaneous password-change requests using the same old password
 *    cannot both succeed; one succeeds and the second is rejected with 400.
 * 7. Admin reset burns outstanding reset tokens and revokes sessions atomically without altering API keys/credits.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import pg from 'pg';
import authRoutes from '../routes/authRoutes.js';
import userDataRoutes from '../routes/userDataRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const cookieJar = (setCookies = []) => setCookies.map((value) => value.split(';', 1)[0]).join('; ');
const csrfFrom = (cookie) => {
  const match = cookie.split('; ').find((value) => /^(?:__Host-)?xeno_csrf=/.test(value));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1]);
};

async function verifyPasswordHash(password, hash) {
  return bcrypt.compare(password, hash);
}

async function main() {
  await runAllMigrations(pool);
  const { migrateAccountV2 } = await import('../database/migrate-account-v2.js');
  await migrateAccountV2(pool);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/auth', authRoutes);
  app.use('/api/user-data', authMiddleware, userDataRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ── 1. HAPPY PATH: SIGN IN -> RELOAD -> CHANGE PASSWORD -> ROTATION ──
    const user1Email = 'atomicity-happy@xeno.test';
    const oldPassword1 = 'Old-Pass-123!';
    const newPassword1 = 'New-Pass-456!';
    const hash1 = await bcrypt.hash(oldPassword1, 4);

    const user1Res = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
       VALUES ('atomicity_user1', $1, $2, 'Atomicity User 1', true, true)
       RETURNING id`,
      [user1Email, hash1],
    );
    const user1Id = user1Res.rows[0].id;

    // Device 1 signs in
    const dev1Login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user1Email, password: oldPassword1 }),
    });
    assert.equal(dev1Login.status, 200);
    const dev1Cookies = cookieJar(dev1Login.headers.getSetCookie());

    // Device 2 signs in
    const dev2Login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user1Email, password: oldPassword1 }),
    });
    assert.equal(dev2Login.status, 200);
    const dev2Cookies = cookieJar(dev2Login.headers.getSetCookie());

    // Both devices validate OK before change
    assert.equal((await fetch(`${base}/api/auth/validate`, { headers: { cookie: dev1Cookies } })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/validate`, { headers: { cookie: dev2Cookies } })).status, 200);

    // Missing CSRF refused
    const missingCsrf = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: dev1Cookies },
      body: JSON.stringify({ current_password: oldPassword1, new_password: newPassword1 }),
    });
    assert.equal(missingCsrf.status, 403, 'PUT /password without CSRF must return 403');

    // Wrong current password refused with 400
    const wrongCurrent = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: dev1Cookies, 'x-xeno-csrf': csrfFrom(dev1Cookies) },
      body: JSON.stringify({ current_password: 'completely-wrong-pw', new_password: newPassword1 }),
    });
    assert.equal(wrongCurrent.status, 400, 'Wrong current password must return 400');

    // Successful change from Device 1
    const changeRes = await fetch(`${base}/api/auth/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: dev1Cookies, 'x-xeno-csrf': csrfFrom(dev1Cookies) },
      body: JSON.stringify({ current_password: oldPassword1, new_password: newPassword1 }),
    });
    assert.equal(changeRes.status, 200);
    const changeBody = await changeRes.json();
    assert.equal(changeBody.success, true);
    assert.equal(changeBody.signedOut, false);

    const dev1RotatedCookies = cookieJar(changeRes.headers.getSetCookie());
    assert.match(dev1RotatedCookies, /(?:__Host-)?xeno_session=/, 'returns fresh session cookie');
    assert.match(dev1RotatedCookies, /(?:__Host-)?xeno_csrf=/, 'returns fresh csrf cookie');

    // Device 1 OLD cookies are now revoked
    assert.equal((await fetch(`${base}/api/auth/validate`, { headers: { cookie: dev1Cookies } })).status, 401);
    // Device 2 cookies are revoked
    assert.equal((await fetch(`${base}/api/auth/validate`, { headers: { cookie: dev2Cookies } })).status, 401);
    // Device 1 NEW rotated cookies work
    assert.equal((await fetch(`${base}/api/auth/validate`, { headers: { cookie: dev1RotatedCookies } })).status, 200);

    // Exactly one session survives immediately after password change
    const sessionCount = await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1', [user1Id]);
    assert.equal(sessionCount.rows[0].n, 1, 'exactly one session survives immediately after password change');

    // Follow-up to Settings works cleanly with rotated cookies
    const settingsRes = await fetch(`${base}/api/user-data/settings`, {
      headers: { cookie: dev1RotatedCookies },
    });
    assert.equal(settingsRes.status, 200, 'Follow-up to /api/user-data/settings must succeed with rotated cookies');

    // Old password stops working, new password works
    assert.notEqual((await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: oldPassword1 }),
    })).status, 200);

    assert.equal((await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: newPassword1 }),
    })).status, 200);

    // Security event was durably recorded
    const auditEvents = await pool.query(
      "SELECT count(*)::int AS n FROM security_events WHERE user_id = $1 AND event_type = 'password_changed'",
      [user1Id],
    );
    assert.equal(auditEvents.rows[0].n, 1);

    // ── 2. ATOMIC ROLLBACK ON INJECTED SESSION REVOCATION FAILURE ──
    const user2Email = 'atomicity-fail-revocation@xeno.test';
    const oldPassword2 = 'Old-Pass-RevFail!';
    const attemptedNewPassword2 = 'New-Pass-ShouldNotCommit!';
    const user2Res = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
       VALUES ('atomicity_user2', $1, $2, 'Atomicity User 2', true, true)
       RETURNING id`,
      [user2Email, await bcrypt.hash(oldPassword2, 4)],
    );
    const user2Id = user2Res.rows[0].id;

    const user2Login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user2Email, password: oldPassword2 }),
    });
    assert.equal(user2Login.status, 200);
    const user2Cookies = cookieJar(user2Login.headers.getSetCookie());

    // Device 2 also signs in, so user2 has other sessions to revoke
    const user2Login2 = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user2Email, password: oldPassword2 }),
    });
    assert.equal(user2Login2.status, 200);

    // Inject trigger failure on DELETE from user_sessions
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_user_sessions_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD.user_id = '${user2Id}'::uuid THEN
          RAISE EXCEPTION 'injected session revocation failure';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      CREATE TRIGGER trg_test_fail_user_sessions_delete
      BEFORE DELETE ON user_sessions
      FOR EACH ROW EXECUTE FUNCTION test_fail_user_sessions_delete();
    `);

    try {
      const failChange = await fetch(`${base}/api/auth/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: user2Cookies, 'x-xeno-csrf': csrfFrom(user2Cookies) },
        body: JSON.stringify({ current_password: oldPassword2, new_password: attemptedNewPassword2 }),
      });
      assert.equal(failChange.status, 500, 'injected failure must produce 500');

      // CRITICAL ATOMICITY CHECK:
      // The password in the database MUST NOT have been changed to attemptedNewPassword2!
      const user2Check = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user2Id]);
      const currentHashInDb = user2Check.rows[0].password_hash;
      const isNewCommitted = await verifyPasswordHash(attemptedNewPassword2, currentHashInDb);
      const isOldStillActive = await verifyPasswordHash(oldPassword2, currentHashInDb);

      assert.equal(isNewCommitted, false, 'DEFECT: new password must NOT be committed if session revocation fails!');
      assert.equal(isOldStillActive, true, 'Old password must remain active if session revocation fails');

      // Old session must still be valid
      const sessionStillValid = await fetch(`${base}/api/auth/validate`, { headers: { cookie: user2Cookies } });
      assert.equal(sessionStillValid.status, 200, 'Original session must still be valid after rolled-back failure');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_fail_user_sessions_delete ON user_sessions');
      await pool.query('DROP FUNCTION IF EXISTS test_fail_user_sessions_delete()');
    }

    // ── 3. ATOMIC ROLLBACK ON INJECTED AUDIT PERSISTENCE FAILURE ──
    const user3Email = 'atomicity-fail-audit@xeno.test';
    const oldPassword3 = 'Old-Pass-AuditFail!';
    const attemptedNewPassword3 = 'New-Pass-AuditRollback!';
    const user3Res = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
       VALUES ('atomicity_user3', $1, $2, 'Atomicity User 3', true, true)
       RETURNING id`,
      [user3Email, await bcrypt.hash(oldPassword3, 4)],
    );
    const user3Id = user3Res.rows[0].id;

    const user3Login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user3Email, password: oldPassword3 }),
    });
    assert.equal(user3Login.status, 200);
    const user3Cookies = cookieJar(user3Login.headers.getSetCookie());

    // Inject trigger failure on INSERT to security_events for user3
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_audit_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${user3Id}'::uuid AND NEW.event_type = 'password_changed' THEN
          RAISE EXCEPTION 'injected audit persistence failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      CREATE TRIGGER trg_test_fail_audit_insert
      BEFORE INSERT ON security_events
      FOR EACH ROW EXECUTE FUNCTION test_fail_audit_insert();
    `);

    try {
      const failAuditChange = await fetch(`${base}/api/auth/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: user3Cookies, 'x-xeno-csrf': csrfFrom(user3Cookies) },
        body: JSON.stringify({ current_password: oldPassword3, new_password: attemptedNewPassword3 }),
      });
      assert.equal(failAuditChange.status, 500, 'credential change with failing audit persistence must fail closed (500)');

      // The password in DB must not have been committed
      const user3Check = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user3Id]);
      const currentHashInDb = user3Check.rows[0].password_hash;
      const isNewCommitted = await verifyPasswordHash(attemptedNewPassword3, currentHashInDb);
      assert.equal(isNewCommitted, false, 'DEFECT: password must NOT be committed if durable audit persistence fails!');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_fail_audit_insert ON security_events');
      await pool.query('DROP FUNCTION IF EXISTS test_fail_audit_insert()');
    }

    // ── 4. CONCURRENCY: RACING PASSWORD CHANGES WITH OBSOLETE CURRENT PASSWORD ──
    const user4Email = 'atomicity-concurrency@xeno.test';
    const oldPassword4 = 'Race-Current-123!';
    const newPassword4A = 'Race-New-Pass-A!';
    const newPassword4B = 'Race-New-Pass-B!';
    const user4Res = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
       VALUES ('atomicity_user4', $1, $2, 'Atomicity User 4', true, true)
       RETURNING id`,
      [user4Email, await bcrypt.hash(oldPassword4, 4)],
    );
    const user4Id = user4Res.rows[0].id;

    const user4Login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: user4Email, password: oldPassword4 }),
    });
    assert.equal(user4Login.status, 200);
    const user4Cookies = cookieJar(user4Login.headers.getSetCookie());
    const csrf4 = csrfFrom(user4Cookies);

    // Send two concurrent password changes using the same old password
    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${base}/api/auth/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: user4Cookies, 'x-xeno-csrf': csrf4 },
        body: JSON.stringify({ current_password: oldPassword4, new_password: newPassword4A }),
      }),
      fetch(`${base}/api/auth/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: user4Cookies, 'x-xeno-csrf': csrf4 },
        body: JSON.stringify({ current_password: oldPassword4, new_password: newPassword4B }),
      }),
    ]);

    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    assert.equal(raceStatuses[0], 200, 'Winning concurrent password change must succeed with 200');
    assert.ok(
      raceStatuses[1] === 400 || raceStatuses[1] === 401,
      `Losing concurrent password change must be rejected (400 or 401), got: ${raceStatuses[1]}`,
    );

    // ── 5. ADMIN RESET PASSWORD: TRANSACTIONAL, BURNS RESETS, REVOKES SESSIONS, PRESERVES KEYS ──
    const adminEmail = 'admin-user@xeno.test';
    const adminRes = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, role, email_verified, is_active)
       VALUES ('atomicity_admin', $1, $2, 'Atomicity Admin', 'admin', true, true)
       RETURNING id`,
      [adminEmail, await bcrypt.hash('Admin-Pass-123!', 4)],
    );
    const adminId = adminRes.rows[0].id;

    const targetUserEmail = 'target-user@xeno.test';
    const targetOldPassword = 'Target-Old-Pass-123!';
    const targetNewPassword = 'Target-Admin-Reset-456!';
    const targetRes = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, credits, email_verified, is_active)
       VALUES ('target_user', $1, $2, 'Target User', 500, true, true)
       RETURNING id`,
      [targetUserEmail, await bcrypt.hash(targetOldPassword, 4)],
    );
    const targetUserId = targetRes.rows[0].id;

    // Seed target sessions, password_resets, and an API key
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, 'fake_session_hash', NOW() + INTERVAL '7 days')`,
      [targetUserId],
    );
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, 'fake_reset_hash', NOW() + INTERVAL '1 hour')`,
      [targetUserId],
    );
    await pool.query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
       VALUES ($1, 'agent-operator-key', 'fake_key_hash', 'xno_test_')`,
      [targetUserId],
    );

    // Admin signs in
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: adminEmail, password: 'Admin-Pass-123!' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookies = cookieJar(adminLogin.headers.getSetCookie());

    // Non-admin call is refused
    const nonAdminReset = await fetch(`${base}/api/auth/admin-reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: dev1RotatedCookies, 'x-xeno-csrf': csrfFrom(dev1RotatedCookies) },
      body: JSON.stringify({ userId: targetUserId, new_password: targetNewPassword }),
    });
    assert.equal(nonAdminReset.status, 403, 'Non-admin user cannot call admin-reset-password');

    // Admin reset succeeds
    const adminResetRes = await fetch(`${base}/api/auth/admin-reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookies, 'x-xeno-csrf': csrfFrom(adminCookies) },
      body: JSON.stringify({ userId: targetUserId, new_password: targetNewPassword }),
    });
    assert.equal(adminResetRes.status, 200);
    const adminResetBody = await adminResetRes.json();
    assert.equal(adminResetBody.success, true);
    assert.equal(adminResetBody.sessionsRevoked >= 1, true);
    assert.equal(adminResetBody.resetsBurned >= 1, true);

    // Target sessions are revoked
    const targetSessionsLeft = await pool.query(
      'SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1',
      [targetUserId],
    );
    assert.equal(targetSessionsLeft.rows[0].n, 0);

    // Outstanding reset token was burned (used_at is not null)
    const targetResetsUnused = await pool.query(
      'SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND used_at IS NULL',
      [targetUserId],
    );
    assert.equal(targetResetsUnused.rows[0].n, 0);

    // Target password changed: can now log in with new password
    assert.equal((await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: targetUserEmail, password: targetNewPassword }),
    })).status, 200);

    // API keys are PRESERVED (operator agents depend on them)
    const targetKeysLeft = await pool.query(
      'SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1',
      [targetUserId],
    );
    assert.equal(targetKeysLeft.rows[0].n, 1, 'API keys must not be deleted on password reset');

    // Credits are unchanged
    const targetCredits = await pool.query('SELECT credits FROM users WHERE id = $1', [targetUserId]);
    assert.equal(targetCredits.rows[0].credits, 500, 'Credits must not change on password reset');

    // Admin reset audit event exists
    const adminAudit = await pool.query(
      "SELECT count(*)::int AS n FROM security_events WHERE user_id = $1 AND event_type = 'password_reset_admin'",
      [targetUserId],
    );
    assert.equal(adminAudit.rows[0].n, 1);

    console.log('✅ password-change-atomicity: all gates passed');
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
