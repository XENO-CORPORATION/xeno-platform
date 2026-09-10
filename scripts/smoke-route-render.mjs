#!/usr/bin/env node
/**
 * Does a DEFERRED route actually render, and does its code arrive only when it
 * is needed?
 *
 *   npm run build
 *   npx serve -s dist -l 4173
 *   npm run smoke:route-render            # or: node scripts/smoke-route-render.mjs <base-url>
 *
 * Every other gate around the route deferrals proves something ADJACENT: that
 * App.tsx can reach a module, that the build emits a chunk, that the entry
 * chunk is under budget. None of them proves a browser gets past the Suspense
 * fallback — and a lazy route whose chunk never resolves renders a spinner
 * forever, which reads as "loading", not as "broken". It is the failure most
 * likely to reach a user and least likely to fail a test.
 *
 * So this drives the REAL built bundle from a REAL server and asserts three
 * things per route: the fallback is gone, the route's own content is on screen,
 * and — for the pair that matters — the deferred chunk is ABSENT from the
 * homepage and PRESENT on the page that needs it.
 *
 * 🔴 Asserting only one half of that pair would pass on a build where the code
 * had simply been deleted. Both halves are checked, and both were verified to
 * fail when swapped: `/` fetches exactly one chunk, and `/docs/hub` pulls
 * ProductDocs, DocsSearch, katex and the syntax-highlighter themes on demand.
 *
 * Not in the default suite: it needs a production build and a server, which the
 * default suite deliberately does not have. It belongs in a release pass, beside
 * the other smoke:* scripts.
 */
import puppeteer from 'puppeteer';

const BASE = process.argv[2] || 'http://localhost:4173';

/* Each route names a marker that the ROUTE's module produces — never something
 * the shell or the fallback could render, or the check passes on a spinner. */
const ROUTES = [
  /* The homepage is the whole point of the deferral: katex must NOT be on it.
   * The docs page is the other half — the same chunk must arrive when the route
   * that needs it is opened. Asserting only one of the two would pass on a
   * build where the code is simply gone. */
  { path: '/', marker: /XENO/i, mustNotFetch: /katex/i, note: 'homepage (eager — the control)' },
  { path: '/docs', marker: /documentation|docs/i, note: 'docs hub (deferred)' },
  { path: '/docs/hub', marker: /XENO Hub/i, mustFetch: /katex/i, note: 'product docs + markdown stack (deferred)' },
  { path: '/forum', marker: /forum/i, note: 'forum record (deferred)' },
  { path: '/marketplace', marker: /marketplace/i, note: 'marketplace (deferred)' },
  { path: '/v1', marker: /XENO/i, note: 'preserved homepage (deferred)' },
  { path: '/product/canvas', marker: /Canvas/i, note: 'product landing (eager, docs link)' },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  const errors = [];
  /* Scoped to what this check is ABOUT: a chunk that failed to load or a
   * component that threw. Serving `dist` statically means /api answers with the
   * SPA shell and R2 refuses cross-origin, so an unfiltered error list fails the
   * EAGER control too — which is how you can tell the noise is environmental
   * rather than a finding. The control is kept for exactly that reason. */
  const RELEVANT = /chunk|Loading chunk|dynamically imported module|Suspense|Cannot read|is not a function|Minified React error/i;
  const fetched = [];
  page.on('request', (r) => { if (r.url().includes('/assets/') && r.url().endsWith('.js')) fetched.push(r.url().split('/').pop()); });
  page.on('console', (m) => { if (m.type() === 'error' && RELEVANT.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (RELEVANT.test(String(e))) errors.push(String(e)); });

  let verdict = 'ok';
  try {
    await page.goto(BASE + route.path, { waitUntil: 'networkidle0', timeout: 30000 });
    // The fallback renders "Loading page". Insisting it is GONE is what
    // separates "the chunk resolved" from "the spinner is still up".
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading page') && document.body.innerText.trim().length > 40,
      { timeout: 20000 },
    );
    const text = await page.evaluate(() => document.body.innerText);
    if (!route.marker.test(text)) { verdict = `MISSING marker ${route.marker}`; failed++; }
    else if (route.mustFetch && !fetched.some((f) => route.mustFetch.test(f))) {
      verdict = `expected a chunk matching ${route.mustFetch}; fetched ${fetched.join(', ')}`; failed++;
    }
    else if (route.mustNotFetch && fetched.some((f) => route.mustNotFetch.test(f))) {
      verdict = `fetched ${route.mustNotFetch} on a route that must not need it: ${fetched.join(', ')}`; failed++;
    }
    else if (errors.length) { verdict = `console errors: ${errors.slice(0, 2).join(' | ')}`; failed++; }
    const head = text.trim().split(String.fromCharCode(10)).filter(Boolean).slice(0, 3).join(' / ').slice(0, 90);
    console.log(`${verdict === 'ok' ? 'ok  ' : 'FAIL'} ${route.path.padEnd(18)} ${text.trim().length.toString().padStart(6)} chars  ${route.note}
       ${head}`);
    if (verdict !== 'ok') console.log(`       ${verdict}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${route.path.padEnd(18)} ${String(e).split('\n')[0]}  ${route.note}`);
  }
  await page.close();
}

await browser.close();
console.log(failed ? `\n${failed} route(s) failed` : '\nevery route rendered');
process.exitCode = failed ? 1 : 0;
