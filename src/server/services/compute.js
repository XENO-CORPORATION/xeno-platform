/**
 * XENO Compute (codename Machina) — the platform half. One service: the Compute screens, /api/compute and the agent
 * tools (computeMcp.js) all call these functions. Spec: xeno-compute/SPEC.md §2a and §6.
 *
 * Owner, 2026-10-26: "yes we'll lock this in" (XENO Compute, unit = machine) and "Two pools (Recommended)": credits pay
 * for what you USE — AI and machine time — from the SAME weekly allowance lot and wallet (quotaService.js, pricing
 * ledger §8b). There is no third compute balance.
 *
 * WHO MAY DO WHAT, in the machine's workspace:
 *   viewer   reads machines, their cost and the usage breakdown
 *   editor   creates, starts, stops and deletes machines
 *   admin    (a PERSON) sets caps. Rates are set by platform staff (the owner's prices; pricing ledger §6).
 * An agent acts for its owner and never above them: it may run machines in its owner's workspace, attributed to itself,
 * and it can never set a cap or a price (§8b D7: caps are user-set).
 *
 * MONEY:
 *   * a size with no rate cannot start — prices are the owner's decision and ship unset (refuses `no_price`)
 *   * running time is billed in SEGMENTS: an hour is held on the payer's account when a segment opens and settled for
 *     the seconds actually used when it closes (stop, or the hourly roll in meterRunningMachines). The rate is pinned
 *     per session, so a price change never re-prices time already running.
 *   * the payer is resolveBillingAccountId: a pooled workspace's wallet, else the person (an agent's owner) who started it
 *   * caps (workspace / division / agent) refuse a new start or a bigger size; they never stop running work silently.
 *     A running machine whose next hour cannot be funded (cap reached or wallet empty) keeps running, is flagged
 *     `unfunded`, and after UNFUNDED_GRACE_SECONDS is stopped with the reason on its timeline. Its disk is kept.
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { resolveBillingAccountId } from './walletService.js';
import { holdV2, settleHoldV2, voidHoldV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { ensureQuota } from './quotaService.js';
import { getEffectivePlan } from './effectivePlan.js';
import { computeBackend } from './computeBackend.js';

export class ComputeError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'ComputeError'; this.code = code; this.statusCode = status; }
}

export const SURFACE = 'xeno_compute';
export const SEGMENT_SECONDS = 3600;
export const UNFUNDED_GRACE_SECONDS = 900;
export const IDLE_DEFAULT_MINUTES = 30;
function idleMinutes(v) {
  if (v === null || v === 'never' || v === 0) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 5 || n > 1440) throw new ComputeError('idleStopMinutes must be 5..1440, or null to never stop for idleness', 'invalid_idle');
  return n;
}
/** Mark a machine as in use until at least `untilMs` (a running command keeps it busy until its deadline). */
async function touch(db, machineId, untilMs = Date.now()) {
  await db.query('UPDATE compute_machines SET last_active_at = GREATEST(COALESCE(last_active_at, to_timestamp(0)), to_timestamp($2 / 1000.0)) WHERE id = $1', [machineId, untilMs]);
}
export const STATES = ['creating', 'running', 'stopped', 'deleted', 'failed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MACHINE_ID = /^mch_[0-9a-f]{32}$/;
const isAgent = (a) => a && a.kind === 'agent';
const newMachineId = () => `mch_${crypto.randomBytes(16).toString('hex')}`;
const credits = (micro) => Math.round(Number(micro || 0) / 10_000) / 100; // micro → credits, 2 decimals

/** Cost of `seconds` of running time at `ratePerHour` micro-credits, rounded UP to the micro-credit. */
export function costMicro(ratePerHour, seconds) {
  if (seconds <= 0) return 0;
  return Math.ceil((Number(ratePerHour) * seconds) / 3600);
}

// ─────────────────────────────────────────── who may do what, in which workspace
async function personOf(db, actor) {
  if (!actor || !actor.id) throw new ComputeError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'service') throw new ComputeError('A service account cannot run machines', 'not_allowed', 403);
  if (!isAgent(actor)) return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new ComputeError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the workspace (default: the person's Personal one) and check the person holds `need` there. */
export async function workspaceFor(db, actor, workspaceId, need = 'viewer') {
  const who = await personOf(db, actor);
  if (need === 'admin' && who.agentId) throw new ComputeError('Only a person can do that', 'human_only', 403);
  let ws = workspaceId ? String(workspaceId) : null;
  if (ws && !UUID.test(ws)) throw new ComputeError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const r = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!r.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new ComputeError('You are not a member of that workspace', 'not_a_member', 403);
    throw new ComputeError(need === 'admin' ? 'Only a workspace admin can do that' : 'Only editors and admins can do that', need === 'admin' ? 'admin_required' : 'editor_required', 403);
  }
  return { ...who, workspaceId: ws };
}

/** The agent a machine works for: the calling agent itself, or an agent the person names that their workspace owns. */
async function agentFor(db, ctx, agentId) {
  if (ctx.agentId) return ctx.agentId;
  if (!agentId) return null;
  const r = (await db.query(`SELECT ai.user_id, ai.owner_user_id, r.owner_workspace_id FROM agent_identities ai
      LEFT JOIN workforce_resources r ON r.id = ai.workforce_resource_id
     WHERE (ai.public_id = $1 OR ai.user_id::text = $1) AND ai.status <> 'retired'`, [String(agentId)])).rows[0];
  if (!r) throw new ComputeError('Agent not found', 'agent_not_found', 404);
  const ownsIt = String(r.owner_user_id) === ctx.userId || (r.owner_workspace_id && String(r.owner_workspace_id) === ctx.workspaceId);
  if (!ownsIt) throw new ComputeError('That agent does not belong to you or this workspace', 'agent_not_found', 404);
  return String(r.user_id);
}

async function divisionOf(db, agentUserId) {
  if (!agentUserId) return null;
  const r = (await db.query(`SELECT o.division_id FROM agent_identities ai
      JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id WHERE ai.user_id = $1`, [agentUserId])).rows[0];
  return r ? String(r.division_id) : null;
}

// ─────────────────────────────────────────── shapes
async function rates(db) {
  return (await db.query('SELECT size, rank, vcpus, memory_gb, disk_gb, rate_micro_per_hour FROM compute_rates ORDER BY rank')).rows;
}
const shapeSize = (r) => ({ size: r.size, vcpus: r.vcpus, memoryGb: r.memory_gb, diskGb: r.disk_gb,
  priced: r.rate_micro_per_hour != null, creditsPerHour: r.rate_micro_per_hour != null ? credits(r.rate_micro_per_hour) : null });

async function shapeMachine(db, m) {
  const s = (await db.query(`SELECT COALESCE(SUM(settled_micro),0)::bigint AS settled,
      MAX(CASE WHEN ended_at IS NULL THEN rate_micro_per_hour END) AS open_rate,
      MAX(CASE WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (now() - segment_started_at)) END) AS open_seconds
      FROM compute_sessions WHERE machine_id = $1`, [m.id])).rows[0];
  const running = s.open_rate ? costMicro(s.open_rate, Math.floor(Number(s.open_seconds))) : 0;
  const agent = m.agent_user_id ? (await db.query('SELECT ai.public_id, COALESCE(u.display_name, u.username) AS name FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.user_id = $1', [m.agent_user_id])).rows[0] : null;
  return {
    id: m.id, workspaceId: String(m.workspace_id), name: m.name, size: m.size, purpose: m.purpose, image: m.image,
    state: m.state, failure: m.failure || null, unfundedSince: m.unfunded_since || null,
    idleStopMinutes: m.idle_stop_minutes ?? null, lastActiveAt: m.last_active_at || null,
    agent: agent ? { id: agent.public_id, name: agent.name } : null,
    costSoFarCredits: credits(Number(s.settled) + running),
    createdAt: m.created_at, updatedAt: m.updated_at, deletedAt: m.deleted_at,
    url: `/workspace/dev/spaces/compute/machines/${m.id}`,   // Dev › Compute: id-based, parent in path
  };
}

async function event(db, machineId, kind, actorUserId, detail = {}) {
  await db.query('INSERT INTO compute_events (machine_id, kind, actor_user_id, detail) VALUES ($1,$2,$3,$4::jsonb)',
    [machineId, kind, actorUserId || null, JSON.stringify(detail)]);
}

async function machineRow(db, ctx, machineId) {
  if (!MACHINE_ID.test(String(machineId || ''))) throw new ComputeError('Invalid machine id', 'invalid_machine');
  const m = (await db.query('SELECT * FROM compute_machines WHERE id = $1 AND workspace_id = $2', [machineId, ctx.workspaceId])).rows[0];
  if (!m) throw new ComputeError('Machine not found', 'machine_not_found', 404);
  return m;
}

/** Find the machine's workspace first, so a caller can address a machine by id alone. */
async function ctxForMachine(db, actor, machineId, need, workspace) {
  if (!workspace && MACHINE_ID.test(String(machineId || ''))) {
    const r = (await db.query('SELECT workspace_id FROM compute_machines WHERE id = $1', [machineId])).rows[0];
    if (r) workspace = String(r.workspace_id);
  }
  if (!workspace) throw new ComputeError('Machine not found', 'machine_not_found', 404);
  const ctx = await workspaceFor(db, actor, workspace, need);
  return { ctx, m: await machineRow(db, ctx, machineId) };
}

// ─────────────────────────────────────────── caps
async function capsFor(db, workspaceId, agentUserId) {
  const division = await divisionOf(db, agentUserId);
  const rows = (await db.query(`SELECT * FROM compute_caps WHERE workspace_id = $1 AND (
      (scope_kind = 'workspace') OR (scope_kind = 'division' AND scope_id = $2) OR (scope_kind = 'agent' AND scope_id = $3))`,
  [workspaceId, division || '', agentUserId || ''])).rows;
  return { rows, division };
}

/** Machines that are not deleted, in a cap's scope. */
async function machinesInScope(db, cap, workspaceId) {
  if (cap.scope_kind === 'workspace') return Number((await db.query("SELECT count(*) FROM compute_machines WHERE workspace_id = $1 AND state <> 'deleted'", [workspaceId])).rows[0].count);
  if (cap.scope_kind === 'agent') return Number((await db.query("SELECT count(*) FROM compute_machines WHERE workspace_id = $1 AND agent_user_id = $2 AND state <> 'deleted'", [workspaceId, cap.scope_id])).rows[0].count);
  return Number((await db.query(`SELECT count(*) FROM compute_machines m JOIN agent_identities ai ON ai.user_id = m.agent_user_id
      JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id
     WHERE m.workspace_id = $1 AND o.division_id::text = $2 AND m.state <> 'deleted'`, [workspaceId, cap.scope_id])).rows[0].count);
}

/** Credits committed this calendar month (UTC) in a cap's scope: settled time + the open hours still held. */
async function monthSpendInScope(db, cap, workspaceId) {
  const scope = cap.scope_kind === 'workspace' ? 'TRUE'
    : cap.scope_kind === 'agent' ? 'm.agent_user_id::text = $2'
      : `EXISTS (SELECT 1 FROM agent_identities ai JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id
                 WHERE ai.user_id = m.agent_user_id AND o.division_id::text = $2)`;
  const r = (await db.query(`SELECT COALESCE(SUM(s.settled_micro + CASE WHEN s.ended_at IS NULL AND s.hold_id IS NOT NULL
        THEN s.rate_micro_per_hour * ${SEGMENT_SECONDS} / 3600 ELSE 0 END), 0)::bigint AS micro
      FROM compute_sessions s JOIN compute_machines m ON m.id = s.machine_id
     WHERE m.workspace_id = $1 AND ${scope} AND s.started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       ${cap.scope_kind === 'workspace' ? 'AND $2::text IS NOT NULL' : ''}`, [workspaceId, cap.scope_id])).rows[0];
  return BigInt(r.micro);
}

const scopeLabel = (cap) => (cap.scope_kind === 'workspace' ? 'this workspace' : cap.scope_kind === 'division' ? 'this division' : 'this agent');

async function assertCaps(db, { workspaceId, agentUserId, size, sizeRank, newMachine, addMicro }) {
  const { rows } = await capsFor(db, workspaceId, agentUserId);
  const ranks = Object.fromEntries((await rates(db)).map((r) => [r.size, r.rank]));
  for (const cap of rows) {
    if (newMachine && cap.max_machines != null && (await machinesInScope(db, cap, workspaceId)) + 1 > cap.max_machines) {
      throw new ComputeError(`The machine limit for ${scopeLabel(cap)} is ${cap.max_machines}`, 'cap_max_machines', 409);
    }
    if (cap.max_size && sizeRank > ranks[cap.max_size]) {
      throw new ComputeError(`The largest size allowed for ${scopeLabel(cap)} is ${cap.max_size}, not ${size}`, 'cap_max_size', 409);
    }
    if (addMicro != null && cap.monthly_credit_cap_micro != null
      && (await monthSpendInScope(db, cap, workspaceId)) + BigInt(addMicro) > BigInt(cap.monthly_credit_cap_micro)) {
      throw new ComputeError(`The monthly machine budget for ${scopeLabel(cap)} is used up`, 'cap_monthly_credits', 409);
    }
  }
}

// ─────────────────────────────────────────── reads
export async function sizes(db, actor) {
  await personOf(db, actor);
  return (await rates(db)).map(shapeSize);
}

export async function listMachines(db, actor, { workspace, state, agentId, includeDeleted = false } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const args = [ctx.workspaceId], where = ['workspace_id = $1'];
  if (!includeDeleted) where.push("state <> 'deleted'");
  if (state) { if (!STATES.includes(state)) throw new ComputeError('Unknown state', 'invalid_state'); args.push(state); where.push(`state = $${args.length}`); }
  if (agentId) { const a = await agentFor(db, { ...ctx, agentId: null }, agentId); args.push(a); where.push(`agent_user_id = $${args.length}`); }
  const rows = (await db.query(`SELECT * FROM compute_machines WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`, args)).rows;
  return Promise.all(rows.map((m) => shapeMachine(db, m)));
}

export async function getMachine(db, actor, machineId, { workspace } = {}) {
  const { m } = await ctxForMachine(db, actor, machineId, 'viewer', workspace);
  const machine = await shapeMachine(db, m);
  machine.events = (await db.query('SELECT kind, detail, created_at, actor_user_id FROM compute_events WHERE machine_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [m.id])).rows
    .map((e) => ({ kind: e.kind, detail: e.detail, at: e.created_at }));
  return machine;
}

// ─────────────────────────────────────────── create / start / stop / delete
export async function createMachine(db, actor, { workspace, name, size, purpose, image, agentId, idempotencyKey, idleStopMinutes } = {}) {
  const idle = idleStopMinutes === undefined ? IDLE_DEFAULT_MINUTES : idleMinutes(idleStopMinutes);
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const label = String(name ?? '').trim().slice(0, 80) || 'Machine';
  const r = (await db.query('SELECT * FROM compute_rates WHERE size = $1', [String(size || '')])).rows[0];
  if (!r) throw new ComputeError(`Unknown size "${size}"`, 'invalid_size');
  if (idempotencyKey) {
    const prior = (await db.query('SELECT * FROM compute_machines WHERE workspace_id = $1 AND idempotency_key = $2', [ctx.workspaceId, String(idempotencyKey)])).rows[0];
    if (prior) return shapeMachine(db, prior);
  }
  const agentUserId = await agentFor(db, ctx, agentId);
  await assertCaps(db, { workspaceId: ctx.workspaceId, agentUserId, size: r.size, sizeRank: r.rank, newMachine: true, addMicro: null });
  const id = newMachineId();
  const m = (await db.query(`INSERT INTO compute_machines (id, workspace_id, created_by_user_id, agent_user_id, name, size, purpose, image, idempotency_key, idle_stop_minutes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [id, ctx.workspaceId, ctx.userId, agentUserId, label, r.size, purpose ? String(purpose).slice(0, 500) : null, image ? String(image).slice(0, 200) : null, idempotencyKey ? String(idempotencyKey) : null, idle])).rows[0];
  await event(db, id, 'created', ctx.userId, { size: r.size, agent: !!agentUserId });
  try {
    const out = await computeBackend().create({ id, workspaceId: ctx.workspaceId, size: r.size, image: m.image });
    const done = (await db.query("UPDATE compute_machines SET state = 'stopped', backend_ref = $2 WHERE id = $1 RETURNING *", [id, out?.ref || id])).rows[0];
    return shapeMachine(db, done);
  } catch (e) {
    const failed = (await db.query("UPDATE compute_machines SET state = 'failed', failure = $2 WHERE id = $1 RETURNING *", [id, String(e.message).slice(0, 300)])).rows[0];
    await event(db, id, 'failed', ctx.userId, { stage: 'create', code: e.code || null, reason: String(e.message).slice(0, 300) });
    if (e.code === 'compute_unavailable') throw new ComputeError(e.message, 'compute_unavailable', 503);
    return shapeMachine(db, failed);
  }
}

/** Reserve the next hour of running time on the payer's account. Throws a ComputeError when it cannot be funded. */
async function holdSegment(db, payerId, session, machineId) {
  const holdId = `cmp:${machineId}:${session.id}:${session.segment_seq}`;
  try {
    await holdV2(db, payerId, { holdId, surface: SURFACE, operation: 'machine.run', amountMicro: costMicro(session.rate_micro_per_hour, SEGMENT_SECONDS), expiresInSeconds: SEGMENT_SECONDS * 2 });
    return holdId;
  } catch (e) {
    if (e.code === 'INSUFFICIENT_CREDITS') throw new ComputeError('Not enough credits to run this machine for the next hour', 'insufficient_credits', 402);
    if (e.code === 'SPEND_CAP_EXCEEDED') throw new ComputeError('Your spend limit does not leave room for the next hour', 'spend_cap', 402);
    if (e.code === 'QUOTA_EXCEEDED') throw new ComputeError('The weekly allowance is used up and paying with credits is not switched on', 'allowance_used', 402);
    throw e;
  }
}

/** Close the session's current hold for the seconds actually used. Returns the micro-credits charged. */
async function settleSegment(db, session, machine, untilMs = Date.now()) {
  if (!session.hold_id) return 0;
  const seconds = Math.max(0, Math.floor((untilMs - new Date(session.segment_started_at).getTime()) / 1000));
  const charge = costMicro(session.rate_micro_per_hour, Math.min(seconds, SEGMENT_SECONDS * 2));
  if (charge > 0) {
    await settleHoldV2(db, session.payer_id, session.hold_id, charge, {
      model: machine.size, provider: 'xeno-compute',
      dimensions: { machine_id: machine.id, workspace_id: String(machine.workspace_id), ...(machine.agent_user_id ? { agent_user_id: String(machine.agent_user_id) } : {}), seconds },
    });
  } else {
    await voidHoldV2(db, session.payer_id, session.hold_id);
  }
  await db.query('UPDATE compute_sessions SET settled_micro = settled_micro + $2, hold_id = NULL WHERE id = $1', [session.id, charge]);
  return charge;
}

export async function startMachine(db, actor, machineId, { workspace } = {}) {
  const { ctx, m } = await ctxForMachine(db, actor, machineId, 'editor', workspace);
  if (ctx.agentId && m.agent_user_id && String(m.agent_user_id) !== ctx.agentId) throw new ComputeError('That machine works for another agent', 'not_your_machine', 403);
  if (m.state === 'running') return shapeMachine(db, m); // idempotent
  if (m.state !== 'stopped') throw new ComputeError(`A ${m.state} machine cannot start`, 'invalid_state', 409);
  const r = (await db.query('SELECT * FROM compute_rates WHERE size = $1', [m.size])).rows[0];
  if (r.rate_micro_per_hour == null) throw new ComputeError(`XENO Compute has no price for the ${m.size} size yet, so it cannot run`, 'no_price', 409);
  const firstHour = costMicro(r.rate_micro_per_hour, SEGMENT_SECONDS);
  await assertCaps(db, { workspaceId: m.workspace_id, agentUserId: m.agent_user_id, size: m.size, sizeRank: r.rank, newMachine: false, addMicro: firstHour });

  const payer = await resolveBillingAccountId(db, ctx.userId, String(m.workspace_id));
  if (payer.kind === 'user') await ensureQuota(db, ctx.userId, (await getEffectivePlan(db, ctx.userId)).plan);
  const session = (await db.query(`INSERT INTO compute_sessions (machine_id, payer_id, started_by_user_id, rate_micro_per_hour)
      VALUES ($1,$2,$3,$4) RETURNING *`, [m.id, payer.id, ctx.userId, r.rate_micro_per_hour])).rows[0];
  let holdId;
  try {
    holdId = await holdSegment(db, payer.id, session, m.id);
  } catch (e) {
    await db.query('DELETE FROM compute_sessions WHERE id = $1', [session.id]);
    throw e;
  }
  await db.query('UPDATE compute_sessions SET hold_id = $2, segment_started_at = now() WHERE id = $1', [session.id, holdId]);
  try {
    await computeBackend().start({ id: m.id, ref: m.backend_ref });
  } catch (e) {
    await voidHoldV2(db, payer.id, holdId).catch(() => {});
    await db.query('DELETE FROM compute_sessions WHERE id = $1', [session.id]);
    await event(db, m.id, 'failed', ctx.userId, { stage: 'start', code: e.code || null, reason: String(e.message).slice(0, 300) });
    throw new ComputeError(e.message, e.code === 'compute_unavailable' ? 'compute_unavailable' : 'start_failed', e.code === 'compute_unavailable' ? 503 : 502);
  }
  const running = (await db.query("UPDATE compute_machines SET state = 'running', unfunded_since = NULL, last_active_at = now() WHERE id = $1 RETURNING *", [m.id])).rows[0];
  await event(db, m.id, 'started', ctx.userId, { payer: payer.kind, creditsPerHour: credits(r.rate_micro_per_hour) });
  return shapeMachine(db, running);
}

/** Stop a running machine: settle the time used, then tell xeno-compute. Shared by people, agents and the meter. */
async function stopRow(db, m, actorUserId, reason) {
  const session = (await db.query('SELECT * FROM compute_sessions WHERE machine_id = $1 AND ended_at IS NULL FOR UPDATE', [m.id])).rows[0];
  await computeBackend().stop({ id: m.id, ref: m.backend_ref });
  let charged = 0;
  if (session) {
    charged = await settleSegment(db, session, m);
    await db.query('UPDATE compute_sessions SET ended_at = now() WHERE id = $1', [session.id]);
  }
  const stopped = (await db.query("UPDATE compute_machines SET state = 'stopped', unfunded_since = NULL WHERE id = $1 RETURNING *", [m.id])).rows[0];
  await event(db, m.id, 'stopped', actorUserId, { reason, charged: credits(charged) });
  return stopped;
}

export async function stopMachine(db, actor, machineId, { workspace } = {}) {
  const { ctx, m } = await ctxForMachine(db, actor, machineId, 'editor', workspace);
  if (ctx.agentId && m.agent_user_id && String(m.agent_user_id) !== ctx.agentId) throw new ComputeError('That machine works for another agent', 'not_your_machine', 403);
  if (m.state === 'stopped') return shapeMachine(db, m);
  if (m.state !== 'running') throw new ComputeError(`A ${m.state} machine cannot stop`, 'invalid_state', 409);
  try {
    return shapeMachine(db, await stopRow(db, m, ctx.userId, 'requested'));
  } catch (e) {
    if (e.code === 'compute_unavailable') throw new ComputeError(e.message, 'compute_unavailable', 503);
    throw e;
  }
}

/** Change how long a machine may sit unused before it stops itself (null = never). Anyone who may stop it may set it. */
export async function setIdleStop(db, actor, machineId, { idleStopMinutes, workspace } = {}) {
  const { ctx, m } = await ctxForMachine(db, actor, machineId, 'editor', workspace);
  if (ctx.agentId && m.agent_user_id && String(m.agent_user_id) !== ctx.agentId) throw new ComputeError('That machine works for another agent', 'not_your_machine', 403);
  if (m.state === 'deleted') throw new ComputeError('A deleted machine cannot change', 'invalid_state', 409);
  if (idleStopMinutes === undefined) throw new ComputeError('idleStopMinutes is required (5..1440, or null for never)', 'invalid_idle');
  const idle = idleMinutes(idleStopMinutes);
  const out = (await db.query('UPDATE compute_machines SET idle_stop_minutes = $2 WHERE id = $1 RETURNING *', [m.id, idle])).rows[0];
  await event(db, m.id, 'idle_stop_set', ctx.userId, { minutes: idle });
  return shapeMachine(db, out);
}

export async function deleteMachine(db, actor, machineId, { workspace } = {}) {
  const { ctx, m } = await ctxForMachine(db, actor, machineId, 'editor', workspace);
  if (ctx.agentId && m.agent_user_id && String(m.agent_user_id) !== ctx.agentId) throw new ComputeError('That machine works for another agent', 'not_your_machine', 403);
  if (m.state === 'deleted') return shapeMachine(db, m);
  if (m.state === 'running') throw new ComputeError('Stop the machine before deleting it', 'still_running', 409);
  if (m.state === 'creating') throw new ComputeError('The machine is still being created', 'invalid_state', 409);
  if (m.state !== 'failed' || m.backend_ref) {
    try { await computeBackend().remove({ id: m.id, ref: m.backend_ref }); } catch (e) {
      if (e.code === 'compute_unavailable') throw new ComputeError(e.message, 'compute_unavailable', 503);
      throw e;
    }
  }
  const done = (await db.query("UPDATE compute_machines SET state = 'deleted', deleted_at = now() WHERE id = $1 RETURNING *", [m.id])).rows[0];
  await event(db, m.id, 'deleted', ctx.userId, {});
  return shapeMachine(db, done);
}

// ─────────────────────────────────────────── the meter (worker)
/**
 * Roll every running machine's billing forward. Called on an interval by workers/computeMeter.js (leader only).
 * A segment older than an hour is settled and the next hour is reserved. If the next hour cannot be reserved (a cap,
 * an empty wallet, an allowance with paid credits off) the machine KEEPS RUNNING, is flagged unfunded with an event,
 * and is stopped only after UNFUNDED_GRACE_SECONDS — with that reason on its timeline. Its disk is kept.
 */
export async function meterRunningMachines(db, { now = Date.now() } = {}) {
  const open = (await db.query(`SELECT s.*, m.size, m.workspace_id, m.agent_user_id, m.backend_ref, m.unfunded_since, m.state,
      m.idle_stop_minutes, m.last_active_at
      FROM compute_sessions s JOIN compute_machines m ON m.id = s.machine_id WHERE s.ended_at IS NULL AND m.state = 'running'`)).rows;
  const out = { rolled: 0, unfunded: 0, stopped: 0, idle: 0 };
  for (const s of open) {
    const m = { id: s.machine_id, size: s.size, workspace_id: s.workspace_id, agent_user_id: s.agent_user_id, backend_ref: s.backend_ref };
    const age = (now - new Date(s.segment_started_at).getTime()) / 1000;
    // Nobody used it for its idle limit: stop it, so a forgotten machine does not keep billing.
    const lastUse = new Date(s.last_active_at || s.started_at).getTime();
    if (s.idle_stop_minutes != null && now - lastUse >= s.idle_stop_minutes * 60_000) {
      await stopRow(db, { ...m, workspace_id: s.workspace_id }, null, 'idle');
      out.idle++;
      continue;
    }
    if (s.unfunded_since && (now - new Date(s.unfunded_since).getTime()) / 1000 >= UNFUNDED_GRACE_SECONDS) {
      await stopRow(db, { ...m, workspace_id: s.workspace_id }, null, 'unfunded');
      out.stopped++;
      continue;
    }
    if (s.hold_id && age < SEGMENT_SECONDS) continue;
    if (s.hold_id) {
      await settleSegment(db, s, m, now);
      out.rolled++;
    }
    const next = { ...s, segment_seq: s.segment_seq + 1 };
    try {
      const r = (await db.query('SELECT rank FROM compute_rates WHERE size = $1', [s.size])).rows[0];
      await assertCaps(db, { workspaceId: s.workspace_id, agentUserId: s.agent_user_id, size: s.size, sizeRank: r.rank, newMachine: false, addMicro: costMicro(s.rate_micro_per_hour, SEGMENT_SECONDS) });
      const holdId = await holdSegment(db, s.payer_id, next, s.machine_id);
      await db.query('UPDATE compute_sessions SET hold_id = $2, segment_seq = $3, segment_started_at = to_timestamp($4 / 1000.0) WHERE id = $1', [s.id, holdId, next.segment_seq, now]);
      if (s.unfunded_since) {
        await db.query('UPDATE compute_machines SET unfunded_since = NULL WHERE id = $1', [s.machine_id]);
        await event(db, s.machine_id, 'funded', null, {});
      }
    } catch (e) {
      if (!(e instanceof ComputeError)) throw e;
      // Keep running; say so. The time while unfunded is not billed (there is nothing reserved to bill it against).
      await db.query('UPDATE compute_sessions SET segment_started_at = to_timestamp($2 / 1000.0), segment_seq = $3 WHERE id = $1', [s.id, now, next.segment_seq]);
      if (!s.unfunded_since) {
        await db.query('UPDATE compute_machines SET unfunded_since = to_timestamp($2 / 1000.0) WHERE id = $1', [s.machine_id, now]);
        await event(db, s.machine_id, e.code.startsWith('cap_') ? 'capped' : 'unfunded', null, { code: e.code, reason: e.message, stopsInSeconds: UNFUNDED_GRACE_SECONDS });
        out.unfunded++;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────── usage + caps
/** Machine time in a workspace for a period: totals, by machine and by agent; and the AI-vs-machines split. */
export async function usage(db, actor, { workspace, from, to } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const start = from ? new Date(from) : new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z');
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new ComputeError('Invalid period', 'invalid_period');
  const byMachine = (await db.query(`SELECT m.id, m.name, m.size, m.agent_user_id, COALESCE(SUM(s.settled_micro),0)::bigint AS micro,
        COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at))),0) AS seconds
      FROM compute_machines m JOIN compute_sessions s ON s.machine_id = m.id
     WHERE m.workspace_id = $1 AND s.started_at < $3 AND COALESCE(s.ended_at, now()) >= $2
     GROUP BY m.id ORDER BY micro DESC`, [ctx.workspaceId, start, end])).rows;
  const byAgent = {};
  for (const r of byMachine) {
    const k = r.agent_user_id ? String(r.agent_user_id) : 'people';
    byAgent[k] = (byAgent[k] || 0) + Number(r.micro);
  }
  const agentNames = Object.keys(byAgent).filter((k) => k !== 'people');
  const names = agentNames.length ? Object.fromEntries((await db.query('SELECT ai.user_id, ai.public_id, COALESCE(u.display_name, u.username) AS name FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.user_id = ANY($1::uuid[])', [agentNames])).rows.map((r) => [String(r.user_id), r])) : {};
  return {
    workspaceId: ctx.workspaceId, from: start.toISOString(), to: end.toISOString(),
    machineCredits: credits(byMachine.reduce((a, r) => a + Number(r.micro), 0)),
    byMachine: byMachine.map((r) => ({ id: r.id, name: r.name, size: r.size, credits: credits(r.micro), hours: Math.round(Number(r.seconds) / 36) / 100 })),
    byAgent: Object.entries(byAgent).map(([k, v]) => ({ agent: k === 'people' ? null : { id: names[k]?.public_id || null, name: names[k]?.name || 'Agent' }, credits: credits(v) })),
  };
}

/**
 * The two halves of what a person USED, from the one ledger: AI requests and machine time. Read from api_usage_logs
 * by surface, so it is the same number the wallet was charged — never a second meter. Feeds the quota view.
 */
export async function aiVsMachines(db, userId, { from } = {}) {
  const start = from ? new Date(from) : new Date(Date.now() - 7 * 86400_000);
  const r = (await db.query(`SELECT (surface = $3) AS machines, COALESCE(SUM(actual_cost_micro),0)::bigint AS micro
      FROM api_usage_logs WHERE user_id = $1 AND created_at >= $2 GROUP BY 1`, [userId, start, SURFACE])).rows;
  const get = (b) => credits((r.find((x) => x.machines === b) || {}).micro || 0);
  return { from: start.toISOString(), aiCredits: get(false), machineCredits: get(true) };
}

export async function listCaps(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  return (await db.query('SELECT * FROM compute_caps WHERE workspace_id = $1 ORDER BY scope_kind, scope_id', [ctx.workspaceId])).rows.map((c) => ({
    scope: c.scope_kind, scopeId: c.scope_id, maxMachines: c.max_machines, maxSize: c.max_size,
    monthlyCredits: c.monthly_credit_cap_micro != null ? credits(c.monthly_credit_cap_micro) : null, updatedAt: c.updated_at,
  }));
}

/** budget.set — a PERSON who is a workspace admin sets a cap. `null` removes a limit; all three null removes the cap. */
export async function setCap(db, actor, { workspace, scope = 'workspace', scopeId, maxMachines = null, maxSize = null, monthlyCredits = null } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  if (!['workspace', 'division', 'agent'].includes(scope)) throw new ComputeError('scope is workspace, division or agent', 'invalid_scope');
  let id = ctx.workspaceId;
  if (scope === 'agent') id = await agentFor(db, { ...ctx, agentId: null }, scopeId);
  if (scope === 'division') {
    const d = (await db.query('SELECT id FROM workforce_divisions WHERE id::text = $1 AND workspace_id = $2', [String(scopeId || ''), ctx.workspaceId])).rows[0];
    if (!d) throw new ComputeError('Division not found in this workspace', 'division_not_found', 404);
    id = String(d.id);
  }
  if (maxMachines != null && !(Number.isInteger(maxMachines) && maxMachines >= 0)) throw new ComputeError('maxMachines is a whole number', 'invalid_cap');
  if (maxSize != null && !(await db.query('SELECT 1 FROM compute_rates WHERE size = $1', [maxSize])).rows[0]) throw new ComputeError(`Unknown size "${maxSize}"`, 'invalid_size');
  if (monthlyCredits != null && !(Number(monthlyCredits) >= 0)) throw new ComputeError('monthlyCredits is a number of credits, 0 or more', 'invalid_cap');
  if (maxMachines == null && maxSize == null && monthlyCredits == null) {
    await db.query('DELETE FROM compute_caps WHERE workspace_id = $1 AND scope_kind = $2 AND scope_id = $3', [ctx.workspaceId, scope, id]);
    return listCaps(db, actor, { workspace: ctx.workspaceId });
  }
  await db.query(`INSERT INTO compute_caps (workspace_id, scope_kind, scope_id, max_machines, max_size, monthly_credit_cap_micro, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (workspace_id, scope_kind, scope_id) DO UPDATE SET max_machines = EXCLUDED.max_machines, max_size = EXCLUDED.max_size,
        monthly_credit_cap_micro = EXCLUDED.monthly_credit_cap_micro, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [ctx.workspaceId, scope, id, maxMachines, maxSize, monthlyCredits == null ? null : Math.round(Number(monthlyCredits) * MICRO_PER_CREDIT), ctx.userId]);
  return listCaps(db, actor, { workspace: ctx.workspaceId });
}

/** Platform staff (a human admin) set a size's price — the owner's decision, entered as data. `null` unprices it. */
// ─────────────────────────────────────────── commands and files on a running machine
// The machine is the wall between customers (owner, 2026-10-27), so a command runs directly on it; XENO Box is added
// on the machine only when a workload needs it. Who may reach a machine is decided here: an editor of its workspace,
// and an agent only on a machine that works for it. The machine must be RUNNING, i.e. billed.
const EXEC_MAX_TIMEOUT_MS = 30 * 60_000;
const EXEC_MAX_OUTPUT = 1024 * 1024;     // per stream, for the buffered call
const FILE_MAX_BYTES = 25 * 1024 * 1024; // through the platform; bigger files belong in XENO Storage

async function runningMachineFor(db, actor, machineId, workspace) {
  const { ctx, m } = await ctxForMachine(db, actor, machineId, 'editor', workspace);
  if (ctx.agentId && m.agent_user_id && String(m.agent_user_id) !== ctx.agentId) throw new ComputeError('That machine works for another agent', 'not_your_machine', 403);
  if (m.state !== 'running') throw new ComputeError('Start the machine first', 'machine_not_running', 409);
  return { ctx, m };
}

export function execRequest({ argv, cwd, stdin, env, timeoutMs } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) throw new ComputeError('argv must be a non-empty list of strings (a program and its arguments, not a shell line)', 'invalid_argv');
  const t = Number(timeoutMs ?? 60_000);
  if (!(t > 0 && t <= EXEC_MAX_TIMEOUT_MS)) throw new ComputeError(`timeoutMs must be 1..${EXEC_MAX_TIMEOUT_MS}`, 'invalid_timeout');
  if (env != null && (typeof env !== 'object' || Object.values(env).some((v) => typeof v !== 'string'))) throw new ComputeError('env must map names to strings', 'invalid_env');
  return { argv, cwd: cwd ? String(cwd) : undefined, env: env || undefined, timeoutMs: t,
    stdin: stdin == null ? undefined : Buffer.from(String(stdin), 'utf8').toString('base64') };
}

