/**
 * Custom modes + trade packs, phase 1 (XENO MODES - SPEC.md §8c; migration 20261021090000; services/modeApply.js),
 * on real Postgres, through the REAL routes:
 *   1. the migration's DOWN runs on an empty schema and UP restores it; DOWN refuses once a custom mode exists;
 *   2. an account mode created by one client is read by another (the server replaced localStorage);
 *   3. plan writes nothing; apply creates the mode + starter tasks + ONE receipt + an audit row, in one transaction;
 *      the same idempotency key (twice, and concurrently) gives one set of records and the same receipt; a reused key
 *      with another plan and a stale plan are refused;
 *   4. only a human admin applies: a plain member is told the workspace does not exist, an agent may plan but not
 *      apply (human_admin_must_confirm, also over MCP), and apply needs confirm: true;
 *   5. revert archives what nobody touched and KEEPS a person's edits (an edited task, an edited mode); the receipt is
 *      immutable except its one revert stamp, and is never deleted;
 *   6. Marketplace kind `mode`: a community developer cannot publish one, a dependency must be a published version, a
 *      published pack is immutable, and a published pack can be applied like a first-party one.
 *
 * Mutation-checked with scripts/custom-modes-mutation.mjs (each mutation must make this suite fail).
 * Run: DATABASE_URL=postgresql://…/<disposable> node tests/custom-modes.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as modes from '../services/modeApply.js';
import * as modesMcp from '../services/modesMcp.js';
import { updateTask } from '../services/xenoTasks.js';
import { meModesRouter, workspaceModesRouter } from '../routes/modesRoutes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const [UPRAW, DOWN] = fs.readFileSync(path.join(here, '../database/migrations/20261021090000-custom-modes.sql'), 'utf8').split(/^-- DOWN\s*$/m);
const UP = UPRAW.replace(/^-- UP\s*$/m, '');
const tag = `cm${process.pid}`;
let seq = 0;
const n = async (sql, a = []) => Number((await pool.query(sql, a)).rows[0].n);
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const workspace = async (owner, type = 'team') => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [owner, type, `${tag} ws ${seq += 1}`, `${tag}-${seq}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const refused = async (p, code, why) => { await assert.rejects(p, (e) => { assert.equal(e.code, code, `${why}: got ${e.code} ${e.message}`); return true; }, why); };

async function main() {
  await runAllMigrations(pool);
  // ── 1. down → up on an empty schema
  await pool.query(DOWN);
  assert.equal(await n(`SELECT count(*) n FROM information_schema.tables WHERE table_name IN ('custom_modes','workspace_mode_applications','marketplace_mode_dependencies')`), 0, 'DOWN removes the new tables');
  await pool.query(UP);
  assert.equal(await n(`SELECT count(*) n FROM information_schema.tables WHERE table_name IN ('custom_modes','workspace_mode_applications','marketplace_mode_dependencies')`), 3, 'UP restores them');

  const owner = await user('owner'), member = await user('member'), stranger = await user('stranger'), agent = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agent, owner]);
  const ws = await workspace(owner);
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${member}`, relation: 'viewer' }] });

  // the real routes, with the signed-in person stood in by a header
  const app = express();
  app.use((req, _res, next) => { req.db = pool; req.user = { id: req.get('x-test-user') }; next(); });
  app.use('/api/v2/me/modes', meModesRouter);
  app.use('/api/v2/workspaces', workspaceModesRouter);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (who, method, url, body) => { const r = await fetch(base + url, { method, headers: { 'x-test-user': who, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, d: await r.json() }; };

  try {
    // ── 2. account modes live on the server
    let r = await call(owner, 'POST', '/api/v2/me/modes', { id: 'c-agency', name: 'Video agency', products: ['motion', 'post'] });
    assert.equal(r.status, 200, JSON.stringify(r.d));
    r = await call(owner, 'GET', '/api/v2/me/modes');   // "another browser": a fresh read, no client state
    assert.deepEqual(r.d.modes.map((m) => m.name), ['Video agency'], 'a mode made in one client opens in another');
    assert.ok(r.d.workspaces.some((w) => w.id === ws && w.admin), 'the owner is told where they may apply a setup');
    assert.equal((await call(stranger, 'GET', '/api/v2/me/modes')).d.modes.length, 0, 'modes are the owner’s own');
    assert.equal((await call(owner, 'POST', '/api/v2/me/modes', { id: 'c-agency', name: 'Again', products: ['motion'] })).status, 409, 'one mode per id');
    assert.equal((await call(owner, 'POST', '/api/v2/me/modes', { id: 'BAD id', name: 'x', products: ['motion'] })).status, 400, 'ids are checked');
    assert.equal((await call(owner, 'PATCH', '/api/v2/me/modes/c-agency', { name: 'Agency', products: ['motion', 'image'] })).d.mode.products.length, 2);
    assert.equal((await call(owner, 'DELETE', '/api/v2/me/modes/c-agency')).status, 200);
    assert.equal((await call(owner, 'GET', '/api/v2/me/modes')).d.modes.length, 0, 'delete archives it out of the list');

    // ── 3. plan writes nothing
    const counts = async () => [await n(`SELECT count(*) n FROM custom_modes WHERE owner_workspace_id=$1`, [ws]), await n(`SELECT count(*) n FROM tasks WHERE area='c-salon' AND owner_user_id=$1`, [owner]), await n(`SELECT count(*) n FROM workspace_mode_applications WHERE workspace_id=$1`, [ws])];
    const before = await counts();
    r = await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/plan`, { packId: 'salon', answers: { businessName: 'Studio Ana' } });
    assert.equal(r.status, 200, JSON.stringify(r.d));
    const { planHash } = r.d;
    assert.equal(r.d.plan.records.filter((x) => x.type === 'task').length, 3);
    assert.deepEqual(await counts(), before, 'plan writes nothing');
    assert.equal((await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/plan`, { packId: 'salon', answers: {} })).d.error, 'answer_required');

    // ── 4. who may apply
    assert.equal((await call(member, 'POST', `/api/v2/workspaces/${ws}/modes/plan`, { packId: 'salon', answers: { businessName: 'x' } })).status, 404, 'a member who is not an admin sees no workspace');
    const agentPlan = await modes.plan(pool, { id: agent }, { workspaceId: ws, packId: 'salon', answers: { businessName: 'Studio Ana' } });
    assert.equal(agentPlan.planHash, planHash, 'an agent may plan for its owner');
    await refused(modes.apply(pool, { id: agent }, { workspaceId: ws, packId: 'salon', answers: { businessName: 'Studio Ana' }, planHash, idempotencyKey: 'agent-key-1', confirm: true }), 'human_admin_must_confirm', 'an agent cannot apply');
    await assert.rejects(modesMcp.callTool(pool, { id: agent }, 'apply', { workspace: ws, pack: 'salon', answers: { businessName: 'Studio Ana' }, plan_hash: planHash, request_key: 'agent-key-2', confirm: true }), (e) => e.code === 'human_admin_must_confirm', 'the MCP tool refuses an agent the same way');
    assert.equal((await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, { packId: 'salon', answers: { businessName: 'Studio Ana' }, planHash, idempotencyKey: 'no-confirm-1' })).d.error, 'confirmation_required');
    assert.deepEqual(await counts(), before, 'every refusal wrote nothing');

    // ── apply, once, even when asked twice at the same moment
    const body = { packId: 'salon', answers: { businessName: 'Studio Ana' }, planHash, idempotencyKey: 'onboard-salon-0001', confirm: true };
    const [a1, a2] = await Promise.all([call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, body), call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, body)]);
    assert.equal(a1.status, 200, JSON.stringify(a1.d)); assert.equal(a2.status, 200, JSON.stringify(a2.d));
    assert.equal(a1.d.receipt.applicationId, a2.d.receipt.applicationId, 'concurrent retries return one receipt');
    const a3 = await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, body);
    assert.equal(a3.d.replayed, true); assert.equal(a3.d.receipt.applicationId, a1.d.receipt.applicationId, 'a retry returns the same receipt');
    assert.deepEqual(await counts(), [before[0] + 1, before[1] + 3, before[2] + 1], 'the same key applied three times gives one set of records');
    assert.equal(await n(`SELECT count(*) n FROM workspace_audit WHERE workspace_id=$1 AND action='mode.applied'`, [ws]), 1, 'one audit row');
    const receipt = a1.d.receipt;
    assert.equal(receipt.records.length, 4); assert.equal(receipt.appliedBy, owner);
    assert.equal((await pool.query(`SELECT trade FROM user_onboarding WHERE user_id=$1`, [owner])).rows[0].trade, 'salon', 'the trade is recorded');
    assert.equal((await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, { ...body, answers: { businessName: 'Other' } })).d.error, 'idempotency_key_reused', 'a key names one plan');
    assert.equal((await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/apply`, { ...body, idempotencyKey: 'onboard-salon-0002' })).d.error, 'plan_changed', 'a stale plan is refused (the setup is there now)');
    r = await call(owner, 'GET', '/api/v2/me/modes');
    assert.ok(r.d.workspaceModes.some((m) => m.id === 'c-salon' && m.workspaceId === ws), 'the applied mode reaches the person’s shelf');
    assert.ok((await call(member, 'GET', '/api/v2/me/modes')).d.workspaceModes.some((m) => m.id === 'c-salon'), 'and every member’s');

    // ── 5. revert keeps what a person changed
    const taskRecs = receipt.records.filter((x) => x.type === 'task');
    await updateTask(pool, { id: owner, kind: 'human', name: 'Owner' }, taskRecs[0].key, { title: 'Opening hours: Mon–Sat 9–18' });
    const second = await workspace(owner);
    const p2 = await modes.plan(pool, { id: owner }, { workspaceId: second, packId: 'club', answers: { businessName: 'FC Test' } });
    const app2 = await modes.apply(pool, { id: owner }, { workspaceId: second, packId: 'club', answers: { businessName: 'FC Test' }, planHash: p2.planHash, idempotencyKey: 'club-0000001', confirm: true });
    await modes.updateWorkspaceMode(pool, { id: owner }, second, 'c-club', { name: 'Our club', products: ['community', 'comms'] });
    await refused(modes.revert(pool, { id: agent }, { workspaceId: ws, applicationId: receipt.applicationId }), 'human_admin_must_confirm', 'an agent cannot undo');
    r = await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/${receipt.applicationId}/revert`);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    const rep = r.d.receipt.revertReport;
    assert.deepEqual(rep.kept.map((k) => k.id), [taskRecs[0].id], 'the task a person edited is kept');
    assert.equal(rep.archived.length, 3, 'the untouched mode and two tasks are archived');
    assert.equal(await n(`SELECT count(*) n FROM tasks WHERE id=$1 AND deleted_at IS NULL`, [taskRecs[0].id]), 1);
    assert.equal(await n(`SELECT count(*) n FROM tasks WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`, [taskRecs.slice(1).map((t) => t.id)]), 2);
    assert.equal(await n(`SELECT count(*) n FROM custom_modes WHERE owner_workspace_id=$1 AND archived_at IS NULL`, [ws]), 0);
    const club = (await modes.revert(pool, { id: owner }, { workspaceId: second, applicationId: app2.receipt.applicationId })).receipt.revertReport;
    assert.ok(club.kept.some((k) => k.type === 'mode'), 'an edited mode is kept');
    assert.equal((await call(owner, 'POST', `/api/v2/workspaces/${ws}/modes/${receipt.applicationId}/revert`)).d.replayed, true, 'undoing twice changes nothing');
    await assert.rejects(pool.query(`UPDATE workspace_mode_applications SET answers='{}' WHERE id=$1`, [receipt.applicationId]), /immutable/, 'a receipt is immutable');
    await assert.rejects(pool.query(`DELETE FROM workspace_mode_applications WHERE id=$1`, [receipt.applicationId]), /retained/, 'a receipt is retained');
    assert.equal((await call(owner, 'GET', `/api/v2/workspaces/${ws}/modes/applications`)).d.applications[0].revertedAt !== null, true);
    // the mode can be applied again after undo
    const again = await modes.plan(pool, { id: owner }, { workspaceId: ws, packId: 'salon', answers: { businessName: 'Studio Ana' } });
    assert.equal(again.plan.conflicts.length, 0, 'after undo the setup can be applied again');

    // ── 6. Marketplace kind `mode`
    const devUser = await user('dev'), comUser = await user('community');
    const dev = async (u, tier) => (await pool.query(`INSERT INTO marketplace_developers (user_id, slug, display_name, trust_tier) VALUES ($1,$2,$2,$3) RETURNING id`, [u, `${tag}-${tier}`, tier])).rows[0].id;
    const verified = await dev(devUser, 'verified'), community = await dev(comUser, 'community');
    const listing = async (d, kind, slug) => (await pool.query(`INSERT INTO marketplace_listings (slug, kind, developer_id, title, trust_tier, status) VALUES ($1,$2,$3,$1,'verified','published') RETURNING id`, [`${tag}-${slug}`, kind, d])).rows[0].id;
    const pack = { format: 'xeno-mode-pack', schemaVersion: 1, title: 'Bakery', summary: 'Orders and posts', trade: 'bakery', questions: [{ id: 'businessName', label: 'Name', required: true }], mode: { id: 'c-bakery', name: 'Bakery', products: ['post', 'crm'] }, tasks: [{ title: 'Post today’s bread' }] };
    const version = async (l, v, p, published) => (await pool.query(`INSERT INTO marketplace_listing_versions (listing_id, version, mode_pack, mode_pack_hash, published_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [l, v, p ? JSON.stringify(p) : null, p ? modes.sha256(p) : null, published ? new Date() : null])).rows[0].id;
    const comL = await listing(community, 'mode', 'com-pack');
    await assert.rejects(version(comL, '1.0.0', pack, true), /verified or official/, 'a community developer cannot publish a pack (D-CM2)');
    const depL = await listing(verified, 'team', 'dep-team');
    const modeL = await listing(verified, 'mode', 'bakery');
    const mv = await version(modeL, '1.0.0', pack, false);
    await pool.query(`INSERT INTO marketplace_mode_dependencies (version_id, depends_on_listing_id, depends_on_version) VALUES ($1,$2,'2.0.0')`, [mv, depL]);
    await assert.rejects(pool.query(`UPDATE marketplace_listing_versions SET published_at=now() WHERE id=$1`, [mv]), /dependency/, 'a dependency must be a published version');
    await pool.query(`INSERT INTO marketplace_listing_versions (listing_id, version, published_at) VALUES ($1,'2.0.0',now())`, [depL]).catch(async (e) => {
      // a `team` version needs a package to publish; stand in a plain published dependency of another kind
      if (!/team/i.test(e.message)) throw e;
      const other = await listing(verified, 'panel', 'dep-panel');
      await pool.query(`INSERT INTO marketplace_listing_versions (listing_id, version, published_at) VALUES ($1,'2.0.0',now())`, [other]);
      await pool.query(`UPDATE marketplace_mode_dependencies SET depends_on_listing_id=$2 WHERE version_id=$1`, [mv, other]);
    });
    await pool.query(`UPDATE marketplace_listing_versions SET published_at=now() WHERE id=$1`, [mv]);
    await assert.rejects(pool.query(`UPDATE marketplace_listing_versions SET mode_pack = mode_pack || '{"title":"x"}' WHERE id=$1`, [mv]), /immutable/, 'a published pack is immutable');
    assert.ok((await modes.listPacks(pool)).packs.some((p) => p.id === `listing:${mv}`), 'a published pack is listed');
    const lp = await modes.plan(pool, { id: owner }, { workspaceId: ws, packId: `listing:${mv}`, answers: { businessName: 'Bake' } });
    const la = await modes.apply(pool, { id: owner }, { workspaceId: ws, packId: `listing:${mv}`, answers: { businessName: 'Bake' }, planHash: lp.planHash, idempotencyKey: 'bakery-000001', confirm: true });
    assert.equal(la.receipt.listingVersionId, mv, 'a listed pack applies with its version on the receipt');
    // the DOWN refuses now that rows exist
    await assert.rejects(pool.query(DOWN), /rollback refused/, 'DOWN refuses while custom modes exist');
    console.log('custom-modes: all assertions passed');
  } finally { server.close(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
