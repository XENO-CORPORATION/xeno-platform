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
  PASSWORD_RESET: 'password_reset',
  PASSWORD_RESET_ADMIN: 'password_reset_admin',
  PASSWORD_CHANGED: 'password_changed',
  // OIDC / token lifecycle
  TOKEN_ISSUED: 'token_issued',         // an authorization_code or device grant completed
  TOKEN_REFRESHED: 'token_refreshed',
  TOKEN_REVOKED: 'token_revoked',
  TOKEN_REUSE_DETECTED: 'token_reuse_detected', // RFC 9700 family revocation fired
  OIDC_CLIENT_REGISTERED: 'oidc_client_registered',
  // BYOK credential lifecycle (INFERENCE ROUTING spec; Vault's rule: no secret
  // op without an audit record). Metadata carries ids, provider and the key
  // FINGERPRINT — never the key, never last4, never a base_url with auth in it.
  BYOK_CREDENTIAL_CREATED: 'byok_credential_created',
  BYOK_CREDENTIAL_REVOKED: 'byok_credential_revoked',
  BYOK_CREDENTIAL_DELETED: 'byok_credential_deleted',
  BYOK_CREDENTIAL_MODELS_SET: 'byok_credential_models_set',
  BYOK_ROUTE_SET: 'byok_route_set',
  BYOK_ROUTE_CLEARED: 'byok_route_cleared',
  // XENO Artifacts — publish / share / delete, the same family Claude Code audits as
  // claude_artifact_* (code.claude.com/docs/en/artifacts, "Review the audit log").
  ARTIFACT_PUBLISHED: 'artifact_published',
  ARTIFACT_SHARED: 'artifact_shared',
  ARTIFACT_DELETED: 'artifact_deleted',
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
 * Transactional security event write for credential-changing operations.
 * Throws on DB failure so the enclosing transaction rolls back.
 */
export async function recordSecurityEventTransactional(client, type, { userId = null, req = null, metadata = {} } = {}) {
  if (!client) throw new Error('database client required for transactional security event');
  const hasTable = await client.query("SELECT to_regclass('public.security_events') IS NOT NULL AS exists").catch(() => ({ rows: [{ exists: false }] }));
  if (!hasTable.rows?.[0]?.exists) return;

  let eventType = type;
  let meta = metadata;
  if (!KNOWN.has(type)) {
    console.error(`[security-events] unknown event type '${type}' — recording as unknown_event`);
    eventType = 'unknown_event';
    meta = { ...metadata, attemptedType: type };
  }
  await client.query(
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
}

/**
 * Fire-and-forget form for hot paths (token endpoints) where even the await is
 * unwanted. Same guarantees — it cannot throw and it cannot reject.
 */
export function recordSecurityEventAsync(db, type, opts) {
  Promise.resolve().then(() => recordSecurityEvent(db, type, opts)).catch(() => {});
}

export default recordSecurityEvent;
