// chat-host-plate-test — the chat on chat.xenosystem.ai sits on the workspace's own plate (owner, 2026-11-27: "we got the
// issue with the top left and bottom left of the container where the chat is displayed … we should have it as the platform
// has it"). Until then the chat host stripped the plate: square corners, no stroke, no gaps, edge to edge beside the
// sidebar's rounded plate. Measured from the production build (dist/) against the workspace's own chat page
// (/workspace/apps/chat), at 1920 and 390 px: the plate's radius, stroke and clip, its gaps to the window, and the gap
// between the sidebar's plate and it, must equal the workspace's.
//   npx vite build && node prototypes/xeno-workspace/tests/chat-host-plate-test.mjs   (SHOT=1 saves side-by-side captures)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), dist = path.join(repo, 'dist');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
if (!fs.existsSync(path.join(dist, 'workspace', 'chat.html'))) throw new Error('build first: npx vite build');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const USER = { id: 7, username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const file = (res, f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), chatHost = String(req.headers.host || '').startsWith('chat.');
  if (u.pathname.startsWith('/api/')) {
    const json = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/auth/me' || u.pathname === '/api/auth/validate') return json({ success: true, valid: true, user: USER });
    if (u.pathname === '/api/auth/activation-status') return json({ success: true, activated: true });
    if (u.pathname === '/api/auth/onboarding') return json({ success: true, done: true, welcomeAcknowledged: true });
    if (u.pathname === '/api/chat/conversations') return json({ success: true, conversations: [], total: 0 });
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    return json({ success: true });
  }
  if (u.pathname === '/env-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__ENV__={};'); }
  if (/^\/chat(\/|$)/.test(u.pathname)) return file(res, path.join(dist, 'index.html'));
  if (chatHost && /^\/((c|projects|library|images)(\/[^.]*)?)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'chat.html'));
  if (!chatHost && /^\/workspace(\/[^.]*)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'index.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
// The left construction, read from the page: the rail, the slot, the flare (the rail's inverted corners, .slot::before and
// ::after, sized by --fr), the panel and the plate, each as numbers that the two pages must share.
const geometry = () => {
  const q = (s) => document.querySelector(s), rect = (e) => { if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const slot = q('.slot'), main = q('.main'), panel = q('.slot .panel'), sm = getComputedStyle(main), sb = getComputedStyle(slot, '::before'), sa = getComputedStyle(slot, '::after');
  const mr = main.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  return { panelState: document.documentElement.dataset.panel || null, rail: rect(q('.rail')), slot: rect(slot), fr: getComputedStyle(slot).getPropertyValue('--fr').trim(),
    flareTop: [sb.width, sb.height, sb.top], flareBottom: [sa.width, sa.height, sa.bottom], panel: rect(panel), panelRadius: getComputedStyle(panel).borderTopLeftRadius,
    main: [Math.round(mr.left), Math.round(mr.top), Math.round(innerWidth - mr.right), Math.round(innerHeight - mr.bottom)], radius: sm.borderTopLeftRadius, radiusBL: sm.borderBottomLeftRadius,
    stroke: sm.borderTopWidth, clip: sm.clipPath, panelToMain: Math.round(mr.left - pr.right) };
};
const open = async (url, w, h) => {
  const p = await br.newPage(); await p.setViewport({ width: w, height: h });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.main', { timeout: 30000 });
  await p.waitForFunction(() => !document.documentElement.classList.contains('xp-wait'), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  return p;
};
const shot = async (p, name) => { if (!process.env.SHOT) return; const f = path.join(repo, 'scratchpad', name); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.bringToFront(); await p.screenshot({ path: f }); console.log('SHOT', f); };
// collapse (or expand) with the page's own shortcut, sampling --fr while the flare's transition runs
const toggle = async (p) => {
  await p.bringToFront();   // a background tab throttles its timers and its transitions
  await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control');
  const mid = []; for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 45)); mid.push(parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.slot')).getPropertyValue('--fr')))); }
  await new Promise((r) => setTimeout(r, 600));
  return { mid, end: await p.evaluate(geometry) };
};
const same = (a, b, keys) => keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const pw = await open(`http://localhost:${port}/workspace/apps/chat`, w, h), pc = await open(`http://chat.localhost:${port}/`, w, h);
    const ws = await pw.evaluate(geometry), ch = await pc.evaluate(geometry);
    await shot(pw, `plate-workspace-${w}.png`); await shot(pc, `plate-chat-host-${w}.png`);
    console.log(`  ${w}px workspace`, JSON.stringify(ws)); console.log(`  ${w}px chat host`, JSON.stringify(ch));
    ok(!!ch.rail && same(ch, ws, ['rail']), `${w}px: a rail at the window's left edge, the workspace's (${JSON.stringify(ch.rail)} vs ${JSON.stringify(ws.rail)})`);
    ok(same(ch, ws, ['slot', 'panel', 'panelRadius']), `${w}px: the panel grows out of it where the workspace's does (${JSON.stringify(ch.panel)} vs ${JSON.stringify(ws.panel)})`);
    ok(same(ch, ws, ['fr', 'flareTop', 'flareBottom']) && parseFloat(ch.fr) > 0, `${w}px: joined by the same flare (--fr ${ch.fr}, corners ${ch.flareTop[0]})`);
    ok(same(ch, ws, ['main', 'radius', 'radiusBL', 'stroke', 'clip', 'panelToMain']) && parseFloat(ch.radius) > 0, `${w}px: the chat on the same plate (${JSON.stringify(ch.main)}, ${ch.radius}, panel→plate ${ch.panelToMain})`);
    // collapse, then expand, on both: the flare animates down to 0 and back, and the two stay equal
    const cw = await toggle(pw), cc = await toggle(pc);
    const animated = (t, from, to) => t.mid.some((v) => v > Math.min(from, to) && v < Math.max(from, to));
    ok(cc.end.panelState === 'closed' && parseFloat(cc.end.fr) === 0 && animated(cc, 15, 0) && same(cc.end, cw.end, ['rail', 'main', 'radius']), `${w}px: collapsed, the rail remains and the plate meets it as in the workspace; the flare ran ${JSON.stringify(cc.mid)} → 0`);
    await shot(pc, `plate-chat-host-${w}-collapsed.png`); await shot(pw, `plate-workspace-${w}-collapsed.png`);
    console.log(`  ${w}px collapsed workspace`, JSON.stringify(cw.end.main), cw.end.radius, '· chat host', JSON.stringify(cc.end.main), cc.end.radius);
    const ew = await toggle(pw), ec = await toggle(pc);
    ok(ec.end.panelState === 'open' && same(ec.end, ew.end, ['rail', 'slot', 'fr', 'main', 'panelToMain']) && animated(ec, 0, 15), `${w}px: expanded again, equal to the workspace's; the flare ran ${JSON.stringify(ec.mid)}`);
    await pw.close(); await pc.close();
  }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'chat-host-plate: all passed'); process.exit(failed ? 1 : 0);
