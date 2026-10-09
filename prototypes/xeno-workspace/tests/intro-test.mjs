import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
const open = () => ev(() => document.getElementById('modeIntro')?.classList.contains('on'));
for (const [W, H] of [[1440, 900], [1280, 720]]) {
  await p.setViewport({ width: W, height: H, deviceScaleFactor: W === 1440 ? 2 : 1 }); await p.goto(url); await ev(() => localStorage.clear()); await p.goto(url + '#/studio'); await wait(900);
  ok(await open(), `${W}x${H}: the first visit to Studio opens its intro`);
  const g = await ev(() => { const d = document.querySelector('#modeIntro .mi'), r = d.getBoundingClientRect(), c = d.querySelector('.mi-copy'), pv = d.querySelector('.mi-prev'); return { fits: r.top >= 16 && r.bottom <= innerHeight - 16, ov: Math.max(c.scrollHeight - c.clientHeight, pv.scrollHeight - pv.clientHeight), focus: document.activeElement.textContent.trim() }; });
  ok(g.fits && g.ov <= 1, `${W}x${H}: sheet fits without scrolling (overflow ${g.ov})`);
  ok(/Start in Studio/.test(g.focus), 'focus starts on the main action');
  if (W === 1440) await p.screenshot({ path: 'intro-studio.png' }); else await p.screenshot({ path: 'intro-720.png' });
  await p.keyboard.press('Escape'); await wait(300);
  ok(!(await open()) && await ev(() => !!JSON.parse(localStorage.getItem('xw.introSeen'))?.studio), 'Esc keeps the defaults and marks it seen');
}
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await p.reload(); await wait(900);
ok(!(await open()), 'a mode whose intro was seen does not reopen it');
// Office: choose pins + default, start → rail, sidebar and switcher follow
await p.goto(url + '#/office'); await wait(900);
ok(await open(), 'Office opens its own intro the first time');
const before = await ev(() => [...document.querySelectorAll('#modeIntro [data-mi-pin][aria-pressed="true"]')].map((b) => b.dataset.miPin));
await p.click('#modeIntro [data-mi-pin="notes"]').catch(() => {}); await wait(150);
const prevRows = await ev(() => [...document.querySelectorAll('#modeIntro .mi-pinrow')].map((r) => r.dataset.p));
ok(await ev(() => document.querySelector('#modeIntro [data-mi-pin="mail"]').getAttribute('aria-disabled') === 'true'), 'a product that is not built yet cannot be pinned'); ok(prevRows.includes('notes'), `the preview sidebar updates as you pin (${prevRows.join(', ')})`);
await p.screenshot({ path: 'intro-office.png' });
await p.click('#modeIntro [data-mi-pin="mail"]'); await wait(150); ok(await ev(() => !JSON.stringify([...document.querySelectorAll('#modeIntro .mi-pinrow')].map((r) => r.dataset.p)).includes('mail')), 'clicking a coming-soon product does not pin it');
// the toggle: Sidebar · Home · Product
await p.click('#modeIntro [data-mi-view="home"]'); await wait(1000);
ok(await ev(() => document.querySelector('#modeIntro .mi-stage').dataset.view === 'home' && document.querySelector('#modeIntro .mw').dataset.state === 'home' && !!document.querySelector('#modeIntro .mw-home .hm2') && getComputedStyle(document.querySelector('#modeIntro .mw-home')).opacity === '1'), 'Home: the sidebar collapses and the real mode home is in the main area');
ok(await ev(() => document.querySelector('#modeIntro .mw-side').getBoundingClientRect().width < 2), 'the sidebar really collapsed');
ok(await ev(() => [...document.querySelectorAll('#modeIntro .mw button')].every((x) => x.tabIndex === -1)), 'the preview is mouse-only: nothing in it takes keyboard focus');
await p.screenshot({ path: 'intro-home.png' });
await p.hover('#modeIntro [data-mi-pin="slides"]'); await wait(600);
ok(await ev(() => document.querySelector('#modeIntro .mi-stage').dataset.view === 'home' && !document.querySelector('#modeIntro .mw-cursor').classList.contains('on')), 'outside Product, pointing at a product changes nothing — you choose the view');
await p.click('#modeIntro [data-mi-view="product"]'); await wait(300);
ok(await ev(() => !!document.querySelector('#modeIntro .mw-rail .mw-mark svg')), 'the mini rail carries the mode mark');
await p.hover('#modeIntro [data-mi-pin="sheets"]'); await wait(450); ok(await ev(() => document.querySelector('#modeIntro .mw-cursor').classList.contains('on')), 'a cursor travels to the product before it opens'); await wait(1100);
ok(await ev(() => document.querySelector('#modeIntro .mi-stage').dataset.view === 'product' && document.querySelector('#modeIntro .mw-prod.open .mi-win')?.dataset.demo === 'sheets'), 'then the product window opens in the workspace');
ok(await ev(() => [...document.querySelectorAll('#modeIntro .mi-live')].filter((x) => x.offsetParent).length === 1), 'only the hint for the current view shows');
ok(await ev(() => /Pinned/.test(document.querySelector('#modeIntro .mi-win-pin').textContent)), 'the demo says whether it is pinned');
await p.screenshot({ path: 'intro-product.png' });
await p.hover('#modeIntro [data-mi-pin="mail"]'); await wait(800); ok(await ev(() => document.querySelector('#modeIntro .mw-kbar').classList.contains('on') && !document.querySelector('#modeIntro .mw-pin[data-p="mail"]')), 'an unpinned product is opened through Ctrl K'); await wait(1000);
ok(await ev(() => document.querySelector('#modeIntro .mw-prod.open .mi-win')?.dataset.demo === 'mail'), 'moving to another product opens that one instead');
await p.click('#modeIntro [data-mi-view="sidebar"]'); await wait(350);
ok(await ev(() => document.querySelector('#modeIntro .mi-stage').dataset.view === 'sidebar'), 'the toggle returns to the sidebar');
await p.click('#modeIntro [data-mi-default]').catch(() => ev(() => document.querySelector('[data-mi-default]').click())); await wait(100);
await p.click('#modeIntro [data-mi-start]'); await wait(500);
const after = await ev(() => ({ pins: JSON.parse(localStorage.getItem('xw.pins') || '{}').office, primary: JSON.parse(localStorage.getItem('xw.primary') || 'null'), side: [...document.querySelectorAll('#panel [data-sec="pinned"] [data-product]')].map((r) => r.dataset.product), rail: [...document.querySelectorAll('#rail .rbtn[data-product]')].map((r) => r.dataset.product) }));
ok(after.pins?.includes('notes') && after.primary === 'office', `Start saves the pins and the default mode (${JSON.stringify(after.pins)}, ${after.primary})`);
ok(after.side.includes('notes'), 'the sidebar Pinned list shows the choice');
// reopen from Help
await p.click('#rail [data-go="help"]'); await wait(400); await p.click('#menu [data-hp="intro"]'); await wait(400);
ok(await open(), 'Help → Mode intro reopens it');
await p.keyboard.press('Escape'); await wait(200);
// navigating away while an intro is open closes it without marking it seen
await ev(() => localStorage.clear()); await p.goto(url + '#/social'); await p.reload(); await wait(900);
ok(await open(), 'Social intro opens');
await p.goto(url + '#/dev'); await wait(700);
ok(await ev(() => document.getElementById('modeIntro').dataset.mode === 'dev' || !document.getElementById('modeIntro').classList.contains('on')), 'going to another mode drops the Social sheet');
ok(await ev(() => !JSON.parse(localStorage.getItem('xw.introSeen') || '{}').social), '…without marking Social as seen');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
