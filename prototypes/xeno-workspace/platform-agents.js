/* platform-agents.js — on the platform, the workspace's Agents pages are the person's REAL agents (XENO-WORKFORCE-01
 * OWN-01/02: one owner, an identity separate from its versions and its runtime).
 *
 *   Agents        /workspace/workspace/Agents              every agent you own: who it is, where it works, where it runs
 *   an agent      /workspace/workspace/Agents/<agt_…>      by its stable id, never its name (a rename keeps every link)
 *
 * An agent is an identity in XENO. It does the work it is given (projects today; more services as they join XENO
 * MCP) from wherever it RUNS: any agent CLI on a computer — Claude Code, Codex, the XENO CLI, a Spawn profile —
 * signed in with one of its credentials. Everything it does is shown as the agent's, under your account.
 *
 *   GET|POST /api/agents · GET|PATCH|DELETE /api/agents/:id · POST|DELETE /api/agents/:id/credentials[/:cid]
 *   PUT|DELETE /api/agents/:id/projects/:pid · GET /api/tasks/projects · GET /api/mcp/services
 *
 * Served from disk (no platform), the sample pages in resources.js stay as they are.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_AGENTS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k);
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.error || r.d.message)) || d;
  const ID = /^agt_[0-9a-f]{32}$/;
  const ENDPOINT = () => `${location.origin}/api/mcp`;
  // SCOPE: the workspace selected in the switcher. Its agents are listed and new ones are made in it — a company's
  // agents are the company's (XENO-WORKFORCE-01 OWN-01, VIEW-02); the personal workspace lists the person's own
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served && window.XENO_SCOPE.uuid && window.XENO_SCOPE.uuid()) || null;
  const wsQ = () => { const w = wsId(); return w ? `?workspace=${encodeURIComponent(w)}` : ''; };
  const S = { key: null, status: 'idle', list: [], presence: {}, livePushed: new Set(), activity: null, one: null, projects: [], services: [], minted: null, busy: false, copied: '', tab: 'claude', spawnProg: 'claude', q: '', choices: [], divisions: [], canManageDivisions: false, editingInstr: false, offers: [], models: [], runs: [], runsFor: null, moves: [], access: null, transfers: [], members: [], atab: '', ov: null, watch: false, actKind: 'all', place: 'cli' };
  // ONE Spawn version for every Spawn mention on the page: the release that carries both `spawn <program> --agent` and
  // the `spawn open-link` handler behind the Open in Spawn link.
  const SPAWN_AGENT_FLAG_RELEASE = '0.1.0-rc.42';
  // the Open in Spawn link (shape agreed with Spawn 2026-10-15). The link carries no credential: Spawn binds with the
  // person's own signed-in session after they confirm. Spawn accepts only these two issuers, so a dev/staging origin
  // shows the command alone rather than a link Spawn would refuse. (The browser test names its own origin through
  // XENO_SPAWN_TEST_ISSUER so it can render the link; Spawn itself still refuses any other issuer.)
  const SPAWN_ISSUERS = ['https://xenosystem.ai', 'https://xenostudio.ai', ...(globalThis.XENO_SPAWN_TEST_ISSUER ? [String(globalThis.XENO_SPAWN_TEST_ISSUER)] : [])];
  const spawnLink = (agentId, program) => (SPAWN_ISSUERS.includes(location.origin) && /^agt_[0-9a-f]{32}$/.test(String(agentId))
    ? `xeno-spawn://bind?agent=${agentId}&issuer=${encodeURIComponent(location.origin)}${program ? `&program=${program}` : ''}` : null);
  // Spawn's own CLI (xeno-spawn server/src/profilesCli.js, agentCli.js): bind once, then start by profile. Bind names the
  // profile after the agent with this exact cleanup (agentBinding.js), so `<program>/<name>` names it unambiguously.
  const SPAWN_PROGRAMS = { claude: 'Claude Code', codex: 'Codex' };
  const spawnProfileName = (a) => (String(a.name || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 48) || `xeno-agent-${String(a.id).slice(4, 12)}`);
  // One line launches it as that identity (first run binds after asking, later runs reuse the profile). Needs
  // SPAWN_AGENT_FLAG_RELEASE; bind-only stays as the secondary line.
  const spawnCommands = (a, prog) => ({
    launch: `spawn ${prog} --agent ${a.id}`,
    bind: `spawn profiles bind ${a.id} --agent ${prog}`,
  });
  const EFFORTS = ['minimal', 'low', 'medium', 'high', 'max'];
  const EFFORT_LABEL = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };
  const rtSet = (rt) => !!(rt && (rt.model || rt.effort || (rt.tools && ((rt.tools.allow || []).length || (rt.tools.deny || []).length))));
  // the sidebar is derived data (pages-data.js XENO_PG_SYNC_NAV): re-derive it before drawing, or it shows the last list
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const toast = (m) => X()?.toast?.(m);

  const ago = (iso) => {
    if (!iso) return 'Never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? 'Just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  };
  const until = (iso) => {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (s <= 0) return 'Expired';
    return s < 3600 ? `${Math.max(1, Math.floor(s / 60))} min left` : s < 86400 ? `${Math.floor(s / 3600)} h left` : `${Math.floor(s / 86400)} days left`;
  };
  /** live (used in the last 5 minutes) · ready (has a credential) · new (never connected) */
  // the server's presence (agentPresence.js) — derived from runs, credentials and calls, never guessed here
  // one mark per real state (agentPresence.js): green working (it blinks) · green online · yellow idle/asking · red error · white cloud-ready · grey offline · outline new/paused
  const PRES_DOT = { working: 'working', online: 'online', asking: 'asking', error: 'error', cloud: 'ready', offline: 'idle', new: 'new', paused: 'off' };
  const state = (a) => {
    const pr = S.presence[a.id];
    // `cloud` is a CAPABILITY (the person could start a cloud run), not something that happened: with no seenAt it has
    // never run, and that is what it says
    if (pr) return [PRES_DOT[pr.state] || 'idle', pr.state === 'cloud' && !pr.seenAt ? 'Never run' : pr.label, pr];
    if (a.paused === 'needs_owner') return ['off', 'Paused — needs an owner'];
    const last = (a.connections || []).map((c) => c.lastUsedAt).filter(Boolean).sort().pop();
    if (last && Date.now() - new Date(last).getTime() < 5 * 60e3) return ['working', 'Working now'];
    if (last) return ['idle', `Last worked ${ago(last).toLowerCase()}`];
    if ((a.credentials || []).length) return ['ready', 'Ready to connect'];
    return ['new', 'Not connected yet'];
  };
  const mono = (name) => esc(String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());

  async function load() {
    const at = S.key;
    const [list, pr, sv] = await Promise.all([api('GET', '/api/agents' + wsQ()), api('GET', '/api/tasks/projects'),
      S.services.length ? null : api('GET', '/api/mcp/services')]);
    if (S.key !== at) return;
    if (!list.ok) { S.status = list.status === 403 ? 'denied' : 'error'; return paint(); }
    S.list = list.d.agents || []; S.sideWs = wsId() || ''; S.projects = pr.ok ? pr.d.projects || [] : [];
    loadPresence();
    if (!S.models.length) api('GET', '/api/models').then((m) => { if (m.ok && m.d) { const g = m.d.companies || m.d.models || m.d; const ids = []; for (const v of Object.values(g || {})) if (Array.isArray(v)) for (const x of v) if (x && x.id) ids.push(x.id); S.models = ids; } }).catch(() => {});
    const dv0 = await api('GET', '/api/divisions'); if (dv0.ok) { S.divisions = dv0.d.divisions || []; S.canManageDivisions = !!dv0.d.canManage; }
    const ib = await api('GET', '/api/agents/lends/inbox'); S.offers = ib.ok ? ib.d.offers || [] : [];
    const mv = await api('GET', '/api/agents/transfers/inbox'); S.moves = mv.ok ? mv.d.transfers || [] : [];
    if (sv && sv.ok) S.services = sv.d.services || [];
    const id = at.startsWith('one:') ? at.slice(4).split('@')[0] : null;
    if (id) {
      const one = await api('GET', `/api/agents/${id}`);
      if (S.key !== at) return;
      if (one.status === 404) { S.status = 'missing'; return paint(); }
      if (!one.ok) { S.status = 'error'; return paint(); }
      S.one = one.d.agent;
      const [ch, dv] = await Promise.all([api('GET', `/api/agents/${id}/project-choices`), api('GET', '/api/divisions' + (S.one.workspace ? `?workspace=${S.one.workspace.id}` : ''))]);
      if (S.key !== at) return;
      S.choices = ch.ok ? ch.d.projects || [] : []; S.divisions = dv.ok ? dv.d.divisions || [] : []; S.canManageDivisions = !!(dv.ok && dv.d.canManage);
      loadRuns(id); loadAccess(id); loadActivity(id); loadOverview(id); if (S.atab === 'Identity') loadBrief(id);
    }
    S.status = 'ready'; paint();
  }
  // Watch: its latest XENO tool calls, one by one (the Activity list folds them into sittings)
  async function loadTrace(id) {
    const r = await api('GET', `/api/agents/${id}/activity?limit=30`);
    if (!S.one || S.one.id !== id) return;
    S.trace = { id, items: r.ok ? r.d.items || [] : [] }; paint();
  }
  // the Overview's one read (agentOverview.js); refreshed when its presence changes and every 20 s while it is shown
  let ovTimer = null;
  async function loadOverview(id) {
    const r = await api('GET', `/api/agents/${id}/overview`);
    if (!S.one || S.one.id !== id) return;
    if (r.ok) { S.ov = r.d; paint(); }
    if (S.watch) loadTrace(id);
    clearTimeout(ovTimer);
    ovTimer = setTimeout(() => { if (S.one && S.one.id === id && document.visibilityState === 'visible' && document.querySelector('.xag-one')) loadOverview(id); }, 20_000);
  }
  async function loadPresence() {
    const r = await api('GET', '/api/agents/presence');
    // the live stream is fresher than this one-off answer: never let an older read overwrite what it pushed
    if (r.ok) { for (const x of r.d.agents || []) if (!S.livePushed.has(x.id)) S.presence[x.id] = x; paint(); }
  }
  async function loadActivity(id, more = false) {
    const before = more && S.activity && S.activity.next ? '&before=' + encodeURIComponent(S.activity.next) : '';
    const r = await api('GET', `/api/agents/${id}/activity?grouped=1&limit=60${before}`);
    if (!S.one || S.one.id !== id) return;
    if (!r.ok) { S.activity = { error: true, items: [] }; return paint(); }
    S.activity = { items: [...(more && S.activity ? S.activity.items : []), ...(r.d.items || [])], next: r.d.next };
    if (r.d.presence && !S.livePushed.has(id)) S.presence[id] = { ...(S.presence[id] || {}), ...r.d.presence };
    paint();
  }
  // ownership: who owns it, who answers for it, who may do what (agentAccess.js)
  async function loadAccess(id) {
    const a = S.one; S.access = null; S.transfers = []; S.members = [];
    if (!a || !a.rights || !a.rights.manage) return;
    const [ac, tr] = await Promise.all([api('GET', `/api/agents/${id}/access`), api('GET', `/api/agents/${id}/transfers`)]);
    if (!S.one || S.one.id !== id) return;
    S.access = ac.ok ? ac.d.access : null; S.transfers = tr.ok ? tr.d.transfers || [] : [];
    if (a.owner && a.owner.kind === 'company') { const m = await api('GET', `/api/workspaces/${a.owner.workspaceId}/members`); S.members = m.ok ? (m.d.members || []) : []; }
    paint();
  }
  const memberId = (m) => String(m.user_id || m.userId || m.id);
  const memberName = (m) => m.display_name || m.displayName || m.username || 'Member';
  // every move and takeover asks the browser to confirm it is you first (account confirmation, 10 minutes)
  const sure = (why) => (window.XENO_ACCOUNT && window.XENO_ACCOUNT.confirm ? window.XENO_ACCOUNT.confirm(why) : Promise.resolve(true));
  async function moveTo() {
    const a = S.one; if (!a) return;
    const ws = await api('GET', '/api/workspaces');
    const opts = ((ws.ok && ws.d.workspaces) || []).filter((w) => w.workspace_type !== 'personal' && String(w.id) !== (a.owner && a.owner.workspaceId)).map((w) => [String(w.id), w.name, 'Its admins decide whether to take it']);
    if (!opts.length) return toast('You are in no other company workspace to move it to');
    const v = await D().form({ title: `Move ${a.name} to a company`, sub: 'The company will own it, and it outlives whoever made it. Its admins see everything it uses before they accept. Until then nothing changes.', submit: 'Offer it', size: 'sm', fields: [
      { id: 'ws', label: 'To', type: 'choice', cols: 1, required: true, options: opts }] });
    if (!v) return;
    if (!await sure(`Moving ${a.name} gives it to a company.`)) return;
    const r = await call('POST', `/api/agents/${a.id}/transfers`, { workspaceId: v.ws }, 'It could not be offered.');
    if (r) { toast('Offered. Its admins decide.'); loadAccess(a.id); }
  }
  async function takeOver(toUserId) {
    const a = S.one; if (!a) return;
    const who = toUserId ? S.members.find((m) => memberId(m) === toUserId) : null;
    const v = await D().form({ title: toUserId ? `Hand ${a.name} to ${who ? memberName(who) : 'them'}` : `Take over ${a.name}`, sub: toUserId ? 'They answer for what it does from now on.' : 'You answer for what it does from now on, and it works again at once with the same credentials.', submit: toUserId ? 'Hand over' : 'Take over', size: 'sm', fields: [
      { id: 'note', label: 'Why (kept in its history)', type: 'textarea', max: 1000, placeholder: toUserId ? 'Moving to the platform team' : 'The previous owner left' }] });
    if (!v) return;
    if (!await sure('This changes who answers for an agent.')) return;
    const r = await call('POST', `/api/agents/${a.id}/accountable`, { userId: toUserId || undefined, note: v.note || undefined }, 'That could not be done.');
    if (r) { const one = await api('GET', `/api/agents/${a.id}`); if (one.ok) S.one = one.d.agent; toast(toUserId ? 'Handed over' : `You now answer for ${a.name}`); loadAccess(a.id); }
  }
  async function handOver() {
    const ms = S.members.filter((m) => ['owner', 'admin'].includes(m.role) && memberId(m) !== (S.one.accountable && S.one.accountable.userId));
    if (!ms.length) return toast('There is no other admin to hand it to');
    const v = await D().form({ title: 'Hand over to', submit: 'Next', size: 'sm', fields: [{ id: 'who', label: 'Admin', type: 'choice', cols: 1, required: true, options: ms.map((m) => [memberId(m), memberName(m), m.role]) }] });
    if (v) takeOver(v.who);
  }
  async function grant() {
    const a = S.one; if (!a) return;
    const have = new Set((S.access ? S.access.people : []).map((p) => p.userId));
    const people = S.members.filter((m) => !['owner', 'admin'].includes(m.role) && !have.has(memberId(m))).map((m) => [memberId(m), memberName(m), m.role || '']);
    if (!people.length) return toast('Every member already has access, or administers the workspace');
    const v = await D().form({ title: `Give someone access to ${a.name}`, sub: 'Admins of the workspace always have every right.', submit: 'Give access', size: 'sm', fields: [
      { id: 'who', label: 'Person', type: 'choice', cols: 1, required: true, options: people },
      { id: 'right', label: 'They can', type: 'choice', cols: 1, required: true, value: 'viewer', options: RIGHT_OPTS }] });
    if (!v) return;
    const r = await call('PUT', `/api/agents/${a.id}/access/${v.who}/${v.right}`, undefined, 'Access could not be given.');
    if (r) { S.access = r.d.access; paint(); }
  }
  async function ungrant(userId, right) {
    const a = S.one; if (!a) return;
    const r = await call('DELETE', `/api/agents/${a.id}/access/${userId}/${right}`, undefined, 'Access could not be removed.');
    if (r) { S.access = r.d.access; paint(); }
  }
  async function decideMove(id, accept) {
    const m = (S.moves || []).find((x) => x.id === id); if (!m) return;
    if (!accept) { const r = await call('POST', `/api/agents/transfers/${id}/decline`, { reason: 'Declined' }, 'It could not be declined.'); if (r) { S.moves = S.moves.filter((x) => x.id !== id); toast('Declined'); paint(); } return; }
    const sub = await api('GET', `/api/agents/transfers/${id}/review-subject`);
    if (!sub.ok) return toast(why(sub, 'Its contents could not be read.'));
    const x = sub.d.subject, list = (k) => (x[k] || []).map((y) => typeof y === 'string' ? y : (y.name || y.ref || y.id || 'unnamed'));
    const used = [...list('secretReferences').map((y) => 'secret ' + y), ...list('licenses').map((y) => 'licence ' + y)];
    const v = await D().form({ title: `Take ${m.agent.name} into ${m.toName}`, sub: `${m.fromName || 'Its owner'} is offering it. ${used.length ? 'It uses: ' + used.join(', ') + '.' : 'It uses no secrets or licensed parts.'} Accepting makes ${m.toName} its owner and you the person who answers for it.`, submit: 'Accept', size: 'sm', fields: [
      { id: 'why', label: 'Why (kept in its history)', type: 'textarea', required: true, max: 1000, placeholder: 'We run this agent now' }] });
    if (!v) return;
    if (!await sure(`Accepting makes you answer for ${m.agent.name}.`)) return;
    if (m.state === 'authorized') {
      const rv = await call('POST', `/api/agents/transfers/${id}/review`, { agentVersion: x.agentVersion, review: { schemaVersion: 1, secretReferences: x.secretReferences, licenses: x.licenses, dependencies: [], verdict: 'clear' } }, 'The review could not be saved.');
      if (!rv) return;
    }
    const r = await call('POST', `/api/agents/transfers/${id}/accept`, { rationale: v.why }, 'It could not be accepted.');
    if (r) { S.moves = S.moves.filter((y) => y.id !== id); toast(`${m.agent.name} now belongs to ${m.toName}`); go(`Agents/${m.agent.id}`); }
  }
  const RIGHT_OPTS = [['viewer', 'See it', 'Its instructions, runs and activity'], ['runner', 'Run it', 'Make credentials and start cloud runs'], ['editor', 'Change it', 'Edit its instructions and how it runs'], ['exporter', 'Export it', 'Take its definition out. Never implied by the others']];
  const RIGHT_LABEL = { viewer: 'See', runner: 'Run', editor: 'Change', exporter: 'Export' };
  const MOVE_STATE = { proposed: 'Move proposed', authorized: 'Offered to its new owner', reviewed: 'Reviewed, waiting to be accepted', accepted: 'Moved', declined: 'Move declined', cancelled: 'Move cancelled', expired: 'Move expired' };
  const REASON = { transfer: 'moved to them', takeover: 'took it over', handover: 'handed to them' };

  // cloud runs: listed with the agent, refreshed every few seconds while one is live
  const LIVE_RUN = new Set(['starting', 'queued', 'running']);
  let runTimer = null;
  async function loadRuns(id) {
    const r = await api('GET', `/api/agents/${id}/runs`);
    if (!S.one || S.one.id !== id) return;
    S.runs = r.ok ? r.d.runs || [] : []; S.runsFor = id;
    clearTimeout(runTimer);
    if (S.runs.some((x) => LIVE_RUN.has(x.state))) runTimer = setTimeout(() => { if (S.one && S.one.id === id && document.querySelector('.xag-one')) loadRuns(id); }, 4000);
    paint();
  }
  const RUN_STATE = { starting: 'Starting', queued: 'Queued', running: 'Running', completed: 'Finished', failed: 'Failed', cancelled: 'Stopped', refused: 'Not started', uncertain: 'Unclear' };
  const RUN_REASON = {
    budget_exceeded: 'It used its whole budget', insufficient_credits: 'Not enough credits', stopped_by_owner: 'You stopped it',
    runner_lacks_agents: 'The cloud runner cannot run agents yet', transport_error: 'The cloud runner could not be reached',
    platform_agent_unavailable: 'It could not sign in as the agent',
  };
  const runReason = (r) => { if (!r.reason || r.state === 'completed') return ''; const k = Object.keys(RUN_REASON).find((x) => r.reason.includes(x)); return k ? RUN_REASON[k] : r.reason.slice(0, 120); };
  async function startRun(a) {
    const open = (await api('GET', `/api/tasks?status=raised,todo,in_progress,blocked`)).d;
    const mine = new Set(a.projects.map((p) => p.id));
    const tasks = ((open && open.tasks) || []).filter((t) => !t.project || mine.has(t.project.id)).slice(0, 40);
    if (!tasks.length) return toast(a.projects.length ? 'No open tasks in its projects' : `Give ${a.name} a project first, then run it on one of its tasks`);
    const v = await D().form({ title: `Run ${a.name} in the cloud`, sub: `It takes the task, works on it as ${a.name}, and sends it for review. You pay for what it uses, up to the budget.`, submit: 'Run', size: 'sm', fields: [
      { id: 'task', label: 'Task', type: 'choice', cols: 1, required: true, value: tasks[0].key, options: tasks.map((t) => [t.key, `${t.key} ${t.title}`, t.project ? t.project.name : '']) },
      { id: 'budget', label: 'Budget (credits)', value: '50', max: 4, hint: 'It stops when it has used this much. Up to 200.' }] });
    if (!v) return;
    const r = await call('POST', `/api/agents/${a.id}/runs`, { task: v.task, budgetCredits: Number(v.budget) || 50 }, 'It could not be started.');
    if (!r) return;
    toast(r.d.run.existing ? `${a.name} is already running on ${v.task}` : r.d.run.state === 'refused' || r.d.run.state === 'uncertain' ? `Not started: ${runReason(r.d.run) || r.d.run.state}` : `${a.name} is working on ${v.task}`);
    loadRuns(a.id);
  }
  async function stopRun(id) {
    const r = await call('POST', `/api/agents/runs/${id}/stop`, {}, 'It could not be stopped.');
    if (r && S.one) { toast('Stopped'); loadRuns(S.one.id); }
  }

  const refreshOne = async () => { if (!S.one) return; const r = await api('GET', `/api/agents/${S.one.id}`); if (r.ok) { S.one = r.d.agent; const i = S.list.findIndex((x) => x.id === S.one.id); if (i >= 0) S.list[i] = S.one; } };

  // ───────────────────────── the list
  function listPage() {
    const h = H(), q = S.q.toLowerCase();
    const rows = S.list.filter((a) => !q || a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
    const live = S.list.filter((a) => state(a)[0] === 'working').length;
    const sub = S.list.length ? `${h.plural(S.list.length, 'agent', 'agents')} you own${live ? ` · ${live} working now` : ''}` : 'Agents you create work as themselves, from any computer, on what you give them.';
    const card = (a) => { const [k, l] = state(a);
      return `<button type="button" class="xag-card" data-xag="open" data-id="${esc(a.id)}">
        <span class="xag-mono" aria-hidden="true">${mono(a.name)}<i class="xag-dot xag-dot--${k}"></i></span>
        <span class="xag-card-b"><b>${esc(a.name)}</b><small>${esc(a.description || 'No description yet')}</small>${a.division ? `<em class="xag-div">${esc(a.division.name)}</em>` : ''}</span>
        <span class="xag-card-f"><span>${a.projects.length ? esc(a.projects.slice(0, 2).map((p) => p.name).join(', ')) + (a.projects.length > 2 ? ` +${a.projects.length - 2}` : '') : 'No projects yet'}</span><span class="xag-st xag-st--${k}">${esc(l)}</span></span></button>`; };
    const offers = (S.offers.length ? `<section class="xag-offers" aria-label="Agents offered to you"><h3>${h.plural(S.offers.length, 'agent offered', 'agents offered')} to your workspaces</h3>${S.offers.map((o) => `<div class="xag-row"><span class="xag-row-ic">${ic('bot')}</span><span class="xag-row-b"><b>${esc(o.agent ? o.agent.name : 'An agent')}</b><small>${esc(o.from)} offers it to ${esc(o.division ? o.division.name + ' in ' + o.workspace.name : o.workspace.name)}. It keeps its owner and who pays; it works on what you give it there.</small></span><button type="button" class="pg-btn ghost" data-xag="decline" data-id="${esc(o.id)}">Decline</button><button type="button" class="pg-btn" data-xag="accept" data-id="${esc(o.id)}">Accept</button></div>`).join('')}</section>` : '')
      + (S.moves.length ? `<section class="xag-offers" aria-label="Agents being moved to you"><h3>${h.plural(S.moves.length, 'agent', 'agents')} offered to become yours</h3>${S.moves.map((m) => `<div class="xag-row"><span class="xag-row-ic">${ic('building')}</span><span class="xag-row-b"><b>${esc(m.agent.name)}</b><small>${esc(m.fromName || 'Someone')} wants ${esc(m.toName)} to own it. You see everything it uses before you accept, and you will answer for it.</small></span><button type="button" class="pg-btn ghost" data-xag="move-decline" data-id="${esc(m.id)}">Decline</button><button type="button" class="pg-btn" data-xag="move-accept" data-id="${esc(m.id)}">Review</button></div>`).join('')}</section>` : '');
    const body = !S.list.length ? `<div class="xag-first">
        <div class="xag-first-art" aria-hidden="true"><span>${ic('bot')}</span><i></i><span>${ic('folder')}</span><i></i><span>${ic('terminal')}</span></div>
        <h2>Give work to an agent that is really yours</h2>
        <p>An agent has its own name and its own place in XENO. You decide which projects it works on. Then any agent CLI on any computer — Claude Code, Codex, the XENO CLI, a Spawn profile — signs in as it and starts working. Everything it does is shown as the agent's.</p>
        <ol class="xag-steps"><li><b>Create it</b><span>Name it and say what it is for</span></li><li><b>Give it work</b><span>Pick the projects it may work in</span></li><li><b>Run it anywhere</b><span>Connect a CLI with one credential</span></li></ol>
        ${h.btn('Create your first agent', 'data-xag="new"', false, 'plus')}</div>`
      : `<div class="pg-bar"><label class="pg-search">${ic('search')}<input data-xag-q value="${esc(S.q)}" placeholder="Search your agents" aria-label="Search your agents"></label></div>`
        + (rows.length ? `<div class="xag-grid">${rows.map(card).join('')}</div>` : h.box('search', `No agent matches “${esc(S.q)}”`, 'Try a shorter word.', h.btn('Clear search', 'data-xag="clearq"', true)));
    return h.page(h.head({ title: 'Agents', sub, acts: S.list.length ? h.btn('New agent', 'data-xag="new"', false, 'plus') : '' }) + offers + body, 'xag');
  }

  // ───────────────────────── one agent
  const setups = (tok) => {
    const t = tok || '<credential>';
    return {
      claude: { label: 'Claude Code', cmd: `claude mcp add --transport http xeno ${ENDPOINT()} --header "Authorization: Bearer ${t}"` },
      codex: { label: 'Codex', cmd: `export XENO_AGENT_TOKEN=${t}\ncodex mcp add xeno --url ${ENDPOINT()} --bearer-token-env-var XENO_AGENT_TOKEN` },
      xeno: { label: 'XENO CLI', cmd: `xeno mcp add xeno --http ${ENDPOINT()} --header "Authorization: Bearer ${t}"` },
      spawn: { label: 'Spawn', cmd: `spawn profiles bind ${S.one ? S.one.id : '<agent id>'}` },
      other: { label: 'Any MCP client', cmd: JSON.stringify({ mcpServers: { xeno: { url: ENDPOINT(), headers: { Authorization: `Bearer ${t}` } } } }, null, 2) },
    };
  };
  const copyBtn = (text, label = 'Copy') => `<button type="button" class="xag-copy" data-xag="copy" data-copy="${esc(text)}">${ic(S.copied === text ? 'check' : 'copy')}<span>${S.copied === text ? 'Copied' : label}</span></button>`;

  const ACT_IC = { task: 'check', call: 'plug', run: 'refresh' };
  const TASK_WHAT = { created: 'raised', status: 'moved', comment: 'commented on', activity: 'reported on', claimed: 'took', delegated: 'was handed', linked: 'linked' };
  /** One agent's page (redesign, owner 2026-10-24; design: claude.ai artifact "Agent page redesign"). The workspace
   * shell stays as it is; the right side is a header with the agent, header tabs with their own addresses
   * (Agents/<id>[/Work|Activity|Connect|Settings|Access]) and "Hand it a task" on the right. Every value on it comes
   * from the server (GET /api/agents/:id/overview and the agent itself) — nothing is estimated here.
   * States, each walked by tests/agents-test.mjs:
   *   new          — never connected and never run: Overview is three steps (projects · where it runs · a task)
   *   working      — "Right now": the task it is on and the note it last reported; Watch shows its XENO tool calls
   *   asking       — its question is first in "Needs you", with Answer
   *   offline      — "Last seen <when> · work handed to it waits until it connects"
   *   suspended    — paused/needs_owner: the pause notice comes first
   *   no permission— without the run right there is no Connect setup and no message box
   *   mobile 390px — one column, no sideways scroll
   * Commands an agent runs on its own computer never reach XENO; the page shows its reports and XENO tool calls only. */
  const AGENT_TABS = [['', 'Overview'], ['Identity', 'Identity'], ['Work', 'Work'], ['Activity', 'Activity'], ['Connect', 'Connect'], ['Settings', 'Settings'], ['Access', 'Access']];
  const TASK_STATUS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'Review' };
  const fmtCredits = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const dayLabel = (iso) => { const d = new Date(iso), t = new Date(); const k = (x) => x.toDateString(); if (k(d) === k(t)) return 'Today'; t.setDate(t.getDate() - 1); return k(d) === k(t) ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const neverRan = (a, pr) => !(pr && pr.seenAt) && !(a.connections || []).length && !(S.runsFor === a.id && S.runs.length);

  /** one line of grouped activity (agentOverview.groupActivity): a sitting of tool calls, a task action, a cloud run */
  function groupLine(x) {
    const task = (k) => `<a href="#" data-xag="open-task" data-k="${esc(k)}">${esc(k)}</a>`;
    if (x.kind === 'calls') {
      const tools = x.tools.map((t) => `${t.n} × <code>${esc(t.name)}</code>`).join(' · ');
      const span = x.from === x.to ? clock(x.to) : `${clock(x.from)}–${clock(x.to)}`;
      return `<li class="xag-log"><span class="xag-row-ic">${ic('plug')}</span><span class="xag-row-b"><span>${x.task ? `Worked on ${task(x.task)} · ` : ''}${h0.plural(x.count, 'XENO tool call', 'XENO tool calls')}${x.where ? ` from ${esc(x.where)}` : ''}</span><small>${tools}${x.count > x.tools.reduce((s, t) => s + t.n, 0) ? ' · and others' : ''}${x.failed ? ` · ${x.failed} failed` : ' · all succeeded'}</small></span><time datetime="${esc(x.to)}">${esc(span)}</time></li>`;
    }
    if (x.kind === 'run') return `<li class="xag-log xag-log--run"><span class="xag-row-ic">${ic('refresh')}</span><span class="xag-row-b"><span>Cloud run on ${task(x.task)} — ${esc(RUN_STATE[x.what] || x.what)}</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</span><time datetime="${esc(x.at)}">${esc(clock(x.at))}</time></li>`;
    return `<li class="xag-log"><span class="xag-row-ic">${ic('check')}</span><span class="xag-row-b"><span>${esc(TASK_WHAT[x.what] || x.what)} ${task(x.task)} ${esc(x.title || '')}</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</span><time datetime="${esc(x.at)}">${esc(clock(x.at))}</time></li>`;
  }
  let h0 = null;   // the page helpers, set per render (groupLine is called from inside one)

  function needsStrip(a) {
    const n = (S.ov && S.ov.needsYou) || [];
    if (!n.length) return '';
    const line = (x) => {
      if (x.kind === 'asks') return `<div class="xag-att"><span class="xag-att-k">Asks</span><span class="xag-att-t">“${esc(x.note || 'It has a question')}” · ${esc(x.task)}</span><button type="button" class="pg-btn" data-xag="open-task" data-k="${esc(x.task)}">Answer</button></div>`;
      if (x.kind === 'review') return `<div class="xag-att"><span class="xag-att-k">Review</span><span class="xag-att-t">${esc(x.task)} · ${esc(x.title)}</span><button type="button" class="pg-btn" data-xag="open-task" data-k="${esc(x.task)}">Review</button></div>`;
      if (x.kind === 'expires') return `<div class="xag-att"><span class="xag-att-k">Expires</span><span class="xag-att-t">${esc(x.label)} ${esc(until(x.expiresAt).toLowerCase())}</span><button type="button" class="pg-btn ghost" data-xag-tab="Connect">Renew</button></div>`;
      if (x.kind === 'cap') return `<div class="xag-att"><span class="xag-att-k">Cap</span><span class="xag-att-t">${fmtCredits(x.spentCredits)} of ${fmtCredits(x.capCredits)} credits used</span>${a.rights && a.rights.manage ? '<button type="button" class="pg-btn ghost" data-xag="cap">Raise</button>' : ''}</div>`;
      return '';
    };
    return `<section class="xag-needs" aria-label="Needs you">${n.map(line).join('')}</section>`;
  }

  function overviewTab(a, pr, R) {
    const h = h0, ov = S.ov, rid = ov && ov.agentId === a.id;
    if (!rid) return '<div class="xag-skel" aria-busy="true"><i></i><i></i></div>';
    // never run: three steps instead of empty sections
    if (neverRan(a, pr) && !(ov.queue || []).length) {
      const mine = new Set(a.projects.map((p) => p.id));
      const choices = (S.choices.length ? S.choices : S.projects.map((p) => ({ ...p, canGive: true, admin: true })));
      const has = a.projects.length > 0, ran = (a.credentials || []).length > 0;
      return `<section class="xag-start" aria-labelledby="xag-start-h"><h2 id="xag-start-h">Three steps and ${esc(a.name)} starts working</h2>
        <p>It works as itself — never as you — and only on what you give it. Everything it does shows up here.</p>
        <ol class="xag-steps2">
          <li class="${has ? 'done' : 'cur'}"><span class="xag-n">${has ? ic('check') : '1'}</span><div><b>Give it projects</b><small>It sees only these projects, their tasks and their files.</small>
            <div class="xag-chips">${choices.map((p) => { const on = mine.has(p.id), off = !on && p.canGive === false; return `<button type="button" class="xag-chip${on ? ' on' : ''}" aria-pressed="${on}" data-xag="proj-toggle" data-id="${esc(p.id)}" data-on="${on ? 0 : 1}"${off || S.busy ? ' disabled' : ''}>${esc(p.name)}</button>`; }).join('') || '<span class="xag-none">You have no projects yet.</span>'}</div></div></li>
          <li class="${ran ? 'done' : has ? 'cur' : ''}"><span class="xag-n">${ran ? ic('check') : '2'}</span><div><b>Choose where it runs</b><small>On a computer with Claude Code, Codex or the XENO CLI, in Spawn, or in XENO cloud.</small>
            ${R.runner || R.manage ? h.btn('Connect it', 'data-xag-tab="Connect"', !has) : '<small>You need the right to run it.</small>'}</div></li>
          <li class="${has && ran ? 'cur' : ''}"><span class="xag-n">3</span><div><b>Hand it a task</b><small>Pick one of the open tasks in its projects. It picks it up the next time it checks in.</small>
            ${h.btn('Hand it a task', 'data-xag="hand"', true)}</div></li>
        </ol></section>`;
    }
    const doing = pr && (pr.asking || pr.doing), live = pr && ['working', 'online'].includes(pr.state);
    const cloudRun = S.runsFor === a.id && S.runs.find((r) => LIVE_RUN.has(r.state));
    const calls = (S.trace && S.trace.id === a.id ? S.trace.items : []).filter((x) => x.kind === 'call').slice(0, 8);
    const now = `<section class="xag-now" aria-labelledby="xag-now-h">
        <div class="xag-now-top"><span class="xag-k" id="xag-now-h">Right now</span>${live ? '<span class="xag-pill"><i class="xag-sq"></i>Live</span>' : ''}<span class="xag-now-src">${esc(pr && pr.label || '')}</span></div>
        ${doing ? `<div class="xag-now-b"><div class="xag-now-t"><b>${esc(doing.title || doing.task)}</b><small><a href="#" data-xag="open-task" data-k="${esc(doing.task)}">${esc(doing.task)}</a> · ${esc(ago(doing.at).toLowerCase())}</small>
            ${doing.note ? `<p class="xag-report"><i class="xag-sq${live ? '' : ' off'}"></i><span>“${esc(doing.note)}”</span></p>` : ''}</div>
          <div class="xag-now-a">${h.btn(S.watch ? 'Hide' : 'Watch', `data-xag="watch" aria-pressed="${!!S.watch}"`, true)}${h.btn('Open task', `data-xag="open-task" data-k="${esc(doing.task)}"`, true)}${cloudRun ? h.btn('Stop', `data-xag="stop-run" data-id="${esc(cloudRun.id)}" aria-keyshortcuts="S"`, true) : ''}</div></div>`
        : `<div class="xag-now-b"><div class="xag-now-t"><b>Not on a task right now</b><small>${pr && pr.seenAt ? `Last seen ${esc(ago(pr.seenAt).toLowerCase())}` : 'It has not connected yet'}${pr && pr.state === 'offline' ? ' · work handed to it waits until it connects' : ''}</small></div><div class="xag-now-a">${h.btn(S.watch ? 'Hide' : 'Watch', `data-xag="watch" aria-pressed="${!!S.watch}"`, true)}</div></div>`}
        ${S.watch ? `<div class="xag-trace" role="log" aria-label="What XENO sees">${calls.length ? calls.map((c) => `<div><time>${esc(clock(c.at))}</time><span><code>${esc(c.what)}</code>${c.where ? ` · ${esc(c.where)}` : ''}</span><span>${c.ok === false ? 'failed' : 'ok'}</span></div>`).join('') : '<div><span></span><span>No XENO tool calls yet.</span><span></span></div>'}
          <p>Its XENO tool calls and what it reports. Commands it runs on its own computer stay on that computer.</p></div>` : ''}
        <div class="xag-stats">
          <div><small>Today</small><b>${h.plural(ov.today.taskActions, 'task action', 'task actions')}</b><small>${h.plural(ov.today.toolCalls, 'XENO tool call', 'XENO tool calls')}</small></div>
          <div><small>Last ${ov.spend.windowDays} days</small><b>${fmtCredits(ov.spend.spentCredits)} credits</b><small>${ov.spend.capCredits != null ? `of ${fmtCredits(ov.spend.capCredits)} cap` : 'no cap'}${R.manage ? ` · <button type="button" class="pg-link" data-xag="cap">${ov.spend.capCredits != null ? 'Change cap' : 'Set a cap'}</button>` : ''}</small></div>
          <div class="xag-spark-w"><small><span>Credits per day · last ${ov.spend.days.length} days</span><span>today ${fmtCredits(ov.spend.days[ov.spend.days.length - 1].credits)}</span></small>
            ${(() => { const max = Math.max(...ov.spend.days.map((d) => d.credits), 0); return `<div class="xag-spark" role="img" aria-label="Credits spent per day over the last ${ov.spend.days.length} days${max ? ', highest ' + fmtCredits(max) : ', none'}">${ov.spend.days.map((d, i) => `<i style="height:${max ? Math.max(4, Math.round(d.credits / max * 100)) : 4}%"${i === ov.spend.days.length - 1 ? ' class="t"' : ''} title="${esc(d.day)}: ${fmtCredits(d.credits)}"></i>`).join('')}</div>`; })()}
            <small class="xag-spark-n">${esc(ov.spend.covers)}. A cloud run has its own budget.</small></div>
        </div></section>`;
    const msg = R.runner || R.manage ? `<form class="xag-ask" data-xag-form="msg"><label class="xag-sr" for="xag-ask-in">Message ${esc(a.name)}</label><input id="xag-ask-in" name="body" maxlength="20000" autocomplete="off" placeholder="${doing ? `Tell ${esc(a.name)} something about ${esc(doing.task)}…` : `${esc(a.name)} is not on a task — hand it one first`}"${doing ? '' : ' disabled'}><button type="submit" class="pg-btn"${doing && !S.busy ? '' : ' disabled'}>Send</button></form>` : '';
    const q = ov.queue || [];
    const queue = `<section class="pg-sec"><div class="pg-sec-h"><h3>Waiting for it</h3><small>${h.plural(q.length, 'task', 'tasks')}</small><button class="pg-link" data-xag-tab="Work">All work</button></div>
      ${q.length ? `<div class="xag-rows">${q.slice(0, 5).map((t) => `<div class="xag-row"><span class="xag-row-ic">${ic(t.status === 'in_review' ? 'check' : t.status === 'blocked' ? 'alert' : 'tasks')}</span><span class="xag-row-b"><b><a href="#" data-xag="open-task" data-k="${esc(t.task)}">${esc(t.task)}</a> · ${esc(t.title)}</b><small>${esc(ago(t.at))}</small></span><span class="xag-tag${t.status === 'in_review' ? ' on' : ''}">${esc(TASK_STATUS[t.status] || t.status)}</span><span></span></div>`).join('')}</div>`
        : `<div class="xag-empty"><p>Nothing handed to it.</p>${h.btn('Hand it a task', 'data-xag="hand"', true)}</div>`}</section>`;
    const recent = `<section class="pg-sec"><div class="pg-sec-h"><h3>Recent activity</h3><button class="pg-link" data-xag-tab="Activity">See all</button></div>
      ${ov.groups.length ? `<ol class="xag-logs">${ov.groups.slice(0, 5).map(groupLine).join('')}</ol>` : `<div class="xag-empty"><p>Nothing yet. What it does on tasks, its XENO tool calls and its cloud runs show here.</p></div>`}</section>`;
    return `${now}${msg}${queue}${recent}`;
  }

  function sideColumn(a, k, l, pr, R) {
    const h = h0, company = !!(a.owner && a.owner.kind === 'company');
    const conns = (a.connections || []).map((c) => `<div class="xag-place"><i class="xag-sq${c.pausedAt ? ' off' : (Date.now() - new Date(c.lastUsedAt || 0).getTime() < 15 * 60e3 ? '' : ' off')}"></i><span><b>${esc(c.client)}</b><small>${c.pausedAt ? 'Paused' : c.lastUsedAt ? esc(ago(c.lastUsedAt)) : 'Not used yet'}</small></span>${R.manage ? `<button type="button" class="pg-btn ghost xag-sm" data-xag="${c.pausedAt ? 'resume' : 'pause'}" data-id="${esc(c.id)}">${c.pausedAt ? 'Resume' : 'Pause'}</button>` : ''}</div>`).join('');
    const cloud = R.runner || R.manage ? `<div class="xag-place"><i class="xag-sq${S.runsFor === a.id && S.runs.some((r) => LIVE_RUN.has(r.state)) ? '' : ' off'}"></i><span><b>XENO cloud</b><small>${S.runsFor === a.id && S.runs.length ? 'Last run ' + esc(ago(S.runs[0].createdAt).toLowerCase()) : 'Not run there yet'}</small></span></div>` : '';
    return `<aside class="xag-side"><div class="xag-id">
        <span class="xag-mono xag-mono--lg" aria-hidden="true">${mono(a.name)}<i class="xag-dot xag-dot--${k}"></i></span>
        <b>${esc(a.name)}</b><span class="xag-st xag-st--${k}" data-xag-presence="${esc((pr || {}).state || k)}">${esc(l)}</span>${(() => { const seen = (pr || {}).seenAt || (a.connections || []).map((c) => c.lastUsedAt).filter(Boolean).sort().pop();
          // availability: measured states only (presence.state); `cloud` and `new` are capabilities or absence, never a claim
          const avail = (pr || {}).state === 'paused' || a.paused ? 'Can’t take work' : ['working', 'online', 'asking', 'error'].includes((pr || {}).state) && pr.canTakeWork ? 'Can take work now' : (pr || {}).state === 'offline' ? 'Work handed to it waits until it connects' : '';
          return `<small class="xag-avail" data-xag-avail>${seen ? `Last seen ${esc(ago(seen).toLowerCase())}` : 'Last seen never'}${avail ? ` · ${avail}` : ''}</small>`; })()}</div>
      <section class="xag-box"><div class="xag-box-h"><h3>Where it runs</h3>${R.runner || R.manage ? '<button class="pg-link" data-xag-tab="Connect">Connect</button>' : ''}</div>${conns || cloud ? conns + cloud : '<p class="xag-none">It has not run anywhere yet.</p>'}</section>
      <section class="xag-box"><div class="xag-box-h"><h3>Works on</h3><button class="pg-link" data-xag-tab="Work">Change</button></div>${a.projects.length ? `<div class="xag-chips">${a.projects.map((p) => `<span class="xag-tag">${esc(p.name)}</span>`).join('')}</div>` : '<p class="xag-none">No projects yet.</p>'}</section>
      <dl class="pg-props"><dt>Owner</dt><dd>${company ? esc(a.owner.name) : 'You'}</dd><dt>Created</dt><dd>${esc(new Date(a.createdAt).toLocaleDateString())}</dd><dt>Division</dt><dd>${a.division ? esc(a.division.name) : 'None'}</dd><dt>Instructions</dt><dd>${a.version ? 'v' + a.version : '—'}</dd><dt>Model</dt><dd>${a.runtime && a.runtime.model ? `<code>${esc(a.runtime.model)}</code>` : 'The CLI’s choice'}</dd>
        <dt>Id</dt><dd><button type="button" class="xag-idbtn" data-xag="copy" data-copy="${esc(a.id)}" title="Its permanent id — what Spawn and other tools store. It never changes, even if you rename it.">${S.copied === a.id ? 'Copied' : esc(a.id.slice(0, 12)) + '…'}</button></dd></dl>
      <p class="xag-note">It acts only as itself, never as you, and you can stop it at any moment by pausing where it runs or revoking its credentials.</p></aside>`;
  }

  // WHO it is: an Anima Mind — a role and named sections. The four the page names are edited here; any other section a
  // Mind carries (from an import) is kept as written, so nothing is lost in a round-trip.
  const ID_SECTIONS = [['Voice', 'How it talks', 'Plain and short. Numbers before adjectives. Says when it is unsure.'],
    ['Style', 'How it works', 'Small, checkable steps. Reads the code before changing it.'],
    ['Boundaries', 'What it never does', 'Never deploys. Never touches billing without asking.'],
    ['Output', 'What every hand-back contains', 'What changed, how it was checked, what is still unsure.']];
  const splitBody = (raw) => {
    const out = { known: {}, rest: [] }, parts = String(raw || '').split(/^#\s+(.+)$/m);
    if (parts[0].trim()) out.rest.push(parts[0].trim());
    for (let i = 1; i < parts.length; i += 2) {
      const h = parts[i].trim(), b = (parts[i + 1] || '').trim(), k = ID_SECTIONS.find(([x]) => x.toLowerCase() === h.toLowerCase());
      if (k) out.known[k[0]] = b; else out.rest.push(`# ${h}\n\n${b}`);
    }
    return out;
  };
  const joinBody = (known, rest) => [...ID_SECTIONS.filter(([k]) => (known[k] || '').trim()).map(([k]) => `# ${k}\n\n${known[k].trim()}`), String(rest || '').trim()].filter(Boolean).join('\n\n');

  function identityTab(a, R) {
    const h = h0, p = a.persona || { role: '', body: '' }, parts = splitBody(p.body), can = R.editor || R.manage;
    const field = ([k, sub, ph]) => `<label class="xag-idf"><span><b>${esc(k)}</b><small>${esc(sub)}</small></span><textarea name="s_${esc(k)}" rows="3" maxlength="8000" placeholder="${esc(ph)}"${can ? '' : ' readonly'}>${esc(parts.known[k] || '')}</textarea></label>`;
    const brief = S.brief && S.brief.id === a.id ? S.brief : null;
    return `<div class="xag-idwrap"><form class="xag-idform" data-xag-form="identity">
        <p class="xag-note xag-lead">Who ${esc(a.name)} is, in every task and every place it runs — Claude Code, Codex, Spawn or the cloud. It is stored as an Anima Mind, so it moves to and from Anima unchanged. Saving makes a new version; work already running keeps its version.</p>
        <label class="xag-idf"><span><b>Role</b><small>One line: who it is</small></span><input name="role" maxlength="200" value="${esc(p.role || '')}" placeholder="a careful payments engineer"${can ? '' : ' readonly'}></label>
        ${ID_SECTIONS.map(field).join('')}
        ${parts.rest.length ? `<label class="xag-idf"><span><b>More</b><small>Other sections it carries</small></span><textarea name="rest" rows="5"${can ? '' : ' readonly'}>${esc(parts.rest.join('\n\n'))}</textarea></label>` : '<input type="hidden" name="rest" value="">'}
        <div class="xag-idacts">${can ? `<button type="submit" class="pg-btn"${S.busy ? ' disabled' : ''}>Save version</button>` : ''}${h.btn('Export mind.xeno', 'data-xag="mind-export"', true)}${can ? h.btn('Import a Mind', 'data-xag="mind-import"', true) : ''}${can && (p.role || p.body) ? h.btn('Clear', 'data-xag="persona-clear"', true) : ''}</div>
      </form>
      <aside class="xag-brief"><div class="xag-box-h"><h3>What it is told</h3><button class="pg-link" data-xag="brief-refresh">Refresh</button></div>
        <p class="xag-note">Before any task. A task adds its project’s and area’s instructions.</p>
        ${brief ? `<pre class="xag-instr-v">${esc(brief.text)}</pre>` : '<p class="xag-none">Loading…</p>'}</aside></div>`;
  }

  function workTab(a, projects) {
    return `<section class="pg-sec"><div class="pg-sec-h"><h3>Projects it works on</h3><small>${h0.plural(a.projects.length, 'project', 'projects')}</small></div><p class="xag-note xag-lead">It takes tasks, comments and sends work for review in these projects. It never accepts its own work.</p>${projects}</section>
      <section class="pg-sec xag-runs"><div class="pg-sec-h"><h3>Cloud runs</h3><button class="pg-link" data-xag="run-cloud">Run on a task</button></div>
        ${S.runsFor === a.id && S.runs.length ? `<div class="xag-rows">${S.runs.slice(0, 20).map((r) => `<div class="xag-row"><span class="xag-row-ic">${ic(LIVE_RUN.has(r.state) ? 'refresh' : r.state === 'completed' ? 'check' : 'x')}</span><span class="xag-row-b"><b><a data-xag="open-task" data-k="${esc(r.task || '')}">${esc(r.task || 'Task')}</a> · ${esc(RUN_STATE[r.state] || r.state)}</b><small>${esc(ago(r.createdAt))} · instructions v${esc(r.version)} · budget ${esc(r.budgetCredits)} credits${runReason(r) ? ' · ' + esc(runReason(r)) : ''}${r.admissionId ? ` · <a data-pg-ws="Agents/${esc(a.id)}/runs/${esc(r.admissionId)}">Admission</a>` : ''}</small></span><span class="xag-row-m">${r.endedAt ? esc(ago(r.endedAt)) : ''}</span>${LIVE_RUN.has(r.state) ? `<button type="button" class="pg-btn ghost" data-xag="stop-run" data-id="${esc(r.id)}">Stop</button>` : '<span></span>'}</div>`).join('')}</div>`
          : `<div class="xag-empty"><p>Run ${esc(a.name)} on one of its tasks and it works in the cloud — no CLI, no computer of yours. It stops at the budget you set.</p>${h0.btn('Run on a task', 'data-xag="run-cloud"', true)}</div>`}</section>`;
  }

  function activityTab(a) {
    const A = S.activity;
    if (!A) return '<p class="xag-none">Loading…</p>';
    if (A.error) return '<p class="xag-none">Its activity couldn’t be loaded. <button class="pg-link" data-xag="activity-refresh">Try again</button></p>';
    const F = [['all', 'All'], ['task', 'Tasks'], ['calls', 'XENO tool calls'], ['run', 'Cloud runs']];
    const items = A.items.filter((x) => S.actKind === 'all' || x.kind === S.actKind);
    const bar = `<div class="pg-bar"><div class="pg-seg" role="tablist" aria-label="Show">${F.map(([k, l]) => `<button role="tab" aria-selected="${S.actKind === k}" data-xag="act-kind" data-k="${k}">${l}</button>`).join('')}</div><button class="pg-link" data-xag="activity-refresh">Refresh</button></div>`;
    if (!items.length) return bar + `<div class="xag-empty"><p>Nothing yet. What ${esc(a.name)} does on tasks, its XENO tool calls and its cloud runs show here.</p></div>`;
    const days = [];
    for (const x of items) { const d = dayLabel(x.at); const last = days[days.length - 1]; if (last && last.d === d) last.xs.push(x); else days.push({ d, xs: [x] }); }
    return bar + days.map((g) => `<h4 class="xag-day">${esc(g.d)}</h4><ol class="xag-logs xag-logs--box">${g.xs.map(groupLine).join('')}</ol>`).join('') + (A.next ? '<button class="pg-link xag-more" data-xag="activity-more">Older</button>' : '');
  }

  function connectTab(a, R, run, conns) {
    if (!(R.runner || R.manage)) return `<div class="xag-empty"><p>You can see ${esc(a.name)}, but not run it. Its owner can give you the right to run it.</p></div>`;
    const P = [['cli', 'On a computer', 'Claude Code, Codex, the XENO CLI or any MCP client'], ['spawn', 'In Spawn', 'One command; Spawn keeps the credential for you'], ['cloud', 'In XENO cloud', 'No computer needed; one task, with a budget']];
    const place = S.tab === 'spawn' ? 'spawn' : S.place === 'cloud' ? 'cloud' : 'cli';
    return `<h2 class="xag-h2">Where should ${esc(a.name)} work?</h2><p class="xag-note xag-lead">Wherever it runs, it signs in as ${esc(a.name)}, sees only its projects, and everything it does is shown as ${esc(a.name)}’s.</p>
      <div class="xag-places" role="radiogroup" aria-label="Where it runs">${P.map(([k, t, s]) => `<button type="button" role="radio" aria-checked="${place === k}" class="xag-placecard${place === k ? ' on' : ''}" data-xag="place" data-k="${k}"><b>${esc(t)}</b><small>${esc(s)}</small></button>`).join('')}</div>
      ${place === 'cloud' ? `<section class="xag-run"><div class="xag-run-h"><div><h3>Run it in XENO cloud</h3><p>Pick one of its tasks and a budget. It works until the task is done or the budget is spent, and you can stop it at any time.</p></div>${h0.btn('Run on a task', 'data-xag="run-cloud"')}</div></section>` : run}
      <section class="pg-sec"><div class="pg-sec-h"><h3>Where it has run</h3></div><div class="xag-rows">${conns}</div></section>`;
  }

  function settingsTab(a, R, svc, company) {
    const ov = S.ov && S.ov.agentId === a.id ? S.ov : null;
    const vers = ov && ov.versions.length ? `<div class="xag-vtab"><div class="xag-vtab-r xag-vtab-h"><span>Version</span><span>Made</span><span>Cloud runs</span><span>Finished</span><span>Failed</span><span>Task in review or done</span><span>Task blocked</span></div>${ov.versions.map((v) => `<div class="xag-vtab-r${v.version === a.version ? ' cur' : ''}"><b>v${v.version}</b><span>${esc(new Date(v.createdAt).toLocaleDateString())}${v.by ? ' · ' + esc(v.by) : ''}</span><span>${v.runs}</span><span>${v.completed}</span><span>${v.failed}</span><span>${v.tasksInReview + v.tasksDone}</span><span>${v.tasksBlocked}</span></div>`).join('')}<p class="xag-note">Counted from cloud runs, which record the version they used. Work done from a CLI does not record it.</p></div>` : '';
    const row = (title, sub, body, act) => `<div class="xag-set"><div><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ''}</div><div class="xag-set-b">${body}</div><div class="xag-set-a">${act || ''}</div></div>`;
    const instr = S.editingInstr ? `<form class="xag-instr" data-xag-form="instr"><textarea name="instructions" rows="8" maxlength="32768" placeholder="How it should work: what to do, what to avoid, how to report back">${esc(a.instructions)}</textarea>
        <div class="xag-instr-a"><small>Saving makes a new version. Work already running keeps the version it started with.</small><button type="button" class="pg-btn ghost" data-xag="instr-cancel">Cancel</button><button type="submit" class="pg-btn"${S.busy ? ' disabled' : ''}>Save version</button></div></form>`
      : (a.instructions ? `<pre class="xag-instr-v">${esc(a.instructions)}</pre>` : '<p class="xag-dim">None needed. On every task it follows XENO’s way of working, plus the instructions of the task’s project and area. Add some only for what is particular to this agent.</p>') + vers;
    const rt = rtSet(a.runtime) ? `<dl class="pg-props xag-rt"><dt>Model</dt><dd>${a.runtime.model ? `<code>${esc(a.runtime.model)}</code>` : 'The CLI’s choice'}</dd><dt>Reasoning</dt><dd>${a.runtime.effort ? esc(EFFORT_LABEL[a.runtime.effort]) : 'The CLI’s choice'}</dd>${a.runtime.tools && (a.runtime.tools.allow || []).length ? `<dt>Only these tools</dt><dd>${a.runtime.tools.allow.map((t) => `<code>${esc(t)}</code>`).join(' ')}</dd>` : ''}${a.runtime.tools && (a.runtime.tools.deny || []).length ? `<dt>Never these tools</dt><dd>${a.runtime.tools.deny.map((t) => `<code>${esc(t)}</code>`).join(' ')}</dd>` : ''}</dl>`
      : `<p class="xag-dim">The CLI it runs in picks the model, reasoning and tools. Set them here to make ${esc(a.name)} run the same way everywhere.</p>`;
    const services = `<b>${S.services.length ? `All ${S.services.length} XENO services` : 'XENO services'}</b><p class="xag-dim">${S.services.slice(0, 6).map((s) => esc(s.title)).join(', ')}${S.services.length > 6 ? ` and ${S.services.length - 6} more` : ''}. Images and video wait for ${company ? 'the person answering for it' : 'your'} approval unless ${a.division ? 'its division' : 'a division'} approves within its budget; model calls are billed to ${company ? 'them' : 'you'}. Turn a service off for one connection in Dev › MCP.</p><details class="xag-vers"><summary>See all</summary><div class="xag-svcs">${svc}</div></details>`;
    const ov2 = ov ? ov.spend : null;
    const cap = ov2 ? `<b>${ov2.capCredits != null ? `${fmtCredits(ov2.capCredits)} credits every ${ov2.windowDays} days` : 'No cap'}</b><p class="xag-dim">${fmtCredits(ov2.spentCredits)} spent in the last ${ov2.windowDays} days on ${esc(ov2.covers)}. A spend past the cap is refused. A cloud run has its own budget.</p>` : '<p class="xag-dim">Loading…</p>';
    const hook = a.webhook ? `<code>${esc(a.webhook)}</code><p class="xag-dim">Every task handed to it is posted here, signed (HMAC-SHA256), and retried if it fails.</p>` : '<b>It checks XENO for work</b><p class="xag-dim">Add a webhook to be told the moment a task is handed to it.</p>';
    const div = a.division ? `<button class="pg-chip" data-xag="open-division" data-id="${esc(a.division.id)}">${ic('building')}${esc(a.division.name)}</button><p class="xag-dim">${esc(a.name)} works only on ${esc(a.division.name)}’s projects. Moving it takes away projects outside the new division.</p>`
      : `<b>No division</b><p class="xag-dim">It works only on projects that are in no division either.${S.divisions.length ? '' : ' This workspace has no divisions yet — <a data-xag="divisions">create one</a>.'}</p>`;
    const lent = (a.lentTo || []).length ? `<div class="xag-rows">${a.lentTo.map((l) => `<div class="xag-row"><span class="xag-row-ic">${ic(l.division ? 'building' : 'people')}</span><span class="xag-row-b"><b>${esc(l.division ? l.division.name : l.workspace.name)}</b><small>${esc(l.division ? 'in ' + l.workspace.name : 'the whole workspace')} · ${l.state === 'accepted' ? 'working there' : 'offered — waiting for its admin to accept'}</small></span><span class="xag-row-m">${l.state === 'accepted' ? esc(ago(l.acceptedAt)) : ''}</span><button type="button" class="pg-btn ghost" data-xag="unlend" data-id="${esc(l.id)}">${l.state === 'accepted' ? 'End' : 'Withdraw'}</button></div>`).join('')}</div>`
      : '<p class="xag-dim">Only its own division. Lending keeps you as its owner and who pays.</p>';
    return `<div class="xag-sets">
      ${row('Instructions', a.version ? `Version ${a.version}${a.versions && a.versions[0] && a.versions[0].by ? ' · ' + esc(a.versions[0].by) : ''}` : '', instr, S.editingInstr || !R.editor && !R.manage ? '' : h0.btn('Edit', 'data-xag="instr-edit"', true))}
      ${row('Model and tools', 'The same everywhere it runs', rt, R.editor || R.manage ? h0.btn(rtSet(a.runtime) ? 'Change' : 'Set', 'data-xag="runtime"', true) : '')}
      ${row('XENO services', 'What it can call', services, '')}
      ${row('Spending cap', 'Through XENO tools', cap, R.manage ? h0.btn(ov2 && ov2.capCredits != null ? 'Change' : 'Set a cap', 'data-xag="cap"', true) : '')}
      ${row('New work', 'How it hears about tasks', hook + (S.hook && S.hook.agentId === a.id ? `<div class="xag-secret" role="status"><div><b>${ic('lock')}Signing secret — copy it now, it is never shown again</b></div><div class="xag-secret-v"><code>${esc(S.hook.secret)}</code>${copyBtn(S.hook.secret)}</div></div>` : ''), R.manage ? h0.btn(a.webhook ? 'Change' : 'Add webhook', 'data-xag="webhook"', true) + (a.webhook ? h0.btn('Remove', 'data-xag="webhook-off"', true) : '') : '')}
      ${row('Division', 'Which projects it may join', div, S.canManageDivisions ? h0.btn(a.division ? 'Move' : 'Put in a division', 'data-xag="division"', true) : '')}
      ${row('Lent to', 'Other divisions or workspaces', lent, R.manage ? h0.btn('Lend', 'data-xag="lend"', true) : '')}
      ${R.manage ? row('Delete agent', 'Revokes every credential', '<p class="xag-dim">The tasks and comments it wrote stay, under its name.</p>', h0.btn('Delete', 'data-xag="delete"', true, 'trash')) : ''}
    </div>`;
  }

  function onePage() {
    const h = H(), a = S.one; if (!a) return null;
    h0 = h;
    const [k, l, pr] = state(a);
    const mine = new Map(a.projects.map((p) => [p.id, p]));
    const minted = S.minted && S.minted.agentId === a.id ? S.minted : null;
    const set = setups(minted && minted.token), cur = set[S.tab] || set.claude;
    const R = a.rights || {}, company = !!(a.owner && a.owner.kind === 'company'), ac = S.access;

    // Connect: where it runs, and the one thing to copy
    const run = `<section class="xag-run" aria-labelledby="xag-run-h">
        <div class="xag-run-h"><div><h3 id="xag-run-h">${S.tab === 'spawn' ? 'Start it in Spawn' : 'Connect a CLI'}</h3><p>${S.tab === 'spawn' ? 'Spawn keeps the credential in your computer’s secure store and makes a fresh short-lived one for each launch.' : `Make a credential, then run the command once. ${esc(a.name)} appears under Where it has run the first time it connects.`}</p></div>
          ${S.tab === 'spawn' ? '' : `<div class="xag-mint"><select data-xag-ttl aria-label="How long the credential lasts"><option value="1">Lasts 1 hour</option><option value="24">Lasts 1 day</option><option value="720" selected>Lasts 30 days</option><option value="2160">Lasts 90 days</option></select>
            <button type="button" class="pg-btn" data-xag="mint"${S.busy ? ' disabled' : ''}>${ic('plus')}<span>Make credential</span></button></div>`}</div>
        ${minted && S.tab !== 'spawn' ? `<div class="xag-secret" role="status"><div><b>${ic('lock')}Filled into the command below — copy it now, it is never shown again</b><small>${esc(until(minted.expiresAt))}</small></div><div class="xag-secret-v"><code>${esc(minted.token)}</code>${copyBtn(minted.token)}</div></div>` : ''}
        ${S.tab === 'spawn' ? '' : `<div class="xag-tabs" role="tablist" aria-label="CLI">${Object.entries(set).filter(([key]) => key !== 'spawn').map(([key, s]) => `<button type="button" role="tab" aria-selected="${key === S.tab}" data-xag="tab" data-k="${key}">${esc(s.label)}</button>`).join('')}</div>`}
        ${S.tab === 'spawn' ? '' : `<div class="xag-cmd"><pre>${esc(cur.cmd)}</pre>${minted ? copyBtn(cur.cmd) : '<span class="xag-cmd-hint">Make a credential to fill this in</span>'}</div>`}
        ${S.tab === 'spawn' ? (() => { const c = spawnCommands(a, S.spawnProg); return `<div class="pg-seg xag-prog" role="tablist" aria-label="Program">${Object.entries(SPAWN_PROGRAMS).map(([k2, l2]) => `<button type="button" role="tab" aria-selected="${k2 === S.spawnProg}" data-xag="spawnprog" data-k="${k2}">${esc(l2)}</button>`).join('')}</div>
        <p class="xag-note">Identity <code>${esc(a.id)}</code> · profile <code>${esc(S.spawnProg)}/${esc(spawnProfileName(a))}</code></p>
        <p class="xag-note">Start it as ${esc(a.name)}, in the folder you are in. The first time, Spawn asks you to confirm and makes the profile; after that it reuses it. Needs XENO Spawn ${esc(SPAWN_AGENT_FLAG_RELEASE)} or later.</p><div class="xag-cmd"><pre>${esc(c.launch)}</pre>${copyBtn(c.launch)}</div>
        <p class="xag-note">Bind only (make the profile without starting it)</p><div class="xag-cmd"><pre>${esc(c.bind)}</pre>${copyBtn(c.bind)}</div>
        ${spawnLink(a.id) ? `<div class="xag-spawn"><a class="pg-btn" href="${esc(spawnLink(a.id, S.spawnProg))}">${ic('terminal')}<span>Open in Spawn · ${esc(SPAWN_PROGRAMS[S.spawnProg])}</span></a><small>Binds without a terminal. Needs XENO Spawn ${esc(SPAWN_AGENT_FLAG_RELEASE)} or later; Spawn asks you to confirm before binding.</small></div>` : ''}`; })() : ''}
      </section>`;

    const choices = S.choices.length ? S.choices : S.projects.map((p) => ({ ...p, canGive: true, admin: true, division: null }));
    const projects = choices.length ? `<div class="xag-checks">${choices.map((p) => { const on = mine.has(p.id), off = !on && !p.canGive;
      const why2 = on ? 'Takes tasks, comments and sends work for review — never accepts its own work'
        : !p.admin ? 'Only a project admin can give it this project'
        : off ? (p.division ? `In ${p.division.name} — ${a.division ? `${a.name} works in ${a.division.name}` : `put ${a.name} in ${p.division.name} to give it`}` : `Not in a division — ${a.name} works in ${a.division ? a.division.name : 'none'}`)
        : 'Not shared with it';
      return `<label class="xag-check${on ? ' on' : ''}${off ? ' off' : ''}"><input type="checkbox" data-xag-proj="${esc(p.id)}"${on ? ' checked' : ''}${S.busy || off ? ' disabled' : ''}><span><b>${esc(p.name)}</b><small>${esc(why2)}</small></span>${p.division ? `<em class="xag-div">${esc(p.division.name)}</em>` : ''}</label>`; }).join('')}</div>`
      : h.box('folder', 'You have no projects yet', 'Create a project, then come back to give it to this agent.', '', 'sm');
    const svc = S.services.map((s) => `<span class="xag-svc on" title="${esc(s.description || '')}">${ic('check')}${esc(s.title)}</span>`).join('');
    const creds = a.credentials.length ? a.credentials.map((c) => `<div class="xag-row"><span class="xag-row-ic">${ic('lock')}</span><span class="xag-row-b"><code>${esc(c.hint)}</code><small>${esc(c.label || 'Credential')} · made ${esc(ago(c.createdAt).toLowerCase())} · ${c.lastUsedAt ? 'used ' + esc(ago(c.lastUsedAt).toLowerCase()) : 'not used yet'}</small></span><span class="xag-row-m">${esc(until(c.expiresAt))}</span><button type="button" class="pg-btn ghost" data-xag="revoke" data-id="${esc(c.id)}">Revoke</button></div>`).join('')
      : '<p class="xag-none">No live credential. Make one on Connect to connect a CLI.</p>';
    const conns = a.connections.length ? a.connections.map((c) => `<div class="xag-row"><span class="xag-row-ic">${ic('terminal')}</span><span class="xag-row-b"><b>${esc(c.client)}</b><small>Connected ${esc(ago(c.createdAt).toLowerCase())}${c.pausedAt ? ' · paused' : ''}</small></span><span class="xag-row-m">${esc(ago(c.lastUsedAt))}</span><span class="xag-row-acts">${R.manage ? `<button type="button" class="pg-btn ghost" data-xag="${c.pausedAt ? 'resume' : 'pause'}" data-id="${esc(c.id)}">${c.pausedAt ? 'Resume' : 'Pause'}</button>` : ''}<button type="button" class="pg-btn ghost" data-xag="calls" data-id="${esc(c.id)}">Activity</button></span></div>`).join('')
      : '<p class="xag-none">It has not run anywhere yet. It appears here the first time a CLI uses one of its credentials.</p>';

    const paused = a.paused === 'needs_owner' ? `<div class="xag-paused" role="alert"><div><b>${ic('lock')}${esc(a.name)} is paused</b><p>${esc(a.accountable ? a.accountable.name : 'The person')} no longer runs ${esc(a.owner.name)}, and somebody has to answer for what it does. Nothing is lost: its instructions, history and credentials are kept, and it works again the moment an admin takes it over.</p></div>${R.manage ? '<button type="button" class="pg-btn" data-xag="takeover">Take over</button>' : ''}</div>` : '';
    const own = `<section class="pg-sec"><div class="pg-sec-h"><h3>Owner and access</h3>${R.manage ? `<button class="pg-link" data-xag="move">${company ? 'Move to another company' : 'Move to a company'}</button>` : ''}</div>
      <dl class="pg-props xag-own"><dt>Owned by</dt><dd>${company ? esc(a.owner.name) : 'You, personally'}</dd>
        <dt>Answers for it</dt><dd>${a.accountable ? esc(a.accountable.name) : '—'}${company && R.manage && !a.paused ? ' · <a data-xag="handover">Hand over</a>' : ''}</dd>
        ${R.manage ? '' : `<dt>You can</dt><dd>${['viewer', 'runner', 'editor', 'exporter'].filter((x) => R[x]).map((x) => RIGHT_LABEL[x]).join(', ') || '—'}</dd>`}</dl>
      ${company ? '' : '<p class="xag-none">A personal agent is only yours. Move it to a company and the company owns it: it outlives whoever made it, and members can be allowed to see, run, change or export it.</p>'}
      ${company && R.manage && ac ? `<div class="pg-sec-h xag-sub"><h4>People</h4><button class="pg-link" data-xag="grant">Give access</button></div>
        ${ac.people.length ? `<div class="xag-rows">${ac.people.map((p) => `<div class="xag-row"><span class="xag-row-ic">${ic('people')}</span><span class="xag-row-b"><b>${esc(p.name)}</b><small>${p.rights.map((x) => `<span class="xag-right">${esc(RIGHT_LABEL[x])}<button type="button" aria-label="Remove ${esc(RIGHT_LABEL[x])}" data-xag="ungrant" data-id="${esc(p.userId)}" data-k="${esc(x)}">${ic('x')}</button></span>`).join(' ')}</small></span><span></span><span></span></div>`).join('')}</div>`
          : `<p class="xag-none">Only ${esc(a.owner.name)}’s admins. Give a member the right to see, run, change or export it.</p>`}` : ''}
      ${R.manage && (S.transfers || []).some((t) => ['proposed', 'authorized', 'reviewed'].includes(t.state)) ? `<div class="xag-rows">${S.transfers.filter((t) => ['proposed', 'authorized', 'reviewed'].includes(t.state)).map((t) => `<div class="xag-row"><span class="xag-row-ic">${ic('send')}</span><span class="xag-row-b"><b>${esc(MOVE_STATE[t.state])}</b><small>${esc(ago(t.authorizedAt || t.createdAt))}</small></span><span></span><span></span></div>`).join('')}</div>` : ''}
      ${ac && ac.history.length ? `<details class="xag-vers"><summary>Who has answered for it</summary><ol>${ac.history.map((x) => `<li><b>${esc(x.to)}</b><small>${esc(REASON[x.reason] || x.reason)}${x.from ? ', from ' + esc(x.from) : ''}${x.by && x.by !== x.to ? ' · by ' + esc(x.by) : ''} · ${esc(new Date(x.at).toLocaleString())}${x.note ? ' · “' + esc(x.note) + '”' : ''}</small></li>`).join('')}</ol></details>` : ''}</section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Credentials</h3><small>${a.credentials.length} live</small>${R.runner || R.manage ? '<button class="pg-link" data-xag-tab="Connect">New credential</button>' : ''}</div><div class="xag-rows">${creds}</div></section>`;

    const t = S.atab;
    const acts = (R.editor ? h.btn('Edit', 'data-xag="edit"', true, 'edit') : '') + h.btn('Hand it a task', 'data-xag="hand" aria-keyshortcuts="T"', false, 'send');
    const body = t === 'Identity' ? identityTab(a, R)
      : t === 'Work' ? workTab(a, projects)
      : t === 'Activity' ? activityTab(a)
      : t === 'Connect' ? connectTab(a, R, run, conns)
      : t === 'Settings' ? settingsTab(a, R, svc, company)
      : t === 'Access' ? own
      : `<div class="xag-cols"><div class="xag-main">${overviewTab(a, pr, R)}</div>${sideColumn(a, k, l, pr, R)}</div>`;
    return h.page(h.head({ obj: true, eyebrow: `<a data-xag="list">Agents</a>`, title: a.name, sub: a.description || l, acts })
      + h.tabs(AGENT_TABS.map(([key, lbl]) => [key, lbl]), t, 'data-xag-tab')
      + `<div class="xag-one" data-xag-tabname="${esc(t || 'Overview')}">${paused}${t === 'Connect' ? '' : needsStrip(a)}${body}</div>`, 'xag');
  }

  // ───────────────────────── page entry, called by the workspace router
  function route(it) {
    // 'All my agents' (across workspaces) is the same list on the platform: every agent you own, wherever it works
    if (it === 'All my agents') { setTimeout(() => go('Agents'), 0); return null; }
    if (it !== 'Agents' && !(it || '').startsWith('Agents/')) return null;
    style();
    const rest = it.startsWith('Agents/') ? it.slice(7).split('/') : [];
    const id = rest[0] || null, tab = rest[1] || '';
    if (rest.length > 2 || (tab && !AGENT_TABS.some(([k]) => k === tab))) return null;   // Agents/<id>/runs/<x> belongs to the workforce page
    if (id) { S.atab = tab; if (tab === 'Identity' && S.one && S.one.id === id && (!S.brief || S.brief.id !== id)) setTimeout(() => loadBrief(id), 0); }
    if (id && !ID.test(id)) return H().page(H().head({ eyebrow: '<a data-xag="list">Agents</a>', title: 'Agent not found' }) + H().box('bot', 'This agent link is not valid', 'Agents are addressed by their id. Open it from your agents.', H().btn('All agents', 'data-xag="list"', true)), 'xag');
    const key = (id ? 'one:' + id : 'list') + '@' + (wsId() || '');
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; if (!id || !S.minted || S.minted.agentId !== id) S.minted = null; setTimeout(load, 0); }
    const h = H();
    if (S.status === 'loading') return h.page(`<div class="xag-skel" aria-busy="true"><i></i><i></i><i></i></div>`, 'xag');
    if (S.status === 'error') return h.page(h.box('alert', 'Your agents could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xag="retry"')), 'xag');
    if (S.status === 'denied') return h.page(h.box('lock', 'Only a person manages agents', 'Sign in as yourself to see your agents.'), 'xag');
    if (S.status === 'missing') return h.page(h.head({ eyebrow: '<a data-xag="list">Agents</a>', title: 'Agent not found' }) + h.box('bot', 'This agent is gone', 'It was deleted, or it is not yours.', h.btn('All agents', 'data-xag="list"', true)), 'xag');
    return id ? onePage() : listPage();
  }
  /** the breadcrumb's name for an agent address: its name, never its id */
  const nameOf = (id) => { const a = (S.one && S.one.id === id) ? S.one : S.list.find((x) => x.id === id); return a ? a.name : 'Agent'; };

  // ───────────────────────── actions
  async function call(method, path, body, fail) {
    if (S.busy) return null;
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) { toast(why(r, fail)); paint(); return null; }
    return r;
  }
  async function create() {
    const v = await D().form({ title: 'New agent', sub: 'It gets its own identity in XENO. You choose what it works on next.', submit: 'Create agent', size: 'sm', fields: [
      { id: 'name', label: 'Name', required: true, placeholder: 'Release Bot', max: 60 },
      { id: 'description', label: 'What it is for', type: 'textarea', placeholder: 'Takes release tasks, cuts builds and reports back', max: 500 },
      ...(S.divisions.length && S.canManageDivisions ? [{ id: 'division', label: 'Division', type: 'choice', cols: 1, value: '', options: [['', 'No division', 'Works only on projects in no division'], ...S.divisions.map((d) => [d.id, d.name, `Works only on ${d.name}’s projects`])] }] : [])] });
    if (!v) return;
    const r = await call('POST', '/api/agents', { name: v.name, description: v.description || '', divisionId: v.division || null, workspaceId: wsId() }, 'The agent could not be created.');
    if (!r) return;
    toast(`Created ${r.d.agent.name}`); S.list.push(r.d.agent);
    // The next decision is WHERE it runs. Ask it now, then land on the part of its page that does it; skipping lands on
    // the page as before. Its instructions stay inherited from the task or project it is given, so none are asked here.
    const w = await D().form({ title: `Where will ${r.d.agent.name} run?`, sub: 'You can change this, or run it in more than one place, any time.', submit: 'Continue', size: 'sm', fields: [
      { id: 'where', label: 'Runs', type: 'choice', cols: 1, value: 'spawn', options: [
        ['spawn', 'On my computer, with XENO Spawn', 'Claude Code or Codex in a terminal, signed in as this agent'],
        ['cloud', 'In the cloud', 'XENO runs it when you hand it a task. Nothing to install'],
        ['claude', 'In another agent CLI', 'Claude Code, Codex or any MCP client, with a credential you make'],
      ] }] });
    // land on Connect with that choice made; skipping lands on its Overview (three steps)
    S.tab = w && w.where === 'spawn' ? 'spawn' : 'claude';
    S.place = w ? (w.where === 'claude' ? 'cli' : w.where) : 'cli';
    go(`Agents/${r.d.agent.id}${w ? '/Connect' : ''}`);
  }
  async function edit() {
    const a = S.one; if (!a) return;
    const v = await D().form({ title: `Edit ${a.name}`, sub: 'Its id stays the same, so everything connected to it keeps working.', submit: 'Save', size: 'sm', fields: [
      { id: 'name', label: 'Name', required: true, value: a.name, max: 60 },
      { id: 'description', label: 'What it is for', type: 'textarea', value: a.description || '', max: 500 }] });
    if (!v) return;
    const r = await call('PATCH', `/api/agents/${a.id}`, { name: v.name, description: v.description || '' }, 'That could not be saved.');
    if (r) { S.one = r.d.agent; toast('Saved'); paint(); }
  }
  async function remove() {
    const a = S.one; if (!a) return;
    if (!(await D().confirm({ title: `Delete ${esc(a.name)}?`, body: `Every credential and connection of ${esc(a.name)} stops working at once, wherever it is running. The tasks and comments it wrote stay, under its name.`, action: 'Delete agent' }))) return;
    const r = await call('DELETE', `/api/agents/${a.id}`, undefined, 'The agent could not be deleted.');
    if (r) { toast(`Deleted ${a.name}`); S.list = S.list.filter((x) => x.id !== a.id); S.one = null; S.minted = null; go('Agents'); }
  }
  async function mint() {
    const a = S.one; if (!a) return;
    const ttl = Number(document.querySelector('.xag [data-xag-ttl]')?.value || 720);
    const r = await call('POST', `/api/agents/${a.id}/credentials`, { ttlHours: ttl, label: 'Made in Agents' }, 'A credential could not be made.');
    if (!r) return;
    S.minted = { agentId: a.id, token: r.d.credential.token, expiresAt: r.d.credential.expiresAt };
    if (S.tab === 'spawn') S.tab = 'claude';
    await refreshOne(); paint();
  }
  async function revoke(cid) {
    const a = S.one; if (!a) return;
    if (!(await D().confirm({ title: 'Revoke this credential?', body: 'Anything using it is refused on its very next request.', action: 'Revoke' }))) return;
    const r = await call('DELETE', `/api/agents/${a.id}/credentials/${encodeURIComponent(cid)}`, undefined, 'That could not be revoked. It still works.');
    if (!r) return;
    if (S.minted && S.minted.agentId === a.id) S.minted = null;
    await refreshOne(); toast('Revoked'); paint();
  }
  async function project(pid, on) {
    const a = S.one; if (!a) return;
    const r = await call(on ? 'PUT' : 'DELETE', `/api/agents/${a.id}/projects/${encodeURIComponent(pid)}`, on ? { access: 'editor' } : undefined, 'That could not be changed.');
    if (r) { S.one = r.d.agent; toast(on ? 'It can work there now' : 'It can no longer see that project'); }
    const ch = await api('GET', `/api/agents/${a.id}/project-choices`); if (ch.ok) S.choices = ch.d.projects || [];
    paint();
  }
  async function moveDivision() {
    const a = S.one; if (!a) return;
    const opts = [['', 'No division', 'Works only on projects in no division'], ...S.divisions.map((d) => [d.id, d.name, d.id === (a.division && a.division.id) ? 'Where it is now' : ''])];
    const v = await D().form({ title: a.division ? `Move ${a.name}` : `Put ${a.name} in a division`, sub: 'An agent belongs to one division and works only on its projects. Projects outside the new division are taken away.', submit: 'Move', size: 'sm', fields: [
      { id: 'division', label: 'Division', type: 'choice', cols: 1, value: a.division ? a.division.id : '', options: opts }] });
    if (!v) return;
    const before = a.projects.length;
    const r = await call('PUT', `/api/agents/${a.id}/division`, { divisionId: v.division || null }, 'It could not be moved.');
    if (!r) return;
    S.one = r.d.agent; const lost = before - S.one.projects.length;
    const ch = await api('GET', `/api/agents/${a.id}/project-choices`); if (ch.ok) S.choices = ch.d.projects || [];
    toast(`${S.one.name} ${S.one.division ? 'now works in ' + S.one.division.name : 'is in no division'}${lost > 0 ? ` — ${lost} project${lost > 1 ? 's' : ''} taken away` : ''}`); paint();
  }
  async function editRuntime() {
    const a = S.one; if (!a) return;
    const rt = a.runtime || {}; const tools = rt.tools || {};
    const v = await D().form({ title: `How ${a.name} runs`, sub: 'Saved with its instructions as a new version. Work already running keeps its version.', submit: 'Save version', size: 'sm', fields: [
      { id: 'model', label: 'Model', value: rt.model || '', max: 128, placeholder: 'Leave empty to let the CLI choose', hint: S.models.length ? 'For example ' + S.models.slice(0, 4).join(', ') : '' },
      { id: 'effort', label: 'Reasoning', type: 'seg', value: rt.effort || '', options: [['', 'CLI'], ...EFFORTS.map((e) => [e, EFFORT_LABEL[e]])] },
      { id: 'allow', label: 'Only these tools', value: (tools.allow || []).join(', '), max: 2000, placeholder: 'Empty = every tool', hint: 'Tool names, separated by commas. For example Read, Edit, XenoTaskComment' },
      { id: 'deny', label: 'Never these tools', value: (tools.deny || []).join(', '), max: 2000, placeholder: 'For example Bash' }] });
    if (!v) return;
    const runtime = {};
    if (v.model) runtime.model = v.model;
    if (v.effort) runtime.effort = v.effort;
    const names = (x) => [...new Set(String(x || '').split(/[,\s]+/).map((t) => t.trim()).filter(Boolean))];
    const allow = names(v.allow), deny = names(v.deny);
    if (allow.length || deny.length) runtime.tools = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) };
    const r = await call('PATCH', `/api/agents/${a.id}`, { runtime }, 'It could not be saved.');
    if (r) { S.one = r.d.agent; toast(`Saved as version ${S.one.version}`); paint(); }
  }
  async function saveInstructions(form) {
    const a = S.one; if (!a) return;
    const r = await call('PATCH', `/api/agents/${a.id}`, { instructions: form.instructions.value }, 'The instructions could not be saved.');
    if (r) { S.one = r.d.agent; S.editingInstr = false; toast(`Saved as version ${S.one.version}`); paint(); }
  }
  async function lend() {
    const a = S.one; if (!a) return;
    const taken = new Set((a.lentTo || []).map((l) => l.division ? l.division.id : 'ws:' + l.workspace.id));
    const opts = S.divisions.filter((d) => d.id !== (a.division && a.division.id) && !taken.has(d.id)).map((d) => [d.id, d.name, `Works on ${d.name}’s projects too`]);
    if (!opts.length) return toast(S.divisions.length ? 'It already works in every division here' : 'Create a division first — or lend it from the other workspace’s Divisions page');
    const v = await D().form({ title: `Lend ${a.name}`, sub: 'It keeps its owner, its own division and who pays for it. You can end it at any time.', submit: 'Lend', size: 'sm', fields: [
      { id: 'division', label: 'To', type: 'choice', cols: 1, required: true, options: opts }] });
    if (!v) return;
    const r = await call('POST', `/api/agents/${a.id}/lend`, { divisionId: v.division }, 'It could not be lent.');
    if (!r) return;
    S.one = r.d.agent; const l = S.one.lentTo.find((x) => x.division && x.division.id === v.division);
    const ch = await api('GET', `/api/agents/${a.id}/project-choices`); if (ch.ok) S.choices = ch.d.projects || [];
    toast(l && l.state === 'accepted' ? `${a.name} now also works in ${l.division.name}` : 'Offered — its admin decides'); paint();
  }
  async function unlend(id) {
    const a = S.one; const l = (a.lentTo || []).find((x) => x.id === id); if (!l) return;
    if (!(await D().confirm({ title: l.state === 'accepted' ? `Stop ${esc(a.name)} working in ${esc(l.division ? l.division.name : l.workspace.name)}?` : 'Withdraw the offer?', body: l.state === 'accepted' ? `It loses that division’s projects at once. Its history there stays.` : 'Nothing was granted yet.', action: l.state === 'accepted' ? 'End' : 'Withdraw' }))) return;
    const r = await call('POST', `/api/agents/lends/${encodeURIComponent(id)}/revoke`, undefined, 'It could not be ended.');
    if (r) { await refreshOne(); const ch = await api('GET', `/api/agents/${a.id}/project-choices`); if (ch.ok) S.choices = ch.d.projects || []; toast('Ended'); paint(); }
  }
  async function decideOffer(id, accept) {
    const r = await call('POST', `/api/agents/lends/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`, undefined, 'That could not be decided.');
    if (!r) return;
    S.offers = S.offers.filter((o) => o.id !== id); toast(accept ? `Accepted — it works in ${r.d.lend.division ? r.d.lend.division.name : r.d.lend.workspace.name} now` : 'Declined'); paint();
  }
  async function webhook(off) {
    const a = S.one; if (!a) return;
    let url = null;
    if (!off) {
      const v = await D().form({ title: `Where ${a.name} hears about new work`, sub: 'XENO posts each task delegated to it to this address, signed so it can check the message is really from XENO.', submit: 'Save', size: 'sm', fields: [{ id: 'url', label: 'Webhook address', required: true, value: a.webhook || '', placeholder: 'https://example.com/xeno-tasks', max: 2000 }] });
      if (!v) return; url = v.url;
    } else if (!(await D().confirm({ title: 'Remove the webhook?', body: `${esc(a.name)} will only find new work by asking XENO.`, action: 'Remove' }))) return;
    const r = await call('PUT', `/api/agents/${a.id}/webhook`, { url }, 'The webhook could not be saved.');
    if (!r) return;
    S.hook = r.d.secret ? { agentId: a.id, secret: r.d.secret } : null;
    await refreshOne(); toast(off ? 'Removed' : 'Saved'); paint();
  }
  // ── the redesigned page's controls (agentOverview.js on the server)
  async function handTask() {
    const a = S.one; if (!a) return;
    if (!a.projects.length) { toast(`Give ${a.name} a project first`); return go(`Agents/${a.id}/Work`); }
    const open = (await api('GET', '/api/tasks?status=raised,todo,in_progress,blocked')).d;
    const mine = new Set(a.projects.map((p) => p.id));
    const tasks = ((open && open.tasks) || []).filter((t) => t.project && mine.has(t.project.id) && !(t.delegate && t.delegate.id === a.userId)).slice(0, 60);
    if (!tasks.length) return toast(`No open task in ${a.name}’s projects that it is not already on`);
    const v = await D().form({ title: `Hand ${a.name} a task`, sub: `It works on it as ${a.name} and sends it back for review. It never accepts its own work.`, submit: 'Hand it over', size: 'sm', fields: [
      { id: 'task', label: 'Task', type: 'choice', cols: 1, required: true, value: tasks[0].key, options: tasks.map((t) => [t.key, `${t.key} ${t.title}`, t.project ? t.project.name : '']) }] });
    if (!v) return;
    const r = await call('PATCH', `/api/tasks/${encodeURIComponent(v.task)}`, { delegateId: a.userId }, 'It could not be handed over.');
    if (r) { toast(`${a.name} has ${v.task}`); loadOverview(a.id); }
  }
  async function setCap() {
    const a = S.one; if (!a) return;
    const curCap = S.ov && S.ov.spend ? S.ov.spend.capCredits : null;
    const v = await D().form({ title: `${a.name}’s spending cap`, sub: 'What it may spend through XENO tools (images, video, model calls) over any 30 days. A spend past it is refused. Empty removes the cap.', submit: 'Save', size: 'sm', fields: [
      { id: 'credits', label: 'Credits every 30 days', value: curCap != null ? String(curCap) : '', max: 10, placeholder: 'No cap' }] });
    if (!v) return;
    const n = String(v.credits || '').trim();
    const r = await call('PUT', `/api/agents/${a.id}/spend-cap`, { credits: n === '' ? null : Number(n) }, 'The cap could not be saved.');
    if (r) { toast(r.d.capCredits == null ? 'Cap removed' : `Capped at ${r.d.capCredits} credits`); loadOverview(a.id); }
  }
  async function pauseConn(cid, pause) {
    const a = S.one; if (!a) return;
    const r = await call('POST', `/api/agents/${a.id}/connections/${encodeURIComponent(cid)}/${pause ? 'pause' : 'resume'}`, {}, pause ? 'It could not be paused.' : 'It could not be resumed.');
    if (r) { await refreshOne(); toast(pause ? `${r.d.connection.client} is paused — its next call is refused` : `${r.d.connection.client} works again`); loadOverview(a.id); paint(); }
  }
  async function sendMessage(form) {
    const a = S.one; if (!a) return;
    const body = form.body.value.trim(); if (!body) return;
    const r = await call('POST', `/api/agents/${a.id}/message`, { body }, 'The message could not be sent.');
    if (r) { form.body.value = ''; toast(`Sent on ${r.d.task}. ${a.name} sees it at its next step.`); loadActivity(a.id); }
  }
  async function loadBrief(id) {
    const r = await api('GET', `/api/agents/${id}/brief`);
    if (!S.one || S.one.id !== id) return;
    S.brief = { id, text: r.ok ? r.d.text : 'It could not be loaded just now.' }; paint();
  }
  async function savePersona(form) {
    const a = S.one; if (!a) return;
    const known = {}; for (const [k] of ID_SECTIONS) known[k] = form[`s_${k}`] ? form[`s_${k}`].value : '';
    const persona = { role: form.role.value.trim(), body: joinBody(known, form.rest ? form.rest.value : '') };
    const r = await call('PATCH', `/api/agents/${a.id}`, { persona: persona.role || persona.body ? persona : null }, 'Who it is could not be saved.');
    if (r) { S.one = r.d.agent; toast(`Saved as version ${S.one.version}`); loadBrief(a.id); paint(); }
  }
  async function clearPersona() {
    const a = S.one; if (!a) return;
    if (!(await D().confirm({ title: `Clear who ${esc(a.name)} is?`, body: 'It keeps its instructions and works the XENO way. Earlier versions keep their persona.', action: 'Clear' }))) return;
    const r = await call('PATCH', `/api/agents/${a.id}`, { persona: null }, 'It could not be cleared.');
    if (r) { S.one = r.d.agent; toast(`Saved as version ${S.one.version}`); loadBrief(a.id); paint(); }
  }
  async function exportMind() {
    const a = S.one; if (!a) return;
    const r = await api('GET', `/api/agents/${a.id}/mind`);
    if (!r.ok) return toast(why(r, 'It could not be exported.'));
    const url = URL.createObjectURL(new Blob([r.d.text], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = r.d.filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importMind() {
    const a = S.one; if (!a) return;
    const v = await D().form({ title: `Import a Mind into ${a.name}`, sub: 'Paste a mind.xeno from Anima or another agent. Its role and sections become this agent’s next version; its name stays this agent’s. A Mind that tries to take over the agent is refused.', submit: 'Import', size: 'sm', fields: [
      { id: 'text', label: 'mind.xeno', type: 'textarea', required: true, rows: 12, max: 65536, placeholder: '---\nxeno_mind_version: 1\nid: atlas\nname: Atlas\nrole: a careful payments engineer\n---\n\n# Voice\n\n…' }] });
    if (!v) return;
    const r = await api('POST', `/api/agents/${a.id}/mind`, { text: v.text });
    if (!r.ok) return toast(why(r, 'It could not be imported.') + (r.d && r.d.details && r.d.details.length ? ' — ' + String(r.d.details[0]).split('\n')[0] : ''));
    S.one = r.d.agent; toast(`Imported as version ${S.one.version}`); loadBrief(a.id); paint();
  }
  const openTab = (tab) => S.one && go(`Agents/${S.one.id}${tab ? '/' + tab : ''}`);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); S.copied = text; paint(); clearTimeout(copy.t); copy.t = setTimeout(() => { S.copied = ''; paint(); }, 1600); }
    catch { toast('Copy is blocked here. Select the text and copy it yourself.'); }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xag]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xag;
    if (a === 'open') return go(`Agents/${b.dataset.id}`);
    if (a === 'list') return go('Agents');
    if (a === 'new') return create();
    if (a === 'edit') return edit();
    if (a === 'delete') return remove();
    if (a === 'mint') return mint();
    if (a === 'activity-refresh') { if (S.one) { loadActivity(S.one.id); loadPresence(); } return; }
    if (a === 'activity-more') return S.one && loadActivity(S.one.id, true);
    if (a === 'revoke') return revoke(b.dataset.id);
    if (a === 'copy') return copy(b.dataset.copy);
    if (a === 'tab') { S.tab = b.dataset.k; return paint(); }
    if (a === 'spawnprog' && SPAWN_PROGRAMS[b.dataset.k]) { S.spawnProg = b.dataset.k; return paint(); }
    if (a === 'lend') return lend();
    if (a === 'unlend') return unlend(b.dataset.id);
    if (a === 'accept') return decideOffer(b.dataset.id, true);
    if (a === 'decline') return decideOffer(b.dataset.id, false);
    if (a === 'webhook') return webhook(false);
    if (a === 'webhook-off') return webhook(true);
    if (a === 'division') return moveDivision();
    if (a === 'open-division') return go(`Divisions/${b.dataset.id}`);
    if (a === 'divisions') return go('Divisions');
    if (a === 'runtime') return editRuntime();
    if (a === 'move') return moveTo();
    if (a === 'takeover') return takeOver();
    if (a === 'handover') return handOver();
    if (a === 'grant') return grant();
    if (a === 'ungrant') return ungrant(b.dataset.id, b.dataset.k);
    if (a === 'move-accept') return decideMove(b.dataset.id, true);
    if (a === 'move-decline') return decideMove(b.dataset.id, false);
    if (a === 'run-cloud') return S.one && startRun(S.one);
    if (a === 'stop-run') return stopRun(b.dataset.id);
    if (a === 'open-task') return b.dataset.k && X()?.go?.('tasks', { item: b.dataset.k });
    if (a === 'instr-edit') { S.editingInstr = true; paint(); return setTimeout(() => document.querySelector('.xag-instr textarea')?.focus(), 0); }
    if (a === 'instr-cancel') { S.editingInstr = false; return paint(); }
    if (a === 'calls') return X()?.go?.('product', { product: 'mcp', item: `c/${b.dataset.id}` });
    if (a === 'retry') { S.key = null; return paint(); }
    if (a === 'clearq') { S.q = ''; return paint(); }
    if (a === 'hand') return handTask();
    if (a === 'cap') return setCap();
    if (a === 'pause' || a === 'resume') return pauseConn(b.dataset.id, a === 'pause');
    if (a === 'watch') { S.watch = !S.watch; if (S.watch && S.one) loadTrace(S.one.id); return paint(); }
    if (a === 'place') { S.place = b.dataset.k; S.tab = b.dataset.k === 'spawn' ? 'spawn' : (S.tab === 'spawn' ? 'claude' : S.tab); return paint(); }
    if (a === 'act-kind') { S.actKind = b.dataset.k; return paint(); }
    if (a === 'proj-toggle') return project(b.dataset.id, b.dataset.on === '1');
    if (a === 'mind-export') return exportMind();
    if (a === 'mind-import') return importMind();
    if (a === 'persona-clear') return clearPersona();
    if (a === 'brief-refresh') return S.one && loadBrief(S.one.id);
  });
  // header tabs and every "go to that tab" link: a real address, so refresh and Back land on the same tab
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-xag-tab]'); if (!b || !b.closest('#main') || !S.one) return; e.preventDefault(); openTab(b.dataset.xagTab); });
  // keys on an agent's page: 1–6 the tabs, T hands it a task, S stops its live cloud run. Never while typing.
  document.addEventListener('keydown', (e) => {
    if (!S.one || !document.querySelector('#main .xag-one') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target; if (t && (t.closest('input,textarea,select,[contenteditable="true"]') || t.isContentEditable)) return;
    // an open dialog (a form, a confirm, the shortcuts sheet) owns the keyboard; the search palette is not modal
    if ([...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some((d) => d.offsetParent !== null || d.getClientRects().length)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= AGENT_TABS.length) { e.preventDefault(); return openTab(AGENT_TABS[n - 1][0]); }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); return handTask(); }
    if ((e.key === 's' || e.key === 'S') && S.runsFor === S.one.id) { const live = S.runs.find((r) => LIVE_RUN.has(r.state)); if (live) { e.preventDefault(); return stopRun(live.id); } }
  });
  document.addEventListener('submit', (e) => { const f = e.target.closest('.xag [data-xag-form]'); if (!f) return; e.preventDefault(); if (f.dataset.xagForm === 'instr') saveInstructions(f); else if (f.dataset.xagForm === 'msg') sendMessage(f); else if (f.dataset.xagForm === 'identity') savePersona(f); });
  document.addEventListener('change', (e) => { const c = e.target.closest('.xag [data-xag-proj]'); if (c) project(c.dataset.xagProj, c.checked); });
  document.addEventListener('input', (e) => { const q = e.target.closest('.xag [data-xag-q]'); if (!q) return; S.q = q.value; const pos = q.selectionStart; paint(); const n = document.querySelector('.xag [data-xag-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });

  const style = () => {
    if (document.getElementById('xag-css')) return; const s = document.createElement('style'); s.id = 'xag-css';
    s.textContent = [
      '.xag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}',
      '.xag-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}',
      '.xag-card:hover{border-color:var(--muted);background:var(--hover)}.xag-card:focus-visible{outline:2px solid var(--text);outline-offset:2px}',
      '.xag-card-b{display:flex;flex-direction:column;gap:4px;min-height:44px}.xag-card-b b{font-size:14px;font-weight:600}.xag-card-b small{font-size:12.5px;color:var(--muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.xag-card-f{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}.xag-card-f>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.xag-mono{position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:var(--n24);font-size:13px;font-weight:600;letter-spacing:.02em;flex:none}.xag-mono--lg{width:64px;height:64px;border-radius:10px;font-size:21px}',
      '.xag-dot{position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:3px;border:2px solid var(--panel);box-sizing:content-box;background:var(--dim)}.xag-mono--lg .xag-dot{width:13px;height:13px;border-radius:4px}',
      '.xag-avail{display:block;margin-top:4px;color:var(--muted);font-size:12px}.xag-logs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}.xag-log{display:flex;align-items:flex-start;gap:10px;padding:7px 8px;border-radius:8px}.xag-log:hover{background:var(--hover,rgba(255,255,255,.04))}.xag-log .xag-row-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.xag-log .xag-row-b small{color:var(--muted)}.xag-log time{flex:none;color:var(--muted);font-size:12px}.xag-log--bad .xag-row-b small{color:var(--text)}.xag-log code{font-size:12px}.xag-dot--off{background:transparent;border:1px solid var(--muted)}.xag-dot--new{background:transparent;border:1px dashed var(--muted)}',
      '',
      '',
      '.xag-st{font-size:12px;color:var(--muted);white-space:nowrap}.xag-st--working,.xag-st--online{color:color-mix(in srgb,#22c55e 45%,var(--text))}.xag-st--asking{color:rgba(234,179,8,.8)}.xag-st--error{color:rgba(239,68,68,.75)}.xag-st--ready{color:var(--text)}',
      '.xag-first{display:flex;flex-direction:column;align-items:center;text-align:center;max-width:620px;margin:40px auto 0;gap:14px}',
      '.xag-first-art{display:flex;align-items:center;gap:0;margin-bottom:8px}.xag-first-art span{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;border:1px solid var(--border);background:var(--panel)}.xag-first-art span:first-child{background:var(--control)}',
      '.xag-first-art i{width:44px;height:1px;background:linear-gradient(90deg,var(--border),var(--muted),var(--border))}',
      '.xag-first h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em}.xag-first p{margin:0;font-size:13.5px;line-height:1.6;color:var(--muted)}',
      '.xag-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;margin:8px 0 6px;padding:0;list-style:none;counter-reset:s}',
      '.xag-steps li{display:flex;flex-direction:column;gap:3px;padding:12px;border:1px solid var(--border);border-radius:12px;text-align:left;counter-increment:s}.xag-steps li::before{content:counter(s);font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}',
      '.xag-steps b{font-size:13px}.xag-steps span{font-size:12px;color:var(--muted);line-height:1.45}',
      '.xag-run{margin-bottom:22px;padding:16px;border:1px solid var(--n31);border-radius:8px;background:var(--panel)}',
      // the page's three bands: run it · give it work · how it works · access. A quiet label, the workspace's own type
      '.xag-group{margin-bottom:10px}.xag-group+.xag-group{padding-top:18px;border-top:1px solid var(--n29)}.xag-group-h{margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}',
      '.xag-prog{display:inline-flex;margin-top:14px}',
      // Open in Spawn: the workspace card surface, the button and its small print side by side (wraps on a phone)
      '.xag-spawn{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding:10px 12px;border:1px solid var(--n31);border-radius:8px;background:var(--n20)}.xag-spawn .pg-btn{color:var(--n10);text-decoration:none}.xag-spawn small{flex:1;min-width:200px;font-size:12px;line-height:1.45;color:var(--muted)}',
      '.xag-run-h{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}.xag-run-h>div:first-child{flex:1;min-width:240px}.xag-run-h h3{margin:0 0 4px;font-size:15px;font-weight:600}.xag-run-h p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.5}',
      '.xag-mint{display:flex;align-items:center;gap:8px}.xag-mint select{height:32px;padding:0 8px;border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--text);font:inherit;font-size:12.5px}',
      '.xag-secret{display:flex;flex-direction:column;gap:8px;margin-top:14px;padding:12px 14px;border:1px solid var(--text);border-radius:8px;background:var(--canvas)}.xag-secret>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.xag-secret b{display:flex;align-items:center;gap:7px;font-size:13px}.xag-secret small{font-size:12px;color:var(--muted)}.xag-secret-v{display:flex;align-items:center;gap:8px}.xag-secret-v code{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.xag-tabs{display:flex;gap:2px;margin:16px 0 0;border-bottom:1px solid var(--border);overflow-x:auto}.xag-tabs button{border:0;background:none;color:var(--muted);font:inherit;font-size:12.5px;padding:7px 10px;margin-bottom:-1px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.xag-tabs button:hover{color:var(--text)}.xag-tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text)}',
      '.xag-cmd{display:flex;align-items:flex-start;gap:10px;padding:12px 0 0}.xag-cmd pre{flex:1;min-width:0;margin:0;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--canvas);font:12px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}',
      '.xag-cmd-hint{align-self:center;font-size:12px;color:var(--dim);white-space:nowrap}',
      '.xag-copy{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.xag-copy:hover{background:var(--hover)}.xag-copy svg{width:14px;height:14px}',
      '.xag-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}',
      '.xag-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}',
      '.xag-check{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--n31);border-radius:8px;cursor:pointer;transition:border-color .15s}.xag-check:hover{border-color:var(--muted)}.xag-check.on{border-color:var(--text);background:var(--panel)}',
      '.xag-check input{margin-top:2px;accent-color:var(--text)}.xag-check span{display:flex;flex-direction:column;gap:3px}.xag-check b{font-size:13px;font-weight:500}.xag-check small{font-size:11.5px;color:var(--muted);line-height:1.45}',
      '.xag-svcs{display:flex;flex-wrap:wrap;gap:6px}.xag-svc{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px dashed var(--border);border-radius:6px;font-size:12px;color:var(--dim)}.xag-svc em{font-style:normal;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}',
      '.xag-svc.on{border-style:solid;border-color:var(--text);color:var(--text)}.xag-svc svg{width:13px;height:13px}',
      '.xag-rows{border:1px solid var(--n31);border-radius:8px;overflow:hidden}.xag-row{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)}.xag-row:last-child{border-bottom:0}',
      '.xag-row-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:6px;background:var(--n24)}.xag-row-ic svg{width:15px;height:15px}.xag-row-b{display:flex;flex-direction:column;gap:2px;min-width:0}.xag-row-b b{font-size:13px;font-weight:500}',
      '.xag-row-b code{font:12px ui-monospace,Consolas,monospace}.xag-row-b small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xag-row-m{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.xag-check.off{opacity:.55;cursor:default}.xag-check.off:hover{border-color:var(--border)}.xag-check{position:relative}.xag-check .xag-div{position:absolute;top:10px;right:10px;margin:0}',
      '.xag-div{display:inline-block;margin-top:6px;padding:1px 7px;border:1px solid var(--border);border-radius:4px;font-style:normal;font-size:11px;color:var(--muted);width:max-content}',
      '.xag-divbox{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.xag-divbox p{margin:0;font-size:12.5px;line-height:1.5;color:var(--muted)}.xag-divbox a{color:var(--text);cursor:pointer;text-decoration:underline}',
      '.xag-instr{display:flex;flex-direction:column;gap:8px}.xag-instr textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--canvas);color:var(--text);font:12.5px/1.55 ui-monospace,Consolas,monospace;resize:vertical;outline:none}.xag-instr textarea:focus{border-color:var(--muted)}',
      '.xag-instr-a{display:flex;align-items:center;gap:8px}.xag-instr-a small{flex:1;font-size:12px;color:var(--muted)}',
      '.xag-instr-v{margin:0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);font:12.5px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}',
      '.xag-vers{margin-top:8px;font-size:12.5px;color:var(--muted)}.xag-vers summary{cursor:pointer}.xag-vers ol{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}.xag-vers li{display:flex;gap:8px;align-items:baseline}.xag-vers li b{color:var(--text);font-size:12px}.xag-vers small{font-size:11.5px}',
      '.xag-paused{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:16px;border:1px solid var(--text);border-radius:8px}.xag-paused b{display:flex;gap:8px;align-items:center;font-size:14px}.xag-paused p{margin:4px 0 0;color:var(--muted);font-size:13px;line-height:1.5}',
      '.xag-own dd a{cursor:pointer;text-decoration:underline;text-underline-offset:3px}.xag-sub{margin-top:14px}.xag-sub h4{margin:0;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.02em}',
      '.xag-right{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 8px;margin-right:4px;border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--text)}.xag-right button{display:inline-flex;border:0;background:none;color:var(--muted);cursor:pointer;padding:2px}.xag-right button:hover{color:var(--text)}.xag-right svg{width:11px;height:11px}',
      '.xag-offers{display:flex;flex-direction:column;gap:0;margin-bottom:16px;border:1px solid var(--text);border-radius:8px;overflow:hidden}.xag-offers h3{margin:0;padding:10px 14px;font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}.xag-offers .xag-row{grid-template-columns:auto 1fr auto auto}',
      '.xag-none{margin:0;padding:14px;font-size:12.5px;color:var(--muted)}',
      '.xag-id{display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 18px;margin-bottom:16px;border-bottom:1px solid var(--border);text-align:center}.xag-id b{font-size:15px}',
      '.xag-idbtn{border:0;background:none;padding:0;color:var(--muted);font:11.5px ui-monospace,Consolas,monospace;cursor:pointer}.xag-idbtn:hover{color:var(--text)}',
      '.xag-skel{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;padding-top:60px}.xag-skel i{height:132px;border-radius:14px;background:var(--panel);animation:xags 1.2s ease-in-out infinite alternate}@keyframes xags{to{opacity:.5}}',
      // the redesigned agent page: small corners, squares not circles, emphasis by lightness (DESIGN_SYSTEM.md)
      '.xag-one{display:flex;flex-direction:column;gap:18px}.xag-cols{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}.xag-main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:18px}.xag-side{flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:14px}',
      '.xag-sq{display:inline-block;width:7px;height:7px;border-radius:1px;background:var(--text);flex:none}.xag-sq.off{background:transparent;border:1.5px solid var(--muted);box-sizing:border-box}',
      '.xag-k{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}.xag-pill{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:2px;background:var(--n24);font-size:11px;font-weight:500}',
      '.xag-tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:2px;background:var(--n24);font-size:11px;font-weight:500;color:var(--text);white-space:nowrap}.xag-tag.on{background:var(--text);color:var(--canvas)}',
      '.xag-needs{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px}.xag-att{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 12px;border:1px solid var(--n31);border-radius:4px;background:var(--panel);min-width:0}.xag-att-k{flex:none;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}.xag-att-t{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xag-now{padding:18px;border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xag-now-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}.xag-now-src{margin-left:auto;font-size:12px;color:var(--muted)}',
      '.xag-now-b{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}.xag-now-t{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:3px}.xag-now-t b{font-size:17px;font-weight:600;letter-spacing:-.01em}.xag-now-t small{font-size:12px;color:var(--muted)}.xag-now-t small a{color:var(--text)}.xag-now-a{display:flex;gap:8px;flex-wrap:wrap}',
      '.xag-report{display:flex;gap:10px;align-items:center;margin:12px 0 0;padding:10px 12px;border:1px solid var(--border);border-radius:4px;background:var(--canvas);font-size:12.5px}',
      '.xag-trace{margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:4px;background:var(--canvas);font:12px/1.7 ui-monospace,Consolas,monospace}.xag-trace>div{display:grid;grid-template-columns:52px 1fr auto;gap:10px;color:var(--muted)}.xag-trace>div:first-child{color:var(--text)}.xag-trace p{margin:6px 0 0;font-family:Inter,system-ui,sans-serif;font-size:12px;line-height:1.5;color:var(--dim)}',
      '.xag-stats{display:grid;grid-template-columns:1fr 1fr 1.6fr;gap:20px;margin-top:18px;padding-top:14px;border-top:1px solid var(--border);align-items:end}.xag-stats>div{display:flex;flex-direction:column;gap:2px;min-width:0}.xag-stats small{font-size:12px;color:var(--muted)}.xag-stats b{font-size:15px;font-weight:600}.xag-stats .pg-link{font-size:12px}',
      '.xag-spark-w>small:first-child{display:flex;justify-content:space-between;gap:8px}.xag-spark{display:flex;align-items:flex-end;gap:3px;height:44px;margin-top:6px}.xag-spark i{flex:1;background:var(--n31);border-radius:1px;min-height:2px}.xag-spark i.t{background:var(--text)}.xag-stats .xag-spark-n{margin-top:4px;font-size:11px;color:var(--dim)}',
      '.xag-ask{display:flex;gap:8px;align-items:center;padding:6px 6px 6px 14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xag-ask input{flex:1;min-width:0;height:32px;border:0;background:none;color:var(--text);font:inherit;font-size:13px;outline:none}.xag-ask input::placeholder{color:var(--dim)}.xag-ask input:disabled{cursor:not-allowed}',
      '.xag-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.xag-empty{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px;border:1px dashed var(--n31);border-radius:6px}.xag-empty p{margin:0;font-size:12.5px;color:var(--muted)}',
      '.xag-logs--box{border:1px solid var(--n31);border-radius:6px;padding:4px}.xag-day{margin:16px 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}.xag-more{margin-top:10px}',
      '.xag-box{padding:14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel);display:flex;flex-direction:column;gap:10px}.xag-box-h{display:flex;align-items:center;gap:8px}.xag-box-h h3{margin:0;font-size:13px;font-weight:600;flex:1}.xag-box .xag-none{padding:0}',
      '.xag-place{display:flex;align-items:center;gap:10px}.xag-place span{flex:1;min-width:0;display:flex;flex-direction:column}.xag-place b{font-size:13px;font-weight:500}.xag-place small{font-size:12px;color:var(--muted)}.xag-sm{height:26px;padding:0 9px;font-size:12px}',
      '.xag-chips{display:flex;flex-wrap:wrap;gap:6px}.xag-chip{height:30px;padding:0 12px;border:1px solid var(--n31);border-radius:4px;background:var(--panel);color:var(--text);font:inherit;font-size:12.5px;cursor:pointer}.xag-chip.on{background:var(--text);color:var(--canvas);border-color:var(--text)}.xag-chip:disabled{opacity:.5;cursor:default}',
      '.xag-start{max-width:820px}.xag-start h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.015em}.xag-start>p{margin:6px 0 18px;color:var(--muted);font-size:13.5px}',
      '.xag-steps2{list-style:none;margin:0;padding:0;border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xag-steps2 li{display:grid;grid-template-columns:32px 1fr;gap:14px;padding:18px;border-top:1px solid var(--border)}.xag-steps2 li:first-child{border-top:0}.xag-steps2 li>div{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.xag-steps2 b{font-size:14px}.xag-steps2 small{font-size:12.5px;color:var(--muted)}',
      '.xag-n{width:28px;height:28px;border-radius:3px;border:1.5px solid var(--n31);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--muted);box-sizing:border-box}.xag-n svg{width:14px;height:14px}.xag-steps2 li.cur .xag-n{border-color:var(--text);color:var(--text)}.xag-steps2 li.done .xag-n{background:var(--text);border-color:var(--text);color:var(--canvas)}',
      '.xag-h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em}.xag-lead{margin:2px 0 14px}',
      '.xag-places{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px}.xag-placecard{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;padding:14px 16px;border:1px solid var(--n31);border-radius:4px;background:var(--panel);color:var(--text);font:inherit;cursor:pointer}.xag-placecard b{font-size:13px;font-weight:600}.xag-placecard small{font-size:12px;color:var(--muted)}.xag-placecard.on{border-color:var(--text);background:var(--n24)}',
      '.xag-sets{border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xag-set{display:grid;grid-template-columns:200px 1fr auto;gap:24px;padding:18px 20px;border-top:1px solid var(--border);align-items:start}.xag-set:first-child{border-top:0}.xag-set h3{margin:0;font-size:13px;font-weight:600}.xag-set>div:first-child small{font-size:12px;color:var(--muted)}',
      '.xag-set-b{min-width:0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}.xag-set-b>*{max-width:100%}.xag-set-b b{font-size:13px;font-weight:500}.xag-dim{margin:0;font-size:12.5px;line-height:1.5;color:var(--muted)}.xag-set-a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
      '.xag-vtab{width:100%;border:1px solid var(--border);border-radius:4px;margin-top:8px;font-size:12.5px}.xag-vtab-r{display:grid;grid-template-columns:56px 1.4fr repeat(5,minmax(0,1fr));gap:10px;padding:8px 12px;border-top:1px solid var(--border);color:var(--muted)}.xag-vtab-r:first-child{border-top:0}.xag-vtab-r.cur{color:var(--text)}.xag-vtab-h{font-size:11.5px;color:var(--dim)}.xag-vtab .xag-note{padding:0 12px 10px}',
      '.xag-row-acts{display:flex;gap:6px}',
      '.xag-idwrap{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}.xag-idform{flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:12px}.xag-brief{flex:1 1 320px;min-width:0;padding:14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel);display:flex;flex-direction:column;gap:8px}.xag-brief .xag-instr-v{max-height:520px;font-size:12px}',
      '.xag-idf{display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:start}.xag-idf>span{display:flex;flex-direction:column;gap:2px;padding-top:6px}.xag-idf b{font-size:13px;font-weight:600}.xag-idf small{font-size:12px;color:var(--muted)}',
      '.xag-idf input,.xag-idf textarea{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--n31);border-radius:4px;background:var(--canvas);color:var(--text);font:inherit;font-size:13px;line-height:1.5;outline:none;resize:vertical}.xag-idf input:focus,.xag-idf textarea:focus{border-color:var(--muted)}',
      '.xag-idacts{display:flex;gap:8px;flex-wrap:wrap;padding-left:196px}@media (max-width:720px){.xag-idf{grid-template-columns:1fr;gap:6px}.xag-idacts{padding-left:0}}',
      '@media (max-width:720px){.xag-stats{grid-template-columns:1fr 1fr}.xag-spark-w{grid-column:1/-1}.xag-places{grid-template-columns:1fr}.xag-set{grid-template-columns:1fr;gap:10px}.xag-set-a{justify-content:flex-start}.xag-vtab-r{grid-template-columns:48px repeat(3,minmax(0,1fr))}.xag-vtab-r>:nth-child(n+5){display:none}.xag-needs{grid-template-columns:1fr}.xag-now-a{width:100%}}',
      '@media (max-width:720px){.xag-steps{grid-template-columns:1fr}.xag-run{padding:12px}.xag-mint{width:100%}.xag-mint select{flex:1}.xag-row{grid-template-columns:auto 1fr auto}.xag-row-m{display:none}.xag-cmd{flex-direction:column}}',
    ].join('');
    document.head.appendChild(s);
  };

  // the sidebar counts real agents of the SELECTED workspace: read them in the background, and again whenever the
  // workspace changes (the sidebar shows on every Workspace page, not only on Agents)
  S.sideWs = undefined;
  const refreshSide = async () => { const w = wsId() || ''; if (S.sideWs === w) return; S.sideWs = w; const r = await api('GET', '/api/agents' + wsQ()); if (r.ok && (wsId() || '') === w) { S.list = r.d.agents || []; loadPresence(); paint(); } };
  setTimeout(refreshSide, 1500);
  const hookSwitch = () => { if (!window.XA || window.XA.__agentsSwitch) return; const sw = window.XA.switchWorkspace; window.XA.switchWorkspace = (...a2) => { const r = sw(...a2); setTimeout(refreshSide, 0); return r; }; window.XA.__agentsSwitch = true; };
  hookSwitch(); if (document.readyState === 'loading') addEventListener('DOMContentLoaded', hookSwitch);
  // the Workspace sidebar: each agent with its presence, newest activity first; the dot class rides the meta
  const sidebar = () => S.list.slice().sort((x, y) => String((S.presence[y.id] || {}).seenAt || '').localeCompare(String((S.presence[x.id] || {}).seenAt || '')))
    .slice(0, 8).map((a) => { const [, l] = state(a); return [a.name, l, '', `Agents/${a.id}`]; });
  const dotOf = (item) => { const id = String(item || '').replace(/^Agents\//, ''); const a = S.list.find((x) => x.id === id); return a ? state(a)[0] : null; };
  // presence stays current while the page is open: every 30 s, only when the tab is visible
  // LIVE: the server pushes each agent's presence the moment it changes (agentPresenceStream.js — a database NOTIFY
  // when a run, a session, a credential or a connection moves, plus a 20 s server-side re-check for time-based
  // changes). The stream is one per tab, reconnects on its own, and pauses while the tab is hidden. If it cannot
  // open (an old server), the page falls back to asking every 30 s.
  let es = null, fallback = null;
  const live = () => {
    if (es || document.visibilityState !== 'visible' || typeof EventSource === 'undefined') return;
    es = new EventSource('/api/agents/presence/stream', { withCredentials: true });
    let painted = 0;
    es.addEventListener('presence', (ev) => {
      try { const x = JSON.parse(ev.data); S.presence[x.id] = x; S.livePushed.add(x.id); if (S.one && S.one.id === x.id) { clearTimeout(live.ov); live.ov = setTimeout(() => { loadOverview(x.id); loadActivity(x.id); }, 400); } } catch { return; }
      // a burst (the snapshot) paints once; a single change paints at once
      clearTimeout(painted); painted = setTimeout(() => { paint(); try { X()?.refreshPanel?.(); } catch {} }, 60);
    });
    es.addEventListener('ready', () => { if (fallback) { clearInterval(fallback); fallback = null; } });
    es.onerror = () => { if (es && es.readyState === 2) { es = null; if (!fallback) fallback = setInterval(() => { if (document.visibilityState === 'visible' && S.list.length) loadPresence(); }, 30_000); setTimeout(live, 5000); } };
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { live(); } else if (es) { es.close(); es = null; } });
  setTimeout(live, 0);
  window.XENO_AGENTS = { served: true, sidebar, dotOf, count: () => (S.status === 'ready' || S.list.length ? S.list.length : null), route, nameOf, isId: (s) => ID.test(String(s || '')), reload: () => { S.key = null; paint(); } };
})();
