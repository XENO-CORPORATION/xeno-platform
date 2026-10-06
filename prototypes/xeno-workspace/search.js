/* XENO_SEARCH — Ctrl K finds everything, ranked (the Linear / Raycast / VS Code command-palette pattern):
 *   one index across every object the person may see — projects and tasks, files, chats, people and agents, teams,
 *   divisions, threads and tickets, listings, Minds, settings, the company page, floors — built from the SAME data the
 *   pages render, so a result can never point at something its page doesn't show.
 *   Ranking: exact > starts with > a word starts with > contains > all letters in order (fuzzy); recently opened results
 *   rise. Typing ">" switches to commands (create, report, switch workspace …). Empty query = recent searches + commands.
 * Platform: /api/v2/search?q (scoped server-side by the same access rules); recents = per-account preference
 */
(() => {
  const X = () => window.XW, A = () => window.XA, ic = (k) => X().ic(k);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const G = (global, item) => () => X().go('global', { global, item: item ?? null });
  const I = (k) => `<span class="sr-ic">${ic(k)}</span>`;

  function items() {
    const out = [], add = (k, label, sub, icon, run, kw = '') => out.push({ k, label, sub, html: I(icon), run, kw, id: k + ':' + label });
    // projects + tasks
    Object.entries(window.XENO_PROJECTS || {}).forEach(([n, p]) => { add('Projects', n, 'Project' + (p.mode ? ' · ' + p.mode : ''), 'folder', G('projects', n)); (p.taskObjs || []).forEach((t) => add('Tasks', t.title, n + (t.state ? ' · ' + t.state : ''), 'check', G('projects', n + '/Tasks'))); });
    // files
    (window.XENO_PG_LIBRARY?.items || []).filter((f) => !f.trashedAt).forEach((f) => add('Files', f.name, `${f.kind}${f.project ? ' · ' + f.project : ''}`, 'lib', G('library', f.id), f.source?.product || ''));
    // chats (every context, de-duplicated)
    const chats = new Set(); Object.values(window.XENO_CHATS_BY_CTX || {}).forEach((c) => { (c.pinned || []).forEach((t) => chats.add(t)); (c.recents || []).forEach(([, l]) => l.forEach((t) => chats.add(t))); (c.projects || []).forEach(([, , l]) => (l || []).forEach((t) => chats.add(t))); });
    chats.forEach((t) => add('Chats', t, 'Chat', 'chat', () => X().go('product', { product: 'chat', item: t })));
    // people, agents, teams, divisions
    (window.XENO_PG_WORKSPACE?.members || []).filter((m) => m.status !== 'departed').forEach((m) => add(m.kind === 'agent' ? 'Agents' : 'People', m.name, m.title || (m.kind === 'agent' ? 'Agent' : 'Member'), m.kind === 'agent' ? 'bot' : 'user', G('workspace', (m.kind === 'agent' ? 'Agents/' : 'Members/') + m.name)));
    (window.XENO_WF?.st().teams || []).filter((t) => !t.archived).forEach((t) => add('Teams', t.name, `${t.members.length} members`, 'community', G('workspace', 'Teams/' + t.name)));
    (window.XENO_WF?.divs() || []).forEach((d) => add('Divisions', d.name, 'Division', 'layers', G('workspace', 'Divisions/' + d.name)));
    // community
    (window.XENO_PG_FORUM || []).forEach((t) => add('Threads', t.title, `${t.space} · ${t.state}`, 'community', G('community', t.id)));
    (window.XENO_COMM?.tickets() || []).forEach((t) => add('Your reports', `#${t.n} · ${t.title}`, `Private ticket · ${t.state}`, 'edit', G('community', 'My reports/' + t.n), String(t.n)));
    // marketplace
    (window.XENO_PG_MARKET || []).forEach((x) => add('Marketplace', x.name, `${x.seller} · ${x.price}`, x.mode === 'agents' ? 'bot' : 'market', G('market', x.name), x.kind));
    // anima
    (window.XENO_PG_ANIMA?.minds || []).forEach((m) => { add('Minds', m.name, m.role, 'anima', G('anima', m.name + ' — ' + m.role.toLowerCase())); (m.memories || []).forEach((r) => add('Memories', r.t, `${m.name} remembers`, 'anima', G('anima', m.name + ' — ' + m.role.toLowerCase() + '/Soul'))); });
    // settings — every section, with the words people use for it
    const SK = { profile: 'name photo avatar email', security: 'password two-factor 2fa passkey mfa', sessions: 'devices sign out logged in', apps: 'google github sign-in methods', keys: 'api token developer', providers: 'byok openai anthropic own key inference', plan: 'billing subscription upgrade invoice pay', usage: 'credits limits spend', gifts: 'gift credits', general: 'language start page', appearance: 'theme dark light density', notifications: 'email push alerts', modes: 'hide reorder custom', keyboard: 'shortcuts keys', region: 'language timezone date format', data: 'export download privacy', danger: 'delete account close', workspace: 'workspace name members', connections: 'integrations connected accounts slack' };
    (window.XENO_SETTINGS?.sections() || []).forEach((id) => { add('Settings', ({ profile: 'Profile', security: 'Sign-in & security', sessions: 'Sessions & devices', apps: 'Apps & sign-in methods', keys: 'API keys', providers: 'Provider keys & inference', plan: 'Plan & billing', usage: 'Usage & limits', gifts: 'Gifts', general: 'General', appearance: 'Appearance', notifications: 'Notifications', modes: 'Modes', keyboard: 'Keyboard', region: 'Language & region', data: 'Your data', danger: 'Delete account', workspace: 'Workspace', connections: 'Connections' })[id] || id, 'Settings', 'gear', () => window.XENO_SETTINGS.open(id), SK[id] || ''); });
    // places + company
    add('Pages', 'Company', 'Legal entity, wallet, seats, staff', 'building', G('workspace', 'Company'), 'wallet vat registration legal tax');
    add('Pages', 'Places', 'Your workspace as a building', 'places', G('places'), 'building floors office');
    (window.XENO_PLACES ? (window.XENO_WF?.divs() || []) : []).forEach((d) => add('Floors', d.name, 'Floor in Places', 'places', G('places', d.name)));
    return out;
  }
  const COMMANDS = () => [
    ['New project', 'folder', () => A().newProject()], ['New thread', 'community', () => A().newThread()], ['Report a problem', 'edit', () => A().report()], ['Suggest a feature', 'megaphone', () => A().report({ kind: 'feature' })],
    ['Invite people or agents', 'user', () => A().invite()], ['New Mind', 'anima', () => A().newMind()], ['Create a listing', 'market', () => A().newListing()], ['Create a company', 'building', () => A().newCompany()],
    ['Upload a file', 'upload', () => A().upload()], ['Open settings', 'gear', () => window.XENO_SETTINGS.open('profile')], ['Keyboard shortcuts', 'terminal', () => X().openShortcuts()],
    ...A().workspaces().filter((w) => w.id !== A().currentWorkspace().id).map((w) => [`Switch to ${w.name}`, 'building', () => A().switchWorkspace(w.id)]),
  ].map(([label, icon, run]) => ({ k: 'Commands', label, sub: 'Command', html: I(icon), run, id: 'cmd:' + label }));

  // ---------- ranking ----------
  const ws = (t, q) => String(t).toLowerCase().split(/[\s—\-/·,]+/).some((w) => w.startsWith(q));
  function score(x, q) {
    const l = x.label.toLowerCase();
    let s = l === q ? 100 : l.startsWith(q) ? 80 : l.split(/[\s—\-/·]+/).some((w) => w.startsWith(q)) ? 60 : l.includes(q) ? 45 : ws(x.kw || '', q) ? 40 : ws(x.sub, q) ? 25 : 0;
    if (!s) { let i = 0; for (const c of l) if (c === q[i]) i++; if (i === q.length && q.length > 2) s = 15; }
    if (!s) return 0;
    const recent = LS.get('searchOpened', []).indexOf(x.id); if (recent >= 0) s += 12 - Math.min(10, recent);
    return s;
  }
  function rank(base, raw) {
    const qq = String(raw || '').trim().toLowerCase();
    if (qq.startsWith('>')) { const q = qq.slice(1).trim(); return COMMANDS().filter((c) => !q || score(c, q)).sort((a, b) => score(b, q) - score(a, q)).slice(0, 14); }
    if (!qq) { const opened = LS.get('searchOpened', []), all = [...base, ...items()]; const rec = opened.map((id) => all.find((x) => x.id === id || x.k + ':' + x.label === id)).filter(Boolean).slice(0, 6).map((x) => ({ ...x, k: 'Recent' })); return [...rec, ...base.filter((x) => x.k === 'Modes'), ...COMMANDS().slice(0, 4)].slice(0, 14); }
    const all = [...base, ...items()].map((x) => ({ x, s: score(x, qq) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
    // group by kind in order of each kind's best hit, at most 4 per kind so one kind can't crowd out the rest
    const order = [], per = {}; all.forEach(({ x }) => { if (!per[x.k]) { per[x.k] = []; order.push(x.k); } if (per[x.k].length < 4) per[x.k].push(x); });
    return order.flatMap((k) => per[k]).slice(0, 18);
  }
  function opened(x) { if (!x || x.k === 'Commands') return; const id = x.id || x.k + ':' + x.label; const L = LS.get('searchOpened', []).filter((y) => y !== id); L.unshift(id); LS.set('searchOpened', L.slice(0, 20)); }
  window.XENO_SEARCH = { rank, opened, items };
})();
