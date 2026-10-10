import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, msg) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', msg); };
const ev = (f, ...a) => p.evaluate(f, ...a); const idle = () => p.evaluate(() => window.XENO_NET?.idle?.());
const shot = async (n) => { const g = await ev(() => { const m = document.getElementById('menu').getBoundingClientRect(); return { y: Math.max(0, m.top - 16), h: m.height + 32 }; }); await p.screenshot({ path: n, clip: { x: 0, y: g.y, width: 520, height: Math.min(g.h, 900 - g.y) } }); };
const geo = () => ev(() => { const m = document.getElementById('menu'), r = m.getBoundingClientRect(), rail = document.getElementById('rail').getBoundingClientRect(); return { on: m.classList.contains('on'), owner: m.dataset.owner, left: Math.round(r.left - rail.right), bottom: Math.round(innerHeight - r.bottom), top: Math.round(r.top), w: Math.round(r.width), role: m.getAttribute('role') }; });
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); }); await p.goto(url + '#/studio'); await wait(900);

// --- shell behaviour, all three ---
for (const [k, w] of [['bell', 380], ['help', 320], ['usage', 320]]) {
  await p.click(`#rail [data-go="${k}"]`); await wait(600); const g = await geo();
  ok(g.on && g.owner === k && g.role === 'dialog' && g.left === 7 && g.bottom === 7 && g.w === w, `${k}: dialog, ${g.w}px, 7px from rail (${g.left}) and bottom (${g.bottom})`);
  ok(await ev((k) => document.querySelector(`#rail [data-go="${k}"]`).getAttribute('aria-expanded') === 'true', k), `${k}: rail button aria-expanded`);
  ok(await ev(() => document.getElementById('menu').contains(document.activeElement)), `${k}: focus moved inside`);
  // focus trap: tab many times stays inside
  for (let i = 0; i < 40; i++) await p.keyboard.press('Tab');
  ok(await ev(() => document.getElementById('menu').contains(document.activeElement)), `${k}: Tab stays inside (trap)`);
  await shot(`rp3-${k}.png`);
  await p.keyboard.press('Escape'); await wait(250);
  ok(await ev((k) => !document.getElementById('menu').classList.contains('on') && document.activeElement === document.querySelector(`#rail [data-go="${k}"]`), k), `${k}: Esc closes and returns focus to its rail button`);
  ok(await ev((k) => document.querySelector(`#rail [data-go="${k}"]`).getAttribute('aria-expanded') === 'false', k), `${k}: aria-expanded back to false`);
}

// --- narrow + resize: never squeezed, never stranded ---
await p.setViewport({ width: 480, height: 640, deviceScaleFactor: 1 }); await wait(200);
await p.click('#rail [data-go="bell"]'); await wait(400); let g = await geo();
ok(g.w >= 260 && g.bottom === 7, `480px window: width ${g.w} (>=260), bottom ${g.bottom}`);
await p.setViewport({ width: 1100, height: 560, deviceScaleFactor: 1 }); await wait(300); g = await geo();
ok(g.w === 380 && g.bottom === 7 && g.top >= 7, `after resize: width ${g.w}, bottom ${g.bottom}, top ${g.top}`);
await p.keyboard.press('Escape'); await wait(200);
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 }); await wait(200);

