// RES-03: contributed compute is an UNTRUSTED worker unless separately
// qualified. Registration always lands untrusted; qualification requires
// recorded evidence plus a qualifier. Scheduling on an untrusted worker
// demands strong isolation, restricted-or-none egress, no local device
// access, donor-approved caps covering the task, and public inputs only --
// private inputs on untrusted hosts are refused by default. Every scheduled
// task gets a short-lived credential (max 900s TTL, stored as a hash, the
// token revealed once). A project cannot commandeer a donor machine: no
// approved caps, no schedule; caps the task exceeds, no schedule.
import { randomBytes, createHash } from 'node:crypto';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

export const MAX_TASK_CREDENTIAL_TTL_SECONDS = 900;

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

/** Register a contributed worker. Trust is ALWAYS untrusted at registration. */
export async function registerComputeWorker(poolOrClient, { actorUserId, isolation, egress, devices }) {
  const actor = uuid(actorUserId, 'actor');
  if (!['strong', 'weak', 'none'].includes(isolation)) bad('bad_input', 'invalid_isolation');
  if (!['none', 'restricted', 'open'].includes(egress)) bad('bad_input', 'invalid_egress');
  if (!['none', 'local'].includes(devices)) bad('bad_input', 'invalid_devices');
  return withTx(poolOrClient, async (client) => {
    const row = (await client.query(
      `INSERT INTO compute_workers(donor_user_id,isolation_class,egress_policy,device_access)
       VALUES($1,$2,$3,$4) RETURNING id, trust`,
      [actor, isolation, egress, devices],
    )).rows[0];
    return { workerId: row.id, trust: row.trust };
  });
}

