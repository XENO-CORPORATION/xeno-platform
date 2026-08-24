/**
 * Where the chat's element adoption stands — the measurement `CHAT-ELEMENTS-SPEC.md` runs on.
 *
 * The spec is written for an agent with no memory of the last iteration, so it never says "continue
 * where you left off". It says "measure, then work the smallest file". This is the measuring.
 *
 *   node scripts/spec-status.mjs                    # counts, per file, and what is adopted
 *   node scripts/spec-status.mjs --file ChatShareModal
 *   node scripts/spec-status.mjs --dead-imports [--fix]
 *
 * Reads with a brace-aware scanner rather than a regex, because a JSX attribute can contain `>`
 * inside an expression and a naive `<button ... >` match ends the tag in the wrong place — which is
 * how a conversion pass once swallowed half a handler.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countUses } from './lib/blank-comments.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHAT = path.join(ROOT, 'src', 'components', 'playground', 'Chat');
const files = readdirSync(CHAT).filter((f) => f.endsWith('.tsx')).map((f) => path.join(CHAT, f));

const BACKSLASH = String.fromCharCode(92);

/**
 * End of the opening tag that starts at `from`, skipping strings, comments and nested braces.
 *
 * Comments matter because JSX allows one BETWEEN attributes, and English inside it is full of
 * apostrophes. Without this, one `it is` inside an in-tag comment opened a string the scanner never
 * closed, `tagEnd` ran past the real tag, and the board quietly lost THIRTY buttons — a measurement
 * that would have told the loop it was nearly finished. An undercount is the worst direction for
 * this tool to be wrong in, so the scanner reads comments rather than trusting nobody writes one
 * there.
 */
