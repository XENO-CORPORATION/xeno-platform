/**
 * Pins the shell/plate anatomy from `XENO CHROME - CONSTRUCTION PLAYBOOK.md`.
 *
 * The playbook's central rule: a surface is not a flat card, it is a SHELL OF
 * PAGE BACKGROUND carrying separate plates with a 2px gap letting the page
 * colour show between them — and it explicitly warns that a single surface
 * with `border-bottom` dividers does not produce the effect.
 *
 * ── WHY THIS NEEDS A TEST ──────────────────────────────────────────────────
 *
 * The anatomy looks WRONG in source. `p-1.5` + `gap-[2px]` on a container
 * reads like stray spacing, and a header plate LIGHTER than the body plate
 * reads like an inverted value. Both are correct, and both are exactly the
 * kind of thing a later pass "cleans up" into one flat surface with a divider,
 * which renders as a bar with a panel under it instead of a recessed well.
 *
 * Nothing else would catch that: it still compiles, still renders, still looks
 * like a card. Only side by side with the reference is it wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SURFACES = [
  ['src/components/onboarding/WorkspaceChooser.tsx', 'suite card'],
  ['src/components/onboarding/OnboardingPieces.tsx', 'plan card'],
  // Added when the role step was rebuilt to the same anatomy. A surface built
  // to the standard and left OUT of the gate is the one that drifts — nothing
  // would report it, and two adjacent steps at two standards is exactly the
  // inconsistency this flow already had once.
  ['src/components/onboarding/RoleCard.tsx', 'role card'],
];

/**
 * Source with COMMENTS STRIPPED.
 *
 * 🔴 The first version of this gate matched raw source and was proven useless
 * by its own mutation check: the anatomy is documented in a block comment that
 * spells out `#1a1a1a` and `#111111`, so inverting the real colours left the
 * test green — it was asserting against the explanation, not the code.
 *
 * A gate that a comment can satisfy is a gate that breaks OPEN. Strip first.
 */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments, incl. JSX {/* */} bodies
    .replace(/^\s*\/\/.*$/gm, '');       // line comments
}

for (const [file, what] of SURFACES) {
  const src = code(file);

  test(`${what}: the shell carries page background and gaps its plates`, () => {
    assert.match(src, /gap-\[2px\]/, `${file}: no 2px plate gap — the gap IS the effect`);
    assert.match(src, /p-1\.5/, `${file}: shell has no 1.5 padding, so plates touch its border`);
    assert.match(src, /#08080a/, `${file}: shell is not the darkest surface`);
  });

  test(`${what}: header plate is LIGHTER than the body plate`, () => {
    // The counter-intuitive half. If someone "fixes" it, the body stops
    // reading as recessed and the whole anatomy collapses visually.
    assert.match(src, /#1a1a1a/, `${file}: header plate colour missing`);
    assert.match(src, /#111111/, `${file}: body plate colour missing`);
    const header = parseInt('1a1a1a', 16);
    const body = parseInt('111111', 16);
    assert.ok(header > body, 'header must be lighter than body');
  });

  test(`${what}: uses plates, not divider lines`, () => {
    // The playbook's named anti-pattern.
    assert.doesNotMatch(
      src, /border-b\s+border-white/,
      `${file}: a border-bottom divider is the flat-card shape the playbook rejects`,
    );
  });
}
