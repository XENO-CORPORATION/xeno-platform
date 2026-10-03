/**
 * Per-user project pins against the REAL schema (TEST_DATABASE_URL, migrated).
 * Skips without a database -- ci:local supplies one; a skip here is not a pass.
 *
 * Covers: idempotent pin, append order, order validation, per-user isolation, access revocation
 * (hidden from lists, still unpinnable, order survives), cascade on project delete, and the
 * GET /projects annotation including "a pinned project survives the page limit".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import pg from 'pg';

import { writeTuples } from '../src/server/utils/authzReBAC.js';
import { createAuthorizedProject, userPrincipal } from '../src/server/services/chatProjectAuthority.js';
import {
  annotateProjectPins,
  pinProject,
  reorderPins,
  unpinProject,
} from '../src/server/services/chatProjectPins.js';

const connectionString = process.env.TEST_DATABASE_URL;
const pool = connectionString ? new pg.Pool({ connectionString, max: 4 }) : null;
const marker = `pins-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let a;
let b;
let workspaceId;
const projects = [];

const addUser = async (suffix) => (await pool.query(
  `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
   VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
  [`${marker}-${suffix}`, `${marker}-${suffix}@example.test`],
)).rows[0].id;

const pinnedFor = async (userId) => (await pool.query(
  'SELECT project_id FROM chat_project_pins WHERE user_id=$1 ORDER BY position', [userId],
)).rows.map((r) => r.project_id);

test.before(async () => {
  if (!pool) return;
  a = await addUser('a');
  b = await addUser('b');
  workspaceId = (await pool.query(
    'INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$3) RETURNING id', [a, marker, marker],
  )).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${workspaceId}`, relation: 'owner', subject: `user:${a}` }] });
  for (const n of [1, 2, 3]) {
    projects.push(await createAuthorizedProject(pool, { principal: userPrincipal(a), name: `${marker} p${n}` }));
  }
  // p3 is shared with B as viewer (personal project, explicit tuple).
  await writeTuples(pool, { writes: [{ object: `project:${projects[2].id}`, relation: 'viewer', subject: `user:${b}` }] });
});

test.after(async () => {
  if (pool) await pool.end();
});

test('pin is idempotent and appends at the end', { skip: !pool }, async () => {
  const [p1, p2] = projects;
  const first = await pinProject(pool, a, p1.id);
  const again = await pinProject(pool, a, p1.id);
  assert.equal(first.pin_position, 0);
  assert.equal(again.pin_position, 0, 'a repeat pin must not move or duplicate');
  await pinProject(pool, a, p2.id);
  assert.deepEqual(await pinnedFor(a), [p1.id, p2.id]);
});

test('pinning requires viewer access and never reveals a project the caller cannot see', { skip: !pool }, async () => {
  await assert.rejects(pinProject(pool, b, projects[0].id), /not found or access denied/i);
  assert.deepEqual(await pinnedFor(b), []);
});

test('order must be exactly the caller\'s pinned set, then renumbers transactionally', { skip: !pool }, async () => {
  const [p1, p2, p3] = projects;
  await assert.rejects(reorderPins(pool, a, [p1.id]), /exactly the pinned/i, 'missing id');
  await assert.rejects(reorderPins(pool, a, [p1.id, p2.id, p3.id]), /exactly the pinned/i, 'extra (unpinned) id');
  await assert.rejects(reorderPins(pool, a, [p1.id, p1.id]), /not repeat/i, 'duplicate id');
  await assert.rejects(reorderPins(pool, a, ['nope', p1.id]), /UUID/i, 'malformed id');
  assert.deepEqual(await pinnedFor(a), [p1.id, p2.id], 'a rejected reorder changes nothing');
  await reorderPins(pool, a, [p2.id, p1.id]);
  assert.deepEqual(await pinnedFor(a), [p2.id, p1.id]);
  const positions = (await pool.query('SELECT position FROM chat_project_pins WHERE user_id=$1 ORDER BY position', [a])).rows.map((r) => r.position);
  assert.deepEqual(positions, [0, 1]);
});

test('pins are per user: B does not see or inherit A\'s pins', { skip: !pool }, async () => {
  const [p1, p2, p3] = projects;
  await pinProject(pool, b, p3.id);
  const forA = await annotateProjectPins(pool, a, projects);
  const forB = await annotateProjectPins(pool, b, [p3]);
  assert.deepEqual(forA.map((p) => p.pinned), [true, true, false]);
  assert.equal(forB[0].pinned, true);
  assert.equal(forB[0].pin_position, 0, 'B position is B\'s own, not A\'s');
  await assert.rejects(reorderPins(pool, b, [p1.id, p2.id]), /exactly the pinned/i);
  await unpinProject(pool, b, p3.id);
  assert.deepEqual(await pinnedFor(a), [p2.id, p1.id], 'B unpinning must not touch A');
});

test('revoked access hides the pin from reorder validation but never breaks the list; unpin still works', { skip: !pool }, async () => {
  const [p1, p2, p3] = projects;
  await pinProject(pool, b, p3.id);
  await writeTuples(pool, { deletes: [{ object: `project:${p3.id}`, relation: 'viewer', subject: `user:${b}` }] });
  const stillHas = await pool.query('SELECT 1 FROM chat_project_pins WHERE user_id=$1 AND project_id=$2', [b, p3.id]);
  assert.equal(stillHas.rowCount, 1, 'the inert row stays so restoring access restores the pin');
  // B can no longer see p3: an empty visible set means [] is the exact order and anything else is rejected.
  await reorderPins(pool, b, []);
  await assert.rejects(reorderPins(pool, b, [p3.id]), /exactly the pinned/i);
  await unpinProject(pool, b, p3.id);
  assert.equal((await pool.query('SELECT 1 FROM chat_project_pins WHERE user_id=$1', [b])).rowCount, 0);
  void p1; void p2;
});

test('deleting a project cascades its pins for every user', { skip: !pool }, async () => {
  const doomed = await createAuthorizedProject(pool, { principal: userPrincipal(a), name: `${marker} doomed` });
  await pinProject(pool, a, doomed.id);
  assert.ok((await pinnedFor(a)).includes(doomed.id));
  await pool.query('DELETE FROM chat_projects WHERE id=$1', [doomed.id]);
  assert.ok(!(await pinnedFor(a)).includes(doomed.id));
});

test('unpin is idempotent and does not need access', { skip: !pool }, async () => {
  const out = await unpinProject(pool, a, projects[1].id);
  assert.equal(out.pinned, false);
  await unpinProject(pool, a, projects[1].id);
  assert.deepEqual(await pinnedFor(a), [projects[0].id]);
});

test('HTTP: pin routes, GET /projects annotation, and a pinned project survives the page limit', { skip: !pool }, async () => {
  // Imported here, not at the top: the route module pulls the whole server dependency graph, and the
  // service-level tests above must stay runnable where that graph is not installed. A failed import
  // FAILS this test -- it is never turned into a skip.
  const { default: chatRoutes } = await import('../src/server/routes/chatRoutes.js');
  const mine = await createAuthorizedProject(pool, { principal: userPrincipal(a), name: `${marker} http-old` });
  await pool.query("UPDATE chat_projects SET updated_at = NOW() - interval '30 days' WHERE id=$1", [mine.id]);
  const newer = await createAuthorizedProject(pool, { principal: userPrincipal(a), name: `${marker} http-new` });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: req.get('x-test-user') }; next(); });
  app.use(chatRoutes);
  const server = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (user, method, path, body) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    assert.equal((await call(a, 'PUT', `/projects/${mine.id}/pin`)).status, 200);
    assert.equal((await call(a, 'PUT', `/projects/${mine.id}/pin`)).status, 200, 'idempotent');
    assert.equal((await call(b, 'PUT', `/projects/${mine.id}/pin`)).status, 404, 'B cannot see it');
    assert.equal((await call(a, 'PUT', `/projects/not-a-uuid/pin`)).status, 400);
    const limited = await (await call(a, 'GET', '/projects?limit=1')).json();
    const byId = new Map(limited.projects.map((p) => [p.id, p]));
    assert.ok(byId.get(mine.id)?.pinned === true, 'the pinned project is returned even though limit=1 would drop it');
    assert.equal(typeof byId.get(mine.id).pin_position, 'number');
    const one = await (await call(a, 'GET', `/projects/${mine.id}`)).json();
    assert.equal(one.project.pinned, true);
    const asB = await (await call(b, 'GET', '/projects')).json();
    assert.ok(asB.projects.every((p) => p.pinned === false), 'B sees no pins of A');
    assert.equal((await call(a, 'PUT', '/projects/pins/order', { ids: [newer.id] })).status, 400);
    assert.equal((await call(a, 'PUT', '/projects/pins/order', { ids: 'x' })).status, 400);
    const allPinned = await pinnedFor(a);
    assert.equal((await call(a, 'PUT', '/projects/pins/order', { ids: [...allPinned].reverse() })).status, 200);
    assert.equal((await call(a, 'DELETE', `/projects/${mine.id}/pin`)).status, 200);
    assert.equal((await (await call(a, 'GET', `/projects/${mine.id}`)).json()).project.pinned, false);
  } finally {
    await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
});
