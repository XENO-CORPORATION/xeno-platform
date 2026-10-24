/* platform-project-files.js — a project's own folder in XENO Storage (services/chatProjectFolders.js).
 *
 *   Files (project)   /workspace/projects/<pid>/files      the project's folder: what is in it, what it takes up, and
 *                                                           the way into Storage to add, move or share
 *
 * Every project has one folder, made with the project (GET /api/chat/projects/:id/storage makes it on the first open
 * for a project older than this). It is an ordinary Storage folder: a personal project's sits in the owner's storage,
 * a workspace project's in the workspace's, under "Projects". Served from disk (no platform), none of this appears.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_PFILES = { served: false }; return; }
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const paint = () => { try { if (window.XENO_PAGES?.repaint && document.querySelector('#main .mview')) window.XENO_PAGES.repaint(); else X()?.render?.(); } catch {} };
  const why = (r, d) => (r && r.d && (r.d.error || r.d.code)) || d;

  const C = new Map();
  function load(projectId) {
    const c = C.get(projectId); if (c) return c;
    const e = { status: 'loading' }; C.set(projectId, e);
    (async () => {
      const s = await P.api('GET', `/api/chat/projects/${projectId}/storage`);
      if (!s.ok) { e.status = s.status === 507 ? 'full' : s.status === 404 ? 'missing' : 'error'; e.why = why(s, 'The project folder could not be opened'); return paint(); }
      e.folder = s.d.folder; e.usage = s.d.usage;
      const [f, l] = await Promise.all([P.api('GET', `/api/library/folders?parent=${e.folder.id}`), P.api('GET', `/api/library/assets?folder=${e.folder.id}&sort=name&limit=200`)]);
      e.folders = (f.ok && f.d.folders) || []; e.items = (l.ok && (l.d.assets || l.d.items)) || [];
      e.status = f.ok && l.ok ? 'ready' : 'error'; if (e.status === 'error') e.why = why(f.ok ? l : f, 'The folder could not be listed');
      paint();
    })().catch(() => { e.status = 'error'; e.why = 'The project folder could not be opened'; paint(); });
    return e;
  }

  function projectTab(_cur, _sub, rec, h) {
    const { box, btn } = h;
    if (!rec || !rec.id) return box('refresh', 'Loading the project', '', '', 'sm');
    const e = load(String(rec.id));
    if (e.status === 'loading') return box('refresh', 'Opening the project folder', '', '', 'sm');
    if (e.status === 'full') return box('folder', 'Storage is full', 'The project folder is made once there is room. Free up space or add storage, then open this tab again.', btn('Try again', `data-xpf="retry" data-id="${esc(rec.id)}"`, true), 'sm');
    if (e.status !== 'ready') return box('folder', 'The project folder could not be opened', esc(e.why || ''), btn('Try again', `data-xpf="retry" data-id="${esc(rec.id)}"`, true), 'sm');
    const href = `/workspace/corpo/apps/storage/f/${encodeURIComponent(e.folder.id)}`;
    const where = e.folder.workspaceId ? "In the workspace's storage" : 'In your storage';
    const bar = `<div class="xpf-bar"><div><b>${esc(e.folder.name)}</b><small>${where} · Projects · ${size(e.usage?.bytes)} · ${e.usage?.files || 0} file${e.usage?.files === 1 ? '' : 's'}</small></div><span class="pg-sp"></span><a class="pg-btn" href="${href}">Open in Storage</a></div>`;
    const rows = [
      ...e.folders.map((f) => `<li><a href="/workspace/corpo/apps/storage/f/${encodeURIComponent(f.id)}"><b>${esc(f.name)}</b></a><small>Folder</small></li>`),
      ...e.items.map((a) => `<li><span><b>${esc(a.name || a.original_name || 'File')}</b></span><small>${size(a.file_size ?? a.size)}</small></li>`),
    ];
    const list = rows.length ? `<ul class="xpf-list">${rows.join('')}</ul>`
      : box('folder', 'No files yet', "Files you add to this project's folder appear here, for everyone on the project.", `<a class="pg-btn" href="${href}">Add files in Storage</a>`, 'sm');
    return bar + list + '<p class="pg-rule">Everyone on the project can open this folder. It counts toward the storage it sits in, and removing the project keeps the files.</p>';
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-xpf]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if (b.dataset.xpf === 'retry') { C.delete(b.dataset.id); paint(); }
  }, true);
  if (!document.getElementById('xpf-css')) {
    const s = document.createElement('style'); s.id = 'xpf-css';
    s.textContent = '.xpf-bar{display:flex;align-items:center;gap:12px;margin:0 0 12px}.xpf-bar small{display:block;opacity:.7}.xpf-bar .pg-sp{flex:1}.xpf-list{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}.xpf-list li{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;background:var(--panel)}.xpf-list a{color:inherit}';
    document.head.appendChild(s);
  }
  if (window.XENO_PROJECT_TABS && !window.XENO_PROJECT_TABS.includes('Files')) {
    const at = window.XENO_PROJECT_TABS.indexOf('Resources');
    window.XENO_PROJECT_TABS.splice(at < 0 ? window.XENO_PROJECT_TABS.length : at, 0, 'Files');
  }
  window.XENO_PFILES = { served: true, tabs: ['Files'], projectTab, reload: () => { C.clear(); paint(); } };
})();
