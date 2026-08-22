/**
 * A \uXXXX inside a JSX ATTRIBUTE is always a bug, and it is a silent one.
 *
 * A JSX attribute written with double quotes is NOT a JavaScript string - it is
 * JSX text, and it does not process JS escapes. So `title="Everything\u2019s"`
 * renders the six characters `\u2019` on the page, in a heading, in production.
 *
 * It reads as correct in the editor, survives typecheck, survives the build,
 * and is only visible to someone looking at the rendered page - which is
 * exactly the class of defect this repo keeps writing gates for. Written after
 * shipping one into the onboarding heading.
 *
 * The fix is a real character or an HTML entity (`&rsquo;`). Both work in an
 * attribute; the escape does not.
 *
 * Deliberately NOT extended to template literals or JS strings, where \uXXXX is
 * legitimate - a gate that flags correct code gets switched off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const BACKSLASH = String.fromCharCode(92);
const files = walk('src');

test('the walk found the components - this gate can fail', () => {
  assert.ok(files.length > 50, `only ${files.length} .tsx files found; the walk is broken`);
});

test('no JSX attribute carries a raw unicode escape', () => {
  // `attr="...\u2019..."` — the attribute value is JSX text, so the escape is
  // printed literally rather than decoded.
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      /* Built rather than written literally: the two characters side by side
         are an invalid escape in a JS string, and this file failed to LOAD
         because of it - which made its own mutation check report success,
         since a gate that cannot parse fails identically either way. */
      if (new RegExp('[a-zA-Z-]+="[^"]*' + BACKSLASH + 'u[0-9a-fA-F]{4}').test(line)) {
        offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(
    offenders, [],
    'a JSX attribute contains a unicode escape, which renders as those literal characters:\n  ' +
    offenders.join('\n  '),
  );
});
