// Studio › Libraries › Stock is real: /api/stock (a stand-in here).
//   1. Stock has its own address beside Brand kits and Fonts, and shows pictures
//   2. search and the filters ask the server; words that match nothing say so
//   3. the Generate button carries the words to Generate, which fills them in and sends nothing
//   4. what you generated with those words shows up; if that read fails, Stock still works
//   5. an item says who states its licence and what CC0 doesn't cover; Save goes to this workspace
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5297, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const item = (id, title, over = {}) => ({ id, kind: 'image', collection: 'photo', title, creator: 'A Person', tag: 'forest', width: 3000, height: 2000, bytes: 3000000, previewUrl: `${base}/fake-cdn/${id}.png`, fullUrl: `${base}/fake-cdn/${id}-full.png`, license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceName: 'Wikimedia Commons', sourceUrl: 'https://commons.wikimedia.org/wiki/File:x', statedBy: 'uploader', checkedAt: '2026-10-31', rights: 'Its uploader marked this CC0 and their own work on Wikimedia Commons. XENO read that statement and looked at the file, but can’t prove who made it. CC0 speaks for copyright only. It doesn’t clear a person’s or a brand’s rights, so check those before you use this to advertise something.', credit: 'A Person, via Wikimedia Commons (CC0).', ...over });
const ALL = [item('wc-1', 'Forest at dawn'), item('cma-2', 'Waves', { collection: 'art', tag: 'sea' }), item('wc-3', 'River film', { kind: 'video', collection: 'video', duration: 12, tag: 'river' })];
const db = { searches: [], saves: [], gens: [{ id: '22222222-2222-4222-8222-222222222222', state: 'succeeded', resultAssetIds: ['33333333-3333-4333-8333-333333333333'], request: { prompt: 'a misty forest at dawn' } }], genFail: false };
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname.startsWith('/fake-cdn/') || u.pathname.endsWith('/content')) return q.respond({ status: 200, contentType: 'image/png', body: PNG });
  if (u.pathname === '/chat') return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>frame</title>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const M = q.method();
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/brand-kits') return json({ success: true, kits: [] });
  if (u.pathname === '/api/generations') return db.genFail ? json({ error: 'x' }, 500) : json({ generations: db.gens });
  if (u.pathname === '/api/stock/search') { db.searches.push(u.search); const w = (u.searchParams.get('q') || '').toLowerCase(), c = u.searchParams.get('collection') || ''; const items = ALL.filter((x) => (!c || x.collection === c) && w.split(/\s+/).filter(Boolean).every((t) => `${x.title} ${x.tag}`.toLowerCase().includes(t))); return json({ success: true, total: items.length, offset: 0, items }); }
  if (u.pathname.startsWith('/api/stock/items/')) { const it = ALL.find((x) => x.id === u.pathname.split('/').pop()); return it ? json({ success: true, item: it }) : json({ success: false, code: 'item_not_found', error: 'That isn’t in Stock' }, 404); }
  if (u.pathname === '/api/stock/saved' && M === 'GET') return json({ success: true, saved: db.saves.map((id) => ({ ...ALL.find((x) => x.id === id), fileId: 'f', agentSaved: false })) });
  if (u.pathname === '/api/stock/saved' && M === 'POST') { const s = JSON.parse(q.postData()); const already = db.saves.includes(s.id); if (!already) db.saves.push(s.id); return json({ success: true, saved: { stockId: s.id, fileId: 'f' }, already }); }
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800); };
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const type = async (text) => { await p.evaluate((t) => { const i = document.querySelector('[data-st-q]'); i.focus(); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text); await wait(700); };
try {
  await open('/workspace/studio/spaces/libraries');
  await p.click('[data-bk-area="stock"]'); await wait(900);
  ok((await p.evaluate(() => location.pathname)).endsWith('/libraries/stock'), `Stock has its own address (${await p.evaluate(() => location.pathname)})`);
  ok(await p.$$eval('[data-st-open] img', (x) => x.length) === 3 && /3 free of copyright/.test(await main()), 'it shows pictures');
  ok(!/Coming soon|Planned|Notify me/.test(await main()), 'nothing says it’s coming');
  ok(await p.evaluate(() => { const i = document.querySelector('[data-st-open="wc-3"] img'); return i.complete && i.naturalWidth > 0; }), 'a preview really loads');
  await p.click('[data-st-col="art"]'); await wait(500);
  ok(db.searches.at(-1).includes('collection=art') && await p.$$eval('[data-st-open]', (x) => x.length) === 1, 'a filter asks the server');
  await p.click('[data-st-col=""]'); await wait(500);
  await type('zzz');
  ok(/Nothing in Stock matches/.test(await main()), 'words that match nothing say so');
  ok(!!(await p.$('[data-st-generate]')), 'and offer to generate instead');
  await type('forest');
  ok(db.searches.at(-1).includes('q=forest') && await p.$$eval('[data-st-open]', (x) => x.length) === 1, 'search asks the server');
  ok(await p.evaluate(() => document.activeElement?.hasAttribute('data-st-q')), 'and you can keep typing');
  await wait(300);
  ok(/Made by you/.test(await main()) && !!(await p.$('a[href="/workspace/studio/generate/image/g/22222222-2222-4222-8222-222222222222"]')), 'what you generated with those words shows up, and opens');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/stock-search.png' });
  db.genFail = true; await type('fores'); await wait(300);
  ok(!/Made by you/.test(await main()) && await p.$$eval('[data-st-open]', (x) => x.length) === 1 && !errs.length, 'if that read fails, Stock still works');
  db.genFail = false;

  await p.click('[data-st-open="wc-1"]'); await wait(800);
  ok((await p.evaluate(() => location.pathname)).endsWith('/libraries/stock/wc-1'), 'an item has its own address');
  const t = await main();
  ok(/Its uploader marked this CC0/.test(t) && /can’t prove who made it/.test(t) && /doesn’t clear a person’s or a brand’s rights/.test(t), 'it says who states the licence and what CC0 doesn’t cover');
  ok(/A Person, via Wikimedia Commons/.test(t) && !!(await p.$('a[href="https://commons.wikimedia.org/wiki/File:x"]')) && /2026-10-31/.test(t), 'with a credit line, the source and when it was checked');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/stock-item.png' });
  { const c = await p.evaluate(() => document.querySelector('.crumbs')?.innerText || ''); ok(/Forest at dawn/.test(c), `the breadcrumb names it (${c.split(/\s+/).join(' ')})`); }
  await p.click('[data-st-save="wc-1"]'); await wait(600);
  ok(db.saves.includes('wc-1') && /Saved to this workspace/.test(await p.evaluate(() => document.body.innerText)), 'Save puts it in this workspace’s Library, and says so');
  await p.click('[data-st-save="wc-1"]'); await wait(600);
  ok(/already in this workspace/.test(await p.evaluate(() => document.body.innerText)), 'saving it again says it’s already there');
  await open('/workspace/studio/spaces/libraries/stock/saved');
  ok(!!(await p.$('[data-st-open="wc-1"]')), 'Saved here shows it, on a fresh load');
  await open('/workspace/studio/spaces/libraries/stock/wc-3');
  ok(!!(await p.$('video[poster]')), 'a video plays in place, with its poster');
  await open('/workspace/studio/spaces/libraries/stock/wc-999');
  ok(/That isn’t in Stock/.test(await main()), 'an address for something gone says so');

  await open('/workspace/studio/spaces/libraries/stock');
  await type('misty forest');
  await p.click('[data-st-generate]'); await wait(1500);
  ok((await p.evaluate(() => location.pathname + location.search)).includes('/studio/generate/image') , `Generate opens (${await p.evaluate(() => location.pathname + location.search)})`);
  const frame = await p.evaluate(() => window.XENO_GENERATIONS?.route?.()?.framePath || '');
  ok(/generationType=image/.test(frame) && /prompt=misty%20forest/.test(frame), `and hands its frame the words (${frame})`);
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
