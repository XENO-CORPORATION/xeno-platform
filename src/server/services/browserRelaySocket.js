/**
 * The browser relay's WebSocket endpoint: the extension's half of `/api/v2/browser/connect`.
 * Wire shapes and their validation: utils/browserRelayProtocol.js. Delivery model: services/browserRelay.js.
 *
 *   server → { type: 'challenge', nonce }          immediately on connect
 *   client → { type: 'auth', accessToken, dpop }   within AUTH_WINDOW_MS, then
 *   server → { type: 'ready', installation }
 *   client → { type: 'hello', tools, extensionVersion }
 *
 * The proof's `htu` is `${issuer()}/api/v2/browser/connect` with NO query and NO trailing slash, and
 * `htm` is `GET` — the same rule `requireDpopIfBound` applies to HTTP, deliberately, so a proof is
 * shaped once in this ecosystem and not twice. The server-issued `nonce` is part of the proof, which is
 * what makes a captured proof useless on a second connection (RFC 9449 §8).
 *
 * 🔴 THE NONCE IS STORED, NOT RANDOM-EYEBALLED. A nonce the server generates but does not remember
 * proves nothing: it would accept any well-formed string. We keep it for the life of the handshake and
 * compare it byte for byte, then discard it.
 */
import crypto from 'node:crypto';
import { parseFrame, parseAuth, parseResult, parseApproval, parseTools, outbound, CLOSE, RelayProtocolError, parseProjects, RELAY_SURFACES } from '../utils/browserRelayProtocol.js';
import { verifyDpopProof } from '../utils/dpop.js';
import { resolveAuthedUser } from '../middleware/auth.js';
import { issuer } from '../config/hosts.js';
import { pool } from '../middleware/database.js';
import * as relay from '../services/browserRelay.js';
import * as installations from '../services/browserInstallations.js';

const AUTH_WINDOW_MS = 10_000;
const PING_INTERVAL_MS = 20_000;
/** A Corpus PC pings every 20 s. Nothing heard for this long means it's gone, however open the socket looks. */
const CORPUS_SILENT_MS = 60_000;

/** The path this module owns. `wss` is created with no `path`, so every upgrade reaches its handler and
 *  this is where we claim ours and hand the rest back. */
export const RELAY_PATH = RELAY_SURFACES.browser.path;

const surfaceForPath = (url) => Object.values(RELAY_SURFACES).find(({ path }) => url === path || url.startsWith(`${path}?`)) || null;

/** True when this upgrade is the relay's rather than the collaboration socket's. */
export function isRelayRequest(req) {
  return Boolean(surfaceForPath(String(req.url || '')));
}

const send = (ws, frame) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(frame)); } catch {} };
const closeWith = (ws, code, reason) => { try { ws.close(code, reason); } catch {} };

/** The request object `resolveAuthedUser` can read without a real HTTP round trip. */
function authRequest(req, accessToken) {
  return {
    headers: { ...req.headers, authorization: `Bearer ${accessToken}` },
    db: req.db,
  };
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 * @param {import('pg').Pool} [db] the caller's pool; defaults to the process pool. Passed in so a test (or
 *   any other composition) drives the real handshake against its own database rather than reaching for a
 *   global — and because 🔴 AN UPGRADE BYPASSES EXPRESS ENTIRELY: no middleware runs, so `req.db` is
 *   never set. Without this the handshake's first query throws, the catch reports `invalid_dpop_proof`,
 *   and a perfectly valid browser is told its key is wrong — a diagnosis that blames the wrong layer.
 */
