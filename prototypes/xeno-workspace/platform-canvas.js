/* platform-canvas.js — canvases in the workspace: tasks, notes, links and groups on one infinite board.
 *
 * Server and rules: /api/canvases (services/canvases.js). Format: JSON Canvas 1.0 plus `xeno-ref` nodes that POINT
 * at a task by key; a task's title, status and assignee come live from the server with every read, never from the
 * canvas. Opened from Tasks: Board | List | Canvas. Addresses (id-based, parent in the path):
 *   /workspace/<area>/tasks/canvas                 the canvases of this area (Overview: all)
 *   /workspace/<area>/tasks/canvas/<canvas id>     one canvas
 *   /workspace/projects/<pid>/canvas               the project's own canvas: the whole project, kept complete
 *   /workspace/projects/<pid>/canvas/<canvas id>   any other canvas of that project (a tasks address lands here)
 *
 * Cards: tasks, Library files, chats, and the workforce — projects, divisions, objectives and runs (admissions). Every
 * card is a pointer: its name and status are read live with each load, and moving it changes only the layout. A
 * project or a division opens as a canvas (POST /api/canvases/open-as) from its own page, via [data-xcv-open].
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
    Object.assign(C, { id, doc: null, records: {}, deps: null, depGraph: null, state: 'loading', sel: new Set(), undo: [], conflict: false, dirty: false, editing: null });
    const saved = store(id); C.view = saved || { x: 0, y: 0, z: 1 };
    const r = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null);
    if (C.id !== id) return;
    if (!r || !r.ok) { C.state = r && r.status === 404 ? 'missing' : 'error'; return paint(); }
    take(r.d.canvas); C.state = 'ready'; goLive(id); loadCatalog(); window.XENO_TASKS?.people?.(C.project ? C.project.id : null).then((p) => { C.people = p || []; draw(); });
    // a project's canvas belongs to the project: an old link under Tasks lands there, with no extra Back step
    if (C.project && /\/tasks\/canvas\//.test(location.pathname)) { history.replaceState(history.state, '', `/workspace/projects/${C.project.id}/canvas/${id}${location.search}`); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }
    try { X()?.render?.(); } catch {}
    loadDeps().then((g) => { if (g && C.id === id) draw(); });
    if (!saved) fit();
    paint();
  }
  const refsOf = (rec) => ({ generation: rec.generations || {}, file: rec.files || {}, chat: rec.chats || {}, project: rec.projects || {}, division: rec.divisions || {}, objective: rec.objectives || {}, run: rec.runs || {}, tenet: rec.tenets || {} });
  function take(cv) { C.doc = cv.content; C.records = cv.records.tasks || {}; C.refs = refsOf(cv.records); C.rev = cv.revision; C.can = cv.can; C.name = cv.name; C.project = cv.project; watchImages(); }
  const store = (id, v) => { try { if (v) localStorage.setItem('xw-canvas-view:' + id, JSON.stringify(v)); else return JSON.parse(localStorage.getItem('xw-canvas-view:' + id) || 'null'); } catch { return null; } return null; };

  /** call BEFORE changing C.doc: the undo step is the state as it was */
  function before() { if (!C.can || !C.can.edit) return; C.undo.push(JSON.stringify(C.doc)); if (C.undo.length > 100) C.undo.shift(); }
  function change(label) {
    if (!C.can || !C.can.edit) return;
    pushLive(); C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); draw();
    if (label) status(label);
  }
  async function save() {
    if (live() && !isLead()) { C.dirty = false; return; }   // one person's screen writes the shared canvas down
    if (!C.dirty || C.saving || C.conflict || !C.id) return;
    C.saving = true; C.dirty = false; status('Saving…');
    const id = C.id, body = { content: C.doc, revision: C.rev, name: C.name };
    const r = await api('PUT', '/api/canvases/' + encodeURIComponent(id), body).catch(() => null);
    C.saving = false; if (C.id !== id) return;
    if (r && r.ok) { const keepSel = C.sel; C.rev = r.d.canvas.revision; if (NOW.meta) NOW.doc.transact(() => NOW.meta.set('rev', String(C.rev)), LOCAL); C.records = r.d.canvas.records.tasks || {}; C.refs = refsOf(r.d.canvas.records); C.sel = keepSel; status('Saved'); draw(); if (C.dirty) save(); return; }
    if (r && r.status === 409 && r.d.code === 'canvas_changed') {
      // live, the shared canvas is already everyone's merge: this writes it down over the newer revision
      if (live()) { const g = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null); if (g && g.ok && C.id === id) { C.rev = g.d.canvas.revision; C.dirty = true; return save(); } }
      C.conflict = true; status(''); return paint();
    }
    C.dirty = true; status(said(r, 'Not saved — the change is kept here; it will try again.'), true);
    // a refused link (403/400) is a rule, not a network blip: undo it rather than retry forever
    if (r && (r.status === 403 || r.status === 400 || r.status === 404)) { C.dirty = false; if (C.undo.length) { C.doc = JSON.parse(C.undo.pop()); draw(); } toast(said(r, 'That change was refused')); return; }
    clearTimeout(C.timer); C.timer = setTimeout(save, 4000);
  }
  function status(t, bad) { const el = document.querySelector('[data-cv-status]'); if (el) { el.textContent = t; el.toggleAttribute('data-bad', !!bad); } }

  // ───────────────────────── together (XENO Multiplayer, xeno-live.v1)
  // While a canvas is open it's a shared Yjs document: one entry per item, so two people changing different items both
  // land, and the same item takes the last change. `gone` keeps what was removed, so a slow arrival can't bring it back.
  // /api/canvases stays what everyone else reads (agents, the map, a fresh open): one person's screen writes it down.
  const LOCAL = Symbol('canvas-local'), clone = (v) => JSON.parse(JSON.stringify(v));
  const NOW = { id: null, conn: null, doc: null, nodes: null, edges: null, gone: null, meta: null, seeded: false, pending: false, people: [], moved: 0, pushed: 0, map: 0 };
  const live = () => !!(NOW.conn && NOW.conn.status === 'open' && NOW.seeded);
  /** The first person who can edit, by connection: the same answer on every screen, and the next one if they leave. */
  function isLead() {
    const me = NOW.conn?.self; if (!me || me.role === 'viewer') return false;
    return !NOW.people.some((p) => p.role !== 'viewer' && p.kind === 'human' && String(p.conn) < String(me.conn));
  }
  const CLIENT_SRC = document.currentScript?.src; let client = null;
  const loadClient = () => client || (client = new Promise((ok, no) => {
    if (window.XenoLive) return ok(window.XenoLive);
    const s = document.createElement('script'); s.src = new URL('live-client.js', CLIENT_SRC || new URL('/workspace/', location.href)).href;
    s.onload = () => ok(window.XenoLive); s.onerror = () => { client = null; no(new Error('live client')); }; document.head.append(s);
  }));
  function stopLive() { try { NOW.conn?.close(); } catch {} try { NOW.doc?.destroy(); } catch {} Object.assign(NOW, { id: null, conn: null, doc: null, nodes: null, edges: null, gone: null, meta: null, seeded: false, pending: false, people: [] }); drawPeople(); }
  async function goLive(id) {
    stopLive(); NOW.id = id;
    let X_; try { X_ = await loadClient(); } catch { return; }        // the canvas works alone without it
    if (NOW.id !== id || C.id !== id) return;
    const doc = new X_.Y.Doc();
    Object.assign(NOW, { doc, nodes: doc.getMap('nodes'), edges: doc.getMap('edges'), gone: doc.getMap('gone'), meta: doc.getMap('meta') });
    doc.on('update', (_, origin) => { if (origin !== LOCAL && NOW.seeded) pull(); });
    const conn = X_.joinLive({ type: 'workspace.canvas', id, Y: X_.Y, doc, ticket: async (resource) => {
      const r = await api('POST', '/api/live/tickets', { resource }); if (!r.ok) throw new Error(said(r, 'No ticket')); return r.d.ticket; } });
    NOW.conn = conn;
    conn.on('status', (s) => {
      // access ended while it was open (removed from the project, or now only a viewer): read the canvas again as who
      // they are now — gone ("not shared with you") or view only. Nothing they type after this is written anywhere.
      if (s === 'ended' && conn.ended?.code === 4403 && NOW.conn === conn) { stopLive(); clearTimeout(C.timer); C.dirty = false; C.id = null; toast('Your access to this canvas changed'); open(id).then(paint); return; }
      if (s === 'open' && !NOW.seeded) setTimeout(() => { if (NOW.conn === conn) seed(); }, 500); drawPeople();
    });
    conn.on('participants', (p) => { NOW.people = p || []; drawPeople(); if (live() && isLead() && C.dirty) save(); });
    conn.on('signal', ({ data }) => { if (data && data.changed) changedElsewhere(); });
  }
  /** Joining: the shared canvas wins while anyone is on it. Alone, what was saved outside it (an agent, the map) wins. */
  function seed() {
    const edit = C.can?.edit, rev = String(C.rev), alone = !NOW.conn.participants().length;
    if (edit) NOW.doc.transact(() => {
      if (alone && NOW.meta.get('rev') !== rev) { [...NOW.nodes.keys()].forEach((k) => NOW.nodes.delete(k)); [...NOW.edges.keys()].forEach((k) => NOW.edges.delete(k)); NOW.gone.clear(); NOW.meta.set('rev', rev); }
      absorb(C.doc);
    }, LOCAL);
    NOW.seeded = true;
    if (edit || NOW.nodes.size) pull({ quiet: true }); else drawPeople();
  }
  /** What the saved canvas has that the shared one doesn't, unless someone removed it. Never overwrites. */
  function absorb(content) {
    for (const n of content.nodes) if (!NOW.nodes.has(n.id) && !NOW.gone.has(n.id)) NOW.nodes.set(n.id, clone(n));
    for (const e of content.edges) if (!NOW.edges.has(e.id) && !NOW.gone.has(e.id)) NOW.edges.set(e.id, clone(e));
  }
  function pushLive() {
    if (!NOW.seeded || !C.can?.edit || !NOW.doc) return;
    const put = (map, rows) => { const on = new Set(); for (const x of rows) { on.add(x.id); if (JSON.stringify(map.get(x.id)) !== JSON.stringify(x)) { map.set(x.id, clone(x)); NOW.gone.delete(x.id); } }
      [...map.keys()].forEach((k) => { if (!on.has(k)) { map.delete(k); NOW.gone.set(k, 1); } }); };
    NOW.doc.transact(() => { put(NOW.nodes, C.doc.nodes); put(NOW.edges, C.doc.edges); if (NOW.meta.get('name') !== C.name) NOW.meta.set('name', C.name); }, LOCAL);
    if (NOW.pending) { NOW.pending = false; pull(); }
  }
  /** Someone else's change. A drag waits for the drop; a note you're typing in stays yours while the rest keeps arriving. */
  function pull({ quiet = false } = {}) {
    if (drag) { NOW.pending = true; return; }
    const keep = (map, rows) => { const out = []; for (const x of rows) if (x.id === C.editing) out.push(x); else if (map.has(x.id)) out.push(clone(map.get(x.id))); const had = new Set(rows.map((x) => x.id)); map.forEach((v, k) => { if (!had.has(k) && !NOW.gone.has(k)) out.push(clone(v)); }); return out; };
    const nodes = keep(NOW.nodes, C.doc.nodes), ids = new Set(nodes.map((n) => n.id));
    C.doc = { ...C.doc, nodes, edges: keep(NOW.edges, C.doc.edges).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) };
    C.sel = new Set([...C.sel].filter((s) => s.startsWith('e:') || ids.has(s)));
    if (NOW.meta.get('name')) C.name = NOW.meta.get('name');
    if (C.doc.nodes.some((n) => n.type === 'xeno-ref' && !known(n))) records();
    if (!quiet && isLead()) { C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); }
    draw();
  }
  const known = (n) => (n.ref.kind === 'task' ? C.records[n.ref.id] : (C.refs[n.ref.kind] || {})[n.ref.id]);
  /** What the cards say comes from the server, as on any load. */
  async function records() {
    clearTimeout(records.t);
    records.t = setTimeout(async () => {
      const id = C.id, r = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null);
      if (!r || !r.ok || C.id !== id) return;
      C.records = r.d.canvas.records.tasks || {}; C.refs = refsOf(r.d.canvas.records); draw(); watchImages();
    }, 150);
  }
  /** The platform said something in this project changed. Cards refresh for everyone; one screen asks the map for what's new. */
  async function changedElsewhere() {
    records();
    if (!C.project || !isLead() || Date.now() - NOW.map < 1500) return;
    NOW.map = Date.now();
    const r = await api('POST', '/api/canvases/open-as', { kind: 'project', id: C.project.id }).catch(() => null);
    if (r && r.ok && r.d.canvas.id === C.id && NOW.doc) { NOW.doc.transact(() => absorb(r.d.canvas.content), LOCAL); C.rev = r.d.canvas.revision; pull(); }
  }
  function drawPeople() {
    const box = document.querySelector('[data-cv-people]'), layer = document.querySelector('[data-cv-cursors]');
    if (box) { const on = NOW.conn?.status === 'open'; box.innerHTML = !on ? '' : `<small class="tk-chip" data-cv-live>Live</small>${NOW.people.filter((p) => p.kind !== 'service').slice(0, 5).map((p) => `<span class="tk-face tk-face--sm" title="${esc(p.name)}">${esc(String(p.name || '?').slice(0, 1).toUpperCase())}</span>`).join('')}`; }
    if (!layer) return;
    layer.innerHTML = NOW.people.filter((p) => p.state && Number.isFinite(p.state.x)).map((p) => `<div class="cv-cursor" data-cv-cursor="${esc(p.conn)}" style="left:${p.state.x * C.view.z + C.view.x}px;top:${p.state.y * C.view.z + C.view.y}px"><svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><path d="M1 1v14l4-4 3 6 2-1-3-6h6z"/></svg><b>${esc(p.name)}</b></div>`).join('');
  }

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
  const centre = () => { if (C.at) { const a = { ...C.at, exact: true }; C.at = null; return a; } const s = document.querySelector('[data-cv-stage]'); const r = s ? s.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 }; return toBoard(s || { getBoundingClientRect: () => r }, r.left + r.width / 2, r.top + r.height / 2); };
  function anchor(n, toward) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2, dx = toward.x - cx, dy = toward.y - cy;
    if (Math.abs(dx) * n.height > Math.abs(dy) * n.width) return { x: dx > 0 ? n.x + n.width : n.x, y: cy };
    return { x: cx, y: dy > 0 ? n.y + n.height : n.y };
  }

  // workforce cards: what each is, and the one line of live status under its name
  const WF = { project: ['Project', 'folder'], division: ['Division', 'layers'], objective: ['Objective', 'flag'], run: ['Run', 'bot'] };
  const STATUS = { active: 'Active', archived: 'Archived', open: 'Open', completed: 'Completed', live: 'Live', admitted: 'Admitted', stopped: 'Stopped' };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  function wfLine(kind, r) {
    if (r.loading) return '';
    if (kind === 'project') return `${plural(r.openTasks || 0, 'open task', 'open tasks')} · ${r.doneTasks || 0} done`;
    if (kind === 'division') return [r.head ? `Head ${r.head}` : 'No head', plural(r.agents || 0, 'agent', 'agents'), plural(r.projects || 0, 'project', 'projects')].join(' · ');
    if (kind === 'objective') return r.goals ? `${r.goalsDone} of ${plural(r.goals, 'goal', 'goals')} done` : 'No goals yet';
    if (kind === 'run') return r.admittedAt ? `Admitted ${new Date(r.admittedAt).toLocaleString()}` : '';
    return '';
  }

  // ───────────────────────── drawing
  function nodeHtml(n) {
    const sel = C.sel.has(n.id) ? ' cv-n--sel' : '';
    const pos = `style="left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px"`;
    const grips = C.can?.edit ? `<i class="xn-grip xn-grip--tl" data-cv-grip="${esc(n.id)}" data-c="tl"></i><i class="xn-grip xn-grip--bl" data-cv-grip="${esc(n.id)}" data-c="bl"></i><i class="xn-grip xn-grip--br" data-cv-grip="${esc(n.id)}" data-c="br"></i><i class="cv-wire" data-cv-wire="${esc(n.id)}" title="Drag to another item to connect">${ic('plus')}</i>` : '';
    // a node with nobody in its corner has no scooped corner either (xn--plain)
    const xn = (kind, label, inner, opts = {}) => `<div class="cv-n xn xn--${kind}${opts.noWho ? ' xn--plain' : ''}${opts.cls || ''}${sel}" data-cv-node="${esc(n.id)}"${opts.attr || ''} ${pos}><div class="xn-label"${opts.labelAttr || ''}>${ic(opts.icon || 'doc')}<b>${esc(label)}</b>${opts.em ? `<em>${esc(opts.em)}</em>` : ''}</div><div class="xn-edge"><div class="xn-obj">${inner}</div></div>${opts.noWho ? '' : whoOf(n)}${grips}</div>`;
    // the card body every record node shares: one line of state, the name, and a foot with where it lives
    const card = ({ top = '', title = '', foot = '', url = '', titleCls = '' }) => `<div class="xn-card">${top ? `<div class="xn-card-top">${top}</div>` : ''}<b class="cv-task-t${titleCls}">${esc(title)}</b><div class="xn-card-f">${foot}<span class="tk-sp"></span>${url ? `<a class="cv-open" href="${esc(url)}" title="Open">${ic('open')}</a>` : ''}</div></div>`;
    const gone = (label, why, icon) => xn('gone', label, `<div class="xn-card"><b class="cv-task-t">Not available</b><span class="tk-dim">${esc(why)}</span></div>`, { noWho: true, icon });
    if (n.type === 'media') return mediaNode(n, xn);
    if (n.type === 'group') return xn('group', n.label || 'Group', '', { noWho: true, icon: 'layers', labelAttr: ` data-cv-edit="${esc(n.id)}"` });
    if (n.type === 'text') {
      const body = C.editing === n.id ? `<textarea class="cv-text-ed" data-cv-text="${esc(n.id)}" aria-label="Note">${esc(n.text)}</textarea>` : `<div class="cv-text">${n.text ? (window.XENO_TASKS?.md ? window.XENO_TASKS.md(n.text, null, {}) : esc(n.text)) : '<span class="tk-dim">Double-click to write</span>'}</div>`;
      return `<div class="cv-n cv-n--text xn xn--note${sel}" data-cv-node="${esc(n.id)}" ${pos}><div class="xn-label">${ic('edit')}<b>Note</b></div><div class="xn-edge"><div class="xn-obj">${body}</div></div>${grips}</div>`;
    }
    if (n.type === 'link') {
      let host = n.url; try { host = new URL(n.url).host; } catch {}
      return xn('link', host, `<div class="xn-card xn-linkc"><b class="cv-task-t">${esc(host)}</b><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.url)}</a></div>`, { noWho: true, icon: 'link' });
    }
    if (n.ref.kind === 'tenet') {   // a XENO Corpus verdict card: the tenet's latest signed verdict, read live as this reader
      const r = ((C.refs || {}).tenet || {})[n.ref.id] || { loading: true };
      if (r.missing) return gone('Tenet', 'Retired, or not shared with you', 'check');
      const st = r.state ? { held: 'Held', lapsed: 'Lapsed', error: 'Error' }[r.state] : 'Never assayed';
      return xn('tenet', r.key || 'Tenet', card({ top: `<span class="xn-verdict-dot"></span><small class="cv-verdict">${esc(st)}${r.at ? ' · ' + esc(new Date(r.at).toLocaleDateString()) : ''}${r.superseded ? ' · superseded' : ''}</small>`, title: r.claim || '…' }), { noWho: true, icon: 'check', cls: ` cv-n--tenet cv-n--v-${esc(r.state || 'none')}`, em: 'Verdict' });
    }
    // the project a map is OF is its title; a project shown on another map (a division's) is a card like the rest
    if (n.ref.kind === 'project' && n.id === 'root-project') {
      const r = ((C.refs || {}).project || {})[n.ref.id] || {};
      if (!r.missing) return xn('project', '', `<div class="xn-title">${esc(r.name || '…')}</div><div class="xn-facts"><span><b>${r.openTasks ?? 0}</b> open</span><span><b>${r.doneTasks ?? 0}</b> done</span></div>`, { noWho: true, icon: 'folder', attr: ' data-cv-kind="project"' }).replace('<div class="xn-label">', '<div class="xn-label" hidden>');
    }
    if (WF[n.ref.kind]) {
      const r = ((C.refs || {})[n.ref.kind] || {})[n.ref.id] || { loading: true }, [label, icon] = WF[n.ref.kind];
      if (r.missing) return gone(label, 'Gone, or not shared with you', icon);
      const st = r.status || '';
      return xn(n.ref.kind, label, card({ top: `<small class="cv-st cv-st--${esc(st)}">${esc(STATUS[st] || st)}</small>`, title: r.name || r.title || r.agent || '…', foot: `<small class="tk-dim">${esc(wfLine(n.ref.kind, r))}</small>`, url: r.url }), { noWho: true, icon, cls: ` cv-n--wf cv-n--${n.ref.kind}`, attr: ` data-cv-kind="${n.ref.kind}"` });
    }
    if (n.ref.kind === 'generation') {   // an older image card, made before images were nodes: it waits the same way
      const g = (C.refs.generation || {})[n.ref.id] || {}, bad = g.missing || ['failed', 'cancelled'].includes(g.state);
      return xn('media', (g.prompt || 'Image').split(/[,.]/)[0].slice(0, 34) || 'Image', `<div class="xn-media"><span class="xn-crop a"></span><span class="xn-crop b"></span><span class="xn-crop c"></span><span class="xn-crop d"></span><div class="xn-ask">${bad ? 'Didn’t finish' : 'Generating…'}</div>${bad ? '' : '<div class="xn-run"></div>'}</div>`, { icon: 'image', cls: bad ? ' xn--gone' : '', attr: ` data-cv-generation="${esc(n.ref.id)}"` });
    }
    if (n.ref.kind !== 'task') {
      const r = ((C.refs || {})[n.ref.kind] || {})[n.ref.id] || { loading: true }, isF = n.ref.kind === 'file';
      if (isF && r.doc) return xn('doc', r.name?.replace(/\.xdoc$/, '') || 'Document', docBody(n), { icon: 'doc' });
      if (n.ref.kind === 'chat' && !r.missing) return xn('chat', r.title || 'Chat', chatBody(n, r), { icon: 'chat' });
      if (isF && r.version && /^image\/(jpeg|png|gif|webp)$/.test(String(r.type))) return xn('image', r.name || 'Image', `<div class="xn-media"><img alt="${esc(r.name)}" src="/api/library/assets/${esc(r.version)}/content" draggable="false"></div>`, { icon: 'image' });
      if (r.missing) return gone(isF ? 'File' : 'Chat', 'Deleted, or not shared with you', isF ? 'file' : 'chat');
      // any other file: the kind of file is the object, named outside it, with its size and the way to open it
      const size = r.bytes != null ? (r.bytes > 1e6 ? (r.bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(r.bytes / 1e3)) + ' KB') : '';
      const ext = (String(r.name || '').match(/\.([a-z0-9]{1,6})$/i) || [, String(r.type || '').split('/')[1] || 'file'])[1].slice(0, 6).toUpperCase();
      return xn('file', r.name || 'File', `<div class="xn-card xn-filec"><div class="xn-ext">${esc(r.loading ? '' : ext)}</div><b class="cv-task-t">${esc(r.name || '…')}</b><div class="xn-card-f"><small class="tk-dim">${esc([r.type, size].filter(Boolean).join(' · '))}</small><span class="tk-sp"></span>${r.url ? `<a class="cv-open" href="${esc(r.url)}" title="Open">${ic('open')}</a>` : ''}</div></div>`, { icon: 'file' });
    }
    const t = C.records[n.ref.id] || { key: n.ref.id, loading: true };
    if (t.missing) return gone(n.ref.id, 'Deleted, or not shared with you', 'check');
    const step = STEPS.indexOf(t.status);
    return xn('task', 'Task', `<div class="xn-task"><div class="xn-tk"><span class="tk-dot tk-dot--${esc(t.status || 'todo')}"></span>${esc(LABEL[t.status] || '')}${readyBadge(t.key)}</div><b class="cv-task-t">${esc(t.title || '…')}</b><div class="xn-steps">${STEPS.map((x, i) => `<button class="${i <= step ? 'on' : ''}" data-cv-act="step" data-arg="${esc(t.key)}|${x}" title="${esc(LABEL[x])}" aria-label="${esc(LABEL[x])}"></button>`).join('')}</div></div>`, { attr: ` data-cv-task="${esc(t.key)}"`, icon: 'check', em: t.key });
  }
  const STEPS = ['todo', 'in_progress', 'in_review', 'done'];
  function whoOf(n) {
    const task = n.type === 'xeno-ref' && n.ref.kind === 'task' ? C.records[n.ref.id] : null;
    const p = task ? (task.delegate ? { name: task.delegate.name, agent: true } : task.assignee) : (C.people || []).find((x) => String(x.id) === String(n.who));
    const mark = p ? esc(String(p.name || '?').slice(0, 1).toUpperCase()) : ic('plus');
    return `<button class="xn-who ${p ? (p.agent || p.kind === 'agent' ? 'agent' : '') : 'none'}" data-cv-act="who" data-arg="${esc(n.id)}" title="${p ? 'Assigned to ' + esc(p.name) : 'Assign someone'}" aria-label="${p ? 'Assigned to ' + esc(p.name) : 'Assign someone'}"${C.can?.edit ? '' : ' disabled'}>${mark}</button>`;
  }
  // a picture or video made here: its prompt and versions live on the card, the files in the project
  const fileOf = (id) => (C.refs.file || {})[id] || {};
  const mediaOut = (m) => fileOf(m.versions[m.cur]);
  function mediaNode(n, xn) {
    const m = n.media, g = m.generation ? (C.refs.generation || {})[m.generation] : null, running = !!m.generation && !(g && (g.missing || ['failed', 'cancelled'].includes(g.state))), f = mediaOut(m), isV = m.kind === 'video';
    const src = sourceOf(n), label = (m.prompt.split(/[,.]/)[0] || (isV ? 'Video' : 'Image')).slice(0, 34);
    const empty = `<span class="xn-crop a"></span><span class="xn-crop b"></span><span class="xn-crop c"></span><span class="xn-crop d"></span><div class="xn-ask">${running ? 'Generating…' : src ? 'Starts from this picture' : isV ? 'Describe the shot below' : 'Describe the image below'}</div>`;
    const shown = !running && f.version ? (isV ? `<video src="/api/library/assets/${esc(f.version)}/content" controls preload="metadata"></video>` : `<img alt="${esc(m.prompt)}" src="/api/library/assets/${esc(f.version)}/content" draggable="false">`) : (src?.version ? `<img alt="" style="opacity:.35" src="/api/library/assets/${esc(src.version)}/content" draggable="false">` : '') + empty + (running ? '<div class="xn-run"></div>' : '');
    return xn('media', label, `<div class="xn-media">${shown}</div>`, { icon: isV ? 'play' : 'image', em: m.versions.length > 1 ? `${m.cur + 1} of ${m.versions.length}` : '' , attr: ` data-cv-media="${esc(m.kind)}"` });
  }
  /** the file behind the image wired into this node */
  function sourceOf(n) { const e = C.doc.edges.find((x) => x.toNode === n.id); const a = e && nodeById(e.fromNode); return a && a.type === 'media' && a.media.versions.length ? mediaOut(a.media) : null; }
  function docBody(n) {
    const d = docOf(n.ref.id);
    if (C.editing === n.id && d.ready) return `<textarea class="xn-page-ed" data-cv-text="${esc(n.id)}" aria-label="Document">${esc(d.markdown)}</textarea>`;
    return `<div class="xn-page"><h3>${esc(d.title || '…')}</h3>${d.markdown ? (window.XENO_TASKS?.md ? window.XENO_TASKS.md(d.markdown, null, {}) : esc(d.markdown)) : ''}</div>`;
  }
  const docs = new Map(), chats = new Map();
  function docOf(id) {
    let d = docs.get(id); if (d) return d; d = {}; docs.set(id, d);
    api('GET', '/api/workspace-docs/' + encodeURIComponent(id)).then((r) => { if (r.ok) { Object.assign(d, { ready: true, title: r.d.doc.title, markdown: r.d.doc.markdown || '', versionId: r.d.doc.versionId }); draw(); } }).catch(() => {});
    return d;
  }
  async function saveDoc(id) {
    const d = docs.get(id); if (!d || !d.ready || !d.changed) return; d.changed = false;
    const r = await api('PUT', '/api/workspace-docs/' + encodeURIComponent(id), { markdown: d.markdown, expectedVersion: d.versionId }).catch(() => null);
    if (r && r.ok) d.versionId = r.d.doc.versionId; else toast(said(r, 'That edit couldn’t be saved'));
  }
  function chatBody(n, r) {
    const k = n.ref.id; let c = chats.get(k);
    if (!c) { c = { msgs: [] }; chats.set(k, c); api('GET', '/api/chat/conversations/' + encodeURIComponent(k)).then((x) => { if (x.ok) { c.msgs = (x.d.messages || x.d.conversation?.messages || []).slice(-8); draw(); } }).catch(() => {}); }
    const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.text || ''));
    return `<div class="xn-chat"><div class="xn-thread">${c.msgs.map((m) => (m.role === 'user' ? `<div class="xn-msg--me">${esc(textOf(m))}</div>` : `<div class="xn-msg"><small>${esc(m.agent_name || 'XENO')}</small>${esc(textOf(m))}</div>`)).join('') || '<span class="tk-dim">This chat stays with the project.</span>'}</div><a class="xn-say" href="${esc(r.url || '#')}">Continue in Chat</a></div>`;
  }
  // ───────────────────────── dependency graph (xeno-orchestrator on the platform: /api/orchestrator/graph)
  // The graph is the project's own `blocks` links between tasks; this lays it out on the canvas in the order the work
  // can happen (left → right by dependency depth) and marks each card Ready / Waiting. It adds no second store: the
  // edges it draws are real task links, exactly the ones the task page shows, and a loop is refused by the server.
  function readyBadge(key) {
    const n = C.deps && C.deps.get(key); if (!n) return '';
    if (n.done) return '';
    return n.ready ? '<em class="tk-chip cv-ready" data-cv-ready="yes" title="Every blocker is done">Ready</em>'
      : `<em class="tk-chip cv-wait" data-cv-ready="no" title="Waiting on unfinished work">Waiting on ${n.blockedBy.length}</em>`;
  }
  async function loadDeps() {
    if (!C.project) return null;
    const r = await api('GET', '/api/orchestrator/graph?project=' + encodeURIComponent(C.project.id)).catch(() => null);
    if (!r || !r.ok) return null;
    const g = r.d.graph; C.deps = new Map(g.nodes.filter((n) => n.kind === 'task').map((n) => [n.key, n])); C.depGraph = g;
    return g;
  }
  async function layoutDeps() {
    const g = await loadDeps(); if (!g) return toast('The dependency graph couldn’t be loaded');
    const tasksOnly = g.nodes.filter((n) => n.kind === 'task'), byRef = new Map(g.nodes.map((n) => [n.ref, n]));
    const edges = g.edges.filter((e) => byRef.get(e.from)?.kind === 'task' && byRef.get(e.to)?.kind === 'task');
    if (!edges.length) { draw(); return toast('No dependencies yet — connect two tasks and pick “Blocks”'); }
    const involved = new Set(edges.flatMap((e) => [e.from, e.to]));
    // depth = the longest chain of blockers before it (the graph is acyclic: the server refuses loops)
    const depth = new Map(); const into = new Map();
    for (const e of edges) (into.get(e.to) || into.set(e.to, []).get(e.to)).push(e.from);
    const d = (ref, seen = new Set()) => { if (depth.has(ref)) return depth.get(ref); if (seen.has(ref)) return 0; seen.add(ref); const v = Math.max(-1, ...(into.get(ref) || []).map((x) => d(x, seen))) + 1; depth.set(ref, v); return v; };
    for (const ref of involved) d(ref);
    before();
    const at = new Map(C.doc.nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === 'task').map((n) => [n.ref.id, n]));
    const c = centre(), rows = new Map();
    for (const t of tasksOnly.filter((t) => involved.has(t.ref)).sort((a, b) => depth.get(a.ref) - depth.get(b.ref) || a.key.localeCompare(b.key, undefined, { numeric: true }))) {
      const col = depth.get(t.ref), row = rows.get(col) || 0; rows.set(col, row + 1);
      const x = snap(c.x - 300 + col * 320), y = snap(c.y - 120 + row * 150);
      const n = at.get(t.key);
      if (n) { n.x = x; n.y = y; } else { const nn = { id: uid(), type: 'xeno-ref', ref: { kind: 'task', id: t.key }, x, y, width: 260, height: 120 }; C.doc.nodes.push(nn); at.set(t.key, nn); C.records[t.key] = C.records[t.key] || { key: t.key, title: t.title, status: t.status }; }
    }
    for (const e of edges) {
      const a = at.get(byRef.get(e.from).key), b = at.get(byRef.get(e.to).key); if (!a || !b) continue;
      const have = C.doc.edges.find((x) => x.fromNode === a.id && x.toNode === b.id);
      if (have) { have.xeno = { link: 'blocks' }; have.toEnd = 'arrow'; } else C.doc.edges.push({ id: uid(), fromNode: a.id, toNode: b.id, toEnd: 'arrow', xeno: { link: 'blocks' } });
    }
    change('Dependencies laid out'); fit(); draw();
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
    const typing = world.querySelector('[data-cv-text]'), caret = typing && document.activeElement === typing ? [typing.selectionStart, typing.selectionEnd] : null;
    world.querySelector('[data-cv-nodes]').innerHTML = [...groups, ...rest].map(nodeHtml).join('');
    world.querySelector('[data-cv-edges]').innerHTML = edgesSvg();
    const zl = document.querySelector('[data-cv-zoom]'); if (zl) zl.textContent = Math.round(z * 100) + '%';
    drawPeople(); drawDock();
    const ed = world.querySelector('[data-cv-text]'); if (ed && document.activeElement !== ed) { ed.focus(); const at = caret || [ed.value.length, ed.value.length]; ed.setSelectionRange(at[0], at[1]); }
    inspector();
  }
  const setHtml = (el, html) => { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } };
  function inspector() {
    const box = document.querySelector('[data-cv-insp]'); if (!box) return;
    const ids = [...C.sel]; const one = ids.length === 1 ? ids[0] : null;
    if (one && one.startsWith('e:')) {
      const e = C.doc.edges.find((x) => 'e:' + x.id === one); const a = e && nodeById(e.fromNode), b = e && nodeById(e.toNode);
      const both = a?.type === 'xeno-ref' && b?.type === 'xeno-ref' && a.ref.kind === 'task' && b.ref.kind === 'task';
      setHtml(box, !e ? '' : `<span class="cv-insp-l">Connection</span>${both ? `<span class="tk-seg" role="group" aria-label="What this connection means">${[['', 'Just a line'], ['blocks', 'Blocks'], ['relates', 'Relates'], ['duplicates', 'Duplicates']].map(([k, l]) => `<button class="${(e.xeno?.link || '') === k ? 'on' : ''}" data-cv-act="edge-kind" data-arg="${k}"${e.xeno?.link && !k ? ' disabled title="Remove the link on the task page; a canvas cannot unlink tasks"' : ''}>${l}</button>`).join('')}</span><small class="tk-dim">${e.xeno?.link ? 'A real task link — it shows on both task pages.' : 'Pick a meaning to make it a real link between the tasks.'}</small>` : '<small class="tk-dim">Connect two tasks to make it a real task link.</small>'}<span class="tk-sp"></span><button class="tk-btn" data-cv-act="delete">${ic('trash')}Remove</button>`);
      return;
    }
    const card = one ? nodeById(one) : null;
    setHtml(box, ids.length ? `<span class="cv-insp-l">${ids.length} selected</span><span class="tk-sp"></span>${card && card.type === 'xeno-ref' && card.ref.kind === 'task' ? `<button class="tk-btn" data-cv-act="assign">${ic('people')}Assign</button>` : ''}<button class="tk-btn" data-cv-act="group-sel">${ic('layers')}Group</button><button class="tk-btn" data-cv-act="delete">${ic('trash')}Remove from canvas</button>` : '<small class="tk-dim">Right-click to add · I image · V video · D document · C chat · T task · N note · drag the ＋ on an item to connect it</small>');
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
    if (C.state === 'ready' && NOW.id !== id) goLive(id);
    if (C.state === 'missing') return `<p class="tk-msg">This canvas doesn’t exist, or it hasn’t been shared with you. <button class="pg-link" data-cv-act="back">All canvases</button></p>`;
    if (C.state === 'error') return `<p class="tk-msg">The canvas couldn’t be opened. <button class="pg-link" data-cv-act="reopen">Try again</button></p>`;
    const ro = !C.can.edit;
    return `<div class="cv" data-cv>
      <div class="cv-bar">
        ${!C.project && window.XENO_TASKS?.layoutSeg ? window.XENO_TASKS.layoutSeg('canvas') : ''}
        <button class="cv-name" data-cv-act="rename"${ro ? ' disabled' : ''} title="Rename">${esc(C.name)}</button>
        ${ro ? '<small class="tk-chip">View only</small>' : `<button class="tk-tool" data-cv-act="add">${ic('plus')}Add</button>`}
        <span class="tk-sp"></span><span class="cv-people" data-cv-people></span><small class="cv-status" data-cv-status aria-live="polite"></small>
        <span class="cv-zoom"><button class="tk-ib" data-cv-act="zoom-out" aria-label="Zoom out">${ic('minus')}</button><button class="cv-zl" data-cv-act="fit" data-cv-zoom title="Fit everything">100%</button><button class="tk-ib" data-cv-act="zoom-in" aria-label="Zoom in">${ic('plus')}</button></span>
        <button class="tk-ib" data-cv-act="menu" aria-label="Canvas actions">${ic('more')}</button>
      </div>
      ${C.conflict ? `<div class="cv-conflict" role="alert">Someone else saved this canvas while you were editing. Your last change wasn’t saved. <button class="tk-btn tk-btn--main" data-cv-act="reload">Load their version</button></div>` : ''}
      <div class="cv-stage" data-cv-stage tabindex="0" aria-label="Canvas ${esc(C.name)}">
        <div class="cv-cursors" data-cv-cursors></div>
        <div class="cv-world" data-cv-world><div class="xn-dock" data-cv-dock hidden></div>
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
    if (id && root.hasAttribute('data-cv-project')) draw();
    else if (id) { draw(); const b = document.querySelector('#main .crumbs b'); if (b && C.name) b.textContent = C.name; const h1 = document.querySelector('#main .pg-h h1'); if (h1 && C.name) h1.textContent = C.name; }
  }
  const projectItem = (p, tab) => `${(window.XENO_PG_PROJECTS?.items || []).find((x) => String(x.id) === String(p.id))?.name || p.id}${tab ? '/' + tab : ''}`;
  const projectOf = (id) => (C.id === id && C.project) || (L.list || []).find((c) => c.id === id)?.project || null;
  const goCanvas = (id) => { const p = id && projectOf(id); if (p) return X().go('global', { global: 'projects', item: projectItem(p, `Canvas/${id}`), zoneOf: 'overview' }); X().go('global', { global: 'tasks', item: id ? `canvas/${id}` : 'canvas' }); };
  // a canvas that was in a project goes back to that project, the rest to the list under Tasks
  const leave = (p) => (p ? X().go('global', { global: 'projects', item: projectItem(p), zoneOf: 'overview' }) : goCanvas(null));

  // The project's tab. Opening it asks the server for the map each time someone arrives, which also adds what's new in
  // the project; repaints while they're on it don't ask again, so nothing moves under them.
  const PM = { project: null, id: null, state: 'idle', error: null, at: 0 };
  function mapOf(pid) {
    const arriving = PM.state === 'ready' && !document.querySelector('#main [data-cv-root]') && Date.now() - PM.at > 2000;
    if (PM.project === pid && !arriving) return PM;
    Object.assign(PM, { id: PM.project === pid ? PM.id : null, project: pid, state: 'loading', error: null });
    api('POST', '/api/canvases/open-as', { kind: 'project', id: pid }).catch(() => null).then((r) => {
      if (PM.project !== pid) return;
      PM.at = Date.now();
      if (!r || !r.ok) Object.assign(PM, { state: 'error', error: said(r, 'The canvas couldn’t be opened.') });
      else { Object.assign(PM, { id: r.d.canvas.id, state: 'ready' }); if (C.id === PM.id && !C.dirty && String(C.rev) !== String(r.d.canvas.revision)) C.id = null; }
      L.list = null; try { X()?.render?.(); } catch {}
    });
    return PM;
  }
  function projectTab(sub, rec) {
    const named = /^[0-9a-f-]{36}$/i.test(String(sub || '')) ? String(sub) : null, m = named ? null : mapOf(String(rec.id)), id = named || m.id;
    if (!id) return `<p class="tk-msg">${m.state === 'error' ? esc(m.error) : 'Opening the canvas…'}</p>`;
    setTimeout(draw, 0);
    return `<div data-cv-root="${esc(id)}" data-cv-project>${canvasPage(id)}</div>`;
  }
  if (window.XENO_PROJECT_TABS && !window.XENO_PROJECT_TABS.includes('Canvas')) window.XENO_PROJECT_TABS.splice(window.XENO_PROJECT_TABS.indexOf('Tasks') + 1, 0, 'Canvas');

  // ───────────────────────── actions
  async function addTask() {
    const r = await api('GET', '/api/tasks' + (C.project ? '?projectId=' + encodeURIComponent(C.project.id) : (P.area() ? '?area=' + encodeURIComponent(P.area()) : ''))).catch(() => null);
    if (!r || !r.ok) return toast('The tasks couldn’t be loaded');
    const on = new Set(C.doc.nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === 'task').map((n) => n.ref.id));
    const free = r.d.tasks.filter((t) => !on.has(t.key));
    if (!free.length) return toast(r.d.tasks.length ? 'Every task here is already on the canvas' : 'No tasks to add yet — use New task');
    const v = await D().form({ title: 'Put tasks on the canvas', sub: 'They stay live: a change anywhere shows here.', submit: 'Add', size: 'md', fields: [{ id: 'keys', label: 'Tasks', type: 'checks', required: true, options: free.slice(0, 300).map((t) => [t.key, `${t.key} · ${t.title}`, t.project ? t.project.name : '']) }] });
    if (!v) return;
    const keys = [].concat(v.keys || []).filter(Boolean); const c = centre();
    before(); keys.forEach((k, i) => { const t = free.find((x) => x.key === k); if (t) C.records[k] = t; C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind: 'task', id: k }, x: snap(c.x - 130 + (i % 4) * 280), y: snap(c.y - 60 + Math.floor(i / 4) * 150), width: 260, height: 120 }); });
    change(`Added ${keys.length} task${keys.length === 1 ? '' : 's'}`);
  }
  /** Put Library files or chats on the canvas: they are read live, as each reader, like tasks. */
  async function addRef(kind) {
    const isF = kind === 'file', q = '';
    const r = await api('GET', (isF ? '/api/library/assets?limit=200' : '/api/chat/conversations?limit=200') + q.replace('?', '&')).catch(() => null);
    if (!r || !r.ok) return toast(isF ? 'The library couldn’t be loaded' : 'The chats couldn’t be loaded');
    const on = new Set(C.doc.nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === kind).map((n) => n.ref.id));
    const all = (isF ? r.d.items : r.d.conversations) || [], free = all.filter((x) => !on.has(String(x.id).toLowerCase()));
    if (!free.length) return toast(all.length ? `Every ${kind} here is already on the canvas` : `No ${isF ? 'files' : 'chats'} yet`);
    const v = await D().form({ title: isF ? 'Put files on the canvas' : 'Put chats on the canvas', sub: C.project ? 'They join this project, so people on it can use them.' : 'They stay live, and each person sees only what they may open.', submit: 'Add', size: 'md', fields: [{ id: 'ids', label: isF ? 'Files' : 'Chats', type: 'checks', required: true, options: free.slice(0, 300).map((x) => [String(x.id), String((isF ? x.name : x.title) || 'Untitled'), '']) }] });
    if (!v) return;
    let ids = [].concat(v.ids || []).filter(Boolean); const c = centre(); C.refs = C.refs || { file: {}, chat: {} };
    if (C.project) { ids = await joinProject(kind, ids, C.project.id); if (!ids.length) return; }
    before(); ids.forEach((id, i) => { const x = free.find((y) => String(y.id) === id); const k = id.toLowerCase();
      if (x) C.refs[kind][k] = isF ? { id: k, name: x.name, type: x.mime_type || x.type, url: '/workspace/library?sel=' + k } : { id: k, title: x.title, url: '/workspace/apps/chat/' + k };
      C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind, id: k }, x: snap(c.x - 130 + (i % 4) * 280), y: snap(c.y - 50 + Math.floor(i / 4) * 130), width: 260, height: 100 }); });
    change(`Added ${ids.length} ${isF ? 'file' : 'chat'}${ids.length === 1 ? '' : 's'}`);
  }
  /** Put the project's Corpus tenets on the canvas as verdict cards (services/xenoCorpus.js resolves them live). */
  async function addTenet() {
    if (!C.project) return;
    const r = await api('GET', `/api/corpus/project/${encodeURIComponent(C.project.id)}`).catch(() => null);
    if (!r || !r.ok) return toast('The corpus couldn’t be loaded');
    const on = new Set(C.doc.nodes.filter((n) => n.type === 'xeno-ref' && n.ref.kind === 'tenet').map((n) => n.ref.id));
    const free = (r.d.tenets || []).filter((t) => t.kind === 'tenet' && !on.has(String(t.id).toLowerCase()));
    if (!free.length) return toast((r.d.tenets || []).length ? 'Every tenet here is already on the canvas' : 'This project has no tenets yet');
    const v = await D().form({ title: 'Put verdicts on the canvas', sub: 'Each card shows the tenet’s latest signed verdict, as each reader may see it.', submit: 'Add', size: 'md', fields: [{ id: 'ids', label: 'Tenets', type: 'checks', required: true, options: free.slice(0, 300).map((t) => [String(t.id), String(t.key), String(t.claim || '').slice(0, 80)]) }] });
    if (!v) return;
    const ids = [].concat(v.ids || []).filter(Boolean); const c = centre(); C.refs = C.refs || {}; C.refs.tenet = C.refs.tenet || {};
    before(); ids.forEach((id, i) => { const t = free.find((y) => String(y.id) === id); const k = id.toLowerCase();
      if (t) C.refs.tenet[k] = { key: t.key, claim: t.claim, state: t.latest ? t.latest.state : null, at: t.latest ? t.latest.at : null, freshness: t.freshness };
      C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind: 'tenet', id: k }, x: snap(c.x - 130 + (i % 4) * 280), y: snap(c.y - 50 + Math.floor(i / 4) * 140), width: 260, height: 120 }); });
    change(`Added ${ids.length} verdict${ids.length === 1 ? '' : 's'}`);
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
  /** Put on a project's canvas, it joins the project. A chat moves only with the consent its own move asks for. Returns what joined. */
  async function joinProject(kind, ids, project) {
    const joined = [];
    for (const id of ids) {
      if (kind === 'file') {
        const r = await api('POST', `/api/chat/projects/${encodeURIComponent(project)}/files`, { storage_key: id }).catch(() => null);
        if (r && r.ok) joined.push(id); else toast(said(r, 'That file couldn’t join the project'));
        continue;
      }
      const p = await api('POST', `/api/chat/conversations/${encodeURIComponent(id)}/move/preview`, { project_id: project }).catch(() => null);
      if (!p || !p.ok) { toast(said(p, 'That chat couldn’t join the project')); continue; }
      if (!(await D().confirm({ title: 'Move this chat into the project?', body: 'People on the project will be able to read it.', action: 'Move', danger: false }))) continue;
      const m = await api('POST', `/api/chat/conversations/${encodeURIComponent(id)}/move`, { project_id: project, consent_revision: p.d.move.consentRevision }).catch(() => null);
      if (m && m.ok) joined.push(id); else toast(said(m, 'That chat couldn’t join the project'));
    }
    return joined;
  }
  // Made here, it belongs to the project: the same records its Files, Conversations and Tasks show. A card only points.
  // the first clear spot to the right of where it was asked for: nothing lands on top of something else
  function freeX(x, y, w, h) {
    for (let i = 0; i < 60; i++) {
      const hit = C.doc.nodes.filter((n) => n.type !== 'group' && x < n.x + n.width + 32 && x + w + 32 > n.x && y < n.y + n.height + 48 && y + h + 48 > n.y);
      if (!hit.length) break;
      x = Math.max(...hit.map((n) => n.x + n.width)) + 32;
    }
    return snap(x);
  }
  function place(kind, id, w, h) { const c = centre(), y = snap(c.y - h / 2); before(); C.doc.nodes.push({ id: uid(), type: 'xeno-ref', ref: { kind, id }, x: c.exact ? snap(c.x - w / 2) : freeX(c.x - w / 2, y, w, h), y, width: w, height: h }); }
  async function newDocHere() {
    const v = await D().form({ title: 'New document in this project', sub: 'It opens in Write and lives in the project’s Files.', submit: 'Create', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 200 }] });
    if (!v) return;
    const r = await api('POST', '/api/workspace-docs', { kind: 'doc', title: v.title, workspace: window.XENO_SCOPE?.served ? window.XENO_SCOPE.uuid() : null }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The document couldn’t be created'));
    const d = r.d.doc, k = String(d.id).toLowerCase();
    const moved = await api('PUT', `/api/library/assets/file/${encodeURIComponent(d.versionId)}/project`, { project: C.project.id }).catch(() => null);
    if (!moved || !moved.ok) toast(said(moved, 'It was made, but couldn’t be put in the project’s folder'));
    C.refs.file[k] = { id: k, doc: true, name: d.title, type: 'Document', url: `/workspace/office/spaces/write/${k}` };
    place('file', k, 340, 440); change('Document created');
  }
  async function newChatHere() {
    const v = await D().form({ title: 'New chat in this project', submit: 'Create', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 200 }] });
    if (!v) return;
    const r = await api('POST', '/api/chat/conversations', { title: v.title, project_id: C.project.id }).catch(() => null);
    const cv = r && r.ok && (r.d.conversation || r.d);
    if (!cv || !cv.id) return toast(said(r, 'The chat couldn’t be started'));
    const k = String(cv.id).toLowerCase();
    C.refs.chat[k] = { id: k, title: v.title, url: `/workspace/apps/chat/projects/${C.project.id}/c/${k}` };
    place('chat', k, 360, 440); change('Chat started');
  }
  // An image card waits for its generation, then becomes the file it made. A person may have left: the next open does this.
  function watchImages() {
    clearTimeout(C.imgTimer);
    const open = (C.doc?.nodes || []).filter((n) => (n.type === 'xeno-ref' && n.ref.kind === 'generation') || (n.type === 'media' && n.media.generation));
    if (!open.length || !C.can?.edit) return;
    C.imgTimer = setTimeout(async () => {
      const id = C.id; let changed = false;
      const r = await api('GET', '/api/canvases/' + encodeURIComponent(id)).catch(() => null);
      if (C.id !== id) return;
      if (!r || !r.ok) return watchImages();
      C.refs = refsOf(r.d.canvas.records);
      for (const n of open) {
        if (n.type === 'media') {
          const m = n.media, g = C.refs.generation[m.generation]; if (!g) continue;
          if (g.files && g.files.length) { if (!changed) before(); changed = true; m.versions = [...m.versions, ...g.files]; m.cur = m.versions.length - 1; m.generation = null; }
          else if (g.missing || ['failed', 'cancelled'].includes(g.state)) { if (!changed) before(); changed = true; m.generation = null; toast('It didn’t finish'); }
          continue;
        }
        const g = C.refs.generation[n.ref.id];
        if (!g || !g.files || !g.files.length) continue;
        const k = g.files[0], taken = C.doc.nodes.some((x) => x.type === 'xeno-ref' && x.ref.kind === 'file' && x.ref.id === k);
        if (!changed) before(); changed = true;
        C.doc.nodes = taken ? C.doc.nodes.filter((x) => x.id !== n.id) : C.doc.nodes.map((x) => (x.id === n.id ? { ...x, ref: { kind: 'file', id: k } } : x));
      }
      if (changed) change('Image ready'); else draw();
      watchImages();
    }, 3000);
  }
  async function assignHere(key) {
    const list = await window.XENO_TASKS.people(C.project ? C.project.id : null);
    const t = C.records[key] || {};
    const v = await D().form({ title: `Assign ${esc(key)}`, submit: 'Assign', size: 'sm', fields: [{ id: 'who', label: 'Who', type: 'select', value: t.assignee ? String(t.assignee.id) : '', options: [['', 'Nobody'], ...(list || []).map((p) => [String(p.id), p.name])] }] });
    if (!v) return;
    const r = await api('PATCH', `/api/tasks/${encodeURIComponent(key)}`, { assigneeId: v.who || null }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be assigned'));
    if (r.d.task) C.records[key] = r.d.task; draw(); status(v.who ? 'Assigned' : 'Unassigned');
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
  function undo() { if (!C.undo.length) return; C.doc = JSON.parse(C.undo.pop()); C.sel.clear(); pushLive(); C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); draw(); status('Undone'); }
  function zoomAt(f, cx, cy) {
    const stage = document.querySelector('[data-cv-stage]'); if (!stage) return;
    const r = stage.getBoundingClientRect(); const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const z = Math.min(3, Math.max(0.1, C.view.z * f)); const k = z / C.view.z;
    C.view = { z, x: px - r.left - (px - r.left - C.view.x) * k, y: py - r.top - (py - r.top - C.view.y) * k };
    store(C.id, C.view); draw();
  }
  // what opens under a selected node. Drawn apart from the nodes, so a repaint never takes the prompt from under your hand
  function drawDock() {
    const box = document.querySelector('[data-cv-dock]'); if (!box) return;
    const n = C.sel.size === 1 ? nodeById([...C.sel][0]) : null, off = !n || !C.can?.edit || (drag && drag.kind === 'size') || !(n.type === 'media' || (n.type === 'xeno-ref' && ['file', 'chat', 'task'].includes(n.ref.kind)));
    if (off) { box.hidden = true; box.__k = null; return; }
    // it sits on the board but stays one size on screen, so it can be read at any zoom
    const z = C.view.z; box.hidden = false; box.style.left = n.x + 'px'; box.style.top = n.y + n.height + 8 / z + 'px'; box.style.width = Math.max(n.width * z, 430) + 'px'; box.style.transform = `scale(${1 / z})`;
    const m = n.media, key = JSON.stringify([n.id, m ? [m.model, m.ratio, m.quality, m.versions, m.cur, m.generation, !!C.catalog] : n.ref]);
    if (box.__k === key) return; box.__k = key;
    if (!m) { const r = n.ref.kind === 'task' ? { url: null } : fileOrChat(n), where = { file: 'In Files', chat: 'In Conversations', task: 'In Tasks' }[n.ref.kind]; box.innerHTML = `<div class="xn-row"><span class="xn-cost" style="padding-left:6px">${where}</span><span class="xn-sp"></span>${r.url ? `<a class="xn-sub" href="${esc(r.url)}">${ic('open')}Open</a>` : ''}</div>`; return; }
    const d = modelOf(m), isV = m.kind === 'video', running = !!m.generation, ratios = d?.settings?.ratio?.values || ['1:1'], qs = d?.settings?.quality?.values;
    const vers = m.versions.length > 1 ? `<div class="xn-vers">${m.versions.map((v, i) => { const f = fileOf(v); return `<button class="${i === m.cur ? 'on' : ''}" data-cv-act="ver" data-arg="${i}" aria-label="Version ${i + 1}">${f.version && !isV ? `<img alt="" src="/api/library/assets/${esc(f.version)}/content">` : ''}</button>`; }).join('')}</div>` : '';
    box.innerHTML = `${vers}<textarea class="xn-prompt" rows="2" data-cv-prompt="${esc(n.id)}" aria-label="Describe it" placeholder="${isV ? 'Describe the shot' : 'Describe the image'}">${esc(m.prompt)}</textarea>
      <div class="xn-row"><button class="xn-chip" data-cv-act="media-pick" data-arg="model">${esc(d?.name || m.model || 'Model')}</button>${ratios.length > 1 ? `<button class="xn-chip" data-cv-act="media-pick" data-arg="ratio">${shapeGlyph(ratioOf(m))}${esc(m.ratio)}</button>` : ''}${qs ? `<button class="xn-chip" data-cv-act="media-pick" data-arg="quality">${esc(m.quality)}</button>` : ''}<span class="xn-sp"></span>
      ${running ? '<span class="xn-cost">Generating…</span>' : `<span class="xn-cost">${d?.tariff ? `up to ${esc(d.tariff.maxRetailCredits)} credits` : ''}</span><button class="xn-go" data-cv-act="media-go"${d ? '' : ' disabled'}>Generate</button>`}</div>
      ${m.versions.length && !isV ? `<div class="xn-row" style="border-top:1px solid var(--border)"><button class="xn-sub" data-cv-act="to-video">${ic('play')}Make a video</button><span class="xn-sp"></span><span class="xn-cost">In Files</span></div>` : ''}`;
  }
  const fileOrChat = (n) => ((C.refs || {})[n.ref.kind] || {})[n.ref.id] || {};
  const ratioOf = (m) => { const [a, b] = String(m.ratio).split(':').map(Number); return a && b ? a / b : 1; };
  const shapeGlyph = (r) => `<i style="width:${r >= 1 ? 13 : Math.round(13 * r)}px;height:${r >= 1 ? Math.round(13 / r) : 13}px"></i>`;
  const modelOf = (m) => (C.catalog?.[m.kind] || []).find((x) => x.id === m.model) || (C.catalog?.[m.kind] || [])[0] || null;
  async function loadCatalog() {
    if (C.catalog) return; const r = await api('GET', '/api/generations/catalog').catch(() => null); if (!r || !r.ok) return;
    C.catalog = Object.fromEntries((r.d.types || []).map((t) => [t.type, t.models || []])); drawDock();
  }
  function addMedia(kind, from) {
    const models = C.catalog?.[kind] || [], d = models[0];
    if (C.catalog && !d) return toast(`${kind === 'video' ? 'Video' : 'Image'} generation isn’t available right now`);
    const c = centre(), ratio = d?.settings?.ratio?.default || (kind === 'video' ? '16:9' : '1:1'), m = { kind, prompt: '', model: d?.id || '', ratio, quality: d?.settings?.quality?.default || '', versions: [], cur: 0, generation: null };
    const width = kind === 'video' ? 420 : 340, height = Math.round(width / ratioOf(m)), y = snap(c.y), n = { id: uid(), type: 'media', media: m, x: c.exact ? snap(c.x) : freeX(c.x, y, width, height), y, width, height };
    before(); C.doc.nodes.push(n); if (from) C.doc.edges.push({ id: uid(), fromNode: from, toNode: n.id, toEnd: 'arrow' });
    C.sel = new Set([n.id]); change(); loadCatalog().then(() => { const fresh = C.catalog?.[kind]?.[0]; if (!m.model && fresh) { m.model = fresh.id; m.quality = fresh.settings?.quality?.default || ''; change(); } });
    setTimeout(() => document.querySelector(`[data-cv-prompt="${n.id}"]`)?.focus(), 0);
    return n;
  }
  async function mediaGo() {
    const n = nodeById([...C.sel][0]), m = n?.media; if (!m) return;
    if (!m.prompt.trim()) { document.querySelector('[data-cv-prompt]')?.focus(); return toast('Describe it first'); }
    const d = modelOf(m), settings = {}; if (d?.settings?.ratio) settings.ratio = m.ratio; if (d?.settings?.quality) settings.quality = m.quality;
    const src = sourceOf(n); if (d?.settings?.mode) settings.mode = src?.version ? 'start_image' : 'text_to_video';
    const input = { type: m.kind, model: m.model, prompt: m.prompt, settings, ...(C.project ? { projectId: C.project.id } : {}), ...(src?.version && d?.references?.max ? { referenceAssetIds: [src.version] } : {}) };
    const q = await api('POST', '/api/generations/quote', input).catch(() => null);
    if (!q || !q.ok) return toast(said(q, 'It couldn’t be priced'));
    const g = await api('POST', '/api/generations', { ...input, quoteToken: q.d.quoteToken, requestKey: `canvas:${crypto.randomUUID()}` }).catch(() => null);
    if (!g || !g.ok) return toast(said(g, 'It couldn’t be started'));
    const id = String(g.d.generation.id).toLowerCase(); C.refs.generation = C.refs.generation || {}; C.refs.generation[id] = { id, state: g.d.generation.state, files: [] };
    before(); m.generation = id; change('Generating'); watchImages();
  }
  function mediaPick(k, el) {
    const n = nodeById([...C.sel][0]), m = n?.media; if (!m) return; const d = modelOf(m), r = el.getBoundingClientRect();
    const rows = k === 'model' ? (C.catalog?.[m.kind] || []).map((x) => [x.id, x.name]) : (d?.settings?.[k]?.values || []).map((v) => [v, v]);
    window.XCM?.show([rows.map(([v, l]) => ({ label: l, run: () => {
      before();
      if (k === 'model') { m.model = v; const nd = modelOf(m); if (!nd?.settings?.ratio?.values?.includes(m.ratio)) m.ratio = nd?.settings?.ratio?.default || m.ratio; m.quality = nd?.settings?.quality?.default || ''; }
      else m[k === 'ratio' ? 'ratio' : 'quality'] = v;
      n.height = Math.round(n.width / ratioOf(m)); change();
    } }))], { x: r.left, y: r.bottom + 4, opener: el });
  }
  async function whoPick(id, el) {
    const n = nodeById(id); if (!n) return; const list = C.people || [], r = el.getBoundingClientRect(), task = n.type === 'xeno-ref' && n.ref.kind === 'task';
    const set = async (v) => { if (task) { const x = await api('PATCH', `/api/tasks/${encodeURIComponent(n.ref.id)}`, { assigneeId: v }).catch(() => null); if (!x || !x.ok) return toast(said(x, 'It couldn’t be assigned')); if (x.d.task) C.records[n.ref.id] = x.d.task; draw(); return; } before(); if (v) n.who = v; else delete n.who; change(); };
    window.XCM?.show([list.map((p) => ({ label: p.name, icon: p.kind === 'agent' ? 'bot' : 'people', run: () => set(String(p.id)) })), [{ label: 'Nobody', run: () => set(null) }]], { x: r.left - 176, y: r.bottom + 4, opener: el });
  }
  async function stepTo(arg) {
    const [key, to] = arg.split('|'), t = C.records[key]; if (!t || t.status === to) return;
    let at = t.status, last = null;
    // a task moves one allowed step at a time: To do → In progress → In review → Done
    for (const s of STEPS.slice(STEPS.indexOf(at) < 0 ? 0 : STEPS.indexOf(at) + 1, STEPS.indexOf(to) + 1).concat(STEPS.indexOf(to) < STEPS.indexOf(at) ? [to] : [])) {
      last = await api('POST', `/api/tasks/${encodeURIComponent(key)}/transition`, { to: s, from: at }).catch(() => null);
      if (!last || !last.ok) { toast(said(last, 'That move isn’t allowed')); break; }
      at = s; C.records[key] = last.d.task;
    }
    draw();
  }
  // the add menu: the workspace's own menu, with search, opened where you asked
  function closeAdd() { document.querySelector('.xn-menu')?.remove(); }
  function openAdd(cx, cy, { from = null } = {}) {
    closeAdd(); const stage = document.querySelector('[data-cv-stage]'), at = toBoard(stage, cx, cy), P_ = !!C.project;
    const rows = from ? [['Starts from this image', [['media-image', 'Image', 'image', ''], ['media-video', 'Video', 'play', '']]]] : [
      ...(P_ ? [['In this project', [['new-task', 'Task', 'check', 'T'], ['new-doc', 'Document', 'doc', 'D'], ['new-chat', 'Chat', 'chat', 'C']]], ['Generate', [['media-image', 'Image', 'image', 'I'], ['media-video', 'Video', 'play', 'V']]]] : [['Add', [['new-task', 'Task', 'check', 'T']]]]),
      ['Bring in', [['add-task', 'Existing task', 'check', ''], ['add-file', 'File from Library', 'file', ''], ['add-chat', 'Existing chat', 'chat', ''], ...(P_ ? [['add-tenet', 'Verdict', 'check', '']] : [])]],
      ['On the canvas', [['add-note', 'Note', 'edit', 'N'], ['add-group', 'Group', 'layers', ''], ['add-link', 'Link', 'link', '']]],
    ];
    const m = document.createElement('div'); m.className = 'xcm xn-menu on'; m.setAttribute('role', 'menu');
    m.innerHTML = `<label class="xn-find">${ic('search')}<input aria-label="Find a node" placeholder="${from ? 'Connect to…' : 'Add to the canvas…'}"></label><div data-l></div>`;
    document.body.append(m);
    const list = m.querySelector('[data-l]'), q = m.querySelector('input');
    const fill = (t = '') => { const hit = rows.map(([h, r]) => [h, r.filter((x) => x[1].toLowerCase().includes(t.toLowerCase()))]).filter(([, r]) => r.length);
      list.innerHTML = hit.map(([h, r]) => `<div class="xn-grp">${esc(h)}</div>` + r.map(([k, l, i, key]) => `<div class="xcm-i" role="menuitem" data-add="${k}">${ic(i)}<span class="xcm-l">${esc(l)}</span>${key ? `<kbd>${key}</kbd>` : ''}</div>`).join('')).join('') || '<div class="xn-none">Nothing by that name</div>';
      list.querySelector('.xcm-i')?.classList.add('hl'); };
    fill(); m.style.left = Math.max(8, Math.min(cx, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = Math.max(8, Math.min(cy, innerHeight - m.offsetHeight - 8)) + 'px'; q.focus();
    q.addEventListener('input', () => fill(q.value));
    q.addEventListener('keydown', (e) => { const b = [...list.querySelectorAll('.xcm-i')], i = b.findIndex((x) => x.classList.contains('hl'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); b[i]?.classList.remove('hl'); b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.classList.add('hl'); }
      if (e.key === 'Enter' && b[i]) b[i].click(); if (e.key === 'Escape') closeAdd(); });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; closeAdd(); C.at = at; if (b.dataset.add.startsWith('media-')) addMedia(b.dataset.add.slice(6), from); else ACT[b.dataset.add]?.(); });
  }
  function nodeMenu(n, x, y) {
    window.XCM?.show([[{ label: 'Assign…', icon: 'people', run: () => whoPick(n.id, { getBoundingClientRect: () => ({ left: x + 176, bottom: y }) }) }], [{ label: 'Take off the canvas', icon: 'trash', danger: true, run: () => { C.sel = new Set([n.id]); removeSel(); } }]], { x, y });
  }
  async function canvasMenu(el) {
    const r = el.getBoundingClientRect();
    window.XCM?.show([[
      { label: 'Copy link to this canvas', icon: 'link', run: () => window.XCM.H.copy(location.href, 'Link copied') },
      ...(C.project ? [{ label: 'Lay out dependencies', icon: 'link', run: () => layoutDeps() }] : []),
      { label: 'Export as JSON Canvas (.canvas)', icon: 'download', run: exportCanvas },
    ], C.can?.delete ? [{ label: 'Delete canvas', icon: 'trash', danger: true, run: delCanvas }] : []].filter((s) => s.length), { x: r.left, y: r.bottom + 4, opener: el });
  }
  function exportCanvas() {
    // JSON Canvas 1.0: task refs export as text nodes carrying the key and title, so Obsidian opens it as-is
    const nodes = C.doc.nodes.map((n) => n.type !== 'xeno-ref' || n.ref.kind !== 'task' ? n : { ...n, type: 'text', text: `**${n.ref.id}** ${C.records[n.ref.id]?.title || ''}\n${location.origin}/workspace/tasks/${n.ref.id}`, xeno: { ref: n.ref } });
    const blob = new Blob([JSON.stringify({ nodes: nodes.map(({ ref, ...rest }) => rest), edges: C.doc.edges }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${C.name.replace(/[^\w .-]+/g, '_')}.canvas`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function delCanvas() {
    if (!(await D().confirm({ title: `Delete “${C.name}”?`, body: 'The canvas goes away for everyone who can see it. The tasks on it are not touched.', action: 'Delete canvas' }))) return;
    const r = await api('DELETE', '/api/canvases/' + encodeURIComponent(C.id)).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted'));
    const was = C.project; if (was) PM.project = null;
    toast('Canvas deleted'); L.list = null; C.id = null; leave(was);
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
  let drag = null, space = false, lastDown = null, lastNode = null, hover = null;
  const ADDKEY = { n: () => addNote(), t: () => (C.project ? newTaskHere() : addTask()), d: () => newDocHere(), c: () => newChatHere(), i: () => addMedia('image'), v: () => addMedia('video') };
  addEventListener('pointermove', (e) => { if (e.target.closest?.('[data-cv-stage]')) hover = { x: e.clientX, y: e.clientY }; });
  // the board's own menu, ahead of the page's
  addEventListener('contextmenu', (e) => {
    const stage = e.target.closest?.('[data-cv-stage]'); if (!stage || !C.doc || !C.can?.edit || e.target.closest('textarea, input')) return;
    e.preventDefault(); e.stopPropagation();
    const node = e.target.closest('[data-cv-node]'); if (node) return nodeMenu(nodeById(node.dataset.cvNode), e.clientX, e.clientY);
    openAdd(e.clientX, e.clientY);
  }, true);
  // the press that opened it still has its mouse-down to come, which takes focus off anything: hand it back after that
  function writeOn(n) { C.editing = n.id; C.sel = new Set([n.id]); draw(); setTimeout(() => document.querySelector('[data-cv-text]')?.focus(), 0); }
  function openNode(n) { if (!n) return; if (n.type === 'xeno-ref' && n.ref.kind === 'file' && fileOf(n.ref.id).doc && docOf(n.ref.id).ready) { writeOn(n); return; } if (n.type === 'text') writeOn(n); else if (n.type === 'group') rename(n.id); else if (n.type === 'xeno-ref' && n.ref.kind !== 'task') { const r = ((C.refs || {})[n.ref.kind] || {})[n.ref.id]; if (r && r.url) location.assign(r.url); } else if (n.type === 'xeno-ref') X().go('global', { global: 'tasks', item: n.ref.id }); else if (n.type === 'link') window.open(n.url, '_blank', 'noopener'); }
  addEventListener('pointerdown', (e) => {
    const stage = e.target.closest?.('[data-cv-stage]'); if (!stage || !C.doc || e.button > 1) return;
    if (e.target.closest('textarea, a, video, button.cv-open, .xn-who, .xn-steps button, .xn-dock')) return;
    closeAdd(); C.at = null;
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
    if (grip) { const n = nodeById(grip.dataset.cvGrip), f = n.type === 'xeno-ref' && n.ref.kind === 'file' ? fileOf(n.ref.id) : null, bound = n.type === 'media' || (f && !f.doc && /^image\//.test(String(f.type))); drag = { kind: 'size', n, sw: n.width, sh: n.height, x0: n.x, y0: n.y, at, c: grip.dataset.c || 'br', lock: bound ? n.width / n.height : null, pushed: false }; stage.setPointerCapture(e.pointerId); e.preventDefault(); drawDock(); return; }
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
    if (drag.kind === 'size') {
      if (!drag.pushed) { C.undo.push(JSON.stringify(C.doc)); drag.pushed = true; }
      const d = drag, dx = at.x - d.at.x, dy = at.y - d.at.y, left = d.c !== 'br', top = d.c === 'tl'; let w = d.sw + (left ? -dx : dx), h = d.sh + (top ? -dy : dy);
      // a picture keeps its shape, whichever way you pull further; everything else takes the size you give it
      if (d.lock) { const byH = h * d.lock; w = Math.max(160, snap(Math.abs(w - d.sw) >= Math.abs(byH - d.sw) ? w : byH)); h = Math.round(w / d.lock); } else { w = Math.max(120, snap(w)); h = Math.max(60, snap(h)); }
      d.n.width = w; d.n.height = h; d.n.x = left ? d.x0 + d.sw - w : d.x0; d.n.y = top ? d.y0 + d.sh - h : d.y0; draw(); return;
    }
    if (drag.kind === 'wire') { const a = nodeById(drag.from); const p = anchor(a, at); const g = document.querySelector('[data-cv-ghost]'); if (g) g.setAttribute('d', `M${p.x},${p.y} L${at.x},${at.y}`); }
  });
  addEventListener('pointerup', (e) => {
    if (!drag) return; const d = drag; drag = null;
    const stage = document.querySelector('[data-cv-stage]'); if (stage) delete stage.dataset.cvPanning;
    if (d.kind === 'pan') { store(C.id, C.view); if (NOW.pending) { NOW.pending = false; pull(); } return; }
    if ((d.kind === 'move' || d.kind === 'size') && d.pushed) { change(); return; }
    if (d.kind === 'wire') {
      const g = document.querySelector('[data-cv-ghost]'); if (g) g.setAttribute('d', '');
      const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.dataset && el.dataset.cvNode && el.dataset.cvNode !== d.from);
      if (!over) { if (nodeById(d.from)?.type === 'media' && C.project) openAdd(e.clientX, e.clientY, { from: d.from }); return; }
      const to = over.dataset.cvNode;
      if (C.doc.edges.some((x) => (x.fromNode === d.from && x.toNode === to) || (x.fromNode === to && x.toNode === d.from))) return toast('Those two are already connected');
      const ed = { id: uid(), fromNode: d.from, toNode: to, toEnd: 'arrow' };
      before(); C.doc.edges.push(ed); C.sel = new Set(['e:' + ed.id]); change();
    }
  });
  addEventListener('pointermove', (e) => {
    if (!NOW.conn || NOW.conn.status !== 'open') return;
    const now = Date.now(), stage = e.target.closest?.('[data-cv-stage]');
    if (stage && now - NOW.moved > 50) { NOW.moved = now; NOW.conn.setPresence(toBoard(stage, e.clientX, e.clientY)); }
    if (drag && drag.pushed && now - NOW.pushed > 80) { NOW.pushed = now; pushLive(); }   // the card moves on their screen too
  });
  setInterval(() => { if (NOW.id && !document.querySelector('[data-cv-stage]')) stopLive(); }, 5000);
  addEventListener('wheel', (e) => {
    const stage = e.target.closest?.('[data-cv-stage]'); if (!stage || !C.doc || e.target.closest('textarea')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    else { C.view.x -= e.deltaX; C.view.y -= e.deltaY; store(C.id, C.view); draw(); }
  }, { passive: false });

  addEventListener('input', (e) => { const pr = e.target.closest?.('[data-cv-prompt]'); if (pr) { const x = nodeById(pr.dataset.cvPrompt); if (x) { x.media.prompt = pr.value; pushLive(); C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); } return; } const t = e.target.closest?.('[data-cv-text]'); if (!t) return; const n = nodeById(t.dataset.cvText); if (n && n.type === 'xeno-ref') { const d = docs.get(n.ref.id); if (d) { d.markdown = t.value; d.changed = true; clearTimeout(d.t); d.t = setTimeout(() => saveDoc(n.ref.id), 900); } return; } if (n) { if (!t.__snap) { t.__snap = 1; before(); } n.text = t.value; C.dirty = true; clearTimeout(C.timer); C.timer = setTimeout(save, SAVE_MS); } });
  addEventListener('focusout', (e) => { const t = e.target.closest?.('[data-cv-text]'); if (!t) return; { const x = nodeById(t.dataset.cvText); if (x?.type === 'xeno-ref') saveDoc(x.ref.id); } setTimeout(() => { if (C.editing === t.dataset.cvText && !document.activeElement?.closest?.('[data-cv-text]')) { C.editing = null; draw(); } }, 0); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.querySelector('[data-cv-stage]') && !e.target.closest?.('input, textarea')) { space = true; }
    if (!document.querySelector('[data-cv-stage]') || !C.doc || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (!e.target.closest?.('[data-cv]') && e.target !== document.body) return;
    const edit = C.can?.edit;
    if ((e.key === 'Delete' || e.key === 'Backspace') && edit && C.sel.size) { e.preventDefault(); removeSel(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && edit) { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
    else if (e.key === 'Escape') { C.sel.clear(); C.editing = null; draw(); }
    else if (edit && !e.ctrlKey && !e.metaKey && !e.altKey && ADDKEY[e.key.toLowerCase()] && (C.project || 'nt'.includes(e.key.toLowerCase()))) { e.preventDefault(); if (hover) C.at = toBoard(document.querySelector('[data-cv-stage]'), hover.x, hover.y); ADDKEY[e.key.toLowerCase()](); }
    else if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fit(); store(C.id, C.view); draw(); }
    else if ((e.key === '=' || e.key === '+') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomAt(1.2); }
    else if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomAt(1 / 1.2); }
  }, true);
  addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  const ACT = {
    'add-task': addTask, 'new-task': newTaskHere, 'new-doc': newDocHere, 'new-chat': newChatHere, add: (_, el) => { const r = el.getBoundingClientRect(); openAdd(r.left, r.bottom + 6); }, who: (id, el) => whoPick(id, el), step: (a) => stepTo(a), 'media-go': () => mediaGo(), 'media-pick': (k, el) => mediaPick(k, el), ver: (i) => { const m = nodeById([...C.sel][0])?.media; if (m) { before(); m.cur = Number(i); change(); } }, 'to-video': () => { const n = nodeById([...C.sel][0]); if (n) { C.at = { x: n.x + n.width + 80, y: n.y }; addMedia('video', n.id); } }, assign: () => { const n = nodeById([...C.sel][0]); if (n && n.ref) assignHere(n.ref.id); }, 'add-file': () => addRef('file'), 'add-chat': () => addRef('chat'), 'add-tenet': addTenet, 'add-note': () => addNote(), 'add-link': addLink, 'add-group': () => addGroup(false), 'group-sel': () => addGroup(true),
    delete: removeSel, rename: () => rename(), 'zoom-in': () => zoomAt(1.2), 'zoom-out': () => zoomAt(1 / 1.2), fit: () => { fit(); store(C.id, C.view); draw(); },
    menu: (_, el) => canvasMenu(el), reload: () => { const id = C.id; C.id = null; open(id); }, reopen: () => { const id = C.id; C.id = null; open(id); paint(); },
    deps: () => layoutDeps(), back: () => leave(C.project), new: newCanvas, 'retry-list': () => { L.list = null; paint(); }, 'edge-kind': (k) => edgeKind(k),
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
    else { C.records = r.d.canvas.records.tasks || {}; C.refs = refsOf(r.d.canvas.records); await loadDeps(); if (C.id === id) draw(); }
  }, 15000);

  // the breadcrumb names a canvas, never its id
  const nameOf = (id) => (C.id === id && C.name ? C.name : (L.list || []).find((c) => c.id === id)?.name || null);
  // "Open as canvas" on a project or a division: the same canvas every time, made on first open
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-xcv-open]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.busy) return; b.dataset.busy = '1';
    const r = await api('POST', '/api/canvases/open-as', { kind: b.dataset.xcvOpen, id: b.dataset.id }).catch(() => null);
    delete b.dataset.busy;
    if (!r || !r.ok) return toast(said(r, 'It could not be opened as a canvas.'));
    L.list = null; goCanvas(r.d.canvas.id);
  }, true);
  window.XENO_CANVAS = { served: true, act: (k, a) => { ACT[k]?.(a); }, nameOf, route, open, projectTab, state: () => ({ id: C.id, state: C.state, nodes: C.doc ? C.doc.nodes.length : 0, edges: C.doc ? C.doc.edges.length : 0, rev: C.rev, dirty: C.dirty, conflict: C.conflict, view: { ...C.view } }), save };
})();
