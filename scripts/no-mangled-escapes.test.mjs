/**
 * NO CONTROL CHARACTERS IN SOURCE.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `compliance-preflight.mjs` checked the Impressum for a VAT id with
 *
 *     /\b(DE|ATU|FR|NL|IT|ES|PL)[0-9A-Z]{8,12}\b/
 *
 * except the two `\b` were not word boundaries. They were literal BACKSPACE
 * bytes (U+0008), written by a scripted edit that passed the string through
 * Python — where "\b" is chr(8), not backslash-b.
 *
 * 🔴 In a JS regex a bare 0x08 matches a backspace CHARACTER. Source text never
 * contains one, so the pattern could not match ANY VAT number. The check was
 * dead from the day it was written, and it failed in the direction that looks
 * like diligence: it reported "VAT number is APPLIED FOR" against a page
 * carrying a valid, VIES-verified id.
 *
 * ── WHY A GATE AND NOT CARE ─────────────────────────────────────────────────
 *
 * This is the third escape-collapse in a single session, each in a different
 * disguise: a replacement that silently became a no-op, a `\s` inside a template
 * literal that became a plain "s", and this. Care did not prevent any of them,
 * because the corrupted file LOOKS correct — an editor renders U+0008 as
 * nothing, and `sed` prints it invisibly. Only `od`, or a check like this one,
 * can see it.
 *
 * The general rule: any tool that processes escapes (Python, bash heredocs,
 * `node -e`) can eat a backslash on its way into a file. Prefer the Edit tool or
 * raw strings for anything containing a regex, and sweep afterwards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* The code points a scripted edit produces by accident, and what each one was
 * almost certainly meant to be. TAB, LF and CR are excluded — those are real. */
const MANGLED = new Map([
  [0x08, String.raw`\b`],
  [0x0b, String.raw`\v`],
  [0x0c, String.raw`\f`],
  [0x07, String.raw`\a`],
  [0x1b, String.raw`\e or an ANSI colour escape`],
  [0x00, 'a NUL — almost certainly a truncated write'],
]);

const ROOTS = ['scripts', 'src'];
const EXT = /\.(mjs|js|jsx|ts|tsx|sql|json|css)$/;
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

test('🔴 no source file carries a mangled escape', () => {
  const findings = [];
  for (const file of ROOTS.flatMap((r) => [...walk(r)])) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const [code, meant] of MANGLED) {
      let idx = text.indexOf(String.fromCharCode(code));
      while (idx !== -1) {
        const line = text.slice(0, idx).split('\n').length;
        findings.push(`${file}:${line} U+${code.toString(16).padStart(4, '0')} — almost certainly ${meant}`);
        idx = text.indexOf(String.fromCharCode(code), idx + 1);
      }
    }
  }
  assert.deepEqual(findings, [],
    `control characters in source:\n  ${findings.join('\n  ')}\n`
    + 'These are never intentional. Rewrite the string without passing it through an\n'
    + 'escape-processing tool (Python, a bash heredoc, node -e), then read the file back.');
});

test('the sweeper can actually see one', () => {
  /* 🔴 A detector that has never detected anything is indistinguishable from one
   * that cannot. The whole defect above was a check that could not fire, so this
   * file proves its own instrument on a synthetic string before trusting it on
   * the tree. */
  const poisoned = `if (/${String.fromCharCode(8)}(DE)[0-9]{8}/.test(x))`;
  const hits = [...MANGLED.keys()].filter((c) => poisoned.includes(String.fromCharCode(c)));
  assert.deepEqual(hits, [0x08], 'the detector does not recognise a mangled \\b');

  /* And does NOT fire on the legitimate whitespace that fills every file. */
  const clean = 'const a = 1;\n\tconst b = 2;\r\n';
  assert.equal([...MANGLED.keys()].filter((c) => clean.includes(String.fromCharCode(c))).length, 0,
    'the detector flags ordinary tabs or newlines — it would be unusable');
});

test('the VAT check is a real regex, not a backspace', () => {
  /* The specific line that was dead, asserted specifically. The sweep above
   * covers the class; this covers the instance, because this one is a compliance
   * check whose silent failure produced a WRONG legal statement. */
  const pre = readFileSync('scripts/compliance-preflight.mjs', 'utf8');
  const m = pre.match(/const VAT_ID = (\/.+\/);/);
  assert.ok(m, 'the VAT id pattern is gone or no longer named');
  assert.ok(!m[1].includes(String.fromCharCode(8)), 'the VAT regex contains a literal backspace again');

  /* Behavioural: build it and check it matches a real id and rejects prose. */
  const re = new RegExp(m[1].slice(1, -1));
  assert.ok(re.test('USt-IdNr: DE463398455'), 'the VAT regex no longer matches a real German VAT id');
  assert.ok(!re.test('Umsatzsteuer-Identifikationsnummer ist beantragt'),
    'the VAT regex matches prose — it would report an id that does not exist');
});
