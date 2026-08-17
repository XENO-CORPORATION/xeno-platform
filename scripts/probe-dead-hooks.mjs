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
import { blankComments } from './lib/blank-comments.mjs';

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

/*
 * Blank out comment BODIES before counting references, keeping the file's length so every index still
 * lines up.
 *
 * Same principle as excluding `probe-open-findings.mjs` above, and it bit in the same way: the moment
 * a `Unread on purpose` reason was written beside the three state hooks, naming them in prose, the
 * count read them as referenced and the bucket emptied — 3 to 0, by writing the sentence that says
 * they are unread. A mention in a comment is not a consumer. It cannot break if the hook goes.
 */
const raw = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const texts = new Map([...raw].map(([f, t]) => [f, blankComments(t)]));

/*
 * A third bucket, for the same reason §3 and §7 have one: a count of what is left to DECIDE is a
 * finish line, and a count of what exists is not.
 *
 * `Unread on purpose` beside a declaration is the hook's version of `Stays hand-written`. Both of the
 * answers this probe used to force — give it a consumer, or delete it — turned out to be wrong for
 * all three of the state hooks it was reporting, and a bucket that cannot hold the right answer just
 * keeps the number up forever.
 *
 * The window is generous (1500 chars) because these reasons sit above the enclosing `return (` or
 * `const x = (`, never in attribute position — putting one there parses as a spread (§5.4b). One
 * consequence is that a reason naming two adjacent hooks documents both. That is intended where the
 * reason says so, and it is the reason's job to say so.
 */
const MARKER = 'Unread on purpose';
const REASON_WINDOW = 1500;

/* Declarations only: `data-foo` written as a JSX attribute, not inside a selector or a string. */
const declared = new Map();
const computed = new Set();
const documented = new Set();
for (const f of readdirSync(CHAT).filter((x) => x.endsWith('.tsx'))) {
  /* Declarations come from the BLANKED text, so a `data-foo` written inside a comment is not mistaken
     for one; the reason lives in a comment, so its window has to come from the RAW text. `blankComments`
     preserves length precisely so one index serves both. */
  const src = texts.get(path.join(CHAT, f)) ?? blankComments(readFileSync(path.join(CHAT, f), 'utf8'));
  const rawSrc = raw.get(path.join(CHAT, f)) ?? readFileSync(path.join(CHAT, f), 'utf8');
  for (const m of src.matchAll(/^\s*(data-[a-z0-9-]+)(=\{|="|\s*$)/gm)) {
    if (!declared.has(m[1])) declared.set(m[1], []);
    declared.get(m[1]).push(f);
    /* `=\{` means an expression: the value is recomputed on every render. That is the difference
       between a hook that WAITS to be selected and one that is doing work nobody collects. */
    if (m[2] === '={') computed.add(m[1]);
    if (rawSrc.slice(Math.max(0, m.index - REASON_WINDOW), m.index).includes(MARKER)) documented.add(m[1]);
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
const explained = states.filter((d) => documented.has(d.hook));
const open = states.filter((d) => !documented.has(d.hook));
for (const d of explained) console.log(`    ${d.hook.padEnd(36)} ${d.declaredIn.padEnd(24)} Unread on purpose`);
for (const d of open) console.log(`    ${d.hook.padEnd(36)} ${d.declaredIn.padEnd(24)} no reason written`);
console.log(`\n  STILL TO DECIDE — no reason written: ${open.length}`);
console.log('\nNeither list is a delete order. A hook can be read through a string built at runtime,');
console.log('which no grep sees — and four hooks were lost the other way round (spec §5.5).');
