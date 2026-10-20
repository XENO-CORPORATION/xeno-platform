/**
 * XENO Corpus on the platform, end to end on a real Postgres and the REAL routers.
 *
 *   1. scopes: a workspace, a division inside it and a project owned by that division each get a corpus;
 *      a stranger reads every one as 404
 *   2. nesting (D227/D228): doctrine written on the workspace binds the project; the project's tenets reach the
 *      workspace and division BY REFERENCE; a wider scope asserting about the project's subject is refused,
 *      by the service AND by the database when the service is bypassed
 *   3. ratification (D211): an agent proposes over XENO MCP; nothing is applied; the agent cannot author or
 *      ratify; a viewer cannot ratify; a person admin ratifies and only then the tenet exists; the database
 *      refuses an agent ratification written directly
 *   4. verdicts: refused without an admission, refused under someone else's or a revoked admission; signed with
 *      the platform key (verifies against the public key), hash-chained, append-only
 *   5. a Canvas tenet card resolves live for a reader and is `missing` for a stranger
 *   6. a project's `.xeno/corpus/` syncs through its directory binding as a read mirror
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/xeno-corpus.test.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import chatRoutes from '../routes/chatRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import workforceDivisionRoutes from '../routes/workforceDivisionRoutes.js';
import { createCorpusRouter } from '../routes/corpusRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { admitAccountRun, readRunnablePin } from '../services/workforceRunAdmission.js';
import { revokeRun } from '../services/workforceRunAuthority.js';
import { bindProjectDirectory } from '../services/projectDirectoryBindings.js';
import * as corpus from '../services/xenoCorpus.js';
import * as corpusMcp from '../services/corpusMcp.js';
import * as canvases from '../services/canvases.js';
import * as xenoMcp from '../services/xenoMcp.js';
import { gatherSources } from '../services/workspaceArchitect.js';
import { getSigningKey } from '../utils/oidcProvider.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const rejects = async (p, re) => { try { await p; return false; } catch (e) { return re.test(String(e.code || '') + ' ' + String(e.message || '')); } };

const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const signingKey = { kid: 'corpus-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('xc-ada'), bob = await mk('xc-bob'), eve = await mk('xc-eve');
  await addGrant(pool, ada, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:xc-ada' });
  await addGrant(pool, bob, { amountMicro: 100_000_000, kind: 'paid', sourceRef: 'seed:xc-bob' });
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/chat', (req, _r, n) => { req.user = { id: req.headers['x-as'] || ada }; n(); }, chatRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/divisions', authMiddleware, personOnly, workforceDivisionRoutes);
  app.use('/api/corpus', authMiddleware, createCorpusRouter({ signingKey: async () => signingKey }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = session(ada), B = session(bob), E = session(eve);
  const tenet = (key, extra = {}) => ({ key, claim: `Claim ${key}`, assay: { kind: 'node', run: `node assays/${key}.mjs` }, expect: '0', cadence: '24h', warnAfter: '72h', expireAfter: '240h', ...extra });

  try {
    const ws = (await call('GET', '/api/divisions', { token: A })).j.workspaceId;
    await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'viewer', subject: `user:${bob}` }] });
    const dev = (await call('POST', '/api/divisions', { token: A, body: { name: 'Dev' } })).j.division;
    const pr = await call('POST', '/api/chat/projects', { body: { name: 'Engine' }, headers: { 'x-as': ada } });
    const project = String((pr.j.project || pr.j.data || pr.j).id);
    await writeTuples(pool, { writes: [{ object: `project:${project}`, relation: 'viewer', subject: `user:${bob}` }] });
    await call('PUT', `/api/divisions/projects/${project}`, { token: A, body: { divisionId: dev.id } });
    const agent = (await call('POST', '/api/agents', { token: A, body: { name: 'Assayer', description: 'Runs assays', instructions: 'Report what you see.', divisionId: dev.id } })).j.agent;
    const agentUser = String((await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].user_id);

    // ── 1. scopes and access
    const W = await call('GET', `/api/corpus/workspace/${ws}`, { token: A });
    ok(W.s === 200 && W.j.corpus.subject === `workspace:${ws}` && W.j.canManage === true, 'the workspace has a corpus its admin manages');
    ok((await call('GET', `/api/corpus/division/${dev.id}`, { token: A })).j.corpus.scope === 'division', 'a division has its own corpus');
    ok((await call('GET', `/api/corpus/project/${project}`, { token: B })).j.canManage === false, 'a viewer reads the project corpus but does not manage it');
    for (const [k, id] of [['workspace', ws], ['division', dev.id], ['project', project]]) {
      ok((await call('GET', `/api/corpus/${k}/${id}`, { token: E })).s === 404, `a stranger reads the ${k} corpus as absent`);
    }
    ok((await call('GET', `/api/corpus/project/${crypto.randomUUID()}`, { token: A })).s === 404, 'a missing scope is the same 404');

    // ── 2. nesting
    const doc = await call('POST', `/api/corpus/workspace/${ws}/tenets`, { token: A, body: { key: 'edit-the-existing-document', kind: 'doctrine', claim: 'Edit the existing document; never write a second one beside it.' } });
    ok(doc.s === 201 && doc.j.tenet.kind === 'doctrine', 'a person writes workspace doctrine');
    const own = await call('POST', `/api/corpus/project/${project}/tenets`, { token: A, body: tenet('engine#builds') });
    ok(own.s === 201 && own.j.tenet.subject === `project:${project}`, 'a project tenet defaults to the project as its subject');
    const P = (await call('GET', `/api/corpus/project/${project}`, { token: A })).j;
    ok(P.inheritedDoctrine.some((d) => d.key === 'edit-the-existing-document' && d.from === `workspace:${ws}`), 'workspace doctrine is binding in the project (inherits DOWN)');
    const Wd = (await call('GET', `/api/corpus/workspace/${ws}`, { token: A })).j;
    const ref = Wd.aggregated.find((t) => t.key === 'engine#builds');
    ok(ref && ref.from === `project:${project}` && ref.claim === undefined && ref.assay === undefined, 'the project tenet reaches the workspace BY REFERENCE, without its content');
    ok((await call('GET', `/api/corpus/division/${dev.id}`, { token: A })).j.aggregated.some((t) => t.key === 'engine#builds'), 'and reaches the owning division');
    const up = await call('POST', `/api/corpus/workspace/${ws}/tenets`, { token: A, body: tenet('ws#about-project', { subject: `project:${project}` }) });
    ok(up.s === 400 && up.j.code === 'corpus_subject_outside_scope', 'the workspace may not name the project as its subject');
    await call('POST', `/api/corpus/project/${project}/tenets`, { token: A, body: tenet('engine#hub-version', { subject: 'xeno-hub' }) });
    const anc = await call('POST', `/api/corpus/division/${dev.id}/tenets`, { token: A, body: tenet('dev#hub-version', { subject: 'xeno-hub' }) });
    ok(anc.s === 409 && anc.j.code === 'corpus_ancestor_asserts_descendant_subject', 'D228: the division may not assert about a subject its project asserts');
    const wcid = (await pool.query(`SELECT id FROM corpus_corpora WHERE subject=$1`, [`workspace:${ws}`])).rows[0].id;
    ok(await rejects(pool.query(`INSERT INTO corpus_tenets (corpus_id, tenet_key, subject, claim, assay, expect, origin, content_hash, created_by_user_id)
      VALUES ($1,'raw#hub','xeno-hub','x','{"kind":"node","run":"x"}','0','authored',$2,$3)`, [wcid, 'a'.repeat(64), ada]), /corpus_ancestor_asserts_descendant_subject/),
    'the DATABASE refuses it too when the service is bypassed');
    await call('POST', `/api/corpus/workspace/${ws}/tenets`, { token: A, body: tenet('ws#site-locked', { subject: 'xenostudio.ai' }) });
    const down = await call('POST', `/api/corpus/project/${project}/tenets`, { token: A, body: tenet('engine#site', { subject: 'xenostudio.ai' }) });
    ok(down.s === 409 && down.j.code === 'corpus_subject_owned_by_ancestor', 'a project may not claim a subject the workspace already asserts');

    // ── 3. proposals and ratification
    const prop = await corpusMcp.callTool(pool, { id: agentUser }, 'propose', { scope: 'project', id: project, tenet: tenet('engine#tests-green'), rationale: 'The suite has been green for a week.' });
    const proposal = prop.structuredContent.proposal;
    ok(proposal.state === 'proposed', 'an agent proposes over XENO MCP');
    ok(!(await call('GET', `/api/corpus/project/${project}`, { token: A })).j.tenets.some((t) => t.key === 'engine#tests-green'), 'a proposal is NOT applied');
    ok(await rejects(corpus.authorTenet(pool, { id: agentUser }, { kind: 'project', id: project }, tenet('engine#agent-wrote')), /agent_must_propose/), 'an agent cannot author a tenet');
    ok(await rejects(corpus.decideProposal(pool, { id: agentUser }, proposal.id, { decision: 'ratify' }), /human_must_decide/), 'an agent cannot ratify');
    const pcid = (await pool.query(`SELECT id FROM corpus_corpora WHERE subject=$1`, [`project:${project}`])).rows[0].id;
    ok(await rejects(pool.query(`INSERT INTO corpus_tenets (corpus_id, tenet_key, subject, claim, assay, expect, origin, content_hash, created_by_user_id)
      VALUES ($1,'raw#agent',$2,'x','{"kind":"node","run":"x"}','0','authored',$3,$4)`, [pcid, `project:${project}`, 'a'.repeat(64), agentUser]), /corpus_agent_cannot_write_tenet/),
    'the database refuses an agent-written tenet');
    ok(await rejects(pool.query(`UPDATE corpus_proposals SET state='ratified', decided_by_user_id=$2, decided_at=now() WHERE id=$1`, [proposal.id, agentUser]), /corpus_ratification_requires_a_person/),
      'the database refuses an agent ratification written directly');
    ok((await call('POST', `/api/corpus/proposals/${proposal.id}/decision`, { token: B, body: { decision: 'ratify' } })).s === 403, 'a viewer cannot ratify');
    ok((await call('POST', `/api/corpus/proposals/${proposal.id}/decision`, { token: E, body: { decision: 'ratify' } })).s === 404, 'a stranger does not see the proposal');
    const rat = await call('POST', `/api/corpus/proposals/${proposal.id}/decision`, { token: A, body: { decision: 'ratify', note: 'Agreed.' } });
    ok(rat.s === 200 && rat.j.proposal.state === 'ratified' && rat.j.tenet.origin === 'ratified', 'a person admin ratifies; the tenet exists only now');
    ok((await call('POST', `/api/corpus/proposals/${proposal.id}/decision`, { token: A, body: { decision: 'reject' } })).j.code === 'proposal_decided', 'a decided proposal stays decided');
    const sup = await call('POST', `/api/corpus/project/${project}/proposals`, { token: B, body: { action: 'supersede', targetTenetId: rat.j.tenet.id, tenet: tenet('engine#tests-green', { claim: 'All tests green on main.' }), rationale: 'Sharper.' } });
    const supRat = await call('POST', `/api/corpus/proposals/${sup.j.proposal.id}/decision`, { token: A, body: { decision: 'ratify' } });
    const after = (await call('GET', `/api/corpus/project/${project}`, { token: A })).j.tenets.filter((t) => t.key === 'engine#tests-green');
    ok(supRat.s === 200 && after.length === 1 && after[0].claim === 'All tests green on main.', 'a ratified supersede replaces the tenet');

    // ── 4. verdicts
    const def = (await pool.query('SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].workforce_resource_id;
    const bobAgent = (await call('POST', '/api/agents', { token: B, body: { name: 'Bob assayer', description: 'Runs assays', instructions: 'Report.' } })).j.agent;
    const bobDef = (await pool.query('SELECT workforce_resource_id FROM agent_identities WHERE public_id = $1', [bobAgent.id])).rows[0].workforce_resource_id;
    const admit = async (who, resourceId = def) => {
      const ctx = { actorUserId: who, clientId: 'corpus-test' };
      const target = { kind: 'personal', ownerUserId: who };
      const pin = await readRunnablePin(pool, ctx, { agent: { resourceId }, target });
      return (await admitAccountRun(pool, ctx, { operationId: crypto.randomUUID(), agent: pin.agent, target, capabilities: pin.terms.definition, budget: { ceilingMicro: '2000000' }, taskRef: 'T-1' })).admission.admissionId;
    };
    const admission = await admit(ada);
    const tid = own.j.tenet.id;
    ok((await call('POST', `/api/corpus/tenets/${tid}/verdicts`, { token: A, body: { state: 'held', observed: '0' } })).j.code === 'admission_required', 'a verdict without a run admission is refused');
    const v1 = await call('POST', `/api/corpus/tenets/${tid}/verdicts`, { token: A, body: { admissionId: admission, state: 'held', observed: '0', instrument: 'node assays/engine#builds.mjs' } });
    ok(v1.s === 201 && v1.j.verdict.prevHash === null, 'an admitted assay run records a verdict');
    const v2 = await call('POST', `/api/corpus/tenets/${tid}/verdicts`, { token: A, body: { admissionId: admission, state: 'lapsed', observed: '2' } });
    ok(v2.j.verdict.prevHash === v1.j.verdict.hash, 'verdicts are hash-chained');
    const row = (await pool.query('SELECT * FROM corpus_verdicts WHERE id=$1', [v2.j.verdict.id])).rows[0];
    const trow = (await pool.query('SELECT * FROM corpus_tenets WHERE id=$1', [tid])).rows[0];
    ok(corpus.verifyVerdict(row, trow, keys.publicKey), 'the signature verifies against the platform public key');
    ok(!corpus.verifyVerdict({ ...row, observed: '0' }, trow, keys.publicKey), 'and fails when a field is altered');
    const bobAdmission = await admit(bob, bobDef);
    ok((await call('POST', `/api/corpus/tenets/${tid}/verdicts`, { token: A, body: { admissionId: bobAdmission, state: 'held' } })).s === 403, 'someone else’s admission is refused');
    ok(await rejects(pool.query(`INSERT INTO corpus_verdicts (tenet_id, tenet_content_hash, state, admission_id, recorded_by_user_id, reported_by_user_id, prev_hash, hash, signing_kid, signature)
      VALUES ($1,$2,'held',$3,$4,$4,$5,$6,'k','s')`, [tid, trow.content_hash, bobAdmission, ada, v2.j.verdict.hash, 'b'.repeat(64)]), /corpus_verdict_admission_not_yours/),
    'the database refuses another person’s admission too');
    await revokeRun(pool, { actorUserId: ada }, admission);
    ok((await call('POST', `/api/corpus/tenets/${tid}/verdicts`, { token: A, body: { admissionId: admission, state: 'held' } })).j.code === 'corpus_verdict_admission_revoked', 'a revoked admission records nothing further');
    ok(await rejects(pool.query('UPDATE corpus_verdicts SET observed=$2 WHERE id=$1', [v1.j.verdict.id, 'forged']), /append_only/), 'verdicts are append-only');
    const hist = await call('GET', `/api/corpus/tenets/${tid}/verdicts`, { token: B });
    ok(hist.s === 200 && hist.j.verdicts.length === 2 && hist.j.verdicts[0].state === 'lapsed', 'a reader sees the history, newest first');
    ok((await call('GET', `/api/corpus/tenets/${tid}/verdicts`, { token: E })).s === 404, 'a stranger does not');
    const assess = await corpusMcp.callTool(pool, { id: agentUser }, 'assess', { scope: 'workspace', id: ws });
    ok(assess.structuredContent.tenets.some((t) => t.key === 'engine#builds' && t.state === 'lapsed'), 'corpus.assess reports the lapse, aggregated up to the workspace');
    const q = await corpusMcp.callTool(pool, { id: agentUser }, 'query', { scope: 'project', id: project, q: 'existing document' });
    ok(q.structuredContent.inheritedDoctrine.length === 1 && q.structuredContent.tenets.length === 0, 'corpus.query searches own tenets and inherited doctrine');

    // ── 5. canvas verdict card
    const cv = await canvases.createCanvas(pool, { id: ada }, { name: 'Truth', projectId: project });
    const saved = await canvases.saveCanvas(pool, { id: ada }, cv.id, { revision: cv.revision, content: { nodes: [{ id: 'n1', type: 'xeno-ref', ref: { kind: 'tenet', id: tid }, x: 0, y: 0, width: 260, height: 120 }], edges: [] } });
    const card = saved.records.tenets[tid];
    ok(card && card.key === 'engine#builds' && card.state === 'lapsed' && card.freshness === 'fresh', 'a tenet on the Canvas is a live verdict card');
    const stranger = await corpus.resolveTenetCards(pool, { id: eve }, [tid]);
    ok(stranger[tid].missing === true && !JSON.stringify(stranger).includes('engine'), 'a reader who cannot open it gets `missing`, never its name');

    // ── 6. import through the directory binding
    const auth = { kind: 'oidc', dpopJkt: 'J'.repeat(43), scope: 'projects:read projects:write', clientId: 'xeno-agent-interface' };
    const binding = await bindProjectDirectory(pool, { userId: ada, auth, projectId: project, rootFamily: 'windows', root: 'D:\\WORK\\engine' });
    const bindingId = binding.id || binding.binding?.id;
    const files = [tenet('repo#lint-clean'), tenet('repo#hub', { subject: 'xenostudio.ai' })];
    const imp = await corpus.importFromDirectory(pool, auth, project, { bindingId, tenets: files });
    ok(imp.imported.includes('repo#lint-clean') && imp.refused.some((r) => r.key === 'repo#hub' && r.code === 'corpus_subject_owned_by_ancestor'), 'the bound installation syncs `.xeno/corpus/`; nesting still applies');
    const again = await corpus.importFromDirectory(pool, auth, project, { bindingId, tenets: [tenet('repo#lint-clean')] });
    ok(again.unchanged.includes('repo#lint-clean') && again.imported.length === 0, 'an unchanged file is unchanged');
    const gone = await corpus.importFromDirectory(pool, auth, project, { bindingId, tenets: [] });
    ok(gone.retired.includes('repo#lint-clean'), 'a tenet removed from the directory is retired');
    ok(await rejects(corpus.importFromDirectory(pool, { ...auth, dpopJkt: 'K'.repeat(43) }, project, { bindingId, tenets: files }), /binding_not_found/), 'another installation cannot sync this binding');
    ok(await rejects(corpus.importFromDirectory(pool, { kind: 'jwt' }, project, { bindingId, tenets: files }), /sender_bound_installation_required/), 'a bearer session cannot sync at all');
    const imported = (await pool.query(`SELECT id FROM corpus_tenets WHERE binding_id=$1 LIMIT 1`, [bindingId])).rows[0];
    ok(imported && await rejects(corpus.propose(pool, { id: ada }, { kind: 'project', id: project }, { action: 'retire', targetTenetId: (await pool.query(`SELECT id FROM corpus_tenets WHERE binding_id=$1 AND superseded_at IS NULL`, [bindingId])).rows[0]?.id || imported.id, rationale: 'x' }), /imported_tenet_read_only|tenet_not_found/),
      'an imported tenet is changed in its directory, not here');

    // ── 7. agent capabilities: verdict history and record (under the owner's admission)
    const fresh = await admit(ada);
    const rec = await corpusMcp.callTool(pool, { id: agentUser }, 'record_verdict', { tenet: tid, admission: fresh, state: 'held', observed: '0', instrument: 'node assays/builds.mjs' });
    ok(rec.structuredContent.verdict.state === 'held' && rec.structuredContent.verdict.admissionId === fresh, 'an agent records a verdict under its owner’s run admission (corpus.verdict.record)');
    const recRow = (await pool.query('SELECT * FROM corpus_verdicts WHERE id=$1', [rec.structuredContent.verdict.id])).rows[0];
    ok(recRow.reported_by_user_id === agentUser && recRow.recorded_by_user_id === ada && corpus.verifyVerdict(recRow, trow, crypto.createPublicKey((await getSigningKey(pool)).privatePem)), 'it is reported by the agent, recorded for the owner, and verifies');
    ok(await rejects(corpusMcp.callTool(pool, { id: agentUser }, 'record_verdict', { tenet: tid, admission: bobAdmission, state: 'held' }), /admission_not_yours/), 'an agent cannot record under someone else’s admission');
    const hist2 = await corpusMcp.callTool(pool, { id: agentUser }, 'history', { tenet: tid });
    ok(hist2.structuredContent.verdicts.length === 3 && hist2.structuredContent.verdicts[0].state === 'held', 'an agent reads the signed history (corpus.verdict.list)');

    // ── 8. scope: proposing is a write, so a read-only workspace credential is refused
    const conn = { categories: ['corpus'] };
    const wtok = (scopes) => ({ id: agentUser, kind: 'agent', token: { audience: 'xeno-workspace', scopes, agentUserId: agentUser, ownerId: ada, workspaceId: null, via: 'key' } });
    const args = { scope: 'project', id: project, tenet: tenet('engine#scoped'), rationale: 'x' };
    const ro = await xenoMcp.callTool(pool, wtok(['workspace:read']), conn, 'corpus__proposal__create', args);
    ok(JSON.stringify(ro.result).includes('scope_missing'), 'a read-only (workspace:read) credential cannot propose');
    const rw = await xenoMcp.callTool(pool, wtok(['workspace:admin']), conn, 'corpus__proposal__create', args);
    ok(!JSON.stringify(rw.result).includes('scope_missing'), 'the workspace write scope passes the scope gate');
    const rq = await xenoMcp.callTool(pool, wtok(['workspace:read']), conn, 'corpus__corpus__query', { scope: 'project', id: project });
    ok(!JSON.stringify(rq.result).includes('scope_missing'), 'and workspace:read still reads');

    // ── 9. the Workspace architect reads a corpus as a source, cited by tenet id
    const src = await gatherSources(pool, { id: ada }, { sources: [{ kind: 'corpus', scope: 'project', id: project }] });
    const cited = src.passages.find((x) => x.chunkId === tid);
    ok(cited && cited.kind === 'corpus' && /engine#builds/.test(cited.text) && src.unavailable.length === 0, 'the architect gets the project’s tenets as passages, each cited by tenet id');
    ok(src.passages.some((x) => x.chunkId === doc.j.tenet.id), 'inherited doctrine reaches the architect too');
    const srcEve = await gatherSources(pool, { id: eve }, { sources: [{ kind: 'corpus', scope: 'project', id: project }] });
    ok(srcEve.passages.length === 0 && srcEve.unavailable.some((u) => u.kind === 'corpus'), 'a caller who cannot read the corpus gets it as unavailable, no text');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
