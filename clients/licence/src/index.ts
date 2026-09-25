/**
 * @xenosystem/licence — the MAIN-PROCESS entitlement check every XENO desktop app runs.
 *
 * This is the published form of `clients/licence/xenoLicence.ts`, which products used to COPY.
 * A copy per product meant every fix was one deliberate port per adopter, and the ones nobody
 * ported ran the version with the bug (docs/LICENCE-ENFORCEMENT.md, its own EXIT). One package,
 * one version, one fix.
 *
 * It answers the DOOR's question for one product (XENO AUTH - AUTH GATE DELTA §9):
 *
 *   is this build still supported?      → no: 'update-required'  (asked even when signed out)
 *   may this account open THIS product?  → no: 'unlicensed'
 *   could we not find out?               → grace, then 'expired-offline'
 *
 * ── WHY THE MAIN PROCESS, NOT THE RENDERER ──────────────────────────────────
 *
 * 🔴 A renderer check is a suggestion. DevTools is one keystroke away in an Electron app, and
 * anything the renderer decides can be re-decided by whoever is looking at it. The main process
 * is not a boundary against a determined attacker either (see the end of this file) — it is the
 * boundary against the case that actually happens: a copied installer handed to someone else.
 *
 * ── THE RULE IMPLEMENTATIONS GET WRONG ──────────────────────────────────────
 *
 * 🔴 FAIL OPEN ON A NETWORK ERROR. FAIL CLOSED ON AN EXPLICIT REFUSAL.
 *
 * "I could not reach the server" and "the server said no" are different facts. Conflating them
 * punishes someone on a train for something they did not do. A timeout is not a refusal, and a
 * 5xx is OUR fault.
 */

export type LicenceState =
  | 'licensed'          // allowed, verified or within grace
  | 'unlicensed'        // the server was reached and said no
  | 'expired-offline'   // grace ran out and we still cannot reach the server
  | 'update-required';  // this build is below the supported floor (HTTP 426)

export interface Licence {
  state: LicenceState;
  plan: string | null;
  /** Where the entitlement came from — 'personal' or 'workspace'. Shown to the person. */
  source: string | null;
  checkedAt: number;
  /** What the server said, when it said something the person should read. */
  message?: string;
  /** `update-required`: the oldest version still served. */
  minSupported?: string;
  /** `unlicensed`: why — `plan_required`, `unauthenticated`, `unknown_policy`. */
  reason?: string;
}

export interface LicenceOptions {
  /** Product slug as the platform knows it (`canvas`, `motion`, …). */
  product: string;
  /** This build's version — `app.getVersion()`. */
  version: string;
  /**
   * The platform origin. Default `https://xenostudio.ai`.
   *
   * 🔴 NOT `api.xenostudio.ai`. That host is the inference gateway; it does not serve
   * `/api/billing/entitlements` or `/api/client-policy` — it answers the first with its own
   * `401 {"error":"Unauthorized"}` and the second with an HTML 404. The copied reference client
   * defaulted to it, so any product that did not override `apiBase` read an explicit-looking
   * refusal from a server that never looked at the account.
   */
  apiBase?: string;
  /** The account access token, or null when signed out. Called fresh on every check. */
  getToken: () => Promise<string | null> | string | null;
  /** The cached last-good answer. Must persist across restarts or grace means nothing. */
  readCache: () => Promise<Licence | null> | Licence | null;
  writeCache: (l: Licence) => Promise<void> | void;
  /** Called with every result, so the host can push it to its door. */
  onChange?: (l: Licence) => void;
  /** How long a verified licence survives with no contact. Default 14 days. */
  graceMs?: number;
  /** How often to re-verify while running. Default 6 hours. */
  intervalMs?: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 10 s. */
  timeoutMs?: number;
}

const DAY = 86_400_000;
export const DEFAULT_GRACE_MS = 14 * DAY;
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_API_BASE = 'https://xenostudio.ai';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The headers every call a product makes to the platform must carry — including its OIDC token
 * requests. The server refuses a product's OWN sign-in client below the floor unless this header
 * says the build is supported (DELTA §9.3), so a product that sends it only here, and not on its
 * token requests, locks itself out the day a floor is set.
 */
export function xenoClientHeaders(product: string, version: string): Record<string, string> {
  return {
    'X-Xeno-Client': `${product}/${version}`,
    'X-Xeno-Surface': product.startsWith('xeno-') ? product : `xeno-${product}`,
  };
}

interface Ctx {
  base: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  timeoutMs: number;
}

