/**
 * WP10 — the product-page forum widget.
 *
 * ⚠️ Source gates: the component is .tsx and node --test cannot import it.
 * They pin the decisions that are cheap to reverse and expensive to notice —
 * chiefly the one that keeps a young forum from advertising itself as dead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const W = codeOnly(read('components', 'product', 'ForumThreadsWidget.tsx'));
const PAGE = codeOnly(read('pages', 'ProductPage.tsx'));

test('the widget is RENDERED by the product page, not just written', () => {
  assert.match(PAGE, /import ForumThreadsWidget from '\.\.\/components\/product\/ForumThreadsWidget'/);
  assert.match(PAGE, /<ForumThreadsWidget slug=\{product\.slug\} \/>/,
    'an unrendered component is a file, not a feature — the defect this repo has '
    + 'shipped nine times.');
});

test('🔴 it renders NOTHING when the product has no threads', () => {
  // Not an empty "Community" heading, not a "no discussions yet" placeholder.
  // An empty section on a product page advertises a dead forum to the exact
  // audience you least want to tell — the same mistake D12 exists to prevent,
  // one level down.
  assert.match(W, /if \(!threads\?\.length\) return null;/,
    'no threads must mean no section at all.');
});

test('...and no loading skeleton either', () => {
  // A placeholder that resolves to nothing is a layout shift announcing an
  // absence. `threads === null` (not yet loaded) hits the same early return.
  assert.doesNotMatch(W, /Skeleton|animate-pulse|Loading\.\.\./,
    'a skeleton that resolves to nothing is worse than nothing.');
});

test('a forum outage cannot break a product page', () => {
  // The product page sells the product. It must not show an error box because
  // an unrelated service is down.
  assert.match(W, /\.catch\(\(\) => \{ if \(!cancelled\) setThreads\(\[\]\); \}\)/,
    'a failed fetch must degrade to "no section", never to an error.');
  assert.match(W, /r\.ok \? r\.json\(\) : null/,
    'a non-200 must be treated as no data rather than parsed as JSON.');
});

test('it scopes to THIS product', () => {
  // A widget showing every thread on every product page is a firehose that
  // makes the relevant one harder to find.
  // ⚠️ Scoped to the FETCH. The first version matched the string anywhere, and
  // the "Open the forum →" link contains an identical `tag=...product:${slug}`
  // — so removing the filter from the fetch left the gate green while every
  // product page showed every product's threads. Fifth gate in this work broken
  // by asserting a string exists SOMEWHERE rather than in the place that matters.
  const fetchCall = W.slice(W.indexOf('fetch(`/api/forum/threads'));
  assert.match(fetchCall.slice(0, 160), /tag=\$\{encodeURIComponent\(`product:\$\{slug\}`\)\}/,
    'the FETCH must filter by the product tag, and encode it.');
});

test('🔴 it shows RESOLUTION state, never popularity', () => {
  // The product pages inherit the Forum's rule (§5.4). What a reader deciding
  // whether to trust a product needs is whether problems have answers — not how
  // much attention they attracted.
  assert.match(W, /isResolved \|\| t\.status === 'resolved'/, 'resolution must drive the icon.');
  const forbidden = /viewCount|views|score|upvote|likes|popularity|trending/i;
  assert.doesNotMatch(W, forbidden,
    'no popularity signal may appear on a product page either.');
});

test('the fetch is cancelled on unmount', () => {
  // Navigating away from a product page mid-request must not set state on a
  // dead component.
  assert.match(W, /let cancelled = false;/);
  assert.match(W, /return \(\) => \{ cancelled = true; \};/);
});
