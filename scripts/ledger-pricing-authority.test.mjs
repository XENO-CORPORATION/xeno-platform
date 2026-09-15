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
 *   - a public route publishes the per-token table                 -> "no server route publishes the per-token table"
 *   - gpt-6 falls back to default tier                             -> "flagship ids resolve to the flagship tier"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServiceLedgerRouter } from '../src/server/routes/serviceLedgerRoutes.js';
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

/**
 * Shut a loopback test server down DETERMINISTICALLY.
 *
 * 🔴 `server.close()` alone stops accepting new connections and then waits for existing
 * ones to drain. Node's fetch keeps sockets ALIVE, so a socket can still be open when the
 * next test starts — and an error on that socket arrives with no test on the stack, which
 * the runner reports as a FILE-level "test failed" with no name and kills every remaining
 * test in the file. Seen once in ~100 runs: 4 passed, 14 never ran, and the summary said
 * "pass 4, fail 1". Closing the connections first removes the race rather than hiding it.
 */
async function shutdown(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * The quota dependencies of the hold path, faked. They are injected rather than stubbed
 * globally so a test can make ONE of them fail and assert what the route does about it —
 * see "a hold is refused when the quota subsystem cannot answer".
 */
function fakeQuota({ ensureQuota, plan = 'pro', kind = 'human', ownerId = 'owner-1' } = {}) {
  const seen = [];
  return {
    seen,
    ensureQuota: ensureQuota || (async (_db, userId, p, opts) => { seen.push({ userId, plan: p, ...opts }); return { metered: true }; }),
    getEffectivePlan: async () => ({ plan }),
    // An agent resolves to its OWNER as the billing subject; a human is their own.
    billingSubjectFor: async (_db, userId) => (kind === 'agent'
      ? { userId: ownerId, actorUserId: String(userId), isAgent: true }
      : { userId: String(userId), actorUserId: String(userId), isAgent: false }),
  };
}

async function withApp(run, quotaOpts) {
  const ledger = fakeLedger();
  const quota = fakeQuota(quotaOpts);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = {}; next(); });
  app.use('/api/v2/ledger/service', createServiceLedgerRouter({
    ledger, getServiceToken: () => TOKEN,
    ensureQuota: quota.ensureQuota, getEffectivePlan: quota.getEffectivePlan, billingSubjectFor: quota.billingSubjectFor,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = TOKEN) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
  try { await run({ call, ledger, quota }); } finally { await shutdown(server); }
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
  } finally { await shutdown(server); }
});

test('per-token rates are internal: only the service surface quotes them', async () => {
  // 🔒 XENO PRICING - STANDARD & LEDGER.md §8 — "Never expose a token/compute mapping."
  // A public per-token table shipped for one evening on 2026-09-15 and was removed.
  await withApp(async ({ call }) => {
    const q = await call('GET', '/api/v2/ledger/service/quote?model=claude-opus-5&estInputTokens=1000&maxOutputTokens=4096');
    assert.equal(q.status, 200);
    assert.equal(q.json.holdMicro, pricing.estimateChatCostMicro('claude-opus-5', { inputTokens: 1000, maxOutputTokens: 4096 }));
    assert.equal((await call('GET', '/api/v2/ledger/service/quote?model=claude-opus-5', null, '')).status, 401, 'no token, no rates');
  });
});

