/**
 * The usage-dimension vocabulary stays in step with the router that produces it.
 *
 * utils/usageDimensions.js DROPS any value it does not recognise (a label is
 * never a reason to lose a charge). That makes drift silent: a new `reason`
 * in resolveInferenceRoute would simply stop being recorded. This reads the
 * literals out of providerCredentials.js and requires every one to be listed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTE_REASONS, MISMATCH_BASES, routingDimensions, dimensionsJson } from '../src/server/utils/usageDimensions.js';

const src = readFileSync(new URL('../src/server/services/providerCredentials.js', import.meta.url), 'utf8');
const literals = (re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))];

test('every route reason the resolver can emit is in ROUTE_REASONS', () => {
  const emitted = literals(/reason = '([a-z-]+)'/g).concat(literals(/\['(product-override|account-default)', /g));
  assert.ok(emitted.length >= 4, `found ${emitted.length} reasons in source`);
  for (const r of emitted) assert.ok(ROUTE_REASONS.includes(r), `resolver emits '${r}' but the vocabulary drops it`);
});

test('every mismatch basis credentialServesModel can emit is in MISMATCH_BASES', () => {
  const emitted = literals(/basis: '([a-z-]+)'/g);
  assert.ok(emitted.length >= 6, `found ${emitted.length} bases in source`);
  for (const b of emitted) assert.ok(MISMATCH_BASES.includes(b), `resolver emits basis '${b}' but the vocabulary drops it`);
});

test('unknown values are dropped, known ones kept, nothing else leaks through', () => {
  assert.deepEqual(routingDimensions({ routeReason: 'provider-mismatch', routeMismatchBasis: 'no-allow-list', userId: 'x', secret: 'y' }),
    { route_reason: 'provider-mismatch', route_mismatch_basis: 'no-allow-list' });
  assert.deepEqual(routingDimensions({ routeReason: 'DROP TABLE', routeMismatchBasis: 42 }), {});
  assert.deepEqual(routingDimensions(null), {});
  assert.equal(dimensionsJson({}), null);
  assert.equal(dimensionsJson({ a: undefined }), null);
  assert.equal(dimensionsJson({ route_reason: 'byok' }), '{"route_reason":"byok"}');
});
