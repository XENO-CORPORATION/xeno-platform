/**
 * A ratchet on native browser dialogs. The count may fall. It may never rise.
 *
 * `confirm`, `prompt` and `alert` block the whole renderer, cannot be styled,
 * cannot be themed, announce "this is a web page" in a product that is trying not
 * to look like one, and on a destructive action give the reader a browser chrome
 * they have been trained to dismiss without reading.
 *
 * This is a RATCHET rather than a ban because there are 106 of them across 45
 * files, and a ban would either fail on day one or need an allowlist — and an
 * allowlist is where the next one goes to be forgotten. A ceiling that only ever
 * decreases converts a large cleanup into a monotone one: every commit is free to
 * lower it, none can raise it, and nobody has to finish the job in one go.
 *
 * They split into two pieces of work, and only one of them is mechanical:
 *
 *   confirm (29) + prompt (12) — a decision the user makes. ActionDialog already
 *   covers both shapes, so these are conversions.
 *
 *   alert (65) — a notification. There is no toast/notification primitive in
 *   @xenosystem/elements-react, so these need a shared control built first.
 *   Converting them one-by-one into bespoke local banners is how 47 files end up
 *   with 47 different error styles.
 *
 * Lower a ceiling in the same commit that removes the calls. Do not lower one
 * speculatively — a ceiling below the real count fails the next honest commit and
 * teaches people to edit the number instead of reading it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/*
 * Measured 2026-09-10. Every reduction is a real conversion; lower these then.
 * `_old_backup` trees are excluded — they are dead code kept for reference, and
 * counting them would make the ratchet move when somebody deletes a corpse.
 */
const CEILING = { confirm: 29, prompt: 12, alert: 65 };

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === '_old_backup') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip comments and strings so a mention is never miscounted as a call. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function countCalls(kind) {
  // A call, not a property access and not an identifier that merely ends in the
  // word — `showAlert(`, `this.confirm(` and `toast.alert(` are all somebody
  // else's function.
  const pattern = new RegExp(`(^|[^.\\w$])(?:window\\s*\\.\\s*)?${kind}\\s*\\(`, 'g');
  const perFile = new Map();
  let total = 0;
  for (const file of sourceFiles(SRC)) {
    const hits = (code(fs.readFileSync(file, 'utf8')).match(pattern) || []).length;
    if (hits) { perFile.set(path.relative(ROOT, file), hits); total += hits; }
  }
  return { total, perFile };
}

for (const [kind, ceiling] of Object.entries(CEILING)) {
  test(`native ${kind}() never increases (ceiling ${ceiling})`, () => {
    const { total, perFile } = countCalls(kind);
    if (total > ceiling) {
      const worst = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([file, n]) => `  ${n}  ${file}`).join('\n');
      assert.fail(`native ${kind}() went from ${ceiling} to ${total}.\n`
        + `Use ActionDialog for a decision; do not add a new browser dialog.\n${worst}`);
    }
    assert.ok(total <= ceiling,
      `${kind}: ${total} (ceiling ${ceiling}${total < ceiling ? ' — lower it in this commit' : ''})`);
  });
}

test('the ratchet is measuring something, not passing on an empty scan', () => {
  // A glob that matches nothing reads exactly like a clean repo. This is the
  // control: if the scanner breaks, this fails rather than reporting success.
  const files = sourceFiles(SRC);
  assert.ok(files.length > 300, `expected the whole src tree, scanned ${files.length} files`);
  const { total } = countCalls('alert');
  assert.ok(total > 0, 'zero alerts found — the scanner is broken, not the codebase clean');
});

test('comments and strings are not counted as calls', () => {
  const sample = code(`
    // window.confirm('nope')
    /* confirm('nope') */
    const message = "confirm('nope')";
    const other = \`alert('nope')\`;
    confirm('yes');
  `);
  const hits = (sample.match(/(^|[^.\w$])(?:window\s*\.\s*)?confirm\s*\(/g) || []).length;
  assert.equal(hits, 1, 'only the real call should count');
});

test('ActionDialog is the sanctioned replacement and covers both decision shapes', () => {
  const dialog = fs.readFileSync(path.join(SRC, 'components/platform/ActionDialog.tsx'), 'utf8');
  assert.match(dialog, /fieldLabel/, 'a text answer — the prompt() replacement');
  assert.match(dialog, /choices/, 'a closed set of answers — a radio group, not a native select');
  assert.match(dialog, /dismissDisabled=\{pending\}/, 'it cannot be dismissed mid-request');
  assert.doesNotMatch(code(dialog), /(^|[^.\w$])(?:window\s*\.\s*)?(confirm|prompt|alert)\s*\(/,
    'the replacement must not itself reach for a browser dialog');
});
