/**
 * Rental partitions -- XENO-WORKFORCE-01 MKT-07 / MKT-08 / MKT-09.
 *
 * A rental's memory is the RENTER's, and it is partitioned by entitlement plus target: personal use and
 * each bound workspace are separate partitions, so one entitlement never merges two confidential
 * workspaces (MKT-07). Four rules, each enforced by where the code can and cannot read:
 *
 *  1. CONTEXT LOAD. buildRentalContext() selects exactly two things: the version's REVIEWED
 *     serving_material, and the binding's own partition. It never selects the artifact, the manifest or
 *     any other partition. "Physically exclude seller-private memory" is a property of the query, not a
 *     request to the agent.
 *  2. LEARNING STAYS LOCAL. recordExchange() writes into the invocation's partition and nowhere else.
 *     No read path returns partition content to a seller (MKT-08).
 *  3. SHARING IS A DISCLOSURE. The only route from renter content to a seller is authorizeDisclosure():
 *     the renter picks items, a snapshot of exactly those items is stored, and every seller read of it
 *     is recorded. It is never implied by renting (MKT-08).
 *  4. THE RENTER EXPORTS AND DELETES THEIR CONTENT. Export returns their items only -- no serving
 *     material, no seller data -- and is recorded. Deletion removes their items except those under a
 *     retention requirement, which are reported, not silently kept. Revocation never touches an export:
 *     a copy that left the platform cannot be recalled, and the API says so (MKT-09).
 */
export class PartitionError extends Error {
  constructor(code, message, status) { super(message); this.name = 'PartitionError'; this.code = code; this.status = status; }
}

const CONTEXT_EXCHANGES = 20;

/** The partition for (entitlement, target), created on first use. */
export async function partitionFor(db, { entitlementId, renterUserId, targetWorkspaceId }) {
  await db.query(
    `INSERT INTO marketplace_rental_partitions (entitlement_id, renter_user_id, target_workspace_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (entitlement_id, COALESCE(target_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
    [entitlementId, renterUserId, targetWorkspaceId ?? null],
  );
  const r = await db.query(
    `SELECT * FROM marketplace_rental_partitions
      WHERE entitlement_id = $1 AND target_workspace_id IS NOT DISTINCT FROM $2`,
    [entitlementId, targetWorkspaceId ?? null],
  );
  return r.rows[0];
}

/** Attach a binding to its partition (idempotent). Called when a binding is created. */
export async function attachPartition(db, binding) {
  if (binding.partition_id) return binding;
  const partition = await partitionFor(db, {
    entitlementId: binding.entitlement_id, renterUserId: binding.renter_user_id, targetWorkspaceId: binding.target_workspace_id,
  });
  const r = await db.query(
    'UPDATE marketplace_rental_bindings SET partition_id = $2 WHERE id = $1 RETURNING *', [binding.id, partition.id],
  );
  return r.rows[0];
}

/**
 * The prompt a rental run receives: the version's REVIEWED serving material, this partition's recent
 * exchanges, then the renter's request. Nothing else is read. Unreviewed material is left out.
 */
export async function buildRentalContext(db, { binding, prompt }) {
  const v = await db.query(
    `SELECT serving_material FROM marketplace_listing_versions
      WHERE id = $1 AND serving_material_reviewed_at IS NOT NULL`,
    [binding.serving_version_id],
  );
  const material = v.rows[0]?.serving_material || '';
  const mem = await db.query(
    `SELECT content FROM marketplace_rental_memory
      WHERE partition_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [binding.partition_id, CONTEXT_EXCHANGES],
  );
  const history = mem.rows.reverse().map((r) => r.content);
  const parts = [];
  if (material) parts.push(`## Serving instructions\n${material}`);
  if (history.length) parts.push(`## Earlier work in this workspace\n${history.join('\n---\n')}`);
  parts.push(`## Request\n${prompt}`);
  return parts.join('\n\n').slice(0, 100000);
}

