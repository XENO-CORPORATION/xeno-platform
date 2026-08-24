/**
 * Who is calling, and are they too old to serve?
 *
 * ── THE ONE THING THAT MAKES THIS RETROACTIVE ───────────────────────────────
 *
 * 🔴 Identity is read from the User-Agent as well as an explicit header, and
 * that is not a fallback for convenience — it is the entire reason this control
 * can bind builds that predate it.
 *
 * An installer shipped before licence enforcement existed sends no
 * `X-Xeno-Client`, because nobody had invented it. But Electron and Node set a
 * versioned User-Agent by default, and production `api_usage_logs` shows exactly
 * that: `XenoCode/0.2.0`, `XenoHarbor/0.2.0`. So an old build is attributable to
 * a product and a version WITHOUT ever having been designed to be.
 *
 * If we only honoured the explicit header, this would bind precisely the
 * population that already cooperates — which is the population that does not
 * need binding.
 *
 * ── SEMVER, LOOSELY ─────────────────────────────────────────────────────────
 *
 * Comparison is numeric on dot-separated leading integers, and a prerelease
 * suffix (`0.1.0-beta.2`) sorts BELOW its release. That matters here: a beta
 * must not satisfy a floor set at its own release version, or a policy of
 * "0.1.0 minimum" would admit every 0.1.0-beta build it was written to exclude.
 */

const NAME_MAP = new Map([
  /* Product identity as clients actually report it. Lower-cased on lookup.
   * Names come from what is OBSERVED in production, not from what we wish they
   * sent — that is what makes the map useful for old builds. */
  ['xeno-hub', 'hub'], ['xenohub', 'hub'], ['xeno hub', 'hub'],
  ['xeno-pixel', 'pixel'], ['xenopixel', 'pixel'],
  ['xeno-motion', 'motion'], ['xenomotion', 'motion'],
  ['xeno-canvas', 'canvas'], ['xenocanvas', 'canvas'],
  ['xeno-browser', 'browser'], ['xenobrowser', 'browser'],
  ['xeno-workflow', 'workflow'], ['xenoworkflow', 'workflow'],
  ['xeno-shell', 'shell'], ['xenoshell', 'shell'],
  ['xeno-sound', 'sound'], ['xenosound', 'sound'],
  ['xeno-docs', 'docs'], ['xenodocs', 'docs'],
  ['xeno-sheets', 'sheets'], ['xenosheets', 'sheets'],
  ['xeno-slides', 'slides'], ['xenoslides', 'slides'],
  ['xeno-notes', 'notes'], ['xenonotes', 'notes'],
  ['xeno-agent', 'agent'], ['xenoagent', 'agent'],
  ['xenocode', 'agent-cli'], ['xeno-agent-cli', 'agent-cli'],
  ['xenoharbor', 'harbor'],
]);

const canonical = (raw) => {
  const k = String(raw || '').toLowerCase().trim();
  return NAME_MAP.get(k) || (/^[a-z0-9-]{2,32}$/.test(k) ? k : null);
};

/**
 * `{ product, version, source }` or null.
 *
 * The explicit header wins when present: it is unambiguous and a product can
 * send it even when its User-Agent is generic.
 */
export function identifyClient(req) {
  const explicit = req.headers?.['x-xeno-client'];
  if (typeof explicit === 'string') {
    const m = explicit.match(/^\s*([A-Za-z0-9 _-]{2,32})\s*\/\s*v?([0-9][0-9A-Za-z.+-]{0,40})/);
    if (m) {
      const product = canonical(m[1]);
      if (product) return { product, version: m[2], source: 'header' };
    }
  }

  /* User-Agent — the retroactive path. Electron puts the productName and
   * version at the END (`… Chrome/… Electron/… XENO-HUB/0.11.5`), and simple
   * Node clients put it at the start (`XenoCode/0.2.0`). Scan every token and
   * take the first that names a XENO product, so neither shape is privileged. */
  const ua = req.headers?.['user-agent'];
  if (typeof ua === 'string') {
    for (const tok of ua.split(/\s+/)) {
      const m = tok.match(/^([A-Za-z][A-Za-z0-9_-]{1,31})\/v?([0-9][0-9A-Za-z.+-]{0,40})$/);
      if (!m) continue;
      const product = canonical(m[1]);
      /* Only XENO products, and only names we recognise. A bare `node` or
       * `curl/8.4.0` must never be treated as a product, or a policy for one
       * product would refuse every script in the estate. */
      if (product && NAME_MAP.has(String(m[1]).toLowerCase())) {
        return { product, version: m[2], source: 'user-agent' };
      }
    }
  }
  return null;
}

/** Numeric-dotted comparison; a prerelease sorts below its release. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v || '0').split('-', 2);
    const nums = core.split('.').map((x) => parseInt(x, 10) || 0);
    return { nums, pre: pre || null };
  };
  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i += 1) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  /* 🔴 Equal cores: a prerelease is OLDER than its release. Without this a floor
   * of "0.1.0" would admit every 0.1.0-beta it exists to exclude. */
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre < B.pre ? -1 : A.pre > B.pre ? 1 : 0;
  return 0;
}

/* Policies change rarely and are read on every request, so they are cached —
 * but briefly, because the moment an operator needs to LIFT a floor (they locked
 * out more people than they meant to) they need it to take effect now, not in an
 * hour. 60s is the compromise, and lifting is the direction that matters. */
const TTL_MS = 60_000;
let cache = { at: 0, byProduct: new Map() };

export async function loadPolicies(pool) {
  if (Date.now() - cache.at < TTL_MS) return cache.byProduct;
  const byProduct = new Map();
  try {
    const r = await pool.query(
      'SELECT product, min_supported, min_recommended, message, enforced_at FROM client_version_policy',
    );
    for (const row of r.rows) byProduct.set(row.product, row);
  } catch (e) {
    /* 🔴 Fails OPEN, deliberately, and this is the opposite of the entitlement
     * gate's direction. A version floor is a DEPRECATION control, not a payment
     * control: if the policy table is unreadable the honest response is to keep
     * serving, because the alternative is locking out every user of every
     * product over a database hiccup. Payment is still enforced separately and
     * fails closed. */
    console.error('[ClientVersion] policy load failed, serving without a floor:', e.message);
    return cache.byProduct;
  }
  cache = { at: Date.now(), byProduct };
  return byProduct;
}

/** Test seam + operator escape hatch after an UPDATE. */
export function invalidatePolicyCache() {
  cache = { at: 0, byProduct: new Map() };
}

/**
 * `{ ok }` | `{ ok:false, reason:'unsupported', ... }` | `{ ok:true, outdated:true }`.
 *
 * An unidentified caller is always `ok`: there is nothing to compare, and
 * refusing it would break curl, the SDKs and every integration to catch a case
 * the account gate already covers.
 */
export function evaluateClient(identity, policies, now = new Date()) {
  if (!identity) return { ok: true, identity: null };
  const p = policies.get(identity.product);
  if (!p) return { ok: true, identity };

  /* A floor that has not started yet is published but not enforced — the
   * difference between a deprecation and an outage. */
  const live = !p.enforced_at || new Date(p.enforced_at) <= now;

  if (live && p.min_supported && compareVersions(identity.version, p.min_supported) < 0) {
    return {
      ok: false,
      reason: 'unsupported',
      identity,
      minSupported: p.min_supported,
      message: p.message || null,
    };
  }
  if (p.min_recommended && compareVersions(identity.version, p.min_recommended) < 0) {
    return { ok: true, outdated: true, identity, minRecommended: p.min_recommended, message: p.message || null };
  }
  return { ok: true, identity };
}
