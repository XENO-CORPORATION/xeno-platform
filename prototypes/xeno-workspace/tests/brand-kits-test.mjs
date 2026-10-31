// Studio › Libraries is real: a workspace's brand kits from /api/brand-kits (a stand-in here).
//   1. the area is live: no "Coming soon", no sample rows; an empty account is told what to do
//   2. New brand kit asks in a dialog, then opens at its own address; refresh lands there
//   3. a token is added in a dialog and shows with a swatch; a value saves when you leave the field; a refusal says so
//   4. publishing asks first, and sends a note; it isn't offered when nothing changed
//   5. versions list with an export per format; logos and voice have their own address
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5296, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const KID = '44444444-4444-4444-8444-444444444444', FILE = '55555555-5555-4555-8555-555555555555';
const db = { calls: [], kit: null, versions: [] };
const view = () => ({ ...db.kit, problems: [], url: `/workspace/studio/spaces/libraries/${KID}` });

const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const sent = q.postData() ? JSON.parse(q.postData()) : null, M = q.method();
  if (u.pathname.startsWith('/api/brand-kits')) db.calls.push([M, u.pathname + u.search, sent]);
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  if (u.pathname === '/api/library/assets') return json({ success: true, items: [{ id: 'file:' + FILE, source: 'file', source_id: FILE, name: 'mark.png', mime_type: 'image/png' }] });
  if (u.pathname === '/api/brand-kits' && M === 'GET') return json({ success: true, kits: db.kit ? [{ ...view(), items: db.kit.items.length }] : [] });
  if (u.pathname === '/api/brand-kits' && M === 'POST') { db.kit = { id: KID, name: sent.name, description: '', voice: '', modes: [], items: [], latestVersion: null, unpublished: false, updatedAt: new Date().toISOString() }; return json({ success: true, kit: view() }); }
  const m = u.pathname.match(/^\/api\/brand-kits\/[0-9a-f-]{36}(\/.*)?$/), tail = m ? m[1] || '' : null;
  if (m && !tail && M === 'GET') return json({ success: true, kit: view() });
  if (m && !tail && M === 'PATCH') { Object.assign(db.kit, sent); return json({ success: true, kit: view() }); }
  if (tail === '/tokens') {
    const put = () => { const i = db.kit.items.findIndex((x) => x.path === sent.path), row = { id: sent.path, path: sent.path, kind: sent.value.kind, value: sent.value, valuesByMode: sent.valuesByMode || {}, description: '' }; if (i >= 0) db.kit.items[i] = row; else db.kit.items.push(row); db.kit.unpublished = true; return row; };
    if (sent.value.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(sent.value.value)) return json({ success: false, code: 'invalid_color', error: 'A color must look like #1a2b3c' }, 400);
    return json({ success: true, item: put() });
  }
  if (tail === '/logos') { db.kit.items.push({ id: 'l', path: 'logo.' + sent.name, kind: 'logo', value: { kind: 'logo', fileId: sent.fileId, fileName: 'mark.png' }, valuesByMode: {} }); db.kit.unpublished = true; return json({ success: true, item: {} }); }
  if (tail === '/publish') { const v = { version: db.versions.length + 1, digest: 'a'.repeat(64), note: sent.note, items: db.kit.items.length, publishedAt: new Date().toISOString(), publishedBy: 'Test Person' }; db.versions.unshift(v); db.kit.latestVersion = v.version; db.kit.unpublished = false; return json({ success: true, version: v }); }
  if (tail === '/versions') return json({ success: true, versions: db.versions });
  return json({ success: false, error: 'not found' }, 404); });
const open = async (addr) => { await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800); };
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const panel = () => p.evaluate(() => document.querySelector('#panel')?.innerText || '');
const saved = () => p.evaluate(() => document.querySelector('[data-bk-saved]')?.textContent || '');
const fill = async (id, text) => { await p.evaluate((i) => { document.getElementById('xdf-' + i).value = ''; }, id); await p.type('#xdf-' + id, text); };
const submit = async () => { await p.click('.xd [data-xd-submit], .xd [data-xd-ok]'); await wait(800); };

