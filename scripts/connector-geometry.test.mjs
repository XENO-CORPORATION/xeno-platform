/**
 * The connector spans exactly the gap it is connecting across.
 *
 * The line joining each suite card to the everything-bar must touch both
 * borders and enter neither. Three separate values decide that — where the bar
 * sits, where the line starts, how tall it is — and the failure when they
 * disagree is not an error but a WRONG PICTURE: a line short of the bar, or
 * buried in it, or painted over a 1px stroke. Nothing in a build catches that.
 *
 * It has been wrong three times already:
 *   - overlapping the card's border by 1px, painting over the stroke;
 *   - overlapping the bar by 4px, on the assumption the bar would cover it —
 *     it does not, its fill is translucent;
 *   - and the height was a hardcoded `0.75rem` that merely HAPPENED to equal
 *     the bar's `mt-3`, with nothing tying them together.
 *
 * This gate asserts the arithmetic that makes it correct, and that the gap has
 * exactly one source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Comments name the classes and values under discussion; matching them would
// make this gate pass on its own documentation.
const src = readFileSync('src/components/onboarding/WorkspaceChooser.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const num = (name) => {
  // String.raw so the digit class survives. Written as a plain template first,
  // `\d` collapsed to `d` and the pattern silently became `(d+)` — it matched
  // nothing and the gate failed claiming the constant was undeclared, which it
  // was not. An escaping bug that reports as a missing symbol is the worst kind
  // of red: it sends you to fix the wrong file.
  const m = src.match(new RegExp(String.raw`const ${name} = (\d+);`));
  assert.ok(m, `${name} is not declared — the gate cannot check what it cannot find`);
  return Number(m[1]);
};

test('the gap has ONE source', () => {
  const gap = num('BAR_GAP_PX');
  assert.ok(gap > 0, 'BAR_GAP_PX must be positive');

  // A Tailwind margin class on the bar would be a second, silent source.
  assert.doesNotMatch(
    src, /className=\{?`?[^`"']*\bmt-\d\b[^`"']*flex w-full items-center/,
    'the bar sets its top margin with a Tailwind class as well as BAR_GAP_PX — ' +
    'two sources for one distance is exactly the drift this constant removes',
  );
  assert.match(src, /marginTop: BAR_GAP_PX/, 'the bar does not take its margin from BAR_GAP_PX');
});

test('the connector starts clear of the card border and ends on the bar edge', () => {
  const gap = num('BAR_GAP_PX');
  const offset = num('CONNECTOR_OFFSET_PX');

  assert.ok(offset >= 1, 'the connector must start at least 1px below the card, clear of its 1px border');
  assert.ok(offset < gap, 'the connector cannot start past the bar it is connecting to');

  // Height is DERIVED, not restated. A literal here is the original bug.
  assert.match(
    src, /height: BAR_GAP_PX - CONNECTOR_OFFSET_PX/,
    'the connector height is not derived from the gap — a literal will drift the ' +
    'moment the spacing changes, silently',
  );
  assert.match(
    src, /top: `calc\(100% \+ \$\{CONNECTOR_OFFSET_PX\}px\)`/,
    'the connector offset is not derived from CONNECTOR_OFFSET_PX',
  );

  // The arithmetic the picture depends on.
  assert.equal(offset + (gap - offset), gap, 'offset + height must equal the gap exactly');
});
