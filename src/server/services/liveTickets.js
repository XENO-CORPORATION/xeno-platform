/**
 * XENO Multiplayer join tickets and revocations (xeno-multiplayer SPEC §2, §6; owner-approved 2026-10-28). The platform
 * is the one authorization store: it checks the caller's access to a shared thing, then signs a 120-second ticket the
 * XENO Multiplayer service (wss://live.xenosystem.ai/v1/<type>/<id>) accepts once.
 *
 *   header  alg ES256, typ xeno-live-ticket+jwt, kid from /api/oauth2/jwks
 *   iss     the issuer of the provider the service discovers (xenosystem.ai), aud xeno-multiplayer
 *   sub     the person · act { sub: agent } when an agent acts for them (RFC 8693, as every platform assertion)
 *   name, kind (human|agent), xeno_resource "<type>/<id>", xeno_role owner|editor|viewer, iat, exp (60 s), jti
 *
 * Each app registers its resource types below: how a `<type>/<id>` maps to a role, decided by the platform's own
 * authority. A type nobody registered is refused. The ticket only gates joining; access that ends later is enforced by
 * `revoke()`, which asks the service to close that person's connections (and their agents') with 4403.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issuerForHost } from '../config/hosts.js';
import { getSigningKey } from '../utils/oidcProvider.js';
import { canvasRole } from './spawnCanvases.js';
import { canvasLiveRole, CanvasError as WorkspaceCanvasError } from './canvases.js';
import { docLiveRole, DocsError } from './workspaceDocs.js';

export const AUDIENCE = 'xeno-multiplayer';
export const TICKET_TYP = 'xeno-live-ticket+jwt';
export const REVOKE_TYP = 'xeno-live-revoke+jwt';
export const NOTIFY_TYP = 'xeno-live-notify+jwt';
export const TTL_SECONDS = 60;
// Where the service reads the platform's discovery; its tickets carry that provider's issuer (staged issuer move).
const DISCOVERY_HOST = 'xenosystem.ai';
const TYPE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export class LiveTicketError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

/**
 * The registry: `<type>` → (db, actor, id) → { role, userId, agentId }. Throws (a ComputeError or LiveTicketError)
 * when the caller has no access.
 */
export const RESOURCE_TYPES = Object.freeze({
  // A Spawn cloud canvas: <id> is the canvas (Spawn's project UUID), its role from the canvas record
  // (services/spawnCanvases.js).
  'spawn.canvas': async (db, actor, id) => {
    const { role, userId, agentId } = await canvasRole(db, actor, id);
    return { role, userId, agentId };
  },
  // A workspace canvas: <id> is the canvas, its role the one its own service gives. Saving stays that service's.
  'workspace.canvas': async (db, actor, id) => {
    const agent = actor.kind === 'agent';
    try {
      const role = await canvasLiveRole(db, { id: actor.id, kind: actor.kind }, id);
      return { role: agent && role === 'owner' ? 'editor' : role, userId: agent ? (actor.owner?.id ?? actor.owner) : actor.id, agentId: agent ? actor.id : null };
    } catch (e) {
      if (e instanceof WorkspaceCanvasError) throw new LiveTicketError(e.message, e.code, e.status);
      throw e;
    }
  },
  // A document (Office › Write and Notes, and a document node on a canvas): <id> is its stable file id. Everyone writing in
  // it joins the same shared document; one screen writes it down as a version through workspaceDocs.saveDoc.
  'workspace.doc': async (db, actor, id) => {
    try {
      const r = await docLiveRole(db, { id: actor.id, kind: actor.kind }, id);
      if (r.fileId.toLowerCase() !== String(id).toLowerCase()) throw new LiveTicketError('Join a document by its file id', 'not_file_id', 404);
      return { role: r.role, userId: r.userId, agentId: r.agentId };
    } catch (e) {
      if (e instanceof DocsError) throw new LiveTicketError(e.status === 404 ? 'Document not found' : e.message, e.code, e.status);
      throw e;
    }
  },
});

export function parseResource(resource) {
  const s = String(resource || '');
  const i = s.indexOf('/');
  const type = i > 0 ? s.slice(0, i) : '', id = i > 0 ? s.slice(i + 1) : '';
  if (!TYPE.test(type) || !ID.test(id)) throw new LiveTicketError('resource must be "<app>.<kind>/<id>"', 'invalid_resource');
  if (!Object.hasOwn(RESOURCE_TYPES, type)) throw new LiveTicketError(`"${type}" is not a shared type the platform knows`, 'unknown_type', 404);
  return { type, id, resource: `${type}/${id}` };
}

