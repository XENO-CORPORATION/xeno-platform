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
const authorizeCalls = []; let signedOut = false;
const MACHINE = 'mch_' + 'a'.repeat(32); let cloudCalls = 0, cloudClosed = false, statusCalls = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };

// the remote page, standing in: every address is the page, it tells its parent the view it shows, and it can be told to move
const loads = [];
const remote = http.createServer((q, s) => {
  loads.push(q.url);
  s.setHeader('content-type', 'text/html');
  s.end(`<!doctype html><body style="margin:0;background:#123;color:#fff;font:14px sans-serif"><p id="where"></p><script>
    const say = () => { document.getElementById('where').textContent = 'REMOTE ' + location.pathname; parent.postMessage({ type: 'xeno-remote:view', path: location.pathname, signedIn: true }, '*') };
    window.move = (to) => { history.pushState(null, '', to); say() };
    window.got = [];
    addEventListener('message', (e) => { if (e.data && e.data.testMove) window.move(e.data.testMove); if (e.data && e.data.testAsk) parent.postMessage(e.data.testAsk, '*'); if (e.data && (e.data.type === 'xeno-remote:code' || e.data.type === 'xeno-remote:cloud-session' || e.data.type === 'xeno-remote:cloud-standing')) window.got.push(e.data) });
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
  if (u.pathname === '/api/compute/cloud-agent' && q.method() === 'GET') { statusCalls += 1; return cloudClosed ? json(200, { success: true, agent: { enabled: false } }) : json(200, { success: true, agent: { enabled: true, machineId: MACHINE, state: 'stopped', lastActiveAt: '2026-11-15T10:00:00.000Z' } }); }
  if (u.pathname === '/api/compute/cloud-agent' && q.method() === 'POST') { cloudCalls += 1; return cloudClosed ? json(403, { success: false, error: 'Cloud sessions are not open to your account yet', code: 'cloud_agent_not_enabled' }) : json(200, { success: true, agent: { machineId: MACHINE, workspaceId: 'w1', name: 'Cloud', connect: { path: `/api/compute/machines/${MACHINE}/ports/agent/`, protocols: ['xeno-port.v1', 'xeno-ticket.' + 'T'.repeat(43)], expiresAt: 'x' } } }); }
  if (u.pathname === '/api/oauth2/authorize' && q.method() === 'POST') { let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch {} authorizeCalls.push(b); return signedOut ? json(401, { error: 'unauthorized' }) : json(200, { code: 'CODE-' + b.state, redirect: 'x' }); }
  if (u.pathname === '/api/account/remote-pcs' && q.method() === 'GET') return json(200, { pcs: [{ id: 'row-1', installationId: 'pc-1', name: 'bnkr' }] });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1800); };
const where = () => new URL(p.url()).pathname;
const frameInfo = () => p.evaluate(() => {
  const f = document.getElementById('xw-agent-remote'), sf = document.getElementById('xw-agent-remote-side'), slot = document.querySelector('#main .xar-host[data-xar-frame]');
  if (!f) return null;
  const near = (x, y) => Math.abs(x - y) < 2;
  const a = f.getBoundingClientRect(), m = slot ? slot.getBoundingClientRect() : null;
  const panel = document.getElementById('panel').getBoundingClientRect(), body = document.querySelector('#panel .pbody')?.getBoundingClientRect(), head = document.querySelector('#panel .ph')?.getBoundingClientRect();
  const b = sf ? sf.getBoundingClientRect() : null;
  return { src: f.getAttribute('src'), on: f.classList.contains('on'), shown: getComputedStyle(f).display !== 'none', hasSlot: !!slot,
    // the conversation lies exactly over the main area's slot, under the breadcrumb
    over: !!m && near(a.left, m.left) && near(a.top, m.top) && near(a.width, m.width) && near(a.height, m.height),
    width: Math.round(a.width), height: Math.round(a.height),
    side: sf ? { src: sf.getAttribute('src'), name: sf.name, shown: getComputedStyle(sf).display !== 'none',
      // the sidebar's place lies over the left panel's body, edge to edge, under the panel's own header
      over: !!body && near(b.left, panel.left) && near(b.width, panel.width) && near(b.top, body.top) && near(b.bottom, panel.bottom),
      headClear: !!head && b.top >= head.bottom - 1, width: Math.round(b.width), height: Math.round(b.height),
      // drawn on top of the panel, where a person sees and clicks it (the panel sits at z-index 20)
      onTop: b.width > 0 && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === sf } : null };
});
const mainFrame = () => p.frames().find((x) => x.url().startsWith(REMOTE) && !x.url().startsWith(REMOTE + '/side'));
const inFrame = async () => { const f = mainFrame(); return f ? f.evaluate(() => document.getElementById('where').textContent) : null; };
const tellFrame = (to) => p.evaluate((to, origin) => document.getElementById('xw-agent-remote').contentWindow.postMessage({ testMove: to }, origin), to, REMOTE);
const VIEW = '/pc/pc-1/c/chat-9';

try {
  await fresh('/workspace/dev/apps/agent');
  let f = await frameInfo();
  ok(f && f.src === REMOTE + '/' && f.on && f.shown, `the Agent area shows the remote page in a frame (${JSON.stringify(f)})`);
  ok(f && f.over && f.width > 600 && f.height > 300, `the conversation lies exactly over the main area, under its breadcrumb (${JSON.stringify(f)})`);
  ok(f && f.side && f.side.src === REMOTE + '/side' && f.side.name === 'xeno-agent-side' && f.side.shown && f.side.over && f.side.headClear && f.side.onTop && f.side.width > 200, `the agent's sidebar has its own place over the left panel's body, under the header that panel already has (${JSON.stringify(f && f.side)})`);
  ok(await p.$eval('#panel .ph [data-back]', (e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === e || e.contains(top); }), 'the header the panel already has stays above it, and its Back can be clicked');
  ok(await inFrame() === 'REMOTE /', 'and the page inside it is the remote page');
  const main = await p.$eval('#main', (e) => e.innerText).catch(() => '');
  ok(!/Open in Hub|opens here when it is part of the workspace/.test(main), 'the placeholder that sent people to the desktop app is gone');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(!/Refactor auth gate|Fix flaky test|New session|Checkpoints|Where it runs/.test(side) && await p.$eval('#panel', (e) => !e.hasAttribute('inert') && e.querySelector('.pbody').hasAttribute('inert') && e.querySelectorAll('.pbody button, .pbody a, .pbody input').length === 0), `the panel's body under the frame is empty and cannot be tabbed into (${JSON.stringify(side.slice(0, 60))})`);

  // the panel folded away: the sidebar's place goes (the agent page then draws its sidebar beside the conversation), and comes back
  await p.evaluate(() => { const b = document.querySelector('[data-collapse]'); if (b) b.click(); }); await settle(900);
  f = await frameInfo();
  const folded = f && f.side && f.side.width === 0 && f.on && f.over;
  ok(folded, `with the left panel folded the sidebar's place has no width and the conversation still lies over the main area (${JSON.stringify(f && { side: f.side, over: f.over })})`);
  await p.evaluate(() => { const b = [...document.querySelectorAll('[data-expand]')].find((x) => x.offsetParent !== null); if (b) b.click(); }); await settle(900);
  f = await frameInfo();
  ok(f && f.side && f.side.shown && f.side.over, `opened again, the sidebar's place is back over the panel (${JSON.stringify(f && f.side)})`);

  // the frame opens a chat: the address follows, and nothing is reloaded
  const before = loads.length;
  await tellFrame(VIEW); await settle(900);
  ok(where() === '/workspace/dev/apps/agent' + VIEW, `the address follows the view the frame names (${where()})`);
  ok(loads.length === before && await inFrame() === 'REMOTE ' + VIEW, 'and the frame was not reloaded to do it');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Agent/.test(crumb) && /Chat/.test(crumb) && !/pc-1|chat-9/.test(crumb), `the breadcrumb says what kind of place it is, never an id (${crumb.replace(/\s+/g, ' ')})`);
  ok(/bnkr/.test(crumb) && !/A PC/.test(crumb), `and it names the PC by the name the server holds for it (${crumb.replace(/\s+/g, ' ')})`);

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
  ok(await p.$eval('#panel', (e) => !e.querySelector('[inert]')), 'and the workspace panel is its own again');
  await p.goBack(); await settle(900);
  f = await frameInfo();
  ok(where() === '/workspace/dev/apps/agent' + VIEW && f.shown && f.over && loads.length === loaded, `Back returns to the chat with the same frame, still connected (${JSON.stringify(f)} ${where()} ${loads.length}/${loaded})`);

  // the frame asks for its sign-in code: the workspace gets it one, for the frame's own request and nothing wider
  const frameGot = async () => { const f = mainFrame(); return f.evaluate(() => window.got.splice(0)); };
  const ask = (m) => p.evaluate((m, origin) => document.getElementById('xw-agent-remote').contentWindow.postMessage({ testAsk: m }, origin), m, REMOTE);
  const good = { type: 'xeno-remote:authorize', clientId: 'xeno-remote-web', redirectUri: REMOTE + '/callback', scope: 'openid profile remote:connect', state: 'S'.repeat(32), nonce: 'N'.repeat(32), codeChallenge: 'C'.repeat(43) };
  await fresh('/workspace/dev/apps/agent'); authorizeCalls.length = 0; await frameGot();
  await ask(good); await settle(900);
  let got = await frameGot();
  ok(authorizeCalls.length === 1 && authorizeCalls[0].client_id === 'xeno-remote-web' && authorizeCalls[0].redirect_uri === REMOTE + '/callback' && authorizeCalls[0].scope === 'openid profile remote:connect' && authorizeCalls[0].code_challenge === good.codeChallenge && authorizeCalls[0].code_challenge_method === 'S256', 'asked by the frame, the workspace asks the sign-in server for a code for the request the frame itself made');
  ok(got.length === 1 && got[0].code === 'CODE-' + good.state && got[0].state === good.state, 'and hands the code to the frame');
  authorizeCalls.length = 0;
  for (const bad of [{ ...good, scope: 'openid profile inference:use' }, { ...good, clientId: 'xeno-agent-desktop' }, { ...good, redirectUri: 'https://evil.example/callback' }, { ...good, codeChallenge: 'x' }]) { await ask(bad); await settle(300); }
  got = await frameGot();
  ok(authorizeCalls.length === 0 && got.length === 4 && got.every((m) => m.code === null), `a request for another app, another address, more rights or a malformed challenge gets no code and reaches no server (${authorizeCalls.length} calls)`);
  await p.evaluate((m) => window.postMessage(m, '*'), good); await settle(400);
  ok(authorizeCalls.length === 0, 'a request that is not from the frame is not answered');
  signedOut = true; await ask(good); await settle(700); got = await frameGot(); signedOut = false;
  ok(got.length === 1 && got[0].code === null, 'signed out of the workspace, the frame is told there is no code, so it offers its own sign-in');

  // the frame asks for a cloud session: the workspace starts the person's machine and hands over a one-use ticket
  const cstate = 'c'.repeat(36);
  cloudCalls = 0; await ask({ type: 'xeno-remote:cloud', state: cstate }); await settle(900); got = await frameGot();
  ok(cloudCalls === 1 && got.length === 1 && got[0].state === cstate && got[0].session && got[0].session.machineId === MACHINE && got[0].session.path === `/api/compute/machines/${MACHINE}/ports/agent/` && got[0].session.protocols.length === 2 && Object.keys(got[0].session).sort().join() === 'machineId,path,protocols', 'asked by the frame, the workspace opens the cloud session and hands over the ticket and nothing else');
  cloudClosed = true; await ask({ type: 'xeno-remote:cloud', state: cstate }); await settle(700); got = await frameGot(); cloudClosed = false;
  ok(got.length === 1 && got[0].session === null && /not open to your account/.test(got[0].error), 'a refusal reaches the frame in the platform’s own words');
  cloudCalls = 0; await p.evaluate((m) => window.postMessage(m, '*'), { type: 'xeno-remote:cloud', state: cstate }); await ask({ type: 'xeno-remote:cloud', state: 'not-a-state' }); await settle(500);
  ok(cloudCalls === 0, 'a cloud request that is not from the frame, or has no proper state, starts nothing');
  // the frame asks how the machine stands: it is told, and nothing is started
  cloudCalls = 0; statusCalls = 0; await ask({ type: 'xeno-remote:cloud-status', state: cstate }); await settle(700); got = await frameGot();
  ok(statusCalls === 1 && cloudCalls === 0 && got.length === 1 && got[0].type === 'xeno-remote:cloud-standing' && got[0].state === cstate && got[0].status.enabled === true && got[0].status.machineId === MACHINE && got[0].status.state === 'stopped' && got[0].status.lastActiveAt === '2026-11-15T10:00:00.000Z', `asked how the machine stands, the frame is told and no machine is started (${JSON.stringify(got).slice(0, 200)})`);
  cloudClosed = true; await ask({ type: 'xeno-remote:cloud-status', state: cstate }); await settle(600); got = await frameGot(); cloudClosed = false;
  ok(got.length === 1 && got[0].status.enabled === false && !got[0].status.machineId, 'an account Cloud is not open to is told so');
  statusCalls = 0; await p.evaluate((m) => window.postMessage(m, '*'), { type: 'xeno-remote:cloud-status', state: cstate }); await ask({ type: 'xeno-remote:cloud-status', state: 'nope' }); await settle(400);
  ok(statusCalls === 0, 'a standing request that is not from the frame, or has no proper state, asks nothing');
  await tellFrame('/cloud/c/chat-7'); await settle(800);
  ok(where() === '/workspace/dev/apps/agent/cloud/c/chat-7', `a cloud chat has its own workspace address (${where()})`);
  const cloudCrumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Cloud/.test(cloudCrumb) && !/chat-7/.test(cloudCrumb), `and the breadcrumb says Cloud, never an id (${cloudCrumb.replace(/\s+/g, ' ')})`);
  await tellFrame('/pcs'); await settle(600);
  ok(where() === '/workspace/dev/apps/agent/pcs', 'the list of PCs has its own address too');

  // the panel's Agents and Teams rows open the workspace's own screens (owner, 15 Nov 2026: "built based on the design of
  // the XENO platform"); only those two fixed names, only from the agent's own frame
  await fresh('/workspace/dev/apps/agent');
  await p.evaluate((m) => window.postMessage(m, '*'), { type: 'xeno-remote:open-platform', screen: 'agents' }); await settle(400);
  ok(where() === '/workspace/dev/apps/agent', `a request that is not from the frame opens nothing (${where()})`);
  await ask({ type: 'xeno-remote:open-platform', screen: '../settings' }); await ask({ type: 'xeno-remote:open-platform', screen: 'Members' }); await settle(500);
  ok(where() === '/workspace/dev/apps/agent', `a name that is not Agents or Teams opens nothing (${where()})`);
  await ask({ type: 'xeno-remote:open-platform', screen: 'agents' }); await settle(800);
  ok(/^\/workspace\/(?:[a-z]+\/)?workspace\/Agents$/.test(where()), `Agents opens the workspace's own Agents screen (${where()})`);
  await fresh('/workspace/dev/apps/agent'); await ask({ type: 'xeno-remote:open-platform', screen: 'teams' }); await settle(800);
  ok(/^\/workspace\/(?:[a-z]+\/)?workspace\/Teams$/.test(where()), `Teams opens the workspace's own Teams screen (${where()})`);

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); remote.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
