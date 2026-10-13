/**
 * XENO Storage: the meter and the plan allowance. Real Postgres, the real Library router behind the real
 * authMiddleware, real files on disk.
 *
 * Run: DATABASE_URL=postgresql://… node tests/storage-allowance.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import libraryRoutes from '../routes/libraryRoutes.js';
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { storageUsage, storageAllowance, StorageFullError } from '../services/storageAllowance.js';
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

    console.log('storage-allowance: all checks passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });   // a plain directory this test created, holding plain files
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
