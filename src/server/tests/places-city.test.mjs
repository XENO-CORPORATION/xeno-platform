/**
 * XENO Places City (migration 20261027090000 + services/placesCity.js), on real Postgres:
 *   - the layout is the handoff's layout.js: 48 lots, 10 sponsor slots, Commons 0, corner lots ×1.25;
 *   - city.lease: owner/admin only, contiguous lots of one row, zoning (max floors, bays fit), one lease per building,
 *     one tenant per lot (the partial unique index), and the FIRST MONTH is charged exactly on the credits ledger —
 *     a retry replays and charges nothing; too few credits refuses and leaves no lease;
 *   - city.expand needs the revision and an adjacent lot; city.release frees the lots (no refund);
 *   - city.bill (operator only) charges due leases once per period, lapses then ends an unpaid one;
 *   - city.facade.set: admin only, expectedRevision, logo sanitised;
 *   - sponsorship: Commons has no slots; a booking holds credits and waits for a steward; the booker cannot review it
 *     (also a DB CHECK); reject refunds exactly; live copy is labelled and shown only to an adult-attested account;
 *   - DOWN drops the five tables; UP again is clean.
 *
 * Run: DATABASE_URL=postgresql://… node tests/places-city.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { addGrant, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import * as places from '../services/places.js';
import { LOTS, SLOTS, lotPriceMicro, lotById } from '../services/placesCity.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261027090000-places-city.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `pc${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, name, role = 'user', kind = 'human') => ({ id, name, kind, role });
const workspace = async (owner, name) => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const placeOf = async (w) => (await pool.query(`SELECT * FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows[0];
const CODES = new Set(places.CODES);
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected a refusal (${reason}), got ${JSON.stringify(r.result)}`); assert.ok(CODES.has(r.error.code)); assert.equal(r.error.code, code); if (reason) assert.equal(r.error.reason, reason); };
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.error)); return r.result; };
const charges = async (u) => (await pool.query(`SELECT -amount::bigint AS m FROM credit_transactions WHERE user_id=$1 AND reference_id LIKE 'places-%' AND amount < 0 ORDER BY created_at`, [u])).rows.map((r) => Number(r.m));
const refunds = async (u) => (await pool.query(`SELECT amount::bigint AS m FROM credit_transactions WHERE user_id=$1 AND amount > 0 AND reference_id LIKE 'places-sponsor:%'`, [u])).rows.map((r) => Number(r.m));

async function main() {
  await runAllMigrations(pool);
  await pool.query(DOWN); await pool.query(UP);
  assert.deepEqual([LOTS.length, SLOTS.length, SLOTS.filter((s) => s.district === 'commons').length], [48, 10, 0], 'the handoff layout: 48 lots, 10 slots, none in Commons');
  assert.deepEqual([lotPriceMicro(lotById['studio-00']), lotPriceMicro(lotById['studio-01'])], [12_500_000, 10_000_000], 'a corner lot costs ×1.25');

  const owner = await user('owner'), member = await user('member'), rival = await user('rival'), op = await user('op'), stew = await user('stew'), poor = await user('poor');
  for (const u of [owner, rival, stew]) await pool.query('INSERT INTO usage_credit_preferences (user_id, enabled) VALUES ($1, true) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [u]);
  for (const u of [owner, rival, stew]) await addGrant(pool, u, { amountMicro: 500 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${tag}-g-${u}` });
  const co = await workspace(owner, 'Co');
  await writeTuples(pool, { writes: [{ object: `workspace:${co}`, subject: `user:${member}`, relation: 'editor' }] });
  const pCo = await placeOf(co);
  const O = me(owner, 'Owner'), OP = me(op, 'Op', 'admin');
  const rivalWs = await workspace(rival, 'Rival'); const pRival = await placeOf(rivalWs);
  await pool.query(`UPDATE places SET city_id=$2 WHERE id=$1`, [pRival.id, pCo.city_id]);

  // ── lease: who, which lots, zoning, money ──
  refused(await places.call(pool, me(member, 'M'), 'city.lease', { placeId: pCo.id, lotIds: ['studio-01'], requestId: rid() }), 'denied', 'not_admin');
  refused(await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['studio-01', 'studio-03'], requestId: rid() }), 'bad_input', 'lots_not_contiguous');
  refused(await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['studio-01', 'studio-11'], requestId: rid() }), 'bad_input', 'lots_not_contiguous');
  for (const k of ['a', 'b', 'c', 'd']) await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name, created_by_user_id) VALUES ($1,$2,$2,$3)`, [co, k, owner]);
  refused(await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['commons-01'], requestId: rid() }), 'needs_approval', 'too_tall');
  const key = rid();
  const lease = ok(await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['studio-01'], requestId: key }));
  assert.equal(lease.monthlyMicro, 10_000_000);
  assert.deepEqual(await charges(owner), [10_000_000], 'the first month is charged exactly, on the ledger');
  const again = await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['studio-01'], requestId: key });
  assert.ok(again.ok && again.receipt.replayed);
  assert.deepEqual(await charges(owner), [10_000_000], 'a retry charges nothing');
  refused(await places.call(pool, O, 'city.lease', { placeId: pCo.id, lotIds: ['studio-02'], requestId: rid() }), 'conflict', 'already_placed');
  refused(await places.call(pool, me(rival, 'R'), 'city.lease', { placeId: pRival.id, lotIds: ['studio-01'], requestId: rid() }), 'conflict', 'lot_taken');
  assert.equal((await pool.query('SELECT count(*)::int n FROM place_city_leases WHERE place_id=$1', [pRival.id])).rows[0].n, 0, 'a refused lease leaves nothing');
  const poorWs = await workspace(poor, 'Poor'); const pPoor = await placeOf(poorWs);
  refused(await places.call(pool, me(poor, 'P'), 'city.lease', { placeId: pPoor.id, lotIds: ['market-00', 'market-01', 'market-02', 'market-03'], requestId: rid() }), 'denied', 'insufficient_credits');
  assert.equal((await pool.query('SELECT count(*)::int n FROM place_city_leases WHERE place_id=$1', [pPoor.id])).rows[0].n, 0, 'an unpaid lease is rolled back');

  // ── city.get: the building stands; a non-member sees no lease price ──
  const view = ok(await places.call(pool, O, 'city.get', { cityId: pCo.city_id }));
  const b = view.buildings.find((x) => x.placeId === pCo.id);
  assert.deepEqual([b.lotIds, b.floors, b.canEdit, b.monthlyMicro], [['studio-01'], 5, true, 10_000_000]);
  assert.equal(view.lots.find((l) => l.id === 'studio-01').leaseId, lease.leaseId);
  const rv = ok(await places.call(pool, me(rival, 'R'), 'city.get', { cityId: pCo.city_id })).buildings.find((x) => x.placeId === pCo.id);
  assert.deepEqual([rv.canOpen, rv.canEdit, rv.monthlyMicro, rv.paidThrough], [false, false, null, null], 'strangers see the building, never its lease terms');

  // ── expand, release ──
  refused(await places.call(pool, O, 'city.expand', { leaseId: lease.leaseId, lotId: 'studio-02', expectedRevision: 99, requestId: rid() }), 'conflict', 'stale_revision');
  refused(await places.call(pool, O, 'city.expand', { leaseId: lease.leaseId, lotId: 'studio-03', expectedRevision: b.revision, requestId: rid() }), 'bad_input', 'not_adjacent');
  const ex = ok(await places.call(pool, O, 'city.expand', { leaseId: lease.leaseId, lotId: 'studio-02', expectedRevision: b.revision, requestId: rid() }));
  assert.deepEqual([ex.lotIds, ex.monthlyMicro], [['studio-01', 'studio-02'], 20_000_000]);
  assert.deepEqual(await charges(owner), [10_000_000, 10_000_000]);

  // ── the month: operator only, once per period, lapse then end ──
  refused(await places.call(pool, O, 'city.bill', { requestId: rid() }), 'denied', 'operator_only');
  await pool.query(`UPDATE place_city_leases SET paid_through=now() - interval '1 minute' WHERE id=$1`, [lease.leaseId]);
  ok(await places.call(pool, OP, 'city.bill', { requestId: rid() }));
  ok(await places.call(pool, OP, 'city.bill', { requestId: rid() }));
  assert.deepEqual(await charges(owner), [10_000_000, 10_000_000, 20_000_000], 'one monthly charge per period, never two');
  const rl = ok(await places.call(pool, me(rival, 'R'), 'city.lease', { placeId: pRival.id, lotIds: ['press-01'], requestId: rid() }));
  await pool.query(`UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1`, [rival]);
  await pool.query(`UPDATE place_city_leases SET paid_through=now() - interval '1 minute' WHERE id=$1`, [rl.leaseId]);
  ok(await places.call(pool, OP, 'city.bill', { requestId: rid() }));
  assert.equal((await pool.query('SELECT state FROM place_city_leases WHERE id=$1', [rl.leaseId])).rows[0].state, 'lapsing', 'unpaid: lapsing first');
  ok(await places.call(pool, OP, 'city.bill', { requestId: rid() }));
  assert.equal((await pool.query('SELECT state FROM place_city_leases WHERE id=$1', [rl.leaseId])).rows[0].state, 'ended', 'still unpaid: ended, lots back on the market');
  await pool.query(`UPDATE credit_accounts SET is_frozen=false WHERE user_id=$1`, [rival]);

  // ── facade ──
  refused(await places.call(pool, me(member, 'M'), 'city.facade.set', { placeId: pCo.id, logoText: 'x', expectedRevision: 1, requestId: rid() }), 'denied', 'not_admin');
  const fs1 = ok(await places.call(pool, O, 'city.facade.set', { placeId: pCo.id, material: 'loft', logoText: 'CO<script>', lobbyOpen: true, expectedRevision: 1, requestId: rid() }));
  refused(await places.call(pool, O, 'city.facade.set', { placeId: pCo.id, logoText: 'Y', expectedRevision: 1, requestId: rid() }), 'conflict', 'stale_revision');
  const fv = ok(await places.call(pool, O, 'city.get', { cityId: pCo.city_id })).buildings.find((x) => x.placeId === pCo.id).facade;
  assert.deepEqual([fv.material, fv.logoText, fv.lobbyOpen, fv.revision], ['loft', 'COscript', true, fs1.facadeRevision], 'saved and sanitised');

  // ── sponsorship ──
  refused(await places.call(pool, me(rival, 'R'), 'city.sponsor.book', { cityId: pCo.city_id, slotId: 'slot-commons-0', sponsor: 'X', text: 'Y', weeks: 1, requestId: rid() }), 'not_found', 'slot_not_found');
  const bk = ok(await places.call(pool, me(rival, 'R'), 'city.sponsor.book', { cityId: pCo.city_id, slotId: 'slot-market-0', sponsor: 'Tidewater', text: 'Fresh drops', weeks: 2, requestId: rid() }));
  assert.equal(bk.holdMicro, 12 * 4 * 2 * MICRO_PER_CREDIT);
  refused(await places.call(pool, O, 'city.sponsor.book', { cityId: pCo.city_id, slotId: 'slot-market-0', sponsor: 'Z', text: 'Z', weeks: 1, requestId: rid() }), 'conflict', 'slot_busy');
  refused(await places.call(pool, me(stew, 'S'), 'city.sponsor.review', { bookingId: bk.bookingId, approve: true, requestId: rid() }), 'denied', 'not_steward');
  ok(await places.call(pool, OP, 'city.steward.set', { cityId: pCo.city_id, userId: stew, requestId: rid() }));
  ok(await places.call(pool, OP, 'city.steward.set', { cityId: pCo.city_id, userId: rival, requestId: rid() }));
  refused(await places.call(pool, me(rival, 'R'), 'city.sponsor.review', { bookingId: bk.bookingId, approve: true, requestId: rid() }), 'denied', 'own_booking');
  await assert.rejects(pool.query(`UPDATE place_sponsor_bookings SET reviewed_by_user_id=booked_by_user_id WHERE id=$1`, [bk.bookingId]), /check/i, 'the DB refuses self-review too');
  assert.ok(ok(await places.call(pool, me(stew, 'S'), 'city.get', { cityId: pCo.city_id })).bookings.some((x) => x.id === bk.bookingId), 'the steward’s review queue');
  ok(await places.call(pool, me(stew, 'S'), 'city.sponsor.review', { bookingId: bk.bookingId, approve: true, requestId: rid() }));
  const slotFor = async (u) => ok(await places.call(pool, me(u, 'X'), 'city.get', { cityId: pCo.city_id })).slots.find((s) => s.id === 'slot-market-0');
  const hidden = await slotFor(owner);
  assert.deepEqual([hidden.label, hidden.occupied, hidden.live], ['Sponsored', true, null], 'no age signal → the copy is not shown (fail-closed for minors)');
  await pool.query(`INSERT INTO user_settings (user_id, settings) VALUES ($1, '{"account":{"adult":true}}') ON CONFLICT (user_id) DO UPDATE SET settings='{"account":{"adult":true}}'`, [owner]);
  assert.equal((await slotFor(owner)).live.sponsor, 'Tidewater', 'an adult-attested account sees it, labelled Sponsored');
  const bk2 = ok(await places.call(pool, me(rival, 'R'), 'city.sponsor.book', { cityId: pCo.city_id, slotId: 'slot-press-0', sponsor: 'Fern', text: 'Books', weeks: 1, requestId: rid() }));
  ok(await places.call(pool, me(stew, 'S'), 'city.sponsor.review', { bookingId: bk2.bookingId, approve: false, reason: 'no', requestId: rid() }));
  assert.deepEqual(await refunds(rival), [8 * 4 * MICRO_PER_CREDIT], 'a rejected booking’s hold is refunded exactly');
  refused(await places.call(pool, me(stew, 'S'), 'city.sponsor.review', { bookingId: bk2.bookingId, approve: true, requestId: rid() }), 'conflict', 'not_pending');

  // ── release frees the lots ──
  ok(await places.call(pool, O, 'city.release', { leaseId: lease.leaseId, requestId: rid() }));
  ok(await places.call(pool, me(rival, 'R'), 'city.lease', { placeId: pRival.id, lotIds: ['studio-01'], requestId: rid() }));

  await pool.query(DOWN);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('place_city_leases','place_city_lease_lots','place_facades','place_city_stewards','place_sponsor_bookings')`)).rows[0].n, 0, 'DOWN drops the five tables');
  await pool.query(UP);
  console.log('places city: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
