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

test('Space selects and Enter advances — they are not the same key', () => {
  // With both bound to select there is no key left to move forward, and a
  // multi-select grid becomes uncompletable from the keyboard.
  const spaceCase = hook.slice(hook.indexOf("case ' ':"), hook.indexOf("case 'Enter':"));
  assert.ok(spaceCase.includes('onChoose(active)'), 'Space does not select');
  assert.ok(!spaceCase.includes('onEnter'), 'Space advances the step as well as selecting');

  const enterCase = hook.slice(hook.indexOf("case 'Enter':"));
  assert.ok(enterCase.includes('onEnter()'), 'Enter does not advance');
  assert.ok(!enterCase.includes('onChoose('), 'Enter selects as well as advancing');

  // Both are <button>s: without preventDefault the native click fires too, so
  // Space would toggle twice (appearing to do nothing) and Enter would select
  // on its way out of the step.
  assert.ok(spaceCase.includes('preventDefault'), 'Space does not stop the native click');
  assert.ok(enterCase.includes('preventDefault'), 'Enter does not stop the native click');
});

test('arrows move but do NOT select', () => {
  // onChoose may appear only under Enter/Space. If an arrow branch calls it,
  // the flow advances while someone is still looking around.
  /* Ends at the SPACE case, not at Enter.
   *
   * It used to end at Enter, and when Space gained its own branch — which
   * legitimately calls onChoose — that branch fell inside the slice and the
   * test failed on correct code. A boundary defined by "the next thing that
   * exists today" breaks the moment something is inserted before it. */
  const arrowSection = hook.slice(hook.indexOf("'ArrowRight'"), hook.indexOf("case ' ':"));
  assert.doesNotMatch(
    arrowSection, /onChoose\(/,
    'an arrow branch calls onChoose — arrowing would advance the step before the ' +
    'user has seen the other options',
  );
  // Selection now lives on Space; asserted in its own test above.
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

test('a first arrow press claims the grid without a Tab', () => {
  // Without this, pressing Right does nothing until you have tabbed in — the
  // feature looks broken before it has been used, on a step whose entire
  // content IS the grid.
  assert.match(hook, /window\.addEventListener\('keydown'/, 'no window-level arrow listener');
  assert.match(
    hook, /containerRef\.current\.contains\(el\)/,
    'the listener cannot tell whether focus is already inside the grid — it would ' +
    'move twice on every press once focus is in there',
  );
  // Arrows inside a field move the caret; inside a select they change the value.
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.ok(hook.includes(`'${tag}'`), `the window listener steals arrows from <${tag.toLowerCase()}>`);
  }
});

test('ArrowDown reaches the everything bar, and focusing it shows the burst', () => {
  // The bar sits directly under the cards and is the fifth thing you reach by
  // looking down. A keyboard user who cannot get to it without tabbing OUT of
  // the grid is being told the two choices are unrelated, when the whole
  // screen argues they are the same question.
  assert.match(chooser, /SUITES\.length \+ 1/, 'the bar is not part of the roving grid');
  assert.match(chooser, /const BAR_INDEX/, 'the bar has no index in the grid');
  assert.match(chooser, /itemProps\(BAR_INDEX\)/, 'the bar does not take roving props');

  // Three owners on that node; each fails silently if a spread overwrites it.
  assert.match(chooser, /barRef\.current = el;/, 'the composed ref lost the particle origin');
  assert.match(chooser, /itemProps\(BAR_INDEX\)\.ref\(el\)/, 'the composed ref lost the roving handle');
  /* Extract the onFocus BODY by slicing, not by matching near it.
   *
   * The first version used a proximity regex and its own mutation check
   * passed when it should have failed: `onPointerEnter` sits a few lines away
   * and also calls setBarHover(true), so the pattern matched the NEIGHBOUR.
   * A gate that adjacent code can satisfy is not a gate.
   *
   * Sliced rather than re-matched because the replacement regex then had to
   * span newlines, and every attempt at escaping that in tooling mangled it.
   * indexOf cannot be escaped wrongly. */
  const fStart = chooser.indexOf('onFocus={() => {');
  assert.ok(fStart !== -1, 'the bar has no multi-statement onFocus');
  const focusBody = chooser.slice(fStart, chooser.indexOf('}}', fStart));
  assert.ok(
    focusBody.includes('setBarHover(true)'),
    'focusing the bar does not raise the burst — arrowing onto it would show nothing',
  );
  assert.ok(focusBody.includes('onEverythingHover?.(true)'), 'focusing the bar does not drop the nav');
});

test('the key handler sits where it can see the bar', () => {
  // On the GRID it would never see a keypress made while the bar had focus,
  // so ArrowUp out of the bar would do nothing.
  assert.match(
    chooser, /className="relative" \{\.\.\.suiteGrid\.containerProps\}/,
    'the roving handler is not on the wrapper that contains both the grid AND the bar',
  );
});

test('both grids use it, and are labelled for a screen reader', () => {
  /* `group`, NOT `radiogroup`.
   *
   * Roles became multi-select — people are more than one thing. A radiogroup
   * announces "one of eight" and a screen-reader user would stop after the
   * first, having been told the rest are alternatives. The items must carry
   * aria-pressed to match. */
  assert.match(page, /role="group"/, 'the role grid is not a group');
  assert.doesNotMatch(page, /role="radiogroup"/, 'the role grid still claims one-of-many');
  assert.match(page, /roleGrid\.containerProps/, 'the role grid is not wired to the hook');
  // Suites are independently selectable, so `group` — not radiogroup.
  assert.match(chooser, /role="group"/, 'the suite grid has no group role');
  assert.match(chooser, /suiteGrid\.containerProps/, 'the suite grid is not wired to the hook');
  assert.match(chooser, /ref=\{gridRef\}/, 'the grid lost the particle-clip rect');
  for (const src of [page, chooser]) assert.match(src, /aria-label="/, 'a grid has no accessible name');

  // Both grids are multi-select, so both must announce their items as toggles.
  const role = readFileSync('src/components/onboarding/RoleCard.tsx', 'utf8');
  assert.match(role, /aria-pressed=\{selected\}/, 'role cards do not announce as toggles');
  assert.doesNotMatch(role, /role="radio"/, 'role cards still claim one-of-many');
});
