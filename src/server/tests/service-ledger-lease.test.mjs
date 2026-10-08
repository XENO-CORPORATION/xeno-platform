/**
 * service-ledger-lease.test.mjs — the SERVICE hold route, leased, against PostgreSQL over HTTP.
 *
 * Decision: XENO ADMISSION - LEASE DECISION.md (correction 2026-10-09). The gateway's chat hold calls this route with
 * pricing.maxOutputTokens. Before this change the route reserved the full requested ceiling, so a funded account
 * that could not pay for the whole ceiling was refused, although the platform's own chat meter grants what the account
 * can fund. A hold with pricing.lease === true now reserves through the same lease path the meter uses.
 *
 * Gated like every workforce proof: TEST_DATABASE_URL must name a disposable xeno_qual_<32 hex> database.
 *
 * Mutation checks (each verified to fail the named test):
 *   - ignore pricing.lease and reserve the fixed ceiling            -> "a leased hold reserves the largest ceiling"
 *   - report the requested ceiling instead of the reserved grant    -> "a leased hold reserves the largest ceiling"
 *   - reserve again when the holdId replays                         -> "a replayed leased hold returns the same grant"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from '../../../scripts/lib/workforce-proof-database.mjs';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import * as ledger from '../utils/creditLedgerV2.js';
import { ensureQuota } from '../services/quotaService.js';
import { getEffectivePlan } from '../services/effectivePlan.js';
import { grantedOutputTokensForAmount } from '../utils/admissionLease.js';
import { estimateChatCostMicro } from '../utils/creditCosts.js';
import serviceRouter from '../routes/serviceLedgerRoutes.js';

const url = process.env.TEST_DATABASE_URL;
if (url) requireProofDatabase(url);

const TOKEN = `lease-test-${randomUUID()}`;
process.env.LEDGER_SERVICE_TOKEN = TOKEN;

const MODEL = 'gpt-6.1-sol';
const INPUT = 13_600;
const REQUESTED = 32_000;

test('the service hold route, leased, against PostgreSQL', { skip: !url, timeout: 300000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  const app = express();
  app.use(express.json());
  app.use('/api/v2/ledger/service', (r, _res, next) => { r.db = pool; next(); }, serviceRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v2/ledger/service`;
  t.after(async () => { server.close(); await pool.end(); });

  async function post(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function newUser() {
    const handle = `lease_${randomUUID().slice(0, 12)}`;
    const { rows } = await pool.query(
      // A verified mailbox: the free allowance is refused to an unverified one (EMAIL_UNVERIFIED, see quotaService).
      'INSERT INTO users (username, email, password_hash, display_name, credits, email_verified) VALUES ($1,$2,$3,$1,$4,true) RETURNING id',
      [handle, `${handle}@lease.invalid`, 'fixture-not-a-login', 0],
    );
    return rows[0].id;
  }

  // The route issues the plan's allowance before it holds. A test reads the same balance the same way.
  async function fundAsTheRouteWould(userId) {
    await ensureQuota(pool, userId, (await getEffectivePlan(pool, userId)).plan);
    return Number((await ledger.getBalanceV2(pool, userId)).availableMicro);
  }

  const holdCount = async (userId, holdId) => Number((await pool.query(
    'SELECT count(*)::int n FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [userId, holdId])).rows[0].n);

  const leasedBody = (userId, holdId, extra = {}) => ({
    userId, holdId, operation: 'chat.completion', surface: 'lease-test',
    pricing: { model: MODEL, estInputTokens: INPUT, maxOutputTokens: REQUESTED, lease: true },
    ...extra,
  });

  await t.test('a leased hold reserves the largest ceiling the account can fund, and reports the grant it reserved', async () => {
    const userId = await newUser();
    const available = await fundAsTheRouteWould(userId);
    const holdId = `lease-${randomUUID()}`;
    const { status, json } = await post('/holds', leasedBody(userId, holdId));
    assert.equal(status, 200, JSON.stringify(json));

    const expected = grantedOutputTokensForAmount({ amountMicro: available, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
    assert.ok(expected > 4096 && expected < REQUESTED, `the account funds part of the ceiling (granted ${expected})`);
    assert.equal(json.grantedOutputTokens, expected, 'the response reports the grant the account can fund');
    assert.equal(json.requestedOutputTokens, REQUESTED, 'the response still names what was asked');
    assert.ok(Number(json.amountMicro) <= available, 'the reservation fits the balance');
    assert.equal(
      grantedOutputTokensForAmount({ amountMicro: Number(json.amountMicro), model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }),
      expected,
      'the grant is exactly what the reservation funds',
    );
    assert.equal(Number(json.amountMicro), estimateChatCostMicro(MODEL, { inputTokens: INPUT, maxOutputTokens: expected }),
      'the reservation is the cost of the granted ceiling, priced by the platform table');
    assert.equal(Number((await ledger.getBalanceV2(pool, userId)).availableMicro), available - Number(json.amountMicro));
  });

  await t.test('the same request without the lease is refused when the account cannot fund the full ceiling', async () => {
    const userId = await newUser();
    await fundAsTheRouteWould(userId);
    const { status, json } = await post('/holds', {
      userId, holdId: `fixed-${randomUUID()}`, operation: 'chat.completion', surface: 'lease-test',
      pricing: { model: MODEL, estInputTokens: INPUT, maxOutputTokens: REQUESTED },
    });
    assert.equal(status, 402, 'the fixed reservation of the whole ceiling is refused, as before');
    assert.match(JSON.stringify(json), /INSUFFICIENT_CREDITS|QUOTA_EXCEEDED/);
  });

  await t.test('a replayed leased hold returns the same grant and reserves once', async () => {
    const userId = await newUser();
    await fundAsTheRouteWould(userId);
    const holdId = `lease-${randomUUID()}`;
    const first = await post('/holds', leasedBody(userId, holdId));
    const second = await post('/holds', leasedBody(userId, holdId));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(second.json.grantedOutputTokens, first.json.grantedOutputTokens, 'the replay reports the same grant');
    assert.equal(Number(second.json.amountMicro), Number(first.json.amountMicro), 'the replay reserves the same amount');
    assert.equal(await holdCount(userId, holdId), 1, 'the hold row exists once');
  });

  await t.test('a leased hold whose input the account cannot fund at all is refused and reserves nothing', async () => {
    const userId = await newUser();
    await fundAsTheRouteWould(userId);
    const holdId = `lease-${randomUUID()}`;
    const { status } = await post('/holds', leasedBody(userId, holdId, {
      pricing: { model: MODEL, estInputTokens: 2_000_000, maxOutputTokens: REQUESTED, lease: true },
    }));
    assert.equal(status, 402);
    assert.equal(await holdCount(userId, holdId), 0, 'nothing is reserved when the lease refuses');
  });

  await t.test('a leased hold cannot also carry a legacy amountMicro', async () => {
    const userId = await newUser();
    await fundAsTheRouteWould(userId);
    const { status, json } = await post('/holds', leasedBody(userId, `lease-${randomUUID()}`, { amountMicro: 1_000_000 }));
    assert.equal(status, 400);
    assert.match(JSON.stringify(json), /either pricing or amountMicro/);
  });
});
