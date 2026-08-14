/**
 * securityEvents — the account audit trail.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Before this module the platform had ONE write site (the OAuth branch in
 * authRoutes) and `security_events` held 166 rows across three event types —
 * `oauth_signup` (163), `oauth_login` (2) and `password_reset_admin` (1) — against
 * 416 sessions. There was no record of a password login, a logout, a failed login,
 * a token being issued, refreshed or revoked, or a product being authorized.
 *
 * The practical consequence: "what happened to this account?" was unanswerable.
 * When an account was compromised or a user disputed an action, the audit trail
 * could say when they signed up and nothing else.
 *
 * ── DESIGN ──────────────────────────────────────────────────────────────────
 *
 * One function, one closed vocabulary, and writes that CANNOT break the thing they
 * observe. An audit failure must never fail a login: a logger that can take down
 * authentication is a worse problem than the gap it fills.
 */
import { clientIp } from '../utils/clientIp.js';

/**
 * The closed event vocabulary.
 *
 * Closed on purpose — a free-text event_type produces `login`, `user_login`,
 * `login_success` and `signin` in the same table within a year, and then nothing
 * can be counted. An unknown type is a programming error, and is recorded as
 * `unknown_event` with the attempted name in metadata rather than dropped, because
 * silently discarding an audit record is the one failure mode worse than a wrong label.
 */
export const EVENTS = Object.freeze({
  // Authentication
  LOGIN: 'login',                       // password login succeeded
  LOGIN_FAILED: 'login_failed',         // credentials rejected
  LOGOUT: 'logout',
  OAUTH_LOGIN: 'oauth_login',
  OAUTH_SIGNUP: 'oauth_signup',
  SIGNUP: 'signup',                     // password registration
  // Account state
  ACCOUNT_SUSPENDED_BLOCKED: 'account_suspended_blocked', // usable-check refused a sign-in
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  PASSWORD_RESET_ADMIN: 'password_reset_admin',
  // OIDC / token lifecycle
  TOKEN_ISSUED: 'token_issued',         // an authorization_code or device grant completed
  TOKEN_REFRESHED: 'token_refreshed',
  TOKEN_REVOKED: 'token_revoked',
  TOKEN_REUSE_DETECTED: 'token_reuse_detected', // RFC 9700 family revocation fired
});

const KNOWN = new Set(Object.values(EVENTS));

/**
 * Record one security event.
 *
 * NEVER THROWS and never rejects. Every call site is on an authentication path, and
 * an audit write that can fail a login would be a self-inflicted outage. Failures
 * go to the console loudly and the caller proceeds.
 *
 * @param {object} db      pg pool/client
 * @param {string} type    one of EVENTS
 * @param {object} opts
 * @param {string|null} opts.userId    may be null (e.g. a failed login for an unknown address)
 * @param {object} opts.req            express request, for ip + user-agent
 * @param {object} opts.metadata       small JSON. NEVER put a token, password or code in here.
 */
export async function recordSecurityEvent(db, type, { userId = null, req = null, metadata = {} } = {}) {
  if (!db) return;
  let eventType = type;
  let meta = metadata;
  if (!KNOWN.has(type)) {
    console.error(`[security-events] unknown event type '${type}' — recording as unknown_event`);
    eventType = 'unknown_event';
    meta = { ...metadata, attemptedType: type };
  }
  try {
    await db.query(
      `INSERT INTO security_events (user_id, event_type, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        userId,
        eventType,
        JSON.stringify(meta || {}),
        req ? clientIp(req) : null,
        req ? req.get('User-Agent') : null,
      ],
    );
  } catch (e) {
    // Loud, and swallowed. See the contract above.
    console.error(`[security-events] failed to record '${eventType}': ${String(e?.message || e)}`);
  }
}

/**
 * Fire-and-forget form for hot paths (token endpoints) where even the await is
 * unwanted. Same guarantees — it cannot throw and it cannot reject.
 */
export function recordSecurityEventAsync(db, type, opts) {
  Promise.resolve().then(() => recordSecurityEvent(db, type, opts)).catch(() => {});
}

export default recordSecurityEvent;
