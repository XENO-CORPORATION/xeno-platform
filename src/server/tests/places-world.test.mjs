/**
 * XENO Polis (migration 20261027100000 + world.* in services/placesCity.js), on real Postgres:
 *   - world.get: 13 regions, 13 cities from geo.js; pledge and waitlist counts are REAL rows (start at 0, never seeded);
 *     a city counts the buildings standing in it and which are yours;
 *   - world.pledge: only demand regions; toggles; one per person; an agent cannot;
 *   - world.waitlist: refused for an open city and a locked region; toggles;
 *   - DOWN drops both tables.
 * Run: DATABASE_URL=postgresql://… node tests/places-world.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as places from '../services/places.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261027100000-places-world.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `pwo${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, kind = 'human') => ({ id, name: 'X', kind });
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected ${reason}`); assert.equal(r.error.code, code); assert.equal(r.error.reason, reason); };
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.error)); return r.result; };

async function main() {
  await runAllMigrations(pool);
  await pool.query(DOWN); await pool.query(UP);
  const a = await user('a'), b = await user('b');
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','W',$2) RETURNING id`, [a, `${tag}-w`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${a}`, relation: 'owner' }] });
  const city = (await pool.query(`SELECT city_id FROM places WHERE workspace_id=$1`, [w])).rows[0].city_id;

  const w0 = ok(await places.call(pool, me(a), 'world.get', {}));
  assert.deepEqual([w0.regions.length, w0.cities.length, w0.continents.length], [13, 13, 6]);
  assert.ok(w0.regions.every((r) => r.pledged === 0), 'no seeded pledge numbers: counts are rows');
  assert.ok(w0.cities.find((c) => c.id === city).mine >= 1, 'my building is counted in its city');

  refused(await places.call(pool, me(a), 'world.pledge', { regionId: 'eu-west', requestId: rid() }), 'bad_input', 'not_demand');
  refused(await places.call(pool, me(a, 'agent'), 'world.pledge', { regionId: 'na-north', requestId: rid() }), 'denied', 'person_only');
  assert.equal(ok(await places.call(pool, me(a), 'world.pledge', { regionId: 'na-north', requestId: rid() })).pledged, true);
  ok(await places.call(pool, me(b), 'world.pledge', { regionId: 'na-north', requestId: rid() }));
  const r1 = ok(await places.call(pool, me(a), 'world.get', {})).regions.find((r) => r.id === 'na-north');
  assert.deepEqual([r1.pledged, r1.pledgedByMe, r1.target], [2, true, 60]);
  assert.equal(ok(await places.call(pool, me(a), 'world.pledge', { regionId: 'na-north', requestId: rid() })).pledged, false, 'a second pledge withdraws');
  assert.equal(ok(await places.call(pool, me(b), 'world.get', {})).regions.find((r) => r.id === 'na-north').pledged, 1);

  refused(await places.call(pool, me(a), 'world.waitlist', { cityId: 'meridian', requestId: rid() }), 'bad_input', 'city_open');
  refused(await places.call(pool, me(a), 'world.waitlist', { cityId: 'aurum', requestId: rid() }), 'denied', 'region_locked');
  ok(await places.call(pool, me(a), 'world.waitlist', { cityId: 'harbor', requestId: rid() }));
  const h = ok(await places.call(pool, me(a), 'world.get', {})).cities.find((c) => c.id === 'harbor');
  assert.deepEqual([h.waitlisted, h.waitlistCount, h.built], [true, 1, false]);

  await pool.query(DOWN);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('place_world_pledges','place_world_waitlist')`)).rows[0].n, 0);
  await pool.query(UP);
  console.log('places world: all checks passed');
}
main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
