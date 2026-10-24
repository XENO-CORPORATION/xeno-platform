/* platform-customers.js — on the platform, Corpo › Customers is the workspace's own CRM.
 *
 * The picture listed two sample rows ("Acme renewal €12k", "Login issue"). Here it reads /api/customers
 * (routes/customersRoutes.js → services/customers.js) for the workspace you are in:
 *
 *   views     Contacts · Pipeline · Companies · Import · Duplicates     (item = the view name, lower-case)
 *   a contact item "contacts/<contact id>" → /workspace/corpo/spaces/customers/contacts/<id> — id-based, parent in path
 *
 * On a contact: details, deals, the timeline (an agent's note shows as a draft a person keeps or discards), the
 * support tickets raised from this workspace by that email, linked XENO Tasks, and GDPR export / erase.
 * Deleting and erasing are an admin's; the server refuses anyone else, and the buttons only ask.
 *
 * It registers XENO_ZONE_LIVE['corpo.customers'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const VIEWS = [['contacts', 'Contacts'], ['pipeline', 'Pipeline'], ['companies', 'Companies'], ['import', 'Import'], ['duplicates', 'Duplicates']];
  const S = { status: 'idle', ws: undefined, summary: null, contacts: [], companies: [], pipeline: null, dups: null, contact: null, contactId: null, q: '', importReport: null, importCsv: '', error: null, adding: false };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'customers'; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const itemNow = () => String((X()?.S || {}).item || 'contacts');
  const goItem = (item) => X()?.go?.('zone', { zone: 'customers', item });
  const money = (c, cur = 'EUR') => { try { return (Number(c || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }); } catch { return `${(Number(c || 0) / 100).toFixed(0)} ${cur}`; } };
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const [s, c, co] = await Promise.all([api('GET', '/api/customers/summary' + q()).catch(() => null), api('GET', '/api/customers/contacts' + q({ q: S.q })).catch(() => null), api('GET', '/api/customers/companies' + q()).catch(() => null)]);
    if (!s || !s.ok) { S.status = 'error'; S.error = said(s, 'Customers could not be reached.'); return paint(); }
    S.summary = s.d.summary; S.contacts = (c && c.ok && c.d.contacts) || []; S.companies = (co && co.ok && co.d.companies) || [];
    S.status = 'ready'; paint();
  }
  async function loadPipeline() { const r = await api('GET', '/api/customers/pipeline' + q()).catch(() => null); S.pipeline = r && r.ok ? r.d.pipeline : { error: said(r, 'Could not read the pipeline') }; paint(); }
  async function loadDups() { const r = await api('GET', '/api/customers/duplicates' + q()).catch(() => null); S.dups = r && r.ok ? r.d.duplicates : []; paint(); }
  async function loadContact(id) {
    S.contactId = id; S.contact = null;
    const r = await api('GET', `/api/customers/contacts/${encodeURIComponent(id)}` + q()).catch(() => null);
    S.contact = r && r.ok ? r.d.contact : { error: said(r, 'Contact not found') }; paint();
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['corpo.customers'] = {
    served: true,
    items: true,
    label: (item) => { const [v, id] = String(item || '').split('/'); if (id) return S.contact && S.contact.id === id ? `Contacts / ${S.contact.name}` : 'Contact'; return (VIEWS.find((x) => x[0] === v) || [, item])[1]; },
    work: () => (S.status === 'ready' ? ['Customers', [...VIEWS.map(([id, label]) => [label, id === 'contacts' ? String(S.summary?.contacts ?? '') : id === 'pipeline' ? `${S.summary?.openDeals ?? 0} open` : id === 'companies' ? String(S.summary?.companies ?? '') : '', null, id])]] : null),
    badge: () => (S.summary && S.summary.drafts ? S.summary.drafts : null),
    page: () => page(),
    state: () => ({ status: S.status, contacts: S.contacts.length, item: itemNow(), drafts: S.summary?.drafts || 0 }),
    reload: () => load(),
  };
  window.XENO_CUSTOMERS = { served: true, label: (x) => (S.contact && S.contact.id === x ? S.contact.name : x) };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page() {
    const item = itemNow(), [view, cid] = item.split('/');
    // the page's one header (XENO_PAGES): the views are tabs in the header bar and New contact sits right in it;
    // creating opens the workspace dialog, never a form stacked in the body
    const h = window.XENO_PAGES.h;
    const acts = (view === 'companies' ? h.btn('New company', 'data-cr-co-new', true, 'plus') : '') + h.btn('New contact', 'data-cr-add', false, 'plus');
    const head = h.head({ title: 'Customers', sub: 'Your workspace’s contacts, companies and deals. Agents read and draft; people keep, confirm and delete.', acts }) + h.tabs(VIEWS, view, 'data-cr-view-go');
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm cr" data-cr-page="${esc(S.status)}" data-cr-view="${esc(view)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-cr-error>${esc(S.error)} ${btn('data-cr-reload', 'Try again')}</div>`);
    const sum = S.summary ? `<div class="cr-sum"><span><b>${S.summary.contacts}</b> contacts</span><span><b>${S.summary.companies}</b> companies</span><span><b>${S.summary.openDeals}</b> open deals · ${esc(money(S.summary.openCents))}</span>${S.summary.drafts ? `<span data-cr-drafts><b>${S.summary.drafts}</b> agent drafts to review</span>` : ''}</div>` : '';
    let body = '';
    if (view === 'contacts' && cid) body = contactPage(cid);
    else if (view === 'pipeline') body = pipelinePage();
    else if (view === 'companies') body = companiesPage();
    else if (view === 'import') body = importPage();
    else if (view === 'duplicates') body = dupPage();
    else body = contactsPage();
    return wrap(`${sum}${body}`);
  }
  function contactsPage() {
    const rows = S.contacts.map((c) => `<button class="cr-li" data-cr-open="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.email || '')}</small><small>${esc(c.companyName || '')}</small><small>${c.tags.map(esc).join(', ')}</small></button>`).join('');
    return `<div class="cr-search"><input class="in" data-cr-q value="${esc(S.q)}" placeholder="Search name or email" aria-label="Search contacts"></div>${rows ? `<div class="cr-list" data-cr-list>${rows}</div>` : '<div class="pj-empty" data-cr-empty>No contacts yet. Add one, or import a CSV.</div>'}`;
  }
  function contactPage(id) {
    if (S.contactId !== id) { loadContact(id); return '<div class="pj-empty">Loading…</div>'; }
    const c = S.contact; if (!c) return '<div class="pj-empty">Loading…</div>';
    if (c.error) return `<div class="pj-empty" data-cr-error>${esc(c.error)}</div>`;
    const deals = c.deals.length ? c.deals.map((d) => `<div class="cr-deal${d.state === 'draft' ? ' draft' : ''}"><b>${esc(d.title)}</b><small>${esc(money(d.amountCents, d.currency))} · ${esc(d.stageName)}${d.state === 'draft' ? ' · drafted by an agent' : ''}</small>${d.state === 'draft' ? btn(`data-cr-confirm-deal="${esc(d.id)}"`, 'Confirm') : ''}</div>`).join('') : '<p class="pg-dim">No deals.</p>';
    const acts = c.activities.map((a) => `<div class="pg-post cr-act${a.state === 'draft' ? ' cr-draft' : ''}" data-cr-act="${esc(a.id)}" data-cr-state="${esc(a.state)}"><div class="sp-meta"><b>${esc(a.kind)}</b><small>${esc(a.authorName || '')} · ${esc(when(a.createdAt))}${a.state === 'draft' ? ' · agent draft' : ''}</small></div><div class="sp-body">${esc(a.body)}</div>${a.state === 'draft' ? `<div class="cr-row">${btn(`data-cr-keep="${esc(a.id)}"`, 'Keep', 'btn')} ${btn(`data-cr-discard="${esc(a.id)}"`, 'Discard')}</div>` : ''}</div>`).join('') || '<p class="pg-dim">Nothing on the timeline yet.</p>';
    const tickets = c.tickets.length ? c.tickets.map((t) => `<div class="cr-link" data-cr-ticket="${esc(t.key)}"><b>${esc(t.key)}</b> ${esc(t.title)} <small>${esc(t.status)}</small></div>`).join('') : '<p class="pg-dim">No support tickets you can see.</p>';
    const tasks = c.tasks.length ? c.tasks.map((t) => `<div class="cr-link" data-cr-task="${esc(t.key)}"><b>${esc(t.key)}</b> ${esc(t.title || 'Not visible to you')} <small>${esc(t.status || '')}</small></div>`).join('') : '<p class="pg-dim">No linked tasks.</p>';
    return `<div class="cr-detail" data-cr-contact="${esc(c.id)}">
      <div class="cr-main"><h2>${esc(c.name)}</h2><p class="pg-dim">${[c.title, c.email, c.phone, c.companyName].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="cr-compose"><select class="in" data-cr-kind aria-label="Kind"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select>
          <textarea class="in" data-cr-body placeholder="What happened?" aria-label="Timeline entry" maxlength="20000"></textarea>${btn('data-cr-add-act', 'Add to timeline', 'btn')}</div>
        <h3>Timeline</h3><div class="cr-timeline">${acts}</div></div>
      <aside class="sp-console"><h3>Deals</h3>${deals}<div class="sp-inline"><input class="in" data-cr-deal-title placeholder="New deal" aria-label="Deal title"><input class="in" data-cr-deal-amount placeholder="€" aria-label="Amount" inputmode="decimal" style="max-width:80px"></div>${btn('data-cr-add-deal', 'Add deal')}
        <h3>Support tickets</h3>${tickets}<div class="sp-inline"><input class="in" data-cr-link-ticket placeholder="T-12" aria-label="Ticket key"></div>${btn('data-cr-link="support_ticket"', 'Link ticket')}
        <h3>Tasks</h3>${tasks}<div class="sp-inline"><input class="in" data-cr-task-title placeholder="New task about this customer" aria-label="Task title"></div>${btn('data-cr-new-task', 'Create task')}
        <h3>Personal data</h3>${btn('data-cr-export', 'Export (GDPR)')} ${btn('data-cr-erase', 'Erase…')} ${btn('data-cr-delete', 'Delete')}</aside></div>`;
  }
  function pipelinePage() {
    if (!S.pipeline) { loadPipeline(); return '<div class="pj-empty">Loading…</div>'; }
    if (S.pipeline.error) return `<div class="pj-empty">${esc(S.pipeline.error)}</div>`;
    const stages = S.pipeline.stages;
    return `<div class="cr-board" data-cr-board>${stages.map((s) => `<div class="cr-col" data-cr-stage="${esc(s.id)}"><div class="cr-col-h"><b>${esc(s.name)}</b><small>${esc(money(s.totalCents))}</small></div>${s.deals.map((d) => `<div class="cr-deal${d.state === 'draft' ? ' draft' : ''}" data-cr-deal="${esc(d.id)}"><b>${esc(d.title)}</b><small>${esc(money(d.amountCents, d.currency))}${d.contactName ? ' · ' + esc(d.contactName) : ''}${d.state === 'draft' ? ' · draft' : ''}</small>
      <select class="in" data-cr-move="${esc(d.id)}" aria-label="Move ${esc(d.title)}">${stages.map((x) => `<option value="${esc(x.id)}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${d.state === 'draft' ? btn(`data-cr-confirm-deal="${esc(d.id)}"`, 'Confirm') : ''}</div>`).join('') || '<p class="pg-dim">No deals</p>'}</div>`).join('')}</div>`;
  }
  function companiesPage() {
    const rows = S.companies.map((c) => `<div class="cr-li"><b>${esc(c.name)}</b><small>${esc(c.domain || '')}</small><small>${esc(c.contacts)} contacts</small>${btn(`data-cr-del-company="${esc(c.id)}"`, 'Delete')}</div>`).join('');
    return `${rows ? `<div class="cr-list">${rows}</div>` : '<div class="pj-empty">No companies yet. Add one with New company.</div>'}`;
  }
  function importPage() {
    const r = S.importReport;
    const rep = r ? `<div class="cr-report" data-cr-report>${r.confirm ? 'Imported' : 'Preview'}: <b>${r.created}</b> new · <b>${r.merged}</b> merged · <b>${r.skipped}</b> skipped (duplicates) · <b>${r.invalid.length}</b> invalid${r.invalid.length ? ` (rows ${r.invalid.slice(0, 10).map((x) => x.row).join(', ')})` : ''}</div>` : '';
    return `<div class="cr-form"><p class="pg-dim">CSV with a header row: name, email, phone, title, company, tags (tags separated by “;”). An email already in Customers is never overwritten.</p>
      <input type="file" accept=".csv,text/csv" data-cr-file aria-label="CSV file"><textarea class="in" data-cr-csv rows="6" placeholder="name,email&#10;Ada Lovelace,ada@example.com" aria-label="CSV">${esc(S.importCsv)}</textarea>
      <label class="sp-check"><input type="checkbox" data-cr-merge> Fill blanks on existing contacts</label>
      <div class="cr-row">${btn('data-cr-preview', 'Preview')} ${btn('data-cr-run-import', 'Import', 'btn')}</div>${rep}</div>`;
  }
  function dupPage() {
    if (!S.dups) { loadDups(); return '<div class="pj-empty">Looking for duplicates…</div>'; }
    if (!S.dups.length) return '<div class="pj-empty" data-cr-nodups>No likely duplicates.</div>';
    return `<div class="cr-list">${S.dups.map((d) => `<div class="cr-li" data-cr-dup><b>${esc(d.a.name)}</b><small>${esc(d.a.email || '')}</small><b>${esc(d.b.name)}</b><small>${esc(d.b.email || '')}</small>${btn(`data-cr-merge-into="${esc(d.a.id)}" data-cr-merge-from="${esc(d.b.id)}"`, 'Merge into first')}</div>`).join('')}</div>`;
  }

  const val = (root, sel) => ((root.querySelector(sel) || {}).value || '').trim();
  async function act(method, url, body, okMsg) {
    const r = await api(method, url, body ? withWs(body) : undefined).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  // New contact / New company: the workspace dialog (XD.form)
  function newContact() {
    window.XD.form({ title: 'New contact', submit: 'Add contact',
      fields: [{ id: 'name', label: 'Name', required: true, max: 200 }, { id: 'email', label: 'Email', max: 320 }, { id: 'phone', label: 'Phone', max: 60 },
        ...(S.companies.length ? [{ id: 'companyId', type: 'choice', label: 'Company', value: '', options: [['', 'No company'], ...S.companies.map((c) => [c.id, c.name])] }] : [])],
      onSubmit: async (v) => { const r = await api('POST', '/api/customers/contacts' + q(), withWs({ name: v.name, email: v.email || undefined, phone: v.phone || undefined, companyId: v.companyId || undefined })).catch(() => null); if (!r || !r.ok) return said(r, 'That did not save.'); S.made = r.d.contact.id; return null; },
    }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; toast('Contact added'); await load(); goItem('contacts/' + id); });
  }
  function newCompany() {
    window.XD.form({ title: 'New company', submit: 'Add company', size: 'sm',
      fields: [{ id: 'name', label: 'Company name', required: true, max: 200 }, { id: 'domain', label: 'Domain', max: 200, placeholder: 'domain.com' }],
      onSubmit: async (v) => { const r = await api('POST', '/api/customers/companies' + q(), withWs({ name: v.name, domain: v.domain || undefined })).catch(() => null); return r && r.ok ? null : said(r, 'That did not save.'); },
    }).then((v) => { if (v) { toast('Company added'); load(); } });
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-cr-reload],[data-cr-add],[data-cr-co-new],[data-cr-view-go],[data-cr-open],[data-cr-add-act],[data-cr-keep],[data-cr-discard],[data-cr-add-deal],[data-cr-confirm-deal],[data-cr-link],[data-cr-new-task],[data-cr-export],[data-cr-erase],[data-cr-delete],[data-cr-del-company],[data-cr-preview],[data-cr-run-import],[data-cr-merge-into],[data-cr-ticket],[data-cr-task]');
    if (!t || !(t.closest('[data-cr-page]') || t.closest('#main .topbar'))) return;
    e.preventDefault(); e.stopPropagation();
    const root = document.querySelector('#main [data-cr-page]') || document.body, d = t.dataset, cid = S.contact && S.contact.id;
    const refreshContact = () => { S.contactId = null; load(); };
    if ('crReload' in d) return load();
    if ('crAdd' in d) return newContact();
    if ('crCoNew' in d) return newCompany();
    if (d.crViewGo) { S.pipeline = null; S.dups = null; return goItem(d.crViewGo); }
    if (d.crOpen) return goItem('contacts/' + d.crOpen);
    if (d.crTicket) return X()?.go?.('global', { global: 'support', item: d.crTicket });
    if (d.crTask) return X()?.go?.('global', { global: 'tasks', item: d.crTask });
    if ('crAddAct' in d && cid) { const body = val(root, '[data-cr-body]'); if (!body) return toast('Write something first'); if (await act('POST', `/api/customers/contacts/${cid}/activities` + q(), { kind: val(root, '[data-cr-kind]') || 'note', body }, 'Added')) refreshContact(); return; }
    if (d.crKeep) { if (await act('POST', `/api/customers/activities/${d.crKeep}/keep` + q(), {}, 'Kept')) refreshContact(); return; }
    if (d.crDiscard) { if (await act('POST', `/api/customers/activities/${d.crDiscard}/keep` + q(), { discard: true }, 'Discarded')) refreshContact(); return; }
    if ('crAddDeal' in d && cid) { const title = val(root, '[data-cr-deal-title]'); if (!title) return toast('Name the deal'); const amt = Math.round(Number(val(root, '[data-cr-deal-amount]').replace(',', '.') || 0) * 100);
      if (await act('POST', '/api/customers/deals' + q(), { title, amountCents: amt, contactId: cid }, 'Deal added')) refreshContact(); return; }
    if (d.crConfirmDeal) { if (await act('POST', `/api/customers/deals/${d.crConfirmDeal}/confirm` + q(), {}, 'Deal confirmed')) { S.pipeline = null; refreshContact(); } return; }
    if (d.crLink && cid) { const key = val(root, '[data-cr-link-ticket]'); if (!key) return toast('Enter a ticket key'); if (await act('POST', `/api/customers/contacts/${cid}/links` + q(), { kind: d.crLink, key }, 'Linked')) refreshContact(); return; }
    if ('crNewTask' in d && cid) { const title = val(root, '[data-cr-task-title]'); if (!title) return toast('Name the task'); if (await act('POST', `/api/customers/contacts/${cid}/task` + q(), { title }, 'Task created')) refreshContact(); return; }
    if ('crExport' in d && cid) {
      const r = await api('GET', `/api/customers/contacts/${cid}/export` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Export failed'));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.d.export, null, 2)], { type: 'application/json' })); a.download = `contact-${cid}.json`; a.click(); return toast('Exported');
    }
    if ('crErase' in d && cid) { if (!window.confirm(`Erase ${S.contact.name}? Their details, timeline and links are removed for good. A record that an erasure happened is kept.`)) return;
      if (await act('POST', `/api/customers/contacts/${cid}/erase` + q(), {}, 'Erased')) { await load(); return goItem('contacts'); } return; }
    if ('crDelete' in d && cid) { if (!window.confirm(`Delete ${S.contact.name}?`)) return;
      if (await act('DELETE', `/api/customers/contacts/${cid}` + q(), null, 'Deleted')) { await load(); return goItem('contacts'); } return; }
    if (d.crDelCompany) { if (!window.confirm('Delete this company? Its contacts stay.')) return; if (await act('DELETE', `/api/customers/companies/${d.crDelCompany}` + q(), null, 'Deleted')) load(); return; }
    if ('crPreview' in d || 'crRunImport' in d) {
      const csv = val(root, '[data-cr-csv]'); S.importCsv = csv; if (!csv) return toast('Paste or choose a CSV first');
      const confirm = 'crRunImport' in d, onDuplicate = root.querySelector('[data-cr-merge]')?.checked ? 'merge' : 'skip';
      const r = await act('POST', '/api/customers/import' + q(), { csv, confirm, onDuplicate }, confirm ? 'Imported' : null);
      if (r) { S.importReport = r.report; if (confirm) await load(); else paint(); } return;
    }
    if (d.crMergeInto) { if (!window.confirm('Merge these two contacts? The second one’s timeline, deals and links move to the first.')) return;
      if (await act('POST', '/api/customers/merge' + q(), { into: d.crMergeInto, from: d.crMergeFrom }, 'Merged')) { S.dups = null; load(); } }
  }, true);
  let qTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-cr-q]'); if (!t || !t.closest('[data-cr-page]')) return;
    S.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(async () => { const r = await api('GET', '/api/customers/contacts' + q({ q: S.q })).catch(() => null); if (r && r.ok) { S.contacts = r.d.contacts; paint(); const i = document.querySelector('[data-cr-q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } }, 250);
  }, true);
  document.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-cr-file]');
    if (f && f.files && f.files[0]) { S.importCsv = await f.files[0].text(); S.importReport = null; return paint(); }
    const m = e.target.closest('[data-cr-move]'); if (!m || !m.closest('[data-cr-page]')) return;
    if (await act('POST', `/api/customers/deals/${m.dataset.crMove}/move` + q(), { stageId: m.value }, 'Moved')) loadPipeline();
  }, true);

  // the rail's badge (agent drafts) needs only the summary; contacts and companies wait until Customers is shown
  const loadBadge = async () => { const s = await api('GET', '/api/customers/summary' + q()).catch(() => null); if (s && s.ok && S.status !== 'ready') { S.summary = s.d.summary; paint(); } };
  P.lazyZone(window.XENO_ZONE_LIVE['corpo.customers'], () => load(), loadBadge);
})();
