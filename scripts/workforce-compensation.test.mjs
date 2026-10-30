/**
 * XENO workforce compensation (owner, 2026-10-29: "Agreements + credits, a person approves"; spec D13: nothing pays
 * implicitly). Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceCompensation.js and the
 * real credits ledger: agreements, payouts prepared from the work report, a person's decision, money moved once.
 *
 * Mutation-checked: see the bottom of this file's header in the PR (each fails the named assertion).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('compensation: agreements, payouts prepared from the work report, decided by a person, paid once (D13)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  const C = await import('../src/server/services/workforceCompensation.js');
  const { ensureWorkspaceWallet } = await import('../src/server/services/walletService.js');
  const { addGrant } = await import('../src/server/utils/creditLedgerV2.js');
  const marker = `comp-${randomUUID().slice(0, 8)}`;
  const user = async (s, name = s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$3,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`, name])).rows[0].id;
  const owner = await user('owner', 'Olga'), worker = await user('worker', 'Wim'), member = await user('member', '=SUM(A1)'), stranger = await user('stranger');
  const agentUser = await user('agent', 'Scout');
  await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agentUser, worker]);
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  for (const [rel, u] of [['owner', owner], ['editor', worker], ['viewer', member]]) {
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)`, [ws, rel, u]);
  }
  await pool.query(`INSERT INTO workforce_employee_profiles(workspace_id,principal_id,updated_by_user_id) VALUES($1,$2,$3)`, [ws, agentUser, owner]);
  // the workspace wallet holds 100 credits
  await ensureWorkspaceWallet(pool, ws);
  await addGrant(pool, ws, { amountMicro: 100_000_000, kind: 'paid', sourceRef: `${marker}-fund` });
  const balance = async (id) => BigInt((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [id])).rows[0]?.balance ?? 0);
  const ctx = (id) => ({ actorUserId: id });
  const code = (p) => p.then(() => 'allowed', (e) => e.code || e.message);

  // A finished week: the worker had two tasks ACCEPTED by the owner from review, and closed one without review.
  const day = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return d; };
  const weekStart = day(9).toISOString().slice(0, 10), inWeek = new Date(day(9).getTime() + 86_400_000).toISOString();
  const proj = (await pool.query(`INSERT INTO chat_projects(user_id,owner_user_id,workspace_id,created_by_user_id,updated_by_user_id,name)
    VALUES(NULL,NULL,$1,$2,$2,'Pay') RETURNING id`, [ws, owner])).rows[0].id;
  const ev = (tid, actor, kind, from, to) => pool.query(`INSERT INTO task_events(task_id,actor_id,actor_kind,kind,from_value,to_value,created_at) VALUES($1,$2,'human',$3,$4,$5,$6)`, [tid, actor, kind, from, to, inWeek]);
  const accepted = [];
  for (const how of ['accepted', 'accepted', 'unreviewed']) {
    const tid = (await pool.query(`INSERT INTO tasks(title,project_id,reporter_id,assignee_id,status) VALUES('t',$1,$2,$3,'done') RETURNING id`, [proj, owner, worker])).rows[0].id;
    if (how === 'accepted') { await ev(tid, worker, 'status', 'in_progress', 'in_review'); await ev(tid, owner, 'status', 'in_review', 'done'); accepted.push(tid); }
    else await ev(tid, worker, 'status', 'in_progress', 'done');
  }

  let workerAgreement;
  await t.test('only a human administrator sets how a member is paid; a new agreement ends the old one', async () => {
    const set = (actor, v) => C.setAgreement(pool, ctx(actor), { workspaceId: ws, period: 'week', startsOn: day(30).toISOString().slice(0, 10), ...v });
    await set(owner, { principalId: worker, basis: 'per_period', amountMicro: '1000000' });
    workerAgreement = (await set(owner, { principalId: worker, basis: 'per_accepted_task', amountMicro: '20000000', note: 'per accepted task' })).agreement;
    const rows = (await pool.query('SELECT state FROM workforce_comp_agreements WHERE workspace_id=$1 AND principal_id=$2 ORDER BY created_at', [ws, worker])).rows.map((r) => r.state);
    assert.deepEqual(rows, ['ended', 'active'], 'the earlier agreement ended, it was not overwritten');
    await set(owner, { principalId: agentUser, basis: 'per_period', amountMicro: '5000000' });
    await set(owner, { principalId: member, basis: 'salary_recorded', salary: { amountMinor: '400000', currency: 'EUR' }, period: 'month' });
    assert.equal(await code(set(worker, { principalId: member, basis: 'per_period', amountMicro: '1' })), 'not_found', 'an editor cannot set pay');
    assert.equal(await code(set(agentUser, { principalId: member, basis: 'per_period', amountMicro: '1' })), 'not_found', 'an agent cannot set pay');
    assert.equal(await code(set(owner, { principalId: stranger, basis: 'per_period', amountMicro: '1' })), 'not_found', 'only a member of the workspace is paid by it');
    assert.equal(await code(set(owner, { principalId: worker, basis: 'per_period' })), 'bad_input', 'a basis carries its amount');
    await assert.rejects(pool.query(`INSERT INTO workforce_comp_agreements(workspace_id,principal_id,basis,amount_micro,starts_on,created_by_user_id)
      VALUES($1,$2,'per_period',1,current_date,$3)`, [ws, stranger, agentUser]), /never an agent/, 'the database refuses an agent too');
    const own = await C.listAgreements(pool, ctx(worker), { workspaceId: ws });
    assert.deepEqual([own.canManage, own.agreements.map((a) => a.principalId).every((p) => p === worker)], [false, true], 'a member sees only their own');
  });

  let prepared;
  await t.test('payouts are PREPARED from the agreement and the member\'s own work report; salaries are not payouts', async () => {
    assert.equal(await code(C.preparePayouts(pool, ctx(worker), { workspaceId: ws, periodStart: weekStart, period: 'week' })), 'not_found');
    assert.equal(await code(C.preparePayouts(pool, ctx(owner), { workspaceId: ws, periodStart: day(2).toISOString().slice(0, 10), period: 'week' })), 'bad_input', 'a period still running is not prepared');
    prepared = await C.preparePayouts(pool, ctx(owner), { workspaceId: ws, periodStart: weekStart, period: 'week' });
    const w = prepared.prepared.find((p) => p.principalId === worker), a = prepared.prepared.find((p) => p.principalId === agentUser);
    assert.equal(w.evidence.acceptedByHuman, 2, 'two tasks a person accepted; the one closed without review does not count');
    assert.deepEqual([...w.evidence.taskIds].sort(), [...(await pool.query('SELECT id FROM tasks WHERE project_id=$1', [proj])).rows.map((r) => r.id)].sort(), 'the tasks behind it are named');
    assert.equal(w.preparedMicro, '40000000', '2 × 20 credits');
    assert.equal(a.amountMicro, '5000000');
    assert.equal(a.payeeUserId, worker, 'an agent\'s pay goes to its owner');
    assert.equal(prepared.prepared.some((p) => p.principalId === member), false, 'a recorded salary is exported, never paid here');
    assert.ok([w, a].every((p) => p.state === 'prepared'), 'prepared, not paid: the counts never decide');
    const again = await C.preparePayouts(pool, ctx(owner), { workspaceId: ws, periodStart: weekStart, period: 'week' });
    assert.deepEqual([again.prepared.length, again.existing.length], [0, 2], 'preparing twice makes nothing twice');
  });

  await t.test('a person approves (here with an edited amount) and it is paid exactly once from the workspace wallet', async () => {
    const w = prepared.prepared.find((p) => p.principalId === worker);
    const ws0 = await balance(ws), wk0 = await balance(worker);
    assert.equal(await code(C.decidePayout(pool, ctx(worker), { workspaceId: ws, payoutId: w.id, decision: 'approve' })), 'not_found', 'a member does not approve their own pay');
    const r = await C.decidePayout(pool, ctx(owner), { workspaceId: ws, payoutId: w.id, decision: 'approve', amountMicro: '30000000', note: 'one was small' });
    assert.deepEqual([r.payout.state, r.payout.amountMicro, r.payout.preparedMicro], ['paid', '30000000', '40000000'], 'the person\'s amount, the prepared one kept beside it');
    assert.equal(await balance(ws), ws0 - 30_000_000n, 'the workspace wallet paid it');
    assert.equal(await balance(worker), wk0 + 30_000_000n, 'the member received it');
    await C.decidePayout(pool, ctx(owner), { workspaceId: ws, payoutId: w.id, decision: 'approve' });
    await C.payApproved(pool, (await pool.query('SELECT * FROM workforce_comp_payouts WHERE id=$1', [w.id])).rows[0]);
    assert.deepEqual([await balance(ws), await balance(worker)], [ws0 - 30_000_000n, wk0 + 30_000_000n], 'a retry pays nothing more');
    const refs = (await pool.query(`SELECT count(*)::int n FROM credit_transactions WHERE reference_id=$1`, [`ws-comp:${w.id}`])).rows[0].n;
    assert.equal(refs, 2, 'one debit and one credit on the journal');
  });

  await t.test('a skipped payout moves nothing; a decided one is fixed; nothing is deleted', async () => {
    const a = prepared.prepared.find((p) => p.principalId === agentUser);
    const ws0 = await balance(ws);
    const r = await C.decidePayout(pool, ctx(owner), { workspaceId: ws, payoutId: a.id, decision: 'skip', note: 'paused this week' });
    assert.equal(r.payout.state, 'skipped');
    assert.equal(await balance(ws), ws0, 'skipping pays nothing');
    await assert.rejects(pool.query('UPDATE workforce_comp_payouts SET amount_micro=1 WHERE id=$1', [a.id]), /cannot move|fixed|keeps/, 'a decided payout is fixed');
    await assert.rejects(pool.query('DELETE FROM workforce_comp_payouts WHERE id=$1', [a.id]), /retained/);
    await assert.rejects(pool.query('DELETE FROM workforce_comp_agreements WHERE id=$1', [workerAgreement.id]), /retained/);
    // an agent cannot decide, even writing the row itself
    const fresh = (await pool.query(`INSERT INTO workforce_comp_payouts(workspace_id,agreement_id,principal_id,payee_user_id,period_start,period_end,evidence,prepared_micro,amount_micro,prepared_by_user_id)
      VALUES($1,$2,$3,$3,'2020-01-01','2020-01-08','{}',1,1,$4) RETURNING id`, [ws, workerAgreement.id, worker, owner])).rows[0].id;
    await assert.rejects(pool.query("UPDATE workforce_comp_payouts SET state='approved', decided_by_user_id=$2, decided_at=now() WHERE id=$1", [fresh, agentUser]), /never an agent/);
  });

  await t.test('an empty wallet refuses to pay and moves nothing; funding it and retrying pays', async () => {
    const big = await C.setAgreement(pool, ctx(owner), { workspaceId: ws, principalId: agentUser, basis: 'per_period', amountMicro: '900000000', period: 'week', startsOn: day(30).toISOString().slice(0, 10) });
    const earlier = day(16).toISOString().slice(0, 10);
    const pp = (await C.preparePayouts(pool, ctx(owner), { workspaceId: ws, periodStart: earlier, period: 'week' })).prepared.find((p) => p.agreementId === big.agreement.id);
    const ws0 = await balance(ws);
    assert.equal(await code(C.decidePayout(pool, ctx(owner), { workspaceId: ws, payoutId: pp.id, decision: 'approve' })), 'insufficient');
    assert.equal(await balance(ws), ws0, 'nothing moved');
    assert.equal((await pool.query('SELECT state FROM workforce_comp_payouts WHERE id=$1', [pp.id])).rows[0].state, 'approved', 'it stays approved, waiting for funds');
    await addGrant(pool, ws, { amountMicro: 1_000_000_000, kind: 'paid', sourceRef: `${marker}-topup` });
    const r = await C.decidePayout(pool, ctx(owner), { workspaceId: ws, payoutId: pp.id, decision: 'approve' });
    assert.equal(r.payout.state, 'paid', 'retrying the approval pays it');
  });

  await t.test('the export carries salaries and payouts, and cannot inject a spreadsheet formula', async () => {
    const out = await C.exportCsv(pool, ctx(owner), { workspaceId: ws, periodStart: weekStart, period: 'week' });
    const lines = out.csv.trim().split('\r\n');
    assert.match(lines[0], /^principal_id,name,kind,basis/);
    assert.ok(lines.some((l) => l.includes('salary_recorded') && l.includes('4000.00') && l.includes('EUR')), 'the salary, for the payroll provider');
    assert.ok(lines.some((l) => l.includes(worker) && l.includes('paid') && l.includes('30.00')), 'the paid payout');
    assert.ok(lines.some((l) => l.includes(`"'=SUM(A1)"`)), 'a name that starts with = is neutralised');
    assert.equal(await code(C.exportCsv(pool, ctx(worker), { workspaceId: ws, periodStart: weekStart })), 'not_found', 'an admin\'s export');
  });
});
