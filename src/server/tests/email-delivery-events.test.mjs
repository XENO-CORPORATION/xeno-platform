/**
 * A provider delivery event moves the email_logs row it belongs to — and only a
 * SIGNED one is accepted. Real Postgres (real migrations), real router, real
 * Svix-style HMAC, a fake Resend on loopback for the send.
 *
 * Dogfooding 2026-09-17 (F2/F3): `sent` was the final state for a mail Resend had
 * bounced; the provider id was never stored so nothing could even be matched.
 *
 * Mutations: skip the signature check -> "an unsigned event is refused" fails.
 * Drop `provider_id` from the sent UPDATE in emailService -> "the sent row carries
 * the provider id" fails. Let 'delivered' overwrite 'bounced' -> that gate fails.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import emailWebhookRoutes, { verifySvix, applyEmailEvent } from '../routes/emailWebhookRoutes.js';
import { sendEmail } from '../services/emailService.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const SECRET = `whsec_${Buffer.from('a-32-byte-test-secret-for-svix!!').toString('base64')}`;
const OTHER_SECRET = `whsec_${Buffer.from('another-32-byte-secret-not-ours!').toString('base64')}`;
process.env.RESEND_WEBHOOK_SECRET = SECRET;
const sign = (rawBody, { id = 'msg_1', ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) => {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.`).update(rawBody).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
};

async function main() {
  await runAllMigrations(pool);
  const userId = (await pool.query(`INSERT INTO users (email, username, display_name, password_hash, email_verified, is_active)
    VALUES ('bounce@xeno.test','bounce_t','Bounce','x', false, true) RETURNING id`)).rows[0].id;

  // ── the sent row carries the provider id (fake Resend on loopback) ──
  const fakeResend = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'resend-msg-abc' })); });
  await new Promise((r) => fakeResend.listen(0, '127.0.0.1', r));
  const prevKey = process.env.RESEND_API_KEY; const prevBase = process.env.RESEND_API_BASE_URL;
  process.env.RESEND_API_KEY = 'test'; process.env.RESEND_API_BASE_URL = `http://127.0.0.1:${fakeResend.address().port}`;
  let sent;
  try {
    sent = await sendEmail(pool, 'email_verification', 'bounce@xeno.test', { userId, name: 'Bounce', code: '123456', verificationUrl: 'https://x/verify' });
  } finally {
    process.env.RESEND_API_KEY = prevKey; process.env.RESEND_API_BASE_URL = prevBase;
    await new Promise((r) => fakeResend.close(r));
  }
  const row = async () => (await pool.query("SELECT status, provider_id, error, event_at FROM email_logs WHERE to_email='bounce@xeno.test' ORDER BY created_at DESC LIMIT 1")).rows[0];
  const r0 = await row();
  ok(sent?.success === true && r0 && r0.status === 'sent' && r0.provider_id === 'resend-msg-abc', `the sent row carries the provider id (${JSON.stringify(r0)})`);

  // ── the webhook, over HTTP with the raw-body mount exactly as index.js does it ──
  const app = express();
  app.use('/api/email/webhooks', express.raw({ type: '*/*' }), (req, _res, next) => { req.db = pool; next(); }, emailWebhookRoutes);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const post = (body, headers) => fetch(`http://127.0.0.1:${server.address().port}/api/email/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  try {
    const bounce = JSON.stringify({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 'resend-msg-abc', bounce: { type: 'Permanent', subType: 'General', message: 'The recipient address does not exist' } } });
    ok((await post(bounce, {})).status === 401, 'an unsigned event is refused');
    ok((await post(bounce, sign(bounce, { secret: OTHER_SECRET }))).status === 401, 'a wrongly-signed event is refused');
    ok((await post(bounce, sign(bounce, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status === 401, 'a stale (1 h old) signature is refused');
    ok((await post(`${bounce} `, sign(bounce))).status === 401, 'a body altered after signing is refused');
    const r = await post(bounce, sign(bounce));
    const r1 = await row();
    ok(r.status === 200 && r1.status === 'bounced' && /does not exist/.test(r1.error) && r1.event_at, `a signed bounce moves the row to bounced with the reason (${r1.status}: ${r1.error})`);
    const delivered = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'resend-msg-abc' } });
    await post(delivered, sign(delivered, { id: 'msg_2' }));
    ok((await row()).status === 'bounced', 'a later delivered event never overwrites a bounce');
    const unknown = JSON.stringify({ type: 'email.delivered', data: { email_id: 'someone-elses-product' } });
    const ru = await post(unknown, sign(unknown, { id: 'msg_3' }));
    ok(ru.status === 200 && (await ru.json()).applied === false, 'an id we never sent (shared Resend account) is a 200 and touches nothing');
    const other = JSON.stringify({ type: 'email.opened', data: { email_id: 'resend-msg-abc' } });
    ok((await (await post(other, sign(other, { id: 'msg_4' }))).json()).reason === 'ignored-event', 'an event we do not track is ignored');
    delete process.env.RESEND_WEBHOOK_SECRET;
    ok((await post(bounce, sign(bounce))).status === 503, 'no secret configured is a 503, never an unsigned acceptance');
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  } finally {
    await new Promise((r) => server.close(r));
  }
  ok(verifySvix({ secret: SECRET, id: 'a', timestamp: String(Math.floor(Date.now() / 1000)), signature: 'v0,zzz v1,zzz', rawBody: Buffer.from('x') }) === false, 'verifySvix: garbage signatures are false, not thrown');
  const applied = await applyEmailEvent(pool, { type: 'email.failed', data: { email_id: 'resend-msg-abc', failed: { reason: 'quota' } } });
  ok(applied.applied === true && (await row()).status === 'failed', 'applyEmailEvent: failed is applied over bounced (both terminal-bad)');

  console.log(`\n${fail === 0 ? '✅' : '❌'} email-delivery-events: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch(async (e) => { console.error('FATAL', e); await pool.end().catch(() => {}); process.exitCode = 1; });
