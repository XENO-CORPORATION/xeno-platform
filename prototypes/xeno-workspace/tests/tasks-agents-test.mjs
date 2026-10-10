// tasks-agents-test — agents on XENO Tasks, in the workspace, against a stand-in /api/tasks.
// Proves: the Agent field delegates (the assignee stays), the session card shows what the agent is doing and turns
// into "Waiting for you" when it asks, its reports render in the activity, the delegate's face is on the card, the
// Agents view creates an agent, mints a credential shown once with an MCP config, revokes it and sets a signed webhook,
// "Copy for agent" hands the task off and puts a one-task credential in the brief, "Copy brief only" does not, and a
// refused call says why.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const PORT = 5198, base = 'http://127.0.0.1:' + PORT;
const USER = { id: 'u1', username: 'me', email: 'me@x.test', display_name: 'Me', avatar_url: null, email_verified: true };
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const now = () => new Date().toISOString();
const ME = { id: 'u1', kind: 'human', name: 'Me' };
const BUILDER = { id: 'a1', name: 'Builder', username: 'builder', kind: 'agent' };
const PEOPLE = [{ ...ME, username: 'me', me: true }, { id: 'u2', name: 'Codrin', username: 'codrin', kind: 'human' }, BUILDER];
const db = { calls: [], agents: [{ id: 'a1', username: 'builder', name: 'Builder', role: 'worker', origin: 'tasks', webhook: null, openTasks: 1, tokens: [] }], tokSeq: 0, refuseDelegate: false,
  tasks: [{ key: 'T-1', number: 1, title: 'Fix the signup copy', body: 'Make it shorter.', kind: 'task', priority: 'high', status: 'todo', area: 'studio', project: null, assignee: ME, reviewer: null, reviewRequired: false, reporter: ME, labels: [], dueAt: null, delegate: null, session: null, watching: true, createdAt: now(), updatedAt: now(), events: [{ id: 'e0', kind: 'created', actor: ME, at: now() }] }] };
const view = (t) => ({ attachments: [], children: [], links: [], watchers: [], canLink: true, subtasks: { total: 0, done: 0 }, parent: null, ...t, can: { edit: true, attach: true, delete: true, moves: ['in_progress'] } });

