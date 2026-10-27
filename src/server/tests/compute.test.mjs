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
 *   - a command or file reaches only a RUNNING machine, by an editor or the agent it works for; output survives a
 *     UTF-8 character split across chunks; argv is a list and the timeout is bounded
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
  start: async (m) => { calls.push(['start', m.id]); return { state: 'running', restored: { bytes: 2048 } }; }, stop: async (m) => { calls.push(['stop', m.id]); return { state: 'stopped', saved: { bytes: 4096 }, saveError: null }; }, remove: async (m) => { calls.push(['remove', m.id]); },
  // exec answers like the machine: NDJSON lines, base64 chunks. 'é' (c3 a9) is split across two chunks on purpose.
  exec: async (m, body) => { calls.push(['exec', m.id, body]);
    const line = (o) => JSON.stringify(o) + '\n';
    if (body.argv[0] === 'xeno') {
      // the agent CLI: record whether its key was live while it ran, then answer like `xeno run --json`
      const k = body.env?.XENO_API_KEY || '';
      fake.keyLive = (await pool.query("SELECT is_active FROM api_keys WHERE key_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [k])).rows[0]?.is_active === true;
      fake.lastKey = k;
      if (fake.agentFails) throw Object.assign(new Error('machine went away'), { code: 'exec_failed', statusCode: 502 });
      const res = JSON.stringify({ status: 'ok', answer: 'Created add.py; it prints 5.', token_usage: { total: 1234 }, tool_summary: { total_calls: 2, permission_denied: 0 }, session_id: 's1' });
      const out = line({ stream: 'stdout', data: Buffer.from(res + '\n').toString('base64') }) + line({ done: true, exitCode: 0, signal: null, timedOut: false });
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(out)); c.close(); } }));
    }
    const parts = [line({ stream: 'stdout', data: Buffer.from([0x68, 0xc3]).toString('base64') }),
      line({ stream: 'stdout', data: Buffer.from([0xa9, 0x0a]).toString('base64') }) + line({ stream: 'stderr', data: Buffer.from('warn').toString('base64') }).slice(0, 10),
      line({ stream: 'stderr', data: Buffer.from('warn').toString('base64') }).slice(10) + line({ done: true, exitCode: 3, signal: null, timedOut: false })];
    return new Response(new ReadableStream({ start(c) { for (const x of parts) c.enqueue(new TextEncoder().encode(x)); c.close(); } })); },
  files: new Map(),
  readFile: async (m, path) => { if (!fake.files.has(path)) throw Object.assign(new Error('No such file'), { code: 'not_found', statusCode: 502 }); return fake.files.get(path); },
  writeFile: async (m, path, buf) => { fake.files.set(path, Buffer.from(buf)); return { path: `/home/xeno/${path}`, bytes: buf.length }; } };
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
  const tl = (await compute.getMachine(pool, E, m1.id)).events;
  check(tl.some((e) => e.kind === 'stopped' && e.detail.savedBytes === 4096) && tl.some((e) => e.kind === 'started' && e.detail.restoredBytes === 2048), 'the timeline says the home folder was put back on start and saved on stop');
  check((await compute.getMachine(pool, E, m1.id)).homeBytes === 4096, 'the machine records how big its saved home folder is (what Storage counts)');
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

  // commands and files
  check(await code(() => compute.execMachine(pool, E, m1.id, { argv: ['id'] })) === 'machine_not_running', 'a command on a stopped machine is refused');
  await compute.startMachine(pool, E, m1.id);
  const ex = await compute.execMachine(pool, E, m1.id, { argv: ['sh', '-c', 'x'], stdin: 'in', timeoutMs: 5000 });
  check(ex.exitCode === 3 && ex.stdout === 'h\u00e9\n' && ex.stderr === 'warn' && !ex.timedOut, 'an editor runs a command: exit code, and text that survives a character split across chunks');
  const sent = calls.filter((c) => c[0] === 'exec').at(-1)[2];
  check(Buffer.from(sent.stdin, 'base64').toString() === 'in' && sent.timeoutMs === 5000, 'stdin and the timeout reach the machine');
  check(await code(() => compute.execMachine(pool, V, m1.id, { argv: ['id'] })) === 'editor_required', 'a viewer cannot run a command');
  check(await code(() => compute.execMachine(pool, S, m1.id, { argv: ['id'] })) === 'not_a_member', 'a stranger cannot run a command');
  check(await code(() => compute.execMachine(pool, E, m1.id, { argv: 'rm -rf /' })) === 'invalid_argv', 'a shell line is refused: argv is a list');
  check(await code(() => compute.execMachine(pool, E, m1.id, { argv: ['id'], timeoutMs: 31 * 60_000 })) === 'invalid_timeout', 'a command cannot run without a bounded timeout');
  await compute.startMachine(pool, A, am.id);
  check(await code(() => compute.execMachine(pool, A2, am.id, { argv: ['id'] })) === 'not_your_machine', 'an agent cannot run commands on another agent’s machine');
  check((await compute.execMachine(pool, A, am.id, { argv: ['id'] })).exitCode === 3, 'an agent runs commands on its own machine');
  await compute.stopMachine(pool, A, am.id);
  check((await compute.writeMachineFile(pool, E, m1.id, { path: 'a/b.txt', content: 'h\u00e9' })).bytes === 3, 'an editor writes a file');
  check((await compute.readMachineFile(pool, E, m1.id, { path: 'a/b.txt' })).toString('utf8') === 'h\u00e9', 'and reads the same bytes back');
  check(await code(() => compute.readMachineFile(pool, V, m1.id, { path: 'a/b.txt' })) === 'editor_required', 'a viewer cannot read a machine’s files');

  // the XENO Agent on a machine: one task, its own short-lived key, two access modes
  check(await code(() => compute.runAgentTask(pool, E, m1.id, { prompt: '  ' })) === 'invalid_prompt', 'an agent task needs a prompt');
  check(await code(() => compute.runAgentTask(pool, E, m1.id, { prompt: 'x', access: 'root' })) === 'invalid_access', 'access is listed or full, nothing else');
  check(await code(() => compute.runAgentTask(pool, E, m1.id, { prompt: 'x', folder: '../etc' })) === 'invalid_folder', 'the task folder stays inside the home folder');
  check(await code(() => compute.runAgentTask(pool, V, m1.id, { prompt: 'x' })) === 'editor_required', 'a viewer cannot run an agent task');
  const t1 = await compute.runAgentTask(pool, E, m1.id, { prompt: 'make add.py print 2+3', folder: 'proj' });
  const run1 = calls.filter((c) => c[0] === 'exec' && c[2].argv[0] === 'xeno').at(-1)[2];
  check(t1.status === 'ok' && t1.answer.includes('prints 5') && t1.tokens === 1234 && t1.access === 'listed', 'an editor runs an agent task and gets its answer');
  check(run1.argv.includes('acceptEdits') && !run1.argv.includes('--bypass-permissions') && !run1.env.XENO_ALLOW_UNSAFE_BYPASS, 'by default it runs with LISTED access, never bypassing permissions');
  const pf = run1.argv[run1.argv.indexOf('--prompt-file') + 1];
  check(!run1.argv.join(' ').includes('add.py') && fake.files.get(pf)?.toString() === 'make add.py print 2+3' && run1.cwd === 'proj', 'the prompt goes in a file, not on the command line, and it runs in the chosen folder');
  check(calls.some((c) => c[0] === 'exec' && c[2].argv[0] === 'rm' && c[2].argv.includes(pf)), 'and the prompt file is removed after the task');
  check(/^xeno-[0-9a-f]{48}$/.test(run1.env.XENO_API_KEY) && fake.keyLive === true, 'it gets its own model key, live while it runs');
  check((await pool.query("SELECT is_active FROM api_keys WHERE key_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [fake.lastKey])).rows[0].is_active === false, 'and the key is revoked when the task ends');
  await compute.runAgentTask(pool, E, m1.id, { prompt: 'do anything', access: 'full' });
  const run2 = calls.filter((c) => c[0] === 'exec' && c[2].argv[0] === 'xeno').at(-1)[2];
  check(run2.argv.includes('--bypass-permissions') && run2.env.XENO_ALLOW_UNSAFE_BYPASS === '1', 'FULL access turns permission checks off for that task only');
  fake.agentFails = true;
  check(await code(() => compute.runAgentTask(pool, E, m1.id, { prompt: 'x' })) === 'exec_failed', 'a task whose machine fails reports it');
  fake.agentFails = false;
  check((await pool.query("SELECT is_active FROM api_keys WHERE key_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [fake.lastKey])).rows[0].is_active === false, 'and its key is revoked even then');
  const tasks = (await compute.getMachine(pool, E, m1.id)).events.filter((e) => e.kind === 'agent_task');
  check(tasks.length === 2 && tasks.some((e) => e.detail.access === 'full') && !JSON.stringify(tasks).includes('add.py'), 'the timeline records each task and its access, not what it was asked');

  // idle: a machine nobody uses stops by itself
  check((await compute.getMachine(pool, E, m1.id)).idleStopMinutes === 30, 'a new machine stops itself after 30 idle minutes by default');
  check(await code(() => compute.setIdleStop(pool, E, m1.id, { idleStopMinutes: 2 })) === 'invalid_idle', 'an idle limit under 5 minutes is refused');
  check(await code(() => compute.setIdleStop(pool, V, m1.id, { idleStopMinutes: 60 })) === 'editor_required', 'a viewer cannot change the idle limit');
  check((await compute.setIdleStop(pool, E, m1.id, { idleStopMinutes: 10 })).idleStopMinutes === 10, 'an editor sets the idle limit');
  await pool.query("UPDATE compute_machines SET last_active_at = now() - interval '9 minutes' WHERE id = $1", [m1.id]);
  check((await compute.meterRunningMachines(pool)).idle === 0 && (await compute.getMachine(pool, E, m1.id)).state === 'running', 'a machine used 9 minutes ago keeps running under a 10 minute limit');
  await compute.execMachine(pool, E, m1.id, { argv: ['id'], timeoutMs: 20 * 60_000 });
  const busyUntil = new Date((await compute.getMachine(pool, E, m1.id)).lastActiveAt).getTime();
  check(busyUntil > Date.now() + 19 * 60_000, 'a command keeps the machine in use until its deadline');
  await pool.query("UPDATE compute_machines SET last_active_at = now() - interval '11 minutes' WHERE id = $1", [m1.id]);
  const ri = await compute.meterRunningMachines(pool);
  const idled = await compute.getMachine(pool, E, m1.id);
  check(ri.idle === 1 && idled.state === 'stopped' && idled.events.some((e) => e.kind === 'stopped' && e.detail.reason === 'idle'), 'past its idle limit the meter stops it, with "idle" on its timeline');
  check(!(await pool.query("SELECT 1 FROM compute_sessions WHERE machine_id = $1 AND ended_at IS NULL", [m1.id])).rows.length, 'and its billing session is closed');
  check((await compute.setIdleStop(pool, E, m1.id, { idleStopMinutes: null })).idleStopMinutes === null, 'the idle stop can be turned off');
  await compute.startMachine(pool, E, m1.id);
  await pool.query("UPDATE compute_machines SET last_active_at = now() - interval '3 days' WHERE id = $1", [m1.id]);
  check((await compute.meterRunningMachines(pool)).idle === 0 && (await compute.getMachine(pool, E, m1.id)).state === 'running', 'with it off, a machine is never stopped for idleness');

  // delete
  check(await code(() => compute.deleteMachine(pool, E, m1.id)) === 'still_running', 'a running machine cannot be deleted');
  await compute.stopMachine(pool, E, m1.id);
  const del = await compute.deleteMachine(pool, E, m1.id);
  check(del.state === 'deleted' && calls.some((c) => c[0] === 'remove' && c[1] === m1.id), 'a stopped machine is deleted through xeno-compute');
  check(await code(() => pool.query("UPDATE compute_machines SET state = 'stopped', deleted_at = NULL WHERE id = $1", [m1.id])) !== null, 'the database refuses bringing a deleted machine back');
  check(!(await compute.listMachines(pool, V, w)).some((m) => m.id === m1.id), 'a deleted machine leaves the list');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
