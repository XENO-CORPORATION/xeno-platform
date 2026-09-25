/**
 * The route loader follows the page's theme and reads as a loading BAR, not a block in the page.
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
    <div class="xeno-progressbar">
      <span role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress" class="xeno-progressbar-track" data-state="indeterminate"><span class="xeno-progressbar-fill"></span></span>
    </div>
    <span class="sr-only">Loading page</span>
  </div>`;

// Each loader sits on a page of its own theme, as it does in the app.
const page = (id, theme, canvas) => `<section id="${id}" style="width:720px;height:120px;background:${canvas}">${loader(theme)}</section>`;
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
  await tab.setViewport({ width: 900, height: 500 });
  await tab.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 400));

  const read = (id) => tab.evaluate((sectionId) => {
    const root = document.getElementById(sectionId).querySelector('.route-loading');
    const track = root.querySelector('.xeno-progressbar-track');
    const fill = root.querySelector('.xeno-progressbar-fill');
    const label = root.querySelector('.sr-only');
    const cs = (el) => getComputedStyle(el);
    return {
      height: root.getBoundingClientRect().height,
      background: cs(root).backgroundColor,
      trackHeight: track.getBoundingClientRect().height,
      fill: cs(fill).backgroundColor,
      fillAnimated: cs(fill).animationName !== 'none',
      labelHidden: label.getBoundingClientRect().width <= 1 && label.getBoundingClientRect().height <= 1,
      card: !!root.querySelector('.xeno-card'),
      caption: !!root.querySelector('.xeno-progressbar-header'),
    };
  }, id);

  const light = await read('light');
  const dark = await read('dark');
  const dim = await read('dim');

  check('LIGHT page: the bar is DARK ink, not the library’s dark-default white-on-black', luminance(light.fill) < 0.2, `fill=${light.fill}`);
  check('DARK page: the bar is LIGHT ink', luminance(dark.fill) > 0.6, `fill=${dark.fill}`);
  check('DIM page: the bar is light ink on the dim ground', luminance(dim.fill) > 0.4, `fill=${dim.fill}`);
  for (const [name, r] of [['light', light], ['dim', dim], ['dark', dark]]) {
    check(`${name}: no block — the loader paints no background of its own`, r.background === 'rgba(0, 0, 0, 0)' || r.background === 'transparent', `background=${r.background}`);
    check(`${name}: it is a bar — 2px tall, the whole loader no taller than that`, Math.abs(r.trackHeight - 2) < 0.5 && r.height <= 2.5, `track=${r.trackHeight}px loader=${r.height}px`);
    check(`${name}: indeterminate — the fill sweeps`, r.fillAnimated);
    check(`${name}: no card and no visible "Loading page —" caption; the label is for assistive tech only`, !r.card && !r.caption && r.labelHidden);
  }

  // the markup above must still be what the component renders
  const source = readFileSync('src/components/platform/lazyRoute.tsx', 'utf8');
  check('lazyRoute.tsx still renders the theme by class + data-theme, with no labelled ProgressBar',
    /chat-theme-\$\{resolvedTheme\}/.test(source) && /route-loading/.test(source) && /data-theme=\{/.test(source)
      && /<ProgressBar value=\{null\} \/>/.test(source) && !/<Card[^>]*role="status"/.test(source));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;
