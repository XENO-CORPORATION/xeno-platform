/**
 * Marketplace rentals -- XENO-WORKFORCE-01 MKT-05:
 *   "Rental assignment references an active entitlement and hosted serving version, not a downloadable
 *    private agent. Binding to workspace/project must be allowed by the license. Expiry and revocation
 *    block new dispatch; consumed work remains accountable."
 *
 * A rental is a right to have the platform RUN an agent on the renter's behalf. It is never a right to
 * the seller's private artifact:
 *   - a binding pins a SERVING version (`servable = true`); a version that is not servable cannot be
 *     rented, whatever its artifact;
 *   - a rental entitlement never unlocks the gated download (download route, rentalMayDownload());
 *   - where it may run is the LICENCE's call (`marketplace_listings.rental_license`): personally, in a
 *     workspace the renter belongs to, and in how many workspaces at once;
 *   - an expired or revoked entitlement, or a revoked binding, refuses the next dispatch. Nothing is
 *     deleted: invocations keep their binding_id, so work run under a rental stays attributable.
 */
import { isWorkspaceMember } from '../utils/workspaceContext.js';
import { attachPartition } from './marketplaceRentalPartitions.js';

export class RentalError extends Error {
  constructor(code, message, status) { super(message); this.name = 'RentalError'; this.code = code; this.status = status; }
}

/** The newest published, servable version of a listing -- the only kind a rental may bind. */
export async function servingVersion(db, listingId) {
  const r = await db.query(
    `SELECT * FROM marketplace_listing_versions
      WHERE listing_id = $1 AND servable = true AND published_at IS NOT NULL
      ORDER BY published_at DESC, created_at DESC LIMIT 1`,
    [listingId],
  );
  return r.rows[0] || null;
}

