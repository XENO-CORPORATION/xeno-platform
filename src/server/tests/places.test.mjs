/**
 * XENO Places phase 1 (migration 20261020180000 + services/places.js), on real Postgres:
 *   - DOWN → workspaces made with no building → UP → the backfill DRY RUN predicts exactly what --confirm creates,
 *     a second run creates 0 (idempotent), and the city follows the owner's own Language & region setting
 *     (country first, then time zone, else the default city);
 *   - a workspace made AFTER the migration gets its building at once (the trigger), and a personal workspace's own
 *     agents sit at desks in it;
 *   - places.get is built from the LIVE workforce records and SCOPE-FILTERED: an admin sees every floor, a member
 *     sees their floor and the others closed with no name, a non-member is denied, a guest sees only the floors the
 *     host opened;
 *   - layout save: admin only, coordinates only, expectedRevision, and requestId replay (same receipt, replayed) vs
 *     a reused key with different input (conflict);
 *   - every error is in the closed vocabulary; DOWN removes everything.
 *
 * Run: DATABASE_URL=postgresql://… node tests/places.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as places from '../services/places.js';
import * as placesMcp from '../services/placesMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261020180000-places.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `pl${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;

const user = async (s, region) => {
  const id = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  if (region) await pool.query(`INSERT INTO user_settings (user_id, settings) VALUES ($1, $2)`, [id, { workspace: { region } }]);
  return id;
};
const me = (id, name, kind = 'human') => ({ id, name, kind });
const workspace = async (owner, name, type = 'team') => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [owner, type, name, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const placeOf = async (w) => (await pool.query(`SELECT * FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows[0];
const CODES = new Set(places.CODES);
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected a refusal (${reason})`); assert.ok(CODES.has(r.error.code)); assert.equal(r.error.code, code); assert.equal(r.error.reason, reason); };

async function main() {
  await runAllMigrations(pool);
  await pool.query(DOWN);

  // ── existing workspaces, before the migration ──
  const de = await user('de', { region: 'DE', tz: 'Europe/Berlin' });
  const la = await user('la', { tz: 'America/Los_Angeles' });          // no country: the time zone decides
  const nobody = await user('nobody');                                 // no setting at all: the default city
  const pre = [await workspace(de, 'Old DE'), await workspace(la, 'Old LA'), await workspace(nobody, 'Old none')];
  await pool.query(UP);

  const plan = await places.backfillPlan(pool);
  for (const w of pre) assert.ok(plan.workspaceIds.includes(w), 'the dry run lists every workspace without a building');
  console.log('backfill dry run:', JSON.stringify({ missing: plan.missing, byCity: plan.byCity, bySource: plan.bySource }));
  assert.equal(Number((await pool.query('SELECT count(*) n FROM places')).rows[0].n), 0, 'the dry run writes nothing');
  const done = await places.backfill(pool);
  assert.equal(done.created, plan.missing, 'confirm creates exactly what the dry run predicted');
  assert.equal((await places.backfill(pool)).created, 0, 'a second run creates nothing (idempotent)');
  const [pDe, pLa, pNone] = await Promise.all(pre.map(placeOf));
  assert.deepEqual([pDe.city_id, pDe.location_source], ['lindgren', 'owner_region'], 'country DE → Central Europe → Lindgren');
  assert.deepEqual([pLa.city_id, pLa.location_source], ['halcyon', 'owner_timezone'], 'America/Los_Angeles → Pacific Coast → Halcyon Bay');
  assert.deepEqual([pNone.city_id, pNone.location_source], ['meridian', 'default'], 'no setting → the first XENO city');

  // ── a workspace made now gets its building at once; personal agents sit in their owner's building ──
  const owner = await user('owner', { region: 'GB' });
  const member = await user('member'), outsider = await user('outsider'), guest = await user('guest');
  const personal = await workspace(owner, "Owner's Workspace", 'personal');
  const agent = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agent, owner]);
  const pPersonal = await placeOf(personal);
  assert.ok(pPersonal, 'the trigger gave the new workspace its building');
  assert.equal(pPersonal.city_id, 'meridian', 'GB → Western Europe → Meridian');
  const home = await places.call(pool, me(owner, 'Owner'), 'places.get', { placeId: pPersonal.id });
  assert.ok(home.ok, JSON.stringify(home.error));
  const desks = home.result.spec.snap.memberships.map((m) => m.principalId);
  assert.ok(desks.includes(owner) && desks.includes(agent), 'the owner and their own agent have desks in the personal building');
  const agentView = await places.call(pool, me(agent, 'Agent', 'agent'), 'places.get', { placeId: pPersonal.id });
  assert.ok(agentView.ok && agentView.result.access.role === 'member' && !agentView.result.access.permissions.includes('edit'), 'the agent enters its owner’s building as a member, never an admin');

  // ── a company: two floors from the live records ──
  const co = await workspace(owner, 'Co');
  await writeTuples(pool, { writes: [{ object: `workspace:${co}`, subject: `user:${member}`, relation: 'editor' }] });
  const div = async (key) => (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, [co, key, key.toUpperCase(), owner])).rows[0].id;
  const dDev = await div('dev'), dSecret = await div('secret');
  const team = async (name, d) => { const t = (await pool.query(`INSERT INTO workforce_resources (kind, owner_workspace_id, created_by_user_id, name) VALUES ('team',$1,$2,$3) RETURNING id`, [co, owner, name])).rows[0].id;
    await pool.query(`INSERT INTO workforce_division_ownership (resource_id, resource_kind, division_id, created_by_user_id) VALUES ($1,'team',$2,$3)`, [t, d, owner]); return t; };
  const tDev = await team('Platform', dDev), tSecret = await team('Skunkworks', dSecret);
  const sit = (t, principal, role) => pool.query(`INSERT INTO workforce_team_memberships (team_id, member_principal_id, role, created_by_user_id) VALUES ($1,$2,$3,$4)`, [t, principal, role, owner]);
  await sit(tDev, member, 'worker'); await sit(tSecret, owner, 'manager');
  const pCo = await placeOf(co);

  const adminView = await places.call(pool, me(owner, 'Owner'), 'places.get', { placeId: pCo.id });
  assert.ok(adminView.ok);
  assert.deepEqual(adminView.result.spec.snap.divisions.map((d) => d.name).sort(), ['DEV', 'SECRET'], 'an admin sees every floor');
  assert.deepEqual(adminView.result.spec.snap.closedDivisionIds, []);

  const memberView = await places.call(pool, me(member, 'Member'), 'places.get', { placeId: pCo.id });
  assert.ok(memberView.ok);
  const s = memberView.result.spec.snap;
  assert.deepEqual(s.divisions.map((d) => d.name), ['DEV'], 'a member sees their own floor');
  assert.deepEqual(s.closedDivisionIds, [dSecret], 'the other floor arrives as a closed id');
  const leaked = JSON.stringify(memberView.result);
  assert.ok(!leaked.includes('SECRET') && !leaked.includes('Skunkworks') && !leaked.includes(tSecret), 'a closed floor carries no name, team or desk');
  assert.ok(memberView.result.place.floors.some((f) => f.closed && f.name === null), 'the summary shows the closed floor nameless');

  refused(await places.call(pool, me(outsider, 'Outsider'), 'places.get', { placeId: pCo.id }), 'denied', 'no_access');
  refused(await places.call(pool, me(outsider, 'Outsider'), 'places.get', { placeId: '00000000-0000-4000-8000-000000000000' }), 'not_found', 'place_not_found');
  assert.ok(!(await places.call(pool, me(outsider, 'Outsider'), 'places.list', {})).result.items.some((p) => p.id === pCo.id), 'places.list shows nothing to a non-member');
  assert.ok((await places.call(pool, me(member, 'Member'), 'places.list', {})).result.items.some((p) => p.id === pCo.id));

  // ── hosted session: narrows, never widens ──
  refused(await places.call(pool, me(owner, 'Owner'), 'sessions.host', { placeId: pCo.id, permissions: ['watch', 'edit'], requestId: rid() }), 'bad_input', 'permission_not_grantable');
  refused(await places.call(pool, me(member, 'Member'), 'sessions.host', { placeId: pCo.id, requestId: rid() }), 'denied', 'no_host');
  const hosted = await places.call(pool, me(owner, 'Owner'), 'sessions.host', { placeId: pCo.id, floors: [dDev], permissions: ['watch', 'talk'], requestId: rid() });
  assert.ok(hosted.ok, JSON.stringify(hosted.error));
  assert.ok((await places.call(pool, me(guest, 'Guest'), 'sessions.join', { code: hosted.result.code, requestId: rid() })).ok);
  const guestView = await places.call(pool, me(guest, 'Guest'), 'places.get', { placeId: pCo.id });
  assert.ok(guestView.ok);
  assert.deepEqual([guestView.result.access.role, guestView.result.access.permissions], ['guest', ['watch', 'talk']]);
  assert.deepEqual(guestView.result.spec.snap.divisions.map((d) => d.name), ['DEV'], 'a guest sees only the floors the host opened');
  assert.deepEqual(guestView.result.spec.snap.closedDivisionIds, [dSecret]);
  assert.ok((await places.call(pool, me(owner, 'Owner'), 'sessions.end', { sessionId: hosted.result.session.id, requestId: rid() })).ok);
  refused(await places.call(pool, me(guest, 'Guest'), 'places.get', { placeId: pCo.id }), 'denied', 'no_access');

  // ── layout save: admin only, coordinates only, revision, idempotency ──
  const rev = adminView.result.place.revision;
  const layout = { bays: 6, slots: { [s.memberships[0].id]: 2 }, pods: { [tDev]: { x: 3, z: -2, level: 1 } } };
  refused(await places.call(pool, me(member, 'Member'), 'places.layout.save', { placeId: pCo.id, layout, expectedRevision: rev, requestId: rid() }), 'denied', 'no_edit');
  refused(await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout: { ...layout, memberships: [] }, expectedRevision: rev, requestId: rid() }), 'bad_input', 'layout_not_coordinates');
  refused(await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout, expectedRevision: rev }), 'bad_input', 'request_id_required');
  const key = rid();
  const saved = await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout, expectedRevision: rev, requestId: key });
  assert.ok(saved.ok, JSON.stringify(saved.error));
  assert.equal(saved.result.placeRevision, rev + 1);
  const replay = await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout, expectedRevision: rev, requestId: key });
  assert.ok(replay.ok && replay.receipt.replayed === true && replay.receipt.operationId === saved.receipt.operationId, 'a retry answers the original receipt');
  assert.equal(Number((await pool.query('SELECT revision FROM place_layouts WHERE place_id=$1', [pCo.id])).rows[0].revision), rev + 1, 'the retry did not apply twice');
  refused(await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout: { bays: 7 }, expectedRevision: rev, requestId: key }), 'conflict', 'request_reused');
  refused(await places.call(pool, me(owner, 'Owner'), 'places.layout.save', { placeId: pCo.id, layout, expectedRevision: rev, requestId: rid() }), 'conflict', 'stale_revision');
  const after = await places.call(pool, me(owner, 'Owner'), 'places.get', { placeId: pCo.id });
  assert.deepEqual([after.result.spec.record.bays, after.result.spec.record.pods[tDev]], [6, { x: 3, z: -2, level: 1 }]);

  // ── the MCP tool is the same code path ──
  const mcp = await placesMcp.callTool(pool, { id: member, kind: 'human', name: 'Member' }, 'get', { place: pCo.id });
  assert.deepEqual(mcp.structuredContent.spec.snap.closedDivisionIds, [dSecret], 'the MCP read is scope-filtered the same way');
  await assert.rejects(placesMcp.callTool(pool, { id: outsider, kind: 'human', name: 'O' }, 'get', { place: pCo.id }), placesMcp.PlacesMcpError);
  refused(await places.call(pool, me(owner, 'Owner'), 'places.nope', {}), 'not_found', 'op_unknown');
  refused(await places.call(pool, me(owner, 'Owner'), 'places.create', { workspaceId: co, requestId: rid() }), 'conflict', 'place_exists');

  // ── DOWN removes everything; UP again is clean ──
  await pool.query(DOWN);
  const left = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name LIKE 'place%'`)).rows;
  assert.deepEqual(left, [], 'DOWN drops every Places table');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='places_default_building'`)).rows[0].n, 0);
  await pool.query(UP);
  console.log('places: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
