/**
 * agents-whoami.test.mjs — XENO MCP `agents_whoami` (services/agentsMcp.js), through the real gateway (xenoMcp.callTool)
 * against real PostgreSQL with every migration.
 *
 * Mutation checks (each verified to fail the named test):
 *   - drop `agents` from AGENT_DEFAULT_CATEGORIES                -> "a platform agent's credential lists and calls agents_whoami"
 *   - let a person call it                                      -> "a person, or a connection with agents turned off, is refused"
 *   - report the owner from the actor instead of the principal  -> "it describes the caller from the platform's own rows"
 *   - give the MCP tool its own builder instead of agentMe        -> "MCP and GET /api/tasks/agent/me return identical JSON"
 *
 * Run: DATABASE_URL=postgresql://… node tests/agents-whoami.test.mjs (a disposable database).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import xenoMcpRoutes from '../routes/xenoMcpRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import * as agents from '../services/platformAgents.js';
import * as mcp from '../services/xenoMcp.js';
import { resolvePrincipal } from '../services/agentIdentity.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (a disposable database)');

test('agents_whoami', { timeout: 300000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  t.after(() => pool.end());
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const name = `who_${randomUUID().slice(0, 8)}`;
  const ada = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,'Ada L',true,true,'x') RETURNING id::text AS id`, [name, `${name}@who.test`])).rows[0];
  const agent = await agents.create(pool, await resolvePrincipal(pool, ada.id), { name: 'Release Bot' });
  const actor = { id: agent.userId, kind: 'agent', name: 'Release Bot' };   // as xenoMcpRoutes builds it
  const conn = { categories: [...mcp.AGENT_DEFAULT_CATEGORIES] };

  await t.test("a platform agent's credential lists and calls agents_whoami", async () => {
    assert.ok(mcp.listTools(conn, actor).some((x) => x.name === 'agents_whoami'));
    const r = await mcp.callTool(pool, actor, conn, 'agents_whoami', {});
    assert.equal(r.result.isError, undefined, JSON.stringify(r.result));
    assert.equal(r.log.outcome, 'ok');
  });

  await t.test('MCP and GET /api/tasks/agent/me return identical JSON for the same agent', async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
    app.use('/api/mcp', (req, res, next) => (req.path === '/' ? xenoMcpRoutes(req, res, next) : next()));
    const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cred = await agents.mintCredential(pool, await resolvePrincipal(pool, ada.id), agent.id, {});
    const auth = { authorization: `Bearer ${cred.token}` };
    const rest = await (await fetch(`${origin}/api/tasks/agent/me`, { headers: auth })).json();
    const rpc = await (await fetch(`${origin}/api/mcp`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'agents_whoami', arguments: {} } }) })).json();
    assert.ok(rest.success && rest.agent, JSON.stringify(rest));
    assert.ok(rpc.result && !rpc.result.isError, JSON.stringify(rpc));
    assert.deepEqual(rpc.result.structuredContent, rest, 'one code path, one JSON');
    assert.equal(rest.agent.agentId, agent.id);
    assert.ok(rest.agent.scopes && rest.agent.expiresAt, 'the credential facts are present on both');
  });

  await t.test("it describes the caller from the platform's own rows", async () => {
    const me = (await mcp.callTool(pool, actor, conn, 'agents_whoami', {})).result.structuredContent.agent;
    assert.equal(me.agentId, agent.id);
    assert.equal(me.id, agent.userId, 'id stays the internal id, as the REST endpoint always answered');
    assert.equal(me.name, 'Release Bot');
    assert.equal(me.status, 'active');
    assert.equal(me.owner.handle, name, 'the owner is the person, by handle');
    assert.ok(me.workspace && me.workspace.id && me.workspace.kind === 'personal', JSON.stringify(me.workspace));
    assert.deepEqual(me.projects, []);
    assert.equal(me.division, null, 'no division: null, never invented');
    assert.equal(me.budget, null, 'no division budget: null');
    for (const k of ['id', 'agentId', 'division', 'expiresAt', 'name', 'kind', 'scopes', 'task']) assert.ok(k in me, `original field ${k} kept`);
    for (const k of ['handle', 'status', 'workspace', 'owner', 'accountable', 'projects', 'budget']) assert.ok(k in me, `additive field ${k}`);
  });

  await t.test('a person, or a connection with agents turned off, is refused', async () => {
    const asPerson = await mcp.callTool(pool, { id: ada.id, kind: 'human' }, conn, 'agents_whoami', {});
    assert.equal(asPerson.result.isError, true); assert.equal(asPerson.result.structuredContent.code, 'agents_only');
    assert.ok(!mcp.listTools(conn, { id: ada.id, kind: 'human' }).some((x) => x.name === 'agents_whoami'));
    const off = await mcp.callTool(pool, actor, { categories: ['tasks'] }, 'agents_whoami', {});
    assert.equal(off.result.structuredContent.code, 'category_disabled');
  });

  const LEGACY = `agent:legacy-${randomUUID()}`;
  await t.test('existing agent credential connections gain the category (migration 20261018211000)', async () => {
    // re-apply the migration's statement on a connection stored before the category existed
    await pool.query(`INSERT INTO mcp_connections (owner_user_id, agent_user_id, client_id, client_name, categories) VALUES ($1, $2, $3, 'old', '{tasks,image}')`, [ada.id, agent.userId, LEGACY]);
    const sql = (await import('node:fs')).readFileSync(new URL('../database/migrations/20261018211000-mcp-agents-category.sql', import.meta.url), 'utf8').split(/^--\s*DOWN\b/im)[0].replace(/^--.*$/gm, '');
    await pool.query(sql);
    const c = (await pool.query(`SELECT categories FROM mcp_connections WHERE client_id = $1`, [LEGACY])).rows[0].categories;
    assert.deepEqual(c, ['tasks', 'image', 'agents']);
    await pool.query(sql);
    assert.deepEqual((await pool.query(`SELECT categories FROM mcp_connections WHERE client_id = $1`, [LEGACY])).rows[0].categories, ['tasks', 'image', 'agents'], 'idempotent');
  });
});