test('no server route publishes the per-token table', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const index = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.ok(!/app\.use\(\s*['"]\/api\/v2\/pricing/.test(index), 'a public /api/v2/pricing mount is back');
  const routes = new URL('../src/server/routes/', import.meta.url);
  for (const file of readdirSync(routes)) {
    if (file === 'serviceLedgerRoutes.js') continue;
    const src = readFileSync(new URL(file, routes), 'utf8');
    assert.ok(!/chatRatesFor|CHAT_TIERS/.test(src), `${file} reaches the per-token rates outside the service surface`);
  }
});

test('flagship ids resolve to the flagship tier', () => {
  assert.equal(pricing.chatTier('gpt-6-astra'), 'frontier-large');
  assert.equal(pricing.chatTier('claude-opus-5'), 'frontier-large');
  assert.equal(pricing.chatTier('gpt-6-mini'), 'frontier-mid', 'mini stays mid even on a flagship generation');
  assert.equal(pricing.chatTier('claude-sonnet-5'), 'frontier-mid');
  assert.equal(pricing.chatTier('deepseek-v4'), 'open');
});

// ── §8b: the hold path issues the weekly allowance and installs the burst caps ───

test('a hold issues this window\'s allowance before reserving', () => withApp(async ({ call, quota }) => {
  const r = await call('POST', '/api/v2/ledger/service/holds', {
    userId: 'u1', holdId: 'h1', operation: 'chat.completion.stream', surface: 'xeno_api',
    pricing: { model: 'claude-opus-5', estInputTokens: 10, maxOutputTokens: 16 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(quota.seen.length, 1, 'the lazy refill runs on the admission path, not in a cron');
  assert.equal(quota.seen[0].userId, 'u1');
  assert.equal(quota.seen[0].plan, 'pro', 'the allowance is sized by the EFFECTIVE plan, not a caller-supplied one');
}));

test("an agent's hold is billed to its OWNER, on the owner's one quota", () => withApp(async ({ call, ledger, quota }) => {
  // 🔴 An agent is a scoped relation off a real user, never an account. It has no wallet,
  // no plan and no quota of its own. Billing the agent's own id charged a credit_accounts
  // row nothing funds, and read its plan from a row carrying no subscription — so every
  // agent silently resolved to 'free' regardless of who owned it. One human, one quota.
  const r = await call('POST', '/api/v2/ledger/service/holds', {
    userId: 'agent-1', holdId: 'h1', operation: 'run', surface: 'xeno_agents', amountMicro: 1000,
  });
  assert.equal(r.status, 200);
  assert.equal(ledger.calls.find((c) => c[0] === 'hold')[1], 'owner-1', "the money comes off the OWNER's account");
  assert.equal(quota.seen[0].userId, 'owner-1', "and it draws the OWNER's allowance, not a second one");
  // The agent is still NAMED, so an owner can see which of their agents spent it.
  assert.equal(r.json.actorUserId, 'agent-1');
  assert.equal(r.json.billedUserId, 'owner-1');
}, { kind: 'agent' }));

test('a human is their own billing subject', () => withApp(async ({ call, ledger, quota }) => {
  await call('POST', '/api/v2/ledger/service/holds', { userId: 'u1', holdId: 'h1', operation: 'run', surface: 's', amountMicro: 1000 });
  assert.equal(ledger.calls.find((c) => c[0] === 'hold')[1], 'u1');
  assert.equal(quota.seen[0].userId, 'u1');
}, { kind: 'human' }));

test('settle and void resolve the SAME subject as the hold', () => withApp(async ({ call, ledger }) => {
  // An agent's hold lives on its owner's account. Settling under the agent's own id would
  // look for a hold that is not there — the reservation strands until it expires, and the
  // gateway sees a 404 on a hold it just successfully placed.
  await call('POST', '/api/v2/ledger/service/holds/h1/settle', {
    userId: 'agent-1', usage: { model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, measured: true },
  });
  await call('POST', '/api/v2/ledger/service/holds/h1/void', { userId: 'agent-1' });
  assert.equal(ledger.calls.find((c) => c[0] === 'settle')[1], 'owner-1');
  assert.equal(ledger.calls.find((c) => c[0] === 'void')[1], 'owner-1');
}, { kind: 'agent' }));

test('a one-shot usage bills the owner and labels the agent', () => withApp(async ({ call, ledger }) => {
  await call('POST', '/api/v2/ledger/service/usage', {
    userId: 'agent-1', transactionId: 't1', surface: 'xeno_api', operation: 'chat.completion',
    usage: { model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, measured: true },
  });
  const ev = ledger.calls.find((c) => c[0] === 'usage');
  assert.equal(ev[1], 'owner-1', 'the debit lands on the owner');
  assert.equal(ev[2].dimensions.agent_user_id, 'agent-1', 'attribution is a LABEL on the row, not a second wallet');
}, { kind: 'agent' }));

test('a hold is REFUSED when the quota subsystem cannot answer', () => withApp(async ({ call, ledger }) => {
  // 🔴 Fail-closed on purpose. An earlier version logged and continued, which is fail-open
  // twice: the user is refused a call their (unissued) allowance would have covered, and an
  // agent whose burst cap was never written spends against no guard at all.
  const r = await call('POST', '/api/v2/ledger/service/holds', {
    userId: 'u1', holdId: 'h1', operation: 'run', surface: 's', amountMicro: 1000,
  });
  assert.equal(r.status, 500, 'a quota failure must not read as a successful reservation');
  assert.equal(ledger.calls.filter((c) => c[0] === 'hold').length, 0, 'no money is reserved when the guard is unknown');
}, { ensureQuota: async () => { throw new Error('quota database unreachable'); } }));

test('settle and void never touch the quota path', () => withApp(async ({ call, quota }) => {
  // The allowance is issued at ADMISSION. Re-issuing on the way out would be a second
  // write on every turn for no new fact, and `void` must stay the cheap cancel path.
  await call('POST', '/api/v2/ledger/service/holds/h1/settle', {
    userId: 'u1', usage: { model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, measured: true },
  });
  await call('POST', '/api/v2/ledger/service/holds/h1/void', { userId: 'u1' });
  assert.equal(quota.seen.length, 0);
}));

test('a one-shot usage is REFUSED when the quota subsystem cannot answer', () => withApp(async ({ call, ledger }) => {
  // Same rule as the hold, and it needs its own test: the two paths call ensureQuota
  // separately, so a `.catch` added to one is invisible to the other's gate. A one-shot
  // debit that proceeds without the burst cap installed is the runaway this exists to stop,
  // and it is the path a non-streaming completion takes.
  const r = await call('POST', '/api/v2/ledger/service/usage', {
    userId: 'u1', transactionId: 't1', surface: 'xeno_api', operation: 'chat.completion',
    usage: { model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, measured: true },
  });
  assert.equal(r.status, 500, 'a quota failure must not read as a successful debit');
  assert.equal(ledger.calls.filter((c) => c[0] === 'usage').length, 0, 'nothing is metered when the guard is unknown');
}, { ensureQuota: async () => { throw new Error('quota database unreachable'); } }));

test('the balance an agent reads is its OWNER\'s — the gate must agree with the hold', () => withApp(async ({ call, ledger }) => {
  // 🔴 Found by reviewing the gateway's deploy plan, 2026-09-15. This endpoint is an
  // ADMISSION GATE: the gateway reads it and answers 402 `no_credits` when nothing is
  // available, before it ever places a hold. It was the one leg that did not resolve the
  // payer, so an agent read its own (empty) wallet and was refused as broke — while the
  // hold that would have followed billed its owner's funded account and succeeded.
  // A gate that disagrees with the operation it guards refuses for the wrong reason.
  const r = await call('GET', '/api/v2/ledger/service/balance?userId=agent-1');
  assert.equal(r.status, 200);
  assert.equal(ledger.calls.find((c) => c[0] === 'balance')[1], 'owner-1');
  assert.equal(r.json.billedUserId, 'owner-1');
  assert.equal(r.json.actorUserId, 'agent-1');
}, { kind: 'agent' }));

test('all four legs resolve ONE subject — balance, hold, settle, usage', () => withApp(async ({ call, ledger }) => {
  // The coverage set, not the mechanism. Four paths bill money and each resolves the payer
  // separately, so a fifth added later can quietly skip it — which is exactly how /balance
  // was missed. Assert every one, so a new leg has to be added here to pass.
  await call('GET', '/api/v2/ledger/service/balance?userId=agent-1');
  await call('POST', '/api/v2/ledger/service/holds', { userId: 'agent-1', holdId: 'h1', operation: 'run', surface: 's', amountMicro: 1000 });
  await call('POST', '/api/v2/ledger/service/holds/h1/settle', { userId: 'agent-1', usage: { model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, measured: true } });
  await call('POST', '/api/v2/ledger/service/usage', {
    userId: 'agent-1', transactionId: 't1', surface: 's', operation: 'o',
    usage: { model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, measured: true },
  });
  for (const leg of ['balance', 'hold', 'settle', 'usage']) {
    assert.equal(ledger.calls.find((c) => c[0] === leg)[1], 'owner-1', `${leg} must bill the owner`);
  }
}, { kind: 'agent' }));
