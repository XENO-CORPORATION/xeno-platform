// `@agent` hand-off from the chat, in a real browser: the real workspace and the real React chat, with a fixture
// API. Nothing leaves 127.0.0.1 and every write the fixture does not know is refused.
//   node scripts/chat-handoff-browser.test.mjs
// It proves what the server test cannot: that typing `@at` lists the agent in the workspace's menu, that picking it
// puts the box in hand-off mode, that Send hands the prompt over instead of asking a model, and that the reply is a
// live task card stored with the chat.
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HANDOFF_TEST_PORT || 5298), base = `http://127.0.0.1:${PORT}`;
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
const { default: puppeteer } = await import(pathToFileURL(path.join(root, 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')));

// ---- fixture ----
const user = { id: '00000000-0000-4000-8000-000000000001', username: 'handoff_test', display_name: 'Handoff test', email: 'test@example.invalid', email_verified: true, role: 'user', credits: 1000, credit_balance: 1000, is_active: true };
const AGENT = { id: 'agt_' + 'a'.repeat(32), name: 'Atlas', status: 'active', division: { id: 'd1', name: 'Research' }, rights: { runner: true, manage: true } };
const CHAT = '99999999-9999-4999-8999-999999999999';
const msgs = [
  { id: '11111111-1111-4111-8111-111111111111', role: 'user', content: 'We need release notes.', created_at: new Date(Date.now() - 60000).toISOString() },
  { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', content: 'Sure, what should they cover?', created_at: new Date(Date.now() - 50000).toISOString() },
];
const task = { key: 'T-41', title: 'Write the release notes for 1.2', status: 'todo', delegate: { id: 'u-a', name: 'Atlas' }, session: { state: 'pending', note: 'Waiting for the agent to pick it up' } };
const unavailable = (type) => ({ type, available: false, tariff: null, models: [], reason: 'gateway_adapter_unqualified' });
const writes = [], bodies = { messages: [] };
const body = (req) => new Promise((done) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => done(raw ? JSON.parse(raw) : {})); });
const plugin = { name: 'handoff-fixture', enforce: 'pre', configureServer(server) { server.middlewares.use(async (req, res, next) => {
  const u = new URL(req.url, 'http://local'), p = u.pathname, json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') writes.push(`${req.method} ${p}`);
    if (p === '/api/auth/me' || p === '/api/auth/validate') return json({ success: true, user });
    if (p === '/api/auth/onboarding') return json({ done: true, welcomeAcknowledged: true });
    if (p === '/api/models') return json({ success: true, timestamp: '', totalCompanies: 1, companies: { OpenAI: [{ id: 'gpt-5', name: 'GPT-5', description: '', contextWindow: 128000, maxOutput: 16000 }] } });
    if (p === '/api/generations/catalog') return json({ types: ['image', 'video', 'audio', '3d'].map(unavailable) });
    if (p === '/api/agents') return json({ success: true, agents: [AGENT] });
    if (p === `/api/chat/conversations/${CHAT}`) return json({ success: true, conversation: { id: CHAT, title: 'Release planning', messages: msgs }, messages: msgs });
    if (p === `/api/chat/conversations/${CHAT}/messages` && req.method === 'POST') { const b = await body(req); bodies.messages.push(b); return json({ success: true, message: { id: crypto.randomUUID(), ...b, created_at: new Date().toISOString() } }); }
    if (p === `/api/chat/conversations/${CHAT}/handoff` && req.method === 'POST') { bodies.handoff = await body(req); return json({ success: true, handoff: { task: { key: task.key, title: task.title, status: 'todo' }, agent: { id: AGENT.id, name: 'Atlas' }, delegated: true, run: { id: 'r1', state: 'queued' } } }, 201); }
    if (p === '/api/tasks/T-41') return json({ success: true, task });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ success: false, error: 'refused by the test fixture' }, 403);
    return json({ success: true, data: [], items: [], conversations: [{ id: CHAT, title: 'Release planning', updated_at: new Date().toISOString() }], messages: [], projects: [], pins: [], workspaces: [], assets: [], folders: [], tasks: [], notifications: [], settings: {}, total: 0 });
  }
  if (p.startsWith('/workspace') && !/\.[a-z0-9]+$/i.test(p)) { res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(root, 'prototypes/xeno-workspace/index.html'), 'utf8')); }
  next();
}); } };

