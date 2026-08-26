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
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const read = (f) => readFileSync(f, 'utf8');
const strip = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const F = {
  page: 'src/pages/Onboarding.tsx',
  pieces: 'src/components/onboarding/OnboardingPieces.tsx',
  billing: 'src/server/services/billingService.js',
};
/**
 * ONE function's body, bounded by its own braces.
 *
 * 🔴 Do NOT go back to `slice(indexOf(a), indexOf(b))`. That form has produced
 * a wrong result three times in this repo, and every time it was a FALSE PASS
 * or a false failure that cost a diagnosis: the window silently grows to
 * swallow whatever function was inserted next, so an assertion about `lockedFor`
 * starts reading `noteFor`'s string literals, and a mutation check "passes"
 * because its search string is still somewhere inside an oversized window.
 *
 * Returns '' when the function is gone, so the caller's own `length > 0` guard
 * is what reports it — a matcher that silently examines the whole file is how a
 * gate stops being about anything.
 */
function body(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return '';
}

const page = strip(F.page);
const pieces = strip(F.pieces);
const css = read('src/index.css');
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
  const fn = body(page, 'function lockedFor');
  assert.ok(fn.length > 0, 'lockedFor is gone');
  /* Matched on the ARGUMENT, not on the whole call. `allFeatures(better)` broke
   * the day the function gained a second parameter, while the derivation it
   * exists to protect was untouched — a gate that fails on a signature change
   * teaches people to loosen it. What must hold is that both sides come from
   * the entitlement table. */
  assert.match(fn, /allFeatures\(better\b/, 'the locked list is not derived from entitlements');
  assert.match(fn, /allFeatures\(mine\b/, 'the locked list does not subtract what free already grants');
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

/* ── The redesign ─────────────────────────────────────────────────────────
 * The card carries the one number on this screen that could embarrass us, and
 * it earns its emphasis from surface rather than from colour. Both are easy to
 * undo by accident and neither is visible to a typecheck. */

test('the app count is MEASURED, not written or guessed', () => {
  /* `availableForSuite` filters through the release probe rather than the
   * catalog's `status` — three products were marked coming-soon while actually
   * shipping. A literal here would be wrong the first time a product ships. */
  const fn = page.slice(page.indexOf('const workspaceApps'), page.indexOf('const workspaceSummary'));
  assert.ok(fn.length > 0, 'workspaceApps is gone');
  assert.match(fn, /availableForSuite/, 'the count does not use the release probe');
  assert.doesNotMatch(fn, /=\s*\d+;/, 'the count is a hardcoded number');
  // Deduped: a product reachable from two suites is still one app.
  assert.match(fn, /new Set\(/, 'the count can double-count a shared product');
});

test('free and paid state the SAME count, to opposite ends', () => {
  /* The count is the same catalog on both sides; the account owner's 2026-08-24
   * distribution override changes what a new Free account may DOWNLOAD, not
   * which products exist. Free therefore says they are mapped and preserves
   * existing installs; paid says they share one paid workspace. */
  const verdicts = [...page.matchAll(/verdict: `All \$\{workspaceApps\}([^`]*)`/g)].map((m) => m[1]);
  assert.equal(verdicts.length, 2, 'both tiers no longer state the measured count');
  assert.notEqual(verdicts[0], verdicts[1], 'the two tiers say the same thing, so the count argues nothing');
});

test('the free verdict claims nothing the server cannot enforce', () => {
  /* 🔴 THE CLAIM THAT WAS WRONG, kept as a gate because it survived review and
   * shipped. This line read "All N open. None of them run." — untrue, and worse,
   * UNENFORCEABLE: the apps are local Electron installers and `canUse` gates our
   * API, so a free user disproves it by opening one offline. A claim a customer
   * can falsify in ten minutes discredits every other claim on the page.
   *
   * Phrased as a blocklist deliberately, and it is the weaker form: it catches
   * the sentence we actually wrote, not every future variant. The strong version
   * would need to know what the local binaries do, which no gate in this repo
   * can see. Add to it when a new overclaim is found. */
  const unenforceable = [
    /None of them run/i,
    /nothing runs/i,
    /cannot (?:be )?open/i,
    /(?:apps?|they) (?:will )?not run/i,
  ];
  for (const bad of unenforceable) {
    assert.doesNotMatch(page, bad,
      `the page claims the local apps are gated, which the server cannot enforce (${bad})`);
  }
});

/* ── The founding clock ───────────────────────────────────────────────────
 * The only urgency device on this page, and the one most easily turned into a
 * dark pattern by a small edit. `XENO PRICING - STANDARD & LEDGER.md` allows it
 * on exactly two conditions: the successor price is real, and this customer
 * never pays it. */

test('the founding promise states BOTH halves, or neither', () => {
  /* "EUR 24, locked forever" with no successor is a claim with nothing to
   * compare against. "EUR 24, later EUR 39" with no lock reads as an
   * introductory rate that expires — the bait-and-switch the standard exists to
   * rule out. Together they are an honest deadline. */
  const fn = body(page, 'function foundingNote');
  assert.ok(fn.length > 0, 'the founding promise is gone');
  assert.match(fn, /!item\.founding \|\| !item\.becomes/,
    'the promise renders without a real successor price');
  assert.match(fn, /for everyone who joins later/, 'the promise does not say who the rise applies to');
  assert.match(fn, /You keep this price/, 'the promise does not say the price is kept');
});

test('the successor price is DERIVED, never typed on the client', () => {
  /* A literal "EUR 39" here is a promise about a different SKU's price,
   * maintained in the one place that cannot see what Stripe will charge — and
   * it goes stale silently, on the single line whose whole job is to be
   * trusted. */
  const fn = body(page, 'function foundingNote');
  assert.match(fn, /item\.becomes\.(perMonth|price)/, 'the successor does not come from the server');
  assert.doesNotMatch(fn, /\b(?:19|24|29|39|40|99)\b/, 'the client hardcodes a price');

  /* And the server derives it from another PRICED ROW rather than restating a
   * number, so one edit moves both the price and every promise about it. */
  const cat = body(billing, 'export async function getPublicCatalog');
  assert.ok(cat.length > 0, 'getPublicCatalog is gone');
  assert.match(cat, /becomes:\s*\{\s*price:\s*\w+\.price/,
    'the successor price is not taken from another catalog row');
  assert.match(cat, /\.find\(/, 'the successor is not looked up at all');
  assert.doesNotMatch(cat, /\bprice:\s*\d/, 'the server hardcodes a successor price');

  /* Matched on plan AND interval — the assertion that earns its keep.
   *
   * By plan alone, the yearly card quotes the MONTHLY successor: telling
   * somebody paying EUR 19/mo that their price becomes EUR 39, which is neither
   * their price nor their term. It reads perfectly right and is wrong by a
   * factor of the annual discount. */
  assert.match(cat, /o\.plan === item\.plan && o\.interval === item\.interval/,
    'the successor is matched on plan alone, so an annual card quotes a monthly price');
});

test('one plan never shows two prices at once', async () => {
  /* Founding and list are the same PLAN at two prices. Offering both puts two
   * cards on screen with identical entitlements and different numbers, and the
   * cheaper one makes the dearer one look like an error.
   *
   * ⚠️ This asserts the OUTCOME by calling the real filter, not that the filter
   * mentions the word `founding`. The first version of this gate did the latter
   * and passed with the list-price branch blanked out — the same mistake as the
   * extension gate that pinned `externalUrl === undefined`. A catalog is cheap
   * to call; there is no reason to grep for one. */
  const { getPublicCatalog } = createRequire(import.meta.url)(resolve(F.billing));

  const offered = async (open) => {
    const prev = process.env.XENO_FOUNDING_PRICING;
    if (open) delete process.env.XENO_FOUNDING_PRICING;
    else process.env.XENO_FOUNDING_PRICING = 'closed';
    try { return (await getPublicCatalog()).filter((i) => i.kind === 'subscription'); }
    finally {
      if (prev === undefined) delete process.env.XENO_FOUNDING_PRICING;
      else process.env.XENO_FOUNDING_PRICING = prev;
    }
  };

  for (const open of [true, false]) {
    const items = await offered(open);
    assert.ok(items.length > 0, `no subscription is offered with founding ${open ? 'open' : 'closed'}`);

    const seen = new Map();
    for (const i of items) seen.set(`${i.plan}/${i.interval}`, (seen.get(`${i.plan}/${i.interval}`) ?? 0) + 1);
    const doubled = [...seen].filter(([, n]) => n > 1);
    assert.deepStrictEqual(doubled, [],
      `two prices offered for one plan+interval with founding ${open ? 'open' : 'closed'}: ` +
      JSON.stringify(items.map((i) => `${i.id}@${i.price}`)));

    /* And it must be the RIGHT one of the two — offering the list price during
     * the founding window is the same bug wearing the opposite sign. */
    const pro = items.filter((i) => i.plan === 'pro' && i.interval === 'month');
    assert.strictEqual(pro.length, 1, 'the flagship monthly price is missing or doubled');
    assert.strictEqual(Boolean(pro[0].founding), open,
      `founding ${open ? 'open' : 'closed'} offered the wrong price: ${pro[0].id}`);
  }
});

test('an entitlement is only advertised where it can be SERVED', () => {
  /* 🔴 Entitled is not the same as serveable, and only one of them belongs on a
   * card. `inHouseDailyLimit` is a real, enforced quota — and the route behind
   * it answers 400 `inhouse_unavailable` where this deployment has no xeno-rt,
   * so deriving the line straight from the entitlement advertises an allowance
   * against an error message.
   *
   * Undefined must count as CANNOT: silence is not a yes, and the failure has to
   * fall on the side of promising less. Same fail-safe as `available` for a
   * price. */
  const fn = body(page, 'function allFeatures');
  assert.ok(fn.length > 0, 'allFeatures is gone');
  assert.match(fn, /serves\?\.inHouse/, 'the in-house line is advertised without checking it can be served');
  assert.match(billing, /serves:\s*\{/, 'the server never reports what it can serve');
  assert.match(billing, /XENO_RT_BASE_URL/, 'servability is not derived from the in-house backend');
});

test('emphasis is surface and geometry — never hue', () => {
  /* `DESIGN_SYSTEM.md` is monochromatic and the retired purple is not coming
   * back to mark a "popular" plan. On a dark chrome a lifted, lighter plate
   * reads as nearer, which is the hierarchy an accent colour is usually
   * reached for. Checked by CHANNEL EQUALITY rather than by blocklisting the
   * old purple: a blocklist only catches the one colour somebody already
   * regretted. */
  /* TOLERANCE, deliberately — do NOT tighten this to exact equality.
   *
   * The canonical shell background is #08080a, a 2/255 blue tint the chrome
   * playbook specifies on purpose: a perfectly neutral near-black reads dead
   * next to the plates. Exact equality fails on the design system's OWN value,
   * which is how a correct gate gets deleted for being wrong — it did fail on
   * exactly that, first run.
   *
   * A hue is not a near-neutral. The retired purple #7c5cfc spreads 160
   * channels; every colour on this card spreads at most 2. Anything in between
   * is a decision somebody should have to make on purpose. */
  const NEUTRAL_SPREAD = 8;
  const spread = (...ch) => Math.max(...ch) - Math.min(...ch);
  const card = pieces.slice(pieces.indexOf('export const PlanCard'), pieces.indexOf('/* \u2500\u2500 Field'));

  for (const hex of card.match(/#[0-9a-fA-F]{6}\b/g) || []) {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(spread(...ch) <= NEUTRAL_SPREAD,
      `${hex} carries a hue (spread ${spread(...ch)}) — the payment card is not monochromatic`);
  }
  for (const c of card.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) || []) {
    const ch = c.match(/\d+/g).map(Number);
    assert.ok(spread(...ch) <= NEUTRAL_SPREAD,
      `${c}) carries a hue (spread ${spread(...ch)}) — the payment card is not monochromatic`);
  }
  // And the emphasis that IS applied is physical.
  assert.match(card, /-translate-y-2/, 'the recommended tier is not lifted');
  assert.match(card, /text-\[40px\]/, 'the recommended price is not larger');
});

test('the sheen is real, and it stops for reduced motion', () => {
  /* Written inline rather than as `animate-[...]`: an arbitrary Tailwind
   * animation utility compiles to nothing in this build, exactly as
   * `duration-[420ms]` did, and it fails silently. */
  assert.match(pieces, /animation: 'xenoSheen/, 'the sheen is not applied inline');
  assert.doesNotMatch(pieces, /animate-\[xenoSheen/, 'the sheen uses an arbitrary utility that compiles to nothing');
  assert.match(css, /@keyframes xenoSheen/, 'the sheen keyframe does not exist');
  /* The only looping animation in the flow, so the only one that has to stop —
   * a repeating ambient effect is precisely the kind that triggers vestibular
   * discomfort. */
  /* Each reduced-motion block extracted by BRACE MATCHING, not by slicing to
   * the end of the file.
   *
   * The first version sliced from the first `@media (prefers-reduced-motion)`
   * onwards — and index.css has more than one, with the xenoSheen KEYFRAME
   * sitting between them. So the slice contained the string it was looking for
   * no matter what the media block said, and the mutation check caught it
   * passing on code that had the override deleted. A boundary defined by "the
   * next thing that happens to exist" is not a boundary. */
  const blocks = [];
  for (let i = css.indexOf('@media (prefers-reduced-motion');
       i !== -1;
       i = css.indexOf('@media (prefers-reduced-motion', i + 1)) {
    let depth = 0;
    for (let j = css.indexOf('{', i); j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) { blocks.push(css.slice(i, j + 1)); break; }
    }
  }
  assert.ok(blocks.length > 0, 'there is no reduced-motion block at all');
  assert.ok(
    blocks.some((b) => b.includes('xenoSheen')),
    'the sheen keeps looping for someone who asked for less motion — it is the only ' +
    'repeating animation in the flow, so it is the only one that has to stop',
  );
});

test('the footer promises nothing the product cannot do yet', () => {
  // "Cancel any time" under a button that cannot charge is the kind of small
  // lie that makes a reader distrust everything else on the page.
  const card = pieces.slice(pieces.indexOf('export const PlanCard'), pieces.indexOf('/* \u2500\u2500 Field'));
  assert.match(card, /available \? 'Cancel any time/, 'the reassurance is not conditional on being sellable');
  assert.match(card, /Payments open shortly/, 'an unsellable plan has no honest footer line');
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

/* Compiled every run: a checked-in bundle could go green against code that no
 * longer exists, which is worse than no gate at all.
 *
 * 🔴 THE BUILD FAILURE IS CAUGHT, NOT THROWN — and that is the whole point.
 *
 * Letting it throw at top level looks safer and is not. Node has already run
 * the source gates by the time this line is reached, so the rejection lands
 * AFTER them: every DOM test below is never registered, and the run reports
 * `pass 17 · fail 0` while eight gates did not exist. Measured, not theorised —
 * a broken component printed exactly that, and the tally is the number a human
 * or a CI summary reads.
 *
 * The exit code is non-zero, so a pipeline stops. A person scanning `fail 0`
 * does not, and neither does anything parsing the tally. Same family as the
 * xeno-apps smoke gates that broke OPEN: an unrun gate must FAIL, never vanish.
 */
const OUT = 'scripts/harness/.bundle.generated.mjs';
let Tier;
let annualSavingFrom;
let harnessError;
try {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: ['scripts/harness/rovingStep.tsx'],
    bundle: true, format: 'esm', jsx: 'automatic',
    external: ['react', 'react-dom'], outfile: OUT, logLevel: 'silent',
  });
  ({ Tier, annualSavingFrom } = await import('../' + OUT + '?t=' + Date.now()));
} catch (err) {
  harnessError = err;
}

test('the harness COMPILES — so the DOM gates below can actually run', () => {
  assert.ok(!harnessError,
    'the components under test do not compile, so every DOM gate below is ' +
    'reporting on nothing:\n' + String(harnessError?.message ?? harnessError));
  assert.ok(typeof Tier === 'function', 'the harness compiled but exported no card');
});

test('the advertised annual saving never exceeds what a plan delivers', async () => {
  /* 🔴 A percentage on the interval toggle is a claim about money, and one
   * toggle switches every card — so the number has to hold for the WORST plan
   * on offer, not the best.
   *
   * A hand-typed "save 26%" sat here. It was true of the LIST prices and of
   * nothing actually on sale: with founding pricing open Pro saves 21% and Team
   * 20%, so the control overstated the discount on both, by five points on the
   * plan most people buy. Nothing caught it because no gate compared the copy
   * to a price.
   *
   * So this calls the real function against the real catalog, in both pricing
   * regimes, and checks the one property that matters: the advertised figure is
   * never larger than what the customer receives. */
  if (!annualSavingFrom) assert.fail('the harness did not compile — see the gate above');
  const { getPublicCatalog } = createRequire(import.meta.url)(resolve(F.billing));

  for (const open of [true, false]) {
    const prev = process.env.XENO_FOUNDING_PRICING;
    if (open) delete process.env.XENO_FOUNDING_PRICING;
    else process.env.XENO_FOUNDING_PRICING = 'closed';
    let catalog;
    try { catalog = await getPublicCatalog(); }
    finally {
      if (prev === undefined) delete process.env.XENO_FOUNDING_PRICING;
      else process.env.XENO_FOUNDING_PRICING = prev;
    }

    const regime = `founding ${open ? 'open' : 'closed'}`;
    const claimed = annualSavingFrom(catalog);
    const subs = catalog.filter((i) => i.kind === 'subscription');

    /* Every plan a customer can actually switch to annual, measured on the two
     * ANNUAL TOTALS — the money that changes hands. Deliberately not `1 -
     * perMonth/price`: that route reports Team's exact 20% as
     * 19.999999999999996, so a check built on it would demand the toggle
     * understate by a point and call the correct answer a lie. */
    const real = subs
      .filter((y) => y.interval === 'year')
      .map((y) => {
        const m = subs.find((o) => o.plan === y.plan && (o.interval || 'month') === 'month');
        if (!m?.price || !y.price) return null;
        const yearOfMonths = m.price * 12;
        return { plan: y.plan, pct: ((yearOfMonths - y.price) * 100) / yearOfMonths };
      })
      .filter(Boolean);

    assert.ok(real.length > 0, `no plan offers both intervals with ${regime}`);
    assert.strictEqual(typeof claimed, 'number',
      `annual is on sale with ${regime} but the toggle advertises no saving`);

    for (const { plan, pct } of real) {
      assert.ok(claimed <= pct,
        `with ${regime} the toggle claims ${claimed}% but ${plan} only saves ` +
        `${pct.toFixed(1)}% — the customer is promised a discount they do not get`);
    }

    /* And it must not be so cautious it stops being an offer: within a point of
     * the weakest real saving. Understating by 10 points to be safe would pass
     * the check above while making the control pointless. */
    const worst = Math.min(...real.map((r) => r.pct));
    assert.ok(claimed >= worst - 1,
      `with ${regime} the toggle claims ${claimed}% while every plan saves at ` +
      `least ${worst.toFixed(1)}% — the offer is understated to the point of noise`);
  }

  /* ⚠️ Rounding DIRECTION is unobservable against today's prices: the weakest
   * saving is Team's exact 20%, and floor, ceil and round all answer 20. So it
   * gets a fixture, or the direction is only pinned for as long as that number
   * stays round — and a price change would quietly remove the coverage rather
   * than fail. */
  const fractional = [
    { kind: 'subscription', plan: 'pro', interval: 'month', price: 30 },
    { kind: 'subscription', plan: 'pro', interval: 'year', price: 275 },
  ];
  // 360 - 275 = 85 of 360 = 23.61%
  assert.strictEqual(annualSavingFrom(fractional), 23,
    'a fractional saving must round DOWN — 23.61% advertised as 24% is a ' +
    'discount the customer does not receive');

  /* ⚠️ And a fixture for the float trap specifically, because the tolerance
   * above cannot see it: a one-point understatement passes `claimed >= worst-1`
   * by exactly zero margin. These are Team's real numbers — `1 - 32/40` is
   * 19.999999999999996 and floors to 19, while the totals are exact. */
  assert.strictEqual(annualSavingFrom([
    { kind: 'subscription', plan: 'team', interval: 'month', price: 40 },
    { kind: 'subscription', plan: 'team', interval: 'year', price: 384, perMonth: 32 },
  ]), 20,
    'an exact 20% is being reported as 19% — the saving is being computed from ' +
    'the per-month figures, where binary rounding costs a full point');

  /* A saving too small to state at 1% precision says nothing, rather than
   * badging the control "save 0%". 1200 vs 1195 is 0.42%. */
  assert.strictEqual(annualSavingFrom([
    { kind: 'subscription', plan: 'pro', interval: 'month', price: 100 },
    { kind: 'subscription', plan: 'pro', interval: 'year', price: 1195 },
  ]), null, 'a sub-1% saving must not render as "save 0%"');

  /* And no annual price on offer means no claim at all. */
  assert.strictEqual(annualSavingFrom([fractional[0]]), null,
    'with no annual price the toggle must advertise nothing');
});

test('the saving is derived, not typed — no percentage literal on the toggle', () => {
  /* The mechanism check that the outcome gate above cannot make: a literal that
   * happens to be correct today passes it. This one refuses the literal. */
  const toggle = page.slice(page.indexOf('aria-label="Billing interval"'));
  const upto = toggle.slice(0, toggle.indexOf('</div>'));
  const literal = upto.match(/save\s+\d+\s*%/i);
  assert.strictEqual(literal, null,
    `the interval toggle carries a hand-typed saving (${literal?.[0]}); it goes ` +
    'stale the next time a price moves, and silently — see annualSavingFrom');
});

const root = window.document.getElementById('root');
let reactRoot;
const render = (props) => {
  // Each DOM gate fails on its own terms rather than the file disappearing.
  if (!Tier) assert.fail('the harness did not compile — see the gate above');
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

test('the workspace verdict reaches the DOM on both sides', () => {
  /* The card's strongest line, and the only one carrying a measured number.
   * Asserted rendering, not just wired: a prop that is accepted and never
   * painted is the shape this ecosystem keeps finding. */
  const free = render({ ...FREE, unlock: { count: 8, verdict: 'All 8, running on this machine.' } });
  assert.match(free.textContent, /In your workspace/, 'the workspace strip is not rendered');
  assert.match(free.textContent, /All 8, running on this machine\./, 'the free verdict never reached the DOM');

  const pro = render({ ...PRO, unlock: { count: 8, verdict: 'All 8, connected to each other.' } });
  assert.match(pro.textContent, /All 8, connected to each other\./, 'the paid verdict never reached the DOM');
});

test('the founding promise RENDERS — and only where there is one', () => {
  /* The promise is the page's only urgency device, so an accepted-but-unpainted
   * prop would remove the entire argument for buying today while every source
   * gate above stayed green. */
  const promise = '€39/mo for everyone who joins later. You keep this price for as long as you stay.';
  const el = render({ ...PRO, promise });
  assert.ok(el.textContent.includes(promise), 'the founding promise never reached the DOM');

  /* And a list-priced tier must not carry it — `foundingNote` returns undefined
   * there, and a card that promised a founding price to a customer paying the
   * list price would be promising something untrue. */
  const plain = render({ ...PRO, promise: undefined });
  assert.doesNotMatch(plain.textContent, /joins later|keep this price/,
    'a plan with no founding price still promises one');

  /* ⚠️ WHAT THIS GATE CANNOT SEE, stated rather than implied.
   *
   * Dropping the `promise &&` guard renders an EMPTY paragraph, and this gate
   * passes — verified by mutation, not assumed. React renders `undefined` as
   * nothing, so `textContent` is identical whether the element is absent or
   * present-and-empty. An assertion on the literal string "undefined" looks
   * like it covers this and covers nothing: React never emits it.
   *
   * The residual risk is therefore layout only — a blank line between plates —
   * which no text assertion can reach. It needs an eye or a screenshot diff. */
});

test('a card with no workspace count simply omits the strip', () => {
  // Someone who reaches this step without a workspace must not be shown an
  // empty panel or the word "undefined" on the screen that takes their money.
  const el = render({ ...PRO, unlock: undefined });
  assert.doesNotMatch(el.textContent, /In your workspace/, 'an empty strip is rendered');
  assert.doesNotMatch(el.textContent, /undefined|NaN/, 'a missing count leaks into the card');
});

/* ── The page a refused download lands on ─────────────────────────────────
 *
 * The download gate (docs/DOWNLOAD-GATE.md) refuses a free account with a 403
 * that says "get a plan" and points here. On 2026-08-24 that formed a CLOSED
 * LOOP in production: Stripe was off, so the visitor clicked the only button
 * on the page and got a red toast reading "Billing is not configured on this
 * server" — our infrastructure blamed for our own decision, and nowhere to go.
 *
 * A gate that refuses everyone is the failure this repo keeps re-shipping. If
 * the door is shut, the page has to SAY so.
 */

const pricingPage = read('src/pages/Pricing.tsx');
const billingClient = read('src/services/billingService.ts');

test('checkout availability is THREE-state, so a dropped request is not a refusal', () => {
  /* getBillingConfig() collapses a network error into enabled:false. Reusing it
   * here would tell a paying customer the product is closed for business because
   * one fetch failed. \'unknown\' must exist and must behave like today. */
  assert.ok(billingClient.includes('BillingAvailability'),
    'the three-state availability signal is gone — the page is back to guessing from enabled:false');
  /* Pin the BRANCHES, not one occurrence: the catch block also returns
   * 'unknown', so a file-level check stayed green with the HTTP-error path
   * flipped to 'disabled' — a 502 from the config endpoint would then have
   * closed the shop. */
  assert.ok(billingClient.includes("if (!res.ok) return 'unknown';"),
    'an HTTP error on the config fetch no longer resolves to unknown — a blip now reads as "not for sale"');
  assert.ok(billingClient.includes("if (typeof data?.enabled !== 'boolean') return 'unknown';"),
    'a malformed config body no longer resolves to unknown');
});

test('a KNOWN-disabled checkout says so instead of offering a dead button', () => {
  /* ⚠️ Assert the GUARDED BRANCH, not the file. Two call sites carry this
   * string (the plan CTA and the credit packs), so a file-level check stayed
   * green with the plan CTA's guard replaced by `if (false)`. Fourth time this
   * exact shape fooled a gate in this session — a substring is satisfied by any
   * line, including the one you were not thinking about. */
  const guard = pricingPage.indexOf("if (checkout.availability === 'disabled') {");
  assert.ok(guard > -1, 'the plan CTA no longer branches on checkout being disabled');
  const branch = pricingPage.slice(guard, guard + 900);
  assert.ok(branch.includes('Not yet purchasable'),
    'the disabled branch no longer says so — the CTA looks live with no checkout behind it');
  assert.ok(pricingPage.includes("const off = checkout.availability === 'disabled'"),
    'the credit packs stopped checking, so they still offer a Buy that cannot complete');
});

test('the disabled state is DEFINITE — never triggered by unknown', () => {
  /* The whole point of the third state. If the page ever branches on
   * !== \'live\', a transient error silently closes the shop. */
  assert.ok(!pricingPage.includes("availability !== 'live'"),
    'the page treats unknown as disabled — one failed request now stops every sale');
});

test('the pricing page carries no retired accent colour', () => {
  /* DESIGN_SYSTEM.md is the LOCKED authority and the brand is monochromatic.
   * #a760ff was on this page six times, including the "Most popular" badge —
   * on the one page that most needs to look like the company means it.
   * ⚠️ 19 OTHER files still carry it (UpgradePrompt, DocsLayout, landing-v3…).
   * That is a site-wide visual pass, deliberately NOT swept in here; this gate
   * covers the page it was fixed on so it cannot come back. */
  for (const retired of ['a760ff', '8a2be2', 'a855f7', '7c5cfc']) {
    assert.ok(!pricingPage.includes(retired),
      `Pricing.tsx uses the retired accent #${retired} — see DESIGN_SYSTEM.md`);
  }
});

test('the page no longer says the apps are free', () => {
  /* Owner override 2026-08-24. This is a statement of PRICING POLICY that the
   * owner changed, not a capability claim being quietly retired — the reasoning
   * is kept visible in src/config/pricing.ts and the pricing standard. */
  assert.ok(!pricingPage.includes('The tools are free'),
    'the pricing page still headlines that the tools are free, which the download gate made false');
  assert.ok(!pricingPage.includes('they don\'t unlock the tool'),
    'the FAQ still tells visitors a plan does not unlock the app');
});
