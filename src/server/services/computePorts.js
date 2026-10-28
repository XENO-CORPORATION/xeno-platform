/**
 * XENO Compute named ports: a WebSocket from a person (or their agent) to a server their machine's image declares,
 * e.g. the Spawn server behind a cloud canvas (owner, 2026-10-28, xeno-spawn docs/specs/2026-10-28-cloud-and-multiplayer.md).
 *
 *   wss://<site>/api/compute/machines/<id>/ports/<name>/<rest>
 *
 * The platform holds the socket, so it can close it: every 30 s it asks again whether the caller may still reach the
 * machine (account usable, still an editor, machine still running) and closes the socket when not. Holding it open
 * counts as use for idle stop, a lone viewer included.
 *
 * Signing in. A browser cannot put a token on a WebSocket, so it asks POST /api/compute/machines/<id>/port-tickets
 * {port} (signed in as usual; outside the port path, which nginx proxies as an upgrade) for a one-use ticket that
 * lives 60 s, and offers it as the subprotocol `xeno-ticket.<ticket>` beside `xeno-port.v1`, which keeps it out of
 * URLs and logs. A program can send its usual `Authorization: Bearer` instead.
 *
 * Identity to the server behind the port. Every connection carries `X-Xeno-Assertion`: a 60-second ES256 assertion
 * signed with the platform's OIDC key (/api/oauth2/jwks), one audience per port, refused by every platform API:
 *
 *   aud xeno-<port>  typ xeno-<port>-assertion+jwt  sub the person  act { sub: agent } when an agent acts for its owner
 *   jti  xeno_workspace  xeno_canvas (the machine id, for now)  xeno_role owner|editor  name  kind human|agent
 *
 * and `X-Xeno-Forwarded-Prefix`. The machine never sees a platform token, cookie or the Worker's token.
 *
 * WebSocket only. Serving HTTP from a machine would run the machine's pages as the platform's own origin; that needs
 * a separate site (as Codespaces uses *.app.github.dev) and is not built.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { issuerForHost } from '../config/hosts.js';
import { getSigningKey } from '../utils/oidcProvider.js';
import { verifyDpopProof } from '../utils/dpop.js';
import { resolveAuthedUser } from '../middleware/auth.js';
import { resolvePrincipal, assertPrincipalUsable } from './agentIdentity.js';
import * as compute from './compute.js';
import { computeBackend } from './computeBackend.js';
import { canvasesOnMachine } from './spawnCanvases.js';
import { createServiceTicket } from './liveTickets.js';
import { shellEnabledFor, connectionKey, renewConnection, endConnection } from './cloudShell.js';

/** The named ports the platform forwards, and the audience each one's assertion is for. */
// `discoveryHost` is where the server behind the port reads the platform's discovery; its assertions carry THAT
// provider's issuer, so they match while the issuer moves host by host (docs/decisions/2026-10-28-oidc-issuer-staged-move.md).
// Spawn reads https://xenosystem.ai (xeno-spawn forwardAssertion.js, rc.90).
export const PORTS = Object.freeze({
  spawn: { audience: 'xeno-spawn', typ: 'xeno-spawn-assertion+jwt', discoveryHost: 'xenosystem.ai' },
  // Cloud Shell (services/cloudShell.js): behind SHELL_ENABLED, and each connection carries its own short-lived key.
  shell: { audience: 'xeno-shell', typ: 'xeno-shell-assertion+jwt', discoveryHost: 'xenosystem.ai', gated: true },
});
export const PORT_PATH = /^\/api\/compute\/machines\/(mch_[0-9a-f]{32})\/ports\/([a-z][a-z0-9-]{0,31})(\/[^?#]*)?$/;
export const TICKET_SECONDS = 60;
export const ASSERTION_SECONDS = 60;
export const RECHECK_MS = 30_000;
const TICKET_PROTOCOL = /^xeno-ticket\.([A-Za-z0-9_-]{43})$/;
const MAX_BUFFERED = 256;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function portSpec(name) {
  const spec = Object.hasOwn(PORTS, name) ? PORTS[name] : null;
  if (!spec) throw new compute.ComputeError(`There is no port named "${name}"`, 'unknown_port', 404);
  return spec;
}

/** The caller as Compute sees it, from a user id (a person or an agent); a suspended account resolves to nothing. */
export async function actorFor(db, userId) {
  const p = await resolvePrincipal(db, userId);
  assertPrincipalUsable(p);
  return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
}

/** A one-use ticket to open the port's WebSocket from a browser. */
export async function createTicket(db, actor, machineId, name, { workspace } = {}) {
  const spec = portSpec(name);
  const { ctx, m } = await compute.portAccess(db, actor, machineId, { workspace });
  if (spec.gated && (ctx.agentId || !(await shellEnabledFor(db, ctx.userId)))) throw new compute.ComputeError('Cloud Shell is not open to your account yet', 'shell_not_enabled', 403);
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TICKET_SECONDS * 1000);
  await db.query(`INSERT INTO compute_port_tickets (ticket_hash, machine_id, port, user_id, workspace_id, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6)`, [sha256(ticket), m.id, name, actor.id, ctx.workspaceId, expires]);
  await db.query("DELETE FROM compute_port_tickets WHERE expires_at < now() - interval '1 hour'");
  return { path: `/api/compute/machines/${m.id}/ports/${name}/`, protocols: ['xeno-port.v1', `xeno-ticket.${ticket}`], expiresAt: expires.toISOString() };
}

/** Spend a ticket once, for this machine and port only. Returns who it was issued to, or null. */
export async function spendTicket(db, ticket, machineId, name) {
  const r = (await db.query(`UPDATE compute_port_tickets SET used_at = now()
     WHERE ticket_hash = $1 AND machine_id = $2 AND port = $3 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id, workspace_id`, [sha256(ticket), machineId, name])).rows[0];
  return r ? { userId: String(r.user_id), workspaceId: String(r.workspace_id) } : null;
}

/** The assertion the server behind the port verifies (see the header comment). */
export async function mintPortAssertion(db, name, { ctx, m, role }, actor) {
  const spec = portSpec(name);
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: String(ctx.userId), jti: crypto.randomUUID(), xeno_workspace: String(ctx.workspaceId), xeno_canvas: m.id, xeno_role: role,
    name: String(actor.display_name || actor.username || ''), kind: ctx.agentId ? 'agent' : 'human',
    ...(ctx.agentId ? { act: { sub: String(ctx.agentId) } } : {}),
  };
  return jwt.sign({ ...claims, iat: now, exp: now + ASSERTION_SECONDS }, key.privatePem,
    { algorithm: 'ES256', keyid: key.kid, issuer: issuerForHost(spec.discoveryHost), audience: spec.audience, header: { typ: spec.typ, kid: key.kid, alg: 'ES256' } });
}