// --- notifications ---
await p.click('#rail [data-go="bell"]'); await wait(300);
ok(await ev(() => document.querySelector('#menu .pl-fresh')?.textContent.startsWith('Updated')), 'freshness line shows its age');
ok(await ev(() => !!document.querySelector('#menu [data-nt-grp="Atlas"]')), 'Atlas burst collapsed into one grouped row');
await p.click('#menu [data-nt-grp="Atlas"]'); await wait(200);
ok(await ev(() => document.querySelectorAll('#menu .nt2-kids .nt2').length === 3), 'group expands to its 3 updates');
// archive with E + undo with Ctrl Z
await p.focus('#menu .nt2[data-nt]'); const first = await ev(() => document.activeElement.dataset.nt);
await p.keyboard.press('e'); await wait(200);
ok(await ev((id) => !document.querySelector(`#menu [data-nt="${id}"]`) && document.getElementById('utoast').classList.contains('on'), first), 'E archives and offers Undo');
await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(200);
ok(await ev((id) => !!document.querySelector(`#menu [data-nt="${id}"]`), first), 'Ctrl Z restores it');
// inline approve (optimistic) then auto-archive + undo
await p.click('#menu [data-nt="n0"] [data-nt-do]'); await wait(100);
ok(await ev(() => /Approved/.test(document.querySelector('#menu [data-nt="n0"] .nt2-done')?.textContent || '')), 'Approve shows "Approved" at once');
await wait(800);
ok(await ev(() => !document.querySelector('#menu [data-nt="n0"]') && /Approved/.test(document.getElementById('utoast').textContent)), 'then it leaves the inbox with an Undo');
await ev(() => document.querySelector('#utoast [data-undo]').click()); await wait(200);
ok(await ev(() => !!document.querySelector('#menu [data-nt="n0"] [data-nt-do]')), 'Undo puts the approval back');
// failure rolls back
await ev(() => { window.__xw.fail = 'action'; }); await p.click('#menu [data-nt="n1"] [data-nt-do]'); await wait(900);
ok(await ev(() => !!document.querySelector('#menu [data-nt="n1"] [data-nt-do]')), 'a refused Accept rolls back');
await ev(() => { window.__xw.fail = null; });
// snooze
await p.focus('#menu [data-nt="n2"]'); await p.keyboard.press('s'); await wait(150); ok(await ev(() => document.activeElement.matches("[data-nt-snooze]")), "S opens the snooze choices with focus on the first");
await p.click('#menu [data-nt-snooze="Tomorrow 9:00"]'); await wait(200);
ok(await ev(() => !document.querySelector('#menu [data-nt="n2"]')), 'snoozed row leaves the inbox');
await p.click('#menu [data-nt-tab="snoozed"]'); await wait(200);
ok(await ev(() => /Tomorrow 9:00/.test(document.querySelector('#menu [data-nt="n2"] .nt2-wake')?.textContent || '')), 'Snoozed tab shows it with its wake time');
await p.click('#menu [data-nt-tab="inbox"]'); await wait(150);
// filter
await p.click('#menu [data-nt-ftog]'); await wait(150); ok(await ev(() => !!document.querySelector('#menu .pl-chips')), 'filter row opens on demand'); await p.click('#menu [data-nt-filter="mentions"]'); await wait(150);
ok(await ev(() => [...document.querySelectorAll('#menu .nt2[data-nt]')].every((r) => /@you/.test(r.textContent)) && document.querySelectorAll('#menu .nt2[data-nt]').length >= 1), 'Mentions filter shows only @you');
await p.click('#menu [data-nt-filter="all"]'); await wait(150);
// settings: mute Dev → badge excludes it
await p.click('#menu [data-nt-set]'); await wait(150);
ok(await ev(() => !!document.querySelector('#menu [data-nt-mute="dev"]')), 'settings view opens inside the popover');
const before = await ev(() => document.querySelector('#rail [data-go="bell"]').dataset.tip);
await p.click('#menu [data-nt-mute="dev"]'); await wait(150);
const after = await ev(() => document.querySelector('#rail [data-go="bell"]').dataset.tip);
ok(before !== after, `muting Dev changes the bell count (${before} → ${after})`);
await p.click('#menu [data-nt-mute="dev"]'); await p.click('#menu [data-nt-back]'); await wait(150);
// live arrival
await ev(() => window.__xw.push('note')); await wait(200);
ok(await ev(() => /4K export finished/.test(document.querySelector('#menu .pl-lead')?.textContent || '')), 'a live notification arrives in the open popover');
ok(await ev(() => /New notification/.test(document.getElementById('xw-live')?.textContent || '')), 'and is announced to screen readers');
await shot('rp3-bell-live.png');
// View all → Inbox page with its own address
await p.click('#menu [data-nt-viewall]'); await wait(400);
ok(await ev(() => location.hash.endsWith('/g/inbox') && !!document.querySelector('.rp-page .nt2')), `View all opens the Inbox page (${await ev(() => window.XENO_ADDR.current())})`);
await p.screenshot({ path: 'rp3-inbox-page.png' });
await p.reload(); await wait(1200);
ok(await ev(() => !!document.querySelector('.rp-page .nt2')), 'Inbox page survives refresh');
await p.click('.rp-page [data-nt-tab="archive"]'); await wait(200);
ok(await ev(() => document.querySelector('.rp-page [data-nt-tab="archive"]').getAttribute('aria-selected') === 'true'), 'tabs work on the page');
// error state
await ev(() => { window.__xw.fail = 'notes'; }); await p.goto(url + '#/studio'); await ev(() => { window.__xw.fail = 'notes'; });
await p.reload(); await ev(() => { window.__xw.fail = 'notes'; });

