import crypto from 'node:crypto';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const operationError = (status, code) => Object.assign(new Error(code), { status, code });
const canonicalJson=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(canonicalJson):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalJson(value[key])]));
export const operationHash = value => crypto.createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
/** All workspace membership writers, including non-replayable legacy requests,
 * take this gate before the workspace row and then any invitation row. */
export async function lockWorkspaceAuthority(db, workspaceId) {
  if (!UUID.test(workspaceId)) throw operationError(400, 'invalid_workspace_operation');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workspace-authority-operations:${workspaceId.toLowerCase()}`]);
}
export async function authorityTransaction(pool, apply) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query("SET LOCAL statement_timeout='5s'");
    const result = await apply(db);
    await db.query('COMMIT');
    return result;
  } catch (failure) { await db.query('ROLLBACK'); throw failure; }
  finally { db.release(); }
}
// Receipt ownership survives role loss, not account/workspace reincarnation.
// This check alone grants no authority to read current workspace data or mutate.
export async function workspaceOperationIncarnation(db, workspaceId, actor) {
  const result = await db.query(`SELECT extract(epoch FROM w.created_at)::text AS workspace_created_at,
    extract(epoch FROM u.created_at)::text AS actor_created_at FROM workspaces w JOIN users u ON u.id=$2
    WHERE w.id=$1 AND u.is_active=true`, [workspaceId,actor]);
  if (!result.rowCount) throw operationError(403,'workspace_identity_unavailable');
  return operationHash(result.rows[0]);
}
export function operationIdentity(family, workspaceId, actor, clientId, operationId) {
  if (!['key', 'membership', 'notification'].includes(family) || !UUID.test(workspaceId) || !UUID.test(actor) || !UUID.test(operationId)
    || typeof clientId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(clientId)) throw operationError(400, 'invalid_workspace_operation');
  return [workspaceId.toLowerCase(), actor.toLowerCase(), clientId, operationId.toLowerCase(), family];
}
const where = 'workspace_id=$1 AND actor_user_id=$2 AND client_id=$3 AND operation_id=$4 AND family=$5';
export async function readWorkspaceOperation(db, identity, authorizeIdentity) {
  const incarnation = await authorizeIdentity(db);
  const row = (await db.query(`SELECT receipt,incarnation_hash FROM workspace_key_operations WHERE ${where}`, identity)).rows[0];
  if (row && row.incarnation_hash !== incarnation) throw operationError(409, 'workspace_operation_incarnation_conflict');
  return row ? { state: row.receipt.abandoned === true ? 'abandoned' : row.receipt.rejection ? 'rejected' : 'committed', operation: row.receipt } : { state: 'not-observed', operation: null };
}

/** One canonical DB transaction for receipted workspace mutations. Existing
 * key-table name is retained for compatibility; family is part of the identity.
 * Identity readback may be narrower than mutation authority (e.g. self-leave).
 * It never authorizes a new mutation. No network I/O belongs in apply(). */
export async function transactWorkspaceOperation(pool, { identity, requestHash, authorizeIdentity, authorizeMutation, apply, receipt, rejectedCodes = [], abandonment }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query("SET LOCAL statement_timeout='5s'");
    await lockWorkspaceAuthority(db, identity[0]);
    const incarnation = await authorizeIdentity(db);
    const prior = (await db.query(`SELECT request_hash,receipt,incarnation_hash FROM workspace_key_operations WHERE ${where}`, identity)).rows[0];
    if (prior) {
      if (prior.incarnation_hash !== incarnation) throw operationError(409, 'workspace_operation_incarnation_conflict');
      if (prior.request_hash !== requestHash) throw operationError(409, 'workspace_operation_conflict');
      await db.query('COMMIT');
      return { operation: prior.receipt, replayed: true };
    }
    if(abandonment){
      // Cancellation is authority over the actor's own namespace, not workspace
      // mutation authority. Its separate actor/client budget cannot exhaust a
      // foreign workspace's mutation capacity. The actor lock spans workspaces.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-abandonment:${identity[1]}:${identity[2]}`]);
      const count=Number((await db.query("SELECT count(*) FROM workspace_key_operations WHERE actor_user_id=$1 AND client_id=$2 AND receipt ? 'abandoned'",[identity[1],identity[2]])).rows[0].count);
      if(count>=10000)throw operationError(429,'workspace_abandonment_capacity');
      const operation=abandonment();
      await db.query('INSERT INTO workspace_key_operations(workspace_id,actor_user_id,client_id,operation_id,family,request_hash,receipt,incarnation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...identity,requestHash,JSON.stringify(operation),incarnation]);
      await db.query('COMMIT');return {operation,replayed:false};
    }
    await authorizeMutation(db);
    const count = Number((await db.query("SELECT count(*) FROM workspace_key_operations WHERE workspace_id=$1 AND family=$2 AND NOT receipt ? 'abandoned'", [identity[0], identity[4]])).rows[0].count);
    if (count >= 10000) throw operationError(429, 'workspace_operation_capacity');
    await db.query('SAVEPOINT workspace_mutation');
    let result, operation;
    try { result = await apply(db); operation = receipt(result); }
    catch (failure) {
      if (!rejectedCodes.includes(failure.code)) throw failure;
      await db.query('ROLLBACK TO SAVEPOINT workspace_mutation');
      operation = receipt(undefined, failure.code);
    }
    await db.query('INSERT INTO workspace_key_operations(workspace_id,actor_user_id,client_id,operation_id,family,request_hash,receipt,incarnation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [...identity, requestHash, JSON.stringify(operation), incarnation]);
    await db.query('COMMIT');
    return { operation, replayed: false, result };
  } catch (failure) { await db.query('ROLLBACK'); throw failure; }
  finally { db.release(); }
}
