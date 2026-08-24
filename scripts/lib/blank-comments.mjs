/*
 * Blank out comment BODIES, keeping the source's exact length so every index still lines up.
 *
 * This exists because three separate measurements in this repo counted their own prose, each in a way
 * that looked like a result:
 *
 *   - `probe-dead-hooks` read the `Unread on purpose` reasons as CONSUMERS of the hooks they named,
 *     so writing down that three hooks were unread reported that none of them were.
 *   - `probe-open-findings` retired a finding the moment the finding was written out.
 *   - `spec-status` counted `<Switch>` inside `Stays hand-written` reasons — reasons whose whole job
 *     is to explain why the control is NOT a Switch. It reported 4 adopted where 1 exists, and the
 *     more carefully those reasons were written, the higher the adoption number climbed.
 *
 * The common shape: a codebase that explains itself in prose will have its prose counted by anything
 * naive enough to grep. A mention is not a use.
 *
 * Strings are walked rather than regexed past, so a `/*` inside a string literal is not read as the
 * start of a comment — the same mistake one level down.
 *
 * NOTE the deliberate limit: this is for counting DECLARATIONS and USES, where a false positive is a
 * wrong number. It is not safe for deciding whether an IMPORT is dead — `spec-status` documents why a
 * string/comment scanner is worse than the bug there, because JSX text is full of apostrophes and a
 * scanner opens a string on "What's new" and blanks the code after it.
 */
export function blankComments(src) {
  const out = src.split('');
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
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const block = src[i + 1] === '*';
      const start = i;
      i += 2;
      while (i < src.length && (block ? !(src[i] === '*' && src[i + 1] === '/') : src[i] !== '\n')) i++;
      if (block) i += 2;
      for (let k = start; k < Math.min(i, src.length); k++) if (out[k] !== '\n') out[k] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/*
 * Count JSX USES of a component in one source.
 *
 * The lookahead is the other half of the same lesson. `src.split('<' + name)` collides on PREFIX:
 * `<Tab` matches `<Tabs` and would match `<Table`, and `Tab` read 5 with two call sites on screen.
 * Every name on the board is one shared prefix away from that. Requiring whitespace, `/` or `>` after
 * the name ends the tag properly, and both self-closing and multi-line opens survive it.
 */
export function countUses(src, name) {
  return (blankComments(src).match(new RegExp(`<${name}(?=[\\s/>])`, 'g')) ?? []).length;
}
