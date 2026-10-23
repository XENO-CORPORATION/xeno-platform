import { shot } from './shot.mjs';
// Dev › Automate is XENO Workflow: workflows are xeno-workflow graphs from /api/automate (a stand-in here), built with
// the runner's own node catalogue.
//   1. no sample mark; the area registers as live; tabs and New workflow sit in the header bar
//   2. New workflow opens the workspace dialog → POST /api/automate with a xeno-workflow graph starting at the event
//   3. the builder: Add step (dialog) → a workspace action → Save → PUT with the step wired by an exec edge
//   4. Turn on → POST /enable; a branched graph is shown read-only; Runs and a run's steps; the unconfigured banner
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5219, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const WF1 = '11111111-1111-4111-8111-111111111111', WF2 = '22222222-2222-4222-8222-222222222222', RUN1 = '33333333-3333-4333-8333-333333333333';
const NODES = [
  { type: 'xeno-platform-trigger', name: 'XENO Workspace Event', category: 'triggers', visualCategory: 'trigger', configFields: [
    { key: 'event', label: 'When', type: 'select', options: [{ label: 'A task changes status', value: 'task.status_changed' }, { label: 'On a schedule', value: 'schedule' }, { label: 'A webhook is received', value: 'webhook' }] },
    { key: 'taskStatus', label: 'Task moves to (optional)', type: 'select', options: [{ label: 'Any status', value: '' }, { label: 'done', value: 'done' }] },
    { key: 'cron', label: 'Schedule (cron)', type: 'text' }, { key: 'timezone', label: 'Time zone', type: 'text' }], defaultConfig: {}, secretFields: [] },
  { type: 'xeno-platform-capability', name: 'XENO Workspace Action', category: 'external', visualCategory: 'action', description: 'Do one thing in the XENO workspace', configFields: [{ key: 'capability', label: 'Capability', type: 'text' }, { key: 'arguments', label: 'Arguments', type: 'json' }], defaultConfig: { capability: '', arguments: '{}' }, secretFields: [] },
  { type: 'json-transform', name: 'JSON Transform', category: 'data', visualCategory: 'transform', configFields: [{ key: 'template', label: 'Template', type: 'json' }], defaultConfig: { template: '{}' }, secretFields: [] },
];
const ACTIONS = [{ name: 'tasks.task.create', title: 'Raise a task', scope: 'tasks:write', class: 'undoable', input: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, body: { type: 'string' } } } }];
const view = (w) => ({ capabilities: [], scopes: [], disabledReason: null, failureThreshold: 5, consecutiveFailures: 0, webhookPath: null, hasWebhookSecret: false, nextRunAt: null, createdByKind: 'human', enabledBy: null, enabledAt: null, revision: 1, canEdit: true, trigger: { event: 'task.status_changed' }, ...w });
const db = { calls: [], configured: true, wfs: [
  view({ id: WF1, name: 'Nightly digest', state: 'enabled', graph: { nodes: [{ id: 'trigger', type: 'xeno-platform-trigger', label: 'When', config: { event: 'task.status_changed', taskStatus: 'done' }, position: { x: 0, y: 0 } }], edges: [] } }),
  view({ id: WF2, name: 'Branchy', state: 'draft', graph: { nodes: [{ id: 'a', type: 'xeno-platform-trigger', config: { event: 'webhook' } }, { id: 'b', type: 'json-transform', config: {} }, { id: 'c', type: 'json-transform', config: {} }], edges: [{ source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in', kind: 'exec' }, { source: 'a', sourcePort: 'out', target: 'c', targetPort: 'in', kind: 'exec' }] } }),
], runs: [{ id: RUN1, workflowId: WF1, workflowName: 'Nightly digest', trigger: 'task.status_changed', state: 'succeeded', attempt: 1, resumed: false, executionId: 'ex1', steps: [{ nodeId: 'trigger', label: 'When', type: 'xeno-platform-trigger', status: 'success', durationMs: 2, outputs: { event: { task: { title: 'Ship it' } } } }, { nodeId: 'act', label: 'Raise', type: 'xeno-platform-capability', status: 'success', durationMs: 40, outputs: { data: { key: 'T-9' } } }], error: null, input: { task: { title: 'Ship it' } }, createdAt: new Date().toISOString() }] };

async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null, M = q.method(), P = u.pathname;
    if (P.startsWith('/api/automate')) db.calls.push([M, P + u.search, sent]);
    if (P === '/api/auth/me') return json({ success: true, user: USER });
    if (P === '/api/automate' && M === 'GET') return json({ success: true, workflows: db.wfs.map((w) => ({ ...w, graph: undefined, steps: w.graph.nodes.length, lastRun: null })), canEdit: true, recentFailures: 1, configured: db.configured });
    if (P === '/api/automate/catalogue') return json({ success: true, nodes: NODES, actions: ACTIONS });
    if (P === '/api/automate' && M === 'POST') { const w = view({ id: '44444444-4444-4444-8444-444444444444', name: sent.name, state: 'draft', graph: sent.graph, trigger: { event: sent.graph.nodes[0].config.event } }); db.wfs.unshift(w); return json({ success: true, workflow: w }); }
    if (P === '/api/automate/runs' && M === 'GET') return json({ success: true, runs: u.searchParams.get('state') === 'failed' ? [] : db.runs });
    let m = P.match(/^\/api\/automate\/runs\/([^/]+)$/); if (m) return json({ success: true, run: db.runs.find((r) => r.id === m[1]) });
    m = P.match(/^\/api\/automate\/([^/]+)(\/(enable|disable|run))?$/);
    if (m) { const w = db.wfs.find((x) => x.id === m[1]); if (!w) return json({ success: false, error: 'Workflow not found' }, 404);
      if (M === 'GET' && !m[2]) return json({ success: true, workflow: w });
      if (M === 'PUT') { Object.assign(w, { name: sent.name, graph: sent.graph, revision: w.revision + 1, capabilities: sent.graph.nodes.filter((n) => n.type === 'xeno-platform-capability').map((n) => n.config.capability) }); return json({ success: true, workflow: w }); }
      if (m[3] === 'enable') { w.state = 'enabled'; return json({ success: true, workflow: w }); }
      if (m[3] === 'disable') { w.state = 'disabled'; return json({ success: true, workflow: w }); } }
    if (P.startsWith('/api/automate')) return json({ success: false, error: 'unexpected ' + P }, 500);
    if (P === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1800); await shot(p, 'automate');
  return { p, errs };
}

try {
  const { p, errs } = await open('#/dev/z/automate');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-au-page]')?.dataset.auPage, live: !!(window.XENO_ZONE_LIVE || {})['dev.automate'], mark: !!document.querySelector('#main [data-sample-badge]'), rows: document.querySelectorAll('[data-au-list] [data-au-open]').length }));
  ok(s0.page === 'ready' && s0.live && !s0.mark && s0.rows === 2, `Automate is real: live, no sample mark, the workspace's workflows listed (${JSON.stringify(s0)})`);
  ok(await p.$('#main .topbar .pg-top-acts [data-au-new]') !== null && await p.$('#main .topbar .pg-top-tabs [data-au-tab="workflows"][aria-selected="true"]') !== null && await p.$('#main .mview [data-au-tab], #main .mview [data-au-new]') === null, 'tabs and New workflow live in the header bar, not the body');
  ok(await p.evaluate(() => /Failed1/.test(document.querySelector('[data-au-tab="failed"]')?.textContent.replace(/\s/g, '') || '')), 'the Failed tab counts recent failures');

  // New workflow → the dialog → a xeno-workflow graph starting at the chosen event
  await p.click('#main .topbar [data-au-new]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-name') !== null, 'New workflow opens the workspace dialog');
  await p.type('.xd-sh #xdf-name', 'Tell the team'); await p.click('.xd-sh [data-f="event"] [data-v="schedule"]');
  await p.click('.xd-sh [data-xd-submit]'); await wait(1200);
  const post = db.calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/automate'));
  ok(post && post[2].name === 'Tell the team' && post[2].graph.nodes[0].type === 'xeno-platform-trigger' && post[2].graph.nodes[0].config.event === 'schedule', `the draft is a xeno-workflow graph that starts at the event (${JSON.stringify(post && post[2].graph.nodes[0])})`);
  ok(/\/z\/automate\/workflows\/44444444-4444-4444-8444-444444444444$/.test(await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])), 'the workflow has its own id-based address under Workflows');
  ok(await p.evaluate(() => !!document.querySelector('[data-au-step="trigger"] [data-au-f="0.cron"]')), 'the trigger step shows the schedule fields from the runner’s catalogue');

  // the builder: add a workspace action and save
  await p.click('[data-au-add]'); await wait(300);
  ok(await p.$('.xd-sh [data-f="type"] [data-v="xeno-platform-capability"]') !== null && await p.$('.xd-sh [data-f="type"] [data-v="json-transform"]') !== null, 'Add step offers the runner’s node types in the dialog');
  await p.click('.xd-sh [data-f="type"] [data-v="xeno-platform-capability"]'); await p.click('.xd-sh [data-xd-submit]'); await wait(500);
  ok(await p.$('[data-au-type="xeno-platform-capability"] select[data-au-f="1.capability"]') !== null, 'the action step offers the workspace capabilities');
  await p.select('[data-au-f="1.capability"]', 'tasks.task.create'); await wait(300);
  ok(await p.evaluate(() => /title/.test(document.querySelector('[data-au-args]')?.textContent || '')), 'it names the chosen capability’s arguments');
  await p.evaluate(() => { const t = document.querySelector('[data-au-f="1.arguments"]'); t.value = '{"title":"{{ $node.trigger.event.scheduledFor }}"}'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await p.evaluate(() => !document.querySelector('[data-au-save]').disabled), 'an edit enables Save');
  await p.click('#main .topbar [data-au-save]'); await wait(900);
  const put = db.calls.find((x) => x[0] === 'PUT');
  const g = put && put[2].graph;
  ok(g && g.nodes.length === 2 && g.nodes[1].config.capability === 'tasks.task.create' && g.nodes[1].config.arguments.includes('scheduledFor'), `Save sends the graph with the new step (${JSON.stringify(g && g.nodes[1])})`);
  ok(g && g.edges.some((e) => e.kind === 'exec' && e.source === 'trigger' && e.target === g.nodes[1].id && e.sourcePort === 'out' && e.targetPort === 'in'), 'the step is wired to the trigger by an exec edge, as XENO Workflow wires it');
  ok(put && put[2].expectedRevision === 1, 'Save carries the revision it edited');

  await p.click('#main .topbar [data-au-enable]'); await wait(700);
  ok(db.calls.some((x) => x[0] === 'POST' && x[1].endsWith('/enable')) && await p.evaluate(() => document.querySelector('[data-au-cur]')?.dataset.auCur === 'enabled'), 'Turn on enables it');

  // a branched graph is read-only here
  await p.evaluate((id) => window.XW.go('zone', { zone: 'automate', item: 'workflows/' + id }), WF2); await wait(900);
  ok(await p.evaluate(() => !!document.querySelector('[data-au-branched]') && !document.querySelector('[data-au-steps]')), 'a graph with branches is shown as it is, to edit in the XENO Workflow app');

  // runs
  await p.click('#main .topbar [data-au-tab="runs"]'); await wait(800);
  ok(await p.evaluate((id) => !!document.querySelector(`[data-au-run-open="${id}"]`), RUN1), 'Runs lists the workspace’s runs');
  await p.click(`[data-au-run-open="${RUN1}"]`); await wait(800);
  ok(await p.evaluate(() => document.querySelectorAll('[data-au-run-step]').length === 2 && /T-9/.test(document.querySelector('[data-au-run-step="act"]')?.textContent || '')), 'a run shows each step and its output');
  ok(/\/z\/automate\/runs\/33333333/.test(await p.evaluate(() => window.XENO_ADDR.current())), 'a run has its own address');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();

  db.configured = false;
  const two = await open('#/dev/z/automate');
  ok(await two.p.evaluate(() => !!document.querySelector('[data-au-unconfigured]')), 'without the runner the page says workflows can be drafted but none will run');
  await two.p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
