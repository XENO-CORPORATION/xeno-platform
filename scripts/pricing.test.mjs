/**
 * THE PRICING STEP HAS TO ARGUE, AND IT HAS TO ARGUE FROM THE TRUTH.
 *
 * Two failure modes, and they pull in opposite directions.
 *
 * The first is a step that does not sell. "Pro, EUR 24" alone answers "how
 * much" and never answers "instead of what" - free was absent from this screen
 * entirely, so the one decision actually being made here, whether to pay at
 * all, had only one side of it on the page.
 *
 * The second is a step that sells something we do not ship. The moment a
 * feature line is typed by hand it starts drifting from the gate that enforces
 * it, and the drift is invisible: the card keeps reading correctly long after
 * the entitlement behind it changed. So every line on every tier - granted and
 * withheld alike - is DERIVED from the same table `requireEntitlement` reads.
 *
 * These gates hold both ends: the comparison is present, and it is derived.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(f, 'utf8');
const strip = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const F = {
  page: 'src/pages/Onboarding.tsx',
  pieces: 'src/components/onboarding/OnboardingPieces.tsx',
  billing: 'src/server/services/billingService.js',
};
const page = strip(F.page);
const billing = strip(F.billing);

test('the parse found the pricing step - this gate can fail', () => {
  /* Anchored on STRUCTURE, not on a headline. Copy is the most-edited thing
   * on the page, and a gate that breaks every time a sentence is reworded gets
   * loosened until it protects nothing. */
  assert.match(page, /subscriptions\.length > 0 \? \(/, 'the plan step is gone; this matcher is stale');
});

test('FREE IS ON THE PAGE, beside the paid tiers', () => {
  // Without it the step states a price and never states an alternative.
  assert.match(page, /billing\?\.freePlan &&/, 'the free tier is not rendered');
  assert.match(page, /lg:grid-cols-3/, 'the tiers are not laid out as three side by side');
});

test('the free tier comes from the SAME entitlement table as the gate', () => {
  /* Not a client-side literal. The client cannot be trusted to remember what
   * free withholds - that is the server's business, and it already owns the
   * one table that decides it. */
  assert.match(billing, /freePlan: \{[^}]*entitlementsFor\('free'\)/,
    'getConfig does not ship the free tier from entitlementsFor');
  assert.doesNotMatch(page, /canUse:\s*false/, 'the client hardcodes what free grants');
});

