/**
 * XENO-WORKFORCE-01 NFR-04: "List API p95 <=500 ms on a documented local qualification environment
 * with 10,000 agents, 1,000 teams, 100 workspaces and 100,000 assignments. Publish dataset/query-plan
 * evidence; this is a test envelope, not a traffic forecast."
 *
 * The workforce estate has exactly ONE list API: POST /api/workforce/resources/list (the owned
 * catalog). This qualifies that route at the spec's envelope, measured over real HTTP through the
 * real router -- authentication, DPoP, scope and client ceiling, the authority transaction and the
 * keyset query -- against real PostgreSQL. Measuring the service function alone would leave out
 * exactly the layers that tend to be slow.
 *
 * DATASET (seeded in one statement per table, so the seed is a fixture and not the thing timed):
 *   - 100 workspaces, each owning 100 agents and 10 teams  -> 10,000 agents, 1,000 teams
 *   - 100,000 workspace assignments: every agent assigned to 10 OTHER workspaces
 *   - the caller is a viewer of every workspace
 * Assignments do not feed this route's query -- it lists OWNED resources -- but they are in the
 * envelope because they share the tables and indexes a real deployment would have, and a route that
 * is fast only on an empty neighbourhood is not qualified.
 *
 * WHAT IS MEASURED: 200 sequential requests across all 100 workspaces, a mix of first pages and
 * cursor follow-ups (limit 50), plus kind-filtered pages. p95 is computed from the sorted samples.
 * The query plan is captured with EXPLAIN (ANALYZE, BUFFERS) and asserted to use the owner catalog
 * index rather than a sequential scan -- a plan that scans is fast on a laptop and slow in production.
 *
 * EVIDENCE: the dataset counts, p50/p95/max, the environment and the plan are printed as a single
 * JSON line prefixed `NFR-04 evidence:` so a run is its own record. The environment is whatever
 * machine runs it, which is what "a documented local qualification environment" permits; the line
 * says which.
 *
 * 🔴 THE CITATION IS ONLY AS WIDE AS THE LIST ROUTES THAT EXIST, so that is gated too. VIEW-01/02
 * specify a global aggregate list and an assigned-resources list; neither exists yet. The first
 * test below enumerates every workforce route whose path is a list and fails if any is not in
 * QUALIFIED -- so a new list route cannot inherit this citation without being qualified here. It
 * reads source and needs no database, so it runs even where the timing test is skipped.
 *
 * Measured 2026-09-23 (WSL2, Ryzen 9 9950X, PostgreSQL 16.15): p50 10.4 ms, p95 14.9 ms, max 63.6 ms,
 * index scan on workforce_resources_workspace_catalog. Mutation-checked: dropping that index fails the
 * plan check; adding an unmeasured `/assignments/list` route fails the enumeration; a 600 ms stall in
 * the catalog query fails the p95 budget. Restored, 6/6.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
import express from 'express';
import { issuer } from '../src/server/config/hosts.js';
import { jwkThumbprint, accessTokenHash } from '../src/server/utils/dpop.js';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const { default: router } = await import('../src/server/routes/workforceRoutes.js');

const WORKSPACES = 100, AGENTS_PER = 100, TEAMS_PER = 10, ASSIGNMENTS_PER_AGENT = 10;
const SAMPLES = 200, PAGE = 50, P95_BUDGET_MS = 500;

/** Every workforce list route this suite qualifies. A new one must be added here WITH a measurement. */
const QUALIFIED = ['/resources/list'];

test('every workforce list route is one this suite qualifies (NFR-04)', () => {
  const routes = [];
  for (const file of ['src/server/routes/workforceRoutes.js', 'src/server/routes/apiKeyWorkforceCapabilityRoutes.js']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [, verb, route] of text.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) routes.push({ file, verb, route });
  }
  // A route scan that finds nothing is a broken scan, not an empty estate.
  assert.ok(routes.some(r => r.route === '/resources'), `route scan found no workforce routes: ${JSON.stringify(routes)}`);
  const lists = routes.filter(r => /(^|\/)list(\/|$)/.test(r.route) || r.verb === 'get').map(r => r.route);
  assert.deepEqual(lists.filter(r => !QUALIFIED.includes(r)), [],
    'a workforce list route exists that this suite does not measure; qualify it before it can share the NFR-04 citation');
  assert.deepEqual(QUALIFIED.filter(r => !lists.includes(r)), [], 'QUALIFIED names a route that no longer exists');
});

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

