/**
 * agentCloudRuns.js — a person runs one of their own platform agents on a task, in the cloud.
 *
 * One code path for "run agent X on T-5":
 *   1. the agent and the task are checked as the PERSON (owned agent; a task the person can see);
 *   2. the agent's current instructions version is pinned to the run;
 *   3. the hosted run is started in xeno-agents-api as the person (a short delegated token, the same broker shape
 *      the marketplace uses), with the agent's instructions and runtime config, and a reference to this run --
 *      NOT a credential. A queued run therefore holds no live secret anywhere, not even in the runner's database;
 *   4. when the runner actually starts the run, it asks for the agent's credential by that reference
 *      (`issueRunCredential`, service-authenticated). It is minted then, once, for this run only, and revoked
 *      when the run ends;
 *   5. the run is recorded against the task, so the task and the agent page can show it.
 *
 * Who decides what: the hosted run's own ledger hold bills the person (budget_credits); every Tasks call the agent
 * makes inside the run carries the AGENT's credential, so the division boundary and "an agent never accepts its
 * own work" are enforced by the same server checks as anywhere else. Ending a run revokes the credential.
 */
import crypto from 'node:crypto';
import { agentsApiBaseUrl, mintDelegatedAccessToken, revokeDelegatedSession } from './marketplaceBroker.js';
import * as agents from './platformAgents.js';
import * as tasks from './xenoTasks.js';
import { guidanceFor } from './agentGuidance.js';
import { issuer } from '../config/hosts.js';
import { admitAccountRun, readRunnablePin, RunAdmissionError } from './workforceRunAdmission.js';
import { revokeRun } from './workforceRunAuthority.js';
import { MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';

export const RUN_ACTOR = 'xeno-agent-runs';
const DEFAULT_BUDGET_CREDITS = 20;
const MAX_BUDGET_CREDITS = 200;
const MAX_RUN_HOURS = 8;
const LIVE = new Set(['starting', 'queued', 'running']);
const TERMINAL_FROM_API = { completed: 'completed', failed: 'failed', cancelled: 'cancelled', skipped: 'cancelled', interrupted: 'failed' };

/**
 * The runner must SAY it runs platform agents. A runner that predates the capability accepts the run, drops the
 * agent's identity without a word, and bills a plain run that can never touch the task -- so the platform asks
 * first and refuses, rather than start something that looks right and is not.
 */
export const PLATFORM_AGENT_CAPABILITY = 'runs.platformAgent';
async function runnerSupportsAgents(base, fetchImpl) {
  try {
    const res = await fetchImpl(`${base}/status`, { headers: { accept: 'application/json' } });
    const j = await res.json().catch(() => null);
    return !!(res.ok && j && Array.isArray(j.capabilities) && j.capabilities.includes(PLATFORM_AGENT_CAPABILITY));
  } catch { return false; }
}

export class AgentRunError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'AgentRunError'; this.code = code; this.status = status; }
}

function view(r, agent) {
  return {
    id: String(r.id), state: r.state, reason: r.reason || null, runId: r.run_id || null,
    agent: agent ? { id: agent.id, name: agent.name } : undefined,
    task: r.task_key || undefined, version: r.agent_version, budgetCredits: Number(r.budget_credits),
    admissionId: r.admission_id ? String(r.admission_id) : null,
    createdAt: r.created_at, endedAt: r.ended_at || null,
  };
}

/** What the agent is told to do: who it is, its instructions, and the task. */
export function runPrompt(agent, task, guidance = null) {
  const lines = [
    `You are the XENO agent "${agent.name}" (${agent.id}${agent.division ? `, division ${agent.division.name}` : ''}, instructions v${agent.version}).`,
    'Work the XENO task below. Use the XenoTask tools: take it (XenoTaskTake), report what you are doing as you go (XenoTaskReport),',
    'comment with what you did and how you verified it (XenoTaskComment), then send it for review (XenoTaskMove to in_review).',
    'You can never accept your own work. If you need a decision, ask with XenoTaskReport type "ask" and stop.',
  ];
  // inherited guidance (agentGuidance.js): XENO's way of working, then the project's, the area's and the agent's
  // own words — the same text a local CLI reads from get_task, so both runs are told the same thing
  if (guidance) lines.push('', guidance);
  else if (agent.instructions) lines.push('', 'Your instructions:', agent.instructions);
  lines.push('', `Task ${task.key}: ${task.title}`, task.body ? `\n${task.body}` : '');
  return lines.join('\n').slice(0, 60000);
}

