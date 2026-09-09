#!/usr/bin/env node
/** Local fixture qualification, never production launch authorization. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runRequiredStartupMigrations } from '../src/server/services/startupSchema.js';
import { migrationStatus } from '../src/server/services/migrationRunner.js';
import { verifyChainV2 } from '../src/server/utils/creditLedgerV2.js';
import { assertLocalDocker, assertOwnedDatabase, assertScratchPath, assertRestored, childEnvironment,
  parseMoneySummary, parseBackendSummary, parseTapSummary, pinnedQualificationImage, schemaAndRows, requireLegacySchemas } from './lib/platform-qualification.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendOnly = process.argv.length === 3 && process.argv[2] === '--backend-only';
const billingOnly = process.argv.length === 3 && process.argv[2] === '--billing-only';
if (process.argv.length > 2 && !backendOnly && !billingOnly) throw new Error('Only --backend-only or --billing-only is accepted; targets are always newly created local fixtures');
const runId = randomBytes(16).toString('hex');
const containerName = `xeno-qual-${runId}`;
const password = randomBytes(32).toString('hex');
const evidence = await mkdtemp(path.join(os.tmpdir(), 'xeno-launch-evidence-'));
const scratch = path.join(evidence, 'scratch');
await mkdir(scratch);
const owned = new Set();
let containerId, admin, connection;
let stage = 'preflight';
const report = { startedAt: new Date().toISOString(), qualification: 'local-fixtures-only', mode: billingOnly ? 'billing-and-restore' : backendOnly ? 'backend-suites' : 'platform-and-restore', status: 'running', stages: [],
  notExercised: ['Hosted Stripe checkout and real provider webhook delivery', 'Real embedding provider quality',
    'Email delivery, Google OAuth and complete browser onboarding', 'Production-data migration/restore',
    'Cross-product host/folder execution permissions', 'Production deployment and commercial launch approval'] };
const redact = text => String(text).replaceAll(password, '[redacted]');
const baseEnv = childEnvironment(process.env, scratch, '');

async function command(file, args, { env = baseEnv, cwd = root, timeout = 120_000, log = null } = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output: redact(output), timedOut }); });
  });
  if (log) await writeFile(path.join(evidence, `${log}.log`), result.output);
  if (result.timedOut) throw new Error(`${stage}: subprocess timed out`);
  if (result.code !== 0) throw new Error(`${stage}: subprocess failed (${result.code}); ${result.output.slice(-3000)}`);
  return result.output;
}

// Docker alone needs the real client config location, not a test's scratch HOME.
const dockerEnv = { ...baseEnv, ...Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => /^(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|DOCKER_CONFIG)$/i.test(key))) };
const docker = (args, options = {}) => command('docker', args, { ...options, env: dockerEnv });
const inspectOwn = async () => {
  if (!/^[a-f0-9]{64}$/.test(containerId || '')) throw new Error('Missing owned container identity');
  const [info] = JSON.parse(await docker(['inspect', containerId]));
  if (info.Id !== containerId || info.Name !== `/${containerName}` || info.Config.Labels?.['xeno.qualification'] !== runId) {
    throw new Error('Container ownership changed');
  }
  return info;
};
const poolFor = database => new pg.Pool({ ...connection, database, max: 6, connectionTimeoutMillis: 10_000, statement_timeout: 1_200_000 });
const urlFor = database => `postgresql://postgres:${password}@127.0.0.1:${connection.port}/${database}`;

async function createDatabase(name) {
  if (!/^xeno_(qual|payment)_[a-f0-9]{32}(?:_restore)?$/.test(name)) throw new Error('Invalid generated database name');
  await admin.query(`CREATE DATABASE "${name}"`);
  owned.add(name); // Only a successful create establishes ownership.
}


async function restoreCheck(database, label) {
  assertOwnedDatabase(database, owned);
  const beforePool = poolFor(database);
  let before;
  try { before = await schemaAndRows(beforePool); } finally { await beforePool.end(); }
  const restoredName = `${database}_restore`;
  await createDatabase(restoredName);
  const dump = `/tmp/${database}.dump`;
  await inspectOwn();
  await docker(['exec', containerId, 'pg_dump', '-U', 'postgres', '-d', database, '-Fc', '--no-owner', '--no-privileges', '-f', dump]);
  await docker(['exec', containerId, 'pg_restore', '--list', dump]);
  // Restoring rebuilds the 100k-row HNSW index, not just table data. Give this
  // bounded workload the same deadline as its scale qualification.
  await docker(['exec', containerId, 'pg_restore', '-U', 'postgres', '-d', restoredName, '--no-owner', '--no-privileges', '--exit-on-error', dump],
    { timeout: 25 * 60_000 });
  const restored = poolFor(restoredName);
  try {
    assertRestored(before, await schemaAndRows(restored));
    let chainAccounts = 0;
    if (label === 'payment') {
      // A restored ledger can have valid old hashes but lack write protection.
      // Prove this check detects that hazard, then roll the negative control back.
      const control = await restored.connect();
      try {
        await control.query('BEGIN');
        await control.query('ALTER TABLE credit_transactions DISABLE TRIGGER trg_credit_txn_immutable');
        const disabled = await schemaAndRows(control);
        let rejected = false;
        try { assertRestored(before, disabled); }
        catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; rejected = true; }
        if (!rejected) throw new Error('Restore verifier accepted a disabled ledger protection trigger');
      } finally { try { await control.query('ROLLBACK'); } finally { control.release(); } }
      assertRestored(before, await schemaAndRows(restored));
      for (const row of (await restored.query('SELECT user_id FROM credit_accounts')).rows) {
        const chain = await verifyChainV2(restored, row.user_id);
        if (!chain.ok) throw new Error('Restored payment ledger hash chain is invalid');
        chainAccounts++;
      }
      if (chainAccounts < 1) throw new Error('No ledger accounts were restored');
    }
    return { tables: before.data.length, rows: before.data.reduce((sum, t) => sum + Number(t.count), 0), chainAccounts };
  } finally { await restored.end(); }
}

async function step(name, fn) {
  stage = name;
  console.log(`[qualification] ${name}`);
  const started = Date.now();
  const result = await fn();
  report.stages.push({ name, status: 'passed', durationMs: Date.now() - started, result });
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}

try {
  await step('local Docker and source identity', async () => {
    const context = (await docker(['context', 'show'])).trim();
    const [info] = JSON.parse(await docker(['context', 'inspect', context]));
    assertLocalDocker(info.Endpoints?.docker?.Host || '');
    report.revision = (await command('git', ['rev-parse', 'HEAD'])).trim();
    report.dirtyWorktree = Boolean((await command('git', ['status', '--porcelain'])).trim());
    report.image = pinnedQualificationImage(await readFile(path.join(root, 'scripts/remote-chat-database-cutover.sh'), 'utf8'));
    await docker(['image', 'inspect', report.image]);
    return { context, image: report.image };
  });
  await step('isolated PostgreSQL container', async () => {
    containerId = (await command('docker', ['create', '--pull=never', '--name', containerName,
      '--label', `xeno.qualification=${runId}`, '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', report.image],
    { env: { ...dockerEnv, POSTGRES_PASSWORD: password } })).trim();
    await docker(['start', containerId]);
    const info = await inspectOwn();
    const binding = info.NetworkSettings.Ports['5432/tcp']?.[0];
    if (binding?.HostIp !== '127.0.0.1' || !/^\d+$/.test(binding.HostPort)) throw new Error('Database port is not loopback-bound');
    connection = { host: '127.0.0.1', port: Number(binding.HostPort), user: 'postgres', password };
    admin = poolFor('postgres');
    for (let attempt = 0; ; attempt++) {
      try { await admin.query('SELECT 1'); break; }
      catch (error) { if (attempt >= 30) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    return { container: containerId, port: connection.port };
  });
// Every DB-backed suite under src/server/tests. Reachability is gated by
// scripts/gates-are-reachable.test.mjs: eight of these ran nowhere at all until
// 2026-09-09 — not here, not in CI, not from any npm script — including the DPoP
// exchange, the OIDC authority policy and three ledger suites.
// Deliberately NOT exported. Importing this file spins up Docker containers and
// creates databases — running it IS the side effect — so the reachability gate
// reads this array out of the source text instead of importing it.
const BACKEND_SUITES = [
  'ledger-v2', 'ledger-chain', 'ledger-billing', 'ledger-correctness',
  'media-metering', 'wallet-service', 'authz-v2', 'oidc-v2', 'erasure',
  'account-recovery', 'auth-token-confusion', 'api-key-auth', 'browser-bff-session',
  'credit-mirror-drift', 'dpop-token-exchange', 'fresh-db-boot',
  'ledger-audit-fixes', 'service-ledger', 'readonly-preview-lifecycle',
];

const BACKEND_EVIDENCE = {
  'browser-bff-session': 'browser BFF session: opaque cookie, no browser bearer, CSRF, and revocation passed',
  'credit-mirror-drift': 'PASS: users.credits == round(credit_accounts.balance) for every account; no false lock-outs.',
  'dpop-token-exchange': 'DPoP + broker token exchange: sender, actor, scope, lifetime, and replay gates passed',
  'fresh-db-boot': 'RESULT: PASS',
  'readonly-preview-lifecycle': 'readonly-preview-lifecycle: read purity, no lazy writes',
};

  if (backendOnly) {
    // Match the independently seeded CI suites: never share their minimal schemas.
    // No provider credentials are inherited, and registration opens only in these children.
    let failures = 0;
    for (const suite of BACKEND_SUITES) {
      const database = `xeno_qual_${randomBytes(16).toString('hex')}`;
      await createDatabase(database);
      try {
        await step(`backend-${suite}`, async () => {
          const output = await command(process.execPath, [path.join(root, `src/server/tests/${suite}.test.mjs`)], {
            env: { ...childEnvironment(process.env, scratch, urlFor(database)), REGISTRATION_OPEN: 'true' },
            cwd: scratch, timeout: 180_000, log: suite,
          });
          const evidence = BACKEND_EVIDENCE[suite];
          if (evidence) {
            // These suites predate the shared summary line. Requiring their exact
            // positive sentence is what makes a SKIP distinguishable from a pass:
            // credit-mirror-drift prints "SKIP: DATABASE_URL not set" and exits 0.
            if (!output.includes(evidence)) throw new Error(`${suite}: missing success evidence`);
            return { evidence: 'passed' };
          }
          return parseBackendSummary(output, 0, suite);
        });
      } catch (error) {
        failures++;
        report.stages.push({ name: `backend-${suite}`, status: 'failed', error: redact(error.message) });
        console.error(`[qualification] ${suite} failed; see retained suite log`);
      }
    }
    if (failures) {
      stage = 'backend-suite-summary';
      throw new Error(`${failures} backend suite(s) failed`);
    }
  } else if (billingOnly) {
    const paymentDb = `xeno_payment_${runId}`;
    await createDatabase(paymentDb);
    await step('payment-ledger-and-signed-http', async () => {
      const output = await command(process.execPath, [path.join(root, 'src/server/tests/billing-money-in.test.mjs')],
        { env: childEnvironment(process.env, scratch, urlFor(paymentDb)), cwd: scratch, timeout: 180_000, log: 'payment' });
      return parseMoneySummary(output, 0);
    });
    await step('payment-backup-restore', () => restoreCheck(paymentDb, 'payment'));
  } else {
  const platformDb = `xeno_qual_${runId}`, paymentDb = `xeno_payment_${runId}`;
  await createDatabase(platformDb);
  await createDatabase(paymentDb);
  await step('fresh startup migrations and replay', async () => {
    // Validate the artifact before provisioning its schema; production also
    // enforces required inputs in the shared startup pipeline below.
    await requireLegacySchemas(root);
    const pool = poolFor(platformDb);
    try {
      for (let pass = 0; pass < 2; pass++) {
        const result = await runRequiredStartupMigrations(pool);
        if (pass && result.applied !== 0) throw new Error('Migration replay was not idempotent');
      }
      const migrations = await migrationStatus(pool);
      if (!migrations.length || migrations.some(row => row.status !== 'applied')) throw new Error('Migration status is incomplete');
      return { migrations: migrations.length };
    } finally { await pool.end(); }
  });
  for (const [name, files] of [
    ['workspace-project-database', ['scripts/chat-workspace-scope.database.test.mjs', 'scripts/workspace-teams.test.mjs', 'scripts/chat-project-database-integration.test.mjs']],
    ['semantic-index-scale', ['scripts/chat-project-semantic-scale-qualification.test.mjs']],
  ]) {
    await step(name, async () => {
      const output = await command(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-force-exit',
        ...files.map(file => path.join(root, file))], { env: childEnvironment(process.env, scratch, urlFor(platformDb)),
        cwd: scratch, timeout: 25 * 60_000, log: name });
      return parseTapSummary(output, 0);
    });
  }
  await step('payment-ledger-and-signed-http', async () => {
    const output = await command(process.execPath, [path.join(root, 'src/server/tests/billing-money-in.test.mjs')],
      { env: childEnvironment(process.env, scratch, urlFor(paymentDb)), cwd: scratch, timeout: 180_000, log: 'payment' });
    return parseMoneySummary(output, 0);
  });
  await step('payment-backup-restore', () => restoreCheck(paymentDb, 'payment'));
  await step('platform-backup-restore', () => restoreCheck(platformDb, 'platform'));
  }
  report.status = 'passed-local-only';
} catch (error) {
  report.status = 'failed';
  report.stages.push({ name: stage, status: 'failed', error: redact(error.message) });
  console.error(`[qualification] ${redact(error.message)}`);
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  if (admin) {
    for (const database of [...owned].reverse()) {
      try { await admin.query(`DROP DATABASE ${assertOwnedDatabase(database, owned)} WITH (FORCE)`); }
      catch (error) { cleanupErrors.push(redact(error.message)); }
    }
    try { await admin.end(); }
    catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  if (containerId) {
    try { await inspectOwn(); await docker(['rm', '-f', '-v', containerId]); }
    catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  try {
    assertScratchPath(await realpath(evidence), await realpath(scratch));
    await rm(scratch, { recursive: true });
  } catch (error) { cleanupErrors.push(redact(error.message)); }
  report.cleanup = { status: cleanupErrors.length ? 'failed' : 'passed', errors: cleanupErrors };
  if (cleanupErrors.length) { report.status = 'failed'; process.exitCode = 1; }
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[qualification] ${report.status}; evidence: ${path.join(evidence, 'report.json')}`);
}
