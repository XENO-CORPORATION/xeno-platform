// agent-remote-test — XENO Agent in the workspace: the remote page (the chats a person's PCs share) shown in a frame.
// The real page is another origin that holds the keys, so here a stand-in on its own port plays it: it says which view
// it shows, as the real one does. Proves the Agent area is that frame and not a placeholder, that the address follows the
// view the frame names and a fresh load lands back on it, that the workspace redrawing never reloads the frame, that
// only the frame's own origin and a view of the known shape are listened to, and that no sample sessions are shown.
// Decision: xeno-agent-interface docs/decisions/0006-remote-control-end-to-end.md, amendment of 2026-11-14.
import { createRequire } from 'node:module'; import http from 'node:http'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5217, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };

// the remote page, standing in: every address is the page, it tells its parent the view it shows, and it can be told to move
const loads = [];
const remote = http.createServer((q, s) => {
  loads.push(q.url);
  s.setHeader('content-type', 'text/html');
  s.end(`<!doctype html><body style="margin:0;background:#123;color:#fff;font:14px sans-serif"><p id="where"></p><script>
    const say = () => { document.getElementById('where').textContent = 'REMOTE ' + location.pathname; parent.postMessage({ type: 'xeno-remote:view', path: location.pathname, signedIn: true }, '*') };
    window.move = (to) => { history.pushState(null, '', to); say() };
    addEventListener('message', (e) => { if (e.data && e.data.testMove) window.move(e.data.testMove) });
    say();
  </script>`);
});
await new Promise((r) => remote.listen(0, '127.0.0.1', r));
const REMOTE = 'http://127.0.0.1:' + remote.address().port;

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument((origin) => { if (window.top === window) window.XENO_REMOTE_ORIGIN = origin; }, REMOTE);
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.origin !== base) return q.continue();
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1800); };
const where = () => new URL(p.url()).pathname;
const frameInfo = () => p.evaluate(() => {
  const f = document.getElementById('xw-agent-remote'), slot = document.querySelector('#main .xar-host[data-xar-frame]');
  if (!f) return null;
  const a = f.getBoundingClientRect(), b = slot ? slot.getBoundingClientRect() : null;
  return { src: f.getAttribute('src'), on: f.classList.contains('on'), shown: getComputedStyle(f).display !== 'none', over: !!b && Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2, width: a.width, height: a.height };
});
const inFrame = async () => { const f = p.frames().find((x) => x.url().startsWith(REMOTE)); return f ? f.evaluate(() => document.getElementById('where').textContent) : null; };
const tellFrame = (to) => p.evaluate((to, origin) => document.getElementById('xw-agent-remote').contentWindow.postMessage({ testMove: to }, origin), to, REMOTE);
const VIEW = '/pc/pc-1/c/chat-9';

try {
  await fresh('/workspace/dev/apps/agent');
  let f = await frameInfo();
  ok(f && f.src === REMOTE + '/' && f.on && f.shown, `the Agent area shows the remote page in a frame (${JSON.stringify(f)})`);
  ok(f && f.over && f.width > 600 && f.height > 300, 'the frame lies exactly over its place in the page');
  ok(await inFrame() === 'REMOTE /', 'and the page inside it is the remote page');
  const main = await p.$eval('#main', (e) => e.innerText).catch(() => '');
  ok(!/Open in Hub|opens here when it is part of the workspace/.test(main), 'the placeholder that sent people to the desktop app is gone');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(/Your PCs/.test(side) && /\/remote/.test(side) && !/Refactor auth gate|Fix flaky test|New session|Checkpoints/.test(side), 'the sidebar says how a chat gets here, with no sample sessions');

  // the frame opens a chat: the address follows, and nothing is reloaded
  const before = loads.length;
  await tellFrame(VIEW); await settle(900);
  ok(where() === '/workspace/dev/apps/agent' + VIEW, `the address follows the view the frame names (${where()})`);
  ok(loads.length === before && await inFrame() === 'REMOTE ' + VIEW, 'and the frame was not reloaded to do it');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Agent/.test(crumb) && /Chat/.test(crumb) && !/pc-1|chat-9/.test(crumb), `the breadcrumb says what kind of place it is, never an id (${crumb.replace(/\s+/g, ' ')})`);

  // the workspace redraws (the sidebar closes and opens): the same frame stays
  await p.evaluate(() => { window.XW.render(); window.XW.render(); }); await settle(500);
  f = await frameInfo();
  ok(loads.length === before && f.on && f.over, 'the workspace redrawing itself keeps the same frame, in place');

  // only the frame's own origin, and only a view of the known shape
  await p.evaluate(() => window.postMessage({ type: 'xeno-remote:view', path: '/pc/evil/c/other', signedIn: true }, '*')); await settle(400);
  ok(where() === '/workspace/dev/apps/agent' + VIEW, 'a message that is not from the frame changes nothing');
  await tellFrame('/settings/keys'); await settle(600);
  ok(where() === '/workspace/dev/apps/agent', `a view that is not one of ours is taken as the list, never put in the address (${where()})`);
  await tellFrame(VIEW); await settle(700);

  // a fresh tab on the chat's address lands on the chat
  await fresh('/workspace/dev/apps/agent' + VIEW);
  f = await frameInfo();
  ok(f && f.src === REMOTE + VIEW && await inFrame() === 'REMOTE ' + VIEW, 'a fresh load on a chat\'s address opens the frame on that chat');
  await fresh('/workspace/dev/apps/agent/pc/..%2F..%2Fevil');
  f = await frameInfo();
  ok(f && f.src === REMOTE + '/', `an address that is not a view opens the list, and is never passed to the frame (${f && f.src})`);

  // leaving and coming back
  await fresh('/workspace/dev/apps/agent' + VIEW);
  const loaded = loads.length;
  await p.evaluate(() => window.XW.go('product', { product: 'mcp' })); await settle(700);
  f = await frameInfo();
  ok(f && !f.shown, 'on another product the frame is out of sight');
  await p.goBack(); await settle(900);
  f = await frameInfo();
  ok(where() === '/workspace/dev/apps/agent' + VIEW && f.shown && f.over && loads.length === loaded, 'Back returns to the chat with the same frame, still connected');

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); remote.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
