/**
 * A streamed upstream call that produced nothing is VOIDED, never charged its reservation.
 *
 * Production, 2026-10-18 20:00 UTC: four claude-opus-5 tool-loop calls failed upstream with
 * no output and no usage chunk. The loop's `finally` recorded { inputTokens: <estimate>,
 * outputTokens: 0, hasOutputUsage: false }, `resolveAllMeters` read "input > 0" as work done,
 * and the meter charged each call its full hold (13.1 credits for ~20 input tokens).
 *
 * Mutation-checked: restoring `used.outputTokens > 0 || used.inputTokens > 0` as the settle
 * condition in aiRoutes fails "the route decides through streamCallSettlement"; making
 * streamCallSettlement return 'unmeasured' for zero output fails the first case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { streamCallSettlement } from '../src/server/utils/streamCallSettlement.js';

test('a failed call with no provider count and no output is voided', () => {
  assert.equal(streamCallSettlement({ inputTokens: 20, outputTokens: 0, hasOutputUsage: false }), 'void');
});

test('no recorded usage at all is voided', () => {
  assert.equal(streamCallSettlement(null), 'void');
  assert.equal(streamCallSettlement(undefined), 'void');
});

test('output produced but never counted still charges the reservation (existing rule)', () => {
  assert.equal(streamCallSettlement({ inputTokens: 20, outputTokens: 40, hasOutputUsage: false }), 'unmeasured');
});

test('a provider-measured call settles at what it measured, even with zero output', () => {
  assert.equal(streamCallSettlement({ inputTokens: 20, outputTokens: 0, hasOutputUsage: true }), 'measured');
  assert.equal(streamCallSettlement({ inputTokens: 20, outputTokens: 7, hasOutputUsage: true }), 'measured');
  // The disconnect path records no hasOutputUsage flag; it carries tokens seen so far.
  assert.equal(streamCallSettlement({ inputTokens: 20, outputTokens: 7 }), 'measured');
  assert.equal(streamCallSettlement({ inputTokens: 0, outputTokens: 0, hasOutputUsage: true }), 'void');
});

test('the route decides through streamCallSettlement', () => {
  const src = readFileSync(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const resolveAllMeters'), src.indexOf('/** Usage per upstream call'));
  assert.match(body, /streamCallSettlement\(used\) !== 'void'/);
  assert.doesNotMatch(body, /used\.outputTokens > 0 \|\| used\.inputTokens > 0/);
});
