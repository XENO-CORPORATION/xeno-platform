/**
 * ledger-pricing-authority.test.mjs — the platform prices every call; callers send tokens.
 *
 * Found 2026-09-15: /api/v2/ledger/service/* only accepted `amountMicro` — the CALLER priced —
 * so the inference gateway kept its own price table (Opus 5 at the `default` rate, ~1/50 of
 * cost) and wrote straight into this database. Two writers, two price lists, one wallet.
 * `XENO ACCOUNT - ARCHITECTURE.md` §1 makes xeno-platform the origin for pricing AND the
 * ledger; these tests pin that the service surface now IS that authority.
 *
 * Runs a real Express app on a loopback port with the ledger engine faked, so the pricing
 * rules are proven without Postgres. The engine itself is covered by the proof:* scripts.
 *
 * Mutation checks (each verified to fail the named test):
 *   - hold uses the caller's amountMicro when pricing is present  -> "a hold is priced by the platform"
 *   - settle prices an unmeasured usage on its tokens              -> "an unmeasured settle charges the reservation"
 *   - one-shot usage ignores the price table                       -> "a one-shot usage is priced by the platform"
 *   - pricing endpoint reads a different table                     -> "the public price list is the same table charging uses"
 *   - gpt-6 falls back to default tier                             -> "flagship ids resolve to the flagship tier"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
import { createPricingRouter } from '../src/server/routes/pricingRoutes.js';
import * as pricing from '../src/server/utils/creditCosts.js';

const TOKEN = 'test-service-token';

function fakeLedger() {
  const calls = [];
  return {
    calls,
    async getBalanceV2(_db, userId) { calls.push(['balance', userId]); return { postedMicro: 5_000_000, availableMicro: 4_000_000, is_frozen: false }; },
    async holdV2(_db, userId, req) { calls.push(['hold', userId, req]); return { holdId: req.holdId, state: 'held', amountMicro: req.amountMicro }; },
    async settleHoldV2(_db, userId, holdId, actual) { calls.push(['settle', userId, holdId, actual]); return { holdId, state: 'settled', settledMicro: Math.min(actual, 2_000_000) }; },
    async voidHoldV2(_db, userId, holdId) { calls.push(['void', userId, holdId]); return { holdId, state: 'voided' }; },
    async recordUsageV2(_db, userId, event) { calls.push(['usage', userId, event]); return { accepted: true, duplicate: false, costMicro: event.costMicro, transactionId: event.transactionId }; },
  };
}

async function withApp(run) {
  const ledger = fakeLedger();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = {}; next(); });
  app.use('/api/v2/ledger/service', createServiceLedgerRouter({ ledger, getServiceToken: () => TOKEN }));
  app.use('/api/v2/pricing', createPricingRouter());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = TOKEN) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
  try { await run({ call, ledger }); } finally { await new Promise((r) => server.close(r)); }
}

test('a hold is priced by the platform from the model and token budget', () => withApp(async ({ call, ledger }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds', {
    userId: 'u1', holdId: 'h1', operation: 'chat.completion.stream', surface: 'xeno_api',
    pricing: { model: 'claude-opus-5', estInputTokens: 1000, maxOutputTokens: 4096 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const expected = pricing.estimateChatCostMicro('claude-opus-5', { inputTokens: 1000, maxOutputTokens: 4096 });
  assert.equal(r.json.amountMicro, expected);
  assert.equal(r.json.pricing.tier, 'frontier-large');
  const hold = ledger.calls.find((c) => c[0] === 'hold');
  assert.equal(hold[2].amountMicro, expected, 'the engine receives the platform price, not a caller number');
}));

test('a caller may not name a price alongside pricing', () => withApp(async ({ call }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds', {
    userId: 'u1', holdId: 'h1', operation: 'op', surface: 's',
    pricing: { model: 'claude-opus-5', estInputTokens: 1, maxOutputTokens: 1 }, amountMicro: 1,
  });
  assert.equal(r.status, 400);
}));

test('the legacy caller-priced hold still works for xeno-agents-api', () => withApp(async ({ call, ledger }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds', { userId: 'u1', holdId: 'h2', operation: 'run', surface: 'xeno_agents', amountMicro: 750000 });
  assert.equal(r.status, 200);
  assert.equal(r.json.pricing, null);
  assert.equal(ledger.calls.find((c) => c[0] === 'hold')[2].amountMicro, 750000);
}));

test('a measured settle is priced by the platform from real tokens', () => withApp(async ({ call, ledger }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds/h1/settle', {
    userId: 'u1', usage: { model: 'claude-opus-5', inputTokens: 16, outputTokens: 17, measured: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const expected = pricing.getChatCostMicro('claude-opus-5', { inputTokens: 16, outputTokens: 17 });
  assert.equal(ledger.calls.find((c) => c[0] === 'settle')[3], expected);
  assert.equal(r.json.pricing.measured, true);
}));

test('an unmeasured settle charges the reservation, never a cheaper estimate', () => withApp(async ({ call, ledger }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds/h1/settle', {
    userId: 'u1', usage: { model: 'claude-opus-5', inputTokens: 16, outputTokens: 2, measured: false },
  });
  assert.equal(r.status, 200);
  const actual = ledger.calls.find((c) => c[0] === 'settle')[3];
  assert.ok(actual > pricing.getChatCostMicro('claude-opus-5', { inputTokens: 16, outputTokens: 2 }), 'must not settle at the estimate');
  assert.equal(actual, Number.MAX_SAFE_INTEGER, 'settleHoldV2 clamps this to the held amount');
  assert.equal(r.json.pricing.measured, false);
}));

test('a one-shot usage is priced by the platform and labelled', () => withApp(async ({ call, ledger }) => {
  const r = await call('POST', '/api/v2/ledger/service/usage', {
    userId: 'u1', transactionId: 't1', surface: 'xeno_api', operation: 'chat.completion',
    usage: { model: 'gpt-6-astra', inputTokens: 200, outputTokens: 50, measured: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ev = ledger.calls.find((c) => c[0] === 'usage')[2];
  assert.equal(ev.costMicro, pricing.getChatCostMicro('gpt-6-astra', { inputTokens: 200, outputTokens: 50 }));
  assert.deepEqual([ev.inputTokens, ev.outputTokens], [200, 50]);
  assert.equal(ev.dimensions.usage_source, 'provider');
  assert.equal(r.json.costMicro, ev.costMicro);
}));

test('a one-shot usage without a usage object is refused — the caller cannot send money', () => withApp(async ({ call }) => {
  const r = await call('POST', '/api/v2/ledger/service/usage', {
    userId: 'u1', transactionId: 't1', surface: 's', operation: 'o', costMicro: 5,
  });
  assert.equal(r.status, 400);
}));

test('balance is readable by a service for its admission gate', () => withApp(async ({ call }) => {
  const r = await call('GET', '/api/v2/ledger/service/balance?userId=u1');
  assert.equal(r.status, 200);
  assert.equal(r.json.availableMicro, 4_000_000);
  assert.equal((await call('GET', '/api/v2/ledger/service/balance')).status, 400);
}));

test('the service surface is closed without the token, in both directions', () => withApp(async ({ call }) => {
  assert.equal((await call('GET', '/api/v2/ledger/service/balance?userId=u1', null, '')).status, 401);
  assert.equal((await call('GET', '/api/v2/ledger/service/balance?userId=u1', null, 'wrong')).status, 401);
}));

test('an unconfigured service token closes the surface — it never opens', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = {}; next(); });
  app.use('/api/v2/ledger/service', createServiceLedgerRouter({ ledger: fakeLedger(), getServiceToken: () => '' }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const auth of [undefined, 'Bearer ', 'Bearer anything']) {
      const r = await fetch(`${base}/api/v2/ledger/service/balance?userId=u1`, { headers: auth ? { Authorization: auth } : {} });
      assert.equal(r.status, 401, `auth=${auth}`);
    }
  } finally { await new Promise((r) => server.close(r)); }
});

test('the public price list is the same table charging uses', () => withApp(async ({ call }) => {
  const list = await call('GET', '/api/v2/pricing/chat', null, '');
  assert.equal(list.status, 200, 'pricing is public');
  assert.deepEqual(list.json.tiers, pricing.chatPriceList().tiers);
  const one = await call('GET', '/api/v2/pricing/chat?model=claude-sonnet-5', null, '');
  assert.deepEqual(one.json, { model: 'claude-sonnet-5', ...pricing.chatRatesFor('claude-sonnet-5') });
  const quote = await call('GET', '/api/v2/pricing/chat/quote?model=claude-opus-5&estInputTokens=1000&maxOutputTokens=4096', null, '');
  assert.equal(quote.json.holdMicro, pricing.estimateChatCostMicro('claude-opus-5', { inputTokens: 1000, maxOutputTokens: 4096 }));
  const serviceQuote = await call('GET', '/api/v2/ledger/service/quote?model=claude-opus-5&estInputTokens=1000&maxOutputTokens=4096');
  assert.equal(serviceQuote.json.holdMicro, quote.json.holdMicro, 'the service and public quotes agree');
}));

test('flagship ids resolve to the flagship tier', () => {
  assert.equal(pricing.chatTier('gpt-6-astra'), 'frontier-large');
  assert.equal(pricing.chatTier('claude-opus-5'), 'frontier-large');
  assert.equal(pricing.chatTier('gpt-6-mini'), 'frontier-mid', 'mini stays mid even on a flagship generation');
  assert.equal(pricing.chatTier('claude-sonnet-5'), 'frontier-mid');
  assert.equal(pricing.chatTier('deepseek-v4'), 'open');
});
