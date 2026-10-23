/* platform-automate.js — on the platform, Dev › Automate IS XENO Workflow.
 *
 * Owner, 2026-10-23: "for automate we already have xeno workflow that needs to power this". The picture listed sample
 * runs ("Nightly asset sync"). Here the area is the workspace's front-end to XENO Workflow: workflows are xeno-workflow
 * graphs (its own node catalogue, read from its headless runner), stored by /api/automate (routes/automateRoutes.js →
 * services/xenoWorkflow.js) and run by that runner — never by an engine in this page or on the platform.
 *
 *   tabs (item)   workflows · runs · failed                         GET /api/automate · /runs · /runs?state=failed
 *   a workflow    workflows/<workflow id>                           GET|PUT|DELETE /api/automate/<id>, /enable, /disable, /run
 *   a run         runs/<run id>                                     GET /api/automate/runs/<id>, /retry, /discard
 *
 * The builder edits the graph as an ordered list of steps (trigger first, each step wired to the next by an exec
 * edge — exactly how the desktop editor wires a straight-line flow). A graph with branches is shown read-only with its
 * JSON, to edit in the desktop app and import back. New workflow, Add step and Import open the workspace dialog.
 * It registers XENO_ZONE_LIVE['dev.automate'].
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TABS = [['workflows', 'Workflows'], ['runs', 'Runs'], ['failed', 'Failed']];
  const EVENTS = [['task.status_changed', 'A task changes status'], ['support.ticket_created', 'A support ticket is created'], ['form.response_submitted', 'A form is answered'], ['schedule', 'On a schedule'], ['webhook', 'A webhook is received']];
  const TRIGGER = 'xeno-platform-trigger', ACTION = 'xeno-platform-capability';
  // The two workspace node types, so a draft can be built while the runner is not reachable. When the runner answers,
  // ITS catalogue (xeno-workflow's own definitions) replaces these.
  const FALLBACK = [
    { type: TRIGGER, name: 'XENO Workspace Event', category: 'triggers', visualCategory: 'trigger', description: 'Start this workflow when something happens in the workspace.', configFields: [
      { key: 'event', label: 'When', type: 'select', options: EVENTS.map(([value, label]) => ({ value, label })) },
      { key: 'taskStatus', label: 'Task moves to (optional)', type: 'select', options: [{ value: '', label: 'Any status' }, ...['raised', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'wont_do'].map((v) => ({ value: v, label: v.replace('_', ' ') }))] },
      { key: 'ticketKind', label: 'Ticket kind (optional)', type: 'text' }, { key: 'formId', label: 'Form (optional)', type: 'text' },
      { key: 'cron', label: 'Schedule (cron)', type: 'text' }, { key: 'timezone', label: 'Time zone', type: 'text' }] },
    { type: ACTION, name: 'XENO Workspace Action', category: 'external', visualCategory: 'action', description: 'Do one thing in the workspace as this workflow.', configFields: [
      { key: 'capability', label: 'Capability', type: 'text' }, { key: 'arguments', label: 'Arguments', type: 'json' }] },
  ];
  const S = { status: 'idle', ws: undefined, list: [], canEdit: false, configured: false, failures: 0, error: null,
    cat: null, catTried: false, wfId: null, wf: null, steps: null, linear: true, extraEdges: [], dirty: false, runs: null, secret: null,
    allRuns: null, runsFor: null, runId: null, run: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'automate'; };
  const itemNow = () => String((X()?.S || {}).item || 'workflows');
  const goItem = (item) => X()?.go?.('zone', { zone: 'automate', item });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const when = (t) => { try { return t ? new Date(t).toLocaleString() : '—'; } catch { return ''; } };
  const defs = () => (S.cat && S.cat.nodes) || FALLBACK;
  const defOf = (type) => defs().find((d) => d.type === type) || FALLBACK.find((d) => d.type === type) || null;
  const actions = () => (S.cat && S.cat.actions) || [];

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const r = await api('GET', '/api/automate' + q()).catch(() => null);
    if (!r || !r.ok) { S.status = 'error'; S.error = said(r, 'Automate could not be reached.'); return paint(); }
    S.list = r.d.workflows || []; S.canEdit = !!r.d.canEdit; S.configured = !!r.d.configured; S.failures = r.d.recentFailures || 0; S.status = 'ready';
    if (!S.catTried) loadCatalogue();
    paint();
  }
  async function loadCatalogue() {
    S.catTried = true;
    const r = await api('GET', '/api/automate/catalogue' + q()).catch(() => null);
    S.cat = r && r.ok ? { nodes: r.d.nodes, actions: r.d.actions } : null;
    paint();
  }
  async function openWorkflow(id) {
    S.wfId = id; S.wf = null; S.steps = null; S.runs = null; S.secret = null; S.dirty = false;
    const [a, rr] = await Promise.all([api('GET', `/api/automate/${encodeURIComponent(id)}`).catch(() => null), api('GET', '/api/automate/runs' + q({ workflowId: id, limit: 20 })).catch(() => null)]);
    if (S.wfId !== id) return;
    if (!a || !a.ok) { S.wf = { error: said(a, 'This workflow could not be opened.') }; return paint(); }
    adopt(a.d.workflow); S.runs = rr && rr.ok ? rr.d.runs : []; paint();
  }
  async function loadRuns(kind) {
    S.runsFor = kind; S.allRuns = null;
    const r = await api('GET', '/api/automate/runs' + q(kind === 'failed' ? { state: 'failed' } : {})).catch(() => null);
    S.allRuns = r && r.ok ? r.d.runs : { error: said(r, 'Runs could not be loaded.') }; paint();
  }
  async function openRun(id) {
    S.runId = id; S.run = null;
    const r = await api('GET', `/api/automate/runs/${encodeURIComponent(id)}`).catch(() => null);
    S.run = r && r.ok ? r.d.run : { error: said(r, 'This run could not be opened.') }; paint();
  }

  // ─────────────────────────────── the graph as an ordered list of steps
  /** A straight line: one trigger, each step at most one exec in and one exec out, and the chain reaches every step. */
  function toSteps(graph) {
    const nodes = graph.nodes || [], edges = graph.edges || [];
    const exec = edges.filter((e) => e.kind === 'exec' || (!e.kind && e.sourcePort === 'out' && e.targetPort === 'in'));
    const out = new Map(), inn = new Map();
    for (const e of exec) { if (out.has(e.source) || inn.has(e.target)) return null; out.set(e.source, e.target); inn.set(e.target, e.source); }
    const start = nodes.find((n) => n.type === TRIGGER) || nodes.find((n) => !inn.has(n.id));
    if (!start) return null;
    const order = []; let cur = start.id; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); order.push(nodes.find((n) => n.id === cur)); cur = out.get(cur); }
    if (order.length !== nodes.length || order.some((n) => !n)) return null;
    return order.map((n) => JSON.parse(JSON.stringify(n)));
  }
  function adopt(w) {
    S.wf = w; const st = toSteps(w.graph || {}); S.linear = !!st; S.steps = st || null; S.dirty = false;
    S.extraEdges = st ? (w.graph.edges || []).filter((e) => e.kind === 'data') : [];
  }
  function graphOf() {
    if (!S.linear) return S.wf.graph;
    const ids = new Set(S.steps.map((s) => s.id));
    const nodes = S.steps.map((s, i) => ({ ...s, position: { x: i * 280, y: 0 } }));
    const edges = S.steps.slice(1).map((s, i) => ({ id: `x${i}`, source: S.steps[i].id, sourcePort: 'out', target: s.id, targetPort: 'in', kind: 'exec' }))
      .concat(S.extraEdges.filter((e) => ids.has(e.source) && ids.has(e.target)));
    return { ...S.wf.graph, nodes, edges };
  }
  const newId = (type) => { const base = type.replace(/^xeno-platform-/, '').replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'step'; let i = 1; while (S.steps.some((s) => s.id === `${base}-${i}`)) i++; return `${base}-${i}`; };

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['dev.automate'] = {
    served: true, items: true,
    label: (item) => { const [v, id] = String(item || '').split('/'); if (v === 'workflows' && id) return S.wf && S.wf.id === id ? `Workflows / ${S.wf.name}` : 'Workflow'; if (v === 'runs' && id) return 'Runs / Run'; return (TABS.find(([k]) => k === v) || [, item])[1]; },
    work: () => (S.status === 'ready' && S.list.length ? ['Workflows', S.list.slice(0, 6).map((w) => [w.name, w.state === 'enabled' ? (w.lastRun ? `On · last ${w.lastRun.state}` : 'On') : w.state === 'draft' ? 'Draft' : 'Off', null, 'workflows/' + w.id])] : null),
    badge: () => (S.failures ? S.failures : null),
    page: () => page(),
    state: () => ({ status: S.status, workflows: S.list.length, configured: S.configured, item: itemNow(), open: S.wfId, dirty: S.dirty }),
    reload: () => load(),
  };

  // ─────────────────────────────── the page
  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  const stateLabel = (w) => (w.state === 'enabled' ? 'On' : w.state === 'draft' ? 'Draft' : 'Off');
  const trigLabel = (t) => { if (!t) return 'No workspace event yet'; const base = (EVENTS.find(([k]) => k === t.event) || [, t.event])[1]; return t.event === 'schedule' ? `${base}: ${t.cron} (${t.timezone})` : t.event === 'task.status_changed' && t.taskStatus ? `${base} → ${t.taskStatus.replace('_', ' ')}` : t.event === 'support.ticket_created' && t.ticketKind ? `${base} (${t.ticketKind})` : base; };
  function page() {
    const h = window.XENO_PAGES.h, item = itemNow(), [view, oid] = item.split('/');
    const onWf = view === 'workflows' && oid && UUID.test(oid);
    let acts = '';
    if (onWf && S.wf && !S.wf.error && S.canEdit) {
      const w = S.wf;
      acts = (w.state === 'enabled' ? h.btn('Run now', 'data-au-run', true, 'play') + h.btn('Turn off', 'data-au-disable', true) : h.btn('Turn on', 'data-au-enable', true)) + h.btn('Delete', 'data-au-delete', true) + h.btn(S.dirty ? 'Save changes' : 'Saved', `data-au-save${S.dirty ? '' : ' disabled'}`, false);
    } else if (!onWf && S.canEdit) acts = h.btn('Import', 'data-au-import', true) + h.btn('New workflow', 'data-au-new', false, 'plus');
    const head = h.head({ title: 'Automate', sub: 'Workflows that run on XENO Workflow when something happens in this workspace. Agents draft them; a person turns them on.', acts })
      + h.tabs(TABS.map(([k, l]) => [k, l, k === 'failed' && S.failures ? S.failures : null]), onWf ? 'workflows' : view === 'runs' && oid ? 'runs' : view, 'data-au-tab');
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm au" data-au-page="${esc(S.status)}" data-au-view="${esc(view)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-au-error>${esc(S.error)} ${btn('data-au-reload', 'Try again')}</div>`);
    const banner = S.configured ? '' : '<p class="au-banner" data-au-unconfigured>XENO Workflow is not connected to this server yet. Workflows can be drafted; none will run until it is.</p>';
    if (onWf) return wrap(banner + workflowPage(oid));
    if (view === 'runs' && oid) return wrap(runPage(oid));
    if (view === 'runs' || view === 'failed') { if (S.runsFor !== view) loadRuns(view); return wrap(runsTable(S.allRuns, true)); }
    return wrap(banner + listPage());
  }
  function listPage() {
    if (!S.list.length) return `<div class="pj-empty" data-au-none>No workflows yet.${S.canEdit ? ' Start one with New workflow, or import a graph from the XENO Workflow app.' : ' A workspace admin creates them.'}</div>`;
    return `<div class="au-list" data-au-list>${S.list.map((w) => `<button class="au-li" data-au-open="${esc(w.id)}" data-au-state="${esc(w.state)}"><span><b>${esc(w.name)}</b><small>${esc(trigLabel(w.trigger))} · ${w.steps} step${w.steps === 1 ? '' : 's'}${w.lastRun ? ` · last run ${esc(w.lastRun.state)}` : ''}${w.disabledReason && w.state !== 'enabled' ? ` · ${esc(w.disabledReason)}` : ''}</small></span><span class="au-tag">${esc(stateLabel(w))}</span></button>`).join('')}</div>`;
  }

  function fieldHtml(stepIdx, f, val, ro) {
    const name = `${stepIdx}.${f.key}`, dis = ro ? ' disabled' : '';
    const lab = `<small>${esc(f.label)}</small>`;
    if (f.type === 'select') return `<label class="au-f">${lab}<select class="in" data-au-f="${esc(name)}"${dis}>${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(val ?? f.defaultValue ?? '') === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    if (f.type === 'boolean') return `<label class="au-f au-b"><input type="checkbox" data-au-f="${esc(name)}" ${val ?? f.defaultValue ? 'checked' : ''}${dis}> ${esc(f.label)}</label>`;
    const text = typeof val === 'string' ? val : val == null ? (f.defaultValue == null ? '' : typeof f.defaultValue === 'string' ? f.defaultValue : JSON.stringify(f.defaultValue)) : JSON.stringify(val, null, 2);
    if (['json', 'textarea', 'code', 'expression'].includes(f.type)) return `<label class="au-f">${lab}<textarea class="in" rows="${f.type === 'code' ? 6 : 3}" data-au-f="${esc(name)}" spellcheck="false"${dis}>${esc(text)}</textarea></label>`;
    return `<label class="au-f">${lab}<input class="in" data-au-f="${esc(name)}" value="${esc(text)}"${f.type === 'number' ? ' inputmode="decimal"' : ''}${dis}></label>`;
  }
  function stepHtml(s, i, ro) {
    const d = defOf(s.type), cfg = s.config || {};
    let fields = (d ? d.configFields : []).filter((f) => f.type !== 'credential');
    if (s.type === TRIGGER) { const ev = cfg.event || 'task.status_changed'; const keep = { 'task.status_changed': ['taskStatus'], 'support.ticket_created': ['ticketKind'], 'form.response_submitted': ['formId'], schedule: ['cron', 'timezone'], webhook: [] }[ev] || []; fields = fields.filter((f) => f.key === 'event' || keep.includes(f.key)); }
    let body;
    if (s.type === ACTION) {
      const acts = actions(), cur = String(cfg.capability || ''), cap = acts.find((a) => a.name === cur);
      const sel = acts.length ? `<label class="au-f"><small>Action</small><select class="in" data-au-f="${i}.capability"${ro ? ' disabled' : ''}><option value="">Choose…</option>${acts.map((a) => `<option value="${esc(a.name)}" ${a.name === cur ? 'selected' : ''}>${esc(a.title)} — ${esc(a.name)}</option>`).join('')}</select></label>` : fieldHtml(i, { key: 'capability', label: 'Capability (e.g. tasks.task.create)', type: 'text' }, cur, ro);
      const props = cap && cap.input && cap.input.properties ? Object.keys(cap.input.properties) : [];
      body = sel + fieldHtml(i, { key: 'arguments', label: 'Arguments (JSON)', type: 'json', defaultValue: '{}' }, cfg.arguments, ro) + (props.length ? `<small class="au-hint" data-au-args>Arguments: ${props.map((p) => `<code>${esc(p)}</code>${(cap.input.required || []).includes(p) ? '*' : ''}`).join(', ')}</small>` : '');
    } else body = fields.map((f) => fieldHtml(i, f, cfg[f.key], ro)).join('');
    const tools = ro || s.type === TRIGGER ? '' : `<span class="au-tools">${i > 1 ? btn(`data-au-up="${i}"`, 'Up') : ''}${i < S.steps.length - 1 ? btn(`data-au-down="${i}"`, 'Down') : ''}${btn(`data-au-remove="${i}"`, 'Remove')}</span>`;
    return `<div class="au-step" data-au-step="${esc(s.id)}" data-au-type="${esc(s.type)}"><div class="au-step-h"><b>${i + 1}.</b><input class="in au-label" data-au-label="${i}" value="${esc(s.label || '')}" aria-label="Step name"${ro ? ' disabled' : ''}><small>${esc(d ? d.name : s.type)} · <code>${esc(s.id)}</code></small>${tools}</div>${body}</div>`;
  }
  function workflowPage(id) {
    if (S.wfId !== id) { openWorkflow(id); return '<div class="pj-empty">Opening…</div>'; }
    const w = S.wf; if (!w) return '<div class="pj-empty">Opening…</div>';
    if (w.error) return `<div class="pj-empty" data-au-open-error>${esc(w.error)}</div>`;
    const ro = !S.canEdit;
    const meta = `<p class="au-st" data-au-cur="${esc(w.state)}"><b>${esc(stateLabel(w))}</b> · ${esc(trigLabel(w.trigger))}${w.disabledReason && w.state !== 'enabled' ? ' · ' + esc(w.disabledReason) : ''}${w.createdByKind === 'agent' ? ' · drafted by an agent' : ''}${w.nextRunAt ? ' · next run ' + esc(when(w.nextRunAt)) : ''}${w.capabilities.length ? ` · acts through ${w.capabilities.map((c) => `<code>${esc(c)}</code>`).join(', ')}` : ''}</p>`;
    const name = `<label class="au-f"><small>Name</small><input class="in" data-au-name value="${esc(w.name)}" maxlength="200"${ro ? ' disabled' : ''}></label>`;
    const hook = w.webhookPath ? `<div class="au-hook" data-au-hook><small>POST <code>${esc(location.origin + w.webhookPath)}</code> with <code>X-Xeno-Timestamp</code> (ms) and <code>X-Xeno-Signature: sha256=HMAC(secret, "timestamp.body")</code>.</small>${ro ? '' : btn('data-au-rotate', 'New secret')}${S.secret ? `<p class="au-secret" data-au-secret><b>Webhook secret — shown once:</b> <code>${esc(S.secret)}</code></p>` : ''}</div>` : '';
    let steps;
    if (!S.linear) steps = `<div class="au-branch" data-au-branched><p>This workflow has branches. Edit it in the XENO Workflow app and import it again; it runs here exactly as it is.</p><pre>${esc(JSON.stringify(w.graph, null, 2).slice(0, 20000))}</pre></div>`;
    else steps = `<div class="au-steps" data-au-steps>${S.steps.map((s, i) => stepHtml(s, i, ro)).join('')}</div>${ro ? '' : `<div class="au-add">${btn('data-au-add', 'Add step')}${btn('data-au-export', 'Copy graph')}</div>`}<small class="au-hint">Steps read earlier steps with <code>{{ $node.&lt;step id&gt;.&lt;output&gt; }}</code> — e.g. <code>{{ $node.trigger.event.task.title }}</code>.</small>`;
    return `<div class="au-build" data-au-builder="${esc(w.id)}" data-au-rev="${esc(w.revision)}">${meta}${name}${hook}${steps}<h3>Runs</h3>${runsTable(S.runs, false)}</div>`;
  }
  function runsTable(runs, withName) {
    if (runs == null) return '<div class="pj-empty">Loading runs…</div>';
    if (runs.error) return `<div class="pj-empty">${esc(runs.error)}</div>`;
    if (!runs.length) return `<div class="pj-empty" data-au-no-runs>${S.runsFor === 'failed' && withName ? 'No failed runs.' : 'No runs yet.'}</div>`;
    return `<div class="au-list" data-au-runs>${runs.map((r) => `<button class="au-li" data-au-run-open="${esc(r.id)}" data-au-run-state="${esc(r.state)}"><span><b>${withName ? esc(r.workflowName || '') + ' · ' : ''}${esc(r.state)}</b><small>${esc(r.trigger)} · ${esc(when(r.createdAt))} · attempt ${esc(r.attempt)}${r.resumed ? ' · resumed' : ''}${r.error ? ' — ' + esc(String(r.error).slice(0, 160)) : ''}</small></span><span class="au-tag">${r.steps.length} step${r.steps.length === 1 ? '' : 's'}</span></button>`).join('')}</div>`;
  }
  function runPage(id) {
    if (S.runId !== id) { openRun(id); return '<div class="pj-empty">Opening…</div>'; }
    const r = S.run; if (!r) return '<div class="pj-empty">Opening…</div>';
    if (r.error && !r.id) return `<div class="pj-empty">${esc(r.error)}</div>`;
    const steps = r.steps.length ? r.steps.map((s) => `<div class="au-step" data-au-run-step="${esc(s.nodeId)}" data-au-run-status="${esc(s.status)}"><div class="au-step-h"><b>${esc(s.label || s.nodeId)}</b><small>${esc(s.type || '')} · ${esc(s.status)} · ${esc(s.durationMs)} ms${s.retries ? ` · ${esc(s.retries)} retries` : ''}</small></div>${s.error ? `<p class="au-err">${esc(s.error)}</p>` : ''}<pre>${esc(JSON.stringify(s.outputs, null, 2))}</pre></div>`).join('') : '<p class="pg-dim">No steps ran.</p>';
    const decide = S.canEdit && ['dead', 'failed'].includes(r.state) ? `<div class="au-add">${btn(`data-au-retry="${esc(r.id)}"`, 'Try again', 'btn')}${btn(`data-au-discard="${esc(r.id)}"`, 'Discard')}</div>` : '';
    return `<div class="au-build" data-au-run-view="${esc(r.id)}"><p class="au-st"><b>${esc(r.state)}</b> · ${esc(r.trigger)} · ${esc(when(r.createdAt))} · attempt ${esc(r.attempt)}${r.resumed ? ' · resumed after a restart' : ''}${r.workflowId ? ` · <a href="#" data-au-open="${esc(r.workflowId)}">open the workflow</a>` : ''}</p>${r.error ? `<p class="au-err" data-au-run-error>${esc(r.error)}</p>` : ''}${decide}<h3>Event</h3><pre>${esc(JSON.stringify(r.input, null, 2))}</pre><h3>Steps</h3>${steps}</div>`;
  }

  // ─────────────────────────────── editing
  function readForm(root) {
    if (!S.wf || S.wf.error) return;
    const n = root.querySelector('[data-au-name]'); if (n) S.wf.name = n.value;
    if (!S.linear) return;
    for (const el of root.querySelectorAll('[data-au-label]')) { const s = S.steps[Number(el.dataset.auLabel)]; if (s) s.label = el.value; }
    for (const el of root.querySelectorAll('[data-au-f]')) {
      const [i, key] = [Number(el.dataset.auF.split('.')[0]), el.dataset.auF.slice(el.dataset.auF.indexOf('.') + 1)];
      const s = S.steps[i]; if (!s) continue; s.config = s.config || {};
      const f = (defOf(s.type)?.configFields || []).find((x) => x.key === key);
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (f && f.type === 'number' && v !== '') v = Number(v);
      s.config[key] = v;
    }
  }
  const markDirty = () => { if (!S.dirty) { S.dirty = true; const b = document.querySelector('[data-au-save]'); if (b) { b.disabled = false; b.querySelector('span') && (b.querySelector('span').textContent = 'Save changes'); } } };
  async function send(method, path, body, okMsg) {
    const r = await api(method, path, body).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  async function save() {
    const root = document.querySelector('#main [data-au-page]'); if (root) readForm(root);
    const w = S.wf; const r = await send('PUT', `/api/automate/${encodeURIComponent(w.id)}`, { name: w.name, graph: graphOf(), expectedRevision: w.revision }, 'Saved');
    if (!r) return false;
    adopt(r.workflow); if (r.webhookSecret) S.secret = r.webhookSecret; load(); paint(); return true;
  }
  function newWorkflow() {
    window.XD.form({ title: 'New workflow', submit: 'Create draft',
      fields: [{ id: 'name', label: 'Name', required: true, max: 200, placeholder: 'When a task is done, tell the team' },
        { id: 'event', type: 'choice', label: 'Starts when', value: 'task.status_changed', options: EVENTS.map(([k, l]) => [k, l]) },
        { id: 'description', type: 'textarea', label: 'What it is for', max: 2000 }],
      onSubmit: async (v) => {
        const graph = { version: 2, variables: {}, nodes: [{ id: 'trigger', type: TRIGGER, label: 'When', position: { x: 0, y: 0 }, config: { event: v.event, taskStatus: '', ticketKind: '', formId: '', cron: '0 9 * * 1-5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } }], edges: [] };
        const r = await api('POST', '/api/automate' + q(), { name: v.name, description: v.description || '', graph, ...(S.ws ? { workspace: S.ws } : {}) }).catch(() => null);
        if (!r || !r.ok) return said(r, 'That did not save.');
        S.made = r.d.workflow.id; S.madeSecret = r.d.webhookSecret || null; return null;
      },
    }).then(async (v) => { if (!v || !S.made) return; const id = S.made, sec = S.madeSecret; S.made = null; S.madeSecret = null; toast('Draft created'); await load(); goItem('workflows/' + id); await openWorkflow(id); S.secret = sec; paint(); });
  }
  function importGraph() {
    window.XD.form({ title: 'Import a workflow', sub: 'Paste a graph exported from the XENO Workflow app (.xflow JSON). It is checked against what can run in the workspace.', submit: 'Import as draft', size: 'lg',
      fields: [{ id: 'name', label: 'Name', required: true, max: 200 }, { id: 'json', type: 'textarea', label: 'Graph JSON', required: true, rows: 12, max: 500000 }],
      onSubmit: async (v) => {
        let graph; try { graph = JSON.parse(v.json); } catch { return 'That is not valid JSON.'; }
        if (graph && graph.workflow && graph.workflow.nodes) graph = graph.workflow;   // an export wrapper
        const r = await api('POST', '/api/automate' + q(), { name: v.name, graph, ...(S.ws ? { workspace: S.ws } : {}) }).catch(() => null);
        if (!r || !r.ok) return said(r, 'That could not be imported.');
        S.made = r.d.workflow.id; return null;
      },
    }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; toast('Imported as a draft'); await load(); goItem('workflows/' + id); });
  }
  function addStep(root) {
    readForm(root);
    const all = defs().filter((d) => d.type !== TRIGGER && d.visualCategory !== 'trigger');
    const ordered = [...all.filter((d) => d.type === ACTION), ...all.filter((d) => d.type !== ACTION)];
    window.XD.form({ title: 'Add a step', submit: 'Add', size: 'lg',
      fields: [{ id: 'type', type: 'choice', label: 'Step', value: ACTION, cols: 2, options: ordered.map((d) => [d.type, d.name, d.description ? String(d.description).slice(0, 90) : '']) }],
      onSubmit: async () => null,
    }).then((v) => {
      if (!v || !v.type) return; const d = defOf(v.type);
      S.steps.push({ id: newId(v.type), type: v.type, label: d ? d.name : v.type, config: d && d.defaultConfig ? JSON.parse(JSON.stringify(d.defaultConfig)) : {}, position: { x: 0, y: 0 } });
      markDirty(); paint();
    });
  }

  document.addEventListener('input', (e) => { const t = e.target.closest('[data-au-f],[data-au-label],[data-au-name]'); if (t && t.closest('[data-au-builder]')) markDirty(); }, true);
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-au-f]'); if (!t || !t.closest('[data-au-builder]')) return;
    markDirty();
    if (/^\d+\.(event|capability)$/.test(t.dataset.auF)) { readForm(t.closest('[data-au-page]')); paint(); }   // a new kind shows its own fields
  }, true);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-au-reload],[data-au-tab],[data-au-new],[data-au-import],[data-au-open],[data-au-run-open],[data-au-save],[data-au-enable],[data-au-disable],[data-au-run],[data-au-delete],[data-au-rotate],[data-au-add],[data-au-export],[data-au-up],[data-au-down],[data-au-remove],[data-au-retry],[data-au-discard]');
    if (!t || !(t.closest('[data-au-page]') || t.closest('#main .topbar') || t.closest('.pg-head') || t.closest('.pg-tabs'))) return;
    if (t.closest('.pg-tabs') && !('auTab' in t.dataset)) return;
    e.preventDefault(); e.stopPropagation();
    const root = document.querySelector('#main [data-au-page]') || document.body, d = t.dataset;
    if ('auReload' in d) return load();
    if (d.auTab) { if (S.dirty && !(await window.XD.confirm({ title: 'Leave without saving?', body: 'Your changes to this workflow are not saved.', action: 'Leave', danger: true }))) return; S.dirty = false; S.runsFor = null; return goItem(d.auTab); }
    if ('auNew' in d) return newWorkflow();
    if ('auImport' in d) return importGraph();
    if (d.auOpen) return goItem('workflows/' + d.auOpen);
    if (d.auRunOpen) return goItem('runs/' + d.auRunOpen);
    if (d.auRetry || d.auDiscard) {
      const r = await send('POST', `/api/automate/runs/${encodeURIComponent(d.auRetry || d.auDiscard)}/${d.auRetry ? 'retry' : 'discard'}`, {}, d.auRetry ? 'It will run again shortly' : 'Discarded');
      if (r) { S.run = r.run; load(); paint(); } return;
    }
    const w = S.wf; if (!w || w.error) return;
    if ('auAdd' in d) return addStep(root);
    if (d.auUp || d.auDown || d.auRemove) {
      readForm(root); const i = Number(d.auUp || d.auDown || d.auRemove);
      if (d.auRemove) S.steps.splice(i, 1); else { const j = d.auUp ? i - 1 : i + 1; if (j < 1 || j >= S.steps.length) return; [S.steps[i], S.steps[j]] = [S.steps[j], S.steps[i]]; }
      markDirty(); return paint();
    }
    if ('auExport' in d) { readForm(root); try { await navigator.clipboard.writeText(JSON.stringify(graphOf(), null, 2)); toast('Graph copied — paste it into the XENO Workflow app'); } catch { toast('Could not copy'); } return; }
    if ('auSave' in d) return save();
    if ('auEnable' in d || 'auDisable' in d) {
      if (S.dirty && !(await save())) return;
      const r = await send('POST', `/api/automate/${encodeURIComponent(w.id)}/${'auEnable' in d ? 'enable' : 'disable'}`, {}, 'auEnable' in d ? 'Turned on' : 'Turned off');
      if (r) { adopt(r.workflow); load(); paint(); } return;
    }
    if ('auRun' in d) { const r = await send('POST', `/api/automate/${encodeURIComponent(w.id)}/run`, {}, 'Started'); if (r) { const rr = await api('GET', '/api/automate/runs' + q({ workflowId: w.id, limit: 20 })).catch(() => null); S.runs = rr && rr.ok ? rr.d.runs : S.runs; paint(); } return; }
    if ('auRotate' in d) { const r = await send('POST', `/api/automate/${encodeURIComponent(w.id)}/webhook-secret`, {}, 'New secret made'); if (r) { S.secret = r.webhookSecret; paint(); } return; }
    if ('auDelete' in d) {
      if (!(await window.XD.confirm({ title: 'Delete this workflow?', body: 'It stops, and runs still waiting are discarded. Its run history stays.', action: 'Delete', danger: true }))) return;
      const r = await send('DELETE', `/api/automate/${encodeURIComponent(w.id)}`, null, 'Deleted');
      if (r) { S.wfId = null; S.wf = null; await load(); goItem('workflows'); }
    }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
