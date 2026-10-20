/* platform-forms.js — on the platform, Corpo › Forms is the workspace's own forms.
 *
 * Reads and writes /api/forms (routes/formsRoutes.js → services/forms.js) for the workspace you are in.
 * Addresses (ids, the form as the parent of its responses):
 *
 *   /workspace/corpo/spaces/forms                          the forms
 *   /workspace/corpo/spaces/forms/<form id>                build a form, its links
 *   /workspace/corpo/spaces/forms/<form id>/responses      its responses (Contact / Task / Ticket, CSV)
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
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const TYPES = [['text', 'Short text'], ['textarea', 'Long text'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'Web address'], ['number', 'Number'], ['date', 'Date'], ['select', 'One choice'], ['multiselect', 'Several choices'], ['checkbox', 'Checkbox']];
  const ACTIONS = [['contact', 'Add to Customers'], ['task', 'Make a task'], ['ticket', 'Ask XENO support']];
  const S = { status: 'idle', ws: undefined, forms: [], form: null, draft: null, responses: null, fill: null, error: null, shown: null, undo: null, loadedFor: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const item = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'forms' ? (s.item || '') : ''; };
  const route = () => { const it = item(); let m;
    if ((m = it.match(/^fill\/([A-Za-z0-9_-]{40,64})$/))) return { view: 'fill', token: m[1] };
    if ((m = it.match(/^([0-9a-f-]{36})\/responses$/i))) return { view: 'responses', id: m[1] };
    if ((m = it.match(/^([0-9a-f-]{36})$/i))) return { view: 'form', id: m[1] };
    return { view: 'list' }; };
  const goto = (it) => X()?.go?.('zone', { zone: 'forms', item: it || null });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'forms') X().render(); } catch {} };

  async function load() {
    const r0 = route(), key = JSON.stringify([wsId(), r0]);
    S.ws = wsId(); S.status = 'loading'; S.error = null; S.loadedFor = key;
    if (r0.view === 'fill') {
      const r = await api('GET', `/api/forms/public/${encodeURIComponent(r0.token)}/form`).catch(() => null);
      S.fill = r && r.ok ? { token: r0.token, form: r.d.form, errors: {}, done: null } : { token: r0.token, error: said(r, 'This form link does not work.') };
      S.status = 'ready'; return paint();
    }
    const l = await api('GET', '/api/forms' + q()).catch(() => null);
    if (!l || !l.ok) { S.status = 'error'; S.error = said(l, 'Forms could not be reached.'); return paint(); }
    S.forms = l.d.forms || [];
    S.form = null; S.draft = null; S.responses = null;
    if (r0.view === 'form' || r0.view === 'responses') {
      const f = await api('GET', `/api/forms/${r0.id}` + q()).catch(() => null);
      if (!f || !f.ok) { S.status = 'error'; S.error = said(f, 'That form could not be opened.'); return paint(); }
      S.form = f.d.form; S.draft = JSON.parse(JSON.stringify({ title: S.form.title, description: S.form.description, fields: S.form.fields, confirmation: S.form.confirmation, autoActions: S.form.autoActions }));
      if (r0.view === 'responses') { const r = await api('GET', `/api/forms/${r0.id}/responses` + q()).catch(() => null); S.responses = r && r.ok ? r.d.responses : []; if (!r || !r.ok) S.error = said(r, 'Responses could not be read.'); }
    }
    S.status = 'ready'; paint();
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['corpo.forms'] = {
    served: true,
    items: true,   // it draws its own sub-addresses: a form, its responses, the fill view
    work: () => (S.status === 'ready' && S.forms ? ['Forms', S.forms.slice(0, 6).map((f) => [f.title, `${f.status} · ${f.responses} response${f.responses === 1 ? '' : 's'}`, null, 'Forms'])] : null),
    badge: () => null,
    page: () => page(),
    state: () => ({ status: S.status, forms: S.forms.length, route: route() }),
    reload: () => load(),
  };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  const head = (sub, title, crumbs = '') => `<div class="pj-head"><div><small>${crumbs || 'Corpo'}</small><h1>${esc(title)}</h1></div></div>${sub ? `<p class="hm-blurb">${esc(sub)}</p>` : ''}`;
  function page() {
    const r0 = route(), key = JSON.stringify([wsId(), r0]);
    const wrap = (body) => `<div class="wrap pj hm fm" data-fm-page="${esc(S.status)}" data-fm-view="${esc(r0.view)}">${body}</div>`;
    if (S.status === 'loading' || S.loadedFor !== key) { if (S.status !== 'loading' || S.loadedFor !== key) load(); return wrap(head('', 'Forms') + '<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(head('', 'Forms') + `<div class="pj-empty" data-fm-error>${esc(S.error)} ${btn('data-fm-reload', 'Try again')}</div>`);
    if (r0.view === 'fill') return wrap(fillView());
    if (r0.view === 'form') return wrap(formView());
    if (r0.view === 'responses') return wrap(responsesView());
    return wrap(listView());
  }

  function listView() {
    const undo = S.undo ? `<div class="an-undo" data-fm-undone>“${esc(S.undo.title)}” was deleted. ${btn(`data-fm-restore="${esc(S.undo.id)}"`, 'Undo')}</div>` : '';
    const rows = S.forms.length ? `<div class="fm-list">${S.forms.map((f) => `<button class="fm-row" data-fm-open="${esc(f.id)}"><b>${esc(f.title)}</b><span class="fm-st fm-${esc(f.status)}">${esc(f.status)}</span><small>${f.responses} response${f.responses === 1 ? '' : 's'}</small></button>`).join('')}</div>` : '<div class="pj-empty" data-fm-none>No forms yet. Make one to collect sign-ups, requests or feedback.</div>';
    return head('Forms and surveys for your workspace. Responses stay in the workspace and can become customers, tasks or support requests.', 'Forms')
      + `${undo}<div class="an-actions"><input class="in" data-fm-newtitle placeholder="New form title" aria-label="New form title" maxlength="200"> ${btn('data-fm-new', 'New form', 'btn')}</div>${rows}`;
  }

  function fieldEditor(f, i) {
    const opts = f.type === 'select' || f.type === 'multiselect';
    return `<div class="fm-field" data-fm-field="${i}">
      <select class="in" data-fm-f="type" aria-label="Field type">${TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <input class="in" data-fm-f="label" value="${esc(f.label)}" placeholder="Question" aria-label="Question" maxlength="200">
      <label class="fm-req"><input type="checkbox" data-fm-f="required" ${f.required ? 'checked' : ''}> Required</label>
      ${opts ? `<input class="in" data-fm-f="options" value="${esc((f.options || []).join(', '))}" placeholder="Choices, separated by commas" aria-label="Choices">` : ''}
      ${btn(`data-fm-fmove="${i}:-1"`, '↑')} ${btn(`data-fm-fmove="${i}:1"`, '↓')} ${btn(`data-fm-fdel="${i}"`, 'Remove')}</div>`;
  }
  function formView() {
    const f = S.form, d = S.draft;
    const status = { draft: 'Draft — nobody can answer yet', open: 'Open — taking responses', closed: 'Closed — no new responses' }[f.status];
    const links = (f.links || []).map((l) => `<div class="fm-link" data-fm-linkrow="${esc(l.id)}"><b>${l.kind === 'public' ? 'Public link' : 'Sign-in link'}</b><small>${esc(l.label || '')} ${l.createdByKind === 'agent' ? '· made by an agent' : ''} · ${l.live ? 'works' : l.revokedAt ? 'revoked' : 'expired'}</small>${l.live ? btn(`data-fm-revoke="${esc(l.id)}"`, 'Revoke') : ''}</div>`).join('') || '<small>No links yet.</small>';
    const shown = S.shown ? `<div class="fm-shown" data-fm-shown><small>Copy this link now — it is shown once.</small><input class="in" readonly value="${esc(S.shown)}" aria-label="New link"></div>` : '';
    return head(status, f.title, `Corpo · <a href="#" data-fm-back>Forms</a>`)
      + `<div class="an-actions">${f.status !== 'open' ? btn('data-fm-status="open"', 'Open the form', 'btn') : btn('data-fm-status="closed"', 'Close the form')} ${btn(`data-fm-responses="${esc(f.id)}"`, `Responses (${f.responses})`)} ${btn(`data-fm-delete="${esc(f.id)}"`, 'Delete form')}</div>
      <div class="fm-build" data-fm-build>
        <label>Title <input class="in" data-fm-d="title" value="${esc(d.title)}" maxlength="200"></label>
        <label>Description <textarea class="in" data-fm-d="description" maxlength="4000">${esc(d.description)}</textarea></label>
        <div class="fm-fields">${d.fields.map(fieldEditor).join('') || '<small>No questions yet.</small>'}</div>
        <div>${btn('data-fm-addfield', 'Add a question')}</div>
        <label>After someone answers <input class="in" data-fm-d="confirmation" value="${esc(d.confirmation)}" maxlength="1000"></label>
        <div class="fm-auto"><small>On every response:</small> ${ACTIONS.map(([v, l]) => `<label><input type="checkbox" data-fm-auto="${v}" ${d.autoActions.includes(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
        <div>${btn('data-fm-save', 'Save', 'btn')}</div>
      </div>
      <h3>Links</h3>${shown}<div class="fm-links">${links}</div>
      <div class="an-actions">${btn('data-fm-link="signin"', 'New sign-in link')} ${btn('data-fm-link="public"', 'New public link')}</div>
      <small>A sign-in link opens only for someone signed in to XENO. A public link opens for anyone who has it.</small>`;
  }

  const answerText = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v == null ? '' : String(v));
  function responsesView() {
    const f = S.form, rs = S.responses || [];
    const cols = f.fields.slice(0, 4);
    const rows = rs.length ? `<table class="fm-table"><thead><tr><th>Received</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>${rs.map((r) => `<tr data-fm-resp="${esc(r.id)}"><td>${esc(new Date(r.createdAt).toLocaleString())}</td>${cols.map((c) => `<td>${esc(answerText(r.answers[c.id]))}</td>`).join('')}<td class="fm-acts">${ACTIONS.map(([a, l]) => (r.actions && r.actions[a] ? `<small data-fm-done="${a}">${a === 'contact' ? 'Contact' : esc(r.actions[a].key || 'done')}</small>` : btn(`data-fm-act="${esc(r.id)}:${a}"`, l))).join(' ')} ${btn(`data-fm-rdel="${esc(r.id)}"`, 'Delete')}</td></tr>`).join('')}</tbody></table>` : '<div class="pj-empty" data-fm-none>No responses yet.</div>';
    return head(S.error || '', `${f.title} — responses`, `Corpo · <a href="#" data-fm-back>Forms</a> · <a href="#" data-fm-open="${esc(f.id)}">${esc(f.title)}</a>`)
      + `<div class="an-actions">${btn('data-fm-csv', 'Export CSV')}</div>${rows}`;
  }

  function fillView() {
    const F = S.fill;
    if (F.error) return head('', 'Form') + `<div class="pj-empty" data-fm-error>${esc(F.error)}</div>`;
    if (F.done) return head('', F.form.title) + `<div class="pj-empty" data-fm-thanks>${esc(F.done)}</div>`;
    const inp = (f) => { const n = `data-fm-a="${esc(f.id)}"`, e = F.errors[f.id] ? `<div class="fm-err" data-fm-err="${esc(f.id)}">${esc(F.errors[f.id])}</div>` : '';
      const lbl = `<label class="fm-q">${esc(f.label)}${f.required ? ' *' : ''}${f.help ? ` <small>${esc(f.help)}</small>` : ''}</label>`;
      if (f.type === 'textarea') return `${lbl}<textarea class="in" ${n}></textarea>${e}`;
      if (f.type === 'select') return `${lbl}<select class="in" ${n}><option value=""></option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>${e}`;
      if (f.type === 'multiselect') return `${lbl}${f.options.map((o) => `<label><input type="checkbox" ${n} value="${esc(o)}"> ${esc(o)}</label>`).join('')}${e}`;
      if (f.type === 'checkbox') return `<label><input type="checkbox" ${n} value="1"> ${esc(f.label)}${f.required ? ' *' : ''}</label>${e}`;
      return `${lbl}<input class="in" type="${{ email: 'email', phone: 'tel', url: 'url', number: 'number', date: 'date' }[f.type] || 'text'}" ${n}>${e}`; };
    return head(F.form.description, F.form.title, 'Form') + `<div class="fm-fill" data-fm-fill>${F.form.fields.map(inp).join('')}<div>${btn('data-fm-submit', 'Send', 'btn')}</div></div>`;
  }

  // ── reading the builder back into the draft before any change
  function readDraft(root) {
    const d = S.draft; if (!d || !root) return;
    for (const el of root.querySelectorAll('[data-fm-d]')) d[el.dataset.fmD] = el.value;
    for (const row of root.querySelectorAll('[data-fm-field]')) {
      const f = d.fields[Number(row.dataset.fmField)]; if (!f) continue;
      for (const el of row.querySelectorAll('[data-fm-f]')) { const k = el.dataset.fmF; if (k === 'required') f.required = el.checked; else if (k === 'options') f.options = el.value.split(',').map((s) => s.trim()).filter(Boolean); else if (k === 'type') f.type = el.value; else f[k] = el.value; }
      if ((f.type === 'select' || f.type === 'multiselect') && !f.options) f.options = [];
    }
    d.autoActions = [...root.querySelectorAll('[data-fm-auto]:checked')].map((x) => x.dataset.fmAuto);
  }
  const nextId = (fields) => { let i = fields.length + 1; while (fields.some((f) => f.id === 'f' + i)) i++; return 'f' + i; };
  const cleanForSave = (fields) => fields.map((f) => { const o = { id: f.id, type: f.type, label: f.label, required: !!f.required }; if (f.help) o.help = f.help; if (f.type === 'select' || f.type === 'multiselect') o.options = f.options || []; return o; });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-fm-reload],[data-fm-new],[data-fm-open],[data-fm-back],[data-fm-restore],[data-fm-status],[data-fm-responses],[data-fm-delete],[data-fm-addfield],[data-fm-fmove],[data-fm-fdel],[data-fm-save],[data-fm-link],[data-fm-revoke],[data-fm-act],[data-fm-rdel],[data-fm-csv],[data-fm-submit]');
    if (!t || !t.closest('[data-fm-page]')) return;
    e.preventDefault(); e.stopPropagation();
    const root = t.closest('[data-fm-page]'), d = t.dataset, f = S.form;
    if ('fmReload' in d) return load();
    if ('fmBack' in d) { S.shown = null; return goto(null); }
    if (d.fmOpen) { S.shown = null; return goto(d.fmOpen); }
    if (d.fmResponses) return goto(d.fmResponses + '/responses');
    if ('fmNew' in d) {
      const title = ((root.querySelector('[data-fm-newtitle]') || {}).value || '').trim();
      if (!title) return toast('Give the form a title first');
      const r = await api('POST', '/api/forms', withWs({ title, fields: [{ id: 'name', type: 'text', label: 'Your name', required: true }, { id: 'email', type: 'email', label: 'Email', required: true }] })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not save.'));
      toast('Form made — it is a draft until you open it'); return goto(r.d.form.id);
    }
    if (d.fmRestore) { const r = await api('POST', `/api/forms/${d.fmRestore}/restore`, withWs({})).catch(() => null); if (!r || !r.ok) return toast(said(r, 'Could not restore it')); S.undo = null; toast('Form restored'); return goto(d.fmRestore); }
    if (d.fmDelete) {
      if (!window.confirm(`Delete “${f.title}”? Its links stop working.`)) return;
      const r = await api('DELETE', `/api/forms/${d.fmDelete}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not delete.'));
      S.undo = { id: f.id, title: f.title }; toast('Form deleted'); return goto(null);
    }
    if ('fmAddfield' in d) { readDraft(root); S.draft.fields.push({ id: nextId(S.draft.fields), type: 'text', label: '', required: false }); return paint(); }
    if (d.fmFmove) { readDraft(root); const [i, dir] = d.fmFmove.split(':').map(Number), j = i + dir, a = S.draft.fields; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; return paint(); }
    if (d.fmFdel) { readDraft(root); S.draft.fields.splice(Number(d.fmFdel), 1); return paint(); }
    if ('fmSave' in d || d.fmStatus) {
      readDraft(root);
      if (S.draft.fields.some((x) => !String(x.label || '').trim())) return toast('Every question needs a label');
      const body = withWs({ title: S.draft.title, description: S.draft.description, confirmation: S.draft.confirmation, autoActions: S.draft.autoActions, fields: cleanForSave(S.draft.fields), ...(d.fmStatus ? { status: d.fmStatus } : {}) });
      const r = await api('PATCH', `/api/forms/${f.id}`, body).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not save.'));
      toast(d.fmStatus === 'open' ? 'The form is open' : d.fmStatus === 'closed' ? 'The form is closed' : 'Saved'); return load();
    }
    if (d.fmLink) {
      const r = await api('POST', `/api/forms/${f.id}/links`, withWs({ kind: d.fmLink })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Could not make the link.'));
      S.shown = r.d.url; try { await navigator.clipboard.writeText(r.d.url); toast('Link copied'); } catch { toast('Link made'); } return load();
    }
    if (d.fmRevoke) { const r = await api('POST', `/api/forms/${f.id}/links/${d.fmRevoke}/revoke`, withWs({})).catch(() => null); if (!r || !r.ok) return toast(said(r, 'Could not revoke it.')); toast('Link revoked'); return load(); }
    if (d.fmAct) {
      const [rid, action] = d.fmAct.split(':');
      const r = await api('POST', `/api/forms/${f.id}/responses/${rid}/actions`, withWs({ action })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not work.'));
      const i = S.responses.findIndex((x) => x.id === rid); if (i >= 0) S.responses[i] = r.d.response;
      toast({ contact: 'Added to Customers', task: 'Task made', ticket: 'Sent to XENO support' }[action]); return paint();
    }
    if (d.fmRdel) {
      if (!window.confirm('Delete this response? Its answers are erased.')) return;
      const r = await api('DELETE', `/api/forms/${f.id}/responses/${d.fmRdel}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not delete.'));
      S.responses = S.responses.filter((x) => x.id !== d.fmRdel); toast('Response deleted'); return paint();
    }
    if ('fmCsv' in d) {
      try {
        const res = await fetch(`/api/forms/${f.id}/responses.csv` + q(), { headers: P.authHeaders ? P.authHeaders() : {}, credentials: 'include' });
        if (!res.ok) return toast('Could not export the responses');
        const url = URL.createObjectURL(await res.blob()), a = document.createElement('a'); a.href = url; a.download = `${f.title}-responses.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch { toast('Could not export the responses'); }
      return;
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
      F.errors = (r && r.d && r.d.errors) || {}; toast(said(r, 'That did not send.')); return paint();
    }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
