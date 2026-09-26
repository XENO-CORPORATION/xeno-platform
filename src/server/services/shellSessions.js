/**
 * XENO Shell shared sessions — discovery, identity and signalling. NEVER content.
 *
 * Modelled on VS Code Live Share's split (https://learn.microsoft.com/en-us/visualstudio/liveshare/reference/security):
 * the service does authentication and session discovery only. Everything a participant sees or
 * does travels peer-to-peer over an end-to-end encrypted WebRTC connection (DTLS-SRTP) between
 * the two XENO Shells, directly or through a TURN relay. This service carries only the SDP/ICE
 * handshake, and a compromised relay or a compromised copy of this service learns who met whom,
 * never what they did.
 *
 * What it issues:
 *  - A SESSION PASS: a short-lived JWT, signed with the same key as every XENO access token
 *    (verifiable offline against /api/oauth2/jwks), naming the person (sub + display name) and
 *    the ONE session they were let into. The host checks it before admitting anyone — the join
 *    code gets you to the door, the pass says who you are, and the host still approves.
 *  - TURN credentials, short-lived, so a leaked credential cannot run someone else's relay bill.
 *
 * The host's DTLS certificate fingerprint is published when the session is created and handed to
 * the guest with the pass. The guest's shell refuses a WebRTC connection whose remote fingerprint
 * differs, so even this service cannot impersonate a host: it would have to forge the DTLS key.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issuer } from '../config/hosts.js';
import { getSigningKey, getKeyByKid } from '../utils/oidcProvider.js';

export const SESSION_PASS_AUDIENCE = 'xeno-shell-session';
export const SESSION_PASS_TYP = 'xeno-session+jwt';
const PASS_TTL_SEC = 10 * 60;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const SIGNAL_TTL_MS = 5 * 60 * 1000;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_QUEUE = 200;

export class ShellSessionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ShellSessionError(status, code, message); };

// Readable, unambiguous alphabet: no 0/O, 1/I/L. 8 chars ≈ 40 bits, single-use, 15 minutes,
// and rate-limited — the code is a door handle, not the lock.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newJoinCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
const FINGERPRINT_RE = /^sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * Sessions live in memory: they are ephemeral by definition (SESSIONS Q3: guest seats do not
 * persist) and this service is a meeting point, not a record. A backend restart ends discovery
 * for live sessions; the peers' own connection is unaffected because it never ran through here.
 */
export class ShellSessionDirectory {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.sessions = new Map();   // sessionId -> session
    this.byCode = new Map();     // code -> sessionId
  }

  sweep() {
    const t = this.now();
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= t) this.end(id);
      else if (s.code && s.codeExpiresAt <= t) { this.byCode.delete(s.code); s.code = null; }
    }
  }

  create({ userId, displayName, fingerprint }) {
    this.sweep();
    if (!FINGERPRINT_RE.test(String(fingerprint || ''))) fail(400, 'bad_fingerprint', 'A DTLS certificate fingerprint (sha-256) is required.');
    const id = crypto.randomUUID();
    const session = {
      id, hostUserId: userId, hostName: String(displayName || 'Host').slice(0, 60), fingerprint,
      createdAt: this.now(), expiresAt: this.now() + SESSION_TTL_MS,
      code: null, codeExpiresAt: 0,
      // peerId -> { userId, name, queue: [] } ; the host is peer 'host'
      peers: new Map([['host', { userId, name: String(displayName || 'Host').slice(0, 60), queue: [] }]]),
    };
    this.sessions.set(id, session);
    this.rotateCode(id, userId);
    return this.hostView(session);
  }

  hostView(s) {
    return { session_id: s.id, join_code: s.code, code_expires_at: new Date(s.codeExpiresAt).toISOString(), expires_at: new Date(s.expiresAt).toISOString() };
  }

  requireHost(sessionId, userId) {
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt <= this.now()) fail(404, 'no_session', 'That session has ended.');
    if (s.hostUserId !== userId) fail(403, 'not_host', 'Only the host can do that.');
    return s;
  }

  rotateCode(sessionId, userId) {
    const s = this.requireHost(sessionId, userId);
    if (s.code) this.byCode.delete(s.code);
    let code;
    do { code = newJoinCode(); } while (this.byCode.has(code));
    s.code = code; s.codeExpiresAt = this.now() + CODE_TTL_MS;
    this.byCode.set(code, s.id);
    return this.hostView(s);
  }

  /**
   * A signed-in guest redeems a code. The code is consumed (single use) and a peer slot is made.
   * This does NOT admit anyone into the host's shell: the host still sees the verified name and
   * approves, over the encrypted peer connection.
   */
  redeem({ code, userId, displayName }) {
    this.sweep();
    const id = this.byCode.get(normCode(code));
    const s = id && this.sessions.get(id);
    if (!s || s.codeExpiresAt <= this.now()) fail(404, 'bad_code', 'That code is not valid or has expired.');
    if (s.hostUserId === userId) fail(409, 'own_session', 'This is your own session.');
    this.byCode.delete(s.code); s.code = null;
    const peerId = crypto.randomBytes(9).toString('base64url');
    s.peers.set(peerId, { userId, name: String(displayName || 'Guest').slice(0, 60), queue: [] });
    return { session: s, peerId };
  }

  /** Relay one signalling message (SDP / ICE / control) from one peer to another. */
  signal({ sessionId, fromPeerId, fromUserId, toPeerId, message }) {
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt <= this.now()) fail(404, 'no_session', 'That session has ended.');
    const from = s.peers.get(fromPeerId);
    if (!from || from.userId !== fromUserId) fail(403, 'not_peer', 'Not a participant in this session.');
    const to = s.peers.get(toPeerId);
    if (!to) fail(404, 'no_peer', 'That participant is not in this session.');
    // Guests may only talk to the host; the host may talk to anyone. Guests never learn each
    // other's addresses through us — every guest's connection is to the host alone.
    if (fromPeerId !== 'host' && toPeerId !== 'host') fail(403, 'guest_to_guest', 'Guests signal only the host.');
    const body = JSON.stringify(message ?? null);
    if (body.length > MAX_SIGNAL_BYTES) fail(413, 'too_large', 'Signalling message too large.');
    to.queue.push({ from: fromPeerId, message: JSON.parse(body), at: this.now() });
    if (to.queue.length > MAX_QUEUE) to.queue.splice(0, to.queue.length - MAX_QUEUE);
    return { ok: true };
  }

  /** Drain queued signalling messages for a peer. */
  receive({ sessionId, peerId, userId }) {
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt <= this.now()) fail(404, 'no_session', 'That session has ended.');
    const p = s.peers.get(peerId);
    if (!p || p.userId !== userId) fail(403, 'not_peer', 'Not a participant in this session.');
    const t = this.now();
    const out = p.queue.filter((m) => t - m.at < SIGNAL_TTL_MS);
    p.queue = [];
    const peers = peerId === 'host'
      ? [...s.peers.entries()].filter(([id]) => id !== 'host').map(([id, x]) => ({ peer_id: id, user_id: x.userId, name: x.name }))
      : undefined;
    return { messages: out.map((m) => ({ from: m.from, message: m.message })), ...(peers ? { peers } : {}) };
  }

  leave({ sessionId, peerId, userId }) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const p = s.peers.get(peerId);
    if (!p || p.userId !== userId) return;
    if (peerId === 'host') return this.end(sessionId);
    s.peers.delete(peerId);
    s.peers.get('host')?.queue.push({ from: peerId, message: { type: 'left' }, at: this.now() });
  }

  end(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.code) this.byCode.delete(s.code);
    this.sessions.delete(sessionId);
  }
}

