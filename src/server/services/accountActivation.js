/**
 * Account activation — the gate between "signed up" and "can use the platform".
 *
 * The problem it solves, stated precisely: one-click Google signup creates a
 * usable account in about four seconds with no proof the person meant to. Of
 * 227 accounts on 2026-08-16, ~95% never did anything; the recent ones
 * (arthur120piupiu, elizimmermangame2015, telorjr47) were all one-click Google
 * and all already `email_verified = true`, because the OAuth insert hardcodes
 * it. So verification was never the missing signal — INTENT was.
 *
 * Activation is one click in the welcome email. A drive-by does not click it;
 * a real user does. That is the whole design.
 *
 * ── THE TOKEN IS STATELESS ─────────────────────────────────────────────────
 *
 * HMAC over the user id, same construction the unsubscribe link already uses
 * (`emailPreferences.js`). No token table, so nothing to expire, sweep, or
 * leave orphaned when an account is deleted — which matters here, because
 * orphaned credentials are exactly the defect found on 2026-08-16.
 *
 * It is deliberately NOT single-use. A welcome email can be opened twice, from
 * two devices, or forwarded to the user's own second address; making the second
 * click fail produces a support ticket and teaches nothing. Activation is
 * idempotent instead.
 */
import crypto from 'crypto';

const SITE = process.env.PUBLIC_SITE_URL || 'https://xenostudio.ai';

/**
 * Same fail-loud shape as emailPreferences: without JWT_SECRET the links would
 * silently stop verifying across a restart, which presents to the user as "the
 * link in my email is broken" and to support as unreproducible.
 */
let ephemeral = null;
function signingKey() {
  const k = process.env.JWT_SECRET;
  if (k) return k;
  if (!ephemeral) {
    console.error('[activation] JWT_SECRET is not set — activation links will not survive a restart');
    ephemeral = crypto.randomBytes(32).toString('hex');
  }
  return ephemeral;
}

/** Deterministic activation token for a user id. */
export function activationToken(userId) {
  return crypto.createHmac('sha256', signingKey())
    .update(`activate:${String(userId)}`)
    .digest('base64url');
}

/** Constant-time check. Length is compared first — timingSafeEqual throws on a
 *  mismatch, and a throw is itself an oracle. */
export function verifyActivationToken(userId, token) {
  const expected = activationToken(userId);
  const a = Buffer.from(String(token || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The link that goes in the welcome email. */
export function activationUrl(userId, origin = SITE) {
  return `${origin}/api/auth/activate?u=${encodeURIComponent(userId)}&t=${activationToken(userId)}`;
}

/** Has this account been activated? Presence of the row IS the fact. */
export async function isActivated(db, userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM account_activations WHERE user_id = $1', [userId],
  );
  return rows.length > 0;
}

/** Activate. Idempotent — a second click is the same intent, not an error. */
export async function activate(db, userId, { method = 'email_link', ip = null } = {}) {
  await db.query(
    `INSERT INTO account_activations (user_id, method, ip)
     VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
    [userId, method, ip],
  );
  return { ok: true };
}

/**
 * Express gate for PLATFORM routes.
 *
 * 🔴 Deliberately NOT applied to auth, /me, activation or public reads. A gate
 * that blocks login turns "confirm your email" into "your account is broken",
 * and neither the user nor support can tell those apart. You can always sign
 * in, see that you are unactivated, and ask for the link again.
 *
 * Fails CLOSED on an error: if the activation table cannot be read we do not
 * know the account is allowed, and a gate that opens when its own check breaks
 * is not a gate. That direction is the one this ecosystem has got wrong before.
 */
export function requireActivated(req, res, next) {
  const id = req.user?.id;
  if (!id) return res.status(401).json({ success: false, error: 'Authentication required' });

  isActivated(req.db, id)
    .then((ok) => {
      if (ok) return next();
      return res.status(403).json({
        success: false,
        error: 'Confirm your email to finish setting up your account.',
        code: 'account_not_activated',
        // The client needs to know WHICH remedy to offer; a bare 403 sends
        // people to support.
        remedy: 'resend_activation',
      });
    })
    .catch((e) => {
      console.error('[activation] check failed — failing CLOSED:', e?.message || e);
      return res.status(503).json({
        success: false,
        error: 'Could not verify your account status. Please try again.',
        code: 'activation_check_failed',
      });
    });
}

export default requireActivated;
