/**
 * A cloud run that spends its budget is STOPPED, not failed — the Run dialog promises "It stops when it has used this
 * much". Measured on production 2026-11-03: the runner reports the gateway's refusal as a failed run whose reason is
 * the raw API error, so every run that reached its budget read as a crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { endedAs, BUDGET_REACHED_REASON } from '../src/server/services/agentCloudRuns.js';

const RAW = 'API error: API call failed after retries: Chat completions API 402: Run budget exceeded [budget_exceeded]. Add credits or raise the spending limit, then retry. | status=402 | request-id=860ae3a1-0605';

test('🔴 a run that spent its budget is recorded as stopped at its budget, not failed', () => {
  assert.deepEqual(endedAs('failed', RAW), { state: 'cancelled', reason: BUDGET_REACHED_REASON });
});

test('every other failure stays a failure, with its own reason', () => {
  assert.deepEqual(endedAs('failed', 'platform agent credential unavailable: run_not_found'),
    { state: 'failed', reason: 'platform agent credential unavailable: run_not_found' });
  assert.equal(endedAs('interrupted', 'x').state, 'failed');
});

test('finished, cancelled and live runs map as before', () => {
  assert.deepEqual(endedAs('completed', null), { state: 'completed', reason: 'completed' });
  assert.equal(endedAs('cancelled', 'by owner').state, 'cancelled');
  assert.equal(endedAs('running', null), null);
  assert.equal(endedAs('queued', null), null);
});
