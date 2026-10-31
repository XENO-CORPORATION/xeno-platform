/**
 * The site gate (owner, 2026-10-18): with SITE_GATE=on, xenostudio.ai / xenosystem.ai show their pages ONLY to people
 * with access, and everyone else gets the "Coming soon" page. nginx asks here before serving a page
 * (`auth_request /__site_gate`, nginx/default.conf); 204 = show it, 401 = show Coming soon.
 *
 * THREE ways in, and only three:
 *   1. An ACCESS CODE — one shared code, typed on the Coming soon page (POST /unlock). It sets a signed, HttpOnly
 *      cookie that the check accepts, so a person with the code sees the site without an account. The code is a
 *      bearer secret: constant-time compare, per-address attempt limit, bounded cookie life, and rotating
 *      SITE_GATE_CODE invalidates every cookie already issued (the code's digest is inside the signature).
 *   2. A signed-in website session (browserSessionMiddleware) on an ACTIVE account that is an admin or matches
 *      SITE_GATE_ALLOW. Signed in alone is NOT access: signup is open, so anyone can make an account.
 *      SITE_GATE_ALLOW is a comma list of full emails and/or "@domain" entries.
 *   3. A PERSONAL code (services/siteAccessCodes.js) an admin made for one person or fund. Its cookie names the code,
 *      and this check re-reads the code's row, so revoking or expiring it closes every browser it opened.
 *
 * 🔴 The code and the cookie open PAGES ONLY. They are not an auth token: /api/ still requires a real account, so
 * the gate can never widen API authority. OAuth, update downloads and the install script are not routed through the
 * check at all, so installed apps keep working whether the gate is on or off.
 *
 * Off (unset, or anything but "on") answers 204 for everyone, so the flag is the whole switch.
 */
import express from 'express';
import { clientIp } from '../utils/clientIp.js';
import { codeCookieId, codeMatches, GATE_DAYS, gateCookieName, gateCookieValid, mintCodeCookie, mintGateCookie, readCookie } from '../utils/siteGateCode.js';
import { mintShareInvite, SHARE_INVITE_HOURS, shareInviteCookieName } from '../utils/shareInvite.js';
import * as accessCodes from '../services/siteAccessCodes.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

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

/** A tiny fixed-window attempt counter, keyed by client address. Exported so a test can prove it refuses.
 *  Per backend replica (in memory): with N replicas behind nginx the real ceiling is N × max per window. */
