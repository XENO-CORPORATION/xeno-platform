// chat-host-real-app-test — chat.xenosystem.ai with the REAL chat app in its frame, from the production build (dist/).
// chat-host-test uses a stand-in for the chat app, so it could not see what the owner saw on 2026-11-27: the real app took
// itself for a standalone page (its parent's path is `/`, not /workspace) and drew its whole old shell (the icon rail, the
// Personal panel, the old Ask XENO page) inside the chat host's sidebar. Served the way nginx serves the host: `/` and
// /c/<id> → workspace/chat.html, /chat/… → index.html, the API a stand-in. Measured at 1920 and 390 px wide.
//   npx vite build && node prototypes/xeno-workspace/tests/chat-host-real-app-test.mjs   (SHOT=1 saves screenshots)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), dist = path.join(repo, 'dist');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
if (!fs.existsSync(path.join(dist, 'workspace', 'chat.html'))) throw new Error('build first: npx vite build');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const USER = { id: 7, username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const file = (res, f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const json = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/auth/me' || u.pathname === '/api/auth/validate') return json({ success: true, valid: true, user: USER });
    if (u.pathname === '/api/auth/onboarding') return json({ success: true, done: true, welcomeAcknowledged: true });
    if (u.pathname === '/api/auth/activation-status') return json({ success: true, activated: true });
    if (u.pathname === '/api/chat/conversations') return json({ success: true, conversations: [], total: 0 });
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    if (u.pathname === '/api/models') return json({ success: true, models: [] });
    return json({ success: true });
  }
  if (u.pathname === '/env-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__ENV__={};'); }
  if (/^\/chat(\/|$)/.test(u.pathname)) return file(res, path.join(dist, 'index.html'));
  if (/^\/((c|projects|library|images)(\/[^.]*)?)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'chat.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const HOST = 'http://chat.localhost:' + server.address().port;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const p = await br.newPage(); await p.setViewport({ width: w, height: h });
    await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#xw-chat-frame', { timeout: 30000 });
    let m = null;
    for (let i = 0; i < 60; i++) {
      await settle(500);
      // the page may replace the frame while it opens: take it fresh each time
      const el = await p.$('#xw-chat-frame'); const fr = el && await el.contentFrame(); if (!fr) continue;
      m = await fr.evaluate(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const text = document.body ? document.body.innerText : '';
        return {
          embed: document.documentElement.classList.contains('xw-embed'),
          composer: !!document.querySelector('[data-chat-composer-shell], textarea'),
          // the old standalone shell's own words: its Personal panel (Workspace: Projects/Automations/Teams, Platform:
          // Notifications/Integrations/Products/Usage/Billing). "What would you like to explore?" is NOT one: it is the
          // chat's own empty state (ChatEmptyState.tsx), shown inside the workspace too.
          oldShell: ['Personal', 'Automations', 'Notifications', 'Integrations', 'Billing'].filter((t) => text.includes(t)),
          navs: [...document.querySelectorAll('nav, aside')].filter(visible).length,
        };
      }).catch(() => null);
      if (m && m.composer) break;
    }
    if (process.env.SHOT) { const f = path.join(repo, 'scratchpad', `chat-host-real-${w}.png`); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); console.log('SHOT', f); }
    ok(!!m && m.embed, `${w}px: the real chat app knows it sits in the chat host's page (xw-embed)`);
    ok(!!m && m.composer, `${w}px: and shows its composer`);
    ok(!!m && m.oldShell.length === 0, `${w}px: and none of the old shell (found: ${m ? m.oldShell.join(', ') || 'none' : '?'})`);
    ok(!!m && m.navs === 0, `${w}px: and no navigation of its own inside the frame (${m ? m.navs : '?'})`);
    await p.close();
  }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'chat-host-real-app: all passed'); process.exit(failed ? 1 : 0);
