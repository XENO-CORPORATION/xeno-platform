/**
 * Human-facing authentication route contract.
 *
 * Protocol endpoints stay under /api/oauth2/*. These helpers cover only the
 * browser UI and its same-origin hand-back after authentication.
 */

export const LOGIN_PATH = '/login';
export const SIGNUP_PATH = '/signup';

const RETURN_KEYS = ['returnUrl', 'returnTo', 'redirect'];
const BASE_ORIGIN = 'https://xenostudio.ai';

/** Same-origin relative URL guard. Refuses scheme-relative and backslash forms. */
export function safeReturnUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value, BASE_ORIGIN);
    if (parsed.origin !== BASE_ORIGIN) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** Read the canonical return target, accepting old query names at the edge. */
export function authReturnUrl(search) {
  const params = new URLSearchParams(search || '');
  for (const key of RETURN_KEYS) {
    const value = safeReturnUrl(params.get(key));
    if (value) return value;
  }
  return null;
}

export function normalizeClientId(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,127}$/.test(value) ? value : null;
}

/** The app being authorized is derived from the authorize URL we resume. */
export function clientIdFromReturnUrl(raw) {
  const value = safeReturnUrl(raw);
  if (!value) return null;
  try {
    const parsed = new URL(value, BASE_ORIGIN);
    if (parsed.pathname !== '/api/oauth2/authorize') return null;
    return normalizeClientId(parsed.searchParams.get('client_id'));
  } catch {
    return null;
  }
}

/** Compatibility mapping for old /auth/:app links that do not carry OIDC. */
export function legacyAppClientId(app) {
  if (typeof app !== 'string') return null;
  const slug = app.trim().toLowerCase().replace(/^xeno-/, '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) return null;
  if (slug === 'cli' || slug === 'agent-cli') return 'xeno-agent-cli';
  if (slug === 'app') return null;
  return `xeno-${slug}`;
}

/**
 * Client presentation follows the authorize transaction first. An explicit
 * client_id is only a compatibility/display hint when no grant is being resumed.
 */
export function authClientId(search, legacyApp) {
  const params = new URLSearchParams(search || '');
  const fromGrant = clientIdFromReturnUrl(authReturnUrl(search));
  return fromGrant
    || normalizeClientId(params.get('client_id'))
    || legacyAppClientId(legacyApp);
}

/** Canonicalize old query names without dropping unrelated state/error fields. */
export function canonicalAuthSearch(search, legacyApp) {
  const params = new URLSearchParams(search || '');
  const returnUrl = authReturnUrl(search);
  params.delete('returnTo');
  params.delete('redirect');
  if (returnUrl) params.set('returnUrl', returnUrl);
  else params.delete('returnUrl');

  const fromGrant = clientIdFromReturnUrl(returnUrl);
  if (fromGrant) {
    // Never let a separately supplied display id disagree with the actual grant.
    params.delete('client_id');
  } else if (!normalizeClientId(params.get('client_id'))) {
    params.delete('client_id');
    const fallback = legacyAppClientId(legacyApp);
    if (fallback) params.set('client_id', fallback);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function authPath(mode, search = '', legacyApp) {
  const path = mode === 'signup' ? SIGNUP_PATH : LOGIN_PATH;
  return `${path}${canonicalAuthSearch(search, legacyApp)}`;
}

export function locationReturnPath(location, fallback = '/overview') {
  if (!location || typeof location.pathname !== 'string') return fallback;
  return safeReturnUrl(`${location.pathname}${location.search || ''}${location.hash || ''}`) || fallback;
}
