/**
 * The workspace is the tenancy ROOT (migration 20261016180000), end to end against a real Postgres and the real
 * routers.
 *
 *   1. the migration backfills a personal workspace for every PERSON with none, and none for agents or services
 *   2. ONE creator: ensurePersonalWorkspace is idempotent, race-safe and heals a missing owner tuple; the routes and
 *      the divisions service go through it
 *   3. signup makes the root at once: an account never exists without its personal workspace
 *   4. a new organization is a COMPANY, made with its own wallet; an existing 'team' workspace still reads as one
 *   5. an agent made in a company is OWNED BY THE COMPANY, with its creator as the accountable admin (OWN-01, OWN-05);
 *      made anywhere else it is the person's; only a company admin may make one there
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/workspace-foundation.test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { workspaceRoutes } from '../routes/workspaceRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { check } from '../utils/authzReBAC.js';
import { createAgent } from '../services/agentIdentity.js';
import { ensurePersonalWorkspace } from '../services/workspaceLifecycle.js';
import { personalWorkspace } from '../services/workforceDivisions.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const personals = async (id) => (await pool.query("SELECT id FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal'", [id])).rows;

async function main() {
  // ── 1. the backfill: accounts that predate the root (made with no workspace), then the migration's UP is replayed
  //       (it is written to be re-runnable: it only fills what is missing) ──
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const mk = async (u, role) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role)
    VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [u, `${u}@example.test`, role || 'user'])).rows[0].id;
  const early = await mk('wsf-early'), svc = await mk('wsf-svc', 'service');
  const helper = await mk('wsf-agent-owner');
  const bot = (await createAgent(pool, { id: helper, kind: 'human', handle: 'wsf-agent-owner' }, { name: 'wsf-bot', displayName: 'Bot', agentRole: 'other' })).agent;
  const botId = (await pool.query('SELECT id FROM users WHERE username = $1', [bot.handle])).rows[0].id;
  const sql = fs.readFileSync(new URL('../database/migrations/20261016180000-workspace-root-and-company.sql', import.meta.url), 'utf8');
  await pool.query(sql.slice(0, sql.indexOf('-- DOWN')));
  await pool.query(sql.slice(0, sql.indexOf('-- DOWN')));   // and again: re-running changes nothing
  ok((await personals(early)).length === 1, 'the migration gives an account with no workspace its personal workspace (once, even run twice)');
  ok((await check(pool, { object: `workspace:${(await personals(early))[0].id}`, relation: 'owner', subject: `user:${early}` })).allowed, 'and makes the person its owner');
  ok((await personals(svc)).length === 0 && (await personals(botId)).length === 0, 'agents and service principals are not people and get none');

  // ── 2. one creator, idempotent, race-safe, healing ──
  const ada = await mk('wsf-ada'), bob = await mk('wsf-bob');
  const [a1, a2, a3] = await Promise.all([ensurePersonalWorkspace(pool, ada), ensurePersonalWorkspace(pool, ada), personalWorkspace(pool, ada)]);
  ok(a1.id === a2.id && String(a1.id) === a3 && (await personals(ada)).length === 1, 'three concurrent asks for the root make exactly one, through the one creator');
  await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1", [String(a1.id)]);
  await ensurePersonalWorkspace(pool, ada);
  ok((await check(pool, { object: `workspace:${a1.id}`, relation: 'owner', subject: `user:${ada}` })).allowed, 'a missing owner tuple is healed when the root is asked for');
  const someAgent = (await pool.query('SELECT user_id FROM agent_identities LIMIT 1')).rows[0];
  if (someAgent) { let refused = null; try { await ensurePersonalWorkspace(pool, someAgent.user_id); } catch (e) { refused = e; } ok(refused && refused.code === 'not_a_person', 'an agent is refused a workspace of its own'); }

  // ── the routers ──
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/workspaces', authMiddleware, workspaceRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, token, body) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), authorization: 'Bearer ' + token }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; } return { s: r.status, j };
  };
  const A = session(ada), B = session(bob);
  try {
    // ── 3. signup makes the root (exercised through the creator the signup paths call; the routes are covered by
    //       the auth suites, which now see a personal workspace on every new account) ──
    const listed = (await call('GET', '/api/workspaces', A)).j.workspaces;
    ok(listed.filter((w) => w.workspace_type === 'personal').length === 1 && listed.find((w) => w.workspace_type === 'personal').id === a1.id, 'the workspace list shows the one personal workspace');

    // ── 4. companies ──
    const made = await call('POST', '/api/workspaces', A, { name: 'Analytical Engines' });
    const co = made.j.workspace;
    ok(made.s === 200 && co && co.workspace_type === 'company', 'a new organization is a COMPANY workspace');
    ok((await pool.query('SELECT owner_kind FROM credit_accounts WHERE user_id = $1', [co.id])).rows[0]?.owner_kind === 'workspace', 'and its wallet is made with it (the ledger never meets the company id first)');
    ok((await check(pool, { object: `workspace:${co.id}`, relation: 'owner', subject: `user:${ada}` })).allowed, 'its founder owns it');
    const legacy = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Old Team','old-team-' || substr(md5(random()::text),1,8)) RETURNING id`, [ada])).rows[0].id;
    await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('workspace',$1,'owner','user',$2)`, [String(legacy), String(ada)]);
    ok((await call('GET', '/api/workspaces', A)).j.workspaces.some((w) => w.id === legacy), "a workspace made before companies existed ('team') still reads");
    let bad = null; try { await pool.query("INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'guild','x','x-guild')", [ada]); } catch (e) { bad = e; }
    ok(bad && bad.code === '23514', 'no other workspace type can be written (the database refuses)');

    // ── 5. company-owned agents ──
    const companyAgent = await call('POST', '/api/agents', A, { name: 'Ledger Clerk', workspaceId: co.id });
    const cag = companyAgent.j.agent;
    const own = cag && (await pool.query(`SELECT r.owner_workspace_id, r.owner_user_id AS r_owner, ai.owner_user_id AS accountable FROM agent_identities ai
      JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1`, [cag.id])).rows[0];
    ok(companyAgent.s === 201 && own && String(own.owner_workspace_id) === String(co.id) && own.r_owner === null, 'an agent made in a company is owned by the COMPANY');
    ok(own && String(own.accountable) === String(ada), 'and its creator is the human accountable for it');
    ok(cag && cag.owner && cag.owner.kind === 'company', 'the agent says so');
    const div = (await call('POST', '/api/divisions', A, { name: 'Finance', workspaceId: co.id })).j.division;
    const inDiv = (await call('POST', '/api/agents', A, { name: 'Payroll', divisionId: div.id })).j.agent;
    const divOwn = (await pool.query(`SELECT r.owner_workspace_id FROM agent_identities ai JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1`, [inDiv.id])).rows[0];
    ok(String(divOwn.owner_workspace_id) === String(co.id), "an agent made in one of the company's divisions is the company's too");
    const mine = (await call('POST', '/api/agents', A, { name: 'My Helper' })).j.agent;
    const mineOwn = (await pool.query(`SELECT r.owner_user_id, r.owner_workspace_id FROM agent_identities ai JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1`, [mine.id])).rows[0];
    ok(String(mineOwn.owner_user_id) === String(ada) && mineOwn.owner_workspace_id === null, 'an agent made anywhere else is the person’s own');
    const inPersonal = (await call('POST', '/api/agents', A, { name: 'Also Mine', workspaceId: String(a1.id) })).j.agent;
    const ipOwn = (await pool.query(`SELECT r.owner_user_id FROM agent_identities ai JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1`, [inPersonal.id])).rows[0];
    ok(String(ipOwn.owner_user_id) === String(ada), 'naming your own personal workspace makes it yours, never a company’s');
    const outsider = await call('POST', '/api/agents', B, { name: 'Sneak', workspaceId: co.id });
    ok(outsider.s === 403 || outsider.s === 404, `someone outside the company cannot make an agent it owns (${outsider.s})`);
    const listedByBob = (await call('GET', '/api/agents', B)).j.agents;
    ok(!listedByBob.some((a) => a.id === cag.id), 'and does not see its agents');
  } finally { server.close(); }
}

main().then(async () => { await pool.end(); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
