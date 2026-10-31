// The Marketplace on the platform is the real store: its listings, its prices, and credits spent only on a person's yes.
//   1. the store lists the server's listings and no sample; views filter by kind; search asks the server
//   2. a listing has an address by slug and survives a refresh; a missing one says so
//   3. buying asks first and names the price; declining sends nothing; yes spends through the server; too few credits is said
//   4. a free listing needs no dialog; a rental is bound to the workspace; a review is only for who has it
//   5. Purchases and Rentals are the server's; a rental's memory can be exported and deleted, asking first
//   6. the seller console shows real earnings; registering goes to the server; cash-out repeats what the server says
import { shot } from './shot.mjs';
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5225, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, host: '127.0.0.1', strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const WS = '33333333-3333-4333-8333-333333333333';
const L = (id, o) => ({ id, slug: 'slug-' + id, kind: 'plugin', title: 'Real ' + id, summary: 'Real summary ' + id, trustTier: 'verified', developerName: 'Real Seller', ratingAvg: 0, ratingCount: 0, pricing: [{ model: 'free', priceCredits: 0 }], status: 'published', ...o });
const fresh = () => ({ writes: [], poor: false, seller: null, ents: [], q: [], listings: [L('plug'), L('paid', { kind: 'mcp', pricing: [{ model: 'one_time', priceCredits: 250 }] }), L('mind', { kind: 'mind', pricing: [{ model: 'rental', priceCredits: 2, meterUnit: 'task' }] })],
  bindings: [{ id: 'b1', title: 'Real mind', state: 'active' }], partitions: [{ id: 'p1', target: { kind: 'personal' }, items: 4 }] });
let db = fresh();
const SAMPLES = /Background remover|Brand checker|Atlas — research|Bookkeeper|Lumen Studio/;

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const m = q.method(), P = u.pathname.replace('/api/marketplace', ''), body = () => JSON.parse(q.postData() || '{}');
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [{ id: WS, name: 'Real Co', slug: 'real-co', member_role: 'owner', workspace_type: 'company' }] });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (!u.pathname.startsWith('/api/marketplace')) return json({ success: false, error: 'not found' }, 404);
    if (P === '/catalog') { const s = u.searchParams.get('q'); if (s) db.q.push(s); return json({ success: true, listings: db.listings.filter((x) => !s || x.title.toLowerCase().includes(s.toLowerCase())) }); }
    const one = P.match(/^\/listings\/slug-(\w+)$/);
    if (one) { const l = db.listings.find((x) => x.id === one[1]); if (!l) return json({ success: false, error: 'Listing not found' }, 404); return json({ success: true, listing: l, description: 'Real description', versions: [{ id: 'v1', version: '1.2.3', releaseNotes: 'Real notes' }], reviews: [], entitlement: db.ents.includes(l.id) ? { type: 'owned', status: 'active' } : null }); }
    const act = P.match(/^\/listings\/(\w+)\/(purchase|subscribe|rent|rental\/bind|reviews)$/);
    if (act) { db.writes.push([act[2], act[1], body()]); if (act[2] === 'purchase' && db.poor) return json({ success: false, error: 'Insufficient credits' }, 402); if (['purchase', 'rent'].includes(act[2])) db.ents.push(act[1]); return json({ success: true, entitlement: { type: 'owned' }, binding: { id: 'b2' } }); }
    if (P === '/me/entitlements') return json({ success: true, entitlements: db.ents.map((id) => ({ id: 'e' + id, slug: 'slug-' + id, title: 'Real ' + id, entitlementType: 'owned', grantedAt: new Date().toISOString() })) });
    if (P === '/rental-bindings') return json({ success: true, bindings: db.bindings });
    if (P === '/rental-partitions') return json({ success: true, partitions: db.partitions });
    if (P === '/rental-partitions/p1/export') { db.writes.push(['export']); return json({ success: true, export: { items: [] } }); }
    if (P === '/rental-partitions/p1/content') { db.writes.push(['forget']); db.partitions = []; return json({ success: true }); }
    if (P === '/developer/me') return db.seller ? json({ success: true, developer: db.seller }) : json({ success: false, error: 'No developer profile' }, 404);
    if (P === '/developer/register') { db.writes.push(['register', body()]); db.seller = { id: 'd1', displayName: body().displayName, trustTier: 'community' }; return json({ success: true, developer: db.seller }, 201); }
    if (P === '/developer/listings') return json({ success: true, listings: [{ id: 'draft1', slug: 's', kind: 'skill', title: 'My draft', status: 'draft', versions: 1, lastSubmission: null }] });
    if (P === '/developer/earnings') return json({ success: true, earnings: { availableCredits: 700, pendingCredits: 30, paidOutCredits: 0 }, recentTransactions: [{ id: 't', type: 'purchase', gross: 100, platformFee: 20, creatorNet: 80, createdAt: new Date().toISOString() }] });
    if (P === '/developer/payouts') { db.writes.push(['payout', body()]); return json({ success: false, status: 'not_implemented', message: 'Payout recorded but cash-out is not yet enabled.' }, 501); }
    if (P === '/listings/draft1/submit') { db.writes.push(['submit']); return json({ success: true }); }
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const main = (p) => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const all = (p) => p.evaluate(() => document.body.innerText);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel);
const dialogOk = (p) => p.evaluate(() => { const s = document.querySelector('[data-xd-submit], [data-xd-ok]'); s?.click(); return !!s; });
const dialogCancel = (p) => p.evaluate(() => { const s = document.querySelector('[data-xd-cancel], .xd [data-xd-close]'); s?.click(); return !!s; });
const address = (p) => p.evaluate(() => location.pathname);
const buy = (p) => click(p, '[data-xmk="buy"]');

