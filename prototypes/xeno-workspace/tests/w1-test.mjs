import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' | ')));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const stubOpen = () => ev(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
const nav = async (r) => { await p.goto(url + '#/' + r); await p.reload(); await wait(1000); await stubOpen(); };
const click = (sel) => ev((s) => { const n = [...document.querySelectorAll(s)].find((x) => x.offsetParent); n.click(); return !!n; }, sel);
const dialog = () => ev(() => { const d = [...document.querySelectorAll('.xd')].filter((x) => !x.closest('.out,.closing')).pop(); return d && { title: d.querySelector('#xd-t')?.textContent, text: d.textContent }; });
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });

// ---- Notify me: a launch watch that persists and reflects everywhere ----
await nav('studio/p/photo');
let g = await ev(() => [...document.querySelectorAll('[data-xl-notify]')].filter((n) => n.offsetParent).length); ok(g >= 2, `a planned product shows its Notify buttons (${g})`);
await click('#panel [data-xl-notify]'); await wait(200);
g = await ev(() => [...document.querySelectorAll('[data-xl-notify]')].filter((n) => n.offsetParent).map((n) => n.getAttribute('aria-pressed') + ':' + n.textContent.trim()));
ok(g.every((x) => x === 'true:Notifying you'), `pressing one updates every Notify button for that product (${g.join(' | ')})`);
g = await ev(() => document.getElementById('toast').textContent); ok(/We’ll tell you when Photo launches/.test(g), `…with an undoable confirmation ("${g}")`);
await p.reload(); await wait(1000); g = await ev(() => document.querySelector('#panel [data-xl-notify]')?.getAttribute('aria-pressed')); ok(g === 'true', 'the watch survives a reload');
await click('#panel [data-xl-notify]'); await wait(150); await ev(() => document.querySelector('.pg-undo')?.click()); await wait(150);
g = await ev(() => document.querySelector('#panel [data-xl-notify]').getAttribute('aria-pressed')); ok(g === 'true', 'Undo puts the watch back');

// ---- Open in Hub: the real xeno:// deep link, then an honest fallback ----
await nav('studio/p/pixel');
await click('#panel [data-xl-hub]'); await wait(120);
g = await ev(() => [...document.querySelectorAll('iframe')].map((f) => f.src)); ok(g.includes('xeno://app/pixel'), `Open in Hub fires the deep link Hub registers (${g.join(',')})`);
let d = await ev(() => document.getElementById('toast').textContent); ok(/Opening Pixel in XENO Hub/.test(d) && /Try again/.test(d) && /Get XENO Hub/.test(d), `it never guesses whether Hub answered: Try again and Get XENO Hub stay in reach ("${d}")`);
await ev(() => document.querySelector('#toast [data-xl-gethub]').click()); await wait(200);
g = await ev(() => window.__opened); ok(g.includes('https://xenostudio.ai/product/hub/download'), `"Get XENO Hub" opens Hub's real download page (${g})`);

// ---- Download: choose the OS, continue on xenostudio.ai ----
await nav('studio/p/pixel'); await click('#main [data-xl-download]'); await wait(300);
d = await dialog(); ok(d && /Download Pixel/.test(d.title) && /paid plan/.test(d.text), `Download explains the plan rule and asks for the OS (${d && d.title})`);
await ev(() => document.querySelector('.xd [data-xd-submit]').click()); await wait(300);
g = await ev(() => window.__opened); ok(/^https:\/\/xenostudio\.ai\/product\/pixel\/download\/(win|mac|linux)$/.test(g[0] || ''), `…and continues to the platform's download route (${g[0]})`);

// ---- New work: a real item, in Recent and Library, opened ----
await nav('studio/p/canvas');
const lib0 = await ev(() => window.XENO_PG_LIBRARY.items.length);
await click('#panel [data-xl-new]'); await wait(500);
g = await ev(() => ({ hash: decodeURIComponent(location.hash), recent: window.XENO_RECENT[0], lib: window.XENO_PG_LIBRARY.items.length, row: [...document.querySelectorAll('#panel [data-item]')].some((n) => /^Untitled/.test(n.dataset.item) || n.dataset.item === 'Recent') }));   // Canvas lists Recent as a destination
ok(g.recent.p === 'canvas' && /^Untitled/.test(g.recent.t) && g.lib === lib0 + 1 && /p\/canvas\/Untitled/.test(g.hash) && g.row, `"New design file" creates the item, lists it and opens it (${g.hash})`);
// recent rows open their item
await nav('studio/p/pixel'); const r0 = await ev(() => { const n = [...document.querySelectorAll('#panel [data-item][data-item-p="pixel"]')].find((x) => x.offsetParent); n.click(); return n.dataset.item; }); await wait(400);
g = await ev(() => decodeURIComponent(location.hash)); ok(g.endsWith('/p/pixel/' + r0), `a recent file in the product sidebar opens it (${g})`);
// All Pixel projects → Projects filtered to Pixel
await click('#panel [data-projects-of]'); await wait(700);
g = await ev(() => ({ hash: location.hash, q: document.querySelector('#main [data-pg-q]')?.value })); ok(/g\/projects$/.test(g.hash) && g.q === 'Pixel', `"All Pixel projects" opens Projects filtered to Pixel (${JSON.stringify(g)})`);

