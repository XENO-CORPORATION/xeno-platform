#!/usr/bin/env node
/**
 * The download funnel, in a real browser, against the live site.
 *
 * ── WHY NOTHING ELSE CAN CHECK THIS ─────────────────────────────────────────
 *
 * `/download/resume` is a client-rendered SPA route. It answers 200 with the
 * same shell as the apex, and so does a route that does not exist — so every
 * server-side check that could be run against it passes on a page that renders
 * nothing. The unit gates prove the state machine decides correctly; only a
 * browser proves a person ever SEES the decision.
 *
 * ── THE CONVERSION HALF, WHICH IS EASY TO GET BACKWARDS ─────────────────────
 *
 * 🔴 A logged-out visitor must see a real, inviting Download button with the
 * real version on it. The instinct when adding a paywall is to hide or disable
 * the button for people who cannot use it yet — and that is exactly wrong: it
 * removes the thing that makes someone want an account in the first place. The
 * gate belongs AFTER the click, not before it. These gates assert the button is
 * present, enabled, and truthful while signed out.
 *
 *   node scripts/download-funnel-render.mjs [--base https://xenostudio.ai]
 */
import puppeteer from 'puppeteer';

const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 ? process.argv[i + 1] : 'https://xenostudio.ai';
})();

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

console.log(`XENO download funnel — real browser against ${BASE}`);
console.log('─'.repeat(72));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  /* ── 1 · The anonymous product page ─────────────────────────────────── */
  console.log('\nA product page, SIGNED OUT');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/product/hub`, { waitUntil: 'networkidle2', timeout: 45000 });

    const btn = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button')];
      const el = els.find((e) => /^\s*download for /i.test(e.textContent || ''));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim(),
        href: el.getAttribute('href') || '',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5,
      };
    });

    check(Boolean(btn), 'a Download button is rendered to a signed-out visitor');
    if (btn) {
      check(btn.visible, `the button is visible (${btn.text})`);
      check(!btn.disabled, 'the button is ENABLED — the gate belongs after the click, not before it');
      /* Truthful href: middle-click and "copy link" must go somewhere real. */
      check(/\/product\/hub\/download\//.test(btn.href), `the href is the real deep link (${btn.href || 'none'})`);
      /* And it must NOT be the public CDN — that would bypass the gate entirely. */
      check(!/updates\./.test(btn.href), 'the button does not link straight at the CDN');
    }

    /* No leading \b: there is no word boundary between the 'v' and the '0' in
     * "v0.11.5", so \b\d never matches a version rendered that way. The first
     * version of this check reported a correct page as broken. */
    const version = await page.evaluate(() => /\d+\.\d+\.\d+/.test(document.body.innerText));
    check(version, 'a real version number is shown to a signed-out visitor');

    check(errors.length === 0, `no console errors while signed out${errors.length ? ` (${errors[0].slice(0, 90)})` : ''}`);
    await page.close();
  }

  /* ── 2 · Clicking it creates an intent and routes to sign-in ────────── */
  console.log('\nClicking Download while signed out');
  {
    const page = await browser.newPage();
    let intentPosted = false;
    page.on('request', (r) => { if (r.url().includes('/api/downloads/intent')) intentPosted = true; });

    await page.goto(`${BASE}/product/hub`, { waitUntil: 'networkidle2', timeout: 45000 });
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('a, button')]
        .find((e) => /^\s*download for /i.test(e.textContent || ''));
      if (!el) return false;
      el.click();
      return true;
    });
    check(clicked, 'the Download button is clickable');

    await page.waitForFunction(() => location.pathname === '/login', { timeout: 20000 })
      .then(() => pass('an anonymous click lands on /login — not a dead end, not a silent failure'))
      .catch(() => fail(`an anonymous click did not reach /login (at ${page.url()})`));

    check(intentPosted, 'the click recorded a download intent');

    const url = new URL(page.url());
    check(Boolean(url.searchParams.get('returnUrl')), 'the sign-in link carries returnUrl (an existing account comes back)');
    check(Boolean(url.searchParams.get('next')), 'the sign-in link carries next (a NEW account still sees onboarding)');
    const rt = url.searchParams.get('returnUrl') || '';
    check(rt.includes('/download/resume'), 'it returns to the resume page, so the journey can finish');
    await page.close();
  }

  /* ── 3 · The resume page renders its state ──────────────────────────── */
  console.log('\nThe resume page');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    /* Navigate FIRST. A fetch from about:blank carries origin 'null' and is
     * refused by CORS — which reports the API as broken when it is the harness
     * that is in the wrong place. */
    await page.goto(`${BASE}/product/hub`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    /* Create a real intent through the public API, exactly as the button does. */
    const token = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/downloads/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'hub', os: 'win', originPath: '/render-smoke' }),
      });
      if (!r.ok) return null;
      return (await r.json()).token;
    }, BASE).catch(() => null);

    check(Boolean(token), 'an intent can be created from the browser');

    if (token) {
      await page.goto(`${BASE}/download/resume?i=${token}`, { waitUntil: 'networkidle2', timeout: 45000 });
      const body = await page.evaluate(() => document.body.innerText);

      /* 🔴 The false-200 check. The shell renders nothing; a real page has text. */
      check(body.trim().length > 80, `the resume page RENDERS (${body.trim().length} chars, not an empty shell)`);
      check(/sign in/i.test(body), 'it tells an anonymous visitor to sign in');
      check(/hub/i.test(body), 'it names the product they were trying to download');
      check(/saved|continue/i.test(body), 'it promises the download will continue — the reason to bother signing up');

      const cta = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a')].find((e) => /continue/i.test(e.textContent || ''));
        return el ? el.getAttribute('href') : null;
      });
      check(Boolean(cta && cta.includes('/login')), `the CTA leads to /login (${cta || 'none'})`);
    }

    /* 🔴 Snapshot BEFORE the deliberate 404 below. The unknown-token navigation
     * is SUPPOSED to produce a 404, and letting it into the error tally makes
     * this check assert that a correct refusal never happens — a harness that
     * fails on the behaviour it is verifying. */
    const errorsBeforeDeliberate404 = errors.length;

    /* An expired/unknown token must be a clear message, never a blank page. */
    await page.goto(`${BASE}/download/resume?i=definitelynotarealtoken`, { waitUntil: 'networkidle2', timeout: 45000 });
    const dead = await page.evaluate(() => document.body.innerText);
    check(/expired|went wrong/i.test(dead), 'an unknown token renders an honest message, not a blank page');

    check(errorsBeforeDeliberate404 === 0,
      `no console errors on a VALID resume${errorsBeforeDeliberate404 ? ` (${errors[0].slice(0, 90)})` : ''}`);
    await page.close();
  }

  /* ── 4 · The retired accent must not reappear ───────────────────────── */
  console.log('\nChrome');
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle2', timeout: 45000 });

    /* 🔴 SCOPED TO THE PLAN CARDS, deliberately.
     *
     * The retired #a760ff is still live in the SHARED marketing chrome — the
     * header mega-menu and the MarketingPage eyebrow — which is 19 files and a
     * site-wide visual pass, not something to smuggle into a download change.
     * Asserting the whole page here would either fail forever (a gate nobody can
     * make green stops being read) or force an unreviewable diff.
     *
     * So this gate holds the region this work actually owns, and the site-wide
     * count is printed as a FINDING rather than asserted. */
    const purple = await page.evaluate(() => {
      const scope = [...document.querySelectorAll('*')]
        .filter((e) => /Most popular|Everything|per month|Choose|Not yet purchasable/i.test(e.textContent || ''))
        .flatMap((e) => [e, ...e.querySelectorAll('*')]);
      const hit = [];
      for (const el of scope.slice(0, 4000)) {
        const cs = getComputedStyle(el);
        for (const p of ['color', 'backgroundColor', 'borderTopColor']) {
          const v = cs[p];
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
          if (!m) continue;
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          /* The retired accent family: strongly blue-violet. */
          if (b > 180 && r > 100 && r < 190 && g < 110) hit.push(`${el.tagName}.${p}=${v}`);
        }
      }
      return hit.slice(0, 3);
    });
    /* Reported, not asserted. Scoping a colour check to 'the plan cards' in a
     * live DOM means filtering by text, and that filter matches every ANCESTOR
     * containing the text too — including <body>, which drags the shared header
     * back in. A gate I cannot scope honestly is a gate that will be silenced.
     * The SOURCE gate in pricing.test.mjs covers what this change owns. */
    if (purple.length) console.log(`  ⚠ plan-card region sample: ${purple[0]}`);

    /* Information, not a gate. Named so it cannot be forgotten. */
    const sitewide = await page.evaluate(() => {
      let n = 0;
      for (const el of [...document.querySelectorAll('*')].slice(0, 4000)) {
        const cs = getComputedStyle(el);
        for (const p of ['color', 'backgroundColor', 'borderTopColor']) {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs[p]);
          if (!m) continue;
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          if (b > 180 && r > 100 && r < 190 && g < 110) n += 1;
        }
      }
      return n;
    });
    if (sitewide > 0) {
      console.log(`  ⚠ FINDING: ${sitewide} element(s) on /pricing still render the retired accent, from the`);
      console.log('    SHARED marketing chrome (landing-v3/Header, MarketingPage eyebrow). 19 files,');
      console.log('    site-wide visual pass, tracked separately — see DESIGN_SYSTEM.md.');
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('\n' + '─'.repeat(72));
if (failures) {
  console.log(`${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('The download funnel renders and routes correctly.');
