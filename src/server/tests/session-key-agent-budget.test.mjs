/**
 * session-key-agent-budget.test.mjs — a session key minted FOR an agent, with a spend cap (2026-10-18, XENO Spawn).
 *
 *   POST /api/v2/inference/session-keys { agentId?, maxSpendMicro? }
 *     - agentId: the person must hold the run right on the agent; the key row records it; the person still pays.
 *     - maxSpendMicro: stored on the key; the SERVICE hold route refuses (402 SESSION_KEY_BUDGET_EXHAUSTED) a hold that
 *       would take settled + outstanding-held spend on that key past the cap, inside the hold's transaction.
 *   The gateway sends `apiKeyId` (the key it authenticated) on hold / usage; the usage row then names the key and the agent.
 *
 * Real PostgreSQL with every migration, the real routes over HTTP.
 * Run: DATABASE_URL=postgresql://… node tests/session-key-agent-budget.test.mjs (a disposable database).
 *
 * Mutation checks (each verified to fail the named test):
 *   - remove the key-cap check in reserveForHold (fixed path)        -> "a capped key refuses a hold past its cap"
 *   - count only settled usage, not outstanding holds               -> "outstanding holds count against the cap"
 *   - remove the key bound from the LEASE path                       -> "a LEASED hold (what the gateway sends) is bounded by the key cap"
 *   - drop the run-right check on agentId                            -> "a stranger cannot mint a key for someone else's agent"
 *   - stop copying the key's agent onto the usage row               -> "usage on an agent key is attributed to the agent"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { authMiddleware } from '../middleware/auth.js';
import sessionKeyRoutes from '../routes/inferenceSessionKeyRoutes.js';
import serviceRouter from '../routes/serviceLedgerRoutes.js';
import * as agents from '../services/platformAgents.js';
import { resolvePrincipal } from '../services/agentIdentity.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (a disposable database)');
const TOKEN = `skab-${randomUUID()}`;
process.env.LEDGER_SERVICE_TOKEN = TOKEN;
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';

test('session keys for an agent, with a spend cap', { timeout: 300000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/inference/session-keys', authMiddleware, sessionKeyRoutes);
  app.use('/api/v2/ledger/service', serviceRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await pool.end(); });

  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id, username, email`,
    [name, `${name}@skab.test`])).rows[0];
  const legacy = (u) => jwt.sign({ userId: u.id, email: u.email, username: u.username }, JWT_SECRET, { expiresIn: '1h' });
  const mint = async (u, body) => {
    const r = await fetch(`${base}/api/v2/inference/session-keys`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${legacy(u)}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const svc = async (path, body) => {
    const r = await fetch(`${base}/api/v2/ledger/service${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const ada = await user(`skab_ada_${randomUUID().slice(0, 6)}`);
  const eve = await user(`skab_eve_${randomUUID().slice(0, 6)}`);
  for (const u of [ada, eve]) await addGrant(pool, u.id, { amountMicro: 500_000_000, kind: 'paid' });
  const agent = await agents.create(pool, await resolvePrincipal(pool, ada.id), { name: 'Spawn Bot' });
  assert.match(agent.id, /^agt_[0-9a-f]{32}$/);

  await t.test('a key minted without agentId or cap behaves as before', async () => {
    const m = await mint(ada, {});
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.key.agentId, undefined); assert.equal(m.body.key.maxSpendMicro, undefined);
    const row = (await pool.query('SELECT agent_user_id, max_spend_micro FROM api_keys WHERE id = $1', [m.body.key.id])).rows[0];
    assert.equal(row.agent_user_id, null); assert.equal(row.max_spend_micro, null);
  });

  await t.test('the owner mints a key for their agent; the person still owns (pays for) the key', async () => {
    const m = await mint(ada, { agentId: agent.id });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.key.agentId, agent.id);
    const row = (await pool.query('SELECT user_id::text u, agent_user_id::text a FROM api_keys WHERE id = $1', [m.body.key.id])).rows[0];
    assert.equal(row.u, ada.id); assert.equal(row.a, agent.userId);
  });

  await t.test("a stranger cannot mint a key for someone else's agent", async () => {
    const m = await mint(eve, { agentId: agent.id });
    assert.equal(m.status, 404); assert.equal(m.body.error.code, 'AGENT_NOT_FOUND');
    assert.equal((await mint(ada, { agentId: 'agt_nope' })).body.error.code, 'INVALID_AGENT');
    assert.equal((await mint(ada, { agentId: `agt_${'0'.repeat(32)}` })).status, 404);
  });

  await t.test('maxSpendMicro is validated', async () => {
    for (const bad of [0, -1, 1.5, '100', 10_000_000 * 1_000_000 + 1]) {
      const m = await mint(ada, { maxSpendMicro: bad });
      assert.equal(m.status, 400, `refuses ${bad}`); assert.equal(m.body.error.code, 'INVALID_MAX_SPEND');
    }
  });

  // three keys at most below: the live limit is 5 and two were made above
  const capped = (await mint(ada, { agentId: agent.id, maxSpendMicro: 10_000_000 })).body.key;
  assert.equal(capped.maxSpendMicro, 10_000_000);
  const hold = (holdId, amountMicro, apiKeyId = capped.id) => svc('/holds', { userId: ada.id, holdId, operation: 'chat.completion.stream', surface: 'xeno_api', amountMicro, apiKeyId });

  await t.test('a capped key refuses a hold past its cap', async () => {
    const over = await hold(`h-${randomUUID()}`, 10_000_001);
    assert.equal(over.status, 402, JSON.stringify(over.body)); assert.equal(over.body.error.code, 'SESSION_KEY_BUDGET_EXHAUSTED');
    assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE api_key_id = $1', [capped.id])).rows[0].n, 0, 'nothing was reserved');
  });

  await t.test('outstanding holds count against the cap, and concurrent holds cannot overshoot', async () => {
    const first = await hold(`h-${randomUUID()}`, 6_000_000);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await hold(`h-${randomUUID()}`, 6_000_000);
    assert.equal(second.status, 402, 'the second would pass the cap only because the first is still held');
    await svc(`/holds/${first.body.holdId}/void`, { userId: ada.id });
    const race = await Promise.all([hold(`h-${randomUUID()}`, 6_000_000), hold(`h-${randomUUID()}`, 6_000_000), hold(`h-${randomUUID()}`, 6_000_000)]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 402, 402], 'three racing holds: exactly one fits');
    const won = race.find((r) => r.status === 200).body.holdId;
    // settle it measured at a small amount, then the remainder is what settled usage leaves
    const st = await svc(`/holds/${won}/settle`, { userId: ada.id, actualCostMicro: 7_000_000 });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal((await hold(`h-${randomUUID()}`, 3_000_001)).status, 402, 'settled spend counts too');
    assert.equal((await hold(`h-${randomUUID()}`, 3_000_000)).status, 200, 'and exactly the rest still fits');
  });

  await t.test('a LEASED hold (what the gateway sends) is bounded by the key cap, and refused when nothing is left', async () => {
    const k = (await mint(ada, { maxSpendMicro: 20_000_000 })).body.key;
    const leased = (holdId) => svc('/holds', { userId: ada.id, holdId, operation: 'chat.completion.stream', surface: 'xeno_api', apiKeyId: k.id,
      pricing: { model: 'claude-opus-5', estInputTokens: 20, maxOutputTokens: 64000, lease: true } });
    const a = await leased(`h-${randomUUID()}`);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.ok(a.body.amountMicro <= 20_000_000, `the lease reserved within the cap (${a.body.amountMicro})`);
    const b = await leased(`h-${randomUUID()}`);
    assert.equal(b.status, 402, 'with the cap held, the next leased call is refused');
    assert.equal(b.body.error.code, 'SESSION_KEY_BUDGET_EXHAUSTED');
  });

  await t.test('usage on an agent key is attributed to the agent; the person pays', async () => {
    const holdId = `h-${randomUUID()}`;
    const k = (await mint(ada, { agentId: agent.id })).body.key;
    assert.equal((await hold(holdId, 1_000_000, k.id)).status, 200);
    const st = await svc(`/holds/${holdId}/settle`, { userId: ada.id, usage: { model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, measured: true } });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    const row = (await pool.query('SELECT user_id::text u, api_key_id::text k, dimensions FROM api_usage_logs WHERE request_id = $1', [holdId])).rows[0];
    assert.equal(row.u, ada.id, 'billed to the person'); assert.equal(row.k, k.id); assert.equal(row.dimensions.agent_user_id, agent.userId);
    // one-shot usage on the same key
    const tx = `u-${randomUUID()}`;
    assert.equal((await svc('/usage', { userId: ada.id, transactionId: tx, surface: 'xeno_api', operation: 'chat.completion', apiKeyId: k.id, usage: { model: 'claude-opus-5', inputTokens: 3, outputTokens: 1, measured: true } })).status, 200);
    const u = (await pool.query('SELECT api_key_id::text k, dimensions FROM api_usage_logs WHERE request_id = $1', [tx])).rows[0];
    assert.equal(u.k, k.id); assert.equal(u.dimensions.agent_user_id, agent.userId);
  });

  await t.test("a key id that is not the actor's is ignored, not trusted", async () => {
    const holdId = `h-${randomUUID()}`;
    const r = await svc('/holds', { userId: eve.id, holdId, operation: 'chat.completion', surface: 'xeno_api', amountMicro: 20_000_000, apiKeyId: capped.id });
    assert.equal(r.status, 200, "eve's hold is not limited by ada's key and does not record it");
    assert.equal((await pool.query('SELECT api_key_id FROM credit_holds WHERE hold_id = $1', [holdId])).rows[0].api_key_id, null);
  });
});
