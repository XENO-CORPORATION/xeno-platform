/**
 * The route loader follows the page's theme and is the ONE XENO loader — the mark — not a card.
 *
 * 2026-10-14 (owner: "one unified XENO loader, called where needed"): the 2px bar this gate first
 * pinned was replaced by MarkLoader, the same loader the workspace and every in-app wait use. The gate
 * now asserts that, and still asserts what the bar fixed: the theme is followed, nothing paints a block.
 *
 * Reported 2026-09-25: every lazy route (the chat itself included) showed a dark card captioned
 * `Loading page —` — dark on a light page, because a bare `.xeno` is the elements library's DARK
 * default, and a card because that is what it was. lazyRoute.tsx now renders a 2px indeterminate
 * bar in the resolved platform theme, after a short delay.
 *
 * Why a rendered gate: whether it is dark, whether a background shows and how tall it is are decided
 * by stylesheets from three places (the elements library, chat-theme.css, index.css) winning on
 * specificity. Only a browser resolves that. Runs after `npm run build`, like the other *-rendered gates.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP route-loading-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');

/*
 * The fallback exactly as RouteLoading renders it once the delay has passed: the theme by class
 * (`chat-theme-<name>`) and `data-theme` for the elements library, and the element ProgressBar's
 * own markup with no label. Keep this in step with lazyRoute.tsx — the source check at the bottom
 * fails if the component stops saying what this assumes.
 */
const loader = (theme) => `
  <div class="xeno chat-themed chat-theme-${theme} route-loading" data-theme="${theme === 'light' ? 'light' : 'dark'}"
    role="status" aria-busy="true" aria-live="polite" data-shown="true">
    <div role="img" aria-label="Loading page" data-mark-loader="" class="xeno-mark-loader" style="position:relative;width:88px;height:88px"><canvas aria-hidden="true"></canvas></div>
    <span class="sr-only">Loading page</span>
  </div>`;

// Each loader sits on a page of its own theme, as it does in the app.
const page = (id, theme, canvas) => `<section id="${id}" style="width:720px;height:600px;background:${canvas}">${loader(theme)}</section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
${page('light', 'light', '#ffffff')}
${page('dim', 'dim', '#3b4048')}
${page('dark', 'dark', '#0a0a0a')}
</body></html>`;
const file = join(tmpdir(), `xeno-route-loading-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

const luminance = (rgb) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const browser = await puppeteer.launch({ headless: true });
try {
  const tab = await browser.newPage();
  // The sweep is suppressed under "reduce motion" (the library's own rule), and headless Chromium
  // inherits that from the OS — so the host decided this gate. Ask for motion; the reduced case
  // is the library's to test.
  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await tab.setViewport({ width: 900, height: 500 });
  await tab.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 400));

  const read = (id) => tab.evaluate((sectionId) => {
    const root = document.getElementById(sectionId).querySelector('.route-loading');
    const mark = root.querySelector('[data-mark-loader]');
    const canvas = mark.querySelector('canvas');
    const label = root.querySelector('.sr-only');
    const cs = (el) => getComputedStyle(el);
    return {
      background: cs(root).backgroundColor,
      // MarkLoader paints in its canvas's computed colour, so this IS the ink it draws with
      fill: cs(canvas).color,
      markSize: mark.getBoundingClientRect().width,
      labelHidden: label.getBoundingClientRect().width <= 1 && label.getBoundingClientRect().height <= 1,
      card: !!root.querySelector('.xeno-card'),
      bar: !!root.querySelector('.xeno-progressbar'),
    };
  }, id);

  const light = await read('light');
  const dark = await read('dark');
  const dim = await read('dim');

  check('LIGHT page: the mark is DARK ink, not the library’s dark-default white-on-black', luminance(light.fill) < 0.2, `ink=${light.fill}`);
  check('DARK page: the mark is LIGHT ink', luminance(dark.fill) > 0.6, `ink=${dark.fill}`);
  check('DIM page: the mark is light ink on the dim ground', luminance(dim.fill) > 0.4, `ink=${dim.fill}`);
  for (const [name, r] of [['light', light], ['dim', dim], ['dark', dark]]) {
    check(`${name}: no block — the loader paints no background of its own`, r.background === 'rgba(0, 0, 0, 0)' || r.background === 'transparent', `background=${r.background}`);
    check(`${name}: it is the XENO mark at its page size, not a bar`, Math.abs(r.markSize - 88) < 0.5 && !r.bar, `mark=${r.markSize}px bar=${r.bar}`);
    check(`${name}: no card; the label is for assistive tech only`, !r.card && r.labelHidden);
  }

  // the markup above must still be what the component renders
  const source = readFileSync('src/components/platform/lazyRoute.tsx', 'utf8');
  check('lazyRoute.tsx still renders the theme by class + data-theme, with the ONE loader (MarkLoader)',
    /chat-theme-\$\{resolvedTheme\}/.test(source) && /route-loading/.test(source) && /data-theme=\{/.test(source)
      && /<MarkLoader size=\{88\}/.test(source) && !/<ProgressBar/.test(source) && !/<Card[^>]*role="status"/.test(source));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;
