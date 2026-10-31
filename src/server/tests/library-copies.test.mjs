/**
 * Library: duplicate, move to a project, and Shared with me, on real Postgres with real files.
 *
 *   - a copy is a new file with the same bytes; a second copy gets its own name; it sits beside the original
 *   - a copy counts against the allowance, and over it nothing is left behind
 *   - a stranger gets "not found"; someone it was shared with gets their own copy, not a place in the owner's folder
 *   - moving files the item in the project's folder; a project you can't edit, or a workspace's project for a personal file, refuses
 *   - the list says who shared a file and which project it is in
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/library-copies.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { registerManagedLibraryFile, listLibraryItems } from '../services/libraryAssets.js';
import { duplicateFile, moveToProject } from '../services/libraryCopies.js';
import { shareWithPerson } from '../services/storageShares.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `lc${process.pid}`, dir = path.resolve(process.cwd(), 'uploads', `library-copies-${process.pid}`);
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s])).rows[0].id;
let seq = 0;
const file = async (userId, name, body = 'hello', workspaceId = null) => { const p = path.join(dir, `${seq += 1}-${name}`); fs.writeFileSync(p, body); return (await registerManagedLibraryFile(pool, { userId, workspaceId, filename: path.basename(p), originalName: name, mimeType: 'text/plain', fileSize: Buffer.byteLength(body), storagePath: p, area: null })).id; };
const row = async (id) => (await pool.query('SELECT * FROM user_files WHERE id = $1', [id])).rows[0];
const project = async (owner, name, workspaceId = null) => { const id = (await pool.query(`INSERT INTO chat_projects (owner_user_id, workspace_id, name) VALUES ($1,$2,$3) RETURNING id`, [workspaceId ? null : owner, workspaceId, name])).rows[0].id; await writeTuples(pool, { writes: [{ object: `project:${id}`, relation: 'owner', subject: `user:${owner}` }] }); return id; };
const listed = async (u, id) => (await listLibraryItems(pool, u, { limit: 200 })).items.find((x) => String(x.source_id) === String(id));

async function main() {
  await runAllMigrations(pool);
  fs.mkdirSync(dir, { recursive: true });
  const me = await user('me'), friend = await user('friend'), stranger = await user('stranger');

  // duplicate
  const a = await file(me, 'report.txt', 'the bytes');
  const c1 = await duplicateFile(pool, me, a);
  ok(c1.ok && c1.file.id !== a && c1.file.name === 'report copy.txt', 'a copy is a new file, named as a copy');
  const r1 = await row(c1.file.id);
  ok(fs.readFileSync(r1.storage_path, 'utf8') === 'the bytes' && r1.storage_path !== (await row(a)).storage_path, 'with the same bytes in its own place');
  ok(String(r1.owner_user_id) === String(me) && r1.metadata.duplicated_from === a, 'it is yours, and remembers where it came from');
  ok(String(r1.file_id) !== String((await row(a)).file_id), 'and has its own history');
  ok((await duplicateFile(pool, me, a)).file.name === 'report copy 2.txt', 'a second copy gets its own name');
  ok((await duplicateFile(pool, stranger, a)).notFound === true, 'a stranger is told it does not exist');
  ok((await duplicateFile(pool, me, 'nope')).invalid === true, 'a bad id is refused');

  // beside the original
  const folder = (await pool.query(`INSERT INTO storage_folders (owner_user_id, name) VALUES ($1,'Docs') RETURNING id`, [me])).rows[0].id;
  await moveToProject(pool, me, 'file', a, null);
  await pool.query(`INSERT INTO storage_item_folders (source, source_id, folder_id) VALUES ('file',$1,$2)`, [a, folder]);
  const c3 = await duplicateFile(pool, me, a);
  ok((await pool.query(`SELECT folder_id FROM storage_item_folders WHERE source='file' AND source_id=$1`, [c3.file.id])).rows[0]?.folder_id === folder, 'a copy sits beside the original');

  // shared with someone
  const shared = await file(me, 'plan.txt', 'shared bytes');
  ok((await shareWithPerson(pool, me, { fileId: shared }, `${tag}friend`, 'viewer')).ok, 'a file is shared');
  const fc = await duplicateFile(pool, friend, shared);
  ok(fc.ok && String((await row(fc.file.id)).owner_user_id) === String(friend), 'who it was shared with gets a copy of their own');
  const seen = await listed(friend, shared);
  ok(seen && seen.mine === false && seen.shared_by === 'me', 'the list says who shared it');
  ok((await listed(friend, fc.file.id)).shared_by === null, 'and their own copy is not "shared"');

  // the allowance
  await pool.query(`UPDATE user_files SET file_size = 2147483647 WHERE id = $1`, [a]);
  const before = fs.readdirSync(dir).length;
  let full; for (let i = 0; i < 400 && !full; i++) { const big = await file(me, `big${i}.txt`); await pool.query(`UPDATE user_files SET file_size = 2147483647 WHERE id = $1`, [big]); const had = fs.readdirSync(dir).length, t = await duplicateFile(pool, me, big); if (t.full) full = { had, files: fs.readdirSync(dir).length }; }
  ok(full, 'over the allowance a copy is refused');
  ok(before >= 0 && full.files === full.had, 'and leaves no file behind');
  await pool.query(`DELETE FROM user_files WHERE owner_user_id = $1 AND original_name LIKE 'big%'`, [me]);
  await pool.query(`UPDATE user_files SET file_size = 9 WHERE id = $1`, [a]);

  // a project
  const pj = await project(me, 'Launch'), f2 = await file(me, 'note.txt');
  const moved = await moveToProject(pool, me, 'file', f2, pj);
  ok(moved.ok && moved.folderId, 'moving files it in the project’s folder');
  ok((await listed(me, f2)).project_name === 'Launch', 'and the list says which project');
  const untouched = await project(friend, 'Untouched');
  ok((await moveToProject(pool, stranger, 'file', f2, untouched)).notFound === true, 'someone not on the project is told it does not exist');
  ok((await pool.query(`SELECT 1 FROM project_folders WHERE project_id = $1`, [untouched])).rowCount === 0, 'and their try makes no folder for it');
  const theirs = await project(friend, 'Theirs');
  ok((await moveToProject(pool, me, 'file', f2, theirs)).notFound === true, 'a project you are not on takes nothing');
  ok((await moveToProject(pool, friend, 'file', f2, theirs)).ok !== true, 'and nobody moves a file that is not theirs');
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Co',$2) RETURNING id`, [me, `${tag}-co`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${me}`, relation: 'owner' }] });
  const wsProject = await project(me, 'Team one', ws);
  const refused = await moveToProject(pool, me, 'file', f2, wsProject);
  ok(refused.conflict === true && refused.code === 'folder_other_place', 'a personal file does not go into a workspace’s project');
  ok((await moveToProject(pool, me, 'file', f2, null)).ok && !(await listed(me, f2)).project_name, 'and it can leave its project');
  console.log(`\n${passed} checks passed`);
}
main().finally(() => { fs.rmSync(dir, { recursive: true, force: true }); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
