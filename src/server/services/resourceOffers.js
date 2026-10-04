// RES-01: a ResourceOffer declares kind, owner, capacity/quantity, allowed
// project/task, validity, revocation, cost responsibility, data-access
// policy, license and verification method -- all ten, every time. Accepting
// an offer mints a bounded lease/grant: quantity within remaining capacity,
// same unit (no invented exchange rate), window inside the offer window,
// project/task within the allowed binding. The lease carries scope bounds
// only -- there is no credential material anywhere in this flow, by schema
// (no such column exists) and by return shape (bounds, never secrets).
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function') {
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

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

const nonEmpty = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) bad('bad_input', `offer_${field}_required`);
  return value.trim();
};

const windowOf = (validFrom, validUntil) => {
  const from = validFrom instanceof Date ? validFrom : new Date(validFrom);
  const until = validUntil instanceof Date ? validUntil : new Date(validUntil);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) {
    bad('bad_input', 'offer_window_invalid');
  }
  return { from, until };
};

/** Publish an offer. All ten declarations are required; the owner is the actor. */
export async function createResourceOffer(poolOrClient, { actorUserId, offer }) {
  const actor = uuid(actorUserId, 'actor');
  if (!offer || typeof offer !== 'object') bad('bad_input', 'offer_required');
  const kind = nonEmpty(offer.kind, 'kind');
  const quantity = Number(offer.capacityQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) bad('bad_input', 'offer_capacity_required');
  const unit = nonEmpty(offer.capacityUnit, 'unit');
  const allowedProjectId = offer.allowedProjectId == null ? null : uuid(offer.allowedProjectId, 'project');
  const allowedTaskRef = offer.allowedTaskRef == null ? null : nonEmpty(offer.allowedTaskRef, 'task_ref');
  const { from, until } = windowOf(offer.validFrom, offer.validUntil);
  const revocationPolicy = nonEmpty(offer.revocationPolicy, 'revocation');
  const costResponsibility = nonEmpty(offer.costResponsibility, 'cost');
  const dataAccessPolicy = nonEmpty(offer.dataAccessPolicy, 'data_access');
  const license = nonEmpty(offer.license, 'license');
  const verificationMethod = nonEmpty(offer.verificationMethod, 'verification');
  return withTx(poolOrClient, async (client) => {
    if (allowedProjectId !== null) {
      const live = (await client.query('SELECT id FROM chat_projects WHERE id=$1 AND is_archived=FALSE', [allowedProjectId])).rows[0];
      if (!live) bad('not_found', 'project_not_found');
      if (!(await holdsProject(client, actor, allowedProjectId))) bad('denied', 'offer_project_not_held');
    }
    const row = (await client.query(
      `INSERT INTO resource_offers(kind,owner_user_id,capacity_quantity,capacity_unit,allowed_project_id,allowed_task_ref,
        valid_from,valid_until,revocation_policy,cost_responsibility,data_access_policy,license,verification_method)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, kind, owner_user_id, capacity_quantity, capacity_unit, status`,
      [kind, actor, String(quantity), unit, allowedProjectId, allowedTaskRef,
        from.toISOString(), until.toISOString(), revocationPolicy, costResponsibility,
        dataAccessPolicy, license, verificationMethod],
    )).rows[0];
    return { offerId: row.id, kind: row.kind, ownerUserId: row.owner_user_id,
      capacityQuantity: Number(row.capacity_quantity), capacityUnit: row.capacity_unit, status: row.status };
  });
}

/** Owner-only revocation. Accepted leases are NOT rewritten here (RES-05 tracks lease fallout). */
export async function revokeResourceOffer(poolOrClient, { actorUserId, offerId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(offerId, 'offer');
  return withTx(poolOrClient, async (client) => {
    const offer = (await client.query('SELECT id, owner_user_id, status FROM resource_offers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!offer) bad('not_found', 'offer_not_found');
    if (offer.owner_user_id !== actor) bad('denied', 'revoke_not_authorized');
    if (offer.status !== 'open') bad('conflict', 'offer_not_open');
    await client.query("UPDATE resource_offers SET status='revoked' WHERE id=$1", [id]);
    return { offerId: id, status: 'revoked' };
  });
}

/**
 * Accept an offer within its bounds. Returns the lease bounds only --
 * never credential material (none exists in this flow).
 */
export async function acceptResourceOffer(poolOrClient, { actorUserId, offerId, projectId, taskRef, quantity, validUntil }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(offerId, 'offer');
  const want = Number(quantity);
  if (!Number.isFinite(want) || want <= 0) bad('bad_input', 'lease_quantity_required');
  const useProject = projectId == null ? null : uuid(projectId, 'project');
  const useTask = taskRef == null ? null : String(taskRef);
  const leaseUntil = validUntil == null ? null : new Date(validUntil);
  if (leaseUntil !== null && Number.isNaN(leaseUntil.getTime())) bad('bad_input', 'lease_window_invalid');
  return withTx(poolOrClient, async (client) => {
    const offer = (await client.query('SELECT * FROM resource_offers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!offer) bad('not_found', 'offer_not_found');
    if (offer.status !== 'open') bad('conflict', 'offer_not_open');
    const now = new Date();
    if (now < new Date(offer.valid_from) || now > new Date(offer.valid_until)) bad('conflict', 'offer_window_closed');
    if (offer.allowed_project_id !== null && useProject !== offer.allowed_project_id) bad('denied', 'lease_project_mismatch');
    if (offer.allowed_task_ref !== null && useTask !== offer.allowed_task_ref) bad('denied', 'lease_task_mismatch');
    if (useProject !== null && !(await holdsProject(client, actor, useProject))) bad('denied', 'lease_project_not_held');
    const allocated = Number((await client.query(
      `SELECT coalesce(sum(quantity),0) AS n FROM resource_leases WHERE offer_id=$1 AND status='active'`, [id])).rows[0].n);
    if (allocated + want > Number(offer.capacity_quantity)) bad('conflict', 'offer_capacity_exceeded');
    const until = leaseUntil === null || leaseUntil > new Date(offer.valid_until)
      ? new Date(offer.valid_until)
      : leaseUntil;
    if (until <= now) bad('conflict', 'lease_window_closed');
    const row = (await client.query(
      `INSERT INTO resource_leases(offer_id,holder_user_id,project_id,task_ref,quantity,unit,valid_from,valid_until)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, valid_from, valid_until`,
      [id, actor, useProject, useTask, String(want), offer.capacity_unit, now.toISOString(), until.toISOString()],
    )).rows[0];
    return { leaseId: row.id, offerId: id, holderUserId: actor, projectId: useProject, taskRef: useTask,
      quantity: want, unit: offer.capacity_unit,
      validFrom: row.valid_from.toISOString(), validUntil: row.valid_until.toISOString(), status: 'active' };
  });
}
