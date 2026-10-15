/**
 * Agents use Images, Video, Library and Chat (item 9), end to end against a real database and the real routers:
 *
 *  - over XENO MCP an agent's own credential lists image_/video_/library_/chat_ tools beside tasks_; a person's
 *    OAuth connection does not get them, and calling one as a person is refused;
 *  - an agent's generation is a PROPOSAL: with no division budget it waits for its owner and says so;
 *  - a workspace admin sets the division's agent budget with "approve within budget": the next generation is
 *    approved at once, on the owner's behalf, its maximum reserved against the division;
 *  - when the division's budget is used up the agent is refused with the reason, and nothing is proposed;
 *  - a failed generation gives its reservation back;
 *  - Chat: one model call is billed to the owner and counted against the division (and refused past it);
 *  - Library: the agent reads what its projects hold and what it made, never a person's private file, and can
 *    attach what it made to its project.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/agent-media-tools.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import xenoMcpRoutes, { management, personOnly } from '../routes/xenoMcpRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import * as media from '../services/agentMedia.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

// the gateway's catalog, as the platform reads it: one image model and one video model, both async
const models = async () => [{ id: 'gpt-image-2', execution: { endpoint: '/v1/images/generations', async: true } }, { id: 'omni_11_flash', execution: { endpoint: '/v1/videos/generations', async: true } }];
const opts = { gateway: { models } };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('amt-ada'), cal = await mk('amt-cal');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', 'acme-amt') RETURNING id`, [ada])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'owner', subject: `user:${ada}` }, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${ada}` }, { object: `workspace:${ws}`, relation: 'editor', subject: `user:${cal}` }] });

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/mcp', (req, res, next) => (req.path === '/' ? xenoMcpRoutes(req, res, next) : next()));
  app.use('/api/mcp', authMiddleware, personOnly, management);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, (req, _r, n) => { req.owner = req.user.id; n(); }, workforceDivisionRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  let rid = 0;
  const rpc = (token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });

  try {
    // an agent in a division, on a project in that division, with a credential
    const dr = await call('POST', '/api/divisions', { token: session(ada), body: { workspaceId: ws, name: 'Design' } }); if (!dr.j.division) throw new Error('division: ' + JSON.stringify(dr)); const div = dr.j.division;
    const proj = (await pool.query(`INSERT INTO chat_projects (user_id, owner_user_id, workspace_id, name) VALUES ($1, NULL, $2, 'Launch') RETURNING id`, [ada, ws])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `project:${proj}`, relation: 'parent', subject: `workspace:${ws}` }] });
    await call('PUT', `/api/divisions/projects/${proj}`, { token: session(ada), body: { divisionId: div.id } });
    // a company agent (Acme owns it; the transfer flow is proven in agent-company-ownership), placed in Design
    const made = (await call('POST', '/api/agents', { token: session(ada), body: { name: 'Pixel Bot', instructions: 'Make the launch images.' } })).j.agent;
    await pool.query(`UPDATE workforce_resources SET owner_workspace_id = $2, owner_user_id = NULL, revision = revision + 1 WHERE id = (SELECT workforce_resource_id FROM agent_identities WHERE user_id = $1)`, [made.userId, ws]);
    const agr = await call('PUT', `/api/agents/${made.id}/division`, { token: session(ada), body: { divisionId: div.id } });
    if (!agr.j.agent) throw new Error('agent: ' + JSON.stringify(agr));
    const ag = agr.j.agent;
    await call('PUT', `/api/agents/${ag.id}/projects/${proj}`, { token: session(ada), body: {} });
    const tok = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: session(ada), body: {} })).j.credential.token;
    const actor = { id: ag.userId, kind: 'agent' };

    // 1. the tools are listed for the agent, and not for a person
    const names = (await rpc(tok, 'tools/list', {})).j.result.tools.map((t) => t.name);
    check(['image_generate', 'video_generate', 'library_list_files', 'library_get_file', 'chat_ask', 'tasks_list_projects'].every((n) => names.includes(n)), `an agent's credential lists Images, Video, Library and Chat beside Tasks (${names.length} tools)`);
    const services = (await call('GET', '/api/mcp/services', { token: session(ada) })).j.services;
    check(services.filter((s) => s.agentsOnly).map((s) => s.category).sort().join() === 'chat,image,library,video', 'the services list marks the four as agent services');

    // 2. no division budget: a generation waits for the owner, and says so
    const g1 = await media.generate(pool, actor, 'image', { prompt: 'A launch banner, white on black', projectId: proj }, opts);
    check(g1.state === 'waiting_for_approval' && /approve it/.test(g1.note) && /no agent budget/.test(g1.note), 'with no division budget, an image waits for the owner and says why');
    const row1 = (await pool.query('SELECT state, actor_user_id, owner_user_id FROM media_generations WHERE id = $1', [g1.id])).rows[0];
    check(row1.state === 'awaiting_approval' && row1.actor_user_id === ag.userId && row1.owner_user_id === ada, 'it is recorded as the agent’s proposal, billed to its owner once approved');

    // 3. the division's budget with "approve within budget": approved at once, reserved against the division
    check((await call('PUT', `/api/divisions/${div.id}/agent-budget`, { token: session(cal), body: { credits: 50, autoApprove: true } })).s === 403, 'only a workspace admin sets the division’s budget');
    const set = await call('PUT', `/api/divisions/${div.id}/agent-budget`, { token: session(ada), body: { credits: 50, windowDays: 30, autoApprove: true } });
    check(set.s === 200 && set.j.budget.limitCredits === 50 && set.j.budget.autoApprove === true, 'an admin sets 50 credits a month, approved within budget');
    const g2 = await media.generate(pool, actor, 'image', { prompt: 'A second banner', projectId: proj, requestKey: 'banner-2' }, opts);
    const row2 = (await pool.query('SELECT state, approved_by_user_id FROM media_generations WHERE id = $1', [g2.id])).rows[0];
    check(g2.state === 'running' && row2.state === 'queued' && row2.approved_by_user_id === ada, 'inside the budget it is approved at once, on the owner’s behalf, and queued to run');
    const res2 = (await pool.query(`SELECT amount_micro, state FROM agent_spend_log WHERE ref = $1`, [`generation:${g2.id}`])).rows[0];
    check(res2 && Number(res2.amount_micro) > 0 && res2.state === 'reserved', 'its maximum cost is reserved against the division');
    const again = await media.generate(pool, actor, 'image', { prompt: 'A second banner', projectId: proj, requestKey: 'banner-2' }, opts);
    check(again.id === g2.id && (await pool.query(`SELECT count(*)::int AS n FROM agent_spend_log WHERE ref = $1`, [`generation:${g2.id}`])).rows[0].n === 1, 'the same request key returns the same generation and reserves nothing twice');
    const view = (await call('GET', `/api/divisions/${div.id}/agent-budget`, { token: session(ada) })).j;
    check(view.budget.spentCredits > 0 && view.spend.some((x) => x.agent.id === ag.id && x.kind === 'image'), 'the division page shows what its agents spent, and on what');

    // 4. a failed generation gives its reservation back
    await pool.query(`UPDATE media_generations SET state = 'failed' WHERE id = $1`, [g2.id]);
    await media.settleReservations(pool, [g2.id]);
    check((await pool.query(`SELECT state FROM agent_spend_log WHERE ref = $1`, [`generation:${g2.id}`])).rows[0].state === 'released', 'a failed generation releases what it reserved');

    // 5. past the budget: refused with the reason, and nothing is proposed
    await call('PUT', `/api/divisions/${div.id}/agent-budget`, { token: session(ada), body: { credits: 0.01, autoApprove: true } });
    const before = (await pool.query('SELECT count(*)::int AS n FROM media_generations WHERE actor_user_id = $1 AND state <> \'awaiting_approval\'', [ag.userId])).rows[0].n;
    let refused = null; try { await media.generate(pool, actor, 'video', { prompt: 'A teaser', projectId: proj }, opts); } catch (e) { refused = e; }
    check(refused && refused.code === 'division_budget_exhausted' && /Design has used its agent budget/.test(refused.message), 'past the division budget a video is refused, and says why');
    check((await pool.query('SELECT count(*)::int AS n FROM media_generations WHERE actor_user_id = $1 AND state <> \'awaiting_approval\'', [ag.userId])).rows[0].n === before, 'and nothing was queued to run');
    const viaMcp = await rpc(tok, 'tools/call', { name: 'video_generate', arguments: { prompt: 'A teaser' } });
    check(viaMcp.j.result.isError === true, 'over MCP it is a tool error the agent can read');

    // 6. Chat: billed to the owner, counted against the division
    await call('PUT', `/api/divisions/${div.id}/agent-budget`, { token: session(ada), body: { credits: 50, autoApprove: true } });
    const meter = async (db, who, o) => ({ result: await o.run({ maxOutputTokens: 100 }), creditsCharged: 0.5, costMicro: 500_000, who });
    let meteredAs = null;
    const a1 = await media.ask(pool, actor, { prompt: 'Name three colours for a launch' }, { meter: async (db, who, o) => { meteredAs = who; return meter(db, who, o); }, complete: async () => ({ choices: [{ message: { content: 'Black, white, silver' } }], usage: { prompt_tokens: 5, completion_tokens: 4 } }) });
    check(a1.answer === 'Black, white, silver' && meteredAs === ag.userId, 'chat_ask answers, metered as the agent (the meter bills its owner)');
    const logged = (await pool.query(`SELECT amount_micro FROM agent_spend_log WHERE agent_user_id = $1 AND kind = 'model' AND state = 'reserved'`, [ag.userId])).rows;
    check(logged.length === 1 && Number(logged[0].amount_micro) === 500_000, 'the division is charged what was actually spent, and the reservation is released');
    await call('PUT', `/api/divisions/${div.id}/agent-budget`, { token: session(ada), body: { credits: 0.5, autoApprove: true } });
    let r2 = null; try { await media.ask(pool, actor, { prompt: 'Again' }, { meter, complete: async () => ({ choices: [{ message: { content: 'x' } }] }) }); } catch (e) { r2 = e; }
    check(r2 && r2.code === 'division_budget_exhausted', 'past the budget chat_ask is refused before any model call');

    // 7. Library: the project's files and its own, never a person's private file
    const mkFile = async (owner, name) => (await pool.query(`INSERT INTO user_files (user_id, owner_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type) VALUES ($1, $1, $2, $2, 'text', 'text/plain', 5, '/tmp/x', 'platform-upload') RETURNING id`, [owner, name])).rows[0].id;
    const shared = await mkFile(ada, 'brief.txt'), secret = await mkFile(ada, 'private.txt');
    await writeTuples(pool, { writes: [{ object: `library_asset:${shared}`, relation: 'owner', subject: `user:${ada}` }, { object: `library_asset:${secret}`, relation: 'owner', subject: `user:${ada}` }] });
    await pool.query(`INSERT INTO chat_project_assets (project_id, asset_id, added_by_user_id) VALUES ($1, $2, $3)`, [proj, shared, ada]);
    await writeTuples(pool, { writes: [{ object: `library_asset:${shared}`, relation: 'parent', subject: `project:${proj}` }] });
    const files = await media.listFiles(pool, actor, {});
    check(files.in_your_projects.some((f) => f.asset_id === shared) && !files.in_your_projects.some((f) => f.asset_id === secret), 'the agent lists its project’s files, not its owner’s private ones');
    const got = await media.getFile(pool, actor, shared);
    check(got.asset_id === shared && /library\?sel=/.test(got.url), 'it reads a project file, with a link people can open');
    let r3 = null; try { await media.getFile(pool, actor, secret); } catch (e) { r3 = e; }
    check(r3 && r3.code === 'file_not_found', 'a private file reads as not found');
    let r4 = null; try { await media.attachFile(pool, actor, shared, proj); } catch (e) { r4 = e; }
    check(r4 && r4.code === 'not_your_file', 'it can only attach files it made');

    // 8. a person cannot call agent tools, even with an agent-category connection
    const asPerson = await media.listFiles(pool, { id: ada, kind: 'human' }, {}).catch((e) => e);
    check(asPerson instanceof media.MediaError && asPerson.code === 'agents_only', 'the agent tools refuse a person');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\nagent-media-tools: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
