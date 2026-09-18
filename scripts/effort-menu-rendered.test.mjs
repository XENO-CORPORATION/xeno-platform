/**
 * The effort menu RENDERS in the chat's chrome — the agent panel's cells (composer.css, scoped to
 * `.xa-dock`) painted from the chat's tokens through the bridge in chat-theme.css, dark and light.
 *
 * Why a rendered gate: the cells are styled by a stylesheet shipped in another package and reach
 * this surface only through two CSS scopes (`.xa-dock` for the rules, `.chat-effort` for the
 * tokens). A source grep proves both strings exist; only a browser proves the built CSS applies
 * them to this markup. Runs after `npm run build` (build stage), like focus-self-rendered.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP effort-menu-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');

// the markup EffortCells renders, six levels with `high` current — the shape the component emits
const cells = ['Auto', 'Low', 'Medium', 'High', 'X-High', 'Max'].map((l, i) => `<span class="xa-cell${i < 3 ? ' xa-on' : i === 3 ? ' xa-cur' : ''}">${i === 3 ? l : ''}</span>`).join('');
const menu = (theme) => `
<div data-overview-shell class="chat-themed chat-theme-${theme}" data-theme="${theme}" style="padding:24px;background:var(--chat-canvas)">
  <div id="${theme}" class="xa-dock chat-effort" style="position:relative;width:224px">
    <div class="xa-menu xa-show" style="position:relative;width:224px">
      <div class="xa-mrows">
        <div class="xa-ends"><span>Faster</span><span>Smarter</span></div>
        <div class="xa-line xa-cells"><div class="xa-sl xa-cells" role="slider">${cells}</div></div>
      </div>
    </div>
  </div>
</div>`;
// the composer's control row as ChatWithLLM/ChatEmptyState render it, reveal CLOSED: the "+", the
// collapsed Upload slot, the (empty) token counter, then the effort chip
const row = `
<div id="row" class="chat-themed chat-theme-dark" style="width:600px;padding:16px">
  <div class="chat-input-controls flex items-center justify-between gap-2 mt-1">
    <div class="flex items-center gap-1 md:gap-2 relative">
      <button id="plus" class="chat-icon-turn" style="width:28px;height:28px" aria-expanded="false">+</button>
      <span class="inline-flex overflow-hidden transition-[width,opacity,margin] duration-300 w-0 opacity-0 -mr-1 md:-mr-2"><button style="width:32px;height:28px">U</button></span>
      <div data-token-context-counter class="flex shrink-0 items-center whitespace-nowrap empty:hidden"></div>
      <div data-effort-control class="relative flex items-center"><button id="chip" class="flex h-7 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs">Effort Auto</button></div>
    </div>
  </div>
</div>`;
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">${menu('dark')}${menu('light')}${row}</body></html>`;
const file = join(tmpdir(), `xeno-effort-menu-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✔' : '✖'} ${name}${ok ? '' : ` — ${detail}`}`); };
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 500 }); // ≥ md, so the row uses gap-2
  await page.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 600)); // past the `.xa-line` rise animation
  const read = (theme) => page.evaluate((theme) => {
    const root = document.getElementById(theme);
    const c = (sel) => { const n = root.querySelector(sel); const s = getComputedStyle(n); return { w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height, bg: s.backgroundColor, color: s.color, opacity: s.opacity, padding: s.padding }; };
    const rootStyle = getComputedStyle(root);
    return { dock: { padding: rootStyle.padding }, menu: c('.xa-menu'), ends: c('.xa-ends'), on: c('.xa-cell.xa-on'), cur: c('.xa-cell.xa-cur'), off: c('.xa-cell:last-child'), curText: root.querySelector('.xa-cell.xa-cur').textContent };
  }, theme);
  // computed colours arrive as rgb()/rgba() or, from color-mix(), as color(srgb r g b [/ a])
  const alpha = (v) => {
    const rgb = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(v);
    if (rgb) return rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
    const srgb = /color\(srgb [\d.]+ [\d.]+ [\d.]+(?: \/ ([\d.]+))?\)/.exec(v);
    if (srgb) return srgb[1] === undefined ? 1 : parseFloat(srgb[1]);
    return 0;
  };
  const lum = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb); return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : -1; };

  for (const theme of ['dark', 'light']) {
    const r = await read(theme);
    check(`${theme}: the dock scope carries no dock padding (the popover is the chat's own)`, r.dock.padding === '0px', r.dock.padding);
    check(`${theme}: the menu has a painted background (tokens reached it)`, alpha(r.menu.bg) > 0, r.menu.bg);
    check(`${theme}: cells are 10px tall and the current one opens to 16px`, Math.round(r.on.h) === 10 && Math.round(r.off.h) === 10 && Math.round(r.cur.h) === 16, `${r.on.h}/${r.off.h}/${r.cur.h}`);
    check(`${theme}: the current cell holds the word at 54px`, r.curText === 'High' && Math.round(r.cur.w) === 54, `${r.curText} ${r.cur.w}`);
    check(`${theme}: filled cells are brighter than empty ones, and the current is the accent fill`, alpha(r.on.bg) > alpha(r.off.bg) && alpha(r.cur.bg) === 1, `${r.on.bg} vs ${r.off.bg} vs ${r.cur.bg}`);
    check(`${theme}: Faster/Smarter ends are painted (no transparent text)`, alpha(r.ends.color) > 0 && parseFloat(r.ends.opacity) > 0, r.ends.color);
  }
  const gap = await page.evaluate(() => { const p = document.getElementById('plus').getBoundingClientRect(); const c = document.getElementById('chip').getBoundingClientRect(); return c.left - p.right; });
  check('the effort chip sits ONE row gap (8px) after "+" — the collapsed Upload slot and the empty counter cost nothing', Math.round(gap) === 8, `${gap}px`);
  const dark = await read('dark'); const light = await read('light');
  check('light flips the ink: the current cell is dark on light, light on dark', lum(light.cur.bg) < lum(dark.cur.bg), `${dark.cur.bg} vs ${light.cur.bg}`);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} gates passed`);
if (failed) process.exitCode = 1;