export function createAttemptLimiter({ max = 10, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function take(key) {
    const t = now();
    // Bounded: a flood of distinct addresses must not grow this forever. Expired windows are dropped once it is large.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    const row = hits.get(key);
    if (!row || row.reset <= t) { hits.set(key, { count: 1, reset: t + windowMs }); return true; }
    row.count += 1;
    return row.count <= max;
  };
}

export function createSiteGateRouter({ env = process.env, attempt = createAttemptLimiter(), codes = accessCodes,
  staffGuard = [authMiddleware, requireAdmin] } = {}) {
  const router = express.Router();
  const secret = env.SITE_GATE_SECRET || env.JWT_SECRET;
  const code = String(env.SITE_GATE_CODE || '');

  // A code LINK opened by someone already let in still counts as the link being used (see noteLinkOpened). Only on an
  // allowed request: a refused one is answered by Coming soon, which redeems the code through POST /unlock itself.
  const noteLink = async (req) => {
    const linked = codes.linkedCodeOf ? codes.linkedCodeOf(req.headers['x-original-uri']) : null;
    if (!linked) return;
    await codes.noteLinkOpened(req.db, linked, accessCodes.countryOf(req), req.browserSession?.userId || req.user?.id || null)
      .catch(() => console.error('[site-gate] could not record a code link'));
  };

  router.get('/check', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (env.SITE_GATE !== 'on') return res.status(204).end();
    const allowed = await gateDecision(req);
    if (allowed) await noteLink(req);
    return res.status(allowed ? 204 : 401).end();
  });

  /** true = let in. Fail CLOSED: an error must never open the site. */
  async function gateDecision(req) {
    const cookie = readCookie(req.headers.cookie, gateCookieName(env));
    if (gateCookieValid(cookie, code, secret)) return true;
    const userId = req.browserSession?.userId;
    const codeId = codeCookieId(cookie, secret);
    try {
      // A per-person code's cookie: valid only while that code is (re-read every time, so revoking it shuts the door).
      if (codeId && await codes.codeIsLive(req.db, codeId)) {
        if (userId) await codes.noteAccount(req.db, codeId, userId).catch(() => {});
        return true;
      }
      if (!userId) return false;
      const { rows } = await req.db.query('SELECT email, role, is_active, status FROM users WHERE id = $1', [userId]);
      return hasSiteAccess(rows[0], parseAllow(env.SITE_GATE_ALLOW));
    } catch (e) {
      console.error('[site-gate]', e.message);
      return false;
    }
  }

  const cookieOpts = (maxAge) => ({ httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge });

  router.post('/unlock', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (env.SITE_GATE !== 'on') return res.status(204).end();          // nothing to unlock
    if (!attempt(clientIp(req) || 'unknown')) return res.status(429).json({ error: 'too_many_attempts' });
    const typed = (req.body || {}).code;
    // 1. the shared fallback code, while it is still configured
    if (code && codeMatches(typed, code)) {
      const value = mintGateCookie(code, secret);
      if (!value) return res.status(404).json({ error: 'no_access_code' });
      res.cookie(gateCookieName(env), value, cookieOpts(GATE_DAYS * 86400 * 1000));
      return res.status(204).end();
    }
    // 2. a per-person code
    let hit = null;
    try { hit = secret ? await codes.redeemCode(req.db, typed, accessCodes.countryOf(req), (req.body || {}).via) : null; } catch (e) { console.error('[site-gate] redeem failed'); }
    if (!hit) return res.status(401).json({ error: 'invalid_code' });
    const value = mintCodeCookie(hit.id, secret, hit.expiresAt);
    if (!value) return res.status(401).json({ error: 'invalid_code' });
    res.cookie(gateCookieName(env), value, cookieOpts(Math.max(1000, Math.min(GATE_DAYS * 86400_000, hit.expiresAt - Date.now()))));
    if (hit.scope === 'account') {
      // The signup allowance is the SAME signed invitation a sign-in folder link gives (PR #824), keyed by the code's
      // id: registrationGate reads it and stays the one place that decides account creation.
      const invite = mintShareInvite(hit.id, env);
      if (invite) res.cookie(shareInviteCookieName(env), invite, cookieOpts(SHARE_INVITE_HOURS * 3600 * 1000));
    }
    return res.status(200).json({ scope: hit.scope });
  });

  // ── The staff console: admins create, list, revoke and audit codes ──────────────────────────────────────────────
  const fail = (res, e) => (e instanceof accessCodes.AccessCodeError ? res.status(e.status).json({ error: e.code })
    : (console.error('[site-gate] codes:', e.message), res.status(500).json({ error: 'failed' })));
  router.get('/codes', ...staffGuard, async (req, res) => {
    res.set('cache-control', 'no-store');
    try { return res.json({ codes: await codes.listCodes(req.db) }); } catch (e) { return fail(res, e); }
  });
  router.post('/codes', ...staffGuard, async (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      const b = req.body || {};
      const out = await codes.createCode(req.db, { label: b.label, scope: b.scope || 'pages', days: b.days ?? undefined, maxUses: b.maxUses ?? null }, req.user.id);
      return res.status(201).json(out); // the plain code appears here once and nowhere else
    } catch (e) { return fail(res, e); }
  });
  router.get('/codes/:id/events', ...staffGuard, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    try { return res.json({ events: await codes.codeEvents(req.db, req.params.id) }); } catch (e) { return fail(res, e); }
  });
  router.post('/codes/:id/revoke', ...staffGuard, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    try { return res.json({ accessCode: await codes.revokeCode(req.db, req.params.id, req.user.id) }); } catch (e) { return fail(res, e); }
  });

  router.post('/lock', (req, res) => {
    res.clearCookie(gateCookieName(env), { path: '/' });
    return res.status(204).end();
  });

  return router;
}

export default createSiteGateRouter();