/** Run a command and return the machine's NDJSON stream (for the streaming route). */
export async function execMachineStream(db, actor, machineId, input = {}) {
  const req = execRequest(input);
  const { m } = await runningMachineFor(db, actor, machineId, input.workspace);
  await touch(db, m.id, Date.now() + req.timeoutMs); // busy until the command's deadline at the latest
  try { return await computeBackend().exec({ id: m.id, ref: m.backend_ref }, req); }
  catch (e) { throw new ComputeError(e.message, e.code === 'compute_unavailable' ? 'compute_unavailable' : (e.code || 'exec_failed'), e.statusCode || 502); }
}

/** Run a command to completion: exit code plus stdout/stderr as text (each capped at 1 MB). */
export async function execMachine(db, actor, machineId, input = {}) {
  const res = await execMachineStream(db, actor, machineId, input);
  const out = { stdout: [], stderr: [] }; const size = { stdout: 0, stderr: 0 };
  let truncated = false; let done = null; let rest = '';
  const take = (line) => {
    if (!line.trim()) return;
    const o = JSON.parse(line);
    if (o.done) { done = o; return; }
    const b = Buffer.from(o.data, 'base64');
    if (size[o.stream] + b.length > EXEC_MAX_OUTPUT) { truncated = true; return; }
    out[o.stream].push(b); size[o.stream] += b.length;
  };
  for await (const chunk of res.body) {
    rest += Buffer.from(chunk).toString('utf8');
    const lines = rest.split('\n'); rest = lines.pop();
    lines.forEach(take);
  }
  take(rest);
  if (!done) throw new ComputeError('The machine stopped answering before the command finished', 'exec_interrupted', 502);
  // Decode once at the end: a UTF-8 character can be split across two chunks.
  return { exitCode: done.exitCode, signal: done.signal || null, timedOut: !!done.timedOut, truncated,
    stdout: Buffer.concat(out.stdout).toString('utf8'), stderr: Buffer.concat(out.stderr).toString('utf8'),
    ...(done.error ? { error: done.error } : {}) };
}

