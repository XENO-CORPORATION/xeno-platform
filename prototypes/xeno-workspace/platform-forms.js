/* platform-forms.js — on the platform, Corpo › Forms is the workspace's own forms.
 *
 * Reads and writes /api/forms (routes/formsRoutes.js → services/forms.js) for the workspace you are in.
 * Addresses (ids, the form as the parent of its views):
 *
 *   /workspace/corpo/spaces/forms                          the forms
 *   /workspace/corpo/spaces/forms/<form id>                its questions and settings, saved as you type
 *   /workspace/corpo/spaces/forms/<form id>/share          its links
 *   /workspace/corpo/spaces/forms/<form id>/responses      a summary, each response (Contact / Task / Ticket), CSV
 *   /workspace/corpo/spaces/forms/fill/<token>             answer a form shared by a SIGN-IN link
 *
 * A public link opens /api/forms/public/<token>, a server-rendered page that needs no account and no JavaScript.
 * Making a public link and deleting are a person's acts; agents use the same service through formsMcp.js.
 *
 * It registers XENO_ZONE_LIVE['corpo.forms'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const TYPES = [['text', 'Short text'], ['textarea', 'Long text'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'Web address'], ['number', 'Number'], ['date', 'Date'], ['select', 'One choice'], ['multiselect', 'Several choices'], ['checkbox', 'Checkbox']];
  const ACTIONS = [['contact', 'Add to Customers'], ['task', 'Make a task'], ['ticket', 'Ask XENO support']];
  const STATUS = { draft: 'Draft', open: 'Open', closed: 'Closed' };
  const LINE = { draft: 'A draft. Nobody can answer it yet.', open: 'Open. It’s taking responses.', closed: 'Closed. It takes no new responses.' };
  const choices = (t) => t === 'select' || t === 'multiselect';
  const S = { status: 'idle', ws: undefined, forms: [], form: null, responses: null, respError: null, fill: null, error: null, shown: null, undo: null, loadedFor: null, save: '' };
  let timer = null;
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const item = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'forms' ? (s.item || '') : ''; };
  const route = () => { const it = item(); let m;
    if ((m = it.match(/^fill\/([A-Za-z0-9_-]{40,64})$/))) return { view: 'fill', token: m[1] };
    if ((m = it.match(/^([0-9a-f-]{36})\/(responses|share)$/i))) return { view: m[2], id: m[1] };
    if ((m = it.match(/^([0-9a-f-]{36})$/i))) return { view: 'form', id: m[1] };
    return { view: 'list' }; };
  const goto = (it) => X()?.go?.('zone', { zone: 'forms', item: it || null });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'forms') X().render(); } catch {} };
  const fieldId = () => { const a = new Uint8Array(5); crypto.getRandomValues(a); return 'f_' + [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const localValue = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

  async function load() {
    const r0 = route(), key = JSON.stringify([wsId(), r0]);
    S.ws = wsId(); S.status = 'loading'; S.error = null; S.loadedFor = key;
    if (r0.view === 'fill') {
      const r = await api('GET', `/api/forms/public/${encodeURIComponent(r0.token)}/form`).catch(() => null);
      S.fill = r && r.ok ? { token: r0.token, form: r.d.form, errors: {}, done: null } : { token: r0.token, error: said(r, 'This form link doesn’t work.') };
      S.status = 'ready'; return paint();
    }
    if (r0.view === 'list') {
      const l = await api('GET', '/api/forms' + q()).catch(() => null);
      if (S.loadedFor !== key) return;
      if (!l || !l.ok) { S.status = 'error'; S.error = said(l, 'Forms couldn’t be reached.'); return paint(); }
      S.forms = l.d.forms || []; S.status = 'ready'; return paint();
    }
    const f = await api('GET', `/api/forms/${r0.id}` + q()).catch(() => null);
    if (S.loadedFor !== key) return;
    if (!f || !f.ok) { S.status = 'error'; S.error = said(f, 'That form couldn’t be opened.'); return paint(); }
    S.form = f.d.form; S.save = ''; S.responses = null; S.respError = null;
    if (r0.view === 'responses') { const r = await api('GET', `/api/forms/${r0.id}/responses` + q()).catch(() => null); if (r && r.ok) S.responses = r.d.responses; else S.respError = said(r, 'Responses couldn’t be read.'); }
    S.status = 'ready'; paint();
  }

  // ─────────────────────────────── saving: as you type, and the line beside the title says how it went
  const saveLine = () => { const n = document.querySelector('#main [data-fm-saved]'); if (n) n.textContent = S.save; };
  const touch = () => { S.save = 'Saving…'; saveLine(); clearTimeout(timer); const id = S.form?.id; timer = setTimeout(() => flush(id), 700); };
  const body = (f) => withWs({ title: f.title, description: f.description, confirmation: f.confirmation, autoActions: f.autoActions, closesAt: f.closesAt || null, maxResponses: f.maxResponses || null,
    fields: f.fields.map((x) => ({ id: x.id, type: x.type, label: x.label, required: !!x.required, ...(x.help ? { help: x.help } : {}), ...(choices(x.type) ? { options: (x.options || []).map((o) => String(o).trim()).filter(Boolean) } : {}) })) });
  async function flush(id = S.form?.id) {
    clearTimeout(timer); timer = null;
    const f = S.form; if (!f || f.id !== id) return true;
    if (!S.save || S.save === 'Saved') return true;
    const r = await api('PATCH', `/api/forms/${id}`, body(f)).catch(() => null);
    if (!r || !r.ok) { S.save = `Not saved: ${said(r, 'XENO didn’t answer.')}`; saveLine(); return false; }
    S.save = 'Saved'; saveLine(); return true;
  }

  // ─────────────────────────────── drawing
  function listView(head) {
    const h = H();
    const undo = S.undo ? `<div class="sc-undo" data-fm-undone>“${esc(S.undo.title)}” was deleted. ${h.btn('Undo', `data-fm-restore="${esc(S.undo.id)}"`, true)}</div>` : '';
    if (!S.forms.length) return head + undo + h.box('doc', 'No forms yet', 'Make one to collect sign-ups, requests or feedback. Responses stay in the workspace and can become customers, tasks or support requests.', h.btn('New form', 'data-fm-new', false, 'plus'));
    return head + undo + h.table(['Form', 'Status', 'Responses', 'Updated'], S.forms.map((f) => h.tr(`data-fm-open="${esc(f.id)}"`, [`<b class="pg-name">${esc(f.title)}</b>`, h.chip(STATUS[f.status] || f.status), String(f.responses ?? 0), `<small>${esc(when(f.updatedAt))}</small>`])));
  }
  const questionCard = (f, i, total) => `<div class="fm-field" data-fm-field="${i}">
    <div class="fm-q-top"><input class="in fm-q-label" data-fm-f="label" value="${esc(f.label)}" placeholder="The question" aria-label="Question ${i + 1}" maxlength="200">
      <select class="in" data-fm-f="type" aria-label="Kind of answer">${TYPES.map(([v, l]) => `<option value="${v}"${f.type === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    ${choices(f.type) ? `<textarea class="in" data-fm-f="options" rows="3" placeholder="One choice on each line" aria-label="Choices">${esc((f.options || []).join('\n'))}</textarea>` : ''}
    <div class="fm-q-foot"><label><input type="checkbox" data-fm-f="required"${f.required ? ' checked' : ''}> Required</label><span class="fm-sp"></span>
      <button class="btn ghost" data-fm-fmove="${i}:-1"${i ? '' : ' disabled'}>Move up</button><button class="btn ghost" data-fm-fmove="${i}:1"${i < total - 1 ? '' : ' disabled'}>Move down</button><button class="btn ghost" data-fm-fdel="${i}">Remove</button></div></div>`;
  function questionsView(f) {
    return `<div class="fm-cols" data-fm-build><div class="fm-main">${f.fields.length ? f.fields.map((x, i) => questionCard(x, i, f.fields.length)).join('') : '<div class="pj-empty">No questions yet. Add the first one below.</div>'}
      <div class="fm-add"><small>Add a question</small><div>${TYPES.map(([k, l]) => `<button class="btn ghost" data-fm-add="${k}">${esc(l)}</button>`).join('')}</div></div></div>
      <aside class="fm-side"><div class="sc-card fm-set"><b>About this form</b>
        <label>Title<input class="in" data-fm-d="title" value="${esc(f.title)}" maxlength="200"></label>
        <label>Description<textarea class="in" data-fm-d="description" rows="3" maxlength="4000">${esc(f.description)}</textarea></label>
        <label>After someone answers<textarea class="in" data-fm-d="confirmation" rows="2" maxlength="1000">${esc(f.confirmation)}</textarea></label>
        <label>Closes on<input class="in" type="datetime-local" data-fm-d="closesAt" value="${esc(localValue(f.closesAt))}"></label>
        <label>Stop after this many responses<input class="in" type="number" min="1" step="1" data-fm-d="maxResponses" value="${esc(f.maxResponses ?? '')}"></label>
        <div class="fm-auto"><small>On every response</small>${ACTIONS.map(([v, l]) => `<label class="fm-line"><input type="checkbox" data-fm-auto="${v}"${f.autoActions.includes(v) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></div></aside></div>`;
  }
  function shareView(f) {
    const h = H();
    const links = (f.links || []).map((l) => `<div class="sc-row" data-fm-linkrow="${esc(l.id)}"><div><b>${l.kind === 'public' ? 'Public link' : 'Sign-in link'}</b><small>${[l.label, l.createdByKind === 'agent' ? 'made by an agent' : '', l.live ? 'works' : l.revokedAt ? 'revoked' : 'expired'].filter(Boolean).map(esc).join(' · ')}</small></div>${l.live ? h.btn('Revoke', `data-fm-revoke="${esc(l.id)}"`, true) : ''}</div>`).join('') || '<div class="pj-empty">No links yet. Nobody can reach this form until you make one.</div>';
    const shown = S.shown ? `<div class="sc-card fm-shown" data-fm-shown><small>Copy this link now. It’s shown once.</small><input class="in" readonly value="${esc(S.shown)}" aria-label="New link"></div>` : '';
    const note = f.status === 'open' ? '' : '<p class="pg-dim">Links only work while the form is open.</p>';
    return `${shown}<div class="sc-actions">${h.btn('New sign-in link', 'data-fm-link="signin"', true)}${h.btn('New public link', 'data-fm-link="public"', true)}</div>${note}${links}
      <p class="pg-dim">A sign-in link opens only for someone signed in to XENO. A public link opens for anyone who has it, with no account.</p>`;
  }
  const answerText = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : v == null ? '' : String(v));
  function summaryOf(f, rows) {
    const cards = f.fields.filter((x) => choices(x.type) || x.type === 'checkbox').map((x) => {
      const opts = x.type === 'checkbox' ? ['Yes'] : x.options || [], n = new Map(opts.map((o) => [o, 0]));
      let seen = 0;
      for (const r of rows) { const a = r.answers[x.id]; if (a == null) continue; seen++; for (const v of Array.isArray(a) ? a : [a === true ? 'Yes' : a]) if (n.has(v)) n.set(v, n.get(v) + 1); }
      return `<div class="sc-card fm-sum" data-fm-sum="${esc(x.id)}"><b>${esc(x.label)}</b>${opts.map((o) => { const c = n.get(o), pct = rows.length ? Math.round((c / rows.length) * 100) : 0; return `<div class="fm-bar"><span>${esc(o)}</span><i><u style="width:${pct}%"></u></i><small>${c}</small></div>`; }).join('')}</div>`;
    });
    return cards.length ? `<div class="fm-sums">${cards.join('')}</div>` : '';
  }
  function responsesView(f) {
    const h = H(), rs = S.responses;
    if (S.respError) return h.box('x', 'Responses couldn’t be loaded', 'Nothing was changed.', h.btn('Try again', 'data-fm-reload', true), 'sm');
    if (!rs || !rs.length) return h.box('doc', 'No responses yet', f.status === 'open' ? 'They show here as people answer.' : 'Open the form and share a link to start collecting answers.');
    return `<div class="sc-actions"><a class="btn ghost" href="/api/forms/${esc(f.id)}/responses.csv${esc(q())}" data-fm-csv>Export CSV</a>${h.btn('Delete all responses', 'data-fm-rdelall', true)}</div>${summaryOf(f, rs)}
      ${rs.map((r) => `<div class="fm-resp" data-fm-resp="${esc(r.id)}"><div class="fm-resp-top"><b>${esc(when(r.createdAt))}</b><span class="fm-sp"></span>${ACTIONS.map(([a, l]) => (r.actions && r.actions[a] ? `<small data-fm-done="${a}">${a === 'contact' ? 'In Customers' : esc(r.actions[a].key || 'Done')}</small>` : `<button class="btn ghost" data-fm-act="${esc(r.id)}:${a}">${esc(l)}</button>`)).join('')}<button class="btn ghost" data-fm-rdel="${esc(r.id)}">Delete</button></div>
        ${(r.fields && r.fields.length ? r.fields : f.fields).filter((x) => r.answers[x.id] != null).map((x) => `<div class="fm-a"><small>${esc(x.label)}</small><span>${esc(answerText(r.answers[x.id]))}</span></div>`).join('')}</div>`).join('')}`;
  }
  function fillView() {
    const F = S.fill, h = H();
    if (F.error) return h.head({ title: 'Form' }) + h.box('x', 'That didn’t open', esc(F.error), '', 'sm');
    if (F.done) return h.head({ title: F.form.title }) + `<div class="pj-empty" data-fm-thanks>${esc(F.done)}</div>`;
    const inp = (f) => { const n = `data-fm-a="${esc(f.id)}"`, e = F.errors[f.id] ? `<div class="fm-err" data-fm-err="${esc(f.id)}">${esc(F.errors[f.id])}</div>` : '';
      const lbl = `<span class="fm-qq">${esc(f.label)}${f.required ? ' *' : ''}${f.help ? ` <small>${esc(f.help)}</small>` : ''}</span>`;
      if (f.type === 'textarea') return `<label>${lbl}<textarea class="in" ${n}></textarea></label>${e}`;
      if (f.type === 'select') return `<label>${lbl}<select class="in" ${n}><option value=""></option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>${e}`;
      if (f.type === 'multiselect') return `${lbl}${f.options.map((o) => `<label class="fm-line"><input type="checkbox" ${n} value="${esc(o)}"> ${esc(o)}</label>`).join('')}${e}`;
      if (f.type === 'checkbox') return `<label class="fm-line"><input type="checkbox" ${n} value="1"> ${esc(f.label)}${f.required ? ' *' : ''}</label>${e}`;
      return `<label>${lbl}<input class="in" type="${{ email: 'email', phone: 'tel', url: 'url', number: 'number', date: 'date' }[f.type] || 'text'}" ${n}></label>${e}`; };
    return h.head({ title: F.form.title, sub: F.form.description }) + `<div class="sc-card fm-fill" data-fm-fill>${F.form.fields.map(inp).join('')}<div>${h.btn('Send', 'data-fm-submit')}</div></div>`;
  }
  function page() {
    const h = H(), r0 = route(), key = JSON.stringify([wsId(), r0]);
    const wrap = (inner) => h.page(`<div class="fm" data-fm-page="${esc(S.status)}" data-fm-view="${esc(r0.view)}">${inner}</div>`);
    const plain = h.head({ title: 'Forms', sub: 'Forms and surveys for your workspace.', acts: r0.view === 'list' ? h.btn('New form', 'data-fm-new', false, 'plus') : '' });
    if (S.status === 'loading' || S.loadedFor !== key) { if (S.status !== 'loading' || S.loadedFor !== key) load(); return wrap(plain + h.box('refresh', 'Loading', '', '', 'sm')); }
    if (S.status === 'error') return wrap(plain + h.box('x', 'That couldn’t be loaded', esc(S.error), h.btn('Try again', 'data-fm-reload', true), 'sm'));
    if (r0.view === 'fill') return wrap(fillView());
    if (r0.view === 'list') return wrap(listView(plain));
    const f = S.form;
    const acts = `<span class="fm-saved" data-fm-saved>${esc(S.save)}</span>` + (f.status === 'open' ? h.btn('Close the form', 'data-fm-status="closed"', true) : h.btn(f.status === 'closed' ? 'Reopen the form' : 'Open the form', 'data-fm-status="open"')) + h.btn('Delete', 'data-fm-delete', true);
    const head = h.head({ title: f.title, acts }) + h.tabs([['form', 'Questions'], ['share', 'Share'], ['responses', `Responses${f.responses ? ' ' + f.responses : ''}`]], r0.view, 'data-fm-tab') + `<p class="pg-dim" data-fm-line>${esc(LINE[f.status])}</p>`;
    return wrap(head + (r0.view === 'share' ? shareView(f) : r0.view === 'responses' ? responsesView(f) : questionsView(f)));
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['corpo.forms'] = {
    served: true,
    items: true,   // it draws its own sub-addresses: a form, its links and responses, the fill view
    label: (it) => { const [id, tab] = String(it).split('/'), name = S.form?.id === id ? S.form.title : 'Form'; return id === 'fill' ? 'Answer' : tab === 'responses' ? `${name} · Responses` : tab === 'share' ? `${name} · Share` : /^[0-9a-f-]{36}$/i.test(id) ? name : it; },
    work: () => (S.status === 'ready' && S.forms.length ? ['Forms', S.forms.slice(0, 6).map((f) => [f.title, `${STATUS[f.status] || f.status} · ${f.responses} response${f.responses === 1 ? '' : 's'}`, null, 'Forms'])] : null),
    badge: () => null,
    page: () => page(),
    state: () => ({ status: S.status, forms: S.forms.length, route: route() }),
    reload: () => load(),
  };

  // ─────────────────────────────── acting
  const newForm = () => D().form({ title: 'New form', sub: 'You change the questions next. Nobody can answer it until you open it and share a link.', submit: 'Create form',
    fields: [{ id: 'title', label: 'Title', required: true, max: 200, placeholder: 'Event sign-up' }],
    onSubmit: async (v) => { const r = await api('POST', '/api/forms', withWs({ title: v.title, fields: [{ id: fieldId(), type: 'text', label: 'Your name', required: true }, { id: fieldId(), type: 'email', label: 'Email', required: true }] })).catch(() => null); if (!r || !r.ok) return said(r, 'That didn’t save.'); S.created = r.d.form.id; return null; },
  }).then((v) => { if (v && S.created) { const id = S.created; S.created = null; toast('Form made. It’s a draft until you open it.'); goto(id); } });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-fm-reload],[data-fm-new],[data-fm-open],[data-fm-tab],[data-fm-restore],[data-fm-status],[data-fm-delete],[data-fm-add],[data-fm-fmove],[data-fm-fdel],[data-fm-link],[data-fm-revoke],[data-fm-act],[data-fm-rdel],[data-fm-rdelall],[data-fm-submit]');
    if (!t || !t.closest('#main')) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset, f = S.form, root = document.querySelector('#main [data-fm-page]');
    if ('fmReload' in d) return load();
    if ('fmNew' in d) return newForm();
    if (d.fmOpen) { S.shown = null; return goto(d.fmOpen); }
    if (d.fmTab) { await flush(); return goto(d.fmTab === 'form' ? f.id : `${f.id}/${d.fmTab}`); }
    if (d.fmRestore) { const r = await api('POST', `/api/forms/${d.fmRestore}/restore`, withWs({})).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be restored.')); S.undo = null; toast('Form restored'); return goto(d.fmRestore); }
    if (d.fmAdd) { f.fields.push({ id: fieldId(), type: d.fmAdd, label: '', required: false, ...(choices(d.fmAdd) ? { options: [] } : {}) }); paint(); document.querySelector(`#main [data-fm-field="${f.fields.length - 1}"] [data-fm-f="label"]`)?.focus(); return; }
    if (d.fmFmove) { const [i, dir] = d.fmFmove.split(':').map(Number), j = i + dir, a = f.fields; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; paint(); return touch(); }
    if (d.fmFdel) { f.fields.splice(Number(d.fmFdel), 1); paint(); return touch(); }
    if (d.fmStatus) {
      if (timer && !await flush()) return toast('Fix what didn’t save first');
      const r = await api('PATCH', `/api/forms/${f.id}`, withWs({ status: d.fmStatus })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That didn’t work.'));
      toast(d.fmStatus === 'open' ? 'The form is open. Share a link so people can reach it.' : 'The form is closed.'); return load();
    }
    if ('fmDelete' in d) {
      if (!await D().confirm({ title: `Delete “${f.title}”?`, body: 'Its links stop working. You can undo this from the list of forms.' })) return;
      const r = await api('DELETE', `/api/forms/${f.id}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted.'));
      S.undo = { id: f.id, title: f.title }; toast('Form deleted'); return goto(null);
    }
    if (d.fmLink) {
      if (d.fmLink === 'public' && !await D().confirm({ title: 'Make a public link?', body: 'Anyone who has it can answer this form, with no account.', action: 'Make public link', danger: false })) return;
      const r = await api('POST', `/api/forms/${f.id}/links`, withWs({ kind: d.fmLink })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'The link couldn’t be made.'));
      S.shown = r.d.url; try { await navigator.clipboard.writeText(r.d.url); toast('Link copied'); } catch { toast('Link made'); } return load();
    }
    if (d.fmRevoke) { const r = await api('POST', `/api/forms/${f.id}/links/${d.fmRevoke}/revoke`, withWs({})).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be revoked.')); toast('Link revoked'); return load(); }
    if (d.fmAct) {
      const [rid, action] = d.fmAct.split(':');
      const r = await api('POST', `/api/forms/${f.id}/responses/${rid}/actions`, withWs({ action })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That didn’t work.'));
      const i = S.responses.findIndex((x) => x.id === rid); if (i >= 0) S.responses[i] = r.d.response;
      toast({ contact: 'Added to Customers', task: 'Task made', ticket: 'Sent to XENO support' }[action]); return paint();
    }
    if (d.fmRdel) {
      if (!await D().confirm({ title: 'Delete this response?', body: 'Its answers are erased for good.' })) return;
      const r = await api('DELETE', `/api/forms/${f.id}/responses/${d.fmRdel}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted.'));
      S.responses = S.responses.filter((x) => x.id !== d.fmRdel); f.responses = Math.max(0, (f.responses || 1) - 1); toast('Response deleted'); return paint();
    }
    if ('fmRdelall' in d) {
      if (!await D().confirm({ title: 'Delete all responses?', body: 'Every answer to this form is erased for good.', typeToConfirm: 'delete' })) return;
      const r = await api('DELETE', `/api/forms/${f.id}/responses` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'They couldn’t be deleted.'));
      S.responses = []; f.responses = 0; toast('Responses deleted'); return paint();
    }
    if ('fmSubmit' in d) {
      const F = S.fill, answers = {};
      for (const fl of F.form.fields) {
        const els = [...root.querySelectorAll(`[data-fm-a="${CSS.escape(fl.id)}"]`)];
        if (fl.type === 'multiselect') answers[fl.id] = els.filter((x) => x.checked).map((x) => x.value);
        else if (fl.type === 'checkbox') answers[fl.id] = !!(els[0] && els[0].checked);
        else answers[fl.id] = els[0] ? els[0].value : '';
      }
      const r = await api('POST', `/api/forms/public/${encodeURIComponent(F.token)}/responses`, { answers }).catch(() => null);
      if (r && r.ok) { F.done = r.d.confirmation; F.errors = {}; return paint(); }
      F.errors = (r && r.d && r.d.errors) || {}; toast(said(r, 'That didn’t send.')); return paint();
    }
  }, true);
  const edit = (e) => {
    const t = e.target, f = S.form; if (!f || !t.closest?.('#main [data-fm-build]')) return;
    if (t.dataset.fmD) { const k = t.dataset.fmD; f[k] = k === 'closesAt' ? (t.value ? new Date(t.value).toISOString() : null) : k === 'maxResponses' ? (t.value ? Number(t.value) : null) : t.value; return touch(); }
    if (t.dataset.fmAuto) { f.autoActions = [...document.querySelectorAll('#main [data-fm-auto]:checked')].map((x) => x.dataset.fmAuto); return touch(); }
    if (!t.dataset.fmF) return;
    const x = f.fields[Number(t.closest('[data-fm-field]').dataset.fmField)], k = t.dataset.fmF;
    if (k === 'required') x.required = t.checked;
    else if (k === 'options') x.options = t.value.split('\n');
    else if (k === 'type') { x.type = t.value; if (choices(x.type)) x.options = x.options || []; else delete x.options; paint(); }
    else x[k] = t.value;
    touch();
  };
  document.addEventListener('input', (e) => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') edit(e); });
  document.addEventListener('change', (e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') edit(e); });

  P.lazyZone(window.XENO_ZONE_LIVE['corpo.forms'], () => { if (route().view === 'list') load(); });   // the first load waits until the area is shown
})();
