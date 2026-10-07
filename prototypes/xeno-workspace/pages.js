/* Full-page destinations — one page system for every global, area, item and product page.
   Parts (MODES SPEC §7d): header · toolbar · results (table | grid | board) · detail pane · states.
   Every page renders from data shaped like its API response (pages-data.js), and every page has the
   same six states: first use, normal, many, loading, error, no access. Nothing here is per-mode code. */
(() => {
  const X = () => window.XW, PR = window.XENO_PRODUCTS, M = window.XENO_MODE_MARKS;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k);
  const S = () => X().S;
  const store = { get: (k, d) => X().store.get(k, d), set: (k, v) => X().store.set(k, v) };

  // ---------- formatting ----------
  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : m < 10080 ? `${Math.round(m / 1440)} d` : new Date(Date.parse(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const bytes = (b) => b < 1e3 ? `${b} B` : b < 1e6 ? `${Math.round(b / 1e3)} KB` : b < 1e9 ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : `${(b / 1e9).toFixed(1)} GB`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const KIND = { image: ['Image', 'image'], video: ['Video', 'film'], audio: ['Audio', 'play'], document: ['Document', 'doc'], sheet: ['Sheet', 'grid'], deck: ['Deck', 'layers'], design: ['Design file', 'palette'], code: ['Code', 'code'], chat: ['Chat', 'chat'], post: ['Post', 'send'] };
  const pname = (id) => (PR[id] ? PR[id].name : cap(id));
  const modeName = (id) => (M[id] ? M[id].name : cap(id));
  // status chip: a small square + the word. Never colour alone, never a circle (DESIGN_SYSTEM.md)
  const TONE = { running: 'live', rendering: 'live', scheduled: 'live', 'waiting on you': 'need', 'needs approval': 'need', 'at risk': 'need', invited: 'need', failed: 'bad', blocked: 'bad', done: 'ok', 'on track': 'ok', ok: 'ok', active: 'ok', idle: 'off', draft: 'off', archived: 'off', answered: 'ok', open: 'off', planned: 'live' };
  const chip = (label) => { const t = TONE[String(label).toLowerCase().replace(/ \d+%$/, '')] || 'off'; return `<span class="pg-st pg-st--${t}"><i></i>${esc(label)}</span>`; };
  const avatar = (m, sz = '') => `<span class="pg-av${m.kind === 'agent' ? ' agent' : ''}${sz}" title="${esc(m.name)}${m.kind === 'agent' ? ' (agent)' : ''}">${m.kind === 'agent' ? ic('bot') : esc(m.name[0])}</span>`;
  const stack = (ms, n = 4) => `<span class="pg-stack">${ms.slice(0, n).map((m) => avatar(m)).join('')}${ms.length > n ? `<span class="pg-av more">+${ms.length - n}</span>` : ''}</span>`;
  const meter = (done, total) => `<span class="pg-meter" role="img" aria-label="${done} of ${total} done"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></span><span class="pg-meter-n">${done}/${total}</span>`;
  const prodIcon = (id, size = 18) => (PR[id] ? X().pIconFull(PR[id], size) : `<span class="code">${esc(id.slice(0, 2))}</span>`);

  // ---------- page UI state (per page key, in memory; the view mode survives reloads) ----------
  const UI = {};
  const ui = (key, def = {}) => { if (!UI[key]) { const o = { q: '', seg: {}, sort: def.sort || 'recent', view: store.get('pgView.' + key, def.view || 'list'), ...def.extra }; let sel = null;
    // a selection is an ANCHOR (the last plain click — where Shift ranges start) plus the picked set (Finder, Drive)
    o.picked = new Set(); Object.defineProperty(o, 'sel', { enumerable: true, get: () => sel, set: (v) => { sel = v; if (v == null) o.picked.clear(); } }); UI[key] = o; } return UI[key]; };
  const pstate = (fam) => (store.get('pgState', {}) || {})[fam] || 'normal';
  const loaded = new Set(), AT = {};   // AT: when each page's data last arrived — the status bar's 'Updated …'

  // ---------- shared parts ----------
  // collection pages hand their title, summary and actions to the main header bar (one header, not two);
  // object pages (a project, a run, a Mind) keep the object's own title in the body — it is the content
  const head = ({ eyebrow, title, sub, acts = '', meta = '', obj = false }) => `<header class="pg-head ${obj ? 'pg-head--obj' : 'pg-head--col'}"><div class="pg-ttl">${eyebrow ? `<small>${eyebrow}</small>` : ''}<h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${acts ? `<div class="pg-acts">${acts}</div>` : ''}</header>${meta ? `<div class="pg-meta">${meta}</div>` : ''}`;
  const btn = (label, attrs, ghost, icon) => `<button class="pg-btn${ghost ? ' ghost' : ''}" ${attrs}>${icon ? ic(icon) : ''}<span>${esc(label)}</span></button>`;
  const seg = (key, name, opts, cur) => `<div class="pg-seg" role="tablist" aria-label="${esc(name)}">${opts.map(([v, l, n]) => `<button role="tab" aria-selected="${v === cur}" data-pg-seg="${key}" data-v="${esc(v)}">${esc(l)}${n != null ? `<em>${n}</em>` : ''}</button>`).join('')}</div>`;
  const search = (key, ph, q) => `<label class="pg-search">${ic('search')}<input data-pg-q="${key}" value="${esc(q)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" spellcheck="false">${q ? `<button data-pg-clear="${key}" aria-label="Clear search">${ic('x')}</button>` : '<kbd>/</kbd>'}</label>`;
  // dropdown: a labelled button that opens a real menu (sort, filters that do not fit a segmented control)
  const dd = (key, field, label, opts, cur, icon) => `<button class="pg-dd" data-pg-dd="${key}" data-field="${field}" data-opts="${esc(opts.map((o) => o.join(':')).join('|'))}" aria-haspopup="listbox" aria-expanded="false">${icon ? ic(icon) : ''}<span class="pg-dd-l">${esc(label)}</span><b>${esc((opts.find(([v]) => v === cur) || opts[0])[1])}</b>${ic('chev')}</button>`;
  const sortSel = (key, opts, cur) => dd(key, 'sort', 'Sort', opts, cur, 'sliders');
  const viewTog = (key, cur) => `<div class="pg-vt" role="group" aria-label="Layout"><button data-pg-view="${key}" data-v="list" aria-pressed="${cur === 'list'}" aria-label="List">${ic('layers')}</button><button data-pg-view="${key}" data-v="grid" aria-pressed="${cur === 'grid'}" aria-label="Grid">${ic('grid')}</button></div>`;
  const bar = (...parts) => `<div class="pg-bar">${parts.filter(Boolean).join('')}</div>`;
  const foot = (fam, api, noun = '') => `<footer class="pg-foot" data-fam="${esc(fam)}" data-api="${esc(api)}" data-noun="${esc(noun)}"></footer>`;
  const box = (icon, title, body, acts = '', cls = '') => `<div class="pg-state ${cls}"><span class="pg-state-ic">${ic(icon)}</span><b>${esc(title)}</b><p>${body}</p>${acts ? `<div class="pg-state-acts">${acts}</div>` : ''}</div>`;
  const skel = (kind = 'rows', n = 6) => kind === 'grid' ? `<div class="pg-grid" aria-busy="true">${Array.from({ length: n }, () => '<div class="pg-card skel"><span class="pg-thumb"></span><i></i><i class="s"></i></div>').join('')}</div>` : `<div class="pg-table" aria-busy="true">${Array.from({ length: n }, (_, i) => `<div class="pg-tr skel"><i style="width:${[38, 52, 30, 46, 34, 42][i % 6]}%"></i><i></i><i></i></div>`).join('')}</div>`;
  // the shared state switch: loading / error / denied are decided here, once, for every page
  function gate(fam, kind, firstUse) {
    const st = pstate(fam);
    // loading = the page's real layout drawn as shapes (see .pg--loading in pages.css), so data replaces it in place
    if (st === 'loading' || (!loaded.has(fam) && st === 'normal')) { if (st === 'normal') setTimeout(() => { loaded.add(fam); AT[fam] = Date.now(); repaint(); }, window.__xwLatency ?? 360 /* QA hook: same slow-network setting as the feeds */); LOADING = true; return null; }
    if (st === 'error') return box('reset', "Couldn't load this page", 'The server did not answer. Your data is safe — nothing was changed.', btn('Try again', `data-pg-retry="${fam}"`), 'err');
    if (st === 'denied') return box('gear', 'You don’t have access', 'This page is limited to workspace admins. Ask an owner to give you access, or switch workspace.', (store.get('accessRequested', {}) || {})[fam] ? btn('Request sent', 'disabled aria-disabled="true"', true, 'check') : btn('Request access', `data-xa="requestAccess" data-arg="${esc(fam)}"`, true));
    if (st === 'empty') return firstUse();
    return null;
  }
  const table = (cols, rows, cls = '') => `<div class="pg-table ${cls}" role="table"${cls ? '' : ` style="--cols:minmax(0,2.2fr) repeat(${cols.length - 1},minmax(0,1fr))"`}><div class="pg-tr pg-th" role="row">${cols.map((c) => `<span role="columnheader">${esc(c)}</span>`).join('')}</div>${rows.join('')}</div>`;
  const tr = (attrs, cells, sel) => `<div class="pg-tr" role="row" tabindex="0" ${attrs}${sel ? ' aria-selected="true"' : ''}>${cells.map((c) => `<span role="cell">${c}</span>`).join('')}</div>`;
  const filtered = (key, q, what) => box('search', `No ${what} match “${q}”`, 'Try a shorter word, or clear the search to see everything.', btn('Clear search', `data-pg-clear="${key}"`, true));
  const matchQ = (q, ...f) => !q || f.join(' ').toLowerCase().includes(q.toLowerCase());
  let LOADING = false;
  const page = (inner, cls = '') => { const l = LOADING; LOADING = false; return `<div class="pg ${cls}${l ? ' pg--loading' : ''}"${l ? ' aria-busy="true"' : ''}>${inner}</div>`; };

  // =====================================================================================
  // PROJECTS — index, then one project with its tabs (WORKFORCE §8.5, §11.2)
  // =====================================================================================
  const PROJ = () => window.XENO_PG_PROJECTS.items.filter((p) => !window.XENO_VIS || window.XENO_VIS.project(p));
  const HEALTH = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked', done: 'Done' };
  function projectsIndex(arch) {
    const key = 'projects', u = ui(key, { extra: {} }), ctx = X().ctxName();
    const status = arch ? 'archived' : u.seg.status || (window.XENO_VIS?.guest() ? 'shared' : 'active');
    const modeF = u.seg.mode || 'all';
    const all = PROJ(), counts = { active: all.filter((p) => p.status === 'active').length, shared: all.filter((p) => p.status === 'shared').length, archived: all.filter((p) => p.status === 'archived').length };
    let rows = all.filter((p) => p.status === status && (modeF === 'all' || p.mode === modeF) && matchQ(u.q, p.name, p.goal, p.milestone.title));
    rows.sort(u.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : u.sort === 'progress' ? (a, b) => b.tasks.done / b.tasks.total - a.tasks.done / a.tasks.total : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const act = all.filter((p) => p.status === 'active'), needs = act.reduce((n, p) => n + p.needsYou, 0), blocked = act.filter((p) => p.health === 'blocked').length;
    const firstUse = () => box('folder', 'Start your first project', 'A project keeps the chats, files, tasks and teams for one goal together — and it is the same project in every mode.', btn('New project', 'data-xa="newProject"', false, 'plus') + btn('Turn a chat into a project', 'data-xa="newProject"', true));
    const body = gate(key, u.view === 'grid' ? 'grid' : 'rows', firstUse) ?? (!rows.length ? (u.q ? filtered(key, u.q, 'projects') : modeF !== 'all' ? box('folder', `No ${status === 'active' ? '' : status + ' '}${modeF} projects`, `Projects from other modes are one click away.`, btn('Show all modes', 'data-pg-seg="mode" data-v="all"', true)) : box('archive', status === 'archived' ? 'Nothing archived' : 'Nothing shared with you yet', status === 'archived' ? 'Finished projects land here, with their history intact.' : 'When someone adds you to their project it shows up here.')) :
      u.view === 'grid' ? `<div class="pg-grid pg-grid--proj">${rows.map(projCard).join('')}</div>` :
      table(['Project', 'Mode', 'Progress', 'Next milestone', 'Health', 'People', 'Updated'], rows.map((p) => tr(`data-pg-go-project="${esc(p.name)}"`, [`<b class="pg-name"><span class="pg-picon">${ic(p.icon || 'folder')}</span>${esc(p.name)}${p.needsYou ? `<em class="pg-need">${p.needsYou} need you</em>` : ''}</b>${p.goal ? `<small>${esc(p.goal)}</small>` : ''}`, esc(p.mode), meter(p.tasks.done, p.tasks.total), `<span class="pg-two"><span>${esc(p.milestone.title)}</span><small>${esc(p.milestone.due)}</small></span>`, chip(HEALTH[p.health]), stack(p.members), `<small>${ago(p.updatedAt)}</small>`])), 'pg-table--proj'));
    const modes = ['all', ...new Set(all.map((p) => p.mode))];
    return page(head({ eyebrow: `${esc(ctx)} · Projects`, title: arch ? 'Archived projects' : 'Projects', sub: 'One project per goal — its chats, files, tasks and teams, in every mode.', acts: btn('New project', 'data-xa="newProject"', false, 'plus'),
      meta: arch ? '' : `<span><b>${counts.active}</b> active</span><span><b>${needs}</b> waiting on you</span><span><b>${blocked}</b> blocked</span>` })
      + bar(search(key, 'Search projects', u.q), arch ? '' : seg('status', 'Status', [['active', 'Active', counts.active], ['shared', 'Shared with me', counts.shared], ['archived', 'Archived', counts.archived]], status), '<span class="pg-sp"></span>', dd(key, 'mode', 'Mode', modes.map((m) => [m, m === 'all' ? 'All' : m]), modeF), sortSel(key, [['recent', 'Recently updated'], ['progress', 'Progress'], ['name', 'Name']], u.sort), viewTog(key, u.view))
      + `<div class="pg-body" data-pg-results>${body}</div>` + foot(key, 'GET /api/v2/projects?status', 'project'));
  }
  const projCard = (p) => `<div class="pg-card pg-card--proj" tabindex="0" data-pg-go-project="${esc(p.name)}"><div class="pg-card-top"><span class="pg-tag">${esc(p.mode)}</span><span class="pg-card-r">${p.needsYou ? `<em class="pg-need">${p.needsYou} need you</em>` : ''}${chip(HEALTH[p.health])}</span></div><b><span class="pg-picon">${ic(p.icon || 'folder')}</span>${esc(p.name)}</b><small class="pg-clamp">${esc(p.goal || p.milestone.title)}</small><div class="pg-card-mid">${meter(p.tasks.done, p.tasks.total)}</div><div class="pg-card-foot"><span>${esc(p.milestone.title)} · ${esc(p.milestone.due)}</span>${stack(p.members, 3)}</div></div>`;

  function projectPage(name, tab) {
    const L = PROJ().find((p) => p.name === name);
    const P = (window.XENO_PROJECTS || {})[name] || { mode: L ? L.mode : X().ctxName(), owner: L ? L.owner.name : 'You', goal: L ? (L.goal || '') : '', milestone: L ? L.milestone.title : '—', tasks: [], taskObjs: [], chats: [], teams: [], resources: [], funding: [], activity: [] };
    const tabs = window.XENO_PROJECT_TABS, cur = tabs.includes(tab) ? tab : 'Overview', fam = 'project';
    const meta = L || { tasks: { done: 0, total: 0 }, health: 'on_track', members: [], milestone: { title: P.milestone, due: '—' }, needsYou: 0 };
    const tasks = P.taskObjs || [];
    const COL = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];
    const taskCard = (t) => `<div class="pg-task" tabindex="0" role="button" data-xa="openTask" data-arg="${esc(name)}|${t.id}"><b>${esc(t.title)}</b><div>${t.assignee ? `${avatar(t.assignee)}<small>${esc(t.assignee.name)}</small>` : '<small class="dim">Unassigned</small>'}${t.state === 'review' ? `<span class="pg-ev">${ic('check')}Evidence attached</span>` : ''}</div></div>`;
    const timeline = (rows) => rows.length ? `<ol class="pg-tl">${rows.map(([t, w]) => `<li><i></i><span>${esc(t)}</span><small>${esc(w)}</small></li>`).join('')}</ol>` : '<p class="pg-dim">Nothing yet.</p>';
    const libFor = window.XENO_PG_LIBRARY.items.filter((f) => f.project === name && !f.trashedAt);
    const empty = (icon, t, b, a = '') => box(icon, t, b, a, 'sm');
    const body = gate(fam, 'rows', () => empty('folder', 'This project is empty', 'Add a task, attach a chat or file, or assign a team to get started.', btn('New task', `data-xa="newTask" data-arg="${esc(name)}"`, false, 'plus') + btn('Assign a team', `data-xa="assign" data-arg="${esc(name)}"`, true))) ?? ({
      Overview: () => `<div class="pg-cols"><div>
          ${meta.needsYou ? `<section class="pg-sec"><h3>Waiting on you <em>${meta.needsYou}</em></h3>${(window.XENO_NEEDS || []).filter((n) => (P.mode || '').toLowerCase() === n.m).slice(0, meta.needsYou).map((n) => `<div class="pg-need-row"><span>${esc(n.t)}</span>${btn(n.meta, `data-xa="resolveNeed" data-arg="${esc(n.t)}"`, n.meta !== 'Approve')}</div>`).join('') || '<p class="pg-dim">Open the Inbox to act on it.</p>'}</section>` : ''}
          <section class="pg-sec"><h3>Tasks</h3><div class="pg-mini-board">${COL.map(([k, l]) => `<button class="pg-mb" data-ptab="Tasks"><b>${tasks.filter((t) => t.state === k).length}</b><small>${l}</small></button>`).join('')}</div></section>
          <section class="pg-sec"><h3>Recent activity</h3>${timeline(P.activity.slice(0, 4))}</section></div>
        <aside><section class="pg-sec pg-card-s"><h3>Goal</h3><p>${esc(P.goal || 'No goal written yet.')}</p></section>
          <section class="pg-sec pg-card-s"><h3>Next milestone</h3><p><b>${esc(meta.milestone.title)}</b><small>Due ${esc(meta.milestone.due)}</small></p></section>
          <section class="pg-sec pg-card-s"><h3>People</h3>${meta.members.length ? meta.members.map((m) => `<div class="pg-person">${avatar(m)}<span>${esc(m.name)}</span><small>${m.kind === 'agent' ? 'Agent' : m.name === P.owner ? 'Owner' : 'Member'}</small></div>`).join('') : '<p class="pg-dim">Nobody yet.</p>'}</section></aside></div>`,
      Tasks: () => tasks.length ? `<div class="pg-board">${COL.map(([k, l]) => { const ts = tasks.filter((t) => t.state === k); return `<section class="pg-col"><h3>${l}<em>${ts.length}</em></h3>${ts.map(taskCard).join('') || '<p class="pg-dim">None</p>'}${k === 'todo' ? `<button class="pg-add" data-xa="newTask" data-arg="${esc(name)}">${ic('plus')}Add task</button>` : ''}</section>`; }).join('')}</div><p class="pg-rule">${ic('check')}A task closes only with evidence and a reviewer — agents can move work to review, people mark it done.</p>` : empty('check', 'No tasks yet', 'Break the goal into tasks. Agents can pick them up; a person always signs them off.', btn('New task', `data-xa="newTask" data-arg="${esc(name)}"`, false, 'plus')),
      Conversations: () => P.chats.length ? table(['Conversation', 'Where', ''], P.chats.map(([t, m]) => tr(`data-pg-chat="${esc(t)}"`, [`<span class="pg-ico">${ic(/^Agent/.test(m) ? 'bot' : 'chat')}</span><b class="pg-name">${esc(t)}</b>`, esc(m), `<small>Open ${ic('right')}</small>`]))) : empty('chat', 'No conversations attached', 'Chats you start inside this project stay with it, so the context is never lost.', btn('New chat in this project', `data-xa="newProjectChat" data-arg="${esc(name)}"`, false, 'plus')),
      'Team assignments': () => P.teams.length ? `<div class="pg-grid pg-grid--team">${P.teams.map(([t, m]) => { const team = window.XENO_PG_WORKSPACE.teams.find((x) => x.name === t); return `<div class="pg-card pg-card--team"><div class="pg-card-top"><b>${esc(t)}</b><span class="pg-tag">${/agent/i.test(t) ? 'Agent' : 'Team'}</span></div><small>${esc(m)}</small>${team ? stack(team.members.map((n) => ({ name: n, kind: ['Atlas', 'Kit', 'Juno', 'Echo'].includes(n) ? 'agent' : 'human' }))) : ''}</div>`; }).join('')}</div><p class="pg-rule">${ic('people')}Teams are referenced from the workspace, never copied — change the team once and every project sees it.</p>` : empty('people', 'No team assigned', 'Assign a workspace team or a single agent to this project.', btn('Assign', `data-xa="assign" data-arg="${esc(name)}"`, false, 'plus')),
      Resources: () => (libFor.length || P.resources.length) ? `<div class="pg-grid">${libFor.map((f) => fileCard(f, false)).join('')}${P.resources.filter(([t]) => !libFor.some((f) => f.name === t)).map(([t, m]) => `<div class="pg-card" tabindex="0" role="button" data-xa="openResource" data-arg="${esc(name)}|${esc(t)}"><span class="pg-thumb pg-thumb--ic">${ic(/Repo/.test(m) ? 'code' : /Library/.test(m) ? 'lib' : 'doc')}</span><b>${esc(t)}</b><small>${esc(m)}</small></div>`).join('')}</div>` : empty('file', 'No files attached', 'Attach files from your Library or drop them here.', btn('Attach from Library', 'data-go="library"', true)),
      Funding: () => window.XENO_FUND ? window.XENO_FUND.tab(name) : P.funding.length ? `<div class="pg-fund">${P.funding.map(([t, v]) => { const m = v.match(/€([\d,]+) of €([\d,]+)/); const a = m ? +m[1].replace(/,/g, '') : 0, b = m ? +m[2].replace(/,/g, '') : 0; return `<div class="pg-card-s pg-sec"><h3>${esc(t)}</h3><p><b>${esc(v)}</b></p>${m ? `<div class="pg-big-meter"><span style="width:${Math.round((a / b) * 100)}%"></span></div><small>${Math.round((a / b) * 100)}% used</small>` : ''}</div>`; }).join('')}</div><p class="pg-rule">${ic('gear')}Visible to the owner and the people they allow — never to every member.</p>` : empty('gear', 'No budget set', 'Set a budget to cap what agents and campaigns can spend on this project.', btn('Set a budget', `data-xa="budget" data-arg="${esc(name)}"`, true)),
      Activity: () => timeline(P.activity),
    }[cur])();
    return page(head({ obj: true, eyebrow: `${esc(P.mode)} · Owner ${esc(P.owner)}`, title: name, sub: P.goal, acts: `<button class="pg-ib" data-xa="projectMenu" data-arg="${esc(name)}" aria-label="More actions" data-tip="Rename, icon, archive…" aria-haspopup="menu" aria-expanded="false">${ic('more')}</button>` + btn('Assign', `data-xa="assign" data-arg="${esc(name)}"`, true, 'people') + btn('New task', `data-xa="newTask" data-arg="${esc(name)}"`, false, 'plus'),
      meta: `<span class="pg-meta-prog">${meter(meta.tasks.done, meta.tasks.total)}</span><span>${chip(HEALTH[meta.health])}</span><span class="pg-top-next">Next: <b>${esc(meta.milestone.title)}</b> · ${esc(meta.milestone.due)}</span><span class="pg-sp"></span>${stack(meta.members)}` })
      + `<div class="pg-tabs" role="tablist">${tabs.map((t) => `<button role="tab" aria-selected="${t === cur}" data-ptab="${esc(t)}">${esc(t)}${t === 'Tasks' && tasks.length ? `<em>${tasks.length}</em>` : t === 'Conversations' && P.chats.length ? `<em>${P.chats.length}</em>` : ''}</button>`).join('')}</div>`
      + `<div class="pg-body">${body}</div>` + foot(fam, 'GET /api/v2/projects/:id'));
  }

  // =====================================================================================
  // LIBRARY — one library, every product writes to it; views are filters, never copies
  // =====================================================================================
  const LIBV = { 'All files': {}, Images: { kind: ['image'] }, Video: { kind: ['video'] }, Audio: { kind: ['audio'] }, Documents: { kind: ['document', 'sheet', 'deck', 'post'] }, 'Code & artifacts': { kind: ['code', 'chat', 'design'] },
    'From chats': { chat: true }, Studio: { mode: 'studio' }, Office: { mode: 'office' }, Social: { mode: 'social' }, Dev: { mode: 'dev' }, Starred: { starred: true }, 'Shared with me': { shared: true }, Trash: { trash: true } };
  const KINDCHIPS = [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['docs', 'Documents'], ['design', 'Design'], ['code', 'Code'], ['chat', 'Chats']];
  const kindOk = (f, k) => k === 'all' || (k === 'docs' ? ['document', 'sheet', 'deck', 'post'].includes(f.kind) : f.kind === k);
  const thumb = (f) => f.kind === 'image' || f.kind === 'video' || f.kind === 'design' || f.kind === 'audio' || f.kind === 'document' || f.kind === 'sheet' || f.kind === 'deck' || f.kind === 'code' || f.kind === 'post' ? `<span class="pg-thumb">${X().mini(f.source.product === 'image' ? 'image' : f.source.product)}${f.duration ? `<em>${esc(f.duration)}</em>` : ''}</span>` : `<span class="pg-thumb pg-thumb--ic">${ic(KIND[f.kind][1])}</span>`;
  const fileCard = (f, sel) => `<div class="pg-card pg-card--file" tabindex="0" data-pg-file="${esc(f.id)}"${sel ? ' aria-selected="true"' : ''}>${thumb(f)}<b title="${esc(f.name)}">${esc(f.name)}</b><small>${prodIcon(f.source.product, 12)}${esc(pname(f.source.product))} · ${f.trashedAt ? 'deleted ' + ago(f.trashedAt) + ' ago' : ago(f.updatedAt)}</small>${f.starred ? `<span class="pg-star" role="img" aria-label="Starred">${ic('star')}</span>` : ''}</div>`;
  function library(view) {
    const key = 'library', u = ui(key, { view: 'grid' }), V = LIBV[view] || {}, items = window.XENO_PG_LIBRARY.items.filter((f) => !window.XENO_VIS || window.XENO_VIS.file(f));
    const kind = u.seg.kind || 'all';
    let rows = items.filter((f) => (V.trash ? !!f.trashedAt : !f.trashedAt) && (!V.kind || V.kind.includes(f.kind)) && (!V.mode || f.source.mode === V.mode) && (!V.chat || f.source.chat) && (!V.starred || f.starred) && (!V.shared || f.sharedBy) && kindOk(f, V.kind ? 'all' : kind) && matchQ(u.q, f.name, pname(f.source.product), f.project || '', f.source.chat || ''));
    rows.sort(u.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : u.sort === 'size' ? (a, b) => b.bytes - a.bytes : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const live = items.filter((f) => !f.trashedAt), total = live.reduce((n, f) => n + f.bytes, 0), prods = new Set(live.map((f) => f.source.product)).size;
    const sel = rows.find((f) => f.id === u.sel) || null;
    const firstUse = () => box('upload', V.trash ? 'Trash is empty' : 'Your library is empty', V.trash ? 'Deleted files stay here for 30 days, then they are gone for good.' : 'Everything you make in any XENO product lands here automatically. You can also drop files in.', V.trash ? '' : btn('Upload files', 'data-pg-upload', false, 'upload'));
    const list = gate(key, u.view === 'grid' ? 'grid' : 'rows', firstUse) ?? (!rows.length ? (u.q ? filtered(key, u.q, 'files') : kind !== 'all' ? box('file', `No ${KINDCHIPS.find(([k]) => k === kind)[1].toLowerCase()} in ${view || 'All files'}`, 'Pick another type, or show all types.', btn('Show all types', 'data-pg-seg="kind" data-v="all"', true)) : firstUse()) :
      u.view === 'grid' ? `<div class="pg-grid pg-grid--files">${rows.map((f) => fileCard(f, isPicked(f.id))).join('')}</div>` :
      table(['Name', 'Made in', 'Project', 'Size', V.trash ? 'Deleted' : 'Updated'], rows.map((f) => tr(`data-pg-file="${esc(f.id)}"`, [`<span class="pg-ico">${ic(KIND[f.kind][1])}</span><b class="pg-name">${esc(f.name)}</b>${f.starred ? `<span class="pg-star in">${ic('star')}</span>` : ''}`, `${prodIcon(f.source.product, 14)} ${esc(pname(f.source.product))}`, f.project ? esc(f.project) : '<small>—</small>', `<small>${bytes(f.bytes)}</small>`, `<small>${ago(f.trashedAt || f.updatedAt)}</small>`], isPicked(f.id))), 'pg-table--files'));
    const info = store.get('pgLibInfo', false), many = picks(), detail = info ? (many.length > 1 ? multiDetail(many.map(libItem), V.trash) : sel ? fileDetail(sel, V.trash) : emptyDetail(live, total)) : '';
    return page(head({ eyebrow: `Library${view && view !== 'All files' ? ' · ' + esc(view) : ''}`, title: view && view !== 'All files' ? view : 'Library', sub: V.trash ? 'Deleted files are kept for 30 days.' : 'Everything you made or uploaded — every mode, every product, one place.',
      acts: V.trash ? (rows.length ? btn('Empty trash', 'data-pg-empty-trash', true, 'trash') : '') : btn('Upload', 'data-pg-upload', false, 'upload'),
      meta: V.trash ? '' : `<span><b>${live.length.toLocaleString('en')}</b> files</span><span><b>${bytes(total)}</b> stored</span><span>from <b>${prods}</b> products</span>` })
      + bar(search(key, `Search ${view && view !== 'All files' ? view.toLowerCase() : 'your library'}`, u.q), V.kind || V.trash ? '' : seg('kind', 'Type', KINDCHIPS, kind), '<span class="pg-sp"></span>', sortSel(key, [['recent', 'Most recent'], ['name', 'Name'], ['size', 'Size']], u.sort), viewTog(key, u.view), `<button class="pg-ib" data-pg-info aria-pressed="${info}" aria-label="Details" data-tip="Details  I">${ic('sliders')}</button>`)
      + `<div class="pg-split${info ? ' open' : ''}"><div class="pg-body" data-pg-results>${list}</div>${detail}</div><div class="pg-drop" aria-hidden="true"><span>${ic('upload')}Drop to add to your Library</span></div>` + foot(key, 'GET /api/v2/library/items', 'file'), 'pg--lib');
  }
  const emptyDetail = (live, total) => `<aside class="pg-detail pg-detail--none"><div class="pg-detail-top"><span class="pg-tag">Details</span><button class="pg-ib" data-pg-info aria-label="Close details">${ic('x')}</button></div><span class="pg-state-ic">${ic('file')}</span><b>Select a file</b><p class="pg-dim">Its size, where it was made, the chat or project it belongs to, and what you can do with it show up here.</p><dl class="pg-props"><dt>Files</dt><dd>${live.length}</dd><dt>Stored</dt><dd>${bytes(total)}</dd></dl></aside>`;
  function fileDetail(f, inTrash) {
    const k = KIND[f.kind];
    const props = [['Type', k[0]], ['Size', bytes(f.bytes)], f.media && ['Dimensions', `${f.media.width} × ${f.media.height}`], f.duration && ['Length', f.duration], ['Made in', `${esc(pname(f.source.product))} · ${esc(modeName(f.source.mode))}`], f.source.chat && ['From chat', `<a data-pg-chat="${esc(f.source.chat)}">${esc(f.source.chat)}</a>`], f.project && ['Project', `<a data-pg-go-project="${esc(f.project)}">${esc(f.project)}</a>`], f.sharedBy && ['Shared by', esc(f.sharedBy)], ['Created', ago(f.createdAt) + ' ago'], ['Updated', ago(f.updatedAt) + ' ago']].filter(Boolean);
    return `<aside class="pg-detail" aria-label="${esc(f.name)}"><div class="pg-detail-top"><span class="pg-tag">${esc(k[0])}</span><button class="pg-ib" data-pg-info aria-label="Close details">${ic('x')}</button></div>
      <div class="pg-detail-pv">${X().mini(f.source.product === 'image' ? 'image' : f.source.product)}</div><b class="pg-detail-name">${esc(f.name)}</b>
      <div class="pg-detail-acts">${inTrash ? btn('Restore', `data-pg-restore="${f.id}"`, false, 'reset') + btn('Delete forever', `data-pg-purge="${f.id}"`, true, 'trash') : (PR[f.source.product] ? btn('Open in ' + pname(f.source.product), `data-pg-open-file="${f.id}"`, false, 'open') : '') + `<button class="pg-ib" data-pg-star="${f.id}" aria-pressed="${f.starred}" aria-label="${f.starred ? 'Unstar' : 'Star'}" data-tip="${f.starred ? 'Unstar' : 'Star'}">${ic('star')}</button><button class="pg-ib" data-pg-download="${f.id}" aria-label="Download" data-tip="Download">${ic('download')}</button><button class="pg-ib" data-pg-copylink="${f.id}" aria-label="Copy link" data-tip="Copy link">${ic('share')}</button><button class="pg-ib" data-pg-trash="${f.id}" aria-label="Move to trash" data-tip="Move to trash">${ic('trash')}</button>`}</div>
      <dl class="pg-props">${props.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></aside>`;
  }

  // =====================================================================================
  // AREA (zone) page — the section's products, then the work living in them
  // =====================================================================================
  function areaPage() {
    const x = X(), z = x.zoneNow(), mk = z.of || x.zoneKey(), zid = z.of ? z.id.slice(z.of.length + 1) : z.id, key = 'area:' + mk + '.' + zid, u = ui(key);
    const prods = (z.products || []).filter((id) => PR[id]), live = prods.filter((id) => PR[id].status !== 'soon');
    const A = window.XENO_PG_AREAS[mk + '.' + zid];
    const ctxLine = z.of ? `${esc(modeName(z.of))} · seen from Overview` : esc(modeName(mk));
    const card = (id) => { const p = PR[id], soon = p.status === 'soon'; return `<button class="pg-prod${soon ? ' soon' : ''}" data-product="${id}">${prodIcon(id, 26)}<span><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small></span><span class="pg-tag">${soon ? 'Coming soon' : p.kind === 'desktop' ? 'Desktop' : 'Web'}</span></button>`; };
    let work = '';
    if (A) {
      const f = u.seg.f || 'All', rows = A.rows.filter((r) => (f === 'All' || r[A.cols.indexOf('Status')].startsWith(f)) && matchQ(u.q, ...r.slice(0, -2)));
      const counts = Object.fromEntries(A.filters.map((x2) => [x2, x2 === 'All' ? A.rows.length : A.rows.filter((r) => r[A.cols.indexOf('Status')].startsWith(x2)).length]));
      const si = A.cols.indexOf('Status');
      const res = gate(key, 'rows', () => box(z.icon || 'layers', `No ${A.noun.toLowerCase()} yet`, `When you start something in ${listJoin(live.map(pname))}, it shows up here — live.`, live[0] ? btn('New in ' + pname(live[0]), `data-product="${live[0]}"`, false, 'plus') : '')) ?? (!rows.length ? (u.q ? filtered(key, u.q, A.noun.toLowerCase()) : box('check', `Nothing ${f.toLowerCase()}`, 'All clear here.', btn('Show all', 'data-pg-seg="f" data-v="All"', true))) :
        table(A.cols, rows.map((r) => { const min = r[r.length - 2], pid = r[r.length - 1]; return tr(`data-pg-item="${esc(r[0])}" data-pg-item-p="${pid}"`, A.cols.map((c, i) => i === 0 ? `<b class="pg-name">${esc(r[0])}</b>` : i === si ? chip(r[i]) : i === A.cols.length - 1 ? `<small>${typeof min === 'number' && /Started|Updated|Last run/.test(c) ? ago(new Date(Date.now() - min * 60000).toISOString()) : esc(r[i])}</small>` : esc(r[i]))); })));
      work = `<section class="pg-sec"><div class="pg-sec-h"><h3>${esc(A.noun)}</h3></div>${bar(search(key, 'Search ' + A.noun.toLowerCase(), u.q), seg('f', 'Status', A.filters.map((x2) => [x2, x2, counts[x2]]), f))}<div data-pg-results>${res}</div></section>`;
    } else if (z.work && live.length) {
      const res = gate(key, 'rows', () => box(z.icon || 'layers', `No ${z.work[0].toLowerCase()} yet`, `What you make in ${listJoin(live.map(pname))} shows up here.`)) ?? table([z.work[0], 'Status', 'Product'], z.work[1].map(([t, m, p]) => tr(`data-pg-item="${esc(t)}"${p ? ` data-pg-item-p="${p}"` : ''}`, [`<b class="pg-name">${esc(t)}</b>`, /Rendering|Running|Failed|Done|Waiting|Scheduled|Draft|Active/.test(m) ? chip(m) : `<small>${esc(m)}</small>`, p ? `${prodIcon(p, 14)} ${esc(pname(p))}` : '<small>—</small>'])));
      work = `<section class="pg-sec"><div class="pg-sec-h"><h3>${esc(z.work[0])}</h3></div><div data-pg-results>${res}</div></section>`;
    } else if (!live.length) {
      work = box('clock', 'Planned — not built yet', `${listJoin(prods.map(pname))} ${prods.length > 1 ? 'are' : 'is'} on the way. This area fills in when ${prods.length > 1 ? 'they launch' : 'it launches'}.`, window.XL.notifyBtn(prods, 'pg-btn ghost', `Notify me when ${prods.length > 1 ? 'they launch' : 'it launches'}`));
    }
    return page(head({ eyebrow: ctxLine, title: z.label, sub: z.blurb, acts: (z.of ? btn('Open ' + modeName(z.of) + ' mode', `data-mode="${z.of}"`, true) : '') + (live[0] ? btn('New in ' + pname(live[0]), `data-product="${live[0]}"`, false, 'plus') : '') })
      + (prods.length ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Products</h3><small>${live.length} of ${prods.length} available</small></div><div class="pg-prods">${prods.map(card).join('')}</div></section>` : '')
      + work + foot(key, 'GET /api/v2/modes/:mode/areas/:area/items', 'item'));
  }
  const listJoin = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // =====================================================================================
  // ITEM page — one object (a run, a file, a post…) with its own address
  // =====================================================================================
  function itemPage(name) {
    const x = X(), s = S(), fam = 'item';
    const file = window.XENO_PG_LIBRARY.items.find((f) => f.name === name);
    let run = null; Object.entries(window.XENO_PG_AREAS).forEach(([k, A]) => { const r = A.rows.find((rr) => rr[0] === name); if (r) run = { k, A, r }; });
    const pid = s.view === 'product' ? s.product : run ? run.r[run.r.length - 1] : file ? file.source.product : null;
    const owner = pid ? pname(pid) : s.view === 'zone' ? x.zoneNow().label : 'XENO';
    const status = run ? run.r[run.A.cols.indexOf('Status')] : null;
    const isAgentRun = run && /dev\.(agents|automate)/.test(run.k);
    const props = run ? run.A.cols.slice(1).map((c, i) => [c, i + 1 === run.A.cols.indexOf('Status') ? chip(run.r[i + 1]) : esc(c === 'Started' || c === 'Last run' || c === 'Updated' ? ago(new Date(Date.now() - run.r[run.r.length - 2] * 60000).toISOString()) + ' ago' : run.r[i + 1])]) :
      file ? [['Type', KIND[file.kind][0]], ['Size', bytes(file.bytes)], ['Made in', esc(pname(file.source.product))], file.project && ['Project', `<a data-pg-go-project="${esc(file.project)}">${esc(file.project)}</a>`], ['Updated', ago(file.updatedAt) + ' ago']].filter(Boolean) : [['Where', esc(owner)], ['Context', esc(x.ctxName())]];
    const steps = isAgentRun ? (status === 'Failed' ? [['Planned the change', 'done'], ['Edited 6 files', 'done'], ['Ran the test suite', 'failed', '3 tests failed — electron ABI mismatch']] : status === 'Waiting on you' ? [['Planned the change', 'done'], ['Edited 2 files', 'done'], ['Asked: “Can I delete the retry wrapper?”', 'need']] : status === 'Running' ? [['Planned the change', 'done'], ['Edited 4 files', 'done'], ['Running tests', 'live']] : [['Planned', 'done'], ['Made the change', 'done'], ['Tests passed', 'done'], ['Finished', 'done']]) : null;
    const body = gate(fam, 'rows', () => box('file', 'This item is gone', 'It may have been deleted or moved. Check the Trash in your Library.', btn('Open Library', 'data-go="library"', true))) ?? `<div class="pg-cols pg-cols--item"><div>
        ${isAgentRun ? runLog(run, status) : `<div class="pg-item-pv">${x.mini(pid || 'docs')}</div>`}
        ${steps ? `<section class="pg-sec">${status === 'Waiting on you' ? `<div class="pg-answer">${btn('Allow', `data-xa="allowRun" data-arg="${esc(name)}"`)}${btn('Answer in the session', `data-product="${pid}"`, true)}</div>` : status === 'Failed' ? `<div class="pg-answer">${btn('Retry', `data-xa="retryRun" data-arg="${esc(name)}"`)}${btn('Open the log', 'data-xa="showLog"', true)}</div>` : ''}</section>` : ''}
      </div><aside><section class="pg-sec pg-card-s"><h3>Details</h3><dl class="pg-props">${props.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${b}</dd>`).join('')}</dl></section></aside></div>`;
    return page(head({ obj: true, eyebrow: `${esc(owner)} · ${esc(x.ctxName())}`, title: name, sub: run ? `${run.A.noun.replace(/s$/, '')} in ${esc(owner)}` : file ? `${KIND[file.kind][0]} from ${esc(pname(file.source.product))}` : '',
      acts: btn('Back', 'data-back', true, 'back') + (pid && PR[pid] && pid !== s.product ? btn('Open in ' + pname(pid), `data-product="${pid}"`, false, 'open') : pid && PR[pid] && PR[pid].kind === 'desktop' ? btn('Open in ' + pname(pid), `data-xl-hub="${pid}"`, false, 'open') : ''),
      meta: status ? `<span>${chip(status)}</span>` : '' }) + `<div class="pg-body">${body}</div>` + foot(fam, run ? 'GET /api/v2/runs/:id' : 'GET /api/v2/library/items/:id'));
  }

  // a run is shown as what it did — the session transcript and the files it changed, never a picture
  function runLog(run, status) {
    const r = run.r, ws = r[1], agent = run.A.cols.includes('Agent') ? r[2] : 'Workflow';
    const T = {
      'Waiting on you': [['›', 'Plan: make the flaky sync test deterministic'], ['', 'read  src/sync/retry.ts'], ['', 'edit  src/sync/retry.ts', '+12 −30'], ['', 'edit  tests/sync.test.ts', '+8 −2'], ['', 'run   npm test -- sync', '41 passed'], ['?', 'Can I delete the retry wrapper? Only this test uses it.']],
      Running: [['›', 'Plan: move token refresh behind the auth gate'], ['', 'read  src/server/auth/gate.js'], ['', 'edit  src/server/auth/gate.js', '+44 −12'], ['', 'edit  src/server/auth/refresh.js', '+19 −40'], ['', 'run   npm test -- auth', 'running…']],
      Failed: [['›', 'Plan: upgrade Electron to 39'], ['', 'edit  package.json', '+1 −1'], ['', 'run   npm install', 'done'], ['', 'run   npm test', '3 failed'], ['!', 'node-pty was built for a different Node ABI (127 ≠ 133)']],
      Done: [['›', 'Plan: ' + r[0].toLowerCase()], ['', 'edit  ' + (r[0] === 'Release notes' ? 'CHANGELOG.md' : 'src/parser.test.ts'), '+86 −0'], ['', 'run   npm test', 'all passed'], ['✓', 'Finished — ready for review']],
    }[status] || [['›', r[0]], ['', 'run   ' + r[1], r[2]]];
    const files = T.filter((l) => /^edit/.test(l[1]));
    return `<section class="pg-log"><div class="pg-log-h">${ic('terminal')}<b>Session</b><small>${esc(ws)} · ${esc(agent)}</small></div><ol>${T.map(([m, t, x2]) => `<li class="${m === '?' ? 'ask' : m === '!' ? 'err' : m === '›' ? 'plan' : m === '✓' ? 'ok' : ''}"><span class="pg-log-m">${esc(m)}</span><code>${esc(t)}</code>${x2 ? `<small>${esc(x2)}</small>` : ''}</li>`).join('')}</ol>
      ${files.length ? `<div class="pg-log-files"><b>${plural(files.length, 'file', 'files')} changed</b>${files.map((l) => `<span><code>${esc(l[1].replace(/^edit\s+/, ''))}</code><small>${esc(l[2])}</small></span>`).join('')}</div>` : ''}</section>`;
  }

  // =====================================================================================
  // PRODUCT launch page — the shell's handoff into the product's own interface
  // =====================================================================================
  function productPage() {
    const s = S(), id = s.product, p = PR[id], soon = p.status === 'soon', fam = 'product:' + id;
    const files = window.XENO_PG_LIBRARY.items.filter((f) => f.source.product === id && !f.trashedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const projs = PROJ().filter((pr) => files.some((f) => f.project === pr.name));
    const home = window.XENO_MODES.find((m) => m.sections.some(([, ids]) => ids.includes(id)));
    const acts = soon ? window.XL.notifyBtn(id, 'pg-btn') : p.kind === 'desktop' ? btn('Download', `data-xl-download="${id}"`, true, 'download') + btn('Open in Hub', `data-xl-hub="${id}"`, false, 'open') : btn('Start', `data-xl-new="${id}"`, false, 'plus');
    const recent = gate(fam, 'grid', () => box('file', `Nothing made in ${p.name} yet`, `Your ${p.name} work appears here and in your Library.`)) ?? (files.length ? `<div class="pg-grid pg-grid--files">${files.slice(0, 8).map((f) => fileCard(f, false)).join('')}</div>` : box('file', `Nothing made in ${p.name} yet`, `Your ${p.name} work appears here and in your Library the moment you save it.`, '', 'sm'));
    return page(`<header class="pg-hero">${prodIcon(id, 56)}<div class="pg-ttl"><small>${esc(home ? home.name || modeName(home.id) : '')}${home ? ' · ' : ''}${soon ? 'Coming soon' : p.kind === 'desktop' ? 'Desktop app' : 'Web app'}</small><h1>XENO ${esc(p.name)}</h1><p>${esc(p.blurb)}</p></div><div class="pg-acts">${acts}</div></header>`
      + (soon ? box('clock', `${p.name} is being built`, 'It joins your workspace the day it launches — same account, same Library, same projects. Nothing to install now.', '', 'sm') :
        `<section class="pg-sec"><div class="pg-sec-h"><h3>Recent in ${esc(p.name)}</h3>${files.length ? `<button class="pg-link" data-pg-lib-src="${id}">See all in Library ${ic('right')}</button>` : ''}</div>${recent}</section>`
        + (projs.length ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Projects using ${esc(p.name)}</h3></div><div class="pg-grid pg-grid--proj">${projs.map(projCard).join('')}</div></section>` : ''))
      + `<p class="pg-rule">${ic(p.kind === 'desktop' ? 'hub' : 'globe')}${p.kind === 'desktop' ? `${esc(p.name)} runs as its own app on your computer; it opens from here with your account already signed in.` : `${esc(p.name)} opens right here — its own interface replaces this page.`}</p>` + foot(fam, 'GET /api/v2/library/items?product'));
  }

  // =====================================================================================
  // WORKSPACE — administered, not visited (WORKFORCE §11.2)
  // =====================================================================================
  const WSV = ['Members', 'Agents', 'Teams', 'Knowledge', 'Automations', 'Activity', 'Settings'];
  function workspace(view) {
    const W = window.XENO_PG_WORKSPACE, key = 'workspace', u = ui('ws:' + (view || 'home'));
    const div = W.divisions.find((d) => d.name === view);
    const memberRow = (m) => tr(`data-pg-ws="Members/${esc(m.name)}"`, [`${avatar(m)}<b class="pg-name">${esc(m.name)}</b>${m.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}`, `<small>${esc(m.title)}</small>`, esc(cap(m.role)), esc(m.divisions.join(', ')), m.status === 'departed' ? chip('Departed') : m.status === 'settling' ? chip('Settling') : m.kind === 'agent' ? chip(cap(m.status)) : m.status === 'invited' ? chip('Invited') : `<small>${m.lastActiveAt ? ago(m.lastActiveAt) : '—'}</small>`]);
    const kindF = u.seg.kind || 'all';
    const mems = W.members.filter((m) => (view === 'Agents' || view === 'All my agents' ? m.kind === 'agent' : kindF === 'all' || (kindF === 'people' ? m.kind === 'human' : m.kind === 'agent')) && (!div || m.divisions.includes(div.name)) && matchQ(u.q, m.name, m.title));
    const fam = view === 'Settings' ? 'ws-settings' : key;
    const V = !view ? 'home' : WSV.includes(view) ? view : div ? 'division' : view === 'All my agents' ? 'Agents' : view === 'All my teams' ? 'Teams' : view === 'Switch workspace' ? 'switch' : 'home';
    const inner = gate(fam, 'rows', () => box('people', 'Just you so far', 'Invite people and assign agents — each gets a role, and agents always have a human owner.', btn('Invite people or agents', 'data-xa="invite"', false, 'plus'))) ?? ({
      home: () => `<div class="pg-stats">${[['Members', W.members.filter((m) => m.kind === 'human').length, 'people'], ['Agents', W.members.filter((m) => m.kind === 'agent').length, 'bot'], ['Teams', W.teams.length, 'people'], ['Automations', W.automations.length, 'flow']].map(([l, n, i]) => `<button class="pg-stat" data-pg-ws="${l}">${ic(i)}<b>${n}</b><small>${l}</small></button>`).join('')}</div>
        ${W.automations.some((a) => a.lastRun === 'failed') ? `<div class="pg-alert">${ic('activity')}<span><b>Lead enrich</b> failed on its last run — the webhook timed out.</span>${btn('Open', 'data-pg-ws="Automations"', true)}</div>` : ''}
        <section class="pg-sec"><div class="pg-sec-h"><h3>Members</h3><button class="pg-link" data-pg-ws="Members">All ${W.members.length} ${ic('right')}</button></div>${table(['Name', 'Title', 'Role', 'Divisions', 'Last active'], W.members.slice(0, 6).map(memberRow), 'pg-table--mem')}</section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Divisions</h3></div><div class="pg-grid pg-grid--div">${W.divisions.map((d) => `<button class="pg-card pg-card--div" data-pg-ws="${d.name}">${X().mark ? '' : ''}<b>${esc(d.name)}</b><small>${plural(d.people, 'person', 'people')} · ${plural(d.agents, 'agent', 'agents')}</small></button>`).join('')}</div></section>`,
      Members: () => bar(search('ws:Members', 'Search members', u.q), seg('kind', 'Kind', [['all', 'Everyone', W.members.length], ['people', 'People', W.members.filter((m) => m.kind === 'human').length], ['agents', 'Agents', W.members.filter((m) => m.kind === 'agent').length]], kindF)) + `<div data-pg-results>${mems.length ? table(['Name', 'Title', 'Role', 'Divisions', 'Last active'], mems.map(memberRow), 'pg-table--mem') : filtered('ws:Members', u.q, 'members')}</div><p class="pg-rule">${ic('bot')}An agent's permissions never exceed its owner's — every agent has a human owner here.</p>`,
      Agents: () => `<div class="pg-grid pg-grid--agents">${mems.map((m) => `<div class="pg-card pg-card--agent">${avatar(m, ' lg')}<b>${esc(m.name)}</b><small>${esc(m.title)}</small>${chip(cap(m.status))}<small class="dim">Owner ${esc(m.ownedBy)} · ${esc(m.divisions.join(', '))}</small></div>`).join('')}</div>`,
      Teams: () => `<div class="pg-grid pg-grid--team">${W.teams.map((t) => `<div class="pg-card pg-card--team"><div class="pg-card-top"><b>${esc(t.name)}</b><span class="pg-tag">Lead ${esc(t.lead)}</span></div>${stack(t.members.map((n) => W.members.find((m) => m.name === n) || { name: n, kind: 'human' }))}<small>On ${t.projects.map((pn) => `<a data-pg-go-project="${esc(pn)}">${esc(pn)}</a>`).join(', ')}</small></div>`).join('')}</div>`,
      Knowledge: () => table(['Source', 'Kind', 'Who can use it', 'Indexed'], W.knowledge.map((k) => tr(`data-pg-ws="Knowledge/${esc(k.name)}"`, [`<span class="pg-ico">${ic(k.kind === 'Repository' ? 'code' : 'doc')}</span><b class="pg-name">${esc(k.name)}</b>`, esc(k.kind), esc(k.access), `<small>${ago(k.indexedAt)}</small>`]))) + `<p class="pg-rule">${ic('lib')}Agents read knowledge with the asker's permissions — a source limited to Platform stays limited for agents too.</p>`,
      Automations: () => table(['Automation', 'Trigger', 'Last run', 'Owner'], W.automations.map((a) => tr(`data-pg-item="${esc(a.name)}" data-pg-item-p="workflow"`, [`<b class="pg-name">${esc(a.name)}</b>`, esc(a.trigger), chip(a.lastRun === 'ok' ? 'Done' : 'Failed'), esc(a.owner)]))),
      Activity: () => `<ol class="pg-tl">${W.activity.map((a) => `<li class="${a.kind}"><i></i><span>${esc(a.text)}</span><small>${ago(a.at)}</small></li>`).join('')}</ol>`,
      Settings: () => `<div class="pg-form">${[['Workspace name', `<input value="${esc(W.name)}" aria-label="Workspace name">`], ['Plan', `<span>${esc(W.plan)}</span>${btn('Change plan', 'data-xa="plans"', true)}`], ['Default mode for new members', `<span>Studio</span>${btn('Change', 'data-xa="settings" data-arg="general"', true)}`], ['Guests', '<span>Guests see only the projects they are added to</span>'], ['Agent spending cap', '<span class="pg-dim">Not set — agents draw from the shared wallet</span>' + btn('Set a cap', 'data-xa="setCap"', true)]].map(([l, c]) => `<div class="pg-field"><label>${l}</label><div>${c}</div></div>`).join('')}<div class="pg-field danger"><label>Leave or delete</label><div>${btn('Leave workspace', 'data-xa="leaveWorkspace"', true)}</div></div></div>`,
      division: () => table(['Name', 'Title', 'Role', 'Divisions', 'Last active'], mems.map(memberRow), 'pg-table--mem'),
      switch: () => `<div class="pg-grid pg-grid--div">${window.XA.workspaces().map((w) => { const on = w.id === window.XA.currentWorkspace().id; return `<button class="pg-card pg-card--div"${on ? ' aria-current="true"' : ''} data-xa="switchWorkspace" data-arg="${esc(w.id)}"><b>${esc(w.name)}</b><small>${esc(w.sub)}${on ? ' · current' : ''}</small></button>`; }).join('')}<button class="pg-card pg-card--div pg-card--new" data-xa="newCompany"><b>Create a company</b><small>Hire people and agents, share a wallet</small></button></div>`,
    }[V])();
    const titles = { home: W.name, division: view + ' division', switch: 'Your workspaces' };
    return page(head({ eyebrow: `Workspace${view ? ` · <a data-pg-ws="">${esc(W.name)}</a>` : ''}`, title: titles[V] || view, sub: V === 'home' ? `${W.plan} plan · you are the owner` : V === 'division' ? `${plural(div.people, 'person', 'people')} and ${plural(div.agents, 'agent', 'agents')} work in ${div.name}` : '', acts: V === 'Settings' ? '' : btn('Invite people or agents', 'data-xa="invite"', false, 'plus') })
      + (V !== 'home' && V !== 'switch' && V !== 'division' ? `<div class="pg-tabs" role="tablist">${WSV.map((t) => `<button role="tab" aria-selected="${t === V}" data-pg-ws="${t}">${t}</button>`).join('')}</div>` : '')
      + `<div class="pg-body">${inner}</div>` + foot(fam, V === 'Settings' ? 'GET /api/v2/workspaces/:id/settings' : 'GET /api/v2/workspaces/:id/members'));
  }

  // =====================================================================================
  // ANIMA · COMMUNITY · MARKETPLACE
  // =====================================================================================
  function anima(view) {
    const A = window.XENO_PG_ANIMA, fam = 'anima', mind = A.minds.find((m) => view && view.startsWith(m.name));
    const body = gate(fam, 'grid', () => box('anima', 'Meet Anima', 'Anima is your own agent. Give it a Mind — what it is for — and it earns a Soul: memory and skills it learns from working with you.', btn('Create your first Mind', 'data-xa="newMind"', false, 'plus'))) ?? (mind ? `<div class="pg-cols"><div><section class="pg-sec"><h3>Now</h3><p>${chip(cap(mind.status))} ${esc(mind.now)}</p></section><section class="pg-sec"><h3>Skills it learned</h3>${table(['Skill', 'Learned'], A.skills.filter((s) => s.learnedBy === mind.name).map((s) => tr('', [`<b class="pg-name">${esc(s.name)}</b>`, `<small>${ago(s.at)}</small>`])))}</section></div><aside><section class="pg-sec pg-card-s"><h3>Soul</h3><p><b>${mind.soul.episodes.toLocaleString('en')}</b><small>memories</small></p><p><b>${mind.soul.skills}</b><small>skills</small></p><p class="pg-dim">The Soul stays yours — it never transfers, even when a Mind is shared.</p></section></aside></div>` :
      `<section class="pg-sec"><div class="pg-sec-h"><h3>Minds</h3><small>${A.minds.length}</small></div><div class="pg-grid pg-grid--agents">${A.minds.map((m) => `<button class="pg-card pg-card--agent" data-pg-gitem="${esc(m.name + ' — ' + m.role.toLowerCase())}">${avatar({ name: m.name, kind: 'agent' }, ' lg')}<b>${esc(m.name)}</b><small>${esc(m.role)}</small>${chip(cap(m.status))}<small class="dim">${esc(m.now)}</small></button>`).join('')}<button class="pg-card pg-card--new" data-xa="newMind">${ic('plus')}<b>New Mind</b><small>Describe what it is for</small></button></div></section>
       <section class="pg-sec"><div class="pg-sec-h"><h3>Recently learned</h3></div>${table(['Skill', 'Mind', 'Learned'], A.skills.map((s) => tr('', [`<b class="pg-name">${esc(s.name)}</b>`, esc(s.learnedBy), `<small>${ago(s.at)}</small>`])))}</section>`);
    return page(head({ obj: !!mind, eyebrow: mind ? 'Mind' : 'Anima · your agent', title: mind ? mind.name : 'Anima', sub: mind ? mind.role : 'A Mind is given. A Soul is earned.', acts: btn(mind ? `Chat with ${mind.name}` : 'New chat with Anima', `data-xa="animaChat" data-arg="${esc(mind ? mind.name : '')}"`, false, 'chat') }) + `<div class="pg-body">${body}</div>` + foot(fam, 'GET /api/v2/anima/minds'));
  }
  function community(view) {
    const F = window.XENO_PG_FORUM, key = 'community', u = ui(key);
    const spaces = ['Questions', 'Discussions', 'Showcase', 'Feedback', 'Announcements'];
    const sp = spaces.includes(view) ? view : u.seg.space || 'all';
    if (view === 'Report a problem') setTimeout(() => window.XA.report(), 50);
    const rows = F.filter((t) => (sp === 'all' || t.space === sp) && (view !== 'My threads' || t.author.name === youName()) && matchQ(u.q, t.title));
    const res = gate(key, 'rows', () => box('community', 'No threads yet', 'Ask a question, share what you made, or tell us what to build next. People and agents answer here, in public.', btn('New thread', 'data-xa="newThread"', false, 'plus'))) ?? (!rows.length ? filtered(key, u.q || sp, 'threads') :
      table(['Thread', 'Space', 'Replies', 'State', 'Activity'], rows.map((t) => tr(`data-pg-gitem="${esc(t.id)}"`, [`<b class="pg-name">${esc(t.title)}</b><small>${avatar(t.author)} ${esc(t.author.name)}${t.author.kind === 'agent' ? ' · agent' : ''}</small>`, esc(t.space), String(t.replies), chip(cap(t.state)), `<small>${ago(t.lastActivityAt)}</small>`])), 'pg-table--forum'));
    return page(head({ eyebrow: 'Community · the XENO forum', title: spaces.includes(view) ? view : view && view !== 'For you' ? view : 'Community', sub: 'Public answers from people and agents. Sorted by what gets resolved, not what gets clicks.', acts: btn('Report a problem', 'data-xa="report"', true) + btn('New thread', 'data-xa="newThread"', false, 'plus') })
      + bar(search(key, 'Search the forum', u.q), spaces.includes(view) ? '' : seg('space', 'Space', [['all', 'All'], ...spaces.map((s) => [s, s])], sp)) + `<div class="pg-body" data-pg-results>${res}</div>` + foot(key, 'GET /api/forum/threads', 'thread'));
  }
  function market(view) {
    { const r = window.XENO_MARKET?.route(view); if (r) return r; }
    const L = window.XENO_PG_MARKET, key = 'market', u = ui(key);
    const owned = view === 'Purchases' || view === 'Rentals';
    const mode = /Agents|Minds|Teams|Models/.test(view || '') ? 'agents' : (u.seg.mode || 'apps');
    const KINDS = { apps: [['all', 'All'], ['tool', 'Tools'], ['block', 'Blocks'], ['plugin', 'Plugins'], ['mcp', 'MCP'], ['blueprint', 'Blueprints']], agents: [['all', 'All'], ['mind', 'Minds'], ['team', 'Teams'], ['model', 'Models']] };
    const kmap = { Tools: 'tool', Blocks: 'block', 'Plugins & MCP': 'plugin', Blueprints: 'blueprint', Minds: 'mind', Teams: 'team', Models: 'model' };
    const k = kmap[view] || u.seg.kind || 'all';
    const TRUST = { official: 'Official', verified: 'Verified', community: 'Community · sandboxed' };
    if (view === 'Seller console') return page(head({ eyebrow: '<a data-go="market">Marketplace</a> · Seller console', title: 'Seller console', sub: 'Sell apps, agents and blueprints to every XENO workspace.' }) + box('market', 'You are not selling anything yet', 'List an app or rent out a Mind you trained. Earnings land in your wallet; payouts start when your company is verified.', btn('Create a listing', 'data-xa="newListing"', false, 'plus')) + foot(key, 'GET /api/marketplace/seller'));
    const rows = L.filter((x2) => (owned ? x2.owned && (view === 'Rentals') === /Rent/.test(x2.price) : x2.mode === mode) && (k === 'all' || x2.kind === k || (k === 'plugin' && x2.kind === 'mcp')) && matchQ(u.q, x2.name, x2.blurb, x2.seller));
    const res = gate(key, 'grid', () => box('market', 'The store is empty', 'Nothing is listed yet.')) ?? (!rows.length ? (owned ? box('market', `No ${view.toLowerCase()} yet`, 'What you buy or rent shows up here, with renewals and receipts.', btn('Browse the store', 'data-pg-ws-market', true)) : filtered(key, u.q || k, 'listings')) :
      `<div class="pg-grid pg-grid--market">${rows.map((x2) => `<div class="pg-card pg-card--lst" tabindex="0"><div class="pg-card-top"><span class="pg-thumb pg-thumb--ic sq">${ic(x2.mode === 'agents' ? (x2.kind === 'model' ? 'box' : 'bot') : x2.kind === 'blueprint' ? 'layers' : 'grid')}</span><span class="pg-tag">${esc(cap(x2.kind === 'mcp' ? 'MCP' : x2.kind))}</span></div><b><a data-mk="open" data-arg="${x2.id}">${esc(x2.name)}</a></b><small class="pg-clamp">${esc(x2.blurb)}</small><div class="pg-card-foot"><span>${esc(x2.seller)} · ${esc(TRUST[x2.trust])}</span><b class="pg-price">${esc(x2.price)}</b></div>${btn(x2.owned ? 'Open' : /Rent/.test(x2.price) ? 'Rent' : x2.price === 'Free' ? 'Get' : 'Buy', `data-xa="${x2.owned ? 'openListing' : 'getListing'}" data-arg="${x2.id}"`, x2.owned)}</div>`).join('')}</div>`);
    return page(head({ eyebrow: 'Marketplace', title: owned ? view : 'Marketplace', sub: owned ? 'Everything you bought or rent.' : 'Apps, agents, tools, blocks and blueprints — official, verified and sandboxed community listings.' })
      + bar(search(key, 'Search the store', u.q), owned ? '' : seg('mode', 'Store', [['apps', 'Apps'], ['agents', 'Agents']], mode), owned || kmap[view] ? '' : seg('kind', 'Kind', KINDS[mode], k)) + `<div class="pg-body" data-pg-results>${res}</div>` + foot(key, 'GET /api/marketplace/listings', 'listing'));
  }

  // =====================================================================================
  // router — called by the shell's mainHTML; null = the shell keeps its own page
  // =====================================================================================
  // =====================================================================================
  // MEMBER page — one person or agent in the workspace (GET /api/v2/workspaces/:id/members/:memberId)
  // =====================================================================================
  // the signed-in person: the workspace's owner record (`you` holds YOUR role, the name comes from the account)
  const youName = () => { const W = window.XENO_PG_WORKSPACE, y = W.you; return (typeof y === 'string' ? y : y?.name) || W.members.find((m) => m.kind === 'human' && m.role === (y?.role || 'owner'))?.name || 'Emilian'; };
  function memberPage(name) {
    const W = window.XENO_PG_WORKSPACE, m = W.members.find((x) => x.name === name);
    if (!m) return page(head({ eyebrow: '<a data-pg-ws="Members">Members</a>', title: name }) + box('user', 'Not a member any more', 'They may have left or been removed. Their work stays in the projects and Library it belongs to.', btn('All members', 'data-pg-ws="Members"', true)));
    const you = youName(), isYou = m.name === you, agent = m.kind === 'agent';
    const teams = W.teams.filter((t) => (t.members || []).some((x) => (x.name || x) === m.name));
    const projs = (window.XENO_PG_PROJECTS?.items || []).filter((p) => (p.members || []).some((x) => (x.name || x) === m.name) || p.owner?.name === m.name);
    const gone = m.status === 'departed' || m.status === 'settling';
    const acts = gone ? '' : (agent ? btn('Assign work', `data-xa="assignMember" data-arg="${esc(m.name)}"`, false, 'plus') : '') + (agent ? btn('Agent details', `data-pg-ws="Agents/${esc(m.name)}"`, true, 'bot') : '') + (isYou ? '' : btn('Hand off work', `data-wf="handoff" data-arg="${esc(m.name)}"`, true, 'send')) + (isYou ? '' : btn('Change role', `data-xa="changeRole" data-arg="${esc(m.name)}"`, true, 'user') + btn(agent ? 'Remove agent' : 'Remove', `data-xa="removeMember" data-arg="${esc(m.name)}"`, true, 'trash'));
    const props = [['Role', esc(cap(m.role))], ['Title', esc(m.title)], ['Divisions', esc(m.divisions.join(', ') || '—')], agent ? ['Owner', esc(m.ownedBy || you)] : ['Last active', m.lastActiveAt ? ago(m.lastActiveAt) + ' ago' : '—'], agent ? ['Status', chip(cap(m.status))] : m.status === 'invited' ? ['Status', chip('Invited')] : null].filter(Boolean);
    return page(head({ obj: true, eyebrow: `<a data-pg-ws="Members">Members</a> · ${agent ? 'Agent' : 'Person'}`, title: m.name + (isYou ? ' (you)' : ''), sub: m.title, acts })
      + `<div class="pg-cols pg-cols--item"><div>
          ${window.XENO_WF ? '' : `<section class="pg-sec"><h3>Teams</h3>${teams.length ? `<div class="pg-chips">${teams.map((t) => `<button class="pg-chip" data-pg-ws="Teams">${esc(t.name)}</button>`).join('')}</div>` : '<p class="pg-dim">Not on a team yet.</p>'}</section>`}
          <section class="pg-sec"><h3>Projects</h3>${projs.length ? `<div class="pg-grid pg-grid--proj">${projs.map(projCard).join('')}</div>` : `<p class="pg-dim">${esc(m.name)} isn’t on a project yet.</p>`}</section>
          ${window.XENO_WF ? window.XENO_WF.memberExtra(m) : ''}
          ${agent ? `<section class="pg-sec"><h3>Permissions</h3><p class="pg-dim">${esc(m.name)} acts with ${esc(m.ownedBy || you)}’s permissions, capped by its role. It can read knowledge marked for its divisions and asks before spending, deleting or publishing.</p></section>` : ''}
        </div><aside><dl class="pg-props">${props.map(([a, b2]) => `<dt>${a}</dt><dd>${b2}</dd>`).join('')}</dl></aside></div>`
      + foot('ws:member', 'GET /api/v2/workspaces/:id/members/:memberId'));
  }
  // =====================================================================================
  // KNOWLEDGE source — what agents may read, and who decides (GET /api/v2/workspaces/:id/knowledge/:id)
  // =====================================================================================
  function knowledgePage(name) {
    const W = window.XENO_PG_WORKSPACE, k = W.knowledge.find((x) => x.name === name);
    if (!k) return page(head({ eyebrow: '<a data-pg-ws="Knowledge">Knowledge</a>', title: name }) + box('lib', 'Removed from knowledge', 'Agents no longer read it. The original is untouched.', btn('All knowledge', 'data-pg-ws="Knowledge"', true)));
    const file = window.XENO_PG_LIBRARY.items.find((f) => f.name === k.name && !f.trashedAt);
    const acts = (file ? btn('Open file', `data-pg-file="${file.id}"`, false, 'open') : '') + btn('Change access', `data-xa="knowledgeAccess" data-arg="${esc(k.name)}"`, true, 'user') + btn('Re-index', `data-xa="reindex" data-arg="${esc(k.name)}"`, true, 'refresh') + btn('Remove', `data-xa="removeKnowledge" data-arg="${esc(k.name)}"`, true, 'trash');
    return page(head({ obj: true, eyebrow: `<a data-pg-ws="Knowledge">Knowledge</a> · ${esc(k.kind)}`, title: k.name, sub: `Agents read it with the asker’s permissions`, acts })
      + `<div class="pg-cols pg-cols--item"><div><section class="pg-sec"><h3>Who can use it</h3><p>${esc(k.access)}</p><p class="pg-dim">An agent asked by someone outside “${esc(k.access)}” cannot read this source — the limit follows the person, not the agent.</p></section></div>
        <aside><dl class="pg-props"><dt>Kind</dt><dd>${esc(k.kind)}</dd><dt>Access</dt><dd>${esc(k.access)}</dd><dt>Indexed</dt><dd>${ago(k.indexedAt)} ago</dd></dl></aside></div>`
      + foot('ws:knowledge', 'GET /api/v2/workspaces/:id/knowledge/:sourceId'));
  }
  // =====================================================================================
  // THREAD — one Community thread: the post, its replies, and a working reply box (GET /api/forum/threads/:id)
  // =====================================================================================
  const SAMPLE_REPLIES = ['That matches what I see — it started after the last update.', 'Workaround for now: do it from the Library instead, the export keeps the original.', 'Thanks, that fixed it for me.', 'Same here on Windows; on macOS it works.', 'We are tracking this — a fix is in the next release.'];
  function threadPosts(t) {
    if (!t.posts) { const n = Math.min(t.replies || 0, 4); t.posts = Array.from({ length: n }, (_, i) => ({ id: `${t.id}_p${i}`, author: { name: ['Rhea', 'Kit', 'Tomas', 'XENO'][i % 4], kind: i === 1 ? 'agent' : 'human' }, body: SAMPLE_REPLIES[(i + t.title.length) % SAMPLE_REPLIES.length], at: new Date(Date.parse(t.lastActivityAt) - (n - i) * 3600e3).toISOString(), sample: true })); }
    return t.posts;
  }
  function threadPage(t) {
    const posts = threadPosts(t), mine = t.author.name === youName(), subscribed = !!(store.get('forumSubs', []) || []).includes(t.id);
    const acts = btn(subscribed ? 'Following' : 'Follow', `data-xa="followThread" data-arg="${t.id}" aria-pressed="${subscribed}"`, true, subscribed ? 'check' : 'bell') + btn('Copy link', `data-xa="copyThreadLink" data-arg="${t.id}"`, true, 'link');
    const post = (p, i) => `<article class="pg-post${p.answer ? ' answer' : ''}" id="post-${p.id}">${avatar(p.author)}<div><header><b>${esc(p.author.name)}</b>${p.author.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}<small>${ago(p.at)} ago</small>${p.answer ? chip('Answer') : ''}</header><p>${esc(p.body)}</p>
      ${mine && t.space === 'Questions' && !p.answer && i >= 0 ? `<button class="pg-link" data-xa="markAnswer" data-arg="${t.id}|${p.id}">Mark as the answer</button>` : ''}</div></article>`;
    return page(head({ obj: true, eyebrow: `<a data-go="community">Community</a> · ${esc(t.space)}`, title: t.title, sub: `${t.author.name}${t.author.kind === 'agent' ? ' (agent)' : ''} · ${cap(t.state)} · ${plural(posts.length, 'reply', 'replies')}`, acts })
      + `<div class="pg-thread">${t.body ? `<article class="pg-post op">${avatar(t.author)}<div><header><b>${esc(t.author.name)}</b><small>${ago(t.lastActivityAt)} ago</small></header><p>${esc(t.body)}</p>${t.diag ? `<pre class="pg-diag">${esc(t.diag)}</pre>` : ''}</div></article>` : ''}
        ${posts.map(post).join('') || '<p class="pg-dim">No replies yet — the first one helps most.</p>'}
        <form class="pg-reply" data-reply="${t.id}"><textarea rows="3" placeholder="Write a reply" aria-label="Reply"></textarea><div><span class="pg-dim">Replies are public and permanent.</span><button class="pg-btn" type="submit">${ic('send')}<span>Reply</span></button></div></form></div>`
      + foot('community:thread', 'GET /api/forum/threads/:id'));
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-reply]'); if (!f) return; e.preventDefault();
    const ta = f.querySelector('textarea'), body = ta.value.trim(); if (!body) { ta.focus(); return X().toast('Write something first'); }
    const t = window.XENO_PG_FORUM.find((x) => x.id === f.dataset.reply); threadPosts(t).push({ id: `${t.id}_p${Date.now()}`, author: { name: youName(), kind: 'human' }, body, at: new Date().toISOString() });
    t.replies = t.posts.length; t.lastActivityAt = new Date().toISOString(); window.XENO_DB?.save?.(); repaint(); X().toast('Reply posted');
  });
  // =====================================================================================
  // PRODUCT VIEW — a destination in a product's sidebar
  //   · collections (Recent, Drafts, Shared, Starred, Favorites, Library, Templates) are that product's files
  //   · views that ARE another page (a company's Members, Community's Feed) open that page — one source each
  //   · the rest live inside the product's own interface, and say so with the way to get there
  // =====================================================================================
  const VIEW_PAGE = { Members: ['workspace', 'Members'], 'Agent workforce': ['workspace', 'Agents'], Divisions: ['workspace', null], Wallet: ['workspace', 'Settings'], 'Seller account': ['market', 'Seller console'], Seats: ['workspace', 'Members'], Roles: ['workspace', 'Members'], Feed: ['community', null], Spaces: ['community', null], Moderation: ['community', null] };
  const VIEW_FILES = { Recent: () => true, Drafts: (f) => !f.project, 'Shared with me': (f) => !!f.sharedBy, Starred: (f) => f.starred, Favorites: (f) => f.starred, Library: () => true, Templates: (f) => /template/i.test(f.name) };
  function productView(view) {
    const s = S(), id = s.product, p = PR[id];
    if (VIEW_PAGE[view]) { const [g, it] = VIEW_PAGE[view]; setTimeout(() => X().go('global', { global: g, item: it }), 0); return page(''); }
    if (VIEW_FILES[view]) {
      const files = window.XENO_PG_LIBRARY.items.filter((f) => f.source.product === id && !f.trashedAt && VIEW_FILES[view](f)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const primary = window.XENO_PRODUCT_NAV[id]?.primary;
      return page(head({ eyebrow: `<a data-product="${id}">${esc(p.name)}</a>`, title: view, sub: `${p.name} files${view === 'Recent' ? ', newest first' : ''}`, acts: primary ? btn(primary, `data-xl-new="${id}" data-xl-noun="${esc(primary)}"`, false, 'plus') : '' })
        + (files.length ? `<div class="pg-grid pg-grid--files">${files.map((f) => fileCard(f, false)).join('')}</div>` : box('file', `Nothing in ${view.toLowerCase()}`, view === 'Shared with me' ? `Files people share with you in ${esc(p.name)} land here.` : view === 'Templates' ? 'Save a file as a template and it appears here for everyone in the workspace.' : `Your ${esc(p.name)} work appears here.`, primary ? btn(primary, `data-xl-new="${id}" data-xl-noun="${esc(primary)}"`, false, 'plus') : '', 'sm'))
        + foot('product:' + id, `GET /api/v2/library/items?product=${id}&view=${view.toLowerCase().replace(/\W+/g, '-')}`, 'file'));
    }
    const desktop = p.kind === 'desktop';
    return page(head({ eyebrow: `<a data-product="${id}">${esc(p.name)}</a>`, title: view, sub: `Part of ${p.name}’s own interface`, acts: desktop ? btn('Open in Hub', `data-xl-hub="${id}"`, false, 'hub') : '' })
      + box(desktop ? 'hub' : 'grid', `${view} lives in ${p.name}`, desktop ? `${esc(p.name)} runs as its own app — ${esc(view)} opens there, already signed in.` : `When ${esc(p.name)}’s interface is loaded into the workspace, ${esc(view)} opens right here. This build of the workspace does not include it yet.`, desktop ? btn('Open in Hub', `data-xl-hub="${id}"`, false, 'hub') : btn(`Open ${p.name}`, `data-product="${id}"`, true), 'sm')
      + foot('product:' + id, `${p.name} · ${view}`));
  }

  function render() {
    LOADING = false;
    const s = S(), it = s.item;
    if (s.view === 'global') {
      { const vr = window.XENO_VIS?.route(s.global, it); if (vr) return vr; }
      if (s.global === 'inbox') return null;
      if (s.global === 'projects') { if (!it) return projectsIndex(false); if (it === 'Archived projects') return projectsIndex(true); const [nm, tb] = it.split('/'); return projectPage(nm, tb); }
      if (s.global === 'library') { if (!it || LIBV[it]) return library(it || 'All files'); return itemPage(it); }
      if (s.global === 'workspace') { const wf = window.XENO_COMPANY?.route(it) || window.XENO_RES?.route(it) || window.XENO_WF?.route(it); if (wf) return wf; if (it && it.startsWith('Members/')) return memberPage(it.slice(8)); if (it && it.startsWith('Knowledge/')) return knowledgePage(it.slice(10)); return workspace(it); }
      if (s.global === 'places') return window.XENO_PLACES.route(it) || window.XENO_PLACES.route(null);
      if (s.global === 'anima') { const ar = window.XENO_ANIMA?.route(it); if (ar) return ar; }
      if (s.global === 'anima') return it && /Memory|Skills|Plan|Summarise/.test(it) ? anima(null) : anima(it);
      if (s.global === 'community') { const cr = window.XENO_COMM?.route(it); if (cr) return cr; const th = it && window.XENO_PG_FORUM.find((t) => t.title === it); return th ? threadPage(th) : community(it); }
      if (s.global === 'market') return market(it);
      if (s.global === 'settings') return window.XENO_SETTINGS.render(it);
    }
    if (s.view === 'zone') return it ? itemPage(it) : areaPage();
    if (s.view === 'product') { if (PR[s.product]?.kind === 'chat') return null; return it ? (window.XENO_PRODUCT_NAV[s.product]?.views?.includes(it) ? productView(it) : itemPage(it)) : productPage(); }
    return null;
  }
  // the page split into the main area's three containers: header actions · scrolling body · footer bar
  let sumForBar = '', hasSearchForBar = false;   // a collection page's counts, handed from the header to the status bar
  function framed() {
    const html = render(); if (html == null) return null;
    const t = document.createElement('template'); t.innerHTML = html;
    const h = t.content.querySelector('.pg-head'); let acts = '', sum = '';
    if (h) { const a = h.querySelector(':scope > .pg-acts'); acts = a ? a.innerHTML : ''; a?.remove();
      // ONE header, on every page: the path already names the page (or the object), so the body never repeats it.
      // Its facts — counts, progress, status, next milestone, people — become the bar's summary.
      const m = t.content.querySelector('.pg-meta'); if (m) { m.querySelectorAll('.pg-sp').forEach((x) => x.remove()); sum = m.innerHTML; m.remove(); }
      // a collection page's toolbar IS header content (Linear, GitHub): view tabs beside the title, search and
      // display menus beside the actions. Its counts then belong to the status bar, so the header stays one line.
      let left = '', tools = '';
      const tb = t.content.querySelector('.pg > .pg-bar'); hasSearchForBar = !!t.content.querySelector('[data-pg-q]');
      if (tb && h.classList.contains('pg-head--col')) {
        tb.querySelectorAll(':scope > .pg-seg').forEach((sg) => { left += sg.outerHTML; sg.remove(); });
        tb.querySelectorAll(':scope > .pg-sp').forEach((x) => x.remove());
        tools = tb.innerHTML; tb.remove();
        sumForBar = sum ? [...new DOMParser().parseFromString(`<div>${sum}</div>`, 'text/html').body.firstChild.children].map((x) => x.textContent.trim()).filter(Boolean).join(' · ') : ''; sum = '';
      } else sumForBar = '';
      h.remove();
      const f = t.content.querySelector('.pg-foot'); const foot = f ? statusBar(f, t.content) : ''; f?.remove();
      return { acts, sum, left, tools, body: t.innerHTML, foot }; }
    const f = t.content.querySelector('.pg-foot'); const foot = f ? statusBar(f, t.content) : ''; f?.remove();
    return { acts, sum, left: '', tools: '', body: t.innerHTML, foot };
  }
  // The status bar — real content, like a pro tool's: how fresh the data is (with refresh) · what you are
  // looking at or have selected · the keys that work on this page · and, tucked away, the prototype's preview.
  const agoS = (t) => { const s2 = Math.round((Date.now() - t) / 1000); return s2 < 10 ? 'just now' : s2 < 60 ? `${s2} s ago` : s2 < 3600 ? `${Math.round(s2 / 60)} min ago` : `${Math.round(s2 / 3600)} h ago`; };
  const STATE_L = { normal: 'Normal', empty: 'First use', loading: 'Loading', error: 'Error', denied: 'No access' };
  function statusBar(f, root) {
    const fam = f.dataset.fam, api = f.dataset.api, noun = f.dataset.noun, st = pstate(fam), loading = !!root.querySelector('.pg--loading');
    const fresh = st === 'error' ? `<span class="sb-fresh bad"><i></i>Couldn't load</span>` : st === 'denied' ? '<span class="sb-fresh"><i></i>No access</span>' : loading ? '<span class="sb-fresh live"><i></i>Loading…</span>' : `<span class="sb-fresh ok"><i></i><span data-at="${AT[fam] || Date.now()}">Updated ${agoS(AT[fam] || Date.now())}</span></span><button class="sb-ib" data-pg-refresh="${esc(fam)}" aria-label="Refresh" data-tip="Refresh">${ic('reset')}</button>`;
    const n = root.querySelectorAll('[data-pg-results] .pg-tr:not(.pg-th), [data-pg-results] .pg-card:not(.pg-card--new), .pg-board .pg-task').length;
    const sel = fam === 'library' && ui('library').sel && window.XENO_PG_LIBRARY.items.find((x) => x.id === ui('library').sel), many = fam === 'library' ? picks() : [];
    const info = loading || st !== 'normal' ? '' : many.length > 1 ? selSummary(many) : sel ? `1 selected · ${esc(sel.name)} · ${bytes(sel.bytes)}` : [n && noun ? `${n} ${noun}${n === 1 ? '' : 's'}${ui(fam).q ? ` matching “${esc(ui(fam).q)}”` : ''}` : '', !ui(fam).q && sumForBar ? esc(sumForBar.split(' · ').filter((x) => x !== `${n} ${noun}${n === 1 ? '' : 's'}`).join(' · ')) : ''].filter(Boolean).join(' · ');
    const srch = hasSearchForBar || root.querySelector('[data-pg-q]'); hasSearchForBar = false;
    const keys = [srch && ['/', 'Search'], n && ['↑↓', 'Move'], n && ['↵', 'Open'], root.querySelector('.pg--lib') && ['I', 'Details'], srch && ['Esc', 'Clear']].filter(Boolean);
    return `<div class="sb-l">${fresh}${info ? `<span class="sb-sep"></span><span class="sb-info" data-sb-info>${info}</span>` : '<span class="sb-info" data-sb-info></span>'}</div>
      <div class="sb-r"><span class="sb-keys">${keys.map(([k, l]) => `<span><kbd>${k}</kbd>${l}</span>`).join('')}</span><button class="sb-prev" data-pg-preview="${esc(fam)}" data-api="${esc(api)}" title="Prototype only — data in the shape of ${esc(api)}" aria-haspopup="listbox" aria-expanded="false">Preview <b>${STATE_L[st]}</b>${ic('chev')}</button></div>`;
  }
  // the body reserves its scrollbar strip (scrollbar-gutter: stable); measure it once so the body's right edge
  // lines up exactly with the header's and footer's instead of sitting a scrollbar-width inside them
  function syncGutter() { const mv = document.querySelector('#main .mview'); if (mv) document.getElementById('main').style.setProperty('--sb', (mv.offsetWidth - mv.clientWidth) + 'px'); }
  new MutationObserver(() => requestAnimationFrame(syncGutter)).observe(document.documentElement, { childList: true, subtree: false });
  addEventListener('load', () => { const m = document.getElementById('main'); if (m) new MutationObserver(() => requestAnimationFrame(syncGutter)).observe(m, { childList: true }); syncGutter(); });
  addEventListener('resize', syncGutter);
  window.XENO_PAGES = { render, framed, query: (key, q) => { ui(key).q = q || ''; }, repaint: () => repaint(),
    // the page parts, shared so every page — this file's or a module's — is built from the same pieces
    h: { page, head, btn, box, table, tr, chip, avatar, foot, ago, plural, cap, esc, ic, projCard, seg, ui, threadPosts } };

  // ---------- repaint the main view in place (keeps scroll and focus) ----------
  function repaint(focusSel) {
    const mv = document.querySelector('#main .mview'); if (!mv) return;
    const pf = framed(); if (pf == null) return;
    const top = mv.scrollTop, act = document.activeElement, q = act?.dataset?.pgQ, pos = act?.selectionStart;
    mv.innerHTML = pf.body; mv.scrollTop = top; mv.querySelector('.pg')?.classList.add('pg--settled');   // a repaint is not an arrival: never replay the entrance
    const ha = document.querySelector('#main .pg-top-acts'); if (ha) ha.innerHTML = pf.acts;
    const ft = document.querySelector('#main .mfoot'); if (ft) ft.innerHTML = pf.foot;
    const sm = document.querySelector('#main .pg-top-sum'); if (sm) sm.innerHTML = pf.sum;
    const hl = document.querySelector('#main .pg-top-left'); if (hl) hl.innerHTML = pf.left;
    const ht = document.querySelector('#main .pg-top-tools'); if (ht) ht.innerHTML = pf.tools;
    if (q != null) { const n = document.querySelector(`#main [data-pg-q="${q}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
    else if (focusSel) document.querySelector('#main ' + focusSel)?.focus({ preventScroll: true });
  }
  const keyOfInput = (k) => k;
  // ---------- interactions (one delegated listener; the shell's handler ignores data-pg-*) ----------
  const libItem = (id) => window.XENO_PG_LIBRARY.items.find((f) => f.id === id);
  const curKey = () => { const s = S(); return s.view === 'global' ? (s.global === 'workspace' ? 'ws:' + (s.item || 'home') : s.global) : s.view === 'zone' ? 'area:' + (X().zoneNow().of || X().zoneKey()) + '.' + (X().zoneNow().of ? X().zoneNow().id.slice(X().zoneNow().of.length + 1) : X().zoneNow().id) : 'x'; };
  // the prototype's state preview, kept out of the way in the status bar (pages and homes share it)
  function openPreview(b) {
    if (document.querySelector('.pg-ddm')?._btn === b) return closeDd(true);
    closeDd(); const fam = b.dataset.pgPreview, home = fam === 'home', cur = pstate(fam);
    const opts = home ? [['normal', 'Normal'], ['empty', 'First day'], ['loading', 'Loading'], ['error', 'Error']] : Object.entries(STATE_L);
    const m = document.createElement('div'); m.className = 'pg-ddm up'; m.setAttribute('role', 'listbox'); m._btn = b;
    m.innerHTML = '<small class="pg-ddm-h">Preview state — prototype only</small>' + opts.map(([v, l]) => `<button role="option" aria-selected="${v === cur}" data-v="${v}">${esc(l)}${v === cur ? ic('check') : ''}</button>`).join('');
    document.body.appendChild(m); const r = b.getBoundingClientRect(); m.style.minWidth = '200px'; m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 12) + 'px'; m.style.top = ((b.closest('.mfoot') || b).getBoundingClientRect().top - m.offsetHeight - 6) + 'px';   // opens clear of the bar, upward
    b.setAttribute('aria-expanded', 'true'); (m.querySelector('[aria-selected="true"]') || m.querySelector('button')).focus();
    m.addEventListener('click', (e) => { const o = e.target.closest('[data-v]'); if (!o) return; const st = store.get('pgState', {}) || {}; st[fam] = o.dataset.v; store.set('pgState', st); loaded.add(fam); closeDd(); if (home) X().render(); else repaint(); });
    m.addEventListener('keydown', (e) => { const all = [...m.querySelectorAll('button')], i = all.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDd(true); } });
  }
  window.XENO_PAGES_PREVIEW = openPreview;
  // the status bar's "Updated ..." keeps time on its own
  setInterval(() => document.querySelectorAll('#main .mfoot [data-at]').forEach((n) => { n.textContent = 'Updated ' + agoS(+n.dataset.at); }), 10000);
  // the dropdown menu lives on <body> so no page container can clip it
  function closeDd(focusBtn) { const m = document.querySelector('.pg-ddm'); if (!m) return; const b = m._btn; m.remove(); if (b?.isConnected) { b.setAttribute('aria-expanded', 'false'); if (focusBtn) b.focus(); } }
  function openDd(b) {
    if (document.querySelector('.pg-ddm')?._btn === b) return closeDd(true);
    closeDd(); const opts = b.dataset.opts.split('|').map((o) => o.split(':')), u = ui(b.dataset.pgDd), f = b.dataset.field, cur = f === 'sort' ? u.sort : (u.seg[f] || opts[0][0]);
    const m = document.createElement('div'); m.className = 'pg-ddm'; m.setAttribute('role', 'listbox'); m._btn = b;
    m.innerHTML = opts.map(([v, l]) => `<button role="option" aria-selected="${v === cur}" data-pg-ddv="${esc(v)}">${esc(l)}${v === cur ? ic('check') : ''}</button>`).join('');
    document.body.appendChild(m); const r = b.getBoundingClientRect(); m.style.minWidth = Math.max(r.width, 180) + 'px'; const left = Math.min(r.left, innerWidth - m.offsetWidth - 12); m.style.left = left + 'px'; m.style.top = (r.bottom + 6) + 'px';
    b.setAttribute('aria-expanded', 'true'); (m.querySelector('[aria-selected="true"]') || m.firstElementChild).focus();
    m.addEventListener('click', (e) => { const o = e.target.closest('[data-pg-ddv]'); if (!o) return; if (f === 'sort') u.sort = o.dataset.pgDdv; else u.seg[f] = o.dataset.pgDdv; u.sel = null; closeDd(); repaint(`[data-pg-dd="${b.dataset.pgDd}"][data-field="${f}"]`); });
    m.addEventListener('keydown', (e) => { const all = [...m.children], i = all.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDd(true); } if (e.key === 'Tab') closeDd(); });
  }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.pg-ddm, [data-pg-dd]')) closeDd(); }, true);
  addEventListener('resize', () => closeDd()); document.addEventListener('scroll', () => closeDd(), true);
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t.closest('#main .pg, #main .pg-top, #main .mfoot')) return;
    const b = t.closest('[data-pg-seg],[data-pg-view],[data-pg-clear],[data-pg-dd],[data-pg-retry],[data-pg-go-project],[data-pg-file],[data-pg-unsel],[data-pg-star],[data-pg-trash],[data-pg-restore],[data-pg-purge],[data-pg-open-file],[data-pg-download],[data-pg-copylink],[data-pg-chat],[data-pg-item],[data-pg-ws],[data-pg-upload],[data-pg-info],[data-pg-refresh],[data-pg-preview],[data-pg-empty-trash],[data-pg-lib-src],[data-pg-gitem],[data-pg-ws-market],a[data-go]');
    if (!b) return;
    const x = X(), s = S(), d = b.dataset;
    if (b.matches('a[data-go]')) { e.preventDefault(); return x.go('global', { global: d.go }); }
    if (d.pgSeg) { if (d.pgSeg.startsWith('state:')) { const m = store.get('pgState', {}) || {}; m[d.pgSeg.slice(6)] = d.v; store.set('pgState', m); loaded.add(d.pgSeg.slice(6)); return d.pgSeg === 'state:home' ? X().render() : repaint(); } const u = ui(curKey()); u.seg[d.pgSeg] = d.v; u.sel = null; return repaint(); }
    if (d.pgView) { const u = ui(d.pgView); u.view = d.v; store.set('pgView.' + d.pgView, d.v); return repaint(); }
    if (d.pgClear) { ui(d.pgClear).q = ''; return repaint(`[data-pg-q="${d.pgClear}"]`); }
    if (d.pgDd) return openDd(b);
    if (d.pgRetry) { const m = store.get('pgState', {}) || {}; m[d.pgRetry] = 'normal'; store.set('pgState', m); loaded.delete(d.pgRetry); return repaint(); }
    if (d.pgGoProject) return x.go('global', { global: 'projects', item: d.pgGoProject });
    if (d.pgFile) { const u = ui('library'); if (s.global !== 'library') { const f = libItem(d.pgFile); return x.go('global', { global: 'library', item: f.name }); } if (e.detail > 1) return; if (e.ctrlKey || e.metaKey) return togglePick(d.pgFile); if (e.shiftKey) return rangePick(d.pgFile); return selectFile(d.pgFile); }
    if (d.pgUnsel !== undefined) return selectFile(null);
    if (d.pgStar) { const f = libItem(d.pgStar); window.XENO_PG_SYNC_NAV?.(); f.starred = !f.starred; x.toast(f.starred ? 'Starred' : 'Removed from Starred'); return repaint(); }
    if (d.pgTrash) { const f = libItem(d.pgTrash); window.XENO_PG_SYNC_NAV?.(); f.trashedAt = new Date().toISOString(); ui('library').sel = null; repaint(); return undo(`Moved “${f.name}” to Trash`, () => { f.trashedAt = null; window.XENO_PG_SYNC_NAV?.(); repaint(); }); }
    if (d.pgRestore) { const f = libItem(d.pgRestore); window.XENO_PG_SYNC_NAV?.(); f.trashedAt = null; ui('library').sel = null; x.toast(`Restored “${f.name}”`); return repaint(); }
    if (d.pgPurge) { const f = libItem(d.pgPurge); if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.querySelector('span').textContent = 'Click again to delete'; return setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.querySelector('span').textContent = 'Delete forever'; } }, 3000); } window.XENO_PG_SYNC_NAV?.(); window.XENO_PG_LIBRARY.items.splice(window.XENO_PG_LIBRARY.items.indexOf(f), 1); ui('library').sel = null; x.toast(`Deleted “${f.name}” for good`); return repaint(); }
    if (d.pgEmptyTrash !== undefined) { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.querySelector('span').textContent = 'Click again — this cannot be undone'; return; } const L = window.XENO_PG_LIBRARY.items; window.XENO_PG_SYNC_NAV?.(); for (let i = L.length - 1; i >= 0; i--) if (L[i].trashedAt) L.splice(i, 1); x.toast('Trash emptied'); return repaint(); }
    if (d.pgDownload) return window.XENO_FILES.download([libItem(d.pgDownload)]);
    if (d.pgCopylink) { const f = libItem(d.pgCopylink); return window.XCM.H.copyLink(`#/${x.inOv() ? 'overview' : s.mode}/g/library/${encodeURIComponent(f.name)}`); }
    if (d.pgOpenFile) { const f = libItem(d.pgOpenFile); return x.go('product', { product: f.source.product, item: f.name }); }
    if (d.pgChat) return x.go('product', { product: 'chat' });
    if (d.pgItem) { const p = d.pgItemP; if (p && s.view !== 'zone' && !(s.view === 'product' && s.product === p)) return x.go('product', { product: p, item: d.pgItem }); return x.go(s.view, { item: d.pgItem }); }
    if (d.pgGitem) return x.go('global', { global: s.global, item: d.pgGitem });
    if (d.pgWs !== undefined) return x.go('global', { global: 'workspace', item: d.pgWs || null });
    if (d.pgWsMarket !== undefined) return x.go('global', { global: 'market', item: null });
    if (d.pgLibSrc) { const u = ui('library'); u.q = pname(d.pgLibSrc); return x.go('global', { global: 'library', item: null }); }
    if (d.pgUpload !== undefined) return pickFiles();
    if (d.pgRefresh) { loaded.delete(d.pgRefresh); return repaint(); }   // a real reload: shapes, then fresh data
    if (d.pgPreview) return openPreview(b);
    if (d.pgInfo !== undefined) { store.set('pgLibInfo', !store.get('pgLibInfo', false)); return repaint(); }
  });
  // selection updates in place — no redraw, so the grid never jumps and a double-click lands on the same card
  function selectFile(id) { const u = ui('library'); u.sel = null; u.sel = id; applyPicks(); }
  // the picked files, in the order they are on screen
  const picks = () => { const u = ui('library'); const ids = u.picked.size ? [...u.picked] : u.sel ? [u.sel] : []; const order = [...document.querySelectorAll('#main [data-pg-results] [data-pg-file]')].map((n) => n.dataset.pgFile);
    return ids.filter((id) => libItem(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b)); };
  const isPicked = (id) => { const u = ui('library'); return u.picked.size ? u.picked.has(id) : u.sel === id; };
  const selSummary = (ids) => `${ids.length} selected · ${bytes(ids.reduce((n, id) => n + libItem(id).bytes, 0))}`;
  function togglePick(id) { const u = ui('library'); if (!u.picked.size && u.sel) u.picked.add(u.sel); u.picked.has(id) ? u.picked.delete(id) : u.picked.add(id); const keep = new Set(u.picked); u.sel = id; u.picked = keep; if (!keep.size) u.sel = null; applyPicks(); }
  function rangePick(id, keepAnchor) {
    const u = ui('library'), order = [...document.querySelectorAll('#main [data-pg-results] [data-pg-file]')].map((n) => n.dataset.pgFile);
    const a = order.indexOf(u.anchor || u.sel), b = order.indexOf(id); if (a < 0) return selectFile(id);
    const [lo, hi] = a < b ? [a, b] : [b, a]; const anchor = u.anchor || u.sel; u.picked = new Set(order.slice(lo, hi + 1)); u.anchor = anchor; if (!keepAnchor) u.sel = anchor; applyPicks();
  }
  function pickAll() { const u = ui('library'), order = [...document.querySelectorAll('#main [data-pg-results] [data-pg-file]')].map((n) => n.dataset.pgFile); if (!order.length) return; u.picked = new Set(order); u.sel = u.sel || order[0]; applyPicks(); }
  function applyPicks() {
    const u = ui('library'); if (!u.picked.size || u.picked.size === 1) u.anchor = null;
    const split = document.querySelector('#main .pg--lib .pg-split'); if (!split) return;
    split.querySelectorAll('[data-pg-file]').forEach((n) => n.toggleAttribute('aria-selected', isPicked(n.dataset.pgFile)));
    const ids = picks(), si = document.querySelector('#main .mfoot [data-sb-info]');
    if (si && ids.length > 1) si.textContent = selSummary(ids); else if (si && ids.length === 1) { const f0 = libItem(ids[0]); si.textContent = `1 selected · ${f0.name} · ${bytes(f0.bytes)}`; } else { const pf = framed(), ft = document.querySelector('#main .mfoot'); if (pf && ft) ft.innerHTML = pf.foot; }   // deselecting puts the count back
    if (!store.get('pgLibInfo', false)) return;   // the details pane is opened on purpose (Drive's ⓘ) — selecting never reflows the grid
    split.querySelector('.pg-detail')?.remove();
    const live = window.XENO_PG_LIBRARY.items.filter((x) => !x.trashedAt), f = ids.length === 1 && libItem(ids[0]);
    split.insertAdjacentHTML('beforeend', ids.length > 1 ? multiDetail(ids.map(libItem), !!libItem(ids[0]).trashedAt) : f ? fileDetail(f, !!f.trashedAt) : emptyDetail(live, live.reduce((n, x) => n + x.bytes, 0)));
  }
  function multiDetail(fs, inTrash) {
    const total = fs.reduce((n, f) => n + f.bytes, 0), kinds = [...new Set(fs.map((f) => KIND[f.kind][0]))];
    return `<aside class="pg-detail" aria-label="${fs.length} files selected"><div class="pg-detail-top"><span class="pg-tag">${fs.length} selected</span><button class="pg-ib" data-pg-info aria-label="Close details">${ic('x')}</button></div>
      <div class="pg-detail-stack">${fs.slice(0, 3).map((f) => `<span>${X().mini(f.source.product === 'image' ? 'image' : f.source.product)}</span>`).join('')}</div><b class="pg-detail-name">${fs.length} files · ${bytes(total)}</b>
      <dl class="pg-props"><dt>Types</dt><dd>${esc(kinds.join(', '))}</dd><dt>Size</dt><dd>${bytes(total)}</dd></dl>
      <p class="pg-dim">${inTrash ? 'Right-click to restore them or delete them for good.' : 'Right-click to star, move, download or trash them together.'}</p></aside>`;
  }
  // double-click a file to open it (a single click selects it — Finder, Drive, Dropbox)
  document.addEventListener('dblclick', (e) => { const c = e.target.closest('#main .pg--lib [data-pg-file]'); if (!c) return; const f = libItem(c.dataset.pgFile); if (f) X().go('global', { global: 'library', item: f.name }); });
  function undo(msg, fn) { const t = document.getElementById('toast'); t.innerHTML = `${esc(msg)} <button class="pg-undo">Undo</button>`; t.classList.add('on'); const bt = t.querySelector('.pg-undo'); let done = false; bt.onclick = () => { if (done) return; done = true; fn(); t.classList.remove('on'); }; clearTimeout(t._pgT); t._pgT = setTimeout(() => t.classList.remove('on'), 5000); }
  // search: filters as you type; '/' focuses the page search (like GitHub, Linear)
  document.addEventListener('input', (e) => { const k = e.target.dataset?.pgQ; if (k == null) return; ui(k).q = e.target.value; repaint(); });
  document.addEventListener('keydown', (e) => {
    if (!document.querySelector('#main .pg')) return;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    if ((e.key === 'i' || e.key === 'I') && !typing && !e.ctrlKey && !e.metaKey && document.querySelector('#main .pg--lib')) { store.set('pgLibInfo', !store.get('pgLibInfo', false)); repaint(document.activeElement?.dataset?.pgFile ? `[data-pg-file="${document.activeElement.dataset.pgFile}"]` : null); }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { const n = document.querySelector('#main [data-pg-q]'); if (n) { e.preventDefault(); n.focus(); } }
    if (e.key === 'Escape' && typing && document.activeElement.dataset.pgQ != null) { const k = document.activeElement.dataset.pgQ; if (ui(k).q) { e.stopPropagation(); ui(k).q = ''; repaint(`[data-pg-q="${k}"]`); } else document.activeElement.blur(); }
    else if (e.key === 'Escape' && ui('library').sel && S().global === 'library') selectFile(null);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing && document.querySelector('#main .pg--lib [data-pg-file]')) { e.preventDefault(); pickAll(); }
    const row = document.activeElement?.closest?.('#main .pg [data-pg-go-project],#main .pg [data-pg-file],#main .pg [data-pg-item],#main .pg .pg-tr[tabindex],#main .pg .pg-card[tabindex]');
    if (row && !typing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (e.key === 'Enter' && row.dataset.pgFile && S().global === 'library') { const f = libItem(row.dataset.pgFile); return X().go('global', { global: 'library', item: f.name }); } row.click(); }
    if (row && !typing && /^Arrow(Down|Up|Left|Right)$/.test(e.key)) { const all = [...document.querySelectorAll('#main .pg [data-pg-results] [tabindex="0"]')]; const i = all.indexOf(row); if (i < 0) return; const grid = row.classList.contains('pg-card'); const cols = grid ? Math.max(1, Math.round(row.parentElement.clientWidth / row.offsetWidth)) : 1; const step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: grid ? 1 : 0, ArrowLeft: grid ? -1 : 0 }[e.key]; const n = all[i + step]; if (n) { e.preventDefault(); n.focus(); if (e.shiftKey && n.dataset.pgFile && row.dataset.pgFile) { const u = ui('library'); if (!u.anchor) u.anchor = u.picked.size ? u.anchor || u.sel : row.dataset.pgFile; rangePick(n.dataset.pgFile, true); } } }
  });
  // uploads: a real file picker and real drag-and-drop onto the Library page
  function addFiles(list) {
    const kindOf = (f) => /^image/.test(f.type) ? 'image' : /^video/.test(f.type) ? 'video' : /^audio/.test(f.type) ? 'audio' : /pdf|word|text/.test(f.type) ? 'document' : /sheet|csv/.test(f.type) ? 'sheet' : 'code';
    const L = window.XENO_PG_LIBRARY.items, now = new Date().toISOString();
    [...list].forEach((f, i) => { const id = 'lib_u' + Date.now() + i; window.XENO_FILES?.put(id, f); L.unshift({ id, name: f.name, kind: kindOf(f), bytes: f.size, createdAt: now, updatedAt: now, source: { product: 'chat', mode: X().ctxKey() === 'overview' ? 'overview' : X().ctxKey(), chat: null }, project: null, starred: false, sharedBy: null, media: null, duration: null, trashedAt: null }); });
    window.XENO_PG_SYNC_NAV?.(); X().toast(`Added ${list.length} file${list.length > 1 ? 's' : ''} to your Library`); repaint();
  }
  function pickFiles() { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = () => i.files.length && addFiles(i.files); i.click(); }
  let dragN = 0;
  document.addEventListener('dragenter', (e) => { if (!document.querySelector('#main .pg--lib') || !e.dataTransfer?.types?.includes('Files')) return; dragN++; document.querySelector('#main .pg--lib').classList.add('dragging'); });
  document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.querySelector('#main .pg--lib')?.classList.remove('dragging'); } });
  document.addEventListener('dragover', (e) => { if (document.querySelector('#main .pg--lib')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { const p = document.querySelector('#main .pg--lib'); if (!p) return; e.preventDefault(); dragN = 0; p.classList.remove('dragging'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  // ---- context menus for page objects (the engine is ctx-menu.js; the shell's objects live in app.js) ----
  (function registerPageMenus() {
    const C = window.XCM; if (!C) return; const H = C.H;
    const libHash = (name) => `#/${X().inOv() ? 'overview' : S().mode}/g/library/${encodeURIComponent(name)}`;
    const sync = () => window.XENO_PG_SYNC_NAV?.();
    const onLib = () => !!document.querySelector('#main .pg--lib');
    async function renameFile(f) {
      const v = await window.XD.form({ title: 'Rename file', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 120, value: f.name,
        validate: (x) => (window.XENO_PG_LIBRARY.items.some((o) => o !== f && !o.trashedAt && o.name.toLowerCase() === x.trim().toLowerCase()) ? 'A file with this name already exists.' : null) }] });
      if (!v || v.name === f.name) return; const was = f.name; f.name = v.name.trim(); f.updatedAt = new Date().toISOString(); sync(); repaint();
      undo(`Renamed to “${f.name}”`, () => { f.name = was; sync(); repaint(); });
    }
    function duplicateFile(f) {
      const L = window.XENO_PG_LIBRARY.items, dot = f.name.lastIndexOf('.'), stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : '';
      let n = 1, name = `${stem} copy${ext}`; while (L.some((o) => o.name === name)) name = `${stem} copy ${++n}${ext}`;
      const now = new Date().toISOString(), c = { ...f, id: 'lib_' + Date.now(), name, createdAt: now, updatedAt: now, starred: false, source: { ...f.source }, media: f.media && { ...f.media } };
      L.splice(L.indexOf(f) + 1, 0, c); sync(); repaint(); if (onLib()) selectFile(c.id);
      undo(`Duplicated as “${name}”`, () => { L.splice(L.indexOf(c), 1); sync(); repaint(); });
    }
    function moveFile(f, project) { const was = f.project; f.project = project; f.updatedAt = new Date().toISOString(); sync(); repaint(); undo(project ? `Moved to ${project}` : 'Removed from its project', () => { f.project = was; sync(); repaint(); }); }
    function trashFile(f) { f.trashedAt = new Date().toISOString(); ui('library').sel = null; sync(); repaint(); undo(`Moved “${f.name}” to Trash`, () => { f.trashedAt = null; sync(); repaint(); }); }
    async function purgeFile(f) {
      if (!await window.XD.confirm({ title: `Delete “${esc(f.name)}” forever?`, body: 'It is removed from your Library and every project and chat that links to it. This can’t be undone.', action: 'Delete forever' })) return;
      const L = window.XENO_PG_LIBRARY.items; L.splice(L.indexOf(f), 1); ui('library').sel = null; sync(); repaint(); X().toast(`Deleted “${f.name}” for good`);
    }
    const downloadFile = (f) => window.XENO_FILES.download([f]);
    // several files at once — every verb says how many it acts on (Finder: "Move 3 Items to Trash")
    function batchMenu(fs) {
      const n = fs.length, N = `${n} files`, projects = (window.XENO_PG_PROJECTS?.items || []).filter((p) => p.status !== 'archived').map((p) => p.name);
      const done = () => { sync(); repaint(); };
      if (fs.every((f) => f.trashedAt)) return [[{ label: `Restore ${N}`, icon: 'undo', run: () => { fs.forEach((f) => { f.trashedAt = null; }); ui('library').sel = null; done(); X().toast(`Restored ${N}`); } }],
        [{ label: `Delete ${N} forever…`, icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: async () => {
          if (!await window.XD.confirm({ title: `Delete ${N} forever?`, body: 'They are removed from your Library and from every project and chat that links to them. This can’t be undone.', action: `Delete ${N}` })) return;
          const L = window.XENO_PG_LIBRARY.items; fs.forEach((f) => { L.splice(L.indexOf(f), 1); window.XENO_FILES.del(f.id); }); ui('library').sel = null; done(); X().toast(`Deleted ${N} for good`); } }]];
      const allStar = fs.every((f) => f.starred), was = fs.map((f) => [f, f.project]);
      const moveAll = (pn) => () => { fs.forEach((f) => { f.project = pn; f.updatedAt = new Date().toISOString(); }); done(); undo(pn ? `Moved ${N} to ${pn}` : `Removed ${N} from their projects`, () => { was.forEach(([f, p]) => { f.project = p; }); done(); }); };
      return [[{ label: allStar ? `Unstar ${N}` : `Star ${N}`, icon: 'star', key: 's', kbd: 'S', run: () => { fs.forEach((f) => { f.starred = !allStar; }); done(); X().toast(allStar ? `Removed ${N} from Starred` : `Starred ${N}`); } },
          { label: `Move ${N} to project`, icon: 'folder', sub: () => [projects.map((pn) => ({ label: pn, icon: 'folder', checked: fs.every((f) => f.project === pn), run: moveAll(pn) })), [{ label: 'No project', icon: 'minus', checked: fs.every((f) => !f.project), run: moveAll(null) }]] }],
        [{ label: `Download ${N}`, hint: 'zip', icon: 'download', run: () => window.XENO_FILES.download(fs) },
          { label: 'Copy links', icon: 'link', run: () => H.copy(fs.map((f) => H.link(libHash(f.name))).join('\n'), `${n} links copied`) }],
        [{ label: 'Clear selection', icon: 'minus', kbd: 'Esc', run: () => selectFile(null) }],
        [{ label: `Move ${N} to Trash`, icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => { const at = new Date().toISOString(); fs.forEach((f) => { f.trashedAt = at; }); ui('library').sel = null; done(); undo(`Moved ${N} to Trash`, () => { fs.forEach((f) => { f.trashedAt = null; }); done(); }); } }]];
    }
    // pasting into the Library adds what is on the clipboard: images and files as themselves, text as a .txt file
    async function pasteIntoLibrary() {
      const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '.');
      try {
        const items = await navigator.clipboard.read(), files = [];
        for (const it of items) {
          const t = it.types.find((x) => !x.startsWith('text/'));
          if (t) { const b = await it.getType(t); files.push(new File([b], `Pasted ${t.split('/')[0]} ${stamp}.${(t.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/\+.*$/, '')}`, { type: t })); }
          else if (it.types.includes('text/plain')) { const s = await (await it.getType('text/plain')).text(); if (s.trim()) files.push(new File([s], `Pasted text ${stamp}.txt`, { type: 'text/plain' })); }
        }
        if (!files.length) return X().toast('The clipboard is empty');
        addFiles(files);
      } catch { H.clipboardHelp(); }
    }
    document.addEventListener('paste', (e) => {
      if (!document.querySelector('#main .pg--lib') || e.target.closest?.('input, textarea, [contenteditable], .xd')) return;
      const files = [...(e.clipboardData?.files || [])], s = e.clipboardData?.getData('text/plain');
      if (!files.length && !s?.trim()) return;
      e.preventDefault(); addFiles(files.length ? files : [new File([s], `Pasted text ${new Date().toLocaleTimeString('en-GB').replace(/:/g, '.')}.txt`, { type: 'text/plain' })]);
    });
    C.register({ id: 'file', sel: '[data-pg-file]', priority: 5, build: (n) => {
      const f = libItem(n.dataset.pgFile); if (!f) return null;
      const many = onLib() ? picks() : [];
      if (many.length > 1 && many.includes(f.id)) return batchMenu(many.map(libItem));
      if (onLib() && (ui('library').sel !== f.id || ui('library').picked.size)) selectFile(f.id);   // right-click selects what it acts on (Finder, Drive)
      const open = () => X().go('global', { global: 'library', item: f.name }), h = libHash(f.name);
      if (f.trashedAt) return [[{ label: 'Restore', icon: 'undo', run: () => { f.trashedAt = null; ui('library').sel = null; sync(); repaint(); X().toast(`Restored “${f.name}”`); } }],
        [{ label: 'Copy name', icon: 'copy', run: () => H.copy(f.name, 'Name copied') }],
        [{ label: 'Delete forever…', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => purgeFile(f) }]];
      const projects = (window.XENO_PG_PROJECTS?.items || []).filter((p) => p.status !== 'archived').map((p) => p.name);
      const prod = f.source?.product && PR[f.source.product];
      return [[{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: open },
          ...(prod ? [{ label: `Open in ${prod.name}`, icon: 'external', iconHTML: X().pIconFull(prod, 15), key: 'Ctrl+Enter', kbd: 'Ctrl ↵', run: () => X().go('product', { product: f.source.product, item: f.name }) }] : []),
          { label: 'Open in new window', icon: 'hub', run: () => H.openWindow(h) },
          ...(onLib() ? [{ label: 'Details', icon: 'info', kbd: 'I', checked: !!store.get('pgLibInfo', false), run: () => { store.set('pgLibInfo', !store.get('pgLibInfo', false)); ui('library').sel = f.id; repaint(); } }] : [])],
        [{ label: 'Starred', icon: 'star', key: 's', kbd: 'S', checked: !!f.starred, run: () => { f.starred = !f.starred; sync(); repaint(); X().toast(f.starred ? 'Starred' : 'Removed from Starred'); } },
          { label: 'Rename…', icon: 'edit', key: 'F2', kbd: 'F2', run: () => renameFile(f) },
          { label: 'Duplicate', icon: 'duplicate', key: 'Ctrl+d', kbd: 'Ctrl D', run: () => duplicateFile(f) },
          { label: 'Move to project', icon: 'folder', sub: () => [projects.map((pn) => ({ label: pn, icon: 'folder', checked: f.project === pn, run: () => moveFile(f, pn) })), [{ label: 'No project', icon: 'minus', checked: !f.project, run: () => moveFile(f, null) }]] }],
        [...(f.source?.chat ? [{ label: 'Go to the chat it came from', icon: 'chat', run: () => X().go('product', { product: 'chat' }) }] : []),
          ...(f.project ? [{ label: `Go to ${f.project}`, icon: 'folder', run: () => X().go('global', { global: 'projects', item: f.project }) }] : [])],
        [{ label: 'Copy link', icon: 'link', run: () => H.copyLink(h) }, { label: 'Download', icon: 'download', run: () => downloadFile(f) }],
        [{ label: 'Move to Trash', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => trashFile(f) }]];
    } });

    // workspace destinations and directory entries (divisions, members, threads, listings…)
    C.register({ id: 'ws', sel: '[data-pg-ws], [data-pg-gitem], [data-pg-chat]', priority: 3, build: (n) => {
      const d = n.dataset, name = d.pgWs ?? d.pgGitem ?? d.pgChat, label = (n.querySelector('b')?.textContent || name || '').trim();
      const h = d.pgWs !== undefined ? `#/${X().inOv() ? 'overview' : S().mode}/g/workspace${d.pgWs ? '/' + encodeURIComponent(d.pgWs) : ''}`
        : d.pgGitem ? `#/${X().inOv() ? 'overview' : S().mode}/g/${S().global}/${encodeURIComponent(d.pgGitem)}` : `#/${X().inOv() ? 'overview' : S().mode}/p/chat`;
      return [H.nav(h, () => n.click()), H.linkItems(h, label)];
    } });

    // an activity entry or a session line: what you do with a line of record is copy it
    C.register({ id: 'record-line', sel: '#main .pg-tl > li, #main .pg-log li', priority: 1, build: (n) => {
      const log = n.closest('.pg-log'), list = n.parentElement, line = (x) => [...x.querySelectorAll('span:not(.pg-log-m), code, small')].map((e) => e.textContent.trim()).filter(Boolean).join(' — ');
      return [[{ label: log ? 'Copy line' : 'Copy entry', icon: 'copy', run: () => H.copy(log ? n.querySelector('code').textContent : line(n), 'Copied') },
        { label: log ? 'Copy the whole session' : 'Copy all activity', icon: 'copy', run: () => H.copy([...list.children].map((x) => (log ? `${x.querySelector('.pg-log-m')?.textContent || ''} ${x.querySelector('code')?.textContent || ''}`.trim() : line(x))).join(String.fromCharCode(10)), 'Copied') }]];
    } });

    // agent and team cards that have no page of their own yet
    C.register({ id: 'card', sel: '#main .pg-card--agent, #main .pg-card--team', priority: 1, build: (n) => {
      const name = n.querySelector('b')?.textContent.trim(); if (!name) return null; const team = n.classList.contains('pg-card--team');
      const h = `#/${X().inOv() ? 'overview' : S().mode}/g/workspace/${team ? 'Teams' : 'Agents'}`;
      return [[{ label: team ? 'Open Teams' : 'Open Agents', icon: 'open', run: () => { location.hash = h; } }, { label: 'Open in new window', icon: 'hub', run: () => H.openWindow(h) }],
        [{ label: 'Copy name', icon: 'copy', run: () => H.copy(name, 'Name copied') }]];
    } });

    // any other card or sidebar row that opens something: open it, or take its name
    C.register({ id: 'opener', sel: '#main .pg-card, #panel .row', priority: 0, when: (n) => n.matches('button, a, [role=button], [tabindex]') && !n.matches('.skel'), build: (n) => {
      const name = (n.querySelector('b, .t')?.textContent || n.textContent).trim().replace(/\s+/g, ' ');
      return [[{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: () => n.click() }], [{ label: 'Copy name', icon: 'copy', run: () => H.copy(name, 'Name copied') }]];
    } });

    // the page itself: its header actions, its layout, refresh, details — whatever this page really has
    C.register({ id: 'page', sel: '#main .pg, #main .pg-top, #main .mview, #main .mfoot', priority: -1, build: () => {
      const acts = [...document.querySelectorAll('#main .pg-top-acts button')].filter((b) => b.offsetParent && b.textContent.trim()).slice(0, 3)
        .map((b) => ({ label: b.textContent.trim().replace(/\s+/g, ' ') + (b.dataset.xa && !/[…]$/.test(b.textContent.trim()) ? '…' : ''), icon: /new|add|create|upload|invite/i.test(b.textContent) ? 'plus' : 'open', run: () => b.click() }));
      const views = [...document.querySelectorAll('#main .pg-vt [data-pg-view]')].map((b) => ({ label: b.getAttribute('aria-label') || b.title || b.dataset.v, icon: b.dataset.v === 'grid' ? 'grid' : 'layers', checked: b.getAttribute('aria-pressed') === 'true' || b.classList.contains('on'), run: () => b.click() }));
      const refresh = document.querySelector('#main [data-pg-refresh]'), info = document.querySelector('#main [data-pg-info]'), sel = onLib() && ui('library').sel;
      return [acts,
        onLib() ? [...(document.querySelector('#main .pg--lib [data-pg-file]') ? [{ label: 'Select all', icon: 'grid', kbd: 'Ctrl A', run: () => pickAll() }] : []), { label: 'Paste', icon: 'paste', kbd: 'Ctrl V', run: () => pasteIntoLibrary() }] : [],
        [...(views.length ? [{ label: 'Layout', icon: 'grid', sub: views }] : []),
          ...(info ? [{ label: 'Details pane', icon: 'info', kbd: 'I', checked: !!store.get('pgLibInfo', false), run: () => info.click() }] : []),
          ...(sel ? [{ label: 'Clear selection', icon: 'minus', run: () => selectFile(null) }] : []),
          ...(refresh ? [{ label: 'Refresh', icon: 'refresh', run: () => refresh.click() }] : [])],
        [{ label: 'Copy link to this page', icon: 'link', run: () => H.copyLink(location.hash || '#/') }, { label: 'Open in new window', icon: 'hub', run: () => H.openWindow(location.hash || '#/') }]];
    } });
  })();
  void keyOfInput;
})();