async function revokeCredential(db, owner, agentId, credentialId) {
  if (!credentialId) return;
  await agents.revokeCredential(db, owner, agentId, credentialId).catch(() => {});
}

/**
 * Start a cloud run of `agentId` (agt_) on `taskKey` (T-n). Idempotent per live run: while one is starting,
 * queued or running for this agent and task, the same run is returned.
 */
/**
 * RUN-01: the run is ADMITTED before anything starts, through the one admission service -- never a second path.
 * The target is the agent's own scope: a personally owned agent runs for its person; a workspace-owned agent runs
 * under its accepted assignment into the owning workspace. The admission reserves the ceiling on the canonical
 * ledger and is the authority every later step is re-checked against (issueRunCredential, refresh).
 */
async function admit(db, owner, agent, task, budget) {
  const res = agent.definitionId && (await db.query('SELECT owner_user_id, owner_workspace_id FROM workforce_resources WHERE id = $1', [agent.definitionId])).rows[0];
  if (!res) throw new AgentRunError('This agent has no workforce definition', 'agent_not_admittable', 409);
  let target;
  if (res.owner_workspace_id) {
    const a = (await db.query(`SELECT id FROM workforce_workspace_assignments WHERE resource_id = $1 AND workspace_id = $2 AND state = 'accepted'
      ORDER BY created_at LIMIT 1`, [agent.definitionId, res.owner_workspace_id])).rows[0];
    if (!a) throw new AgentRunError('This agent is not assigned into its workspace, so it cannot be admitted to run', 'agent_not_admittable', 409);
    target = { kind: 'workspace', assignmentId: a.id };
  } else target = { kind: 'personal', ownerUserId: owner.id };
  const ctx = { actorUserId: owner.id, clientId: RUN_ACTOR };
  try {
    const pin = await readRunnablePin(db, ctx, { agent: { resourceId: agent.definitionId }, target });
    const { admission } = await admitAccountRun(db, ctx, {
      operationId: crypto.randomUUID(), agent: pin.agent, target, capabilities: pin.terms.definition,
      budget: { ceilingMicro: String(Math.round(budget * MICRO_PER_CREDIT)) }, taskRef: task.key,
    });
    return admission.admissionId;
  } catch (e) {
    if (e instanceof RunAdmissionError) throw new AgentRunError(`The run was not admitted (${e.details.reason}). Nothing was started and nothing was charged.`, e.details.reason, e.status);
    throw e;
  }
}

/** Revoke a run's admission; releases its reservation when nothing is in flight (workforceRunAuthority.revokeRun). */
async function revokeAdmission(db, ownerId, admissionId) {
  if (!admissionId) return;
  await revokeRun(db, { actorUserId: ownerId }, admissionId).catch(() => {});
}

/** Revoked (it or any ancestor), or never admitted: either way no live authority. */
async function fenced(db, admissionId) {
  if (!admissionId) return true;
  return !!(await db.query('SELECT workforce_run_admission_fence($1) AS f', [admissionId])).rows[0].f;
}

