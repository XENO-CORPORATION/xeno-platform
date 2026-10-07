import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const nav = async (r) => { await p.goto(url + '#/' + r.split('/').map(encodeURIComponent).join('/')); await p.reload(); await wait(1000); await idle(); };
const clickText = (sel, re) => ev((s, r) => { const n = [...document.querySelectorAll(s)].find((x) => x.offsetParent && new RegExp(r).test(x.textContent)); if (n) n.click(); return !!n; }, sel, re.source);
const dlg = () => ev(() => { const d = [...document.querySelectorAll('.xd')].pop(); return d && { title: d.querySelector('.xd-head b')?.textContent, text: d.textContent }; });
const submit = async () => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(450); await idle(); };
const setField = (id, v) => ev((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const pickOpt = (f, v) => ev((f2, v2) => [...document.querySelectorAll(`.xd [data-f="${f2}"] [data-v]`)].find((x) => x.dataset.v === v2).click(), f, v);
const hash = () => ev(() => decodeURIComponent(location.hash));
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });

// ---- members ----
await nav('overview/g/workspace/Members'); await clickText('#main .pg-tr[data-pg-ws]', /^MMira/); await wait(500);
let g = await ev(() => ({ h: location.hash, t: document.querySelector('#main .pg-top .crumbs, #main h1')?.textContent, acts: [...document.querySelectorAll('#main .pg-top-acts button')].map((x) => x.textContent.trim()) }));
ok(/Members%2FMira|Members\/Mira/.test(g.h) && g.acts.includes('Change role'), `a member opens their own page with real actions (${g.acts.join(', ')})`);
await clickText('#main .pg-top-acts button', /^Change role/); await wait(300); await pickOpt('role', 'member'); await submit();
g = await ev(() => window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Mira').role); ok(g === 'member', `Change role changes it (${g})`);
await p.reload(); await wait(1000); g = await ev(() => window.XENO_PG_WORKSPACE.members.find((m) => m.name === 'Mira').role); ok(g === 'member', '…and it survives a reload');
// ---- knowledge ----
await nav('overview/g/workspace/Divisions'); await ev(() => document.querySelector('[data-wf="seed"]').click()); await wait(400);   /* divisions are opt-in (WORKFORCE DIV-03) */
await nav('overview/g/workspace/Knowledge'); await clickText('#main .pg-tr[data-pg-ws]', /Product principles/); await wait(500);
g = await ev(() => document.querySelector('#main .pg-props')?.textContent); ok(/Access/.test(g || ''), 'a knowledge source opens its own page');
await clickText('#main .pg-top-acts button', /^Change access/); await wait(300); g = await ev(() => [...document.querySelectorAll('.xd [data-f="a"] [data-v]')].map((x) => x.dataset.v)); await pickOpt('a', g[1]); await submit();
g = await ev(() => window.XENO_PG_WORKSPACE.knowledge.find((k) => k.name === 'Product principles').access); ok(g !== 'Everyone', `Change access limits it to a division (${g})`);
// ---- leaving as owner hands the workspace on ----
await nav('overview/g/workspace/Settings'); await clickText('#main button', /^Leave workspace/); await wait(300); let d = await dlg();
ok(d && /Leave/.test(d.title) && /New owner/.test(d.text), `an owner leaving must choose the next owner first (${d && d.title})`); await p.keyboard.press('Escape'); await wait(300);
// ---- Community thread ----
await nav('overview/g/community'); await clickText('#main .pg-tr[data-pg-gitem]', /How do I export/); await wait(500);
g = await ev(() => ({ posts: document.querySelectorAll('#main .pg-post').length, form: !!document.querySelector('#main [data-reply]') })); ok(g.posts > 0 && g.form, `a thread opens with its replies and a reply box (${g.posts} replies)`);
await ev(() => { const t = document.querySelector('#main [data-reply] textarea'); t.value = 'Exporting from the Library keeps the live text.'; }); await ev(() => document.querySelector('#main [data-reply] button[type=submit]').click()); await wait(400);
g = await ev(() => [...document.querySelectorAll('#main .pg-post p')].pop().textContent); ok(/keeps the live text/.test(g), 'posting a reply adds it to the thread');
await p.reload(); await wait(1000); g = await ev(() => [...document.querySelectorAll('#main .pg-post p')].map((x) => x.textContent).some((x) => /keeps the live text/.test(x))); ok(g, '…and it is there after a reload');
await clickText('#main .pg-top-acts button', /^Follow/); await wait(300); g = await ev(() => [...document.querySelectorAll('#main .pg-top-acts button')].map((x) => x.textContent.trim())); ok(g.includes('Following'), 'Follow subscribes to the thread');
// ---- Marketplace ----
await nav('overview/g/market');
const tryGet = async (re) => { const ok2 = await clickText('#main .pg-card--lst .pg-btn', re); await wait(350); return ok2; };
g = await ev(() => window.XENO_PG_MARKET.filter((x) => !x.owned).map((x) => x.price)); const n0 = g.length;
if (await tryGet(/^Get$/)) { d = await dlg(); ok(d && /^Add /.test(d.title) && /It will be able to/.test(d.text), `Get shows what the listing will be able to do (${d && d.title})`); await submit(); }
await nav('overview/g/market/Minds');
if (await tryGet(/^Rent$/)) { d = await dlg(); ok(d && /Monthly limit/.test(d.text) && /owner never sees your data/.test(d.text), 'Rent sets a monthly limit and says what the renter keeps'); await submit(); }
await nav('overview/g/market');
if (await tryGet(/^Buy$/)) { d = await dlg(); ok(d && /Test checkout/.test(d.text), 'Buy shows the order and says plainly it is a test checkout'); await submit(); }
await p.reload(); await wait(1000); g = await ev(() => window.XENO_PG_MARKET.filter((x) => !x.owned).length); ok(g === n0 - 3, `three acquisitions stick after a reload (${n0} → ${g} not owned)`);
await nav('overview/g/market/Seller console'); await clickText('#main button', /^Create a listing/); await wait(300); await setField('name', 'Shot list builder'); await setField('blurb', 'Turns a script into a shot list'); await submit();
g = await ev(() => window.XENO_PG_MARKET.find((x) => x.name === 'Shot list builder')); ok(g && g.review === 'in review', 'Create a listing submits it for review');
// ---- request access ----
await ev(() => { localStorage.setItem('xw.pgState', JSON.stringify({ library: 'denied' })); }); await nav('overview/g/library');
await clickText('#main button', /^Request access/); await wait(400); g = await ev(() => [...document.querySelectorAll('#main button')].some((x) => /Request sent/.test(x.textContent))); ok(g, 'Request access sends it and the button says so');
await ev(() => localStorage.removeItem('xw.pgState'));
// ---- projects: a task, a waiting item, a chat ----
await p.goto(url + '#/studio/g/projects/' + encodeURIComponent('Brand refresh/Tasks')); await p.reload(); await wait(1100); await ev(() => document.querySelector('#main .pg-task').click()); await wait(350);
d = await dlg(); ok(d && /Status/.test(d.text) && /Assignee/.test(d.text), `a task opens for editing (${d && d.title})`); const tTitle = d.title;
await pickOpt('state', 'done'); await submit(); g = await ev((t) => window.XENO_PROJECTS['Brand refresh'].taskObjs.find((x) => x.title === t).state, tTitle); ok(g === 'done', `…and saving moves it to Done (${g})`);
await p.goto(url + '#/studio/g/projects/' + encodeURIComponent('Brand refresh/Conversations')); await p.reload(); await wait(1100); const c0 = await ev(() => window.XENO_PROJECTS['Brand refresh'].chats.length);
if (await clickText('#main button', /^New chat in this project/)) { await wait(500); g = await ev(() => ({ n: window.XENO_PROJECTS['Brand refresh'].chats.length, h: location.hash })); ok(g.n === c0 + 1 && /p\/chat/.test(g.h), 'New chat in this project starts one there'); }
// ---- agent runs ----
await nav('dev/z/agents/Fix flaky test'); await clickText('#main .pg-answer button', /^Allow$/); await wait(400);
g = await ev(() => Object.values(window.XENO_PG_AREAS).flatMap((A) => A.rows.filter((r) => r[0] === 'Fix flaky test').map((r) => r[A.cols.indexOf('Status')]))[0]); ok(g === 'Running', `Allow lets the agent continue (status ${g})`);
await nav('dev/z/agents/Upgrade electron'); await clickText('#main .pg-answer button', /^Retry$/); await wait(400);
g = await ev(() => Object.values(window.XENO_PG_AREAS).flatMap((A) => A.rows.filter((r) => r[0] === 'Upgrade electron').map((r) => r[A.cols.indexOf('Status')]))[0]); ok(g === 'Running', `Retry starts it again (status ${g})`);
// ---- Anima ----
await nav('overview/g/anima/Atlas'); await clickText('#main .pg-top-acts button', /^Chat with/); await wait(700);
g = await ev(() => document.querySelector('#main textarea')?.value); ok(g === '@Atlas ', `Chat with Atlas opens a chat addressed to it ("${g}")`);
// ---- product views ----
await nav('studio/p/canvas/Recent'); g = await ev(() => ({ cards: document.querySelectorAll('#main [data-pg-file]').length, h1: document.querySelector('#main .pg-top .crumbs')?.textContent })); ok(g.cards > 0, `Canvas › Recent lists Canvas files (${g.cards})`);
await nav('social/p/post/Calendar'); g = await ev(() => document.querySelector('#main .pg-state b')?.textContent); ok(/Calendar lives in Post/.test(g || ''), `a view that belongs to the product says where it lives ("${g}")`);
await nav('corpo/p/company/Members'); await wait(300); g = await hash(); ok(/g\/workspace\/Members$/.test(g), `Company › Members is the workspace's Members page — one source (${g})`);
// ---- office home ----
await nav('office'); await ev(() => document.querySelector('#main [data-xa="openEvent"]').click()); await wait(350); d = await dlg(); ok(d && /Join call/.test(d.text), `an agenda event opens with its actions (${d && d.title})`); await p.keyboard.press('Escape'); await wait(300);
const m0 = await ev(() => window.XENO_HOME.office.mail.length); await ev(() => document.querySelector('#main [data-xa="archiveMail"]').click()); await wait(300);
g = await ev(() => window.XENO_HOME.office.mail.length); ok(g === m0 - 1, 'Archive removes the mail'); await ev(() => document.querySelector('.pg-undo').click()); await wait(300); g = await ev(() => window.XENO_HOME.office.mail.length); ok(g === m0, '…and Undo brings it back');
// ---- chat sidebar: scheduled + all chats ----
await nav('studio/p/chat'); await ev(() => document.querySelector('#panel [data-xa="scheduled"]').click()); await wait(350);
g = await ev(() => document.querySelectorAll('.xd .xd-list li').length); ok(g === 2, `Scheduled lists the scheduled prompts (${g})`);
await ev(() => document.querySelector('.xd [data-xd-act]').click()); await wait(350); await setField('name', 'Friday wrap-up'); await setField('prompt', 'What shipped this week'); await submit(); await wait(200);
g = await ev(() => [...document.querySelectorAll('.xd .xd-list b')].map((x) => x.textContent)); ok(g[0] === 'Friday wrap-up', `a new scheduled task appears at the top (${g.join(', ')})`);
await ev(() => document.querySelector('.xd [data-sc-tog]').click()); await wait(200); g = await ev(() => document.querySelector('.xd .xd-list li').className); ok(/off/.test(g), 'Pause pauses it');
await p.keyboard.press('Escape'); await wait(350);
await ev(() => document.querySelector('#panel [data-xa="allChats"]').click()); await wait(350);
const allN = await ev(() => document.querySelectorAll('.xd .xd-chat').length); await ev(() => { const i = document.querySelector('.xd input[type=search]'); i.value = 'hero'; i.dispatchEvent(new Event('input')); }); await wait(100);
g = await ev(() => [...document.querySelectorAll('.xd .xd-chat span')].map((x) => x.textContent)); ok(allN > 3 && g.length >= 1 && g.length < allN && g.every((x) => /hero/i.test(x)), `All chats is searchable (${allN} → ${g.length} for "hero")`);
await p.keyboard.press('Escape'); await wait(300);
// ---- custom modes ----
await ev(() => document.querySelector('#logo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); await wait(400);
g = await ev(() => !!document.querySelector('.msw-row[data-mode="c-agency"]')); ok(g, 'the switcher lists the custom mode as a real mode');
await ev(() => document.querySelector('.msw-row[data-mode="c-agency"]').click()); await wait(700);
g = await ev(() => ({ h: location.hash, secs: [...document.querySelectorAll('#panel .sec .sh .t')].map((x) => x.textContent.trim()), zones: [...document.querySelectorAll('#rail [data-zone]')].length }));
ok(/#\/c-agency/.test(g.h) && g.zones >= 2, `opening it renders it with the one shell — its own areas, by where products come from (${JSON.stringify(g)})`);
await p.reload(); await wait(1000); g = await ev(() => ({ h: location.hash, err: !!document.querySelector('#main') })); ok(/#\/c-agency/.test(g.h), `a custom mode is a real address — a reload lands back on it (${g.h})`);
await ev(() => document.querySelector('#logo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); await wait(400);
await ev(() => document.querySelector('.msw-row[data-xa="customMode"]').click()); await wait(400); d = await dlg(); ok(d && /New custom mode/.test(d.title), 'New custom mode opens the builder');
await setField('name', 'Launch room'); await ev(() => { ['post', 'motion', 'docs'].forEach((v) => [...document.querySelectorAll('.xd [data-f="products"] [data-v]')].find((x) => x.dataset.v === v)?.click()); }); await submit(); await wait(500);
g = await ev(() => ({ h: location.hash, list: window.XENO_CUSTOM.list().map((c) => c.name), mark: window.XENO_MODE_MARKS[location.hash.split('/')[1]]?.name })); ok(g.list.includes('Launch room') && g.mark === 'Launch room', `the builder creates the mode and opens it (${g.h})`);
const cid = await ev(() => location.hash.split('/')[1]); await ev((id) => { window.XA.deleteCustomMode(id); }, cid); await wait(300); await submit(); await wait(300);
g = await ev(() => ({ list: window.XENO_CUSTOM.list().map((c) => c.name), h: location.hash })); ok(!g.list.includes('Launch room') && /overview/.test(g.h), `Delete removes it and leaves for Overview (${g.h})`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 6)); await b.close();
