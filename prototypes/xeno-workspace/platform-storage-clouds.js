/* XENO_STORAGE_CLOUDS — Connected clouds in the website Storage: Google Drive through XENO Connect.
 *
 *   accounts   /workspace/corpo/apps/storage/connections
 *   a folder   …/storage/connections/<connectionId>[/folders/<driveFolderId>]
 *   a file     …/storage/connections/<connectionId>[/folders/<driveFolderId>]/items/drive/<fileId>
 *   (the same addresses as XENO Storage desktop; ids only, so a rename never breaks a link)
 *
 * Every call goes to /api/storage/connect/workspaces/<ws>/… on the platform (routes/webConnectRoutes.js), which holds
 * the Connect token server-side. This page never sees a Google token or a Connect token. The workspace is named on
 * every call: the one in ?ws=, else the person's personal workspace, read from /api/workspaces — never guessed.
 * Linking opens Connect's one-use start address in a new tab; Connect finishes on /account/connected. */
(() => {
  const P = window.XENO_PLATFORM;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ID = /^[A-Za-z0-9_-]{1,256}$/;
  const FOLDER = 'application/vnd.google-apps.folder';
  const PART = 8 * 1024 * 1024;
  const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const opId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const MESSAGES = {
    FORBIDDEN: 'XENO Connect refused this for your account in this workspace.', NOT_FOUND: 'That item no longer exists or is not shared with you.',
    CONFLICT: 'The item changed. Refresh before trying again.', RECONNECT_REQUIRED: 'This Google account needs to be reconnected.',
    EXPIRED: 'That request expired. Start again.', INVALID_INPUT: 'XENO Connect could not accept that request.',
    RATE_LIMITED: 'Google is limiting requests. Wait a moment and try again.', UNCERTAIN: 'The outcome is unknown. Check the item before repeating the change.',
    UNAVAILABLE: 'XENO Connect is unavailable right now.', connect_not_configured: 'Connected clouds are not set up on this server yet.',
    website_session_required: 'Sign in again to use connected clouds.', not_a_member: 'You are not a member of this workspace.',
  };
  const S = { key: null, ws: null, status: 'idle', conns: [], apps: [], files: [], folder: null, file: null, quota: null, note: '', undo: null, edit: null, moving: null, link: null, busy: 0, progress: null };

  /** connections · connections/<c> · …/folders/<f> · …/items/drive/<id> */
  function route() {
    const it = String(X()?.S?.item || ''); const p = it.split('/').filter(Boolean);
    if (!/^connections$/i.test(p[0] || '')) return null;
    const r = { connectionId: null, folderId: null, fileId: null }; let i = 1;
    if (p[i] && !['folders', 'items'].includes(p[i]) && ID.test(p[i])) r.connectionId = p[i++];
    if (p[i] === 'folders' && ID.test(p[i + 1] || '')) { r.folderId = p[i + 1]; i += 2; }
    if (p[i] === 'items' && p[i + 1] === 'drive' && ID.test(p[i + 2] || '')) r.fileId = p[i + 2];
    return r;
  }
  const pathOf = (r) => ['connections', r.connectionId, r.folderId && `folders/${r.folderId}`, r.fileId && `items/drive/${r.fileId}`].filter(Boolean).join('/');
  const go = (r) => X()?.go?.('product', { product: 'storage', item: pathOf(r) });
  const paint = () => { try { X()?.render?.(); } catch {} };
  const say = (text, undo = null) => { S.note = text; S.undo = undo; paint(); clearTimeout(say.t); say.t = setTimeout(() => { S.note = ''; S.undo = null; paint(); }, undo ? 10000 : 5000); };
  const why = (r) => MESSAGES[r?.d?.error?.code] || MESSAGES.UNAVAILABLE;

  async function workspace() {
    const fromUrl = new URLSearchParams(location.search).get('ws');
    if (fromUrl && /^[0-9a-f-]{36}$/i.test(fromUrl)) return fromUrl.toLowerCase();
    if (S.ws) return S.ws;
    const r = await P.api('GET', '/api/workspaces').catch(() => null);
    const mine = ((r && r.ok && r.d.workspaces) || []).find((w) => w.workspace_type === 'personal');
    return mine ? (S.ws = mine.id) : null;
  }
  const base = () => `/api/storage/connect/workspaces/${S.wsNow}`;
  const call = (method, path, body, key) => P.api(method, `${base()}/${path}`, body, key ? { 'idempotency-key': key } : undefined).catch(() => ({ ok: false, status: 0, d: {} }));
  const op = (c, name, body, key) => call('POST', `connections/${c}/operations/${name}`, body || {}, key);

  async function load() {
    const r = route(); if (!r) return;
    const key = pathOf(r); S.key = key; S.status = 'loading';
    S.wsNow = await workspace();
    if (!S.wsNow) { S.status = 'noworkspace'; return paint(); }
    if (!r.connectionId) {
      const [c, a] = await Promise.all([call('GET', 'connections'), call('GET', 'providers')]);
      if (S.key !== key) return;
      if (!c.ok) { S.status = 'error'; S.error = why(c); return paint(); }
      S.conns = Array.isArray(c.d) ? c.d : [];
      S.apps = ((a.ok && a.d.providers) || []).find((p) => p.id === 'google')?.apps || [];
      S.status = 'ready'; return paint();
    }
    if (!S.conns.length) { const c = await call('GET', 'connections'); if (c.ok && Array.isArray(c.d)) S.conns = c.d; }
    const folderId = r.folderId || 'root';
    const tasks = [op(r.connectionId, 'drive.files.list', { parentId: folderId }), op(r.connectionId, 'drive.files.stat', { fileId: folderId }), op(r.connectionId, 'drive.quota.read')];
    if (r.fileId) tasks.push(op(r.connectionId, 'drive.files.stat', { fileId: r.fileId }));
    const [l, f, q, file] = await Promise.all(tasks);
    if (S.key !== key) return;
    if (!l.ok) { S.status = l.status === 404 ? 'missing' : 'error'; S.error = why(l); return paint(); }
    S.files = (l.d.files || []).filter((x) => !x.trashed).sort((a, b) => (a.mimeType === FOLDER) === (b.mimeType === FOLDER) ? a.name.localeCompare(b.name) : a.mimeType === FOLDER ? -1 : 1);
    S.folder = f.ok ? f.d : null; S.quota = q.ok ? q.d : null;
    S.file = r.fileId ? (file && file.ok ? file.d : null) : null;
    if (r.fileId && !S.file) { S.status = 'missing'; return paint(); }
    S.status = 'ready'; paint();
  }
  const reload = () => { S.key = null; return load(); };

  // ── linking: Connect's one-use start address in a new tab; this tab polls the link until it ends ──────────────
  async function connect(appId) {
    const tab = window.open('about:blank', '_blank');   // opened in the click itself, so no popup blocker stops it
    const r = await call('POST', 'link/sessions', { providerAppId: appId });
    if (!r.ok || !r.d.startUrl) { try { tab?.close(); } catch {} return say(`Google Drive could not be connected: ${why(r)}`); }
    if (tab) { try { tab.opener = null; } catch {} tab.location.href = r.d.startUrl; } else location.assign(r.d.startUrl);
    S.link = { id: r.d.id, until: Date.now() + 10 * 60000 }; paint(); poll();
  }
  async function poll() {
    const link = S.link; if (!link) return;
    if (Date.now() > link.until) { S.link = null; return say('The sign-in with Google took too long. Start again.'); }
    const r = await call('GET', `link/sessions/${link.id}`);
    if (S.link !== link) return;
    const st = r.ok ? r.d.status : null;
    if (st === 'completed' && r.d.connectionId) { S.link = null; say('Google Drive is connected.'); S.conns = []; return go({ connectionId: r.d.connectionId }); }
    if (['failed', 'expired', 'cancelled'].includes(st)) { S.link = null; return say(st === 'cancelled' ? 'Google Drive was not connected.' : r.d.reason === 'scope_not_granted' ? 'Google Drive was not ticked on Google’s consent screen, so nothing was connected.' : 'Google Drive could not be connected. Start again.'); }
    setTimeout(poll, 2000);
  }
  async function cancelLink() { const l = S.link; S.link = null; paint(); if (l) await call('POST', `link/sessions/${l.id}/cancel`, {}); }

  // ── file actions ────────────────────────────────────────────────────────────────────────────────────────────
  const r0 = () => route();
  async function change(promise, ok, after) {
    S.busy += 1; paint(); const r = await promise; S.busy -= 1;
    if (!r.ok) return say(`${ok.fail}: ${why(r)}`);
    if (after) after(r); say(ok.done, ok.undo || null); reload();
  }
  async function download(file) {
    const r = r0(); const total = Number(file.size || 0); const parts = []; let offset = 0;
    S.progress = `Downloading “${file.name}”`; paint();
    try {
      while (offset < total) {
        const end = Math.min(total - 1, offset + PART - 1);
        const res = await fetch(`${base()}/connections/${r.connectionId}/content?${new URLSearchParams({ fileId: file.id, start: String(offset), end: String(end) })}`, { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } });
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
        if (res.status !== 206 || !m || Number(m[1]) !== offset || Number(m[3]) !== total) throw new Error('range');
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength !== Number(m[2]) - Number(m[1]) + 1) throw new Error('short');
        parts.push(bytes); offset += bytes.byteLength;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type: file.mimeType || 'application/octet-stream' })); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      S.progress = null; say(`Downloaded “${file.name}”.`);
    } catch { S.progress = null; say(`“${file.name}” could not be downloaded. Try again.`); }
  }
  async function upload(files) {
    const r = r0(); if (!r?.connectionId) return;
    const parentId = r.folderId || 'root';
    for (const file of files) {
      const key = opId();
      S.progress = `Uploading “${file.name}”`; paint();
      let st = await call('POST', `connections/${r.connectionId}/uploads`, { name: file.name, parentId, mimeType: file.type || 'application/octet-stream', totalBytes: file.size }, key);
      try {
        while (st.ok && st.d.status === 'uploading') {
          const at = Number(st.d.acknowledgedBytes || 0);
          if (at >= file.size) { st = await call('POST', `connections/${r.connectionId}/uploads/${st.d.id}/finish`, {}); break; }
          const bytes = await file.slice(at, Math.min(file.size, at + PART)).arrayBuffer();
          const headers = { 'x-xeno-surface': 'xeno-web', 'content-type': 'application/octet-stream' }; const t = P.csrf?.(); if (t) headers['x-xeno-csrf'] = t;
          const res = await fetch(`${base()}/connections/${r.connectionId}/uploads/${st.d.id}/parts?offset=${at}`, { method: 'PUT', credentials: 'same-origin', headers, body: bytes });
          const d = await res.json().catch(() => ({}));
          st = { ok: res.ok, status: res.status, d };
          S.progress = `Uploading “${file.name}” · ${Math.round((Number(d.acknowledgedBytes || file.size) / Math.max(1, file.size)) * 100)}%`; paint();
        }
      } catch { st = { ok: false, d: {} }; }
      S.progress = null;
      if (!st.ok || st.d.status !== 'completed') { say(st.d?.status === 'uncertain' ? `The upload of “${file.name}” has an unknown outcome. Check Google Drive before trying again.` : `“${file.name}” was not uploaded: ${why(st)}`); break; }
      say(`Uploaded “${file.name}”.`);
    }
    reload();
  }
  const parentOf = (f) => (f?.parents || [])[0] || null;
  const isRoot = (id) => !id || id === 'root' || id === S.rootId;

  // ── render ──────────────────────────────────────────────────────────────────────────────────────────────────
  const style = () => {
    if (document.getElementById('xsc-css')) return; const s = document.createElement('style'); s.id = 'xsc-css';
    s.textContent = '.xsc-card{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px;border-top:1px solid var(--border);font-size:13.5px}.xsc-card:first-child{border-top:0}.xsc-card small{display:block;color:var(--muted);font-size:12.5px}.xsc-card .ic{width:32px;height:32px;border-radius:8px;background:var(--control);display:grid;place-items:center;font-size:10px;font-weight:600;color:var(--muted)}'
      + '.xsc-card button.nm{border:0;background:none;color:var(--text);font:inherit;text-align:left;padding:0;cursor:pointer}.xsc-card button.nm:hover{text-decoration:underline}.xsc-detail{margin-top:14px;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}.xsc-detail h3{margin:0 0 6px;font-size:16px;font-weight:500}.xsc-detail p{margin:0 0 14px;color:var(--muted);font-size:13px}.xsc-detail .line{display:flex;flex-wrap:wrap;gap:8px}';
    document.head.appendChild(s);
  };
  const tagOf = (f) => (f.mimeType === FOLDER ? 'DIR' : ((String(f.name).match(/\.([a-z0-9]{1,4})$/i) || [])[1] || 'FILE').toUpperCase());

  function page() {
    style();
    const r = route(); if (!r) return '';
    if (S.key !== pathOf(r)) { S.key = pathOf(r); S.status = 'loading'; S.edit = null; S.moving = null; setTimeout(load, 0); }
    if (!P || !P.served) return '<div class="xst"><div class="xst-list"><div class="xst-empty"><b>Connected clouds are read from the platform</b>Open the workspace on xenosystem.ai.</div></div></div>';
    const conn = S.conns.find((c) => c.id === r.connectionId);
    if (!r.folderId && S.folder?.id) S.rootId = S.folder.id;
    const crumbs = [{ r: {}, name: 'Connected clouds' }];
    if (r.connectionId) crumbs.push({ r: { connectionId: r.connectionId }, name: conn ? conn.displayName : 'Google Drive' });
    if (r.folderId) crumbs.push({ r: { connectionId: r.connectionId, folderId: r.folderId }, name: S.folder?.name || 'Folder' });
    if (r.fileId) crumbs.push({ r: { ...r }, name: S.file?.name || 'File' });
    const path = crumbs.map((c, i) => `${i ? '<i>/</i>' : ''}<button type="button" data-xsc="crumb" data-to="${esc(pathOf(c.r))}">${esc(c.name)}</button>`).join('');
    const note = S.note ? `<div class="xst-note" role="status">${esc(S.note)}${S.undo ? ' <button type="button" class="xst-btn" data-xsc="undo">Undo</button>' : ''}</div>` : '';
    const progress = S.progress ? `<div class="xst-note" role="status" data-xsc-progress>${esc(S.progress)}</div>` : '';
    const link = S.link ? '<div class="xst-note" role="status">Finish signing in with Google in the new tab. This page updates when it is done. <button type="button" class="xst-btn" data-xsc="link-cancel">Cancel</button></div>' : '';
    let body;
    if (S.status === 'loading') body = '<div class="xst-list"><div class="xst-empty" role="status">Loading</div></div>';
    else if (S.status === 'noworkspace') body = '<div class="xst-list"><div class="xst-empty"><b>No workspace to connect in</b>Pick a workspace and try again.</div></div>';
    else if (S.status === 'missing') body = `<div class="xst-list"><div class="xst-empty"><b>This item is gone</b>It may have been moved, trashed or unshared. <button type="button" class="xst-btn" data-xsc="crumb" data-to="${esc(pathOf({ connectionId: r.connectionId }))}">Back to Google Drive</button></div></div>`;
    else if (S.status === 'error') body = `<div class="xst-list"><div class="xst-empty"><b>Connected clouds could not be read just now</b>${esc(S.error || '')} <button type="button" class="xst-btn" data-xsc="retry">Try again</button></div></div>`;
    else if (!r.connectionId) {
      const app = S.apps.find((a) => a.id === 'google-xeno') || S.apps[0] || { id: 'google-xeno' };
      body = `<div class="xst-list" data-xsc-accounts>${S.conns.length ? S.conns.map((c) => `<div class="xsc-card" data-xsc-conn="${esc(c.id)}"><span class="ic">G</span><span><button type="button" class="nm" data-xsc="open-conn">${esc(c.displayName || 'Google Drive')}</button><small>Google Drive · ${c.status === 'active' ? 'connected' : esc(c.status)}</small></span><span><button type="button" class="xst-btn" data-xsc="disconnect">Disconnect</button></span></div>`).join('')
        : '<div class="xst-empty"><b>No cloud accounts connected</b>Connect Google Drive to browse and change its files here. XENO never sees your Google password, and you can disconnect at any time.</div>'}</div>
        <div style="margin-top:12px"><button type="button" class="xst-btn xst-go" data-xsc="connect" data-app="${esc(app.id)}"${S.link ? ' disabled' : ''}>Connect Google Drive</button></div>`;
    } else if (r.fileId && S.file) {
      const f = S.file;
      body = `<div class="xsc-detail" data-xsc-file="${esc(f.id)}"><h3>${S.edit === f.id ? `<input data-xsc-name value="${esc(f.name)}" aria-label="New name" class="xst-find" style="width:100%">` : esc(f.name)}</h3><p>${esc(f.mimeType)}${f.size ? ` · ${esc(size(f.size))}` : ''}${f.modifiedTime ? ` · changed ${esc(new Date(f.modifiedTime).toLocaleString())}` : ''}</p>
        <div class="line">${f.mimeType !== FOLDER && f.capabilities?.canDownload !== false && f.size ? '<button type="button" class="xst-btn xst-go" data-xsc="download">Download</button>' : ''}${f.capabilities?.canEdit !== false ? '<button type="button" class="xst-btn" data-xsc="rename">Rename</button><button type="button" class="xst-btn" data-xsc="move">Move</button>' : ''}${f.capabilities?.canTrash !== false ? '<button type="button" class="xst-btn" data-xsc="trash">Move to trash</button>' : ''}<button type="button" class="xst-btn" data-xsc="crumb" data-to="${esc(pathOf({ connectionId: r.connectionId, folderId: r.folderId }))}">Close</button></div></div>`;
    } else {
      const rows = S.files.map((f) => `<div class="xst-r" data-xsc-item="${esc(f.id)}" tabindex="0"><span class="ic${f.mimeType === FOLDER ? ' fd' : ''}">${esc(tagOf(f))}</span>${S.edit === f.id ? `<input data-xsc-name value="${esc(f.name)}" aria-label="New name">` : `<span class="nm" title="${esc(f.name)}">${esc(f.name)}</span>`}<small>${f.modifiedTime ? esc(new Date(f.modifiedTime).toLocaleDateString()) : ''}</small><small>${f.size ? esc(size(f.size)) : ''}</small><span class="acts">${f.mimeType !== FOLDER && f.size ? '<button type="button" data-xsc="download">Download</button>' : ''}<button type="button" data-xsc="rename">Rename</button><button type="button" data-xsc="move">Move</button><button type="button" data-xsc="trash">Trash</button></span></div>`).join('');
      body = `<div class="xst-list" data-xsc-list><div class="xst-hd"><span></span><span>Name</span><span>Changed</span><span>Size</span><span></span></div>${rows || '<div class="xst-empty"><b>This folder is empty</b>Upload a file or make a folder.</div>'}</div>`;
    }
    const mover = S.moving ? `<div class="xst-move"><p>Move “${esc(S.moving.name)}” to</p><div>${!isRoot(r.folderId) ? `<button type="button" class="xst-btn" data-xsc="moveto" data-id="${esc(parentOf(S.folder) || 'root')}">Up one level</button>` : ''}${S.files.filter((f) => f.mimeType === FOLDER && f.id !== S.moving.id).map((f) => `<button type="button" class="xst-btn" data-xsc="moveto" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')}<button type="button" class="xst-btn" data-xsc="movecancel">Cancel</button></div></div>` : '';
    const q = S.quota && S.quota.usage ? `${size(S.quota.usage)}${S.quota.limit ? ` of ${size(S.quota.limit)}` : ''} used in Google Drive` : '';
    S.top = { meter: r.connectionId && q ? `<span class="xst-mini" data-xsc-quota>${esc(q)}</span>` : '',
      tools: r.connectionId && !r.fileId && S.status === 'ready' ? '<button type="button" class="xst-btn" data-xsc="new">New folder</button><button type="button" class="xst-btn xst-go" data-xsc="upload">Upload</button><input type="file" multiple hidden data-xsc-files>' : '' };
    return `<div class="xst" data-xsc-page><div class="xst-top"><div class="xst-path">${path}</div></div>${link}${note}${progress}${mover}${body}</div>`;
  }
  const top = () => ({ left: S.top ? S.top.meter : '', right: S.top ? `<div class="xst xst-tb">${S.top.tools}</div>` : '' });

  const target = (el) => { const row = el.closest('[data-xsc-item]'); const id = row?.dataset.xscItem || el.closest('[data-xsc-file]')?.dataset.xscFile; return id ? (S.files.find((f) => f.id === id) || (S.file?.id === id ? S.file : null)) : null; };
  async function commitRename(input) {
    const id = S.edit; S.edit = null; const r = route(); const name = input.value.trim(); const f = S.files.find((x) => x.id === id) || S.file;
    if (!f || !name || name === f.name) return paint();
    change(op(r.connectionId, 'drive.files.rename', { fileId: id, name }, opId()), { done: `Renamed to “${name}”.`, fail: 'It wasn’t renamed' });
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-xsc-page] [data-xsc], .xst-tb [data-xsc]'); const r = route();
    if (!b) { const row = e.target.closest?.('[data-xsc-page] .xst-r[data-xsc-item]'); if (row && r && !e.target.closest('.acts') && !e.target.closest('input')) { const f = S.files.find((x) => x.id === row.dataset.xscItem); if (f) go(f.mimeType === FOLDER ? { connectionId: r.connectionId, folderId: f.id } : { ...r, fileId: f.id }); } return; }
    const act = b.dataset.xsc; const f = target(b);
    if (act === 'crumb') return X()?.go?.('product', { product: 'storage', item: b.dataset.to });
    if (act === 'retry') return reload();
    if (act === 'connect') return connect(b.dataset.app || 'google-xeno');
    if (act === 'link-cancel') return cancelLink();
    if (act === 'open-conn') return go({ connectionId: b.closest('[data-xsc-conn]').dataset.xscConn });
    if (act === 'disconnect') {
      const id = b.closest('[data-xsc-conn]').dataset.xscConn; const c = S.conns.find((x) => x.id === id);
      if (!confirm(`Disconnect ${c?.displayName || 'this Google account'}? XENO loses access to its Drive. Nothing in Drive is deleted.`)) return;
      return change(call('POST', `connections/${id}/revoke`, {}), { done: 'Disconnected.', fail: 'It wasn’t disconnected' }, () => { S.conns = S.conns.filter((x) => x.id !== id); });
    }
    if (act === 'upload') return document.querySelector('[data-xsc-files]')?.click();
    if (act === 'new') {
      const name = (prompt('New folder name') || '').trim(); if (!name) return;
      return change(op(r.connectionId, 'drive.files.create', { name, parentId: r.folderId || 'root' }, opId()), { done: `Made “${name}”.`, fail: 'The folder wasn’t made' });
    }
    if (!f) return;
    if (act === 'download') return download(f);
    if (act === 'rename') { S.edit = f.id; paint(); setTimeout(() => { const i = document.querySelector('[data-xsc-name]'); i?.focus(); i?.select(); }, 30); return; }
    if (act === 'move') { S.moving = { id: f.id, name: f.name, from: parentOf(f) || r.folderId || 'root' }; return paint(); }
    if (act === 'trash') {
      const undo = { id: f.id, name: f.name, connectionId: r.connectionId };
      return change(op(r.connectionId, 'drive.files.trash', { fileId: f.id }, opId()), { done: `Moved “${f.name}” to the trash.`, fail: 'It wasn’t moved to the trash', undo }, () => { if (r.fileId) go({ connectionId: r.connectionId, folderId: r.folderId }); });
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-xsc-page] [data-xsc="undo"], [data-xsc-page] [data-xsc="moveto"], [data-xsc-page] [data-xsc="movecancel"]'); if (!b) return;
    const act = b.dataset.xsc; const r = route();
    if (act === 'undo' && S.undo) { const u = S.undo; S.undo = null; return change(op(u.connectionId, 'drive.files.restore', { fileId: u.id }, opId()), { done: `Restored “${u.name}”.`, fail: 'It wasn’t restored' }); }
    if (act === 'movecancel') { S.moving = null; return paint(); }
    if (act === 'moveto' && S.moving) { const m = S.moving; S.moving = null; return change(op(r.connectionId, 'drive.files.move', { fileId: m.id, addParentId: b.dataset.id, removeParentId: m.from }, opId()), { done: `Moved “${m.name}”.`, fail: 'It wasn’t moved' }); }
  });
  document.addEventListener('keydown', (e) => { const i = e.target.closest?.('[data-xsc-name]'); if (!i) return; if (e.key === 'Enter') { e.preventDefault(); commitRename(i); } if (e.key === 'Escape') { S.edit = null; paint(); } });
  document.addEventListener('change', (e) => { const input = e.target.closest?.('[data-xsc-files]'); if (input && input.files.length) { const files = [...input.files]; input.value = ''; upload(files); } });

  window.XENO_STORAGE_CLOUDS = { route, page, top, reload, state: () => ({ status: S.status, conns: S.conns.length, files: S.files.length, ws: S.wsNow }) };
})();
