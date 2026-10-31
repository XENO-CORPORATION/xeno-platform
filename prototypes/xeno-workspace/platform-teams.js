/**
 * Workspace > Teams, Automations and Activity, from the platform. These were the picture's: a team "created" here used to
 * live only in this browser (workforce.js).
 *
 *   Teams        /workspace/workspace/Teams        GET/POST /api/workspaces/:id/teams
 *   a team       /workspace/workspace/Teams/<id>   PUT/DELETE …/teams/:id, with the version the server sent
 *   Automations  /workspace/workspace/Automations  GET /api/automate: the workflows of Dev > Automate, which opens them
 *   Activity     /workspace/workspace/Activity     GET /api/audit/events?scope=workspace:<id>: what happened, decided per reader
 *
 * The server decides who may change a team (can_manage) and which agents may be added (available_agents).
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_TEAMS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api, esc = (s) => H().esc(s);
  const toast = (m) => X()?.toast?.(m);
  const wsId = () => (window.XENO_SCOPE?.served && window.XENO_SCOPE.uuid?.()) || null;
  const said = (r, fallback) => (r && r.d && (typeof r.d.error === 'string' ? r.d.error : r.d.error?.message || r.d.message)) || fallback;
  const paint = () => { try { const s = X()?.S; if (s?.view === 'global' && s.global === 'workspace') X().render(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const S = {
    teams: { key: null, status: 'idle', list: [], projects: [], agents: [], canManage: false },
    auto: { key: null, status: 'idle', list: [] },
    act: { key: null, status: 'idle', list: [], hidden: 0, cursor: null, more: false, loadingMore: false },
  };
  const stale = (slot) => slot.key !== wsId();

  async function loadTeams() {
    const w = wsId(), T = S.teams; T.key = w; T.status = 'loading';
    if (!w) { T.status = 'ready'; T.list = []; paint(); return; }
    const r = await api('GET', `/api/workspaces/${encodeURIComponent(w)}/teams`);
    if (T.key !== w) return;
    if (r.ok) { T.list = r.d.teams || []; T.projects = r.d.projects || []; T.agents = r.d.available_agents || []; T.canManage = !!r.d.can_manage; T.status = 'ready'; }
    else T.status = r.status === 403 ? 'denied' : 'error';
    paint();
  }
  async function loadAuto() {
    const w = wsId(), A = S.auto; A.key = w; A.status = 'loading';
    const r = await api('GET', '/api/automate' + (w ? `?workspace=${encodeURIComponent(w)}` : ''));
    if (A.key !== w) return;
    if (r.ok) { A.list = r.d.workflows || []; A.status = 'ready'; } else A.status = r.status === 403 ? 'denied' : 'error';
    paint();
  }
  async function loadActivity(more) {
    const w = wsId(), E = S.act;
    if (!more) { E.key = w; E.status = 'loading'; E.list = []; E.cursor = null; } else E.loadingMore = true;
    if (!w) { E.status = 'ready'; paint(); return; }
    const r = await api('GET', `/api/audit/events?scope=${encodeURIComponent('workspace:' + w)}&limit=50${more && E.cursor ? `&before=${encodeURIComponent(E.cursor)}` : ''}`);
    if (E.key !== w) return;
    E.loadingMore = false;
    if (r.ok) { E.list = E.list.concat(r.d.events || []); E.hidden = r.d.hidden || 0; E.cursor = r.d.cursor; E.more = !!r.d.more; E.status = 'ready'; }
    else E.status = r.status === 403 || r.status === 404 ? 'denied' : 'error';
    paint();
  }

  const nav = () => H().tabs([['Teams', 'Teams'], ['Automations', 'Automations'], ['Activity', 'Activity']], (X()?.S?.item || '').split('/')[0], 'data-xteam="tab" data-to');
  const failed = (what, slot) => H().box('alert', `${what} could not be loaded just now`, 'Nothing changed. Try again.', H().btn('Try again', `data-xteam="retry" data-slot="${slot}"`));
  const denied = (what) => H().box('lock', `You don’t have access to ${what} here`, 'Ask an owner of this workspace.');
  const loading = (what) => H().box('refresh', `Loading ${what}`, '', '', 'sm');
  const noWorkspace = (what) => H().box('people', `${what} belong to a workspace`, 'Switch to a workspace to see them.');

  function teamsPage() {
    const h = H(), T = S.teams;
    if (stale(T) && T.status !== 'loading') loadTeams();
    const add = T.canManage ? h.btn('New team', 'data-xteam="new"', false, 'plus') : '';
    const head = h.head({ title: 'Teams', sub: 'Agents grouped for the work they do together.', acts: add }) + nav();
    if (!wsId()) return h.page(head + noWorkspace('Teams'));
    if (T.status === 'error') return h.page(head + failed('Teams', 'teams'));
    if (T.status === 'denied') return h.page(head + denied('teams'));
    if (T.status !== 'ready') return h.page(head + loading('teams'));
    if (!T.list.length) return h.page(head + `<div data-xteams="empty">${h.box('people', 'No teams yet', T.canManage ? 'A team groups agents, and can take on projects together.' : 'Nobody has made a team in this workspace.', add)}</div>`);
    return h.page(head + `<div data-xteams="list">${h.table(['Team', 'Agents', 'Projects'], T.list.map((t) => h.tr(`data-xteam="open" data-id="${esc(t.id)}"`,
      [`<b class="pg-name">${esc(t.name)}</b>`, String(t.agents.length), String(t.projects.length)])))}</div>`);
  }
  function teamPage(id) {
    const h = H(), T = S.teams;
    if (stale(T) && T.status !== 'loading') loadTeams();
    const crumb = '<a data-xteam="tab" data-to="Teams">Teams</a>';
    if (T.status === 'error') return h.page(h.head({ eyebrow: crumb, title: 'Team' }) + failed('This team', 'teams'));
    if (T.status !== 'ready') return h.page(h.head({ eyebrow: crumb, title: 'Team' }) + loading('the team'));
    const t = T.list.find((x) => x.id === id);
    if (!t) return h.page(h.head({ eyebrow: crumb, title: 'Team not found' }) + h.box('people', 'This team is gone', 'It was archived, or it is in another workspace.', h.btn('All teams', 'data-xteam="tab" data-to="Teams"', true)));
    const acts = T.canManage ? h.btn('Edit', `data-xteam="edit" data-id="${esc(t.id)}"`, true) + h.btn('Archive', `data-xteam="archive" data-id="${esc(t.id)}"`, true) : '';
    const list = (title, rows, none) => `<section class="pg-sec"><div class="pg-sec-h"><h3>${esc(title)}</h3></div>${rows.length ? rows.join('') : `<p class="pg-empty-line">${esc(none)}</p>`}</section>`;
    return h.page(h.head({ eyebrow: crumb, title: t.name, sub: t.description || '', acts })
      + `<div data-xteam-page="${esc(t.id)}">`
      + list('Agents', t.agents.length ? [h.table(['Agent', 'Status'], t.agents.map((a) => h.tr(`data-xteam="agent" data-id="${esc(a.id)}"`, [`<b class="pg-name">${esc(a.name)}</b>`, esc(h.cap(a.status || ''))])))] : [], 'No agents in this team yet.')
      + list('Projects', t.projects.length ? [h.table(['Project'], t.projects.map((p) => h.tr(`data-xteam="project" data-id="${esc(p.id)}"`, [`<b class="pg-name">${esc(p.name)}</b>`])))] : [], 'This team is on no projects yet.')
      + '</div>');
  }
  function automationsPage() {
    const h = H(), A = S.auto;
    if (stale(A) && A.status !== 'loading') loadAuto();
    const open = h.btn('Open Automate', 'data-xteam="automate"', true);
    const head = h.head({ title: 'Automations', sub: 'Workflows in this workspace. They are built and run in Dev › Automate.', acts: open }) + nav();
    if (A.status === 'error') return h.page(head + failed('Automations', 'auto'));
    if (A.status === 'denied') return h.page(head + denied('automations'));
    if (A.status !== 'ready') return h.page(head + loading('automations'));
    if (!A.list.length) return h.page(head + `<div data-xauto="empty">${h.box('activity', 'No automations yet', 'Build a workflow in Dev › Automate and it appears here.', open)}</div>`);
    return h.page(head + `<div data-xauto="list">${h.table(['Workflow', 'State', 'Last run'], A.list.map((w) => h.tr(`data-xteam="workflow" data-id="${esc(w.id)}"`,
      [`<b class="pg-name">${esc(w.name)}</b>`, w.state === 'enabled' ? 'On' : 'Off', esc(h.cap(w.lastRun || 'Never'))])))}</div>`);
  }
  const who = (id) => {
    if (!id) return 'XENO';
    if (P.user && String(P.user.id) === id) return 'You';
    const m = (window.XENO_PG_WORKSPACE?.members || []).find((x) => String(x.id) === id);
    return m ? m.name : 'Someone';
  };
  // run.settled -> "Run settled": the type is what the record says; nothing is invented on top of it
  const what = (type) => { const t = String(type || '').replace(/[._]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  function activityPage() {
    const h = H(), E = S.act;
    if (stale(E) && E.status !== 'loading') loadActivity();
    const head = h.head({ title: 'Activity', sub: 'What happened in this workspace, as recorded.' }) + nav();
    if (!wsId()) return h.page(head + noWorkspace('Activity records'));
    if (E.status === 'error') return h.page(head + failed('Activity', 'act'));
    if (E.status === 'denied') return h.page(head + denied('activity'));
    if (E.status !== 'ready') return h.page(head + loading('activity'));
    const hiddenNote = E.hidden ? `<p class="pg-empty-line" data-xact="hidden">${h.plural(E.hidden, 'event', 'events')} here ${E.hidden === 1 ? 'is' : 'are'} not visible to you.</p>` : '';
    if (!E.list.length) return h.page(head + `<div data-xact="empty">${h.box('activity', 'Nothing recorded yet', 'Runs, handoffs and other work appear here as they happen.')}${hiddenNote}</div>`);
    return h.page(head + `<div data-xact="list">${h.table(['What', 'Who', 'When'], E.list.map((e) => h.tr('', [esc(what(e.type)), esc(who(e.actorUserId)), esc(h.ago(e.at))])))}${hiddenNote}${E.more ? h.btn(E.loadingMore ? 'Loading…' : 'Show older', 'data-xteam="older"', true) : ''}</div>`);
  }

  const fields = (t) => {
    const T = S.teams, current = t ? t.agents : [];
    const agents = [...current.map((a) => [a.id, a.name]), ...T.agents.filter((a) => !current.some((c) => c.id === a.id)).map((a) => [a.id, a.name])];
    return [
      { id: 'name', label: 'Name', required: true, value: t?.name || '', max: 80 },
      { id: 'description', label: 'What it does', type: 'textarea', value: t?.description || '', max: 500 },
      ...(agents.length ? [{ id: 'agent_ids', label: 'Agents', type: 'checks', options: agents.map(([v, l]) => [v, l]), value: current.map((a) => a.id) }] : []),
      ...(T.projects.length ? [{ id: 'project_ids', label: 'Projects', type: 'checks', options: T.projects.map((p) => [p.id, p.name]), value: t ? t.projects.map((p) => p.id) : [] }] : []),
    ];
  };
  const bodyFrom = (v, t) => ({ name: v.name, description: v.description || '', agent_ids: v.agent_ids || [], project_ids: v.project_ids || [], ...(t ? { version: t.version } : {}) });
  async function save(t) {
    const v = await D().form({ title: t ? `Edit ${t.name}` : 'New team', submit: t ? 'Save' : 'Create team', fields: fields(t) });
    if (!v) return;
    const base = `/api/workspaces/${encodeURIComponent(wsId())}/teams`;
    const r = t ? await api('PUT', `${base}/${encodeURIComponent(t.id)}`, bodyFrom(v, t)) : await api('POST', base, bodyFrom(v));
    if (!r.ok) { toast(said(r, 'The team could not be saved.')); await loadTeams(); return; }
    await loadTeams();
    const id = t ? t.id : (r.d.team?.id || r.d.id);
    if (id) go(`Teams/${id}`);
    toast(t ? 'Team saved' : 'Team created');
  }
  async function archive(t) {
    if (!(await D().confirm({ title: `Archive ${esc(t.name)}?`, body: 'It stops taking new work and leaves its projects. Its history stays.', action: 'Archive', danger: true }))) return;
    const r = await api('DELETE', `/api/workspaces/${encodeURIComponent(wsId())}/teams/${encodeURIComponent(t.id)}`, { version: t.version });
    if (!r.ok) { toast(said(r, 'The team could not be archived.')); await loadTeams(); return; }
    await loadTeams(); go('Teams'); toast('Team archived');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-xteam]'); if (!b) return;
    const kind = b.getAttribute('data-xteam'), id = b.getAttribute('data-id'), team = () => S.teams.list.find((t) => t.id === id);
    if (kind === 'tab') return go(b.getAttribute('data-to'));
    if (kind === 'open') return go(`Teams/${id}`);
    if (kind === 'new') return save(null);
    if (kind === 'edit' && team()) return save(team());
    if (kind === 'archive' && team()) return archive(team());
    if (kind === 'agent') return go(`Agents/${id}`);
    if (kind === 'project') { const name = ((window.XENO_PG_PROJECTS || {}).items || []).find((x) => String(x.id) === id)?.name; return X()?.go?.('global', { global: 'projects', item: name || id }); }
    if (kind === 'automate') return X()?.go?.('zone', { zone: 'automate' });
    if (kind === 'workflow') return X()?.go?.('zone', { zone: 'automate', item: `workflows/${id}` });
    if (kind === 'older') return loadActivity(true);
    if (kind === 'retry') return ({ teams: loadTeams, auto: loadAuto, act: () => loadActivity() })[b.getAttribute('data-slot')]?.();
  });

  window.XENO_TEAMS = {
    served: true,
    route: (it) => {
      if (it === 'Teams') return teamsPage();
      if (it && it.startsWith('Teams/')) return teamPage(it.slice(6));
      if (it === 'Automations') return automationsPage();
      if (it === 'Activity') return activityPage();
      return null;
    },
    label: (id) => S.teams.list.find((t) => t.id === id)?.name || null,
  };
})();
