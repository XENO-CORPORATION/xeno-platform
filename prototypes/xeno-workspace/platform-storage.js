/* XENO_STORAGE — XENO Storage (codename Arca): the account's files, as a drive. Corpo product, real platform API.
 *
 * One store for everything an account holds. This is its own interface: folders, files, upload, move, rename,
 * star, trash, search, and the space it all takes. The Library is another view of the same store.
 *
 *   My files   /workspace/corpo/apps/storage            the top folder
 *   a folder   /workspace/corpo/apps/storage/f/<id>     by id, so a rename never breaks the address
 *   Recent · Starred · Trash · Usage                     the sidebar views
 *
 *   GET /api/library/folders?parent=    GET /api/library/assets?folder=|view=|sort=|query=
 *   POST|PATCH|DELETE /api/library/folders[/:id]     PUT /api/library/assets/:source/:id/folder
 *   PATCH …/assets/:source/:id (rename) · PUT|DELETE …/star · POST …/trash · POST …/restore
 *   DELETE /api/library/trash/:source/:id · POST /api/upload · GET /api/library/storage
 *
 * Nothing is invented: from disk (no platform) it says it needs the platform. Spec: XENO STORAGE - SPEC.md. */
(() => {
  const P = window.XENO_PLATFORM;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VIEWS = ['Recent', 'Starred', 'Trash', 'Usage'];
  const S = { key: null, status: 'idle', folders: [], path: [], items: [], total: 0, meter: null, largest: [], q: '', note: '', edit: null, moving: null, all: [], busy: 0 };
  const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const when = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const days = Math.floor((Date.now() - d.getTime()) / 86400000); return days < 1 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : days < 7 ? `${days} d ago` : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  const KIND = { image: 'Images', video: 'Video', audio: 'Audio', '3d': '3D models', document: 'Documents' };
  const tag = (i) => { const m = String(i.mime_type || ''); const ext = (String(i.name).match(/\.([a-z0-9]{1,5})$/i) || [])[1]; return (m.startsWith('image/') ? 'IMG' : m.startsWith('video/') ? 'VID' : m.startsWith('audio/') ? 'AUD' : m === 'application/pdf' ? 'PDF' : ext ? ext.toUpperCase().slice(0, 4) : 'FILE'); };
  const paint = () => { try { X()?.render?.(); } catch {} };
  const say = (text) => { S.note = text; paint(); clearTimeout(say.t); say.t = setTimeout(() => { S.note = ''; paint(); }, 4200); };
  const here = () => { const it = X()?.S?.item || ''; const f = /^f\/([0-9a-f-]{36})$/i.exec(it); return f ? { kind: 'folder', id: f[1].toLowerCase() } : VIEWS.includes(it) ? { kind: it.toLowerCase() } : { kind: 'folder', id: null }; };
  const go = (item) => X()?.go?.('product', { product: 'storage', item: item || null });
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const whyNot = (r, fallback) => (r && r.d && (r.d.error || r.d.message)) || fallback;

  async function load() {
    if (!P || !P.served) { S.status = 'offline'; return; }
    const at = here(), key = `${at.kind}:${at.id || ''}:${S.q}`;
    S.key = key; if (!S.items.length && !S.folders.length) S.status = 'loading';
    const meter = api('GET', '/api/library/storage');
    let folders = { ok: true, d: { folders: [], path: [] } }, list;
    const q = S.q ? `&query=${encodeURIComponent(S.q)}` : '';
    if (at.kind === 'usage') list = api('GET', '/api/library/assets?sort=size&limit=8');
    else if (at.kind === 'recent') list = api('GET', `/api/library/assets?sort=updated&limit=60${q}`);
    else if (at.kind === 'starred') list = api('GET', `/api/library/assets?view=starred&sort=updated&limit=200${q}`);
    else if (at.kind === 'trash') list = api('GET', `/api/library/assets?view=trash&sort=updated&limit=200${q}`);
    else if (S.q) list = api('GET', `/api/library/assets?sort=updated&limit=200${q}`);   // a search looks everywhere
    else { folders = api('GET', `/api/library/folders?parent=${at.id || 'root'}`); list = api('GET', `/api/library/assets?folder=${at.id || 'root'}&sort=name&limit=200`); }
    const [m, f, l] = await Promise.all([meter, folders, list]);
    if (S.key !== key) return;   // the person moved on while this loaded
    if (m.ok && m.d.storage) S.meter = m.d.storage;
    if (!l.ok || (f.ok === false)) { S.status = f.status === 404 || (f.d && f.d.code === 'not_found') ? 'missing' : 'error'; return paint(); }
    S.folders = f.d.folders || []; S.path = f.d.path || []; S.items = l.d.items || []; S.total = l.d.total || S.items.length;
    if (at.kind === 'usage') S.largest = S.items.filter((i) => Number(i.size_bytes) > 0);
    S.status = 'ready'; paint();
  }
  const reload = () => { S.key = null; return load(); };

  const style = () => {
    if (document.getElementById('xst-css')) return; const s = document.createElement('style'); s.id = 'xst-css';
    s.textContent = '.xst{display:flex;flex-direction:column;min-height:100%;padding:18px 28px 60px}.xst-top{display:flex;align-items:center;gap:10px;min-height:36px}'
      + '.xst-path{display:flex;align-items:center;gap:2px;min-width:0;flex:1;font-size:18px;font-weight:600;letter-spacing:-.015em}.xst-path button{border:0;background:none;color:var(--muted);font:inherit;padding:4px 7px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}.xst-path button:hover,.xst-path button[data-over]{background:var(--hover);color:var(--text)}.xst-path button:last-of-type{color:var(--text)}.xst-path i{color:var(--dim);font-style:normal;font-weight:400}'
      + '.xst-find{width:230px;height:32px;padding:0 11px;border:1px solid var(--border);border-radius:8px;background:var(--control);color:var(--text);font:inherit;font-size:13px;outline:none}.xst-find:focus{border-color:rgba(255,255,255,.28)}'
      + '.xst-btn{height:32px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}.xst-btn:hover{background:var(--hover)}.xst-btn.xst-go{background:var(--text);color:var(--canvas);border-color:transparent;font-weight:500}.xst-btn.xst-go:hover{opacity:.9}'
      + '.xst-mini{display:flex;align-items:center;gap:9px;margin:14px 0 0;font-size:12.5px;color:var(--muted);border:0;background:none;padding:0;cursor:pointer;font:inherit;font-size:12.5px}.xst-mini .bar{width:160px;height:5px;border-radius:3px;background:var(--control);overflow:hidden}.xst-mini .bar i{display:block;height:100%;background:var(--text);border-radius:3px}.xst-mini:hover{color:var(--text)}'
      + '.xst-note{margin:12px 0 0;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);background:var(--panel)}'
      + '.xst-list{margin-top:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}.xst-list[data-drop]{border-color:rgba(255,255,255,.4)}'
      + '.xst-hd,.xst-r{display:grid;grid-template-columns:34px minmax(0,1fr) 110px 96px 150px;gap:10px;align-items:center;padding:0 14px}.xst-hd{height:34px;font-size:11.5px;color:var(--dim);border-bottom:1px solid var(--border)}'
      + '.xst-r{height:44px;border-top:1px solid var(--border);font-size:13.5px;cursor:default;user-select:none}.xst-r:first-of-type{border-top:0}.xst-r:hover,.xst-r[data-over]{background:var(--hover)}.xst-r[data-over]{box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}'
      + '.xst-r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xst-r small{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}.xst-r .ic{width:26px;height:26px;border-radius:6px;background:var(--control);display:grid;place-items:center;font-size:8.5px;font-weight:600;letter-spacing:.02em;color:var(--muted)}.xst-r .ic.fd{background:var(--text);color:var(--canvas)}'
      + '.xst-r .acts{display:flex;gap:2px;justify-content:flex-end;opacity:0;transition:opacity .12s}.xst-r:hover .acts,.xst-r:focus-within .acts{opacity:1}.xst-r .acts button{height:26px;padding:0 8px;border:0;border-radius:6px;background:none;color:var(--muted);font:inherit;font-size:12px;cursor:pointer}.xst-r .acts button:hover{background:var(--hover-strong);color:var(--text)}.xst-r .acts button[data-on]{color:var(--text)}'
      + '.xst-r input{width:100%;height:28px;padding:0 8px;border:1px solid rgba(255,255,255,.28);border-radius:6px;background:var(--control);color:var(--text);font:inherit;font-size:13.5px;outline:none}'
      + '.xst-empty{padding:54px 20px;text-align:center;color:var(--muted);font-size:13.5px}.xst-empty b{display:block;color:var(--text);font-size:15px;font-weight:500;margin-bottom:6px}'
      + '.xst-move{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}.xst-move p{margin:0 0 8px;font-size:13px;color:var(--muted)}.xst-move div{display:flex;flex-wrap:wrap;gap:6px}'
      + '.xst-meter{margin:18px 0 0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}.xst-nums{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.xst-nums b{font-size:30px;font-weight:600;letter-spacing:-.02em}.xst-nums span{color:var(--muted);font-size:14px}.xst-nums em{margin-left:auto;font-style:normal;color:var(--muted);font-size:13px}'
      + '.xst-bar{display:flex;height:10px;margin-top:16px;border-radius:5px;overflow:hidden;background:var(--control)}.xst-bar i{display:block;height:100%;min-width:2px}.xst-p{margin:14px 0 0;font-size:13px;color:var(--muted)}.xst-h{margin:26px 0 8px;font-size:12px;color:var(--dim)}'
      + '.xst-k{display:grid;grid-template-columns:14px 1fr auto auto;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid var(--border);font-size:13.5px}.xst-k:first-child{border-top:0}.xst-k .sw{width:10px;height:10px;border-radius:3px}.xst-k small{color:var(--muted);font-size:12.5px}.xst-k b{font-weight:500;font-variant-numeric:tabular-nums}';
    document.head.appendChild(s);
  };
  const SHADES = ['var(--text)', '#bdbdbd', '#8f8f8f', '#6b6b6b', '#4c4c4c'];

  const mini = () => { const m = S.meter; if (!m) return ''; const lim = m.allowanceBytes; return `<button type="button" class="xst-mini" data-xst="usage" title="See what is using your storage"><span class="bar"><i style="width:${lim ? Math.min(100, Math.max(1, (m.usedBytes / lim) * 100)) : 0}%"></i></span>${esc(size(m.usedBytes))}${lim === null ? ' used' : ` of ${esc(size(lim))} used`}${m.full ? ' · full' : ''}</button>`; };

  function usage() {
    const m = S.meter; if (!m) return '<div class="xst-empty" role="status">Reading your storage</div>';
    const lim = m.allowanceBytes, kinds = m.byKind || [], total = lim ?? Math.max(m.usedBytes, 1), pct = lim ? Math.min(100, (m.usedBytes / lim) * 100) : 0;
    const note = m.full ? 'Your storage is full. New uploads are refused until you free some space or change your plan. Nothing is deleted, and everything you have stays readable.' : lim === null ? 'This account has no storage limit.' : `${size(m.remainingBytes)} free. Generated results are always kept, even if the account is full.`;
    return `<div class="xst-meter"><div class="xst-nums"><b>${esc(size(m.usedBytes))}</b><span>${lim === null ? 'used' : `of ${esc(size(lim))} used`}</span><em>${m.files} ${m.files === 1 ? 'file' : 'files'}${lim ? ` · ${pct < 0.1 && m.usedBytes ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%` : ''}</em></div>
      <div class="xst-bar">${kinds.map((k, i) => `<i style="width:${Math.max(0.4, (k.bytes / total) * 100)}%;background:${SHADES[i % SHADES.length]}"></i>`).join('')}</div><p class="xst-p">${esc(note)}</p></div>
      <div class="xst-h">What is using it</div><div class="xst-list">${kinds.length ? kinds.map((k, i) => `<div class="xst-k"><span class="sw" style="background:${SHADES[i % SHADES.length]}"></span><span>${esc(KIND[k.kind] || k.kind)}</span><small>${k.files} ${k.files === 1 ? 'file' : 'files'}</small><b>${esc(size(k.bytes))}</b></div>`).join('') : '<div class="xst-k"><span></span><span>Nothing stored yet</span><small></small><b></b></div>'}${m.trashBytes > 0 ? `<div class="xst-k"><span></span><span>In the trash</span><small>counts until it is deleted for good</small><b>${esc(size(m.trashBytes))}</b></div>` : ''}</div>
      ${S.largest.length ? `<div class="xst-h">Largest files</div><div class="xst-list">${S.largest.map((f) => `<div class="xst-k"><span></span><span>${esc(f.name)}</span><small></small><b>${esc(size(f.size_bytes))}</b></div>`).join('')}</div>` : ''}`;
  }

  const editing = (kind, id) => S.edit && S.edit.kind === kind && S.edit.id === id;
  function rows(at) {
    const trash = at.kind === 'trash', inFolder = at.kind === 'folder' && !S.q;
    const fold = inFolder ? S.folders.map((f) => `<div class="xst-r" data-xst-folder="${f.id}" draggable="true" tabindex="0"><span class="ic fd">DIR</span>${editing('folder', f.id) ? `<input data-xst-name value="${esc(f.name)}" aria-label="Folder name">` : `<span class="nm">${esc(f.name)}</span>`}<small>${f.items + f.folders} ${f.items + f.folders === 1 ? 'item' : 'items'}</small><small></small><span class="acts"><button type="button" data-xst="rename">Rename</button><button type="button" data-xst="move">Move</button><button type="button" data-xst="remove">Delete</button></span></div>`).join('') : '';
    const files = S.items.map((i) => `<div class="xst-r" data-xst-item="${esc(i.source)}:${esc(i.source_id)}" draggable="${trash ? 'false' : 'true'}" tabindex="0"><span class="ic">${esc(tag(i))}</span>${editing('item', i.source_id) ? `<input data-xst-name value="${esc(i.name)}" aria-label="File name">` : `<span class="nm" title="${esc(i.name)}">${esc(i.name)}</span>`}<small>${esc(when(trash ? i.trashed_at : i.updated_at || i.created_at))}</small><small>${Number(i.size_bytes) ? esc(size(i.size_bytes)) : ''}</small><span class="acts">${trash
      ? '<button type="button" data-xst="restore">Restore</button><button type="button" data-xst="purge">Delete forever</button>'
      : `<button type="button" data-xst="star"${i.starred ? ' data-on' : ''}>${i.starred ? 'Starred' : 'Star'}</button><button type="button" data-xst="rename">Rename</button><button type="button" data-xst="move">Move</button>${i.asset_id ? '<button type="button" data-xst="download">Download</button>' : ''}<button type="button" data-xst="trash">Trash</button>`}</span></div>`).join('');
    const fresh = S.edit && S.edit.kind === 'new' ? '<div class="xst-r"><span class="ic fd">DIR</span><input data-xst-name value="" placeholder="Folder name" aria-label="New folder name"><small></small><small></small><span></span></div>' : '';
    if (!fold && !files && !fresh) return `<div class="xst-empty"><b>${S.q ? 'Nothing matches' : trash ? 'The trash is empty' : at.kind === 'starred' ? 'Nothing starred yet' : at.kind === 'recent' ? 'Nothing here yet' : 'This folder is empty'}</b>${S.q ? 'Try another word.' : trash ? 'Deleted files stay here for 30 days, then they are gone for good.' : inFolder ? 'Drop files here, or use Upload.' : ''}</div>`;
    return `<div class="xst-hd"><span></span><span>Name</span><span>${trash ? 'Deleted' : 'Changed'}</span><span>Size</span><span></span></div>${fresh}${fold}${files}`;
  }

  function page() {
    style();
    const at = here(), key = `${at.kind}:${at.id || ''}:${S.q}`;
    if (S.key !== key) { S.items = []; S.folders = []; S.path = []; S.edit = null; S.moving = null; S.status = 'loading'; S.key = key; setTimeout(load, 0); }
    if (!P || !P.served) return '<div class="xst"><div class="xst-top"><div class="xst-path"><button type="button">Storage</button></div></div><div class="xst-list"><div class="xst-empty"><b>Storage is read from the platform</b>Open the workspace on xenosystem.ai to see your files.</div></div></div>';
    const title = at.kind === 'folder' ? [{ id: null, name: 'My files' }, ...S.path] : [{ id: null, name: at.kind[0].toUpperCase() + at.kind.slice(1) }];
    const path = title.map((p, i) => `${i ? '<i>/</i>' : ''}<button type="button" data-xst="crumb" data-id="${p.id || ''}"${at.kind === 'folder' ? ' data-xst-crumb' : ''}>${esc(p.name)}</button>`).join('');
    const tools = at.kind === 'usage' ? '' : `<input class="xst-find" type="search" placeholder="Search your storage" value="${esc(S.q)}" data-xst-find aria-label="Search your storage">${at.kind === 'folder' ? '<button type="button" class="xst-btn" data-xst="new">New folder</button><button type="button" class="xst-btn xst-go" data-xst="upload">Upload</button><input type="file" multiple hidden data-xst-files>' : ''}`;
    const body = S.status === 'missing' ? '<div class="xst-list"><div class="xst-empty"><b>This folder is gone</b>It may have been deleted. <button type="button" class="xst-btn" data-xst="crumb" data-id="">Back to My files</button></div></div>'
      : S.status === 'error' ? '<div class="xst-list"><div class="xst-empty"><b>Your storage could not be read just now</b><button type="button" class="xst-btn" data-xst="retry">Try again</button></div></div>'
      : at.kind === 'usage' ? usage()
      : S.status === 'loading' ? '<div class="xst-list"><div class="xst-empty" role="status">Loading</div></div>'
      : `<div class="xst-list" data-xst-list>${rows(at)}</div>`;
    const mover = S.moving ? `<div class="xst-move"><p>Move “${esc(S.moving.name)}” to</p><div><button type="button" class="xst-btn" data-xst="moveto" data-id="">My files</button>${S.all.filter((f) => f.id !== S.moving.id).map((f) => `<button type="button" class="xst-btn" data-xst="moveto" data-id="${f.id}">${esc(f.name)}</button>`).join('')}<button type="button" class="xst-btn" data-xst="movecancel">Cancel</button></div></div>` : '';
    return `<div class="xst"><div class="xst-top"><div class="xst-path">${path}</div>${tools}</div>${at.kind === 'usage' ? '' : mini()}${S.note ? `<div class="xst-note" role="status">${esc(S.note)}</div>` : ''}${mover}${body}</div>`;
  }

  // ---- actions ----
  const refOf = (el) => { const r = el.closest('[data-xst-item]'); if (r) { const [source, id] = r.dataset.xstItem.split(':'); return { kind: 'item', source, id, row: S.items.find((i) => i.source === source && i.source_id === id) }; } const f = el.closest('[data-xst-folder]'); return f ? { kind: 'folder', id: f.dataset.xstFolder, row: S.folders.find((x) => x.id === f.dataset.xstFolder) } : null; };
  const done = async (r, fail) => { if (!r.ok) say(whyNot(r, fail)); await reload(); };
  async function moveTo(ref, folderId) {
    if (ref.kind === 'folder') { if (ref.id === folderId) return; return done(await api('PATCH', `/api/library/folders/${ref.id}`, { parent: folderId }), 'The folder wasn’t moved.'); }
    return done(await api('PUT', `/api/library/assets/${ref.source}/${ref.id}/folder`, { folder: folderId }), 'The file wasn’t moved.');
  }
  async function upload(files) {
    const at = here(); let added = 0; S.busy += 1; say(`Uploading ${files.length} ${files.length === 1 ? 'file' : 'files'}`);
    for (const file of files) {
      const body = new FormData(); body.append('image', file, file.name);
      const headers = { 'x-xeno-surface': 'xeno-web' }; const t = P.csrf?.(); if (t) headers['x-xeno-csrf'] = t; const area = P.area?.(); if (area) headers['x-xeno-area'] = area;
      let r, d = null; try { r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', headers, body }); d = await r.json().catch(() => null); } catch { say('XENO could not be reached.'); break; }
      if (!r.ok || !d || d.success === false) { say(`“${file.name}” wasn’t added: ${(d && d.error) || 'XENO refused it'}.`); break; }
      added += 1;
      if (at.kind === 'folder' && at.id && d.file && d.file.id) await api('PUT', `/api/library/assets/file/${d.file.id}/folder`, { folder: at.id });
    }
    S.busy -= 1; if (added === files.length) say(`${added} ${added === 1 ? 'file' : 'files'} added`); await reload();
  }
  async function commitName(input) {
    const edit = S.edit, name = input.value.trim(); S.edit = null;
    if (!edit) return; if (!name) return paint();
    const at = here();
    if (edit.kind === 'new') return done(await api('POST', '/api/library/folders', { name, parent: at.id }), 'The folder wasn’t created.');
    if (edit.kind === 'folder') return done(await api('PATCH', `/api/library/folders/${edit.id}`, { name }), 'The folder wasn’t renamed.');
    return done(await api('PATCH', `/api/library/assets/${edit.source}/${edit.id}`, { name }), 'The file wasn’t renamed.');
  }
  // the page is redrawn with a short crossfade, so the field is looked for until it is the live one and holds the caret
  const focusName = (tries = 12) => setTimeout(() => { const all = document.querySelectorAll('.xst [data-xst-name]'), i = all[all.length - 1]; if (i && document.activeElement !== i) { i.focus(); const dot = i.value.lastIndexOf('.'); try { i.setSelectionRange(0, dot > 0 ? dot : i.value.length); } catch {} } if (tries > 0 && (!i || document.activeElement !== i || all.length > 1)) focusName(tries - 1); }, 60);

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#panel [data-xl-new="storage"]')) { e.preventDefault(); e.stopImmediatePropagation(); go(null); setTimeout(() => document.querySelector('.xst [data-xst-files]')?.click(), 250); return; }
    const b = e.target.closest('.xst [data-xst]');
    // a click on a folder opens it (its buttons and its name field are their own)
    if (!b) { const f = e.target.closest('.xst [data-xst-folder]'); if (f && !e.target.closest('input') && !editing('folder', f.dataset.xstFolder)) go(`f/${f.dataset.xstFolder}`); return; }
    const act = b.dataset.xst, ref = refOf(b);
    if (act === 'retry') return reload();
    if (act === 'usage') return go('Usage');
    if (act === 'crumb') { const at = here(); return at.kind === 'folder' ? go(b.dataset.id ? `f/${b.dataset.id}` : null) : null; }
    if (act === 'new') { S.edit = { kind: 'new' }; paint(); return focusName(); }
    if (act === 'upload') return document.querySelector('.xst [data-xst-files]')?.click();
    if (act === 'movecancel') { S.moving = null; return paint(); }
    if (act === 'moveto') { const m = S.moving; S.moving = null; return moveTo(m, b.dataset.id || null); }
    if (!ref || !ref.row) return;
    if (act === 'rename') { S.edit = ref.kind === 'folder' ? { kind: 'folder', id: ref.id } : { kind: 'item', id: ref.id, source: ref.source }; paint(); return focusName(); }
    if (act === 'move') { const all = await api('GET', '/api/library/folders?all=true'); S.all = (all.d && all.d.folders) || []; S.moving = { ...ref, name: ref.row.name }; return paint(); }
    if (act === 'remove') return done(await api('DELETE', `/api/library/folders/${ref.id}`), 'The folder wasn’t deleted.');
    const base = `/api/library/assets/${ref.source}/${ref.id}`;
    if (act === 'star') return done(await api(ref.row.starred ? 'DELETE' : 'PUT', `${base}/star`), 'That didn’t work.');
    if (act === 'trash') { const r = await api('POST', `${base}/trash`); if (r.ok) say(`“${ref.row.name}” moved to the trash`); return done(r, 'The file wasn’t moved to the trash.'); }
    if (act === 'restore') return done(await api('POST', `${base}/restore`), 'The file wasn’t restored.');
    if (act === 'purge') { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; } return done(await api('DELETE', `/api/library/trash/${ref.source}/${ref.id}`), 'The file wasn’t deleted.'); }
    if (act === 'download') { const r = await api('POST', `/api/library/assets/${ref.row.asset_id}/link`, { download: true }); const url = r.ok && (r.d.url || r.d.link); if (!url) return say(whyNot(r, 'This file can’t be downloaded yet.')); const a = document.createElement('a'); a.href = url; a.download = ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
  }, true);
  document.addEventListener('dblclick', (e) => { if (e.target.closest('.xst .acts, .xst input')) return; const i = e.target.closest('.xst [data-xst-item]'); if (i) { const ref = refOf(i); if (ref.row) X()?.go?.('global', { global: 'library', item: ref.row.name }); } });
  document.addEventListener('keydown', (e) => {
    const name = e.target.closest?.('.xst [data-xst-name]'); if (name) { if (e.key === 'Enter') { e.preventDefault(); commitName(name); } else if (e.key === 'Escape') { S.edit = null; paint(); } return; }
    const find = e.target.closest?.('.xst [data-xst-find]'); if (find && e.key === 'Enter') { S.q = find.value.trim(); paint(); return; }
    const row = e.target.closest?.('.xst .xst-r'); if (row && e.key === 'Enter' && row.dataset.xstFolder) go(`f/${row.dataset.xstFolder}`);
  });
  document.addEventListener('focusout', (e) => { const name = e.target.closest?.('.xst [data-xst-name]'); if (name && S.edit && name.isConnected && name.value.trim()) commitName(name); });
  document.addEventListener('input', (e) => { const find = e.target.closest?.('.xst [data-xst-find]'); if (find && !find.value && S.q) { S.q = ''; paint(); } });
  document.addEventListener('change', (e) => { const input = e.target.closest?.('.xst [data-xst-files]'); if (input && input.files.length) { const files = [...input.files]; input.value = ''; upload(files); } });
  // drag: a row onto a folder or a breadcrumb moves it; files from the computer onto the list upload
  let held = null;
  document.addEventListener('dragstart', (e) => { const row = e.target.closest?.('.xst .xst-r[draggable="true"]'); if (!row) return; held = refOf(row); e.dataTransfer.effectAllowed = 'all'; e.dataTransfer.setData('text/plain', held?.row?.name || ''); });
  document.addEventListener('dragend', () => { held = null; document.querySelectorAll('.xst [data-over],.xst [data-drop]').forEach((n) => { n.removeAttribute('data-over'); n.removeAttribute('data-drop'); }); });
  const target = (e) => e.target.closest?.('.xst [data-xst-folder], .xst [data-xst-crumb]');
  document.addEventListener('dragover', (e) => {
    const list = e.target.closest?.('.xst [data-xst-list]'), fromDisk = !held && [...(e.dataTransfer?.types || [])].includes('Files');
    if (fromDisk && list && here().kind === 'folder') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; list.setAttribute('data-drop', ''); return; }
    const t = held && target(e); if (!t || (held.kind === 'folder' && t.dataset.xstFolder === held.id)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.xst [data-over]').forEach((n) => n.removeAttribute('data-over')); t.setAttribute('data-over', '');
  });
  document.addEventListener('drop', (e) => {
    const list = e.target.closest?.('.xst [data-xst-list]');
    if (!held && list && e.dataTransfer?.files?.length && here().kind === 'folder') { e.preventDefault(); list.removeAttribute('data-drop'); return void upload([...e.dataTransfer.files]); }
    const t = held && target(e); if (!t) return; e.preventDefault(); const ref = held; held = null;
    moveTo(ref, t.dataset.xstFolder || t.dataset.id || null);
  });
  window.XENO_STORAGE = { page, reload, state: () => ({ status: S.status, meter: S.meter, folders: S.folders.length, items: S.items.length }) };
})();
