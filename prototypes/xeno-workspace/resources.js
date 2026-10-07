/* XENO_RES — agents and teams as RESOURCES: owned by one workspace, assigned to many (XENO-WORKFORCE-01 §8.1–§8.3).
 *   OWN-01 one owner scope + separate creator · OWN-02/03 identity ≠ version; a version is pinned by hash; changing the
 *   active version never moves a run already going · ASN-01 many assignments, ownership never moves · ASN-04 a cross-owner
 *   assignment needs the owner's sharing AND the target admin's acceptance — both recorded, even when one person holds both
 *   ASN-05/06 a team brings an explicit member set (none / explicit / inherit), never "everyone, later"
 *   VIEW-01..04 global lists aggregate what you may see; a workspace lists only what is assigned to it; one id everywhere
 * Platform: /api/v2/agents/:id · /versions · /assignments · /access ; /api/v2/me/agents ; /api/v2/me/teams
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, WF = () => window.XENO_WF, Wd = () => window.XENO_PG_WORKSPACE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), DAY = 864e5, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 5);
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7); };
  const WS = () => window.XA.workspaces(), cur = () => window.XA.currentWorkspace(), wsName = (id) => WS().find((w) => w.id === id)?.name || id;
  const isAdminOf = (id) => id === 'personal' || /owner|admin/i.test(WS().find((w) => w.id === id)?.sub || '');

  // ---------- the resource store (inside the workforce record) ----------
  function store() {
    const S = WF().st();
    if (!S.res) {
      const agents = Wd().members.filter((m) => m.kind === 'agent');
      S.res = {};
      agents.forEach((m, i) => { const vs = [4, 3, 2].map((v, j) => ({ v, hash: hash(m.name + v), at: now() - (j * 18 + 3 + i) * DAY, notes: ['Sharper research summaries', 'Cites sources inline', 'First version'][j], by: 'Emilian' }));
        S.res[m.name] = { id: 'agt_' + m.name.toLowerCase(), kind: 'agent', name: m.name, owner: 'xeno', creator: 'Emilian', versions: vs, active: 4, runsOn: { 3: i === 0 ? 1 : 0 }, access: { visibility: 'workspace', invoke: 'assigned', edit: 'owners', exportable: 'no' }, archived: false }; });
      S.res.Scout = { id: 'agt_scout', kind: 'agent', name: 'Scout', owner: 'personal', creator: 'Emilian', title: 'Personal research', versions: [{ v: 1, hash: hash('Scout1'), at: now() - 6 * DAY, notes: 'First version', by: 'Emilian' }], active: 1, runsOn: {}, access: { visibility: 'private', invoke: 'me', edit: 'me', exportable: 'no' }, archived: false };
      S.asg = [
        { id: 'as1', res: 'Atlas', kind: 'agent', from: 'xeno', to: 'personal', state: 'accepted', members: 'none', set: [], at: now() - 12 * DAY, checks: ['Owner shared it — Emilian (XENO Corp owner)', 'Target accepted — Emilian (Personal)'], rev: [] },
        { id: 'as2', res: 'Echo', kind: 'agent', from: 'xeno', to: 'lumen', state: 'proposed', members: 'none', set: [], at: now() - DAY, checks: ['Owner shared it — Emilian (XENO Corp owner)'], rev: [] },
      ];
      WF().persist();
    }
    return S;
  }
  const res = (n) => store().res[n];
  const asg = () => store().asg;
  const assignedTo = (r) => [r.owner, ...asg().filter((a) => a.res === r.name && a.state === 'accepted').map((a) => a.to)];
  const visibleHere = (r) => assignedTo(r).includes(cur().id);
  const runsOf = (n) => Object.values(window.XENO_PG_AREAS || {}).flatMap((A) => { const ai = A.cols.indexOf('Agent'), si = A.cols.indexOf('Status'); return ai < 0 ? [] : A.rows.filter((r) => r[ai] === n).map((r) => ({ name: r[0], status: r[si] })); });
  const statusOf = (r) => { const m = Wd().members.find((x) => x.name === r.name); return r.archived ? 'Archived' : m?.status === 'departed' ? 'Departed' : runsOf(r.name).some((x) => /Running/.test(x.status)) ? 'Running' : 'Idle'; };

  // ---------- pages ----------
  function agentsHere() {
    const h = P(), list = Object.values(store().res).filter((r) => r.kind === 'agent' && visibleHere(r) && !r.archived), w = cur();
    return h.page(h.head({ eyebrow: '<a data-pg-ws="">Workspace</a>', title: 'Agents', sub: `${h.plural(list.length, 'agent', 'agents')} assigned to ${w.name}`, acts: h.btn('Assign an agent here', 'data-rs="request"', false, 'plus') })
      + (list.length ? `<div class="pg-grid pg-grid--agents">${list.map((r) => card(r)).join('')}</div>` : h.box('bot', `No agents work in ${esc(w.name)} yet`, 'Assign one of yours, or ask an owner to share theirs.', h.btn('Assign an agent here', 'data-rs="request"', false, 'plus')))
      + `<p class="pg-rule">${ic('lock')}Only agents assigned to this workspace appear here. Your others are in <a data-pg-ws="All my agents">All my agents</a>.</p>` + h.foot('res:agents', 'GET /api/v2/workspaces/:id/agents', 'agent'));
  }
  const card = (r) => { const h = P(), st = statusOf(r), here = r.owner === cur().id;
    return `<button class="pg-card pg-card--agent rs-card" data-pg-ws="Agents/${esc(r.name)}">${h.avatar({ name: r.name, kind: 'agent' }, ' lg')}<b>${esc(r.name)}</b><small>v${r.active} · <code>${esc(r.versions.find((v) => v.v === r.active)?.hash)}</code></small>${h.chip(st)}<small class="dim">${here ? 'Owned here' : `Owned by ${esc(wsName(r.owner))}`}</small></button>`; };
  function myAgents(kind) {
    const h = P(), u = h.ui('res:all:' + kind), f = localStorage.getItem('xw.rsFilter') || 'all', q = (u.q || '').toLowerCase();
    if (kind === 'team') {
      const ts = WF().st().teams.filter((t) => !t.archived && (!q || t.name.toLowerCase().includes(q)));
      return h.page(h.head({ eyebrow: 'Across all your workspaces', title: 'All my teams', sub: `${h.plural(ts.length, 'team', 'teams')} you belong to` })
        + h.table(['Team', 'Owned by', 'Your function', 'Assigned to', 'Members'], ts.map((t) => { const mine = t.members.find((x) => x.name === WF().you()); const to = asg().filter((a) => a.res === t.name && a.kind === 'team' && a.state === 'accepted').map((a) => wsName(a.to));
          return h.tr(`data-pg-ws="Teams/${esc(t.name)}"`, [`<b class="pg-name">${esc(t.name)}</b>`, esc(cur().name), mine ? `<span class="wf-fn wf-fn--${mine.fn}">${mine.fn}</span>` : '<small class="pg-dim">Not a member</small>', `<small>${to.length ? to.map(esc).join(', ') : '—'}</small>`, `<small>${t.members.length}</small>`]); }))
        + h.foot('res:myteams', 'GET /api/v2/me/teams?owner&assignment&status', 'team'));
    }
    const all = Object.values(store().res).filter((r) => r.kind === 'agent'), rows = all.filter((r) => (f === 'all' || (f === 'here' ? visibleHere(r) : f === 'nothere' ? !visibleHere(r) : f === 'shared' ? asg().some((a) => a.res === r.name && a.state !== 'revoked') : true)) && (!q || r.name.toLowerCase().includes(q)));
    return h.page(h.head({ eyebrow: 'Across all your workspaces', title: 'All my agents', sub: `${h.plural(all.length, 'agent', 'agents')} you own`, acts: '' })
      + `<div class="pg-bar"><label class="pg-search">${ic('search')}<input data-pg-q="res:all:agent" value="${esc(u.q || '')}" placeholder="Search your agents" aria-label="Search your agents"></label><div class="pg-seg" role="tablist" aria-label="Show">${[['all', 'All'], ['here', `In ${esc(cur().name)}`], ['nothere', 'Not here'], ['shared', 'Shared out']].map(([v, l]) => `<button role="tab" aria-selected="${v === f}" data-rs="filter" data-arg="${v}">${l}</button>`).join('')}</div></div>`
      + (rows.length ? h.table(['Agent', 'Owned by', 'Works in', 'Version', 'Status'], rows.map((r) => h.tr(`data-pg-ws="Agents/${esc(r.name)}"`, [`${h.avatar({ name: r.name, kind: 'agent' })}<b class="pg-name">${esc(r.name)}</b>`, esc(wsName(r.owner)), `<small>${assignedTo(r).map(wsName).map(esc).join(', ')}${asg().some((a) => a.res === r.name && a.state === 'proposed') ? ' · <em>offer pending</em>' : ''}</small>`, `<small>v${r.active} · <code>${esc(r.versions.find((v) => v.v === r.active)?.hash)}</code></small>`, h.chip(statusOf(r))]))) : h.box('bot', 'No agents match', '', '', 'sm'))
      + h.foot('res:myagents', 'GET /api/v2/me/agents?owner&access&assignment&status', 'agent'));
  }
  function agentPage(n) {
    const h = P(), r = res(n); if (!r) return null;
    const ownHere = r.owner === cur().id, iOwn = isAdminOf(r.owner), here = visibleHere(r), act = r.versions.find((v) => v.v === r.active);
    // VIEW-02: inside a workspace, an agent that isn't assigned there shows only that — even to its owner
    if (!here) return h.page(h.head({ eyebrow: '<a data-pg-ws="Agents">Agents</a>', title: r.name }) + h.box('lock', `${esc(r.name)} isn’t assigned to ${esc(cur().name)}`, iOwn ? `It’s yours, owned by ${esc(wsName(r.owner))}. Assign it here to use it in ${esc(cur().name)}.` : 'It belongs to another workspace. Its owner can assign it here.', iOwn ? h.btn(`Assign it to ${cur().name}`, `data-rs="here" data-arg="${esc(n)}"`, false, 'plus') + h.btn(`Open in ${wsName(r.owner)}`, `data-rs="home" data-arg="${esc(n)}"`, true, 'open') : h.btn('Ask for it', `data-rs="ask" data-arg="${esc(n)}"`, false, 'send')));
    const A = asg().filter((a) => a.res === n && a.state !== 'revoked'), runs = runsOf(n);
    const acts = (iOwn ? h.btn('Assign to a workspace', `data-rs="propose" data-arg="${esc(n)}"`, false, 'share') + h.btn('New version', `data-rs="version" data-arg="${esc(n)}"`, true, 'plus') : '') + h.btn('Hand off work', `data-wf="handoff" data-arg="${esc(n)}"`, true, 'send');
    const aRow = (a) => { const target = isAdminOf(a.to);
      return `<li class="rs-asg"><div><b>${esc(wsName(a.to))}</b><small>${a.state === 'accepted' ? 'Working there' : a.state === 'proposed' ? 'Offered — waiting for its admin' : a.state === 'declined' ? 'Declined' : ''}${a.kind === 'team' ? ` · members: ${a.members}` : ''}</small><ul class="rs-checks">${a.checks.map((c) => `<li>${ic('check')}${esc(c)}</li>`).join('')}</ul></div>
        <span>${a.state === 'proposed' && target ? h.btn(`Accept for ${wsName(a.to)}`, `data-rs="accept" data-arg="${a.id}"`, false) + h.btn('Decline', `data-rs="decline" data-arg="${a.id}"`, true) : ''}${a.state !== 'declined' && iOwn ? h.btn(a.state === 'proposed' ? 'Withdraw' : 'Revoke', `data-rs="revoke" data-arg="${a.id}"`, true) : ''}</span></li>`; };
    const aSel = (k, v, opts) => `<span class="xd-seg" role="radiogroup">${opts.map(([x, l]) => `<button type="button" role="radio" aria-checked="${v === x}" data-rs="access" data-arg="${esc(n)}|${k}|${x}"${iOwn ? '' : ' aria-disabled="true"'}>${l}</button>`).join('')}</span>`;
    return h.page(h.head({ obj: true, eyebrow: `<a data-pg-ws="Agents">Agents</a> · ${ownHere ? 'owned here' : 'owned by ' + esc(wsName(r.owner))}`, title: r.name, sub: `v${r.active} · ${statusOf(r)} · made by ${r.creator}`, acts })
      + `<div class="pg-cols pg-cols--item"><div>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Versions</h3></div><ol class="rs-vers">${r.versions.map((v) => `<li class="${v.v === r.active ? 'on' : ''}"><span class="rs-v">v${v.v}</span><div><b>${esc(v.notes)}</b><small><code>${v.hash}</code> · ${new Date(v.at).toLocaleDateString()} · ${esc(v.by)}${r.runsOn[v.v] ? ` · ${r.runsOn[v.v]} run still on it` : ''}</small></div>${v.v === r.active ? '<span class="set-tag on">Active</span>' : iOwn ? h.btn('Make active', `data-rs="activate" data-arg="${esc(n)}|${v.v}"`, true) : ''}</li>`).join('')}</ol>
          <p class="pg-dim wf-note">A version pins instructions, skills and permissions by hash. Changing the active version never moves a run that already started (OWN-03).</p></section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Works in</h3></div><ul class="rs-asgs"><li class="rs-asg"><div><b>${esc(wsName(r.owner))}</b><small>Owner — it can’t be unassigned from its owner</small></div></li>${A.map(aRow).join('')}</ul>
          <p class="pg-dim wf-note">Assigning lends the agent; it never changes who owns it (ASN-01). Sharing to someone else’s workspace needs your consent and their admin’s — both are recorded (ASN-04).</p></section>
        <section class="pg-sec"><h3>Access</h3><div class="rs-access">
          <div><span>Who can see it</span>${aSel('visibility', r.access.visibility, [['private', 'Only me'], ['workspace', 'Owner workspace'], ['assigned', 'Where assigned']])}</div>
          <div><span>Who can run it</span>${aSel('invoke', r.access.invoke, [['me', 'Only me'], ['assigned', 'Members where assigned'], ['managers', 'Managers only']])}</div>
          <div><span>Who can change it</span>${aSel('edit', r.access.edit, [['me', 'Only me'], ['owners', 'Owner admins']])}</div>
          <div><span>Can be exported</span>${aSel('exportable', r.access.exportable, [['no', 'No'], ['owners', 'By owner admins']])}</div></div>
          <p class="pg-dim wf-note">Six separate rights — seeing, running, changing, exporting, owning and collaborating are never one switch.</p></section>
        ${runs.length ? `<section class="pg-sec"><h3>Runs</h3>${h.table(['Run', 'Status'], runs.map((x) => h.tr(`data-item="${esc(x.name)}"`, [`<b class="pg-name">${esc(x.name)}</b>`, h.chip(x.status)])))}</section>` : ''}
      </div><aside><dl class="pg-props"><dt>Owner</dt><dd>${esc(wsName(r.owner))}</dd><dt>Made by</dt><dd>${esc(r.creator)}</dd><dt>Id</dt><dd><code>${r.id}</code></dd><dt>Active</dt><dd>v${r.active} · <code>${act?.hash}</code></dd><dt>Works in</dt><dd>${assignedTo(r).length}</dd></dl></aside></div>`
      + h.foot('res:agent', 'GET /api/v2/agents/:id'));
  }

  // ---------- actions ----------
  const decide = (o) => WF().decide(o), commit = (m) => WF().commit(m);
  const ACT = {
    async propose(n, kind = 'agent') { const r = kind === 'agent' ? res(n) : null, owner = r ? r.owner : cur().id, taken = asg().filter((a) => a.res === n && ['accepted', 'proposed'].includes(a.state)).map((a) => a.to);
      const targets = WS().filter((w) => w.id !== owner && !taken.includes(w.id)); if (!targets.length) return X().toast('Already offered to every workspace you belong to');
      const team = kind === 'team' && WF().team(n);
      const v = await D().form({ title: `Assign ${n}`, sub: 'It keeps its owner. The other workspace’s admin has to accept.', submit: 'Offer', fields: [
        { id: 'to', label: 'To', type: 'choice', cols: 2, required: true, options: targets.map((w) => [w.id, w.name, isAdminOf(w.id) ? 'You can accept for it' : 'Its admin decides']) },
        ...(team ? [{ id: 'm', label: 'Members who come with it', type: 'choice', cols: 1, value: 'explicit', options: [['explicit', 'These members, as they are now', 'New members need accepting again (ASN-05)'], ['none', 'No members — the team only', ''], ['inherit', 'Follow the team’s membership', 'Each addition is still admitted by the target']] }] : [])] });
      if (!v) return;
      const me = WF().you(), both = isAdminOf(v.to), a = { id: 'as' + rid(), res: n, kind, from: owner, to: v.to, state: both ? 'accepted' : 'proposed', members: v.m || 'none', set: team ? team.members.map((x) => x.name) : [], at: now(), checks: [`Owner shared it — ${me} (${wsName(owner)})`, ...(both ? [`Target accepted — ${me} (${wsName(v.to)})`] : [])], rev: [{ at: now(), by: me, what: both ? 'Offered and accepted' : 'Offered' }] };
      asg().push(a); decide({ kind: 'assign', subject: n, what: `${both ? 'Assigned' : 'Offered'} ${n} to ${wsName(v.to)}` }); commit(both ? `${n} now works in ${wsName(v.to)} — both checks recorded` : `Offered to ${wsName(v.to)} — its admin decides`); },
    accept(id) { const a = asg().find((x) => x.id === id); a.state = 'accepted'; a.checks.push(`Target accepted — ${WF().you()} (${wsName(a.to)})`); decide({ kind: 'assign', subject: a.res, what: `${wsName(a.to)} accepted ${a.res}` }); commit(`${a.res} now works in ${wsName(a.to)}`); },
    decline(id) { const a = asg().find((x) => x.id === id); a.state = 'declined'; decide({ kind: 'assign', subject: a.res, what: `${wsName(a.to)} declined ${a.res}` }); commit('Declined'); },
    async revoke(id) { const a = asg().find((x) => x.id === id), runs = runsOf(a.res).filter((x) => /Running|Waiting/.test(x.status)), sched = (JSON.parse(localStorage.getItem('xw.scheduled') || 'null') || []).filter((s) => s.on).length;
      if (a.state === 'accepted' && !await D().confirm({ title: `Stop ${esc(a.res)} working in ${esc(wsName(a.to))}?`, body: `No new work starts there. ${runs.length ? `${runs.length} run${runs.length > 1 ? 's' : ''} already going finish${runs.length > 1 ? '' : 'es'} first. ` : ''}${sched ? `Scheduled tasks there that use it stop. ` : ''}Its history in ${esc(wsName(a.to))} stays.`, action: 'Revoke' })) return;
      a.state = 'revoked'; decide({ kind: 'assign', subject: a.res, what: `${a.state === 'proposed' ? 'Withdrew' : 'Revoked'} ${a.res} from ${wsName(a.to)}` }); commit(`${a.res} no longer works in ${wsName(a.to)}`); },
    activate(arg) { const [n, v] = arg.split('|'), r = res(n), was = r.active; r.runsOn[was] = (r.runsOn[was] || 0) + runsOf(n).filter((x) => /Running/.test(x.status)).length; r.active = +v; decide({ kind: 'role', subject: n, what: `${n}: v${was} → v${v}`, supersedes: 'v' + was }); commit(`v${v} is active — runs already going stay on v${was}`); },
    async version(n) { const r = res(n); const v = await D().form({ title: `New version of ${n}`, sub: 'It gets its own hash. Nothing running changes until you make it active.', submit: 'Save version', fields: [{ id: 'notes', label: 'What changed', required: true, max: 80 }, { id: 'act', label: 'Make it active now', type: 'checks', value: [], options: [['y', 'Yes — new runs use it']] }] });
      if (!v) return; const nv = Math.max(...r.versions.map((x) => x.v)) + 1; r.versions.unshift({ v: nv, hash: hash(n + nv + now()), at: now(), notes: v.notes, by: WF().you() }); if ((v.act || []).length) ACT.activate(`${n}|${nv}`); else commit(`Saved v${nv}`); },
    access(arg) { const [n, k, v] = arg.split('|'), r = res(n); if (!isAdminOf(r.owner)) return X().toast('Only the owner workspace’s admins change this'); r.access[k] = v; commit('Saved'); },
    async request() { const mine = Object.values(store().res).filter((r) => r.kind === 'agent' && !visibleHere(r) && isAdminOf(r.owner));
      if (!mine.length) return X().toast('All your agents already work here');
      const v = await D().form({ title: `Assign an agent to ${cur().name}`, submit: 'Assign', size: 'sm', fields: [{ id: 'n', label: 'Agent', type: 'choice', cols: 2, required: true, options: mine.map((r) => [r.name, r.name, 'Owned by ' + wsName(r.owner)]) }] }); if (!v) return;
      const r = res(v.n), me = WF().you(), both = isAdminOf(cur().id); asg().push({ id: 'as' + rid(), res: v.n, kind: 'agent', from: r.owner, to: cur().id, state: both ? 'accepted' : 'proposed', members: 'none', set: [], at: now(), checks: [`Owner shared it — ${me} (${wsName(r.owner)})`, ...(both ? [`Target accepted — ${me} (${cur().name})`] : [])], rev: [] });
      decide({ kind: 'assign', subject: v.n, what: `Assigned ${v.n} to ${cur().name}` }); commit(both ? `${v.n} now works in ${cur().name}` : 'Offered — the admin decides'); },
    filter(v) { localStorage.setItem('xw.rsFilter', v); X().render(); },
    here(n) { const r = res(n), me = WF().you(), both = isAdminOf(cur().id); asg().push({ id: 'as' + rid(), res: n, kind: 'agent', from: r.owner, to: cur().id, state: both ? 'accepted' : 'proposed', members: 'none', set: [], at: now(), checks: [`Owner shared it — ${me} (${wsName(r.owner)})`, ...(both ? [`Target accepted — ${me} (${cur().name})`] : [])], rev: [] }); decide({ kind: 'assign', subject: n, what: `Assigned ${n} to ${cur().name}` }); commit(both ? `${n} now works in ${cur().name}` : `Offered to ${cur().name} — its admin decides`); },
    home(n) { window.XA.switchWorkspace(res(n).owner); X().go('global', { global: 'workspace', item: 'Agents/' + n }); },
    ask(n) { const r = res(n); decide({ kind: 'assign', subject: n, what: `Asked ${wsName(r.owner)} to assign ${n} to ${cur().name}` }); commit(`Asked ${wsName(r.owner)} — they’ll see it in their inbox`); },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-rs]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); if (t.getAttribute('aria-disabled') === 'true') return X().toast('Only the owner workspace’s admins change this'); window.XENO_NET?.begin('resources', t.dataset.rs, t); Promise.resolve(ACT[t.dataset.rs]?.(t.dataset.arg, t.dataset.kind || 'agent')).finally(() => window.XENO_NET?.clear(t)); }, true);

  // team pages gain "Works in" (assignments across workspaces), built from the same records
  function teamAssignments(name) {
    const h = P(), A = asg().filter((a) => a.res === name && a.kind === 'team' && a.state !== 'revoked');
    return `<section class="pg-sec"><div class="pg-sec-h"><h3>Works in other workspaces</h3>${h.btn('Assign to a workspace', `data-rs="propose" data-arg="${esc(name)}" data-kind="team"`, true, 'share')}</div>${A.length ? `<ul class="rs-asgs">${A.map((a) => `<li class="rs-asg"><div><b>${esc(wsName(a.to))}</b><small>${a.state === 'accepted' ? 'Working there' : 'Offered'} · members: ${a.members === 'explicit' ? a.set.length + ' named' : a.members}</small></div><span>${h.btn(a.state === 'proposed' ? 'Withdraw' : 'Revoke', `data-rs="revoke" data-arg="${a.id}"`, true)}</span></li>`).join('')}</ul>` : '<p class="pg-dim">Only here.</p>'}</section>`;
  }

  function route(it) {
    if (it === 'Agents') return agentsHere();
    if (it?.startsWith('Agents/')) return agentPage(it.slice(7));
    if (it === 'All my agents') return myAgents('agent');
    if (it === 'All my teams') return myAgents('team');
    return null;
  }
  window.XENO_ROLE?.gate('rs', ['propose', 'accept', 'decline', 'revoke', 'activate', 'version', 'access'], 'manage', 'Owners and admins manage agents and their assignments');
  window.XENO_RES = { route, teamAssignments, store, res };
})();
