/* XENO_WF — the workforce (XENO-WORKFORCE-01 §8.2a–§8.2d): divisions, teams and team functions, handoffs, the decision
 * record, admission and removal. Every rule below is the spec's, cited by id:
 *   ROLE-01 three axes never collapse · ROLE-02 manager/worker/observer · ROLE-05 a function never widens authority
 *   DIV-03 divisions are optional, present nowhere by default, six seeds on request · DIV-04 owning division and funding
 *   scope are TWO edges · DIV-06 a head cannot widen their own division's budget · DIV-07 budget is a ledger scope
 *   HAND-01..06 a handoff moves work never authority, is accepted explicitly, expires, bills the receiver, shows what it shares
 *   LIFE-02 removal = revocation + settlement · LIFE-03 history is never deleted · LIFE-04 evaluation is derived, never a score
 *   LIFE-06/07 every decision names the deciding principal AND the responsible account
 * Platform: /api/v2/workspaces/:id/{divisions,teams,handoffs,decisions,memberships}
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, W = () => window.XENO_PG_WORKSPACE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), H = 3600e3, DAY = 24 * H, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 6);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const SEEDS = [['Creative', 'Images, video, sound and design'], ['Office', 'Documents, planning and finance'], ['Comms', 'Social, audience and community'], ['Corpo', 'Customers, sales and operations'], ['Dev', 'Engineering and agents'], ['Platform', 'Shared infrastructure for every division']];
  const FN = { manager: { may: ['Assign work within the team’s scope', 'Admit and remove members', 'Approve child runs inside the parent budget'], not: ['Widen the team’s own scope', 'Approve its own escalation'] }, worker: { may: ['Run tasks the team was given', 'Delegate narrowly inside the parent budget'], not: ['Admit members', 'Accept assignments', 'Change scope'] }, observer: { may: ['Read the team’s runs, transcripts and progress'], not: ['Dispatch, spend or change anything'] } };

  // ---------- the store ----------
  function init() {
    const Wd = W(), teams = Wd.teams.map((t) => ({ id: t.id, name: t.name, ownDiv: null, fundDiv: null, assignedTo: [], projects: t.projects || [], members: t.members.map((n) => ({ name: n, fn: n === t.lead ? 'manager' : 'worker', since: now() - 40 * DAY })), archived: false }));
    return { v: 1, divisions: [], teams, handoffs: sampleHandoffs(), decisions: [{ id: 'd0', at: now() - 9 * DAY, kind: 'admit', subject: 'Atlas', what: 'Admitted Atlas to Design as a worker', by: 'Emilian', responsible: 'Emilian', authority: 'Workspace owner', reason: 'Research support for the brand refresh', evidence: 'Atlas — research Mind, v4' }] };
  }
  function sampleHandoffs() { return [
    { id: 'h1', from: 'Atlas', to: 'Emilian', work: 'Homepage hero — research pack', kind: 'artifact', artifact: 'Competitor scan.pdf', share: ['result', 'summary'], note: 'Ready for your review', state: 'offered', at: now() - 3 * H, expires: now() + 69 * H, crossed: ['agent → person'], payer: 'Workspace', rev: [{ at: now() - 3 * H, by: 'Atlas', what: 'Offered' }] },
    { id: 'h2', from: 'Emilian', to: 'Kit', work: 'Fix flaky test', kind: 'task', artifact: null, share: ['result'], note: 'Take it from the failing run', state: 'accepted', at: now() - 2 * DAY, expires: now() + DAY, crossed: ['person → agent'], payer: 'Workspace', rev: [{ at: now() - 2 * DAY, by: 'Emilian', what: 'Offered' }, { at: now() - 2 * DAY + 900e3, by: 'Kit', what: 'Accepted' }] },
  ]; }
  let S = null;
  const st = () => { if (!S) { S = LS.get('wf', null); if (!S || S.v !== 1) { S = init(); persist(); } } return S; };
  const persist = () => { LS.set('wf', S); syncWorkspace(); };
  const commit = (msg) => { persist(); window.XENO_PG_SYNC_NAV?.(); X().render(); if (msg) X().toast(msg); };
  const you = () => { const y = W().you; return (typeof y === 'string' ? y : y?.name) || W().members.find((m) => m.kind === 'human' && m.role === (y?.role || 'owner'))?.name || 'Emilian'; };
  const member = (n) => W().members.find((m) => m.name === n);
  const divs = (all) => st().divisions.filter((d) => all || !d.archived);
  const div = (id) => st().divisions.find((d) => d.id === id || d.name === id);
  const team = (n) => st().teams.find((t) => t.id === n || t.name === n);
  const ownerOf = (m) => (m?.kind === 'agent' ? m.ownedBy || you() : m?.name);
  // the workspace's own division list (used across pages) is DERIVED from the workforce, never a second copy
  function syncWorkspace() {
    const Wd = W(); if (!Wd) return;
    Wd.divisions = divs().map((d) => { const ppl = Wd.members.filter((m) => (m.divisions || []).includes(d.name) && m.status !== 'departed'); return { name: d.name, people: ppl.filter((m) => m.kind === 'human').length, agents: ppl.filter((m) => m.kind === 'agent').length }; });
    window.XENO_DB?.save?.();
  }
  // DIV-03: present nowhere by default — the seeded sample memberships are cleared the first time the store is made
  (function firstRun() { if (LS.get('wf', null)) return; const Wd = W(); if (!Wd) return; Wd.members.forEach((m) => { m.divisions = []; }); })();

  // ---------- the decision record (LIFE-06/07): who decided, the account that answers for it, under what authority ----------
  function decide({ kind, subject, what, reason = '', evidence = '', supersedes = null }) {
    const by = you(), m = member(by), authority = m?.role === 'owner' ? 'Workspace owner' : m?.role === 'admin' ? 'Workspace admin' : 'Team manager';
    st().decisions.unshift({ id: 'd' + rid(), at: now(), kind, subject, what, by, responsible: ownerOf(m) || by, authority, reason, evidence, supersedes });
  }

  // ---------- money (DIV-07): a division budget is a scope on the workspace ledger; a child counts against its ancestors ----------
  const ancestors = (d) => { const out = []; let p = d && div(d.parent); while (p) { out.push(p); p = div(p.parent); } return out; };
  const children = (d) => divs().filter((x) => x.parent === d.id);
  const rollup = (d) => { const kids = children(d).map(rollup); return { alloc: d.budget?.alloc || 0, spent: (d.budget?.spent || 0) + kids.reduce((n, k) => n + k.spent, 0), reserved: (d.budget?.reserved || 0) + kids.reduce((n, k) => n + k.reserved, 0) }; };
  const credits = (n) => `${Math.round(n).toLocaleString('en')} cr`;
  const meter = (b) => { const a = b.alloc || 0, s = Math.min(b.spent, a || b.spent), r = Math.min(b.reserved, Math.max(0, (a || 0) - s)); return a ? `<span class="wf-meter" title="${credits(b.spent)} spent · ${credits(b.reserved)} reserved · ${credits(a)} allocated"><i class="s" style="width:${(s / a) * 100}%"></i><i class="r" style="width:${(r / a) * 100}%"></i></span>` : '<span class="pg-dim wf-nob">No budget</span>'; };

  // ---------- effective rights (ROLE-05): the intersection of every axis, shown, with the axis that blocks ----------
  const ACTIONS = [['dispatch', 'Start a run'], ['spend', 'Spend from the budget'], ['admit', 'Admit members'], ['read', 'Read transcripts']];
  function rights(m, t, action) {
    const ms = t.members.find((x) => x.name === m.name), fn = ms?.fn, wrole = m.role, fd = t.fundDiv && div(t.fundDiv), fb = fd ? rollup(fd) : null;
    const rows = [
      ['Platform', 'Account in good standing', m.status !== 'departed' && m.status !== 'settling'],
      ['Workspace', `Role: ${wrole}`, action === 'read' ? true : wrole === 'guest' ? false : action === 'admit' ? ['owner', 'admin', 'member'].includes(wrole) : true],
      ['Team function', fn ? `${t.name}: ${fn}` : `Not on ${t.name}`, !!fn && (action === 'read' || (action === 'admit' ? fn === 'manager' : fn !== 'observer'))],
      ['Division', fd ? `Paid by ${fd.name}` : 'Workspace level', action === 'read' || action === 'admit' ? true : !fd || !fd.archived],
      ['Budget', fd && fb.alloc ? `${credits(Math.max(0, fb.alloc - fb.spent - fb.reserved))} left` : 'Workspace wallet', action === 'spend' || action === 'dispatch' ? !fd || !fb.alloc || fb.alloc - fb.spent - fb.reserved > 0 : true],
    ];
    if (m.kind === 'agent') rows.push(['Owner', `Capped by ${ownerOf(m)}`, true]);
    const block = rows.find((r) => !r[2]);
    return { rows, ok: !block, block };
  }
  function rightsPanel(m) {
    const ts = st().teams.filter((t) => t.members.some((x) => x.name === m.name)), act = LS.get('wfAct', 'dispatch'), t = team(LS.get('wfTeam', '')) && ts.includes(team(LS.get('wfTeam', ''))) ? team(LS.get('wfTeam', '')) : ts[0];
    if (!t) return `<section class="pg-sec"><h3>What ${esc(m.name)} can do</h3><p class="pg-dim">Not on a team yet — add ${esc(m.name)} to one and a function decides what ${m.kind === 'agent' ? 'it' : 'they'} are for.</p></section>`;
    const r = rights(m, t, act);
    return `<section class="pg-sec wf-rights"><div class="pg-sec-h"><h3>Can ${esc(m.name)} …</h3></div>
      <div class="wf-rq"><span class="xd-seg" role="radiogroup">${ACTIONS.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === act}" data-wf="act" data-arg="${v}">${l}</button>`).join('')}</span>${ts.length > 1 ? `<span class="xd-seg" role="radiogroup">${ts.map((x) => `<button type="button" role="radio" aria-checked="${x === t}" data-wf="actTeam" data-arg="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</span>` : ''}</div>
      <ol class="wf-axes">${r.rows.map(([ax, why, ok]) => `<li class="${ok ? 'ok' : 'no'}"><span class="wf-ax">${ax}</span><span class="wf-why">${esc(why)}</span><span class="wf-mark">${ok ? ic('check') : ic('x')}</span></li>`).join('')}</ol>
      <p class="wf-verdict ${r.ok ? 'ok' : 'no'}">${r.ok ? `Yes — every axis allows it.` : `No — blocked by ${r.block[0].toLowerCase()}: ${esc(r.block[1])}.`} <span class="pg-dim">A function never adds authority; it only narrows what the other axes already allow.</span></p></section>`;
  }
  // LIFE-04: a window over what actually happened — never a stored score
  function evidence(m) {
    const win = +LS.get('wfWin', 30), since = now() - win * DAY;
    const runs = Object.values(window.XENO_PG_AREAS || {}).flatMap((A) => { const ai = A.cols.indexOf('Agent'), si = A.cols.indexOf('Status'); return ai < 0 ? [] : A.rows.filter((r) => r[ai] === m.name).map((r) => r[si]); });
    const hs = st().handoffs.filter((h) => h.at >= since && (h.to === m.name || h.from === m.name)), dec = st().decisions.filter((d) => d.at >= since && d.subject === m.name);
    const cell = (n, l) => `<span class="wf-ev"><b>${n}</b><small>${l}</small></span>`;
    return `<section class="pg-sec"><div class="pg-sec-h"><h3>Record</h3><span class="xd-seg" role="radiogroup">${[7, 30, 90].map((d) => `<button type="button" role="radio" aria-checked="${d === win}" data-wf="win" data-arg="${d}">${d} days</button>`).join('')}</span></div>
      <div class="wf-evs">${m.kind === 'agent' ? cell(runs.filter((s) => s === 'Done').length, 'runs finished') + cell(runs.filter((s) => s === 'Failed').length, 'runs failed') + cell(runs.filter((s) => /Running|Waiting/.test(s)).length, 'in progress') : ''}${cell(hs.filter((h) => h.to === m.name && h.state === 'accepted').length, 'handoffs taken')}${cell(hs.filter((h) => h.to === m.name && h.state === 'declined').length, 'declined')}${cell(hs.filter((h) => h.from === m.name).length, 'handed on')}${cell(dec.length, 'decisions about them')}</div>
      <p class="pg-dim wf-note">Counted from runs, handoffs and decisions in the window. There is no score field — a number nobody can trace is not evidence.</p></section>`;
  }
  // the member page gains: their teams and functions, the rights explainer, their record, and handoff
  function memberExtra(m) {
    const ts = st().teams.filter((t) => t.members.some((x) => x.name === m.name));
    const fnRows = ts.map((t) => { const f = t.members.find((x) => x.name === m.name).fn; return `<li><a data-pg-ws="Teams/${esc(t.name)}">${esc(t.name)}</a><span class="wf-fn wf-fn--${f}">${f}</span></li>`; }).join('');
    const dv = (m.divisions || []).map((n) => `<a class="pg-chip" data-pg-ws="Divisions/${esc(n)}">${esc(n)}</a>`).join('');
    return `<section class="pg-sec"><h3>Functions</h3>${ts.length ? `<ul class="wf-fns">${fnRows}</ul>` : '<p class="pg-dim">On no team.</p>'}<p class="pg-dim wf-note">A function is per team — the same principal can manage one team and observe another (ROLE-03).</p></section>
      <section class="pg-sec"><h3>Divisions</h3>${dv ? `<div class="pg-chips">${dv}</div>` : `<p class="pg-dim">${divs().length ? 'In no division.' : 'This workspace has no divisions.'}</p>`}${divs().length ? `<button class="pg-link" data-wf="memberDivs" data-arg="${esc(m.name)}">Change divisions</button>` : ''}</section>`
      + (m.status === 'departed' ? `<section class="pg-sec"><p class="pg-dim">${esc(m.name)} left on ${new Date(m.departedAt).toLocaleDateString()}. Their work, runs and decisions stay attributed to them.</p></section>` : rightsPanel(m)) + evidence(m);
  }

  // ---------- pages ----------
  const HEAD = (title, sub, acts = '', eyebrow = '<a data-pg-ws="">Workspace</a>', obj = false) => P().head({ eyebrow, title, sub, acts, obj });
  function divisionsPage() {
    const h = P(), list = divs();
    if (!list.length) return h.page(HEAD('Divisions', 'Operating units inside this workspace — optional', h.btn('New division', 'data-wf="newDiv"', true, 'plus'))
      + `<div class="wf-empty"><div class="wf-empty-org">${['Creative', 'Dev', 'Platform'].map((n, i) => `<span style="--i:${i}"><b>${n}</b><i></i><i></i></span>`).join('')}</div><h3>No divisions — and that’s fine</h3><p>A small workspace doesn’t need them. When you grow, divisions give teams and projects a reporting line, a head and their own budget, without adding a second wallet.</p><div class="pg-state-acts">${h.btn('Set up the starter six', 'data-wf="seed"', false, 'layers')}${h.btn('Create one', 'data-wf="newDiv"', true, 'plus')}</div><small class="pg-dim">Creative · Office · Comms · Corpo · Dev · Platform — rename or archive any of them later.</small></div>`
      + h.foot('wf:divisions', 'GET /api/v2/workspaces/:id/divisions'));
    const node = (d, depth) => { const b = rollup(d), hd = d.head && member(d.head), ts = st().teams.filter((t) => t.ownDiv === d.id && !t.archived), kids = children(d);
      return `<li class="wf-node" style="--d:${depth}"><button class="wf-div" data-pg-ws="Divisions/${esc(d.name)}"><span class="wf-div-h"><b>${esc(d.name)}</b>${hd ? `<span class="wf-head">${h.avatar(hd)}${esc(hd.name)}</span>` : '<span class="pg-dim">No head</span>'}</span><small>${esc(d.about || '')}</small>
        <span class="wf-div-f"><span>${h.plural(ts.length, 'team', 'teams')} · ${h.plural(W().members.filter((m) => (m.divisions || []).includes(d.name) && m.status !== 'departed').length, 'member', 'members')}</span>${meter(b)}</span></button>${kids.length ? `<ol>${kids.map((k) => node(k, depth + 1)).join('')}</ol>` : ''}</li>`; };
    return h.page(HEAD('Divisions', `${h.plural(list.length, 'division', 'divisions')} · reporting lines, heads and budgets`, h.btn('New division', 'data-wf="newDiv"', false, 'plus'))
      + `<ol class="wf-org">${list.filter((d) => !d.parent || !div(d.parent) || div(d.parent).archived).map((d) => node(d, 0)).join('')}</ol>`
      + (divs(true).some((d) => d.archived) ? `<p class="pg-dim wf-note">Archived: ${divs(true).filter((d) => d.archived).map((d) => `<a data-pg-ws="Divisions/${esc(d.name)}">${esc(d.name)}</a>`).join(', ')}</p>` : '')
      + h.foot('wf:divisions', 'GET /api/v2/workspaces/:id/divisions', 'division'));
  }
  function divisionPage(name) {
    const h = P(), d = div(name); if (!d) return h.page(HEAD(name, '') + h.box('layers', 'No such division', 'It may have been renamed.', h.btn('All divisions', 'data-pg-ws="Divisions"', true)));
    const b = rollup(d), own = st().teams.filter((t) => t.ownDiv === d.id), inbound = st().teams.filter((t) => t.assignedTo.includes(d.id)), paid = st().teams.filter((t) => t.fundDiv === d.id), ppl = W().members.filter((m) => (m.divisions || []).includes(d.name));
    const meHead = d.head === you(), wsAdmin = ['owner', 'admin'].includes(member(you())?.role);
    const acts = d.archived ? h.btn('Restore', `data-wf="restoreDiv" data-arg="${d.id}"`, false, 'undo') : h.btn('Set head', `data-wf="head" data-arg="${d.id}"`, true, 'user') + h.btn('Budget', `data-wf="budget" data-arg="${d.id}"`, true, 'chart') + h.btn('Rename', `data-wf="renameDiv" data-arg="${d.id}"`, true, 'edit') + h.btn('Archive', `data-wf="archiveDiv" data-arg="${d.id}"`, true, 'archive');
    const teamRow = (t, tagTxt) => h.tr(`data-pg-ws="Teams/${esc(t.name)}"`, [`<b class="pg-name">${esc(t.name)}</b>`, tagTxt, `<small>${h.plural(t.members.length, 'member', 'members')}</small>`]);
    return h.page(HEAD(d.name, d.archived ? 'Archived — no new work is admitted; history stays' : (d.about || 'Division'), acts, `<a data-pg-ws="Divisions">Divisions</a>${d.parent && div(d.parent) ? ` · <a data-pg-ws="Divisions/${esc(div(d.parent).name)}">${esc(div(d.parent).name)}</a>` : ''}`, true)
      + `<div class="pg-cols pg-cols--item"><div>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Budget</h3></div><div class="wf-budget">${meter(b)}<dl><dt>Allocated</dt><dd>${credits(b.alloc)}</dd><dt>Spent</dt><dd>${credits(b.spent)}</dd><dt>Reserved</dt><dd>${credits(b.reserved)}</dd><dt>Left</dt><dd>${credits(Math.max(0, b.alloc - b.spent - b.reserved))}</dd></dl></div>
          ${meHead && !wsAdmin ? '<p class="wf-warn">You head this division, so you can’t raise its budget yourself — a workspace admin does that (DIV-06).</p>' : ''}${ancestors(d).length ? `<p class="pg-dim wf-note">Spending here also counts against ${ancestors(d).map((a) => esc(a.name)).join(' and ')}.</p>` : ''}<p class="pg-dim wf-note">A budget is a share of the workspace wallet — never a separate one.</p></section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Teams it owns</h3>${h.btn('New team', `data-wf="newTeam" data-arg="${d.id}"`, true, 'plus')}</div>${own.length ? h.table(['Team', 'Paid by', 'Members'], own.map((t) => teamRow(t, esc(t.fundDiv && t.fundDiv !== d.id ? div(t.fundDiv)?.name || '—' : 'This division')))) : '<p class="pg-dim">None yet.</p>'}</section>
        ${inbound.length ? `<section class="pg-sec"><h3>Teams assigned here</h3>${h.table(['Team', 'Owned by', 'Members'], inbound.map((t) => teamRow(t, esc(div(t.ownDiv)?.name || 'Workspace'))))}<p class="pg-dim wf-note">Assigned teams work for this division without moving their reporting line or who pays them (DIV-05).</p></section>` : ''}
        ${paid.filter((t) => t.ownDiv !== d.id).length ? `<section class="pg-sec"><h3>Teams it pays for</h3>${h.table(['Team', 'Reports to', 'Members'], paid.filter((t) => t.ownDiv !== d.id).map((t) => teamRow(t, esc(div(t.ownDiv)?.name || 'Workspace'))))}</section>` : ''}
        ${children(d).length ? `<section class="pg-sec"><h3>Inside it</h3><div class="pg-chips">${children(d).map((k) => `<a class="pg-chip" data-pg-ws="Divisions/${esc(k.name)}">${esc(k.name)}</a>`).join('')}</div></section>` : ''}
      </div><aside><dl class="pg-props"><dt>Head</dt><dd>${d.head ? esc(d.head) + (member(d.head)?.kind === 'agent' ? ' (agent)' : '') : '—'}</dd><dt>People</dt><dd>${ppl.filter((m) => m.kind === 'human').length}</dd><dt>Agents</dt><dd>${ppl.filter((m) => m.kind === 'agent').length}</dd><dt>Inside</dt><dd>${d.parent && div(d.parent) ? esc(div(d.parent).name) : 'Workspace'}</dd><dt>Created</dt><dd>${new Date(d.at).toLocaleDateString()}</dd></dl>
        ${ppl.length ? `<div class="wf-ppl">${ppl.map((m) => `<a data-pg-ws="Members/${esc(m.name)}" title="${esc(m.name)}">${h.avatar(m)}</a>`).join('')}</div>` : ''}</aside></div>`
      + h.foot('wf:division', 'GET /api/v2/workspaces/:id/divisions/:divisionId'));
  }
  function teamsPage() {
    const h = P(), list = st().teams.filter((t) => !t.archived);
    return h.page(HEAD('Teams', `${h.plural(list.length, 'team', 'teams')} · humans and agents, each with a function`, h.btn('New team', 'data-wf="newTeam"', false, 'plus'))
      + (list.length ? h.table(['Team', 'Reports to', 'Paid by', 'Members', 'Managers'], list.map((t) => h.tr(`data-pg-ws="Teams/${esc(t.name)}"`, [`<b class="pg-name">${esc(t.name)}</b>`, esc(div(t.ownDiv)?.name || 'Workspace'), esc(div(t.fundDiv)?.name || (t.ownDiv ? div(t.ownDiv)?.name : 'Workspace')), `<span class="wf-stack">${t.members.slice(0, 5).map((x) => h.avatar(member(x.name) || { name: x.name, kind: 'human' })).join('')}</span>`, `<small>${esc(t.members.filter((x) => x.fn === 'manager').map((x) => x.name).join(', ') || 'None')}</small>`]))) : h.box('people', 'No teams yet', 'A team groups people and agents around shared work.', h.btn('New team', 'data-wf="newTeam"', false, 'plus')))
      + h.foot('wf:teams', 'GET /api/v2/workspaces/:id/teams', 'team'));
  }
  function teamPage(name) {
    const h = P(), t = team(name); if (!t) return h.page(HEAD(name, '') + h.box('people', 'No such team', '', h.btn('All teams', 'data-pg-ws="Teams"', true)));
    const iManage = t.members.some((x) => x.name === you() && x.fn === 'manager') || ['owner', 'admin'].includes(member(you())?.role);
    const mrow = (x) => { const m = member(x.name) || { name: x.name, kind: 'human', role: 'member' };
      return `<li class="wf-mem">${h.avatar(m)}<a data-pg-ws="Members/${esc(x.name)}"><b>${esc(x.name)}</b><small>${m.kind === 'agent' ? 'Agent · owned by ' + esc(ownerOf(m)) : esc(m.title || '')}</small></a>
        <button class="wf-fn wf-fn--${x.fn}" data-wf="fn" data-arg="${esc(t.name)}|${esc(x.name)}" ${iManage ? '' : 'disabled'} title="${esc(FN[x.fn].may.join(' · '))}">${x.fn}${iManage ? ic('down') : ''}</button>
        ${iManage ? `<button class="pg-ib" data-wf="unteam" data-arg="${esc(t.name)}|${esc(x.name)}" aria-label="Remove ${esc(x.name)} from ${esc(t.name)}" data-tip="Remove from team">${ic('x')}</button>` : ''}</li>`; };
    const opts = [['', 'Workspace level'], ...divs().map((d) => [d.id, d.name])];
    const sel = (field, cur) => divs().length ? `<select class="set-sel" data-wf-sel="${field}" data-arg="${esc(t.name)}">${opts.map(([v, l]) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '<span class="pg-dim">No divisions</span>';
    return h.page(HEAD(t.name, `${h.plural(t.members.length, 'member', 'members')} · ${t.members.filter((x) => member(x.name)?.kind === 'agent').length} agents`, h.btn('Add member', `data-wf="addMember" data-arg="${esc(t.name)}"`, false, 'plus') + h.btn('Hand off work', `data-wf="handoff" data-arg="team:${esc(t.name)}"`, true, 'send') + h.btn('Archive', `data-wf="archiveTeam" data-arg="${esc(t.name)}"`, true, 'archive'), '<a data-pg-ws="Teams">Teams</a>', true)
      + `<div class="pg-cols pg-cols--item"><div><section class="pg-sec"><h3>Members</h3><ul class="wf-mems">${t.members.map(mrow).join('')}</ul></section>
        <section class="pg-sec wf-fnkey"><h3>What each function is for</h3>${Object.entries(FN).map(([k, v]) => `<div><span class="wf-fn wf-fn--${k}">${k}</span><p><b>May</b> ${v.may.map(esc).join(' · ')}</p><p><b>May not</b> ${v.not.map(esc).join(' · ')}</p></div>`).join('')}</section>
        ${window.XENO_RES ? window.XENO_RES.teamAssignments(t.name) : ''}
        ${t.projects.length ? `<section class="pg-sec"><h3>Projects</h3><div class="pg-chips">${t.projects.map((p) => `<a class="pg-chip" data-pg-go-project="${esc(p)}">${esc(p)}</a>`).join('')}</div></section>` : ''}</div>
        <aside><section class="wf-edges"><h3>Division</h3><label><span>Reports to</span>${sel('ownDiv', t.ownDiv)}</label><label><span>Paid by</span>${sel('fundDiv', t.fundDiv || t.ownDiv)}</label>
          <p class="pg-dim wf-note">Two separate choices: who the team reports to, and whose budget its runs spend (DIV-04).</p>
          ${divs().length ? `<div class="wf-asg"><span>Also works for</span>${t.assignedTo.map((id) => `<span class="pg-chip">${esc(div(id)?.name)}<button class="wf-x" data-wf="unassign" data-arg="${esc(t.name)}|${id}" aria-label="Stop working for ${esc(div(id)?.name)}">${ic('x')}</button></span>`).join('')}<button class="pg-link" data-wf="assign" data-arg="${esc(t.name)}">Assign to a division</button></div>` : ''}</section></aside></div>`
      + h.foot('wf:team', 'GET /api/v2/workspaces/:id/teams/:teamId'));
  }
  const HSTATE = { offered: 'Waiting', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', revoked: 'Withdrawn' };
  const expire = () => { let ch = false; st().handoffs.forEach((h2) => { if (h2.state === 'offered' && h2.expires < now()) { h2.state = 'expired'; h2.rev.push({ at: h2.expires, by: 'XENO', what: 'Expired — nobody accepted it' }); ch = true; } }); if (ch) persist(); };
  const left = (t) => { const ms = t - now(); return ms <= 0 ? 'expired' : ms < H ? `${Math.ceil(ms / 6e4)} min left` : ms < DAY ? `${Math.round(ms / H)} h left` : `${Math.round(ms / DAY)} d left`; };
  function handoffsPage() {
    expire(); const h = P(), me = you(), u = h.ui('wf:handoffs'), tab = u.seg.tab || 'in';
    const all = st().handoffs, rows = all.filter((x) => (tab === 'in' ? x.to === me || teamOfMine(x.to) : tab === 'out' ? x.from === me : true));
    return h.page(HEAD('Handoffs', 'Work passed between people, agents and teams — never their access', h.btn('Hand off work', 'data-wf="handoff"', false, 'send'))
      + h.seg('tab', 'Handoffs', [['in', 'To me', all.filter((x) => (x.to === me || teamOfMine(x.to)) && x.state === 'offered').length || null], ['out', 'From me'], ['all', 'All']], tab)
      + (rows.length ? h.table(['Work', 'From → to', 'Shares', 'State'], rows.map((x) => h.tr(`data-pg-ws="Handoffs/${x.id}"`, [`<b class="pg-name">${esc(x.work)}</b>${x.artifact ? `<small>${esc(x.artifact)}</small>` : ''}`, `${esc(x.from)} → ${esc(x.to)}`, `<small>${x.share.map((s) => ({ result: 'Result', summary: 'Summary', transcript: 'Transcript' }[s])).join(' · ')}</small>`, `${h.chip(HSTATE[x.state])}${x.state === 'offered' ? `<small class="pg-dim"> ${left(x.expires)}</small>` : ''}`]))) : h.box('send', tab === 'in' ? 'Nothing handed to you' : 'Nothing here', 'A handoff passes a task, a run or a result to someone else, who does it with their own access.', '', 'sm'))
      + h.foot('wf:handoffs', 'GET /api/v2/workspaces/:id/handoffs', 'handoff'));
  }
  const teamOfMine = (name) => { const t = team(name); return t && t.members.some((x) => x.name === you() && x.fn === 'manager'); };
  function handoffPage(id) {
    expire(); const h = P(), x = st().handoffs.find((y) => y.id === id); if (!x) return h.page(HEAD('Handoff', '') + h.box('send', 'Not found', ''));
    const mine = x.to === you() || teamOfMine(x.to), sent = x.from === you();
    const acts = x.state === 'offered' ? (mine ? h.btn('Accept', `data-wf="accept" data-arg="${x.id}"`, false, 'check') + h.btn('Decline', `data-wf="decline" data-arg="${x.id}"`, true, 'x') : '') + (sent ? h.btn('Withdraw', `data-wf="withdraw" data-arg="${x.id}"`, true, 'undo') : '') : '';
    return h.page(HEAD(x.work, `${x.from} → ${x.to} · ${HSTATE[x.state]}${x.state === 'offered' ? ' · ' + left(x.expires) : ''}`, acts, '<a data-pg-ws="Handoffs">Handoffs</a>', true)
      + `<div class="pg-cols pg-cols--item"><div>${x.note ? `<section class="pg-sec"><h3>Note</h3><p>${esc(x.note)}</p></section>` : ''}
        <section class="pg-sec"><h3>What it shares</h3><ul class="wf-share">${['result', 'summary', 'transcript'].map((s) => `<li class="${x.share.includes(s) ? 'on' : ''}">${ic(x.share.includes(s) ? 'check' : 'x')}<span>${{ result: 'The result', summary: 'A summary of the work', transcript: 'The full transcript' }[s]}</span></li>`).join('')}</ul><p class="pg-dim wf-note">Nothing else from ${esc(x.from)}’s history moves with it (HAND-06).</p></section>
        <section class="pg-sec"><h3>History</h3><ol class="pg-tl">${x.rev.map((r) => `<li><i></i><span>${esc(r.by)} — ${esc(r.what)}</span><small>${new Date(r.at).toLocaleString()}</small></li>`).join('')}</ol></section></div>
        <aside><dl class="pg-props"><dt>Boundaries</dt><dd>${x.crossed.map(esc).join('<br>') || 'None'}</dd><dt>Who pays</dt><dd>${esc(x.payer)}</dd><dt>Access</dt><dd>${esc(x.to)}’s own</dd>${x.artifact ? `<dt>Result</dt><dd>${esc(x.artifact)}</dd>` : ''}</dl><p class="pg-dim wf-note">The receiver works with their own access — a handoff never lends the sender’s (HAND-02).</p></aside></div>`
      + h.foot('wf:handoff', 'GET /api/v2/workspaces/:id/handoffs/:handoffId'));
  }
  const DKIND = { admit: 'Admitted', remove: 'Removed', fn: 'Function', role: 'Role', head: 'Head', budget: 'Budget', division: 'Division', team: 'Team', assign: 'Assignment' };
  function decisionsPage() {
    const h = P(), u = h.ui('wf:decisions'), k = u.seg.kind || 'all', rows = st().decisions.filter((d) => k === 'all' || d.kind === k);
    const kinds = [...new Set(st().decisions.map((d) => d.kind))];
    return h.page(HEAD('Decisions', 'Who decided what, why, and who answers for it')
      + (kinds.length > 1 ? h.seg('kind', 'Kind', [['all', 'All'], ...kinds.map((x) => [x, DKIND[x] || x])], k) : '')
      + (rows.length ? `<ol class="wf-dec">${rows.map((d) => `<li><span class="wf-dk">${esc(DKIND[d.kind] || d.kind)}</span><div><b>${esc(d.what)}</b>${d.reason ? `<p>“${esc(d.reason)}”</p>` : ''}<small>${esc(d.by)}${d.responsible && d.responsible !== d.by ? ` · answerable: ${esc(d.responsible)}` : ''} · ${esc(d.authority)} · ${new Date(d.at).toLocaleString()}${d.evidence ? ` · evidence: ${esc(d.evidence)}` : ''}</small></div></li>`).join('')}</ol>` : h.box('check', 'No decisions yet', 'Admitting, removing, promoting, assigning a division or setting a budget is recorded here.', '', 'sm'))
      + h.foot('wf:decisions', 'GET /api/v2/workspaces/:id/decisions', 'decision'));
  }

  // ---------- actions ----------
  const people = () => W().members.filter((m) => m.status !== 'departed' && m.status !== 'invited');
  const reasonField = { id: 'why', label: 'Reason', type: 'textarea', rows: 2, placeholder: 'Recorded with the decision', max: 200 };
  const ACT = {
    async seed() { const t0 = now(); SEEDS.forEach(([n, about]) => st().divisions.push({ id: 'dv' + rid(), name: n, about, parent: null, head: null, budget: { alloc: 0, spent: 0, reserved: 0 }, archived: false, at: t0 })); decide({ kind: 'division', subject: 'Divisions', what: 'Set up the starter divisions' }); commit('Six divisions created — rename or archive any of them'); },
    async newDiv() { const v = await D().form({ title: 'New division', submit: 'Create division', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 40, validate: (x) => (divs(true).some((d) => d.name.toLowerCase() === x.trim().toLowerCase()) ? 'A division with this name exists.' : null) }, { id: 'about', label: 'What it does', max: 80 }, ...(divs().length ? [{ id: 'parent', label: 'Inside', type: 'choice', cols: 3, value: '', options: [['', 'Workspace', 'Top level'], ...divs().map((d) => [d.id, d.name, ''])] }] : [])] });
      if (!v) return; st().divisions.push({ id: 'dv' + rid(), name: v.name.trim(), about: v.about || '', parent: v.parent || null, head: null, budget: { alloc: 0, spent: 0, reserved: 0 }, archived: false, at: now() }); decide({ kind: 'division', subject: v.name.trim(), what: `Created the ${v.name.trim()} division` }); commit(`Created ${v.name.trim()}`); },
    async renameDiv(id) { const d = div(id), was = d.name; const v = await D().form({ title: 'Rename division', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, value: was, max: 40 }] }); if (!v || v.name.trim() === was) return;
      d.name = v.name.trim(); W().members.forEach((m) => { m.divisions = (m.divisions || []).map((n) => (n === was ? d.name : n)); }); decide({ kind: 'division', subject: d.name, what: `Renamed ${was} to ${d.name}` }); commit(); X().go('global', { global: 'workspace', item: 'Divisions/' + d.name }); },
    async archiveDiv(id) { const d = div(id), ts = st().teams.filter((t) => t.ownDiv === d.id);
      if (!await D().confirm({ title: `Archive ${esc(d.name)}?`, body: `No new work is admitted to it. ${ts.length ? `Its ${ts.length} team${ts.length > 1 ? 's keep' : ' keeps'} running and ` : ''}its projects, runs and history stay exactly as they are — archiving deletes nothing.`, action: 'Archive', danger: false })) return;
      d.archived = true; decide({ kind: 'division', subject: d.name, what: `Archived ${d.name}` }); commit(`${d.name} archived`); },
    restoreDiv(id) { const d = div(id); d.archived = false; decide({ kind: 'division', subject: d.name, what: `Restored ${d.name}` }); commit(`${d.name} restored`); },
    async head(id) { const d = div(id); const v = await D().form({ title: `Head of ${d.name}`, sub: 'The head admits teams, assigns work and approves runs inside the division — and can’t raise its own budget.', submit: 'Set head', size: 'sm', fields: [{ id: 'who', label: 'Head', type: 'choice', cols: 2, value: d.head || '', options: [['', 'No head', ''], ...people().map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent' : m.title])] }, reasonField] });
      if (!v || v.who === (d.head || '')) return; const was = d.head; d.head = v.who || null; decide({ kind: 'head', subject: v.who || d.name, what: v.who ? `Made ${v.who} head of ${d.name}` : `Removed the head of ${d.name}`, reason: v.why, supersedes: was ? `Head: ${was}` : null }); commit(); },
    async budget(id) { const d = div(id), me = you(), wsAdmin = ['owner', 'admin'].includes(member(me)?.role);
      if (d.head === me && !wsAdmin) return D().confirm({ title: 'A workspace admin sets this', body: 'You head this division. Raising your own division’s budget needs someone above it (DIV-06).', action: 'OK', danger: false });
      const v = await D().form({ title: `${d.name} budget`, sub: 'A share of the workspace wallet, per month.', submit: 'Save budget', size: 'sm', fields: [{ id: 'n', label: 'Credits a month', type: 'number', required: true, value: String(d.budget.alloc || 10000), validate: (x) => (/^\d+$/.test(x) ? null : 'A whole number.') }, reasonField] });
      if (!v) return; const was = d.budget.alloc; d.budget.alloc = +v.n; if (!d.budget.spent) d.budget.spent = Math.round(+v.n * 0.35); decide({ kind: 'budget', subject: d.name, what: `Set ${d.name}’s budget to ${credits(+v.n)} a month`, reason: v.why, supersedes: was ? credits(was) : null }); commit(`${d.name}: ${credits(+v.n)} a month`); },
    async newTeam(divId) { const v = await D().form({ title: 'New team', submit: 'Create team', fields: [{ id: 'name', label: 'Name', required: true, max: 40, validate: (x) => (st().teams.some((t) => t.name.toLowerCase() === x.trim().toLowerCase()) ? 'A team with this name exists.' : null) }, { id: 'mgr', label: 'Manager', type: 'choice', cols: 3, value: you(), options: people().map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent' : m.title]) }, ...(divs().length ? [{ id: 'own', label: 'Reports to', type: 'choice', cols: 3, value: divId || '', options: [['', 'Workspace', ''], ...divs().map((d) => [d.id, d.name, ''])] }] : [])] });
      if (!v) return; st().teams.push({ id: 'team_' + rid(), name: v.name.trim(), ownDiv: v.own || null, fundDiv: null, assignedTo: [], projects: [], members: [{ name: v.mgr, fn: 'manager', since: now() }], archived: false }); W().teams.push({ id: 'team_' + rid(), name: v.name.trim(), lead: v.mgr, members: [v.mgr], projects: [] });
      decide({ kind: 'team', subject: v.name.trim(), what: `Created the ${v.name.trim()} team with ${v.mgr} as manager` }); commit(); X().go('global', { global: 'workspace', item: 'Teams/' + v.name.trim() }); },
    async archiveTeam(n) { const t = team(n); if (!await D().confirm({ title: `Archive ${esc(t.name)}?`, body: 'It stops taking new work. Its runs, projects and history stay.', action: 'Archive', danger: false })) return; t.archived = true; decide({ kind: 'team', subject: t.name, what: `Archived the ${t.name} team` }); commit(`${t.name} archived`); X().go('global', { global: 'workspace', item: 'Teams' }); },
    // LIFE-01: joining a team is an admission with a function — the member accepts (agents accept through their owner)
    async addMember(n) { const t = team(n), out = people().filter((m) => !t.members.some((x) => x.name === m.name));
      if (!out.length) return X().toast('Everyone is already on this team');
      const v = await D().form({ title: `Add to ${t.name}`, submit: 'Add', fields: [{ id: 'who', label: 'Who', type: 'choice', cols: 3, required: true, options: out.map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent · ' + ownerOf(m) : m.title]) }, { id: 'fn', label: 'Function', type: 'seg', value: 'worker', options: [['manager', 'Manager'], ['worker', 'Worker'], ['observer', 'Observer']] }, reasonField] });
      if (!v) return; t.members.push({ name: v.who, fn: v.fn, since: now() }); decide({ kind: 'admit', subject: v.who, what: `Admitted ${v.who} to ${t.name} as a ${v.fn}`, reason: v.why }); commit(`${v.who} joined ${t.name} as a ${v.fn}`); },
    async unteam(arg) { const [n, who] = arg.split('|'), t = team(n), x = t.members.find((y) => y.name === who);
      if (x.fn === 'manager' && t.members.filter((y) => y.fn === 'manager').length === 1) return D().confirm({ title: 'A team needs a manager', body: `Make someone else a manager before removing ${esc(who)}.`, action: 'OK', danger: false });
      t.members = t.members.filter((y) => y.name !== who); decide({ kind: 'remove', subject: who, what: `Removed ${who} from ${t.name}` }); commit(); window.XA && (() => { const tt = document.getElementById('toast'); tt.innerHTML = `Removed ${esc(who)} from ${esc(t.name)} <button class="pg-undo">Undo</button>`; tt.classList.add('on'); tt.querySelector('.pg-undo').onclick = () => { t.members.push(x); st().decisions.shift(); commit(); tt.classList.remove('on'); }; })(); },
    // LIFE-05: promotion changes a FUNCTION, with an actor and a reason
    async fn(arg) { const [n, who] = arg.split('|'), t = team(n), x = t.members.find((y) => y.name === who);
      const v = await D().form({ title: `${who} in ${t.name}`, sub: 'A function says what someone is for in this team. It never adds access they don’t already have.', submit: 'Change function', size: 'sm', fields: [{ id: 'fn', label: 'Function', type: 'choice', cols: 1, value: x.fn, options: Object.entries(FN).map(([k, f]) => [k, k[0].toUpperCase() + k.slice(1), f.may[0]]) }, reasonField] });
      if (!v || v.fn === x.fn) return; if (x.fn === 'manager' && t.members.filter((y) => y.fn === 'manager').length === 1) return X().toast('A team needs at least one manager');
      const was = x.fn; x.fn = v.fn; decide({ kind: 'fn', subject: who, what: `${who}: ${was} → ${v.fn} in ${t.name}`, reason: v.why, supersedes: was }); commit(`${who} is now a ${v.fn} in ${t.name}`); },
    async assign(n) { const t = team(n), opts = divs().filter((d) => d.id !== t.ownDiv && !t.assignedTo.includes(d.id)); if (!opts.length) return X().toast('No other division to assign it to');
      const v = await D().form({ title: `Assign ${t.name}`, sub: 'The team also works for that division. Who it reports to and who pays it stay the same.', submit: 'Assign', size: 'sm', fields: [{ id: 'd', label: 'Division', type: 'choice', cols: 2, required: true, options: opts.map((d) => [d.id, d.name, '']) }] });
      if (!v) return; t.assignedTo.push(v.d); decide({ kind: 'assign', subject: t.name, what: `Assigned ${t.name} to ${div(v.d).name}` }); commit(`${t.name} now also works for ${div(v.d).name}`); },
    unassign(arg) { const [n, id] = arg.split('|'), t = team(n); t.assignedTo = t.assignedTo.filter((x) => x !== id); decide({ kind: 'assign', subject: t.name, what: `Ended ${t.name}’s assignment to ${div(id)?.name}` }); commit(); },
    async memberDivs(n) { const m = member(n); const v = await D().form({ title: `${n}’s divisions`, submit: 'Save', size: 'sm', fields: [{ id: 'd', label: 'Divisions', type: 'checks', cols: 2, value: m.divisions || [], options: divs().map((d) => [d.name, d.name]) }] }); if (!v) return; m.divisions = v.d; decide({ kind: 'division', subject: n, what: `${n}: ${v.d.length ? v.d.join(', ') : 'no division'}` }); commit(); },
    act(v) { LS.set('wfAct', v); X().render(); }, actTeam(v) { LS.set('wfTeam', v); X().render(); }, win(v) { LS.set('wfWin', +v); X().render(); },
    // HAND-01..06: the handoff dialog shows who receives it, what moves with it, which boundaries it crosses and who pays
    async handoff(arg) {
      const me = you(), tasks = Object.entries(window.XENO_PROJECTS || {}).flatMap(([pn, p]) => (p.taskObjs || []).filter((t) => t.state !== 'done').map((t) => [`${pn}: ${t.title}`, t.title, pn]));
      const targets = [...people().filter((m) => m.name !== me).map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent · owned by ' + ownerOf(m) : m.title]), ...st().teams.filter((t) => !t.archived).map((t) => ['team:' + t.name, t.name, 'Team · its managers decide'])];
      const pre = arg && arg.startsWith('team:') ? arg : arg || '';
      const v = await D().form({ title: 'Hand off work', sub: 'They do it with their own access — never yours.', submit: 'Offer handoff', fields: [
        { id: 'work', label: 'Work', type: 'choice', cols: 1, required: true, options: tasks.slice(0, 8).map(([v2, l, pn]) => [v2, l, pn]) },
        { id: 'to', label: 'To', type: 'choice', cols: 3, required: true, value: pre, options: targets },
        { id: 'share', label: 'Shares', type: 'checks', value: ['result', 'summary'], options: [['result', 'The result'], ['summary', 'A summary of the work'], ['transcript', 'The full transcript — your conversation goes with it']] },
        { id: 'exp', label: 'Offer stands for', type: 'seg', value: '72', options: [['24', '1 day'], ['72', '3 days'], ['168', '1 week']] },
        { id: 'note', label: 'Note', type: 'textarea', rows: 2, max: 200 }] });
      if (!v) return;
      const to = v.to.replace(/^team:/, ''), tm = member(to), meM = member(me), myDiv = (meM?.divisions || [])[0], theirDiv = tm ? (tm.divisions || [])[0] : div(team(to)?.ownDiv)?.name;
      const crossed = [...(tm?.kind === 'agent' ? ['person → agent'] : []), ...(tm?.kind === 'agent' && ownerOf(tm) !== me ? [`your account → ${ownerOf(tm)}’s agent`] : []), ...(myDiv !== theirDiv && (myDiv || theirDiv) ? [`${myDiv || 'workspace'} → ${theirDiv || 'workspace'}`] : [])];
      const payTeam = team(to) || st().teams.find((t) => t.members.some((x) => x.name === to)), payer = payTeam && (div(payTeam.fundDiv) || div(payTeam.ownDiv))?.name || 'Workspace';
      const x = { id: 'h' + rid(), from: me, to, work: v.work.split(': ').slice(1).join(': ') || v.work, kind: 'task', artifact: null, share: v.share, note: v.note, state: 'offered', at: now(), expires: now() + +v.exp * H, crossed, payer, rev: [{ at: now(), by: me, what: 'Offered' }] };
      st().handoffs.unshift(x); commit(); X().go('global', { global: 'workspace', item: 'Handoffs/' + x.id }); X().toast(`Offered to ${to} — ${v.exp === '168' ? 'a week' : v.exp === '24' ? 'a day' : '3 days'} to accept`); },
    accept(id) { const x = st().handoffs.find((y) => y.id === id); x.state = 'accepted'; x.rev.push({ at: now(), by: you(), what: 'Accepted' }); commit(`Accepted — billed to ${x.payer}`); },
    async decline(id) { const x = st().handoffs.find((y) => y.id === id); const v = await D().form({ title: 'Decline handoff', submit: 'Decline', size: 'sm', fields: [{ id: 'why', label: 'Why (they’ll see this)', type: 'textarea', rows: 2, max: 200 }] }); if (!v) return; x.state = 'declined'; x.rev.push({ at: now(), by: you(), what: 'Declined' + (v.why ? ` — ${v.why}` : '') }); commit('Declined'); },
    withdraw(id) { const x = st().handoffs.find((y) => y.id === id); x.state = 'revoked'; x.rev.push({ at: now(), by: you(), what: 'Withdrew the offer' }); commit('Withdrawn'); },
  };
  // LIFE-02/03: removing a member revokes at once, settles what they were doing, then archives — history stays
  async function removeWithSettlement(n) {
    const m = member(n); if (!m) return; const agent = m.kind === 'agent';
    const runs = Object.values(window.XENO_PG_AREAS || {}).flatMap((A) => { const ai = A.cols.indexOf('Agent'), si = A.cols.indexOf('Status'); return ai < 0 ? [] : A.rows.filter((r) => r[ai] === n && /Running|Waiting/.test(r[si])).map((r) => r[0]); });
    const open = st().handoffs.filter((h2) => h2.state === 'offered' && (h2.to === n || h2.from === n)), ts = st().teams.filter((t) => t.members.some((x) => x.name === n));
    const v = await D().form({ title: `Remove ${n}`, sub: 'Access ends now. Work in progress is settled first, then the membership is archived — nothing is deleted.', submit: agent ? 'Remove agent' : 'Remove', danger: true,
      aside: `<b class="xd-sum-h">What happens</b><ul class="xd-caps"><li>Can’t start anything new — immediately</li>${runs.length ? `<li>${runs.length} run${runs.length > 1 ? 's' : ''} in progress (${runs.map(esc).join(', ')}) ${agent ? 'pause at a safe point and can be resumed by someone else' : 'keep their history'}</li>` : ''}${open.length ? `<li>${open.length} open handoff${open.length > 1 ? 's are' : ' is'} withdrawn</li>` : ''}${ts.length ? `<li>Leaves ${ts.map((t) => esc(t.name)).join(', ')}</li>` : ''}<li>Their files, runs and decisions stay theirs, by name</li></ul>`,
      fields: [reasonField] });
    if (!v) return;
    m.status = 'settling'; open.forEach((h2) => { h2.state = 'revoked'; h2.rev.push({ at: now(), by: 'XENO', what: `Withdrawn — ${n} was removed` }); });
    ts.forEach((t) => { t.members = t.members.filter((x) => x.name !== n); });
    decide({ kind: 'remove', subject: n, what: `Removed ${n} from the workspace`, reason: v.why, evidence: runs.length ? `${runs.length} runs settled` : '' }); commit(`Removing ${n} — settling ${runs.length ? runs.length + ' runs' : 'their work'}`);
    setTimeout(() => { m.status = 'departed'; m.departedAt = now(); persist(); X().render(); X().toast(`${n} has left — settled and archived`); }, 4000);
  }

  document.addEventListener('click', (e) => { const t = e.target.closest('[data-wf]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); ACT[t.dataset.wf]?.(t.dataset.arg); }, true);
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-wf-sel]'); if (!s) return; const t = team(s.dataset.arg), f = s.dataset.wfSel, was = t[f]; t[f] = s.value || null;
    decide({ kind: 'division', subject: t.name, what: `${t.name}: ${f === 'ownDiv' ? 'reports to' : 'paid by'} ${div(s.value)?.name || 'the workspace'}`, supersedes: was ? div(was)?.name : null }); commit(f === 'ownDiv' ? `${t.name} reports to ${div(s.value)?.name || 'the workspace'}` : `${t.name}’s runs are paid by ${div(s.value)?.name || 'the workspace'}`); });

  function route(it) {
    if (it === 'Divisions') return divisionsPage();
    if (it?.startsWith('Divisions/')) return divisionPage(it.slice(10));
    if (it === 'Teams') return teamsPage();
    if (it?.startsWith('Teams/')) return teamPage(it.slice(6));
    if (it === 'Handoffs') return handoffsPage();
    if (it?.startsWith('Handoffs/')) return handoffPage(it.slice(9));
    if (it === 'Decisions') return decisionsPage();
    if (it && div(it)) return divisionPage(it);   // a division row in the sidebar
    return null;
  }
  const pendingForMe = () => (expire(), st().handoffs.filter((x) => x.state === 'offered' && (x.to === you() || teamOfMine(x.to))).length);
  window.XENO_WF = { commit, persist, you, member, ownerOf, st, route, memberExtra, decide, removeWithSettlement, pendingForMe, divs, team, handoff: ACT.handoff, sync: syncWorkspace };
  syncWorkspace();
})();
