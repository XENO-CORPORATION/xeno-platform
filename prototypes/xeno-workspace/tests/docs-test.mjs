import { shot } from './shot.mjs';
// Office › Write and Notes are real, and they are XENO Docs (against a stand-in /api/workspace-docs).
//   1. neither area shows sample rows or the sample mark; the editor on the page is XENO Docs' (docs-editor.js,
//      built from @xenosystem/blocks/docs), loaded on first use
//   2. create → type with the toolbar → Save sends a .xdoc with the expected version; the address carries the file id
//      and a fresh page on that address opens the same document
//   3. a document never becomes markup: tags typed as text stay text; a stored file carrying a javascript: link, an
//      html node or an image with an onerror handler opens READ-ONLY and renders none of it; a pasted <img onerror>
//      and <script> are dropped by the schema; the Link dialog refuses a javascript: address
//   4. a page link (XENO Notes' mark) opens its document; the note lists what links to it; search sends q;
//      delete → Undo; restore a version; share
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
const NOTE = '11111111-1111-4111-8111-111111111111', EVIL = '22222222-2222-4222-8222-222222222222', TAGS = '33333333-3333-4333-8333-333333333333';
let vseq = 0; const vid = () => `aaaaaaaa-0000-4000-8000-${String(++vseq).padStart(12, '0')}`;
const para = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] });
const text = (c) => JSON.stringify(c).match(/"text":"([^"]*)"/g)?.map((x) => x.slice(8, -1)).join('') || '';
const db = { calls: [], docs: new Map(), trash: new Set() };
const put = (d) => { db.docs.set(d.id, d); return d; };
put({ id: NOTE, kind: 'note', title: 'Meeting notes', content: para({ type: 'text', text: 'Agreed.' }), versions: [] });
// a file a compromised store (or a bug) might hand the client: the editor must refuse to render any of it
put({ id: EVIL, kind: 'doc', title: 'Hostile', content: { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'click me', marks: [{ type: 'link', attrs: { href: 'javascript:window.__pwned=2' } }] }] },
  { type: 'image', attrs: { src: 'https://a.example/x.png', onerror: 'window.__pwned=4' } },
  { type: 'html', attrs: { html: '<img src=x onerror="window.__pwned=5">' } },
] }, versions: [] });
// a valid document whose WORDS look like markup
put({ id: TAGS, kind: 'doc', title: 'Tags as words', content: para({ type: 'text', text: '<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=3</script>' }), versions: [] });
for (const d of db.docs.values()) d.versions.push({ id: vid(), content: d.content, title: d.title });
const xdocOf = (d) => ({ format: 'xeno.xdoc', version: 1, title: d.title, content: d.content, created: 1, lastModified: 2, wordCount: 0 });
const view = (d) => ({ id: d.id, versionId: d.versions.at(-1).id, kind: d.kind, title: d.title, excerpt: text(d.content).slice(0, 40), updatedAt: new Date().toISOString(), format: 'xdoc', xdoc: xdocOf(d), content: d.content, canEdit: true });
const backlinks = (id) => [...db.docs.values()].filter((x) => !db.trash.has(x.id) && JSON.stringify(x.content).includes(`"pageId":"${id}"`)).map(view);

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
      return json({ success: true, docs: [...db.docs.values()].filter((d) => d.kind === k && !db.trash.has(d.id) && (!s || (d.title + text(d.content)).toLowerCase().includes(s))).map(view) }); }
    if (u.pathname === '/api/workspace-docs' && q.method() === 'POST') { const c = para(); const d = put({ id: crypto.randomUUID(), kind: sent.kind, title: sent.title, content: c, versions: [{ id: vid(), content: c, title: sent.title }] }); return json({ success: true, doc: view(d), backlinks: [] }); }
    let m = u.pathname.match(/^\/api\/workspace-docs\/([^/]+)(\/.*)?$/);
    if (m) { const d = db.docs.get(m[1]), rest = m[2] || '';
      if (!d || (db.trash.has(d.id) && rest !== '/untrash')) return json({ success: false, code: 'not_found', error: 'Document not found' }, 404);
      if (!rest && q.method() === 'GET') return json({ success: true, doc: view(d), backlinks: backlinks(d.id) });
      if (!rest && q.method() === 'PUT') { if (sent.expectedVersion !== d.versions.at(-1).id) return json({ success: false, code: 'version_conflict', error: 'newer' }, 409);
        const f = JSON.parse(sent.xdoc); Object.assign(d, { title: sent.title, content: f.content }); d.versions.push({ id: vid(), content: f.content, title: sent.title }); return json({ success: true, doc: view(d), backlinks: backlinks(d.id) }); }
      if (rest === '/versions') return json({ success: true, versions: [...d.versions].reverse().map((v, i) => ({ id: v.id, createdAt: new Date().toISOString(), current: i === 0 })) });
      let r = rest.match(/^\/versions\/([^/]+)\/restore$/);
      if (r) { const v = d.versions.find((x) => x.id === r[1]); Object.assign(d, { content: v.content, title: v.title }); d.versions.push({ id: vid(), content: v.content, title: v.title }); return json({ success: true, doc: view(d), backlinks: backlinks(d.id) }); }
      if (rest === '/trash') { db.trash.add(d.id); return json({ success: true, trashed: true, id: d.id }); }
      if (rest === '/untrash') { db.trash.delete(d.id); return json({ success: true, doc: view(d), backlinks: [] }); } }
    m = u.pathname.match(/^\/api\/library\/assets\/file\/([^/]+)\/shares$/);
    if (m) return json({ success: true, share: { id: 's1' } });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(2200); await shot(p, 'docs');
  return { p, errs };
}
const editorText = (p) => p.evaluate(() => document.querySelector('[data-dc-body] .ProseMirror')?.textContent ?? null);

