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
 * ⚠️ The `proofs` stage has no workflow counterpart, because until it existed
 * NOTHING ran those suites -- not this runner and not CI. It is the one stage
 * here that checks MORE than Actions did, and it is listed as such rather than
 * quietly closing the gap: gates.yml needs a matching job before the two are
 * honestly identical again.
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
 *   node scripts/ci-local.mjs --only=gates    # gates | core | money | build | proofs | cross
 *   node scripts/ci-local.mjs --check-drift   # only verify this matches the workflows
 *   node scripts/ci-local.mjs --keep-db       # leave the container up for debugging
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  'byok-lifecycle-audit', 'gateway-catalogue-sync', 'email-delivery-events', 'suspension-gate', 'chat-branches', 'artifacts',
];
const CORE_NODB_SUITES = ['ai-tools-passthrough', 'entitlement-gate', 'upstream'];
const MONEY_SUITES = [
  'ledger-v2', 'ledger-chain', 'ledger-billing', 'ledger-correctness',
  'billing-money-in', 'media-metering', 'wallet-service',
  'service-ledger', 'ledger-audit-fixes', 'credit-mirror-drift',
  'marketplace-invoke-and-commission', 'hold-extension', 'meter-hold-heartbeat',
  'run-backed-hold', 'marketplace-rentals', 'marketplace-rental-partitions',
];

/* ── DATABASE PROOFS (scripts/*.test.mjs) ────────────────────────────────────
 * 19 suites in the `npm test` chain gate themselves on a fixture URL and SKIP
 * without it. Nothing supplied one -- not this runner, not gates.yml -- so they
 * had never executed in any automated run: the workforce schema, workspace keys,
 * membership operations, live collaboration, webhook delivery and notifications
 * all reported green by reporting nothing.
 *
 * A skipped SQL proof is indistinguishable from a passing one, which is the
 * failure this repository has a name for. They get their own stage rather than
 * a database bolted onto `npm test`, for the reason gates.yml already gives for
 * keeping forum-proofs separate: two stages that each mean one thing tell you
 * more than one stage mixing source checks with a live-system check.
 *
 * The list is DERIVED from the suites themselves, never hand-kept -- a new DB
 * suite is covered the day it is written, without anyone remembering. Each
 * database name is the one the suite ASSERTS; they are not interchangeable (the
 * workforce suites refuse any database but `workforceproof`, so a wrong name
 * here fails loudly instead of running against something else). */
/* `migrated: true` means the suite expects the REAL schema -- it inserts into `users` and
 * `workspaces` directly instead of building its own tables. The rest create an owned
 * schema per run and must be handed an EMPTY database: migrating those would leave the
 * public schema populated underneath them, which is the "passes because a previous suite
 * left rows behind" failure this runner exists to avoid. */
const DB_PROOF_FIXTURES = {
  WORKFORCE_TEST_DATABASE_URL: { database: 'workforceproof', migrated: false },
  WORKSPACE_KEY_TEST_DATABASE_URL: { database: 'workspacekeyproof', migrated: false },
  NOTIFICATION_TEST_DATABASE_URL: { database: 'notificationproof', migrated: false },
  WORKSPACE_AUTH_TEST_DATABASE_URL: { database: 'workspaceproof', migrated: false },
  TEST_DATABASE_URL: { database: 'chatproof', migrated: true },
};

/* The canonical fresh-database sequence, taken from src/server/tests/fresh-db-boot.test.mjs
 * rather than reinvented: versioned SQL first, then the account/ledger v2 migration. */
function migrateDatabase(url) {
  const script = [
    "import pg from 'pg';",
    "import { runAllMigrations } from './src/server/services/migrationRunner.js';",
    "import * as accountV2 from './src/server/database/migrate-account-v2.js';",
    "const pool = new pg.Pool({ connectionString: process.env.MIGRATE_URL });",
    "await runAllMigrations(pool);",
    "await (accountV2.migrateAccountV2 || accountV2.default)(pool);",
    "await pool.end();",
  ].join('\n');
  return run('node', ['--input-type=module', '-e', script], { env: { MIGRATE_URL: url }, quiet: true });
}

/* Suites that need a LIVE SERVICE as well as a database. They are not database proofs and
 * do not belong in this stage: gates.yml already states the reason for keeping that class
 * out -- "a check that needs production to be up is a check that goes red for reasons that
 * have nothing to do with the commit, and a red that means nothing gets ignored."
 *
 * Named individually with what each one waits on, never matched by a pattern: a pattern
 * would quietly swallow the next real DB suite that happened to match it. */
const EXTERNAL_SERVICE_SUITES = {
  'chat-project-semantic-integration.test.mjs': 'XENO_EMBEDDING_BASE_URL (a live embeddings service)',
  'chat-project-semantic-scale-qualification.test.mjs': 'XENO_EMBEDDING_BASE_URL (a live embeddings service)',
};

