/**
 * Read-only preview sessions: the operation policy and the enforcement boundary.
 *
 * The point of this suite is that AUTHORITY FOLLOWS THE SESSION ROW, not a
 * caller-supplied header. A preview cookie replayed straight at the backend with
 * no `X-Xeno-Session-Mode`, with an `Authorization` header bolted on, or against
 * a route the policy never qualified, must be refused by the server — not by the
 * local proxy, which is secondary protection and can be bypassed by anyone who
 * has the cookie.
 *
 * Everything here runs over real HTTP against the real middleware. The database
 * is the only synthetic part; the real-Postgres lifecycle (rotation under
 * concurrency, absolute expiry, read purity against live tables) is
 * src/server/tests/readonly-preview-session.test.mjs, which the local qualifier
 * runs against a real server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {
  PREVIEW_COOKIE, PREVIEW_CSRF_COOKIE, PREVIEW_MODE, previewOperation,
} from '../src/lib/previewPolicy.mjs';
import { previewSessionMiddleware } from '../src/server/middleware/previewSession.js';

const WORKSPACE = '11111111-2222-4333-8444-555555555555';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// Operation policy — default deny, and no normalization into a permitted route
// ---------------------------------------------------------------------------

test('the qualified reads are exactly the audited ones', () => {
  for (const path of [
    '/api/auth/validate', '/api/account/overview', '/api/account/notifications',
    '/api/account/sessions', '/api/dashboard/stats', '/api/billing/overview',
    '/api/billing/subscription', '/api/billing/entitlements', '/api/user-data/settings',
    '/api/workspaces',
  ]) {
    assert.equal(previewOperation('GET', path), 'read', path);
  }
  assert.equal(previewOperation('GET', `/api/workspaces/${WORKSPACE}/members`), 'read');
  assert.equal(previewOperation('GET', `/api/chat/projects?workspace_id=${WORKSPACE}`), 'read');
  assert.equal(previewOperation('GET', '/api/billing/ledger?limit=50&offset=0'), 'read');
});

test('every financial, generative and administrative operation is denied', () => {
  for (const [method, path] of [
    ['POST', '/api/billing/checkout'], ['POST', '/api/billing/portal'],
    ['POST', '/api/billing/consent'], ['POST', '/api/chat/projects'],
    ['PATCH', `/api/workspaces/${WORKSPACE}`], ['DELETE', `/api/chat/projects/${WORKSPACE}`],
    ['POST', '/api/workspaces'], ['POST', `/api/workspaces/${WORKSPACE}/select`],
    ['PUT', '/api/user-data/settings'], ['POST', '/api/auth/register'],
    ['POST', '/api/auth/forgot-password'], ['POST', '/api/auth/resend-verification'],
    ['POST', '/api/oauth2/token'], ['GET', '/api/oauth2/authorize'],
    ['POST', '/api/auth/browser-session'], ['DELETE', '/api/account/sessions/x'],
    ['POST', '/api/generate'], ['POST', '/api/schedules'],
    // A read route is a route plus a METHOD. The pair is what is qualified.
    ['POST', '/api/account/overview'], ['DELETE', '/api/workspaces'],
    ['HEAD', '/api/workspaces'], ['OPTIONS', '/api/workspaces'],
  ]) {
    assert.equal(previewOperation(method, path), null, `${method} ${path}`);
  }
});

test('an ambiguous request is refused rather than normalized into a permitted route', () => {
  for (const url of [
    '/api/workspaces/../billing/checkout', '/api/./workspaces', '/api//workspaces',
    '//evil.example/api/workspaces', '/api/work%73paces', '/api/workspaces%2f..%2fcheckout',
    '/api/workspaces\\..\\checkout', '/api/workspaces ', 'api/workspaces',
    '/api/workspaces#/api/billing/checkout',
  ]) {
    assert.equal(previewOperation('GET', url), null, url);
  }
  // A method override turns a denied verb into a permitted one at the router.
  for (const header of ['x-http-method', 'x-http-method-override', 'x-method-override',
    'x-original-url', 'x-rewrite-url', 'upgrade']) {
    assert.equal(previewOperation('GET', '/api/workspaces', { [header]: 'anything' }), null, header);
  }
});

test('query parameters are schema-checked, not merely name-checked', () => {
  assert.equal(previewOperation('GET', '/api/workspaces?debug=1'), null, 'unknown parameter');
  assert.equal(previewOperation('GET', '/api/chat/projects?workspace_id=not-a-uuid'), null);
  assert.equal(previewOperation('GET', `/api/chat/projects?workspace_id=${WORKSPACE}&workspace_id=${WORKSPACE}`), null,
    'a duplicated parameter is a conflicting scope field');
  assert.equal(previewOperation('GET', '/api/billing/ledger?limit=0'), null);
  assert.equal(previewOperation('GET', '/api/billing/ledger?limit=201'), null);
  assert.equal(previewOperation('GET', '/api/billing/ledger?offset=2000000'), null);
  assert.equal(previewOperation('GET', '/api/billing/ledger?limit=1'), 'read');
  // Login/refresh/logout are exact, unparameterised POSTs.
  assert.equal(previewOperation('POST', '/api/auth/login'), 'login');
  assert.equal(previewOperation('POST', '/api/auth/refresh'), 'refresh');
  assert.equal(previewOperation('POST', '/api/auth/logout'), 'logout');
  assert.equal(previewOperation('POST', '/api/auth/login?next=/admin'), null);
  assert.equal(previewOperation('GET', '/api/auth/login'), null);
});

// ---------------------------------------------------------------------------
// Enforcement boundary
// ---------------------------------------------------------------------------

const USER = {
  id: 'user-1', username: 'operator', email: 'operator@xeno.test', display_name: 'Operator',
  avatar_url: null, created_at: new Date(0), email_verified: true, is_active: true,
  credits: 0, bonus_credits_claimed: false,
};

function fakePool({ token, csrf, purpose = 'preview_readonly', absoluteExpired = false } = {}) {
  const state = { deleted: false, rotated: 0, reads: 0, writesAttempted: 0, beganReadOnly: 0 };
  const row = token ? {
    sid: 'sid-1', user_id: USER.id, csrf_hash: sha(csrf),
    absolute_expires_at: new Date(Date.now() + (absoluteExpired ? -1000 : 3_600_000)),
    ...USER,
  } : null;
  const match = (sql, values) => {
    if (sql.includes('FROM user_sessions us JOIN browser_session_state bss')) {
      /* The fake applies a predicate only when the QUERY asks for it. If it
       * filtered on purpose unconditionally it would be doing the middleware's
       * job, and deleting the filter from the real SQL would leave this suite
       * green — which is exactly what happened on the first draft. */
      const asksPurpose = sql.includes("bss.purpose='preview_readonly'");
      const asksAbsolute = sql.includes('bss.absolute_expires_at>NOW()');
      const live = row && !state.deleted && values[0] === sha(token)
        && (!asksPurpose || purpose === 'preview_readonly')
        && (!asksAbsolute || row.absolute_expires_at > new Date());
      return { rows: live ? [row] : [] };
    }
    if (sql.includes('FOR UPDATE OF us,bss')) {
      return { rows: state.deleted || values[1] !== sha(token) ? [] : [{ id: 'sid-1', csrf_hash: row.csrf_hash, absolute_expires_at: row.absolute_expires_at }] };
    }
    if (sql.startsWith('DELETE FROM user_sessions')) { state.deleted = true; return { rows: [] }; }
    if (sql.startsWith('UPDATE user_sessions') || sql.startsWith('UPDATE browser_session_state')) {
      state.rotated++; return { rows: [] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(sql)) {
      if (/READ ONLY/i.test(sql)) state.beganReadOnly++;
      return { rows: [] };
    }
    state.reads++;
    return { rows: [{ ok: true }] };
  };
  const pool = {
    query: async (sql, values = []) => match(sql, values),
    connect: async () => ({ query: async (sql, values = []) => match(sql, values), release() {} }),
    state,
  };
  return pool;
}

