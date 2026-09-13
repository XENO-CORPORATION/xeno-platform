/**
 * Nothing may hide the focus ring without replacing it.
 *
 * 🔴 `.focus-self` sets `outline: none`. It exists for text fields that paint
 * their own focus border, where the global ring would draw a SECOND stroke
 * floating outside the field.
 *
 * It was then applied to the onboarding cards — which paint no focus state at
 * all. The result: arrow-key navigation moved focus correctly and NOTHING was
 * visible. The feature was complete and unusable, and it reported as "the
 * arrow keys do not work", which is the wrong file entirely.
 *
 * The class's own documentation says "only ever put this on an element that
 * VISIBLY changes on focus". This is that sentence, enforced.
 *
 * A file may use focus-self only if it also defines a focus-visible treatment.
 * That is deliberately coarse — proving per-element would need a real DOM —
 * but it catches the failure that actually happened: a component reaching for
 * the class with no focus styling anywhere in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx$/.test(f)) out.push(f);
  }
  return out;
}

/**
 * ⚠️ The scanned set was a hardcoded list of onboarding/auth files, and it is why this gate did
 * not see the chat composer at all. A coverage set that names files cannot cover a file added
 * later — the same shape as a control tested through one of its three call sites. Whenever
 * `focus-self` is used somewhere new, that directory belongs here.
 */
const FILES = walk('src/components/onboarding')
  .concat(walk('src/components/playground/Chat'))
  .concat(['src/pages/Onboarding.tsx', 'src/pages/ActivateAccount.tsx', 'src/pages/AuthContent.tsx']);

test('the scan covers something — this gate can fail', () => {
  assert.ok(FILES.length >= 6, `only ${FILES.length} files scanned; the walk is broken`);
});

/**
 * 🔴 The coverage set must contain every file that uses the class.
 *
 * Without this, adding `focus-self` to an unscanned file passes silently — which is exactly
 * what the chat composer would have done on 2026-09-13. Asserting the MECHANISM (the list is
 * non-empty) is not asserting the OUTCOME (nothing escapes it).
 */
test('no file outside the scanned set uses focus-self', () => {
  const scanned = new Set(FILES.map((f) => f.replace(/\\/g, '/')));
  const escaped = walk('src')
    .filter((f) => !scanned.has(f.replace(/\\/g, '/')))
    .filter((f) => readFileSync(f, 'utf8').includes('focus-self'));
  assert.deepEqual(
    escaped, [],
    `These use focus-self but are not scanned by this gate, so nothing checks that they replace\n` +
    `the ring they hide. Add their directory to FILES:\n  ${escaped.join('\n  ')}`,
  );
});

test('focus-self is only used where a focus treatment exists', () => {
  const offenders = [];
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (!src.includes('focus-self')) continue;
    // A field that opts out must show focus some other way.
    const paintsFocus = /focus:(border|bg|ring|shadow)|focus-visible:/.test(src);
    if (!paintsFocus) offenders.push(f);
  }
  assert.deepEqual(
    offenders, [],
    'These hide the focus ring and replace it with nothing, so keyboard focus is ' +
    `INVISIBLE in them:\n  ${offenders.join('\n  ')}\n` +
    'Either drop focus-self, or give the element a focus-visible treatment.',
  );
});

test('the global ring still exists — focus-self assumes something to opt out of', () => {
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px/, 'the global focus ring is gone');
});
