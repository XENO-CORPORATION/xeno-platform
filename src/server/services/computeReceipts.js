// RES-04: worker-reported output and GPU-hours are not automatically
// trustworthy. A report binds job identity (the task's own credential must
// authenticate it), input/output hashes, and metering into a receipt that
// starts UNVERIFIED. Cancellation binds too: cancelled tasks refuse new
// reports and their receipts can never verify. Verification checks the
// artifact hash and -- for consequential results -- demands independent
// reproduction by a party other than the donor. Only a verified receipt
// grounds task acceptance or the settlement basis that credit-minting and
// funding-release call sites must take.
//
// NOTE (tracked adoption): acceptTaskResult and settlementBasisForReceipt
// are the gates, proven here. Wiring the credit ledger and funding release
// to take ONLY this basis is the rollout step that follows; those call
// sites are tracked separately, not silently fixed by this change.
import { createHash } from 'node:crypto';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const HASH = /^[0-9a-f]{64}$/i;
const hashOf = (value, what) => {
  if (typeof value !== 'string' || !HASH.test(value)) bad('bad_input', `invalid_${what}`);
  return value.toLowerCase();
};

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

/** Report output. The task credential authenticates the report; the receipt starts unverified. */
export async function reportTaskOutput(poolOrClient, { taskId, token, inputHash, outputHash, gpuHours, artifactRef, consequential }) {
  const id = uuid(taskId, 'task');
  if (typeof token !== 'string' || !token) bad('bad_input', 'invalid_token');
  const input = hashOf(inputHash, 'input_hash');
  const output = hashOf(outputHash, 'output_hash');
  const hours = Number(gpuHours);
  if (!Number.isFinite(hours) || hours < 0) bad('bad_input', 'invalid_metering');
  if (typeof artifactRef !== 'string' || !artifactRef.trim()) bad('bad_input', 'artifact_ref_required');
  return withTx(poolOrClient, async (client) => {
    const run = (await client.query(
      'SELECT id, worker_id, credential_hash, credential_expires_at, cancelled_at FROM compute_task_runs WHERE id=$1',
      [id],
    )).rows[0];
    if (!run) bad('not_found', 'task_not_found');
    if (run.cancelled_at !== null) bad('conflict', 'task_cancelled');
    if (createHash('sha256').update(token).digest('hex') !== run.credential_hash) bad('denied', 'report_not_authenticated');
    if (Date.now() >= new Date(run.credential_expires_at).getTime()) bad('denied', 'report_credential_expired');
    const row = (await client.query(
      `INSERT INTO compute_task_receipts(task_run_id,worker_id,input_hash,output_hash,gpu_hours,artifact_ref,consequential)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
      [id, run.worker_id, input, output, String(hours), artifactRef.trim(), consequential === true],
    )).rows[0];
    return { receiptId: row.id, taskRunId: id, status: row.status };
  });
}

/** Cancel a task. The scheduler (or donor) cancels; receipts of cancelled tasks can never verify. */
export async function cancelComputeTask(poolOrClient, { actorUserId, taskId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(taskId, 'task');
  return withTx(poolOrClient, async (client) => {
    const run = (await client.query(
      `SELECT r.id, r.scheduler_user_id, r.cancelled_at, w.donor_user_id FROM compute_task_runs r
       JOIN compute_workers w ON w.id=r.worker_id WHERE r.id=$1 FOR UPDATE`, [id],
    )).rows[0];
    if (!run) bad('not_found', 'task_not_found');
    if (run.scheduler_user_id !== actor && run.donor_user_id !== actor) bad('denied', 'cancel_not_authorized');
    if (run.cancelled_at !== null) bad('conflict', 'task_already_cancelled');
    await client.query('UPDATE compute_task_runs SET cancelled_at=now(), cancelled_by_user_id=$2 WHERE id=$1', [id, actor]);
    await client.query(
      `UPDATE compute_task_receipts SET status='cancelled' WHERE task_run_id=$1 AND status='unverified'`, [id]);
    return { taskId: id, cancelled: true };
  });
}

/**
 * Verify a receipt. The artifact hash must match; consequential results
 * additionally demand independent reproduction; the donor never self-verifies.
 */
export async function verifyTaskReceipt(poolOrClient, { actorUserId, receiptId, artifactHash, method }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(receiptId, 'receipt');
  const artifact = hashOf(artifactHash, 'artifact_hash');
  if (method !== 'artifact-hash' && method !== 'independent-reproduction') bad('bad_input', 'invalid_method');
  return withTx(poolOrClient, async (client) => {
    const receipt = (await client.query(
      `SELECT r.*, w.donor_user_id FROM compute_task_receipts r
       JOIN compute_workers w ON w.id=r.worker_id WHERE r.id=$1 FOR UPDATE`, [id],
    )).rows[0];
    if (!receipt) bad('not_found', 'receipt_not_found');
    if (receipt.status !== 'unverified') bad('conflict', 'receipt_not_unverified');
    if (receipt.donor_user_id === actor) bad('denied', 'verifier_not_independent');
    if (artifact !== receipt.output_hash) bad('conflict', 'artifact_hash_mismatch');
    if (receipt.consequential && method !== 'independent-reproduction') {
      bad('denied', 'consequential_requires_reproduction');
    }
    await client.query(
      `UPDATE compute_task_receipts SET status='verified', verification_method=$2, verified_by_user_id=$3, verified_at=now() WHERE id=$1`,
      [id, method, actor],
    );
    return { receiptId: id, status: 'verified', method };
  });
}

/** Task acceptance grounds on a verified receipt -- nothing else. */
export async function acceptTaskResult(poolOrClient, { actorUserId, receiptId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(receiptId, 'receipt');
  return withTx(poolOrClient, async (client) => {
    const receipt = (await client.query(
      'SELECT id, task_run_id, status FROM compute_task_receipts WHERE id=$1', [id])).rows[0];
    if (!receipt) bad('not_found', 'receipt_not_found');
    if (receipt.status !== 'verified') bad('conflict', 'receipt_unverified');
    const run = (await client.query('SELECT scheduler_user_id FROM compute_task_runs WHERE id=$1', [receipt.task_run_id])).rows[0];
    if (!run || run.scheduler_user_id !== actor) bad('denied', 'accept_not_authorized');
    await client.query(
      'INSERT INTO compute_task_acceptances(receipt_id,accepted_by_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, actor],
    );
    return { receiptId: id, accepted: true };
  });
}

/**
 * The settlement basis credit-minting and funding-release call sites must
 * take: returns the verified receipt, or refuses. An unverified receipt
 * mints nothing, releases nothing.
 */
export async function settlementBasisForReceipt(poolOrClient, { receiptId }) {
  const id = uuid(receiptId, 'receipt');
  return withTx(poolOrClient, async (client) => {
    const receipt = (await client.query(
      'SELECT id, task_run_id, worker_id, gpu_hours, status FROM compute_task_receipts WHERE id=$1', [id])).rows[0];
    if (!receipt) bad('not_found', 'receipt_not_found');
    if (receipt.status !== 'verified') bad('conflict', 'receipt_unverified');
    return { receiptId: receipt.id, taskRunId: receipt.task_run_id, workerId: receipt.worker_id,
      gpuHours: Number(receipt.gpu_hours), status: receipt.status };
  });
}