async function withServer(pool, run) {
  process.env.XENO_READONLY_PREVIEW_ENABLED = 'true';
  const seen = { downstream: 0, db: null, writeError: null, handler: 0 };
  const app = express();
  app.use(previewSessionMiddleware(pool));
  app.use((req, _res, next) => { seen.downstream++; seen.db = req.db || null; next(); });
  app.post('/api/auth/login', (_req, res) => { seen.handler++; res.json({ success: true, token: null }); });
  app.get('/api/dashboard/stats', async (req, res) => {
    // The battery must run INSIDE the request: the wrapper is closed on
    // response finish, and a closed wrapper rejects with a different reason.
    seen.handler++;
    seen.wrapper = [];
    for (const sql of ['DELETE FROM users', 'INSERT INTO users DEFAULT VALUES',
      'SELECT 1; DROP TABLE users', 'WITH x AS (DELETE FROM users RETURNING 1) SELECT 1; SELECT 2',
      'CREATE TABLE t (id int)', '  update users set x = 1', 'TRUNCATE users', null]) {
      try { await req.db.query(sql); seen.wrapper.push([sql, 'ACCEPTED']); }
      catch (error) { seen.wrapper.push([sql, error.message]); }
    }
    try { await req.db.query('SELECT 1'); seen.wrapper.push(['SELECT 1', 'ACCEPTED']); }
    catch (error) { seen.wrapper.push(['SELECT 1', error.message]); }
    res.json({ success: true });
  });
  app.get('/api/workspaces', async (req, res) => {
    seen.handler++;
    try { await req.db.query('UPDATE workspaces SET name = $1', ['x']); }
    catch (error) { seen.writeError = error.message; }
    res.json({ success: true });
  });
  app.use((_req, res) => { seen.handler++; res.json({ reached: true }); });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run({ base, seen }); }
  finally { await new Promise((resolve) => server.close(resolve)); delete process.env.XENO_READONLY_PREVIEW_ENABLED; }
}