function tagEnd(s, from) {
  let i = from, depth = 0, quote = null;
  while (i < s.length) {
    const c = s[i];
    if (!quote && c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (!quote && c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (quote) {
      if (c === BACKSLASH) i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === '>' && depth === 0) return i;
    i += 1;
  }
  return -1;
}

/** Expand a file's own `const X = '…'` class strings into a className that interpolates them. */
function expander(src) {
  const consts = {};
  for (const m of src.matchAll(/const (\w+) *=\s*'([^']*)'/g)) consts[m[1]] = m[2];
  return (text) => {
    for (let pass = 0; pass < 3; pass += 1) {
      const before = text;
      for (const [k, v] of Object.entries(consts)) text = text.split('${' + k + '}').join(v);
      if (text === before) break;
    }
    return text;
  };
}

/**
 * Does a comment sitting immediately above this button explain why it is NOT a component?
 *
 * Without this the board cannot tell "nobody has looked at it yet" from "someone looked, decided, and
 * wrote down why" — so an agent with no memory of the last iteration picks the same finished file
 * again, re-derives the same two exclusions, and the loop never advances. Spec §10 makes the comment
 * the actual finish line ("nothing is hand-written by accident"), which only works if the measurement
 * can see one.
 *
 * The marker is the phrase, not the presence of a comment: plenty of buttons carry a comment about
 * something else entirely.
 */
const MARKER = 'Stays hand-written';
function documentedAbove(src, at, inComment = () => false) {
  /*
   * Looks for the PHRASE in the window above, not for a comment glued to the tag.
   *
   * The first version required the text immediately before `<button` to end in a block-comment
   * close, and it found one marker out of six: a reason written above a `return (`, or above a
   * `{cond && (`, or as a line comment, all read as undocumented. Worse than not detecting — the board
   * then keeps offering a finished file as the smallest one left, which is the exact loop this was
   * added to break.
   *
   * The guard against a comment being claimed by the wrong button is that no OTHER `<button` may
   * stand between the phrase and this one.
   */
  /* Wide enough for a reason that needed measurements in it. What prevents a comment being claimed
     by the wrong control is the `<button` guard below, not a short window — a small window only
     loses long reasons, which are the ones most worth keeping. */
  const from = Math.max(0, at - 4000);
  const before = src.slice(from, at);
  const marker = before.lastIndexOf(MARKER);
  if (marker < 0) return false;
  /* Only a REAL button breaks the chain. Several of these reasons quote the markup they replaced —
     "it renders as a `<button>` the moment it takes an onSelect" — and counting that as an
     intervening control made a documented row read as undecided. */
  for (let k = before.indexOf('<button', marker); k >= 0; k = before.indexOf('<button', k + 7)) {
    if (!inComment(from + k)) return false;
  }
  return true;
}

/**
 * The ranges covered by block comments, so a `<button>` written INSIDE one is not counted as a
 * button. It happens: several reasons in this chat quote the markup they replaced — "Was a `<ul>` of
 * `<li><button>`" — and the board read two of those as controls still to decide.
 *
 * Block comments only. A line comment cannot be found without lexing strings, and the attempt at that
 * is what once opened a string on the apostrophe in "What's new" and lost thirty buttons. `/*` does
 * not occur inside ordinary prose or a URL, where `//` does.
 */
function blockComments(src) {
  const ranges = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf('/*', i);
    if (open < 0) break;
    const close = src.indexOf('*/', open + 2);
    const end = close < 0 ? src.length : close + 2;
    ranges.push([open, end]);
    i = end;
  }
  return ranges;
}

/*
 * §7's fields, split the way §3's buttons are. A raw `<input` count cannot say whether §7 is
 * finished: it counts a decided field and an untouched one the same, so the number sat at 15 through
 * an iteration that decided five of them. Same three buckets as the buttons — excluded by kind,
 * documented, still to decide — so the board can be read for "what is left" rather than "how many
 * exist".
 *
 * `type="file"` and `type="range"` are read off the tag rather than listed by name: a hidden picker
 * and a slider are not fields `TextInput` was ever going to take, and a rule beats a hardcoded six.
 */
function fieldsIn(file) {
  const src = readFileSync(file, 'utf8');
  const comments = blockComments(src);
  const inComment = (at) => comments.some(([a, b]) => at >= a && at < b);
  const out = [];
  for (const tag of ['<input', '<textarea']) {
    let i = 0;
    for (;;) {
      i = src.indexOf(tag, i);
      if (i < 0) break;
      if (inComment(i)) {
        i += tag.length;
        continue;
      }
      const end = tagEnd(src, i + tag.length);
      if (end < 0) break;
      const attrs = src.slice(i, end);
      const type = /type="(\w+)"/.exec(attrs);
      out.push({
        line: src.slice(0, i).split('\n').length,
        kind: tag === '<input' ? 'input' : 'textarea',
        excluded: type ? type[1] === 'file' || type[1] === 'range' : false,
        documented: documentedAbove(src, i, inComment),
      });
      i = end;
    }
  }
  return out;
}

function buttonsIn(file) {
  const src = readFileSync(file, 'utf8');
  const expand = expander(src);
  const comments = blockComments(src);
  const inComment = (at) => comments.some(([a, b]) => at >= a && at < b);
  const out = [];
  let i = 0;
  for (;;) {
    i = src.indexOf('<button', i);
    if (i < 0) break;
    if (inComment(i)) {
      i += 7;
      continue;
    }
    const end = tagEnd(src, i + 7);
    if (end < 0) break;
    const close = src.indexOf('</button>', end);
    if (close < 0) break;
    const attrs = src.slice(i, end);
    const body = src.slice(end + 1, close);
    const glyphs = [...body.matchAll(/<([A-Z][A-Za-z0-9]*)\s+size=\{(\d+)\}/g)].map((m) => `${m[1]}/${m[2]}`);
    const anyGlyph = [...body.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]);
    /* A body containing `{` is an expression, and stripping it yields a plausible-looking fragment —
       that is how `{isProjectSidebarOpen` once became a label (spec §5.1). Say so instead. */
    const stripped = body.replace(/<[^>]*>/g, '').replace(/\{[^{}]*\}/g, '').trim();
    const text = body.includes('{') ? (stripped ? `EXPR ${stripped}` : 'EXPR') : stripped;
    const cls = expand([...attrs.matchAll(/className=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]).join(' '));
    const h = /\bh-(\d+)\b/.exec(cls);
    const pad = /\bp-([\d.]+)\b/.exec(cls);
    const kind = anyGlyph.length === 1 && !stripped && !body.includes('<svg') ? 'icon-only'
      : stripped ? 'labelled' : 'mixed';
    out.push({
      line: src.slice(0, i).split('\n').length,
      documented: documentedAbove(src, i, inComment),
      kind,
      glyphs: glyphs.length ? glyphs.join(',') : (anyGlyph.join(',') || '-'),
      text: text.slice(0, 18) || '-',
      h: h ? h[1] : '-',
      pad: pad ? pad[1] : '-',
      cls: cls.replace(/\s+/g, ' ').slice(0, 70),
    });
    i = close;
  }
  return out;
}

