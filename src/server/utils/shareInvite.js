/**
 * The SHARE INVITATION: a person who opens a live sign-in folder link (services/storageFolderLinks.js) while signed
 * out may create an account, even while registration is closed. The owner sent them that link; refusing the signup
 * would make the link useless to exactly the people it is for.
 *
 * Like the site-gate cookie (utils/siteGateCode.js) it is a signed, HttpOnly cookie read only server-side, so a
 * caller cannot assert it in a body field. It opens ACCOUNT CREATION ONLY: it shows no page and grants no file. The
 * folder itself still needs the live link AND a session on every request, so revoking the link takes the folder
 * away even from an account this invitation helped create.
 *
 * Value: `v1.<expiry seconds>.<link id>.<hmac>`, the HMAC covering expiry and link id. Life: one day.
 */
import crypto from 'node:crypto';
import { readCookie } from './siteGateCode.js';

export const SHARE_INVITE_HOURS = 24;
export const shareInviteCookieName = (env = process.env) => `${env.NODE_ENV === 'production' ? '__Host-' : ''}xeno_share_invite`;
const secretOf = (env) => env.SHARE_INVITE_SECRET || env.SITE_GATE_SECRET || env.JWT_SECRET || '';
const sign = (secret, expiresAt, linkId) => crypto.createHmac('sha256', secret).update(`share-invite.v1.${expiresAt}.${linkId}`).digest('base64url');

export function mintShareInvite(linkId, env = process.env, now = Date.now()) {
  const secret = secretOf(env);
  if (!secret || !/^[0-9a-f-]{36}$/i.test(String(linkId))) return null;
  const expiresAt = Math.floor(now / 1000) + SHARE_INVITE_HOURS * 3600;
  return `v1.${expiresAt}.${linkId}.${sign(secret, expiresAt, linkId)}`;
}

export function shareInviteValid(value, env = process.env, now = Date.now()) {
  const m = /^v1\.(\d{1,12})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(String(value || ''));
  const secret = secretOf(env);
  if (!m || !secret) return false;
  const expiresAt = Number(m[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;
  const a = Buffer.from(m[3]); const b = Buffer.from(sign(secret, expiresAt, m[2]));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Did this request arrive holding a valid share invitation? */
export function hasShareInvite(cookieHeader, env = process.env) {
  return shareInviteValid(readCookie(cookieHeader, shareInviteCookieName(env)), env);
}
