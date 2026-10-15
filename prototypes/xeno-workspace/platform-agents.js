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
  const S = { key: null, status: 'idle', list: [], one: null, projects: [], services: [], minted: null, busy: false, copied: '', tab: 'claude', q: '', choices: [], divisions: [], canManageDivisions: false, editingInstr: false };
  const paint = () => { try { X()?.render?.(); } catch {} };
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
  const state = (a) => {
    const last = a.connections.map((c) => c.lastUsedAt).filter(Boolean).sort().pop();
    if (last && Date.now() - new Date(last).getTime() < 5 * 60e3) return ['live', 'Working now'];
    if (last) return ['idle', `Last worked ${ago(last).toLowerCase()}`];
    if (a.credentials.length) return ['ready', 'Ready to connect'];
    return ['new', 'Not connected yet'];
  };
  const mono = (name) => esc(String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());

  async function load() {
    const at = S.key;
    const [list, pr, sv] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/tasks/projects'),
      S.services.length ? null : api('GET', '/api/mcp/services')]);
    if (S.key !== at) return;
    if (!list.ok) { S.status = list.status === 403 ? 'denied' : 'error'; return paint(); }
    S.list = list.d.agents || []; S.projects = pr.ok ? pr.d.projects || [] : [];
    const dv0 = await api('GET', '/api/divisions'); if (dv0.ok) { S.divisions = dv0.d.divisions || []; S.canManageDivisions = !!dv0.d.canManage; }
    if (sv && sv.ok) S.services = sv.d.services || [];
    const id = at.startsWith('one:') ? at.slice(4) : null;
    if (id) {
      const one = await api('GET', `/api/agents/${id}`);
      if (S.key !== at) return;
      if (one.status === 404) { S.status = 'missing'; return paint(); }
      if (!one.ok) { S.status = 'error'; return paint(); }
      S.one = one.d.agent;
      const [ch, dv] = await Promise.all([api('GET', `/api/agents/${id}/project-choices`), api('GET', '/api/divisions' + (S.one.workspace ? `?workspace=${S.one.workspace.id}` : ''))]);
      if (S.key !== at) return;
      S.choices = ch.ok ? ch.d.projects || [] : []; S.divisions = dv.ok ? dv.d.divisions || [] : []; S.canManageDivisions = !!(dv.ok && dv.d.canManage);
    }
    S.status = 'ready'; paint();
  }
  const refreshOne = async () => { if (!S.one) return; const r = await api('GET', `/api/agents/${S.one.id}`); if (r.ok) { S.one = r.d.agent; const i = S.list.findIndex((x) => x.id === S.one.id); if (i >= 0) S.list[i] = S.one; } };

  // ───────────────────────── the list
  function listPage() {
    const h = H(), q = S.q.toLowerCase();
    const rows = S.list.filter((a) => !q || a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
    const live = S.list.filter((a) => state(a)[0] === 'live').length;
    const sub = S.list.length ? `${h.plural(S.list.length, 'agent', 'agents')} you own${live ? ` · ${live} working now` : ''}` : 'Agents you create work as themselves, from any computer, on what you give them.';
    const card = (a) => { const [k, l] = state(a);
      return `<button type="button" class="xag-card" data-xag="open" data-id="${esc(a.id)}">
        <span class="xag-mono" aria-hidden="true">${mono(a.name)}<i class="xag-dot xag-dot--${k}"></i></span>
        <span class="xag-card-b"><b>${esc(a.name)}</b><small>${esc(a.description || 'No description yet')}</small>${a.division ? `<em class="xag-div">${esc(a.division.name)}</em>` : ''}</span>
        <span class="xag-card-f"><span>${a.projects.length ? esc(a.projects.slice(0, 2).map((p) => p.name).join(', ')) + (a.projects.length > 2 ? ` +${a.projects.length - 2}` : '') : 'No projects yet'}</span><span class="xag-st xag-st--${k}">${esc(l)}</span></span></button>`; };
    const body = !S.list.length ? `<div class="xag-first">
        <div class="xag-first-art" aria-hidden="true"><span>${ic('bot')}</span><i></i><span>${ic('folder')}</span><i></i><span>${ic('terminal')}</span></div>
        <h2>Give work to an agent that is really yours</h2>
        <p>An agent has its own name and its own place in XENO. You decide which projects it works on. Then any agent CLI on any computer — Claude Code, Codex, the XENO CLI, a Spawn profile — signs in as it and starts working. Everything it does is shown as the agent's.</p>
        <ol class="xag-steps"><li><b>Create it</b><span>Name it and say what it is for</span></li><li><b>Give it work</b><span>Pick the projects it may work in</span></li><li><b>Run it anywhere</b><span>Connect a CLI with one credential</span></li></ol>
        ${h.btn('Create your first agent', 'data-xag="new"', false, 'plus')}</div>`
      : `<div class="pg-bar"><label class="pg-search">${ic('search')}<input data-xag-q value="${esc(S.q)}" placeholder="Search your agents" aria-label="Search your agents"></label></div>`
        + (rows.length ? `<div class="xag-grid">${rows.map(card).join('')}</div>` : h.box('search', `No agent matches “${esc(S.q)}”`, 'Try a shorter word.', h.btn('Clear search', 'data-xag="clearq"', true)));
    return h.page(h.head({ title: 'Agents', sub, acts: S.list.length ? h.btn('New agent', 'data-xag="new"', false, 'plus') : '' }) + body, 'xag');
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

  function onePage() {
    const h = H(), a = S.one; if (!a) return null;
    const [k, l] = state(a);
    const mine = new Map(a.projects.map((p) => [p.id, p]));
    const minted = S.minted && S.minted.agentId === a.id ? S.minted : null;
    const set = setups(minted && minted.token), cur = set[S.tab] || set.claude;

    // 1. run it: the hero. Where it runs, and the one thing to copy.
    const run = `<section class="xag-run" aria-labelledby="xag-run-h">
        <div class="xag-run-h"><div><h3 id="xag-run-h">Run ${esc(a.name)} anywhere</h3><p>Sign an agent CLI in as ${esc(a.name)}. It sees only what you give it below, and everything it does is shown as ${esc(a.name)}’s.</p></div>
          <div class="xag-mint"><select data-xag-ttl aria-label="How long the credential lasts"><option value="1">Lasts 1 hour</option><option value="24">Lasts 1 day</option><option value="720" selected>Lasts 30 days</option><option value="2160">Lasts 90 days</option></select>
            <button type="button" class="pg-btn" data-xag="mint"${S.busy ? ' disabled' : ''}>${ic('plus')}<span>New credential</span></button></div></div>
        ${minted ? `<div class="xag-secret" role="status"><div><b>${ic('lock')}Copy it now — it is never shown again</b><small>${esc(until(minted.expiresAt))}</small></div><div class="xag-secret-v"><code>${esc(minted.token)}</code>${copyBtn(minted.token)}</div></div>` : ''}
        <div class="xag-tabs" role="tablist" aria-label="Where it runs">${Object.entries(set).map(([key, s]) => `<button type="button" role="tab" aria-selected="${key === S.tab}" data-xag="tab" data-k="${key}">${esc(s.label)}</button>`).join('')}</div>
        <div class="xag-cmd"><pre>${esc(cur.cmd)}</pre>${minted || S.tab === 'spawn' ? copyBtn(cur.cmd) : '<span class="xag-cmd-hint">Make a credential to fill this in</span>'}</div>
        ${S.tab === 'spawn' ? '<p class="xag-note">Spawn keeps the credential in your computer’s secure store, writes the XENO connection into that profile only, and makes a fresh short-lived credential for every launch.</p>' : ''}
      </section>`;

    // 2. what it works on
    const choices = S.choices.length ? S.choices : S.projects.map((p) => ({ ...p, canGive: true, admin: true, division: null }));
    const projects = choices.length ? `<div class="xag-checks">${choices.map((p) => { const on = mine.has(p.id), off = !on && !p.canGive;
      const why = on ? 'Takes tasks, comments and sends work for review — never accepts its own work'
        : !p.admin ? 'Only a project admin can give it this project'
        : off ? (p.division ? `In ${p.division.name} — ${a.division ? `${a.name} works in ${a.division.name}` : `put ${a.name} in ${p.division.name} to give it`}` : `Not in a division — ${a.name} works in ${a.division ? a.division.name : 'none'}`)
        : 'Not shared with it';
      return `<label class="xag-check${on ? ' on' : ''}${off ? ' off' : ''}"><input type="checkbox" data-xag-proj="${esc(p.id)}"${on ? ' checked' : ''}${S.busy || off ? ' disabled' : ''}><span><b>${esc(p.name)}</b><small>${esc(why)}</small></span>${p.division ? `<em class="xag-div">${esc(p.division.name)}</em>` : ''}</label>`; }).join('')}</div>`
      : h.box('folder', 'You have no projects yet', 'Create a project, then come back to give it to this agent.', '', 'sm');
    const svc = S.services.map((s) => `<span class="xag-svc on">${ic('check')}${esc(s.title)}</span>`).join('') + ['Images', 'Video', 'Library', 'Chat'].map((n) => `<span class="xag-svc">${esc(n)}<em>Coming</em></span>`).join('');

    // 3. credentials and where it has run
    const creds = a.credentials.length ? a.credentials.map((c) => `<div class="xag-row"><span class="xag-row-ic">${ic('lock')}</span><span class="xag-row-b"><code>${esc(c.hint)}</code><small>${esc(c.label || 'Credential')} · made ${esc(ago(c.createdAt).toLowerCase())} · ${c.lastUsedAt ? 'used ' + esc(ago(c.lastUsedAt).toLowerCase()) : 'not used yet'}</small></span><span class="xag-row-m">${esc(until(c.expiresAt))}</span><button type="button" class="pg-btn ghost" data-xag="revoke" data-id="${esc(c.id)}">Revoke</button></div>`).join('')
      : '<p class="xag-none">No live credential. Make one above to connect a CLI.</p>';
    const conns = a.connections.length ? a.connections.map((c) => `<div class="xag-row"><span class="xag-row-ic">${ic('terminal')}</span><span class="xag-row-b"><b>${esc(c.client)}</b><small>Connected ${esc(ago(c.createdAt).toLowerCase())}</small></span><span class="xag-row-m">${esc(ago(c.lastUsedAt))}</span><button type="button" class="pg-btn ghost" data-xag="calls" data-id="${esc(c.id)}">Activity</button></div>`).join('')
      : '<p class="xag-none">It has not run anywhere yet. It appears here the first time a CLI uses one of its credentials.</p>';

    const acts = h.btn('Edit', 'data-xag="edit"', true, 'edit') + h.btn('Delete', 'data-xag="delete"', true, 'trash');
    return h.page(h.head({ obj: true, eyebrow: `<a data-xag="list">Agents</a>`, title: a.name, sub: a.description || 'No description yet', acts })
      + `<div class="pg-cols pg-cols--item"><div>${run}
          <section class="pg-sec"><div class="pg-sec-h"><h3>Division</h3>${S.canManageDivisions ? `<button class="pg-link" data-xag="division">${a.division ? 'Move' : 'Put in a division'}</button>` : ''}</div>
            <div class="xag-divbox">${a.division ? `<button class="pg-chip" data-xag="open-division" data-id="${esc(a.division.id)}">${ic('building')}${esc(a.division.name)}</button><p>${esc(a.name)} works only on ${esc(a.division.name)}’s projects. Moving it takes away projects outside the new division.</p>`
              : `<p>${esc(a.name)} is in no division, so it works only on projects that are in none either. ${S.divisions.length ? '' : 'This workspace has no divisions yet — <a data-xag="divisions">create one</a> to group agents and projects into departments.'}</p>`}</div></section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Instructions</h3><small>${a.version ? `version ${a.version}` : ''}</small>${S.editingInstr ? '' : '<button class="pg-link" data-xag="instr-edit">Edit</button>'}</div>
            ${S.editingInstr ? `<form class="xag-instr" data-xag-form="instr"><textarea name="instructions" rows="8" maxlength="32768" placeholder="How it should work: what to do, what to avoid, how to report back">${esc(a.instructions)}</textarea>
              <div class="xag-instr-a"><small>Saving makes a new version. Work already running keeps the version it started with.</small><button type="button" class="pg-btn ghost" data-xag="instr-cancel">Cancel</button><button type="submit" class="pg-btn"${S.busy ? ' disabled' : ''}>Save version</button></div></form>`
              : a.instructions ? `<pre class="xag-instr-v">${esc(a.instructions)}</pre>` : '<p class="xag-none">No instructions yet. The CLI it runs in uses its own defaults until you add some.</p>'}
            ${a.versions && a.versions.length > 1 ? `<details class="xag-vers"><summary>${a.versions.length} versions</summary><ol>${a.versions.map((v) => `<li><b>v${v.version}</b><small>${esc(new Date(v.createdAt).toLocaleString())}${v.by ? ' · ' + esc(v.by) : ''} · <code>${esc(String(v.hash).slice(0, 10))}</code></small></li>`).join('')}</ol></details>` : ''}</section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Works on</h3><small>${h.plural(a.projects.length, 'project', 'projects')}</small></div>${projects}</section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Can use</h3></div><div class="xag-svcs">${svc}</div><p class="xag-note">What it can use grows as XENO services join XENO MCP. You can still turn a service off for one connection in Dev › MCP.</p></section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>How it hears about new work</h3><button class="pg-link" data-xag="webhook">${a.webhook ? 'Change' : 'Add a webhook'}</button></div>
            ${a.webhook ? `<div class="xag-rows"><div class="xag-row"><span class="xag-row-ic">${ic('send')}</span><span class="xag-row-b"><code>${esc(a.webhook)}</code><small>Every task delegated to it is posted here, signed (HMAC-SHA256), and retried if it fails</small></span><span></span><button type="button" class="pg-btn ghost" data-xag="webhook-off">Remove</button></div></div>`
              : '<p class="xag-none">No webhook. It finds new work by asking XENO (its event feed, or the Tasks tools over MCP). Add one to be told the moment a task is delegated to it.</p>'}
            ${S.hook && S.hook.agentId === a.id ? `<div class="xag-secret" role="status"><div><b>${ic('lock')}Signing secret — copy it now, it is never shown again</b></div><div class="xag-secret-v"><code>${esc(S.hook.secret)}</code>${copyBtn(S.hook.secret)}</div></div>` : ''}</section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Where it has run</h3></div><div class="xag-rows">${conns}</div></section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Credentials</h3><small>${a.credentials.length} live</small></div><div class="xag-rows">${creds}</div></section>
        </div><aside><div class="xag-id">
          <span class="xag-mono xag-mono--lg" aria-hidden="true">${mono(a.name)}<i class="xag-dot xag-dot--${k}"></i></span>
          <b>${esc(a.name)}</b><span class="xag-st xag-st--${k}">${esc(l)}</span></div>
          <dl class="pg-props"><dt>Owner</dt><dd>You</dd><dt>Created</dt><dd>${esc(new Date(a.createdAt).toLocaleDateString())}</dd><dt>Division</dt><dd>${a.division ? esc(a.division.name) : 'None'}</dd><dt>Version</dt><dd>${a.version ? 'v' + a.version : '—'}</dd><dt>Projects</dt><dd>${a.projects.length}</dd><dt>Ran from</dt><dd>${h.plural(a.connections.length, 'place', 'places')}</dd>
            <dt>Id</dt><dd><button type="button" class="xag-idbtn" data-xag="copy" data-copy="${esc(a.id)}" title="Its permanent id — what Spawn and other tools store. It never changes, even if you rename it.">${S.copied === a.id ? 'Copied' : esc(a.id.slice(0, 12)) + '…'}</button></dd></dl>
          <p class="xag-note">It acts only as itself, never as you, and you can stop it at any moment by revoking its credentials.</p></aside></div>`, 'xag');
  }

  // ───────────────────────── page entry, called by the workspace router
  function route(it) {
    // 'All my agents' (across workspaces) is the same list on the platform: every agent you own, wherever it works
    if (it === 'All my agents') { setTimeout(() => go('Agents'), 0); return null; }
    if (it !== 'Agents' && !(it || '').startsWith('Agents/')) return null;
    style();
    const id = it.startsWith('Agents/') ? it.slice(7) : null;
    if (id && !ID.test(id)) return H().page(H().head({ eyebrow: '<a data-xag="list">Agents</a>', title: 'Agent not found' }) + H().box('bot', 'This agent link is not valid', 'Agents are addressed by their id. Open it from your agents.', H().btn('All agents', 'data-xag="list"', true)), 'xag');
    const key = id ? 'one:' + id : 'list';
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
    const r = await call('POST', '/api/agents', { name: v.name, description: v.description || '', divisionId: v.division || null }, 'The agent could not be created.');
    if (!r) return;
    toast(`Created ${r.d.agent.name}`); S.list.push(r.d.agent); go(`Agents/${r.d.agent.id}`);
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
  async function saveInstructions(form) {
    const a = S.one; if (!a) return;
    const r = await call('PATCH', `/api/agents/${a.id}`, { instructions: form.instructions.value }, 'The instructions could not be saved.');
    if (r) { S.one = r.d.agent; S.editingInstr = false; toast(`Saved as version ${S.one.version}`); paint(); }
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
    if (a === 'revoke') return revoke(b.dataset.id);
    if (a === 'copy') return copy(b.dataset.copy);
    if (a === 'tab') { S.tab = b.dataset.k; return paint(); }
    if (a === 'webhook') return webhook(false);
    if (a === 'webhook-off') return webhook(true);
    if (a === 'division') return moveDivision();
    if (a === 'open-division') return go(`Divisions/${b.dataset.id}`);
    if (a === 'divisions') return go('Divisions');
    if (a === 'instr-edit') { S.editingInstr = true; paint(); return setTimeout(() => document.querySelector('.xag-instr textarea')?.focus(), 0); }
    if (a === 'instr-cancel') { S.editingInstr = false; return paint(); }
    if (a === 'calls') return X()?.go?.('product', { product: 'mcp', item: `c/${b.dataset.id}` });
    if (a === 'retry') { S.key = null; return paint(); }
    if (a === 'clearq') { S.q = ''; return paint(); }
  });
  document.addEventListener('submit', (e) => { const f = e.target.closest('.xag [data-xag-form="instr"]'); if (!f) return; e.preventDefault(); saveInstructions(f); });
  document.addEventListener('change', (e) => { const c = e.target.closest('.xag [data-xag-proj]'); if (c) project(c.dataset.xagProj, c.checked); });
  document.addEventListener('input', (e) => { const q = e.target.closest('.xag [data-xag-q]'); if (!q) return; S.q = q.value; const pos = q.selectionStart; paint(); const n = document.querySelector('.xag [data-xag-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });

  const style = () => {
    if (document.getElementById('xag-css')) return; const s = document.createElement('style'); s.id = 'xag-css';
    s.textContent = [
      '.xag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}',
      '.xag-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--panel);color:var(--text);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}',
      '.xag-card:hover{border-color:var(--muted);background:var(--hover)}.xag-card:focus-visible{outline:2px solid var(--text);outline-offset:2px}',
      '.xag-card-b{display:flex;flex-direction:column;gap:4px;min-height:44px}.xag-card-b b{font-size:14px;font-weight:600}.xag-card-b small{font-size:12.5px;color:var(--muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.xag-card-f{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}.xag-card-f>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.xag-mono{position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--control);font-size:13px;font-weight:600;letter-spacing:.02em;flex:none}.xag-mono--lg{width:64px;height:64px;border-radius:18px;font-size:21px}',
      '.xag-dot{position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--panel);background:var(--dim)}.xag-mono--lg .xag-dot{width:15px;height:15px}',
      '.xag-dot--live{background:#4ade80;box-shadow:0 0 0 0 #4ade8066;animation:xagp 2s infinite}.xag-dot--idle{background:var(--muted)}.xag-dot--ready{background:var(--text)}',
      '@keyframes xagp{70%{box-shadow:0 0 0 6px #4ade8000}100%{box-shadow:0 0 0 0 #4ade8000}}@media (prefers-reduced-motion:reduce){.xag-dot--live{animation:none}}',
      '.xag-st{font-size:12px;color:var(--muted);white-space:nowrap}.xag-st--live{color:#4ade80}.xag-st--ready{color:var(--text)}',
      '.xag-first{display:flex;flex-direction:column;align-items:center;text-align:center;max-width:620px;margin:40px auto 0;gap:14px}',
      '.xag-first-art{display:flex;align-items:center;gap:0;margin-bottom:8px}.xag-first-art span{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;border:1px solid var(--border);background:var(--panel)}.xag-first-art span:first-child{background:var(--control)}',
      '.xag-first-art i{width:44px;height:1px;background:linear-gradient(90deg,var(--border),var(--muted),var(--border))}',
      '.xag-first h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em}.xag-first p{margin:0;font-size:13.5px;line-height:1.6;color:var(--muted)}',
      '.xag-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;margin:8px 0 6px;padding:0;list-style:none;counter-reset:s}',
      '.xag-steps li{display:flex;flex-direction:column;gap:3px;padding:12px;border:1px solid var(--border);border-radius:12px;text-align:left;counter-increment:s}.xag-steps li::before{content:counter(s);font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}',
      '.xag-steps b{font-size:13px}.xag-steps span{font-size:12px;color:var(--muted);line-height:1.45}',
      '.xag-run{margin-bottom:26px;padding:18px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--panel),var(--canvas))}',
      '.xag-run-h{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}.xag-run-h>div:first-child{flex:1;min-width:240px}.xag-run-h h3{margin:0 0 4px;font-size:15px;font-weight:600}.xag-run-h p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.5}',
      '.xag-mint{display:flex;align-items:center;gap:8px}.xag-mint select{height:32px;padding:0 8px;border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--text);font:inherit;font-size:12.5px}',
      '.xag-secret{display:flex;flex-direction:column;gap:8px;margin-top:14px;padding:12px 14px;border:1px solid var(--text);border-radius:12px;background:var(--canvas)}.xag-secret>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.xag-secret b{display:flex;align-items:center;gap:7px;font-size:13px}.xag-secret small{font-size:12px;color:var(--muted)}.xag-secret-v{display:flex;align-items:center;gap:8px}.xag-secret-v code{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.xag-tabs{display:flex;gap:2px;margin:16px 0 0;border-bottom:1px solid var(--border);overflow-x:auto}.xag-tabs button{border:0;background:none;color:var(--muted);font:inherit;font-size:12.5px;padding:7px 10px;margin-bottom:-1px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}',
      '.xag-tabs button:hover{color:var(--text)}.xag-tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text)}',
      '.xag-cmd{display:flex;align-items:flex-start;gap:10px;padding:12px 0 0}.xag-cmd pre{flex:1;min-width:0;margin:0;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--canvas);font:12px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}',
      '.xag-cmd-hint{align-self:center;font-size:12px;color:var(--dim);white-space:nowrap}',
      '.xag-copy{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.xag-copy:hover{background:var(--hover)}.xag-copy svg{width:14px;height:14px}',
      '.xag-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}',
      '.xag-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}',
      '.xag-check{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:border-color .15s}.xag-check:hover{border-color:var(--muted)}.xag-check.on{border-color:var(--text);background:var(--panel)}',
      '.xag-check input{margin-top:2px;accent-color:var(--text)}.xag-check span{display:flex;flex-direction:column;gap:3px}.xag-check b{font-size:13px;font-weight:500}.xag-check small{font-size:11.5px;color:var(--muted);line-height:1.45}',
      '.xag-svcs{display:flex;flex-wrap:wrap;gap:6px}.xag-svc{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px dashed var(--border);border-radius:99px;font-size:12px;color:var(--dim)}.xag-svc em{font-style:normal;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}',
      '.xag-svc.on{border-style:solid;border-color:var(--text);color:var(--text)}.xag-svc svg{width:13px;height:13px}',
      '.xag-rows{border:1px solid var(--border);border-radius:12px;overflow:hidden}.xag-row{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)}.xag-row:last-child{border-bottom:0}',
      '.xag-row-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--control)}.xag-row-ic svg{width:15px;height:15px}.xag-row-b{display:flex;flex-direction:column;gap:2px;min-width:0}.xag-row-b b{font-size:13px;font-weight:500}',
      '.xag-row-b code{font:12px ui-monospace,Consolas,monospace}.xag-row-b small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xag-row-m{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.xag-check.off{opacity:.55;cursor:default}.xag-check.off:hover{border-color:var(--border)}.xag-check{position:relative}.xag-check .xag-div{position:absolute;top:10px;right:10px;margin:0}',
      '.xag-div{display:inline-block;margin-top:6px;padding:1px 7px;border:1px solid var(--border);border-radius:99px;font-style:normal;font-size:11px;color:var(--muted);width:max-content}',
      '.xag-divbox{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.xag-divbox p{margin:0;font-size:12.5px;line-height:1.5;color:var(--muted)}.xag-divbox a{color:var(--text);cursor:pointer;text-decoration:underline}',
      '.xag-instr{display:flex;flex-direction:column;gap:8px}.xag-instr textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--canvas);color:var(--text);font:12.5px/1.55 ui-monospace,Consolas,monospace;resize:vertical;outline:none}.xag-instr textarea:focus{border-color:var(--muted)}',
      '.xag-instr-a{display:flex;align-items:center;gap:8px}.xag-instr-a small{flex:1;font-size:12px;color:var(--muted)}',
      '.xag-instr-v{margin:0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);font:12.5px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}',
      '.xag-vers{margin-top:8px;font-size:12.5px;color:var(--muted)}.xag-vers summary{cursor:pointer}.xag-vers ol{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}.xag-vers li{display:flex;gap:8px;align-items:baseline}.xag-vers li b{color:var(--text);font-size:12px}.xag-vers small{font-size:11.5px}',
      '.xag-none{margin:0;padding:14px;font-size:12.5px;color:var(--muted)}',
      '.xag-id{display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 18px;margin-bottom:16px;border-bottom:1px solid var(--border);text-align:center}.xag-id b{font-size:15px}',
      '.xag-idbtn{border:0;background:none;padding:0;color:var(--muted);font:11.5px ui-monospace,Consolas,monospace;cursor:pointer}.xag-idbtn:hover{color:var(--text)}',
      '.xag-skel{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;padding-top:60px}.xag-skel i{height:132px;border-radius:14px;background:var(--panel);animation:xags 1.2s ease-in-out infinite alternate}@keyframes xags{to{opacity:.5}}',
      '@media (max-width:720px){.xag-steps{grid-template-columns:1fr}.xag-row{grid-template-columns:auto 1fr auto}.xag-row-m{display:none}.xag-cmd{flex-direction:column}}',
    ].join('');
    document.head.appendChild(s);
  };

  // the sidebar counts real agents: read the list once in the background
  setTimeout(async () => { if (S.list.length) return; const r = await api('GET', '/api/agents'); if (r.ok && !S.list.length) { S.list = r.d.agents || []; paint(); } }, 1500);
  window.XENO_AGENTS = { served: true, count: () => (S.status === 'ready' || S.list.length ? S.list.length : null), route, nameOf, isId: (s) => ID.test(String(s || '')), reload: () => { S.key = null; paint(); } };
})();
