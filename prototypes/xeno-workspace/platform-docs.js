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

  // ─────────────────────────────── writing together (XENO Multiplayer, `workspace.doc/<file id>`)
  // Everyone with a document open — here in Write or Notes, or on a document node of a project canvas — writes in ONE shared
  // document: XENO Docs' own collaboration (@xenosystem/blocks/docs/collaboration: TipTap Collaboration over Y.js, field
  // `prosemirror`), so every block and mark travels intact and two people typing in one paragraph both land. The transport
  // is XENO Multiplayer (services/liveTickets.js checks access on every join). ONE screen writes it down as a version — the
  // first person who can edit, by connection, the same rule the live canvas uses — and everyone sees it saved. A newer
  // version saved where nobody was writing is put in when the first person opens it again; while people are writing, the
  // shared document is everyone's merge and is written over it (the other version stays in Versions).
  // Without XENO Multiplayer it still works alone: the same editor, saving as before.
  const LIVE_SRC = new URL('live-client.js', SELF || new URL('/workspace/', location.href)).href;
  let liveClient = null;
  const loadLive = () => liveClient || (liveClient = new Promise((ok, no) => {
    if (window.XenoLive) return ok(window.XenoLive);
    const s = document.createElement('script'); s.src = LIVE_SRC; s.onload = () => ok(window.XenoLive); s.onerror = () => { liveClient = null; no(new Error('live client')); }; document.head.append(s);
  }));
  const SAVE_MS = 1200, SAVED = Symbol('docs-saved'), sessions = new Map();
  /** A colour per person for their caret, from the theme's own scale (never a literal). */
  const caretColor = (seed) => { const cs = getComputedStyle(document.documentElement), names = ['--n68', '--n56', '--n85', '--n44', '--n102']; let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return cs.getPropertyValue(names[h % names.length]).trim() || cs.getPropertyValue('--text').trim(); };
  async function openLive(fileId, { content, versionId, title, canEdit, me, xdoc }) {
    const key = String(fileId).toLowerCase();
    let s = sessions.get(key);
    if (s) { s.users += 1; return s.ready; }
    const Lib = await editorLib();
    const doc = new Lib.Y.Doc(), meta = doc.getMap('meta'), awareness = new Lib.Awareness(doc);
    // what the file carries besides its text (XENO Docs' comment threads, when it was made) is kept through every save
    let file = null; try { file = xdoc ? Lib.parseXdoc(xdoc) : null; } catch { file = null; }
    s = { file, key, Lib, doc, meta, awareness, users: 1, conn: null, seeded: false, people: [], timer: 0, saving: false, listeners: new Set(), canEdit: !!canEdit, saved: { versionId, content, title }, me: me || { name: 'Someone' } };
    sessions.set(key, s);
    const emit = () => { for (const f of s.listeners) try { f(s); } catch {} };
    s.live = () => !!(s.conn && s.conn.status === 'open' && s.seeded);
    /** The first person who can edit, by connection: the same answer on every screen, and the next one if they leave. */
    s.isLead = () => { if (!s.canEdit) return false; if (!s.live()) return true; const self = s.conn.self; if (!self || self.role === 'viewer') return false; return !s.people.some((p) => p.role !== 'viewer' && p.kind === 'human' && String(p.conn) < String(self.conn)); };
    s.extensions = () => Lib.createCollaborationExtensions({ document: doc, cursors: { awareness, user: { name: s.me.name, color: caretColor(s.me.id || s.me.name) } } });
    s.version = () => meta.get('version') || s.saved.versionId;
    s.title = () => meta.get('title') || s.saved.title;
    s.setTitle = (t) => { if (s.canEdit && t !== meta.get('title')) doc.transact(() => meta.set('title', String(t))); };
    async function save() {
      clearTimeout(s.timer);
      if (!s.isLead() || s.saving || !s.seeded) return;
      s.saving = true; s.pending = false; emit();
      const body = () => ({ title: s.title(), xdoc: Lib.serializeXdoc({ id: key, title: s.title(), content: Lib.sharedDocumentContent(doc), created: s.file?.created ?? Date.now(), lastModified: Date.now(), ...(s.file?.commentThreads ? { commentThreads: s.file.commentThreads } : {}) }), expectedVersion: s.version() });
      let r = await api('PUT', `/api/workspace-docs/${encodeURIComponent(key)}`, body()).catch(() => null);
      if (r && !r.ok && r.d && r.d.code === 'version_conflict' && !s.live()) { s.saving = false; s.error = 'Someone saved a newer version. Reopen it to see their changes.'; toast(s.error); emit(); return; }
      if (r && !r.ok && r.d && r.d.code === 'version_conflict') {
        // saved somewhere nobody here was writing: the shared document is everyone's merge — write it over the newer one
        const g = await api('GET', `/api/workspace-docs/${encodeURIComponent(key)}`).catch(() => null);
        if (g && g.ok) { doc.transact(() => meta.set('version', g.d.doc.versionId), SAVED); r = await api('PUT', `/api/workspace-docs/${encodeURIComponent(key)}`, body()).catch(() => null); }
      }
      s.saving = false;
      if (r && r.ok) doc.transact(() => { meta.set('version', r.d.doc.versionId); meta.set('savedAt', Date.now()); }, SAVED);
      else { s.error = (r && r.d && r.d.error) || 'That did not save.'; toast(s.error); }
      emit(); if (s.pending) s.saveSoon();
    }
    s.saveSoon = () => { s.pending = true; if (!s.isLead()) return; clearTimeout(s.timer); s.timer = setTimeout(save, SAVE_MS); };
    /** Save now: the lead writes it down; anyone else asks the lead to (so it is still written by one screen). */
    s.requestSave = () => { if (s.isLead()) return save(); try { s.conn.signal({ save: true }); } catch {} };
    s.replaceWith = (content2, versionId2, title2) => doc.transact(() => { Lib.replaceSharedDocument(doc, content2); meta.set('version', versionId2); if (title2) meta.set('title', title2); }, SAVED);
    // what changed decides: the text or the title is an edit to write down; a version stamp from a save is not
    doc.on('afterTransaction', (tr) => {
      if (tr.origin === SAVED || !s.seeded) { emit(); return; }
      const edit = [...tr.changed.entries()].some(([type, keys]) => type !== meta || keys.has('title'));
      if (edit) { s.dirty = true; s.saveSoon(); }
      emit();
    });
    // a new version was written down (by whichever screen saves): on every other screen nothing is waiting any more
    meta.observe((ev) => { if (ev.keysChanged.has('version') && !s.isLead()) s.pending = false; emit(); });
    function seed() {
      if (s.seeded) return;
      const alone = !s.conn || s.conn.status !== 'open' || !s.conn.participants().length;
      // alone, the saved file wins when the shared document is empty or was built from an older version; with others
      // already writing, theirs is the document
      try {
        if (s.canEdit && alone && (Lib.isSharedDocumentEmpty(doc) || meta.get('version') !== s.saved.versionId)) s.replaceWith(s.saved.content, s.saved.versionId, s.saved.title);
      } catch (e) { sessions.delete(key); try { s.conn && s.conn.close(); } catch {} s.reject(e); return; }   // not a document this schema writes: read it instead
      s.seeded = true; s.dirty = false; emit(); s.resolve(s);
    }
    s.ready = new Promise((r, no) => { s.resolve = r; s.reject = no; });
    /** No XENO Multiplayer for this opening: the same editor, alone. The connection is closed, so a seed made here can never
     *  merge into a room someone else seeded; a newer version saved meanwhile is refused at save, as before. */
    function alone() { if (s.seeded) return; const c = s.conn; s.conn = null; try { c && c.close(); } catch {} seed(); }
    // carets: this screen's awareness rides on its XENO Multiplayer presence; the others' come back as participants
    const others = new Set();
    function pullCarets() {
      const now = new Set(), added = [], updated = [], removed = [];
      for (const p of s.people) { const st = p.state; if (!st || !st.aw || st.cid === doc.clientID) continue; now.add(st.cid); (others.has(st.cid) ? updated : added).push(st.cid); awareness.states.set(st.cid, st.aw); awareness.meta.set(st.cid, { clock: (awareness.meta.get(st.cid)?.clock || 0) + 1, lastUpdated: Date.now() }); }
      for (const c of others) if (!now.has(c)) { removed.push(c); awareness.states.delete(c); awareness.meta.delete(c); }
      others.clear(); now.forEach((c) => others.add(c));
      if (added.length || updated.length || removed.length) { awareness.emit('change', [{ added, updated, removed }, 'remote']); awareness.emit('update', [{ added, updated, removed }, 'remote']); }
    }
    awareness.on('update', (_c, origin) => { if (origin === 'local' && s.conn && s.conn.status === 'open') s.conn.setPresence({ cid: doc.clientID, aw: awareness.getLocalState() }); });
    s.caretTimer = setInterval(pullCarets, 10000);   // keeps the others' carets from ageing out while nobody moves
    loadLive().then((X_) => {
      if (!sessions.has(key)) return;
      const conn = X_.joinLive({ type: 'workspace.doc', id: key, Y: Lib.Y, doc, ticket: async (resource) => { const r = await api('POST', '/api/live/tickets', { resource }); if (!r.ok) throw new Error(said(r, 'No ticket')); return r.d.ticket; } });
      s.conn = conn;
      conn.on('status', (st) => { if (st === 'reconnecting' && !s.seeded) return alone();   // could not join: this opening is local
        if (st === 'open' && !s.seeded) setTimeout(() => { if (s.conn === conn) seed(); }, 500); if (st === 'ended' && conn.ended?.code === 4403) { s.canEdit = false; toast('Your access to this document changed'); } emit(); });
      conn.on('participants', (p) => { s.people = p || []; pullCarets(); emit(); if (s.isLead() && s.pending) s.saveSoon(); });
      conn.on('signal', ({ data }) => { if (data && data.save && s.isLead()) save(); });
    }).catch(() => alone());
    setTimeout(() => { if (!s.seeded && (!s.conn || s.conn.status !== 'open')) alone(); }, 3000);
    s.on = (f) => { s.listeners.add(f); return () => s.listeners.delete(f); };
    s.close = async () => {
      s.users -= 1; if (s.users > 0) return;
      if (s.pending && s.isLead()) await save();
      sessions.delete(key); clearInterval(s.caretTimer); clearTimeout(s.timer);
      try { s.conn && s.conn.close(); } catch {} try { awareness.destroy(); } catch {} try { doc.destroy(); } catch {}
    };
    return s.ready;
  }
  /** Written together only when this schema writes it: someone who can edit, in the current format, valid content. A file the
   *  schema refuses opens read-only as before, and never becomes a shared document. */
  function shareable(Lib, d) {
    if (!d || !d.canEdit || d.format === 'markdown' || !d.content) return false;
    try { if (d.xdoc) Lib.parseXdoc(d.xdoc); return !Lib.validateContent(d.content).length; } catch { return false; }
  }
  window.XENO_DOCS_LIVE = { open: openLive, editorLib, shareable, sessions: () => [...sessions.values()].map((s) => ({ key: s.key, live: s.live(), lead: s.isLead(), version: s.version(), saving: s.saving, pending: !!s.pending })) };

  /** One controller + one mounted surface per zone, kept across re-renders: the page is redrawn as a string, so the
   *  editor's element lives off-page and is moved into each new placeholder (see adopt()). */
  function surfaceFor(z, Lib, live = null) {
    const S = Z(z);
    // a document someone can edit is written in its shared copy: its own surface, bound to that document (one per document)
    if (S.ctrl && (S.live || null) === live) return S;
    if (S.unmount) { S.unmount(); S.unmount = null; }
    if (S.offLive) { S.offLive(); S.offLive = null; }
    S.live = live;
    S.ctrl = new Lib.DocumentController({ host: { emit: (port, value) => onIntent(z, port, value) } });
    const old = S.host; S.host = document.createElement('div');
    S.host.className = 'dc-surface';
    if (old && old.parentNode) old.replaceWith(S.host);
    S.unmount = Lib.mountDocumentSurface(S.host, S.ctrl, { placeholder: `Write your ${ZONES[z].noun}…`, label: `${ZONES[z].noun} text`, ...(live ? { shared: true, history: false, extensions: live.extensions() } : {}) });
    S.ctrl.subscribe(() => syncChrome(z));
    if (live) S.offLive = live.on(() => liveChanged(z));
    return S;
  }
  /** The shared document moved on: a save by the screen that writes it down, or the title someone else typed. */
  function liveChanged(z) {
    const S = Z(z), L = S.live; if (!L || !S.ctrl) return;
    const st = S.ctrl.getState(), v = L.version();
    if (L.title() !== st.title) { const ti = document.querySelector(`[data-dc-page][data-dc-zone="${z}"] [data-dc-title]`); if (ti && document.activeElement !== ti) ti.value = L.title(); }
    if (L.saving) { if (st.status !== 'saving') S.ctrl.setStatus('saving'); }
    else if (!L.pending && L.seeded && (st.versionId !== v || st.dirty || st.status === 'saving')) { S.ctrl.saved(v); if (S.open) S.open.versionId = v; }
    syncChrome(z);
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
    if (S.live) { S.live.setTitle(value.title); S.live.requestSave(); return; }   // written down by the one screen that saves the shared document
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
    // someone who can edit writes in the shared document; a reader reads the saved version
    const prev = S.live;
    const live = shareable(Lib, S.open) ? await window.XENO_DOCS_LIVE.open(S.open.id, { content: S.open.content, xdoc: S.open.xdoc, versionId: S.open.versionId, title: S.open.title, canEdit: true, me: { id: P.user && P.user.id, name: (P.user && (P.user.display_name || P.user.username)) || 'Someone' } }).catch(() => null) : null;
    if (S.openId !== id) { if (live) live.close(); return; }
    if (prev && prev !== live) prev.close();
    surfaceFor(z, Lib, live).ctrl.load({ id: S.open.id, versionId: live ? live.version() : S.open.versionId, title: live ? live.title() : S.open.title, xdoc: S.open.xdoc, readOnly: !S.open.canEdit });
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
      if (r) { S.open = { ...r.doc, backlinks: r.backlinks || [] }; S.versions = null; if (S.live) S.live.replaceWith(r.doc.content, r.doc.versionId, r.doc.title); S.ctrl.load({ id: S.open.id, versionId: S.open.versionId, title: S.open.title, xdoc: S.open.xdoc, readOnly: !S.open.canEdit }); load(z); }
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
    if (ti && ti.closest('[data-dc-page]')) { const S = Z(ti.closest('[data-dc-page]').dataset.dcZone); if (S.ctrl) S.ctrl.setTitle(ti.value); if (S.live) S.live.setTitle(ti.value); return; }
    const t = e.target.closest('[data-dc-search]'); if (!t || !t.closest('[data-dc-page]')) return;
    const z = t.closest('[data-dc-page]').dataset.dcZone; clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { Z(z).q = t.value.trim(); load(z).then(() => { const i = document.querySelector('[data-dc-search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250);
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.target.closest?.('[data-dc-doc]')) { e.preventDefault(); e.target.closest('[data-dc-page]').querySelector('[data-dc-save]')?.click(); }
  }, true);

  for (const z of Object.keys(ZONES)) P.lazyZone(window.XENO_ZONE_LIVE['office.' + z], () => load(z));   // each loads when its area is shown
})();
