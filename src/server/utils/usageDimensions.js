/**
 * usageDimensions — the closed vocabulary a usage row may be tagged with.
 *
 * The gateway sends `routeReason` / `routeMismatchBasis` on settle and usage
 * bodies (gateway f6087f3). The platform stores them as `dimensions` on the
 * usage row so a report can answer "how often was a user's own key skipped, and
 * why". A value outside the vocabulary is DROPPED, never rejected: the ledger
 * must keep accepting money facts from a gateway one version ahead or behind,
 * and an unknown label is not a reason to lose a charge.
 *
 * Both lists mirror services/providerCredentials.js (resolveInferenceRoute's
 * `reason`, credentialServesModel's `basis`). A new value there is a new value
 * here, or it will be silently dropped at the ledger — which is the honest
 * default, and the test pins the two in step.
 */

export const ROUTE_REASONS = Object.freeze([
  'platform-default', 'product-override', 'account-default', 'provider-mismatch', 'request-override',
]);

export const MISMATCH_BASES = Object.freeze([
  'no-model-requested', 'no-allow-list', 'allow-list', 'not-in-allow-list',
  'catalogue-unknown', 'catalogue-match', 'catalogue-mismatch',
]);

const pick = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : undefined);

/**
 * Read the routing dimensions off a request body. Returns only recognised
 * values; an empty object when nothing usable was sent.
 */
export function routingDimensions(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const reason = pick(b.routeReason, ROUTE_REASONS);
  const basis = pick(b.routeMismatchBasis, MISMATCH_BASES);
  if (reason) out.route_reason = reason;
  if (basis) out.route_mismatch_basis = basis;
  return out;
}

/** JSON for the column, or null when there is nothing to say. */
export function dimensionsJson(dims) {
  if (!dims || typeof dims !== 'object') return null;
  const entries = Object.entries(dims).filter(([, v]) => v !== undefined && v !== null);
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}

export default { ROUTE_REASONS, MISMATCH_BASES, routingDimensions, dimensionsJson };