export async function start(db, owner, agentId, { taskKey, budgetCredits } = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const base = agentsApiBaseUrl(env);
  if (!base) throw new AgentRunError('Cloud runs are not available on this server', 'cloud_runs_unavailable', 503);
  const agent = await agents.getWith(db, owner, agentId, 'runner');       // the run right, or 403/404
  let task = await tasks.getTask(db, owner, String(taskKey || ''));          // visible to the person, or the task error
  const budget = budgetCredits === undefined ? DEFAULT_BUDGET_CREDITS : Number(budgetCredits);
  if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_CREDITS) {
    throw new AgentRunError(`The budget is between 1 and ${MAX_BUDGET_CREDITS} credits`, 'invalid_budget');
  }
  if (!agent.version) throw new AgentRunError('This agent has no instructions version yet', 'agent_not_ready', 409);
  if (!(await runnerSupportsAgents(base, fetchImpl))) {
    throw new AgentRunError('The cloud runner cannot run XENO agents yet. Nothing was started and nothing was charged.', 'runner_lacks_agents', 503);
  }

  // The run works the task as its delegate, so the task is delegated to this agent first -- by the same rule as a
  // delegation from the task page (only its creator may), and the same server check on the agent's projects.
  if (!task.delegate || String(task.delegate.id) !== String(agent.userId)) {
    task = await tasks.delegateTask(db, owner, task.key, { agentId: agent.userId });
  }
  const live = (await db.query(`SELECT * FROM agent_cloud_runs WHERE agent_user_id = $1 AND task_id = $2 AND state = ANY($3)`,
    [agent.userId, task.id, [...LIVE]])).rows[0];
  if (live) return { ...view({ ...live, task_key: task.key }, agent), existing: true };

  const admissionId = await admit(db, owner, agent, task, budget);
  let row;
  try {
    row = (await db.query(`INSERT INTO agent_cloud_runs (owner_user_id, agent_user_id, task_id, agent_version, budget_credits, admission_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [owner.id, agent.userId, task.id, agent.version, budget, admissionId])).rows[0];
  } catch (e) {
    await revokeAdmission(db, owner.id, admissionId);
    if (e.code === '23505') {   // a concurrent start won the live slot
      const won = (await db.query(`SELECT * FROM agent_cloud_runs WHERE agent_user_id = $1 AND task_id = $2 AND state = ANY($3)`,
        [agent.userId, task.id, [...LIVE]])).rows[0];
      if (won) return { ...view({ ...won, task_key: task.key }, agent), existing: true };
    }
    throw e;
  }

  const fail = async (state, reason) => {
    const r = (await db.query(`UPDATE agent_cloud_runs SET state = $2, reason = $3, ended_at = CASE WHEN $2 = 'uncertain' THEN NULL ELSE now() END
      WHERE id = $1 RETURNING *`, [row.id, state, String(reason).slice(0, 200)])).rows[0];
    // A refused run is over: its reservation is released. An uncertain one may still be running; it stays held.
    if (state !== 'uncertain') await revokeAdmission(db, owner.id, admissionId);
    return view({ ...r, task_key: task.key }, agent);
  };

  const { token, sid } = await mintDelegatedAccessToken(db, owner.id, {
    actor: RUN_ACTOR, act: { sub: RUN_ACTOR, agent_run_id: String(row.id) },
    record: (s) => db.query('UPDATE agent_cloud_runs SET delegated_sids = array_append(delegated_sids, $2::uuid) WHERE id = $1', [row.id, s]),
  });
  try {
    let res;
    try {
      res = await fetchImpl(`${base}/runs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `agent-run:${row.id}` },
        body: JSON.stringify({
          prompt: runPrompt(agent, task, (await guidanceFor(db, task, agent.userId)).text),
          title: `${agent.name} · ${task.key} ${task.title}`.slice(0, 200),
          ...(agent.runtime && agent.runtime.model ? { model: agent.runtime.model } : {}),
          ...(agent.runtime && agent.runtime.effort ? { effort: agent.runtime.effort } : {}),
          permissionMode: 'auto',
          agent: { name: agent.username, description: `platform agent ${agent.id} v${agent.version}` },
          // The run acts AS the agent in XENO: the runner opens a native platform session with this credential
          // (never logged, never returned) and gives the run the XenoTask* tools. The tool scope narrows them.
          platformAgent: {
            issuer: issuer(), agentId: agent.id, runRef: String(row.id),
            ...(agent.runtime && agent.runtime.tools ? { tools: agent.runtime.tools } : {}),
          },
          budget: { maxCredits: budget },
        }),
      });
    } catch {
      return await fail('uncertain', 'transport_error');
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.run && body.run.runId) {
      // the runner may already have claimed its credential (and set `running`) before this answer is stored
      const r = (await db.query(`UPDATE agent_cloud_runs SET run_id = COALESCE(run_id, $2),
          state = CASE WHEN state = 'running' THEN state ELSE $3 END WHERE id = $1 RETURNING *`,
        [row.id, String(body.run.runId), body.run.status === 'running' ? 'running' : 'queued'])).rows[0];
      return view({ ...r, task_key: task.key }, agent);
    }
    if (res.status >= 400 && res.status < 500) {
      const code = (typeof body?.error === 'string' ? body.error : body?.error?.code) || body?.code || `http_${res.status}`;
      return await fail('refused', code);
    }
    return await fail('uncertain', `http_${res.status}`);
  } finally {
    await revokeDelegatedSession(db, sid);
  }
}

