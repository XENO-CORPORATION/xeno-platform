/**
 * The INTERNAL release note (services/releaseInternalNotes.js + its template, scripts/record-deploy.mjs and the
 * history backfill scripts/draft-internal-notes.mjs), against a real Postgres.
 *
 *   - every deploy drafts one note automatically, from its PRs, with a deterministic template (no model)
 *   - the note says what changed, why (from PR bodies), features touched, migrations + down path, risks, switches,
 *     tests and how to roll back
 *   - the deploy redrafts its own note until someone edits it; an edit or a sign-off is never overwritten
 *   - STAFF ONLY: a customer, a customer's agent and a service account get "not found" from the service, the HTTP
 *     route and the agent tool, and the customer's What's new never carries a word of it
 *   - a staff agent edits a draft; only a HUMAN on staff signs off — the database refuses an agent too
 *   - every version is kept; editing a signed note puts it back to draft; stale edits are refused
 *   - the backfill is dry-run by default, marks rows drafted_from_history, and is idempotent with --confirm
 *
 *   node src/server/tests/release-internal-notes.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as rel from '../services/releaseRecord.js';
import * as inotes from '../services/releaseInternalNotes.js';
import * as tpl from '../services/releaseInternalNoteTemplate.js';
import * as relMcp from '../services/releasesMcp.js';
import releaseRoutes from '../routes/releaseRoutes.js';
import { collectNoteSources } from '../../../scripts/lib/internal-note-sources.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

const PR_BODY = `## Why
Customers could not reach XENO privately, so support lived in public threads.

## What
- a private lane

## Tests
- npm run test:support-tickets (real Postgres)
- mutation-checked: removing the filter fails 3 checks

## Risks
- ⚠️ mail only goes out once SUPPORT_EMAILS=true is set on the box

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

async function main() {
  await runAllMigrations(pool);
  // ── the template alone: deterministic and complete
  const deployFacts = { service: 'backend', sha: 'bbbb222', previousSha: 'aaaa111', mode: 'swap', status: 'ok', prs: [901, 902], migrations: ['20261101-a.sql', '20261101-b.sql'], rollbackPoint: 'xeno-platform-backend:rollback' };
  const srcFacts = {
    prs: [{ number: 901, title: 'feat(support): private lane', body: PR_BODY, files: ['src/server/services/support.js', 'src/server/tests/support.test.mjs'] },
      { number: 902, title: 'fix: typo', body: '', files: ['README.md'] }],
    migrations: [{ name: '20261101-a.sql', text: '-- UP\nCREATE TABLE a(x int);\n-- DOWN\nDROP TABLE a;' }, { name: '20261101-b.sql', text: '-- UP\nALTER TABLE a ADD y int;\n' }],
    env: tpl.envChangesFromDiff('+  - SUPPORT_EMAILS=${SUPPORT_EMAILS}\n+const x = process.env.SUPPORT_EMAILS;\n-const y = process.env.OLD_FLAG;\n'),
  };
  const a = tpl.buildInternalNote({ deploy: deployFacts, sources: srcFacts, features: [{ slug: 'platform:support', title: 'Support', status: 'live' }] });
  const b = tpl.buildInternalNote({ deploy: deployFacts, sources: srcFacts, features: [{ slug: 'platform:support', title: 'Support', status: 'live' }] });
  check(JSON.stringify(a) === JSON.stringify(b) && tpl.SECTION_KEYS.every((k) => typeof a[k] === 'string' && a[k].length), 'the template is deterministic and fills every section');
  check(/#901 feat\(support\): private lane/.test(a.summary) && /aaaa111\.\.bbbb222/.test(a.summary), 'what changed lists the PRs and the range');
  check(/#901: Customers could not reach XENO privately/.test(a.why) && /#902: the PR body gives no reason/.test(a.why), 'why comes from each PR body, and says so when a body is empty');
  check(/Support \(platform:support\) — live/.test(a.features), 'features touched come from the release record');
  check(/20261101-a\.sql — down path: present/.test(a.migrations) && /20261101-b\.sql — down path: none/.test(a.migrations) && /20261101-b\.sql has no down path/.test(a.risks), 'migrations carry their down path, and a forward-only one is a risk');
  check(/SUPPORT_EMAILS=true/.test(a.risks) && /New configuration read: SUPPORT_EMAILS/.test(a.switches) && /no longer read: OLD_FLAG/.test(a.switches), 'risks and switches come from the PR body and the configuration diff');
  check(/npm run test:support-tickets/.test(a.tests) && /src\/server\/tests\/support\.test\.mjs/.test(a.tests) && !/Generated with/.test(JSON.stringify(a)), 'tests come from the PR body and the test files touched; tool footers are dropped');
  check(/deploy-platform\.mjs backend --rollback --execute/.test(a.rollback) && /xeno-platform-backend:rollback/.test(a.rollback) && /was serving aaaa111/.test(a.rollback), 'rollback names the rollback point and the steps');

  // ── the collector, with git and GitHub stubbed
  const fakeGit = (args) => {
    if (args[0] === 'log') return `${'c'.repeat(40)} Merge pull request #901 from X/support\n${'d'.repeat(40)} Merge pull request #902 from X/typo`;
    if (args[0] === 'diff' && args[1] === '--name-only') return args[3] === 'c'.repeat(40) ? 'src/server/tests/support.test.mjs\nsrc/server/services/support.js' : 'README.md';
    if (args[0] === 'show') return '-- UP\nSELECT 1;\n-- DOWN\nSELECT 2;';
    if (args[0] === 'diff') return '+const x = process.env.NEW_ONE;';
    throw new Error('unexpected git ' + args.join(' '));
  };
  const col = collectNoteSources({ git: fakeGit, prText: (n) => (n === 901 ? { title: 'feat(support): private lane', body: PR_BODY, url: 'u' } : null), previousSha: 'aaaa111', sha: 'bbbb222', prs: [902, 901], migrations: ['m.sql'] });
  check(col.prs.length === 2 && col.prs[0].number === 901 && col.prs[0].files.includes('src/server/tests/support.test.mjs') && col.prs[1].title.startsWith('Merge pull request #902') && col.env.added[0] === 'NEW_ONE' && col.collectedBy === 'gh', 'the collector reads PR text from GitHub, files from each merge, and falls back to the merge subject');

  // ── people
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const id = { staff: await mk('in-staff', 'admin'), ada: await mk('in-ada'), bot: await mk('in-bot', 'admin'), adaBot: await mk('in-adabot'), svc: await mk('in-svc', 'service') };
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.bot, id.staff]);
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.adaBot, id.ada]);
  const staff = { id: id.staff, kind: 'human', role: 'admin' }, bot = { id: id.bot, kind: 'agent', role: 'admin' };
  const ada = { id: id.ada, kind: 'human', role: 'user' }, adaBot = { id: id.adaBot, kind: 'agent', role: 'user' }, service = { id: id.svc, kind: 'service', role: 'user' };

  // ── a deploy drafts its note, through the real record-deploy script
  await rel.upsertFeature(pool, null, { slug: 'platform:support', title: 'Support', repo: 'xeno-platform', status: 'live' }, { system: true });
  await rel.recordChange(pool, { repo: 'xeno-platform', kind: 'pr', externalId: '901', title: 'feat(support): private lane', featureSlug: 'platform:support' });
  await rel.recordDeploy(pool, { service: 'backend', sha: 'aaaa111', mode: 'swap', status: 'ok', startedAt: '2026-11-01T09:00:00Z' });
  const input = { service: 'backend', sha: 'bbbb222', mode: 'swap', status: 'ok', startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T10:04:00Z', rollbackPoint: 'xeno-platform-backend:rollback', healthcheck: 'passed /api/ready', prs: [901, 902], migrations: ['20261101-a.sql', '20261101-b.sql'], sources: srcFacts };
  const recorder = join(ROOT, 'src/server/scripts/record-deploy.mjs');
  const r1 = spawnSync(process.execPath, [recorder], { input: JSON.stringify(input), env: { ...process.env }, encoding: 'utf8' });
  check(r1.status === 0 && /internal note drafted/.test(r1.stdout), 'record-deploy drafts the internal note at the deploy' + (r1.status ? ': ' + r1.stderr : ''));
  const dep = (await rel.listDeploys(pool, staff)).find((d) => d.sha === 'bbbb222');
  let note = await inotes.getInternalNote(pool, staff, dep.id);
  check(note.provenance === 'drafted_at_deploy' && note.state === 'draft' && note.version === 1 && note.revisions.length === 1 && note.revisions[0].editedByKind === 'system', 'the note is a draft at version 1, its first revision written by the system');
  check(/#901: Customers could not reach XENO privately/.test(note.content.why) && /Support \(platform:support\)/.test(note.content.features), 'the drafted note carries the PR reasons and the features they touched');
  const r2 = spawnSync(process.execPath, [recorder], { input: JSON.stringify({ ...input, status: 'ok' }), env: { ...process.env }, encoding: 'utf8' });
  check(r2.status === 0 && /internal note unchanged/.test(r2.stdout), 'recording the same deploy again leaves an unchanged note alone');
  check((await inotes.draftForDeploy(pool, dep.id, { ...srcFacts, prs: srcFacts.prs.slice(0, 1) })).action === 'redrafted', 'new facts redraft a note nobody has edited');

  // ── staff only, everywhere
  for (const [who, label] of [[ada, 'a customer'], [adaBot, 'a customer’s agent'], [service, 'a service account']]) {
    check(await code(() => inotes.getInternalNote(pool, who, dep.id)) === 'not_found', `${label} cannot read an internal note`);
    check(await code(() => inotes.editInternalNote(pool, who, dep.id, { content: { why: 'x' } })) === 'not_found', `${label} cannot edit one`);
    check(await code(() => inotes.signInternalNote(pool, who, dep.id)) === 'not_found', `${label} cannot sign one`);
    check(await code(() => inotes.noteStates(pool, who, [dep.id])) === 'not_found', `${label} cannot list note states`);
    check(await code(() => relMcp.callTool(pool, who, 'get_internal_note', { deploy: dep.id })) === 'not_found', `${label} gets nothing from the agent tool`);
  }
  // the HTTP route, with real tokens through the real auth middleware
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/releases', releaseRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tok = (uid) => jwt.sign({ userId: uid, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, path, uid, body) => { const r = await fetch(origin + path, { method, headers: { authorization: 'Bearer ' + tok(uid), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, t: await r.text() }; };
  try {
    for (const [uid, label] of [[id.ada, 'a customer'], [id.adaBot, 'a customer’s agent']]) {
      const g = await call('GET', `/api/releases/deploys/${dep.id}/internal-note`, uid);
      check(g.s === 404 && !/Customers could not reach|rollback|#901/.test(g.t), `${label} gets a bare 404 from the route, with none of the note`);
      check((await call('PATCH', `/api/releases/deploys/${dep.id}/internal-note`, uid, { content: { why: 'x' } })).s === 404, `${label} cannot edit through the route`);
      check((await call('POST', `/api/releases/deploys/${dep.id}/internal-note/sign`, uid, {})).s === 404, `${label} cannot sign through the route`);
      check((await call('GET', '/api/releases/deploys', uid)).s === 404, `${label} cannot list deploys with their note states`);
    }
    const sg = await call('GET', `/api/releases/deploys/${dep.id}/internal-note`, id.staff);
    check(sg.s === 200 && /Customers could not reach/.test(sg.t), 'staff read the note through the route');
    const list = JSON.parse((await call('GET', '/api/releases/deploys', id.staff)).t);
    check(list.deploys.find((d) => d.id === dep.id).internalNote.state === 'draft', 'the deploy list says each deploy’s note state');
    const ag = await call('POST', `/api/releases/deploys/${dep.id}/internal-note/sign`, id.bot, {});
    check(ag.s === 403, 'a staff agent is refused sign-off through the route');
  } finally { await new Promise((r) => server.close(r)); }

  // ── edit, sign, revisions
  const e1 = await relMcp.callTool(pool, bot, 'edit_internal_note', { deploy: dep.id, content: { risks: '- watch the mail queue' }, expectedVersion: note.version });
  note = e1.structuredContent.note;
  check(note.version === 2 && note.edited && note.content.risks === '- watch the mail queue' && note.revisions[0].editedByKind === 'agent', 'a staff agent edits the draft; the edit is a new version');
  check(await code(() => inotes.signInternalNote(pool, bot, dep.id)) === 'human_staff_only', 'a staff agent cannot sign off');
  check(await code(() => pool.query(`UPDATE release_internal_notes SET state='signed', signed_by=$2, signed_at=now(), signed_version=version WHERE deploy_id=$1`, [dep.id, id.bot])) === '23514', 'the database refuses an agent’s sign-off too');
  check(await code(() => pool.query(`UPDATE release_internal_notes SET state='signed', signed_by=$2, signed_at=now(), signed_version=version WHERE deploy_id=$1`, [dep.id, id.ada])) === '23514', 'the database refuses a sign-off by someone not on staff');
  check(await code(() => inotes.editInternalNote(pool, staff, dep.id, { content: { why: 'x' }, expectedVersion: 1 })) === 'version_conflict', 'an edit over a newer version is refused');
  check(await code(() => inotes.editInternalNote(pool, staff, dep.id, { content: { nope: 'x' } })) === 'invalid_section', 'an unknown section is refused');
  note = await inotes.signInternalNote(pool, staff, dep.id, { expectedVersion: 2 });
  check(note.state === 'signed' && note.signedBy === id.staff && note.signedVersion === 2 && note.signedAt, 'a person on staff signs off the current version');
  check((await inotes.draftForDeploy(pool, dep.id, srcFacts)).action === 'kept', 'a later deploy run never redrafts a signed note');
  note = await inotes.editInternalNote(pool, staff, dep.id, { content: { tests: '- npm run test:support-tickets' } });
  check(note.state === 'draft' && note.version === 3 && note.signedBy === null && note.revisions.length === 3 && note.revisions.at(-1).version === 1, 'editing a signed note puts it back to draft and keeps every version');

  // ── the customer path never carries it
  await rel.updateFeature(pool, staff, 'platform:support', { enabledScope: 'all' });
  const n = await rel.draftNote(pool, staff, 'platform:support', { title: 'Contact XENO privately', body: 'Ask from Help.' });
  await rel.approveNote(pool, staff, n.id);
  const news = JSON.stringify(await rel.whatsNew(pool, ada));
  check(/Contact XENO privately/.test(news) && !/mail queue|rollback|#901|Customers could not reach/.test(news), 'a customer’s What’s new carries none of the internal note');

  // ── the backfill
  await rel.recordDeploy(pool, { service: 'frontend', sha: 'eeee555', mode: 'swap', status: 'ok', startedAt: '2026-09-01T10:00:00Z', provenance: 'reconstructed', evidence: 'deploy.log', prs: [901] });
  await rel.recordDeploy(pool, { service: 'frontend', sha: 'ffff666', mode: 'swap', status: 'failed', startedAt: '2026-09-02T10:00:00Z', provenance: 'reconstructed', evidence: 'deploy.log' });
  const dir = mkdtempSync(join(tmpdir(), 'inotes-'));
  const prJson = join(dir, 'prs.json'); writeFileSync(prJson, JSON.stringify([{ number: 901, title: 'feat(support): private lane', body: PR_BODY, url: 'u' }]));
  const bf = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/draft-internal-notes.mjs'), '--pr-json', prJson, ...args], { env: { ...process.env }, encoding: 'utf8' });
  const total = async () => Number((await pool.query('SELECT count(*) FROM release_internal_notes')).rows[0].count);
  const before = await total();
  const dry = bf();
  check(dry.status === 0 && /"deploys":3/.test(dry.stdout) && /DRY-RUN/.test(dry.stdout) && (await total()) === before, 'the backfill is dry-run by default: it counts and writes nothing' + (dry.status ? ': ' + dry.stderr : ''));
  const go = bf('--confirm');
  check(go.status === 0 && /drafted 3 internal note/.test(go.stdout) && (await total()) === before + 3, 'with --confirm it drafts a note for every deploy without one' + (go.status ? ': ' + go.stderr : ''));
  const hist = (await pool.query(`SELECT n.provenance, n.content FROM release_internal_notes n JOIN release_deploys d ON d.id = n.deploy_id WHERE d.sha = 'eeee555'`)).rows[0];
  check(hist.provenance === 'drafted_from_history' && /#901: Customers could not reach/.test(hist.content.why), 'a backfilled note is marked drafted_from_history and still reads its PR');
  const again = bf('--confirm');
  check(again.status === 0 && /"deploys":0/.test(again.stdout) && (await total()) === before + 3, 'running the backfill again changes nothing');
  check(note.state === 'draft' && (await inotes.getInternalNote(pool, staff, dep.id)).version === 3, 'the backfill never touches an existing note');
  rmSync(dir, { recursive: true, force: true });

  console.log(`release-internal-notes: ${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e.message || e); await pool.end().catch(() => {}); process.exit(1); });
