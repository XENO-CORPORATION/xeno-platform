import { shot } from './shot.mjs';
// Office › Mail is a real front-end to XENO Mail: the workspace reads /api/mail (a stand-in here).
//   1. no sample threads ("Contract draft — legal") and no "Preview — sample data" mark
//   2. the folders are tabs in the header bar; Compose sits right in it and opens the workspace dialog
//   3. a thread opens at its address (/workspace/office/spaces/mail/inbox/<thread id>); a fresh tab lands on it
//   4. Reply → Send asks once more; cancelling sends nothing; confirming sends with confirm:true; Save draft never sends
//   5. an agent's draft shows who wrote it and waits for the person; mail → task / label by id
//   6. not set up / no mailbox are said plainly; the mailbox page maps this workspace to one of your addresses
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
const NOW = new Date().toISOString();
const TH = 'th-1@mail';
const THREAD = { thread_id: TH, unread: true, messages: [{ message_id: 'm1', from: { name: 'Ada Lovelace', email: 'ada@example.com' }, to: ['me@xenostudio.ai'], subject: 'Quarterly numbers', received_at: NOW, text: 'Can you check §4?' }] };
const db = { calls: [], configured: true, connected: true, mapped: null, agentDraft: true };

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (r) => { const u = new URL(r.url()); const json = (body, status = 200) => r.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return r.continue();
    const sent = r.postData() ? JSON.parse(r.postData()) : null, m = r.method(), pth = u.pathname;
    if (pth.startsWith('/api/mail')) db.calls.push([m, pth + u.search, sent]);
    if (pth === '/api/auth/me') return json({ success: true, user: USER });
    if (pth === '/api/mail/status') return json({ success: true, configured: db.configured, connected: db.connected, mailbox: db.mapped || 'me@xenostudio.ai', mappedAddress: db.mapped, agentDrafts: db.agentDraft ? 1 : 0 });
    if (pth === '/api/mail/labels' && m === 'GET') return json({ success: true, labels: [{ id: 'lbl_legal', name: 'Legal' }] });
    if (pth === '/api/mail/threads' && m === 'GET') return json({ success: true, threads: [{ thread_id: TH, subject: 'Quarterly numbers', from: { name: 'Ada Lovelace', email: 'ada@example.com' }, received_at: NOW, snippet: 'Can you check', unread: true }] });
    if (pth === `/api/mail/threads/${encodeURIComponent(TH)}` || pth === `/api/mail/threads/${TH}`) return json({ success: true, thread: THREAD });
    if (pth === '/api/mail/threads/read' || pth === '/api/mail/threads/label' || pth === '/api/mail/threads/archive' || pth === '/api/mail/threads/star') return json({ success: true, result: { updated: 1, requested: 1 } });
    if (pth.endsWith('/task') && m === 'POST') return json({ success: true, task: { id: 't1', key: 'T-12' } });
    if (pth === '/api/mail/drafts' && m === 'GET') return json({ success: true, drafts: db.agentDraft ? [{ draft_id: 'd9', to: ['ada@example.com'], subject: 'Re: Quarterly numbers', updated_at: NOW, byAgent: { id: 'a1', name: 'Juno' } }] : [] });
    if (pth === '/api/mail/drafts/d9' && m === 'GET') return json({ success: true, draft: { draft_id: 'd9', to: ['ada@example.com'], cc: [], subject: 'Re: Quarterly numbers', body: 'Checked, all good.', byAgent: { id: 'a1', name: 'Juno' } } });
    if (pth === '/api/mail/compose') { if (sent.send && sent.draftId === 'd9') db.agentDraft = false; return json({ success: true, sent: !!(sent.send && sent.confirm), ...(sent.send ? { result: { message_id: 's1' } } : { draft: { draft_id: 'd2' } }) }); }
    if (pth === '/api/mail/mailbox' && m === 'PUT') { db.mapped = sent.address; return json({ success: true, mappedAddress: sent.address }); }
    if (pth.startsWith('/api/mail')) return json({ success: false, error: 'unexpected ' + pth }, 500);
    if (pth === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(1800); await shot(p, 'mail-' + (++shots));
  return { p, errs };
}
let shots = 0;
const composes = () => db.calls.filter((x) => x[1].startsWith('/api/mail/compose'));

try {
  const { p, errs } = await open('/workspace/#/office/z/mail');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-ml-page]')?.dataset.mlPage, live: !!(window.XENO_ZONE_LIVE || {})['office.mail'], mark: !!document.querySelector('#main [data-sample-badge]'), fake: document.body.textContent.includes('Contract draft — legal') || document.body.textContent.includes('Invoice #2041') }));
  ok(s0.page === 'ready' && s0.live && !s0.mark && !s0.fake, `Mail is real: no sample threads, no sample mark (${JSON.stringify(s0)})`);
  ok(await p.$('[data-ml-row="th-1@mail"]') !== null, 'the inbox lists threads from XENO Mail');
  ok(await p.$('#main .topbar .pg-top-acts [data-ml-new]') !== null, 'Compose sits right in the header bar');
  ok(await p.$('#main .topbar .pg-top-tabs [data-ml-go="inbox"][aria-selected="true"]') !== null && await p.$('#main .topbar .pg-top-tabs [data-ml-go="drafts"]') !== null && await p.$('#main .mview .pg-tabs') === null, 'the folders are tabs in the header bar, not a row in the body');
  ok(/1/.test(await p.$eval('#main .topbar [data-ml-go="drafts"]', (e) => e.textContent)), 'Drafts shows the agent draft waiting for you');

  ok(!/planned, not built|Notify me when/.test(await p.$eval('#panel', (e) => e.textContent)), 'the sidebar no longer calls Mail planned');
  await p.click('#panel [data-xl-new="mail"]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-to') !== null, 'the sidebar’s Compose opens the compose dialog');
  await p.keyboard.press('Escape'); await wait(400);
  await p.click('#main .topbar [data-ml-new]'); await wait(300);
  ok(await p.$('.xd-sh[role="dialog"] #xdf-to') !== null && await p.$('#main .mview textarea') === null, 'Compose opens the workspace dialog, not a form in the page');
  await p.type('.xd-sh #xdf-to', 'grace@example.com'); await p.type('.xd-sh #xdf-subject', 'Hello'); await p.type('.xd-sh #xdf-body', 'A first note');
  await p.click('.xd-sh [data-f="how"] [data-v="draft"]'); await p.click('.xd-sh [data-xd-submit]'); await wait(800);
  ok(composes().length === 1 && composes()[0][2].send === false && composes()[0][2].to[0] === 'grace@example.com', 'Save draft saves a draft and sends nothing');

  // open the thread at its address
  await p.click('[data-ml-open="th-1@mail"]'); await wait(1000);
  const url1 = await p.evaluate(() => location.pathname);
  ok(url1 === '/workspace/office/spaces/mail/inbox/' + encodeURIComponent(TH), `a thread opens at its id address, parent in the path (${url1})`);
  ok(await p.$('[data-ml-thread]') !== null && /Can you check/.test(await p.$eval('[data-ml-thread]', (e) => e.textContent)), 'the thread shows its messages');
  ok(db.calls.some((x) => x[1].startsWith('/api/mail/threads/read') && x[2].threadIds[0] === TH && !x[2].unread), 'opening an unread thread marks it read');
  ok(/Quarterly numbers/.test(await p.$eval('#main .topbar', (e) => e.textContent)), 'the breadcrumb names the thread');
  ok(await p.$('#main .topbar .pg-top-acts [data-ml-reply]') !== null, 'Reply is the header’s primary action on a thread');

  // reply → Send → the second question; cancel sends nothing
  await p.click('#main .topbar [data-ml-reply]'); await wait(300);
  ok((await p.$eval('.xd-sh #xdf-to', (e) => e.value)) === 'ada@example.com' && /^Re: Quarterly/.test(await p.$eval('.xd-sh #xdf-subject', (e) => e.value)), 'Reply fills the recipient and subject');
  await p.type('.xd-sh #xdf-body', 'Done.'); await p.click('.xd-sh [data-xd-submit]'); await wait(400);
  const confirmText = await p.evaluate(() => [...document.querySelectorAll('.xd-sh')].map((x) => x.textContent).join(' | '));
  ok(/cannot be recalled/.test(confirmText), 'Send asks once more: it cannot be recalled');
  const before = composes().length;
  await p.evaluate(() => [...document.querySelectorAll('.xd-sh')].at(-1).querySelector('[data-xd-close]').click()); await wait(400);
  ok(composes().length === before, 'cancelling the second question sends nothing');
  await p.click('.xd-sh [data-xd-submit]'); await wait(400);
  await p.evaluate(() => [...document.querySelectorAll('.xd-sh')].at(-1).querySelector('[data-xd-ok]').click()); await wait(900);
  const sendCall = composes().at(-1);
  ok(composes().length === before + 1 && sendCall[2].send === true && sendCall[2].confirm === true && sendCall[2].threadId === TH, 'confirming sends the reply with confirm:true in the thread');

  // mail → task, label by id
  await p.click('[data-ml-totask]'); await wait(600);
  ok(db.calls.some((x) => x[0] === 'POST' && x[1].startsWith(`/api/mail/threads/${encodeURIComponent(TH)}/task`)), 'Make a task turns the thread into a XENO Task');
  await p.click('[data-ml-label]'); await wait(300);
  await p.click('.xd-sh [data-xd-submit]'); await wait(700);
  ok(db.calls.some((x) => x[1].startsWith('/api/mail/threads/label') && x[2].add[0] === 'lbl_legal'), 'labelling sends the label id, not its name');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();

  // a fresh tab on the thread's address lands on it
  const t2 = await open(url1);
  ok(await t2.p.$(`[data-ml-thread="${TH}"]`) !== null, 'a fresh tab on the address lands on the thread');
  // an agent's draft waits for the person
  await t2.p.goto(base + '/workspace/office/spaces/mail/drafts', { waitUntil: 'domcontentloaded' }); await wait(1800);
  ok(await t2.p.$('[data-ml-draft-row="d9"] [data-ml-by-agent]') !== null, 'an agent’s draft says who wrote it');
  await t2.p.click('[data-ml-draft="d9"]'); await wait(900);
  ok((await t2.p.evaluate(() => location.pathname)) === '/workspace/office/spaces/mail/drafts/d9' && await t2.p.$('[data-ml-draft-view="d9"] [data-ml-by-agent]') !== null, 'the draft opens at its address and says nothing was sent');
  await t2.p.click('[data-ml-edit]'); await wait(300);
  ok((await t2.p.$eval('.xd-sh #xdf-body', (e) => e.value)) === 'Checked, all good.', 'Review and send opens the agent’s words in the dialog');
  await t2.p.click('.xd-sh [data-xd-submit]'); await wait(400);
  await t2.p.evaluate(() => [...document.querySelectorAll('.xd-sh')].at(-1).querySelector('[data-xd-ok]').click()); await wait(1200);
  ok(composes().at(-1)[2].draftId === 'd9' && composes().at(-1)[2].confirm === true, 'the person sends the agent’s draft (it is consumed)');
  // the mailbox page maps this workspace to one of the person's addresses
  await t2.p.goto(base + '/workspace/office/spaces/mail/mailbox', { waitUntil: 'domcontentloaded' }); await wait(1800);
  await t2.p.type('[data-ml-address]', 'team@xenostudio.ai'); await t2.p.click('[data-ml-map]'); await wait(1200);
  ok(db.calls.some((x) => x[0] === 'PUT' && x[1].startsWith('/api/mail/mailbox') && x[2].address === 'team@xenostudio.ai') && /team@xenostudio\.ai/.test(await t2.p.$eval('[data-ml-current]', (e) => e.textContent)), 'the workspace is mapped to one of your addresses');
  ok(!t2.errs.length, `no page errors (${t2.errs.join(' | ')})`);
  await t2.p.close();

  // not set up / no mailbox
  db.configured = false;
  const t3 = await open('/workspace/office/spaces/mail');
  ok(await t3.p.$('[data-ml-state="not-configured"]') !== null && await t3.p.$('#main .topbar [data-ml-new]') === null, 'not set up is said plainly, with no Compose');
  await t3.p.close();
  db.configured = true; db.connected = false;
  const t4 = await open('/workspace/office/spaces/mail');
  ok(await t4.p.$('[data-ml-state="no-mailbox"]') !== null, 'no mailbox is said plainly');
  await t4.p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
