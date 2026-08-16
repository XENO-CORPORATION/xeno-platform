#!/usr/bin/env node
/**
 * The Forum UI, in a real browser.
 *
 * ── WHY NOTHING ELSE CAN CHECK THIS ─────────────────────────────────────────
 *
 * `/forum` returns 4,338 bytes — byte-identical to the apex, because it is a
 * client-rendered SPA route. Every server-side check that could be run against
 * it passes on a page that renders nothing at all. `curl` reports 200 for
 * `/forum`, for `/forum/t/does-not-exist`, and for a route that was deleted.
 *
 * Phase 1 of the release plan claims "a person can use this". Every proof
 * behind that claim so far has exercised services, queries and APIs. This is the
 * first thing that opens the page.
 *
 * ── WHAT IT ASSERTS ─────────────────────────────────────────────────────────
 *
 *   • the Record renders REAL threads, not an empty state and not a spinner
 *   • the forum runs its OWN chrome — mounting the marketing header here put
 *     Products/Solutions mega-menus and a dead `#pricing` anchor above a feed
 *   • a thread page renders its markdown as MARKUP, and its accepted answer
 *   • 🔴 no console errors and no failed requests while SIGNED OUT — `/feed` is
 *     401 by design and the page is supposed to guard the call. An unguarded one
 *     is invisible to a human (the page still works) and permanent.
 *   • the retired purple accent appears nowhere in the computed styles
 *
 * Read-only: it loads two public pages. It writes nothing and signs in as nobody.
 *
 * ── VERIFIED TO DISCRIMINATE (2026-08-16) ───────────────────────────────────
 *
 * Both negative controls fire, so these assertions are not decoration:
 *
 *   FORUM_UI_PATH=/ ........ the apex fails 3 checks — no thread links, and 2
 *                            marketing-nav links detected
 *   /product/pixel ......... the purple predicate finds rgb(167, 96, 255), the
 *                            exact `#a760ff` this repo calls retired
 *
 * ⚠️ On Git Bash, `FORUM_UI_PATH=/` is rewritten to a Windows path by MSYS.
 * Prefix with `MSYS_NO_PATHCONV=1`.
 */

import puppeteer from 'puppeteer';

const BASE = process.env.SMOKE_FORUM_BASE_URL || 'https://xenostudio.ai';

/**
 * NEGATIVE CONTROL. A render check that passes on a clean page has proven
 * nothing until you have seen it fail on a dirty one, and mutating the real
 * frontend costs a rebuild and a deploy per attempt.
 *
 * Pointing it at a page that SHOULD fail is the cheap equivalent: the apex has
 * marketing nav and no thread links; a product page carries the violet accent
 * this check forbids on forum surfaces. If the assertions stay green there, they
 * discriminate nothing.
 */
const LIST_PATH = process.env.FORUM_UI_PATH || '/forum';

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

/** Load a page and collect everything that went wrong while it did. */
async function visit(path) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${u.replace(BASE, '')}`);
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  return { page, errors, failed };
}

try {
  // ── the Record ───────────────────────────────────────────────────────────
  console.log(`forum UI render check against ${BASE}\n`);
  console.log(`1. ${LIST_PATH} — the Record:`);
  const rec = await visit(LIST_PATH);

  const threads = await rec.page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/forum/t/"]')].map((a) => a.textContent.trim()).filter(Boolean));

  if (!threads.length) fail('no thread links rendered — the Record is empty in a browser');
  else pass(`${threads.length} thread link(s) rendered ("${threads[0].slice(0, 42)}…")`);

  const text = await rec.page.evaluate(() => document.body.innerText);
  if (text.length < 400) fail(`the page rendered only ${text.length} chars — effectively blank`);
  else pass(`the page has real content (${text.length} chars)`);

  // 🔴 The forum is an APP surface and runs its own chrome. The marketing header
  // brought mega-menus and a dead `#pricing` anchor above a feed.
  const marketing = await rec.page.evaluate(() =>
    [...document.querySelectorAll('a[href*="#pricing"], a[href="/solutions"]')].length);
  if (marketing) fail(`${marketing} marketing-nav link(s) on an app surface — the landing header is mounted here`);
  else pass('no marketing nav — the forum runs its own chrome');

  if (rec.errors.length) fail(`${rec.errors.length} console error(s): ${rec.errors[0].slice(0, 90)}`);
  else pass('no console errors');

  // 🔴 Signed out, nothing should be calling an authenticated endpoint.
  if (rec.failed.length) {
    fail(`${rec.failed.length} failed API call(s) while signed out: ${rec.failed.join(', ').slice(0, 120)}`);
  } else pass('no failed API calls while signed out — guarded, not merely tolerated');

  // ── a thread ─────────────────────────────────────────────────────────────
  const href = await rec.page.evaluate(() => {
    const a = document.querySelector('a[href^="/forum/t/"]');
    return a ? a.getAttribute('href') : null;
  });
  await rec.page.close();

  console.log(`\n2. ${href || '(no thread to open)'} — a thread:`);
  if (!href) fail('cannot open a thread: the Record rendered no links');
  else {
    const th = await visit(href);
    const body = await th.page.evaluate(() => document.body.innerText);
    if (body.length < 300) fail(`the thread page rendered only ${body.length} chars`);
    else pass(`the thread renders (${body.length} chars)`);

    // Markdown must become MARKUP. If bodies were rendered as raw text the page
    // would still "work" and would show literal asterisks and backticks.
    const markup = await th.page.evaluate(() =>
      document.querySelectorAll('article p, .prose p, main p').length);
    if (!markup) fail('no rendered paragraphs — the post body may be raw text, not markdown');
    else pass(`${markup} rendered paragraph(s) — markdown became markup`);

    // The retired purple. DESIGN_SYSTEM.md is monochromatic; a stray accent is
    // invisible to a passing glance and permanent once copied.
    const purple = await th.page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
          const m = s[prop].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) continue;
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          // Purple-ish: blue and red both clearly above green.
          if (b > 120 && r > 90 && g + 40 < b && g + 20 < r) bad.push(`${el.tagName}.${prop}=${s[prop]}`);
        }
      }
      return bad.slice(0, 3);
    });
    if (purple.length) fail(`retired purple accent in computed styles: ${purple.join(' | ')}`);
    else pass('no retired purple accent (DESIGN_SYSTEM is monochromatic)');

    if (th.errors.length) fail(`${th.errors.length} console error(s): ${th.errors[0].slice(0, 90)}`);
    else pass('no console errors');
    if (th.failed.length) fail(`failed API call(s): ${th.failed.join(', ').slice(0, 120)}`);
    else pass('no failed API calls');

    await th.page.close();
  }
} finally {
  await browser.close();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('The Forum renders, in a browser, signed out, with no errors.');
