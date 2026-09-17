/**
 * gatewayCatalogueSync — keep gateway_model_aliases.provider in step with the
 * gateway's own catalogue.
 *
 * WHY. Provider-aware routing (INFERENCE ROUTING spec, D2 amended 2026-09-17)
 * decides whether a user's first-party key can serve a model by reading
 * `gateway_model_aliases.provider`. That column was seeded by a LIKE-prefix
 * guess in migration 20260912190000 and never updated — so every model the
 * gateway has added since resolved `catalogue-unknown` and was ATTEMPTED on
 * whatever key the user set, with the provider refusing visibly. Correct, but a
 * refusal the platform could have made itself. The gateway now publishes its
 * catalogue over WireGuard (gateway 8c11b10, `GET /internal/catalogue/models`,
 * bearer = the shared INFERENCE_GRANT_TOKEN); this reads it and upserts.
 *
 * WHAT IT WRITES — and deliberately does not:
 *   - `provider` for every catalogue id: the catalogue is the authority.
 *   - NEW ids are inserted as identity aliases (internal_id = public_id,
 *     is_alias = false). An existing row keeps its internal_id: aliases like
 *     `claude-opus-4.6` -> `claude-opus-4-6` are hand-curated and the catalogue
 *     does not know them.
 *   - `enabled` is NEVER touched. `routable` in the catalogue is LIVENESS
 *     ("capacity is out right now"), not catalogue membership; a model that is
 *     down today must still route to the right provider tomorrow. Disabling on
 *     routable=false would also delete the user's route to it as a side effect.
 *   - Rows the catalogue does not mention are left alone. Absence from one
 *     fetch is not evidence of retirement; retirement is a human decision.
 *
 * FAIL-CLOSED, NOT FAIL-QUIET. No URL configured -> the sync says so once and
 * does nothing. A failed fetch leaves the table as it was and is logged; the
 * matcher's `catalogue-unknown -> attempt` rule keeps routing correct in the
 * meantime. A response that does not look like a catalogue is refused before a
 * single row is written — a half-applied catalogue is worse than a stale one.
 */

const PROVIDER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** Validate the catalogue shape; returns the usable rows or throws. */
export function parseCatalogue(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.models)) {
    throw new Error('catalogue: body.models is not an array');
  }
  const rows = [];
  for (const m of body.models) {
    if (!m || typeof m !== 'object') continue;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    const provider = typeof m.provider === 'string' ? m.provider.trim().toLowerCase() : '';
    if (!ID_RE.test(id) || !PROVIDER_RE.test(provider)) continue;
    rows.push({ id, provider });
  }
  if (rows.length === 0) throw new Error('catalogue: no usable rows');
  return rows;
}

/** Upsert the parsed rows. Returns { inserted, updated, unchanged }. */
export async function applyCatalogue(db, rows) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0, updated = 0, unchanged = 0;
    for (const { id, provider } of rows) {
      const r = await client.query(
        `INSERT INTO gateway_model_aliases (public_id, internal_id, provider, is_alias, notes)
           VALUES ($1, $1, $2, false, 'gateway catalogue sync')
         ON CONFLICT (public_id) DO UPDATE
           SET provider = EXCLUDED.provider, updated_at = now()
           WHERE gateway_model_aliases.provider IS DISTINCT FROM EXCLUDED.provider
         RETURNING (xmax = 0) AS inserted`,
        [id, provider],
      );
      if (r.rowCount === 0) unchanged += 1;
      else if (r.rows[0].inserted) inserted += 1;
      else updated += 1;
    }
    await client.query('COMMIT');
    return { inserted, updated, unchanged, total: rows.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function fetchCatalogue({ url, token, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: ctl.signal });
    if (res.status !== 200) throw new Error(`catalogue: HTTP ${res.status}`);
    return parseCatalogue(await res.json());
  } finally {
    clearTimeout(t);
  }
}

/** One sync. Resolves to a summary, or { skipped: reason } when not configured. */
export async function syncGatewayCatalogue(db, env = process.env, { fetchImpl } = {}) {
  const url = env.INFERENCE_CATALOGUE_URL;
  const token = env.INFERENCE_GRANT_TOKEN;
  if (!url) return { skipped: 'INFERENCE_CATALOGUE_URL unset' };
  if (!token) return { skipped: 'INFERENCE_GRANT_TOKEN unset' };
  const rows = await fetchCatalogue({ url, token, fetchImpl });
  return applyCatalogue(db, rows);
}

export default { parseCatalogue, applyCatalogue, fetchCatalogue, syncGatewayCatalogue };
