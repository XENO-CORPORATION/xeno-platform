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

// ═══════════════════════════════════════════════════════════════════════════
// v2 — ACTIVATION CODES
//
// The link in v1 committed on GET, and mail-security appliances pre-fetch every
// URL, so a scanner could activate an account with nobody involved. A code
// cannot be typed by a scanner. It also keeps the secret out of a URL and lets
// someone who signed up on a desktop finish from a phone without landing a
// session on the wrong device.
// ═══════════════════════════════════════════════════════════════════════════

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Six digits from a CSPRNG, uniformly distributed.
 *
 * `randomInt` rather than `% 1000000` on random bytes: the modulo introduces a
 * small bias toward low values, and while the practical gain to an attacker is
 * negligible, "negligible bias in a security token" is the kind of thing that
 * is free to avoid and embarrassing to explain.
 */
function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Mint a code, invalidating any previous live one for this user.
 *
 * The invalidation and the insert are ONE statement pair inside a transaction
 * because the partial unique index (`WHERE consumed_at IS NULL`) forbids two
 * live codes — which is deliberate. Two live codes would mean a resend does not
 * actually replace anything, and would double the guess surface for free.
 *
 * Returns the PLAINTEXT code. It exists in memory exactly long enough to be put
 * in an email; only the hash is stored.
 */
export async function mintCode(db, userId, bcrypt) {
  const code = newCode();
  const hash = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + CODE_TTL_MS);

  await db.query('BEGIN');
  try {
    await db.query(
      'UPDATE account_activation_codes SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL',
      [userId],
    );
    await db.query(
      'INSERT INTO account_activation_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hash, expires],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  return code;
}

/**
 * Verify a submitted code and, on success, activate.
 *
 * Returns a DISCRIMINATED result rather than a boolean, because the three
 * failures need three different messages: a wrong code, an expired code and a
 * burnt-out code are different problems and "invalid" sends all three to
 * support.
 *
 * 🔴 The attempt counter is incremented BEFORE the comparison, and lives in the
 * database. Incrementing after would let a crash mid-verify hand back a free
 * guess, and an in-memory counter resets on restart — which is not a limit, it
 * is a speed bump.
 */
export async function verifyCode(db, userId, submitted, bcrypt, { ip = null } = {}) {
  const clean = String(submitted || '').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(clean)) return { ok: false, reason: 'malformed' };

  const { rows } = await db.query(
    `SELECT id, code_hash, expires_at, attempts
       FROM account_activation_codes
      WHERE user_id = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!rows.length) return { ok: false, reason: 'no_code' };

  const row = rows[0];
  if (new Date(row.expires_at) <= new Date()) {
    await db.query('UPDATE account_activation_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.query('UPDATE account_activation_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const { rows: after } = await db.query(
    'UPDATE account_activation_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
    [row.id],
  );

  // bcrypt.compare is constant-time for its own comparison, and being slow is a
  // FEATURE here: it puts a hard floor under how fast six digits can be ground.
  if (!(await bcrypt.compare(clean, row.code_hash))) {
    const left = Math.max(0, MAX_ATTEMPTS - (after[0]?.attempts ?? MAX_ATTEMPTS));
    if (left === 0) {
      await db.query('UPDATE account_activation_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'wrong', attemptsLeft: left };
  }

  // Single-use: consume before activating, so a replay cannot re-enter here.
  await db.query('UPDATE account_activation_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
  await activate(db, userId, { method: 'email_link', ip });
  return { ok: true };
}

export const ACTIVATION_CODE_TTL_MS = CODE_TTL_MS;
export const ACTIVATION_MAX_ATTEMPTS = MAX_ATTEMPTS;
