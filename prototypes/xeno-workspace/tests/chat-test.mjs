// The real chat inside the workspace (platform-chat.js): the frame, the sidebar's real conversations, and the address.
// The chat itself is the platform's React app; here a tiny stand-in page is served at /overview/…, which speaks the
// same messages (src/lib/workspaceEmbed.ts) and answers the same in-page navigation, so this suite is about the
// workspace's side of the contract and runs without building the app.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5191, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const A = '00000001-0000-4000-8000-000000000000', B = '00000002-0000-4000-8000-000000000000', C = '00000003-0000-4000-8000-000000000000', D = '00000004-0000-4000-8000-000000000000', PJ = '0000000a-0000-4000-8000-000000000000';
const db = { convs: [], down: false, lists: 0 };
const reset = () => { db.convs = [{ id: A, title: 'Plan the launch week', updated_at: iso(1), last_message_at: iso(1), project_id: null }, { id: B, title: '', updated_at: iso(30), last_message_at: iso(30), project_id: null }, { id: C, title: 'Budget <b>questions</b>', updated_at: iso(400), last_message_at: iso(400), project_id: PJ }]; db.down = false; db.lists = 0; };
// the stand-in chat: it says where it is on load and after every in-page navigation, like the real one
const CHAT = `<!doctype html><html><body><script>
  window.__born = Math.random(); window.__log = [];
  const say = () => { window.__log.push(location.pathname); parent.postMessage({ source: 'xeno-chat', type: 'location', path: location.pathname, title: 'Chat' }, location.origin); };
  addEventListener('popstate', say); say();
  window.goTo = (p) => { history.pushState({}, '', p); say(); };
</script></body></html>`;
async function open(hash = '#/overview/p/chat') {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: CHAT });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/chat/conversations') { db.lists++; return db.down ? json({ success: false, error: 'Internal server error' }, 500) : json({ success: true, conversations: db.convs, total: db.convs.length + (db.extra || 0) }); }
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [{ id: PJ, name: 'Finance', icon: null }] });
    const body = { '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/library/assets': { success: true, items: [] } }[u.pathname];
    return body ? json(body) : json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1500);
  return { p, errs };
}
const view = (p) => p.evaluate(() => { const f = document.getElementById('xw-chat-frame'), slot = document.querySelector('#main .live-chat-host[data-chat-frame]'); const fr = f?.getBoundingClientRect(), sr = slot?.getBoundingClientRect();
  return { state: window.XENO_CHAT.state(), hash: location.hash, frames: document.querySelectorAll('iframe#xw-chat-frame').length, on: !!f && f.classList.contains('on'), path: f ? f.contentWindow.location.pathname : null, born: f ? f.contentWindow.__born : null, log: f ? f.contentWindow.__log.slice() : [],
    over: !!(fr && sr) && Math.abs(fr.left - sr.left) < 1 && Math.abs(fr.top - sr.top) < 1 && Math.abs(fr.width - sr.width) < 1 && Math.abs(fr.height - sr.height) < 1 && sr.width > 400 && sr.height > 300,
    rows: [...document.querySelectorAll('#panel [data-chat-live]')].map((r) => ({ id: r.dataset.chatLive, t: r.textContent.trim(), cur: r.getAttribute('aria-current') === 'true' })), groups: [...document.querySelectorAll('#panel .grp')].map((g) => g.textContent.trim()),
    panel: document.querySelector('#panel').innerText, crumbs: (document.querySelector('#main .crumbs')?.innerText || '').replace(/\s+/g, ' ').trim(), still: !!document.querySelector('#main .live-chat'), note: getComputedStyle(document.getElementById('xp-note')).display, html: document.querySelector('#panel').innerHTML }; });
