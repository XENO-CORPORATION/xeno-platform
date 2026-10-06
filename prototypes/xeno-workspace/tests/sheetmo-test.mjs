import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
const sample = (sel, ms) => p.evaluate(({ sel, ms }) => new Promise((res) => { const out = [], t0 = performance.now(); const tick = () => { const e = document.querySelector(sel), cs = e && getComputedStyle(e); const m = cs && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : null; out.push({ t: Math.round(performance.now() - t0), o: cs ? +(+cs.opacity).toFixed(2) : -1, s: m ? +m.a.toFixed(3) : 1, y: m ? +m.f.toFixed(1) : 0, vis: !!e && e.offsetParent !== null }); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); }), { sel, ms });
await p.setViewport({ width: 1600, height: 950 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.goto(url + '#/studio'); await p.reload(); await wait(800);
// open through Help → Mode intro, and sample the sheet as it arrives
await p.click('#rail [data-go="help"]'); await wait(350);
const openP = sample('#modeIntro .mi', 700); await p.click('#menu [data-hp="intro"]'); const op = await openP;
const first = op.find((f) => f.vis), last = op[op.length - 1];
ok(first && first.o < 0.5 && first.s < 0.99 && first.y > 3, `opens from below and smaller (first visible frame: opacity ${first?.o}, scale ${first?.s}, y ${first?.y})`);
ok(last.o === 1 && Math.abs(last.s - 1) < 0.002 && Math.abs(last.y) < 0.5, `settles exactly in place (opacity ${last.o}, scale ${last.s}, y ${last.y})`);
const mono = op.filter((f) => f.vis).every((f, i, a) => i === 0 || f.s >= a[i - 1].s - 0.001); ok(mono, 'scale only ever grows while opening (no bounce back)');
const staged = await ev(() => { const c = [...document.querySelectorAll('#modeIntro .mi-copy > *')].map((x) => getComputedStyle(x).animationDelay); return c.join(' '); });
ok(/0\.08s/.test(staged) && /0\.2s/.test(staged), 'the right column arrives in a stagger');
// close: still on screen while it leaves, then gone
const closeP = sample('#modeIntro .mi', 420); await p.keyboard.press('Escape'); const cl = await closeP;
const mid = cl.find((f) => f.t > 60 && f.t < 160);
ok(mid && mid.vis && mid.o < 1 && mid.o > 0, `stays visible while it closes (at ${mid?.t}ms opacity ${mid?.o})`);
ok(cl.filter((f) => f.vis).every((f, i, a) => i === 0 || f.o <= a[i - 1].o + 0.01), 'opacity only falls while closing');
ok(!cl[cl.length - 1].vis, `and is gone once the exit has played (by ${cl.find((f) => !f.vis)?.t}ms)`);
// reopen mid-close cancels the close
await p.click('#rail [data-go="help"]'); await wait(350); await p.click('#menu [data-hp="intro"]'); await wait(700);
await p.keyboard.press('Escape'); await wait(80);
await p.click('#rail [data-go="help"]').catch(() => {}); await wait(350); await ev(() => document.querySelector('#menu [data-hp="intro"]')?.click()); await wait(700);
ok(await ev(() => document.getElementById('modeIntro').classList.contains('on') && !document.getElementById('modeIntro').classList.contains('closing')), 'reopening while it closes cancels the close');
await p.keyboard.press('Escape'); await wait(400);
// Adaptive sheet gets the same
await ev(() => { localStorage.setItem('xw.adOn', 'false'); }); await p.click('#logo', { button: 'right' }); await wait(300);
const adP = sample('#adModal .adx', 600); await ev(() => document.querySelector('[data-adaptive]').click()); const ad = await adP;
const af = ad.find((f) => f.vis);
ok(af && af.s < 0.99 && ad[ad.length - 1].s > 0.998, `the Adaptive sheet opens the same way (first scale ${af?.s})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
