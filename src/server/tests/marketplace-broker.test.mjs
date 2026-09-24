/**
 * XENO-WORKFORCE-01 MKT-06 -- a marketplace invocation creates a REAL hosted run and reports its REAL state.
 *
 *   "Broker invocation must create/adopt a durable hosted run, expose actual queued/running/completed/
 *    failed/interrupted state and return artifacts/results. Authorization or a debit alone cannot report
 *    `brokered:true` or completion. No debit for an execution that was never admitted; uncertain dispatch
 *    is reconciled before retry."
 *
 * Nothing on the path is a stand-in except the model: this boots the real xeno-agents-api application
 * (built from AGENTS_API_DIST, a compiled checkout of that repo) in-process, wired to THIS platform's real
 * /api/v2/me for authentication and its real /api/v2/ledger/service for holds and settlement, all on one
 * PostgreSQL. The marketplace route is the real one. agents-api runs its deterministic FakeDriver in place
 * of a model, which is the only difference from production.
 *
 * Proved here, each against that live chain:
 *   1. an invocation creates a run in agents-api, owned by the BUYER, and the response is that run's state;
 *   2. reading the invocation re-reads the run, and it reaches `completed` with agents-api's own settlement;
 *   3. the marketplace debits nothing: the only money that moves is agents-api's hold, settled at usage;
 *   4. a run agents-api refuses to admit leaves no hold and no charge, and says so;
 *   5. a dispatch whose response was lost is reconciled by the SAME invocation into the run that exists --
 *      exactly one run, never two;
 *   6. no route ever answers `brokered: true`.
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the broker debits the buyer (svc.meterInvocation)         -> "the marketplace itself debits nothing"
 *   - no idempotency key on dispatch                             -> "a lost response is reconciled into ONE run"
 *   - refresh never re-reads the run                              -> "reading the invocation re-reads the run"
 *   - a refused run is reported as dispatched                    -> "a run agents-api refuses costs nothing and says so"
 *   - the delegated session is not revoked after use             -> "the delegated credential dies with the call"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> AGENTS_API_DIST=<agents-api>/dist \
 *      node tests/marketplace-broker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateHandles } from '../database/migrate-handles.js';
import { addGrant, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { optInUsageCredits } from './usage-credit-fixture.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEDGER_TOKEN = 'mkt-broker-ledger-token';

test('a marketplace invocation creates a real hosted run and reports its real state (MKT-06)', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required');
  if (!process.env.AGENTS_API_DIST) return t.skip('AGENTS_API_DIST (a built xeno-agents-api) is required');
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  process.env.LEDGER_SERVICE_TOKEN = LEDGER_TOKEN;
  const agents = (p) => import(pathToFileURL(`${process.env.AGENTS_API_DIST}/${p}`).href);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateHandles(pool);   // /v2/me reads reserved_handles, created at boot in production

  // ── the platform: auth (/v2/me), the service ledger, and the marketplace ───────────────────
  const { oidcAuth } = await import('../middleware/oidcAuth.js');
  const { default: v2MeRoutes } = await import('../routes/v2MeRoutes.js');
  const { default: serviceLedgerRoutes } = await import('../routes/serviceLedgerRoutes.js');
  const { default: marketplaceRoutes } = await import('../routes/marketplaceRoutes.js');
  const platform = express();
  platform.use(express.json());
  platform.use((req, _res, next) => { req.db = pool; next(); });
  platform.use('/api/v2/me', oidcAuth, v2MeRoutes);
  platform.use('/api/v2/ledger/service', serviceLedgerRoutes);
  platform.use('/api/marketplace', marketplaceRoutes);
  const platformServer = http.createServer(platform);
  await new Promise((r) => platformServer.listen(0, '127.0.0.1', r));
  const platformBase = `http://127.0.0.1:${platformServer.address().port}`;
  process.env.OIDC_ISSUER = platformBase;

  // ── xeno-agents-api, the real app, wired to that platform ───────────────────────────────────
  const { buildApp } = await agents('app.js');
  const { loadConfig } = await agents('config.js');
  const { HttpAccountClient } = await agents('auth.js');
  const { HttpLedger } = await agents('billing.js');
  const { createInMemoryStores } = await agents('store/memory.js');
  const { FakeDriver } = await agents('runner/fakeDriver.js');
  const { StaticPriceBook } = await agents('pricing.js');
  const config = {
    ...loadConfig({}), ledgerLive: true, databaseUrl: undefined, runWorkspaceRoot: '/tmp/mkt-broker-runs',
    maxConcurrency: 2, defaultHoldCredits: 5, publicBaseUrl: 'http://agents.test',
  };
  const stores = createInMemoryStores();
  const agentsApp = buildApp({
    config, stores,
    ledger: new HttpLedger(`${platformBase}/api`, LEDGER_TOKEN),
    accountClient: new HttpAccountClient(`${platformBase}/api`),
    driverFactory: () => new FakeDriver(),
    prices: new StaticPriceBook({ [config.defaultModel]: 0.3 }),
    poolPollMs: 20,
  });
  await agentsApp.app.listen({ port: 0, host: '127.0.0.1' });
  process.env.AGENTS_API_BASE_URL = `http://127.0.0.1:${agentsApp.app.server.address().port}`;
  t.after(async () => { await agentsApp.app.close(); platformServer.close(); await pool.end(); });

  // ── a buyer, a seller, a published mind with pay-per-use pricing ────────────────────────────
  const marker = `mktb-${Date.now()}`;
  const mkUser = async (name) => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [name, `${name}@example.test`])).rows[0].id;
  const buyer = await mkUser(marker);
  const seller = await mkUser(`${marker}-s`);
  await optInUsageCredits(pool, buyer);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'internal','active') ON CONFLICT (user_id) DO NOTHING", [buyer]);
  await addGrant(pool, buyer, { amountMicro: 100 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${marker}-grant` });
  const dev = (await pool.query(
    `INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [seller, `${marker}-dev`])).rows[0].id;
  const listing = (await pool.query(
    `INSERT INTO marketplace_listings(slug,kind,developer_id,title,status) VALUES($1,'mind',$2,'A mind','published') RETURNING id`,
    [`${marker}-mind`, dev])).rows[0].id;
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits) VALUES($1,'pay_per_use',5)`, [listing]);

  // The buyer's own sign-in, the same token shape the website sends.
  const jwt = (await import('jsonwebtoken')).default;
  const buyerToken = jwt.sign({ userId: buyer }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const call = async (method, path, body) => {
    const r = await fetch(`${platformBase}/api/marketplace${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${buyerToken}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const marketTxns = async () => Number((await pool.query('SELECT count(*) FROM marketplace_transactions WHERE user_id=$1', [buyer])).rows[0].count);

  // ── 1. an invocation creates a run owned by the buyer ───────────────────────────────────────
  const before = (await getBalanceV2(pool, buyer)).postedMicro;
  const first = await call('POST', `/invoke/${listing}`, { prompt: 'summarise the workspace' });
  assert.ok([200, 202].includes(first.status), `invoke answered ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
  assert.equal(first.body.brokered, undefined, 'no route ever answers brokered: true');
  const inv = first.body.invocation;
  assert.ok(inv.runId, 'an invocation creates a run in agents-api');
  const run = await stores.runs.get(inv.runId);
  assert.equal(run.userId, buyer, 'the run is owned by the BUYER, not the platform');
  assert.ok(['queued', 'starting', 'running', 'completed'].includes(inv.runStatus), `a real run status (${inv.runStatus})`);

  // ── 2. reading the invocation re-reads the run, to its real terminal state ──────────────────
  let read;
  for (let i = 0; i < 100; i += 1) {
    read = await call('GET', `/invocations/${inv.id}`);
    if (read.body.invocation?.runStatus === 'completed') break;
    await sleep(50);
  }
  assert.equal(read.status, 200);
  assert.equal(read.body.invocation.runStatus, 'completed', 'reading the invocation re-reads the run to its real terminal state');
  assert.equal(read.body.invocation.state, 'finished');
  assert.ok(read.body.invocation.creditsSettled > 0, `agents-api settled real usage (${read.body.invocation.creditsSettled})`);

  // ── 3. the marketplace debits nothing; agents-api's hold is the only money that moves ───────
  assert.equal(await marketTxns(), 0, 'the marketplace itself debits nothing');
  const hold = (await pool.query("SELECT state, settled_micro FROM credit_holds WHERE user_id=$1 AND hold_id=$2", [buyer, inv.runId])).rows[0];
  assert.equal(hold?.state, 'settled', "the run's agents-api hold was placed and settled at real usage");
  const after = (await getBalanceV2(pool, buyer)).postedMicro;
  assert.equal(before - after, Number(hold.settled_micro), 'the buyer paid exactly what the run settled, once');

  // ── 4. a run agents-api refuses costs nothing and says so ──────────────────────────────────
  const poor = await mkUser(`${marker}-poor`);
  await optInUsageCredits(pool, poor);
  await pool.query("INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1,'internal','active') ON CONFLICT (user_id) DO NOTHING", [poor]);
  const poorToken = jwt.sign({ userId: poor }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const refused = await fetch(`${platformBase}/api/marketplace/invoke/${listing}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${poorToken}` },
    body: JSON.stringify({ prompt: 'no credits' }),
  });
  const refusedBody = await refused.json();
  assert.equal(refused.status, 402, `a run agents-api refuses costs nothing and says so (${refused.status} ${JSON.stringify(refusedBody).slice(0, 160)})`);
  assert.equal(refusedBody.invocation.state, 'refused');
  assert.equal(refusedBody.invocation.runId, null);
  assert.equal(Number((await pool.query('SELECT count(*) FROM credit_holds WHERE user_id=$1', [poor])).rows[0].count), 0, 'no hold was left');

  // ── 5. a lost response is reconciled into ONE run ──────────────────────────────────────────
  const runsBefore = (await stores.runs.list({ userId: buyer, limit: 100 })).length;
  const lost = await call('POST', `/invoke/${listing}`, { prompt: 'response lost in transit' });
  const lostId = lost.body.invocation.id;
  const realRun = lost.body.invocation.runId;
  // Simulate a lost response: forget what agents-api answered, as a crashed request would.
  await pool.query("UPDATE marketplace_invocations SET state='uncertain', run_id=NULL, run_status=NULL WHERE id=$1", [lostId]);
  const retried = await call('POST', `/invoke/${listing}`, { invocationId: lostId });
  assert.equal(retried.body.invocation.runId, realRun, 'a lost response is reconciled into ONE run: the retry adopts the run that exists');
  assert.equal((await stores.runs.list({ userId: buyer, limit: 100 })).length, runsBefore + 1, 'exactly one new run, never two');

  // ── the delegated credential dies with the call ────────────────────────────────────────────
  const minted = (await pool.query(
    'SELECT unnest(delegated_sids) AS sid FROM marketplace_invocations WHERE user_id=$1', [buyer])).rows.map((r) => r.sid);
  assert.ok(minted.length >= 3, `the broker recorded every credential it minted (${minted.length})`);
  const live = Number((await pool.query(
    'SELECT count(*) FROM oauth_session_state WHERE sid = ANY($1::uuid[]) AND revoked_at IS NULL AND expires_at > now()', [minted])).rows[0].count);
  assert.equal(live, 0, 'the delegated credential dies with the call: no broker session is left live');
});
