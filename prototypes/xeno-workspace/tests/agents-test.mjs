// agents-test — the workspace's Agents pages are the person's REAL agents (platform-agents.js), against a stand-in
// /api/agents that keeps the server's rules. Proves: a first-run explainer, create, an address by id (never a
// name) that survives refresh, Back and a fresh tab, giving it projects, making a credential that is shown once with
// each CLI's setup filled in, revoking, edit keeping the id, delete, and that a gone agent and a failure say so.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5199, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0, fail = false;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const PROJ = [{ id: 'p-1111', name: 'Releases', canEdit: true }, { id: 'p-2222', name: 'Website', canEdit: true }];
const hex = () => [...Array(32)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const db = { agents: [], calls: [] };
const view = (a) => ({ webhook: null, ...a, projects: PROJ.filter((p) => a.pids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, access: 'editor' })), credentials: a.creds.filter((c) => !c.revoked).map(({ token, revoked, ...c }) => c) });

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
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/tasks/projects') return json(200, { success: true, projects: PROJ });
  if (u.pathname === '/api/mcp/services') return json(200, { success: true, services: [{ category: 'tasks', title: 'Tasks', description: 'Projects and tasks.', tools: 10 }] });
  if (u.pathname === '/api/agents' && method === 'GET') { if (fail) return json(500, { success: false }); return json(200, { success: true, agents: db.agents.map(view) }); }
  if (u.pathname === '/api/agents' && method === 'POST') {
    const a = { id: 'agt_' + hex(), userId: 'x', name: b.name, description: b.description || '', createdAt: new Date().toISOString(), status: 'active', pids: [], creds: [], connections: [] };
    db.agents.push(a); return json(201, { success: true, agent: view(a) });
  }
  const m = u.pathname.match(/^\/api\/agents\/(agt_[0-9a-f]{32})(\/.*)?$/);
  if (m) {
    const a = db.agents.find((x) => x.id === m[1]); if (!a) return json(404, { success: false, error: 'Agent not found', code: 'agent_not_found' });
    const rest = m[2] || '';
    if (!rest && method === 'GET') return json(200, { success: true, agent: view(a) });
    if (!rest && method === 'PATCH') { if (b.runtime !== undefined) { a.runtime = b.runtime; a.version = (a.version || 1) + 1; } if (b.name) a.name = b.name; if (b.description !== undefined) a.description = b.description; return json(200, { success: true, agent: view(a) }); }
    if (!rest && method === 'DELETE') { db.agents = db.agents.filter((x) => x !== a); return json(200, { success: true, id: a.id, deleted: true }); }
    if (rest === '/credentials' && method === 'POST') { const c = { id: 'c' + a.creds.length, token: 'xtk_abcdefabcdef_' + hex(), hint: 'xtk_abcdefabcdef_…', label: b.label, scopes: ['tasks:read', 'tasks:write'], expiresAt: new Date(Date.now() + b.ttlHours * 3600e3).toISOString(), lastUsedAt: null, createdAt: new Date().toISOString() }; a.creds.push(c); return json(201, { success: true, credential: { id: c.id, token: c.token, expiresAt: c.expiresAt, scopes: c.scopes } }); }
    const cr = rest.match(/^\/credentials\/(.+)$/); if (cr && method === 'DELETE') { const c = a.creds.find((x) => x.id === cr[1]); c.revoked = true; return json(200, { success: true, revoked: true }); }
    if (rest === '/webhook') { a.webhook = b.url || null; return json(200, { success: true, ...(b.url ? { url: b.url, secret: 'whsec_SIGNING' } : { removed: true }) }); }
    const pr = rest.match(/^\/projects\/(.+)$/);
    if (pr) { if (method === 'PUT') a.pids.push(pr[1]); else a.pids = a.pids.filter((x) => x !== pr[1]); return json(200, { success: true, agent: view(a) }); }
  }
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/workspace/search') return json(200, { success: true, results: [], counts: {} });
  if (u.pathname === '/api/workspace/needs') return json(200, { success: true, items: [] });
  return json(200, { success: true });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const fresh = async (url) => { await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await settle(1800); };
