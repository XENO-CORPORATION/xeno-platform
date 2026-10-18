/**
 * XENO MCP `agents_*` — what the calling agent can learn about ITSELF (2026-10-18).
 *
 * `agents_whoami` answers "who am I here?" for an agent signed in to /api/mcp: its stable `agt_` id, its name, the
 * workspace and division that own it, the human who answers for it, the projects it can see, and its division's agent
 * budget. Every field is read from the rows the rest of the platform already uses — resolvePrincipal for the
 * principal and owner, agentAccess.ownershipOf for workspace and accountability, agentMedia.agentOf for the division,
 * xenoTasks.listTaskProjects for projects (the same list Tasks authorizes against), divisionAgentBudget.budgetOf for
 * the budget. Nothing is invented: a field the platform does not have is null, never a default.
 *
 * Read-only, and only about the caller. There is no argument: an agent cannot ask about another agent.
 */
import { resolvePrincipal } from './agentIdentity.js';
import { ownershipOf } from './agentAccess.js';
import { listTaskProjects, listTasks } from './xenoTasks.js';
import { budgetOf } from './divisionAgentBudget.js';
import { personalWorkspace } from './workforceDivisions.js';

export class AgentsMcpError extends Error { constructor(message, code) { super(message); this.name = 'AgentsMcpError'; this.code = code; } }

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });

export const TOOLS = [
  {
    name: 'whoami', title: 'Who am I',
    description: 'Your own identity on XENO: your agt_ id, name, owning workspace and division, the person who owns you, the projects you can see, and your division’s agent budget (null when it has none). Takes no arguments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

/**
 * "Who am I" for the calling agent — the ONE function behind both GET /api/tasks/agent/me (REST, what Spawn reads) and
 * the MCP tool `agents_whoami`, so the two can never drift. `me` is the caller as taskTokenAuth resolved it
 * ({ id, kind, name, token }). The shape is the REST endpoint's original one ({ success, agent, tasks }); the agent object
 * was extended ADDITIVELY on 2026-10-18 with handle, status, workspace, owner, accountable, projects and budget.
 */
export async function agentMe(db, me) {
  const tok = me.token || null;
  const ai = (await db.query(`SELECT ai.public_id, d.id AS division_id, d.name AS division_name FROM agent_identities ai LEFT JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id LEFT JOIN workforce_divisions d ON d.id = o.division_id WHERE ai.user_id = $1`, [me.id])).rows[0] || {};
  const principal = await resolvePrincipal(db, me.id);
  const o = await ownershipOf(db, me.id);
  // the owning workspace: a company agent's own, else its owner's personal workspace (as platformAgents shows it)
  const wsId = o && (o.owner_workspace_id || (o.resource_owner_user_id ? await personalWorkspace(db, o.resource_owner_user_id) : null));
  const w = wsId ? (await db.query('SELECT id, name, workspace_type FROM workspaces WHERE id = $1', [wsId])).rows[0] : null;
  const division = ai.division_id ? { id: String(ai.division_id), name: ai.division_name } : null;
  const budget = division ? await budgetOf(db, division.id) : null;
  return {
    success: true,
    agent: {
      id: String(me.id), agentId: ai.public_id || null, division,
      expiresAt: tok ? tok.expiresAt : null, name: me.name, kind: me.kind, scopes: tok ? tok.scopes : null, task: tok && tok.taskId ? true : false,
      // additive, 2026-10-18
      handle: principal ? principal.handle : null,
      status: principal ? (principal.usable ? 'active' : (principal.unusableReason || 'unavailable')) : null,
      workspace: w ? { id: String(w.id), name: w.name, kind: w.workspace_type === 'personal' ? 'personal' : 'company' } : null,
      owner: principal && principal.owner ? { handle: principal.owner.handle, name: principal.owner.displayName || principal.owner.handle } : null,
      accountable: o && o.owner_user_id ? { name: o.accountable_name || null } : null,
      projects: (await listTaskProjects(db, { id: me.id })).map((p) => ({ id: p.id, name: p.name, access: p.canEdit ? 'editor' : 'viewer' })),
      budget: budget ? { ...budget.view, scope: 'division' } : null,
    },
    tasks: (await listTasks(db, me, { delegate: 'me', status: 'raised,todo,in_progress,blocked,in_review' })).filter((x) => !tok || !tok.taskId || String(x.id) === tok.taskId),
  };
}

export async function whoami(db, actor) {
  if (!actor || actor.kind !== 'agent') throw new AgentsMcpError('whoami is for agents. Sign in as one of your agents to use it.', 'agents_only');
  return agentMe(db, actor);
}

export async function callTool(db, actor, name, _args = {}) {
  if (name === 'whoami') return ok(await whoami(db, actor));
  throw new AgentsMcpError(`Unknown tool ${name}`, 'unknown_tool');
}
