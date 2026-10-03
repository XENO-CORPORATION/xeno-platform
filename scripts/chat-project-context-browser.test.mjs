/**
 * Real-browser walk of the project-context navigation: the app runs from the vite dev server with
 * /api answered by request interception (no backend). It proves what the source gates cannot - that
 * the pages actually settle where the address says, through click, reload, Back/Forward and the
 * failure routes.
 *
 * BASE=http://host:port reuses a running dev server; otherwise this starts one on a free port and
 * stops exactly that PID. Not part of `npm test` (needs a dev server and a browser): run
 * `npm run test:chat-project-context:browser`.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const now = new Date().toISOString();
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@xeno.test', username: 'tester', name: 'Test User', role: 'user' };
const PROJECT = { id: '22222222-2222-4222-8222-222222222222', name: 'Arena Site', description: 'Concept art', instructions: '', owner_user_id: user.id, workspace_id: null, created_at: now, updated_at: now, capabilities: { editor: true, owner: true }, pinned: false };
const IN_PROJECT = '33333333-3333-4333-8333-333333333333';
const LOOSE = '44444444-4444-4444-8444-444444444444';
const CONVOS = [
  { id: IN_PROJECT, title: 'Sentinel concept pass', project_id: PROJECT.id, model_id: 'openai/gpt-5.5', created_at: now, updated_at: now },
  { id: LOOSE, title: 'Pricing page copy', project_id: null, model_id: 'openai/gpt-5.5', created_at: now, updated_at: now },
];
const msgs = (id) => [
  { id: `${id}-1`, conversation_id: id, role: 'user', content: 'hello', created_at: now },
  { id: `${id}-2`, conversation_id: id, role: 'assistant', content: 'hi there', created_at: now },
];
const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
function mock(url, method) {
  const p = new URL(url).pathname;
  if (p === '/api/auth/validate' || p === '/api/auth/me') return json({ success: true, user });
  if (p === '/api/auth/onboarding') return json({ done: true, welcomeAcknowledged: true });
  if (p === '/api/workspaces') return json({ success: true, workspaces: [{ id: 'w1', name: 'Personal', workspace_type: 'personal', role: 'owner', owner_user_id: user.id }] });
  if (p === '/api/chat/projects') return json({ success: true, projects: [PROJECT] });
  if (p.startsWith('/api/chat/projects/') && p.split('/').length === 5) return json({ success: true, project: PROJECT, files: [] });
  if (p === '/api/chat/conversations' && method === 'GET') return json({ success: true, conversations: CONVOS });
  const m = p.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (m && method === 'GET') {
    const c = CONVOS.find((x) => x.id === m[1]);
    return c ? json({ success: true, conversation: { ...c, messages: msgs(c.id) } }) : json({ success: false, error: 'not found' }, 404);
  }
  if (p === '/api/models') return null;
  return json({ success: true, data: [], items: [], projects: [], conversations: [], models: [] });
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

let server = null;
let base = process.env.BASE || '';
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try { if ((await fetch(base + '/')).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { server.kill(); throw new Error('vite did not start'); }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.pathname.startsWith('/api/') && u.origin === new URL(base).origin) {
    const r = mock(req.url(), req.method());
    if (r) return req.respond(r);
  }
  req.continue();
});
await page.evaluateOnNewDocument((u) => { try { localStorage.setItem('xenoos_user', JSON.stringify(u)); } catch { /* storage unavailable */ } }, user);

const path = () => new URL(page.url()).pathname;
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out: ' + label);
    await settle(200);
  }
}
const PROJ_HOME = `/overview/chat/projects/${PROJECT.id}`;
const PROJ_CHAT = `${PROJ_HOME}/c/${IN_PROJECT}`;

test.after(async () => { await browser.close(); if (server) server.kill(); });

