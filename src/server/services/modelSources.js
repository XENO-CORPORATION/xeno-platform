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

// byokMode names where an own key is stored; it is only meaningful with source byok (or auto-free byok).

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
  const mode = parseByokMode({ headers, body });
  if (mode.error) return mode;
  return { value, byokMode: mode.value };
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

/** The storage modes an own key can have. The server only knows `cloud`; `local` lives on the device. */
export const BYOK_MODES = Object.freeze(['local', 'cloud']);

/**
 * Group the account's own-key credentials by provider. One entry per provider, with availability
 * per storage mode. `cloud` is the platform vault (mode 'managed'); `local` is the device keychain,
 * which the server cannot see, so it is always `unknown-to-server` and the CLI merges its own state.
 * Pass only credentials that already passed the serves-this-model check.
 */
export function byokByProvider(credentials) {
  const groups = new Map();
  for (const c of credentials) {
    if (!groups.has(c.provider)) groups.set(c.provider, []);
    groups.get(c.provider).push(c);
  }
  return [...groups.entries()].map(([provider, keys]) => {
    // The best cloud copy is the active one; the rest are counted, so the CLI can add a choice step.
    const ranked = [...keys].sort((x, y) => Number(y.status === 'active') - Number(x.status === 'active'));
    const best = ranked[0];
    let cloud;
    if (best.status !== 'active') {
      cloud = { state: 'unavailable', reason: best.status === 'revoked' ? 'no_key' : 'key_unverified', actionUrl: ACTION_URLS.no_key, label: best.label, verified: false };
    } else if (!best.verified_at) {
      cloud = { state: 'unavailable', reason: 'key_unverified', actionUrl: ACTION_URLS.key_unverified, label: best.label, verified: false };
    } else {
      cloud = { state: 'available', label: best.label, verified: true, credential_id: best.id };
    }
    return {
      source: 'byok', provider,
      keys: keys.length,
      modes: { cloud, local: { state: 'unknown-to-server' } },
    };
  });
}

/**
 * Describe the sources one model can use for this account. Facts are supplied by the caller:
 *   balanceMicro  bigint spendable credits (after holds), or null if unknown
 *   minCostMicro  smallest price of one call to this model in micro-credits, or null
 *   quota         the plan's real weekly allowance from accountQuotaView:
 *                 { metered, usedPercent, exhausted, resetsAt }; null or metered:false means the
 *                 plan has NO metered allowance, so no quota source is listed at all
 *   credentials   own-key credentials that already passed the serves check for this model
 *
 * Each source is { source, state: 'available' | 'unavailable', ... }. An unavailable source
 * carries reason and actionUrl. default_source is what auto would pick, or null (auto is then
 * refused, never switched to the own key).
 */
export function sourcesForModel({ balanceMicro = null, minCostMicro = null, quota = null, credentials = [] } = {}) {
  const sources = [];
  let defaultSource = null;

  if (quota && quota.metered) {
    const remainingPercent = Math.max(0, 100 - Number(quota.usedPercent || 0));
    const quotaSource = quota.exhausted
      ? unavailable('quota', 'quota_exhausted', { resets_at: quota.resetsAt ?? null })
      : { source: 'quota', state: 'available', remaining_percent: remainingPercent, resets_at: quota.resetsAt ?? null };
    sources.push(quotaSource);
    if (quotaSource.state === 'available') defaultSource = 'quota';
  }

  const haveBalance = typeof balanceMicro === 'bigint' || typeof balanceMicro === 'number';
  const creditsAvailable = haveBalance && (minCostMicro == null
    ? BigInt(balanceMicro) > 0n
    : BigInt(balanceMicro) >= BigInt(minCostMicro));
  const creditsSource = creditsAvailable
    ? { source: 'credits', state: 'available', balance_micro: String(balanceMicro) }
    : unavailable('credits', 'no_balance', { balance_micro: haveBalance ? String(balanceMicro) : null });
  sources.push(creditsSource);
  if (!defaultSource && creditsSource.state === 'available') defaultSource = 'credits';

  const byok = byokByProvider(credentials);
  if (byok.length === 0) {
    // No own key serves this model: one unavailable row so the picker can offer adding one.
    sources.push(unavailable('byok', 'no_key', { provider: null, modes: { cloud: { state: 'unavailable', reason: 'no_key', actionUrl: ACTION_URLS.no_key }, local: { state: 'unknown-to-server' } } }));
  } else {
    sources.push(...byok);
  }

  return { default_source: defaultSource, sources };
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

/**
 * Read byokMode (`x-xeno-byok-mode` header or `byokMode` body field). `local` is served by the CLI
 * directly and never reaches the gateway with a key, so the gateway refuses it with a typed error
 * rather than serving it. `cloud` is the platform vault. Absent means no choice.
 */
export function parseByokMode({ headers = {}, body = {} } = {}) {
  const raw = headers['x-xeno-byok-mode'] ?? (body && body.byokMode);
  if (raw == null || String(raw).trim() === '') return { value: null };
  const v = String(raw).trim().toLowerCase();
  if (!BYOK_MODES.includes(v)) return { error: 'invalid_byok_mode', message: 'byokMode must be local or cloud' };
  return { value: v };
}

/** Refusal when a chosen storage mode is unusable: named, never switched to the other mode. */
export function refusalForByokMode(mode, group) {
  if (mode === 'local') {
    return { code: 'local_mode_client_only', http: 409, message: 'A local key is used by the CLI on this device; the gateway never receives it.' };
  }
  const cloud = group && group.modes && group.modes.cloud;
  return {
    code: 'cloud_key_unavailable', http: 409,
    message: `The cloud copy of this key is unavailable (${cloud ? cloud.reason : 'no_key'}). Local was not used.`,
    reason: cloud ? cloud.reason : 'no_key', actionUrl: cloud ? cloud.actionUrl : ACTION_URLS.no_key,
  };
}
