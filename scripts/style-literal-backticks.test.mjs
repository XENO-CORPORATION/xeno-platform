/**
 * No backticks inside a `<style>{`…`}</style>` template literal.
 *
 * ## Why this exists
 *
 * A JSX style block is a TEMPLATE LITERAL. A backtick inside it — even in a CSS comment — closes
 * the literal, and everything after it is parsed as JavaScript. The file does not fail subtly:
 * `tsc` reports 300+ cascading TS1005 / TS1381 errors starting at the comment, and the real cause
 * is nowhere in the message.
 *
 * 🔴 This caught me TWICE ON THE SAME DAY (2026-09-13), both times writing a CSS comment in the
 * ordinary house style — `var(--chat-muted)` in backticks, because that is how every other
 * comment in the repo quotes an identifier. Muscle memory is the whole hazard: the habit is
 * correct everywhere else in the codebase and wrong only here.
 *
 * `ChatWithLLM.tsx` already carried three hand-written "No backticks in here" warnings next to
 * the comments that had been burned before. Those warnings are advice at the point someone is
 * already reading; this is the check that runs whether or not they did.
 *
 * ⚠️ A build failure is the mildest form of this bug. The dangerous version is a backtick inside
 * a literal that still happens to PARSE — the CSS then silently contains interpolated JavaScript,
 * which is how a style block turns into an injection surface rather than a syntax error.
 *
 * Mutation-checked 2026-09-13: adding a backticked identifier to any style-literal comment fails
 * this test, naming the file and line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = walk(join(ROOT, 'src'));

test('the scan reaches real files — this gate can fail', () => {
  assert.ok(FILES.length > 50, `only ${FILES.length} tsx files scanned; the walk is broken`);
});

test('no backtick appears inside a JSX style template literal', () => {
  /*
   * 🔴 Detect the BACKTICK, not its downstream symptom.
   *
   * The first version of this test looked for CSS-shaped text AFTER the literal closed, reasoning
   * that an early close leaves the author's remaining CSS outside it. Mutation-checked by putting
   * a real backtick into a real style comment: it PASSED. The heuristic depended on what happened
   * to follow, which varies. A gate that cannot fail is decoration — so this now finds the thing
   * itself.
   *
   * The literal's true end is unknowable by regex once a stray backtick exists (that stray IS the
   * end, as far as the parser is concerned). So instead: take each `<style>{` opener, scan to the
   * matching `</style>`, and assert that the text between them contains no backtick other than
   * the two that legitimately open and close it.
   */
  const offenders = [];

  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    for (const open of [...src.matchAll(/<style[^>]*>\s*\{\s*`/g)]) {
      const bodyStart = open.index + open[0].length;
      const closeTag = src.indexOf('</style>', bodyStart);
      if (closeTag === -1) continue;

      // Everything the author intended as CSS, minus the closing "`}" that precedes </style>.
      const region = src.slice(bodyStart, closeTag);
      const lastTick = region.lastIndexOf('`');
      const body = lastTick === -1 ? region : region.slice(0, lastTick);

      for (const hit of [...body.matchAll(/`/g)]) {
        const line = src.slice(0, bodyStart + hit.index).split('\n').length;
        const context = body.slice(Math.max(0, hit.index - 45), hit.index + 45).replace(/\s+/g, ' ');
        offenders.push(`${file.replace(ROOT, '').replace(/\\/g, '/')}:${line} — …${context}…`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'A backtick inside a <style>{...}</style> template literal CLOSES it. Everything after is ' +
    'then parsed as JavaScript, producing 300+ cascading TS1005/TS1381 errors that name the ' +
    'wrong cause — and a literal that still parses silently turns CSS into interpolated JS. ' +
    'Write identifiers in those comments WITHOUT backticks. Found:\n  ' + offenders.join('\n  '),
  );
});

/*
 * ⚠️ A third test was written here and REMOVED, deliberately — the reason is worth more than
 * the test was.
 *
 * It required every file holding a style literal to carry a hand-written "No backticks" warning,
 * on the theory that a build-time check is rediscovered while a comment is read first. Then it
 * measured the blast radius: **31 files** use this pattern. Demanding the same sentence in all
 * of them makes 31 places to maintain one rule, and the copies go stale the way every propagated
 * measurement in this workspace has (the CI-status block that went wrong in fifteen repos at
 * once). The check above enforces it mechanically in one place and cannot drift.
 *
 * The warnings that DO exist stay where they are — next to comments that were actually burned,
 * which is guidance at the moment of editing rather than a policy applied by census.
 */
