/*
 * `data-` hooks in the chat that nothing references any more.
 *
 * This one is written defensively on purpose. FOUR hooks were lost during conversions — dropped from
 * markup while a test or a stylesheet still read them — and §5.5 exists because of it. The failure
 * mode of a sweep in the other direction is the same shape: delete a hook that looked unused because
 * the search was too narrow.
 *
 * So a hook counts as REFERENCED if it appears anywhere outside the attribute that declares it:
 *   - another `.tsx` (a querySelector, a `closest`, a sibling component)
 *   - any `.css` (the normalisation block, index.css, chat-theme.css)
 *   - `scripts/` (the ten chat tests read them, and that is exactly what was broken before)
 *   - `.mjs` probes, which also select on them
 *
 * Only a hook with ZERO references outside its own declaration is reported, and even then as a
 * candidate: a hook can be read by a runtime string built at the call site, which no grep sees.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHAT = path.join(ROOT, 'src/components/playground/Chat');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|mjs|js)$/.test(e)) out.push(full);
  }
  return out;
};

/*
 * `probe-open-findings.mjs` is excluded, and the distinction it forces is worth stating.
 *
 * A test or a probe that ASSERTS on a hook is a real consumer — §5.5 exists because conversions
 * dropped hooks that `scripts/test-*.mjs` was reaching for, and the tests went red. Those references
 * must count.
 *
 * But a probe that merely LISTS a hook as an open finding is not a consumer; breaking that hook would
 * not break it. Counting those references made all three unread state hooks look referenced the
 * moment the finding was written down — 3 to 0 — which would have retired the finding by observing
 * it. The observer has to be outside the population it counts.
 */
const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))]
  .filter((f) => !f.endsWith('probe-open-findings.mjs'));
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

/* Declarations only: `data-foo` written as a JSX attribute, not inside a selector or a string. */
const declared = new Map();
const computed = new Set();
for (const f of readdirSync(CHAT).filter((x) => x.endsWith('.tsx'))) {
  const src = texts.get(path.join(CHAT, f)) ?? readFileSync(path.join(CHAT, f), 'utf8');
  for (const m of src.matchAll(/^\s*(data-[a-z0-9-]+)(=\{|="|\s*$)/gm)) {
    if (!declared.has(m[1])) declared.set(m[1], []);
    declared.get(m[1]).push(f);
    /* `=\{` means an expression: the value is recomputed on every render. That is the difference
       between a hook that WAITS to be selected and one that is doing work nobody collects. */
    if (m[2] === '={') computed.add(m[1]);
  }
}

const rows = [];
for (const [hook, where] of declared) {
  let refs = 0;
  const refFiles = new Set();
  for (const [f, text] of texts) {
    for (const m of text.matchAll(new RegExp(hook.replace(/-/g, '\\-'), 'g'))) {
      /* Skip the declaration itself: `  data-foo` at the start of a line, or `data-foo=` in JSX. */
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      const isDeclaration = /^\s*$/.test(before.split('\n').pop() ?? '');
      if (isDeclaration && f.endsWith('.tsx')) continue;
      refs += 1;
      refFiles.add(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
  }
  rows.push({ hook, declaredIn: [...new Set(where)].join(','), refs, refFiles: [...refFiles], computed: computed.has(hook) });
}

const dead = rows.filter((r) => r.refs === 0).sort((a, b) => a.hook.localeCompare(b.hook));
const live = rows.filter((r) => r.refs > 0);

/*
 * Unreferenced splits into two kinds that want OPPOSITE answers, and one number hides that:
 *
 *   ANCHOR   `data-chat-share-dialog=""` — a constant, written once, there to BE selected.
 *            Unreferenced is its normal state. The ten chat tests are built on exactly this
 *            affordance in the composer, and the dialog family is the same convention waiting for
 *            the same use. Deleting these removes the thing that made the composer testable.
 *   STATE    `data-melting={isMelting ? 'true' : 'false'}` — recomputed on every render and read by
 *            nothing. It costs a DOM write per render and claims to drive something that does not
 *            exist.
 */
console.log(`data- hooks declared in the chat: ${rows.length}   referenced elsewhere: ${live.length}   unreferenced: ${dead.length}\n`);
const anchors = dead.filter((d) => !d.computed);
const states = dead.filter((d) => d.computed);
console.log(`  unreferenced ANCHORS — constant, there to be selected: ${anchors.length}`);
for (const d of anchors) console.log(`    ${d.hook.padEnd(36)} ${d.declaredIn}`);
console.log(`\n  unreferenced STATE — recomputed every render, read by nothing: ${states.length}`);
for (const d of states) console.log(`    ${d.hook.padEnd(36)} ${d.declaredIn}`);
console.log('\nNeither list is a delete order. A hook can be read through a string built at runtime,');
console.log('which no grep sees — and four hooks were lost the other way round (spec §5.5).');
