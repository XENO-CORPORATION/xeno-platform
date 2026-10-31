/**
 * XENO Places — act on an occupant's task in place (`tasks.act`), on real Postgres. It goes THROUGH xenoTasks:
 *   - the worker cannot approve their own work (Tasks' rule), the creator can — the task really becomes done;
 *   - request changes sends in_review back to in_progress with the note;
 *   - an agent never approves work it is delegated (refused by Places before Tasks is asked);
 *   - hand off reassigns through updateTask; a stranger cannot see the task (not_found);
 *   - every success carries a receipt and a retry replays it.
 * Run: DATABASE_URL=postgresql://… node tests/places-tasks.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as places from '../services/places.js';
import * as tasks from '../services/xenoTasks.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `pt${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, name, kind = 'human') => ({ id, name, kind });
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected ${reason}, got ${JSON.stringify(r.result)}`); assert.equal(r.error.code, code); if (reason) assert.equal(r.error.reason, reason); };
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.error)); return r.result; };
const status = async (key) => (await tasks.getTask(pool, CREATOR, key)).status;
let CREATOR;

async function main() {
  await runAllMigrations(pool);
  const a = await user('creator'), b = await user('worker'), c = await user('third'), stranger = await user('stranger'), g = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [g, a]);
  CREATOR = me(a, 'Creator'); const W = me(b, 'Worker');

  const t = await tasks.createTask(pool, CREATOR, { title: 'Ship the lobby', assigneeId: b });
  if (t.status === 'raised') await tasks.transitionTask(pool, CREATOR, t.key, { to: 'todo' });
  await tasks.transitionTask(pool, W, t.key, { to: 'in_progress' });
  await tasks.transitionTask(pool, W, t.key, { to: 'in_review' });

  refused(await places.call(pool, W, 'tasks.act', { taskKey: t.key, action: 'approve', requestId: rid() }), 'denied', 'not_allowed');
  refused(await places.call(pool, me(stranger, 'S'), 'tasks.act', { taskKey: t.key, action: 'approve', requestId: rid() }), 'not_found');
  refused(await places.call(pool, CREATOR, 'tasks.act', { taskKey: 'nope', action: 'approve', requestId: rid() }), 'bad_input', 'task_key_invalid');
  const rc = ok(await places.call(pool, CREATOR, 'tasks.act', { taskKey: t.key, action: 'request_changes', note: 'Brighter lobby', requestId: rid() }));
  assert.equal(rc.status, 'in_progress');
  assert.equal(await status(t.key), 'in_progress', 'the Tasks record moved');
  await tasks.transitionTask(pool, W, t.key, { to: 'in_review' });
  const key = rid();
  const ap = await places.call(pool, CREATOR, 'tasks.act', { taskKey: t.key, action: 'approve', from: 'in_review', requestId: key });
  assert.equal(ok(ap).status, 'done');
  assert.ok(ap.receipt?.operationId, 'a receipt');
  const again = await places.call(pool, CREATOR, 'tasks.act', { taskKey: t.key, action: 'approve', from: 'in_review', requestId: key });
  assert.ok(again.ok && again.receipt.replayed, 'a retry replays, it is not applied twice');
  assert.equal(await status(t.key), 'done');

  // an agent never approves work delegated to it
  const t2 = await tasks.createTask(pool, CREATOR, { title: 'Agent work', delegateId: g });
  refused(await places.call(pool, me(g, 'Agent', 'agent'), 'tasks.act', { taskKey: t2.key, action: 'approve', requestId: rid() }), 'denied', 'own_work');

  // hand off through updateTask
  const t3 = await tasks.createTask(pool, CREATOR, { title: 'Hand me off', assigneeId: b });
  const ho = ok(await places.call(pool, CREATOR, 'tasks.act', { taskKey: t3.key, action: 'hand_off', assigneeId: c, requestId: rid() }));
  assert.equal(ho.assignee?.id, c);
  refused(await places.call(pool, W, 'tasks.act', { taskKey: t3.key, action: 'hand_off', assigneeId: b, requestId: rid() }), 'not_found');
  console.log('places tasks.act: all checks passed');
}
main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
