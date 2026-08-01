/**
 * Media metering test (Blocker #4 — entitlement holes / charge-model).
 * Exercises meterMediaGeneration against a real v2 ledger:
 *   - charges unitCost × count (batch), not a flat ×1  (the image-cost-n hole)
 *   - settles the count ACTUALLY produced (provider under-delivery releases the rest)
 *   - reserves BEFORE the provider runs → 402 on insufficient credits, provider never called
 *   - idempotent on requestId: a retry / double-click reuses the hold, charges ONCE
 *   - provider (or watermark) failure VOIDS the hold — no charge, clean journal
 *   - the hash chain stays valid across grant + settle
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/t node tests/media-metering.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { meterMediaGeneration } from '../utils/inferenceMeter.js';
import {
  addGrant, getBalanceV2, verifyChainV2, MICRO_PER_CREDIT,
} from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, owner_kind varchar(16) NOT NULL DEFAULT 'user', balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
`;

const balance = async (uid) => (await getBalanceV2(pool, uid)).availableMicro;
const heldMicro = async (uid) => Number((await pool.query(
  "SELECT COALESCE(SUM(amount_micro),0)::bigint h FROM credit_holds WHERE user_id=$1 AND state='held'", [uid],
)).rows[0].h);
const newUser = async () => (await pool.query('INSERT INTO users (credits) VALUES (0) RETURNING id')).rows[0].id;
const grant = async (uid, credits) => addGrant(pool, uid, { amountMicro: C(credits), kind: 'paid', sourceRef: `seed:${uid}` });

// A fake provider that returns `producedCount` items (OpenAI-style { data: [...] }).
const fakeRun = (producedCount) => async () => ({
  data: Array.from({ length: producedCount }, (_, i) => ({ b64_json: `img${i}` })),
  model: 'test-model',
});

const meter = (uid, opts) => meterMediaGeneration(pool, uid, {
  surface: 'image_generation', operation: 'image.generate:test', model: 'test-model', provider: 'xeno', ...opts,
});

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);

  // ── 1. cost × count (the image-cost-n hole) ────────────────────────────────
  const u1 = await newUser();
  await grant(u1, 1000);
  const r1 = await meter(u1, { requestId: 'rq-a', unitCostMicro: C(10), count: 5, run: fakeRun(5) });
  ok(await balance(u1) === C(950), 'cost×n: 5 images @ 10cr charged 50 (not a flat 10)');
  ok(r1.creditsCharged === 50, 'cost×n: creditsCharged reports 50');
  ok(r1.actualCount === 5, 'cost×n: actualCount = 5');

  // ── 2. Under-delivery: provider returns fewer than requested → charge actual ─
  const u2 = await newUser();
  await grant(u2, 1000);
  const r2 = await meter(u2, { requestId: 'rq-b', unitCostMicro: C(10), count: 5, run: fakeRun(3) });
  ok(await balance(u2) === C(970), 'under-delivery: requested 5, produced 3 → charged 30 (remainder released)');
  ok(r2.actualCount === 3, 'under-delivery: actualCount = 3');
  ok(await heldMicro(u2) === 0, 'under-delivery: no dangling hold (settled hold released)');

  // ── 2b. Non-array / missing provider payload → nothing usable → charge 0 ────
  const u2b = await newUser();
  await grant(u2b, 100);
  const r2b = await meter(u2b, { requestId: 'rq-nonarray', unitCostMicro: C(10), count: 3, run: async () => ({ data: null, model: 'm' }) });
  ok(await balance(u2b) === C(100), 'non-array payload: charged 0, no overcharge for zero delivered (MEDIA-METER-3)');
  ok(r2b.actualCount === 0, 'non-array payload: actualCount = 0');

  // ── 3. Reserve BEFORE provider: insufficient credits → 402, provider never runs ─
  const u3 = await newUser();
  await grant(u3, 30);
  let ran = false;
  let threw402 = false;
  try {
    await meter(u3, { requestId: 'rq-c', unitCostMicro: C(10), count: 5, run: async () => { ran = true; return fakeRun(5)(); } });
  } catch (e) { threw402 = e.http === 402; }
  ok(threw402, 'reserve-first: total 50 > balance 30 → throws err.http=402');
  ok(ran === false, 'reserve-first: provider NEVER called on insufficient credits (no wasted spend)');
  ok(await balance(u3) === C(30), 'reserve-first: balance unchanged after 402');

  // ── 4. Idempotency: a REUSED requestId is rejected (409), provider NOT re-run ─
  const u4 = await newUser();
  await grant(u4, 1000);
  const idemOpts = { requestId: 'rq-idem', unitCostMicro: C(10), count: 5, run: fakeRun(5) };
  await meter(u4, { ...idemOpts });
  ok(await balance(u4) === C(950), 'idempotency: first call charged 50');

  // Replay with the SAME requestId must NOT silently re-run the provider for free.
  let dup409 = false, providerReran = false;
  try {
    await meter(u4, { ...idemOpts, run: async () => { providerReran = true; return fakeRun(5)(); } });
  } catch (e) { dup409 = e.http === 409; }
  ok(dup409, 'idempotency: reused requestId REJECTED with 409 (not silently re-run)');
  ok(providerReran === false, 'idempotency: provider NOT re-invoked on reuse — no free generation (MEDIA-METER-1)');
  ok(await balance(u4) === C(950), 'idempotency: balance unchanged after duplicate rejection (still 950)');

  // A reused key after a VOIDED (failed) attempt is ALSO rejected — closes the void-path free gen (F3).
  const u4b = await newUser();
  await grant(u4b, 1000);
  try { await meter(u4b, { requestId: 'rq-void', unitCostMicro: C(10), count: 1, run: async () => { throw new Error('provider 500'); } }); } catch { /* expected */ }
  let dupAfterVoid = false;
  try { await meter(u4b, { requestId: 'rq-void', unitCostMicro: C(10), count: 1, run: fakeRun(1) }); } catch (e) { dupAfterVoid = e.http === 409; }
  ok(dupAfterVoid, 'idempotency: reused key after a VOID is rejected — no free success-after-failure (F3)');

  // Distinct requestId DOES charge again (proves the hold key is per-request).
  await meter(u4, { ...idemOpts, requestId: 'rq-idem-2' });
  ok(await balance(u4) === C(900), 'idempotency: a DIFFERENT requestId charges again (900)');

  // ── 5. Provider failure → void the hold, no charge, no dangling reservation ─
  const u5 = await newUser();
  await grant(u5, 1000);
  let providerThrew = false;
  try {
    await meter(u5, { requestId: 'rq-fail', unitCostMicro: C(10), count: 5, run: async () => { throw new Error('provider 500'); } });
  } catch { providerThrew = true; }
  ok(providerThrew, 'provider-fail: error bubbles to the route');
  ok(await balance(u5) === C(1000), 'provider-fail: hold VOIDED, balance unchanged (no deduct-then-refund)');
  ok(await heldMicro(u5) === 0, 'provider-fail: hold released (no phantom reservation)');

  // ── 6. Fail-closed watermark: a throw INSIDE run() (e.g. video watermark) voids ─
  const u6 = await newUser();
  await grant(u6, 1000);
  let wmThrew = false;
  try {
    await meter(u6, {
      requestId: 'rq-wm', unitCostMicro: C(100), count: 1,
      run: async () => {
        const result = await fakeRun(1)(); // provider succeeded
        throw new Error('watermark failed'); // ...but watermark did not → fail closed
        return result; // eslint-disable-line no-unreachable
      },
    });
  } catch { wmThrew = true; }
  ok(wmThrew, 'fail-closed: watermark failure surfaces as an error');
  ok(await balance(u6) === C(1000), 'fail-closed: NOT charged when the video could not be watermarked (no clean-video leak)');

  // ── 7. Hash chain stays valid across grant + settle ────────────────────────
  const chain = await verifyChainV2(pool, u1);
  ok(chain.ok, `chain: verifyChainV2 ok across grant+settle (entries=${chain.entries})`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} media-metering: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
