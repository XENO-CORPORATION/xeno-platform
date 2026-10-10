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
// The day a conversation that old falls on, by the sidebar's own rule (midnight to midnight, local time). The
// expected groups are worked out from the clock: "one hour ago" is Yesterday for the first hour of a day, and a
// check that assumed Today failed every night just after midnight (2026-10-10).
const dayOf = (h) => { const t = Date.now() - h * 3600000, d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = d0.getTime(), DAY = 86400000; return t >= start ? 'Today' : t >= start - DAY ? 'Yesterday' : t >= start - 7 * DAY ? 'Previous 7 days' : t >= start - 30 * DAY ? 'Previous 30 days' : 'Earlier'; };
const A = '00000001-0000-4000-8000-000000000000', B = '00000002-0000-4000-8000-000000000000', C = '00000003-0000-4000-8000-000000000000', D = '00000004-0000-4000-8000-000000000000', PJ = '0000000a-0000-4000-8000-000000000000';
const db = { convs: [], down: false, lists: 0, writes: [], refuse: false };
const reset = () => { db.convs = [{ id: A, title: 'Plan the launch week', updated_at: iso(1), last_message_at: iso(1), project_id: null }, { id: B, title: '', updated_at: iso(30), last_message_at: iso(30), project_id: null }, { id: C, title: 'Budget <b>questions</b>', updated_at: iso(400), last_message_at: iso(400), project_id: PJ }]; db.down = false; db.lists = 0; db.writes = []; db.refuse = false; };
// the stand-in chat: it says where it is on load and after every in-page navigation, like the real one
const CHAT = `<!doctype html><html><body><div class="chat-themed"><div class="chat-top-bar"><button aria-label="Share conversation" onclick="window.__shared=(window.__shared||0)+1">Share</button><button aria-label="Copy Session Transcript" onclick="if(!window.__mute)parent.postMessage({source:'xeno-chat',type:'transcript',text:'# Transcript\\nHello there'},location.origin)">T</button></div><button aria-label="Open conversation history">H</button>
  <div class="rounded-2xl" data-chat-composer-shell style="border-radius:16px;background:#2a2a2a"><div><div class="w-full"><div class="chat-input-container"><textarea></textarea></div></div></div></div>
  <div class="flex items-center" style="position:fixed;right:40px;bottom:20px;display:flex;align-items:center;gap:12px">
    <div data-composer-model-group style="display:flex;align-items:center;height:26px"><button data-chat-model-trigger class="xm-model apx" style="min-width:120px"><span class="ap-txt" data-part="model"><span class="ap-model">Model A</span></span></button><span id="vr" style="width:1px;height:11px;margin:0 1px;background:#555"></span><div data-effort-control id="eff" style="display:flex;align-items:center"><button data-effort-trigger style="height:26px;padding:0 5px;border:0;background:none"><span data-effort-current style="padding:3px 7px;background:#333;border-radius:4px;font-size:10.5px">Medium</span></button></div></div>
    <style>.qbar{padding:11px 12px}</style><button class="qbar" id="qbar" style="position:fixed;left:0;top:0">Queued</button>
    <button aria-label="Start voice input" style="width:24px;height:24px;padding:0;border:0">m</button>
    <button data-composer-send-button aria-label="Send message" disabled>send</button></div></div><script>
  const group = document.querySelector('[data-composer-model-group]'), vr = document.getElementById('vr'), eff = document.getElementById('eff'); vr.remove(); eff.remove();
  window.__effort = (on) => { if (on) group.append(vr, eff); else { vr.remove(); eff.remove(); } };
  window.__picks = []; window.__closed = 0;
  const MODELS = [['m-a', 'Model A', 'Fast and cheap.', 128000, false], ['m-b', 'Model B', '', 0, true], ['m-c', 'Model <i>C</i>', 'Careful.', 1000000, false], ['m-d', 'Model D', '', 0, false], ['m-e', 'Model E', 'The fifth.', 200000, false]];
  document.querySelector('[data-chat-model-trigger]').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); parent.postMessage({ source: 'xeno-chat', type: 'model-menu', rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, selected: window.__sel || 'm-a', models: (window.__none ? [] : window.__many ? MODELS.concat(Array.from({ length: 20 }, (_, n) => ['x-' + n, 'Extra ' + n, '', 0, false])) : MODELS).map(([id, name, description, contextWindow, ownKey]) => ({ id, name, description, contextWindow, ownKey })) }, location.origin); });
  addEventListener('message', (e) => { if (e.source !== parent || !e.data || e.data.source !== 'xeno-workspace') return; if (e.data.type === 'pick-model') { window.__picks.push(e.data.id); window.__sel = e.data.id; } if (e.data.type === 'model-menu-closed') window.__closed++; if (e.data.type === 'area' || e.data.type === 'area-settings') window.__areaTold.push(e.data.type === 'area' ? 'area:' + e.data.area : 'settings:' + JSON.stringify(e.data.areas)); if (/^viewer-/.test(e.data.type)) window.__viewer.push(e.data.type); if (e.data.type === 'pick-effort') window.__efforts.push(e.data.id); if (e.data.type === 'effort-menu-closed') window.__effClosed++; });
  window.__efforts = []; window.__effClosed = 0; window.__viewer = []; window.__areaTold = [];
  window.__tellViewer = (open, name, canExport) => parent.postMessage({ source: 'xeno-chat', type: 'viewer', open, name, canExport }, location.origin);
  window.__askEffort = (selected) => parent.postMessage({ source: 'xeno-chat', type: 'effort-menu', rect: { left: 300, top: 400, right: 360, bottom: 426, width: 60, height: 26 }, selected, levels: [{ id: 'off', label: 'Off', title: 'No thinking' }, { id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }, location.origin);
  document.querySelector('textarea').addEventListener('input', (e) => { document.querySelector('[data-composer-send-button]').disabled = !e.target.value.trim(); });
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
    if (u.pathname === '/api/chat/conversations') { db.lists++; const want = u.searchParams.get('area'); (db.asked = db.asked || []).push(want); const rows = want === null ? db.convs : db.convs.filter((c) => (want === 'none' ? !c.area : c.area === want)); return db.down ? json({ success: false, error: 'Internal server error' }, 500) : json({ success: true, conversations: rows, total: rows.length + (db.extra || 0) }); }
    const one = u.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/);
    if (one && q.method() === 'PUT') { db.writes.push(['PUT', one[1], q.postData()]); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500); const c = db.convs.find((x) => x.id === one[1]); if (!c) return json({ success: false, error: 'Not found' }, 404); { const sent = JSON.parse(q.postData()); if ('title' in sent) c.title = sent.title; if ('area' in sent) c.area = sent.area; } return json({ success: true, conversation: c }); }
    if (one && q.method() === 'DELETE') { db.writes.push(['DELETE', one[1]]); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500); db.convs = db.convs.filter((x) => x.id !== one[1]); return json({ success: true }); }
    if (u.pathname === '/api/user-data/settings' && q.method() === 'GET') return json({ success: true, settings: db.settings || {} });
    if (u.pathname === '/api/user-data/settings' && q.method() === 'PATCH') { const body = JSON.parse(q.postData()); db.writes.push(['PATCH', 'settings', q.postData()]); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500); db.settings = db.settings || {}; for (const up of body.updates || []) { const seg = up.path.split('.'); let c = db.settings; for (const s of seg.slice(0, -1)) c = c[s] = c[s] || {}; c[seg.at(-1)] = up.value; } return json({ success: true, settings: db.settings }); }
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [{ id: PJ, name: 'Finance', icon: null, updated_at: iso(5) }] });
    const body = { '/api/workspace/needs': { success: true, items: [] }, '/api/tasks': { success: true, tasks: [] }, '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/library/assets': { success: true, items: [] } }[u.pathname];
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
    ok(v.groups.join('|') === [...new Set([dayOf(1), dayOf(30)])].join('|') && /Finance/.test(v.panel) && v.rows.some((r) => r.id === C), `conversations are grouped by day, and a project’s conversation sits under its project (${v.groups.join('|')})`);
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
  { // the composer is the one designed in this workspace, on the real chat
    reset(); const { p } = await open(); await wait(300);
    const dressed = () => p.evaluate(() => { const d = document.getElementById('xw-chat-frame').contentDocument, cs = (s) => { const el = d.querySelector(s); return el ? d.defaultView.getComputedStyle(el) : null; };
      const colour = (doc, v) => { const pr = doc.createElement('i'); doc.body.appendChild(pr); pr.style.color = v; const c = doc.defaultView.getComputedStyle(pr).color; pr.remove(); return c; };
      return { radius: cs('[data-chat-composer-shell]').borderRadius, bg: cs('[data-chat-composer-shell]').backgroundColor, wantBg: colour(d, 'var(--n23)'), pageBg: colour(document, 'var(--n23)'), bar: cs('.chat-top-bar').display, opener: cs('[aria-label="Open conversation history"]').display, font: cs('textarea').fontSize, send: cs('[data-composer-send-button]').backgroundColor, ready: colour(d, 'var(--n233)'), idle: colour(d, 'var(--w100)') }; });
    // the loading moment: the XENO mark loader stands in until the chat is on the page, then both cross-fade
    // The loader stays still when the system asks for reduced motion, so the test says which it wants: this
    // check failed on a machine whose Windows animations were off (2026-10-10).
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const ld = await p.evaluate(async () => { const f2 = document.getElementById('xw-chat-frame'), l = document.getElementById('xw-chat-loading'); const now = { made: !!l, ready: f2.classList.contains('ready'), shown: !!l?.classList.contains('show'), frameOp: getComputedStyle(f2).opacity, parts: window.XENO_MARK_LOADER ? window.XENO_MARK_LOADER.particles(88) : 0 };
      // a chat that has to load again: the frame is cleared and the loader shows at once, drawing
      window.XENO_CHAT.state(); f2.classList.remove('ready'); const host = document.createElement('div'); const stop = window.XENO_MARK_LOADER.mount(host, { size: 88, label: 'Loading chat' }); document.body.appendChild(host); for (let i = 0; i < 20 && !(Number(host.querySelector('[data-mark-loader]').dataset.frames) > 3); i++) await new Promise((r) => setTimeout(r, 100));   /* a busy machine gives frames late: wait for them (up to 2 s) instead of counting in a fixed 200 ms */ const drawing = Number(host.querySelector('[data-mark-loader]').dataset.frames) > 3, label = host.querySelector('[data-mark-loader]').getAttribute('aria-label'); stop(); const gone = !host.querySelector('[data-mark-loader]'); host.remove(); f2.classList.add('ready');
      return { ...now, drawing, label, gone }; });
    const rdy = await p.evaluate(() => { const d = document.getElementById('xw-chat-frame').contentDocument, shell = d.querySelector('[data-chat-composer-shell]'); const before = window.XENO_CHAT.state().ready; shell.removeAttribute('data-chat-composer-shell'); const bar = d.createElement('div'); bar.className = 'xeno chat-themed route-loading'; d.body.appendChild(bar); const loadingOnly = window.XENO_CHAT.state().ready; const hidden = d.defaultView.getComputedStyle(bar).display === 'none'; bar.remove(); shell.setAttribute('data-chat-composer-shell', ''); return { before, loadingOnly, hidden, after: window.XENO_CHAT.state().ready }; });
    ok(rdy.before && !rdy.loadingOnly && rdy.after, 'the chat is ready when its input box is on the page; the app’s page-loading bar alone is not the chat (' + JSON.stringify(rdy) + ')');
    ok(rdy.hidden, 'the app’s page-loading bar is not shown inside the workspace');
    ok(ld.made && ld.ready && !ld.shown && ld.frameOp === '1', 'once the chat is on the page the frame is shown and the loader is not (' + JSON.stringify({ ready: ld.ready, shown: ld.shown, op: ld.frameOp }) + ')');
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const calm = await p.evaluate(async () => { const host = document.createElement('div'); const stop = window.XENO_MARK_LOADER.mount(host, { size: 88, label: 'Loading chat' }); document.body.appendChild(host); await new Promise((r) => setTimeout(r, 200)); const frames = Number(host.querySelector('[data-mark-loader]').dataset.frames); stop(); host.remove(); return frames; });
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    ok(calm === 1, 'with reduced motion asked for, the loader draws the mark once and does not move (' + calm + ' frame)');
    ok(ld.parts > 300 && ld.drawing && ld.label === 'Loading chat' && ld.gone, 'the loader is the XENO mark in particles (' + ld.parts + '), it draws, it is named, and stopping it removes it');
    let c = await dressed();
    ok(await p.evaluate(() => { const d = document.getElementById('xw-chat-frame').contentDocument; return d.defaultView.getComputedStyle(d.getElementById('qbar')).paddingTop; }) === '11px', 'the chat’s own components keep their own spacing: the picture’s element-wide resets are not handed over (the queue’s header bar keeps its padding)');
    ok(await p.evaluate(() => { const s = document.getElementById('xw-chat-frame').contentDocument.getElementById('xw-composer').textContent; return !!document.getElementById('live-chat-css') && !s.includes('.chat-themed .prose') && s.includes('.chat-input-container'); }), 'the picture’s frozen copy of the chat’s stylesheet is not handed back to the chat (no paragraph margins from it), while the composer’s own rules are');
    ok(await p.evaluate(() => !document.getElementById('xw-chat-frame').contentDocument.getElementById('xw-composer').textContent.includes('.chat-themed .prose')), 'no prose rule reaches the chat: the answer keeps the chat’s own paragraph spacing under “Worked for”');
    ok(await p.evaluate(() => { const s = document.getElementById('xw-chat-frame').contentDocument.getElementById('xw-composer').textContent; return s.includes('.chat-themed div.absolute:has(> div > [data-conversation-composer-frame])::before') && s.includes('--panel:'); }), 'the input box’s column has the panel’s surface behind it, so the thread does not show through (the rule and its colour reach the chat)');
    ok(c.radius === '6px' && c.bg === c.wantBg && c.bg === c.pageBg && c.font === '13px', 'the real chat’s input box takes this workspace’s design: the 6px box in this page’s own colour, 13px text (' + c.radius + ' ' + c.bg + ' ' + c.font + ')');
    ok(c.bar === 'none' && c.opener === 'none', 'the chat’s own top bar and its history opener are not shown: this page has the path, Share and the history');
    ok(c.send === c.idle, 'with nothing typed the send button is the quiet one');
    await p.evaluate(() => { const d = document.getElementById('xw-chat-frame').contentDocument, t = d.querySelector('textarea'); t.value = 'hello'; t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true })); }); await wait(350); c = await dressed();   // the button's colour glides for 160 ms
    ok(c.send === c.ready && c.ready !== c.idle, 'once there is something to send it is the bright one, from the chat’s real state');
    // the control row: one rhythm, with an effort control or without one
    const rhythm = () => p.evaluate(() => { const d = document.getElementById('xw-chat-frame').contentDocument, r = (s) => d.querySelector(s)?.getBoundingClientRect(); const name = r('.ap-model'), trig = r('[data-chat-model-trigger]'), pill = r('[data-effort-current]') || null, mic = r('[aria-label="Start voice input"]'), send = r('[data-composer-send-button]'); const n = (x) => Math.round(x * 10) / 10;
      return { lastToMic: n(mic.left - (pill ? pill.right : name.right)), micToSend: n(send.left - mic.right), slack: n(trig.width - (name.width + 6)), nameToPill: pill ? n(pill.left - name.right) : null }; });
    let row = await rhythm();
    ok(row.micToSend === 7 && row.lastToMic === 7 && row.slack <= 0.5, 'a model with no effort control: the name ends 7px from the mic, the same as mic to send, and the control is only as wide as the name (' + JSON.stringify(row) + ')');
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__effort(true)); row = await rhythm();
    ok(row.micToSend === 7 && row.lastToMic === 7 && row.nameToPill > 8 && row.nameToPill < 20, 'a model with an effort control: the pill ends 7px from the mic, and sits right after the name with no dead space (' + JSON.stringify(row) + ')');
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__effort(false));
    const before = c.bg; await p.evaluate(() => { localStorage.setItem('xeno_platform_theme', 'light'); localStorage.setItem('xeno_platform_theme_brightness', '100'); dispatchEvent(new CustomEvent('xeno_platform_theme_change')); }); await wait(300); c = await dressed();
    ok(c.bg !== before && c.bg === c.pageBg, 'when the theme changes the input box changes with the page (' + before + ' → ' + c.bg + ')');
    await p.evaluate(() => { localStorage.setItem('xeno_platform_theme', 'dark'); localStorage.setItem('xeno_platform_theme_brightness', '0'); dispatchEvent(new CustomEvent('xeno_platform_theme_change')); }); await wait(200);
    await p.evaluate(() => document.querySelector('#main .topbar > .ib[aria-label="Share"]').click()); await wait(200);
    ok(await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__shared === 1 && getComputedStyle(document.querySelector('#main .topbar > .ib[aria-label="More"]')).display === 'none'), 'Share in the top bar presses the chat’s own Share; the sample More is not shown');
    // Copy transcript: in the middle of this page's top bar, with the chat's own transcript
    // a headless browser refuses the real clipboard, so this page's clipboard is a box the test can read; `__clipFail` makes it refuse
    await p.evaluate(() => { let held = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (v) => { if (window.__clipFail) throw new Error('denied'); held = String(v); }, readText: async () => held } }); });
    const mid = () => p.evaluate(() => { const b = document.querySelector('#main .topbar [data-chat-transcript]'), bar = document.querySelector('#main .topbar'); if (!b) return null; const r = b.getBoundingClientRect(), tr = bar.getBoundingClientRect(); return { off: Math.abs((r.left + r.width / 2) - (tr.left + tr.width / 2)), text: b.innerText.trim(), done: b.classList.contains('done') }; });
    let tb = await mid();
    ok(!!tb && tb.off < 1.5 && tb.text === 'Copy transcript', 'Copy transcript sits in the middle of the top bar (' + JSON.stringify(tb) + ')');
    await p.click('#main .topbar [data-chat-transcript]'); await wait(400); tb = await mid();
    ok(await p.evaluate(() => navigator.clipboard.readText()) === '# Transcript\nHello there' && tb.text === 'Copied' && tb.done, 'pressing it puts the chat’s own transcript on the clipboard and says Copied');
    await wait(2300); tb = await mid(); ok(tb.text === 'Copy transcript' && !tb.done, 'and it goes back to its label');
    await p.evaluate(() => navigator.clipboard.writeText('untouched')); await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.postMessage && window.postMessage({ source: 'xeno-chat', type: 'transcript', text: 'forged' }, location.origin)); await wait(200);
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.eval("parent.postMessage({ source: 'xeno-chat', type: 'transcript', text: 'unasked' }, location.origin)"); }); await wait(200);
    ok(await p.evaluate(() => navigator.clipboard.readText()) === 'untouched', 'nothing reaches the clipboard unless Copy transcript was pressed here, whoever sends a transcript');
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.__mute = true; }); await p.click('#main .topbar [data-chat-transcript]'); await wait(4300);
    ok(/couldn’t be copied/.test(await p.evaluate(() => document.querySelector('.toast')?.textContent || '')) && await p.evaluate(() => navigator.clipboard.readText()) === 'untouched', 'if the chat does not answer, the page says the transcript couldn’t be copied');
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.__mute = false; });
    await p.evaluate(() => { window.__clipFail = true; document.querySelector('.toast')?.classList.remove('on'); }); await p.click('#main .topbar [data-chat-transcript]'); await wait(400); tb = await mid();
    ok(/blocked the clipboard/.test(await p.evaluate(() => document.querySelector('.toast')?.textContent || '')) && tb.text === 'Copy transcript' && !tb.done, 'if the browser refuses the clipboard, the page says so and does not claim Copied');
    await p.evaluate(() => { window.__clipFail = false; });
    const pick = async (label) => { await p.evaluate((A) => document.querySelector(`#panel [data-chat-live="${A}"] [data-more]`).click(), A); await wait(350); const hit = await p.evaluate((label) => { const el = [...document.querySelectorAll('button, [role=menuitem]')].find((n) => n.offsetParent && n.textContent.trim().startsWith(label) && !n.closest('#panel')); if (el) el.click(); return !!el; }, label); await wait(450); return hit; };
    const sure = () => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((n) => n.offsetParent && /^Delete chat/.test(n.textContent.trim())); if (b) b.click(); return !!b; });
    const picked = await pick('Rename'); await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find((n) => n.offsetParent && n.value === 'Plan the launch week'); if (i) { i.value = 'Launch plan'; i.dispatchEvent(new Event('input', { bubbles: true })); } }); await p.click('[data-xd-submit]').catch(() => {}); await wait(700);
    let v = await view(p);
    ok(picked && JSON.stringify(db.writes.at(-1)) === JSON.stringify(['PUT', A, JSON.stringify({ title: 'Launch plan' })]) && v.rows.find((r) => r.id === A)?.t === 'Launch plan', 'Rename, from the row’s menu, saves the new name to the chat and the sidebar shows it (' + JSON.stringify(db.writes.at(-1)) + ')');
    db.refuse = true; await pick('Delete'); await sure(); await wait(600); v = await view(p);
    ok(v.rows.some((r) => r.id === A) && /couldn’t be deleted|server error/i.test(await p.evaluate(() => document.querySelector('.toast')?.textContent || '')), 'a delete the server refuses changes nothing and says so');
    db.refuse = false; await p.click(`#panel [data-chat-live="${A}"]`); await wait(400); await pick('Delete'); await sure(); await wait(800); v = await view(p);
    ok(!v.rows.some((r) => r.id === A) && db.writes.at(-1)[0] === 'DELETE' && v.path === '/overview/chat/llm' && v.hash === '#/overview/p/chat', 'deleting the open chat removes it and leaves a new chat open (' + v.path + ' ' + v.hash + ')');
    await p.close(); }
  { // the model menu is the one designed in this workspace, with the chat's real list
    reset(); const { p } = await open(); await wait(300);
    const press = () => p.evaluate(() => document.getElementById('xw-chat-frame').contentDocument.querySelector('[data-chat-model-trigger]').click());
    const menu = () => p.evaluate(() => { const m = document.getElementById('apmenu'), f = document.getElementById('xw-chat-frame'), tr = f.contentDocument.querySelector('[data-chat-model-trigger]').getBoundingClientRect(), fr = f.getBoundingClientRect(), r = m ? m.getBoundingClientRect() : null;
      return { open: !!m && m.classList.contains('show'), rows: m ? [...m.querySelectorAll('.row[data-model]')].map((x) => x.dataset.model + (x.classList.contains('on') ? '*' : '')) : [], text: m ? m.innerText : '', html: m ? m.innerHTML : '', more: !!m?.querySelector('[data-more-models]'),
        above: !!r && Math.abs(r.right - (fr.left + tr.right)) < 2 && r.bottom <= fr.top + tr.top, card: document.querySelector('#apcard.show')?.innerText || '', frame: { picks: f.contentWindow.__picks.slice(), closed: f.contentWindow.__closed } }; });
    await press(); await wait(300); let m = await menu();
    ok(m.open && m.rows.join() === 'm-a*,m-b,m-c,m-d' && m.more && m.above, 'pressing the chat’s model control opens this workspace’s model menu, over the control, with the chat’s real models and the current one marked (' + m.rows.join() + ')');
    ok(!/XENO picks/.test(m.text) && /your key/.test(m.text) && !m.html.includes('<i>C</i>'), 'it shows only what is real: no “XENO picks”, a model on the person’s own key says so, and a name is text');
    await p.hover('#apmenu .row[data-model="m-c"]'); await wait(200); m = await menu();
    ok(/Careful\./.test(m.card) && /1M context/.test(m.card) && !/tok\/s|Speed|Depth|cr \/ msg/.test(m.card), 'the detail card says what the platform says about the model, and nothing estimated (' + m.card.replace(/\n/g, ' | ') + ')');
    await p.hover('#apmenu .row[data-model="m-b"]'); await wait(200); m = await menu();
    ok(m.card === '', 'a model the platform says nothing about has no card');
    await p.click('#apmenu [data-more-models]'); await wait(200); m = await menu();
    ok(m.rows.join() === 'm-a*,m-b,m-c,m-d,m-e', 'More models shows the whole list');
    await p.click('#apmenu .row[data-model="m-e"]'); await wait(300); m = await menu();
    ok(!m.open && m.frame.picks.join() === 'm-e' && m.frame.closed === 1, 'choosing a model tells the chat which one, and closes the menu (' + m.frame.picks.join() + ')');
    await press(); await wait(300); m = await menu();
    ok(m.open && m.rows.includes('m-e*'), 'the next time it opens, the chat’s current model is the marked one');
    await press(); await wait(300); m = await menu();
    ok(!m.open && m.frame.closed === 2, 'pressing the control again closes it');
    await press(); await wait(200); await p.keyboard.press('Escape'); await wait(200); m = await menu();
    ok(!m.open, 'Escape closes it');
    // a long list scrolls inside a fixed height, with no bar and a fade where there is more; the header searches
    const big = () => p.evaluate(() => { const m2 = document.getElementById('apmenu'), sc = m2.querySelector('.ap-scroll'), h = m2.querySelector('.ap-head'); return { open: m2.classList.contains('show'), h: Math.round(m2.getBoundingClientRect().height), top: Math.round(m2.getBoundingClientRect().top), rows: sc ? sc.querySelectorAll('.row[data-model]').length : -1, scrolls: sc ? sc.scrollHeight > sc.clientHeight + 1 : false, below: !!sc?.classList.contains('more-below'), above: !!sc?.classList.contains('more-above'), bar: sc ? getComputedStyle(sc).scrollbarWidth : '', headH: h ? Math.round(h.getBoundingClientRect().height) : 0, finding: !!m2.querySelector('[data-model-q]'), names: sc ? [...sc.querySelectorAll('.row')].map((r) => r.children[1]?.textContent).join('|') : '', sel: document.getElementById('xw-chat-frame').contentWindow.__picks.join(',') }; });
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.__many = true; }); await press(); await wait(300);
    if (await p.evaluate(() => /More/.test(document.querySelector('#apmenu [data-more-models]').innerText))) { await p.click('#apmenu [data-more-models]'); await wait(300); } let g = await big();
    ok(g.rows === 25 && g.scrolls && g.h < 420 && g.top > 0 && g.bar === 'none', 'all 25 models are in the list, which scrolls inside a fixed height with no bar (' + JSON.stringify(g).slice(0, 260) + ')');
    ok(g.below, 'opened already expanded, a fade at the bottom says there is more below');
    await p.evaluate(() => { const sc = document.querySelector('#apmenu .ap-scroll'); sc.scrollTop = sc.scrollHeight; }); await wait(200); g = await big();
    ok(!g.below && g.above, 'at the end the bottom fade goes and the top one shows');
    const headBefore = g.headH; await p.click('#apmenu [data-model-find]'); await wait(200); g = await big();
    ok(g.finding && g.headH === headBefore && headBefore === 23, 'the magnifier turns the header into the search field at the same height (' + g.headH + 'px)');
    await p.keyboard.type('extra 1'); await wait(250); g = await big();
    ok(g.names.split('|').length === 11 && g.names.split('|').every((n) => /^Extra 1/.test(n)), 'typing filters every model by name (' + g.names.split('|').length + ' match "extra 1"), and a digit typed there picks nothing (' + (g.sel || 'no pick') + ')');
    const picksBefore = g.sel; await p.keyboard.type('zz'); await wait(200); g = await big();
    ok(g.rows === 0 && g.names === 'No model matches' && g.sel === picksBefore, 'no match says so and picks nothing');
    await p.keyboard.press('Escape'); await wait(200); g = await big();
    ok(g.open && !g.finding && g.rows === 25, 'Escape leaves the search and keeps the menu open');
    await p.click('#apmenu [data-model-find]'); await p.keyboard.type('extra 19'); await wait(200); await p.keyboard.press('Enter'); await wait(300); g = await big();
    ok(!g.open && g.sel.split(',').pop() === 'x-19', 'Enter picks the first match and closes (' + g.sel.split(',').pop() + ')');
    await p.evaluate(() => { const w = document.getElementById('xw-chat-frame').contentWindow; w.__many = false; w.__sel = 'm-a'; });
    // the effort menu: this page's design, on the chat's real levels
    const eff = () => p.evaluate(() => { const m2 = document.getElementById('apmenu'), fw = document.getElementById('xw-chat-frame').contentWindow; return { open: !!m2?.classList.contains('show') && m2.dataset.kind === 'effort', labels: [...(m2?.querySelectorAll('.ef3-labels span') || [])].map((s) => s.textContent + (s.classList.contains('cur') ? '*' : '')).join(','), text: m2?.innerText || '', picks: fw.__efforts.join(','), closed: fw.__effClosed }; });
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__askEffort('low')); await wait(300); let e1 = await eff();
    ok(e1.open && e1.labels === 'Off,Low*,High', 'the chat’s effort pill opens this page’s effort menu with the chat’s real levels, the one in force marked (' + e1.labels + ')');
    ok(!/ cr|~d+s/.test(e1.text), 'it shows no credits or seconds that nobody measured');
    await p.focus('#aptrack'); await p.keyboard.press('ArrowRight'); await wait(250); e1 = await eff();
    ok(e1.picks === 'high' && e1.labels === 'Off,Low,High*', 'choosing a level tells the chat its id, and the menu follows (' + e1.picks + ')');
    await p.keyboard.press('ArrowRight'); await wait(200); e1 = await eff();
    ok(e1.picks === 'high', 'there is no level past the chat’s last one');
    await p.mouse.click(5, 300); await wait(250); e1 = await eff();
    ok(!e1.open && e1.closed === 1, 'a press elsewhere closes it and tells the chat');
    await p.evaluate(() => window.postMessage({ source: 'xeno-chat', type: 'effort-menu', rect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }, selected: 'x', levels: [{ id: 'evil', label: 'Evil' }] }, location.origin)); await wait(200); e1 = await eff();
    ok(!e1.open, 'an effort message that does not come from the chat frame opens nothing');
    // a file preview inside the chat: this page's header is its header (no second one)
    const head = () => p.evaluate(() => { const bar = document.querySelector('#main .topbar'), cs = (s) => { const e = bar.querySelector(s); return e ? getComputedStyle(e).display !== 'none' : false; }; return { viewing: bar.classList.contains('viewing'), trail: bar.querySelector('.crumbs').innerText.split('\n').join(' '), transcript: cs('[data-chat-transcript]'), share: cs('.ib[aria-label="Share"]'), btns: [...bar.querySelectorAll('.tb-viewer .ib')].map((b) => b.getAttribute('aria-label') + (b.disabled ? ' (off)' : '')).join(','), got: document.getElementById('xw-chat-frame').contentWindow.__viewer.join(',') }; });
    const trailBefore = (await head()).trail;
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__tellViewer(true, 'A <b>dog</b>.png', true)); await wait(250); let hv = await head();
    ok(hv.viewing && hv.trail === trailBefore + ' / A <b>dog</b>.png' && !hv.transcript && !hv.share, 'a preview opened in the chat shows its file name at the end of this page’s trail, as text, and the conversation’s buttons step aside (' + hv.trail + ')');
    ok(hv.btns === 'Copy share link,Download,Close preview', 'the header carries the preview’s three actions (' + hv.btns + ')');
    await p.click('#main .topbar [data-viewer-download]'); await p.click('#main .topbar [data-viewer-copy]'); await wait(150); hv = await head();
    ok(hv.got === 'viewer-download,viewer-copy', 'pressing them tells the chat, which does the work (' + hv.got + ')');
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__tellViewer(true, 'locked.png', false)); await wait(200); hv = await head();
    ok(hv.btns === 'Copy share link (off),Download (off),Close preview', 'a file that cannot be exported has its two actions off');
    await p.click('#main .topbar .crumbs [data-viewer-close]'); await wait(150); hv = await head();
    ok(hv.got.endsWith('viewer-close'), 'the step before the file in the trail walks back out of the preview');
    await p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__tellViewer(false)); await wait(250); hv = await head();
    ok(!hv.viewing && hv.trail === trailBefore && hv.transcript && hv.share && hv.btns === '', 'when the preview closes the header is the conversation’s again');
    await p.evaluate(() => window.postMessage({ source: 'xeno-chat', type: 'viewer', open: true, name: 'evil.png', canExport: true }, location.origin)); await wait(200);
    ok(!(await head()).viewing, 'a preview message that does not come from the chat frame changes nothing');
    // a message that is not from the chat cannot open a menu or name models
    await p.evaluate(() => window.postMessage({ source: 'xeno-chat', type: 'model-menu', rect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }, selected: 'x', models: [{ id: 'evil', name: 'Evil' }] }, location.origin)); await wait(200); m = await menu();
    ok(!m.open, 'a message that does not come from the chat frame opens nothing');
    await p.evaluate(() => { document.getElementById('xw-chat-frame').contentWindow.__none = true; }); await press(); await wait(300); m = await menu();
    ok(m.open && /No models are available/.test(m.text) && !m.more, 'with no models the menu says so');
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
  { // each area has its own chats; Overview shows everything
    reset(); db.convs[0].area = 'dev'; db.convs[1].area = 'studio'; db.asked = [];
    const { p, errs } = await open('#/overview/p/chat'); let v = await view(p);
    const tags = () => p.evaluate(() => [...document.querySelectorAll('#panel [data-chat-live]')].map((r) => r.querySelector('.t').textContent + (r.querySelector('[data-chat-area]') ? ' [' + r.querySelector('[data-chat-area]').textContent + ']' : '')).join(' | '));
    ok(v.rows.length === 3 && db.asked.at(-1) === null && await p.evaluate(() => window.XENO_CHAT.area()) === null, 'on Overview the list asks for everything, and there is no area');
    ok((await tags()).split(' | ').sort().join(' | ') === 'Budget <b>questions</b> | New chat [Studio] | Plan the launch week [Dev]', 'each chat that lives in an area says which, by its name (' + await tags() + ')');
    await p.evaluate(() => { location.hash = '#/dev/p/chat'; }); await wait(1200); v = await view(p);
    ok(await p.evaluate(() => window.XENO_CHAT.area()) === 'dev' && db.asked.at(-1) === 'dev', 'in Dev the area is dev, which the real chat reads when it makes a chat, and the list asks for that area');
    ok(v.rows.length === 1 && await tags() === 'Plan the launch week', 'Dev lists only its own chats, with no label (they are all here)');
    await p.evaluate(() => { location.hash = '#/studio/p/chat'; }); await wait(1200); v = await view(p);
    ok(db.asked.at(-1) === 'studio' && v.rows.length === 1 && v.rows[0].id === B, 'Studio lists its own, not Dev’s');
    await p.evaluate(() => { location.hash = '#/office/p/chat'; }); await wait(1200); v = await view(p);
    ok(db.asked.at(-1) === 'office' && v.rows.length === 0 && /No chats yet/.test(v.panel), 'an area with no chats says so; it does not fall back to everything');
    // move a chat from Dev to Office, through its menu
    await p.evaluate(() => { location.hash = '#/dev/p/chat'; }); await wait(1200);
    await p.evaluate((A) => document.querySelector(`#panel [data-chat-live="${A}"] [data-more]`).click(), A); await wait(350);
    const hit = await p.evaluate(() => { const el = [...document.querySelectorAll('button, [role=menuitem]')].find((n) => n.offsetParent && n.textContent.trim().startsWith('Move to') && !n.closest('#panel')); if (el) el.click(); return !!el; }); await wait(450);
    const choices = await p.evaluate(() => [...document.querySelectorAll('[role=radio][data-v]')].filter((n) => n.offsetParent).map((n) => n.dataset.v + (n.getAttribute('aria-checked') === 'true' ? '*' : '')).join(','));
    ok(hit && /^none,/.test(choices) && /dev\*/.test(choices) && /office/.test(choices) && /studio/.test(choices), 'Move to… offers no area and every area, with the current one chosen (' + choices + ')');
    await p.evaluate(() => [...document.querySelectorAll('[role=radio][data-v="office"]')].find((n) => n.offsetParent).click()); await p.click('[data-xd-submit]').catch(() => {}); await wait(900); v = await view(p);
    ok(JSON.stringify(db.writes.at(-1)) === JSON.stringify(['PUT', A, JSON.stringify({ area: 'office' })]) && v.rows.length === 0, 'moving it saves the new area, and it leaves Dev’s list at once (' + JSON.stringify(db.writes.at(-1)) + ')');
    await p.evaluate(() => { location.hash = '#/office/p/chat'; }); await wait(1200); v = await view(p);
    ok(v.rows.length === 1 && v.rows[0].id === A, 'and it is in Office’s');
    // an area's own defaults: the chat is told when the area changes, and an area has its standing instruction
    const told = () => p.evaluate(() => document.getElementById('xw-chat-frame').contentWindow.__areaTold.slice());
    ok((await told()).includes('area:dev') && (await told()).includes('area:studio') && (await told()).includes('area:office'), 'the chat is told each time the person moves to another area, so a new chat opens with that area’s model (' + (await told()).filter((x) => x.startsWith('area:')).slice(0, 4).join(', ') + ')');
    const row = () => p.evaluate(() => { const b = document.querySelector('#panel [data-chat-instructions]'); return b ? b.innerText.replace(/\s+/g, ' ').trim() : null; });
    ok(await row() === 'Instructions Office', 'an area’s chat sidebar offers Instructions for that area (' + await row() + ')');
    db.settings = { areas: { office: { instructions: 'Be formal.', model: 'm-b' } }, chat: { wideMode: true } }; db.writes.length = 0;
    await p.click('#panel [data-chat-instructions]'); await wait(600);
    const shown = await p.evaluate(() => { const t = [...document.querySelectorAll('textarea')].find((n) => n.offsetParent); return t ? t.value : null; });
    ok(shown === 'Be formal.', 'it opens with what is saved for this area (' + shown + ')');
    await p.evaluate(() => { const t = [...document.querySelectorAll('textarea')].find((n) => n.offsetParent); t.value = '  Answer like a lawyer.  '; t.dispatchEvent(new Event('input', { bubbles: true })); }); await p.click('[data-xd-submit]'); await wait(700);
    const w = db.writes.at(-1);
    ok(w && w[0] === 'PATCH' && JSON.stringify(JSON.parse(w[2]).updates) === JSON.stringify([{ path: 'areas.office.instructions', value: 'Answer like a lawyer.' }]), 'saving writes this area’s instruction to the account, trimmed, and nothing else (' + (w && w[2]) + ')');
    const lastTold = (await told()).at(-1);
    ok(/^settings:/.test(lastTold) && JSON.parse(lastTold.slice(9)).office.instructions === 'Answer like a lawyer.' && JSON.parse(lastTold.slice(9)).office.model === 'm-b', 'and the running chat is handed the new settings, the area’s model kept (' + lastTold.slice(0, 90) + ')');
    await p.evaluate(() => { location.hash = '#/overview/p/chat'; }); await wait(1200);
    ok(await row() === null, 'Overview is not an area: it offers no area instructions');
    // Recent is the person's own work, per area; the picture's sample rows are gone
    const SAMPLE = /Brand refresh|Product shot cleanup|Neon city|Launch trailer|Q4 planning|Budget 2027|Investor update|Launch week thread|Atlas wants/;
    const recentOf = () => p.evaluate(() => ({ rows: [...document.querySelectorAll('#panel [data-recent-chat], #panel [data-recent-project]')].map((r) => r.querySelector('.t').textContent), panel: document.getElementById('panel').innerText, st: window.XENO_RECENT_LIVE.state(), all: window.XENO_RECENT.map((r) => r.t + '@' + r.m).join(' | '), needs: (window.XENO_NEEDS || []).length }));
    await p.evaluate(() => { location.hash = '#/overview'; }); await wait(900); await p.evaluate(() => window.XENO_RECENT_LIVE.load()); await wait(700); let rc = await recentOf();
    ok(rc.st.status === 'ready' && rc.rows.includes('Plan the launch week') && rc.rows.includes('Finance') && !SAMPLE.test(rc.panel) && rc.needs === 0, 'on Overview, Recent is the person’s own chats and projects, and no sample work or sample approval is shown (' + rc.rows.slice(0, 4).join(', ') + '; sample seen: ' + ((rc.panel.match(SAMPLE) || [])[0] || 'none') + '; needs ' + rc.needs + '; ' + rc.st.status + ')');
    ok(/Plan the launch week@office/.test(rc.all) && /New chat@studio/.test(rc.all) && rc.all.includes('Budget <b>questions</b>@overview'), 'each recent item carries the area it lives in (' + rc.all.slice(0, 120) + ')');
    await p.evaluate(() => { location.hash = '#/office'; }); await wait(900); rc = await recentOf();
    ok(JSON.stringify(rc.rows) === JSON.stringify(['Plan the launch week']) && !SAMPLE.test(rc.panel), 'an area’s home lists only that area’s recent work (' + rc.rows.join(', ') + ')');
    await p.evaluate(() => { location.hash = '#/social'; }); await wait(900); rc = await recentOf();
    ok(rc.rows.length === 0 && !SAMPLE.test(rc.panel), 'an area with nothing recent shows none, and no sample');
    await p.evaluate(() => { location.hash = '#/office'; }); await wait(900); await p.evaluate(() => document.querySelector('#panel [data-recent-chat]').click()); await wait(1200);   // (an area’s first-visit intro covers the panel here; the row itself is what is under test)
    ok((await p.evaluate(() => location.hash)).startsWith('#/office/p/chat/') &&(await p.evaluate(() => window.XENO_CHAT.state().current)) === A, 'a recent chat opens that conversation, in the area it was opened from (' + await p.evaluate(() => location.hash) + ')');
    ok(errs.length === 0, 'no page errors with areas (' + errs.slice(0, 2).join(' | ') + ')');
    await p.close(); }
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
