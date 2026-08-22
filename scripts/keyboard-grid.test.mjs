/**
 * A STEP is one tab stop, and everything on it is reachable with the arrows.
 *
 * Not just the cards - Back and Continue too. Someone who has just chosen with
 * the keyboard should be able to finish with the keyboard, rather than being
 * told the last two controls need a Tab.
 *
 * None of this is visible to a pointer, so nothing about the page reports when
 * it regresses.
 *
 * WARNING: this gate was rewritten once, and why is worth keeping. Its first
 * version asserted MECHANISMS - roleGrid.containerProps, itemProps(BAR_INDEX),
 * SUITES.length + 1. When the hook moved to finding its items in the DOM,
 * every one of those broke while the behaviour they were protecting got
 * strictly better. That is the same failure as the extension gate that pinned
 * externalUrl === undefined: the mechanism was the bug.
 *
 * So these assert what a keyboard user can DO. An item joins by carrying
 * data-roving, and the tests below name the items that must.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(f, 'utf8');
const strip = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const F = {
  hook: 'src/components/onboarding/useRovingGrid.ts',
  page: 'src/pages/Onboarding.tsx',
  chooser: 'src/components/onboarding/WorkspaceChooser.tsx',
  role: 'src/components/onboarding/RoleCard.tsx',
  pieces: 'src/components/onboarding/OnboardingPieces.tsx',
};
const hook = strip(F.hook);
const page = strip(F.page);
const chooser = strip(F.chooser);

test('the parse found the hook - this gate can fail', () => {
  assert.match(hook, /export function useRovingGrid/, 'hook is gone; the matcher is stale');
});

/* The point of the rewrite: the reachable SET is the outcome. Every control a
 * user has to operate to get through a step is named here, and each is checked
 * on the element that actually renders it. */
test('every control on a step joins the arrow navigation', () => {
  const items = [
    ['a role card', F.role],
    ['a suite card', F.chooser],
    ['the everything bar', F.chooser],
    ['Continue', F.pieces],
    ['Back', F.pieces],
    ['the plan action', F.pieces],
  ];
  for (const [what, file] of items) {
    assert.ok(strip(file).includes('data-roving'), what + ' cannot be reached with the arrows');
  }
  // Two distinct items live in each of these files; one tag would satisfy a
  // naive includes() for both rows above.
  assert.ok(
    (strip(F.chooser).match(/data-roving/g) || []).length >= 2,
    'only one of the suite card / everything bar is reachable',
  );
  assert.ok(
    (strip(F.pieces).match(/data-roving/g) || []).length >= 3,
    'Back, Continue and the plan action are not all reachable',
  );
});

test('the grid is mounted where it can see Back and Continue', () => {
  /* THE bug this whole change fixes. The grid used to sit on the card row,
   * and Back/Continue are SIBLINGS of that row - so no handler on it could
   * ever see them, and no amount of tagging would have helped.
   *
   * Sliced to the step wrapper's own attribute list rather than matched
   * nearby: "inside this element's opening tag" is exact, where proximity
   * would happily match the next element down. */
  const open = page.indexOf('key={t.rendered}');
  assert.ok(open !== -1, 'the step wrapper is gone; this matcher is stale');
  const attrs = page.slice(open, page.indexOf('>', open));
  assert.match(
    attrs, /containerProps/,
    'the grid is not on the step wrapper - whatever it is on, Back and Continue ' +
    'are outside it and unreachable by arrow',
  );

  // One grid per step, not one per question - two would fight over the arrows.
  assert.equal(
    (page.match(/containerProps/g) || []).length, 1,
    'more than one grid is mounted on a step',
  );
});

