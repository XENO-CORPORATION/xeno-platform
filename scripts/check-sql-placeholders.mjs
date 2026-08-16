#!/usr/bin/env node
/**
 * Every `$n` you pass to Postgres must appear in the SQL.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Postgres cannot infer the type of a parameter the statement never references,
 * so a query whose params array is longer than its placeholder usage fails to
 * PREPARE — always, not sometimes:
 *
 *     error: could not determine data type of parameter $1
 *
 * Nothing in a normal toolchain sees it. It is not a syntax error, not a type
 * error, not a lint error. It is not wrong until Postgres is asked to plan the
 * statement, which means it is invisible until the code path actually runs.
 *
 * That is exactly why it shipped TWICE in this repo in one week:
 *
 *   getDigest    three statements shared one params array; the state-based one
 *                never referenced $1, so EVERY digest call threw. Unnoticed
 *                because the table had zero rows.
 *   resolveFlag  a `flagId` left in the array after the query was widened. NO
 *                MODERATOR COULD EVER RESOLVE A FLAG. Unnoticed because the
 *                `moderator` role is held by nobody.
 *
 * It appears when a query is EDITED, not written: a `WHERE id = $1` is dropped
 * and the params array keeps its first element. The diff reads as a
 * simplification.
 *
 * ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * Only calls it can resolve with certainty: a template-literal or plain-string
 * SQL argument with NO `${…}` interpolation, plus a literal array of params. A
 * query assembled from interpolated fragments can carry placeholders this
 * script cannot see, and guessing there would produce false positives — which
 * is how a gate gets muted and then deleted.
 *
 * Those are REPORTED as skipped, with a count. A number you can watch is worth
 * more than a silent omission: if it climbs, the checkable surface is shrinking.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src', 'server');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/**
 * Split a literal array's top-level elements.
 *
 * Written by hand rather than with a regex because a params array routinely
 * contains nested calls, objects, ternaries and strings holding commas —
 * `[a, f(b, c), x ? 'y,z' : w]` is three elements, and a regex says five.
 */
export function topLevelCount(src) {
  let depth = 0;
  let quote = null;
  let current = '';
  const segments = [];

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      current += c;
      if (c === '\\') { current += src[i + 1] || ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    // 🔴 COMMENTS FIRST. This codebase annotates params heavily, and prose
    // contains commas — "…never written, so 160 rows carry no address" counts
    // as a separator to a naive scanner and invents an element out of thin air.
    // That produced the checker's SECOND round of false positives, after the
    // trailing-comma round.
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; current += c; continue; }
    if ('([{'.includes(c)) { depth += 1; current += c; continue; }
    if (')]}'.includes(c)) { depth -= 1; current += c; continue; }
    if (c === ',' && depth === 0) { segments.push(current); current = ''; continue; }
    current += c;
  }
  segments.push(current);

  // 🔴 COUNT ELEMENTS, NOT SEPARATORS. The first version returned
  // `commas + 1`, which is wrong for the trailing comma this codebase uses
  // everywhere — and it produced NINE false positives on its first run, every
  // one of them claiming the LAST parameter was unused.
  //
  // That uniform shape is what gave it away: nine unrelated files failing
  // identically is a property of the checker, not of the code. A gate whose
  // first run cries wolf gets muted, then deleted, and the bug it existed for
  // ships again.
  return segments.filter((s) => s.trim().length > 0).length;
}

/** Find `.query(<sql>, [<params>])` calls and return the raw pieces. */
export function findQueries(src) {
  const out = [];
  const re = /\.query\(\s*(`|')/g;
  let m;
  while ((m = re.exec(src))) {
    const openQuote = m[1];
    let i = m.index + m[0].length;
    let sql = '';
    // Read the SQL literal.
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === '\\') { sql += src[i + 1] || ''; i += 1; continue; }
      if (c === openQuote) break;
      sql += c;
    }
    i += 1;
    // Expect `, [ … ]`
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== ',') continue;
    i += 1;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== '[') continue;

    let depth = 0;
    let quote = null;
    const start = i + 1;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if ('([{'.includes(c)) { depth += 1; continue; }
      if (')]}'.includes(c)) {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const params = src.slice(start, i);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ sql, params, line, interpolated: openQuote === '`' && /\$\{/.test(sql) });
  }
  return out;
}

/*
 * ⚠️ ENTRY GUARD — the scan runs only when this file is EXECUTED.
 *
 * Without it, a test that imports `topLevelCount` would walk the whole server
 * tree as a side effect of the import. Harmless here because the scan is
 * read-only, but the repo's ABSOLUTE RULE §2b exists because importing a module
 * to "check" it once executed a publisher and destroyed four products' release
 * history. The guard is one line; the habit is the point.
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

function main() {
const files = walk(ROOT);
const problems = [];
let checked = 0;
let skipped = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('.query(')) continue;

  for (const q of findQueries(src)) {
    if (q.interpolated) { skipped += 1; continue; }

    const count = topLevelCount(q.params);
    if (!count) { skipped += 1; continue; }
    checked += 1;

    const used = new Set([...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    const unused = [];
    for (let n = 1; n <= count; n += 1) if (!used.has(n)) unused.push(`$${n}`);

    // The other direction is a different, louder failure ("bind message
    // supplies N parameters") but it is the same authoring mistake, so report it.
    const missing = [...used].filter((n) => n > count).map((n) => `$${n}`);

    if (unused.length || missing.length) {
      problems.push({
        file: relative(join(__dirname, '..'), file),
        line: q.line,
        count,
        unused,
        missing,
        snippet: q.sql.trim().replace(/\s+/g, ' ').slice(0, 96),
      });
    }
  }
}

console.log(`sql placeholder check — ${checked} resolvable queries, ${skipped} skipped (interpolated or non-literal params)\n`);

for (const p of problems) {
  console.log(`  ${p.file}:${p.line}`);
  if (p.unused.length) {
    console.log(`    passes ${p.count} params, never references ${p.unused.join(', ')}`);
    console.log('    → Postgres cannot infer the type: this statement throws on EVERY call.');
  }
  if (p.missing.length) {
    console.log(`    references ${p.missing.join(', ')} but only ${p.count} params are passed`);
  }
  console.log(`    ${p.snippet}…\n`);
}

if (problems.length) {
  console.log(`${problems.length} broken quer${problems.length === 1 ? 'y' : 'ies'}.`);
  process.exit(1);
}
console.log('Every passed parameter is referenced.');
}
