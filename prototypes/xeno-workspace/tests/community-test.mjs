// platform-community.js: on the platform, Community is the real Forum. A stand-in /api/forum answers; the suite is
// about the workspace's side: no sample threads, tickets or log; every action goes to the platform; refusals said.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5195, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'ada', email: 'ada@example.test', display_name: 'Ada', avatar_url: null, email_verified: true };
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const A = (name, kind = 'human') => ({ kind, handle: name.toLowerCase(), displayName: name });
const db = {};
const reset = () => Object.assign(db, { calls: [], refuse: null, moderator: false,
  threads: [
    { shortId: 'aaaa1111', slug: 'a', title: 'Exporting <b>layers</b> one by one', status: 'open', space: { slug: 'questions', name: 'Questions' }, author: A('Ada'), postCount: 3, isResolved: false, lastActivityAt: iso(1), tags: [], score: 2,
      posts: [{ id: 'p0', body: 'How do I export each layer?', author: A('Ada'), createdAt: iso(5), score: 0, isAnswer: false }, { id: 'p1', body: 'Use File > Export layers.', author: A('Rui'), createdAt: iso(3), score: 4, isAnswer: false, advisoryCount: 2 }, { id: 'p2', body: 'Seen this too.', author: A('Kit', 'agent'), createdAt: iso(2), score: 0, isAnswer: false }], duplicateOf: null, subscribed: false },
    { shortId: 'bbbb2222', slug: 'b', title: 'Layer export, separate files', status: 'duplicate', space: { slug: 'questions', name: 'Questions' }, author: A('Rui'), postCount: 1, isResolved: false, lastActivityAt: iso(9), tags: ['kind:bug'], score: 0,
      posts: [{ id: 'q0', body: 'Same thing', author: A('Rui'), createdAt: iso(9), score: 0, position: 1 }], hiddenReplies: [{ position: 2, createdAt: iso(8) }], duplicateOf: { shortId: 'aaaa1111', title: 'Exporting <b>layers</b> one by one' }, subscribed: false },
  ],
  tickets: [{ shortId: 'cccc3333', product: 'workspace', kind: 'bug', title: 'Rail jumps on resize', body: 'It jumps.', status: 'fixed', statusLabel: 'Fixed', fixedIn: '0.9.1', createdAt: iso(48), thread: null,
    posts: [{ id: 't1', kind: 'reply', body: 'Reproduced, thanks.', author: { kind: 'agent', name: 'workspace-dev', reporter: false }, createdAt: iso(40) }, { id: 't2', kind: 'status', body: 'Fixed in 0.9.1', author: { kind: 'human', name: 'Mira', reporter: false }, createdAt: iso(20) }] }],
  flags: [{ id: 'f1', target: { type: 'post', id: 'p2' }, reason: 'spam', detail: 'odd link', thread: { shortId: 'aaaa1111', title: 'Exporting <b>layers</b> one by one' }, excerpt: 'Seen this too.' }],
  log: [] });
