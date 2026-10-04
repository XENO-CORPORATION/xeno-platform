// RES-06: marketplace rentals, free agent offers, donated resources and
// credit contributions are distinct grant types. Each grant carries its own
// owner and consent, plus exactly one leg: a resource lease OR a credit
// amount -- never both (that would be an exchange rate), never neither
// (that would be an empty grant). Grants compose under one task admission
// as separate legs; the admission converts nothing. Grants are single-use:
// composing marks each leg, and a composed grant can neither recompose nor
// be revoked out from under its admission.
const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

const TYPES = ['marketplace-rental', 'free-agent-offer', 'donated-resource', 'credit-contribution'];
const RESOURCE_TYPES = ['marketplace-rental', 'free-agent-offer', 'donated-resource'];

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

/**
 * Issue a grant. Resource types bind an ACTIVE lease the owner holds a side
 * of (offer owner or lease holder); the credit type binds a positive amount.
 * Exactly one leg -- mixing legs is refused (no exchange rate to record).
 */
export async function issueGrant(poolOrClient, { actorUserId, type, resourceLeaseId, creditAmount, consentScope }) {
  const actor = uuid(actorUserId, 'actor');
  if (!TYPES.includes(type)) bad('bad_input', 'unknown_grant_type');
  if (typeof consentScope !== 'string' || !consentScope.trim()) bad('bad_input', 'consent_scope_required');
  const lease = resourceLeaseId == null ? null : uuid(resourceLeaseId, 'lease');
  const credits = creditAmount == null ? null : Number(creditAmount);
  if ((lease === null) === (credits === null)) bad('bad_input', 'grant_mixed_legs');
  if (credits !== null && (!Number.isFinite(credits) || credits <= 0)) bad('bad_input', 'invalid_credit_amount');
  if (type === 'credit-contribution' && lease !== null) bad('bad_input', 'grant_mixed_legs');
  if (RESOURCE_TYPES.includes(type) && credits !== null) bad('bad_input', 'grant_mixed_legs');
  return withTx(poolOrClient, async (client) => {
    if (lease !== null) {
      const row = (await client.query(
        `SELECT l.id, l.status, l.holder_user_id, o.owner_user_id FROM resource_leases l
         JOIN resource_offers o ON o.id=l.offer_id WHERE l.id=$1`, [lease],
      )).rows[0];
      if (!row) bad('not_found', 'lease_not_found');
      if (row.status !== 'active') bad('conflict', 'lease_not_active');
      if (row.holder_user_id !== actor && row.owner_user_id !== actor) bad('denied', 'grant_not_authorized');
    }
    const row = (await client.query(
      `INSERT INTO resource_grants(type,owner_user_id,resource_lease_id,credit_amount,consent_scope)
       VALUES($1,$2,$3,$4,$5) RETURNING id, status`,
      [type, actor, lease, credits === null ? null : String(credits), consentScope.trim()],
    )).rows[0];
    return { grantId: row.id, type, ownerUserId: actor,
      resourceLeaseId: lease, creditAmount: credits, status: row.status };
  });
}

/** Owner revokes an uncomposed grant. Composed grants stand on their admission. */
export async function revokeGrant(poolOrClient, { actorUserId, grantId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(grantId, 'grant');
  return withTx(poolOrClient, async (client) => {
    const grant = (await client.query(
      'SELECT id, owner_user_id, status FROM resource_grants WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!grant) bad('not_found', 'grant_not_found');
    if (grant.owner_user_id !== actor) bad('denied', 'revoke_not_authorized');
    if (grant.status !== 'available') bad('conflict', 'grant_not_available');
    await client.query("UPDATE resource_grants SET status='revoked' WHERE id=$1", [id]);
    return { grantId: id, status: 'revoked' };
  });
}

/**
 * Compose grants under one task admission. Every leg stays separate --
 * separate owners, separate consents, no conversion -- and every leg must
 * be available: revoked or already-composed grants refuse the whole
 * admission, atomically.
 */
export async function composeAdmission(poolOrClient, { actorUserId, taskRef, grantIds }) {
  const actor = uuid(actorUserId, 'actor');
  if (typeof taskRef !== 'string' || !taskRef.trim()) bad('bad_input', 'task_ref_required');
  if (!Array.isArray(grantIds) || grantIds.length === 0) bad('bad_input', 'admission_empty');
  const ids = grantIds.map((g) => uuid(g, 'grant'));
  if (new Set(ids).size !== ids.length) bad('bad_input', 'admission_duplicate_grant');
  return withTx(poolOrClient, async (client) => {
    for (const id of ids) {
      const grant = (await client.query(
        'SELECT id, status FROM resource_grants WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!grant) bad('not_found', 'grant_not_found');
      if (grant.status !== 'available') bad('conflict', 'grant_not_available');
    }
    const admission = (await client.query(
      'INSERT INTO task_grant_admissions(task_ref,scheduler_user_id) VALUES($1,$2) RETURNING id',
      [taskRef.trim(), actor],
    )).rows[0];
    for (const id of ids) {
      await client.query('INSERT INTO admission_grant_legs(admission_id,grant_id) VALUES($1,$2)', [admission.id, id]);
      await client.query("UPDATE resource_grants SET status='composed' WHERE id=$1", [id]);
    }
    const legs = (await client.query(
      `SELECT g.id, g.type, g.owner_user_id, g.resource_lease_id, g.credit_amount, g.consent_scope
       FROM admission_grant_legs l JOIN resource_grants g ON g.id=l.grant_id
       WHERE l.admission_id=$1 ORDER BY g.type, g.id`, [admission.id],
    )).rows.map((g) => ({ grantId: g.id, type: g.type, ownerUserId: g.owner_user_id,
      resourceLeaseId: g.resource_lease_id,
      creditAmount: g.credit_amount === null ? null : Number(g.credit_amount),
      consentScope: g.consent_scope }));
    return { admissionId: admission.id, taskRef: taskRef.trim(), schedulerUserId: actor, legs };
  });
}
