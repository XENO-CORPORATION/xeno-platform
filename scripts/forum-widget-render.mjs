#!/usr/bin/env node
/**
 * WP10 — prove the product-page forum widget RENDERS, in a real browser.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `forum-product-widget.test.mjs` reads the source and asserts the component is
 * imported and placed in the JSX. That is a source-level mounting check, and
 * this ecosystem has shipped nine features that passed exactly that kind of
 * check and were unreachable in the running app. A component can be perfect,
 * imported, rendered in source — and still produce nothing, because its fetch
 * 404s, its data shape moved, or a parent short-circuits before it.
 *
 * So this loads the real page in a real browser against the deployed site.
 *
 * ── 🔴 IT ASSERTS BOTH DIRECTIONS ───────────────────────────────────────────
 *
 * The distinctive property of this widget is not that it appears — it is that
 * it DISAPPEARS. D12 says a young forum must not advertise itself as empty, and
 * a widget that renders an empty "Known issues" shell on every quiet product
 * page is the exact failure D12 exists to prevent, one level down.
 *
 * A one-sided check ("it appears on pixel") passes just as happily on a widget
 * that renders unconditionally. Only the negative case can tell them apart, and
 * the negative case is the one carrying the design decision.
 *
 *   product:pixel  has threads  → the section MUST be present, with real links
 *   product:motion has none     → the section MUST NOT exist at all
 *
 * Read-only: it loads two public pages and reads the DOM. It writes nothing.
 */

import puppeteer from 'puppeteer';

const BASE = process.env.SMOKE_FORUM_BASE_URL || 'https://xenostudio.ai';
const HEADING = 'Known issues and answers';

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

/**
 * Everything the page shows for the widget, read from the live DOM — plus
 * whether the widget's fetch was ISSUED.
 *
 * 🔴 THE REQUEST IS WHAT MAKES THE NEGATIVE CASE MEAN ANYTHING.
 *
 * The first version of this check asserted only that the heading was absent on
 * a product with no threads — and it passed on a page the widget was never
 * mounted on at all. `ProductPage` is a DISPATCHER: rich products render
 * `ProductLanding`, everything else renders `LeanProductPage`, and the widget
 * had been added to one branch. Every real product takes the other one.
 *
 * "Absent" and "never ran" are indistinguishable in the DOM. They are not
 * indistinguishable on the network: a mounted widget always asks, then decides.
 * So absence is only accepted as evidence when the fetch was observed.
 */
async function inspect(page, slug) {
  const asked = [];
  const onRequest = (req) => {
    const u = req.url();
    if (u.includes('/api/forum/threads') && u.includes(encodeURIComponent(`product:${slug}`))) asked.push(u);
  };
  page.on('request', onRequest);

  await page.goto(`${BASE}/product/${slug}`, { waitUntil: 'networkidle2', timeout: 60000 });

  // The widget fetches after mount. Give it a real chance to appear before
  // concluding it did not — otherwise "absent" just means "early", and the
  // negative assertion below would pass for the wrong reason.
  await page
    .waitForFunction(
      (h) => document.body.innerText.includes(h),
      { timeout: 12000 },
      HEADING,
    )
    .catch(() => {});

  const dom = await page.evaluate((h) => {
    const heads = [...document.querySelectorAll('h2')].filter((e) => e.textContent.trim() === h);
    if (!heads.length) return { present: false, links: [], text: '' };
    const section = heads[0].closest('section');
    return {
      present: true,
      links: [...section.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      text: section.innerText,
    };
  }, HEADING);

  page.off('request', onRequest);
  return { ...dom, asked: asked.length };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log(`forum widget render check against ${BASE}\n`);

  // ── a product WITH threads ────────────────────────────────────────────────
  console.log('product:pixel (6 threads) — the section must RENDER:');
  const withThreads = await inspect(page, 'pixel');

  if (!withThreads.present) {
    fail(`"${HEADING}" never appeared on /product/pixel — the widget is mounted in source and produces nothing`);
  } else {
    pass(`"${HEADING}" section rendered`);

    const threadLinks = withThreads.links.filter((h) => h.startsWith('/forum/t/'));
    if (!threadLinks.length) {
      // The single most likely silent break: the serializer stops sending
      // `url` and every row becomes a dead link. This repo has already shipped
      // a lookup against a field the serializer never exposed.
      fail('the section rendered but contains no /forum/t/ links — thread urls are missing or dead');
    } else {
      pass(`${threadLinks.length} thread links, all citable (${threadLinks[0].slice(0, 46)}…)`);
    }

    // §5.4 — resolution state, never popularity. Checked in the RENDERED text,
    // not the source, because that is where a reader would actually see it.
    const popularity = /\b\d+\s*(views?|upvotes?|points?|likes?)\b/i;
    if (popularity.test(withThreads.text)) {
      fail(`a popularity signal is visible on a product page: ${withThreads.text.match(popularity)[0]}`);
    } else {
      pass('no popularity signal in the rendered section');
    }
  }

  // ── a product with NO threads ─────────────────────────────────────────────
  console.log('\nproduct:motion (0 threads) — the section must NOT EXIST:');
  const without = await inspect(page, 'motion');

  // 🔴 First: did the widget RUN here? Without this, "no section" is satisfied
  // by a page the widget was never mounted on — which is exactly the defect
  // this check found on its first run.
  if (!without.asked) {
    fail(
      'the widget never requested threads on /product/motion — it is not mounted on this page, '
      + 'so its absence proves nothing. ProductPage is a dispatcher; check BOTH branches.',
    );
  } else if (without.present) {
    fail(
      'an empty "Known issues and answers" section rendered on a product with no threads — '
      + 'this advertises a dead forum to the audience you least want to tell (D12)',
    );
  } else {
    pass('the widget ran, found nothing, and rendered nothing — a quiet product page stays quiet');
  }

  // And the page itself must still be a real page, not a broken render. If the
  // widget threw, React would blank the tree and the negative check above would
  // pass for entirely the wrong reason.
  const motionOk = await page.evaluate(() => document.body.innerText.length);
  if (motionOk < 500) {
    fail(`/product/motion rendered only ${motionOk} chars — the page is broken, so "no section" proves nothing`);
  } else {
    pass(`/product/motion still renders fully (${motionOk} chars) — absence is real, not a crash`);
  }
} finally {
  await browser.close();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Widget renders where it should, and nowhere else.');
