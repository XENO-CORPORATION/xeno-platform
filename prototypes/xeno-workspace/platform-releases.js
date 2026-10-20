/* XENO_RELEASES — the platform's release record. Real platform API.
 * Service: src/server/services/releaseRecord.js · routes: /api/releases/* · agents: releasesMcp.js.
 *
 *   What's new        /workspace/releases/whats-new          every signed-in person: notes for features enabled for them
 *   Release console   /workspace/releases                    XENO staff: counts, then the three layers
 *   Deploys           /workspace/releases/deploys            · /deploys/<deploy id>
 *   Features          /workspace/releases/features           · /features/<feature id>
 *   Notes queue       /workspace/releases/notes              drafts to approve (a person approves; agents only draft)
 *
 * The server decides what each person sees: a customer's response carries a note's words and date and nothing else,
 * and every staff read answers 404 to anyone else. Nothing here hides a field — it is simply not in the response. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_RELEASES = { served: false }; return; }
  const X = () => window.XW, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fb) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fb;
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, status: 0, d: {} }));
  const go = (item) => X()?.go?.('global', { global: 'releases', item: item || null });
  const paint = () => { try { X()?.render?.(); } catch {} };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');
  const S = { staff: null, summary: null, news: null, deploys: null, deploy: null, features: null, feature: null, notes: null, noteState: 'draft', repo: '', q: '', busy: false, err: '' };

  async function loadFor(it) {
    const [a, id] = String(it || '').split('/');
    if (S.staff === null) { const s = await api('GET', '/api/releases/summary'); S.staff = s.ok; if (s.ok) S.summary = s.d.summary; }
    if (a === 'whats-new' || !S.staff) { const r = await api('GET', '/api/releases/whats-new'); S.news = r.ok ? r.d.notes || [] : { error: said(r, 'What’s new did not load') }; }
    else if (a === 'deploys' && id) { const r = await api('GET', `/api/releases/deploys/${encodeURIComponent(id)}`); S.deploy = r.ok ? r.d.deploy : { missing: true }; }
    else if (a === 'deploys') { const r = await api('GET', '/api/releases/deploys?limit=200'); S.deploys = r.ok ? r.d.deploys || [] : []; }
    else if (a === 'features' && id) { const r = await api('GET', `/api/releases/features/${encodeURIComponent(id)}`); S.feature = r.ok ? r.d.feature : { missing: true }; }
    else if (a === 'features') { const r = await api('GET', `/api/releases/features?limit=200${S.repo ? '&repo=' + encodeURIComponent(S.repo) : ''}${S.q ? '&q=' + encodeURIComponent(S.q) : ''}`); S.features = r.ok ? r.d.features || [] : []; }
    else if (a === 'notes') { const r = await api('GET', `/api/releases/notes?state=${encodeURIComponent(S.noteState)}`); S.notes = r.ok ? r.d.notes || [] : []; }
    paint();
  }
  let lastLoad = null;
  const want = (it) => { const k = it || ''; if (lastLoad !== k) { lastLoad = k; loadFor(it); } };

  const tabs = (cur) => `<div class="pg-tabs" role="tablist">${[['', 'Overview'], ['deploys', 'Deploys'], ['features', 'Features'], ['notes', 'Notes'], ['whats-new', 'What’s new']].map(([k, l]) => `<button role="tab" aria-selected="${cur === k}" data-rl-go="${k}">${l}</button>`).join('')}</div>`;
  const head = (title, sub, cur) => H().head({ eyebrow: cur === null ? '' : '<a data-rl-go="">Releases</a>', title, sub });

  function newsPage() {
    const h = H(), list = Array.isArray(S.news) ? S.news : [];
    const body = S.news == null ? '' : S.news.error ? h.box('alert', 'What’s new did not load', esc(S.news.error), h.btn('Try again', 'data-rl-reload', true))
      : list.length ? `<ol class="rl-news">${list.map((n) => `<li data-note="${esc(n.id)}"><span class="rl-date">${esc(day(n.date))}</span><div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></div></li>`).join('')}</ol>`
        : h.box('check', 'Nothing new yet', 'When XENO turns on something new for you, it is described here.');
    return h.page(h.head({ title: 'What’s new', sub: 'What you can do now that you could not before.' }) + (S.staff ? tabs('whats-new') : '') + body);
  }

  function overviewPage() {
    const h = H(), s = S.summary || {};
    const stat = (k, v, go_) => `<button class="rl-stat" data-rl-go="${go_}"><b>${esc(v)}</b><span>${esc(k)}</span></button>`;
    return h.page(head('Releases', 'The platform’s own record: every deploy, every feature, and what customers are told.', null) + tabs('')
      + `<div class="rl-stats">${stat('Deploys', s.deploys ?? '—', 'deploys')}${stat('Last deploy', s.lastDeploy ? when(s.lastDeploy) : '—', 'deploys')}${stat('Features', s.features ?? '—', 'features')}${stat('Changes', s.changes ?? '—', 'features')}${stat('Notes to approve', s.drafts ?? '—', 'notes')}</div>`
      + (s.repos && s.repos.length ? h.table(['Repository', 'Changes'], s.repos.map((r) => h.tr(`data-rl-repo="${esc(r.repo)}"`, [esc(r.repo), esc(r.changes)]))) : '')
      + h.foot('releases', 'GET /api/releases/summary', 'record'));
  }

  function deploysPage() {
    const h = H(), rows = S.deploys || [];
    return h.page(head('Deploys', 'Every deploy of the platform. Reconstructed rows say where they came from.') + tabs('deploys')
      + (rows.length ? h.table(['When', 'Service', 'Commit', 'Mode', 'Result', 'PRs', 'Source'], rows.map((d) => h.tr(`data-rl-go="deploys/${esc(d.id)}"`, [esc(when(d.startedAt)), esc(d.service), `<code>${esc(d.sha)}</code>`, esc(d.mode), h.chip(d.status === 'ok' ? 'OK' : d.status === 'failed' ? 'Failed' : 'Interrupted'), esc(d.prs.length || ''), esc(d.provenance)])))
        : S.deploys == null ? '' : h.box('check', 'No deploys recorded yet', 'Each deploy writes a row here when it finishes.')));
  }

  function deployPage() {
    const h = H(), d = S.deploy;
    if (!d) return h.page('');
    if (d.missing) return h.page(h.box('alert', 'Deploy not found', 'It does not exist, or it is not yours to read.', h.btn('Deploys', 'data-rl-go="deploys"', true)));
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    return h.page(h.head({ eyebrow: '<a data-rl-go="deploys">Deploys</a>', title: `${d.service} @ ${d.sha}`, sub: `${d.status === 'ok' ? 'Succeeded' : d.status === 'failed' ? 'Failed' : 'Interrupted'} · ${when(d.startedAt)}` })
      + `<dl class="rl-dl">${row('Started', esc(when(d.startedAt)))}${row('Finished', esc(when(d.finishedAt)))}${row('Mode', esc(d.mode))}${row('Previous commit', d.previousSha ? `<code>${esc(d.previousSha)}</code>` : '—')}${row('Deployed by', esc(d.deployedBy || 'not recorded'))}${row('Healthcheck', esc(d.healthcheck || '—'))}${row('Rollback point', esc(d.rollbackPoint || '—'))}${row('Migrations', d.migrations.length ? d.migrations.map((m) => `<code>${esc(m)}</code>`).join('<br>') : 'none')}${row('Source', esc(d.provenance + (d.evidence ? ' — ' + d.evidence : '')))}</dl>`
      + (d.pullRequests && d.pullRequests.length ? h.table(['PR', 'Title', 'Merged'], d.pullRequests.map((p) => h.tr('', [`<a href="${esc(p.url)}" target="_blank" rel="noopener">#${esc(p.number)}</a>`, esc(p.title), esc(when(p.mergedAt))]))) : `<p class="pg-dim">${d.prs.length ? 'PRs: ' + d.prs.map((n) => '#' + n).join(', ') : 'No pull requests between this and the previous deploy.'}</p>`));
  }

  function featuresPage() {
    const h = H(), rows = S.features || [];
    return h.page(head('Features', 'Each feature, where it is turned on, and what built it.') + tabs('features')
      + `<form class="rl-bar" data-rl-form="filter"><input name="q" value="${esc(S.q)}" placeholder="Search features" aria-label="Search features"><input name="repo" value="${esc(S.repo)}" placeholder="Repository" aria-label="Repository">${h.btn('Filter', 'type="submit"', true)}</form>`
      + (rows.length ? h.table(['Feature', 'Repository', 'Status', 'Enabled for', 'Changes', 'Last change'], rows.map((f) => h.tr(`data-rl-go="features/${esc(f.id)}"`, [esc(f.title), esc(f.repo), h.chip(f.status), esc(scopeWords(f.enabled)), esc(f.changes ?? ''), esc(when(f.lastChangeAt))])))
        : S.features == null ? '' : h.box('check', 'No features match', 'Try another search.')));
  }
  const scopeWords = (e) => (e.scope === 'all' ? 'Everyone' : e.scope === 'plans' ? `Plans: ${e.plans.join(', ')}` : e.scope === 'workspaces' ? `${e.workspaces.length} workspace(s)` : 'Nobody yet');

  function featurePage() {
    const h = H(), f = S.feature;
    if (!f) return h.page('');
    if (f.missing) return h.page(h.box('alert', 'Feature not found', 'It does not exist, or it is not yours to read.', h.btn('Features', 'data-rl-go="features"', true)));
    const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    const controls = `<form class="rl-form" data-rl-form="feature">
      <label>Status<select name="status">${opt('built', f.status, 'Built')}${opt('live', f.status, 'Live')}${opt('retired', f.status, 'Retired')}</select></label>
      <label>Enabled for<select name="enabledScope">${opt('none', f.enabled.scope, 'Nobody')}${opt('all', f.enabled.scope, 'Everyone')}${opt('plans', f.enabled.scope, 'Plans')}${opt('workspaces', f.enabled.scope, 'Workspaces')}</select></label>
      <label>Plans (comma-separated)<input name="enabledPlans" value="${esc(f.enabled.plans.join(', '))}"></label>
      <label>Workspace ids (comma-separated)<input name="workspaceIds" value="${esc(f.enabled.workspaces.join(', '))}"></label>
      <label>Spec or requirement<input name="specRef" value="${esc(f.specRef || '')}" maxlength="500"></label>
      <label>Test proof<input name="testProof" value="${esc(f.testProof || '')}" maxlength="500"></label>
      <div class="sp-row">${h.btn(S.busy ? 'Saving…' : 'Save', `type="submit"${S.busy ? ' disabled' : ''}`)}</div></form>`;
    const notes = (f.notes || []).map((n) => `<article class="pg-post${n.state === 'draft' ? ' sp-draft' : ''}" data-note="${esc(n.id)}"><span class="pg-av">N</span><div><div class="sp-meta"><b>${esc(n.title)}</b> <span class="pg-tag">${esc(n.state === 'draft' ? `Draft by ${n.draftedByKind === 'agent' ? 'an agent' : 'staff'} — customers do not see it` : n.state === 'approved' ? 'Approved' : 'Withdrawn')}</span></div><div class="sp-body">${esc(n.body)}</div>${n.state === 'draft' ? `<div class="sp-row">${h.btn('Approve', `data-rl-approve="${esc(n.id)}"`)}${h.btn('Withdraw', `data-rl-withdraw="${esc(n.id)}"`, true)}</div>` : n.state === 'approved' ? `<div class="sp-row">${h.btn('Withdraw', `data-rl-withdraw="${esc(n.id)}"`, true)}</div>` : ''}</div></article>`).join('');
    return h.page(h.head({ eyebrow: '<a data-rl-go="features">Features</a>', title: f.title, sub: `${f.repo} · ${f.slug}${f.provenance === 'derived' ? ' · derived from history: ' + (f.evidence || '') : ''}` })
      + (S.err ? `<p class="sp-err" role="alert">${esc(S.err)}</p>` : '')
      + `<div class="sp-layout with-console"><div class="pg-thread">
          <h3 class="rl-h">Customer notes</h3>${notes || '<p class="pg-dim">No notes yet. A customer sees a note only once it is approved, the feature is live, and it is enabled for them.</p>'}
          <form class="sp-form" data-rl-form="note"><label>Title<input name="title" maxlength="160" required placeholder="What they can do now"></label><label>Note<textarea name="body" rows="4" maxlength="4000" required placeholder="Plain language: the outcome, never how it was built"></textarea></label><div class="sp-row">${h.btn('Save draft', 'type="submit"')}</div></form>
          <h3 class="rl-h">Changes</h3>${(f.changes || []).length ? h.table(['Kind', 'Change', 'When'], f.changes.map((c) => h.tr('', [esc(c.kind), c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.kind === 'pr' ? '#' + c.id : c.id)}</a> ${esc(c.title)}` : `${esc(c.id)} ${esc(c.title)}`, esc(when(c.at))]))) : '<p class="pg-dim">No changes linked.</p>'}
        </div><aside class="sp-console" aria-label="Feature controls">${controls}</aside></div>`);
  }

  function notesPage() {
    const h = H(), rows = S.notes || [];
    const F = [['draft', 'Drafts'], ['approved', 'Approved'], ['withdrawn', 'Withdrawn']];
    return h.page(head('Notes', 'Agents and staff draft; a person on staff approves before any customer sees it.') + tabs('notes')
      + `<div class="pg-bar"><div class="pg-seg" role="tablist">${F.map(([k, l]) => `<button role="tab" aria-selected="${S.noteState === k}" data-rl-notes="${k}">${l}</button>`).join('')}</div></div>`
      + (rows.length ? `<div class="pg-thread">${rows.map((n) => `<article class="pg-post${n.state === 'draft' ? ' sp-draft' : ''}" data-note="${esc(n.id)}"><span class="pg-av">N</span><div><div class="sp-meta"><b>${esc(n.title)}</b> <small><a data-rl-go="features/${esc(n.featureId)}">${esc(n.feature.title)}</a> · ${esc(n.feature.status)}</small></div><div class="sp-body">${esc(n.body)}</div>${n.state === 'draft' ? `<div class="sp-row">${h.btn('Approve', `data-rl-approve="${esc(n.id)}"`)}${h.btn('Withdraw', `data-rl-withdraw="${esc(n.id)}"`, true)}</div>` : ''}</div></article>`).join('')}</div>`
        : h.box('check', 'Nothing here', 'No notes in this state.')));
  }

  function route(it) {
    want(it);
    const [a, id] = String(it || '').split('/');
    if (a === 'whats-new' || S.staff === false) return newsPage();
    if (S.staff === null) return H().page('');
    if (a === 'deploys' && UUID.test(id || '')) return deployPage();
    if (a === 'deploys') return deploysPage();
    if (a === 'features' && UUID.test(id || '')) return featurePage();
    if (a === 'features') return featuresPage();
    if (a === 'notes') return notesPage();
    return overviewPage();
  }
  const label = (x) => {
    if (UUID.test(x)) return S.feature && S.feature.id === x ? S.feature.title : S.deploy && S.deploy.id === x ? `${S.deploy.service} @ ${S.deploy.sha}` : x;
    return { 'whats-new': 'What’s new', deploys: 'Deploys', features: 'Features', notes: 'Notes' }[x] || x;
  };

  const here = () => X()?.S?.item || '';
  const refresh = () => { lastLoad = ''; S.summary = null; S.staff = null; loadFor(here()); };
  async function act(method, path, body, msg) {
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) { S.err = said(r, 'That did not work'); return paint(); }
    S.err = ''; if (msg) toast(msg); refresh();
  }
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-rl-go],[data-rl-reload],[data-rl-repo],[data-rl-notes],[data-rl-approve],[data-rl-withdraw]');
    if (!t || !t.closest('#main, #panel')) return;
    e.preventDefault();
    if (t.dataset.rlGo !== undefined) return go(t.dataset.rlGo || null);
    if (t.hasAttribute('data-rl-reload')) return refresh();
    if (t.dataset.rlRepo) { S.repo = t.dataset.rlRepo; S.q = ''; return go('features'); }
    if (t.dataset.rlNotes) { S.noteState = t.dataset.rlNotes; lastLoad = ''; return loadFor(here()); }
    if (t.dataset.rlApprove) return act('POST', `/api/releases/notes/${t.dataset.rlApprove}/approve`, {}, 'Approved — customers it is enabled for now see it');
    if (t.dataset.rlWithdraw) return act('POST', `/api/releases/notes/${t.dataset.rlWithdraw}/withdraw`, {}, 'Withdrawn');
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-rl-form]');
    if (!f || !f.closest('#main')) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries()), kind = f.dataset.rlForm;
    if (kind === 'filter') { S.q = v.q || ''; S.repo = v.repo || ''; lastLoad = ''; return loadFor(here()); }
    if (kind === 'note' && S.feature) return act('POST', `/api/releases/features/${S.feature.id}/notes`, { title: v.title, body: v.body }, 'Draft saved');
    if (kind === 'feature' && S.feature) return act('PATCH', `/api/releases/features/${S.feature.id}`, { status: v.status, enabledScope: v.enabledScope, enabledPlans: list(v.enabledPlans), workspaceIds: list(v.workspaceIds), specRef: v.specRef || null, testProof: v.testProof || null }, 'Saved');
  });

  window.XENO_RELEASES = { served: true, route, label, open: (item) => go(item || null), state: () => ({ staff: S.staff, news: Array.isArray(S.news) ? S.news.length : null }) };
})();
