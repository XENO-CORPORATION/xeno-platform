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

/*
 * WHERE SESSIONS LIVE. The backend runs as several replicas behind one upstream, so a host and a
 * guest are routinely served by different processes; a session held in one process's memory is
 * invisible to the others and the join fails at random. Sessions therefore live in a SHARED store
 * — Redis in production (`RedisSessionStore`), the one the platform already runs — and in memory
 * only for tests and single-process development (`MemorySessionStore`).
 *
 * Sessions stay ephemeral by design (SESSIONS Q3: guest seats do not persist): every key carries a
 * TTL, and the peers' own connection never runs through here, so losing the store ends discovery,
 * not a live session.
 *
 * The store contract is deliberately small, and the two operations that MUST be atomic are atomic
 * in both implementations: redeeming a code (two guests racing the same code — exactly one wins)
 * and draining a signalling queue (a message is delivered once, never twice, never lost).
 */

/** In-process store. Tests and single-process development only. */
export class MemorySessionStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.kv = new Map();     // key -> { value, exp }
    this.lists = new Map();  // key -> { items, exp }
    this.hashes = new Map(); // key -> { map, exp }
  }
  _live(m, key) { const e = m.get(key); if (e && e.exp <= this.now()) { m.delete(key); return undefined; } return e; }
  async get(key) { return this._live(this.kv, key)?.value ?? null; }
  async set(key, value, ttlMs) { this.kv.set(key, { value, exp: this.now() + ttlMs }); }
  async setNx(key, value, ttlMs) { if (this._live(this.kv, key)) return false; await this.set(key, value, ttlMs); return true; }
  // No await between the read and the delete: that gap is exactly where two redeems would race.
  async take(key) { const v = this._live(this.kv, key)?.value ?? null; this.kv.delete(key); return v; }
  async del(...keys) { for (const k of keys) { this.kv.delete(k); this.lists.delete(k); this.hashes.delete(k); } }
  async hset(key, field, value, ttlMs) {
    const e = this._live(this.hashes, key) || { map: new Map(), exp: 0 };
    e.map.set(field, value); e.exp = this.now() + ttlMs; this.hashes.set(key, e);
  }
  async hget(key, field) { return this._live(this.hashes, key)?.map.get(field) ?? null; }
  async hdel(key, field) { this._live(this.hashes, key)?.map.delete(field); }
  async hgetall(key) { return Object.fromEntries(this._live(this.hashes, key)?.map ?? []); }
  async push(key, value, cap, ttlMs) {
    const e = this._live(this.lists, key) || { items: [], exp: 0 };
    e.items.push(value); if (e.items.length > cap) e.items.splice(0, e.items.length - cap);
    e.exp = this.now() + ttlMs; this.lists.set(key, e);
  }
  async drain(key) { const e = this._live(this.lists, key); this.lists.delete(key); return e ? e.items : []; }
  async hit(key, windowMs) {
    const e = this._live(this.kv, key);
    if (!e) { await this.set(key, 1, windowMs); return 1; }
    e.value += 1; return e.value;
  }
}

