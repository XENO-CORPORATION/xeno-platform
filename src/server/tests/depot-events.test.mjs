// XENO Depot's signed event feed into the Index release record (services/depotEvents.js, routes/depotEventsRoutes.js;
// xeno-depot decision 0001 §7), against real Postgres with the Index's own three schema files applied as migrations.
// Proves: the signature is checked over the raw bytes (missing, wrong, tampered, stale, unconfigured → refused); a
// rotation accepts either secret; v != 1 answers 422; depot.push and depot.review.merged become changes carrying
// their Depot source, recorded once however often they are delivered; other types are acknowledged and ignored;
// a deploy recorded with a source keeps it, and its first source is never moved.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { receiveDepotEvent, signDepotEvent, verifyDepotSignature, DepotEventError } from '../services/depotEvents.js';
import { createDepotEventsRouter } from '../routes/depotEventsRoutes.js';
import { recordDeploy } from '../services/releaseRecord.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, '../database/migrations');
const SCHEMA = ['20261023100000-release-record.sql', '20261026090000-release-internal-notes.sql', '20261121120000-release-depot-source.sql'];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = crypto.randomBytes(32).toString('hex');
const NEXT = crypto.randomBytes(32).toString('hex');
const env = { DEPOT_EVENTS_SECRET: SECRET };

let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log(`ok   ${name}`); }
const refused = (p, code, status) => assert.rejects(p, (e) => { assert.equal(e.code, code); if (status) assert.equal(e.status ?? e.statusCode, status); return true; });

async function setup() {
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text)');
  await pool.query('CREATE TABLE workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
  for (const f of SCHEMA) await pool.query(fs.readFileSync(path.join(MIG, f), 'utf8').split(/^-- DOWN$/m)[0]);
}
const envelope = (over = {}) => ({
  v: 1, id: `evt_${crypto.randomBytes(6).toString('hex')}`, type: 'depot.push', at: '2026-11-21T18:00:00Z',
  workspace_id: crypto.randomUUID(), repo_id: 'citadel', actor: { kind: 'agent', id: 'agt_x' },
  data: { rev: 'b3f1c0de', parent: 'a1', message: 'Level 3 lighting' }, ...over,
});
const deliver = (evt, { secret = SECRET, t, env: e = env, raw } = {}) => {
  const body = raw ?? Buffer.from(JSON.stringify(evt));
  return receiveDepotEvent(pool, { raw: body, signature: signDepotEvent(secret, body, t), env: e });
};

