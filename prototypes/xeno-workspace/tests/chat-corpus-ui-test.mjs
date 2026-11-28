// chat-corpus-ui-test — a Chat project's Corpus in the REAL chat app, from the production build (dist/), on the
// chat host the way nginx serves it (xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md §3.3). The API is a
// stand-in; the server half is proven on real Postgres by scripts/chat-corpus.test.mjs.
// Proves: /projects/<id>/corpus opens the Corpus inside the host, titled Corpus, with every source and its state in words (never a
// failed source that looks fine); the switch sends the change; a refresh lands on the Corpus; Back to the project goes
// to the project's own address; the page's first address (/notebook) lands on /corpus; and under a Corpus answer the cited sources are marked and an invented mark is named.
//   npx vite build && node prototypes/xeno-workspace/tests/chat-corpus-ui-test.mjs   (SHOT=1 saves screenshots)
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), dist = path.join(repo, 'dist');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
if (!fs.existsSync(path.join(dist, 'workspace', 'chat.html'))) throw new Error('build first: npx vite build');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const USER = { id: 7, username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const PID = '0000000a-0000-4000-8000-00000000000a', CID = '0000000c-0000-4000-8000-00000000000c';
const F1 = '00000f01-0000-4000-8000-000000000001', F2 = '00000f02-0000-4000-8000-000000000002', F3 = '00000f03-0000-4000-8000-000000000003', F4 = '00000f04-0000-4000-8000-000000000004';
const S = { patches: [] };
const SOURCES = () => [
  { id: F1, kind: 'file', title: 'policy.md', mimeType: 'text/markdown', selected: S.patches.find((p) => p.id === F1)?.selected ?? true, state: 'indexed', reason: null, passages: 3, addedAt: '2026-11-28T10:00:00Z' },
  { id: F2, kind: 'file', title: 'scan.pdf', mimeType: 'application/pdf', selected: true, state: 'failed', reason: 'NOTEBOOK_SOURCE_EMPTY: the extractor returned no readable text for this source', passages: 0, addedAt: '2026-11-28T10:01:00Z' },
  { id: F3, kind: 'file', title: 'old-notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', selected: true, state: 'stale', reason: 'file_changed', passages: 0, addedAt: '2026-11-28T10:02:00Z' },
  { id: F4, kind: 'file', title: 'new.md', mimeType: 'text/markdown', selected: true, state: 'queued', reason: null, passages: 0, addedAt: '2026-11-28T10:03:00Z' },
];
const PROJECT = { id: PID, name: 'Policies', description: '', custom_instructions: '', is_archived: false, updated_at: '2026-11-28T10:00:00Z', created_at: '2026-11-28T09:00:00Z', files: [] };
const CONVERSATION = {
  id: CID, title: 'Returns', project_id: PID, model_id: 'm', created_at: '2026-11-28T10:00:00Z', updated_at: '2026-11-28T10:05:00Z',
  messages: [
    { id: 'u1', role: 'user', content: 'How long do customers have to return an order?', message_index: 0, parent_id: null, created_at: '2026-11-28T10:04:00Z' },
    { id: 'a1', role: 'assistant', content: 'A customer has thirty days with a receipt [1]. Consoles fly [9].', message_index: 1, parent_id: 'u1', created_at: '2026-11-28T10:05:00Z',
      project_sources: [
        { asset_id: F1, chunk_id: 'c1', ordinal: 0, locator: { heading: 'Returns' }, display_name: 'policy.md', mime_type: 'text/markdown' },
        { asset_id: F1, chunk_id: 'c2', ordinal: 1, locator: { heading: 'Shipping' }, display_name: 'policy.md', mime_type: 'text/markdown' },
      ],
      corpus_citations: { ok: false, mode: 'full', citations: [{ n: 1, passageId: 'p_1', assetId: F1, anchor: { heading: 'Returns' }, source: 'policy.md' }], refused: [{ mark: '[9]', why: 'there is no given passage 9 (the model was given 2)' }] } },
  ],
};
CONVERSATION.active_leaf_id = 'a1'; CONVERSATION.branches = CONVERSATION.messages;
const file = (res, f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const json = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/auth/me' || u.pathname === '/api/auth/validate') return json({ success: true, valid: true, user: USER });
    if (u.pathname === '/api/auth/onboarding') return json({ success: true, done: true, welcomeAcknowledged: true });
    if (u.pathname === '/api/auth/activation-status') return json({ success: true, activated: true });
    if (u.pathname === '/api/chat/conversations') return json({ success: true, conversations: [{ ...CONVERSATION, messages: undefined, branches: undefined }], total: 1 });
    if (u.pathname === `/api/chat/conversations/${CID}`) return json({ success: true, conversation: CONVERSATION });
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [PROJECT] });
    if (u.pathname === `/api/chat/projects/${PID}`) return json({ success: true, project: PROJECT });
    if (u.pathname === `/api/chat/projects/${PID}/files`) return json({ success: true, files: [] });
    if (u.pathname === `/api/chat/projects/${PID}/corpus`) return json({ success: true, corpus: { projectId: PID, passageVersion: 'notebook-passages/1', sources: SOURCES() } });
    const m = u.pathname.match(new RegExp(`^/api/chat/projects/${PID}/corpus/sources/([^/]+)$`));
    if (m && req.method === 'PATCH') {
      let body = ''; req.on('data', (c) => { body += c; });
      return req.on('end', () => { const b = JSON.parse(body || '{}'); S.patches.push({ id: m[1], selected: b.selected }); json({ success: true, source: { id: m[1], selected: b.selected } }); });
    }
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    if (u.pathname === '/api/models') return json({ success: true, models: [] });
    return json({ success: true });
  }
  if (u.pathname === '/env-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__ENV__={};'); }
  if (/^\/chat(\/|$)/.test(u.pathname)) return file(res, path.join(dist, 'index.html'));
  if (/^\/((c|projects|library|images)(\/[^.]*)?)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'chat.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const HOST = 'http://chat.localhost:' + server.address().port;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
const frameOf = async (p) => { const el = await p.$('#xw-chat-frame'); return el ? el.contentFrame() : null; };
const inFrame = async (p, fn, arg, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const fr = await frameOf(p);
    if (fr) { const v = await fr.evaluate(fn, arg).catch(() => null); if (v) return v; }
    await settle(300);
  }
  return null;
};
const shot = async (p, name) => { if (!process.env.SHOT) return; const f = path.join(repo, 'scratchpad', `chat-corpus-${name}.png`); fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); console.log('SHOT', f); };
try {
  const p = await br.newPage(); await p.setViewport({ width: 1600, height: 950 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(HOST + `/projects/${PID}/corpus`, { waitUntil: 'domcontentloaded' });
  const rows = await inFrame(p, () => {
    const page = document.querySelector('[data-chat-corpus]');
    const li = [...document.querySelectorAll('[data-corpus-source]')];
    return page && li.length === 4 ? li.map((x) => ({ id: x.dataset.corpusSource, state: x.dataset.state, text: x.innerText })) : null;
  });
  await shot(p, 'page');
  ok(!!rows, '/projects/<id>/corpus opens the Corpus inside the chat host, with all four sources');
  const title = await inFrame(p, () => document.querySelector('[data-chat-corpus] h1')?.innerText?.trim() || null);
  ok(title === 'Corpus', `the page is titled Corpus (${title})`);
  ok(!(await inFrame(p, () => /notebook/i.test(document.querySelector('[data-chat-corpus]')?.innerText || '') ? 'yes' : null, null, 1500)), 'and no word on it says notebook');
  const by = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  ok(by[F1]?.state === 'indexed' && /3 passages/i.test(by[F1]?.text), 'an indexed file says how many passages it has');
  ok(by[F2]?.state === 'failed' && /Couldn.t read/i.test(by[F2]?.text) && /no readable text/i.test(by[F2]?.text), 'a file with no readable text says so, with the reason (never looks fine)');
  ok(by[F3]?.state === 'stale' && /Out of date/i.test(by[F3]?.text) && /changed/i.test(by[F3]?.text), 'a stale file says it is out of date and why');
  ok(by[F4]?.state === 'queued' && /Reading/i.test(by[F4]?.text), 'a file still being read says so');
  const summary = await inFrame(p, () => document.querySelector('[data-corpus-summary]')?.innerText || null);
  ok(/1 source/.test(summary || ''), `the summary counts only sources answers really use (${summary})`);
  ok(await p.evaluate(() => location.pathname) === `/projects/${PID}/corpus`, 'the host address is the Corpus\'s own');

  // the switch
  const fr = await frameOf(p);
  await fr.click(`[data-corpus-source="${F1}"] [role="switch"], [data-corpus-source="${F1}"] button`);
  await settle(800);
  ok(S.patches.some((x) => x.id === F1 && x.selected === false), 'turning a file off sends the change');
  const dimmed = await inFrame(p, (id) => { const el = document.querySelector(`[data-corpus-source="${id}"]`); return el && Number(getComputedStyle(el).opacity) < 1 ? 'yes' : null; }, F1, 5000);
  ok(dimmed === 'yes', 'and the row shows it is off');

  // refresh, then back to the project
  await p.reload({ waitUntil: 'domcontentloaded' });
  ok(!!(await inFrame(p, () => document.querySelectorAll('[data-corpus-source]').length === 4 || null)), 'a refresh lands on the Corpus');
  const fr2 = await frameOf(p);
  await fr2.click('[data-chat-corpus] button[aria-label="Back to the project"]');
  await settle(1200);
  const gone = await inFrame(p, () => (document.querySelector('[data-chat-corpus]') ? null : 'gone'), null, 8000);
  ok(gone === 'gone', 'Back to the project closes the Corpus');
  ok(await p.evaluate(() => location.pathname) === `/projects/${PID}`, `and the address is the project's own (${await p.evaluate(() => location.pathname)})`);

  // the page's first address: no nginx here, so this proves the app itself moves it to /corpus (no link breaks on any host)
  await p.goto(HOST + `/projects/${PID}/notebook`, { waitUntil: 'domcontentloaded' });
  const viaOld = await inFrame(p, () => (document.querySelectorAll('[data-corpus-source]').length === 4 ? 'open' : null));
  ok(viaOld === 'open', 'the old /notebook address opens the Corpus');
  let landed = null;
  for (let i = 0; i < 20 && landed !== `/projects/${PID}/corpus`; i++) { landed = await p.evaluate(() => location.pathname); if (landed !== `/projects/${PID}/corpus`) await settle(300); }
  ok(landed === `/projects/${PID}/corpus`, `and the address becomes /corpus in place (${landed})`);

  // a status pill is drawn in capitals (the element library), so the words are matched without case
  // citations under a Corpus answer
  await p.goto(HOST + `/projects/${PID}/c/${CID}`, { waitUntil: 'domcontentloaded' });
  const cites = await inFrame(p, () => {
    const box = document.querySelector('[data-project-sources]'); if (!box) return null;
    const pills = [...box.querySelectorAll('button')].map((b) => ({ id: b.id, cited: b.dataset.cited, text: b.innerText }));
    const refused = box.querySelector('[data-citations-refused]')?.innerText || '';
    return { pills, refused };
  });
  await shot(p, 'answer');
  ok(!!cites && cites.pills.length === 2, 'the answer lists the two sources it was given');
  ok(cites?.pills[0]?.cited === 'true' && cites?.pills[0]?.id === 'cite-1' && /Returns/.test(cites?.pills[0]?.text || ''), 'the cited one is marked, addressable as #cite-1, and names its heading');
  ok(cites?.pills[1]?.cited === 'false', 'the one it did not cite is not marked');
  ok(/\[9\] is not a source this answer was given/.test(cites?.refused || ''), 'an invented mark is named and not linked');
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'chat-corpus-ui: all passed'); process.exit(failed ? 1 : 0);