/**
 * The runner, starting a run, asks for its agent credential (service-authenticated; never a person or an agent).
 * Issued ONCE per run, only while the run is live and has a hosted run id that matches; a second ask is refused,
 * so a leaked reference cannot mint a second credential. Returns the token for the runner to hand to the run
 * over its private channel.
 */
export async function issueRunCredential(db, { runRef, runId }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(runRef || '')) || typeof runId !== 'string' || !runId) throw new AgentRunError('runRef and runId are required', 'bad_request');
  const row = (await db.query(`SELECT r.*, a.public_id, u.id AS owner_id FROM agent_cloud_runs r
      JOIN agent_identities a ON a.user_id = r.agent_user_id JOIN users u ON u.id = r.owner_user_id
     WHERE r.id = $1 FOR UPDATE OF r`, [runRef])).rows[0];
  // The runner can start the run and ask for its credential BEFORE our start call has stored the hosted run id it
  // was given (a race: the runner answers, then claims, faster than we write). A run still `starting` with no id
  // yet binds to the first id that asks; once an id is stored, only that id is answered.
  if (row && !row.run_id && row.state === 'starting' && /^run_[0-9a-f]{32}$/.test(runId)) {
    await db.query(`UPDATE agent_cloud_runs SET run_id = $2 WHERE id = $1`, [row.id, runId]); row.run_id = runId;
  }
  if (!row || row.run_id !== runId) throw new AgentRunError('No such run', 'run_not_found', 404);
  if (!LIVE.has(row.state)) throw new AgentRunError('The run has ended', 'run_ended', 409);
  if (row.credential_id) throw new AgentRunError('This run already has its credential', 'credential_issued', 409);
  // RUN-03: live authority overrides the pin. A revoked admission (or a run never admitted) mints nothing.
  if (await fenced(db, row.admission_id)) {
    await db.query(`UPDATE agent_cloud_runs SET state = 'cancelled', reason = 'admission_revoked', ended_at = now() WHERE id = $1`, [row.id]);
    throw new AgentRunError('The run is no longer authorized', 'run_revoked', 409);
  }
  const owner = { id: row.owner_id, kind: 'human' };
  const cred = await agents.mintCredential(db, owner, row.public_id, { label: `Cloud run ${String(row.id).slice(0, 8)}`, ttlHours: MAX_RUN_HOURS });
  await db.query(`UPDATE agent_cloud_runs SET credential_id = $2, state = 'running' WHERE id = $1`, [row.id, cred.id]);
  return { token: cred.token, expiresAt: cred.expiresAt, agentId: row.public_id };
}

