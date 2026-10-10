/**
 * OAuth landing resolver — lives HERE, not in src/lib, because
 * Dockerfile.backend only COPYs src/server/. An import of ../../lib from
 * routes/authRoutes.js resolves to /lib inside the image and the process
 * never listens. 26e05cd failed /api/ready for exactly that reason.
 *
 * The website copy in src/lib/onboardingHandoff.js must keep the same
 * resolveOAuthLandingPath body. scripts/onboarding-funnel.test.mjs pins it.
 */

export const ONBOARDING_PATH = '/onboarding';

export function resolveOAuthLandingPath(returnUrl, isNew) {
  const dest = typeof returnUrl === 'string' && returnUrl.trim()
    ? returnUrl.trim()
    : '/workspace';
  if (!isNew) return dest;
  if (dest.startsWith('xeno://')) return dest;
  if (dest.startsWith('/cli-auth')) return dest;
  if (dest.startsWith('/api/oauth2/')) return dest;
  // the signed-in home (the workspace; /overview is its old address) sends a new account to onboarding first
  if (dest === '/workspace' || dest === '/workspace/' || dest === '/overview' || dest === '/overview/' || dest === '/') return ONBOARDING_PATH;
  return dest;
}
