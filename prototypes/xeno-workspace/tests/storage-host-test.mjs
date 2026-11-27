// storage-host-test — XENO Storage on its own host, storage.xenosystem.ai (owner, 2026-11-21: "the same for
// storage.xenosystem.ai … that drive-like interface … that made people be familiar with, but under our XENO system logic
// for his account"; 2026-11-27: "finish the rest of the interfaces that need to be on the platform"). From the production
// build (dist/), against the workspace's own Storage page (/workspace/corpo/apps/storage):
//   1. the left construction is the workspace's at 1920 and 768 px (rail, slot, flare, panel, plate) and on a phone (390 px:
//      the drawer), and collapse/expand animates the flare as there;
//   2. the rail carries Storage's places and nothing of the workspace's; each place is the host's own address
//      (/, /recent, /starred, /shared, /trash, /usage, /folders/<id>) and a deep link opens it;
//   3. the sidebar carries the product ("Storage"), not "Overview › Storage";
//   4. Upload on the rail opens the file picker, and a real 120 MB file plus a folder go through the upload panel in
//      16 MiB parts, with sent bytes rising part by part, a queue, and every file done.
//   npx vite build && node prototypes/xeno-workspace/tests/storage-host-test.mjs   (SHOT=1 saves captures)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), dist = path.join(repo, 'dist');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
if (!fs.existsSync(path.join(dist, 'workspace', 'storage.html'))) throw new Error('build first: npx vite build');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const USER = { id: '7a5e3c1e-0000-4000-8000-000000000007', username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const FOLDER = { id: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', name: 'Contracts', parent_id: null, updated_at: '2026-11-20T10:00:00Z' };
const PART = 16 * 1024 * 1024;
const files = [{ source: 'file', source_id: 'r-1', file_id: 'f-1', name: 'Brief.pdf', size_bytes: 120000, mime_type: 'application/pdf', updated_at: '2026-11-25T09:00:00Z' }];
const sessions = new Map(); const asked = [];
const file = (res, f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const describe = (s) => ({ id: s.id, name: s.name, size: s.size, partSize: PART, partCount: s.partCount, state: s.state, errorCode: null, file: s.file,
  parts: [...s.parts.entries()].map(([n, b]) => ({ n, size: b })), transport: s.state === 'uploading' ? { kind: 'platform', partUrl: `/api/library/uploads/${s.id}/parts/{n}` } : null });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), host = String(req.headers.host || ''), storageHost = host.startsWith('storage.');
  const json = (b, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname.startsWith('/api/')) {
    asked.push(`${req.method} ${u.pathname}${u.search}`);
    if (u.pathname === '/api/auth/me' || u.pathname === '/api/auth/validate') return json({ success: true, valid: true, user: USER });
    if (u.pathname === '/api/auth/activation-status') return json({ success: true, activated: true });
    if (u.pathname === '/api/auth/onboarding') return json({ success: true, done: true, welcomeAcknowledged: true });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    if (u.pathname === '/api/library/storage') return json({ success: true, storage: { usedBytes: 2_400_000_000, allowanceBytes: 100 * 1024 ** 3, plan: 'pro' } });
    if (u.pathname === '/api/library/folders' && req.method === 'GET') {
      const parent = u.searchParams.get('parent');
      if (parent === FOLDER.id) return json({ success: true, folders: [], path: [FOLDER], workspace: null });
      return json({ success: true, folders: parent === 'root' ? [FOLDER] : [], path: [] });
    }
    if (u.pathname === '/api/library/assets' && req.method === 'GET') return json({ success: true, items: u.searchParams.get('view') === 'trash' ? [] : files, total: files.length, has_more: false });
    if (u.pathname === '/api/library/uploads' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      const s = { id: crypto.randomUUID(), name: b.name, size: b.size, folder: b.folder || null, partCount: Math.ceil(b.size / PART), parts: new Map(), state: 'uploading', file: null };
      sessions.set(s.id, s); return json({ success: true, session: describe(s) }, 201);
    }
    let m;
    if ((m = /^\/api\/library\/uploads\/([\w-]+)\/parts\/(\d+)$/.exec(u.pathname)) && req.method === 'PUT') {
      const s = sessions.get(m[1]); const data = await body(req); const n = Number(m[2]);
      await new Promise((r) => setTimeout(r, 120));   // a part takes time, so progress can be seen moving
      s.parts.set(n, data.length); return json({ success: true, part: { n, size: data.length } });
    }
    if ((m = /^\/api\/library\/uploads\/([\w-]+)\/complete$/.exec(u.pathname)) && req.method === 'POST') {
      const s = sessions.get(m[1]); req.resume();
      if ([...s.parts.values()].reduce((a, b) => a + b, 0) !== s.size) return json({ success: false, code: 'incomplete' }, 409);
      s.state = 'processing'; setTimeout(() => { s.state = 'done'; s.file = { id: 'rev-' + s.id.slice(0, 8), fileId: 'file-' + s.id.slice(0, 8), name: s.name, size: s.size }; }, 300);
      return json({ success: true, session: describe(s) }, 202);
    }
    if ((m = /^\/api\/library\/uploads\/([\w-]+)$/.exec(u.pathname)) && req.method === 'GET') return json({ success: true, session: describe(sessions.get(m[1])) });
    if (u.pathname === '/api/library/folders' && req.method === 'POST') { const b = JSON.parse((await body(req)).toString() || '{}'); return json({ success: true, folder: { id: crypto.randomUUID(), name: b.name, parent_id: b.parent || null } }, 201); }
    return json({ success: true });
  }
  if (u.pathname === '/env-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__ENV__={};'); }
  if (storageHost && /^\/[^.]*$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'storage.html'));
  if (!storageHost && /^\/workspace(\/[^.]*)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'index.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, HOST = `http://storage.localhost:${port}`;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 120000 });
const geometry = () => {
  const q = (s) => document.querySelector(s), rect = (e) => { if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const slot = q('.slot'), main = q('.main'), panel = q('.slot .panel'), sm = getComputedStyle(main), sb = getComputedStyle(slot, '::before'), sa = getComputedStyle(slot, '::after');
  const mr = main.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  return { panelState: document.documentElement.dataset.panel || null, rail: rect(q('.rail')), slot: rect(slot), fr: getComputedStyle(slot).getPropertyValue('--fr').trim(),
    flareTop: [sb.width, sb.height, sb.top], flareBottom: [sa.width, sa.height, sa.bottom], panel: rect(panel), panelRadius: getComputedStyle(panel).borderTopLeftRadius,
    main: [Math.round(mr.left), Math.round(mr.top), Math.round(innerWidth - mr.right), Math.round(innerHeight - mr.bottom)], radius: sm.borderTopLeftRadius, radiusBL: sm.borderBottomLeftRadius,
    stroke: sm.borderTopWidth, clip: sm.clipPath, panelToMain: Math.round(mr.left - pr.right) };
};
const errors = [];
const open = async (url, w, h) => {
  const p = await br.newPage(); await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errors.push(`${url}: ${e.message}`));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.main', { timeout: 30000 });
  await p.waitForFunction(() => !document.documentElement.classList.contains('xp-wait'), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  return p;
};
const shot = async (p, name) => { if (!process.env.SHOT) return; const f = path.join(repo, 'scratchpad', 'storage-host', name); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.bringToFront(); await p.screenshot({ path: f }); console.log('SHOT', f); };
const toggle = async (p) => {
  await p.bringToFront();
  await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control');
  const mid = []; for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 45)); mid.push(parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.slot')).getPropertyValue('--fr')))); }
  await new Promise((r) => setTimeout(r, 600));
  return { mid, end: await p.evaluate(geometry) };
};
const same = (a, b, keys) => keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const big = path.join(os.tmpdir(), `xeno-storage-host-test-${process.pid}.bin`);
try {
  // 1. the construction, the workspace's own
  for (const [w, h] of [[1920, 1080], [768, 1024]]) {
    const pw = await open(`http://localhost:${port}/workspace/corpo/apps/storage`, w, h), ps = await open(`${HOST}/`, w, h);
    const ws = await pw.evaluate(geometry), st = await ps.evaluate(geometry);
    await shot(pw, `workspace-${w}.png`); await shot(ps, `storage-host-${w}.png`);
    console.log(`  ${w}px workspace`, JSON.stringify(ws)); console.log(`  ${w}px storage host`, JSON.stringify(st));
    ok(!!st.rail && same(st, ws, ['rail']), `${w}px: the rail at the window's left edge, the workspace's (${JSON.stringify(st.rail)} vs ${JSON.stringify(ws.rail)})`);
    ok(same(st, ws, ['slot', 'panel', 'panelRadius']), `${w}px: the panel grows out of it where the workspace's does (${JSON.stringify(st.panel)} vs ${JSON.stringify(ws.panel)})`);
    ok(same(st, ws, ['fr', 'flareTop', 'flareBottom']) && parseFloat(st.fr) > 0, `${w}px: joined by the same flare (--fr ${st.fr})`);
    ok(same(st, ws, ['main', 'radius', 'radiusBL', 'stroke', 'clip', 'panelToMain']) && parseFloat(st.radius) > 0, `${w}px: Storage on the same plate (${JSON.stringify(st.main)}, ${st.radius}, panel→plate ${st.panelToMain})`);
    const cw = await toggle(pw), cs = await toggle(ps);
    const animated = (t, from, to) => t.mid.some((v) => v > Math.min(from, to) && v < Math.max(from, to));
    ok(cs.end.panelState === 'closed' && parseFloat(cs.end.fr) === 0 && animated(cs, 15, 0) && same(cs.end, cw.end, ['rail', 'main', 'radius']), `${w}px: collapsed as in the workspace; the flare ran ${JSON.stringify(cs.mid)} → 0`);
    const ew = await toggle(pw), es = await toggle(ps);
    ok(es.end.panelState === 'open' && same(es.end, ew.end, ['rail', 'slot', 'fr', 'main', 'panelToMain']) && animated(es, 0, 15), `${w}px: expanded again, equal to the workspace's`);
    await pw.close(); await ps.close();
  }
  // on a phone: the rail and sidebar are a drawer, as in the workspace (phone-drawer-test is the drawer's own proof)
  {
    const pw = await open(`http://localhost:${port}/workspace/corpo/apps/storage`, 390, 844), ps = await open(`${HOST}/`, 390, 844);
    const ws = await pw.evaluate(geometry), st = await ps.evaluate(geometry);
    await shot(pw, 'workspace-390.png'); await shot(ps, 'storage-host-390.png');
    console.log('  390px workspace', JSON.stringify(ws)); console.log('  390px storage host', JSON.stringify(st));
    ok(same(st, ws, ['panelState', 'main', 'radius', 'stroke']), `390px: the plate and the closed drawer equal the workspace's (${JSON.stringify(st.main)} ${st.radius}, ${st.panelState})`);
    const over = await ps.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 0, `390px: no sideways scroll (${over} px)`);
    await pw.close(); await ps.close();
  }
  // 2 and 3. the rail's places, the host's addresses, the sidebar's head
  const p = await open(`${HOST}/`, 1440, 900);
  const rail = await p.evaluate(() => [...document.querySelectorAll('#rail .rmid .rbtn')].map((b) => b.getAttribute('aria-label')));
  ok(JSON.stringify(rail) === JSON.stringify(['Upload', 'My files', 'Recent', 'Starred', 'Shared', 'Trash', 'Storage used', 'Search']), `the rail carries Storage's places: ${rail.join(', ')}`);
  ok(await p.evaluate(() => !document.querySelector('#rail [data-product], #rail [data-go="projects"], #rail [data-go="market"]')), 'the rail carries nothing of the workspace\'s');
  const head = await p.evaluate(() => ({ brand: document.querySelector('#panel .xch-brand b')?.textContent, back: !!document.querySelector('#panel [data-back]') }));
  ok(head.brand === 'Storage' && !head.back, `the sidebar carries the product: ${JSON.stringify(head)}`);
  ok(await p.evaluate(() => document.querySelector('#rail [aria-label="My files"]')?.getAttribute('aria-current') === 'true'), 'My files is the current place at /');
  ok(await p.evaluate(() => !!document.querySelector('.xst [data-xst-folder]')), 'My files lists the account\'s folders');
  for (const [label, want] of [['Recent', '/recent'], ['Starred', '/starred'], ['Shared', '/shared'], ['Trash', '/trash'], ['Storage used', '/usage'], ['My files', '/']]) {
    await p.click(`#rail [aria-label="${label}"]`); await new Promise((r) => setTimeout(r, 500));
    const at = await p.evaluate(() => ({ path: location.pathname, current: document.querySelector('#rail .rmid [aria-current="true"]')?.getAttribute('aria-label') }));
    ok(at.path === want && at.current === label, `${label} → ${want} (${JSON.stringify(at)})`);
  }
  await p.click(`.xst [data-xst-folder="${FOLDER.id}"]`); await new Promise((r) => setTimeout(r, 600));
  ok(await p.evaluate((id) => location.pathname === `/folders/${id}`, FOLDER.id), `opening a folder is /folders/<id> (${await p.evaluate(() => location.pathname)})`);
  await p.close();
  const deep = await open(`${HOST}/folders/${FOLDER.id}`, 1440, 900);
  ok(asked.some((a) => a.includes(`/api/library/folders?parent=${FOLDER.id}`)), 'a deep link to /folders/<id> opens that folder');
  ok(await deep.evaluate(() => !document.querySelector('#rail .rmid [aria-current="true"]') || document.querySelector('#rail .rmid [aria-current="true"]').getAttribute('aria-label') === 'My files'), 'a folder belongs to My files on the rail');
  await deep.close();
  // 4. Upload on the rail: the file picker, then a real 120 MB file and a folder through the panel
  fs.writeFileSync(big, crypto.randomBytes(120 * 1024 * 1024));
  const up = await open(`${HOST}/`, 1440, 900);
  const [chooser] = await Promise.all([up.waitForFileChooser({ timeout: 10000 }), up.click('#rail [aria-label="Upload"]')]);
  ok(!!chooser, 'Upload on the rail opens the file picker');
  await chooser.accept([big]);
  // a folder (its files and their places), as a dropped or picked folder becomes
  await up.evaluate(() => window.XENO_STORAGE_UPLOADS.addPaths([['Holiday', 'a.txt'], ['Holiday', 'b.txt'], ['Holiday', 'days', 'c.txt']].map((pth) => ({ path: pth.slice(0, -1), file: new File([`file ${pth.join('/')}`], pth.at(-1), { type: 'text/plain' }) })), { folder: null, workspace: null }));
  const seen = []; let queued = false; const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const jobs = await up.evaluate(() => window.XENO_STORAGE_UPLOADS.jobs());
    const bigJob = jobs.find((j) => j.size === 120 * 1024 * 1024);
    if (bigJob && seen.at(-1) !== bigJob.sent) seen.push(bigJob.sent);
    if (jobs.some((j) => j.state === 'queued')) queued = true;
    if (jobs.length >= 4 && jobs.every((j) => j.state === 'done')) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const final = await up.evaluate(() => window.XENO_STORAGE_UPLOADS.jobs());
  const panel = await up.evaluate(() => document.querySelector('.xsu-h')?.textContent || '');
  await shot(up, 'upload-done.png');
  console.log('  jobs', JSON.stringify(final.map(({ name, state, sent, size }) => ({ name, state, sent, size }))));
  ok(final.length === 4 && final.every((j) => j.state === 'done'), `the 120 MB file and the folder's 3 files are done (${final.map((j) => j.state).join(', ')})`);
  ok(seen.length >= 3 && seen.every((v, i) => i === 0 || v >= seen[i - 1]), `the 120 MB file's sent bytes rose part by part: ${seen.map((v) => Math.round(v / 1048576)).join(' → ')} MiB`);
  ok(queued, 'files waited in a queue while others uploaded');
  const big0 = [...sessions.values()].find((s) => s.size === 120 * 1024 * 1024);
  ok(big0 && big0.partCount === 8 && big0.parts.size === 8, `the 120 MB file went in 8 parts of 16 MiB (${big0 && big0.parts.size})`);
  ok(asked.filter((a) => a.startsWith('POST /api/library/folders')).length >= 2, 'the folder\'s folders were made (Holiday, days)');
  ok(/./.test(panel), `the panel says what happened: "${panel.trim()}"`);
  await up.close();
  ok(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally { await br.close(); server.close(); try { fs.unlinkSync(big); } catch {} }
console.log(failed ? `${failed} FAILED` : 'storage-host: all passed'); process.exit(failed ? 1 : 0);
