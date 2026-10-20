/* platform-divisions.js — on the platform, the workspace's Divisions pages are REAL (XENO-WORKFORCE-01 DIV-01..10).
 *
 *   Divisions        /workspace/divisions                         the org chart of this workspace — optional, none by default
 *   a division       /workspace/divisions/<uuid>                  its HOME, by id: head, sub-divisions, members, agents,
 *                                                                 objectives, active runs, spend vs budget, funding,
 *                                                                 projects, handoffs and decisions
 *   (the old /workspace/workspace/Divisions[/<uuid>] still opens it; address.js rewrites it in place)
 *
 * The home is ONE server read (GET /api/divisions/:id/home → the scoped read division:<id>/home). The server decides
 * every row: what this reader may not see arrives closed (a count), and nothing here filters it.
 *
 * A division is a department inside a workspace: it owns agents and projects, has a head, and is a boundary — an
 * agent works only on projects in its own division (the server refuses the rest). Only a workspace admin changes
 * divisions. Archive is one-way: what is in it keeps it as its division, nothing new joins.
 *
 *   GET|POST /api/divisions · GET|PATCH /api/divisions/:id · POST /api/divisions/:id/archive
 *   GET /api/divisions/:id/home · POST /api/workforce/coordination/objectives[/update|/complete] · POST /api/workforce/run-admissions/revoke
 *   PUT /api/divisions/projects/:projectId · GET /api/agents · GET /api/tasks/projects · PUT /api/agents/:id/division
 *
 * Served from disk (no platform), the sample pages in workforce.js stay as they are.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_DIVISIONS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k);
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.error || r.d.message)) || d;
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const S = { key: null, status: 'idle', list: [], canManage: false, workspaceId: null, one: null, agents: [], projects: [], busy: false, archived: [], budget: null, spend: [], home: null };

  const workspaceParam = () => { const w = window.XA?.currentWorkspace?.(); return w && UUID.test(String(w.id)) ? `?workspace=${w.id}` : ''; };

  async function load() {
    const at = S.key;
    const [l, la] = await Promise.all([api('GET', '/api/divisions' + workspaceParam()), api('GET', '/api/divisions' + (workspaceParam() ? workspaceParam() + '&' : '?') + 'archived=1')]);
    if (S.key !== at) return;
    if (!l.ok) { S.status = l.status === 403 ? 'denied' : 'error'; return paint(); }
    S.list = l.d.divisions || []; S.canManage = !!l.d.canManage; S.workspaceId = l.d.workspaceId;
    S.archived = la.ok ? (la.d.divisions || []).filter((d) => d.lifecycle === 'archived') : [];
    const id = at.startsWith('one:') ? at.slice(4) : null;
    if (id) {
      const [one, ag, pr, hm] = await Promise.all([api('GET', `/api/divisions/${id}`), api('GET', '/api/agents'), api('GET', '/api/tasks/projects'), api('GET', `/api/divisions/${id}/home`)]);
      if (S.key !== at) return;
      if (one.status === 404) { S.status = 'missing'; return paint(); }
      if (!one.ok) { S.status = 'error'; return paint(); }
      S.one = one.d.division; S.home = hm.ok ? hm.d.home : null; S.audit = null; loadAudit(S.one.id); S.agents = ag.ok ? ag.d.agents || [] : []; S.projects = pr.ok ? pr.d.projects || [] : [];
      const bg = await api('GET', `/api/divisions/${id}/agent-budget`); S.budget = bg.ok ? bg.d.budget : null; S.spend = bg.ok ? bg.d.spend || [] : [];
    }
    S.status = 'ready'; paint();
  }
  /** Re-read the current view in place (the key stays, so the router does not start a second load). */
  const refresh = () => load();

  // ───────── the org chart
  const children = (id) => S.list.filter((d) => d.parentId === id);
  function listPage() {
    const h = H();
    const acts = S.canManage ? h.btn('New division', 'data-xdv="new"', !S.list.length, 'plus') : '';
    if (!S.list.length) {
      return h.page(h.head({ title: 'Divisions', sub: 'Departments inside this workspace — optional', acts })
        + `<div class="wf-empty"><div class="wf-empty-org">${['Creative', 'Dev', 'Platform'].map((n, i) => `<span style="--i:${i}"><b>${n}</b><i></i><i></i></span>`).join('')}</div>
          <h3>No divisions — and that’s fine</h3>
          <p>A small workspace doesn’t need them. When you grow, a division groups agents and projects into a department with its own head — and it is a real boundary: an agent in Creative can only work on Creative’s projects.</p>
          ${S.canManage ? h.btn('Create the first division', 'data-xdv="new"', false, 'plus') : '<p class="pg-dim">A workspace admin can create them.</p>'}</div>`
        + (S.archived.length ? archivedNote() : ''), 'xdv');
    }
    const node = (d, depth) => {
      const kids = children(d.id);
      return `<li class="wf-node" style="--d:${depth}"><button class="wf-div" data-xdv="open" data-id="${esc(d.id)}">
          <span class="wf-div-h"><b>${esc(d.name)}</b>${d.head ? `<span class="wf-head">${h.avatar({ name: d.head.name, kind: d.head.kind })}${esc(d.head.name)}</span>` : '<span class="pg-dim">No head</span>'}</span>
          <span class="wf-div-f"><span>${h.plural(d.agents, 'agent', 'agents')} · ${h.plural(d.projects, 'project', 'projects')}</span>${kids.length ? `<span class="pg-dim">${h.plural(kids.length, 'division', 'divisions')} inside</span>` : ''}</span></button>
        ${kids.length ? `<ol>${kids.map((k) => node(k, depth + 1)).join('')}</ol>` : ''}</li>`;
    };
    const roots = S.list.filter((d) => !d.parentId || !S.list.some((x) => x.id === d.parentId));
    return h.page(h.head({ title: 'Divisions', sub: `${h.plural(S.list.length, 'division', 'divisions')} · who heads them, and what works in each`, acts })
      + `<ol class="wf-org">${roots.map((d) => node(d, 0)).join('')}</ol>`
      + `<p class="pg-rule">${ic('lock')}A division is a boundary. Its agents work only on its projects, and a grant on a division never reaches the divisions inside it.</p>`
      + (S.archived.length ? archivedNote() : ''), 'xdv');
  }
  const archivedNote = () => `<p class="pg-dim wf-note">Archived: ${S.archived.map((d) => `<a data-xdv="open" data-id="${esc(d.id)}">${esc(d.name)}</a>`).join(', ')}</p>`;

  // ───────── one division
  function onePage() {
    const h = H(), d = S.one; if (!d) return null;
    const archived = d.lifecycle === 'archived';
    const asCanvas = window.XENO_CANVAS?.served ? h.btn('Open as canvas', `data-xcv-open="division" data-id="${esc(d.id)}"`, true, 'grid') : '';
    const acts = asCanvas + (d.canManage && !archived ? h.btn('Set head', 'data-xdv="head"', true, 'user') + h.btn('Rename', 'data-xdv="rename"', true, 'edit') + h.btn('New division inside', 'data-xdv="new-inside"', true, 'plus') + h.btn('Archive', 'data-xdv="archive"', true, 'archive') + h.btn('Propose this division from documents', `data-xsu="open-docs" data-idea="${esc('The ' + d.name + ' division: ')}"`, true, 'plus') : '');
    const myAgents = new Set(d.agentsList.map((a) => a.id));
    const outside = S.agents.filter((a) => !myAgents.has(a.id));
    const myProjects = new Set(d.projectsList.map((p) => p.id));
    const projectsOut = S.projects.filter((p) => !myProjects.has(p.id));
    const agentRows = d.agentsList.length ? d.agentsList.map((a) => h.tr(`data-xdv="agent" data-id="${esc(a.id)}"`, [`${h.avatar({ name: a.name, kind: 'agent' })}<b class="pg-name">${esc(a.name)}</b>`, `<small class="pg-dim">${esc(a.description || '')}</small>`])).join('')
      : '';
    return h.page(h.head({ obj: true, title: d.name, sub: archived ? 'Archived — nothing new joins; what is in it keeps it' : (d.parent ? `Inside ${d.parent.name}` : 'Division'), acts })
      + (archived ? `<p class="wf-warn">${ic('archive')}Archived${d.archivedAt ? ' on ' + esc(new Date(d.archivedAt).toLocaleDateString()) : ''}. Nothing new can join it; what is in it keeps it as its division.</p>` : '')
      + `<div class="pg-cols pg-cols--item"><div>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Agents</h3>${d.canManage && !archived && outside.length ? h.btn('Add an agent', 'data-xdv="add-agent"', true, 'plus') : ''}</div>
          ${d.agentsList.length ? h.table(['Agent', 'What it is for'], d.agentsList.map((a) => h.tr(`data-xdv="agent" data-id="${esc(a.id)}"`, [`${h.avatar({ name: a.name, kind: 'agent' })}<b class="pg-name">${esc(a.name)}</b>`, `<small class="pg-dim">${esc(a.description || '')}</small>`]))) : h.box('bot', 'No agents in this division yet', 'Add one. It will work only on this division’s projects.', '', 'sm')}</section>
        ${homeSections(d, archived)}
        ${auditSection()}
        <section class="pg-sec"><div class="pg-sec-h"><h3>Agent budget</h3>${d.canManage && !archived ? h.btn(S.budget ? 'Change' : 'Set a budget', 'data-xdv="budget"', true, S.budget ? 'edit' : 'plus') : ''}</div>
          ${S.budget ? `<div class="xdv-budget"><div class="xdv-meter" role="meter" aria-valuemin="0" aria-valuemax="${S.budget.limitCredits}" aria-valuenow="${S.budget.spentCredits}" aria-label="Spent of the agent budget"><i style="width:${Math.min(100, S.budget.limitCredits ? (S.budget.spentCredits / S.budget.limitCredits) * 100 : 100).toFixed(1)}%"></i></div>
            <p><b>${fmt(S.budget.spentCredits)}</b> of ${fmt(S.budget.limitCredits)} credits used in the last ${S.budget.windowDays === 30 ? 'month' : S.budget.windowDays + ' days'} · ${fmt(S.budget.leftCredits)} left</p>
            <p class="pg-dim wf-note">${S.budget.autoApprove ? 'Its agents’ images and videos start at once while they fit in the budget. Past it, they are refused.' : 'Its agents’ images and videos still wait for the person who answers for each agent to approve them. Model calls stop when the budget is used up.'}</p></div>
            ${S.spend.length ? h.table(['Agent', 'What', 'Credits', 'When'], S.spend.slice(0, 12).map((x) => h.tr(`data-xdv="agent" data-id="${esc(x.agent.id)}"`, [`<b class="pg-name">${esc(x.agent.name)}</b>`, esc(SPEND_KIND[x.kind] || x.kind) + (x.released ? ' <small class="pg-dim">(given back)</small>' : ''), fmt(x.credits), `<small class="pg-dim">${esc(new Date(x.at).toLocaleString())}</small>`]))) : ''}`
            : `<p class="pg-dim">No budget. Its agents’ images, videos and model calls are billed to the person who answers for each agent, and every image or video waits for them to approve it.${d.canManage && !archived ? ' Set a budget to cap what this division’s agents spend, and to let them generate within it without waiting.' : ''}</p>`}</section>
        ${d.children.length ? `<section class="pg-sec"><h3>Inside it</h3><div class="pg-chips">${d.children.map((k) => `<a class="pg-chip" data-xdv="open" data-id="${esc(k.id)}">${esc(k.name)}</a>`).join('')}</div><p class="pg-dim wf-note">Its agents and head do not reach the divisions inside it — each is its own boundary.</p></section>` : ''}
      </div><aside><dl class="pg-props">
        <dt>Head</dt><dd>${d.head ? esc(d.head.name) + (d.head.kind === 'agent' ? ' (agent)' : '') : '—'}</dd>
        <dt>Inside</dt><dd>${d.parent ? `<a data-xdv="open" data-id="${esc(d.parent.id)}">${esc(d.parent.name)}</a>` : 'The workspace'}</dd>
        <dt>Agents</dt><dd>${d.agentsList.length}</dd><dt>Projects</dt><dd>${d.projectsList.length}</dd>
        <dt>Created</dt><dd>${esc(new Date(d.createdAt).toLocaleDateString())}</dd></dl>
        <p class="pg-dim wf-note">${d.canManage ? 'You can change this division because you administer the workspace.' : 'Only a workspace admin changes divisions.'} Its head works inside it, but cannot widen it.</p></aside></div>`, 'xdv');
  }

  // ───────── the home: every part as the server decided it for this reader
  const closedNote = (n, what) => (n ? `<p class="pg-dim wf-note xdv-closed">${ic('lock')}${n} ${what} you cannot see ${n === 1 ? 'is' : 'are'} closed to you.</p>` : '');
  const day = (x) => (x ? esc(new Date(x).toLocaleDateString()) : '—');
  const DECISION = { 'member.promote': 'New head', 'member.admit': 'Admitted', 'member.remove': 'Removed', 'division.assign': 'Assigned', 'division.transfer': 'Transferred', 'budget.set': 'Budget set' };
  function homeSections(d, archived) {
    const h = H(), m = S.home;
    if (!m) return '<section class="pg-sec"><h3>Projects</h3><p class="pg-dim">This division’s home could not be read just now.</p></section>';
    const live = !archived;
    const people = [...m.directMembers.map((x) => ({ ...x, via: x.isHead ? 'Head' : x.relation === 'editor' ? 'Works in it' : 'Member' })),
      ...m.teams.flatMap((t) => t.members.map((x) => ({ ...x, via: `${t.name} · ${x.role}` })))];
    const objectives = m.objectives.map((o) => `<li class="xdv-obj" data-oid="${esc(o.id)}"><div class="xdv-obj-h"><b>${esc(o.title)}</b><span class="pg-dim">${o.status === 'completed' ? 'Completed' : `${day(o.windowStart)} – ${day(o.windowEnd)}`}</span></div>
        <div class="xdv-meter" role="meter" aria-valuemin="0" aria-valuemax="${o.goals}" aria-valuenow="${o.goalsDone}" aria-label="Goals done"><i style="width:${(o.progress * 100).toFixed(1)}%"></i></div>
        <p class="pg-dim">${o.goals ? `${o.goalsDone} of ${h.plural(o.goals, 'goal', 'goals')} done` : 'No goals roll up to it yet'} · ${esc(o.successEvidence)} · ${esc(o.owner.name)}</p>
        ${live && o.status === 'open' ? `<span class="xdv-acts">${h.btn('Edit', `data-xdv="obj-edit" data-id="${esc(o.id)}"`, true, 'edit')}${o.goals && o.goals === o.goalsDone ? h.btn('Complete', `data-xdv="obj-done" data-id="${esc(o.id)}"`, true, 'check') : ''}</span>` : ''}</li>`).join('');
    const runs = m.runs.rows.map((r) => h.tr(`data-xdv="run" data-id="${esc(r.id)}"`, [`<b class="pg-name">${esc(r.agent)}</b>`, r.project ? esc(r.project.name) : `<span class="pg-dim">${esc(r.target)}</span>`,
      `<span class="xdv-auth xdv-auth--${esc(r.authority.state)}">${r.authority.state === 'live' ? 'Live' : r.authority.state === 'idle' ? 'Idle' : 'Admitted'}</span>`, `${fmt(r.budgetCredits)} credits`,
      r.canStop && live ? h.btn('Stop', `data-xdv="run-stop" data-id="${esc(r.id)}"`, true, 'x') : '']));
    return `<section class="pg-sec" data-sec="members"><div class="pg-sec-h"><h3>Members</h3></div>
        ${people.length ? h.table(['Who', 'How'], people.map((x) => h.tr('', [`${h.avatar({ name: x.name, kind: x.kind })}<b class="pg-name">${esc(x.name)}</b>${x.kind === 'agent' ? ' <small class="pg-dim">agent</small>' : ''}`, `<small class="pg-dim">${esc(x.via)}</small>`]))) : h.box('user', 'Nobody works in it yet', 'Its head and the members of its teams appear here.', '', 'sm')}</section>
      <section class="pg-sec" data-sec="objectives"><div class="pg-sec-h"><h3>Objectives</h3>${live ? h.btn('New objective', 'data-xdv="obj-new"', true, 'plus') : ''}</div>
        ${objectives ? `<ol class="xdv-objs">${objectives}</ol>` : h.box('flag', 'No objectives yet', 'An objective is what this division commits to for a window. Goals in its projects roll up to it.', '', 'sm')}</section>
      <section class="pg-sec" data-sec="runs"><div class="pg-sec-h"><h3>Active runs</h3></div>
        ${runs.length ? h.table(['Agent', 'Working on', 'Authority', 'Ceiling', ''], runs) : '<p class="pg-dim">No runs are active in this division.</p>'}${closedNote(m.runs.hidden, m.runs.hidden === 1 ? 'run' : 'runs')}</section>
      <section class="pg-sec" data-sec="projects"><div class="pg-sec-h"><h3>Projects</h3>${d.canManage && live ? h.btn('Move a project here', 'data-xdv="add-project"', true, 'plus') : ''}</div>
        ${m.projects.rows.length ? `<div class="pg-chips">${m.projects.rows.map((p) => `<span class="pg-chip"><a data-xdv="project" data-id="${esc(p.id)}">${ic('folder')}${esc(p.name)}</a>${d.canManage && live ? `<button class="xdv-x" data-xdv="remove-project" data-id="${esc(p.id)}" aria-label="Take ${esc(p.name)} out of ${esc(d.name)}">${ic('x')}</button>` : ''}</span>`).join('')}</div>` : m.projects.hidden ? '' : h.box('folder', 'No projects in this division yet', 'Move a project here. Only this division’s agents can then work on it.', '', 'sm')}
        ${closedNote(m.projects.hidden, m.projects.hidden === 1 ? 'project' : 'projects')}</section>
      ${m.funding.rows.length || m.funding.hidden ? `<section class="pg-sec" data-sec="funding"><h3>Funding pools</h3>${m.funding.rows.length ? h.table(['Pool', 'Status', 'Balance'], m.funding.rows.map((f) => h.tr('', [esc(f.milestone || f.beneficiary), esc(f.status), `${fmt(f.balanceCredits)} credits`]))) : ''}${closedNote(m.funding.hidden, m.funding.hidden === 1 ? 'pool' : 'pools')}</section>` : ''}
      ${m.handoffs.rows.length || m.handoffs.hidden ? `<section class="pg-sec" data-sec="handoffs"><h3>Handoffs</h3>${m.handoffs.rows.length ? h.table(['From', 'To', 'Work', 'State'], m.handoffs.rows.map((x) => h.tr('', [esc(x.from.name), esc(x.to.name), esc(x.work.type), esc(x.state)]))) : ''}${closedNote(m.handoffs.hidden, m.handoffs.hidden === 1 ? 'handoff' : 'handoffs')}</section>` : ''}
      ${m.decisions.length ? `<section class="pg-sec" data-sec="decisions"><h3>Decisions</h3>${h.table(['Decision', 'By', 'Why', 'When'], m.decisions.map((x) => h.tr('', [esc(DECISION[x.kind] || x.kind), esc(x.by), `<small class="pg-dim">${esc(x.rationale || '—')}</small>`, day(x.at)])))}</section>` : ''}`;
  }

  // ───────── the audit view (§15): this division's workforce events, each row decided for the reader on the server
  async function loadAudit(id) {
    const r = await api('GET', '/api/audit/events?scope=division:' + encodeURIComponent(id) + '&limit=30').catch(() => null);
    if (!S.one || S.one.id !== id) return;
    S.audit = r && r.ok ? r.d : { events: [], hidden: 0, failed: true }; paint();
  }
  const EVENT = { 'division.created': 'Division created', 'division.updated': 'Division changed', 'division.archived': 'Division archived', 'run.admitted': 'Run admitted', 'run.revoked': 'Run stopped',
    'run.lease_issued': 'Run step authorized', 'run.result_reported': 'Run finished', 'orchestrator.edge_added': 'Dependency added', 'orchestrator.edge_removed': 'Dependency removed',
    'orchestrator.plan_created': 'Plan created', 'orchestrator.attempt_started': 'Attempt started' };
  const eventLabel = (t) => EVENT[t] || t.replace(/^[a-z]+\./, '').replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
  function auditSection() {
    const h = H(), a = S.audit;
    if (!a) return '<section class="pg-sec" data-sec="activity"><h3>Activity</h3><p class="pg-dim">Loading…</p></section>';
    if (a.failed) return '<section class="pg-sec" data-sec="activity"><h3>Activity</h3><p class="pg-dim">The activity could not be read just now.</p></section>';
    return `<section class="pg-sec" data-sec="activity"><h3>Activity</h3>
      ${a.events.length ? h.table(['What', 'Detail', 'When'], a.events.map((e) => h.tr(`data-xdv-event="${esc(e.id)}"`, [esc(eventLabel(e.type)),
        `<small class="pg-dim">${esc(e.data && (e.data.reason || e.data.outcome || e.data.operation) || e.subject.kind)}</small>`, esc(new Date(e.at).toLocaleString())]))) : '<p class="pg-dim">Nothing has happened in this division yet.</p>'}
      ${closedNote(a.hidden, a.hidden === 1 ? 'event' : 'events')}</section>`;
  }

  // ───────── routing
  function route(it) {
    if (it !== 'Divisions' && !(it || '').startsWith('Divisions/')) return null;
    style();
    const id = it.startsWith('Divisions/') ? it.slice(10) : null;
    const h = H();
    if (id && !UUID.test(id)) return h.page(h.head({ title: 'Division not found' }) + h.box('layers', 'This division link is not valid', 'Divisions are addressed by their id. Open it from the org chart.', h.btn('All divisions', 'data-xdv="list"', true)), 'xdv');
    const key = id ? 'one:' + id.toLowerCase() : 'list';
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xdv-skel" aria-busy="true"><i></i><i></i><i></i></div>', 'xdv');
    if (S.status === 'error') return h.page(h.box('alert', 'Divisions could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xdv="retry"')), 'xdv');
    if (S.status === 'denied') return h.page(h.box('lock', 'Only a person manages divisions', 'Sign in as yourself.'), 'xdv');
    if (S.status === 'missing') return h.page(h.head({ title: 'Division not found' }) + h.box('layers', 'This division is gone', 'It is not in this workspace, or you cannot see it.', h.btn('All divisions', 'data-xdv="list"', true)), 'xdv');
    return id ? onePage() : listPage();
  }
  const nameOf = (id) => { const d = (S.one && S.one.id === id) ? S.one : S.list.find((x) => x.id === id) || S.archived.find((x) => x.id === id); return d ? d.name : 'Division'; };

  // ───────── actions
  async function call(method, path, body, fail) {
    if (S.busy) return null;
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) { toast(why(r, fail)); paint(); return null; }
    return r;
  }
  async function create(parentId) {
    const opts = S.list.map((d) => [d.id, d.name, '']);
    const v = await D().form({ title: parentId ? `New division inside ${S.one ? S.one.name : ''}` : 'New division', sub: 'A department inside this workspace. You choose its head and what works in it next.', submit: 'Create division', size: 'sm', fields: [
      { id: 'name', label: 'Name', required: true, placeholder: 'Creative', max: 120 },
      ...(parentId || !opts.length ? [] : [{ id: 'parent', label: 'Inside', type: 'choice', cols: 1, value: '', options: [['', 'The workspace', 'A top-level division'], ...opts] }])] });
    if (!v) return;
    const r = await call('POST', '/api/divisions', { name: v.name, parentId: parentId || v.parent || null, workspaceId: S.workspaceId }, 'The division could not be created.');
    if (r) { toast(`Created ${r.d.division.name}`); S.list.push(r.d.division); go(`Divisions/${r.d.division.id}`); }
  }
  async function rename() {
    const d = S.one; const v = await D().form({ title: `Rename ${d.name}`, sub: 'Its id stays the same, so every link keeps working.', submit: 'Save', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, value: d.name, max: 120 }] });
    if (!v) return;
    const r = await call('PATCH', `/api/divisions/${d.id}`, { name: v.name }, 'That could not be saved.');
    if (r) { S.one = r.d.division; toast('Saved'); paint(); }
  }
  async function head() {
    const d = S.one;
    const people = await api('GET', `/api/workspaces/${S.workspaceId}/members`);
    const humans = people.ok ? (people.d.members || []).map((m) => [String(m.user_id || m.id), m.display_name || m.username || m.email || 'Someone', 'Person']) : [];
    const agents = S.agents.map((a) => [a.userId, a.name, 'Agent']);
    const options = [['', 'No head', 'The division has no head'], ...humans, ...agents];
    const v = await D().form({ title: `Head of ${d.name}`, sub: 'The head works inside this division. They cannot widen it or raise its budget — a workspace admin does that.', submit: 'Set head', size: 'sm', fields: [
      { id: 'head', label: 'Head', type: 'choice', cols: 1, value: d.head ? d.head.id : '', options },
      { id: 'reason', label: 'Why (recorded with the decision)', type: 'textarea', rows: 2, placeholder: 'Leads the design team', max: 2000 }] });
    if (!v) return;
    const r = await call('PATCH', `/api/divisions/${d.id}`, { headId: v.head || null, reason: v.reason || '' }, 'The head could not be changed.');
    if (r) { S.one = r.d.division; toast(r.d.division.head ? `${r.d.division.head.name} heads ${d.name}` : 'No head now'); await refresh(); }
  }
  async function archive() {
    const d = S.one;
    if (!(await D().confirm({ title: `Archive ${esc(d.name)}?`, body: `Nothing new can join ${esc(d.name)}. Its agents and projects keep it as their division, and its history stays. This cannot be undone.`, action: 'Archive' }))) return;
    const r = await call('POST', `/api/divisions/${d.id}/archive`, undefined, 'It could not be archived.');
    if (r) { toast(`Archived ${d.name}`); S.one = r.d.division; await refresh(); }
  }
  async function addAgent() {
    const d = S.one, mine = new Set(d.agentsList.map((a) => a.id));
    const out = S.agents.filter((a) => !mine.has(a.id));
    const v = await D().form({ title: `Add an agent to ${d.name}`, sub: 'An agent belongs to one division. Its projects outside this division are taken away.', submit: 'Add', size: 'sm', fields: [
      { id: 'agent', label: 'Agent', type: 'choice', cols: 1, required: true, options: out.map((a) => [a.id, a.name, a.division ? `Now in ${a.division.name}` : 'In no division']) }] });
    if (!v) return;
    const r = await call('PUT', `/api/agents/${v.agent}/division`, { divisionId: d.id }, 'The agent could not be moved.');
    if (r) { toast(`${r.d.agent.name} now works in ${d.name}`); await refresh(); }
  }
  async function addProject() {
    const d = S.one, mine = new Set(d.projectsList.map((p) => p.id));
    const out = S.projects.filter((p) => !mine.has(p.id));
    const v = await D().form({ title: `Move a project into ${d.name}`, sub: 'Agents in other divisions lose access to it at once.', submit: 'Move', size: 'sm', fields: [
      { id: 'project', label: 'Project', type: 'choice', cols: 1, required: true, options: out.map((p) => [p.id, p.name, '']) }] });
    if (!v) return;
    const r = await call('PUT', `/api/divisions/projects/${v.project}`, { divisionId: d.id }, 'The project could not be moved.');
    if (r) { toast(r.d.agentsRemoved ? `Moved. ${r.d.agentsRemoved} agent${r.d.agentsRemoved > 1 ? 's' : ''} from other divisions lost access.` : 'Moved'); await refresh(); }
  }
  async function removeProject(pid) {
    const d = S.one, p = d.projectsList.find((x) => x.id === pid);
    if (!(await D().confirm({ title: `Take ${esc(p ? p.name : 'this project')} out of ${esc(d.name)}?`, body: `It becomes a workspace-level project. ${esc(d.name)}’s agents lose access to it.`, action: 'Take out', danger: false }))) return;
    const r = await call('PUT', `/api/divisions/projects/${pid}`, { divisionId: null }, 'It could not be moved.');
    if (r) { toast('Taken out'); await refresh(); }
  }

  // objectives and runs are written by their OWN services (LIFE-08, RUN-03); the home only re-reads afterwards
  const isoDay = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '').trim()) ? null : 'A date like 2026-12-31');
  async function newObjective() {
    const d = S.one; if (!d) return;
    const today = new Date().toISOString().slice(0, 10), q = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    const v = await D().form({ title: `New objective for ${d.name}`, sub: 'What this division commits to for a window. Goals in its projects roll up to it.', submit: 'Create objective', fields: [
      { id: 'title', label: 'Objective', required: true, max: 200 }, { id: 'ev', label: 'How we will know', type: 'textarea', rows: 2, required: true, max: 2000 },
      { id: 'start', label: 'From', required: true, value: today, validate: isoDay }, { id: 'end', label: 'Until', required: true, value: q, validate: isoDay }] });
    if (!v) return;
    const r = await call('POST', '/api/workforce/coordination/objectives', { workspaceId: d.workspaceId, divisionId: d.id, title: v.title, successEvidence: v.ev, windowStart: v.start.trim(), windowEnd: v.end.trim() }, 'The objective could not be created.');
    if (r) { toast('Objective created'); await refresh(); }
  }
  async function editObjective(oid) {
    const o = S.home && S.home.objectives.find((x) => x.id === oid); if (!o) return;
    const v = await D().form({ title: 'Edit objective', submit: 'Save', fields: [{ id: 'title', label: 'Objective', required: true, value: o.title, max: 200 }, { id: 'ev', label: 'How we will know', type: 'textarea', rows: 2, required: true, value: o.successEvidence, max: 2000 },
      { id: 'end', label: 'Until (leave empty to keep)', validate: (x) => (!String(x || '').trim() ? null : isoDay(x)) }] });
    if (!v) return;
    const body = { objectiveId: oid, title: v.title, successEvidence: v.ev }; if (String(v.end || '').trim()) body.windowEnd = v.end.trim();
    const r = await call('POST', '/api/workforce/coordination/objectives/update', body, 'That could not be saved.');
    if (r) { toast('Saved'); await refresh(); }
  }
  async function completeObjective(oid) {
    const r = await call('POST', '/api/workforce/coordination/objectives/complete', { objectiveId: oid }, 'It could not be completed.');
    if (r) { toast('Objective completed'); await refresh(); }
  }
  async function stopRun(aid) {
    if (!(await D().confirm({ title: 'Stop this run?', body: 'It can authorize nothing further. Work already done stays.', action: 'Stop' }))) return;
    const r = await call('POST', '/api/workforce/run-admissions/revoke', { admissionId: aid }, 'The run could not be stopped.');
    if (r) { toast('Run stopped'); await refresh(); }
  }

  const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const SPEND_KIND = { image: 'Image', video: 'Video', model: 'Model call' };
  async function setBudget() {
    const d = S.one; if (!d) return;
    const v = await window.XD.form({ title: `Agent budget for ${d.name}`, sub: 'What this division’s agents may spend on images, videos and model calls. It is a cap, not a wallet: the money still comes from the person who answers for each agent.', submit: 'Save', size: 'sm', fields: [
      { id: 'credits', label: 'Credits', type: 'number', required: true, value: S.budget ? String(S.budget.limitCredits) : '100', max: 12, validate: (x) => (/^\d+(\.\d{1,2})?$/.test(String(x).trim()) && Number(x) <= 10000000 ? null : 'A number of credits, up to 10,000,000.') },
      { id: 'window', label: 'Per', type: 'choice', cols: 3, value: S.budget ? String(S.budget.windowDays) : '30', options: [['7', 'Week'], ['30', 'Month'], ['365', 'Year']] },
      { id: 'auto', label: 'Images and videos', type: 'choice', cols: 1, value: S.budget && S.budget.autoApprove ? 'auto' : 'ask', options: [['ask', 'Wait for approval', 'The person who answers for the agent approves each one'], ['auto', 'Start within the budget', 'They start at once while they fit; past the budget they are refused']] }] });
    if (!v) return;
    S.busy = true; paint();
    const r = await api('PUT', `/api/divisions/${d.id}/agent-budget`, { credits: Number(v.credits), windowDays: Number(v.window), autoApprove: v.auto === 'auto' });
    S.busy = false;
    if (!r.ok) { X()?.toast?.((r.d && r.d.error) || 'The budget could not be saved.'); return paint(); }
    S.budget = r.d.budget;
    const bg = await api('GET', `/api/divisions/${d.id}/agent-budget`); if (bg.ok) { S.budget = bg.d.budget; S.spend = bg.d.spend || []; }
    X()?.toast?.('Budget saved'); paint();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xdv]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xdv;
    if (a === 'open') return go(`Divisions/${b.dataset.id}`);
    if (a === 'list') return go('Divisions');
    if (a === 'agent') return go(`Agents/${b.dataset.id}`);
    if (a === 'new') return create(null);
    if (a === 'new-inside') return create(S.one && S.one.id);
    if (a === 'rename') return rename();
    if (a === 'head') return head();
    if (a === 'archive') return archive();
    if (a === 'add-agent') return addAgent();
    if (a === 'budget') return setBudget();
    if (a === 'add-project') return addProject();
    if (a === 'remove-project') { e.stopPropagation(); return removeProject(b.dataset.id); }
    if (a === 'obj-new') return newObjective();
    if (a === 'obj-edit') return editObjective(b.dataset.id);
    if (a === 'obj-done') return completeObjective(b.dataset.id);
    if (a === 'run-stop') { e.stopPropagation(); return stopRun(b.dataset.id); }
    if (a === 'project') return X()?.go?.('global', { global: 'projects', item: ((window.XENO_PG_PROJECTS || {}).items || []).find((x) => String(x.id) === b.dataset.id)?.name || b.dataset.id });
    if (a === 'retry') { S.key = null; return paint(); }
  });

  const style = () => {
    if (document.getElementById('xdv-css')) return; const s = document.createElement('style'); s.id = 'xdv-css';
    s.textContent = '.xdv-budget p{margin:8px 0 0;font-size:13px}.xdv-meter{height:6px;border-radius:3px;background:var(--hover);overflow:hidden}.xdv-meter i{display:block;height:100%;background:var(--text);border-radius:3px}.xdv-x{display:inline-grid;place-items:center;width:18px;height:18px;margin:0 -4px 0 4px;border:0;border-radius:5px;background:none;color:var(--muted);cursor:pointer}.xdv-x:hover{background:var(--hover);color:var(--text)}.xdv-x svg{width:12px;height:12px}.xdv-objs{list-style:none;margin:0;padding:0;display:grid;gap:10px}.xdv-obj{padding:12px;border-radius:10px;background:var(--panel)}.xdv-obj-h{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}.xdv-obj p{margin:8px 0 0;font-size:12px}.xdv-acts{display:flex;gap:6px;margin-top:8px}.xdv-auth{font-size:12px;color:var(--muted)}.xdv-auth--live{color:var(--text);font-weight:600}'
      + '.xdv-skel{display:grid;gap:8px;padding-top:60px;max-width:720px}.xdv-skel i{height:72px;border-radius:10px;background:var(--panel);animation:xdvs 1.2s ease-in-out infinite alternate}@keyframes xdvs{to{opacity:.5}}';
    document.head.appendChild(s);
  };

  // the sidebar names the real divisions
  setTimeout(async () => { if (S.list.length) return; const r = await api('GET', '/api/divisions' + workspaceParam()); if (r.ok) { S.list = r.d.divisions || []; S.canManage = !!r.d.canManage; S.workspaceId = r.d.workspaceId; window.XENO_PG_SYNC_NAV?.(); paint(); } }, 1500);
  window.XENO_DIVISIONS = { served: true, route, nameOf, isId: (s) => UUID.test(String(s || '')), list: () => S.list, reload: () => { S.key = null; paint(); } };
})();