async function liveRentalEntitlement(db, userId, listingId, { forUpdate = false, client = db } = {}) {
  const r = await client.query(
    `SELECT * FROM marketplace_entitlements
      WHERE user_id = $1 AND listing_id = $2 AND kind = 'rental'${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId, listingId],
  );
  const e = r.rows[0];
  if (!e) throw new RentalError('no_rental', 'You have no rental for this listing', 402);
  if (e.status === 'revoked') throw new RentalError('rental_revoked', 'This rental was revoked', 403);
  if (e.status !== 'active' || (e.expires_at && new Date(e.expires_at) <= new Date())) {
    throw new RentalError('rental_expired', 'This rental has expired', 403);
  }
  return e;
}

/**
 * Bind the renter's rental to a target: themselves (workspaceId null) or one workspace they belong to,
 * as far as the listing's rental licence allows. Idempotent per (entitlement, target).
 */
export async function bindRental(pool, { user, listing, workspaceId = null }) {
  const license = listing.rental_license || { personal: true, workspace: false, maxWorkspaces: 0 };
  if (workspaceId == null && !license.personal) {
    throw new RentalError('license_forbids_personal', 'This rental licence does not allow personal use', 403);
  }
  if (workspaceId != null) {
    if (!license.workspace) {
      throw new RentalError('license_forbids_workspace', 'This rental licence does not allow workspace use', 403);
    }
    if (!(await isWorkspaceMember(pool, workspaceId, user.id))) {
      throw new RentalError('not_a_member', 'You can only bind a rental to a workspace you belong to', 403);
    }
  }
  const version = await servingVersion(pool, listing.id);
  if (!version) throw new RentalError('no_serving_version', 'This listing has no hosted serving version to rent', 409);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entitlement = await liveRentalEntitlement(pool, user.id, listing.id, { forUpdate: true, client });
    const existing = await client.query(
      `SELECT * FROM marketplace_rental_bindings
        WHERE entitlement_id = $1 AND state = 'active' AND target_workspace_id IS NOT DISTINCT FROM $2`,
      [entitlement.id, workspaceId],
    );
    if (existing.rows[0]) { await client.query('COMMIT'); return attachPartition(pool, existing.rows[0]); }
    if (workspaceId != null) {
      const live = Number((await client.query(
        `SELECT count(*) FROM marketplace_rental_bindings
          WHERE entitlement_id = $1 AND state = 'active' AND target_workspace_id IS NOT NULL`,
        [entitlement.id],
      )).rows[0].count);
      if (live >= Number(license.maxWorkspaces || 0)) {
        throw new RentalError('license_workspace_limit',
          `This rental licence allows ${license.maxWorkspaces} workspace(s) at once`, 409);
      }
    }
    const r = await client.query(
      `INSERT INTO marketplace_rental_bindings
         (entitlement_id, listing_id, renter_user_id, target_workspace_id, serving_version_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [entitlement.id, listing.id, user.id, workspaceId, version.id],
    );
    // MKT-07: the binding's memory partition is (entitlement, target) -- attached in the same
    // transaction, so a binding never exists without the partition that isolates it.
    const bound = await attachPartition(client, r.rows[0]);
    await client.query('COMMIT');
    return bound;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The binding an invocation runs under, checked NOW: the entitlement must still be live and the binding
 * must still be active. This is what makes expiry and revocation block new dispatch.
 */
export async function bindingForDispatch(db, { user, listing, bindingId }) {
  if (!bindingId) throw new RentalError('binding_required', 'A rental is invoked through a binding (bind it first)', 400);
  const r = await db.query(
    'SELECT * FROM marketplace_rental_bindings WHERE id = $1 AND renter_user_id = $2 AND listing_id = $3',
    [bindingId, user.id, listing.id],
  );
  const binding = r.rows[0];
  if (!binding) throw new RentalError('binding_not_found', 'Rental binding not found', 404);
  if (binding.state !== 'active') throw new RentalError('binding_revoked', 'This rental binding was revoked', 403);
  await liveRentalEntitlement(db, user.id, listing.id);
  if (!binding.partition_id) return attachPartition(db, binding);
  if (binding.target_workspace_id && !(await isWorkspaceMember(db, binding.target_workspace_id, user.id))) {
    throw new RentalError('not_a_member', 'You no longer belong to the workspace this rental is bound to', 403);
  }
  return binding;
}

/** Revoke one binding (the renter's own act). The binding row and its invocations are kept. */
export async function revokeBinding(db, { user, bindingId, reason }) {
  const r = await db.query(
    `UPDATE marketplace_rental_bindings
        SET state = 'revoked', revoked_at = now(), revoked_reason = $3, updated_at = now()
      WHERE id = $1 AND renter_user_id = $2 AND state = 'active' RETURNING *`,
    [bindingId, user.id, String(reason || 'revoked by renter').slice(0, 500)],
  );
  if (!r.rows[0]) throw new RentalError('binding_not_found', 'No active rental binding to revoke', 404);
  return r.rows[0];
}

/**
 * Revoke a rental entitlement (seller withdrawal, refund, policy). Every binding under it is revoked
 * too, in the same transaction, with the same reason. Consumed work is untouched.
 */
export async function revokeRentalEntitlement(pool, { entitlementId, reason }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = await client.query(
      `UPDATE marketplace_entitlements
          SET status = 'revoked', revoked_at = now(), revoked_reason = $2, updated_at = now()
        WHERE id = $1 AND kind = 'rental' AND status <> 'revoked' RETURNING *`,
      [entitlementId, String(reason || '').slice(0, 500)],
    );
    if (!e.rows[0]) { await client.query('ROLLBACK'); return null; }
    await client.query(
      `UPDATE marketplace_rental_bindings
          SET state = 'revoked', revoked_at = now(), revoked_reason = $2, updated_at = now()
        WHERE entitlement_id = $1 AND state = 'active'`,
      [entitlementId, `entitlement revoked: ${String(reason || '').slice(0, 480)}`],
    );
    await client.query('COMMIT');
    return e.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A rental grants hosted use only. It never unlocks the seller's private, gated artifact. */
export function rentalMayDownload(entitlement) {
  return entitlement?.kind !== 'rental';
}

export async function listBindings(db, userId) {
  const r = await db.query(
    `SELECT b.*, l.title, l.slug FROM marketplace_rental_bindings b JOIN marketplace_listings l ON l.id = b.listing_id
      WHERE b.renter_user_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
    [userId],
  );
  return r.rows.map(publicBinding);
}

export function publicBinding(b) {
  return {
    id: b.id,
    listingId: b.listing_id,
    title: b.title,
    target: b.target_workspace_id ? { kind: 'workspace', workspaceId: b.target_workspace_id } : { kind: 'personal' },
    servingVersionId: b.serving_version_id,
    partitionId: b.partition_id ?? null,
    state: b.state,
    revokedAt: b.revoked_at,
    revokedReason: b.revoked_reason,
    createdAt: b.created_at,
  };
}
