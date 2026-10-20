/* platform-directory.js — the workspace's People directory, org chart and employee pages, on the platform (xeno-company SPEC §7.3 D-EMP, services/workforcePeople.js).
 *
 *   People            /workspace/workspace/Directory                 the directory (search) of people and agents
 *   Org chart         /workspace/workspace/Directory/org-chart       reporting lines, from the roster + the manager edge
 *   My work           /workspace/workspace/Directory/my-work         your tasks, reviews, runs and reports
 *   a person          /workspace/workspace/Directory/<uuid>          their profile, by id; private fields only when the server sends them
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
    if (!w) { if (window.XENO_SCOPE && window.XENO_SCOPE.status?.() !== 'ready') { setTimeout(() => { if (S.key === at) load(); }, 250); return; } S.status = 'nows'; return paint(); }
    const [kind, id] = at.split(':');
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
  const tabs = (cur) => `<nav class="xdir-tabs">${[['Directory', 'Directory'], ['Directory/org-chart', 'Org chart'], ['Directory/my-work', 'My work']].map(([k, l]) => `<button data-xdir="tab" data-to="${k}"${k === cur ? ' aria-current="page"' : ''}>${l}</button>`).join('')}</nav>`;

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
    return h.page(h.head({ title: 'My work', sub: 'What is yours in this workspace' }) + tabs('Directory/my-work')
      + sec('Open tasks', w.tasks || [], (t) => `<li><a href="/workspace/tasks/${esc(t.key)}">${esc(t.key)}</a> ${esc(t.title)} <span class="pg-dim">${esc(t.status)}</span></li>`)
      + sec('Waiting for your review', w.approvals || [], (t) => `<li><a href="/workspace/tasks/${esc(t.key)}">${esc(t.key)}</a> ${esc(t.title)}</li>`)
      + sec('Recent runs', w.runs || [], (r) => `<li>${esc(r.task_key || '')} <span class="pg-dim">${esc(r.state)}</span></li>`)
      + sec('Your reports', w.reports || [], (p) => `<li><button data-xdir="open" data-id="${esc(p.id)}">${esc(p.name)}</button> ${away(p)}</li>`), 'xdir');
  }
  function personPage() {
    const h = H(), o = S.one, p = o.person;
    const f = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : '');
    const hours = p.workingHours ? `${p.workingHours.start}–${p.workingHours.end}, days ${p.workingHours.days.join(',')}` : '';
    const acts = [o.canEditHr || o.canEditOwn ? h.btn('Edit', 'data-xdir="edit"', false, 'edit') : '', o.canEditOwn || o.canEditHr ? h.btn('Time off', 'data-xdir="time-off"', false, 'calendar') : '',
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
    const h = H(), sub = it.slice(10);
    const key = !sub ? 'list:' + S.q : sub === 'org-chart' ? 'chart:' : sub === 'my-work' ? 'work:' : UUID.test(sub) ? 'one:' + sub.toLowerCase() : 'bad:';
    if (key === 'bad:') return h.page(h.head({ title: 'Person not found' }) + h.box('user', 'This link is not valid', 'People are addressed by their id.'), 'xdir');
    if (S.key !== key) { S.key = key; S.status = 'loading'; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xdv-skel" aria-busy="true"><i></i><i></i><i></i></div>', 'xdir');
    if (S.status === 'nows') return h.page(h.box('user', 'Open a workspace first', 'People belong to a workspace.'), 'xdir');
    if (S.status === 'missing') return h.page(h.head({ title: 'Not found' }) + h.box('user', 'Not in this workspace', 'Or you cannot see it.'), 'xdir');
    if (S.status === 'error') return h.page(h.box('alert', 'People could not be loaded just now', 'Nothing changed. Try again.'), 'xdir');
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
  window.XENO_DIRECTORY = { served: true, route, isId: (s) => UUID.test(String(s || '')), nameOf: (id) => (S.one?.person?.id === id ? S.one.person.name : S.list.find((p) => p.id === id)?.name || 'Person') };
})();