async function main() {
  await setup();

  await check('an unsigned, wrong, tampered or stale delivery is refused; an unconfigured platform refuses all', async () => {
    const body = Buffer.from(JSON.stringify(envelope()));
    await refused(receiveDepotEvent(pool, { raw: body, signature: undefined, env }), 'bad_signature', 401);
    await refused(receiveDepotEvent(pool, { raw: body, signature: signDepotEvent('x'.repeat(64), body), env }), 'bad_signature', 401);
    const sig = signDepotEvent(SECRET, body);
    await refused(receiveDepotEvent(pool, { raw: Buffer.from(body.toString().replace('citadel', 'citadeX')), signature: sig, env }), 'bad_signature', 401);
    await refused(deliver(envelope(), { t: Math.floor(Date.now() / 1000) - 301 }), 'bad_signature', 401);
    await refused(deliver(envelope(), { env: {} }), 'events_not_configured', 503);
    await refused(deliver(envelope(), { env: { DEPOT_EVENTS_SECRET: 'short' } }), 'events_not_configured', 503);   // a weak secret is not a secret
    assert.equal(verifyDepotSignature({ header: 't=1,v1=zz', raw: body, secrets: [SECRET] }), false);
  });

  await check('a rotation accepts either secret', async () => {
    const both = { DEPOT_EVENTS_SECRET: `${SECRET},${NEXT}` };
    assert.equal((await deliver(envelope({ data: { rev: 'r-old' } }), { env: both })).consumers.index.inserted, true);
    assert.equal((await deliver(envelope({ data: { rev: 'r-new' } }), { secret: NEXT, env: both })).consumers.index.inserted, true);
  });

  await check('an envelope version this build does not know answers 422; a non-object answers 400', async () => {
    await refused(deliver(envelope({ v: 2 })), 'unsupported_event_version', 422);
    await refused(deliver(null, { raw: Buffer.from('[1,2]') }), 'invalid_event', 400);
    await refused(deliver(null, { raw: Buffer.from('not json') }), 'invalid_event', 400);
  });

  await check('depot.push becomes a commit change with its Depot source, recorded once however often it arrives', async () => {
    const evt = envelope();
    const first = await deliver(evt);
    assert.deepEqual([first.type, first.consumers.index.inserted, first.consumers.index.source], ['depot.push', true, { depotRepoId: 'citadel', rev: 'b3f1c0de' }]);
    assert.equal((await deliver(evt)).consumers.index.inserted, false);
    const rows = (await pool.query(`SELECT repo, kind, external_id, author, source_depot_repo_id, source_rev FROM release_changes WHERE external_id = 'b3f1c0de'`)).rows;
    assert.deepEqual(rows, [{ repo: 'depot:citadel', kind: 'commit', external_id: 'b3f1c0de', author: 'agent:agt_x', source_depot_repo_id: 'citadel', source_rev: 'b3f1c0de' }]);
  });

  await check('depot.review.merged becomes a pr change; other types are acknowledged and ignored', async () => {
    const m = await deliver(envelope({ type: 'depot.review.merged', data: { review_id: 'rv_7', rev: 'c0ffee', title: 'Merge lighting' } }));
    assert.equal(m.consumers.index.inserted, true);
    const pr = (await pool.query(`SELECT kind, external_id, source_rev FROM release_changes WHERE external_id = 'rv_7'`)).rows[0];
    assert.deepEqual(pr, { kind: 'pr', external_id: 'rv_7', source_rev: 'c0ffee' });
    const lock = await deliver(envelope({ type: 'depot.lock.acquired', data: { path: 'Maps/L3.umap' } }));
    assert.deepEqual(lock.consumers.index, { ignored: true, type: 'depot.lock.acquired' });
  });

  await check('a deploy recorded with a source keeps it, and the first source is never moved', async () => {
    const base = { service: 'frontend', sha: 'abc1234', mode: 'swap', status: 'ok', startedAt: '2026-11-21T18:10:00Z', finishedAt: '2026-11-21T18:12:00Z' };
    const { deploy } = await recordDeploy(pool, { ...base, provenance: 'recorded', source: { depot_repo_id: 'citadel', rev: 'b3f1c0de' } });
    assert.deepEqual(deploy.source, { depotRepoId: 'citadel', rev: 'b3f1c0de' });
    const again = await recordDeploy(pool, { ...base, provenance: 'recorded', source: { depot_repo_id: 'citadel', rev: 'other' } });
    assert.equal(again.deploy.source.rev, 'b3f1c0de');
    await assert.rejects(recordDeploy(pool, { ...base, sha: 'def5678', provenance: 'recorded', source: { depot_repo_id: 'citadel' } }), /both/);
  });

  await check('the route verifies the raw bytes it received, over HTTP', async () => {
    const app = express();
    app.use('/api/depot/events', express.raw({ type: '*/*', limit: '256kb' }), (req, _res, next) => { req.db = pool; next(); }, createDepotEventsRouter({ env }));
    app.use(express.json());   // the platform's global parser comes AFTER this mount, as in index.js
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api/depot/events`;
    try {
      const body = JSON.stringify(envelope({ data: { rev: 'http-1' } }));
      const send = (sig, b = body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-xeno-signature': sig } : {}) }, body: b });
      assert.equal((await send(null)).status, 401);
      const okRes = await send(signDepotEvent(SECRET, body));
      assert.equal(okRes.status, 200);
      assert.equal((await okRes.json()).consumers.index.inserted, true);
      const lockEvt = JSON.stringify(envelope({ type: 'depot.lock.released', data: { path: 'Maps/L3.umap' } }));
      assert.equal((await send(signDepotEvent(SECRET, lockEvt), lockEvt)).status, 202);   // Depot 0002 §1: ignored types answer 202
      const v2 = JSON.stringify(envelope({ v: 2 }));
      assert.equal((await send(signDepotEvent(SECRET, v2), v2)).status, 422);
      // the same JSON re-serialised with other spacing is NOT the signed bytes
      assert.equal((await send(signDepotEvent(SECRET, body), JSON.stringify(JSON.parse(body), null, 2))).status, 401);
    } finally { server.close(); }
  });

  assert.ok(new DepotEventError('x', 400) instanceof Error);
  console.log(`depot-events: ${passed} passed, 0 failed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
