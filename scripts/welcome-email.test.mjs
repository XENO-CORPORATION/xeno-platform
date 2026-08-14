/**
 * Tests for the signup welcome email, honest delivery status, and unsubscribe.
 *
 * Three defects these pin, all found in the live system:
 *
 *  1. The `welcome` template existed and was NEVER SENT — authRoutes only ever
 *     dispatched email_verification and password_reset.
 *  2. With no provider configured, sendEmail logged to the console and then wrote
 *     `status = 'sent'`. Production held exactly one email_logs row, reading 'sent',
 *     for a message nobody received.
 *  3. There was no unsubscribe mechanism at all, on a system about to start sending
 *     onboarding mail to EU recipients.
 *
 * Run: node --test scripts/welcome-email.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unsubscribe-hmac';
delete process.env.RESEND_API_KEY;
delete process.env.SENDGRID_API_KEY;

const { sendEmail, sendWelcomeEmail } = await import('../src/server/services/emailService.js');
const {
  unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, normalizeEmail,
} = await import('../src/server/services/emailPreferences.js');

/** Records every query; answers the opt-out lookup from a set of opted-out addresses. */
function fakeDb(optedOut = []) {
  const set = new Set(optedOut.map((e) => e.toLowerCase()));
  const queries = [];
  return {
    queries,
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/FROM email_opt_outs/i.test(sql)) {
        return { rows: set.has(String(params[0]).toLowerCase()) ? [{ 1: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
}

const statusWrites = (db) => db.queries
  .filter((q) => /UPDATE email_logs SET status/i.test(q.sql))
  .map((q) => q.params[0]);

// ── The token cannot be forged ──────────────────────────────────────────────

test('an unsubscribe token verifies only for its own address', () => {
  const t = unsubscribeToken('a@example.com');
  assert.equal(verifyUnsubscribeToken('a@example.com', t), true);
  assert.equal(verifyUnsubscribeToken('b@example.com', t), false, 'must not work for another address');
});

test('a tampered or absent token is rejected', () => {
  const t = unsubscribeToken('a@example.com');
  assert.equal(verifyUnsubscribeToken('a@example.com', `${t}x`), false);
  assert.equal(verifyUnsubscribeToken('a@example.com', ''), false);
  assert.equal(verifyUnsubscribeToken('a@example.com', undefined), false);
  assert.equal(verifyUnsubscribeToken('a@example.com', null), false);
});

test('casing does not break an unsubscribe', () => {
  // Storage lowercases; a link generated from a mixed-case address must still verify,
  // or the unsubscribe silently fails to match and the person keeps getting mail.
  const t = unsubscribeToken('Mixed.Case@Example.COM');
  assert.equal(verifyUnsubscribeToken('mixed.case@example.com', t), true);
  assert.equal(normalizeEmail('  Mixed.Case@Example.COM '), 'mixed.case@example.com');
});

test('the unsubscribe URL carries both address and token', () => {
  const url = unsubscribeUrl('a@example.com');
  assert.match(url, /\/api\/email\/unsubscribe\?/);
  assert.match(url, /email=a%40example\.com/);
  assert.match(url, /token=/);
});

// ── Delivery status tells the truth ─────────────────────────────────────────

test('with NO provider configured the log says skipped, never sent', async () => {
  const db = fakeDb();
  const r = await sendEmail(db, 'welcome', 'new@example.com', { displayName: 'Ana' });
  assert.equal(r.success, false, 'a no-op must not report success');
  assert.equal(r.skipped, true);
  assert.deepEqual(statusWrites(db), ['skipped'], 'must not write status=sent');
});

// ── Unsubscribe is honoured — but never for security mail ───────────────────

test('an opted-out address does not receive product email', async () => {
  const db = fakeDb(['gone@example.com']);
  const r = await sendEmail(db, 'welcome', 'gone@example.com', { displayName: 'X' });
  assert.equal(r.suppressed, true);
  assert.equal(r.reason, 'opted_out');
  assert.equal(db.queries.some((q) => /INSERT INTO email_logs/i.test(q.sql)), false,
    'a suppressed email should not even be logged as attempted');
});

test('an opted-out address STILL receives password resets', async () => {
  const db = fakeDb(['gone@example.com']);
  const r = await sendEmail(db, 'password_reset', 'gone@example.com', {
    displayName: 'X', resetUrl: 'https://x/y', expiresIn: '1h',
  });
  assert.notEqual(r.suppressed, true, 'account recovery must never be suppressed');
});

test('an opted-out address STILL receives email verification', async () => {
  const db = fakeDb(['gone@example.com']);
  const r = await sendEmail(db, 'email_verification', 'gone@example.com', {
    displayName: 'X', verifyUrl: 'https://x/y',
  });
  assert.notEqual(r.suppressed, true);
});

test('an opt-out lookup failure FAILS OPEN so mail is not silently stopped', async () => {
  const broken = { query: async (sql) => { if (/email_opt_outs/i.test(sql)) throw new Error('no table'); return { rows: [] }; } };
  const r = await sendEmail(broken, 'welcome', 'a@example.com', { displayName: 'A' });
  assert.notEqual(r.suppressed, true, 'a broken opt-out table must not suppress everything');
});

// ── The template says something useful ──────────────────────────────────────

/**
 * Capture what would actually be transmitted by pointing the Resend branch at a
 * stubbed fetch. This exercises the real render path — including the unsubscribe URL
 * that sendEmail injects — rather than re-deriving the template in the test.
 */
async function captureSend(db, template, to, data) {
  const realFetch = globalThis.fetch;
  let payload = null;
  process.env.RESEND_API_KEY = 'test-key-not-a-real-secret';
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: 'test-id' }) };
  };
  try {
    await sendEmail(db, template, to, data);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
  return payload;
}

test('the welcome email contains a checklist, a CTA and a working unsubscribe link', async () => {
  const db = fakeDb();
  const sent = await captureSend(db, 'welcome', 'new@example.com', { displayName: 'Ana' });

  assert.ok(sent, 'a payload was transmitted');
  assert.match(sent.subject, /get you set up/i, 'the subject invites an action');
  assert.match(sent.html, /Welcome, Ana/, 'greets the person by name');

  // The checklist rows — the actual job of a welcome email.
  for (const row of ['Download XENO Hub', 'Bring your own AI', 'Open a creative app', 'Read the docs']) {
    assert.ok(sent.html.includes(row), `checklist row missing: ${row}`);
  }
  assert.match(sent.html, /<table role="presentation"/, 'table layout, so Outlook renders it');

  // The unsubscribe link must be present AND verify for this exact recipient.
  const m = sent.html.match(/unsubscribe\?email=([^&]+)&amp;token=([A-Za-z0-9_-]+)/);
  assert.ok(m, 'an unsubscribe link is present');
  assert.equal(verifyUnsubscribeToken(decodeURIComponent(m[1]), m[2]), true,
    'the embedded token actually verifies — a dead unsubscribe link is worse than none');

  assert.match(sent.html, /impressum/i, 'links the legal notice');
  assert.deepEqual(statusWrites(db), ['sent'], 'a real transmission is logged as sent');
});

test('a security email carries NO unsubscribe link', async () => {
  // Offering to unsubscribe from password resets would be offering something we do
  // not honour — ESSENTIAL_TEMPLATES ignores the opt-out list.
  const db = fakeDb();
  const sent = await captureSend(db, 'password_reset', 'a@example.com', {
    displayName: 'A', resetUrl: 'https://x/y', expiresIn: '1h',
  });
  assert.ok(!/api\/email\/unsubscribe/.test(sent.html), 'must not offer an opt-out it will not honour');
});

test('HTML in a display name cannot inject markup', async () => {
  const db = fakeDb();
  const sent = await captureSend(db, 'welcome', 'a@example.com', {
    displayName: '<img src=x onerror=alert(1)>',
  });
  assert.ok(!sent.html.includes('<img src=x'), 'the raw tag must not survive');
  assert.match(sent.html, /&lt;img/, 'it is escaped instead');
});

test('sendWelcomeEmail never throws, even with a broken db', async () => {
  // Signup must not fail because email failed.
  const exploding = { query: async () => { throw new Error('db gone'); } };
  assert.doesNotThrow(() => sendWelcomeEmail(exploding, { id: 'u1', email: 'a@example.com' }));
  await new Promise((r) => setTimeout(r, 20)); // let the detached promise settle
});

test('sendWelcomeEmail is a no-op without an address', () => {
  const db = fakeDb();
  sendWelcomeEmail(db, { id: 'u1' });
  assert.equal(db.queries.length, 0, 'nothing attempted when there is nowhere to send');
});
