// chat-host-test — the chat on its own host, chat.xenosystem.ai (owner, 2026-11-22: "a dedicated chat … full screen …
// its own thing, like the Gemini web app … AI quick and intuitive for everyone"). On chat.localhost, against a stand-in
// API and a stand-in for the platform's chat app (served at /chat/…, speaking the same embed messages as the real one).
// Proves: the page is the workspace's chat with only its scripts; the chat's own sidebar at the left edge, no rail; the
// host's addresses (/, /c/<id>, /projects/<pid>/c/<id>, /library, /images); and new chat → reply → in the history.
//   node prototypes/xeno-workspace/tests/chat-host-test.mjs        (SHOT=1 saves screenshots to scratchpad/)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import net from 'node:net'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace, PRODUCT_SCRIPTS } = await import('../../../scripts/vite-workspace.mjs');
const PORT = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const HOST = 'http://chat.localhost:' + PORT;
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const USER = { id: 7, username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const A = '00000001-0000-4000-8000-000000000000', C = '00000003-0000-4000-8000-000000000000', PJ = '0000000a-0000-4000-8000-000000000000';
const db = { convs: [{ id: A, title: 'Plan the launch week', updated_at: iso(1), last_message_at: iso(1), project_id: null }, { id: C, title: 'Budget questions', updated_at: iso(30), last_message_at: iso(30), project_id: PJ }], seq: 10, posts: [] };
// the stand-in chat app: reports where it is (as the real one does), and "send" starts a conversation through the API
const CHAT = `<!doctype html><html><body style="background:#222;color:#eee;font:14px sans-serif"><h2 id="where"></h2><div data-chat-composer-shell><textarea id="t"></textarea><button id="send">Send</button></div><div id="out"></div><script>
  const say = () => { document.getElementById('where').textContent = location.pathname; parent.postMessage({ source: 'xeno-chat', type: 'location', path: location.pathname, title: 'Chat' }, location.origin); };
  addEventListener('popstate', say); say();
  window.goTo = (p) => { history.pushState({}, '', p); say(); };
  document.getElementById('send').onclick = async () => {
    const r = await fetch('/api/chat/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('t').value }) });
    const j = await r.json(); document.getElementById('out').insertAdjacentHTML('beforeend', '<p class="reply">Reply: ' + j.conversation.title + '</p>');
    goTo('/chat/c/' + j.conversation.id);
  };
</script></body></html>`;

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true, allowedHosts: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const scripts = new Set(); p.on('request', (q) => { if (q.resourceType() === 'script' && q.frame() === p.mainFrame()) scripts.add(new URL(q.url()).pathname.split('/').pop()); });
await p.setRequestInterception(true);
const answer = (q) => {
  const u = new URL(q.url());
  if (!/(^|\.)localhost$|^127\.0\.0\.1$/.test(u.hostname)) return q.respond({ status: 204, body: '' });
  if (u.pathname === '/chat' || u.pathname.startsWith('/chat/')) return q.respond({ status: 200, contentType: 'text/html', body: CHAT });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
  if (u.pathname === '/api/chat/conversations' && q.method() === 'POST') { const b = JSON.parse(q.postData() || '{}'); const id = `000000${++db.seq}-0000-4000-8000-000000000000`.slice(-36).replace(/^0+/, (z) => z); const c = { id: `0000${String(db.seq).padStart(4, '0')}-0000-4000-8000-000000000000`, title: b.title || 'New chat', updated_at: iso(0), last_message_at: iso(0), project_id: null }; db.convs.unshift(c); db.posts.push(c.id); return json({ success: true, conversation: c }); }
  if (u.pathname === '/api/chat/conversations') return json({ success: true, conversations: db.convs, total: db.convs.length });
  { const m = u.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/); if (m) { const c = db.convs.find((x) => x.id === m[1]); return c ? json({ success: true, conversation: c, messages: [] }) : json({ success: false }, 404); } }
  if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [{ id: PJ, name: 'BUNKERVERSE', icon: null, updated_at: iso(5) }] });
  if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
  return json({ success: true });
};
p.on('request', answer);
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { if (!process.env.SHOT) return; const f = path.join(repo, 'scratchpad', 'chat-host-' + name + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); console.log('SHOT', f); };
try {
  await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#xw-chat-frame', { timeout: 20000 }); await settle(1500);
  await shot('home');
  const want = new Set(PRODUCT_SCRIPTS.chat);
  ok([...scripts].every((s) => want.has(s)) && scripts.size === want.size, `the chat host loads only the chat's ${want.size} scripts (loaded ${scripts.size})`);
  const at = () => p.evaluate(() => decodeURIComponent(location.pathname));
  const framePath = () => p.evaluate(() => { try { return document.getElementById('xw-chat-frame').contentWindow.location.pathname; } catch { return null; } });
  const rows = () => p.$$eval('#panel [data-chat-live]', (els) => els.map((e) => ({ id: e.dataset.chatLive, t: e.textContent.trim(), cur: e.getAttribute('aria-current') === 'true' })));
  // ── the window: the chat's own sidebar at the left edge carrying the product, the chat filling the rest, no rail
  const lay = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    const pr = document.getElementById('panel').getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect();
    return { product: document.documentElement.dataset.product, rail: vis('#rail'), panelLeft: Math.round(pr.left), mainFromPanel: m.left >= pr.right - 1 && m.left - pr.right < 20, mainRight: m.right === innerWidth,
      brand: document.querySelector('#panel .xch-brand b')?.textContent, crumb: !!document.querySelector('#panel .crumb'), bar: !!document.getElementById('xph'),
      acts: [...document.querySelectorAll('#panel .pbody > .act')].map((b) => b.textContent.replace(/Ctrl.*$|From chats/, '').trim()) };
  });
  ok(lay.product === 'chat' && !lay.rail && lay.panelLeft <= 8 && lay.mainFromPanel && lay.mainRight, `the chat's sidebar sits at the left edge and the chat fills the rest; no rail (${JSON.stringify(lay)})`);
  ok(lay.brand === 'Chat' && !lay.crumb && !lay.bar, 'the sidebar carries the product, not the workspace path; no bar on top');
  ok(['New chat', 'Library', 'Images', 'Scheduled'].every((x) => lay.acts.includes(x)), `New chat, Library, Images and Scheduled are in the sidebar (${lay.acts})`);
  ok(await framePath() === '/chat' && await at() === '/', 'the host opens on a new chat, at /');
  // ── addresses
  await p.click(`#panel [data-chat-live="${A}"]`); await settle(900);
  ok(await at() === `/c/${A}` && await framePath() === `/chat/c/${A}` && (await rows()).find((r) => r.id === A)?.cur, `a conversation is /c/<id> on the host, and the running chat moves to it (${await at()})`);
  await p.goto(HOST + `/c/${A}`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#xw-chat-frame', { timeout: 20000 }); await settle(1500);
  ok(await framePath() === `/chat/c/${A}` && await at() === `/c/${A}`, 'opened directly (a reload, a shared link), /c/<id> opens that conversation');
  await p.goto(HOST + `/projects/${PJ}/c/${C}`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#xw-chat-frame', { timeout: 20000 }); await settle(1500);
  ok(await framePath() === `/chat/projects/${PJ}/c/${C}` && await at() === `/projects/${PJ}/c/${C}`, 'a project\'s conversation is /projects/<pid>/c/<id>, parent in the path');
  // ── new chat → reply → in the history, and the address follows
  await p.click('#panel [data-newchat].act'); await settle(900);
  ok(await at() === '/' && await framePath() === '/chat', 'New chat opens a blank chat at /');
  const f = await (await p.$('#xw-chat-frame')).contentFrame();
  await f.type('#t', 'Draft the Bunkerverse roadmap'); await f.click('#send'); await settle(1500);
  const made = db.convs.find((c) => c.title === 'Draft the Bunkerverse roadmap');
  const reply = await f.$eval('.reply', (e) => e.textContent).catch(() => '');
  ok(made && /Draft the Bunkerverse roadmap/.test(reply), 'a message gets its reply in the chat');
  ok(await at() === `/c/${made?.id}` && (await rows()).some((r) => r.id === made?.id && /Draft the Bunkerverse roadmap/.test(r.t) && r.cur), 'the new conversation is in the history, current, and the address names it');
  // ── its places stay in the window
  await p.click('#panel [data-chat-images]'); await settle(900);
  ok(await at() === '/images', `Images opens on the host, at /images (${await at()})`);
  await p.goBack(); await settle(900);
  await p.click('#panel [data-go-library]'); await settle(900);
  ok(/^\/library/.test(await at()), `Library opens on the host (${await at()})`);
  await shot('flow');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} catch (e) { failed++; console.log('FAIL', e.message); }
// ── open time, the same way for both ways in (MEASURE=1): navigation → the chat ready (#xw-chat-frame.ready), cold and warm
if (process.env.MEASURE) {
  for (const url of [`http://127.0.0.1:${PORT}/workspace/apps/chat`, HOST + '/']) {
    const ctx = await br.createBrowserContext(), page = await ctx.newPage(); await page.setViewport({ width: 1400, height: 900 });
    await page.setRequestInterception(true); page.on('request', answer);
    const one = async () => { let n = 0, s = 0; const c = (q) => { if (q.frame() === page.mainFrame()) { n++; if (q.resourceType() === 'script') s++; } }; page.on('request', c);
      const t0 = Date.now(); await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#xw-chat-frame.ready', { timeout: 30000 }); const ms = Date.now() - t0; page.off('request', c); return { ms, requests: n, scripts: s }; };
    const cold = await one(), warm = await one();
    console.log('MEASURE', JSON.stringify({ url: url.replace(/:\d+/, ''), cold, warm }));
    await ctx.close();
  }
}
await br.close(); await server.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
