/* platform-compute.js — Dev › Compute: XENO Compute's machines in the workspace you are in.
 *
 * Reads /api/compute (routes/computeRoutes.js → services/compute.js), the same calls agents make (computeMcp.js):
 *
 *   views     Machines · Usage · Budgets                       (item = the view name, lower-case)
 *   a machine item "machines/<mch_…>" → /workspace/dev/spaces/compute/machines/<id> — id-based, parent in path
 *
 * A machine page shows its size, state, the agent it works for, its cost so far and its timeline (started, billed,
 * could not be funded, stopped and why), with Start / Stop / Delete. Usage splits machine time by machine and by
 * agent, and shows what you used on AI versus machines from the one ledger. Budgets are caps only a workspace admin
 * sets; the server refuses anyone else. A size XENO has not priced yet says so and cannot start.
 *
 * It registers XENO_ZONE_LIVE['dev.compute'].
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const VIEWS = [['machines', 'Machines'], ['usage', 'Usage'], ['budgets', 'Budgets']];
  const STATE = { creating: 'Creating', running: 'Running', stopped: 'Stopped', deleted: 'Deleted', failed: 'Failed' };
  const EVENT = { created: 'Created', started: 'Started', stopped: 'Stopped', deleted: 'Deleted', failed: 'Failed', billed: 'Billed', unfunded: 'Not funded', funded: 'Funded again', capped: 'Budget reached', idle_stop_set: 'Idle stop changed', agent_task: 'Agent task' };
  const size = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const IDLE_CHOICES = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [1440, '24 hours'], ['never', 'Never']];
  const S = { status: 'idle', ws: undefined, machines: [], sizes: [], usage: null, split: null, caps: null, machine: null, machineId: null, error: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'compute'; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const itemNow = () => String((X()?.S || {}).item || 'machines');
  const goItem = (item) => X()?.go?.('zone', { zone: 'compute', item });
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };
  const cr = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} cr`;
  const sizeOf = (id) => S.sizes.find((s) => s.size === id);
  const sizeLine = (s) => (s ? `${s.vcpus} cores · ${s.memoryGb} GB · ${s.diskGb} GB disk · ${s.priced ? cr(s.creditsPerHour) + '/h' : 'not priced yet'}` : '');

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const [m, z] = await Promise.all([api('GET', '/api/compute/machines' + q()).catch(() => null), api('GET', '/api/compute/sizes').catch(() => null)]);
    if (!m || !m.ok) { S.status = 'error'; S.error = said(m, 'XENO Compute could not be reached.'); return paint(); }
    S.machines = m.d.machines || []; S.sizes = (z && z.ok && z.d.sizes) || [];
    S.status = 'ready'; paint();
  }
  async function loadUsage() {
    const [u, s] = await Promise.all([api('GET', '/api/compute/usage' + q()).catch(() => null), api('GET', '/api/compute/usage/split').catch(() => null)]);
    S.usage = u && u.ok ? u.d.usage : { error: said(u, 'Could not read usage') }; S.split = s && s.ok ? s.d.split : null; paint();
  }
  async function loadCaps() { const r = await api('GET', '/api/compute/caps' + q()).catch(() => null); S.caps = r && r.ok ? r.d.caps : { error: said(r, 'Could not read budgets') }; paint(); }
  async function loadMachine(id) {
    S.machineId = id; S.machine = null;
    const r = await api('GET', `/api/compute/machines/${encodeURIComponent(id)}` + q()).catch(() => null);
    S.machine = r && r.ok ? r.d.machine : { error: said(r, 'Machine not found') }; paint();
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['dev.compute'] = {
    served: true,
    items: true,
    label: (item) => { const [v, id] = String(item || '').split('/'); if (id) return S.machine && S.machine.id === id ? `Machines / ${S.machine.name}` : 'Machine'; return (VIEWS.find((x) => x[0] === v) || [, item])[1]; },
    work: () => (S.status === 'ready' ? ['Machines', S.machines.slice(0, 6).map((m) => [m.name, STATE[m.state] || m.state, null, 'machines/' + m.id])] : null),
    badge: () => (S.machines.filter((m) => m.state === 'running').length || null),
    page: () => page(),
    state: () => ({ status: S.status, machines: S.machines.length, running: S.machines.filter((m) => m.state === 'running').length, item: itemNow() }),
    reload: () => load(),
  };
  window.XENO_COMPUTE = { served: true, label: (x) => (S.machine && S.machine.id === x ? S.machine.name : x) };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page() {
    const item = itemNow(), [view, mid] = item.split('/');
    // the page's one header (XENO_PAGES): views are tabs in the header bar, New machine sits right in it,
    // and creating opens the workspace dialog
    const h = window.XENO_PAGES.h;
    const acts = view === 'budgets' ? h.btn('Set a budget', 'data-cm-cap', true, 'plus') : h.btn('New machine', 'data-cm-add', false, 'plus');
    const head = h.head({ title: 'Compute', sub: 'Machines for your agents and work, billed by the hour from the same credits as AI. A budget refuses a new start; it never stops work silently.', acts }) + h.tabs(VIEWS, view, 'data-cm-view-go');
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm cr" data-cm-page="${esc(S.status)}" data-cm-view="${esc(view)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-cm-error>${esc(S.error)} ${btn('data-cm-reload', 'Try again')}</div>`);
    if (view === 'machines' && mid) return wrap(machinePage(mid));
    if (view === 'usage') return wrap(usagePage());
    if (view === 'budgets') return wrap(budgetsPage());
    return wrap(machinesPage());
  }
  function machinesPage() {
    const unpriced = S.sizes.length && S.sizes.every((s) => !s.priced) ? '<p class="pg-dim" data-cm-unpriced>XENO Compute has not set its prices yet, so machines can be created but not started.</p>' : '';
    const rows = S.machines.map((m) => `<button class="cr-li" data-cm-open="${esc(m.id)}" data-cm-state="${esc(m.state)}"><b>${esc(m.name)}</b><small>${esc(STATE[m.state] || m.state)}${m.unfundedSince ? ' · not funded' : ''}</small><small>${esc(m.size)}${m.agent ? ' · ' + esc(m.agent.name) : ''}</small><small>${esc(cr(m.costSoFarCredits))}</small></button>`).join('');
    return `${unpriced}${rows ? `<div class="cr-list" data-cm-list>${rows}</div>` : '<div class="pj-empty" data-cm-empty>No machines yet. Create one, or let an agent create one for its work.</div>'}`;
  }
  function machinePage(id) {
    if (S.machineId !== id) { loadMachine(id); return '<div class="pj-empty">Loading…</div>'; }
    const m = S.machine; if (!m) return '<div class="pj-empty">Loading…</div>';
    if (m.error) return `<div class="pj-empty" data-cm-error>${esc(m.error)}</div>`;
    const sz = sizeOf(m.size);
    const actions = m.state === 'running' ? btn('data-cm-stop', 'Stop', 'btn')
      : m.state === 'stopped' ? `${btn('data-cm-start', 'Start', 'btn')} ${btn('data-cm-delete', 'Delete')}`
        : m.state === 'failed' ? btn('data-cm-delete', 'Delete') : '';
    const warn = m.unfundedSince ? `<div class="pj-empty" data-cm-unfunded>The next hour could not be paid for (a budget is reached or the credits ran out). It keeps running for now and stops on its own soon, with its home folder kept. Add credits or raise the budget to keep it going.</div>` : '';
    const events = (m.events || []).map((e) => `<div class="cr-li" data-cm-event="${esc(e.kind)}"><b>${esc(EVENT[e.kind] || e.kind)}</b><small>${esc(eventText(e))}</small><small>${esc(when(e.at))}</small></div>`).join('') || '<p class="pg-dim">Nothing yet.</p>';
    return `<div class="cr-detail" data-cm-machine="${esc(m.id)}">
      <div class="cr-main"><h2>${esc(m.name)}</h2><p class="pg-dim">${esc(STATE[m.state] || m.state)} · ${esc(m.size)} — ${esc(sizeLine(sz))}</p>${warn}
        ${m.purpose ? `<p>${esc(m.purpose)}</p>` : ''}<div class="cr-row">${actions}</div>
        ${m.state === 'running' ? `<h3>Run an agent task</h3><div data-cm-agent-form>
          <textarea data-cm-agent-prompt rows="4" placeholder="What should the XENO Agent do on this machine?" aria-label="Agent task"></textarea>
          <div class="cr-row"><select data-cm-agent-access aria-label="Access"><option value="listed" selected>Listed access: reads and edits files</option><option value="full">Full access: no permission checks</option></select>
          <input data-cm-agent-folder value="work" aria-label="Folder in the home folder" size="12"> ${btn('data-cm-agent-run', 'Run', 'btn')}</div>
          <p class="pg-dim">It works in that folder in the home folder, which is kept across stops, and is billed to your credits. Listed access cannot run commands yet; full access can do anything on this machine.</p>
          <div data-cm-agent-result>${S.agentResult && S.agentResult.machine === m.id ? agentResultHtml(S.agentResult.r) : ''}</div></div>` : ''}
        <h3>Timeline</h3><div class="cr-list" data-cm-timeline>${events}</div></div>
      <aside class="sp-console"><h3>Cost so far</h3><p data-cm-cost><b>${esc(cr(m.costSoFarCredits))}</b></p>
        <h3>Stops by itself</h3><p><select data-cm-idle aria-label="Stop by itself after">${IDLE_CHOICES.map(([v, l]) => `<option value="${v}"${String(m.idleStopMinutes ?? 'never') === String(v) ? ' selected' : ''}>${l === 'Never' ? l : 'After ' + l + ' idle'}</option>`).join('')}${m.idleStopMinutes != null && !IDLE_CHOICES.some(([v]) => v === m.idleStopMinutes) ? `<option value="${m.idleStopMinutes}" selected>After ${m.idleStopMinutes} minutes idle</option>` : ''}</select></p>
        <p class="pg-dim">Idle means no command or file call. A server left running in the background does not count as use, so choose Never for one.</p>
        <h3>Saved files</h3><p data-cm-home>${m.homeBytes != null ? `${size(m.homeBytes)} in the home folder, kept between runs. It counts toward this workspace's storage.` : 'Nothing saved yet. The home folder is saved when the machine stops.'}</p>
        <h3>Works for</h3><p>${m.agent ? esc(m.agent.name) : 'People in this workspace'}</p>
        <h3>Address</h3><p class="pg-dim"><code>${esc(m.id)}</code></p><p class="pg-dim">Created ${esc(when(m.createdAt))}</p></aside></div>`;
  }
  function agentResultHtml(r) {
    if (r.running) return '<p class="pg-dim" data-cm-agent-status="running">The agent is working… this can take several minutes.</p>';
    return `<div class="cr-li" data-cm-agent-status="${esc(r.status)}"><b>${esc(r.status === 'ok' ? 'Done' : r.status === 'permission_denied' ? 'Stopped: it needed a permission it does not have' : r.status === 'timed_out' ? 'Ran out of time' : 'It did not finish')}</b>
      <small style="white-space:pre-wrap">${esc(r.answer || r.error || '')}</small>${r.tokens != null ? `<small>${esc(String(r.tokens))} tokens · ${esc(String(r.seconds))}s</small>` : ''}</div>`;
  }
  function eventText(e) {
    const d = e.detail || {};
    if (e.kind === 'started') return `Billing to ${d.payer === 'workspace' ? 'the workspace wallet' : 'the person who started it'}${d.creditsPerHour ? `, ${cr(d.creditsPerHour)} an hour` : ''}.${d.restoredBytes != null ? ` Home folder put back (${size(d.restoredBytes)}).` : ''}`;
    if (e.kind === 'stopped') return `${d.reason === 'unfunded' ? 'Stopped because the next hour could not be paid for.' : d.reason === 'idle' ? 'Stopped by itself: nobody used it for its idle limit.' : 'Stopped.'} Charged ${cr(d.charged)} for this run.${d.saveError ? ` Its files could NOT be saved this time: ${d.saveError}` : d.savedBytes != null ? ` Home folder saved (${size(d.savedBytes)}).` : ''}`;
    if (e.kind === 'unfunded' || e.kind === 'capped') return `${d.reason || 'The next hour could not be funded.'} It stops in ${Math.round((d.stopsInSeconds || 0) / 60)} minutes unless funding resumes.`;
    if (e.kind === 'funded') return 'Funding resumed.';
    if (e.kind === 'agent_task') return `${d.access === 'full' ? 'FULL ACCESS (no permission checks)' : 'Listed access'} · ${d.status}${d.tokens != null ? ` · ${d.tokens} tokens` : ''}${d.seconds != null ? ` · ${d.seconds}s` : ''}${d.agent ? ` · by ${d.agent}` : ''}.`;
    if (e.kind === 'idle_stop_set') return d.minutes == null ? 'It now never stops by itself.' : `It now stops by itself after ${d.minutes} idle minutes.`;
    if (e.kind === 'failed') return d.reason || 'Failed.';
    if (e.kind === 'created') return `Created as ${d.size || ''}${d.agent ? ', for an agent' : ''}.`;
    return '';
  }
  function usagePage() {
    if (!S.usage) { loadUsage(); return '<div class="pj-empty">Loading…</div>'; }
    if (S.usage.error) return `<div class="pj-empty">${esc(S.usage.error)}</div>`;
    const u = S.usage;
    const split = S.split ? `<div class="cr-sum" data-cm-split><span>You, last 7 days: <b>${esc(cr(S.split.aiCredits))}</b> on AI</span><span><b>${esc(cr(S.split.machineCredits))}</b> on machines</span></div>` : '';
    const byM = u.byMachine.length ? u.byMachine.map((r) => `<button class="cr-li" data-cm-open="${esc(r.id)}"><b>${esc(r.name)}</b><small>${esc(r.size)}</small><small>${esc(r.hours)} h</small><small>${esc(cr(r.credits))}</small></button>`).join('') : '<p class="pg-dim">No machine time this month.</p>';
    const byA = u.byAgent.map((r) => `<div class="cr-li"><b>${esc(r.agent ? r.agent.name : 'People')}</b><small>${esc(cr(r.credits))}</small></div>`).join('');
    return `${split}<div class="cr-sum"><span>This workspace, this month: <b>${esc(cr(u.machineCredits))}</b> of machine time</span></div>
      <h3>By machine</h3><div class="cr-list" data-cm-by-machine>${byM}</div>${byA ? `<h3>By agent</h3><div class="cr-list" data-cm-by-agent>${byA}</div>` : ''}`;
  }
  function budgetsPage() {
    if (!S.caps) { loadCaps(); return '<div class="pj-empty">Loading…</div>'; }
    if (S.caps.error) return `<div class="pj-empty">${esc(S.caps.error)}</div>`;
    const label = (c) => (c.scope === 'workspace' ? 'Whole workspace' : c.scope === 'division' ? 'Division' : 'Agent');
    const rows = S.caps.map((c) => `<div class="cr-li" data-cm-cap-row="${esc(c.scope)}"><b>${esc(label(c))}</b><small>${c.maxMachines != null ? esc(c.maxMachines) + ' machines' : 'any number'}</small><small>${c.maxSize ? 'up to ' + esc(c.maxSize) : 'any size'}</small><small>${c.monthlyCredits != null ? esc(cr(c.monthlyCredits)) + ' a month' : 'no monthly limit'}</small></div>`).join('');
    return `<p class="pg-dim">A budget refuses a new machine, a bigger size or a new start once reached. Running machines are never stopped silently. Only workspace admins set budgets.</p>${rows ? `<div class="cr-list">${rows}</div>` : '<div class="pj-empty" data-cm-nocaps>No budgets. Machines are limited only by your credits.</div>'}`;
  }

  async function act(method, url, body, okMsg) {
    const r = await api(method, url, body ? withWs(body) : undefined).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  function newMachine() {
    window.XD.form({ title: 'New machine', submit: 'Create machine',
      fields: [{ id: 'name', label: 'Name', required: true, max: 80 },
        { id: 'size', type: 'choice', label: 'Size', value: (S.sizes[0] || {}).size || 'small', options: S.sizes.map((s) => [s.size, `${s.size} — ${sizeLine(s)}`]) },
        { id: 'purpose', label: 'What it is for', max: 500 }],
      onSubmit: async (v) => { const r = await api('POST', '/api/compute/machines' + q(), withWs({ name: v.name, size: v.size, purpose: v.purpose || undefined, idempotencyKey: `ui-${Date.now()}` })).catch(() => null); if (!r || !r.ok) return said(r, 'That did not work.'); S.made = r.d.machine.id; return null; },
    }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; toast('Machine created'); await load(); goItem('machines/' + id); });
  }
  function setCap() {
    window.XD.form({ title: 'Set a budget', submit: 'Save budget', size: 'sm',
      fields: [{ id: 'maxMachines', label: 'Most machines (blank = any)', max: 6 },
        { id: 'maxSize', type: 'choice', label: 'Largest size', value: '', options: [['', 'Any size'], ...S.sizes.map((s) => [s.size, s.size])] },
        { id: 'monthlyCredits', label: 'Credits a month (blank = no limit)', max: 12 }],
      onSubmit: async (v) => {
        const num = (x) => (String(x || '').trim() === '' ? null : Number(String(x).replace(',', '.')));
        const r = await api('PUT', '/api/compute/caps' + q(), withWs({ scope: 'workspace', maxMachines: num(v.maxMachines) == null ? null : Math.trunc(num(v.maxMachines)), maxSize: v.maxSize || null, monthlyCredits: num(v.monthlyCredits) })).catch(() => null);
        return r && r.ok ? null : said(r, 'That did not save.');
      },
    }).then((v) => { if (v) { toast('Budget saved'); S.caps = null; paint(); } });
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-cm-reload],[data-cm-add],[data-cm-cap],[data-cm-view-go],[data-cm-open],[data-cm-start],[data-cm-stop],[data-cm-delete],[data-cm-agent-run]');
    if (!t || !(t.closest('[data-cm-page]') || t.closest('#main .topbar'))) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset, mid = S.machine && S.machine.id;
    const again = async () => { S.machineId = null; await load(); };
    if ('cmReload' in d) return load();
    if ('cmAdd' in d) return newMachine();
    if ('cmCap' in d) return setCap();
    if (d.cmViewGo) { S.usage = null; S.caps = null; return goItem(d.cmViewGo); }
    if (d.cmOpen) return goItem('machines/' + d.cmOpen);
    if ('cmStart' in d && mid) { if (await act('POST', `/api/compute/machines/${mid}/start` + q(), {}, 'Started')) again(); return; }
    if ('cmAgentRun' in d && mid) {
      const form = t.closest('[data-cm-agent-form]');
      const prompt = form.querySelector('[data-cm-agent-prompt]').value.trim();
      const access = form.querySelector('[data-cm-agent-access]').value;
      if (!prompt) { toast('Say what the agent should do.'); return; }
      if (access === 'full' && !window.confirm('Full access turns off every permission check for this task: the agent may run any command on this machine. Continue?')) return;
      S.agentResult = { machine: mid, r: { running: true } }; again();
      const r = await act('POST', `/api/compute/machines/${mid}/agent-tasks` + q(), { prompt, access, folder: form.querySelector('[data-cm-agent-folder]').value.trim() || 'work' }, null);
      S.agentResult = r ? { machine: mid, r: r.result } : null; again(); return;
    }
    if ('cmStop' in d && mid) { if (await act('POST', `/api/compute/machines/${mid}/stop` + q(), {}, 'Stopped')) again(); return; }
    if ('cmDelete' in d && mid) {
      if (!window.confirm(`Delete ${S.machine.name}? The machine and its disk are removed for good.`)) return;
      if (await act('DELETE', `/api/compute/machines/${mid}` + q(), null, 'Deleted')) { await load(); goItem('machines'); }
    }
  }, true);

  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-cm-idle]');
    if (!t || !t.closest('[data-cm-page]') || !S.machine) return;
    const v = t.value === 'never' ? null : Number(t.value);
    if (await act('PUT', `/api/compute/machines/${S.machine.id}/idle-stop` + q(), { idleStopMinutes: v }, v == null ? 'It will not stop by itself' : 'Idle stop saved')) { S.machineId = null; await load(); }
  }, true);

  P.lazyZone(window.XENO_ZONE_LIVE['dev.compute'], () => load(), () => load());
})();
