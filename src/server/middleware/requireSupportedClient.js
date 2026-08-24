/**
 * Refuse a client build we no longer support — 426 Upgrade Required.
 *
 * ── 🔴 THE EXEMPTION THAT DECIDES WHETHER THIS IS USABLE OR A TRAP ──────────
 *
 * The paths a blocked client needs in order to UNBLOCK ITSELF are exempt, and
 * this is not a convenience. A version floor that also blocks the update feed
 * bricks the app permanently: the user is told to update, the app asks where the
 * update is, and we refuse to say — leaving reinstall-from-the-website as the
 * only exit, for a person who may not know the website exists.
 *
 * The general rule, worth carrying past this file: **a control that refuses an
 * action must never also refuse the remedy it names.** Any gate whose error
 * message says "do X" has to leave X reachable.
 *
 * ── WHY IT IS MOUNTED NARROWLY ──────────────────────────────────────────────
 *
 * On the API surface, not globally. A refused client should still be able to
 * load the marketing site, read the pricing page and reach support — those cost
 * us nothing and are where a locked-out person goes next.
 */
import { identifyClient, loadPolicies, evaluateClient } from '../services/clientVersion.js';
import { rateLimitKey } from '../utils/clientIp.js';

/* Reachable no matter how old the caller is. Ordered by why each one is here,
 * because a future reader will otherwise assume they are arbitrary. */
const ALWAYS_ALLOWED = [
  '/api/health', '/api/ready',            // liveness — never gate observability
  '/api/updates',                          // the remedy: where the new build is
  '/api/downloads',                        // the remedy: how to get the new build
  '/api/billing/config',                   // so a client can explain the plan state
  '/api/auth/logout',                      // never trap someone in a session
  '/api/client-policy',                    // so a client can read its own verdict
];

/**
 * 🔴 originalUrl, NOT req.path.
 *
 * This middleware is mounted with `app.use('/api/', …)`, and Express STRIPS the
 * mount path from `req.path` — inside the handler it reads `/client-policy`,
 * never `/api/client-policy`. So an exemption list written in full paths matched
 * nothing, and the first live test refused /api/client-policy, /api/downloads
 * and /api/ready to the very build being told to update: the app is told to
 * update, asks where the update is, and is refused.
 *
 * The unit gate passed the whole time, because it asserted the exempt PATHS were
 * present in the file rather than that exemption FIRES. Structural checks cannot
 * see a framework stripping a prefix; only calling the middleware can.
 */
function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  return String(raw).split('?')[0];
}

const exempt = (p) => ALWAYS_ALLOWED.some((a) => p === a || p.startsWith(`${a}/`));

export async function requireSupportedClient(req, res, next) {
  try {
    if (exempt(requestPath(req))) return next();

    const identity = identifyClient(req);
    if (!identity) return next();

    const policies = await loadPolicies(req.db);
    const verdict = evaluateClient(identity, policies);

    if (verdict.ok) {
      /* An advisory header, not a refusal. "You should update" and "you may not
       * continue" are different statements, and collapsing them removes the only
       * warning anyone gets before the floor moves. */
      if (verdict.outdated) {
        res.set('X-Xeno-Client-Status', 'outdated');
        res.set('X-Xeno-Client-Min-Recommended', String(verdict.minRecommended));
      }
      req.xenoClient = identity;
      return next();
    }

    /* Recorded before responding. "How many people did we just lock out, and
     * which builds were they on?" is unanswerable at exactly the moment it is
     * most urgent, and a version floor's blast radius is invisible until someone
     * complains. Never allowed to fail the response. */
    try {
      await req.db?.query(
        `INSERT INTO client_version_refusals (product, version, user_id, path, client_ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          identity.product, identity.version, req.user?.id || null,
          requestPath(req).slice(0, 256),
          (() => { try { return rateLimitKey(req); } catch { return null; } })(),
          String(req.headers['user-agent'] || '').slice(0, 512),
        ],
      );
    } catch (e) {
      console.error('[ClientVersion] failed to record refusal:', e.message);
    }

    res.set('X-Xeno-Client-Status', 'unsupported');
    res.set('X-Xeno-Client-Min-Supported', String(verdict.minSupported));
    return res.status(426).json({
      error: {
        code: 'client_upgrade_required',
        message: verdict.message
          || `This version of XENO ${identity.product} is no longer supported. Update to continue.`,
        product: identity.product,
        currentVersion: identity.version,
        minSupported: verdict.minSupported,
        /* Name the remedy, and make sure the named remedy is reachable — see the
         * exemption list above. */
        update: `/product/${identity.product}/download`,
      },
    });
  } catch (e) {
    /* Fails OPEN. A deprecation control must not become an outage because its
     * own middleware threw. Payment is enforced separately and fails closed. */
    console.error('[ClientVersion] middleware error, serving:', e.message);
    return next();
  }
}

export default requireSupportedClient;
