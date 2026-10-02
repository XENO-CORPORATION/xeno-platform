/**
 * Tidy a model's answer (or thought) before the chat renders it — without changing what it SAYS.
 *
 * Extracted from ChatWithLLM's `cleanText` (2026-10-02), which did two damaging things to every reply:
 *   - it stripped one `*`, `**`, `_` or `__` from the very start and the very end of the whole text.
 *     An answer opening with **a bold title** lost its opening `**` and showed the closing `**` raw;
 *     an answer opening with a `*` bullet lost that bullet; one ending in bold showed a stray `**`.
 *     The "Thinking Process:" / "Final Answer:" splitters already consume the markers around their
 *     labels, so the strip removed nothing that needed removing.
 *   - it collapsed every run of 3+ newlines to 2 — inside code blocks too, so copied code changed
 *     (Python's two blank lines between functions became one).
 * Now: blank-line runs collapse only OUTSIDE fenced code, and the text is trimmed. Nothing else.
 */
const FENCE = /^(\s{0,3})(`{3,}|~{3,})/;

export function cleanAnswerText(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let blanks = 0;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[2][0] === fence[0] && m[2].length >= fence.length && line.trim() === m[2]) fence = null;
      continue;
    }
    if (m) { fence = m[2]; blanks = 0; out.push(line); continue; }
    if (line.trim() === '') {
      blanks += 1;
      if (blanks > 1) continue; // at most one blank line between prose blocks
    } else {
      blanks = 0;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}
