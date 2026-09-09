/**
 * A test suite nobody runs is not coverage — it is a file.
 *
 * Written after finding 56 passing tests across four suites that `npm test`
 * could not reach. Three of them were orphaned by a RENAME: the script entry
 * still said `scripts/watch-not-use.test.mjs` after the file had become
 * `pricing.test.mjs`, so the chain died at that step and everything after it —
 * including the entitlement-enforcement suite, the one that proves the paywall
 * actually refuses — never executed. The other two were simply never wired.
 *
 * The two halves fail DIFFERENTLY, and only one of them is quiet:
 *
 *   - A DEAD REFERENCE is loud. `node --test <missing>` prints "Could not
 *     find" and exits 1, so `npm test` goes red. But it goes red at the step
 *     that broke — here step 38 of 45 — and the `&&` chain stops there, so the
 *     four suites behind it never run. The signal is real and it reads as "one
 *     script name is stale", not as "your entitlement gates are not executing".
 *     That is why it survived: the fix looks like a one-line typo and the cost
 *     is four dark suites.
 *   - AN ORPHAN is genuinely invisible. Nothing errors, nothing is skipped,
 *     no report has a line for it, and the chain stays green. You cannot
 *     notice the absence of output you were never going to see.
 *
 * Both are the shape this workspace keeps re-discovering under a different
 * name: built, tested, unreachable. The unit tests are correct; nothing
 * connects them to the thing that runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* The `test` script is a `&&` chain of `npm run <name>` steps. Resolve one
 * level deep only: a step names a script, that script names files. Deeper
 * nesting does not occur here and pretending to follow it would be a worse
 * lie than not trying. */
const chainSteps = () =>
  pkg.scripts.test
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^npm run /, ''));

const filesNamedBy = (scriptBody) =>
  [...(scriptBody || '').matchAll(/scripts\/[\w.-]+\.mjs/g)].map((m) => m[0]);

test('every step in the test chain names a script that exists', () => {
  const missing = chainSteps().filter((name) => !pkg.scripts[name]);
  assert.deepEqual(
    missing,
    [],
    `npm test calls scripts that are not defined: ${missing.join(', ')}`,
  );
});

test('every file the chain points at is on disk — a rename cannot sever it', () => {
  const dead = [];
  for (const name of chainSteps()) {
    for (const rel of filesNamedBy(pkg.scripts[name])) {
      if (!fs.existsSync(path.join(ROOT, rel))) dead.push(`${name} -> ${rel}`);
    }
  }
  /* This is the exact failure that hid the pricing and entitlement suites:
   * the reference survived the rename, so the step existed, resolved to
   * nothing, and took every later step down with it. */
  assert.deepEqual(dead, [], `dead file references in npm test: ${dead.join(', ')}`);
});

test('no *.test.mjs is ORPHANED — on disk but unreachable from npm test', () => {
  const reached = new Set();
  for (const name of chainSteps()) {
    for (const rel of filesNamedBy(pkg.scripts[name])) {
      reached.add(path.basename(rel));
    }
  }

  const onDisk = fs
    .readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => f.endsWith('.test.mjs'));

  const orphans = onDisk.filter((f) => !reached.has(f));

  /* Deliberately a hard failure with no allowlist.
   *
   * An allowlist is how this rots: the first genuinely-not-ready suite gets
   * added with a comment, and within a month it is where suites go to be
   * forgotten — which is the state this gate exists to end. A suite that
   * should not run yet belongs behind an env guard INSIDE itself, where its
   * skip is visible in the run output, not absent from it. */
  assert.deepEqual(
    orphans,
    [],
    `test suites exist that npm test never runs: ${orphans.join(', ')}. ` +
      `Wire each into the "test" chain, or delete it — a suite nobody runs is not coverage.`,
  );
});

test('no src/server/tests suite is ORPHANED — reachable from no runner at all', () => {
  /* The gate above only ever looked at scripts/. Measured on 2026-09-09, EIGHT
   * suites under src/server/tests were reachable from nothing — not the local
   * qualifier, not a workflow, not an npm script: credit-mirror-drift,
   * dpop-token-exchange, fresh-db-boot, hosts, ledger-audit-fixes,
   * oidc-authority-policy, register-oidc-client and service-ledger. Two of the
   * three ledger suites and the DPoP sender-constraint exchange are in that
   * list, so "money and auth are covered" was true of the files and false of
   * every runner.
   *
   * Three runners exist and a suite need only be named by one:
   *   - the npm test chain (no database available),
   *   - scripts/qualify-platform-local.mjs --backend-only (a real Postgres),
   *   - a GitHub workflow.
   * The qualifier's list is read as TEXT, never imported: importing that file
   * starts Docker containers, so running it is the side effect. */
  const qualifier = fs.readFileSync(path.join(ROOT, 'scripts/qualify-platform-local.mjs'), 'utf8');
  const declared = qualifier.match(/const BACKEND_SUITES = \[([\s\S]*?)\];/);
  assert.ok(declared, 'BACKEND_SUITES is no longer declared where this gate reads it');
  const named = new Set([...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const workflowDir = path.join(ROOT, '.github/workflows');
  const workflows = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).map((f) => fs.readFileSync(path.join(workflowDir, f), 'utf8')).join(' ')
    : '';
  const chain = Object.values(pkg.scripts).join(' ');

  const orphans = fs
    .readdirSync(path.join(ROOT, 'src/server/tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => f.replace(/\.test\.mjs$/, ''))
    .filter((suite) => !named.has(suite)
      && !workflows.includes(`${suite}.test.mjs`) && !workflows.includes(`"${suite} `)
      && !workflows.includes(` ${suite} `) && !workflows.includes(` ${suite}"`)
      && !chain.includes(`${suite}.test.mjs`));

  assert.deepEqual(
    orphans,
    [],
    `backend suites no runner executes: ${orphans.join(', ')}. Name each in ` +
      `BACKEND_SUITES, a workflow, or the npm chain — a suite nobody runs is not coverage.`,
  );
});

test('the chain has not silently shrunk', () => {
  /* A floor, not an equality. Equality would fail on every legitimate
   * addition and teach people to edit the number without reading why.
   * A floor only fires when steps DISAPPEAR, which is the accident. */
  const FLOOR = 40;
  const n = chainSteps().length;
  assert.ok(
    n >= FLOOR,
    `npm test runs ${n} steps, expected at least ${FLOOR}. ` +
      `If steps were removed on purpose, lower the floor in the same commit and say why.`,
  );
});
