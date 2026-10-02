/**
 * Math in model replies — the one setup every chat renderer uses.
 *
 * Models write math the way ChatGPT and Claude render it: `$\rightarrow$`, `$E = mc^2$`, `\(x\)`,
 * `\[ … \]`, `$$ … $$`. The main chat rendered none of it (2026-10-02: "$\rightarrow$" showed as raw
 * source in a reply), while the PDF and Word chats rendered it with remark-math's DEFAULT settings,
 * where any single `$` opens math — so "costs $5 and $10" there turned "5 and " into a formula.
 *
 * Both are fixed by one rule applied before parsing (`normalizeChatMath`): a single `$…$` is math only
 * when it is written like math, and every other `$` is a plain dollar sign. The rule is Pandoc's,
 * tightened so a stray dollar cannot pair with a distant one:
 *   - the opening `$` is followed by a non-space character;
 *   - the NEXT unescaped single `$` closes it — it is preceded by a non-space character and is not
 *     followed by a digit — and no blank line comes between them;
 *   - otherwise the opening `$` is literal.
 * `\(…\)` and `\[…\]` become `$…$` / `$$…$$`. Fenced code and inline code are never touched — a `$`
 * in `echo $HOME` is code, and an escape added there would be shown to the reader.
 */
import type { Pluggable } from 'unified';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** remark-math with single-dollar math ON — safe only because `normalizeChatMath` ran first. */
export const remarkChatMath: Pluggable = [remarkMath, { singleDollarTextMath: true }];

/**
 * KaTeX never throws on a malformed formula (a half-streamed `$\frac{1}{` is a normal state), and
 * `trust` stays false, so `\href`/`\url`/`\htmlId` cannot turn model output into links or attributes.
 */
export const rehypeChatKatex: Pluggable = [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }];

const FENCE = /^(\s{0,3})(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;
const HOLD = '\u0000';

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isEscaped = (s: string, i: number) => {
  let n = 0;
  for (let k = i - 1; k >= 0 && s[k] === '\\'; k -= 1) n += 1;
  return n % 2 === 1;
};

/** The single-dollar pass over prose with code spans already held out. */
function escapeLoneDollars(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '$' || isEscaped(s, i)) { out += ch; i += 1; continue; }
    if (s[i + 1] === '$') {
      // `$$ … $$`: display math. Copy through to its closer, untouched; an unclosed one (mid-stream)
      // is left for remark-math, which closes it at the end of the reply.
      const close = s.indexOf('$$', i + 2);
      const end = close === -1 ? s.length : close + 2;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    // A single `$`. It opens math only if a valid closer is the very next single `$`.
    let closer = -1;
    if (!isSpace(s[i + 1])) {
      for (let j = i + 1; j < s.length; j += 1) {
        if (s[j] === '\n' && /^\n[ \t]*\n/.test(s.slice(j))) break; // a blank line ends the paragraph
        if (s[j] !== '$' || isEscaped(s, j)) continue;
        if (s[j + 1] === '$') break; // a `$$` is not a single-dollar closer
        if (!isSpace(s[j - 1]) && !/[0-9]/.test(s[j + 1] ?? '')) closer = j;
        break; // the NEXT dollar decides — it never skips ahead to a later one
      }
    }
    // A dollar directly followed by a digit is a price far more often than a formula ("$10 and x$"
    // pairs `$10 … x$` by the rule above). It opens math only if what it encloses looks like math.
    if (closer !== -1 && /[0-9]/.test(s[i + 1]) && !/[\\^_{}=+\-*/<>]/.test(s.slice(i + 1, closer))) closer = -1;
    if (closer === -1) { out += '\\$'; i += 1; continue; }
    out += s.slice(i, closer + 1);
    i = closer + 1;
  }
  return out;
}

function normalizeProse(block: string): string {
  const held: string[] = [];
  let s = block.replace(CODE_SPAN, (m) => { held.push(m); return `${HOLD}${held.length - 1}${HOLD}`; });
  // \[ … \] → display math: its own `$$` lines when it stands on its own lines, inline otherwise.
  s = s.replace(/(^|[^\\])\\\[([\s\S]+?)\\\]/g, (m, pre: string, inner: string, offset: number, all: string) => {
    const start = offset + pre.length;
    const lineStart = all.lastIndexOf('\n', start - 1) + 1;
    const indent = all.slice(lineStart, start);
    const after = all.slice(offset + m.length);
    if (/^[ \t]*$/.test(indent) && /^[ \t]*(\n|$)/.test(after)) {
      return `${pre}$$\n${indent}${inner.trim()}\n${indent}$$`;
    }
    return `${pre}$$${inner.trim()}$$`;
  });
  // \( … \) → inline math. Trimmed, so the dollar rule below always accepts it.
  s = s.replace(/(^|[^\\])\\\(([\s\S]+?)\\\)/g, (_m, pre: string, inner: string) => `${pre}$${inner.trim()}$`);
  s = escapeLoneDollars(s);
  return s.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_m, n: string) => held[Number(n)]);
}

const cache = new Map<string, string>();

/** Prepare a reply's markdown so math renders and money stays money. Pure; cached per string. */
export function normalizeChatMath(markdown: string): string {
  if (!markdown || !/[$\\]/.test(markdown)) return markdown;
  const hit = cache.get(markdown);
  if (hit !== undefined) return hit;

  const lines = markdown.split('\n');
  const parts: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => { if (prose.length) { parts.push(normalizeProse(prose.join('\n'))); prose = []; } };
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (fence) {
      parts.push(line);
      if (m && m[2][0] === fence[0] && m[2].length >= fence.length && line.trim() === m[2]) fence = null;
      continue;
    }
    if (m) { flush(); fence = m[2]; parts.push(line); continue; }
    prose.push(line);
  }
  flush();
  const result = parts.join('\n');

  if (cache.size > 500) cache.clear();
  cache.set(markdown, result);
  return result;
}
