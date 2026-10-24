/**
 * Every project has its own Storage folder (services/chatProjectFolders.js). Real Postgres, the real services and the
 * real project-folder router; access is checked through Storage's own folder check, never by reading our own tables.
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/chat-project-folders.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { createAuthorizedProject } from '../services/chatProjectAuthority.js';
import { ensureChatProjectFolder, syncProjectFolderAccess, renameChatProjectFolder, releaseChatProjectFolder, projectFolderUsage } from '../services/chatProjectFolders.js';
import { folderAccess } from '../services/storageFolders.js';
import { sharedFolderAccess } from '../services/storageShares.js';
import projectFolderRoutes from '../routes/projectFolderRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.resolve(process.cwd(), 'uploads', `chat-project-folders-test-${process.pid}`);

async function main() {
  await runAllMigrations(pool);
  mkdirSync(uploadsDir, { recursive: true });
  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`${name}_${process.pid}`, `${name}_${process.pid}@xeno.test`])).rows[0].id;
  const owner = await user('cpf_owner'), mate = await user('cpf_mate'), stranger = await user('cpf_stranger'), member = await user('cpf_member');
  const company = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Bunker', $2) RETURNING id`, [owner, `bunker-cpf-${process.pid}`])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${company}`, relation: 'owner', subject: `user:${owner}` },
    { object: `workspace:${company}`, relation: 'viewer', subject: `user:${member}` },
  ] });
  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/storage/projects', projectFolderRoutes({ uploadsDir }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/storage/projects`;
  const bearer = (userId) => `Bearer ${jwt.sign({ userId, email: 'x@xeno.test', username: 'x' }, JWT_SECRET, { expiresIn: '1h' })}`;
  const principal = (id) => ({ type: 'user', id });
  const binding = async (projectId) => (await pool.query(
    `SELECT sf.* , parent.name AS parent_name FROM project_folders pf JOIN storage_folders sf ON sf.id = pf.folder_id
       LEFT JOIN storage_folders parent ON parent.id = sf.parent_id WHERE pf.app = 'projects' AND pf.project_id = $1`, [projectId])).rows[0];
  try {
    // 1. Making a personal project makes its folder: the owner's own, under "Projects", named after the project.
    const mine = await createAuthorizedProject(pool, { principal: principal(owner), name: 'BUNKERVERSE' });
    const f1 = await binding(mine.id);
    assert.ok(f1, 'a new project has a folder the moment it is made');
    assert.equal(f1.name, 'BUNKERVERSE'); assert.equal(f1.parent_name, 'Projects'); assert.equal(f1.workspace_id, null);
    assert.equal(String(f1.owner_user_id), String(owner), 'the folder is in the owner’s own storage');
    assert.equal((await folderAccess(pool, owner, f1.id, 'edit'))?.id, f1.id, 'the owner can change it');
    assert.equal(await folderAccess(pool, stranger, f1.id, 'view'), null, 'a stranger cannot see it');

    // 2. A workspace project gets a team folder: counted in the workspace, open to its members through the workspace.
    const team = await createAuthorizedProject(pool, { principal: principal(owner), workspaceId: company, name: 'Season 2' });
    const f2 = await binding(team.id);
    assert.ok(f2, 'a workspace project has a folder too');
    assert.equal(String(f2.workspace_id), String(company), 'in the workspace’s storage, not the creator’s');
    assert.equal((await folderAccess(pool, member, f2.id, 'view'))?.id, f2.id, 'a workspace member can open it');
    assert.equal(await folderAccess(pool, stranger, f2.id, 'view'), null);

    // 3. Two projects with one name get two folders, never one shared.
    const twin = await createAuthorizedProject(pool, { principal: principal(owner), name: 'bunkerverse' });
    assert.notEqual((await binding(twin.id)).id, f1.id, 'a same-named project gets its own folder');

    // 4. Someone put on a personal project may open its folder; taken off, they may not.
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), null);
    await writeTuples(pool, { writes: [{ object: `project:${mine.id}`, relation: 'editor', subject: `user:${mate}` }] });
    await syncProjectFolderAccess(pool, mine.id);
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), 'edit', 'a project editor may change its files');
    await writeTuples(pool, { deletes: [{ object: `project:${mine.id}`, relation: 'editor', subject: `user:${mate}` }], writes: [{ object: `project:${mine.id}`, relation: 'viewer', subject: `user:${mate}` }] });
    await syncProjectFolderAccess(pool, mine.id);
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), 'view', 'a project viewer may only read them');
    await writeTuples(pool, { deletes: [{ object: `project:${mine.id}`, relation: 'viewer', subject: `user:${mate}` }] });
    await syncProjectFolderAccess(pool, mine.id);
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), null, 'removed from the project, the folder is gone for them');

    // 5. Renaming the project renames its folder; the folder is the same one (found by id).
    await pool.query(`UPDATE chat_projects SET name = 'BUNKERVERSE Season 1' WHERE id = $1`, [mine.id]);
    await renameChatProjectFolder(pool, mine.id);
    const renamed = await binding(mine.id);
    assert.equal(renamed.id, f1.id); assert.equal(renamed.name, 'BUNKERVERSE Season 1');

    // 6. Nobody can bind someone else's project to a folder of their own through the public route.
    const claim = await fetch(`${base}/projects/${mine.id}`, { method: 'PUT', headers: { authorization: bearer(stranger), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mine now' }) });
    assert.equal(claim.status, 403, 'the projects app key is reserved');
    assert.equal((await binding(mine.id)).id, f1.id, 'and the binding is untouched');

    // 7. A project that existed before this (no folder yet) gets one on first open, once.
    const old = (await pool.query(`INSERT INTO chat_projects (user_id, owner_user_id, created_by_user_id, name) VALUES ($1, $1, $1, 'Old project') RETURNING id`, [owner])).rows[0].id;
    assert.equal(await binding(old), undefined);
    const firstOpen = await ensureChatProjectFolder(pool, old);
    const again = await ensureChatProjectFolder(pool, old);
    assert.ok(firstOpen.created && firstOpen.folder); assert.equal(again.created, false); assert.equal(again.folder.id, firstOpen.folder.id);
    const [a, b] = await Promise.all([ensureChatProjectFolder(pool, twin.id), ensureChatProjectFolder(pool, twin.id)]);
    assert.equal(a.folder.id, b.folder.id, 'two opens at once meet on one folder');

    // 8. Usage reads the rows the allowance reads: an empty project folder takes nothing.
    assert.deepEqual(await projectFolderUsage(pool, f1.id), { bytes: 0, files: 0 });

    // 9. Deleting a project for good keeps its folder (nothing here deletes files) and ends what the project granted.
    await writeTuples(pool, { writes: [{ object: `project:${mine.id}`, relation: 'viewer', subject: `user:${mate}` }] });
    await syncProjectFolderAccess(pool, mine.id);
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), 'view');
    await releaseChatProjectFolder(pool, mine.id);
    assert.equal(await binding(mine.id), undefined, 'the binding goes');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM storage_folders WHERE id = $1', [f1.id])).rows[0].n, 1, 'the folder stays');
    assert.equal(await sharedFolderAccess(pool, mate, f1.id), null, 'and the project no longer opens it for anyone');

    console.log('chat-project-folders: all checks passed');
  } finally {
    server.close(); rmSync(uploadsDir, { recursive: true, force: true }); await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
