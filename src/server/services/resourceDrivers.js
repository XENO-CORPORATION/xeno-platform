// RES-02: supported families (licensed assets/data, storage allocation,
// compute time) each need their own admitted driver plus a measurable
// receipt before any offer of that family is advertised as usable.
// Admission is explicit and receipted: a driver row flips to admitted only
// with a probe receipt carrying a measured quantity. Offers of unadmitted
// families -- or of unknown kinds -- may be recorded as proposals, and the
// usable-capacity listing excludes them: a proposal is never delivered
// capacity, and no listing in this module can show it as such.
const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const FAMILIES = ['licensed-asset', 'storage', 'compute'];

/** Offer kinds name their family by prefix: `compute/...`, `storage/...`, `asset/...`. */
export function offerFamily(kind) {
  if (typeof kind !== 'string') return null;
  if (kind.startsWith('compute/')) return 'compute';
  if (kind.startsWith('storage/')) return 'storage';
  if (kind.startsWith('asset/')) return 'licensed-asset';
  return null;
}

async function withTx(poolOrClient, fn) {
  // Same Pool-vs-Client discrimination as resourceOffers: totalCount marks a Pool.
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

/**
 * Admit a family's driver. Requires a probe receipt: { probe, measuredQuantity,
 * measuredUnit, measuredAt }. A receipt with no positive measurement is refused --
 * admission without a measurable receipt is exactly what this requirement forbids.
 */
export async function admitResourceDriver(poolOrClient, { actorUserId, family, driverName, receipt }) {
  const actor = uuid(actorUserId, 'actor');
  if (!FAMILIES.includes(family)) bad('bad_input', 'unknown_family');
  if (typeof driverName !== 'string' || !driverName.trim()) bad('bad_input', 'driver_name_required');
  if (!receipt || typeof receipt !== 'object') bad('bad_input', 'probe_receipt_required');
  const measured = Number(receipt.measuredQuantity);
  if (!Number.isFinite(measured) || measured <= 0) bad('bad_input', 'probe_receipt_required');
  if (typeof receipt.measuredUnit !== 'string' || !receipt.measuredUnit.trim()) bad('bad_input', 'probe_receipt_required');
  if (typeof receipt.probe !== 'string' || !receipt.probe.trim()) bad('bad_input', 'probe_receipt_required');
  const at = receipt.measuredAt == null ? new Date() : new Date(receipt.measuredAt);
  if (Number.isNaN(at.getTime())) bad('bad_input', 'probe_receipt_required');
  return withTx(poolOrClient, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('resource_driver:' || $1))`, [family]);
    const row = (await client.query(
      `INSERT INTO resource_drivers(family, driver_name, admitted, admitted_by_user_id, probe_receipt, admitted_at)
       VALUES($1,$2,TRUE,$3,$4,now())
       ON CONFLICT (family) DO UPDATE SET driver_name=$2, admitted=TRUE, admitted_by_user_id=$3,
         probe_receipt=$4, admitted_at=now()
       RETURNING family, driver_name, admitted`,
      [family, driverName.trim(), actor, JSON.stringify({ probe: receipt.probe.trim(),
        measuredQuantity: measured, measuredUnit: receipt.measuredUnit.trim(), measuredAt: at.toISOString() })],
    )).rows[0];
    return { family: row.family, driverName: row.driver_name, admitted: row.admitted };
  });
}

/**
 * Record an unsupported offer as a proposal. Requires a KNOWN-unsupported
 * kind (unadmitted family or unknown kind): anything already usable is
 * refused here -- proposals must never be a back door into capacity.
 */
export async function recordResourceProposal(poolOrClient, { actorUserId, offer }) {
  const actor = uuid(actorUserId, 'actor');
  if (!offer || typeof offer !== 'object') bad('bad_input', 'offer_required');
  const family = offerFamily(offer.kind);
  return withTx(poolOrClient, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('resource_driver:' || $1))`, [family === null ? 'unknown' : family]);
    if (family !== null) {
      const driver = (await client.query('SELECT admitted FROM resource_drivers WHERE family=$1', [family])).rows[0];
      if (driver && driver.admitted) bad('conflict', 'family_already_usable');
    }
    const { createResourceOffer } = await import('./resourceOffers.js');
    const created = await createResourceOffer(client, { actorUserId: actor, offer });
    await client.query("UPDATE resource_offers SET status='proposal' WHERE id=$1", [created.offerId]);
    return { ...created, status: 'proposal', family };
  });
}

/** Usable capacity: open offers whose family has an admitted driver. Nothing else. */
export async function listUsableOffers(poolOrClient, { actorUserId }) {
  uuid(actorUserId, 'actor');
  return withTx(poolOrClient, async (client) => {
    const admitted = new Set((await client.query(
      'SELECT family FROM resource_drivers WHERE admitted=TRUE')).rows.map((r) => r.family));
    const rows = (await client.query(
      `SELECT id, kind, owner_user_id, capacity_quantity, capacity_unit, status
       FROM resource_offers WHERE status='open' ORDER BY created_at, id`)).rows;
    return rows
      .filter((r) => {
        const family = offerFamily(r.kind);
        return family !== null && admitted.has(family);
      })
      .map((r) => ({ offerId: r.id, kind: r.kind, family: offerFamily(r.kind),
        ownerUserId: r.owner_user_id, capacityQuantity: Number(r.capacity_quantity),
        capacityUnit: r.capacity_unit, status: r.status }));
  });
}
