/**
 * The site gate (owner, 2026-10-18): with SITE_GATE=on, xenostudio.ai / xenosystem.ai show their pages ONLY to people
 * with access, and everyone else gets the "Coming soon" page. nginx asks here before serving a page
 * (`auth_request /__site_gate`, nginx/default.conf); 204 = show it, 401 = show Coming soon.
 *
 * Access = a signed-in website session (the browser cookie, resolved by browserSessionMiddleware) on an ACTIVE account
 * that is an admin or matches SITE_GATE_ALLOW. Signed in alone is NOT access: signup is open, so anyone can make an
 * account. SITE_GATE_ALLOW is a comma list of full emails and/or "@domain" entries.
 *
 * Off (unset, or anything but "on") answers 204 for everyone, so the flag is the whole switch. The API, OAuth, update
 * downloads and the install script are never routed through this check: installed apps keep working either way.
 */
import express from 'express';

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

export function createSiteGateRouter({ env = process.env } = {}) {
  const router = express.Router();
  router.get('/check', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (env.SITE_GATE !== 'on') return res.status(204).end();
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
  return router;
}

export default createSiteGateRouter();