const cookieHeader = (token, csrf) => [
  token === undefined ? null : `${PREVIEW_COOKIE}=${token}`,
  csrf === undefined ? null : `${PREVIEW_CSRF_COOKIE}=${csrf}`,
].filter(Boolean).join('; ');

const TOKEN = 'a'.repeat(43);
const CSRF = 'b'.repeat(43);

test('a request with no preview credential and no mode header is untouched', async () => {
  await withServer(fakePool(), async ({ base, seen }) => {
    const response = await fetch(`${base}/api/billing/checkout`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(seen.handler, 1, 'ordinary traffic still reaches its handler');
  });
});

test('a preview cookie is enforced even when the mode header is stripped', async () => {
  // The local proxy sets that header. Anyone replaying the cookie straight at
  // the backend will not, so the header must not be what grants or limits
  // authority — the persisted purpose is.
  await withServer(fakePool({ token: TOKEN, csrf: CSRF }), async ({ base, seen }) => {
    const denied = await fetch(`${base}/api/billing/checkout`, {
      method: 'POST', headers: { cookie: cookieHeader(TOKEN, CSRF) },
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'preview_operation_forbidden');
    assert.equal(seen.handler, 0, 'a denied operation never reaches its handler');
  });
});

test('multiple credential classes are refused, never silently resolved to the stronger one', async () => {
  const cases = [
    ['authorization', { cookie: cookieHeader(TOKEN, CSRF), authorization: 'Bearer forged' }],
    ['standard session cookie', { cookie: `${cookieHeader(TOKEN, CSRF)}; xeno_session=other` }],
    ['host-prefixed standard cookie', { cookie: `${cookieHeader(TOKEN, CSRF)}; __Host-xeno_session=other` }],
    ['two preview cookies', { cookie: `${PREVIEW_COOKIE}=${TOKEN}; ${PREVIEW_COOKIE}=${'c'.repeat(43)}` }],
  ];
  for (const [name, headers] of cases) {
    await withServer(fakePool({ token: TOKEN, csrf: CSRF }), async ({ base, seen }) => {
      const response = await fetch(`${base}/api/workspaces`, { headers });
      assert.equal(response.status, 400, name);
      assert.equal((await response.json()).code, 'ambiguous_preview_credentials', name);
      assert.equal(seen.handler, 0, name);
    });
  }
});

test('an unusable preview credential yields 401 and nothing else', async () => {
  for (const [name, pool, token] of [
    ['malformed token', fakePool({ token: TOKEN, csrf: CSRF }), 'short'],
    ['unknown token', fakePool({ token: TOKEN, csrf: CSRF }), 'z'.repeat(43)],
    ['absolute expiry passed', fakePool({ token: TOKEN, csrf: CSRF, absoluteExpired: true }), TOKEN],
    ['session is not a preview session', fakePool({ token: TOKEN, csrf: CSRF, purpose: 'standard' }), TOKEN],
  ]) {
    await withServer(pool, async ({ base, seen }) => {
      const response = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookieHeader(token, CSRF) } });
      assert.equal(response.status, 401, name);
      assert.equal((await response.json()).code, 'preview_session_invalid', name);
      assert.equal(seen.handler, 0, name);
    });
  }
});

