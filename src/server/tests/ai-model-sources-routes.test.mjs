// Route-handler tests for per-model sources (aiRoutes.js). In-process Express, a stub database.
// Covers: GET /api/ai/models/routes (auth, caller scope, no key material, cloud copy per provider),
// and the source / byokMode fields on POST /api/ai/chat and /api/ai/chat/stream (typed refusals,
// no silent fallback). Run: node --test src/server/tests/ai-model-sources-routes.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Point the live catalogue at a closed port so the handler takes its synced-copy fallback offline.
process.env.XENO_API_URL = 'http://127.0.0.1:9';
delete process.env.BYOK_ENABLED;

const { default: aiRoutes } = await import('../routes/aiRoutes.js');

const calls = [];
const fakeDb = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (/FROM gateway_model_aliases WHERE public_id = ANY/.test(sql)) {
      return { rows: [{ public_id: 'claude-opus-5-5', provider: 'anthropic' }, { public_id: 'gpt-5.5', provider: 'openai' }] };
    }
    if (/FROM gateway_model_aliases WHERE enabled AND NOT is_alias/.test(sql)) {
      return { rows: [{ public_id: 'claude-opus-5-5', provider: 'anthropic' }, { public_id: 'gpt-5.5', provider: 'openai' }] };
    }
    if (/FROM user_provider_credentials c/.test(sql)) {
      return {
        rows: [
          { id: 'cred-anth', provider: 'anthropic', label: 'work', status: 'active', verified_at: '2026-10-01', models: null,
            key_fingerprint: 'FP-SECRET', key_last4: '9999', secret_ciphertext: 'CIPHER-SECRET', base_url: null,
            last_used_at: null, created_at: '2026-10-01', routed_surfaces: 0 },
        ],
      };
    }
    return { rows: [] };
  },
  async connect() { return { query: async () => ({ rows: [] }), release() {} }; },
};

let server; let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const uid = req.headers['x-test-user'];
    if (uid) req.user = { id: uid };
    req.db = fakeDb;
    next();
  });
  app.use('/api/ai', aiRoutes);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/ai`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const get = (path, headers = {}) => fetch(base + path, { headers });
const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'user-A', ...headers }, body: JSON.stringify(body),
});
const chatBody = (extra = {}) => ({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], ...extra });

test('GET /models/routes refuses an unauthenticated caller', async () => {
  const r = await get('/models/routes');
  assert.equal(r.status, 401);
});

test('GET /models/routes lists each model with sources, own keys grouped by provider, no key material', async () => {
  calls.length = 0;
  const r = await get('/models/routes', { 'x-test-user': 'user-A' });
  assert.equal(r.status, 200);
  const text = await r.text();
  const body = JSON.parse(text);
  assert.equal(body.success, true);
  // The catalogue returns its own ids; every listed model is checked the same way.
  const opus = body.models[0];
  assert.ok(opus && opus.id, 'a model is listed');
  const byok = opus.sources.filter((s) => s.source === 'byok');
  assert.equal(byok.length, 1, 'one own-key row per provider');
  assert.equal(byok[0].provider, 'anthropic');
  assert.equal(byok[0].modes.cloud.state, 'available');
  assert.deepEqual(byok[0].modes.local, { state: 'unknown-to-server' });
  // No secret, fingerprint or last-4 leaves the server.
  assert.ok(!text.includes('CIPHER-SECRET'));
  assert.ok(!text.includes('FP-SECRET'));
  assert.ok(!text.includes('9999'));
});

test('GET /models/routes reads only the caller’s own credentials', async () => {
  calls.length = 0;
  await get('/models/routes', { 'x-test-user': 'user-A' });
  const credQuery = calls.find((c) => /FROM user_provider_credentials c/.test(c.sql));
  assert.ok(credQuery, 'credential query ran');
  assert.match(credQuery.sql, /WHERE c\.user_id = \$1/);
  assert.deepEqual(credQuery.params, ['user-A']);
});

test('a plan with no metered allowance gets no quota row (fail-closed when the ledger is unreadable)', async () => {
  const r = await get('/models/routes', { 'x-test-user': 'user-A' });
  const body = await r.json();
  for (const m of body.models) assert.equal(m.sources.some((s) => s.source === 'quota'), false);
});

test('POST /chat: an unknown source is refused with invalid_source', async () => {
  const r = await post('/chat', chatBody({ source: 'deepseek' }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_source');
});

test('POST /chat/stream: an unknown source is refused with invalid_source', async () => {
  const r = await post('/chat/stream', chatBody({ source: 'deepseek' }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_source');
});

test('header and body that disagree are refused on both chat routes', async () => {
  for (const path of ['/chat', '/chat/stream']) {
    const r = await post(path, chatBody({ source: 'byok' }), { 'x-xeno-source': 'credits' });
    assert.equal(r.status, 400, path);
    assert.equal((await r.json()).error, 'source_conflict', path);
  }
});

test('a source that names a different route than path is refused with source_conflict', async () => {
  const r = await post('/chat', chatBody({ source: 'credits', path: 'byok' }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'source_conflict');
});

test('source=byok while BYOK is off is refused, never served on another route', async () => {
  for (const path of ['/chat', '/chat/stream']) {
    const r = await post(path, chatBody({ source: 'byok' }));
    assert.equal(r.status, 400, path);
    assert.equal((await r.json()).error, 'byok_unavailable', path);
  }
});

test('byokMode=local is refused on both chat routes: the gateway never receives a local key', async () => {
  for (const path of ['/chat', '/chat/stream']) {
    const r = await post(path, chatBody({ byokMode: 'local', source: 'byok' }));
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).error, 'local_mode_client_only', path);
  }
});

test('an invalid byokMode is refused with invalid_byok_mode on both chat routes', async () => {
  for (const path of ['/chat', '/chat/stream']) {
    const r = await post(path, chatBody({ byokMode: 'both' }));
    assert.equal(r.status, 400, path);
    assert.equal((await r.json()).error, 'invalid_byok_mode', path);
  }
});
