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
  const req = async (method, p, { who = me, json, body, type, headers = {} } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...as(who), ...(json ? { 'content-type': 'application/json' } : type ? { 'content-type': type } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
    return { status: r.status, d: await r.json().catch(() => null), replayed: r.headers.get('idempotent-replayed') };
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

    // ── same-name uploads: a decision, never a silent duplicate (Replace = new version, Box's way; Keep both = name (1)) ──
    const whole = async (json, bytes, who = me) => {
      const o = await req('POST', '', { json: { size: bytes.length, type: 'text/plain', ...json }, who });
      if (o.status !== 201) return o;
      for (const [i, chunk] of partsOf(bytes, PART_SIZE).entries()) assert.equal((await putPart(o.d.session.id, i + 1, chunk, who)).status, 200);
      await req('POST', `/${o.d.session.id}/complete`, { who });
      const s = await until(async () => { const g = await req('GET', `/${o.d.session.id}`, { who }); return g.d.session.state !== 'processing' && g.d.session; });
      return { status: 201, session: s };
    };
    const v1 = Buffer.from('first version'), v2 = Buffer.from('second version, longer');
    let w = await whole({ name: 'plan.txt' }, v1);
    assert.equal(w.session.state, 'done');
    const firstId = w.session.file.id;
    r = await req('POST', '', { json: { name: 'plan.txt', size: v2.length, type: 'text/plain' } });
    assert.equal(r.status, 409, 'the same name in the same place asks first');
    assert.equal(r.d.code, 'name_conflict'); assert.equal(r.d.existing.id, firstId);
    r = await req('POST', '', { json: { name: 'PLAN.TXT', size: v2.length, type: 'text/plain' } });
    assert.equal(r.status, 409, 'case-insensitive: the drive mounts on Windows');
    w = await whole({ name: 'plan.txt', onConflict: 'keep-both' }, v2);
    assert.equal(w.session.file.name, 'plan (1).txt', 'keep both names the upload name (1)');
    w = await whole({ name: 'plan.txt', onConflict: 'version' }, v2);
    assert.equal(w.session.state, 'done');
    const newest = (await pool.query('SELECT replaces_asset_id, content_sha256 FROM user_files WHERE id = $1', [w.session.file.id])).rows[0];
    assert.equal(newest.replaces_asset_id, firstId, 'replace makes it the newest version of the existing file');
    assert.equal(newest.content_sha256, sha(v2));
    const currentPlans = await pool.query(`SELECT count(*)::int AS n FROM user_files f WHERE lower(f.original_name) = 'plan.txt' AND f.created_by_user_id = $1 AND f.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_files x WHERE x.replaces_asset_id = f.id)`, [me]);
    assert.equal(currentPlans.rows[0].n, 1, 'one current plan.txt, its older bytes kept as a version');
    r = await req('POST', '', { json: { name: 'plan.txt', size: 3, type: 'text/plain', onConflict: 'whatever' } });
    assert.equal(r.d.code, 'bad_conflict_choice');

    // ── a folder: the server places the file, and a name only conflicts within its own place ──
    const myFolder = (await pool.query(`INSERT INTO storage_folders (owner_user_id, name) VALUES ($1, 'Specs') RETURNING id`, [me])).rows[0].id;
    w = await whole({ name: 'plan.txt', folder: myFolder }, v1);
    assert.equal(w.session.state, 'done', 'the same name in another folder is no conflict');
    const placed = (await pool.query(`SELECT folder_id FROM storage_item_folders WHERE source = 'file' AND source_id = $1`, [w.session.file.id])).rows[0];
    assert.equal(placed?.folder_id, myFolder, 'the server put it in the folder it was dropped on');
    r = await req('POST', '', { json: { name: 'plan.txt', size: 3, type: 'text/plain', folder: myFolder } });
    assert.equal(r.status, 409, 'and inside that folder it conflicts');
    const theirFolder = (await pool.query(`INSERT INTO storage_folders (owner_user_id, name) VALUES ($1, 'Private') RETURNING id`, [other])).rows[0].id;
    r = await req('POST', '', { json: { name: 'x.txt', size: 3, type: 'text/plain', folder: theirFolder } });
    assert.equal(r.status, 404, 'not into someone else’s folder');

    // ── a sync client replacing one file (the drive): { fileId, ifMatch } — the If-Match of /versions, for any size ──
    const planFile = (await pool.query('SELECT file_id FROM user_files WHERE id = $1', [firstId])).rows[0].file_id;
    const newestNow = async () => (await pool.query(`SELECT f.id FROM user_files f WHERE f.file_id = $1 AND NOT EXISTS (SELECT 1 FROM user_files n WHERE n.replaces_asset_id = f.id)`, [planFile])).rows[0].id;
    const headRev = await newestNow();
    const v3 = Buffer.from('third, from the drive');
    r = await req('POST', '', { json: { fileId: planFile, ifMatch: firstId, size: v3.length, type: 'text/plain' } });
    assert.equal(r.status, 412, 'a change made on an old revision is refused at open');
    assert.equal(r.d.code, 'version_conflict'); assert.equal(r.d.current, headRev, 'and the answer names the newest revision');
    w = await whole({ fileId: planFile, ifMatch: headRev }, v3);
    assert.equal(w.session.state, 'done', JSON.stringify(w.session));
    assert.equal(w.session.name, 'plan.txt', 'a version keeps the file’s name');
    const afterDrive = await newestNow();
    assert.equal((await pool.query('SELECT replaces_asset_id, content_sha256 FROM user_files WHERE id = $1', [afterDrive])).rows[0].replaces_asset_id, headRev);
    // changed elsewhere while the upload ran: the session ends version_conflict, nothing is overwritten
    const v4 = Buffer.from('fourth, raced');
    const raced = await req('POST', '', { json: { fileId: planFile, ifMatch: afterDrive, size: v4.length, type: 'text/plain' } });
    assert.equal(raced.status, 201);
    await putPart(raced.d.session.id, 1, v4);
    await whole({ name: 'plan.txt', onConflict: 'version' }, Buffer.from('someone else saved meanwhile'));
    const elsewhere = await newestNow();
    await req('POST', `/${raced.d.session.id}/complete`);
    const racedEnd = await until(async () => { const g = await req('GET', `/${raced.d.session.id}`); return g.d.session.state !== 'processing' && g.d.session; });
    assert.equal(racedEnd.state, 'failed'); assert.equal(racedEnd.errorCode, 'version_conflict', 'a change that lost the race fails with version_conflict');
    assert.equal(await newestNow(), elsewhere, 'the other change stays the newest');
    r = await req('POST', '', { json: { fileId: planFile, size: 3, type: 'text/plain' }, who: other });
    assert.equal(r.status, 404, 'not someone else’s file');

    // ── Idempotency-Key: a client that lost a reply gets the SAME session back (resume), or its file, never a second ──
    const key = `drive-op-${tag}-0001`;
    const idem = crypto.randomBytes(3000);
    const openK = (json, k = key) => req('POST', '', { json: { name: `idem-${tag}.bin`, size: idem.length, type: 'application/octet-stream', ...json }, headers: { 'idempotency-key': k } });
    const k1 = await openK({});
    assert.equal(k1.status, 201);
    await putPart(k1.d.session.id, 1, idem);
    const k2 = await openK({});
    assert.equal(k2.status, 200); assert.equal(k2.replayed, 'true');
    assert.equal(k2.d.session.id, k1.d.session.id, 'the same key returns the same session');
    assert.deepEqual(k2.d.session.parts.map((p) => p.n), [1], 'with the parts that already arrived, so the client resumes');
    await req('POST', `/${k1.d.session.id}/complete`);
    await until(async () => { const g = await req('GET', `/${k1.d.session.id}`); return g.d.session.state === 'done'; });
    const k3 = await openK({});
    assert.equal(k3.d.session.state, 'done', 'after it finished, the same key returns the finished session');
    assert.ok(k3.d.session.file?.id, 'and its file');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_files WHERE original_name = $1 AND deleted_at IS NULL', [`idem-${tag}.bin`])).rows[0].n, 1, 'one file, however many times it was asked');
    r = await openK({ size: idem.length + 1 });
    assert.equal(r.status, 409); assert.equal(r.d.code, 'idempotency_mismatch', 'the same key for a different upload is refused');
    r = await openK({}, 'bad key!');
    assert.equal(r.status, 400, 'a malformed key is refused');
    // keep-both renames the new file; a replay is still the same upload (it compares the name it asked for)
    const key2 = `drive-op-${tag}-0002`;
    const kb1 = await openK({ onConflict: 'keep-both' }, key2);
    assert.equal(kb1.status, 201); assert.notEqual(kb1.d.session.name, `idem-${tag}.bin`, 'keep-both took a free name');
    const kb2 = await openK({ onConflict: 'keep-both' }, key2);
    assert.equal(kb2.status, 200, 'a keep-both session replays under its key'); assert.equal(kb2.d.session.id, kb1.d.session.id);
    // a session that ended without a file gives its key back: the retry opens a fresh one, never the dead one
    assert.equal((await req('DELETE', `/${kb1.d.session.id}`)).status, 200);
    const kb3 = await openK({ onConflict: 'keep-both' }, key2);
    assert.equal(kb3.status, 201, 'after an abort the same key opens a NEW session'); assert.notEqual(kb3.d.session.id, kb1.d.session.id);
    await req('DELETE', `/${kb3.d.session.id}`);

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
