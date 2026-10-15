/**
 * Agents and divisions, end to end against a real Postgres and the REAL routers (XENO-WORKFORCE-01 OWN-02,
 * OWN-03, DIV-01..DIV-08).
 *
 *   1. an agent is TWO linked records: creating one makes a workforce definition AND a principal, linked once
 *   2. instructions are versioned: an edit is a new immutable version; the link cannot be re-pointed
 *   3. divisions: created only by a workspace admin, nested in the same workspace, never a cycle, archived one-way
 *   4. DIV-04: a project has one owning division in its own workspace
 *   5. DIV-08: an agent can only be given projects in its own division; the server refuses the rest,
 *      and moving the agent takes away projects that no longer match
 *   6. the boundary holds over XENO MCP: an agent's credential sees only its division's projects
 *   7. a division's head acts inside it (editor on the division) and only there
 *   8. an older agent with no definition is given one on first use (adoption)
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/agents-divisions.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import oauth2Routes from '../routes/oauth2Routes.js';
import crypto from 'node:crypto';
import xenoMcpRoutes, { personOnly } from '../routes/xenoMcpRoutes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { check } from '../utils/authzReBAC.js';
import { createAgent } from '../services/agentIdentity.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check_ = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };

async function main() {
  await runAllMigrations(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid, updated_at timestamptz, UNIQUE (source_system, platform_user_id))`).catch(() => {});
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('adiv-ada'), bob = await mk('adiv-bob');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/oauth2', oauth2Routes);
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/mcp', (req, res, next) => (req.path === '/' ? xenoMcpRoutes(req, res, next) : next()));
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob);
  let rid = 0;
  const rpc = (token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });
  const project = async (name, as = ada) => { const r = await call('POST', '/api/chat/projects', { body: { name }, headers: { 'x-as': as } }); return String((r.j.project || r.j.data || r.j).id); };

  try {
    // 3. divisions
    const none = await call('GET', '/api/divisions', { token: A });
    check_(none.s === 200 && none.j.divisions.length === 0 && none.j.canManage === true, 'a personal workspace starts with NO divisions, and its owner may manage them (D16, DIV-03)');
    const ws = none.j.workspaceId;
    const dev = (await call('POST', '/api/divisions', { token: A, body: { name: 'Dev' } })).j.division;
    const creative = (await call('POST', '/api/divisions', { token: A, body: { name: 'Creative' } })).j.division;
    const platform = (await call('POST', '/api/divisions', { token: A, body: { name: 'Platform', parentId: dev.id } })).j.division;
    check_(dev && creative && platform && platform.parentId === dev.id && dev.key === 'dev', 'the owner creates divisions, and one inside another (D15)');
    check_((await call('PATCH', `/api/divisions/${dev.id}`, { token: A, body: { parentId: platform.id } })).j.code === 'division_cycle', 'a division cannot sit inside its own child');
    check_((await call('POST', '/api/divisions', { token: B, body: { name: 'X', workspaceId: ws } })).s === 404, "another person cannot create a division in someone else's workspace (404)");
    check_((await call('GET', `/api/divisions/${dev.id}`, { token: B })).s === 404, 'nor see one');
    const bobWs = (await call('GET', '/api/divisions', { token: B })).j.workspaceId;
    const bobDiv = (await call('POST', '/api/divisions', { token: B, body: { name: 'Bob dept' } })).j.division;
    check_(bobWs !== ws && bobDiv && bobDiv.workspaceId === bobWs, 'each person has their own workspace and divisions');

    // 1. an agent is two linked records
    const made = await call('POST', '/api/agents', { token: A, body: { name: 'Builder', description: 'Builds things', instructions: 'Be careful.', divisionId: dev.id } });
    const ag = made.j.agent;
    check_(made.s === 201 && /^agt_[0-9a-f]{32}$/.test(ag.id) && ag.definitionId && ag.division && ag.division.id === dev.id, 'creating an agent makes its definition and its principal, in the chosen division');
    const link = (await pool.query('SELECT ai.workforce_resource_id, r.kind, r.owner_user_id FROM agent_identities ai JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1', [ag.id])).rows[0];
    check_(link && link.kind === 'agent' && String(link.owner_user_id) === String(ada), 'the principal is linked to a workforce agent definition owned by the person (OWN-02)');
    check_(ag.version === 1 && ag.instructions === 'Be careful.', 'its instructions are version 1 of its definition');

    // 2. versions
    const v2r = await call("PATCH", `/api/agents/${ag.id}`, { token: A, body: { instructions: "Be careful. Ask first." } }); if (!v2r.j.agent) console.log("PATCH said", JSON.stringify(v2r)); const v2 = v2r.j.agent || {};
    check_(v2.version === 2 && v2.versions.length === 2 && v2.versions[1].instructions === 'Be careful.', 'editing instructions writes version 2 and keeps version 1 unchanged (OWN-03)');
    const same = (await call('PATCH', `/api/agents/${ag.id}`, { token: A, body: { instructions: 'Be careful. Ask first.' } })).j.agent;
    check_(same.version === 2, 'saving the same instructions does not make an empty version');
    let repoint = null; try { await pool.query('UPDATE agent_identities SET workforce_resource_id = gen_random_uuid() WHERE public_id = $1', [ag.id]); } catch (e) { repoint = e; }
    check_(repoint && /cannot change the definition/.test(repoint.message), 'the link cannot be re-pointed to another definition (database refuses)');

    // 4. projects in divisions
    const pDev = await project('Dev project'), pCreative = await project('Creative project'), pLoose = await project('Loose project');
    check_((await call('PUT', `/api/divisions/projects/${pDev}`, { token: A, body: { divisionId: dev.id } })).j.division.id === dev.id, 'a project is put in a division');
    await call('PUT', `/api/divisions/projects/${pCreative}`, { token: A, body: { divisionId: creative.id } });
    check_((await call('PUT', `/api/divisions/projects/${pDev}`, { token: A, body: { divisionId: bobDiv.id } })).s === 404, "a project cannot join another workspace's division");
    let dup = null; try { await pool.query('INSERT INTO workforce_project_divisions (project_id, division_id) VALUES ($1, $2)', [pDev, creative.id]); } catch (e) { dup = e; }
    check_(dup && dup.code === '23505', 'a project has at most one owning division (the primary key, DIV-04)');

    // 5. the division boundary
    check_((await call('PUT', `/api/agents/${ag.id}/projects/${pDev}`, { token: A, body: {} })).s === 200, 'a Dev agent is given a Dev project');
    const cross = await call('PUT', `/api/agents/${ag.id}/projects/${pCreative}`, { token: A, body: {} });
    check_(cross.s === 409 && cross.j.code === 'division_mismatch' && /Creative/.test(cross.j.error), `it is REFUSED a Creative project, and told why (${cross.j && cross.j.error})`);
    check_((await call('PUT', `/api/agents/${ag.id}/projects/${pLoose}`, { token: A, body: {} })).j.code === 'division_mismatch', 'and refused a project in no division');
    const choices = (await call('GET', `/api/agents/${ag.id}/project-choices`, { token: A })).j.projects;
    check_(choices.find((p) => p.id === pDev).canGive && !choices.find((p) => p.id === pCreative).canGive, 'the choices say which projects match its division');
    check_((await check(pool, { object: `division:${dev.id}`, relation: 'editor', subject: `agent:${(await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [ag.id])).rows[0].user_id}` })).allowed, 'the agent acts inside its division (editor on it) — what run admission reads (DIV-08)');

    // 6. over MCP
    const cred = (await call('POST', `/api/agents/${ag.id}/credentials`, { token: A, body: {} })).j.credential;
    const seen = (await rpc(cred.token, 'tools/call', { name: 'tasks_list_projects', arguments: {} })).j.result.structuredContent.projects.map((p) => p.id);
    check_(seen.includes(pDev) && !seen.includes(pCreative) && !seen.includes(pLoose), 'over XENO MCP its credential sees only its division\'s project');

    // moving the agent takes away what no longer matches
    const moved = (await call('PUT', `/api/agents/${ag.id}/division`, { token: A, body: { divisionId: creative.id } })).j.agent;
    check_(moved.division.id === creative.id && !moved.projects.some((p) => p.id === pDev), 'moving it to Creative takes away its Dev project at once');
    const seen2 = (await rpc(cred.token, 'tools/call', { name: 'tasks_list_projects', arguments: {} })).j.result.structuredContent.projects;
    check_(seen2.length === 0, 'and its live credential no longer sees it');
    const agentUser = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [ag.id])).rows[0].user_id;
    check_(!(await check(pool, { object: `division:${dev.id}`, relation: 'editor', subject: `agent:${agentUser}` })).allowed, 'and it no longer acts inside Dev');
    const fund = (await pool.query('SELECT division_id FROM workforce_division_funding WHERE resource_id = $1', [link.workforce_resource_id])).rows[0];
    check_(fund && String(fund.division_id) === creative.id, 'its funding scope followed, because nobody had chosen it separately (D17)');
    // moving a project out of the agent's division removes it too
    await call('PUT', `/api/agents/${ag.id}/projects/${pCreative}`, { token: A, body: {} });
    const out = await call('PUT', `/api/divisions/projects/${pCreative}`, { token: A, body: { divisionId: dev.id } });
    check_(out.j.agentsRemoved === 1 && !(await call('GET', `/api/agents/${ag.id}`, { token: A })).j.agent.projects.length, 'moving a project to another division removes the agents that no longer match');

    // 7. head
    const headed = (await call('PATCH', `/api/divisions/${dev.id}`, { token: A, body: { headId: agentUser } })).j.division;
    check_(headed.head && headed.head.kind === 'agent', 'an agent can head a division (DIV-06)');
    check_((await call('PATCH', `/api/divisions/${dev.id}`, { token: A, body: { headId: bob } })).j.code === 'head_not_member', 'someone outside the workspace cannot head it');
    check_(!(await check(pool, { object: `division:${platform.id}`, relation: 'editor', subject: `user:${agentUser}` })).allowed, 'the head of Dev does NOT thereby act inside Platform (D15: no parent inheritance)');

    // archive
    check_((await call('POST', `/api/divisions/${dev.id}/archive`, { token: A })).j.code === 'division_has_children', 'a division with active children cannot be archived');
    const arch = (await call('POST', `/api/divisions/${platform.id}/archive`, { token: A })).j.division;
    check_(arch.lifecycle === 'archived', 'an empty child division is archived');
    check_((await call('PUT', `/api/divisions/projects/${pLoose}`, { token: A, body: { divisionId: platform.id } })).j.code === 'division_archived', 'an archived division admits no new project');
    let reopen = null; try { await pool.query(`UPDATE workforce_divisions SET lifecycle='active', revision=revision+1 WHERE id=$1`, [platform.id]); } catch (e) { reopen = e; }
    check_(reopen, 'archive is one-way (OWN-06)');

    // 8. adoption
    const owner = (await pool.query('SELECT username FROM users WHERE id = $1', [ada])).rows[0];
    const old = await createAgent(pool, { id: ada, kind: 'human', handle: owner.username }, { name: 'old-one', displayName: 'Old One', agentRole: 'other', agentOrigin: 'tasks' });
    const oldPid = (await pool.query('SELECT ai.public_id FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE u.username = $1', [old.agent.handle])).rows[0].public_id;
    const adopted = (await call('GET', `/api/agents/${oldPid}`, { token: A })).j.agent;
    check_(adopted.definitionId && adopted.version === 1, 'an agent made before the link gets its definition on first use');
    const again = (await call('GET', `/api/agents/${oldPid}`, { token: A })).j.agent;
    check_(again.definitionId === adopted.definitionId, 'and only once');
    check_((await call('GET', '/api/agents', { token: A })).j.agents.some((a) => a.id === oldPid), 'and the one Agents list shows it (Tasks agents and platform agents are one list)');
    check_((await call('GET', `/api/agents?division=${creative.id}`, { token: A })).j.agents.map((a) => a.id).join() === ag.id, 'the list filters by division');

    // the cap counts the agents a person made, never the ones the platform made for them
    for (const o of ['forum-loop-d', 'forum-loop-d', 'forum-loop-d', 'forum-loop-d', 'status-probe', 'mcp']) {
      await createAgent(pool, { id: bob, kind: 'human', handle: 'adiv-bob' }, { name: 'sys-' + o + Math.random().toString(36).slice(2, 6), displayName: 'Sys', agentRole: 'other', agentOrigin: o, cap: 20 });
    }
    const bobList = (await call('GET', '/api/agents', { token: B })).j.agents;
    const bobMade = await call('POST', '/api/agents', { token: B, body: { name: 'Bobs first' } });
    check_(bobList.length === 0 && bobMade.s === 201, `six system agents neither show in the list nor block creating one (${bobMade.s} ${bobMade.j && bobMade.j.error})`);
    for (let i = 0; i < 4; i++) await call('POST', '/api/agents', { token: B, body: { name: 'Bob ' + i } });
    const sixth = await call('POST', '/api/agents', { token: B, body: { name: 'Bob 6' } });
    check_(sixth.s === 409 && (await call('GET', '/api/agents', { token: B })).j.agents.length === 5, 'the cap is 5 agents a person made, and the list shows exactly those 5');

    // a long name still makes an agent (the account handle is internal and always fits), and two with the same name never collide
    const longA = await call('POST', '/api/agents', { token: A, body: { name: 'Spawn bind test (delete me) with a long name', description: 'x' } });
    const longB = await call('POST', '/api/agents', { token: A, body: { name: 'Spawn bind test (delete me) with a long name' } });
    check_(longA.s === 201 && longB.s === 201 && longA.j.agent.name === 'Spawn bind test (delete me) with a long name' && longA.j.agent.id !== longB.j.agent.id,
      `a long, repeated name still creates two separate agents (${longA.s}/${longB.s} ${longA.j && longA.j.error || ''})`);
    const orphans = (await pool.query(`SELECT count(*)::int AS n FROM workforce_resources r WHERE r.kind = 'agent' AND r.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM agent_identities ai WHERE ai.workforce_resource_id = r.id)`)).rows[0].n;
    check_(orphans === 0, 'no active agent definition is ever left without an agent to run it');
    await call('DELETE', `/api/agents/${longA.j.agent.id}`, { token: A }); await call('DELETE', `/api/agents/${longB.j.agent.id}`, { token: A });

    // lending (ASN-04, DIV-05): within Ada's own workspace, and into Bob's -- where only Bob can accept
    const lender = (await call('POST', '/api/agents', { token: A, body: { name: 'Lender', divisionId: creative.id } })).j.agent;
    const pDev2 = await project('Dev 2'); await call('PUT', `/api/divisions/projects/${pDev2}`, { token: A, body: { divisionId: dev.id } });
    check_((await call('PUT', `/api/agents/${lender.id}/projects/${pDev2}`, { token: A, body: {} })).j.code === 'division_mismatch', 'before lending, a Creative agent cannot take a Dev project');
    const lent = (await call('POST', `/api/agents/${lender.id}/lend`, { token: A, body: { divisionId: dev.id } })).j.agent;
    check_(lent.lentTo.length === 1 && lent.lentTo[0].state === 'accepted' && lent.lentTo[0].division.id === dev.id && lent.division.id === creative.id, 'lending it to Dev in her own workspace is accepted at once, and its own division is unchanged (ASN-01)');
    const asg = (await pool.query('SELECT source_approved_by_user_id, target_accepted_by_user_id FROM workforce_workspace_assignments WHERE id = $1', [lent.lentTo[0].id])).rows[0];
    check_(String(asg.source_approved_by_user_id) === String(ada) && String(asg.target_accepted_by_user_id) === String(ada), 'both checks are recorded, even when one person holds both (ASN-04)');
    check_((await call('PUT', `/api/agents/${lender.id}/projects/${pDev2}`, { token: A, body: {} })).s === 200, 'once lent, it can take the Dev project');
    const fundL = (await pool.query('SELECT division_id FROM workforce_division_funding WHERE resource_id = (SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1)', [lender.id])).rows[0];
    check_(String(fundL.division_id) === creative.id, 'lending moved neither ownership nor who pays (DIV-05/07)');
    check_((await call('POST', `/api/agents/${lender.id}/lend`, { token: A, body: { divisionId: dev.id } })).j.code === 'already_lent', 'it cannot be lent to the same place twice');
    // into Bob's workspace: proposed, and only Bob may accept
    const bobLend = (await call('POST', `/api/agents/${lender.id}/lend`, { token: A, body: { workspaceId: bobWs } })).s;
    check_(bobLend === 404, "Ada cannot lend into a workspace she cannot see (404)");
    await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('workspace', $1, 'viewer', 'user', $2) ON CONFLICT DO NOTHING`, [bobWs, String(ada)]);
    const offer = (await call('POST', `/api/agents/${lender.id}/lend`, { token: A, body: { divisionId: bobDiv.id } })).j.agent.lentTo.find((l) => l.workspace.id === bobWs);
    check_(offer && offer.state === 'proposed' && offer.waitingFor === 'target', 'lending into a workspace she does not administer stays an offer, waiting for its admin');
    check_((await call('POST', `/api/agents/lends/${offer.id}/accept`, { token: A })).s === 403, "Ada cannot accept her own offer into Bob's workspace");
    const inbox = (await call('GET', '/api/agents/lends/inbox', { token: B })).j.offers;
    check_(inbox.some((o) => o.id === offer.id && o.agent.name === 'Lender' && o.from), 'Bob sees the offer in his inbox, with who it is from');
    check_((await call('POST', `/api/agents/lends/${offer.id}/accept`, { token: B })).j.lend.state === 'accepted', 'Bob accepts it');
    const lu = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [lender.id])).rows[0].user_id;
    check_((await check(pool, { object: `division:${bobDiv.id}`, relation: 'editor', subject: `agent:${lu}` })).allowed, "and the agent now works inside Bob's division");
    // revoke: by the target admin; the agent leaves and loses that division's projects
    await call('POST', `/api/agents/lends/${offer.id}/revoke`, { token: B });
    check_(!(await check(pool, { object: `division:${bobDiv.id}`, relation: 'editor', subject: `agent:${lu}` })).allowed, 'Bob ends the lend: the agent no longer works there');
    const devLend = lent.lentTo[0].id;
    await call('POST', `/api/agents/lends/${devLend}/revoke`, { token: A });
    check_(!(await call('GET', `/api/agents/${lender.id}`, { token: A })).j.agent.projects.some((x) => x.id === pDev2), 'ending the Dev lend takes away its Dev project');
    let del = null; try { await pool.query('DELETE FROM workforce_workspace_assignments WHERE id = $1', [devLend]); } catch (e) { del = e; }
    check_(del, 'a lend is never deleted, only revoked — its history stays (the database refuses)');

    // "Act as": a browser sign-in from an agent app can become one of the person's own agents
    const pk = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
    const reg = await call('POST', '/api/oauth2/register', { body: { client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', scope: 'tasks:read tasks:write' } });
    const red = 'http://localhost:51234/callback';
    const authz = async (extra, pp) => call('POST', '/api/oauth2/authorize', { token: A, body: { client_id: reg.j.client_id, redirect_uri: red, scope: 'tasks:read tasks:write', code_challenge: pp.c, code_challenge_method: 'S256', state: 's', ...extra } });
    const actor = (await call('POST', '/api/agents', { token: A, body: { name: 'Actor', divisionId: creative.id } })).j.agent;
    const askP = pk(); const ask = await authz({}, askP);
    check_(ask.j.error === 'consent_required' && ask.j.consent.agents.some((x) => x.id === actor.id && x.division === 'Creative'), 'the consent screen offers the person\u2019s own agents, with their division');
    check_(!ask.j.consent.agents.some((x) => /claude-code|forum|probe/i.test(x.name)), 'and never the per-app or system agents');
    const pageHtml = await (await fetch(origin + `/api/oauth2/authorize?client_id=${reg.j.client_id}&redirect_uri=${encodeURIComponent(red)}&code_challenge=${askP.c}&code_challenge_method=S256&scope=tasks:read`)).text();
    const js = pageHtml.split('<script>')[1].split('</script>')[0];
    let parses = true; try { new Function(js); } catch { parses = false; }
    check_(parses && /Act as/.test(pageHtml), 'the sign-in page carries the Act as choice, and its script parses');
    check_((await authz({ consent: true, act_as: 'agt_' + '0'.repeat(32) }, pk())).j.error === 'invalid_request', 'an unknown agent is refused');
    const bobAgent = (await pool.query(`SELECT public_id FROM agent_identities WHERE owner_user_id = $1 AND public_id IS NOT NULL LIMIT 1`, [bob])).rows[0].public_id;
    check_((await authz({ consent: true, act_as: bobAgent }, pk())).j.error === 'invalid_request', "someone else's agent is refused");
    const p2 = pk(); const ok2 = await authz({ consent: true, act_as: actor.id }, p2);
    const tok = await call('POST', '/api/oauth2/token', { body: new URLSearchParams({ grant_type: 'authorization_code', code: ok2.j.code, client_id: reg.j.client_id, redirect_uri: red, code_verifier: p2.v }).toString(), raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const who = await call('GET', '/api/tasks/agent/me', { token: tok.j.access_token });
    const actorUser = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [actor.id])).rows[0].user_id;
    check_(who.s === 200 && String((who.j.agent || who.j.me || who.j).id) === String(actorUser), `signing in with Act as = Actor makes the app act AS Actor (${who.s})`);
    const conns = (await call('GET', '/api/agents/' + actor.id, { token: A })).j.agent.connections;
    void conns;
    // clearing it, by signing in again choosing "its own agent", returns to the per-app agent
    const p3 = pk(); const ok3 = await authz({ consent: true, act_as: '' }, p3);
    const tok3 = await call('POST', '/api/oauth2/token', { body: new URLSearchParams({ grant_type: 'authorization_code', code: ok3.j.code, client_id: reg.j.client_id, redirect_uri: red, code_verifier: p3.v }).toString(), raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const who3 = await call('GET', '/api/tasks/agent/me', { token: tok3.j.access_token });
    check_(String((who3.j.agent || who3.j.me || who3.j).id) !== String(actorUser), 'choosing "its own agent" returns the app to a per-app agent');
    // deleting the bound agent: the binding no longer applies
    await authz({ consent: true, act_as: actor.id }, pk());
    await call('DELETE', `/api/agents/${actor.id}`, { token: A });
    const who4 = await call('GET', '/api/tasks/agent/me', { token: tok.j.access_token });
    check_(who4.s !== 200 || String((who4.j.agent || who4.j.me || who4.j).id) !== String(actorUser), 'once the agent is deleted, the app no longer acts as it');

    // where it hears about new work
    const keep = (await call('POST', '/api/agents', { token: A, body: { name: 'Hook bot' } })).j.agent;
    const hook = await call('PUT', `/api/agents/${keep.id}/webhook`, { token: A, body: { url: 'https://hooks.example.com/xeno' } });
    check_(hook.s === 200 && /^.{20,}$/.test(hook.j.secret || '') && (await call('GET', `/api/agents/${keep.id}`, { token: A })).j.agent.webhook === 'https://hooks.example.com/xeno', 'an agent gets a webhook; its signing secret is returned once');
    check_(!JSON.stringify((await call('GET', `/api/agents/${keep.id}`, { token: A })).j).includes(hook.j.secret), 'the secret is never returned again');
    check_((await call('PUT', `/api/agents/${keep.id}/webhook`, { token: A, body: { url: 'http://127.0.0.1:9/x' } })).s === 400, 'a webhook to a private address is refused');
    check_((await call('PUT', `/api/agents/${keep.id}/webhook`, { token: B, body: { url: 'https://evil.example.com' } })).s === 404, "someone else cannot set another person's agent webhook");

    // delete
    await call('DELETE', `/api/agents/${ag.id}`, { token: A });
    const st = (await pool.query('SELECT status FROM workforce_resources WHERE id = $1', [link.workforce_resource_id])).rows[0].status;
    check_(st === 'archived' && (await rpc(cred.token, 'ping', {})).s === 401, 'deleting it archives its definition and stops its credential');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\nagents-divisions: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
