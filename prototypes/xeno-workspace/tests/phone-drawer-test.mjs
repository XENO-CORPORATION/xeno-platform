// phone-drawer-test — below 720 px the workspace's rail and sidebar are a modal drawer (owner, 2026-11-27: "fix it", on the
// chat plate left 45 px wide at 390 px with the sidebar open). Measured from the production build (dist/) on the workspace
// (/workspace/apps/chat) and on chat.xenosystem.ai, at 390 and 360 px: closed on load (the plate is the whole window, no
// rail on screen); open = the drawer above a scrim, the plate under it and inert; closed again by the scrim, Escape, Back and
// by choosing a place, with focus back on the menu button; the desktop's saved sidebar state never written from a phone.
//   npx vite build && node prototypes/xeno-workspace/tests/phone-drawer-test.mjs   (SHOT=1 saves captures)
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
  if (String(req.headers.host || '').startsWith('storage.') && /^\/[^.]*$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'storage.html'));
  if (!chatHost && /^\/workspace(\/[^.]*)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'index.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => {
  const q = (s) => document.querySelector(s), vis = (e) => { if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.right > 0 && r.width > 0; };
  const main = q('.main').getBoundingClientRect(), panel = q('#panel').getBoundingClientRect(), scrim = q('.xw-scrim');
  const atPanel = document.elementFromPoint(Math.round(panel.left + panel.width / 2), Math.round(panel.top + 120));
  const opener = [...document.querySelectorAll('#main .opener, #main .opener-float')].find((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden');
  return { panel: document.documentElement.dataset.panel, path: location.pathname, railOnScreen: vis(q('#rail')), mainW: Math.round(main.width), mainL: Math.round(main.left),
    scrim: !!scrim && getComputedStyle(scrim).visibility !== 'hidden' && parseFloat(getComputedStyle(scrim).opacity) > 0.9, panelOnTop: !!atPanel && !!atPanel.closest('#panel'),
    mainInert: q('#main').inert, focusInDrawer: !!document.activeElement?.closest('#panel, #rail'), focusOnOpener: !!opener && document.activeElement === opener,
    hasOpener: !!opener, saved: (() => { try { return Object.keys(localStorage).filter((k) => /(^|\.)panel$/.test(k)).map((k) => k + '=' + localStorage.getItem(k)).join(';'); } catch { return '?'; } })(),
    entry: document.documentElement.dataset.drawerEntry || null, hlen: history.length };
};
const openDrawer = async (p) => { await p.evaluate(() => [...document.querySelectorAll('#main .opener, #main .opener-float')].find((b) => b.getBoundingClientRect().width > 0)?.click()); await wait(450); return p.evaluate(state); };
try {
  for (const w of [390, 360]) {
    for (const [name, url, choose] of [
      ['workspace', `http://localhost:${port}/workspace/apps/chat`, '#panel [data-go-library]'],
      ['chat host', `http://chat.localhost:${port}/`, '#panel [data-go-library]'],
      // storage.: a place on the host's rail (HOST_RAILS) closes the drawer, as a place in its sidebar does
      ['storage host rail', `http://storage.localhost:${port}/`, '#rail [aria-label="Recent"]'],
      ['storage host sidebar', `http://storage.localhost:${port}/`, '#panel [data-item="Starred"]'],
    ]) {
      const p = await br.newPage(); await p.setViewport({ width: w, height: 844, isMobile: true, hasTouch: true });
      await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.main', { timeout: 30000 });
      await p.waitForFunction(() => !document.documentElement.classList.contains('xp-wait'), { timeout: 30000 }).catch(() => {}); await wait(2500);
      const tag = `${w}px ${name}`;
      const s0 = await p.evaluate(state);
      ok(s0.panel === 'closed' && !s0.railOnScreen && s0.mainW >= w - 14 && !s0.scrim && s0.hasOpener, `${tag}: closed on load, the plate is the window (${s0.mainW}px, left ${s0.mainL}), no rail on screen, a menu button`);
      if (process.env.SHOT) { await p.screenshot({ path: path.join(repo, 'scratchpad', `phone-${name.replace(' ', '-')}-${w}-closed.png`) }); }
      // open: the drawer over the scrim, the plate still full width under it, the page behind inert, focus in the drawer
      const s1 = await openDrawer(p);
      ok(s1.panel === 'open' && s1.railOnScreen && s1.scrim && s1.panelOnTop && s1.mainW >= w - 14 && s1.mainInert && s1.focusInDrawer, `${tag}: open, the drawer is above the scrim and the plate sits under it, inert (${JSON.stringify({ top: s1.panelOnTop, scrim: s1.scrim, inert: s1.mainInert, focus: s1.focusInDrawer })})`);
      if (process.env.SHOT) { await p.screenshot({ path: path.join(repo, 'scratchpad', `phone-${name.replace(' ', '-')}-${w}-open.png`) }); }
      // no keyboard hints in the drawer ("Ctrl ⇧ O"), while a kbd that is a label ("From chats") stays
      const kb = await p.evaluate(() => { const shown = (k) => k.getBoundingClientRect().width > 0 && getComputedStyle(k).display !== 'none'; const all = [...document.querySelectorAll('#panel kbd, #rail kbd')]; return { hints: all.filter((k) => k.hasAttribute('data-key-hint') && shown(k)).map((k) => k.textContent), labels: all.filter((k) => !k.hasAttribute('data-key-hint') && shown(k)).map((k) => k.textContent), tagged: all.filter((k) => k.hasAttribute('data-key-hint')).length }; });
      // the chat's drawer has hints and a label kbd ("From chats"); Storage's has no kbd at all, so only "none shown" applies there
      if (name.startsWith('storage')) ok(kb.hints.length === 0, `${tag}: no keyboard hints in the drawer (${kb.tagged} tagged, ${kb.hints.length} shown)`);
      else ok(kb.tagged > 0 && kb.hints.length === 0 && kb.labels.includes('From chats'), `${tag}: no keyboard hints in the drawer (${kb.tagged} tagged, ${kb.hints.length} shown), labels kept (${kb.labels.join(', ')})`);
      // closed by the scrim (tapped right of the drawer), focus back on the menu button, the history entry gone
      await p.mouse.click(w - 8, 420); await wait(450);
      const s2 = await p.evaluate(state);
      ok(s2.panel === 'closed' && !s2.scrim && !s2.mainInert && s2.focusOnOpener && s2.path === s0.path && !s2.entry, `${tag}: the scrim closes it, focus returns to the menu button, same page (${JSON.stringify({ panel: s2.panel, scrim: s2.scrim, inert: s2.mainInert, focus: s2.focusOnOpener, path: s2.path, entry: s2.entry })})`);
      // closed by Escape
      await openDrawer(p); await p.keyboard.press('Escape'); await wait(450);
      const s3 = await p.evaluate(state);
      ok(s3.panel === 'closed' && s3.path === s0.path, `${tag}: Escape closes it`);
      // closed by Back, which goes nowhere else
      await openDrawer(p); await p.evaluate(() => history.back()); await wait(600);
      const s4 = await p.evaluate(state);
      ok(s4.panel === 'closed' && s4.path === s0.path && !s4.entry, `${tag}: Back closes it and stays on the page (${s4.path})`);
      // choosing a place closes it
      await openDrawer(p); await p.evaluate((sel) => document.querySelector(sel)?.click(), choose); await wait(900);
      const s5 = await p.evaluate(state);
      ok(s5.panel === 'closed' && s5.path !== s0.path, `${tag}: choosing a place (${choose}) closes it (${s0.path} → ${s5.path})`);
      ok(s5.saved === s0.saved, `${tag}: the desktop's saved sidebar state is never written from a phone (${s0.saved || 'none'})`);
      await p.close();
    }
  }
  // the control: on a desktop with a mouse, the same hints stay
  { const p = await br.newPage(); await p.setViewport({ width: 1920, height: 1080 });
    await p.goto(`http://localhost:${port}/workspace/apps/chat`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#panel kbd', { timeout: 30000 }); await wait(1500);
    const shownHints = await p.evaluate(() => [...document.querySelectorAll('#panel kbd[data-key-hint]')].filter((k) => k.getBoundingClientRect().width > 0 && getComputedStyle(k).display !== 'none').map((k) => k.textContent));
    ok(shownHints.length > 0, `1920px with a mouse: the keyboard hints stay (${shownHints.join(', ')})`);
    await p.close(); }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'phone-drawer: all passed'); process.exit(failed ? 1 : 0);
