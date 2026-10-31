/* platform-analytics.js — on the platform, Corpo › Analytics shows the workspace's real numbers.
 *
 * The picture's Analytics area listed two sample dashboards ("Revenue €42k", "Support 7 open"). Here it reads
 * /api/workspace-analytics (routes/workspaceAnalyticsRoutes.js → services/analytics.js) for the workspace you are in:
 *
 *   metrics          GET /metrics → the catalogue (credits, tasks, storage, support, agent runs) + divisions
 *   a value          GET /metrics/:metric?days=&division=
 *   dashboards       GET /dashboards · POST /dashboards {name, widgets} · DELETE /dashboards/:id (undo: /restore)
 *
 * With no saved dashboard it shows "Overview": every metric over 30 days. A division narrows the metrics that
 * have a division view (tasks, runs); the others say they are workspace-wide.
 *
 * It registers XENO_ZONE_LIVE['corpo.analytics'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const S = { status: 'idle', ws: undefined, metrics: [], divisions: [], dashboards: [], current: 'overview', division: '', values: {}, error: null, undo: null };
  // each dashboard has its own address: /…/z/analytics (Overview) · /…/z/analytics/<dashboard id>
  const curNow = () => { const it = String((X()?.S || {}).item || ''); return S.dashboards.some((x) => x.id === it) ? it : 'overview'; };
  const goDash = (id) => X()?.go?.('zone', { zone: 'analytics', item: !id || id === 'overview' ? null : id });
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'analytics') X().render(); } catch {} };

  const widgetsOf = () => {
    if (S.current === 'overview') return S.metrics.map((m) => ({ metric: m.id, days: 30 }));
    const d = S.dashboards.find((x) => x.id === S.current); return d ? d.widgets : [];
  };
  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const [m, d] = await Promise.all([api('GET', '/api/workspace-analytics/metrics' + q()).catch(() => null), api('GET', '/api/workspace-analytics/dashboards' + q()).catch(() => null)]);
    if (!m || !m.ok) { S.status = 'error'; S.error = said(m, 'Analytics could not be reached.'); return paint(); }
    S.metrics = m.d.metrics || []; S.divisions = m.d.divisions || []; S.dashboards = (d && d.ok && d.d.dashboards) || [];
    S.current = curNow();
    if (S.division && !S.divisions.some((x) => x.id === S.division)) S.division = '';
    S.status = 'ready'; paint(); await values();
  }
  async function values() {
    const ws = widgetsOf(); S.values = {};
    await Promise.all(ws.map(async (w, i) => {
      const meta = S.metrics.find((x) => x.id === w.metric);
      const div = S.division && meta && meta.scope === 'division' ? S.division : '';
      const r = await api('GET', `/api/workspace-analytics/metrics/${encodeURIComponent(w.metric)}` + q({ days: w.days, division: div })).catch(() => null);
      S.values[i] = r && r.ok ? r.d : { error: said(r, 'Could not read this metric') };
    }));
    paint();
  }

  const fmtBytes = (n) => { if (n == null) return 'no limit'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = Number(n); while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`; };
  const num = (n) => Number(n || 0).toLocaleString();
  function spark(series, days) {
    if (!series || !series.length) return '<div class="an-spark an-none">No activity in this window</div>';
    const byDay = new Map(series.map((p) => [p.day, p.value])), pts = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); pts.push(byDay.get(d) || 0); }
    const max = Math.max(1, ...pts), w = 100 / pts.length;
    return `<svg class="an-spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="per day">${pts.map((v, i) => `<rect x="${(i * w).toFixed(2)}" y="${(24 - (v / max) * 24).toFixed(2)}" width="${Math.max(0.4, w - 0.4).toFixed(2)}" height="${((v / max) * 24).toFixed(2)}"></rect>`).join('')}</svg>`;
  }
  const kv = (o) => Object.keys(o || {}).length ? Object.entries(o).map(([k, v]) => `<span class="an-kv"><small>${esc(k.replace(/_/g, ' '))}</small> ${num(v)}</span>`).join('') : '<span class="an-kv"><small>none</small></span>';
  function card(w, i) {
    const r = S.values[i], meta = S.metrics.find((x) => x.id === w.metric) || { title: w.metric };
    const head = `<div class="an-card-h"><b>${esc(meta.title)}</b><small>${esc(w.days)} days${r && r.scope === 'division' ? ' · ' + esc(r.division && r.division.name) : S.division && meta.scope === 'workspace' ? ' · workspace-wide' : ''}</small></div>`;
    if (!r) return `<div class="an-card" data-an-card="${esc(w.metric)}">${head}<div class="an-none">Loading…</div></div>`;
    if (r.error) return `<div class="an-card" data-an-card="${esc(w.metric)}">${head}<div class="an-none" data-an-err>${esc(r.error)}</div></div>`;
    const v = r.value; let body = '';
    if (w.metric === 'credits.spend') body = v.wallet ? `<div class="an-big" data-an-big>${num(v.spent)}</div><small>credits spent · balance ${num(v.balance)}</small>${spark(v.series, w.days)}` : '<div class="an-none">This workspace has no wallet yet.</div>';
    else if (w.metric === 'tasks.throughput') body = `<div class="an-big" data-an-big>${num(v.closed)}</div><small>done · ${num(v.created)} created · median cycle ${v.medianCycleHours == null ? '—' : esc(v.medianCycleHours) + ' h'}</small>${spark(v.closedSeries, w.days)}<div class="an-kvs">${kv(v.open)}</div>`;
    else if (w.metric === 'storage.usage') { const pct = v.allowanceBytes ? Math.min(100, Math.round((v.usedBytes / v.allowanceBytes) * 100)) : null; body = `<div class="an-big" data-an-big>${esc(fmtBytes(v.usedBytes))}</div><small>of ${esc(fmtBytes(v.allowanceBytes))} · ${num(v.files)} files</small>${pct == null ? '' : `<div class="an-bar"><i style="width:${pct}%"></i></div>`}<div class="an-kvs">${kv(Object.fromEntries((v.byKind || []).map((k) => [k.kind, k.files])))}</div>`; }
    else if (w.metric === 'support.tickets') body = `<div class="an-big" data-an-big>${num(v.openTotal)}</div><small>open · ${num(v.created)} raised · median first reply ${v.medianFirstResponseHours == null ? '—' : esc(v.medianFirstResponseHours) + ' h'}</small>${spark(v.createdSeries, w.days)}<div class="an-kvs">${kv(v.open)}</div>`;
    else if (w.metric === 'runs.agents') body = `<div class="an-big" data-an-big>${num(v.total)}</div><small>runs · ${num(v.budgetCredits)} credits reserved</small><div class="an-kvs">${kv(v.byState)}</div>`;
    return `<div class="an-card" data-an-card="${esc(w.metric)}">${head}${body}</div>`;
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['corpo.analytics'] = {
    served: true,
    items: true,
    label: (item) => (S.dashboards.find((x) => x.id === item) || { name: 'Dashboard' }).name,
    work: () => (S.status === 'ready' ? ['Dashboards', [['Overview', 'All metrics', null, 'Analytics'], ...S.dashboards.slice(0, 6).map((d) => [d.name, `${d.widgets.length} widget${d.widgets.length === 1 ? '' : 's'}`, null, 'Analytics'])]] : null),
    badge: () => null,
    page: () => page(),
    state: () => ({ status: S.status, dashboards: S.dashboards.length, metrics: S.metrics.length, current: S.current }),
    reload: () => load(),
  };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page() {
    // the page's one header (XENO_PAGES): dashboards are tabs in the header bar, the division filter beside the
    // actions, New dashboard right; creating opens the workspace dialog, never a form in the page
    const h = window.XENO_PAGES.h, ready = S.status === 'ready';
    if (ready) { const c = curNow(); if (c !== S.current) { S.current = c; setTimeout(values, 0); } }
    const divs = ready && S.divisions.length ? `<div class="pg-bar"><label class="an-div">Division <select class="in" data-an-division aria-label="Division"><option value="">Whole workspace</option>${S.divisions.map((d) => `<option value="${esc(d.id)}" ${S.division === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label></div>` : '';
    const acts = (ready && S.current !== 'overview' ? h.btn('Delete dashboard', `data-an-delete="${esc(S.current)}"`, true) : '') + h.btn('New dashboard', 'data-an-new', false, 'plus');
    const head = h.head({ title: 'Analytics', sub: 'Your workspace’s numbers: credits, tasks, storage, support and agent runs.', acts }) + (ready ? h.tabs([['overview', 'Overview'], ...S.dashboards.map((d) => [d.id, d.name])], S.current, 'data-an-open') : '') + divs;
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm" data-an-page="${esc(S.status)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-an-error>${esc(S.error)} ${btn('data-an-reload', 'Try again')}</div>`);
    const ws = widgetsOf();
    const grid = ws.length ? `<div class="an-grid">${ws.map(card).join('')}</div>` : '<div class="pj-empty">This dashboard has no widgets.</div>';
    const undo = S.undo ? `<div class="an-undo" data-an-undone>“${esc(S.undo.name)}” was deleted. ${btn(`data-an-undo="${esc(S.undo.id)}"`, 'Undo')}</div>` : '';
    return wrap(`${undo}${grid}`);
  }

  // New dashboard: the workspace dialog (XD.form)
  function newDash() {
    window.XD.form({ title: 'New dashboard', submit: 'Save dashboard',
      fields: [{ id: 'name', label: 'Dashboard name', required: true, max: 120 },
        { id: 'metrics', type: 'checks', label: 'Metrics', required: true, value: S.metrics.map((m) => m.id), options: S.metrics.map((m) => [m.id, m.title]) },
        { id: 'days', type: 'seg', label: 'Window', value: '30', options: [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']] }],
      onSubmit: async (v) => { const r = await api('POST', '/api/workspace-analytics/dashboards', withWs({ name: v.name, widgets: v.metrics.map((metric) => ({ metric, days: Number(v.days || 30) })) })).catch(() => null); if (!r || !r.ok) return said(r, 'That did not save.'); S.made = r.d.dashboard.id; return null; },
    }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; toast('Dashboard saved'); await load(); goDash(id); });
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-an-reload],[data-an-open],[data-an-new],[data-an-delete],[data-an-undo]');
    if (!t || !(t.closest('[data-an-page]') || t.closest('#main .topbar'))) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset;
    if ('anReload' in d) return load();
    if (d.anOpen) return goDash(d.anOpen);
    if ('anNew' in d) return newDash();
    if (d.anDelete) {
      const id = d.anDelete, r = await api('DELETE', `/api/workspace-analytics/dashboards/${encodeURIComponent(id)}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not delete.'));
      const was = S.dashboards.find((x) => x.id === id);
      S.undo = { id, name: was ? was.name : 'Dashboard' }; S.current = 'overview'; toast('Dashboard deleted'); goDash(null); return load();
    }
    if (d.anUndo) {
      const id = d.anUndo, u = await api('POST', `/api/workspace-analytics/dashboards/${encodeURIComponent(id)}/restore`, withWs({})).catch(() => null);
      if (!u || !u.ok) return toast(said(u, 'Could not restore it'));
      S.undo = null; toast('Dashboard restored'); await load(); return goDash(id);
    }
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-an-division]'); if (!t || !t.closest('#main')) return;
    S.division = t.value; paint(); values();
  }, true);

  P.lazyZone(window.XENO_ZONE_LIVE['corpo.analytics'], () => load());   // the first load waits until the area is shown
})();