try {
  await open('/workspace/studio/spaces/libraries');
  const t0 = await main(), s0 = await panel();
  ok(/No brand kits yet/.test(t0) && !/Coming soon|Planned|Notify me/.test(t0 + s0), 'an empty account is told what to do, and nothing says it’s coming');
  ok(await p.evaluate(() => !!window.XENO_ZONE_LIVE['studio.libraries'] && !document.querySelector('#main [data-sample-badge]')), 'it’s a live area with no sample mark');

  await p.click('[data-bk-new]'); await wait(400);
  await fill('name', 'Acme'); await submit();
  ok((await p.evaluate(() => location.pathname)).endsWith(`/libraries/${KID}`), `New brand kit opens at its own address (${await p.evaluate(() => location.pathname)})`);
  ok(await p.evaluate(() => document.querySelector('[data-bk-publish]')?.disabled), 'an unchanged kit doesn’t offer Publish');

  await p.evaluate(() => document.querySelector('[data-bk-add]').click()); await wait(400);
  await fill('path', 'color.brand.primary'); await fill('value', '#1a2b3c'); await submit();
  const sent = db.calls.filter((c) => c[1].includes('/tokens')).pop();
  ok(sent && sent[2].path === 'color.brand.primary' && sent[2].value.kind === 'color' && sent[2].value.value === '#1a2b3c', 'adding a token sends its name and value');
  ok(await p.evaluate(() => document.querySelector('[data-bk-token="color.brand.primary"] .bk-sw')?.style.background !== ''), 'it shows with a swatch');

  await p.evaluate(() => { const i = document.querySelector('[data-bk-val="color.brand.primary"]'); i.value = '#000000'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(700);
  ok(db.calls.filter((c) => c[1].includes('/tokens')).pop()[2].value.value === '#000000', 'a value saves when you leave the field');
  await p.evaluate(() => { const i = document.querySelector('[data-bk-val="color.brand.primary"]'); i.value = 'red'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(700);
  ok(/Not saved: A color must look like/.test(await saved()), 'a value that’s refused says so');
  await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await p.evaluate(() => document.querySelector('[data-bk-val="color.brand.primary"]')?.value === '#000000'), 'a refresh lands on the same kit, with what was saved');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/kit-tokens.png' });

  await p.click('[data-bk-publish]'); await wait(400);
  ok(!!(await p.$('.xd')) && !db.calls.some((c) => c[1].includes('/publish')), 'publishing asks first');
  await fill('note', 'First'); await submit(); await wait(500);
  ok(db.calls.filter((c) => c[1].includes('/publish')).pop()[2].note === 'First' && /v1 is published/.test(await main()), 'then it publishes with the note');
  ok(await p.evaluate(() => document.querySelector('[data-bk-publish]')?.disabled), 'and there’s nothing to publish until something changes');

  await p.click('[data-bk-tab="versions"]'); await wait(800);
  ok((await p.evaluate(() => location.pathname)).endsWith(`/${KID}/versions`), 'Versions has its own address');
  ok(await p.evaluate(() => ['dtcg', 'css', 'tailwind', 'canvas'].every((f) => document.querySelector(`[data-bk-export="${f}"]`)?.getAttribute('href').includes('format=' + f + '&version=1') || document.querySelector(`[data-bk-export="${f}"]`)?.getAttribute('href').includes('version=1'))), 'each version exports in every format');

  await p.click('[data-bk-tab="brand"]'); await wait(800);
  ok((await p.evaluate(() => location.pathname)).endsWith(`/${KID}/brand`), 'Logos and voice has its own address');
  await p.click('[data-bk-addlogo]'); await wait(700);
  await fill('name', 'primary'); await submit();
  ok(db.calls.filter((c) => c[1].includes('/logos')).pop()[2].fileId === FILE && await p.evaluate((f) => document.querySelector('[data-bk-logo="logo.primary"] img')?.getAttribute('src').includes(f), FILE), 'a logo comes from the Library and shows from it');
  await p.type('[data-bk-voice]', 'Plain and warm.'); await wait(1100);
  ok(db.calls.filter((c) => c[0] === 'PATCH').pop()[2].voice === 'Plain and warm.' && await saved() === 'Saved', 'the voice saves as you type');
  { const c = await p.evaluate(() => document.querySelector('.crumbs')?.innerText || ''); ok(/Acme/.test(c) && !/4444/.test(c), `the breadcrumb names the kit, not its id (${c.replace(/\s+/g, ' ')})`); }

  await open('/workspace/studio/spaces/libraries');
  ok(!!(await p.$(`[data-bk-open="${KID}"]`)) && /v1/.test(await main()), 'the list shows the kit and its version');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
} catch (e) { fails++; console.log('FAIL threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
