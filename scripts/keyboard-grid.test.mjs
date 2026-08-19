/**
 * The card grids are ONE tab stop with arrow-key navigation.
 *
 * Without a roving tabindex, crossing the role step costs eight Tab presses
 * and the workspace step four — a cost a keyboard user pays on every visit
 * while a pointer user pays nothing. The fix is invisible to a mouse, so
 * nothing about the page reports when it regresses.
 *
 * The rule most likely to be "simplified" away is the one that matters most:
 * arrows MOVE but must not SELECT. Choosing a role advances the step, so
 * selecting-on-arrow would fire the flow forward on the first keypress and the
 * user would never see the other options.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (f) => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const hook = strip('src/components/onboarding/useRovingGrid.ts');
const page = strip('src/pages/Onboarding.tsx');
const chooser = strip('src/components/onboarding/WorkspaceChooser.tsx');

test('the parse found the hook — this gate can fail', () => {
  assert.match(hook, /export function useRovingGrid/, 'hook is gone; the matcher is stale');
});

test('all four arrows, Home and End are handled', () => {
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.ok(hook.includes(`'${k}'`), `${k} is not handled`);
  }
});

test('arrows move but do NOT select', () => {
  // onChoose may appear only under Enter/Space. If an arrow branch calls it,
  // the flow advances while someone is still looking around.
  const arrowSection = hook.slice(hook.indexOf("'ArrowRight'"), hook.indexOf("case 'Enter'"));
  assert.doesNotMatch(
    arrowSection, /onChoose\(/,
    'an arrow branch calls onChoose — arrowing would advance the step before the ' +
    'user has seen the other options',
  );
  const enterSection = hook.slice(hook.indexOf("case 'Enter'"));
  assert.match(enterSection, /onChoose\(active\)/, 'Enter does not choose the active item');
});

test('exactly one item is tabbable', () => {
  assert.match(
    hook, /tabIndex: i === active \? 0 : -1/,
    'the grid is not a single tab stop — every card would be its own Tab press',
  );
});

test('the column count is measured, not hardcoded', () => {
  // Up/Down move by a row, and the grid is 4/2/1 columns by breakpoint.
  // Restating those numbers in JS is a second source that drifts from the CSS.
  assert.match(hook, /offsetTop/, 'columns are not derived from the rendered layout');
  assert.doesNotMatch(hook, /(cols|columns)\s*=\s*4\b/, 'the column count is hardcoded');
});

test('both grids use it, and are labelled for a screen reader', () => {
  assert.match(page, /role="radiogroup"/, 'the role grid is not a radiogroup');
  assert.match(page, /roleGrid\.onKeyDown/, 'the role grid is not wired to the hook');
  // Suites are independently selectable, so `group` — not radiogroup.
  assert.match(chooser, /role="group"/, 'the suite grid has no group role');
  assert.match(chooser, /suiteGrid\.onKeyDown/, 'the suite grid is not wired to the hook');
  for (const src of [page, chooser]) assert.match(src, /aria-label="/, 'a grid has no accessible name');
});
