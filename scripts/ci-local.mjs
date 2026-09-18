#!/usr/bin/env node
/**
 * ci:local — run every gate CI would run, on this machine.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * GitHub Actions has not executed a step for this account in days: every run on
 * `main` and on every branch reports `failure` in 3-5 seconds with ZERO steps.
 * That is not a red build, it is no build — and the difference matters, because
 * a red X that means "nothing ran" teaches people to ignore red Xs.
 *
 * We own the compute. Actions was only ever the ORCHESTRATOR — it decides when
 * a build runs and records that it ran; it was never the thing that could run
 * it. So the gates move here and Actions becomes optional rather than blocking.
 * (This is exactly the layer `xeno-runner/SPEC.md` exists to own: compute is
 * ours, orchestration is the gap, attestation stays with the forge.)
 *
 * 🔴 The point is FIDELITY, not convenience. A local runner that checks a
 * DIFFERENT set of things than CI is worse than no local runner, because it
 * grants confidence it has not earned. So the suite lists and the environment
 * below are read from, and must stay identical to, the workflow files:
 *
 *   .github/workflows/gates.yml        → npm test, frontend build + bundle assert
 *   .github/workflows/core-tests.yml   → DB core suites, no-DB core suites
 *   .github/workflows/money-tests.yml  → the seven money suites, one DB each
 *
 * `--check-drift` asserts exactly that and is run as part of the chain, so if
 * someone adds a suite to a workflow and not here, THIS fails and says so.
 *
 * ── ENVIRONMENT ─────────────────────────────────────────────────────────────
 *
 * Needs Docker (for a disposable Postgres) and nothing else. Every database is
 * created fresh and dropped after, exactly as the workflows do — a suite that
 * passes only because a previous suite left rows behind is a suite that lies.
 *
 * ⚠️ The env below is not decoration. `REGISTRATION_OPEN` unset makes
 * account-recovery fail with `Cannot read properties of undefined (reading
 * 'email_verified')`, because the signup gate correctly refuses; `BYOK_ENABLED`
 * and `SECRET_BOX_KEY` unset make inference-routing-live assert nothing at all.
 * A local replication that omits the workflow's env invents failures and, worse,
 * invents passes.
 *
 * Usage:
 *   node scripts/ci-local.mjs                 # everything
 *   node scripts/ci-local.mjs --only=gates    # gates | core | money | build
 *   node scripts/ci-local.mjs --check-drift   # only verify this matches the workflows
 *   node scripts/ci-local.mjs --keep-db       # leave the container up for debugging
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'src', 'server');
const WF = join(ROOT, '.github', 'workflows');

const CORE_DB_SUITES = [
  'authz-v2', 'oidc-v2', 'erasure', 'account-recovery',
  'auth-token-confusion', 'api-key-auth', 'browser-bff-session',
  'inference-routing-live', 'dpop-token-exchange', 'readonly-preview-lifecycle',
  'leader-election', 'fresh-db-boot', 'password-change-atomicity',
  'byok-lifecycle-audit', 'gateway-catalogue-sync', 'email-delivery-events', 'suspension-gate',
];
const CORE_NODB_SUITES = ['ai-tools-passthrough', 'entitlement-gate', 'upstream'];
const MONEY_SUITES = [
  'ledger-v2', 'ledger-chain', 'ledger-billing', 'ledger-correctness',
  'billing-money-in', 'media-metering', 'wallet-service',
  'service-ledger', 'ledger-audit-fixes', 'credit-mirror-drift',
];

// Mirrors core-tests.yml `env:`. See the ENVIRONMENT note above before trimming.
const CI_ENV = {
  CI: '1',
  REGISTRATION_OPEN: 'true',
  BYOK_ENABLED: 'true',
  SECRET_BOX_KEY: 'Y2ktb25seS10ZXN0LWtleS0zMi1ieXRlcy1sb25nISE=',
  JWT_SECRET: 'ci-local-not-a-real-credential',
};

const PG = { container: 'xeno-ci-local-pg', port: '55995', password: 'test', image: 'pgvector/pgvector:0.8.6-pg15-bookworm' };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const only = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

const c = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
const log = (s = '') => process.stdout.write(`${s}\n`);
const rule = () => log(`${c.dim}${'─'.repeat(64)}${c.off}`);

function record(name, okFlag, note = '') {
  results.push({ name, ok: okFlag, note });
  log(`${okFlag ? `${c.green}PASS` : `${c.red}FAIL`}${c.off}  ${name}${note ? `  ${c.dim}${note}${c.off}` : ''}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...CI_ENV, ...(opts.env || {}) },
    stdio: opts.quiet ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/* ── DRIFT ────────────────────────────────────────────────────────────────────
 * The whole value of this script is that it runs what CI runs. That claim has
 * to be checked, not asserted, or the two silently diverge the first time
 * somebody edits a workflow. */
