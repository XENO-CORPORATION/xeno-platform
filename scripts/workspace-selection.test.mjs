/**
 * Suite selection is a SET, and the connectors belong to `everything` alone.
 *
 * Two rules that are easy to break by touching either side:
 *
 *   1. Selecting every suite one at a time is the SAME answer as pressing the
 *      everything bar, and must store the same canonical value. Two routes to
 *      one choice storing two different strings would later read back as two
 *      different answers — and the recommendation step, the label and the
 *      connectors would each disagree about which one happened.
 *
 *   2. The connector line is drawn for `everything` and for nothing else.
 *      Picking one suite is a different claim from taking the whole ecosystem,
 *      and a line from a single card to the bar asserts a relationship that is
 *      not being made.
 *
 * Rule 2 is checked at the SOURCE, because it is a wiring fact: the prop must
 * come from the frame state, never from the card's own selection. That is
 * exactly the kind of thing a later "simplification" collapses back into one
 * boolean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lib = readFileSync('src/lib/workspaceSuites.ts', 'utf8');
const chooser = readFileSync('src/components/onboarding/WorkspaceChooser.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const suiteIds = [...lib.matchAll(/^\s{4}id: '([a-z]+)',/gm)].map((m) => m[1]);

test('the parse found the suites — this gate can fail', () => {
  assert.ok(suiteIds.length >= 4, `parsed ${suiteIds.length} suite ids — the matcher is stale`);
});

test('the set helpers exist and are exported', () => {
  for (const fn of ['parseWorkspace', 'serializeWorkspace', 'isEverything']) {
    // A plain includes() — no regex, so escaping cannot break it.
    //
    // This line previously used a template literal with a word-boundary
    // escape. In a template that escape is a literal BACKSPACE character,
    // so the pattern stopped matching and the gate reported the function as
    // MISSING when it was exported — a red that sends you to the wrong file.
    // Second time that trap has bitten in this repo today.
    assert.ok(lib.includes(`export function ${fn}(`), `${fn} is not exported`);
  }
});

test('selecting every suite collapses to the canonical everything value', () => {
  // The rule stated in code: all of them serialises to EVERYTHING_ID, so the
  // two routes cannot diverge.
  assert.match(
    lib, /if \(picked\.length === known\.length\) return EVERYTHING_ID;/,
    'serializeWorkspace does not collapse a full set to EVERYTHING_ID — selecting ' +
    'all four by hand would store a different value from pressing the bar',
  );
});

test('unknown ids are dropped when parsing', () => {
  // A suite removed from the catalog must not keep a stored selection alive
  // that nothing can render.
  assert.match(lib, /filter\(\(v\) => known\.has\(v\)\)/, 'parseWorkspace does not drop unknown ids');
});

test('the connector is driven by the FRAME state, not by card selection', () => {
  assert.match(
    chooser, /connected=\{framed\}/,
    'the connector prop is not bound to `framed` — a single selected card would ' +
    'draw a line to the bar, claiming a relationship that was not chosen',
  );
  assert.doesNotMatch(
    chooser, /connected=\{selected\}|connected=\{picked\./,
    'the connector is bound to selection — it must follow the everything state only',
  );
});

test('the card keeps selection and connection as separate props', () => {
  // Collapsing them back into one boolean is the regression this guards.
  assert.match(chooser, /selected=\{picked\.includes\(suite\.id\)\}/, 'cards do not select from the set');
  assert.match(chooser, /connected: boolean;/, 'SuiteCard no longer takes a distinct `connected`');
});