test('workforce list API p95 at the NFR-04 envelope (NFR-04)', { skip: workforceProofUnavailable(), timeout: 600_000 }, async t => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_scale_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, application_name: schema });
  let created = false, server;
  const human = randomUUID(), other = randomUUID();
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,username TEXT,display_name TEXT,email TEXT,avatar_url TEXT,
      email_verified BOOLEAN DEFAULT true,role TEXT DEFAULT 'user',is_active BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE oidc_signing_keys(kid TEXT PRIMARY KEY,alg TEXT,private_pem TEXT);
      CREATE TABLE oauth_dpop_replays(jkt TEXT,jti TEXT,htm TEXT,htu TEXT,expires_at TIMESTAMPTZ,UNIQUE(jkt,jti));`);
    for (const id of [human, other]) await pool.query('INSERT INTO users(id,username) VALUES($1,$2)', [id, id]);
    for (const filename of ['20260711120000-workspaces.sql', '20260811130000-agent-identities.sql',
      '20260905120000-workforce-resources.sql', '20260905122000-workforce-workspace-assignments.sql']) {
      await pool.query((await readFile(new URL(`../src/server/database/migrations/${filename}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }

    // ── Dataset ──────────────────────────────────────────────────────────────────────────────
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug)
      SELECT gen_random_uuid(), $1, 'Scale '||n, 'scale-'||n FROM generate_series(1,$2) AS n`, [other, WORKSPACES]);
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
      SELECT 'workspace', id, 'viewer', 'user', $1 FROM workspaces`, [human]);
    // Distinct microsecond timestamps so the keyset order is total and a cursor walk is exact.
    await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,created_by_user_id,name,created_at)
      SELECT CASE WHEN r.n <= $2 THEN 'agent' ELSE 'team' END, w.id, $1, 'Resource '||r.n,
             '2026-09-01T00:00:00Z'::timestamptz + ((w.ord*1000 + r.n) * interval '1 microsecond')
        FROM (SELECT id, row_number() OVER (ORDER BY id) AS ord FROM workspaces) w
        CROSS JOIN generate_series(1,$3) AS r(n)`, [other, AGENTS_PER, AGENTS_PER + TEAMS_PER]);
    // Every agent proposed into ASSIGNMENTS_PER_AGENT workspaces other than its owner. The trigger
    // requires INSERTs to be `proposed` at revision 1, which is also the realistic majority state.
    await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
        resource_revision,created_by_user_id,policy)
      SELECT r.id, 'agent', t.id, r.owner_workspace_id, 1, $1, '{"schemaVersion":1,"mode":"none","capabilities":[]}'::jsonb
        FROM workforce_resources r
        JOIN (SELECT id, row_number() OVER (ORDER BY id) AS ord FROM workspaces) o ON o.id = r.owner_workspace_id
        JOIN (SELECT id, row_number() OVER (ORDER BY id) AS ord FROM workspaces) t
          ON ((t.ord - o.ord + $3) % $3) BETWEEN 1 AND $2
       WHERE r.kind = 'agent'`, [other, ASSIGNMENTS_PER_AGENT, WORKSPACES]);
    await pool.query('ANALYZE workforce_resources; ANALYZE workforce_workspace_assignments; ANALYZE relationship_tuples; ANALYZE workspaces');

    const counts = (await pool.query(`SELECT
        (SELECT count(*) FROM workforce_resources WHERE kind='agent')::int AS agents,
        (SELECT count(*) FROM workforce_resources WHERE kind='team')::int AS teams,
        (SELECT count(*) FROM workspaces)::int AS workspaces,
        (SELECT count(*) FROM workforce_workspace_assignments)::int AS assignments`)).rows[0];

    await t.test('the dataset is the envelope the requirement names, not an approximation of it', () => {
      assert.deepEqual(counts, { agents: 10_000, teams: 1_000, workspaces: 100, assignments: 100_000 });
    });

    // ── Real HTTP boundary ───────────────────────────────────────────────────────────────────
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }), proofKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = proofKey.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
    await pool.query("INSERT INTO oidc_signing_keys(kid,alg,private_pem) VALUES('scale-key','ES256',$1)", [key.privateKey.export({ type: 'pkcs8', format: 'pem' })]);
    const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const raw = jwt.sign({ sub: human, typ: 'at+jwt', client_id: 'xeno-agent-interface', scope: 'workforce:read', cnf: { jkt } },
      key.privateKey, { algorithm: 'ES256', keyid: 'scale-key', audience: 'xeno-api', expiresIn: '10m', header: { typ: 'at+jwt' } });
    const path = '/api/workforce/resources/list';
    const post = async body => {
      const dpop = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: `${issuer()}${path}`, ath: accessTokenHash(raw), iat: Math.floor(Date.now() / 1000) },
        proofKey.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
      const started = performance.now();
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `DPoP ${raw}`, dpop }, body: JSON.stringify(body) });
      const payload = await response.json();
      return { status: response.status, body: payload, ms: performance.now() - started };
    };
    const workspaceIds = (await pool.query('SELECT id FROM workspaces ORDER BY id')).rows.map(r => r.id);
    const request = (workspace, rest = {}) => ({ owner: { type: 'workspace', id: workspace }, expectedActorAccountId: human, limit: PAGE, ...rest });

    await t.test('a page is correct before it is timed', async () => {
      // A fast wrong answer is not a qualified list. Walk one workspace completely by cursor and
      // compare against the table, so the timing below is known to be timing the real result.
      const ws = workspaceIds[0], ids = []; let cursor;
      do {
        const r = await post(request(ws, cursor ? { cursor } : {}));
        assert.equal(r.status, 200); ids.push(...r.body.items.map(i => i.id)); cursor = r.body.nextCursor;
      } while (cursor);
      const expected = (await pool.query(`SELECT id FROM workforce_resources WHERE owner_workspace_id=$1 AND status='active'
        ORDER BY created_at DESC,id DESC`, [ws])).rows.map(r => r.id);
      assert.equal(ids.length, AGENTS_PER + TEAMS_PER); assert.deepEqual(ids, expected);
    });

    // Warm the connection pool and the JIT so the samples measure the route, not first-touch cost.
    for (let i = 0; i < 20; i++) await post(request(workspaceIds[i % WORKSPACES]));

    const samples = [];
    await t.test(`${SAMPLES} requests across every workspace: p95 <= ${P95_BUDGET_MS} ms`, async () => {
      for (let i = 0; i < SAMPLES; i++) {
        const ws = workspaceIds[i % WORKSPACES];
        let body = request(ws, i % 5 === 4 ? { kind: 'team' } : {});
        if (i % 3 === 2) {
          const first = await post(request(ws));
          assert.equal(first.status, 200);
          body = request(ws, { cursor: first.body.nextCursor });
        }
        const r = await post(body);
        assert.equal(r.status, 200, `request ${i} failed: ${JSON.stringify(r.body)}`);
        assert.ok(r.body.items.length > 0, `request ${i} returned an empty page`);
        samples.push(r.ms);
      }
      samples.sort((a, b) => a - b);
      assert.ok(percentile(samples, 95) <= P95_BUDGET_MS, `p95 ${percentile(samples, 95).toFixed(1)} ms exceeds ${P95_BUDGET_MS} ms`);
    });

    await t.test('the plan reads the owner catalog index, never a sequential scan of resources', async () => {
      const db = await pool.connect();
      try {
        const plan = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name,description,status,revision,created_at,updated_at
            FROM workforce_resources WHERE owner_workspace_id=$1 AND ($2::text IS NULL OR kind=$2) AND status='active'
            ORDER BY created_at DESC,id DESC LIMIT $3`, [workspaceIds[50], null, PAGE + 1])).rows[0]['QUERY PLAN'][0];
        const nodes = [];
        const collect = node => { nodes.push(node); (node.Plans || []).forEach(collect); };
        collect(plan.Plan);
        const scans = nodes.filter(n => n['Relation Name'] === 'workforce_resources');
        assert.ok(scans.length > 0, 'the plan never touched workforce_resources; this EXPLAIN is not the list query');
        assert.deepEqual(scans.filter(n => n['Node Type'] === 'Seq Scan').map(n => n['Node Type']), [],
          'the list query sequentially scans workforce_resources at the envelope');
        assert.ok(scans.some(n => n['Index Name'] === 'workforce_resources_workspace_catalog'),
          `expected workforce_resources_workspace_catalog, plan used: ${scans.map(n => n['Index Name'] || n['Node Type']).join(', ')}`);
        console.log('NFR-04 evidence:', JSON.stringify({
          route: 'POST /api/workforce/resources/list', dataset: counts, samples: samples.length, pageSize: PAGE,
          p50Ms: Number(percentile(samples, 50).toFixed(2)), p95Ms: Number(percentile(samples, 95).toFixed(2)),
          maxMs: Number(samples.at(-1).toFixed(2)), budgetMs: P95_BUDGET_MS,
          plan: scans.map(n => ({ node: n['Node Type'], index: n['Index Name'] ?? null })), executionMs: plan['Execution Time'],
          environment: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model,
            memoryGb: Math.round(os.totalmem() / 2 ** 30), postgres: (await db.query('SHOW server_version')).rows[0].server_version },
        }));
      } finally { db.release(); }
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
