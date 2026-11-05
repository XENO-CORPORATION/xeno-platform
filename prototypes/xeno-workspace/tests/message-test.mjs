import { shot } from './shot.mjs';
// Social › Message is XENO Comms for real (platform-message.js), against a stand-in /api/message. Nothing reaches Comms.
//   1. No sample rows, no sample mark; Channels · Direct messages are HEADER tabs and New message is the header's
//      primary action, opening a dialog (standing UI rule, owner 2026-10-20).
//   2. Channels are grouped by scope; opening one gives it a real address by id (…/message/team/<id>), which survives
//      a reload; a reply opens the thread at …/t/<message id>; message text is shown as text (no HTML injection).
//   3. Send posts {key, text}; a reply posts replyTo; Hand to agent posts the chat's hand-off from a dialog.
//   4. New message → a direct message, addressed …/message/dm/<id>.
//   5. Unconfigured server: an honest state, never sample rows.
//   6. Your own messages show one tick, two, or two in green; the count shows while only some have read; other people's
//      show none. Opening a conversation says you've seen it. @ offers who is here, and Enter picks rather than sends.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5198, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const TEAM = '6f0c2b8e-3f43-4b1a-9a52-0d9c2f7e1a12', CONV = '0b0b0b0b-1111-4111-8111-000000000001', DM = '0d0d0d0d-2222-4222-8222-000000000002', M1 = '0a0a0a0a-3333-4333-8333-000000000003';
const db = { configured: true, calls: [], msgs: { [CONV]: [{ id: M1, author: { id: 'u2', name: 'Ada', kind: 'human' }, text: 'Launch is Friday <img src=x onerror=alert(1)>', replyTo: null, replies: 0, createdAt: new Date().toISOString() }], [DM]: [] }, dms: [] };
const chans = () => [{ key: 'workspace', kind: 'workspace', title: 'Acme', conversationId: null, unread: false }, { key: `team:${TEAM}`, kind: 'team', title: 'Design', conversationId: CONV, unread: true }];

