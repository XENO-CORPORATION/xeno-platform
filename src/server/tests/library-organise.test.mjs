/**
 * Library: place, paging, rename, star, trash, restore, delete forever. Real Postgres, the real
 * router behind the real authMiddleware, real files on disk.
 *
 * Three accounts: an owner, a colleague who is an editor in the owner's company workspace, and a
 * stranger. The stranger must never learn that an item exists.
 *
 * Run: DATABASE_URL=postgresql://… node tests/library-organise.test.mjs
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
import { cleanLibraryName, sweepLibraryTrash, TRASH_DAYS } from '../services/libraryOrganise.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Stored bytes must sit under a managed upload root, or the service refuses to touch them.
const uploadDir = path.resolve(process.cwd(), 'uploads', `library-organise-test-${process.pid}`);

async function main() {
  await runAllMigrations(pool);
  mkdirSync(uploadDir, { recursive: true });

  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [name, `${name}@xeno.test`],
  )).rows[0].id;
  const owner = await user('lib_owner'), mate = await user('lib_mate'), stranger = await user('lib_stranger');
  const company = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme Studio', 'acme-lib') RETURNING id`, [owner])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${company}`, relation: 'owner', subject: `user:${owner}` },
    { object: `workspace:${company}`, relation: 'editor', subject: `user:${mate}` },
  ] });

  let n = 0;
  const upload = async (userId, name, workspaceId = null, body = `bytes of ${name} ${n += 1}`) => {
    const storagePath = path.join(uploadDir, `${n}-${name}`);
    writeFileSync(storagePath, body);
    const file = await registerManagedLibraryFile(pool, { userId, workspaceId, filename: name, originalName: name, mimeType: 'text/plain', fileSize: Buffer.byteLength(body), storagePath, metadata: { source: 'upload' } });
    return { id: file.id, storagePath };
  };
  const mine = await upload(owner, 'notes.txt');
  const mine2 = await upload(owner, 'plan.txt');
  const shared = await upload(owner, 'brand.txt', company);
  const theirs = await upload(stranger, 'secret.txt');
  const artifact = (await pool.query(`INSERT INTO chat_artifacts (user_id, owner_user_id, created_by_user_id, title, kind, content) VALUES ($1, $1, $1, 'Launch page', 'html', '<p>hi</p>') RETURNING id`, [owner])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `artifact:${artifact}`, relation: 'owner', subject: `user:${owner}` }] });
  const picture = (await pool.query(`INSERT INTO image_assets (user_id, name, type, file_url) VALUES ($1, 'Sunset', 'generated', '/img/sunset.png') RETURNING id`, [owner])).rows[0].id;
  const generation = (await pool.query(`INSERT INTO image_generations (user_id, prompt, image_urls, model) VALUES ($1, 'a red fox in snow', '["/img/fox.png"]'::jsonb, 'test') RETURNING id`, [owner])).rows[0].id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/library', libraryRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/library`;
  const as = (userId, name) => ({ authorization: `Bearer ${jwt.sign({ userId, email: `${name}@xeno.test`, username: name }, JWT_SECRET, { expiresIn: '1h' })}`, 'content-type': 'application/json' });
  const O = as(owner, 'lib_owner'), M = as(mate, 'lib_mate'), S = as(stranger, 'lib_stranger');
  const call = async (method, url, headers, body) => { const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const list = async (headers, qs = '') => (await call('GET', `/assets?limit=200${qs}`, headers)).body;
  const names = (page) => page.items.map((i) => i.name).sort();
  const find = (page, source, id) => page.items.find((i) => i.source === source && i.source_id === id);

  try {
    // ── place: every item says where it lives, and the list can be narrowed to one place ──
    const all = await list(O);
    assert.deepEqual(names(all), ['Launch page', 'Sunset', 'a red fox in snow', 'brand.txt', 'notes.txt', 'plan.txt']);
    assert.equal(all.total, 6); assert.equal(all.has_more, false); assert.equal(all.view, 'active');
    assert.equal(find(all, 'file', mine.id).place_kind, 'personal');
    assert.equal(find(all, 'file', mine.id).workspace_name, null);
    assert.equal(find(all, 'file', shared.id).place_kind, 'workspace');
    assert.equal(find(all, 'file', shared.id).workspace_id, company);
    assert.equal(find(all, 'file', shared.id).workspace_name, 'Acme Studio');
    assert.deepEqual(names(await list(O, `&place=${company}`)), ['brand.txt'], 'one workspace: only its own files');
    assert.deepEqual(names(await list(O, '&place=personal')), ['Launch page', 'Sunset', 'a red fox in snow', 'notes.txt', 'plan.txt']);
    assert.deepEqual(names(await list(M)), ['brand.txt'], 'the colleague sees the company file and none of the owner’s own');
    assert.deepEqual(names(await list(S)), ['secret.txt']);
    assert.deepEqual(names(await list(S, `&place=${company}`)), [], 'naming a workspace you are not in shows nothing');
    assert.equal((await list(O, '&place=not-a-place')).place, '', 'an unknown place is ignored, never passed to SQL');

    // ── paging: total and has_more, and a page past the end still knows the total ──
    const p1 = (await call('GET', '/assets?limit=4&offset=0&sort=name', O)).body;
    assert.equal(p1.items.length, 4); assert.equal(p1.total, 6); assert.equal(p1.has_more, true);
    const p2 = (await call('GET', '/assets?limit=4&offset=4&sort=name', O)).body;
    assert.equal(p2.items.length, 2); assert.equal(p2.has_more, false);
    assert.deepEqual([...p1.items, ...p2.items].map((i) => i.name).sort(), names(all), 'two pages hold every item exactly once');
    const past = (await call('GET', '/assets?limit=4&offset=40', O)).body;
    assert.equal(past.items.length, 0); assert.equal(past.total, 6);

    // ── star: personal, for every kind of item, never for what you cannot see ──
    for (const [source, id] of [['file', mine.id], ['artifact', artifact], ['image_asset', picture], ['generation', generation], ['file', shared.id]]) {
      assert.equal((await call('PUT', `/assets/${source}/${id}/star`, O)).status, 200, `star ${source}`);
    }
    assert.equal((await call('PUT', `/assets/file/${mine.id}/star`, O)).status, 200, 'starring twice is not an error');
    assert.deepEqual(names(await list(O, '&view=starred')), ['Launch page', 'Sunset', 'a red fox in snow', 'brand.txt', 'notes.txt']);
    assert.equal(find(await list(O), 'file', mine.id).starred, true);
    assert.equal(find(await list(O), 'file', mine2.id).starred, false);
    assert.equal(find(await list(M), 'file', shared.id).starred, false, 'the owner’s star is not the colleague’s');
    assert.equal((await call('PUT', `/assets/file/${shared.id}/star`, M)).status, 200);
    assert.equal((await call('DELETE', `/assets/file/${shared.id}/star`, O)).status, 200);
    assert.equal(find(await list(M), 'file', shared.id).starred, true, 'removing one person’s star leaves the other’s');
    assert.equal((await call('PUT', `/assets/file/${mine.id}/star`, S)).status, 404, 'a stranger cannot star, and learns nothing');
    assert.equal((await call('PUT', `/assets/artifact/${artifact}/star`, S)).status, 404);
    assert.equal((await call('PUT', `/assets/image_asset/${picture}/star`, S)).status, 404);
    assert.equal((await call('PUT', '/assets/file/not-an-id/star', O)).status, 400);
    assert.equal((await call('PUT', `/assets/spreadsheet/${mine.id}/star`, O)).status, 400);

    // ── rename ──
    const renamed = await call('PATCH', `/assets/file/${mine.id}`, O, { name: '  Meeting   notes.txt ' });
    assert.equal(renamed.status, 200); assert.equal(renamed.body.name, 'Meeting notes.txt', 'whitespace is tidied');
    assert.equal((await call('PATCH', `/assets/artifact/${artifact}`, O, { name: 'Launch page v2' })).status, 200);
    assert.equal((await call('PATCH', `/assets/image_asset/${picture}`, O, { name: 'Sunset over water' })).status, 200);
    assert.deepEqual(names(await list(O, '&place=personal')), ['Launch page v2', 'Meeting notes.txt', 'Sunset over water', 'a red fox in snow', 'plan.txt']);
    const gen = await call('PATCH', `/assets/generation/${generation}`, O, { name: 'Fox' });
    assert.equal(gen.status, 400); assert.equal(gen.body.code, 'rename_unsupported', 'a generation’s name is its prompt');
    for (const bad of ['', '   ', 'a/b.txt', 'a\\b.txt', '..', 'x'.repeat(256), 'line\nbreak', 42, null]) {
      const refused = await call('PATCH', `/assets/file/${mine.id}`, O, { name: bad });
      assert.equal(refused.status, 400, `name ${JSON.stringify(bad)} is refused`); assert.equal(refused.body.code, 'invalid_name');
    }
    assert.equal(cleanLibraryName('Résumé.pdf'), 'Résumé.pdf'.normalize('NFC'));
    assert.equal((await call('PATCH', `/assets/file/${shared.id}`, M, { name: 'Brand guide.txt' })).status, 200, 'an editor in the workspace may rename its file');
    assert.equal((await call('PATCH', `/assets/file/${mine.id}`, S, { name: 'Stolen.txt' })).status, 404, 'a stranger gets 404, never 403');
    assert.equal((await call('PATCH', `/assets/file/${mine.id}`, M, { name: 'Stolen.txt' })).status, 404, 'a colleague cannot see the owner’s own file');
    assert.equal(find(await list(O), 'file', mine.id).name, 'Meeting notes.txt');

    // ── trash: gone from the Library at once, kept for TRASH_DAYS, restorable ──
    assert.equal((await call('POST', `/assets/file/${shared.id}/trash`, M)).status, 403, 'an editor can see it and may not trash it');
    assert.equal((await call('POST', `/assets/file/${mine.id}/trash`, S)).status, 404);
    const trashed = await call('POST', `/assets/file/${mine.id}/trash`, O);
    assert.equal(trashed.status, 200);
    const days = (new Date(trashed.body.purge_after) - new Date(trashed.body.trashed_at)) / 86400000;
    assert.ok(Math.abs(days - TRASH_DAYS) < 0.1, `kept for ${TRASH_DAYS} days, got ${days}`);
    assert.equal((await call('POST', `/assets/file/${mine.id}/trash`, O)).body.code, 'already_in_trash');
    assert.equal(find(await list(O), 'file', mine.id), undefined, 'not in the Library');
    assert.equal(find(await list(O, '&view=starred'), 'file', mine.id), undefined, 'not among the starred either');
    const bin = await list(O, '&view=trash');
    assert.deepEqual(names(bin), ['Meeting notes.txt']); assert.ok(bin.items[0].trashed_at && bin.items[0].purge_after);
    assert.equal(bin.items[0].starred, true, 'its star is kept for when it comes back');
    assert.equal((await call('GET', `/assets/${mine.id}/content`, O)).status, 404, 'a trashed file is not served');
    assert.equal((await call('POST', `/assets/${mine.id}/link`, O, {})).status, 404, 'and cannot be linked');
    assert.equal((await call('PATCH', `/assets/file/${mine.id}`, O, { name: 'x.txt' })).body.code, 'item_in_trash');
    assert.deepEqual(names(await list(S, '&view=trash')), [], 'nobody else sees it in their trash');
    assert.ok(existsSync(mine.storagePath), 'the bytes are kept while it is in the trash');

    assert.equal((await call('POST', `/assets/file/${mine.id}/restore`, S)).status, 404);
    assert.equal((await call('POST', `/assets/file/${mine.id}/restore`, O)).status, 200);
    assert.equal((await call('POST', `/assets/file/${mine.id}/restore`, O)).body.code, 'not_in_trash');
    assert.equal(find(await list(O), 'file', mine.id).name, 'Meeting notes.txt');
    assert.equal((await call('GET', `/assets/${mine.id}/status`, O)).status, 200, 'served again after restore');

    // the other kinds go to the trash and come back too
    for (const [source, id, name] of [['artifact', artifact, 'Launch page v2'], ['image_asset', picture, 'Sunset over water'], ['generation', generation, 'a red fox in snow']]) {
      assert.equal((await call('POST', `/assets/${source}/${id}/trash`, O)).status, 200, `trash ${source}`);
      assert.equal(find(await list(O), source, id), undefined);
      assert.equal(find(await list(O, '&view=trash'), source, id).name, name);
      assert.equal((await call('POST', `/assets/${source}/${id}/restore`, O)).status, 200, `restore ${source}`);
      assert.equal(find(await list(O), source, id).name, name);
    }

    // a file a project uses cannot be trashed out from under it
    const project = (await pool.query(`INSERT INTO chat_projects (owner_user_id, created_by_user_id, name) VALUES ($1, $1, 'Launch') RETURNING id`, [owner])).rows[0].id;
    await pool.query(`INSERT INTO chat_project_assets (project_id, asset_id, added_by_user_id) VALUES ($1, $2, $3)`, [project, mine2.id, owner]);
    const used = await call('POST', `/assets/file/${mine2.id}/trash`, O);
    assert.equal(used.status, 409); assert.equal(used.body.code, 'asset_has_project_references'); assert.equal(used.body.reference_count, 1);
    await pool.query('DELETE FROM chat_project_assets WHERE asset_id = $1', [mine2.id]);

    // ── delete forever: only from the trash, only by the owner, and the bytes go ──
    assert.equal((await call('DELETE', `/trash/file/${mine2.id}`, O)).body.code, 'not_in_trash', 'no shortcut past the trash');
    assert.ok(existsSync(mine2.storagePath));
    assert.equal((await call('POST', `/assets/file/${mine2.id}/trash`, O)).status, 200);
    assert.equal((await call('DELETE', `/trash/file/${mine2.id}`, S)).status, 404);
    assert.equal((await call('DELETE', `/trash/file/${mine2.id}`, O)).status, 200);
    assert.equal(existsSync(mine2.storagePath), false, 'the stored bytes are removed');
    assert.deepEqual(names(await list(O, '&view=trash')), []);
    assert.equal((await call('POST', `/assets/file/${mine2.id}/restore`, O)).status, 404, 'a purged file cannot be brought back');
    assert.equal((await pool.query('SELECT count(*)::int AS c FROM library_item_stars WHERE source_id = $1', [mine2.id])).rows[0].c, 0);

    // two records of the same stored object: purging one must not remove the other's bytes
    const twin = await upload(owner, 'twin-a.txt');
    const twinB = (await registerManagedLibraryFile(pool, { userId: owner, filename: 'twin-b.txt', originalName: 'twin-b.txt', mimeType: 'text/plain', fileSize: Buffer.byteLength(`bytes of twin-a.txt ${n}`), storagePath: twin.storagePath, metadata: { source: 'upload' } })).id;
    await call('POST', `/assets/file/${twin.id}/trash`, O);
    assert.equal((await call('DELETE', `/trash/file/${twin.id}`, O)).status, 200);
    assert.ok(existsSync(twin.storagePath), 'bytes another record still uses are kept');
    assert.equal(find(await list(O), 'file', twinB).name, 'twin-b.txt');

    // ── empty trash: everything the caller owns, nothing they merely see ──
    await call('POST', `/assets/image_asset/${picture}/trash`, O);
    await call('POST', `/assets/artifact/${artifact}/trash`, O);
    await call('POST', `/assets/file/${shared.id}/trash`, O);
    assert.deepEqual(names(await list(M, '&view=trash')), ['Brand guide.txt'], 'the colleague sees the company file in the trash');
    assert.equal((await call('DELETE', '/trash', M)).body.purged, 0, 'and emptying their trash does not delete it');
    assert.deepEqual(names(await list(O, '&view=trash')), ['Brand guide.txt', 'Launch page v2', 'Sunset over water']);
    assert.equal((await call('DELETE', '/trash', O)).body.purged, 3);
    assert.deepEqual(names(await list(O, '&view=trash')), []);
    assert.equal((await pool.query('SELECT count(*)::int AS c FROM chat_artifacts WHERE id = $1', [artifact])).rows[0].c, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS c FROM image_assets WHERE id = $1', [picture])).rows[0].c, 0);
    assert.equal(existsSync(shared.storagePath), false);

    // ── the sweep: only what is past its time ──
    await call('POST', `/assets/file/${mine.id}/trash`, O);
    await call('POST', `/assets/generation/${generation}/trash`, O);
    assert.deepEqual(await sweepLibraryTrash(pool), { purged: 0 }, 'nothing is due yet');
    await pool.query(`UPDATE library_trash SET trashed_at = NOW() - interval '31 days', purge_after = NOW() - interval '1 day' WHERE source = 'file' AND source_id = $1`, [mine.id]);
    assert.deepEqual(await sweepLibraryTrash(pool), { purged: 1 });
    assert.equal(existsSync(mine.storagePath), false);
    assert.deepEqual(names(await list(O, '&view=trash')), ['a red fox in snow'], 'the item not yet due is still there');
    assert.equal((await call('POST', `/assets/generation/${generation}/restore`, O)).status, 200);

    // ── the old permanent delete still works, and a stranger's file was never touched ──
    assert.equal((await call('DELETE', `/assets/file/${twinB}`, O)).status, 200);
    assert.deepEqual(names(await list(O)), ['a red fox in snow']);
    assert.deepEqual(names(await list(S)), ['secret.txt']);
    assert.ok(existsSync(theirs.storagePath));

    console.log('library-organise: all checks passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Only files this test wrote: a plain directory it created, holding plain files.
    rmSync(uploadDir, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
