/**
 * The phone drawer RENDERS as designed from the built CSS: closed, the sidebar is entirely off
 * the viewport and its slot takes no width (the surface has the whole screen); open, it sits at
 * the left edge no wider than 88vw over a scrim that covers the viewport; the motion is a
 * decelerate, not linear. Runs after `npm run build` (build stage).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP mobile-drawer-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');

// the shell as pages/Overview.tsx + OverviewTaskbar.tsx render it (rail + panel inside the aside)
const shell = (open) => `
<div data-overview-shell data-theme="dark" style="height:100dvh;width:100vw;display:flex;flex-direction:row;overflow:clip;margin:0;padding:0;--xeno-theme-overlay:rgba(0,0,0,.5);--xeno-theme-shadow:rgba(0,0,0,.4)">
  <div data-taskbar-slot style="transform:translateX(0);margin-right:0;z-index:60;position:relative">
    <aside id="drawer" class="xeno-overview-sidebar${open ? ' is-mobile-open' : ''}" data-mobile-drawer="${open ? 'open' : 'closed'}">
      <nav class="xeno-sidebar-rail"><button class="xeno-rail-button">a</button></nav>
      <div class="xeno-sidebar-panel"><button class="xeno-side-nav-row">Home</button></div>
    </aside>
  </div>
  <div id="main" style="flex:1;overflow:hidden"><p style="margin:0">content</p></div>
</div>
${open ? '<button id="scrim" class="xeno-mobile-scrim" aria-label="Close navigation"></button>' : ''}`;
const page1 = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body style="margin:0">${shell(false)}</body></html>`;
const page2 = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body style="margin:0">${shell(true)}</body></html>`;
const f1 = join(tmpdir(), `xeno-drawer-closed-${process.pid}.html`); writeFileSync(f1, page1);
const f2 = join(tmpdir(), `xeno-drawer-open-${process.pid}.html`); writeFileSync(f2, page2);

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✔' : '✖'} ${name}${ok ? '' : ` — ${detail}`}`); };
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  // Headless Chromium inherits the OS "reduce motion" setting — on a machine with Windows animations
  // off, every transition resolves to ~0s and this gate measured the host, not the stylesheet
  // (2026-09-26: `ease 1e-05s`). Motion is what this checks, so ask for it explicitly.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  const read = () => page.evaluate(() => {
    const r = (sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); const s = getComputedStyle(n); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, position: s.position, timing: s.transitionTimingFunction, duration: s.transitionDuration }; };
    return { drawer: r('#drawer'), slot: r('[data-taskbar-slot]'), main: r('#main'), scrim: r('#scrim'), vw: innerWidth, vh: innerHeight };
  });

  await page.goto(pathToFileURL(f1).href);
  const closed = await read();
  check('closed: the slot takes no width — the surface has the whole screen', closed.slot.width === 0 && Math.round(closed.main.width) === closed.vw, `slot ${closed.slot.width}px, main ${closed.main.width}px of ${closed.vw}`);
  check('closed: the drawer is entirely off the viewport (no rail left behind)', closed.drawer.right <= 0, `right edge at ${closed.drawer.right}px`);
  check('closed: the drawer is fixed, full height', closed.drawer.position === 'fixed' && Math.round(closed.drawer.bottom - closed.drawer.top) === closed.vh, `${closed.drawer.position} ${closed.drawer.bottom - closed.drawer.top}px`);

  await page.goto(pathToFileURL(f2).href);
  await new Promise((r) => setTimeout(r, 500));
  const open = await read();
  check('open: the drawer sits at the left edge', Math.round(open.drawer.left) === 0, `${open.drawer.left}px`);
  check('open: no wider than 88vw, so the surface stays visible beside it', open.drawer.width <= open.vw * 0.88 + 0.5 && open.drawer.width >= 280, `${open.drawer.width}px of ${open.vw}`);
  check('open: the scrim covers the whole viewport', open.scrim && open.scrim.left === 0 && Math.round(open.scrim.right) === open.vw && Math.round(open.scrim.bottom) === open.vh, JSON.stringify(open.scrim));
  const layering = await page.evaluate(() => { const hit = (x, y) => { const n = document.elementFromPoint(x, y); return n ? (n.id || n.className) : ''; }; return { onDrawer: hit(100, 400), onPage: hit(350, 400) }; });
  check('open: a tap on the drawer reaches the drawer; a tap beside it reaches the scrim (layering is right)', /drawer|rail|panel|nav/.test(String(layering.onDrawer)) && layering.onPage === 'scrim', JSON.stringify(layering));
  check('open: the motion is a decelerate, not linear', /cubic-bezier/.test(open.drawer.timing) && !/linear/.test(open.drawer.timing) && parseFloat(open.drawer.duration) >= 0.2, `${open.drawer.timing} ${open.drawer.duration}`);

  // the control: at desktop width the same markup is the in-flow sidebar, not a drawer
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(pathToFileURL(f1).href);
  const desktop = await read();
  check('control: at desktop width the sidebar is in flow and visible (the phone rules are scoped)', desktop.drawer.position !== 'fixed' && desktop.drawer.left === 0 && desktop.drawer.width === 300 && desktop.slot.width === 300, `${desktop.drawer.position} ${desktop.drawer.width}px slot ${desktop.slot.width}px`);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} gates passed`);
if (failed) process.exitCode = 1;
