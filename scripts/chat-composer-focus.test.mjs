/**
 * The composer shows focus on its OWN border, and never as a floating white rectangle.
 *
 * ## The defect this pins, reported from the running site 2026-09-13
 *
 * Focusing the chat input painted a hard white box inside the dark composer. It was the global
 * `:focus-visible` rule in `src/index.css` — `outline: 2px solid rgba(255,255,255,.5)` at
 * `outline-offset: 2px` — tracing the TEXTAREA, which is a transparent, borderless element inset
 * from the shell. So the ring floated in space, attached to no visible edge, around the text but
 * above the controls row. No comparable product ships that.
 *
 * The textarea already carried `outline-none focus:ring-0 focus:shadow-none` and they could not
 * win: Tailwind utilities and `:focus-visible` are both specificity (0,1,0), so source order
 * decides and `index.css` loads last. `.focus-self` (0,2,0) is the repo's existing opt-out.
 *
 * ## Why this file exists when `scripts/focus-visible.test.mjs` already guards the class
 *
 * 🔴 That gate MISSED this, measured — deleting the replacement rule while keeping `focus-self`
 * left it green. It asks whether the FILE contains `focus:(border|bg|ring|shadow)` anywhere, and
 * `ChatWithLLM.tsx` is ~20,000 lines with many unrelated `focus:` utilities, so the answer is
 * yes no matter what the composer does. A file-level regex cannot answer an element-level
 * question; it passes vacuously exactly where the file is large enough to matter.
 *
 * So this gate asserts the PAIR, on the composer specifically: the opt-out exists AND the
 * replacement exists, and the replacement targets the shell rather than the field.
 *
 * Mutation-checked 2026-09-13, each failing alone with a green control:
 *   delete the `:focus-within` rule but keep `focus-self`   → test 2 fails
 *   drop `focus-self` from the textarea                     → test 1 fails
 *   point the replacement at the textarea instead of shell  → test 3 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/** The one textarea that is the composer's message field — found by its ref, not by position. */
function composerTextarea() {
  const at = CHAT.indexOf('ref={textareaRef}');
  assert.notEqual(at, -1, 'the composer textarea must still be driven by textareaRef');
  const open = CHAT.lastIndexOf('<textarea', at);
  const close = CHAT.indexOf('/>', at);
  assert.ok(open !== -1 && close !== -1 && close > open, 'could not bound the composer textarea');
  return CHAT.slice(open, close + 2);
}

test('the composer field opts out of the global floating ring', () => {
  assert.match(
    composerTextarea(),
    /className=\{`focus-self\b/,
    'the composer textarea must carry `focus-self`, or the global :focus-visible outline draws a ' +
    'white rectangle inside the dark composer. `outline-none` cannot do it — same specificity, ' +
    'and index.css loads last.',
  );
});

test('the ring is REPLACED on the shell, not merely removed', () => {
  // The whole reason `.focus-self` is dangerous: index.css's own note says using it on an element
  // with no focus state deletes the only indicator a keyboard user has.
  assert.match(
    CHAT,
    /\[data-chat-composer-shell\]:focus-within\s*\{[^}]*border-color:/,
    'focus-self hides the ring, so the composer shell MUST paint its own focus state. Expected a ' +
    '`[data-chat-composer-shell]:focus-within { border-color: … }` rule.',
  );
});

test('the replacement is on the shell, which is the visible edge', () => {
  const rule = CHAT.match(/\[data-chat-composer-shell\]:focus-within\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(rule, 'no shell focus rule found');
  // An indicator on the transparent inner field or the textarea reproduces the original defect
  // in a different place: a stroke with no relationship to a box the user can see.
  assert.doesNotMatch(rule, /outline:/, 'the replacement must not be another floating outline');
  assert.match(rule, /border-color:\s*var\(/, 'the focus border must come from a theme token, not a literal');
});

test('the composer field and its inner box can never paint an edge', () => {
  /*
   * Reported 2026-09-13 with a screenshot AFTER the shell-border fix shipped: focusing the
   * composer still painted a bright square rectangle inside the shell, around the text and
   * stopping above the controls row.
   *
   * 🔴 I could not reproduce it. A themed, focused, real composer measured clean, and both
   * halves of the earlier fix were verified present in the shipped bundle — so the override was
   * something the probe did not recreate. What DID reproduce was an adversarial test: inject a
   * competing stroke at `html body …:focus` specificity, and the textarea's outline came back
   * as `solid 2px rgb(250,250,250)`. The earlier rules lost on specificity.
   *
   * So the invariant is not "we removed a stroke" but "no later rule can add one". Both
   * elements are suppressed at `html body` specificity, covering outline, ring and border —
   * verified to win with the competing stroke injected, and unchanged without it.
   *
   * ⚠️ `outline: none` alone is not enough: Tailwind's `focus:ring-0` still emits the ring
   * LAYERS into box-shadow (measured: three, all 0px), so a later rule restoring a non-zero
   * ring offset would paint a stroke with nothing in the markup to explain it.
   */
  /*
   * ⚠️ Check EVERY selector in the group, not the group as a whole.
   *
   * The first version matched `html body … <target> … {` across the rule, which stayed green
   * when the prefix was stripped from one line — a sibling selector still carried it. A rule
   * is only as specific as the selector that matches, so a single unprefixed line is a hole.
   */
  for (const target of ['[data-empty-composer-input="true"]', '[data-chat-composer-shell] textarea']) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ⚠️ Skip `:not(<target>)` — that selector EXCLUDES the element, so it is not a suppression
    // rule and demanding html-body specificity of it fails the control for no reason. The first
    // version flagged `.chat-input-container:not([data-empty-composer-input="true"])`.
    const selectorLines = CHAT.split('\n').filter((l) => (
      new RegExp(escaped).test(l)
      && /,\s*$|\{\s*$/.test(l)
      && !new RegExp(`:not\\(\\s*${escaped}`).test(l)
    ));
    assert.ok(
      selectorLines.length > 0,
      `no suppression selector found for ${target}. Without one a later rule wins on ` +
      'specificity and the stroke comes back — measured, not hypothetical.',
    );
    for (const line of selectorLines) {
      assert.match(
        line.trim(), /^html body /,
        `this selector for ${target} is not at html-body specificity:\n  ${line.trim()}\n` +
        'One unprefixed line is enough for a competing rule to win — verified by injecting ' +
        'a stroke at html-body specificity and watching the textarea outline come back.',
      );
    }
    const body = CHAT.slice(CHAT.indexOf(selectorLines[selectorLines.length - 1]));
    const rule = body.slice(0, body.indexOf('}'));
    for (const prop of [/outline:\s*0 none transparent/, /box-shadow:\s*none/, /border-color:\s*transparent/]) {
      assert.match(rule, prop,
        `${target} must suppress outline, ring (box-shadow) AND border together — suppressing ` +
        'one leaves the other two able to draw the same visible edge.');
    }
  }
});

test('the global ring still exists for everything else', () => {
  // Deleting it outright would be a real accessibility regression — the repo found inputs whose
  // ONLY focus affordance is that outline. The composer opts out; the site does not.
  assert.match(CSS, /:focus-visible\s*\{[^}]*outline:\s*2px/, 'the global focus ring is gone');
  assert.match(CSS, /\.focus-self:focus-visible\s*\{\s*outline:\s*none/, 'the .focus-self opt-out is gone');
});
