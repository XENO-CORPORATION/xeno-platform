/**
 * XENO Compute, the platform half (services/compute.js), against a real Postgres and a fake xeno-compute backend.
 *
 *   - with no backend configured every call refuses `compute_unavailable`; nothing pretends a machine started
 *   - machines belong to the WORKSPACE: viewers read, editors run, a stranger sees nothing
 *   - a size with no price cannot start; only XENO staff set prices; an agent never does
 *   - a start holds an hour on the payer's account and a stop settles the seconds used, on the ONE ledger, as
 *     surface xeno_compute with the machine, workspace and agent on the usage row — the AI-vs-machines split reads it
 *   - the meter rolls the hour; a machine that cannot be funded keeps running, is flagged, and is stopped after the
 *     grace with the reason on its timeline
 *   - caps (workspace / division / agent; machines, size, monthly credits) refuse a start or a bigger machine; only a
 *     person sets them
 *   - the database refuses an illegal state change and a session on an unpriced size even past the service
 *
 *   node src/server/tests/compute.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import { addGrant } from '../utils/creditLedgerV2.js';
import { updateUsageCredits } from '../services/usageCreditsService.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `cmp${Date.now().toString(36)}`;
const calls = [];
const fake = { name: 'fake', create: async (m) => { calls.push(['create', m.id]); return { ref: `fake-${m.id}` }; },
  start: async (m) => { calls.push(['start', m.id]); }, stop: async (m) => { calls.push(['stop', m.id]); }, remove: async (m) => { calls.push(['remove', m.id]); } };
const back = async (machineId, minutes) => pool.query(`UPDATE compute_sessions SET segment_started_at = segment_started_at - ($2 || ' minutes')::interval,
  started_at = started_at - ($2 || ' minutes')::interval WHERE machine_id = $1 AND ended_at IS NULL`, [machineId, String(minutes)]);

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const user = async (s, role = 'user') => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at, role) VALUES ($1,$2,$3,true,true,'x',NOW(),$4) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s, role])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), staff = await user('staff', 'admin');
  const agentU = await user('agent'), agent2U = await user('agent2');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$3),($2,$3)', [agentU, agent2U, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['admin', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' };
  const A = { id: agentU, kind: 'agent' }, A2 = { id: agent2U, kind: 'agent' }, STAFF = { id: staff, kind: 'human', role: 'admin' };
  const w = { workspace: ws };

  // no backend → nothing pretends
  setComputeBackend(null);
  delete process.env.XENO_COMPUTE_API_URL;
  check(await code(() => compute.createMachine(pool, E, { ...w, name: 'x', size: 'small' })) === 'compute_unavailable', 'with no xeno-compute configured, create refuses compute_unavailable');
  check((await pool.query("SELECT state FROM compute_machines WHERE workspace_id = $1", [ws])).rows.every((r) => r.state === 'failed'), 'and the attempt is recorded as failed, never as a machine that exists');
  setComputeBackend(fake);

  // records + ownership
  check(await code(() => compute.createMachine(pool, V, { ...w, name: 'x', size: 'small' })) === 'editor_required', 'a viewer cannot create a machine');
  const m1 = await compute.createMachine(pool, E, { ...w, name: 'Build box', size: 'small', purpose: 'CI', idempotencyKey: 'k1' });
  check(m1.state === 'stopped' && /^mch_[0-9a-f]{32}$/.test(m1.id) && m1.url === `/workspace/dev/spaces/compute/machines/${m1.id}`, 'an editor creates a machine: a stable id, an id-based address, stopped');
  check((await compute.createMachine(pool, E, { ...w, name: 'again', size: 'small', idempotencyKey: 'k1' })).id === m1.id, 'create is idempotent on its key');
  check((await compute.listMachines(pool, V, w)).some((m) => m.id === m1.id), 'a viewer lists the workspace’s machines');
  check(await code(() => compute.getMachine(pool, S, m1.id)) === 'not_a_member', 'a stranger reads nothing');
  check(await code(() => compute.createMachine(pool, E, { ...w, name: 'x', size: 'huge' })) === 'invalid_size', 'an unknown size is refused');

  // prices
  check((await compute.sizes(pool, E)).every((s) => !s.priced && s.creditsPerHour === null), 'every size ships UNPRICED (the owner sets prices)');
  check(await code(() => compute.startMachine(pool, E, m1.id)) === 'no_price', 'an unpriced size cannot start');
  check(await code(() => compute.setRate(pool, O, { size: 'small', creditsPerHour: 36 })) === 'staff_only', 'a workspace owner cannot set a price');
  check(await code(() => compute.setRate(pool, { id: agentU, kind: 'agent', role: 'admin' }, { size: 'small', creditsPerHour: 36 })) === 'staff_only', 'an agent never sets a price, whatever its role column says');
  check((await compute.setRate(pool, STAFF, { size: 'small', creditsPerHour: 36 })).creditsPerHour === 36, 'XENO staff set a price (test value)');

  // run + bill
  await addGrant(pool, editor, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${tag}-topup` });
  const running = await compute.startMachine(pool, E, m1.id);
  check(running.state === 'running' && calls.some((c) => c[0] === 'start' && c[1] === m1.id), 'a start reaches xeno-compute and the machine runs');
  const hold = (await pool.query("SELECT amount_micro, surface FROM credit_holds h JOIN compute_sessions s ON s.hold_id = h.hold_id WHERE s.machine_id = $1 AND h.state = 'held'", [m1.id])).rows[0];
  check(hold && Number(hold.amount_micro) === 36_000_000 && hold.surface === 'xeno_compute', 'an hour is HELD on the payer’s account, on surface xeno_compute');
  check((await compute.startMachine(pool, E, m1.id)).state === 'running', 'start is idempotent');
  await back(m1.id, 30);
  const stopped = await compute.stopMachine(pool, E, m1.id);
  check(stopped.state === 'stopped' && stopped.costSoFarCredits === 18, 'a stop settles the seconds used: 30 minutes at 36/h = 18 credits');
  const u = (await pool.query("SELECT actual_cost_micro, dimensions FROM api_usage_logs WHERE surface = 'xeno_compute' AND dimensions->>'machine_id' = $1", [m1.id])).rows[0];
  check(u && Number(u.actual_cost_micro) === 18_000_000 && u.dimensions.workspace_id === ws, 'the usage row names the machine and workspace');
  const split = await compute.aiVsMachines(pool, editor);
  check(split.machineCredits === 18 && split.aiCredits === 0, 'the AI-vs-machines split reads the same ledger rows');
  check((await compute.usage(pool, V, w)).machineCredits === 18, 'workspace usage reports machine time');

  // the database holds the rules
  check(await code(() => pool.query("UPDATE compute_machines SET state = 'running' WHERE id = $1", [m1.id])) !== null, 'the database refuses running without an open billing session');
  await compute.setRate(pool, STAFF, { size: 'medium', creditsPerHour: null });
  const mMed = await compute.createMachine(pool, E, { ...w, name: 'Medium', size: 'medium' });
  check(await code(() => pool.query("INSERT INTO compute_sessions (machine_id, payer_id, started_by_user_id, rate_micro_per_hour) VALUES ($1,$2,$2,1)", [mMed.id, editor])) !== null, 'the database refuses billing time on an unpriced size');

  // beyond the weekly allowance, paid credits are spent only once the person opts in (billing policy, 2026-09-15)
  check(await code(() => compute.startMachine(pool, E, m1.id)) === 'allowance_used', 'past the weekly allowance a start is refused until paid credits are switched on');
  await updateUsageCredits(pool, editor, true);

  // meter: roll, unfunded, graceful stop
  await compute.startMachine(pool, E, m1.id);
  await back(m1.id, 61);
  const r1 = await compute.meterRunningMachines(pool);
  check(r1.rolled === 1, 'the meter settles an hour that has passed and reserves the next');
  check((await pool.query("SELECT segment_seq FROM compute_sessions WHERE machine_id = $1 AND ended_at IS NULL", [m1.id])).rows[0].segment_seq === 2, 'the next segment is open');
  await pool.query("UPDATE credit_grants SET remaining_micro = 0 WHERE user_id = $1", [editor]);
  await pool.query("UPDATE credit_accounts SET balance = 0 WHERE user_id = $1", [editor]);
  await back(m1.id, 61);
  const r2 = await compute.meterRunningMachines(pool);
  const mid = await compute.getMachine(pool, E, m1.id);
  check(r2.unfunded === 1 && mid.state === 'running' && mid.unfundedSince, 'an unfundable next hour does NOT stop the machine: it keeps running, flagged');
  check(mid.events.some((e) => e.kind === 'unfunded'), 'and its timeline says so');
  await pool.query("UPDATE compute_machines SET unfunded_since = unfunded_since - interval '16 minutes' WHERE id = $1", [m1.id]);
  const r3 = await compute.meterRunningMachines(pool);
  const after = await compute.getMachine(pool, E, m1.id);
  check(r3.stopped === 1 && after.state === 'stopped' && after.events.some((e) => e.kind === 'stopped' && e.detail.reason === 'unfunded'), 'after the grace it is stopped, with the reason on its timeline');

  // caps
  await addGrant(pool, editor, { amountMicro: 500_000_000, kind: 'paid', sourceRef: `${tag}-topup2` });
  await addGrant(pool, owner, { amountMicro: 500_000_000, kind: 'paid', sourceRef: `${tag}-topup3` });
  await updateUsageCredits(pool, owner, true);
  check(await code(() => compute.setCap(pool, E, { ...w, maxMachines: 1 })) === 'admin_required', 'an editor cannot set a cap');
  check(await code(() => compute.setCap(pool, A, { ...w, maxMachines: 1 })) === 'human_only', 'an agent cannot set a cap');
  await compute.setCap(pool, O, { ...w, maxMachines: 2 });
  check(await code(() => compute.createMachine(pool, E, { ...w, name: 'third', size: 'small' })) === 'cap_max_machines', 'the workspace machine limit refuses a new machine');
  await compute.setCap(pool, O, { ...w, maxMachines: null });
  await compute.setCap(pool, O, { ...w, scope: 'agent', scopeId: agentU, maxSize: 'small' });
  check(await code(() => compute.createMachine(pool, A, { ...w, name: 'big', size: 'large' })) === 'cap_max_size', 'an agent’s size cap refuses a bigger machine');
  const am = await compute.createMachine(pool, A, { ...w, name: 'Agent box', size: 'small' });
  check(am.agent && (await compute.getMachine(pool, O, am.id)).agent, 'an agent’s machine is attributed to the agent');
  check(await code(() => compute.stopMachine(pool, A2, am.id)) !== null, 'another agent cannot drive it');
  await compute.setCap(pool, O, { ...w, scope: 'agent', scopeId: agentU, maxSize: 'small', monthlyCredits: 10 });
  check(await code(() => compute.startMachine(pool, A, am.id)) === 'cap_monthly_credits', 'a monthly budget that an hour would exceed refuses the start');
  await compute.setCap(pool, O, { ...w, scope: 'agent', scopeId: agentU });
  check((await compute.listCaps(pool, V, w)).every((c) => c.scope !== 'agent'), 'clearing every limit removes the cap');
  const ar = await compute.startMachine(pool, A, am.id);
  const au = (await pool.query("SELECT payer_id FROM compute_sessions WHERE machine_id = $1 AND ended_at IS NULL", [am.id])).rows[0];
  check(ar.state === 'running' && String(au.payer_id) === String(owner), 'an agent’s machine time is paid by its owner (one quota per human)');
  await compute.stopMachine(pool, A, am.id);

  // delete
  await compute.startMachine(pool, E, m1.id);
  check(await code(() => compute.deleteMachine(pool, E, m1.id)) === 'still_running', 'a running machine cannot be deleted');
  await compute.stopMachine(pool, E, m1.id);
  const del = await compute.deleteMachine(pool, E, m1.id);
  check(del.state === 'deleted' && calls.some((c) => c[0] === 'remove' && c[1] === m1.id), 'a stopped machine is deleted through xeno-compute');
  check(await code(() => pool.query("UPDATE compute_machines SET state = 'stopped', deleted_at = NULL WHERE id = $1", [m1.id])) !== null, 'the database refuses bringing a deleted machine back');
  check(!(await compute.listMachines(pool, V, w)).some((m) => m.id === m1.id), 'a deleted machine leaves the list');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