try {
  reset();
  { const { p, errs } = await open(); let v = await view(p);
    ok(v.frames === 1 && v.on && v.path === '/overview/chat/llm' && v.over && !v.still, `the chat page shows the real chat, placed exactly over its slot, not the picture (${v.path}, over ${v.over})`);
    ok(v.rows.length === 3 && v.rows.find((r) => r.id === A).t === 'Plan the launch week' && v.rows.find((r) => r.id === B).t === 'New chat', 'the sidebar lists the person’s conversations; one with no title yet reads “New chat”');
    ok(v.groups.join('|') === 'Today|Yesterday' && /Finance/.test(v.panel) && v.rows.some((r) => r.id === C), `conversations are grouped by day, and a project’s conversation sits under its project (${v.groups.join('|')})`);
    ok(!/each mode keeps its own/.test(v.panel) && !/Weekly planning template|YC application draft/.test(v.panel) && !/Pinned/.test(v.panel), 'no sample chats, no Pinned section the platform cannot back, and no claim that each mode keeps its own');
    ok(!v.html.includes('<b>questions</b>') && /Budget &lt;b&gt;questions/.test(v.html), 'a title is shown as text, never as markup');
    ok(v.note === 'none' && /New chat/.test(v.crumbs), `the “sample data” note is not shown on the live chat, and the path reads New chat (${v.crumbs})`);
    // open a conversation from the sidebar
    const born = v.born; await p.click(`#panel [data-chat-live="${A}"]`); await wait(500); v = await view(p);
    ok(v.path === `/overview/c/${A}` && v.born === born, 'choosing a conversation moves the running chat to it, without reloading the chat');
    ok(v.hash === `#/overview/p/chat/${A}` && /Plan the launch week$/.test(v.crumbs) && v.rows.find((r) => r.id === A).cur && v.rows.filter((r) => r.cur).length === 1, `the address carries the conversation, the path names it, and its row is the current one (${v.hash} · ${v.crumbs})`);
    // the chat moves by itself (a new conversation is created inside it)
    db.convs.unshift({ id: D, title: 'Started in the chat', updated_at: iso(0), last_message_at: iso(0), project_id: null }); const lists = db.lists;
    await p.evaluate((D) => document.getElementById('xw-chat-frame').contentWindow.goTo('/overview/chat/llm/' + D), D); await wait(1300); v = await view(p);
    ok(v.hash === `#/overview/p/chat/${D}` && db.lists > lists && v.rows.find((r) => r.id === D)?.cur && v.rows.filter((r) => r.cur).length === 1 && /Started in the chat$/.test(v.crumbs), 'when the chat starts a conversation itself, the address follows and the new conversation appears in the sidebar');
    // only the chat frame may move the workspace
    await p.evaluate((A) => window.postMessage({ source: 'xeno-chat', type: 'location', path: '/overview/c/' + A }, location.origin), A); await wait(300); v = await view(p);
    ok(v.hash === `#/overview/p/chat/${D}`, 'a message that does not come from the chat frame is ignored');
    // leaving and coming back keeps the same running chat
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.__draft = 'half a sentence'; window.XW.go('global', { global: 'library' }); }); await wait(600); v = await view(p);
    ok(!v.on && v.frames === 1 && v.note !== 'none', 'on another page the chat is hidden, not removed');
    await p.goBack(); await wait(700); v = await view(p);
    ok(v.on && v.over && v.born === born && v.path === `/overview/chat/llm/${D}` && await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__draft === 'half a sentence'), 'Back returns to the same running chat, with what was in it');
    // New chat
    await p.click('#panel [data-newchat]'); await wait(500); v = await view(p);
    ok(v.path === '/overview/chat/llm' && v.hash === '#/overview/p/chat' && v.born === born && !v.rows.some((r) => r.cur), 'New chat opens a blank chat in the same running chat, and no row is current');
    // Back steps through conversations once each
    await p.goBack(); await wait(600); v = await view(p);
    ok(v.path === `/overview/chat/llm/${D}` && v.hash === `#/overview/p/chat/${D}`, `Back goes to the conversation before, in one step (${v.path} · ${v.hash})`);
    // the sidebar stays put when the frame's slot resizes
    await p.setViewport({ width: 1100, height: 700 }); await wait(400); v = await view(p);
    ok(v.over, 'the chat follows its slot when the window changes size');
    ok(errs.length === 0, 'no page errors (' + errs.slice(0, 2).join(' | ') + ')');
    await p.close(); }
  { // a link to a conversation, opened fresh
    reset(); const { p } = await open(`#/overview/p/chat/${A}`); const v = await view(p);
    ok(v.on && v.path === `/overview/c/${A}` && v.rows.find((r) => r.id === A)?.cur && /Plan the launch week$/.test(v.crumbs) && v.log.length === 1, `a link to a conversation opens that conversation directly (${v.path}, loads ${v.log.length})`);
    await p.close(); }
  { // from another page: the chat is not loaded until it is opened
    reset(); const { p } = await open('#/overview'); let v = await p.evaluate(() => ({ frames: document.querySelectorAll('iframe#xw-chat-frame').length }));
    ok(v.frames === 0, 'the chat is not loaded until the chat page is opened');
    await p.close(); }
  { // the list cannot be loaded
    reset(); db.down = true; const { p } = await open(); let v = await view(p);
    ok(/couldn’t be loaded/.test(v.panel) && v.rows.length === 0 && v.on, 'if the list cannot be loaded the sidebar says so, and the chat itself still opens');
    db.down = false; await p.click('#panel [data-chat-retry]'); await wait(700); v = await view(p);
    ok(v.rows.length === 3 && !/couldn’t be loaded/.test(v.panel), 'Try again loads it');
    await p.close(); }
  { // none yet, and more than the sidebar holds
    reset(); db.convs = []; let { p } = await open(); let v = await view(p);
    ok(/No chats yet/.test(v.panel) && v.on, 'with no conversations the sidebar says so');
    await p.close();
    reset(); db.extra = 40; ({ p } = await open()); v = await view(p); db.extra = 0;
    ok(/40 older chats/.test(v.panel), 'when there are more conversations than the sidebar holds, it says how many and where they are');
    await p.close(); }
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