// --- help ---
await p.goto(url + '#/dev'); await wait(800);
await p.click('#rail [data-go="help"]'); await wait(300);
ok(await ev(() => /Tips for Dev/.test(document.querySelector('#menu').textContent)), 'help shows tips for the current mode (Dev)');
await p.keyboard.type('credit'); await wait(150);
const docs = await ev(() => [...document.querySelectorAll('#menu [data-hp="doc"]')].map((x) => x.textContent.trim()));
ok(docs.length === 2 && docs.every((d) => /credit/i.test(d)), 'search shows matching docs inline: ' + docs.join(' | '));
await shot('rp3-help-search.png');
await p.keyboard.press('Escape'); await wait(200);
// shortcut sheet
await p.keyboard.down('Control'); await p.keyboard.press('/'); await p.keyboard.up('Control'); await wait(200);
ok(await ev(() => document.getElementById('kbsheet')?.classList.contains('on') && document.activeElement.closest('#kbsheet')), 'Ctrl / opens the shortcut sheet with focus inside');
await p.screenshot({ path: 'rp3-sheet.png' });
await p.keyboard.press('Escape'); await wait(150);
ok(await ev(() => !document.getElementById('kbsheet').classList.contains('on')), 'Esc closes the sheet');

// --- usage ---
await p.click('#rail [data-go="usage"]'); await wait(300);
const spent30 = await ev(() => document.querySelector('#menu .us-tile b').textContent);
await p.click('#menu [data-us-range="7d"]'); await wait(150);
const spent7 = await ev(() => document.querySelector('#menu .us-tile b').textContent);
ok(spent30 !== spent7 && /7 d/.test(await ev(() => document.querySelector('#menu .us-tile small').textContent)), `range switch changes totals (${spent30} → ${spent7})`);
await p.click('#menu [data-us-group="model"]'); await wait(150);
ok(await ev(() => /claude-opus-5-5/.test(document.querySelector('#menu').textContent)), 'breakdown switches to models');
await p.click('#menu [data-us-held]'); await wait(150);
ok(await ev(() => document.querySelectorAll('#menu .us-jobs .us-lg').length === 2), 'held credits open the list of running jobs');
await ev(() => window.__xw.setBalance(300)); await wait(150);
ok(await ev(() => !!document.querySelector('#menu .us-warn') && document.querySelector('#rail [data-go="usage"]').classList.contains('low')), 'low balance shows a warning and marks the rail chip');
await shot('rp3-usage-low.png');
await ev(() => window.__xw.setBalance(2480)); await wait(100);
await ev(() => window.__xw.push('charge')); await wait(150); await p.click('#menu [data-us-group="recent"]'); await wait(150);
ok(await ev(() => /Video Export/.test(document.querySelector('#menu').textContent)), 'a live charge appears in Recent charges');
await shot('rp3-usage.png');
await p.keyboard.press('Escape'); await wait(150);
// error + retry
await ev(() => { window.__xw.fail = 'usage'; }); await ev(() => document.querySelector('#rail [data-go="usage"]').click()); await wait(100);
await ev(() => document.querySelector('#menu [data-retry="usage"]').click()); await wait(700);
ok(await ev(() => /Couldn't refresh/.test(document.querySelector('#menu').textContent)), 'a failed refresh keeps the cached numbers and offers Retry');
await ev(() => { window.__xw.fail = null; }); await ev(() => document.querySelector('#menu .pl-fresh.err').click()); await wait(700);
ok(await ev(() => /Updated/.test(document.querySelector('#menu .pl-fresh')?.textContent || '')), 'Retry succeeds');
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs); await b.close();
