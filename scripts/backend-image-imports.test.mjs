/**
 * Nothing under src/server may import a file the backend image does not contain.
 *
 * `Dockerfile.backend` copies `src/server/` and nothing else, so a relative
 * import that climbs above that directory resolves fine on a developer machine
 * and is simply ABSENT in the container. The backend then dies at startup on
 * ERR_MODULE_NOT_FOUND — after the build succeeded, after the image was pushed,
 * and only once it is running.
 *
 * A gate for this already existed and it watched exactly one file:
 * scripts/onboarding-funnel.test.mjs asserts that `authRoutes` contains no
 * '../../lib/'. On 2026-09-09 the read-only preview work added that exact
 * import to authRoutes AND to src/server/middleware/previewSession.js. The
 * single-file gate caught the first and was blind to the second — one line away
 * from shipping a backend that could not boot.
 *
 * So this checks every file, and it reads the copied root out of the Dockerfile
 * rather than hardcoding it: if the COPY line changes, the rule follows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'Dockerfile.backend';

/** The directories the backend image actually receives, per its own COPY lines. */
function copiedRoots() {
  const text = fs.readFileSync(path.join(ROOT, DOCKERFILE), 'utf8');
  const roots = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^COPY\s+(?:--[^\s]+\s+)*([^\s]+)\s+[^\s]+\s*$/);
    if (!match) continue;
    const source = match[1];
    if (source.startsWith('--') || source === '.') continue;
    // src/server/package*.json contributes src/server too; a glob's directory is
    // what matters here, not the pattern.
    roots.add(path.posix.normalize(path.posix.dirname(source.replace(/\\/g, '/'))));
  }
  return [...roots];
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(relative));
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]|(?:^|[\s(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

test('the backend image copies src/server, and that is the boundary this gate uses', () => {
  const roots = copiedRoots();
  assert.ok(roots.includes('src/server'),
    `${DOCKERFILE} no longer copies src/server; this gate is reading the wrong rule: ${roots.join(', ')}`);
});

/* The failure this gate exists for is "the container dies at startup", so the
 * rule is about what RUNS in the container. src/server/tests is copied in but
 * never executed there — it runs from the repo, under the qualifier and CI,
 * where scripts/ exists. Rather than allowlist those files, they are held to the
 * other half of the same standard below: their escapes must at least resolve. */
const isRuntime = (file) => !file.startsWith('src/server/tests/');

test('no runtime file under src/server imports a path the image does not contain', () => {
  const escapes = [];
  for (const file of sourceFiles('src/server').filter(isRuntime)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || !specifier.startsWith('.')) continue; // bare = node_modules
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!resolved.startsWith('src/server/')) escapes.push(`${file} -> ${specifier}`);
    }
  }

  /* No allowlist, deliberately. The escape hatch for genuinely shared code is to
   * put the shared file inside src/server (there is already a src/server/lib for
   * exactly this), not to record an exception that the next reader trusts. */
  assert.deepEqual(escapes, [], 'imports that resolve outside the backend image:\n  '
    + escapes.join('\n  ')
    + '\nMove the file into src/server/, or the container will die at startup.');
});

test('backend test files may reach into the repo, but never at a path that does not exist', () => {
  const broken = [];
  for (const file of sourceFiles('src/server').filter((f) => !isRuntime(f))) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || !specifier.startsWith('.')) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (resolved.startsWith('src/server/')) continue;
      if (!fs.existsSync(path.join(ROOT, resolved))) broken.push(`${file} -> ${specifier}`);
    }
  }
  assert.deepEqual(broken, [], `backend test imports that resolve to nothing: ${broken.join(', ')}`);
});