/** Shared store on Redis (ioredis client). What production uses. */
export class RedisSessionStore {
  constructor(redis) { this.r = redis; }
  async get(key) { const v = await this.r.get(key); return v === null ? null : JSON.parse(v); }
  async set(key, value, ttlMs) { await this.r.set(key, JSON.stringify(value), 'PX', Math.max(1, Math.ceil(ttlMs))); }
  async setNx(key, value, ttlMs) { return (await this.r.set(key, JSON.stringify(value), 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX')) === 'OK'; }
  // GETDEL is atomic: two guests redeeming the same code cannot both get the session.
  async take(key) { const v = await this.r.getdel(key); return v === null ? null : JSON.parse(v); }
  async del(...keys) { if (keys.length) await this.r.del(...keys); }
  async hset(key, field, value, ttlMs) { await this.r.multi().hset(key, field, JSON.stringify(value)).pexpire(key, Math.ceil(ttlMs)).exec(); }
  async hget(key, field) { const v = await this.r.hget(key, field); return v === null ? null : JSON.parse(v); }
  async hdel(key, field) { await this.r.hdel(key, field); }
  async hgetall(key) { const h = await this.r.hgetall(key); return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, JSON.parse(v)])); }
  async push(key, value, cap, ttlMs) {
    await this.r.multi().rpush(key, JSON.stringify(value)).ltrim(key, -cap, -1).pexpire(key, Math.ceil(ttlMs)).exec();
  }
  // Read-and-clear in one transaction: a message pushed between the read and the delete would
  // otherwise be lost.
  async drain(key) {
    const res = await this.r.multi().lrange(key, 0, -1).del(key).exec();
    const [err, items] = res[0];
    if (err) throw err;
    return items.map((x) => JSON.parse(x));
  }
  async hit(key, windowMs) {
    const res = await this.r.multi().incr(key).pexpire(key, windowMs, 'NX').exec();
    return res[0][1];
  }
}

const K = {
  session: (id) => `shell:s:${id}`,
  code: (code) => `shell:code:${code}`,
  peers: (id) => `shell:p:${id}`,
  queue: (id, peer) => `shell:q:${id}:${peer}`,
  attempts: (user) => `shell:rl:${user}`,
};

export class ShellSessionDirectory {
  constructor({ store, now = Date.now } = {}) {
    this.now = now;
    this.store = store || new MemorySessionStore({ now });
  }

  async load(sessionId) {
    const s = await this.store.get(K.session(sessionId));
    if (!s || s.expiresAt <= this.now()) fail(404, 'no_session', 'That session has ended.');
    return s;
  }
  ttl(s) { return Math.max(1, s.expiresAt - this.now()); }

  async create({ userId, displayName, fingerprint }) {
    if (!FINGERPRINT_RE.test(String(fingerprint || ''))) fail(400, 'bad_fingerprint', 'A DTLS certificate fingerprint (sha-256) is required.');
    const id = crypto.randomUUID();
    const name = String(displayName || 'Host').slice(0, 60);
    const session = {
      id, hostUserId: userId, hostName: name, fingerprint,
      createdAt: this.now(), expiresAt: this.now() + SESSION_TTL_MS,
      code: null, codeExpiresAt: 0,
    };
    await this.store.set(K.session(id), session, SESSION_TTL_MS);
    await this.store.hset(K.peers(id), 'host', { userId, name }, SESSION_TTL_MS);
    return this.rotateCode(id, userId);
  }

  hostView(s) {
    return { session_id: s.id, join_code: s.code, code_expires_at: new Date(s.codeExpiresAt).toISOString(), expires_at: new Date(s.expiresAt).toISOString() };
  }

  async requireHost(sessionId, userId) {
    const s = await this.load(sessionId);
    if (s.hostUserId !== userId) fail(403, 'not_host', 'Only the host can do that.');
    return s;
  }

  async rotateCode(sessionId, userId) {
    const s = await this.requireHost(sessionId, userId);
    if (s.code) await this.store.del(K.code(s.code));
    let code;
    // SET NX: a code already pointing at another live session is never overwritten.
    do { code = newJoinCode(); } while (!(await this.store.setNx(K.code(code), s.id, CODE_TTL_MS)));
    s.code = code; s.codeExpiresAt = this.now() + CODE_TTL_MS;
    await this.store.set(K.session(s.id), s, this.ttl(s));
    return this.hostView(s);
  }

  /** The session record, for minting the host's pass. */
  async get(sessionId) { return this.load(sessionId); }

