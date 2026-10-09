// Moved to the server's test fixtures (src/server/tests/fixtures/), so that `stripe` resolves to the Stripe SDK the
// server runs in production. This path stays so the root suites that import it keep working.
export * from '../../src/server/tests/fixtures/billing-provider-fixture.mjs';