/*
 * Count JSX USES of a component, not appearances of its name.
 *
 * The plain `split('<' + name)` this used to be got two things wrong, and `Tab` surfaced both at once
 * the day it was added:
 *
 *   - it counted PROSE. A reason written beside a conversion, explaining `<Tab>` and not `<Tabs>`,
 *     added itself to the tally. That is the third time in this repo a measurement has counted the
 *     sentence describing it — the same shape as `probe-dead-hooks` reading its own reasons as
 *     consumers, and as `probe-open-findings` retiring a finding by naming it.
 *   - it collided on PREFIX. `<Tab` matches `<Tabs` and would match `<Table`; `Tab` read 5 with two
 *     call sites on screen. Every other name on the board is one shared prefix away from the same.
 *
 * So: comment bodies blanked first, then the name has to be followed by something that ends a JSX tag
 * name — whitespace, `>`, or `/`. Self-closing and multi-line opens both survive that.
 */
const countAdopted = (name) =>
  files.reduce((n, f) => n + countUses(readFileSync(f, 'utf8'), name), 0);
const count = (needle) => files.reduce((n, f) => n + readFileSync(f, 'utf8').split(needle).length - 1, 0);

/**
 * Is `name` USED in this text, as opposed to merely appearing in it?
 *
 * A plain word-boundary test gets this wrong whenever an imported name is also an English word on
 * screen: `Copy` survived a sweep because the button it used to draw is labelled `'Copy'`, so the
 * tool reported a dead import as live. `Check`, `Search`, `Share` and `Settings` are all one UI
 * string away from the same mistake.
 *
 * The fix is deliberately NOT a string/comment scanner. The first attempt was one, and it was worse
 * than the bug: JSX text is full of apostrophes — "What's new" — so the scanner opened a string at
 * the apostrophe and blanked the code that followed, reporting live imports as dead. In JSX you
 * cannot tell a quote from a punctuation mark without parsing.
 *
 * What you CAN tell is the character in front. A use is `<Name`, `{Name}`, `= Name`, `(Name` — never
 * `'Name'` and never `>Name<`. So reject a match whose neighbours are quotes, and one that follows a
 * `>`, which is JSX text. A name mentioned in a COMMENT still counts as used; that keeps a dead
 * import occasionally, which is the harmless direction to be wrong in.
 */
function isUsed(name, text) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = m.index > 0 ? text[m.index - 1] : '\n';
    const after = text[m.index + name.length] ?? '\n';
    if (before === "'" || before === '"' || before === '>') continue;
    if (after === "'" || after === '"') continue;
    return true;
  }
  return false;
}

/* ── --file ─────────────────────────────────────────────────────────────────────────────────── */
const fileArg = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : null;
if (fileArg) {
  const target = files.find((f) => path.basename(f, '.tsx').toLowerCase() === fileArg.toLowerCase().replace(/\.tsx$/, ''));
  if (!target) {
    console.error(`no such chat file: ${fileArg}`);
    process.exit(1);
  }
  const rows = buttonsIn(target);
  const open = rows.filter((r) => !r.documented);
  console.log(
    `${path.basename(target)} — ${rows.length} hand-written button(s), ${open.length} still to decide\n`,
  );
  for (const r of rows) {
    const mark = r.documented ? 'DECIDED ' : '        ';
    console.log(`  ${mark}L${String(r.line).padEnd(6)} ${r.kind.padEnd(10)} ${r.glyphs.padEnd(20)} text=${r.text.padEnd(20)} h=${r.h.padEnd(3)} pad=${r.pad.padEnd(4)} ${r.cls}`);
  }
  process.exit(0);
}

