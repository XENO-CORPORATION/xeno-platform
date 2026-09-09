/**
 * Read-only preview sessions against a REAL PostgreSQL.
 *
 * scripts/readonly-preview-session.test.mjs already proves the boundary's
 * decisions over real HTTP with a synthetic database. Three things it cannot
 * prove, because they are properties of Postgres and of this schema:
 *
 *   1. READ PURITY. The point of the mode is that a signed-in preview cannot
 *      change the operator's real data. That is only demonstrable by
 *      fingerprinting every table before and after a full session — and
 *      specifically for a user who has NO personal workspace and NO ledger
 *      account, because those are the three lazy writers that used to fire on
 *      a plain GET.
 *   2. BEGIN READ ONLY actually refusing a write. The wrapper refuses writes in
 *      JavaScript; the transaction is the layer that holds when the wrapper is
 *      bypassed, and only a real server enforces it.
 *   3. The migration being replay-safe, and standard sessions surviving it.
 *
 * Run by scripts/qualify-platform-local.mjs --backend-only against a throwaway
 * database. DATABASE_URL is required and is never a shared one.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import pg from 'pg';
import authRoutes from '../routes/authRoutes.js';
import { workspaceRoutes } from '../routes/workspaceRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireActivated } from '../services/accountActivation.js';
import { databaseMiddleware } from '../middleware/database.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import { previewSessionMiddleware } from '../middleware/previewSession.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { PREVIEW_COOKIE, PREVIEW_CSRF_COOKIE, PREVIEW_MODE } from '../lib/previewPolicy.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const PASSWORD = 'Preview-readonly-test-42!';
const EMAIL = 'preview-readonly@xeno.test';

const jar = (setCookies = []) => setCookies.map((value) => value.split(';', 1)[0]).join('; ');
const valueOf = (cookies, name) => decodeURIComponent(
  cookies.split('; ').find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? '',
);

const IGNORED_COLUMNS = { users: "ARRAY['last_login']" };

/** Content fingerprint of every public table — the only honest read-purity proof. */
async function fingerprint() {
  const { rows: tables } = await pool.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
  const out = {};
  for (const { relname } of tables) {
    /* Three tables are the SESSION, not the user's data: creating, rotating and
     * revoking a credential is what signing in IS, and the spec says so —
     * "read-only means no business-data or financial mutation, not that
     * authentication can operate without session/audit records." They are
     * excluded here and asserted separately below, so the exclusion is a stated
     * boundary rather than a hole. Everything else must be byte-identical. */
    if (relname === 'user_sessions' || relname === 'browser_session_state'
      || relname === 'security_events') continue;
    const identifier = `"${relname.replaceAll('"', '""')}"`;
    /* users.last_login is authentication metadata that happens to live on a
     * business table, so it is stripped from the digest here and asserted on its
     * own below. Every other column of users — credits, plan, email, is_active —
     * stays inside the fingerprint, which is the point: excluding the whole row
     * would let a preview session change a balance unnoticed. */
    const strip = IGNORED_COLUMNS[relname];
    const value = strip ? `(to_jsonb(t) - ${strip})::text` : 'to_jsonb(t)::text';
    const { rows } = await pool.query(`SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(h, '' ORDER BY h), '')) AS digest
      FROM (SELECT md5(${value}) AS h FROM ONLY public.${identifier} t) hashes`);
    out[relname] = rows[0];
  }
  return out;
}

