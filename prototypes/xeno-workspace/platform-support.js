/* XENO_SUPPORT — Help ▸ Contact support: private requests to XENO, and XENO's own console. Real platform API.
 * Service: src/server/services/supportTickets.js · routes: /api/support/* · agents: supportMcp.js.
 *
 *   My requests     /workspace/support                 the requests I raised
 *   New request     /workspace/support/new             the list with the Contact support dialog open
 *   a request       /workspace/support/T-<n>           by its key: the conversation, my reply, close / reopen / make public
 *   Queue (staff)   /workspace/support/queue           every request, filtered; ?f=<status>
 *   Saved replies   /workspace/support/macros          staff
 *   Site access     /workspace/support/access          admins: personal access codes for the gated site (investors,
 *                                                      partners, testers) — create (shown once), list, revoke, audit
 *
 * The server decides what each person sees. The customer's reply never carries internal notes or an agent's unsent
 * draft, so nothing here hides them: they are simply not in the response. Staff see drafts and send them (ratify).
 * Nothing is invented: from disk (no platform) it says it needs the platform. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SUPPORT = { served: false }; return; }
  const X = () => window.XW, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fb) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fb;
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, status: 0, d: {} }));
  const go = (item) => X()?.go?.('global', { global: 'support', item: item || null });
  const paint = () => { try { X()?.render?.(); } catch {} };
  const KINDS = [['bug', 'Something is broken'], ['billing', 'Billing or a charge'], ['account', 'My account or sign-in'], ['feature', 'A feature request'], ['other', 'Something else']];
  const STATUS = { new: 'New', triaged: 'Being looked at', waiting_on_customer: 'Waiting on you', resolved: 'Resolved', closed: 'Closed' };
  const STAFF_STATUS = { ...STATUS, waiting_on_customer: 'Waiting on customer' };
  const PRI = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
  const S = { staff: null, mine: null, queue: null, one: null, oneKey: null, macros: null, access: null, made: null, events: {}, filter: 'open', busy: false, err: '' };

  const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
  const isKey = (it) => /^T-\d+$/i.test(it || '');

  async function loadFor(it) {
    // staff and admin come from the session's role (P.isStaff/isAdmin), never from a staff route refusing a customer
    if (S.staff === null) { await P.ready; S.staff = P.isStaff(); if (S.staff) { const q = await api('GET', '/api/support/tickets/queue?status=open'); if (q.ok) S.queue = q.d.tickets || []; else S.staff = false; } }
    // admins only: Site access is never asked for by anyone else, and then the tab is simply not there
    if (P.isAdmin() && (S.access === null || it === 'access')) { const a = await api('GET', '/api/site-gate/codes'); S.access = a.ok ? a.d.codes || [] : false; }
    else if (!P.isAdmin()) S.access = false;
    if (isKey(it)) {
      const key = it.toUpperCase();
      const r = await api('GET', `/api/support/tickets/${encodeURIComponent(key)}`);
      S.oneKey = key; S.one = r.ok ? r.d.ticket : { missing: r.status === 404, error: said(r, 'Could not load this request') };
      if (S.staff && !S.macros) { const m = await api('GET', '/api/support/macros'); S.macros = m.ok ? m.d.macros || [] : []; }
    } else if (it === 'queue' && S.staff) {
      const r = await api('GET', `/api/support/tickets/queue?${S.filter === 'breached' ? 'breached=1&status=open' : S.filter === 'mine' ? 'assignee=me&status=open' : S.filter === 'unassigned' ? 'assignee=none&status=open' : 'status=' + encodeURIComponent(S.filter)}`);
      S.queue = r.ok ? r.d.tickets || [] : [];
    } else if (it === 'macros' && S.staff) {
      const m = await api('GET', '/api/support/macros'); S.macros = m.ok ? m.d.macros || [] : [];
    } else {
      const r = await api('GET', '/api/support/tickets/mine'); S.mine = r.ok ? r.d.tickets || [] : { error: said(r, 'Could not load your requests') };
    }
    paint();
  }
  let lastLoad = null;
  const want = (it) => { const k = it || ''; if (lastLoad !== k) { lastLoad = k; loadFor(it); return true; } return false; };

  // the views are TABS in the header bar (XENO_PAGES.h.tabs, lifted by framed()), never a row in the body
  const tabs = (cur) => S.staff || Array.isArray(S.access) ? H().tabs([['', 'My requests'], ...(S.staff ? [['queue', 'Queue'], ['macros', 'Saved replies']] : []), ...(Array.isArray(S.access) ? [['access', 'Site access']] : [])], cur, 'data-sp-go') : '';
  const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || [k, k])[1];

  function listPage() {
    const h = H(), rows = Array.isArray(S.mine) ? S.mine : [];
    const body = S.mine == null ? '' : S.mine.error ? h.box('alert', 'Your requests did not load', esc(S.mine.error), h.btn('Try again', 'data-sp-reload', true))
      : rows.length ? h.table(['Request', 'About', 'Status', 'Updated'], rows.map((t) => h.tr(`data-sp-go="${esc(t.key)}"`, [`<b>${esc(t.key)}</b> · ${esc(t.title)}`, esc(kindLabel(t.kind)), h.chip(STATUS[t.status] || t.status), esc(ago(t.updatedAt))])))
      : h.box('mail', 'No requests yet', 'Ask XENO anything private — a charge, your account, something broken. Only you and XENO support can read it.', h.btn('Contact support', 'data-sp-create="new"', false, 'plus'));
    return h.page(h.head({ title: 'Support', sub: 'Private requests to XENO. Only you and XENO support read them.', acts: h.btn('Contact support', 'data-sp-create="new"', false, 'plus') }) + tabs('') + body + h.foot('support', 'GET /api/support/tickets/mine', 'request'));
  }

  // Contact support is a DIALOG over the list (the workspace's one dialog, XD.form), never a page-wide form.
  // /workspace/support/new still answers: it is the list with the dialog open, and closing it returns to the list.
  let newOpen = false;
  function openNew() {
    if (newOpen || !window.XD) return; newOpen = true;
    window.XD.form({ title: 'Contact support', sub: 'Private by default. You can make it public on the Forum later.', submit: 'Send to XENO support',
      fields: [{ id: 'kind', type: 'choice', label: 'What is it about', value: 'bug', options: KINDS.map(([k, l]) => [k, l]) },
        { id: 'title', label: 'Subject', required: true, max: 200, placeholder: 'One line' },
        { id: 'body', type: 'textarea', label: 'Details', rows: 7, max: 20000, placeholder: 'What happened, what you expected, and anything that helps' }],
      onSubmit: async (v) => { const r = await api('POST', '/api/support/tickets', { kind: v.kind, title: v.title, body: v.body, workspaceId: window.XENO_ADDR?.workspace?.() || null }); if (!r.ok) return said(r, 'That did not send'); S.sent = r.d.ticket.key; return null; },
    }).then((v) => { newOpen = false; if (v && S.sent) { const k = S.sent; S.sent = null; toast(`Sent — ${k}`); S.mine = null; lastLoad = null; return go(k); } if (here() === 'new') go(null); });
  }

  function msgHTML(m, staff) {
    const who = m.author.requester ? (staff ? 'Customer' : 'You') : m.author.name || (m.author.kind === 'agent' ? 'Support agent' : 'XENO support');
    const cls = ['pg-post', m.visibility === 'internal' ? 'sp-internal' : '', m.state === 'draft' ? 'sp-draft' : '', m.kind === 'status' || m.kind === 'system' ? 'sp-event' : ''].filter(Boolean).join(' ');
    const tag = m.visibility === 'internal' ? '<span class="pg-tag">Internal — the customer never sees this</span>' : m.state === 'draft' ? '<span class="pg-tag">Agent draft — not sent</span>' : m.agentDrafted ? `<span class="pg-tag">Drafted by an agent · sent by ${esc(m.ratifiedBy?.name || 'staff')}</span>` : '';
    const acts = staff && m.state === 'draft' ? `<div class="sp-row">${H().btn('Edit & send', `data-sp-ratify="${esc(m.id)}"`)}${H().btn('Discard', `data-sp-discard="${esc(m.id)}"`, true)}</div>` : '';
    return `<article class="${cls}" data-msg="${esc(m.id)}"><span class="pg-av">${esc(who.slice(0, 1).toUpperCase())}</span><div><div class="sp-meta"><b>${esc(who)}</b> <small>${esc(ago(m.createdAt))}</small> ${tag}</div><div class="sp-body" ${m.state === 'draft' ? `data-sp-draft-body="${esc(m.id)}"` : ''}>${esc(m.body)}</div>${acts}</div></article>`;
  }

  function onePage() {
    const h = H(), t = S.one;
    if (!t || S.oneKey !== (X().S.item || '').toUpperCase()) return h.page('');
    if (t.missing) return h.page(h.box('alert', 'Request not found', 'It does not exist, or it is not yours to read.', h.btn('My requests', 'data-sp-go=""', true)));
    if (t.error) return h.page(h.box('alert', 'This request did not load', esc(t.error), h.btn('Try again', 'data-sp-reload', true)));
    const staff = t.you === 'staff', agent = t.you === 'agent', inner = staff || agent, closed = t.status === 'closed';
    const statusWords = inner ? STAFF_STATUS : STATUS;
    const meta = [`<span>${esc(statusWords[t.status] || t.status)}</span>`, `<span>${esc(kindLabel(t.kind))}</span>`, inner ? `<span>${esc(PRI[t.priority])} priority</span>` : '', t.engineering ? `<span>Engineering: ${esc(t.engineering.task ? `${t.engineering.task} (${t.engineering.status})` : t.engineering.status)}</span>` : '', t.thread ? `<span><a href="${esc(t.thread.url)}">Public on the Forum</a></span>` : '', t.mergedInto ? `<span>Merged into <a data-sp-go="${esc(t.mergedInto)}">${esc(t.mergedInto)}</a></span>` : ''].filter(Boolean).join('');
    let acts = '';
    if (t.you === 'requester') acts = (t.status === 'resolved' ? h.btn('Reopen', 'data-sp-status="triaged"', true) : '') + (!closed ? h.btn('Close request', 'data-sp-status="closed"', true) : '') + (!t.thread ? h.btn(S.armPublish ? 'Press again: anyone will read it' : 'Make public', 'data-sp-publish', true) : '');
    const sla = inner ? `<div class="sp-sla"><span${t.sla.firstResponseBreached ? ' class="bad"' : ''}>First response ${t.sla.firstRespondedAt ? 'sent ' + esc(ago(t.sla.firstRespondedAt)) : 'due ' + esc(new Date(t.sla.firstResponseDueAt).toLocaleString())}</span><span${t.sla.resolutionBreached ? ' class="bad"' : ''}>Resolution due ${esc(new Date(t.sla.resolutionDueAt).toLocaleString())}</span></div>` : '';
    const console_ = staff ? `<aside class="sp-console" aria-label="Request controls">
        <label>Status<select data-sp-set="status">${Object.keys(STAFF_STATUS).map((s) => `<option value="${s}"${s === t.status ? ' selected' : ''}>${esc(STAFF_STATUS[s])}</option>`).join('')}</select></label>
        <label>Priority<select data-sp-set="priority">${Object.keys(PRI).map((p) => `<option value="${p}"${p === t.priority ? ' selected' : ''}>${PRI[p]}</option>`).join('')}</select></label>
        <label>Kind<select data-sp-set="kind">${KINDS.map(([k, l]) => `<option value="${k}"${k === t.kind ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <p class="pg-dim">Requester: ${esc(t.requester?.name || '—')}<br>Assignee: ${esc(t.assignee?.name || 'nobody')}${t.delegate ? `<br>Agent: ${esc(t.delegate.name)} (drafts only)` : ''}</p>
        <div class="sp-row">${h.btn('Assign to me', 'data-sp-assign-me', true)}${h.btn(t.engineering ? 'Task linked' : 'Raise a task', `data-sp-task${t.engineering ? ' disabled' : ''}`, true)}</div>
        <form class="sp-inline" data-sp-form="merge"><input name="into" placeholder="Merge into T-…" aria-label="Merge into request" pattern="[Tt]-\\d+">${h.btn('Merge', 'type="submit"', true)}</form>
        <form class="sp-inline" data-sp-form="delegate"><input name="agent" placeholder="Support agent id" aria-label="Delegate to agent id">${h.btn('Delegate', 'type="submit"', true)}</form>
      </aside>` : '';
    const composer = closed && !inner ? `<p class="pg-dim">This request is closed. ${h.btn('Contact support again', 'data-sp-create="new"', true)}</p>`
      : `<form class="sp-form sp-reply" data-sp-form="reply">
        ${staff && S.macros && S.macros.length ? `<label>Saved reply<select data-sp-macro><option value="">Insert a saved reply…</option>${S.macros.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select></label>` : ''}
        ${S.ratify ? `<p class="sp-ratify">Sending an agent’s draft to the customer — read it, edit it, and Send. ${h.btn('Cancel', 'type="button" data-sp-unratify', true)}</p>` : ''}
        <label>${agent ? 'Draft a reply (a person on XENO staff sends it)' : 'Reply'}<textarea name="body" rows="5" maxlength="20000" required></textarea></label>
        ${inner && !S.ratify ? '<label class="sp-check"><input type="checkbox" name="internal"> Internal note — the customer never sees it</label>' : ''}
        ${S.err ? `<p class="sp-err" role="alert">${esc(S.err)}</p>` : ''}
        <div class="sp-row">${h.btn(S.busy ? 'Sending…' : agent ? 'Save draft' : 'Send', `type="submit"${S.busy ? ' disabled' : ''}`)}</div>
      </form>`;
    return h.page(h.head({ eyebrow: `<a data-sp-go="${inner ? 'queue' : ''}">Support</a>`, title: `${t.key} · ${t.title}`, acts, meta, obj: true })
      + sla + `<div class="sp-layout${staff ? ' with-console' : ''}"><div class="pg-thread">${t.body ? msgHTML({ id: 'op', kind: 'reply', body: t.body, createdAt: t.createdAt, author: { requester: true, kind: 'human' } }, inner) : ''}${(t.messages || []).map((m) => msgHTML(m, staff)).join('')}${t.attachments && t.attachments.length ? `<p class="pg-dim">Files: ${t.attachments.map((a) => esc(a.name) + (a.internal ? ' (internal)' : '')).join(', ')}</p>` : ''}${composer}</div>${console_}</div>`);
  }

  function queuePage() {
    const h = H(), rows = S.queue || [];
    const F = [['open', 'Open'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['breached', 'Past SLA'], ['new', 'New'], ['waiting_on_customer', 'Waiting'], ['resolved', 'Resolved'], ['closed', 'Closed']];
    const seg = `<div class="pg-bar"><div class="pg-seg" role="tablist">${F.map(([k, l]) => `<button role="tab" aria-selected="${S.filter === k}" data-sp-filter="${k}">${l}</button>`).join('')}</div></div>`;
    const body = rows.length ? h.table(['Request', 'Requester', 'Priority', 'Status', 'SLA', 'Updated'], rows.map((t) => h.tr(`data-sp-go="${esc(t.key)}"`, [`<b>${esc(t.key)}</b> · ${esc(t.title)}`, esc(t.requester?.name || ''), esc(PRI[t.priority]), h.chip(STAFF_STATUS[t.status] || t.status), t.sla.firstResponseBreached || t.sla.resolutionBreached ? '<span class="sp-bad">Breached</span>' : 'On time', esc(ago(t.updatedAt))])))
      : h.box('check', 'Nothing here', 'No requests match this view.');
    return h.page(h.head({ eyebrow: '<a data-sp-go="">Support</a>', title: 'Support queue', sub: 'Every request to XENO. Agents draft; a person sends.' }) + tabs('queue') + seg + body + h.foot('support', 'GET /api/support/tickets/queue', 'request'));
  }

  function macrosPage() {
    const h = H(), list = S.macros || [];
    return h.page(h.head({ eyebrow: '<a data-sp-go="">Support</a>', title: 'Saved replies', acts: h.btn('New saved reply', 'data-sp-create="macro"', false, 'plus') }) + tabs('macros')
      + (list.length ? `<div class="pg-thread">${list.map((m) => `<article class="pg-post"><span class="pg-av">R</span><div><div class="sp-meta"><b>${esc(m.title)}</b></div><div class="sp-body">${esc(m.body)}</div><div class="sp-row">${h.btn('Delete', `data-sp-macro-del="${esc(m.id)}"`, true)}</div></div></article>`).join('')}</div>` : h.box('mail', 'No saved replies yet', 'Save the answers you give often.', h.btn('New saved reply', 'data-sp-create="macro"', false, 'plus'))));
  }

  const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  function accessPage() {
    const h = H(), list = S.access || [];
    const made = S.made ? h.box('check', `Code for ${S.made.accessCode.label} — copy it now, it is not shown again`,
      `<code data-sac-code style="user-select:all;font-size:1.1em">${esc(S.made.code)}</code><br>Send: “xenosystem.ai — access code ${esc(S.made.code)}”. ${S.made.accessCode.scope === 'account' ? 'It also lets them create an account.' : 'It opens the pages only.'} Expires ${esc(day(S.made.accessCode.expiresAt))}.`,
      h.btn('Done', 'data-sac-done', true)) : '';
    const rows = list.map((c) => h.tr(`data-sac-row="${esc(c.id)}"`, [`<b>${esc(c.label)}</b>`, c.scope === 'account' ? 'Pages + account' : 'Pages',
      h.chip(c.revokedAt ? 'Revoked' : c.live ? 'Live' : 'Ended'), `${esc(c.uses)}${c.maxUses ? ' / ' + esc(c.maxUses) : ''}${c.accounts ? ` · ${esc(c.accounts)} account${c.accounts === 1 ? '' : 's'}` : ''}`,
      esc(c.lastUsedAt ? `${ago(c.lastUsedAt)}${c.lastUsedCountry ? ' · ' + c.lastUsedCountry : ''}` : 'never'), esc(day(c.expiresAt)),
      `${h.btn('Usage', `data-sac-events="${esc(c.id)}"`, true)}${c.live ? h.btn('Revoke', `data-sac-revoke="${esc(c.id)}"`, true) : ''}`]));
    const ev = Object.entries(S.events).map(([id, evs]) => { const c = list.find((x) => x.id === id); return c ? `<h3>Usage — ${esc(c.label)}</h3>` + (evs.length ? h.table(['Event', 'Who', 'Country', 'How', 'When'], evs.map((e) => h.tr('', [esc(e.event.replace(/_/g, ' ')), esc(e.actor || ''), esc(e.country || ''), esc(e.via === 'link' ? 'Code link' : e.via === 'access' ? 'Access page' : e.via === 'form' ? 'Typed in' : ''), esc(ago(e.at))]))) : '<p>Nothing yet.</p>') : ''; }).join('');
    return h.page(h.head({ eyebrow: '<a data-sp-go="">Support</a>', title: 'Site access', sub: 'Personal codes that open the gated site. Revoking one closes every browser it opened.', acts: h.btn('Create code', 'data-sp-create="access"' + (S.busy ? ' disabled' : ''), false, 'plus') }) + tabs('access')
      + (S.err ? h.box('alert', 'That did not work', esc(S.err)) : '') + made
      + (list.length ? h.table(['For', 'Opens', 'State', 'Uses', 'Last used', 'Expires', ''], rows) : h.box('lock', 'No codes yet', 'Create one for each person or fund, so each can be revoked on its own.', h.btn('Create code', 'data-sp-create="access"', false, 'plus'))) + ev);
  }

  function route(it) {
    want(it);
    S.err = S.err && S._errFor === (it || '') ? S.err : '';
    if (it === 'new' || it === 'Contact support') { setTimeout(openNew, 0); return listPage(); }
    if (isKey(it)) return onePage();
    if (it === 'queue' && S.staff) return queuePage();
    if (it === 'macros' && S.staff) return macrosPage();
    if (it === 'access' && Array.isArray(S.access)) return accessPage();
    return listPage();
  }
  const label = (x) => (isKey(x) && S.one && S.one.key === x.toUpperCase() ? `${S.one.key} · ${S.one.title}` : x === 'queue' ? 'Queue' : x === 'macros' ? 'Saved replies' : x === 'access' ? 'Site access' : x === 'new' ? 'Contact support' : x);

  const here = () => X()?.S?.item || '';
  const refresh = () => { lastLoad = ''; loadFor(here()); };
  const fail = (r, fb) => { S.err = said(r, fb); S._errFor = here(); S.busy = false; paint(); };
  async function act(method, path, body, after) {
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) return fail(r, 'That did not work');
    S.err = ''; if (after) after(r); else refresh();
  }

  const whole = (v, lo, hi) => (/^\d+$/.test(String(v)) && Number(v) >= lo && Number(v) <= hi ? null : `A whole number from ${lo} to ${hi}.`);
  function openAccess() {
    window.XD.form({ title: 'Create an access code', sub: 'One code per person or fund, so each can be revoked on its own. It is shown once.', submit: 'Create code',
      fields: [{ id: 'label', label: 'Who it is for', required: true, max: 160, placeholder: 'Investor — Example Fund' },
        { id: 'scope', type: 'choice', label: 'Opens', value: 'pages', options: [['pages', "The site's pages"], ['account', 'The pages, and creating an account']] },
        { id: 'days', type: 'number', label: 'Expires after (days)', required: true, value: '30', max: 3, validate: (v) => whole(v, 1, 365) },
        { id: 'maxUses', type: 'number', label: 'Uses', max: 5, placeholder: 'Blank = unlimited', validate: (v) => (v === '' ? null : whole(v, 1, 10000)) }],
      onSubmit: async (v) => { const r = await api('POST', '/api/site-gate/codes', { label: v.label, scope: v.scope, days: Number(v.days), maxUses: v.maxUses ? Number(v.maxUses) : null }); if (!r.ok) return said(r, 'That did not work'); S.made = r.d; return null; },
    }).then((v) => { if (v) refresh(); });
  }
  function openMacro() {
    window.XD.form({ title: 'New saved reply', submit: 'Save reply',
      fields: [{ id: 'title', label: 'Title', required: true, max: 120 }, { id: 'body', type: 'textarea', label: 'Reply', required: true, rows: 6, max: 20000 }],
      onSubmit: async (v) => { const r = await api('POST', '/api/support/macros', { title: v.title, body: v.body }); return r.ok ? null : said(r, 'That did not save'); },
    }).then((v) => { if (v) { toast('Saved reply added'); refresh(); } });
  }

  document.addEventListener('click', (e) => {
    // the page's create action (header bar, right): it opens the dialog for what it makes
    const n = e.target.closest('[data-sp-create]');
    if (n && n.closest('#main, #panel') && !n.disabled) { e.preventDefault(); const k = n.dataset.spCreate; if (k === 'access') return openAccess(); if (k === 'macro') return openMacro(); return here() === 'new' ? openNew() : go('new'); }
    const a = e.target.closest('[data-sac-revoke],[data-sac-events],[data-sac-done]');
    if (a && a.closest('#main')) {
      e.preventDefault();
      if (a.hasAttribute('data-sac-done')) { S.made = null; return paint(); }
      if (a.dataset.sacEvents) return api('GET', `/api/site-gate/codes/${a.dataset.sacEvents}/events`).then((r) => { if (r.ok) S.events = { [a.dataset.sacEvents]: r.d.events || [] }; paint(); });
      // revoking shuts every browser the code opened, so it takes two presses: the first only arms it
      if (S.armRevoke !== a.dataset.sacRevoke) { S.armRevoke = a.dataset.sacRevoke; a.textContent = 'Press again to revoke'; return; }
      S.armRevoke = null; return act('POST', `/api/site-gate/codes/${a.dataset.sacRevoke}/revoke`, {}, () => { toast('Code revoked'); refresh(); });
    }
    const t = e.target.closest('[data-sp-go],[data-sp-unratify],[data-sp-reload],[data-sp-status],[data-sp-publish],[data-sp-ratify],[data-sp-discard],[data-sp-assign-me],[data-sp-task],[data-sp-filter],[data-sp-macro-del]');
    if (!t || !t.closest('#main, #panel')) return;
    e.preventDefault();
    const key = S.one && S.one.key;
    if (t.dataset.spGo !== undefined) return go(t.dataset.spGo || null);
    if (t.hasAttribute('data-sp-reload')) return refresh();
    if (t.dataset.spFilter) { S.filter = t.dataset.spFilter; return refresh(); }
    if (t.dataset.spStatus) return act('POST', `/api/support/tickets/${key}/status`, { status: t.dataset.spStatus });
    // making it public is irreversible for the reader, so it takes two presses: the first only arms it
    if (t.hasAttribute('data-sp-publish')) { if (!S.armPublish) { S.armPublish = true; return paint(); } S.armPublish = false; return act('POST', `/api/support/tickets/${key}/publish`, {}); }
    // sending an agent's draft: it goes into the composer to read and edit, and Send is the ratification
    if (t.dataset.spRatify) { const b = document.querySelector(`[data-sp-draft-body="${CSS.escape(t.dataset.spRatify)}"]`); S.ratify = t.dataset.spRatify; paint(); const ta = document.querySelector('#main [data-sp-form="reply"] textarea'); if (ta) { ta.value = b ? b.textContent : ''; ta.focus(); } return; }
    if (t.hasAttribute('data-sp-unratify')) { S.ratify = null; return paint(); }
    if (t.dataset.spDiscard) return act('POST', `/api/support/tickets/${key}/drafts/${t.dataset.spDiscard}/discard`, {});
    if (t.hasAttribute('data-sp-assign-me')) return P.ready.then((u) => act('POST', `/api/support/tickets/${key}/assign`, { assigneeId: u && u.id }));
    if (t.hasAttribute('data-sp-task')) return act('POST', `/api/support/tickets/${key}/task`, {}, () => { toast('Task raised in XENO Tasks'); refresh(); });
    if (t.dataset.spMacroDel) return act('DELETE', `/api/support/macros/${t.dataset.spMacroDel}`);
  });
  document.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sp-set],[data-sp-macro]');
    if (!s || !s.closest('#main') || !S.one) return;
    if (s.dataset.spMacro !== undefined) { const m = (S.macros || []).find((x) => x.id === s.value); const ta = s.closest('form').querySelector('textarea'); if (m && ta) ta.value = (ta.value ? ta.value + '\n\n' : '') + m.body; s.value = ''; return; }
    const f = s.dataset.spSet;
    if (f === 'status') return act('POST', `/api/support/tickets/${S.one.key}/status`, { status: s.value });
    return act('POST', `/api/support/tickets/${S.one.key}/triage`, { [f]: s.value });
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-sp-form]');
    if (!f || !f.closest('#main')) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries()), kind = f.dataset.spForm, key = S.one && S.one.key;
    if (kind === 'reply' && S.ratify) { const id = S.ratify; S.ratify = null; return act('POST', `/api/support/tickets/${key}/drafts/${id}/send`, { body: v.body }); }
    if (kind === 'reply') return act('POST', `/api/support/tickets/${key}/messages`, { body: v.body, internal: v.internal === 'on' });
    if (kind === 'merge') return act('POST', `/api/support/tickets/${key}/merge`, { into: String(v.into || '').toUpperCase() });
    if (kind === 'delegate') return act('POST', `/api/support/tickets/${key}/assign`, { delegateAgentId: String(v.agent || '').trim() || null });
  });

  window.XENO_SUPPORT = { served: true, route, label, open: (item) => go(item || null), state: () => ({ staff: S.staff, mine: Array.isArray(S.mine) ? S.mine.length : null, one: S.one && S.one.key }) };
})();
