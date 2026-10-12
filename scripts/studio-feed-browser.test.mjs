// Studio feed, in a real browser: the real workspace and the real React pages, with a fixture API.
// Nothing leaves 127.0.0.1 and every write the fixture does not know is refused.
//   node scripts/studio-feed-browser.test.mjs
// It proves what unit tests cannot: that the pages mount, that the views, keys, drag and addresses work
// with a real mouse, and that a page change does not reload the workspace.
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.STUDIO_TEST_PORT || 5297), base = `http://127.0.0.1:${PORT}`;
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
const { default: puppeteer } = await import(pathToFileURL(path.join(root, 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')));

// ---- fixture ----
const user = { id: '00000000-0000-4000-8000-000000000001', username: 'studio_test', display_name: 'Studio test', email: 'test@example.invalid', email_verified: true, role: 'user', credits: 1000, credit_balance: 1000, is_active: true };
const tariff = (n) => ({ revision: 'r1', maxRetailCredits: n });
const catalog = { types: [
  { type: 'image', available: true, tariff: tariff(10), models: [{ id: 'img-model', name: 'Image Model', type: 'image', endpoint: '/v1/images/generations', settings: { ratio: { values: ['1:1', '16:9'], default: '16:9' } }, references: { max: 4, modes: ['reference', 'style'] }, tariff: tariff(10) }] },
  { type: 'video', available: true, tariff: tariff(100), models: [{ id: 'vid-model', name: 'Video Model', type: 'video', endpoint: '/v1/videos/generations', settings: { ratio: { values: ['16:9'], default: '16:9' } }, references: { max: 1 }, tariff: tariff(100) }] },
  { type: 'audio', available: false, tariff: null, models: [], reason: 'gateway_adapter_unqualified' },
  { type: '3d', available: false, tariff: null, models: [], reason: 'gateway_adapter_unqualified' }] };
const CHAT = '99999999-9999-4999-8999-999999999999';
const uid = (n, tail) => `0000000${n}-0000-4000-8000-0000000000${tail}`;
const make = (type, tail, model) => (n, state, prompt, mins, extra = {}) => ({ id: uid(n, tail), type, state, request: { type, model, prompt, settings: { ratio: '16:9' }, referenceAssetIds: [] }, requestHash: 'h', version: 1, quote: {}, resultAssetIds: [], error: null, favorite: false, createdAt: new Date(Date.now() - mins * 60000).toISOString(), ...extra });
const image = make('image', 'bb', 'img-model'), video = make('video', 'aa', 'vid-model');
const records = {
  image: [image(4, 'running', 'A teapot shaped like a house', 1), image(3, 'failed', 'An old map of an island', 12, { error: { code: 'provider_failed' } }), image(2, 'succeeded', 'A lattice of glass polyhedra', 50, { resultAssetIds: ['img-a'] }), image(1, 'succeeded', 'A designer at a wide desk', 200, { resultAssetIds: ['img-b'] })],
  video: [video(2, 'succeeded', 'Aerial pass over a lake', 90, { resultAssetIds: ['vid-a'] }), video(1, 'succeeded', 'Ink blooming in water', 300, { resultAssetIds: ['vid-a'] })],
  audio: [], '3d': [] };
const everything = () => Object.values(records).flat();
const files = { 'img-a': ['image/jpeg', '/hero-bg.jpg'], 'img-b': ['image/jpeg', '/canvas-workspace-demo.jpg'], 'vid-a': ['video/mp4', '/hero-bg.mp4'] };
const jobs = new Map(), writes = [];
const body = (req) => new Promise((done) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => done(raw ? JSON.parse(raw) : {})); });
const plugin = { name: 'studio-feed-fixture', enforce: 'pre', configureServer(server) { server.middlewares.use(async (req, res, next) => {
  const u = new URL(req.url, 'http://local'), p = u.pathname, json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (p.startsWith('/api/')) {
    const asset = /^\/api\/library\/assets\/([\w-]+)\/(content|link)$/.exec(p);
    if (asset && files[asset[1]]) { if (asset[2] === 'content') { res.setHeader('Content-Type', files[asset[1]][0]); return res.end(); } return json({ url: files[asset[1]][1] }); }
    if (req.method !== 'GET' && req.method !== 'HEAD') writes.push(`${req.method} ${p}`);
    if (p === '/api/auth/me' || p === '/api/auth/validate') return json({ success: true, user });
    if (p === '/api/auth/onboarding') return json({ done: true, welcomeAcknowledged: true });
    if (p === '/api/models') return json({ success: true, timestamp: '', totalCompanies: 1, companies: { OpenAI: [{ id: 'gpt-5', name: 'GPT-5', description: '', contextWindow: 128000, maxOutput: 16000, type: 'text', created: 1 }] } });
    if (p === '/api/generations/catalog') return json(catalog);
    if (p === `/api/chat/conversations/${CHAT}`) { const g = records.image.find((x) => x.state === 'succeeded'); return json({ success: true, conversation: { id: CHAT, title: 'A chat with a generation', messages: [
      { id: '11111111-1111-4111-8111-111111111111', role: 'user', content: 'Hello, help me plan a poster.', created_at: new Date(Date.now() - 900000).toISOString() },
      { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', content: 'Happy to. Start with the picture.', created_at: new Date(Date.now() - 890000).toISOString() },
      { id: '33333333-3333-4333-8333-333333333333', role: 'user', content: g.request.prompt, created_at: new Date(Date.now() - 800000).toISOString() },
      { id: '44444444-4444-4444-8444-444444444444', role: 'assistant', content: 'Generation submitted.', created_at: new Date(Date.now() - 799000).toISOString(), turn: { schema: 'xeno.chat.turn.v1', startedAt: Date.now() - 799000, steps: [{ id: 'gen-step-1', kind: 'generation', generationId: g.id, type: 'image', startedAt: Date.now() - 799000 }] } }] } }); }
    if (p === '/api/generations' && req.method === 'GET') { const type = u.searchParams.get('type'); const list = u.searchParams.get('conversationId') ? [] : type ? records[type] || [] : everything(); return json({ generations: u.searchParams.get('favorite') === 'true' ? list.filter((g) => g.favorite) : list }); }
    const one = /^\/api\/generations\/([0-9a-f-]{36})(\/favorite)?$/.exec(p);
    if (one) { const g = everything().find((x) => x.id === one[1]); if (!g) return json({ error: 'generation_not_found' }, 404);
      if (one[2] && req.method === 'POST') { g.favorite = (await body(req)).favorite === true; return json({ generation: g }); }
      if (req.method === 'DELETE') { for (const list of Object.values(records)) { const i = list.indexOf(g); if (i >= 0) list.splice(i, 1); } return json({ id: g.id, removed: true }); }
      if (req.method === 'GET') return json({ generation: g }); }
    if (p === '/api/enhancements/catalog') return json({ operations: [{ id: 'upscale', type: 'image', name: 'Upscale', options: { scale: { values: ['2x', '4x'], default: '2x' } }, maxRetailCredits: 4 }] });
    if (p === '/api/enhancements' && req.method === 'GET') return json({ enhancements: [...jobs.values()].filter((j) => j.type === u.searchParams.get('type')).map((j) => { if (j.state === 'running' && ++j.polls >= 2) { j.state = 'succeeded'; j.resultAssetId = 'img-b'; } return j; }).reverse() });
    if (p === '/api/enhancements' && req.method === 'POST') { const b = await body(req); const job = { id: uid(jobs.size + 1, 'ee'), type: b.type, state: 'running', operation: b.operation, options: b.options || {}, sourceGenerationId: b.sourceGenerationId, sourceAssetId: b.sourceAssetId, resultAssetId: null, error: null, createdAt: new Date().toISOString(), polls: 0 }; jobs.set(job.id, job); return json({ enhancement: job }, 202); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ success: false, error: 'refused by the test fixture' }, 403);
    return json({ success: true, data: [], items: [], conversations: [], messages: [], projects: [], pins: [], workspaces: [], assets: [], folders: [], tasks: [], notifications: [], settings: {}, total: 0 });
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
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); // the lift is off under reduced motion, which has its own check below
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.setRequestInterception(true);
page.on('request', (r) => { const u = new URL(r.url()); if (['data:', 'blob:', 'about:'].includes(u.protocol) || u.origin === base) r.continue(); else r.abort(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0; const failures = [];
const check = async (label, fn) => { try { await fn(); passed++; console.log('PASS', label); } catch (e) { failures.push(label); console.log('FAIL', label, '\n     ', String(e.message).split('\n')[0]); } };
let frameEl, frame;
const open = async (address, ready) => { await page.goto(base + address, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForSelector('#xw-chat-frame', { timeout: 60000 }); frameEl = await page.$('#xw-chat-frame'); frame = await frameEl.contentFrame(); await frame.waitForSelector(ready, { timeout: 150000 }); await wait(2500); };
const view = async (name) => { await page.click(`.topbar [data-gen-view="${name}"]`); await wait(1800); };
const here = () => page.evaluate(() => location.pathname);
const crumb = () => page.$eval('.crumbs', (e) => e.textContent.trim());
const at = async (selector, index = 0) => { const off = await frameEl.boundingBox(); const r = await frame.evaluate((s, i) => { const b = [...document.querySelectorAll(s)][i].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 110) }; }, selector, index); return { x: off.x + r.x, y: off.y + r.y }; };

try {
  await open('/workspace/studio/generate/image', '[data-generation-card]'); await view('feed');
  await check('Studio shows the feed, not the chat home', async () => { assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 4); assert.equal(await frame.evaluate(() => /What would you like to explore/.test(document.body.innerText)), false); });
  await check('the prompt box rests 12px above the bottom edge', async () => { assert.equal(await frame.evaluate(() => Math.round(innerHeight - (document.querySelector('[data-composer-controls]') || document.querySelector('[data-chat-composer-shell]')).getBoundingClientRect().bottom)), 12); });
  await check('a result that is not made is one line; a made one is a full card', async () => { assert.equal(await frame.$$eval('.sgf-line', (e) => e.length), 2); assert.equal(await frame.$$eval('.sgf-card:not(.sgf-line) .sgf-foot', (e) => e.length), 2); });
  await check('the cost is said in the box row', async () => { assert.match(await frame.$eval('.gen-cost', (e) => e.textContent), /10 credits/); });
  await check('Theater puts one result on the resting line', async () => { await view('theater'); assert.equal(await frame.evaluate(() => { const s = document.querySelector('.sgf'), c = s.querySelector('[data-focus]'); return Math.round(s.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom); }), 0); });
  await check('Grid uses the whole pane and scrolling a result into view does not move the page', async () => { await view('grid'); const m = await frame.evaluate(() => ({ grid: document.querySelector('.sgf').getBoundingClientRect().width, pane: innerWidth, gap: Math.round(innerHeight - (document.querySelector('[data-composer-controls]') || document.querySelector('[data-chat-composer-shell]')).getBoundingClientRect().bottom) })); assert.ok(m.grid > m.pane - 60); assert.equal(m.gap, 12); });
  const size = async (px) => { await page.$eval('.topbar [data-gen-size]', (s, v) => { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }, px); await wait(900); return frame.$eval('.sgg-tile:not([data-quiet])', (e) => Math.round(e.getBoundingClientRect().height)); };
  await check('the size control resizes the tiles', async () => { assert.equal(await size(320), 320); assert.equal(await size(200), 200); });
  await check('keys: arrows select, Enter opens Theater and returns', async () => { await frame.click('[data-chat-composer-shell] textarea'); await page.keyboard.press('ArrowRight'); await wait(700); assert.ok(await frame.$('.sgg-tile[data-active]')); await page.keyboard.press('Enter'); await wait(1300); assert.equal(await frame.$eval('.sgf', (e) => e.dataset.view), 'theater'); await page.keyboard.press('Enter'); await wait(1300); assert.equal(await frame.$eval('.sgf', (e) => e.dataset.view), 'grid'); });
  await check('a real drag parts the box into the model’s attachment boxes, at the box’s own height', async () => {
    const from = await at('.sgg-tile[draggable="true"] img'), box = await at('[data-chat-composer-shell]');
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 40, from.y + 40, { steps: 6 }); await page.mouse.move(box.x - 200, box.y, { steps: 12 }); await wait(700);
    const seen = await frame.evaluate(() => { const d = document.querySelector('.sgd'), s = document.querySelector('[data-chat-composer-shell]').getBoundingClientRect(); return { boxes: [...document.querySelectorAll('.sgd-box')].map((x) => x.textContent), same: d && Math.round(d.getBoundingClientRect().height) === Math.round(s.height), upload: /Drop files to attach/.test(document.body.innerText) }; });
    await page.mouse.up(); await wait(1300);
    assert.deepEqual(seen.boxes, ['Reference', 'Style']); assert.equal(seen.same, true); assert.equal(seen.upload, false);
    assert.equal(await frame.evaluate(() => document.querySelectorAll('[data-chat-composer-shell] img').length), 1);
  });
  await check('right-click offers the rest; a favorite is kept and can be filtered', async () => {
    const spot = await at('.sgg-tile[draggable="true"] img'); await page.mouse.click(spot.x, spot.y, { button: 'right' }); await wait(500);
    assert.deepEqual(await frame.$$eval('.sgm button', (e) => e.map((x) => x.textContent)), ['Animate', 'Make 3D', 'Enhance', 'Use prompt', 'Copy prompt', 'Copy link', 'Add to favorites', 'Remove']);
    await frame.$$eval('.sgm button', (e) => e.find((x) => x.textContent === 'Add to favorites').click()); await wait(1500);
    await page.click('.topbar [data-gen-fav]'); await wait(2200); assert.equal(await here(), '/workspace/studio/generate/image/favorites'); assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 1); assert.equal(await crumb(), 'Studio/Generate/Image/Favorites');
    await page.click('.topbar [data-gen-fav]'); await wait(2200); assert.equal(await here(), '/workspace/studio/generate/image'); assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 4);
  });
  await check('Favorites has its own address: a fresh load and Back both land on it', async () => {
    await open('/workspace/studio/generate/image/favorites', '[data-generation-card]'); assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 1); assert.equal(await frame.$eval('.sgf', (e) => e.dataset.view), 'grid'); assert.equal(await page.$eval('.topbar [data-gen-fav]', (e) => e.getAttribute('aria-pressed')), 'true');
    await page.click('.topbar [data-gen-fav]'); await wait(2000); await page.goBack(); await wait(2500); assert.equal(await here(), '/workspace/studio/generate/image/favorites'); assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 1);
  });
  await check('the sidebar Library opens the gallery of this type at its own address', async () => {
    await page.evaluate(() => [...document.querySelectorAll('#panel [data-item="Library"]')][0].click()); await wait(2500);
    assert.equal(await here(), '/workspace/studio/generate/image/library'); assert.equal(await crumb(), 'Studio/Generate/Image/Library'); assert.equal(await frame.$eval('.sgf', (e) => e.dataset.view), 'grid'); assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 4);
    await open('/workspace/studio/generate/image', '[data-generation-card]');
  });
  await check('Remove asks first, then the result leaves the history', async () => {
    await view('feed'); await frame.$eval('.sgf-line button[aria-label="Remove from your history"]', (e) => e.click()); await wait(800);
    assert.match(await frame.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].pop()?.innerText || ''), /stay in your Library/);
    await frame.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].pop(); [...d.querySelectorAll('button')].find((x) => /confirm|remove/i.test(x.textContent)).click(); }); await wait(1800);
    assert.equal(await frame.$$eval('[data-generation-card]', (e) => e.length), 3); assert.ok(writes.some((w) => w.startsWith('DELETE /api/generations/')));
  });
  await check('sending a result to another page does not reload the workspace', async () => {
    await view('grid'); await page.evaluate(() => { window.__alive = true; });
    const spot = await at('.sgg-tile[draggable="true"] img'); await page.mouse.click(spot.x, spot.y, { button: 'right' }); await wait(500);
    await frame.$$eval('.sgm button', (e) => e.find((x) => x.textContent === 'Enhance').click());
    let inAir = 0; for (let i = 0; i < 14; i++) { if (await page.evaluate(() => !!document.querySelector('.xw-carry')).catch(() => false)) inAir++; await wait(90); }
    await wait(2800);
    assert.ok(inAir > 0, 'nothing lifted'); assert.equal(await here(), '/workspace/studio/enhance/image'); assert.equal(await page.evaluate(() => window.__alive === true), true); assert.equal(await page.evaluate(() => !document.querySelector('.xw-carry')), true);
  });
  await check('with reduced motion nothing lifts, and the page still arrives', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await open('/workspace/studio/generate/image', '[data-generation-card]'); await view('grid');
    const spot = await at('.sgg-tile[draggable="true"] img'); await page.mouse.click(spot.x, spot.y, { button: 'right' }); await wait(500);
    await frame.$$eval('.sgm button', (e) => e.find((x) => x.textContent === 'Enhance').click());
    let inAir = 0; for (let i = 0; i < 10; i++) { if (await page.evaluate(() => !!document.querySelector('.xw-carry')).catch(() => false)) inAir++; await wait(90); }
    await page.waitForFunction(() => location.pathname === '/workspace/studio/enhance/image', { timeout: 30000 }); assert.equal(inAir, 0);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  });
  await open('/workspace/studio/enhance/image', '.sge .sgf, .sge .sgf-empty');
  await check('Enhance is its own section with its own address and the same views', async () => { assert.equal(await crumb(), 'Studio/Enhance/Image'); assert.deepEqual(await page.$$eval('.topbar [data-gen-view]', (e) => e.map((x) => x.dataset.genView)), ['feed', 'theater', 'grid']); });
  await check('an enhancement gets its own address, a before and after, and survives a refresh', async () => {
    await view('feed'); // the before and after is shown in Feed and Theater; Grid shows the result alone
    await frame.click('.sge-go'); await frame.waitForSelector('.sge .sgc', { timeout: 30000 }); await wait(1500);
    const address = await here(); assert.match(address, /^\/workspace\/studio\/enhance\/image\/e\/[0-9a-f-]{36}$/);
    const c = await frame.evaluate(() => { const r = document.querySelector('.sge .sgc').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; }), off = await frameEl.boundingBox();
    await page.mouse.move(off.x + c.x + c.w * 0.5, off.y + c.y); await page.mouse.down(); await page.mouse.move(off.x + c.x + c.w * 0.25, off.y + c.y, { steps: 8 }); await page.mouse.up(); await wait(300);
    assert.equal(await frame.$eval('.sge .sgc-line', (e) => e.style.left), '25%');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#xw-chat-frame'); frameEl = await page.$('#xw-chat-frame'); frame = await frameEl.contentFrame(); await frame.waitForSelector('.sge [data-generation-card][data-active]', { timeout: 150000 });
    assert.equal(await here(), address);
  });
  for (const old of ['/workspace/studio/enhance', '/workspace/studio/generate/enhance']) await check(`the older address ${old} still opens Enhance and is corrected`, async () => { await open(old, '.sge'); assert.equal(await here(), '/workspace/studio/enhance/image'); });
  await open('/workspace/studio/generate/video', '[data-generation-card]'); await view('feed');
  await check('video uses our own player, not the browser’s controls', async () => { assert.ok(await frame.$('.sgp')); assert.equal(await frame.$$eval('video[controls]', (e) => e.length), 0); });
  await open('/workspace/studio/generate/3d', '[data-chat-composer-shell]');
  await check('3D adds the Stage view; with no provider the page is whole and only the model selector says so', async () => { assert.ok(await page.$('.topbar [data-gen-view="stage"]')); assert.equal(await crumb(), 'Studio/Generate/3D'); const sel = await frame.$eval('[data-gen-trigger="model"]', (e) => [e.textContent, e.disabled]); assert.deepEqual(sel, ['No model available', true]); assert.equal(await frame.evaluate(() => /Not available yet|gateway_adapter/.test(document.body.innerText)), false); assert.ok(await frame.$('[data-chat-composer-shell] textarea')); });
  await page.goto(base + '/workspace/settings/appearance', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await check('Interactive motion is a setting, and its switch shows its state', async () => { await page.waitForSelector('[data-arg="interactiveMotion"]', { timeout: 30000 }); await wait(2500); const read = () => page.evaluate(() => [document.querySelector('[data-arg="interactiveMotion"]').getAttribute('aria-checked'), document.documentElement.dataset.imotion]); const press = async () => { await page.evaluate(() => document.querySelector('[data-arg="interactiveMotion"]').click()); await wait(700); }; assert.deepEqual(await read(), ['true', 'on']); await press(); assert.deepEqual(await read(), ['false', 'off']); await press(); assert.deepEqual(await read(), ['true', 'on']); });
  await open(`/workspace/apps/chat/${CHAT}`, '[data-chat-generation] .sgf-card');

  await check('in a normal chat, a generation shows the same card as Studio, with its result', async () => {
    const card = await frame.$eval('[data-chat-generation] .sgf-card', (e) => ({ img: !!e.querySelector('img'), prompt: e.querySelector('.sgf-foot-prompt')?.textContent, acts: [...e.querySelectorAll('.sgf-foot-acts button')].map((b) => b.getAttribute('aria-label')) }));
    assert.equal(card.img, true); assert.equal(card.prompt, 'A lattice of glass polyhedra'); assert.deepEqual(card.acts.slice(1), ['Use this prompt', 'Download', 'Copy link']); assert.match(card.acts[0], /favorites/);
    assert.equal(await frame.evaluate(() => /Generation submitted/.test(document.body.innerText)), false, 'no filler line beside the card');
    assert.equal(await frame.evaluate(() => document.querySelectorAll('.chat-q[data-generation-id]').length), 0, 'the older status box is gone from the chat');
  });
  await check('in a chat: right-click offers the menu, and "Use in this chat" attaches the picture', async () => {
    const spot = await at('[data-chat-generation] .sgf-card img'); await page.mouse.click(spot.x, spot.y, { button: 'right' }); await wait(500);
    const labels = await frame.$$eval('.sgm button', (e) => e.map((x) => x.textContent)); assert.deepEqual(labels.slice(0, 7), ['Use in this chat', 'Animate', 'Make 3D', 'Enhance', 'Use prompt', 'Copy prompt', 'Copy link']);
    await frame.$$eval('.sgm button', (e) => e.find((x) => x.textContent === 'Use in this chat').click()); await wait(1500);
    assert.equal(await frame.evaluate(() => document.querySelectorAll('[data-chat-composer-shell] img').length), 1);
  });
  await check('in a chat: "Use prompt" puts the prompt in the box and switches the box to that mode', async () => {
    assert.equal(await frame.$('[data-gen-trigger="model"]'), null, 'the box starts in chat mode');
    await frame.$eval('[data-chat-generation] button[aria-label="Use this prompt"]', (e) => e.click()); await wait(1200);
    assert.equal(await frame.$eval('[data-chat-composer-shell] textarea', (e) => e.value), 'A lattice of glass polyhedra'); assert.ok(await frame.$('[data-gen-trigger="model"]'), 'the image controls are shown');
  });
  await open(`/workspace/apps/chat/${CHAT}`, '[data-chat-generation] .sgf-card');
  await check('in a chat: a real drag of the result onto the box attaches it', async () => {
    const from = await at('[data-chat-generation] .sgf-card img'), box = await at('[data-chat-composer-shell]');
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 30, from.y + 30, { steps: 6 }); await page.mouse.move(box.x, box.y, { steps: 14 }); await wait(400); await page.mouse.up(); await wait(1800);
    assert.equal(await frame.evaluate(() => document.querySelectorAll('[data-chat-composer-shell] img').length), 1); assert.equal(await frame.evaluate(() => /Drop files to attach/.test(document.body.innerText)), false);
  });
  await open(`/workspace/apps/chat/${CHAT}`, '[data-chat-composer-shell] textarea');
  await check('the @ list: Up and Down travel it (passing over types with no model), Enter takes the lit one', async () => {
    await frame.click('[data-chat-composer-shell] textarea'); await page.keyboard.type('@'); await wait(900);
    const lit = () => page.evaluate(() => { const m = document.getElementById('apmenu'); return m?.classList.contains('show') ? (m.querySelector('.row.on')?.textContent || '').replace(/@.*/, '') : 'closed'; });
    assert.deepEqual(await page.$$eval('#apmenu .row', (e) => e.map((r) => r.textContent.replace(/@.*|unavailable.*/, '') + (r.getAttribute('aria-disabled') === 'true' ? ':off' : ''))), ['Image', 'Video', 'Audio:off', '3D:off'], 'types with no model are greyed out');
    assert.equal(await lit(), 'Image'); await page.keyboard.press('ArrowDown'); await wait(500); assert.equal(await lit(), 'Video');
    await page.keyboard.press('ArrowDown'); await wait(500); assert.equal(await lit(), 'Image', 'audio and 3D have no model here, so it wraps');
    await page.keyboard.press('ArrowUp'); await wait(500); assert.equal(await lit(), 'Video');
    await page.keyboard.press('Enter'); await wait(900); assert.equal(await frame.$eval('[data-chat-composer-shell] textarea', (e) => e.placeholder), 'Describe the video');
  });
  await check('no page error anywhere in the run', async () => { assert.deepEqual(pageErrors, []); });
} finally { await browser.close(); await server.close(); process.chdir(previous); }
console.log(`\nstudio-feed-browser: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
