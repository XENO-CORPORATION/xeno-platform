/**
 * WP5 — "what have I taken part in".
 *
 * The tempting query is "threads I authored". It is the easy one and the wrong
 * one: the question you helped somebody else with was never yours, so a list of
 * what you STARTED can never contain it — and that is usually the one you are
 * trying to find again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVICE = codeOnly(readFileSync(src('services', 'forumService.js'), 'utf8'));
const ROUTES = codeOnly(readFileSync(src('routes', 'forumRoutes.js'), 'utf8'));
const fn = () => {
  const s = SERVICE.slice(SERVICE.indexOf('export async function listMyActivity'));
  return s.slice(0, s.indexOf('\nexport ') === -1 ? s.length : s.indexOf('\nexport '));
};

test('it is reachable', () => {
  assert.match(ROUTES, /router\.get\(\s*['"]\/me\/activity['"]/, 'no GET /me/activity.');
  assert.match(ROUTES, /svc\.listMyActivity/, 'the route must call the service.');
});

test('it includes threads you ANSWERED, not only ones you started', () => {
  const body = fn();
  assert.match(body, /t\.author_id = \$1/, 'threads you authored.');
  assert.match(body, /EXISTS \(SELECT 1 FROM forum_posts p/,
    'threads you posted in. Without this the list can never contain the question '
    + 'you helped someone else with — usually the one you are looking for.');
});

test('your own question does not count as "answered"', () => {
  // position 1 IS the thread body. Counting it would mark every thread you
  // asked as one you also answered.
  const body = fn();
  const replyChecks = body.match(/p\.position > 1/g) || [];
  assert.ok(replyChecks.length >= 2,
    'both the EXISTS and the reply count must exclude position 1.');
});

test('DELETED content does not resurface in your own history', () => {
  // A tombstone you can still find in your own list is a delete that did not
  // take. Both the thread filter and the post filter have to exclude it.
  const body = fn();
  assert.match(body, /t\.status NOT IN \('archived', 'deleted'\)/,
    'deleted threads must not appear.');
  const visible = body.match(/p\.status = 'visible'/g) || [];
  assert.ok(visible.length >= 2,
    'a reply you deleted must not keep pulling a thread into your history.');
});

test('each row says WHY it is in your list', () => {
  // Same explain-yourself rule the Feed follows (D11). "You asked this" and
  // "you answered this" are different memories; flattening them makes the list
  // harder to scan, not simpler.
  const body = fn();
  assert.match(body, /mine: r\.authored \? 'asked' : 'answered'/,
    'the row must distinguish asked from answered.');
});

test('the list is bounded', () => {
  assert.match(fn(), /LIMIT \$2/, 'an unbounded history query is a slow page waiting to happen.');
  assert.match(fn(), /Math\.min\(100/, 'and the caller must not be able to raise it freely.');
});

// ── the UI half ────────────────────────────────────────────────────────────

const page = (p) => codeOnly(readFileSync(join(__dirname, '..', 'src', p), 'utf8'));
const FORUM = page('pages/Forum.tsx');
const SHELL = page('components/forum/ForumShell.tsx');
const CLIENT = page('components/forum/api.ts');

test('the page can actually fetch your activity', () => {
  assert.match(CLIENT, /getMyActivity\s*=/, 'api.ts must expose it.');
  assert.match(FORUM, /api\.getMyActivity\(/, 'Forum.tsx must call it.');
});

test('"Yours" only exists when there IS a you', () => {
  // A tab that leads to a list which cannot exist for a signed-out reader is a
  // promise the surface cannot keep.
  assert.match(SHELL, /signedIn && \(\s*<NavItem icon=\{User\} label="Yours"/,
    'the rail item must be gated on being signed in.');
  assert.match(FORUM, /\.\.\.\(signedIn \? \[\['mine', 'Yours', User\]\] : \[\]\)/,
    'the segmented control must be gated too — two different controls, one rule.');
});

test('it is fetched on SELECTION, not on mount', () => {
  // Most visits never open it, and a history query is the most expensive read
  // in the product.
  const eff = FORUM.slice(FORUM.indexOf("if (surface !== 'mine'"));
  assert.match(eff.slice(0, 200), /if \(surface !== 'mine' \|\| !signedIn\) return;/,
    'the effect must bail unless the surface is selected and there is a viewer.');
});

test('each row shows whether you asked or answered', () => {
  assert.match(FORUM, /t\.mine === 'asked'/,
    'the list must distinguish the two — they are different memories.');
  assert.match(FORUM, /You asked this/);
  assert.match(FORUM, /You answered this/);
});

test('the empty state is honest', () => {
  assert.match(FORUM, /Nothing yet\. Threads you ask or answer show up here\./,
    'say what will fill it, not "no results".');
});
