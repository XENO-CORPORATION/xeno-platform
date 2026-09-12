const SURFACE_ID = /^xeno[_a-z0-9]+$/;

/**
 * Convert historical external_identity_links source_system values into the
 * canonical surface-id vocabulary exposed by /api/v2/me.
 *
 * Identity providers and product surfaces share the legacy table. The account
 * response must expose only product surfaces, and old rows such as `xeno-mail`
 * must be represented as their canonical `xeno_mail` id.
 */
export function normalizeLinkedSurfaces(rows) {
  const surfaces = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.source_system !== 'string') continue;
    const candidate = row.source_system.trim().toLowerCase().replace(/-/g, '_');
    if (!SURFACE_ID.test(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    surfaces.push(candidate);
  }
  return surfaces;
}
