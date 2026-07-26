/**
 * hosts.ts — the ONE source of truth for every XENO hostname the FRONTEND
 * bundle links to or fetches from.
 *
 * The backend twin is `src/server/config/hosts.js`. Keep the two in step.
 *
 * WHY THE THREE-LAYER LOOKUP MATTERS
 * ----------------------------------
 * `import.meta.env.VITE_*` is substituted at BUILD time. A Vite constant
 * therefore cannot serve two domains from one artifact — you would have to build
 * and deploy the bundle twice, once per host. That defeats the point of a seam.
 *
 * `public/env-config.js` sets `window._env_` and is loaded unconditionally by
 * `index.html` (line 110). It is a plain static file, so it can be rewritten
 * per-deployment — or per-host — WITHOUT rebuilding. It exists in the repo today
 * and is currently empty. This module makes it load-bearing.
 *
 * Resolution order, highest first:
 *   1. `window._env_.XENO_*`        — runtime, per-deploy, no rebuild required
 *   2. `import.meta.env.VITE_XENO_*` — build-time
 *   3. the frozen default            — xenostudio.ai
 *
 * With neither set, every accessor returns exactly the literal it replaced. The
 * change is a runtime no-op today; see `src/server/tests/hosts.test.mjs` for the
 * assertion of the shared default set.
 *
 * DUAL-HOMING NOTE
 * ----------------
 * `xenosystem.ai` is not configured anywhere and must not be: it has no DNS for
 * `api.` / `updates.` / `registry.` and no reachable origin. See
 * `XENO DOMAIN MIGRATION - AUDIT.md`. This module only makes the eventual flip a
 * config change.
 */

// ── Frozen legacy defaults (the literals this module replaced) ──────────────
export const DEFAULT_SITE_ORIGIN = 'https://xenostudio.ai';
export const DEFAULT_API_ORIGIN = 'https://api.xenostudio.ai';
export const DEFAULT_UPDATES_ORIGIN = 'https://updates.xenostudio.ai';

/** Hostnames the site-gate treats as "the canonical marketing site". */
export const DEFAULT_SITE_HOSTNAMES = ['xenostudio.ai', 'www.xenostudio.ai'] as const;

type RuntimeEnv = Record<string, string | undefined>;

declare global {
  interface Window {
    _env_?: RuntimeEnv;
  }
}

function runtimeEnv(): RuntimeEnv {
  if (typeof window === 'undefined') return {};
  return window._env_ ?? {};
}

function buildEnv(): RuntimeEnv {
  try {
    return (import.meta.env ?? {}) as unknown as RuntimeEnv;
  } catch {
    return {};
  }
}

function normalize(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

/**
 * Resolve one host value: runtime `window._env_` → build-time `VITE_` → default.
 *
 * @param key bare name, e.g. `SITE_ORIGIN`. Looked up as `window._env_.XENO_SITE_ORIGIN`
 *            then `import.meta.env.VITE_XENO_SITE_ORIGIN`.
 */
function resolve(key: string, fallback: string): string {
  const fromRuntime = normalize(runtimeEnv()[`XENO_${key}`]);
  if (fromRuntime) return fromRuntime;
  const fromBuild = normalize(buildEnv()[`VITE_XENO_${key}`]);
  if (fromBuild) return fromBuild;
  return fallback;
}

/** The canonical public site origin. */
export const SITE_ORIGIN = resolve('SITE_ORIGIN', DEFAULT_SITE_ORIGIN);

/** The inference + credit gateway origin (`api.`). */
export const API_ORIGIN = resolve('API_ORIGIN', DEFAULT_API_ORIGIN);

/** The OpenAI-compatible base the browser talks to. */
export const API_BASE_URL = `${API_ORIGIN}/v1`;

/** The R2-backed release/update feed origin (`updates.`). */
export const UPDATES_ORIGIN = resolve('UPDATES_ORIGIN', DEFAULT_UPDATES_ORIGIN);

/**
 * Hostnames that count as "this site" — used by the site gate and by anything
 * else that must not lock out a legitimate alias host.
 *
 * Override with `XENO_SITE_HOSTNAMES` (comma-separated) to admit a second
 * domain. If it is NOT overridden, the list is derived from SITE_ORIGIN plus its
 * `www.` twin, which reproduces today's hardcoded pair exactly.
 */
export const SITE_HOSTNAMES: readonly string[] = (() => {
  const explicit = resolve('SITE_HOSTNAMES', '');
  if (explicit) {
    return explicit
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  try {
    const host = new URL(SITE_ORIGIN).host.toLowerCase();
    const bare = host.replace(/^www\./, '');
    return [bare, `www.${bare}`];
  } catch {
    return [...DEFAULT_SITE_HOSTNAMES];
  }
})();

/** Absolute URL on the canonical site origin. */
export function siteUrl(pathname: string): string {
  return `${SITE_ORIGIN}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/** Absolute URL on the release/update feed origin. */
export function updatesUrl(pathname: string): string {
  return `${UPDATES_ORIGIN}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}
