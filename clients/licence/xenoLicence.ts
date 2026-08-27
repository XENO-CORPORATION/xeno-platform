/**
 * XENO licence client — the MAIN-PROCESS entitlement check every product runs.
 *
 * Reference implementation. Copy this file into a product's main process and
 * wire `startLicence()` at boot.
 *
 * ⚠️ NAMED INTERIM: copying is not the target state. The target is one published
 * package every product depends on, so a fix reaches all of them at once. It is
 * copied today because publishing requires committing to a repo, and on
 * 2026-08-24 all twelve product repos had uncommitted work from other sessions.
 * EXIT: publish `@xenosystem/licence` and replace the copies. Until then, treat
 * this file as the source of truth and port changes deliberately.
 *
 * ── WHY THE MAIN PROCESS, NOT THE RENDERER ──────────────────────────────────
 *
 * 🔴 A renderer check is a suggestion. DevTools is one keystroke away in an
 * Electron app, and anything the renderer decides can be re-decided by whoever
 * is looking at it. The main process is not a security boundary against a
 * determined attacker either — see the honesty note at the bottom — but it is
 * the boundary against the case that actually happens: a copied installer passed
 * to a colleague.
 *
 * ── THE RULE IMPLEMENTATIONS GET WRONG ──────────────────────────────────────
 *
 * 🔴 FAIL OPEN ON A NETWORK ERROR. FAIL CLOSED ON AN EXPLICIT REFUSAL.
 *
 * "I could not reach the server" and "the server said no" are different facts.
 * Conflating them punishes someone on a train for something they did not do, and
 * it is the single most common way licence enforcement becomes a support queue.
 * A timeout is not a refusal.
 */

export type LicenceState =
  | 'licensed'          // entitled, verified or within grace
  | 'unlicensed'        // the server explicitly said no
  | 'expired-offline'   // grace ran out and we still cannot reach the server
  | 'update-required';  // this build is below the supported floor (HTTP 426)

export interface Licence {
  state: LicenceState;
  plan: string | null;
  /** Where the entitlement came from — 'personal' or 'workspace'. Shown to the
   *  person, because "you have this via the Acme workspace" is the difference
   *  between a support ticket and a self-serve answer. */
  source: string | null;
  checkedAt: number;
  /** Set when state is 'update-required'. */
  minSupported?: string;
  message?: string;
}

export interface LicenceOptions {
  /** Product slug — must match the platform's registry (hub, pixel, motion…). */
  product: string;
  /** This build's version, from package.json / app.getVersion(). */
  version: string;
  apiBase?: string;
  /** Returns the account access token, or null when signed out. */
  getToken: () => Promise<string | null> | string | null;
  /** Read/write the cached last-good answer. Persist across restarts. */
  readCache: () => Promise<Licence | null> | Licence | null;
  writeCache: (l: Licence) => Promise<void> | void;
  /** Called whenever the state changes, so the UI can react. */
  onChange?: (l: Licence) => void;
  /**
   * How long a verified licence survives with no contact.
   *
   * 14 days, and the reasoning matters: a laptop on a long trip, a contractor
   * on a locked-down network, a person whose ISP is down for a week. Shorter
   * looks tidier and turns ordinary life into a support ticket. Longer stops
   * being enforcement.
   */
  graceMs?: number;
  /** How often to re-verify while running. */
  intervalMs?: number;
}

const DAY = 86_400_000;
const DEFAULT_GRACE = 14 * DAY;
const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000; // 6h
const TIMEOUT_MS = 10_000;

/**
 * One check. Never throws — a licence check that can crash the app it protects
 * has inverted the relationship.
 */
