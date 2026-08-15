/**
 * Gates on the forum smoke.
 *
 * A smoke test that cannot fail is worse than none — it converts "unchecked"
 * into "checked and fine". These pin the two properties that make this one
 * able to catch the incident it was written for.
 *
 * ⚠️ Reads the script; never imports it. Importing would run it, which means a
 * `npm test` would start making live HTTP calls to production.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'smoke-forum.mjs'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('🔴 search is checked by RESULT, not just by status', () => {
  // The incident returned a clean 500 and any status check would have caught
  // it. The subtler break — a query that parses and matches nothing — returns
  // 200 with an empty array and looks perfectly healthy. Asserting a known
  // seeded thread is actually FOUND is what covers both.
  assert.match(code, /if \(!hits\.length\) fail\(/,
    'zero hits on a known-good query must be a failure, not a pass.');
  assert.match(code, /body\?\.threads \|\| body\?\.results/,
    'it must read the result set, not just the HTTP code.');
});

test('a 200 carrying success:false is still a failure', () => {
  // This API answers some errors with 200 + {success:false}. A check that only
  // looks at the status code would report those as healthy.
  // ⚠️ Scoped to checkPublic. The first version matched the string anywhere,
  // and the SAME check exists in the search loop — so deleting it from
  // checkPublic left the gate green. Mutation-checking caught it.
  const fn = code.slice(code.indexOf('async function checkPublic'));
  const body = fn.slice(0, fn.indexOf('\nasync function'));
  assert.match(body, /body\?\.success === false/,
    'checkPublic must inspect the envelope, not only the status line.');
});

test('🔴 auth-gated endpoints expect 401 SPECIFICALLY, never merely "not 200"', () => {
  // 401 means mounted and refused; 500 means mounted and broken. Both are
  // "not 200", and a check written as "not 200" would call a broken endpoint
  // healthy. Proven live: pointing the smoke at a non-API path returned 200
  // from the SPA shell for every gated route — the documented false-200 trap.
  assert.match(code, /if \(status === 401\) return pass/, 'the pass condition must be exactly 401.');
  assert.match(code, /if \(status === 500\) return fail\([^)]*BROKEN/,
    '500 must be called out as broken rather than lumped in with "wrong status".');
});

test('it exits non-zero when anything fails', () => {
  // Otherwise it is decoration in a pipeline: green regardless.
  // ⚠️ Scoped to the failures branch. The first version matched process.exit(1)
  // anywhere — and the crash handler at the bottom has one too, so flipping the
  // failure exit to 0 left the gate green. Same shape as the check above:
  // asserting a string exists SOMEWHERE when it must exist in a specific place.
  const tail = code.slice(code.indexOf('if (failures) {'));
  assert.match(tail.slice(0, 160), /process\.exit\(1\)/,
    'the FAILURES branch must exit non-zero — a crash handler elsewhere does not count.');
  assert.match(code, /if \(failures\) \{/, 'and the count must gate the exit.');
});

test('it is READ-ONLY', () => {
  // A smoke test that creates real content to prove it can is a smoke test that
  // pollutes the corpus it is checking.
  assert.doesNotMatch(code, /method: 'POST'|method: 'PUT'|method: 'DELETE'|method: 'PATCH'/,
    'the smoke must never write.');
});

test('the base URL is overridable', () => {
  // So it can run against a local deployment or a staging box, not only
  // production — and so the failure path can be exercised deliberately.
  assert.match(code, /process\.env\.SMOKE_FORUM_BASE_URL/);
});