try {
  {
    const { p, errs } = await open('/workspace/market?ws=' + WS);
    let t = await main(p);
    ok(/Real plug/.test(t) && /Real paid/.test(t) && /Real mind/.test(t) && !SAMPLES.test(t), 'the store lists the server’s listings and no sample');
    ok(/250 credits/.test(t) && /Real Seller/.test(t), 'with the server’s price and seller');
    await shot(p, 'market-store');
    await p.evaluate(() => window.XW.go('global', { global: 'market', item: 'Minds' })); await wait(300);
    t = await main(p);
    ok(/Real mind/.test(t) && !/Real plug/.test(t), 'a view filters by kind');
    await p.evaluate(() => window.XW.go('global', { global: 'market', item: null })); await wait(300);
    await p.evaluate(() => { const i = document.querySelector('[data-xmk-q]'); i.value = 'paid'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); await wait(500);
    ok(db.q.includes('paid') && /Real paid/.test(await main(p)) && !/Real plug/.test(await main(p)), 'search asks the server');
    ok(!(await p.evaluate(() => JSON.stringify(window.XENO_PG_MARKET || []))).match(SAMPLES), 'the sample listings are gone from search too');

    await click(p, '[data-xmk="open"][data-id="slug-paid"]'); await wait(500);
    ok((await address(p)).endsWith('/market/l/slug-paid'), `a listing has an address by slug (${await address(p)})`);
    ok(/Real description/.test(await main(p)) && /1\.2\.3/.test(await main(p)), 'it shows the server’s description and versions');
    await shot(p, 'market-listing');
    await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
    ok(/Real description/.test(await main(p)), 'a refresh lands on the same listing');
    ok(/Only people who have it can review/.test(await main(p)), 'someone without it cannot review it');

    await buy(p); await wait(300);
    ok(/250 credits/.test(await all(p)), 'buying asks first and names the price');
    await dialogCancel(p); await wait(300);
    ok(!db.writes.some((x) => x[0] === 'purchase'), 'declining sends nothing');
    db.poor = true; await buy(p); await wait(300); await dialogOk(p); await wait(500);
    ok(/don’t have enough credits/.test(await all(p)), 'too few credits is said, and nothing is charged');
    db.poor = false; db.writes = []; await buy(p); await wait(300); await dialogOk(p); await wait(700);
    ok(db.writes.some((x) => x[0] === 'purchase' && x[1] === 'paid'), 'yes goes to the server');
    ok(/You have this/.test(await main(p)) && /Write a review/.test(await main(p)), 'then the page says you have it, and it can be reviewed');
    await click(p, '[data-xmk="review"]'); await wait(300);
    await p.evaluate(() => { const i = document.querySelector('.xd textarea, [data-f="text"] textarea'); i.value = 'Good'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await dialogOk(p); await wait(500);
    ok(db.writes.some((x) => x[0] === 'reviews' && x[2].rating === 5 && x[2].text === 'Good'), 'a review goes to the server');
    ok(errs.length === 0, `no page errors (${errs[0] || ''})`);
    await p.close();
  }
  {
    db = fresh();
    const { p } = await open('/workspace/market/l/slug-plug?ws=' + WS);
    await buy(p); await wait(600);
    ok(db.writes.some((x) => x[0] === 'purchase' && x[1] === 'plug'), 'a free listing needs no dialog');
    await p.close();
    const r = await open('/workspace/market/l/slug-mind?ws=' + WS);
    await buy(r.p); await wait(300); await dialogOk(r.p); await wait(700);
    ok(db.writes.some((x) => x[0] === 'rent') && db.writes.some((x) => x[0] === 'rental/bind' && x[2].workspaceId === WS), 'a rental is rented, then bound to this workspace');
    await r.p.close();
    const g = await open('/workspace/market/l/slug-nothing?ws=' + WS);
    ok(/not here/.test(await main(g.p)), 'a missing listing says so');
    await g.p.close();
  }
  {
    db = fresh(); db.ents = ['plug'];
    const { p } = await open('/workspace/market/Purchases?ws=' + WS);
    ok(/Real plug/.test(await main(p)) && !SAMPLES.test(await main(p)), 'Purchases is the server’s');
    await p.evaluate(() => window.XW.go('global', { global: 'market', item: 'Rentals' })); await wait(600);
    let t = await main(p);
    ok(/Real mind/.test(t) && /4 items/.test(t), 'Rentals shows rented agents and what they remember');
    await click(p, '[data-xmk="export"]'); await wait(400);
    ok(db.writes.some((x) => x[0] === 'export'), 'a rental’s memory can be exported');
    await click(p, '[data-xmk="forget"]'); await wait(300);
    ok(!db.writes.some((x) => x[0] === 'forget'), 'deleting it asks first');
    await dialogOk(p); await wait(600);
    ok(db.writes.some((x) => x[0] === 'forget') && !/4 items/.test(await main(p)), 'then it is deleted');
    await p.close();
  }
  {
    db = fresh();
    const { p } = await open('/workspace/market/Seller%20console?ws=' + WS);
    ok(/not selling anything yet/.test(await main(p)), 'someone who is not a seller is offered to start');
    await click(p, '[data-xmk="register"]'); await wait(300);
    await p.evaluate(() => { const i = document.querySelector('[data-f="name"] input'); i.value = 'My Shop'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await dialogOk(p); await wait(800);
    ok(db.writes.some((x) => x[0] === 'register' && x[1].displayName === 'My Shop'), 'starting goes to the server');
    let t = await main(p);
    ok(/700 credits/.test(t) && /My draft/.test(t) && /80 credits/.test(t), 'the console shows real earnings, listings and sales');
    await shot(p, 'market-seller');
    await click(p, '[data-xmk="submit"]'); await wait(400);
    ok(db.writes.some((x) => x[0] === 'submit'), 'a draft with a version can go to review');
    await click(p, '[data-xmk="payout"]'); await wait(300); await dialogOk(p); await wait(500);
    ok(db.writes.some((x) => x[0] === 'payout' && x[1].amountCredits === 700) && /not yet enabled/.test(await all(p)), 'cash-out says plainly what the server says');
    await p.close();
  }
} catch (e) { fails++; console.log('FAIL threw', e.message); }
finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