// ---- one workspace list ----
await nav('overview/g/workspace/Switch workspace');
g = await ev(() => [...document.querySelectorAll('#main .pg-card--div b')].map((x) => x.textContent)); ok(g.join() === 'Personal,XENO Corp,Lumen Studio,Create a company', `the switcher shows the one workspace list (${g.join(', ')})`);
await ev(() => [...document.querySelectorAll('#main .pg-card--div')].find((x) => /XENO Corp/.test(x.textContent)).click()); await wait(500);
g = await ev(() => ({ av: document.querySelector('#rail .avatar')?.textContent, cur: [...document.querySelectorAll('#main .pg-card--div[aria-current="true"] b')].map((x) => x.textContent) }));
ok(g.av === 'X' && g.cur.join() === 'XENO Corp', `switching updates the rail avatar and the current card (${JSON.stringify(g)})`);
await click('#rail [data-go="account"]'); await wait(300);
g = await ev(() => [...document.querySelectorAll('#menu .acc-ws:not(.acc-new) b')].map((x) => x.textContent)); ok(g.join() === 'Personal,XENO Corp,Lumen Studio', `the account popover reads the same list (${g.join(', ')})`);
await ev(() => document.querySelector('#menu [data-act="company"]').click()); await wait(300);
await ev(() => { const i = document.querySelector('#xdf-name'); i.value = 'Orbit Labs'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await ev(() => document.querySelector('.xd [data-xd-submit]').click()); await wait(500);
g = await ev(() => ({ av: document.querySelector('#rail .avatar')?.textContent, list: window.XA.workspaces().map((w) => w.name) })); ok(g.av === 'O' && g.list.includes('Orbit Labs'), `Create a company adds it and switches to it (${JSON.stringify(g)})`);

// ---- sign out ----
await click('#rail [data-go="account"]'); await wait(300); await ev(() => document.querySelector('#menu [data-act="signout"]').click()); await wait(300);
await ev(() => document.querySelector('.xd [data-xd-submit], .xd .xd-btn:not(.ghost)').click()); await wait(400);
g = await ev(() => !!document.getElementById('signedout')); ok(g, 'Sign out ends the session: the workspace yields to the signed-out card');
await p.reload(); await wait(1000); g = await ev(() => !!document.getElementById('signedout')); ok(g, '…and a reload stays signed out');
await ev(() => document.querySelector('[data-so-in]').click()); await wait(300); g = await ev(() => !document.getElementById('signedout')); ok(g, 'Sign in returns to the workspace');

// ---- report (F1), what's new, status, credits ----
await nav('overview'); await p.keyboard.press('F1'); await wait(300);
d = await dialog(); ok(d && /Report a problem/.test(d.title) && /Technical details/.test(d.text), `F1 opens the report window with the technical details it will attach (${d && d.title})`);
await ev(() => { const i = document.querySelector('#xdf-title'); i.value = 'Export stops at 80 %'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await ev(() => document.querySelector('.xd [data-xd-submit]').click()); await wait(400);
g = await ev(() => window.XENO_PG_FORUM[0]); ok(g.title === 'Export stops at 80 %' && !!g.diag, `a public report becomes a Community thread with the details attached (${g.title})`);
await p.keyboard.press('F1'); await wait(300);
await ev(() => { const i = document.querySelector('#xdf-title'); i.value = 'Billing question'; i.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('.xd [data-f="vis"] [data-v]')].find((x) => x.dataset.v === 'private').click(); }); await ev(() => document.querySelector('.xd [data-xd-submit]').click()); await wait(400);
g = await ev(() => ({ t: JSON.parse(localStorage.getItem('xw.tickets2'))?.[0], toast: document.getElementById('toast').textContent })); ok(g.t?.title === 'Billing question' && /Ticket #\d+/.test(g.toast), `a private report becomes a ticket ("${g.toast}")`);
await click('#rail [data-go="help"]'); await wait(300); await ev(() => document.querySelector('#menu [data-hp="new"]').click()); await wait(300);
g = await ev(() => [...document.querySelectorAll('.xd .xd-rel a')].map((a) => a.href)); ok(g.length >= 5 && g.every((h) => /^https:\/\/xenostudio\.ai\/product\/[a-z]+\/releases$/.test(h)), `What's new lists real releases linked to their release notes (${g.length})`);
await p.keyboard.press('Escape'); await wait(300);
await click('#rail [data-go="help"]'); await wait(300); g = await ev(() => document.querySelector('#menu .pp-status')?.textContent.trim()); ok(g === 'Connected', `the help footer states the real connection, not "All systems normal" (${g})`);
await ev(() => document.querySelector('#menu [data-hp="status"]').click()); await wait(300); d = await dialog(); await wait(200); d = await dialog(); ok(d && /Online/.test(d.text) && /not live yet/.test(d.text), 'Status shows only what the device knows, and says the public status page is not live');
await p.keyboard.press('Escape'); await wait(300);
await click('#rail [data-go="usage"]'); await wait(300); await ev(() => document.querySelector('#menu [data-us="buy"]').click()); await wait(200);
g = await ev(() => window.__opened); ok(g.includes('https://xenostudio.ai/pricing#credits'), `Buy credits goes to the real pricing page (${g})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 6)); await b.close();
