/* Actions — what the workspace's buttons actually do. Each opens a dialog (modals.js), validates, changes
   the data the pages render from, re-derives the sidebar, and repaints in place — so a new project shows up
   in the list, the sidebar count, the Overview and the address bar at once. In the real app each `commit`
   is the matching API call (MODES SPEC §7d contracts); nothing here is decorative. */
(() => {
  const X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = () => window.XENO_PROJECTS, L = () => window.XENO_PG_PROJECTS.items, W = () => window.XENO_PG_WORKSPACE;
  const refresh = () => { window.XENO_PG_SYNC_NAV?.(); X().render(); };   // sidebar + page from the same data
  const toast = (s) => X().toast(s);
  const MODE_OPTS = () => [['Overview', 'Overview', 'Across every mode'], ...window.XENO_MODES.map((m) => [X().M[m.id].name, X().M[m.id].name, m.persona || ''])];
  const avatar = (n, kind) => `<span class="pg-av${kind === 'agent' ? ' agent' : ''}">${kind === 'agent' ? X().ic('bot') : esc(n[0])}</span>`;
  const AGENTS = ['Atlas', 'Kit', 'Juno', 'Echo'];
  const unique = (name, except) => (L().some((p) => p.name.toLowerCase() === name.toLowerCase() && p.name !== except) ? 'A project with this name already exists.' : null);

  async function newProject(opts = {}) {
    const ctx = X().ctxName();
    const v = await D().form({ title: 'New project', sub: 'One project holds the chats, files, tasks and teams for a goal.', submit: 'Create project', fields: [
      { id: 'name', label: 'Name', required: true, placeholder: 'e.g. Spring launch', validate: (x) => unique(x) },
      { id: 'mode', label: 'Mode', type: 'choice', cols: 4, value: ctx === 'Overview' ? 'Overview' : ctx, options: MODE_OPTS().map(([v2, l]) => [v2, l]) },
      { id: 'goal', label: 'Goal', type: 'textarea', rows: 2, placeholder: 'What does done look like?' },
      { id: 'icon', label: 'Icon', type: 'icon', value: 'folder' }] });
    if (!v) return;
    P()[v.name] = { mode: v.mode, owner: 'Emilian', goal: v.goal || '', milestone: '—', progress: '0 of 0 tasks', icon: v.icon, tasks: [], taskObjs: [], chats: [], teams: [], resources: [], funding: [], activity: [['Emilian created the project', 'just now']] };
    L().unshift({ id: 'prj_' + Date.now(), name: v.name, mode: v.mode, owner: { name: 'Emilian', kind: 'human' }, status: 'active', health: 'on_track', goal: v.goal || '', icon: v.icon, milestone: { title: 'No milestone yet', due: '—' }, tasks: { total: 0, done: 0 }, members: [{ name: 'Emilian', kind: 'human' }], needsYou: 0, updatedAt: new Date().toISOString() });
    window.XENO_PG_SYNC_NAV?.(); X().go('global', { global: 'projects', item: v.name }); X().refreshPanel(); toast(`Created “${v.name}”`);
  }
  function rewriteProjectName(from, to) {
    P()[to] = P()[from]; delete P()[from];
    const li = L().find((p) => p.name === from); if (li) li.name = to;
    window.XENO_PG_LIBRARY.items.forEach((f) => { if (f.project === from) f.project = to; });
    Object.values(window.XENO_CHATS_BY_CTX || {}).forEach((c) => (c.projects || []).forEach((pj) => { if (pj[0] === from) pj[0] = to; }));
    W().teams.forEach((t) => { t.projects = t.projects.map((n) => (n === from ? to : n)); });
  }
  async function renameProject(name) {
    const v = await D().form({ title: 'Rename project', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, value: name, validate: (x) => unique(x, name) }] });
    if (!v || v.name === name) return;
    rewriteProjectName(name, v.name); window.XENO_PG_SYNC_NAV?.();
    const s = X().S; if (s.view === 'global' && s.global === 'projects' && s.item && s.item.split('/')[0] === name) { X().go('global', { global: 'projects', item: [v.name, ...s.item.split('/').slice(1)].join('/') }); X().refreshPanel(); } else X().render();
    toast(`Renamed to “${v.name}”`);
  }
  async function iconProject(name) {
    const cur = (P()[name] || {}).icon || (L().find((p) => p.name === name) || {}).icon || 'folder';
    const v = await D().form({ title: 'Change icon', sub: name, submit: 'Use this icon', size: 'sm', fields: [{ id: 'icon', label: 'Icon', type: 'icon', value: cur }] });
    if (!v) return; if (P()[name]) P()[name].icon = v.icon; const li = L().find((p) => p.name === name); if (li) li.icon = v.icon; refresh(); toast('Icon updated');
  }
  async function archiveProject(name) {
    if (!await D().confirm({ title: `Archive “${name}”?`, body: 'It leaves your active projects. Its chats, files, tasks and history are kept, and you can restore it any time from <b>Archived</b>.', action: 'Archive', danger: false })) return;
    const li = L().find((p) => p.name === name); if (li) li.status = 'archived'; window.XENO_PG_SYNC_NAV?.(); X().go('global', { global: 'projects', item: null }); X().refreshPanel(); toast(`Archived “${name}”`);
  }
  async function deleteProject(name) {
    if (!await D().confirm({ title: `Delete “${name}”?`, body: `This removes the project for everyone on it. <b>Its chats and files stay in your Library</b>, but tasks, assignments and history are deleted. This can’t be undone.`, action: 'Delete project', typeToConfirm: name })) return;
    delete P()[name]; const i = L().findIndex((p) => p.name === name); if (i >= 0) L().splice(i, 1);
    window.XENO_PG_LIBRARY.items.forEach((f) => { if (f.project === name) f.project = null; });
    window.XENO_PG_SYNC_NAV?.(); X().go('global', { global: 'projects', item: null }); X().refreshPanel(); toast(`Deleted “${name}”`);
  }
  function projectMenu(btn, name) {
    D().menu(btn, [{ id: 'rename', icon: 'edit', label: 'Rename', run: () => renameProject(name) }, { id: 'icon', icon: 'palette', label: 'Change icon', run: () => iconProject(name) }, { id: 'assign', icon: 'people', label: 'Assign people or agents', run: () => assign(name) }, { id: 'budget', icon: 'chart', label: 'Set a budget', run: () => budget(name) }, '-', { id: 'archive', icon: 'archive', label: 'Archive', run: () => archiveProject(name) }, { id: 'delete', icon: 'trash', label: 'Delete project', danger: true, run: () => deleteProject(name) }]);
  }
  async function assign(name) {
    const p = P()[name]; if (!p) return;
    const teams = W().teams.map((t) => [t.name, t.name, `Team · lead ${t.lead} · ${t.members.length} members`, `<span class="pg-av">${esc(t.name[0])}</span>`]);
    const agents = AGENTS.map((a) => { const m = W().members.find((x) => x.name === a); return [a + ' (agent)', a, `Agent · ${m ? m.title : ''}`, avatar(a, 'agent')]; });
    const v = await D().form({ title: 'Assign people or agents', sub: name, submit: 'Save', fields: [{ id: 'who', label: 'Working on this project', type: 'checks', options: [...teams, ...agents], value: p.teams.map((t) => t[0]), hint: 'Teams are referenced, not copied — changing a team updates every project it is on.' }] });
    if (!v) return;
    p.teams = v.who.map((n) => { const t = W().teams.find((x) => x.name === n); return t ? [n, `${t.members.length} members`] : [n, (W().members.find((m) => n.startsWith(m.name)) || {}).title || 'Agent']; });
    W().teams.forEach((t) => { const on = v.who.includes(t.name); t.projects = on ? [...new Set([...t.projects, name])] : t.projects.filter((x) => x !== name); });
    const li = L().find((x) => x.name === name); if (li) li.members = [{ name: 'Emilian', kind: 'human' }, ...v.who.filter((n) => n.endsWith('(agent)')).map((n) => ({ name: n.replace(' (agent)', ''), kind: 'agent' }))];
    p.activity.unshift(['Emilian updated who works on this project', 'just now']); refresh(); toast('Assignments saved');
  }
  async function newTask(name) {
    const p = P()[name]; if (!p) return;
    const v = await D().form({ title: 'New task', sub: name, submit: 'Add task', fields: [
      { id: 'title', label: 'Task', required: true, placeholder: 'What needs doing?' },
      { id: 'who', label: 'Assignee', type: 'choice', cols: 3, value: 'none', options: [['none', 'Unassigned'], ['Emilian', 'Emilian'], ...AGENTS.map((a) => [a, a, 'Agent'])] },
      { id: 'state', label: 'Status', type: 'seg', value: 'todo', options: [['todo', 'To do'], ['doing', 'In progress']] }] });
    if (!v) return;
    p.taskObjs = p.taskObjs || []; p.taskObjs.push({ id: 't' + Date.now(), title: v.title, state: v.state, assignee: v.who === 'none' ? null : { name: v.who, kind: AGENTS.includes(v.who) ? 'agent' : 'human' }, note: '', evidence: 0 });
    p.tasks.push([v.title, v.state === 'doing' ? 'In progress' : 'To do']);
    const li = L().find((x) => x.name === name); if (li) li.tasks.total++; p.activity.unshift([`Emilian added “${v.title}”`, 'just now']); refresh(); toast('Task added');
  }
  async function budget(name) {
    const p = P()[name]; if (!p) return;
    const v = await D().form({ title: 'Set a budget', sub: name, submit: 'Save budget', size: 'sm', fields: [
      { id: 'amount', label: 'Budget (€)', type: 'number', required: true, placeholder: '4000', validate: (x) => (/^\d+([.,]\d{1,2})?$/.test(x) && +x.replace(',', '.') > 0 ? null : 'Enter an amount, like 2500.') },
      { id: 'period', label: 'Resets', type: 'seg', value: 'project', options: [['project', 'Never'], ['month', 'Monthly']] }] });
    if (!v) return; const amt = Math.round(+v.amount.replace(',', '.')).toLocaleString('en');
    p.funding = [['Budget', `€0 of €${amt}${v.period === 'month' ? ' · monthly' : ''}`], ...p.funding.filter((f) => f[0] !== 'Budget')]; refresh(); toast('Budget set');
  }
  async function invite() {
    const v = await D().form({ title: 'Invite people or agents', sub: window.XENO_PG_WORKSPACE.name, submit: 'Send invites', fields: [
      { id: 'emails', label: 'Email addresses', type: 'chips', placeholder: 'name@company.com — Enter to add', validate: (x, all) => (x.length ? (x.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) ? 'One of these is not an email address.' : null) : (all.agents.length ? null : 'Add an email address or pick an agent.')) },
      { id: 'agents', label: 'Or assign agents', type: 'checks', options: [['Nova-bot', 'Scout', 'Research agent from the Marketplace', avatar('S', 'agent')], ['Ledger', 'Ledger', 'Bookkeeping agent', avatar('L', 'agent')]], value: [] },
      { id: 'role', label: 'Role', type: 'seg', value: 'member', options: [['member', 'Member'], ['admin', 'Admin'], ['guest', 'Guest']] },
      { id: 'div', label: 'Division', type: 'choice', cols: 4, value: 'Studio', options: W().divisions.map((d) => [d.name, d.name]) }] });
    if (!v) return;
    v.emails.forEach((e) => W().members.push({ id: 'mem_' + Date.now() + e, name: e.split('@')[0].replace(/^./, (c) => c.toUpperCase()), kind: 'human', role: v.role, title: e, divisions: [v.div], lastActiveAt: null, status: 'invited', ownedBy: null }));
    v.agents.forEach((a) => W().members.push({ id: 'mem_' + Date.now() + a, name: a === 'Nova-bot' ? 'Scout' : a, kind: 'agent', role: 'member', title: a === 'Nova-bot' ? 'Research' : 'Bookkeeping', divisions: [v.div], lastActiveAt: new Date().toISOString(), status: 'idle', ownedBy: 'Emilian' }));
    W().activity.unshift({ id: 'ac_' + Date.now(), text: `Emilian invited ${v.emails.length + v.agents.length} to ${v.div}`, kind: 'human', at: new Date().toISOString() });
    refresh(); toast(`${v.emails.length ? v.emails.length + ' invite' + (v.emails.length > 1 ? 's' : '') + ' sent' : ''}${v.emails.length && v.agents.length ? ' · ' : ''}${v.agents.length ? v.agents.length + ' agent' + (v.agents.length > 1 ? 's' : '') + ' assigned' : ''}`);
  }
  async function newThread(space) {
    const spaces = ['Questions', 'Discussions', 'Showcase', 'Feedback'];
    const v = await D().form({ title: 'New thread', sub: 'Public — people and agents can answer', submit: 'Post thread', fields: [
      { id: 'title', label: 'Title', required: true, max: 140, placeholder: 'Ask a clear question or name what you made' },
      { id: 'space', label: 'Space', type: 'seg', value: spaces.includes(space) ? space : 'Questions', options: spaces.map((s) => [s, s]) },
      { id: 'body', label: 'Details', type: 'textarea', rows: 4, required: true, placeholder: 'What did you try? What happened?' }] });
    if (!v) return;
    const dups = window.XENO_COMM?.similar(v.title) || [];
    if (dups.length && !await D().confirm({ title: 'This may already be answered', body: `Similar: “${dups[0].title}”. Post yours anyway, or cancel to read that one first.`, action: 'Post anyway', danger: false })) return X().go('global', { global: 'community', item: dups[0].id });
    const nid = 'th_' + Date.now().toString(36); window.XENO_PG_FORUM.unshift({ id: nid, title: v.title, space: v.space, author: { name: 'Emilian', kind: 'human' }, replies: 0, state: 'open', body: v.body, lastActivityAt: new Date().toISOString() }); window.XENO_DB?.save?.(); X().go('global', { global: 'community', item: nid }); toast('Thread posted');
  }
  async function newMind() {
    const v = await D().form({ title: 'New Mind', sub: 'A Mind is given. A Soul is earned.', submit: 'Create Mind', fields: [
      { id: 'name', label: 'Name', required: true, max: 32, placeholder: 'e.g. Vega', validate: (x) => (window.XENO_PG_ANIMA.minds.some((m) => m.name.toLowerCase() === x.toLowerCase()) ? 'You already have a Mind with this name.' : null) },
      { id: 'role', label: 'What is it for?', type: 'textarea', rows: 3, required: true, placeholder: 'Watches my inbox, files invoices into Sheets, asks before paying anything.' }] });
    if (!v) return;
    window.XENO_PG_ANIMA.minds.push({ id: 'mind_' + Date.now(), name: v.name, role: v.role.split(/[.,]/)[0].slice(0, 40), status: 'idle', now: 'New — has not run yet', soul: { episodes: 0, skills: 0 } }); refresh(); toast(`${v.name} is ready`);
  }
  async function setCap() {
    const v = await D().form({ title: 'Agent spending cap', sub: 'Agents stop and ask when they reach it', submit: 'Save cap', size: 'sm', fields: [
      { id: 'amount', label: 'Credits per month', type: 'number', required: true, placeholder: '5000', validate: (x) => (/^\d+$/.test(x) && +x > 0 ? null : 'Enter a whole number of credits.') }] });
    if (v) { store().set('agentCap', +v.amount); X().render(); toast(`Agents capped at ${(+v.amount).toLocaleString('en')} credits a month`); }
  }
  const store = () => X().store;
  async function renameChat(title) {
    const v = await D().form({ title: 'Rename chat', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 80, value: title }] });
    if (!v || v.name === title) return;
    Object.values(window.XENO_CHATS_BY_CTX || {}).forEach((c) => { (c.recents || []).forEach((g) => { g[1] = g[1].map((t) => (t === title ? v.name : t)); }); (c.projects || []).forEach((pj) => { pj[2] = pj[2].map((t) => (t === title ? v.name : t)); }); c.pinned = (c.pinned || []).map((t) => (t === title ? v.name : t)); });
    window.XENO_PG_SYNC_NAV?.(); X().render(); toast(`Renamed to “${v.name}”`);
  }
  async function deleteChat(title) {
    if (!await D().confirm({ title: `Delete “${title}”?`, body: 'The conversation is removed from this chat history. Files it created stay in your Library.', action: 'Delete chat' })) return;
    Object.values(window.XENO_CHATS_BY_CTX || {}).forEach((c) => { (c.recents || []).forEach((g) => { g[1] = g[1].filter((t) => t !== title); }); (c.projects || []).forEach((pj) => { pj[2] = pj[2].filter((t) => t !== title); }); c.pinned = (c.pinned || []).filter((t) => t !== title); });
    window.XENO_PG_SYNC_NAV?.(); X().render(); toast('Chat deleted');
  }


  // same keys as the shell's store ('xw.' + key), readable before the shell exists
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  // ---------- workspaces: ONE list, read by the account popover, the Workspace switcher and the rail avatar ----------
  // Platform: GET /api/v2/me/workspaces · POST /api/v2/workspaces · PUT /api/v2/me/workspace
  const WS_DEFAULT = [{ id: 'personal', name: 'Personal', sub: 'Just you', initial: 'E' }, { id: 'xeno', name: 'XENO Corp', sub: 'Company · you are the owner', initial: 'X' }, { id: 'lumen', name: 'Lumen Studio', sub: 'Guest · 2 projects', initial: 'L' }];
  const workspaces = () => LS.get('workspaces', null) || WS_DEFAULT;
  const currentWorkspace = () => { const all = workspaces(), id = LS.get('workspace', 'personal'); return all.find((w) => w.id === id) || all[0]; };
  function switchWorkspace(id) { const w = workspaces().find((x) => x.id === id); if (!w || w.id === currentWorkspace().id) return; LS.set('workspace', id); X().applyWorkspace?.(); X().render(); toast(`Switched to ${w.name}`); }
  async function newCompany() {
    const v = await D().form({ title: 'Create a company', sub: 'A company is a workspace you share: people and agents, one wallet, one Library.', submit: 'Create company', size: 'sm', fields: [
      { id: 'name', label: 'Company name', required: true, max: 60, placeholder: 'e.g. Lumen Studio', validate: (x) => (workspaces().some((w) => w.name.toLowerCase() === x.trim().toLowerCase()) ? 'You already have a workspace with this name.' : null) },
      { id: 'kind', label: 'What it is', type: 'seg', value: 'studio', options: [['studio', 'Studio'], ['agency', 'Agency'], ['startup', 'Startup'], ['other', 'Other']] }] });
    if (!v) return;
    const id = 'ws_' + Date.now().toString(36), all = workspaces().concat({ id, name: v.name.trim(), sub: 'Company · you are the owner', initial: v.name.trim()[0].toUpperCase() });
    LS.set('workspaces', all); LS.set('workspace', id); X().applyWorkspace?.(); X().render(); toast(`Created ${v.name.trim()} — you are its owner`);
  }

  // ---------- sign out: the session ends, a reload stays signed out, signing in returns to the same place ----------
  // Platform: POST /api/oauth2/revoke, then the XENO sign-in page (XENO AUTH §OIDC)
  async function signOut() {
    if (!await D().confirm({ title: 'Sign out of XENO?', body: 'You will need to sign in again to use your workspace on this device. Nothing you made is affected.', action: 'Sign out', danger: false })) return;
    signOutNow();
  }
  function signOutNow() { LS.set('signedOut', { at: Date.now(), place: location.hash }); showSignedOut();
  }
  function showSignedOut() {
    if (document.getElementById('signedout')) return;
    const s = document.createElement('div'); s.id = 'signedout'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-label', 'Signed out');
    s.innerHTML = `<div class="so-card"><span class="so-mark">${X()?.mark ? X().mark('xeno', 'mk so-mk') : ''}</span><h1>You’re signed out</h1><p>Sign in to get back to your workspace, exactly where you left it.</p>
      <button class="so-btn" data-so-in>Sign in with XENO</button><button class="so-link" data-so-other>Use a different account</button></div>`;
    document.body.appendChild(s); document.documentElement.classList.add('is-signedout');
    s.querySelector('[data-so-in]').focus();
    s.addEventListener('click', (e) => { if (e.target.closest('[data-so-in]')) { const p = LS.get('signedOut', {}); LS.set('signedOut', null); s.remove(); document.documentElement.classList.remove('is-signedout'); if (p?.place && p.place !== location.hash) location.hash = p.place; toast('Signed in'); }
      if (e.target.closest('[data-so-other]')) { s.querySelector('[data-so-in]').click(); toast('Choosing an account happens on the XENO sign-in page'); } });
  }
  if (LS.get('signedOut', null)) (document.readyState === 'loading' ? addEventListener('DOMContentLoaded', showSignedOut) : showSignedOut());

  // ---------- report a problem / suggest a feature / contact support (XENO REPORT spec; F1) ----------
  // Platform: POST /api/forum/report (public → a Community thread) · POST /api/support/tickets (private)
  async function report({ kind = 'bug', visibility = 'public', title = '' } = {}) {
    const diag = `XENO Workspace prototype · ${location.hash || '#/'} · ${navigator.userAgentData?.brands?.map((b) => b.brand + ' ' + b.version).find((x) => !/Not/.test(x)) || navigator.userAgent.split(' ').slice(-1)[0]} · ${innerWidth}×${innerHeight}`;
    const v = await D().form({ title: kind === 'feature' ? 'Suggest a feature' : title === 'Contact support' ? 'Contact support' : 'Report a problem', sub: 'Goes to the XENO team. You choose who can read it.', submit: 'Send', fields: [
      { id: 'kind', label: 'This is', type: 'seg', value: kind, options: [['bug', 'Something is broken'], ['feature', 'An idea'], ['feedback', 'Feedback']] },
      { id: 'title', label: 'In one line', required: true, max: 120, value: title === 'Contact support' ? '' : title, placeholder: kind === 'feature' ? 'e.g. Let me pin a chat to the rail' : 'e.g. Export stops at 80 %' },
      { id: 'body', label: 'What happened', type: 'textarea', rows: 4, placeholder: kind === 'feature' ? 'What would it let you do?' : 'What did you do, what did you expect, what happened instead?' },
      { id: 'vis', label: 'Who can read it', type: 'choice', cols: 2, value: visibility, options: [['public', 'Everyone — post it in Community'], ['private', 'Only the XENO team — a private ticket']] },
      { id: 'diag', label: 'Attach', type: 'checks', value: ['diag'], options: [['diag', `Technical details — ${diag}`]] }] });
    if (!v) return;
    if (v.vis === 'public') {
      const F = window.XENO_PG_FORUM, th = { id: 'th_' + Date.now(), title: v.title.trim(), space: v.kind === 'bug' ? 'Questions' : 'Feedback', author: { name: 'Emilian', kind: 'human' }, replies: 0, state: 'open', lastActivityAt: new Date().toISOString(), body: v.body || '', diag: (v.diag || []).length ? diag : null };
      F.unshift(th); window.XENO_DB?.save?.();
      const t = document.getElementById('toast'); t.innerHTML = `Posted in Community <button class="pg-undo">View</button>`; t.classList.add('on'); t.querySelector('.pg-undo').onclick = () => { t.classList.remove('on'); X().go('global', { global: 'community', item: th.title }); };
      clearTimeout(t._pgT); t._pgT = setTimeout(() => t.classList.remove('on'), 5000);
    } else {
      const T = LS.get('tickets', []), n = 1040 + T.length + 1; T.unshift({ n, title: v.title.trim(), kind: v.kind, at: Date.now(), state: 'open' }); LS.set('tickets', T);
      toast(`Ticket #${n} opened — the reply comes by email and to your inbox`);
    }
  }

  // ---------- What's new: the real releases, newest first, each linked to its release notes ----------
  const RELEASES = [['canvas', 'Canvas 0.39', 'Sep 17', 'The shared agent panel arrives in Canvas.'], ['hub', 'Hub 0.11', 'Aug 30', 'Signed tools update without a Hub release.'], ['motion', 'Motion 0.10', 'Sep 3', 'Linux build; programmatic .xmotion files.'], ['engine', 'Engine 0.4', 'Sep 3', 'Export a game as a runnable Windows build.'], ['agent', 'Agent 0.3', 'Sep 3', 'The XENO Agent desktop app, Windows and Linux.'], ['browser', 'Browser 0.4', 'Aug 29', 'Agent-native file upload and download by path.']];
  function whatsNew() {
    D().info({ title: 'What’s new', sub: 'Releases across XENO, newest first', html: `<ol class="xd-rel">${RELEASES.map(([slug, name, when, what]) => `<li><span class="xd-rel-w">${when}</span><div><b>${esc(name)}</b><p>${esc(what)}</p><a href="https://xenostudio.ai/product/${slug}/releases" target="_blank" rel="noopener">Release notes</a></div></li>`).join('')}</ol>` });
  }
  // ---------- status: only what this device can actually know — never an invented "all systems normal" ----------
  function status() {
    const on = navigator.onLine;
    D().info({ title: 'Status', sub: 'This device and this workspace', html: `<dl class="xd-stat"><dt>Connection</dt><dd><i class="${on ? 'ok' : 'bad'}"></i>${on ? 'Online' : 'Offline — changes are kept on this device'}</dd><dt>Workspace</dt><dd>${esc(currentWorkspace().name)}</dd><dt>Build</dt><dd>Workspace prototype · 0.1</dd></dl><p class="xd-note">A public status page for XENO services is not live yet; when it is, this links to it.</p>` });
  }
  const article = (name) => window.open('https://xenostudio.ai/docs?q=' + encodeURIComponent(name || ''), '_blank', 'noopener');
  // credits are bought on xenostudio.ai, where the plan and payment live (Stripe Checkout behind the platform)
  const buyCredits = () => window.open('https://xenostudio.ai/pricing#credits', '_blank', 'noopener');

  // ======================= wave 2: every remaining object does its real thing =======================
  const ctxSeg = () => (X().inOv() ? 'overview' : X().S.mode);
  const undoToast = (msg, fn) => { const t = document.getElementById('toast'); t.innerHTML = `${esc(msg)} <button class="pg-undo">Undo</button>`; t.classList.add('on'); t.querySelector('.pg-undo').onclick = () => { fn(); t.classList.remove('on'); }; clearTimeout(t._pgT); t._pgT = setTimeout(() => t.classList.remove('on'), 5000); };
  const save = () => { window.XENO_DB?.save?.(); };
  const ROLES = [['admin', 'Admin', 'Manages members, billing and settings'], ['member', 'Member', 'Works in the projects they are on'], ['guest', 'Guest', 'Sees only the projects they are added to']];
  const member = (n) => W().members.find((m) => m.name === n);

  // ---- members: GET/PATCH/DELETE /api/v2/workspaces/:id/members/:memberId ----
  async function changeRole(n) {
    const m = member(n); if (!m) return;
    const v = await D().form({ title: `Change ${n}’s role`, submit: 'Change role', size: 'sm', fields: [{ id: 'role', label: 'Role', type: 'choice', cols: 1, value: m.role === 'owner' ? 'admin' : m.role, options: ROLES }] });
    if (!v || v.role === m.role) return; const was = m.role; m.role = v.role; window.XENO_WF?.decide({ kind: 'role', subject: n, what: `${n}: ${was} → ${v.role}`, supersedes: was }); save(); X().render(); undoToast(`${n} is now ${v.role === 'admin' ? 'an admin' : 'a ' + v.role}`, () => { m.role = was; save(); X().render(); });
  }
  async function removeMember(n) {
    if (window.XENO_WF) return window.XENO_WF.removeWithSettlement(n);   // revocation + settlement (WORKFORCE LIFE-02)
    const m = member(n); if (!m) return; const agent = m.kind === 'agent';
    if (!await D().confirm({ title: `Remove ${esc(n)} from the workspace?`, body: agent ? 'The agent stops working here and loses access to its projects and knowledge. Its past runs and files stay.' : `${esc(n)} loses access to the workspace. Everything they made stays, owned by the workspace.`, action: agent ? 'Remove agent' : 'Remove' })) return;
    const L = W().members, i = L.indexOf(m); L.splice(i, 1); save(); X().go('global', { global: 'workspace', item: 'Members' });
    undoToast(`Removed ${n}`, () => { L.splice(i, 0, m); save(); X().render(); });
  }
  async function assignMember(n) {
    const projects = L().filter((p) => p.status !== 'archived');
    const v = await D().form({ title: `Assign ${n}`, sub: 'The agent joins the project and can pick up its tasks.', submit: 'Assign', size: 'sm', fields: [{ id: 'p', label: 'Project', type: 'choice', cols: 1, required: true, options: projects.map((p) => [p.name, p.name, p.goal || p.mode]) }] });
    if (!v) return; const li = L().find((p) => p.name === v.p); li.members = li.members || []; if (!li.members.some((x) => (x.name || x) === n)) li.members.push({ name: n, kind: member(n)?.kind || 'agent' }); save(); X().render(); toast(`${n} is on ${v.p}`);
  }
  // ---- knowledge: PATCH/POST/DELETE /api/v2/workspaces/:id/knowledge/:sourceId ----
  const source = (n) => W().knowledge.find((k) => k.name === n);
  async function knowledgeAccess(n) {
    const k = source(n), opts = [['Everyone', 'Everyone', 'Every member and agent'], ...W().divisions.map((d) => [d.name, d.name, `Only the ${d.name} division`])];
    const v = await D().form({ title: 'Who can use this source', sub: n, submit: 'Save', size: 'sm', fields: [{ id: 'a', label: 'Access', type: 'choice', cols: 1, value: k.access, options: opts }] });
    if (!v || v.a === k.access) return; k.access = v.a; save(); X().render(); toast(`${n}: ${v.a}`);
  }
  function reindex(n) { const k = source(n); k.indexedAt = new Date().toISOString(); save(); X().render(); toast(`Re-indexed ${n}`); }
  async function removeKnowledge(n) {
    if (!await D().confirm({ title: `Remove “${esc(n)}” from knowledge?`, body: 'Agents stop reading it. The original file, folder or repository is not touched.', action: 'Remove' })) return;
    const K = W().knowledge, k = source(n), i = K.indexOf(k); K.splice(i, 1); save(); X().go('global', { global: 'workspace', item: 'Knowledge' }); undoToast(`Removed ${n} from knowledge`, () => { K.splice(i, 0, k); save(); X().render(); });
  }
  // ---- leaving: an owner must hand the workspace on first (Slack, GitHub orgs) ----
  async function leaveWorkspace() {
    const y = W().you, you = (typeof y === 'string' ? y : y?.name) || W().members.find((m) => m.kind === 'human' && m.role === (y?.role || 'owner'))?.name || 'Emilian', me = member(you), name = W().name;
    if (me && me.role === 'owner') {
      const heirs = W().members.filter((m) => m.kind === 'human' && m.name !== you && m.status !== 'invited');
      if (!heirs.length) return D().confirm({ title: 'You are the only person here', body: 'Invite someone and make them owner first, or delete the workspace from its settings.', action: 'OK', danger: false });
      const v = await D().form({ title: `Leave ${name}`, sub: 'A workspace always has an owner. Choose who takes over before you go.', submit: 'Transfer and leave', danger: true, size: 'sm', fields: [{ id: 'to', label: 'New owner', type: 'choice', cols: 1, required: true, options: heirs.map((m) => [m.name, m.name, m.title]) }] });
      if (!v) return; member(v.to).role = 'owner'; me.role = 'admin';
    } else if (!await D().confirm({ title: `Leave ${esc(name)}?`, body: 'You lose access to its projects, Library and chats. An owner can invite you back.', action: 'Leave workspace' })) return;
    const L2 = W().members; L2.splice(L2.indexOf(me), 1); save(); switchWorkspace('personal'); X().go('dashboard'); toast(`You left ${name}`);
  }
  // ---- Anima ----
  function animaChat(mind) {
    X().go('product', { product: 'chat' });
    const fill = (n = 0) => { const ta = document.querySelector('#main .live-chat textarea, #main .chat textarea'); if (!ta) return n < 20 && setTimeout(() => fill(n + 1), 60); ta.focus(); ta.value = mind ? `@${mind} ` : ''; ta.dispatchEvent(new Event('input', { bubbles: true })); };
    fill(); toast(mind ? `New chat with ${mind}` : 'New chat with Anima');
  }
  // ---- Community: POST /api/forum/threads/:id/subscribe · PATCH …/posts/:id {answer:true} ----
  const thread = (id) => window.XENO_PG_FORUM.find((t) => t.id === id);
  function followThread(id) { const s = new Set(store().get('forumSubs', []) || []); const on = !s.has(id); on ? s.add(id) : s.delete(id); store().set('forumSubs', [...s]); X().render(); toast(on ? 'Following — replies come to your inbox' : 'No longer following'); }
  function copyThreadLink(id) { window.XCM.H.copyLink(`#/${ctxSeg()}/g/community/${encodeURIComponent(id)}`); }
  function markAnswer(arg) { const [tid, pid] = arg.split('|'), t = thread(tid); t.posts.forEach((p) => { p.answer = p.id === pid; }); t.state = 'answered'; save(); X().render(); toast('Marked as the answer'); }
  // ---- Marketplace: POST /listings/:id/purchase (free) · /rent (metered) · /checkout (paid, Stripe) ----
  const listing = (id) => window.XENO_PG_MARKET.find((x) => x.id === id);
  async function getListing(id) {
    const x = listing(id); if (!x) return; const free = x.price === 'Free', rent = /Rent/.test(x.price);
    const caps = x.mode === 'agents' ? ['Read the projects you add it to', 'Use your workspace’s knowledge with your permissions', 'Spend credits per task, up to your cap'] : x.kind === 'mcp' ? ['Connect to an outside service you sign in to', 'Read and write only what that service allows'] : ['Open files you choose', 'Save results to your Library'];
    const aside = `<b class="xd-sum-h">It will be able to</b><ul class="xd-caps">${caps.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` + (rent ? '<p class="xd-note">Renting runs the agent on XENO’s side and bills each task. What it learns while working for you stays with you — its owner never sees your data.</p>' : free ? '' : '<p class="xd-note">Test checkout — this prototype charges no card. The platform hands you to Stripe Checkout here.</p>');
    const v = await D().form({ title: free ? `Add ${x.name}` : rent ? `Rent ${x.name}` : `Buy ${x.name}`, sub: `${x.seller} · ${x.price}`, submit: free ? 'Add to workspace' : rent ? 'Rent' : `Pay ${x.price.replace(/^.*?(€[\d.,]+).*$/, '$1')}`, size: 'sm', aside, fields: rent ? [{ id: 'cap', label: 'Monthly limit (credits)', type: 'number', required: true, value: '500', validate: (n) => (/^\d+$/.test(n) && +n > 0 ? null : 'Enter a whole number of credits.') }] : [] });
    if (!v) return; x.owned = true; if (rent) x.cap = +v.cap; window.XENO_MARKET?.entitle(x.id, rent ? +v.cap : 0); save(); X().render(); toast(free ? `${x.name} is in your workspace` : rent ? `Renting ${x.name} — up to ${(+v.cap).toLocaleString('en')} credits a month` : `Bought ${x.name}`);
  }
  function openListing(id) {
    window.dispatchEvent(new CustomEvent('xw:listing-opened', { detail: id }));
    const x = listing(id), PR = X().PR, prod = Object.values(PR).find((p) => p.name.toLowerCase() === x.name.toLowerCase());
    if (prod) return X().go('product', { product: prod.id });
    if (x.mode === 'agents' && (window.XENO_PG_ANIMA?.minds || []).some((m) => x.name.startsWith(m.name))) return X().go('global', { global: 'anima', item: x.name.split(' — ')[0] });
    X().go('global', { global: 'market', item: 'Purchases' });
  }
  async function newListing() {
    const v = await D().form({ title: 'Create a listing', sub: 'Listings are reviewed before they appear in the Marketplace.', submit: 'Submit for review', fields: [
      { id: 'name', label: 'Name', required: true, max: 60 }, { id: 'kind', label: 'What it is', type: 'seg', value: 'tool', options: [['tool', 'Tool'], ['panel', 'Panel'], ['agent', 'Agent'], ['blueprint', 'Blueprint'], ['mcp', 'MCP']] },
      { id: 'blurb', label: 'One line', required: true, max: 120, placeholder: 'What it does for someone' },
      { id: 'price', label: 'Price', type: 'seg', value: 'Free', options: [['Free', 'Free'], ['One-time', 'One-time'], ['Monthly', 'Monthly'], ['Per task', 'Per task']] }] });
    if (!v) return;
    const nid = 'lst_u' + Date.now(); window.XENO_PG_MARKET.push({ id: nid, name: v.name.trim(), mode: v.kind === 'agent' ? 'agents' : 'apps', kind: v.kind === 'agent' ? 'mind' : v.kind === 'panel' ? 'block' : v.kind, seller: 'You', trust: 'community', price: v.price, blurb: v.blurb, owned: false, review: 'in review', soul: v.kind === 'agent' ? { reviewed: false, items: [] } : undefined });
    save(); window.dispatchEvent(new CustomEvent('xw:listing-submitted', { detail: nid })); X().render(); toast(`“${v.name.trim()}” is submitted — you hear back after review`);
  }
  // ---- access requests: POST /api/v2/workspaces/:id/access-requests ----
  function requestAccess(fam) { const r = store().get('accessRequested', {}) || {}; r[fam] = Date.now(); store().set('accessRequested', r); X().render(); toast('Request sent — the owners get it in their inbox'); }
  // ---- projects: tasks, waiting items, chats, resources ----
  async function openTask(arg) {
    const [pn, tid] = arg.split('|'), P2 = P()[pn], t = P2?.taskObjs.find((x) => x.id === tid); if (!t) return;
    const people = W().members.filter((m) => m.status !== 'invited');
    const v = await D().form({ title: t.title, sub: pn, submit: 'Save task', fields: [
      { id: 'title', label: 'Task', required: true, value: t.title, max: 120 },
      { id: 'state', label: 'Status', type: 'seg', value: t.state, options: [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']] },
      { id: 'who', label: 'Assignee', type: 'choice', cols: 3, value: t.assignee?.name || '', options: [['', 'Unassigned', ''], ...people.map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent' : m.title])] },
      { id: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: t.notes || '' }] });
    if (!v) return; Object.assign(t, { title: v.title.trim(), state: v.state, notes: v.notes, assignee: v.who ? { name: v.who, kind: member(v.who)?.kind || 'human' } : null }); save(); refresh(); toast('Task saved');
  }
  function resolveNeed(text) {
    const N = window.XENO_NEEDS || [], i = N.findIndex((n) => n.t === text); if (i < 0) return; const [n] = N.splice(i, 1);
    save(); refresh(); undoToast(`${n.meta === 'Approve' ? 'Approved' : 'Done'} — ${n.t}`, () => { N.splice(i, 0, n); refresh(); });
  }
  function newProjectChat(pn) {
    const P2 = P()[pn]; if (P2) P2.chats.unshift(['New chat', 'Chat · just now']);
    const C = (window.XENO_CHATS_BY_CTX || {})[X().ctxKey()]; const pj = C?.projects?.find((x) => x[0] === pn); if (pj) pj[2].unshift('New chat'); else C?.projects?.push([pn, null, ['New chat']]);
    save(); X().go('product', { product: 'chat' }); toast(`New chat in ${pn}`);
  }
  function openResource(arg) {
    const [pn, name] = arg.split('|'), k = W().knowledge.find((x) => x.name === name);
    if (k) return X().go('global', { global: 'workspace', item: 'Knowledge/' + name });
    const r = (P()[pn]?.resources || []).find(([t]) => t === name) || [name, ''];
    D().info({ title: name, sub: `${pn} · ${r[1] || 'Resource'}`, html: `<dl class="xd-stat"><dt>Kind</dt><dd>${esc(r[1] || 'Resource')}</dd><dt>Project</dt><dd>${esc(pn)}</dd></dl><p class="xd-note">This resource is linked, not stored in your Library. Add it to Workspace knowledge to let agents read it.</p>` });
  }
  // ---- agent runs: POST /api/v2/runs/:id/permissions {allow} · POST /api/v2/runs/:id/retry ----
  function runRow(name) { let hit = null; Object.values(window.XENO_PG_AREAS || {}).forEach((A) => { const r = A.rows.find((rr) => rr[0] === name); if (r) hit = { A, r, i: A.cols.indexOf('Status') }; }); return hit; }
  function allowRun(name) { const h = runRow(name); if (!h) return; h.r[h.i] = 'Running'; const N = window.XENO_NEEDS || [], j = N.findIndex((n) => n.kind === 'permission' || /question/i.test(n.t)); if (j >= 0) N.splice(j, 1); save(); refresh(); toast(`Allowed — ${name} continues`); }
  function retryRun(name) { const h = runRow(name); if (!h) return; h.r[h.i] = 'Running'; save(); refresh(); toast(`Started ${name} again`); }
  // ---- the office home: an agenda event and the mail triage ----
  function openEvent(title) {
    const ev = (window.XENO_HOME?.office?.agenda || []).find((x) => x[2] === title); if (!ev) return;
    const [a, b, t, who] = ev, hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`, doc = /Docs|Slides|Sheets/.exec(who)?.[0];
    D().info({ title: t, sub: `Today · ${hm(a)}–${hm(b)}`, html: `<dl class="xd-stat"><dt>When</dt><dd>${hm(a)}–${hm(b)}</dd><dt>With</dt><dd>${esc(who)}</dd></dl>`,
      actions: [...(doc ? [{ label: `Open in ${doc}`, run: () => X().go('product', { product: doc.toLowerCase(), item: t }) }] : []), { label: 'Join call', run: () => X().go('product', { product: 'comms', item: t }) }] });
  }
  function archiveMail(subj) {
    const M2 = window.XENO_HOME?.office?.mail || [], i = M2.findIndex((m) => m[2] === subj); if (i < 0) return; const [m] = M2.splice(i, 1);
    save(); X().render(); undoToast(`Archived “${subj}”`, () => { M2.splice(i, 0, m); save(); X().render(); });
  }
  function showLog() { const l = document.querySelector('#main .pg-log'); if (!l) return; l.scrollIntoView({ behavior: 'smooth', block: 'start' }); l.classList.add('pg-flash'); setTimeout(() => l.classList.remove('pg-flash'), 1200); }

  // ---- scheduled tasks: a prompt that runs on a schedule (ChatGPT Tasks, Claude scheduled tasks) ----
  // Platform: GET/POST/PATCH/DELETE /api/v2/scheduled-tasks
  const SCHED_DEFAULT = [{ id: 's1', name: 'Weekly competitor digest', prompt: 'Summarise what changed on the five competitor sites I follow.', when: 'Mondays · 09:00', on: true }, { id: 's2', name: 'Morning brief', prompt: 'My calendar, unread mail that needs me, and anything an agent is waiting on.', when: 'Weekdays · 08:30', on: true }];
  const sched = () => store().get('scheduled', null) || SCHED_DEFAULT;
  async function newScheduled() {
    const v = await D().form({ title: 'New scheduled task', sub: 'XENO runs the prompt on schedule and sends you the result.', submit: 'Schedule', fields: [
      { id: 'name', label: 'Name', required: true, max: 60, placeholder: 'e.g. Friday wrap-up' },
      { id: 'prompt', label: 'What to do', type: 'textarea', rows: 3, required: true, placeholder: 'What should it look at, and what should it send you?' },
      { id: 'rep', label: 'Repeat', type: 'seg', value: 'Weekdays', options: [['Daily', 'Every day'], ['Weekdays', 'Weekdays'], ['Mondays', 'Weekly'], ['Once', 'Once']] },
      { id: 'at', label: 'Time', required: true, value: '09:00', validate: (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(x.trim()) ? null : 'Use 24-hour time, like 09:00.') }] });
    if (!v) return false; const L2 = sched(); L2.unshift({ id: 's' + Date.now(), name: v.name.trim(), prompt: v.prompt.trim(), when: `${v.rep} · ${v.at.trim()}`, on: true }); store().set('scheduled', L2); toast(`Scheduled “${v.name.trim()}”`); return true;
  }
  function scheduled() {
    const paint = (sh) => { const L2 = sched(), b = sh.querySelector('.xd-info');
      b.innerHTML = L2.length ? `<ul class="xd-list">${L2.map((s) => `<li${s.on ? '' : ' class="off"'}><div><b>${esc(s.name)}</b><small>${esc(s.when)}${s.on ? '' : ' · paused'}</small><p>${esc(s.prompt)}</p></div><span class="xd-list-acts"><button class="xd-btn ghost sm" data-sc-tog="${s.id}">${s.on ? 'Pause' : 'Resume'}</button><button class="xd-ib" data-sc-del="${s.id}" aria-label="Delete ${esc(s.name)}" data-tip="Delete">${X().ic('trash')}</button></span></li>`).join('')}</ul>` : '<p class="xd-note">Nothing scheduled. A scheduled task runs a prompt for you — every morning, every Friday, or once.</p>'; };
    D().info({ title: 'Scheduled', sub: 'Prompts XENO runs for you', size: 'md', html: '', actions: [{ label: 'New scheduled task', close: false, run: async () => { if (await newScheduled()) paint(document.querySelector('.xd')); } }],
      onOpen: (sh) => { paint(sh); sh.addEventListener('click', (e) => { const L2 = sched(), tg = e.target.closest('[data-sc-tog]'), dl = e.target.closest('[data-sc-del]');
        if (tg) { const s = L2.find((x) => x.id === tg.dataset.scTog); s.on = !s.on; store().set('scheduled', L2); paint(sh); toast(s.on ? `Resumed “${s.name}”` : `Paused “${s.name}”`); }
        if (dl) { const i = L2.findIndex((x) => x.id === dl.dataset.scDel), [s] = L2.splice(i, 1); store().set('scheduled', L2); paint(sh); undoToast(`Deleted “${s.name}”`, () => { const L3 = sched(); L3.splice(i, 0, s); store().set('scheduled', L3); const o = document.querySelector('.xd'); if (o) paint(o); }); } }); } });
  }
  // ---- all chats in this context, searchable (Claude's "Chats", ChatGPT's search) ----
  function allChats() {
    const C = (window.XENO_CHATS_BY_CTX || {})[X().ctxKey()] || window.XENO_CHATS, rows = [];
    (C.pinned || []).forEach((t) => rows.push([t, 'Pinned'])); (C.recents || []).forEach(([g, ts]) => ts.forEach((t) => rows.push([t, g]))); (C.projects || []).forEach(([p, , ts]) => ts.forEach((t) => rows.push([t, p])));
    const seen = new Set(), all = rows.filter(([t]) => (seen.has(t) ? false : seen.add(t)));
    const paint = (sh, q = '') => { const hit = all.filter(([t, w]) => (t + ' ' + w).toLowerCase().includes(q.toLowerCase())); sh.querySelector('.xd-chats').innerHTML = hit.map(([t, w]) => `<button class="xd-chat" data-ac="${esc(t)}"><span>${esc(t)}</span><small>${esc(w)}</small></button>`).join('') || `<p class="xd-note">No chats match “${esc(q)}”.</p>`; sh.querySelector('.xd-chats-n').textContent = `${hit.length} of ${all.length}`; };
    D().info({ title: 'Chats', sub: `In ${X().ctxName()}`, size: 'md', html: `<div class="xd-search">${X().ic('search')}<input type="search" placeholder="Search chats" aria-label="Search chats"><span class="xd-chats-n"></span></div><div class="xd-chats"></div>`,
      onOpen: (sh, api) => { paint(sh); const i = sh.querySelector('input'); setTimeout(() => i.focus(), 30); i.addEventListener('input', () => paint(sh, i.value));
        sh.addEventListener('click', (e) => { const b = e.target.closest('[data-ac]'); if (!b) return; api.close('pick'); X().go('product', { product: 'chat' }); setTimeout(() => { const r = [...document.querySelectorAll('#panel [data-chat]')].find((n) => n.dataset.chat === b.dataset.ac); if (r) r.click(); toast(`Opened “${b.dataset.ac}”`); }, 120); }); } });
  }
  const markAllRead = () => X().markAllRead?.();

  // ---- custom modes: build, edit, delete (MODES §8 — a mode manifest the person owns) ----
  async function customMode(id) {
    const C = window.XENO_CUSTOM, cur = id ? C.get(id) : null, PR = X().PR;
    const opts = window.XENO_MODES.filter((m) => !m.custom).flatMap((m) => m.sections.flatMap(([, ids]) => ids)).filter((p, i, a) => PR[p] && a.indexOf(p) === i)
      .map((p) => [p, PR[p].name, `${X().M[window.XENO_MODES.find((m) => !m.custom && m.sections.some(([, ids]) => ids.includes(p))).id].name}${PR[p].status === 'soon' ? ' · soon' : ''}`]);
    const names = () => [...window.XENO_MODES.map((m) => X().M[m.id]?.name), 'Overview', 'Adaptive'].filter(Boolean).map((n) => n.toLowerCase());
    const v = await D().form({ title: cur ? `Edit ${cur.name}` : 'New custom mode', sub: 'Pick products from any mode onto one shelf — your own sections, home and logo-cycle stop.', submit: cur ? 'Save mode' : 'Create mode', fields: [
      { id: 'name', label: 'Name', required: true, max: 40, value: cur?.name || '', placeholder: 'e.g. Video agency', validate: (x) => (x.trim().toLowerCase() !== (cur?.name || '').toLowerCase() && names().includes(x.trim().toLowerCase()) ? 'A mode with this name already exists.' : null) },
      { id: 'products', label: 'Products', type: 'checks', cols: 3, required: true, value: cur?.products || [], options: opts }] });
    if (!v) return;
    const c = { id: cur?.id || 'c-' + Date.now().toString(36), name: v.name.trim(), products: v.products };
    C.save(c); X().go('mode', { mode: c.id }); toast(cur ? `Saved ${c.name}` : `Created ${c.name} — it’s in your logo cycle`);
  }
  async function deleteCustomMode(id) {
    const c = window.XENO_CUSTOM.get(id); if (!c) return;
    if (!await D().confirm({ title: `Delete the ${esc(c.name)} mode?`, body: 'Only the mode goes — its products, files and projects stay where they are.', action: 'Delete mode' })) return;
    const S2 = X().S, wasHere = S2.mode === id; if (wasHere) S2.mode = (window.XENO_MODES.find((m) => !m.custom) || {}).id;   // never stand in a mode that no longer exists
    window.XENO_CUSTOM.remove(id); if (wasHere) X().go('dashboard'); else X().render();
    undoToast(`Deleted ${c.name}`, () => { window.XENO_CUSTOM.save(c); X().render(); });
  }
  async function adaptiveHistory() {
    const H2 = store().get('adHistory', []) || [];
    D().info({ title: 'What Adaptive changed', sub: 'Newest first — every change can be undone from the Adaptive sidebar', html: H2.length ? `<ul class="xd-list">${H2.map((h) => `<li><div><b>${esc(h.t)}</b>${h.at ? `<small>${new Date(h.at).toLocaleString('en-GB')}</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="xd-note">No changes yet.</p>' });
  }

  const plans = () => X().openUsage();
  const settings = (sec) => D().settings(sec || 'general');
  const upload = () => { const b = document.querySelector('#main [data-pg-upload]'); if (b) b.click(); else X().go('global', { global: 'library', item: null }); };
  window.XA = { scheduled, newScheduled, allChats, markAllRead, customMode, deleteCustomMode, adaptiveHistory, openEvent, archiveMail, changeRole, removeMember, assignMember, knowledgeAccess, reindex, removeKnowledge, leaveWorkspace, animaChat, followThread, copyThreadLink, markAnswer, getListing, openListing, newListing, requestAccess, openTask, resolveNeed, newProjectChat, openResource, allowRun, retryRun, showLog, report, whatsNew, status, article, buyCredits, newCompany, signOut, signOutNow, showSignedOut, workspaces, currentWorkspace, switchWorkspace, plans, settings, upload, newProject, renameProject, iconProject, archiveProject, deleteProject, projectMenu, assign, newTask, budget, invite, newThread, newMind, setCap, renameChat, deleteChat };
  // one delegated hook: any control with data-xa="<action>" [data-arg] runs the action (capture, before the shell)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xa]'); if (!b || b.closest('.xd')) return;
    const fn = window.XA[b.dataset.xa]; if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.xa === 'projectMenu') return fn(b, b.dataset.arg);
    fn(b.dataset.arg);
  }, true);
})();
