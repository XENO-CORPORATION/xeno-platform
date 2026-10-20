/**
 * XENO Research on the platform -- the one service every surface calls (REST /api/research, XENO MCP research.*,
 * the Research mode screens). xeno-research/SPEC.md §8 item 4.
 *
 *   - A NOTEBOOK (.ipynb) belongs to a PROJECT; the project's ReBAC relation is its access. Anything a reader cannot
 *     see answers "not found".
 *   - The ENGINE is the vendored `xeno-research` package (vendor/xeno-research-<ver>-<sha>.tgz). This file never
 *     re-implements it: lock, run, compare, sign, verify and export are its functions. Tests inject a fake through
 *     `configure()`.
 *   - Every cell runs in XENO BOX, over its HTTP API, with the platform's own tenant token. There is no local
 *     fallback. Runs are ASYNC (queued -> running -> done | failed) and at most MAX_CONCURRENT run at once across
 *     the platform (the tenant has 8 sandboxes; a run uses 3 in sequence). The rest stay queued.
 *   - FAIL CLOSED: a run is refused -- recorded as `refused` with the reason the person sees -- when Box is not
 *     configured, cannot be reached, the signing key is absent, or Box's host safety is not `qualified` and the
 *     project is outside the XENO workspace (XENO_INTERNAL_WORKSPACE_ID). Unset means nobody is inside.
 *   - A CLAIM is a project-scoped tenet in XENO Corpus (services/xenoCorpus.js), one per claimed cell, its expect
 *     the cell's recorded output hash. Re-checking a claim re-runs the notebook in Box and records the verdict
 *     through Corpus's recordVerdict, under the run admission the person names. No CLI.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';
import * as corpus from './xenoCorpus.js';

export class ResearchError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'ResearchError'; this.code = code; this.status = status; }
}
const fail = (message, code, status = 400) => { throw new ResearchError(message, code, status); };
const notFound = (what = 'Not found') => new ResearchError(what, 'not_found', 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NB_ID = /^nb_[0-9a-f]{32}$/;
const RUN_ID = /^rr_[0-9a-f]{32}$/;
export const MAX_CONCURRENT = 2;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ───────────────────────────── configuration: the engine, Box, the signing key

let ENGINE = null;          // set by configure() in tests; the vendored package otherwise
let ENV = process.env;
let FETCH = null;           // the fetch Box calls use (private CA); tests inject one
export function configure({ engine, env, fetchImpl } = {}) {
  if (engine !== undefined) ENGINE = engine;
  if (env !== undefined) ENV = env;
  if (fetchImpl !== undefined) FETCH = fetchImpl;
}
async function engine() { if (!ENGINE) ENGINE = await import('xeno-research'); return ENGINE; }

/**
 * A fetch for Box only: Box's TLS certificate is issued by a private CA (XENO_BOX_CA_FILE), which is passed as the
 * `ca` of these requests and of nothing else. Verification is never turned off.
 */