/** Separate qualification: evidence plus a qualifier, or the worker stays untrusted. */
export async function qualifyComputeWorker(poolOrClient, { actorUserId, workerId, evidence }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(workerId, 'worker');
  if (!evidence || typeof evidence !== 'object') bad('bad_input', 'qualification_evidence_required');
  if (typeof evidence.method !== 'string' || !evidence.method.trim()) bad('bad_input', 'qualification_evidence_required');
  if (typeof evidence.reportHash !== 'string' || !/^[0-9a-f]{64}$/i.test(evidence.reportHash)) {
    bad('bad_input', 'qualification_evidence_required');
  }
  return withTx(poolOrClient, async (client) => {
    const worker = (await client.query('SELECT id, trust FROM compute_workers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!worker) bad('not_found', 'worker_not_found');
    if (worker.trust === 'qualified') bad('conflict', 'worker_already_qualified');
    await client.query(
      `UPDATE compute_workers SET trust='qualified', qualification_evidence=$2, qualified_by_user_id=$3, qualified_at=now() WHERE id=$1`,
      [id, JSON.stringify({ method: evidence.method.trim(), reportHash: evidence.reportHash.toLowerCase() }), actor],
    );
    return { workerId: id, trust: 'qualified' };
  });
}

/** The donor explicitly approves caps. Only the donor; only their worker. */
export async function approveWorkerCaps(poolOrClient, { actorUserId, workerId, caps }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(workerId, 'worker');
  if (!caps || typeof caps !== 'object') bad('bad_input', 'caps_required');
  for (const field of ['maxCpuMillicores', 'maxMemoryMb', 'maxSeconds']) {
    if (!Number.isInteger(caps[field]) || caps[field] <= 0) bad('bad_input', 'caps_required');
  }
  return withTx(poolOrClient, async (client) => {
    const worker = (await client.query('SELECT id, donor_user_id FROM compute_workers WHERE id=$1', [id])).rows[0];
    if (!worker) bad('not_found', 'worker_not_found');
    if (worker.donor_user_id !== actor) bad('denied', 'caps_approval_not_authorized');
    await client.query(
      `INSERT INTO compute_worker_caps(worker_id,max_cpu_millicores,max_memory_mb,max_seconds,approved_by_user_id)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (worker_id) DO UPDATE SET max_cpu_millicores=$2, max_memory_mb=$3,
         max_seconds=$4, approved_by_user_id=$5, approved_at=now()`,
      [id, caps.maxCpuMillicores, caps.maxMemoryMb, caps.maxSeconds, actor],
    );
    return { workerId: id, caps: { maxCpuMillicores: caps.maxCpuMillicores,
      maxMemoryMb: caps.maxMemoryMb, maxSeconds: caps.maxSeconds }, approvedByUserId: actor };
  });
}

/**
 * Schedule a task. Untrusted workers: strong isolation, no open egress, no
 * local devices, donor-approved caps covering the request, public inputs.
 * Issues a short-lived token (revealed once; stored as a hash).
 */
export async function scheduleComputeTask(poolOrClient, { actorUserId, workerId, inputClassification, request, credentialTtlSeconds }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(workerId, 'worker');
  if (inputClassification !== 'public' && inputClassification !== 'private') bad('bad_input', 'invalid_classification');
  if (!request || typeof request !== 'object') bad('bad_input', 'request_required');
  for (const field of ['cpuMillicores', 'memoryMb', 'maxSeconds']) {
    if (!Number.isInteger(request[field]) || request[field] <= 0) bad('bad_input', 'request_required');
  }
  const ttl = credentialTtlSeconds == null ? MAX_TASK_CREDENTIAL_TTL_SECONDS : credentialTtlSeconds;
  if (!Number.isInteger(ttl) || ttl <= 0) bad('bad_input', 'invalid_ttl');
  if (ttl > MAX_TASK_CREDENTIAL_TTL_SECONDS) bad('bad_input', 'credential_ttl_exceeded');
  return withTx(poolOrClient, async (client) => {
    const worker = (await client.query('SELECT * FROM compute_workers WHERE id=$1', [id])).rows[0];
    if (!worker) bad('not_found', 'worker_not_found');
    if (worker.trust === 'untrusted') {
      if (inputClassification === 'private') bad('denied', 'private_inputs_require_qualified');
      if (worker.isolation_class !== 'strong') bad('denied', 'isolation_insufficient');
      if (worker.egress_policy === 'open') bad('denied', 'egress_unrestricted');
      if (worker.device_access !== 'none') bad('denied', 'device_access_forbidden');
    }
    const caps = (await client.query('SELECT * FROM compute_worker_caps WHERE worker_id=$1', [id])).rows[0];
    if (!caps) bad('conflict', 'caps_not_approved');
    if (request.cpuMillicores > caps.max_cpu_millicores
      || request.memoryMb > caps.max_memory_mb
      || request.maxSeconds > caps.max_seconds) {
      bad('denied', 'request_exceeds_approved_caps');
    }
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const row = (await client.query(
      `INSERT INTO compute_task_runs(worker_id,scheduler_user_id,input_classification,credential_hash,
        credential_expires_at,cpu_millicores,memory_mb,max_seconds)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, credential_expires_at`,
      [id, actor, inputClassification, hash, expiresAt.toISOString(),
        request.cpuMillicores, request.memoryMb, request.maxSeconds],
    )).rows[0];
    return { taskId: row.id, workerId: id, token, credentialExpiresAt: row.credential_expires_at.toISOString() };
  });
}

/** Validate a task credential by hash and live expiry. Never reveals the token. */
export async function validateTaskCredential(poolOrClient, { taskId, token }) {
  const id = uuid(taskId, 'task');
  if (typeof token !== 'string' || !token) bad('bad_input', 'invalid_token');
  return withTx(poolOrClient, async (client) => {
    const run = (await client.query(
      'SELECT credential_hash, credential_expires_at FROM compute_task_runs WHERE id=$1', [id])).rows[0];
    if (!run) return { valid: false, reason: 'unknown_task' };
    const hash = createHash('sha256').update(token).digest('hex');
    if (hash !== run.credential_hash) return { valid: false, reason: 'token_mismatch' };
    if (Date.now() >= new Date(run.credential_expires_at).getTime()) return { valid: false, reason: 'expired' };
    return { valid: true };
  });
}
