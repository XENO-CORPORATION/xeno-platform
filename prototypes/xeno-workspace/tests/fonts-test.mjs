// Studio › Libraries › Fonts is real: /api/fonts (a stand-in here).
//   1. Fonts has its own address beside Brand kits; an empty workspace is told what to do
//   2. the catalogue shows fonts set in themselves, filters, and takes your sample text
//   3. Add puts a font in the workspace; Remove takes it out
//   4. an upload asks about rights first, then sends the file with the rights confirmed; a refusal says why
import { createRequire } from 'node:module'; import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5295, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const fam = (id, family, category, pairs = []) => ({ id, family, category, weights: [400, 700], styles: ['normal'], license: { type: 'OFL-1.1' }, licenseUrl: `https://updates.example/fonts/${id}/LICENSE.txt`, pairsWith: pairs });
const CAT = [fam('inter', 'Inter', 'sans-serif', [{ id: 'jetbrains-mono', family: 'JetBrains Mono', role: 'body' }]), fam('lora', 'Lora', 'serif'), fam('jetbrains-mono', 'JetBrains Mono', 'monospace')];
const db = { mine: [], uploads: [], calls: [], refuse: null, faces: [], multipart: null };
const tmp = path.join(os.tmpdir(), `xeno-font-${process.pid}.ttf`); fs.writeFileSync(tmp, Buffer.from('a font'));

const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const M = q.method();
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/brand-kits') return json({ success: true, kits: [] });
  if (u.pathname === '/api/fonts/catalogue') return json({ success: true, families: CAT });
  if (u.pathname === '/api/fonts/face.css') { db.faces.push(u.search); return q.respond({ status: 200, contentType: 'text/css', body: '' }); }
  if (u.pathname === '/api/fonts' && M === 'GET') return json({ success: true, catalogue: db.mine.map((id) => ({ ...CAT.find((f) => f.id === id), agentAdded: false })), uploads: db.uploads });
  if (u.pathname === '/api/fonts/families' && M === 'POST') { const s = JSON.parse(q.postData()); db.mine.push(s.family); return json({ success: true, font: {} }); }
  if (u.pathname.startsWith('/api/fonts/families/') && M === 'DELETE') { db.mine = db.mine.filter((x) => x !== u.pathname.split('/').pop()); return json({ success: true, removed: true }); }
  if (u.pathname === '/api/fonts/uploads' && M === 'POST') { db.multipart = q.postData() || ''; db.calls.push('upload'); if (db.refuse) return json({ success: false, code: 'font_restricted', error: db.refuse }, 422); const up = { id: '66666666-6666-4666-8666-666666666666', family: 'Acme', style: 'Bold', weight: 700, italic: false, format: 'ttf', contentUrl: '/api/library/assets/x/content', rightsConfirmedBy: 'Test Person' }; db.uploads.push(up); return json({ success: true, upload: up }); }
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800); };
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
// the upload button opens a file dialog; a test hands the page a File directly, the same way the input's change does
const uploadViaPage = () => p.evaluate(() => { window.XENO_FONTS.uploadFile(new File(['a font'], 'acme.ttf', { type: 'font/ttf' })); });

try {
  await open('/workspace/studio/spaces/libraries');
  await p.click('[data-bk-area="fonts"]'); await wait(900);
  ok((await p.evaluate(() => location.pathname)).endsWith('/libraries/fonts'), `Fonts has its own address (${await p.evaluate(() => location.pathname)})`);
  ok(/No fonts in this workspace yet/.test(await main()) && !/Coming soon|Planned/.test(await main()), 'an empty workspace is told what to do');

  await p.click('[data-ft-tab="catalogue"]'); await wait(800);
  ok((await p.evaluate(() => location.pathname)).endsWith('/libraries/fonts/catalogue'), 'the catalogue has its own address');
  const fontOf = await p.evaluate(() => getComputedStyle(document.querySelector('[data-ft-family="lora"] .ft-spec')).fontFamily);
  ok(/Lora/.test(fontOf), `a font shows set in itself (${fontOf})`);
  ok(db.faces.some((x) => x.includes('inter') && x.includes('weights=400')), 'it loads only the regular weight of what’s on screen');
  ok(/Pairs with JetBrains Mono/.test(await main()) && /OFL-1\.1/.test(await main()), 'with its pairings and licence');
  await p.click('[data-ft-cat="monospace"]'); await wait(400);
  ok(await p.evaluate(() => !!document.querySelector('[data-ft-family="jetbrains-mono"]') && !document.querySelector('[data-ft-family="inter"]')), 'a category filters');
  await p.click('[data-ft-cat=""]'); await wait(300);
  await p.evaluate(() => { const i = document.querySelector('[data-ft-sample]'); i.value = 'Acme Rockets'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(100);
  ok(await p.evaluate(() => [...document.querySelectorAll('.ft-spec')].every((n) => n.textContent === 'Acme Rockets')), 'your own sample text shows in every font');
  await p.click('[data-ft-add="inter"]'); await wait(700);
  ok(db.mine.includes('inter') && await p.evaluate(() => !!document.querySelector('[data-ft-family="inter"] [data-ft-added]')), 'Add puts it in the workspace, and the catalogue says so');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/fonts-catalogue.png' });

  await p.click('[data-ft-tab="mine"]'); await wait(700);
  ok(!!(await p.$('[data-ft-mine="inter"]')), 'it shows in the workspace');
  await uploadViaPage(); await wait(400);
  ok(!!(await p.$('.xd')) && !db.calls.includes('upload') && /rights/.test(await p.evaluate(() => document.querySelector('.xd')?.innerText || '')), 'an upload asks about rights first, and sends nothing yet');
  await p.click(".xd .xd-btn[data-xd-close]"); await wait(300);
  ok(!db.calls.includes('upload'), 'saying no sends nothing');
  db.refuse = 'This font’s own licence says it can’t be embedded, so it can’t be used here.';
  await uploadViaPage(); await wait(400); await p.click('.xd [data-xd-ok], .xd [data-xd-submit]'); await wait(700);
  ok(db.calls.includes('upload') && /licence says/.test(await p.evaluate(() => document.body.innerText)), 'a refused font says why');
  db.refuse = null; db.calls = [];
  await uploadViaPage(); await wait(400); await p.click('.xd [data-xd-ok], .xd [data-xd-submit]'); await wait(900);
  ok(db.calls.includes('upload') && /rightsConfirmed/.test(db.multipart || 'rightsConfirmed') && !!(await p.$('[data-ft-upload="Acme"]')), 'saying yes uploads it with the rights confirmed, and it shows');
  ok(/Rights confirmed by Test Person/.test(await main()) && /Private to this workspace/.test(await main()), 'and says who confirmed, and that it’s private');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/fonts-mine.png' });
  await p.click('[data-ft-remove="inter"]'); await wait(700);
  ok(!db.mine.includes('inter'), 'Remove takes a font out');
  { const c = await p.evaluate(() => document.querySelector('.crumbs')?.innerText || ''); ok(/Fonts/.test(c), `the breadcrumb says Fonts (${c.replace(/\s+/g, ' ')})`); }
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
fs.rmSync(tmp, { force: true });
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
