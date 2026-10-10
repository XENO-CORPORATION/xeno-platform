/* XENO_SCOPE and XENO_WORK — workspaces and projects on the real platform API.
 * From disk this does nothing and the workspace keeps its sample data. Served by the platform it:
 *   1. replaces the sample workspace list with the workspaces the signed-in person belongs to;
 *   2. replaces the sample projects with every project that person can see, each carrying the platform's id
 *      and the place it lives (Personal, or a workspace);
 *   3. sends create, rename, change icon and archive to the API, and creates new projects in the current workspace;
 *   4. shows "not available yet" for the project tabs the platform has no API for.
 *
 * SCOPES. A project lives in exactly one place: a person (Personal) or a workspace. The list here is GLOBAL: it is
 * everything the person can see, across those places, and each row says where it lives. A division is not a place
 * a project can be stored in yet: the platform has a divisions table and no route (see
 * orchestrator/briefs/2026-10-08-workspace-scopes-for-projects-and-library.md).
 *
 * IDENTITY. Every record keeps the platform id, and every request uses it. The workspace still looks a project up
 * by its name, so two projects with one name are told apart by where they live. Limit, with its exit: addresses
 * carry the name, so a rename changes the address; the exit is to route by id when the pages move onto the framework.
 *
 * Routes: GET+POST /api/workspaces · GET+POST /api/chat/projects · PUT /api/chat/projects/:id
 *   · GET /api/chat/conversations (to list a project's conversations)
 *   · GET /api/chat/projects/:id/access · PUT …/access/user/by-email · PUT+DELETE …/access/user/:id (sharing)
 *   · DELETE /api/chat/projects/:id/permanent (an archived, empty project, for good). */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SCOPE = { served: false }; window.XENO_WORK = { served: false, projectTab: () => null, blocked: () => false }; return; }
  const X = () => window.XW, api = P.api;
  const AREA_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;
  const area = () => P.area(), areaName = (id) => P.areaName(id), areas = () => P.areas();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const readJson = (raw, d) => { try { return JSON.parse(raw || 'null') ?? d; } catch { return d; } };
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.applyWorkspace?.(); X()?.refreshPanel?.(); X()?.render?.(); } catch {} };
  const pstate = (fam, v) => { const m = LS.get('pgState', {}) || {}; m[fam] = v; LS.set('pgState', m); };
  const fail = (r, fallback) => ({ ok: false, code: r.status === 403 ? 'forbidden' : 'invalid', msg: (r.d && typeof r.d.error === 'string' && r.d.error) || fallback, final: r.status >= 400 && r.status < 500 });

  // ================= workspaces =================
  const SC = { status: 'loading', list: [] };
  const role = (r) => (r === 'owner' ? 'you are the owner' : r === 'admin' ? 'you are an admin' : r === 'viewer' ? 'you can view' : 'you are a member');
  const shape = (w) => { const personal = w.workspace_type === 'personal', name = personal ? 'Personal' : String(w.name || 'Workspace'); return { id: personal ? 'personal' : w.id, uuid: w.id, name, sub: personal ? 'Just you' : `Company · ${role(w.member_role)}`, initial: (personal ? (window.XENO_ME?.first?.() || 'P') : name)[0].toUpperCase(), role: w.member_role || 'member', personal }; };
  // the sample list goes at once: until the platform answers there is one entry, and it is yours
  LS.set('workspaces', [{ id: 'personal', uuid: null, name: 'Personal', sub: 'Just you', initial: 'P', role: 'owner', personal: true }]);
  if (LS.get('workspace', 'personal') !== 'personal' && !/^[0-9a-f-]{36}$/i.test(String(LS.get('workspace', '')))) LS.set('workspace', 'personal');
  async function loadScope() {
    const r = await api('GET', '/api/workspaces').catch(() => ({ ok: false, d: {} }));
    if (!r.ok || !Array.isArray(r.d.workspaces)) { SC.status = 'error'; return false; }
    SC.list = r.d.workspaces.map(shape).sort((a, b) => (b.personal ? 1 : 0) - (a.personal ? 1 : 0));
    if (!SC.list.some((w) => w.personal)) SC.list.unshift({ id: 'personal', uuid: null, name: 'Personal', sub: 'Just you', initial: 'P', role: 'owner', personal: true });
    LS.set('workspaces', SC.list);
    if (!SC.list.some((w) => w.id === LS.get('workspace', 'personal'))) LS.set('workspace', 'personal');
    SC.status = 'ready'; return true;
  }
  const current = () => SC.list.find((w) => w.id === LS.get('workspace', 'personal')) || SC.list[0] || null;
  const labelOf = (uuid) => (SC.list.find((w) => w.uuid === uuid) || {}).name || 'A workspace';
  window.XENO_SCOPE = { served: true, load: loadScope, list: () => SC.list.slice(), current, uuid: () => (current() || {}).uuid || null, label: labelOf, status: () => SC.status };

  // ================= projects =================
  const W = { status: 'loading', byId: new Map() };
  const blank = () => { window.XENO_PROJECTS = {}; window.XENO_PG_PROJECTS.items = []; };
  blank(); pstate('projects', 'loading');
  const me = () => (P.user && P.user.id) || null;
  function place(p) { // where a project lives, in words
    if (p.workspace_id) { const w = SC.list.find((x) => x.uuid === p.workspace_id); return w ? (w.personal ? 'Personal' : w.name) : 'A workspace'; }
    return String(p.owner_user_id) === String(me()) ? 'Personal' : 'Shared with you';
  }
  async function loadProjects() {
    // AREA: one area's projects, or everything on Overview
    const here = area(), q = here ? '&area=' + encodeURIComponent(here) : ''; W.loadingArea = here;
    const [pr, cv] = await Promise.all([api('GET', '/api/chat/projects?include_archived=true&limit=100' + q).catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/conversations?limit=200' + q).catch(() => ({ ok: false, d: {} }))]);
    if (area() !== here) return loadProjects();   // the person moved to another area while this was on its way
    W.area = here; W.loadingArea = undefined;
    if (!pr.ok || !Array.isArray(pr.d.projects)) { W.status = 'error'; blank(); pstate('projects', 'error'); paint(); return false; }
    const chats = new Map(); if (cv.ok && Array.isArray(cv.d.conversations)) cv.d.conversations.forEach((c) => { if (c.project_id) { if (!chats.has(c.project_id)) chats.set(c.project_id, []); chats.get(c.project_id).push([String(c.title || 'Untitled chat'), 'Chat']); } });
    const rows = pr.d.projects, seen = new Map(); rows.forEach((p) => seen.set(p.name, (seen.get(p.name) || 0) + 1));
    const used = new Set(), items = [], detail = {}; W.byId = new Map();
    for (const p of rows) {
      const where = place(p), xw = (p.settings && p.settings.xw) || {};
      let key = String(p.name || 'Untitled project');
      if (seen.get(p.name) > 1 || used.has(key)) key = `${key} (${where})`;
      if (used.has(key)) key = `${key} ${String(p.id).slice(0, 4)}`;
      used.add(key);
      const mine = String(p.owner_user_id) === String(me()), status = p.is_archived ? 'archived' : (!p.workspace_id && !mine ? 'shared' : 'active');
      // the area it lives in (its real home), shown by name; a project in none lives on Overview
      const mode = p.area ? areaName(p.area) : 'Overview', icon = typeof xw.icon === 'string' && xw.icon ? xw.icon : 'folder';
      const rec = { id: p.id, name: key, realName: p.name, mode, area: p.area || null, owner: { name: where, kind: 'human' }, status, health: null, goal: p.description || '', icon, milestone: { title: 'No milestone', due: '—' }, tasks: { total: 0, done: 0 }, members: [], needsYou: 0, updatedAt: p.updated_at || p.created_at || new Date().toISOString(), place: where, workspaceUuid: p.workspace_id || null, files: Number(p.file_count) || 0, chatCount: Number(p.chat_count) || 0, pinned: !!p.pinned, can: p.capabilities || {} };
      items.push(rec); W.byId.set(p.id, rec);
      detail[key] = { id: p.id, mode, owner: where, goal: rec.goal, milestone: '—', progress: '', icon, tasks: [], taskObjs: [], chats: chats.get(p.id) || [], teams: [], resources: [], funding: [], activity: [] };
    }
    window.XENO_PROJECTS = detail; window.XENO_PG_PROJECTS.items = items;
    W.status = 'ready'; pstate('projects', 'normal'); paint(); return true;
  }
  const NOT_YET = { Tasks: ['check', 'Tasks aren’t available yet', 'Tasks, their reviewers and their evidence aren’t connected on XENO yet.'], 'Team assignments': ['people', 'Team assignments aren’t available yet', 'Assigning a workspace team or an agent to a project isn’t connected on XENO yet.'], Funding: ['gear', 'Funding isn’t available yet', 'Budgets, milestones and contributions aren’t connected on XENO yet.'], Activity: ['clock', 'Activity isn’t available yet', 'The history of what happened in this project isn’t connected on XENO yet.'] };
  function projectTab(tab, name, h) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name);
    if (W.status === 'loading') return h.box('folder', 'Loading this project', '', '', 'sm');
    if (!rec) return null;
    if (tab === 'Tasks' && window.XENO_TASKS && window.XENO_TASKS.served) return window.XENO_TASKS.projectTab(rec);
    if (INSIGHT_TABS.has(tab)) { const live = insightTab(tab, rec, h); if (live !== null) return live; }
    if (NOT_YET[tab]) return h.box(NOT_YET[tab][0], NOT_YET[tab][1], esc(NOT_YET[tab][2]), '', 'sm');
    if (tab === 'Overview') return `<div class="pg-cols"><div>
        <section class="pg-sec"><h3>In this project</h3><div class="pg-mini-board"><button class="pg-mb" data-ptab="Conversations"><b>${rec.chatCount}</b><small>${rec.chatCount === 1 ? 'Conversation' : 'Conversations'}</small></button><button class="pg-mb" data-ptab="Resources"><b>${rec.files}</b><small>${rec.files === 1 ? 'File' : 'Files'}</small></button></div></section></div>
      <aside><section class="pg-sec pg-card-s"><h3>Goal</h3><p>${esc(rec.goal || 'No goal written yet.')}</p></section>
        <section class="pg-sec pg-card-s"><h3>Lives in</h3><p><b>${esc(rec.place)}</b><small>${rec.workspaceUuid ? 'Everyone in this workspace with access sees it' : rec.status === 'shared' ? 'Someone shared this project with you' : 'Only you, and the people you share it with'}</small></p></section></aside></div>`;
    return null;
  }
  // actions the platform cannot do yet say so, and change nothing
  const BLOCKED = { budget: 'Setting a budget' };
  // actions the platform CAN do: handled here, so the prototype's sample-data versions never run
  const HANDLED = {
    newTask: (name) => { const rec = byName(name); if (!rec || !window.XENO_TASKS?.served) return false; window.XENO_TASKS.newTask(rec.id); return true; },
    // a new chat filed in the project: the real chat's project home, whose composer creates it there
    newProjectChat: (name) => { const rec = byName(name); if (!rec || !window.XENO_CHAT?.served) return false; X()?.go?.('product', { product: 'chat' }); setTimeout(() => window.XENO_CHAT.openProjectId(rec.id), 0); return true; },
    openTask: (arg) => { const key = String(arg || '').split('|').pop(); if (!/^T-\d+$/.test(key)) return false; openTaskKey(key); return true; },
  };
  function blocked(action, arg) { if (HANDLED[action] && HANDLED[action](arg)) return true; const what = BLOCKED[action]; if (!what) return false; X()?.toast?.(`${what} isn’t available on XENO yet`); return true; }

  function mark() { document.querySelectorAll('#main [data-xa]').forEach((el) => { if (BLOCKED[el.dataset.xa] && !el.classList.contains('role-off')) { el.setAttribute('aria-disabled', 'true'); el.classList.add('role-off'); el.title = `${BLOCKED[el.dataset.xa]} isn’t available on XENO yet`; } }); }
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- a project at a glance: Overview, Team, Activity (GET /api/chat/projects/:id/summary|people|activity) ----------
  const INSIGHT_TABS = new Set(['Overview', 'Team assignments', 'Activity']);
  const I = new Map();   // project id → { status, summary, people, feed: { items, next, more } }
  const byName = (name) => (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name) || null;
  const openTaskKey = (key) => { location.hash = `#/${area() || 'overview'}/g/tasks/${key}`; };
  async function loadInsight(id, { more = false } = {}) {
    const cur = I.get(id) || { status: 'loading', feed: { items: [], next: null } };
    if (!more) { cur.status = cur.summary ? 'refreshing' : 'loading'; I.set(id, cur); }
    const before = more && cur.feed.next ? `&before=${encodeURIComponent(cur.feed.next)}` : '';
    const [s, p, a] = await Promise.all([
      more ? null : api('GET', `/api/chat/projects/${encodeURIComponent(id)}/summary`).catch(() => null),
      more ? null : api('GET', `/api/chat/projects/${encodeURIComponent(id)}/people`).catch(() => null),
      api('GET', `/api/chat/projects/${encodeURIComponent(id)}/activity?limit=30${before}`).catch(() => null)]);
    if (!more && (!s || !s.ok)) { cur.status = 'error'; I.set(id, cur); paint(); return; }
    if (!more) { cur.summary = s.d; cur.people = p && p.ok ? p.d : null; cur.feed = { items: [], next: null }; }
    if (a && a.ok) { cur.feed.items = [...(more ? cur.feed.items : []), ...a.d.items]; cur.feed.next = a.d.next; }
    cur.status = 'ready'; cur.at = Date.now(); I.set(id, cur); paint();
  }
  const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 604800 ? `${Math.floor(s / 86400)} d ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  const face = (p) => `<span class="pi-face${p && p.kind === 'agent' ? ' pi-face--agent' : ''}" title="${esc(p ? p.name : 'XENO')}">${p && p.kind === 'agent' ? X()?.ic?.('bot') || 'A' : esc(String(p ? p.name : 'X').trim().charAt(0).toUpperCase() || '?')}</span>`;
  const ROLE = { owner: 'Owner', admin: 'Admin', editor: 'Can edit', reviewer: 'Can review', viewer: 'Can view', client: 'Client' };
  const STATUS = { raised: 'Triage', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', wont_do: 'Won’t do' };
  function line(it) {
    const who = `<b>${esc(it.actor ? it.actor.name : 'XENO')}</b>${it.actor && it.actor.kind === 'agent' ? '<em class="pi-kind">Agent</em>' : ''}`;
    const task = it.task ? `<a class="pi-ref" data-pi-task="${esc(it.task.key)}">${esc(it.task.key)}</a> ${esc(it.task.title)}` : '';
    const what = it.type === 'member' ? `joined the project <span class="pi-dim">· ${esc(ROLE[it.relation] || it.relation)}</span>`
      : it.type === 'conversation' ? `started a conversation <a class="pi-ref" data-pi-chat="${esc(it.conversation.id)}">${esc(it.conversation.title)}</a>`
      : it.type === 'file' ? `added <i>${esc(it.file.name)}</i>`
      : it.kind === 'created' ? `raised ${task}`
      : it.kind === 'status' ? `moved ${task} to <b>${esc(STATUS[it.to] || it.to)}</b>`
      : it.kind === 'comment' ? `commented on ${task}`
      : it.kind === 'assigned' ? `${it.to ? 'assigned' : 'unassigned'} ${task}`
      : it.kind === 'claimed' ? `took ${task}`
      : it.kind === 'delegated' ? `${it.to ? 'handed' : 'took the agent off'} ${task}${it.to ? ' to an agent' : ''}`
      : it.kind === 'activity' ? `${({ ask: 'asks about', result: 'reported on', error: 'hit a problem on' })[it.from] || 'worked on'} ${task}`
      : it.kind === 'attached' ? `added an image to ${task}` : it.kind === 'linked' ? `linked ${task}` : it.kind === 'parent' ? `added a sub-task to ${task}`
      : it.kind === 'deleted' ? `deleted ${task}` : it.kind === 'restored' ? `restored ${task}` : `updated ${task}`;
    return `<li class="pi-ev" data-pi-ev="${esc(it.type)}:${esc(it.kind)}">${face(it.actor)}<div><p>${who} ${what}</p>${it.note ? `<q>${esc(it.note)}</q>` : ''}</div><time title="${esc(new Date(it.at).toLocaleString())}">${esc(ago(it.at))}</time></li>`;
  }
  const feed = (items) => (items.length ? `<ol class="pi-feed">${items.map(line).join('')}</ol>` : '<p class="pi-dim">Nothing has happened here yet.</p>');
  function insightTab(tab, rec, h) {
    const cur = I.get(rec.id);
    if (!cur || (cur.at && Date.now() - cur.at > 60000 && cur.status === 'ready')) { if (!cur || cur.status !== 'loading') { I.set(rec.id, { ...(cur || { feed: { items: [], next: null } }), status: cur ? cur.status : 'loading' }); setTimeout(() => loadInsight(rec.id), 0); } }
    const c = I.get(rec.id);
    if (!c.summary && c.status === 'error') return h.box('folder', 'This project couldn’t be loaded', 'Check your connection and try again.', h.btn('Try again', `data-pi="retry" data-arg="${esc(rec.id)}"`, false, 'reset'), 'sm');
    if (!c.summary) return h.box('folder', 'Loading this project', '', '', 'sm');
    const s = c.summary, t = s.tasks, ppl = (c.people && c.people.people) || [], you = (c.people && c.people.you) || {};
    if (tab === 'Activity') return `<section class="pi-sec" data-pi-activity>${feed(c.feed.items)}${c.feed.next ? `<button class="pi-more" data-pi="more" data-arg="${esc(rec.id)}">Show older</button>` : ''}</section>`;
    if (tab === 'Team assignments') {
      const row = (p) => `<div class="pi-person" data-pi-person="${esc(p.id)}">${face(p)}<div><b>${esc(p.name)}${p.me ? ' <span class="pi-dim">(you)</span>' : ''}</b><small>${p.kind === 'agent' ? `Agent${p.owner ? ` · ${esc(p.owner.name)}’s` : ''}` : esc(p.email || (p.username ? '@' + p.username : ''))}</small></div><span class="pi-role">${esc(ROLE[p.relation] || p.relation)}</span></div>`;
      const humans = ppl.filter((p) => p.kind === 'human'), agents = ppl.filter((p) => p.kind === 'agent');
      return `<div class="pi-team" data-pi-team>
        <div class="pi-bar"><span>${humans.length} ${humans.length === 1 ? 'person' : 'people'} · ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}</span><span class="pi-sp"></span>${you.canManage ? h.btn('Manage access', `data-pi="share" data-arg="${esc(rec.name)}"`, false, 'people') : `<small class="pi-dim">You ${esc((ROLE[you.relation] || 'can view').toLowerCase())}. A project admin manages who is on it.</small>`}</div>
        <section class="pi-sec"><h3>People</h3>${humans.map(row).join('') || '<p class="pi-dim">Only you.</p>'}</section>
        <section class="pi-sec"><h3>Agents</h3>${agents.map(row).join('') || '<p class="pi-dim">No agents on this project. Add one from Tasks › Agents, or delegate a task to one.</p>'}</section></div>`;
    }
    // Overview
    const pct = t.progress == null ? 0 : t.progress;
    const stat = (n, l, k, warn) => `<button class="pi-stat${warn && n ? ' pi-stat--warn' : ''}" data-ptab="Tasks" data-pi-stat="${k}"><b>${n}</b><small>${l}</small></button>`;
    return `<div class="pg-cols pi-over" data-pi-overview><div>
        <section class="pi-sec"><h3>Progress<span class="pi-dim">${t.total ? `${t.done + t.wont_do} of ${t.total} closed` : 'No tasks yet'}</span></h3>
          <div class="pi-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <div class="pi-stats">${stat(t.raised !== undefined ? t.triage : 0, 'In triage', 'triage')}${stat(t.in_progress, 'In progress', 'in_progress')}${stat(t.in_review, 'In review', 'in_review')}${stat(t.blocked, 'Blocked', 'blocked', true)}${stat(t.overdue, 'Overdue', 'overdue', true)}${stat(t.done_week, 'Done this week', 'done_week')}</div>
          ${t.total ? '' : `<div class="pi-empty">${h.btn('New task', `data-xa="newTask" data-arg="${esc(rec.name)}"`, false, 'plus')}<small class="pi-dim">Raise the first task, or link a folder for an agent CLI from the Tasks tab.</small></div>`}</section>
        <section class="pi-sec"><h3>Recent activity<button class="pi-link" data-ptab="Activity">See all</button></h3>${feed(c.feed.items.slice(0, 6))}</section></div>
      <aside>
        <section class="pg-sec pg-card-s"><h3>Goal</h3><p>${esc(rec.goal || 'No goal written yet.')}</p></section>
        <section class="pg-sec pg-card-s"><h3>People<button class="pi-link" data-ptab="Team assignments">${ppl.length}</button></h3><div class="pi-faces">${ppl.slice(0, 10).map(face).join('')}</div>${s.agents ? `<small class="pi-dim">${s.agents} ${s.agents === 1 ? 'agent' : 'agents'} · ${t.with_agents} ${t.with_agents === 1 ? 'task' : 'tasks'} with agents</small>` : ''}</section>
        <section class="pg-sec pg-card-s"><h3>In this project</h3><div class="pi-kv"><button data-ptab="Conversations"><b>${s.conversations}</b><small>${s.conversations === 1 ? 'Conversation' : 'Conversations'}</small></button><button data-ptab="Resources"><b>${s.files}</b><small>${s.files === 1 ? 'File' : 'Files'}</small></button><button data-ptab="Tasks"><b>${t.unassigned}</b><small>Unassigned</small></button></div></section>
        <section class="pg-sec pg-card-s"><h3>Lives in</h3><p><b>${esc(rec.place)}</b><small>${s.lastActivityAt ? 'Last activity ' + esc(ago(s.lastActivityAt)) : 'No activity yet'}</small></p></section>
      </aside></div>`;
  }
  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-pi-task]'); if (k) { e.preventDefault(); openTaskKey(k.dataset.piTask); return; }
    const c = e.target.closest('[data-pi-chat]'); if (c) { e.preventDefault(); location.hash = `#/${area() || 'overview'}/g/chat`; return; }
    const b = e.target.closest('[data-pi]'); if (!b) return;
    const what = b.dataset.pi, arg = b.dataset.arg;
    if (what === 'retry') { I.delete(arg); loadInsight(arg); }
    else if (what === 'more') { b.disabled = true; b.textContent = 'Loading…'; loadInsight(arg, { more: true }); }
    else if (what === 'share') shareProject(arg).then(() => { const rec = byName(arg); if (rec) loadInsight(rec.id); });
  });

  // ---------- saves ----------
  const listOf = (raw) => (readJson(raw, {}) || {}).projectList || [];
  const settle = (res) => { setTimeout(loadProjects, 0); return res; };
  window.XENO_NET.wire('projects'); window.XENO_NET.wire('workspaces');
  window.XENO_NET.remote({
    'projects.create': async () => {
      const made = (window.XENO_PG_PROJECTS.items || []).find((p) => !W.byId.has(p.id));
      if (!made) return { ok: false, code: 'invalid', msg: 'The new project could not be read.', final: true };
      const ws = current(), headers = ws && ws.uuid ? { 'x-xeno-workspace': ws.uuid } : {};
      const here = area();   // a new project lives in the area it was made in
      const r = await api('POST', '/api/chat/projects', { name: made.name, description: made.goal || '', settings: { xw: { icon: made.icon || 'folder' } }, ...(here ? { area: here } : {}) }, headers);
      return r.ok ? settle({ ok: true }) : fail(r, 'The project couldn’t be created.');
    },
    'projects.rename': async ({ before }) => {
      const was = new Map(listOf(before['xw.db.v1']).map((p) => [p.id, p])), now = (window.XENO_PG_PROJECTS.items || []).find((p) => was.has(p.id) && was.get(p.id).name !== p.name);
      if (!now) return { ok: true };
      const r = await api('PUT', '/api/chat/projects/' + encodeURIComponent(now.id), { name: now.name });
      return r.ok ? settle({ ok: true }) : fail(r, 'The project couldn’t be renamed.');
    },
    'projects.icon': async ({ before }) => {
      const was = new Map(listOf(before['xw.db.v1']).map((p) => [p.id, p])), now = (window.XENO_PG_PROJECTS.items || []).find((p) => was.has(p.id) && was.get(p.id).icon !== p.icon);
      if (!now) return { ok: true };
      const r = await api('PUT', '/api/chat/projects/' + encodeURIComponent(now.id), { settings: { xw: { icon: now.icon || 'folder' } } });
      return r.ok ? settle({ ok: true }) : fail(r, 'The icon couldn’t be saved.');
    },
    'projects.archive': async ({ before }) => {
      const was = new Map(listOf(before['xw.db.v1']).map((p) => [p.id, p])), now = (window.XENO_PG_PROJECTS.items || []).find((p) => was.has(p.id) && was.get(p.id).status !== 'archived' && p.status === 'archived');
      if (!now) return { ok: true };
      const r = await api('PUT', '/api/chat/projects/' + encodeURIComponent(now.id), { is_archived: true });
      return r.ok ? settle({ ok: true }) : fail(r, 'The project couldn’t be archived.');
    },
    'workspaces.create': async () => {
      const made = (LS.get('workspaces', []) || []).find((w) => !w.uuid && w.id !== 'personal');
      if (!made) return { ok: false, code: 'invalid', msg: 'The new company could not be read.', final: true };
      const r = await api('POST', '/api/workspaces', { name: made.name });
      if (!r.ok || !r.d.workspace) return fail(r, 'The company couldn’t be created.');
      await loadScope(); LS.set('workspace', r.d.workspace.id);
      return settle({ ok: true });
    },
  });

  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pg-retry="projects"]'); if (t && W.status === 'error') { pstate('projects', 'loading'); paint(); load(); } }, true);
  async function load() { await loadScope(); return loadProjects(); }
  // move a project to another area, or to none; its chats and files follow it (they read the project's area)
  async function moveProject(name) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name); if (!rec) return false;
    const options = [['none', 'No area', 'Shown on Overview only'], ...areas().map(([v, l]) => [v, l, ''])];
    let moved = false;
    await window.XD.form({ title: 'Move project', submit: 'Move', size: 'sm', fields: [{ id: 'area', type: 'choice', label: 'Area', value: rec.area || 'none', options, cols: 2, hint: 'Its chats go with it.' }],
      onSubmit: async (v) => { const to = v.area === 'none' ? null : v.area; const r = await api('PUT', '/api/chat/projects/' + encodeURIComponent(rec.id), { area: to }).catch(() => null);
        if (!r || !r.ok) return (r && r.d && typeof r.d.error === 'string' && r.d.error) || 'The project couldn’t be moved. Nothing changed.';
        moved = true; X()?.toast?.(to ? `Moved “${rec.realName}” to ${areaName(to)}` : `Moved “${rec.realName}” out of every area`); return null; } });
    if (moved) { await loadProjects(); try { window.XENO_CHAT?.load?.(); } catch {} }
    return moved;
  }
  // ---------- sharing: who can open this project, and as what ----------
  const ROLES = [['viewer', 'Can view'], ['reviewer', 'Can comment'], ['editor', 'Can edit'], ['admin', 'Can manage']];
  const roleName = (r) => (ROLES.find((x) => x[0] === r) || [r, r])[1];
  async function shareProject(name) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name); if (!rec) return false;
    const base = '/api/chat/projects/' + encodeURIComponent(rec.id) + '/access', toast = (m) => X()?.toast?.(m);
    const SH = { status: 'loading', grants: [], error: '' };
    const load = async () => { const r = await api('GET', base).catch(() => null);
      if (r && r.ok && Array.isArray(r.d.grants)) { SH.grants = r.d.grants.filter((g) => String(g.subject || '').startsWith('user:')); SH.status = 'ready'; }
      else { SH.status = r && r.status === 403 ? 'forbidden' : 'error'; } };
    const paint = (sh) => { const b = sh.querySelector('.xd-info'); if (!b) return;
      const who = (g) => (g.identity ? g.identity.display_name || g.identity.username || g.identity.email : 'An account');
      const row = (g) => { const id = String(g.subject).slice(5), owner = g.relation === 'owner', me2 = id === String(me());
        return `<li data-share="${esc(id)}"><div><b>${esc(who(g))}${me2 ? ' (you)' : ''}</b><small>${esc(g.identity && g.identity.email ? g.identity.email : '')}</small></div><span class="xd-list-acts">${owner ? '<span class="xd-share-owner">Owner</span>' : `<select data-share-role="${esc(id)}" aria-label="What ${esc(who(g))} can do">${ROLES.map(([v, l]) => `<option value="${v}"${v === g.relation ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="xd-ib" data-share-remove="${esc(id)}" aria-label="Stop sharing with ${esc(who(g))}" data-tip="Stop sharing">${X().ic('x')}</button>`}</span></li>`; };
      b.innerHTML = SH.status === 'loading' ? '<p class="xd-note" data-share-state="loading">Loading who can open this project…</p>'
        : SH.status === 'forbidden' ? '<p class="xd-note" data-share-state="forbidden">Only someone who manages this project can change who it is shared with.</p>'
        : SH.status === 'error' ? '<p class="xd-note" data-share-state="error">That couldn’t be loaded. <button class="xd-btn ghost sm" data-share-retry>Try again</button></p>'
        : `<form class="xd-share-add" data-share-add><input type="email" required placeholder="Email of a XENO account" aria-label="Email of the person to share with"><select aria-label="What they can do">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="xd-btn sm" type="submit">Share</button></form>${SH.error ? `<p class="xd-err" data-share-error role="alert">${esc(SH.error)}</p>` : ''}<ul class="xd-list">${SH.grants.map(row).join('')}</ul>`; };
    const again = async (sh) => { await load(); if (document.body.contains(sh)) paint(sh); };
    await window.XD.info({ title: 'Share “' + rec.realName + '”', sub: 'People you add can open the project and its chats.', size: 'md', html: '',
      onOpen: (sh) => { paint(sh); again(sh);
        sh.addEventListener('submit', async (e) => { const f = e.target.closest('[data-share-add]'); if (!f) return; e.preventDefault(); const email = f.querySelector('input').value.trim(), relation = f.querySelector('select').value; if (!email) return;
          const r = await api('PUT', base + '/user/by-email', { email, relation }).catch(() => null);
          if (!r || !r.ok) { SH.error = r && r.d && r.d.code === 'account_not_found' ? 'No XENO account uses that email. They need an account first.' : (r && r.d && typeof r.d.error === 'string' && r.d.error) || 'That couldn’t be shared. Nothing changed.'; return paint(sh); }
          SH.error = ''; toast(`Shared with ${email} · ${roleName(relation).toLowerCase()}`); again(sh); });
        sh.addEventListener('change', async (e) => { const s = e.target.closest('[data-share-role]'); if (!s) return;
          const r = await api('PUT', base + '/user/' + encodeURIComponent(s.dataset.shareRole), { relation: s.value }).catch(() => null);
          if (!r || !r.ok) toast('That couldn’t be changed. It is as it was.'); else toast('Changed to ' + roleName(s.value).toLowerCase()); again(sh); });
        sh.addEventListener('click', async (e) => { if (e.target.closest('[data-share-retry]')) { SH.status = 'loading'; paint(sh); return again(sh); }
          const rm = e.target.closest('[data-share-remove]'); if (!rm) return;
          const r = await api('DELETE', base + '/user/' + encodeURIComponent(rm.dataset.shareRemove)).catch(() => null);
          if (!r || !r.ok) toast('That couldn’t be removed. They still have access.'); else toast('Stopped sharing'); again(sh); }); } });
    return true;
  }
  // ---------- delete for good: an archived project with nothing left inside ----------
  async function deleteProject(name) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name); if (!rec) return false;
    const toast = (m) => X()?.toast?.(m);
    if (rec.status !== 'archived') { toast('Archive the project first. Only an archived project can be deleted for good.'); return false; }
    if (!(await window.XD.confirm({ title: 'Delete “' + rec.realName + '” for good?', body: 'The project and its sharing are removed for everyone. <b>This can’t be undone.</b> A project that still holds chats is not deleted: you will be told, and nothing changes.', action: 'Delete for good', typeToConfirm: rec.realName }))) return false;
    const r = await api('DELETE', '/api/chat/projects/' + encodeURIComponent(rec.id) + '/permanent').catch(() => null);
    if (!r || !r.ok) { const d = (r && r.d) || {};
      toast(d.code === 'project_not_empty' ? `“${rec.realName}” still holds ${[d.conversations ? d.conversations + (d.conversations === 1 ? ' chat' : ' chats') : '', d.scheduled ? d.scheduled + (d.scheduled === 1 ? ' scheduled chat' : ' scheduled chats') : ''].filter(Boolean).join(' and ')}. Move or delete them first.` : (typeof d.error === 'string' && d.error) || 'The project couldn’t be deleted. Nothing changed.'); return false; }
    toast(`Deleted “${rec.realName}” for good`); await loadProjects(); try { X()?.go?.('global', { global: 'projects', item: null }); window.XENO_RECENT_LIVE?.load?.(); } catch {}
    return true;
  }
  // the Projects page asks on each paint: moved to another area, its own list
  function sync() { if (W.status === 'ready' && W.area !== undefined && W.loadingArea === undefined && area() !== W.area) { W.status = 'loading'; pstate('projects', 'loading'); loadProjects(); } }
  window.XENO_WORK = { served: true, moveProject, shareProject, deleteProject, sync, load, projectTab, blocked, state: () => ({ scope: SC.status, projects: W.status }), reload: loadProjects, idOf: (name) => ((window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name) || {}).id || null };
  Promise.resolve(P.ready).then((user) => { if (user) P.first(load()); });   // the page waits for this first load before it shows
})();
