/**
 * WP12 — the platform half of the in-app report client.
 *
 * The keybinding and the dialog are per-app. The payload shape, the dedup check
 * and the tagging live here once, because twelve hand-rolled dialogs mean twelve
 * payload shapes and Loop D cannot aggregate across inconsistent fields.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WRITE = codeOnly(readFileSync(src('services', 'forumWrite.js'), 'utf8'));
const ROUTES = codeOnly(readFileSync(src('routes', 'forumRoutes.js'), 'utf8'));
const fn = (name) => {
  const s = WRITE.slice(WRITE.indexOf(`export async function ${name}`));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
};

test('both endpoints are reachable', () => {
  assert.match(ROUTES, /router\.post\(\s*['"]\/report\/preflight['"]/, 'no preflight route.');
  assert.match(ROUTES, /router\.post\(\s*['"]\/report['"]/, 'no submit route.');
  assert.match(ROUTES, /write\.reportPreflight/);
  assert.match(ROUTES, /write\.submitReport/);
});

test('🔴 preflight does NOT use findDuplicates', () => {
  // findDuplicates filters to `isResolved || postCount > 1`. That is right for a
  // QUESTION — "show me threads that already have an answer" — and exactly wrong
  // for a REPORT: the most common duplicate of a bug report is a recent,
  // UNANSWERED report of the same bug (postCount 1, unresolved), which is
  // precisely what that filter drops.
  //
  // Verified against production: a freshly inserted report reports
  // visible_to_findDuplicates = false. Every FIRST report of a bug would be
  // invisible to the dedup check, so the second reporter always creates a
  // duplicate — the landfill this endpoint exists to prevent.
  const body = fn('reportPreflight');
  assert.doesNotMatch(body, /findDuplicates\(/,
    'preflight must not reuse the question-shaped dedup helper.');
  assert.match(body, /searchThreads\(/, 'it must search directly.');
});

test('preflight is read-only', () => {
  // "Just check" must be possible without a side effect, which is why this is a
  // separate call from submit rather than a flag on it.
  const body = fn('reportPreflight');
  assert.doesNotMatch(body, /INSERT INTO|createThread\(|createPost\(/,
    'the preflight must never create anything.');
});

test('same-product candidates come first', () => {
  // "3 people reported this in Pixel" is actionable; the same words about a
  // different product usually are not. A client showing five results would
  // otherwise bury the relevant one.
  assert.match(fn('reportPreflight'), /sameProduct === true/,
    'candidates must be ordered by product match.');
});

test('a title too short to search returns nothing rather than everything', () => {
  assert.match(fn('reportPreflight'), /text\.length < 8/,
    'a two-character title would match half the corpus.');
});

// ── the structure is the whole point ───────────────────────────────────────

test('context becomes TAGS, not prose', () => {
  // A hand-typed post has no version, no OS, no build id, so the best Loop D can
  // say is "users are unhappy". Tags are what the ranker scores, what
  // subscriptions match, and what an aggregate groups by — a version buried in a
  // paragraph is invisible to all three.
  const body = fn('submitReport');
  assert.match(body, /`product:\$\{prod\}`/, 'product must become a tag.');
  assert.match(body, /`version:\$\{ver\}`/, 'and so must version.');
  assert.match(body, /'kind:bug'/, 'reports are typed.');
});

test('the product is required and validated', () => {
  const body = fn('submitReport');
  assert.match(body, /product_required/, 'an untagged report cannot be aggregated by anything.');
  assert.match(body, /REPORT_PRODUCTS\.test\(prod\)/, 'and it must be a slug, not free text.');
});

test('JOINING adds a post rather than creating a fourth copy', () => {
  // This single behaviour is what turns "lots of complaints" into "seven
  // distinct people, up from two" — the count the ranker scores and Loop D
  // aggregates. A join is a POST, not a vote, because the second person's
  // detail is usually what makes a report actionable.
  const body = fn('submitReport');
  assert.match(body, /if \(joinShortId\) \{/, 'joining must be a real branch.');
  assert.match(body, /createPost\(db, user,/, 'a join is a reply.');
  assert.match(body, /joined: true/, 'and the caller must be told which happened.');
});

test('the machine-written environment block is separated from the reporter words', () => {
  // A reader should be able to tell which sentences are the person's.
  assert.match(fn('submitReport'), /Reported from the app/,
    'the appended block must be labelled.');
});

test('the server does NOT pretend to redact', () => {
  // Redaction happens in the CLIENT, before send — the only place the raw logs
  // exist and the only place the user can be shown what is about to leave their
  // machine. A server-side scrub arrives after the secret crossed the wire, and
  // shipping one here would let a client skip its own.
  const body = fn('submitReport');
  assert.doesNotMatch(body, /redact|scrub|sanitiz/i,
    'no server-side redaction — it would be theatre and would excuse the client '
    + 'from doing the real thing.');
});
