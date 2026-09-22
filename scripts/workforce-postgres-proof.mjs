#!/usr/bin/env node
/**
 * Owned disposable PostgreSQL proof for the workforce SQL suites.
 *
 * WHY THIS EXISTS, and why the suites are not simply `{ skip: !url }` like the
 * other database suites in this chain:
 *
 * The workforce SQL suites assert their connection string rather than skipping
 * ("WORKFORCE_TEST_DATABASE_URL required; no skipped SQL proof"). That stance is
 * deliberate and must not be weakened: these are the proof that the canonical
 * ownership/assignment schema actually enforces what it claims, and a suite that
 * quietly reports zero tests is indistinguishable from a suite that passed.
 *
 * But a suite that hard-fails without a fixture cannot sit in `npm test`, so for
 * a long time these five were not wired in at all — on disk, green when run by
 * hand, and unreachable from the chain. `gates-are-reachable.test.mjs` was RED
 * because of it, which is this repository's own name for the failure: built,
 * tested, unreachable.
 *
 * This runner resolves both: it OWNS a fixture, so the suites always get the URL
 * they demand and keep refusing to be skipped, and the decision about whether the
 * proof could run at all is made HERE, out loud, where it is visible in the run
 * output instead of absent from it.
 *
 * The suite list is passed as arguments rather than hardcoded, so it lives in
 * exactly one place — the `package.json` step — where `gates-are-reachable`
 * can see each filename and confirm it is reached.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const suites = process.argv.slice(2).filter((a) => a.endsWith('.test.mjs'));
if (!suites.length) {
  process.stderr.write('No suites supplied. Pass the .test.mjs files to prove as arguments.\n');
  process.exit(1);
}
const missing = suites.filter((s) => !existsSync(s));
if (missing.length) {
  // A renamed suite must be loud here, not silently proven-by-absence.
  process.stderr.write(`Named suites do not exist: ${missing.join(', ')}\n`);
  process.exit(1);
}

/* CI can demand the real proof. Default is a visible skip so the chain stays
 * runnable on a machine with no container runtime; `=1` makes absence fatal. */
const required = process.env.WORKFORCE_PG_PROOF_REQUIRED === '1';
const label = `workforce-proof-${randomUUID()}`;
const password = randomUUID();
const run = (cmd, args, options = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...options });

const unavailable = (reason) => {
  if (required) {
    process.stderr.write(`WORKFORCE PG PROOF REQUIRED BUT UNAVAILABLE: ${reason}\n`);
    process.exit(1);
  }
  // Marked so it cannot be mistaken for a pass when scanning output.
  process.stdout.write(
    `\n# SKIP workforce PostgreSQL proof NOT RUN: ${reason}\n` +
      `#      ${suites.length} SQL suites were NOT executed and nothing about the\n` +
      `#      workforce schema is proven by this run. Set WORKFORCE_PG_PROOF_REQUIRED=1\n` +
      `#      to make this a hard failure instead.\n\n`,
  );
  process.exit(0);
};

if (run('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0) {
  unavailable('no usable Docker daemon');
}
if (run('docker', ['image', 'inspect', 'postgres:16']).status !== 0) {
  unavailable('the local postgres:16 image is absent (no download is attempted)');
}

let container;
try {
  const started = run('docker', ['run', '--pull=never', '-d', '--label', `xeno.fixture=${label}`,
    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=workforceproof', '-p', '127.0.0.1::5432', 'postgres:16'],
  { env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (started.status !== 0) throw new Error('Could not start owned fixture from local postgres:16 image (no image download attempted).');
  container = started.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid fixture identity; inspect Docker state before retrying.');
  let ready = false;
  for (let i = 0; i < 80; i++) {
    // The image initializes using a temporary socket-only server that then exits.
    // Probing that socket can race the restart and produce ECONNRESET in tests.
    if (run('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres']).status === 0) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw new Error('Owned fixture did not become ready.');
  const port = run('docker', ['port', container, '5432/tcp']);
  const match = /^127\.0\.0\.1:(\d+)$/.exec(port.stdout.trim());
  if (port.status !== 0 || !match) throw new Error('Fixture is not bound exclusively to loopback.');
  const proof = run(process.execPath, ['--test', ...suites], {
    timeout: 300000, stdio: 'inherit', env: { ...process.env,
      WORKFORCE_TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${match[1]}/workforceproof`,
      JWT_SECRET: randomUUID() + randomUUID(),
    },
  });
  if (proof.status !== 0) throw new Error('Workforce proof failed or timed out; see test output.');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (container && /^[a-f0-9]{64}$/.test(container)) {
    const inspected = run('docker', ['inspect', '--format', '{{ index .Config.Labels "xeno.fixture" }}', container]);
    if (inspected.status === 0 && inspected.stdout.trim() === label) {
      // No supplied volumes: -v removes only anonymous volumes created for this fixture.
      const removed = run('docker', ['rm', '-f', '-v', container]);
      if (removed.status !== 0) { process.stderr.write(`Owned fixture cleanup failed: ${container}\n`); process.exitCode = 1; }
    } else { process.stderr.write(`Fixture ownership could not be verified; cleanup refused: ${container}\n`); process.exitCode = 1; }
  }
}
