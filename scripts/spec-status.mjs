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

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHAT = path.join(ROOT, 'src', 'components', 'playground', 'Chat');
const files = readdirSync(CHAT).filter((f) => f.endsWith('.tsx')).map((f) => path.join(CHAT, f));

const BACKSLASH = String.fromCharCode(92);

/** End of the opening tag that starts at `from`, skipping strings and nested braces. */
function tagEnd(s, from) {
  let i = from, depth = 0, quote = null;
  while (i < s.length) {
    const c = s[i];
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

function buttonsIn(file) {
  const src = readFileSync(file, 'utf8');
  const expand = expander(src);
  const out = [];
  let i = 0;
  for (;;) {
    i = src.indexOf('<button', i);
    if (i < 0) break;
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

const count = (needle) => files.reduce((n, f) => n + readFileSync(f, 'utf8').split(needle).length - 1, 0);

/* ── --file ─────────────────────────────────────────────────────────────────────────────────── */
const fileArg = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : null;
if (fileArg) {
  const target = files.find((f) => path.basename(f, '.tsx').toLowerCase() === fileArg.toLowerCase().replace(/\.tsx$/, ''));
  if (!target) {
    console.error(`no such chat file: ${fileArg}`);
    process.exit(1);
  }
  const rows = buttonsIn(target);
  console.log(`${path.basename(target)} — ${rows.length} hand-written button(s)\n`);
  for (const r of rows) {
    console.log(`  L${String(r.line).padEnd(6)} ${r.kind.padEnd(10)} ${r.glyphs.padEnd(20)} text=${r.text.padEnd(20)} h=${r.h.padEnd(3)} pad=${r.pad.padEnd(4)} ${r.cls}`);
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
      const live = names.filter((n) => new RegExp(`\\b${n.split(' as ').pop()}\\b`).test(rest));
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
const per = files.map((f) => ({ name: path.basename(f), rows: buttonsIn(f) })).filter((x) => x.rows.length);
per.sort((a, b) => a.rows.length - b.rows.length);

const kinds = { 'icon-only': 0, labelled: 0, mixed: 0 };
for (const { rows } of per) for (const r of rows) kinds[r.kind] += 1;
const totalButtons = kinds['icon-only'] + kinds.labelled + kinds.mixed;

console.log(`BUTTONS still hand-written: ${totalButtons}`);
console.log(`  icon-only ${kinds['icon-only']}   labelled ${kinds.labelled}   mixed ${kinds.mixed}\n`);
console.log('  work the smallest first:');
for (const { name, rows } of per) console.log(`    ${name.padEnd(30)} ${rows.length}`);

console.log(`\nFIELDS: <input> ${count('<input')}   <textarea> ${count('<textarea')}`);
console.log('  (2 file pickers, 2 range sliders and 2 composer textareas are excluded — see spec §7)');

console.log('\nADOPTED:');
for (const c of ['IconButton', 'MenuItem', 'Button', 'Spinner', 'TextInput', 'MessageBubble', 'Switch']) {
  console.log(`  ${c.padEnd(16)} ${count('<' + c)}`);
}
console.log(`\nNext: node scripts/spec-status.mjs --file ${path.basename(per[0]?.name ?? '', '.tsx')}`);
