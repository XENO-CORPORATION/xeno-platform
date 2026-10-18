/**
 * The site gate (owner, 2026-10-18): with SITE_GATE=on, xenostudio.ai / xenosystem.ai show their pages ONLY to people
 * with access, and everyone else gets the "Coming soon" page. nginx asks here before serving a page
 * (`auth_request /__site_gate`, nginx/default.conf); 204 = show it, 401 = show Coming soon.
 *
 * TWO ways in, and only two:
 *   1. An ACCESS CODE — one shared code, typed on the Coming soon page (POST /unlock). It sets a signed, HttpOnly
 *      cookie that the check accepts, so a person with the code sees the site without an account. The code is a
 *      bearer secret: constant-time compare, per-address attempt limit, bounded cookie life, and rotating
 *      SITE_GATE_CODE invalidates every cookie already issued (the code's digest is inside the signature).
 *   2. A signed-in website session (browserSessionMiddleware) on an ACTIVE account that is an admin or matches
 *      SITE_GATE_ALLOW. Signed in alone is NOT access: signup is open, so anyone can make an account.
 *      SITE_GATE_ALLOW is a comma list of full emails and/or "@domain" entries.
 *
 * 🔴 The code and the cookie open PAGES ONLY. They are not an auth token: /api/ still requires a real account, so
 * the gate can never widen API authority. OAuth, update downloads and the install script are not routed through the
 * check at all, so installed apps keep working whether the gate is on or off.
 *
 * Off (unset, or anything but "on") answers 204 for everyone, so the flag is the whole switch.
 */
import express from 'express';
import { clientIp } from '../utils/clientIp.js';
import { codeMatches, GATE_DAYS, gateCookieName, gateCookieValid, mintGateCookie, readCookie } from '../utils/siteGateCode.js';

// The cookie's signature lives in utils/siteGateCode.js because the registration gate needs the very same one:
// a valid access-code cookie is what lets an invited person create an account. Re-exported here so callers and
// tests keep one import.
export { codeMatches, gateCookieName, gateCookieValid, mintGateCookie };

export function parseAllow(value = '') {
  return String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Pure decision, so the rules are testable without a database. */
export function hasSiteAccess(user, allow) {
  if (!user || user.is_active === false || String(user.status || '').toLowerCase() === 'suspended') return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const email = String(user.email || '').toLowerCase();
  if (!email.includes('@')) return false;
  const domain = email.slice(email.lastIndexOf('@'));
  return allow.some((a) => (a.startsWith('@') ? a === domain : a === email));
}

/** A tiny fixed-window attempt counter, keyed by client address. Exported so a test can prove it refuses. */
export function createAttemptLimiter({ max = 10, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function take(key) {
    const t = now();
    const row = hits.get(key);
    if (!row || row.reset <= t) { hits.set(key, { count: 1, reset: t + windowMs }); return true; }
    row.count += 1;
    return row.count <= max;
  };
}

export function createSiteGateRouter({ env = process.env, attempt = createAttemptLimiter() } = {}) {
  const router = express.Router();
  const secret = env.SITE_GATE_SECRET || env.JWT_SECRET;
  const code = String(env.SITE_GATE_CODE || '');

  router.get('/check', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (env.SITE_GATE !== 'on') return res.status(204).end();
    if (gateCookieValid(readCookie(req.headers.cookie, gateCookieName(env)), code, secret)) return res.status(204).end();
    const userId = req.browserSession?.userId;
    if (!userId) return res.status(401).end();
    try {
      const { rows } = await req.db.query('SELECT email, role, is_active, status FROM users WHERE id = $1', [userId]);
      return res.status(hasSiteAccess(rows[0], parseAllow(env.SITE_GATE_ALLOW)) ? 204 : 401).end();
    } catch (e) {
      // Fail CLOSED: an error must never open the site.
      console.error('[site-gate]', e.message);
      return res.status(401).end();
    }
  });

  router.post('/unlock', (req, res) => {
    res.set('cache-control', 'no-store');
    if (env.SITE_GATE !== 'on') return res.status(204).end();          // nothing to unlock
    if (!code) return res.status(404).json({ error: 'no_access_code' }); // configured off: do not pretend
    if (!attempt(clientIp(req) || 'unknown')) return res.status(429).json({ error: 'too_many_attempts' });
    if (!codeMatches((req.body || {}).code, code)) return res.status(401).json({ error: 'invalid_code' });
    const value = mintGateCookie(code, secret);
    if (!value) return res.status(404).json({ error: 'no_access_code' });
    res.cookie(gateCookieName(env), value, {
      httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      maxAge: GATE_DAYS * 86400 * 1000,
    });
    return res.status(204).end();
  });

  router.post('/lock', (req, res) => {
    res.clearCookie(gateCookieName(env), { path: '/' });
    return res.status(204).end();
  });

  return router;
}

export default createSiteGateRouter();
