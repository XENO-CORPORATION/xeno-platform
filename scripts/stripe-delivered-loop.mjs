#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeFor, quietDependencies, allPages, runProof, validateTarget } from './lib/paid-loop-proof.mjs';
import { validateSandbox, SANDBOX_ACCOUNT, API_VERSION } from './lib/stripe-sandbox-catalog.mjs';
import { isolatedEnvironment, deliveryReceiver, probeTunnel } from './lib/stripe-delivery-receiver.mjs';
import { recoveryProof } from './lib/stripe-recovery-proof.mjs';
import { billingAccountConfig, requireBillingDatabaseBinding } from '../src/server/utils/billingAccountBinding.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let stage = 'configuration';
try {
  if (modeFor(process.argv.slice(2)) === 'plan') {
    emit({ status: 'UNEXECUTED', account: SANDBOX_ACCOUNT, actions: ['Create disposable loopback PostgreSQL',
      'Temporarily expose only a signature-checked webhook route', 'Create isolated test endpoint',
      'Run real provider service loop', 'Remove owned endpoint, stop tunnel/container, retain SQL audit'],
    notExercised: ['Hosted Checkout completion', 'Renewal', 'Refund', 'Receipt delivery', 'Browser relogin', 'Production deployment'] });
  } else {
    validateSandbox(process.env);
    const accountConfig = billingAccountConfig(process.env);
    const transport = process.env.XENO_PAID_LOOP_TRANSPORT || 'public-webhook';
    if (!['public-webhook', 'stripe-cli'].includes(transport)) throw new Error('invalid_transport');
    const journey = process.env.XENO_PAID_LOOP_JOURNEY || 'service';
    if (!['service', 'hosted', 'renewal', 'credits', 'recovery'].includes(journey)) throw new Error('invalid_journey');
    if (journey === 'recovery' && transport !== 'public-webhook') throw new Error('public_recovery_required');
    const dockerPaths = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(USERPROFILE|HOME|APPDATA|LOCALAPPDATA|DOCKER_CONFIG)$/i.test(key)));
    const clean = isolatedEnvironment(process.env);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, clean);
    const { result, errors } = await quietDependencies(async () => {
      const require = createRequire(new URL('../src/server/package.json', import.meta.url));
      const Stripe = require('stripe'), { Pool } = require('pg');
      const { assertLocalDocker, pinnedQualificationImage } = await import('./lib/platform-qualification.mjs');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION, maxNetworkRetries: 0, timeout: 15_000 });
      const runId = randomBytes(16).toString('hex'), database = `xeno_paid_loop_${runId}`, containerName = `xeno-paid-${runId}`;
      const report = { status: 'failed', transport, journey, account: SANDBOX_ACCOUNT, runId, database, cleanup: [], proof: null };
      const evidence = await mkdtemp(path.join(os.tmpdir(), 'xeno-delivered-loop-'));
      let containerId, admin, receiverPool, receiver, tunnel, endpointUrl, endpointId, services, stopping = false, tunnelFailed = false;
      const progress = name => { stage = name; emit({ stage, runId }); };
      const command = async (file, args, env = clean, timeout = 120_000) => {
        const output = await new Promise((resolve, reject) => {
          const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let text = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('command_timeout')); }, timeout);
          child.stdout.on('data', data => { text += data; }); child.stderr.resume();
          child.on('error', () => { clearTimeout(timer); reject(new Error('command_unavailable')); });
          child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(text) : reject(new Error('command_failed')); });
        });
        return output;
      };
      const docker = args => command('docker', args, { ...clean, ...dockerPaths });
      const assertOwn = async () => {
        if (!/^[a-f0-9]{64}$/.test(containerId || '')) throw new Error('container_identity');
        const [info] = JSON.parse(await docker(['inspect', containerId]));
        if (info.Id !== containerId || info.Name !== `/${containerName}` || info.Config.Labels?.['xeno.paid-loop'] !== runId) throw new Error('container_ownership');
        return info;
      };
      try {
        progress('account-and-catalog');
        const account = await stripe.accounts.retrieve();
        if (account.object !== 'account' || account.id !== SANDBOX_ACCOUNT) throw new Error('account_mismatch');
        if ((await allPages(args => stripe.webhookEndpoints.list(args), {})).some(e => e.status !== 'disabled')) throw new Error('shared_webhooks');
        const catalog = JSON.parse(await command(process.execPath, ['scripts/stripe-sandbox-catalog.mjs', '--confirm']));
        if (catalog.status !== 'verified-catalog-only' || catalog.account !== SANDBOX_ACCOUNT) throw new Error('catalog_unverified');
        for (const item of catalog.prices) process.env[item.env] = item.priceId;
        progress('disposable-database');
        const [context] = JSON.parse(await docker(['context', 'inspect']));
        assertLocalDocker(context.Endpoints?.docker?.Host || '');
        const image = pinnedQualificationImage(await readFile(path.join(root, 'scripts/remote-chat-database-cutover.sh'), 'utf8'));
        await docker(['image', 'inspect', image]);
        const password = randomBytes(32).toString('hex');
        containerId = (await command('docker', ['create', '--pull=never', '--name', containerName, '--label', `xeno.paid-loop=${runId}`,
          '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', image], { ...clean, ...dockerPaths, POSTGRES_PASSWORD: password })).trim();
        await assertOwn(); report.containerId = containerId; emit({ runId, containerId });
        await docker(['start', containerId]);
        const binding = (await assertOwn()).NetworkSettings.Ports['5432/tcp']?.[0];
        if (binding?.HostIp !== '127.0.0.1' || !/^\d+$/.test(binding.HostPort)) throw new Error('nonlocal_database');
        const dbConfig = { host: '127.0.0.1', port: Number(binding.HostPort), user: 'postgres', password,
          connectionTimeoutMillis: 5000, statement_timeout: 120_000 };
        admin = new Pool({ ...dbConfig, database: 'postgres' });
        for (let attempt = 0; ; attempt++) {
          try { await admin.query('SELECT 1'); break; } catch { if (attempt >= 30) throw new Error('database_timeout'); await new Promise(r => setTimeout(r, 1000)); }
        }
        await admin.query(`CREATE DATABASE "${database}"`);
        await admin.query(`COMMENT ON DATABASE "${database}" IS 'xeno-paid-loop:${runId}'`);
        receiverPool = new Pool({ ...dbConfig, database, max: 8 });
        const { runRequiredStartupMigrations } = await import('../src/server/services/startupSchema.js');
        await runRequiredStartupMigrations(receiverPool);
        // Bind the verified empty fixture database before clock/customer setup;
        // pre-created fixture mappings must not look like an implicit migration.
        await requireBillingDatabaseBinding(receiverPool, accountConfig);
        const marker = (await receiverPool.query("SELECT current_database() AS name, shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=current_database()")).rows[0];
        if (marker?.name !== database || marker.comment !== `xeno-paid-loop:${runId}`) throw new Error('receiver_db_mismatch');
        progress('isolated-receiver');
        receiver = deliveryReceiver({ getServices: () => services, pool: receiverPool });
        await new Promise(resolve => receiver.server.listen(0, '127.0.0.1', resolve));
        const port = receiver.server.address().port;
        const source = await readFile(path.join(root, 'src/server/services/billingService.js'), 'utf8');
        const events = [...new Set([...source.matchAll(/case '([a-z_]+\.[a-z_.]+)':/g)].map(m => m[1]))].sort();
        if (events.length !== 11) throw new Error('event_manifest_changed');
        let cliReady = false;
        if (transport === 'stripe-cli') {
          endpointUrl = `http://127.0.0.1:${port}/api/billing/webhook`;
          const cliConfig = path.join(evidence, 'stripe-empty.toml'); await writeFile(cliConfig, '');
          process.env.STRIPE_WEBHOOK_SECRET = await new Promise((resolve, reject) => {
            tunnel = spawn('stripe', ['listen', '--config', cliConfig, '--color', 'off', '--skip-update',
              '--events', events.join(','), '--forward-to', endpointUrl],
            { env: { ...clean, HOME: evidence, USERPROFILE: evidence, STRIPE_API_KEY: clean.STRIPE_SECRET_KEY },
              windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            const timer = setTimeout(() => reject(new Error('tunnel_timeout')), 60_000);
            let output = '';
            const read = data => {
              output = (output + data).slice(-16000);
              const secret = output.match(/\bwhsec_[A-Za-z0-9]+\b/);
              if (output.includes('Ready!') && secret) {
                cliReady = true; clearTimeout(timer);
                report.cliApiVersion = output.match(/API Version \[([^\]]+)\]/)?.[1] || 'not-reported';
                resolve(secret[0]); output = '';
              }
            };
            tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
            tunnel.on('error', () => { clearTimeout(timer); tunnelFailed = true; reject(new Error('tunnel_failed')); });
            tunnel.on('close', code => {
              if (!stopping) {
                tunnelFailed = true;
                report.cliStartup = { exitCode: code, ready: cliReady,
                  authFailure: /Invalid API Key|Unauthorized|authentication/i.test(output),
                  permissionFailure: /permission|not allowed|restricted/i.test(output),
                  networkFailure: /dial tcp|no such host|timeout/i.test(output),
                  unknownFlag: /unknown flag/i.test(output) };
              }
              clearTimeout(timer); reject(new Error('tunnel_exited'));
            });
          });
        } else {
        const configPath = path.join(evidence, 'cloudflared-empty.yml'); await writeFile(configPath, '{}\n');
        endpointUrl = await new Promise((resolve, reject) => {
          tunnel = spawn('cloudflared', ['tunnel', '--config', configPath, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`],
            { env: clean, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          const timer = setTimeout(() => reject(new Error('tunnel_timeout')), 60_000);
          let output = '';
          report.tunnelConnectionRegistered = false;
          const read = data => {
            output = (output + data).slice(-16000);
            const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
            if (output.includes('Registered tunnel connection')) report.tunnelConnectionRegistered = true;
            if (url && report.tunnelConnectionRegistered) { clearTimeout(timer); resolve(`${url[0]}/api/billing/webhook`); }
          };
          tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
          tunnel.on('error', () => { clearTimeout(timer); tunnelFailed = true; reject(new Error('tunnel_failed')); });
          tunnel.on('close', () => { if (!stopping) tunnelFailed = true; clearTimeout(timer); reject(new Error('tunnel_exited')); });
        });
        report.webhookUrl = endpointUrl; emit({ runId, webhookUrl: endpointUrl });
        const endpoint = await stripe.webhookEndpoints.create({ url: endpointUrl, enabled_events: events, api_version: API_VERSION,
          metadata: { xenoPaidLoop: runId } }, { idempotencyKey: `paid-loop-endpoint:${runId}` });
        if (endpoint.livemode !== false || endpoint.url !== endpointUrl || !/^whsec_[A-Za-z0-9]+$/.test(endpoint.secret || '')) throw new Error('endpoint_invalid');
        endpointId = endpoint.id;
        process.env.STRIPE_WEBHOOK_SECRET = endpoint.secret;
        }
        process.env.SUBJECT_HASH_SECRET = randomBytes(32).toString('hex');
        Object.assign(process.env, { XENO_PAID_LOOP_RUN_ID: runId, DB_NAME: database, DB_HOST: '127.0.0.1', DB_PORT: String(binding.HostPort),
          DB_USER: 'postgres', DB_PASSWORD: password, BILLING_APP_URL: `http://127.0.0.1:${port}`, XENO_PAID_LOOP_WEBHOOK_URL: endpointUrl,
          XENO_PAID_LOOP_TRANSPORT: transport });
        services = { ...await import('../src/server/services/billingService.js'), ...await import('../src/server/services/checkoutConsent.js'),
          ...await import('../src/server/services/effectivePlan.js') };
        const probeLocal = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
        report.localProbeStatus = probeLocal.status;
        if (probeLocal.status !== 400 || await probeLocal.text() !== 'invalid event') throw new Error('local_receiver_invalid');
        let reachable = cliReady;
        report.remoteProbeStatuses = [];
        for (let attempt = 0; !reachable && attempt < 20; attempt++) {
          try {
            const response = await probeTunnel(endpointUrl);
            report.remoteProbeStatuses.push(response.status);
            if (response.valid) { reachable = true; break; }
          } catch { report.remoteProbeStatuses.push('transport-failed'); }
          if (tunnelFailed) throw new Error('tunnel_failed');
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!reachable) throw new Error('receiver_unreachable');
        progress('provider-activation-and-cancellation');
        const hostedCheckout = ['hosted', 'credits'].includes(journey) ? async session => {
          emit({ stage: 'awaiting-hosted-checkout', runId, checkoutUrl: session.url, sessionId: session.id });
          const deadline = Date.now() + 15 * 60_000;
          while (Date.now() < deadline) {
            if (tunnelFailed) throw new Error('tunnel_failed');
            const current = await stripe.checkout.sessions.retrieve(session.id);
            if (current.status === 'complete') return;
            if (current.status !== 'open') throw new Error('checkout_not_open');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          throw new Error('hosted_checkout_timeout');
        } : undefined;
        report.proof = await runProof({ config: validateTarget(process.env), pool: new Pool({ ...dbConfig, database, max: 3 }),
          stripe, services, webhookSource: source, cliReady, hostedCheckout: journey === 'hosted' ? hostedCheckout : undefined,
          recovery: journey === 'recovery' ? recoveryProof({ receiver, stripe, resend: async eventId => {
            if (!/^evt_[A-Za-z0-9]+$/.test(eventId) || !/^we_[A-Za-z0-9]+$/.test(endpointId || '')) throw new Error('resend_identity');
            const endpoint = await stripe.webhookEndpoints.retrieve(endpointId);
            if (endpoint.livemode !== false || endpoint.status !== 'enabled' || endpoint.url !== endpointUrl
              || endpoint.metadata?.xenoPaidLoop !== runId) throw new Error('resend_endpoint_owner');
            const cliConfig = path.join(evidence, 'stripe-empty.toml'); await writeFile(cliConfig, '');
            await command('stripe', ['events', 'resend', eventId, '--webhook-endpoint', endpointId,
              '--confirm', '--config', cliConfig, '--color', 'off'],
            { ...clean, HOME: evidence, USERPROFILE: evidence, STRIPE_API_KEY: clean.STRIPE_SECRET_KEY }, 30_000);
          } }) : undefined,
          creditsCheckout: journey === 'credits' ? hostedCheckout : undefined, renewal: journey === 'renewal', receipts: receiver.receipts, pollMs: 90_000 });
        report.delivery = receiver.counters;
        if (report.proof.status !== 'passed-service-loop-only' || receiver.counters.failed || !receiver.counters.accepted || tunnelFailed) throw new Error('proof_failed');
        report.status = 'passed-delivered-service-loop-only';
      } catch (error) {
        report.failedStage = stage;
        const safeCodes = ['account_mismatch', 'shared_webhooks', 'catalog_unverified', 'container_identity', 'container_ownership',
          'nonlocal_database', 'database_timeout', 'receiver_db_mismatch', 'tunnel_timeout', 'tunnel_failed', 'tunnel_exited',
          'event_manifest_changed', 'endpoint_invalid', 'local_receiver_invalid', 'receiver_unreachable', 'proof_failed', 'command_failed'];
        report.failureCode = safeCodes.includes(error?.message) ? error.message : 'dependency-failed';
        if (['StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError', 'StripeConnectionError'].includes(error?.type)) report.providerErrorType = error.type;
      }
      finally {
        progress('cleanup');
        if (endpointUrl) {
          try {
            const endpoints = await allPages(args => stripe.webhookEndpoints.list(args), {});
            for (const endpoint of endpoints.filter(e => e.url === endpointUrl && e.metadata?.xenoPaidLoop === runId)) {
              if (endpoint.livemode !== false || !/^we_[A-Za-z0-9]+$/.test(endpoint.id)) throw new Error('endpoint_cleanup_identity');
              const removed = await stripe.webhookEndpoints.del(endpoint.id);
              if (removed.deleted !== true || removed.id !== endpoint.id) throw new Error('endpoint_delete_failed');
            }
            if ((await allPages(args => stripe.webhookEndpoints.list(args), {})).some(e => e.url === endpointUrl)) throw new Error('endpoint_remains');
            report.cleanup.push(transport === 'stripe-cli' ? 'no-owned-endpoint-present' : 'owned-endpoint-removed');
          } catch { report.cleanup.push('endpoint-cleanup-failed'); report.status = 'failed'; }
        }
        if (tunnelFailed) { report.status = 'failed'; report.cleanup.push('unexpected-transport-exit'); }
        stopping = true;
        if (tunnel) {
          tunnel.kill();
          await new Promise(resolve => { if (tunnel.exitCode != null || tunnel.signalCode != null) resolve(); else { tunnel.once('close', resolve); setTimeout(resolve, 5000).unref(); } });
          if (tunnel.exitCode == null && tunnel.signalCode == null) { report.status = 'failed'; report.cleanup.push('tunnel-stop-failed'); }
          else report.cleanup.push('tunnel-stopped');
        }
        if (receiver) {
          try {
            receiver.server.closeAllConnections(); await new Promise(resolve => receiver.server.close(resolve));
            await receiver.waitForIdle();
            report.delivery = { ...receiver.counters };
            report.receipts = [...receiver.receipts];
            report.outageReceipts = [...receiver.outageReceipts];
            if (receiver.counters.failed) { report.status = 'failed'; report.cleanup.push('receiver-handler-failed'); }
          }
          catch { report.status = 'failed'; report.cleanup.push('receiver-close-failed'); }
          finally { report.receipts = [...receiver.receipts]; report.outageReceipts = [...receiver.outageReceipts]; report.delivery = { ...receiver.counters }; }
        }
        for (const pool of [receiverPool, admin]) if (pool) {
          try {
            let closeTimer;
            try { await Promise.race([pool.end(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('pool_close_timeout')), 15_000); })]); }
            finally { clearTimeout(closeTimer); }
          } catch { report.status = 'failed'; report.cleanup.push('database-close-failed'); }
        }
        if (containerId) {
          try { await assertOwn(); await docker(['stop', containerId]); if ((await assertOwn()).State.Running) throw new Error('still_running'); report.cleanup.push('owned-database-stopped-retained'); }
          catch { report.status = 'failed'; report.cleanup.push('database-stop-failed'); }
        }
      }
      await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
      return { ...report, evidence: path.join(evidence, 'report.json') };
    });
    if (errors) {
      result.status = 'failed'; result.dependencyLoggedErrors = errors;
      // Persist the final verdict, including errors swallowed by dependencies.
      const { evidence, ...report } = result;
      await writeFile(evidence, JSON.stringify(report, null, 2));
    }
    emit(result); if (result.status !== 'passed-delivered-service-loop-only') process.exitCode = 1;
  }
} catch { emit({ status: 'failed', stage, details: 'suppressed' }); process.exitCode = 1; }
