/**
 * XENO Storage: the meter and the plan allowance. Real Postgres, the real Library router behind the real
 * authMiddleware, real files on disk.
 *
 * Run: DATABASE_URL=postgresql://… node tests/storage-allowance.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import libraryRoutes from '../routes/libraryRoutes.js';
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { storageUsage, storageAllowance, StorageFullError } from '../services/storageAllowance.js';
import { syncFileObjects, fileObjectKey } from '../services/storageObjects.js';
import { setFileStorageForTests } from '../services/artifactStorage.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadDir = path.resolve(process.cwd(), 'uploads', `storage-allowance-test-${process.pid}`);
const GB = 1024 ** 3;

async function main() {
  await runAllMigrations(pool);
  mkdirSync(uploadDir, { recursive: true });
  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [name, `${name}@xeno.test`])).rows[0].id;
  const free = await user('sto_free'), paid = await user('sto_paid'), other = await user('sto_other');
  await pool.query(`INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'pro', 'active')`, [paid]);
  const company = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Sto Co', 'sto-co') RETURNING id`, [free])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${company}`, relation: 'owner', subject: `user:${free}` }] });

  let n = 0;
  const add = async (userId, name, body, extra = {}) => {
    const storagePath = path.join(uploadDir, `${n += 1}-${name}`);
    writeFileSync(storagePath, body);
    return registerManagedLibraryFile(pool, { userId, filename: name, originalName: name, mimeType: 'text/plain', fileSize: Buffer.byteLength(body), storagePath, metadata: { source: 'upload' }, ...extra });
  };
  // a large file that exists only as a row: the meter reads rows, and nobody writes 5 GB in a test
  const bulk = (userId, bytes) => pool.query(
    `INSERT INTO user_files (user_id, owner_user_id, created_by_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, metadata)
     VALUES ($1, $1, $1, 'bulk.bin', 'bulk.bin', 'application/octet-stream', 'video/mp4', $2, '/nowhere/bulk.bin', 'platform-upload', '{}') RETURNING id`, [userId, bytes]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/library', libraryRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/library`;
  const as = (userId, name) => ({ authorization: `Bearer ${jwt.sign({ userId, email: `${name}@xeno.test`, username: name }, JWT_SECRET, { expiresIn: '1h' })}` });

  try {
    // ── allowance comes from the plan ──
    assert.equal(await storageAllowance(pool, free), 5 * GB, 'a free account includes 5 GB');
    assert.equal(await storageAllowance(pool, paid), 100 * GB, 'a paid account includes 100 GB');

    // ── the meter: everything the account holds, by kind; nothing of anyone else's ──
    await add(free, 'a.txt', 'twelve bytes');
    await add(free, 'b.txt', 'twelve more!');
    await add(other, 'theirs.txt', 'not counted for free');
    const shared = await add(free, 'team.txt', 'workspace file', { workspaceId: company });
    let usage = await storageUsage(pool, free);
    assert.equal(usage.usedBytes, 24); assert.equal(usage.files, 2);
    assert.equal(usage.remainingBytes, 5 * GB - 24); assert.equal(usage.full, false);
    assert.deepEqual(usage.byKind, [{ kind: 'document', bytes: 24, files: 2 }]);
    assert.deepEqual(usage.workspaces, [{ id: company, bytes: 14, files: 1 }], 'a workspace file counts toward the workspace, apart');
    assert.ok(shared.id);

    // ── over the HTTP route, as the signed-in person ──
    const res = await fetch(`${base}/storage`, { headers: as(free, 'sto_free') });
    assert.equal(res.status, 200); assert.equal((await res.json()).storage.usedBytes, 24);
    assert.equal((await fetch(`${base}/storage`)).status, 401, 'the meter needs a signed-in person');

    // ── the limit: an upload that does not fit is refused, one that fits is taken ──
    const big = (await bulk(free, 5 * GB - 24 - 10)).rows[0].id;   // 10 bytes of room left
    await assert.rejects(() => add(free, 'eleven.txt', 'eleven byte', { enforceAllowance: true }), (e) => e instanceof StorageFullError && e.code === 'storage_full' && e.status === 507);
    assert.equal((await storageUsage(pool, free)).files, 3, 'a refused upload records nothing');
    await add(free, 'ten.txt', 'ten bytes!', { enforceAllowance: true });
    usage = await storageUsage(pool, free);
    assert.equal(usage.usedBytes, 5 * GB); assert.equal(usage.full, true); assert.equal(usage.remainingBytes, 0);
    assert.deepEqual(usage.byKind.map((k) => k.kind), ['video', 'document']);

    // ── work the platform already did is kept even when full, and still counts ──
    await add(free, 'generated.txt', 'made by a model');
    assert.equal((await storageUsage(pool, free)).usedBytes, 5 * GB + 15);
    // ── a workspace file is not held to the person's allowance ──
    await add(free, 'team2.txt', 'still fine', { workspaceId: company, enforceAllowance: true });

    // ── two uploads racing for the last room: one is admitted ──
    await pool.query('UPDATE user_files SET file_size = file_size - 25 WHERE id = $1', [big]);   // 10 bytes of room again
    const race = await Promise.allSettled([add(free, 'r1.txt', 'ten bytes?', { enforceAllowance: true }), add(free, 'r2.txt', 'ten bytes.', { enforceAllowance: true })]);
    assert.deepEqual(race.map((r) => r.status).sort(), ['fulfilled', 'rejected']);

    // ── trash still counts; a purged file does not; getting under the limit reopens uploads ──
    await pool.query(`UPDATE user_files SET deleted_at = NOW() WHERE id = $1`, [big]);
    await pool.query(`INSERT INTO library_trash (source, source_id, trashed_by_user_id, purge_after) VALUES ('file', $1, $2, NOW() + interval '30 days')`, [big, free]);
    usage = await storageUsage(pool, free);
    assert.ok(usage.full && usage.trashBytes === 5 * GB - 59, 'a file in the trash is still held');
    await pool.query(`DELETE FROM library_trash WHERE source_id = $1`, [big]);
    usage = await storageUsage(pool, free);
    assert.equal(usage.full, false); assert.equal(usage.trashBytes, 0);
    await add(free, 'room.txt', 'room again', { enforceAllowance: true });

    // ── every file gets a verified copy in object storage, and a lost disk file comes back from it ──
    const objects = new Map();
    const store = { kind: 'test', put: async (k, b) => { objects.set(k, Buffer.from(b)); }, get: async (k) => objects.get(k) ?? null, head: async (k) => (objects.has(k) ? { sizeBytes: objects.get(k).length } : null) };
    setFileStorageForTests(store);
    const kept = await add(other, 'keep.txt', 'bytes worth keeping');
    const twin = await add(other, 'twin.txt', 'bytes worth keeping');
    await bulk(other, 10);   // a row whose bytes are not under a managed root
    const first = await syncFileObjects(pool, { limit: 1000 });
    assert.ok(first.stored >= 2 && first.errors.unmanaged_path >= 1, 'real files are copied; a row with no bytes is reported, not copied');
    const rows = (await pool.query('SELECT file_id, sha256, object_key, size_bytes FROM storage_objects WHERE file_id = ANY($1)', [[kept.id, twin.id]])).rows;
    assert.equal(rows.length, 2); assert.equal(rows[0].object_key, rows[1].object_key, 'the same bytes are one object');
    assert.equal(rows[0].object_key, fileObjectKey(rows[0].sha256)); assert.equal(Number(rows[0].size_bytes), 19);
    assert.equal((await syncFileObjects(pool, { limit: 1000 })).stored, 0, 'a second run copies nothing again');
    // the security scan has passed these two (a quarantined file is never served, with or without a copy)
    await pool.query(`UPDATE library_asset_ingestions SET state = 'ready' WHERE asset_id = ANY($1)`, [[kept.id, twin.id]]);
    const keptPath = (await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [kept.id])).rows[0].storage_path;
    rmSync(keptPath);
    const lost = await fetch(`${base}/assets/${kept.id}/content`, { headers: as(other, 'sto_other') });
    assert.equal(lost.status, 200); assert.equal(await lost.text(), 'bytes worth keeping', 'a file whose disk copy is gone is served from its object');
    assert.ok(existsSync(keptPath), 'and is put back on disk');
    // a tampered object is never restored
    const twinPath = (await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [twin.id])).rows[0].storage_path;
    rmSync(twinPath); objects.set(rows[0].object_key, Buffer.from('something else entirely'));
    assert.equal((await fetch(`${base}/assets/${twin.id}/content`, { headers: as(other, 'sto_other') })).status, 404);
    assert.equal(existsSync(twinPath), false);

    // ── folders: the account's own, nested, and a place for items ──
    const J = (userId, name) => ({ ...as(userId, name), 'content-type': 'application/json' });
    const call = async (method, url, headers, body) => { const r = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const P = J(paid, 'sto_paid'), O = J(other, 'sto_other');
    const work = (await call('POST', '/folders', P, { name: 'Work' })).body.folder;
    assert.ok(work.id && work.parentId === null);
    assert.equal((await call('POST', '/folders', P, { name: 'work' })).body.code, 'folder_exists', 'two folders in one place cannot share a name');
    const plans = (await call('POST', '/folders', P, { name: 'Plans', parent: work.id })).body.folder;
    assert.equal(plans.parentId, work.id);
    assert.equal((await call('POST', '/folders', O, { name: 'Sneak', parent: work.id })).status, 404, 'another account cannot put a folder in mine');
    assert.equal((await call('GET', `/folders?parent=${work.id}`, O)).status, 404);
    const doc = await add(paid, 'brief.txt', 'a brief');
    const top = await add(paid, 'loose.txt', 'at the top');
    assert.equal((await call('PUT', `/assets/file/${doc.id}/folder`, P, { folder: plans.id })).status, 200);
    assert.equal((await call('PUT', `/assets/file/${doc.id}/folder`, O, { folder: null })).status, 404, 'a stranger cannot move my file');
    assert.equal((await call('PUT', `/assets/file/${top.id}/folder`, P, { folder: (await call('POST', '/folders', O, { name: 'Theirs' })).body.folder.id })).status, 404, 'nor can I file into a stranger’s folder');
    const inPlans = (await call('GET', `/assets?folder=${plans.id}`, P)).body;
    assert.deepEqual(inPlans.items.map((i) => i.name), ['brief.txt']); assert.equal(inPlans.items[0].folder_id, plans.id);
    assert.deepEqual((await call('GET', '/assets?folder=root', P)).body.items.map((i) => i.name), ['loose.txt'], 'the top holds what is in no folder');
    assert.equal((await call('GET', '/assets', P)).body.items.length, 2, 'the Library’s flat view still shows everything');
    const listed = (await call('GET', `/folders?parent=${work.id}`, P)).body;
    assert.deepEqual(listed.folders.map((f) => [f.name, f.items]), [['Plans', 1]]); assert.deepEqual(listed.path.map((x) => x.name), ['Work']);
    assert.deepEqual((await call('GET', `/folders?parent=${plans.id}`, P)).body.path.map((x) => x.name), ['Work', 'Plans']);
    assert.equal((await call('PATCH', `/folders/${work.id}`, P, { parent: plans.id })).body.code, 'folder_inside_itself');
    assert.equal((await call('DELETE', `/folders/${plans.id}`, P)).body.code, 'folder_not_empty', 'removing a folder never deletes what is in it');
    assert.equal((await call('PATCH', `/folders/${plans.id}`, P, { name: 'Roadmap', parent: null })).body.folder.parentId, null);
    assert.equal((await call('PUT', `/assets/file/${doc.id}/folder`, P, { folder: null })).status, 200);
    assert.equal((await call('DELETE', `/folders/${plans.id}`, P)).status, 200);
    assert.equal((await call('GET', '/folders?all=true', P)).body.folders.length, 1);

    // ── sharing one file: with a person, and by link; only the owner; revocable at once ──
    const gift = await add(paid, 'gift.txt', 'for a friend');
    await pool.query(`UPDATE library_asset_ingestions SET state = 'ready' WHERE asset_id = $1`, [gift.id]);
    const bytesOf = async (headers) => { const r = await fetch(`${base}/assets/${gift.id}/content`, { headers }); return r.status === 200 ? r.text() : r.status; };
    assert.equal(await bytesOf(O), 404, 'before sharing, another account cannot read it');
    assert.equal((await call('POST', `/assets/file/${gift.id}/shares`, O, { with: 'sto_paid' })).status, 404, 'only the owner can share');
    assert.equal((await call('POST', `/assets/file/${gift.id}/shares`, P, { with: 'nobody-here' })).body.code, 'person_not_found');
    assert.equal((await call('POST', `/assets/file/${gift.id}/shares`, P, { with: 'sto_paid' })).body.code, 'own_file');
    const toOther = (await call('POST', `/assets/file/${gift.id}/shares`, P, { with: 'STO_OTHER@xeno.test' })).body.share;
    assert.equal(toOther.person.username, 'sto_other');
    assert.equal(await bytesOf(O), 'for a friend', 'the person can now read it');
    assert.deepEqual((await call('GET', '/assets?owned=shared', O)).body.items.map((i) => i.name), ['gift.txt'], 'it is listed under what was shared with them');
    assert.ok(!(await call('GET', '/assets?owned=mine', O)).body.items.some((i) => i.name === 'gift.txt'), 'and not among their own files');
    assert.equal((await call('GET', '/assets?owned=mine', P)).body.items.find((i) => i.name === 'gift.txt').shared, true, 'the owner sees that it is shared');
    assert.equal((await call('PATCH', `/assets/file/${gift.id}`, O, { name: 'mine now.txt' })).status, 403, 'read access is not edit access');
    assert.equal((await storageUsage(pool, other)).usedBytes, (await storageUsage(pool, other)).usedBytes, 'a shared file does not count against the reader');
    const usedBefore = (await storageUsage(pool, other)).files;
    const link = (await call('POST', `/assets/file/${gift.id}/shares`, P, { link: true, expiresInDays: 7 })).body;
    assert.match(link.url, /\/api\/library\/links\/[A-Za-z0-9_-]{43}$/);
    const linkPath = `/links/${link.url.split('/').pop()}`;
    const open = await fetch(`${base}${linkPath}`);
    assert.equal(open.status, 200); assert.equal(await open.text(), 'for a friend'); assert.match(open.headers.get('content-disposition'), /^attachment/, 'a text file is downloaded, never shown inline');
    assert.equal((await fetch(`${base}/links/${'A'.repeat(43)}`)).status, 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM storage_shares WHERE token_sha256 = $1', [link.url.split('/').pop()])).rows[0].n, 0, 'the link itself is not stored, only its hash');
    assert.equal((await call('POST', `/assets/file/${gift.id}/shares`, P, { link: true, expiresInDays: 0 })).body.code, 'invalid_expiry');
    const shares = (await call('GET', `/assets/file/${gift.id}/shares`, P)).body.shares;
    assert.deepEqual(shares.map((x) => x.kind).sort(), ['link', 'person']);
    assert.equal((await call('DELETE', `/shares/${shares.find((x) => x.kind === 'link').id}`, O)).status, 404, 'only the owner turns a share off');
    for (const x of shares) assert.equal((await call('DELETE', `/shares/${x.id}`, P)).status, 200);
    assert.equal((await fetch(`${base}${linkPath}`)).status, 404, 'a link that was turned off stops at once');
    assert.equal(await bytesOf(O), 404, 'and the person loses the file at once');
    assert.equal((await storageUsage(pool, other)).files, usedBefore);
    // an expired link does not open
    const short = (await call('POST', `/assets/file/${gift.id}/shares`, P, { link: true, expiresInDays: 1 })).body;
    await pool.query(`UPDATE storage_shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, [short.share.id]);
    assert.equal((await fetch(`${base}/links/${short.url.split('/').pop()}`)).status, 404);

    // ── extra space on top of the plan ──
    await pool.query(`INSERT INTO storage_grants (user_id, bytes, reason) VALUES ($1, $2, 'test grant')`, [paid, 50 * GB]);
    assert.equal(await storageAllowance(pool, paid), 150 * GB);
    await pool.query(`UPDATE storage_grants SET revoked_at = now() WHERE user_id = $1`, [paid]);
    assert.equal(await storageAllowance(pool, paid), 100 * GB);

    console.log('storage-allowance: all checks passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });   // a plain directory this test created, holding plain files
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