/** Refresh one run's state from xeno-agents-api; a run that ended gets its credential revoked. */
export async function refresh(db, owner, row, { fetchImpl = fetch, env = process.env } = {}) {
  // A revoked admission ends a live run here: the hosted run is stopped and its credential revoked.
  if (LIVE.has(row.state) && row.admission_id && await fenced(db, row.admission_id)) {
    await stop(db, owner, row.id, { fetchImpl, env, reason: 'admission_revoked' });
    return (await db.query('SELECT * FROM agent_cloud_runs WHERE id = $1', [row.id])).rows[0];
  }
  if (!row.run_id || !LIVE.has(row.state) && row.state !== 'uncertain') return row;
  const base = agentsApiBaseUrl(env); if (!base) return row;
  const { token, sid } = await mintDelegatedAccessToken(db, owner.id, {
    actor: RUN_ACTOR, act: { sub: RUN_ACTOR, agent_run_id: String(row.id) },
    record: (s) => db.query('UPDATE agent_cloud_runs SET delegated_sids = array_append(delegated_sids, $2::uuid) WHERE id = $1', [row.id, s]),
  });
  try {
    let res;
    try { res = await fetchImpl(`${base}/runs/${encodeURIComponent(row.run_id)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }); }
    catch { return row; }
    const body = await res.json().catch(() => null);
    const status = body && body.run && body.run.status;
    if (!status) return row;
    const ended = TERMINAL_FROM_API[status];
    const state = ended || (status === 'running' ? 'running' : 'queued');
    if (state === row.state) return row;
    const r = (await db.query(`UPDATE agent_cloud_runs SET state = $2, reason = $3, ended_at = CASE WHEN $4 THEN now() ELSE ended_at END WHERE id = $1 RETURNING *`,
      [row.id, state, ended ? String(body.run.statusReason || status).slice(0, 200) : row.reason, !!ended])).rows[0];
    if (ended) {
      await revokeAdmission(db, owner.id, row.admission_id);
      const a = (await db.query('SELECT public_id FROM agent_identities WHERE user_id = $1', [row.agent_user_id])).rows[0];
      if (a) await revokeCredential(db, owner, a.public_id, row.credential_id);
    }
    return r;
  } finally {
    await revokeDelegatedSession(db, sid);
  }
}

/** Stop a run. The hosted run is stopped and the credential revoked at once, whatever the runner answers. */
export async function stop(db, owner, runRowId, { fetchImpl = fetch, env = process.env, reason = 'stopped_by_owner' } = {}) {
  const row = (await db.query('SELECT r.*, a.public_id FROM agent_cloud_runs r JOIN agent_identities a ON a.user_id = r.agent_user_id WHERE r.id::text = $1 AND r.owner_user_id = $2', [String(runRowId), owner.id])).rows[0];
  if (!row) throw new AgentRunError('Run not found', 'run_not_found', 404);
  await revokeCredential(db, owner, row.public_id, row.credential_id);
  await revokeAdmission(db, owner.id, row.admission_id);
  if (row.run_id && LIVE.has(row.state)) {
    const base = agentsApiBaseUrl(env);
    if (base) {
      const { token, sid } = await mintDelegatedAccessToken(db, owner.id, {
        actor: RUN_ACTOR, act: { sub: RUN_ACTOR, agent_run_id: String(row.id) },
        record: (s) => db.query('UPDATE agent_cloud_runs SET delegated_sids = array_append(delegated_sids, $2::uuid) WHERE id = $1', [row.id, s]),
      });
      try { await fetchImpl(`${base}/runs/${encodeURIComponent(row.run_id)}/stop`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => {}); }
      finally { await revokeDelegatedSession(db, sid); }
    }
  }
  const r = LIVE.has(row.state)
    ? (await db.query(`UPDATE agent_cloud_runs SET state = 'cancelled', reason = $2, ended_at = now() WHERE id = $1 RETURNING *`, [row.id, reason])).rows[0]
    : row;
  return view(r);
}

/** An agent's runs (newest first), refreshed when still live. */
export async function listForAgent(db, owner, agentId, opts = {}) {
  const agent = await agents.get(db, owner, agentId);
  const rows = (await db.query(`SELECT r.*, 'T-' || t.number AS task_key FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id
    WHERE r.agent_user_id = $1 AND r.owner_user_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [agent.userId, owner.id])).rows;
  const out = [];
  for (const row of rows) out.push(view({ ...(await refresh(db, owner, row, opts)), task_key: row.task_key }, agent));
  return out;
}

export const _internals = { DEFAULT_BUDGET_CREDITS, MAX_BUDGET_CREDITS, MAX_RUN_HOURS, crypto };
