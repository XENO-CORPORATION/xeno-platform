/**
 * hosts.js — the ONE source of truth for every XENO hostname the backend emits,
 * accepts, or links to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, the backend carried ~13 independent copies of the same
 * hostname, each behind its own env var with its own inline literal fallback
 * (`OIDC_ISSUER`, `AUTH_FRONTEND_URL`, `APP_BASE_URL`, `FRONTEND_URL`,
 * `WEB_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL`, `BILLING_APP_URL`,
 * `XENO_UPDATES_BASE`, `R2_PUBLIC_URL`, `GOOGLE_/GITHUB_/TWITTER_CALLBACK_URL`,
 * `MAIL_PRIMARY_DOMAIN`) — plus several call sites with no env var at all.
 * Moving the platform to a second domain therefore meant finding and flipping
 * every one of them, in lockstep, by hand. That is the failure mode this module
 * removes: from here on the domain is a deployment input, not a code edit.
 *
 * PRECEDENCE (deliberate, and the reason this is a runtime no-op)
 * --------------------------------------------------------------
 *   1. The call site's own pre-existing, specific env var  (unchanged, still wins)
 *   2. The generic override introduced here                (XENO_SITE_ORIGIN, …)
 *   3. The frozen literal default below                    (xenostudio.ai)
 *
 * With no env set, every accessor returns exactly the string that was hardcoded
 * at the call site before this module existed. With the legacy specific vars set,
 * they still win, unchanged. Nothing about today's behaviour moves.
 * See `src/server/tests/hosts.test.mjs` — it asserts both halves.
 *
 * DUAL-HOMING
 * -----------
 * `xenosystem.ai` is NOT configured here and must not be. It has no DNS for
 * `api.`/`updates.`/`registry.` and no reachable origin (see
 * `XENO DOMAIN MIGRATION - AUDIT.md`). This module only makes the eventual flip
 * a config change. Until an operator stands the domain up, the correct value of
 * every override is "unset".
 *
 * When the time comes, the intended shape is:
 *   - Keep serving BOTH: leave XENO_SITE_ORIGIN alone and add the new host to
 *     XENO_ALIAS_SITE_ORIGINS / XENO_ALIAS_API_ORIGINS. Nothing that is minted
 *     changes; the server merely starts *accepting* the new host too.
 *   - Only once every client is rebuilt does XENO_SITE_ORIGIN itself move.
 *   - The old hosts stay in the ALIAS lists permanently. This is an addition,
 *     never a cutover.
 *
 * @module server/config/hosts
 */

// ── Frozen legacy defaults ──────────────────────────────────────────────────
// These are the literals this module replaced. They are the contract: changing
// one of these constants changes production behaviour with no deploy-time
// signal, which is exactly what the env overrides exist to avoid. Do not edit
// them to perform a migration — set the env vars instead.

/** Canonical public site / OIDC issuer origin. */
export const DEFAULT_SITE_ORIGIN = 'https://xenostudio.ai';
/** Inference + credit gateway (`xeno-private-api-001`, PM2 `xeno-api-proxy`). */
export const DEFAULT_API_ORIGIN = 'https://api.xenostudio.ai';
/** R2 public custom domain for the release/update feed (bucket `xeno-hub-releases`). */
export const DEFAULT_UPDATES_ORIGIN = 'https://updates.xenostudio.ai';
/**
 * Mail / handle domain. Deliberately a SEPARATE constant, not derived from
 * DEFAULT_SITE_ORIGIN: `handle@domain` is persisted into `users.email`
 * (`authRoutes.js`) and the gateway resolves users by email, so moving it is a
 * data migration with an alias-domain login step — not a config flip. It must
 * stay pinned even when the site origin moves.
 */
