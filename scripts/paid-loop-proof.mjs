#!/usr/bin/env node
// Offline plan by default. --confirm is a separate, operator-approved TEST run.
// Hosted Checkout, renewal/refund/receipt/relogin remain separate release gates.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { modeFor, validateTarget, quietDependencies, runProof } from './lib/paid-loop-proof.mjs';

try {
  const mode = modeFor(process.argv.slice(2));
  if (mode === 'plan') {
    console.log(JSON.stringify({ status: 'UNEXECUTED', mode: 'offline-plan',
      requirements: ['Explicit approval before --confirm', 'Stripe TEST key and Pro price',
        'NODE_ENV=test', 'Loopback DB named xeno_paid_loop_<32 hex run ID>',
        'Matching XENO_PAID_LOOP_RUN_ID and database comment xeno-paid-loop:<run ID>',
        'Migrated disposable schema and XENO_PAID_LOOP_WEBHOOK_URL for an isolated test endpoint',
        'No enabled shared or production-facing webhook destinations', 'Loopback BILLING_APP_URL'],
      actions: ['Create disposable fixture', 'Verify consent refusal and exact session binding',
        'Create/cancel test subscription and check delivered plan/entitlement changes',
        'Expire open sessions, cancel subscriptions, delete and verify owned customers',
        'Retain disposable DB and provider history for reconciliation'],
      notExercised: ['Hosted Checkout completion', 'Renewal', 'Delayed payment', 'Refund', 'Receipt delivery', 'Browser relogin'],
    }, null, 2));
  } else {
    const config = validateTarget(process.env);
    const { result, errors } = await quietDependencies(async () => {
      const require = createRequire(new URL('../src/server/package.json', import.meta.url));
      const Stripe = require('stripe');
      const { Pool } = require('pg');
      const services = { ...await import('../src/server/services/billingService.js'),
        ...await import('../src/server/services/checkoutConsent.js'),
        ...await import('../src/server/services/effectivePlan.js') };
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-02-24.acacia', maxNetworkRetries: 0, timeout: 10_000,
      });
      const webhookSource = await readFile(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8');
      const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
        database: config.database, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000 });
      return runProof({ config, pool, stripe, services, webhookSource });
    });
    if (errors) { result.failures.push('dependency_logged_error'); result.status = 'failed'; }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'passed-service-loop-only' ? 0 : 1;
  }
} catch {
  console.error('REFUSED/FAILED: provider proof did not complete. Check the documented test-only configuration; no exception details are printed.');
  process.exitCode = 1;
}