/** Sign the session pass for a redeemed guest (and for the host, so both sides are symmetric). */
export async function mintSessionPass(db, { session, peerId, userId, displayName, role }) {
  const key = await getSigningKey(db);
  return jwt.sign(
    {
      iss: issuer(), sub: userId, aud: SESSION_PASS_AUDIENCE, typ: SESSION_PASS_TYP,
      sid_shell: session.id, peer_id: peerId, role, name: String(displayName || '').slice(0, 60),
      host_sub: session.hostUserId, host_fingerprint: session.fingerprint,
    },
    key.privatePem,
    { algorithm: key.alg, keyid: key.kid, expiresIn: PASS_TTL_SEC, header: { typ: SESSION_PASS_TYP, kid: key.kid }, jwtid: crypto.randomUUID() },
  );
}

/** Verification is the host's job; this mirror exists for tests and for the service's own checks. */
export async function verifySessionPass(db, token) {
  const decoded = jwt.decode(token, { complete: true });
  const key = decoded?.header?.kid ? await getKeyByKid(db, decoded.header.kid) : null;
  if (!key) fail(401, 'bad_pass', 'Unknown signing key.');
  const payload = jwt.verify(token, key.publicKey, { algorithms: [key.alg], audience: SESSION_PASS_AUDIENCE, issuer: issuer() });
  if (decoded.header.typ !== SESSION_PASS_TYP || payload.typ !== SESSION_PASS_TYP) fail(401, 'bad_pass', 'Not a session pass.');
  return payload;
}

/**
 * TURN credentials. STAND-IN (recorded 2026-09-26): Cloudflare Realtime TURN, keyed by
 * CF_TURN_KEY_ID / CF_TURN_KEY_API_TOKEN, to be replaced by our own coturn. Content is DTLS
 * end-to-end encrypted, so the relay only ever carries ciphertext. With no TURN configured the
 * shells still connect directly whenever the two networks allow it (STUN only).
 */
export async function iceServers({ fetchImpl = fetch } = {}) {
  const stun = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  const keyId = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_KEY_API_TOKEN;
  if (!keyId || !token) return { ice_servers: stun, relay: 'none' };
  try {
    const res = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 }),
    });
    if (!res.ok) return { ice_servers: stun, relay: 'unavailable' };
    const body = await res.json();
    const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    return { ice_servers: [...stun, ...servers], relay: 'cloudflare' };
  } catch {
    return { ice_servers: stun, relay: 'unavailable' };
  }
}
