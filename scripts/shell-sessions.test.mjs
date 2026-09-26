import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ShellSessionDirectory, ShellSessionError, iceServers } from '../src/server/services/shellSessions.js';
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');

const FP = 'sha-256 ' + Array.from({ length: 32 }, () => 'AB').join(':');
const err = (fn) => { try { fn(); } catch (e) { return e instanceof ShellSessionError ? e.code : e.message; } return null; };

function dir() {
  let t = 1_000_000;
  const d = new ShellSessionDirectory({ now: () => t });
  return { d, advance: (ms) => { t += ms; } };
}

test('a session needs a real DTLS fingerprint', () => {
  const { d } = dir();
  assert.equal(err(() => d.create({ userId: 'h', displayName: 'H', fingerprint: 'nope' })), 'bad_fingerprint');
  assert.ok(d.create({ userId: 'h', displayName: 'H', fingerprint: FP }).join_code);
});

test('a join code is single-use', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  d.redeem({ code: s.join_code, userId: 'g1', displayName: 'G1' });
  assert.equal(err(() => d.redeem({ code: s.join_code, userId: 'g2', displayName: 'G2' })), 'bad_code');
});

test('a join code expires after 15 minutes', () => {
  const { d, advance } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  advance(15 * 60 * 1000 + 1);
  assert.equal(err(() => d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' })), 'bad_code');
});

test('codes are accepted case- and dash-insensitively', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.ok(d.redeem({ code: s.join_code.toLowerCase().replace('-', ''), userId: 'g', displayName: 'G' }).peerId);
});

test('only the host can rotate the code', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.equal(err(() => d.rotateCode(s.session_id, 'intruder')), 'not_host');
  assert.notEqual(d.rotateCode(s.session_id, 'h').join_code, s.join_code);
});

test('you cannot join your own session', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.equal(err(() => d.redeem({ code: s.join_code, userId: 'h', displayName: 'H' })), 'own_session');
});

test('signalling: a guest reaches the host and back, and a peer id cannot be borrowed', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'g', toPeerId: 'host', message: { type: 'offer', sdp: 'x' } });
  const got = d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.deepEqual(got.messages, [{ from: peerId, message: { type: 'offer', sdp: 'x' } }]);
  assert.equal(got.peers[0].name, 'G');
  d.signal({ sessionId: s.session_id, fromPeerId: 'host', fromUserId: 'h', toPeerId: peerId, message: { type: 'answer' } });
  assert.equal(d.receive({ sessionId: s.session_id, peerId, userId: 'g' }).messages[0].message.type, 'answer');
  // Another user presenting the guest's peer id is refused.
  assert.equal(err(() => d.receive({ sessionId: s.session_id, peerId, userId: 'attacker' })), 'not_peer');
  assert.equal(err(() => d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'attacker', toPeerId: 'host', message: {} })), 'not_peer');
});

test('guests signal only the host, never each other', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const a = d.redeem({ code: s.join_code, userId: 'a', displayName: 'A' }).peerId;
  const code2 = d.rotateCode(s.session_id, 'h').join_code;
  const b = d.redeem({ code: code2, userId: 'b', displayName: 'B' }).peerId;
  assert.equal(err(() => d.signal({ sessionId: s.session_id, fromPeerId: a, fromUserId: 'a', toPeerId: b, message: {} })), 'guest_to_guest');
  // ...and a guest's receive never lists the other participants.
  assert.equal(d.receive({ sessionId: s.session_id, peerId: a, userId: 'a' }).peers, undefined);
});

test('oversized signalling is refused', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  assert.equal(err(() => d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'g', toPeerId: 'host', message: { sdp: 'x'.repeat(70000) } })), 'too_large');
});

test('the host leaving ends the session', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  d.leave({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.equal(err(() => d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' })), 'no_session');
});

test('a guest leaving tells the host', () => {
  const { d } = dir();
  const s = d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  d.leave({ sessionId: s.session_id, peerId, userId: 'g' });
  const got = d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.deepEqual(got.messages, [{ from: peerId, message: { type: 'left' } }]);
  assert.deepEqual(got.peers, []);
});

test('with no TURN configured, ICE is STUN only and says so', async () => {
  delete process.env.CF_TURN_KEY_ID; delete process.env.CF_TURN_KEY_API_TOKEN;
  const r = await iceServers();
  assert.equal(r.relay, 'none');
  assert.ok(r.ice_servers[0].urls[0].startsWith('stun:'));
});

test('a TURN outage degrades to STUN rather than failing the session', async () => {
  process.env.CF_TURN_KEY_ID = 'k'; process.env.CF_TURN_KEY_API_TOKEN = 't';
  const r = await iceServers({ fetchImpl: async () => ({ ok: false }) });
  assert.equal(r.relay, 'unavailable');
  const ok = await iceServers({ fetchImpl: async () => ({ ok: true, json: async () => ({ iceServers: { urls: ['turn:x'], username: 'u', credential: 'c' } }) }) });
  assert.equal(ok.relay, 'cloudflare');
  assert.equal(ok.ice_servers[1].urls[0], 'turn:x');
  delete process.env.CF_TURN_KEY_ID; delete process.env.CF_TURN_KEY_API_TOKEN;
});

test('a session pass cannot be mistaken for an access token, or vice versa', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pass = jwt.sign({ aud: 'xeno-shell-session', typ: 'xeno-session+jwt' }, privateKey, { algorithm: 'ES256', header: { typ: 'xeno-session+jwt' } });
  assert.throws(() => jwt.verify(pass, publicKey, { algorithms: ['ES256'], audience: 'xeno-api' }));
  const access = jwt.sign({ aud: 'xeno-api', typ: 'at+jwt' }, privateKey, { algorithm: 'ES256', header: { typ: 'at+jwt' } });
  assert.throws(() => jwt.verify(access, publicKey, { algorithms: ['ES256'], audience: 'xeno-shell-session' }));
});
