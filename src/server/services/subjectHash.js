/**
 * A pseudonymous, non-reversible handle for a person, so evidence can outlive
 * the account it belongs to.
 *
 * ── THE PROBLEM THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `dataRetention.js` deliberately never prunes `checkout_consents`, because it
 * is the evidence a customer waived their statutory withdrawal right. That care
 * was defeated by a second path nobody looked at: `checkout_consents.user_id`
 * was `ON DELETE CASCADE`, and account deletion is a SELF-SERVICE endpoint
 * (`DELETE /api/auth/account`, gated only by the customer's own password).
 *
 * So the sequence was: buy → download → delete account → dispute the charge.
 * Our proof they agreed went with the account, and the burden of proof is ours.
 * The retention policy was honoured by the sweeper and silently defeated by the
 * foreign key.
 *
 * ── WHY A HASH AND NOT JUST `SET NULL` ──────────────────────────────────────
 *
 * 🔴 `SET NULL` alone is retention without a purpose, which is its own GDPR
 * problem. A nulled row proves SOMEBODY consented — not that THIS claimant did,
 * which is the only question the evidence exists to answer. Keeping a row that
 * cannot answer it is storage we cannot justify.
 *
 * With a hash, the row answers exactly one question and nothing else: a person
 * who contacts us gives their email, we derive the same handle, and the row
 * either matches or does not. It cannot be used to re-identify anyone we are
 * not already talking to, and it cannot be reversed into an address.
 *
 * Lawful basis for keeping it past an erasure request: GDPR Art. 17(3)(e) —
 * processing necessary "for the establishment, exercise or defence of legal
 * claims". That carve-out is narrow, so what is retained is narrow: a keyed
 * digest, never the address.
 *
 * ⚠️ NOT a plain SHA-256 of the email. Email addresses are low-entropy and
 * enumerable — an unkeyed digest of one is reversible by dictionary in seconds,
 * so it would be a pseudonym in name only. The key is what makes it one.
 *
 * ── 🔴 ROTATION, WHICH IS THE TRAP HERE ─────────────────────────────────────
 *
 * Rotating the key changes every future digest. If matching only ever tried the
 * current key, a routine secret rotation would silently orphan years of
 * evidence — nothing would error, and the loss would surface only when someone
 * needed the evidence and it "wasn't there".
 *
 * So digests carry a VERSION prefix and matching tries the current key AND every
 * retired one (`SUBJECT_HASH_SECRET_PREVIOUS`, comma-separated). Rotation is
 * survivable by design rather than by remembering.
 */
import crypto from 'crypto';

/** Bumped only if the derivation itself changes — not on key rotation. */
const SCHEME = '1';

/**
 * The active key.
 *
 * Falls back to JWT_SECRET so there is one fewer secret to provision — index.js
 * already refuses to boot in production without a real one, so an unset key
 * cannot degrade into a guessable literal.
 *
 * ⚠️ But note what that fallback COSTS here, because it does not cost the same
 * thing elsewhere: rotating JWT_SECRET is a routine security action, and for
 * download grants it merely invalidates in-flight links. For these digests it
 * changes the derivation, so anything hashed under the old value only remains
 * matchable via SUBJECT_HASH_SECRET_PREVIOUS. Set SUBJECT_HASH_SECRET
 * explicitly before the first sale and the two stop being coupled.
 */
function activeKey() {
  const key = process.env.SUBJECT_HASH_SECRET || process.env.JWT_SECRET;
  if (!key) {
    const e = new Error('subject hashing is not configured');
    e.code = 'subject_hash_unconfigured';
    throw e;
  }
  return key;
}

/** Retired keys, newest first. Digests made under these still match. */
function retiredKeys() {
  return String(process.env.SUBJECT_HASH_SECRET_PREVIOUS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Normalise before hashing, or the same person yields different digests.
 *
 * Case and surrounding whitespace only. Deliberately NOT gmail-style dot and
 * plus-tag folding: that is a guess about one provider's routing rules, and a
 * wrong guess here collapses two different people onto one handle — which would
 * make us produce the wrong person's consent record.
 */
function normalise(email) {
  return String(email || '').trim().toLowerCase();
}

function derive(email, key) {
  return `${SCHEME}:${crypto.createHmac('sha256', key).update(normalise(email), 'utf8').digest('hex')}`;
}

/**
 * The handle to STORE. Returns null for an empty address rather than hashing the
 * empty string — a digest of nothing looks like a real handle and would match
 * every other row that also had no address.
 */
export function subjectHash(email) {
  if (!normalise(email)) return null;
  return derive(email, activeKey());
}

/**
 * Every handle this address could be stored under — current key first, then
 * retired ones. Use this to MATCH, never `subjectHash()` alone.
 */
export function subjectHashCandidates(email) {
  if (!normalise(email)) return [];
  const keys = [activeKey(), ...retiredKeys()];
  return [...new Set(keys.map((k) => derive(email, k)))];
}

/**
 * Derive the handle for a user we already hold, by id.
 *
 * The caller passing an email would work and is exactly how it drifts: one call
 * site passes `user.email`, another passes an address off a form, and the two
 * disagree for the same person. The identifier of record is the row.
 *
 * Never throws — this is evidence enrichment, not a gate. A missing handle
 * weakens a future dispute; a thrown error would refuse a purchase that is
 * otherwise fine.
 */
export async function subjectHashForUser(pool, userId) {
  try {
    const r = await pool.query('SELECT email FROM users WHERE id = $1', [String(userId)]);
    return subjectHash(r.rows[0]?.email);
  } catch (e) {
    console.error('[SubjectHash] could not derive handle:', e.message);
    return null;
  }
}
