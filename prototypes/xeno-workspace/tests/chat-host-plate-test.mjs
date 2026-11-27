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
const measure = async (url, w, h, shot) => {
  const p = await br.newPage(); await p.setViewport({ width: w, height: h });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.main', { timeout: 30000 });
  await p.waitForFunction(() => !document.documentElement.classList.contains('xp-wait'), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  const m = await p.evaluate(() => {
    const main = document.querySelector('.main'), panel = document.querySelector('.slot .panel') || document.querySelector('.panel');
    const r = main.getBoundingClientRect(), s = getComputedStyle(main), pr = panel && getComputedStyle(panel).display !== 'none' ? panel.getBoundingClientRect() : null;
    return { radius: s.borderTopLeftRadius, radiusBL: s.borderBottomLeftRadius, stroke: s.borderTopWidth, clip: s.clipPath, top: Math.round(r.top), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom),
      panelGap: pr ? Math.round(r.left - pr.right) : null, panelTop: pr ? Math.round(pr.top) : null, panelRadius: panel ? getComputedStyle(panel).borderTopLeftRadius : null, panelState: document.documentElement.dataset.panel || null };
  });
  if (shot) { const f = path.join(repo, 'scratchpad', shot); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); console.log('SHOT', f); }
  await p.close(); return m;
};
try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const ws = await measure(`http://localhost:${port}/workspace/apps/chat`, w, h, process.env.SHOT && `plate-workspace-${w}.png`);
    const ch = await measure(`http://chat.localhost:${port}/`, w, h, process.env.SHOT && `plate-chat-host-${w}.png`);
    console.log(`  ${w}px workspace`, JSON.stringify(ws)); console.log(`  ${w}px chat host`, JSON.stringify(ch));
    ok(ch.radius === ws.radius && ch.radiusBL === ws.radiusBL && parseFloat(ch.radius) > 0, `${w}px: the chat plate's corners are the workspace's (${ch.radius} / ${ch.radiusBL} vs ${ws.radius})`);
    ok(ch.stroke === ws.stroke && ch.clip === ws.clip, `${w}px: and its stroke and clip (${ch.stroke}, ${ch.clip})`);
    ok(ch.top === ws.top && ch.right === ws.right && ch.bottom === ws.bottom, `${w}px: its gaps to the window top/right/bottom equal the workspace's (${ch.top}/${ch.right}/${ch.bottom} vs ${ws.top}/${ws.right}/${ws.bottom})`);
    if (ws.panelGap !== null && ch.panelGap !== null) ok(ch.panelGap === ws.panelGap && ch.panelTop === ch.top, `${w}px: sidebar plate → chat plate gap equals the workspace's (${ch.panelGap} vs ${ws.panelGap}), on one grid`);
    else console.log(`  ${w}px: sidebar not beside the plate here (workspace ${ws.panelState}, chat ${ch.panelState})`);
  }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'chat-host-plate: all passed'); process.exit(failed ? 1 : 0);