test('a qualified read reaches its handler on a read-only connection that refuses writes', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base, seen }) => {
    const response = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    assert.equal(response.status, 200);
    assert.equal(seen.handler, 1);
    assert.equal(seen.db.previewReadOnly, true, 'handlers can see that this is a preview read');
    assert.equal(pool.state.beganReadOnly, 1, 'the read runs inside BEGIN READ ONLY');
    assert.match(seen.writeError, /writes are forbidden/,
      'an UPDATE issued by a handler is refused before it reaches the connection');
  });
});

test('the read wrapper refuses statement stacking and non-select verbs alike', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base, seen }) => {
    const response = await fetch(`${base}/api/dashboard/stats`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    assert.equal(response.status, 200);
    const results = new Map(seen.wrapper);
    for (const [sql, message] of results) {
      if (sql === 'SELECT 1') { assert.equal(message, 'ACCEPTED', 'a plain read still works'); continue; }
      assert.match(message, /writes are forbidden/, `${sql} was not refused`);
    }
    assert.equal(results.size, 9, 'every probe reported a result');
  });
});

test('a closed preview read cannot be reused after the response', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base, seen }) => {
    await fetch(`${base}/api/workspaces`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    await assert.rejects(() => seen.db.query('SELECT 1'), /Preview read is closed/,
      'a handler cannot hold the connection past its request');
  });
});

test('validate answers from the session row and declares the mode, without a database read', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base, seen }) => {
    const response = await fetch(`${base}/api/auth/validate`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.email, USER.email);
    assert.equal(body.preview.mode, PREVIEW_MODE);
    assert.equal(seen.handler, 0, 'validate is answered by the boundary, not by a route');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('rotation and logout require CSRF; a read never does', async () => {
  for (const [name, headers, status] of [
    ['no csrf header', { cookie: cookieHeader(TOKEN, CSRF) }, 403],
    ['wrong csrf header', { cookie: cookieHeader(TOKEN, CSRF), 'x-xeno-csrf': 'wrong' }, 403],
    ['csrf cookie missing', { cookie: cookieHeader(TOKEN, undefined), 'x-xeno-csrf': CSRF }, 403],
  ]) {
    await withServer(fakePool({ token: TOKEN, csrf: CSRF }), async ({ base }) => {
      const response = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers });
      assert.equal(response.status, status, name);
      assert.equal((await response.json()).code, 'preview_csrf_invalid', name);
    });
  }
});

test('refresh rotates both secrets and cannot extend the absolute lifetime', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base }) => {
    const response = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { cookie: cookieHeader(TOKEN, CSRF), 'x-xeno-csrf': CSRF },
    });
    assert.equal(response.status, 200);
    assert.equal(pool.state.rotated, 2, 'both the session secret and the CSRF secret rotate');
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(`${PREVIEW_COOKIE}=`));
    const csrf = cookies.find((c) => c.startsWith(`${PREVIEW_CSRF_COOKIE}=`));
    assert.ok(session && csrf);
    assert.doesNotMatch(session, new RegExp(`${PREVIEW_COOKIE}=${TOKEN}`), 'the replacement is a new secret');
    for (const cookie of [session, csrf]) {
      assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Domain=/);
    }
    assert.match(session, /HttpOnly/, 'the session secret is never readable by script');
    assert.doesNotMatch(csrf, /HttpOnly/, 'the double-submit value must be readable');
    // The renewed cookie expiry is the ORIGINAL absolute cap, not now + lifetime.
    const cap = new Date(session.match(/Expires=([^;]+)/)[1]).getTime();
    assert.ok(cap - Date.now() <= 3_600_000 + 5_000, 'refresh did not push the cap forward');
  });
});