const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => {
  const u = new URL(q.url());
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  db.calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  const T1 = db.tasks[0];
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/tasks/views') return json(200, { success: true, views: [] });
  if (u.pathname === '/api/tasks' && method === 'GET') return json(200, { success: true, tasks: db.tasks.map(view) });
  if (u.pathname === '/api/tasks/assignees') return json(200, { success: true, assignees: PEOPLE });
  if (u.pathname === '/api/tasks/agents' && method === 'GET') return json(200, { success: true, agents: db.agents });
  if (u.pathname === '/api/tasks/agents' && method === 'POST') { const a = { id: 'a' + (db.agents.length + 1), username: 'release-bot', name: b.name, role: 'worker', origin: 'tasks', webhook: null, openTasks: 0, tokens: [] }; db.agents.push(a); return json(201, { success: true, agent: a }); }
  if (u.pathname === '/api/tasks/agents/tokens' && method === 'POST') {
    const a = db.agents.find((x) => x.id === b.agentId), id = 'k' + ++db.tokSeq, token = `xtk_abcdefabcdef_SECRET${db.tokSeq}`;
    a.tokens.push({ id, hint: 'xtk_abcdefabcdef_…', scopes: b.scopes, label: b.label, expiresAt: now(), lastUsedAt: null, createdAt: now(), task: null });
    return json(201, { success: true, id, token, scopes: b.scopes, expiresAt: now(), agent: { id: a.id, name: a.name } });
  }
  const tk = u.pathname.match(/^\/api\/tasks\/agents\/tokens\/(\w+)$/);
  if (tk && method === 'DELETE') { for (const a of db.agents) a.tokens = a.tokens.filter((x) => x.id !== tk[1]); return json(200, { success: true, revoked: true }); }
  if (u.pathname === '/api/tasks/agents/webhook') { const a = db.agents.find((x) => x.id === b.agentId); a.webhook = b.url || null; return json(200, { success: true, ...(b.url ? { url: b.url, secret: 'whsec_SIGNING' } : { removed: true }) }); }
  if (u.pathname === '/api/tasks/T-1' && method === 'GET') return json(200, { success: true, task: view(T1) });
  if (u.pathname === '/api/tasks/T-1/delegate') {
    if (db.refuseDelegate) return json(403, { success: false, error: 'Only someone who manages the project can delegate this task', code: 'not_allowed' });
    const to = b.agentId ? BUILDER : null;
    T1.events.push({ id: 'e' + T1.events.length, kind: 'delegated', actor: ME, at: now(), from: T1.delegate && T1.delegate.id, to: b.agentId, toName: to && to.name, fromName: T1.delegate && T1.delegate.name });
    T1.delegate = to; T1.session = to ? { state: 'pending', note: 'Delegated', updatedAt: now() } : null; T1.updatedAt = now();
    return json(200, { success: true, task: view(T1) });
  }
  if (u.pathname === '/api/tasks/T-1/handoff') {
    T1.delegate = { id: 'h1', name: 'Me’s agent', kind: 'agent' }; T1.session = { state: 'pending', note: 'Handed off. Waiting for the agent to connect.', updatedAt: now() };
    return json(201, { success: true, token: 'xtk_handoffhand_ONETASK', expiresAt: now(), agent: { id: 'h1', name: 'Me’s agent' }, task: view(T1) });
  }
  return json(404, { success: false, error: 'Not found' });
});
const main = () => p.$eval('#main', (e) => e.innerText).catch(() => '');
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const nav = async (hash) => { await p.evaluate((h) => (location.hash = h), hash); await settle(); };
const pickClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.tk-pick:not([hidden]) .tk-pick-i')].find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
const menuClick = (re) => p.evaluate((src) => { const rx = new RegExp(src); const b = [...document.querySelectorAll('.xcm .xcm-i')].reverse().find((x) => rx.test(x.textContent.trim())); if (b) b.click(); return !!b; }, re.source);
const T1 = () => db.tasks[0];
const poll = async () => { await p.evaluate(() => window.XENO_TASKS.poll()); await settle(); };
try {
  await p.goto(base + '/workspace/#/studio/g/tasks/T-1', { waitUntil: 'domcontentloaded' }); await settle(1800);
  await p.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async (s) => { window.__clip = s; }; });
  ok(/Agent\s*None/.test(await main()) && !(await p.$('[data-tk-session]')), 'the task page has an Agent field, empty, and no session card');

  // delegate from the Agent field
  await p.click('[data-tk-prop="delegate"]'); await p.waitForSelector('.tk-pick:not([hidden])', { timeout: 3000 });
  const opts = await p.$$eval('.tk-pick:not([hidden]) .tk-pick-i', (els) => els.map((e) => e.textContent.trim()));
  ok(opts.some((x) => /^Builder/.test(x)) && !opts.some((x) => /^Codrin/.test(x)), 'the Agent picker lists agents only (' + opts.join(' | ') + ')');
  await pickClick(/^Builder/); await settle();
  ok(T1().delegate?.id === 'a1' && T1().assignee?.id === 'u1', 'picking an agent delegates the task and the assignee stays');
  ok(!!(await p.$('[data-tk-session="pending"]')) && /Builder[\s\S]*Waiting to start/.test(await p.$eval('[data-tk-session]', (e) => e.innerText)), 'a session card shows the agent and that it has not started');
  ok(/handed it to Builder/.test(await main()), 'the hand-off is in the activity');

  // the agent works: its reports render, its question turns the card into "Waiting for you"
  T1().events.push({ id: 'r1', kind: 'activity', from: 'action', note: 'Running the copy linter', actor: BUILDER, at: now() });
  T1().events.push({ id: 'r2', kind: 'activity', from: 'ask', note: 'Should the CTA say **Start** or **Begin**?', actor: BUILDER, at: now() });
  T1().session = { state: 'awaiting_input', note: 'Should the CTA say Start or Begin?', updatedAt: now() }; T1().updatedAt = new Date(Date.now() + 5000).toISOString();
  await poll();
  ok(!!(await p.$('[data-tk-activity="action"]')) && !!(await p.$('[data-tk-activity="ask"] .tk-md b, [data-tk-activity="ask"] .tk-md strong')), 'the agent’s reports appear in the activity, with markdown');
  ok(!!(await p.$('[data-tk-session="awaiting_input"]')) && /Waiting for you/.test(await p.$eval('[data-tk-session]', (e) => e.innerText)), 'an ask turns the session card into “Waiting for you”');
  await p.click('[data-tk="reply"]'); await settle(300);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-tk-comment] textarea')), 'Reply on the session card puts you in the comment box');

  // the board card shows the delegate
  await nav('#/studio/g/tasks'); await poll();
  ok(!!(await p.$('[data-tk-card="T-1"] [data-tk-deleg="awaiting_input"]')), 'the card shows the agent working the task, and that it waits for you');

  // the Agents view
  await nav('#/studio/g/tasks/Agents');
  ok(/Builder[\s\S]*None\. Without a credential/.test(await main()), 'the Agents view lists your agents and says one without a credential can’t connect');
  await p.click('[data-tk="agent-new"]'); await p.waitForSelector('.xd input', { timeout: 3000 }); await p.type('.xd input', 'Release bot'); await p.keyboard.press('Enter'); await settle();
  ok(db.agents.some((a) => a.name === 'Release bot') && /Release bot/.test(await main()), 'New agent creates one and it appears');
  await p.click('[data-tk="agent-token"][data-arg="a1"]'); await p.waitForSelector('.xd input', { timeout: 3000 }); await p.type('.xd input', 'Claude Code on my laptop');
  await p.click('.xd [data-xd-submit]'); await p.waitForSelector('[data-tk-secret]', { timeout: 3000 });
  const dlg = () => p.$eval('[data-tk-secret]', (e) => e.closest('.xd-sh').innerText); const shown = await dlg();
  ok(/xtk_abcdefabcdef_SECRET1/.test(shown) && /shown once/.test(shown) && /mcpServers/.test(shown) && /Authorization/.test(shown), 'a new credential is shown once, with an MCP config to paste');
  await p.evaluate(() => [...document.querySelectorAll('.xd [data-xd-act]')].find((b) => /Copy/.test(b.textContent))?.click()); await settle(300);
  ok(/xtk_abcdefabcdef_SECRET1/.test(await p.evaluate(() => window.__clip) || ''), 'Copy puts the credential and its config on the clipboard');
  await p.keyboard.press('Escape'); await settle(400);
  ok(/xtk_abcdefabcdef_…/.test(await main()) && !/SECRET1/.test(await main()), 'afterwards the list shows only the credential’s prefix, never the secret');
  await p.click('[data-tk="agent-revoke"][data-arg="k1"]'); await p.waitForSelector('.xd [data-xd-ok]', { timeout: 3000 }); await p.click('.xd [data-xd-ok]'); await settle();
  ok(!db.agents[0].tokens.length && !/xtk_abcdefabcdef_…/.test(await main()), 'Revoke removes the credential, after a confirmation');
  await p.click('[data-tk="agent-hook"][data-arg="a1"]'); await p.waitForSelector('.xd input', { timeout: 3000 }); await p.type('.xd input', 'https://agent.example.com/xeno'); await p.keyboard.press('Enter');
  await p.waitForSelector('[data-tk-secret]', { timeout: 3000 });
  ok(/whsec_SIGNING/.test(await dlg()) && /X-Xeno-Signature/.test(await dlg()), 'a webhook shows its signing secret once, and how to verify a delivery');
  await p.keyboard.press('Escape'); await settle(400);
  ok(/agent\.example\.com/.test(await main()), 'the webhook address is listed on the agent');

  // Copy for agent, two-way
  await nav('#/studio/g/tasks/T-1');
  await p.evaluate(() => { window.__clip = null; });
  await p.click('[data-tk="prompt"]'); await settle(700);
  const brief = await p.evaluate(() => window.__clip) || '';
  ok(db.calls.some(([m, pth]) => m === 'POST' && pth === '/api/tasks/T-1/handoff') && /## Connect to XENO Tasks/.test(brief) && brief.includes('xtk_handoffhand_ONETASK') && /T-1 only/.test(brief) && /T-1\/activity/.test(brief), 'Copy for agent hands the task off and the brief carries a one-task credential and how to report back');
  ok(/Me’s agent/.test(await p.$eval('[data-tk-session]', (e) => e.innerText)), 'the hand-off agent now shows as the delegate');
  await p.evaluate(() => { window.__clip = null; });
  db.calls.length = 0;
  await p.click('[data-tk="menu"][data-arg="T-1"]').catch(() => {}); await p.evaluate(() => document.querySelector('[data-tk-root^="task:"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })));
  await p.waitForSelector('.xcm', { timeout: 3000 }); await menuClick(/^Copy brief only/); await settle(600);
  const plain = await p.evaluate(() => window.__clip) || '';
  ok(/^# T-1/.test(plain) && !/xtk_/.test(plain) && !db.calls.some(([, pth]) => /handoff/.test(pth)), '“Copy brief only” copies the brief without handing anything off');

  // a refusal says why
  db.refuseDelegate = true;
  await p.click('[data-tk-prop="delegate"]'); await p.waitForSelector('.tk-pick:not([hidden])', { timeout: 3000 }); await pickClick(/^No agent/); await settle();
  const toastText = await p.evaluate(() => [...document.querySelectorAll('.toast, [role="status"]')].map((e) => e.textContent).join(' '));
  ok(/manages the project/.test(toastText) && T1().delegate, 'a refused delegation says why and changes nothing');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { failed++; console.log('FAIL the suite threw:', e.message); } finally { await br.close(); await server.close(); }
console.log(failed ? failed + ' check(s) failed' : 'ALL PASS'); process.exit(failed ? 1 : 0);
