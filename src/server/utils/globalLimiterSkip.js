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
const SKIP = new Set(['/api/status', '/api/site-gate/check']);

export function globalLimiterSkips(fullPath) {
  return SKIP.has(String(fullPath || '').replace(/\/+$/, '')) || fullPath === '/health';
}
