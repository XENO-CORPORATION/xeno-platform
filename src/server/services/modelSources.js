/**
 * Per-model SOURCE selection (XENO INFERENCE ROUTING - SPEC.md, "Per-model sources").
 *
 * A person picks, for one model, WHERE it runs: plan quota, XENO credits, or their own
 * provider key. This module is the pure half: parsing the request field, mapping it onto the
 * existing route vocabulary, and describing each source's state. It does no I/O, so the rules
 * are testable without a database. The routes in aiRoutes.js supply the facts.
 *
 * Rules (locked by the spec):
 *   - auto    = plan quota, then credits. NEVER the own key unless the person chose it.
 *   - quota   = plan quota only. Refused, not substituted, when unavailable.
 *   - credits = XENO credits only. Refused, not substituted, when the balance cannot pay.
 *   - byok    = the own key only. Refused, not substituted, when no active key serves the model.
 * A source that is chosen and unavailable is a typed refusal. Nothing falls back to a source
 * that is billed differently.
 */

export const SOURCE_VALUES = Object.freeze(['auto', 'quota', 'credits', 'byok']);

/**
 * Read the requested source. The header wins if both are present and disagree, so a client
 * cannot be silently overridden by a body field it did not send. Returns { value: null } when
 * the person expressed no choice (today's behaviour is kept), or { error } for a bad value.
 */
export function parseRequestedSource({ headers = {}, body = {} } = {}) {
  const rawHeader = headers['x-xeno-source'];
  const rawBody = body && body.source;
  const header = rawHeader == null ? null : String(rawHeader).trim().toLowerCase();
  const bodyVal = rawBody == null ? null : String(rawBody).trim().toLowerCase();
  if (header !== null && header !== '' && !SOURCE_VALUES.includes(header)) {
    return { error: 'invalid_source', message: `source must be one of ${SOURCE_VALUES.join(', ')}` };
  }
  if (bodyVal !== null && bodyVal !== '' && !SOURCE_VALUES.includes(bodyVal)) {
    return { error: 'invalid_source', message: `source must be one of ${SOURCE_VALUES.join(', ')}` };
  }
  if (header && bodyVal && header !== bodyVal) {
    return { error: 'source_conflict', message: 'x-xeno-source header and source field disagree' };
  }
  const value = header || bodyVal || null;
  return { value };
}

/**
 * Map a requested source onto the existing route path that the resolver already understands.
 * quota and credits both run on the premium (metered) path; the spec's "quota" is the plan
 * allowance and is not yet a separate meter, see sourcesForModel.
 * auto maps to premium EXPLICITLY, so an account whose default is its own key does not get
 * switched to it by a request that asked for auto.
 * Returns null when no source was chosen, which leaves today's resolution untouched.
 */
export function pathForSource(value) {
  switch (value) {
    case 'auto':
    case 'quota':
    case 'credits':
      return 'premium';
    case 'byok':
      return 'byok';
    default:
      return null;
  }
}

/**
 * The real platform pages that resolve each unavailable reason. A CLI opens these in the
 * browser, so they must be pages that exist: /overview/integrations (keys), /overview/billing
 * (credits), /pricing (plan). Verified against src/App.tsx and src/pages/Overview.tsx.
 * The own-key entry itself lives on the API portal (see Integrations page); the platform page
 * is the way there, and does not pre-select a provider.
 */
export const ACTION_URLS = Object.freeze({
  no_key: '/overview/integrations',
  key_unverified: '/overview/integrations',
  no_balance: '/overview/billing',
  quota_exhausted: '/pricing',
});

const unavailable = (source, reason, extra = {}) => ({
  source, state: 'unavailable', reason, actionUrl: ACTION_URLS[reason], ...extra,
});

/**
 * Describe the sources one model can use for this account. Facts are supplied by the caller:
 *   balanceMicro  bigint spendable credits (after holds), or null if unknown
 *   minCostMicro  smallest price of one call to this model in micro-credits, or null
 *   quota         { remaining } when the plan offers a per-model allowance, else null
 *   credentials   own-key credentials that already passed the serves check for this model,
 *                 each { id, provider, label, status, verified_at }
 *
 * Each source is { source, state: 'available' | 'unavailable', ... }. An unavailable source
 * carries reason (no_key | no_balance | quota_exhausted | key_unverified) and actionUrl.
 * default_source is what auto would pick, or null (auto is then refused, never switched).
 */
export function sourcesForModel({ balanceMicro = null, minCostMicro = null, quota = null, credentials = [] } = {}) {
  // Per-model plan quota is not metered today; a null quota therefore reads as exhausted.
  const quotaSource = quota && Number.isFinite(quota.remaining) && quota.remaining > 0
    ? { source: 'quota', state: 'available', remaining: quota.remaining }
    : unavailable('quota', 'quota_exhausted', { remaining: quota && Number.isFinite(quota.remaining) ? quota.remaining : 0 });

  const haveBalance = typeof balanceMicro === 'bigint' || typeof balanceMicro === 'number';
  const creditsAvailable = haveBalance && (minCostMicro == null
    ? BigInt(balanceMicro) > 0n
    : BigInt(balanceMicro) >= BigInt(minCostMicro));
  const creditsSource = creditsAvailable
    ? { source: 'credits', state: 'available', balance_micro: String(balanceMicro) }
    : unavailable('credits', 'no_balance', { balance_micro: haveBalance ? String(balanceMicro) : null });

  const byokSources = credentials.map((c) => {
    const base = { source: 'byok', credential_id: c.id, provider: c.provider, label: c.label, status: c.status, verified: c.status === 'active' && !!c.verified_at };
    if (c.status !== 'active') {
      // A revoked key is replaced by adding one; a key the provider rejected needs re-verifying.
      return unavailable('byok', c.status === 'revoked' ? 'no_key' : 'key_unverified', base);
    }
    if (!c.verified_at) return unavailable('byok', 'key_unverified', base);
    return { ...base, state: 'available' };
  });
  // No credential at all that serves this model is a no_key row, so the picker can offer adding one.
  if (byokSources.length === 0) byokSources.push(unavailable('byok', 'no_key', { provider: null }));

  let defaultSource = null;
  if (quotaSource.state === 'available') defaultSource = 'quota';
  else if (creditsSource.state === 'available') defaultSource = 'credits';

  return {
    default_source: defaultSource,
    sources: [quotaSource, creditsSource, ...byokSources],
  };
}

/**
 * The typed refusal for a chosen source that cannot serve. Returned to the caller as a 409/402,
 * never converted into another source. `code` is stable for clients; the message is for people.
 */
export function refusalForSource(value, sources) {
  if (value === 'auto') {
    return { code: 'no_source_available', http: 402, message: 'No plan quota or credits can serve this model. Choose your own key or top up.' };
  }
  if (value === 'quota') return { code: 'quota_exhausted', http: 402, message: 'Your plan allowance cannot serve this model.', actionUrl: ACTION_URLS.quota_exhausted };
  if (value === 'credits') {
    return { code: 'no_balance', http: 402, message: 'Your XENO credits cannot pay for this model. Top up or choose another source.', actionUrl: ACTION_URLS.no_balance };
  }
  if (value === 'byok') return { code: 'no_key', http: 409, message: 'No active own key serves this model.', actionUrl: ACTION_URLS.no_key };
  return null;
}