/**
 * A program's sign-in on the upgrade: the same token resolution as every HTTP route. A token bound to a key (DPoP)
 * must come as `Authorization: DPoP <token>` with a proof over GET and the https form of the port URL without its
 * query, exactly as requireDpopIfBound asks of an HTTP call, so a stolen bound token cannot be replayed as Bearer.
 */
export async function authenticateUpgrade(db, req) {
  const a = await resolveAuthedUser({ headers: req.headers, db });
  if (!a.user) return null;
  if (a.auth?.dpopJkt) {
    const m = /^DPoP\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) throw Object.assign(new Error('This token is bound to a key: send it as DPoP with a proof'), { statusCode: 401 });
    try {
      await verifyDpopProof(db, { proof: String(req.headers.dpop || ''), method: 'GET', accessToken: m[1], requiredJkt: a.auth.dpopJkt,
        url: `${issuerForHost(req.headers.host)}${new URL(req.url, 'http://x').pathname}` });
    } catch (e) { throw Object.assign(new Error(`DPoP proof refused: ${e.message}`), { statusCode: 401 }); }
  }
  return String(a.user.id);
}

export function isPortRequest(req) {
  try { return PORT_PATH.test(new URL(req.url, 'http://x').pathname); } catch { return false; }
}

/** Pick the subprotocol the server answers with: ours, never the ticket. For the `ws` server's handleProtocols. */
export function selectProtocol(protocols) {
  return protocols.has('xeno-port.v1') ? 'xeno-port.v1' : false;
}

const closeWith = (sock, code, reason) => { try { sock.close(code, String(reason).slice(0, 120)); } catch { /* gone */ } };
const codeFor = (e) => (e?.statusCode === 401 || e?.code === 'not_signed_in' ? 4401 : e?.statusCode === 404 ? 4404 : e?.statusCode === 409 ? 4409 : 4403);

/**
 * Handle one accepted client socket on a named-port path. `authenticate(req)` resolves a Bearer token to a user id
 * (the route's own sign-in), used when no ticket is offered.
 */
