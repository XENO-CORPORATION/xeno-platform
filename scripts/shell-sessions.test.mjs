import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { MemorySessionStore, RedisSessionStore, ShellSessionDirectory, ShellSessionError, iceServers } from '../src/server/services/shellSessions.js';
const serverRequire = createRequire(new URL('../src/server/package.json', import.meta.url));
const jwt = serverRequire('jsonwebtoken');

const FP = 'sha-256 ' + Array.from({ length: 32 }, () => 'AB').join(':');
const err = async (fn) => { try { await fn(); } catch (e) { return e instanceof ShellSessionError ? e.code : e.message; } return null; };

function dir() {
  let t = 1_000_000;
  const now = () => t;
  const store = new MemorySessionStore({ now });
  const d = new ShellSessionDirectory({ store, now });
  return { d, store, now, advance: (ms) => { t += ms; } };
}

test('a session needs a real DTLS fingerprint', async () => {
  const { d } = dir();
  assert.equal(await err(() => d.create({ userId: 'h', displayName: 'H', fingerprint: 'nope' })), 'bad_fingerprint');
  assert.ok((await d.create({ userId: 'h', displayName: 'H', fingerprint: FP })).join_code);
});

test('a join code is single-use', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  await d.redeem({ code: s.join_code, userId: 'g1', displayName: 'G1' });
  assert.equal(await err(() => d.redeem({ code: s.join_code, userId: 'g2', displayName: 'G2' })), 'bad_code');
});

test('a join code expires after 15 minutes', async () => {
  const { d, advance } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  advance(15 * 60 * 1000 + 1);
  assert.equal(await err(() => d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' })), 'bad_code');
});

test('codes are accepted case- and dash-insensitively', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.ok((await d.redeem({ code: s.join_code.toLowerCase().replace('-', ''), userId: 'g', displayName: 'G' })).peerId);
});

test('only the host can rotate the code', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.equal(await err(() => d.rotateCode(s.session_id, 'intruder')), 'not_host');
  assert.notEqual((await d.rotateCode(s.session_id, 'h')).join_code, s.join_code);
});

test('you cannot join your own session', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.equal(await err(() => d.redeem({ code: s.join_code, userId: 'h', displayName: 'H' })), 'own_session');
});

test('signalling: a guest reaches the host and back, and a peer id cannot be borrowed', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = await d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  await d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'g', toPeerId: 'host', message: { type: 'offer', sdp: 'x' } });
  const got = await d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.deepEqual(got.messages, [{ from: peerId, message: { type: 'offer', sdp: 'x' } }]);
  assert.equal(got.peers[0].name, 'G');
  await d.signal({ sessionId: s.session_id, fromPeerId: 'host', fromUserId: 'h', toPeerId: peerId, message: { type: 'answer' } });
  assert.equal((await d.receive({ sessionId: s.session_id, peerId, userId: 'g' })).messages[0].message.type, 'answer');
  // Another user presenting the guest's peer id is refused.
  assert.equal(await err(() => d.receive({ sessionId: s.session_id, peerId, userId: 'attacker' })), 'not_peer');
  assert.equal(await err(() => d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'attacker', toPeerId: 'host', message: {} })), 'not_peer');
});

test('guests signal only the host, never each other', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const a = (await d.redeem({ code: s.join_code, userId: 'a', displayName: 'A' })).peerId;
  const code2 = (await d.rotateCode(s.session_id, 'h')).join_code;
  const b = (await d.redeem({ code: code2, userId: 'b', displayName: 'B' })).peerId;
  assert.equal(await err(() => d.signal({ sessionId: s.session_id, fromPeerId: a, fromUserId: 'a', toPeerId: b, message: {} })), 'guest_to_guest');
  // ...and a guest's receive never lists the other participants.
  assert.equal((await d.receive({ sessionId: s.session_id, peerId: a, userId: 'a' })).peers, undefined);
});

