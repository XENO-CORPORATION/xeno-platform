/* platform-tasks.js — XENO Tasks (codename Telos) in the workspace. Product spec: XENO-CORPORATION/xeno-tasks.
 *
 * One page, in every area and on Overview (#/<area>/g/tasks, #/overview/g/tasks):
 *   Board          the tasks of this area (Overview: all), one column per status
 *   My tasks       assigned to you
 *   Needs triage   raised and not yet accepted
 *   In review      waiting for a reviewer
 *   T-123          one task: its moves, claim, assignment, review, history and comments
 * and a project's Tasks tab (XENO_TASKS.projectTab), which lists that project's tasks.
 *
 * Every action is /api/tasks; the platform decides who may do what and the page only offers what it allows (the
 * `can.moves` a task comes with). A move carries the status the screen showed, so a stale screen cannot overwrite a
 * newer state.
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
  const KIND_IC = { task: 'check', bug: 'flag', feature: 'megaphone', question: 'chat' };
  const PRI = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: '' };
  const T = { list: null, area: undefined, loading: null, task: new Map(), status: 'loading' };
  const me = () => (P.user ? String(P.user.id) : '');

  const repaint = () => { try { if (X()?.S?.view === 'global' && X().S.global === 'tasks') X().render(); else X()?.refreshPanel?.(); } catch {} };
  function load() {
    const here = P.area();
    if (T.loading && T.loadingFor === here) return T.loading;
    T.loadingFor = here;
    T.loading = (async () => {
      const r = await api('GET', '/api/tasks' + (here ? '?area=' + encodeURIComponent(here) : '')).catch(() => null);
      if (here !== P.area()) { T.loading = null; return load(); }
      T.area = here; T.list = r && r.ok && Array.isArray(r.d.tasks) ? r.d.tasks : null; T.status = T.list ? 'ready' : 'error'; T.loading = null; repaint();
    })();
    return T.loading;
  }
  async function loadTask(key) { const r = await api('GET', '/api/tasks/' + encodeURIComponent(key)).catch(() => null); T.task.set(key, r && r.ok ? r.d.task : { missing: true, error: !r || r.status !== 404 }); repaint(); }
  const sync = () => { if (T.area !== undefined && !T.loading && P.area() !== T.area) { T.list = null; load(); } };

  // ---------- pages ----------
  const where = () => (P.area() ? P.areaName(P.area()) : 'every area');
  const head = (title, sub) => H().head({ eyebrow: '<a data-tk="board">Tasks</a>', title, sub, acts: H().btn('New task', 'data-tk="new"', false, 'plus') });
  const card = (t) => `<button class="tk-card" data-tk="open" data-arg="${esc(t.key)}" data-tk-card="${esc(t.key)}"><span class="tk-card-h"><small>${esc(t.key)}</small>${PRI[t.priority] ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>` : ''}</span><b>${esc(t.title)}</b>
    <span class="tk-card-f">${ic(KIND_IC[t.kind] || 'check')}${t.project ? `<small>${esc(t.project.name)}</small>` : ''}${t.assignee ? `<small class="tk-who">${t.assignee.kind === 'agent' ? ic('bot') : ''}${esc(t.assignee.name)}</small>` : '<small class="tk-dim">Unassigned</small>'}</span></button>`;
  const state = () => (T.status === 'loading' || !T.list ? (T.status === 'error' ? `<p class="pg-dim" data-tk-state="error">Your tasks couldn’t be loaded. <button class="pg-link" data-tk="retry">Try again</button></p>` : '<p class="pg-dim" data-tk-state="loading">Loading tasks…</p>') : null);
  function board() {
    const s = state(); const L = T.list || [];
    const body = s || (L.length ? `<div class="tk-board" data-tk-board>${COLS.map(([k, l]) => { const cs = L.filter((t) => t.status === k); return `<section class="tk-col" data-tk-col="${k}"><h3>${l}<em>${cs.length}</em></h3>${cs.map(card).join('') || '<p class="tk-empty">—</p>'}</section>`; }).join('')}</div>`
      : `<div class="tk-first" data-tk-state="empty"><p>No tasks in ${esc(where())} yet. Raise one for yourself, or add tasks to a project so the people and agents on it can pick them up.</p>${H().btn('New task', 'data-tk="new"', false, 'plus')}</div>`);
    return H().page(head('Tasks', `${where()} · raised, accepted, worked on, reviewed and done — by people and agents`) + body + H().foot('tasks', 'GET /api/tasks'));
  }
  function list(title, sub, filter) {
    const s = state(), L = (T.list || []).filter(filter);
    return H().page(head(title, sub) + (s || (L.length ? `<div class="tk-list" data-tk-list>${L.map((t) => `<button class="tk-row" data-tk="open" data-arg="${esc(t.key)}"><small>${esc(t.key)}</small><b>${esc(t.title)}</b><span class="pg-chip">${esc(LABEL[t.status])}</span>${t.assignee ? `<small>${esc(t.assignee.name)}</small>` : '<small class="tk-dim">Unassigned</small>'}</button>`).join('')}</div>` : `<p class="pg-dim" data-tk-state="empty">Nothing here.</p>`)) + H().foot('tasks', 'GET /api/tasks'));
  }
  function taskPage(key) {
    const t = T.task.get(key);
    if (!t) { loadTask(key); return H().page(head('Loading the task') + '<p class="pg-dim" data-tk-state="loading">Loading…</p>'); }
    if (t.missing) return H().page(head('Task not found') + `<p class="pg-dim" data-tk-state="missing">${t.error ? 'The task couldn’t be loaded. Try again in a moment.' : 'It may belong to someone else, or the link is wrong.'}</p>`);
    const h = H(), moves = (t.can && t.can.moves) || [], canClaim = !t.assignee && !['done', 'wont_do'].includes(t.status);
    const acts = [...moves.map((m) => h.btn(MOVE[m] || LABEL[m], `data-tk="move" data-arg="${esc(t.key)}|${m}|${t.status}" data-tk-move="${m}"`, m !== moves[0], m === 'done' ? 'check' : '')), canClaim ? h.btn('Take it', `data-tk="claim" data-arg="${esc(t.key)}"`, true, 'user') : '', t.can && t.can.edit ? h.btn('Edit', `data-tk="edit" data-arg="${esc(t.key)}"`, true, 'edit') : ''].join('');
    const field = (k, v) => `<div class="tk-f"><small>${k}</small><span>${v}</span></div>`;
    const who = (p) => (p ? `${p.kind === 'agent' ? ic('bot') : ''}${esc(p.name)}` : '<span class="tk-dim">—</span>');
    const when = (iso) => { const a = h.ago(iso); return a === 'just now' ? a : a + ' ago'; };
    const ev = (e) => { const a = e.actor ? `<b>${esc(e.actor.name)}</b>${e.actor.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}` : '<b>Someone</b>';
      const what = e.kind === 'created' ? 'raised this task' : e.kind === 'status' ? `moved it ${esc(LABEL[e.from] || e.from)} → <b>${esc(LABEL[e.to] || e.to)}</b>` : e.kind === 'claimed' ? 'took it' : e.kind === 'assigned' ? (e.to ? 'assigned it' : 'unassigned it') : e.kind === 'edited' ? `changed the ${esc(e.from || 'task')}` : '';
      return e.kind === 'comment' ? `<article class="pg-post" data-tk-ev="comment"><div><header>${a}<small>${when(e.at)}</small></header><p>${esc(e.note)}</p></div></article>`
        : `<p class="tk-ev" data-tk-ev="${esc(e.kind)}">${a} ${what}${e.note ? ` — “${esc(e.note)}”` : ''} <small>${when(e.at)}</small></p>`; };
    return h.page(h.head({ obj: true, eyebrow: `<a data-tk="board">Tasks</a> · ${esc(t.key)}`, title: t.title, sub: `${LABEL[t.status]} · ${t.kind}${t.priority !== 'none' ? ' · ' + PRI[t.priority] : ''}`, acts })
      + `<div class="pg-cols"><div><section class="pg-sec"><p class="tk-status" data-tk-status="${esc(t.status)}">${ic(KIND_IC[t.kind] || 'check')}<b>${esc(LABEL[t.status])}</b></p>${t.body ? `<p class="tk-body">${esc(t.body)}</p>` : '<p class="pg-dim">No description.</p>'}</section>
        <section class="pg-sec"><h3>History</h3><div class="tk-history" data-tk-history>${(t.events || []).map(ev).join('')}</div>
        <form class="pg-reply" data-tk-comment="${esc(t.key)}"><textarea rows="3" placeholder="Comment, or note what you did" aria-label="Comment"></textarea><div><span class="pg-dim">Everyone on the task sees this.</span><button class="pg-btn" type="submit">${ic('send')}<span>Comment</span></button></div></form></section></div>
      <aside class="pg-sec pg-card-s tk-side">${field('Status', esc(LABEL[t.status]))}${field('Assignee', who(t.assignee))}${field('Reviewer', who(t.reviewer) + (t.reviewRequired ? ' <small>(required)</small>' : ''))}${field('Reported by', who(t.reporter))}${field('Priority', esc(PRI[t.priority] || 'None'))}${field('Project', t.project ? esc(t.project.name) : 'Personal')}${field('Area', esc(t.area ? P.areaName(t.area) : 'Overview'))}${t.labels.length ? field('Labels', t.labels.map(esc).join(', ')) : ''}${t.dueAt ? field('Due', esc(new Date(t.dueAt).toLocaleDateString())) : ''}</aside></div>`
      + h.foot('tasks:task', `GET /api/tasks/${esc(t.key)}`));
  }
  function route(it) {
    if (T.list === null && T.status !== 'error') load();
    if (!it || it === 'Board') return board();
    if (it === 'My tasks') return list('My tasks', 'Assigned to you', (t) => t.assignee && t.assignee.id === me() && !['done', 'wont_do'].includes(t.status));
    if (it === 'Needs triage') return list('Needs triage', 'Raised and not yet accepted', (t) => t.status === 'raised');
    if (it === 'In review') return list('In review', 'Waiting for a reviewer', (t) => t.status === 'in_review');
    if (/^T-\d+$/i.test(it)) return taskPage(it.toUpperCase());
    return board();
  }
  /** A project's Tasks tab. */
  function projectTab(rec) {
    if (!rec || !rec.id) return null;
    if (!T.byProject) T.byProject = new Map();
    const got = T.byProject.get(rec.id);
    if (!got) { T.byProject.set(rec.id, 'loading'); api('GET', '/api/tasks?projectId=' + encodeURIComponent(rec.id)).catch(() => null).then((r) => { T.byProject.set(rec.id, r && r.ok ? r.d.tasks : 'error'); try { X().render(); } catch {} }); }
    const L = Array.isArray(got) ? got : [];
    const top = `<div class="pg-bar">${H().btn('New task in this project', `data-tk="new" data-arg="${esc(rec.id)}"`, false, 'plus')}</div>`;
    if (got === 'loading' || !got) return top + '<p class="pg-dim" data-tk-state="loading">Loading tasks…</p>';
    if (got === 'error') return top + '<p class="pg-dim" data-tk-state="error">The tasks couldn’t be loaded.</p>';
    return top + (L.length ? `<div class="tk-board tk-board--sm" data-tk-board>${COLS.map(([k, l]) => { const cs = L.filter((t) => t.status === k); return `<section class="tk-col" data-tk-col="${k}"><h3>${l}<em>${cs.length}</em></h3>${cs.map(card).join('') || '<p class="tk-empty">—</p>'}</section>`; }).join('')}</div>` : '<p class="pg-dim" data-tk-state="empty">No tasks in this project yet.</p>');
  }

  // ---------- actions ----------
  const go = (item) => X().go('global', { global: 'tasks', item });
  const after = async (key) => { T.task.delete(key); T.byProject = null; try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {} await Promise.all([loadTask(key), load()]); };
  async function newTask(projectId) {
    const here = P.area(), projects = ((window.XENO_PG_PROJECTS || {}).items || []).filter((p) => p.id && p.status !== 'archived' && (!here || p.area === here));
    const v = await D().form({ title: 'New task', sub: projectId ? 'In this project. It lands in Triage until someone accepts it.' : `In ${where()}. It lands in Triage until someone accepts it.`, submit: 'Raise', fields: [
      { id: 'title', label: 'Title', required: true, max: 300 },
      { id: 'body', label: 'Details', type: 'textarea', rows: 4, max: 50000, placeholder: 'What needs doing, and how will we know it is done?' },
      { id: 'kind', label: 'Kind', type: 'seg', value: 'task', options: [['task', 'Task'], ['bug', 'Bug'], ['feature', 'Feature'], ['question', 'Question']] },
      { id: 'priority', label: 'Priority', type: 'seg', value: 'none', options: [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
      ...(projectId ? [] : [{ id: 'project', label: 'Project', type: 'choice', cols: 1, value: 'personal', options: [['personal', 'Personal — just me'], ...projects.map((p) => [p.id, p.realName || p.name])] }])] });
    if (!v) return;
    const pid = projectId || (v.project && v.project !== 'personal' ? v.project : null);
    const r = await api('POST', '/api/tasks', { title: v.title.trim(), body: v.body || '', kind: v.kind, priority: v.priority, ...(pid ? { projectId: pid } : { area: here }) }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The task couldn’t be raised. Nothing was saved.'));
    T.byProject = null; await load(); go(r.d.task.key); toast(`Raised ${r.d.task.key}`);
  }
  async function editTask(key) {
    const t = T.task.get(key); if (!t || t.missing) return;
    let people = [];
    if (t.project) { const r = await api('GET', `/api/chat/projects/${encodeURIComponent(t.project.id)}/access`).catch(() => null); people = r && r.ok ? (r.d.grants || []).filter((g) => String(g.subject || '').startsWith('user:')).map((g) => [g.subject.slice(5), (g.identity && (g.identity.display_name || g.identity.username || g.identity.email)) || 'Someone']) : []; }
    if (!people.some(([id]) => id === me())) people.unshift([me(), 'Me']);
    const uniq = []; for (const p of people) if (!uniq.some(([id]) => id === p[0])) uniq.push(p);
    const v = await D().form({ title: `Edit ${t.key}`, submit: 'Save', fields: [
      { id: 'title', label: 'Title', required: true, max: 300, value: t.title },
      { id: 'body', label: 'Details', type: 'textarea', rows: 4, max: 50000, value: t.body },
      { id: 'priority', label: 'Priority', type: 'seg', value: t.priority, options: [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
      { id: 'assignee', label: 'Assignee', type: 'choice', cols: 1, value: t.assignee ? t.assignee.id : 'none', options: [['none', 'Unassigned'], ...uniq] },
      { id: 'reviewer', label: 'Reviewer (accepts it when done)', type: 'choice', cols: 1, value: t.reviewer ? t.reviewer.id : 'none', options: [['none', 'No review'], ...uniq] }] });
    if (!v) return;
    const body = { title: v.title.trim(), body: v.body || '', priority: v.priority };
    if ((t.assignee ? t.assignee.id : 'none') !== v.assignee) body.assigneeId = v.assignee === 'none' ? null : v.assignee;
    if ((t.reviewer ? t.reviewer.id : 'none') !== v.reviewer) { body.reviewerId = v.reviewer === 'none' ? null : v.reviewer; body.reviewRequired = v.reviewer !== 'none'; }
    const r = await api('PATCH', `/api/tasks/${encodeURIComponent(key)}`, body).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The task couldn’t be saved. It is as it was.'));
    await after(key); toast('Saved');
  }
  const ACT = {
    board: () => go(null), retry: () => { T.status = 'loading'; load(); repaint(); }, open: (k) => go(k), new: (pid) => newTask(pid), edit: (k) => editTask(k),
    async move(arg) { const [key, to, from] = arg.split('|');
      let note; if (to === 'blocked' || to === 'wont_do') { const v = await D().form({ title: to === 'blocked' ? 'What is it waiting on?' : 'Why won’t it be done?', submit: LABEL[to], size: 'sm', fields: [{ id: 'note', label: 'Note', type: 'textarea', rows: 3, max: 2000 }] }); if (!v) return; note = v.note || undefined; }
      const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/transition`, { to, from, note }).catch(() => null);
      if (!r || !r.ok) { toast(said(r, 'That couldn’t be done.')); return after(key); } await after(key); toast(`${key} → ${LABEL[to]}`); },
    async claim(key) { const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/claim`).catch(() => null);
      if (!r || !r.ok) { toast(said(r, 'It couldn’t be taken.')); return after(key); } await after(key); toast(`You took ${key}`); },
  };
  addEventListener('click', (e) => { const t = e.target.closest('[data-tk]'); if (!t || t.closest('.xd')) return; const k = t.dataset.tk; if (!ACT[k]) return; e.preventDefault(); e.stopImmediatePropagation(); Promise.resolve(ACT[k](t.dataset.arg)).catch(() => toast('Something went wrong. Nothing changed.')); }, true);
  addEventListener('submit', async (e) => { const f = e.target.closest('[data-tk-comment]'); if (!f) return; e.preventDefault(); e.stopImmediatePropagation();
    const ta = f.querySelector('textarea'), body = ta.value.trim(), key = f.dataset.tkComment; if (!body) { ta.focus(); return toast('Write something first'); }
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/comments`, { body }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The comment couldn’t be sent. Your words are still in the box.')); ta.value = ''; await after(key); toast('Comment added'); }, true);

  const label = (x) => { const t = T.task.get(x) || (T.list || []).find((k) => k.key === x); return t && !t.missing ? `${t.key} · ${t.title}` : x; };
  window.XENO_TASKS = { served: true, label, route, projectTab, load, sync, newTask, state: () => ({ status: T.status, area: T.area === undefined ? undefined : T.area, count: (T.list || []).length }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
