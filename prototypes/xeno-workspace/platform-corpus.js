/* platform-corpus.js — XENO Corpus on a project and a division (services/xenoCorpus.js, /api/corpus).
 *
 *   Corpus (project)   /workspace/projects/<pid>/corpus                       tenets + latest verdict, inherited doctrine,
 *                                                                              narrower scopes by reference, proposals to ratify
 *   a tenet            /workspace/projects/<pid>/corpus/<tenet id>             its signed verdict history
 *   Corpus (division)  the Corpus section of /workspace/divisions/<id>
 *   a tenet            /workspace/divisions/<division id>/corpus/<tenet id>
 *
 * Agents propose (XENO MCP corpus.propose); a PERSON who administers the scope ratifies or rejects here. Nothing a
 * proposal says is applied until then. Served from disk (no platform), none of this appears.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_CORPUS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { if (window.XENO_PAGES?.repaint && document.querySelector('#main .mview')) window.XENO_PAGES.repaint(); else X()?.render?.(); } catch {} };
  const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ''; } };
  const why = (r, d) => (r && r.d && (r.d.error || r.d.code)) || d;

  const C = new Map();
  function view(key, loader) {
    const c = C.get(key); if (c) return c;
    const e = { status: 'loading', d: null }; C.set(key, e);
    loader().then((r) => { e.status = r.ok ? 'ready' : r.status === 404 ? 'missing' : 'error'; e.d = r.d; paint(); }, () => { e.status = 'error'; paint(); });
    return e;
  }
  const drop = (prefix) => { for (const k of [...C.keys()]) if (k.startsWith(prefix)) C.delete(k); };

  const STATE = { held: 'Held', lapsed: 'Lapsed', error: 'Error' };
  const FRESH = { fresh: 'Fresh', due: 'Due', warn: 'Aging', expired: 'Expired', never: 'Never assayed', doctrine: 'Doctrine' };
  const badge = (state, freshness) => `<span class="xcp-st xcp-st--${esc(state || 'none')}">${esc(state ? STATE[state] : 'No verdict')}</span>${freshness && freshness !== 'doctrine' ? ` <small class="pg-dim">${esc(FRESH[freshness] || freshness)}</small>` : ''}`;

  /** The tenet's own address, with its parent in the path. */
  const tenetHref = (kind, scopeId, tid, projectName) => kind === 'project' && projectName
    ? `data-xcp="open-project" data-to="${esc(projectName)}/Corpus/${esc(tid)}"` : `data-pg-ws="Divisions/${esc(scopeId)}/corpus/${esc(tid)}"`;

  function section(kind, scopeId, h, { projectName = null, title = 'Corpus' } = {}) {
    const key = `corpus:${kind}:${scopeId}`;
    const e = view(key, () => P.api('GET', `/api/corpus/${kind}/${scopeId}`));
    const head = (acts = '') => `<div class="pg-sec-h"><h3>${esc(title)}</h3>${acts}</div>`;
    if (e.status === 'loading') return `<section class="pg-sec" data-sec="corpus">${head()}${h.box('refresh', 'Loading the corpus', '', '', 'sm')}</section>`;
    if (e.status !== 'ready') return `<section class="pg-sec" data-sec="corpus">${head()}${h.box('x', 'The corpus could not be read', 'Try again in a moment.', h.btn('Retry', `data-xcp="retry" data-k="${esc(key)}"`, true), 'sm')}</section>`;
    const c = e.d;
    const acts = (c.canManage ? h.btn('New tenet', `data-xcp="new-tenet" data-kind="${esc(kind)}" data-id="${esc(scopeId)}"`, true, 'plus') : '')
      + h.btn('Propose', `data-xcp="propose" data-kind="${esc(kind)}" data-id="${esc(scopeId)}"`, true, 'edit');
    const tenets = c.tenets.length ? h.table(['Tenet', 'Claim', 'Latest verdict'], c.tenets.map((t) => h.tr(tenetHref(kind, scopeId, t.id, projectName), [
      `<b class="pg-name">${esc(t.key)}</b>${t.kind === 'doctrine' ? ' <small class="pg-dim">doctrine</small>' : ''}${t.origin === 'imported' ? ' <small class="pg-dim">from .xeno/corpus</small>' : ''}`,
      `<small>${esc(t.claim)}</small>`, t.kind === 'doctrine' ? '<small class="pg-dim">Binds narrower scopes</small>' : badge(t.latest?.state, t.freshness)])))
      : h.box('check', 'No tenets yet', 'A tenet is a claim bound to the procedure that would disprove it. Each verdict is signed and kept.', '', 'sm');
    const doctrine = c.inheritedDoctrine.length ? `<div class="grp">Doctrine from wider scopes</div><ul class="xcp-list">${c.inheritedDoctrine.map((t) => `<li><b>${esc(t.key)}</b> <small class="pg-dim">${esc(t.from.split(':')[0])}</small><p class="pg-dim">${esc(t.claim)}</p></li>`).join('')}</ul>` : '';
    const agg = c.aggregated.length ? `<div class="grp">From narrower scopes (by reference)</div>${h.table(['Tenet', 'Where', 'Latest'], c.aggregated.map((t) => h.tr('', [`<b class="pg-name">${esc(t.key)}</b>`, `<small class="pg-dim">${esc(t.from.split(':')[0])}</small>`, badge(t.state, t.freshness)])))}` : '';
    const open = c.proposals.filter((p) => p.state === 'proposed');
    const proposals = open.length ? `<div class="grp">Proposals to ratify</div><ul class="xcp-list">${open.map((p) => `<li class="xcp-prop" data-pid="${esc(p.id)}"><b>${esc(p.action === 'add' ? 'Add' : p.action === 'supersede' ? 'Replace' : 'Retire')} ${esc(p.tenet?.key || '')}</b> <small class="pg-dim">by ${esc(p.proposerKind === 'agent' ? 'an agent' : 'a person')}</small>
        ${p.tenet ? `<p>${esc(p.tenet.claim)}</p>` : ''}<p class="pg-dim">${esc(p.rationale)}</p>
        ${c.canManage ? `<span class="xcp-acts">${h.btn('Ratify', `data-xcp="ratify" data-id="${esc(p.id)}" data-k="${esc(key)}"`, false, 'check')}${h.btn('Reject', `data-xcp="reject" data-id="${esc(p.id)}" data-k="${esc(key)}"`, true, 'x')}</span>` : '<small class="pg-dim">Waiting for a person who administers this scope.</small>'}</li>`).join('')}</ul>` : '';
    return `<section class="pg-sec" data-sec="corpus">${head(acts)}${tenets}${proposals}${doctrine}${agg}</section>`;
  }

  function tenetDetail(tid, h, back) {
    if (!UUID.test(tid)) return h.box('x', 'Not found', 'This tenet does not exist, or you cannot see it.', '', 'sm');
    const e = view(`tenet:${tid}`, () => P.api('GET', `/api/corpus/tenets/${tid}/verdicts`));
    if (e.status === 'loading') return h.box('refresh', 'Loading', '', '', 'sm');
    if (e.status !== 'ready') return back + h.box('x', 'Not found', 'This tenet does not exist, or you cannot see it.', '', 'sm');
    const t = e.d.tenet;
    const rows = e.d.verdicts.map((v) => h.tr('', [badge(v.state), `<small>${esc(v.observed ?? '—')}</small>`, `<small class="pg-dim">${esc(when(v.at))}</small>`, `<small class="pg-dim" title="${esc(v.hash)}">signed ${esc(v.kid)}</small>`]));
    return `${back}<section class="pg-sec" data-sec="tenet"><div class="pg-sec-h"><h3>${esc(t.key)}</h3></div>
      <p>${esc(t.claim)}</p>
      ${t.assay ? `<p class="pg-dim">Disproved by <code>${esc(t.assay.run)}</code> unless it returns <code>${esc(t.expect)}</code>${t.cadence ? `, every ${esc(t.cadence)}` : ''}.</p>` : '<p class="pg-dim">Doctrine: it binds every narrower scope and has no assay.</p>'}
      ${rows.length ? h.table(['Verdict', 'Observed', 'When', 'Signature'], rows) : h.box('clock', 'Never assayed', 'A verdict is recorded by an admitted assay run and signed by the platform.', '', 'sm')}</section>`;
  }

  const tenetFields = (v = {}) => [
    { id: 'key', label: 'Key', required: true, value: v.key || '', max: 200, hint: 'Stable id, e.g. engine#builds' },
    { id: 'kind', label: 'Kind', type: 'select', value: v.kind || 'tenet', options: [['tenet', 'Tenet — a claim with an assay'], ['doctrine', 'Doctrine — a rule that binds narrower scopes']] },
    { id: 'claim', label: 'Claim', type: 'textarea', rows: 3, required: true, value: v.claim || '', max: 4000 },
    { id: 'run', label: 'Assay (the procedure that would disprove it)', value: v.run || '', max: 2000, hint: 'e.g. node assays/builds.mjs — not needed for doctrine' },
    { id: 'expect', label: 'Expected result', value: v.expect || '0', max: 1000 },
    { id: 'cadence', label: 'Re-assay every', value: v.cadence || '24h', max: 6 },
  ];
  const tenetOf = (v) => ({ key: v.key, kind: v.kind, claim: v.claim, cadence: v.kind === 'doctrine' ? undefined : (v.cadence || undefined),
    ...(v.kind === 'doctrine' ? {} : { assay: { kind: 'shell', run: v.run }, expect: v.expect }) });

  async function newTenet(kind, id) {
    const v = await D().form({ title: 'New tenet', sub: 'A claim bound to the procedure that would disprove it.', submit: 'Add tenet', fields: tenetFields() });
    if (!v) return;
    const r = await P.api('POST', `/api/corpus/${kind}/${id}/tenets`, tenetOf(v));
    if (!r.ok) return toast(`Not added: ${why(r, 'try again')}`);
    toast('Tenet added'); drop(`corpus:${kind}:${id}`); paint();
  }
  async function propose(kind, id) {
    const v = await D().form({ title: 'Propose a tenet', sub: 'A person who administers this scope reads it and ratifies or rejects it.', submit: 'Propose',
      fields: [...tenetFields(), { id: 'rationale', label: 'Why', type: 'textarea', rows: 2, required: true, max: 4000 }] });
    if (!v) return;
    const r = await P.api('POST', `/api/corpus/${kind}/${id}/proposals`, { action: 'add', tenet: tenetOf(v), rationale: v.rationale });
    if (!r.ok) return toast(`Not proposed: ${why(r, 'try again')}`);
    toast('Proposed — waiting for a person to ratify'); drop(`corpus:${kind}:${id}`); paint();
  }
  async function decide(pid, decision, key) {
    if (decision === 'reject' && !(await D().confirm({ title: 'Reject this proposal?', body: 'It stays on record as rejected.', action: 'Reject', danger: true }))) return;
    const r = await P.api('POST', `/api/corpus/proposals/${pid}/decision`, { decision });
    if (!r.ok) return toast(`Not recorded: ${why(r, 'try again')}`);
    toast(decision === 'ratify' ? 'Ratified — the tenet is in the corpus' : 'Rejected'); C.delete(key); paint();
  }

  // the Corpus tab on a project
  function projectTab(tab, sub, rec, h) {
    if (tab !== 'Corpus') return null;
    const id = String(sub || '');
    if (id) return tenetDetail(id, h, `<a class="pg-link" data-xcp="open-project" data-to="${esc(rec.name)}/Corpus">← All tenets</a>`);
    return section('project', rec.id, h, { projectName: rec.name, title: 'Tenets' });
  }
  // a division's tenet: /workspace/divisions/<division id>/corpus/<tenet id> (platform-divisions.js routes it here)
  function divisionTenet(divisionId, tid) {
    const h = window.XENO_PAGES.h;
    return h.page(h.head({ title: 'Tenet', sub: 'Division corpus' }) + tenetDetail(tid, h, `<a class="pg-link" data-pg-ws="Divisions/${esc(divisionId)}">← Division</a>`));
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xcp]'); if (!b || !b.closest('#main') || b.closest('.xd')) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.xcp;
    if (a === 'open-project') return X().go('global', { global: 'projects', item: b.dataset.to });
    if (a === 'retry') { C.delete(b.dataset.k); return paint(); }
    if (a === 'new-tenet') return newTenet(b.dataset.kind, b.dataset.id);
    if (a === 'propose') return propose(b.dataset.kind, b.dataset.id);
    if (a === 'ratify') return decide(b.dataset.id, 'ratify', b.dataset.k);
    if (a === 'reject') return decide(b.dataset.id, 'reject', b.dataset.k);
  }, true);
  if (!document.getElementById('xcp-css')) {
    const s = document.createElement('style'); s.id = 'xcp-css';
    s.textContent = '.xcp-list{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}.xcp-list li{padding:8px 10px;border-radius:8px;background:var(--panel)}.xcp-list p{margin:4px 0 0}.xcp-acts{display:flex;gap:6px;margin-top:6px}.xcp-st{font-weight:600}.xcp-st--lapsed,.xcp-st--error{text-decoration:underline}.xcp-st--none{opacity:.6}';
    document.head.appendChild(s);
  }
  if (window.XENO_PROJECT_TABS && !window.XENO_PROJECT_TABS.includes('Corpus')) {
    const at = window.XENO_PROJECT_TABS.indexOf('Activity');
    window.XENO_PROJECT_TABS.splice(at < 0 ? window.XENO_PROJECT_TABS.length : at, 0, 'Corpus');
  }
  window.XENO_CORPUS = { served: true, tabs: ['Corpus'], section, projectTab, divisionTenet, reload: () => { C.clear(); paint(); } };
})();
