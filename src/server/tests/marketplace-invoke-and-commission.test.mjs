/**
 * Marketplace money boundaries, against real PostgreSQL through the REAL marketplace router.
 *
 *   1. POST /api/marketplace/invoke never debits. Until 2026-09-24 it answered `brokered: true` with no
 *      dispatch and, on the pay_per_use branch, debited the buyer and accrued creator earnings -- what
 *      XENO-WORKFORCE-01 MKT-06 forbids ("no debit for an execution that was never admitted"). It then
 *      refused with 501 rather than lie, and since the broker landed it creates a real hosted run in
 *      xeno-agents-api; the money is that run's ledger hold, settled by agents-api at real usage, and
 *      this route still debits nothing of its own. Here AGENTS_API_BASE_URL is deliberately unset, so
 *      the route reports `broker_unavailable` -- which is the honest answer when no broker is reachable,
 *      and keeps this suite free of a second service. The brokered path is marketplace-broker.test.mjs.
 *   2. The platform commission is the locked D07 15%, as floor(gross * 15 / 100), and 0 for
 *      first-party / official listings. It used to default to 25% and round up per transaction.
 *
 * Not cited as MKT-06 (that is marketplace-broker.test.mjs, which drives the real hosted run) nor as
 * FUND-15/19, which also cover contributions, gifts and cumulative per-item billing that do not exist.
 *
 * Measured against UNMODIFIED origin/main before the repair, on a freshly migrated database: the old
 * route debited the buyer 15 credits (units 3 x 5) through the ledger, then died inserting into
 * `credit_usage` -- a table no migration creates; production has it only from pre-migration setup --
 * answered 500 "Failed to invoke", and left the debit in place (a `xeno.usage` debit row, a
 * `marketplace_transactions` row, no refund). So on any database built from the migrations the old
 * route charged for nothing AND reported failure. This suite fails 5/8 against that code.
 *
 * Mutation-checked (each fails the named case; restored passes):
 *   - the route meters again (svc.meterInvocation)       -> "invoke debits nothing and records nothing"
 *   - commission back to 25                               -> "commission is 15% of gross, floored"
 *   - Math.round instead of Math.floor                    -> "commission is 15% of gross, floored"
 *   - first-party listings charged                        -> "first-party and official listings pay no commission"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/marketplace-invoke-and-commission.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { addGrant, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { optInUsageCredits } from './usage-credit-fixture.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const { commissionFor, PLATFORM_COMMISSION_PCT } = await import('../services/marketplaceService.js');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass += 1; console.log(`  ✓ ${m}`); } else { fail += 1; console.log(`  ✗ ${m}`); } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);

  // ── 2. commission arithmetic, pure ─────────────────────────────────────────────────────────
  const thirdParty = { developer_id: crypto.randomUUID(), trust_tier: 'community', is_first_party: false };
  ok(PLATFORM_COMMISSION_PCT === 15, `commission defaults to the locked D07 15% (got ${PLATFORM_COMMISSION_PCT})`);
  const cases = [[100, 15, 85], [7, 1, 6], [3, 0, 3], [99, 14, 85], [1000, 150, 850]];
  ok(cases.every(([gross, fee, net]) => {
    const r = commissionFor(thirdParty, gross);
    return r.platformFee === fee && r.creatorNet === net && r.platformFee + r.creatorNet === gross;
  }), 'commission is 15% of gross, floored, and fee + net always equals gross');
  ok([{ ...thirdParty, is_first_party: true }, { ...thirdParty, trust_tier: 'official' }, { ...thirdParty, developer_id: null }]
    .every((l) => commissionFor(l, 100).platformFee === 0 && commissionFor(l, 100).creatorNet === 100),
  'first-party and official listings pay no commission');

  // ── 1. invoke, through the real router ─────────────────────────────────────────────────────
  const marker = `mkt-${Date.now()}`;
  const buyer = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [marker, `${marker}@example.test`])).rows[0].id;
  const seller = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [`${marker}-s`, `${marker}-s@example.test`])).rows[0].id;
  await optInUsageCredits(pool, buyer);
  await addGrant(pool, buyer, { amountMicro: 100 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${marker}-grant` });
  const dev = (await pool.query(
    `INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Seller',$2) RETURNING id`, [seller, `${marker}-dev`])).rows[0].id;
  const listing = (await pool.query(
    `INSERT INTO marketplace_listings(slug,kind,developer_id,title,status) VALUES($1,'mind',$2,'A mind','published') RETURNING id`,
    [`${marker}-mind`, dev])).rows[0].id;
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits) VALUES($1,'pay_per_use',5)`, [listing]);

  const { default: marketplaceRoutes } = await import('../routes/marketplaceRoutes.js');
  const app = express();
  app.use(express.json());
  // authMiddleware reads a JWT; the fixture signs one for the buyer, exactly as a real client would.
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ id: buyer, userId: buyer, email: `${marker}@example.test` }, process.env.JWT_SECRET, { expiresIn: '5m' });
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const invoke = async (id) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/marketplace/invoke/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: "run the mind" }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  try {
    const before = (await getBalanceV2(pool, buyer)).availableMicro;
    const txBefore = Number((await pool.query('SELECT count(*) FROM marketplace_transactions')).rows[0].count);
    const r = await invoke(listing);
    ok(r.status === 503 && r.body.error === 'broker_unavailable' && r.body.dispatched === false
      && r.body.charged === 0 && !('brokered' in r.body),
    `with no broker configured, invoke says so and nothing ran (got ${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
    const after = (await getBalanceV2(pool, buyer)).availableMicro;
    const txAfter = Number((await pool.query('SELECT count(*) FROM marketplace_transactions')).rows[0].count);
    const earnings = Number((await pool.query('SELECT count(*) FROM marketplace_creator_earnings WHERE developer_id=$1', [dev])).rows[0].count);
    ok(after === before && txAfter === txBefore && earnings === 0,
      `invoke debits nothing and records nothing (balance ${before}->${after}, transactions ${txBefore}->${txAfter}, earnings ${earnings})`);

    // Access checks still refuse what they refused before: no pricing and no entitlement -> 402.
    const unpriced = (await pool.query(
      `INSERT INTO marketplace_listings(slug,kind,developer_id,title,status) VALUES($1,'mind',$2,'Unpriced','published') RETURNING id`,
      [`${marker}-unpriced`, dev])).rows[0].id;
    ok((await invoke(unpriced)).status === 402, 'a listing with no entitlement and no pay-per-use price is still refused 402');
    ok((await invoke(crypto.randomUUID())).status === 404, 'an unknown listing is still 404');
  } finally {
    // Drop fetch's keep-alive sockets and wait for the close, rather than leaving it in flight.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} marketplace-invoke-and-commission: ${pass} passed, ${fail} failed`);
  await pool.end();
  /* Let the process END rather than calling process.exit() here. An immediate exit tore
   * libuv down while handles were still closing, and on Windows that aborted the process
   * AFTER all seven tests had passed (`Assertion failed: !(handle->flags &
   * UV_HANDLE_CLOSING), src\win\async.c`) — exit 127, a green suite reported red, on
   * main as well as on branches. The unref'd timer is only a backstop: it cannot keep the
   * process alive, and fires only if some handle would otherwise hang it. */
  process.exitCode = fail === 0 ? 0 : 1;
  setTimeout(() => process.exit(process.exitCode), 5000).unref();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