/** Check the caller's access and sign a ticket for one shared thing. */
export async function createTicket(db, actor, resource) {
  const r = parseResource(resource);
  const access = await RESOURCE_TYPES[r.type](db, actor, r.id);
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: String(access.userId), jti: crypto.randomUUID(), name: String(actor.display_name || actor.username || ''),
    kind: access.agentId ? 'agent' : 'human', xeno_resource: r.resource, xeno_role: access.role,
    ...(access.agentId ? { act: { sub: String(access.agentId) } } : {}),
  };
  const ticket = jwt.sign({ ...claims, iat: now, exp: now + TTL_SECONDS }, key.privatePem,
    { algorithm: 'ES256', keyid: key.kid, issuer: issuerForHost(DISCOVERY_HOST), audience: AUDIENCE, header: { typ: TICKET_TYP, kid: key.kid, alg: 'ES256' } });
  return { ticket, resource: r.resource, role: access.role, url: `${liveOrigin().replace(/^http/, 'ws')}/v1/${r.resource}`,
    protocols: ['xeno-live.v1', `ticket.${ticket}`], expiresAt: new Date((now + TTL_SECONDS) * 1000).toISOString() };
}

/**
 * A ticket for a SERVICE participant: the Spawn server on a machine joins the canvases bound to that machine as
 * kind "service" (it must obey the live input lease). Issued only by the platform, into the forwarded connection's
 * headers (services/computePorts.js) — the machine holds no credential of its own. sub = the machine id; role editor.
 */
export async function createServiceTicket(db, machineId, resource) {
  const r = parseResource(resource);
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ sub: String(machineId), jti: crypto.randomUUID(), name: 'Spawn server', kind: 'service', xeno_resource: r.resource,
    xeno_role: 'editor', iat: now, exp: now + TTL_SECONDS }, key.privatePem,
  { algorithm: 'ES256', keyid: key.kid, issuer: issuerForHost(DISCOVERY_HOST), audience: AUDIENCE, header: { typ: TICKET_TYP, kid: key.kid, alg: 'ES256' } });
}

/**
 * Tell everyone on one shared thing that something changed outside it (SPEC §6a). It says that, never what: each client
 * reads the platform with its own rights. Returns { ok, status }; a service that's down costs a live update, not the change.
 */
export async function notify(db, resource, data, { fetchImpl = globalThis.fetch } = {}) {
  const r = parseResource(resource);
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ sub: 'platform', xeno_resource: r.resource, jti: crypto.randomUUID(), iat: now, exp: now + TTL_SECONDS }, key.privatePem,
    { algorithm: 'ES256', keyid: key.kid, issuer: issuerForHost(DISCOVERY_HOST), audience: AUDIENCE, header: { typ: NOTIFY_TYP, kid: key.kid, alg: 'ES256' } });
  try {
    const res = await fetchImpl(`${liveOrigin()}/v1/${r.resource}/notify`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

export function liveOrigin() {
  return String(process.env.XENO_LIVE_URL || 'https://live.xenosystem.ai').replace(/\/+$/, '');
}

/** The platform-signed revoke token for `sub` on one shared thing (§6). */
export async function mintRevoke(db, resource, sub) {
  const r = parseResource(resource);
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ sub: String(sub), xeno_resource: r.resource, jti: crypto.randomUUID(), iat: now, exp: now + TTL_SECONDS }, key.privatePem,
    { algorithm: 'ES256', keyid: key.kid, issuer: issuerForHost(DISCOVERY_HOST), audience: AUDIENCE, header: { typ: REVOKE_TYP, kid: key.kid, alg: 'ES256' } });
}

/**
 * Ask the service to close every connection of `sub` (and agents acting for them) on one shared thing. Returns
 * { ok, status }; never throws for a service that is down, because the caller is ending access it already removed.
 */
export async function revoke(db, resource, sub, { fetchImpl = globalThis.fetch } = {}) {
  const r = parseResource(resource);
  const token = await mintRevoke(db, r.resource, sub);
  try {
    const res = await fetchImpl(`${liveOrigin()}/v1/${r.resource}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}
