// A reply's text and its steps in the order they happened, and the approval card's price, in a real browser: the real
// workspace and the real React chat over a fixture API that speaks the real stream. The saved turn goes through the
// server's own validator, so what a reload shows is what production stores.
//   node scripts/chat-card-order-browser.test.mjs          AGENT_SHOTS=<dir> saves screenshots
// It proves what the pure tests cannot: the card sits under the words written before it while the turn streams and
// after a reload, several parts keep their order, and a waiting card prices once and holds still.
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeTurnRecord } from '../src/server/utils/chatTurnRecord.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CARD_ORDER_TEST_PORT || 5297), base = `http://127.0.0.1:${PORT}`;
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
const { default: puppeteer } = await import(pathToFileURL(path.join(root, 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')));

// ---- fixture ----
const user = { id: '00000000-0000-4000-8000-000000000001', username: 'order_test', display_name: 'Order test', email: 'test@example.invalid', email_verified: true, role: 'user', credits: 1000, credit_balance: 1000, is_active: true };
const CHAT = '99999999-9999-4999-8999-999999999998';
const OLD_CARD = '11111111-1111-4111-8111-1111111111aa', OLD_RUN_REPLY = '22222222-2222-4222-8222-2222222222bb';
const NEW_CARD = '33333333-3333-4333-8333-3333333333cc', LAST_CARD = '44444444-4444-4444-8444-4444444444dd';
const request = (prompt) => ({ type: 'image', model: 'gpt-image-2.5-sunburst', prompt, settings: { ratio: '16:9', quality: 'high' }, referenceAssetIds: [], projectId: null, conversationId: CHAT, area: null });
const proposal = (id) => ({ id, type: 'image', state: 'awaiting_approval', request: request('A half-body robot hero shot'), requestHash: 'h', version: 1, quote: {}, resultAssetIds: [], replacedBy: null, createdAt: new Date().toISOString(), favorite: false });
const at = (s) => new Date(Date.now() - s * 1000).toISOString();
const step = { startedAt: 1000, endedAt: 2000 };
const msgs = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'user', content: 'Older turns, saved before a step knew its place.', created_at: at(90) },
  // a proposal has always ended its turn, so an older card goes under its text
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', role: 'assistant', content: 'Older words above the older card.', created_at: at(80), turn: { schema: 'xeno.chat.turn.v1', ...step, steps: [{ id: 'generation:' + OLD_CARD, kind: 'generation', generationId: OLD_CARD, type: 'image', startedAt: 1100 }] } },
  // nothing says where an older run happened, so it stays where the chat always drew it
  { id: OLD_RUN_REPLY, role: 'assistant', content: 'Older words under the older run.', created_at: at(70), turn: { schema: 'xeno.chat.turn.v1', ...step, steps: [{ id: 'code-1', kind: 'code', language: 'python', code: 'print("old")', status: 'success', exitCode: 0, stdout: 'old', ...step }] } },
];
const unavailable = (type) => ({ type, available: false, tariff: null, models: [], reason: 'gateway_adapter_unqualified' });
const catalog = { types: [{ type: 'image', available: true, tariff: null, models: [{ id: 'gpt-image-2.5-sunburst', type: 'image', endpoint: '/v1/images/generations', settings: { ratio: { values: ['1:1', '16:9'], default: '1:1' }, quality: { values: ['medium', 'high'], default: 'medium' } }, references: { max: 8 } }] }, ...['video', 'audio', '3d'].map(unavailable)] };
const quotes = [], saved = [];
let releaseHold = null, streaming = null;
const body = (req) => new Promise((done) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => done(raw ? JSON.parse(raw) : {})); });
const frame = (res, value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = () => new Promise((r) => { releaseHold = r; });
// each turn, in the order the server's loop emits it
const TURNS = {
  async owner(res) {
    const words = "I've written the brief below. The robot becomes a half-body hero shot.";
    for (const piece of words.match(/.{1,16}/g)) { frame(res, { type: 'delta', text: piece }); await pause(20); }
    await pause(150);
    frame(res, { type: 'generation_proposal', index: 0, generation: proposal(NEW_CARD) });
    await hold();                                // the test reads the live order here
    return { text: words };
  },
  async parts(res) {
    frame(res, { type: 'delta', text: 'First words, before the run.' });
    await pause(120);
    frame(res, { type: 'code_start', index: 0, language: 'python', code: 'print("run")' });
    await pause(120);
    frame(res, { type: 'code_result', index: 0, status: 'success', exitCode: 0, stdout: 'run', stderr: '', files: [] });
    await pause(120);
    frame(res, { type: 'delta', text: '\n\n' }); frame(res, { type: 'delta', text: 'Middle words, after the run.' });
    await pause(120);
    frame(res, { type: 'generation_proposal', index: 0, generation: proposal(LAST_CARD) });
    await hold();
    return { text: 'First words, before the run.\n\nMiddle words, after the run.' };
  },
  async after(res) {
    frame(res, { type: 'code_start', index: 0, language: 'python', code: 'print("first")' });
    await pause(120);
    frame(res, { type: 'code_result', index: 0, status: 'success', exitCode: 0, stdout: 'first', stderr: '', files: [] });
    await pause(120);
    frame(res, { type: 'delta', text: 'Words written after the only run.' });
    await hold();
    return { text: 'Words written after the only run.' };
  },
};
const plugin = { name: 'card-order-fixture', enforce: 'pre', configureServer(server) { server.middlewares.use(async (req, res, next) => {
  const u = new URL(req.url, 'http://local'), p = u.pathname, json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (p.startsWith('/api/')) {
    if (p === '/api/auth/me' || p === '/api/auth/validate') return json({ success: true, user });
    if (p === '/api/auth/onboarding') return json({ done: true, welcomeAcknowledged: true });
    if (p === '/api/models') return json({ success: true, timestamp: '', totalCompanies: 1, companies: { OpenAI: [{ id: 'gpt-5', name: 'GPT-5', description: '', contextWindow: 128000, maxOutput: 16000 }] } });
    if (p === '/api/generations/catalog') return json(catalog);
    if (p === '/api/generations/quote') { const r = await body(req); quotes.push(r.settings); return json({ quoteToken: 'q', requestHash: 'h', tariffRevision: 't', maxRetailCredits: 10, expiresAt: new Date(Date.now() + 300000).toISOString() }); }
    const generation = /^\/api\/generations\/([0-9a-f-]{36})$/.exec(p);
    if (generation) return json({ generation: proposal(generation[1]) });
    if (p === `/api/chat/conversations/${CHAT}`) return json({ success: true, conversation: { id: CHAT, title: 'Order', messages: msgs }, messages: msgs });
    if (p === `/api/chat/conversations/${CHAT}/messages` && req.method === 'POST') {
      const b = await body(req); const checked = normalizeTurnRecord(b.turn);
      if (!checked.ok) return json({ success: false, error: checked.error }, 400);
      const row = { id: crypto.randomUUID(), ...b, turn: checked.turn, created_at: new Date().toISOString() };
      msgs.push(row); saved.push(row); return json({ success: true, message: row });
    }
    if (p === '/api/ai/chat/stream' && req.method === 'POST') {
      await body(req); res.statusCode = 200; res.setHeader('Content-Type', 'text/event-stream');
      const { text } = await TURNS[streaming](res);
      frame(res, { type: 'result', text, modelIdUsed: 'gpt-5', reasoningProcessed: false }); return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ success: true, count: 1, tokens: 1 });
    return json({ success: true, data: [], items: [], generations: [], conversations: [{ id: CHAT, title: 'Order', updated_at: new Date().toISOString() }], messages: [], projects: [], pins: [], workspaces: [], assets: [], folders: [], tasks: [], notifications: [] });
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
const shot = async (name) => { if (process.env.AGENT_SHOTS) { fs.mkdirSync(process.env.AGENT_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.AGENT_SHOTS, `chat-card-order-${name}.png`) }); } };
let chat;
const open = async () => {
  await page.goto(base + `/workspace/apps/chat/${CHAT}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#xw-chat-frame', { timeout: 60000 });
  chat = await (await page.$('#xw-chat-frame')).contentFrame();
  await chat.waitForSelector(box, { timeout: 150000 });
  await chat.waitForFunction(() => /Older words under the older run/.test(document.body.innerText), { timeout: 30000 });
};
const send = async (turn, text) => {
  streaming = turn;
  await chat.click(box); await page.keyboard.type(text); await page.keyboard.press('Enter');
};
/** The vertical order of the named things. A string is words on the page, `#id` a generation card, `.x` a selector taken at its nth use. */
const order = (things) => chat.evaluate((list) => {
  const topOf = (thing) => {
    if (thing.startsWith('#')) return document.querySelector(`[data-chat-generation="${thing.slice(1)}"]`)?.getBoundingClientRect().top ?? null;
    if (thing.startsWith('.')) { const [sel, n] = thing.split('@'); return document.querySelectorAll(sel)[Number(n || 0)]?.getBoundingClientRect().top ?? null; }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.includes(thing) && node.parentElement.closest('[data-turn]')) { const r = document.createRange(); r.selectNode(node); return r.getBoundingClientRect().top; }
    return null;
  };
  return list.map(topOf);
}, things);
const assertOrder = async (things) => {
  const tops = await order(things);
  tops.forEach((top, i) => assert.notEqual(top, null, `${things[i]} is not on the page`));
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] > tops[i - 1], `${things[i]} (${tops[i]}) should be below ${things[i - 1]} (${tops[i - 1]})`);
};
const OWNER = "I've written the brief below";
const button = () => chat.evaluate((id) => document.querySelector(`.chat-q-gen-wrap[data-generation-id="${id}"] .chat-q-gen-go`)?.textContent ?? null, NEW_CARD);

try {
  await open();
  await check('an older card goes under its text, and an older run stays where it was', async () => {
    await chat.waitForSelector(`[data-chat-generation="${OLD_CARD}"]`, { timeout: 15000 });
    await assertOrder(['Older words above the older card.', `#${OLD_CARD}`]);
    await assertOrder(['.chat-code', 'Older words under the older run.']);
  });

  await send('owner', 'Make the robot a hero image');
  await check('while the turn streams, the card sits under the words written before it', async () => {
    await chat.waitForSelector(`[data-chat-generation="${NEW_CARD}"]`, { timeout: 20000 });
    await wait(400); await shot('streaming');
    await assertOrder([OWNER, `#${NEW_CARD}`]);
  });
  await check('a waiting card prices once and its button never goes back to Pricing', async () => {
    await chat.waitForFunction((id) => /Generate · up to 10 credits/.test(document.querySelector(`.chat-q-gen-wrap[data-generation-id="${id}"]`)?.innerText || ''), { timeout: 15000 }, NEW_CARD);
    const before = quotes.length, seen = new Set();
    for (const until = Date.now() + 7000; Date.now() < until; await wait(40)) seen.add(await button());
    assert.deepEqual([...seen], ['Generate · up to 10 credits'], `the button read ${[...seen].join(' / ')}`);
    assert.equal(quotes.length, before, `${quotes.length - before} more quotes for a request that did not change`);
  });
  releaseHold();
  await chat.waitForFunction(() => !document.querySelector('[data-streaming="true"]'), { timeout: 15000 }).catch(() => {});
  await check('when the turn lands the order holds, and the place is saved on the step', async () => {
    for (let i = 0; i < 100 && !saved.some((m) => m.role === 'assistant'); i++) await wait(100);
    await assertOrder([OWNER, `#${NEW_CARD}`]);
    const stored = saved.find((m) => m.role === 'assistant').turn.steps.find((s) => s.kind === 'generation');
    assert.equal(stored.textAt, saved.find((m) => m.role === 'assistant').content.length);
  });
  await wait(1200);
  await send('parts', 'Run it and then propose');
  await check('several parts: words, run, words, card, while it streams', async () => {
    await chat.waitForSelector(`[data-chat-generation="${LAST_CARD}"]`, { timeout: 20000 }); await wait(400);
    await assertOrder(['First words, before the run.', '.chat-code@1', 'Middle words, after the run.', `#${LAST_CARD}`]);
  });
  releaseHold();
  await wait(1500);
  await send('after', 'Run it, then tell me');
  await check('text after a step stays after it', async () => {
    await chat.waitForFunction(() => /Words written after the only run\./.test(document.body.innerText), { timeout: 20000 }); await wait(300);
    await assertOrder(['.chat-code@2', 'Words written after the only run.']);
  });
  releaseHold();
  for (let i = 0; i < 100 && saved.filter((m) => m.role === 'assistant').length < 3; i++) await wait(100);

  await open();
  await chat.waitForSelector(`[data-chat-generation="${LAST_CARD}"]`, { timeout: 15000 });
  await check('after a reload every turn is in the same order', async () => {
    await wait(600); await shot('reloaded');
    await assertOrder([OWNER, `#${NEW_CARD}`]);
    await assertOrder(['First words, before the run.', '.chat-code@1', 'Middle words, after the run.', `#${LAST_CARD}`]);
    await assertOrder(['.chat-code@2', 'Words written after the only run.']);
  });
  await check('no page error anywhere in the run', async () => { assert.deepEqual(pageErrors, [], JSON.stringify(pageErrors).slice(0, 400)); });
} finally { await browser.close(); await server.close(); process.chdir(previous); }
console.log(`\nchat-card-order-browser: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
