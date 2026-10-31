import { shot } from './shot.mjs';
// Corpo › People, Dev › Agents and Studio › Generate show the person's own work, not the picture's rows.
//   1. each is a live area with no sample mark, listing what the server sent and none of the sample names
//   2. a row opens the real place: Directory/<id>, Agents/<id>, the generation's address
//   3. a failed load says so with a way to retry; an empty one says it is empty
//   4. an area that is live never says its product is planned (Customers, Scheduling, Analytics)
//   5. a product sidebar shows no sample rows on the platform, and the preview note names what is still sample
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5219, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const PID = '11111111-1111-4111-8111-111111111111', AID = 'agt_' + 'b'.repeat(32), GID = '22222222-2222-4222-8222-222222222222';
const db = { people: [{ id: PID, name: 'Real Person', title: 'Engineer', kind: 'human' }], agents: [{ id: AID, name: 'Real Agent', status: 'active' }],
  generations: [{ id: GID, type: 'image', status: 'completed', request: { type: 'image', prompt: 'A real prompt' } }], fail: new Set() };
const SAMPLES = /Emilian|Atlas|Refactor auth gate|Neon city|Logo sting|Narration/;

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    if (u.pathname === '/api/library/assets') { db.libraryAsked = u.searchParams.get('area'); return json({ success: true, items: [{ id: 'file:f1', source: 'file', source_id: 'f1', name: 'Real render.mp4', mime_type: 'video/mp4', size_bytes: 2500000 }, { id: 'generation:g1', source: 'generation', source_id: 'g1', name: 'A generated picture', mime_type: 'image/png' }] }); }
    const part = u.pathname === '/api/people' ? 'people' : u.pathname === '/api/agents' ? 'agents' : u.pathname === '/api/generations' ? 'generations' : null;
    if (part) return db.fail.has(part) ? json({ error: 'nope' }, 500) : json({ [part]: db[part] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const look = (p, key) => p.evaluate((k) => ({ state: document.querySelector(`[data-xarea="${k}"]`)?.dataset.xareaState, live: !!window.XENO_ZONE_LIVE?.[k],
  mark: !!document.querySelector('#main [data-sample-badge]'), text: document.querySelector('#main')?.innerText || '', path: location.pathname }), key);
const clickRow = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);

try {
  {
    const { p, errs } = await open('/workspace/#/corpo/z/people');
    const s = await look(p, 'corpo.people');
    ok(s.state === 'ready' && s.live && !s.mark, `People is a live area with no sample mark (${s.state})`);
    ok(/Real Person/.test(s.text) && !SAMPLES.test(s.text), 'People lists the server’s people and no sample names');
    await shot(p, 'areas-people');
    await clickRow(p, `[data-xarea-to="Directory/${PID}"]`); await wait(700);
    ok((await p.evaluate(() => location.pathname)).endsWith(`/Directory/${PID}`), 'a person opens at their Directory address');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
  {
    const { p, errs } = await open('/workspace/#/dev/z/agents');
    const s = await look(p, 'dev.agents');
    ok(s.state === 'ready' && s.live && !s.mark, `Agents is a live area with no sample mark (${s.state})`);
    ok(/Real Agent/.test(s.text) && !SAMPLES.test(s.text), 'Agents lists the server’s agents and no sample sessions');
    await clickRow(p, `[data-xarea-to="Agents/${AID}"]`); await wait(700);
    ok((await p.evaluate(() => location.pathname)).endsWith(`/Agents/${AID}`), 'an agent opens at its address');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
  {
    const { p, errs } = await open('/workspace/#/studio/z/generate');
    const s = await look(p, 'studio.generate');
    ok(s.state === 'ready' && s.live && !s.mark, `Generate is a live area with no sample mark (${s.state})`);
    ok(/A real prompt/.test(s.text) && !SAMPLES.test(s.text), 'Generate lists the server’s generations and no sample rows');
    const href = await p.evaluate(() => document.querySelector('[data-xarea-href]')?.getAttribute('data-xarea-href'));
    ok(href && href.includes(GID) && href.startsWith('/workspace/studio/generate/'), `a generation opens at its own address (${href})`);
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
  {
    const { p, errs } = await open('/workspace/#/studio/z/create');
    const s = await look(p, 'studio.create');
    ok(s.state === 'ready' && s.live && !s.mark, `Create is a live area with no sample mark (${s.state})`);
    ok(/Real render\.mp4/.test(s.text) && /2\.5 MB/.test(s.text) && !/Launch trailer|Product shot|Podcast ep/.test(s.text), 'Create lists real files and no sample renders');
    ok(db.libraryAsked === 'studio' && !/A generated picture/.test(s.text), 'it reads this area of the Library, and leaves generations to Generate');
    ok(!/Launch trailer/.test(await p.evaluate(() => document.querySelector('#panel')?.innerText || '')), 'the sidebar shows no sample renders either');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
  {
    const { p, errs } = await open('/workspace/#/overview/g/anima');
    await wait(800);
    const t = await p.evaluate(() => document.querySelector('#main')?.innerText || '');
    ok(/Mind/.test(t) && /Soul/.test(t) && !/Atlas|Juno|Summarising 14/.test(t), 'Anima shows no sample Minds');
    ok(/stays on the computer where Anima runs/.test(t), 'and says where a Soul lives today');
    ok(await p.evaluate(() => !document.getElementById('xp-note') || document.getElementById('xp-note').hidden), 'with nothing sample left, the preview note isn’t there');
    if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/anima.png' });
    const row = await p.$('[data-xan="open"]');
    ok(!!row, 'an agent is listed');
    if (row) { await row.click(); await wait(900); ok(/\/Agents\/.*Identity|\/identity/i.test(await p.evaluate(() => location.pathname)), 'and opens at its Identity'); }
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
  }
  {
    db.fail.add('people');
    const { p } = await open('/workspace/#/corpo/z/people');
    const s = await look(p, 'corpo.people');
    ok(s.state === 'error' && /could not be loaded/.test(s.text) && !SAMPLES.test(s.text), 'a failed load says so, and shows no sample rows instead');
    db.fail.delete('people');
    await p.click('[data-xarea-retry="corpo.people"]'); await wait(800);
    ok((await look(p, 'corpo.people')).state === 'ready', 'Try again loads it');
    await p.close();
    const was = db.agents; db.agents = [];
    const e = await open('/workspace/#/dev/z/agents');
    ok(/No agents yet/.test((await look(e.p, 'dev.agents')).text), 'an empty area says it is empty');
    db.agents = was; await e.p.close();
  }
  {
    // Customers' catalogue entries still say "soon", but the area is live: the sidebar must not call it planned
    const { p } = await open('/workspace/#/corpo/z/customers');
    const panel = await p.evaluate(() => document.querySelector('#panel')?.innerText || '');
    ok(!/planned, not built/i.test(panel), 'a live area never says its product is planned');
    await p.close();
    const d = await open('/workspace/#/office/p/docs');
    const side = await d.p.evaluate(() => document.querySelector('#panel')?.innerText || '');
    ok(!/Hiring plan|Product principles/.test(side) && !/\bPlanning\b/.test(side), 'a product’s sidebar shows no sample rows on the platform');
    const note = await d.p.evaluate(() => document.getElementById('xp-note')?.textContent || '');
    ok(!/Anima|Company|Create\b|Generate/.test(note), `the note names nothing that became real (${note.slice(-90)})`);
    await d.p.close();
  }
} finally { await b.close(); await server.close(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
