/**
 * WP1 — the notification bell.
 *
 * ⚠️ HONEST SCOPE: these are SOURCE gates, not behavioural ones. The component
 * is .tsx and `node --test` cannot import it (this repo has no TS transform for
 * the test runner and no DOM test setup), so nothing here proves the bell
 * renders. What they DO pin is the set of decisions that are cheap to reverse
 * by accident and expensive to notice: reachability, the design-system colour
 * rule, the polling guard, and the signed-out case.
 *
 * Do not let this file grow into a pretend render test. If real render coverage
 * is wanted, that is a vitest + jsdom setup, and it should be added as such.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const comp = (f) => readFileSync(join(__dirname, '..', 'src', 'components', 'forum', f), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BELL = codeOnly(comp('NotificationBell.tsx'));
const HEADER = codeOnly(comp('ForumHeader.tsx'));
const API = codeOnly(comp('api.ts'));

// ── 1. reachability — the defect this repo keeps shipping ──────────────────

test('the header actually RENDERS the bell, not merely imports it', () => {
  assert.match(HEADER, /import NotificationBell from '\.\/NotificationBell'/,
    'ForumHeader must import the bell.');
  assert.match(HEADER, /<NotificationBell\s*\/>/,
    'ForumHeader imports NotificationBell but never renders it. An unused import '
    + 'compiles, ships, and notifies nobody — which is exactly how xeno-workflow '
    + 'shipped 76 node types that were registered nowhere.');
});

test('the client can reach the endpoints the server exposes', () => {
  assert.match(API, /getNotifications\s*=/, 'api.ts must expose getNotifications.');
  assert.match(API, /markNotificationsRead\s*=/, 'api.ts must expose markNotificationsRead.');
  assert.match(BELL, /api\.getNotifications\(/, 'the bell must actually call it.');
  assert.match(BELL, /api\.markNotificationsRead\(/, 'the bell must be able to clear the badge.');
});

// ── 2. the design-system rule, which is the easiest thing here to get wrong ─

test('the unread badge is MONOCHROMATIC — never red, rose or amber', () => {
  // DESIGN_SYSTEM.md: "Additional colors (green, red, amber) appear ONLY in
  // semantic/status contexts (success, error, warning) — never for brand or
  // interactive styling."
  //
  // "You have three answers" is not an error. Every consumer app paints this
  // red because red wins attention auctions, which is the exact instinct
  // SPEC §5.4 exists to refuse.
  const forbidden = /\b(bg|text|border)-(red|rose|orange|amber|yellow)-\d{2,3}\b/;
  const m = BELL.match(forbidden);
  assert.equal(m, null,
    `the bell uses "${m?.[0]}". DESIGN_SYSTEM.md reserves red/amber for semantic `
    + 'status. An unread count is not a fault condition — use the monochromatic accent.');
  assert.match(BELL, /bg-white/, 'the badge should use the monochromatic white accent.');
});

// ── 3. cost and restraint ──────────────────────────────────────────────────

test('polling stops when the tab is not visible', () => {
  assert.match(BELL, /visibilityState/,
    'a hidden tab that polls forever is a cost with no reader on the other end.');
  assert.match(BELL, /visibilitychange/,
    'the tab becoming visible again should refresh, not wait out the interval.');
});

test('the count is capped rather than shown in full', () => {
  assert.match(BELL, /9\+/,
    'the difference between 12 and 40 unread changes nothing about what you do '
    + 'next; a large number is a guilt mechanic, not information.');
});

test('the full list is fetched on OPEN, not on every poll', () => {
  // The interval must ask for the count only. Pulling 30 rows every minute for
  // a panel nobody opened is the same mistake in a different place.
  const openPanel = BELL.slice(BELL.indexOf('const openPanel'));
  assert.match(openPanel.slice(0, 400), /api\.getNotifications\(\)/,
    'openPanel should request the full list.');
  const refresh = BELL.slice(BELL.indexOf('const refreshCount'));
  assert.match(refresh.slice(0, 300), /getNotifications\(true\)/,
    'the polling path must request unread-only, not the whole list.');
});

// ── 4. the signed-out case, and keyboard escape ────────────────────────────

test('signed out renders NOTHING — not a bell that bounces you to /auth', () => {
  assert.match(BELL, /if \(!signedIn\) return null;/,
    'a control that cannot do its job should not be drawn.');
});

test('the panel can be closed by keyboard', () => {
  assert.match(BELL, /e\.key === 'Escape'/,
    'Escape is the only way out for someone who opened this by keyboard.');
  assert.match(BELL, /aria-expanded/, 'the trigger must report its state.');
});

test('the bell reports its unread count to assistive tech', () => {
  // The badge is a visual channel only; a screen reader gets nothing from a
  // styled span.
  assert.match(BELL, /aria-label=\{unread \?/,
    'aria-label must carry the count, not just say "Notifications".');
});
