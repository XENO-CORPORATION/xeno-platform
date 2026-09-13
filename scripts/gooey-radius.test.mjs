/**
 * A travelling gooey blob paints the SAME corner radius as the button it stands in for.
 *
 * ## The defect this pins, measured in Chromium 2026-09-13
 *
 *   blob   declared 8px x scale 0.94 -> PAINTED 7.52px   (box 50x30)
 *   button declared 8px x scale 1    -> PAINTED 8px      (box 53x32)
 *
 * `border-radius` resolves BEFORE the transform, so a `scale(0.94)` box rounds 6% tighter than
 * the control it duplicates. Reported by eye: the travelling chip had a sharper corner than the
 * ones already landed beside it at full scale.
 *
 * 🔴 The radius COPY was never wrong. `runGooey` reads `getComputedStyle(item).borderRadius`
 * and the blob receives exactly that — reading either number alone says the two agree. Only
 * `declared x scale` exposes it, which is why a check on the copied value would have passed
 * throughout and this had to be reported by a person.
 *
 * ## What is asserted, and why it is shaped this way
 *
 * The correction must ANIMATE. The first attempt set `border-radius` inline to the
 * counter-scaled value; measuring across the whole travel showed it PINNED for all 340ms —
 * an inline declaration outranks every stylesheet rule, so `--up` could not swap it. Painted
 * radius went 8.00 -> 8.53 as the scale relaxed: the same defect inverted, a corner too SOFT,
 * and worse because it lands that way and stays.
 *
 * So the invariant is not "a radius is copied" but "border-radius is driven by the cascade
 * between two endpoints, on the same clock as the transform". That is four things, each of
 * which alone reintroduces a visible bug:
 *
 *   1. the scale is cancelled at the start   (else: corner too sharp, the original report)
 *   2. `border-radius` is never set inline   (else: frozen, corner too soft on landing)
 *   3. it transitions on BOTH paths          (else: it snaps on close — `--hold` restates the
 *                                             whole shorthand, so omitting it fails silently)
 *   4. reduced motion gets the TRUE radius   (else: scale is forced to 1 while the radius keeps
 *                                             its enlarged start value — inverted, and only for
 *                                             users who asked for less motion)
 *
 * Source-only. The real proof is a browser measurement across the travel (scale and radius must
 * move together frame by frame), which needs Chromium and a dev server; that was run by hand
 * and its numbers are recorded above. This gate holds the four structural properties that
 * measurement depended on, so none can be removed without someone deciding to.
 *
 * Mutation-checked 2026-09-13, each failing alone with a green control:
 *   drop the counter-scale (publish the raw radius as the start)  -> test 2 fails
 *   set `border-radius` inline in setBlobRadius                   -> test 3 fails
 *   remove the border-radius leg from the `--hold` transition     -> test 5 fails
 *   remove the reduced-motion override                            -> test 6 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOEY = readFileSync(join(ROOT, 'src', 'components', 'playground', 'Chat', 'composerGooey.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The rule body for a selector, so an assertion cannot match a neighbouring rule. */
function ruleFor(selector) {
  const at = CSS.indexOf(selector);
  assert.notEqual(at, -1, `the rule "${selector}" must still exist`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open, close);
}

test('the blob still copies the real control radius', () => {
  assert.match(
    stripComments(GOOEY),
    /setBlobRadius\(\s*blob,\s*window\.getComputedStyle\(item\)\.borderRadius/,
    'the radius must come from the live control, never a constant',
  );
});

test('the start radius cancels the start scale', () => {
  const code = stripComments(GOOEY);
  const fn = code.match(/const setBlobRadius[\s\S]*?\n\};/);
  assert.ok(fn, 'setBlobRadius must exist');
  assert.match(
    fn[0], /parsed \/ startScale/,
    'the START endpoint must be radius / scale, so radius x scale paints the control\'s true ' +
    'corner on the first frame. Publishing the raw radius restores the reported defect: ' +
    '8px x 0.94 = 7.52px painted.',
  );
  assert.match(fn[0], /--gooey-radius-start/, 'the start endpoint must be published');
  assert.match(fn[0], /--gooey-radius\b/, 'the landed endpoint must be published');
});

test('border-radius is never set inline — the cascade owns it', () => {
  const fn = stripComments(GOOEY).match(/const setBlobRadius[\s\S]*?\n\};/)?.[0] ?? '';
  assert.doesNotMatch(
    fn, /\.style\.borderRadius\s*=/,
    'an inline border-radius outranks the `--up` rule, so the radius freezes at its start value ' +
    'for the whole travel (measured: painted 8.00 -> 8.53 as the scale relaxed). Publish the two ' +
    'endpoints as custom properties instead.',
  );
});

