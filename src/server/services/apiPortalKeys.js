/**
 * API keys, through their one owner: the XENO API portal.
 *
 * The portal (repo xeno-api-platform, on the API host) makes a key, ties it to a billing project
 * and applies the per-plan limit. The platform does not copy that logic. When the account page
 * lists or makes a key, the platform backend asks the portal to do it FOR the signed-in person.
 *
 * How the portal knows who is asking: it accepts a platform token and checks it by calling the
 * platform back (portal/lib/platform-auth.ts). So this module mints a token for the caller that
 * lives for one minute and is sent to the portal and nowhere else. The portal never sees the
 * person's own session cookie.
 *
 * Revoking is still done here, in services/accountApiKeys.js, as a NAMED STAND-IN: on 2026-10-09
 * the portal's own revoke route (`DELETE /api/keys/:id`) writes a column `api_keys` does not have,
 * while its working revoke sits at an unreachable path. Exit: when the portal's revoke is fixed,
 * `revokeApiKey` becomes a call to it and the direct write goes. Recorded in
 * orchestrator/briefs/2026-10-09-api-portal-revoke-route-is-unreachable.md (workspace root).
 */
import jwt from 'jsonwebtoken';
import { apiOrigin } from '../config/hosts.js';
import { upstreamFetch } from './upstream.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
export const ACTING_TOKEN_SECONDS = 60;
const portalBase = () => String(process.env.XENO_API_PORTAL_URL || apiOrigin()).replace(/\/+$/, '');

/** A one-minute token that lets the portal act for this person. Carries the session when there is one, so signing out kills it. */
export function actingToken({ userId, sid = null }) {
  return jwt.sign({ userId, ...(sid ? { sid } : {}) }, process.env.JWT_SECRET || JWT_SECRET, { algorithm: 'HS256', expiresIn: ACTING_TOKEN_SECONDS });
}

async function portal(method, path, who, body) {
  let res;
  try {
    res = await upstreamFetch(`${portalBase()}${path}`, {
      target: 'xeno-api-portal', timeoutMs: 15000, idempotent: method === 'GET', method,
      headers: { authorization: `Bearer ${actingToken(who)}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return { unreachable: true, reason: String(error?.name || error?.message || 'error') };
  }
  let data = null;
  try { data = await res.json(); } catch { /* a non-JSON answer is treated as no answer */ }
  return { status: res.status, data };
}

const expired = (k) => Boolean(k.expiresAt && new Date(k.expiresAt) < new Date());
const view = (k) => ({
  id: k.id,
  name: k.name,
  // enough to recognise a key, never enough to use it
  preview: `${String(k.keyPrefix || '').replace(/[.…]+$/, '')}…`,
  is_active: k.status === 'ACTIVE' && !expired(k),
  revoked: k.status !== 'ACTIVE',
  expired: expired(k),
  created_at: k.createdAt || null,
  expires_at: k.expiresAt || null,
  last_used_at: k.lastUsedAt || null,
  usage_count: Number(k.totalRequests) || 0,
  project_name: k.projectName || null,
  workspace_name: k.workspaceName || null,
});

export async function listPortalKeys(who) {
  const r = await portal('GET', '/api/keys', who);
  if (r.unreachable || r.status >= 500 || !r.data) return { unavailable: true };
  if (r.status !== 200 || !Array.isArray(r.data.keys)) return { unavailable: true };
  return { ok: true, keys: r.data.keys.map(view) };
}

export async function createPortalKey(who, { name }) {
  if (typeof name !== 'string' || /[\u0000-\u001f\u007f]/.test(name)) return { invalid: true };
  const clean = name.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 100) return { invalid: true };
  const r = await portal('POST', '/api/keys', who, { name: clean });
  if (r.unreachable || !r.data || r.status >= 500) return { unavailable: true };
  // the portal answers 403 with its own sentence when the plan's key limit is reached
  if (r.status === 403) return { limit: true, message: typeof r.data.error === 'string' ? r.data.error : 'You’ve reached your plan’s limit of API keys.' };
  if (r.status === 400) return { invalid: true };
  if (r.status !== 200 || typeof r.data.key !== 'string' || !r.data.id) return { unavailable: true };
  return {
    ok: true,
    secret: r.data.key,
    key: { id: r.data.id, name: r.data.name || clean, preview: `${r.data.key.slice(0, 16)}…`, is_active: true, revoked: false, expired: false, created_at: r.data.createdAt || null, expires_at: null, last_used_at: null, usage_count: 0, project_name: r.data.projectName || null, workspace_name: r.data.workspaceName || null },
  };
}
