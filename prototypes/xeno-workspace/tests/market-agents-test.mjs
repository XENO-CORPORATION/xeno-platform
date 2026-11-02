// Selling and renting an agent, on /api/marketplace (a stand-in here).
//   1. Seller console › Publish an agent: makes the listing, names the agent, sends it to review; no definition is sent
//   2. a refusal says what to fix
//   3. Review queue: a reviewer reads the instructions and decides; others can't see the button
//   4. a listing says what the agent asks for; a buyer adds a copy here; a renter asks from Rentals and reads the answer
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5298, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = (role) => ({ id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true, role, kind: 'human' });
const db = { role: 'user', sent: [], versionRefusal: null, polls: 0, invokeStatus: 202 };
const LISTING = { id: '44444444-4444-4444-8444-444444444444', slug: 'contract-reader', kind: 'mind', title: 'Contract reader', summary: 'Reads contracts', trustTier: 'community', developerName: 'A seller', pricing: [{ model: 'rental', priceCredits: 5, period: 'month' }, { model: 'free' }], currentVersion: '1.0.0', license: 'LicenseRef-XENO-Marketplace-Agent', ratingCount: 0 };
const VERSION = { id: '55555555-5555-4555-8555-555555555555', version: '1.0.0', license: 'LicenseRef-XENO-Marketplace-Agent', agent: { name: 'Contract reader', role: 'Paralegal', capabilities: ['files.read'], secretNames: ['GITHUB_TOKEN'], skills: 1, rentable: true } };
const BINDING = { id: '66666666-6666-4666-8666-666666666666', listingId: LISTING.id, title: 'Contract reader', state: 'active', target: { kind: 'personal' } };
const SUB = { id: '77777777-7777-4777-8777-777777777777', state: 'in_review', kind: 'mind', title: 'Contract reader', developer: 'A seller', version: '1.0.0', license: 'LicenseRef-XENO-Marketplace-Agent', agent_definition: { agent: { name: 'Contract reader' }, persona: { role: 'Paralegal', body: '# Voice\nPlain and careful.' }, definition: { instructions: 'Read the clause and flag risk.', requestedCapabilities: ['files.read'], secretNames: ['GITHUB_TOKEN'], skills: [] } } };
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
await p.evaluateOnNewDocument(() => { window.XENO_MARKET_ASK_POLL_MS = 50; });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const M = q.method(), P = u.pathname.replace('/api/marketplace', ''), body = q.postData() ? JSON.parse(q.postData()) : null;
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER(db.role) });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/agents') return json({ success: true, agents: [{ id: 'agt_one', name: 'Contract reader' }] });
  if (!u.pathname.startsWith('/api/marketplace')) return json({ success: false, error: 'not found' }, 404);
  if (M !== 'GET') db.sent.push({ M, P, body });
  if (P === '/developer/me') return json({ success: true, developer: { id: 'd', displayName: 'A seller' } });
  if (P === '/developer/listings') return json({ success: true, listings: [] });
  if (P === '/developer/earnings') return json({ success: true, earnings: { availableCredits: 0, pendingCredits: 0, paidOutCredits: 0 }, recentTransactions: [] });
  if (P === '/catalog') return json({ success: true, listings: [LISTING] });
  if (P === '/listings' && M === 'POST') return json({ success: true, listing: LISTING });
  if (P === `/listings/${LISTING.id}/versions`) return db.versionRefusal ? json({ success: false, error: db.versionRefusal }, 422) : json({ success: true, versionId: VERSION.id }, 201);
  if (P === `/listings/${LISTING.id}/submit`) return json({ success: true });
  if (P === `/listings/${LISTING.slug}`) return json({ success: true, listing: LISTING, versions: [VERSION], reviews: [], entitlement: db.ent || null });
  if (P === `/listings/${LISTING.id}/purchase`) { db.ent = { type: 'owned' }; return json({ success: true }); }
  if (P === `/listings/${LISTING.id}/rent`) { db.ent = { type: 'rental' }; return json({ success: true }); }
  if (P === `/listings/${LISTING.id}/rental/bind`) return json({ success: true, binding: BINDING });
  if (P === `/listings/${LISTING.id}/import-agent`) return json({ success: true, import: { agentId: 'agt_copy', requiredSecrets: ['GITHUB_TOKEN'], skillsLeftOut: 1 } }, 201);
  if (P === '/rental-bindings') return json({ success: true, bindings: [BINDING] });
  if (P === '/rental-partitions') return json({ success: true, partitions: [] });
  if (P === `/invoke/${LISTING.id}`) return db.invokeStatus === 503 ? json({ success: false, error: 'broker_unavailable' }, 503) : json({ success: true, invocation: { id: 'inv1', state: 'dispatched' } }, 202);
  if (P === '/invocations/inv1') { db.polls += 1; return json({ success: true, invocation: db.polls < 2 ? { id: 'inv1', state: 'dispatched' } : { id: 'inv1', state: 'finished', runStatus: 'completed', output: 'Clause 4 is a risk.' } }); }
  if (P === '/submissions') return db.role === 'admin' ? json({ success: true, submissions: [SUB] }) : json({ success: false, error: 'Admin privileges required' }, 403);
  if (P === `/submissions/${SUB.id}/approve`) return json({ success: true, publishedVersion: '1.0.0' });
  if (P === `/submissions/${SUB.id}/reject`) return json({ success: true });
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1600); };
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const toast = () => p.evaluate(() => document.body.innerText);
const fill = (id, v) => p.evaluate((i, x) => { const n = document.querySelector('#xdf-' + i); n.value = x; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
const publish = async () => { await p.click('[data-xmk="publishAgent"]'); await wait(400); await fill('summary', 'Reads contracts'); await fill('how', 'both'); await fill('rent', '5'); await fill('copy', '0'); await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]'); await wait(800); };
try {
  await open('/workspace/market/Seller%20console');
  ok(!!(await p.$('[data-xmk="publishAgent"]')), 'the seller console offers Publish an agent');
  ok(!(await p.$('[data-xmk="go"][data-id="Review"]')), 'someone who isn’t staff gets no review queue');
  await publish();
  const made = db.sent.find((x) => x.P === '/listings'), ver = db.sent.find((x) => x.P.endsWith('/versions')), sub = db.sent.find((x) => x.P.endsWith('/submit'));
  ok(made?.body.kind === 'mind' && made.body.pricing.some((x) => x.model === 'rental' && x.priceCredits === 5 && x.period === 'month') && made.body.pricing.some((x) => x.model === 'free'), 'it makes a listing with the chosen prices');
  ok(!made?.body.pricing.some((x) => x.model === 'pay_per_use' || x.model === 'subscription'), 'and never a way of selling that can’t run it yet');
  ok(ver?.body.agentId === 'agt_one' && !('agentDefinition' in ver.body) && !('instructions' in ver.body), 'the version names the agent; the server builds it');
  ok(!!sub && /Sent to review/.test(await toast()), 'it goes to review, and says so');
  db.sent = []; db.versionRefusal = 'definition_has_secret';
  await publish();
  ok(/looks like a key or password/.test(await toast()) && !db.sent.some((x) => x.P.endsWith('/submit')), 'a refusal says what to fix, and nothing goes to review');
  db.versionRefusal = null;
  await p.click('.xd .xd-btn[data-xd-close], .xd [data-xd-close]').catch(() => {}); await wait(200);

  db.role = 'admin';
  await open('/workspace/market/Seller%20console');
  ok(!!(await p.$('[data-xmk="go"][data-id="Review"]')), 'staff get the review queue');
  await open('/workspace/market/Review');
  const r = await main();
  ok(/Read the clause and flag risk/.test(r) && /Plain and careful/.test(r) && /GITHUB_TOKEN/.test(r), 'a reviewer reads the instructions, the role and what buyers must provide');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/market-review.png' });
  db.sent = [];
  await p.click('[data-xmk="approve"]'); await wait(300); await p.click('.xd [data-xd-ok]'); await wait(500);
  ok(db.sent.some((x) => x.P === `/submissions/${SUB.id}/approve`) && /Published/.test(await toast()), 'approving asks first, then publishes');
  db.role = 'user';

  await open('/workspace/market/l/contract-reader');
  const l = await main();
  ok(/What this agent is/.test(l) && /Paralegal/.test(l) && /files\.read/.test(l) && /GITHUB_TOKEN/.test(l), 'a listing says what the agent is and asks for');
  ok(/Rent · 5 credits/.test(l), 'and what it costs to rent');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/market-listing.png' });
  db.sent = [];
  const free = await p.$$eval('[data-xmk="buy"]', (x) => x.findIndex((n) => /Get/.test(n.innerText)));
  await p.evaluate((i) => document.querySelectorAll('[data-xmk="buy"]')[i].click(), free); await wait(700);
  ok(!!(await p.$('[data-xmk="importAgent"]')), 'once you have it, you can add it here');
  await p.click('[data-xmk="importAgent"]'); await wait(300);
  ok(/under these terms/.test(await p.evaluate(() => document.querySelector('.xd')?.innerText || '')) , 'it names the terms first');
  await p.click('.xd [data-xd-ok]'); await wait(900);
  const imp = db.sent.find((x) => x.P.endsWith('/import-agent'));
  ok(imp?.body.versionId === VERSION.id && imp.body.acceptLicense === VERSION.license, 'it accepts that exact licence for that version');
  ok(/still needs GITHUB_TOKEN to provide and 1 skill to add/.test(await toast()), 'and says what the new agent still needs');
  ok((await p.evaluate(() => location.pathname)).includes('/Agents/agt_copy'), 'and opens it, at its own address');

  await open('/workspace/market/Rentals');
  db.sent = [];
  await p.click('[data-xmk="ask"]'); await wait(300);
  await fill('prompt', 'Read clause 4'); await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]'); await wait(900);
  const inv = db.sent.find((x) => x.P.startsWith('/invoke/'));
  ok(inv?.body.prompt === 'Read clause 4' && inv.body.bindingId === BINDING.id, 'Ask runs under the rental');
  ok(/Clause 4 is a risk/.test(await main()), 'and the answer shows up');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/market-rentals.png' });
  db.invokeStatus = 503; await open('/workspace/market/Rentals');
  await p.click('[data-xmk="ask"]'); await wait(300); await fill('prompt', 'x'); await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]'); await wait(500);
  ok(/can’t run hosted agents right now. Nothing was charged/.test(await main()), 'if nothing can run it, it says so, and that nothing was charged');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
