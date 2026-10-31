/**
 * Two-step sign-in: an authenticator app, passkeys, and recovery codes for when both are lost.
 *
 * What is deliberate:
 * - A person opts in. An account with no second step signs in as it always has.
 * - No session exists between the first step and the second. The first step leaves a challenge that lives ten minutes,
 *   allows five tries, and can only become a session here. Ten wrong tries in fifteen minutes stop the account's second
 *   step whichever challenge they came through.
 * - A code's time step works once, so a code seen over a shoulder is already spent (RFC 6238 §5.2).
 * - Resetting a password never touches this: a stolen inbox must not switch two-step off.
 * - Passkeys must verify the person (fingerprint, face, PIN), which is why one signs in without a password.
 * - Recovery codes are stored only as a keyed hash and shown once. Losing every factor and every code means asking
 *   support, on purpose: there is no email bypass.
 * - The WebAuthn checks are @simplewebauthn/server's. Only TOTP is written here, because it is twenty lines of RFC.
 */
import crypto from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import QRCode from 'qrcode';
import { encrypt, decrypt } from '../utils/secretBox.js';
import { acceptedSiteOrigins, publicSiteOrigin } from '../config/hosts.js';
import { hashCode } from './accountConfirmation.js';

export const CHALLENGE_MINUTES = 10, CHALLENGE_TRIES = 5, ACCOUNT_TRIES = 10, ACCOUNT_WINDOW_MINUTES = 15, CEREMONY_MINUTES = 5, RECOVERY_CODES = 10;
const PERIOD = 30, ISSUER = 'XENO';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TwoStepError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// ---------- the authenticator: RFC 4226 / RFC 6238 ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } value &= (1 << bits) - 1; }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(text) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(text).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } value &= (1 << bits) - 1; }
  return Buffer.from(out);
}
export function totpAt(secret, step, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', secret).update(counter).digest();
  const at = h[h.length - 1] & 15;
  return String((h.readUInt32BE(at) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** The time step this code belongs to, one step either side for a slow clock, never one already used. */
export function matchTotp(secret, code, lastStep, nowMs = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(nowMs / 1000 / PERIOD);
  for (const step of [now - 1, now, now + 1]) if (step > Number(lastStep) && same(totpAt(secret, step), c)) return step;
  return null;
}

// ---------- what this account has ----------
export async function status(db, userId) {
  const [t, p, r] = await Promise.all([
    db.query('SELECT confirmed_at FROM account_totp WHERE user_id = $1', [userId]),
    db.query('SELECT id, name, backed_up, created_at, last_used_at FROM account_passkeys WHERE user_id = $1 ORDER BY created_at', [userId]),
    db.query('SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int AS left, COUNT(*)::int AS total FROM account_recovery_codes WHERE user_id = $1', [userId]),
  ]);
  const totp = !!t.rows[0]?.confirmed_at;
  return { on: totp || p.rows.length > 0, totp, passkeys: p.rows.map((x) => ({ id: x.id, name: x.name, syncs: x.backed_up, addedAt: x.created_at, lastUsedAt: x.last_used_at })), recoveryLeft: r.rows[0].left, recoveryTotal: r.rows[0].total };
}
export async function hasSecondStep(db, userId) {
  const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM account_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL) OR EXISTS (SELECT 1 FROM account_passkeys WHERE user_id = $1) AS on`, [userId]);
  return rows[0].on === true;
}
export async function methodsFor(db, userId) {
  const s = await status(db, userId);
  return [...(s.totp ? ['authenticator'] : []), ...(s.passkeys.length ? ['passkey'] : []), ...(s.recoveryLeft ? ['recovery_code'] : [])];
}

// ---------- recovery codes ----------
const normalCode = (code) => String(code || '').toLowerCase().replace(/[^a-z2-7]/g, '');
const makeCode = () => base32(crypto.randomBytes(10)).toLowerCase().match(/.{4}/g).join('-');
async function replaceCodes(db, userId) {
  const codes = Array.from({ length: RECOVERY_CODES }, makeCode);
  await db.query('DELETE FROM account_recovery_codes WHERE user_id = $1', [userId]);
  for (const c of codes) await db.query('INSERT INTO account_recovery_codes (user_id, code_hash) VALUES ($1,$2)', [userId, hashCode(userId, 'recovery', normalCode(c))]);
  return codes;
}
export async function newRecoveryCodes(db, userId) {
  if (!await hasSecondStep(db, userId)) throw new TwoStepError('two_step_off', 'Turn on two-step sign-in first.', 409);
  return replaceCodes(db, userId);
}
/** First factor: the person gets their codes now, while they are looking at this page. */
const firstCodes = async (db, userId) => ((await db.query('SELECT 1 FROM account_recovery_codes WHERE user_id = $1 LIMIT 1', [userId])).rowCount ? null : replaceCodes(db, userId));
/** With nothing left to recover, the codes would only be a way in. */
const dropCodesIfOff = async (db, userId) => { if (!await hasSecondStep(db, userId)) await db.query('DELETE FROM account_recovery_codes WHERE user_id = $1', [userId]); };
async function spendRecoveryCode(db, userId, code) {
  const n = normalCode(code);
  if (n.length !== 16) return false;
  return (await db.query('UPDATE account_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [userId, hashCode(userId, 'recovery', n)])).rowCount === 1;
}

// ---------- setting up the authenticator ----------
export async function beginTotp(db, user) {
  if ((await db.query('SELECT 1 FROM account_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL', [user.id])).rowCount) throw new TwoStepError('totp_already_on', 'Your authenticator app is already on.', 409);
  const secret = crypto.randomBytes(20), key = base32(secret);
  await db.query(`INSERT INTO account_totp (user_id, secret_enc) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, created_at = now(), last_step = 0`, [user.id, encrypt(secret.toString('base64'))]);
  const label = encodeURIComponent(`${ISSUER}:${user.username || user.email}`);
  const otpauth = `otpauth://totp/${label}?secret=${key}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=${PERIOD}`;
  return { key, otpauth, qrSvg: await QRCode.toString(otpauth, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}
const secretOf = (row) => Buffer.from(decrypt(row.secret_enc), 'base64');
export async function confirmTotp(db, userId, code) {
  const row = (await db.query('SELECT * FROM account_totp WHERE user_id = $1', [userId])).rows[0];
  if (!row) throw new TwoStepError('totp_not_started', 'Start setting up your authenticator app again.', 409);
  if (row.confirmed_at) throw new TwoStepError('totp_already_on', 'Your authenticator app is already on.', 409);
  const step = matchTotp(secretOf(row), code, 0);
  if (!step) throw new TwoStepError('code_wrong', 'That code isn’t right. Check your app shows XENO, and that your device’s time is correct.');
  await db.query('UPDATE account_totp SET confirmed_at = now(), last_step = $2 WHERE user_id = $1', [userId, step]);
  return { recoveryCodes: await firstCodes(db, userId) };
}
export async function removeTotp(db, userId) {
  const r = await db.query('DELETE FROM account_totp WHERE user_id = $1', [userId]);
  await dropCodesIfOff(db, userId);
  return { removed: r.rowCount > 0 };
}
/** A code from the app, once only. The row is locked so two requests cannot both spend one step. */
async function spendTotp(db, userId, code) {
  const tx = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await tx.query('BEGIN');
    const row = (await tx.query('SELECT * FROM account_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL FOR UPDATE', [userId])).rows[0];
    const step = row ? matchTotp(secretOf(row), code, row.last_step) : null;
    if (step) await tx.query('UPDATE account_totp SET last_step = $2 WHERE user_id = $1', [userId, step]);
    await tx.query('COMMIT');
    return !!step;
  } catch (e) { await tx.query('ROLLBACK').catch(() => {}); throw e; }
  finally { if (tx !== db) tx.release(); }
}

// ---------- passkeys ----------
export function relyingParty(env = process.env) {
  const rpID = env.PASSKEY_RP_ID || new URL(publicSiteOrigin()).hostname;
  const extra = String(env.PASSKEY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { rpID, rpName: ISSUER, origins: [...new Set([publicSiteOrigin(), ...acceptedSiteOrigins(), ...extra])] };
}
/** WebAuthn related origins: the other XENO site hosts that may use this relying party's passkeys. */
export const relatedOrigins = () => ({ origins: relyingParty().origins });

const ceremony = async (db, { userId = null, purpose, challenge }) => (await db.query(`INSERT INTO webauthn_ceremonies (user_id, purpose, challenge, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4)) RETURNING id`, [userId, purpose, challenge, CEREMONY_MINUTES])).rows[0].id;
async function useCeremony(db, id, { userId = null, purpose }) {
  if (!UUID.test(String(id || ''))) return null;
  const r = (await db.query(`DELETE FROM webauthn_ceremonies WHERE id = $1 AND purpose = $2 AND user_id IS NOT DISTINCT FROM $3 RETURNING challenge, expires_at`, [id, purpose, userId])).rows[0];
  if (!r || new Date(r.expires_at).getTime() < Date.now()) return null;
  return r.challenge;
}
const stale = (db) => db.query('DELETE FROM webauthn_ceremonies WHERE expires_at < now()').catch(() => {});

export async function passkeyRegistrationOptions(db, user) {
  stale(db);
  const rp = relyingParty();
  const mine = (await db.query('SELECT credential_id, transports FROM account_passkeys WHERE user_id = $1', [user.id])).rows;
  const options = await generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpID, userName: user.username || user.email, userDisplayName: user.display_name || user.username || user.email,
    userID: Buffer.from(String(user.id)), attestationType: 'none', excludeCredentials: mine.map((m) => ({ id: m.credential_id, transports: m.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { ceremonyId: await ceremony(db, { userId: user.id, purpose: 'register', challenge: options.challenge }), options };
}
export async function addPasskey(db, userId, { ceremonyId, response, name }) {
  const challenge = await useCeremony(db, ceremonyId, { userId, purpose: 'register' });
  if (!challenge) throw new TwoStepError('ceremony_expired', 'That took too long. Try adding the passkey again.', 409);
  const rp = relyingParty();
  let out;
  try { out = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origins, expectedRPID: rp.rpID, requireUserVerification: true }); }
  catch { throw new TwoStepError('passkey_refused', 'That passkey couldn’t be added.'); }
  if (!out.verified || !out.registrationInfo) throw new TwoStepError('passkey_refused', 'That passkey couldn’t be added.');
  const c = out.registrationInfo.credential;
  const label = String(name || '').trim().slice(0, 60) || 'Passkey';
  const row = (await db.query(`INSERT INTO account_passkeys (user_id, credential_id, public_key, counter, transports, backed_up, name) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (credential_id) DO NOTHING RETURNING id`,
    [userId, c.id, Buffer.from(c.publicKey), c.counter || 0, c.transports || [], !!out.registrationInfo.credentialBackedUp, label])).rows[0];
  if (!row) throw new TwoStepError('passkey_exists', 'That passkey is already in use.', 409);
  return { id: row.id, recoveryCodes: await firstCodes(db, userId) };
}
export async function renamePasskey(db, userId, id, name) {
  const label = String(name || '').trim();
  if (!UUID.test(String(id)) || !label || label.length > 60) throw new TwoStepError('invalid_name', 'Give it a name of up to 60 characters.');
  const r = await db.query('UPDATE account_passkeys SET name = $3 WHERE id = $1 AND user_id = $2', [id, userId, label]);
  if (!r.rowCount) throw new TwoStepError('passkey_not_found', 'That passkey isn’t on your account.', 404);
  return { ok: true };
}
export async function removePasskey(db, userId, id) {
  if (!UUID.test(String(id))) throw new TwoStepError('passkey_not_found', 'That passkey isn’t on your account.', 404);
  const r = await db.query('DELETE FROM account_passkeys WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!r.rowCount) throw new TwoStepError('passkey_not_found', 'That passkey isn’t on your account.', 404);
  await dropCodesIfOff(db, userId);
  return { removed: true };
}
const assertionOptions = async (allow = []) => {
  const rp = relyingParty();
  return generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials: allow.map((m) => ({ id: m.credential_id, transports: m.transports })) });
};
async function checkAssertion(db, { response, challenge, userId = null }) {
  const id = response && typeof response.id === 'string' ? response.id : '';
  const row = (await db.query('SELECT * FROM account_passkeys WHERE credential_id = $1', [id])).rows[0];
  if (!row || (userId && String(row.user_id) !== String(userId))) return null;
  const rp = relyingParty();
  let out;
  try {
    out = await verifyAuthenticationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origins, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports } });
  } catch { return null; }
  if (!out.verified) return null;
  await db.query('UPDATE account_passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [row.id, out.authenticationInfo.newCounter]);
  return row;
}
/** A passkey on its own signs in: it proved both the device and the person. */
export async function passkeySignInOptions(db) {
  stale(db);
  const options = await assertionOptions();
  return { ceremonyId: await ceremony(db, { purpose: 'sign_in', challenge: options.challenge }), options };
}
export async function passkeySignIn(db, { ceremonyId, response }) {
  const challenge = await useCeremony(db, ceremonyId, { purpose: 'sign_in' });
  if (!challenge) return null;
  const row = await checkAssertion(db, { response, challenge });
  return row ? row.user_id : null;
}
/** "Confirm it's you" with a passkey. */
export async function passkeyConfirmOptions(db, userId) {
  stale(db);
  const mine = (await db.query('SELECT credential_id, transports FROM account_passkeys WHERE user_id = $1', [userId])).rows;
  if (!mine.length) throw new TwoStepError('no_passkey', 'There’s no passkey on this account.', 409);
  const options = await assertionOptions(mine);
  return { ceremonyId: await ceremony(db, { userId, purpose: 'confirm', challenge: options.challenge }), options };
}
export async function passkeyConfirm(db, userId, { ceremonyId, response }) {
  const challenge = await useCeremony(db, ceremonyId, { userId, purpose: 'confirm' });
  return !!(challenge && await checkAssertion(db, { response, challenge, userId }));
}

// ---------- the second step ----------
async function accountTries(db, userId) {
  const { rows } = await db.query(`SELECT failures FROM two_step_throttle WHERE user_id = $1 AND window_started_at > now() - make_interval(mins => $2)`, [userId, ACCOUNT_WINDOW_MINUTES]);
  return rows[0]?.failures || 0;
}
async function countAccountFailure(db, userId) {
  await db.query(`INSERT INTO two_step_throttle (user_id, failures, window_started_at) VALUES ($1, 1, now())
    ON CONFLICT (user_id) DO UPDATE SET
      failures = CASE WHEN two_step_throttle.window_started_at > now() - make_interval(mins => $2) THEN two_step_throttle.failures + 1 ELSE 1 END,
      window_started_at = CASE WHEN two_step_throttle.window_started_at > now() - make_interval(mins => $2) THEN two_step_throttle.window_started_at ELSE now() END`, [userId, ACCOUNT_WINDOW_MINUTES]);
}
export async function startChallenge(db, { userId, mode, returnUrl = null, isNew = false }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('DELETE FROM two_step_challenges WHERE user_id = $1 OR expires_at < now()', [userId]);
  await db.query(`INSERT INTO two_step_challenges (token_hash, user_id, mode, return_url, is_new, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))`,
    [sha256(token), userId, mode, returnUrl && String(returnUrl).slice(0, 2000), !!isNew, CHALLENGE_MINUTES]);
  return token;
}
const liveChallenge = async (db, token) => (token ? (await db.query('SELECT * FROM two_step_challenges WHERE token_hash = $1 AND expires_at > now()', [sha256(token)])).rows[0] : null) || null;
export async function challengeInfo(db, token) {
  const c = await liveChallenge(db, token);
  return c ? { methods: await methodsFor(db, c.user_id) } : null;
}
export async function challengePasskeyOptions(db, token) {
  const c = await liveChallenge(db, token);
  if (!c) throw new TwoStepError('challenge_expired', 'That took too long. Sign in again.', 410);
  const mine = (await db.query('SELECT credential_id, transports FROM account_passkeys WHERE user_id = $1', [c.user_id])).rows;
  if (!mine.length) throw new TwoStepError('no_passkey', 'There’s no passkey on this account.', 409);
  const options = await assertionOptions(mine);
  await db.query('UPDATE two_step_challenges SET webauthn_challenge = $2 WHERE token_hash = $1', [c.token_hash, options.challenge]);
  return { options };
}
/** The second step. On success the challenge is gone and the caller makes the session it describes. */
export async function verifyChallenge(db, { token, method, code, response }) {
  const c = await liveChallenge(db, token);
  if (!c) throw new TwoStepError('challenge_expired', 'That took too long. Sign in again.', 410);
  if (c.attempts >= CHALLENGE_TRIES) { await db.query('DELETE FROM two_step_challenges WHERE token_hash = $1', [c.token_hash]); throw new TwoStepError('challenge_expired', 'Too many wrong tries. Sign in again.', 410); }
  if (await accountTries(db, c.user_id) >= ACCOUNT_TRIES) throw new TwoStepError('too_many_attempts', `Too many wrong tries. Wait ${ACCOUNT_WINDOW_MINUTES} minutes and try again.`, 429);
  let right = false;
  if (method === 'authenticator') right = await spendTotp(db, c.user_id, code);
  else if (method === 'recovery_code') right = await spendRecoveryCode(db, c.user_id, code);
  else if (method === 'passkey') right = !!(c.webauthn_challenge && await checkAssertion(db, { response, challenge: c.webauthn_challenge, userId: c.user_id }));
  else throw new TwoStepError('invalid_request', 'Choose how to confirm it’s you.');
  if (!right) {
    await db.query('UPDATE two_step_challenges SET attempts = attempts + 1, webauthn_challenge = NULL WHERE token_hash = $1', [c.token_hash]);
    await countAccountFailure(db, c.user_id);
    throw new TwoStepError('code_wrong', method === 'passkey' ? 'That passkey didn’t work. Try again.' : method === 'recovery_code' ? 'That recovery code isn’t right, or it was already used.' : 'That code isn’t right. Wait for a new one and try again.', 401);
  }
  // two requests racing with one challenge: only the one that deletes it gets a session
  const gone = await db.query('DELETE FROM two_step_challenges WHERE token_hash = $1', [c.token_hash]);
  if (!gone.rowCount) throw new TwoStepError('challenge_expired', 'That took too long. Sign in again.', 410);
  await db.query('DELETE FROM two_step_throttle WHERE user_id = $1', [c.user_id]);
  return { userId: c.user_id, mode: c.mode, returnUrl: c.return_url, isNew: c.is_new, method };
}
export const dropChallenge = (db, token) => (token ? db.query('DELETE FROM two_step_challenges WHERE token_hash = $1', [sha256(token)]) : null);

/** "Confirm it's you" with an authenticator code or a recovery code. */
export async function confirmWithFactor(db, userId, { authenticator, recovery }) {
  if (await accountTries(db, userId) >= ACCOUNT_TRIES) return { throttled: true };
  const method = authenticator ? 'authenticator' : 'recovery_code';
  const right = authenticator ? await spendTotp(db, userId, authenticator) : await spendRecoveryCode(db, userId, recovery);
  if (!right) { await countAccountFailure(db, userId); return { wrong: true }; }
  return { method };
}
