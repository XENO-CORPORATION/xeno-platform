/**
 * Dev › Automate end to end with the REAL XENO Workflow runner — the bundle xeno-workflow builds
 * (`npm run build:headless` → out/headless/server.mjs) — against this platform's REAL /api/v1 and JWKS on a real
 * Postgres. Nothing on either side is faked: the platform signs, the runner verifies against the platform's published
 * key, runs the workflow on xeno-workflow's own engine, and its workspace action calls /api/v1 with the run's key,
 * which the platform authorizes (scope, grant, workspace) like any other key.
 *
 *   - a task move → the runner → tasks.task.create through /api/v1 → the task exists
 *   - the run key is revoked afterwards; a re-delivered run id is answered from the runner's record, nothing repeats
 *   - a grant taken away is refused by /api/v1 (grant_missing), and the run fails with that code
 *
 * Run: XENO_WORKFLOW_RUNNER_BUNDLE=<xeno-workflow>/out/headless/server.mjs DATABASE_URL=postgresql://… \
 *        node src/server/tests/xeno-workflow-e2e.test.mjs
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { jwks } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import workspaceApiRoutes from '../routes/workspaceApiRoutes.js';
import * as W from '../services/xenoWorkflow.js';
import * as creds from '../services/workspaceCredentials.js';
import * as tasks from '../services/xenoTasks.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const BUNDLE = process.env.XENO_WORKFLOW_RUNNER_BUNDLE;
if (!BUNDLE || !fs.existsSync(BUNDLE)) throw new Error('XENO_WORKFLOW_RUNNER_BUNDLE must point at xeno-workflow out/headless/server.mjs (npm run build:headless there)');
process.env.SECRET_BOX_KEY = process.env.SECRET_BOX_KEY || crypto.randomBytes(32).toString('base64');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const tag = `we${Date.now().toString(36)}`;
let runner = null, server = null;

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);

  // the platform: its JWKS and its REST capability surface, exactly as index.js mounts them
  const app = express();
  app.use(express.json());
  app.get('/api/oauth2/jwks', async (req, res) => res.json(await jwks(pool)));
  app.use('/api/v1', (req, res, next) => { req.db = pool; next(); }, workspaceApiRoutes);
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const platform = `http://127.0.0.1:${server.address().port}`;

  // the runner: xeno-workflow's built bundle, its own process
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xwf-e2e-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  runner = spawn(process.execPath, [BUNDLE], { env: { ...process.env, XENO_PLATFORM_URL: platform, XENO_PLATFORM_ISSUER: issuer(), XENO_WORKFLOW_ALLOW_HTTP_PLATFORM: '1', XENO_WORKFLOW_RUNNER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; runner.stdout.on('data', (d) => { out += d; }); runner.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 200 && !out.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('listening')) throw new Error('the runner did not start:\n' + out);
  process.env.XENO_WORKFLOW_RUNNER_URL = `http://127.0.0.1:${port}`;
  W._resetCatalogueCache();

  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}${s}`, `${tag}${s}@xeno.test`, s])).rows[0].id;
  const owner = await user('own');
  const O = { id: owner, kind: 'human' };
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'personal','Mine',$2) RETURNING id`, [owner, `${tag}-p`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${owner}`, relation: 'owner' }, { object: `workspace:${ws}`, subject: `user:${owner}`, relation: 'admin' }] });

  const cat = await W.runnerCatalogue(pool, O, { workspace: ws, fresh: true });
  check(cat.some((n) => n.type === 'xeno-platform-capability') && !cat.some((n) => n.type === 'read-file'), 'the platform reads the REAL runner’s catalogue with its signed assertion');

  const title = `Follow up ${tag}`;
  const graph = { version: 2, variables: {}, nodes: [
    { id: 'trigger', type: 'xeno-platform-trigger', label: 'When', config: { event: 'task.status_changed', taskStatus: 'todo' }, position: { x: 0, y: 0 } },
    { id: 'act', type: 'xeno-platform-capability', label: 'Create', config: { capability: 'tasks.task.create', arguments: `{"title":"${title}: {{ $node.trigger.event.task.title }}"}` }, position: { x: 560, y: 0 } },
  ], edges: [
    { id: 'e1', source: 'trigger', sourcePort: 'out', target: 'act', targetPort: 'in', kind: 'exec' },
  ] };
  const flow = (await W.createWorkflow(pool, O, { workspace: ws, name: 'E2E', graph })).workflow;
  await W.enableWorkflow(pool, O, flow.id);

  const t = await tasks.createTask(pool, O, { title: 'The brief' });
  await tasks.transitionTask(pool, O, t.key, { to: 'todo' });
  const swept = await W.sweep(pool);
  const run = (await W.listRuns(pool, O, { workflowId: flow.id })).runs[0];
  check(swept.delivered === 1 && run.state === 'succeeded', `the real runner ran it (${run.state}${run.error ? ': ' + run.error : ''})`);
  const made = (await pool.query(`SELECT id, title FROM tasks WHERE title = $1`, [`${title}: The brief`])).rows;
  check(made.length === 1, 'its workspace action created the task through /api/v1 with the run’s key');
  const act = run.steps.find((s) => s.nodeId === 'act');
  check(act && act.status === 'success' && act.outputs && act.outputs.capability === 'tasks.task.create', 'the step records the capability and its reply');
  const keyRow = (await pool.query('SELECT k.revoked_at FROM workspace_workflow_runs r JOIN workspace_agent_keys k ON k.id = r.key_id WHERE r.id = $1', [run.id])).rows[0];
  check(keyRow && keyRow.revoked_at, 'the run key is revoked once the run ends');

  // a re-delivered run id: the runner answers from its record and nothing is created twice
  await pool.query(`UPDATE workspace_workflow_runs SET state = 'queued', available_at = now() WHERE id = $1`, [run.id]);
  await W.sweep(pool);
  check((await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title = $1`, [`${title}: The brief`])).rows[0].n === 1, 'a re-delivered run does not act twice');

  // the platform, not the runner, decides: take the grant away and /api/v1 refuses the same workflow
  const agent = (await pool.query('SELECT agent_user_id FROM workspace_workflows WHERE id = $1', [flow.id])).rows[0].agent_user_id;
  await creds.revokeGrants(pool, agent, ws);
  const t2 = await tasks.createTask(pool, O, { title: 'Second' });
  await tasks.transitionTask(pool, O, t2.key, { to: 'todo' });
  await W.sweep(pool);
  const r2 = (await W.listRuns(pool, O, { workflowId: flow.id })).runs[0];
  check(r2.state === 'failed' && /grant_missing/.test(r2.error || ''), `without the grant /api/v1 refuses it and the run fails (${r2.error})`);

  console.log(`\nxeno-workflow e2e: ${passed} checks passed`);
}

const done = async (code) => { try { runner && runner.kill(); } catch {} try { server && server.close(); } catch {} await pool.end().catch(() => {}); process.exit(code); };
main().then(() => done(0)).catch((e) => { console.error(e); done(1); });
