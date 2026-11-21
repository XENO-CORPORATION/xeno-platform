/**
 * XENO Storage: the Depot namespace (routes/storageDepotServiceRoutes.js, services/storageDepotObjects.js).
 * Real Postgres, the real router over real HTTP, the filesystem object backend in a temp folder.
 *
 * Run: DATABASE_URL=postgresql://… node tests/storage-depot-objects.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { _internal } from '../services/artifactStorage.js';
import { createStorageDepotServiceRouter, parseRange } from '../routes/storageDepotServiceRoutes.js';
import { depotObjectKey } from '../services/storageDepotObjects.js';
import { storageUsage, workspaceUsedBytes, workspaceDepotKind } from '../services/storageAllowance.js';
import { isAuthenticatedDepotStorageCall } from '../utils/globalLimiterSkip.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const TOKEN = 'depot-test-token-' + crypto.randomBytes(8).toString('hex');
const root = mkdtempSync(path.join(os.tmpdir(), 'depot-objects-test-'));
const store = _internal.fsBackend(root);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const name = () => crypto.randomBytes(32).toString('hex');   // stands in for Lore's BLAKE3 address

async function main() {
  await runAllMigrations(pool);
  const tag = crypto.randomBytes(4).toString('hex');
  const user = async (n) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`${n}_${tag}`, `${n}_${tag}@xeno.test`])).rows[0].id;
  const owner = await user('depot_owner');
  const team = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Depot Co', $2) RETURNING id`, [owner, `depot-co-${tag}`])).rows[0].id;
  const other = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Other Co', $2) RETURNING id`, [owner, `other-co-${tag}`])).rows[0].id;
  const personal = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'personal', 'Me', $2) RETURNING id`, [owner, `me-${tag}`])).rows[0].id;

  const app = express();
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/storage/service/depot/v1', createStorageDepotServiceRouter({ env: { DEPOT_STORAGE_SERVICE_TOKEN: TOKEN }, store }));
  app.use('/open', createStorageDepotServiceRouter({ env: {}, store }));   // token unset: must refuse everything
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = (ws, rest) => `${base}/api/storage/service/depot/v1/workspaces/${ws}${rest}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  const put = (ws, hash, bytes, headers = {}) => fetch(url(ws, `/objects/${hash}`), {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-content-sha256': sha(bytes), ...headers }, body: bytes });

  try {
    // ── auth fails closed ──
    assert.equal((await fetch(url(team, '/usage'))).status, 401, 'no token');
    assert.equal((await fetch(url(team, '/usage'), { headers: { authorization: 'Bearer wrong' } })).status, 401, 'wrong token');
    assert.equal((await fetch(`${base}/open/workspaces/${team}/usage`, { headers: auth })).status, 401, 'unset token refuses even a presented one');

    // ── put-if-absent ──
    const a = crypto.randomBytes(200 * 1024), ha = name();
    let r = await put(team, ha, a, { 'x-xeno-object-meta': '1:0:204800:204800' });
    assert.equal(r.status, 201, 'first put creates');
    assert.equal((await r.json()).created, true);
    assert.ok(existsSync(path.join(root, ...depotObjectKey(team, ha).split('/'))), 'object in the store under the workspace namespace');
    r = await put(team, ha, a);
    assert.equal(r.status, 200, 'same bytes again is idempotent');
    assert.equal((await r.json()).created, false);
    const b = crypto.randomBytes(1000);
    r = await put(team, ha, b);
    assert.equal(r.status, 409, 'different bytes under the same name are refused');
    assert.equal((await store.get(depotObjectKey(team, ha))).equals(a), true, 'first object stays');

    // ── wire check and limits ──
    r = await fetch(url(team, `/objects/${name()}`), { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-content-sha256': sha(b).replace(/./, '0') }, body: b });
    assert.equal(r.status, 400, 'body not matching X-Content-SHA256');
    r = await fetch(url(team, `/objects/${name()}`), { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: b });
    assert.equal(r.status, 400, 'X-Content-SHA256 required');
    r = await put(team, 'NOT-A-HASH', b);
    assert.equal(r.status, 400, 'hash shape');
    r = await put('not-a-uuid', name(), b);
    assert.equal(r.status, 400, 'workspace shape');
    const big = crypto.randomBytes(1024 * 1024 + 1);
    r = await put(team, name(), big);
    assert.equal(r.status, 413, 'over 1 MiB refused');
    r = await put(team, name(), b, { 'x-xeno-object-meta': 'x'.repeat(1025) });
    assert.equal(r.status, 400, 'meta over 1024 chars');
    r = await put('00000000-0000-4000-8000-000000000000', name(), b);
    assert.equal(r.status, 404, 'unknown workspace');

    // ── reads: head, whole, ranges ──
    r = await fetch(url(team, `/objects/${ha}`), { method: 'HEAD', headers: auth });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-length'), String(a.length));
    assert.equal(r.headers.get('x-xeno-object-meta'), '1:0:204800:204800', 'meta round-trips');
    assert.equal(r.headers.get('x-content-sha256'), sha(a));
    r = await fetch(url(team, `/objects/${ha}`), { headers: auth });
    assert.equal(r.status, 200);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(a), 'whole object');
    r = await fetch(url(team, `/objects/${ha}`), { headers: { ...auth, range: 'bytes=100-199' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 100-199/${a.length}`);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(a.subarray(100, 200)), 'ranged bytes');
    r = await fetch(url(team, `/objects/${ha}`), { headers: { ...auth, range: 'bytes=204000-' } });
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(a.subarray(204000)), 'open-ended range');
    r = await fetch(url(team, `/objects/${ha}`), { headers: { ...auth, range: 'bytes=-10' } });
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(a.subarray(a.length - 10)), 'suffix range');
    r = await fetch(url(team, `/objects/${ha}`), { headers: { ...auth, range: `bytes=${a.length}-` } });
    assert.equal(r.status, 416, 'range past the end');
    assert.throws(() => parseRange('bytes=0-1,5-9'), /one bytes/, 'multi-range refused');

    // ── tenancy: another workspace sees nothing ──
    r = await fetch(url(other, `/objects/${ha}`), { headers: auth });
    assert.equal(r.status, 404, 'same hash, other workspace: absent');
    r = await put(other, ha, b);
    assert.equal(r.status, 201, 'other workspace may hold different bytes under the same name');
    assert.ok((await store.get(depotObjectKey(team, ha))).equals(a), 'and the first workspace is untouched');

    // ── existence batch ──
    const missing = name();
    r = await fetch(url(team, '/objects/exists'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [ha, missing, ha] }) });
    const ex = await r.json();
    assert.deepEqual(Object.keys(ex.present), [ha]);
    assert.equal(ex.present[ha].size, a.length);
    assert.deepEqual(ex.absent, [missing]);
    r = await fetch(url(team, '/objects/exists'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: Array.from({ length: 1001 }, name) }) });
    assert.equal(r.status, 400, 'batch cap');

    // ── metering: counted in the workspace pool, as kind depot ──
    assert.equal(await workspaceUsedBytes(pool, team), a.length, 'team pool counts the object once');
    assert.deepEqual(await workspaceDepotKind(pool, team), { kind: 'depot', bytes: a.length, files: 1 });
    const c = crypto.randomBytes(5000), hc = name();
    assert.equal((await put(personal, hc, c)).status, 201);
    const mine = await storageUsage(pool, owner);
    assert.equal(mine.usedBytes, c.length, 'a personal workspace is the person\'s pool');
    assert.deepEqual(mine.byKind.find((k) => k.kind === 'depot'), { kind: 'depot', bytes: c.length, files: 1 });
    r = await fetch(url(team, '/usage'), { headers: auth });
    const usage = await r.json();
    assert.equal(usage.depotBytes, a.length); assert.equal(usage.objects, 1); assert.equal(usage.usedBytes, a.length);

    // ── a full pool refuses new objects; reads still work ──
    const free = await user('depot_free');   // Free plan: the smallest allowance
    const freeWs = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'personal', 'Free', $2) RETURNING id`, [free, `free-${tag}`])).rows[0].id;
    const freeAllowance = (await storageUsage(pool, free)).allowanceBytes;
    assert.ok(freeAllowance > 0, 'the free plan has a finite allowance');
    await pool.query(`INSERT INTO storage_depot_objects (workspace_id, hash, payload_sha256, size_bytes, object_key, backend) VALUES ($1, $2, $3, $4, $5, 'fs')`,
      [freeWs, name(), sha(Buffer.alloc(0)), freeAllowance, 'depot/none']);   // a row-only stand-in: the meter reads rows
    r = await put(freeWs, name(), b);
    assert.equal(r.status, 507, 'pool full');
    assert.equal((await r.json()).error.code, 'storage_full');

    // ── a racing pair of identical puts makes one object, one row ──
    const d = crypto.randomBytes(64 * 1024), hd = name();
    const racers = await Promise.all(Array.from({ length: 8 }, () => put(team, hd, d)));
    const statuses = racers.map((x) => x.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1, `exactly one creator, got ${statuses}`);
    assert.ok(statuses.every((s) => s === 200 || s === 201));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM storage_depot_objects WHERE workspace_id = $1 AND hash = $2', [team, hd])).rows[0].n, 1);

    // ── an object in the store without a row (a crash between the two) is adopted only if it is the same bytes ──
    const e = crypto.randomBytes(3000), he = name();
    await store.putNew(depotObjectKey(team, he), e);
    assert.equal((await put(team, he, e)).status, 201, 'same bytes: adopted and recorded');
    const f = crypto.randomBytes(3000), hf = name();
    await store.putNew(depotObjectKey(team, hf), crypto.randomBytes(3000));
    assert.equal((await put(team, hf, f)).status, 409, 'stranger bytes under the name: refused, never adopted');

    // ── delete: Depot decided nothing references it ──
    const before = await workspaceUsedBytes(pool, team);
    r = await fetch(url(team, `/objects/${hd}`), { method: 'DELETE', headers: auth });
    assert.equal(r.status, 200);
    assert.equal((await fetch(url(team, `/objects/${hd}`), { headers: auth })).status, 404, 'gone after delete');
    assert.equal(await store.head(depotObjectKey(team, hd)), null, 'bytes removed from the store');
    assert.equal(await workspaceUsedBytes(pool, team), before - d.length, 'metering drops the bytes');
    assert.equal((await fetch(url(team, `/objects/${hd}`), { method: 'DELETE', headers: auth })).status, 404, 'idempotent');
    assert.equal((await put(team, hd, d)).status, 201, 'can be written again after delete');

    // ── signed read URLs for the objects host ──
    const URL_KEY = 'depot-url-key-' + tag;
    const signedApp = express();
    signedApp.use((req, _res, next) => { req.db = pool; next(); });
    signedApp.use('/s', createStorageDepotServiceRouter({ env: { DEPOT_STORAGE_SERVICE_TOKEN: TOKEN, DEPOT_OBJECT_URL_KEY: URL_KEY, DEPOT_OBJECT_URL_BASE: 'https://objects.test' }, store }));
    const signedServer = http.createServer(signedApp);
    await new Promise((r) => signedServer.listen(0, '127.0.0.1', r));
    try {
      const sbase = `http://127.0.0.1:${signedServer.address().port}/s/workspaces/${team}`;
      const asked = await fetch(`${sbase}/objects/urls`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [ha, missing], ttl: 120 }) });
      assert.equal(asked.status, 200);
      const signedUrls = await asked.json();
      assert.deepEqual(signedUrls.absent, [missing], 'no URL for an object the workspace does not hold');
      const u = new URL(signedUrls.urls[ha].url);
      assert.equal(u.origin, 'https://objects.test');
      assert.equal(u.pathname, `/d/${team}/${ha}`);
      assert.equal(signedUrls.urls[ha].sha256, sha(a));
      const expiry = Number(u.searchParams.get('e'));
      assert.ok(expiry > Date.now() / 1000 + 100 && expiry <= Date.now() / 1000 + 121, 'expiry is the asked ttl');
      // the Worker's own verifier accepts exactly this URL (same signed string, same key)
      const expected = crypto.createHmac('sha256', URL_KEY).update(`depot:v1\n${team}\n${ha}\n${expiry}`).digest('hex');
      assert.equal(u.searchParams.get('s'), expected);
      const otherAsk = await fetch(`http://127.0.0.1:${signedServer.address().port}/s/workspaces/${other}/objects/urls`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [hc] }) });
      assert.deepEqual((await otherAsk.json()).absent, [hc], 'another workspace\'s object gets no URL');
      const tooLong = await fetch(`${sbase}/objects/urls`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [ha], ttl: 301 }) });
      assert.equal(tooLong.status, 400, 'ttl cap');
    } finally { signedServer.close(); }
    const unset = await fetch(url(team, '/objects/urls'), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [ha] }) });
    assert.equal(unset.status, 503, 'no key: no URLs, never unsigned ones');

    // ── limiter skip only for the right token on the right path ──
    const call = (p, h) => ({ baseUrl: '/api', path: p, headers: h ? { authorization: h } : {} });
    assert.equal(isAuthenticatedDepotStorageCall(call('/storage/service/depot/v1/x', `Bearer ${TOKEN}`), TOKEN), true);
    assert.equal(isAuthenticatedDepotStorageCall(call('/storage/service/depot/v1/x', 'Bearer nope'), TOKEN), false);
    assert.equal(isAuthenticatedDepotStorageCall(call('/storage/service/depotX/v1', `Bearer ${TOKEN}`), TOKEN), false);
    assert.equal(isAuthenticatedDepotStorageCall(call('/chat', `Bearer ${TOKEN}`), TOKEN), false);
    assert.equal(isAuthenticatedDepotStorageCall(call('/storage/service/depot/v1/x', `Bearer ${TOKEN}`), ''), false);

    console.log('storage-depot-objects: all checks passed');
  } finally {
    server.close();
    await pool.query('DELETE FROM storage_depot_objects WHERE workspace_id IN (SELECT id FROM workspaces WHERE slug LIKE $1)', [`%-${tag}`]).catch(() => {});
    await pool.end();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
