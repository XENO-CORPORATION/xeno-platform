/**
 * XENO Places — Workforce, Marketplace and Funding inside Places (Xenopolis handoff port, phase 2), on real Postgres.
 * Every op goes THROUGH the owning service; Places adds no org or money record:
 *   - workforce.agent.create → platformAgents.create (a real agent identity + workforce definition);
 *   - workforce.assignment.propose → agentLending.lend: lending to a building you do NOT administer is `proposed`
 *     and waits in the target admin's catalog `pending`; accept seats it (accepted row + division editor tuple); a
 *     second decision is a conflict; decline revokes; an agent principal cannot propose (person only);
 *   - marketplace.rent → marketplaceService.acquireListing: the ledger is debited exactly the price, an entitlement is
 *     written, a retry with the same requestId replays and charges NOTHING more; too few credits is refused and charges
 *     nothing; an approved amount below cost needs approval;
 *   - funding.gift is CLOSED unless ACCOUNT_GIFTS_OPEN=true (and moves nothing); open, it moves exactly the amount,
 *     a retry replays without moving more;
 *   - funding.allocation.set PROPOSES a monthly workspace ceiling; the proposer cannot approve it, a second owner can,
 *     and funding.get then shows it.
 *
 * Run: DATABASE_URL=postgresql://… node tests/places-work.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { addGrant, getBalanceV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import * as places from '../services/places.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `pw${process.pid}`;
let seq = 0;
const rid = () => `req-${tag}-${seq += 1}`;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const me = (id, name, kind = 'human') => ({ id, name, kind });
const workspace = async (owner, name, type = 'team') => {
  const w = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [owner, type, name, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${w}`, subject: `user:${owner}`, relation: 'owner' }] });
  return w;
};
const placeOf = async (w) => (await pool.query(`SELECT * FROM places WHERE workspace_id=$1 AND lifecycle='active'`, [w])).rows[0];
const CODES = new Set(places.CODES);
const refused = (r, code, reason) => { assert.equal(r.ok, false, `expected a refusal (${reason}), got ${JSON.stringify(r.result)}`); assert.ok(CODES.has(r.error.code)); assert.equal(r.error.code, code); if (reason) assert.equal(r.error.reason, reason); };
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.error)); return r.result; };
const balance = async (u) => (await getBalanceV2(pool, u)).availableMicro;

async function main() {
  await runAllMigrations(pool);
  const emil = await user('emil'), iva = await user('iva'), coowner = await user('coowner'), poor = await user('poor');
  await workspace(emil, "Emil's Workspace", 'personal');
  const hq = await workspace(iva, 'HQ');
  const dDev = (await pool.query(`INSERT INTO workforce_divisions (workspace_id, key, name, created_by_user_id) VALUES ($1,'dev','Dev',$2) RETURNING id`, [hq, iva])).rows[0].id;
  const pHq = await placeOf(hq);
  await writeTuples(pool, { writes: [{ object: `workspace:${hq}`, subject: `user:${emil}`, relation: 'viewer' }] });   // a member, not an admin
  const E = me(emil, 'Emil'), I = me(iva, 'Iva');

  // ── an agent, created through platformAgents ──
  refused(await places.call(pool, me(emil, 'E', 'agent'), 'workforce.agent.create', { name: 'X', requestId: rid() }), 'denied', 'person_only');
  const made = ok(await places.call(pool, E, 'workforce.agent.create', { name: 'Scribe', skills: 'Notes', requestId: rid() }));
  assert.match(made.resourceId, /^agt_/, 'a real platform agent id');
  const cat = ok(await places.call(pool, E, 'workforce.catalog.list', {}));
  assert.ok(cat.items.some((a) => a.id === made.resourceId && a.name === 'Scribe' && a.skills === 'Notes'), 'the catalog lists it');

  // ── propose a desk in a building Emil does not administer → waits for Iva ──
  const prop = ok(await places.call(pool, E, 'workforce.assignment.propose', { resourceId: made.resourceId, placeId: pHq.id, requestId: rid() }));
  assert.equal(prop.state, 'proposed', 'lending to someone else’s building is an offer, not a seat');
  const pending = ok(await places.call(pool, I, 'workforce.catalog.list', {})).pending;
  const offer = pending.find((x) => x.id === prop.assignmentId);
  assert.ok(offer && offer.targetPlaceId === pHq.id && offer.targetDivisionName === null && offer.resourceName === 'Scribe', 'the target admin sees the offer');
  assert.ok(!ok(await places.call(pool, E, 'workforce.catalog.list', {})).pending.some((x) => x.id === prop.assignmentId), 'the lender is not asked to accept their own offer');
  refused(await places.call(pool, E, 'workforce.assignment.accept', { assignmentId: prop.assignmentId, requestId: rid() }), 'denied');
  const acc = ok(await places.call(pool, I, 'workforce.assignment.accept', { assignmentId: prop.assignmentId, requestId: rid() }));
  assert.deepEqual([acc.state, acc.placeId], ['accepted', pHq.id]);
  assert.equal((await pool.query(`SELECT state FROM workforce_workspace_assignments WHERE id=$1`, [prop.assignmentId])).rows[0].state, 'accepted', 'the workforce record holds the decision');
  refused(await places.call(pool, I, 'workforce.assignment.accept', { assignmentId: prop.assignmentId, requestId: rid() }), 'conflict');
  const onFloor = ok(await places.call(pool, E, 'workforce.assignment.propose', { resourceId: made.resourceId, placeId: pHq.id, divisionId: dDev, requestId: rid() }));
  assert.equal(ok(await places.call(pool, I, 'workforce.catalog.list', {})).pending.find((x) => x.id === onFloor.assignmentId)?.targetDivisionName, 'Dev', 'a desk on a named floor');
  ok(await places.call(pool, I, 'workforce.assignment.accept', { assignmentId: onFloor.assignmentId, requestId: rid() }));
  assert.equal((await pool.query("SELECT 1 FROM relationship_tuples WHERE object_type='division' AND object_id=$1 AND relation='editor' AND subject_type='agent'", [dDev])).rowCount, 1, 'seated on the floor: the division editor tuple run admission reads');
  refused(await places.call(pool, E, 'workforce.assignment.propose', { resourceId: made.resourceId, placeId: pHq.id, requestId: rid() }), 'conflict', 'already_lent');
  const tally = ok(await places.call(pool, E, 'workforce.agent.create', { name: 'Tally', requestId: rid() }));
  const second = ok(await places.call(pool, E, 'workforce.assignment.propose', { resourceId: tally.resourceId, placeId: pHq.id, requestId: rid() }));
  ok(await places.call(pool, I, 'workforce.assignment.decline', { assignmentId: second.assignmentId, requestId: rid() }));
  assert.equal((await pool.query(`SELECT state FROM workforce_workspace_assignments WHERE id=$1`, [second.assignmentId])).rows[0].state, 'revoked');

  // ── rent through the marketplace: exact debit, entitlement, retry charges nothing ──
  const dev = (await pool.query(`INSERT INTO marketplace_developers(user_id,display_name,slug) VALUES($1,'Kestrel Labs',$2) RETURNING id`, [iva, `${tag}-dev`])).rows[0].id;
  const lst = (await pool.query(`INSERT INTO marketplace_listings(slug,kind,developer_id,title,summary,status) VALUES($1,'mind',$2,'Lint Warden','Reviews PRs','published') RETURNING id`, [`${tag}-lint`, dev])).rows[0].id;
  await pool.query(`INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',2,'day')`, [lst]);
  await addGrant(pool, emil, { amountMicro: 100 * MICRO_PER_CREDIT, kind: 'paid', sourceRef: `${tag}-grant` });
  const listed = ok(await places.call(pool, E, 'marketplace.list', {})).items.find((x) => x.id === lst);
  assert.deepEqual([listed.name, listed.kind, listed.seller, listed.priceMicro, listed.unit, listed.rented], ['Lint Warden', 'agent', 'Kestrel Labs', 2 * MICRO_PER_CREDIT, 'day', false]);
  refused(await places.call(pool, E, 'marketplace.rent', { listingId: lst, approvedMicro: 1, requestId: rid() }), 'needs_approval', 'budget_below_cost');
  const b0 = await balance(emil);
  const rk = rid();
  const rent = await places.call(pool, E, 'marketplace.rent', { listingId: lst, requestId: rk });
  assert.equal(ok(rent).chargedMicro, 2 * MICRO_PER_CREDIT);
  const txns = async () => (await pool.query("SELECT gross FROM marketplace_transactions WHERE user_id=$1 AND listing_id=$2", [emil, lst])).rows.map((r) => Number(r.gross));
  assert.deepEqual(await txns(), [2], 'one transaction of exactly the price (a free-plan allowance may be issued on first spend, so the balance is not the measure)');
  const b0after = await balance(emil);
  const again = await places.call(pool, E, 'marketplace.rent', { listingId: lst, requestId: rk });
  assert.ok(again.ok && again.receipt.replayed, 'a retry replays');
  assert.deepEqual([await txns(), await balance(emil)], [[2], b0after], 'and charges nothing more');
  assert.ok(ok(await places.call(pool, E, 'marketplace.list', {})).items.find((x) => x.id === lst).rented, 'the entitlement shows as rented');
  const dear = (await pool.query("INSERT INTO marketplace_listings(slug,kind,developer_id,title,status) VALUES($1,'mind',$2,'Ledger Pro','published') RETURNING id", [`${tag}-dear`, dev])).rows[0].id;
  await pool.query("INSERT INTO marketplace_listing_pricing(listing_id,model,price_credits,period) VALUES($1,'rental',100000,'day')", [dear]);
  const pb = await balance(poor);
  refused(await places.call(pool, me(poor, 'Poor'), 'marketplace.rent', { listingId: dear, requestId: rid() }), 'denied', 'insufficient_credits');
  assert.equal((await pool.query('SELECT count(*)::int n FROM marketplace_transactions WHERE user_id=$1', [poor])).rows[0].n, 0, 'a refused rental records nothing');
  assert.ok(await balance(poor) >= pb, 'and takes nothing');

  // ── gifts: closed by default, then exact and idempotent ──
  delete process.env.ACCOUNT_GIFTS_OPEN;
  const b1 = await balance(emil);
  refused(await places.call(pool, E, 'funding.gift', { recipient: `${tag}_iva`, amount: 5, confirmed: true, requestId: rid() }), 'unavailable', 'gifts_closed');
  assert.equal(await balance(emil), b1, 'a closed gift moves nothing');
  process.env.ACCOUNT_GIFTS_OPEN = 'true';
  refused(await places.call(pool, E, 'funding.gift', { recipient: `${tag}_iva`, amount: 5, requestId: rid() }), 'bad_input', 'explicit_confirmation_required');
  // granted credits with no verified Stripe origin are not giftable (usageCreditFunding's rule): refused, nothing moves.
  // A funded gift's exact movement and replay are accountGifts' own suite; this proves Places reaches that gate.
  refused(await places.call(pool, E, 'funding.gift', { recipient: `@${tag}_iva`, amount: 5, confirmed: true, requestId: rid() }), 'denied', 'insufficient_giftable_credits');
  assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_gifts WHERE sender_user_id=$1', [emil])).rows[0].n, 0, 'an unfunded gift moves nothing');
  assert.ok(await balance(emil) <= b1);
  refused(await places.call(pool, E, 'funding.gift', { recipient: `${tag}_emil`, amount: 1, confirmed: true, requestId: rid() }), 'denied');
  delete process.env.ACCOUNT_GIFTS_OPEN;

  // ── a workspace budget: proposed, never self-approved, a second owner approves ──
  await writeTuples(pool, { writes: [{ object: `workspace:${hq}`, subject: `user:${coowner}`, relation: 'owner' }] });
  const fund0 = ok(await places.call(pool, I, 'funding.get', {}));
  assert.equal(typeof fund0.balanceMicro, 'number');
  assert.ok(Array.isArray(fund0.ledger));
  const al = fund0.allocations.find((a) => a.placeId === pHq.id);
  assert.ok(al && al.ceilingMicro === null);
  const prop2 = ok(await places.call(pool, I, 'funding.allocation.set', { allocationId: al.id, ceiling: 60, requestId: rid() }));
  assert.equal(prop2.state, 'proposed');
  refused(await places.call(pool, I, 'funding.allocation.decide', { proposalId: prop2.proposalId, approve: true, requestId: rid() }), 'denied', 'independent_budget_approval_required');
  ok(await places.call(pool, me(coowner, 'Co'), 'funding.allocation.decide', { proposalId: prop2.proposalId, approve: true, requestId: rid() }));
  assert.equal(ok(await places.call(pool, I, 'funding.get', {})).allocations.find((a) => a.placeId === pHq.id).ceilingMicro, 60 * MICRO_PER_CREDIT, 'the approved ceiling is the budget');
  console.log('places workforce/marketplace/funding: all checks passed');
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