const CHAT = `<!doctype html><html><body><div class="chat-themed"><div data-chat-composer-shell></div></div><script>parent.postMessage({ source: 'xeno-chat', type: 'location', path: location.pathname, title: 'Chat' }, location.origin);</script></body></html>`;
async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: CHAT });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null, m = q.method(), path2 = u.pathname.replace('/api/forum', '');
    if (u.pathname.startsWith('/api/forum')) db.calls.push([m, path2, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname.startsWith('/api/forum')) {
      if (db.refuse && m !== 'GET' && path2.includes(db.refuse)) return json({ success: false, error: 'You do not have the "vote" capability yet', code: 'insufficient_reputation' }, 403);
      const summary = (t) => { const { posts, subscribed, duplicateOf, ...s } = t; return s; };
      if (path2 === '/threads' && m === 'GET') return json({ success: true, threads: db.threads.map(summary), total: db.threads.length });
      if (path2 === '/threads' && m === 'POST') { const t = { shortId: 'dddd4444', slug: 'd', title: sent.title, status: 'open', space: { slug: sent.space, name: 'Questions' }, author: A('Ada'), postCount: 1, lastActivityAt: iso(0), tags: [], score: 0, posts: [{ id: 'n0', body: sent.body, author: A('Ada'), createdAt: iso(0) }], duplicateOf: null }; db.threads.unshift(t); return json({ success: true, thread: summary(t) }, 201); }
      let mm = path2.match(/^\/threads\/([a-z0-9]+)$/); if (mm) { const t = db.threads.find((x) => x.shortId === mm[1]); return t ? json({ success: true, thread: t }) : json({ success: false, error: 'Thread not found' }, 404); }
      mm = path2.match(/^\/threads\/([a-z0-9]+)\/posts$/); if (mm) { const t = db.threads.find((x) => x.shortId === mm[1]); t.posts.push({ id: 'r' + t.posts.length, body: sent.body, author: A('Ada'), createdAt: iso(0), score: 0 }); t.postCount++; return json({ success: true }, 201); }
      mm = path2.match(/^\/threads\/([a-z0-9]+)\/subscription$/); if (mm) { db.threads.find((x) => x.shortId === mm[1]).subscribed = sent.subscribed; return json({ success: true }); }
      mm = path2.match(/^\/posts\/([^/]+)\/vote$/); if (mm) { for (const t of db.threads) for (const x of t.posts) if (x.id === mm[1]) { if (m === 'DELETE') { if (x.myVote) x.score--; x.myVote = 0; } else { if (!x.myVote) x.score++; x.myVote = 1; } } return json({ success: true }); }
      mm = path2.match(/^\/threads\/([a-z0-9]+)\/fixed$/); if (mm) { const t = db.threads.find((x) => x.shortId === mm[1]); t.fixedIn = sent.version; t.status = 'resolved'; return json({ success: true, version: sent.version }); }
      mm = path2.match(/^\/posts\/([^/]+)\/accept$/); if (mm) { for (const t of db.threads) for (const x of t.posts) x.isAnswer = x.id === mm[1] ? true : x.isAnswer; return json({ success: true }); }
      if (/\/flag$/.test(path2)) return json({ success: true }, 201);
      if (path2 === '/me') return json({ success: true, actor: { handle: 'ada', isStaff: db.moderator }, capabilities: { review_flags: db.moderator } });
      if (path2 === '/spaces') return json({ success: true, spaces: [{ slug: 'questions', name: 'Questions', postPolicy: 'open' }, { slug: 'announcements', name: 'Announcements', postPolicy: 'staff_only' }] });
      if (path2 === '/dedup-check') return json({ success: true, candidates: sent.title.includes('layer') ? [{ shortId: 'aaaa1111', title: 'Exporting layers one by one' }] : [] });
      if (path2 === '/report/preflight') return json({ success: true, candidates: [] });
      if (path2 === '/report') { if (sent.visibility === 'private') { const t = { shortId: 'eeee5555', product: sent.product, kind: sent.kind, title: sent.title, body: sent.body, status: 'open', statusLabel: 'Open', fixedIn: null, createdAt: iso(0), thread: null, posts: [] }; db.tickets.unshift(t); return json({ success: true, private: true, ticket: t }); }
        const t = { shortId: 'ffff6666', slug: 'f', title: sent.title, status: 'open', space: { slug: 'feedback', name: 'Feedback' }, author: A('Ada'), postCount: 1, lastActivityAt: iso(0), tags: ['kind:' + sent.kind], score: 0, posts: [{ id: 'z0', body: sent.body, author: A('Ada'), createdAt: iso(0) }], duplicateOf: null }; db.threads.unshift(t); return json({ success: true, shortId: t.shortId }); }
      if (path2 === '/tickets/mine') return json({ success: true, tickets: db.tickets.map(({ posts, ...s }) => s) });
      mm = path2.match(/^\/tickets\/([a-z0-9]+)$/); if (mm) { const t = db.tickets.find((x) => x.shortId === mm[1]); return t ? json({ success: true, ticket: t }) : json({ success: false, error: 'Ticket not found' }, 404); }
      mm = path2.match(/^\/tickets\/([a-z0-9]+)\/posts$/); if (mm) { db.tickets.find((x) => x.shortId === mm[1]).posts.push({ id: 'tp', kind: 'reply', body: sent.body, author: { kind: 'human', name: 'Ada', reporter: true }, createdAt: iso(0) }); return json({ success: true }); }
      mm = path2.match(/^\/tickets\/([a-z0-9]+)\/publish$/); if (mm) { db.tickets.find((x) => x.shortId === mm[1]).thread = { shortId: 'gggg7777' }; return json({ success: true }); }
      mm = path2.match(/^\/tickets\/([a-z0-9]+)\/status$/); if (mm) { const t = db.tickets.find((x) => x.shortId === mm[1]); t.status = sent.status; t.statusLabel = 'Closed'; return json({ success: true, ticket: t }); }
      if (path2 === '/flags') return json({ success: true, flags: db.flags });
      mm = path2.match(/^\/flags\/([^/]+)\/resolve$/); if (mm) { db.flags = db.flags.filter((f) => f.id !== mm[1]); if (sent.action !== 'dismiss') db.log.unshift({ at: iso(0), outcome: 'hidden', reason: 'spam', moderator: 'Ada', thread: { shortId: 'aaaa1111', title: 'Exporting <b>layers</b> one by one' } }); return json({ success: true }); }
      if (path2 === '/moderation/actions') { const t = db.threads.find((x) => x.shortId === sent.targetId); if (sent.action === 'lock' && t) t.status = 'locked'; db.log.unshift({ at: iso(0), outcome: sent.action === 'lock' ? 'locked' : sent.action, reason: sent.reason, moderator: 'Ada', thread: t ? { shortId: t.shortId, title: t.title } : null }); return json({ success: true }); }
      if (path2 === '/moderation-log') return json({ success: true, log: db.log });
      return json({ success: false, error: 'not found' }, 404);
    }
    const body = { '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/library/assets': { success: true, items: [] }, '/api/chat/conversations': { success: true, conversations: [], total: 0 }, '/api/chat/projects': { success: true, projects: [] }, '/api/workspace/needs': { success: true, items: [] }, '/api/tasks': { success: true, tasks: [] }, '/api/notifications': { success: true, unread: 0, items: [] }, '/api/tasks/views': { success: true, views: [] }, '/api/workspace/pins': { success: true, items: [] }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/v2/ledger/usage': { rows: [] } }[u.pathname];
    return body ? json(body) : json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1600);
  return { p, errs };
}
const main = (p) => p.evaluate(() => ({ text: document.querySelector('#main').textContent.replace(/\s+/g, ' '), html: document.querySelector('#main').innerHTML }));
const goC = async (p, item) => { await p.evaluate((it) => window.XW.go('global', { global: 'community', item: it }), item); await wait(900); };
const called = (m, part) => db.calls.filter((c) => c[0] === m && c[1].includes(part));
const fill = async (p, vals) => { await p.evaluate((v) => { for (const [k, x] of Object.entries(v)) { const el = document.querySelector('.xd #xdf-' + k); el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); } }, vals); };
const pickRadio = (p, v) => p.evaluate((x) => [...document.querySelectorAll('.xd [role=radio][data-v="' + x + '"]')].find((n) => n.offsetParent).click(), v);
const submitLast = (p) => p.evaluate(() => [...document.querySelectorAll('.xd [data-xd-submit]')].at(-1).click());

