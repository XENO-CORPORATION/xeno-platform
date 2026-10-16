/* XENO_STORAGE — XENO Storage (codename Arca): the account's files, as a drive. Corpo product, real platform API.
 *
 * One store for everything an account holds. This is its own interface: folders, files, upload, move, rename,
 * star, trash, search, and the space it all takes. The Library is another view of the same store.
 *
 *   My files   /workspace/corpo/apps/storage            the top folder
 *   a folder   /workspace/corpo/apps/storage/f/<id>     by id, so a rename never breaks the address
 *   a team     /workspace/corpo/apps/storage/t/<workspace id>   that workspace's shared folders and files
 *   Recent · Starred · Shared · Trash · Usage            the sidebar views
 *   a file's preview                                      ?view=<source>:<id> on the page's own address
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
  const VIEWS = ['Recent', 'Starred', 'Shared', 'Trash', 'Usage'];
  const S = { key: null, status: 'idle', folders: [], path: [], items: [], total: 0, meter: null, largest: [], q: '', note: '', edit: null, moving: null, all: [], busy: 0, sel: new Set(), anchor: null, preview: null, sharing: null, versions: null, scope: null, teams: null };
  const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const when = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const days = Math.floor((Date.now() - d.getTime()) / 86400000); return days < 1 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : days < 7 ? `${days} d ago` : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  const KIND = { image: 'Images', video: 'Video', audio: 'Audio', '3d': '3D models', document: 'Documents' };
  const tag = (i) => { const m = String(i.mime_type || ''); const ext = (String(i.name).match(/\.([a-z0-9]{1,5})$/i) || [])[1]; return (m.startsWith('image/') ? 'IMG' : m.startsWith('video/') ? 'VID' : m.startsWith('audio/') ? 'AUD' : m === 'application/pdf' ? 'PDF' : ext ? ext.toUpperCase().slice(0, 4) : 'FILE'); };
  const paint = () => { try { X()?.render?.(); } catch {} for (const ms of [120, 450, 900]) setTimeout(() => { try { fillDoc(); } catch {} }, ms); };   // the page is redrawn with a crossfade: the live copy is filled once it is the one on screen
  const say = (text) => { S.note = text; paint(); clearTimeout(say.t); say.t = setTimeout(() => { S.note = ''; paint(); }, 4200); };
  const here = () => { const it = X()?.S?.item || ''; const f = /^f\/([0-9a-f-]{36})$/i.exec(it), t = /^t\/([0-9a-f-]{36})$/i.exec(it); return t ? { kind: 'folder', id: null, team: t[1].toLowerCase() } : f ? { kind: 'folder', id: f[1].toLowerCase() } : VIEWS.includes(it) ? { kind: it.toLowerCase() } : { kind: 'folder', id: null }; };
  const go = (item) => X()?.go?.('product', { product: 'storage', item: item || null });
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const whyNot = (r, fallback) => (r && r.d && (r.d.error || r.d.message)) || fallback;

  async function load() {
    if (!P || !P.served) { S.status = 'offline'; return; }
    const at = here(), key = `${at.kind}:${at.id || at.team || ''}:${S.q}`;
    S.key = key; if (!S.items.length && !S.folders.length) S.status = 'loading';
    // the workspaces this person is in, for team folders (once)
    if (S.teams === null) { S.teams = []; api('GET', '/api/workspaces').then((r) => { S.teams = ((r.ok && r.d.workspaces) || []).filter((w) => w.workspace_type !== 'personal').map((w) => ({ id: w.id, name: w.name })); paint(); }); }
    const meter = api('GET', '/api/library/storage');
    let folders = { ok: true, d: { folders: [], path: [] } }, list;
    const q = S.q ? `&query=${encodeURIComponent(S.q)}` : '';
    if (at.kind === 'usage') list = api('GET', '/api/library/assets?sort=size&limit=8');
    else if (at.kind === 'recent') list = api('GET', `/api/library/assets?sort=updated&limit=60${q}`);
    else if (at.kind === 'starred') list = api('GET', `/api/library/assets?view=starred&sort=updated&limit=200${q}`);
    else if (at.kind === 'shared') { list = api('GET', `/api/library/assets?owned=shared&sort=updated&limit=200${q}`); if (!S.q) folders = api('GET', '/api/library/folders?shared=true'); }
    else if (at.kind === 'trash') list = api('GET', `/api/library/assets?view=trash&sort=updated&limit=200${q}`);
    else if (S.q) list = api('GET', `/api/library/assets?sort=updated&limit=200${q}`);   // a search looks everywhere
    else if (at.team) { folders = api('GET', `/api/library/folders?workspace=${at.team}`); list = api('GET', `/api/library/assets?folder=root&place=${at.team}&sort=name&limit=200`); }
    else { folders = api('GET', `/api/library/folders?parent=${at.id || 'root'}`); list = api('GET', at.id ? `/api/library/assets?folder=${at.id}&sort=name&limit=200` : '/api/library/assets?folder=root&owned=mine&place=personal&sort=name&limit=200'); }
    const [m, f, l] = await Promise.all([meter, folders, list]);
    if (S.key !== key) return;   // the person moved on while this loaded
    if (m.ok && m.d.storage) S.meter = m.d.storage;
    if (!l.ok || (f.ok === false)) { S.status = f.status === 404 || (f.d && f.d.code === 'not_found') ? 'missing' : 'error'; return paint(); }
    S.scope = at.kind === 'folder' ? (f.d.workspace || at.team || null) : null;
    S.guest = at.kind === 'folder' && f.d.shared === true;   // looking into a folder someone shared with me
    // My files (the top, no team): only what is the person's own; a team's files live under that team
    S.folders = f.d.folders || []; S.path = f.d.path || [];
    // "Shared": the folders shared with me, and the files shared one by one (a file inside a shared folder is found in it)
    S.items = at.kind === 'shared' && !S.q ? (l.d.items || []).filter((i) => !i.folder_id) : l.d.items || []; S.total = l.d.total || S.items.length;
    if (at.kind === 'usage') S.largest = S.items.filter((i) => Number(i.size_bytes) > 0);
    S.sel = new Set([...S.sel].filter((k) => S.items.some((i) => keyOf(i) === k)));
    // a preview named in the address opens once its file is listed
    const wanted = new URLSearchParams(location.search).get('view'); if (wanted && !S.preview && S.items.some((i) => keyOf(i) === wanted)) S.preview = wanted;
    S.status = 'ready'; paint();
  }
  const keyOf = (i) => `${i.source}:${i.source_id}`;
  const reload = () => { S.key = null; return load(); };

  const style = () => {
    if (document.getElementById('xst-css')) return; const s = document.createElement('style'); s.id = 'xst-css';
    s.textContent = '.xst{display:flex;flex-direction:column;min-height:100%;padding:18px 28px 60px}.xst.xst-tb{display:flex;flex-direction:row;align-items:center;gap:8px;min-height:0;padding:0}.xst-tb .xst-find{width:240px}.pg-top-sep{width:1px;height:16px;background:var(--border);margin:0 10px;flex:none}.xst-top{display:flex;align-items:center;gap:10px;min-height:36px}'
      + '.xst-path{display:flex;align-items:center;gap:2px;min-width:0;flex:1;font-size:18px;font-weight:600;letter-spacing:-.015em}.xst-path button{border:0;background:none;color:var(--muted);font:inherit;padding:4px 7px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}.xst-path button:hover,.xst-path button[data-over]{background:var(--hover);color:var(--text)}.xst-path button:last-of-type{color:var(--text)}.xst-path i{color:var(--dim);font-style:normal;font-weight:400}'
      + '.xst-find{width:230px;height:32px;padding:0 11px;border:1px solid var(--border);border-radius:8px;background:var(--control);color:var(--text);font:inherit;font-size:13px;outline:none}.xst-find:focus{border-color:rgba(255,255,255,.28)}'
      + '.xst-btn{height:32px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}.xst-btn:hover{background:var(--hover)}.xst-btn.xst-go{background:var(--text);color:var(--canvas);border-color:transparent;font-weight:500}.xst-btn.xst-go:hover{opacity:.9}'
      + '.xst-mini{display:flex;align-items:center;gap:9px;margin:0;white-space:nowrap;font-size:12.5px;color:var(--muted);border:0;background:none;padding:0;cursor:pointer;font:inherit;font-size:12.5px}.xst-mini .bar{width:160px;height:5px;border-radius:3px;background:var(--control);overflow:hidden}.xst-mini .bar i{display:block;height:100%;background:var(--text);border-radius:3px}.xst-mini:hover{color:var(--text)}'
      + '.xst-note{margin:12px 0 0;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);background:var(--panel)}'
      + '.xst-list{margin-top:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}.xst-list[data-drop]{border-color:rgba(255,255,255,.4)}'
      + '.xst-hd,.xst-r{display:grid;grid-template-columns:34px minmax(0,1fr) 110px 96px 150px;gap:10px;align-items:center;padding:0 14px}.xst-hd{height:34px;font-size:11.5px;color:var(--dim);border-bottom:1px solid var(--border)}'
      + '.xst-r{height:44px;border-top:1px solid var(--border);font-size:13.5px;cursor:default;user-select:none}.xst-r:first-of-type{border-top:0}.xst-r:hover,.xst-r[data-over]{background:var(--hover)}.xst-r[data-over]{box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}'
      + '.xst-r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xst-r small{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}.xst-r .ic{width:26px;height:26px;border-radius:6px;background:var(--control);display:grid;place-items:center;font-size:8.5px;font-weight:600;letter-spacing:.02em;color:var(--muted)}.xst-r .ic.fd{background:var(--text);color:var(--canvas)}'
      + '.xst-r{position:relative}.xst-r[data-sel]{background:rgba(255,255,255,.09)}.xst-r .ic img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}.xst-r .nm em{font-style:normal;font-size:11px;color:var(--dim);margin-left:8px}'
      + '.xst-r .acts{position:absolute;right:8px;top:8px;padding-left:18px;background:linear-gradient(90deg,transparent,var(--elevated) 16px);border-radius:6px}'
      + '.xst-r .ic.tm{background:none;border:1px solid var(--border);color:var(--text)}.xst-sec{padding:10px 14px 6px;font-size:11.5px;color:var(--dim);border-top:1px solid var(--border)}'
      + '.xst-bulk{display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 10px 8px 14px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:var(--elevated);font-size:13px}.xst-bulk b{font-weight:500;margin-right:auto}'
      + '.xst-share{margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}.xst-share h3{margin:0 0 10px;font-size:14px;font-weight:500}.xst-share .line{display:flex;gap:8px;align-items:center;margin-top:8px}.xst-share input,.xst-share select{height:32px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--control);color:var(--text);font:inherit;font-size:13px;outline:none}.xst-share input{flex:1;min-width:0}.xst-share input:focus{border-color:rgba(255,255,255,.28)}.xst-share .who{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border);font-size:13px}.xst-share .who span{flex:1}.xst-share .who small{color:var(--muted)}.xst-share .url{font-size:12.5px;color:var(--muted);word-break:break-all;margin-top:8px}'
      + '.xst-pv{position:fixed;inset:0;z-index:900;display:grid;grid-template-rows:auto 1fr;background:rgba(8,8,8,.94);animation:xst-in .18s ease-out}@keyframes xst-in{from{opacity:0}to{opacity:1}}.xst-pv header{display:flex;align-items:center;gap:8px;padding:12px 16px}.xst-pv header b{flex:1;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xst-pv header small{color:var(--muted);font-size:12.5px}'
      + '.xst-pv .stage{display:grid;place-items:center;min-height:0;padding:0 56px 28px;position:relative}.xst-pv .stage img,.xst-pv .stage video{max-width:100%;max-height:calc(100vh - 100px);border-radius:8px;object-fit:contain}.xst-pv .stage audio{width:min(520px,90%)}.xst-pv .none{text-align:center;color:var(--muted);font-size:13.5px}.xst-pv .none b{display:block;color:var(--text);font-size:16px;font-weight:500;margin:14px 0 6px}.xst-pv .none .big{width:84px;height:84px;margin:0 auto;border-radius:12px;background:var(--control);display:grid;place-items:center;font-size:15px;font-weight:600;color:var(--muted)}'
      + '.xst-pv .doc{width:min(1000px,100%);height:calc(100vh - 100px);border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:auto;display:grid}.xst-pv .doc embed{width:100%;height:100%;border:0;border-radius:8px}.xst-pv .doc pre{margin:0;padding:18px 20px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--text);white-space:pre-wrap;word-break:break-word;align-self:start}'
      + '.xst-pv .nav{position:absolute;top:50%;width:40px;height:56px;margin-top:-28px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;font-size:18px;cursor:pointer}.xst-pv .nav:hover{background:var(--elevated)}.xst-pv .nav.prev{left:10px}.xst-pv .nav.next{right:10px}'
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
    const guestFolders = at.kind === 'shared' || S.guest;
    const fold = (inFolder || (at.kind === 'shared' && !S.q)) ? S.folders.map((f) => `<div class="xst-r" data-xst-folder="${f.id}" draggable="true" tabindex="0"><span class="ic fd">DIR</span>${editing('folder', f.id) ? `<input data-xst-name value="${esc(f.name)}" aria-label="Folder name">` : `<span class="nm">${esc(f.name)}</span>`}<small>${f.owner ? `from ${esc(f.owner)}` : `${f.items + f.folders} ${f.items + f.folders === 1 ? 'item' : 'items'}`}</small><small></small><span class="acts">${guestFolders ? '' : `<button type="button" data-xst="rename">Rename</button><button type="button" data-xst="move">Move</button>${S.scope ? '' : '<button type="button" data-xst="share">Share</button>'}<button type="button" data-xst="remove">Delete</button>`}</span></div>`).join('') : '';
    const pic = (i) => (!trash && i.asset_id && /^image\/(jpeg|png|gif|webp)$/.test(String(i.mime_type)) ? `<img src="/api/library/assets/${esc(i.asset_id)}/content?variant=thumbnail" alt="" loading="lazy" decoding="async">` : esc(tag(i)));
    const files = S.items.map((i) => `<div class="xst-r" data-xst-item="${esc(i.source)}:${esc(i.source_id)}"${S.sel.has(keyOf(i)) ? ' data-sel aria-selected="true"' : ''} draggable="${trash ? 'false' : 'true'}" tabindex="0"><span class="ic">${pic(i)}</span>${editing('item', i.source_id) ? `<input data-xst-name value="${esc(i.name)}" aria-label="File name">` : `<span class="nm" title="${esc(i.name)}">${esc(i.name)}${i.shared && i.mine !== false ? '<em>Shared</em>' : ''}${i.mine === false ? `<em>Shared with you${i.shared_role === 'editor' ? ' · can edit' : ''}</em>` : ''}</span>`}<small>${esc(when(trash ? i.trashed_at : i.updated_at || i.created_at))}</small><small>${Number(i.size_bytes) ? esc(size(i.size_bytes)) : ''}</small><span class="acts">${trash
      ? '<button type="button" data-xst="restore">Restore</button><button type="button" data-xst="purge">Delete forever</button>'
      : `<button type="button" data-xst="star"${i.starred ? ' data-on' : ''}>${i.starred ? 'Starred' : 'Star'}</button>${i.mine === false && i.shared_role !== 'editor' ? '' : '<button type="button" data-xst="rename">Rename</button>'}${i.mine === false && i.shared_role === 'editor' && i.source === 'file' ? '<button type="button" data-xst="versions">New version</button>' : ''}${i.mine === false ? '' : '<button type="button" data-xst="move">Move</button>'}${i.mine !== false && i.source === 'file' ? '<button type="button" data-xst="share">Share</button><button type="button" data-xst="versions">Versions</button>' : ''}${i.asset_id ? '<button type="button" data-xst="download">Download</button>' : ''}${i.mine === false ? '' : '<button type="button" data-xst="trash">Trash</button>'}`}</span></div>`).join('');
    const teams = inFolder && !at.id && !at.team && (S.teams || []).length ? `<div class="xst-sec">Teams</div>${S.teams.map((t) => `<div class="xst-r" data-xst-team="${t.id}" tabindex="0"><span class="ic tm">TEAM</span><span class="nm">${esc(t.name)}</span><small>shared folders</small><small></small><span></span></div>`).join('')}` : '';
    const fresh = S.edit && S.edit.kind === 'new' ? '<div class="xst-r"><span class="ic fd">DIR</span><input data-xst-name value="" placeholder="Folder name" aria-label="New folder name"><small></small><small></small><span></span></div>' : '';
    if (!fold && !files && !fresh && !teams) return `<div class="xst-empty"><b>${S.q ? 'Nothing matches' : trash ? 'The trash is empty' : at.kind === 'starred' ? 'Nothing starred yet' : at.kind === 'shared' ? 'Nothing has been shared with you' : at.kind === 'recent' ? 'Nothing here yet' : 'This folder is empty'}</b>${S.q ? 'Try another word.' : trash ? 'Deleted files stay here for 30 days, then they are gone for good.' : inFolder ? 'Drop files here, or use Upload.' : ''}</div>`;
    return `<div class="xst-hd"><span></span><span>Name</span><span>${trash ? 'Deleted' : 'Changed'}</span><span>Size</span><span></span></div>${fresh}${fold}${files}${teams}`;
  }

  function page() {
    style();
    const at = here(), key = `${at.kind}:${at.id || at.team || ''}:${S.q}`;
    if (S.key !== key) { S.versions = null; S.items = []; S.folders = []; S.path = []; S.edit = null; S.moving = null; S.sharing = null; S.sel = new Set(); if (S.key !== null) S.preview = null; S.status = 'loading'; S.key = key; setTimeout(load, 0); }
    if (!P || !P.served) return '<div class="xst"><div class="xst-top"><div class="xst-path"><button type="button">Storage</button></div></div><div class="xst-list"><div class="xst-empty"><b>Storage is read from the platform</b>Open the workspace on xenosystem.ai to see your files.</div></div></div>';
    const teamName = S.scope ? ((S.teams || []).find((t) => t.id === S.scope)?.name || 'Team') : null;
    const title = at.kind === 'folder' ? [S.guest ? { id: 'v:Shared', name: 'Shared' } : { id: null, name: 'My files' }, ...(S.scope ? [{ id: `t:${S.scope}`, name: teamName }] : []), ...S.path] : [{ id: null, name: at.kind[0].toUpperCase() + at.kind.slice(1) }];
    const path = title.map((p, i) => `${i ? '<i>/</i>' : ''}<button type="button" data-xst="crumb" data-id="${p.id || ''}"${at.kind === 'folder' ? ' data-xst-crumb' : ''}>${esc(p.name)}</button>`).join('');
    const tools = at.kind === 'usage' ? '' : `<input class="xst-find" type="search" placeholder="Search your storage" value="${esc(S.q)}" data-xst-find aria-label="Search your storage">${at.kind === 'folder' && !S.guest ? '<button type="button" class="xst-btn" data-xst="new">New folder</button><button type="button" class="xst-btn xst-go" data-xst="upload">Upload</button><input type="file" multiple hidden data-xst-files>' : ''}`;
    const body = S.status === 'missing' ? '<div class="xst-list"><div class="xst-empty"><b>This folder is gone</b>It may have been deleted. <button type="button" class="xst-btn" data-xst="crumb" data-id="">Back to My files</button></div></div>'
      : S.status === 'error' ? '<div class="xst-list"><div class="xst-empty"><b>Your storage could not be read just now</b><button type="button" class="xst-btn" data-xst="retry">Try again</button></div></div>'
      : at.kind === 'usage' ? usage()
      : S.status === 'loading' ? '<div class="xst-list"><div class="xst-empty" role="status">Loading</div></div>'
      : `<div class="xst-list" data-xst-list>${rows(at)}</div>`;
    const mover = S.moving ? `<div class="xst-move"><p>Move “${esc(S.moving.name)}” to</p><div><button type="button" class="xst-btn" data-xst="moveto" data-id="">My files</button>${S.all.filter((f) => f.id !== S.moving.id).map((f) => `<button type="button" class="xst-btn" data-xst="moveto" data-id="${f.id}">${esc(f.name)}</button>`).join('')}<button type="button" class="xst-btn" data-xst="movecancel">Cancel</button></div></div>` : '';
    const picked = S.items.filter((i) => S.sel.has(keyOf(i)));
    const bulk = picked.length > 1 || (picked.length === 1 && !S.preview) ? `<div class="xst-bulk" role="toolbar" aria-label="Selected files"><b>${picked.length} selected</b>${at.kind === 'trash' ? '<button type="button" class="xst-btn" data-xst="bulk-restore">Restore</button>' : `${picked.length === 1 ? '<button type="button" class="xst-btn" data-xst="bulk-open">Open</button>' : ''}<button type="button" class="xst-btn" data-xst="bulk-move">Move</button><button type="button" class="xst-btn" data-xst="bulk-star">Star</button><button type="button" class="xst-btn" data-xst="bulk-download">Download</button><button type="button" class="xst-btn" data-xst="bulk-trash">Trash</button>`}<button type="button" class="xst-btn" data-xst="bulk-clear">Clear</button></div>` : '';
    const sh = S.sharing ? `<div class="xst-share"><h3>Share “${esc(S.sharing.name)}”</h3>
      <div class="line"><input type="text" data-xst-who placeholder="Email or username of a XENO account" aria-label="Email or username"><select data-xst-role aria-label="What they can do"><option value="viewer">Can view</option><option value="editor">Can edit</option></select><button type="button" class="xst-btn xst-go" data-xst="share-person">Share</button></div>
      ${S.sharing.folder ? '<p class="url">Everything in this folder, and in the folders inside it, is shared: what is there now and what is added later. Can edit means rename a file and upload a new version of it.</p><div class="line"><button type="button" class="xst-btn" data-xst="share-close" style="margin-left:auto">Done</button></div>' : ''}
      <div class="line"${S.sharing.folder ? ' hidden' : ''}><select data-xst-days aria-label="How long the link lasts"><option value="7">Link for 7 days</option><option value="30">Link for 30 days</option><option value="">Link with no end</option></select><button type="button" class="xst-btn" data-xst="share-link">Create link</button><button type="button" class="xst-btn" data-xst="share-close" style="margin-left:auto">Done</button></div>
      ${S.sharing.url ? `<p class="url">Anyone with this link can open the file. It is shown once: <br><span data-xst-url>${esc(S.sharing.url)}</span> <button type="button" class="xst-btn" data-xst="share-copy">Copy</button></p>` : ''}
      ${(S.sharing.shares || []).map((x) => `<div class="who"><span>${x.kind === 'person' ? esc(x.person.name || x.person.username) : 'A link'}</span><small>${x.kind === 'person' ? (x.role === 'editor' ? 'can edit' : 'can view') : x.expiresAt ? `until ${esc(new Date(x.expiresAt).toLocaleDateString())}` : 'no end'}</small><button type="button" class="xst-btn" data-xst="share-off" data-id="${x.id}">Remove</button></div>`).join('')}</div>` : '';
    S.top = { tools, meter: at.kind === 'usage' ? '' : mini() };   // the workspace top bar draws these (top())
    return `<div class="xst"><div class="xst-top"><div class="xst-path">${path}</div></div>${S.note ? `<div class="xst-note" role="status">${esc(S.note)}</div>` : ''}${bulk}${mover}${sh}${versionsPane()}${body}${previewPane()}</div>`;
  }

  function versionsPane() {
    const v = S.versions; if (!v) return '';
    return `<div class="xst-share"><h3>Versions of “${esc(v.name)}”</h3>
      <div class="line"><button type="button" class="xst-btn xst-go" data-xst="ver-upload">Upload a new version</button><input type="file" hidden data-xst-verfile><span style="font-size:12.5px;color:var(--muted)">A new version is checked like any upload. Every version counts toward your storage.</span><button type="button" class="xst-btn" data-xst="ver-close" style="margin-left:auto">Done</button></div>
      ${(v.list || []).map((x, i) => `<div class="who"><span>${x.current ? 'Current version' : `Version ${v.list.length - i}`}</span><small>${esc(when(x.createdAt))} · ${esc(size(x.sizeBytes))}</small>${x.current ? '' : `<button type="button" class="xst-btn" data-xst="ver-get" data-id="${x.id}">Download</button><button type="button" class="xst-btn" data-xst="ver-restore" data-id="${x.id}">Restore</button>`}</div>`).join('')}</div>`;
  }
  const loadVersions = async () => { const r = await api('GET', `/api/library/assets/file/${S.versions.id}/versions`); if (S.versions) { S.versions.list = (r.ok && r.d.versions) || []; paint(); } };
  function previewPane() {
    const i = S.preview && S.items.find((x) => keyOf(x) === S.preview); if (!i) return '';
    const m = String(i.mime_type || ''), src = i.asset_id ? `/api/library/assets/${esc(i.asset_id)}/content` : i.preview_url ? esc(i.preview_url) : '';
    const body = src && /^image\/(jpeg|png|gif|webp)$/.test(m) ? `<img src="${src}" alt="${esc(i.name)}">`
      : src && m.startsWith('video/') ? `<video src="${src}" controls autoplay playsinline></video>`
      : src && m.startsWith('audio/') ? `<audio src="${src}" controls autoplay></audio>`
      : i.asset_id && (m === 'application/pdf' || isText(i)) ? `<div class="doc" data-xst-doc="${esc(i.asset_id)}" data-kind="${m === 'application/pdf' ? 'pdf' : 'text'}"><div class="none" role="status">Opening</div></div>`
      : `<div class="none"><div class="big">${esc(tag(i))}</div><b>${esc(i.name)}</b>This kind of file is not shown here. ${i.asset_id ? 'Download it to open it.' : ''}</div>`;
    const many = S.items.length > 1;
    return `<div class="xst-pv" role="dialog" aria-modal="true" aria-label="${esc(i.name)}"><header><b>${esc(i.name)}</b><small>${Number(i.size_bytes) ? esc(size(i.size_bytes)) : ''}</small>${i.asset_id ? '<button type="button" class="xst-btn" data-xst="pv-download">Download</button>' : ''}<button type="button" class="xst-btn" data-xst="pv-close">Close</button></header><div class="stage">${many ? '<button type="button" class="nav prev" data-xst="pv-prev" aria-label="Previous file">‹</button>' : ''}${body}${many ? '<button type="button" class="nav next" data-xst="pv-next" aria-label="Next file">›</button>' : ''}</div></div>`;
  }
  // PDF and text: the bytes are fetched as the signed-in person and shown from memory. Text is put on the page as
  // text, never as markup, so a file cannot run anything here; a PDF is handed to the browser's own viewer.
  const isText = (i) => /^text\//.test(String(i.mime_type || '')) || /\.(txt|md|csv|json|log|xml|yml|yaml|js|ts|py|css|html|sql)$/i.test(String(i.name)) || ['application/json', 'application/xml'].includes(String(i.mime_type));
  const TEXT_LIMIT = 1024 * 1024;
  let docUrl = null;
  async function fillDoc() {
    const all = document.querySelectorAll('.xst-pv [data-xst-doc]'), host = all[all.length - 1]; if (!host || host.hasAttribute('data-done')) return; host.setAttribute('data-done', '');
    const fail = (why) => { host.innerHTML = `<div class="none"><b>This file could not be shown</b>${esc(why)}</div>`; };
    let r; try { r = await fetch(`/api/library/assets/${host.dataset.xstDoc}/content`, { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } }); } catch { return fail('XENO could not be reached.'); }
    if (r.status === 423) return fail('It is still being checked. Try again in a moment.');
    if (!r.ok) return fail('Download it to open it.');
    const blob = await r.blob(); if (!host.isConnected) return;
    if (host.dataset.kind === 'pdf') { if (docUrl) URL.revokeObjectURL(docUrl); docUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); host.innerHTML = '<embed type="application/pdf">'; host.firstChild.src = docUrl; return; }
    if (blob.size > TEXT_LIMIT) return fail('It is too large to show here. Download it to open it.');
    const pre = document.createElement('pre'); pre.textContent = await blob.text(); host.replaceChildren(pre);
  }
  const setView = (key) => { S.preview = key; if (!key && docUrl) { URL.revokeObjectURL(docUrl); docUrl = null; } try { const u = new URL(location.href); if (key) u.searchParams.set('view', key); else u.searchParams.delete('view'); history.replaceState(history.state, '', u); } catch {} paint(); };
  const step = (d) => { const n = S.items.findIndex((x) => keyOf(x) === S.preview); if (n < 0 || !S.items.length) return; setView(keyOf(S.items[(n + d + S.items.length) % S.items.length])); };
  const download = async (i) => { const r = await api('POST', `/api/library/assets/${i.asset_id}/link`, { download: true }); const url = r.ok && (r.d.url || r.d.link); if (!url) return say(whyNot(r, `“${i.name}” can’t be downloaded yet.`)); const a = document.createElement('a'); a.href = url; a.download = ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
  const shareBase = () => (S.sharing.folder ? `/api/library/folders/${S.sharing.id}/shares` : `/api/library/assets/file/${S.sharing.id}/shares`);
  const loadShares = async () => { const r = await api('GET', shareBase()); if (S.sharing) { S.sharing.shares = (r.ok && r.d.shares) || []; paint(); } };
  const pickedItems = () => S.items.filter((i) => S.sel.has(keyOf(i)));
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
      const body = new FormData(); if (S.scope) body.append('workspace', S.scope); body.append('image', file, file.name);
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
    if (edit.kind === 'new') return done(await api('POST', '/api/library/folders', { name, parent: at.id, ...(at.id ? {} : S.scope ? { workspace: S.scope } : {}) }), 'The folder wasn’t created.');
    if (edit.kind === 'folder') return done(await api('PATCH', `/api/library/folders/${edit.id}`, { name }), 'The folder wasn’t renamed.');
    return done(await api('PATCH', `/api/library/assets/${edit.source}/${edit.id}`, { name }), 'The file wasn’t renamed.');
  }
  // the page is redrawn with a short crossfade, so the field is looked for until it is the live one and holds the caret
  const focusName = (tries = 12) => setTimeout(() => { const all = document.querySelectorAll('.xst [data-xst-name]'), i = all[all.length - 1]; if (i && document.activeElement !== i) { i.focus(); const dot = i.value.lastIndexOf('.'); try { i.setSelectionRange(0, dot > 0 ? dot : i.value.length); } catch {} } if (tries > 0 && (!i || document.activeElement !== i || all.length > 1)) focusName(tries - 1); }, 60);

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#panel [data-xl-new="storage"]')) { e.preventDefault(); e.stopImmediatePropagation(); go(null); setTimeout(() => document.querySelector('.xst [data-xst-files]')?.click(), 250); return; }
    const b = e.target.closest('.xst [data-xst]');
    // a click on a folder opens it (its buttons and its name field are their own)
    if (!b) {
      const team = e.target.closest('.xst [data-xst-team]'); if (team) return go(`t/${team.dataset.xstTeam}`);
      const f = e.target.closest('.xst [data-xst-folder]'); if (f && !e.target.closest('input') && !editing('folder', f.dataset.xstFolder)) return go(`f/${f.dataset.xstFolder}`);
      const row = e.target.closest('.xst [data-xst-item]'); if (!row || e.target.closest('input')) return;
      const key = row.dataset.xstItem, order = S.items.map(keyOf);
      if (e.shiftKey && S.anchor && order.includes(S.anchor)) { const a = order.indexOf(S.anchor), z = order.indexOf(key); S.sel = new Set(order.slice(Math.min(a, z), Math.max(a, z) + 1)); }
      else if (e.ctrlKey || e.metaKey) { if (S.sel.has(key)) S.sel.delete(key); else S.sel.add(key); S.anchor = key; }
      else { S.sel = S.sel.size === 1 && S.sel.has(key) ? new Set() : new Set([key]); S.anchor = key; }
      return paint();
    }
    const act = b.dataset.xst, ref = refOf(b);
    if (act === 'retry') return reload();
    if (act === 'usage') return go('Usage');
    if (act === 'crumb') { const at = here(); if (at.kind !== 'folder') return; const id = b.dataset.id; return go(!id ? null : id.startsWith('v:') ? id.slice(2) : id.startsWith('t:') ? `t/${id.slice(2)}` : `f/${id}`); }
    if (act === 'new') { S.edit = { kind: 'new' }; paint(); return focusName(); }
    if (act === 'upload') return document.querySelector('.xst [data-xst-files]')?.click();
    if (act === 'movecancel') { S.moving = null; return paint(); }
    if (act === 'moveto') { const m = S.moving; S.moving = null; if (m.kind === 'many') { for (const i of m.items) await api('PUT', `/api/library/assets/${i.source}/${i.source_id}/folder`, { folder: b.dataset.id || null }); S.sel.clear(); return reload(); } return moveTo(m, b.dataset.id || null); }
    if (act === 'pv-close') return setView(null);
    if (act === 'pv-prev') return step(-1);
    if (act === 'pv-next') return step(1);
    if (act === 'pv-download') { const i = S.items.find((x) => keyOf(x) === S.preview); return i && download(i); }
    if (act === 'bulk-clear') { S.sel.clear(); return paint(); }
    if (act === 'bulk-open') { const i = pickedItems()[0]; return i && setView(keyOf(i)); }
    if (act === 'bulk-move') { const all = await api('GET', `/api/library/folders?all=true${S.scope ? `&workspace=${S.scope}` : ''}`); S.all = (all.d && all.d.folders) || []; const items = pickedItems(); S.moving = { kind: 'many', items, name: `${items.length} ${items.length === 1 ? 'file' : 'files'}` }; return paint(); }
    if (act.startsWith('bulk-')) {
      const items = pickedItems(), verb = act.slice(5); let failed = 0;
      if (verb === 'download') { for (const i of items) if (i.asset_id) await download(i); return; }
      for (const i of items) { const base = `/api/library/assets/${i.source}/${i.source_id}`; const res = verb === 'star' ? await api('PUT', `${base}/star`) : verb === 'trash' ? await api('POST', `${base}/trash`) : await api('POST', `${base}/restore`); if (!res.ok) failed += 1; }
      S.sel.clear(); say(failed ? `${failed} of ${items.length} could not be changed.` : `${items.length} ${items.length === 1 ? 'file' : 'files'} ${verb === 'star' ? 'starred' : verb === 'trash' ? 'moved to the trash' : 'restored'}`); return reload();
    }
    if (act === 'ver-close') { S.versions = null; return reload(); }
    if (act === 'ver-upload') return document.querySelector('.xst [data-xst-verfile]')?.click();
    if (act === 'ver-get') return download({ asset_id: b.dataset.id, name: S.versions.name });
    if (act === 'ver-restore') { const res = await api('POST', `/api/library/assets/file/${S.versions.id}/versions/${b.dataset.id}/restore`); if (!res.ok) return say(whyNot(res, 'It was not restored.')); S.versions.id = res.d.file.id; say('Restored as the newest version'); return loadVersions(); }
    if (act === 'share-close') { S.sharing = null; await reload(); return; }
    if (act === 'share-person') { const who = document.querySelector('.xst [data-xst-who]')?.value.trim(); if (!who) return; const res = await api('POST', shareBase(), { with: who, role: document.querySelector('.xst [data-xst-role]')?.value || 'viewer' }); if (!res.ok) return say(whyNot(res, 'It was not shared.')); say(`Shared with ${res.d.share.person.name || res.d.share.person.username}`); return loadShares(); }
    if (act === 'share-link') { const days = document.querySelector('.xst [data-xst-days]')?.value; const res = await api('POST', `/api/library/assets/file/${S.sharing.id}/shares`, { link: true, ...(days ? { expiresInDays: Number(days) } : {}) }); if (!res.ok) return say(whyNot(res, 'The link was not created.')); S.sharing.url = res.d.url; return loadShares(); }
    if (act === 'share-copy') { try { await navigator.clipboard.writeText(S.sharing.url); say('Link copied'); } catch { say('Copy it from the page.'); } return; }
    if (act === 'share-off') { const res = await api('DELETE', `/api/library/shares/${b.dataset.id}`); if (!res.ok) say(whyNot(res, 'It was not removed.')); return loadShares(); }
    if (!ref || !ref.row) return;
    if (act === 'share') { S.sharing = { id: ref.id, name: ref.row.name, shares: [], url: '', folder: ref.kind === 'folder' }; paint(); return loadShares(); }
    if (act === 'versions') { S.versions = { id: ref.id, name: ref.row.name, list: [] }; paint(); return loadVersions(); }
    if (act === 'rename') { S.edit = ref.kind === 'folder' ? { kind: 'folder', id: ref.id } : { kind: 'item', id: ref.id, source: ref.source }; paint(); return focusName(); }
    if (act === 'move') { const all = await api('GET', `/api/library/folders?all=true${S.scope ? `&workspace=${S.scope}` : ''}`); S.all = (all.d && all.d.folders) || []; S.moving = { ...ref, name: ref.row.name }; return paint(); }
    if (act === 'remove') return done(await api('DELETE', `/api/library/folders/${ref.id}`), 'The folder wasn’t deleted.');
    const base = `/api/library/assets/${ref.source}/${ref.id}`;
    if (act === 'star') return done(await api(ref.row.starred ? 'DELETE' : 'PUT', `${base}/star`), 'That didn’t work.');
    if (act === 'trash') { const r = await api('POST', `${base}/trash`); if (r.ok) say(`“${ref.row.name}” moved to the trash`); return done(r, 'The file wasn’t moved to the trash.'); }
    if (act === 'restore') return done(await api('POST', `${base}/restore`), 'The file wasn’t restored.');
    if (act === 'purge') { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; } return done(await api('DELETE', `/api/library/trash/${ref.source}/${ref.id}`), 'The file wasn’t deleted.'); }
    if (act === 'download') return download(ref.row);
  }, true);
  document.addEventListener('dblclick', (e) => { if (e.target.closest('.xst .acts, .xst input')) return; const i = e.target.closest('.xst [data-xst-item]'); if (i && here().kind !== 'trash') setView(i.dataset.xstItem); });
  document.addEventListener('keydown', (e) => {
    const name = e.target.closest?.('.xst [data-xst-name]'); if (name) { if (e.key === 'Enter') { e.preventDefault(); commitName(name); } else if (e.key === 'Escape') { S.edit = null; paint(); } return; }
    const find = e.target.closest?.('.xst [data-xst-find]'); if (find && e.key === 'Enter') { S.q = find.value.trim(); paint(); return; }
    const row = e.target.closest?.('.xst .xst-r'); if (row && e.key === 'Enter' && row.dataset.xstFolder) return go(`f/${row.dataset.xstFolder}`);
    if (row && e.key === 'Enter' && row.dataset.xstItem && here().kind !== 'trash') return setView(row.dataset.xstItem);
    if (!document.querySelector('.xst') || e.target.closest?.('input, textarea, select')) return;
    if (S.preview) { if (e.key === 'Escape') { e.preventDefault(); setView(null); } else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); return; }
    if (e.key === 'Escape' && S.sel.size) { S.sel.clear(); paint(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && S.items.length && here().kind !== 'usage') { e.preventDefault(); S.sel = new Set(S.items.map(keyOf)); paint(); }
  });
  document.addEventListener('focusout', (e) => { const name = e.target.closest?.('.xst [data-xst-name]'); if (name && S.edit && name.isConnected && name.value.trim()) commitName(name); });
  document.addEventListener('input', (e) => { const find = e.target.closest?.('.xst [data-xst-find]'); if (find && !find.value && S.q) { S.q = ''; paint(); } });
  document.addEventListener('change', async (e) => {
    const input = e.target.closest?.('.xst [data-xst-verfile]'); if (!input || !input.files.length || !S.versions) return;
    const file = input.files[0]; input.value = ''; const body = new FormData(); body.append('image', file, file.name);
    const headers = { 'x-xeno-surface': 'xeno-web' }; const t = P.csrf?.(); if (t) headers['x-xeno-csrf'] = t;
    let r, d = null; try { r = await fetch(`/api/library/assets/file/${S.versions.id}/versions`, { method: 'POST', credentials: 'same-origin', headers, body }); d = await r.json().catch(() => null); } catch { return say('XENO could not be reached.'); }
    if (!r.ok || !d || d.success === false) return say(`The new version wasn’t added: ${(d && d.error) || 'XENO refused it'}.`);
    S.versions.id = d.file.id; say('New version added. It is being checked and will open in a moment.'); loadVersions();
  });
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
  document.addEventListener('dragenter', (e) => { if (held && target(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    const list = e.target.closest?.('.xst [data-xst-list]');
    if (!held && list && e.dataTransfer?.files?.length && here().kind === 'folder') { e.preventDefault(); list.removeAttribute('data-drop'); return void upload([...e.dataTransfer.files]); }
    const t = held && target(e); if (!t) return; e.preventDefault(); const ref = held; held = null;
    moveTo(ref, t.dataset.xstFolder || t.dataset.id || null);
  });
  // the Library shows the same store: its header carries the account's storage and a way here
  let chipAsked = false;
  const chip = () => {
    if (!P || !P.served) return '';
    if (!S.meter && !chipAsked) { chipAsked = true; api('GET', '/api/library/storage').then((r) => { if (r.ok && r.d.storage) { S.meter = r.d.storage; paint(); } }); }
    const m = S.meter; if (!m) return '';
    return `Storage · ${size(m.usedBytes)}${m.allowanceBytes === null ? ' used' : ` of ${size(m.allowanceBytes)}`}`;   // plain text: the Library draws it as one of its own buttons
  };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-xst-open]')) { e.preventDefault(); if (window.XW?.go) window.XW.go('product', { product: 'storage', item: null }); /* in the current area — Overview stays Overview */ else if (window.XENO_ADDR?.go) window.XENO_ADDR.go('#/corpo/p/storage'); else window.location.assign('/workspace/corpo/apps/storage'); } });
  /** The workspace top bar for Storage: the usage meter beside the path (left), search · New folder · Upload (right). */
  const top = () => ({ left: S.top ? S.top.meter : '', right: S.top ? `<div class="xst xst-tb">${S.top.tools}</div>` : '' });
  window.XENO_STORAGE = { chip, page, reload, top, state: () => ({ status: S.status, meter: S.meter, folders: S.folders.length, items: S.items.length }) };
})();
