/**
 * Changing the address an account signs in with.
 *
 * The order is the protection (GitHub, Google and Stripe all do it this way):
 *   1. the person confirms it's them (routes gate on requireConfirmation);
 *   2. a six-digit code goes to the NEW address, which proves they can read it;
 *   3. only a right code swaps the address;
 *   4. the OLD address is told, because that is where the real owner will see a takeover;
 *   5. every other session and every app token is signed out.
 * Until step 3 nothing about the account has changed.
 */
import { issueCode, redeemCode } from './accountConfirmation.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
export function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email) || /[\u0000-\u001f\u007f<>]/.test(email)) return null;
  const domain = email.slice(email.indexOf('@') + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  return email;
}

export async function pendingEmailChange(db, userId) {
  const { rows } = await db.query(
    `SELECT target_email, expires_at FROM account_codes WHERE user_id = $1 AND purpose = 'email_change' AND expires_at > NOW()`,
    [userId],
  );
  return rows[0] ? { new_email: rows[0].target_email, expires_at: rows[0].expires_at } : null;
}

/** Step 2. `sendCode(email, code)` resolves true when the mail was accepted for delivery. */
export async function requestEmailChange(db, { user, newEmail, sendCode }) {
  const email = cleanEmail(newEmail);
  if (!email) return { invalid: true, code: 'invalid_email' };
  if (email === String(user.email || '').toLowerCase()) return { invalid: true, code: 'same_email' };
  const taken = await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1', [email, user.id]);
  if (taken.rows.length) return { conflict: true, code: 'email_unavailable' };
  const issued = await issueCode(db, { userId: user.id, purpose: 'email_change', targetEmail: email, deliver: (code) => sendCode(email, code) });
  if (issued.tooSoon) return { tooSoon: true, retry_after: issued.retry_after };
  if (issued.undelivered) return { undelivered: true };
  return { ok: true, new_email: email, expires_in: issued.expires_in };
}

export async function cancelEmailChange(db, userId) {
  const { rowCount } = await db.query(`DELETE FROM account_codes WHERE user_id = $1 AND purpose = 'email_change'`, [userId]);
  return { ok: true, cancelled: rowCount > 0 };
}

/**
 * Step 3 to 5. `afterSwap(client, { oldEmail, newEmail })` runs inside the transaction and is where
 * the caller revokes the other sessions and app tokens and writes the audit record.
 */
export async function completeEmailChange(db, { userId, code, afterSwap }) {
  const redeemed = await redeemCode(db, { userId, purpose: 'email_change', code });
  if (!redeemed.ok) return redeemed;
  const newEmail = redeemed.targetEmail;
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT email FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!current.rows[0]) { await client.query('ROLLBACK'); return { notFound: true }; }
    const oldEmail = current.rows[0].email;
    // The address was free when the code was sent. Someone may have taken it since.
    const taken = await client.query('SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1', [newEmail, userId]);
    if (taken.rows.length) { await client.query('ROLLBACK'); return { conflict: true, code: 'email_unavailable' }; }
    await client.query('UPDATE users SET email = $1, email_verified = TRUE, updated_at = NOW() WHERE id = $2', [newEmail, userId]);
    // Verification links minted for the old address must not verify anything any more.
    await client.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
    if (afterSwap) await afterSwap(client, { oldEmail, newEmail });
    await client.query('COMMIT');
    return { ok: true, old_email: oldEmail, new_email: newEmail };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return { conflict: true, code: 'email_unavailable' };
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}
