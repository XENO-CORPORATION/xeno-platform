/**
 * Capturing the consent that makes a digital sale final.
 *
 * ⚠️ NOT LEGAL ADVICE — a mechanism, not an opinion. Whether this wording suits
 * your entity is a question for a Rechtsanwalt. What is engineering is capturing
 * and proving the act, and that is what this does.
 *
 * See the migration for the statutory background. The short version: for digital
 * content delivered immediately, the 14-day withdrawal right is lost ONLY with
 * express prior consent to immediate performance PLUS acknowledgement that the
 * right is thereby lost. Miss either and a customer may use the software for
 * thirteen days and demand a full refund — and be entitled to it.
 */
import crypto from 'crypto';
import { subjectHashForUser, subjectHashCandidates } from './subjectHash.js';

/**
 * The exact wording presented at checkout.
 *
 * 🔴 Versioned by CONTENT, not by a number someone must remember to bump. The
 * hash is derived from the text, so editing a word necessarily changes the
 * version — which means an old consent can never silently claim to cover new
 * wording. A manual version string is a promise to remember; a content hash is
 * not.
 */
export const CONSENT_TEXT = [
  'I ask XENO to make the software and platform available to me immediately, '
  + 'before the 14-day withdrawal period ends.',
  'I understand that once XENO has begun providing it, I lose my right of '
  + 'withdrawal for that digital content.',
  'I accept the Terms of Service and have read the Privacy Policy and Refund Policy.',
].join('\n');

export const CONSENT_HASH = crypto.createHash('sha256').update(CONSENT_TEXT, 'utf8').digest('hex').slice(0, 16);

/** The three acknowledgements, each a distinct act. */
export const REQUIRED = Object.freeze(['immediatePerformance', 'withdrawalAcknowledged', 'termsAccepted']);

let ready = null;
export async function consentReady(pool) {
  if (ready) return ready;
  ready = pool
    .query("SELECT to_regclass('public.checkout_consents') AS t")
    .then((r) => Boolean(r.rows[0]?.t))
    .catch(() => false);
  return ready;
}

/**
 * Record a consent. Returns its id.
 *
 * 🔴 Throws when any acknowledgement is missing. This is the one place in the
 * codebase that must NOT be forgiving: a partial consent is not a weaker
 * consent, it is no consent, and recording it would create evidence that looks
 * like compliance while providing none.
 */
export async function recordConsent(pool, {
  userId, itemId, immediatePerformance, withdrawalAcknowledged, termsAccepted,
  locale = null, clientIp = null, userAgent = null,
}) {
  if (!userId || !itemId) {
    const e = new Error('consent requires a user and an item');
    e.status = 400;
    throw e;
  }
  const missing = [];
  if (immediatePerformance !== true) missing.push('immediatePerformance');
  if (withdrawalAcknowledged !== true) missing.push('withdrawalAcknowledged');
  if (termsAccepted !== true) missing.push('termsAccepted');
  if (missing.length) {
    const e = new Error(`consent incomplete: ${missing.join(', ')}`);
    e.status = 400;
    e.code = 'consent_incomplete';
    throw e;
  }

  /* A pseudonymous handle so this row still answers "did THIS person consent?"
   * after the account is gone. Account deletion is self-service and sets
   * user_id to NULL; without the handle the surviving row proves only that
   * SOMEBODY agreed, which rebuts nothing. Never throws — see subjectHash.js. */
  const subject = await subjectHashForUser(pool, userId);

  const r = await pool.query(
    `INSERT INTO checkout_consents
       (user_id, item_id, immediate_performance, withdrawal_acknowledged, terms_accepted,
        consent_text, consent_hash, locale, client_ip, user_agent, subject_hash)
     VALUES ($1,$2,TRUE,TRUE,TRUE,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [String(userId), String(itemId), CONSENT_TEXT, CONSENT_HASH,
      locale, clientIp, String(userAgent || '').slice(0, 512), subject],
  );
  return r.rows[0].id;
}

/**
 * The most recent unconsumed consent for this user and item, if it is still
 * fresh and still matches the CURRENT wording.
 *
 * ⚠️ Two rejections that look pedantic and are not:
 *
 * - STALE: a consent from six weeks ago was given in a different session, very
 *   likely on a different screen. Consent is to a specific purchase happening
 *   now, not a standing permission.
 * - WRONG WORDING: if the text has changed since, the person agreed to something
 *   we no longer show. Honouring it would mean claiming agreement to words they
 *   never saw.
 */
export async function findUsableConsent(pool, userId, itemId, { maxAgeMs = 60 * 60 * 1000 } = {}) {
  const r = await pool.query(
    `SELECT id, consent_hash, consented_at FROM checkout_consents
      WHERE user_id = $1 AND item_id = $2 AND consumed_at IS NULL
      ORDER BY consented_at DESC LIMIT 1`,
    [String(userId), String(itemId)],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.consent_hash !== CONSENT_HASH) return null;
  if (Date.now() - new Date(row.consented_at).getTime() > maxAgeMs) return null;
  return row.id;
}

/** Bind a consent to the session it authorised, and spend it. */
export async function consumeConsent(pool, consentId, checkoutSessionId) {
  if (!consentId) return;
  try {
    await pool.query(
      'UPDATE checkout_consents SET consumed_at = NOW(), checkout_session_id = $2 WHERE id = $1 AND consumed_at IS NULL',
      [consentId, checkoutSessionId || null],
    );
  } catch (e) {
    /* A consent that was given but whose bookkeeping failed is still a consent —
     * the row exists with its text and timestamp, which is what has to be
     * demonstrable. Failing the PURCHASE here would refuse a customer who did
     * everything right, over a write that only links two records. */
    console.error('[Consent] failed to mark consumed:', e.message);
  }
}

/**
 * Retrieve the consent evidence for one person, by email address.
 *
 * 🔴 This is the function the whole never-prune policy exists to make possible,
 * and without it the policy is storage with no reachable purpose. When a
 * chargeback lands or a customer writes "I never agreed to give up my
 * withdrawal right", THIS is what answers them — including after they have
 * deleted their account, which is precisely when the question gets asked.
 *
 * Matching is by keyed handle (`subject_hash`), never by joining `users`: the
 * account may be gone, and if it is gone the join returns nothing while the
 * evidence is sitting right there.
 *
 * Every candidate handle is tried, so a key rotation does not silently orphan
 * older records — see subjectHash.js.
 *
 * ⚠️ Returns the WORDING as it was shown, not today's wording. Answering a
 * dispute with the current text would be quoting words the customer may never
 * have seen, which is the same failure the staleness check in
 * `findUsableConsent` exists to prevent — one direction is a bad sale, the
 * other is a bad answer to a regulator.
 */
export async function findConsentEvidence(pool, email, { limit = 50 } = {}) {
  const candidates = subjectHashCandidates(email);
  if (!candidates.length) return [];
  const r = await pool.query(
    `SELECT id, item_id, consented_at, consumed_at, checkout_session_id,
            consent_text, consent_hash, locale, client_ip, user_agent,
            (user_id IS NULL) AS account_deleted
       FROM checkout_consents
      WHERE subject_hash = ANY($1)
      ORDER BY consented_at DESC
      LIMIT $2`,
    [candidates, limit],
  );
  return r.rows;
}
