// RES-05: leases track revocation, expiry and verified settlement. There is
// deliberately NO completed lease state: capacity that disappears reads
// unavailable (expired or released) or interrupted (revoked mid-window),
// never completed. Storage leases expire into their AGREED export window --
// a storage offer without retention terms cannot be accepted at all.
// Settlement grounds on terminal leases with a named method and reference,
// plus verified metering receipts wherever receipts are cited.
const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
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

/** Capacity reading of a lease status. There is no 'completed' -- by schema. */
export function capacityStateOf(status) {
  if (status === 'active') return 'available';
  if (status === 'revoked') return 'interrupted';
  return 'unavailable';
}

export async function readLease(poolOrClient, { leaseId }) {
  const id = uuid(leaseId, 'lease');
  return withTx(poolOrClient, async (client) => {
    const lease = (await client.query('SELECT id, status FROM resource_leases WHERE id=$1', [id])).rows[0];
    if (!lease) bad('not_found', 'lease_not_found');
    return { leaseId: lease.id, status: lease.status, capacityState: capacityStateOf(lease.status) };
  });
}

/** Owner revokes their capacity mid-window. The holder reads interrupted, not completed. */
export async function revokeLease(poolOrClient, { actorUserId, leaseId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(leaseId, 'lease');
  return withTx(poolOrClient, async (client) => {
    const lease = (await client.query(
      `SELECT l.id, l.status, o.owner_user_id FROM resource_leases l
       JOIN resource_offers o ON o.id=l.offer_id WHERE l.id=$1 FOR UPDATE`, [id],
    )).rows[0];
    if (!lease) bad('not_found', 'lease_not_found');
    if (lease.owner_user_id !== actor) bad('denied', 'revoke_not_authorized');
    if (lease.status !== 'active') bad('conflict', 'lease_not_active');
    await client.query("UPDATE resource_leases SET status='revoked' WHERE id=$1", [id]);
    return { leaseId: id, status: 'revoked', capacityState: 'interrupted' };
  });
}

/** Holder releases capacity early. */
export async function releaseLease(poolOrClient, { actorUserId, leaseId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(leaseId, 'lease');
  return withTx(poolOrClient, async (client) => {
    const lease = (await client.query(
      'SELECT id, holder_user_id, status FROM resource_leases WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!lease) bad('not_found', 'lease_not_found');
    if (lease.holder_user_id !== actor) bad('denied', 'release_not_authorized');
    if (lease.status !== 'active') bad('conflict', 'lease_not_active');
    await client.query("UPDATE resource_leases SET status='released' WHERE id=$1", [id]);
    return { leaseId: id, status: 'released', capacityState: 'unavailable' };
  });
}

/** Owner agrees retention/export terms on an offer. Storage acceptance requires them. */
export async function setRetentionTerms(poolOrClient, { actorUserId, offerId, retentionDays, exportGraceDays }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(offerId, 'offer');
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) bad('bad_input', 'retention_required');
  if (!Number.isInteger(exportGraceDays) || exportGraceDays <= 0) bad('bad_input', 'export_grace_required');
  return withTx(poolOrClient, async (client) => {
    const offer = (await client.query('SELECT id, owner_user_id FROM resource_offers WHERE id=$1', [id])).rows[0];
    if (!offer) bad('not_found', 'offer_not_found');
    if (offer.owner_user_id !== actor) bad('denied', 'retention_not_authorized');
    await client.query('UPDATE resource_offers SET retention_days=$2, export_grace_days=$3 WHERE id=$1',
      [id, retentionDays, exportGraceDays]);
    return { offerId: id, retentionDays, exportGraceDays };
  });
}

/**
 * Expire past-window active leases. Storage leases expire into their agreed
 * export window; the sweep reports each lease's export deadline (or flags a
 * legacy termless storage lease, which time still expires).
 */
export async function expireLeases(poolOrClient, { now } = {}) {
  const at = now == null ? new Date() : new Date(now);
  if (Number.isNaN(at.getTime())) bad('bad_input', 'invalid_now');
  return withTx(poolOrClient, async (client) => {
    const rows = (await client.query(
      `UPDATE resource_leases l SET status='expired' FROM resource_offers o
       WHERE l.offer_id=o.id AND l.status='active' AND l.valid_until <= $1
       RETURNING l.id, l.valid_until, o.kind, o.retention_days, o.export_grace_days`,
      [at.toISOString()],
    )).rows;
    return rows.map((r) => {
      const storage = typeof r.kind === 'string' && r.kind.startsWith('storage/');
      const agreed = r.retention_days !== null && r.export_grace_days !== null;
      const exportUntil = storage && agreed
        ? new Date(new Date(r.valid_until).getTime() + Number(r.export_grace_days) * 86400_000).toISOString()
        : null;
      return { leaseId: r.id, status: 'expired', capacityState: 'unavailable',
        ...(storage ? { retentionAgreed: agreed, exportUntil } : {}) };
    });
  });
}

/**
 * Record verified settlement. Only terminal leases settle, settled by owner
 * or holder, with a named method and reference; every cited metering receipt
 * must be verified.
 */
export async function recordLeaseSettlement(poolOrClient, { actorUserId, leaseId, method, reference, receiptIds }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(leaseId, 'lease');
  if (typeof method !== 'string' || !method.trim()) bad('bad_input', 'settlement_method_required');
  if (typeof reference !== 'string' || !reference.trim()) bad('bad_input', 'settlement_reference_required');
  const receipts = receiptIds == null ? [] : receiptIds;
  if (!Array.isArray(receipts)) bad('bad_input', 'invalid_receipts');
  return withTx(poolOrClient, async (client) => {
    const lease = (await client.query(
      `SELECT l.id, l.status, l.holder_user_id, o.owner_user_id FROM resource_leases l
       JOIN resource_offers o ON o.id=l.offer_id WHERE l.id=$1`, [id],
    )).rows[0];
    if (!lease) bad('not_found', 'lease_not_found');
    if (lease.status === 'active') bad('conflict', 'lease_not_terminal');
    if (lease.holder_user_id !== actor && lease.owner_user_id !== actor) bad('denied', 'settle_not_authorized');
    for (const rid of receipts) {
      const receipt = (await client.query('SELECT status FROM compute_task_receipts WHERE id=$1', [uuid(rid, 'receipt')])).rows[0];
      if (!receipt || receipt.status !== 'verified') bad('conflict', 'receipt_unverified');
    }
    await client.query(
      `INSERT INTO resource_lease_settlements(lease_id,method,reference,settled_by_user_id) VALUES($1,$2,$3,$4)
       ON CONFLICT (lease_id) DO NOTHING`,
      [id, method.trim(), reference.trim(), actor],
    );
    return { leaseId: id, settled: true, method: method.trim(), reference: reference.trim() };
  });
}
