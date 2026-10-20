/**
 * The platform's release record (services/releaseRecord.js, releasesMcp.js, scripts/record-deploy.mjs and the
 * history import), against a real Postgres.
 *
 *   - deploys are recorded idempotently, with the previous OK swap as their previous sha; reconstructed rows need evidence
 *   - every staff read answers "not found" to a customer, a customer's agent and a service account
 *   - a customer's What's new carries ONLY a note's words and date — no PR, repo, slug, spec, test or author field
 *   - a note is invisible until it is approved AND its feature is live AND enabled for that person (all / plans / workspaces)
 *   - only a HUMAN on staff approves a note or enables a feature; the database refuses an agent's approval too
 *   - the history import is dry-run by default and idempotent with --confirm
 *
 *   node src/server/tests/release-record.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as rel from '../services/releaseRecord.js';
import * as relMcp from '../services/releasesMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const STAFF_FIELDS = ['slug', 'repo', 'featureId', 'specRef', 'testProof', 'changes', 'prs', 'url', 'draftedBy', 'approvedBy', 'state', 'enabled', 'provenance'];

async function main() {
  await runAllMigrations(pool);
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const id = { staff: await mk('rl-staff', 'admin'), ada: await mk('rl-ada'), bob: await mk('rl-bob'), pro: await mk('rl-pro'), bot: await mk('rl-bot', 'admin'), adaBot: await mk('rl-adabot') };
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.bot, id.staff]);
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.adaBot, id.ada]);
  await pool.query(`INSERT INTO xeno_account_plans (user_id, plan, status) VALUES ($1, 'pro', 'active')`, [id.pro]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', $2) RETURNING id`, [id.bob, `acme-rl-${Date.now()}`])).rows[0].id;
  await pool.query(`INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id) VALUES ('workspace', $1, 'owner', 'user', $2) ON CONFLICT DO NOTHING`, [String(ws), String(id.bob)]);
  const staff = { id: id.staff, kind: 'human', role: 'admin' };
  const bot = { id: id.bot, kind: 'agent', role: 'admin' };           // a staff-owned agent: reads and drafts, never approves
  const ada = { id: id.ada, kind: 'human', role: 'user' }, bob = { id: id.bob, kind: 'human', role: 'user' }, pro = { id: id.pro, kind: 'human', role: 'user' };
  const adaBot = { id: id.adaBot, kind: 'agent', role: 'user' };
  const service = { id: id.ada, kind: 'service', role: 'user' };

  // ── deploys
  const d1 = await rel.recordDeploy(pool, { service: 'backend', sha: 'aaaa111', mode: 'swap', status: 'ok', startedAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T10:05:00Z', deployedBy: 'ops@xeno.test', healthcheck: 'passed /api/ready', rollbackPoint: 'xeno-platform-backend:rollback', prs: [801, 802], migrations: ['20261001-a.sql'] });
  check(d1.inserted && d1.deploy.previousSha === null, 'a first deploy is recorded with no previous commit');
  const d2 = await rel.recordDeploy(pool, { service: 'backend', sha: 'bbbb222', mode: 'swap', status: 'ok', startedAt: '2026-10-02T10:00:00Z', prs: [803] });
  check(d2.deploy.previousSha === 'aaaa111', 'the next deploy names the last OK swap of the same service as its previous commit');
  const again = await rel.recordDeploy(pool, { service: 'backend', sha: 'bbbb222', mode: 'swap', status: 'ok', startedAt: '2026-10-02T10:00:00Z' });
  check(!again.inserted && again.deploy.id === d2.deploy.id && again.deploy.prs.length === 1, 'recording the same deploy twice is one row, and keeps what it already knew');
  await rel.recordDeploy(pool, { service: 'backend', sha: 'cccc333', mode: 'swap', status: 'failed', startedAt: '2026-10-03T10:00:00Z' });
  check((await rel.recordDeploy(pool, { service: 'backend', sha: 'dddd444', mode: 'swap', status: 'ok', startedAt: '2026-10-04T10:00:00Z' })).deploy.previousSha === 'bbbb222', 'a failed deploy is never the previous commit');
  check(await code(() => rel.recordDeploy(pool, { service: 'backend', sha: 'e', mode: 'swap', status: 'ok', provenance: 'reconstructed' })) === 'evidence_required', 'a reconstructed deploy must say where it came from');
  check(await code(() => pool.query(`INSERT INTO release_deploys (natural_key, service, sha, mode, status, provenance) VALUES ('x','backend','e','swap','ok','reconstructed')`)) === '23514', 'the database refuses a reconstructed deploy with no evidence too');

  // ── staff-only reads
  for (const [who, label] of [[ada, 'a customer'], [adaBot, 'a customer’s agent'], [service, 'a service account']]) {
    check(await code(() => rel.listDeploys(pool, who)) === 'not_found', `${label} cannot list deploys`);
    check(await code(() => rel.listFeatures(pool, who)) === 'not_found', `${label} cannot list features`);
    check(await code(() => rel.listNotes(pool, who)) === 'not_found', `${label} cannot read the notes queue`);
    check(await code(() => rel.summary(pool, who)) === 'not_found', `${label} cannot read the summary`);
    check(await code(() => rel.getDeploy(pool, who, d1.deploy.id)) === 'not_found', `${label} cannot read a deploy`);
  }
  check((await rel.listDeploys(pool, staff)).length === 4 && (await rel.listDeploys(pool, bot)).length === 4, 'staff and a staff agent read every deploy');
  const one = await rel.getDeploy(pool, staff, d1.deploy.id);
  check(one.healthcheck === 'passed /api/ready' && one.migrations[0] === '20261001-a.sql' && one.deployedBy === 'ops@xeno.test', 'a deploy carries its healthcheck, migrations and who ran it');

  // ── features, changes, notes
  await rel.upsertFeature(pool, null, { slug: 'platform:support', title: 'Support (platform)', repo: 'xeno-platform', status: 'built', provenance: 'derived', evidence: 'grouped', firstChangeAt: '2026-10-01T00:00:00Z', lastChangeAt: '2026-10-02T00:00:00Z' }, { system: true });
  await rel.recordChange(pool, { repo: 'xeno-platform', kind: 'pr', externalId: '801', title: 'feat(support): private lane', url: 'https://github.com/XENO-CORPORATION/xeno-platform/pull/801', sha: 'aaaa111', at: '2026-10-01T09:00:00Z', featureSlug: 'platform:support' });
  check((await rel.recordChange(pool, { repo: 'xeno-platform', kind: 'pr', externalId: '801', title: 'feat(support): private lane' })).inserted === false, 'a change recorded twice is one row');
  const f = await rel.getFeature(pool, staff, 'platform:support');
  check(f.changes.length === 1 && f.changes[0].url.includes('/pull/801') && f.enabled.scope === 'none', 'a feature carries its PRs and starts enabled for nobody');
  check((await rel.getDeploy(pool, staff, d1.deploy.id)).pullRequests[0].title === 'feat(support): private lane', 'a deploy names the PRs it shipped');
  check(await code(() => rel.getFeature(pool, ada, f.id)) === 'not_found', 'a customer cannot read a feature');

  const draft = await rel.draftNote(pool, bot, f.id, { title: 'Contact XENO privately', body: 'You can now ask XENO support a private question from Help.' });
  check(draft.state === 'draft' && draft.draftedByKind === 'agent', 'a staff agent drafts a note, and it stays a draft');
  check(await code(() => rel.draftNote(pool, adaBot, f.id, { title: 'x', body: 'y' })) === 'not_found', 'a customer’s agent cannot draft');
  check(await code(() => rel.approveNote(pool, bot, draft.id)) === 'human_staff_only', 'an agent cannot approve a note, whatever its role says');
  check(await code(() => pool.query(`UPDATE release_notes SET state='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [draft.id, id.bot])) === '23514', 'the database refuses an agent’s approval');
  check(await code(() => pool.query(`UPDATE release_notes SET state='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [draft.id, id.ada])) === '23514', 'the database refuses a non-staff person’s approval');
  check(await code(() => rel.updateFeature(pool, bot, f.id, { enabledScope: 'all' })) === 'human_staff_only', 'an agent cannot enable a feature');
  check(await code(() => relMcp.callTool(pool, bot, 'approve_note', { note: draft.id })) === 'unknown_tool', 'there is no agent tool that approves');

  const news = () => rel.whatsNew(pool, ada);
  check((await news()).length === 0, 'a draft is invisible to customers');
  const approved = await rel.approveNote(pool, staff, draft.id);
  check(approved.state === 'approved' && approved.approvedBy === id.staff, 'a person on staff approves it');
  check((await news()).length === 0, 'an approved note for a feature enabled for nobody is still invisible');
  await rel.updateFeature(pool, staff, f.id, { enabledScope: 'all' });
  check((await news()).length === 0, 'an approved note for a feature that is not live yet is still invisible');
  await rel.updateFeature(pool, staff, f.id, { status: 'live' });
  const seen = await news();
  check(seen.length === 1 && seen[0].title === 'Contact XENO privately', 'live + enabled for everyone + approved: the customer sees it');
  check(JSON.stringify(Object.keys(seen[0]).sort()) === JSON.stringify(['body', 'date', 'id', 'title']), 'the customer’s note carries only its id, words and date');
  check(!STAFF_FIELDS.some((k) => k in seen[0]) && !JSON.stringify(seen).includes('pull/801') && !JSON.stringify(seen).includes('platform:support'), 'no PR, repo, slug, spec, test, author or state reaches the customer');

  // plans and workspaces
  await rel.updateFeature(pool, staff, f.id, { enabledScope: 'plans', enabledPlans: ['pro'] });
  check((await news()).length === 0 && (await rel.whatsNew(pool, pro)).length === 1, 'enabled for the pro plan: a pro customer sees it, a free one does not');
  await rel.updateFeature(pool, staff, f.id, { enabledScope: 'workspaces', workspaceIds: [ws] });
  check((await rel.whatsNew(pool, bob)).length === 1 && (await news()).length === 0 && (await rel.whatsNew(pool, pro)).length === 0, 'enabled for a workspace: its members see it, nobody else');
  check(await code(() => rel.updateFeature(pool, staff, f.id, { enabledScope: 'plans', enabledPlans: [] })) === 'plans_required', 'enabling for plans needs a plan');
  await rel.updateFeature(pool, staff, f.id, { enabledScope: 'all' });
  await rel.withdrawNote(pool, staff, draft.id);
  check((await news()).length === 0, 'a withdrawn note disappears');
  check(await code(() => rel.whatsNew(pool, null)) === 'unauthenticated', 'What’s new needs a signed-in person');

  // agent tools
  const listed = await relMcp.callTool(pool, bot, 'list_deploys', { limit: 2 });
  check(listed.structuredContent.deploys.length === 2, 'a staff agent lists deploys through the tool');
  check(await code(() => relMcp.callTool(pool, adaBot, 'list_features', {})) === 'not_found', 'a customer’s agent is refused by the tool');

  // the history import: dry-run by default, idempotent with --confirm
  const dir = mkdtempSync(join(tmpdir(), 'rl-import-'));
  const file = join(dir, 'h.json');
  writeFileSync(file, JSON.stringify({ collectedAt: '2026-10-20T00:00:00Z', deploys: [{ service: 'frontend', sha: 'ffff999', mode: 'swap', status: 'ok', startedAt: '2026-07-14T14:28:44Z', finishedAt: '2026-07-14T14:30:00Z', prs: [], migrations: [], provenance: 'reconstructed', evidence: 'deploy.log' }],
    repos: [{ repo: 'xeno-post', prs: [{ number: 7, title: 'feat(inbox): X mentions', mergedAt: '2026-08-20T00:00:00Z', mergeSha: 'abc', url: 'u', labels: [] }, { number: 8, title: 'Update README', mergedAt: '2026-08-21T00:00:00Z', labels: [] }],
      releases: [{ tagName: 'v0.2.3', name: 'v0.2.3', publishedAt: '2026-08-22T00:00:00Z' }], tags: [{ name: 'v0.2.3', sha: 'abc' }], commits: [{ sha: 'c0', title: 'initial commit', at: '2026-06-01T00:00:00Z' }] }] }));
  const imp = (...a) => execFileSync(process.execPath, [join(ROOT, 'scripts', 'import-release-history.mjs'), 'import', '--file', file, ...a], { encoding: 'utf8', env: process.env });
  const before = Number((await pool.query('SELECT count(*) FROM release_changes')).rows[0].count);
  check(/DRY-RUN/.test(imp()) && Number((await pool.query('SELECT count(*) FROM release_changes')).rows[0].count) === before, 'the import is a dry-run by default and writes nothing');
  check(/imported: 1 new features, 5 new changes, 1 new deploys/.test(imp('--confirm')), 'with --confirm it imports');
  check(/imported: 0 new features, 0 new changes, 0 new deploys/.test(imp('--confirm')), 'running it again changes nothing');
  const post = await rel.getFeature(pool, staff, 'post:inbox');
  check(post.status === 'live' && post.provenance === 'derived' && post.enabled.scope === 'none', 'an imported feature says it was derived, is live when a release followed it, and is enabled for nobody');
  const dep = (await rel.listDeploys(pool, staff, { service: 'frontend' }))[0];
  check(dep.provenance === 'reconstructed' && dep.evidence === 'deploy.log' && dep.deployedBy === null, 'an imported deploy is reconstructed, names its evidence, and does not invent who ran it');
  rmSync(dir, { recursive: true, force: true });

  console.log(`\nrelease record: ${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
