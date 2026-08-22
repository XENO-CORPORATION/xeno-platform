/**
 * Arbitrary transition timings are INERT in this build. Do not use them.
 *
 * 🔴 `duration-[420ms]` and `delay-[888ms]` compile to NOTHING here. Verified
 * against the built stylesheet: it contains no `duration-[...]` or `delay-[...]`
 * selector at all, only the theme scale — while every other arbitrary value
 * from the same files (max-w-[120px], min-h-[420px], rounded-[18px],
 * transition-[flex-grow]) compiles fine. Reproduced with a plain string
 * className, so it is not a scanner problem with template literals.
 *
 * The failure is silent and specific: the class is in the markup, the element
 * still transitions, and it runs at Tailwind's DEFAULT 150ms. Nothing errors,
 * nothing warns, and the choreography is simply wrong — which is exactly how
 * eight of these survived elsewhere in this app at 220ms–900ms intended,
 * 150ms actual.
 *
 * Use an inline `style={{ transitionDuration }}` instead. It cannot be dropped
 * by a build step and it sits next to the delays it must stay proportional to.
 *
 * Scoped to the onboarding surface — the pre-existing usages elsewhere are
 * reported separately rather than being silently adopted as acceptable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/components/onboarding', 'src/components/auth'];
const FILES = ['src/pages/Onboarding.tsx', 'src/pages/ActivateAccount.tsx', 'src/pages/AuthContent.tsx'];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx?$/.test(f)) out.push(f);
  }
  return out;
}

const targets = [...ROOTS.flatMap(walk), ...FILES];

test('the scan covers something — this gate can fail', () => {
  assert.ok(targets.length >= 6, `only ${targets.length} files scanned — the walk is broken`);
});

test('no inert arbitrary transition timing classes on the onboarding surface', () => {
  const found = [];
  for (const f of targets) {
    // Strip comments: this file's own explanation names the class, and a gate
    // that its own documentation can trip is a gate that cries wolf.
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\b(duration|delay)-\[[^\]]+\]/g)) {
      found.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    found, [],
    'These compile to nothing and silently run at 150ms — use an inline ' +
    `style={{ transitionDuration }} instead:\n  ${found.join('\n  ')}`,
  );
});
