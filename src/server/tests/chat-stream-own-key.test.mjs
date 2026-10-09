/**
 * Streaming chat on the account's OWN KEY — the real route, a real database, a stand-in gateway.
 *
 * WHY: POST /api/ai/chat/stream answered 501 for every model routed to the account's own key
 * ("Streaming currently supports the premium path only"), and the chat client streams every turn.
 * So an account whose default route is its own key could not chat at all (owner's report,
 * 2026-10-09). Nothing ran that case: the non-streaming route had it, and the gates around this
 * route read its source.
 *
 * This mounts the real router and drives it over HTTP. The gateway is a loopback server that
 * answers the way the XENO API does (OpenAI SSE) and records what it was sent.
 *
 *   - an own-key turn streams, with the events the client reads
 *   - the gateway receives a grant (never the account's key), the surface, and stream:true
 *   - nothing is charged, and the turn is still recorded as usage at cost 0
 *   - a premium turn is untouched: no grant is sent, and it is metered
 *   - in-house answers what the non-streaming route answers, not a 501
 *   - a route that names a key which is gone fails closed (never falls back to premium)
 *
 * Run: DATABASE_URL=... SECRET_BOX_KEY=... BYOK_ENABLED=true node tests/chat-stream-own-key.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import express from 'express';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
process.env.SECRET_BOX_KEY ||= Buffer.alloc(32, 7).toString('base64');   // a 32-byte key for this run only
process.env.BYOK_ENABLED = 'true';
process.env.JWT_SECRET ||= 'chat-stream-own-key-test-secret-0123456789abcdef';

// ── the stand-in gateway: must be listening BEFORE the route's modules read XENO_API_BASE_URL ──
const seen = [];
let failNext = null;
const gateway = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  seen.push({ url: req.url, auth: req.headers.authorization, grant: req.headers['x-xeno-byok-grant'] || null, surface: req.headers['x-xeno-surface'] || null, stream: body.stream, model: body.model, messages: body.messages });
  if (failNext) { const f = failNext; failNext = null; res.writeHead(f.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify(f.body)); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const text of ['Hel', 'lo ', 'there']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
process.env.XENO_API_BASE_URL = `http://127.0.0.1:${gateway.address().port}/v1`;
process.env.XENO_API_KEY = 'platform-service-key-for-this-test';

const { runAllMigrations } = await import('../services/migrationRunner.js');
const { setRoute, setCredentialModels, fingerprint, revokeCredential } = await import('../services/providerCredentials.js');
const { encrypt } = await import('../utils/secretBox.js');
const aiRoutes = (await import('../routes/aiRoutes.js')).default;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const OWN_KEY = `sk-own-key-${'z'.repeat(40)}`;

async function person(tag) {
  const { rows } = await pool.query(`INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active) VALUES ($1,$2,$3,'x', true, true) RETURNING id`, [`${tag}@xeno.test`, tag, tag]);
  return rows[0].id;
}
async function storeKey(userId) {
  const { rows } = await pool.query(`INSERT INTO user_provider_credentials (user_id, provider, label, secret_encrypted, key_fingerprint, key_last4, status, verified_at) VALUES ($1,'compatible','Mine',$2,$3,$4,'active',NOW()) RETURNING id`, [userId, encrypt(OWN_KEY), fingerprint(OWN_KEY), OWN_KEY.slice(-4)]);
  return rows[0].id;
}

let current = null;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: current }; req.db = pool; next(); });
app.use('/api/ai', aiRoutes);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

/** POST the stream route; returns the status and, for a stream, the parsed events. */
async function turn(userId, body) {
  current = userId;
  const res = await fetch(`${base}/api/ai/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-xeno-surface': 'xeno-web' }, body: JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) return { status: res.status, json: await res.json().catch(() => null), events: [] };
  const text = await res.text();
  const events = text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data: '))).filter(Boolean).map((l) => l.slice(6)).filter((d) => d !== '[DONE]').map((d) => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
  return { status: res.status, events, done: text.includes('data: [DONE]') };
}
const credits = async (userId) => (await pool.query('SELECT count(*)::int AS n FROM credit_transactions WHERE user_id = $1', [userId])).rows[0].n;
const usage = async (userId) => (await pool.query(`SELECT model, endpoint, input_tokens, output_tokens, actual_cost_micro FROM api_usage_logs WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
const say = (m) => console.log('  ✓ ' + m);

try {
  await runAllMigrations(pool);
  { const accountV2 = await import('../database/migrate-account-v2.js'); await (accountV2.migrateAccountV2 || accountV2.default)(pool); }   // the ledger the premium path meters on

  // ── an account whose default route is its own key ──
  const ada = await person('ada_stream');
  const key = await storeKey(ada);
  await setRoute(pool, ada, '*', { path: 'byok', mode: 'managed', credentialId: key });
  await setCredentialModels(pool, ada, key, ['deepseek-chat']);

  seen.length = 0;
  const own = await turn(ada, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(own.status, 200, `an own-key turn streams (got ${own.status} ${JSON.stringify(own.json)})`);
  assert.equal(own.events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hello there');
  assert.ok(own.done && own.events.some((e) => e.type === 'done'), 'the stream ends the way the client expects');
  assert.ok(!own.events.some((e) => e.type === 'error'), 'with no error event');
  say('a model on the account’s own key streams its answer');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].stream, true);
  assert.match(String(seen[0].grant), /.{20,}/, 'the gateway is sent a grant');
  assert.equal(seen[0].surface, 'xeno-web');
  assert.equal(seen[0].auth, 'Bearer platform-service-key-for-this-test', 'the platform’s own service key, never replaced by a per-call header');
  assert.ok(!JSON.stringify(seen[0]).includes(OWN_KEY), 'the account’s key itself is never sent by the platform');
  say('the gateway gets a single-use grant and the surface, never the key');

  const usageEvent = own.events.find((e) => e.type === 'usage');
  assert.equal(usageEvent.creditsSettled, 0);
  assert.deepEqual([usageEvent.input, usageEvent.output], [11, 3]);
  assert.equal(await credits(ada), 0, 'no credit transaction for an own-key turn');
  const rows = await usage(ada);
  assert.equal(rows.length, 1); assert.equal(rows[0].endpoint, '/api/ai/chat/stream'); assert.equal(rows[0].model, 'deepseek-chat');
  assert.deepEqual([Number(rows[0].input_tokens), Number(rows[0].output_tokens), Number(rows[0].actual_cost_micro)], [11, 3, 0]);
  say('nothing is charged, and the turn is recorded as usage at cost 0');

  // a second turn mints a NEW grant (a grant is single-use)
  await turn(ada, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'again' }] });
  assert.equal(seen.length, 2); assert.notEqual(seen[1].grant, seen[0].grant);
  say('every call mints its own grant');

  // ── the provider refuses the key: the turn says so, and still charges nothing ──
  failNext = { status: 401, body: { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } } };
  const refused = await turn(ada, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] });
  assert.ok(refused.status !== 200 || refused.events.some((e) => e.type === 'error'), 'a refused key is an error, not an empty answer');
  assert.equal(await credits(ada), 0);
  say('a key the provider refuses is reported, and nothing is charged');

  // ── the key is revoked: the route fails closed, and never falls back to premium ──
  await revokeCredential(pool, ada, key);
  const before = seen.length;
  const gone = await turn(ada, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] });
  assert.ok(gone.status >= 400 && gone.status < 500 && /^byok_/.test(String(gone.json?.error)), `a revoked key is refused (${gone.status} ${gone.json?.error})`);
  assert.equal(seen.length, before, 'and the gateway is not called');
  assert.equal(await credits(ada), 0);
  say('a route whose key is gone is refused: no fallback to credits');

  // ── a premium turn is unchanged: no grant header, and it is metered ──
  const bob = await person('bob_stream');
  seen.length = 0;
  const premium = await turn(bob, { model: 'gpt-5.5', messages: [{ role: 'user', content: 'hello' }] });
  if (premium.status === 200) {
    assert.equal(seen[0].grant, null, 'a premium call carries no own-key grant');
    say('a premium turn sends no grant');
  } else {
    // a brand-new account with no credits is refused before any call; that is the premium path's own rule
    assert.ok([402, 403].includes(premium.status), `a premium turn with no credits is refused by metering (${premium.status})`);
    assert.equal(seen.length, 0);
    say('a premium turn with no credits is still stopped by metering (so own-key did not bypass it)');
  }

  // ── in-house: the same answer as the non-streaming route, not a 501 ──
  const cy = await person('cy_stream');
  await setRoute(pool, cy, '*', { path: 'inhouse' });
  const inhouse = await turn(cy, { model: 'gpt-5.5', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(inhouse.status, 400); assert.equal(inhouse.json.error, 'inhouse_unavailable');
  say('in-house says it is unavailable on the server, the way the non-streaming route does');

  console.log('chat-stream-own-key: all checks passed');
} catch (error) {
  console.error('chat-stream-own-key: FAILED\n', error);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => gateway.close(resolve));
  await pool.end();
}