export function boxFetch({ ca } = {}) {
  return (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, ...(u.protocol === 'https:' && ca ? { ca } : {}), timeout: 15 * 60_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Box did not answer in time')));
    if (body != null) req.write(body);
    req.end();
  });
}
export function boxConfig(env = ENV) {
  const url = String(env.XENO_BOX_URL || '').trim(), token = String(env.XENO_BOX_TOKEN || '').trim();
  let ca = null;
  if (env.XENO_BOX_CA_FILE) { try { ca = fs.readFileSync(env.XENO_BOX_CA_FILE); } catch { ca = null; } }
  return { url, token, caFile: env.XENO_BOX_CA_FILE || null, ca, configured: !!(url && token),
    caMissing: !!env.XENO_BOX_CA_FILE && !ca, internalWorkspaceId: String(env.XENO_INTERNAL_WORKSPACE_ID || '').trim().toLowerCase() || null,
    signingKey: /^[0-9a-f]{64}$/i.test(String(env.XENO_RESEARCH_SIGNING_KEY || '')) ? String(env.XENO_RESEARCH_SIGNING_KEY) : null };
}
async function executor({ image } = {}) {
  const e = await engine(), c = boxConfig();
  return new e.BoxExecutor({ url: c.url, token: c.token, image, fetchImpl: FETCH || boxFetch({ ca: c.ca }) });
}
/** The image a run uses is the one its lock was resolved for (`# image:` in the lock header). */
export const imageOfLock = (lock) => (String(lock || '').match(/^# image: (.+)$/m) || [])[1]?.trim() || undefined;

/**
 * The gate, asked before a run is queued AND again when it starts. Returns null (go) or { code, reason }.
 * Every unknown -- no configuration, Box not answering, a malformed answer -- is a refusal.
 */
export async function runGate(workspaceId) {
  const c = boxConfig();
  if (!c.configured) return { code: 'box_not_configured', reason: 'XENO Box is not configured on this platform (XENO_BOX_URL and XENO_BOX_TOKEN are not set), so nothing can run.' };
  if (c.caMissing) return { code: 'box_not_configured', reason: 'XENO_BOX_CA_FILE is set but cannot be read, so Box’s certificate cannot be checked.' };
  if (!c.signingKey) return { code: 'signing_unavailable', reason: 'The research signing key (XENO_RESEARCH_SIGNING_KEY) is not set, so a run could not be signed.' };
  let caps;
  try {
    const r = await (await executor()).call('GET', '/v1/capabilities');
    if (r.status !== 200 || !r.json || typeof r.json !== 'object') return { code: 'box_unreachable', reason: `XENO Box answered ${r.status} for its capabilities.` };
    caps = r.json;
  } catch (e) { return { code: 'box_unreachable', reason: `XENO Box could not be reached: ${String(e.message || e).slice(0, 200)}` }; }
  const state = caps.host_safety?.state ?? 'unknown';
  const inside = !!c.internalWorkspaceId && String(workspaceId).toLowerCase() === c.internalWorkspaceId;
  if (state !== 'qualified' && !inside) {
    return { code: 'box_unqualified', reason: `XENO Box reports host safety "${state}". Until it is qualified, notebooks run only for the XENO workspace.` };
  }
  return null;
}

// ───────────────────────────── who is asking, and what they may do

async function principalOf(db, actor) {
  const p = await resolvePrincipal(db, actor.id);
  if (!p?.usable) fail('Not allowed', 'actor_unavailable', 403);
  const isAgent = p.kind === 'agent';
  const accountable = isAgent ? (p.ownerUserId || p.owner?.id || p.owner_user_id) : actor.id;
  if (!accountable) fail('Not allowed', 'actor_unavailable', 403);
  return { id: String(actor.id), kind: isAgent ? 'agent' : p.kind, accountable: String(accountable) };
}
const allowed = async (db, userId, object, relation) => (await check(db, { object, relation, subject: `user:${userId}` })).allowed;

/** A project the reader can see, with its workspace. `need` = viewer | editor. Not visible reads as absent. */
async function projectFor(db, who, projectId, need = 'viewer') {
  if (!UUID.test(String(projectId || ''))) throw notFound('Project not found');
  const pid = String(projectId).toLowerCase();
  const p = (await db.query(`SELECT p.id, p.name, COALESCE(p.workspace_id, (SELECT w.id FROM workspaces w WHERE w.owner_user_id = p.owner_user_id
      AND w.workspace_type = 'personal' ORDER BY w.created_at LIMIT 1)) AS workspace_id FROM chat_projects p WHERE p.id=$1`, [pid])).rows[0];
  if (!p || !p.workspace_id || !(await allowed(db, who.accountable, `project:${pid}`, 'viewer'))) throw notFound('Project not found');
  if (need === 'editor' && !(await allowed(db, who.accountable, `project:${pid}`, 'editor'))
    && !(await allowed(db, who.accountable, `workspace:${p.workspace_id}`, 'admin'))) fail('Only someone who edits this project can do that', 'not_allowed', 403);
  return { id: pid, name: p.name, workspaceId: String(p.workspace_id) };
}
async function notebookRow(db, who, id, need) {
  if (!NB_ID.test(String(id || ''))) throw notFound('Notebook not found');
  const nb = (await db.query('SELECT * FROM research_notebooks WHERE id=$1', [id])).rows[0];
  if (!nb) throw notFound('Notebook not found');
  try { await projectFor(db, who, String(nb.project_id), need); } catch (e) { if (e.status === 403) throw e; throw notFound('Notebook not found'); }
  return nb;
}
async function runRow(db, who, id, need) {
  if (!RUN_ID.test(String(id || ''))) throw notFound('Run not found');
  const r = (await db.query('SELECT * FROM research_runs WHERE id=$1', [id])).rows[0];
  if (!r) throw notFound('Run not found');
  try { await projectFor(db, who, String(r.project_id), need); } catch (e) { if (e.status === 403) throw e; throw notFound('Run not found'); }
  return r;
}

// ───────────────────────────── shapes

const shapeNotebook = (n, extra = {}) => ({ id: n.id, projectId: String(n.project_id), workspaceId: String(n.workspace_id), title: n.title,
  notebookSha256: n.notebook_sha256, locked: !!n.lock_text, lockedAt: n.locked_at, image: imageOfLock(n.lock_text) || null,
  createdBy: String(n.created_by_user_id), createdAt: n.created_at, updatedAt: n.updated_at, ...extra });
const shapeRun = (r) => ({ id: r.id, notebookId: r.notebook_id, projectId: String(r.project_id), kind: r.kind, status: r.status,
  reasonCode: r.reason_code, reason: r.reason, verifyOf: r.verify_of_run_id, verdict: r.verdict, comparison: r.comparison,
  complete: r.provenance ? !!r.provenance.complete : null, runSha256: r.provenance?.run_sha256 || null,
  cells: r.provenance ? r.provenance.cells : null, executor: r.provenance?.executor || null, signed: !!r.signature,
  requestedBy: String(r.requested_by_user_id), createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at });

// ───────────────────────────── notebooks

export async function createNotebook(db, actor, projectId, { title, notebook } = {}) {
  const who = await principalOf(db, actor);
  const p = await projectFor(db, who, projectId, 'editor');
  const t = String(title || '').trim();
  if (!t || t.length > 200) fail('A notebook needs a title of at most 200 characters', 'invalid_title');
  const e = await engine();
  let nb;
  try { nb = e.parseNotebook(typeof notebook === 'string' ? notebook : JSON.stringify(notebook ?? null)); } catch (err) { fail(`Not a notebook: ${err.message}`, 'invalid_notebook'); }
  const text = JSON.stringify(nb);
  if (text.length > 8_000_000) fail('The notebook is larger than 8 MB', 'notebook_too_large', 413);
  const row = (await db.query(`INSERT INTO research_notebooks (project_id, workspace_id, title, notebook, notebook_sha256, created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [p.id, p.workspaceId, t, text, sha(text), who.accountable])).rows[0];
  return { notebook: shapeNotebook(row) };
}

export async function listNotebooks(db, actor, projectId) {
  const who = await principalOf(db, actor);
  const p = await projectFor(db, who, projectId);
  const rows = (await db.query(`SELECT n.*, (SELECT row_to_json(r) FROM research_runs r WHERE r.notebook_id = n.id ORDER BY r.created_at DESC LIMIT 1) AS last_run
    FROM research_notebooks n WHERE n.project_id=$1 ORDER BY n.updated_at DESC LIMIT 200`, [p.id])).rows;
  return { project: { id: p.id, name: p.name }, notebooks: rows.map((n) => shapeNotebook(n, { lastRun: n.last_run ? shapeRun(n.last_run) : null })) };
}

export async function getNotebook(db, actor, notebookId) {
  const who = await principalOf(db, actor);
  const nb = await notebookRow(db, who, notebookId);
  const e = await engine();
  const runs = (await db.query('SELECT * FROM research_runs WHERE notebook_id=$1 ORDER BY created_at DESC LIMIT 50', [nb.id])).rows;
  let stale = null;
  if (nb.lock_text) { try { stale = e.lockIsStale(nb.lock_text, nb.notebook); } catch { stale = true; } }
  const lastDone = runs.find((r) => r.status === 'done' && r.output_notebook);
  const cells = (nb.notebook.cells || []).map((c, index) => ({ index, type: c.cell_type, source: Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''),
    outputs: lastDone ? (lastDone.output_notebook.cells?.[index]?.outputs || []) : (c.outputs || []) }));
  const canEdit = await allowed(db, who.accountable, `project:${nb.project_id}`, 'editor') || await allowed(db, who.accountable, `workspace:${nb.workspace_id}`, 'admin');
  return { notebook: shapeNotebook(nb, { lockStale: stale, cells, outputsFromRun: lastDone?.id || null, canEdit }), runs: runs.map(shapeRun) };
}

// ───────────────────────────── runs: request (gated), execute (queued, capped), read, verify, export

async function insertRun(db, nb, who, kind, { verifyOf = null, refusal = null, recheck = null } = {}) {
  const status = refusal ? 'refused' : 'queued';
  return (await db.query(`INSERT INTO research_runs (notebook_id, project_id, workspace_id, kind, status, reason_code, reason, verify_of_run_id, notebook_sha256, requested_by_user_id, recheck, finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $5='refused' THEN now() END) RETURNING *`,
  [nb.id, nb.project_id, nb.workspace_id, kind, status, refusal?.code || null, refusal?.reason || null, verifyOf, nb.notebook_sha256, who.accountable,
    recheck ? JSON.stringify(recheck) : null])).rows[0];
}
async function request(db, who, nb, kind, opts = {}) {
  const refusal = await runGate(nb.workspace_id);
  const row = await insertRun(db, nb, who, kind, { ...opts, refusal });
  if (!refusal) kick(db);
  return { run: shapeRun(row) };
}

export async function requestLock(db, actor, notebookId) {
  const who = await principalOf(db, actor);
  return request(db, who, await notebookRow(db, who, notebookId, 'editor'), 'lock');
}
export async function requestRun(db, actor, notebookId) {
  const who = await principalOf(db, actor);
  return request(db, who, await notebookRow(db, who, notebookId, 'editor'), 'run');
}
/** Re-run a recorded run in Box and compare: reproduced, changed (and what moved) or not-reproduced. */
export async function requestVerify(db, actor, runId, { recheck = null } = {}) {
  const who = await principalOf(db, actor);
  const r = await runRow(db, who, runId, 'editor');
  if (r.status !== 'done' || r.kind === 'lock' || !r.provenance) fail('Only a finished run can be verified', 'run_not_verifiable', 409);
  const nb = (await db.query('SELECT * FROM research_notebooks WHERE id=$1', [r.notebook_id])).rows[0];
  return request(db, who, nb, 'verify', { verifyOf: r.id, recheck });
}

/** A run with its signature checked against the platform's research key, now. */
export async function getRun(db, actor, runId) {
  const who = await principalOf(db, actor);
  const r = await runRow(db, who, runId);
  const nb = (await db.query('SELECT id, title, project_id FROM research_notebooks WHERE id=$1', [r.notebook_id])).rows[0];
  return { run: shapeRun(r), notebook: { id: nb.id, title: nb.title, projectId: String(nb.project_id) }, signature: await signatureCheck(r) };
}
export async function signatureCheck(r) {
  if (!r.provenance) return { state: 'none' };
  if (!r.signature) return { state: 'unsigned', valid: false, reason: 'unsigned' };
  const e = await engine(), key = boxConfig().signingKey;
  const expected = key ? e.publicKeyHex(key) : null;
  const v = e.verifyRecord({ ...r.provenance, signature: r.signature }, expected || undefined);
  return { state: v.valid ? 'valid' : 'invalid', valid: !!v.valid, reason: v.reason || null, keyId: r.signature.key_id || null, checkedAgainst: expected ? 'platform-key' : 'embedded-key' };
}

/** The export package as one JSON download: notebook with outputs, lock, provenance (+ W3C PROV), SHA256SUMS. */
export async function exportRun(db, actor, runId) {
  const who = await principalOf(db, actor);
  const r = await runRow(db, who, runId);
  if (r.status !== 'done' || !r.provenance) fail('Only a finished run can be exported', 'run_not_exportable', 409);
  const nb = (await db.query('SELECT title, lock_text FROM research_notebooks WHERE id=$1', [r.notebook_id])).rows[0];
  const e = await engine();
  const name = `${String(nb.title).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'notebook'}.ipynb`;
  const signed = { ...r.provenance, signature: r.signature };
  const files = { [name]: `${JSON.stringify(r.output_notebook, null, 1)}\n`, 'provenance.json': `${JSON.stringify(signed, null, 2)}\n`,
    'provenance.prov.json': `${JSON.stringify(e.toProvJson(r.provenance, name), null, 2)}\n` };
  if (nb.lock_text) files[`${name}.lock`] = nb.lock_text;
  files.SHA256SUMS = `${Object.entries(files).map(([p, b]) => `${sha(b)}  ${p}`).join('\n')}\n`;
  return { name: `${name.replace(/\.ipynb$/, '')}-${r.id}.research.json`, format: 'xeno-research.export/1', run: r.id, files };
}

export async function listRuns(db, actor, projectId) {
  const who = await principalOf(db, actor);
  const p = await projectFor(db, who, projectId);
  const rows = (await db.query(`SELECT r.*, n.title FROM research_runs r JOIN research_notebooks n ON n.id = r.notebook_id WHERE r.project_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [p.id])).rows;
  return { runs: rows.map((r) => ({ ...shapeRun(r), notebookTitle: r.title })) };
}

// The executor loop. One process claims queued runs under an advisory lock so the cap holds even if two callers
// kick at once: never more than MAX_CONCURRENT `running` rows. A run that was running when the process stopped
// cannot be resumed in Box, so it is failed as interrupted at startup -- never left looking alive.
const LOCK_KEY = 7_407_311;
let ACTIVE = new Set();
export function kick(db) { setImmediate(() => { drain(db).catch((e) => console.error('[research] drain', e)); }); }
export async function claimNext(db) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const running = Number((await c.query(`SELECT count(*)::int AS n FROM research_runs WHERE status='running'`)).rows[0].n);
    if (running >= MAX_CONCURRENT) { await c.query('COMMIT'); return null; }
    const r = (await c.query(`UPDATE research_runs SET status='running', started_at=now() WHERE id = (SELECT id FROM research_runs WHERE status='queued'
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0] || null;
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
export async function drain(db) {
  for (;;) {
    const r = await claimNext(db);
    if (!r) return;
    const job = execute(db, r).catch((e) => console.error('[research] run', r.id, e)).finally(() => { ACTIVE.delete(job); kick(db); });
    ACTIVE.add(job);
  }
}
/** Wait for every run this process started (tests). */
export async function settled() { while (ACTIVE.size) await Promise.all([...ACTIVE]); }
export async function recoverInterrupted(db) {
  await db.query(`UPDATE research_runs SET status='failed', reason_code='interrupted', reason='The platform restarted while this run was in Box; run it again.', finished_at=now() WHERE status='running'`);
  kick(db);
}

const finish = (db, id, fields) => {
  const keys = Object.keys(fields);
  return db.query(`UPDATE research_runs SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, finished_at=now() WHERE id=$1`,
    [id, ...keys.map((k) => (fields[k] !== null && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k]))]);
};

async function execute(db, run) {
  const nb = (await db.query('SELECT * FROM research_notebooks WHERE id=$1', [run.notebook_id])).rows[0];
  const refusal = await runGate(nb.workspace_id);      // asked again: a qualification can lapse while a run waits
  if (refusal) return finish(db, run.id, { status: 'refused', reason_code: refusal.code, reason: refusal.reason });
  const e = await engine();
  let tmp = null;
  try {
    if (run.kind === 'lock') {
      const requirements = e.requirementsText(nb.notebook);
      const box = await executor();
      const r = await box.resolve({ requirements });
      const lock = e.lockFromCompiled({ ...r, requirements });
      await db.query('UPDATE research_notebooks SET lock_text=$2, locked_at=now(), updated_at=now() WHERE id=$1', [nb.id, lock]);
      return finish(db, run.id, { status: 'done' });
    }
    if (e.declaredInputs(nb.notebook).length) fail('This notebook declares input files; uploading inputs to a notebook is not built yet, so it cannot run here.', 'inputs_unsupported');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xeno-research-'));
    const box = await executor({ image: imageOfLock(nb.lock_text) });
    const { notebook, provenance } = await e.runNotebook({ notebook: nb.notebook, notebookDir: tmp, executor: box, lock: nb.lock_text || null });
    const signed = e.signRecord(provenance, boxConfig().signingKey);
    const fields = { status: 'done', provenance, signature: signed.signature, output_notebook: notebook };
    if (run.kind === 'verify') {
      const recorded = (await db.query('SELECT provenance FROM research_runs WHERE id=$1', [run.verify_of_run_id])).rows[0];
      const cmp = e.compareRuns(recorded.provenance, provenance);
      fields.verdict = cmp.verdict; fields.comparison = cmp;
    }
    await finish(db, run.id, fields);
    if (run.recheck) await recordClaimVerdict(db, run, provenance);
  } catch (err) {
    await finish(db, run.id, { status: 'failed', reason_code: err.code || 'run_failed', reason: String(err.message || err).slice(0, 4000) });
    if (run.recheck) await recordClaimVerdict(db, run, null, err).catch(() => {});
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ───────────────────────────── claims: one project-scoped Corpus tenet per claimed cell

const claimKey = (nbId, cell) => `research#${nbId}-cell-${cell}`;
const isClaim = (t) => t?.provenance?.research?.notebook && Number.isInteger(t.provenance.research.cell);
/** held / lapsed / unobserved: a claim with no verdict, or whose check could not run, is never shown as passing. */
const claimState = (t) => (t.latest?.state === 'held' && !t.latest.stale ? 'held' : t.latest?.state === 'lapsed' ? 'lapsed' : 'unobserved');

/** Claim a cell of a finished run: its recorded output hash becomes the tenet's expect. A person decides (Corpus). */
export async function claimCell(db, actor, runId, { cell, claim } = {}) {
  const who = await principalOf(db, actor);
  const r = await runRow(db, who, runId, 'editor');
  if (r.status !== 'done' || !r.provenance) fail('Only a finished run can be claimed', 'run_not_claimable', 409);
  const rec = r.provenance.cells.find((c) => c.index === Number(cell));
  if (!rec) fail(`Cell ${cell} is not a code cell of this notebook`, 'invalid_cell');
  if (rec.status !== 'ok') fail(`Cell ${cell} did not complete in that run; only a completed result can be claimed`, 'cell_not_ok', 409);
  const nb = (await db.query('SELECT id, title FROM research_notebooks WHERE id=$1', [r.notebook_id])).rows[0];
  const tenet = await corpus.authorTenet(db, actor, { kind: 'project', id: String(r.project_id) }, {
    key: claimKey(nb.id, rec.index), kind: 'tenet', subject: `research:${nb.id}`,
    claim: String(claim || `Cell ${rec.index} of “${nb.title}” reproduces its recorded output in XENO Box`).slice(0, 4000),
    assay: { kind: 'manual', run: `XENO Research verify ${r.id} (cell ${rec.index}) in XENO Box` }, expect: rec.output_sha256,
    expireAfter: '720h', source: `research:${r.id}`, provenance: { research: { notebook: nb.id, run: r.id, cell: rec.index } },
  });
  return { claim: { ...tenet, cell: rec.index, notebookId: nb.id, runId: r.id, state: claimState(tenet) } };
}

export async function listClaims(db, actor, projectId) {
  const c = await corpus.readCorpus(db, actor, { kind: 'project', id: projectId });
  return { claims: c.tenets.filter(isClaim).map((t) => ({ id: t.id, key: t.key, claim: t.claim, notebookId: t.provenance.research.notebook,
    runId: t.provenance.research.run, cell: t.provenance.research.cell, expect: t.expect, state: claimState(t), latest: t.latest, freshness: t.freshness })) };
}
export async function getClaim(db, actor, tenetId) {
  const h = await corpus.verdictHistory(db, actor, tenetId);
  if (!isClaim(h.tenet)) throw notFound('Claim not found');
  const t = h.tenet;
  return { claim: { id: t.id, key: t.key, claim: t.claim, notebookId: t.provenance.research.notebook, runId: t.provenance.research.run,
    cell: t.provenance.research.cell, expect: t.expect, state: claimState(t), freshness: t.freshness }, verdicts: h.verdicts };
}
/** Re-check a claim: re-run its notebook in Box; the verdict is recorded through Corpus under `admissionId`. */
export async function recheckClaim(db, actor, tenetId, { admissionId } = {}) {
  if (!UUID.test(String(admissionId || ''))) fail('A re-check is an admitted run: name the run admission it runs under', 'admission_required');
  const { claim } = await getClaim(db, actor, tenetId);
  return requestVerify(db, actor, claim.runId, { recheck: { tenetId: claim.id, cell: claim.cell, expect: claim.expect, admissionId: String(admissionId), actorId: String(actor.id) } });
}
async function recordClaimVerdict(db, run, provenance, err = null) {
  const rc = run.recheck;
  const cell = provenance?.cells.find((c) => c.index === rc.cell);
  const state = err || !cell ? 'error' : cell.status === 'ok' && cell.output_sha256 === rc.expect ? 'held' : 'lapsed';
  const { getSigningKey } = await import('../utils/oidcProvider.js');
  const k = await getSigningKey(db);
  await corpus.recordVerdict(db, { id: rc.actorId }, rc.tenetId, { admissionId: rc.admissionId, state,
    observed: err ? String(err.message || err).slice(0, 4000) : (cell?.output_sha256 ?? 'cell not run'), instrument: `XENO Research verify ${run.id} in XENO Box` },
  { signingKey: { kid: k.kid, privatePem: k.privatePem } });
}

// ───────────────────────────── the mode home

/** Recent notebooks, runs needing attention, lapsed claims -- across the projects the reader can see. */
export async function home(db, actor) {
  const who = await principalOf(db, actor);
  const nbs = (await db.query(`SELECT n.*, p.name AS project_name FROM research_notebooks n JOIN chat_projects p ON p.id = n.project_id
    ORDER BY n.updated_at DESC LIMIT 200`)).rows;
  const seen = new Map();
  const visible = async (pid) => { if (!seen.has(pid)) seen.set(pid, await allowed(db, who.accountable, `project:${pid}`, 'viewer')); return seen.get(pid); };
  const mine = [];
  for (const n of nbs) if (await visible(String(n.project_id))) mine.push(n);
  const ids = mine.map((n) => n.id);
  const attention = ids.length ? (await db.query(`SELECT r.*, n.title FROM research_runs r JOIN research_notebooks n ON n.id = r.notebook_id
    WHERE r.notebook_id = ANY($1) AND (r.status IN ('failed','refused','queued','running') OR r.verdict IN ('changed','not-reproduced'))
    AND r.created_at > now() - interval '30 days' ORDER BY r.created_at DESC LIMIT 20`, [ids])).rows : [];
  const lapsed = [];
  for (const pid of [...new Set(mine.map((n) => String(n.project_id)))].slice(0, 20)) {
    try { for (const c of (await listClaims(db, actor, pid)).claims) if (c.state !== 'held') lapsed.push({ ...c, projectId: pid }); } catch { /* not readable */ }
  }
  return { notebooks: mine.slice(0, 12).map((n) => shapeNotebook(n, { projectName: n.project_name })),
    attention: attention.map((r) => ({ ...shapeRun(r), notebookTitle: r.title })), claims: lapsed.slice(0, 20),
    box: { configured: boxConfig().configured } };
}
