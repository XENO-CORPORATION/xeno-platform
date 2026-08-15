/**
 * WP9 (the achievable half) — search recall.
 *
 * MEASURED BEFORE BUILDING, against the live corpus. Six realistic phrasings of
 * one known thread:
 *
 *   before: 2/6   only near-exact wording — the literal title, and "BGRA"
 *   after:  6/6   and the right thread ranks FIRST in every one
 *
 * `plainto_tsquery` ANDs every term, so "colors look inverted after paste"
 * required all four words present. Loop A's whole value is that the next
 * agent's search HITS; it was missing two thirds of realistic phrasings.
 *
 * ⚠️ WP9 as specified wants pgvector. `vector` is NOT in pg_available_extensions
 * on this image (PostgreSQL 15.17, Alpine) — an infrastructure blocker, recorded
 * rather than worked around. pg_trgm was available and buys most of the recall
 * without an embedding pipeline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', 'server', ...p);
const SERVICE = readFileSync(src('services', 'forumService.js'), 'utf8');
const MIG = readFileSync(
  src('database', 'migrations', '20260816140000-forum-trigram-search.sql'), 'utf8');
const fn = (() => {
  const s = SERVICE.slice(SERVICE.indexOf('export async function searchThreads'));
  const next = s.indexOf('\nexport ');
  return next === -1 ? s : s.slice(0, next);
})();

test('the extension and its index are created by a migration', () => {
  assert.match(MIG, /CREATE EXTENSION IF NOT EXISTS pg_trgm/,
    'similarity() without the extension is a runtime error on every search.');
  assert.match(MIG, /USING gin \(title gin_trgm_ops\)/,
    'an unindexed trigram scan on every search is a sequential scan wearing a feature name.');
});

test('an AND match still exists — recall did not replace precision', () => {
  assert.match(fn, /plainto_tsquery\('english', \$1\) AS q_and/,
    'the all-terms-present tier must remain.');
  assert.match(fn, /q_and IS NOT NULL AND t\.search_vector @@ tsq\.q_and/);
});

test('🔴 an EXACT match must outrank a fuzzy one', () => {
  // This is the property that keeps recall from destroying precision. If the
  // trigram tier could outscore an all-terms title match, every search would
  // start returning the thread with the most similar-looking title rather than
  // the one that actually contains the words.
  const weight = (label) => {
    const m = fn.match(new RegExp(`${label}[^*]*\\* ([0-9.]+)`));
    return m ? Number(m[1]) : null;
  };
  const andTitle = weight('ts_rank\\(t\\.search_vector, tsq\\.q_and\\)');
  const andPost = weight('ts_rank\\(p\\.search_vector, tsq\\.q_and\\)');
  const orTitle = weight('ts_rank\\(t\\.search_vector, tsq\\.q_or\\)');
  const trgm = weight('similarity\\(t\\.title, \\$1\\)');

  assert.ok(andTitle && andPost && orTitle && trgm, 'all four tiers must be weighted');
  assert.ok(andTitle > andPost, `title AND (${andTitle}) must beat post AND (${andPost})`);
  assert.ok(andPost > orTitle, `AND (${andPost}) must beat OR (${orTitle})`);
  assert.ok(andTitle > trgm, `an exact title match (${andTitle}) must beat trigram (${trgm})`);
});

test('an OR tier exists — this is what fixed the paraphrases', () => {
  // "colors look inverted after paste" needed all four words under AND.
  assert.match(fn, /q_or/, 'there must be an any-term tier.');
  assert.match(fn, /replace\(plainto_tsquery\('english', \$1\)::text, ' & ', ' \| '\)::tsquery/,
    'the OR query must be derived from the same normalised terms, not re-parsed.');
});

test('trigram matching is on the TITLE only', () => {
  // A title is the one sentence written to be recognised. Trigram-matching
  // whole bodies returns threads because two long posts share common
  // substrings — noise wearing the costume of recall.
  assert.match(fn, /similarity\(t\.title, \$1\)/, 'title similarity must be used.');
  assert.doesNotMatch(fn, /similarity\(p\.body/,
    'body similarity would match on shared substrings, not shared meaning.');
});

test('the similarity threshold is explicit and lower than the default', () => {
  // pg_trgm defaults to 0.3, which a short query against a long title rarely
  // reaches even when it is obviously the right thread.
  const m = fn.match(/similarity\(t\.title, \$1\) > ([0-9.]+)/);
  assert.ok(m, 'the threshold must be stated in the query, not left to the GUC.');
  const threshold = Number(m[1]);
  assert.ok(threshold > 0 && threshold < 0.3,
    `threshold ${threshold} should sit below the 0.3 default but above zero`);
});

test('an empty query returns nothing rather than everything', () => {
  assert.match(fn, /if \(!q\) return \[\]/,
    'an empty search must not degrade into "select all ranked by nothing".');
});
