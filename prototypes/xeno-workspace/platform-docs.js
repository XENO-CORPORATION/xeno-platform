/* platform-docs.js — on the platform, Office › Write (documents) and Office › Notes are real, and they are XENO Docs.
 *
 * The editor is NOT this file's. It is XENO Docs' own — TipTap over the shared `.xdoc` schema, with XENO Docs'
 * callout / toggle / page-break nodes and XENO Notes' page-link mark — from `@xenosystem/blocks/docs`, built into
 * docs-editor.js (scripts/build-workspace-docs.mjs) and loaded the first time Write or Notes opens. This file is the
 * HOST: the list, the header, the title field, versions, sharing, and the two intents the editor raises (save,
 * open a page). The workspace used to carry its own Markdown editor here; it was a third copy of a product we have.
 *
 * Both areas read and write /api/workspace-docs (routes/workspaceDocsRoutes.js → services/workspaceDocs.js). A
 * document IS a Storage file: stable file id, versions, shares and trash are Storage's own.
 *
 *   list · search     GET /?kind=doc|note&q=          (search runs through the Library search)
 *   open              GET /:id → the .xdoc + backlinks  the address is #/office/z/<write|notes>/<file id>
 *   new · save        POST / · PUT /:id {title, xdoc, expectedVersion} — a save is a new version
 *   versions          GET /:id/versions · POST /:id/versions/:v/restore
 *   delete · undo     POST /:id/trash · POST /:id/untrash
 *   share             POST /api/library/assets/file/:id/shares {with, role} (Storage's sharing, unchanged)
 *
 * Why a document cannot carry script: ProseMirror builds the page from the schema's own render rules, never from
 * HTML; the format refuses (server AND editor) any node, mark or attribute that schema would not render; and nothing
 * in this file assigns document text as HTML — every string it draws goes through esc().
 *
 * It registers XENO_ZONE_LIVE['office.write'] and ['office.notes'], so neither area shows sample rows.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const ZONES = { write: { kind: 'doc', label: 'Write', noun: 'document', blurb: 'Documents in XENO Docs, stored in Storage with every version kept.' }, notes: { kind: 'note', label: 'Notes', noun: 'note', blurb: 'Notes that link to each other, stored in Storage.' } };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const st = {};   // per zone: { status, ws, list, q, open, openId, versions, error, undo, picking, ctrl, host, unmount }
  const Z = (z) => (st[z] = st[z] || { status: 'idle', ws: undefined, list: [], q: '', open: null, openId: null, versions: null, error: null, undo: null });
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && ZONES[s.zone] ? s.zone : null; };
  const item = () => { const it = X()?.S?.item; return it && UUID.test(it) ? it : null; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const go = (zone, id) => X()?.go?.('zone', { zone, item: id || null });

  // ─────────────────────────────── XENO Docs' editor, loaded on first use (beside this file; currentScript is only set now)
  const SELF = document.currentScript && document.currentScript.src;
  let loading = null;
  function editorLib() {
    if (window.XenoDocs) return Promise.resolve(window.XenoDocs);
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // the page's prefetch link carries the content-hashed address (scripts/vite-workspace.mjs stamps it), so a new
      // build of the editor is fetched, never a cached old one
      s.src = document.querySelector('link[data-docs-editor]')?.href || new URL('docs-editor.js', SELF || new URL('/workspace/', location.href).href).href;
      s.onload = () => (window.XenoDocs ? resolve(window.XenoDocs) : reject(new Error('editor did not load')));
      s.onerror = () => { loading = null; reject(new Error('editor did not load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** One controller + one mounted surface per zone, kept across re-renders: the page is redrawn as a string, so the
   *  editor's element lives off-page and is moved into each new placeholder (see adopt()). */
  function surfaceFor(z, Lib) {
    const S = Z(z);
    if (S.ctrl) return S;
    S.ctrl = new Lib.DocumentController({ host: { emit: (port, value) => onIntent(z, port, value) } });
    S.host = document.createElement('div');
    S.host.className = 'dc-surface';
    S.unmount = Lib.mountDocumentSurface(S.host, S.ctrl, { placeholder: `Write your ${ZONES[z].noun}…`, label: `${ZONES[z].noun} text` });
    S.ctrl.subscribe(() => syncChrome(z));
    return S;
  }
  /** Put each zone's live editor into the page's (freshly drawn, empty) placeholder. */
  function adopt() {
    for (const ph of document.querySelectorAll('[data-dc-body]')) {
      const z = ph.closest('[data-dc-page]')?.dataset.dcZone, S = z && st[z];
      if (S && S.host && S.host.parentNode !== ph) { ph.replaceChildren(S.host); syncChrome(z); }
    }
  }
  new MutationObserver(() => { if (document.querySelector('[data-dc-body]')) adopt(); }).observe(document.documentElement, { childList: true, subtree: true });

  /** The parts of the page that follow the editor (pressed toolbar buttons, the save state) without a re-render. */
  function syncChrome(z) {
    const S = Z(z), root = document.querySelector(`[data-dc-page][data-dc-zone="${z}"]`);
    if (!root || !S.ctrl) return;
    const s = S.ctrl.getState();
    for (const b of root.querySelectorAll('[data-dc-fmt]')) { const on = S.ctrl.isActive(b.dataset.dcFmt); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const state = root.querySelector('[data-dc-state]');
    if (state) state.textContent = s.status === 'saving' ? 'Saving…' : s.dirty ? 'Unsaved changes' : s.status === 'saved' ? 'Saved' : '';
    const note = root.querySelector('[data-dc-note]');
    if (note) { note.hidden = !(s.status === 'unsupported'); note.textContent = s.status === 'unsupported' ? `${s.message || 'This document cannot be edited here.'} Open it in XENO Docs to edit it.` : ''; }
  }

  async function onIntent(z, port, value) {
    const S = Z(z);
    if (port === 'openPage') { const into = S.list.some((x) => x.id === value.pageId) ? z : (z === 'write' ? 'notes' : 'write'); return go(into, value.pageId); }
    if (port !== 'save') return;
    const r = await api('PUT', `/api/workspace-docs/${encodeURIComponent(value.id)}`, { title: value.title, xdoc: value.xdoc, expectedVersion: value.expectedVersion }).catch(() => null);
    if (!r || !r.ok) {
      const conflict = r && r.d && r.d.code === 'version_conflict';
      S.ctrl.setStatus(conflict ? 'conflict' : 'failed', conflict ? 'Someone saved a newer version. Reopen it to see their changes.' : said(r, 'That did not save.'));
      return toast(conflict ? 'Someone saved a newer version. Reopen it to see their changes.' : said(r, 'That did not save.'));
    }
    S.ctrl.saved(r.d.doc.versionId);
    S.open = { ...r.d.doc, backlinks: r.d.backlinks || [] };
    toast('Saved'); if (S.versions) S.versions = null;
    return load(z);
  }

  // ─────────────────────────────── data
  const q = (z) => { const p = new URLSearchParams({ kind: ZONES[z].kind }); if (Z(z).ws) p.set('workspace', Z(z).ws); if (Z(z).q) p.set('q', Z(z).q); return '?' + p; };
  async function load(z) {
    const S = Z(z); S.ws = wsId(); S.status = 'loading'; S.error = null;
    const r = await api('GET', '/api/workspace-docs' + q(z)).catch(() => null);
    if (!r || !r.ok) { S.status = 'error'; S.error = said(r, 'Documents could not be reached.'); return paint(); }
    S.list = r.d.docs || []; S.status = 'ready'; paint();
  }
  async function openDoc(z, id) {
    const S = Z(z); S.openId = id; S.open = null; S.versions = null;
    const [r, Lib] = await Promise.all([api('GET', `/api/workspace-docs/${encodeURIComponent(id)}`).catch(() => null), editorLib().catch(() => null)]);
    if (S.openId !== id) return;
    if (!Lib) { S.open = { error: 'The editor could not be loaded. Reload the page to try again.' }; return paint(); }
    if (!r || !r.ok) { S.open = { error: said(r, 'This document could not be opened.') }; return paint(); }
    S.open = { ...r.d.doc, backlinks: r.d.backlinks || [] };
    surfaceFor(z, Lib).ctrl.load({ id: S.open.id, versionId: S.open.versionId, title: S.open.title, xdoc: S.open.xdoc, readOnly: !S.open.canEdit });
    paint();
  }

  for (const [z, Zd] of Object.entries(ZONES)) {
    window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
    window.XENO_ZONE_LIVE['office.' + z] = {
      served: true, items: true,   // a document has its own address: #/office/z/<zone>/<file id>
      work: () => (Z(z).status === 'ready' && Z(z).list.length ? [Zd.label === 'Write' ? 'Documents' : 'Notes', Z(z).list.slice(0, 6).map((d) => [d.title, new Date(d.updatedAt).toLocaleDateString(), null, Zd.label])] : null),
      badge: () => null,
      page: () => page(z),
      state: () => ({ status: Z(z).status, docs: Z(z).list.length, open: Z(z).open && Z(z).open.id || null, editor: Z(z).ctrl ? Z(z).ctrl.describe() : null }),
      reload: () => load(z),
      // the open document, for the browser test and an agent driving the page: XENO Docs' own controller
      controller: () => Z(z).ctrl || null,
    };
  }

  // ─────────────────────────────── the page
  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page(z) {
    const S = Z(z), Zd = ZONES[z];
    // the page's one header (XENO_PAGES): New document / New note sits right in the header bar and opens the dialog
    const h = window.XENO_PAGES.h, noun = Zd.noun;
    const head = h.head({ title: Zd.label, sub: Zd.blurb, acts: h.btn(`New ${noun}`, `data-dc-new="${z}"`, false, 'plus') });
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm" data-dc-page="${esc(S.status)}" data-dc-zone="${z}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(z); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-dc-error>${esc(S.error)} ${btn('data-dc-reload', 'Try again')}</div>`);
    const want = item();
    if (want && S.openId !== want) openDoc(z, want);
    if (!want && S.openId) { S.openId = null; S.open = null; }
    const undo = S.undo ? `<div class="an-undo" data-dc-undone>“${esc(S.undo.title)}” was moved to the trash. ${btn(`data-dc-untrash="${esc(S.undo.id)}"`, 'Undo')}</div>` : '';
    const list = S.list.length ? S.list.map((d) => `<li class="dc-item ${S.openId === d.id ? 'on' : ''}"><a href="#" data-dc-open="${esc(d.id)}"><b>${esc(d.title)}</b><small>${esc(d.excerpt || 'Empty')}</small></a></li>`).join('')
      : `<li class="pj-empty" data-dc-none>${S.q ? 'Nothing matches.' : `No ${Zd.noun}s yet.`}</li>`;
    const side = `<aside class="dc-side">
      <input class="in" type="search" data-dc-search placeholder="Search ${Zd.label === 'Write' ? 'documents' : 'notes'}" aria-label="Search" value="${esc(S.q)}"><ul class="dc-list" data-dc-list>${list}</ul></aside>`;
    return wrap(`${undo}<div class="dc-wrap">${side}<section class="dc-main">${editor(z)}</section></div>`);
  }
  function editor(z) {
    const S = Z(z), d = S.open;
    if (!S.openId) return `<div class="pj-empty">Choose a ${ZONES[z].noun} or start a new one.</div>`;
    if (!d) return '<div class="pj-empty">Opening…</div>';
    if (d.error) return `<div class="pj-empty" data-dc-open-error>${esc(d.error)}</div>`;
    const ro = !d.canEdit || (S.ctrl && S.ctrl.getState().readOnly);
    const Lib = window.XenoDocs;
    const tools = ro ? '<small class="dc-ro">Read only</small>' : [...(Lib ? Lib.DOCUMENT_TOOLBAR : []), { command: 'doclink', label: `Link a ${ZONES[z].noun}` }]
      .map((t) => `<button class="btn ghost dc-t" data-dc-fmt="${esc(t.command)}" title="${esc(t.label)}" aria-pressed="false">${esc(t.label)}</button>`).join('');
    const picker = S.picking ? `<div class="dc-pick" data-dc-picker>${S.list.filter((x) => x.id !== d.id).map((x) => `<button class="btn ghost" data-dc-linkto="${esc(x.id)}" data-dc-linklabel="${esc(x.title)}">${esc(x.title)}</button>`).join('') || '<small>No other ' + ZONES[z].noun + 's yet.</small>'}</div>` : '';
    const back = d.backlinks.length ? d.backlinks.map((b) => `<li><a href="#" data-dc-open="${esc(b.id)}" data-dc-in="${b.kind === 'note' ? 'notes' : 'write'}">${esc(b.title)}</a></li>`).join('') : '<li class="pj-empty">Nothing links here yet.</li>';
    const vers = S.versions ? `<ul class="dc-vers" data-dc-versions>${S.versions.map((v) => `<li><span>${esc(new Date(v.createdAt).toLocaleString())}${v.current ? ' · current' : ''}</span>${v.current || !d.canEdit ? '' : btn(`data-dc-restore="${esc(v.id)}"`, 'Restore')}</li>`).join('')}</ul>` : '';
    const title = S.ctrl ? S.ctrl.getState().title : d.title;
    return `<div class="dc-doc" data-dc-doc="${esc(d.id)}" data-dc-format="${esc(d.format || 'xdoc')}">
      <input class="in dc-title" data-dc-title value="${esc(title)}" aria-label="Title" maxlength="200" ${ro ? 'readonly' : ''}>
      <div class="dc-tools" role="toolbar" aria-label="Formatting">${tools}</div>${picker}
      <p class="dc-note" data-dc-note hidden></p>
      <div class="dc-body" data-dc-body></div>
      <div class="dc-acts">${ro ? '' : btn('data-dc-save', 'Save', 'btn')} <small class="dc-state" data-dc-state aria-live="polite"></small> ${btn('data-dc-history', S.versions ? 'Hide versions' : 'Versions')} ${d.canEdit ? btn('data-dc-trash', 'Delete') : ''}
        ${d.canEdit ? `<span class="dc-share"><input class="in" data-dc-share-with placeholder="Share with (email or username)" aria-label="Share with"> <select class="in" data-dc-share-role aria-label="Access"><option value="viewer">Can view</option><option value="editor">Can edit</option></select> ${btn('data-dc-share', 'Share')}</span>` : ''}</div>
      ${vers}<h3>Linked from</h3><ul class="dc-back" data-dc-backlinks>${back}</ul></div>`;
  }

  // ─────────────────────────────── actions
  async function send(method, path, body, okMsg) {
    const r = await api(method, path, body).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  function askLink(S) {
    return window.XD.form({ title: 'Link', submit: 'Link', size: 'sm', fields: [{ id: 'href', label: 'Address (https://…, or mailto:)', required: true, max: 2000,
      validate: (v) => (window.XenoDocs.SAFE_LINK.test(String(v || '').trim()) ? null : 'Only https, http and mailto links.') }] })
      .then((v) => { if (v) S.ctrl.format('link', v.href.trim()); });
  }
  document.addEventListener('click', async (e) => {
    const nw = e.target.closest('#main [data-dc-new]');
    if (nw) { e.preventDefault(); e.stopPropagation(); const z = nw.dataset.dcNew, S = Z(z);
      return window.XD.form({ title: `New ${ZONES[z].noun}`, submit: 'Create', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 200 }],
        onSubmit: async (v) => { const r = await send('POST', '/api/workspace-docs', { kind: ZONES[z].kind, title: v.title, ...(S.ws ? { workspace: S.ws } : {}) }, 'Created'); if (!r) return 'That did not save.'; S.made = r.doc.id; return null; },
      }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; await load(z); go(z, id); }); }
    const t = e.target.closest('[data-dc-reload],[data-dc-open],[data-dc-fmt],[data-dc-linkto],[data-dc-save],[data-dc-history],[data-dc-restore],[data-dc-trash],[data-dc-untrash],[data-dc-share]');
    if (!t || !t.closest('[data-dc-page]')) return;
    const root = t.closest('[data-dc-page]'), z = root.dataset.dcZone, S = Z(z), d = t.dataset;
    e.preventDefault(); e.stopPropagation();
    if ('dcReload' in d) return load(z);
    if (d.dcOpen) { const id = d.dcOpen; const into = d.dcIn || (S.list.some((x) => x.id === id) ? z : (z === 'write' ? 'notes' : 'write')); return go(into, id); }
    if (d.dcFmt === 'doclink') { S.picking = !S.picking; return paint(); }
    if (d.dcFmt === 'link') return askLink(S);
    if (d.dcFmt) { S.ctrl && S.ctrl.format(d.dcFmt); return syncChrome(z); }
    if (d.dcLinkto) { S.ctrl && S.ctrl.insertPageLink(d.dcLinkto, d.dcLinklabel); S.picking = false; return paint(); }
    if (d.dcUntrash) { const r = await send('POST', `/api/workspace-docs/${encodeURIComponent(d.dcUntrash)}/untrash`, {}, 'Restored'); if (r) { S.undo = null; await load(z); go(z, d.dcUntrash); } return; }
    const doc = root.querySelector('[data-dc-doc]'); if (!doc) return;
    const id = doc.dataset.dcDoc;
    if ('dcSave' in d) { if (S.ctrl && !S.ctrl.save()) toast(S.ctrl.getState().message || 'Nothing to save.'); return; }
    if ('dcHistory' in d) { if (S.versions) { S.versions = null; return paint(); } const r = await send('GET', `/api/workspace-docs/${encodeURIComponent(id)}/versions`); if (r) { S.versions = r.versions; paint(); } return; }
    if (d.dcRestore) {
      const r = await send('POST', `/api/workspace-docs/${encodeURIComponent(id)}/versions/${encodeURIComponent(d.dcRestore)}/restore`, {}, 'Version restored');
      if (r) { S.open = { ...r.doc, backlinks: r.backlinks || [] }; S.versions = null; S.ctrl.load({ id: S.open.id, versionId: S.open.versionId, title: S.open.title, xdoc: S.open.xdoc, readOnly: !S.open.canEdit }); load(z); }
      return;
    }
    if ('dcTrash' in d) { const r = await send('POST', `/api/workspace-docs/${encodeURIComponent(id)}/trash`, {}, 'Moved to the trash'); if (r) { S.undo = { id, title: S.open.title }; S.openId = null; S.open = null; await load(z); go(z, null); } return; }
    if ('dcShare' in d) {
      const who = (root.querySelector('[data-dc-share-with]') || {}).value || '', role = (root.querySelector('[data-dc-share-role]') || {}).value === 'editor' ? 'editor' : 'viewer';
      if (!who.trim()) return toast('Who should it be shared with?');
      if (await send('POST', `/api/library/assets/file/${encodeURIComponent(id)}/shares`, { with: who.trim(), role }, 'Shared')) root.querySelector('[data-dc-share-with]').value = '';
    }
  }, true);
  // a toolbar button must not take the focus (and the cursor) away from the text it formats — every editor does this
  document.addEventListener('mousedown', (e) => { if (e.target.closest('[data-dc-page] [data-dc-fmt]:not([data-dc-fmt="doclink"]):not([data-dc-fmt="link"])')) e.preventDefault(); }, true);
  let searchTimer = 0;
  document.addEventListener('input', (e) => {
    const ti = e.target.closest('[data-dc-title]');
    if (ti && ti.closest('[data-dc-page]')) { const S = Z(ti.closest('[data-dc-page]').dataset.dcZone); if (S.ctrl) S.ctrl.setTitle(ti.value); return; }
    const t = e.target.closest('[data-dc-search]'); if (!t || !t.closest('[data-dc-page]')) return;
    const z = t.closest('[data-dc-page]').dataset.dcZone; clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { Z(z).q = t.value.trim(); load(z).then(() => { const i = document.querySelector('[data-dc-search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250);
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.target.closest?.('[data-dc-doc]')) { e.preventDefault(); e.target.closest('[data-dc-page]').querySelector('[data-dc-save]')?.click(); }
  }, true);

  for (const z of Object.keys(ZONES)) P.lazyZone(window.XENO_ZONE_LIVE['office.' + z], () => load(z));   // each loads when its area is shown
})();
