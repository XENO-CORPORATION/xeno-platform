// mcp-test — XENO MCP in the Dev area against a stand-in /api/mcp that keeps the server's rules.
// Proves the page is a real product with real addresses (the list, one connection by id, the activity log), that each
// view survives a fresh load at its own address, that turning a service off and disconnecting reach the platform,
// that the connect panel shows the one address with each client's setup, and that failure and a missing
// connection say so. Spec: XENO AGENT SURFACES & CONNECTORS - SPEC.md §7.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5198, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0, fail = false;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const CLAUDE = '11111111-1111-4111-8111-111111111111', CURSOR = '22222222-2222-4222-8222-222222222222';
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const db = {
  calls: [],
  services: [{ category: 'tasks', title: 'Tasks', description: 'Projects and tasks.', tools: 10 }],
  conns: [
    { id: CLAUDE, client: { id: 'mcp_a', name: 'Claude Code' }, agentId: 'a1', categories: ['tasks'], createdAt: ago(600), lastUsedAt: ago(3), calls: 2, revokedAt: null },
    { id: CURSOR, client: { id: 'mcp_b', name: 'Cursor' }, agentId: 'a2', categories: ['tasks'], createdAt: ago(900), lastUsedAt: null, calls: 0, revokedAt: null },
  ],
  log: [
    { id: '1', connectionId: CLAUDE, client: 'Claude Code', tool: 'tasks_list_my_tasks', category: 'tasks', at: ago(3), latencyMs: 41, outcome: 'ok', errorCode: null },
    { id: '2', connectionId: CLAUDE, client: 'Claude Code', tool: 'tasks_create_task', category: 'tasks', at: ago(5), latencyMs: 12, outcome: 'refused', errorCode: 'category_disabled' },
  ],
};

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname + u.search, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/mcp/services') return json(200, { success: true, services: db.services });
  if (u.pathname === '/api/mcp/connections' && method === 'GET') { if (fail) return json(500, { success: false }); return json(200, { success: true, connections: db.conns.filter((c) => !c.revokedAt) }); }
  const cm = u.pathname.match(/^\/api\/mcp\/connections\/([0-9a-f-]{36})$/);
  if (cm) {
    const c = db.conns.find((x) => x.id === cm[1] && !x.revokedAt); if (!c) return json(404, { success: false, error: 'Connection not found', code: 'connection_not_found' });
    if (method === 'GET') return json(200, { success: true, connection: c });
    if (method === 'PATCH') { c.categories = b.categories; return json(200, { success: true, connection: c }); }
    if (method === 'DELETE') { c.revokedAt = new Date().toISOString(); return json(200, { success: true, id: c.id, disconnected: true }); }
  }
  if (u.pathname === '/api/mcp/activity') { const id = u.searchParams.get('connection'); return json(200, { success: true, calls: db.log.filter((k) => !id || k.connectionId === id) }); }
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1800); };

try {
  // the list, at its own address
  await fresh('/workspace/dev/apps/mcp'); let t = await main();
  ok(/Connect an agent/.test(t) && /Claude Code/.test(t) && /Cursor/.test(t), 'XENO MCP opens in Dev at /workspace/dev/apps/mcp with the connected agents');
  ok(/\/api\/mcp/.test(t) && /xeno mcp add xeno --http/.test(t) && /claude mcp add --transport http xeno/.test(t) && /codex mcp login xeno/.test(t), 'the connect panel shows the one address and each client\'s own setup');
  ok(/Tasks/.test(t) && /2 calls/.test(t), 'each row says what it can use and how much it has been used');
  const side = await p.$eval('#panel', (e) => e.innerText).catch(() => '');
  ok(/Connections/.test(side) && /Activity/.test(side) && /Claude Code/.test(side) && !/New mcp|No MCP work yet/.test(side), 'the sidebar lists the views and the connected agents, not a generic "New mcp"');
  await p.click(`#panel [data-item="c/${CURSOR}"]`); await settle();
  ok(new URL(p.url()).pathname === `/workspace/dev/apps/mcp/c/${CURSOR}` && /Cursor/.test(await main()), 'an agent in the sidebar opens that connection');
  const current = await p.$$eval('#panel [data-item][aria-current="true"]', (rs) => rs.map((r) => r.dataset.item));
  ok(current.length === 1 && current[0] === `c/${CURSOR}`, `the sidebar marks exactly that agent as current (${JSON.stringify(current)})`);
  await p.goBack(); await settle();

  // one connection, by id
  await p.click(`[data-xmc="open"][data-id="${CLAUDE}"]`); await settle();
  ok(new URL(p.url()).pathname === `/workspace/dev/apps/mcp/c/${CLAUDE}`, 'opening a connection puts its id in the address');
  t = await main();
  ok(/Disconnect/.test(t) && /What it can use/i.test(t) && /tasks_list_my_tasks/.test(t), 'the connection shows its services, its recent calls and Disconnect');
  ok(/sees 10 tools/.test(t), 'it says how many tools the agent sees');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Dev\s*\/\s*MCP\s*\/\s*Claude Code/.test(crumb) && !crumb.includes(CLAUDE), `the breadcrumb names the connection, never its id (${crumb.replace(/\s+/g, ' ')})`);
  await fresh(`/workspace/dev/apps/mcp/c/${CLAUDE}`);
  ok(/Claude Code/.test(await main()) && /What it can use/i.test(await main()), 'a fresh tab on that address lands on the same connection');
  await p.goBack(); await settle(); await p.goForward(); await settle();
  ok(/What it can use/i.test(await main()), 'Back and Forward keep it');

  // turn a service off — the platform is told
  db.calls.length = 0;
  await p.click('[data-xmc-cat="tasks"]'); await settle(900);
  const patch = db.calls.find(([m, u]) => m === 'PATCH' && u === `/api/mcp/connections/${CLAUDE}`);
  ok(patch && Array.isArray(patch[2].categories) && patch[2].categories.length === 0, 'turning Tasks off tells the platform');
  ok(/sees 0 tools/.test(await main()), 'and the count follows');

  // the activity log, at its own address
  await fresh('/workspace/dev/apps/mcp/activity'); t = await main();
  ok(/tasks_create_task/.test(t) && /Refused/.test(t) && /category_disabled/.test(t) && /never stored/.test(t), 'the activity log lists every call with its result, and says what is never kept');

  // disconnect
  await fresh(`/workspace/dev/apps/mcp/c/${CURSOR}`);
  await p.click('[data-xmc="disconnect"]'); await settle(500);
  await p.evaluate(() => document.querySelector('.xd [data-xd-ok]')?.click()); await settle(1200);
  ok(db.conns.find((c) => c.id === CURSOR).revokedAt && new URL(p.url()).pathname === '/workspace/dev/apps/mcp', 'Disconnect, after confirming, tells the platform and returns to the list');
  ok(!(await p.$(`[data-xmc="open"][data-id="${CURSOR}"]`)) && !!(await p.$(`[data-xmc="open"][data-id="${CLAUDE}"]`)), 'the disconnected agent leaves the list, and the other stays');

  // a connection that is gone, and a failure
  await fresh(`/workspace/dev/apps/mcp/c/${CURSOR}`);
  ok(/This connection is gone/.test(await main()), 'an address to a disconnected connection says it is gone, with a way back');
  fail = true; await fresh('/workspace/dev/apps/mcp');
  ok(/could not be loaded/.test(await main()) && await p.$('[data-xmc="retry"]'), 'a failed load says so and offers to try again'); fail = false;

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
