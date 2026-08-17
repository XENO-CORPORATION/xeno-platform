/**
 * Proves the typechecker is a typechecker.
 *
 * 🔴 For this entire feature branch, `npx tsc --noEmit` reported success while
 * checking NOTHING. TypeScript was not installed in the worktree, so npx
 * fetched a package literally named `tsc` from the registry — it prints
 * "This is not the tsc command you are looking for" and exits 0.
 *
 * Every "typecheck clean" claim made against it was worthless, and it hid a
 * real page-breaking bug: `passwordRules` in AuthContent read `password` ten
 * lines before the useState that declares it, which throws
 * `ReferenceError: Cannot access 'password' before initialization` on every
 * render of the sign-in page. vite strips types without checking them, so the
 * build stayed green over a page that could not render.
 *
 * This gate asserts the compiler is the real one and is actually reading src,
 * because "the check ran" and "the check checked" are different claims and
 * only one of them was ever true here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('the real TypeScript compiler is installed, not a squatter', () => {
  assert.ok(
    existsSync('node_modules/typescript/bin/tsc'),
    'node_modules/typescript is missing — `npx tsc` will resolve to the squatter package and exit 0 over anything',
  );
});

test('typescript is a declared dependency, not an accident of the machine', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const declared = pkg.devDependencies?.typescript || pkg.dependencies?.typescript;
  assert.ok(declared, 'typescript is not in package.json — a clean install would not have it');
});

test('the typecheck script resolves the compiler explicitly', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const cmd = pkg.scripts?.typecheck || '';
  assert.ok(cmd, 'no typecheck script');
  assert.doesNotMatch(
    cmd, /^\s*(npx\s+)?tsc\b/,
    `typecheck is "${cmd}" — a bare tsc can resolve to the squatter package. ` +
    'Point it at node_modules/typescript/bin/tsc.',
  );
});

test('the config actually includes src', () => {
  // A solution-style config (files: [] + references) type-checks zero files and
  // exits 0 — the same failure with a different cause.
  //
  // Parsed RAW. The first version of this stripped block comments first, and
  // the regex ate the `/**/` inside "src/**/*.ts" — turning a valid config
  // into invalid JSON and failing for a reason that had nothing to do with
  // what it was asserting. A glob is not a comment.
  const cfg = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  const include = cfg.include || [];
  assert.ok(
    include.some((g) => String(g).startsWith('src')),
    'tsconfig.json does not include src — tsc would check nothing and pass',
  );
});
