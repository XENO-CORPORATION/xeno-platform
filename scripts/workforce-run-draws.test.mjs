/**
 * XENO-WORKFORCE-01 §8.7 -- a run's inference spend is ONE reservation with a DRAW per provider dispatch.
 *
 * Runs on the migrated schema (TEST_DATABASE_URL). What it proves, each against real PostgreSQL:
 *   - a personal ROOT admission reserves its whole ceiling on the canonical ledger; a CHILD reserves nothing
 *     new and draws on its root's one hold; the generic hold verbs cannot touch a run hold;
 *   - a draw needs a live provider_dispatch LEASE of that admission, consumes it (one lease, one dispatch),
 *     and is refused past the tightest envelope from the dispatching admission up to the root;
 *   - concurrent draws cannot oversubscribe a ceiling;
 *   - settlement is measured usage priced with the tariff PINNED at open, debits exactly the reserved lots
 *     and the journal, and records what no envelope covers as liability -- never a charge past a ceiling;
 *   - FUND-09: an open draw keeps its reservation committed through expiry and the sweep;
 *   - void needs proof of non-dispatch; close refuses while any draw is open and releases the remainder;
 *   - a revoked ancestor fences a child's draw; a dispute-voided hold settles as liability, not as a debit;
 *   - the service routes authenticate and map every refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('a run spends through one reservation, one draw per provider dispatch (XENO-WORKFORCE-01 §8.7)', { skip: !url, timeout: 180000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('credit_hold_draws') AS t")).rows[0].t, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, revokeRun } = await import('../src/server/services/workforceRunAuthority.js');
  const { reportRunResult } = await import('../src/server/services/workforceRunResults.js');
  const ledger = await import('../src/server/utils/creditLedgerV2.js');
  const { pinChatTariff, pricePinnedChatUsage } = await import('../src/server/utils/creditCosts.js');
  const { createServiceLedgerRouter } = await import('../src/server/routes/serviceLedgerRoutes.js');

  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'run-draw-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `draw-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const fund = async (u, micro) => {
    await pool.query(`INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET balance=EXCLUDED.balance`, [u, micro]);
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,$2,$2,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u, micro]);
  };
  const agentOf = async (owner) => {
    const id = randomUUID(), content = { instructions: 'draws', skills: [], requestedCapabilities: ['files.read'], secretReferences: [] };
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Drawer')`, [id, owner]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance) VALUES($1,1,$2,$3,'{"source":"authored"}')`,
      [id, content, hash(`${id}:1`)]);
    return { resourceId: id, version: 1, contentHash: hash(`${id}:1`) };
  };
  const admit = async (actor, agent, ceilingMicro, parent) => (await admitRun(pool, ctx(actor), {
    operationId: randomUUID(), agent, target: { kind: 'personal', ownerUserId: actor }, capabilities: ['files.read'],
    budget: { ceilingMicro: String(ceilingMicro) }, ...(parent ? { parent: { admissionId: parent } } : {}),
  })).admission.admissionId;
  const lease = async (actor, admissionId, operation = 'provider_dispatch') =>
    (await authorizeRunStep(pool, ctx(actor), { admissionId, operation, ...(operation === 'privileged_call' ? { capability: 'files.read' } : {}) }, { signingKey })).token;
  const available = async (u) => BigInt((await ledger.getBalanceV2(pool, u)).availableMicro);
  const posted = async (u) => BigInt((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [u])).rows[0].balance);
  const code = (p, expected, message) => assert.rejects(p, (e) => e.code === expected, message);
  const MODEL = 'claude-opus-5';
  const tariff = pinChatTariff(MODEL);
  const price = (i, o) => BigInt(pricePinnedChatUsage(tariff, { inputTokens: String(i), outputTokens: String(o) }));
  let seq = 0;
  const drawId = () => `draw-${marker}-${++seq}`;
  const open = async (actor, admissionId, extra = {}) => ledger.openRunDrawV2(pool, {
    admissionId, actorUserId: actor, drawId: drawId(), lease: await lease(actor, admissionId), model: MODEL, inputBound: 100, outputBound: 100, ...extra });

  const owner = await user('owner'), other = await user('other');
  await fund(owner, 1_000_000_000n); await fund(other, 1_000_000_000n);
  const agent = await agentOf(owner);
  const CEILING = price(10_000, 10_000) * 3n; // three generous dispatches' worth

  let root;
  await t.test('a personal root reserves its whole ceiling; the generic hold verbs cannot touch it', async () => {
    const before = await available(owner);
    root = await admit(owner, agent, CEILING);
    const hold = (await pool.query("SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2", [owner, root])).rows[0];
    assert.deepEqual([hold.surface, hold.operation, hold.state, BigInt(hold.amount_micro)], ['workforce', 'run', 'held', CEILING],
      'the ceiling is one canonical hold named by the admission');
    assert.equal((await pool.query('SELECT root_admission_id FROM workforce_run_holds WHERE admission_id=$1', [root])).rows[0].root_admission_id, root);
    assert.equal(before - await available(owner), CEILING, 'the reservation is taken from what the payer can spend elsewhere');
    await code(ledger.voidHoldV2(pool, owner, root), 'RUN_HOLD_MANAGED', 'the generic void cannot release a run reservation');
    await code(ledger.settleHoldV2(pool, owner, root, 1), 'RUN_HOLD_MANAGED', 'the generic settle cannot charge a run reservation');
    await code(ledger.extendHoldV2(pool, owner, root, 60), 'RUN_HOLD_MANAGED', 'the generic extend cannot keep a run reservation alive');
  });

  await t.test('a draw needs a live provider_dispatch lease of this admission, and consumes it', async () => {
    const base = { admissionId: root, actorUserId: owner, model: MODEL, inputBound: 100, outputBound: 100 };
    await code(ledger.openRunDrawV2(pool, { ...base, drawId: drawId(), lease: 'x'.repeat(40) }), 'LEASE_INVALID', 'an unknown token authorizes nothing');
    await code(ledger.openRunDrawV2(pool, { ...base, drawId: drawId(), lease: await lease(owner, root, 'privileged_call') }), 'LEASE_WRONG_OPERATION',
      'a privileged-call lease is not a dispatch lease');
    const stale = `stale-${randomUUID()}-${randomUUID()}`;
    await pool.query(`INSERT INTO workforce_run_leases(admission_id,sequence,operation,effective_capabilities,issued_at,expires_at,signing_kid,token_hash)
      VALUES($1,(SELECT coalesce(max(sequence),0)+1 FROM workforce_run_leases WHERE admission_id=$1),'provider_dispatch','["files.read"]',
      clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '90 seconds','k',$2)`, [root, hash(stale)]);
    await code(ledger.openRunDrawV2(pool, { ...base, drawId: drawId(), lease: stale }), 'LEASE_EXPIRED', 'an expired lease authorizes nothing');
    const token = await lease(owner, root);
    await code(ledger.openRunDrawV2(pool, { ...base, actorUserId: other, drawId: drawId(), lease: token }), 'NOT_FOUND',
      'only the admitted actor may spend the run, and nobody else learns of it');
    const id = drawId();
    const d = await ledger.openRunDrawV2(pool, { ...base, drawId: id, lease: token });
    assert.deepEqual([d.state, BigInt(d.reservedMicro), d.priceVersion], ['open', price(100, 100), tariff.version],
      'the reservation is the pinned tariff at the dispatch bounds');
    assert.equal((await ledger.openRunDrawV2(pool, { ...base, drawId: id, lease: token })).replayed, true, 'an identical replay returns the same draw');
    await code(ledger.openRunDrawV2(pool, { ...base, drawId: id, lease: token, outputBound: 101 }), 'CONFLICT', 'a changed replay conflicts');
    await code(ledger.openRunDrawV2(pool, { ...base, drawId: drawId(), lease: token }), 'LEASE_CONSUMED', 'one lease authorizes one dispatch');
    await ledger.voidRunDrawV2(pool, { admissionId: root, drawId: id, notDispatched: true });
  });

  await t.test('a draw past the remaining envelope is refused, and concurrent draws cannot oversubscribe', async () => {
    const r = await admit(owner, agent, price(100, 100) * 5n);
    await code(open(owner, r, { outputBound: 1_000_000 }), 'RUN_BUDGET_EXHAUSTED', 'a bound larger than the envelope is refused before dispatch');
    const tokens = await Promise.all(Array.from({ length: 12 }, () => lease(owner, r)));
    const results = await Promise.allSettled(tokens.map((lt) => ledger.openRunDrawV2(pool, {
      admissionId: r, actorUserId: owner, drawId: drawId(), lease: lt, model: MODEL, inputBound: 100, outputBound: 100 })));
    const opened = results.filter((x) => x.status === 'fulfilled').length;
    assert.equal(opened, 5, 'exactly the envelope is reserved under concurrency');
    assert.ok(results.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'RUN_BUDGET_EXHAUSTED'), 'every excess draw is refused as exhausted');
    const sum = BigInt((await pool.query(`SELECT sum(d.reserved_micro)::text s FROM credit_hold_draws d JOIN workforce_run_holds w ON w.hold_row_id=d.hold_row_id
      WHERE w.admission_id=$1 AND d.state='open'`, [r])).rows[0].s);
    assert.ok(sum <= price(100, 100) * 5n, 'open reservations never exceed the ceiling');
  });

  await t.test('settlement charges measured usage at the pinned tariff, from the reserved lots, into the journal', async () => {
    const d = await open(owner, root, { inputBound: 10_000, outputBound: 10_000 });
    const beforePosted = await posted(owner);
    const hold = (await pool.query('SELECT * FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [owner, root])).rows[0];
    const lotsBefore = BigInt((await pool.query('SELECT sum(reserved_micro)::text s FROM credit_hold_funding WHERE hold_row_id=$1', [hold.id])).rows[0].s);
    const receipt = { admissionId: root, drawId: d.drawId, providerRequestId: `prov-${marker}`, provider: 'anthropic', model: MODEL,
      inputTokens: 1234, outputTokens: 567, measured: true };
    await code(ledger.settleRunDrawV2(pool, { ...receipt, measured: false }), 'BAD_REQUEST', 'unmeasured usage settles nothing');
    const s = await ledger.settleRunDrawV2(pool, receipt);
    const priced = price(1234, 567);
    assert.deepEqual([s.state, BigInt(s.pricedMicro), BigInt(s.chargedMicro), BigInt(s.liabilityMicro)], ['settled', priced, priced, 0n]);
    assert.equal(beforePosted - await posted(owner), priced, 'the payer is debited exactly the priced usage');
    const after = (await pool.query('SELECT * FROM credit_holds WHERE id=$1', [hold.id])).rows[0];
    assert.equal(BigInt(after.settled_micro) - BigInt(hold.settled_micro), priced, 'the reservation records what it spent');
    assert.equal(after.state, 'held', 'the run reservation stays open for the next dispatch');
    const lotsAfter = BigInt((await pool.query('SELECT sum(reserved_micro)::text s FROM credit_hold_funding WHERE hold_row_id=$1', [hold.id])).rows[0].s);
    assert.equal(lotsBefore - lotsAfter, priced, 'the spent slice leaves the lot reservation, so the next draw is funded from what is left');
    assert.equal((await ledger.settleRunDrawV2(pool, receipt)).replayed, true, 'a duplicate receipt cannot charge twice');
    await code(ledger.settleRunDrawV2(pool, { ...receipt, outputTokens: 568 }), 'CONFLICT', 'a changed receipt conflicts');
    const journal = (await pool.query("SELECT count(*)::int n FROM credit_transactions WHERE user_id=$1 AND reference_type='xeno.draw'", [owner])).rows[0].n;
    assert.equal(journal, 1, 'one journal entry per settled draw');
    assert.equal((await pool.query("SELECT count(*)::int n FROM api_usage_logs WHERE user_id=$1 AND operation='run.dispatch'", [owner])).rows[0].n, 1,
      'the dispatch reaches canonical usage analytics');
    assert.equal((await ledger.verifyChainV2(pool, owner)).ok, true, 'draw settlement preserves the hash chain');
  });

  await t.test('a dispatch whose usage never came back is charged at its authorized bound, and says so', async () => {
    const r = await admit(owner, agent, price(100, 100) * 3n);
    const d = await open(owner, r);
    const base = { admissionId: r, drawId: d.drawId, providerRequestId: `cut-${marker}`, provider: 'anthropic', model: MODEL, measured: false };
    await code(ledger.settleRunDrawV2(pool, { ...base, inputTokens: 1, outputTokens: 1 }), 'BAD_REQUEST',
      'counts the caller computed are not a measurement');
    const beforePosted = await posted(owner);
    const s = await ledger.settleRunDrawV2(pool, base);
    assert.deepEqual([s.outcome, BigInt(s.chargedMicro)], ['unmeasured', price(100, 100)], 'charged exactly the bound this dispatch was authorized for');
    assert.equal(beforePosted - await posted(owner), price(100, 100), 'never more than the bound');
    assert.equal((await ledger.settleRunDrawV2(pool, base)).replayed, true, 'an unmeasured settle is idempotent too');
    await code(ledger.settleRunDrawV2(pool, { ...base, measured: true, inputTokens: 1, outputTokens: 1 }), 'CONFLICT',
      'a late measurement cannot re-price a settled dispatch');
  });

  await t.test('usage no envelope covers is recorded liability, never a charge past the ceiling', async () => {
    const small = price(100, 100);
    const r = await admit(owner, agent, small);
    const d = await open(owner, r);
    const beforePosted = await posted(owner);
    const s = await ledger.settleRunDrawV2(pool, { admissionId: r, drawId: d.drawId, providerRequestId: `over-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 5000, outputTokens: 5000, measured: true });
    assert.equal(BigInt(s.chargedMicro), small, 'the charge stops at the ceiling the payer approved');
    assert.equal(BigInt(s.liabilityMicro), price(5000, 5000) - small, 'the rest is the platform\'s recorded liability');
    assert.equal(beforePosted - await posted(owner), small, 'the payer is never debited past the ceiling');
  });

  await t.test('FUND-09: an open draw keeps its reservation committed through expiry and the sweep', async () => {
    const r = await admit(owner, agent, price(100, 100) * 2n);
    const d = await open(owner, r);
    const committed = await available(owner);
    await pool.query("UPDATE credit_holds SET expires_at=now()-interval '1 hour' WHERE user_id=$1 AND hold_id=$2", [owner, r]);
    assert.equal(await available(owner), committed, 'time alone never frees a hold with a dispatch in flight');
    await ledger.sweepExpiredHolds(pool);
    assert.equal((await pool.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [owner, r])).rows[0].state, 'held',
      'the sweep leaves a hold with an open draw committed');
    await ledger.voidRunDrawV2(pool, { admissionId: r, drawId: d.drawId, notDispatched: true });
    assert.ok(await available(owner) > committed, 'once nothing is in flight, the lapsed reservation stops holding value');
    await code(open(owner, r), 'RUN_RESERVATION_LAPSED', 'a lapsed personal reservation authorizes no new dispatch');
  });

  await t.test('void needs proof of non-dispatch; close waits for every draw and releases the remainder', async () => {
    const r = await admit(owner, agent, price(100, 100) * 4n);
    const a = await open(owner, r), b = await open(owner, r);
    await code(ledger.voidRunDrawV2(pool, { admissionId: r, drawId: a.drawId }), 'BAD_REQUEST', 'a timeout is not proof: void needs notDispatched');
    await code(ledger.closeRunReservationV2(pool, { admissionId: r }), 'DRAWS_UNRESOLVED', 'a run with a draw in flight cannot close');
    await ledger.voidRunDrawV2(pool, { admissionId: r, drawId: a.drawId, notDispatched: true });
    await ledger.settleRunDrawV2(pool, { admissionId: r, drawId: b.drawId, providerRequestId: `close-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 10, outputTokens: 10, measured: true });
    const before = await available(owner);
    const closed = await ledger.closeRunReservationV2(pool, { admissionId: r });
    assert.deepEqual([closed.state, BigInt(closed.settledMicro)], ['settled', price(10, 10)]);
    assert.equal(await available(owner) - before, price(100, 100) * 4n - price(10, 10), 'close releases exactly what was not spent');
    assert.equal((await ledger.closeRunReservationV2(pool, { admissionId: r })).replayed, true, 'closing twice is idempotent');
    await code(open(owner, r), 'RUN_RESERVATION_LAPSED', 'a closed run authorizes no new dispatch');
  });

  await t.test('a child reserves nothing new, is bounded by its own envelope, and is fenced by its ancestor', async () => {
    const parentCeiling = price(100, 100) * 6n;
    const p = await admit(owner, agent, parentCeiling);
    const before = await available(owner);
    const child = await admit(owner, agent, price(100, 100) * 2n, p);
    assert.equal(await available(owner), before, 'a child is a carve-out of its parent, not a second reservation');
    const pHold = (await pool.query('SELECT hold_row_id FROM workforce_run_holds WHERE admission_id=$1', [p])).rows[0].hold_row_id;
    assert.equal((await pool.query('SELECT hold_row_id FROM workforce_run_holds WHERE admission_id=$1', [child])).rows[0].hold_row_id, pHold,
      'the child draws on its root\'s one hold');
    await open(owner, child); await open(owner, child);
    await code(open(owner, child), 'RUN_BUDGET_EXHAUSTED', 'the child\'s own ceiling bounds it though the root still has headroom');
    await open(owner, p);
    // A lease taken BEFORE the stop: the draw's own fence must refuse it, not merely lease issuance.
    const heldLease = await lease(owner, child);
    await revokeRun(pool, ctx(owner), p);
    await code(ledger.openRunDrawV2(pool, { admissionId: child, actorUserId: owner, drawId: drawId(), lease: heldLease, model: MODEL,
      inputBound: 1, outputBound: 1 }), 'RUN_REVOKED', 'a stopped ancestor fences the child\'s dispatch, even under a still-live lease');
  });

  await t.test('every ancestor\'s envelope binds a grandchild, and settlement stops at the tightest one', async () => {
    const unit = price(100, 100);
    const r = await admit(owner, agent, unit * 10n);
    const c = await admit(owner, agent, unit * 6n, r);
    const g = await admit(owner, agent, unit * 4n, c);
    for (let i = 0; i < 4; i++) await open(owner, c); // the child spends 4 of its own 6
    await open(owner, g); await open(owner, g);
    // The grandchild's own ceiling (4) and the root's hold (10 - 6 = 4) both still have room; the CHILD's
    // envelope (6, with 4 + 2 already drawn in its subtree) does not.
    await code(open(owner, g), 'RUN_BUDGET_EXHAUSTED', 'an ancestor\'s envelope binds its whole subtree');
    // A child's overrun is capped at its OWN remaining envelope even though the root's lots could pay more.
    const lone = await admit(owner, agent, unit, await admit(owner, agent, unit * 20n));
    const d = await open(owner, lone);
    const s = await ledger.settleRunDrawV2(pool, { admissionId: lone, drawId: d.drawId, providerRequestId: `tight-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 5000, outputTokens: 5000, measured: true });
    assert.deepEqual([BigInt(s.chargedMicro), BigInt(s.liabilityMicro)], [unit, price(5000, 5000) - unit],
      'settlement charges only within the tightest envelope; the rest is liability');
  });

  await t.test('a dispute-voided reservation settles in-flight work as liability, never as a debit', async () => {
    const r = await admit(owner, agent, price(100, 100) * 2n);
    const d = await open(owner, r);
    await pool.query("UPDATE credit_holds SET state='voided' WHERE user_id=$1 AND hold_id=$2", [owner, r]);
    const beforePosted = await posted(owner);
    const s = await ledger.settleRunDrawV2(pool, { admissionId: r, drawId: d.drawId, providerRequestId: `void-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 50, outputTokens: 50, measured: true });
    assert.deepEqual([BigInt(s.chargedMicro), BigInt(s.liabilityMicro)], [0n, price(50, 50)], 'the work is recorded and owed by the platform');
    assert.equal(await posted(owner), beforePosted, 'released funds are never charged');
  });

  await t.test('the event that ends a run releases its reservation in the same transaction, never before', async () => {
    const holdState = async (r) => (await pool.query('SELECT state, settled_micro FROM credit_holds WHERE user_id=$1 AND hold_id=$2', [owner, r])).rows[0];
    const report = (r, outcome = 'completed') => reportRunResult(pool, ctx(owner), { admissionId: r, outcome });
    // A run that did nothing: its report is the last event, and releases everything.
    const idle = await admit(owner, agent, price(100, 100) * 3n);
    const beforeIdle = await available(owner);
    await report(idle);
    assert.equal((await holdState(idle)).state, 'voided', 'a finished run that spent nothing releases its whole reservation');
    assert.equal(await available(owner) - beforeIdle, price(100, 100) * 3n);
    // "completed" is not proof of provider outcome: an open draw keeps the reservation until it resolves.
    const busy = await admit(owner, agent, price(100, 100) * 3n);
    const d = await open(owner, busy);
    await report(busy);
    assert.equal((await holdState(busy)).state, 'held', 'a report alone never releases in-flight provider work');
    await ledger.settleRunDrawV2(pool, { admissionId: busy, drawId: d.drawId, providerRequestId: `last-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 20, outputTokens: 20, measured: true });
    assert.deepEqual([(await holdState(busy)).state, BigInt((await holdState(busy)).settled_micro)], ['settled', price(20, 20)],
      'the last draw resolving ends the finished run, in the settle\'s own transaction');
    // A child still running keeps the whole tree committed; its own result is what releases it.
    const root = await admit(owner, agent, price(100, 100) * 4n);
    const child = await admit(owner, agent, price(100, 100), root);
    await report(root);
    assert.equal((await holdState(root)).state, 'held', 'an unfinished child keeps its root\'s reservation committed');
    await report(child, 'failed');
    assert.equal((await holdState(root)).state, 'voided', 'the last run in the tree finishing releases the reservation');
    // A stop fences the tree: nothing in flight -> released with the stop; a draw in flight -> held until it resolves.
    const stopped = await admit(owner, agent, price(100, 100) * 2n);
    await revokeRun(pool, ctx(owner), stopped);
    assert.equal((await holdState(stopped)).state, 'voided', 'a stopped run with nothing in flight releases at once');
    const stoppedBusy = await admit(owner, agent, price(100, 100) * 2n);
    const inflight = await open(owner, stoppedBusy);
    await revokeRun(pool, ctx(owner), stoppedBusy);
    assert.equal((await holdState(stoppedBusy)).state, 'held', 'a stop never releases work already dispatched');
    await ledger.voidRunDrawV2(pool, { admissionId: stoppedBusy, drawId: inflight.drawId, notDispatched: true });
    assert.equal((await holdState(stoppedBusy)).state, 'voided', 'the in-flight draw resolving completes the stop');
  });

  await t.test('the service routes authenticate and map each refusal', async () => {
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/v2/ledger/service', createServiceLedgerRouter({ getServiceToken: () => 'draw-service-secret' }));
    const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
    t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
    const call = async (path, body, token = 'draw-service-secret') => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/ledger/service${path}`, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const r = await admit(owner, agent, price(100, 100));
    const body = { actorUserId: owner, drawId: drawId(), lease: await lease(owner, r), model: MODEL, inputBound: 100, outputBound: 100 };
    assert.equal((await call(`/runs/${r}/draws`, body, 'wrong')).status, 401, 'only authenticated backend services may open draws');
    const opened = await call(`/runs/${r}/draws`, body);
    assert.deepEqual([opened.status, opened.body.state], [200, 'open']);
    const exhausted = await call(`/runs/${r}/draws`, { ...body, drawId: drawId(), lease: await lease(owner, r) });
    assert.deepEqual([exhausted.status, exhausted.body.error.code], [402, 'RUN_BUDGET_EXHAUSTED'], 'an exhausted envelope is a payment refusal');
    assert.equal((await call(`/runs/${r}/draws`, { ...body, drawId: drawId(), lease: 'y'.repeat(40) })).status, 403, 'a bad lease is forbidden');
    assert.equal((await call(`/runs/${r}/close`, {})).status, 409, 'an unresolved draw keeps the run open');
    const settled = await call(`/runs/${r}/draws/${body.drawId}/settle`, { providerRequestId: `http-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 7, outputTokens: 7, measured: true });
    assert.deepEqual([settled.status, settled.body.state], [200, 'settled']);
    assert.equal((await call(`/runs/${r}/draws/${body.drawId}/settle`, { providerRequestId: `http-${marker}`, provider: 'anthropic',
      model: MODEL, inputTokens: 7, outputTokens: 7, measured: true, actualCostMicro: 1 })).status, 400, 'callers report usage, never a charge');
    assert.equal((await call(`/runs/${r}/close`, {})).status, 200);
  });
});