/** Record what a finished rental run exchanged, into its own partition only. Idempotent per invocation. */
export async function recordExchange(db, { invocation, binding, summary }) {
  if (!binding?.partition_id || !summary) return null;
  const content = `Request: ${String(invocation.prompt).slice(0, 4000)}\nOutcome: ${String(summary).slice(0, 12000)}`;
  const r = await db.query(
    `INSERT INTO marketplace_rental_memory (partition_id, kind, content, source_invocation_id)
     VALUES ($1, 'exchange', $2, $3)
     ON CONFLICT (source_invocation_id) WHERE kind = 'exchange' AND source_invocation_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [binding.partition_id, content, invocation.id],
  );
  return r.rows[0] || null;
}

async function ownPartition(db, userId, partitionId) {
  const r = await db.query('SELECT * FROM marketplace_rental_partitions WHERE id = $1 AND renter_user_id = $2', [partitionId, userId]);
  if (!r.rows[0]) throw new PartitionError('partition_not_found', 'Rental partition not found', 404);
  return r.rows[0];
}

/** The renter's export: their items, with provenance. No serving material or seller data. Recorded. */
export async function exportPartition(db, { user, partitionId }) {
  const partition = await ownPartition(db, user.id, partitionId);
  const items = (await db.query(
    `SELECT id, kind, content, source_invocation_id, created_at FROM marketplace_rental_memory
      WHERE partition_id = $1 ORDER BY created_at`,
    [partition.id],
  )).rows;
  await db.query(
    'INSERT INTO marketplace_rental_exports (partition_id, exported_by, item_count) VALUES ($1, $2, $3)',
    [partition.id, user.id, items.length],
  );
  return {
    partitionId: partition.id,
    target: partition.target_workspace_id ? { kind: 'workspace', workspaceId: partition.target_workspace_id } : { kind: 'personal' },
    exportedAt: new Date().toISOString(),
    items: items.map((i) => ({
      id: i.id, kind: i.kind, content: i.content, invocationId: i.source_invocation_id, createdAt: i.created_at,
    })),
  };
}

/**
 * Delete the renter's content in a partition. Items under a retention requirement are kept and REPORTED
 * with their reason -- a deletion request does not override retention, and does not pretend it did.
 */
export async function deletePartitionContent(db, { user, partitionId }) {
  const partition = await ownPartition(db, user.id, partitionId);
  const deleted = await db.query(
    `DELETE FROM marketplace_rental_memory
      WHERE partition_id = $1 AND (retain_until IS NULL OR retain_until <= now()) RETURNING id`,
    [partition.id],
  );
  const retained = (await db.query(
    `SELECT id, retain_until, retain_reason FROM marketplace_rental_memory
      WHERE partition_id = $1 ORDER BY created_at`,
    [partition.id],
  )).rows;
  return {
    deleted: deleted.rowCount,
    retained: retained.map((r) => ({ id: r.id, retainUntil: r.retain_until, reason: r.retain_reason })),
    // MKT-09: a copy the renter already exported left the platform; nothing here recalls it.
    priorExportsRecalled: false,
  };
}

/**
 * The renter's explicit improvement-sharing disclosure. The snapshot is exactly the items they chose,
 * copied now; the seller sees the snapshot, never the live partition.
 */
export async function authorizeDisclosure(db, { user, partitionId, itemIds, reason }) {
  const partition = await ownPartition(db, user.id, partitionId);
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 200) {
    throw new PartitionError('invalid_items', 'Choose between 1 and 200 items to disclose', 400);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new PartitionError('reason_required', 'Say why you are sharing these items', 400);
  }
  const items = (await db.query(
    `SELECT id, kind, content, created_at FROM marketplace_rental_memory
      WHERE partition_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at`,
    [partition.id, itemIds],
  )).rows;
  if (items.length !== new Set(itemIds).size) {
    throw new PartitionError('invalid_items', 'Every disclosed item must be in this partition', 400);
  }
  const listing = (await db.query(
    'SELECT listing_id FROM marketplace_entitlements WHERE id = $1', [partition.entitlement_id],
  )).rows[0].listing_id;
  const r = await db.query(
    `INSERT INTO marketplace_rental_disclosures (partition_id, listing_id, authorized_by, reason, snapshot)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [partition.id, listing, user.id, reason.trim().slice(0, 1000),
     JSON.stringify(items.map((i) => ({ kind: i.kind, content: i.content, createdAt: i.created_at })))],
  );
  return r.rows[0];
}

/** The seller's view: disclosures for their listing, and nothing else. Every read is audited. */
export async function sellerDisclosures(db, { sellerUserId, listingId }) {
  const owns = await db.query(
    `SELECT 1 FROM marketplace_listings l JOIN marketplace_developers d ON d.id = l.developer_id
      WHERE l.id = $1 AND d.user_id = $2`,
    [listingId, sellerUserId],
  );
  if (!owns.rows[0]) throw new PartitionError('not_seller', 'Only the listing\'s seller can read its disclosures', 403);
  const rows = (await db.query(
    `SELECT id, reason, snapshot, authorized_at FROM marketplace_rental_disclosures
      WHERE listing_id = $1 ORDER BY authorized_at DESC LIMIT 200`,
    [listingId],
  )).rows;
  for (const d of rows) {
    await db.query('INSERT INTO marketplace_rental_disclosure_access (disclosure_id, accessed_by) VALUES ($1, $2)', [d.id, sellerUserId]);
  }
  return rows.map((d) => ({ id: d.id, reason: d.reason, items: d.snapshot, authorizedAt: d.authorized_at }));
}

export async function listPartitions(db, userId) {
  const r = await db.query(
    `SELECT p.*, (SELECT count(*) FROM marketplace_rental_memory m WHERE m.partition_id = p.id) AS items
       FROM marketplace_rental_partitions p WHERE p.renter_user_id = $1 ORDER BY p.created_at DESC`,
    [userId],
  );
  return r.rows.map((p) => ({
    id: p.id,
    target: p.target_workspace_id ? { kind: 'workspace', workspaceId: p.target_workspace_id } : { kind: 'personal' },
    items: Number(p.items),
    createdAt: p.created_at,
  }));
}
