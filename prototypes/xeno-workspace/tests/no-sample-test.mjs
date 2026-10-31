// no-sample-test — with an empty account, no screen of the served workspace shows the picture's sample data as the person's.
// Found 2026-10-31: the preview note said nothing sample was left while Anima's sidebar listed "Atlas — research" and
// "1,204 episodes", Community's sidebar said "3 new", and a new account had a "Video agency" mode. The note only ever
// counted area tables; this walks every screen, reads what is on it, and checks it against the sample tables themselves.
//   1. no global, mode home or area shows a sample row, in its sidebar or its page, even when every load fails
//   2. search offers no sample Minds, chats or projects
//   3. a live area never says "Coming soon" or offers "Notify me"
//   4. the prototype's state switch isn't there, and neither is an empty note
//   5. no page errors on any screen
import { createRequire } from 'node:module'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5298, base = `http://127.0.0.1:${PORT}`;

// the sample names come from the tables themselves, so a new sample row is covered the day it is written
const src = (f) => fs.readFileSync(path.join(here, '..', f), 'utf8');
const names = new Set(['Atlas — research', 'Juno — inbox', 'Kit — code review', '1,204 episodes', 'Plan the offsite', 'Summarise my week', '3 new', '2 replies', 'Video agency',
  'Brand refresh', 'Q4 planning', 'Launch week', 'Auth gate', 'XENO launch', 'Partner co-marketing', 'Home reno', 'XENO Corp', '9 people · 7 agents', '128 sources', '12 active', '2,184']);
for (const m of src('pages-data.js').matchAll(/'[a-z]+\.[a-z-]+': \{ noun:[^\n]*\n\s*rows: \[(.*)\]/g)) for (const r of m[1].matchAll(/\['([^']{4,})',/g)) names.add(r[1]);
for (const m of src('nav.js').matchAll(/work: \['[^']+', \[(.*)\]\]/g)) for (const r of m[1].matchAll(/\['([^']{4,})',/g)) names.add(r[1]);
{ const block = src('nav.js').match(/window\.XENO_CHATS_BY_CTX = \{[\s\S]*?\n\};/)?.[0] || ''; for (const r of block.matchAll(/'([^']{6,})'/g)) names.add(r[1]); }
for (const w of ['Showcase', 'Members', 'Divisions', 'Support', 'Pipeline']) names.delete(w);   // ordinary words that the tables happen to use too
ok(names.size > 60, `the sample tables were read (${names.size} names)`);
const sampleIn = (text) => text.split('\n').map((l) => l.trim()).filter((l) => names.has(l));

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 90000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    return json({ success: false, error: 'not found' }, 404); });   // every load fails: that must not bring a sample back
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1500);
  return { p, errs };
}
const read = (p) => p.evaluate(() => ({ panel: document.querySelector('#panel')?.innerText || '', main: document.querySelector('#main')?.innerText || '',
  zones: Object.fromEntries(Object.entries(window.XENO_MODE_ZONES || {}).map(([k, v]) => [k, (v || []).map((z) => z.id)])), live: Object.keys(window.XENO_ZONE_LIVE || {}),
  sw: !!document.querySelector('[data-pg-preview]'), note: (() => { const n = document.getElementById('xp-note'); return n && !n.hidden ? n.textContent : ''; })() }));

try {
  const first = await open('/workspace/#/overview');
  const home = await read(first.p);
  ok(!/Video agency/.test(home.panel + home.main) && !home.zones['c-agency'], 'a new account has no made-up mode');
  // search: everything it can offer, with no words typed
  await first.p.keyboard.down('Control'); await first.p.keyboard.press('k'); await first.p.keyboard.up('Control'); await wait(500);
  for (const q of ['Atlas', 'offsite', 'Brand refresh']) {
    await first.p.evaluate(() => { const i = document.querySelector('.sr-in input, #search input, [data-sr-input], input[type="search"]'); if (i) i.value = ''; });
    await first.p.keyboard.type(q); await wait(350);
    const t = await first.p.evaluate(() => document.querySelector('.sr, .search, #search, [role="dialog"]')?.innerText || document.body.innerText);
    ok(!sampleIn(t).length && !/Atlas — |Atlas\s+Research|remembers/i.test(t), `search for “${q}” offers no sample (${sampleIn(t).slice(0, 3).join(', ')})`);
    for (let i = 0; i < q.length; i++) await first.p.keyboard.press('Backspace');
  }
  await first.p.close();

  const routes = ['/workspace/#/overview'];
  for (const g of ['anima', 'community', 'market', 'library', 'projects', 'tasks', 'workspace', 'inbox', 'settings', 'places', 'support', 'releases']) routes.push(`/workspace/#/overview/g/${g}`);
  for (const [m, zs] of Object.entries(home.zones)) { if (m === 'overview') continue; routes.push(`/workspace/#/${m}`); for (const z of zs) routes.push(`/workspace/#/${m}/z/${z}`); }
  const bad = [], broke = [], planned = [], sw = [];
  for (const r of routes) {
    const { p, errs } = await open(r); const v = await read(p);
    const hits = sampleIn(v.panel + '\n' + v.main); if (hits.length) bad.push(`${r}: ${hits.slice(0, 4).join(', ')}`);
    if (errs.length) broke.push(`${r}: ${errs[0]}`);
    if (v.sw) sw.push(r);
    const z = r.match(/#\/([^/]+)\/z\/([^/]+)$/);
    if (z && v.live.includes(`${z[1]}.${z[2]}`) && /Notify me|Coming soon|Planned — not built/.test(v.panel + v.main)) planned.push(r);
    if (!z && /#\/[a-z-]+$/.test(r) && r !== '/workspace/#/overview') for (const id of home.zones[r.split('/').pop()] || []) if (v.live.includes(`${r.split('/').pop()}.${id}`)) { const name = await p.evaluate((i) => document.querySelector(`.hm2-area[data-zone="${i}"]`)?.innerText || '', id); if (/Coming soon/.test(name)) planned.push(`${r} card ${id}`); }
    await p.close();
  }
  ok(!bad.length, `no screen shows a sample row (${routes.length} screens) ${bad.slice(0, 6).join(' | ')}`);
  ok(!planned.length, `a live area never says it is coming ${planned.slice(0, 6).join(' | ')}`);
  ok(!sw.length, `the prototype’s state switch is on no screen ${sw.slice(0, 4).join(' | ')}`);
  ok(!broke.length, `no page errors ${broke.slice(0, 4).join(' | ')}`);
  ok(!home.note, `nothing sample is left, so no note says otherwise (${home.note})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
