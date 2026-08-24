/*
 * Find block comments that JSX renders as literal TEXT, and fail the build on them.
 *
 * This exists because it shipped. Six `Stays hand-written` comments rendered as visible paragraphs
 * down the chat sidebar, between the nav rows, in the running app — and every gate was green while
 * they did. `check:names` reads identifiers, the chat suite asserts on controls that were all still
 * there, and the probes measure elements; none of them can see a comment that became a text node.
 *
 * The trap is that the SAME syntax is right and wrong depending only on what precedes it:
 *
 *   {cond && (
 *     /* correct — this is a JS expression slot, and `{...}` here would be an empty object *\/
 *     <Thing />
 *   )}
 *
 *   </button>
 *   /* WRONG — this is JSX children, where anything not an element or a `{}` container is TEXT *\/
 *   <button>
 *
 * §5.4b of CHAT-ELEMENTS-SPEC.md tells you to un-brace a comment after `{cond && (`. Applying that
 * advice one line too far, in children position, is exactly how the six were made. So the rule cannot
 * be "always brace" or "never brace" — it has to be decided per site, which is what this checks.
 *
 * The classification is the character before the comment:
 *   `(` `{` `,` `=>` `&&` `?` `:`  -> expression slot, a bare comment is correct
 *   `>` (a closing tag) or `}` (the end of an expression container) -> children, it leaks
 *
 * and then a confirmation that an element FOLLOWS, so a bare comment after a helper function's
 * closing brace is not reported.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '*.tsx', '*.jsx'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/* Walk the source rather than regex it, so `/*` inside a string or a template literal is not read as
   the start of a comment. That mistake is the same family as the bug being hunted. */
function blockComments(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      out.push([start, (i += 2)]);
      continue;
    }
    i++;
  }
  return out;
}

const leaked = [];
for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  for (const [start, end] of blockComments(src)) {
    let j = start - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0 || (src[j] !== '>' && src[j] !== '}')) continue;

    let k = end;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== '<') continue;

    leaked.push({
      file,
      line: src.slice(0, start).split('\n').length,
      text: src.slice(start, end).replace(/\s+/g, ' ').slice(0, 64),
    });
  }
}

if (!leaked.length) {
  console.log(`check-jsx-comments: ${files.length} files, no comment renders as text`);
  process.exit(0);
}

console.error(`check-jsx-comments: ${leaked.length} comment(s) render as visible text\n`);
for (const l of leaked) console.error(`  ${l.file}:${l.line}  ${l.text}`);
console.error('\nEach of these is a paragraph on screen. Wrap it: /* … */  ->  {/* … */}');
console.error('Do NOT wrap a comment sitting directly after `{cond && (` — there it is correct bare,');
console.error('and bracing it makes an empty object literal. See spec §5.4b.');
process.exit(1);
