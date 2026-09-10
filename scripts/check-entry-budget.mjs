#!/usr/bin/env node
/**
 * A ratchet on the entry chunk — the JavaScript every first-time visitor
 * downloads before anything renders. The budget may fall. It may never rise.
 *
 * It runs as part of `npm run build`, immediately after `vite build`, because
 * that is the only place the OUTCOME exists. A source-level rule ("these routes
 * must be lazy") is a MECHANISM, and this workspace has already shipped a gate
 * that pinned a mechanism while the mechanism itself was the bug. What matters
 * is the number of bytes that reach a browser, so that is what is measured, on
 * the artifact that will be served.
 *
 * WHY IT EXISTS — the regression it is built to catch has already happened here,
 * and it happened without anyone doing anything careless:
 *
 *   `ProductLanding` needed one boolean — does this product have documentation? —
 *   and asked `getProductDocs(slug)` for it. That import pulls the docs registry,
 *   which imports all sixteen `src/content/docs/*.ts` modules, so ~500 KB of
 *   prose landed on the most-visited route on the site to evaluate a `!!`.
 *   Separately, the docs and forum routes were eager, which put katex (~600 KB),
 *   parse5 (~273 KB, via rehype-raw), react-syntax-highlighter and the whole
 *   unified/micromark/mdast pipeline into the homepage bundle — about 1.5 MB of
 *   markdown toolchain reachable from no page a visitor lands on.
 *
 *   Nothing failed. The site was correct, every test was green, and the only
 *   symptom was a number nobody was looking at. That is precisely the shape a
 *   budget catches and a unit test cannot.
 *
 * Deferring `/` itself is NOT how to satisfy this. The homepage is the route a
 * first-time visitor actually lands on; making it lazy trades a smaller download
 * for a blank frame plus a second round trip, which is worse on exactly the
 * connection this exists to help. Lower the budget by removing work, not by
 * moving the landing route behind a spinner.
 *
 * `node scripts/entry-chunk-inventory.mjs` answers "what is in there?" when this
 * fails — per-module bytes, grouped by package, measured rather than guessed.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/*
 * Measured 2026-09-10 against a real production build: 1,444,418 raw /
 * 366,151 gzip, down from 2,993,308 / ~1.0 MB. The headroom is deliberate but
 * small — enough that an ordinary feature does not trip it, far too little to
 * absorb another library. Lower these in the same commit that earns it.
 */
const BUDGET = { raw: 1_600_000, gzip: 400_000 };

const DIST = path.resolve(process.argv[2] || 'dist');
const INDEX = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error(`[entry-budget] no build at ${DIST} — run this after \`vite build\`, not instead of it.`);
  process.exitCode = 1;
} else {
  const html = fs.readFileSync(INDEX, 'utf8');

  /* The entry is the module script the shell loads. Read it out of the emitted
   * HTML rather than globbing for the largest chunk: "largest" is a guess that
   * silently starts measuring a lazy chunk the moment one overtakes the entry,
   * and would then pass while the real entry grew. */
  const entries = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  if (entries.length !== 1) {
    console.error(`[entry-budget] expected exactly one module entry in index.html, found ${entries.length}: `
      + `${entries.join(', ') || '(none)'}. The shell changed shape; update this check deliberately.`);
    process.exitCode = 1;
  } else {
    const file = path.join(DIST, entries[0].replace(/^\//, ''));
    if (!fs.existsSync(file)) {
      console.error(`[entry-budget] index.html names ${entries[0]} and it is not in the build.`);
      process.exitCode = 1;
    } else {
      const bytes = fs.readFileSync(file);
      const raw = bytes.length;
      const gzip = zlib.gzipSync(bytes, { level: 9 }).length;
      const pct = (n, of) => `${((n / of) * 100).toFixed(1)}%`;

      const over = [];
      if (raw > BUDGET.raw) over.push(`raw ${raw.toLocaleString()} > ${BUDGET.raw.toLocaleString()}`);
      if (gzip > BUDGET.gzip) over.push(`gzip ${gzip.toLocaleString()} > ${BUDGET.gzip.toLocaleString()}`);

      if (over.length) {
        console.error(`\n[entry-budget] the entry chunk grew past its budget:\n  ${over.join('\n  ')}\n`
          + `  entry: ${entries[0]}\n\n`
          + `Something now reaches the first paint that did not before. Find out what with:\n`
          + `  node scripts/entry-chunk-inventory.mjs\n\n`
          + `Usually it is an import added for one small value that drags a whole module graph`
          + ` behind it, or a route that stopped being lazy. Raise the budget only when the`
          + ` growth is genuinely required at first paint — never to get a build green.\n`);
        process.exitCode = 1;
      } else {
        console.log(`[entry-budget] entry ${entries[0]}: `
          + `${raw.toLocaleString()} raw (${pct(raw, BUDGET.raw)} of budget), `
          + `${gzip.toLocaleString()} gzip (${pct(gzip, BUDGET.gzip)})`);
        if (raw < BUDGET.raw * 0.85 && gzip < BUDGET.gzip * 0.85) {
          console.log('[entry-budget] comfortably under — consider lowering the budget in this commit.');
        }
      }
    }
  }
}
