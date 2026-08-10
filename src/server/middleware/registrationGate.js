/**
 * Registration gate — the ONE place that decides whether a new account may be
 * created, and the one place that decides whether an existing account may sign in.
 *
 * WHY A SINGLE CHOKE POINT: there are three independent account-creation paths in
 * authRoutes.js (`POST /register`, `POST /register-with-handle`, and the OAuth
 * callback's auto-create in findOrCreateOAuthUser). Gating them one-by-one is how
 * you end up with two closed doors and one open one. Every path calls in here.
 *
 * FAIL-SAFE BY DEFAULT: registration is CLOSED unless REGISTRATION_OPEN is the
 * exact string 'true'. A missing, empty, misspelled, or accidentally-cleared env
 * var therefore keeps signups closed rather than silently reopening them to the
 * internet. This mirrors the ecosystem's signing resolver, which resolves to
 * `unsigned` on any ambiguity rather than claiming a guarantee it cannot prove.
 *
 *   REGISTRATION_OPEN=true            → signups open
 *   REGISTRATION_OPEN unset/anything  → signups CLOSED
 *   REGISTRATION_ALLOWLIST=a@b.com,@corp.com
 *                                     → these may still register while closed
 *                                       (entries beginning with '@' match a domain)
 *
 * SUSPENDED ACCOUNTS: password login already refused `is_active = false`, but the
 * three OAuth callbacks did not — they took whatever findOrCreateOAuthUser
 * returned straight to issueSessionToken. With 162 of 218 accounts on OAuth, an
 * `is_active = false` suspension would have been theatre for three quarters of
 * them. assertAccountUsable() is what makes a suspension real on every path.
 */

/** Thrown when account creation is refused. Callers map it to 403 / a redirect. */
export class AccountCreationBlockedError extends Error {
  constructor(reason = 'registration_closed') {
    super('Account registration is currently closed');
    this.name = 'AccountCreationBlockedError';
    this.code = reason;
    this.statusCode = 403;
  }
}

/** Thrown when an existing account is suspended or deactivated. */
export class AccountSuspendedError extends Error {
  constructor() {
    super('This account has been suspended');
    this.name = 'AccountSuspendedError';
    this.code = 'account_suspended';
    this.statusCode = 403;
  }
}

/** Signups are open ONLY on an explicit, exact 'true'. Everything else is closed. */
export function isRegistrationOpen() {
  return String(process.env.REGISTRATION_OPEN || '').trim().toLowerCase() === 'true';
}

function allowlist() {
  return String(process.env.REGISTRATION_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this specific email allowed to create an account right now?
 * @returns {{allowed: boolean, reason: string}}
 */
export function registrationDecision(email) {
  if (isRegistrationOpen()) return { allowed: true, reason: 'open' };

  const normalized = String(email || '').trim().toLowerCase();
  if (normalized) {
    const domain = normalized.includes('@') ? `@${normalized.split('@').pop()}` : null;
    for (const entry of allowlist()) {
      if (entry.startsWith('@')) {
        if (domain && domain === entry) return { allowed: true, reason: 'allowlist_domain' };
      } else if (entry === normalized) {
        return { allowed: true, reason: 'allowlist_email' };
      }
    }
  }

  return { allowed: false, reason: 'registration_closed' };
}

/**
 * Throwing form, for non-route code paths (the OAuth auto-create).
 * @throws {AccountCreationBlockedError}
 */
export function assertRegistrationAllowed(email) {
  const decision = registrationDecision(email);
  if (!decision.allowed) throw new AccountCreationBlockedError(decision.reason);
  return decision;
}

/**
 * Guard for an EXISTING account at sign-in time. Every login path must call this
 * — password, OAuth, and any future one — or a suspension only holds on the paths
 * that remembered to check.
 * @throws {AccountSuspendedError}
 */
export function assertAccountUsable(user) {
  if (!user) return;
  const suspended = user.is_active === false
    || String(user.status || '').toLowerCase() === 'suspended'
    || user.deleted_at;
  if (suspended) throw new AccountSuspendedError();
}

/**
 * Express middleware for the two JSON registration endpoints.
 * Reads the email from the body so the allowlist can apply per-request.
 */
export function requireRegistrationOpen(req, res, next) {
  const decision = registrationDecision(req.body?.email);
  if (decision.allowed) return next();

  console.warn(`[registrationGate] refused signup attempt (${req.body?.email ? 'email supplied' : 'no email'})`);
  return res.status(403).json({
    success: false,
    error: 'Registration is currently closed.',
    code: 'registration_closed',
  });
}

export default requireRegistrationOpen;