/** A fetch that never throws for HTTP status and always times out. `null` = could not reach. */
async function request(ctx: Ctx, path: string, token: string | null): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ctx.timeoutMs);
  try {
    return await ctx.fetch(`${ctx.base}${path}`, {
      headers: { ...ctx.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: ctrl.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function jsonOf(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function updateRequired(body: any, cached: Licence | null): Licence {
  const e = body?.error && typeof body.error === 'object' ? body.error : body;
  return {
    state: 'update-required',
    plan: cached?.plan ?? null,
    source: cached?.source ?? null,
    checkedAt: Date.now(),
    ...(e?.minSupported ? { minSupported: String(e.minSupported) } : {}),
    ...(e?.message ? { message: String(e.message) } : e?.error_description ? { message: String(e.error_description) } : {}),
  };
}

/**
 * One check. Never throws — a licence check that can crash the app it protects has inverted the
 * relationship. Every caller-supplied callback is guarded.
 */
export async function checkLicence(opts: LicenceOptions): Promise<Licence> {
  const grace = opts.graceMs ?? DEFAULT_GRACE_MS;
  const ctx: Ctx = {
    base: (opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
    headers: xenoClientHeaders(opts.product, opts.version),
    fetch: opts.fetch ?? fetch,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  let cached: Licence | null = null;
  try { cached = (await opts.readCache()) || null; } catch { cached = null; }
  const withinGrace = (c: Licence | null): boolean =>
    Boolean(c && c.state === 'licensed' && Date.now() - c.checkedAt < grace);
  const offline = (): Licence => (cached && withinGrace(cached))
    ? cached
    : { state: cached ? 'expired-offline' : 'unlicensed', plan: cached?.plan ?? null, source: null, checkedAt: cached?.checkedAt ?? Date.now(), ...(cached ? {} : { reason: 'unreachable' }) };
  const persist = async (l: Licence) => { try { await opts.writeCache(l); } catch { /* best-effort */ } };

  let token: string | null = null;
  try { token = (await opts.getToken()) || null; } catch { token = null; }

  if (!token) {
    /*
     * Signed out. Nothing to verify about an account — but the BUILD can still be too old, and
     * that must be said before anyone is offered a sign-in the server will refuse to complete.
     * `/api/client-policy` is unauthenticated and exempt from the floor precisely for this.
     */
    const res = await request(ctx, '/api/client-policy', null);
    if (res?.ok) {
      const body = await jsonOf(res);
      if (body?.supported === false) return updateRequired(body, cached);
    }
    /* Grace still applies: someone who signed out on a plane has not stopped paying. */
    return (cached && withinGrace(cached))
      ? { ...cached, state: 'licensed' }
      : { state: 'unlicensed', plan: null, source: null, checkedAt: Date.now(), reason: 'unauthenticated' };
  }

  const res = await request(ctx, '/api/billing/entitlements', token);
  if (!res) return offline();                         // network, DNS, timeout, captive portal

  if (res.status === 426) {
    /* Below the floor. NOT a licence problem: they may be paying perfectly well. */
    return updateRequired(await jsonOf(res), cached);
  }
  if (res.status === 401 || res.status === 403) {
    /* An explicit refusal from the platform. Fail closed — grace exists for uncertainty and
     * there is none here. */
    const body = await jsonOf(res);
    const l: Licence = { state: 'unlicensed', plan: null, source: null, checkedAt: Date.now(), reason: res.status === 401 ? 'unauthenticated' : 'refused', ...(body?.error && typeof body.error === 'string' ? { message: body.error } : {}) };
    await persist(l);
    return l;
  }
  if (!res.ok) return offline();                      // 5xx is our outage, never the customer's

  const data = await jsonOf(res);
  /*
   * The verdict for THIS product (`product.allowed`) when the server returned one — it does when
   * the request names a product, which this one always does. A server that predates per-product
   * access returns only `entitlements.canUse`, which keeps the old meaning.
   */
  const product = data?.product && data.product.slug === opts.product ? data.product : null;
  const allowed = product ? product.allowed === true : data?.entitlements?.canUse === true;
  const l: Licence = {
    state: allowed ? 'licensed' : 'unlicensed',
    plan: data?.plan ?? null,
    source: data?.source ?? null,
    checkedAt: Date.now(),
    ...(allowed ? {} : { reason: product?.reason || 'plan_required' }),
    ...(!allowed && product?.message ? { message: String(product.message) } : {}),
  };
  await persist(l);
  return l;
}

/**
 * Check at boot and on a schedule. Every result goes to `onChange`. Returns a stop function.
 * The timer is unref'd: a licence check never keeps a quitting app alive.
 */
export function startLicence(opts: LicenceOptions): { stop: () => void; refresh: () => Promise<Licence> } {
  let stopped = false;
  const tick = async (): Promise<Licence> => {
    const l = await checkLicence(opts);
    if (!stopped) { try { opts.onChange?.(l); } catch { /* a listener cannot break the check */ } }
    return l;
  };
  void tick();
  const h: unknown = setInterval(() => { if (!stopped) void tick(); }, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  const timer = h as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
  return {
    stop: () => { stopped = true; clearInterval(h as ReturnType<typeof setInterval>); },
    refresh: tick,
  };
}

/*
 * ── WHAT THIS DOES NOT DO, STATED PLAINLY ───────────────────────────────────
 *
 * It stops CASUAL copying: an installer handed to someone else will not open for them. It does
 * NOT stop a patched binary or an edited cache, and no client-side control ever has. The cache is
 * an offline affordance, not a security boundary.
 *
 * The durable protection is architectural and already true: sign-in, cloud sync, the agent and
 * hosted inference are on our side of the wire, and the server refuses builds below the floor
 * (DELTA §9.3). A patched build is a local editor with no platform.
 */
