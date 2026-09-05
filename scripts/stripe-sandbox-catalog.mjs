#!/usr/bin/env node
import { createRequire } from 'node:module';
import { modeFor, quietDependencies } from './lib/paid-loop-proof.mjs';
import { API_VERSION, SANDBOX_ACCOUNT, catalogPlan, validateSandbox, provisionCatalog } from './lib/stripe-sandbox-catalog.mjs';

try {
  const mode = modeFor(process.argv.slice(2));
  if (mode === 'confirm') validateSandbox(process.env);
  const { result, errors } = await quietDependencies(async () => {
    // Import the canonical catalog with no initialized payment client in offline mode.
    const originalKey = process.env.STRIPE_SECRET_KEY;
    let catalog;
    try {
      delete process.env.STRIPE_SECRET_KEY;
      const { getInternalCatalog } = await import('../src/server/services/billingService.js');
      catalog = getInternalCatalog();
    } finally {
      if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalKey;
    }
    if (mode === 'plan') return { status: 'UNEXECUTED', mode: 'offline-plan', account: SANDBOX_ACCOUNT, items: catalogPlan(catalog) };
    const require = createRequire(new URL('../src/server/package.json', import.meta.url));
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION, maxNetworkRetries: 0, timeout: 15_000 });
    return provisionCatalog({ stripe, catalog, env: process.env });
  });
  if (errors) throw new Error('dependency_error');
  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error('REFUSED/FAILED: sandbox catalog not verified. Check test-only configuration and owned catalog agreement. Partial test resources may remain; retry reconciles them. Provider details suppressed.');
  process.exitCode = 1;
}
