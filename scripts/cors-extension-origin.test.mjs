#!/usr/bin/env node
/*
 * cors-extension-origin.test.mjs — the browser extension must be able to sign in,
 * and an unlisted origin must not be told the server broke.
 *
 * WHY THIS EXISTS. xeno-extension's sign-in failed with "Internal server error".
 * Nothing was broken: the CORS origin callback was called with an Error
 * (`callback(new Error(...), false)`), which makes cors invoke `next(err)`, which
 * reaches Express's error handler and answers 500 {"error":"Internal server
 * error"}. So a POLICY decision — "your origin is not on the list" — was reported
 * to the caller as our fault. Reproduced with curl: identical request, 200 with no
 * Origin header and 500 with `Origin: chrome-extension://<id>`.
 *
 * Two invariants are pinned here because they fail in opposite directions:
 *   · the allowlist must be able to include an extension (or sign-in is impossible)
 *   · a denial must stay a denial (or every unlisted origin gets a fake 500)
 *
 * Run: node --test scripts/cors-extension-origin.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'src/server/index.js'), 'utf8');

/* hosts.js reads process.env INSIDE each function, not at module scope, so the
 * variable must still be set when the function is CALLED. An earlier version of
 * this helper restored the environment before returning and every case saw an
 * empty list — which looked like a bug in extensionOrigins() and was a bug here. */
const { extensionOrigins } = await import('../src/server/config/hosts.js');

function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'XENO_EXTENSION_ORIGINS');
  const prev = process.env.XENO_EXTENSION_ORIGINS;
  if (value === undefined) delete process.env.XENO_EXTENSION_ORIGINS;
  else process.env.XENO_EXTENSION_ORIGINS = value;
  try { return fn(); } finally {
    if (had) process.env.XENO_EXTENSION_ORIGINS = prev;
    else delete process.env.XENO_EXTENSION_ORIGINS;
  }
}

test('extensionOrigins is EMPTY by default — nothing is allowlisted implicitly', () => {
  assert.deepEqual(withEnv(undefined, () => extensionOrigins()), []);
  assert.deepEqual(withEnv('', () => extensionOrigins()), []);
});

test('extensionOrigins parses a comma list, so a dev id and the store id coexist', () => {
  const list = withEnv(
    'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh, chrome-extension://iiiijjjjkkkkllllmmmmnnnnoooopppp',
    () => extensionOrigins(),
  );
  assert.deepEqual(list, [
    'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh',
    'chrome-extension://iiiijjjjkkkkllllmmmmnnnnoooopppp',
  ]);
});

test('a wildcard cannot become a match-all — the check is exact-match', () => {
  // An operator may reasonably try `chrome-extension://*`. It must NOT work:
  // matching is `ALLOWED_ORIGINS.includes(origin)`, so the wildcard is only ever
  // equal to itself and no real extension is admitted. Fail-closed by construction.
  const list = withEnv('chrome-extension://*', () => extensionOrigins());
  assert.ok(!list.includes('chrome-extension://afnbnfbmpmfloeecamljmpknjeobimpj'),
    'a wildcard must not admit an arbitrary extension');
  assert.ok(list.every((o) => !o.includes('*') || o === 'chrome-extension://*'),
    'the wildcard is carried as a literal, never expanded');
});

/* ── The denial must not masquerade as a server fault ────────────────────── */

test('the CORS origin callback never constructs an Error', () => {
  // Source-level because the callback is inline in index.js and importing that
  // module starts a server. The invariant is one line and worth pinning: passing
  // an Error here is what produced the 500 the extension saw.
  const cors = INDEX.slice(INDEX.indexOf('app.use(cors('), INDEX.indexOf('app.use(cookieParser())'));
  assert.ok(cors.length > 200, 'failed to locate the cors block — fix this test, not the assert');
  assert.ok(!/callback\(\s*new Error/.test(cors),
    'callback(new Error(...)) makes cors call next(err) → Express 500. Use callback(null, false).');
  assert.ok(/callback\(null,\s*false\)/.test(cors),
    'an unlisted origin must be denied explicitly, not merely not-allowed');
});

test('extension origins survive an operator setting CORS_ORIGINS', () => {
  // CORS_ORIGINS replaces the SITE list. If extension origins were inside that
  // ternary, narrowing the site list would silently un-authorise the extension
  // and break sign-in as a side effect of an unrelated change.
  const block = INDEX.slice(INDEX.indexOf('const ALLOWED_ORIGINS'), INDEX.indexOf('app.use(cors('));
  assert.ok(/\.\.\.extensionOrigins\(\),/.test(block), 'extensionOrigins() must be appended');
  const ternaryEnd = block.indexOf(']),');
  assert.ok(block.indexOf('...extensionOrigins()') > ternaryEnd,
    'extensionOrigins() must sit OUTSIDE the CORS_ORIGINS ternary');
});
