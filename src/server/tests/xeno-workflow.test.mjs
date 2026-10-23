/**
 * Dev › Automate = XENO Workflow (services/xenoWorkflow.js, automateMcp.js, workers/automateWorker.js), on a real
 * Postgres against a FAKE xeno-workflow runner that verifies every assertion with the platform's own public key.
 *
 *   - fails closed: no XENO_WORKFLOW_RUNNER_URL → nothing is delivered and enabling refuses
 *   - the assertion: aud xeno-workflow, typ xeno-workflow-assertion+jwt, ≤ 60 s, purpose, run id, the body's SHA-256
 *   - the graph is xeno-workflow's own format, checked against the RUNNER's catalogue; secrets, unknown or irreversible
 *     actions and malformed schedules are refused at save time
 *   - §8.11: members read, admins write, an agent drafts; only a PERSON enables (and the database refuses otherwise)
 *   - enabling grants the workflow's own agent EXACTLY the capabilities its graph calls; each run carries a short-lived
 *     xwk_ key for that agent, reused across delivery attempts, revoked when the run ends
 *   - triggers: a task move, a ticket (no title or body in the event), a form answer, a schedule, a signed webhook —
 *     one run per event, the workflow's own agent does not re-trigger it, a runaway workflow is turned off
 *   - delivery: success, a failed run, the runner busy (back off, same key), unreachable (dead after 5), a refusal,
 *     N failures in a row (turned off), the enabler losing admin (turned off before acting)
 *   - MCP: agents list, read, draft, edit (a running workflow goes back to draft) and disable; no tool enables or deletes
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/xeno-workflow.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { jwks } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import * as W from '../services/xenoWorkflow.js';
import * as Mcp from '../services/automateMcp.js';
import * as creds from '../services/workspaceCredentials.js';
import * as tasks from '../services/xenoTasks.js';
import * as support from '../services/supportTickets.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
process.env.SECRET_BOX_KEY = process.env.SECRET_BOX_KEY || crypto.randomBytes(32).toString('base64');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `wf${Date.now().toString(36)}`;

// ── the fake runner
let pub; const seen = []; let mode = 'success';
const CATALOGUE = [
  { type: 'xeno-platform-trigger', name: 'XENO Workspace Event', visualCategory: 'trigger', configFields: [], secretFields: [] },
  { type: 'xeno-platform-capability', name: 'XENO Workspace Action', visualCategory: 'action', configFields: [], secretFields: [] },
  { type: 'json-transform', name: 'JSON Transform', visualCategory: 'transform', configFields: [], secretFields: [] },
  { type: 'http-request', name: 'HTTP Request', visualCategory: 'action', configFields: [], secretFields: ['authUsername', 'authPassword', 'oauthToken'] },
];
const fake = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (s, b, h = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(b)); };
  let claims, hdr;
  try {
    const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
    hdr = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());
    if (hdr.typ !== W.ASSERTION_TYP) throw new Error('typ');
    claims = jwt.verify(tok, pub, { algorithms: ['ES256'], audience: 'xeno-workflow', issuer: issuer() });
    if (claims.exp - claims.iat > 60) throw new Error('lifetime');
  } catch (e) { return send(401, { success: false, error: 'bad assertion ' + e.message, code: 'invalid_assertion' }); }
  if (req.url === '/v1/catalogue') { if (claims.purpose !== 'catalogue') return send(401, { code: 'wrong_purpose' }); return send(200, { success: true, nodes: CATALOGUE }); }
  if (req.url === '/v1/runs' && req.method === 'POST') {
    const body = JSON.parse(raw.toString());
    const bound = claims.purpose === 'run' && claims.run_id === body.runId && claims.body_sha256 === crypto.createHash('sha256').update(raw).digest('hex') && claims.xeno_workspace === body.workspaceId;
    const key = body.credential && body.credential !== 'none' ? await creds.resolveKey(pool, body.credential) : null;
    seen.push({ body, claims, bound, key });
    if (!bound) return send(403, { success: false, code: 'run_mismatch' });
    if (mode === 'busy') return send(429, { success: false, code: 'busy' }, { 'retry-after': '1' });
    if (mode === 'down') return send(503, { success: false, code: 'down' });
    if (mode === 'refuse') return send(422, { success: false, error: 'uses read-file', code: 'graph_refused' });
    const ok = mode === 'success';
    return send(200, { success: true, run: { runId: body.runId, executionId: 'ex-' + body.runId.slice(0, 8), status: ok ? 'success' : 'error', resumed: false, error: ok ? null : 'XENO tasks.task.create refused (403 scope_missing)', steps: [{ nodeId: 'trigger', status: 'success', outputs: { event: body.trigger.event } }, { nodeId: 'act', status: ok ? 'success' : 'error' }] } });
  }
  send(404, { code: 'not_found' });
});

const graphOf = (event, extra = {}, action = 'tasks.task.create') => ({
  version: 2, variables: {},
  nodes: [
    { id: 'trigger', type: 'xeno-platform-trigger', label: 'When', config: { event, ...extra }, position: { x: 0, y: 0 } },
    { id: 'act', type: 'xeno-platform-capability', label: 'Do', config: { capability: action, arguments: '{"title":"{{ $node.trigger.event.task.title }}"}' }, position: { x: 280, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'trigger', sourcePort: 'out', target: 'act', targetPort: 'in', kind: 'exec' }],
});

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);   // oidc_signing_keys
  const keys = await jwks(pool); pub = crypto.createPublicKey({ key: keys.keys.at(-1), format: 'jwk' });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const runnerUrl = `http://127.0.0.1:${fake.address().port}`;

  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}${s}`, `${tag}${s}@xeno.test`, s])).rows[0].id;
  const owner = await user('owner'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent'), admin2 = await user('admin2');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['admin', owner], ['admin', admin2], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const O = { id: owner, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, A = { id: agentU, kind: 'agent' }, A2 = { id: admin2, kind: 'human' };
  const w = { workspace: ws };

  // ── fail closed
  delete process.env.XENO_WORKFLOW_RUNNER_URL;
  check((await W.status(pool, V, w)).configured === false, 'without XENO_WORKFLOW_RUNNER_URL Automate says it is not set up');
  const early = (await W.createWorkflow(pool, O, { ...w, name: 'Early', graph: graphOf('task.status_changed') })).workflow;
  check(early.state === 'draft', 'a draft can be saved while the runner is not configured');
  check(await code(() => W.enableWorkflow(pool, O, early.id)) === 'automate_not_configured', 'enabling refuses while the runner is not configured');
  check((await W.sweep(pool)).delivered === 0, 'the sweep delivers nothing while not configured');
  process.env.XENO_WORKFLOW_RUNNER_URL = runnerUrl;
  W._resetCatalogueCache();

  // ── the graph, checked at save time
  check((await W.runnerCatalogue(pool, V, w)).some((n) => n.type === 'xeno-platform-capability'), 'the catalogue is read from the RUNNER, with a catalogue assertion it verifies');
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: { nodes: [{ id: 'f', type: 'read-file' }], edges: [] } })) === 'node_not_available', 'a desktop-only node is refused against the runner’s catalogue');
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: graphOf('task.status_changed', {}, 'tasks.nope.make') })) === 'invalid_action', 'an unknown workspace action is refused');
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: graphOf('task.status_changed', {}, 'research.run.create') })) === 'action_needs_person', 'an irreversible action is refused (a headless key never passes step-up)');
  const secretGraph = graphOf('task.status_changed'); secretGraph.nodes.push({ id: 'h', type: 'http-request', label: 'H', config: { url: 'https://example.com', authType: 'bearer', authUsername: 'sk-live-123' }, position: { x: 0, y: 0 } });
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: secretGraph })) === 'secret_in_graph', 'a secret typed into a node is refused');
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: graphOf('schedule', { cron: '61 * * * *', timezone: 'UTC' }) })) === 'invalid_cron', 'a malformed schedule is refused');
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: graphOf('schedule', { cron: '0 9 * * *', timezone: 'Mars/Base' }) })) === 'invalid_trigger', 'an unknown time zone is refused');
  const two = graphOf('task.status_changed'); two.nodes.push({ id: 't2', type: 'xeno-platform-trigger', config: { event: 'webhook' }, position: { x: 0, y: 0 } });
  check(await code(() => W.createWorkflow(pool, O, { ...w, name: 'x', graph: two })) === 'invalid_workflow', 'two workspace events are refused');

  // ── §8.11
  check(await code(() => W.createWorkflow(pool, V, { ...w, name: 'x', graph: graphOf('task.status_changed') })) === 'admin_required', 'a viewer cannot create a workflow');
  check(await code(() => W.listWorkflows(pool, S, w)) === 'not_a_member', 'a stranger reads nothing');
  check(await code(() => W.getWorkflow(pool, S, early.id)) === 'not_found', 'a stranger cannot reach a workflow by id');
  const drafted = (await W.createWorkflow(pool, A, { ...w, name: 'Agent draft', graph: graphOf('task.status_changed', { taskStatus: 'done' }) })).workflow;
  check(drafted.state === 'draft' && drafted.createdByKind === 'agent', 'an agent drafts a workflow');
  check(drafted.capabilities.join() === 'tasks.task.create' && drafted.scopes.join() === 'tasks:read,tasks:write', 'its capabilities and scopes are derived from the graph');
  check(await code(() => W.enableWorkflow(pool, A, drafted.id)) === 'human_required', 'an agent cannot turn a workflow on');
  check(await code(() => pool.query(`UPDATE workspace_workflows SET state='enabled', enabled_by=$2, agent_user_id=$2 WHERE id=$1`, [drafted.id, agentU])) === '23514', 'the database refuses a workflow enabled by an agent');

  // ── enable: the workflow's own agent, exactly its capabilities
  const on = (await W.enableWorkflow(pool, O, drafted.id)).workflow;
  check(on.state === 'enabled' && on.enabledBy === String(owner), 'a person turns it on and it runs for them');
  const flowAgent = (await pool.query('SELECT agent_user_id FROM workspace_workflows WHERE id = $1', [on.id])).rows[0].agent_user_id;
  check(flowAgent && String(flowAgent) !== String(owner), 'it acts through its OWN agent, never as the person');
  check(await creds.hasGrant(pool, flowAgent, 'tasks.task.create', ws), 'that agent is granted the capability its graph calls');
  check(!(await creds.hasGrant(pool, flowAgent, 'tasks.task.update', ws)), '…and nothing else');

  // ── triggers → runs (idempotent)
  const ev = { workspaceId: ws, event: 'task.status_changed', input: { task: { title: 'Ship it' }, to: 'done' }, match: (t) => !t.taskStatus || t.taskStatus === 'done' };
  check((await W.emitEvent(pool, { ...ev, eventKey: 'task-event:1' })).queued === 1, 'a matching event queues one run');
  check((await W.emitEvent(pool, { ...ev, eventKey: 'task-event:1' })).queued === 0, 'the same event again queues nothing');
  check((await W.emitEvent(pool, { ...ev, eventKey: 'task-event:2', match: () => false })).queued === 0, 'a filter that does not match queues nothing');
  check((await W.emitEvent(pool, { ...ev, eventKey: 'task-event:3', actorId: flowAgent })).queued === 0, 'the workflow’s own agent moving a task does not re-trigger it');

  // ── delivery
  mode = 'success';
  const d1 = await W.sweep(pool);
  check(d1.delivered === 1 && d1.outcomes[0] === 'succeeded', 'the sweep delivers the run and records success');
  const s1 = seen.at(-1);
  check(s1.bound, 'the run assertion names the run, the workspace and the SHA-256 of the exact body');
  check(s1.body.workflow.nodes.some((n) => n.type === 'xeno-platform-capability') && s1.body.trigger.event.task.title === 'Ship it', 'the runner receives the xeno-workflow graph and the event');
  check(s1.key && String(s1.key.agent_user_id) === String(flowAgent) && String(s1.key.workspace_id) === String(ws) && s1.key.scopes.join() === 'tasks:read,tasks:write', 'the credential is a key of the workflow’s agent, in this workspace, with only its scopes');
  check(!(await creds.resolveKey(pool, s1.body.credential)), 'the run key is revoked when the run ends');
  const r1 = (await W.listRuns(pool, V, { workflowId: on.id })).runs[0];
  check(r1.state === 'succeeded' && r1.steps.length === 2 && r1.executionId, 'a viewer sees the run and its steps');
  check(!(await pool.query('SELECT key_enc FROM workspace_workflow_runs WHERE id = $1', [r1.id])).rows[0].key_enc, 'the run keeps no credential once it ends');

  // busy → back off with the SAME key; then success
  await W.emitEvent(pool, { ...ev, eventKey: 'task-event:busy' });
  mode = 'busy';
  check((await W.sweep(pool)).outcomes[0] === 'retrying', 'a busy runner is retried later');
  const busy = (await pool.query(`SELECT * FROM workspace_workflow_runs WHERE event_key = 'task-event:busy'`)).rows[0];
  check(busy.state === 'queued' && busy.available_at > new Date() && busy.key_id, 'it is queued again after a back-off, keeping its key');
  await pool.query('UPDATE workspace_workflow_runs SET available_at = now() WHERE id = $1', [busy.id]);
  mode = 'success';
  await W.sweep(pool);
  const keyIds = seen.slice(-2).map((x) => x.key && String(x.key.id));
  check(keyIds[0] && keyIds[0] === keyIds[1], 'the re-delivery carries the SAME key, so idempotency keys dedupe on one connection');
  check(seen.at(-1).body.runId === seen.at(-2).body.runId, '…and the same run id, so the runner answers or resumes instead of repeating');

  // unreachable → dead after MAX_ATTEMPTS
  await W.emitEvent(pool, { ...ev, eventKey: 'task-event:down' });
  mode = 'down';
  let out;
  for (let i = 0; i < W.MAX_ATTEMPTS; i++) { await pool.query(`UPDATE workspace_workflow_runs SET available_at = now() WHERE event_key = 'task-event:down'`); out = (await W.sweep(pool)).outcomes[0]; }
  check(out === 'dead', `an undeliverable run is dead after ${W.MAX_ATTEMPTS} attempts`);
  const dead = (await W.listRuns(pool, O, { ...w, state: 'failed' })).runs.find((r) => r.state === 'dead');
  check(dead && dead.errorCode === 'undeliverable', 'it shows under Failed');
  check(await code(() => W.retryRun(pool, A, dead.id)) === 'human_required', 'an agent cannot retry a dead run');
  mode = 'success';
  check((await W.retryRun(pool, O, dead.id)).run.state === 'queued', 'a person retries it');
  check((await W.sweep(pool)).outcomes[0] === 'succeeded', 'and it goes through with the same run id');

  // a refusal is not retried
  await W.emitEvent(pool, { ...ev, eventKey: 'task-event:refuse' });
  mode = 'refuse';
  check((await W.sweep(pool)).outcomes[0] === 'failed', 'a run the runner refuses (422) fails without retrying');

  // failures in a row → off
  await pool.query(`UPDATE workspace_workflows SET failure_threshold = 2, consecutive_failures = 0 WHERE id = $1`, [on.id]);
  mode = 'error';
  for (const k of ['f1', 'f2']) { await W.emitEvent(pool, { ...ev, eventKey: `task-event:${k}` }); await W.sweep(pool); }
  const offAfter = (await W.getWorkflow(pool, O, on.id)).workflow;
  check(offAfter.state === 'disabled' && /2 runs in a row/.test(offAfter.disabledReason), 'a workflow that fails its threshold in a row is turned off');
  check(!(await creds.hasGrant(pool, flowAgent, 'tasks.task.create', ws)), 'turning it off takes its grants back');
  mode = 'success';

  // the enabler losing admin stops it before it acts
  await W.enableWorkflow(pool, A2, on.id);
  await pool.query(`DELETE FROM relationship_tuples WHERE object_type = 'workspace' AND object_id = $1 AND subject_id = $2`, [String(ws), String(admin2)]);
  await W.emitEvent(pool, { ...ev, eventKey: 'task-event:lost' });
  const before = seen.length;
  check((await W.sweep(pool)).outcomes[0] === 'failed', 'when the person it runs for is no longer an admin, the run fails');
  check(seen.length === before, '…without the runner ever being called');
  check((await W.getWorkflow(pool, O, on.id)).workflow.state === 'disabled', '…and the workflow is turned off');

  // ── an agent's change to a running workflow takes it back to a draft
  const on2 = (await W.enableWorkflow(pool, O, on.id)).workflow;
  const edited = (await W.updateWorkflow(pool, A, on2.id, { name: 'Agent edit', expectedRevision: on2.revision })).workflow;
  check(edited.state === 'draft', 'an agent’s change to a running workflow leaves it a draft');
  check(!(await creds.hasGrant(pool, flowAgent, 'tasks.task.create', ws)), '…and its grants are taken back until a person turns it on');
  check(await code(() => W.updateWorkflow(pool, O, on2.id, { name: 'stale', expectedRevision: on2.revision })) === 'conflict', 'a stale revision is refused');

  // ── a task move, through xenoTasks itself (personal workspace)
  const personal = (await pool.query(`SELECT id FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal'`, [owner])).rows[0]
    || (await import('../services/personalWorkspace.js').then((m) => m.ensurePersonalWorkspace(pool, owner)));
  const pflow = (await W.createWorkflow(pool, O, { workspace: personal.id, name: 'On todo', graph: graphOf('task.status_changed', { taskStatus: 'todo' }) })).workflow;
  await W.enableWorkflow(pool, O, pflow.id);
  const t = await tasks.createTask(pool, O, { title: 'Write the brief' });
  const moved = await tasks.transitionTask(pool, O, t.key, { to: 'todo' }).then(() => true, (e) => e.code);
  const queuedFromTask = (await pool.query(`SELECT input FROM workspace_workflow_runs WHERE workflow_id = $1`, [pflow.id])).rows;
  check(moved === true && queuedFromTask.length === 1 && queuedFromTask[0].input.task.title === 'Write the brief', 'moving a task in XENO Tasks queues the workflow listening for it');

  // ── a support ticket: the event carries no title or body
  const tflow = (await W.createWorkflow(pool, O, { ...w, name: 'On ticket', graph: graphOf('support.ticket_created', { ticketKind: 'bug' }) })).workflow;
  await W.enableWorkflow(pool, O, tflow.id);
  await support.createTicket(pool, { id: viewer, kind: 'human' }, { kind: 'bug', title: 'Private: my invoice is wrong', body: 'secret details', workspaceId: ws });
  const tr = (await pool.query(`SELECT input FROM workspace_workflow_runs WHERE workflow_id = $1`, [tflow.id])).rows;
  check(tr.length === 1 && tr[0].input.ticket.kind === 'bug', 'opening a support ticket queues the workflow listening for it');
  check(!JSON.stringify(tr[0].input).includes('invoice') && !JSON.stringify(tr[0].input).includes('secret'), '…and the event carries neither its title nor its body');

  // ── a form answer
  const fflow = (await W.createWorkflow(pool, O, { ...w, name: 'On form', graph: graphOf('form.response_submitted', { formId: 'f-1' }) })).workflow;
  await W.enableWorkflow(pool, O, fflow.id);
  check((await W.onFormResponse(pool, { workspaceId: ws, formId: 'f-1', responseId: 'resp-1', answers: { q: 'a' } })).queued === 1, 'a form answer queues the workflow for that form');
  check((await W.onFormResponse(pool, { workspaceId: ws, formId: 'f-2', responseId: 'resp-2' })).queued === 0, '…and not for another form');

  // ── a schedule
  const sflow = (await W.createWorkflow(pool, O, { ...w, name: 'Daily', graph: graphOf('schedule', { cron: '0 9 * * *', timezone: 'Europe/Berlin' }) })).workflow;
  const son = (await W.enableWorkflow(pool, O, sflow.id)).workflow;
  check(son.nextRunAt && new Date(son.nextRunAt) > new Date(), 'a schedule computes its next run');
  await pool.query(`UPDATE workspace_workflows SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [sflow.id]);
  check(await W.enqueueDueSchedules(pool) === 1, 'a due schedule queues one run');
  check(await W.enqueueDueSchedules(pool) === 0, '…once, and moves on to the next occurrence');
  check(W.nextCron('30 14 * * 1', 'UTC', new Date('2026-10-23T12:00:00Z')).toISOString() === '2026-10-26T14:30:00.000Z', 'cron: Mondays 14:30 UTC');

  // ── a signed webhook
  const hflow = (await W.createWorkflow(pool, O, { ...w, name: 'Hook', graph: graphOf('webhook') }));
  check(hflow.webhookSecret && hflow.workflow.webhookPath === `/api/automate/hooks/${hflow.workflow.id}`, 'a webhook workflow gets a secret, shown once, and its address');
  await W.enableWorkflow(pool, O, hflow.workflow.id);
  const raw = Buffer.from('{"order":42}'), ts = Date.now();
  const good = W.signWebhook(hflow.webhookSecret, ts, raw);
  check((await W.receiveWebhook(pool, { id: hflow.workflow.id, raw, signature: good, timestamp: ts, deliveryId: 'd1' })).duplicate === false, 'a correctly signed webhook queues a run');
  check((await W.receiveWebhook(pool, { id: hflow.workflow.id, raw, signature: good, timestamp: ts, deliveryId: 'd1' })).duplicate === true, 'the same delivery again is a duplicate');
  check(await code(() => W.receiveWebhook(pool, { id: hflow.workflow.id, raw: Buffer.from('{"order":43}'), signature: good, timestamp: ts })) === 'bad_signature', 'a changed body does not verify');
  check(await code(() => W.receiveWebhook(pool, { id: hflow.workflow.id, raw, signature: W.signWebhook(hflow.webhookSecret, ts - 10 * 60_000, raw), timestamp: ts - 10 * 60_000 })) === 'bad_signature', 'an old timestamp is refused');
  check(await code(() => W.rotateWebhookSecret(pool, A, hflow.workflow.id)) === 'human_required', 'an agent never sees a webhook secret');

  // ── a runaway workflow is turned off
  const lflow = (await W.createWorkflow(pool, O, { ...w, name: 'Loop', graph: graphOf('form.response_submitted') })).workflow;
  await W.enableWorkflow(pool, O, lflow.id);
  await pool.query(`INSERT INTO workspace_workflow_runs (workflow_id, workspace_id, event_key, trigger_event, graph_revision, state) SELECT $1, $2, 'loop:' || g, 'form.response_submitted', 1, 'succeeded' FROM generate_series(1, $3) g`, [lflow.id, ws, W.LOOP_LIMIT.runs]);
  await W.onFormResponse(pool, { workspaceId: ws, formId: 'x', responseId: 'loop-next' });
  check((await W.getWorkflow(pool, O, lflow.id)).workflow.state === 'disabled', `a workflow starting ${W.LOOP_LIMIT.runs} runs in ${W.LOOP_LIMIT.windowMinutes} minutes is turned off`);

  // ── run now and delete are a person's
  check(await code(() => W.runNow(pool, A, sflow.id)) === 'human_required', 'an agent cannot start a run by hand');
  check((await W.runNow(pool, O, sflow.id)).run.state === 'queued', 'a person can');
  check(await code(() => W.deleteWorkflow(pool, A, early.id)) === 'human_required', 'an agent cannot delete a workflow');

  // ── MCP
  const names = Mcp.TOOLS.map((x) => x.name);
  check(!names.some((n) => /enable|delete|run_now|retry|secret/.test(n)), 'no MCP tool turns a workflow on, deletes it, runs it, retries a run or reads a secret');
  const viaMcp = (await Mcp.callTool(pool, A, 'draft_workflow', { workspace: ws, name: 'MCP hook', graph: graphOf('webhook') })).structuredContent;
  check(viaMcp.workflow.state === 'draft' && !('webhookSecret' in viaMcp), 'an agent drafts through MCP and never receives the webhook secret');
  check((await Mcp.callTool(pool, A, 'disable_workflow', { workflow: sflow.id })).structuredContent.workflow.state === 'disabled', 'an agent can turn a workflow off');
  check((await Mcp.callTool(pool, A, 'list_runs', { workspace: ws })).structuredContent.runs.length > 0, 'an agent reads runs');

  console.log(`\nxeno-workflow: ${passed} checks passed`);
}

main().then(() => { fake.close(); return pool.end(); }).catch(async (e) => { console.error(e); fake.close(); await pool.end().catch(() => {}); process.exit(1); });
