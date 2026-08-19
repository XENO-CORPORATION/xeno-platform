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

test('no step advertises a shortcut it does not have', () => {
  /* The ⏎ glyph on Continue was removed by request.
   *
   * This assertion used to require it on the steps that bind Enter. Inverted
   * rather than deleted, because the underlying risk did not go away — it
   * only changed direction. A hint reintroduced later must still not appear
   * on the role or plan steps, where primaryAction returns null and Enter
   * does nothing.
   *
   * ⚠️ This gate went RED on the commit that removed the glyph, and the
   * commit shipped anyway. A gate asserting a feature exists becomes wrong
   * the moment the feature is deliberately removed — the test is part of the
   * change, not a separate chore. */
  assert.ok(
    !src.includes('enterHint'),
    'the Enter hint is back; if that is intended, assert it only reaches the ' +
    'steps where primaryAction returns non-null',
  );
});
