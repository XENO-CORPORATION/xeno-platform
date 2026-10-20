/**
 * A division's HOME, end to end on a real Postgres and the REAL routers (DIV-01..DIV-10, VIEW-05).
 *
 *   1. the home arrives through the scoped read (division:<id> / home) with a revision
 *   2. a stranger gets 404 — the division reads as absent, exactly like a missing one
 *   3. per row: a workspace member who cannot see a project gets it CLOSED (hidden count), never the row;
 *      the same for its funding pools, the runs on it, handoffs they are not part of, and the spend ledger
 *   4. objectives: a division objective is created through the LIFE-08 service and shows with goal progress
 *   5. an active run shows with live authority; once revoked it leaves the home
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/division-home.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { admitAccountRun, readRunnablePin } from '../services/workforceRunAdmission.js';
import { revokeRun } from '../services/workforceRunAuthority.js';
import { createObjective } from '../services/projectWorktree.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('dh-ada'), bob = await mk('dh-bob'), eve = await mk('dh-eve');
  await addGrant(pool, ada, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:dh-ada' });
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob), E = session(eve);
  const project = async (name) => { const r = await call('POST', '/api/chat/projects', { body: { name }, headers: { 'x-as': ada } }); return String((r.j.project || r.j.data || r.j).id); };

  try {
    const ws = (await call('GET', '/api/divisions', { token: A })).j.workspaceId;
    // bob is a member of ada's workspace (a viewer), eve is a stranger
    await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'viewer', subject: `user:${bob}` }] });
    const dev = (await call('POST', '/api/divisions', { token: A, body: { name: 'Dev' } })).j.division;
    const inner = (await call('POST', '/api/divisions', { token: A, body: { name: 'Platform', parentId: dev.id } })).j.division;
    await call('PATCH', `/api/divisions/${dev.id}`, { token: A, body: { headId: ada, reason: 'Founder' } });
    const shared = await project('Shared'), secret = await project('Secret');
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'viewer', subject: `user:${bob}` }] });
    await call('PUT', `/api/divisions/projects/${shared}`, { token: A, body: { divisionId: dev.id } });
    await call('PUT', `/api/divisions/projects/${secret}`, { token: A, body: { divisionId: dev.id } });
    const agent = (await call('POST', '/api/agents', { token: A, body: { name: 'Builder', description: 'Builds', instructions: 'Be careful.', divisionId: dev.id } })).j.agent;
    await call('PUT', `/api/divisions/${dev.id}/agent-budget`, { token: A, body: { credits: 50, windowDays: 30 } });

    // 4. objective through LIFE-08
    const obj = await createObjective(pool, { actorUserId: ada, workspaceId: ws, divisionId: dev.id, title: 'Ship v1', successEvidence: 'Release on R2', ownerUserId: ada, windowStart: '2026-10-01', windowEnd: '2026-12-31' });

    // 5. an admitted run of the division's agent
    const def = (await pool.query('SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].workforce_resource_id;
    const ctx = { actorUserId: ada, clientId: 'division-home-test' };
    const target = { kind: 'personal', ownerUserId: ada };
    const pin = await readRunnablePin(pool, ctx, { agent: { resourceId: def }, target });
    const { admission } = await admitAccountRun(pool, ctx, { operationId: crypto.randomUUID(), agent: pin.agent, target, capabilities: pin.terms.definition, budget: { ceilingMicro: '2000000' }, taskRef: 'T-1' });

    // 1. ada's home
    const h = await call('GET', `/api/divisions/${dev.id}/home`, { token: A });
    const home = h.j.home;
    ok(h.s === 200 && h.j.state === 'fresh' && Number.isInteger(h.j.revision), 'the home is read through the scoped read, with a revision');
    ok(home.head && home.head.id === ada && home.children.some((c) => c.id === inner.id), 'it carries the head and the divisions inside it');
    ok(home.agents.some((a) => a.id === agent.id), 'it lists the division’s agents');
    ok(home.directMembers.some((m) => m.id === ada && m.isHead), 'the head is a direct member of the division');
    ok(home.projects.rows.length === 2 && home.projects.hidden === 0, 'the workspace admin sees both projects');
    ok(home.objectives.length === 1 && home.objectives[0].id === obj.objectiveId && home.objectives[0].goals === 0, 'the division objective shows, with its goal progress');
    ok(home.runs.rows.length === 1 && home.runs.rows[0].id === admission.admissionId && home.runs.rows[0].canStop === true && home.runs.rows[0].authority.state === 'admitted', 'the active run shows with its live authority');
    ok(home.spend.budget && home.spend.budget.limitCredits === 50 && Array.isArray(home.spend.ledger), 'spend vs budget, with the ledger for an admin');
    ok(home.decisions.some((d) => d.kind === 'member.promote' && d.rationale === 'Founder'), 'the head decision is listed with its reason');

    // 3. bob, a member who cannot see the secret project
    const hb = (await call('GET', `/api/divisions/${dev.id}/home`, { token: B })).j.home;
    ok(hb.projects.rows.length === 1 && hb.projects.rows[0].id === shared && hb.projects.hidden === 1, 'a member sees only the project they view — the other arrives closed');
    ok(!JSON.stringify(hb).includes('Secret'), 'and nothing of the closed project leaks, not even its name');
    ok(hb.runs.rows.length === 0 && hb.runs.hidden === 1, 'a run that is not theirs, on no project they see, arrives closed');
    ok(hb.spend.ledger && hb.spend.ledger.closed === true && hb.spend.budget, 'they see the meter but the ledger arrives closed');
    ok(hb.canManage === false && hb.objectives.length === 1, 'they read the objectives but do not manage');

    // 2. a stranger
    ok((await call('GET', `/api/divisions/${dev.id}/home`, { token: E })).s === 404, 'a stranger gets 404 — the division reads as absent');
    ok((await call('GET', `/api/divisions/${crypto.randomUUID()}/home`, { token: A })).s === 404, 'a missing division is the same 404');

    // 5b. revoked runs leave the home
    await revokeRun(pool, { actorUserId: ada }, admission.admissionId);
    ok((await call('GET', `/api/divisions/${dev.id}/home`, { token: A })).j.home.runs.rows.length === 0, 'a revoked run leaves the home');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