test('Space activates whatever is focused; Enter continues', () => {
  // Space has to reach Continue as an ACTIVATION, or a user who arrows onto it
  // is stuck looking at a button that will not press.
  const spaceCase = hook.slice(hook.indexOf("case ' ':"), hook.indexOf("case 'Enter':"));
  assert.match(spaceCase, /\.click\(\)/, 'Space does not activate the focused item');
  assert.ok(!spaceCase.includes('onEnter'), 'Space advances the step as well as activating');

  const enterCase = hook.slice(hook.indexOf("case 'Enter':"));
  assert.match(enterCase, /onEnter\(\)/, 'Enter does not advance from a choice');

  /* Both are buttons, so Space fires a native click on keyUP. Without
   * preventDefault the item activates TWICE - which on a toggle looks like
   * nothing happened at all. */
  assert.match(spaceCase, /preventDefault/, 'Space does not stop the native click');
  assert.match(enterCase, /preventDefault/, 'Enter does not stop the native click');
});

test('Enter activates a navigation control instead of continuing past it', () => {
  /* "Enter always continues" sets a trap: arrow onto Back, press Enter, and
   * the flow moves FORWARD. Pressing Enter on a focused button activating that
   * button is about as strong an expectation as the keyboard has, and no
   * on-screen legend overrides it.
   *
   * On Continue the two rules agree, which is exactly why the trap was easy to
   * miss - it only bites on Back and on Select plan. */
  const enterCase = hook.slice(hook.indexOf("case 'Enter':"));
  assert.match(
    enterCase, /dataset\.roving === 'action'/,
    'Enter does not distinguish a choice from a navigation control - Enter on Back goes forward',
  );
  assert.match(enterCase, /\.click\(\)/, 'Enter never activates the control it is sitting on');

  // The three controls that must be actions, checked where they are rendered.
  const pieces = strip(F.pieces);
  assert.equal(
    (pieces.match(/data-roving="action"/g) || []).length, 3,
    'Back, Continue and the plan action are not all declared as actions',
  );
  // ...and the two that must NOT be, or Enter would stop continuing from a card.
  assert.doesNotMatch(strip(F.role), /data-roving="action"/, 'a role card is declared an action');
  assert.doesNotMatch(strip(F.chooser), /data-roving="action"/, 'a suite card or the bar is declared an action');
});

test('arrows move but do NOT activate', () => {
  /* Some roving items ADVANCE THE STEP now - Continue is one of them. Select-
   * on-arrow would fire the flow forward on the first keypress, before the
   * user had seen anything. The ARIA pattern allows manual selection for
   * exactly this reason.
   *
   * Ends at the Space case, not at Enter: Space legitimately clicks, and a
   * boundary set at "the next thing that exists today" breaks the moment
   * something is inserted before it. */
  const arrows = hook.slice(hook.indexOf("'ArrowRight'"), hook.indexOf("case ' ':"));
  assert.doesNotMatch(arrows, /\.click\(\)/, 'an arrow branch activates the item it lands on');
  assert.doesNotMatch(arrows, /onEnter/, 'an arrow branch advances the step');
});

test('a disabled control is not a place the highlight can rest', () => {
  // Continue is disabled until something is chosen. Arrowing onto a dead
  // control and pressing Space reads as the keys being broken.
  assert.match(hook, /disabled/, 'disabled items are not skipped');
});

test('exactly one item is tabbable', () => {
  assert.match(
    hook, /tabIndex = n === i \? 0 : -1/,
    'the step is not a single tab stop - every card would be its own Tab press',
  );
});

test('the item list is re-read, not captured once', () => {
  /* The set CHANGES inside a step: Continue enables the moment something is
   * chosen. A list captured on mount would leave it untabbable, or leave a
   * stale element as the entry point. */
  assert.match(hook, /querySelectorAll/, 'items are not discovered from the DOM');
  assert.doesNotMatch(hook, /count:\s*number/, 'the hook is back to being told how many items exist');
});

test('the column count is measured, not hardcoded', () => {
  // Up/Down move by a row, and the grid is 4/2/1 columns by breakpoint.
  // Restating those numbers in JS is a second source that drifts from the CSS.
  assert.match(hook, /offsetTop/, 'columns are not derived from the rendered layout');
  assert.doesNotMatch(hook, /(cols|columns)\s*=\s*4\b/, 'the column count is hardcoded');
});

