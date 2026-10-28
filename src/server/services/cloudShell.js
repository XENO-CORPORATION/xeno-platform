/**
 * XENO Cloud Shell (XENO WORKSPACE AGENT SURFACE - SPEC.md P4, approved 2026-10-20; runs on the person's own Compute
 * machine per the owner's 2026-10-27 decision): a terminal in the workspace, preloaded with the `xeno` CLI and signed
 * in as the person's own Cloud Shell AGENT — never as the person.
 *
 *   - The machine: one small "Cloud Shell" machine per person (purpose cloud-shell), in their Personal workspace,
 *     created on first open and started when needed; its home folder survives stops like every machine's.
 *   - The credential: per connection, a short-lived xwk_ key (createRunKey, 60 min) for the person's Cloud Shell agent
 *     (bound to the app `xeno-cloud-shell`), in the forwarded connection's X-Xeno-Shell-Key header, kept 60 minutes
 *     ahead while the connection is open (renewConnection) and revoked when the socket closes. What it may do is what that agent has been GRANTED: on first use, the read-only (`safe`)
 *     capabilities in the machine's workspace; anything that changes data needs the person's grant (Connected apps).
 *   - Behind SHELL_ENABLED (fail closed; owner first, spec §5 Q3): a comma list of emails and @domains, or "all".
 */
import * as compute from './compute.js';
import * as creds from './workspaceCredentials.js';
import { boundAgentFor, bindClientAgent, mcpAgentFor } from './xenoTasks.js';
import { CATALOGUE } from '../capabilities/catalogue.js';
import { WORKSPACE_SCOPES } from '../capabilities/scopes.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';

export const SHELL_CLIENT = 'xeno-cloud-shell';
export const KEY_MINUTES = 60; // the run-key ceiling (workspaceCredentials.createRunKey)
const IDEMPOTENCY = 'xeno-cloud-shell';

export class CloudShellError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

/** Whether Cloud Shell is open to this person (SHELL_ENABLED). Unset or empty = closed to everyone. */
export async function shellEnabledFor(db, userId) {
  const list = String(process.env.SHELL_ENABLED || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  if (list.includes('all')) return true;
  const email = String((await db.query('SELECT email FROM users WHERE id = $1 AND is_active', [userId])).rows[0]?.email || '').toLowerCase();
  if (!email) return false;
  return list.some((e) => (e.startsWith('@') ? email.endsWith(e) : email === e));
}

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new CloudShellError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'agent' || actor.kind === 'service') throw new CloudShellError('Cloud Shell is opened by a person', 'human_only', 403);
  return String(actor.id);
}

/** The person's Cloud Shell agent (created and bound on first use). */
export async function shellAgent(db, personId) {
  const bound = await boundAgentFor(db, personId, SHELL_CLIENT);
  if (bound) return bound;
  const agentId = await mcpAgentFor(db, personId, 'XENO Cloud Shell');
  await bindClientAgent(db, personId, SHELL_CLIENT, agentId);
  return agentId;
}

/** On first use in a workspace, the agent may READ there; nothing that changes data until the person grants it. */
export async function ensureReadGrants(db, agentId, workspaceId) {
  if ((await creds.listGrants(db, agentId)).some((g) => g.workspaceId === String(workspaceId).toLowerCase())) return false;
  const safe = CATALOGUE.filter((c) => c.class === 'safe').map((c) => c.name);
  if (safe.length) await creds.grant(db, agentId, workspaceId, safe);
  return true;
}

/** Whether Cloud Shell is open to the caller, and their shell machine if one exists (for the workspace's button). */
export async function shellStatus(db, actor) {
  if (!actor || !actor.id || actor.kind === 'agent' || actor.kind === 'service') return { enabled: false };
  const personId = String(actor.id);
  if (!(await shellEnabledFor(db, personId))) return { enabled: false };
  const m = (await db.query(`SELECT id, state FROM compute_machines WHERE created_by_user_id = $1 AND purpose = 'cloud-shell'
      AND state NOT IN ('deleted', 'failed') ORDER BY created_at LIMIT 1`, [personId])).rows[0];
  return { enabled: true, ...(m ? { machineId: m.id, state: m.state } : {}) };
}

/** Open Cloud Shell: find or create the person's machine, start it, and hand back a one-use ticket for its terminal. */
export async function openCloudShell(db, actor, { createTicket } = {}) {
  const personId = await personOf(db, actor);
  if (!(await shellEnabledFor(db, personId))) throw new CloudShellError('Cloud Shell is not open to your account yet', 'shell_not_enabled', 403);
  const ws = String((await ensurePersonalWorkspace(db, personId)).id);
  const existing = (await db.query(`SELECT id, state FROM compute_machines WHERE workspace_id = $1 AND created_by_user_id = $2 AND purpose = 'cloud-shell'
      AND state NOT IN ('deleted', 'failed') ORDER BY created_at LIMIT 1`, [ws, personId])).rows[0];
  const m = existing || await compute.createMachine(db, actor, { workspace: ws, name: 'Cloud Shell', size: 'small', purpose: 'cloud-shell', idempotencyKey: IDEMPOTENCY });
  const state = existing ? existing.state : m.state;
  if (state !== 'running') await compute.startMachine(db, actor, m.id, { workspace: ws });
  const ticket = await createTicket(db, actor, m.id, 'shell', { workspace: ws });
  return { machineId: m.id, workspaceId: ws, url: `/workspace/shell/${m.id}`, connect: ticket };
}

/** The credential for one shell connection (computePorts calls this on the `shell` port). Returns { key, keyId }. */
export async function connectionKey(db, ctx) {
  if (ctx.agentId) throw new CloudShellError('Cloud Shell is opened by a person', 'human_only', 403);
  if (!(await shellEnabledFor(db, ctx.userId))) throw new CloudShellError('Cloud Shell is not open to your account yet', 'shell_not_enabled', 403);
  const agentId = await shellAgent(db, ctx.userId);
  await ensureReadGrants(db, agentId, ctx.workspaceId);
  const k = await creds.createRunKey(db, { ownerId: ctx.userId, agentId, workspaceId: ctx.workspaceId, scopes: [...WORKSPACE_SCOPES], label: 'Cloud Shell', minutes: KEY_MINUTES });
  return { key: k.key, keyId: k.id };
}

/** While the connection is open (computePorts' recheck): Cloud Shell must still be open to the person, and the key is
 *  kept 60 minutes ahead, so it lives exactly as long as the connection. A key revoked elsewhere ends the shell. */
export async function renewConnection(db, keyId, userId) {
  if (!(await shellEnabledFor(db, userId))) throw new CloudShellError('Cloud Shell is not open to your account any more', 'shell_not_enabled', 403);
  if (!(await creds.renewRunKey(db, keyId, KEY_MINUTES))) throw new CloudShellError('This shell’s key was revoked', 'shell_key_revoked', 401);
}

export async function endConnection(db, keyId) {
  if (keyId) await creds.revokeRunKey(db, keyId).catch(() => {});
}
