/**
 * Enter advances the flow — and does not steal Enter from anything else.
 *
 * Two rules, both easy to break without noticing:
 *
 *   1. Enter and the Continue button must invoke the SAME function. Two code
 *      paths for one action is how a keyboard route quietly stops matching the
 *      button it mirrors — usually after someone edits the button.
 *
 *   2. Enter must NOT fire while a button, link, textarea or contenteditable
 *      has focus. Every card and tile in this flow is a <button>, and Enter on
 *      a focused button activates it natively. Hijacking that breaks the
 *      keyboard route at exactly the moment someone is using it: they tab to a
 *      suite card, press Enter, and SKIP the step instead of selecting it.
 *
 * Source-level, because both are wiring facts. There is no rendered artefact
 * that says "these two call the same thing".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/pages/Onboarding.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the parse found the handler — this gate can fail', () => {
  assert.match(src, /const primaryAction/, 'primaryAction is gone; the matcher is stale');
});

test('Enter and the Continue button invoke the same action', () => {
  const calls = src.match(/primaryAction\(\)\?\.\(\)/g) || [];
  assert.ok(
    calls.length >= 2,
    `only ${calls.length} call site(s) use primaryAction — the button and the key ` +
    'must share one function, not each carry their own copy',
  );
  assert.match(src, /const act = primaryAction\(\);/, 'the key handler does not go through primaryAction');
});

test('Enter is ignored while an interactive element has focus', () => {
  for (const tag of ['BUTTON', 'A', 'TEXTAREA', 'SELECT']) {
    assert.ok(
      src.includes(`'${tag}'`),
      `Enter does not exempt <${tag.toLowerCase()}> — it would override that element's own Enter`,
    );
  }
  assert.match(src, /isContentEditable/, 'Enter does not exempt contenteditable');
});

test('only PLAIN Enter advances', () => {
  // Ctrl/Cmd+Enter is submit-everything elsewhere and Shift+Enter is a newline.
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.ok(src.includes(`e.${mod}`), `Enter does not check ${mod}`);
  }
  // An IME composition ENDS with Enter; advancing would eat the keystroke that
  // was confirming a character.
  assert.match(src, /isComposing/, 'Enter does not guard against IME composition');
});

test('the hint is only shown where Enter is actually bound', () => {
  // primaryAction returns null on the role and plan steps, so those Navs must
  // not advertise a shortcut that does nothing.
  const hints = (src.match(/enterHint\b/g) || []).length;
  assert.ok(hints >= 2, 'the Enter hint is not passed to the steps that have a primary action');
  assert.doesNotMatch(
    src, /skipLabel="Skip for now"[^/]*enterHint/,
    'the plan step advertises Enter — its only forward actions are dismissing a ' +
    'paywall and opening a payment flow, neither of which should have a keystroke',
  );
});
