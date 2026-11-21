/* XENO_STORAGE_UPLOADS — the upload engine and panel for XENO Storage (platform-storage.js calls it).
 *
 * Measured 2026-11-21: the page sent each file as one POST to /api/upload. Cloudflare refuses a body above 100 MB, so
 * nothing larger could ever arrive, and fetch() reports no upload progress, so a 50 MB file showed "Uploading" for a
 * minute with nothing else. This is the Drive / Dropbox / Box shape instead:
 *   - every file goes through an upload session (POST /api/library/uploads): its parts are sent straight to object
 *     storage (the objects host) or, where there is none, to the platform; 16 MB parts, three at a time per file and two
 *     files at a time, each part retried three times;
 *   - a panel that stays on screen across the app: one row per file with its progress, the bytes sent of its size, its
 *     speed and the time left, then "Checking" while the platform scans it, then done; cancel, retry and clear;
 *   - folders keep their structure (a dropped folder, or "Upload folder"), merging into a same-named folder;
 *   - an upload survives a reload: add the same file again and it continues from the parts that already arrived;
 *   - closing the tab while something uploads asks first.
 * The panel draws itself (it is not part of the page's crossfade redraw), so progress never repaints the page. */
(() => {
  const P = window.XENO_PLATFORM;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const left = (s) => (!Number.isFinite(s) || s <= 0 ? '' : s < 60 ? `${Math.ceil(s)} s left` : s < 3600 ? `${Math.ceil(s / 60)} min left` : `${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min left`);
  const PARTS_AT_ONCE = 3, FILES_AT_ONCE = 2, TRIES = 3;
  const RESUME_KEY = 'xeno.storage.uploads.v1';
  const jobs = [];                 // { id, file, name, size, folder, workspace, state, sent, error, session, xhrs, rate }
  let seq = 0, onDone = () => {}, open = true;

  // ── resume across reloads: the session id for a file seen before (name, size, last modified) ──
  const fingerprint = (f) => `${f.name}|${f.size}|${f.lastModified}`;
  const resumeMap = () => { try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); } catch { return {}; } };
  const remember = (f, sessionId) => { try { const m = resumeMap(); if (sessionId) m[fingerprint(f)] = { id: sessionId, at: Date.now() }; else delete m[fingerprint(f)]; for (const [k, v] of Object.entries(m)) if (Date.now() - v.at > 2 * 86400000) delete m[k]; localStorage.setItem(RESUME_KEY, JSON.stringify(m)); } catch {} };

  const api = (m, u, b) => (P && P.api ? P.api(m, u, b).catch(() => ({ ok: false, status: 0, d: {} })) : Promise.resolve({ ok: false, status: 0, d: {} }));
  const sameOriginHeaders = () => { const h = { 'x-xeno-surface': 'xeno-web' }; const t = P?.csrf?.(); if (t) h['x-xeno-csrf'] = t; const a = P?.area?.(); if (a) h['x-xeno-area'] = a; return h; };

  /** PUT one part with progress. Resolves on 2xx; rejects with { status, retry } otherwise. */
  function sendPart(job, transport, n, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = transport.partUrl.replace('{n}', String(n));
      xhr.open('PUT', url);
      if (transport.kind === 'platform') { xhr.withCredentials = true; for (const [k, v] of Object.entries(sameOriginHeaders())) xhr.setRequestHeader(k, v); }
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = () => { job.xhrs.delete(xhr); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject({ status: xhr.status, retry: xhr.status >= 500 || xhr.status === 429 || xhr.status === 0 }); };
      xhr.onerror = () => { job.xhrs.delete(xhr); reject({ status: 0, retry: true }); };
      xhr.onabort = () => { job.xhrs.delete(xhr); reject({ status: -1, retry: false, aborted: true }); };
      job.xhrs.add(xhr);
      xhr.send(blob);
    });
  }

  const reason = (r, fallback) => (r && r.d && (r.d.error || r.d.message)) || fallback;

  async function run(job) {
    job.state = 'uploading'; job.started = performance.now(); job.sent = 0; job.error = ''; draw();
    // 1) a session: the one this file had before a reload, if it is still open, or a new one
    let session = null;
    const prev = resumeMap()[fingerprint(job.file)];
    if (prev) { const r = await api('GET', `/api/library/uploads/${prev.id}?t=${Date.now()}`); if (r.ok && r.d?.session?.state === 'uploading' && r.d.session.size === job.size) session = r.d.session; }
    if (!session) {
      const r = await api('POST', '/api/library/uploads', { name: job.name, size: job.size, type: job.file.type || 'application/octet-stream', ...(job.workspace ? { workspace: job.workspace } : {}) });
      if (!r.ok || !r.d?.session) return fail(job, reason(r, r.status === 507 ? 'Your storage is full' : 'XENO couldn’t start this upload'));
      session = r.d.session;
    }
    job.session = session.id; remember(job.file, session.id);
    if (job.state === 'canceled') return abort(job);
    // 2) the parts that are not there yet, three at a time, each retried
    const have = new Set((session.parts || []).map((p) => p.n));
    const partBytes = (n) => Math.min(session.partSize, job.size - (n - 1) * session.partSize);
    let done = 0; for (const n of have) done += partBytes(n);
    const inFlight = new Map();
    const update = () => { job.sent = done + [...inFlight.values()].reduce((s, v) => s + v, 0); tick(job); };
    const todo = []; for (let n = 1; n <= session.partCount; n += 1) if (!have.has(n)) todo.push(n);
    let transport = session.transport;
    const worker = async () => {
      while (todo.length && job.state === 'uploading') {
        const n = todo.shift();
        const blob = job.file.slice((n - 1) * session.partSize, (n - 1) * session.partSize + partBytes(n));
        for (let attempt = 1; ; attempt += 1) {
          try { inFlight.set(n, 0); await sendPart(job, transport, n, blob, (b) => { inFlight.set(n, b); update(); }); inFlight.delete(n); done += blob.size; update(); break; }
          catch (e) {
            inFlight.delete(n); update();
            if (e.aborted || job.state !== 'uploading') throw e;
            if (e.status === 403 && attempt < TRIES) { const r = await api('GET', `/api/library/uploads/${session.id}?t=${Date.now()}`); if (r.ok && r.d?.session?.transport) transport = r.d.session.transport; continue; }   // a token past its life
            if (!e.retry || attempt >= TRIES) throw e;
            await new Promise((r) => setTimeout(r, 800 * attempt * attempt));
          }
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, todo.length || 1) }, worker)); }
    catch (e) {
      if (job.state === 'canceled') return abort(job);
      for (const x of job.xhrs) try { x.abort(); } catch {}   // the other parts stop too; Retry resumes from what arrived
      return fail(job, e.status === 0 ? 'The connection dropped. Retry continues where it stopped.' : 'Part of the file was refused. Retry to try again.', true);
    }
    if (job.state !== 'uploading') return job.state === 'canceled' ? abort(job) : undefined;
    // 3) complete, then wait while the platform checks it
    job.state = 'checking'; job.sent = job.size; draw();
    let r = await api('POST', `/api/library/uploads/${session.id}/complete`);
    if (!r.ok) return fail(job, reason(r, 'XENO couldn’t finish this upload'), true);
    for (let wait = 700; ; wait = Math.min(wait * 1.3, 4000)) {
      await new Promise((ok) => setTimeout(ok, wait));
      r = await api('GET', `/api/library/uploads/${session.id}?t=${Date.now()}`);
      const s = r.ok && r.d?.session;
      if (s && s.state === 'done') { job.fileId = s.file?.id; break; }
      if (s && s.state === 'failed') { remember(job.file, null); return fail(job, s.error || 'The file couldn’t be added'); }
      if (job.state === 'canceled') return;
    }
    // 4) into the folder it was dropped on (the session files it in My files / the workspace, as /api/upload did)
    if (job.folder && job.fileId) await api('PUT', `/api/library/assets/file/${job.fileId}/folder`, { folder: job.folder });
    remember(job.file, null);
    job.state = 'done'; job.finished = performance.now(); draw(); onDone(job);
  }

  function fail(job, message, retryable = false) { job.state = 'failed'; job.error = message; job.retryable = retryable; draw(); onDone(job); }
  async function abort(job) {
    job.state = 'canceled'; for (const x of job.xhrs) try { x.abort(); } catch {}
    if (job.session) { await api('DELETE', `/api/library/uploads/${job.session}`); remember(job.file, null); }
    draw();
  }

  // a smoothed speed for the time left (bytes over the last few seconds)
  function tick(job) {
    const now = performance.now();
    job.samples = (job.samples || []).filter((s) => now - s.t < 5000); job.samples.push({ t: now, b: job.sent });
    const first = job.samples[0];
    job.rate = now - first.t > 600 ? (job.sent - first.b) / ((now - first.t) / 1000) : job.rate || 0;
    if (!tick.raf) tick.raf = requestAnimationFrame(() => { tick.raf = 0; draw(); });
  }

  // ── the queue: two files at a time ──
  function pump() {
    const running = jobs.filter((j) => j.state === 'uploading' || j.state === 'checking').length;
    for (const j of jobs) { if (running + jobs.filter((x) => x.state === 'starting').length >= FILES_AT_ONCE) break; if (j.state === 'queued') { j.state = 'starting'; run(j).finally(() => pump()); } }
  }
  function add(files, { folder = null, workspace = null } = {}) {
    for (const f of files) jobs.push({ id: ++seq, file: f, name: f.name, size: f.size, folder, workspace, state: 'queued', sent: 0, xhrs: new Set() });
    open = true; draw(); pump();
  }

  // ── folders: walk a dropped folder (or an "Upload folder" pick), make its folders, then queue its files ──
  async function childFolder(parent, name, workspace) {
    const list = await api('GET', `/api/library/folders?parent=${parent || 'root'}${workspace ? `&workspace=${workspace}` : ''}&t=${Date.now()}`);
    const found = (list.ok && (list.d?.folders || [])).find?.((f) => f.name === name);
    if (found) return found.id;
    const r = await api('POST', '/api/library/folders', { name, parent, ...(!parent && workspace ? { workspace } : {}) });
    return r.ok && r.d?.folder?.id ? r.d.folder.id : null;
  }
  const readEntries = (dir) => new Promise((resolve) => { const out = []; const reader = dir.createReader(); const next = () => reader.readEntries((batch) => { if (!batch.length) return resolve(out); out.push(...batch); next(); }, () => resolve(out)); next(); });
  const fileOf = (entry) => new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  /** [{ path: ['a','b'], file }] for every file under a dropped item. */
  async function walk(entry, prefix = []) {
    if (entry.isFile) { const f = await fileOf(entry); return f ? [{ path: prefix, file: f }] : []; }
    const out = []; for (const child of await readEntries(entry)) out.push(...await walk(child, [...prefix, entry.name]));
    return out;
  }
  async function addTree(list, target) {
    const made = new Map();
    const folderFor = async (pathParts) => {
      let parent = target.folder || null;
      for (let i = 0; i < pathParts.length; i += 1) {
        const k = pathParts.slice(0, i + 1).join('/');
        if (!made.has(k)) made.set(k, await childFolder(parent, pathParts[i], target.workspace));
        parent = made.get(k); if (!parent) return null;
      }
      return parent;
    };
    const byFolder = new Map();
    for (const { path, file } of list) { const k = path.join('/'); if (!byFolder.has(k)) byFolder.set(k, { path, files: [] }); byFolder.get(k).files.push(file); }
    for (const { path, files } of byFolder.values()) {
      const folder = path.length ? await folderFor(path) : target.folder;
      if (path.length && !folder) { say(`The folder “${path.join('/')}” couldn’t be made, so its files weren’t added.`); continue; }
      add(files, { folder, workspace: target.workspace });
    }
  }
  /** A drop: files and folders from DataTransferItems. */
  async function addDrop(dataTransfer, target) {
    const entries = [...(dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.some((e) => e.isDirectory)) return add([...dataTransfer.files], target);
    const list = []; for (const e of entries) list.push(...await walk(e));
    return addTree(list, target);
  }
  /** "Upload folder": an <input webkitdirectory> pick, whose files carry their relative path. */
  function addPicked(files, target) {
    const list = [...files].map((f) => ({ path: (f.webkitRelativePath || '').split('/').slice(0, -1), file: f }));
    return list.some((x) => x.path.length) ? addTree(list, target) : add(files, target);
  }

  // ── the panel ──
  let host = null;
  const say = (text) => { window.XENO_STORAGE?.say?.(text); };
  const active = () => jobs.filter((j) => ['queued', 'starting', 'uploading', 'checking'].includes(j.state));
  function style() {
    if (document.getElementById('xsu-style')) return;
    const s = document.createElement('style'); s.id = 'xsu-style';
    s.textContent = '.xsu{position:fixed;right:20px;bottom:20px;z-index:60;width:380px;max-width:calc(100vw - 32px);border:1px solid var(--border,#2a2a2a);border-radius:12px;background:var(--panel,#141414);color:var(--text,#eee);box-shadow:0 18px 50px rgba(0,0,0,.45);font-size:13px;overflow:hidden}'
      + '.xsu-h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,#2a2a2a)}.xsu-h b{flex:1;font-weight:500;font-size:13.5px}.xsu-h small{color:var(--muted,#999)}'
      + '.xsu button{background:none;border:0;color:var(--muted,#aaa);cursor:pointer;padding:4px 7px;border-radius:6px;font-family:inherit;font-size:12.5px;font-weight:500;line-height:18px}.xsu button:hover{color:var(--text,#fff);background:rgba(255,255,255,.06)}'
      + '.xsu button.ic{width:26px;height:26px;padding:0;font-size:15px;line-height:26px;text-align:center}'
      + '.xsu-all{height:2px;background:rgba(255,255,255,.08)}.xsu-all i{display:block;height:100%;background:var(--text,#eee);transition:width .2s}'
      + '.xsu-list{max-height:min(46vh,360px);overflow:auto}.xsu-r{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05)}'
      + '.xsu-r .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsu-r .s{grid-column:1;color:var(--muted,#999);font-size:12px}.xsu-r .s.bad{color:#e88}.xsu-r .a{grid-row:1/3;grid-column:2;align-self:center}'
      + '.xsu-bar{grid-column:1/3;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:4px}.xsu-bar i{display:block;height:100%;background:var(--text,#eee);transition:width .2s}.xsu-bar.chk i{animation:xsu-p 1.2s ease-in-out infinite alternate;opacity:.6}'
      + '@keyframes xsu-p{from{opacity:.25}to{opacity:.8}}.xsu.min .xsu-list,.xsu.min .xsu-all{display:none}';
    document.head.appendChild(s);
  }
  function rowStatus(j) {
    if (j.state === 'queued' || j.state === 'starting') return `Waiting · ${size(j.size)}`;
    if (j.state === 'uploading') { const r = j.rate || 0; return `${size(j.sent)} of ${size(j.size)}${r > 0 ? ` · ${size(r)}/s · ${left((j.size - j.sent) / r)}` : ''}`; }
    if (j.state === 'checking') return 'Checking the file…';
    if (j.state === 'done') return `Added · ${size(j.size)}`;
    if (j.state === 'canceled') return 'Canceled';
    return j.error || 'Failed';
  }
  function draw() {
    if (!jobs.length) { host?.remove(); host = null; return; }
    style();
    if (!host) { host = document.createElement('section'); host.className = 'xsu'; host.setAttribute('aria-label', 'Uploads'); host.setAttribute('role', 'region'); document.body.appendChild(host); host.addEventListener('click', onClick); }
    const act = active(), failed = jobs.filter((j) => j.state === 'failed').length, doneN = jobs.filter((j) => j.state === 'done').length;
    const totalSize = act.reduce((s, j) => s + j.size, 0), totalSent = act.reduce((s, j) => s + Math.min(j.sent, j.size), 0);
    const title = act.length ? `Uploading ${act.length} ${act.length === 1 ? 'item' : 'items'}` : failed ? `${failed} ${failed === 1 ? 'upload' : 'uploads'} didn’t finish` : `${doneN} ${doneN === 1 ? 'upload' : 'uploads'} complete`;
    const rate = act.reduce((s, j) => s + (j.state === 'uploading' ? j.rate || 0 : 0), 0);
    host.classList.toggle('min', !open);
    host.innerHTML = `<div class="xsu-h"><b role="status" aria-live="polite">${esc(title)}</b>${act.length && rate > 0 ? `<small>${esc(left((totalSize - totalSent) / rate))}</small>` : ''}`
      + `${act.length ? '<button type="button" data-xsu="cancel-all" title="Cancel all">Cancel</button>' : ''}<button type="button" class="ic" data-xsu="toggle" aria-expanded="${open}" aria-label="${open ? 'Minimise uploads' : 'Show uploads'}" title="${open ? 'Minimise' : 'Show'}">${open ? '–' : '+'}</button>${act.length ? '' : '<button type="button" class="ic" data-xsu="clear" aria-label="Close uploads" title="Close">×</button>'}</div>`
      + `${act.length ? `<div class="xsu-all"><i style="width:${totalSize ? (100 * totalSent / totalSize).toFixed(1) : 0}%"></i></div>` : ''}`
      + `<div class="xsu-list">${jobs.slice().reverse().map((j) => `<div class="xsu-r" data-job="${j.id}"><span class="n" title="${esc(j.name)}">${esc(j.name)}</span>`
        + `<span class="a">${['queued', 'starting', 'uploading'].includes(j.state) ? `<button type="button" data-xsu="cancel" data-id="${j.id}" aria-label="Cancel ${esc(j.name)}">Cancel</button>` : j.state === 'failed' || j.state === 'canceled' ? `<button type="button" data-xsu="retry" data-id="${j.id}" aria-label="Retry ${esc(j.name)}">Retry</button>` : j.state === 'done' ? '<span aria-hidden="true">✓</span>' : ''}</span>`
        + `<span class="s${j.state === 'failed' ? ' bad' : ''}">${esc(rowStatus(j))}</span>`
        + `${['uploading', 'checking'].includes(j.state) ? `<span class="xsu-bar${j.state === 'checking' ? ' chk' : ''}"><i style="width:${j.state === 'checking' ? 100 : j.size ? (100 * Math.min(j.sent, j.size) / j.size).toFixed(1) : 0}%"></i></span>` : ''}</div>`).join('')}</div>`;
  }
  function onClick(e) {
    const b = e.target.closest('[data-xsu]'); if (!b) return;
    const job = jobs.find((j) => String(j.id) === b.dataset.id);
    if (b.dataset.xsu === 'toggle') { open = !open; return draw(); }
    if (b.dataset.xsu === 'clear') { jobs.length = 0; return draw(); }
    if (b.dataset.xsu === 'cancel-all') { for (const j of active()) cancel(j); return; }
    if (b.dataset.xsu === 'cancel' && job) return cancel(job);
    if (b.dataset.xsu === 'retry' && job) { job.state = 'queued'; job.error = ''; draw(); pump(); }
  }
  function cancel(job) { const was = job.state; job.state = 'canceled'; if (was === 'queued' || was === 'starting') { if (job.session) abort(job); else draw(); return; } abort(job); }

  // closing the tab mid-upload asks first; a reload resumes when the same file is added again
  window.addEventListener('beforeunload', (e) => { if (active().length) { e.preventDefault(); e.returnValue = ''; } });

  // addPaths: files with their folder path ([{ path: ['a', 'b'], file }]), what a picked or dropped folder becomes
  window.XENO_STORAGE_UPLOADS = { add, addDrop, addPicked, addPaths: addTree, setOnDone: (fn) => { onDone = fn; }, jobs: () => jobs.map(({ id, name, size, state, sent, error }) => ({ id, name, size, state, sent, error })) };
})();
