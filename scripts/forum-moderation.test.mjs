/**
 * WP3 — flag review.
 *
 * `forum_flags` carried status / resolved_by / resolved_at / resolution — the
 * ENTIRE review workflow, modelled — while `raiseFlag` INSERTed into it and
 * nothing in the application could read a flag or resolve one. "Report" was a
 * button whose report went into a table with no reader.
 *
 * Seventh instance of that shape in this codebase, so these lead with
 * reachability and with the thing that makes a queue real: an outcome.
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

test('a flag can finally be READ and RESOLVED over HTTP', () => {
  assert.match(ROUTES, /router\.get\(\s*['"]\/flags['"]/,
    'no GET /flags — reports keep going into a table nothing reads.');
  assert.match(ROUTES, /router\.post\(\s*['"]\/flags\/:id\/resolve['"]/, 'no resolve route.');
  assert.match(ROUTES, /write\.listFlags/);
  assert.match(ROUTES, /write\.resolveFlag/);
});

test('🔴 "actioned" HIDES the content — a status-only queue is theatre', () => {
  // If upholding a report does not remove what was reported, the reporter sees
  // their report marked handled while the thing is still on the page. That is
  // worse than no queue: it teaches people reporting is pointless AND tells
  // them so officially.
  const body = fn('resolveFlag');
  assert.match(body, /UPDATE forum_posts SET status = 'hidden'/,
    "upholding a flag on a post must hide it.");
  assert.match(body, /UPDATE forum_threads SET status = 'locked'/,
    'upholding a flag on a thread must lock it.');
});

test("a moderator hiding something is not the author deleting it", () => {
  // 'hidden', never 'deleted'. Both are invisible to readers; only one is the
  // author's own choice, and a public moderation log has to tell them apart.
  const body = fn('resolveFlag');
  assert.doesNotMatch(body, /UPDATE forum_posts SET status = 'deleted'/,
    "moderation must not masquerade as the author retracting their own post.");
});

test('every flag on the same target resolves together', () => {
  // Three people reporting one post is ONE decision. Leaving the other two open
  // shows a reviewer a queue of work that has already been done.
  const body = fn('resolveFlag');
  assert.match(body, /WHERE target_type = \$5 AND target_id = \$6 AND status IN \('open', 'reviewing'\)/,
    'the resolution must apply to the target, not just the one flag id.');
});

test('an already-resolved flag cannot be resolved again', () => {
  const body = fn('resolveFlag');
  assert.match(body, /flag_already_resolved/,
    're-resolving would overwrite who decided and when.');
});

test('reviewing needs the capability, and the action is validated', () => {
  assert.match(fn('listFlags'), /assertCan\(db, user, 'review_flags'\)/,
    'the queue exposes reporters and unpublished content.');
  assert.match(fn('resolveFlag'), /assertCan\(db, user, 'review_flags'\)/);
  assert.match(fn('resolveFlag'), /\['dismiss', 'action'\]\.includes\(action\)/,
    'an unrecognised action must be refused, never treated as a dismiss.');
});

test('reviewers see who reported — readers never will', () => {
  // A flag is an accusation, and an anonymous accusation cannot be weighed: the
  // same person reporting the same author six times is the most useful signal
  // in a moderation queue. The PUBLIC log carries decisions, never reporters.
  const body = fn('listFlags');
  assert.match(body, /reporter_name/, 'the queue must show the reporter.');
  assert.match(body, /reporter_kind/,
    'and their kind — an agent may flag-to-review, never flag-to-remove (§7.2).');
});

test('the queue is bounded and its status filter is validated', () => {
  const body = fn('listFlags');
  assert.match(body, /Math\.min\(200/, 'bounded.');
  assert.match(body, /\['open', 'reviewing', 'actioned', 'dismissed'\]\.includes\(status\)/,
    'an unknown status must fall back, not interpolate into the query.');
});
