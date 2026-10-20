/**
 * D-3 grants managed by a workspace admin (services/serviceAccountGrants.js + routes/workspaceServiceAccountRoutes.js).
 * Real Postgres, the real route behind the real auth middleware. Proves:
 *   - only an admin of the workspace lists, reads, grants or revokes (a member and a stranger are refused);
 *   - only service accounts that are MEMBERS of the workspace are visible or grantable;
 *   - a grant writes the capability tuple the gate reads, so assertServiceGranted then passes; a revoke removes it;
 *   - EVERY change writes exactly one workspace_audit row; a repeated grant changes nothing and writes none;
 *   - an unknown capability is refused;
 *   - a grant is SCOPED: made in workspace A it does not let the service act in workspace B, and B's admin neither
 *     sees nor revokes it; a legacy unscoped tuple is invisible and grants nothing;
 *   - migration 20261020160000: DOWN drops the constraint exactly, UP restores it.
 *
 * Run: DATABASE_URL=postgresql://… node tests/service-account-grants.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { assertServiceGranted, ServicePrincipalDeniedError } from '../services/servicePrincipalGate.js';
import authMiddleware from '../middleware/auth.js';
import serviceAccountRoutes from '../routes/workspaceServiceAccountRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `sag${process.pid}`;
const [UPRAW, DOWN] = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../database/migrations/20261020160000-service-grants-workspace-scoped.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const hasConstraint = async () => (await pool.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'relationship_tuples_capability_scoped'`)).rows[0].n;

async function main() {
  await runAllMigrations(pool);
  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, role) VALUES ($1, $2, $1, true, true, 'x', $3) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, role])).rows[0].id;
  const admin = await user('admin'), member = await user('member'), stranger = await user('stranger');
  const svc = await user('svc', 'service'), outsider = await user('svc_out', 'service');
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Grants Co', $2) RETURNING id`, [admin, `${tag}-co`])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${ws}`, relation: 'owner', subject: `user:${admin}` },
    { object: `workspace:${ws}`, relation: 'editor', subject: `user:${member}` },
    { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${svc}` }] });

  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/workspaces/:id/service-accounts', authMiddleware, serviceAccountRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/workspaces/${ws}/service-accounts`;
  const as = (uid) => ({ authorization: `Bearer ${jwt.sign({ userId: uid, email: 'x@xeno.test', username: 'x' }, JWT_SECRET, { expiresIn: '1h' })}` });
  const call = async (uid, method, path = '') => { const r = await fetch(url + path, { method, headers: as(uid) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const audits = async () => Number((await pool.query(`SELECT count(*) n FROM workspace_audit WHERE workspace_id = $1 AND action IN ('service.grant','service.revoke')`, [ws])).rows[0].n);

  try {
    const list = await call(admin, 'GET');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.serviceAccounts.map((s) => s.id), [svc], 'only the service accounts that are members of the workspace');
    assert.equal((await call(member, 'GET')).status, 403, 'a member who is not an admin is refused');
    assert.equal((await call(stranger, 'GET')).status, 403, 'a stranger is refused');
    assert.equal((await call(admin, 'GET', `/${outsider}`)).status, 404, 'a service account outside the workspace is not visible');
    assert.equal((await call(admin, 'PUT', `/${outsider}/capabilities/storage`)).status, 404, 'nor grantable');
    assert.equal((await call(admin, 'PUT', `/${svc}/capabilities/root`)).status, 400, 'an unknown capability is refused');
    assert.equal((await call(member, 'PUT', `/${svc}/capabilities/storage`)).status, 403, 'a non-admin cannot grant');

    await assert.rejects(assertServiceGranted(pool, svc, 'storage', { workspaceId: ws }), ServicePrincipalDeniedError, 'before: the gate denies');
    const g = await call(admin, 'PUT', `/${svc}/capabilities/storage`);
    assert.equal(g.status, 200); assert.equal(g.body.changed, true);
    await assertServiceGranted(pool, svc, 'storage', { workspaceId: ws }); // passes: the tuple the gate reads exists
    // ── tenancy: the same service is also a member of workspace B, whose admin is someone else ──
    const adminB = await user('adminB');
    const wsB = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Other Co', $2) RETURNING id`, [adminB, `${tag}-b`])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `workspace:${wsB}`, relation: 'owner', subject: `user:${adminB}` }, { object: `workspace:${wsB}`, relation: 'viewer', subject: `user:${svc}` }] });
    await assert.rejects(assertServiceGranted(pool, svc, 'storage', { workspaceId: wsB }), ServicePrincipalDeniedError, 'a grant in workspace A does not allow acting in workspace B');
    const urlB = url.replace(ws, wsB);
    const inB = await (await fetch(urlB, { headers: as(adminB) })).json();
    assert.equal(inB.serviceAccounts[0].capabilities.find((c) => c.name === 'storage').granted, false, "B's admin does not see A's grant");
    assert.equal((await fetch(`${urlB}/${svc}/capabilities/storage`, { method: 'DELETE', headers: as(adminB) }).then((r) => r.json())).changed, false, "B's admin cannot revoke A's grant");
    await assertServiceGranted(pool, svc, 'storage', { workspaceId: ws }); // still granted in A
    assert.equal(await audits(), 1, 'the grant wrote one audit row');
    const again = await call(admin, 'PUT', `/${svc}/capabilities/storage`);
    assert.equal(again.body.changed, false); assert.equal(await audits(), 1, 'a repeated grant changes nothing and writes no audit row');
    const row = (await pool.query(`SELECT actor_user_id, target, metadata FROM workspace_audit WHERE workspace_id = $1 AND action = 'service.grant'`, [ws])).rows[0];
    assert.deepEqual([row.actor_user_id, row.target, row.metadata.capability], [admin, `user:${svc}`, 'storage'], 'the audit row names who, whom and what');

    const one = await call(admin, 'GET', `/${svc}`);
    assert.equal(one.body.history.length, 1); assert.equal(one.body.serviceAccount.capabilities.find((c) => c.name === 'storage').granted, true);

    const rv = await call(admin, 'DELETE', `/${svc}/capabilities/storage`);
    assert.equal(rv.body.changed, true); assert.equal(await audits(), 2, 'the revoke wrote one audit row');
    await assert.rejects(assertServiceGranted(pool, svc, 'storage', { workspaceId: ws }), ServicePrincipalDeniedError, 'after revoke: the gate denies again');

    // ── a legacy unscoped tuple: invisible to the screen, grants nothing; new ones refused by the schema ──
    assert.equal(await hasConstraint(), 1, 'the migration runner applied the constraint');
    await pool.query(DOWN); assert.equal(await hasConstraint(), 0, 'DOWN drops the constraint');
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('capability','tasks','grantee','user',$1)`, [svc]);
    await pool.query(UP); assert.equal(await hasConstraint(), 1, 'UP restores it, leaving existing rows in place');
    await assert.rejects(assertServiceGranted(pool, svc, 'tasks', { workspaceId: ws }), ServicePrincipalDeniedError, 'a legacy unscoped tuple grants nothing');
    assert.equal((await call(admin, 'GET')).body.serviceAccounts[0].capabilities.find((c) => c.name === 'tasks').granted, false, 'and is not shown as a grant');
    await assert.rejects(pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('capability','storage','grantee','user',$1)`, [svc]), /capability_scoped/, 'a new unscoped tuple is refused');
    await pool.query(`DELETE FROM relationship_tuples WHERE object_type='capability' AND subject_id=$1`, [svc]);
  } finally { server.close(); }
  console.log('service-account-grants: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
