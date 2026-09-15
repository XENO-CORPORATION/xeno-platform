#!/usr/bin/env node
/**
 * Deploy XENO Status to Cloudflare: D1 database, schema, Worker, cron and status.xenosystem.ai.
 *
 * DRY-RUN BY DEFAULT. Nothing is created or changed without `--confirm`.
 *
 *   node status/deploy.mjs            # print the plan
 *   node status/deploy.mjs --confirm  # apply it
 *
 * Credentials come from ~/.xeno-secrets and are never printed: CF_API_TOKEN (Cloudflare),
 * RESEND_API_KEY (alert email), HEALTHCHECKS_WATCHDOG_PING_URL (dead man's switch). The
 * Worker receives the last two as encrypted secret bindings.
 *
 * Re-running is safe: the database is found by name before one is created, the schema is
 * idempotent, and the upload, cron and domain calls are all PUTs that replace in place.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIRM = process.argv.includes('--confirm');

const ACCOUNT_ID = 'd13a454ac8a3a65ac7da09c6f1b29563';
const SCRIPT = 'xeno-status';
const DATABASE = 'xeno-status';
const ZONE_NAME = 'xenosystem.ai';
const HOSTNAME = 'status.xenosystem.ai';
// Every 2 minutes. The healthchecks.io watchdog expects a ping every 5 + 5 grace, so a single
// missed run never alerts but two consecutive ones do.
const CRON = '*/2 * * * *';
const ALERT_EMAIL_TO = 'admin@xenosystem.ai';
// xenostudio.ai is a verified Resend domain (checked 2026-09-15); an unverified sender is refused.
const ALERT_EMAIL_FROM = 'XENO Status <noreply@xenostudio.ai>';
const COMPATIBILITY_DATE = '2026-09-01';

function secret(name) {
  const line = readFileSync(join(homedir(), '.xeno-secrets'), 'utf8')
    .split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  const value = line ? line.slice(name.length + 1).trim() : '';
  if (!value) throw new Error(`${name} is not set in ~/.xeno-secrets`);
  return value;
}

async function cf(method, path, body, { raw = false } = {}) {
  const init = { method, headers: { authorization: `Bearer ${secret('CF_API_TOKEN')}` } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (raw) return data;
  if (!data.success) {
    const messages = (data.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed — ${messages}`);
  }
  return data.result;
}

/** Split the schema into statements. Comment lines are dropped first, so `;` in prose is safe. */
function schemaStatements() {
  return readFileSync(join(HERE, 'schema.sql'), 'utf8')
    .split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  // Resolve every credential up front, so a missing one fails before anything is changed.
  for (const name of ['CF_API_TOKEN', 'RESEND_API_KEY', 'HEALTHCHECKS_WATCHDOG_PING_URL']) secret(name);

  const statements = schemaStatements();
  console.log('XENO Status deploy plan');
  console.log(`  account   ${ACCOUNT_ID}`);
  console.log(`  database  ${DATABASE} (D1) — ${statements.length} idempotent schema statements`);
  console.log(`  worker    ${SCRIPT} — bindings DB, RESEND_API_KEY*, HEALTHCHECKS_PING_URL*, ALERT_EMAIL_TO, ALERT_EMAIL_FROM   (* secret)`);
  console.log(`  cron      ${CRON}`);
  console.log(`  domain    https://${HOSTNAME}`);
  if (!CONFIRM) {
    console.log('\nDRY RUN — pass --confirm to apply');
    return;
  }

  const zones = await cf('GET', `/zones?name=${ZONE_NAME}`);
  if (!zones.length) throw new Error(`zone ${ZONE_NAME} is not visible to this token`);
  const zoneId = zones[0].id;

  let database = (await cf('GET', `/accounts/${ACCOUNT_ID}/d1/database?name=${DATABASE}`)).find((d) => d.name === DATABASE);
  if (database) console.log(`✓ database exists ${database.uuid}`);
  else {
    database = await cf('POST', `/accounts/${ACCOUNT_ID}/d1/database`, { name: DATABASE });
    console.log(`✓ database created ${database.uuid}`);
  }

  await cf('POST', `/accounts/${ACCOUNT_ID}/d1/database/${database.uuid}/query`, {
    batch: statements.map((sql) => ({ sql, params: [] })),
  });
  console.log(`✓ schema applied (${statements.length} statements)`);

  const metadata = {
    main_module: 'worker.mjs',
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: 'd1', name: 'DB', id: database.uuid },
      { type: 'secret_text', name: 'RESEND_API_KEY', text: secret('RESEND_API_KEY') },
      { type: 'secret_text', name: 'HEALTHCHECKS_PING_URL', text: secret('HEALTHCHECKS_WATCHDOG_PING_URL') },
      { type: 'plain_text', name: 'ALERT_EMAIL_TO', text: ALERT_EMAIL_TO },
      { type: 'plain_text', name: 'ALERT_EMAIL_FROM', text: ALERT_EMAIL_FROM },
    ],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('worker.mjs', new Blob([readFileSync(join(HERE, 'worker.mjs'))], { type: 'application/javascript+module' }), 'worker.mjs');
  await cf('PUT', `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}`, form);
  console.log(`✓ worker uploaded ${SCRIPT}`);

  await cf('PUT', `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/schedules`, [{ cron: CRON }]);
  console.log(`✓ cron set ${CRON}`);

  await cf('PUT', `/accounts/${ACCOUNT_ID}/workers/domains`, {
    hostname: HOSTNAME, service: SCRIPT, zone_id: zoneId, zone_name: ZONE_NAME, environment: 'production',
  });
  console.log(`✓ domain attached https://${HOSTNAME}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