async function open(addr) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('native dialog: ' + d.message()); d.dismiss(); });
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/message')) db.calls.push([q.method(), u.pathname + u.search, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/message/conversations') return db.configured ? json({ success: true, configured: true, channels: chans(), dms: db.dms }) : json({ success: false, code: 'message_not_configured', error: 'Message is not set up on this server yet' }, 503);
    if (u.pathname === '/api/message/messages' && q.method() === 'GET') {
      const conv = u.searchParams.get('key') === `team:${TEAM}` ? CONV : u.searchParams.get('conversationId');
      const all = db.msgs[conv] || [], th = u.searchParams.get('thread');
      if (th) return json({ success: true, conversationId: conv, channel: null, parent: all.find((m) => m.id === th), messages: all.filter((m) => m.replyTo === th) });
      return json({ success: true, conversationId: conv, channel: conv === CONV ? { key: `team:${TEAM}`, kind: 'team', title: 'Design', conversationId: CONV, members: 3 } : null, messages: all.filter((m) => !m.replyTo).map((m) => ({ ...m, replies: all.filter((x) => x.replyTo === m.id).length })) });
    }
    if (u.pathname === '/api/message/messages' && q.method() === 'POST') { const conv = sent.key === `team:${TEAM}` ? CONV : sent.conversationId; const m = { id: crypto.randomUUID(), author: { id: '7', name: 'Test Person', kind: 'human' }, text: sent.text, replyTo: sent.replyTo || null, createdAt: new Date().toISOString() }; db.msgs[conv].push(m); return json({ success: true, conversationId: conv, message: m }); }
    if (u.pathname === '/api/message/directory') return json({ success: true, people: [{ id: 'u2', name: 'Ada', handle: 'ada' }], agents: [] });
    if (u.pathname === '/api/message/direct') { db.dms = [{ conversationId: DM, with: { id: 'u2', name: 'Ada', kind: 'human' }, unread: false }]; return json({ success: true, conversationId: DM, with: { id: 'u2', name: 'Ada' } }); }
    if (u.pathname === '/api/message/handoff') return json({ success: true, note: 'Handed to Atlas as T-9', handoff: { delegated: true, task: { key: 'T-9' } } });
    if (u.pathname === '/api/message/realtime') return json({ success: true, realtime: false });
    if (u.pathname === '/api/message/members') return json({ success: true, members: [{ id: 'u2', name: 'Ada', kind: 'human', handle: 'ada' }, { id: 'u3', name: 'Atlas', kind: 'agent', handle: 'atlas.ada' }] });
    if (u.pathname.startsWith('/api/message/')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    if (u.pathname === '/api/agents') return json({ success: true, agents: [{ id: 'agt_atlas', name: 'Atlas' }] });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const path0 = (p) => p.evaluate(() => location.pathname);

try {
  { const { p, errs } = await open('/workspace/social/spaces/message');
    const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-ms-page]')?.dataset.msPage, mark: !!document.querySelector('#main [data-sample-badge]'), sample: document.body.textContent.includes('Team — design crit'), groups: [...document.querySelectorAll('[data-ms-channels]')].map((x) => x.dataset.msChannels).join(),
      headTabs: !!document.querySelector('#main .topbar .pg-top-tabs [data-ms-tab="dms"]'), bodyTabs: !!document.querySelector('[data-ms-page] [data-ms-tab]'), newInHead: !!document.querySelector('#main .topbar .pg-top-acts [data-ms-new]'), badge: [...document.querySelectorAll('#rail [data-zone="message"] .cnt')].map((x) => x.textContent).join('') }));
    await shot(p, 'message');
    ok(s0.page === 'ready' && !s0.mark && !s0.sample, `Message is the real thing: no sample rows, no sample mark (${JSON.stringify(s0)})`);
    ok(s0.headTabs && !s0.bodyTabs && s0.newInHead, 'Channels · Direct messages are header tabs and New message is the header’s primary action');
    ok(s0.groups === 'workspace,team', `channels are grouped by scope (${s0.groups})`);
    ok(s0.badge === '1', `the rail count is the real unread count (${s0.badge})`);

    await p.click(`[data-ms-ch="team:${TEAM}"]`); await wait(700);
    ok(await path0(p) === `/workspace/social/spaces/message/team/${TEAM}`, `the channel has a real address by id (${await path0(p)})`);
    const body = await p.evaluate(() => ({ html: document.querySelector('[data-ms-body]')?.innerHTML || '', img: !!document.querySelector('[data-ms-body] img'), crumb: document.querySelector('#main .topbar')?.textContent || '' }));
    ok(!body.img && body.html.includes('&lt;img'), 'message text is shown as text, never as markup');
    ok(/#Design/.test(body.crumb) && !body.crumb.includes(TEAM), 'the breadcrumb names the channel, not its id');
    await p.type('[data-ms-compose=""] [data-ms-text]', 'Ready on my side'); await p.click('[data-ms-compose=""] [data-ms-send]'); await wait(700);
    const post = db.calls.find((c) => c[0] === 'POST' && c[1].startsWith('/api/message/messages'));
    ok(post && post[2].key === `team:${TEAM}` && post[2].text === 'Ready on my side' && /^[0-9a-f-]{36}$/.test(post[2].clientMessageId), `Send posts to the channel with a client id (${JSON.stringify(post && post[2])})`);
    await p.click(`[data-ms-reply="${M1}"]`); await wait(700);
    ok(await path0(p) === `/workspace/social/spaces/message/team/${TEAM}/t/${M1}` && await p.$('[data-ms-thread-pane]') !== null, 'Reply opens the thread at its own address');
    await p.type(`[data-ms-compose="${M1}"] [data-ms-text]`, 'In the thread'); await p.click(`[data-ms-compose="${M1}"] [data-ms-send]`); await wait(700);
    const reply = db.calls.filter((c) => c[0] === 'POST' && c[1].startsWith('/api/message/messages')).at(-1);
    ok(reply && reply[2].replyTo === M1, 'a reply carries replyTo');
    ok(await p.evaluate(() => document.querySelector('[data-ms-replies]')?.textContent.includes('In the thread')), 'and shows in the thread');
    await p.reload({ waitUntil: 'domcontentloaded' }); await wait(1800);
    ok(await path0(p) === `/workspace/social/spaces/message/team/${TEAM}/t/${M1}` && await p.$('[data-ms-thread-pane]') !== null, 'a reload lands on the same thread');

    await p.click(`[data-ms-handoff="${M1}"]`); await wait(500);
    ok(await p.$('.xd-sh[role="dialog"] [data-f="agent"]') !== null, 'Hand to agent opens the workspace dialog');
    await p.click('.xd-sh [data-xd-submit]'); await wait(700);
    const ho = db.calls.find((c) => c[1].startsWith('/api/message/handoff'));
    ok(ho && ho[2].key === `team:${TEAM}` && ho[2].messageId === M1 && ho[2].agentId === 'agt_atlas' && /Launch is Friday/.test(ho[2].prompt), `the hand-off names the channel, the message and the agent (${JSON.stringify(ho && ho[2])})`);

    await p.click('#main .topbar [data-ms-new]'); await wait(500);
    ok(await p.$('.xd-sh[role="dialog"] [data-f="who"]') !== null, 'New message opens the workspace dialog');
    await p.click('.xd-sh [data-xd-submit]'); await wait(900);
    ok(await path0(p) === `/workspace/social/spaces/message/dm/${DM}`, `a direct message has its own address (${await path0(p)})`);
    ok(db.calls.some((c) => c[0] === 'POST' && c[1].startsWith('/api/message/direct') && c[2].userId === 'u2'), 'it was started with the chosen person');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`);
    await p.close(); }

  { const me = { id: '7', name: 'Test Person', kind: 'human' }, at = new Date().toISOString(), mine = (id, status, read, extra = {}) => ({ id, author: me, text: `Mine ${status}`, createdAt: at, replies: 0, mentions: [], receipt: { status, of: 3, delivered: status === 'sent' ? 0 : 3, read, readBy: read ? ['Ada'] : [] }, ...extra });
    const T1 = 'aaaaaaaa-0000-4000-8000-000000000001', T2 = 'aaaaaaaa-0000-4000-8000-000000000002', T3 = 'aaaaaaaa-0000-4000-8000-000000000003', T4 = 'aaaaaaaa-0000-4000-8000-000000000004';
    db.msgs[CONV].push(mine(T1, 'sent', 0), mine(T2, 'delivered', 1), mine(T3, 'read', 3, { text: 'Over to you @atlas.ada', mentions: [{ id: 'u3', name: 'Atlas', kind: 'agent', handle: 'atlas.ada' }] }), { id: T4, author: { id: 'u2', name: 'Ada', kind: 'human' }, text: 'Hello <b>@ada</b>', createdAt: at, replies: 0, mentions: [] });
    db.calls.length = 0;
    const { p, errs } = await open(`/workspace/social/spaces/message/team/${TEAM}`); await p.bringToFront(); await wait(600);
    const t = await p.evaluate((a) => { const q = (id) => document.querySelector(`[data-ms-tick="${id}"]`); const lines = (id) => q(id)?.querySelectorAll('path').length; return { sent: lines(a[0]), deliv: lines(a[1]), read: lines(a[2]), status: q(a[2])?.dataset.msStatus, color: getComputedStyle(q(a[2])).color, plain: getComputedStyle(q(a[0])).color, part: q(a[1])?.textContent, title: q(a[2])?.title, others: q(a[3])?.dataset.msStatus || null, at: document.querySelector(`[data-ms-msg="${a[2]}"] [data-ms-mention]`)?.textContent, raw: !!document.querySelector(`[data-ms-msg="${a[3]}"] [data-ms-body] b`) }; }, [T1, T2, T3, T4]);
    ok(t.sent === 1 && t.deliv === 2 && t.read === 2, `one tick for sent, two for delivered and read (${JSON.stringify(t)})`);
    ok(t.color === "rgb(34, 197, 94)" && t.status === "read", `a read message’s ticks are green (${t.color})`);
    ok(/1 of 3 read/.test(t.part) && /Read by 3 of 3/.test(t.title), 'a group shows the count, and hovering says who');
    ok(t.others === null, 'someone else’s message has no ticks');
    ok(t.at === '@atlas.ada' && !t.raw, 'a mention is marked, and text is still text');
    ok(db.calls.some((c) => c[0] === 'GET' && c[1].includes('/api/message/messages') && c[1].includes('seen=1')), 'opening a conversation says you’ve seen it');
    await p.focus('[data-ms-compose=""] [data-ms-text]'); await p.keyboard.type('Hello @a'); await wait(300);
    const list = await p.$$eval('[data-ms-at] li', (x) => x.map((n) => n.innerText));
    ok(list.length === 2 && list.some((x) => /agent/.test(x)), `@ offers who is here, agents marked (${list.join(' / ')})`);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(200);
    const v = await p.$eval('[data-ms-compose=""] [data-ms-text]', (x) => x.value);
    ok(v === 'Hello @atlas.ada ', `Enter picks the name instead of sending (${v})`);
    ok(!(await p.$('[data-ms-at]')), 'and the list closes');
    await p.evaluate(() => window.XW.render()); await wait(200);
    ok((await p.$eval('[data-ms-compose=""] [data-ms-text]', (x) => x.value)) === 'Hello @atlas.ada ', 'a repaint keeps what you were typing');
    await p.keyboard.type('x');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`);
    await shot(p, 'message-ticks');
    await p.close(); }

  { db.configured = false; const { p } = await open('/workspace/social/spaces/message');
    const s = await p.evaluate(() => ({ st: document.querySelector('[data-ms-state]')?.dataset.msState, sample: document.body.textContent.includes('Team — design crit') }));
    ok(s.st === 'not-configured' && !s.sample, `an unconfigured server says so and shows no sample conversations (${JSON.stringify(s)})`);
    await p.close(); }
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