try {
  // ── 1. honest areas, and the editor is XENO Docs'
  { const { p, errs } = await open('#/office/z/write');
    for (const z of ['write', 'notes']) {
      if (z === 'notes') { await p.evaluate(() => { location.hash = '#/office/z/notes'; }); await wait(700); }
      const s = await p.evaluate((z) => ({ live: !!(window.XENO_ZONE_LIVE || {})['office.' + z], page: document.querySelector('[data-dc-page]')?.dataset.dcPage, mark: !!document.querySelector('#main [data-sample-badge]'), panelMark: !!document.querySelector('#panel [data-sample-badge]'), sample: /Q4 planning|Product principles|Hiring plan/.test(document.getElementById('main').textContent) }), z);
      ok(s.live && s.page === 'ready' && !s.mark && !s.panelMark && !s.sample, `${z}: real, no sample rows or mark (${JSON.stringify(s)})`);
    }
    ok(await p.evaluate(() => !window.XenoDocs), 'the editor is not loaded until a document opens');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }

  // ── 2. create, edit with the toolbar, save, real address
  let created;
  { const { p, errs } = await open('#/office/z/write');
    ok(await p.$('#main .topbar .pg-top-acts [data-dc-new="write"]') !== null && await p.$('#main .mview [data-dc-new], #main .mview [data-dc-title-new]') === null, 'New document sits right in the header bar, not as a field in the body');
    await p.click('#main .topbar [data-dc-new]'); await wait(300);
    ok(await p.$('.xd-sh[role="dialog"] #xdf-title') !== null, 'New document opens the workspace dialog');
    await p.type('.xd-sh #xdf-title', 'Q4 plan'); await p.click('.xd-sh [data-xd-submit]'); await wait(1600);
    created = [...db.docs.values()].find((d) => d.title === 'Q4 plan');
    const addr = await p.evaluate(() => [window.XENO_ADDR.current().split('?')[0], location.pathname]);
    ok(created && addr[0] === `#/office/z/write/${created.id}` && addr[1] === `/workspace/office/spaces/write/${created.id}`, `a new document opens at its file id (${addr.join(' ')})`);
    const lib = await p.evaluate(() => ({ built: window.XenoDocs?.BUILT_FROM, surface: !!document.querySelector('[data-dc-body] [data-xeno-document-surface].ProseMirror'), controller: !!window.XENO_ZONE_LIVE['office.write'].controller() }));
    ok(/^@xenosystem\/blocks@[\d.]+\/docs /.test(lib.built || '') && lib.surface && lib.controller, `the editor is XENO Docs’ own, mounted from @xenosystem/blocks/docs (${JSON.stringify(lib)})`);
    await p.click('[data-dc-body] .ProseMirror'); await p.keyboard.type('Ship the ');
    await p.click('[data-dc-fmt="bold"]'); await p.keyboard.type('ledger'); await p.click('[data-dc-fmt="bold"]'); await p.keyboard.type(' first. ');
    ok(await p.evaluate(() => document.querySelector('[data-dc-state]')?.textContent) === 'Unsaved changes', 'an edit shows Unsaved changes');
    await p.click('[data-dc-fmt="doclink"]'); await wait(200); await p.click(`[data-dc-linkto="${TAGS}"]`); await wait(300);
    // a re-render (the picker closing repaints the page) keeps the live editor and its words
    const kept = await editorText(p);
    ok(kept?.includes('Ship the ledger first.'), `the editor survives a re-render of the page (${JSON.stringify(kept)})`);
    const before = created.versions.at(-1).id;
    await p.click('[data-dc-save]'); await wait(900);
    const save = db.calls.find((c) => c[0] === 'PUT');
    const f = save && JSON.parse(save[2].xdoc);
    const bold = f && JSON.stringify(f.content).includes('{"type":"text","marks":[{"type":"bold"}],"text":"ledger"}');
    ok(save && save[2].expectedVersion === before && f.format === 'xeno.xdoc' && bold, `Save sends a .xdoc and the version it was made on (${save && save[2].xdoc.slice(0, 160)})`);
    ok(f && JSON.stringify(f.content).includes(`"pageId":"${TAGS}"`), 'a link to another document is XENO Notes’ wikiLink mark, by file id');
    ok(await p.evaluate(() => document.querySelector('[data-dc-state]')?.textContent) === 'Saved', 'after the save it says Saved');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close();
    const again = await open(`#/office/z/write/${created.id}`);
    const t = await again.p.evaluate(() => ({ title: document.querySelector('[data-dc-title]')?.value, bold: document.querySelector('[data-dc-body] strong')?.textContent, link: document.querySelector('[data-dc-body] span[data-wiki-link]')?.dataset.pageId }));
    ok(t.title === 'Q4 plan' && t.bold === 'ledger' && t.link === TAGS, `a fresh page on the address opens the same document (${JSON.stringify(t)})`);
    await again.p.close(); }

  // ── 3. nothing a document carries becomes markup
  { const { p, errs } = await open(`#/office/z/write/${TAGS}`);
    const s = await p.evaluate(() => { const body = document.querySelector('[data-dc-body]'); return { pwned: window.__pwned || 0, img: !!body.querySelector('img'), script: !!body.querySelector('script'), text: body.textContent.includes('<img src=x') && body.textContent.includes('<script>') }; });
    ok(!s.pwned && !s.img && !s.script && s.text, `words that look like tags are shown as words, never run (${JSON.stringify(s)})`);
    // a paste is parsed by the schema: an onerror handler, a script and a javascript: link never enter the document
    await p.click('[data-dc-body] .ProseMirror');
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/html', '<p>pasted<img src="x" onerror="window.__pwned=6"><script>window.__pwned=7</script><a href="javascript:window.__pwned=8">bad</a></p>'); dt.setData('text/plain', 'pasted');
      document.querySelector('[data-dc-body] .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await wait(300);
    const pasted = await p.evaluate(() => { const body = document.querySelector('[data-dc-body]'); return { pwned: window.__pwned || 0, html: body.innerHTML, words: body.textContent.includes('pasted'),
      elements: body.querySelectorAll('img, script, [onerror], a[href^="javascript" i]').length }; });
    // the document's own WORDS contain 'onerror' and '<script>' (that is the point of it); what must not exist is an ELEMENT
    ok(pasted.words && !pasted.pwned && pasted.elements === 0, `a pasted <img onerror>, <script> and javascript: link are dropped by the schema (${JSON.stringify({ pwned: pasted.pwned, words: pasted.words, html: pasted.html.replace(/^.*?ProseMirror[^>]*>/, '').slice(0, 300) })})`);
    // the Link dialog refuses a javascript: address
    await p.click('[data-dc-fmt="link"]'); await wait(300);
    await p.type('.xd-sh #xdf-href', 'javascript:window.__pwned=9'); await p.click('.xd-sh [data-xd-submit]'); await wait(300);
    const refused = await p.evaluate(() => ({ still: !!document.querySelector('.xd-sh[role="dialog"]'), err: document.querySelector('.xd-sh .xd-err:not([hidden])')?.textContent || '' }));
    ok(refused.still && /https/.test(refused.err), `the Link dialog refuses a javascript: address (${JSON.stringify(refused)})`);
    await p.keyboard.press('Escape'); await wait(200);
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }
  { const { p, errs } = await open(`#/office/z/write/${EVIL}`);
    const s = await p.evaluate(() => { const body = document.querySelector('[data-dc-body]'); const live = window.XENO_ZONE_LIVE['office.write'].controller().getState();
      return { pwned: window.__pwned || 0, img: !!body.querySelector('img'), js: [...body.querySelectorAll('a')].some((a) => /javascript:/i.test(a.getAttribute('href') || '')), words: body.textContent.includes('click me'), readOnly: live.readOnly, status: live.status,
        note: document.querySelector('[data-dc-note]')?.textContent || '', tools: !!document.querySelector('[data-dc-fmt]'), editable: document.querySelector('[data-dc-body] .ProseMirror')?.getAttribute('contenteditable') }; });
    ok(!s.pwned && !s.img && !s.js && !s.words, `a hostile stored file renders nothing of itself (${JSON.stringify(s)})`);
    ok(s.readOnly && s.status === 'unsupported' && /XENO Docs/.test(s.note) && !s.tools && s.editable === 'false', 'it opens read-only, says why, and offers no toolbar or Save');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }

  // ── 4. page links, backlinks, search, delete/undo, versions, share
  { const n = db.docs.get(NOTE); n.content = para({ type: 'text', text: 'See ' }, { type: 'text', text: 'the plan', marks: [{ type: 'wikiLink', attrs: { pageId: created.id, pageTitle: 'Q4 plan' } }] }, { type: 'text', text: '.' }); n.versions.push({ id: vid(), content: n.content, title: n.title });
    const { p, errs } = await open(`#/office/z/notes/${NOTE}`);
    await p.click(`[data-dc-body] span[data-wiki-link][data-page-id="${created.id}"]`); await wait(1200);
    ok((await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/write/${created.id}`, 'clicking a page link opens that document in Write, by id (XENO Notes’ behaviour)');
    const bl = await p.evaluate(() => [...document.querySelectorAll('[data-dc-backlinks] a')].map((a) => a.textContent));
    ok(bl.join() === 'Meeting notes', `the plan lists the note that links to it (${bl.join()})`);
    await p.click('[data-dc-backlinks] a'); await wait(1000);
    ok((await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/notes/${NOTE}`, 'a backlink opens the note in Notes, by id');
    await p.evaluate(() => { location.hash = '#/office/z/write'; }); await wait(700);
    db.calls.length = 0; await p.type('[data-dc-search]', 'ledger'); await wait(900);
    const sq = db.calls.find((c) => c[0] === 'GET' && c[1].includes('q=ledger'));
    ok(sq && (await p.evaluate(() => [...document.querySelectorAll('[data-dc-list] b')].map((x) => x.textContent).join())) === 'Q4 plan', 'search asks the server and lists what matches');
    await p.evaluate((id) => { location.hash = `#/office/z/write/${id}`; }, created.id); await wait(1000);
    await p.click('[data-dc-history]'); await wait(500);
    const vers = await p.evaluate(() => document.querySelectorAll('[data-dc-restore]').length);
    await p.click('[data-dc-restore]'); await wait(1000);
    ok(vers >= 1 && db.calls.some((c) => /\/versions\/[^/]+\/restore$/.test(c[1])) && (await editorText(p))?.trim() === '', `restoring an earlier version brings back its contents in the editor (${vers} earlier)`);
    await p.click('[data-dc-trash]'); await wait(900);
    ok(db.trash.has(created.id) && (await p.evaluate(() => !!document.querySelector('[data-dc-undone]'))), 'Delete moves it to the trash and offers Undo');
    await p.click(`[data-dc-untrash="${created.id}"]`); await wait(1000);
    ok(!db.trash.has(created.id) && (await p.evaluate(() => window.XENO_ADDR.current().split('?')[0])) === `#/office/z/write/${created.id}`, 'Undo brings it back and reopens it');
    await p.type('[data-dc-share-with]', 'ada@example.test'); await p.select('[data-dc-share-role]', 'editor'); await p.click('[data-dc-share]'); await wait(500);
    const sh = db.calls.find((c) => c[0] === 'POST' && c[1] === `/api/library/assets/file/${created.id}/shares`);
    ok(sh && sh[2].with === 'ada@example.test' && sh[2].role === 'editor', 'Share uses Storage’s sharing for the file');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`); await p.close(); }
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
