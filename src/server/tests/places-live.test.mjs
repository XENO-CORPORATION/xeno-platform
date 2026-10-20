/**
 * XENO Places live stream (services/placesLive.js + GET /api/places/:id/events), on real Postgres:
 *   - a member's frame and SSE events carry NOTHING from a closed floor: no run, no occupant, no presence, no task;
 *   - presence: a beat onto a floor the viewer cannot see is refused; a stranger's beat never shows; TTL expires it;
 *   - occupant status is derived from records (task in_review for me → needs-you, blocked, in_progress → working);
 *   - diffFrames sends a snapshot first, then only changes; needs-you lists my reviews and my agents' blocked tasks.
 *   - over HTTP: the real router streams `snapshot` then an `occupant` event when a task changes, and a non-member
 *     gets a 403 envelope, never a stream.
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/places-live.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as live from '../services/placesLive.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `plv${process.pid}`;
let seq = 0;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, name, kind = 'human') => ({ id, name, kind });

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), member = await user('member'), outsider = await user('outsider');
  const agentDev = await user('agentdev'), agentSecret = await user('agentsecret');
  for (const a of [agentDev, agentSecret]) await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [a, owner]);
  const co = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Co',$2) RETURNING id`, [owner, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${co}`, subject: `user:${owner}`, relation: 'owner' }, { object: `workspace:${co}`, subject: `user:${member}`, relation: 'editor' }] });
  const div = async (key) => (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, [co, key, key.toUpperCase(), owner])).rows[0].id;
  const dDev = await div('dev'), dSecret = await div('secret');
  const team = async (name, d) => { const t = (await pool.query(`INSERT INTO workforce_resources (kind, owner_workspace_id, created_by_user_id, name) VALUES ('team',$1,$2,$3) RETURNING id`, [co, owner, name])).rows[0].id;
    await pool.query(`INSERT INTO workforce_division_ownership (resource_id, resource_kind, division_id, created_by_user_id) VALUES ($1,'team',$2,$3)`, [t, d, owner]); return t; };
  const tDev = await team('Platform', dDev), tSecret = await team('Skunkworks', dSecret);
  const sit = (t, p, role) => pool.query(`INSERT INTO workforce_team_memberships (team_id, member_principal_id, role, created_by_user_id) VALUES ($1,$2,$3,$4)`, [t, p, role, owner]);
  await sit(tDev, member, 'worker'); await sit(tDev, agentDev, 'worker'); await sit(tSecret, agentSecret, 'worker');
  const placeId = (await pool.query(`SELECT id FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [co])).rows[0].id;
  const task = async (title, status, assignee, reviewer = null) => (await pool.query(`INSERT INTO tasks (title, status, owner_user_id, assignee_id, reviewer_id, review_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [title, status, owner, assignee, reviewer, Boolean(reviewer)])).rows[0].id;
  const tSecretTask = await task('SECRET-PLAN', 'blocked', agentSecret);
  const tReview = await task('Ship the stream', 'in_review', agentDev, member);

  // ── scoping ──
  const mf = await live.frame(pool, me(member, 'Member'), placeId);
  assert.ok(mf.ok, JSON.stringify(mf.error));
  const blob = JSON.stringify(mf.result);
  assert.ok(!blob.includes(agentSecret) && !blob.includes('SECRET-PLAN') && !blob.includes('SECRET') && !blob.includes(tSecretTask), 'a member frame carries nothing from the closed floor');
  assert.deepEqual(mf.result.closedDivisionIds, [dSecret]);
  assert.equal(mf.result.occupants[agentDev].status, 'needs-you', 'a task awaiting MY review makes the occupant needs-you');
  assert.equal(mf.result.occupants[agentDev].task.label, 'Ship the stream', 'the reviewer sees the label');
  const of = await live.frame(pool, me(owner, 'Owner'), placeId);
  assert.equal(of.result.occupants[agentSecret].status, 'blocked', 'the admin sees the closed-floor agent blocked');
  assert.equal(of.result.occupants[agentDev].status, 'idle', 'in_review for someone else is not needs-you for the owner');
  assert.equal((await live.frame(pool, me(outsider, 'Outsider'), placeId)).ok, false, 'a non-member gets no frame');

  // ── presence ──
  live._resetPresence();
  assert.ok((await live.beat(pool, me(owner, 'Owner'), placeId, { floorKey: dSecret })).ok);
  assert.equal((await live.beat(pool, me(member, 'Member'), placeId, { floorKey: dSecret })).error.reason, 'floor_closed');
  assert.ok((await live.beat(pool, me(member, 'Member'), placeId, { floorKey: dDev })).ok);
  assert.equal((await live.beat(pool, me(outsider, 'Outsider'), placeId, {})).ok, false, 'a stranger cannot be present');
  const pm = (await live.frame(pool, me(member, 'Member'), placeId)).result.presence;
  assert.deepEqual(pm, [{ principalId: member, floorKey: dDev }], 'the owner on the closed floor is invisible to the member');
  assert.equal((await live.frame(pool, me(owner, 'Owner'), placeId)).result.presence.length, 2);

  // ── diff ──
  const a = (await live.frame(pool, me(member, 'Member'), placeId)).result;
  assert.equal(live.diffFrames(null, a)[0].type, 'snapshot');
  assert.deepEqual(live.diffFrames(a, a), [], 'no change, no event');
  await pool.query(`UPDATE tasks SET status='blocked' WHERE id=$1`, [tSecretTask]);   // closed floor change
  assert.deepEqual(live.diffFrames(a, (await live.frame(pool, me(member, 'Member'), placeId)).result), [], 'a closed-floor change sends the member nothing');
  await pool.query(`UPDATE tasks SET status='in_progress' WHERE id=$1`, [tReview]);
  const ev = live.diffFrames(a, (await live.frame(pool, me(member, 'Member'), placeId)).result);
  assert.deepEqual(ev.map((e) => [e.type, e.principalId, e.status]), [['occupant', agentDev, 'working']]);

  // ── needs-you ──
  await pool.query(`UPDATE tasks SET status='in_review' WHERE id=$1`, [tReview]);
  const nm = (await live.needsYou(pool, me(member, 'Member'))).result.items;
  assert.deepEqual(nm.map((x) => [x.taskId, x.why]), [[tReview, 'review']]);
  assert.equal(nm[0].commands.approve.tool, 'move_task', 'actions are the existing Tasks tools');
  const no = (await live.needsYou(pool, me(owner, 'Owner'))).result.items;
  assert.ok(no.some((x) => x.taskId === tSecretTask && x.why === 'blocked'), 'the owner sees their agent blocked');
  assert.ok(!(await live.needsYou(pool, me(outsider, 'O'))).result.items.length);

  // ── over HTTP, through the real router ──
  process.env.PLACES_STREAM_INTERVAL_MS = '500';
  const { default: router } = await import('../routes/placesRoutes.js');
  const app = express();
  app.use((req, res, next) => { req.db = pool; req.user = { id: req.get('x-test-user') }; next(); });
  app.use('/api/places', router);
  const server = app.listen(0); const port = server.address().port;
  const get = (uid) => new Promise((resolve) => http.get({ port, path: `/api/places/${placeId}/events`, headers: { 'x-test-user': uid } }, resolve));
  const denied = await get(outsider);
  assert.equal(denied.statusCode, 403); denied.resume();
  const res = await get(member);
  assert.equal(res.statusCode, 200); assert.match(res.headers['content-type'], /text\/event-stream/);
  const seen = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error(`no occupant event; got ${buf.slice(0, 400)}`)), 8000);
    res.setEncoding('utf8');
    res.on('data', async (c) => {
      buf += c;
      if (buf.includes('event: snapshot') && !buf.includes('changed')) { buf += '\n<changed>'; await pool.query(`UPDATE tasks SET status='in_progress' WHERE id=$1`, [tReview]); }
      if (buf.includes('event: occupant')) { clearTimeout(t); resolve(buf); }
    });
  });
  res.destroy(); server.close();
  assert.ok(!seen.includes(agentSecret) && !seen.includes('SECRET'), 'the stream carried nothing from the closed floor');
  console.log('places-live: all assertions passed');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
