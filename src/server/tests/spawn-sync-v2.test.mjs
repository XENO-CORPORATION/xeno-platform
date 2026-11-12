/**
 * Spawn sync v2 (routes/spawnItemRoutes.js, routes/spawnBackupRoutes.js) over the real handlers and real Postgres.
 * Proves the platform's half of the v2 acceptance list (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md):
 *   1. projects and named sessions round-trip; a stale write is a 409 that changes nothing; a second account sees none of them
 *   3. what the server stores for a backup contains no plaintext (a marker in the transcript, its folder and its title)
 *   5. a new device gets the wrapped key only by approval from an approved device or by the recovery key; the server never holds one
 *   plus: a wrapped key is never rewritten (the database refuses it too), a segment is never overwritten, the bytes are in the
 *   person's Storage and count against the allowance.
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/spawn-sync-v2.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { storageUsage } from '../services/storageAllowance.js';
import { spawnItemHandlers } from '../routes/spawnItemRoutes.js';
import { spawnBackupKeyHandlers, spawnBackupObjectHandlers, backupProjectId, BACKUP_APP } from '../routes/spawnBackupRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `sv2${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0].id;
const message = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };
const dev = () => crypto.randomUUID();
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const x25519 = () => { const k = crypto.generateKeyPairSync('x25519'); return { pub: b64(k.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)), priv: k.privateKey }; };

async function main() {
  // the routes are mounted behind the same sign-in and DPoP check as /api/v2/spawn/profiles: the account is the token's
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  for (const mount of ["'/api/v2/spawn/projects', databaseMiddleware, oidcAuth, requireDpopIfBound, spawnItemRouter('project')",
    "'/api/v2/spawn/sessions', databaseMiddleware, oidcAuth, requireDpopIfBound, spawnItemRouter('session')",
    "'/api/v2/spawn/backup', databaseMiddleware, oidcAuth, requireDpopIfBound, spawnBackupRoutes({ uploadsDir })"]) {
    ok(index.includes(mount), `mounted with sign-in and DPoP: ${mount.split(',')[0]}`);
  }
  await runAllMigrations(pool);
  const A = await user('a'), B = await user('b');
  // Storage reads only under its managed root (<cwd>/uploads), as project-folders.test.mjs does
  const uploadsDir = path.resolve(process.cwd(), 'uploads', `spawn-sync-v2-test-${process.pid}`);
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    // ── 1. projects and named sessions
    const P = spawnItemHandlers(pool, 'project'), S = spawnItemHandlers(pool, 'session');
    const dA = dev(), dB = dev();
    const project = { name: 'Platform', tabs: [{ title: 'Main', vendor: 'claude', permission: 'auto', sessionId: 'abc-123', profileId: 'work' }], folders: { [dA]: 'X:\\code\\platform' } };
    ok((await P.put(A, 'p1', 0, project)).body.rev === 1, 'a project is stored at rev 1');
    ok((await P.put(A, 'p1', 0, { ...project, name: 'Stale' })).status === 409, 'a write on a stale base is a 409');
    ok((await P.list(A)).projects[0].record.name === 'Platform', 'and changes nothing');
    ok((await P.put(A, 'p1', 1, { ...project, folders: { ...project.folders, [dB]: '/home/me/platform' } })).body.rev === 2, 'a second device adds its own folder');
    const both = await Promise.all([P.put(A, 'p1', 2, { ...project, name: 'One' }), P.put(A, 'p1', 2, { ...project, name: 'Two' })]);
    ok(both.filter((r) => r.status === 200).length === 1 && both.filter((r) => r.status === 409).length === 1, 'two writes on the same base: one wins, one is a 409');
    ok((await P.list(B)).projects.length === 0, 'a second account sees no projects');
    ok((await P.put(B, 'p1', 0, project)).body.rev === 1 && (await P.list(A)).projects[0].rev === 3, 'the same id under another account is its own item');
    ok((await P.put(A, 'p2', 0, { ...project, apiKey: 'sk-x' })).status === 400, 'an unknown field is refused, not trimmed');
    ok((await P.put(A, 'p2', 0, { ...project, tabs: [{ vendor: 'claude', token: 'x' }] })).status === 400, 'an unknown tab field is refused');
    ok((await P.put(A, 'p2', 0, { ...project, folders: { notadevice: '/x' } })).status === 400, 'a folder is keyed by a device id');
    ok((await P.put(A, '../x', 0, project)).status === 400, 'an id is one safe name');
    const session = { name: 'Fix the ledger', vendor: 'codex', sessionId: 'sess-9', chosen: true, permission: 'ask', profileId: 'work', folders: { [dA]: 'X:\\code' } };
    ok((await S.put(A, 's1', 0, session)).body.rev === 1, 'a named session is stored');
    ok((await S.put(A, 's1', 0, { ...session, chosen: 'yes' })).status === 400, 'chosen is true or false');
    ok((await S.list(A)).sessions[0].record.vendor === 'codex' && (await S.list(B)).sessions.length === 0, 'sessions are per account');
    ok((await P.list(A)).projects.every((p) => p.id), 'projects come back under id');
    ok((await S.remove(A, 's1', 0)).status === 409 && (await S.remove(A, 's1', 1)).body.deleted === true, 'a delete takes the current rev and leaves a tombstone');
    ok((await S.list(A)).sessions[0].deleted === true && !('record' in (await S.list(A)).sessions[0]), 'the tombstone carries no record');

    // ── 5. keys: the first device, approval, recovery
    const K = spawnBackupKeyHandlers(pool);
    const d1 = dev(), d2 = dev(), d3 = dev(), k1 = x25519(), k2 = x25519(), k3 = x25519();
    const wrapped = (n) => b64(crypto.randomBytes(92 + n));
    ok((await K.register(A, d1, { publicKey: k1.pub, name: 'DESKTOP', wrappedKey: wrapped(0) })).body.device.state === 'approved', 'the first device brings its own wrapped key');
    ok((await K.register(A, d2, { publicKey: k2.pub, name: 'LAPTOP', wrappedKey: wrapped(1) })).body?.error?.code === 'APPROVAL_REQUIRED', 'a second device cannot bootstrap a key of its own');
    ok((await K.register(A, d2, { publicKey: k2.pub, name: 'LAPTOP' })).body.device.state === 'pending', 'it waits, pending, with only its public key');
    ok((await K.register(A, d2, { publicKey: k3.pub })).body?.error?.code === 'DEVICE_KEY_MISMATCH', 'a device’s public key never changes');
    ok((await K.approve(A, d2, { byDeviceId: d2, wrappedKey: wrapped(2) })).body?.error?.code === 'SELF_APPROVAL', 'a device cannot approve itself');
    ok((await K.approve(A, d2, { byDeviceId: d3, wrappedKey: wrapped(2) })).status === 403, 'nor can a device that is not approved');
    ok((await K.approve(B, d2, { byDeviceId: d1, wrappedKey: wrapped(2) })).status === 403, 'nor another account, with this account’s device ids');
    const w2 = wrapped(2);
    ok((await K.approve(A, d2, { byDeviceId: d1, wrappedKey: w2 })).body.device.state === 'approved', 'an approved device approves the pending one');
    ok((await K.approve(A, d2, { byDeviceId: d1, wrappedKey: w2 })).body.replayed === true, 'the same approval again is a replay');
    ok((await K.approve(A, d2, { byDeviceId: d1, wrappedKey: wrapped(3) })).body?.error?.code === 'ALREADY_APPROVED', 'a wrapped key is never replaced');
    ok((await K.setRecovery(A, { byDeviceId: d3, wrappedKey: wrapped(4) })).status === 403, 'only an approved device sets the recovery record');
    const r1 = wrapped(4);
    ok((await K.setRecovery(A, { byDeviceId: d1, wrappedKey: r1 })).body.recovery.wrappedKey === r1, 'the recovery record is set');
    ok((await K.setRecovery(A, { byDeviceId: d1, wrappedKey: wrapped(5) })).body.replayed === false
      && (await pool.query("SELECT count(*)::int n FROM spawn_backup_keys WHERE user_id=$1 AND kind='recovery'", [A])).rows[0].n === 2, 'a new recovery record supersedes the old one, which is kept');
    ok((await K.register(A, d3, { publicKey: k3.pub, wrappedKey: wrapped(6), via: 'recovery' })).body.device.state === 'approved', 'a device that restored with the recovery key is approved by it');
    ok((await K.register(B, d3, { publicKey: k3.pub, wrappedKey: wrapped(6), via: 'recovery' })).body?.error?.code === 'NO_RECOVERY', 'an account with nothing to recover from cannot claim it did');
    ok((await K.revoke(A, d2, { byDeviceId: d1 })).body.device.state === 'revoked', 'a device can be revoked');
    ok((await K.register(A, d2, { publicKey: k2.pub })).body?.error?.code === 'DEVICE_REVOKED', 'and stays revoked');
    const listed = (await K.list(A)).body;
    ok(listed.devices.length === 3 && listed.events.some((e) => e.kind === 'approved' && e.byDeviceId === d1), 'the account sees its devices and who approved whom');
    ok((await K.list(B)).body.devices.length === 0 && (await K.list(B)).body.recovery === null, 'another account sees none of it');
    ok(/never rewritten/.test(await message(pool.query("UPDATE spawn_backup_keys SET wrapped_key=$2 WHERE user_id=$1 AND device_id=$3", [A, wrapped(7), d1]))), 'the database refuses rewriting a wrapped key');
    ok(/never changes/.test(await message(pool.query('UPDATE spawn_backup_key_events SET kind=$2 WHERE user_id=$1', [A, 'revoked']))), 'and changing the key log');
    const firstRace = await Promise.all([dev(), dev()].map((d) => K.register(B, d, { publicKey: x25519().pub, wrappedKey: wrapped(8) })));
    ok(firstRace.filter((r) => r.body?.device?.state === 'approved').length === 1, 'two devices racing to be first: exactly one wins');

    // ── 3. segments: ciphertext only, append-only, in Storage
    const O = spawnBackupObjectHandlers(pool, { uploadsDir });
    const dataKey = crypto.randomBytes(32), objectId = b64(crypto.randomBytes(18));
    const MARK = `PLAINTEXT-MARKER-${tag}`;
    const seal = (n, plain) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', dataKey, iv); c.setAAD(Buffer.from(`${objectId}/${n}`));
      return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]); };
    const seg0 = seal(0, Buffer.from(JSON.stringify({ folder: `X:\\${MARK}\\project`, title: `${MARK} title`, line: `${MARK} transcript` }) + '\n'));
    const put0 = await O.put(A, objectId, 'segments', 0, seg0);
    ok(put0.status === 200 && put0.body.created === true, 'a segment is stored');
    ok((await O.put(A, objectId, 'segments', 0, seg0)).body.created === false, 'the same bytes again answer the same');
    ok((await O.put(A, objectId, 'segments', 0, seal(0, Buffer.from('other')))).body?.error?.code === 'ALREADY_WRITTEN', 'different bytes for a written number are refused');
    ok((await O.put(A, 'short', 'segments', 1, seg0)).status === 400 && (await O.put(A, objectId, 'secrets', 1, seg0)).status === 404, 'object ids and parts are checked');
    await O.put(A, objectId, 'segments', 1, seal(1, Buffer.from(`${MARK} more\n`)));
    await O.put(A, objectId, 'versions', 0, seal(0, Buffer.from(`${MARK} whole\n`)));
    const objects = (await O.list(A)).body.objects;
    ok(objects.length === 1 && objects[0].segments.map((s) => s.n).join() === '0,1' && objects[0].versions.length === 1, 'the list shows the object, its segments and versions');
    ok((await O.list(B)).body.objects.length === 0, 'another account sees no objects');
    ok((await O.read(B, objectId, 'segments', 0)).status === 404, 'nor reads one');
    const read = await O.read(A, objectId, 'segments', 0);
    const stored = fs.readFileSync(read.file.local_path);
    ok(stored.equals(seg0), 'the bytes read back are the bytes written');
    const files = (await pool.query(`SELECT f.storage_path, f.file_size, f.original_name, f.metadata FROM user_files f JOIN project_files pf ON pf.file_id = f.file_id
      WHERE pf.app = $1 AND pf.project_id = $2 AND f.deleted_at IS NULL`, [BACKUP_APP, backupProjectId(A)])).rows;
    ok(files.length === 3 && files.every((f) => !fs.readFileSync(f.storage_path).includes(MARK) && !JSON.stringify(f).includes(MARK)), 'no stored byte or file record holds the plaintext marker (transcript, folder or title)');
    const opened = (() => { const iv = stored.subarray(0, 12), tagB = stored.subarray(-16), d = crypto.createDecipheriv('aes-256-gcm', dataKey, iv); d.setAAD(Buffer.from(`${objectId}/0`)); d.setAuthTag(tagB);
      return Buffer.concat([d.update(stored.subarray(12, -16)), d.final()]).toString(); })();
    ok(opened.includes(MARK), 'only the data key opens it');
    const folder = (await pool.query(`SELECT sf.name, p.name AS parent FROM project_folders pf JOIN storage_folders sf ON sf.id = pf.folder_id LEFT JOIN storage_folders p ON p.id = sf.parent_id
      WHERE pf.app = $1 AND pf.project_id = $2`, [BACKUP_APP, backupProjectId(A)])).rows[0];
    ok(folder.parent === 'Spawn backup', 'the backup sits in one "Spawn backup" folder in the person’s Storage');
    const stored3 = files.reduce((n, f) => n + Number(f.file_size), 0);
    ok(stored3 > 0 && (await storageUsage(pool, A)).usedBytes >= stored3, 'every segment counts against the person’s Storage allowance');
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
