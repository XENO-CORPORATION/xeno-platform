import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack).split('\n')[1]));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const go = async (id) => { await ev((i) => window.XENO_SETTINGS.go(i), id); await wait(450); await ev(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); }; }); };
const act = async (a, arg) => { await ev((x, y) => { const n = [...document.querySelectorAll('#main [data-set]')].find((e) => e.dataset.set === x && (y == null || e.dataset.arg === y)); n.click(); }, a, arg ?? null); await wait(350); await idle(); };
const dlg = () => ev(() => { const d = [...document.querySelectorAll('.xd')].pop(); return d && { title: d.querySelector('.xd-head b')?.textContent, text: d.textContent }; });
const submit = async () => { await ev(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit], .xd-foot .xd-btn:not(.ghost)').click()); await wait(450); await idle(); };
const setF = (id, v) => ev((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const pick = (f, v) => ev((f2, v2) => [...document.querySelectorAll(`.xd [data-f="${f2}"] [data-v]`)].find((x) => x.dataset.v === v2).click(), f, v);
const acct = () => ev(() => JSON.parse(localStorage.getItem('xw.acct') || '{}'));
const closeAll = async () => { for (let i = 0; i < 3; i++) { if (!(await ev(() => !!document.querySelector('.xd')))) break; await p.keyboard.press('Escape'); await wait(300); } };
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url); await ev(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.reload(); await wait(900);

await p.keyboard.down('Control'); await p.keyboard.press(','); await p.keyboard.up('Control'); await wait(700);
let g = await ev(() => ({ h: decodeURIComponent(location.hash), side: [...document.querySelectorAll('#panel [data-item]')].length, dup: !!document.querySelector('#main .set-nav') }));
ok(/g\/settings\//.test(g.h) && g.side >= 19 && !g.dup, `Ctrl+, opens the full-page account centre; the sidebar is its one nav (${g.side} sections)`);
await p.reload(); await wait(900); g = await ev(() => decodeURIComponent(location.hash)); ok(/g\/settings\//.test(g), 'each section has a real address that survives a reload');
// profile
await go('profile'); await act('editProfile'); await setF('bio', 'Building XENO.'); await submit(); g = await acct(); ok(g.profile?.bio === 'Building XENO.', 'Edit profile saves');
await act('changeEmail'); g = await dlg(); ok(/Confirm it’s you/.test(g.title), 'changing email asks you to confirm it’s you first'); await submit(); await wait(200); await setF('e', 'new@xeno.test'); await submit();
g = await acct(); ok(g.profile.pending === 'new@xeno.test' && g.profile.email !== 'new@xeno.test', 'the new email waits for its confirmation link — it does not change yet');
// security: passkey within the unlocked 10 minutes asks no second time
await go('security'); await act('addPasskey'); g = await dlg(); ok(/Add a passkey/.test(g.title), 'once confirmed, the next sensitive action within 10 minutes does not ask again'); await submit();
g = await acct(); ok(g.passkeys.length === 2, `a passkey is added (${g.passkeys.length})`);
await act('codes'); g = await ev(() => document.querySelectorAll('.xd .set-codes li').length); ok(g === 10, `recovery codes: 10, shown once (${g})`); await closeAll();
await act('password'); g = await ev(() => window.__opened); ok(g[0] === 'https://xenostudio.ai/overview/settings', 'Change password goes to the sign-in origin — never a form here');
// sessions
await go('sessions'); await act('endOthers'); await submit(); g = await acct(); ok(g.sessions.length === 1 && g.sessions[0].current, 'Sign out everywhere else leaves only this device');
// API keys: reveal once
await go('keys'); await act('newKey'); await setF('name', 'Deploy bot'); await submit(); await wait(200);
const secret = await ev(() => document.querySelector('.xd [data-secret]')?.textContent); await closeAll();
g = await acct(); const k = g.apiKeys.find((x) => x.name === 'Deploy bot'); ok(secret && /^xk_live_/.test(secret) && k && !JSON.stringify(g).includes(secret) && k.fp.endsWith(secret.slice(-4)), 'a new API key is shown once and only its fingerprint is kept');
// provider keys + routing
await go('providers'); await act('route', 'canvas=byok'); g = await ev(() => document.getElementById('toast').textContent); ok(/Add a provider key first/.test(g), '“Your key” needs a key first');
await act('addProvider'); await setF('k', 'sk-test-0123456789abcdefghij'); await submit(); await act('route', 'canvas=byok'); g = await acct();
ok(g.route.canvas === 'byok' && g.providers[0].fp === 'sk-…ghij' && !JSON.stringify(g).includes('0123456789abcdef'), 'a provider key is kept as a fingerprint only, and Canvas now uses it');
// usage: spend cap
await go('usage'); await act('cap'); await setF('n', '4000'); await submit(); g = await acct(); ok(g.cap === 4000, 'a monthly spend limit is saved');
// gifts
await go('gifts'); await act('gift'); await setF('to', '@mira'); await setF('n', '300'); await submit(); g = await acct(); ok(g.gifts[0]?.to === 'mira' && g.balance === 2080, `a gift leaves the balance and waits for the recipient (balance ${g.balance})`);
await act('ungift', g.gifts[0].id); g = await acct(); ok(g.balance === 2380 && g.gifts[0].state === 'returned', 'taking a gift back returns the credits');
// plan
await go('plan'); await act('cancelPlan'); await submit(); g = await acct(); ok(!!g.plan.cancelAt, 'Cancel plan keeps it until the renewal date'); await act('resumePlan'); g = await acct(); ok(!g.plan.cancelAt, 'Keep my plan undoes it');
// region
await go('region'); await ev(() => { const s = document.querySelector('#main [data-set-sel="region"]'); s.value = 'US'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(400);
g = await ev(() => document.querySelector('#main .set-preview').textContent); ok(/12,345\.67/.test(g), `region sets number and date formats (${g})`);
// data export
await go('data'); await act('export'); g = await ev(() => document.querySelector('#main .set-tag')?.textContent); ok(g === 'Preparing…', 'an export is prepared in the background'); await wait(8600);
g = await ev(() => [...document.querySelectorAll('#main [data-set]')].some((x) => x.dataset.set === 'downloadExport')); ok(g, '…and offers its download when ready');
// delete account: owner must hand over first; in Personal, type-to-confirm + grace period
await ev(() => window.XA.switchWorkspace('personal')); await go('danger'); await act('delete'); g = await dlg(); ok(/Hand over your workspace first/.test(g.title) && /XENO Corp/.test(g.text), 'an owner cannot delete the account while owning any workspace — even from Personal'); await closeAll();
await ev(() => localStorage.setItem('xw.workspaces', JSON.stringify(window.XA.workspaces().map((w) => (w.id === 'xeno' ? { ...w, sub: 'Company · admin' } : w))))); await go('danger'); await act('delete'); g = await dlg(); ok(/Delete your account/.test(g.title), 'in Personal, deleting asks to type your handle');
await ev(() => { const i = [...document.querySelectorAll('.xd input')].pop(); i.value = 'emilian'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await submit(); await wait(300);
g = await acct(); ok(!!g.deletion, 'the account enters its 30-day grace period'); await p.reload(); await wait(2000);
g = await ev(() => document.getElementById('toast').textContent); ok(/scheduled for deletion/.test(g), `opening XENO during the grace period offers to keep the account ("${g.slice(0, 50)}…")`);
await ev(() => document.querySelector('#toast .pg-undo').click()); await wait(300); g = await acct(); ok(!g.deletion, '…and Keep my account cancels it');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();