export const DEFAULT_MAIL_DOMAIN = 'xenostudio.ai';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Trim whitespace and any trailing slashes. Mirrors the old inline `.replace(/\/+$/, '')`. */
function normalize(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

/** First non-empty normalized value. */
function firstSet(...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return '';
}

/** Split a comma/whitespace separated origin list into normalized entries. */
function splitOrigins(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(normalize)
    .filter(Boolean);
}

/** Unique, order-preserving. */
function unique(list) {
  return [...new Set(list)];
}

// ── canonical origins ───────────────────────────────────────────────────────

/**
 * The canonical public site origin. This is what gets MINTED into tokens,
 * emails, redirect URLs and links. Changing it is the semantic flip; prefer
 * widening the alias lists first.
 */
export function siteOrigin() {
  return firstSet(process.env.XENO_SITE_ORIGIN, DEFAULT_SITE_ORIGIN);
}

/** Hostname only (no scheme), e.g. `xenostudio.ai`. */
export function siteHost() {
  try {
    return new URL(siteOrigin()).host;
  } catch {
    return siteOrigin().replace(/^https?:\/\//, '');
  }
}

/** The inference + credit gateway origin the frontend and server proxy to. */
export function apiOrigin() {
  return firstSet(process.env.XENO_API_ORIGIN, DEFAULT_API_ORIGIN);
}

/** The R2-backed release/update feed origin. */
export function updatesOrigin() {
  return firstSet(process.env.XENO_UPDATES_ORIGIN, DEFAULT_UPDATES_ORIGIN);
}

/**
 * The mail / handle domain (bare host, no scheme). Pinned independently of
 * `siteOrigin()` — see DEFAULT_MAIL_DOMAIN.
 */
export function mailDomain() {
  return firstSet(process.env.MAIL_PRIMARY_DOMAIN, DEFAULT_MAIL_DOMAIN).toLowerCase();
}

/**
 * The OIDC issuer (`iss`). Kept as its own accessor because it is the single
 * highest-blast-radius string in the ecosystem: it is embedded in every
 * `id_token`, `logout_token` and access token, and it is the identifier clients
 * pin their discovery document to.
 *
 * ⚠️ An OIDC issuer is NOT dual-homeable. OpenID Connect Core §3.1.3.7 requires
 * a client to compare `iss` for EXACT equality with the issuer it discovered,
 * and RFC 8414 §3.3 requires the discovery document's `issuer` to exactly match
 * the URL it was fetched from. Serving two issuer values from one provider means
 * every relying party must be told which one it will get, in advance. Widening
 * an allowlist does not help here the way it does for CORS or redirect URIs.
 * Treat this as a one-way, coordinated flip — never as an "add the new host too".
 */
export function issuer() {
  return firstSet(process.env.OIDC_ISSUER, siteOrigin());
}

// ── accepted (dual-home) origin sets ────────────────────────────────────────
// Everything below is an ALLOWLIST, not an identity. Widening these is safe and
// individually revertible: the server starts accepting an additional host
// without changing anything it mints.

/**
 * Additional site origins to ACCEPT (CORS, redirect allowlists) without making
 * any of them canonical. Set `XENO_ALIAS_SITE_ORIGINS` to a comma-separated
 * list. Empty by default.
 */
export function aliasSiteOrigins() {
  return splitOrigins(process.env.XENO_ALIAS_SITE_ORIGINS);
}

/**
 * Browser-extension origins allowed to call this API. Empty by default.
 *
 * An extension origin is `chrome-extension://<id>`, and the id is NOT a constant
 * we can hardcode:
 *   · unpacked dev load — Chrome derives the id from the FILESYSTEM PATH, so it
 *     differs per machine and per checkout;
 *   · Web Store build  — derived from the signing key: stable, but unknowable
 *     until the item is created.
 * So this is operator configuration (XENO_EXTENSION_ORIGINS), never a literal.
 *
 * 🔴 Deliberately NOT a `chrome-extension://*` wildcard. The CORS layer runs with
 * `credentials: true`, so accepting every extension origin would let ANY
 * extension the user has installed make credentialed requests to this API.
 * List the ids you mean.
 */
export function extensionOrigins() {
  return splitOrigins(process.env.XENO_EXTENSION_ORIGINS);
}

/** Additional API gateway origins to accept. Empty by default. */
export function aliasApiOrigins() {
  return splitOrigins(process.env.XENO_API_ORIGINS_EXTRA);
}

/**
 * The canonical site origin plus its `www.` twin — the pair that has always
 * been in the CORS default.
 */
export function canonicalSiteOrigins() {
  const origin = siteOrigin();
  const out = [origin];
  try {
    const url = new URL(origin);
    if (!url.host.startsWith('www.')) {
      out.push(`${url.protocol}//www.${url.host}`);
    }
  } catch {
    /* non-URL override: caller gets just what they set */
  }
  return unique(out);
}

/**
 * Every site origin the server should ACCEPT: canonical + `www.` + any aliases.
 * This is the list to widen when standing up a second domain.
 */
export function acceptedSiteOrigins() {
  return unique([...canonicalSiteOrigins(), ...aliasSiteOrigins()]);
}

/** Every API gateway origin the server should accept. */
export function acceptedApiOrigins() {
  return unique([apiOrigin(), ...aliasApiOrigins()]);
}

/**
 * Origins valid as OAuth redirect targets: the canonical site origin plus any
 * explicit aliases — and deliberately NOT the implicit `www.` twin.
 *
 * OAuth redirect URIs are matched by EXACT string (RFC 6749 §3.1.2.3; the
 * loopback port-flex carve-out in RFC 8252 applies only to `loopback: true`
 * clients). Silently synthesising a `www.` entry would widen an OAuth allowlist
 * as a side effect of a refactor, which is the one category of "helpful default"
 * that must never be automatic. If `www.` is a real callback host, list it in
 * XENO_ALIAS_SITE_ORIGINS on purpose.
 */
export function redirectOrigins() {
  return unique([siteOrigin(), ...aliasSiteOrigins()]);
}

/**
 * Build the same absolute URL against every accepted redirect origin. Use for
 * redirect-URI allowlists, where accepting both hosts is strictly safer than
 * switching between them.
 *
 * With no env set this returns a single-element array identical to the literal
 * it replaced.
 *
 * @param {string} pathname absolute path, e.g. `/auth/callback`
 * @returns {string[]}
 */
export function siteUrlVariants(pathname) {
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return unique(redirectOrigins().map((origin) => `${origin}${suffix}`));
}

/** One absolute URL on the canonical site origin. */
export function siteUrl(pathname) {
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${siteOrigin()}${suffix}`;
}

/** One absolute URL on the updates feed origin. */
export function updatesUrl(pathname) {
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${updatesOrigin()}${suffix}`;
}

export default {
  DEFAULT_SITE_ORIGIN,
  DEFAULT_API_ORIGIN,
  DEFAULT_UPDATES_ORIGIN,
  DEFAULT_MAIL_DOMAIN,
  siteOrigin,
  siteHost,
  apiOrigin,
  updatesOrigin,
  mailDomain,
  issuer,
  aliasSiteOrigins,
  aliasApiOrigins,
  canonicalSiteOrigins,
  acceptedSiteOrigins,
  extensionOrigins,
  acceptedApiOrigins,
  siteUrlVariants,
  siteUrl,
  updatesUrl,
};
