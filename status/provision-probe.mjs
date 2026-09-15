#!/usr/bin/env node
/**
 * Create the XENO Status probe account and store its key — WITHOUT displaying the key.
 *
 * The deep checks (a real chat turn and a real web search) need their own principal: a
 * dedicated agent owned by the admin, so its key is separately revocable, its usage is kept
 * apart from real traffic, and a leak cannot touch the admin account.
 *
 *   node status/provision-probe.mjs                     # plan only — writes nothing
 *   node status/provision-probe.mjs --confirm           # create the agent, grant credits, store key
 *   node status/provision-probe.mjs --confirm --rotate  # revoke its keys and store a new one
 *
 * Options: --owner <handle> (default: the single active admin), --credits <n> (default 200).
 *
 * 🔴 THE KEY IS NEVER PRINTED. The container half writes it to stdout; this process captures
 * that stdout into memory and writes `PROBE_API_KEY` to ~/.xeno-secrets. Only a prefix and a
 * length ever reach the terminal. Then run `node status/deploy.mjs --confirm` to hand it to
 * the Worker as an encrypted secret.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const HOST = 'xeno-platform-001';
const CONTAINER = 'xeno-platform-backend-2';
const REMOTE_TMP = '/tmp/provision-probe.container.mjs';
const CONTAINER_PATH = '/app/provision-probe.container.mjs';
const SECRETS = join(homedir(), '.xeno-secrets');
const KEY_NAME = 'PROBE_API_KEY';

const mode = !flag('--confirm') ? 'plan' : flag('--rotate') ? 'rotate' : 'create';
const owner = option('--owner', '-');
const credits = option('--credits', '200');

function ssh(command, { input } = {}) {
  return spawnSync('ssh', [HOST, command], { input, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function upsertSecret(name, value) {
  const current = existsSync(SECRETS) ? readFileSync(SECRETS, 'utf8') : '';
  const lines = current.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  const next = `${lines.join('\n')}\n`;
  // The invariant that matters: no OTHER credential may disappear. (A byte-length check would
  // fire falsely whenever blank lines or CRLF endings are normalised.)
  const names = (text) => new Set(text.split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=/)?.[1]).filter(Boolean));
  const lost = [...names(current)].filter((n) => n !== name && !names(next).has(n));
  if (lost.length) throw new Error(`refusing to write: ${lost.length} other key(s) would be lost`);
  // Write-then-rename: the store is never observed half-written, and a failure mid-write
  // cannot truncate the file that holds every other credential.
  const tmp = `${SECRETS}.tmp-${process.pid}`;
  writeFileSync(tmp, next, { mode: 0o600 });
  renameSync(tmp, SECRETS);
  try { chmodSync(SECRETS, 0o600); } catch { /* not meaningful on every filesystem */ }
}

function main() {
  console.log(`XENO Status probe — ${mode === 'plan' ? 'PLAN (nothing will be written)' : mode.toUpperCase()}`);

  // Stage the container half.
  const script = readFileSync(join(HERE, 'provision-probe.container.mjs'), 'utf8');
  const staged = ssh(`cat > ${REMOTE_TMP} && sudo docker cp ${REMOTE_TMP} ${CONTAINER}:${CONTAINER_PATH}`, { input: script });
  if (staged.status !== 0) throw new Error(`could not stage the container script: ${staged.stderr.trim()}`);

  let run;
  try {
    run = ssh(`sudo docker exec -w /app ${CONTAINER} node ${CONTAINER_PATH} ${mode} ${owner} ${credits}`);
  } finally {
    ssh(`sudo docker exec -u root ${CONTAINER} rm -f ${CONTAINER_PATH}; rm -f ${REMOTE_TMP}`);
  }

  // Progress lines are safe by construction: the container half writes the key to stdout only.
  for (const line of (run.stderr || '').split('\n').filter(Boolean)) {
    if (!/ExperimentalWarning|trace-warnings/.test(line)) console.log(`  ${line}`);
  }
  const last = (run.stdout || '').trim().split('\n').pop() || '{}';
  let result = {};
  try { result = JSON.parse(last); } catch { /* handled below */ }

  if (mode === 'plan') {
    if (run.status !== 0) process.exitCode = run.status || 1;
    else console.log('\nRe-run with --confirm to apply.');
    return;
  }

  // 🔴 Store a key whenever one came back — EVEN IF the run then failed. The container emits
  // the key before granting credits, so a failed grant leaves a real, working key that exists
  // only in this process's memory. Discarding it because the exit code was non-zero would
  // strand an account nobody can authenticate as.
  const hasKey = typeof result.key === 'string' && /^xk_[0-9a-f]{48}$/.test(result.key);
  if (hasKey) {
    upsertSecret(KEY_NAME, result.key);
    console.log(`\n✓ stored ${KEY_NAME} in ~/.xeno-secrets (prefix ${result.key.slice(0, 16)}…, length ${result.key.length})`);
  }
  if (run.status !== 0) {
    if (hasKey) console.log('  ⚠️  the key is stored, but a later step failed (see above) — most likely the credit grant.');
    process.exitCode = run.status || 1;
    return;
  }
  if (!hasKey) throw new Error('no well-formed key came back; nothing was stored');
  console.log('  Next: node status/deploy.mjs --confirm   — hands the key to the Worker and switches on the deep checks');
}

try {
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'true'], { stdio: 'ignore' });
  main();
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
}
