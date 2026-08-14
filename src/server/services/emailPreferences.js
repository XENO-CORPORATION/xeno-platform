/**
 * emailPreferences — the unsubscribe list and its signed one-click link.
 *
 * ── WHY A SIGNED TOKEN AND NOT A RAW EMAIL IN THE URL ───────────────────────
 *
 * `/api/email/unsubscribe?email=someone@example.com` would let anyone unsubscribe
 * anyone — including suppressing a competitor's mail, or walking the address space
 * to confirm which addresses exist. The token is an HMAC of the address under the
 * server's JWT_SECRET, so a link only works for the address it was minted for and
 * cannot be forged or enumerated.
 *
 * It deliberately does NOT expire. An unsubscribe link lives in an inbox forever and
 * must still work in two years — a "link expired" page in response to someone asking
 * to be left alone is both hostile and, in the EU, non-compliant.
 *
 * ── WHAT IT CANNOT SUPPRESS ─────────────────────────────────────────────────
 *
 * Security and transactional mail (password reset, email verification) is never
 * gated on this list. Someone who unsubscribes from onboarding mail has not asked to
 * be locked out of their own account, and a password reset that silently does not
 * arrive is an account-recovery failure that looks like a broken product.
 */
import crypto from 'node:crypto';

/**
 * Lowercase + trim. Storage and lookup MUST use the same normalization or an
 * unsubscribe silently fails to match and the person keeps getting mail.
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** The HMAC key. Falls back to a per-process random value so a missing secret
 *  produces links that simply do not verify, rather than links signed with a
 *  predictable constant that anyone could reproduce. */
function signingKey() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (!signingKey._ephemeral) {
    console.error('[email] JWT_SECRET is not set — unsubscribe links will not verify across restarts');
    signingKey._ephemeral = crypto.randomBytes(32).toString('hex');
  }
  return signingKey._ephemeral;
}

/** Deterministic unsubscribe token for an address. */
export function unsubscribeToken(email) {
  return crypto.createHmac('sha256', signingKey())
    .update(normalizeEmail(email))
    .digest('base64url');
}

/** Constant-time verification of an (email, token) pair. */
export function verifyUnsubscribeToken(email, token) {
  const expected = unsubscribeToken(email);
  const a = Buffer.from(String(token || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch, which is itself an oracle; compare
  // lengths first and always return a boolean.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The full one-click unsubscribe URL for an address. */
export function unsubscribeUrl(email, origin = 'https://xenostudio.ai') {
  const e = encodeURIComponent(normalizeEmail(email));
  return `${origin}/api/email/unsubscribe?email=${e}&token=${unsubscribeToken(email)}`;
}

/** Has this address opted out of `category` (or of everything)? */
export async function isOptedOut(db, email, category = null) {
  if (!db) return false;
  const e = normalizeEmail(email);
  try {
    const r = await db.query(
      `SELECT 1 FROM email_opt_outs
        WHERE email = $1 AND (category IS NULL OR category = $2) LIMIT 1`,
      [e, category],
    );
    return r.rows.length > 0;
  } catch (err) {
    // FAIL OPEN on a missing table / transient fault: an opt-out check that errors
    // must not silently stop ALL mail, including account recovery. Loud, not silent.
    console.error(`[email] opt-out check failed (failing OPEN): ${String(err?.message || err)}`);
    return false;
  }
}

/** Record an opt-out. Idempotent — unsubscribing twice is a no-op, not an error. */
export async function optOut(db, email, { reason = null, category = null } = {}) {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, error: 'missing email' };
  await db.query(
    `INSERT INTO email_opt_outs (email, reason, category) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, category = EXCLUDED.category`,
    [e, reason, category],
  );
  return { ok: true, email: e };
}

/** Remove an opt-out (re-subscribe). Only ever driven by an authenticated action. */
export async function optIn(db, email) {
  const e = normalizeEmail(email);
  await db.query('DELETE FROM email_opt_outs WHERE email = $1', [e]);
  return { ok: true, email: e };
}