try {
  reset();
  { const { p, errs } = await open('#/overview');
    await goC(p, null); let v = await main(p);
    ok(/Exporting &lt;b&gt;layers&lt;\/b&gt; one by one/.test(v.html) && /Layer export, separate files/.test(v.text), 'the Community list is the real threads, titles shown as text');
    ok(!/music video|brand kit|XENO Agent 0\.4|Canvas frame as SVG/.test(v.text), 'none of the picture’s sample threads are shown');
    await p.evaluate(() => document.querySelector('#main [data-pg-gitem="aaaa1111"]').click()); await wait(1000); v = await main(p);
    ok(/How do I export each layer\?/.test(v.text) && /Use File &gt; Export layers\./.test(v.html) && /Seen this too\./.test(v.text) && (await p.evaluate(() => document.querySelector('#main .crumbs')?.textContent || '')).includes('Exporting <b>layers</b> one by one'), 'opening a thread shows its real opening post and replies, and the crumb names it by its title');
    ok(/Agent/.test(v.text) && /2 agents found this relevant/.test(v.text), 'an agent’s reply is marked as an agent’s, and agents’ signal is shown apart from votes');
    ok(!/Moderate|>Hide</.test(v.html), 'a person who is not a moderator sees no moderation controls');
    db.calls.length = 0;
    await p.evaluate(() => { const f = document.querySelector('#main [data-cm-reply]'); f.querySelector('textarea').value = 'Thanks, that worked.'; f.requestSubmit(); }); await wait(1000); v = await main(p);
    ok(called('POST', '/threads/aaaa1111/posts')[0]?.[2].body === 'Thanks, that worked.' && /Thanks, that worked\./.test(v.text), 'a reply is posted to the platform and appears');
    await p.evaluate(() => document.querySelector('#main [data-cml="vote"][data-arg="p1"]').click()); await wait(900);
    ok(called('POST', '/posts/p1/vote')[0]?.[2].value === 1 && /Helpful5/.test((await main(p)).text.replace(/\s/g, '')) && await p.evaluate(() => document.querySelector('#main [data-cml="vote"][data-arg="p1"]').getAttribute('aria-pressed') === 'true'), 'Helpful is counted by the platform, and shows as your vote');
    await p.evaluate(() => document.querySelector('#main [data-cml="vote"][data-arg="p1"]').click()); await wait(900);
    ok(called('DELETE', '/posts/p1/vote').length === 1 && /Helpful4/.test((await main(p)).text.replace(/\s/g, '')) && await p.evaluate(() => document.querySelector('#main [data-cml="vote"][data-arg="p1"]').getAttribute('aria-pressed') === 'false'), 'pressing it again takes the vote back');
    db.refuse = '/vote'; await p.evaluate(() => document.querySelector('#main [data-cml="vote"][data-arg="p2"]').click()); await wait(800); db.refuse = null;
    ok(await p.evaluate(() => document.body.textContent.includes('capability yet')), 'when the platform refuses a vote its reason is shown');
    await p.evaluate(() => document.querySelector('#main [data-cml="answer"][data-arg^="p1"]').click()); await wait(900);
    ok(called('POST', '/posts/p1/accept').length === 1 && /Answer/.test((await main(p)).text), 'the asker can mark the answer');
    await p.evaluate(() => document.querySelector('#main [data-cml="follow"]').click()); await wait(700);
    ok(called('PUT', '/threads/aaaa1111/subscription')[0]?.[2].subscribed === true && /Following/.test((await main(p)).text), 'Follow is saved on the platform');
    p.evaluate(() => document.querySelector('#main [data-cml="flag"][data-arg="aaaa1111|p2"]').click()); await wait(500); await pickRadio(p, 'spam'); await submitLast(p); await wait(800);
    ok(called('POST', '/posts/p2/flag')[0]?.[2].reason === 'spam', 'reporting a reply sends it to the moderators');
    await goC(p, 'bbbb2222'); v = await main(p);
    ok(/A moderator hid this reply/.test(v.text) && !/Same thing.*hid/.test(''), 'a hidden reply leaves a marker in its place');
    ok(/This is a duplicate\. The answer is in <a[^>]*data-arg="aaaa1111"[^>]*>Exporting &lt;b&gt;layers/.test(v.html), 'a duplicate points to the original, by its public link');
    await goC(p, 'zzzz9999'); ok(/It may have been removed, or the link is wrong/.test((await main(p)).text), 'a thread that does not exist says so');

    // new thread with the duplicate check
    db.calls.length = 0; p.evaluate(() => window.XA.newThread()); await wait(700);
    const spaces = await p.evaluate(() => [...document.querySelectorAll('.xd [data-f="space"] [data-v]')].map((n) => n.dataset.v).join());
    ok(spaces === 'questions', `a new thread offers only the spaces a person may post in (${spaces})`);
    await fill(p, { title: 'Another question about layer order', body: 'Which comes first?' }); await submitLast(p); await wait(800);
    ok(called('POST', '/dedup-check').length === 1 && await p.evaluate(() => document.body.textContent.includes('This may have been asked already')), 'before posting, a possible duplicate is offered');
    await pickRadio(p, 'new'); await submitLast(p); await wait(1200);
    ok(called('POST', '/threads')[0]?.[2].title === 'Another question about layer order' && (await p.evaluate(() => window.XENO_ADDR.current())).includes('dddd4444'), 'posting it anyway creates the thread on the platform and opens it');
    ok(errs.length === 0, `no page errors in threads (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // reports and tickets
  reset();
  { const { p, errs } = await open('#/overview'); await goC(p, 'My reports'); let v = await main(p);
    ok(/Rail jumps on resize/.test(v.text) && /fixed in 0\.9\.1/.test(v.text) && !/Canvas freezes|Let me pin a chat/.test(v.text), 'My reports lists the real private tickets, with the fix version, and no sample ticket');
    await p.evaluate(() => document.querySelector('#main [data-cml="ticket"]').click()); await wait(900); v = await main(p);
    ok(/Fixed in 0\.9\.1\./.test(v.text) && /Reproduced, thanks\./.test(v.text) && /workspace-dev/.test(v.text), 'a ticket shows the fix written back and the dev agent’s reply');
    await p.evaluate(() => { const f = document.querySelector('#main [data-cm-ticket-reply]'); f.querySelector('textarea').value = 'Still happens on Linux.'; f.requestSubmit(); }); await wait(900);
    ok(called('POST', '/tickets/cccc3333/posts')[0]?.[2].body === 'Still happens on Linux.' && /Still happens on Linux\./.test((await main(p)).text), 'adding to a ticket goes to the platform');
    p.evaluate(() => document.querySelector('#main [data-cml="publish"]').click()); await wait(400); await p.evaluate(() => [...document.querySelectorAll('.xd [data-xd-ok]')].at(-1).click()); await wait(900);
    ok(called('POST', '/tickets/cccc3333/publish').length === 1 && /Open public thread/.test((await main(p)).text), 'making a ticket public asks first, then links the public thread');
    p.evaluate(() => window.XA.report()); await wait(700); await fill(p, { title: 'Sidebar loses my place' }); await pickRadio(p, 'private'); await submitLast(p); await wait(1200);
    const rep = called('POST', '/report').at(-1);
    ok(rep && rep[2].visibility === 'private' && rep[2].kind === 'bug' && rep[2].product === 'workspace' && (await p.evaluate(() => window.XENO_ADDR.current())).includes('eeee5555'), 'a private report becomes a ticket on the platform and opens it');
    await wait(3000); ok(!/I can reproduce this and have passed it/.test((await main(p)).text), 'no invented reply writes itself into the new ticket');
    p.evaluate(() => window.XA.report({ kind: 'feature' })); await wait(700); await fill(p, { title: 'Let me group chats by colour' }); await submitLast(p); await wait(1200);
    const pub = called('POST', '/report').at(-1);
    ok(pub && pub[2].visibility === 'public' && pub[2].kind === 'feature' && (await p.evaluate(() => window.XENO_ADDR.current())).includes('ffff6666'), 'a public idea is posted with its kind and opened');
    ok(errs.length === 0, `no page errors in reports (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }

  // moderation
  reset(); db.moderator = true;
  { const { p, errs } = await open('#/overview'); await goC(p, 'Moderation'); let v = await main(p);
    ok(/Exporting &lt;b&gt;layers/.test(v.html) && /odd link/.test(v.text) && !/Ana \(moderator\)/.test(v.text) && /No moderation actions yet/.test(v.text), 'a moderator sees the real queue and an honest empty log, no sample log');
    await p.evaluate(() => document.querySelector('#main [data-cml="resolve"][data-arg="f1|hide"]').click()); await wait(1000); v = await main(p);
    ok(called('POST', '/flags/f1/resolve')[0]?.[2].action === 'hide' && /Nothing waiting/.test(v.text) && /Hid a reply in “Exporting/.test(v.text), 'hiding from the queue goes to the platform and appears in the public log');
    await goC(p, 'aaaa1111'); p.evaluate(() => document.querySelector('#main [data-cml="mod"]').click()); await wait(600); await submitLast(p); await wait(1100);
    const act = called('POST', '/moderation/actions')[0];
    ok(act && act[2].action === 'lock' && act[2].targetId === 'aaaa1111' && /Locked by a moderator/.test((await main(p)).text), 'locking a thread goes to the platform and the thread shows it is locked');
    p.evaluate(() => document.querySelector('#main [data-cml="fixed"]').click()); await wait(600); await fill(p, { version: '0.40.1', note: 'Decoding moved off the main thread.' }); await submitLast(p); await wait(1100);
    const fx = called('POST', '/threads/aaaa1111/fixed')[0];
    ok(fx && fx[2].version === '0.40.1' && /Fixed in 0\.40\.1\./.test((await main(p)).text) && !(await p.evaluate(() => !!document.querySelector('#main [data-cml="fixed"]'))), 'staff mark a thread fixed in a version; the thread shows it and stops offering it');
    ok(errs.length === 0, `no page errors in moderation (${JSON.stringify(errs.slice(0, 2))})`); await p.close(); }
} catch (e) { fails++; console.log('FAIL the suite threw:', e.message); }
await b.close(); await server.close();
console.log(fails ? `${fails} check(s) failed` : 'ALL PASS'); process.exit(fails ? 1 : 0);
