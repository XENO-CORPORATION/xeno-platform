/**
 * WP6 — Loop D's digest.
 *
 * `forum_subscriptions.predicate` has existed since v0.4 with ZERO rows ever
 * written — the eighth column in this schema modelled ahead of its behaviour.
 * So these lead with reachability, then with the property that decides whether
 * the digest is useful at all: it must be AGGREGATED, not a feed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizePredicate } from '../src/server/services/forumService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVICE = codeOnly(readFileSync(src('services', 'forumService.js'), 'utf8'));
const ROUTES = codeOnly(readFileSync(src('routes', 'forumRoutes.js'), 'utf8'));
const MIG = readFileSync(
  src('database', 'migrations', '20260816130000-forum-predicates.sql'), 'utf8');
const fn = (name) => {
  const s = SERVICE.slice(SERVICE.indexOf(`export async function ${name}`));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
};

test('predicates and the digest are reachable', () => {
  assert.match(ROUTES, /router\.put\(\s*['"]\/predicate['"]/, 'no way to register one.');
  assert.match(ROUTES, /router\.get\(\s*['"]\/digest['"]/, 'no way to read one.');
  assert.match(ROUTES, /svc\.setPredicate/);
  assert.match(ROUTES, /svc\.getDigest/);
});

// ── the predicate is a contract, not a query language ──────────────────────

test('a predicate is normalised, not stored as sent', () => {
  // A predicate that can express anything is a query language, and a query
  // language on a polling endpoint is a way to make the database do arbitrary
  // work on request.
  const p = normalizePredicate({
    space: 'FEEDBACK', tags: ['PRODUCT:Pixel', 'nonsense', 'version:0.5.0'],
    status: 'unanswered', max_per_hour: 4, extra: 'ignored',
  });
  assert.equal(p.space, 'feedback', 'lowercased');
  assert.deepEqual(p.tags, ['product:pixel', 'version:0.5.0'], 'invalid tags dropped');
  assert.equal(p.status, 'unanswered');
  assert.equal(p.extra, undefined, 'unknown fields must not survive');
});

test('max_per_hour is CLAMPED, not merely validated', () => {
  // An agent asking for 10000 an hour is confused or hostile; either way the
  // server should answer the sane version rather than refuse and leave it
  // unsubscribed.
  assert.equal(normalizePredicate({ max_per_hour: 10000 }).max_per_hour, 60);
  assert.equal(normalizePredicate({ max_per_hour: 0 }).max_per_hour, 1);
  assert.equal(normalizePredicate({ max_per_hour: -5 }).max_per_hour, 1);
  assert.equal(normalizePredicate({}).max_per_hour, 4, 'a default, never unlimited');
  assert.equal(normalizePredicate({ max_per_hour: 'lots' }).max_per_hour, 4);
});

test('rubbish in gives a usable predicate, not a crash', () => {
  for (const junk of [null, undefined, 'string', 42, []]) {
    const p = normalizePredicate(junk);
    assert.equal(typeof p.max_per_hour, 'number');
  }
});

test('ONE predicate per subscriber', () => {
  // Three overlapping standing queries would deliver the same thread three
  // times with no way for the agent to notice it had.
  assert.match(MIG, /CREATE UNIQUE INDEX[\s\S]*?ON forum_subscriptions \(user_id\) WHERE predicate IS NOT NULL/,
    'the constraint must be in the database, not in the service.');
  assert.match(fn('setPredicate'), /ON CONFLICT \(user_id\) WHERE predicate IS NOT NULL/,
    'registering twice must REPLACE.');
});

// ── the digest is aggregated, and says why ─────────────────────────────────

test('🔴 the digest is AGGREGATED — sections, not a thread list', () => {
  // An agent handed individual threads summarises them badly and inconsistently
  // — the same thread described differently on two consecutive runs, so a human
  // reading its reports cannot tell a new problem from a re-description.
  const body = fn('getDigest');
  assert.match(body, /sections: \{/, 'the response must be sectioned.');
  for (const section of ['rising', 'waiting', 'shipped']) {
    assert.match(body, new RegExp(`${section}:`), `missing the ${section} section.`);
  }
});

test('rising counts DISTINCT REPORTERS, never replies', () => {
  // §5.2 — breadth of impact, not volume of argument. Reply count rewards the
  // loudest thread; distinct reporters measure how many people it happened to.
  const body = fn('getDigest');
  assert.match(body, /COUNT\(DISTINCT p\.author_id\)/,
    'the count must be of people, not posts.');
  assert.doesNotMatch(body, /COUNT\(p\.id\)|post_count DESC/,
    'reply count must not drive the ranking.');
});

test('the trend is STATED, not left for the agent to subtract', () => {
  // "7 people, up from 2" is a decision; "7 people" is a number. An agent that
  // has to compute the delta will sometimes compute it wrong, and a wrong trend
  // is worse than no trend.
  const body = fn('getDigest');
  assert.match(body, /reporters_before/, 'the prior window must be measured.');
  assert.match(body, /rising: Number\(r\.reporters_now\) > Number\(r\.reporters_before\)/,
    'and the comparison must be made server-side.');
});

test('shipped reads Loop C — so an agent cannot re-report a fixed bug', () => {
  // Without this section an agent re-reports things the team already fixed,
  // which is exactly how a digest destroys its own credibility.
  const body = fn('getDigest');
  assert.match(body, /t\.fixed_at >= \$1/, 'shipped must read fixed_at.');
  assert.match(body, /fixed_in_version/, 'and carry the version.');
  assert.match(body, /t\.fixed_in_version IS NULL/,
    'and the WAITING section must exclude already-fixed threads.');
});

test('the window is clamped', () => {
  // A digest is a "what changed" report; a window wide enough to include
  // everything is just the corpus again.
  assert.match(fn('getDigest'), /30 \* 864e5/, 'an unbounded since= is arbitrary work on request.');
});

// ── the declared appetite is actually enforced ─────────────────────────────

test('max_per_hour is HELD TO, and refusal is loud', () => {
  // The agent declares its appetite and the server holds it to it, or the
  // declared limit is decoration. A silent empty digest would be worse than a
  // 429: the agent learns nothing and polls again immediately, which is the
  // behaviour the limit exists to stop.
  const route = ROUTES.slice(ROUTES.indexOf("router.get('/digest'"));
  const body = route.slice(0, route.indexOf('\n}));'));
  assert.match(body, /3600000 \/ Number\(sub\.predicate\.max_per_hour\)/,
    'the gap must derive from the declared rate.');
  assert.match(body, /status\(429\)/, 'refuse loudly.');
  assert.match(body, /retryAfterSeconds/, 'and say when to come back.');
});
