/* platform-canvas.js — canvases in the workspace: tasks, notes, links and groups on one infinite board.
 *
 * Server and rules: /api/canvases (services/canvases.js). Format: JSON Canvas 1.0 plus `xeno-ref` nodes that POINT
 * at a task by key; a task's title, status and assignee come live from the server with every read, never from the
 * canvas. Opened from Tasks: Board | List | Canvas. Addresses (id-based, parent in the path):
 *   /workspace/<area>/tasks/canvas                 the canvases of this area (Overview: all)
 *   /workspace/<area>/tasks/canvas/<canvas id>     one canvas
 *
 * Interaction (Miro / FigJam / Obsidian Canvas conventions):
 *   drag the empty board or hold Space · scroll = pan, Ctrl/⌘+scroll = zoom · drag an item to move it
 *   drag its corner to resize · drag from an item's edge handle to another item to connect them
 *   double-click the board for a note · double-click a note to edit · Delete removes the selection · Ctrl+Z undo
 * Saving is automatic (800 ms after the last change) and names the revision it was loaded at: if someone else saved
 * meanwhile, nothing is overwritten — the page says so and offers to reload.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_CANVAS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k), toast = (m) => X()?.toast?.(m);
  const said = (r, f) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || f;
  const LABEL = { raised: 'Triage', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', wont_do: 'Won’t do' };
  const LINK = { blocks: 'blocks', relates: 'relates to', duplicates: 'duplicates' };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const SAVE_MS = 800, GRID = 8;
  const snap = (v) => Math.round(v / GRID) * GRID;

  // C: the open canvas. list: the canvases of this area.
  const C = { id: null, doc: null, records: {}, rev: null, can: null, name: '', state: 'idle', view: { x: 0, y: 0, z: 1 }, sel: new Set(), dirty: false, timer: null, saving: false, conflict: false, undo: [], editing: null };
  const L = { area: undefined, list: null, state: 'idle' };

  // ───────────────────────── data
  async function loadList() {
    const here = P.area(); L.state = 'loading'; L.area = here;
    const r = await api('GET', '/api/canvases' + (here ? '?area=' + encodeURIComponent(here) : '')).catch(() => null);
    if (here !== P.area()) return;
    L.list = r && r.ok ? r.d.canvases : null; L.state = r && r.ok ? 'ready' : 'error'; paint();
  }
  async function open(id) {
    if (C.id === id && C.doc) return;
    Object.assign(C, { id, doc: null, records: {}, state: 'loading', sel: new Set(), undo: [], conflict: false, dirty: false, editing: null });
    const saved = store(id); C.view = saved || { x: 0, y: 0, z: 1 };
    const r = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null);
    if (C.id !== id) return;
    if (!r || !r.ok) { C.state = r && r.status === 404 ? 'missing' : 'error'; return paint(); }
    take(r.d.canvas); C.state = 'ready'; try { X()?.render?.(); } catch {}
    if (!saved) fit();
    paint();
  }
  function take(cv) { C.doc = cv.content; C.records = cv.records.tasks || {}; C.rev = cv.revision; C.can = cv.can; C.name = cv.name; C.project = cv.project; }
  const store = (id, v) => { try { if (v) localStorage.setItem('xw-canvas-view:' + id, JSON.stringify(v)); else return JSON.parse(localStorage.getItem('xw-canvas-view:' + id) || 'null'); } catch { return null; } return null; };

  /** call BEFORE changing C.doc: the undo step is the state as it was */
  function before() { if (!C.can || !C.can.edit) return; C.undo.push(JSON.stringify(C.doc)); if (C.undo.length > 100) C.undo.shift(); }
  function change(label) {
    if (!C.can || !C.can.edit) return;
    C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); draw();
    if (label) status(label);
  }
  async function save() {
    if (!C.dirty || C.saving || C.conflict || !C.id) return;
    C.saving = true; C.dirty = false; status('Saving…');
    const id = C.id, body = { content: C.doc, revision: C.rev, name: C.name };
    const r = await api('PUT', '/api/canvases/' + encodeURIComponent(id), body).catch(() => null);
    C.saving = false; if (C.id !== id) return;
    if (r && r.ok) { const keepSel = C.sel; C.rev = r.d.canvas.revision; C.records = r.d.canvas.records.tasks || {}; C.sel = keepSel; status('Saved'); draw(); if (C.dirty) save(); return; }
    if (r && r.status === 409 && r.d.code === 'canvas_changed') { C.conflict = true; status(''); return paint(); }
    C.dirty = true; status(said(r, 'Not saved — the change is kept here; it will try again.'), true);
    // a refused link (403/400) is a rule, not a network blip: undo it rather than retry forever
    if (r && (r.status === 403 || r.status === 400 || r.status === 404)) { C.dirty = false; if (C.undo.length) { C.doc = JSON.parse(C.undo.pop()); draw(); } toast(said(r, 'That change was refused')); return; }
    clearTimeout(C.timer); C.timer = setTimeout(save, 4000);
  }
  function status(t, bad) { const el = document.querySelector('[data-cv-status]'); if (el) { el.textContent = t; el.toggleAttribute('data-bad', !!bad); } }

  // ───────────────────────── geometry
  const nodeById = (id) => C.doc.nodes.find((n) => n.id === id);
  function fit() {
    const ns = C.doc.nodes; const host = document.querySelector('[data-cv-stage]');
    if (!ns.length) { C.view = { x: 80, y: 80, z: 1 }; return; }
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y)), maxX = Math.max(...ns.map((n) => n.x + n.width)), maxY = Math.max(...ns.map((n) => n.y + n.height));
    const w = host ? host.clientWidth : 1000, h = host ? host.clientHeight : 640;
    const z = Math.min(1.25, Math.max(0.2, Math.min((w - 120) / (maxX - minX || 1), (h - 120) / (maxY - minY || 1))));
    C.view = { z, x: (w - (maxX - minX) * z) / 2 - minX * z, y: (h - (maxY - minY) * z) / 2 - minY * z };
  }
  const toBoard = (stage, cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - C.view.x) / C.view.z, y: (cy - r.top - C.view.y) / C.view.z }; };
  const centre = () => { const s = document.querySelector('[data-cv-stage]'); const r = s ? s.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 }; return toBoard(s || { getBoundingClientRect: () => r }, r.left + r.width / 2, r.top + r.height / 2); };
  function anchor(n, toward) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2, dx = toward.x - cx, dy = toward.y - cy;
    if (Math.abs(dx) * n.height > Math.abs(dy) * n.width) return { x: dx > 0 ? n.x + n.width : n.x, y: cy };
    return { x: cx, y: dy > 0 ? n.y + n.height : n.y };
  }

  // ───────────────────────── drawing
  function nodeHtml(n) {
    const sel = C.sel.has(n.id) ? ' cv-n--sel' : '';
    const pos = `style="left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px"`;
    const grips = C.can?.edit ? `<i class="cv-grip" data-cv-grip="${esc(n.id)}" title="Resize"></i><i class="cv-wire" data-cv-wire="${esc(n.id)}" title="Drag to another item to connect">${ic('plus')}</i>` : '';
    if (n.type === 'group') return `<div class="cv-n cv-n--group${sel}" data-cv-node="${esc(n.id)}" ${pos}><b class="cv-group-l" data-cv-edit="${esc(n.id)}">${esc(n.label || 'Group')}</b>${grips}</div>`;
    if (n.type === 'text') {
      const body = C.editing === n.id ? `<textarea class="cv-text-ed" data-cv-text="${esc(n.id)}" aria-label="Note">${esc(n.text)}</textarea>` : `<div class="cv-text">${n.text ? (window.XENO_TASKS?.md ? window.XENO_TASKS.md(n.text, null, {}) : esc(n.text)) : '<span class="tk-dim">Double-click to write</span>'}</div>`;
      return `<div class="cv-n cv-n--text${sel}" data-cv-node="${esc(n.id)}" ${pos}>${body}${grips}</div>`;
    }
    if (n.type === 'link') { let host = n.url; try { host = new URL(n.url).host; } catch {} return `<div class="cv-n cv-n--link${sel}" data-cv-node="${esc(n.id)}" ${pos}>${ic('link')}<div><b>${esc(host)}</b><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.url)}</a></div>${grips}</div>`; }
    const t = C.records[n.ref.id] || { key: n.ref.id, loading: true };
    if (t.missing) return `<div class="cv-n cv-n--task cv-n--gone${sel}" data-cv-node="${esc(n.id)}" ${pos}><small class="tk-key">${esc(n.ref.id)}</small><b>Not available</b><span class="tk-dim">Deleted, or not shared with you</span>${grips}</div>`;
    return `<div class="cv-n cv-n--task${sel}" data-cv-node="${esc(n.id)}" data-cv-task="${esc(t.key)}" ${pos}>
      <div class="cv-task-top"><span class="tk-dot tk-dot--${esc(t.status || 'todo')}"></span><small class="tk-key">${esc(t.key)}</small><small class="tk-dim">${esc(LABEL[t.status] || '')}</small><span class="tk-sp"></span>${t.priority && t.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(t.priority)}</em>` : ''}</div>
      <b class="cv-task-t">${esc(t.title || '…')}</b>
      <div class="cv-task-f">${t.project ? `<small class="tk-chip">${esc(t.project.name)}</small>` : ''}<span class="tk-sp"></span>${t.delegate ? `<span class="tk-face tk-face--sm tk-face--agent" title="${esc(t.delegate.name)} (agent)">${ic('bot')}</span>` : ''}${t.assignee ? `<span class="tk-face tk-face--sm" title="${esc(t.assignee.name)}">${esc(String(t.assignee.name || '?').slice(0, 2).toUpperCase())}</span>` : ''}<button class="cv-open" data-cv-open="${esc(t.key)}" title="Open ${esc(t.key)}">${ic('open')}</button></div>${grips}</div>`;
  }
  function edgesSvg() {
    const out = [];
    for (const e of C.doc.edges) {
      const a = nodeById(e.fromNode), b = nodeById(e.toNode); if (!a || !b) continue;
      const pa = anchor(a, { x: b.x + b.width / 2, y: b.y + b.height / 2 }), pb = anchor(b, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, kind = e.xeno?.link;
      const sel = C.sel.has('e:' + e.id);
      out.push(`<g class="cv-e${kind ? ' cv-e--link' : ''}${sel ? ' cv-e--sel' : ''}" data-cv-edge="${esc(e.id)}"><path d="M${pa.x},${pa.y} L${pb.x},${pb.y}" class="cv-e-hit"/><path d="M${pa.x},${pa.y} L${pb.x},${pb.y}" class="cv-e-line"${e.toEnd === 'none' ? '' : ' marker-end="url(#cv-arrow)"'}/>${kind || e.label ? `<foreignObject x="${mx - 70}" y="${my - 11}" width="140" height="22"><div class="cv-e-label">${esc(kind ? LINK[kind] : e.label)}</div></foreignObject>` : ''}</g>`);
    }
    return out.join('');
  }
  function draw() {
    const world = document.querySelector('[data-cv-world]'); if (!world || !C.doc) return;
    const { x, y, z } = C.view;
    world.style.transform = `translate(${x}px,${y}px) scale(${z})`;
    const stage = document.querySelector('[data-cv-stage]'); if (stage) { stage.style.backgroundPosition = `${x}px ${y}px`; stage.style.backgroundSize = `${24 * z}px ${24 * z}px`; }
    const groups = C.doc.nodes.filter((n) => n.type === 'group'), rest = C.doc.nodes.filter((n) => n.type !== 'group');
    world.querySelector('[data-cv-nodes]').innerHTML = [...groups, ...rest].map(nodeHtml).join('');
    world.querySelector('[data-cv-edges]').innerHTML = edgesSvg();
    const zl = document.querySelector('[data-cv-zoom]'); if (zl) zl.textContent = Math.round(z * 100) + '%';
    const ed = world.querySelector('[data-cv-text]'); if (ed && document.activeElement !== ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
    inspector();
  }
  const setHtml = (el, html) => { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } };
  function inspector() {
    const box = document.querySelector('[data-cv-insp]'); if (!box) return;
    const ids = [...C.sel]; const one = ids.length === 1 ? ids[0] : null;
    if (one && one.startsWith('e:')) {
      const e = C.doc.edges.find((x) => 'e:' + x.id === one); const a = e && nodeById(e.fromNode), b = e && nodeById(e.toNode);
      const both = a?.type === 'xeno-ref' && b?.type === 'xeno-ref';
      setHtml(box, !e ? '' : `<span class="cv-insp-l">Connection</span>${both ? `<span class="tk-seg" role="group" aria-label="What this connection means">${[['', 'Just a line'], ['blocks', 'Blocks'], ['relates', 'Relates'], ['duplicates', 'Duplicates']].map(([k, l]) => `<button class="${(e.xeno?.link || '') === k ? 'on' : ''}" data-cv-act="edge-kind" data-arg="${k}"${e.xeno?.link && !k ? ' disabled title="Remove the link on the task page; a canvas cannot unlink tasks"' : ''}>${l}</button>`).join('')}</span><small class="tk-dim">${e.xeno?.link ? 'A real task link — it shows on both task pages.' : 'Pick a meaning to make it a real link between the tasks.'}</small>` : '<small class="tk-dim">Connect two tasks to make it a real task link.</small>'}<span class="tk-sp"></span><button class="tk-btn" data-cv-act="delete">${ic('trash')}Remove</button>`);
      return;
    }
    setHtml(box, ids.length ? `<span class="cv-insp-l">${ids.length} selected</span><span class="tk-sp"></span><button class="tk-btn" data-cv-act="group-sel">${ic('layers')}Group</button><button class="tk-btn" data-cv-act="delete">${ic('trash')}Remove from canvas</button>` : '<small class="tk-dim">Drag the board to move around · Ctrl+scroll to zoom · double-click to write a note · drag the ＋ on an item to connect it</small>');
  }

  // ───────────────────────── pages
  function where() { return P.area() ? P.areaName(P.area()) : 'all areas'; }
  function listPage() {
    if (L.area !== P.area() || (L.list === null && L.state !== 'loading' && L.state !== 'error')) loadList();
    const body = L.state === 'error' ? `<p class="tk-msg">The canvases couldn’t be loaded. <button class="pg-link" data-cv-act="retry-list">Try again</button></p>`
      : !L.list ? '<p class="tk-msg">Loading…</p>'
        : !L.list.length ? `<div class="tk-first"><p>No canvases in ${esc(where())} yet. A canvas puts tasks, notes and links side by side, so you can plan, sketch and connect work in one place. Tasks on it stay live — rename or move one anywhere and the canvas shows it.</p>${H().btn('New canvas', 'data-cv-act="new"', false, 'plus')}</div>`
          : `<div class="cv-list">${L.list.map((c) => `<button class="cv-li" data-cv-open-canvas="${esc(c.id)}"><span class="cv-li-mark">${ic('grid')}</span><span><b>${esc(c.name)}</b><small>${c.project ? esc(c.project.name) + ' · ' : ''}${c.items} item${c.items === 1 ? '' : 's'} · ${esc(H().ago(c.updatedAt))}</small></span></button>`).join('')}</div>`;
    return `<div class="tk-bar">${window.XENO_TASKS?.layoutSeg ? window.XENO_TASKS.layoutSeg('canvas') : ''}<span class="tk-sp"></span>${L.list && L.list.length ? H().btn('New canvas', 'data-cv-act="new"', false, 'plus') : ''}</div>${body}`;
  }
  function canvasPage(id) {
    if (C.id !== id) open(id);
    if (C.state === 'loading' || C.id !== id) return '<p class="tk-msg">Opening the canvas…</p>';
    if (C.state === 'missing') return `<p class="tk-msg">This canvas doesn’t exist, or it hasn’t been shared with you. <button class="pg-link" data-cv-act="back">All canvases</button></p>`;
    if (C.state === 'error') return `<p class="tk-msg">The canvas couldn’t be opened. <button class="pg-link" data-cv-act="reopen">Try again</button></p>`;
    const ro = !C.can.edit;
    return `<div class="cv" data-cv>
      <div class="cv-bar">
        ${window.XENO_TASKS?.layoutSeg ? window.XENO_TASKS.layoutSeg('canvas') : ''}
        <button class="cv-name" data-cv-act="rename"${ro ? ' disabled' : ''} title="Rename">${esc(C.name)}</button>
        ${ro ? '<small class="tk-chip">View only</small>' : `<span class="cv-tools" role="toolbar" aria-label="Add to the canvas">
          <button class="tk-tool" data-cv-act="add-task" title="Put an existing task on the canvas · T">${ic('check')}Task</button>
          <button class="tk-tool" data-cv-act="new-task" title="Create a new task here">${ic('plus')}New task</button>
          <button class="tk-tool" data-cv-act="add-note" title="Note · N">${ic('edit')}Note</button>
          <button class="tk-tool" data-cv-act="add-link" title="Link">${ic('link')}Link</button>
          <button class="tk-tool" data-cv-act="add-group" title="Group">${ic('layers')}Group</button></span>`}
        <span class="tk-sp"></span><small class="cv-status" data-cv-status aria-live="polite"></small>
        <span class="cv-zoom"><button class="tk-ib" data-cv-act="zoom-out" aria-label="Zoom out">${ic('minus')}</button><button class="cv-zl" data-cv-act="fit" data-cv-zoom title="Fit everything">100%</button><button class="tk-ib" data-cv-act="zoom-in" aria-label="Zoom in">${ic('plus')}</button></span>
        <button class="tk-ib" data-cv-act="menu" aria-label="Canvas actions">${ic('more')}</button>
      </div>
      ${C.conflict ? `<div class="cv-conflict" role="alert">Someone else saved this canvas while you were editing. Your last change wasn’t saved. <button class="tk-btn tk-btn--main" data-cv-act="reload">Load their version</button></div>` : ''}
      <div class="cv-stage" data-cv-stage tabindex="0" aria-label="Canvas ${esc(C.name)}">
        <div class="cv-world" data-cv-world>
          <svg class="cv-svg" width="1" height="1"><defs><marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><g data-cv-edges></g><path data-cv-ghost class="cv-e-ghost"/></svg>
          <div data-cv-nodes></div>
        </div>
      </div>
      <div class="cv-insp" data-cv-insp></div>
    </div>`;
  }
  function route(rest) {
    const id = rest && rest[0];
    const head = H().head({ eyebrow: '<a data-tk="board">Tasks</a>', title: id ? (C.id === id && C.name ? C.name : 'Canvas') : 'Canvases', sub: id ? undefined : `${where()} · tasks, notes and links side by side` });
    const html = H().page(head + `<div data-cv-root="${esc(id || '')}">${id ? canvasPage(id) : listPage()}</div>`, id ? 'pg--canvas' : '');
    if (id) setTimeout(draw, 0);
    return html;
  }
  function paint() {
    const root = document.querySelector('#main [data-cv-root]'); if (!root) return;
    const id = root.dataset.cvRoot;
    root.innerHTML = id ? canvasPage(id) : listPage();
    if (id) { draw(); const b = document.querySelector('#main .crumbs b'); if (b && C.name) b.textContent = C.name; const h1 = document.querySelector('#main .pg-h h1'); if (h1 && C.name) h1.textContent = C.name; }
  }
  const goCanvas = (id) => X().go('global', { global: 'tasks', item: id ? `canvas/${id}` : 'canvas' });

  // ───────────────────────── actions
  async function addTask() {
    const r = await api('GET', '/api/tasks' + (C.project ? '?projectId=' + encodeURIComponent(C.project.id) : (P.area() ? '?area=' + encodeURIComponent(P.area()) : ''))).catch(() => null);
    if (!r || !r.ok) return toast('The tasks couldn’t be loaded');
    const on = new Set(C.doc.nodes.filter((n) => n.type === 'xeno-ref').map((n) => n.ref.id));
    const free = r.d.tasks.filter((t) => !on.has(t.key));
    if (!free.length) return toast(r.d.tasks.length ? 'Every task here is already on the canvas' : 'No tasks to add yet — use New task');
    const v = await D().form({ title: 'Put tasks on the canvas', sub: 'They stay live: a change anywhere shows here.', submit: 'Add', size: 'md', fields: [{ id: 'keys', label: 'Tasks', type: 'checks', required: true, options: free.slice(0, 300).map((t) => [t.key, `${t.key} · ${t.title}`, t.project ? t.project.name : '']) }] });
    if (!v) return;
    const keys = [].concat(v.keys || []).filter(Boolean); const c = centre();
    before(); keys.forEach((k, i) => { const t = free.find((x) => x.key === k); if (t) C.records[k] = t; C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind: 'task', id: k }, x: snap(c.x - 130 + (i % 4) * 280), y: snap(c.y - 60 + Math.floor(i / 4) * 150), width: 260, height: 120 }); });
    change(`Added ${keys.length} task${keys.length === 1 ? '' : 's'}`);
  }
  async function newTaskHere() {
    const v = await D().form({ title: 'New task on this canvas', submit: 'Create', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 300 }] });
    if (!v) return;
    const r = await api('POST', '/api/tasks', { title: v.title, ...(C.project ? { projectId: C.project.id } : P.area() ? { area: P.area() } : {}) }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The task couldn’t be created'));
    const t = r.d.task, c = centre(); C.records[t.key] = t; before();
    C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind: 'task', id: t.key }, x: snap(c.x - 130), y: snap(c.y - 60), width: 260, height: 120 });
    change(`${t.key} created`); try { window.XENO_TASKS?.load?.(); } catch {}
  }
  function addNote(at) { const c = at || centre(); const n = { id: uid(), type: 'text', text: '', x: snap(c.x - 120), y: snap(c.y - 60), width: 240, height: 140 }; before(); C.doc.nodes.push(n); C.sel = new Set([n.id]); C.editing = n.id; change(); }
  async function addLink() {
    const v = await D().form({ title: 'Add a link', submit: 'Add', size: 'sm', fields: [{ id: 'url', label: 'Address', required: true, max: 2000, placeholder: 'https://…' }] });
    if (!v) return; const url = /^https?:\/\//i.test(v.url) ? v.url : 'https://' + v.url; const c = centre();
    before(); C.doc.nodes.push({ id: uid(), type: 'link', url, x: snap(c.x - 140), y: snap(c.y - 40), width: 280, height: 80 }); change('Link added');
  }
  function addGroup(around) {
    const sel = C.doc.nodes.filter((n) => around && C.sel.has(n.id));
    let g;
    if (sel.length) { const minX = Math.min(...sel.map((n) => n.x)) - 32, minY = Math.min(...sel.map((n) => n.y)) - 48, maxX = Math.max(...sel.map((n) => n.x + n.width)) + 32, maxY = Math.max(...sel.map((n) => n.y + n.height)) + 32; g = { id: uid(), type: 'group', label: 'Group', x: minX, y: minY, width: maxX - minX, height: maxY - minY }; }
    else { const c = centre(); g = { id: uid(), type: 'group', label: 'Group', x: snap(c.x - 300), y: snap(c.y - 200), width: 600, height: 400 }; }
    before(); C.doc.nodes.unshift(g); C.sel = new Set([g.id]); change('Group added'); rename(g.id);
  }
  async function rename(nodeId) {
    if (nodeId) { const n = nodeById(nodeId); const v = await D().form({ title: 'Name the group', submit: 'Save', size: 'sm', fields: [{ id: 'label', label: 'Name', value: n.label, max: 200 }] }); if (v) { before(); n.label = v.label; change(); } return; }
    const v = await D().form({ title: 'Rename canvas', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', value: C.name, required: true, max: 120 }] });
    if (v) { C.name = v.name; C.dirty = true; save(); paint(); }
  }
  function removeSel() {
    if (!C.sel.size) return;
    const ids = new Set([...C.sel].filter((s) => !s.startsWith('e:'))), eids = new Set([...C.sel].filter((s) => s.startsWith('e:')).map((s) => s.slice(2)));
    if ([...eids].some((id) => C.doc.edges.find((e) => e.id === id)?.xeno?.link)) toast('The task link stays on the task pages; only the line is removed from this canvas');
    before(); C.doc.nodes = C.doc.nodes.filter((n) => !ids.has(n.id));
    C.doc.edges = C.doc.edges.filter((e) => !eids.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode));
    C.sel.clear(); change('Removed from the canvas — the tasks themselves are untouched');
  }
  function undo() { if (!C.undo.length) return; C.doc = JSON.parse(C.undo.pop()); C.sel.clear(); C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); draw(); status('Undone'); }
  function zoomAt(f, cx, cy) {
    const stage = document.querySelector('[data-cv-stage]'); if (!stage) return;
    const r = stage.getBoundingClientRect(); const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const z = Math.min(3, Math.max(0.1, C.view.z * f)); const k = z / C.view.z;
    C.view = { z, x: px - r.left - (px - r.left - C.view.x) * k, y: py - r.top - (py - r.top - C.view.y) * k };
    store(C.id, C.view); draw();
  }
  async function canvasMenu(el) {
    const r = el.getBoundingClientRect();
    window.XCM?.show([[
      { label: 'Copy link to this canvas', icon: 'link', run: () => window.XCM.H.copy(location.href, 'Link copied') },
      { label: 'Export as JSON Canvas (.canvas)', icon: 'download', run: exportCanvas },
    ], C.can?.delete ? [{ label: 'Delete canvas', icon: 'trash', danger: true, run: delCanvas }] : []].filter((s) => s.length), { x: r.left, y: r.bottom + 4, opener: el });
  }
  function exportCanvas() {
    // JSON Canvas 1.0: task refs export as text nodes carrying the key and title, so Obsidian opens it as-is
    const nodes = C.doc.nodes.map((n) => n.type !== 'xeno-ref' ? n : { ...n, type: 'text', text: `**${n.ref.id}** ${C.records[n.ref.id]?.title || ''}\n${location.origin}/workspace/tasks/${n.ref.id}`, xeno: { ref: n.ref } });
    const blob = new Blob([JSON.stringify({ nodes: nodes.map(({ ref, ...rest }) => rest), edges: C.doc.edges }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${C.name.replace(/[^\w .-]+/g, '_')}.canvas`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function delCanvas() {
    if (!(await D().confirm({ title: `Delete “${C.name}”?`, body: 'The canvas goes away for everyone who can see it. The tasks on it are not touched.', action: 'Delete canvas' }))) return;
    const r = await api('DELETE', '/api/canvases/' + encodeURIComponent(C.id)).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted'));
    toast('Canvas deleted'); L.list = null; C.id = null; goCanvas(null);
  }
  async function newCanvas() {
    const projs = await api('GET', '/api/tasks/projects').catch(() => null);
    const here = (projs && projs.ok ? projs.d.projects : []).filter((p) => !P.area() || p.area === P.area());
    const v = await D().form({ title: 'New canvas', sub: 'Put tasks, notes and links side by side.', submit: 'Create', size: 'sm', fields: [
      { id: 'name', label: 'Name', required: true, max: 120, placeholder: 'e.g. Launch plan' },
      { id: 'projectId', label: 'Who sees it', type: 'choice', value: '', options: [['', 'Only me', 'A personal canvas'], ...here.map((p) => [p.id, p.name, 'Everyone on this project'])] }] });
    if (!v) return;
    const r = await api('POST', '/api/canvases', { name: v.name, ...(v.projectId ? { projectId: v.projectId } : P.area() ? { area: P.area() } : {}) }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The canvas couldn’t be created'));
    L.list = null; goCanvas(r.d.canvas.id);
  }
  function edgeKind(k) {
    const id = [...C.sel][0].slice(2); const e = C.doc.edges.find((x) => x.id === id); if (!e) return;
    if (!k && e.xeno?.link) return; before();
    if (!k) delete e.xeno; else e.xeno = { link: k };
    e.toEnd = 'arrow'; change(k ? `Linked: ${LINK[k]}` : null);
  }

  // ───────────────────────── pointer
  let drag = null, space = false, lastDown = null, lastNode = null;
  function openNode(n) { if (!n) return; if (n.type === 'text') { C.editing = n.id; C.sel = new Set([n.id]); draw(); } else if (n.type === 'group') rename(n.id); else if (n.type === 'xeno-ref') X().go('global', { global: 'tasks', item: n.ref.id }); else if (n.type === 'link') window.open(n.url, '_blank', 'noopener'); }
  addEventListener('pointerdown', (e) => {
    const stage = e.target.closest?.('[data-cv-stage]'); if (!stage || !C.doc || e.button > 1) return;
    if (e.target.closest('textarea, a, button.cv-open')) return;
    if (!e.target.closest('[data-cv-text]')) stage.focus({ preventScroll: true });
    const at = toBoard(stage, e.clientX, e.clientY), edit = C.can?.edit;
    const grip = e.target.closest('[data-cv-grip]'), wire = e.target.closest('[data-cv-wire]'), node = e.target.closest('[data-cv-node]'), edge = e.target.closest('[data-cv-edge]');
    // a double press on the empty board writes a note there (detected here: the pan's pointer capture eats dblclick)
    if (!node && !edge && !grip && !wire && e.button === 0 && !space) {
      const t = Date.now(), last = lastDown; lastDown = { t, x: e.clientX, y: e.clientY };
      if (last && t - last.t < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) { lastDown = null; e.preventDefault(); if (edit) { addNote(at); setTimeout(() => document.querySelector('[data-cv-text]')?.focus(), 0); } return; }
    }
    if (e.button === 1 || space || (!node && !edge && !grip && !wire)) {
      if (!node && !edge && !e.shiftKey && C.sel.size && e.button === 0 && !space) { C.sel.clear(); C.editing = null; draw(); }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: C.view.x, vy: C.view.y }; stage.setPointerCapture(e.pointerId); stage.dataset.cvPanning = ''; return;
    }
    if (edge) { const id = 'e:' + edge.dataset.cvEdge; C.sel = e.shiftKey ? new Set([...C.sel, id]) : new Set([id]); C.editing = null; draw(); return; }
    if (!edit) { if (node) { C.sel = new Set([node.dataset.cvNode]); draw(); } return; }
    if (wire) { drag = { kind: 'wire', from: wire.dataset.cvWire }; stage.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (grip) { const n = nodeById(grip.dataset.cvGrip); drag = { kind: 'size', n, sw: n.width, sh: n.height, at, pushed: false }; stage.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    const id = node.dataset.cvNode;
    if (C.editing === id) return;
    { const t = Date.now(), last = lastNode; lastNode = { t, id };
      if (last && last.id === id && t - last.t < 400) { lastNode = null; return openNode(nodeById(id)); } }
    if (e.shiftKey) { C.sel.has(id) ? C.sel.delete(id) : C.sel.add(id); } else if (!C.sel.has(id)) C.sel = new Set([id]);
    C.editing = null;
    // dragging a group carries what sits inside it (Obsidian, FigJam)
    const moving = new Set(C.sel);
    for (const g of C.doc.nodes.filter((n) => n.type === 'group' && moving.has(n.id))) for (const n of C.doc.nodes) if (n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height) moving.add(n.id);
    drag = { kind: 'move', at, items: C.doc.nodes.filter((n) => moving.has(n.id)).map((n) => [n, n.x, n.y]), pushed: false };
    stage.setPointerCapture(e.pointerId); draw();
  });
  addEventListener('pointermove', (e) => {
    if (!drag) return; const stage = document.querySelector('[data-cv-stage]'); if (!stage) return;
    if (drag.kind === 'pan') { C.view.x = drag.vx + e.clientX - drag.sx; C.view.y = drag.vy + e.clientY - drag.sy; draw(); return; }
    const at = toBoard(stage, e.clientX, e.clientY);
    if (drag.kind === 'move') {
      const dx = at.x - drag.at.x, dy = at.y - drag.at.y; if (!drag.pushed && Math.hypot(dx, dy) < 3) return;
      if (!drag.pushed) { C.undo.push(JSON.stringify(C.doc)); drag.pushed = true; }
      for (const [n, x0, y0] of drag.items) { n.x = snap(x0 + dx); n.y = snap(y0 + dy); } draw(); return;
    }
    if (drag.kind === 'size') { if (!drag.pushed) { C.undo.push(JSON.stringify(C.doc)); drag.pushed = true; } drag.n.width = Math.max(120, snap(drag.sw + at.x - drag.at.x)); drag.n.height = Math.max(60, snap(drag.sh + at.y - drag.at.y)); draw(); return; }
    if (drag.kind === 'wire') { const a = nodeById(drag.from); const p = anchor(a, at); const g = document.querySelector('[data-cv-ghost]'); if (g) g.setAttribute('d', `M${p.x},${p.y} L${at.x},${at.y}`); }
  });
  addEventListener('pointerup', (e) => {
    if (!drag) return; const d = drag; drag = null;
    const stage = document.querySelector('[data-cv-stage]'); if (stage) delete stage.dataset.cvPanning;
    if (d.kind === 'pan') { store(C.id, C.view); return; }
    if ((d.kind === 'move' || d.kind === 'size') && d.pushed) { change(); return; }
    if (d.kind === 'wire') {
      const g = document.querySelector('[data-cv-ghost]'); if (g) g.setAttribute('d', '');
      const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.dataset && el.dataset.cvNode && el.dataset.cvNode !== d.from);
      if (!over) return;
      const to = over.dataset.cvNode;
      if (C.doc.edges.some((x) => (x.fromNode === d.from && x.toNode === to) || (x.fromNode === to && x.toNode === d.from))) return toast('Those two are already connected');
      const ed = { id: uid(), fromNode: d.from, toNode: to, toEnd: 'arrow' };
      before(); C.doc.edges.push(ed); C.sel = new Set(['e:' + ed.id]); change();
    }
  });
  addEventListener('wheel', (e) => {
    const stage = e.target.closest?.('[data-cv-stage]'); if (!stage || !C.doc || e.target.closest('textarea')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    else { C.view.x -= e.deltaX; C.view.y -= e.deltaY; store(C.id, C.view); draw(); }
  }, { passive: false });

  addEventListener('input', (e) => { const t = e.target.closest?.('[data-cv-text]'); if (!t) return; const n = nodeById(t.dataset.cvText); if (n) { if (!t.__snap) { t.__snap = 1; before(); } n.text = t.value; C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); } });
  addEventListener('focusout', (e) => { const t = e.target.closest?.('[data-cv-text]'); if (!t) return; setTimeout(() => { if (C.editing === t.dataset.cvText && !document.activeElement?.closest?.('[data-cv-text]')) { C.editing = null; draw(); } }, 0); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.querySelector('[data-cv-stage]') && !e.target.closest?.('input, textarea')) { space = true; }
    if (!document.querySelector('[data-cv-stage]') || !C.doc || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (!e.target.closest?.('[data-cv]') && e.target !== document.body) return;
    const edit = C.can?.edit;
    if ((e.key === 'Delete' || e.key === 'Backspace') && edit && C.sel.size) { e.preventDefault(); removeSel(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && edit) { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
    else if (e.key === 'Escape') { C.sel.clear(); C.editing = null; draw(); }
    else if (e.key.toLowerCase() === 'n' && edit && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addNote(); }
    else if (e.key.toLowerCase() === 't' && edit && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addTask(); }
    else if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fit(); store(C.id, C.view); draw(); }
    else if ((e.key === '=' || e.key === '+') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomAt(1.2); }
    else if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomAt(1 / 1.2); }
  }, true);
  addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  const ACT = {
    'add-task': addTask, 'new-task': newTaskHere, 'add-note': () => addNote(), 'add-link': addLink, 'add-group': () => addGroup(false), 'group-sel': () => addGroup(true),
    delete: removeSel, rename: () => rename(), 'zoom-in': () => zoomAt(1.2), 'zoom-out': () => zoomAt(1 / 1.2), fit: () => { fit(); store(C.id, C.view); draw(); },
    menu: (_, el) => canvasMenu(el), reload: () => { const id = C.id; C.id = null; open(id); }, reopen: () => { const id = C.id; C.id = null; open(id); paint(); },
    back: () => goCanvas(null), new: newCanvas, 'retry-list': () => { L.list = null; paint(); }, 'edge-kind': (k) => edgeKind(k),
  };
  addEventListener('click', (e) => {
    const o = e.target.closest?.('[data-cv-open]'); if (o) { e.preventDefault(); return X().go('global', { global: 'tasks', item: o.dataset.cvOpen }); }
    const oc = e.target.closest?.('[data-cv-open-canvas]'); if (oc) return goCanvas(oc.dataset.cvOpenCanvas);
    const a = e.target.closest?.('[data-cv-act]'); if (!a || a.disabled) return;
    const f = ACT[a.dataset.cvAct]; if (f) { e.preventDefault(); f(a.dataset.arg, a); }
  });
  addEventListener('beforeunload', (e) => { if (C.dirty || C.saving) { save(); e.preventDefault(); } });
  // live: what the tasks on the canvas say now (someone else renamed or moved one) — re-read every 15 s while open
  setInterval(async () => {
    if (!C.id || !C.doc || !document.querySelector('[data-cv-stage]') || document.visibilityState !== 'visible' || C.dirty || C.saving || drag) return;
    const id = C.id; const r = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null);
    if (!r || !r.ok || C.id !== id || C.dirty || drag) return;
    if (r.d.canvas.revision !== C.rev) { take(r.d.canvas); C.sel = new Set([...C.sel].filter((s) => s.startsWith('e:') ? C.doc.edges.some((x) => 'e:' + x.id === s) : nodeById(s))); draw(); status('Updated'); }
    else { C.records = r.d.canvas.records.tasks || {}; draw(); }
  }, 15000);

  // the breadcrumb names a canvas, never its id
  const nameOf = (id) => (C.id === id && C.name ? C.name : (L.list || []).find((c) => c.id === id)?.name || null);
  window.XENO_CANVAS = { served: true, nameOf, route, open, state: () => ({ id: C.id, state: C.state, nodes: C.doc ? C.doc.nodes.length : 0, edges: C.doc ? C.doc.edges.length : 0, rev: C.rev, dirty: C.dirty, conflict: C.conflict, view: { ...C.view } }), save };
})();
