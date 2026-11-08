// The product list says what works (data.js), and a web product whose interface is a workspace area opens that area.
//   1. Assets, Fonts, Stock, CRM, Forms and Scheduling carry no "Soon" tag; Support Desk (not built) still does
//   2. choosing one of them opens its real area, at that area's own address
//   3. an old product address (/workspace/<mode>/apps/<id>) lands on the area too
//   4. the product search (Ctrl K) no longer calls them "soon"
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5371, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const LIVE = ['assets', 'fonts', 'stock', 'crm', 'forms', 'scheduling'];
const WHERE = { assets: '/workspace/studio/spaces/libraries', fonts: '/workspace/studio/spaces/libraries/fonts', stock: '/workspace/studio/spaces/libraries/stock', crm: '/workspace/corpo/spaces/customers', forms: '/workspace/corpo/spaces/forms', scheduling: '/workspace/corpo/spaces/scheduling' };

const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/brand-kits') return json({ success: true, kits: [] });
  if (u.pathname === '/api/fonts/catalogue') return json({ success: true, families: [] });
  if (u.pathname === '/api/fonts') return json({ success: true, catalogue: [], uploads: [] });
  if (u.pathname.startsWith('/api/stock')) return json({ success: true, items: [], total: 0, mine: [], saved: [] });
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800); };
const pathNow = () => p.evaluate(() => location.pathname);
const rowTag = (id) => p.evaluate((id) => { const r = document.querySelector(`#panel [data-product="${id}"]`); return r ? { found: true, soon: !!r.querySelector('.tag') || r.classList.contains('soon') } : { found: false }; }, id);

try {
  // 1 + 2: Studio › Libraries
  for (const id of ['assets', 'fonts', 'stock']) {
    await open('/workspace/studio/spaces/libraries');
    const t = await rowTag(id);
    ok(t.found && !t.soon, `${id}: listed in Libraries with no Soon tag (${JSON.stringify(t)})`);
    if (!t.found) continue;
    await p.click(`#panel [data-product="${id}"]`); await wait(900);
    ok((await pathNow()) === WHERE[id], `${id}: opens its area (${await pathNow()})`);
    ok(!/coming soon/i.test(await p.evaluate(() => document.querySelector('#main')?.innerText || '')), `${id}: the page is not a coming-soon landing`);
  }
  // Corpo: through the product search (Ctrl K), the way a person finds a product they have not pinned
  const search = async (name) => { await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); await wait(400); await p.type('#palette input', name); await wait(300);
    const sub = await p.evaluate(() => document.querySelector('#palette .res .row.sel')?.innerText || ''); await p.keyboard.press('Enter'); await wait(900); return sub; };
  for (const [zone, id, name] of [['customers', 'crm', 'CRM'], ['forms', 'forms', 'Forms'], ['scheduling', 'scheduling', 'Scheduling']]) {
    await open(`/workspace/corpo/spaces/${zone}`);
    const t = await rowTag(id);
    ok(t.found && !t.soon, `${id}: listed with no Soon tag (${JSON.stringify(t)})`);
    await open('/workspace/corpo');   // from somewhere else, so opening it really moves
    const sub = await search(name);
    ok(!/soon/i.test(sub), `${id}: search does not call it soon (${sub.replace(/\s+/g, ' ')})`);
    ok((await pathNow()) === WHERE[id], `${id}: opens its area (${await pathNow()})`);
  }
  ok(await p.evaluate(() => window.XENO_PRODUCTS.desk.status === 'soon'), 'Support Desk (not built) still says soon');
  // 3: an old product address
  await open('/workspace/studio/apps/stock');
  ok((await pathNow()) === WHERE.stock, `/workspace/studio/apps/stock lands on the Stock area (${await pathNow()})`);
  await open('/workspace/corpo/apps/forms');
  ok((await pathNow()) === WHERE.forms, `/workspace/corpo/apps/forms lands on the Forms area (${await pathNow()})`);
  // 4: Ctrl K
  const soonInSearch = await p.evaluate((ids) => ids.filter((id) => window.XENO_PRODUCTS[id].status === 'soon'), LIVE);
  ok(!soonInSearch.length, `none of them is marked soon in the product list (${soonInSearch.join(', ')})`);
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
