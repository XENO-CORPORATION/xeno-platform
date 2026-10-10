/* platform-tasks.js — XENO Tasks (codename Telos) in the workspace. Product spec: XENO-CORPORATION/xeno-tasks.
 *
 * One page, in every area and on Overview (#/<area>/g/tasks, #/overview/g/tasks):
 *   Board          the tasks of this area (Overview: all), one column per status; drag a card to move it
 *   My tasks · Needs triage · In review     the lists people use every day
 *   T-123          one task: actions, description, images, activity and comments on the left; its properties on
 *                  the right, each a one-line row that changes in place (Linear, Jira)
 * and a project's Tasks tab (XENO_TASKS.projectTab).
 *
 * Refreshing is LOCAL: every page draws one region (`[data-tk-root]`), and an action, a poll or another person's
 * change re-draws only that region — never the workspace around it. A draft in the comment box survives it.
 * Right-click (or the ⋯ button, or Shift+F10) on a card, a row or a task gives its menu through XCM, the one
 * context-menu engine. Every action is /api/tasks; the platform decides who may do what, and the page offers only
 * what each task's `can` allows. A move carries the status the screen showed, so a stale screen is refused.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_TASKS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k), toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const COLS = [['raised', 'Triage'], ['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['in_review', 'In review'], ['done', 'Done']];
  const LABEL = { raised: 'Triage', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', wont_do: 'Won’t do' };
  const MOVE = { todo: 'Accept', in_progress: 'Start', blocked: 'Blocked', in_review: 'Send to review', done: 'Done', wont_do: 'Won’t do', raised: 'Reopen' };
  const KIND = { task: ['check', 'Task'], bug: ['bolt', 'Bug'], feature: ['spark', 'Feature'], question: ['help', 'Question'] };
  const PRI = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' };
  const PRI_ORDER = ['urgent', 'high', 'medium', 'low', 'none'];
  const CLOSED = ['done', 'wont_do'];
  const POLL_MS = 12000;
  const T = { list: null, area: undefined, loading: null, task: new Map(), status: 'loading', filter: 'all', byProject: new Map(), people: new Map() };
  const me = () => (P.user ? String(P.user.id) : '');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const face = (p, sm) => (p ? `<span class="tk-face${sm ? ' tk-face--sm' : ''}${p.kind === 'agent' ? ' tk-face--agent' : ''}" title="${esc(p.name)}${p.kind === 'agent' ? ' (agent)' : ''}">${p.kind === 'agent' ? ic('bot') : esc(initials(p.name))}</span>` : `<span class="tk-face tk-face--none${sm ? ' tk-face--sm' : ''}" title="Unassigned">${ic('user')}</span>`);
  const when = (iso) => { const a = H().ago(iso); return a === 'just now' ? a : a + ' ago'; };
  const imgUrl = (key, id) => `/api/tasks/${encodeURIComponent(key)}/attachments/${encodeURIComponent(id)}`;
  const findTask = (key) => T.task.get(key) || (T.list || []).find((x) => x.key === key) || [...T.byProject.values()].flatMap((v) => (Array.isArray(v) ? v : [])).find((x) => x.key === key) || null;
  const pkey = (t) => (t.project ? t.project.id : 'personal');

  // ───────────────────────── data
  function load() {
    const here = P.area();
    if (T.loading && T.loadingFor === here) return T.loading;
    T.loadingFor = here;
    T.loading = (async () => {
      const r = await api('GET', '/api/tasks' + (here ? '?area=' + encodeURIComponent(here) : '')).catch(() => null);
      if (here !== P.area()) { T.loading = null; return load(); }
      T.area = here; T.loading = null;
      if (r && r.ok && Array.isArray(r.d.tasks)) { T.list = r.d.tasks; T.status = 'ready'; } else if (!T.list) T.status = 'error';
      patch();
    })();
    return T.loading;
  }
  async function loadTask(key) {
    const r = await api('GET', '/api/tasks/' + encodeURIComponent(key)).catch(() => null);
    const had = T.task.get(key);
    T.task.set(key, r && r.ok ? r.d.task : (had && !had.missing && r && r.status !== 404 ? had : { missing: true, error: !r || r.status !== 404 }));
    patch();
  }
  async function loadProject(id) {
    const r = await api('GET', '/api/tasks?projectId=' + encodeURIComponent(id)).catch(() => null);
    T.byProject.set(id, r && r.ok ? r.d.tasks : (Array.isArray(T.byProject.get(id)) ? T.byProject.get(id) : 'error'));
    patch();
  }
  async function people(projectId) {
    const k = projectId || 'personal';
    if (T.people.has(k)) return T.people.get(k);
    const r = await api('GET', '/api/tasks/assignees' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : '')).catch(() => null);
    const list = r && r.ok ? r.d.assignees : [];
    T.people.set(k, list); return list;
  }
  const sync = () => { if (T.area !== undefined && !T.loading && P.area() !== T.area) { T.list = null; T.status = 'loading'; load(); } };

  // ───────────────────────── local refresh
  // Only the region redraws. The comment draft, the focused field and the scroll position survive it.
  function swap(root, html) {
    if (root.__html === html) return;
    const main = document.getElementById('main'), top = main ? main.scrollTop : 0;
    const a = document.activeElement, keepId = a && root.contains(a) ? a.dataset.tkKeep : null;
    const drafts = [...root.querySelectorAll('[data-tk-keep]')].map((el) => [el.dataset.tkKeep, el.value, el.selectionStart, el.selectionEnd]);
    root.innerHTML = html; root.__html = html;
    for (const [k, v, s, e] of drafts) { const el = root.querySelector(`[data-tk-keep="${CSS.escape(k)}"]`); if (el && v) { el.value = v; if (k === keepId) { el.focus(); try { el.setSelectionRange(s, e); } catch {} } } }
    if (keepId && !drafts.some(([k, v]) => k === keepId && v)) root.querySelector(`[data-tk-keep="${CSS.escape(keepId)}"]`)?.focus();
    if (main) main.scrollTop = top;
  }
  function patch() {
    let done = false;
    for (const root of document.querySelectorAll('#main [data-tk-root]')) { swap(root, region(root.dataset.tkRoot)); done = true; }
    for (const root of document.querySelectorAll('#main [data-tk-proot]')) { swap(root, projectRegion(root.dataset.tkProot)); done = true; }
    // the path in the top bar names the open task; keep it current without redrawing the bar
    const open = document.querySelector('#main [data-tk-root^="task:"]');
    if (open) { const t = T.task.get(open.dataset.tkRoot.slice(5)); const b = document.querySelector('.crumbs b'); if (t && !t.missing && b && b.textContent !== `${t.key} · ${t.title}`) b.textContent = `${t.key} · ${t.title}`; }
    return done;
  }
  // other people's changes arrive within POLL_MS while a tasks view is on screen and the tab is visible
  let polling = false;
  async function poll() {
    if (polling || document.visibilityState !== 'visible') return;
    const roots = [...document.querySelectorAll('#main [data-tk-root], #main [data-tk-proot]')];
    if (!roots.length) return;
    polling = true;
    try {
      for (const r of roots) {
        if (r.dataset.tkProot) { await loadProject(r.dataset.tkProot); continue; }
        const v = r.dataset.tkRoot || '';
        if (v.startsWith('task:')) { const k = v.slice(5), before = T.task.get(k)?.updatedAt; const res = await api('GET', '/api/tasks/' + encodeURIComponent(k)).catch(() => null); if (res && res.ok && res.d.task.updatedAt !== before) { T.task.set(k, res.d.task); patch(); } }
        else await load();
      }
    } finally { polling = false; }
  }
  setInterval(() => { poll().catch(() => {}); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll().catch(() => {}); });

  // ───────────────────────── regions
  const where = () => (P.area() ? P.areaName(P.area()) : 'every area');
  const head = (title, sub) => H().head({ eyebrow: '<a data-tk="board">Tasks</a>', title, sub, acts: H().btn('New task', 'data-tk="new"', false, 'plus') });
  const shell = (view, title, sub) => H().page(head(title, sub) + `<div data-tk-root="${esc(view)}">${region(view)}</div>` + H().foot('tasks', 'GET /api/tasks'));
  const loadingOrError = (status, list) => (!list ? (status === 'error' ? `<p class="tk-msg" data-tk-state="error">Tasks couldn’t be loaded. <button class="pg-link" data-tk="retry">Try again</button></p>` : '<p class="tk-msg" data-tk-state="loading">Loading tasks…</p>') : null);
  const dueChip = (t) => (t.dueAt ? `<small class="tk-due${!CLOSED.includes(t.status) && Date.parse(t.dueAt) < Date.now() ? ' tk-due--late' : ''}">${ic('calendar')}${esc(new Date(t.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</small>` : '');
  function card(t) {
    const k = KIND[t.kind] || KIND.task;
    return `<div class="tk-card" role="button" tabindex="0" draggable="${t.can && t.can.moves.length ? 'true' : 'false'}" data-tk="open" data-arg="${esc(t.key)}" data-tk-card="${esc(t.key)}">
      <div class="tk-card-top"><span class="tk-kind" title="${k[1]}">${ic(k[0])}</span><small>${esc(t.key)}</small>${t.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>` : ''}<span class="tk-sp"></span><button class="tk-more" data-tk="menu" data-arg="${esc(t.key)}" aria-label="Actions for ${esc(t.key)}">${ic('more')}</button></div>
      <b class="tk-card-t">${esc(t.title)}</b>
      <div class="tk-card-f">${t.project ? `<small class="tk-chip">${esc(t.project.name)}</small>` : ''}${t.labels.slice(0, 2).map((l) => `<small class="tk-chip">${esc(l)}</small>`).join('')}${dueChip(t)}<span class="tk-sp"></span>${face(t.assignee, true)}</div></div>`;
  }
  const FILTERS = [['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['agents', 'Agents']];
  const FILTER_FN = { all: () => true, mine: (t) => t.assignee && t.assignee.id === me(), unassigned: (t) => !t.assignee, agents: (t) => t.assignee && t.assignee.kind === 'agent' };
  function boardOf(list, small) {
    return `<div class="tk-board${small ? ' tk-board--sm' : ''}" data-tk-board>${COLS.map(([k, l]) => { const cs = list.filter((t) => t.status === k);
      return `<section class="tk-col" data-tk-col="${k}"><h3><span class="tk-dot tk-dot--${k}"></span>${l}<em>${cs.length}</em></h3><div class="tk-col-b">${cs.map(card).join('') || '<p class="tk-empty">No tasks</p>'}</div></section>`; }).join('')}</div>`;
  }
  function region(view) {
    if (view.startsWith('task:')) return taskRegion(view.slice(5));
    const s = loadingOrError(T.status, T.list); if (s) return s;
    const L = T.list;
    if (view === 'board') {
      if (!L.length) return `<div class="tk-first" data-tk-state="empty"><p>No tasks in ${esc(where())} yet. Raise one for yourself, or add tasks to a project so the people and agents on it can pick them up.</p>${H().btn('New task', 'data-tk="new"', false, 'plus')}</div>`;
      return `<div class="tk-bar">${FILTERS.map(([k, l]) => `<button class="tk-tab${T.filter === k ? ' on' : ''}" data-tk="filter" data-arg="${k}" aria-pressed="${T.filter === k}">${l}<em>${L.filter(FILTER_FN[k]).length}</em></button>`).join('')}<span class="tk-sp"></span><small class="tk-dim">Drag a card to move it · right-click for more</small></div>${boardOf(L.filter(FILTER_FN[T.filter] || FILTER_FN.all))}`;
    }
    const pick = { mine: (t) => FILTER_FN.mine(t) && !CLOSED.includes(t.status), triage: (t) => t.status === 'raised', review: (t) => t.status === 'in_review' }[view] || (() => true);
    const rows = L.filter(pick);
    return rows.length ? `<div class="tk-list" data-tk-list>${rows.map((t) => `<div class="tk-row" role="button" tabindex="0" data-tk="open" data-arg="${esc(t.key)}" data-tk-rowkey="${esc(t.key)}"><span class="tk-kind">${ic((KIND[t.kind] || KIND.task)[0])}</span><small class="tk-key">${esc(t.key)}</small><b>${esc(t.title)}</b>${dueChip(t) || '<span></span>'}<span class="tk-status"><span class="tk-dot tk-dot--${esc(t.status)}"></span>${esc(LABEL[t.status])}</span>${t.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>` : '<span></span>'}${face(t.assignee, true)}<button class="tk-more" data-tk="menu" data-arg="${esc(t.key)}" aria-label="Actions for ${esc(t.key)}">${ic('more')}</button></div>`).join('')}</div>`
      : '<p class="tk-msg" data-tk-state="empty">Nothing here.</p>';
  }

  // one task: the work on the left, its facts on the right
  function activity(t) {
    // consecutive status moves by one person within ten minutes fold into one line (a timeline, not a log dump)
    const out = []; let run = null;
    for (const e of t.events || []) {
      if (e.kind === 'status' && !e.note && run && run.actor?.id === e.actor?.id && Date.parse(e.at) - Date.parse(run.last) < 600000) { run.path.push(e.to); run.last = e.at; continue; }
      if (e.kind === 'status' && !e.note) { run = { kind: 'run', actor: e.actor, path: [e.from, e.to], at: e.at, last: e.at }; out.push(run); continue; }
      run = null; out.push(e);
    }
    const who = (a) => `<b>${esc(a ? a.name : 'Someone')}</b>${a && a.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}`;
    const st = (s) => `<span class="tk-st"><span class="tk-dot tk-dot--${esc(s)}"></span>${esc(LABEL[s] || s)}</span>`;
    return out.map((e) => {
      if (e.kind === 'comment') return `<article class="tk-comment" data-tk-ev="comment">${face(e.actor, true)}<div><header>${who(e.actor)}<small>${when(e.at)}</small></header><p>${esc(e.note)}</p></div></article>`;
      const what = e.kind === 'run' ? `moved it ${e.path.map(st).join(' → ')}`
        : e.kind === 'status' ? `moved it ${st(e.from)} → ${st(e.to)}${e.note ? ` — “${esc(e.note)}”` : ''}`
        : e.kind === 'created' ? 'raised this task' : e.kind === 'claimed' ? 'took it' : e.kind === 'assigned' ? (e.to ? 'changed the assignee' : 'unassigned it')
        : e.kind === 'edited' ? `changed the ${esc(e.from || 'task')}` : e.kind === 'attached' ? `added <i>${esc(e.note || 'an image')}</i>` : e.kind === 'detached' ? `removed <i>${esc(e.note || 'an image')}</i>` : esc(e.kind);
      return `<p class="tk-ev" data-tk-ev="${esc(e.kind === 'run' ? 'status' : e.kind)}"><span class="tk-ev-dot"></span><span>${who(e.actor)} ${what}</span><small>${when(e.at)}</small></p>`;
    }).join('');
  }
  function taskRegion(key) {
    const t = T.task.get(key);
    if (!t) { loadTask(key); return '<p class="tk-msg" data-tk-state="loading">Loading the task…</p>'; }
    if (t.missing) return `<p class="tk-msg" data-tk-state="missing">${t.error ? `The task couldn’t be loaded. <button class="pg-link" data-tk="refresh" data-arg="${esc(key)}">Try again</button>` : 'This task doesn’t exist, was deleted, or belongs to someone else.'}</p>`;
    const can = t.can || { moves: [] }, k = KIND[t.kind] || KIND.task;
    const mineIt = !!(t.assignee && t.assignee.id === me()), editAny = can.edit || mineIt;
    const canClaim = !t.assignee && !CLOSED.includes(t.status);
    const acts = can.moves.map((m, i) => `<button class="tk-act${i === 0 ? ' tk-act--main' : ''}" data-tk="move" data-arg="${esc(t.key)}|${m}|${t.status}" data-tk-move="${m}">${m === 'done' ? ic('check') : ''}${esc(MOVE[m] || LABEL[m])}</button>`).join('')
      + (canClaim ? `<button class="tk-act" data-tk="claim" data-arg="${esc(t.key)}">${ic('user')}Take it</button>` : '');
    const prop = (id, label, value, editable) => `<div class="tk-prop"><span class="tk-prop-l">${label}</span>${editable ? `<button class="tk-prop-v" data-tk="prop" data-arg="${esc(t.key)}|${id}" data-tk-prop="${id}">${value}</button>` : `<span class="tk-prop-v tk-prop-v--ro">${value}</span>`}</div>`;
    const person = (p) => (p ? `${face(p, true)}<span>${esc(p.name)}</span>` : '<span class="tk-dim">None</span>');
    const imgs = t.attachments || [];
    return `<div class="tk-page">
      <div class="tk-main">
        <div class="tk-titlerow"><span class="tk-kind" title="${k[1]}">${ic(k[0])}</span><small class="tk-key">${esc(t.key)}</small><span class="tk-status" data-tk-status="${esc(t.status)}"><span class="tk-dot tk-dot--${esc(t.status)}"></span>${esc(LABEL[t.status])}</span><span class="tk-sp"></span><button class="tk-ib" data-tk="refresh" data-arg="${esc(t.key)}" title="Refresh" aria-label="Refresh">${ic('reset')}</button><button class="tk-ib" data-tk="menu" data-arg="${esc(t.key)}" title="More actions" aria-label="More actions">${ic('more')}</button></div>
        ${can.edit ? `<h2 class="tk-title tk-title--edit" role="button" tabindex="0" data-tk="rename" data-arg="${esc(t.key)}" title="Rename">${esc(t.title)}</h2>` : `<h2 class="tk-title">${esc(t.title)}</h2>`}
        ${acts ? `<div class="tk-acts" data-tk-acts>${acts}</div>` : ''}
        <section class="tk-sec">${t.body ? `<div class="tk-body${can.edit ? ' tk-body--edit' : ''}" ${can.edit ? `role="button" tabindex="0" data-tk="describe" data-arg="${esc(t.key)}" title="Edit the description"` : ''}>${esc(t.body)}</div>` : can.edit ? `<button class="tk-add" data-tk="describe" data-arg="${esc(t.key)}">Add a description…</button>` : '<p class="tk-dim">No description.</p>'}</section>
        <section class="tk-sec" data-tk-images="${esc(t.key)}"><h3>Images<em>${imgs.length}</em><span class="tk-sp"></span>${can.attach ? `<button class="tk-link" data-tk="attach" data-arg="${esc(t.key)}">${ic('upload')}Add</button>` : ''}</h3>
          ${imgs.length ? `<div class="tk-imgs">${imgs.map((a) => `<figure class="tk-img" data-tk-img="${esc(a.id)}"><a href="${imgUrl(t.key, a.id)}" target="_blank" rel="noopener" title="${esc(a.filename)}"><img src="${imgUrl(t.key, a.id)}" alt="${esc(a.filename)}" loading="lazy"></a><figcaption>${esc(a.filename)}</figcaption>${can.edit || (a.uploader && a.uploader.id === me()) ? `<button class="tk-img-x" data-tk="unattach" data-arg="${esc(t.key)}|${esc(a.id)}" aria-label="Remove ${esc(a.filename)}">${ic('x')}</button>` : ''}</figure>`).join('')}</div>` : ''}
          ${can.attach ? `<div class="tk-drop" data-tk="attach" data-arg="${esc(t.key)}" role="button" tabindex="0">${ic('image')}<span>Drop images here, paste them, or <u>choose files</u></span><small>PNG, JPEG, GIF or WebP · up to 8 MB each</small></div>` : (imgs.length ? '' : '<p class="tk-dim">No images.</p>')}</section>
        <section class="tk-sec"><h3>Activity</h3><div class="tk-activity" data-tk-history>${activity(t)}</div>
          <form class="tk-compose" data-tk-comment="${esc(t.key)}">${face({ name: (P.user && (P.user.display_name || P.user.username)) || 'Me' }, true)}<div class="tk-compose-b"><textarea rows="2" data-tk-keep="comment:${esc(t.key)}" placeholder="Leave a comment — Ctrl+Enter to send" aria-label="Comment"></textarea><div class="tk-compose-f"><small class="tk-dim">Everyone on the task sees this.</small><span class="tk-sp"></span><button class="pg-btn" type="submit">${ic('send')}<span>Comment</span></button></div></div></form></section>
      </div>
      <aside class="tk-props" aria-label="Properties">
        ${prop('status', 'Status', `<span class="tk-dot tk-dot--${esc(t.status)}"></span><span>${esc(LABEL[t.status])}</span>`, can.moves.length > 0)}
        ${prop('assignee', 'Assignee', person(t.assignee), editAny)}
        ${prop('reviewer', 'Reviewer', person(t.reviewer) + (t.reviewRequired ? '<small class="tk-req">required</small>' : ''), can.edit)}
        ${prop('priority', 'Priority', t.priority === 'none' ? '<span class="tk-dim">No priority</span>' : `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>`, editAny)}
        ${prop('kind', 'Type', `${ic(k[0])}<span>${k[1]}</span>`, editAny)}
        ${prop('due', 'Due date', t.dueAt ? `<span class="${!CLOSED.includes(t.status) && Date.parse(t.dueAt) < Date.now() ? 'tk-late' : ''}">${esc(new Date(t.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span>` : '<span class="tk-dim">None</span>', editAny)}
        ${prop('labels', 'Labels', t.labels.length ? t.labels.map((l) => `<small class="tk-chip">${esc(l)}</small>`).join('') : '<span class="tk-dim">None</span>', editAny)}
        <div class="tk-props-sep"></div>
        ${prop('project', 'Project', t.project ? esc(t.project.name) : 'Personal', false)}
        ${prop('area', 'Area', esc(t.area ? P.areaName(t.area) : 'Overview'), false)}
        ${prop('reporter', 'Reported by', person(t.reporter), false)}
        ${prop('created', 'Created', esc(when(t.createdAt)), false)}
        ${prop('updated', 'Updated', esc(when(t.updatedAt)), false)}
      </aside></div>`;
  }
  function route(it) {
    if (T.list === null && T.status !== 'error' && !T.loading) load();
    if (!it || it === 'Board') return shell('board', 'Tasks', `${where()} · raised, accepted, worked on, reviewed and done — by people and agents`);
    if (it === 'My tasks') return shell('mine', 'My tasks', 'Assigned to you and still open');
    if (it === 'Needs triage') return shell('triage', 'Needs triage', 'Raised and not yet accepted');
    if (it === 'In review') return shell('review', 'In review', 'Waiting for a reviewer');
    if (/^T-\d+$/i.test(it)) { const key = it.toUpperCase(); return H().page(head(key) + `<div data-tk-root="task:${esc(key)}">${taskRegion(key)}</div>` + H().foot('tasks:task', `GET /api/tasks/${esc(key)}`)); }
    return shell('board', 'Tasks', where());
  }
  /** A project's Tasks tab: its own board, refreshed in place. */
  function projectRegion(id) {
    const got = T.byProject.get(id);
    const top = `<div class="tk-bar">${H().btn('New task in this project', `data-tk="new" data-arg="${esc(id)}"`, false, 'plus')}<span class="tk-sp"></span><small class="tk-dim">Drag a card to move it · right-click for more</small></div>`;
    if (!got || got === 'loading') return top + '<p class="tk-msg" data-tk-state="loading">Loading tasks…</p>';
    if (got === 'error') return top + `<p class="tk-msg" data-tk-state="error">The tasks couldn’t be loaded. <button class="pg-link" data-tk="retry-project" data-arg="${esc(id)}">Try again</button></p>`;
    return top + (got.length ? boardOf(got, true) : '<p class="tk-msg" data-tk-state="empty">No tasks in this project yet.</p>');
  }
  function projectTab(rec) {
    if (!rec || !rec.id) return null;
    if (!T.byProject.has(rec.id)) { T.byProject.set(rec.id, 'loading'); loadProject(rec.id); }
    return `<div data-tk-proot="${esc(rec.id)}">${projectRegion(rec.id)}</div>`;
  }

  // ───────────────────────── actions
  const go = (item) => X().go('global', { global: 'tasks', item });
  const fresh = (t) => { if (!t || !t.key) return; T.task.set(t.key, t); for (const arr of [T.list, ...T.byProject.values()]) if (Array.isArray(arr)) { const i = arr.findIndex((x) => x.key === t.key); if (i >= 0) arr[i] = { ...arr[i], ...t }; } patch(); };
  // after any change: the task itself, then the lists it appears in — each redraws only its own region
  async function after(key, task) {
    if (task) fresh(task);
    try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {}
    await Promise.all([task ? null : loadTask(key), load(), ...[...T.byProject.keys()].map(loadProject)]);
  }
  async function newTask(projectId) {
    const here = P.area(), projects = ((window.XENO_PG_PROJECTS || {}).items || []).filter((p) => p.id && p.status !== 'archived' && (!here || p.area === here));
    const v = await D().form({ title: 'New task', sub: projectId ? 'In this project. It lands in Triage until someone accepts it.' : `In ${where()}. It lands in Triage until someone accepts it.`, submit: 'Create task', fields: [
      { id: 'title', label: 'Title', required: true, max: 300 },
      { id: 'body', label: 'Description', type: 'textarea', rows: 4, max: 50000, placeholder: 'What needs doing, and how will we know it is done?' },
      { id: 'kind', label: 'Type', type: 'seg', value: 'task', options: [['task', 'Task'], ['bug', 'Bug'], ['feature', 'Feature'], ['question', 'Question']] },
      { id: 'priority', label: 'Priority', type: 'seg', value: 'none', options: [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
      ...(projectId ? [] : [{ id: 'project', label: 'Project', type: 'choice', cols: 1, value: 'personal', options: [['personal', 'Personal — just me'], ...projects.map((p) => [p.id, p.realName || p.name])] }])] });
    if (!v) return;
    const pid = projectId || (v.project && v.project !== 'personal' ? v.project : null);
    const r = await api('POST', '/api/tasks', { title: v.title.trim(), body: v.body || '', kind: v.kind, priority: v.priority, ...(pid ? { projectId: pid } : { area: here }) }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The task couldn’t be created. Nothing was saved.'));
    T.task.set(r.d.task.key, r.d.task);
    if (projectId) { await loadProject(projectId); load(); toast(`Created ${r.d.task.key}`); return; }   // stay on the project; its board shows it
    await load(); go(r.d.task.key); toast(`Created ${r.d.task.key}`);
  }
  async function patchTask(key, body, ok) {
    const r = await api('PATCH', `/api/tasks/${encodeURIComponent(key)}`, body).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That couldn’t be saved. The task is as it was.')); return loadTask(key); }
    await after(key, r.d.task); if (ok) toast(ok);
  }
  async function move(key, to, from) {
    let note;
    if (to === 'blocked' || to === 'wont_do') { const v = await D().form({ title: to === 'blocked' ? 'What is it waiting on?' : 'Why won’t it be done?', submit: LABEL[to], size: 'sm', fields: [{ id: 'note', label: 'Note', type: 'textarea', rows: 3, max: 2000 }] }); if (!v) return; note = v.note || undefined; }
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/transition`, { to, from, note }).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That move couldn’t be made.')); return after(key); }
    await after(key, r.d.task); toast(`${key} → ${LABEL[to]}`);
  }
  async function claim(key) {
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/claim`).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'It couldn’t be taken.')); return after(key); }
    await after(key, r.d.task); toast(`You took ${key}`);
  }
  async function remove(key) {
    const t = findTask(key);
    const ok = await D().confirm({ title: `Delete ${key}?`, body: `<b>${esc(t ? t.title : key)}</b> disappears from every board. Its history is kept for audit, and its key is never reused.`, action: 'Delete task' });
    if (!ok) return;
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted.'));
    T.task.delete(key); if (T.list) T.list = T.list.filter((x) => x.key !== key);
    for (const [id, arr] of T.byProject) if (Array.isArray(arr)) T.byProject.set(id, arr.filter((x) => x.key !== key));
    if (document.querySelector(`#main [data-tk-root="task:${CSS.escape(key)}"]`)) go(null); else patch();
    try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {}
    toast(`Deleted ${key}`);
  }
  async function rename(key) {
    const t = findTask(key); if (!t) return;
    const v = await D().form({ title: `Rename ${key}`, submit: 'Save', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 300, value: t.title }] });
    if (v && v.title.trim() !== t.title) patchTask(key, { title: v.title.trim() }, 'Renamed');
  }
  async function describe(key) {
    const t = findTask(key); if (!t) return;
    const v = await D().form({ title: `Description of ${key}`, submit: 'Save', fields: [{ id: 'body', label: 'Description', type: 'textarea', rows: 10, max: 50000, value: t.body || '', placeholder: 'What needs doing, how to check it is done, links…' }] });
    if (v && (v.body || '') !== (t.body || '')) patchTask(key, { body: v.body || '' }, 'Description saved');
  }
  async function labels(key) {
    const t = findTask(key); if (!t) return;
    const v = await D().form({ title: `Labels on ${key}`, submit: 'Save', size: 'sm', fields: [{ id: 'labels', label: 'Labels', type: 'chips', value: t.labels || [], placeholder: 'Type a label, Enter to add' }] });
    if (v) patchTask(key, { labels: v.labels || [] }, 'Labels saved');
  }
  async function pickDate(key) {
    const t = findTask(key);
    const v = await D().form({ title: `Due date for ${key}`, submit: 'Set', size: 'sm', fields: [{ id: 'd', label: 'Date (YYYY-MM-DD)', required: true, max: 10, value: t && t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : '', placeholder: '2026-12-31' }] });
    if (!v) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.d) || Number.isNaN(Date.parse(v.d))) return toast('Use a date like 2026-12-31');
    patchTask(key, { dueAt: new Date(v.d + 'T17:00:00').toISOString() }, 'Due date set');
  }
  async function uploadFiles(key, files) {
    const imgs = [...files].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!imgs.length) return toast('Only PNG, JPEG, GIF and WebP images can be added');
    const ok = imgs.filter((f) => f.size <= 8 * 1024 * 1024), big = imgs.length - ok.length;
    if (big) toast(`${big} image${big > 1 ? 's are' : ' is'} over 8 MB and ${big > 1 ? 'were' : 'was'} skipped`);
    if (!ok.length) return;
    toast(ok.length > 1 ? `Uploading ${ok.length} images…` : 'Uploading the image…');
    let last = null, failed = 0;
    for (const f of ok) {
      const headers = { 'content-type': 'application/octet-stream', 'x-xeno-surface': 'xeno-web' }; const c = P.csrf && P.csrf(); if (c) headers['x-xeno-csrf'] = c;
      const name = f.name && f.name !== 'image.png' ? f.name : `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${f.type.split('/')[1]}`;
      const res = await fetch(`/api/tasks/${encodeURIComponent(key)}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', credentials: 'same-origin', headers, body: f }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok && d.task) last = d.task; else { failed++; toast(d.error || 'An image couldn’t be added.'); }
    }
    if (last) { await after(key, last); toast(failed ? `Added; ${failed} failed` : ok.length > 1 ? 'Images added' : 'Image added'); }
  }
  function chooseFiles(key) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp'; inp.multiple = true; inp.onchange = () => uploadFiles(key, inp.files); inp.click(); }
  async function unattach(key, id) {
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}/attachments/${encodeURIComponent(id)}`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.'));
    await after(key, r.d.task); toast('Image removed');
  }

  // ───────────────────────── menus (one model for right-click, the ⋯ button and the property rows)
  function assignItems(t, field) {
    const cached = T.people.get(pkey(t)), current = t[field] ? t[field].id : null;
    const set = (id) => (field === 'assignee' ? patchTask(t.key, { assigneeId: id }, id ? 'Assigned' : 'Unassigned') : patchTask(t.key, { reviewerId: id, reviewRequired: !!id }, id ? 'Reviewer set' : 'Review removed'));
    if (!cached) { people(t.project ? t.project.id : null); return [{ label: 'Loading people…', disabled: 'Loading' }]; }
    const mineIt = t.assignee && t.assignee.id === me();
    // the assignee alone (not a manager) may only let go of the task
    if (field === 'assignee' && !(t.can && t.can.edit)) return mineIt ? [{ label: 'Unassign me', icon: 'x', run: () => set(null) }] : [];
    const list = cached.filter((p) => !(field === 'reviewer' && t.assignee && p.id === t.assignee.id));
    return [{ label: field === 'assignee' ? 'Unassigned' : 'No review', icon: 'x', checked: !current, run: () => set(null) },
      ...list.map((p) => ({ label: p.name + (p.me ? ' (me)' : '') + (p.kind === 'agent' ? ' · agent' : ''), icon: p.kind === 'agent' ? 'bot' : 'user', checked: p.id === current, ...(p.needsShare ? { disabled: 'Share the project with this agent first' } : { run: () => set(p.id) }) }))];
  }
  function menuFor(key) {
    const t = findTask(key); if (!t) return [[{ label: 'Open', icon: 'open', run: () => go(key) }]];
    const can = t.can || { moves: [] }, H2 = window.XCM.H, hash = `#/${P.area() || 'overview'}/g/tasks/${key}`;
    const mineIt = !!(t.assignee && t.assignee.id === me()), editAny = can.edit || mineIt;
    if (!T.people.has(pkey(t))) people(t.project ? t.project.id : null);
    return [
      [{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: () => go(key) }, { label: 'Open in new window', icon: 'hub', run: () => H2.openWindow(hash) }],
      [!t.assignee && !CLOSED.includes(t.status) ? { label: 'Take it', icon: 'user', run: () => claim(key) } : null,
        can.moves.length ? { label: 'Move to', icon: 'flow', sub: can.moves.map((m) => ({ label: LABEL[m], run: () => move(key, m, t.status) })) } : { label: 'Move to', icon: 'flow', disabled: 'You can’t move this task' },
        editAny ? { label: 'Assign to', icon: 'people', sub: assignItems(t, 'assignee') } : { label: 'Assign to', icon: 'people', disabled: 'Only someone who manages the project can assign it' },
        can.edit ? { label: 'Reviewer', icon: 'check', sub: assignItems(t, 'reviewer') } : { label: 'Reviewer', icon: 'check', disabled: 'Only someone who manages the project can set the review' },
        editAny ? { label: 'Priority', icon: 'up', sub: PRI_ORDER.map((p) => ({ label: PRI[p], checked: t.priority === p, run: () => patchTask(key, { priority: p }, 'Priority set') })) } : { label: 'Priority', icon: 'up', disabled: 'Only the assignee or a manager can change it' }],
      [can.edit ? { label: 'Rename', icon: 'edit', key: 'F2', kbd: 'F2', run: () => rename(key) } : { label: 'Rename', icon: 'edit', disabled: 'Only someone who manages the project can rename it' },
        can.attach ? { label: 'Add images…', icon: 'image', run: () => chooseFiles(key) } : null,
        { label: 'Refresh', icon: 'reset', run: () => { T.task.delete(key); loadTask(key); load(); } }],
      [{ label: 'Copy link', icon: 'share', run: () => H2.copyLink(hash) }, { label: 'Copy key', icon: 'hash', run: () => H2.copy(key, 'Key copied') }],
      [can.delete ? { label: 'Delete task', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => remove(key) } : { label: 'Delete task', icon: 'trash', danger: true, disabled: 'Only a project admin, or the reporter while it is in Triage, can delete it' }],
    ];
  }
  if (window.XCM) window.XCM.register({ id: 'tasks', priority: 5, sel: '[data-tk-card], [data-tk-rowkey], [data-tk-root^="task:"]', build: (n) => menuFor(n.dataset.tkCard || n.dataset.tkRowkey || n.dataset.tkRoot.slice(5)) });
  function propMenu(key, field, anchor) {
    const t = findTask(key); if (!t || !window.XCM) return;
    const r = anchor.getBoundingClientRect(), at = { x: r.left, y: r.bottom + 4, opener: anchor };
    const end = (d) => { const x = new Date(Date.now() + d * 86400000); x.setHours(17, 0, 0, 0); return x.toISOString(); };
    const needPeople = () => { if (T.people.has(pkey(t))) return false; people(t.project ? t.project.id : null).then(() => { if (document.body.contains(anchor)) propMenu(key, field, anchor); }); return true; };
    const S = {
      status: () => [t.can.moves.map((m) => ({ label: LABEL[m], run: () => move(key, m, t.status) }))],
      assignee: () => (needPeople() ? [[{ label: 'Loading people…', disabled: 'Loading' }]] : [assignItems(t, 'assignee')]),
      reviewer: () => (needPeople() ? [[{ label: 'Loading people…', disabled: 'Loading' }]] : [assignItems(t, 'reviewer')]),
      priority: () => [PRI_ORDER.map((p) => ({ label: PRI[p], checked: t.priority === p, run: () => patchTask(key, { priority: p }, 'Priority set') }))],
      kind: () => [Object.entries(KIND).map(([k, [icon, l]]) => ({ label: l, icon, checked: t.kind === k, run: () => patchTask(key, { kind: k }, 'Type set') }))],
      due: () => [[{ label: 'Today', run: () => patchTask(key, { dueAt: end(0) }, 'Due today') }, { label: 'Tomorrow', run: () => patchTask(key, { dueAt: end(1) }, 'Due tomorrow') }, { label: 'In a week', run: () => patchTask(key, { dueAt: end(7) }, 'Due in a week') }, { label: 'In two weeks', run: () => patchTask(key, { dueAt: end(14) }, 'Due in two weeks') }],
        [{ label: 'Pick a date…', icon: 'calendar', run: () => pickDate(key) }, ...(t.dueAt ? [{ label: 'Clear', icon: 'x', run: () => patchTask(key, { dueAt: null }, 'Due date cleared') }] : [])]],
      labels: () => { labels(key); return null; },
    };
    const s = S[field] && S[field](); if (s && s.flat().length) window.XCM.show(s, at);
  }

  // ───────────────────────── events
  const ACT = {
    board: () => go(null), retry: () => { T.status = 'loading'; patch(); load(); }, 'retry-project': (id) => { T.byProject.set(id, 'loading'); patch(); loadProject(id); },
    open: (k) => go(k), new: (pid) => newTask(pid), rename, describe, claim, attach: (k) => chooseFiles(k),
    filter: (k) => { T.filter = k; patch(); },
    refresh: (k) => { T.task.delete(k); patch(); loadTask(k); },
    menu: (k, el) => { const r = el.getBoundingClientRect(); window.XCM?.show(menuFor(k), { x: r.left, y: r.bottom + 4, opener: el }); },
    prop: (arg, el) => { const [k, f] = arg.split('|'); propMenu(k, f, el); },
    move: (arg) => { const [k, to, from] = arg.split('|'); return move(k, to, from); },
    unattach: (arg) => { const [k, id] = arg.split('|'); return unattach(k, id); },
  };
  addEventListener('click', (e) => {
    if (e.button !== 0 || e.target.closest('.xd, .xcm')) return;
    // an image link opens the image; a button inside a card (⋯, remove) wins over the card
    if (e.target.closest('.tk-img a')) return;
    const el = e.target.closest('[data-tk="menu"], [data-tk="unattach"]') || e.target.closest('[data-tk]'); if (!el) return;
    const k = el.dataset.tk; if (!ACT[k]) return;
    e.preventDefault(); e.stopImmediatePropagation();
    Promise.resolve(ACT[k](el.dataset.arg, el)).catch(() => toast('Something went wrong. Nothing changed.'));
  }, true);
  addEventListener('keydown', (e) => {
    const ta = e.target.closest?.('[data-tk-comment] textarea');
    if (ta && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.form.requestSubmit(); return; }
    const el = e.target.closest?.('[data-tk][role="button"]');
    if (el && el === e.target && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
  }, true);
  addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-tk-comment]'); if (!f) return; e.preventDefault(); e.stopImmediatePropagation();
    const ta = f.querySelector('textarea'), body = ta.value.trim(), key = f.dataset.tkComment; if (!body) { ta.focus(); return toast('Write something first'); }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/comments`, { body }).catch(() => null);
    btn.disabled = false;
    if (!r || !r.ok) return toast(said(r, 'The comment couldn’t be sent. Your words are still in the box.'));
    ta.value = ''; await after(key, r.d.task);
  }, true);
  // images: paste anywhere on a task's page, or drop onto it; cards: drag between columns
  const openKey = () => { const r = document.querySelector('#main [data-tk-root^="task:"]'); const t = r && T.task.get(r.dataset.tkRoot.slice(5)); return t && !t.missing && t.can && t.can.attach ? t.key : null; };
  addEventListener('paste', (e) => {
    const key = openKey(); if (!key) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault(); uploadFiles(key, files);
  });
  const clearOver = () => document.querySelectorAll('.tk-col.over').forEach((c) => c.classList.remove('over'));
  addEventListener('dragover', (e) => {
    if (document.querySelector('[data-tk-dragging]')) { const col = e.target.closest?.('[data-tk-col]'); if (col) { e.preventDefault(); if (!col.classList.contains('over')) { clearOver(); col.classList.add('over'); } } return; }
    if (openKey() && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.querySelector('#main .tk-page')?.classList.add('tk-page--drop'); }
  });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget || !document.getElementById('main')?.contains(e.relatedTarget)) { document.querySelector('#main .tk-page')?.classList.remove('tk-page--drop'); clearOver(); } });
  addEventListener('drop', (e) => {
    document.querySelector('#main .tk-page')?.classList.remove('tk-page--drop');
    const card = document.querySelector('[data-tk-dragging]');
    if (card) {
      e.preventDefault(); clearOver();
      const col = e.target.closest?.('[data-tk-col]'), key = card.dataset.tkCard, t = findTask(key);
      if (!col || !t || col.dataset.tkCol === t.status) return;
      if (!(t.can && t.can.moves.includes(col.dataset.tkCol))) return toast(t.can && t.can.moves.length ? `${key} can’t go from ${LABEL[t.status]} to ${LABEL[col.dataset.tkCol]}` : `You can’t move ${key}`);
      move(key, col.dataset.tkCol, t.status); return;
    }
    const key = openKey(); if (!key || !e.dataTransfer?.files?.length) return;
    e.preventDefault(); uploadFiles(key, e.dataTransfer.files);
  });
  addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-tk-card]'); if (!c) return; c.setAttribute('data-tk-dragging', ''); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.tkCard); });
  addEventListener('dragend', (e) => { e.target.closest?.('[data-tk-card]')?.removeAttribute('data-tk-dragging'); clearOver(); });

  const label = (x) => { const t = findTask(x); return t && !t.missing ? `${t.key} · ${t.title}` : x; };
  window.XENO_TASKS = { served: true, label, route, projectTab, load, sync, patch, poll, newTask, state: () => ({ status: T.status, area: T.area === undefined ? undefined : T.area, count: (T.list || []).length }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