test('project home -> click its chat stays project-scoped, with the project sidebar and breadcrumb', async () => {
  await page.goto(base + PROJ_HOME, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitFor(() => document.body.innerText.includes('Sentinel concept pass'), 'project home lists its chat');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('button,[role="button"],a')].find((n) => n.textContent.trim().startsWith('Sentinel concept pass') && n.closest('[role="dialog"]'));
    row.click();
  });
  await waitFor(() => !!document.querySelector('[data-chat-breadcrumb]'), 'breadcrumb appears');
  assert.equal(path(), PROJ_CHAT);
  const state = await page.evaluate(() => ({
    section: !!document.querySelector('[data-project-chats-section]'),
    crumb: document.querySelector('[data-chat-breadcrumb]')?.innerText,
    notice: !!document.querySelector('[data-chat-route-notice]'),
    home: !!document.querySelector('[role="dialog"][aria-label^="Project:"]'),
  }));
  assert.ok(state.section, 'project chats are in the sidebar');
  assert.match(state.crumb, /Projects[\s\S]*Arena Site[\s\S]*Sentinel concept pass/);
  assert.equal(state.notice, false);
  assert.equal(state.home, false, 'the project home overlay is closed while the chat is open');
});

test('reload keeps the project chat; Back returns to the project home; Forward returns to the chat', async () => {
  await page.reload({ waitUntil: 'networkidle2' });
  await waitFor(() => !!document.querySelector('[data-chat-breadcrumb]'), 'breadcrumb after reload');
  assert.equal(path(), PROJ_CHAT);
  assert.ok(await page.evaluate(() => !!document.querySelector('[data-project-chats-section]')));
  // Build a history hop through the breadcrumb link, then walk it with Back/Forward.
  await page.evaluate(() => [...document.querySelectorAll('[data-chat-breadcrumb] a')][1].click());
  await waitFor(() => !!document.querySelector('[role="dialog"][aria-label^="Project:"]'), 'project home via breadcrumb');
  assert.equal(path(), PROJ_HOME);
  await page.goBack();
  await waitFor(() => !!document.querySelector('[data-chat-breadcrumb]'), 'Back returns to the chat');
  assert.equal(path(), PROJ_CHAT);
  await page.goForward();
  await waitFor(() => !!document.querySelector('[role="dialog"][aria-label^="Project:"]'), 'Forward returns to the home');
  assert.equal(path(), PROJ_HOME);
});

test('deep link with the wrong project id is corrected in place', async () => {
  await page.goto(`${base}/overview/chat/projects/99999999-9999-4999-8999-999999999999/c/${IN_PROJECT}`, { waitUntil: 'networkidle2' });
  await waitFor(() => !!document.querySelector('[data-chat-breadcrumb]'), 'breadcrumb');
  assert.equal(path(), PROJ_CHAT);
});

test('a bare conversation link for a project chat lands on the project URL; a loose chat keeps the plain URL', async () => {
  await page.goto(`${base}/overview/chat/llm/${IN_PROJECT}`, { waitUntil: 'networkidle2' });
  await waitFor(() => !!document.querySelector('[data-chat-breadcrumb]'), 'breadcrumb');
  assert.equal(path(), PROJ_CHAT);
  await page.goto(`${base}/overview/chat/llm/${LOOSE}`, { waitUntil: 'networkidle2' });
  await settle(2500);
  assert.equal(path(), `/overview/chat/llm/${LOOSE}`);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-chat-breadcrumb],[data-project-chats-section]')), false);
});

test('unknown project and unavailable chat say so and offer a way back', async () => {
  await page.goto(`${base}/overview/chat/projects/does-not-exist`, { waitUntil: 'networkidle2' });
  await waitFor(() => document.querySelector('[data-chat-route-notice]')?.getAttribute('data-chat-route-notice') === 'project-missing', 'project-missing');
  await page.goto(`${base}/overview/chat/llm/55555555-5555-4555-8555-555555555555`, { waitUntil: 'networkidle2' });
  await waitFor(() => document.querySelector('[data-chat-route-notice]')?.getAttribute('data-chat-route-notice') === 'chat-unavailable', 'chat-unavailable');
  assert.ok(await page.evaluate(() => document.querySelector('[data-chat-route-notice]').innerText.includes('All chats')));
});
