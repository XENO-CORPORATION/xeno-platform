/**
 * XENO Storage upload sessions (routes/storageUploadRoutes.js, services/storageUploads.js): real Postgres, the real
 * router behind the real authMiddleware, the filesystem object store (so the parts go through PUT .../parts/:n, the
 * transport a deployment without an objects host uses; the objects Worker has its own tests in xeno-storage).
 *
 * Run: DATABASE_URL=postgresql://… node tests/storage-upload-sessions.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { _internal } from '../services/artifactStorage.js';
import { createStorageUploadRouter } from '../routes/storageUploadRoutes.js';
import { finishUpload, sweepUploadSessions, PART_SIZE } from '../services/storageUploads.js';
import { sniffMime, sniffInspectedMime, inspectFile } from '../services/libraryAssets.js';
import { authMiddleware } from '../middleware/auth.js';
import { fileObjectKey } from '../services/storageObjects.js';
import { storageUsage } from '../services/storageAllowance.js';
import { writeFileSync } from 'node:fs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const root = mkdtempSync(path.join(os.tmpdir(), 'upload-sessions-'));
const store = _internal.fsBackend(path.join(root, 'objects'));
const uploadsDir = path.join(root, 'uploads'); mkdirSync(uploadsDir, { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

async function main() {
  await runAllMigrations(pool);
  const tag = crypto.randomBytes(4).toString('hex');
  const user = async (n) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`${n}_${tag}`, `${n}_${tag}@xeno.test`])).rows[0].id;
  const me = await user('up_me'), other = await user('up_other');
  await pool.query(`INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'pro', 'active')`, [me]);
  const as = (userId) => ({ authorization: `Bearer ${jwt.sign({ userId, email: `x_${tag}@xeno.test`, username: `u_${tag}` }, JWT_SECRET, { expiresIn: '1h' })}` });

  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  const env = { ...process.env, DEPOT_OBJECT_URL_KEY: '', STORAGE_MAX_UPLOAD_BYTES: String(200 * 1024 * 1024), STORAGE_MIN_FREE_BYTES: '1' };
  app.use('/api/library/uploads', createStorageUploadRouter({ authMiddleware, databaseMiddleware: (_q, _s, n) => n(), uploadsDir, store, env }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/library/uploads`;
  const req = async (method, p, { who = me, json, body, type } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...as(who), ...(json ? { 'content-type': 'application/json' } : type ? { 'content-type': type } : {}) }, body: json ? JSON.stringify(json) : body });
    return { status: r.status, d: await r.json().catch(() => null) };
  };
  const partsOf = (bytes, size) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
  const putPart = (id, n, bytes, who = me) => req('PUT', `/${id}/parts/${n}`, { who, body: bytes, type: 'application/octet-stream' });

  try {
    // ── the whole flow: open → parts → complete (202) → poll until done → a real Library file ──
    const file = crypto.randomBytes(PART_SIZE * 2 + 5 * 1024 * 1024 + 123);   // 3 parts, the last short
    let r = await req('POST', '', { json: { name: 'big render.mov.bin', size: file.length, type: 'application/octet-stream' } });
    assert.equal(r.status, 201, JSON.stringify(r.d));
    const s = r.d.session;
    assert.equal(s.partCount, 3); assert.equal(s.partSize, PART_SIZE);
    assert.equal(s.transport.kind, 'platform', 'no objects host configured: parts go to this server');
    const chunks = partsOf(file, PART_SIZE);
    assert.equal((await putPart(s.id, 1, chunks[0])).status, 200);
    // a "reload": the session says which parts already arrived, so the page resumes from there
    r = await req('GET', `/${s.id}`);
    assert.deepEqual(r.d.session.parts.map((p) => p.n), [1], 'resume knows part 1 arrived');
    assert.equal((await putPart(s.id, 2, chunks[1].subarray(0, 100))).status, 400, 'a middle part must be the full part size');
    r = await req('POST', `/${s.id}/complete`);
    assert.equal(r.status, 409, 'complete before every part arrived is refused');
    assert.deepEqual(r.d.missing, [2, 3]);
    assert.equal((await putPart(s.id, 2, chunks[1])).status, 200);
    assert.equal((await putPart(s.id, 3, chunks[2])).status, 200);
    assert.equal((await putPart(s.id, 3, chunks[2], other)).status, 404, 'another account cannot touch the session');
    r = await req('POST', `/${s.id}/complete`);
    assert.equal(r.status, 202); assert.equal(r.d.session.state, 'processing');
    const done = await until(async () => { const g = await req('GET', `/${s.id}`); return g.d.session.state !== 'processing' && g.d.session; });
    assert.equal(done.state, 'done', JSON.stringify(done));
    assert.equal(done.file.size, file.length);
    const row = (await pool.query('SELECT content_sha256, file_size, storage_path, original_name FROM user_files WHERE id = $1', [done.file.id])).rows[0];
    assert.equal(row.content_sha256, sha(file), 'the registered file is exactly the uploaded bytes');
    assert.equal(row.original_name, 'big render.mov.bin');
    assert.ok(readFileSync(row.storage_path).equals(file), 'the disk copy is exact (the scanner reads it)');
    const obj = (await pool.query('SELECT object_key, size_bytes FROM storage_objects WHERE file_id = $1', [done.file.id])).rows[0];
    assert.equal(obj.object_key, fileObjectKey(sha(file)), 'recorded at its content-addressed key');
    assert.ok((await store.get(obj.object_key)).equals(file), 'the object store holds the file under its hash');
    assert.equal(await store.head(`uploads/${s.id}`), null, 'the staging object is removed');
    assert.ok((await storageUsage(pool, me)).usedBytes >= file.length, 'the file counts in the pool');
    r = await req('POST', `/${s.id}/complete`);
    assert.equal(r.d.session.state, 'done', 'complete again is idempotent');

    // ── abort ──
    r = await req('POST', '', { json: { name: 'gone.bin', size: 10, type: 'application/octet-stream' } });
    const a = r.d.session;
    await putPart(a.id, 1, crypto.randomBytes(10));
    r = await req('DELETE', `/${a.id}`);
    assert.equal(r.d.session.state, 'aborted');
    assert.equal((await putPart(a.id, 1, crypto.randomBytes(10))).status, 409, 'an aborted session takes nothing more');

    // ── refusals at open, before a byte is sent ──
    r = await req('POST', '', { json: { name: 'x.exe', size: 10, type: 'application/x-msdownload' } });
    assert.equal(r.d.code, 'type_not_allowed');
    r = await req('POST', '', { json: { name: 'huge.bin', size: 300 * 1024 * 1024, type: 'application/octet-stream' } });
    assert.equal(r.status, 413); assert.equal(r.d.code, 'too_large');
    r = await req('POST', '', { json: { name: 'free.bin', size: 6 * 1024 ** 3, type: 'application/octet-stream' }, who: other });
    assert.equal(r.status, 413, 'the cap is checked before the allowance');
    const free2 = await user('up_free');
    // a large file that exists only as a row (the meter reads rows), the way storage-allowance.test.mjs does it
    await pool.query(`INSERT INTO user_files (user_id, owner_user_id, created_by_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, metadata)
      VALUES ($1, $1, $1, 'bulk.bin', 'bulk.bin', 'application/octet-stream', 'video/mp4', 5368709120, '/nowhere/bulk.bin', 'platform-upload', '{}')`, [free2]);
    r = await req('POST', '', { json: { name: 'one more.bin', size: 1000, type: 'application/octet-stream' }, who: free2 });
    assert.equal(r.status, 507, 'a full pool refuses at open, not after the upload');
    const otherWs = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'personal', 'Theirs', $2) RETURNING id`, [other, `theirs-${tag}`])).rows[0].id;
    r = await req('POST', '', { json: { name: 'x.bin', size: 10, type: 'application/octet-stream', workspace: otherWs } });
    assert.equal(r.status, 403, 'not into another person’s personal workspace');

    // ── an assembled object that is not the announced size is never registered ──
    r = await req('POST', '', { json: { name: 'short.bin', size: 3000, type: 'application/octet-stream' } });
    const sh = r.d.session;
    await putPart(sh.id, 1, crypto.randomBytes(3000));
    const shParts = await store.listParts(`uploads/${sh.id}`, (await pool.query('SELECT multipart_id FROM storage_upload_sessions WHERE id = $1', [sh.id])).rows[0].multipart_id);
    await store.completeMultipart(`uploads/${sh.id}`, (await pool.query('SELECT multipart_id FROM storage_upload_sessions WHERE id = $1', [sh.id])).rows[0].multipart_id, shParts);
    await store.put(`uploads/${sh.id}`, crypto.randomBytes(2000));   // the store hands back fewer bytes than were sent
    await pool.query("UPDATE storage_upload_sessions SET state = 'processing' WHERE id = $1", [sh.id]);
    await finishUpload(pool, sh.id, { store, uploadsDir, log: { warn() {} } });
    const shRow = (await pool.query('SELECT state, result FROM storage_upload_sessions WHERE id = $1', [sh.id])).rows[0];
    assert.equal(shRow.state, 'failed', 'a short assembly fails the session');
    assert.equal(shRow.result, null, 'and registers no file');

    // ── the sweep finishes a session whose server stopped mid-way ──
    r = await req('POST', '', { json: { name: 'restart.bin', size: 2000, type: 'application/octet-stream' } });
    const z = r.d.session; const zb = crypto.randomBytes(2000);
    await putPart(z.id, 1, zb);
    await pool.query("UPDATE storage_upload_sessions SET state = 'processing', updated_at = now() - interval '1 hour' WHERE id = $1", [z.id]);
    const swept = await sweepUploadSessions(pool, { store, uploadsDir, log: { warn() {} } });
    assert.equal(swept.resumed, 1);
    const zr = (await pool.query('SELECT state, result FROM storage_upload_sessions WHERE id = $1', [z.id])).rows[0];
    assert.equal(zr.state, 'done');
    assert.equal((await pool.query('SELECT content_sha256 FROM user_files WHERE id = $1', [zr.result.id])).rows[0].content_sha256, sha(zb));

    // ── the streamed inspection sniffs exactly as the whole-buffer sniff ──
    const samples = [
      [Buffer.from('89504e470d0a1a0a0000', 'hex'), 'image/png'], [Buffer.from([0xff, 0xd8, 0xff, 1, 2]), 'image/jpeg'],
      [Buffer.from('%PDF-1.7 hello'), 'application/pdf'], [Buffer.from('504b030400', 'hex'), 'application/zip'],
      [Buffer.from('plain words'), 'text/plain'], [Buffer.concat([Buffer.from('text with'), Buffer.from([0]), Buffer.from('zero')]), 'text/plain'],
      [Buffer.from('{"a":1}'), 'application/json'], [crypto.randomBytes(64), 'application/octet-stream'], [Buffer.alloc(0), 'text/plain'],
      [Buffer.from('GIF89a......'), 'image/png'],
    ];
    for (const [i, [b, declared]] of samples.entries()) {
      const f = path.join(root, `s${i}`); writeFileSync(f, b);
      assert.equal(sniffInspectedMime(await inspectFile(f), declared), sniffMime(b, declared), `sample ${i}`);
    }
    console.log('storage-upload-sessions: all checks passed');
  } finally {
    server.close();
    await pool.end();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
