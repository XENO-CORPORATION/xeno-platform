/**
 * The frontend build's layer order is a performance CONTRACT, and it is silently
 * losable.
 *
 * Nothing fails when someone moves `COPY src/` above `npm ci`. The image is
 * identical, the site is identical, and every deploy afterwards reinstalls the
 * entire dependency tree because a source file changed. The only symptom is that
 * deploys get slower, which people attribute to the box.
 *
 * ── WHAT THE NUMBERS ACTUALLY ARE (measured 2026-08-16, xeno-platform-001) ──
 *
 *   npm ci ........ 73.1s → 64.2s with the cache mount
 *   npm run build .. 41.1s
 *   full build .... 122s   (a package.json edit invalidates the install layer)
 *   source-only ... ~45s   (install layer cached)
 *   no change ...... 2s    (everything cached)
 *
 * 🔴 The release plan's §7 said "~30 minutes" and used it to justify moving the
 * build to CI *before* any feature work. It is off by roughly 15×. Nobody had
 * re-measured it, and the estimate was steering the roadmap.
 *
 * So this file pins the order, and the plan now carries the method to re-measure
 * rather than a remembered number.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(__dirname, '..', 'Dockerfile.frontend'), 'utf8');

/**
 * 🔴 INSTRUCTIONS ONLY — comments are stripped before any ordering is measured.
 *
 * The first version of this gate could not fail, and the reason is worth more
 * than the gate: this file documents the build in prose, that prose contains the
 * words "npm ci", and `indexOf` found the COMMENT. Every ordering assertion was
 * comparing the position of a sentence about the build against the position of
 * the build.
 *
 * Sixth break-open of this shape in this work, and the second caused by prose
 * containing the token being searched for — the SQL placeholder checker counted
 * commas inside comments the same way. **If a check reads source, it must read
 * the CODE.**
 */
const DF = RAW.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

const at = (needle) => {
  const i = DF.indexOf(needle);
  assert.notEqual(i, -1, `Dockerfile.frontend no longer contains the instruction: ${needle}`);
  return i;
};

test('🔴 dependencies install BEFORE source is copied', () => {
  // The whole point of the split. Reversed, every source edit reinstalls
  // ~1,900 packages and the deploy goes from ~45s to ~120s with no other
  // visible change.
  assert.ok(at('COPY package*.json') < at('npm ci'),
    'package*.json must be copied before npm ci, or nothing is cacheable');
  assert.ok(at('npm ci') < at('COPY src/'),
    'npm ci must run BEFORE COPY src/ — otherwise a source edit reinstalls everything');
  assert.ok(at('COPY src/') < at('npm run build'),
    'and the build must come after the source, obviously');
});

test('the npm download cache survives an invalidated layer', () => {
  // Adding an npm SCRIPT changes package.json, which invalidates the install
  // layer even though no dependency moved. The cache mount makes that re-run
  // re-link from disk instead of re-fetching the registry: 73.1s → 64.2s
  // measured. Modest, because the cost here is extracting files onto a
  // CIFS-backed VM disk rather than downloading them — worth knowing before
  // anyone budgets a bigger win from caching.
  assert.match(RAW, /RUN --mount=type=cache,target=\/root\/\.npm npm ci/,
    'the npm cache mount is gone — an invalidated install layer will re-fetch the registry');
});

test('the runtime image does not carry the toolchain', () => {
  // Multi-stage: nginx serves `dist`, and node never ships. Collapsing this to a
  // single stage would put a full node_modules on the production image.
  assert.match(RAW, /FROM node:[\d.]+-alpine AS builder/);
  assert.match(RAW, /FROM nginx:alpine/);
  assert.match(RAW, /COPY --from=builder \/app\/dist \/usr\/share\/nginx\/html/);
});

test('build args carry no secrets', () => {
  // The comment says it; this makes it checkable. A provider key baked into a
  // frontend bundle is public the moment it is served.
  for (const forbidden of ['API_KEY', 'SECRET_KEY', 'OPENAI', 'ANTHROPIC', 'RESEND', 'PASSWORD=']) {
    const args = [...RAW.matchAll(/^ARG\s+(\w+)/gm)].map((m) => m[1]);
    assert.ok(!args.some((a) => a.includes(forbidden.replace('=', ''))
      && a !== 'VITE_SITE_PASSWORD'),
      `build arg containing ${forbidden} would be baked into the served bundle`);
  }
});
