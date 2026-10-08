/* XENO_LIB — the Library on the real platform API.
 * From disk this does nothing and the Library keeps its sample files. Served by the platform it:
 *   1. replaces the sample files with everything the signed-in person can see: their uploads, the images and
 *      documents their chats made, and files of the projects and workspaces they belong to. Every page of it,
 *      not the first 200;
 *   2. shows the real picture for an image, and a plain type icon for anything else (never invented artwork);
 *   3. uploads, downloads, renames, stars, trashes, restores and deletes for real;
 *   4. refuses, in words, what the platform cannot do yet: duplicate, and moving a file to a project.
 *
 * SCOPE. GET /api/library/assets is the global view: what the person may see through their own files, their
 * projects and their workspaces. Each item says where it lives (personal, or which workspace), shown in Details
 * and searchable. The route can also list one place alone (`place=`); this page loads everything once and lets
 * the person narrow it.
 *
 * TRASH. A trashed item leaves the Library at once and is kept for 30 days. Restore brings it back. Delete
 * forever is only offered inside the trash, and asks first. Sharing a file with one person has no route yet, so
 * "Shared with me" says so.
 *
 * Routes: GET /api/library/assets (view, place, limit, offset) · GET /api/library/assets/:id/content
 *   · PATCH /api/library/assets/:source/:id · PUT|DELETE …/star · POST …/trash · POST …/restore
 *   · DELETE /api/library/trash/:source/:id · DELETE /api/library/trash · POST /api/upload (multipart, field "image"). */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_LIB = { served: false, refuse: () => false }; return; }
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const pstate = (v) => { const m = LS.get('pgState', {}) || {}; m.library = v; LS.set('pgState', m); };
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.refreshPanel?.(); X()?.render?.(); } catch {} };
  const toast = (s) => X()?.toast?.(s);
  const L = { status: 'loading', total: 0, capped: false };
  window.XENO_PG_LIBRARY.items = []; pstate('loading');
  const PAGE = 200, MAX_PAGES = 50;   // 10,000 items; past that the page says it is showing the newest

  const KIND_OF = { image: 'image', video: 'video', audio: 'audio', code: 'code', html: 'code', document: 'document' };
  const kindOf = (it) => KIND_OF[it.item_type] || (/^image\//.test(it.mime_type || '') ? 'image' : /^video\//.test(it.mime_type || '') ? 'video' : /^audio\//.test(it.mime_type || '') ? 'audio' : /json|javascript|typescript|x-python|html|css|xml/.test(it.mime_type || '') ? 'code' : 'document');
  // where it was made, only as far as the platform says: an image the image tool made, something a chat produced, or an upload
  const productOf = (it) => (it.source === 'generation' || it.source === 'image_asset' ? 'image' : it.source === 'artifact' || it.conversation_id ? 'chat' : 'uploaded');
  const sameOrigin = (u) => typeof u === 'string' && u.startsWith('/') && !u.startsWith('//');
  function shape(it) {
    const created = it.created_at || it.updated_at || new Date().toISOString(), kind = kindOf(it);
    return { id: String(it.id), name: String(it.name || 'Untitled'), kind, bytes: Number(it.size_bytes) || 0, createdAt: created, updatedAt: it.updated_at || created,
      source: { product: productOf(it), mode: 'overview', chat: it.conversation_title || null }, project: null, starred: it.starred === true, sharedBy: null, media: null, duration: null,
      trashedAt: it.trashed_at || null, purgeAfter: it.purge_after || null,
      // where it lives: the person's own space, or a named workspace
      place: it.place_kind === 'workspace' ? String(it.workspace_name || 'A workspace') : 'Personal', workspaceUuid: it.place_kind === 'workspace' ? it.workspace_id : null,
      live: { source: it.source, sourceId: it.source_id, assetId: it.asset_id || null, preview: kind === 'image' && typeof it.preview_url === 'string' && it.preview_url ? it.preview_url : null, mime: it.mime_type || '' } };
  }
  // every page of one view. null when the platform could not be read.
  async function pages(view) {
    const out = []; let total = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await api('GET', `/api/library/assets?limit=${PAGE}&offset=${i * PAGE}&sort=updated&view=${view}`).catch(() => ({ ok: false, d: {} }));
      if (!r.ok || !Array.isArray(r.d.items)) return null;
      out.push(...r.d.items); total = Number(r.d.total) || out.length;
      if (!r.d.has_more || !r.d.items.length) return { items: out, total, capped: false };
    }
    return { items: out, total, capped: true };
  }
  async function load() {
    const [active, trash] = await Promise.all([pages('active'), pages('trash')]);
    if (!active || !trash) { L.status = 'error'; window.XENO_PG_LIBRARY.items = []; pstate('error'); paint(); return false; }
    window.XENO_PG_LIBRARY.items = [...active.items, ...trash.items].map(shape);
    L.status = 'ready'; L.total = active.total; L.capped = active.capped || trash.capped; pstate('normal'); paint(); return true;
  }

  // ---------- pictures ----------
  const img = (f, fit) => `<img src="${esc(f.live.preview)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:${fit};border-radius:inherit;display:block">`;
  const thumb = (f, icon) => (f.live.preview && !f.trashedAt ? `<span class="pg-thumb">${img(f, 'cover')}</span>` : `<span class="pg-thumb pg-thumb--ic">${icon}</span>`);   // a trashed file is not served, so it has no picture
  const preview = (f, icon) => (f.live.preview && !f.trashedAt ? img(f, 'contain') : `<span class="pg-state-ic">${icon}</span>`);

  // ---------- what the platform cannot do yet ----------
  const NOT_YET = { duplicate: 'Duplicating a file', move: 'Moving a file to a project' };
  function refuse(action) { if (!NOT_YET[action]) return false; toast(`${NOT_YET[action]} isn’t available on XENO yet`); return true; }
  const VIEW_NOT_YET = { 'Shared with me': ['share', 'Shared with me isn’t available yet', 'A file can’t be shared with one person on XENO yet. Files of a workspace you belong to are in your Library, marked with the workspace they live in.'] };
  const viewNotYet = (view, h) => (VIEW_NOT_YET[view] ? h.page(h.head({ eyebrow: 'Library', title: view, sub: '' }) + h.box(VIEW_NOT_YET[view][0], VIEW_NOT_YET[view][1], esc(VIEW_NOT_YET[view][2])), 'pg--lib') : null);

  // ---------- saves, through the one save door ----------
  let pending = null;
  const take = () => { const v = pending; pending = null; return v; };
  const WHY = { forbidden: 'You can see this file but can’t change it.', not_found: 'It is no longer in your Library.', asset_has_project_references: 'A project uses it. Remove it from that project first.', already_in_trash: 'It is already in the trash.', not_in_trash: 'It is not in the trash any more.', item_in_trash: 'It is in the trash. Restore it first.', invalid_name: 'That name can’t be used. Leave out slashes, and keep it under 255 characters.', rename_unsupported: 'A generated picture is named by its prompt and can’t be renamed.' };
  const fail = (r, what) => ({ ok: false, code: (r.d && r.d.code) || 'invalid', msg: `${what} ${WHY[r.d && r.d.code] || (r.d && typeof r.d.error === 'string' && r.d.error) || 'XENO refused it.'}`, final: r.status >= 400 && r.status < 500 });
  const at = (f) => `${encodeURIComponent(f.live.source)}/${encodeURIComponent(f.live.sourceId)}`;
  // one request per item; a generation lists once per picture, so each one is sent once
  async function each(files, send, verb) {
    const seen = new Set(); let done = 0;
    for (const f of files) {
      const key = at(f); if (seen.has(key)) continue; seen.add(key);
      const r = await send(f);
      if (!r.ok) { setTimeout(load, 0); const e = fail(r, `“${f.name}” wasn’t ${verb}.`); if (done) e.msg += ` ${done} other${done > 1 ? 's were' : ' was'} ${verb}.`; return e; }
      done++;
    }
    await load(); return { ok: true };
  }
  window.XENO_NET.wire('library');
  window.XENO_NET.remote({
    'library.star': async () => { const { files, on } = take(); return each(files, (f) => api(on ? 'PUT' : 'DELETE', `/api/library/assets/${at(f)}/star`), on ? 'starred' : 'unstarred'); },
    'library.rename': async () => { const { file, name } = take(); return each([file], (f) => api('PATCH', `/api/library/assets/${at(f)}`, { name }), 'renamed'); },
    'library.trash': async () => each(take(), (f) => api('POST', `/api/library/assets/${at(f)}/trash`), 'moved to the trash'),
    'library.restore': async () => each(take(), (f) => api('POST', `/api/library/assets/${at(f)}/restore`), 'restored'),
    'library.purge': async () => each(take(), (f) => api('DELETE', `/api/library/trash/${at(f)}`), 'deleted'),
    'library.emptyTrash': async () => { take(); const r = await api('DELETE', '/api/library/trash'); if (!r.ok) { setTimeout(load, 0); return fail(r, 'The trash wasn’t emptied.'); } await load(); return { ok: true }; },
    'library.upload': async () => {
      const files = take() || []; let done = 0;
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
  const real = (files) => (files || []).filter((f) => f && f.live);
  const many = (files) => (files.length === 1 ? `“${files[0].name}”` : `${files.length} files`);
  const run = (op, payload, label) => { pending = payload; return window.XENO_NET.run({ op, label }); };

  async function star(files, on) {
    files = real(files); if (!files.length) return false;
    if (on === undefined) on = !files.every((f) => f.starred);
    const ok = await run('library.star', { files, on }, on ? 'Starring' : 'Removing the star');
    if (ok) toast(on ? (files.length === 1 ? 'Starred' : `Starred ${files.length} files`) : (files.length === 1 ? 'Removed from Starred' : `Removed ${files.length} files from Starred`));
    return ok;
  }
  async function rename(f) {
    if (!f || !f.live) return false;
    if (f.live.source === 'generation') { toast(WHY.rename_unsupported); return false; }
    const v = await window.XD.form({ title: 'Rename file', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 255, value: f.name,
      validate: (x) => (/[\\/]/.test(x) ? 'A name can’t contain a slash.' : null) }] });
    const name = v && String(v.name).trim(); if (!name || name === f.name) return false;
    const was = f.name, ok = await run('library.rename', { file: f, name }, 'Renaming the file');
    if (ok) window.XENO_HIST?.record(`Renamed to “${name}”`, () => run('library.rename', { file: f, name: was }, 'Renaming the file'));
    return ok;
  }
  async function trash(files) {
    files = real(files).filter((f) => !f.trashedAt); if (!files.length) return false;
    const ok = await run('library.trash', files, files.length === 1 ? 'Moving the file to the trash' : 'Moving the files to the trash');
    if (ok) window.XENO_HIST?.record(`Moved ${many(files)} to Trash`, () => run('library.restore', files, 'Restoring'));
    return ok;
  }
  async function restore(files) {
    files = real(files).filter((f) => f.trashedAt); if (!files.length) return false;
    const ok = await run('library.restore', files, 'Restoring');
    if (ok) toast(`Restored ${many(files)}`);
    return ok;
  }
  async function purge(files) {
    files = real(files).filter((f) => f.trashedAt); if (!files.length) return false;
    if (!await window.XD.confirm({ title: `Delete ${esc(many(files))} forever?`, body: 'The stored file is removed from XENO. This can’t be undone.', action: 'Delete forever' })) return false;
    const ok = await run('library.purge', files, 'Deleting for good');
    if (ok) toast(`Deleted ${many(files)} for good`);
    return ok;
  }
  async function emptyTrash() {
    const n = window.XENO_PG_LIBRARY.items.filter((f) => f.trashedAt).length; if (!n) return false;
    if (!await window.XD.confirm({ title: 'Empty the trash?', body: `Everything in it that you own is deleted forever: ${n} item${n > 1 ? 's' : ''}. A workspace file only its owner can delete stays. This can’t be undone.`, action: 'Empty trash' })) return false;
    const ok = await run('library.emptyTrash', {}, 'Emptying the trash');
    if (ok) toast('Trash emptied');
    return ok;
  }
  async function upload(list) {
    const files = [...(list || [])]; if (!files.length) return false;
    const ok = await run('library.upload', files, files.length === 1 ? 'Adding the file' : 'Adding the files');
    if (ok) toast(`Added ${files.length} file${files.length > 1 ? 's' : ''} to your Library`);
    return ok;
  }
  // ---------- download: the stored bytes, never sample content ----------
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = String(name).replace(/[\\/:*?"<>|]/g, '_'); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  async function bytes(f) {
    if (f.trashedAt) return { error: `“${f.name}” is in the trash. Restore it to download it.` };
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
    files = real(files); if (!files.length) return null;
    toast(files.length > 1 ? `Preparing ${files.length} files…` : `Preparing “${files[0].name}”…`);
    const got = []; for (const f of files) { const g = await bytes(f); if (g.error) { toast(g.error); return null; } got.push(g); }
    if (got.length === 1) { save(got[0].blob, got[0].name); last = { name: got[0].name, size: got[0].blob.size, real: true }; toast(`Downloaded “${got[0].name}”`); return last; }
    const z = await window.XENO_FILES.zip(got), name = `XENO Library — ${got.length} files.zip`;
    save(z, name); last = { name, size: z.size, entries: got.map((g) => g.name), real: true }; toast(`Downloaded ${got.length} files as one zip`); return last;
  }
  // the page calls XENO_FILES for downloads and for storing bytes: on the platform both go to the API
  if (window.XENO_FILES) Object.assign(window.XENO_FILES, { download, put: async () => {}, del: async () => {}, last: () => last });

  // ---------- menus: only what works ----------
  const fileMenu = (f, h) => (f.trashedAt
    ? [[{ label: 'Restore', icon: 'undo', run: () => restore([f]) }], [{ label: 'Copy name', icon: 'copy', run: () => h.copy(f.name, 'Name copied') }],
      [{ label: 'Delete forever…', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => purge([f]) }]]
    : [[{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: h.open }, { label: 'Details', icon: 'info', kbd: 'I', run: h.details }],
      [{ label: f.starred ? 'Remove star' : 'Star', icon: 'star', key: 's', kbd: 'S', run: () => star([f]) }, ...(f.live.source === 'generation' ? [] : [{ label: 'Rename…', icon: 'edit', key: 'F2', kbd: 'F2', run: () => rename(f) }])],
      [{ label: 'Download', icon: 'download', run: () => download([f]) }, { label: 'Copy name', icon: 'copy', run: () => h.copy(f.name, 'Name copied') }],
      [{ label: 'Move to Trash', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => trash([f]) }]]);
  const batchMenu = (fs, h) => { const N = `${fs.length} files`; return fs.every((f) => f.trashedAt)
    ? [[{ label: `Restore ${N}`, icon: 'undo', run: () => restore(fs) }], [{ label: 'Clear selection', icon: 'minus', kbd: 'Esc', run: h.clear }],
      [{ label: `Delete ${N} forever…`, icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => purge(fs) }]]
    : [[{ label: fs.every((f) => f.starred) ? `Unstar ${N}` : `Star ${N}`, icon: 'star', key: 's', kbd: 'S', run: () => star(fs) }],
      [{ label: `Download ${N}`, hint: 'zip', icon: 'download', run: () => download(fs) }],
      [{ label: 'Clear selection', icon: 'minus', kbd: 'Esc', run: h.clear }],
      [{ label: `Move ${N} to Trash`, icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => trash(fs) }]]; };

  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pg-retry="library"]'); if (t && L.status === 'error') { pstate('loading'); paint(); load(); } }, true);
  window.XENO_LIB = { served: true, load, refuse, star, rename, trash, restore, purge, emptyTrash, upload, download, thumb, preview, viewNotYet, fileMenu, batchMenu, state: () => ({ status: L.status, total: L.total, capped: L.capped }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
