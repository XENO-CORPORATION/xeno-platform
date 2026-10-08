/**
 * Account: confirm it's you, email change, sign out everywhere, personal API keys, data export.
 * Real Postgres, the real account router behind the real authMiddleware, a loopback stand-in for
 * the mail provider (so the codes people receive are the codes the test types), real files.
 *
 * Accounts: ada has a password; grace signs in with Google and has none; mallory is someone else.
 *
 * Run: DATABASE_URL=postgresql://… node tests/account-security.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import tar from 'tar-stream';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;   // account codes are keyed with it; production always sets it
const exportDir = mkdtempSync(path.join(tmpdir(), 'xeno-account-export-test-'));
process.env.ACCOUNT_EXPORT_DIR = exportDir;

// ── the mail provider, on loopback ──
const mail = [];
const fakeResend = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => { try { mail.push(JSON.parse(body)); } catch { mail.push({ raw: body }); } res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: `mail_${mail.length}` })); });
});
await new Promise((resolve) => fakeResend.listen(0, '127.0.0.1', resolve));
process.env.RESEND_API_KEY = 'test';
process.env.RESEND_API_BASE_URL = `http://127.0.0.1:${fakeResend.address().port}`;
const toOf = (m) => (Array.isArray(m.to) ? m.to[0] : m.to);
const lastMailTo = (address) => [...mail].reverse().find((m) => toOf(m) === address);
const codeIn = (m) => (/letter-spacing:0\.28em[^>]*>\s*(\d{6})\s*</.exec(m?.html || '') || [])[1];

const { default: accountRoutes } = await import('../routes/accountRoutes.js');
const { runAllMigrations } = await import('../services/migrationRunner.js');
const { registerManagedLibraryFile } = await import('../services/libraryAssets.js');
const { CODE_MAX_ATTEMPTS, PASSWORD_MAX_FAILURES } = await import('../services/accountConfirmation.js');
const { EXPORTS_PER_DAY, sweepExports } = await import('../services/accountExport.js');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadDir = path.resolve(process.cwd(), 'uploads', `account-security-test-${process.pid}`);

async function main() {
  // the canonical fresh-database sequence (tests/fresh-db-boot.test.mjs): versioned SQL, then the account v2 tables
  await runAllMigrations(pool);
  const accountV2 = await import('../database/migrate-account-v2.js');
  await (accountV2.migrateAccountV2 || accountV2.default)(pool);
  mkdirSync(uploadDir, { recursive: true });

  const user = async (name, passwordHash) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, $3) RETURNING id`,
    [name, `${name}@xeno.test`, passwordHash],
  )).rows[0].id;
  const ada = await user('ada', await bcrypt.hash('correct horse', 4));
  const grace = await user('grace', crypto.randomBytes(32).toString('hex'));   // what an OAuth signup stores
  const mallory = await user('mallory', await bcrypt.hash('mallory pw', 4));
  const session = async (userId) => (await pool.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days') RETURNING id`, [userId, crypto.randomBytes(16).toString('hex')])).rows[0].id;
  const headersFor = (userId, name, sid) => ({ authorization: `Bearer ${jwt.sign({ userId, email: `${name}@xeno.test`, username: name, ...(sid ? { sid } : {}) }, JWT_SECRET, { expiresIn: '1h' })}`, 'content-type': 'application/json' });
  const adaSid = await session(ada), adaPhone = await session(ada), graceSid = await session(grace), mallorySid = await session(mallory);
  const A = headersFor(ada, 'ada', adaSid), APHONE = headersFor(ada, 'ada', adaPhone), G = headersFor(grace, 'grace', graceSid), M = headersFor(mallory, 'mallory', mallorySid);
  const ANOSESSION = headersFor(ada, 'ada', null);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/account', accountRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/account`;
  const call = async (method, url, headers, body) => { const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, body: json, headers: res.headers }; };
  const events = async (userId) => (await pool.query('SELECT event_type, metadata FROM security_events WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;
  const liveSessions = async (userId) => (await pool.query('SELECT id FROM user_sessions WHERE user_id = $1', [userId])).rows.map((r) => r.id);

  try {
    // ── nothing sensitive happens before "confirm it's you" ──
    let sec = (await call('GET', '/security', A)).body.security;
    assert.deepEqual(sec.methods, ['password']); assert.equal(sec.has_password, true); assert.equal(sec.confirmation.confirmed, false); assert.equal(sec.email, 'ada@xeno.test');
    for (const [method, url, body] of [['POST', '/email', { new_email: 'ada2@xeno.test' }], ['POST', '/exports', null]]) {
      const refused = await call(method, url, A, body);
      assert.equal(refused.status, 403, `${method} ${url} before confirming`); assert.equal(refused.body.code, 'confirmation_required');
    }
    assert.equal((await call('GET', '/security', { 'content-type': 'application/json' })).status, 401, 'no session, no answer');

    // a caller with no browser session (an API key, a bare token) can never confirm
    const bare = await call('POST', '/confirm', ANOSESSION, { password: 'correct horse' });
    assert.equal(bare.status, 403); assert.equal(bare.body.code, 'confirmation_unavailable');
    assert.equal((await call('POST', '/exports', ANOSESSION)).body.code, 'confirmation_unavailable');

    // wrong password: refused, counted, and the step locks before the account can be guessed
    const wrong = await call('POST', '/confirm', A, { password: 'nope' });
    assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'wrong_password'); assert.equal(wrong.body.remaining, PASSWORD_MAX_FAILURES - 1);
    for (let i = 1; i < PASSWORD_MAX_FAILURES; i += 1) await call('POST', '/confirm', A, { password: `nope ${i}` });
    const locked = await call('POST', '/confirm', A, { password: 'correct horse' });
    assert.equal(locked.status, 429, 'after five wrong tries even the right password waits'); assert.equal(locked.body.code, 'too_many_attempts');
    await pool.query(`UPDATE account_confirm_throttle SET window_started_at = NOW() - INTERVAL '16 minutes' WHERE user_id = $1`, [ada]);

    const ok = await call('POST', '/confirm', A, { password: 'correct horse' });
    assert.equal(ok.status, 200); assert.equal(ok.body.confirmation.method, 'password');
    const minutes = (new Date(ok.body.confirmation.expires_at) - Date.now()) / 60000;
    assert.ok(minutes > 9 && minutes <= 10.1, `confirmed for ten minutes, got ${minutes}`);
    assert.equal((await call('GET', '/security', A)).body.security.confirmation.confirmed, true);
    assert.equal((await call('GET', '/security', APHONE)).body.security.confirmation.confirmed, false, 'confirming on one device says nothing about another');
    assert.equal((await call('POST', '/exports', APHONE)).body.code, 'confirmation_required');
    assert.equal((await call('POST', '/confirm', M, { password: 'correct horse' })).body.code, 'wrong_password', 'someone else’s password confirms nothing');

    // ── an account with no password confirms with a code sent to its address ──
    sec = (await call('GET', '/security', G)).body.security;
    assert.deepEqual(sec.methods, ['email_code']); assert.equal(sec.has_password, false);
    assert.equal((await call('POST', '/confirm', G, { password: 'anything' })).body.code, 'wrong_password');
    assert.equal((await call('POST', '/confirm/code', A)).body.code, 'use_password', 'an account with a password does not get a code instead');
    const sent = await call('POST', '/confirm/code', G);
    assert.equal(sent.status, 200); assert.equal(sent.body.sent_to, 'g****@xeno.test', 'the answer does not repeat the full address');
    const graceCode = codeIn(lastMailTo('grace@xeno.test'));
    assert.match(graceCode, /^\d{6}$/, 'the mail carries the code');
    assert.equal((await pool.query(`SELECT code_hash FROM account_codes WHERE user_id = $1`, [grace])).rows[0].code_hash.includes(graceCode), false, 'the code is not stored');
    assert.equal((await call('POST', '/confirm/code', G)).status, 429, 'a second code is not sent straight away');
    const badCode = graceCode === '000000' ? '000001' : '000000';
    const miss = await call('POST', '/confirm', G, { code: badCode });
    assert.equal(miss.body.code, 'wrong_code'); assert.equal(miss.body.remaining, CODE_MAX_ATTEMPTS - 1);
    assert.equal((await call('POST', '/confirm', G, { code: '12345' })).body.code, 'invalid_request');
    assert.equal((await call('POST', '/confirm', M, { code: graceCode })).body.code, 'code_expired', 'a code works only for the account it was sent to');
    assert.equal((await call('POST', '/confirm', G, { code: graceCode })).status, 200);
    assert.equal((await call('POST', '/confirm', G, { code: graceCode })).body.code, 'code_expired', 'a code works once');
    // five wrong tries kill a code, even if the sixth is right
    await pool.query(`UPDATE account_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [grace]);
    await pool.query('DELETE FROM account_confirmations WHERE user_id = $1', [grace]);
    await call('POST', '/confirm/code', G);
    const second = codeIn(lastMailTo('grace@xeno.test'));
    const wrongFor = second === '111111' ? '222222' : '111111';
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) await call('POST', '/confirm', G, { code: wrongFor });
    assert.equal((await call('POST', '/confirm', G, { code: second })).body.code, 'code_expired');

    // ── email change ──
    for (const [bad, code] of [['not-an-email', 'invalid_email'], ['a@b', 'invalid_email'], ['ADA@xeno.test', 'same_email'], ['', 'invalid_email'], ['x@y..z', 'invalid_email']]) {
      const refused = await call('POST', '/email', A, { new_email: bad });
      assert.equal(refused.status, 400, `"${bad}"`); assert.equal(refused.body.code, code);
    }
    const takenAddr = await call('POST', '/email', A, { new_email: 'Mallory@Xeno.Test' });
    assert.equal(takenAddr.status, 409); assert.equal(takenAddr.body.code, 'email_unavailable', 'another account’s address, in any case');
    const asked = await call('POST', '/email', A, { new_email: ' Ada.New@Xeno.Test ' });
    assert.equal(asked.status, 200); assert.equal(asked.body.pending_email.new_email, 'ada.new@xeno.test');
    assert.equal((await pool.query('SELECT email FROM users WHERE id = $1', [ada])).rows[0].email, 'ada@xeno.test', 'nothing changes until the code is entered');
    assert.equal((await call('GET', '/security', A)).body.security.pending_email.new_email, 'ada.new@xeno.test');
    const emailCode = codeIn(lastMailTo('ada.new@xeno.test'));
    assert.match(emailCode, /^\d{6}$/, 'the code goes to the NEW address');
    assert.equal(lastMailTo('ada@xeno.test'), undefined, 'and not to the old one');
    assert.equal((await call('POST', '/email/confirm', M, { code: emailCode })).body.code, 'code_expired', 'another account cannot use it');
    assert.equal((await call('POST', '/email/confirm', A, { code: emailCode === '333333' ? '444444' : '333333' })).body.code, 'wrong_code');
    const changed = await call('POST', '/email/confirm', A, { code: emailCode });
    assert.equal(changed.status, 200); assert.equal(changed.body.email, 'ada.new@xeno.test');
    const row = (await pool.query('SELECT email, email_verified FROM users WHERE id = $1', [ada])).rows[0];
    assert.equal(row.email, 'ada.new@xeno.test'); assert.equal(row.email_verified, true);
    assert.deepEqual(await liveSessions(ada), [adaSid], 'every other session is signed out; this one stays');
    assert.equal((await call('GET', '/security', APHONE)).status, 401, 'the other device’s token is dead');
    await new Promise((r) => setTimeout(r, 300));
    const notice = lastMailTo('ada@xeno.test');
    assert.ok(notice && /was changed/.test(notice.subject), 'the OLD address is told');
    assert.ok(/a\*+@xeno\.test/.test(notice.html) && !notice.html.includes('ada.new@xeno.test'), 'the notice masks the new address');
    assert.equal((await call('POST', '/exports', A)).body.code, 'confirmation_required', 'the confirmation is spent by the change');
    const changeEvent = (await events(ada)).find((e) => e.event_type === 'email_changed');
    assert.deepEqual([changeEvent.metadata.old_email, changeEvent.metadata.new_email], ['ada@xeno.test', 'ada.new@xeno.test']);
    // a pending change can be dropped, and then its code is worthless
    await call('POST', '/confirm', A, { password: 'correct horse' });
    await call('POST', '/email', A, { new_email: 'ada.third@xeno.test' });
    const dropped = codeIn(lastMailTo('ada.third@xeno.test'));
    assert.equal((await call('DELETE', '/email', A)).body.cancelled, true);
    assert.equal((await call('POST', '/email/confirm', A, { code: dropped })).body.code, 'code_expired');
    // the address was free when asked for and is taken by the time the code arrives
    await pool.query(`UPDATE account_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [ada]);
    await call('POST', '/email', A, { new_email: 'race@xeno.test' });
    const raceCode = codeIn(lastMailTo('race@xeno.test'));
    // in another letter case: the table's unique index would let that through, so the re-check is what refuses it
    await pool.query(`UPDATE users SET email = 'Race@Xeno.Test' WHERE id = $1`, [grace]);
    const raced = await call('POST', '/email/confirm', A, { code: raceCode });
    assert.equal(raced.status, 409); assert.equal((await pool.query('SELECT email FROM users WHERE id = $1', [ada])).rows[0].email, 'ada.new@xeno.test');

    // ── API keys: made on the API portal, listed and revoked here ──
    // The portal writes two rows for a key (xeno-api-platform portal/lib/platform-billing.ts): the key itself,
    // and a mirror row that ties it to a billing project. This is that write, so the test acts on real shapes.
    const portalKey = async (userId, name) => {
      const secret = `xeno-${crypto.randomBytes(24).toString('hex')}`;
      const id = (await pool.query(`INSERT INTO api_keys (user_id, key_prefix, key_hash, name, rate_limit_per_minute, rate_limit_per_day, is_active) VALUES ($1, $2, $3, $4, 120, 100000, TRUE) RETURNING id`, [userId, secret.slice(0, 16), crypto.createHash('sha256').update(secret).digest('hex'), name])).rows[0].id;
      await pool.query(`INSERT INTO external_api_keys (source_system, external_key_id, platform_api_key_id, legacy_status) VALUES ('xeno_private_api', $1, $2, 'ACTIVE')`, [`portal:${crypto.randomUUID()}`, id]);
      return { id, secret, hash: crypto.createHash('sha256').update(secret).digest('hex') };
    };
    const made = await portalKey(ada, 'Laptop CLI'); const stored = { key_hash: made.hash };
    const malloryKey = await portalKey(mallory, 'Mallory key');
    // there is no second creator here: the routes that would make or rename a key do not exist
    await call('POST', '/confirm', A, { password: 'correct horse' });
    assert.equal((await call('POST', '/api-keys', A, { name: 'made here' })).status, 404, 'the platform does not make keys; the API portal does');
    assert.equal((await call('PATCH', `/api-keys/${made.id}`, A, { name: 'renamed here' })).status, 404);
    assert.equal((await pool.query('SELECT count(*)::int AS c FROM api_keys WHERE user_id = $1', [ada])).rows[0].c, 1);
    const listed = (await call('GET', '/api-keys', A)).body.keys;
    assert.equal(listed.length, 1); assert.equal(listed[0].name, 'Laptop CLI'); assert.equal(listed[0].preview, `${made.secret.slice(0, 16)}…`);
    assert.equal(JSON.stringify(listed).includes(made.secret), false, 'the list never carries the key');
    assert.equal(JSON.stringify(listed).includes(made.hash), false, 'nor its hash');
    // the key signs in as its owner, on the real middleware, and cannot do what needs a person
    const K = { authorization: `Bearer ${made.secret}`, 'content-type': 'application/json' };
    assert.equal((await call('GET', '/security', K)).body.security.email, 'ada.new@xeno.test');
    assert.equal((await call('POST', '/exports', K)).body.code, 'confirmation_unavailable', 'a key cannot do what needs a person');
    assert.equal((await call('POST', '/confirm', K, { password: 'correct horse' })).body.code, 'confirmation_unavailable');
    assert.equal((await call('GET', '/api-keys', M)).body.keys.length, 1, 'each person sees only their own');
    assert.equal((await call('DELETE', `/api-keys/${made.id}`, M)).status, 404, 'and cannot revoke another person’s');
    assert.equal((await call('DELETE', `/api-keys/${made.id}`, A)).body.key.revoked, true);
    assert.equal((await call('GET', '/security', K)).status, 401, 'a revoked key stops working at once');
    assert.equal((await pool.query('SELECT legacy_status FROM external_api_keys WHERE platform_api_key_id = $1', [made.id])).rows[0].legacy_status, 'REVOKED', 'the portal’s mirror row is marked too, as the portal’s own revoke does');
    assert.equal((await pool.query('SELECT legacy_status FROM external_api_keys WHERE platform_api_key_id = $1', [malloryKey.id])).rows[0].legacy_status, 'ACTIVE', 'and nobody else’s');
    assert.equal((await call('GET', '/api-keys', A)).body.keys[0].is_active, false, 'it stays in the list as revoked');
    assert.equal((await call('DELETE', '/api-keys/not-an-id', A)).status, 404);
    const keyEvents = (await events(ada)).filter((e) => /^api_key_/.test(e.event_type));
    assert.deepEqual(keyEvents.map((e) => e.event_type), ['api_key_revoked']);
    assert.equal(JSON.stringify(keyEvents).includes(made.secret), false, 'the audit record never holds the key');

    // ── a copy of your data ──
    const projectId = (await pool.query(`INSERT INTO chat_projects (owner_user_id, created_by_user_id, name) VALUES ($1, $1, 'Analytical Engine') RETURNING id`, [ada])).rows[0].id;
    // a chat in a project carries only the project; a chat outside one carries its owner
    const convo = (await pool.query(`INSERT INTO chat_conversations (user_id, created_by_user_id, title, project_id) VALUES ($1, $1, 'Bernoulli numbers', $2) RETURNING id`, [ada, projectId])).rows[0].id;
    const loose = (await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title) VALUES ($1, $1, $1, 'A loose thought') RETURNING id`, [ada])).rows[0].id;
    await pool.query(`INSERT INTO chat_messages (conversation_id, user_id, role, content, message_index) VALUES ($1, $2, 'user', 'Note to self.', 0)`, [loose, ada]);
    await pool.query(`INSERT INTO chat_messages (conversation_id, user_id, role, content, message_index) VALUES ($1, $2, 'user', 'How do I compute them?', 0), ($1, $2, 'assistant', 'With the engine.', 1)`, [convo, ada]);
    const theirs = (await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title) VALUES ($1, $1, $1, 'Mallory private plans') RETURNING id`, [mallory])).rows[0].id;
    await pool.query(`INSERT INTO chat_messages (conversation_id, user_id, role, content, message_index) VALUES ($1, $2, 'user', 'mallory-secret-text', 0)`, [theirs, mallory]);
    const filePath = path.join(uploadDir, 'notes.txt'); writeFileSync(filePath, 'the stored bytes of notes');
    await registerManagedLibraryFile(pool, { userId: ada, filename: 'notes.txt', originalName: 'Notes on the engine.txt', mimeType: 'text/plain', fileSize: 25, storagePath: filePath, metadata: { source: 'upload' } });
    const malloryFile = path.join(uploadDir, 'm.txt'); writeFileSync(malloryFile, 'mallory-file-bytes');
    await registerManagedLibraryFile(pool, { userId: mallory, filename: 'm.txt', originalName: 'm.txt', mimeType: 'text/plain', fileSize: 18, storagePath: malloryFile, metadata: { source: 'upload' } });

    const asked1 = await call('POST', '/exports', A);
    assert.equal(asked1.status, 202); assert.equal(asked1.body.export.status, 'building');
    assert.equal((await call('POST', '/exports', A)).body.code, 'export_in_progress');
    let exp = null;
    for (let i = 0; i < 100; i += 1) { exp = (await call('GET', '/exports', A)).body.exports[0]; if (exp.status !== 'building') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(exp.status, 'ready', JSON.stringify(exp));
    assert.deepEqual(exp.summary.errors, [], 'every section was read');
    assert.equal(exp.summary.conversations, 2, 'the chat in a project and the loose one'); assert.equal(exp.summary.messages, 3); assert.equal(exp.summary.files, 1);
    const keepDays = (new Date(exp.expires_at) - Date.now()) / 86400000; assert.ok(keepDays > 6.9 && keepDays <= 7.01);
    assert.equal((await call('GET', `/exports/${exp.id}/download`, M)).status, 404, 'nobody else can fetch it');
    assert.equal((await call('GET', `/exports/${exp.id}/download`, ANOSESSION)).status, 403, 'nor a caller with no browser session');
    assert.equal((await call('GET', '/exports', M)).body.exports.length, 0);

    const res = await fetch(`${base}/exports/${exp.id}/download`, { headers: A });
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/gzip'); assert.match(res.headers.get('content-disposition'), /attachment; filename="xeno-data-\d{4}-\d\d-\d\d\.tar\.gz"/);
    const archive = Buffer.from(await res.arrayBuffer());
    assert.equal(archive.length, exp.size_bytes);
    const entries = {};
    await new Promise((resolve, reject) => {
      const extract = tar.extract();
      extract.on('entry', (header, stream, next) => { const chunks = []; stream.on('data', (c) => chunks.push(c)); stream.on('end', () => { entries[header.name] = Buffer.concat(chunks).toString('utf8'); next(); }); });
      extract.on('finish', resolve); extract.on('error', reject);
      extract.end(zlib.gunzipSync(archive));
    });
    const names = Object.keys(entries);
    for (const expected of ['README.txt', 'account.json', 'settings.json', 'sign-in-methods.json', 'sessions.json', 'api-keys.json', 'security-events.json', 'workspaces.json', 'projects.json', 'conversations/index.json', `conversations/${convo}.json`, 'artifacts.json', 'image-generations.json', 'library/index.json', 'credits/accounts.json', 'credits/transactions.json', 'manifest.json']) {
      assert.ok(names.includes(`xeno-data/${expected}`), `the copy holds ${expected}`);
    }
    assert.equal(JSON.parse(entries['xeno-data/account.json'])[0].email, 'ada.new@xeno.test');
    assert.equal(JSON.parse(entries[`xeno-data/conversations/${convo}.json`]).messages.length, 2);
    assert.equal(JSON.parse(entries['xeno-data/projects.json'])[0].name, 'Analytical Engine');
    const fileEntry = names.find((n) => n.startsWith('xeno-data/library/files/') && n.endsWith('Notes on the engine.txt'));
    assert.equal(entries[fileEntry], 'the stored bytes of notes', 'the copy holds the file itself');
    const whole = Object.values(entries).join('\n');
    for (const secret of ['password_hash', 'key_hash', 'token_hash', stored.key_hash, made.secret, 'mallory-secret-text', 'mallory-file-bytes', 'Mallory private plans', 'mallory@xeno.test']) {
      assert.equal(whole.includes(secret), false, `the copy must not contain ${secret.slice(0, 24)}`);
    }
    assert.ok(/data_export_requested/.test(JSON.stringify(await events(ada))) && /data_export_downloaded/.test(JSON.stringify(await events(ada))));

    // a day's limit, removal, and the sweep
    await call('POST', '/exports', A);
    for (let i = 0; i < 100; i += 1) { if ((await call('GET', '/exports', A)).body.exports[0].status !== 'building') break; await new Promise((r) => setTimeout(r, 100)); }
    await pool.query(`INSERT INTO account_exports (user_id, status) SELECT $1, 'failed' FROM generate_series(1, $2::int)`, [ada, Math.max(0, EXPORTS_PER_DAY - 2)]);
    const capped = await call('POST', '/exports', A);
    assert.equal(capped.status, 409); assert.equal(capped.body.code, 'export_limit');
    assert.equal((await call('DELETE', `/exports/${exp.id}`, M)).status, 404);
    assert.ok(existsSync(path.join(exportDir, `${exp.id}.tar.gz`)));
    assert.equal((await call('DELETE', `/exports/${exp.id}`, A)).status, 200);
    assert.equal(existsSync(path.join(exportDir, `${exp.id}.tar.gz`)), false, 'removing a copy removes the file');
    assert.equal((await call('GET', `/exports/${exp.id}/download`, A)).status, 404);
    const other = (await call('GET', '/exports', A)).body.exports.find((e) => e.status === 'ready');
    assert.deepEqual(await sweepExports(pool), { expired: 0, stale: 0 });
    await pool.query(`UPDATE account_exports SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [other.id]);
    const stuck = (await pool.query(`INSERT INTO account_exports (user_id, status, requested_at) VALUES ($1, 'building', NOW() - INTERVAL '2 hours') RETURNING id`, [mallory])).rows[0].id;
    assert.deepEqual(await sweepExports(pool), { expired: 1, stale: 1 });
    assert.equal(existsSync(path.join(exportDir, `${other.id}.tar.gz`)), false, 'the sweep removes a copy past its time');
    assert.equal((await pool.query('SELECT status FROM account_exports WHERE id = $1', [stuck])).rows[0].status, 'failed', 'a build whose process died is not left "building" forever');

    // ── erasing an account removes all of this too ──
    const erin = await user('erin', await bcrypt.hash('erin pw', 4)); const erinSid = await session(erin); const E = headersFor(erin, 'erin', erinSid);
    await call('POST', '/confirm', E, { password: 'erin pw' });
    await call('POST', '/exports', E);
    let erinExport = null;
    for (let i = 0; i < 100; i += 1) { erinExport = (await call('GET', '/exports', E)).body.exports[0]; if (erinExport.status !== 'building') break; await new Promise((r) => setTimeout(r, 100)); }
    await call('POST', '/email', E, { new_email: 'erin.next@xeno.test' });
    assert.ok(existsSync(path.join(exportDir, `${erinExport.id}.tar.gz`)));
    const { eraseSubject } = await import('../utils/gdprErasure.js');
    await eraseSubject(pool, erin);
    assert.equal(existsSync(path.join(exportDir, `${erinExport.id}.tar.gz`)), false, 'the copy of an erased account is removed from disk');
    for (const table of ['account_exports', 'account_codes', 'account_confirmations', 'account_confirm_throttle']) {
      assert.equal((await pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE user_id = $1`, [erin])).rows[0].c, 0, `${table} is emptied`);
    }
    assert.equal(JSON.stringify(await events(erin)).includes('erin.next@xeno.test'), false, 'audit rows lose the addresses');
    assert.ok((await events(erin)).some((e) => e.event_type === 'email_change_requested'), 'and keep the fact');

    // ── sign out everywhere ──
    const laptop = await session(ada), tablet = await session(ada);
    await pool.query(`INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, family_id, scope, sid, expires_at) VALUES ('rt-test-hash', 'xeno-test-app', $1, gen_random_uuid(), 'openid', gen_random_uuid(), NOW() + INTERVAL '30 days')`, [ada]);
    assert.equal((await liveSessions(ada)).length, 3);
    const out = await call('DELETE', '/sessions', A);
    assert.equal(out.status, 200); assert.equal(out.body.revoked_sessions, 2); assert.equal(out.body.signed_out, false);
    assert.deepEqual(await liveSessions(ada), [adaSid], 'this session stays');
    assert.equal((await call('GET', '/security', headersFor(ada, 'ada', laptop))).status, 401);
    assert.equal((await call('GET', '/security', headersFor(ada, 'ada', tablet))).status, 401);
    const tokens = (await pool.query('SELECT revoked FROM oauth_refresh_tokens WHERE user_id = $1', [ada])).rows;
    assert.equal(tokens.length, 1); assert.ok(tokens.every((t) => t.revoked === true), 'app refresh tokens are revoked too');
    assert.equal((await liveSessions(mallory)).length, 1, 'nobody else is signed out');
    const allOut = await call('DELETE', '/sessions?all=1', A);
    assert.equal(allOut.body.signed_out, true); assert.deepEqual(await liveSessions(ada), []);
    assert.equal((await call('GET', '/security', A)).status, 401, 'and with all=1 this session goes too');
    assert.ok((await events(ada)).some((e) => e.event_type === 'sessions_revoked_all'));

    console.log('account-security: all checks passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeResend.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });   // plain directories this test created, holding plain files
    rmSync(exportDir, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