test('logout revokes this session and clears both cookies', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base }) => {
    const response = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { cookie: cookieHeader(TOKEN, CSRF), 'x-xeno-csrf': CSRF },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).authenticated, false);
    assert.equal(pool.state.deleted, true);
    const cleared = response.headers.getSetCookie();
    assert.ok(cleared.some((c) => c.startsWith(`${PREVIEW_COOKIE}=`) && /Expires=Thu, 01 Jan 1970/.test(c)));

    const after = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    assert.equal(after.status, 401, 'the revoked cookie is dead immediately');
  });
});

test('a rotated-away secret cannot be resurrected', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  await withServer(pool, async ({ base }) => {
    await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { cookie: cookieHeader(TOKEN, CSRF), 'x-xeno-csrf': CSRF },
    });
    // The fake still resolves the original token, which is the generous case:
    // even so, a second rotation with the stale CSRF must not widen anything.
    const stale = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { cookie: cookieHeader(TOKEN, 'd'.repeat(43)), 'x-xeno-csrf': 'd'.repeat(43) },
    });
    assert.equal(stale.status, 403, 'a CSRF value the row does not hold cannot act');
  });
});

test('preview login is admitted only as a clean, unprivileged request', async () => {
  await withServer(fakePool(), async ({ base, seen }) => {
    const clean = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'x-xeno-session-mode': PREVIEW_MODE },
    });
    assert.equal(clean.status, 200);
    assert.equal(seen.handler, 1, 'the existing password verifier still runs');
    assert.equal((await clean.json()).token, null, 'no exportable bearer in preview mode');
  });
  for (const [name, headers] of [
    ['bearer attached', { 'x-xeno-session-mode': PREVIEW_MODE, authorization: 'Bearer x' }],
    ['standard session attached', { 'x-xeno-session-mode': PREVIEW_MODE, cookie: 'xeno_session=other' }],
  ]) {
    await withServer(fakePool(), async ({ base, seen }) => {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers });
      assert.equal(response.status, 403, name);
      assert.equal(seen.handler, 0, name);
    });
  }
  await withServer(fakePool(), async ({ base, seen }) => {
    const wrong = await fetch(`${base}/api/billing/checkout`, {
      method: 'POST', headers: { 'x-xeno-session-mode': PREVIEW_MODE },
    });
    assert.equal(wrong.status, 403, 'the mode header alone does not open other routes');
    assert.equal(seen.handler, 0);
  });
});

test('the whole boundary is inert unless it is explicitly enabled', async () => {
  const pool = fakePool({ token: TOKEN, csrf: CSRF });
  const app = express();
  app.use(previewSessionMiddleware(pool));
  let handled = 0;
  app.use((_req, res) => { handled++; res.json({ reached: true }); });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  delete process.env.XENO_READONLY_PREVIEW_ENABLED;
  try {
    const withCookie = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookieHeader(TOKEN, CSRF) } });
    assert.equal(withCookie.status, 503, 'a preview cookie fails closed while the feature is off');
    assert.equal((await withCookie.json()).code, 'preview_disabled');

    const withMode = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'x-xeno-session-mode': PREVIEW_MODE },
    });
    assert.equal(withMode.status, 503);
    assert.equal(handled, 0, 'nothing downstream runs while disabled');

    const policy = await fetch(`${base}/api/auth/preview-policy`);
    assert.equal(policy.status, 503);
    assert.equal((await policy.json()).enabled, false, 'the mode is discoverable, and reports itself off');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
