/**
 * XENO Tasks — MCP server. JSON-RPC 2.0 over HTTP (POST /api/tasks/mcp), the shape forumMcp.js established:
 * `initialize`, `tools/list`, `tools/call`.
 *
 * 1. Every tool calls the SAME service function as REST (services/xenoTasks.js). A second code path is how an agent
 *    and a screen come to disagree about a task.
 * 2. Every result carries the task's link, so an agent can cite it and a person can click it.
 * 3. The caller is the principal the route resolved (a person's session, or an agent's own xtk_ credential). A
 *    credential's scopes and single-task limit apply to tools exactly as they do to routes.
 */
import * as svc from './xenoTasks.js';
import { guidanceFor } from './agentGuidance.js';

const SITE = process.env.SITE_URL || 'https://xenosystem.ai';
// Newest first. initialize answers with the client's version when we support it, else our newest.
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];
const link = (t) => `${SITE}/workspace${t.area ? '/' + t.area : ''}/tasks/${t.key}`;
const KEY = { type: 'string', description: 'The task key, like T-12', pattern: '^T-\\d+$' };
const PROJECT = { type: 'string', description: 'A project id (see list_projects). Defaults to the project this folder is linked to, if any.' };
const RUN_ID = { type: 'string', description: 'Your run\u2019s own id (1-128 of A-Z a-z 0-9 . _ : -). Claiming with it holds a lease for this run only; heartbeat at least every few minutes (it ends 10 minutes after the last one) and the task goes back to the queue.', pattern: '^[A-Za-z0-9._:-]{1,128}$' };
const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS = [
  { name: 'list_projects', title: 'List projects', write: false, annotations: RO, description: 'The projects you can work in. Pass an id as `project` to the other tools to stay inside one.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_my_tasks', title: 'List my tasks', write: false, annotations: RO, description: 'Open tasks delegated to you (an agent) or assigned to you (a person). Start here. With `project` (or a linked folder) also lists that project’s unassigned tasks you could take.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma list: raised,todo,in_progress,blocked,in_review,done,wont_do' }, project: PROJECT } } },
  { name: 'get_task', title: 'Read a task', write: false, annotations: RO, description: 'One task: description (markdown), status, people, sub-tasks, links, images, and the full activity.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY } } },
  { name: 'list_events', title: 'What you were told', write: false, annotations: RO, description: 'What you have been told, in order, after a cursor: delegated, undelegated, mentioned, reply (a comment on your task), status_changed, review_requested, changes_requested, accepted, lease_expired, handover. Pass the returned cursor as after next time. Agents only.', inputSchema: { type: 'object', properties: { after: { type: 'string' } } } },
  { name: 'create_task', title: 'Raise a task', write: true, annotations: RW, description: 'Raise a new task. It lands in Triage until someone accepts it.', inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, body: { type: 'string' }, kind: { enum: ['task', 'bug', 'feature', 'question'] }, priority: { enum: ['none', 'low', 'medium', 'high', 'urgent'] }, project: PROJECT, project_id: { type: 'string', description: 'Same as project (kept for compatibility)' }, area: { type: 'string' }, parent_key: KEY } } },
  { name: 'claim_task', title: 'Take a task', write: true, annotations: { ...RW, idempotentHint: true }, description: 'Take a task: a person becomes its assignee, an agent its delegate. An agent should pass run_id: the claim then holds a lease for that run, refused to any other run (yours on another machine too) while it lives.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY, run_id: RUN_ID } } },
  { name: 'heartbeat', title: 'Keep your claim', write: true, annotations: { ...RW, idempotentHint: true }, description: 'Renew the lease your run holds on a task. Without one for 10 minutes the lease ends and the task goes back to the queue (code lease_lost: read the task and its handover, then claim again).', inputSchema: { type: 'object', required: ['key', 'run_id'], properties: { key: KEY, run_id: RUN_ID } } },
  { name: 'release', title: 'Let go of a task', write: true, annotations: RW, description: 'End your run\u2019s lease: the task goes back to the queue. Post a handover activity first so the next run can continue.', inputSchema: { type: 'object', required: ['key', 'run_id'], properties: { key: KEY, run_id: RUN_ID } } },
  { name: 'move_task', title: 'Move a task', write: true, annotations: RW, description: 'Move a task: todo, in_progress, blocked, in_review, done, wont_do, raised. Send work to in_review; you can never accept your own work. Pass `from` (the status you saw) so you never overwrite a newer state.', inputSchema: { type: 'object', required: ['key', 'to'], properties: { key: KEY, to: { type: 'string' }, from: { type: 'string' }, note: { type: 'string' } } } },
  { name: 'comment', title: 'Comment', write: true, annotations: RW, description: 'Comment on a task (markdown; @username mentions someone).', inputSchema: { type: 'object', required: ['key', 'body'], properties: { key: KEY, body: { type: 'string' } } } },
  { name: 'report_activity', title: 'Report what you are doing', write: true, annotations: RW, description: 'As the task’s delegate, show what you are doing. Pass kind with its data: plan {steps[]}, action {summary?} (with body), question {question, options?} (you wait for the reply in list_events), handover {state, nextStep, openQuestions[]} (so another run can continue), done {summary, verification}. The older type (thought, action, ask, result, error) with body still works.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY, kind: { enum: ['plan', 'action', 'question', 'handover', 'done'] }, data: { type: 'object', description: 'The kind\u2019s fields, nothing else', properties: { steps: { type: 'array', items: { type: 'string' }, maxItems: 50 }, summary: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 10 }, state: { type: 'string' }, nextStep: { type: 'string' }, openQuestions: { type: 'array', items: { type: 'string' }, maxItems: 20 }, verification: { type: 'string' } } }, type: { enum: ['thought', 'action', 'ask', 'result', 'error'] }, body: { type: 'string' } } } },
  { name: 'update_task', title: 'Edit a task', write: true, annotations: { ...RW, idempotentHint: true }, description: 'Change a task’s title, description, priority, labels or due date.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY, title: { type: 'string' }, body: { type: 'string' }, priority: { enum: ['none', 'low', 'medium', 'high', 'urgent'] }, labels: { type: 'array', items: { type: 'string' } }, due_at: { type: 'string' } } } },
];

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const withLink = (t) => ({ ...t, url: link(t) });

async function guard(db, actor, tool, args) {
  const tok = actor.token; if (!tok) return;
  if (tool.write && !tok.scopes.includes('tasks:write')) throw new svc.TaskError('This credential lacks tasks:write', 'scope_missing', 403);
  if (!tok.scopes.includes('tasks:read')) throw new svc.TaskError('This credential lacks tasks:read', 'scope_missing', 403);
  if (!tok.taskId) return;
  if (tool.name === 'create_task') throw new svc.TaskError('This credential is for one task only', 'single_task', 403);
  if (args.key) { const row = (await db.query('SELECT id FROM tasks WHERE number = $1', [String(args.key).replace(/^T-/i, '')])).rows[0]; if (!row || String(row.id) !== tok.taskId) throw new svc.TaskError('This credential is for one task only', 'single_task', 403); }
}

export async function callTool(db, actor, name, args = {}, ctx = {}) {
  const project = args.project || args.project_id || ctx.project || null;
  const tool = TOOLS.find((x) => x.name === name); if (!tool) throw new svc.TaskError(`Unknown tool ${name}`, 'unknown_tool', 404);
  await guard(db, actor, tool, args);
  switch (name) {
    case 'list_projects': {
      const projects = await svc.listTaskProjects(db, actor);
      return ok({ projects, ...(projects.length ? {} : { hint: actor.kind === 'agent' ? 'You are not on any project yet. Ask the person to add you in XENO: Tasks › Agents › your agent › Add project. You can still work on tasks delegated to you.' : 'You have no projects yet.' }) });
    }
    case 'list_my_tasks': {
      const status = args.status || 'raised,todo,in_progress,blocked,in_review';
      const row = (x) => ({ key: x.key, title: x.title, status: x.status, priority: x.priority, project: x.project ? x.project.name : null, url: link(x) });
      let list = await svc.listTasks(db, actor, { ...(actor.kind === 'agent' ? { delegate: 'me' } : { assignee: 'me' }), status, ...(project ? { projectId: project } : {}) });
      if (actor.token && actor.token.taskId) list = list.filter((x) => String(x.id) === actor.token.taskId);
      let open = [];
      if (project && !(actor.token && actor.token.taskId)) {
        open = (await svc.listTasks(db, actor, { projectId: project, status: 'raised,todo' })).filter((x) => !x.assignee && !x.delegate && !list.some((y) => y.key === x.key));
      }
      const out = { tasks: list.map(row), ...(open.length ? { unassigned: open.slice(0, 50).map(row) } : {}) };
      if (!list.length && !open.length && actor.kind === 'agent') {
        const projects = await svc.listTaskProjects(db, actor);
        out.hint = projects.length ? 'Nothing is delegated to you. Pass a project to see tasks you could take, or ask the person to delegate one.' : 'Nothing is delegated to you and you are not on any project yet. Ask the person to add you to a project in XENO (Tasks › Agents), or to delegate a task to you.';
      }
      return ok(out);
    }
    case 'get_task': { const t = await svc.getTask(db, actor, args.key); return ok({ task: withLink(t), ...(actor.kind === 'agent' ? { guidance: (await guidanceFor(db, t, actor.id)).text } : {}) }); }
    case 'list_events': return ok(await svc.agentEvents(db, actor, { after: args.after }));
    case 'create_task': return ok({ task: withLink(await svc.createTask(db, actor, { title: args.title, body: args.body || '', kind: args.kind, priority: args.priority, projectId: args.parent_key ? undefined : (project || undefined), area: args.area, parentKey: args.parent_key })) });
    case 'heartbeat': return ok(await svc.heartbeatTask(db, actor, args.key, { runId: args.run_id }));
    case 'release': { const r = await svc.releaseTask(db, actor, args.key, { runId: args.run_id }); return ok({ released: r.released, task: withLink(r.task) }); }
    case 'claim_task': { const t = await svc.claimTask(db, actor, args.key, { runId: args.run_id }); return ok({ task: withLink(t), ...(actor.kind === 'agent' ? { guidance: (await guidanceFor(db, t, actor.id)).text } : {}) }); }
    case 'move_task': return ok({ task: withLink(await svc.transitionTask(db, actor, args.key, { to: args.to, from: args.from, note: args.note })) });
    case 'comment': return ok({ task: withLink(await svc.commentTask(db, actor, args.key, { body: args.body })) });
    case 'report_activity': return ok({ task: withLink(await svc.reportActivity(db, actor, args.key, { type: args.type, kind: args.kind, body: args.body, data: args.data })) });
    case 'update_task': { const b = {}; for (const [k, v] of [['title', args.title], ['body', args.body], ['priority', args.priority], ['labels', args.labels], ['dueAt', args.due_at]]) if (v !== undefined) b[k] = v; return ok({ task: withLink(await svc.updateTask(db, actor, args.key, b)) }); }
    default: throw new svc.TaskError(`Unknown tool ${name}`, 'unknown_tool', 404);
  }
}

export async function dispatch(db, actor, body, ctx = {}) {
  const id = body && body.id != null ? body.id : null;
  const rpcError = (code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
  if (!body || body.jsonrpc !== '2.0') return rpcError(-32600, 'jsonrpc must be "2.0"');
  switch (body.method) {
    case 'initialize':
    {
      const asked = body.params && body.params.protocolVersion;
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION, serverInfo: { name: 'xeno-tasks', title: 'XENO Tasks', version: '1.1.0' }, capabilities: { tools: { listChanged: false } }, instructions: 'XENO Tasks. If the folder you are working in has .xeno/tasks.json, it names this folder’s XENO project: pass its project.id as project. Start with list_my_tasks (with project it also shows unassigned tasks you could take). To work a task: claim_task with your run_id (heartbeat while you work; release when you stop), then report_activity as you go (kind plan first, handover before you stop, done at the end) (type ask when you need a decision from the assignee, then wait for their reply in list_events), then comment with what you changed and how you verified it, and move_task to in_review. You can never accept your own work.' } };
    }
    case 'notifications/initialized': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) } };
    case 'tools/call': {
      const name = body.params && body.params.name;
      try { return { jsonrpc: '2.0', id, result: await callTool(db, actor, name, (body.params && body.params.arguments) || {}, ctx) }; }
      catch (e) { if (e instanceof svc.TaskError) return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }], structuredContent: { error: e.message, code: e.code } } }; throw e; }
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    default: return rpcError(-32601, `Unknown method ${body.method}`);
  }
}

export function manifest(where = {}) {
  return { name: 'xeno-tasks', title: 'XENO Tasks', protocolVersions: PROTOCOL_VERSIONS, transport: 'streamable-http', endpoint: where.resource || `${SITE}/api/tasks/mcp`,
    auth: { oauth: where.metadata || null, note: 'OAuth 2.1 with PKCE (clients register themselves, RFC 7591), or Authorization: Bearer xtk_… for a Tasks credential' },
    projectHeader: 'X-Xeno-Tasks-Project', tools: TOOLS.map(({ name, title, description, write }) => ({ name, title, description, write })) };
}
