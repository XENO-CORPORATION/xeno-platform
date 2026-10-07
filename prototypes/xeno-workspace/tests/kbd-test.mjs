import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const AXE = (() => { try { return fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { return null; } })();
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 }); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a);
const nav = async (h) => { await p.goto(url + '#/' + h); await p.reload(); await wait(700); if (process.env.MUT) await p.addStyleTag({ content: '*:focus,*:focus-visible{outline:none!important;box-shadow:none!important;border-color:inherit!important;background-color:inherit!important}' }); };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await wait(40); } await wait(150); };
// what has focus, and can a sighted keyboard user see it?
const focus = () => ev(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a), r = a.getBoundingClientRect();
  const on = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|'); const off = (() => { a.classList.add('kbd-probe'); const st = document.createElement('style'); st.textContent = '.kbd-probe,.kbd-probe:focus,.kbd-probe:focus-visible{}'; const c2 = getComputedStyle(a); const sOn = on; a.blur(); const sOff = [getComputedStyle(a).outlineStyle, getComputedStyle(a).outlineWidth, getComputedStyle(a).outlineColor, getComputedStyle(a).boxShadow, getComputedStyle(a).borderColor, getComputedStyle(a).backgroundColor].join('|'); a.focus({ focusVisible: true }); a.classList.remove('kbd-probe'); return sOff; })();
  const box = a.matches('input,textarea,[contenteditable]') ? a.closest('.pg-reply, .xd-field, label, .an-q') : null; const ring = on !== off || (box && box !== a && getComputedStyle(box).borderColor !== (() => { a.blur(); const c = getComputedStyle(box).borderColor; a.focus(); return c; })());
  return { tag: a.tagName, label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40), ring, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', inDialog: !!a.closest('.xd') }; });
const axeDialog = async (name) => { if (!AXE) return ok(true, `axe on “${name}” dialog skipped (axe-core not installed)`); await ev(AXE); const v = await ev(async () => (await window.axe.run('.xd', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map((x) => `${x.id}(${x.nodes.length})`)); ok(v.length === 0, `the “${name}” dialog has no WCAG 2.2 AA violations ${v.join(' ')}`); };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url);
await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });

// Tab walks the page; every stop is visible and shows focus
for (const r of ['overview/g/market/Brand checker', 'studio/g/projects/Brand refresh/Funding', 'overview/g/community/th_0', 'overview/g/places', 'overview/g/workspace/Company', 'overview/g/anima/Atlas — research/Mind']) {
  await nav(r); await ev(() => { const t = document.createElement('span'); t.tabIndex = -1; t.id = 'kbd-start'; document.querySelector('#main').prepend(t); t.focus(); }); const stops = []; for (let i = 0; i < 25; i++) { await key('Tab'); const f = await ev(() => !!document.activeElement?.closest('#main')) ? await focus() : null; if (f) stops.push(f); }
  const hidden = stops.filter((s) => !s.visible), noRing = stops.filter((s) => s.visible && !s.ring);
  ok(stops.length >= 2 && !hidden.length, `${r}: Tab reaches ${stops.length} controls, none invisible${hidden.length ? ' — ' + hidden.map((s) => s.label).join(', ') : ''}`);
  ok(!noRing.length, `${r}: every focused control shows a focus ring${noRing.length ? ' — missing on ' + [...new Set(noRing.map((s) => s.tag + ':' + s.label))].slice(0, 5).join(' | ') : ''}`);
}
// a dialog: opened by keyboard, focus moves in and stays in, Escape closes and returns focus to its opener
await nav('overview/g/market/Brand checker');
await ev(() => document.querySelector('#main [data-xa="getListing"]').focus()); const opener = await focus(); await key('Enter'); await wait(300);
let f = await focus(); ok(f?.inDialog, `Enter on “${opener?.label}” opens its dialog and moves focus into it (${f?.label})`);
await axeDialog('Subscribe');
let escaped = false; for (let i = 0; i < 14; i++) { await key('Tab'); f = await focus(); if (!f?.inDialog) { escaped = true; break; } }
ok(!escaped, 'Tab stays inside the open dialog');
await key('Escape'); await wait(300); f = await focus(); ok(!(await ev(() => !!document.querySelector('.xd'))) && f?.label === opener?.label, `Escape closes it and focus returns to “${opener?.label}” (${f?.label})`);
// more dialogs, audited open
await nav('studio/g/projects/Brand refresh/Funding'); await ev(() => document.querySelector('#main [data-fd="contribute"]').click()); await wait(400); await axeDialog('Contribute'); await key('Escape');
await nav('overview'); await key('F1'); await wait(300); await axeDialog('Report a problem'); await key('Escape');
await ev(() => { window.XENO_NET.panel(); }); await wait(300); await axeDialog('Prototype controls'); await key('Escape');
await nav('overview/g/workspace/Company'); await ev(() => document.querySelector('#main [data-co="addReg"]').click()); await wait(400); await axeDialog('Add a registration'); await key('Escape');
// the Places building is fully operable without a mouse
await nav('overview/g/places'); await ev(() => document.querySelector('#main .pl-desk').focus()); await key('Enter'); ok(await ev(() => !!document.querySelector('#main .pl-peek')), 'Enter on a desk opens the person’s card');
await key('Escape'); ok(await ev(() => !document.querySelector('#main .pl-peek')), 'Escape closes it');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
