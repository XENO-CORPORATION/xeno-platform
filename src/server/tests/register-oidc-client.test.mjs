import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, parseArgs } from '../scripts/register-oidc-client.mjs';

test('registration is dry-run by default and takes authority only from checked-in policy', () => {
  const args = parseArgs([
    '--client-id', 'xeno-pixel', '--name', 'XENO Pixel', '--surface', 'xeno-pixel',
    '--loopback', '--redirect-uri', 'http://127.0.0.1/callback', '--redirect-uri', 'http://[::1]/callback',
  ]);
  const plan = buildPlan(args);
  assert.equal(args.apply, false);
  assert.equal(plan.scopes.includes('billing:manage'), false);
  assert.equal(plan.redirectUris.length, 2);
});

test('apply requires an operator reason', () => {
  const args = parseArgs([
    '--apply', '--client-id', 'xeno-pixel', '--name', 'XENO Pixel', '--surface', 'xeno-pixel',
    '--loopback', '--redirect-uri', 'http://127.0.0.1/callback',
  ]);
  assert.throws(() => buildPlan(args), /reason/);
});

test('registration rejects scope escalation and non-literal loopback redirects', () => {
  const elevated = parseArgs([
    '--client-id', 'xeno-pixel', '--name', 'XENO Pixel', '--surface', 'xeno-pixel',
    '--loopback', '--redirect-uri', 'http://127.0.0.1/callback', '--scope', 'billing:manage',
  ]);
  assert.throws(() => buildPlan(elevated), /exceeds/);
  const rebinding = parseArgs([
    '--client-id', 'xeno-pixel', '--name', 'XENO Pixel', '--surface', 'xeno-pixel',
    '--loopback', '--redirect-uri', 'http://localhost/callback',
  ]);
  assert.throws(() => buildPlan(rebinding), /loopback/);
});

test('unregistered client IDs must first land in the reviewed authority matrix', () => {
  const args = parseArgs([
    '--client-id', 'xeno-unknown', '--name', 'Unknown', '--surface', 'xeno_unknown',
    '--redirect-uri', 'https://unknown.xenostudio.ai/callback',
  ]);
  assert.throws(() => buildPlan(args), /authority matrix/);
});
