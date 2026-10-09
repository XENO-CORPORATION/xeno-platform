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
 *   · GET /api/chat/conversations (to list a project's conversations). */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SCOPE = { served: false }; window.XENO_WORK = { served: false, projectTab: () => null, blocked: () => false }; return; }
  const X = () => window.XW, api = P.api;
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
    const [pr, cv] = await Promise.all([api('GET', '/api/chat/projects?include_archived=true&limit=100').catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/conversations?limit=200').catch(() => ({ ok: false, d: {} }))]);
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
      const mode = typeof xw.mode === 'string' && xw.mode ? xw.mode : 'Overview', icon = typeof xw.icon === 'string' && xw.icon ? xw.icon : 'folder';
      const rec = { id: p.id, name: key, realName: p.name, mode, owner: { name: where, kind: 'human' }, status, health: null, goal: p.description || '', icon, milestone: { title: 'No milestone', due: '—' }, tasks: { total: 0, done: 0 }, members: [], needsYou: 0, updatedAt: p.updated_at || p.created_at || new Date().toISOString(), place: where, workspaceUuid: p.workspace_id || null, files: Number(p.file_count) || 0, chatCount: Number(p.chat_count) || 0, pinned: !!p.pinned, can: p.capabilities || {} };
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
    if (NOT_YET[tab]) return h.box(NOT_YET[tab][0], NOT_YET[tab][1], esc(NOT_YET[tab][2]), '', 'sm');
    if (tab === 'Overview') return `<div class="pg-cols"><div>
        <section class="pg-sec"><h3>In this project</h3><div class="pg-mini-board"><button class="pg-mb" data-ptab="Conversations"><b>${rec.chatCount}</b><small>${rec.chatCount === 1 ? 'Conversation' : 'Conversations'}</small></button><button class="pg-mb" data-ptab="Resources"><b>${rec.files}</b><small>${rec.files === 1 ? 'File' : 'Files'}</small></button></div></section></div>
      <aside><section class="pg-sec pg-card-s"><h3>Goal</h3><p>${esc(rec.goal || 'No goal written yet.')}</p></section>
        <section class="pg-sec pg-card-s"><h3>Lives in</h3><p><b>${esc(rec.place)}</b><small>${rec.workspaceUuid ? 'Everyone in this workspace with access sees it' : rec.status === 'shared' ? 'Someone shared this project with you' : 'Only you, and the people you share it with'}</small></p></section></aside></div>`;
    return null;
  }
  // actions the platform cannot do yet say so, and change nothing
  const BLOCKED = { deleteProject: 'Deleting a project for good', assign: 'Assigning people or agents', budget: 'Setting a budget', newTask: 'Adding a task', openTask: 'Opening a task', newProjectChat: 'Starting a chat from here' };
  function blocked(action) { const what = BLOCKED[action]; if (!what) return false; X()?.toast?.(`${what} isn’t available on XENO yet`); return true; }

  function mark() { document.querySelectorAll('#main [data-xa]').forEach((el) => { if (BLOCKED[el.dataset.xa] && !el.classList.contains('role-off')) { el.setAttribute('aria-disabled', 'true'); el.classList.add('role-off'); el.title = `${BLOCKED[el.dataset.xa]} isn’t available on XENO yet`; } }); }
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- saves ----------
  const listOf = (raw) => (readJson(raw, {}) || {}).projectList || [];
  const settle = (res) => { setTimeout(loadProjects, 0); return res; };
  window.XENO_NET.wire('projects'); window.XENO_NET.wire('workspaces');
  window.XENO_NET.remote({
    'projects.create': async () => {
      const made = (window.XENO_PG_PROJECTS.items || []).find((p) => !W.byId.has(p.id));
      if (!made) return { ok: false, code: 'invalid', msg: 'The new project could not be read.', final: true };
      const ws = current(), headers = ws && ws.uuid ? { 'x-xeno-workspace': ws.uuid } : {};
      const r = await api('POST', '/api/chat/projects', { name: made.name, description: made.goal || '', settings: { xw: { mode: made.mode, icon: made.icon || 'folder' } } }, headers);
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
      const r = await api('PUT', '/api/chat/projects/' + encodeURIComponent(now.id), { settings: { xw: { mode: now.mode, icon: now.icon || 'folder' } } });
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
  window.XENO_WORK = { served: true, load, projectTab, blocked, state: () => ({ scope: SC.status, projects: W.status }), reload: loadProjects, idOf: (name) => ((window.XENO_PG_PROJECTS.items || []).find((p) => p.name === name) || {}).id || null };
  Promise.resolve(P.ready).then((user) => { if (user) P.first(load()); });   // the page waits for this first load before it shows
})();
