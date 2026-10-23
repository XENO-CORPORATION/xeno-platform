/* platform-mail.js — on the platform, Office › Mail is a front-end to XENO Mail, for real.
 *
 * The picture's Mail area listed three sample threads ("Contract draft — legal", …). Here the area reads and writes
 * /api/mail (routes/mailRoutes.js → services/xenoMail.js), which calls XENO Mail server-to-server as you. The workspace
 * never holds a mail password, and no mail is stored on the platform.
 *
 * Addresses (id-based, parent in the path — /workspace/office/spaces/mail/<item>):
 *   inbox · starred · sent · drafts · archive · spam · bin         a folder (the header tabs)
 *   <folder>/<thread id>                                           a thread, inside the folder it was opened from
 *   label/<label id>  ·  label/<label id>/<thread id>               a label (by id, never by name) and a thread in it
 *   drafts/<draft id>                                              a draft (an agent's shows who wrote it)
 *   mailbox                                                        which of your addresses this workspace uses
 *
 * Compose and reply open the workspace dialog. Send asks once more ("this cannot be recalled") before anything
 * leaves — mail reaches a stranger. An agent never sends: its drafts wait here for you.
 *
 * It registers XENO_ZONE_LIVE['office.mail'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const FOLDERS = [['inbox', 'Inbox', 'inbox'], ['starred', 'Starred', 'starred'], ['sent', 'Sent', 'sent'], ['drafts', 'Drafts', 'draft'], ['archive', 'Archive', 'archive'], ['spam', 'Spam', 'spam'], ['bin', 'Bin', 'bin']];
  const S = { status: 'idle', ws: undefined, info: null, labels: [], list: { key: null, threads: [], drafts: [] }, q: '', thread: null, threadKey: null, draft: null, draftKey: null, error: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'mail'; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const itemNow = () => String((X()?.S || {}).item || 'inbox');
  const goItem = (item) => X()?.go?.('zone', { zone: 'mail', item });
  const enc = (id) => encodeURIComponent(String(id));   // for /api paths only: the router encodes an address itself
  const dec = (s) => { try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); } };
  const when = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const who = (f) => (f && (f.name || f.email)) || 'Unknown sender';
  const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

  /** The address → what it shows: { view: folder|label|thread|draft|mailbox, folder, labelId, threadId, draftId } */
  function parse(item) {
    const [a, b, c] = String(item || 'inbox').split('/');
    if (a === 'mailbox') return { view: 'mailbox' };
    if (a === 'label' && b) return c ? { view: 'thread', labelId: dec(b), threadId: dec(c), parent: `label/${dec(b)}` } : { view: 'label', labelId: dec(b) };
    if (a === 'drafts' && b) return { view: 'draft', folder: 'drafts', draftId: dec(b) };
    const f = FOLDERS.find((x) => x[0] === a) ? a : 'inbox';
    return b ? { view: 'thread', folder: f, threadId: dec(b), parent: f } : { view: 'folder', folder: f };
  }
  const listKey = (v) => (v.labelId ? `label/${v.labelId}` : v.folder || 'inbox');

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null; S.list = { key: null, threads: [], drafts: [] }; S.thread = null; S.threadKey = null; S.draft = null; S.draftKey = null;
    const st = await api('GET', '/api/mail/status' + q()).catch(() => null);
    if (!st || !st.ok) { S.status = 'error'; S.error = said(st, 'Mail could not be reached.'); return paint(); }
    S.info = st.d;
    if (S.info.configured && S.info.connected) { const lb = await api('GET', '/api/mail/labels' + q()).catch(() => null); S.labels = (lb && lb.ok && lb.d.labels) || []; navOf(); }
    S.status = 'ready'; paint();
  }
  async function loadList(v) {
    const key = listKey(v); S.list = { key, loading: true, threads: [], drafts: [] };
    if (v.folder === 'drafts') {
      const r = await api('GET', '/api/mail/drafts' + q()).catch(() => null);
      S.list = { key, threads: [], drafts: r && r.ok ? r.d.drafts : [], error: r && r.ok ? null : said(r, 'Drafts could not be read.') };
    } else {
      const folder = (FOLDERS.find((x) => x[0] === v.folder) || FOLDERS[0])[2];
      const r = await api('GET', '/api/mail/threads' + q(v.labelId ? { labelId: v.labelId, q: S.q } : { folder, q: S.q })).catch(() => null);
      S.list = { key, threads: r && r.ok ? r.d.threads : [], drafts: [], error: r && r.ok ? null : said(r, 'XENO Mail did not answer.') };
    }
    paint();
  }
  async function loadThread(id) {
    S.threadKey = id; S.thread = null;
    const r = await api('GET', `/api/mail/threads/${enc(id)}` + q()).catch(() => null);
    S.thread = r && r.ok ? r.d.thread : { error: said(r, 'That thread could not be opened.') };
    // opening a thread marks it read (Gmail, Outlook); "Mark unread" puts it back
    if (S.thread && !S.thread.error && S.thread.unread) api('POST', '/api/mail/threads/read' + q(), withWs({ threadIds: [id] })).then(() => { const t = S.list.threads.find((x) => x.thread_id === id); if (t) t.unread = false; });
    paint();
  }
  async function loadDraft(id) {
    S.draftKey = id; S.draft = null;
    const r = await api('GET', `/api/mail/drafts/${enc(id)}` + q()).catch(() => null);
    S.draft = r && r.ok ? r.d.draft : { error: said(r, 'That draft could not be opened.') }; paint();
  }
  function navOf() {
    const N = window.XENO_PRODUCT_NAV && window.XENO_PRODUCT_NAV.mail; if (!N) return;
    N.sections = S.labels.length ? [['Labels', S.labels.map((l) => [l.name, ''])]] : [];
  }
  if (window.XENO_PRODUCT_NAV && window.XENO_PRODUCT_NAV.mail) window.XENO_PRODUCT_NAV.mail.sections = [];   // never the picture's labels
  // the area is real now: Mail is not a "planned" product here, and the sidebar's primary action is Compose
  if (window.XENO_PRODUCTS && window.XENO_PRODUCTS.mail) delete window.XENO_PRODUCTS.mail.status;
  for (const z of ((window.XENO_MODE_ZONES || {}).office || [])) if (z.id === 'mail') { z.action = 'Compose'; z.work = null; }

  const labelName = (id) => (S.labels.find((l) => l.id === id) || {}).name || 'Label';
  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['office.mail'] = {
    served: true,
    items: true,
    label: (item) => {
      const v = parse(item);
      if (v.view === 'mailbox') return 'Mailbox';
      if (v.view === 'label') return labelName(v.labelId);
      if (v.view === 'thread') { const t = S.thread && !S.thread.error && S.threadKey === v.threadId ? S.thread : null; const subj = (t && t.messages && t.messages[0] && t.messages[0].subject) || 'Thread'; return `${v.labelId ? labelName(v.labelId) : (FOLDERS.find((x) => x[0] === v.folder) || FOLDERS[0])[1]} / ${subj}`; }
      if (v.view === 'draft') return `Drafts / ${(S.draft && !S.draft.error && S.draft.subject) || 'Draft'}`;
      return (FOLDERS.find((x) => x[0] === v.folder) || FOLDERS[0])[1];
    },
    work: () => (S.status === 'ready' && S.info && S.info.connected && S.list.key === 'inbox' && S.list.threads.length ? ['Inbox', S.list.threads.slice(0, 6).map((t) => [t.subject || '(no subject)', when(t.received_at), null, 'inbox/' + t.thread_id])] : null),
    badge: () => (S.info && S.info.agentDrafts ? S.info.agentDrafts : (S.list.key === 'inbox' ? (S.list.threads.filter((t) => t.unread).length || null) : null)),
    page: () => page(),
    state: () => ({ status: S.status, configured: !!(S.info && S.info.configured), connected: !!(S.info && S.info.connected), mailbox: S.info && S.info.mailbox, mapped: S.info && S.info.mappedAddress, item: itemNow(), threads: S.list.threads.length, drafts: S.list.drafts.length }),
    reload: () => load(),
  };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page() {
    const h = window.XENO_PAGES.h, v = parse(itemNow());
    const connected = S.info && S.info.configured && S.info.connected;
    // the page's one header: folders are tabs in the header bar, Compose sits right in it; composing opens the dialog
    let acts = '';
    if (connected && v.view === 'thread') acts = h.btn('Archive', 'data-ml-archive', true, 'archive') + h.btn('Reply', 'data-ml-reply', false, 'mail');
    else if (connected) acts = h.btn('Mailbox', 'data-ml-go="mailbox"', true, 'gear') + h.btn('Compose', 'data-ml-new', false, 'plus');
    const sub = connected ? `Your XENO Mail at ${S.info.mailbox || 'your address'}. Agents read and draft; only you send.` : 'Your XENO Mail, in the workspace.';
    const cur = v.view === 'label' || v.labelId ? null : (v.folder || (v.view === 'mailbox' ? null : 'inbox'));
    const head = h.head({ title: 'Mail', sub, acts }) + (connected ? h.tabs(FOLDERS.map(([k, l]) => [k, l, k === 'drafts' && S.info.agentDrafts ? S.info.agentDrafts : '']), cur, 'data-ml-go') : '');
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm ml" data-ml-page="${esc(S.status)}" data-ml-view="${esc(v.view)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-ml-error>${esc(S.error)} ${btn('data-ml-reload', 'Try again')}</div>`);
    if (!S.info.configured) return wrap('<div class="pj-empty" data-ml-state="not-configured">Mail is not set up on this server yet.</div>');
    if (!S.info.connected) return wrap(`<div class="pj-empty" data-ml-state="no-mailbox"><b>${S.info.mappedAddress ? `This workspace uses ${esc(S.info.mappedAddress)}, which XENO Mail does not find.` : 'You do not have a XENO Mail mailbox yet.'}</b> Sign in to XENO Mail once to create your address; it then shows here. ${S.info.reason ? `<small>${esc(S.info.reason)}</small>` : ''}${S.info.mappedAddress ? ' ' + btn('data-ml-unmap', 'Use my default mailbox') : ''}</div>`);
    if (v.view === 'mailbox') return wrap(mailboxPage());
    if (v.view === 'thread') return wrap(threadPage(v));
    if (v.view === 'draft') return wrap(draftPage(v));
    return wrap(listPage(v));
  }
  function listPage(v) {
    const key = listKey(v);
    if (S.list.key !== key) { loadList(v); return '<div class="pj-empty">Loading…</div>'; }
    if (S.list.loading) return '<div class="pj-empty">Loading…</div>';
    if (S.list.error) return `<div class="pj-empty" data-ml-error>${esc(S.list.error)}</div>`;
    const labels = S.labels.length ? `<select class="in" data-ml-label-go aria-label="Show a label"><option value="">Labels…</option>${S.labels.map((l) => `<option value="${esc(l.id)}"${v.labelId === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : '';
    const title = v.labelId ? `<h2 class="ml-h">${esc(labelName(v.labelId))}</h2>` : '';
    if (v.folder === 'drafts') {
      const rows = S.list.drafts.map((d) => `<li class="ml-row${d.byAgent ? ' ml-agent' : ''}" data-ml-draft-row="${esc(d.draft_id)}"><button class="ml-open" data-ml-draft="${esc(d.draft_id)}"><b>${esc((d.to || []).join(', ') || '(no recipient)')}</b> <span>${esc(d.subject || '(no subject)')}</span>${d.byAgent ? `<small data-ml-by-agent>Drafted by ${esc(d.byAgent.name || 'an agent')} — review and send</small>` : ''}</button><small>${esc(when(d.updated_at))}</small></li>`).join('');
      return `<ul class="ml-list" data-ml-list>${rows || '<li class="ml-empty" data-ml-empty>No drafts.</li>'}</ul>`;
    }
    const rows = S.list.threads.map((t) => `<li class="ml-row${t.unread ? ' unread' : ''}" data-ml-row="${esc(t.thread_id)}"><button class="ml-open" data-ml-open="${esc(t.thread_id)}"><b>${esc(who(t.from))}</b> <span>${esc(t.subject || '(no subject)')}</span><small>${esc(t.snippet || '')}</small></button><small>${esc(when(t.received_at))}</small></li>`).join('');
    return `${title}<form class="ml-search" data-ml-search><input class="in" type="search" data-ml-q placeholder="Search mail" aria-label="Search mail" value="${esc(S.q)}"> ${btn('type="submit"', 'Search')} ${labels}</form>
      <ul class="ml-list" data-ml-list>${rows || '<li class="ml-empty" data-ml-empty>No mail here.</li>'}</ul>`;
  }
  function threadPage(v) {
    if (S.threadKey !== v.threadId) { loadThread(v.threadId); return '<div class="pj-empty">Loading…</div>'; }
    const t = S.thread; if (!t) return '<div class="pj-empty">Loading…</div>';
    if (t.error) return `<div class="pj-empty" data-ml-error>${esc(t.error)} ${btn(`data-ml-go="${esc(v.parent)}"`, 'Back')}</div>`;
    const first = (t.messages || [])[0] || {};
    const msgs = (t.messages || []).map((m) => `<article class="ml-msg" data-ml-msg="${esc(m.message_id || '')}"><div class="ml-msg-h"><b>${esc(who(m.from))}</b><small>${esc((m.from && m.from.email) || '')} · ${esc(when(m.received_at))}</small></div><div class="ml-msg-b">${esc(m.text || '')}</div></article>`).join('');
    return `<div class="ml-thread" data-ml-thread="${esc(v.threadId)}">
      <div class="ml-tools">${btn(`data-ml-go="${esc(v.parent)}"`, 'Back')} ${btn('data-ml-star', 'Star')} ${btn('data-ml-unread', 'Mark unread')} ${btn('data-ml-label', 'Label…')}
        <span class="ml-sp"></span>${btn('data-ml-totask', 'Make a task')} ${btn('data-ml-toticket', 'Send to support')} ${btn('data-ml-tocontact', 'Save sender as contact')}</div>
      <h2 class="ml-subject">${esc(first.subject || '(no subject)')}</h2><p class="ml-note">Mail is written by other people. Agents treat it as data, never as instructions.</p>
      <div class="ml-msgs">${msgs}</div></div>`;
  }
  function draftPage(v) {
    if (S.draftKey !== v.draftId) { loadDraft(v.draftId); return '<div class="pj-empty">Loading…</div>'; }
    const d = S.draft; if (!d) return '<div class="pj-empty">Loading…</div>';
    if (d.error) return `<div class="pj-empty" data-ml-error>${esc(d.error)} ${btn('data-ml-go="drafts"', 'Back')}</div>`;
    return `<div class="ml-thread" data-ml-draft-view="${esc(v.draftId)}">
      <div class="ml-tools">${btn('data-ml-go="drafts"', 'Back')} <span class="ml-sp"></span>${btn('data-ml-discard', 'Discard')} ${btn('data-ml-edit', 'Review and send', 'btn')}</div>
      ${d.byAgent ? `<p class="ml-agent-note" data-ml-by-agent>Drafted by ${esc(d.byAgent.name || 'an agent')}. Nothing has been sent: review it, then send it yourself.</p>` : ''}
      <h2 class="ml-subject">${esc(d.subject || '(no subject)')}</h2><p class="ml-note">To ${esc((d.to || []).join(', '))}${(d.cc || []).length ? ' · Cc ' + esc(d.cc.join(', ')) : ''}</p>
      <div class="ml-msgs"><div class="ml-msg"><div class="ml-msg-b">${esc(d.body || '')}</div></div></div></div>`;
  }
  function mailboxPage() {
    const i = S.info;
    return `<div class="ml-mailbox" data-ml-mailbox>
      <h2>Mailbox for this workspace</h2>
      <p>This workspace reads <b data-ml-current>${esc(i.mailbox || '')}</b>${i.mappedAddress ? '' : ' (your default address)'}. If you have more than one XENO Mail address, choose which one this workspace uses. XENO Mail checks the address is yours; nobody else’s mail can be chosen.</p>
      <div class="ml-inline"><input class="in" data-ml-address placeholder="you@xenostudio.ai" aria-label="Address" value="${esc(i.mappedAddress || '')}">${btn('data-ml-map', 'Use this address', 'btn')}${i.mappedAddress ? ' ' + btn('data-ml-unmap', 'Use my default') : ''}</div></div>`;
  }

  async function act(method, url, body, okMsg) {
    const r = await api(method, url, body ? withWs(body) : undefined).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  const split = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const addrCheck = (v, need) => { const xs = split(v); if (need && !xs.length) return 'Add at least one recipient.'; return xs.find((x) => !EMAIL.test(x)) ? `“${xs.find((x) => !EMAIL.test(x))}” is not an email address.` : null; };

  /**
   * Compose, reply or finish a draft — in the workspace dialog. "Send" asks once more before anything leaves, because
   * mail reaches a stranger and cannot be recalled; "Save draft" never sends.
   */
  function composeDialog({ title = 'New message', to = '', cc = '', subject = '', body = '', threadId = null, draftId = null } = {}) {
    let sentNow = false;
    window.XD.form({ title, size: 'md', submit: 'Continue',
      sub: 'Choose Send or Save draft below. Sending asks you once more, because it cannot be recalled.',
      fields: [
        { id: 'to', label: 'To', required: true, value: to, max: 2000, placeholder: 'name@example.com, …', validate: (v) => addrCheck(v, true) },
        { id: 'cc', label: 'Cc', value: cc, max: 2000, validate: (v) => addrCheck(v, false) },
        { id: 'subject', label: 'Subject', value: subject, max: 500 },
        { id: 'body', label: 'Message', type: 'textarea', rows: 10, required: true, value: body, max: 200000 },
        { id: 'how', label: 'Then', type: 'seg', value: 'send', options: [['send', 'Send'], ['draft', 'Save draft']] },
      ],
      onSubmit: async (vals) => {
        const payload = { to: split(vals.to), cc: split(vals.cc), subject: vals.subject, body: vals.body, threadId: threadId || undefined, draftId: draftId || undefined };
        if (vals.how === 'send') {
          const yes = await window.XD.confirm({ title: 'Send this message?', body: `It goes to <b>${esc(payload.to.join(', '))}</b> now and cannot be recalled.`, action: 'Send', danger: false });
          if (!yes) return 'Not sent. Choose Save draft to keep it.';
          const r = await api('POST', '/api/mail/compose' + q(), withWs({ ...payload, send: true, confirm: true })).catch(() => null);
          if (!r || !r.ok) return said(r, 'It was not sent.');
          sentNow = !!r.d.sent; return null;
        }
        const r = await api('POST', '/api/mail/compose' + q(), withWs({ ...payload, send: false })).catch(() => null);
        return r && r.ok ? null : said(r, 'The draft was not saved.');
      },
    }).then((v) => {
      if (!v) return;
      toast(sentNow ? 'Sent' : 'Draft saved');
      S.list.key = null;
      if (sentNow && draftId) load();
      if (draftId) goItem('drafts'); else if (threadId) { S.threadKey = null; paint(); } else paint();
    });
  }
  function labelDialog(threadId) {
    const opts = S.labels.map((l) => [l.id, l.name]);
    window.XD.form({ title: 'Label this thread', size: 'sm', submit: 'Apply',
      fields: [...(opts.length ? [{ id: 'labelId', type: 'choice', label: 'Label', value: opts[0][0], options: [...opts, ['__new', 'New label…']] }] : []), { id: 'name', label: opts.length ? 'New label name' : 'Label name', max: 60, placeholder: 'Only for a new label' }],
      onSubmit: async (v) => {
        let id = v.labelId && v.labelId !== '__new' ? v.labelId : null;
        if (!id) { if (!v.name) return 'Name the new label.'; const c = await api('POST', '/api/mail/labels' + q(), withWs({ name: v.name })).catch(() => null); if (!c || !c.ok) return said(c, 'The label was not created.'); id = c.d.label.id; S.labels.push(c.d.label); navOf(); }
        const r = await api('POST', '/api/mail/threads/label' + q(), withWs({ threadIds: [threadId], add: [id] })).catch(() => null);
        return r && r.ok ? null : said(r, 'The label was not applied.');
      },
    }).then((v) => { if (v) toast('Labelled'); });
  }

  // the sidebar's Compose (and the product view's) is launch.js's generic [data-xl-new]; for Mail it is the compose
  // dialog. Caught on window, which runs before launch.js's document listener.
  window.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-xl-new="mail"]'); if (!b || b.closest('.xd')) return; e.preventDefault(); e.stopImmediatePropagation(); if (S.info && S.info.connected) composeDialog(); else goItem('inbox'); }, true);
  document.addEventListener('submit', (e) => { const f = e.target.closest('[data-ml-search]'); if (!f) return; e.preventDefault(); S.q = (f.querySelector('[data-ml-q]') || {}).value || ''; S.list.key = null; paint(); }, true);
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-ml-label-go]'); if (!s || !s.closest('[data-ml-page]')) return; goItem(s.value ? 'label/' + s.value : 'inbox'); }, true);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-ml-reload],[data-ml-go],[data-ml-open],[data-ml-draft],[data-ml-new],[data-ml-reply],[data-ml-archive],[data-ml-star],[data-ml-unread],[data-ml-label],[data-ml-totask],[data-ml-toticket],[data-ml-tocontact],[data-ml-edit],[data-ml-discard],[data-ml-map],[data-ml-unmap]');
    if (!t || !(t.closest('[data-ml-page]') || t.closest('#main .topbar'))) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset, v = parse(itemNow()), root = document.querySelector('#main [data-ml-page]') || document.body;
    if ('mlReload' in d) return load();
    if (d.mlGo) { if (d.mlGo !== itemNow()) S.q = ''; S.list.key = null; return goItem(d.mlGo); }
    if (d.mlOpen) return goItem(`${v.labelId ? 'label/' + v.labelId : (v.folder || 'inbox')}/${d.mlOpen}`);
    if (d.mlDraft) return goItem('drafts/' + d.mlDraft);
    if ('mlNew' in d) return composeDialog();
    if ('mlMap' in d) { const a = ((root.querySelector('[data-ml-address]') || {}).value || '').trim(); if (!EMAIL.test(a)) return toast('Enter one of your XENO Mail addresses'); if (await act('PUT', '/api/mail/mailbox' + q(), { address: a }, `This workspace now uses ${a}`)) load(); return; }
    if ('mlUnmap' in d) { if (await act('DELETE', '/api/mail/mailbox' + q(), null, 'This workspace uses your default mailbox')) load(); return; }
    if (v.view === 'draft' && S.draft && !S.draft.error) {
      const dr = S.draft;
      if ('mlEdit' in d) return composeDialog({ title: 'Review and send', to: (dr.to || []).join(', '), cc: (dr.cc || []).join(', '), subject: dr.subject || '', body: dr.body || '', draftId: dr.draft_id || v.draftId });
      if ('mlDiscard' in d) { if (!(await window.XD.confirm({ title: 'Discard this draft?', body: 'It is deleted from XENO Mail and cannot be brought back.', action: 'Discard' }))) return; if (await act('DELETE', `/api/mail/drafts/${enc(v.draftId)}` + q(), null, 'Draft discarded')) { S.list.key = null; if (dr.byAgent && S.info.agentDrafts) S.info.agentDrafts -= 1; goItem('drafts'); } return; }
    }
    if (v.view !== 'thread' || !S.thread || S.thread.error) return;
    const id = v.threadId, idE = enc(id);
    if ('mlReply' in d) { const m = (S.thread.messages || []).slice(-1)[0] || {}; const subj = m.subject || ''; return composeDialog({ title: 'Reply', to: (m.from && m.from.email) || '', subject: /^re:/i.test(subj) ? subj : 'Re: ' + subj, threadId: id }); }
    if ('mlArchive' in d) { if (await act('POST', '/api/mail/threads/archive' + q(), { threadIds: [id] }, 'Archived')) { S.list.key = null; goItem(v.parent); } return; }
    if ('mlStar' in d) { await act('POST', '/api/mail/threads/star' + q(), { threadIds: [id], starred: true }, 'Starred'); return; }
    if ('mlUnread' in d) { if (await act('POST', '/api/mail/threads/read' + q(), { threadIds: [id], unread: true }, 'Marked unread')) { S.list.key = null; goItem(v.parent); } return; }
    if ('mlLabel' in d) return labelDialog(id);
    if ('mlTotask' in d) { const r = await act('POST', `/api/mail/threads/${idE}/task` + q(), {}); if (r && r.task) toast(`Task ${r.task.key || ''} created`); return; }
    if ('mlToticket' in d) { const r = await act('POST', `/api/mail/threads/${idE}/ticket` + q(), { kind: 'other' }); if (r && r.ticket) toast(`Support request ${r.ticket.key || ''} opened`); return; }
    if ('mlTocontact' in d) { const r = await act('POST', `/api/mail/threads/${idE}/contact` + q(), {}); if (r && r.contact) toast(`${r.contact.email} ${r.created === false ? 'is already a contact — mail added to the timeline' : 'saved as a contact'}`); }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
