/**
 * Per-person site access codes (owner, 2026-10-20: "access codes we can give to investors to gain access").
 *
 * A code is a bearer secret handed to one person or one fund. Typed on the Coming soon page it sets a gate cookie
 * that names the CODE (not the person), and the page check re-reads the code's row on every request, so revoking or
 * expiring a code shuts every browser it opened. Only a SHA-256 of the code is stored; the plain code is returned once,
 * to the admin who created it, and never logged.
 *
 * Scopes:
 *   pages    — sees the gated pages. Not an account, not an API token: /api/ still needs a real session.
 *   account  — pages, plus may create an account while registration is closed. That reuses the signed share
 *              invitation from PR #824 (utils/shareInvite.js, keyed by the code's id), so registrationGate stays the
 *              ONE choke point and there is no second signup path. That invitation lives 24 h after redemption.
 *
 * The shared SITE_GATE_CODE (routes/siteGateRoutes.js) keeps working as a fallback until the owner unsets it.
 */
import crypto from 'node:crypto';

export const CODE_DEFAULT_DAYS = 30;
export const CODE_MAX_DAYS = 365;
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U: read aloud or typed from a mail without doubt

/** Strip what people add when copying a code out of an email: spaces, dashes, case. */
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashCode = (s) => crypto.createHash('sha256').update(`xeno-site-code.v1.${normalizeCode(s)}`).digest('hex');

/** 20 symbols of a 30-letter alphabet ≈ 98 bits, shown as XENO-XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateCode() {
  let out = '';
  while (out.length < 20) {
    const b = crypto.randomBytes(1)[0];
    if (b < 240) out += ALPHABET[b % 30]; // 240 = 8 × 30: rejection keeps every symbol equally likely
  }
  return `XENO-${out.match(/.{5}/g).join('-')}`;
}

/** Cloudflare's two-letter country, never an address. */
export const countryOf = (req) => {
  const c = String(req?.headers?.['cf-ipcountry'] || '').toUpperCase();
  return /^[A-Z0-9]{2}$/.test(c) ? c : null;
};

const view = (r) => ({
  id: r.id, label: r.label, scope: r.scope, createdAt: r.created_at, createdBy: r.created_by_name || null,
  expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at,
  lastUsedCountry: r.last_used_country, accounts: Number(r.accounts || 0),
  live: !r.revoked_at && new Date(r.expires_at) > new Date() && (r.max_uses == null || r.uses < r.max_uses),
});

export class AccessCodeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export async function createCode(db, { label, scope = 'pages', days = CODE_DEFAULT_DAYS, maxUses = null }, actorId) {
  const l = String(label || '').trim();
  if (!l || l.length > 160) throw new AccessCodeError('label_required');
  if (!['pages', 'account'].includes(scope)) throw new AccessCodeError('invalid_scope');
  const d = Number(days ?? CODE_DEFAULT_DAYS);
  if (!Number.isInteger(d) || d < 1 || d > CODE_MAX_DAYS) throw new AccessCodeError('invalid_expiry');
  const m = maxUses == null || maxUses === '' ? null : Number(maxUses);
  if (m !== null && (!Number.isInteger(m) || m < 1 || m > 10000)) throw new AccessCodeError('invalid_max_uses');
  const code = generateCode();
  const { rows } = await db.query(
    `INSERT INTO site_access_codes (label, code_hash, scope, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5::int), $6) RETURNING *`,
    [l, hashCode(code), scope, actorId, d, m]);
  await db.query(`INSERT INTO site_access_code_events (code_id, event, actor_id) VALUES ($1, 'created', $2)`, [rows[0].id, actorId]);
  return { code, accessCode: view(rows[0]) };
}

export async function listCodes(db) {
  const { rows } = await db.query(
    `SELECT c.*, u.email AS created_by_name,
            (SELECT count(*) FROM site_access_code_events e WHERE e.code_id = c.id AND e.event = 'used_by_account') AS accounts
       FROM site_access_codes c LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC LIMIT 500`);
  return rows.map(view);
}

export async function codeEvents(db, id) {
  const { rows } = await db.query(
    `SELECT e.event, e.country, e.at, u.email AS actor
       FROM site_access_code_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.code_id = $1 ORDER BY e.at DESC LIMIT 500`, [id]);
  return rows.map((r) => ({ event: r.event, country: r.country, at: r.at, actor: r.actor || null }));
}

export async function revokeCode(db, id, actorId) {
  const { rows } = await db.query(
    `UPDATE site_access_codes SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, actorId]);
  if (!rows[0]) throw new AccessCodeError('not_found_or_revoked', 404);
  await db.query(`INSERT INTO site_access_code_events (code_id, event, actor_id) VALUES ($1, 'revoked', $2)`, [id, actorId]);
  return view(rows[0]);
}

/** Spend one use of a live code. Returns { id, scope, expiresAt } or null — wrong, expired, revoked and used up all
 *  look the same to the person typing, so a guess learns nothing. */
export async function redeemCode(db, typed, country = null) {
  if (normalizeCode(typed).length < 16) return null;
  const { rows } = await db.query(
    `UPDATE site_access_codes SET uses = uses + 1, last_used_at = now(), last_used_country = $2
      WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)
      RETURNING id, scope, expires_at`, [hashCode(typed), country]);
  if (!rows[0]) return null;
  await db.query(`INSERT INTO site_access_code_events (code_id, event, country) VALUES ($1, 'redeemed', $2)`, [rows[0].id, country]);
  return { id: rows[0].id, scope: rows[0].scope, expiresAt: new Date(rows[0].expires_at) };
}

/** Is the code a cookie names still live? (Uses are spent at redemption; a cookie already issued is not a new use.) */
export async function codeIsLive(db, id) {
  const { rows } = await db.query(
    `SELECT 1 FROM site_access_codes WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`, [id]);
  return rows.length > 0;
}

/** Record once which signed-in account is browsing under a code. */
export async function noteAccount(db, id, userId) {
  await db.query(
    `INSERT INTO site_access_code_events (code_id, event, actor_id) VALUES ($1, 'used_by_account', $2)
     ON CONFLICT (code_id, actor_id) WHERE event = 'used_by_account' DO NOTHING`, [id, userId]);
}
