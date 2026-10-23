/**
 * Project folders: an app's project files live in XENO Storage. Real Postgres, the real router behind the real
 * authMiddleware, real bytes under the managed upload root, real OIDC tokens minted through the provider.
 *
 * Accounts: an owner, a colleague who edits the owner's company workspace, and a stranger who must never learn a
 * project exists. Run: DATABASE_URL=postgresql://… node tests/project-folders.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import projectFolderRoutes from '../routes/projectFolderRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { shareWithPerson } from '../services/storageShares.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { createAuthorizationCode, exchangeAuthorizationCode } from '../utils/oidcProvider.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.resolve(process.cwd(), 'uploads', `project-folders-test-${process.pid}`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  await runAllMigrations(pool);
  mkdirSync(uploadsDir, { recursive: true });
  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`${name}_${process.pid}`, `${name}_${process.pid}@xeno.test`])).rows[0].id;
  const owner = await user('pf_owner'), mate = await user('pf_mate'), stranger = await user('pf_stranger'), guest = await user('pf_guest'), looker = await user('pf_looker'), wide = await user('pf_wide');
  const company = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', $2) RETURNING id`, [owner, `acme-pf-${process.pid}`])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${company}`, relation: 'owner', subject: `user:${owner}` },
    { object: `workspace:${company}`, relation: 'editor', subject: `user:${mate}` },
  ] });

  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/storage/projects', projectFolderRoutes({ uploadsDir }));
  app.use(express.json());   // as in index.js: the global parsers come AFTER the project routes
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/storage/projects`;
  const bearer = (userId) => `Bearer ${jwt.sign({ userId, email: 'x@xeno.test', username: 'x' }, JWT_SECRET, { expiresIn: '1h' })}`;
  const O = bearer(owner), M = bearer(mate), S = bearer(stranger), G = bearer(guest), L = bearer(looker), WI = bearer(wide);
  const call = async (method, url, auth, { json, bytes, type, headers = {} } = {}) => {
    const res = await fetch(`${base}${url}`, { method, headers: { authorization: auth, ...(json ? { 'content-type': 'application/json' } : {}), ...(bytes ? { 'content-type': type || 'application/octet-stream' } : {}), ...headers }, body: json ? JSON.stringify(json) : bytes });
    const text = Buffer.from(await res.arrayBuffer());
    let body; try { body = JSON.parse(text.toString('utf8')); } catch { body = text; }
    return { status: res.status, body, raw: text, headers: res.headers };
  };
  const P = crypto.randomUUID(), T = crypto.randomUUID();   // a personal project and a company project
  const W = `/xeno-workshop/${P}`, WT = `/xeno-workshop/${T}`;

  try {
    // ── the project's folder: made on first use, idempotent, in the right account ──
    const made = await call('PUT', W, O, { json: { name: 'Landing page' } });
    assert.equal(made.status, 201, JSON.stringify(made.body)); assert.equal(made.body.folder.name, 'Landing page'); assert.equal(made.body.folder.workspaceId, null);
    const again = await call('PUT', W, O, { json: { name: 'Something else' } });
    assert.equal(again.status, 200); assert.equal(again.body.folder.id, made.body.folder.id, 'a project has exactly one folder');
    const parent = (await pool.query('SELECT p.name FROM storage_folders f JOIN storage_folders p ON p.id = f.parent_id WHERE f.id = $1', [made.body.folder.id])).rows[0];
    assert.equal(parent.name, 'XENO Workshop', 'projects sit under the app’s own folder');
    const twin = await call('PUT', `/xeno-workshop/${crypto.randomUUID()}`, O, { json: { name: 'Landing page' } });
    assert.equal(twin.status, 201); assert.notEqual(twin.body.folder.id, made.body.folder.id, 'two projects with one name get two folders');
    assert.equal((await call('PUT', W, S, { json: { name: 'x' } })).status, 404, 'a stranger cannot see the project');
    assert.equal((await call('PUT', '/xeno-workshop/not-a-uuid', O, { json: {} })).status, 400);
    const team = await call('PUT', WT, O, { json: { name: 'Brand site', workspace: company } });
    assert.equal(team.status, 201); assert.equal(team.body.folder.workspaceId, company, 'a company project is a team folder');
    assert.equal((await call('PUT', `/xeno-workshop/${crypto.randomUUID()}`, S, { json: { name: 'x', workspace: company } })).status, 403, 'only a member makes folders in a workspace');

    // ── write: a new path is a new Storage file in its directory's sub-folder ──
    const v1 = Buffer.from('{"name":"landing"}\n');
    const w1 = await call('PUT', `${W}/files/content?path=${encodeURIComponent('src/data/site.json')}`, O, { bytes: v1, type: 'application/json' });
    assert.equal(w1.status, 201, JSON.stringify(w1.body)); assert.equal(w1.body.sha256, sha(v1)); assert.equal(w1.body.path, 'src/data/site.json');
    const placed = (await pool.query(`SELECT f.name, p.name AS up FROM storage_item_folders i JOIN storage_folders f ON f.id = i.folder_id JOIN storage_folders p ON p.id = f.parent_id WHERE i.source = 'file' AND i.source_id = $1`, [w1.body.versionId])).rows[0];
    assert.deepEqual(placed, { name: 'data', up: 'src' }, 'the file sits in Storage where its directory is');
    const read = await call('GET', `${W}/files/content?path=src/data/site.json`, O);
    assert.equal(read.status, 200); assert.equal(read.raw.toString('utf8'), v1.toString('utf8'), 'a .json arrives as its own bytes, not a parsed object');
    assert.equal(read.headers.get('x-xeno-file-id'), w1.body.fileId);

    // ── the same bytes change nothing; new bytes are a new VERSION of the same file ──
    const same = await call('PUT', `${W}/files/content?path=src/data/site.json`, O, { bytes: v1 });
    assert.equal(same.status, 200); assert.equal(same.body.unchanged, true);
    const v2 = Buffer.from('{"name":"landing","v":2}\n');
    const w2 = await call('PUT', `${W}/files/content?path=src/data/site.json`, O, { bytes: v2, headers: { 'if-match': `"${sha(v1)}"` } });
    assert.equal(w2.status, 200, JSON.stringify(w2.body)); assert.equal(w2.body.fileId, w1.body.fileId, 'one path, one file'); assert.notEqual(w2.body.versionId, w1.body.versionId);
    const versions = (await pool.query('SELECT count(*)::int AS n FROM user_files WHERE file_id = $1', [w1.body.fileId])).rows[0].n;
    assert.equal(versions, 2, 'the first version is kept');
    const stale = await call('PUT', `${W}/files/content?path=src/data/site.json`, O, { bytes: Buffer.from('mine'), headers: { 'if-match': sha(v1) } });
    assert.equal(stale.status, 409, 'a write on top of a version the writer never saw is refused');
    assert.equal(stale.body.code, 'version_conflict');

    // ── list: every path with its current version ──
    await call('PUT', `${W}/files/content?path=README.md`, O, { bytes: Buffer.from('# Landing\n'), type: 'text/markdown' });
    const list = await call('GET', `${W}/files`, O);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.files.map((f) => [f.path, f.sha256]), [['README.md', sha(Buffer.from('# Landing\n'))], ['src/data/site.json', sha(v2)]]);

    // ── paths: nothing that escapes or confuses ──
    for (const bad of ['', '../x', 'a//b', 'a/./b', '/abs', 'a\\b', 'trailing/', ' pad']) {
      assert.equal((await call('PUT', `${W}/files/content?path=${encodeURIComponent(bad)}`, O, { bytes: Buffer.from('x') })).status, 400, `refuses path ${JSON.stringify(bad)}`);
    }

    // ── account-bound: a stranger reaches nothing; a colleague reaches the company project only ──
    assert.equal((await call('GET', `${W}/files`, S)).status, 404);
    assert.equal((await call('GET', `${W}/files/content?path=README.md`, S)).status, 404);
    assert.equal((await call('PUT', `${W}/files/content?path=evil.txt`, S, { bytes: Buffer.from('x') })).status, 404);
    assert.equal((await call('GET', `${W}/files`, M)).status, 404, 'the owner’s personal project is not the colleague’s');
    const tw = await call('PUT', `${WT}/files/content?path=index.html`, M, { bytes: Buffer.from('<h1>Acme</h1>'), type: 'text/html' });
    assert.equal(tw.status, 201, 'a workspace editor writes the company project');
    const owned = (await pool.query('SELECT workspace_id, owner_user_id FROM user_files WHERE id = $1', [tw.body.versionId])).rows[0];
    assert.equal(owned.workspace_id, company, 'the company owns the company project’s file'); assert.equal(owned.owner_user_id, null);

    // ── a collaborator on a PERSONAL project: an editor share lets them write the files, and everything they write
    //    stays the owner's — owned by, metered against and readable by the owner (review of #918, Storage session) ──
    assert.equal((await shareWithPerson(pool, owner, { folderId: made.body.folder.id }, `pf_guest_${process.pid}`, 'editor')).ok, true);
    assert.equal((await shareWithPerson(pool, owner, { folderId: made.body.folder.id }, `pf_looker_${process.pid}`, 'viewer')).ok, true);
    const gw = await call('PUT', `${W}/files/content?path=${encodeURIComponent('notes/guest.md')}`, G, { bytes: Buffer.from('from the guest'), type: 'text/markdown' });
    assert.equal(gw.status, 201, JSON.stringify(gw.body));
    const gRow = (await pool.query('SELECT owner_user_id, created_by_user_id, workspace_id FROM user_files WHERE id = $1', [gw.body.versionId])).rows[0];
    assert.equal(gRow.owner_user_id, owner, 'a collaborator’s new file is the owner’s');
    const oRead = await call('GET', `${W}/files/content?path=notes/guest.md`, O);
    assert.equal(oRead.status, 200); assert.equal(oRead.raw.toString(), 'from the guest', 'the owner reads what the collaborator wrote');
    assert.equal((await call('GET', `${W}/files/content?path=notes/guest.md`, L)).status, 200, 'a viewer the folder is shared with reads it too');
    assert.equal((await call('PUT', `${W}/files/content?path=notes/viewer.md`, L, { bytes: Buffer.from('x') })).status, 404, 'a viewer cannot write');
    const gv = await call('PUT', `${W}/files/content?path=README.md`, G, { bytes: Buffer.from('# Landing, edited by the guest') });
    assert.equal(gv.status, 200, JSON.stringify(gv.body));
    assert.equal((await pool.query('SELECT owner_user_id FROM user_files WHERE id = $1', [gv.body.versionId])).rows[0].owner_user_id, owner, 'a collaborator’s version is the owner’s');
    const gd = await call('DELETE', `${W}/files?path=notes/guest.md`, G);
    assert.equal(gd.status, 200, `a collaborator can remove a path: ${JSON.stringify(gd.body)}`);

    // ── shared one level up (the whole "XENO Workshop" folder as editor): what does a project under it allow? Pinned,
    //    whichever way Storage materialises inherited access (review of #921) ──
    const appFolder = (await pool.query('SELECT parent_id FROM storage_folders WHERE id = $1', [made.body.folder.id])).rows[0].parent_id;
    assert.equal((await shareWithPerson(pool, owner, { folderId: appFolder }, `pf_wide_${process.pid}`, 'editor')).ok, true);
    assert.equal((await call('GET', `${W}/files`, WI)).status, 200, 'sharing the app folder lets them see the projects in it');
    const ww = await call('PUT', `${W}/files/content?path=wide.txt`, WI, { bytes: Buffer.from('from one level up') });
    // measured 2026-10-24: Storage materialises a folder share onto the folders inside it, so an editor share on the
    // app folder is an editor share on every project in it — the same as sharing any folder in Storage
    assert.equal(ww.status, 201, 'an editor share one level up lets them write the project');
    assert.equal((await pool.query('SELECT owner_user_id FROM user_files WHERE id = $1', [ww.body.versionId])).rows[0].owner_user_id, owner, 'and what they write is the owner’s');
    assert.equal((await call('DELETE', `${W}/files?path=wide.txt`, WI)).status, 200);

    // ── an app's own token reaches only that app's projects ──
    await migrateAccountV2(pool);   // the OIDC provider's tables (a separate migration, as in auth-token-confusion.test)
    const REDIRECT = 'https://workshop.xenosystem.ai/api/auth/callback';
    for (const id of ['xeno-workshop', 'xeno-post']) {
      // the checked-in authority policy, exactly as migrate-oidc-clients seeds it
      await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, surface, allowed_scopes) VALUES ($1, $1, ARRAY[$2], 'xeno_api', $3) ON CONFLICT (client_id) DO UPDATE SET allowed_scopes = EXCLUDED.allowed_scopes`, [id, REDIRECT, scopesForClient(id)]);
    }
    const appToken = async (clientId, scope = 'openid profile storage:read storage:write') => {
      const v = crypto.randomBytes(32).toString('base64url'), c = crypto.createHash('sha256').update(v).digest('base64url');
      const code = await createAuthorizationCode(pool, { clientId, userId: owner, redirectUri: REDIRECT, scope, codeChallenge: c });
      return `Bearer ${(await exchangeAuthorizationCode(pool, { code, clientId, redirectUri: REDIRECT, codeVerifier: v })).access_token}`;
    };
    assert.equal((await call('GET', `${W}/files`, await appToken('xeno-workshop'))).status, 200, 'the Workshop reaches its own project');
    const other = await call('GET', `${W}/files`, await appToken('xeno-post'));
    assert.equal(other.status, 403); assert.equal(other.body.code, 'wrong_app', 'another app cannot reach the Workshop’s projects');
    // ── an app's token does only what the person consented to ──
    const none = await call('GET', `${W}/files`, await appToken('xeno-workshop', 'openid profile'));
    assert.equal(none.status, 403); assert.equal(none.body.code, 'scope_missing', 'reading needs storage:read');
    const readOnly = await appToken('xeno-workshop', 'openid profile storage:read');
    assert.equal((await call('GET', `${W}/files`, readOnly)).status, 200);
    const ro = await call('PUT', `${W}/files/content?path=ro.txt`, readOnly, { bytes: Buffer.from('x') });
    assert.equal(ro.status, 403); assert.equal(ro.body.code, 'scope_missing', 'writing needs storage:write');
    assert.equal((await call('DELETE', `${W}/files?path=src/data/site.json`, readOnly)).status, 403, 'removing needs storage:write');
    assert.equal((await call('PUT', `${W}/files/content?path=rw.txt`, await appToken('xeno-workshop'), { bytes: Buffer.from('x') })).status, 201);

    // ── remove: to the trash, restorable; the path is free again ──
    const rm = await call('DELETE', `${W}/files?path=README.md`, O);
    assert.equal(rm.status, 200, JSON.stringify(rm.body));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM library_trash WHERE source_id = (SELECT id FROM user_files WHERE file_id = $1 ORDER BY created_at DESC LIMIT 1)', [rm.body.fileId])).rows[0].n, 1, 'in the trash, not gone');
    assert.deepEqual((await call('GET', `${W}/files`, O)).body.files.map((f) => f.path), ['rw.txt', 'src/data/site.json']);
    assert.equal((await call('PUT', `${W}/files/content?path=README.md`, O, { bytes: Buffer.from('# Back\n') })).status, 201, 'the path can be written again');

    console.log('project-folders: all assertions passed');
  } finally {
    server.close();
    rmSync(uploadsDir, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; pool.end().catch(() => {}); });
