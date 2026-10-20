// Corpo › Forms is real: the workspace's own forms from /api/forms (a stand-in here).
//   1. no sample mark; the list shows the server's forms
//   2. New form → the builder opens at the form's own address; adding a question and saving PATCHes the fields
//   3. a public link is shown once; opening the form PATCHes status open
//   4. responses: "Make a task" runs the action once and shows the task key
//   5. a sign-in link opens the fill view; a server error is shown on its field; a good answer shows the thanks
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5217, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const FID = '11111111-1111-4111-8111-111111111111', NEWID = '22222222-2222-4222-8222-222222222222', RID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'T'.repeat(43);
const mkForm = (id, title, extra = {}) => ({ id, title, description: '', status: 'draft', responses: 0, confirmation: 'Thanks!', autoActions: [], links: [], fields: [{ id: 'name', type: 'text', label: 'Your name', required: true }, { id: 'email', type: 'email', label: 'Email', required: true }], ...extra });
const db = { calls: [], forms: { [FID]: mkForm(FID, 'Beta sign-up', { status: 'open', responses: 1 }) }, response: { id: RID, formId: FID, answers: { name: 'Ada', email: 'ada@example.com' }, actions: {}, createdAt: new Date().toISOString() } };

async function open(p, addr) {
  await p.goto(base + addr, { waitUntil: 'domcontentloaded' }); await wait(1800);
}
async function page() {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null, M = q.method();
    if (u.pathname.startsWith('/api/forms')) db.calls.push([M, u.pathname, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    if (u.pathname === `/api/forms/public/${TOKEN}/form`) return json({ success: true, form: { title: 'Beta sign-up', description: 'Join the beta', kind: 'signin', fields: db.forms[FID].fields } });
    if (u.pathname === `/api/forms/public/${TOKEN}/responses`) { if (!sent.answers.email.includes('@')) return json({ success: false, code: 'invalid_answers', error: 'Some answers need fixing', errors: { email: 'Not an email address' } }, 422); return json({ success: true, received: true, confirmation: 'Thanks!' }); }
    if (u.pathname === '/api/forms' && M === 'GET') return json({ success: true, forms: Object.values(db.forms) });
    if (u.pathname === '/api/forms' && M === 'POST') { db.forms[NEWID] = mkForm(NEWID, sent.title, { fields: sent.fields }); return json({ success: true, form: db.forms[NEWID] }); }
    let m = u.pathname.match(/^\/api\/forms\/([0-9a-f-]{36})$/);
    if (m && M === 'GET') return json({ success: true, form: db.forms[m[1]] });
    if (m && M === 'PATCH') { Object.assign(db.forms[m[1]], { fields: sent.fields, title: sent.title, ...(sent.status ? { status: sent.status } : {}) }); return json({ success: true, form: db.forms[m[1]] }); }
    m = u.pathname.match(/^\/api\/forms\/([0-9a-f-]{36})\/links$/);
    if (m) { db.forms[m[1]].links.unshift({ id: 'l1', kind: sent.kind, live: true, createdByKind: 'human' }); return json({ success: true, link: db.forms[m[1]].links[0], url: `https://xenosystem.ai/api/forms/public/${'P'.repeat(43)}` }); }
    if (u.pathname === `/api/forms/${FID}/responses`) return json({ success: true, responses: [db.response] });
    if (u.pathname === `/api/forms/${FID}/responses/${RID}/actions`) { if (!db.response.actions[sent.action]) db.response.actions[sent.action] = { key: 'T-42' }; return json({ success: true, response: db.response }); }
    if (u.pathname.startsWith('/api/forms')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    return json({ success: false, error: 'not found' }, 404); });
  return { p, errs };
}

try {
  const { p, errs } = await page();
  await open(p, '/workspace/corpo/spaces/forms');
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-fm-page]')?.dataset.fmPage, live: !!(window.XENO_ZONE_LIVE || {})['corpo.forms'], mark: !!document.querySelector('#main [data-sample-badge]'), rows: [...document.querySelectorAll('[data-fm-open]')].map((x) => x.textContent) }));
  ok(s0.page === 'ready' && s0.live && !s0.mark && s0.rows.length === 1 && s0.rows[0].includes('Beta sign-up'), `Forms is real: no sample mark, the server's forms (${JSON.stringify(s0)})`);

  // new form → builder at its address
  await p.type('[data-fm-newtitle]', 'Feedback'); await p.click('[data-fm-new]'); await wait(1200);
  ok(db.calls.some((c) => c[0] === 'POST' && c[1] === '/api/forms' && c[2].title === 'Feedback'), 'New form POSTs the title');
  ok(await p.evaluate((id) => location.pathname === `/workspace/corpo/spaces/forms/${id}` && document.querySelector('[data-fm-view]')?.dataset.fmView === 'form', NEWID), 'the builder opens at the form’s own address');
  await p.click('[data-fm-addfield]'); await wait(300);
  await p.type('[data-fm-field="2"] [data-fm-f="label"]', 'Rating');
  await p.select('[data-fm-field="2"] [data-fm-f="type"]', 'number');
  await p.click('[data-fm-save]'); await wait(900);
  const patch = db.calls.filter((c) => c[0] === 'PATCH').pop();
  ok(patch && patch[2].fields.length === 3 && patch[2].fields[2].label === 'Rating' && patch[2].fields[2].type === 'number', `saving sends the questions (${JSON.stringify(patch && patch[2].fields)})`);

  // public link shown once; open the form
  await p.click('[data-fm-link="public"]'); await wait(900);
  ok(db.calls.some((c) => c[1].endsWith('/links') && c[2].kind === 'public') && await p.evaluate(() => !!document.querySelector('[data-fm-shown] input')?.value.includes('/api/forms/public/')), 'a public link is made and shown once');
  await p.click('[data-fm-status="open"]'); await wait(900);
  ok(db.calls.filter((c) => c[0] === 'PATCH').pop()[2].status === 'open', 'Open the form PATCHes status open');

  // responses → make a task
  await open(p, `/workspace/corpo/spaces/forms/${FID}/responses`);
  ok(await p.evaluate(() => document.querySelector('[data-fm-view]')?.dataset.fmView === 'responses' && document.body.textContent.includes('ada@example.com')), 'responses show at their own address');
  await p.click(`[data-fm-act="${RID}:task"]`); await wait(800);
  ok(db.calls.some((c) => c[1].endsWith('/actions') && c[2].action === 'task') && await p.evaluate(() => document.querySelector('[data-fm-done="task"]')?.textContent === 'T-42' && !document.querySelector('[data-fm-act$=":task"]')), 'Make a task runs once and shows the task');

  // sign-in link fill view
  await open(p, `/workspace/corpo/spaces/forms/fill/${TOKEN}`);
  ok(await p.evaluate(() => document.querySelector('[data-fm-view]')?.dataset.fmView === 'fill' && !!document.querySelector('[data-fm-fill]')), 'a sign-in link opens the fill view');
  await p.type('[data-fm-a="name"]', 'Bob'); await p.type('[data-fm-a="email"]', 'bob'); await p.click('[data-fm-submit]'); await wait(700);
  ok(await p.evaluate(() => document.querySelector('[data-fm-err="email"]')?.textContent === 'Not an email address'), 'the server’s error shows on its field');
  await p.type('[data-fm-a="name"]', 'Bob'); await p.type('[data-fm-a="email"]', 'bob@example.com'); await p.click('[data-fm-submit]'); await wait(700);
  const last = db.calls.filter((c) => c[1].endsWith('/responses') && c[0] === 'POST').pop();
  ok(last[2].answers.email === 'bob@example.com' && await p.evaluate(() => document.querySelector('[data-fm-thanks]')?.textContent === 'Thanks!'), 'a good answer is sent and the thanks shows');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
