/**
 * admission-lease.test.mjs — the admission lease's pricing rule, without a database.
 *
 * Decision: XENO ADMISSION - LEASE DECISION.md §3 and §6. The lease grants the largest output ceiling the
 * spendable funds cover, never more than was asked, and refuses below the floor. These tests pin the rule, the
 * worked numbers the decision record states, and the replay read-back a retried hold depends on.
 *
 * Mutation checks (each verified to fail the named test):
 *   - grant the requested ceiling regardless of funds        -> "a free account is capped to what it can fund"
 *   - apply the floor to the request, not min(request, floor) -> "asking for less than the floor is never refused"
 *   - read the replay ceiling from the request, not the amount -> "a replayed hold reads back the ceiling it reserved"
 *   - price the reservation at a different rate than the estimator -> "the reservation is the estimator's own price"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEASE_FLOOR_OUTPUT_TOKENS, grantedOutputTokensForAmount, leaseOutput, normalizeRequestedOutputTokens,
} from '../src/server/utils/admissionLease.js';
import { chatInputCostMicro, chatOutputRateMicro, estimateChatCostMicro } from '../src/server/utils/creditCosts.js';

const MODEL = 'gpt-6.1-sol'; // the Workshop's default: frontier-large, 800 / 3,200 µcr per token
const INPUT = 13_600;        // the decision record's worked input estimate
const REQUESTED = 32_000;    // the Workshop's turn ceiling
const CREDIT = 1_000_000;

test('a free account (50 credits) is capped to the 11,375 output tokens it can fund, and is told so', () => {
  const r = leaseOutput({ spendableMicro: 50 * CREDIT, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
  assert.equal(r.refused, false);
  assert.equal(r.grantedOutputTokens, 11_375);
  assert.equal(r.requestedOutputTokens, REQUESTED);
  assert.equal(r.capped, true);
  assert.ok(r.amountMicro <= 50 * CREDIT, 'the reservation never exceeds what the account can spend');
});

test('a Pro account (2,000 credits) keeps the full 32,000-token ceiling at the 116-credit reservation', () => {
  const r = leaseOutput({ spendableMicro: 2_000 * CREDIT, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
  assert.equal(r.grantedOutputTokens, REQUESTED);
  assert.equal(r.capped, false);
  assert.equal(r.amountMicro, 116 * CREDIT);
  assert.equal(r.amountMicro, estimateChatCostMicro(MODEL, { inputTokens: INPUT, maxOutputTokens: REQUESTED }),
    "the reservation is the estimator's own price");
});

test('below the floor the request is refused before any provider call', () => {
  // 13.6 credits of input plus the 4,096-token floor is 26.7072 credits. Twenty credits cannot fund the floor.
  assert.deepEqual(
    leaseOutput({ spendableMicro: 20 * CREDIT, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }),
    { refused: true, reason: 'floor' },
  );
});

test('exactly at the floor the request is granted the floor', () => {
  const r = leaseOutput({ spendableMicro: 26_707_200, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
  assert.equal(r.refused, false);
  assert.equal(r.grantedOutputTokens, LEASE_FLOOR_OUTPUT_TOKENS);
});

test('asking for less than the floor is never refused for asking small', () => {
  // A 1,000-token request on funds that cover it is granted in full. The floor applies to min(request, floor).
  const funds = chatInputCostMicro(MODEL, { inputTokens: INPUT }) + chatOutputRateMicro(MODEL) * 1_000;
  const r = leaseOutput({ spendableMicro: funds, model: MODEL, inputTokens: INPUT, requestedOutputTokens: 1_000 });
  assert.equal(r.refused, false);
  assert.equal(r.grantedOutputTokens, 1_000);
  assert.equal(r.capped, false);
});

test('funds that do not cover the input at all are refused as unaffordable', () => {
  assert.deepEqual(
    leaseOutput({ spendableMicro: 0, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }),
    { refused: true, reason: 'unaffordable' },
  );
  assert.deepEqual(
    leaseOutput({ spendableMicro: 13 * CREDIT, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED }),
    { refused: true, reason: 'unaffordable' },
  );
});

test('the reservation never exceeds the spendable amount, across a sweep of balances', () => {
  for (let credits = 0; credits <= 130; credits += 0.7) {
    const spendable = Math.round(credits * CREDIT);
    const r = leaseOutput({ spendableMicro: spendable, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
    if (r.refused) continue;
    assert.ok(r.amountMicro <= spendable, `reservation ${r.amountMicro} exceeds spendable ${spendable}`);
    assert.ok(r.grantedOutputTokens <= REQUESTED);
  }
});

test('a replayed hold reads back the ceiling its original attempt was granted', () => {
  for (const spendable of [26_707_200, 30 * CREDIT, 49_999_999, 50 * CREDIT, 116 * CREDIT, 2_000 * CREDIT]) {
    const granted = leaseOutput({ spendableMicro: spendable, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED });
    if (granted.refused) continue;
    const replay = grantedOutputTokensForAmount({
      amountMicro: granted.amountMicro, model: MODEL, inputTokens: INPUT, requestedOutputTokens: REQUESTED,
    });
    assert.equal(replay, granted.grantedOutputTokens, `replay of a grant made from ${spendable} µcr`);
  }
});

test('a model that charges nothing per output token grants its full request once the input is paid', () => {
  // The gemini-2 embedding carries an explicit zero output rate (creditCosts.js CHAT_MODEL_OVERRIDES).
  const model = 'xeno-embed-gemini-2';
  assert.equal(chatOutputRateMicro(model), 0);
  const r = leaseOutput({
    spendableMicro: chatInputCostMicro(model, { inputTokens: INPUT }), model, inputTokens: INPUT, requestedOutputTokens: REQUESTED,
  });
  assert.equal(r.refused, false);
  assert.equal(r.grantedOutputTokens, REQUESTED);
});

test('a request without a usable ceiling takes the route default, and a fraction rounds down', () => {
  assert.equal(normalizeRequestedOutputTokens(undefined), 4096);
  assert.equal(normalizeRequestedOutputTokens(null), 4096);
  assert.equal(normalizeRequestedOutputTokens(0), 4096);
  assert.equal(normalizeRequestedOutputTokens('abc'), 4096);
  assert.equal(normalizeRequestedOutputTokens('8192'), 8192);
  assert.equal(normalizeRequestedOutputTokens(2.7), 2);
});
