/* platform-directory.js — the workspace's People directory, org chart and employee pages, on the platform (xeno-company SPEC §7.3 D-EMP, services/workforcePeople.js).
 *
 *   People            /workspace/workspace/Directory                 the directory (search) of people and agents
 *   Org chart         /workspace/workspace/Directory/org-chart       reporting lines, from the roster + the manager edge
 *   My work           /workspace/workspace/Directory/my-work         your tasks, reviews, runs and reports
 *   a person          /workspace/workspace/Directory/<uuid>          their profile, by id; private fields only when the server sends them
 *   group work        /workspace/workspace/Directory/<reports|division|team>/<uuid>/<7|30|90>   one row per member
 *                     (POST /api/workforce/evaluation/roster)
 *   work report       /workspace/workspace/Directory/<uuid>/work/<7|30|90>   what they directed, did, checked and answer for,
 *                     and the agent runs they started (POST /api/workforce/evaluation): counts, never a score
 *
 *   GET /api/people · GET /api/people/org-chart · GET /api/people/me/work · GET|PATCH /api/people/:id
 *   POST /api/people/time-off · POST /api/people/:id/onboard · GET /api/people/:id/offboard-plan · POST /api/people/:id/offboard
 *
 * The server decides every field: a private block arrives null for whoever may not read it, and nothing here filters it.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_DIRECTORY = { served: false, route: () => null }; return; }
  const X = () => window.XW, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const S = { key: null, status: 'idle', q: '', list: [], canManage: false, chart: null, one: null, work: null };
  const ws = () => { const u = window.XENO_SCOPE?.uuid?.(); if (u && UUID.test(String(u))) return String(u); const w = window.XA?.currentWorkspace?.(); const id = w && (w.uuid || w.id); return id && UUID.test(String(id)) ? String(id) : ''; };

  async function load() {
    const at = S.key, w = ws();
    if (!w && window.XENO_SCOPE && window.XENO_SCOPE.status?.() !== 'ready') { setTimeout(() => { if (S.key === at) load(); }, 250); return; }
    const [kind, id] = at.split(':');
    if (!w && kind === 'eval') {
      // no workspace open: the PERSONAL scope -- your own report, or one of your own agents' (the server decides)
      const [, pid, days] = at.split(':');
      const until = new Date(), since = new Date(until.getTime() - Number(days) * 86_400_000), me = P.user ? String(P.user.id) : '';
      const ev = await api('POST', '/api/workforce/evaluation', { owner: { type: 'user', id: me }, subject: { kind: 'principal', userId: pid },
        window: { since: since.toISOString(), until: until.toISOString() }, expectedActorAccountId: me });
      if (S.key !== at) return;
      if (!ev.ok) { S.status = ev.status === 404 ? 'noreport' : 'error'; return paint(); }
      const name = pid === me ? ((P.user && (P.user.display_name || P.user.username)) || 'You') : (window.XENO_AGENTS?.nameOf?.(pid) || 'Agent');
      S.one = { person: { id: pid, name } }; S.eval = ev.d; S.status = 'ready'; return paint();
    }
    if (!w) { S.status = 'nows'; return paint(); }
    if (kind === 'roster') {
      const [, gkind, gid, days] = at.split(':');
      const until = new Date(), since = new Date(until.getTime() - Number(days) * 86_400_000);
      const r = await api('POST', '/api/workforce/evaluation/roster', { owner: { type: 'workspace', id: w }, group: { kind: gkind, id: gid },
        window: { since: since.toISOString(), until: until.toISOString() }, expectedActorAccountId: P.user ? String(P.user.id) : '' });
      if (S.key !== at) return;
      if (!r.ok) { S.status = r.status === 404 ? 'noreport' : 'error'; return paint(); }
      S.roster = r.d;
      // the group's name: a person's from People; a division's or team's is the word, until it can be read
      S.rosterName = '';
      if (gkind === 'reports') { const one = await api('GET', `/api/people/${gid}?workspace=${w}`); S.rosterName = one.ok ? one.d.person.name : ''; }
      if (S.key !== at) return;
      S.status = 'ready'; return paint();
    }
    if (kind === 'eval') {
      // the person's page first (their name), then the evaluation for the period, both as the reader
      const [, pid, days] = at.split(':');
      const until = new Date(), since = new Date(until.getTime() - Number(days) * 86_400_000);
      const [one, ev] = await Promise.all([api('GET', `/api/people/${pid}?workspace=${w}`),
        api('POST', '/api/workforce/evaluation', { owner: { type: 'workspace', id: w }, subject: { kind: 'principal', userId: pid },
          window: { since: since.toISOString(), until: until.toISOString() }, expectedActorAccountId: P.user ? String(P.user.id) : '' })]);
      if (S.key !== at) return;
      if (!one.ok || !ev.ok) { S.status = (one.status === 404 || ev.status === 404) ? 'noreport' : 'error'; return paint(); }
      S.one = one.d; S.eval = ev.d; S.status = 'ready'; return paint();
    }
    const r = kind === 'list' ? await api('GET', `/api/people?workspace=${w}${S.q ? `&q=${encodeURIComponent(S.q)}` : ''}`)
      : kind === 'chart' ? await api('GET', `/api/people/org-chart?workspace=${w}`)
        : kind === 'work' ? await api('GET', `/api/people/me/work?workspace=${w}`)
          : await api('GET', `/api/people/${id}?workspace=${w}`);
    if (S.key !== at) return;
    if (!r.ok) { S.status = r.status === 404 ? 'missing' : 'error'; return paint(); }
    if (kind === 'list') { S.list = r.d.people || []; S.canManage = !!r.d.canManage; }
    else if (kind === 'chart') S.chart = r.d;
    else if (kind === 'work') S.work = r.d;
    else S.one = r.d;
    S.status = 'ready'; paint();
  }
  const away = (p) => (p.availability && !p.availability.available ? `<span class="pg-dim" data-away="${esc(p.availability.reason)}">${p.availability.reason === 'time_off' ? 'Away' : 'Outside hours'}</span>` : '');
  // the views are tabs in the header bar (the shared XENO_PAGES.h.tabs, lifted by framed()), not a row in the body
  const tabs = (cur) => H().tabs([['Directory', 'Directory'], ['Directory/org-chart', 'Org chart'], ['Directory/my-work', 'My work'],
    ...(window.XENO_PAY?.served ? [['Directory/pay', 'Pay']] : [])], cur, 'data-xdir="tab" data-to');

  function listPage() {
    const h = H();
    const rows = S.list.map((p) => `<li><button class="xdir-row" data-xdir="open" data-id="${esc(p.id)}">${h.avatar({ name: p.name, kind: p.kind })}<b>${esc(p.name)}</b>
        <span>${esc(p.title || (p.kind === 'agent' ? 'Agent' : ''))}</span><span class="pg-dim">${esc(p.division?.name || '')}${p.team ? ' · ' + esc(p.team.name) : ''}</span>${away(p)}</button></li>`).join('');
    return h.page(h.head({ title: 'People', sub: `${h.plural(S.list.length, 'person or agent', 'people and agents')} in this workspace` }) + tabs('Directory')
      + `<form class="xdir-search" data-xdir-form="search"><input name="q" type="search" placeholder="Search by name, title or place" value="${esc(S.q)}" aria-label="Search people"></form>`
      + (rows ? `<ol class="xdir-list">${rows}</ol>` : h.box('user', 'Nobody matches', 'Try another name or title.')), 'xdir');
  }
  function chartPage() {
    const h = H(), c = S.chart, by = new Map(c.nodes.map((n) => [n.id, n]));
    const node = (id, depth, seen) => {
      const n = by.get(id); if (!n || seen.has(id)) return ''; seen.add(id);
      const kids = c.reportsOf[id] || [];
      return `<li style="--d:${depth}"><button data-xdir="open" data-id="${esc(id)}">${h.avatar({ name: n.name, kind: n.kind })}<b>${esc(n.name)}</b> <span>${esc(n.title || '')}</span></button>${kids.length ? `<ol>${kids.map((k) => node(k, depth + 1, seen)).join('')}</ol>` : ''}</li>`;
    };
    const seen = new Set();
    return h.page(h.head({ title: 'Org chart', sub: 'Who reports to whom — people and agents' }) + tabs('Directory/org-chart') + `<ol class="xdir-chart">${c.roots.map((r) => node(r, 0, seen)).join('')}</ol>`, 'xdir');
  }
  function workPage() {
    const h = H(), w = S.work;
    const sec = (title, items, fmt) => `<section><h3>${title}</h3>${items.length ? `<ul>${items.map(fmt).join('')}</ul>` : '<p class="pg-dim">Nothing here.</p>'}</section>`;
    const mine = P.user ? h.btn('My work report', `data-xdir="tab" data-to="Directory/${esc(String(P.user.id))}/work/30"`, false, 'chart')
      + ((w.reports || []).length ? h.btn('My reports’ work', `data-xdir="tab" data-to="Directory/reports/${esc(String(P.user.id))}/30"`, false, 'users') : '') : '';
    return h.page(h.head({ title: 'My work', sub: 'What is yours in this workspace', acts: mine }) + tabs('Directory/my-work')
      + sec('Open tasks', w.tasks || [], (t) => `<li><a href="/workspace/tasks/${esc(t.key)}">${esc(t.key)}</a> ${esc(t.title)} <span class="pg-dim">${esc(t.status)}</span></li>`)
      + sec('Waiting for your review', w.approvals || [], (t) => `<li><a href="/workspace/tasks/${esc(t.key)}">${esc(t.key)}</a> ${esc(t.title)}</li>`)
      + sec('Recent runs', w.runs || [], (r) => `<li>${esc(r.task_key || '')} <span class="pg-dim">${esc(r.state)}</span></li>`)
      + sec('Your reports', w.reports || [], (p) => `<li><button data-xdir="open" data-id="${esc(p.id)}">${esc(p.name)}</button> ${away(p)}</li>`), 'xdir');
  }
  // A person's (or an agent's) work for a period: counts over the records behind them, never a score
  // (services/workforceEvaluation.js, LIFE-04). Who may read it is the server's answer: an admin of the
  // workspace, or the person themselves.
  const PERIODS = [7, 30, 90];
  function evalPage(pid, days) {
    const h = H(), e = S.eval, p = S.one.person, t = e.tasks;
    const n = (v) => Number(v || 0).toLocaleString();
    const tile = (label, value, hint = '') => `<div class="xdir-tile"><b>${value}</b><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;
    const group = (title, sub, tiles) => `<section class="pg-sec"><h3>${title}</h3><p class="pg-dim xdir-sec-sub">${sub}</p><div class="xdir-tiles">${tiles.join('')}</div></section>`;
    const secs = (s) => (s == null ? '—' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
    const stopped = Object.values(e.runs.stopped || {}).reduce((a, b) => a + Number(b), 0);
    // plain facts drawn from the counts, never a verdict about the person
    const facts = [];
    if (t) {
      if (t.outcomes.done && t.outcomes.neverReviewed === t.outcomes.done) facts.push(`None of the ${n(t.outcomes.done)} finished tasks went through a review.`);
      else if (t.outcomes.neverReviewed) facts.push(`${n(t.outcomes.neverReviewed)} of ${n(t.outcomes.done)} finished tasks were never reviewed.`);
      if (t.outcomes.closedByAgent) facts.push(`An agent closed ${n(t.outcomes.closedByAgent)} task${t.outcomes.closedByAgent === 1 ? '' : 's'} itself.`);
      const decided = t.reviews.accepted + t.reviews.changesRequested;
      if (decided && t.reviews.decidedWithinAMinute) facts.push(`${n(t.reviews.decidedWithinAMinute)} of ${n(decided)} review decisions were made within a minute of the work arriving.`);
      if (t.mine.delegatedToAgents && !decided) facts.push(`${n(t.mine.delegatedToAgents)} tasks were handed to agents, and no review decision was made.`);
    }
    const tabs = h.tabs(PERIODS.map((d) => [`Directory/${pid}/work/${d}`, `${d} days`]), `Directory/${pid}/work/${days}`, 'data-xdir="tab" data-to');
    const back = h.btn(p.name, `data-xdir="open" data-id="${esc(pid)}"`, false, 'user');
    return h.page(h.head({ title: `Work · ${p.name}`, sub: `The last ${days} days ${e.owner?.type === 'user' ? 'in your personal space' : 'in this workspace'}`, acts: back }) + tabs
      + (facts.length ? `<ul class="xdir-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '')
      + (t ? group('Directed', 'Work they set up and handed out.', [tile('Tasks created', n(t.mine.created)), tile('Handed to agents', n(t.mine.delegatedToAgents)), tile('Assigned to people', n(t.mine.assignedToOthers))])
        + group('Did themselves', 'Their own moves on tasks.', [tile('Started', n(t.mine.started)), tile('Sent for review', n(t.mine.submittedForReview)), tile('Closed without review', n(t.mine.closedWithoutReview)), tile('Comments', n(t.mine.comments))])
        + group('Checked', 'Review decisions on work that came to them.', [tile('Accepted', n(t.reviews.accepted)), tile('Changes asked', n(t.reviews.changesRequested)), tile('Decided within a minute', n(t.reviews.decidedWithinAMinute)), tile('Typical review time', secs(t.reviews.medianSeconds), 'median, from arrival in review')])
        + group('Finished work they answer for', 'Tasks assigned or delegated to them that reached done.', [tile('Finished', n(t.outcomes.done)), tile('Done by an agent', n(t.outcomes.viaAgent)), tile('Accepted by a person', n(t.outcomes.acceptedByHuman)), tile('Closed by an agent', n(t.outcomes.closedByAgent)), tile('Never reviewed', n(t.outcomes.neverReviewed))])
        : '')
      + spendGroup(e, t, group, tile, n)
      + group('Agent runs', 'Runs they started for agents, and their limits.', [tile('Runs started', n(e.runs.admitted)), tile('Sub-runs', n(e.runs.children)), tile('Still running at the end', n(e.runs.activeAtEnd)), tile('Stopped', n(stopped))])
      + (e.handoffs ? group('Handoffs', 'Work passed between people and agents.', [tile('Sent', n(Object.values(e.handoffs.sent).reduce((a, b) => a + b, 0))), tile('Received', n(Object.values(e.handoffs.received).reduce((a, b) => a + b, 0))), tile('Accepted from others', n(e.handoffs.received.accepted))]) : '')
      + `<p class="pg-dim xdir-note">Counts of what happened on the work, each backed by its records — no score, no activity tracking (no keystrokes, screens or time at the desk).${e.closed ? '' : ' This period is still open, so the last few minutes can still change.'}${e.notRecorded?.length ? ` Not counted yet: ${e.notRecorded.map((k) => ({ contributions: 'contributions', settlements: 'credits spent' }[k] || k)).join(', ')}.` : ''}</p>`, 'xdir');
  }
  // credits as charged: 1 credit = 1,000,000 micro-credits (utils/creditCosts.js)
  const cr = (micro) => { const v = Number(BigInt(String(micro || '0')) / 10000n) / 100; return v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 2 : 0 }); };
  function spendGroup(e, t, group, tile, n) {
    const sp = e.spend; if (!sp) return '';
    const done = t?.outcomes.done || 0;
    if (sp.usage === 'counted') {
      const per = done ? cr(BigInt(sp.paid.micro) / BigInt(done)) : '—';
      return group('Credits', 'What they paid in this period, as charged.', [tile('Paid', cr(sp.paid.micro), `${n(sp.paid.requests)} requests`),
        tile('Through agents', cr(sp.paid.viaAgentsMicro), sp.byAgent.length ? `${sp.byAgent.length} agent${sp.byAgent.length === 1 ? '' : 's'}` : ''),
        tile('Spent as an agent', cr(sp.asAgent.micro)), tile('Agent images and video', cr(sp.agentMediaMicro)), tile('Per finished task', per, 'paid ÷ finished')]);
    }
    const runs = BigInt(sp.runs.settledMicro);
    return group('Credits', 'Charges tied to this workspace: the agent runs they started here.', [tile('Runs charged', cr(sp.runs.settledMicro)),
      tile('Reserved on running work', cr(sp.runs.reservedMicro)), tile('Agent images and video', cr(sp.agentMediaMicro)),
      tile('Per finished task', done && runs ? cr(runs / BigInt(done)) : '—', 'runs charged ÷ finished')])
      + '<p class="pg-dim xdir-note">Chat and other usage are billed to the person, not to a workspace, so they show on their personal report.</p>';
  }

  // A group's work: one row per member, the same figures as each member's own report.
  const GROUPS = { reports: 'Reports', division: 'Division', team: 'Team' };
  function rosterPage(kind, id, days) {
    const h = H(), ro = S.roster;
    const title = kind === 'reports' ? `Work · ${S.rosterName || 'Their'} reports` : `Work · ${S.rosterName || GROUPS[kind]}`;
    const tabs = h.tabs(PERIODS.map((d) => [`Directory/${kind}/${id}/${d}`, `${d} days`]), `Directory/${kind}/${id}/${days}`, 'data-xdir="tab" data-to');
    const num = (v) => Number(v || 0).toLocaleString();
    const cols = ['Name', 'Created', 'To agents', 'Reviews', 'Within a minute', 'Finished', 'Never reviewed', 'Closed by agent', 'Runs', 'Credits'];
    const cells = (m) => [num(m.tasksCreated), num(m.delegatedToAgents), num(m.reviewDecisions), num(m.decidedWithinAMinute), num(m.done), num(m.neverReviewed), num(m.closedByAgent), num(m.runs), cr(m.spentMicro)];
    const rows = ro.members.map((m) => h.tr(`data-xdir="tab" data-to="Directory/${esc(m.principalId)}/work/${days}"`, [`${h.avatar({ name: m.name, kind: m.kind })}<b class="pg-name">${esc(m.name)}</b>`, ...cells(m)]));
    const total = h.tr('', ['<b>Total</b>', ...cells(ro.total)]);
    return h.page(h.head({ title, sub: `The last ${days} days · ${h.plural(ro.members.length, 'member', 'members')}` }) + tabs
      + (ro.members.length ? h.table(cols, [...rows, total]) : h.box('user', 'Nobody in this group yet', kind === 'reports' ? 'Nobody reports to this person in People.' : 'People join it from their profile in People.'))
      + `<p class="pg-dim xdir-note">Each row is that member’s own work report — counts backed by records, never a score. Credits: runs charged in this workspace.${ro.truncated ? ' Showing the first 100 members.' : ''}</p>`, 'xdir');
  }
  function personPage() {
    const h = H(), o = S.one, p = o.person;
    const f = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : '');
    const hours = p.workingHours ? `${p.workingHours.start}–${p.workingHours.end}, days ${p.workingHours.days.join(',')}` : '';
    const acts = [h.btn('Work report', `data-xdir="tab" data-to="Directory/${esc(p.id)}/work/30"`, false, 'chart'),
      o.reports.length ? h.btn('Their reports’ work', `data-xdir="tab" data-to="Directory/reports/${esc(p.id)}/30"`, false, 'users') : '',
      p.team?.id ? h.btn('Team’s work', `data-xdir="tab" data-to="Directory/team/${esc(p.team.id)}/30"`, false, 'users') : '',
      p.division?.id ? h.btn('Division’s work', `data-xdir="tab" data-to="Directory/division/${esc(p.division.id)}/30"`, false, 'layers') : '', o.canEditHr || o.canEditOwn ? h.btn('Edit', 'data-xdir="edit"', false, 'edit') : '', o.canEditOwn || o.canEditHr ? h.btn('Time off', 'data-xdir="time-off"', false, 'calendar') : '',
      o.canEditHr ? h.btn('Start onboarding', 'data-xdir="onboard"', false, 'check') : '', o.canEditHr ? h.btn('Offboard', 'data-xdir="offboard"', false, 'logout') : ''].join('');
    return h.page(h.head({ title: p.name, sub: [p.title, p.division?.name, p.team?.name].filter(Boolean).join(' · ') || (p.kind === 'agent' ? 'Agent' : 'Member'), acts }) + tabs('')
      + `<dl class="xdir-dl">${f('Kind', p.kind)}${f('Role', p.role)}${f('Started', p.startDate)}${f('Location', p.location)}${f('Time zone', p.timezone)}${f('Working hours', hours)}${f('Available now', p.availability.available ? 'Yes' : p.availability.reason === 'time_off' ? 'Away' : 'Outside hours')}</dl>`
      + (o.managerChain.length ? `<p>Reports to ${o.managerChain.map((m) => `<button data-xdir="open" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join(' → ')}</p>` : '')
      + (o.reports.length ? `<p>Reports: ${o.reports.map((m) => `<button data-xdir="open" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join(', ')}</p>` : '')
      + (p.private ? `<section class="xdir-private" data-private="1"><h3>Private</h3><dl class="xdir-dl">${f('Phone', p.private.phone)}${f('Emergency contact', p.private.emergencyContact)}${f('Notes', p.private.notes)}</dl>${(p.private.timeOff || []).map((t) => `<p>${esc(t.kind)}: ${esc(new Date(t.startsAt).toLocaleDateString())} – ${esc(new Date(t.endsAt).toLocaleDateString())}</p>`).join('')}</section>` : ''), 'xdir');
  }

  async function edit() {
    const o = S.one, p = o.person, fields = [];
    if (o.canEditHr) fields.push({ id: 'title', label: 'Title', value: p.title }, { id: 'managerId', label: 'Manager (user id)', value: p.managerId || '' }, { id: 'startDate', label: 'Start date (YYYY-MM-DD)', value: p.startDate || '' });
    fields.push({ id: 'location', label: 'Location', value: p.location }, { id: 'timezone', label: 'Time zone', value: p.timezone }, { id: 'start', label: 'Working from (HH:MM)', value: p.workingHours?.start || '' }, { id: 'end', label: 'Working until (HH:MM)', value: p.workingHours?.end || '' });
    const v = await window.XD.form({ title: `Edit ${p.name}`, fields });
    if (!v) return;
    const body = { workspaceId: ws(), expectedRevision: p.revision, location: v.location, timezone: v.timezone };
    if (v.start && v.end) body.workingHours = { days: [1, 2, 3, 4, 5], start: v.start, end: v.end };
    if (o.canEditHr) Object.assign(body, { title: v.title, managerId: v.managerId || null, startDate: v.startDate || null });
    const r = await api('PATCH', `/api/people/${p.id}`, body);
    if (!r.ok) return toast(r.d.error || 'Not saved.');
    S.one = r.d; toast('Saved'); paint();
  }
  async function timeOff() {
    const v = await window.XD.form({ title: 'Book time off', fields: [{ id: 'from', label: 'From (YYYY-MM-DD)', required: true }, { id: 'to', label: 'Until (YYYY-MM-DD)', required: true }, { id: 'kind', label: 'Kind', type: 'choice', value: 'vacation', options: [['vacation', 'Vacation'], ['sick', 'Sick'], ['leave', 'Leave'], ['other', 'Other']] }, { id: 'note', label: 'Note (private)' }] });
    if (!v) return;
    const r = await api('POST', '/api/people/time-off', { workspaceId: ws(), principalId: S.one.person.id, startsAt: `${v.from}T00:00:00Z`, endsAt: `${v.to}T23:59:59Z`, kind: v.kind, note: v.note });
    if (!r.ok) return toast(r.d.error || 'Not booked.');
    toast('Time off booked'); S.key = null; paint();
  }
  async function onboard() {
    const r = await api('POST', `/api/people/${S.one.person.id}/onboard`, { workspaceId: ws() });
    if (!r.ok) return toast(r.d.error || 'Onboarding could not start.');
    toast(r.d.replayed ? 'Onboarding was already started' : `Onboarding started: ${r.d.onboarding.tasks.length} tasks`);
  }
  async function offboard() {
    const p = S.one.person, pl = await api('GET', `/api/people/${p.id}/offboard-plan?workspace=${ws()}`);
    if (!pl.ok) return toast(pl.d.error || 'Not allowed.');
    const plan = pl.d.plan;
    const ok = await window.XD.confirm?.({ title: `Offboard ${p.name}?`, body: `Access is removed. ${plan.reportsToSuccessor.length} report(s) and ${plan.divisionsToSuccessor.length} division(s) move to their manager. ${plan.ownedElsewhere.length} thing(s) they own themselves need their own transfer. ${plan.openTasks} open task(s).`, action: 'Offboard' });
    if (!ok) return;
    const r = await api('POST', `/api/people/${p.id}/offboard`, { workspaceId: ws(), confirm: true });
    if (!r.ok) return toast(r.d.error || 'Not offboarded.');
    toast('Offboarded'); go('Directory');
  }

  function route(it) {
    if (it !== 'Directory' && !(it || '').startsWith('Directory/')) return null;
    if (/^Directory\/pay(\/|$)/.test(it)) return window.XENO_PAY?.route?.(it) ?? null;   // People › Pay (platform-pay.js)
    const h = H(), sub = it.slice(10);
    const wm = sub.match(/^([0-9a-f-]{36})\/work(?:\/(7|30|90))?$/i);
    const gm = sub.match(/^(reports|division|team)\/([0-9a-f-]{36})(?:\/(7|30|90))?$/i);
    const key = !sub ? 'list:' + S.q : sub === 'org-chart' ? 'chart:' : sub === 'my-work' ? 'work:' : UUID.test(sub) ? 'one:' + sub.toLowerCase()
      : wm && UUID.test(wm[1]) ? `eval:${wm[1].toLowerCase()}:${wm[2] || 30}`
        : gm && UUID.test(gm[2]) ? `roster:${gm[1]}:${gm[2].toLowerCase()}:${gm[3] || 30}` : 'bad:';
    if (key === 'bad:') return h.page(h.head({ title: 'Person not found' }) + h.box('user', 'This link is not valid', 'People are addressed by their id.'), 'xdir');
    if (S.key !== key) { S.key = key; S.status = 'loading'; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xdv-skel" aria-busy="true"><i></i><i></i><i></i></div>', 'xdir');
    if (S.status === 'nows') return h.page(h.box('user', 'Open a workspace first', 'People belong to a workspace.'), 'xdir');
    if (S.status === 'missing') return h.page(h.head({ title: 'Not found' }) + h.box('user', 'Not in this workspace', 'Or you cannot see it.'), 'xdir');
    if (S.status === 'noreport') return h.page(h.head({ title: 'Work report' }) + h.box('lock', 'You cannot see this report', 'A work report is shown to an admin of this workspace, or to the person it is about.'), 'xdir');
    if (S.status === 'error') return h.page(h.box('alert', 'People could not be loaded just now', 'Nothing changed. Try again.'), 'xdir');
    if (key.startsWith('eval:')) { const [, pid, days] = key.split(':'); return evalPage(pid, Number(days)); }
    if (key.startsWith('roster:')) { const [, kind, id, days] = key.split(':'); return rosterPage(kind, id, Number(days)); }
    return key.startsWith('list') ? listPage() : key === 'chart:' ? chartPage() : key === 'work:' ? workPage() : personPage();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xdir]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xdir;
    if (a === 'open') return go(`Directory/${b.dataset.id}`);
    if (a === 'tab') return go(b.dataset.to);
    if (a === 'edit') return edit();
    if (a === 'time-off') return timeOff();
    if (a === 'onboard') return onboard();
    if (a === 'offboard') return offboard();
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-xdir-form="search"]'); if (!f) return;
    e.preventDefault(); S.q = String(new FormData(f).get('q') || '').trim(); S.key = null; paint();
  });
  // breadcrumb words for Directory/<id>/work/<days>
  const label = (x, i, parts) => (i === 2 && x === 'work' ? 'Work report' : i === 3 && parts[2] === 'work' && /^\d+$/.test(x) ? `${x} days`
    : i === 1 && x === 'pay' ? 'Pay' : i === 2 && parts[1] === 'pay' ? (window.XENO_PAY?.label?.(x, parts[3]) || x) : i === 3 && parts[1] === 'pay' ? (x === 'week' ? 'Weekly' : 'Monthly')
    : i === 1 && GROUPS[x] ? `${GROUPS[x]} work` : i === 2 && GROUPS[parts[1]] ? (S.rosterName || GROUPS[parts[1]]) : i === 3 && GROUPS[parts[1]] && /^\d+$/.test(x) ? `${x} days` : x);
  window.XENO_DIRECTORY = { served: true, route, label, isId: (s) => UUID.test(String(s || '')), nameOf: (id) => (S.one?.person?.id === id ? S.one.person.name : S.list.find((p) => p.id === id)?.name || 'Person') };
})();