export async function handlePortConnection(client, req, db, { authenticate, recheckMs = RECHECK_MS } = {}) {
  const url = new URL(req.url, 'http://x');
  const [, machineId, name, rest] = url.pathname.match(PORT_PATH);
  const buffered = [];
  let upstream = null, timer = null, closed = false, shellKeyId = null;
  client.on('message', (data, isBinary) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (buffered.length < MAX_BUFFERED) buffered.push([data, isBinary]);
    else closeWith(client, 4429, 'Too much sent before the machine answered');
  });
  const end = () => {
    if (closed) return; closed = true; clearInterval(timer);
    if (upstream) try { upstream.terminate(); } catch { /* gone */ }
    if (shellKeyId) endConnection(db, shellKeyId); // the shell's key dies with its connection
  };
  client.on('close', end); client.on('error', end);

  try {
    portSpec(name);
    // who: a ticket offered as a subprotocol, else the usual Bearer sign-in
    const offered = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
    const ticket = offered.map((p) => p.match(TICKET_PROTOCOL)?.[1]).find(Boolean);
    let userId = null, workspace;
    if (ticket) {
      const t = await spendTicket(db, ticket, machineId, name);
      if (!t) throw Object.assign(new Error('That ticket is used, expired or for another port'), { statusCode: 401 });
      ({ userId } = t); workspace = t.workspaceId;
    } else if (authenticate) userId = await authenticate(req);
    if (!userId) throw Object.assign(new Error('Sign in first'), { statusCode: 401 });

    const check = async () => {
      const a = await compute.portAccess(db, await actorFor(db, userId), machineId, { workspace });
      if (shellKeyId) await renewConnection(db, shellKeyId, userId); // Cloud Shell: still allowed, key kept alive
      return a;
    };
    const actor = await actorFor(db, userId);
    const access = await compute.portAccess(db, actor, machineId, { workspace });
    if (closed) return;
    const assertion = await mintPortAssertion(db, name, access, actor);
    const target = computeBackend().portSocket(access.m, name, (rest || '/') + url.search);
    // The Spawn server joins this machine's canvases on XENO Multiplayer as a service participant: its tickets ride
    // the forwarded connection, so the machine holds no credential (base64url JSON [{resource, ticket}], ≤ 20).
    // Cloud Shell: the person's Cloud Shell agent gets a key for this connection only (revoked in end()).
    let shellKey = null;
    if (name === 'shell') { const k = await connectionKey(db, access.ctx); shellKey = k.key; shellKeyId = k.keyId; if (closed) { endConnection(db, shellKeyId); return; } }
    const live = name === 'spawn' ? await Promise.all((await canvasesOnMachine(db, machineId)).map(async (id) =>
      ({ resource: `spawn.canvas/${id}`, ticket: await createServiceTicket(db, machineId, `spawn.canvas/${id}`) }))) : [];
    upstream = new WebSocket(target.url, { headers: { ...target.headers, 'x-xeno-assertion': assertion,
      'x-xeno-forwarded-prefix': `/api/compute/machines/${machineId}/ports/${name}`,
      ...(live.length ? { 'x-xeno-live-tickets': Buffer.from(JSON.stringify(live)).toString('base64url') } : {}),
      ...(shellKey ? { 'x-xeno-shell-key': shellKey } : {}) } });
    upstream.on('open', () => {
      for (const [d, b] of buffered.splice(0)) upstream.send(d, { binary: b });
      compute.recordPortOpened(db, machineId, access.ctx, name).catch(() => {});
    });
    upstream.on('message', (d, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(d, { binary: isBinary }); });
    upstream.on('close', (code, reason) => { closeWith(client, code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011, reason || 'The machine closed the connection'); end(); });
    upstream.on('unexpected-response', (_r, res) => { closeWith(client, res.statusCode === 503 ? 4503 : 4502, `The machine refused the connection (${res.statusCode})`); end(); });
    upstream.on('error', () => { closeWith(client, 1011, 'The machine could not be reached'); end(); });
    // the platform keeps the right to close: ask again, and count the open socket as use
    timer = setInterval(() => { check().catch((e) => { closeWith(client, codeFor(e), e.message || 'Access ended'); end(); }); }, recheckMs);
    timer.unref?.();
  } catch (e) {
    closeWith(client, codeFor(e), e.message || 'Refused');
    end();
  }
}