test('oversized signalling is refused', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = await d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  assert.equal(await err(() => d.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'g', toPeerId: 'host', message: { sdp: 'x'.repeat(70000) } })), 'too_large');
});

test('the host leaving ends the session', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  await d.leave({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.equal(await err(() => d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' })), 'no_session');
});

test('a guest leaving tells the host', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = await d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  await d.leave({ sessionId: s.session_id, peerId, userId: 'g' });
  const got = await d.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
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

test('two backend replicas see one session: a guest joins through a different process', async () => {
  let t = 1_000_000; const now = () => t;
  const shared = new MemorySessionStore({ now });
  const replicaA = new ShellSessionDirectory({ store: shared, now });
  const replicaB = new ShellSessionDirectory({ store: shared, now });
  const s = await replicaA.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const { peerId } = await replicaB.redeem({ code: s.join_code, userId: 'g', displayName: 'G' });
  await replicaB.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: 'g', toPeerId: 'host', message: { type: 'offer' } });
  const got = await replicaA.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
  assert.equal(got.messages[0].message.type, 'offer');
  assert.equal(got.peers[0].name, 'G');
});

test('two guests racing one code: exactly one gets in', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  const results = await Promise.allSettled([
    d.redeem({ code: s.join_code, userId: 'g1', displayName: 'G1' }),
    d.redeem({ code: s.join_code, userId: 'g2', displayName: 'G2' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'bad_code');
});

test('a host trying their own code does not burn it', async () => {
  const { d } = dir();
  const s = await d.create({ userId: 'h', displayName: 'H', fingerprint: FP });
  assert.equal(await err(() => d.redeem({ code: s.join_code, userId: 'h', displayName: 'H' })), 'own_session');
  assert.ok((await d.redeem({ code: s.join_code, userId: 'g', displayName: 'G' })).peerId);
});

test('the redemption rate limit is shared across replicas', async () => {
  let t = 1_000_000; const now = () => t;
  const shared = new MemorySessionStore({ now });
  const a = new ShellSessionDirectory({ store: shared, now }), b = new ShellSessionDirectory({ store: shared, now });
  for (let i = 0; i < 5; i++) { await a.attempt('u'); await b.attempt('u'); }
  assert.equal(await a.attempt('u'), 11);
  t += 60_001;
  assert.equal(await b.attempt('u'), 1);
});

// The production store, against a real Redis when one is available (ci:local provides Docker).
const REDIS_TEST_URL = process.env.SHELL_SESSIONS_REDIS_URL;
test('RedisSessionStore: atomic redeem and drain against a real Redis', { skip: !REDIS_TEST_URL && 'SHELL_SESSIONS_REDIS_URL not set' }, async () => {
  const Redis = serverRequire('ioredis');
  const r = new Redis(REDIS_TEST_URL);
  try {
    const store = new RedisSessionStore(r);
    const a = new ShellSessionDirectory({ store }), b = new ShellSessionDirectory({ store });
    const s = await a.create({ userId: 'h', displayName: 'H', fingerprint: FP });
    const race = await Promise.allSettled([
      a.redeem({ code: s.join_code, userId: 'g1', displayName: 'G1' }),
      b.redeem({ code: s.join_code, userId: 'g2', displayName: 'G2' }),
    ]);
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
    const { peerId } = race.find((x) => x.status === 'fulfilled').value;
    const winner = (await store.hget(`shell:p:${s.session_id}`, peerId)).userId;
    await b.signal({ sessionId: s.session_id, fromPeerId: peerId, fromUserId: winner, toPeerId: 'host', message: { n: 1 } });
    const first = await a.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
    const second = await a.receive({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
    assert.equal(first.messages.length, 1);
    assert.equal(second.messages.length, 0);
    await a.leave({ sessionId: s.session_id, peerId: 'host', userId: 'h' });
    assert.equal(await r.exists(`shell:s:${s.session_id}`), 0);
  } finally { r.disconnect(); }
});
