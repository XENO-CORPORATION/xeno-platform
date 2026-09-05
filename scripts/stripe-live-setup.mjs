#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { API_VERSION, createPosixSecretSink, LIVE_ACCOUNT, liveSetupPlan, provisionLiveSetup } from './lib/stripe-live-setup.mjs';

function parse(args) {
  if (!args.length) return { mode: 'plan' };
  if (args[0] !== '--confirm-live') throw new Error('unsupported_arguments');
  let stage = 'catalog-portal', secretOutput;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--stage' && ['catalog-portal', 'webhook'].includes(args[i + 1])) stage = args[++i];
    else if (args[i] === '--secret-output' && args[i + 1]) secretOutput = args[++i];
    else throw new Error('unsupported_arguments');
  }
  if (stage === 'webhook' && !secretOutput) throw new Error('secret_output_required');
  if (stage !== 'webhook' && secretOutput) throw new Error('secret_output_only_for_webhook');
  return { mode: 'confirm', stage, secretOutput };
}

async function canonicalInputs() {
  const original = process.env.STRIPE_SECRET_KEY;
  let catalog;
  try {
    delete process.env.STRIPE_SECRET_KEY;
    const { getInternalCatalog } = await import('../src/server/services/billingService.js');
    catalog = getInternalCatalog();
  } finally {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original;
  }
  return { catalog, billingSource: readFileSync(new URL('../src/server/services/billingService.js', import.meta.url), 'utf8') };
}

try {
  const command = parse(process.argv.slice(2));
  const { catalog, billingSource } = await canonicalInputs();
  if (command.mode === 'plan') {
    const plan = liveSetupPlan(catalog, billingSource);
    console.log(JSON.stringify({ status: 'UNEXECUTED', mode: 'offline-plan', account: LIVE_ACCOUNT,
      catalogDigest: plan.catalogDigest, items: plan.items, webhook: plan.webhook, portal: plan.portal,
      stages: ['--confirm-live --stage catalog-portal', '--confirm-live --stage webhook --secret-output /owner-only/path.json'] }, null, 2));
  } else {
    const require = createRequire(new URL('../src/server/package.json', import.meta.url));
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION, maxNetworkRetries: 0, timeout: 15_000 });
    const secretSink = command.stage === 'webhook' ? createPosixSecretSink(command.secretOutput) : undefined;
    const result = await provisionLiveSetup({ stripe, catalog, billingSource, env: process.env, stage: command.stage, secretSink });
    console.log(JSON.stringify(result, null, 2));
  }
} catch {
  console.error('REFUSED/FAILED: XENOSYSTEM live billing was not changed or fully verified. Partial owned resources may remain and are reconciled on retry. Provider details and secrets suppressed.');
  process.exitCode = 1;
}
