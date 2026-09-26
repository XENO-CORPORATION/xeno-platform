/**
 * Execution metering (CHAT-CODE-EXECUTION-SPEC.md §6): a run is charged on the ledger only when a
 * rate is set; at the free default it never touches the ledger. Uses a stub meter (the shape of
 * meterMediaGeneration) so the money DECISION is proven without the full ledger schema.
 *
 * Mutation-checked: drop the `unitCredits > 0` guard and "free path does not touch the ledger" fails;
 * change the wrapped shape away from `{ data: [result] }` and "charges per completed execution" fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeMetered } from '../src/server/services/sandboxSession.js';
import { getCreditCost } from '../src/server/utils/creditCosts.js';

const MICRO = 1_000_000;
const sandboxResult = () => ({ status: 'success', exitCode: 0, stdout: 'ok', savedFiles: [] });

test('the default code rate is FREE (0) — no user is charged until the owner prices it', () => {
  assert.equal(getCreditCost('code'), 0);
});

test('at the free rate the ledger is never touched, and the run still returns', async () => {
  let meterCalled = false;
  const meter = async () => { meterCalled = true; return {}; };
  let ran = false;
  const out = await runCodeMetered({
    meter, db: {}, userId: 'u', unitCredits: 0, microPerCredit: MICRO,
    requestId: 'r:code:0', surface: 'chat', doRun: async () => { ran = true; return sandboxResult(); },
  });
  assert.equal(meterCalled, false, 'the meter was NOT called at rate 0');
  assert.equal(ran, true, 'the code still ran');
  assert.equal(out.creditsCharged, 0);
  assert.equal(out.result.status, 'success');
});

test('with a rate set, it charges per completed execution via the meter', async () => {
  let seen = null;
  // Stub meterMediaGeneration: run the provided run(), settle 1 unit, return its shape.
  const meter = async (_db, _userId, opts) => {
    seen = opts;
    const result = await opts.run(); // { data: [sandboxResult] }
    const actual = Array.isArray(result?.data) ? result.data.length : 0;
    return { result, creditsCharged: (opts.unitCostMicro * actual) / MICRO };
  };
  const out = await runCodeMetered({
    meter, db: {}, userId: 'u', unitCredits: 3, microPerCredit: MICRO,
    requestId: 'r:code:1', surface: 'chat', doRun: async () => sandboxResult(),
  });
  assert.equal(seen.operation, 'code_execution', 'metered as a code_execution operation');
  assert.equal(seen.unitCostMicro, 3 * MICRO, 'unit cost is credits × microPerCredit');
  assert.equal(seen.count, 1);
  assert.equal(seen.requestId, 'r:code:1', 'a distinct per-run requestId (idempotency key)');
  assert.equal(out.creditsCharged, 3, 'one completed execution charged one unit');
  assert.equal(out.result.status, 'success', 'the caller gets the sandbox result, unwrapped from data[]');
});

test('a run that throws (engine unreachable) never charges — the throw propagates, hold is voided upstream', async () => {
  // Real meterMediaGeneration voids on throw; the stub mirrors: if run() throws, it rethrows.
  const meter = async (_db, _userId, opts) => { await opts.run(); return { result: { data: [] }, creditsCharged: 0 }; };
  await assert.rejects(
    runCodeMetered({ meter, db: {}, userId: 'u', unitCredits: 3, microPerCredit: MICRO, requestId: 'r:code:2', surface: 'chat', doRun: async () => { throw new Error('engine unreachable'); } }),
    /engine unreachable/,
  );
});
