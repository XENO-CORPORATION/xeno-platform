/**
 * "Confirm it's you": a short proof, tied to one browser session, that the person at the keyboard
 * owns the account. Sensitive account routes ask for it (GitHub calls this sudo mode; OWASP ASVS
 * asks for re-authentication before a sensitive change).
 *
 * Two ways to prove it:
 *   password     for an account that has one
 *   email_code   a six-digit code sent to the account's address, for an account that signs in
 *                with Google, GitHub or X and has no password
 *
 * Rules that are deliberate:
 * - The proof belongs to the session (`sid`). A caller with no browser session, such as an API key,
 *   cannot confirm, so an API key can never mint another API key or change the email.
 * - Wrong passwords are counted per account. Five in fifteen minutes locks the step, not the account.
 * - A code is stored only as a keyed hash, lasts ten minutes and dies after five wrong tries.
 */
import crypto from 'crypto';

export const CONFIRM_MINUTES = 10;
export const CODE_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 60;
export const PASSWORD_MAX_FAILURES = 5;
export const PASSWORD_WINDOW_MINUTES = 15;

const codeSecret = () => {
  const secret = process.env.ACCOUNT_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('ACCOUNT_CODE_SECRET or JWT_SECRET is required for account codes');
  return secret;
};
export const hashCode = (userId, purpose, code) => crypto.createHmac('sha256', codeSecret()).update(`${userId}:${purpose}:${code}`).digest('hex');
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/** Which proofs this account can give. */
export function confirmMethods(user, hasUsablePassword) {
  return hasUsablePassword(user.password_hash) ? ['password'] : ['email_code'];
}

export async function confirmationStatus(db, { userId, sid }) {
  if (!sid) return { confirmed: false, available: false, expires_at: null };
  const { rows } = await db.query(
    `SELECT c.expires_at, c.method FROM account_confirmations c
       JOIN user_sessions s ON s.id = c.sid AND s.user_id = c.user_id AND s.expires_at > NOW()
      WHERE c.sid = $1 AND c.user_id = $2 AND c.expires_at > NOW()`,
    [sid, userId],
  );
  return rows[0] ? { confirmed: true, available: true, expires_at: rows[0].expires_at, method: rows[0].method } : { confirmed: false, available: true, expires_at: null };
}

async function grant(db, { userId, sid, method }) {
  const { rows } = await db.query(
    `INSERT INTO account_confirmations (sid, user_id, method, confirmed_at, expires_at)
     VALUES ($1, $2, $3, NOW(), NOW() + make_interval(mins => $4))
     ON CONFLICT (sid) DO UPDATE SET user_id = EXCLUDED.user_id, method = EXCLUDED.method, confirmed_at = NOW(), expires_at = EXCLUDED.expires_at
     RETURNING expires_at`,
    [sid, userId, method, CONFIRM_MINUTES],
  );
  return { ok: true, method, expires_at: rows[0].expires_at };
}

/** How many wrong passwords in the current window. Starts a new window when the old one is over. */
async function failures(db, userId) {
  const { rows } = await db.query(
    `SELECT failures FROM account_confirm_throttle WHERE user_id = $1 AND window_started_at > NOW() - make_interval(mins => $2)`,
    [userId, PASSWORD_WINDOW_MINUTES],
  );
  return rows[0]?.failures || 0;
}
async function countFailure(db, userId) {
  await db.query(
    `INSERT INTO account_confirm_throttle (user_id, failures, window_started_at) VALUES ($1, 1, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       failures = CASE WHEN account_confirm_throttle.window_started_at > NOW() - make_interval(mins => $2) THEN account_confirm_throttle.failures + 1 ELSE 1 END,
       window_started_at = CASE WHEN account_confirm_throttle.window_started_at > NOW() - make_interval(mins => $2) THEN account_confirm_throttle.window_started_at ELSE NOW() END`,
    [userId, PASSWORD_WINDOW_MINUTES],
  );
}

