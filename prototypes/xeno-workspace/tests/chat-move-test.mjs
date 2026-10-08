// Browser check for a chat move in a context with no chat list of its own: the Video agency mode, or the adaptive view.
// Before the fix the move lived in memory only: its toast had no Undo, Ctrl Z did nothing, and a reload lost it. The default
// chat list is now kept with the others, so the move is saved, can be undone and redone, and survives a reload.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 });
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const check = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name} — threw: ${String(e.message).split('\n')[0]}`); } };
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const reset = async () => {
  await p.goto(url);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
  await p.goto(url + '#/overview/g/library'); await p.reload(); await wait(800);
};
const key = async (k, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.keyboard.press(k); for (const m of mods) await p.keyboard.up(m); await wait(350); };
// the project that holds the chat now, or null: read from the list this context shows (its own saved list, or the default one)
const projectOf = (t) => p.evaluate((t) => { const c = (window.XENO_CHATS_BY_CTX || {}).default || window.XENO_CHATS; const pj = (c.projects || []).find((x) => x[2].includes(t)); return pj ? pj[0] : null; }, t);
// a real click at the middle of the menu item whose text starts with the given text (plain or checkbox items)
const menuClick = async (text) => {
  const at = await p.evaluate((text) => { const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox]')].find((x) => x.textContent.trim().startsWith(text)); if (!it) return null; const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, text);
  if (!at) return false; await p.mouse.click(at.x, at.y); await wait(400); return true;
};

// opens a submenu the way a user does: by hovering its item, or by the arrow key on it
const openSubmenu = async (text) => {
  const at = await p.evaluate((text) => { const it = [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim().startsWith(text)); if (!it) return null; it.scrollIntoView({ block: 'nearest' }); const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, text);
  if (!at) return false;
  await p.mouse.move(at.x, at.y); await wait(500);
  if (!(await p.evaluate(() => document.querySelectorAll('.xcm').length >= 2))) { await p.evaluate((text) => [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim().startsWith(text))?.focus(), text); await p.keyboard.press('ArrowRight'); await wait(500); }
  return p.evaluate(() => document.querySelectorAll('.xcm').length >= 2);
};
await check('a chat taken out of its project in the Video agency mode is undone and redone, and the move survives a reload', async () => {
  await reset();
  await p.evaluate(() => window.XW.go('mode', { mode: 'c-agency' })); await wait(700);
  await p.evaluate(() => window.XW.go('product', { product: 'chat', openPanel: true })); await wait(800);
  const t = await p.evaluate(() => { const c = window.XENO_CHATS; const onScreen = new Set([...document.querySelectorAll('[data-chat]')].map((x) => x.dataset.chat)); return c.projects.flatMap((pj) => pj[2]).find((x) => onScreen.has(x)) || null; });
  ok(!!t, 'a chat in a project has a row on screen (' + t + ')');
  if (!t) return;
  const before = await projectOf(t);
  ok(!!before, 'the chat starts in a project (' + before + ')');
  const at = await p.evaluate((t) => { const el = [...document.querySelectorAll('[data-chat]')].find((x) => x.dataset.chat === t); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, t);
  await p.mouse.click(at.x, at.y, { button: 'right' }); await wait(450);
  ok(await openSubmenu('Move to project'), 'Move to project opens its list');
  ok(await menuClick('No project'), 'the list offers No project');
  const moved = (await projectOf(t)) === null;
  ok(moved, 'the move takes the chat out of its project (live ' + (await projectOf(t)) + ')');
  if (!moved) ok(false, 'the move did not happen, so Undo, Redo and the reload are not tested');
  else {
    ok(await p.evaluate(() => !!document.querySelector("#xw-toasts [data-h='undo']")), 'the move says so and offers an Undo');
    await key('z', ['Control']);
    const undone = (await projectOf(t)) === before;
    ok(undone, 'Ctrl Z puts it back in ' + before + ' (live ' + (await projectOf(t)) + ')');
    if (undone) { await key('z', ['Control', 'Shift']); ok((await projectOf(t)) === null, 'Ctrl Shift Z takes it out again'); }
    else ok(false, 'Ctrl Shift Z not tested: the undo did not run');
    await p.reload(); await wait(800);
    ok((await projectOf(t)) === null, 'the move survives a reload (live ' + (await projectOf(t)) + ')');
  }
});
console.log(errs.length ? 'page errors: ' + JSON.stringify(errs.slice(0, 3)) : 'no page errors');
await b.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