export async function handleRelayConnection(ws, req, db = pool, { pingMs = PING_INTERVAL_MS, silentMs = CORPUS_SILENT_MS } = {}) {
  req.db = req.db || db;
  const nonce = crypto.randomBytes(18).toString('base64url');
  let installationId = null;
  let userId = null;
  let authed = false;
  let ping = null;

  const spec = surfaceForPath(String(req.url || '')) || RELAY_SURFACES.browser;
  const url = new URL(String(req.url || RELAY_PATH), 'https://relay.invalid');
  const requestedId = url.searchParams.get('installation');

  send(ws, outbound.challenge(nonce));

  const authTimer = setTimeout(() => {
    if (!authed) closeWith(ws, CLOSE.NO_AUTH, 'auth required within 10s');
  }, AUTH_WINDOW_MS);
  if (typeof authTimer.unref === 'function') authTimer.unref();

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (ping) clearInterval(ping);
    if (authed && relay.detach(ws) && spec.surface === 'corpus') relay.markCorpusGone(req.db, installationId);
  });
  ws.on('error', () => {});

  let heardAt = Date.now();
  ws.on('message', async (raw) => {
    heardAt = Date.now();
    let frame;
    try { frame = parseFrame(raw); }
    catch (e) { return closeWith(ws, e.closeCode || 1002, e.code || 'bad_frame'); }

    if (!authed) {
      if (frame.type !== 'auth') return closeWith(ws, CLOSE.NO_AUTH, 'auth first');
      try {
        const { accessToken, proof } = parseAuth(frame);
        // 1. Who is this, and is the token usable? The same resolution HTTP uses — one auth path.
        const resolved = await resolveAuthedUser(authRequest(req, accessToken));
        if (resolved.error || !resolved.user) return closeWith(ws, CLOSE.UNAUTHORIZED, 'invalid token');
        const jkt = resolved.auth?.dpopJkt;
        if (!jkt) return closeWith(ws, CLOSE.FORBIDDEN, 'token is not bound to a key');
        if (!String(resolved.auth?.scope || '').split(/\s+/).includes(spec.scope)) {
          return closeWith(ws, CLOSE.FORBIDDEN, `scope ${spec.scope} required`);
        }
        // 2. Is the proof from the key this token is bound to, over THIS url, with OUR nonce?
        await verifyDpopProof(req.db, {
          proof,
          method: 'GET',
          url: `${issuer()}${spec.path}`,
          accessToken,
          requiredJkt: jkt,
          nonce,
        });
        // 3. Does the person own this installation, is it still enabled, and is it THIS key?
        if (!requestedId) return closeWith(ws, CLOSE.FORBIDDEN, 'installation id required');
        // A browser names the row it was given at registration. A PC names the id it generated, scoped to the person holding the token.
        if (spec.surface === 'corpus' && !installations.INSTALLATION_ID.test(requestedId)) return closeWith(ws, CLOSE.FORBIDDEN, 'installation id required');
        const row = (await (spec.surface === 'corpus'
          ? req.db.query(`SELECT id, user_id, dpop_jkt, enabled, label, revoked_at, surface FROM browser_installations
              WHERE user_id = $1 AND installation_id = $2 AND surface = 'corpus' ORDER BY revoked_at IS NULL DESC, created_at DESC LIMIT 1`, [resolved.user.id, requestedId])
          : req.db.query(`SELECT id, user_id, dpop_jkt, enabled, label, revoked_at, surface FROM browser_installations WHERE id = $1`, [requestedId]))).rows[0];
        if (!row || row.revoked_at || row.surface !== spec.surface) return closeWith(ws, CLOSE.FORBIDDEN, 'installation revoked');
        if (String(row.user_id) !== String(resolved.user.id)) return closeWith(ws, CLOSE.FORBIDDEN, 'not yours');
        if (row.dpop_jkt !== jkt) return closeWith(ws, CLOSE.FORBIDDEN, 'key mismatch');
        if (!row.enabled) return closeWith(ws, CLOSE.FORBIDDEN, spec.off);

        authed = true;
        installationId = String(row.id);
        userId = String(resolved.user.id);
        clearTimeout(authTimer);
        relay.attach({ db: req.db, installation: row, installationId, socket: ws, np: nonce });
        send(ws, outbound.ready({ id: installationId, label: row.label, enabled: row.enabled }));
        // A browser that reconnects picks up whatever its conversation left waiting: the row survived
        // the socket, which is the reason the row exists at all.
        for (const call of await relay.pendingFor(req.db, installationId)) {
          send(ws, outbound.call({
            callId: call.call_id, tool: call.tool, args: call.args,
            conversationId: call.conversation_id, tabGroup: call.tab_group,
          }));
        }
        // The heartbeat also stamps last_seen_at, so "is this browser connected?" is answerable from the ROW on
        // every replica — the chat offers browser tools only for a browser seen within the last minute.
        await relay.touch(req.db, installationId);
        ping = setInterval(() => {
          // this stamp says the PC is there, so it needs the PC to have said something: a dead peer's socket can look open for minutes
          if (spec.surface === 'corpus' && Date.now() - heardAt > silentMs) { try { ws.terminate(); } catch {} return; }
          send(ws, outbound.pong()); relay.touch(req.db, installationId);
        }, pingMs);
        if (typeof ping.unref === 'function') ping.unref();
        return;
      } catch (e) {
        if (e instanceof RelayProtocolError) return closeWith(ws, CLOSE.UNAUTHORIZED, e.code);
        // The reason is logged as a CODE, never the token or the proof: this line has been read by
        // more people than the row has, and a stack can carry the request.
        console.error('BROWSERRELAY handshake failed', e && (e.oauthError || e.code || e.name), e && e.message);
        return closeWith(ws, CLOSE.UNAUTHORIZED, 'invalid_dpop_proof');
      }
    }

    // Authenticated frames.
    try {
      switch (frame.type) {
        case 'ping': return send(ws, outbound.pong());
        case 'hello': {
          const tools = parseTools(frame.tools);
          if (spec.surface === 'corpus') {
            await relay.recordCorpusHello(req.db, installationId, { tools: tools.map((t) => t.name), projects: parseProjects(frame.projects), appVersion: typeof frame.appVersion === 'string' ? frame.appVersion.slice(0, 40) : null });
            return;
          }
          await relay.recordHello(req.db, installationId, { tools, extensionVersion: frame.extensionVersion });
          return;
        }
        case 'ack': {
          await relay.markAcked(req.db, String(frame.callId || ''));
          return;
        }
        case 'approval': {
          const a = parseApproval(frame);
          await relay.markApproval(req.db, a.callId, a.state);
          return;
        }
        case 'result': {
          const r = parseResult(frame);
          await relay.recordResult(req.db, r.callId, r.ok, r.ok ? r.output : r.error, spec);
          await relay.touch(req.db, installationId);
          return;
        }
        default:
          // An unknown frame is refused with a reason rather than ignored: a silent drop reads to the
          // extension as a lost call, which is the ambiguity every other refusal here exists to remove.
          return send(ws, outbound.error('unknown_frame', `Unsupported frame type: ${String(frame.type).slice(0, 32)}`));
      }
    } catch (e) {
      if (e instanceof RelayProtocolError) return send(ws, outbound.error(e.code, e.message));
      console.error('[browser-relay] frame failed', e && e.message);
      return send(ws, outbound.error('internal', 'The platform could not record that.'));
    }
  });
}

export const _internals = { authRequest, AUTH_WINDOW_MS };