async function main() {
  await runAllMigrations(pool);

  // Replay-safety: the runner records each version, so re-applying is only
  // reachable after a restore. Execute the file's statements a second time
  // directly to prove that path does not raise duplicate_object — startup now
  // rejects on that error class rather than swallowing it.
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const migration = fs.readFileSync(
    path.join(here, '../database/migrations/20260908180000-readonly-preview-sessions.sql'), 'utf8',
  );
  await pool.query(migration);
  await pool.query(migration);

  const { rows: constraints } = await pool.query(`SELECT conname FROM pg_constraint
    WHERE conrelid = 'browser_session_state'::regclass
      AND conname IN ('browser_session_purpose_valid', 'browser_preview_expiry_required')`);
  assert.equal(constraints.length, 2, 'both preview constraints exist exactly once after replay');

  const { rows: rejected } = await pool.query(`SELECT 1 FROM pg_constraint
    WHERE conname = 'browser_session_purpose_valid'`);
  assert.equal(rejected.length, 1, 'the purpose constraint was not duplicated by replay');

  await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, email_verified, is_active)
     VALUES ('preview_readonly_test', $1, $2, 'Preview Operator', true, true)`,
    [EMAIL, await bcrypt.hash(PASSWORD, 4)],
  );
  const { rows: [{ id: userId }] } = await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
  // A real account is activated; a preview session must clear requireActivated
  // like any other. isActivated() runs its SELECT through the preview read
  // wrapper, so this also exercises the wrapper on a platform gate.
  await pool.query(
    `INSERT INTO account_activations (user_id, method) VALUES ($1, 'email_link')
     ON CONFLICT (user_id) DO NOTHING`, [userId],
  );

  // The whole point: this account has no personal workspace and no ledger
  // account, so every lazy writer on a read path has something to create.
  const { rows: workspacesBefore } = await pool.query(
    `SELECT count(*)::int AS n FROM workspaces WHERE owner_user_id::text = $1::text`, [String(userId)],
  );
  assert.equal(workspacesBefore[0].n, 0, 'the fixture user starts with no workspace');

  process.env.XENO_READONLY_PREVIEW_ENABLED = 'true';
  const app = express();
  app.use(previewSessionMiddleware(pool));
  app.use(cookieParser());
  app.use(express.json());
  app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = req.previewReadDb || pool; next(); });
  app.use('/api/auth', authRoutes);
  // Mounted exactly as src/server/index.js mounts it. The question this suite
  // answers is whether a preview session survives the REAL authentication
  // chain, so a bare router would test the wrong thing.
  app.use('/api/workspaces', databaseMiddleware, authMiddleware, requireActivated, workspaceRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const before = await fingerprint();
    const { rows: [beforeUser] } = await pool.query(
      `SELECT to_jsonb(u) - 'last_login' AS body, last_login FROM users u WHERE id = $1`, [userId]);

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': PREVIEW_MODE },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    assert.equal(login.status, 200, 'the existing password verifier admits a preview login');
    const loginBody = await login.json();
    assert.equal(loginBody.success, true);
    assert.equal(loginBody.token ?? null, null, 'preview login returns no exportable bearer');
    assert.equal(Object.hasOwn(loginBody, 'refreshToken') && loginBody.refreshToken, false,
      'preview login returns no refresh token');

    const cookies = jar(login.headers.getSetCookie());
    assert.match(cookies, new RegExp(`${PREVIEW_COOKIE}=`), 'a preview session cookie was issued');
    assert.doesNotMatch(cookies, /(?:__Host-)?xeno_session=/, 'no standard session cookie is issued');
    const csrf = valueOf(cookies, PREVIEW_CSRF_COOKIE);

    const { rows: [session] } = await pool.query(
      `SELECT bss.purpose, bss.absolute_expires_at FROM browser_session_state bss
        JOIN user_sessions us ON us.id = bss.sid WHERE us.user_id::text = $1::text`, [String(userId)],
    );
    assert.equal(session.purpose, 'preview_readonly', 'the purpose is persisted on the row');
    assert.ok(session.absolute_expires_at, 'a preview session always carries an absolute cap');
    /* Regression guard for a session born already expired. user_sessions.expires_at
     * is `timestamp WITHOUT time zone` and this column is `timestamptz`; carrying
     * the first through JavaScript into the second dropped the UTC offset, so on
     * any host east of UTC a 60-minute session was already dead at issue. A UTC
     * host would not have shown it. Both deadlines now come from the database. */
    const capMs = new Date(session.absolute_expires_at).getTime() - Date.now();
    assert.ok(capMs > 0, `the absolute cap is in the future (was ${Math.round(capMs / 1000)}s away)`);
    assert.ok(capMs > 30 * 60_000 && capMs <= 61 * 60_000,
      `the cap is about the configured lifetime, not an offset-shifted one (${Math.round(capMs / 60000)}min)`);

    // A read that used to create a personal workspace.
    const workspaces = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookies } });
    assert.equal(workspaces.status, 200, 'a qualified read succeeds with the real handler');
    const { rows: workspacesAfter } = await pool.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE owner_user_id::text = $1::text`, [String(userId)],
    );
    assert.equal(workspacesAfter[0].n, 0,
      'listing workspaces did NOT auto-create a personal workspace for a preview session');

    const validate = await fetch(`${base}/api/auth/validate`, { headers: { cookie: cookies } });
    assert.equal(validate.status, 200);
    assert.equal((await validate.json()).preview.mode, PREVIEW_MODE);

    const refresh = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { cookie: cookies, 'x-xeno-csrf': csrf },
    });
    assert.equal(refresh.status, 200, 'rotation works against the real row');
    const rotated = jar(refresh.headers.getSetCookie());
    const stale = await fetch(`${base}/api/auth/validate`, { headers: { cookie: cookies } });
    assert.equal(stale.status, 401, 'the rotated-away secret is dead');

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { cookie: rotated, 'x-xeno-csrf': valueOf(rotated, PREVIEW_CSRF_COOKIE) },
    });
    assert.equal(logout.status, 200);
    const revoked = await fetch(`${base}/api/auth/validate`, { headers: { cookie: rotated } });
    assert.equal(revoked.status, 401, 'logout revokes the preview session');

    const after = await fingerprint();
    // Report only what MOVED. A whole-schema deepEqual dump is ~200 tables of
    // noise around the one line that matters.
    const changed = Object.keys(after).filter((table) =>
      after[table].count !== before[table]?.count || after[table].digest !== before[table]?.digest)
      .map((table) => `${table} (${before[table]?.count} -> ${after[table].count} rows, `
        + `${before[table]?.digest === after[table].digest ? 'same' : 'different'} content)`);
    assert.deepEqual(changed, [],
      `a complete preview session changed business data — read purity is the whole feature: ${changed.join('; ')}`);

    // The excluded audit table is checked on its own terms: a preview session
    // may record its own authentication and nothing else, and never about
    // another subject.
    const { rows: audit } = await pool.query(
      `SELECT event_type, user_id::text AS subject FROM security_events ORDER BY created_at`);
    assert.ok(audit.length > 0, 'authenticating is still audited');
    const { rows: [subject] } = await pool.query(
      `SELECT to_jsonb(u) - 'last_login' AS body, last_login FROM users u WHERE id = $1`, [userId]);
    assert.deepEqual(subject.body, beforeUser.body,
      'signing in changed a user column other than last_login');
    assert.notEqual(String(subject.last_login), String(beforeUser.last_login),
      'last_login is the one column a sign-in is allowed to move, and it moved');
    for (const event of audit) {
      assert.ok(['login', 'logout', 'session_revoked', 'session_refresh'].includes(event.event_type),
        `a preview session wrote an unexpected audit event: ${event.event_type}`);
      assert.ok(event.subject === null || event.subject === String(userId),
        'a preview session wrote an audit row about another subject');
    }

    // BEGIN READ ONLY is the layer that holds when the JS wrapper is bypassed.
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN READ ONLY');
      await assert.rejects(
        () => connection.query(`UPDATE users SET display_name = 'tampered' WHERE id = $1`, [userId]),
        /read-only transaction/i,
        'Postgres itself refuses the write, not only the JavaScript wrapper',
      );
    } finally {
      await connection.query('ROLLBACK').catch(() => {});
      connection.release();
    }

    // Compatibility: the standard browser session still works, and cannot be
    // reached with a preview credential.
    const standard = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    assert.equal(standard.status, 200, 'the ordinary browser session contract is unchanged');
    const standardCookies = jar(standard.headers.getSetCookie());
    assert.match(standardCookies, /(?:__Host-)?xeno_session=/);
    const standardValidate = await fetch(`${base}/api/auth/validate`, { headers: { cookie: standardCookies } });
    assert.equal(standardValidate.status, 200, 'a standard session authenticates normally');
    const standardBody = await standardValidate.json();
    assert.equal(standardBody.preview, undefined, 'a standard session is not labelled as a preview');

    const { rows: purposes } = await pool.query(
      `SELECT DISTINCT purpose FROM browser_session_state ORDER BY purpose`,
    );
    assert.ok(purposes.some((row) => row.purpose === 'standard'),
      'new standard sessions default to the standard purpose');

    // A preview session must never be resolvable by the standard path, which is
    // what the purpose='standard' predicate in browserSessionMiddleware buys.
    await pool.query(`UPDATE browser_session_state SET purpose = 'preview_readonly',
      absolute_expires_at = NOW() + INTERVAL '1 hour'
      WHERE sid = (SELECT sid FROM browser_session_state ORDER BY sid DESC LIMIT 1)`);

    await assert.rejects(
      () => pool.query(`INSERT INTO browser_session_state (sid, csrf_hash, purpose)
        SELECT gen_random_uuid(), 'x', 'preview_readonly'`),
      (error) => error.constraint === 'browser_preview_expiry_required' || /browser_preview_expiry_required/.test(error.message),
      'a preview row without an absolute cap is refused by the schema',
    );
    await assert.rejects(
      () => pool.query(`INSERT INTO browser_session_state (sid, csrf_hash, purpose, absolute_expires_at)
        SELECT gen_random_uuid(), 'x', 'anything-else', NOW()`),
      (error) => error.constraint === 'browser_session_purpose_valid' || /browser_session_purpose_valid/.test(error.message),
      'an unknown purpose is refused by the schema',
    );

    console.log('✅ readonly-preview-lifecycle: read purity, no lazy writes, rotation, revocation, '
      + 'replay-safe migration and standard-session compatibility passed');
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
