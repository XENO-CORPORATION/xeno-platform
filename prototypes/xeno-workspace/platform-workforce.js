/* platform-workforce.js — the workforce screens a project and an agent need on the real platform (XENO-WORKFORCE-01).
 *
 *   Objectives        /workspace/projects/<pid>/objectives              the workspace objectives this project's goals roll up to (LIFE-08)
 *   an objective      /workspace/projects/<pid>/objectives/<oid>        its success evidence, window, owner and goals; edit, link, complete
 *   Runs              /workspace/projects/<pid>/runs                    the run admissions targeting this project (RUN-01/02)
 *   a run             /workspace/projects/<pid>/runs/<admission id>     the pin, payer, budget, capabilities and LIVE authority; revoke (RUN-03)
 *                     /workspace/workspace/Agents/<agent id>/runs/<admission id>   the same run, reached from the agent page
 *   Changes           /workspace/projects/<pid>/changes                 change requests and recorded branch intents (FORGE-01/02, SES-09)
 *   a change request  /workspace/projects/<pid>/changes/<cr id>         checks, reviews; approve / request changes / reject
 *
 * Every view is addressed by ids with its parent in the path; the server decides visibility, and a record the person
 * cannot see answers like one that does not exist. Served from disk (no platform), these tabs do not appear.
 *
 *   POST /api/workforce/run-admissions/list|read|authority|revoke
 *   POST /api/workforce/coordination/projects/tree · objectives · objectives/update|read|complete|link-goal
 *   POST /api/workforce/forge/change-requests/list|read|checks|reviews|review · /api/workforce/sessions/branch-intents/list
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_WFP = { served: false, tabs: [] }; return; }
  const X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const api = (path, body) => P.api('POST', '/api/workforce' + path, body).catch(() => ({ ok: false, status: 0, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.reason || r.d.error || r.d.code)) || d;
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { if (window.XENO_PAGES?.repaint && document.querySelector('#main .mview')) window.XENO_PAGES.repaint(); else X()?.render?.(); } catch {} };
  const credits = (micro) => (Number(BigInt(String(micro || '0')) / 10000n) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ''; } };
  const short = (id) => String(id || '').slice(0, 8);

  // one cache entry per view; a view reads once, then repaints from it
  const C = new Map();
  function view(key, loader) {
    const c = C.get(key);
    if (c) return c;
    const e = { status: 'loading', d: null };
    C.set(key, e);
    loader().then((d) => { e.status = d === null ? 'missing' : 'ready'; e.d = d; paint(); }, () => { e.status = 'error'; paint(); });
    return e;
  }
  const drop = (prefix) => { for (const k of [...C.keys()]) if (k.startsWith(prefix)) C.delete(k); };
  const unwrap = (r) => (r.ok ? r.d : r.status === 404 ? null : Promise.reject(new Error(why(r, 'failed'))));

  const RUN_STATE = { admitted: 'Admitted', running: 'Running', waiting: 'Waiting', completed: 'Completed', failed: 'Failed', revoked: 'Revoked', paused: 'Paused' };
  const TARGET = { personal: 'Personal', workspace: 'Workspace', project: 'Project' };

  // ───────── Runs
  function runsTab(rec, h) {
    const e = view(`runs:${rec.id}`, async () => unwrap(await api('/run-admissions/list', { projectId: rec.id })));
    if (e.status === 'loading') return h.box('refresh', 'Loading runs', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Runs could not be read', 'Try again in a moment.', h.btn('Retry', `data-xwp="retry" data-k="runs:${esc(rec.id)}"`, true), 'sm');
    const rows = e.d.admissions || [];
    if (!rows.length) return h.box('bot', 'No runs yet', 'When an agent is admitted to run on this project, the admission — what it may do, who pays, and its live authority — is listed here.', '', 'sm');
    return h.table(['Run', 'Agent', 'Budget', 'Admitted'], rows.map((a) => h.tr(`data-xwp="open" data-to="${esc(rec.name)}/Runs/${esc(a.admissionId)}"`, [
      `<b class="pg-name">Run ${esc(short(a.admissionId))}</b>${a.taskRef ? `<small>${esc(a.taskRef)}</small>` : ''}`,
      `<small>v${esc(a.agent.version)} · ${esc(short(a.agent.resourceId))}</small>`, `${esc(credits(a.budget.ceilingMicro))} credits`, `<small>${esc(when(a.admittedAt))}</small>`])));
  }
  function runDetail(aid, h, back) {
    if (!UUID.test(aid)) return h.box('x', 'Not found', 'This run does not exist, or you cannot see it.', '', 'sm');
    const e = view(`run:${aid}`, async () => {
      const [a, au] = await Promise.all([api('/run-admissions/read', { admissionId: aid }), api('/run-admissions/authority', { admissionId: aid })]);
      const ad = await unwrap(a); if (ad === null) return null;
      return { admission: ad.admission || ad, authority: au.ok ? au.d : null };
    });
    if (e.status === 'loading') return h.box('refresh', 'Loading this run', '', '', 'sm');
    if (e.status === 'missing') return h.box('x', 'Not found', 'This run does not exist, or you cannot see it.', back, 'sm');
    if (e.status !== 'ready') return h.box('x', 'This run could not be read', 'Try again in a moment.', h.btn('Retry', `data-xwp="retry" data-k="run:${esc(aid)}"`, true), 'sm');
    const a = e.d.admission, au = e.d.authority;
    const live = au ? (au.revoked ? 'Revoked' : RUN_STATE[au.state] || 'Live') : 'Unknown';
    const caps = (a.capabilities.effective || []).map((c) => `<span class="pg-chip">${esc(c)}</span>`).join('') || '<span class="pg-dim">None</span>';
    return `<div class="xwp-bar"><span>${back}</span><span class="pg-sp"></span>${au && !au.revoked ? h.btn('Revoke run', `data-xwp="revoke" data-id="${esc(aid)}"`, true, 'x') : ''}</div>
      <div class="pg-cols pg-cols--item"><div>
        <section class="pg-sec"><h3>Live authority</h3><p>${h.chip(live)}${au && au.revokedAt ? ` <small class="pg-dim">since ${esc(when(au.revokedAt))}${au.reason ? ' · ' + esc(au.reason) : ''}</small>` : ''}</p>
          ${au && au.remainingMicro !== undefined ? `<p><b>${esc(credits(au.remainingMicro))}</b> credits left of ${esc(credits(a.budget.ceilingMicro))}</p>` : ''}
          ${au && au.durableReason ? `<p class="pg-dim">${esc(au.durableReason)}</p>` : ''}
          <p class="pg-dim wf-note">Re-derived from live rows before every step the run takes; revoking stops it at the next one (RUN-03).</p></section>
        <section class="pg-sec"><h3>May do</h3><div class="pg-chips">${caps}</div></section></div>
      <aside><dl class="pg-props"><dt>Run</dt><dd><code>${esc(a.admissionId)}</code></dd><dt>Agent</dt><dd><code>${esc(short(a.agent.resourceId))}</code> v${esc(a.agent.version)}</dd>
        <dt>Target</dt><dd>${esc(TARGET[a.target.kind] || a.target.kind)}</dd><dt>Paid by</dt><dd>${esc(a.payer.kind)}</dd><dt>Budget</dt><dd>${esc(credits(a.budget.ceilingMicro))} credits</dd>
        ${a.parent ? `<dt>Parent run</dt><dd><code>${esc(short(a.parent.admissionId))}</code> · depth ${esc(a.parent.depth)}</dd>` : ''}${a.taskRef ? `<dt>Task</dt><dd>${esc(a.taskRef)}</dd>` : ''}<dt>Admitted</dt><dd>${esc(when(a.admittedAt))}</dd></dl></aside></div>`;
  }
  async function revoke(aid) {
    if (!(await D().confirm({ title: 'Revoke this run?', body: 'It stops at its next step and cannot take another. What it already did stays.', action: 'Revoke', danger: true }))) return;
    const r = await api('/run-admissions/revoke', { admissionId: aid });
    if (!r.ok) return toast(`Not revoked: ${why(r, 'try again')}`);
    toast('Revoked'); drop(`run:${aid}`); drop('runs:'); paint();
  }

  // ───────── Objectives
  function objectivesTab(rec, h) {
    if (!rec.workspaceUuid) return h.box('folder', 'Objectives live in a workspace', 'Move this project into a workspace to roll its goals up to the workspace’s objectives.', '', 'sm');
    const e = view(`tree:${rec.id}`, async () => (await unwrap(await api('/coordination/projects/tree', { projectId: rec.id })))?.result ?? null);
    if (e.status === 'loading') return h.box('refresh', 'Loading objectives', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Objectives could not be read', 'Try again in a moment.', h.btn('Retry', `data-xwp="retry" data-k="tree:${esc(rec.id)}"`, true), 'sm');
    const t = e.d, acts = `<div class="xwp-bar"><span class="pg-dim">Above this project’s goals: what the workspace is trying to achieve</span><span class="pg-sp"></span>${h.btn('New objective', `data-xwp="new-objective" data-p="${esc(rec.name)}"`, false, 'plus')}</div>`;
    const free = t.goals.filter((g) => !g.objectiveId);
    const list = t.objectives.length ? h.table(['Objective', 'Window', 'Goals', 'State'], t.objectives.map((o) => h.tr(`data-xwp="open" data-to="${esc(rec.name)}/Objectives/${esc(o.objectiveId)}"`, [
      `<b class="pg-name">${esc(o.title)}</b><small>${esc(o.successEvidence)}</small>`, `<small>${esc(o.windowStart)} → ${esc(o.windowEnd)}</small>`,
      `${o.progress.completed}/${o.progress.goals}`, h.chip(o.status === 'completed' ? 'Done' : 'Open')]))) : h.box('check', 'No objectives yet', 'An objective is what the workspace commits to for a window, with the evidence that proves it. Goals in projects roll up to it.', '', 'sm');
    return acts + list + (free.length ? `<section class="pg-sec"><h3>Goals not under an objective <em>${free.length}</em></h3><ul class="xwp-goals">${free.map((g) => `<li><span>${esc(g.title)}</span>${h.chip(g.status === 'completed' ? 'Done' : 'Open')}</li>`).join('')}</ul></section>` : '');
  }
  function objectiveDetail(rec, oid, h, back) {
    if (!UUID.test(oid)) return h.box('x', 'Not found', 'This objective does not exist, or you cannot see it.', back, 'sm');
    const e = view(`obj:${oid}`, async () => (await unwrap(await api('/coordination/objectives/read', { objectiveId: oid })))?.result ?? null);
    if (e.status === 'loading') return h.box('refresh', 'Loading this objective', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Not found', 'This objective does not exist, or you cannot see it.', back, 'sm');
    const o = e.d, open = o.status === 'open';
    const acts = open ? h.btn('Edit', `data-xwp="edit-objective" data-id="${esc(oid)}"`, true, 'edit') + h.btn('Link a goal', `data-xwp="link-goal" data-id="${esc(oid)}" data-p="${esc(rec.name)}"`, true, 'plus') + h.btn('Complete', `data-xwp="complete-objective" data-id="${esc(oid)}"`, false, 'check') : '';
    return `<div class="xwp-bar"><span>${back}</span><span class="pg-sp"></span>${acts}</div>
      <div class="pg-cols pg-cols--item"><div><section class="pg-sec"><h3>${esc(o.title)}</h3><p>${esc(o.successEvidence)}</p></section>
        <section class="pg-sec"><h3>Goals <em>${o.progress.completed}/${o.progress.goals}</em></h3>${o.goals.length ? `<ul class="xwp-goals">${o.goals.map((g) => `<li><span>${esc(g.title)}</span>${h.chip(g.status === 'completed' ? 'Done' : 'Open')}</li>`).join('')}</ul>` : '<p class="pg-dim">No goals roll up to it yet.</p>'}
          <p class="pg-dim wf-note">It completes only when every goal under it has (LIFE-08).</p></section></div>
      <aside><dl class="pg-props"><dt>State</dt><dd>${h.chip(open ? 'Open' : 'Done')}</dd><dt>Scope</dt><dd>${o.divisionId ? 'Division' : 'Workspace'}</dd></dl></aside></div>`;
  }
  const isoDay = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x).trim()) ? null : 'A date as YYYY-MM-DD.');
  async function newObjective(pname) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === pname); if (!rec) return;
    const today = new Date().toISOString().slice(0, 10), q = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    const v = await D().form({ title: 'New objective', sub: 'The workspace commits to it for a window. Goals in its projects roll up to it.', submit: 'Create objective', fields: [
      { id: 'title', label: 'Objective', required: true, max: 200 }, { id: 'ev', label: 'How we will know', type: 'textarea', rows: 2, required: true, max: 2000 },
      { id: 'start', label: 'From', required: true, value: today, validate: isoDay }, { id: 'end', label: 'Until', required: true, value: q, validate: isoDay }] });
    if (!v) return;
    const r = await api('/coordination/objectives', { workspaceId: rec.workspaceUuid, title: v.title, successEvidence: v.ev, windowStart: v.start.trim(), windowEnd: v.end.trim() });
    if (!r.ok) return toast(`Not created: ${why(r, 'try again')}`);
    toast('Objective created'); drop(`tree:${rec.id}`); X().go('global', { global: 'projects', item: `${pname}/Objectives/${r.d.result.objectiveId}` });
  }
  async function editObjective(oid) {
    const o = C.get(`obj:${oid}`)?.d; if (!o) return;
    const v = await D().form({ title: 'Edit objective', submit: 'Save', fields: [{ id: 'title', label: 'Objective', required: true, value: o.title, max: 200 }, { id: 'ev', label: 'How we will know', type: 'textarea', rows: 2, required: true, value: o.successEvidence, max: 2000 },
      { id: 'end', label: 'Until (leave empty to keep)', validate: (x) => (!String(x || '').trim() ? null : isoDay(x)) }] });
    if (!v) return;
    const body = { objectiveId: oid, title: v.title, successEvidence: v.ev }; if (String(v.end || '').trim()) body.windowEnd = v.end.trim();
    const r = await api('/coordination/objectives/update', body);
    if (!r.ok) return toast(`Not saved: ${why(r, 'try again')}`);
    toast('Saved'); drop(`obj:${oid}`); drop('tree:'); paint();
  }
  async function linkGoal(oid, pname) {
    const rec = (window.XENO_PG_PROJECTS.items || []).find((p) => p.name === pname); if (!rec) return;
    const t = (await unwrap(await api('/coordination/projects/tree', { projectId: rec.id })).catch(() => null))?.result;
    const free = (t?.goals || []).filter((g) => !g.objectiveId && g.status !== 'completed');
    if (!free.length) return toast('This project has no open goal outside an objective');
    const v = await D().form({ title: 'Link a goal', sub: 'The goal rolls up to this objective.', submit: 'Link', size: 'sm', fields: [{ id: 'g', label: 'Goal', type: 'choice', cols: 1, required: true, options: free.map((g) => [g.goalId, g.title, '']) }] });
    if (!v) return;
    const r = await api('/coordination/objectives/link-goal', { goalId: v.g, objectiveId: oid });
    if (!r.ok) return toast(`Not linked: ${why(r, 'try again')}`);
    toast('Linked'); drop(`obj:${oid}`); drop('tree:'); paint();
  }
  async function completeObjective(oid) {
    const r = await api('/coordination/objectives/complete', { objectiveId: oid });
    if (!r.ok) return toast(r.d && r.d.reason === 'goals_incomplete' ? 'Not yet: every goal under it must be completed first' : `Not completed: ${why(r, 'try again')}`);
    toast('Objective completed'); drop(`obj:${oid}`); drop('tree:'); paint();
  }

  // ───────── Changes
  const CR_STATE = { open: 'Open', merged: 'Merged', closed: 'Closed' };
  const INTENT = { abandon: 'Abandoned a branch', 'rewind-to': 'Rewound to a turn' };
  function changesTab(rec, h) {
    const e = view(`changes:${rec.id}`, async () => {
      const [c, b] = await Promise.all([api('/forge/change-requests/list', { projectId: rec.id }), api('/sessions/branch-intents/list', { projectId: rec.id })]);
      const cr = await unwrap(c); if (cr === null) return null;
      return { crs: cr.result || [], intents: b.ok ? b.d.result.intents : [] };
    });
    if (e.status === 'loading') return h.box('refresh', 'Loading changes', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Changes could not be read', 'Try again in a moment.', h.btn('Retry', `data-xwp="retry" data-k="changes:${esc(rec.id)}"`, true), 'sm');
    const { crs, intents } = e.d;
    const crList = crs.length ? h.table(['Change request', 'Repository', 'Reviews', 'State'], crs.map((c) => h.tr(`data-xwp="open" data-to="${esc(rec.name)}/Changes/${esc(c.id)}"`, [
      `<b class="pg-name">${esc(c.title)}</b><small>${esc(c.sourceBranch)} → ${esc(c.targetRef)}</small>`, `<small>${esc(c.bindingName || c.provider)}</small>`,
      `<small>${c.approvals} approved${c.failingChecks ? ` · ${c.failingChecks} failing` : ''}</small>`, h.chip(CR_STATE[c.status] || c.status)])))
      : h.box('code', 'No change requests', 'Change requests opened against this project’s repositories are reviewed here.', '', 'sm');
    const bi = intents.length ? `<section class="pg-sec"><h3>Branch intents <em>${intents.length}</em></h3><ol class="pg-tl">${intents.map((i) => `<li><i></i><span>${esc(INTENT[i.intent] || i.intent)} <b>${esc(i.branch)}</b>${i.targetTurn !== null ? ` at turn ${esc(i.targetTurn)}` : ''} in “${esc(i.conversationTitle)}”</span><small>${esc(when(i.createdAt))}</small></li>`).join('')}</ol></section>` : '';
    return crList + bi;
  }
  function changeDetail(crId, h, back) {
    if (!UUID.test(crId)) return h.box('x', 'Not found', 'This change request does not exist, or you cannot see it.', back, 'sm');
    const e = view(`cr:${crId}`, async () => {
      const [c, k, r] = await Promise.all([api('/forge/change-requests/read', { crId }), api('/forge/change-requests/checks', { crId }), api('/forge/change-requests/reviews', { crId })]);
      const cr = await unwrap(c); if (cr === null) return null;
      return { cr: cr.result, checks: k.ok ? k.d.result || [] : [], reviews: r.ok ? r.d.result || [] : [] };
    });
    if (e.status === 'loading') return h.box('refresh', 'Loading this change request', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Not found', 'This change request does not exist, or you cannot see it.', back, 'sm');
    const { cr, checks, reviews } = e.d, open = cr.status === 'open';
    const acts = open ? h.btn('Approve', `data-xwp="review" data-id="${esc(crId)}" data-v="approve"`, false, 'check') + h.btn('Request changes', `data-xwp="review" data-id="${esc(crId)}" data-v="request_changes"`, true, 'edit') + h.btn('Reject', `data-xwp="review" data-id="${esc(crId)}" data-v="reject"`, true, 'x') : '';
    const DEC = { approve: 'Approved', request_changes: 'Changes requested', reject: 'Rejected' };
    return `<div class="xwp-bar"><span>${back}</span><span class="pg-sp"></span>${acts}</div>
      <div class="pg-cols pg-cols--item"><div><section class="pg-sec"><h3>${esc(cr.title)}</h3>${cr.body ? `<p>${esc(cr.body)}</p>` : '<p class="pg-dim">No description.</p>'}</section>
        <section class="pg-sec"><h3>Checks</h3>${checks.length ? `<ul class="xwp-goals">${checks.map((c) => `<li><span>${esc(c.name)}${c.detail ? ` <small class="pg-dim">${esc(c.detail)}</small>` : ''}</span>${h.chip(c.status === 'pass' ? 'Passed' : c.status === 'fail' ? 'Failed' : 'Pending')}</li>`).join('')}</ul>` : '<p class="pg-dim">No checks reported.</p>'}</section>
        <section class="pg-sec"><h3>Reviews</h3>${reviews.length ? `<ol class="pg-tl">${reviews.map((r) => `<li><i></i><span>${esc(DEC[r.decision] || r.decision)}${r.body ? ` — ${esc(r.body)}` : ''}</span><small>${esc(when(r.createdAt || r.created_at))}</small></li>`).join('')}</ol>` : '<p class="pg-dim">Nobody has reviewed it yet.</p>'}</section></div>
      <aside><dl class="pg-props"><dt>State</dt><dd>${h.chip(CR_STATE[cr.status] || cr.status)}</dd><dt>Repository</dt><dd>${esc(cr.bindingName || cr.provider)}</dd><dt>Branch</dt><dd><code>${esc(cr.sourceBranch)}</code> → <code>${esc(cr.targetRef)}</code></dd><dt>Head</dt><dd><code>${esc(String(cr.headRev).slice(0, 12))}</code></dd><dt>Opened</dt><dd>${esc(when(cr.createdAt))}</dd></dl></aside></div>`;
  }
  async function review(crId, decision) {
    const label = { approve: 'Approve', request_changes: 'Request changes', reject: 'Reject' }[decision];
    const v = await D().form({ title: label, submit: label, size: 'sm', fields: [{ id: 'body', label: decision === 'approve' ? 'Comment (optional)' : 'What should change', type: 'textarea', rows: 3, required: decision !== 'approve', max: 2000 }] });
    if (!v) return;
    const r = await api('/forge/change-requests/review', { crId, decision, body: v.body || '' });
    if (!r.ok) return toast(`Not recorded: ${why(r, 'try again')}`);
    toast('Review recorded'); drop(`cr:${crId}`); drop('changes:'); paint();
  }

  // ───────── wiring
  const TABS = ['Objectives', 'Runs', 'Changes'];
  const backTo = (pname, tab) => `<a class="pg-link" data-xwp="open" data-to="${esc(pname)}/${tab}">← All ${tab.toLowerCase()}</a>`;
  function projectTab(tab, sub, rec, h) {
    const id = String(sub || '');
    if (tab === 'Runs') return id ? runDetail(id, h, backTo(rec.name, 'Runs')) : runsTab(rec, h);
    if (tab === 'Objectives') return id ? objectiveDetail(rec, id, h, backTo(rec.name, 'Objectives')) : objectivesTab(rec, h);
    if (tab === 'Changes') return id ? changeDetail(id, h, backTo(rec.name, 'Changes')) : changesTab(rec, h);
    return null;
  }
  // the same run, reached from the agent page: /workspace/workspace/Agents/<agent id>/runs/<admission id>
  const AGENT_RUN = /^Agents\/([^/]+)\/runs\/([^/]+)$/;
  function route(item) {
    const m = String(item || '').match(AGENT_RUN); if (!m) return null;
    const h = window.XENO_PAGES.h, name = window.XENO_AGENTS?.nameOf?.(m[1]) || 'Agent';
    return h.page(h.head({ title: `Run ${short(m[2])}`, sub: `Admitted for ${name}` }) + runDetail(m[2], h, `<a class="pg-link" data-pg-ws="Agents/${esc(m[1])}">← ${esc(name)}</a>`));
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xwp]'); if (!b || !b.closest('#main') || b.closest('.xd')) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.xwp;
    if (a === 'open') return X().go('global', { global: 'projects', item: b.dataset.to });
    if (a === 'retry') { C.delete(b.dataset.k); return paint(); }
    if (a === 'revoke') return revoke(b.dataset.id);
    if (a === 'new-objective') return newObjective(b.dataset.p);
    if (a === 'edit-objective') return editObjective(b.dataset.id);
    if (a === 'link-goal') return linkGoal(b.dataset.id, b.dataset.p);
    if (a === 'complete-objective') return completeObjective(b.dataset.id);
    if (a === 'review') return review(b.dataset.id, b.dataset.v);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const b = e.target.closest?.('.pg-tr[data-xwp]'); if (b) { e.preventDefault(); b.click(); } });
  if (!document.getElementById('xwp-css')) {
    const s = document.createElement('style'); s.id = 'xwp-css';
    s.textContent = '.xwp-bar{display:flex;align-items:center;gap:8px;margin:0 0 12px}.xwp-bar .pg-sp{flex:1}.xwp-goals{list-style:none;margin:0;padding:0;display:grid;gap:6px}.xwp-goals li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;background:var(--panel)}';
    document.head.appendChild(s);
  }
  if (!window.XENO_PROJECT_TABS.includes('Objectives')) window.XENO_PROJECT_TABS.splice(window.XENO_PROJECT_TABS.indexOf('Tasks'), 0, 'Objectives');
  for (const t of ['Runs', 'Changes']) if (!window.XENO_PROJECT_TABS.includes(t)) window.XENO_PROJECT_TABS.splice(window.XENO_PROJECT_TABS.indexOf('Funding'), 0, t);
  window.XENO_WFP = { served: true, tabs: TABS, projectTab, route, reload: () => { C.clear(); paint(); } };
})();
