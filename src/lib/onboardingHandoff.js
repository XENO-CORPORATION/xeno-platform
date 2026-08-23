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
