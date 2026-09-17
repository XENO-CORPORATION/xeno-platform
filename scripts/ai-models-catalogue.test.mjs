/**
 * GET /api/ai/models serves the LIVE gateway catalogue, or the platform's synced
 * copy — never a hardcoded list.
 *
 * Dogfooding 2026-09-17: the route answered ten 2024 model ids (gpt-4o-mini,
 * claude-3-opus, gemini-1.5-pro…) and every one 404'd at the gateway. Real
 * router, a fake gateway on loopback, a stub db.
 *
 * Mutations: restore the static array -> "no model the gateway does not serve"
 * fails. Drop the catalogue fallback -> "when the gateway is down the synced
 * copy answers" fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';

// Point the platform's gateway client at a fake BEFORE the module reads its env.
const gw = http.createServer((req, res) => {
  if (req.url === '/v1/models' && req.headers.authorization === 'Bearer test-key') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [
      { id: 'gpt-5.5', owned_by: 'openai', type: 'text' },
      { id: 'gpt-5.5-high', owned_by: 'openai', type: 'text' },
      { id: 'claude-opus-4-6', owned_by: 'anthropic', type: 'text' },
      { id: 'seedance-2.0', owned_by: 'byteplus', type: 'video' },
    ] }));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => gw.listen(0, '127.0.0.1', r));
process.env.XENO_API_BASE_URL = `http://127.0.0.1:${gw.address().port}/v1`;
process.env.XENO_API_KEY = 'test-key';
const { default: aiRoutes } = await import('../src/server/routes/aiRoutes.js');

async function withApp(db, fn) {
  const app = express();
  app.use((req, _res, next) => { req.db = db; req.user = { id: 'u1' }; next(); });
  app.use('/api/ai', aiRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

test('the list is the gateway catalogue: text models only, effort variants collapsed, no model the gateway does not serve', async () => {
  await withApp({ query: async () => { throw new Error('db must not be touched while the gateway answers'); } }, async (base) => {
    const r = await fetch(`${base}/api/ai/models`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.source, 'gateway');
    assert.deepEqual(body.models.map((m) => m.id), ['gpt-5.5', 'claude-opus-4-6']);
    assert.equal(body.models[0].provider, 'OpenAI');
    assert.deepEqual(body.models[0].paths, ['premium', 'byok']);
    for (const stale of ['gpt-4o-mini', 'claude-3-opus', 'gemini-1.5-pro', 'llama-3.1-70b', 'mistral-large']) {
      assert.ok(!body.models.some((m) => m.id === stale), `${stale} is not served by the gateway and must not be listed`);
    }
  });
});

test('when the gateway is down the synced copy answers, never a hardcoded list', async () => {
  await new Promise((r) => gw.close(r));
  const db = { query: async (sql) => {
    assert.match(sql, /FROM gateway_model_aliases/);
    assert.match(sql, /enabled AND NOT is_alias AND provider <> 'unknown'/);
    return { rows: [{ public_id: 'claude-sonnet-4-6', provider: 'anthropic' }, { public_id: 'grok-4.6', provider: 'xai' }, { public_id: 'grok-4.6-high', provider: 'xai' }] };
  } };
  await withApp(db, async (base) => {
    const body = await (await fetch(`${base}/api/ai/models`)).json();
    assert.equal(body.source, 'catalogue');
    assert.deepEqual(body.models.map((m) => m.id), ['claude-sonnet-4-6', 'grok-4.6']);
  });
  await withApp({ query: async () => { throw new Error('db down'); } }, async (base) => {
    const r = await fetch(`${base}/api/ai/models`);
    assert.equal(r.status, 503, 'no catalogue anywhere is a 503, not an invented list');
  });
});

test('the static 2024 list is gone from the source', () => {
  const src = readFileSync(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
  assert.ok(!/id: 'gpt-4o-mini', name: 'GPT-4o Mini'/.test(src));
  assert.ok(!/'Most capable OpenAI model'/.test(src));
});