export async function checkLicence(opts: LicenceOptions): Promise<Licence> {
  const base = opts.apiBase || 'https://api.xenostudio.ai';
  const grace = opts.graceMs ?? DEFAULT_GRACE;

  /* This function promises never to throw (see the header), and reading the cache is the FIRST
   * thing it does — so a readCache that rejects escaped the promise entirely. That is not a
   * hypothetical: a product's cache callback touches the disk, and a full volume, a locked file
   * or a permissions change all reject. The caller is `startLicence`, which does
   * `void checkLicence(opts)`, so the failure surfaces as an unhandled rejection rather than
   * anything actionable.
   *
   * A cache we cannot read is "we know nothing", which is exactly what `null` already means. */
  let cached: Licence | null = null;
  try {
    cached = (await opts.readCache()) || null;
  } catch { cached = null; }

  const withinGrace = (c: Licence | null) =>
    Boolean(c && c.state === 'licensed' && Date.now() - c.checkedAt < grace);

  let token: string | null = null;
  try {
    token = await opts.getToken();
  } catch { token = null; }

  if (!token) {
    /* Signed out is not the same as unlicensed, but there is nothing to verify.
     * Grace still applies: someone who signed out on a plane has not stopped
     * paying. */
    return withinGrace(cached)
      ? { ...(cached as Licence), state: 'licensed' }
      : { state: 'unlicensed', plan: null, source: null, checkedAt: Date.now() };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/billing/entitlements`, {
      headers: {
        Authorization: `Bearer ${token}`,
        /* 🔴 Identify explicitly. The platform can also read the User-Agent —
         * which is what lets it bind builds that predate this file — but an
         * explicit header is unambiguous and survives a UA change. */
        'X-Xeno-Client': `${opts.product}/${opts.version}`,
      },
      signal: ctrl.signal,
    });

    if (res.status === 426) {
      /* This build is below the supported floor. Distinct from unlicensed: the
       * person may be paying perfectly well and simply needs to update, and
       * telling them their licence is invalid would be a lie. */
      const body = await res.json().catch(() => ({} as any));
      const l: Licence = {
        state: 'update-required',
        plan: cached?.plan ?? null,
        source: cached?.source ?? null,
        checkedAt: Date.now(),
        minSupported: body?.error?.minSupported,
        message: body?.error?.message,
      };
      opts.onChange?.(l);
      return l;
    }

    if (res.status === 401 || res.status === 403) {
      /* 🔴 An EXPLICIT refusal. Fail closed — no grace, because grace exists for
       * uncertainty and there is none here. The server was reached and answered. */
      const l: Licence = { state: 'unlicensed', plan: null, source: null, checkedAt: Date.now() };
      /* Persisting is best-effort. A failed write must not turn an explicit refusal into the
       * outer catch's network-error path, which would hand back 'licensed' from grace — the
       * exact inversion this function exists to prevent. */
      try { await opts.writeCache(l); } catch { /* best-effort */ }
      opts.onChange?.(l);
      return l;
    }

    if (!res.ok) {
      /* 5xx is OUR fault. Treat it exactly like a network error — never punish a
       * customer for our outage. */
      return withinGrace(cached)
        ? (cached as Licence)
        : { state: cached ? 'expired-offline' : 'unlicensed', plan: cached?.plan ?? null, source: null, checkedAt: cached?.checkedAt ?? Date.now() };
    }

    const data = await res.json();
    const canUse = Boolean(data?.entitlements?.canUse);
    const l: Licence = {
      state: canUse ? 'licensed' : 'unlicensed',
      plan: data?.plan ?? null,
      source: data?.source ?? null,
      checkedAt: Date.now(),
    };
    try { await opts.writeCache(l); } catch { /* best-effort; grace simply will not apply */ }
    opts.onChange?.(l);
    return l;
  } catch {
    /* 🔴 Network error, DNS failure, timeout, captive portal, aeroplane. We do
     * not know anything new, so we do not change our mind. */
    const l: Licence = withinGrace(cached)
      ? (cached as Licence)
      : { state: cached ? 'expired-offline' : 'unlicensed', plan: cached?.plan ?? null, source: null, checkedAt: cached?.checkedAt ?? Date.now() };
    opts.onChange?.(l);
    return l;
  } finally {
    clearTimeout(t);
  }
}

/** Check at boot and on a schedule. Returns a stop function. */
export function startLicence(opts: LicenceOptions): () => void {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    void checkLicence(opts);
  };

  tick();
  const h = setInterval(tick, interval);
  /* Never hold the process open on account of a licence timer. */
  if (typeof (h as any).unref === 'function') (h as any).unref();

  return () => { stopped = true; clearInterval(h); };
}

/**
 * ── WHAT THIS DOES NOT DO, STATED PLAINLY ───────────────────────────────────
 *
 * It stops CASUAL copying: an installer handed to a colleague will not run for
 * them. That is the case that actually happens, and it is worth closing.
 *
 * 🔴 It does NOT stop a determined attacker patching the binary or editing the
 * cache file, and no client-side control ever has. The cache is an offline
 * affordance, not a security boundary — signing it would raise the effort
 * slightly and change nothing about the outcome, so this file does not pretend
 * otherwise.
 *
 * The durable protection is architectural and already true: cloud sync, the
 * cross-app agent, hosted inference and collaboration are not IN the binary, so
 * they cannot be cracked out of it. A patched build is a local editor with no
 * platform — which is precisely the free tier it was trying to escape.
 */
