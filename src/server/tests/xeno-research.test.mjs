/**
 * XENO Research on the platform, end to end on a real Postgres, the REAL routers and the REAL vendored engine
 * (xeno-research: lock, runNotebook, compareRuns, signRecord, verifyRecord). Only XENO Box is a fake: an HTTP double
 * of its /v1 API that runs nothing and answers what the harness would print.
 *
 *   1. tenant scoping: a stranger reads notebooks, runs and claims as 404; a viewer reads but cannot run
 *   2. FAIL CLOSED: no Box configured -> refused box_not_configured; Box unqualified and the project outside the XENO
 *      workspace -> refused box_unqualified with Box's own state; Box unreachable -> refused; no signing key -> refused.
 *      Mutation: the same project runs once it IS the XENO workspace, and once Box reports qualified.
 *   3. a run goes queued -> running -> done; the record is signed and the signature checks now; a tampered record
 *      reads invalid; the database refuses a done run without a signature
 *   4. verify: reproduced; then Box answers differently with the same subject -> not-reproduced; a new lock -> changed
 *   5. concurrency: five runs queued, never more than 2 running at once, all finish
 *   6. claims: a cell becomes a project-scoped Corpus tenet; Re-check under an admission records a held verdict in
 *      Corpus; a drifted answer records lapsed; a re-check with no admission is refused
 *   7. export: one download with the notebook, provenance, PROV and SHA256SUMS that match
 *   8. the migration's DOWN path drops the tables and UP restores them
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/xeno-research.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import * as engine from 'xeno-research';
import chatRoutes from '../routes/chatRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import { createResearchRouter } from '../routes/researchRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations, rollbackMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { admitAccountRun, readRunnablePin } from '../services/workforceRunAdmission.js';
import * as research from '../services/xenoResearch.js';
import * as researchMcp from '../services/researchMcp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const rejects = async (p, re) => { try { await p; return false; } catch (e) { return re.test(String(e.code || '') + ' ' + String(e.message || '')); } };

// ── a fake XENO Box: the /v1 API surface the engine calls, nothing executed
const MARKER = '\x1eXENO-RESEARCH-RESULT\x1e';
const BOX = { up: true, safety: 'unqualified', drift: '', maxRunning: 0, running: 0, delayMs: 0 };
const vols = new Map(), sbx = new Map();
const json = (status, body) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)), arrayBuffer: async () => new ArrayBuffer(0) });
async function fakeBox(url, { method = 'GET', headers = {}, body } = {}) {
  if (!BOX.up) throw new Error('connect ECONNREFUSED');
  if (headers.authorization !== 'Bearer box-token') return json(401, { error: 'unauthorized' });
  const u = new URL(url), p = u.pathname;
  if (p === '/v1/capabilities') return json(200, { images: ['sci:1'], backend: { kind: 'container' }, sandbox: { isolation: 'container' }, network: 'default-deny', host_safety: { state: BOX.safety } });
  if (p === '/v1/volumes' && method === 'POST') { const id = 'v' + crypto.randomUUID(); vols.set(id, new Map()); return json(201, { id }); }
  let m = p.match(/^\/v1\/volumes\/([^/]+)\/files$/);
  if (m) {
    const files = vols.get(m[1]), path = u.searchParams.get('path');
    if (method === 'PUT') { files.set(path, Buffer.from(body)); return json(204); }
    const b = files.get(path); if (!b) return json(404, {});
    return { status: 200, text: async () => b.toString('utf8'), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  }
  m = p.match(/^\/v1\/volumes\/([^/]+)$/); if (m && method === 'DELETE') { vols.delete(m[1]); return json(204); }
  if (p === '/v1/sandboxes' && method === 'POST') { const req = JSON.parse(body); const id = 's' + crypto.randomUUID(); sbx.set(id, req.mounts[0].volume); return json(201, { id }); }
  m = p.match(/^\/v1\/sandboxes\/([^/]+)$/); if (m && method === 'DELETE') { sbx.delete(m[1]); return json(204); }
  m = p.match(/^\/v1\/sandboxes\/([^/]+)\/exec$/);
  if (m) {
    const files = vols.get(sbx.get(m[1])), { argv } = JSON.parse(body);
    const done = (stdout = '', exit_code = 0) => json(200, { exit_code, stdout, stderr: '', timed_out: false, truncated: false });
    if (argv[0] === 'uv' && argv[2] === 'compile') { files.set('.xeno/requirements.lock', Buffer.from('numpy==2.0.0 \\\n    --hash=sha256:' + 'a'.repeat(64) + '\nipykernel==6.29.5 \\\n    --hash=sha256:' + 'b'.repeat(64) + '\njupyter-client==8.6.3 \\\n    --hash=sha256:' + 'c'.repeat(64) + '\n')); return done(); }
    if (argv[0] === 'python3' && argv[1] === '-c' && /platform/.test(argv[2])) return done('3.12.1\nlinux\n');
    if (String(argv[1] || '').endsWith('harness.py')) {
      BOX.running++; BOX.maxRunning = Math.max(BOX.maxRunning, BOX.running);
      try {
        if (BOX.delayMs) await new Promise((r) => setTimeout(r, BOX.delayMs));
        const cells = JSON.parse(files.get('.xeno/cells.json').toString('utf8'));
        const out = { environment: { python: '3.12.1', implementation: 'CPython', packages: ['numpy==2.0.0'] },
          cells: cells.map((c) => ({ index: c.index, outputs: [{ output_type: 'stream', name: 'stdout', text: `ran:${c.source}${BOX.drift}\n` }] })) };
        return done('kernel noise\n' + MARKER + JSON.stringify(out) + '\n');
      } finally { BOX.running--; }
    }
    return done();   // mkdir, the kernel probe, uv venv / install, the egress-ready wait
  }
  return json(404, { error: 'no such route ' + method + ' ' + p });
}

const NOTEBOOK = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' }, xeno: { requirements: ['numpy==2.0.0'] } },
  cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Result'] }, { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['print(1 + 1)'] },
    { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['print(2 * 21)'] }] };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('xr-ada'), bob = await mk('xr-bob'), eve = await mk('xr-eve');
  await addGrant(pool, ada, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:xr-ada' });
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const signingKey = engine.newSigningKey();
  const env = { XENO_BOX_URL: 'https://box.test:8443', XENO_BOX_TOKEN: 'box-token', XENO_RESEARCH_SIGNING_KEY: signingKey };
  research.configure({ env: {}, fetchImpl: fakeBox });

  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  app.use('/api/research', authMiddleware, createResearchRouter({ pool }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob), E = session(eve);
  const finished = async (id) => { await research.settled(); for (let i = 0; i < 50; i++) { const r = (await call('GET', `/api/research/runs/${id}`, { token: A })).j; if (!['queued', 'running'].includes(r.run.status)) return r; await research.settled(); await new Promise((x) => setImmediate(x)); } return (await call('GET', `/api/research/runs/${id}`, { token: A })).j; };

  try {
    const ws = (await call('GET', '/api/divisions', { token: A })).j.workspaceId;
    const pr = await call('POST', '/api/chat/projects', { body: { name: 'Thermal study' }, headers: { 'x-as': ada } });
    const project = String((pr.j.project || pr.j.data || pr.j).id);
    await writeTuples(pool, { writes: [{ object: `project:${project}`, relation: 'viewer', subject: `user:${bob}` }] });

    // ── notebooks and scoping
    const bad = await call('POST', `/api/research/projects/${project}/notebooks`, { token: A, body: { title: 'x', notebook: { cells: [] } } });
    ok(bad.s === 400 && bad.j.code === 'invalid_notebook', 'a file that is not nbformat 4 is refused by the engine’s parser');
    const created = await call('POST', `/api/research/projects/${project}/notebooks`, { token: A, body: { title: 'Heat flux', notebook: NOTEBOOK } });
    ok(created.s === 201 && /^nb_[0-9a-f]{32}$/.test(created.j.notebook.id), 'a project editor adds a notebook; its id is nb_…');
    const nb = created.j.notebook.id;
    ok((await call('POST', `/api/research/projects/${project}/notebooks`, { token: B, body: { title: 'y', notebook: NOTEBOOK } })).s === 403, 'a viewer cannot add a notebook');
    ok((await call('GET', `/api/research/notebooks/${nb}`, { token: B })).s === 200, 'a viewer reads the notebook');
    ok((await call('GET', `/api/research/notebooks/${nb}`, { token: E })).s === 404, 'TENANT SCOPING: a stranger reads the notebook as absent');
    ok((await call('GET', `/api/research/projects/${project}/notebooks`, { token: E })).s === 404, 'and the project’s notebook list as absent');
    ok((await call('POST', `/api/research/notebooks/${nb}/runs`, { token: E })).s === 404, 'a stranger cannot run it');
    ok((await call('POST', `/api/research/notebooks/${nb}/runs`, { token: B })).s === 403, 'a viewer cannot run it');
    ok((await call('GET', '/api/research/home', { token: E })).j.notebooks.length === 0, 'a stranger’s home lists none of it');

    // ── FAIL CLOSED
    let r = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(r.s === 201 && r.j.run.status === 'refused' && r.j.run.reasonCode === 'box_not_configured' && /XENO_BOX_URL/.test(r.j.run.reason), 'no Box configured: the run is refused box_not_configured, and the refusal is recorded');
    research.configure({ env: { ...env, XENO_RESEARCH_SIGNING_KEY: '' } });
    r = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(r.j.run.status === 'refused' && r.j.run.reasonCode === 'signing_unavailable', 'no signing key: refused signing_unavailable');
    research.configure({ env });
    BOX.up = false;
    r = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(r.j.run.status === 'refused' && r.j.run.reasonCode === 'box_unreachable', 'Box unreachable: refused, never run elsewhere');
    BOX.up = true;
    r = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(r.j.run.status === 'refused' && r.j.run.reasonCode === 'box_unqualified' && /"unqualified"/.test(r.j.run.reason), 'Box unqualified and the project outside the XENO workspace: refused box_unqualified with Box’s state');
    research.configure({ env: { ...env, XENO_INTERNAL_WORKSPACE_ID: crypto.randomUUID() } });
    r = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(r.j.run.status === 'refused', 'another workspace named as the XENO workspace does not open the gate');
    // MUTATION of the gate: the same project, once it IS the XENO workspace, is queued
    research.configure({ env: { ...env, XENO_INTERNAL_WORKSPACE_ID: ws } });
    ok((await research.runGate(ws)) === null && (await research.runGate(crypto.randomUUID()))?.code === 'box_unqualified', 'the gate opens for the XENO workspace only');
    BOX.safety = 'qualified';
    ok((await research.runGate(crypto.randomUUID())) === null, 'and for everyone once Box reports qualified');
    BOX.safety = 'unqualified';
    const refusedRow = (await pool.query(`SELECT id FROM research_runs WHERE status='refused' LIMIT 1`)).rows[0].id;
    ok(await rejects(pool.query(`UPDATE research_runs SET status='queued' WHERE id=$1`, [refusedRow]), /research_run_finished/), 'the database refuses reopening a refused run');

    // ── lock, then a run: queued -> running -> done, signed
    const lockReq = await call('POST', `/api/research/notebooks/${nb}/lock`, { token: A });
    ok(lockReq.j.run.status === 'queued' && lockReq.j.run.kind === 'lock', 'Lock is queued as a Box job');
    const locked = await finished(lockReq.j.run.id);
    const nbAfterLock = (await call('GET', `/api/research/notebooks/${nb}`, { token: A })).j.notebook;
    ok(locked.run.status === 'done' && nbAfterLock.locked && nbAfterLock.image === 'sci:1' && nbAfterLock.lockStale === false, 'the lock is resolved in Box, its header names the image, and it is not stale');
    const runReq = await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A });
    ok(runReq.j.run.status === 'queued' && /^rr_[0-9a-f]{32}$/.test(runReq.j.run.id), 'a run is queued with an rr_… id');
    const run1 = await finished(runReq.j.run.id);
    ok(run1.run.status === 'done' && run1.run.complete === true && run1.run.cells.length === 2 && run1.run.cells.every((c) => c.status === 'ok'), 'the run finishes: every code cell ok');
    ok(run1.run.executor?.kind === 'xeno-box' && run1.run.executor.image === 'sci:1', 'the record says it ran in XENO Box on the locked image');
    ok(run1.signature.state === 'valid' && run1.signature.checkedAgainst === 'platform-key', 'the signature checks against the platform research key');
    const nbView = (await call('GET', `/api/research/notebooks/${nb}`, { token: A })).j.notebook;
    ok(nbView.cells[1].outputs[0]?.text?.join('').includes('ran:print(1 + 1)'), 'the notebook page shows the outputs of the latest run');
    // MUTATION of the signature check: change one byte of the stored record
    const row = (await pool.query('SELECT * FROM research_runs WHERE id=$1', [run1.run.id])).rows[0];
    ok((await research.signatureCheck({ ...row, provenance: { ...row.provenance, complete: false } })).state === 'invalid', 'SIGNATURE CHECK: a tampered record reads invalid');
    ok((await research.signatureCheck({ ...row, signature: null })).state === 'unsigned', 'an unsigned record reads unsigned, never valid');
    research.configure({ env: { ...env, XENO_INTERNAL_WORKSPACE_ID: ws, XENO_RESEARCH_SIGNING_KEY: engine.newSigningKey() } });
    ok((await research.signatureCheck(row)).state === 'invalid', 'a record signed by another key is invalid against the platform key');
    research.configure({ env: { ...env, XENO_INTERNAL_WORKSPACE_ID: ws } });
    const nbRow = (await pool.query('SELECT * FROM research_notebooks WHERE id=$1', [nb])).rows[0];
    ok(await rejects(pool.query(`INSERT INTO research_runs (notebook_id, project_id, workspace_id, kind, status, notebook_sha256, requested_by_user_id, provenance)
      VALUES ($1,$2,$3,'run','done',$4,$5,'{}')`, [nb, nbRow.project_id, nbRow.workspace_id, nbRow.notebook_sha256, ada]), /research_run_done_is_signed/), 'the database refuses a done run without a signature');
    ok(await rejects(pool.query(`INSERT INTO research_runs (notebook_id, project_id, workspace_id, kind, notebook_sha256, requested_by_user_id)
      VALUES ($1,$2,$3,'run',$4,$5)`, [nb, crypto.randomUUID(), nbRow.workspace_id, nbRow.notebook_sha256, ada]), /research_run_wrong_scope|foreign key/), 'the database refuses a run filed under another project');
    ok((await call('GET', `/api/research/runs/${run1.run.id}`, { token: E })).s === 404, 'TENANT SCOPING: a stranger reads the run as absent');

    // ── verify
    const v1 = await finished((await call('POST', `/api/research/runs/${run1.run.id}/verify`, { token: A })).j.run.id);
    ok(v1.run.verdict === 'reproduced' && v1.run.verifyOf === run1.run.id, 'a re-run reproduces');
    BOX.drift = ' (drift)';
    const v2 = await finished((await call('POST', `/api/research/runs/${run1.run.id}/verify`, { token: A })).j.run.id);
    ok(v2.run.verdict === 'not-reproduced' && v2.run.comparison.findings.length === 0, 'same code, data and environment, different answer: not-reproduced');
    BOX.drift = '';
    await pool.query(`UPDATE research_notebooks SET lock_text = replace(lock_text, '3.12.1', '3.12.2') WHERE id=$1`, [nb]);
    BOX.drift = ' (new numpy)';
    const v3 = await finished((await call('POST', `/api/research/runs/${run1.run.id}/verify`, { token: A })).j.run.id);
    BOX.drift = '';
    ok(v3.run.verdict === 'changed' && v3.run.comparison.findings.some((f) => f.kind === 'environment-changed'), 'a different lock and a different answer: changed (explained), and it says the environment moved');
    ok((await call('POST', `/api/research/runs/${run1.run.id}/verify`, { token: B })).s === 403, 'a viewer cannot verify');

    // ── concurrency: at most 2 running
    BOX.delayMs = 40; BOX.maxRunning = 0;
    const many = [];
    for (let i = 0; i < 5; i++) many.push((await call('POST', `/api/research/notebooks/${nb}/runs`, { token: A })).j.run.id);
    const peak = { n: 0 };
    const watcher = setInterval(async () => { try { peak.n = Math.max(peak.n, Number((await pool.query(`SELECT count(*)::int n FROM research_runs WHERE status='running'`)).rows[0].n)); } catch {} }, 5);
    const results = []; for (const id of many) results.push(await finished(id));
    clearInterval(watcher); BOX.delayMs = 0;
    ok(results.every((x) => x.run.status === 'done'), 'five queued runs all finish');
    ok(BOX.maxRunning <= research.MAX_CONCURRENT && peak.n <= research.MAX_CONCURRENT, `never more than ${research.MAX_CONCURRENT} run in Box at once (peak in Box ${BOX.maxRunning}, rows ${peak.n})`);
    ok(BOX.maxRunning === 2, 'and the cap is used: two did run side by side');
    // claimNext refuses a third while two rows are running
    await pool.query(`UPDATE research_runs SET status='running' WHERE id IN (SELECT id FROM research_runs WHERE status='queued' LIMIT 0)`);
    const q1 = (await research.requestRun(pool, { id: ada }, nb)).run.id;  // queued (kick is deferred)
    await pool.query(`INSERT INTO research_runs (notebook_id, project_id, workspace_id, kind, status, notebook_sha256, requested_by_user_id) VALUES ($1,$2,$3,'run','running',$4,$5),($1,$2,$3,'run','running',$4,$5)`, [nb, nbRow.project_id, nbRow.workspace_id, nbRow.notebook_sha256, ada]);
    ok((await research.claimNext(pool)) === null, 'with two running, the next queued run stays queued');
    await research.recoverInterrupted(pool);
    ok((await pool.query(`SELECT count(*)::int n FROM research_runs WHERE reason_code='interrupted'`)).rows[0].n >= 2, 'at startup, runs left running are failed as interrupted, never left looking alive');
    await finished(q1);

    // ── claims through Corpus
    const cl = await call('POST', `/api/research/runs/${run1.run.id}/claims`, { token: A, body: { cell: 2, claim: 'Cell 2 prints 42' } });
    ok(cl.s === 201 && cl.j.claim.cell === 2 && cl.j.claim.state === 'unobserved' && cl.j.claim.subject === `research:${nb}`, 'a claimed cell becomes a project tenet, unobserved until checked');
    ok((await call('POST', `/api/research/runs/${run1.run.id}/claims`, { token: A, body: { cell: 0 } })).j.code === 'invalid_cell', 'a markdown cell cannot be claimed');
    const claimId = cl.j.claim.id;
    const corpusRow = (await pool.query(`SELECT t.expect, c.subject FROM corpus_tenets t JOIN corpus_corpora c ON c.id = t.corpus_id WHERE t.id=$1`, [claimId])).rows[0];
    ok(corpusRow.subject === `project:${project}` && corpusRow.expect === run1.run.cells.find((c) => c.index === 2).output_sha256, 'it lives in the PROJECT’s Corpus, and expects the recorded output hash');
    ok((await call('GET', `/api/research/claims/${claimId}`, { token: E })).s === 404, 'TENANT SCOPING: a stranger reads the claim as absent');
    ok((await call('POST', `/api/research/claims/${claimId}/recheck`, { token: A, body: {} })).j.code === 'admission_required', 'a re-check without a run admission is refused');
    const agent = (await call('POST', '/api/agents', { token: A, body: { name: 'Checker', description: 'Re-checks', instructions: 'Report.' } })).j.agent;
    const def = (await pool.query('SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].workforce_resource_id;
    const ctx = { actorUserId: ada, clientId: 'research-test' }, target = { kind: 'personal', ownerUserId: ada };
    const pin = await readRunnablePin(pool, ctx, { agent: { resourceId: def }, target });
    const admission = (await admitAccountRun(pool, ctx, { operationId: crypto.randomUUID(), agent: pin.agent, target, capabilities: pin.terms.definition, budget: { ceilingMicro: '2000000' }, taskRef: 'T-1' })).admission.admissionId;
    await pool.query(`UPDATE research_notebooks SET lock_text = replace(lock_text, '3.12.2', '3.12.1') WHERE id=$1`, [nb]);
    const rc = await call('POST', `/api/research/claims/${claimId}/recheck`, { token: A, body: { admissionId: admission } });
    await finished(rc.j.run.id);
    let claims = (await call('GET', `/api/research/projects/${project}/claims`, { token: A })).j.claims;
    ok(claims.find((c) => c.id === claimId)?.state === 'held', 'Re-check re-runs in Box and Corpus records HELD');
    const hist = (await call('GET', `/api/research/claims/${claimId}`, { token: B })).j;
    ok(hist.verdicts.length === 1 && hist.verdicts[0].admissionId === admission && hist.verdicts[0].signature, 'the verdict is Corpus’s own signed record, under the admission');
    BOX.drift = ' (drift)';
    await finished((await call('POST', `/api/research/claims/${claimId}/recheck`, { token: A, body: { admissionId: admission } })).j.run.id);
    BOX.drift = '';
    claims = (await call('GET', `/api/research/projects/${project}/claims`, { token: A })).j.claims;
    ok(claims.find((c) => c.id === claimId)?.state === 'lapsed', 'a drifted answer records LAPSED');
    const home = (await call('GET', '/api/research/home', { token: A })).j;
    ok(home.notebooks.some((n) => n.id === nb) && home.claims.some((c) => c.id === claimId && c.state === 'lapsed'), 'the mode home lists the notebook and the lapsed claim');
    ok(home.attention.some((x) => x.verdict === 'not-reproduced'), 'and the run that did not reproduce needs attention');
    const mcp = await researchMcp.callTool(pool, { id: ada }, 'claims', { project });
    ok(mcp.structuredContent.claims.length === 1, 'XENO MCP research.claims reads the same service');
    ok(await rejects(researchMcp.callTool(pool, { id: eve }, 'notebook', { notebook: nb }), /not_found/), 'and a stranger’s MCP call reads it as absent');

    // ── export
    const ex = await call('GET', `/api/research/runs/${run1.run.id}/export`, { token: A });
    const files = ex.j.files, sums = Object.fromEntries(files.SHA256SUMS.trim().split('\n').map((l) => l.split('  ').reverse()));
    ok(ex.s === 200 && files['Heat-flux.ipynb'] && files['provenance.prov.json'] && files['Heat-flux.ipynb.lock'], 'export carries the notebook, its lock and W3C PROV');
    ok(Object.keys(sums).every((f) => crypto.createHash('sha256').update(files[f]).digest('hex') === sums[f]), 'SHA256SUMS matches every exported file');
    ok(engine.verifyRecord(JSON.parse(files['provenance.json']), engine.publicKeyHex(signingKey)).valid, 'the exported provenance verifies offline with the public key');

    // ── DOWN path
    await research.settled();
    await rollbackMigrations(pool, 1);
    ok(!(await pool.query(`SELECT to_regclass('research_runs') r`)).rows[0].r && !(await pool.query(`SELECT to_regclass('research_notebooks') r`)).rows[0].r, 'the DOWN path drops both tables');
    await runAllMigrations(pool);
    ok(!!(await pool.query(`SELECT to_regclass('research_runs') r`)).rows[0].r, 'and UP restores them');
  } finally {
    server.close();
    await research.settled();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
