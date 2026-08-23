/**
 * requestSurface — the product identity on an inference request (spec D6).
 *
 * `api_usage_logs.surface` was 99.95% the transport label `xeno_api`. That
 * bucket made per-product pricing and per-product routing unmeasurable.
 * The header is the stamp; the body field is the same fact for clients that
 * cannot set headers; anything missing or malformed is grandfathered as
 * `legacy:xeno_api` so old callers keep working and stay visible as legacy.
 */

export const LEGACY_SURFACE = 'legacy:xeno_api';

/** OIDC client_id shape, plus `*` (account default) and the legacy prefix. */
const SURFACE_RE = /^[A-Za-z0-9:._*-]{1,64}$/;

export function requestSurface(req) {
  const header = req && req.headers ? req.headers['x-xeno-surface'] : '';
  const body = req && req.body && typeof req.body === 'object' ? req.body.surface : '';
  const raw = (typeof header === 'string' && header.trim())
    || (typeof body === 'string' && body.trim())
    || '';
  if (!raw || !SURFACE_RE.test(raw)) return LEGACY_SURFACE;
  return raw;
}

export default { LEGACY_SURFACE, requestSurface };
