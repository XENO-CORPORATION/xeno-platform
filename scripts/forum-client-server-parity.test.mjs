/**
 * Every Forum endpoint the UI calls must exist on the server.
 *
 * WHY THIS BOUNDARY IS THE LEAST VERIFIED THING IN THE PRODUCT
 *
 * A page that calls an endpoint which does not exist STILL RENDERS. The fetch
 * 404s, the client's error path swallows it, and the feature is simply absent —
 * no console error a user would report, no failing test, nothing in a log
 * anyone reads. Same shape as the nine unreachable features this plan has
 * already documented, arriving from the client side instead of the server side.
 *
 * Nothing else catches it:
 *   - npm test reads source, and both halves of a mismatch are valid source
 *   - the seven proofs drive SERVICES, never the HTTP surface
 *   - the render check visits two pages signed out, so a typo in the flag or
 *     accept path is invisible to it
 *
 * It does NOT prove an endpoint behaves. It proves the address is real, which
 * is the failure mode that hides.
 *
 * NOTE ON STYLE: this file deliberately avoids regex literals containing quote
 * characters. An earlier version used them and cost three separate parse
 * failures — the delimiter and the pattern were the same character. Quotes in
 * the INPUT are normalised to one kind first instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const srcPath = (...p) => join(HERE, '..', 'src', ...p);

const CLIENT = readFileSync(srcPath('components', 'forum', 'api.ts'), 'utf8');
const ROUTES = readFileSync(srcPath('server', 'routes', 'forumRoutes.js'), 'utf8');

const BACKTICK = String.fromCharCode(96);
const singleQuoted = (s) => s.split(BACKTICK).join("'").split('"').join("'");

/**
 * Reduce a client path and a route pattern to the same shape.
 *
 * Three things have to survive this, and each was a false positive first:
 *   - a simple interpolation, /threads/${shortId}/subscription  -> /threads/*\/subscription
 *   - an express param with a pattern, /:targetType(threads|posts)/:id/flag
 *   - a query built inline, /tags${namespace ? '?namespace=' + n : ''}
 *
 * The last one cannot be parsed as a path at all, so the rule is: substitute
 * simple ${identifier} groups, then TRUNCATE at the first character that cannot
 * appear in a route. A query string is not part of the address being mounted.
 */
function normalize(p) {
  const withParams = p
    .replace(/\$\{\s*\w+\s*\}/g, '*')
    .replace(/:[a-zA-Z]\w*\([^)]*\)/g, '*')
    .replace(/:[a-zA-Z]\w*/g, '*');
  const cut = withParams.search(/[$?\s]/);
  const path = cut === -1 ? withParams : withParams.slice(0, cut);
  return path.replace(/\/+$/, '') || '/';
}

function clientPaths() {
  const flat = singleQuoted(CLIENT);
  const out = new Set();
  for (const m of flat.matchAll(/request<[^>]*>\(\s*'([^']+)'/g)) out.add(normalize(m[1]));
  for (const m of flat.matchAll(/request\(\s*'([^']+)'/g)) out.add(normalize(m[1]));
  return [...out].filter((p) => p.startsWith('/'));
}

function serverPaths() {
  // 🔴 `put` was missing from this list, and its absence reported a REAL route
  // as a missing endpoint: the client's thread mute/watch toggle uses PUT, the
  // server mounts PUT, and the checker said the feature was unreachable.
  //
  // I nearly filed that as a defect. Verifying the claim before reporting it is
  // what caught it — a checker's first finding is a claim about the checker.
  const flat = singleQuoted(ROUTES);
  const out = new Set();
  for (const m of flat.matchAll(/router\.(?:get|post|put|patch|delete|all)\(\s*'([^']+)'/g)) {
    out.add(normalize(m[1]));
  }
  return [...out];
}

test('both extractors actually parse something', () => {
  // If either silently matched nothing, the comparison below would pass by
  // being empty — the exact way a gate breaks open.
  const c = clientPaths();
  const s = serverPaths();
  assert.ok(c.length >= 10, 'too few client paths parsed: ' + c.length);
  assert.ok(s.length >= 20, 'too few server routes parsed: ' + s.length);
});

test('every endpoint the UI calls exists on the server', () => {
  const server = serverPaths();
  const missing = clientPaths().filter((p) => !server.includes(p));
  assert.deepEqual(missing, [],
    'The Forum UI calls these and the server does not mount them. A 404 here does not '
    + 'break the page — the feature is just silently absent, which is why nothing else '
    + 'catches it.');
});

test('the client speaks to /api/forum and nowhere else', () => {
  // A stray absolute URL or a second base would route around the shared auth
  // handling, the 401-means-signed-out rule, and this check.
  const flat = singleQuoted(CLIENT);
  for (const m of flat.matchAll(/fetch\(\s*'([^']*)/g)) {
    const base = m[1];
    assert.ok(base.startsWith('/api/forum') || base === '',
      'the forum client fetches ' + base + ' — every call must go through the /api/forum base');
  }
});

test('reads stay unauthenticated, writes carry a token', () => {
  // SPEC D9: the Record is readable by anyone, including agents. If a read
  // started attaching a token it would 401 for logged-out visitors and the
  // Record would quietly become private.
  assert.match(CLIENT, /export function isSignedIn/);
  assert.match(CLIENT, /Reads are public and unauthenticated/,
    'the read/write auth split must stay documented where the client is edited');
});