test('the two endpoints are wired to the two states', () => {
  assert.match(
    ruleFor('.chat-gooey-blob {'),
    /border-radius:\s*var\(--gooey-radius-start/,
    'the resting rule must START at the counter-scaled endpoint',
  );
  assert.match(
    ruleFor('.chat-gooey-blob.chat-gooey-item--up {'),
    /border-radius:\s*var\(--gooey-radius/,
    'the landed rule must END at the control\'s true radius',
  );
});

test('border-radius transitions on BOTH the open and the close path', () => {
  for (const selector of ['.chat-gooey-blob {', '.chat-gooey-blob.chat-gooey-blob--hold {']) {
    const rule = ruleFor(selector);
    assert.match(rule, /transition:[\s\S]*border-radius\s+var\(--gooey-dur/,
      `"${selector}" must transition border-radius on the same clock as the transform. ` +
      '`--hold` REPLACES the whole shorthand, so omitting the leg there does not fail loudly — ' +
      'the radius just snaps, and only on the way out.');
  }
});

test('reduced motion gets the TRUE radius, not the counter-scaled one', () => {
  // ⚠️ There are SEVERAL `prefers-reduced-motion` blocks in this stylesheet — the first belongs
  // to `.chat-caret`. Anchoring on the first match tested an unrelated rule and reported a
  // failure that had nothing to do with the blob. Find the block that mentions the blob.
  const blocks = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)]
    .map((m) => m[0]);
  assert.ok(blocks.length > 0, 'no reduced-motion block found at all');
  const block = blocks.find((b) => b.includes('.chat-gooey-blob'));
  assert.ok(
    block,
    `none of the ${blocks.length} reduced-motion blocks mentions .chat-gooey-blob — the override ` +
    'that keeps a non-animating blob on the control\'s true radius is missing.',
  );
  assert.match(
    block, /\.chat-gooey-blob\s*\{[^}]*border-radius:\s*var\(--gooey-radius,/,
    'that block forces `transform: none`, so the scale the counter-scale cancels is already ' +
    'gone. Without an override the blob keeps its enlarged START radius at scale 1 and paints a ' +
    'corner that is too soft — the defect inverted, reachable only by users who asked for less motion.',
  );
});

test('the metaball blur is pinned — it IS the blob corner radius', () => {
  /*
   * 🔴 `stdDeviation` reads like a cosmetic melt knob and is actually the corner radius of
   * every blob. The alpha crunch thresholds a BLURRED shape, so the blur rounds corners
   * geometrically on top of whatever `border-radius` declared.
   *
   * Measured in Chromium at 4x against a real 53x32 mode tab, all at a declared 8px:
   *
   *   stdDeviation   5      4     3     2     1    ~0    unfiltered button
   *   painted      11.25  11.0   9.0   8.0   7.0   6.5         6.5
   *
   * It shipped at 5, so every travelling chip painted a corner ~3px rounder than the button it
   * lands beside. Reported twice by eye; invisible to a CSS-level check because the distortion
   * happens at PAINT time, downstream of border-radius.
   *
   * ⚠️ Lowering the DECLARED radius cannot compensate — at `border-radius: 0` the blob still
   * painted 10.25px, because the blur imposes a floor. This is the only lever.
   *
   * The value is pinned rather than range-checked: anything else is a visible change to every
   * chip's corner, and should be a decision someone makes against a fresh measurement.
   */
  const EMPTY_STATE = readFileSync(
    join(ROOT, 'src', 'components', 'playground', 'Chat', 'ChatEmptyState.tsx'), 'utf8',
  );
  const blurs = [...EMPTY_STATE.matchAll(/<feGaussianBlur[^>]*stdDeviation="([\d.]+)"/g)].map((m) => m[1]);
  assert.equal(blurs.length, 1, `expected exactly one gooey blur, found ${blurs.length}`);
  assert.equal(
    blurs[0], '2',
    `the metaball blur is ${blurs[0]}, not 2. That changes the PAINTED corner of every gooey ` +
    'chip (5 -> 11.25px against an 8px button). If this is deliberate, re-measure the painted ' +
    'radius against the real control and update this gate with the new numbers.',
  );
});

test('the CSS fallback radius agrees with the controls it stands in for', () => {
  // It was 10px while every mode tab is rounded-lg -> --radius: 0.5rem -> 8px. The fallback is
  // only reachable if a control reports no radius, but a wrong one misleads whoever reads the
  // stylesheet on its own.
  assert.match(ruleFor('.chat-gooey-blob {'), /var\(--gooey-radius,\s*8px\)/,
    'the fallback must be 8px, matching rounded-lg on the mode tabs');
});