const fill = async (vals) => { await p.evaluate((v) => { const fs = [...document.querySelectorAll('.xd input, .xd textarea')]; fs.forEach((f, i) => { if (v[i] !== undefined) { f.value = v[i]; f.dispatchEvent(new Event('input', { bubbles: true })); } }); }, vals); };
const submit = async () => { await p.evaluate(() => (document.querySelector('.xd [data-xd-submit]') || document.querySelector('.xd [data-xd-ok]'))?.click()); await settle(1200); };

try {
  // first run
  await fresh('/workspace/workspace/Agents'); let t = await main();
  ok(/Give work to an agent that is really yours/.test(t) && /Run it anywhere/.test(t) && /Claude Code/.test(t), 'with no agents, the page explains what an agent is and the three steps');
  ok(!/Atlas|Kit|Juno|Echo|Scout/.test(t), 'no sample agents are shown on the platform');

  // create
  await p.click('[data-xag="new"]'); await settle(500);
  await fill(['Release Bot', 'Takes release tasks and reports back']); await submit();
  const a = db.agents[0];
  ok(a && a.name === 'Release Bot' && a.description === 'Takes release tasks and reports back', 'New agent creates it on the platform with its name and purpose');
  ok(new URL(p.url()).pathname === `/workspace/workspace/Agents/${a.id}`, `it opens at its id address (${new URL(p.url()).pathname})`);
  t = await main();
  ok(/Run Release Bot anywhere/.test(t) && /Works on/.test(t) && /Where it has run/.test(t) && /Credentials/.test(t), 'its page shows where it runs, what it works on, where it ran and its credentials');
  const crumb = await p.$eval('.crumbs', (e) => e.innerText).catch(() => '');
  ok(/Agents\s*\/\s*Release Bot/.test(crumb) && !crumb.includes(a.id), `the breadcrumb names it, never its id (${crumb.replace(/\s+/g, ' ')})`);

  // address: fresh tab, back/forward
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(/Run Release Bot anywhere/.test(await main()) && new URL(p.url()).pathname.endsWith(a.id), 'a fresh tab on the id address lands on the same agent, and the address keeps its id');
  await p.click('.crumbs a[data-crumb="Agents"]'); await settle();
  ok(/Release Bot/.test(await main()) && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'the trail goes back to the list');
  await p.goBack(); await settle();
  ok(/Run Release Bot anywhere/.test(await main()), 'Back returns to the agent');

  // projects
  await p.click('[data-xag-proj="p-1111"]'); await settle(900);
  ok(db.calls.some(([m, u, b]) => m === 'PUT' && u === `/api/agents/${a.id}/projects/p-1111` && b.access === 'editor') && a.pids.includes('p-1111'), 'ticking a project gives it to the agent on the platform');

  // credential: shown once, filled into each CLI's setup
  t = await main();
  ok(/Make a credential to fill this in/.test(t) && !/xtk_/.test(t), 'before a credential exists, the setup says to make one');
  await p.click('[data-xag="mint"]'); await settle(1000);
  const tok = a.creds[0].token; t = await main();
  ok(t.includes(tok) && /never shown again/.test(t), 'New credential shows the secret once, and says so');
  ok(t.includes(`claude mcp add --transport http xeno ${base}/api/mcp --header "Authorization: Bearer ${tok}"`), 'the Claude Code command is filled in with the credential');
  await p.click('[data-xag="tab"][data-k="codex"]'); await settle(300);
  ok((await main()).includes(`export XENO_AGENT_TOKEN=${tok}`) && /bearer-token-env-var XENO_AGENT_TOKEN/.test(await main()), 'Codex uses an environment variable, not the command line');
  await p.click('[data-xag="tab"][data-k="spawn"]'); await settle(300);
  ok((await main()).includes(`spawn profiles bind ${a.id}`) && /secure store/.test(await main()), 'Spawn binds a profile by the agent id');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(!(await main()).includes(tok) && /xtk_abcdefabcdef_…/.test(await main()), 'after leaving, the secret is never shown again — only its hint');

  // revoke
  await p.click('[data-xag="revoke"]'); await settle(400); await submit();
  ok(a.creds[0].revoked && /No live credential/.test(await main()), 'Revoke, after confirming, stops the credential');

  // webhook: where it hears about new work; the signing secret is shown once
  await p.click('[data-xag="webhook"]'); await settle(500); await fill(['https://agent.example.com/xeno']); await submit();
  let t2 = await main();
  ok(a.webhook === 'https://agent.example.com/xeno' && /whsec_SIGNING/.test(t2) && /never shown again/.test(t2), 'a webhook is saved and its signing secret shown once');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  t2 = await main();
  ok(/agent\.example\.com/.test(t2) && !/whsec_SIGNING/.test(t2), 'afterwards the address is listed and the secret is gone');

  // how it runs: model, reasoning, tools — saved as a new version
  ok(/Runs with/.test(await main()) && /CLI it runs in picks the model/.test(await main()), 'an agent with no runtime says the CLI chooses');
  await p.click('[data-xag="runtime"]'); await settle(500);
  await fill(['gpt-5.5', 'Read, Edit, XenoTaskComment', 'Bash']);
  await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="effort"] [data-v]')].find((x) => x.dataset.v === 'high')?.click()); await settle(200);
  await submit();
  const rt = db.calls.filter((c) => c[0] === 'PATCH' && c[2].runtime).pop();
  ok(rt && rt[2].runtime.model === 'gpt-5.5' && rt[2].runtime.effort === 'high' && rt[2].runtime.tools.allow.join() === 'Read,Edit,XenoTaskComment' && rt[2].runtime.tools.deny.join() === 'Bash', 'Set saves model, reasoning and allowed/blocked tools');
  const t3 = await main();
  ok(/gpt-5\.5/.test(t3) && /High/.test(t3) && /Never these tools/.test(t3) && /Saved as version/.test(await p.evaluate(() => document.body.innerText)), 'the page shows how it runs, and says it is a new version');
  await p.click('[data-xag="runtime"]'); await settle(500);
  ok(await p.evaluate(() => document.querySelector('.xd input')?.value === 'gpt-5.5'), 'Change opens with the current values');
  await fill(['', '', '']); await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="effort"] [data-v]')].find((x) => x.dataset.v === '')?.click()); await submit();
  ok(JSON.stringify(db.calls.filter((c) => c[0] === 'PATCH' && c[2].runtime).pop()[2].runtime) === '{}', 'clearing everything hands the choice back to the CLI');

  // edit keeps the id
  await p.click('[data-xag="edit"]'); await settle(500);
  await fill(['Ship Bot']); await submit();
  ok(a.name === 'Ship Bot' && new URL(p.url()).pathname.endsWith(a.id) && /Ship Bot/.test(await p.$eval('.crumbs', (e) => e.innerText)), 'renaming keeps its id address; the breadcrumb follows the new name');

  // delete, then the gone address
  await p.click('[data-xag="delete"]'); await settle(400); await submit();
  ok(!db.agents.length && new URL(p.url()).pathname === '/workspace/workspace/Agents', 'Delete, after confirming, removes it and returns to the list');
  await fresh(`/workspace/workspace/Agents/${a.id}`);
  ok(/This agent is gone/.test(await main()), 'an address to a deleted agent says it is gone, with a way back');
  await fresh('/workspace/workspace/Agents/Atlas');
  ok(/not valid/.test(await main()), 'an address by NAME is not a valid agent address');
  fail = true; await fresh('/workspace/workspace/Agents');
  ok(/could not be loaded/.test(await main()) && await p.$('[data-xag="retry"]'), 'a failed load says so and offers to try again'); fail = false;

  await p.setViewport({ width: 390, height: 844 }); await fresh('/workspace/workspace/Agents');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at phone width');

  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
