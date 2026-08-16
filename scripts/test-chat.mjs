/**
 * Run every chat test, and tell new breakage apart from breakage that was already there.
 *
 * Why this exists: six of the ten `test-chat-*.mjs` were failing and nobody knew, because nothing
 * runs them but a person who thinks to. Four of the six were caused by the element adoption itself —
 * conversions that dropped a `data-` hook a test reached for, and a `<style>` block that moved to its
 * own file while the tests kept reading the old one. Each failure had been sitting there for days,
 * with a green build the whole time. A check nobody runs is not a check.
 *
 * The BASELINE is the part that makes this usable. A runner that just reports "3 failing" gets muted
 * within a week, because three failures you have already decided about look exactly like a fourth
 * you have not. So the known ones are named here with what is wrong with them, and the run is green
 * while the set matches. Two things turn it red:
 *
 *   - a test that fails and is NOT on the list — new breakage, which is the whole point;
 *   - a test on the list that PASSES — the list is stale, and the entry has to go.
 *
 * That second rule is what stops this from rotting into a permanent excuse list.
 *
 *   node scripts/test-chat.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Known-red, with the reason and whose it is. Every one of these is a test asserting on a shape the
 * composer had before `3d27aef` ("streaming answers, thinking status, and composer polish") — they
 * slice ChatWithLLM.tsx between literal source markers, and that pass moved the markers. None of
 * them is element-adoption damage, which is why they are recorded rather than quietly fixed: what
 * the composer should look like now is the author's call, not a conversion pass's.
 */
const KNOWN_RED = new Map([
  [
    'test-chat-send-button-layout.mjs',
    'slices the source at `{isLoading ?`, which the composer-polish pass (3d27aef) removed',
  ],
  [
    'test-chat-token-counter-layout.mjs',
    'same marker, same pass — its `controlsEnd` is `{isLoading ?`',
  ],
  [
    'test-chat-voice-controls.mjs',
    'the hold-to-record thumb was retimed and resized in the same pass (14px travel -> 12px, thumb 2.5 -> 3 when active); the class-string assertions never followed',
  ],
]);

const tests = readdirSync(HERE)
  .filter((f) => /^test-chat-.*\.mjs$/.test(f))
  .sort();

const failed = [];
const passed = [];
for (const file of tests) {
  try {
    execFileSync(process.execPath, [path.join(HERE, file)], { stdio: 'ignore' });
    passed.push(file);
  } catch {
    failed.push(file);
  }
}

const surprises = failed.filter((f) => !KNOWN_RED.has(f));
const recovered = [...KNOWN_RED.keys()].filter((f) => passed.includes(f));

for (const f of tests) {
  const mark = passed.includes(f) ? (KNOWN_RED.has(f) ? 'FIXED' : 'pass ') : KNOWN_RED.has(f) ? 'known' : 'FAIL ';
  console.log(`  ${mark}  ${f}`);
}

console.log(`\n${passed.length}/${tests.length} passing, ${KNOWN_RED.size} known-red.`);

if (surprises.length) {
  console.error(`\n${surprises.length} test(s) failing that were not expected to:\n`);
  for (const f of surprises) console.error(`  ${f}`);
  console.error('\nRun it directly for the assertion. If a conversion moved a hook, put it back —');
  console.error('four have been lost that way. If it asserts the OLD mechanism, move the assertion');
  console.error('to the new one rather than deleting it (spec §5.5).');
}
if (recovered.length) {
  console.error(`\n${recovered.length} test(s) on the known-red list now PASS — remove them from KNOWN_RED:\n`);
  for (const f of recovered) console.error(`  ${f}  (recorded as: ${KNOWN_RED.get(f)})`);
}
process.exit(surprises.length || recovered.length ? 1 : 0);
