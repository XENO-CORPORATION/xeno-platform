/**
 * Which /api/ paths the global per-IP limiter (index.js, 200/min) must NOT count.
 *
 * 🔴 /api/site-gate/check is nginx's `auth_request` for EVERY page while SITE_GATE=on. nginx turns any answer
 * other than 2xx/401/403 into a 500, so when the check itself was rate-limited the whole site showed nginx's
 * "500 Internal Server Error" — found on 2026-10-23 by a signed-in test account after four workspace page loads,
 * because the same IP's own API calls had used the minute's budget. The check is a signature verify (plus one
 * indexed row read for a personal code); the attempts that need limiting are on POST /unlock, which keeps its own.
 *
 * The paths are FULL paths: the limiter is mounted on '/api/', where req.path has '/api' stripped, which is why
 * the health-check skip below never matched before.
 */
const SKIP = new Set([
  '/api/status', '/api/site-gate/check',
  // 🔴 OIDC (2026-10-27, measured by the CLI session): one busy client on a network spent the shared 200/min, and the
  // next jwks or token call answered 429, so every XENO app behind that IP read as "not signed in" right after a good
  // refresh. Keys and discovery are public and cached (Cache-Control in oauth2Routes.js); the token endpoint has its
  // OWN limiter below, which counts only failures, so it never loses to unrelated traffic.
  '/api/oauth2/jwks',
  '/api/oauth2/openid-configuration',
  '/api/oauth2/.well-known/openid-configuration',
  '/api/oauth2/.well-known/oauth-authorization-server',
  '/api/oauth2/token',
]);

export function globalLimiterSkips(fullPath) {
  return SKIP.has(String(fullPath || '').replace(/\/+$/, '')) || fullPath === '/health';
}

/**
 * The token endpoint's own limiter (express-rate-limit options): keyed by client IP + client_id, and only FAILED
 * exchanges count. A refresh that succeeds is never what signs a person out; a guessing attacker fails.
 */
export function oauthTokenLimiterOptions(keyOf) {
  return {
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${keyOf(req)}|${String(req.body?.client_id || '').slice(0, 128)}`,
    message: { error: 'slow_down', error_description: 'Too many failed token requests, try again shortly.' },
  };
}
