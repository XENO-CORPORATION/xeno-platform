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
import { identifyClient, loadPolicies, evaluateClient, evaluateTokenClient } from '../services/clientVersion.js';
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

/**
 * The floor at the TOKEN endpoint — how a build that never identifies itself is
 * refused (XENO AUTH - AUTH GATE DELTA §9.3).
 *
 * `requireSupportedClient` above cannot see such a build: it has no `X-Xeno-Client`
 * and its User-Agent is `node`. But it cannot get a token without naming its OIDC
 * client, so this refuses `/api/oauth2/token` for a product client whose request
 * does not carry a supported `X-Xeno-Client` — on sign-in (`authorization_code`,
 * `device_code`) and on refresh (`refresh_token`). Access tokens live ten minutes,
 * so an old build holds no usable token within ten minutes of refresh being refused,
 * without a per-request rule that would also refuse our own services.
 *
 * ⚠️ Deliberately NOT applied to `token-exchange`: that is the Hub broker asking on a
 * child's behalf, with `child_client_id`, not the product asking. The broker path
 * has its own identity rules and no product uses it yet.
 *
 * Same response shape and refusal log as the floor, so a client that already reads
 * `client_upgrade_required` needs nothing new, and "how many did we lock out" stays
 * one table. Fails OPEN on an unexpected error, like the floor.
 */
const TOKEN_GRANTS_UNDER_FLOOR = new Set([
  'authorization_code',
  'refresh_token',
  'urn:ietf:params:oauth:grant-type:device_code',
]);

export async function requireSupportedTokenClient(req, res, next) {
  try {
    const b = req.body || {};
    if (!TOKEN_GRANTS_UNDER_FLOOR.has(b.grant_type)) return next();
    const policies = await loadPolicies(req.db);
    const verdict = evaluateTokenClient({ clientId: b.client_id, headers: req.headers }, policies);
    if (verdict.ok) return next();

    const { identity } = verdict;
    try {
      await req.db?.query(
        `INSERT INTO client_version_refusals (product, version, user_id, path, client_ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          identity.product, identity.version, null,
          `${requestPath(req)}#${String(b.grant_type).slice(0, 64)}`.slice(0, 256),
          (() => { try { return rateLimitKey(req); } catch { return null; } })(),
          String(req.headers['user-agent'] || '').slice(0, 512),
        ],
      );
    } catch (e) {
      console.error('[ClientVersion] failed to record token refusal:', e.message);
    }

    res.set('X-Xeno-Client-Status', 'unsupported');
    res.set('X-Xeno-Client-Min-Supported', String(verdict.minSupported));
    return res.status(426).json({
      /* OAuth clients read `error` as a string (RFC 6749 §5.2); the floor's usual body
       * nests an object there. Both are carried: `error` for the OAuth client, and the
       * floor's fields at the top level for a client that reads those. */
      error: 'client_upgrade_required',
      error_description: verdict.message
        || `This version of XENO ${identity.product} is no longer supported. Update to continue.`,
      code: 'client_upgrade_required',
      product: identity.product,
      currentVersion: identity.source === 'oidc-client' ? null : identity.version,
      minSupported: verdict.minSupported,
      update: `/product/${identity.product}/download`,
    });
  } catch (e) {
    console.error('[ClientVersion] token-floor error, serving:', e.message);
    return next();
  }
}

export default requireSupportedClient;
