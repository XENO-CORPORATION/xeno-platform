/**
 * The de-index is a DEPLOYED STATE, and it was protected by comments.
 *
 * `CLAUDE.md` says plainly that a routine deploy can silently undo it, and names
 * the three mechanisms. Two of them had no gate at all:
 *
 *   ✅ signup closed .......... gated by `registration-gate.test.mjs`
 *   ❌ `X-Robots-Tag: noindex`  a comment in nginx/default.conf
 *   ❌ no sitemap ............. a comment in prerender-products.mjs
 *
 * This closes the other two. Written 2026-08-16 while adding `/terms` and
 * `/privacy` to the prerender — a change that touches the exact file holding one
 * of them, which is precisely when an unguarded rule gets lost.
 *
 * ── THE TWO TRAPS THIS ENCODES ──────────────────────────────────────────────
 *
 * 🔴 nginx DROPS every inherited `add_header` in any block that declares one of
 * its own. The server-level `X-Robots-Tag` is therefore NOT enough: each
 * `location` that adds any header must repeat it, or the noindex silently
 * vanishes for whatever that block serves — and Google indexes images
 * independently of the page they appear on.
 *
 * 🔴 `Disallow: /` DOES NOT DE-INDEX. It blocks the crawl, so the crawler never
 * fetches the page and never sees the `noindex` — and URLs already indexed
 * strand as bare links with no snippet. The header must be reachable. This is
 * the mistake the robots.txt comment exists to prevent, and it is the one a
 * well-meaning person makes first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(__dirname, '..', ...p);

const NGINX = readFileSync(root('nginx', 'default.conf'), 'utf8');
const ROBOTS = readFileSync(root('public', 'robots.txt'), 'utf8');
const PRERENDER = readFileSync(root('scripts', 'prerender-products.mjs'), 'utf8');

const NOINDEX = /add_header\s+X-Robots-Tag\s+"noindex, nofollow, noarchive"\s+always;/;

test('🔴 the noindex header is set at server level', () => {
  assert.match(NGINX, NOINDEX,
    'the site is deliberately de-indexed — see CLAUDE.md §🔒');
});

test('🔴 …and repeated in EVERY location block that declares its own headers', () => {
  // nginx drops all inherited add_header in a block that declares one. A block
  // with its own Cache-Control and no X-Robots-Tag serves indexable assets.
  const blocks = [...NGINX.matchAll(/location\s+([^{]+)\{([\s\S]*?)\n    \}/g)];
  assert.ok(blocks.length >= 4, `only ${blocks.length} location blocks parsed — the parser, not the config`);

  const leaking = [];
  for (const [, selector, body] of blocks) {
    if (!/add_header/.test(body)) continue;      // inherits everything — fine
    if (/proxy_pass/.test(body)) continue;       // an API/WS upstream, not a page
    if (!NOINDEX.test(body)) leaking.push(selector.trim().slice(0, 46));
  }
  assert.deepEqual(leaking, [],
    'These blocks declare their own add_header, which makes nginx DROP the inherited '
    + 'X-Robots-Tag — so whatever they serve becomes indexable. Repeat the header inside each.');
});

test('robots.txt must NOT block the crawl', () => {
  // Blocking the crawl is how a de-index fails: the crawler cannot fetch the
  // page, so it never sees the noindex, and indexed URLs strand.
  const rules = ROBOTS.split('\n').filter((l) => !l.trim().startsWith('#'));
  assert.ok(!rules.some((l) => /^\s*Disallow:\s*\/\s*$/.test(l)),
    'Disallow: / blocks the crawl, so Googlebot never sees the noindex header. '
    + 'Header first; Disallow only after the pages have dropped out of the index.');
  assert.ok(rules.some((l) => /^\s*Allow:\s*\/\s*$/.test(l)),
    'crawling must stay allowed while the de-index is in progress');
});

test('no sitemap is generated, and a stale one is removed', () => {
  // A sitemap is an active invitation: it hands a crawler every URL and a fresh
  // lastmod, while we are asking to be removed.
  assert.doesNotMatch(PRERENDER, /^\s*writeFileSync\(join\(DIST, 'sitemap\.xml'\)/m,
    'sitemap generation is disabled while the site is de-indexed');
  assert.match(PRERENDER, /rmSync|unlinkSync/,
    'a sitemap.xml left in dist/ by an earlier build must be REMOVED, or a stale one ships forever');
  assert.doesNotMatch(ROBOTS.replace(/^#.*$/gm, ''), /Sitemap:/,
    'robots.txt must not advertise a sitemap that does not exist');
  assert.match(NGINX, /location\s*=\s*\/sitemap\.xml\s*{\s*return\s+404;/s,
    'the SPA catch-all must not answer the disabled sitemap route with index.html and HTTP 200');
});

test('the legal pages are prerendered — metadata only, and that is stated', () => {
  // Added in the same change as this gate. `/terms` and `/privacy` had the SPA's
  // generic title and no canonical, for the two pages whose whole job is to be
  // the published record of a promise.
  assert.match(PRERENDER, /\['terms', 'Terms of Service'/, '/terms must be prerendered');
  assert.match(PRERENDER, /\['privacy', 'Privacy Policy'/, '/privacy must be prerendered');
  // 🔴 And the limit must stay documented: this injects HEAD metadata only. The
  // body still hydrates client-side, so the promise TEXT is not in the HTML.
  // "Prerendered" reads as "the text is there", and here it is not.
  assert.match(PRERENDER, /HEAD metadata only/,
    'the metadata-only limit must stay written down, or someone will cite these pages as archived text');
});
