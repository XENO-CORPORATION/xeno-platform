/**
 * XENO Agent in the cloud (owner, 2026-11-14: "we need to implement cloud as the default ... we have xeno compute and
 * xeno box ... we need to build agent interface properly"; xeno-agent-interface decision 0006, cloud amendment).
 *
 * A cloud session is the person's own Compute machine running the SAME XENO Agent host their PC runs (xeno-compute
 * machine/agenthost, the named port `agent`). The Agent page connects to it as it connects to a PC, so there is one
 * interface and one kind of session, and a turn keeps running on the machine after the tab is closed.
 *
 *   - The machine: one small "Cloud Agent" machine per person (purpose cloud-agent), in their Personal workspace,
 *     created on first open and started when needed. Its home folder (chats, repositories, the host's state) survives
 *     stops like every machine's. It is billed like every machine: by time, from the person's credits (compute.js).
 *   - The model key: the host on the machine calls XENO inference as the PERSON, with their own short-lived session key
 *     (inferenceSessionKeys.js, the kind `xeno run` on a machine already uses). The key lives in the machine's home
 *     folder, where the machine's agent server reads it when it starts the host. It is written before a connection
 *     when there is none or it runs out soon, and the one it replaces is revoked. The machine never holds the person's
 *     sign-in, and never an operator credential.
 *   - Who: a person, never an agent, and for now whoever Cloud Shell is open to (SHELL_ENABLED; fail closed). It is the
 *     same thing to allow: a machine of your own that runs what you tell it.
 *
 * Not end-to-end encrypted: XENO runs the machine. Chats on a person's own PC stay sealed (decision 0006); the page
 * says which is which.
 */
import * as compute from './compute.js';
import { shellEnabledFor } from './cloudShell.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { createSessionKey, revokeSessionKey, TTL_MAX } from './inferenceSessionKeys.js';
import { recordSecurityEventTransactional, EVENTS } from './securityEvents.js';

const IDEMPOTENCY = 'xeno-cloud-agent';
export const AGENT_PORT = 'agent';
/** Where the machine's agent server reads the key (xeno-compute machine/agenthost/server.mjs). */
export const KEY_FILE = '.xeno-cloud-agent/key.json';
/**
 * Where the machine's XENO Agent host reads the person's key. The machine starts the host in its hosted account mode
 * with this folder as its credential root (xeno-compute `machine/agenthost`), and the host rereads the file for each
 * request, so a renewed key is picked up. NOT `~/.xeno/credentials.json`: the CLI empties that file into its own
 * store when it starts, and the host then has no key (measured on a real machine, 2026-11-14).
 */
export const HOST_KEY_FILE = '.xeno-cloud-agent/.xeno/credentials.json';
/** A key with less than this left is replaced, so a host started now has hours of it. */
export const RENEW_BELOW_MINUTES = 120;

export class CloudAgentError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

async function personOf(actor) {
  if (!actor || !actor.id) throw new CloudAgentError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'agent' || actor.kind === 'service') throw new CloudAgentError('A cloud session is opened by a person', 'human_only', 403);
  return String(actor.id);
}

const machineOf = async (db, personId, workspaceId) => (await db.query(
  `SELECT id, state, last_active_at FROM compute_machines WHERE created_by_user_id = $1 AND purpose = 'cloud-agent' ${workspaceId ? 'AND workspace_id = $2' : ''}
      AND state NOT IN ('deleted', 'failed') ORDER BY created_at LIMIT 1`, workspaceId ? [personId, workspaceId] : [personId])).rows[0];

/**
 * Whether a cloud session is open to the caller, and how their machine stands if one exists. It starts nothing: the
 * Agent page asks this when it opens, draws itself from what it remembers, and starts the machine only when a message
 * is sent (owner, 2026-11-15). `lastActiveAt` lets the page tell that the machine was used since it last looked (another
 * device, a turn left running), so it does not show what it remembers as if it were current.
 */
