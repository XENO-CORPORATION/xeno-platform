/**
 * POST /api/v2/inference/credentials is rate-limited PER USER, ahead of the
 * live provider probe. Real router, real express-rate-limit, no database:
 * with BYOK off the handler answers 503 before touching req.db, which is
 * enough to see whether the limiter sat in front of it.
 *
 * Mutation: remove `credentialProbeLimiter` from the route -> "the 11th store
 * is refused" fails. Key it on IP instead of user -> "another user is not
 * blocked" fails (both users share the loopback address here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

delete process.env.BYOK_ENABLED;
const { default: v2InferenceRoutes } = await import('../src/server/routes/v2InferenceRoutes.js');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = { query: () => { throw new Error('must not touch the db'); }, connect: () => { throw new Error('must not touch the db'); } }; req.user = { id: req.headers['x-test-user'] }; next(); });
  app.use('/api/v2/inference', v2InferenceRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

const post = (base, user) => fetch(`${base}/api/v2/inference/credentials`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user },
  body: JSON.stringify({ provider: 'openai', label: 'x', secret: 'sk-' + 'a'.repeat(40) }),
});

test('the 11th key store in a window is refused before the handler runs; another user is not blocked', async () => {
  await withServer(async (base) => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post(base, 'user-a')).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(503), 'first ten reach the handler (BYOK-off 503, not 429)');
    const last = await post(base, 'user-a');
    assert.equal(statuses[10], 429, 'the 11th store is refused');
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error?.code, 'rate_limited');
    assert.ok(last.headers.get('ratelimit-limit') || last.headers.get('ratelimit'), 'standard RateLimit headers are sent');
    assert.equal((await post(base, 'user-b')).status, 503, 'another user is not blocked — the key is the USER, not the shared address');
  });
});
