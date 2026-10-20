/**
 * XENO Places location sources (migration 20261020220000 + utils/signinCountry.js + places.relocate), on real Postgres:
 *   - the sign-in country (CF-IPCountry, two letters, no IP) is written into the owner's own settings record ONLY when
 *     the person has not set a country; a person-set value is never overwritten; XX / T1 / junk are ignored;
 *   - precedence in places_home_city(): person-set country > time zone > sign-in country > default;
 *   - the backfill moves a building still on the DEFAULT city once a better source appears, is idempotent, and never
 *     moves one relocated by hand;
 *   - places.relocate: owner/admin only, a real XENO city, receipt + requestId replay, conflict on a reused key;
 *   - DOWN then UP of the migration runs clean.
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/places-location.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as places from '../services/places.js';
import { recordSigninCountry, countryFromRequest } from '../utils/signinCountry.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261020220000-places-signin-country.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `loc${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const req = (cc) => ({ headers: cc == null ? {} : { 'cf-ipcountry': cc } });
const user = async (s, region) => {
  const id = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  if (region) await pool.query(`INSERT INTO user_settings (user_id, settings) VALUES ($1, $2)`, [id, { theme: 'dark', workspace: { region } }]);
  return id;
};
const workspace = async (owner, name) => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const settings = async (u) => (await pool.query('SELECT settings FROM user_settings WHERE user_id=$1', [u])).rows[0]?.settings;
const home = async (u) => (await pool.query('SELECT * FROM places_home_city($1)', [u])).rows[0];
const placeOf = async (w) => (await pool.query(`SELECT * FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows[0];
const me = (id, kind = 'human') => ({ id, name: 'x', kind });

async function main() {
  await runAllMigrations(pool);

  // ── the header ──
  assert.equal(countryFromRequest(req('de')), 'DE');
  for (const bad of ['XX', 'T1', 'DEU', '', '1A', null]) assert.equal(countryFromRequest(req(bad)), null, `ignored: ${bad}`);

  // ── capture: never over a person-set country ──
  const set = await user('set', { region: 'DE', tz: 'Europe/Berlin' });
  assert.equal(await recordSigninCountry(pool, set, req('JP')), false, 'a person-set country is never overwritten');
  assert.deepEqual((await settings(set)).workspace.region, { region: 'DE', tz: 'Europe/Berlin' });
  assert.deepEqual([(await home(set)).city_id, (await home(set)).source], ['lindgren', 'owner_region']);

  const fresh = await user('fresh');
  assert.equal(await recordSigninCountry(pool, fresh, req('XX')), false, 'XX writes nothing');
  assert.equal(await settings(fresh), undefined);
  assert.equal(await recordSigninCountry(pool, fresh, req('JP')), true);
  assert.deepEqual((await settings(fresh)).workspace.region, { region: 'JP', source: 'signin_country' });
  assert.deepEqual([(await home(fresh)).city_id, (await home(fresh)).source], ['sakura', 'signin_country']);
  assert.equal(await recordSigninCountry(pool, fresh, req('SG')), true, 'a later sign-in refreshes a country WE wrote');
  assert.equal((await home(fresh)).city_id, 'lumen');

  // time zone beats the sign-in country; other settings survive the write
  const tz = await user('tz', { tz: 'America/Los_Angeles' });
  assert.equal(await recordSigninCountry(pool, tz, req('FR')), true);
  const s = await settings(tz);
  assert.equal(s.theme, 'dark', 'unrelated settings are kept');
  assert.deepEqual(s.workspace.region, { tz: 'America/Los_Angeles', region: 'FR', source: 'signin_country' });
  assert.deepEqual([(await home(tz)).city_id, (await home(tz)).source], ['halcyon', 'owner_timezone'], 'time zone > sign-in country');

  // the person saving Language & region (which replaces the object, dropping our marker) wins from then on
  await pool.query(`UPDATE user_settings SET settings = jsonb_set(settings, '{workspace,region}', '{"region":"BR"}') WHERE user_id=$1`, [fresh]);
  assert.equal(await recordSigninCountry(pool, fresh, req('JP')), false);
  assert.deepEqual([(await home(fresh)).city_id, (await home(fresh)).source], ['solace', 'owner_region']);

  // ── backfill re-places buildings still on the default city ──
  const late = await user('late');
  const wLate = await workspace(late, 'Late');
  const lateId = (await placeOf(wLate)).id;
  assert.deepEqual([(await placeOf(wLate)).city_id, (await placeOf(wLate)).location_source], ['meridian', 'default']);
  const hand = await user('hand');
  const wHand = await workspace(hand, 'Hand');
  const moved = await places.call(pool, me(hand), 'places.relocate', { placeId: (await placeOf(wHand)).id, cityId: 'aurora', requestId: rid() });
  assert.ok(moved.ok && moved.receipt, JSON.stringify(moved.error));
  await recordSigninCountry(pool, late, req('IN'));
  await recordSigninCountry(pool, hand, req('IN'));
  const plan = await places.backfillPlan(pool);
  assert.ok(plan.relocations.some((m) => m.id === lateId), 'the dry run lists the default-city building');
  assert.ok(!plan.relocations.some((m) => m.id === moved.result.placeId), 'a hand-relocated building is never planned');
  assert.equal((await placeOf(wLate)).city_id, 'meridian', 'the dry run writes nothing');
  const done = await places.backfill(pool);
  assert.equal(done.relocated, plan.toRelocate);
  const pLate = await placeOf(wLate);
  assert.deepEqual([pLate.city_id, pLate.region_id, pLate.location_source], ['vega', 'as-south', 'signin_country']);
  assert.equal((await places.backfill(pool)).relocated, 0, 'a second run moves nothing (idempotent)');
  assert.equal((await placeOf(wHand)).city_id, 'aurora');

  // ── places.relocate ──
  const outsider = await user('outsider');
  const r1 = { placeId: pLate.id, cityId: 'harbor', requestId: rid() };
  assert.equal((await places.call(pool, me(outsider), 'places.relocate', r1)).error?.reason, 'not_admin');
  assert.equal((await places.call(pool, me(late, 'agent'), 'places.relocate', { ...r1, requestId: rid() })).error?.reason, 'not_admin', 'an agent never moves a building');
  assert.equal((await places.call(pool, me(late), 'places.relocate', { ...r1, cityId: 'atlantis', requestId: rid() })).error?.reason, 'city_unknown');
  const ok = await places.call(pool, me(late), 'places.relocate', r1);
  assert.ok(ok.ok && ok.result.moved && ok.receipt.operationId, JSON.stringify(ok.error));
  assert.deepEqual([(await placeOf(wLate)).city_id, (await placeOf(wLate)).location_source], ['harbor', 'relocated']);
  const again = await places.call(pool, me(late), 'places.relocate', r1);
  assert.equal(again.receipt.replayed, true, 'the same requestId replays the receipt');
  assert.equal((await places.call(pool, me(late), 'places.relocate', { ...r1, cityId: 'sakura' })).error?.code, 'conflict');

  // ── DOWN then UP ──
  await pool.query(DOWN);
  assert.equal((await placeOf(wLate)).location_source, 'default');
  await pool.query(UP);
  assert.equal((await home(late)).source, 'signin_country');
  console.log('places-location: all assertions passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
