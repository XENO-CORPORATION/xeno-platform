/**
 * Workforce cards on canvases, and "Open as canvas", end to end on a real Postgres and the REAL routers.
 *
 *   1. a canvas accepts project, division, objective and run cards by uuid, and refuses a malformed one
 *   2. each card is resolved LIVE as the reader, through its own service's rule: a project the reader cannot view,
 *      a division outside their workspace, a run that is not theirs — all read as missing, never by name
 *   3. a card's status is the record's status now: stopping a run turns its card to stopped with no canvas save
 *   4. Open as canvas: a project lays out its tasks, conversations and runs; a division lays out what its HOME lets
 *      the reader see — and opening again returns the same canvas
 *   5. moving a card is layout only: the record is unchanged
 *   6. the MCP tool reads the new cards and opens a map the same way
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/canvas-workforce-cards.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import canvasRoutes from '../routes/canvasRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { admitAccountRun, readRunnablePin } from '../services/workforceRunAdmission.js';
import { revokeRun } from '../services/workforceRunAuthority.js';
import { createObjective } from '../services/projectWorktree.js';
import { createTask } from '../services/xenoTasks.js';
import { growMap } from '../services/canvases.js';
import * as canvasMcp from '../services/canvasMcp.js';

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
  const ada = await mk('cwc-ada'), bob = await mk('cwc-bob'), eve = await mk('cwc-eve');
  await addGrant(pool, ada, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:cwc-ada' });
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  app.use('/api/canvases', authMiddleware, canvasRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob), E = session(eve);
  const project = async (name) => { const r = await call('POST', '/api/chat/projects', { body: { name }, headers: { 'x-as': ada } }); return String((r.j.project || r.j.data || r.j).id); };
  const ref = (kind, id, i) => ({ id: `${kind}${i}`, type: 'xeno-ref', ref: { kind, id }, x: i * 300, y: 0, width: 260, height: 120 });

  try {
    const ws = (await call('GET', '/api/divisions', { token: A })).j.workspaceId;
    await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'viewer', subject: `user:${bob}` }] });
    const dev = (await call('POST', '/api/divisions', { token: A, body: { name: 'Dev' } })).j.division;
    const shared = await project('Shared'), secret = await project('Secret');
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'viewer', subject: `user:${bob}` }] });
    await call('PUT', `/api/divisions/projects/${shared}`, { token: A, body: { divisionId: dev.id } });
    await call('PUT', `/api/divisions/projects/${secret}`, { token: A, body: { divisionId: dev.id } });
    const agent = (await call('POST', '/api/agents', { token: A, body: { name: 'Builder', description: 'Builds', instructions: 'x', divisionId: dev.id } })).j.agent;
    const obj = await createObjective(pool, { actorUserId: ada, workspaceId: ws, divisionId: dev.id, title: 'Ship v1', successEvidence: 'On R2', ownerUserId: ada, windowStart: '2026-10-01', windowEnd: '2026-12-31' });
    const task = await createTask(pool, { id: ada, kind: 'human' }, { title: 'Write the brief', projectId: shared });
    const def = (await pool.query('SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].workforce_resource_id;
    const ctx = { actorUserId: ada, clientId: 'cwc-test' }, target = { kind: 'personal', ownerUserId: ada };
    const pin = await readRunnablePin(pool, ctx, { agent: { resourceId: def }, target });
    const run = (await admitAccountRun(pool, ctx, { operationId: crypto.randomUUID(), agent: pin.agent, target, capabilities: pin.terms.definition, budget: { ceilingMicro: '2000000' }, taskRef: 'T-1' })).admission.admissionId;

    // 1. cards
    const content = { nodes: [ref('project', shared, 1), ref('project', secret, 2), ref('division', dev.id, 3), ref('objective', obj.objectiveId, 4), ref('run', run, 5)], edges: [] };
    const made = await call('POST', '/api/canvases', { token: A, body: { name: 'Board', projectId: shared, content } });
    ok(made.s === 201, 'a canvas takes project, division, objective and run cards');
    const cid = made.j.canvas.id;
    ok((await call('POST', '/api/canvases', { token: A, body: { name: 'Bad', content: { nodes: [ref('run', 'not-a-uuid', 1)], edges: [] } } })).j.code === 'invalid_content', 'a malformed card is refused');
    const rec = made.j.canvas.records;
    ok(rec.projects[shared].name === 'Shared' && rec.projects[shared].openTasks === 1 && rec.divisions[dev.id].name === 'Dev' && rec.objectives[obj.objectiveId].status === 'open' && rec.runs[run].status === 'admitted' && rec.runs[run].agent === 'Builder',
      'each card resolves live with its status (project tasks, division, objective, run)');

    // 2. bob reads the same canvas: what is not his is missing, with no name
    const asBob = (await call('GET', `/api/canvases/${cid}`, { token: B })).j.canvas.records;
    ok(asBob.projects[shared].name === 'Shared' && asBob.projects[secret].missing === true && !JSON.stringify(asBob).includes('Secret'), 'a project the reader cannot view reads as missing, its name never sent');
    ok(asBob.runs[run].missing === true, 'a run that is not the reader’s, on no project they view, reads as missing');
    ok(asBob.divisions[dev.id].name === 'Dev' && asBob.objectives[obj.objectiveId].title === 'Ship v1', 'a workspace member reads the division and its objective');

    // 3. live status, no save
    await revokeRun(pool, { actorUserId: ada }, run);
    const after = (await call('GET', `/api/canvases/${cid}`, { token: A })).j.canvas;
    ok(after.records.runs[run].status === 'stopped' && after.revision === made.j.canvas.revision, 'stopping the run turns its card to stopped — with no canvas save');

    // 5. layout only
    const moved = after.content; moved.nodes[0].x = 900;
    const saved = await call('PUT', `/api/canvases/${cid}`, { token: A, body: { content: moved, revision: after.revision } });
    ok(saved.s === 200 && (await pool.query('SELECT name FROM chat_projects WHERE id = $1', [shared])).rows[0].name === 'Shared', 'moving a card saves the layout and leaves the record alone');

    // 4. open as canvas
    const pm = await call('POST', '/api/canvases/open-as', { token: A, body: { kind: 'project', id: shared } });
    const pnodes = pm.j.canvas.content.nodes;
    ok(pm.s === 201 && pm.j.canvas.project.id === shared && pnodes.some((n) => n.ref?.kind === 'project' && n.ref.id === shared) && pnodes.some((n) => n.ref?.kind === 'task' && n.ref.id === task.key),
      'a project opens as a project canvas with its card and its tasks laid out');
    const again = await call('POST', '/api/canvases/open-as', { token: A, body: { kind: 'project', id: shared } });
    ok(again.s === 200 && again.j.created === false && again.j.canvas.id === pm.j.canvas.id, 'opening it again returns the same canvas');
    const reopen = async () => (await call('POST', '/api/canvases/open-as', { token: A, body: { kind: 'project', id: shared } })).j.canvas;
    const later = await createTask(pool, { id: ada, kind: 'human' }, { title: 'Added after the map', projectId: shared });
    const grown = await reopen(), cardOf = (cv, k) => cv.content.nodes.find((n) => n.ref?.id === k);
    ok(grown.id === pm.j.canvas.id && cardOf(grown, later.key), 'what is added to the project appears on its map the next time it opens');
    const firstCard = cardOf(grown, task.key), kept = { ...grown.content, nodes: grown.content.nodes.filter((n) => n.ref?.id !== later.key).map((n) => (n.id === firstCard.id ? { ...n, x: 1234, y: 777 } : n)) };
    const edit = await call('PUT', `/api/canvases/${grown.id}`, { token: A, body: { content: kept, revision: grown.revision } });
    ok(edit.s === 200, 'a card can be moved, and one taken off the map');
    const third = await createTask(pool, { id: ada, kind: 'human' }, { title: 'Added after that', projectId: shared });
    const back = await reopen();
    ok(!cardOf(back, later.key), 'a card someone took off stays off');
    ok(cardOf(back, task.key).x === 1234 && cardOf(back, task.key).y === 777, 'and a card someone moved stays where they put it');
    ok(cardOf(back, third.key) && !back.content.nodes.some((n, i) => back.content.nodes.findIndex((m) => m.id === n.id) !== i), 'while new work still arrives, each card once');
    const steady = await reopen();
    ok(steady.revision === back.revision, 'nothing new means nothing is written');
    ok((await call('POST', '/api/canvases/open-as', { token: B, body: { kind: 'project', id: secret } })).s === 404, 'a project the reader cannot view cannot be opened as a canvas');
    const dmA = (await call('POST', '/api/canvases/open-as', { token: A, body: { kind: 'division', id: dev.id } })).j.canvas;
    const dmB = await call('POST', '/api/canvases/open-as', { token: B, body: { kind: 'division', id: dev.id } });
    const kindsOf = (cv, k) => cv.content.nodes.filter((n) => n.ref?.kind === k).map((n) => n.ref.id);
    ok(kindsOf(dmA, 'project').length === 2 && kindsOf(dmA, 'objective').includes(obj.objectiveId), 'a division opens with its projects and objectives laid out');
    ok(dmB.s === 201 && kindsOf(dmB.j.canvas, 'project').length === 1 && kindsOf(dmB.j.canvas, 'project')[0] === shared && dmB.j.canvas.id !== dmA.id, 'a member’s division map holds only what their home shows them, on their own canvas');
    ok((await call('POST', '/api/canvases/open-as', { token: E, body: { kind: 'division', id: dev.id } })).s === 404, 'a stranger cannot open the division as a canvas');

    const offered = growMap({ nodes: [{ id: 'root-project', type: 'xeno-ref', ref: { kind: 'project', id: shared }, x: 0, y: 0, width: 300, height: 120 }], edges: [] }, [{ kind: 'file', label: 'Files', items: ['a', 'b'] }], new Set(['file:b']));
    ok(offered.added === 1 && offered.content.nodes.some((n) => n.id === 'group-file' && n.x >= 300 && n.label === 'Files'), 'a kind with no column yet gets a new column, and only what was not offered before');

    // made on the canvas, it is the project's
    const docs = await import('../services/workspaceDocs.js'), { moveToProject } = await import('../services/libraryCopies.js');
    const wsOf = (await pool.query('SELECT workspace_id FROM chat_projects WHERE id = $1', [shared])).rows[0].workspace_id;
    const madeDoc = (await docs.createDoc(pool, { id: ada, kind: 'human' }, { kind: 'doc', title: 'Brief from the canvas', workspace: wsOf })).doc;
    const into = await moveToProject(pool, ada, 'file', madeDoc.versionId, shared);
    ok(!into.notFound && !into.invalid && !into.conflict && !into.forbidden, `a document moves into the project (${JSON.stringify(into).slice(0, 80)})`);
    const withDoc = await reopen(), docCard = withDoc.records.files[String(madeDoc.id).toLowerCase()];
    ok(cardOf(withDoc, String(madeDoc.id).toLowerCase()) && docCard && docCard.url === `/workspace/office/spaces/write/${madeDoc.id}`, 'it joins the project, and its card opens it in Write');
    const madeChat = await call('POST', '/api/chat/conversations', { token: A, body: { title: 'Canvas chat', project_id: shared } });
    const cid2 = String((madeChat.j.conversation || madeChat.j).id).toLowerCase();
    const withChat = await reopen();
    ok(cardOf(withChat, cid2) && withChat.records.chats[cid2].url === `/workspace/apps/chat/projects/${shared}/c/${cid2}`, 'a chat started in the project gets a card that opens it in the project');
    const gen = crypto.randomUUID();
    const genCard = { ...withChat.content, nodes: [...withChat.content.nodes, { id: 'g1', type: 'xeno-ref', ref: { kind: 'generation', id: gen }, x: 0, y: 0, width: 280, height: 280 }] };
    const savedGen = await call('PUT', `/api/canvases/${withChat.id}`, { token: A, body: { content: genCard, revision: withChat.revision } });
    ok(savedGen.s === 200 && savedGen.j.canvas.records.generations[gen].missing === true, 'an image card reads its generation, and one the reader can’t see says nothing about it');

    // XENO Multiplayer: a ticket says what the canvas's own service says
    const live = await import('../services/liveTickets.js');
    const tk = await live.createTicket(pool, { id: ada, kind: 'human', username: 'ada' }, `workspace.canvas/${pm.j.canvas.id}`);
    const claims = JSON.parse(Buffer.from(tk.ticket.split('.')[1], 'base64url').toString());
    ok(claims.xeno_resource === `workspace.canvas/${pm.j.canvas.id}` && ['owner', 'editor'].includes(claims.xeno_role) && claims.sub === String(ada) && tk.url.endsWith(`/v1/workspace.canvas/${pm.j.canvas.id}`), 'a person who can edit a canvas gets a ticket to it');
    await assert.rejects(live.createTicket(pool, { id: eve, kind: 'human' }, `workspace.canvas/${pm.j.canvas.id}`), (e) => e.statusCode === 404);
    ok(true, 'and someone who can’t see it gets none, and learns nothing about it');

    // what changes in the project reaches an open canvas, however it was changed
    const { startProjectChangeWorker } = await import('../workers/projectChangeWorker.js');
    const told = [], stopFeed = startProjectChangeWorker(pool, { delayMs: 50, fetchImpl: async (url, init) => { told.push({ url: String(url), token: init.headers.authorization, body: init.body }); return new Response('{"sent":1}'); } });
    await new Promise((r) => setTimeout(r, 400));
    const heard = async () => { for (let i = 0; i < 40 && !told.length; i++) await new Promise((r) => setTimeout(r, 50)); return told.splice(0); };
    await createTask(pool, { id: ada, kind: 'human' }, { title: 'Made by an API call', projectId: shared });
    const fromTask = await heard();
    ok(fromTask.length >= 1 && fromTask.every((t) => JSON.parse(t.body).data.changed === 'project') && fromTask.some((t) => t.url.endsWith(`/v1/workspace.canvas/${pm.j.canvas.id}/notify`)), 'a new task tells the project’s open canvases');
    ok(JSON.parse(Buffer.from(fromTask[0].token.split(' ')[1].split('.')[0], 'base64url').toString()).typ === 'xeno-live-notify+jwt' && !fromTask[0].body.includes('Made by an API call'), 'with its own token, and without saying what changed');
    await pool.query('UPDATE chat_conversations SET title = title WHERE id = $1', [cid2]);
    ok((await heard()).length >= 1, 'a change to a project chat does too');
    await pool.query("SELECT pg_notify('project_changed', $1)", [secret]);
    await new Promise((r) => setTimeout(r, 300));
    ok(!told.some((t) => t.url.includes(pm.j.canvas.id)), 'and a change in another project tells this canvas nothing');

    // losing access ends the live seat: a ticket only gates joining, so the service is asked to close what's left
    const ended = async (ms = 1500) => { const t0 = Date.now(); let first = 0; while (Date.now() - t0 < ms) { if (!first && told.some((t) => t.url.endsWith('/revoke'))) first = Date.now(); if (first && Date.now() - first > 300) break; await new Promise((r) => setTimeout(r, 50)); } return told.splice(0).filter((t) => t.url.endsWith('/revoke')).map((t) => ({ canvas: t.url.split('/v1/workspace.canvas/')[1].split('/')[0], sub: JSON.parse(Buffer.from(t.token.split(' ')[1].split('.')[1], 'base64url').toString()).sub, typ: JSON.parse(Buffer.from(t.token.split(' ')[1].split('.')[0], 'base64url').toString()).typ })); };
    const mapId = pm.j.canvas.id, del = (o, rel, s) => pool.query('DELETE FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND relation = $3 AND subject_type = $4 AND subject_id = $5', [...o.split(':'), rel, ...s.split(':')]);
    told.splice(0);
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'editor', subject: `user:${bob}` }] });
    await del(`project:${shared}`, 'editor', `user:${bob}`);
    const demoted = await ended();
    ok(demoted.some((x) => x.canvas === mapId && x.sub === String(bob) && x.typ === 'xeno-live-revoke+jwt') && !demoted.some((x) => x.sub === String(ada)), `an editor made a viewer has their live seat on the project's canvases closed, and nobody else's (${JSON.stringify(demoted)})`);
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'viewer', subject: `user:${eve}` }] });
    await del(`project:${shared}`, 'viewer', `user:${eve}`);
    ok((await ended()).some((x) => x.canvas === mapId && x.sub === String(eve)), 'someone removed from the project has theirs closed');
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'editor', subject: `user:${bob}` }, { object: `project:${shared}`, relation: 'reviewer', subject: `user:${bob}` }] });
    await del(`project:${shared}`, 'reviewer', `user:${bob}`);
    ok(!(await ended(700)).length, 'losing a relation that leaves them an editor closes nothing');
    const builder = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].user_id;
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'editor', subject: `user:${builder}` }] });
    await del(`project:${shared}`, 'editor', `user:${builder}`);
    ok((await ended()).some((x) => x.canvas === mapId && x.sub === String(ada)), 'an agent that lost access has its seat closed, through its person (the service closes by person)');
    const carl = await mk('cwc-carl');
    // a company project inherits from its workspace (project#parent@workspace, chatProjectAuthority.js)
    await writeTuples(pool, { writes: [{ object: `project:${shared}`, relation: 'parent', subject: `workspace:${ws}` }, { object: `workspace:${ws}`, relation: 'editor', subject: `user:${carl}` }] });
    const viaWs = await live.createTicket(pool, { id: carl, kind: 'human', username: 'carl' }, `workspace.canvas/${mapId}`).catch(() => null);
    await del(`workspace:${ws}`, 'editor', `user:${carl}`);
    ok(viaWs?.role === 'editor' && (await ended()).some((x) => x.canvas === mapId && x.sub === String(carl)), 'someone who edited it through the workspace, removed from the workspace, has theirs closed');
    await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'editor', subject: `user:${carl}` }] });
    await del(`project:${shared}`, 'parent', `workspace:${ws}`);
    const moved2 = await ended();
    ok(moved2.some((x) => x.canvas === mapId && x.sub === String(carl)) && !moved2.some((x) => x.sub === String(bob)), 'a project moved out of its workspace closes the seats of those who reached it only through the workspace');
    stopFeed();

    // 6. MCP
    const mv = JSON.parse((await canvasMcp.callTool(pool, { id: ada, kind: 'human' }, 'get', { canvas: cid })).content[0].text);
    ok(mv.items.some((i) => i.type === 'run' && i.status === 'stopped') && mv.items.some((i) => i.type === 'division' && i.name === 'Dev'), 'the MCP read shows the new cards with their live status');
    const mo = JSON.parse((await canvasMcp.callTool(pool, { id: ada, kind: 'human' }, 'open_as', { kind: 'division', id: dev.id })).content[0].text);
    ok(mo.created === false && mo.canvas.id === dmA.id, 'the MCP open_as returns the same division map');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
