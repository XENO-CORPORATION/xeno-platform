/**
 * THE REAL-DOM GATE: can a keyboard user actually finish a step?
 *
 * The static gate next door reads source and asserts the right attributes are
 * in the right places. That is worth having and it is not proof: every part of
 * this can be individually correct while nothing is connected — the shape this
 * ecosystem keeps rediscovering (76 workflow nodes registered nowhere, a tools
 * `install` that nothing called, a forum flag nothing could read).
 *
 * So this one mounts the REAL components in a REAL DOM, presses REAL keys, and
 * asserts on focus and on side effects. It builds from scripts/harness, which
 * imports RoleCard / PrimaryButton / TextButton directly.
 *
 * ⚠️ jsdom performs no layout, so every offsetTop is 0 and the hook would see
 * one row of everything. Rows are therefore assigned explicitly after mount —
 * which is honest about what is being tested: Up/Down are checked against a
 * KNOWN geometry, and the fact that the real geometry comes from the browser
 * is the static gate's job (it pins offsetTop as the source).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true, url: 'http://localhost/',
});
const { window } = dom;
/* Node 24 defines `navigator` as a getter-only global, so a plain assignment
 * throws. defineProperty replaces the descriptor outright and works for both
 * the getter-only ones and the ordinary ones. */
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement',
                 'KeyboardEvent', 'Event', 'Node', 'getComputedStyle', 'requestAnimationFrame',
                 'cancelAnimationFrame', 'MutationObserver']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
/* The harness is compiled HERE, every run.
 *
 * A checked-in bundle is a stale-artifact hazard of the worst kind: it would
 * let this gate go green against code that no longer exists, which is strictly
 * worse than having no gate — a green run that verified nothing. Building it
 * in-process means the bundle cannot lag the source it is testing. */
const esbuild = await import('esbuild');
const OUT = 'scripts/harness/.bundle.generated.mjs';
await esbuild.build({
  entryPoints: ['scripts/harness/rovingStep.tsx'],
  bundle: true, format: 'esm', jsx: 'automatic',
  external: ['react', 'react-dom'],
  outfile: OUT, logLevel: 'error',
});
const { Step, log } = await import('../' + OUT);

const root = window.document.getElementById('root');
let reactRoot;

function mount(props = {}) {
  log.length = 0;
  if (reactRoot) act(() => reactRoot.unmount());
  reactRoot = createRoot(root);
  act(() => reactRoot.render(React.createElement(Step, props)));
  layout();
}

/** Four cards on row 0, Back and Continue on row 1. */
function layout() {
  const els = [...root.querySelectorAll('[data-roving]')];
  els.forEach((el, i) => {
    Object.defineProperty(el, 'offsetTop', { value: i < 4 ? 0 : 100, configurable: true });
  });
  return els;
}

const items = () => [...root.querySelectorAll('[data-roving]')];
/* A RoleCard renders its label AND a workspace hint, and textContent
 * concatenates them with no separator — "Card 0WorkspaceYou choose". Comparing
 * that to "Card 0" fails on a working component, which is what the first run
 * of this file did. */
const label = (el) => {
  if (!el) return '(nothing focused)';
  const t = el.textContent.trim();
  const m = /^Card \d+/.exec(t);
  return m ? m[0] : t;
};
const press = (key) => act(() => {
  window.document.activeElement.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
});
/** The window-level claim: a first arrow with focus outside the step. */
const pressFromBody = (key) => act(() => {
  window.document.body.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
});

test('the harness mounted — this gate can fail', () => {
  mount();
  assert.equal(items().length, 6, 'expected 4 cards + Back + Continue to be roving');
  assert.equal(label(items()[4]), 'Back');
  assert.equal(label(items()[5]), 'Continue');
});

test('the step is ONE tab stop', () => {
  mount();
  const tabbable = items().filter((el) => el.tabIndex === 0);
  assert.equal(tabbable.length, 1, 'more than one item is in the tab order');
  assert.equal(label(tabbable[0]), 'Card 0', 'the entry point is not the first item');
});

test('a first arrow claims the step without a Tab', () => {
  mount();
  assert.equal(window.document.activeElement, window.document.body, 'focus started inside the step');
  pressFromBody('ArrowRight');
  assert.equal(label(window.document.activeElement), 'Card 0',
    'the first arrow did nothing — the step looks broken before it has been used');
});

test('ARROWS REACH CONTINUE AND BACK', () => {
  /* The whole point of the change. Before it, the grid sat on the card row and
   * these two were siblings of it: unreachable by arrow at any cost. */
  mount();
  pressFromBody('ArrowRight');            // Card 0
  for (let i = 0; i < 4; i++) press('ArrowRight');
  assert.equal(label(window.document.activeElement), 'Back', 'arrows cannot reach Back');
  press('ArrowRight');
  assert.equal(label(window.document.activeElement), 'Continue', 'arrows cannot reach Continue');
});