  /**
   * A signed-in guest redeems a code. The code is consumed (single use, atomically) and a peer
   * slot is made. This does NOT admit anyone into the host's shell: the host still sees the
   * verified name and approves, over the encrypted peer connection.
   */
  async redeem({ code, userId, displayName }) {
    const key = K.code(normCode(code));
    const id = await this.store.get(key);
    const s = id ? await this.store.get(K.session(id)) : null;
    if (!s || s.expiresAt <= this.now() || s.codeExpiresAt <= this.now()) fail(404, 'bad_code', 'That code is not valid or has expired.');
    // Checked BEFORE the code is consumed, so a host testing their own code does not burn it.
    if (s.hostUserId === userId) fail(409, 'own_session', 'This is your own session.');
    if ((await this.store.take(key)) !== s.id) fail(404, 'bad_code', 'That code is not valid or has expired.');
    s.code = null;
    await this.store.set(K.session(s.id), s, this.ttl(s));
    const peerId = crypto.randomBytes(9).toString('base64url');
    await this.store.hset(K.peers(s.id), peerId, { userId, name: String(displayName || 'Guest').slice(0, 60) }, this.ttl(s));
    return { session: s, peerId };
  }

  /** Relay one signalling message (SDP / ICE / control) from one peer to another. */
  async signal({ sessionId, fromPeerId, fromUserId, toPeerId, message }) {
    const s = await this.load(sessionId);
    const from = await this.store.hget(K.peers(sessionId), fromPeerId);
    if (!from || from.userId !== fromUserId) fail(403, 'not_peer', 'Not a participant in this session.');
    const to = await this.store.hget(K.peers(sessionId), toPeerId);
    if (!to) fail(404, 'no_peer', 'That participant is not in this session.');
    // Guests may only talk to the host; the host may talk to anyone. Guests never learn each
    // other's addresses through us — every guest's connection is to the host alone.
    if (fromPeerId !== 'host' && toPeerId !== 'host') fail(403, 'guest_to_guest', 'Guests signal only the host.');
    const body = JSON.stringify(message ?? null);
    if (body.length > MAX_SIGNAL_BYTES) fail(413, 'too_large', 'Signalling message too large.');
    await this.store.push(K.queue(sessionId, toPeerId), { from: fromPeerId, message: JSON.parse(body), at: this.now() }, MAX_QUEUE, this.ttl(s));
    return { ok: true };
  }

  /** Drain queued signalling messages for a peer. */
  async receive({ sessionId, peerId, userId }) {
    await this.load(sessionId);
    const p = await this.store.hget(K.peers(sessionId), peerId);
    if (!p || p.userId !== userId) fail(403, 'not_peer', 'Not a participant in this session.');
    const t = this.now();
    const out = (await this.store.drain(K.queue(sessionId, peerId))).filter((m) => t - m.at < SIGNAL_TTL_MS);
    let peers;
    if (peerId === 'host') {
      const all = await this.store.hgetall(K.peers(sessionId));
      peers = Object.entries(all).filter(([id]) => id !== 'host').map(([id, x]) => ({ peer_id: id, user_id: x.userId, name: x.name }));
    }
    return { messages: out.map((m) => ({ from: m.from, message: m.message })), ...(peers ? { peers } : {}) };
  }

  async leave({ sessionId, peerId, userId }) {
    const s = await this.store.get(K.session(sessionId));
    if (!s) return;
    const p = await this.store.hget(K.peers(sessionId), peerId);
    if (!p || p.userId !== userId) return;
    if (peerId === 'host') return this.end(sessionId);
    await this.store.hdel(K.peers(sessionId), peerId);
    await this.store.del(K.queue(sessionId, peerId));
    await this.store.push(K.queue(sessionId, 'host'), { from: peerId, message: { type: 'left' }, at: this.now() }, MAX_QUEUE, this.ttl(s));
  }

  async end(sessionId) {
    const s = await this.store.get(K.session(sessionId));
    if (!s) return;
    const peers = Object.keys(await this.store.hgetall(K.peers(sessionId)));
    await this.store.del(
      K.session(sessionId), K.peers(sessionId),
      ...(s.code ? [K.code(s.code)] : []),
      ...peers.map((p) => K.queue(sessionId, p)),
    );
  }

  /** Count one code-redemption attempt for a user in a 60 s window, across every replica. */
  async attempt(userId) { return this.store.hit(K.attempts(userId), 60_000); }
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