export async function readMachineFile(db, actor, machineId, { path, workspace } = {}) {
  if (!path || typeof path !== 'string') throw new ComputeError('path is required', 'invalid_path');
  const { m } = await runningMachineFor(db, actor, machineId, workspace);
  await touch(db, m.id);
  const buf = await computeBackend().readFile({ id: m.id, ref: m.backend_ref }, path).catch((e) => { throw new ComputeError(e.message, e.code || 'read_failed', e.statusCode || 502); });
  if (buf.length > FILE_MAX_BYTES) throw new ComputeError('File too large to read through XENO; move it with XENO Storage', 'too_large', 413);
  return buf;
}

export async function writeMachineFile(db, actor, machineId, { path, content, workspace } = {}) {
  if (!path || typeof path !== 'string') throw new ComputeError('path is required', 'invalid_path');
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
  if (buf.length > FILE_MAX_BYTES) throw new ComputeError('File too large to write through XENO; move it with XENO Storage', 'too_large', 413);
  const { m } = await runningMachineFor(db, actor, machineId, workspace);
  await touch(db, m.id);
  const r = await computeBackend().writeFile({ id: m.id, ref: m.backend_ref }, path, buf).catch((e) => { throw new ComputeError(e.message, e.code || 'write_failed', e.statusCode || 502); });
  return { path: r.path || path, bytes: buf.length };
}

export async function setRate(db, actor, { size, creditsPerHour }) {
  if (!actor || actor.kind === 'agent' || actor.kind === 'service' || actor.role !== 'admin') throw new ComputeError('Only XENO staff set prices', 'staff_only', 403);
  const micro = creditsPerHour == null ? null : Math.round(Number(creditsPerHour) * MICRO_PER_CREDIT);
  if (micro != null && !(micro > 0)) throw new ComputeError('creditsPerHour must be more than 0', 'invalid_rate');
  const r = (await db.query('UPDATE compute_rates SET rate_micro_per_hour = $2, updated_by = $3, updated_at = now() WHERE size = $1 RETURNING *', [size, micro, actor.id])).rows[0];
  if (!r) throw new ComputeError(`Unknown size "${size}"`, 'invalid_size');
  return shapeSize(r);
}