test('ArrowDown from the cards lands on the nav row', () => {
  mount();
  pressFromBody('ArrowDown');             // claims at Card 0
  press('ArrowDown');                     // + one row of 4
  assert.equal(label(window.document.activeElement), 'Back', 'ArrowDown does not cross into the nav row');
});

test('SPACE PRESSES THE BUTTON THE HIGHLIGHT IS ON', () => {
  // The request: someone who does not want to press Enter should be able to
  // arrow onto Continue and press Space.
  mount();
  /* The first arrow CLAIMS the step at the current item — it does not also
   * move. Anything else would mean the very first keypress skipped an option
   * the user never saw. */
  pressFromBody('ArrowLeft');
  assert.equal(label(window.document.activeElement), 'Card 0', 'the first arrow moved as well as claiming');
  press('ArrowLeft');                     // wraps to the last item — Continue
  assert.equal(label(window.document.activeElement), 'Continue');
  press(' ');
  assert.deepEqual(log, ['continue:click'], 'Space on Continue did not press it');
});

test('Space fires exactly ONCE here — and jsdom CANNOT prove that in a browser', () => {
  /* 🔴 Read this before trusting it.
   *
   * In a browser these are <button>s and Space fires a native click on keyUP,
   * so dropping preventDefault would toggle TWICE and appear to do nothing.
   * jsdom does not synthesize that click at all — so this test passes with or
   * without preventDefault, and the mutation check confirmed exactly that.
   *
   * It is kept because it still catches a handler that fires twice on its own,
   * but the real protection for the native double-fire is the source assertion
   * in keyboard-grid.test.mjs, which IS mutation-checked against removing it.
   * A test that cannot fail is not evidence, and pretending otherwise is worse
   * than having no test — so the limit is written down instead of implied. */
  mount();
  pressFromBody('ArrowRight');
  press(' ');
  assert.deepEqual(log, ['toggle:0'], 'Space did not toggle exactly once');
});

test('Space on a card toggles it — and does NOT advance', () => {
  mount();
  pressFromBody('ArrowRight');
  press(' ');
  press('ArrowRight');
  press(' ');
  assert.deepEqual(log, ['toggle:0', 'toggle:1'], 'Space selected more or less than the two cards');
  assert.ok(!log.includes('continue:enter'), 'Space advanced the step');
});

test('ENTER ON BACK GOES BACK — it does not continue', () => {
  /* "Enter always continues" is the trap: arrow onto Back, press Enter, move
   * FORWARD. Pressing Enter on a focused button activating it is about as
   * strong an expectation as the keyboard has. */
  mount();
  pressFromBody('ArrowLeft');             // claims at Card 0
  press('ArrowLeft');                     // wraps to Continue
  press('ArrowLeft');                     // Back
  assert.equal(label(window.document.activeElement), 'Back');
  press('Enter');
  assert.deepEqual(log, ['back'], 'Enter on Back did not go back');
});

test('Enter on a CARD continues', () => {
  mount();
  pressFromBody('ArrowRight');
  press('Enter');
  assert.deepEqual(log, ['continue:enter'], 'Enter on a card did not continue');
});

test('arrows never activate what they land on', () => {
  mount();
  pressFromBody('ArrowRight');
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) press(k);
  assert.deepEqual(log, [], 'an arrow activated the item it landed on');
});

test('a DISABLED Continue is skipped, not landed on', () => {
  // Arrowing onto a dead control and pressing Space reads as the keys breaking.
  mount({ canContinue: false });
  /* Asserted by WALKING, not by counting the DOM. The first version counted
   * `[data-roving]` elements and failed on correct code: the attribute is
   * still on the disabled button — being skipped is the HOOK's behaviour, not
   * the markup's. Testing the helper instead of the thing is its own trap. */
  const seen = new Set();
  pressFromBody('ArrowRight');
  for (let i = 0; i < 12; i++) { seen.add(label(window.document.activeElement)); press('ArrowRight'); }
  assert.ok(seen.has('Back'), 'Back was never reached, so this walk proves nothing');
  assert.ok(!seen.has('Continue'), 'the highlight landed on Continue while it was disabled');
});

test('every reachable control shows a focus ring', () => {
  /* .focus-self opts OUT of the global :focus-visible ring, and Continue and
   * Back both carried it while painting hover and nothing else - so focus on
   * the primary action of the whole flow was invisible. Survivable when they
   * were Tab-only afterthoughts; not once arrows land there. */
  mount();
  for (const el of items()) {
    assert.ok(
      !el.className.includes('focus-self'),
      '"' + label(el) + '" opts out of the focus ring but can be reached by arrow',
    );
  }
});
