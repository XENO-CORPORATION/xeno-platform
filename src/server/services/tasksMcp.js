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

const SITE = process.env.SITE_URL || 'https://xenosystem.ai';
export const PROTOCOL_VERSION = '2024-11-05';
const link = (t) => `${SITE}/workspace${t.area ? '/' + t.area : ''}/tasks/${t.key}`;
const KEY = { type: 'string', description: 'The task key, like T-12', pattern: '^T-\\d+$' };

export const TOOLS = [
  { name: 'list_my_tasks', write: false, description: 'Tasks delegated to you (an agent) or assigned to you (a person) that are still open. Start here.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma list: raised,todo,in_progress,blocked,in_review,done,wont_do' } } } },
  { name: 'get_task', write: false, description: 'One task: description (markdown), status, people, sub-tasks, links, images, and the full activity.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY } } },
  { name: 'list_events', write: false, description: 'What you have been told (delegated, mentioned, a reply, changes requested, accepted), after a cursor. Agents only.', inputSchema: { type: 'object', properties: { after: { type: 'string' } } } },
  { name: 'create_task', write: true, description: 'Raise a new task. It lands in Triage until someone accepts it.', inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, body: { type: 'string' }, kind: { enum: ['task', 'bug', 'feature', 'question'] }, priority: { enum: ['none', 'low', 'medium', 'high', 'urgent'] }, project_id: { type: 'string' }, area: { type: 'string' }, parent_key: KEY } } },
  { name: 'claim_task', write: true, description: 'Take a task: a person becomes its assignee, an agent its delegate.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY } } },
  { name: 'move_task', write: true, description: 'Move a task: todo, in_progress, blocked, in_review, done, wont_do, raised. Send work to in_review; you can never accept your own work. Pass `from` (the status you saw) so you never overwrite a newer state.', inputSchema: { type: 'object', required: ['key', 'to'], properties: { key: KEY, to: { type: 'string' }, from: { type: 'string' }, note: { type: 'string' } } } },
  { name: 'comment', write: true, description: 'Comment on a task (markdown; @username mentions someone).', inputSchema: { type: 'object', required: ['key', 'body'], properties: { key: KEY, body: { type: 'string' } } } },
  { name: 'report_activity', write: true, description: 'As the task’s delegate, show what you are doing: thought, action, ask (a question to the assignee; you wait for their reply), result, error.', inputSchema: { type: 'object', required: ['key', 'type', 'body'], properties: { key: KEY, type: { enum: ['thought', 'action', 'ask', 'result', 'error'] }, body: { type: 'string' } } } },
  { name: 'update_task', write: true, description: 'Change a task’s title, description, priority, labels or due date.', inputSchema: { type: 'object', required: ['key'], properties: { key: KEY, title: { type: 'string' }, body: { type: 'string' }, priority: { enum: ['none', 'low', 'medium', 'high', 'urgent'] }, labels: { type: 'array', items: { type: 'string' } }, due_at: { type: 'string' } } } },
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

export async function callTool(db, actor, name, args = {}) {
  const tool = TOOLS.find((x) => x.name === name); if (!tool) throw new svc.TaskError(`Unknown tool ${name}`, 'unknown_tool', 404);
  await guard(db, actor, tool, args);
  switch (name) {
    case 'list_my_tasks': {
      const status = args.status || 'raised,todo,in_progress,blocked,in_review';
      let list = await svc.listTasks(db, actor, actor.kind === 'agent' ? { delegate: 'me', status } : { assignee: 'me', status });
      if (actor.token && actor.token.taskId) list = list.filter((x) => String(x.id) === actor.token.taskId);
      return ok({ tasks: list.map((t) => ({ key: t.key, title: t.title, status: t.status, priority: t.priority, url: link(t) })) });
    }
    case 'get_task': return ok({ task: withLink(await svc.getTask(db, actor, args.key)) });
    case 'list_events': return ok(await svc.agentEvents(db, actor, { after: args.after }));
    case 'create_task': return ok({ task: withLink(await svc.createTask(db, actor, { title: args.title, body: args.body || '', kind: args.kind, priority: args.priority, projectId: args.project_id, area: args.area, parentKey: args.parent_key })) });
    case 'claim_task': return ok({ task: withLink(await svc.claimTask(db, actor, args.key)) });
    case 'move_task': return ok({ task: withLink(await svc.transitionTask(db, actor, args.key, { to: args.to, from: args.from, note: args.note })) });
    case 'comment': return ok({ task: withLink(await svc.commentTask(db, actor, args.key, { body: args.body })) });
    case 'report_activity': return ok({ task: withLink(await svc.reportActivity(db, actor, args.key, { type: args.type, body: args.body })) });
    case 'update_task': { const b = {}; for (const [k, v] of [['title', args.title], ['body', args.body], ['priority', args.priority], ['labels', args.labels], ['dueAt', args.due_at]]) if (v !== undefined) b[k] = v; return ok({ task: withLink(await svc.updateTask(db, actor, args.key, b)) }); }
    default: throw new svc.TaskError(`Unknown tool ${name}`, 'unknown_tool', 404);
  }
}

export async function dispatch(db, actor, body) {
  const id = body && body.id != null ? body.id : null;
  const rpcError = (code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
  if (!body || body.jsonrpc !== '2.0') return rpcError(-32600, 'jsonrpc must be "2.0"');
  switch (body.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, serverInfo: { name: 'xeno-tasks', version: '1.0.0' }, capabilities: { tools: {} }, instructions: 'XENO Tasks. Call list_my_tasks first. As a delegate: claim_task, report_activity while you work (ask when you need the assignee), then move_task to in_review with a comment saying what you did and how you checked it.' } };
    case 'notifications/initialized': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    case 'tools/call': {
      const name = body.params && body.params.name;
      try { return { jsonrpc: '2.0', id, result: await callTool(db, actor, name, (body.params && body.params.arguments) || {}) }; }
      catch (e) { if (e instanceof svc.TaskError) return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }], structuredContent: { error: e.message, code: e.code } } }; throw e; }
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    default: return rpcError(-32601, `Unknown method ${body.method}`);
  }
}

export function manifest() {
  return { name: 'xeno-tasks', protocolVersion: PROTOCOL_VERSION, transport: 'http-jsonrpc', endpoint: `${SITE}/api/tasks/mcp`, auth: 'Authorization: Bearer xtk_… (an agent’s Tasks credential) or a signed-in session', tools: TOOLS.map(({ name, description, write }) => ({ name, description, write })) };
}
