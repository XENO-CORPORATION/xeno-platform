/**
 * One expanded sidebar at a time — and EVERY path that opens one must say so.
 *
 * ## The defect this pins, reported from the running site 2026-09-13
 *
 * The platform sidebar expands 52px → 300px. The chat's history sidebar is `position: fixed`,
 * portalled to `document.body`, positioned at `left: isTaskbarHidden ? 0 : TASKBAR_WIDTH_PX` —
 * and `TASKBAR_WIDTH_PX` is 52, the COLLAPSED width. With both expanded the chat panel began
 * 248px inside the platform panel and painted over it.
 *
 * The decision (2026-09-13) is mutual exclusion: opening either collapses the other, so the
 * platform sidebar is always at exactly 52px while the history panel is open — which is what
 * makes that hardcoded 52 correct rather than merely usually correct.
 *
 * ## What this gate actually asserts, and why it is shaped this way
 *
 * 🔴 The COVERAGE SET, not the mechanism. `ChatWithLLM.tsx` has three places that open the
 * history panel — the chrome button, the mobile swipe, the catalog — and announcing from one of
 * them leaves the other two overlapping. A test that merely proves `announceSidebarExpanded` is
 * called somewhere passes in exactly that broken world. This is the same failure this codebase
 * has hit repeatedly: xeno-post's approval gate was called from 2 of 3 paths and the third was
 * the normal one.
 *
 * So: no `setIsHistoryOpen(true)` may exist outside the single announcing helper.
 *
 * Source-only. `ChatWithLLM.tsx` is ~20,000 lines inside a router, a theme provider and a live
 * host; asserting this through a DOM would need the whole shell. The exclusion MODULE is pure,
 * so its behaviour is executed for real below rather than pattern-matched.
 *
 * Mutation-checked 2026-09-13, each failing alone with a green control:
 *   revert one open site to `setIsHistoryOpen(true)`        → test 3 fails
 *   drop the announce from `openHistorySidebar`             → test 2 fails
 *   drop either collapse listener                           → test 4 fails
 *   let the module deliver an announcement to its announcer  → test 6 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const CHAT = read('src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx');
const OVERVIEW = read('src', 'pages', 'Overview.tsx');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('both surfaces consume the one exclusion module', () => {
  for (const [name, src] of [['ChatWithLLM', CHAT], ['Overview', OVERVIEW]]) {
    assert.match(
      src, /from '[^']*lib\/sidebarExclusion'/,
      `${name} must import the shared rule rather than reimplementing it — a rule written twice drifts`,
    );
  }
});

test('the chat announces when it expands', () => {
  const code = stripComments(CHAT);
  assert.match(
    code, /announceSidebarExpanded\('chat'\)/,
    'opening the history panel must claim the expanded slot',
  );
});

test('EVERY history open announces — no direct setIsHistoryOpen(true) escapes', () => {
  const code = stripComments(CHAT);

  // The one legitimate site is inside `openHistorySidebar`, immediately followed by the announce.
  const helper = code.match(/const openHistorySidebar\s*=\s*useCallback\([\s\S]{0,400}?\}\s*,\s*\[\]\)/);
  assert.ok(helper, 'openHistorySidebar must exist as the single announcing open path');
  assert.match(helper[0], /setIsHistoryOpen\(true\)[\s\S]*announceSidebarExpanded\('chat'\)/,
    'the helper must set the state AND announce');

  const outside = code.replace(helper[0], '');
  const escaped = [...outside.matchAll(/setIsHistoryOpen\(true\)/g)];
  assert.equal(
    escaped.length, 0,
    `${escaped.length} history open(s) bypass openHistorySidebar. Each one overlaps the platform ` +
    'sidebar, because only the helper announces. Route them through openHistorySidebar().',
  );
});

test('both surfaces yield the slot when the other expands', () => {
  assert.match(stripComments(CHAT), /onSidebarCollapseRequest\('chat'/,
    'the chat must collapse when the platform sidebar expands');
  assert.match(stripComments(OVERVIEW), /onSidebarCollapseRequest\('platform'/,
    'the platform sidebar must collapse when the chat expands');
});

test('collapsing does not announce — freeing the slot must not force the other open', () => {
  const code = stripComments(OVERVIEW);
  const handler = code.match(/const handleSidebarCollapseChange[\s\S]{0,600}?\n  \};/);
  assert.ok(handler, 'could not bound handleSidebarCollapseChange');
  assert.match(
    handler[0], /if \(!collapsed\) announceSidebarExpanded\('platform'\)/,
    'the platform must announce only when EXPANDING; announcing on collapse would make closing ' +
    'one panel look like it opened the other',
  );
});

test('the module itself never collapses the panel that just opened', async () => {
  // Executed, not grepped: this is the loop that would make a sidebar open and instantly shut.
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (n, h) => listeners.set(n, [...(listeners.get(n) ?? []), h]),
    removeEventListener: (n, h) => listeners.set(n, (listeners.get(n) ?? []).filter((x) => x !== h)),
    dispatchEvent: (e) => { for (const h of listeners.get(e.type) ?? []) h(e); return true; },
  };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

  const { announceSidebarExpanded, onSidebarCollapseRequest } =
    await import('../src/lib/sidebarExclusion.ts');

  let chatCollapsed = 0;
  let platformCollapsed = 0;
  onSidebarCollapseRequest('chat', () => { chatCollapsed += 1; });
  onSidebarCollapseRequest('platform', () => { platformCollapsed += 1; });

  announceSidebarExpanded('chat');
  assert.equal(chatCollapsed, 0, 'the announcer must not be told to collapse itself');
  assert.equal(platformCollapsed, 1, 'the other panel must collapse');

  announceSidebarExpanded('platform');
  assert.equal(platformCollapsed, 1, 'still 1 — the platform announced, so it must not self-collapse');
  assert.equal(chatCollapsed, 1, 'the chat must now collapse');

  delete globalThis.window;
  delete globalThis.CustomEvent;
});

test('the hardcoded 52px inset says why it is safe', () => {
  // The constant is only correct BECAUSE of the exclusion rule. Without that recorded, the next
  // reader sees a magic number and the reason it holds is invisible.
  const decl = CHAT.match(/[\s\S]{0,900}const TASKBAR_WIDTH_PX = 52;/);
  assert.ok(decl, 'TASKBAR_WIDTH_PX must still exist');
  assert.match(decl[0], /300|exclusion/i,
    'the comment on TASKBAR_WIDTH_PX must record that it is the COLLAPSED width and that ' +
    'sidebarExclusion is what guarantees the platform sidebar is at that width');
});
