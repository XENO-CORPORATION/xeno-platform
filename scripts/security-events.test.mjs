/**
 * Tests for the security-event audit trail.
 *
 * THE GAP THIS FILLS: the platform had ONE write site and 166 rows across three
 * event types against 416 sessions — no password login, no logout, no failed login,
 * no token issue/refresh/revoke, and no record of RFC 9700 reuse detection firing.
 * "What happened to this account?" was unanswerable.
 *
 * The properties worth pinning are not the happy path — they are that an audit write
 * can never take down the thing it observes, and that a record is never silently
 * dropped.
 *
 * Run: node --test scripts/security-events.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { recordSecurityEvent, recordSecurityEventAsync, EVENTS } = await import(
  '../src/server/services/securityEvents.js'
);

function fakeDb() {
  const rows = [];
  return {
    rows,
    query: async (sql, params) => {
      if (/INSERT INTO security_events/i.test(sql)) {
        rows.push({ userId: params[0], type: params[1], metadata: JSON.parse(params[2]), ip: params[3], ua: params[4] });
      }
      return { rows: [] };
    },
  };
}

const fakeReq = (ip = '203.0.113.9', ua = 'TestAgent/1.0') => ({
  headers: { 'cf-connecting-ip': ip },
  get: (h) => (h.toLowerCase() === 'user-agent' ? ua : undefined),
  ip,
});

// ── It records what it is told ──────────────────────────────────────────────

test('a login event records user, type, ip and user-agent', async () => {
  const db = fakeDb();
  await recordSecurityEvent(db, EVENTS.LOGIN, { userId: 'u1', req: fakeReq(), metadata: { method: 'password' } });
  assert.equal(db.rows.length, 1);
  const r = db.rows[0];
  assert.equal(r.userId, 'u1');
  assert.equal(r.type, 'login');
  assert.equal(r.metadata.method, 'password');
  assert.equal(r.ip, '203.0.113.9', 'the real client IP, not a proxy hop');
  assert.equal(r.ua, 'TestAgent/1.0');
});

test('a failed login for an UNKNOWN account records a null user, not a fabricated one', async () => {
  const db = fakeDb();
  await recordSecurityEvent(db, EVENTS.LOGIN_FAILED, {
    req: fakeReq(), metadata: { reason: 'unknown_account', attemptedEmail: 'nobody@example.com' },
  });
  assert.equal(db.rows[0].userId, null, 'we do not know who this was and must not invent an id');
  assert.equal(db.rows[0].metadata.attemptedEmail, 'nobody@example.com',
    'the address is still recorded, so credential stuffing across many addresses stays visible');
});

// ── It cannot break the thing it observes ───────────────────────────────────

test('a database failure NEVER throws — an audit write must not fail a login', async () => {
  const broken = { query: async () => { throw new Error('db gone'); } };
  await assert.doesNotReject(
    () => recordSecurityEvent(broken, EVENTS.LOGIN, { userId: 'u1' }),
    'a logger that can take down authentication is worse than the gap it fills',
  );
});

test('the async form never rejects either', async () => {
  const broken = { query: async () => { throw new Error('db gone'); } };
  assert.doesNotThrow(() => recordSecurityEventAsync(broken, EVENTS.TOKEN_REFRESHED, { userId: 'u1' }));
  await new Promise((r) => setTimeout(r, 20));
});

test('a null db is a no-op, not a crash', async () => {
  await assert.doesNotReject(() => recordSecurityEvent(null, EVENTS.LOGOUT, { userId: 'u1' }));
});

// ── An unknown type is recorded, never dropped ──────────────────────────────

test('an unknown event type is RECORDED as unknown_event, not discarded', async () => {
  const db = fakeDb();
  await recordSecurityEvent(db, 'totally_made_up', { userId: 'u1', metadata: { a: 1 } });
  assert.equal(db.rows.length, 1, 'silently discarding an audit record is the worst outcome');
  assert.equal(db.rows[0].type, 'unknown_event');
  assert.equal(db.rows[0].metadata.attemptedType, 'totally_made_up', 'the intended name survives');
  assert.equal(db.rows[0].metadata.a, 1, 'the original metadata survives too');
});

// ── The vocabulary is closed and coherent ───────────────────────────────────

test('the event vocabulary has no duplicate values', () => {
  const values = Object.values(EVENTS);
  assert.equal(new Set(values).size, values.length,
    'two names for one event makes the table uncountable');
});

test('the events the audit gap was ABOUT all exist', () => {
  // These are precisely what production could not answer before.
  for (const k of ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESHED', 'TOKEN_REVOKED', 'TOKEN_REUSE_DETECTED']) {
    assert.ok(EVENTS[k], `EVENTS.${k} must exist`);
  }
});

test('the vocabulary is frozen so it cannot be extended at runtime', () => {
  assert.throws(() => { EVENTS.SOMETHING_NEW = 'x'; }, TypeError);
});