function checkDrift() {
  let ok = true;
  const readWf = (f) => (existsSync(join(WF, f)) ? readFileSync(join(WF, f), 'utf8') : '');
  const suitesFrom = (text) => {
    const m = text.match(/SUITES="([^"]+)"/);
    return m ? m[1].trim().split(/\s+/) : null;
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

  const core = suitesFrom(readWf('core-tests.yml'));
  if (!same(core, CORE_DB_SUITES)) {
    ok = false;
    log(`${c.red}drift:${c.off} core-tests.yml SUITES != CORE_DB_SUITES`);
    log(`  workflow: ${core ? core.join(' ') : '(unreadable)'}`);
    log(`  here    : ${CORE_DB_SUITES.join(' ')}`);
  }
  const money = suitesFrom(readWf('money-tests.yml'));
  if (!same(money, MONEY_SUITES)) {
    ok = false;
    log(`${c.red}drift:${c.off} money-tests.yml SUITES != MONEY_SUITES`);
    log(`  workflow: ${money ? money.join(' ') : '(unreadable)'}`);
    log(`  here    : ${MONEY_SUITES.join(' ')}`);
  }
  // A suite file that exists but no list names is the "built, tested,
  // unreachable" shape applied to the gates themselves — that is how
  // browser-bff-session sat in neither workflow, and erasure stayed red unseen.
  const known = new Set([...CORE_DB_SUITES, ...CORE_NODB_SUITES, ...MONEY_SUITES]);
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  const stranded = readdirSync(join(SERVER, 'tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => f.replace(/\.test\.mjs$/, ''))
    .filter((n) => !known.has(n) && !pkg.includes(n));
  if (stranded.length) {
    // Reported, deliberately not failed: these predate this runner, and turning
    // them on wholesale inside a drift check would conflate "the lists agree"
    // with "every test passes". Each needs looking at on its own.
    log(`${c.yellow}stranded:${c.off} ${stranded.length} server test(s) are in NO workflow suite AND NO package.json script:`);
    log(`  ${stranded.join(', ')}`);
    log(`${c.dim}  Nothing runs these. Some touch the money path. Triage them, or delete them —${c.off}`);
    log(`${c.dim}  a test that never runs is not coverage, it is the appearance of coverage.${c.off}`);
  }
  record('workflow parity (suite lists match the YAML)', ok);
  return ok;
}

// ── Postgres ────────────────────────────────────────────────────────────────
function dockerOk() {
  try { execFileSync('docker', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function startPg() {
  spawnSync('docker', ['rm', '-f', PG.container], { stdio: 'ignore' });
  const up = spawnSync('docker', [
    'run', '-d', '--name', PG.container,
    '-e', `POSTGRES_PASSWORD=${PG.password}`, '-e', 'POSTGRES_USER=postgres',
    '-p', `127.0.0.1:${PG.port}:5432`, PG.image,
  ], { stdio: 'pipe', encoding: 'utf8' });
  if (up.status !== 0) throw new Error(`could not start postgres: ${up.stderr}`);
  for (let i = 0; i < 60; i += 1) {
    const r = spawnSync('docker', ['exec', PG.container, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' });
    if (r.status === 0) return;
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep',
      process.platform === 'win32' ? ['/t', '1', '/nobreak'] : ['1'], { stdio: 'ignore' });
  }
  throw new Error('postgres did not become ready');
}

const stopPg = () => spawnSync('docker', ['rm', '-f', PG.container], { stdio: 'ignore' });

function freshDb(name) {
  for (const sql of [`DROP DATABASE IF EXISTS ${name}`, `CREATE DATABASE ${name}`]) {
    spawnSync('docker', ['exec', PG.container, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', sql], { stdio: 'ignore' });
  }
  return `postgresql://postgres:${PG.password}@127.0.0.1:${PG.port}/${name}`;
}

function runDbSuites(label, suites, dbPrefix) {
  let allOk = true;
  for (const t of suites) {
    const url = freshDb(`${dbPrefix}${t.replace(/-/g, '_')}`);
    const { code, out } = run('node', [join('tests', `${t}.test.mjs`)], { cwd: SERVER, env: { DATABASE_URL: url }, quiet: true });
    if (code !== 0) {
      allOk = false;
      log(`${c.red}--- ${t} ---${c.off}`);
      log(out.split('\n').slice(-25).join('\n'));
    }
    record(`${label}: ${t}`, code === 0);
  }
  return allOk;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  rule();
  log(`${c.dim}ci:local — the gates CI would run, run here${c.off}`);
  rule();

  const driftOk = checkDrift();
  if (has('--check-drift')) process.exit(driftOk ? 0 : 1);

  const want = (stage) => !only || only === stage;
  let ok = driftOk;
  let pgUp = false;

  try {
    if (want('gates')) {
      const { code } = run('npm', ['test']);
      record('gates: npm test (the full gate chain)', code === 0);
      ok = ok && code === 0;
    }

    if (want('build')) {
      const { code } = run('npm', ['run', 'build'], { quiet: true });
      // The build is only half the claim — a build that silently emits nothing
      // still exits 0 (gates.yml says exactly this, after a JSX error reached main).
      let bundles = 0;
      const assets = join(ROOT, 'dist', 'assets');
      if (existsSync(assets)) bundles = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).length;
      const built = code === 0 && bundles >= 1;
      record('build: frontend compiles and emits a bundle', built, `${bundles} index bundle(s)`);
      ok = ok && built;
      if (built) {
        // gates.yml runs this after the bundle assertion: it reads the EMITTED stylesheets
        const ring = run('npm', ['run', 'test:focus-self-rendered'], { quiet: true });
        record('build: .focus-self fields render ringless (real browser, built CSS)', ring.code === 0);
        ok = ok && ring.code === 0;
      }
    }

    if (want('core') || want('money')) {
      if (!dockerOk()) {
        record('postgres (docker)', false, 'docker is not available — DB suites cannot run');
        ok = false;
      } else {
        startPg();
        pgUp = true;

        if (want('core')) {
          ok = runDbSuites('core', CORE_DB_SUITES, 'c_') && ok;
          for (const t of CORE_NODB_SUITES) {
            const { code, out } = run('node', [join('tests', `${t}.test.mjs`)],
              { cwd: SERVER, env: { XENO_API_KEY: 'test' }, quiet: true });
            if (code !== 0) log(out.split('\n').slice(-20).join('\n'));
            record(`core (no DB): ${t}`, code === 0);
            ok = ok && code === 0;
          }
        }
        // money-tests.yml requires `xeno_payment_*` database names — a guard in
        // the suites themselves, so the prefix is load-bearing, not cosmetic.
        if (want('money')) ok = runDbSuites('money', MONEY_SUITES, 'xeno_payment_') && ok;
      }
    }
  } finally {
    if (pgUp && !has('--keep-db')) stopPg();
    else if (pgUp) log(`${c.yellow}postgres left running:${c.off} docker rm -f ${PG.container}`);
  }

  rule();
  const failed = results.filter((r) => !r.ok);
  log(`${failed.length === 0 ? c.green : c.red}${results.length - failed.length}/${results.length} gates passed${c.off}`);
  for (const f of failed) log(`  ${c.red}✗${c.off} ${f.name}${f.note ? ` — ${f.note}` : ''}`);
  rule();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ci:local failed to run:', e.message); process.exit(1); });
