// Office › Write and Notes are real (against a stand-in /api/workspace-docs).
//   1. neither area shows sample rows or the sample mark
//   2. create → type with the toolbar → Save sends Markdown with the expected version; the address carries the file id
//      and a fresh page on that address opens the same document
//   3. stored Markdown never becomes markup: an <img onerror>, a javascript: link and raw tags render as text
//   4. a link to a note opens it; the note lists what links to it; search sends q; delete → Undo; restore a version
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5213, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const NOTE = '11111111-1111-4111-8111-111111111111', EVIL = '22222222-2222-4222-8222-222222222222';
let vseq = 0; const vid = () => `aaaaaaaa-0000-4000-8000-${String(++vseq).padStart(12, '0')}`;
const db = { calls: [], docs: new Map(), trash: new Set() };
const put = (d) => { db.docs.set(d.id, d); return d; };
put({ id: NOTE, kind: 'note', title: 'Meeting notes', markdown: 'Agreed.', versions: [{ id: vid(), markdown: 'Agreed.', title: 'Meeting notes' }] });
put({ id: EVIL, kind: 'doc', title: 'Pasted', markdown: '<img src=x onerror="window.__pwned=1"> and [click](javascript:window.__pwned=2) and <script>window.__pwned=3</script>', versions: [{ id: vid(), markdown: '', title: 'Pasted' }] });
const view = (d) => ({ id: d.id, versionId: d.versions.at(-1).id, kind: d.kind, title: d.title, excerpt: d.markdown.slice(0, 40), updatedAt: new Date().toISOString(), markdown: d.markdown, canEdit: true });
const backlinks = (id) => [...db.docs.values()].filter((x) => !db.trash.has(x.id) && x.markdown.includes(`xeno-doc:${id}`)).map(view);

async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/workspace-docs') || u.pathname.startsWith('/api/library/assets/file')) db.calls.push([q.method(), u.pathname + u.search, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/workspace-docs' && q.method() === 'GET') { const k = u.searchParams.get('kind'), s = (u.searchParams.get('q') || '').toLowerCase();
      return json({ success: true, docs: [...db.docs.values()].filter((d) => d.kind === k && !db.trash.has(d.id) && (!s || (d.title + d.markdown).toLowerCase().includes(s))).map(view) }); }
    if (u.pathname === '/api/workspace-docs' && q.method() === 'POST') { const d = put({ id: crypto.randomUUID(), kind: sent.kind, title: sent.title, markdown: sent.markdown, versions: [{ id: vid(), markdown: sent.markdown, title: sent.title }] }); return json({ success: true, doc: view(d), backlinks: [] }); }
    let m = u.pathname.match(/^\/api\/workspace-docs\/([^/]+)(\/.*)?$/);
    if (m) { const d = db.docs.get(m[1]), rest = m[2] || '';
      if (!d || (db.trash.has(d.id) && rest !== '/untrash')) return json({ success: false, code: 'not_found', error: 'Document not found' }, 404);
      if (!rest && q.method() === 'GET') return json({ success: true, doc: view(d), backlinks: backlinks(d.id) });
      if (!rest && q.method() === 'PUT') { if (sent.expectedVersion !== d.versions.at(-1).id) return json({ success: false, code: 'version_conflict', error: 'newer' }, 409);
        Object.assign(d, { title: sent.title, markdown: sent.markdown }); d.versions.push({ id: vid(), markdown: sent.markdown, title: sent.title }); return json({ success: true, doc: view(d), backlinks: backlinks(d.id) }); }
      if (rest === '/versions') return json({ success: true, versions: [...d.versions].reverse().map((v, i) => ({ id: v.id, createdAt: new Date().toISOString(), current: i === 0 })) });
      let r = rest.match(/^\/versions\/([^/]+)\/restore$/);
      if (r) { const v = d.versions.find((x) => x.id === r[1]); Object.assign(d, { markdown: v.markdown, title: v.title }); d.versions.push({ id: vid(), markdown: v.markdown, title: v.title }); return json({ success: true, doc: view(d), backlinks: backlinks(d.id) }); }
      if (rest === '/trash') { db.trash.add(d.id); return json({ success: true, trashed: true, id: d.id }); }
      if (rest === '/untrash') { db.trash.delete(d.id); return json({ success: true, doc: view(d), backlinks: [] }); } }
    m = u.pathname.match(/^\/api\/library\/assets\/file\/([^/]+)\/shares$/);
    if (m) return json({ success: true, share: { id: 's1' } });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}

