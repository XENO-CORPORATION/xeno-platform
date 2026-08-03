/**
 * suite-coverage.test.mjs — every test suite in this directory must be wired to a gate.
 *
 * WHY THIS EXISTS
 * Five suites were found sitting in src/server/tests/ with NOTHING running them —
 * including the only test of the shared-token service ledger that xeno-agents-api bills
 * through, the regression gate for a batch of prior money defects, and the virgin-DB
 * boot assertion. A suite nobody runs is worse than no suite: it looks like coverage in
 * review, it rots silently, and the defect it was written to catch comes back unnoticed.
 *
 * Adding suites to the gates one-by-one fixes today and not tomorrow. This test fixes
 * the class: add a new file to tests/ and CI goes red until you either wire it to a
 * gate or declare — in writing, in the allowlist below — why it is not gated.
 *
 * The three gates:
 *   • tests/run-all.js                  — `npm test` in src/server (offline + live smoke)
 *   • .github/workflows/core-tests.yml  — auth / authz / privacy, fresh Postgres per suite
 *   • .github/workflows/money-tests.yml — ledger / billing / metering, fresh Postgres per suite
 *
 * Hermetic: reads files only. Run: node tests/suite-coverage.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = path.join(REPO_ROOT, '.github', 'workflows');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); }
};

/**
 * Suites deliberately NOT wired to a CI gate. Every entry needs a reason that says why
 * a gate would be WRONG — "it's slow" or "it's flaky" is not a reason, it is a bug.
 * Keep this list as close to empty as possible.
 */
const UNGATED = {
  'credit-mirror-drift.test.mjs':
    'OPERATIONAL PROBE, not a unit suite: it asserts a property of the DATA in a live '
    + 'database (users.credits mirror == credit_accounts.balance), so it has no meaning '
    + 'in a fresh-DB CI job. Against an empty CI database it reports "checked 0 accounts" '
    + 'and passes vacuously; against a money suite\'s own database it FAILS by design, '
    + 'because ledger-audit-fixes.test.mjs deliberately poisons the mirror '
    + '(UPDATE users SET credits = 999999) to prove the mirror is not the decision input. '
    + 'Its correct home is a scheduled/post-deploy run against the production database: '
    + '  MIRROR_DRIFT_MIN_ACCOUNTS=1 DATABASE_URL=<prod> node tests/credit-mirror-drift.test.mjs '
    + 'Wiring that up needs a production DB credential in CI, which is an operator '
    + 'decision, not a code change. The MIRROR_DRIFT_MIN_ACCOUNTS floor exists so that '
    + 'run can never silently degrade into checking nothing.',
};

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const suites = fs
  .readdirSync(__dirname)
  .filter((f) => /\.test\.(mjs|js)$/.test(f))
  .sort();

const runAllSrc = read(path.join(__dirname, 'run-all.js'));
const coreSrc = read(path.join(WORKFLOWS, 'core-tests.yml'));
const moneySrc = read(path.join(WORKFLOWS, 'money-tests.yml'));

/**
 * Collect the suites a workflow actually RUNS. Deliberately parses only real
 * invocations — a `SUITES="a b c"` list and `node tests/<x>.test.<ext>` commands — and
 * never free prose, so mentioning a suite in a YAML comment (e.g. explaining why it is
 * excluded) cannot make it look gated.
 */
function workflowSuites(src) {
  const found = new Set();
  for (const m of src.matchAll(/SUITES\s*=\s*"([^"]*)"/g)) {
    for (const s of m[1].split(/\s+/)) if (s) found.add(s);
  }
  for (const m of src.matchAll(/node\s+"?tests\/([A-Za-z0-9._-]+?)\.test\.(?:mjs|js)"?/g)) {
    found.add(m[1]);
  }
  return found;
}

const gatedByWorkflow = new Set([
  ...workflowSuites(coreSrc),
  ...workflowSuites(moneySrc),
]);

console.log('\nSuite coverage — every tests/*.test.* file must be wired to a gate\n');

ok(suites.length > 0, `found ${suites.length} suites in src/server/tests/`);
ok(runAllSrc.length > 0, 'tests/run-all.js is readable');
ok(coreSrc.length > 0, '.github/workflows/core-tests.yml is readable');
ok(moneySrc.length > 0, '.github/workflows/money-tests.yml is readable');

for (const suite of suites) {
  // The workflows name suites by bare stem in a SUITES="..." list ("ledger-v2"), and
  // sometimes by filename in a direct `node tests/x.test.mjs` step. Accept either.
  const stem = suite.replace(/\.test\.(mjs|js)$/, '');
  const inRunAll = runAllSrc.includes(`'${suite}'`) || runAllSrc.includes(`"${suite}"`);
  const inWorkflow = gatedByWorkflow.has(stem);
  const gates = [inRunAll && 'run-all', inWorkflow && 'workflow'].filter(Boolean);

  if (Object.prototype.hasOwnProperty.call(UNGATED, suite)) {
    // A declared exception must be a REAL exception — if it later gets gated, the
    // stale allowlist entry has to be removed rather than quietly kept.
    ok(
      gates.length === 0,
      `${suite} — declared ungated and genuinely not in any gate (remove it from UNGATED if you wire it up)`,
    );
    console.log(`      reason: ${UNGATED[suite].slice(0, 110)}…`);
    continue;
  }

  ok(
    gates.length > 0,
    `${suite} — wired to a gate${gates.length ? ` [${gates.join(', ')}]` : ' [ORPHAN: nothing runs this suite. Add it to run-all.js or a workflow, or declare it in UNGATED with a reason]'}`,
  );
}

// Nothing may sit in the allowlist that no longer exists — a stale exemption is how a
// deleted-and-recreated suite sneaks back in ungated.
for (const declared of Object.keys(UNGATED)) {
  ok(suites.includes(declared), `UNGATED entry ${declared} refers to a suite that exists`);
}

// The specific suites this gate was created over. Named explicitly so that removing
// them from a workflow is a loud failure, not a silent regression to "gated by nothing".
const MUST_BE_IN_A_WORKFLOW = [
  'service-ledger', // the ONLY test of the shared-token surface xeno-agents-api bills through
  'ledger-audit-fixes', // regression gate for a batch of prior money defects
  'fresh-db-boot', // virgin-DB boot + schema assertion
];
for (const stem of MUST_BE_IN_A_WORKFLOW) {
  ok(gatedByWorkflow.has(stem), `${stem} is run by a CI workflow`);
}
ok(
  runAllSrc.includes("'remote-status.test.js'"),
  'remote-status.test.js is listed in run-all.js',
);

console.log(`\n${'='.repeat(60)}`);
console.log(`suite-coverage: ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(60)}\n`);

process.exit(fail > 0 ? 1 : 0);
