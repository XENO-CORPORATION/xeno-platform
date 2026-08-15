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
