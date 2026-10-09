/**
 * AREA in the Library. Real Postgres, the real library router behind the real authMiddleware, real files.
 *
 * Owner's rule (2026-10-03, 2026-10-09): each area of the workspace has its own library; only Overview shows
 * everything; one home per item.
 *
 *   - a file stored while handling a request made in an area (X-Xeno-Area) lands in that area, without the
 *     code that stores it having to be told (an upload, a picture a chat made, a sandbox output)
 *   - a chat artifact lives where its conversation lives (and its project's, when it is in one)
 *   - `?area=dev` lists one area, `?area=none` the items in none, no filter everything; each row says its area
 *   - an item can be moved to another area or to none; that wins over its conversation's
 *   - only an editor may move it; a stranger learns nothing
 *   - a malformed area is refused by the list and the move, and ignored as a request label
 *
 * Run: DATABASE_URL=postgresql://… node tests/library-area.test.mjs
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
import { writeTuples } from '../utils/authzReBAC.js';
import { areaFromRequest } from '../utils/resourceArea.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadDir = path.resolve(process.cwd(), 'uploads', `library-area-test-${process.pid}`);

async function main() {
  await runAllMigrations(pool);
  mkdirSync(uploadDir, { recursive: true });
  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [name + Date.now(), `${name}${Date.now()}@xeno.test`])).rows[0].id;
  const owner = await user('area_owner'), stranger = await user('area_stranger'), reader = await user('area_reader');
  let n = 0;
  const store = async (userId, name, extra = {}) => { const body = `bytes of ${name} ${n += 1}`; const storagePath = path.join(uploadDir, `${n}-${name}`); writeFileSync(storagePath, body);
    return (await registerManagedLibraryFile(pool, { userId, filename: name, originalName: name, mimeType: 'text/plain', fileSize: Buffer.byteLength(body), storagePath, metadata: { source: 'upload' }, ...extra })).id; };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api', areaFromRequest);
  // a stand-in for any route that stores a file several calls away from the request (upload, chat image, sandbox)
  app.post('/api/test/store', async (req, res) => { const id = await store(owner, req.body.name); res.json({ id }); });
  app.use('/api/library', libraryRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const as = (userId) => ({ authorization: `Bearer ${jwt.sign({ userId, email: 'x@xeno.test', username: 'x' }, JWT_SECRET, { expiresIn: '1h' })}`, 'content-type': 'application/json' });
  const O = as(owner), S = as(stranger), R = as(reader);
  const call = async (method, url, headers, body) => { const res = await fetch(origin + url, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => ({})) }; };
  const list = async (headers, qs = '') => (await call('GET', `/api/library/assets?limit=200${qs}`, headers)).body;
  const names = (page) => (page.items || []).map((i) => `${i.name}@${i.area ?? '-'}`).sort().join(' | ');
  let passed = 0; const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

  try {
    // stored in an area: passed explicitly, or taken from the request it happened in
    const plain = await store(owner, 'plain.txt');
    const placed = await store(owner, 'placed.txt', { area: 'studio' });
    const viaDev = (await call('POST', '/api/test/store', { ...O, 'x-xeno-area': 'dev' }, { name: 'made-in-dev.txt' })).body.id;
    const viaBad = (await call('POST', '/api/test/store', { ...O, 'x-xeno-area': 'Not An Area' }, { name: 'bad-label.txt' })).body.id;
    const viaOverview = (await call('POST', '/api/test/store', { ...O, 'x-xeno-area': 'overview' }, { name: 'from-overview.txt' })).body.id;
    assert.ok(plain && placed && viaDev && viaBad && viaOverview);

    // a chat artifact lives where its conversation lives
    const conv = (await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title, interface_id, area) VALUES ($1,$1,$1,'dev chat','playground','dev') RETURNING id`, [owner])).rows[0].id;
    const art = (await pool.query(`INSERT INTO chat_artifacts (user_id, owner_user_id, created_by_user_id, title, kind, content, conversation_id) VALUES ($1,$1,$1,'Dev page','html','<p>x</p>',$2) RETURNING id`, [owner, conv])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `artifact:${art}`, relation: 'owner', subject: `user:${owner}` }] });

    const all = await list(O);
    assert.equal(names(all), 'Dev page@dev | bad-label.txt@- | from-overview.txt@- | made-in-dev.txt@dev | placed.txt@studio | plain.txt@-');
    ok('everything is listed on Overview, each item saying its area');
    ok('a file stored while handling a request made in Dev lands in Dev, though the code that stored it was not told');
    ok('a malformed request label, or "overview", puts the file in no area rather than failing the upload');
    ok('a chat artifact lives where its conversation lives');
    assert.equal(names(await list(O, '&area=dev')), 'Dev page@dev | made-in-dev.txt@dev'); ok('one area lists only its own');
    assert.equal(names(await list(O, '&area=studio')), 'placed.txt@studio'); ok('another area lists its own');
    assert.equal(names(await list(O, '&area=none')), 'bad-label.txt@- | from-overview.txt@- | plain.txt@-'); ok('`none` lists the items in no area');
    assert.equal(names(await list(O, '&area=office')), ''); ok('an empty area is empty, not everything');
    assert.equal((await call('GET', '/api/library/assets?area=Overview', O)).status, 400); ok('a list cannot ask for a malformed area');

    // moving
    let r = await call('PUT', `/api/library/assets/file/${plain}/area`, O, { area: 'office' });
    assert.equal(r.status, 200); assert.equal(r.body.area, 'office');
    assert.equal(names(await list(O, '&area=office')), 'plain.txt@office'); ok('a file can be moved to an area');
    r = await call('PUT', `/api/library/assets/artifact/${art}/area`, O, { area: 'social' });
    assert.equal(r.status, 200);
    assert.equal(names(await list(O, '&area=dev')), 'made-in-dev.txt@dev'); assert.ok(names(await list(O, '&area=social')).includes('Dev page@social')); ok('a chat artifact moved explicitly leaves its conversation’s area');
    r = await call('PUT', `/api/library/assets/file/${placed}/area`, O, { area: null });
    assert.equal(r.status, 200); assert.ok(names(await list(O, '&area=none')).includes('placed.txt@-')); ok('or to no area');
    assert.equal((await call('PUT', `/api/library/assets/file/${plain}/area`, O, { area: 'Bad!' })).body.code, 'invalid_area');
    assert.equal((await call('PUT', `/api/library/assets/file/${plain}/area`, O, {})).body.code, 'invalid_area'); ok('a move must name an area, or null, in the right shape');

    // someone the file is shared with to read only
    await writeTuples(pool, { writes: [{ object: `library_asset:${plain}`, relation: 'viewer', subject: `user:${reader}` }] });
    assert.ok(names(await list(R)).includes('plain.txt'));
    r = await call('PUT', `/api/library/assets/file/${plain}/area`, R, { area: 'dev' });
    assert.equal(r.status, 403); assert.equal(names(await list(O, '&area=office')), 'plain.txt@office'); ok('someone who can only read a file cannot move it');

    // a stranger
    assert.equal(names(await list(S)), ''); assert.equal(names(await list(S, '&area=dev')), '');
    r = await call('PUT', `/api/library/assets/file/${plain}/area`, S, { area: 'dev' });
    assert.equal(r.status, 404); assert.equal(names(await list(O, '&area=office')), 'plain.txt@office'); ok('a stranger sees none of it and cannot move it, and is not told it exists');

    let refused = false; try { await pool.query("INSERT INTO library_item_areas (source, source_id, area) VALUES ('file', $1, 'Bad Area')", [viaBad]); } catch { refused = true; }
    assert.ok(refused); ok('the database itself refuses a malformed area');
    console.log(`library-area: ${passed} checks passed`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    rmSync(uploadDir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error('library-area: FAILED\n', error); process.exitCode = 1; });