test('the highlight resets when the step changes', () => {
  /* One grid serves every step. Arrive at a 7-item step holding index 9 and
   * the clamp drops you onto Continue - the step opens with the highlight
   * past all of its content. */
  assert.match(hook, /setActive\(0\);\s*\}, \[resetKey\]/, 'the highlight is not reset per step');
  assert.match(page, /useRovingGrid\([\s\S]{0,220}step,\s*\)/, 'the page passes no reset key');
});

test('a first arrow press claims the step without a Tab', () => {
  assert.match(hook, /window\.addEventListener\('keydown'/, 'no window-level arrow listener');
  assert.match(
    hook, /containerRef\.current\.contains\(el\)/,
    'the listener cannot tell whether focus is already inside - it would move twice per press',
  );
  // Arrows inside a field move the caret; inside a select they change the value.
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.ok(hook.includes("'" + tag + "'"), 'the window listener steals arrows from ' + tag);
  }
});

test('every arrow-reachable control shows focus', () => {
  /* A real bug, found by this change and now pinned.
   *
   * .focus-self opts OUT of the global :focus-visible ring, and its own rule
   * in index.css says to use it ONLY on something that paints its own focus
   * state. Continue and Back carried it while painting hover and nothing else,
   * so keyboard focus on the primary action of the whole flow was invisible.
   * That was survivable while they were Tab-only afterthoughts. It is not now
   * that arrows land on them.
   *
   * Inputs are the one legitimate carrier: they DO paint their own focus, and
   * the ring sits 2px outside the field where it reads as a stray stroke. */
  for (const f of [F.role, F.chooser, F.page]) {
    assert.doesNotMatch(
      strip(f), /focus-self/,
      f + ' puts .focus-self on a control the arrows can reach - focus would be invisible there',
    );
  }
  const pieces = strip(F.pieces);
  assert.equal(
    (pieces.match(/focus-self/g) || []).length, 1,
    'focus-self is on something other than the input recipe - the only element that paints its own focus',
  );
  assert.match(pieces, /focus-self w-full rounded-\[9px\] border/, 'the one focus-self is not the input recipe');
});

test('the grids are labelled, and announce as multi-select', () => {
  /* group, NOT radiogroup. Both questions are multi-select - people are more
   * than one thing. A radiogroup announces "one of eight" and a screen reader
   * user would stop after the first, having been told the rest are
   * alternatives. */
  assert.match(page, /role="group"/, 'the role grid is not a group');
  assert.doesNotMatch(page, /role="radiogroup"/, 'the role grid still claims one-of-many');
  assert.match(chooser, /role="group"/, 'the suite grid has no group role');
  assert.match(chooser, /ref=\{gridRef\}/, 'the grid lost the particle-clip rect');
  for (const src of [page, chooser]) assert.match(src, /aria-label="/, 'a grid has no accessible name');

  const role = read(F.role);
  assert.match(role, /aria-pressed=\{selected\}/, 'role cards do not announce as toggles');
  assert.doesNotMatch(role, /role="radio"/, 'role cards still claim one-of-many');
});

test('focusing the everything bar still raises the burst', () => {
  /* Focus mirrors hover, or the bar lights up for a mouse and stays dead for
   * the keyboard - the one route that just gained a way to reach it.
   *
   * Sliced, not matched nearby: an earlier version used a proximity regex and
   * its own mutation check PASSED when it should have failed, because
   * onPointerEnter sits a few lines away and also calls setBarHover(true). A
   * gate that adjacent code can satisfy is not a gate. */
  const fStart = chooser.indexOf('onFocus={() => {');
  assert.ok(fStart !== -1, 'the bar has no onFocus');
  const body = chooser.slice(fStart, chooser.indexOf('}}', fStart));
  assert.match(body, /setBarHover\(true\)/, 'focusing the bar shows nothing');
  assert.match(body, /onEverythingHover\?\.\(true\)/, 'focusing the bar does not drop the nav');
  // The particle burst reads this element's rect; a spread that overwrote the
  // ref used to be the hazard, and the node is down to one owner now.
  assert.match(chooser, /ref=\{barRef\}/, 'the bar lost the particle-burst origin');
});
