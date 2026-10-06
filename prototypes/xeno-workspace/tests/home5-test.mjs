import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const nav = async (r) => { await p.goto(url + '#/' + r); await p.reload(); await wait(1000); };
const into = (sel) => ev((s) => { const n = document.querySelector(s); const mv = document.querySelector('#main .mview'); mv.scrollTop = n.getBoundingClientRect().top - mv.getBoundingClientRect().top + mv.scrollTop - 80; }, sel);
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
// numbers: hover reads a day
await nav('dev'); const box = await ev(() => { const r = document.querySelector('.kpi .hc').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
await p.mouse.move(box[0] + 2, box[1] + box[3] / 2); await wait(150);
let g = await ev(() => ({ on: document.querySelector('.kpi .hc').classList.contains('on'), tip: document.querySelector('.kpi .hc-tip').textContent }));
ok(g.on && /^[A-Z][a-z]{2} \d+ · 22$/.test(g.tip), `hovering a number's line reads that day: "${g.tip}"`);
await p.mouse.move(box[0] + box[2] - 1, box[1] + box[3] / 2); await wait(120); g = await ev(() => document.querySelector('.kpi .hc-tip').textContent); ok(/^Today · 37$/.test(g), `…and the right edge is today: "${g}"`);
// Dev: the log streams, the timer runs, the waiting run quotes its question, now line on the 24 h track
const l0 = await ev(() => [...document.querySelectorAll('[data-live-run] .rb-log li')].map((x) => x.textContent).join('|')); const t0 = await ev(() => document.querySelector('[data-live-elapsed]').textContent);
await wait(4800); const l1 = await ev(() => [...document.querySelectorAll('[data-live-run] .rb-log li')].map((x) => x.textContent).join('|')); const t1 = await ev(() => document.querySelector('[data-live-elapsed]').textContent);
const n1 = await ev(() => document.querySelectorAll('[data-live-run] .rb-log li').length);
ok(l0 !== l1 && n1 <= 4, `the running card streams its log in a fixed window (${n1} lines shown)`); ok(t0 !== t1 && /min \d\d s/.test(t1), `its timer runs (${t0} → ${t1})`);
g = await ev(() => document.querySelector('.rb-c.wait .rb-q').textContent); ok(/delete the retry wrapper/.test(g), `the waiting run shows the agent's actual question: ${g}`);
g = await ev(() => { const fails = document.querySelectorAll('.tl24-m.failed').length, now = !!document.querySelector('.tl24-now'), next = document.querySelectorAll('.tl24-m.next').length, h = new Date().getHours(); return { fails, now, next, h }; });
ok(g.fails === 2 && g.now, `24-hour line: 2 failed runs marked, a now line (${JSON.stringify(g)})`);
// Studio: the render advances on its own, frames fill behind the playhead
await nav('studio'); const r0 = await ev(() => ({ pct: document.querySelector('[data-live-pct]').textContent, done: document.querySelectorAll('.fs-f.done').length, head: document.querySelector('.fs-head').style.left }));
await wait(3300); const r1 = await ev(() => ({ pct: document.querySelector('[data-live-pct]').textContent, done: document.querySelectorAll('.fs-f.done').length, head: document.querySelector('.fs-head').style.left, frames: document.querySelector('[data-live-frames]').textContent }));
ok(parseInt(r1.pct) > parseInt(r0.pct) && r1.head !== r0.head && /frame [\d,]+ of 2,448/.test(r1.frames), `the render advances: ${r0.pct} → ${r1.pct}, ${r1.frames}`);
ok(r1.done === Math.floor((parseInt(r1.pct) / 100) * 14), `rendered frames match the progress (${r1.done} of 14 at ${r1.pct})`);
g = await ev(() => [...document.querySelectorAll('.hw-t')].map((t) => +getComputedStyle(t).getPropertyValue('--ar')).filter((a, i, all) => all.indexOf(a) === i).length);
ok(g >= 3, `the work wall keeps each file's own proportions (${g} different aspect ratios)`);
// Social: posts sit at their hour
await nav('social'); g = await ev(() => [...document.querySelectorAll('.wk-p')].map((x) => [x.querySelector('small').textContent.slice(0, 5), Math.round(parseFloat(x.style.top))]));
ok(g.every(([t, top]) => Math.abs(top - Math.round(((parseInt(t) - 8) / 14) * 100)) <= 1), `every post sits at its hour on the day axis (${g.map((x) => x.join('@')).join(', ')})`);
g = await ev(() => document.querySelector('[data-hsec="sig"] h2').textContent); ok(g === 'The week ahead', `the calendar has its own heading (${g})`);
// Corpo: the revenue chart reads by keyboard
await nav('corpo'); await into('.cp-rev .hc'); await ev(() => document.querySelector('.cp-rev .hc').focus()); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await wait(100);
g = await ev(() => ({ tip: document.querySelector('.cp-rev .hc-tip').textContent, label: document.querySelector('.cp-rev .hc').getAttribute('aria-label') }));
ok(/^\d+ [A-Z][a-z]{2} · €2,420$/.test(g.tip) && /arrow keys/.test(g.label), `arrow keys read the revenue chart point by point: "${g.tip}"`);
// Tools: dropping a file lights up the tools that fit it
await nav('tools'); await ev(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'holiday.png', { type: 'image/png' })); const z = document.querySelector('[data-tool-drop]'); z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }); await wait(200);
g = await ev(() => ({ fit: [...document.querySelectorAll('.tg-t.fit b')].map((x) => x.textContent), msg: document.querySelector('[data-td-s]').textContent, title: document.querySelector('[data-td-t]').textContent }));
ok(g.title === 'holiday.png' && g.fit.join() === 'Image resize,Remove background,Upscale' && /3 tools can work on this image/.test(g.msg), `a dropped image lights up the 3 image tools: ${g.fit.join(', ')}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