test('what free WITHHOLDS is derived by subtraction, never typed', () => {
  /* The drift-prone line. Grant free an allowance tomorrow and a derived list
   * loses that row by itself; a typed one keeps selling against a product we
   * stopped shipping, and nothing reports it. */
  const fn = page.slice(page.indexOf('function lockedFor'), page.indexOf('function formatPrice'));
  assert.ok(fn.length > 0, 'lockedFor is gone');
  assert.match(fn, /allFeatures\(better\)/, 'the locked list is not derived from entitlements');
  assert.match(fn, /allFeatures\(mine\)/, 'the locked list does not subtract what free already grants');
  assert.match(fn, /filter\(/, 'the locked list is not a difference');
  // No prose in the function: any quoted sentence here is a hand-written claim.
  assert.doesNotMatch(fn, /'[A-Z][a-z]+ [a-z]/, 'lockedFor contains a hand-written feature line');
});

test('free is compared against the CHEAPEST plan, not a named one', () => {
  /* What a free user decides is whether to pay at all, so the comparison is
   * against the least they could pay. Naming a tier goes quietly wrong the day
   * the ladder gains a rung below it - in the one list whose job is to be
   * accurate about what is withheld. */
  const anchor = page.slice(page.indexOf('const anchor'), page.indexOf('const workspaceSummary'));
  assert.match(anchor, /sort\(\(a, b\) => a\.price - b\.price\)/, 'the anchor is not the cheapest tier');
  assert.doesNotMatch(anchor, /=== 'pro'/, 'the anchor is hardcoded to a plan name');
});

test('free offers no button that cannot charge', () => {
  // A button is a promise that something happens. Nothing happens: it is the
  // plan the account is already on, and Continue already leaves the step.
  assert.match(page, /current\n?\s*style=\{wave\(0/, 'the free card is not marked as the current plan');
  const card = strip(F.pieces);
  assert.match(card, /\{current \? \(/, 'PlanCard does not special-case the current plan');
});

test('the step says what the user actually picked', () => {
  // The only thread between this step and the previous one. Without it the
  // flow asks three questions and then changes the subject to money.
  assert.match(page, /workspaceSummary/, 'the pitch is not personalised to the chosen workspace');
  assert.match(page, /isEverything\(picked\)/, 'the everything case is not named');
});

/* ── The real-DOM half ─────────────────────────────────────────────────────
 * Source greps prove the wiring is written. They cannot prove a card renders
 * what it was handed - and "built, tested, unreachable" is the shape this
 * ecosystem keeps rediscovering. So the card is mounted for real. */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true, url: 'http://localhost/',
});
const { window } = dom;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement',
                 'KeyboardEvent', 'Event', 'Node', 'getComputedStyle', 'requestAnimationFrame',
                 'cancelAnimationFrame', 'MutationObserver']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');

// Compiled every run: a checked-in bundle could go green against code that no
// longer exists, which is worse than no gate at all.
const esbuild = await import('esbuild');
const OUT = 'scripts/harness/.bundle.generated.mjs';
await esbuild.build({
  entryPoints: ['scripts/harness/rovingStep.tsx'],
  bundle: true, format: 'esm', jsx: 'automatic',
  external: ['react', 'react-dom'], outfile: OUT, logLevel: 'error',
});
const { Tier } = await import('../' + OUT);

const root = window.document.getElementById('root');
let reactRoot;
const render = (props) => {
  if (reactRoot) act(() => reactRoot.unmount());
  reactRoot = createRoot(root);
  act(() => reactRoot.render(React.createElement(Tier, props)));
  return root;
};

const FREE = {
  label: 'Free', price: '€0', interval: '', note: 'No card, no expiry.',
  features: [], locked: ['Unlimited in-house generation', 'AI agents across every app'],
  current: true,
};
const PRO = {
  label: 'Pro', price: '€24', interval: 'month', badge: 'Most popular',
  features: ['Unlimited in-house generation', 'AI agents across every app'],
  highlighted: true, available: true, onSelect: () => {},
};

test('a free card renders what is LOCKED, and says so', () => {
  const el = render(FREE);
  const text = el.textContent;
  assert.match(text, /Locked on this plan/, 'the locked section is not rendered');
  for (const line of FREE.locked) {
    assert.ok(text.includes(line), `the locked line "${line}" never reached the DOM`);
  }
});

test('a free card offers NO button', () => {
  const el = render(FREE);
  assert.equal(el.querySelectorAll('button').length, 0, 'the current plan renders a pressable control');
  assert.match(el.textContent, /Your plan right now/, 'the current plan does not say it is current');
});

test('a paid card offers exactly one action, and it is reachable by arrow', () => {
  const el = render(PRO);
  const buttons = el.querySelectorAll('button');
  assert.equal(buttons.length, 1, 'a paid tier does not have exactly one action');
  assert.equal(buttons[0].dataset.roving, 'action', 'the plan action is outside the arrow navigation');
  assert.ok(!buttons[0].disabled, 'an available plan cannot be chosen');
  assert.match(el.textContent, /Choose Pro/, 'the action does not name the plan');
});

test('an unconfigured plan says so instead of pretending to charge', () => {
  // Stripe is not configured today, so this is the state the step is actually
  // in - a "Choose Pro" button that cannot charge would be the worst outcome.
  const el = render({ ...PRO, available: false });
  assert.match(el.textContent, /Not yet available/, 'an unsellable plan still advertises a purchase');
  assert.ok(el.querySelector('button').disabled, 'an unsellable plan is still pressable');
});

test('a paid card shows no locked section', () => {
  // The argument runs one way. Listing what Pro withholds next to what it
  // grants turns a pitch into a spec sheet.
  assert.doesNotMatch(render(PRO).textContent, /Locked on this plan/, 'a paid tier lists what it withholds');
});