export async function cloudAgentStatus(db, actor) {
  if (!actor || !actor.id || actor.kind === 'agent' || actor.kind === 'service') return { enabled: false };
  const personId = String(actor.id);
  if (!(await shellEnabledFor(db, personId))) return { enabled: false };
  const m = await machineOf(db, personId, null);
  return { enabled: true, ...(m ? { machineId: m.id, state: m.state, lastActiveAt: m.last_active_at ? new Date(m.last_active_at).toISOString() : null } : {}) };
}

async function inTx(db, fn) {
  const c = typeof db.connect === 'function' ? await db.connect() : db;
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { if (c !== db) c.release(); }
}

/** What the key file on the machine says about its key, without the key: { keyId, expiresAt } or null. */
async function keyOnMachine(db, actor, machineId, workspace) {
  try {
    const held = JSON.parse((await compute.readMachineFile(db, actor, machineId, { path: KEY_FILE, workspace })).toString('utf8'));
    if (typeof held.keyId !== 'string' || typeof held.expiresAt !== 'string') return null;
    // the host's own copy must be the same key, or the host cannot reach a model and the key is made again
    let host = null;
    try { host = JSON.parse((await compute.readMachineFile(db, actor, machineId, { path: HOST_KEY_FILE, workspace })).toString('utf8')); } catch { /* not there */ }
    return { keyId: held.keyId, expiresAt: held.expiresAt, hostHasIt: !!host && host.keyId === held.keyId && typeof host.apiKey === 'string' };
  } catch { return null; }
}

/**
 * Make sure the machine holds a model key with hours left. Returns { minted } for the caller's record. A key that is
 * replaced is revoked first, so a person never holds two for one machine.
 */
export async function ensureModelKey(db, actor, machineId, workspace, { now = Date.now() } = {}) {
  const held = await keyOnMachine(db, actor, machineId, workspace);
  if (held && held.hostHasIt && Date.parse(held.expiresAt) - now > RENEW_BELOW_MINUTES * 60_000) return { minted: false };
  const person = (await db.query('SELECT id, email FROM users WHERE id = $1', [actor.id])).rows[0];
  const key = await inTx(db, async (c) => {
    if (held) {
      await revokeSessionKey(c, person, held.keyId).catch((e) => { if (e.code !== 'NOT_FOUND') throw e; });
      await recordSecurityEventTransactional(c, EVENTS.SESSION_KEY_REVOKED, { userId: person.id, metadata: { keyId: held.keyId, machineId } });
    }
    const out = await createSessionKey(c, person, { ttlMinutes: TTL_MAX, label: `XENO Cloud Agent ${machineId}`, clientId: 'xeno-cloud-agent' });
    await recordSecurityEventTransactional(c, EVENTS.SESSION_KEY_ISSUED, { userId: person.id, metadata: { ...out.audit, machineId } });
    return out.key;
  });
  await compute.writeMachineFile(db, actor, machineId, { path: KEY_FILE, workspace, content: JSON.stringify({ apiKey: key.token, keyId: key.id, expiresAt: key.expiresAt }) });
  await compute.writeMachineFile(db, actor, machineId, { path: HOST_KEY_FILE, workspace, content: JSON.stringify({ apiKey: key.token, keyId: key.id }) });
  return { minted: true };
}

/** The machine's repository commands (xeno-compute machine/agenthost/repo.mjs). */
export const REPO_COMMAND = ['node', '/machine/agenthost/repo.mjs'];
const CLONE_TIMEOUT_MS = 25 * 60_000;

function parseAnswer(result) {
  const line = String(result.stdout || '').trim().split(/\r?\n/).pop() || '';
  try { const answer = JSON.parse(line); if (answer && typeof answer === 'object') return answer; } catch { /* said below */ }
  throw new CloudAgentError('The machine did not answer about its repositories', 'repo_unreadable', 502);
}

/**
 * The repositories on the person's Cloud machine, and the ones they allowed on GitHub. It starts nothing: a machine that
 * is not running answers with GitHub's list alone (the picker is drawn before a session exists, owner 2026-11-15).
 */