function deriveDbProofSuites() {
  const found = [];
  for (const file of readdirSync(join(ROOT, 'scripts')).filter((n) => n.endsWith('.test.mjs'))) {
    const body = readFileSync(join(ROOT, 'scripts', file), 'utf8');
    // The FIRST fixture variable a suite reads is the one it runs against.
    const m = body.match(/process\.env\.([A-Z_]*TEST_DATABASE_URL)/);
    if (!m || !DB_PROOF_FIXTURES[m[1]]) continue;
    if (EXTERNAL_SERVICE_SUITES[file]) {
      // Said out loud rather than silently skipped -- the whole point of this stage is that
      // a suite nobody ran cannot look like a suite that passed.
      log(`${c.dim}  not a database proof, excluded: ${file} needs ${EXTERNAL_SERVICE_SUITES[file]}${c.off}`);
      continue;
    }
    found.push({ file, variable: m[1] });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

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
  const known = new Set([...CORE_DB_SUITES, ...CORE_NODB_SUITES, ...MONEY_SUITES, ...CROSS_SERVICE_SUITES]);
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
/* An EXTERNAL Postgres may be supplied as a base URL (no database path):
 *
 *   CI_LOCAL_PG_URL=postgresql://user:pass@127.0.0.1:5432 node scripts/ci-local.mjs
 *
 * Docker is the default and stays the default -- a disposable container is the
 * only way to guarantee a suite is not passing on rows a previous run left
 * behind. But requiring it makes the runner unusable on a machine that already
 * has a Postgres and no Docker daemon, and "the gates cannot run here" is how a
 * gate stops being run at all. In CI this is the hook for a service container,
 * so the workflow and this file execute the SAME code rather than two
 * descriptions of it.
 *
 * Databases are still dropped and recreated per suite either way. */
const EXTERNAL_PG = (process.env.CI_LOCAL_PG_URL || '').replace(/\/+$/, '');

function dockerOk() {
  if (EXTERNAL_PG) return true;
  try { execFileSync('docker', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function startPg() {
  if (EXTERNAL_PG) return; // not ours to start
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

const stopPg = () => { if (!EXTERNAL_PG) spawnSync('docker', ['rm', '-f', PG.container], { stdio: 'ignore' }); };

function freshDb(name) {
  const statements = [`DROP DATABASE IF EXISTS ${name}`, `CREATE DATABASE ${name}`];
  if (EXTERNAL_PG) {
    const admin = new URL(`${EXTERNAL_PG}/postgres`);
    for (const sql of statements) {
      spawnSync('psql', [admin.href, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
        { stdio: 'ignore', env: { ...process.env, PGPASSWORD: decodeURIComponent(admin.password || '') } });
    }
    return `${EXTERNAL_PG}/${name}`;
  }
  for (const sql of statements) {
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

/* CROSS-SERVICE proofs: suites that drive a SIBLING SERVICE for real, not a stand-in.
 *
 * marketplace-broker proves XENO-WORKFORCE-01 MKT-06 by booting the real xeno-agents-api against this
 * platform's real auth and ledger. So it needs a BUILT agents-api. This builds the sibling checkout's
 * origin default branch into a throwaway directory -- never its working tree, which may hold another
 * session's work -- and reuses the sibling's installed node_modules read-only.
 *
 * A skip counts as a failure: the suite skips without AGENTS_API_DIST, and a stage that goes green on a
 * skip is the appearance of coverage. Missing sibling or install => the stage FAILS and says why. */
const CROSS_SERVICE_SUITES = ['marketplace-broker'];

function buildAgentsApi() {
  const sibling = resolve(ROOT, '..', 'xeno-agents-api');
  if (!existsSync(join(sibling, '.git'))) return { error: `no sibling checkout at ${sibling}` };
  if (!existsSync(join(sibling, 'node_modules', 'fastify'))) {
    return { error: `${sibling} has no installed node_modules (run npm ci there)` };
  }
  const dir = mkdtempSync(join(tmpdir(), 'ci-agents-api-'));
  const ref = spawnSync('git', ['-C', sibling, 'rev-parse', '--verify', 'origin/HEAD'], { encoding: 'utf8' }).status === 0
    ? 'origin/HEAD' : 'origin/main';
  const archive = spawnSync('sh', ['-c', `git -C "${sibling}" archive ${ref} | tar -x -C "${dir}"`], { encoding: 'utf8' });
  if (archive.status !== 0) return { error: `git archive failed: ${archive.stderr}` };
  symlinkSync(join(sibling, 'node_modules'), join(dir, 'node_modules'));
  const tsc = spawnSync(process.execPath, [join(sibling, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'],
    { cwd: dir, encoding: 'utf8' });
  if (tsc.status !== 0) return { error: `agents-api build failed:\n${(tsc.stdout + tsc.stderr).slice(-2000)}` };
  spawnSync(process.execPath, ['scripts/copy-assets.mjs'], { cwd: dir, encoding: 'utf8' });
  return { dist: join(dir, 'dist'), ref };
}

function runCrossServiceSuites() {
  const built = buildAgentsApi();
  if (built.error) {
    record('cross-service: build xeno-agents-api', false, built.error);
    return false;
  }
  record('cross-service: build xeno-agents-api', true, built.ref);
  let allOk = true;
  for (const t of CROSS_SERVICE_SUITES) {
    const url = freshDb(`xeno_payment_${t.replace(/-/g, '_')}`);
    const { code, out } = run('node', [join('tests', `${t}.test.mjs`)],
      { cwd: SERVER, env: { DATABASE_URL: url, AGENTS_API_DIST: built.dist }, quiet: true });
    const pass = Number((out.match(/^ℹ pass (\d+)/m) || [])[1] || 0);
    const skipped = Number((out.match(/^ℹ skipped (\d+)/m) || [])[1] || 0);
    const ranOk = code === 0 && pass >= 1 && skipped === 0;
    if (!ranOk) { allOk = false; log(`${c.red}--- ${t} ---${c.off}`); log(out.split('\n').slice(-25).join('\n')); }
    record(`cross-service: ${t}`, ranOk, ranOk ? '' : `exit ${code}, pass ${pass}, skipped ${skipped}`);
  }
  return allOk;
}

/* Run the derived database proofs and assert each one ACTUALLY RAN.
 *
 * The exit code alone is not enough and never was: a suite that skips exits 0.
 * So every suite must report at least one passing test and ZERO skipped ones --
 * the only reading under which "green" means the SQL was exercised. */
function runDbProofs(baseUrl) {
  const suites = deriveDbProofSuites();
  if (!suites.length) {
    // Deriving nothing means the scan broke, not that there is nothing to prove.
    record('proofs: database suites were found to run', false, 'derivation returned no suites');
    return false;
  }
  const created = new Set();
  let allOk = true;
  for (const { file, variable } of suites) {
    const { database, migrated } = DB_PROOF_FIXTURES[variable];
    if (!created.has(database)) {
      const url = freshDb(database);
      if (migrated) {
        const m = migrateDatabase(url);
        if (m.code !== 0) {
          // Without this the suites fail as `relation "users" does not exist`, which reads
          // as a broken test rather than a database that was never prepared.
          record(`proofs: migrate ${database}`, false, 'migrations failed; suites needing it cannot run');
          log(m.out.split(/\r?\n/).slice(-15).join('\n'));
          return false;
        }
      }
      created.add(database);
    }
    const { code, out } = run('node', ['--test', '--test-force-exit', join('scripts', file)],
      { env: { [variable]: baseUrl + '/' + database }, quiet: true });
    const count = (label) => {
      for (const line of out.split(/\r?\n/)) {
        // node --test prints `<info> pass 11`; TAP-style output prints `# pass 11`.
        // Strip whatever symbol leads the line rather than matching it: the reporter's
        // glyph is not a contract, and the counts are.
        const text = line.replace(/^[^A-Za-z]+/, '').trim();
        if (!text.startsWith(label)) continue;
        const rest = text.slice(label.length).trim();
        if (/^[0-9]+$/.test(rest)) return Number(rest);
      }
      return null;
    };
    const passed = count('pass');
    const skipped = count('skipped');
    const ran = code === 0 && passed !== null && passed > 0 && (skipped === null || skipped === 0);
    if (!ran) {
      allOk = false;
      log(c.red + '--- ' + file + ' ---' + c.off);
      log(out.split(/\r?\n/).slice(-25).join('\n'));
    }
    record('proofs: ' + file, ran, passed === null
      ? 'reported no test counts'
      : passed + ' passed' + (skipped ? ', ' + skipped + ' SKIPPED' : ''));
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
        const effort = run('npm', ['run', 'test:effort-menu-rendered'], { quiet: true });
        record('build: the effort menu renders from the chat tokens (real browser, built CSS)', effort.code === 0);
        ok = ok && effort.code === 0;
        const drawer = run('npm', ['run', 'test:mobile-drawer-rendered'], { quiet: true });
        record('build: the phone drawer renders off-canvas with a full-viewport scrim (real browser, built CSS)', drawer.code === 0);
        ok = ok && drawer.code === 0;
        const divider = run('npm', ['run', 'test:transcript-divider-rendered'], { quiet: true });
        record('build: the clock line\'s divider waits for the step it separates (real browser, built CSS)', divider.code === 0);
        ok = ok && divider.code === 0;
      }
    }

    if (want('core') || want('money') || want('proofs') || want('cross')) {
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

        // The `scripts/` database proofs. Same container, their own fixtures --
        // each suite asserts the database it is given, so the names are fixed.
        if (want('proofs')) ok = runDbProofs(EXTERNAL_PG || `postgresql://postgres:${PG.password}@127.0.0.1:${PG.port}`) && ok;

        // Cross-service proofs drive a real sibling service; see CROSS_SERVICE_SUITES.
        if (want('cross')) ok = runCrossServiceSuites() && ok;
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