// ---- run ----
const previous = process.cwd(); process.chdir(root); // Tailwind resolves its config from the working directory
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), plugins: [plugin], server: { host: '127.0.0.1', port: PORT, strictPort: true, proxy: {}, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 950 } });
const page = await browser.newPage(); const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.setRequestInterception(true);
page.on('request', (r) => { const u = new URL(r.url()); if (['data:', 'blob:', 'about:'].includes(u.protocol) || u.origin === base) r.continue(); else r.abort(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0; const failures = [];
const check = async (label, fn) => { try { await fn(); passed++; console.log('PASS', label); } catch (e) { failures.push(label); console.log('FAIL', label, '\n     ', String(e.message).split('\n')[0]); } };
const box = '[data-chat-composer-shell] textarea';

try {
  await page.goto(base + `/workspace/apps/chat/${CHAT}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#xw-chat-frame', { timeout: 60000 });
  const frameEl = await page.$('#xw-chat-frame'), frame = await frameEl.contentFrame();
  await frame.waitForSelector(box, { timeout: 150000 }); await wait(3000);

  await check('typing @at lists your agent in the @ menu', async () => {
    await frame.click(box); await page.keyboard.type('@at'); await wait(1200);
    assert.ok(await page.$(`#apmenu.show [data-model="agent:${AGENT.id}"]`), 'Atlas is in the menu');
  });
  await check('Enter picks it: the box says who it goes to, and the @word is gone', async () => {
    await page.keyboard.press('Enter'); await wait(800);
    assert.ok(await frame.$(`[data-handoff-to="${AGENT.id}"]`));
    assert.equal(await frame.$eval(box, (t) => t.value.trim()), '');
    assert.match(await frame.$eval(box, (t) => t.placeholder), /Atlas/);
  });
  await check('Send hands the prompt to the agent, not to a model', async () => {
    await page.keyboard.type('Write the release notes for 1.2'); await page.keyboard.press('Enter'); await wait(2500);
    assert.deepEqual(bodies.handoff, { agentId: AGENT.id, prompt: 'Write the release notes for 1.2' });
    assert.ok(!writes.some((w) => /\/api\/ai\//.test(w)), 'no model was asked: ' + writes.join(', '));
  });
  await check('the reply is a live task card, saved with the chat', async () => {
    await frame.waitForSelector('[data-chat-handoff="T-41"]', { timeout: 10000 }); await wait(1200);
    const t = await frame.$eval('[data-chat-handoff="T-41"]', (e) => e.innerText);
    assert.match(t, /Handed to Atlas/); assert.match(t, /Write the release notes/); assert.match(t, /To do/);
    const saved = bodies.messages.find((m) => m.role === 'assistant');
    assert.equal(saved?.turn?.steps?.[0]?.kind, 'handoff'); assert.equal(saved.turn.steps[0].taskKey, 'T-41');
    assert.match(bodies.messages.find((m) => m.role === 'user')?.content || '', /^@Atlas Write the release notes/);
  });
  await check('after sending, the box is back to chat', async () => { assert.equal(await frame.$('[data-handoff-to]'), null); });
  await check('Escape leaves hand-off mode without sending', async () => {
    const before = writes.length;
    await frame.click(box); await page.keyboard.type('@atl'); await wait(1000); await page.keyboard.press('Enter'); await wait(600);
    assert.ok(await frame.$('[data-handoff-to]'));
    await page.keyboard.press('Escape'); await wait(400);
    assert.equal(await frame.$('[data-handoff-to]'), null, 'still in hand-off mode'); const sent = writes.slice(before).filter((w) => !w.includes('/api/tokenize/')); assert.deepEqual(sent, [], JSON.stringify(sent));
  });
  await check('no page error anywhere in the run', async () => { assert.deepEqual(pageErrors, [], JSON.stringify(pageErrors).slice(0, 400)); });
} finally { await browser.close(); await server.close(); process.chdir(previous); }
console.log(`\nchat-handoff-browser: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
