/**
 * XENO-WORKFORCE-01 §8.11.1, DECIDED 2026-10-20 -- the ownership principles that are enforced, on real Postgres:
 *   D-2  divisions and teams never OWN files, tasks or credits (schema guard over every ownership table)
 *   D-3  a service principal is denied by default on Tasks, Storage and Marketplace listings; a named grant opens one
 *   D-5  a task never transfers alone (the trigger from 20261020090000-tasks-move-with-project.sql)
 *
 * Run: DATABASE_URL=postgresql://… node tests/ownership-principles.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { runAllMigrations } from '../services/migrationRunner.js';
import { assertServiceGranted, ServicePrincipalDeniedError } from '../services/servicePrincipalGate.js';
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import marketplaceRoutes from '../routes/marketplaceRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Every table that records who OWNS a file, a task or credits. A division or team id must never be one of its keys.
const OWNERSHIP_TABLES = ['user_files', 'tasks', 'credit_accounts', 'credit_grants', 'storage_grants', 'credit_transactions'];

async function main() {
  await runAllMigrations(pool);

  // ── D-2: no ownership table keys on a division or team ──
  const present = (await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)', [OWNERSHIP_TABLES])).rows.map((r) => r.table_name);
  assert.ok(present.includes('user_files') && present.includes('tasks') && present.includes('credit_accounts'), 'the guard sees the ownership tables');
  const cols = (await pool.query(`SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1) AND column_name ~ '(division|team)'`, [present])).rows;
  assert.deepEqual(cols, [], `D-2: a division/team column on an ownership table: ${JSON.stringify(cols)}`);
  const fks = (await pool.query(`SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS target FROM pg_constraint c
     WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1) AND c.confrelid::regclass::text IN ('workforce_divisions','workforce_resources','workforce_team_memberships','workspace_teams')`, [present])).rows;
  assert.deepEqual(fks, [], `D-2: an ownership table references a division/team: ${JSON.stringify(fks)}`);
  const ownerKinds = (await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'credit_accounts'::regclass AND contype = 'c'`)).rows.map((r) => r.def).join(' ');
  assert.ok(!/division|'team'/.test(ownerKinds), 'D-2: a credit account is never owned by a division or team');

  // ── fixtures ──
  const user = async (name, role = 'user') => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, role) VALUES ($1, $2, $1, true, true, 'x', $3) RETURNING id`,
    [`${name}_${process.pid}`, `${name}_${process.pid}@xeno.test`, role])).rows[0].id;
  const human = await user('own_human'), svc = await user('own_service', 'service');

  // ── D-3: the gate itself ──
  await assertServiceGranted(pool, human, 'tasks'); // a person is untouched
  await assert.rejects(assertServiceGranted(pool, svc, 'tasks'), ServicePrincipalDeniedError, 'D-3: a service is denied by default');
  await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('capability','tasks','grantee','user',$1)`, [svc]);
  await assertServiceGranted(pool, svc, 'tasks'); // a named grant opens exactly that capability
  await assert.rejects(assertServiceGranted(pool, svc, 'storage'), ServicePrincipalDeniedError, 'D-3: a grant is per capability');
  await pool.query(`DELETE FROM relationship_tuples WHERE object_type='capability' AND subject_id=$1`, [svc]);

  // ── D-3: Storage's one write choke point ──
  const svcFile = path.join(os.tmpdir(), `own-svc-${process.pid}.txt`); writeFileSync(svcFile, 'x');
  await assert.rejects(registerManagedLibraryFile(pool, { userId: svc, filename: 's.txt', originalName: 's.txt', mimeType: 'text/plain', fileSize: 1, storagePath: svcFile, metadata: {} }),
    (e) => e.code === 'service_principal_denied', 'D-3: a service account stores no file');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_files WHERE user_id = $1', [svc])).rows[0].n, 0);

  // ── D-3: Tasks and Marketplace listings, through the real routers ──
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/tasks', (req, _res, next) => { req.user = { id: req.headers['x-test-user'] }; next(); }, taskTokenAuth, xenoTasksRoutes);
  app.use('/api/marketplace', marketplaceRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tasksAs = (id) => fetch(`${base}/api/tasks`, { headers: { 'x-test-user': id } });
    const t1 = await tasksAs(svc);
    assert.equal(t1.status, 403); assert.equal((await t1.json()).code, 'service_principal_denied', 'D-3: a service account reads no tasks');
    assert.notEqual((await tasksAs(human)).status, 403, 'a person still reaches Tasks');
    const listAs = (id) => fetch(`${base}/api/marketplace/listings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: id, email: 'x@xeno.test', username: 'x' }, JWT_SECRET, { expiresIn: '1h' })}` }, body: JSON.stringify({ kind: 'mcp', title: 'Svc listing' }) });
    const m1 = await listAs(svc);
    assert.equal(m1.status, 403); assert.equal((await m1.json()).code, 'service_principal_denied', 'D-3: a service account creates no listing');
    const m2 = await listAs(human);
    assert.notEqual((await m2.json()).code, 'service_principal_denied', 'a person reaches the listing rules (and is asked for a developer profile)');
  } finally { server.close(); }

  // ── D-5: a task never transfers alone ──
  const p1 = (await pool.query(`INSERT INTO chat_projects(owner_user_id,user_id,name) VALUES($1,$1,'P1') RETURNING id`, [human])).rows[0].id;
  const p2 = (await pool.query(`INSERT INTO chat_projects(owner_user_id,user_id,name) VALUES($1,$1,'P2') RETURNING id`, [human])).rows[0].id;
  const other = await user('own_other');
  const inProject = (await pool.query(`INSERT INTO tasks(title,project_id,reporter_id,reporter_kind) VALUES('t',$1,$2,'human') RETURNING id`, [p1, human])).rows[0].id;
  const personal = (await pool.query(`INSERT INTO tasks(title,owner_user_id,reporter_id,reporter_kind) VALUES('p',$1,$1,'human') RETURNING id`, [human])).rows[0].id;
  await assert.rejects(pool.query('UPDATE tasks SET project_id = $2 WHERE id = $1', [inProject, p2]), /moves only with its project/, 'D-5: a task cannot be moved to another project on its own');
  await assert.rejects(pool.query('UPDATE tasks SET owner_user_id = $2 WHERE id = $1', [personal, other]), /never transferred alone/, 'D-5: a personal task cannot be handed to another owner');
  await pool.query("UPDATE tasks SET title = 'renamed' WHERE id = $1", [inProject]); // ordinary edits are untouched
  await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [[inProject, personal]]);

  console.log('ownership-principles: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
