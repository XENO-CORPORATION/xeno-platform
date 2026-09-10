/**
 * A ratchet on native browser dialogs. The count may fall. It may never rise.
 *
 * `confirm`, `prompt` and `alert` block the whole renderer, cannot be styled,
 * cannot be themed, announce "this is a web page" in a product that is trying not
 * to look like one, and on a destructive action give the reader a browser chrome
 * they have been trained to dismiss without reading.
 *
 * It began as a RATCHET rather than a ban, because there were 106 of them across
 * 47 files and a ban would have failed on day one or needed an allowlist — and an
 * allowlist is where the next one goes to be forgotten. A ceiling that only ever
 * decreases converts a large cleanup into a monotone one.
 *
 * ✅ It reached zero on 2026-09-10, so it is now a ban in effect. The ratchet
 * shape is kept rather than rewritten as a flat assertion: the ceilings document
 * what the numbers were, and a future addition fails against 0 exactly as it
 * would against any other number.
 *
 * They were two pieces of work, and only one was mechanical:
 *
 *   confirm (29) + prompt (12) — a decision. Converted via confirmAction() /
 *   promptAction(), which preserve the guard shape (`if (!await confirmAction(…))
 *   return;`) so each site stayed a one-line change. TypeScript found every
 *   enclosing function that needed `async`: `await` outside one is a compile
 *   error, so the compiler was the checker rather than a reviewer's eye.
 *
 *   alert (0) — DONE 2026-09-10. A notification, not a decision. sonner was
 *   already a dependency and Pricing.tsx already called toast.error, and no
 *   <Toaster/> was mounted anywhere, so that call rendered nothing. Mounting one
 *   (src/components/platform/Notifications.tsx) fixed a silent failure on the
 *   payment path and gave all 65 somewhere to go.
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
const CEILING = { confirm: 0, prompt: 0, alert: 0 };

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

/**
 * Strip comments, strings and JSX text so a mention is never miscounted as a call.
 *
 * The JSX pass earns its place: the last "remaining" prompt in the codebase was
 * the sentence "How closely to follow the prompt (higher values = more faithful)"
 * rendered inside a <p>. That is text, not code, and without this the ratchet
 * would have had to carry a ceiling of 1 forever — a ceiling with room in it,
 * which is the one thing a ratchet must not have.
 *
 * The pattern deliberately refuses to span braces, so `{prompt(...)}` — an actual
 * expression embedded in JSX — is NOT masked. Only literal text is.
 */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/>[^<>{}]*</g, (m) => '>' + ' '.repeat(m.length - 2) + '<');
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
  /* Every ceiling is now zero, so "a real instance still exists" can no longer be
   * the control — that check chased alert to zero, then confirm to zero, and would
   * have had to be deleted. The durable control has two halves that do not depend
   * on the codebase being dirty:
   *
   *   1. the scan reaches the tree at all (a glob matching nothing reads exactly
   *      like a clean repo), and
   *   2. the detector still fires on a KNOWN call, proved against a fixture. */
  const files = sourceFiles(SRC);
  assert.ok(files.length > 300, `expected the whole src tree, scanned ${files.length} files`);

  const fixture = code(`
    function handler() {
      if (confirm('really?')) doThing();
      const name = window.prompt('Name');
      alert('done');
    }
  `);
  for (const kind of ['confirm', 'prompt', 'alert']) {
    const pattern = new RegExp(`(^|[^.\\w$])(?:window\\s*\\.\\s*)?${kind}\\s*\\(`, 'g');
    assert.equal((fixture.match(pattern) || []).length, 1,
      `the detector no longer finds a real ${kind}() call — the scanner is broken, not the codebase clean`);
  }
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

test('the notification surface is mounted in EVERY shell, not just one', () => {
  /* App.tsx returns from two places: a standalone chat shell and the full
   * application. A Toaster in one of them fails silently in the other, and
   * "silently" is the whole problem — that is exactly how Hub's unsigned badge
   * came to be shown to the wrong half of its audience.
   *
   * There was no Toaster in either until 2026-09-10, so Pricing.tsx's
   * toast.error('Could not start checkout') rendered nothing at all. */
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  const mounts = (app.match(/<PlatformNotifications\s*\/>/g) || []).length;
  const returns = (app.match(/^\s*return \(\s*$/gm) || []).length;
  assert.ok(returns >= 2, `expected App to render from more than one branch, found ${returns}`);
  assert.equal(mounts, returns,
    `PlatformNotifications is mounted ${mounts} times for ${returns} render branches — `
    + 'a notification surface missing from one shell fails silently in that shell');

  const surface = fs.readFileSync(path.join(SRC, 'components/platform/Notifications.tsx'), 'utf8');
  assert.match(surface, /usePlatformTheme/,
    'it must follow the platform theme, not next-themes — that reads a Next.js '
    + "library's idea of 'system' in a Vite app and drifts from every other surface");
  assert.match(surface, /closeButton/, 'an error the reader cannot dismiss is a nuisance');
  assert.doesNotMatch(code(surface), /(^|[^.\w$])(?:window\s*\.\s*)?(confirm|prompt|alert)\s*\(/,
    'the replacement must not itself reach for a browser dialog');
});

test('ActionDialog is the sanctioned replacement and covers both decision shapes', () => {
  const dialog = fs.readFileSync(path.join(SRC, 'components/platform/ActionDialog.tsx'), 'utf8');
  assert.match(dialog, /fieldLabel/, 'a text answer — the prompt() replacement');
  assert.match(dialog, /choices/, 'a closed set of answers — a radio group, not a native select');
  assert.match(dialog, /dismissDisabled=\{pending\}/, 'it cannot be dismissed mid-request');
  assert.doesNotMatch(code(dialog), /(^|[^.\w$])(?:window\s*\.\s*)?(confirm|prompt|alert)\s*\(/,
    'the replacement must not itself reach for a browser dialog');
});
