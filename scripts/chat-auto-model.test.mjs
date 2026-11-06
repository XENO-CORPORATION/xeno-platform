/**
 * Tools on tools.xenosystem.ai name no model, so webHost.ts sends `auto`. The gateway has no such id: it answered 404
 * and the tool showed "The model `auto` does not exist". /api/ai/chat resolves it to the person's default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatModelFor, PLATFORM_DEFAULT_MODEL } from '../src/server/services/chatModel.js';

const dbWith = (settings) => ({ query: async () => ({ rows: settings ? [{ settings }] : [] }) });

test("'auto' becomes the platform default for someone with no setting", async () => {
  assert.equal(await chatModelFor(dbWith(null), 'u1', 'auto'), PLATFORM_DEFAULT_MODEL);
});

test("'auto' becomes the person's own default", async () => {
  assert.equal(await chatModelFor(dbWith({ models: { defaultModel: 'grok-4.6' } }), 'u1', 'auto'), 'grok-4.6');
});

test('the platform default is not the retired gpt-5.6-terra, and matches the default the agents use', () => {
  const source = readFileSync(new URL('../src/server/services/agentMedia.js', import.meta.url), 'utf8');
  assert.notEqual(PLATFORM_DEFAULT_MODEL, 'gpt-5.6-terra');
  assert.ok(source.includes(`process.env.AGENT_CHAT_DEFAULT_MODEL || '${PLATFORM_DEFAULT_MODEL}'`));
});

test('a named model is left alone and costs no query', async () => {
  const db = { query: async () => { throw new Error('a named model must not read settings'); } };
  assert.equal(await chatModelFor(db, 'u1', 'gpt-5.6-terra'), 'gpt-5.6-terra');
});

test('POST /api/ai/chat resolves the model before anything uses it', () => {
  const source = readFileSync(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
  const start = source.indexOf("router.post('/chat', requireEntitlement('canUse')");
  const body = source.slice(start, source.indexOf('\nrouter.', start + 10));
  const resolved = body.indexOf('const model = await chatModelFor(req.db, userId, namedModel)');
  assert.ok(resolved > 0, 'the route must resolve the model through chatModelFor');
  assert.ok(resolved < body.indexOf('resolveRoute(model)'), 'routing must see the resolved id');
  assert.ok(resolved < body.indexOf('callXenoApi('), 'the gateway must see the resolved id');
});
