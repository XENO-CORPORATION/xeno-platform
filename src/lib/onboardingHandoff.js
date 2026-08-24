/**
 * Account-funnel handoff — website + portal client.
 *
 * ⚠️ resolveOAuthLandingPath is DUPLICATED in src/server/lib/onboardingHandoff.js.
 * Dockerfile.backend only COPYs src/server/, so the backend cannot import this
 * file. Change the function in both places; the funnel test compares them.
 */

export const AUTH_TOKEN_KEY = 'xenoos_auth_token';
export const ONBOARDING_PATH = '/onboarding';
export const ONBOARDING_DONE_KEY = 'xeno_onboarding_done';
export const ONBOARDING_NEXT_KEY = 'xeno_onboarding_next';
export const RETURN_URL_KEY = 'xeno_return_url';

/**
 * Where an OAuth callback should land.
 *
 * Website defaults (`/overview`, `/`) send a NEW account to onboarding.
 * Deep links and authorize/cli sessions stay on the path they asked for —
 * interrupting those mid-grant is how you break Hub and the CLI.
 */
export function resolveOAuthLandingPath(returnUrl, isNew) {
  const dest = typeof returnUrl === 'string' && returnUrl.trim()
    ? returnUrl.trim()
    : '/overview';
  if (!isNew) return dest;
  if (dest.startsWith('xeno://')) return dest;
  if (dest.startsWith('/cli-auth')) return dest;
  if (dest.startsWith('/api/oauth2/')) return dest;
  if (dest === '/overview' || dest === '/overview/' || dest === '/') return ONBOARDING_PATH;
  return dest;
}

/**
 * Post-onboarding return. Same-origin paths, or the API portal.
 * Anything else is an open redirect and is refused.
 */
export function isAllowedOnboardingNext(next) {
  if (typeof next !== 'string' || !next) return false;
  const v = next.trim();
  if (v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) return true;
  try {
    const u = new URL(v);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:' && u.hostname === 'api.xenostudio.ai') return true;
    if (
      u.protocol === 'http:'
      && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    ) return true;
    return false;
  } catch {
    return false;
  }
}

/** Allowed `next`, or null. Removes the key so a later leave cannot reuse it. */
export function consumeOnboardingNext() {
  if (typeof sessionStorage === 'undefined') return null;
  const next = sessionStorage.getItem(ONBOARDING_NEXT_KEY);
  if (!isAllowedOnboardingNext(next)) return null;
  sessionStorage.removeItem(ONBOARDING_NEXT_KEY);
  return next;
}

export function destinationAfterOnboarding(fallback = '/overview') {
  return consumeOnboardingNext() || fallback;
}

export function isExternalOnboardingNext(next) {
  return typeof next === 'string' && /^https?:\/\//.test(next);
}

/**
 * Same-origin path only. The authorize URL is `/api/oauth2/authorize?…` —
 * a leading `/` that is not `//`. Anything else is an open redirect.
 */
export function isStashableReturnUrl(raw) {
  return typeof raw === 'string'
    && raw.startsWith('/')
    && !raw.startsWith('//')
    && !raw.includes('\\');
}

/**
 * Privileged grants must survive activation. Website defaults must not —
 * a new account with returnUrl=/overview still has to see /onboarding.
 * Keep this list in lockstep with resolveOAuthLandingPath.
 */
export function isPrivilegedReturnUrl(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  const v = raw.trim();
  return v.startsWith('xeno://')
    || v.startsWith('/cli-auth')
    || v.startsWith('/api/oauth2/');
}

export function stashReturnUrl(raw) {
  if (typeof sessionStorage === 'undefined') return;
  if (!isStashableReturnUrl(raw)) return;
  sessionStorage.setItem(RETURN_URL_KEY, raw);
}

export function peekReturnUrl() {
  if (typeof sessionStorage === 'undefined') return null;
  const v = sessionStorage.getItem(RETURN_URL_KEY);
  return isStashableReturnUrl(v) ? v : null;
}

export function consumeReturnUrl() {
  const v = peekReturnUrl();
  if (v && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(RETURN_URL_KEY);
  }
  return v;
}

/**
 * Where Activate "Continue" goes.
 *
 * A pending OIDC/CLI/Hub grant resumes. Anything else — including a
 * stashed `/overview` — is onboarding. Consuming happens only when
 * the grant is actually the destination, so a later leave cannot
 * reuse a leftover key.
 */
export function resolveActivationContinue(pending) {
  return isPrivilegedReturnUrl(pending) ? pending : ONBOARDING_PATH;
}

export function destinationAfterActivation() {
  const pending = peekReturnUrl();
  const dest = resolveActivationContinue(pending);
  if (dest === pending) consumeReturnUrl();
  return dest;
}

export function isFullPageActivationDest(dest) {
  return isPrivilegedReturnUrl(dest);
}
