/**
 * POST /api/oauth2/revoke answers RFC 7009 truthfully, and never sends a request
 * it cannot honour to the database.
 *
 * Mounts the REAL router, behind the same body parsers index.js mounts globally, on
 * an express app with a recording stub database. No Postgres, and no network beyond
 * loopback.
 *
 * What these gates exist to stop: the previous handler answered 200 {} for EVERY
 * failure, a database outage included. A client that revoked during an outage was
 * told its token was dead while it was still live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import oauth2Routes from '../routes/oauth2Routes.js';

const TOKEN = 'rt_test_only_refresh_token_0001';
const DB_FAILURE = 'password authentication failed for user "xeno_app" at 10.20.30.40:5432';
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const isFamilyLookup = (sql) => sql.startsWith('SELECT family_id');
const isFamilyWrite = (sql) => sql.startsWith('UPDATE oauth_refresh_tokens');
const liveFamily = { rows: [{ family_id: 'fam-1', user_id: 'user-1', sid: 'sid-1' }], rowCount: 1 };
const nothing = { rows: [], rowCount: 0 };

/** Records every call. `answer(sql, params)` decides the result, and may throw. */
function stubDb(answer = () => nothing) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return answer(sql, params);
    },
    async connect() {
      calls.push({ sql: '<connect>', params: [] });
      throw new Error('revocation must not open a transaction');
    },
  };
}

function appFor(db) {
  const app = express();
  // The parsers index.js mounts globally, in the same order, before the OIDC router.
  app.use(express.json({ limit: '100mb', type: ['application/json', 'text/plain'] }));
  app.use(express.urlencoded({ limit: '100mb', extended: true, parameterLimit: 50000 }));
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/oauth2', oauth2Routes);
  return app;
}

async function serve(db, run) {
  const server = appFor(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** POST the endpoint exactly as a client would send it. */
async function revoke(base, { json, form } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = form;
  }
  const response = await fetch(`${base}/api/oauth2/revoke`, { method: 'POST', headers, body });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : undefined };
}

/** Run `fn` with console.error captured, and always restore it. */
async function captureErrors(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test('a live token and an unknown token are both answered 200 {} (RFC 7009 §2.2)', async () => {
  const cases = [
    ['an unknown token', stubDb(() => nothing)],
    ['a live token', stubDb((sql) => (isFamilyLookup(sql) ? liveFamily : nothing))],
  ];
  for (const [name, db] of cases) {
    await serve(db, async (base) => {
      const r = await revoke(base, { form: `token=${encodeURIComponent(TOKEN)}` });
      assert.equal(r.status, 200, `${name}: ${r.text}`);
      assert.deepEqual(r.body, {}, name);
    });
  }
});

test('a non-empty string that is not a live token is answered 200, not refused as malformed', async () => {
  // RFC 7009 §2.2: an invalid token is a 200. Only a request with no usable token
  // value is malformed, so the 400 gate must not swallow junk input.
  const db = stubDb();
  await serve(db, async (base) => {
    const r = await revoke(base, { json: { token: '   ' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, {});
  });
});

test('the database is asked about the token\'s HASH, never the token itself', async () => {
  const db = stubDb((sql) => (isFamilyLookup(sql) ? liveFamily : nothing));
  await serve(db, (base) => revoke(base, { json: { token: TOKEN } }));
  const lookup = db.calls.find((c) => isFamilyLookup(c.sql));
  assert.ok(lookup, 'a live token was never looked up');
  assert.deepEqual(lookup.params, [sha256Hex(TOKEN)]);
  assert.equal(JSON.stringify(db.calls).includes(TOKEN), false, 'the raw token reached the database');
});

test('a live token is revoked by writing its family, not merely answered 200', async () => {
  const db = stubDb((sql) => (isFamilyLookup(sql) ? liveFamily : nothing));
  await serve(db, async (base) => {
    const r = await revoke(base, { json: { token: TOKEN } });
    assert.equal(r.status, 200, r.text);
  });
  const write = db.calls.find((c) => isFamilyWrite(c.sql));
  assert.ok(write, 'a live token was answered 200 but its family was never revoked');
  assert.deepEqual(write.params, ['fam-1'], 'the family write names the wrong family');
});

test('a database failure is answered 503 with no database text, and the cause is logged', async () => {
  const db = stubDb(() => { throw Object.assign(new Error(DB_FAILURE), { code: '28P01' }); });
  let r;
  const logged = await captureErrors(() => serve(db, async (base) => {
    r = await revoke(base, { json: { token: TOKEN } });
  }));
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.error, 'temporarily_unavailable');
  assert.equal(typeof r.body.error_description, 'string');
  for (const leak of ['password', 'xeno_app', '10.20.30.40', '5432', '28P01', TOKEN]) {
    assert.equal(r.text.includes(leak), false, `the 503 body leaked "${leak}"`);
  }
  const line = logged.find((l) => l.includes('[oauth2/revoke]'));
  assert.ok(line, 'the failure was not logged server-side');
  assert.ok(line.includes('28P01'), 'the log lost the SQLSTATE code, the part that is safe to keep');
  assert.equal(line.includes(DB_FAILURE), false, 'the log carried database text (host, role, database)');
  assert.equal(logged.some((l) => l.includes(TOKEN)), false, 'the token value reached the log');
});

test('a failure part-way through the revocation is 503, not 200, because the token may still be live', async () => {
  const db = stubDb((sql) => {
    if (isFamilyLookup(sql)) return liveFamily;
    if (isFamilyWrite(sql)) throw new Error(DB_FAILURE);
    return nothing;
  });
  let r;
  await captureErrors(() => serve(db, async (base) => {
    r = await revoke(base, { json: { token: TOKEN } });
  }));
  assert.equal(r.status, 503, `a half-finished revocation answered ${r.status}: ${r.text}`);
  assert.equal(r.body.error, 'temporarily_unavailable');
});

test('a request without a usable token is refused 400 invalid_request, before any database call', async () => {
  const cases = [
    ['no body at all', {}],
    ['an empty JSON object', { json: {} }],
    ['an empty token', { json: { token: '' } }],
    ['a numeric token', { json: { token: 12345 } }],
    ['a boolean token', { json: { token: true } }],
    ['a null token', { json: { token: null } }],
    ['an object token', { json: { token: { value: TOKEN } } }],
    ['an empty form token', { form: 'token=' }],
    ['a form without a token', { form: 'sid=abc' }],
    ['a repeated token parameter', { form: 'token=a&token=b' }],
    ['an array token in a form', { form: 'token[]=a&token[]=b' }],
  ];
  for (const [name, request] of cases) {
    const db = stubDb(() => liveFamily); // would revoke if it were ever asked
    await serve(db, async (base) => {
      const r = await revoke(base, request);
      assert.equal(r.status, 400, `${name}: ${r.status} ${r.text}`);
      assert.equal(r.body?.error, 'invalid_request', name);
    });
    assert.equal(db.calls.length, 0, `${name} reached the database`);
  }
});
