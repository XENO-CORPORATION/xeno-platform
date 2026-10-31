import { shot } from './shot.mjs';
// Corpo › Scheduling is real: booking pages, hours and bookings from /api/scheduling (a stand-in here).
//   1. no sample mark; the area registers as live
//   2. create a booking page → POST /pages with title, link name, length; it is listed with its public link
//   3. delete it → Undo restores it through /restore
//   4. save weekly hours → PUT /availability with only the checked days
//   5. bookings: cancel → POST /bookings/:id/cancel; the feed link is shown once
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5217, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const soon = new Date(Date.now() + 2 * 86400000).toISOString();
const db = { calls: [], pages: [], deleted: [], avail: { timezone: 'UTC', weekly: { 1: [['09:00', '17:00']] }, saved: true, timeOff: [] },
  bookings: [{ id: 'bk1', pageId: 'p0', pageTitle: 'Intro call', startsAt: soon, endsAt: soon, status: 'confirmed', guestName: 'Grace Guest', guestEmail: 'grace@example.test', note: '' }] };

async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null, M = q.method(), P = u.pathname;
    if (P.startsWith('/api/scheduling')) db.calls.push([M, P + u.search, sent]);
    if (P === '/api/auth/me') return json({ success: true, user: USER });
    if (P === '/api/scheduling/pages' && M === 'GET') return json({ success: true, pages: db.pages });
    if (P === '/api/scheduling/pages' && M === 'POST') { const pg = { id: 'p' + (db.pages.length + 1), slug: sent.slug, title: sent.title, durationMinutes: sent.durationMinutes, bufferMinutes: sent.bufferMinutes, active: true, url: `https://xenosystem.ai/api/scheduling/book/${sent.slug}` }; db.pages.unshift(pg); return json({ success: true, page: pg }); }
    let m = P.match(/^\/api\/scheduling\/pages\/([^/]+)(\/restore)?$/);
    if (m && M === 'DELETE') { const i = db.pages.findIndex((x) => x.id === m[1]); db.deleted.push(...db.pages.splice(i, 1)); return json({ success: true, deleted: true }); }
    if (m && m[2]) { const i = db.deleted.findIndex((x) => x.id === m[1]); const pg = db.deleted.splice(i, 1)[0]; db.pages.unshift(pg); return json({ success: true, page: pg }); }
    if (P === '/api/scheduling/availability' && M === 'GET') return json({ success: true, ...db.avail });
    if (P === '/api/scheduling/availability' && M === 'PUT') { db.avail = { ...db.avail, timezone: sent.timezone, weekly: sent.weekly }; return json({ success: true, ...db.avail }); }
    if (P === '/api/scheduling/bookings') return json({ success: true, bookings: db.bookings });
    m = P.match(/^\/api\/scheduling\/bookings\/([^/]+)\/cancel$/);
    if (m) { db.bookings = db.bookings.filter((x) => x.id !== m[1]); return json({ success: true, cancelled: true }); }
    if (P === '/api/scheduling/feed') return json({ success: true, url: 'https://xenosystem.ai/api/scheduling/feed/abcdefghijklmnopqrstu.ics' });
    if (P.startsWith('/api/scheduling')) return json({ success: false, error: 'unexpected ' + P }, 500);
    if (P === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1800); await shot(p, 'scheduling');
  return { p, errs };
}

try {
  const { p, errs } = await open('#/corpo/z/scheduling');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-sc-page]')?.dataset.scPage, live: !!(window.XENO_ZONE_LIVE || {})['corpo.scheduling'], mark: !!document.querySelector('#main [data-sample-badge]') }));
  ok(s0.page === 'ready' && s0.live && !s0.mark, `Scheduling is real: live, no sample mark (${JSON.stringify(s0)})`);

  ok(await p.$('#main .topbar .pg-top-acts [data-sc-new]') !== null && await p.$('#main .topbar .pg-top-tabs [data-sc-tab="pages"][aria-selected="true"]') !== null && await p.$('#main .mview [data-sc-tab], #main .mview [data-sc-new]') === null, 'tabs and New booking page live in the header bar, not the body');
  await p.click('#main .topbar [data-sc-new]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-title') !== null, 'New booking page opens the workspace dialog');
  await p.type('.xd-sh #xdf-title', 'Intro call'); await p.type('.xd-sh #xdf-slug', 'emilian-intro'); await p.click('.xd-sh [data-f="dur"] [data-v="45"]');
  await p.click('.xd-sh [data-xd-submit]'); await wait(900);
  const post = db.calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/scheduling/pages'));
  ok(post && post[2].title === 'Intro call' && post[2].slug === 'emilian-intro' && post[2].durationMinutes === 45, `the page is created (${JSON.stringify(post && post[2])})`);
  ok(await p.evaluate(() => [...document.querySelectorAll('[data-sc-url]')].some((a) => a.textContent.endsWith('/api/scheduling/book/emilian-intro'))), 'it is listed with its public link');

  await p.click('[data-sc-del="p1"]'); await wait(800);
  ok(db.pages.length === 0 && await p.evaluate(() => !!document.querySelector('[data-sc-undone]')), 'deleting offers Undo');
  await p.click('[data-sc-undo="p1"]'); await wait(900);
  ok(db.calls.some((x) => x[0] === 'POST' && x[1].startsWith('/api/scheduling/pages/p1/restore')) && db.pages.length === 1, 'Undo restores it');

  await p.click('[data-sc-tab="availability"]'); await wait(600);
  ok(/\/z\/scheduling\/availability$/.test(await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])), 'a tab has its own address');
  await p.click('[data-sc-on="3"]');
  await p.click('[data-sc-savehours]'); await wait(700);
  const put = db.calls.find((x) => x[0] === 'PUT');
  ok(put && Object.keys(put[2].weekly).join() === '1,3' && put[2].weekly['1'][0][0] === '09:00', `hours are saved for the checked days only (${JSON.stringify(put && put[2].weekly)})`);

  await p.click('[data-sc-tab="bookings"]'); await wait(300);
  ok(await p.evaluate(() => document.querySelector('[data-sc-bk="bk1"]')?.textContent.includes('Grace Guest')), 'an upcoming booking is listed');
  await p.click('[data-sc-bkcancel="bk1"]'); await wait(800);
  ok(db.calls.some((x) => x[0] === 'POST' && x[1].startsWith('/api/scheduling/bookings/bk1/cancel')) && await p.evaluate(() => !document.querySelector('[data-sc-bk="bk1"]')), 'the host cancels it');
  await p.click('[data-sc-feed]'); await wait(600);
  ok(await p.evaluate(() => document.querySelector('[data-sc-feedurl]')?.textContent.includes('.ics')), 'the private feed link is shown');
  ok(await p.evaluate(() => !!document.querySelector('[data-sc-export]')?.getAttribute('href')?.startsWith('/api/scheduling/events.ics')), 'an .ics export is offered');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
