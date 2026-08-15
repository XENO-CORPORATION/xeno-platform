/**
 * WP3 — the reviewer UI.
 *
 * ⚠️ HONEST SCOPE: source gates. The page is .tsx and `node --test` cannot
 * import it (no TS transform for the runner, no DOM setup), so nothing here
 * proves it renders. What they pin is the set of decisions that are cheap to
 * reverse by accident and expensive to notice — and, in this file's case, three
 * of them are privacy properties rather than styling.
 *
 * ⚠️ Authored as a FILE, not a shell heredoc. A heredoc ate one backslash level
 * earlier in this work and turned a RegExp into a pattern that matched nothing,
 * which reads exactly like a passing gate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = codeOnly(read('pages', 'ForumModeration.tsx'));
const API = codeOnly(read('components', 'forum', 'api.ts'));
const APP = codeOnly(read('App.tsx'));

// ── reachability ───────────────────────────────────────────────────────────

test('the page is ROUTED — not merely written', () => {
  assert.match(APP, /import ForumModeration from '\.\/pages\/ForumModeration'/,
    'App.tsx must import it.');
  assert.match(APP, /<Route path="\/forum\/moderation" element=\{<ForumModeration \/>\} \/>/,
    'a page with no route is a file, not a feature — and this repo has shipped '
    + 'that shape eight times.');
});

test('the client can reach every endpoint the page needs', () => {
  for (const m of ['getFlags', 'resolveFlag', 'getModerationLog']) {
    assert.match(API, new RegExp(`${m}\\s*=`), `api.ts must expose ${m}.`);
    assert.match(PAGE, new RegExp(`api\\.${m}\\(`), `the page must call ${m}.`);
  }
});

// ── the privacy properties, which are the point ────────────────────────────

test('the public log is fetched WITHOUT auth', () => {
  // A log only staff can read is not a public log. The client method must not
  // pass the auth flag, or the page silently becomes staff-only for anyone
  // whose token is missing.
  const line = API.slice(API.indexOf('export const getModerationLog'));
  assert.match(line.slice(0, 160), /request<any>\('\/moderation-log'\)/,
    'getModerationLog must not request with auth.');
});

test('the log is shown to EVERYONE who opens the page, reviewer or not', () => {
  // Decisions and their public record in one glance. A moderator who has to go
  // elsewhere to see what the public sees will not go.
  // ⚠️ This looks BACKWARDS from the call to the enclosing useEffect. The first
  // version sliced FORWARD from `api.getModerationLog()` and therefore could not
  // see a guard inserted BEFORE it — mutation-checking caught the gate green
  // while `if (!canReview) return;` sat one line above the call. A gate that
  // inspects the wrong side of the thing it protects is not a gate.
  const callAt = PAGE.indexOf('api.getModerationLog()');
  assert.ok(callAt > 0, 'the page must fetch the log');
  const effectStart = PAGE.lastIndexOf('useEffect(', callAt);
  const effect = PAGE.slice(effectStart, callAt + 60);
  assert.doesNotMatch(effect, /canReview/,
    'the log fetch must not be gated on the review capability — a log only '
    + 'staff can read is not a public log.');
});

test('the QUEUE is gated on the capability, and the queue only', () => {
  assert.match(PAGE, /const canReview = Boolean\(me\?\.capabilities\?\.review_flags\)/,
    'the capability comes from /me, not from a role guess.');
  const load = PAGE.slice(PAGE.indexOf('const loadQueue'));
  assert.match(load.slice(0, 200), /if \(!canReview\) return;/,
    'a viewer without the capability must not even request the queue.');
});

test('no queue and NO BUTTONS when the viewer cannot review', () => {
  // Not a disabled queue, not one that 403s on click. A control that always
  // fails is worse than an absent one.
  assert.match(PAGE, /: !canReview \? \(/,
    'the page must branch to an explanation rather than render a dead queue.');
});

// ── behaviour that keeps the queue honest ──────────────────────────────────

test('resolving REFETCHES rather than splicing the row out', () => {
  // Every flag on the same target resolves together, so the queue can shrink by
  // more than one. Guessing which rows went is how a queue starts showing work
  // that is already done.
  const fn = PAGE.slice(PAGE.indexOf('const resolve = useCallback'));
  assert.match(fn.slice(0, 700), /loadQueue\(\)/, 'must refetch the queue.');
  assert.doesNotMatch(fn.slice(0, 700), /setFlags\(\(f\) =>|\.filter\(/,
    'do not splice — the server decides what is left.');
});

test('the log refreshes after a decision', () => {
  // Otherwise a moderator upholds something and the public record beside them
  // still shows the old state, which is precisely the accountability the log
  // exists to provide.
  const fn = PAGE.slice(PAGE.indexOf('const resolve = useCallback'));
  assert.match(fn.slice(0, 700), /getModerationLog\(\)/);
});

test('both outcomes are offered, and labelled by what they DO', () => {
  // "Uphold" and "Dismiss" alone do not say that one hides content and the
  // other does not. The consequence belongs on the control.
  assert.match(PAGE, /Uphold — hide it/, 'upholding must say it hides.');
  assert.match(PAGE, /Dismiss/);
  assert.match(PAGE, /Dismissals stay private/,
    'the reviewer should know a dismissal never reaches the public log.');
});
