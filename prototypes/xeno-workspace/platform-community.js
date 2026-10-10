/* platform-community.js — on the platform, Community is the real XENO Forum.
 *
 * The picture ships sample threads ("How do I export a Canvas frame as SVG…", "Showcase: a full music video…"),
 * sample replies, sample tickets (#1031, #1038), a sample moderation log and votes kept in the browser, and it
 * shows a reply from a "workspace-dev" agent that writes itself 2.5 seconds after a report. Served by the platform
 * all of that was shown as real. Here every part reads and writes /api/forum:
 *
 *   list          GET /threads                       open thread  GET /threads/:shortId
 *   reply         POST /threads/:id/posts            new thread   POST /threads (+ POST /dedup-check first)
 *   helpful       POST /posts/:id/vote               report       POST /posts|threads/:id/flag
 *   answer        POST /posts/:id/accept             follow       PUT /threads/:id/subscription
 *   report window POST /report/preflight, POST /report (public → a Feedback thread, private → a ticket)
 *   my reports    GET /tickets/mine, GET /tickets/:id, POST …/posts, POST …/publish, POST …/status (close)
 *   moderation    GET /me (may I), GET /flags, POST /flags/:id/resolve, POST /moderation/actions,
 *                 GET /moderation-log (public)
 *
 * The picture's own Community module (community.js) stays for the file:// prototype; here its routes and actions
 * are taken over, so nothing it keeps in the browser is ever shown as the person's.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_COMM_LIVE = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k), toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const nameOf = (a) => (a && (a.displayName || a.handle)) || (a && a.kind === 'agent' ? 'An agent' : 'Someone');
  const author = (a) => ({ name: nameOf(a), kind: a && a.kind === 'agent' ? 'agent' : 'human' });
  const STATE = { open: 'Open', resolved: 'Resolved', duplicate: 'Duplicate', locked: 'Locked', archived: 'Archived', answered: 'Answered' };
  const TSTEPS = [['open', 'Received'], ['acknowledged', 'Looked at'], ['planned', 'Planned'], ['fixed', 'Fixed']];
  const C = { status: 'loading', threads: [], detail: new Map(), me: null, tickets: null, ticket: new Map(), flags: null, log: null, version: 0 };
  window.XENO_PG_FORUM = [];
  const repaint = () => { C.version++; try { if (X()?.S?.view === 'global' && X().S.global === 'community') X().render(); } catch {} };
  const fresh = (kind) => C[kind] === null;

  const shapeThread = (t) => ({ id: t.shortId, title: t.title, space: (t.space && t.space.name) || 'Community', spaceSlug: t.space && t.space.slug, author: author(t.author),
    replies: Math.max(0, (t.postCount || 1) - 1), state: t.isResolved && t.status === 'open' ? 'answered' : t.status, lastActivityAt: t.lastActivityAt || t.createdAt, tags: t.tags || [], score: t.score || 0, live: true });
  async function loadList() {
    const r = await api('GET', '/api/forum/threads?sort=active&limit=100').catch(() => null);
    if (r && r.ok && Array.isArray(r.d.threads)) { C.threads = r.d.threads.map(shapeThread); window.XENO_PG_FORUM = C.threads; C.status = 'ready'; }
    else { C.threads = []; window.XENO_PG_FORUM = []; C.status = 'error'; }
    repaint();
  }
  async function loadThread(id) {
    const r = await api('GET', '/api/forum/threads/' + encodeURIComponent(id)).catch(() => null);
    if (r && r.ok && r.d.thread) { const t = r.d.thread, posts = t.posts || [];
      C.detail.set(id, { ...shapeThread(t), body: posts[0] ? posts[0].body : '', opId: posts[0] ? posts[0].id : null, subscribed: !!t.subscribed, duplicateOf: t.duplicateOf || null,
        posts: posts.slice(1).map((p) => ({ id: p.id, author: author(p.author), body: p.body, at: p.createdAt, answer: p.isAnswer, score: p.score, advisory: p.advisoryCount, mine: P.user && p.author && p.author.handle === P.user.username })) });
    } else C.detail.set(id, { missing: true, error: r && r.status !== 404 });
    repaint();
  }
  async function loadMe() { const r = await api('GET', '/api/forum/me').catch(() => null); C.me = r && r.ok ? r.d : { capabilities: {}, actor: {} }; repaint(); }
  const mod = () => !!(C.me && C.me.capabilities && C.me.capabilities.review_flags);
  async function loadTickets() { const r = await api('GET', '/api/forum/tickets/mine').catch(() => null); C.tickets = r && r.ok ? r.d.tickets : 'error'; repaint(); }
  async function loadTicket(id) { const r = await api('GET', '/api/forum/tickets/' + encodeURIComponent(id)).catch(() => null); C.ticket.set(id, r && r.ok ? r.d.ticket : { missing: true }); repaint(); }
  async function loadModeration() {
    const [f, l] = await Promise.all([mod() ? api('GET', '/api/forum/flags').catch(() => null) : Promise.resolve(null), api('GET', '/api/forum/moderation-log').catch(() => null)]);
    C.flags = f && f.ok ? f.d.flags || [] : []; C.log = l && l.ok ? l.d.log || [] : 'error'; repaint();
  }

  // ---------- pages ----------
  const loadingPage = (title) => H().page(H().head({ eyebrow: '<a data-go="community">Community</a>', title }) + `<p class="pg-dim" data-cm-state="loading">Loading…</p>`);
  const missingPage = (title, what) => H().page(H().head({ eyebrow: '<a data-go="community">Community</a>', title }) + `<p class="pg-dim" data-cm-state="missing">${what}</p>`);
  function threadPage(id) {
    const t = C.detail.get(id);
    if (!t) { loadThread(id); return loadingPage('Loading the thread'); }
    if (t.missing) return missingPage('Thread not found', t.error ? 'The thread couldn’t be loaded. Try again in a moment.' : 'It may have been removed, or the link is wrong.');
    const h = H(), mine = P.user && t.author.name && C.threads.find((x) => x.id === id)?.author?.name === nameOf({ displayName: P.user.display_name, handle: P.user.username }), locked = t.state === 'locked';
    const acts = h.btn(t.subscribed ? 'Following' : 'Follow', `data-cml="follow" data-arg="${esc(id)}" aria-pressed="${t.subscribed}"`, true, t.subscribed ? 'check' : 'bell') + h.btn('Copy link', `data-xa="copyThreadLink" data-arg="${esc(id)}"`, true, 'link') + h.btn('Report', `data-cml="flag" data-arg="${esc(id)}|"`, true, 'flag') + (mod() ? h.btn('Moderate', `data-cml="mod" data-arg="${esc(id)}"`, true, 'gear') : '');
    const post = (p) => `<article class="pg-post${p.answer ? ' answer' : ''}" id="post-${esc(p.id)}" data-cm-post="${esc(p.id)}">${h.avatar(p.author)}<div><header><b>${esc(p.author.name)}</b>${p.author.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}<small>${h.ago(p.at)} ago</small>${p.answer ? h.chip('Answer') : ''}</header><p>${esc(p.body)}</p>
      <div class="cm-acts"><button class="cm-vote" data-cml="vote" data-arg="${esc(p.id)}"${p.mine ? ' disabled title="You can’t vote on your own reply"' : ''}>${ic('check')}<span>Helpful</span><b>${Math.max(0, p.score || 0)}</b></button>${p.advisory ? `<span class="cm-agents" title="Agents can surface a reply, never rank it">${p.advisory} agent${p.advisory > 1 ? 's' : ''} found this relevant</span>` : ''}
      ${mine && !p.answer && !locked ? `<button class="pg-link" data-cml="answer" data-arg="${esc(p.id)}|${esc(id)}">Mark as the answer</button>` : ''}<button class="pg-link" data-cml="flag" data-arg="${esc(id)}|${esc(p.id)}">Report</button>${mod() ? `<button class="pg-link" data-cml="hide" data-arg="${esc(p.id)}|${esc(id)}">Hide</button>` : ''}</div></div></article>`;
    return h.page(h.head({ obj: true, eyebrow: `<a data-go="community">Community</a> · ${esc(t.space)}`, title: t.title, sub: `${t.author.name}${t.author.kind === 'agent' ? ' (agent)' : ''} · ${STATE[t.state] || h.cap(t.state)} · ${h.plural(t.posts.length, 'reply', 'replies')}`, acts })
      + (t.duplicateOf ? `<p class="cm-banner" data-cm-dup>${ic('link')}<span>This is a duplicate. The answer is in <a data-cml="open" data-arg="${esc(t.duplicateOf.shortId)}">${esc(t.duplicateOf.title)}</a>.</span></p>` : '')
      + `<div class="pg-thread">${t.body ? `<article class="pg-post op">${h.avatar(t.author)}<div><header><b>${esc(t.author.name)}</b><small>${h.ago(t.lastActivityAt)} ago</small></header><p>${esc(t.body)}</p></div></article>` : ''}
        ${t.posts.map(post).join('') || '<p class="pg-dim">No replies yet — the first one helps most.</p>'}
        ${locked ? '<p class="cm-banner" data-cm-locked>' + ic('lock') + '<span>Locked by a moderator — the thread stays readable, no new replies.</span></p>' : `<form class="pg-reply" data-cm-reply="${esc(id)}"><textarea rows="3" placeholder="Write a reply" aria-label="Reply"></textarea><div><span class="pg-dim">Replies are public and permanent.</span><button class="pg-btn" type="submit">${ic('send')}<span>Reply</span></button></div></form>`}</div>`
      + h.foot('community:thread', `GET /api/forum/threads/${esc(id)}`));
  }
  function myReports() {
    if (fresh('tickets')) { loadTickets(); return loadingPage('My reports'); }
    const h = H(), T = Array.isArray(C.tickets) ? C.tickets : [];
    const mine = C.threads.filter((t) => t.tags.some((g) => /^kind:/.test(g)) && P.user && t.author.name === nameOf({ displayName: P.user.display_name, handle: P.user.username }));
    return h.page(h.head({ eyebrow: '<a data-go="community">Community</a>', title: 'My reports', sub: 'Every problem and idea you sent — what happened to it, and the version it was fixed in.', acts: h.btn('Report a problem', 'data-xa="report"', false, 'plus') })
      + `<section class="pg-sec"><h3>Private tickets</h3><p class="pg-dim wf-note">Only you, the XENO team and that product’s developer agent can read these.</p>${C.tickets === 'error' ? '<p class="pg-dim" data-cm-state="error">Your tickets couldn’t be loaded.</p>' : `<ul class="mk-owns">${T.map((t) => `<li class="mk-own" data-cm-ticket="${esc(t.shortId)}"><span class="pg-thumb pg-thumb--ic sq">${ic(t.kind === 'feature' ? 'megaphone' : t.kind === 'feedback' ? 'chat' : 'edit')}</span><span class="mk-own-m"><a data-cml="ticket" data-arg="${esc(t.shortId)}"><b>${esc(t.title)}</b></a><small>${esc(h.cap(t.kind))} · ${esc(t.product)}${t.fixedIn ? ' · fixed in ' + esc(t.fixedIn) : ''}</small></span>${h.chip(t.statusLabel)}</li>`).join('') || '<li class="pg-dim">No private tickets.</li>'}</ul>`}</section>
      <section class="pg-sec"><h3>Posted in Community</h3><ul class="mk-owns">${mine.map((t) => `<li class="mk-own"><span class="mk-own-m"><a data-cml="open" data-arg="${esc(t.id)}"><b>${esc(t.title)}</b></a><small>${esc(t.space)}</small></span>${h.chip(STATE[t.state] || t.state)}</li>`).join('') || '<li class="pg-dim">Nothing posted publicly.</li>'}</ul></section>`
      + h.foot('community', 'GET /api/forum/tickets/mine'));
  }
  function ticketPage(id) {
    const t = C.ticket.get(id);
    if (!t) { loadTicket(id); return loadingPage('Loading the ticket'); }
    if (t.missing) return missingPage('Ticket not found', 'It may belong to someone else, or the link is wrong.');
    const h = H(), idx = TSTEPS.findIndex((x) => x[0] === t.status), closed = t.status === 'closed';
    const acts = (t.thread ? h.btn('Open public thread', `data-cml="open" data-arg="${esc(t.thread.shortId)}"`, true, 'link') : h.btn('Make public', `data-cml="publish" data-arg="${esc(id)}"`, true, 'community')) + (closed ? '' : h.btn('Close', `data-cml="close" data-arg="${esc(id)}"`, true, 'x'));
    return h.page(h.head({ obj: true, eyebrow: '<a data-go="community">Community</a> · <a data-cml="mine">My reports</a>', title: t.title, sub: `Private ticket · ${h.cap(t.kind)} · ${esc(t.product)} · ${esc(t.statusLabel)}`, acts })
      + `<ol class="cm-steps">${TSTEPS.map(([k, l], i) => `<li class="${i < idx || (closed && i < 1) ? 'done' : i === idx ? 'on' : ''}"><i></i><span>${l}</span></li>`).join('')}</ol>`
      + (t.fixedIn ? `<p class="cm-banner" data-cm-fixed>${ic('check')}<span><b>Fixed in ${esc(t.fixedIn)}.</b> Update to get it — or tell us here if it’s still happening.</span></p>` : '')
      + `<div class="pg-thread"><article class="pg-post op"><div><header><b>You</b><small>${h.ago(t.createdAt)} ago</small></header><p>${esc(t.body || t.title)}</p></div></article>${(t.posts || []).map((p) => `<article class="pg-post${p.author.reporter ? '' : ' answer'}${p.kind === 'status' ? ' cm-status' : ''}"><div><header><b>${esc(p.author.reporter ? 'You' : p.author.name || 'XENO')}</b>${p.author.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}<small>${h.ago(p.createdAt)} ago</small></header><p>${esc(p.body)}</p></div></article>`).join('')}
        ${closed ? '<p class="cm-banner">' + ic('check') + '<span>This ticket is closed.</span></p>' : `<form class="pg-reply" data-cm-ticket-reply="${esc(id)}"><textarea rows="3" placeholder="Add to this ticket" aria-label="Reply"></textarea><div><span class="pg-dim">Only you, the XENO team and the product’s developer agent see this.</span><button class="pg-btn" type="submit">${ic('send')}<span>Send</span></button></div></form>`}</div>`
      + h.foot('community', `GET /api/forum/tickets/${esc(id)}`));
  }
  function moderation() {
    if (!C.me) { loadMe(); return loadingPage('Moderation'); }
    if (fresh('log')) { loadModeration(); return loadingPage('Moderation'); }
    const h = H(), R = { spam: 'Spam', abuse: 'Harmful', off_topic: 'Off-topic', duplicate: 'Duplicate', low_quality: 'Low quality', other: 'Other' };
    const q = (C.flags || []).map((f) => `<li class="cm-q" data-cm-flag="${esc(f.id)}"><div class="mk-row"><b>${f.thread ? `<a data-cml="open" data-arg="${esc(f.thread.shortId)}">${esc(f.thread.title)}</a>` : 'A thread'}</b>${h.chip(R[f.reason] || f.reason)}<span class="pg-dim">${f.target.type === 'post' ? 'a reply' : 'the thread'}</span></div>${f.excerpt ? `<blockquote>${esc(f.excerpt)}</blockquote>` : ''}${f.detail ? `<p class="pg-dim">“${esc(f.detail)}”</p>` : ''}
      <div class="fd-acts">${h.btn('Keep', `data-cml="resolve" data-arg="${esc(f.id)}|dismiss"`, true)}${f.target.type === 'post' ? h.btn('Hide reply', `data-cml="resolve" data-arg="${esc(f.id)}|hide"`, true) : h.btn('Lock thread', `data-cml="resolve" data-arg="${esc(f.id)}|lock"`, true)}</div></li>`).join('');
    const OUT = { hidden: 'Hid a reply in', restored: 'Restored a reply in', locked: 'Locked', unlocked: 'Unlocked', duplicate: 'Marked as a duplicate:' };
    const L = Array.isArray(C.log) ? C.log : [];
    return h.page(h.head({ eyebrow: '<a data-go="community">Community</a>', title: 'Moderation', sub: 'Reports waiting for review, and every action moderators took — in public.' })
      + `<section class="pg-sec"><h3>Waiting for review</h3>${mod() ? `<ul class="mk-sls">${q || '<li class="pg-dim" data-cm-state="empty-queue">Nothing waiting. Reports from people and agents land here.</li>'}</ul>` : '<p class="pg-dim">Moderators review reports here.</p>'}<p class="pg-dim wf-note">Agents can report a post for review — never remove one.</p></section>
      <section class="pg-sec" id="cm-log"><h3>Moderation log</h3>${C.log === 'error' ? '<p class="pg-dim">The log couldn’t be loaded.</p>' : `<ul class="mk-rcl cm-log" data-cm-log>${L.map((x) => `<li><span>${new Date(x.at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span><span>${esc(OUT[x.outcome] || x.outcome)} ${x.thread ? `“${esc(x.thread.title)}”` : ''}${x.duplicateOf ? ` → “${esc(x.duplicateOf.title)}”` : ''}${x.reason ? ' — ' + esc((R[x.reason] || x.reason).toLowerCase()) : ''}</span><b>${esc(x.moderator)}</b></li>`).join('') || '<li class="pg-dim" data-cm-state="empty-log">No moderation actions yet.</li>'}</ul>`}</section>`
      + h.foot('community', 'GET /api/forum/moderation-log'));
  }
  function route(it) {
    if (C.status === 'loading' && !it) return null;
    if (it === 'Moderation') return moderation();
    if (it === 'My reports') return myReports();
    if (it && it.startsWith('My reports/')) return ticketPage(it.slice(11));
    if (it && /^[a-z0-9]{4,12}$/.test(it)) return threadPage(it);
    return null;
  }

  // ---------- actions ----------
  const go = (item) => X().go('global', { global: 'community', item });
  const afterThread = async (id) => { await loadThread(id); loadList(); };
  const ACT = {
    open: (id) => go(id), mine: () => go('My reports'), ticket: (id) => go('My reports/' + id),
    async follow(id) { const t = C.detail.get(id); if (!t) return; const on = !t.subscribed; const r = await api('PUT', `/api/forum/threads/${encodeURIComponent(id)}/subscription`, { subscribed: on }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be changed.')); t.subscribed = on; repaint(); toast(on ? 'Following — replies come to your notifications' : 'No longer following'); },
    async vote(pid) { const r = await api('POST', `/api/forum/posts/${encodeURIComponent(pid)}/vote`, { value: 1 }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be counted.')); const t = [...C.detail.values()].find((x) => x.posts && x.posts.some((p) => p.id === pid)); if (t) await loadThread(t.id); toast('Marked helpful'); },
    async answer(arg) { const [pid, id] = arg.split('|'); const r = await api('POST', `/api/forum/posts/${encodeURIComponent(pid)}/accept`).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be marked.')); await afterThread(id); toast('Marked as the answer'); },
    async flag(arg) { const [id, pid] = arg.split('|');
      const v = await D().form({ title: pid ? 'Report this reply' : 'Report this thread', sub: 'Goes to the moderators for review. The author isn’t told who reported it.', submit: 'Send report', size: 'sm', fields: [
        { id: 'w', label: 'Why', type: 'choice', cols: 1, required: true, options: [['spam', 'Spam or advertising'], ['abuse', 'Harmful, hateful or harassing'], ['off_topic', 'Off-topic'], ['duplicate', 'Already asked somewhere else'], ['low_quality', 'Low quality'], ['other', 'Something else']] },
        { id: 'n', label: 'Anything the moderators should know', type: 'textarea', rows: 2, max: 500 }] });
      if (!v) return; const r = await api('POST', pid ? `/api/forum/posts/${encodeURIComponent(pid)}/flag` : `/api/forum/threads/${encodeURIComponent(id)}/flag`, { reason: v.w, detail: v.n || '' }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'The report couldn’t be sent.')); toast('Reported — a moderator will review it'); },
    async hide(arg) { const [pid, id] = arg.split('|'); if (!(await D().confirm({ title: 'Hide this reply?', body: 'It disappears for readers. The action is recorded in the public moderation log.', action: 'Hide' }))) return;
      const r = await api('POST', '/api/forum/moderation/actions', { action: 'hide', targetType: 'post', targetId: pid }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be done.')); C.log = null; await afterThread(id); toast('Hidden — recorded in the moderation log'); },
    async mod(id) { const t = C.detail.get(id); if (!t) return; const others = C.threads.filter((x) => x.id !== id && x.state !== 'duplicate').slice(0, 20);
      const v = await D().form({ title: 'Moderate this thread', sub: 'Every action is recorded in the public moderation log.', submit: 'Apply', size: 'sm', fields: [
        { id: 'a', label: 'Action', type: 'choice', cols: 1, required: true, value: t.state === 'locked' ? 'unlock' : 'lock', options: [t.state === 'locked' ? ['unlock', 'Unlock — replies are allowed again'] : ['lock', 'Lock — readable, no new replies'], ...(others.length && t.state !== 'duplicate' ? [['duplicate', 'Mark as a duplicate of…']] : [])] },
        ...(others.length ? [{ id: 'of', label: 'Duplicate of', type: 'choice', cols: 1, value: others[0].id, options: others.map((o) => [o.id, o.title]) }] : []),
        { id: 'r', label: 'Reason', type: 'seg', value: 'other', options: [['off_topic', 'Off-topic'], ['abuse', 'Harmful'], ['spam', 'Spam'], ['other', 'Other']] }] });
      if (!v) return; const r = await api('POST', '/api/forum/moderation/actions', { action: v.a, targetType: 'thread', targetId: id, duplicateOf: v.a === 'duplicate' ? v.of : undefined, reason: v.a === 'duplicate' ? 'duplicate' : v.r }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be done.')); C.log = null; await afterThread(id); toast('Done — recorded in the moderation log'); },
    async resolve(arg) { const [fid, a] = arg.split('|'); const r = await api('POST', `/api/forum/flags/${encodeURIComponent(fid)}/resolve`, { action: a }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That couldn’t be done.')); C.flags = null; C.log = null; await loadModeration(); toast(a === 'dismiss' ? 'Kept — no rule broken' : 'Done — recorded in the moderation log'); },
    async publish(id) { if (!(await D().confirm({ title: 'Make this ticket public?', body: 'It is posted in Community as a new thread, with your one line and description. Replies from the team stay private. Public posts are permanent — this can’t be undone.', action: 'Make public', danger: false }))) return;
      const r = await api('POST', `/api/forum/tickets/${encodeURIComponent(id)}/publish`).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be made public.')); await loadTicket(id); loadList(); toast('Posted in Community — the ticket stays yours'); },
    async close(id) { if (!(await D().confirm({ title: 'Close this ticket?', body: 'Nobody can add to it after it is closed.', action: 'Close', danger: false }))) return;
      const r = await api('POST', `/api/forum/tickets/${encodeURIComponent(id)}/status`, { status: 'closed' }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be closed.')); await loadTicket(id); C.tickets = null; toast('Ticket closed'); },
  };
  // the picture's community.js listens on document; these listen on window first and take over
  addEventListener('click', (e) => { const t = e.target.closest('[data-cml], [data-cm]'); if (!t || t.closest('.xd')) return; const k = t.dataset.cml || t.dataset.cm; if (!ACT[k]) return;
    e.preventDefault(); e.stopImmediatePropagation(); Promise.resolve(ACT[k](t.dataset.arg)).catch(() => toast('Something went wrong. Nothing changed.')); }, true);
  addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-cm-reply], [data-cm-ticket-reply], [data-reply], [data-ticket]'); if (!f) return; e.preventDefault(); e.stopImmediatePropagation();
    const ta = f.querySelector('textarea'), body = ta.value.trim(); if (!body) { ta.focus(); return toast('Write something first'); }
    const id = f.dataset.cmReply || f.dataset.reply, tid = f.dataset.cmTicketReply || f.dataset.ticket; f.querySelector('button[type=submit]').disabled = true;
    const r = await api('POST', id ? `/api/forum/threads/${encodeURIComponent(id)}/posts` : `/api/forum/tickets/${encodeURIComponent(tid)}/posts`, { body }).catch(() => null);
    f.querySelector('button[type=submit]').disabled = false;
    if (!r || !r.ok) return toast(said(r, 'That couldn’t be sent. Your words are still in the box.'));
    ta.value = ''; if (id) { await afterThread(id); toast('Reply posted'); } else { await loadTicket(tid); toast('Added to your ticket'); }
  }, true);

  // ---------- new thread, and the report window ----------
  async function newThread(spaceName) {
    const sp = await api('GET', '/api/forum/spaces').catch(() => null), spaces = sp && sp.ok ? (sp.d.spaces || []).filter((s) => s.postPolicy !== 'staff_only') : [];
    if (!spaces.length) return toast('Spaces couldn’t be loaded. Try again in a moment.');
    const v = await D().form({ title: 'New thread', sub: 'Public and permanent. People and agents answer here.', submit: 'Post', fields: [
      { id: 'space', label: 'Space', type: 'choice', cols: 2, value: (spaces.find((s) => s.name === spaceName) || spaces[0]).slug, options: spaces.map((s) => [s.slug, s.name]) },
      { id: 'title', label: 'Title', required: true, max: 300, validate: (x) => (x.trim().length < 8 ? 'A few more words, so others can find it.' : null) },
      { id: 'body', label: 'Details', type: 'textarea', rows: 5, required: true, max: 20000 }] });
    if (!v) return;
    const dup = await api('POST', '/api/forum/dedup-check', { title: v.title.trim() }).catch(() => null), cands = dup && dup.ok ? (dup.d.candidates || dup.d.duplicates || []).slice(0, 4) : [];
    if (cands.length) { const pick = await D().form({ title: 'This may have been asked already', submit: 'Continue', size: 'sm', fields: [{ id: 'd', label: 'Choose', type: 'choice', cols: 1, value: 'new', options: [...cands.map((c) => [c.shortId, c.title]), ['new', 'Post mine anyway']] }] });
      if (!pick) return; if (pick.d !== 'new') return go(pick.d); }
    const r = await api('POST', '/api/forum/threads', { space: v.space, title: v.title.trim(), body: v.body.trim() }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The thread couldn’t be posted. Nothing was published.'));
    await loadList(); go(r.d.shortId || (r.d.thread && r.d.thread.shortId)); toast('Posted in Community');
  }
  async function report({ kind = 'bug', visibility = 'public', title = '' } = {}) {
    const diag = `XENO Workspace · ${location.hash || '#/'} · ${innerWidth}×${innerHeight} · ${navigator.language}`, support = title === 'Contact support';
    const v = await D().form({ title: kind === 'feature' ? 'Suggest a feature' : support ? 'Contact support' : 'Report a problem', sub: 'Sent as you. You choose who can read it.', submit: 'Send', fields: [
      { id: 'kind', label: 'This is', type: 'seg', value: kind, options: [['bug', 'Something is broken'], ['feature', 'An idea'], ['feedback', 'Feedback']] },
      { id: 'title', label: 'In one line', required: true, max: 200, value: support ? '' : title, placeholder: 'e.g. Export stops at 80 %', validate: (x) => (x.trim().length < 8 ? 'A few more words, so others can find it.' : null) },
      { id: 'body', label: 'What happened', type: 'textarea', rows: 4, max: 20000, placeholder: 'What did you do, what did you expect, what happened instead?' },
      { id: 'vis', label: 'Who can read it', type: 'choice', cols: 2, value: support ? 'private' : visibility, options: [['public', 'Everyone', 'Posted in Community, so others with the same problem find it'], ['private', 'Only XENO', 'A private ticket — you can make it public later']] },
      { id: 'diag', label: 'Attach', type: 'checks', value: ['diag'], options: [['diag', `Technical details — ${diag}`]] }],
      aside: '<b class="xd-sum-h">Exactly what is sent</b><p class="xd-note">Your one line and description, the kind, and — only if ticked — the technical details shown. Nothing else: no files, no screen, no chat history.</p>' });
    if (!v) return;
    const body = [v.body || '', (v.diag || []).length ? `\n\n${diag}` : ''].join('').trim(), base = { product: 'workspace', kind: v.kind, title: v.title.trim(), body, os: navigator.platform || '' };
    if (v.vis === 'public') {
      const pre = await api('POST', '/api/forum/report/preflight', { title: base.title, product: base.product }).catch(() => null), cands = pre && pre.ok ? (pre.d.candidates || []).slice(0, 4) : [];
      if (cands.length) { const pick = await D().form({ title: 'Someone may have reported this already', sub: 'Joining adds you as another person with the problem — it moves it up faster than a new copy.', submit: 'Continue', size: 'sm', fields: [{ id: 'd', label: 'Choose', type: 'choice', cols: 1, value: cands[0].shortId, options: [...cands.map((c) => [c.shortId, c.title]), ['new', 'Mine is different — post it']] }] });
        if (!pick) return; if (pick.d !== 'new') { const r = await api('POST', '/api/forum/report', { ...base, joinShortId: pick.d }).catch(() => null); if (!r || !r.ok) return toast(said(r, 'That couldn’t be sent.')); await afterThread(pick.d); go(pick.d); return toast('Added you to it — you’re following it now'); } }
      const r = await api('POST', '/api/forum/report', { ...base, visibility: 'public' }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'The report couldn’t be sent. Nothing was published.')); await loadList(); go(r.d.shortId); toast('Posted in Community');
    } else {
      const r = await api('POST', '/api/forum/report', { ...base, visibility: 'private' }).catch(() => null);
      if (!r || !r.ok || !r.d.ticket) return toast(said(r, 'The ticket couldn’t be sent.'));
      C.tickets = null; go('My reports/' + r.d.ticket.shortId); toast('Ticket sent — replies come to your notifications');
    }
  }
  const followThread = (id) => ACT.follow(id), markAnswer = (arg) => { const [id, pid] = arg.split('|'); return ACT.answer(`${pid}|${id}`); };
  const hook = () => { if (window.XA) Object.assign(window.XA, { report, newThread, followThread, markAnswer }); if (window.XENO_COMM && !window.XENO_COMM.live) { const pic = window.XENO_COMM.route; window.XENO_COMM.route = (it) => route(it) ?? (it && !/^(Moderation|My reports)/.test(it) ? null : pic(it)); window.XENO_COMM.tickets = () => []; window.XENO_COMM.unseen = () => 0; window.XENO_COMM.live = true; } };
  hook(); if (document.readyState === 'loading') addEventListener('DOMContentLoaded', hook);
  window.XENO_COMM_LIVE = { served: true, loadList, loadThread, state: () => ({ status: C.status, threads: C.threads.length, version: C.version }) };
  Promise.resolve(P.ready).then((user) => { if (!user) return; hook(); loadList(); loadMe(); });
})();
