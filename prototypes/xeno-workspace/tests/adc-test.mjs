import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
const enter = async () => { await ev(() => { const b = document.querySelector('[data-adaptive]'); if (b) b.click(); else { document.getElementById('logo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); } }); await wait(150); if (!(await ev(() => document.getElementById('adModal')?.classList.contains('on')))) { await ev(() => document.querySelector('[data-adaptive]')?.click()); await wait(200); } };
for (const [W, H] of [[1440, 900], [1280, 720]]) {
  await p.setViewport({ width: W, height: H, deviceScaleFactor: W === 1440 ? 2 : 1 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.goto(url + '#/studio'); await wait(800);
  await p.click('#logo', { button: 'right' }); await wait(300); await enter(); await wait(300);
  const s = await ev(() => { const d = document.querySelector('#adModal .adc'), r = d?.getBoundingClientRect(), body = { scrollHeight: Math.max(d.querySelector('.adp').scrollHeight - d.querySelector('.adp').clientHeight, d.querySelector('.adx-copy').scrollHeight - d.querySelector('.adx-copy').clientHeight), clientHeight: 0 }; return d ? { on: document.getElementById('adModal').classList.contains('on'), modal: d.getAttribute('aria-modal'), focus: document.activeElement.textContent.trim(), h: Math.round(r.height), fits: r.top >= 16 && r.bottom <= innerHeight - 16, scroll: body.scrollHeight - body.clientHeight } : null; });
  ok(s && s.on && s.modal === 'true', `${W}x${H}: choosing Adaptive opens the consent dialog`);
  ok(s && s.focus === 'Not now', `${W}x${H}: focus starts on "Not now" (refusal), not on accept`);
  ok(s && s.fits && s.scroll <= 1, `${W}x${H}: dialog fits without scrolling (height ${s?.h}, overflow ${s?.scroll})`);
  if (W === 1440) { await p.screenshot({ path: 'adc-a.png' }); await wait(1800); await p.screenshot({ path: 'adc.png' }); ok(await ev(() => document.querySelector('.adp-stage').dataset.state === 'adaptive'), 'the preview plays the change once'); } else await p.screenshot({ path: 'adc-720.png' });
  const eq = await ev(() => { const [n, y] = [...document.querySelectorAll('.adc-btns button')].map((x) => x.getBoundingClientRect()); return Math.abs(n.width - y.width) < 1 && Math.abs(n.height - y.height) < 1; });
  ok(eq, 'refuse and accept are the same size');
  ok(await ev(() => !document.querySelector('[data-adc-sig="time"]').checked && !document.querySelector('[data-adc-sig="actions"]').checked), 'optional signals start unticked');
  await p.keyboard.press('Escape'); await wait(350);
  ok(await ev(() => !document.getElementById('adModal').classList.contains('on') && !localStorage.getItem('xw.adOn')?.includes('true') && !localStorage.getItem('xw.adConsent')), 'Esc refuses: Adaptive stays off, no consent stored');
}
// accept with one optional signal → receipt
await p.setViewport({ width: 1440, height: 900 }); await ev(() => document.querySelector('[data-ad="on"]')?.click()); await wait(300);
ok(await ev(() => document.getElementById('adModal').classList.contains('on')), 'the sidebar "Turn on" goes through the same dialog');
await p.click('label:has([data-adc-sig="time"])'); await wait(100); ok(await ev(() => /"Tue 09:14"/.test(document.querySelector('.adx-code').textContent)), 'ticking a signal changes the stored-record example'); await wait(100);
await p.click('[data-adc-accept]'); await wait(300);
const rc = await ev(() => JSON.parse(localStorage.getItem('xw.adConsent') || 'null'));
ok(rc && rc.version === '2026-10-04' && rc.signals.products && rc.signals.time && !rc.signals.actions && rc.at > 0, 'accepting stores a receipt: version, time, exact signals ' + JSON.stringify(rc?.signals));
ok(await ev(() => localStorage.getItem('xw.adOn') === 'true'), 'Adaptive is on');
await ev(() => document.querySelector('[data-ad="off"]')?.click()); await wait(300);
ok(await ev(() => localStorage.getItem('xw.adConsent') === 'null' && localStorage.getItem('xw.adOn') === 'false'), 'turning it off deletes history and the receipt');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
