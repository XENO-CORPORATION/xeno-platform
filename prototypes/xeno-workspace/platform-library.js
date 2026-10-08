/* XENO_LIB — the Library on the real platform API.
 * From disk this does nothing and the Library keeps its sample files. Served by the platform it:
 *   1. replaces the sample files with everything the signed-in person can see: their uploads, the images and
 *      documents their chats made, and files of the projects and workspaces they belong to;
 *   2. shows the real picture for an image, and a plain type icon for anything else (never invented artwork);
 *   3. uploads, downloads and deletes for real;
 *   4. refuses, in words, what the platform cannot do yet: rename, duplicate, star, move to a project, and a trash.
 *
 * SCOPE. GET /api/library/assets is already the global view: the platform returns what the person may see through
 * their own files, their projects and their workspaces. It does not say which place a file lives in, and it cannot
 * list one workspace's files on their own. Both are backend gaps, written up in
 * orchestrator/briefs/2026-10-08-workspace-scopes-for-projects-and-library.md.
 *
 * DELETING. The platform has no trash. Deleting here is final, so it always asks first and says so.
 *
 * Routes: GET /api/library/assets · GET /api/library/assets/:id/content · DELETE /api/library/assets/:source/:id
 *   · POST /api/upload (multipart, field "image"). */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_LIB = { served: false, refuse: () => false }; return; }
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const pstate = (v) => { const m = LS.get('pgState', {}) || {}; m.library = v; LS.set('pgState', m); };
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.refreshPanel?.(); X()?.render?.(); } catch {} };
  const toast = (s) => X()?.toast?.(s);
  const L = { status: 'loading' };
  window.XENO_PG_LIBRARY.items = []; pstate('loading');

  const KIND_OF = { image: 'image', video: 'video', audio: 'audio', code: 'code', html: 'code', document: 'document' };
  const kindOf = (it) => KIND_OF[it.item_type] || (/^image\//.test(it.mime_type || '') ? 'image' : /^video\//.test(it.mime_type || '') ? 'video' : /^audio\//.test(it.mime_type || '') ? 'audio' : /json|javascript|typescript|x-python|html|css|xml/.test(it.mime_type || '') ? 'code' : 'document');
  // where it was made, only as far as the platform says: an image the image tool made, something a chat produced, or an upload
  const productOf = (it) => (it.source === 'generation' || it.source === 'image_asset' ? 'image' : it.source === 'artifact' || it.conversation_id ? 'chat' : 'uploaded');
  const sameOrigin = (u) => typeof u === 'string' && u.startsWith('/') && !u.startsWith('//');
  function shape(it) {
    const created = it.created_at || it.updated_at || new Date().toISOString(), kind = kindOf(it);
    return { id: String(it.id), name: String(it.name || 'Untitled'), kind, bytes: Number(it.size_bytes) || 0, createdAt: created, updatedAt: it.updated_at || created,
      source: { product: productOf(it), mode: 'overview', chat: it.conversation_title || null }, project: null, starred: false, sharedBy: null, media: null, duration: null, trashedAt: null,
      live: { source: it.source, sourceId: it.source_id, assetId: it.asset_id || null, preview: kind === 'image' && typeof it.preview_url === 'string' && it.preview_url ? it.preview_url : null, mime: it.mime_type || '' } };
  }
  async function load() {
    const r = await api('GET', '/api/library/assets?limit=200&sort=updated').catch(() => ({ ok: false, d: {} }));
    if (!r.ok || !Array.isArray(r.d.items)) { L.status = 'error'; window.XENO_PG_LIBRARY.items = []; pstate('error'); paint(); return false; }
    window.XENO_PG_LIBRARY.items = r.d.items.map(shape); L.status = 'ready'; L.more = r.d.items.length >= 200; pstate('normal'); paint(); return true;
  }

  // ---------- pictures ----------
  const img = (f, fit) => `<img src="${esc(f.live.preview)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:${fit};border-radius:inherit;display:block">`;
  const thumb = (f, icon) => (f.live.preview ? `<span class="pg-thumb">${img(f, 'cover')}</span>` : `<span class="pg-thumb pg-thumb--ic">${icon}</span>`);
  const preview = (f, icon) => (f.live.preview ? img(f, 'contain') : `<span class="pg-state-ic">${icon}</span>`);

  // ---------- what the platform cannot do yet ----------
  const NOT_YET = { star: 'Starring a file', rename: 'Renaming a file', duplicate: 'Duplicating a file', move: 'Moving a file to a project', restore: 'Restoring a file', emptyTrash: 'A trash', purge: 'A trash' };
  function refuse(action) { if (!NOT_YET[action]) return false; toast(`${NOT_YET[action]} isn’t available on XENO yet`); return true; }
  const VIEW_NOT_YET = { Starred: ['star', 'Starred isn’t available yet', 'Starring files isn’t connected on XENO yet.'], 'Shared with me': ['share', 'Shared with me isn’t available yet', 'Files others shared with you appear in your Library, but XENO can’t list them apart yet.'], Trash: ['trash', 'There is no trash yet', 'Deleting a file on XENO is final. It asks first.'] };
  const viewNotYet = (view, h) => (VIEW_NOT_YET[view] ? h.page(h.head({ eyebrow: 'Library', title: view, sub: '' }) + h.box(VIEW_NOT_YET[view][0], VIEW_NOT_YET[view][1], esc(VIEW_NOT_YET[view][2])), 'pg--lib') : null);

  // ---------- saves, through the one save door ----------
  let pending = null;
  const fail = (r, fallback) => ({ ok: false, code: r.status === 403 ? 'forbidden' : r.status === 409 ? 'in-use' : 'invalid', msg: (r.d && typeof r.d.error === 'string' && r.d.error) || fallback, final: r.status >= 400 && r.status < 500 });
  window.XENO_NET.wire('library');
  window.XENO_NET.remote({
    'library.delete': async () => {
      const files = pending || []; pending = null; let done = 0;
      for (const f of files) {
        const r = await api('DELETE', `/api/library/assets/${encodeURIComponent(f.live.source)}/${encodeURIComponent(f.live.sourceId)}`);
        if (!r.ok) { setTimeout(load, 0); return r.status === 409 ? { ok: false, code: 'in-use', final: true, msg: `“${f.name}” is used by a project. Remove it from that project first.${done ? ` ${done} other file${done > 1 ? 's were' : ' was'} deleted.` : ''}` } : fail(r, `“${f.name}” couldn’t be deleted.`); }
        done++;
      }
      setTimeout(load, 0); return { ok: true };
    },
    'library.upload': async () => {
      const files = pending || []; pending = null; let done = 0;
      for (const file of files) {
        const body = new FormData(); body.append('image', file, file.name);
        const headers = { 'x-xeno-surface': 'xeno-web' }; const t = P.csrf(); if (t) headers['x-xeno-csrf'] = t;
        let r, d = null;
        try { r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', headers, body }); try { d = await r.json(); } catch {} }
        catch { setTimeout(load, 0); return { ok: false, code: 'offline', msg: `XENO could not be reached.${done ? ` ${done} of ${files.length} files were added.` : ' Nothing was added.'}` }; }
        if (!r.ok || (d && d.success === false)) { setTimeout(load, 0); return { ok: false, code: 'invalid', final: r.status >= 400 && r.status < 500, msg: `“${file.name}” wasn’t added: ${(d && d.error) || 'XENO refused it'}.${done ? ` ${done} other file${done > 1 ? 's were' : ' was'} added.` : ''}` }; }
        done++;
      }
      setTimeout(load, 0); return { ok: true };
    },
  });
  async function remove(files) {
    files = (files || []).filter((f) => f && f.live); if (!files.length) return false;
    const n = files.length, what = n === 1 ? `“${esc(files[0].name)}”` : `${n} files`;
    if (!await window.XD.confirm({ title: `Delete ${what} forever?`, body: 'There is no trash on XENO yet, so this can’t be undone. A file a project uses has to be removed from that project first.', action: 'Delete forever' })) return false;
    pending = files;
    const ok = await window.XENO_NET.run({ op: 'library.delete', label: n === 1 ? 'Deleting the file' : 'Deleting the files' });
    if (ok) toast(n === 1 ? `Deleted “${files[0].name}”` : `Deleted ${n} files`);
    return ok;
  }
  async function upload(list) {
    const files = [...(list || [])]; if (!files.length) return false;
    pending = files;
    const ok = await window.XENO_NET.run({ op: 'library.upload', label: files.length === 1 ? 'Adding the file' : 'Adding the files' });
    if (ok) toast(`Added ${files.length} file${files.length > 1 ? 's' : ''} to your Library`);
    return ok;
  }
  // ---------- download: the stored bytes, never sample content ----------
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = String(name).replace(/[\\/:*?"<>|]/g, '_'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  async function bytes(f) {
    const url = f.live.assetId ? `/api/library/assets/${encodeURIComponent(f.live.assetId)}/content?download=1` : sameOrigin(f.live.preview) ? f.live.preview : null;
    if (!url) return { error: `“${f.name}” can’t be downloaded from here yet.` };
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } }).catch(() => null);
    if (!r) return { error: 'XENO could not be reached.' };
    if (r.status === 423) return { error: `“${f.name}” is still being checked. Try again in a moment.` };
    if (!r.ok) return { error: `“${f.name}” couldn’t be downloaded.` };
    return { blob: await r.blob(), name: f.name };
  }
  let last = null;
  async function download(files) {
    files = (files || []).filter((f) => f && f.live); if (!files.length) return null;
    toast(files.length > 1 ? `Preparing ${files.length} files…` : `Preparing “${files[0].name}”…`);
    const got = []; for (const f of files) { const g = await bytes(f); if (g.error) { toast(g.error); return null; } got.push(g); }
    if (got.length === 1) { save(got[0].blob, got[0].name); last = { name: got[0].name, size: got[0].blob.size, real: true }; toast(`Downloaded “${got[0].name}”`); return last; }
    const z = await window.XENO_FILES.zip(got), name = `XENO Library — ${got.length} files.zip`;
    save(z, name); last = { name, size: z.size, entries: got.map((g) => g.name), real: true }; toast(`Downloaded ${got.length} files as one zip`); return last;
  }
  // the page calls XENO_FILES for downloads and for storing bytes: on the platform both go to the API
  if (window.XENO_FILES) Object.assign(window.XENO_FILES, { download, put: async () => {}, del: async () => {}, last: () => last });

  // ---------- menus: only what works ----------
  const fileMenu = (f, h) => [[{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: h.open }, { label: 'Details', icon: 'info', kbd: 'I', run: h.details }],
    [{ label: 'Download', icon: 'download', run: () => download([f]) }, { label: 'Copy name', icon: 'copy', run: () => h.copy(f.name, 'Name copied') }],
    [{ label: 'Delete forever…', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => remove([f]) }]];
  const batchMenu = (fs, h) => [[{ label: `Download ${fs.length} files`, hint: 'zip', icon: 'download', run: () => download(fs) }],
    [{ label: 'Clear selection', icon: 'minus', kbd: 'Esc', run: h.clear }],
    [{ label: `Delete ${fs.length} files forever…`, icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => remove(fs) }]];

  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pg-retry="library"]'); if (t && L.status === 'error') { pstate('loading'); paint(); load(); } }, true);
  window.XENO_LIB = { served: true, load, refuse, remove, upload, download, thumb, preview, viewNotYet, fileMenu, batchMenu, state: () => ({ status: L.status, more: !!L.more }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