export async function cloudRepositories(db, actor, { github = null } = {}) {
  const personId = await personOf(actor);
  if (!(await shellEnabledFor(db, personId))) throw new CloudAgentError('Cloud sessions are not open to your account yet', 'cloud_agent_not_enabled', 403);
  const m = await machineOf(db, personId, null);
  let onMachine = []; let machine = m ? m.state : 'none';
  if (m && m.state === 'running') {
    try {
      const answer = parseAnswer(await compute.execMachine(db, actor, m.id, { argv: [...REPO_COMMAND, 'list'], timeoutMs: 30_000 }));
      onMachine = answer.ok && Array.isArray(answer.repositories) ? answer.repositories.map((r) => ({ fullName: r.fullName, host: r.host, path: r.path, branch: r.branch, usedAt: r.usedAt })) : [];
    } catch { machine = 'unreachable'; }
  }
  let allowed = []; let githubState = { configured: false, connected: false };
  if (github) {
    githubState = await github.githubStatus(db, actor);
    if (githubState.connected) allowed = await github.listRepositories(db, actor);
  }
  return { machine, onMachine, github: { configured: githubState.configured, connected: githubState.connected, installations: githubState.installations || [] }, allowed };
}

/**
 * Open a repository on the person's Cloud machine: clone it there once (or find it), and say where it is. A GitHub
 * repository the person allowed is cloned with a token for that repository alone, which goes to git through the
 * command's standard input and is gone when the command ends; anything else is cloned as the public would.
 */
export async function openCloudRepository(db, actor, { repository, github = null } = {}) {
  const personId = await personOf(actor);
  if (!(await shellEnabledFor(db, personId))) throw new CloudAgentError('Cloud sessions are not open to your account yet', 'cloud_agent_not_enabled', 403);
  if (typeof repository !== 'string' || !repository.trim() || repository.length > 400) throw new CloudAgentError('Name a repository: owner/name or its address', 'invalid_repository');
  const ws = String((await ensurePersonalWorkspace(db, personId)).id);
  const existing = await machineOf(db, personId, ws);
  const m = existing || await compute.createMachine(db, actor, { workspace: ws, name: 'Cloud Agent', size: 'small', purpose: 'cloud-agent', idempotencyKey: IDEMPOTENCY });
  if ((existing ? existing.state : m.state) !== 'running') await compute.startMachine(db, actor, m.id, { workspace: ws });
  const access = github ? await github.tokenForRepository(db, actor, repository) : null;
  const result = await compute.execMachine(db, actor, m.id, { argv: [...REPO_COMMAND, 'open'], workspace: ws, timeoutMs: CLONE_TIMEOUT_MS,
    stdin: JSON.stringify(access ? { repository, token: access.token } : { repository }) });
  const answer = parseAnswer(result);
  if (!answer.ok) throw new CloudAgentError(answer.message || 'The repository could not be opened', answer.code || 'clone_failed', answer.code === 'needs_access' ? 403 : 400);
  return { machineId: m.id, repository: { fullName: answer.fullName, host: answer.host, path: answer.path, branch: answer.branch, existed: !!answer.existed, withAccess: !!access } };
}

/** Open a cloud session: find or create the person's machine, start it, give its host a model key, and hand back a one-use ticket for its `agent` port. */
export async function openCloudAgent(db, actor, { createTicket } = {}) {
  const personId = await personOf(actor);
  if (!(await shellEnabledFor(db, personId))) throw new CloudAgentError('Cloud sessions are not open to your account yet', 'cloud_agent_not_enabled', 403);
  const ws = String((await ensurePersonalWorkspace(db, personId)).id);
  const existing = await machineOf(db, personId, ws);
  const m = existing || await compute.createMachine(db, actor, { workspace: ws, name: 'Cloud Agent', size: 'small', purpose: 'cloud-agent', idempotencyKey: IDEMPOTENCY });
  const state = existing ? existing.state : m.state;
  if (state !== 'running') await compute.startMachine(db, actor, m.id, { workspace: ws });
  await ensureModelKey(db, actor, m.id, ws);
  const ticket = await createTicket(db, actor, m.id, AGENT_PORT, { workspace: ws });
  return { machineId: m.id, workspaceId: ws, name: 'Cloud', connect: ticket };
}
