import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const scenario of ['valid', 'reject', 'cache', 'consent', 'missing', 'deadline', 'offers', 'account', 'portal']) {
  test(`checkout price authority: ${scenario}`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/billing-checkout-price-runner.mjs', import.meta.url)), scenario], {
      encoding: 'utf8', timeout: 15000,
      env: {
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        STRIPE_SECRET_KEY: scenario === 'missing' ? '' : scenario === 'portal' ? 'sk_live_fixture' : 'sk_test_fixture',
        STRIPE_PUBLISHABLE_KEY: scenario === 'portal' ? 'pk_live_fixture' : 'pk_test_fixture',
        STRIPE_EXPECTED_MODE: scenario === 'portal' ? 'live' : 'test', STRIPE_EXPECTED_ACCOUNT_ID: 'acct_fixture',
        STRIPE_BILLING_PORTAL_CONFIGURATION: scenario === 'portal' ? 'bpc_fixture' : '',
        STRIPE_PRICE_PRO_MONTHLY: 'price_month', STRIPE_PRICE_PRO_ANNUAL: 'price_year',
        STRIPE_PRICE_CREDITS_SMALL: 'price_pack', STRIPE_PRICE_TEAM_SEAT_MONTHLY: 'price_team',
        STRIPE_PRICE_TEAM_SEAT_ANNUAL: 'price_team_year',
        STRIPE_PRICE_EVERYTHING_MONTHLY: 'price_list', STRIPE_PRICE_TEAM_MONTHLY: 'price_legacy',
      },
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes('PROVIDER_SECRET_SENTINEL'), 'provider exception leaked');
    assert.equal(result.status, 0, output);
    assert.ok(output.includes(`PASS ${scenario}`), output);
  });
}
