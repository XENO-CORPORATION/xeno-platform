/**
 * The platform sidebar as a phone drawer (2026-09-19): out of the viewport, in on a hold-tap or an
 * edge swipe, out on Back / Escape / the scrim; the chat's history is a full-viewport sheet.
 *
 *   node --test scripts/mobile-drawer.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { swipeDecision, claimsItsOwnPress, HOLD_MS, EDGE_PX, SWIPE_PX } from '../src/components/overview/useMobileDrawer.ts';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('swipe: a right swipe from the left edge opens; the same swipe from mid-screen does not (that is a scroll or a back gesture)', () => {
  assert.equal(swipeDecision({ dx: SWIPE_PX + 10, dy: 8, fromEdge: true, open: false, onDrawer: false }), 'open');
  assert.equal(swipeDecision({ dx: SWIPE_PX + 10, dy: 8, fromEdge: false, open: false, onDrawer: false }), null);
  assert.equal(swipeDecision({ dx: SWIPE_PX - 1, dy: 0, fromEdge: true, open: false, onDrawer: false }), null, 'too short');
  assert.equal(swipeDecision({ dx: 80, dy: 70, fromEdge: true, open: false, onDrawer: false }), null, 'too vertical — a scroll');
});

test('swipe: a left swipe ON the open drawer closes it; on the scrim or when closed it does nothing', () => {
  assert.equal(swipeDecision({ dx: -80, dy: 4, fromEdge: false, open: true, onDrawer: true }), 'close');
  assert.equal(swipeDecision({ dx: -80, dy: 4, fromEdge: false, open: true, onDrawer: false }), null);
  assert.equal(swipeDecision({ dx: -80, dy: 4, fromEdge: false, open: false, onDrawer: false }), null);
});

test('hold: a press on a text field, button, link, editable or slider is theirs — the drawer never claims it', () => {
  // node has no DOM; emulate the one method the rule uses
  globalThis.Element = class {};
  const mk = (matches) => { const e = new Element(); e.closest = () => (matches ? e : null); return e; };
  assert.equal(claimsItsOwnPress(mk(true)), true);
  assert.equal(claimsItsOwnPress(mk(false)), false);
  assert.equal(claimsItsOwnPress(null), true, 'no target = nothing to claim');
  assert.equal(HOLD_MS, 500);
  assert.ok(EDGE_PX >= 20 && EDGE_PX <= 32, 'the edge zone is a thumb-width, not a quarter of the screen');
});

test('reachability: the drawer is wired, the shell slot collapses, and the chat sheet is full-viewport', () => {
  const bar = src('../src/components/overview/OverviewTaskbar.tsx');
  assert.match(bar, /useMobileDrawer\(\{ open: isMobileOpen, onOpen: openDrawer, onClose: closeDrawer, drawerRef \}\)/);
  assert.match(bar, /<aside ref=\{drawerRef\}/);
  assert.match(bar, /data-mobile-drawer=\{isMobileOpen \? 'open' : 'closed'\}/);
  assert.match(bar, /window\.addEventListener\('toggle_overview_taskbar', onToggle\)/, 'the chat\'s XENO mark opens the drawer on a phone — the visible way in');
  const shell = src('../src/pages/Overview.tsx');
  assert.match(shell, /<div data-taskbar-slot style=/, 'the slot is addressable so it can take no width');
  const css = src('../src/components/overview/overview-shell.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 760px) {'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(mobile, /\[data-overview-shell\] > \[data-taskbar-slot\] \{ width: 0; flex: 0 0 0;/);
  assert.match(mobile, /\.xeno-overview-sidebar \{\s*position: fixed; inset: 0 auto 0 0;/);
  assert.match(mobile, /transform: translateX\(-100%\);/, 'closed = fully off-canvas, not a 52px rail');
  assert.match(mobile, /\.is-mobile-open \{ transform: translateX\(0\);/);
  assert.match(mobile, /cubic-bezier\(0\.05, 0\.7, 0\.1, 1\)/, 'in on a decelerate, not linear');
  assert.match(mobile, /\n  \.xeno-mobile-scrim \{ position: fixed; z-index: 59; display: block; inset: 0;/, 'the scrim is a body-level layer covering the whole viewport');
  assert.match(bar, /createPortal\(<button type=\"button\" className=\"xeno-mobile-scrim\"/, 'the scrim is portaled OUT of the transformed drawer');
  assert.doesNotMatch(mobile, /width: 52px; flex-basis: 52px/, 'the old always-visible rail is gone');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.xeno-mobile-scrim,/);
  const chat = src('../src/components/playground/Chat/ChatWithLLM.tsx');
  const sheet = chat.slice(chat.indexOf('data-chat-history-sheet='), chat.indexOf('data-chat-history-sheet=') + 1400);
  assert.match(sheet, /width: '100vw'/);
  assert.match(sheet, /transform: isHistoryOpen \? 'translateX\(0\)' : 'translateX\(-100%\)'/);
  assert.match(sheet, /paddingTop: 'env\(safe-area-inset-top, 0px\)'/);
});