export async function confirmWithPassword(db, { userId, sid, password, verifyPassword }) {
  if (!sid) return { unavailable: true };
  if (typeof password !== 'string' || !password) return { invalid: true };
  if ((await failures(db, userId)) >= PASSWORD_MAX_FAILURES) return { throttled: true };
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
    await countFailure(db, userId);
    return { wrong: true, remaining: Math.max(0, PASSWORD_MAX_FAILURES - (await failures(db, userId))) };
  }
  await db.query('DELETE FROM account_confirm_throttle WHERE user_id = $1', [userId]);
  return grant(db, { userId, sid, method: 'password' });
}

/**
 * Mint a code for a purpose and hand it to `deliver`. Returns { ok } or { tooSoon, retry_after }.
 * The code is written only after `deliver` succeeds, so a mail failure leaves the old state.
 */
export async function issueCode(db, { userId, purpose, targetEmail = null, deliver }) {
  const recent = await db.query(
    `SELECT GREATEST(0, $3 - EXTRACT(EPOCH FROM (NOW() - created_at)))::int AS wait FROM account_codes WHERE user_id = $1 AND purpose = $2`,
    [userId, purpose, CODE_RESEND_SECONDS],
  );
  if (recent.rows[0]?.wait > 0) return { tooSoon: true, retry_after: recent.rows[0].wait };
  const code = newCode();
  const codeHash = hashCode(userId, purpose, code);   // before the mail: a missing secret must fail here, not after a code was sent
  const sent = await deliver(code);
  if (!sent) return { undelivered: true };
  await db.query(
    `INSERT INTO account_codes (user_id, purpose, code_hash, target_email, attempts, created_at, expires_at)
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW() + make_interval(mins => $5))
     ON CONFLICT (user_id, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, target_email = EXCLUDED.target_email, attempts = 0, created_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [userId, purpose, codeHash, targetEmail, CODE_MINUTES],
  );
  return { ok: true, expires_in: CODE_MINUTES * 60 };
}

/**
 * Check a code. A right code is consumed (deleted) and its row returned. A wrong one costs a try.
 * The count and the comparison happen under a row lock, so two guesses cannot share one try.
 */
export async function redeemCode(db, { userId, purpose, code }) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return { invalid: true };
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT code_hash, target_email, attempts, expires_at > NOW() AS live FROM account_codes WHERE user_id = $1 AND purpose = $2 FOR UPDATE', [userId, purpose]);
    const row = rows[0];
    if (!row || !row.live || row.attempts >= CODE_MAX_ATTEMPTS) {
      if (row) await client.query('DELETE FROM account_codes WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
      await client.query('COMMIT');
      return { expired: true };
    }
    if (!sameHash(row.code_hash, hashCode(userId, purpose, code.trim()))) {
      await client.query('UPDATE account_codes SET attempts = attempts + 1 WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
      await client.query('COMMIT');
      return { wrong: true, remaining: CODE_MAX_ATTEMPTS - row.attempts - 1 };
    }
    await client.query('DELETE FROM account_codes WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
    await client.query('COMMIT');
    return { ok: true, targetEmail: row.target_email };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

export async function confirmWithCode(db, { userId, sid, code }) {
  if (!sid) return { unavailable: true };
  const result = await redeemCode(db, { userId, purpose: 'confirm', code });
  return result.ok ? grant(db, { userId, sid, method: 'email_code' }) : result;
}

/** Forget a session's confirmation, e.g. right after the one sensitive change it was given for. */
export async function clearConfirmation(db, sid) {
  if (sid) await db.query('DELETE FROM account_confirmations WHERE sid = $1', [sid]);
}

/**
 * Express gate for a sensitive account route. 403 `confirmation_required` when the session has
 * not confirmed lately; 403 `confirmation_unavailable` when the caller has no session to confirm in.
 */
export function requireConfirmation() {
  return async (req, res, next) => {
    try {
      const sid = req.auth?.sid || req.browserSession?.sid || null;
      const status = await confirmationStatus(req.db, { userId: req.user.id, sid });
      if (status.confirmed) return next();
      return res.status(403).json(status.available
        ? { success: false, error: 'Confirm it’s you first', code: 'confirmation_required' }
        : { success: false, error: 'This needs a signed-in browser session', code: 'confirmation_unavailable' });
    } catch (error) { return next(error); }
  };
}
