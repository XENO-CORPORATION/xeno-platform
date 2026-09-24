import { installUsageCreditFixture, installMediaIdentityFixture, newMediaUser } from './usage-credit-fixture.mjs';
import { tablesDDL } from './fixtures/schema.mjs';
/**
 * XENO-WORKFORCE-01 FUND-09, the platform's in-process meter: a provider call that outlives its hold's TTL
 * keeps its reservation.
 *
 * The defect, measured 2026-09-24: meterPremiumChat / meterMediaGeneration hold for 900 s and
 * meterPremiumChatStream for 120 s, and none of them renewed the hold while the provider worked. A long
 * reasoning stream or slow video generation outlived that TTL, sweepExpiredHolds voided the reservation
 * on time alone, the balance became spendable elsewhere, and the eventual settle no-oped on the voided
 * hold -- the call was served and charged nothing. Every case below includes a CONTROL with the heartbeat
 * disabled that is swept, so no case can pass by the hold simply not having expired.
 *
 * Driven through the REAL meter functions against real PostgreSQL. The hold's expiry is moved to ~1 s
 * from inside the provider call -- the observable effect of a call outliving its TTL -- and the heartbeat
 * cadence is shortened through its env override so the test runs in seconds.
 *
 * Mutation-checked (each fails the named case; restored passes):
 *   - meterPremiumChat never starts the heartbeat     -> "a chat call that outlives its hold's TTL keeps its reservation"
 *   - meterMediaGeneration never starts it            -> "a media generation that outlives its hold's TTL keeps its reservation"
 *   - the stream never starts it                      -> "a stream that outlives its hold's TTL keeps its reservation"
 *   - run() never stops it                            -> "the heartbeat stops when the provider call resolves"
 *   - settle() never stops it                         -> "the stream's heartbeat stops at settle"
 *   - no lifetime cap                                 -> "a holder that never settles stops renewing at the cap"
 *
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:5432/<disposable> node tests/meter-hold-heartbeat.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import {
  meterPremiumChat, meterMediaGeneration, meterPremiumChatStream, holdHeartbeatStats,
} from '../utils/inferenceMeter.js';
import { addGrant, sweepExpiredHolds, recordUsageV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass += 1; console.log(`  ✓ ${m}`); } else { fail += 1; console.log(`  ✗ ${m}`); } };
const C = (n) => n * MICRO_PER_CREDIT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
`;

const FAST = '150';      // heartbeat cadence under test
const NEVER = '600000';  // heartbeat effectively off: the control
const setBeat = (ms) => { process.env.METER_HOLD_HEARTBEAT_MS = ms; };

const newUser = async (credits) => {
  const id = await newMediaUser(pool);
  await addGrant(pool, id, { amountMicro: C(credits), kind: 'paid', sourceRef: `seed:${id}` });
  return id;
};
const heldHold = async (uid) => (await pool.query(
  "SELECT hold_id, state FROM credit_holds WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [uid])).rows[0];
/** What a call that outlives its hold looks like: the hold's expiry is ~1 s away, then time passes. */
const outliveTheHold = async (uid) => {
  await pool.query("UPDATE credit_holds SET expires_at = now() + interval '1 second' WHERE user_id=$1 AND state='held'", [uid]);
  await sleep(1700);
  await sweepExpiredHolds(pool);
  return (await heldHold(uid)).state;
};
const chatUsage = { choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } };

