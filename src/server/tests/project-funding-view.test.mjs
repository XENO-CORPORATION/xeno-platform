/**
 * The project Funding tab on real Postgres.
 *
 *   - anyone who can see the project reads totals and how many people gave, and their own part, never who gave what
 *   - a draft campaign is for those who manage the project; someone not on the project is told it doesn't exist
 *   - a ceiling is proposed by someone with edit access and decided by somebody else, and only then applies
 *   - reading and deciding move no money
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/project-funding-view.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as view from '../services/projectFundingView.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `pf${process.pid}`;
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s])).rows[0].id;
const hash = () => crypto.randomBytes(32).toString('hex');
const refusal = async (fn, code) => { try { await fn(); } catch (e) { assert.ok(e instanceof view.ProjectFundingError, `expected a refusal, got ${e.message}`); assert.equal(e.code, code); return true; } throw new Error(`expected ${code}`); };

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), admin2 = await user('admin2'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), giverA = await user('givera'), giverB = await user('giverb');
  const pj = (await pool.query(`INSERT INTO chat_projects (owner_user_id, name) VALUES ($1,'Funded') RETURNING id`, [owner])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `project:${pj}`, relation: 'owner', subject: `user:${owner}` }, { object: `project:${pj}`, relation: 'owner', subject: `user:${admin2}` },
    { object: `project:${pj}`, relation: 'editor', subject: `user:${editor}` }, { object: `project:${pj}`, relation: 'viewer', subject: `user:${viewer}` },
  ] });
  const camp = async (status, beneficiary) => (await pool.query(`INSERT INTO workforce_funding_campaigns (project_id, owner_user_id, client_id, operation_id, request_hash, status, beneficiary, cancellation_terms, refund_terms, deliverable_license)
    VALUES ($1,$2,'t',$3,$4,$5,$6,'cancel words','refund words','MIT') RETURNING id`, [pj, owner, crypto.randomUUID(), hash(), status, beneficiary])).rows[0].id;
  const open = await camp('draft', 'Open fund'), draft = await camp('draft', 'Draft fund');
  const ms = (await pool.query(`INSERT INTO workforce_funding_milestones (campaign_id, milestone_key, title, acceptance_criteria, threshold_micro, budget_max_micro, terms_version)
    VALUES ($1,'first','First step','{}'::jsonb,10000000,20000000,1) RETURNING id`, [open])).rows[0].id;
  await pool.query(`UPDATE workforce_funding_campaigns SET status = 'open' WHERE id = $1`, [open]);
  // the ledger's own triggers tie a confirmed contribution to its lots; this reads totals, so the rows go in without them
  const raw = await pool.connect(); await raw.query("SET session_replication_role = replica");
  const give = (who, micro, state = 'confirmed') => raw.query(`INSERT INTO workforce_funding_contributions (campaign_id, milestone_id, contributor_user_id, client_id, idempotency_key, operation_id, request_hash, amount_micro, terms_version, restriction, state)
    VALUES ($1,$2,$3,'t',$4,$5,$6,$7,1,'{}'::jsonb,$8)`, [open, ms, who, `key-${crypto.randomUUID()}`, crypto.randomUUID(), hash(), micro, state]);
  await give(giverA, 3_000_000); await give(giverB, 2_000_000); await give(giverB, 9_000_000, 'pending');
  await raw.query("SET session_replication_role = DEFAULT"); raw.release();

  const seen = await view.read(pool, { id: viewer }, pj);
  ok(seen.campaigns.length === 1 && seen.campaigns[0].beneficiary === 'Open fund', 'a viewer sees the open campaign and not the draft');
  ok(JSON.stringify(seen).indexOf(giverA) < 0 && JSON.stringify(seen).indexOf('givera') < 0, 'nothing says who gave');
  const m = seen.campaigns[0].milestones[0];
  ok(m.raisedMicro === 5_000_000 && m.contributors === 2, 'the total counts confirmed money, and how many people');
  ok(m.mineMicro === 0, 'a viewer who gave nothing has no part');
  ok(seen.canPropose === false && seen.canDecide === false, 'a viewer can only read');
  const asOwner = await view.read(pool, { id: owner }, pj);
  ok(asOwner.campaigns.some((c) => c.id === draft) && asOwner.canDecide === true, 'someone who manages the project sees the draft too');
  await writeTuples(pool, { writes: [{ object: `project:${pj}`, relation: 'viewer', subject: `user:${giverA}` }] });
  ok((await view.read(pool, { id: giverA }, pj)).campaigns[0].milestones[0].mineMicro === 3_000_000, 'a person who gave sees their own part');
  ok(await refusal(() => view.read(pool, { id: stranger }, pj), 'project_not_found'), 'someone not on the project is told it does not exist');
  ok(await refusal(() => view.read(pool, { id: viewer }, 'not-a-uuid'), 'project_not_found'), 'a bad id is the same answer');

  // the ceiling
  const balances = async () => (await pool.query('SELECT COALESCE(SUM(balance),0)::text s, (SELECT COUNT(*)::text FROM credit_transactions) n FROM credit_accounts')).rows[0];
  const before = await balances();
  ok(seen.ceiling.limitMicro === null, 'no ceiling to begin with');
  await assert.rejects(() => view.proposeCeiling(pool, { id: viewer }, pj, { credits: 100, requestId: `${tag}-v-1` }), view.ProjectFundingError);
  ok((await pool.query('SELECT 1 FROM workforce_scope_spend_caps WHERE scope_id = $1', [pj])).rowCount === 0, 'a viewer cannot propose one');
  ok(await refusal(() => view.proposeCeiling(pool, { id: editor }, pj, { credits: 1.5, requestId: `${tag}-bad` }), 'ceiling_invalid'), 'the amount has to make sense');
  const asked = await view.proposeCeiling(pool, { id: editor }, pj, { credits: 500, requestId: `${tag}-e-1` });
  ok(asked.state === 'proposed', 'someone with edit access proposes one');
  const replay = await view.proposeCeiling(pool, { id: editor }, pj, { credits: 500, requestId: `${tag}-e-1` });
  ok(replay.proposalId === asked.proposalId, 'pressing twice does not make two');
  let c = (await view.read(pool, { id: viewer }, pj)).ceiling;
  ok(c.limitMicro === null && c.proposedMicro === 500_000_000 && c.proposalId === asked.proposalId, 'a proposal shows, and does not apply yet');
  ok((await view.read(pool, { id: editor }, pj)).ceiling.proposedByMe === true, 'the proposer is told it is theirs');
  await assert.rejects(() => view.decideCeiling(pool, { id: viewer }, pj, asked.proposalId, { approve: true, requestId: `${tag}-v-2` }), view.ProjectFundingError);
  ok((await view.read(pool, { id: owner }, pj)).ceiling.limitMicro === null, 'a viewer cannot decide it');
  const own = await view.proposeCeiling(pool, { id: owner }, pj, { credits: 700, requestId: `${tag}-o-1` });
  ok(await refusal(() => view.decideCeiling(pool, { id: owner }, pj, own.proposalId, { approve: true, requestId: `${tag}-o-2` }), 'independent_budget_approval_required'), 'nobody approves their own');
  const otherPj = (await pool.query(`INSERT INTO chat_projects (owner_user_id, name) VALUES ($1,'Other') RETURNING id`, [admin2])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `project:${otherPj}`, relation: 'owner', subject: `user:${admin2}` }] });
  ok(await refusal(() => view.decideCeiling(pool, { id: admin2 }, otherPj, asked.proposalId, { approve: true, requestId: `${tag}-a-9` }), 'project_not_found'), 'a proposal is decided through its own project');
  await view.decideCeiling(pool, { id: admin2 }, pj, asked.proposalId, { approve: true, requestId: `${tag}-a-1` });
  c = (await view.read(pool, { id: viewer }, pj)).ceiling;
  ok(c.limitMicro === 500_000_000, 'approved by someone else, it applies');
  const after = await balances();
  ok(after.s === before.s && after.n === before.n, 'none of this moved money');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