/* ── --dead-imports ─────────────────────────────────────────────────────────────────────────── */
if (process.argv.includes('--dead-imports')) {
  const fix = process.argv.includes('--fix');
  let total = 0;
  for (const f of files) {
    let src = readFileSync(f, 'utf8');
    let changed = false;
    for (const mod of ['@/lib/icons', '@xenosystem/elements-react']) {
      const re = new RegExp(`import \\{([^}]*)\\} from '${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`, 's');
      const m = re.exec(src);
      if (!m) continue;
      const names = m[1].replace(/\n/g, ' ').split(',').map((x) => x.trim()).filter(Boolean);
      const rest = src.slice(0, m.index) + src.slice(m.index + m[0].length);
      const live = names.filter((n) => isUsed(n.split(' as ').pop(), rest));
      if (live.length !== names.length) {
        total += names.length - live.length;
        console.log(`  ${path.basename(f).padEnd(28)} unused: ${names.filter((n) => !live.includes(n)).join(', ')}`);
        if (fix) {
          src = src.slice(0, m.index) + `import { ${live.join(', ')} } from '${mod}';` + src.slice(m.index + m[0].length);
          changed = true;
        }
      }
    }
    if (changed) writeFileSync(f, src, 'utf8');
  }
  console.log(total === 0 ? 'dead imports: none' : `dead imports: ${total}${fix ? ' (removed)' : ' (run with --fix)'}`);
  process.exit(0);
}

/* ── default: the status board ──────────────────────────────────────────────────────────────── */
const per = files
  .map((f) => {
    const rows = buttonsIn(f);
    return { name: path.basename(f), rows, open: rows.filter((r) => !r.documented) };
  })
  .filter((x) => x.open.length);
/* Ordered by what is left to DECIDE, not by what is left as a `<button>`. A file whose remaining
   controls all carry a reason is finished, even though its raw count never reaches zero. */
per.sort((a, b) => a.open.length - b.open.length);

const kinds = { 'icon-only': 0, labelled: 0, mixed: 0 };
let documented = 0;
for (const f of files) {
  for (const r of buttonsIn(f)) {
    if (r.documented) documented += 1;
    else kinds[r.kind] += 1;
  }
}
const totalButtons = kinds['icon-only'] + kinds.labelled + kinds.mixed;

console.log(`BUTTONS still to decide: ${totalButtons}`);
console.log(`  icon-only ${kinds['icon-only']}   labelled ${kinds.labelled}   mixed ${kinds.mixed}`);
console.log(`  (+ ${documented} hand-written on purpose, with the reason written beside them)\n`);
console.log('  work the smallest first:');
for (const { name, open, rows } of per) {
  const note = rows.length > open.length ? `  (${rows.length - open.length} decided)` : '';
  console.log(`    ${name.padEnd(30)} ${String(open.length).padEnd(4)}${note}`);
}

const fields = files.flatMap((f) => fieldsIn(f).map((r) => ({ ...r, file: path.basename(f) })));
const openFields = fields.filter((r) => !r.excluded && !r.documented);
const fieldTally = (kind) => openFields.filter((r) => r.kind === kind).length;

console.log(`FIELDS still to decide: ${openFields.length}`);
console.log(`  <input> ${fieldTally('input')}   <textarea> ${fieldTally('textarea')}`);
console.log(
  `  (+ ${fields.filter((r) => r.documented).length} decided, ` +
    `${fields.filter((r) => r.excluded).length} excluded as pickers and sliders — see spec §7)`,
);
for (const r of openFields) console.log(`    ${r.file}:${r.line}  <${r.kind}>`);

console.log('\nADOPTED:');
for (const c of ['IconButton', 'MenuItem', 'Button', 'Spinner', 'TextInput', 'MessageBubble', 'Switch', 'Tab']) {
  console.log(`  ${c.padEnd(16)} ${countAdopted(c)}`);
}
console.log(`\nNext: node scripts/spec-status.mjs --file ${path.basename(per[0]?.name ?? '', '.tsx')}`);