async function main() {
  await pool.query(BASE);
  await pool.query(tablesDDL('api_usage_logs'));
  await migrateAccountV2(pool);
  await installUsageCreditFixture(pool);
  await installMediaIdentityFixture(pool);
  delete process.env.METER_HOLD_HEARTBEAT_MAX_MS;

  // ── chat ────────────────────────────────────────────────────────────────────────────────────
  const chat = async (uid, requestId) => {
    let during;
    const r = await meterPremiumChat(pool, uid, {
      model: 'grok-4.6', provider: 'xai', requestId, estInputTokens: 20, maxTokens: 400, surface: 'fund09',
      run: async () => { during = await outliveTheHold(uid); return chatUsage; },
    });
    return { during, charged: r.costMicro, after: (await heldHold(uid)).state };
  };
  setBeat(NEVER);
  const cc = await newUser(100);
  const control = await chat(cc, 'rq-chat-control');
  ok(control.during === 'voided' && control.charged === 0,
    `control: WITHOUT a heartbeat the same chat call's hold is swept mid-call and it is charged nothing (${control.during}, ${control.charged})`);
  setBeat(FAST);
  const uc = await newUser(100);
  const live = await chat(uc, 'rq-chat-live');
  ok(live.during === 'held' && live.after === 'settled' && live.charged > 0,
    `a chat call that outlives its hold's TTL keeps its reservation and is charged for real (during ${live.during}, after ${live.after}, charged ${live.charged})`);

  // ── media ───────────────────────────────────────────────────────────────────────────────────
  const media = async (uid, requestId) => {
    let during, competing;
    const r = await meterMediaGeneration(pool, uid, {
      surface: 'video_generation', operation: 'video.generate:test', model: 'test-video', provider: 'xeno',
      requestId, unitCostMicro: C(10), count: 1,
      run: async () => {
        during = await outliveTheHold(uid);
        competing = await recordUsageV2(pool, uid, { transactionId: `elsewhere-${requestId}`, surface: 's', operation: 'o', costMicro: C(10) })
          .then(() => 'accepted', (e) => e.code);
        return { data: [{ url: 'x' }] };
      },
    });
    return { during, competing, charged: r.costMicro };
  };
  setBeat(NEVER);
  const mc = await newUser(10);
  const mControl = await media(mc, 'rq-media-control');
  ok(mControl.during === 'voided' && mControl.competing === 'accepted' && mControl.charged === 0,
    `control: WITHOUT a heartbeat a 10-credit video's reservation lapses, the 10 credits are spent elsewhere, and the video is free (${mControl.during}, ${mControl.competing}, ${mControl.charged})`);
  setBeat(FAST);
  const um = await newUser(10);
  const mLive = await media(um, 'rq-media-live');
  ok(mLive.during === 'held' && mLive.competing === 'INSUFFICIENT_CREDITS' && mLive.charged === C(10),
    `a media generation that outlives its hold's TTL keeps its reservation: competing spend refused, the video charged 10 (${mLive.during}, ${mLive.competing}, ${mLive.charged / MICRO_PER_CREDIT})`);

  // ── stream ──────────────────────────────────────────────────────────────────────────────────
  setBeat(NEVER);
  const sc = await newUser(100);
  const ctlStream = await meterPremiumChatStream(pool, sc, { model: 'grok-4.6', provider: 'xai', requestId: 'rq-stream-control', estInputTokens: 20, maxTokens: 400 });
  const sControlDuring = await outliveTheHold(sc);
  const sControl = await ctlStream.settle({ inputTokens: 20, outputTokens: 40 });
  ok(sControlDuring === 'voided' && sControl.costMicro === 0,
    `control: WITHOUT a heartbeat a stream's 120 s hold lapses mid-stream and the stream is charged nothing (${sControlDuring}, ${sControl.costMicro})`);
  setBeat(FAST);
  const us = await newUser(100);
  const liveStream = await meterPremiumChatStream(pool, us, { model: 'grok-4.6', provider: 'xai', requestId: 'rq-stream-live', estInputTokens: 20, maxTokens: 400 });
  const sDuring = await outliveTheHold(us);
  const sLive = await liveStream.settle({ inputTokens: 20, outputTokens: 40 });
  ok(sDuring === 'held' && sLive.costMicro > 0 && (await heldHold(us)).state === 'settled',
    `a stream that outlives its hold's TTL keeps its reservation and settles for real (during ${sDuring}, charged ${sLive.costMicro})`);
  const beatsAtSettle = holdHeartbeatStats.beats;
  await sleep(600);
  ok(holdHeartbeatStats.beats === beatsAtSettle, `the stream's heartbeat stops at settle (${beatsAtSettle} -> ${holdHeartbeatStats.beats})`);

  // ── the heartbeat ends with the call ────────────────────────────────────────────────────────
  const ue = await newUser(100);
  await meterPremiumChat(pool, ue, {
    model: 'grok-4.6', provider: 'xai', requestId: 'rq-stops', estInputTokens: 20, maxTokens: 400, surface: 'fund09',
    run: async () => { await sleep(500); return chatUsage; },
  });
  const beatsAtReturn = holdHeartbeatStats.beats;
  await sleep(600);
  ok(beatsAtReturn > 0 && holdHeartbeatStats.beats === beatsAtReturn,
    `the heartbeat stops when the provider call resolves (${beatsAtReturn} -> ${holdHeartbeatStats.beats})`);

  // ── a holder that never settles is bounded ──────────────────────────────────────────────────
  process.env.METER_HOLD_HEARTBEAT_MAX_MS = '400';
  const capped = holdHeartbeatStats.capped;
  const uh = await newUser(100);
  const hung = await meterPremiumChatStream(pool, uh, { model: 'grok-4.6', provider: 'xai', requestId: 'rq-hung', estInputTokens: 20, maxTokens: 400 });
  await sleep(900);
  const beatsAtCap = holdHeartbeatStats.beats;
  await sleep(500);
  ok(holdHeartbeatStats.capped === capped + 1 && holdHeartbeatStats.beats === beatsAtCap,
    `a holder that never settles stops renewing at the cap (capped ${capped}->${holdHeartbeatStats.capped}, beats ${beatsAtCap}->${holdHeartbeatStats.beats})`);
  await hung.voidHold();
  delete process.env.METER_HOLD_HEARTBEAT_MAX_MS;

  console.log(`\n${fail === 0 ? '✅' : '❌'} meter-hold-heartbeat: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
