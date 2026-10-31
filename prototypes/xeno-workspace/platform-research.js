/* platform-research.js — XENO Research in the workspace (services/xenoResearch.js, /api/research).
 *
 *   Research mode home   /workspace/research                                     recent notebooks, runs needing you, claims not holding
 *   Notebooks (project)  /workspace/projects/<pid>/notebooks                      the project's notebooks
 *   a notebook           /workspace/projects/<pid>/notebooks/<nb_…>              cells and outputs; Lock · Run · Verify
 *   a run                /workspace/projects/<pid>/runs/<rr_…>                   per-cell status, verdict, signature, export
 *   Claims (project)     /workspace/projects/<pid>/claims                         held / lapsed / unobserved
 *   a claim              /workspace/projects/<pid>/claims/<tenet id>              its signed verdicts; Re-check
 *
 * Ids only: an rr_ run id is told apart from a workforce run (a UUID) by its prefix, so the Runs tab keeps both.
 * Every run happens in XENO Box; a refused run shows the refusal and its reason. Served from disk (no platform),
 * nothing here renders: there is no sample research.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_RESEARCH = { served: false, page: () => '', homeWork: () => '' }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, NB = /^nb_[0-9a-f]{32}$/, RUN = /^rr_[0-9a-f]{32}$/;
  const toast = (m) => X()?.toast?.(m);
  // the mode home and the Research product page are the shell's own views, which only a full render redraws
  const paint = () => { try { const v = X()?.S?.view; if (v === 'mode' || v === 'product') return X()?.render?.(); if (window.XENO_PAGES?.repaint && document.querySelector('#main .mview')) window.XENO_PAGES.repaint(); else X()?.render?.(); } catch {} };
  const when = (iso) => { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return ''; } };
  const why = (r, d) => (r && r.d && (r.d.error || r.d.code)) || d;

  // ── one cache per address; a page with a run in flight re-reads itself until the run settles
  const C = new Map();
  function view(key, loader) {
    const c = C.get(key); if (c) return c;
    const e = { status: 'loading', d: null }; C.set(key, e);
    loader().then((r) => { e.status = r.ok ? 'ready' : r.status === 404 ? 'missing' : 'error'; e.d = r.d; paint(); }, () => { e.status = 'error'; paint(); });
    return e;
  }
  const drop = (...prefixes) => { for (const k of [...C.keys()]) if (prefixes.some((p) => k.startsWith(p))) C.delete(k); };
  let refresh = null;
  const live = (runs) => {   // while something is queued or running, re-read in a few seconds (one timer, never stacked)
    if (!runs.some((r) => r.status === 'queued' || r.status === 'running') || refresh) return;
    refresh = setTimeout(() => { refresh = null; drop('nb:', 'run:', 'home', 'runs:', 'claims:'); paint(); }, 4000);
  };

  // ── badges: squares with a small radius, no dots, no motion
  const VERDICT = { reproduced: 'Reproduced', changed: 'Changed', 'not-reproduced': 'Not reproduced' };
  const STATUS = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', refused: 'Refused' };
  const CLAIM = { held: 'Held', lapsed: 'Lapsed', unobserved: 'Unobserved' };
  const badge = (tone, label) => `<span class="xrs-b xrs-b--${esc(tone)}">${esc(label)}</span>`;
  const runBadge = (r) => r.verdict ? badge(r.verdict, VERDICT[r.verdict]) : badge(r.status, STATUS[r.status] || r.status);
  const claimBadge = (s) => badge(s, CLAIM[s] || s);
  const KIND = { lock: 'Lock', run: 'Run', verify: 'Verify' };

  // ── addresses: a project's listing key (its name) inside the router; the id form is made at the address
  const projects = () => ((window.XENO_PG_PROJECTS || {}).items || []);
  const projKey = (pid) => (projects().find((p) => String(p.id) === String(pid)) || {}).name || String(pid);
  const to = (pid, path) => `data-xrs="go" data-to="${esc(projKey(pid))}/${esc(path)}"`;

  // ── the mode home's work section, and the Research product page
  function homeWork() {
    const h = H(), e = view('home', () => P.api('GET', '/api/research/home'));
    if (e.status === 'loading') return h.box('refresh', 'Loading your research', '', '', 'sm');
    if (e.status !== 'ready') return h.box('x', 'Research could not be read', 'Try again in a moment.', h.btn('Retry', 'data-xrs="retry" data-k="home"', true), 'sm');
    const d = e.d; live(d.attention);
    const nbs = d.notebooks.length ? h.table(['Notebook', 'Project', 'Environment', 'Updated'], d.notebooks.map((n) => h.tr(to(n.projectId, `Notebooks/${n.id}`), [
      `<b class="pg-name">${esc(n.title)}</b>`, `<small>${esc(n.projectName || '')}</small>`, n.locked ? `<small>Locked · ${esc(n.image || '')}</small>` : '<small class="pg-dim">Not locked</small>', `<small class="pg-dim">${esc(when(n.updatedAt))}</small>`])))
      : h.box('doc', 'No notebooks yet', 'Add a Jupyter notebook to a project. It runs in XENO Box with no network, and every run is signed.', h.btn('New notebook', 'data-xrs="new-notebook"', false, 'plus'), 'sm');
    const att = d.attention.length ? h.table(['Run', 'Notebook', 'State', 'Why'], d.attention.map((r) => h.tr(to(r.projectId, `Runs/${r.id}`), [
      `<b class="pg-name">${esc(KIND[r.kind])}</b> <small class="pg-dim">${esc(when(r.createdAt))}</small>`, `<small>${esc(r.notebookTitle)}</small>`, runBadge(r), `<small class="pg-dim">${esc(r.reason || '')}</small>`]))) : '';
    const claims = d.claims.length ? h.table(['Claim', 'Cell', 'State'], d.claims.map((c) => h.tr(to(c.projectId, `Claims/${c.id}`), [`<small>${esc(c.claim)}</small>`, `<small>${esc(c.cell)}</small>`, claimBadge(c.state)]))) : '';
    return `<section class="pg-sec" data-sec="research-notebooks"><div class="pg-sec-h"><h3>Recent notebooks</h3></div>${nbs}</section>
      ${att ? `<section class="pg-sec" data-sec="research-attention"><div class="pg-sec-h"><h3>Runs that need you</h3></div>${att}</section>` : ''}
      ${claims ? `<section class="pg-sec" data-sec="research-claims"><div class="pg-sec-h"><h3>Claims not holding</h3></div>${claims}</section>` : ''}
      ${d.box.configured ? '' : `<p class="pg-dim xrs-note">XENO Box is not configured on this platform yet, so runs are refused until it is.</p>`}`;
  }
  function page() {
    const h = H();
    return h.page(h.head({ eyebrow: 'Research', title: 'Research', sub: 'Notebooks whose results reproduce — run in XENO Box, signed, and re-checked.', acts: h.btn('New notebook', 'data-xrs="new-notebook"', false, 'plus') })
      + `<div class="pg-body">${homeWork()}</div>`);
  }

  // ── a project's tabs: Notebooks, Claims, and research runs inside Runs
  function projectTab(tab, sub, rec, h) {
    const id = String(sub || '');
    if (tab === 'Notebooks') return id ? notebookPage(id, rec, h) : notebookList(rec, h);
    if (tab === 'Claims') return id ? claimPage(id, rec, h) : claimList(rec, h);
    if (tab === 'Runs' && RUN.test(id)) return runPage(id, rec, h);
    return null;
  }
  const bar = (left, right = '') => `<div class="xrs-bar">${left}<span class="xrs-sp"></span>${right}</div>`;
  const back = (rec, path, label) => `<a class="pg-link" data-xrs="go" data-to="${esc(rec.name)}/${esc(path)}">← ${esc(label)}</a>`;

  function notebookList(rec, h) {
    const key = `nbs:${rec.id}`, e = view(key, () => P.api('GET', `/api/research/projects/${rec.id}/notebooks`));
    const head = bar('<h3 class="xrs-h">Notebooks</h3>', h.btn('New notebook', `data-xrs="new-notebook" data-project="${esc(rec.id)}"`, false, 'plus'));
    if (e.status === 'loading') return head + h.box('refresh', 'Loading notebooks', '', '', 'sm');
    if (e.status !== 'ready') return head + h.box('x', 'The notebooks could not be read', 'Try again in a moment.', h.btn('Retry', `data-xrs="retry" data-k="${esc(key)}"`, true), 'sm');
    const rows = e.d.notebooks;
    return head + (rows.length ? h.table(['Notebook', 'Environment', 'Last run', 'Updated'], rows.map((n) => h.tr(to(rec.id, `Notebooks/${n.id}`), [
      `<b class="pg-name">${esc(n.title)}</b>`, n.locked ? `<small>Locked · ${esc(n.image || '')}</small>` : '<small class="pg-dim">Not locked</small>',
      n.lastRun ? runBadge(n.lastRun) : '<small class="pg-dim">Never run</small>', `<small class="pg-dim">${esc(when(n.updatedAt))}</small>`])))
      : h.box('doc', 'No notebooks in this project', 'Add a Jupyter notebook (.ipynb). Lock its environment, run it in XENO Box, and claim the results you publish.', '', 'sm'));
  }

  const outputHtml = (o) => {
    if (o.output_type === 'stream') return `<pre class="xrs-out">${esc(Array.isArray(o.text) ? o.text.join('') : o.text)}</pre>`;
    if (o.output_type === 'error') return `<pre class="xrs-out xrs-out--err">${esc(`${o.ename}: ${o.evalue}`)}</pre>`;
    const d = o.data || {}, txt = (v) => (Array.isArray(v) ? v.join('') : String(v ?? ''));
    if (d['image/png'] && /^[A-Za-z0-9+/=\s]+$/.test(txt(d['image/png']))) return `<img class="xrs-img" alt="Cell output" src="data:image/png;base64,${txt(d['image/png']).replace(/\s/g, '')}">`;
    return d['text/plain'] ? `<pre class="xrs-out">${esc(txt(d['text/plain']))}</pre>` : '';
  };
  function notebookPage(id, rec, h) {
    const backLink = back(rec, 'Notebooks', 'All notebooks');
    if (!NB.test(id)) return backLink + h.box('x', 'Not found', 'This notebook does not exist, or you cannot see it.', '', 'sm');
    const key = `nb:${id}`, e = view(key, () => P.api('GET', `/api/research/notebooks/${id}`));
    if (e.status === 'loading') return backLink + h.box('refresh', 'Loading the notebook', '', '', 'sm');
    if (e.status !== 'ready') return backLink + h.box('x', 'Not found', 'This notebook does not exist, or you cannot see it.', '', 'sm');
    const nb = e.d.notebook, runs = e.d.runs; live(runs);
    const lastDone = runs.find((r) => r.status === 'done' && r.kind !== 'lock');
    const acts = nb.canEdit ? h.btn('Lock', `data-xrs="lock" data-id="${esc(id)}"`, true, 'lock') + (lastDone ? h.btn('Verify', `data-xrs="verify" data-id="${esc(lastDone.id)}" data-nb="${esc(id)}"`, true, 'check') : '') + h.btn('Run', `data-xrs="run" data-id="${esc(id)}"`, false, 'play') : '';
    const env = nb.locked ? `Locked${nb.lockStale ? ' — requirements changed since, lock again' : ''} · ${esc(nb.image || '')} · ${esc(when(nb.lockedAt))}` : 'Not locked — Lock resolves every package to one version and hash, inside Box.';
    const cells = nb.cells.map((c) => c.type === 'code'
      ? `<div class="xrs-cell"><span class="xrs-ix">[${c.index}]</span><div class="xrs-cbody"><pre class="xrs-src">${esc(c.source)}</pre>${(c.outputs || []).map(outputHtml).join('')}</div></div>`
      : `<div class="xrs-cell xrs-cell--md"><span class="xrs-ix"></span><div class="xrs-cbody"><p>${esc(c.source)}</p></div></div>`).join('');
    const runRows = runs.length ? h.table(['Run', 'State', 'When', 'Why'], runs.map((r) => h.tr(to(rec.id, `Runs/${r.id}`), [`<b class="pg-name">${esc(KIND[r.kind])}</b>`, runBadge(r), `<small class="pg-dim">${esc(when(r.createdAt))}</small>`, `<small class="pg-dim">${esc(r.reason || '')}</small>`]))) : '';
    return backLink + bar(`<h3 class="xrs-h">${esc(nb.title)}</h3><small class="pg-dim">${env}</small>`, acts)
      + `<section class="pg-sec xrs-nb" data-sec="cells">${cells}${lastDone ? `<p class="pg-dim">Outputs from the run of ${esc(when(lastDone.finishedAt))}.</p>` : ''}</section>`
      + (runRows ? `<section class="pg-sec" data-sec="runs"><div class="pg-sec-h"><h3>Runs</h3></div>${runRows}</section>` : '');
  }

  function runPage(id, rec, h) {
    const key = `run:${id}`, e = view(key, () => P.api('GET', `/api/research/runs/${id}`));
    const backLink = (nbId) => back(rec, nbId ? `Notebooks/${nbId}` : 'Runs', nbId ? 'Notebook' : 'All runs');
    if (e.status === 'loading') return backLink() + h.box('refresh', 'Loading the run', '', '', 'sm');
    if (e.status !== 'ready') return backLink() + h.box('x', 'Not found', 'This run does not exist, or you cannot see it.', '', 'sm');
    const r = e.d.run, sig = e.d.signature; live([r]);
    const acts = r.status === 'done' && r.kind !== 'lock' ? h.btn('Export', `data-xrs="export" data-id="${esc(id)}"`, true, 'download') + h.btn('Verify', `data-xrs="verify" data-id="${esc(id)}" data-nb="${esc(r.notebookId)}"`, false, 'check') : '';
    const SIG = { valid: 'Signature valid', invalid: 'Signature invalid', unsigned: 'Unsigned', none: 'No record yet' };
    const facts = `<div class="xrs-facts">${runBadge(r)}${badge(sig.state === 'valid' ? 'held' : sig.state === 'none' ? 'queued' : 'lapsed', SIG[sig.state] || sig.state)}${sig.keyId ? `<small class="pg-dim">key ${esc(sig.keyId)}</small>` : ''}${r.executor ? `<small class="pg-dim">XENO Box · ${esc(r.executor.image || '')} · isolation ${esc(r.executor.isolation || 'unknown')}</small>` : ''}</div>`;
    const reason = r.reason ? `<p class="xrs-reason"><b>${esc(r.status === 'refused' ? 'Refused' : 'Failed')}:</b> ${esc(r.reason)}</p>` : '';
    const findings = r.comparison ? `<p class="pg-dim">${r.verdict === 'reproduced' ? 'Every cell produced the recorded output.' : r.verdict === 'changed' ? `Something it depends on moved: ${esc(r.comparison.findings.map((f) => f.kind.replace(/-/g, ' ') + (f.path ? ` (${f.path})` : '')).join(', '))}.` : 'Same code, data and environment — a different answer.'}</p>` : '';
    const cmp = new Map((r.comparison?.cells || []).map((c) => [c.index, c.reproduced]));
    const cells = r.cells ? h.table(['Cell', 'Status', 'Output hash', r.comparison ? 'Reproduced' : ''], r.cells.map((c) => h.tr('', [`<b class="pg-name">[${c.index}]</b>`, badge(c.status === 'ok' ? 'done' : 'failed', c.status), `<code class="xrs-hash">${esc((c.output_sha256 || '').slice(0, 16))}</code>`,
      r.comparison ? (cmp.get(c.index) ? badge('reproduced', 'Yes') : badge('not-reproduced', 'No')) : (r.status === 'done' && c.status === 'ok' && r.kind !== 'lock' ? h.btn('Claim', `data-xrs="claim" data-id="${esc(id)}" data-cell="${c.index}"`, true) : '')]))) : '';
    return backLink(r.notebookId) + bar(`<h3 class="xrs-h">${esc(KIND[r.kind])} of ${esc(e.d.notebook.title)}</h3><small class="pg-dim">${esc(when(r.createdAt))}</small>`, acts)
      + `<section class="pg-sec" data-sec="run">${facts}${reason}${findings}${cells}</section>`;
  }

  function claimList(rec, h) {
    const key = `claims:${rec.id}`, e = view(key, () => P.api('GET', `/api/research/projects/${rec.id}/claims`));
    const head = bar('<h3 class="xrs-h">Claims</h3>');
    if (e.status === 'loading') return head + h.box('refresh', 'Loading claims', '', '', 'sm');
    if (e.status !== 'ready') return head + h.box('x', 'The claims could not be read', 'Try again in a moment.', h.btn('Retry', `data-xrs="retry" data-k="${esc(key)}"`, true), 'sm');
    const rows = e.d.claims;
    return head + (rows.length ? h.table(['Claim', 'Cell', 'State', 'Last checked'], rows.map((c) => h.tr(to(rec.id, `Claims/${c.id}`), [`<small>${esc(c.claim)}</small>`, `<small>[${esc(c.cell)}]</small>`, claimBadge(c.state), `<small class="pg-dim">${esc(when(c.latest?.at))}</small>`])))
      : h.box('check', 'No claims yet', 'Open a finished run and claim a cell: the result becomes a tenet in this project’s Corpus, re-checked in XENO Box.', '', 'sm'));
  }
  function claimPage(id, rec, h) {
    const backLink = back(rec, 'Claims', 'All claims');
    if (!UUID.test(id)) return backLink + h.box('x', 'Not found', 'This claim does not exist, or you cannot see it.', '', 'sm');
    const key = `claim:${id}`, e = view(key, () => P.api('GET', `/api/research/claims/${id}`));
    if (e.status === 'loading') return backLink + h.box('refresh', 'Loading the claim', '', '', 'sm');
    if (e.status !== 'ready') return backLink + h.box('x', 'Not found', 'This claim does not exist, or you cannot see it.', '', 'sm');
    const c = e.d.claim;
    const rows = e.d.verdicts.map((v) => h.tr('', [claimBadge(v.state === 'held' ? 'held' : v.state === 'lapsed' ? 'lapsed' : 'unobserved'), `<code class="xrs-hash">${esc(String(v.observed || '').slice(0, 24))}</code>`, `<small class="pg-dim">${esc(when(v.at))}</small>`, `<small class="pg-dim">signed ${esc(v.kid)}</small>`]));
    return backLink + bar(`<h3 class="xrs-h">Claim</h3>${claimBadge(c.state)}`, h.btn('Re-check', `data-xrs="recheck" data-id="${esc(id)}"`, false, 'refresh'))
      + `<section class="pg-sec" data-sec="claim"><p>${esc(c.claim)}</p><p class="pg-dim">Cell [${esc(c.cell)}] must produce <code class="xrs-hash">${esc(String(c.expect).slice(0, 16))}</code>. <a class="pg-link" ${to(rec.id, `Runs/${c.runId}`)}>The recorded run</a></p>
      ${rows.length ? h.table(['Verdict', 'Observed', 'When', 'Signature'], rows) : h.box('clock', 'Never checked', 'Re-check runs the notebook again in XENO Box and records the verdict in Corpus.', '', 'sm')}</section>`;
  }

  // ── actions
  async function request(method, url, body, done) {
    const r = await P.api(method, url, body);
    if (!r.ok) return toast(`Not started: ${why(r, 'try again')}`), null;
    const run = r.d.run;
    toast(run?.status === 'refused' ? `Refused: ${run.reason}` : done);
    drop('nb:', 'nbs:', 'run:', 'home', 'claims:', 'claim:'); paint();
    return run;
  }
  function pickFile() {
    return new Promise((resolve) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.ipynb,application/x-ipynb+json,application/json';
      i.addEventListener('change', () => { const f = i.files?.[0]; if (!f) return resolve(null); f.text().then((text) => resolve({ name: f.name, text }), () => resolve(null)); });
      i.click();
    });
  }
  async function newNotebook(projectId) {
    const file = await pickFile(); if (!file) return;
    let notebook; try { notebook = JSON.parse(file.text); } catch { return toast('That file is not a Jupyter notebook (.ipynb)'); }
    const list = projects().filter((p) => UUID.test(String(p.id)));
    const fields = [{ id: 'title', label: 'Title', required: true, max: 200, value: file.name.replace(/\.ipynb$/i, '') }];
    if (!projectId) fields.push({ id: 'project', label: 'Project', type: 'select', value: list[0]?.id || '', options: list.map((p) => [String(p.id), p.name]) });
    if (!projectId && !list.length) return toast('Create a project first: a notebook belongs to a project');
    const v = await D().form({ title: 'New notebook', sub: `${file.name} · it runs in XENO Box with no network, and every run is signed.`, submit: 'Add notebook', fields });
    if (!v) return;
    const pid = projectId || v.project;
    const r = await P.api('POST', `/api/research/projects/${pid}/notebooks`, { title: v.title, notebook });
    if (!r.ok) return toast(`Not added: ${why(r, 'try again')}`);
    toast('Notebook added'); drop('nbs:', 'home');
    X().go('global', { global: 'projects', item: `${projKey(pid)}/Notebooks/${r.d.notebook.id}`, zoneOf: 'overview' });
  }
  async function claim(runId, cell) {
    const v = await D().form({ title: `Claim cell [${cell}]`, sub: 'The result becomes a tenet in this project’s Corpus: re-checked in XENO Box, held or lapsed.', submit: 'Claim',
      fields: [{ id: 'claim', label: 'Claim', type: 'textarea', rows: 3, required: true, max: 4000, value: `Cell ${cell} reproduces its recorded output in XENO Box` }] });
    if (!v) return;
    const r = await P.api('POST', `/api/research/runs/${runId}/claims`, { cell: Number(cell), claim: v.claim });
    if (!r.ok) return toast(`Not claimed: ${why(r, 'try again')}`);
    toast('Claimed — unobserved until it is re-checked'); drop('claims:', 'home'); paint();
  }
  async function recheck(tid) {
    const v = await D().form({ title: 'Re-check this claim', sub: 'A re-check is an admitted run: name the run admission it runs under. The verdict is signed and kept in Corpus.', submit: 'Re-check',
      fields: [{ id: 'admission', label: 'Run admission', required: true, max: 36, placeholder: '00000000-0000-0000-0000-000000000000' }] });
    if (!v) return;
    await request('POST', `/api/research/claims/${tid}/recheck`, { admissionId: v.admission }, 'Re-check queued in XENO Box');
  }
  async function exportRun(id) {
    const r = await P.api('GET', `/api/research/runs/${id}/export`);
    if (!r.ok) return toast(`Not exported: ${why(r, 'try again')}`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.d, null, 1)], { type: 'application/json' })); a.download = r.d.name || `${id}.research.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('Exported — the notebook, its lock, its signed provenance and SHA256SUMS');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xrs]'); if (!b || !b.closest('#main') || b.closest('.xd')) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.xrs;
    if (a === 'go') return X().go('global', { global: 'projects', item: b.dataset.to, zoneOf: 'overview' });   // a project's records live at /workspace/projects/<pid>/…
    if (a === 'retry') { C.delete(b.dataset.k); return paint(); }
    if (a === 'new-notebook') return newNotebook(b.dataset.project || null);
    if (a === 'lock') return request('POST', `/api/research/notebooks/${b.dataset.id}/lock`, undefined, 'Lock queued in XENO Box');
    if (a === 'run') return request('POST', `/api/research/notebooks/${b.dataset.id}/runs`, undefined, 'Run queued in XENO Box');
    if (a === 'verify') return request('POST', `/api/research/runs/${b.dataset.id}/verify`, undefined, 'Verify queued in XENO Box');
    if (a === 'export') return exportRun(b.dataset.id);
    if (a === 'claim') return claim(b.dataset.id, b.dataset.cell);
    if (a === 'recheck') return recheck(b.dataset.id);
  }, true);
  if (!document.getElementById('xrs-css')) {
    const s = document.createElement('style'); s.id = 'xrs-css';
    s.textContent = '.xrs-bar{display:flex;align-items:center;gap:8px;margin:0 0 10px}.xrs-sp{flex:1}.xrs-h{margin:0;font-size:15px}'
      + '.xrs-b{display:inline-block;padding:1px 7px;border-radius:3px;font-size:12px;font-weight:600;border:1px solid var(--line,rgba(255,255,255,.14));background:var(--panel)}'
      + '.xrs-b--reproduced,.xrs-b--held,.xrs-b--done{color:var(--text)}.xrs-b--not-reproduced,.xrs-b--lapsed,.xrs-b--failed,.xrs-b--refused{text-decoration:underline;color:var(--text)}.xrs-b--changed,.xrs-b--unobserved,.xrs-b--queued,.xrs-b--running{opacity:.75}'
      + '.xrs-cell{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;padding:6px 0;border-top:1px solid var(--line,rgba(255,255,255,.08))}.xrs-ix{font:12px ui-monospace,monospace;opacity:.6;padding-top:8px}'
      + '.xrs-src,.xrs-out{margin:0;padding:8px 10px;border-radius:4px;background:var(--panel);font:12.5px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;max-height:420px}.xrs-out{background:transparent;padding:6px 10px}.xrs-out--err{text-decoration:underline}'
      + '.xrs-img{max-width:100%;border-radius:4px;margin:6px 0}.xrs-facts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}.xrs-hash{font:12px ui-monospace,monospace}.xrs-reason{margin:0 0 10px}.xrs-note{margin-top:8px}';
    document.head.appendChild(s);
  }
  // the project tabs research adds, beside the Corpus its claims live in
  if (window.XENO_PROJECT_TABS) for (const t of ['Notebooks', 'Claims']) if (!window.XENO_PROJECT_TABS.includes(t)) {
    const at = window.XENO_PROJECT_TABS.indexOf('Activity');
    window.XENO_PROJECT_TABS.splice(at < 0 ? window.XENO_PROJECT_TABS.length : at, 0, t);
  }
  window.XENO_RESEARCH = { served: true, tabs: ['Notebooks', 'Claims'], page, homeWork, projectTab, isRun: (id) => RUN.test(String(id || '')), reload: () => { C.clear(); paint(); } };
})();