try {
  // ── 1. honest areas
  { const { p, errs } = await open('#/office/z/write');
    for (const z of ['write', 'notes']) {
      if (z === 'notes') { await p.evaluate(() => { location.hash = '#/office/z/notes'; }); await wait(700); }
      const s = await p.evaluate((z) => ({ live: !!(window.XENO_ZONE_LIVE || {})['office.' + z], page: document.querySelector('[data-dc-page]')?.dataset.dcPage, mark: !!document.querySelector('#main [data-sample-badge]'), panelMark: !!document.querySelector('#panel [data-sample-badge]'), sample: /Q4 planning|Product principles|Hiring plan/.test(document.getElementById('main').textContent) }), z);
      ok(s.live && s.page === 'ready' && !s.mark && !s.panelMark && !s.sample, `${z}: real, no sample rows or mark (${JSON.stringify(s)})`);
    }
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }

  // ── 2. create, edit with the toolbar, save, real address
  let created;
  { const { p, errs } = await open('#/office/z/write');
    await p.type('[data-dc-title-new]', 'Q4 plan'); await p.click('[data-dc-create]'); await wait(900);
    created = [...db.docs.values()].find((d) => d.title === 'Q4 plan');
    const addr = await p.evaluate(() => [window.XENO_ADDR.current().split('?')[0], location.pathname]);
    ok(created && addr[0] === `#/office/z/write/${created.id}` && addr[1] === `/workspace/office/spaces/write/${created.id}`, `a new document opens at its file id (${addr.join(' ')})`);
    await p.click('[data-dc-body]'); await p.keyboard.type('Ship the ');
    await p.click('[data-dc-fmt="bold"]'); await p.keyboard.type('ledger'); await p.click('[data-dc-fmt="bold"]'); await p.keyboard.type(' first.');
    await p.click('[data-dc-fmt="doclink"]'); await wait(200); await p.click(`[data-dc-linkto]`).catch(() => {}); await wait(200);
    const before = created.versions.at(-1).id;
    await p.click('[data-dc-save]'); await wait(800);
    const save = db.calls.find((c) => c[0] === 'PUT');
    ok(save && save[2].expectedVersion === before && /Ship the \*\*ledger\*\* first\./.test(save[2].markdown), `Save sends Markdown and the version it was made on (${JSON.stringify(save && save[2])})`);
    ok(/\]\(xeno-doc:[0-9a-f-]{36}\)/.test(save[2].markdown), 'a link to another document is saved as xeno-doc:<id>');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
    const again = await open(`#/office/z/write/${created.id}`);
    const t = await again.p.evaluate(() => ({ title: document.querySelector('[data-dc-title]')?.value, bold: document.querySelector('[data-dc-body] strong')?.textContent }));
    ok(t.title === 'Q4 plan' && t.bold === 'ledger', `a fresh page on the address opens the same document (${JSON.stringify(t)})`);
    await again.p.close(); }

  // ── 3. no markup from stored Markdown
  { const { p, errs } = await open(`#/office/z/write/${EVIL}`);
    const s = await p.evaluate(() => { const body = document.querySelector('[data-dc-body]'); return { pwned: window.__pwned || 0, img: !!body.querySelector('img'), script: !!body.querySelector('script'), js: [...body.querySelectorAll('a')].some((a) => /javascript:/i.test(a.getAttribute('href') || '')), text: body.textContent.includes('<img src=x') }; });
    ok(!s.pwned && !s.img && !s.script && !s.js && s.text, `stored Markdown is shown as text, never run (${JSON.stringify(s)})`);
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }

  // ── 4. links, backlinks, search, delete/undo, versions
  { const n = db.docs.get(NOTE); n.markdown = `See [the plan](xeno-doc:${created.id}).`; n.versions.push({ id: vid(), markdown: n.markdown, title: n.title });
    const { p, errs } = await open(`#/office/z/notes/${NOTE}`);
    await p.click(`[data-dc-body] a[data-doc-link="${created.id}"]`).catch(() => {}); await wait(300);
    ok((await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/notes/${NOTE}`, 'clicking a link while editing does not navigate');
    await p.evaluate((id) => { location.hash = `#/office/z/write/${id}`; }, created.id); await wait(900);
    const bl = await p.evaluate(() => [...document.querySelectorAll('[data-dc-backlinks] a')].map((a) => a.textContent));
    ok(bl.join() === 'Meeting notes', `the plan lists the note that links to it (${bl.join()})`);
    await p.click('[data-dc-backlinks] a'); await wait(900);
    ok((await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/notes/${NOTE}`, 'a backlink opens the note in Notes, by id');
    await p.evaluate(() => { location.hash = '#/office/z/write'; }); await wait(700);
    db.calls.length = 0; await p.type('[data-dc-search]', 'ledger'); await wait(900);
    const sq = db.calls.find((c) => c[0] === 'GET' && c[1].includes('q=ledger'));
    ok(sq && (await p.evaluate(() => [...document.querySelectorAll('[data-dc-list] b')].map((x) => x.textContent).join())) === 'Q4 plan', 'search asks the server and lists what matches');
    await p.evaluate((id) => { location.hash = `#/office/z/write/${id}`; }, created.id); await wait(900);
    await p.click('[data-dc-history]'); await wait(500);
    const vers = await p.evaluate(() => document.querySelectorAll('[data-dc-restore]').length);
    await p.click('[data-dc-restore]'); await wait(900);
    ok(vers >= 1 && db.calls.some((c) => /\/versions\/[^/]+\/restore$/.test(c[1])) && (await p.evaluate(() => document.querySelector('[data-dc-body]').textContent.trim())) === '', `restoring an earlier version brings back its contents (${vers} earlier)`);
    await p.click('[data-dc-trash]'); await wait(900);
    ok(db.trash.has(created.id) && (await p.evaluate(() => !!document.querySelector('[data-dc-undone]'))), 'Delete moves it to the trash and offers Undo');
    await p.click(`[data-dc-untrash="${created.id}"]`); await wait(900);
    ok(!db.trash.has(created.id) && (await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/write/${created.id}`, 'Undo brings it back and reopens it');
    await p.type('[data-dc-share-with]', 'ada@example.test'); await p.select('[data-dc-share-role]', 'editor'); await p.click('[data-dc-share]'); await wait(500);
    const sh = db.calls.find((c) => c[0] === 'POST' && c[1] === `/api/library/assets/file/${created.id}/shares`);
    ok(sh && sh[2].with === 'ada@example.test' && sh[2].role === 'editor', 'Share uses Storage’s sharing for the file');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
