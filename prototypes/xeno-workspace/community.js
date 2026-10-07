/* XENO_COMM — Community past the list (XENO FORUM - SPEC D6/D10, §5.3, §7.2; XENO REPORT - SPEC R1–R8).
 *   Threads have a stable id and address (title changes never break a link). Votes: a person's "Helpful" is binding;
 *   agents' signals are a separate, visible channel that never counts (D6). Flag → review queue; moderators keep, hide,
 *   lock or mark duplicate, and every action lands in a PUBLIC moderation log (§7.2). Compose-time duplicate check:
 *   joining a thread adds you as a reporter instead of making a forty-first copy (D10/R8).
 *   Reports: public → a Feedback thread, private → a ticket only you, XENO and that product's dev agent can read (R2);
 *   you see exactly what is sent (R7); a private ticket can be made public by you, never by us (R4); and the fix is
 *   written back to you — status, the version it shipped in, and a note in your inbox.
 * Platform: /api/forum/threads/:id · /posts/:id/vote · /threads/:id/flag · /moderation · /report · /report/preflight ·
 *   /tickets/mine · /tickets/:id/posts · /tickets/:id/publish
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), MIN = 6e4, DAY = 864e5;
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const F = () => window.XENO_PG_FORUM, save = () => window.XENO_DB?.save?.();
  const ME = 'Emilian', STAFF_ = () => !window.XENO_ROLE || window.XENO_ROLE.role() === 'owner'; // forum moderation is XENO staff, never a workspace role // the signed-in account is XENO staff in this prototype → moderator rights (§7.1)
  const th = (id) => F().find((t) => t.id === id), byKey = (k) => F().find((t) => t.id === k) || F().find((t) => t.title === k);
  const STATE = { open: 'Open', answered: 'Answered', resolved: 'Resolved', planned: 'Planned', duplicate: 'Duplicate', locked: 'Locked', fixed: 'Fixed' };
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const STOP = new Set(['the', 'and', 'for', 'how', 'with', 'what', 'when', 'does', 'can', 'not', 'this', 'that', 'xeno', 'from', 'into']);
  function similar(title, opts = {}) { const a = [...words(title)].filter((w) => !STOP.has(w)); if (a.length < 2) return [];
    return F().filter((t) => t.state !== 'duplicate' && t.id !== opts.except).map((t) => { const b = words(t.title); const hit = a.filter((w) => b.has(w)).length; return { t, hit, score: hit / a.length }; }).filter((r) => r.hit >= 2 && r.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, 3).map((r) => r.t); }

  // ---------- votes, flags, moderation log ----------
  const V = () => LS.get('fVotes', {}), setV = (v) => LS.set('fVotes', v);
  function tally(p) { const v = V()[p.id] || { you: false }; const seed = [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0); return { humans: (seed % 7) + (v.you ? 1 : 0), agents: p.author.kind === 'agent' ? 0 : seed % 4, you: v.you }; }
  const flags = () => LS.get('fFlags', []), setFlags = (f) => LS.set('fFlags', f);
  const modlog = () => LS.get('fModlog', null) ?? [{ at: now() - 3 * DAY, who: 'Ana (moderator)', what: 'Marked “Export SVG with text?” as a duplicate of “How do I export a Canvas frame as SVG with live text?”' }, { at: now() - 6 * DAY, who: 'Ana (moderator)', what: 'Hid a reply in “Showcase: a full music video cut in Motion” — spam link' }];
  const log = (what) => { const L = modlog(); L.unshift({ at: now(), who: `${ME} (staff)`, what }); LS.set('fModlog', L); };
  const reporters = (t) => (t.reporters || 1);

  // ---------- tickets: the private lane ----------
  function tickets() {
    let T = LS.get('tickets2', null);
    if (!T) { const old = LS.get('tickets', []);
      T = [{ n: 1031, title: 'Canvas freezes when I drop a 200 MB PSD', kind: 'bug', product: 'canvas', at: now() - 9 * DAY, state: 'fixed', fixedIn: 'Canvas 0.39.2', posts: [{ who: 'You', at: now() - 9 * DAY, body: 'Dropping a large PSD hangs the whole window for about a minute.' }, { who: 'canvas-dev (agent)', at: now() - 8 * DAY, body: 'Reproduced with a 210 MB file — the importer decodes every layer on the main thread. Moving it to a worker.' }, { who: 'XENO — Mira', at: now() - 2 * DAY, body: 'Fixed in Canvas 0.39.2. Large files now import in the background with a progress bar.' }], seen: false },
        { n: 1038, title: 'Let me pin a chat to the rail', kind: 'feature', product: 'hub', at: now() - 3 * DAY, state: 'triaged', posts: [{ who: 'You', at: now() - 3 * DAY, body: 'I go back to the same two chats every day.' }, { who: 'XENO — Mira', at: now() - 2 * DAY, body: 'Thanks — this is on the list for the next Workspace release.' }], seen: true },
        ...old.map((o) => ({ ...o, product: 'workspace', posts: [], seen: true }))];
      LS.set('tickets2', T); }
    return T;
  }
  const setTickets = (T) => LS.set('tickets2', T);
  const unseen = () => tickets().filter((t) => !t.seen && t.state === 'fixed').length;
  const TSTATE = [['open', 'Received'], ['triaged', 'Looked at'], ['in_progress', 'Being fixed'], ['fixed', 'Fixed'], ['closed', 'Closed']];

  // ---------- pages ----------
  function threadPage(t) {
    const h = P(), posts = h.threadPosts(t), mine = t.author.name === ME || t.author.name === 'You', subs = (LS.get('forumSubs', []) || []).includes(t.id), locked = t.state === 'locked';
    const dup = t.duplicateOf && th(t.duplicateOf);
    const acts = h.btn(subs ? 'Following' : 'Follow', `data-xa="followThread" data-arg="${t.id}" aria-pressed="${subs}"`, true, subs ? 'check' : 'bell') + h.btn('Copy link', `data-xa="copyThreadLink" data-arg="${t.id}"`, true, 'link') + h.btn('Report', `data-cm="flag" data-arg="${t.id}|"`, true, 'flag') + (STAFF_() ? h.btn('Moderate', `data-cm="mod" data-arg="${t.id}"`, true, 'gear') : '');
    const post = (p, i) => { if (p.hidden) return `<article class="pg-post cm-hidden"><div><p class="pg-dim">A moderator hid this reply. <a data-go="community" data-cm="openLog">Why</a></p></div></article>`; const v = tally(p);
      return `<article class="pg-post${p.answer ? ' answer' : ''}" id="post-${p.id}">${h.avatar(p.author)}<div><header><b>${esc(p.author.name)}</b>${p.author.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}<small>${h.ago(p.at)} ago</small>${p.answer ? h.chip('Answer') : ''}</header><p>${esc(p.body)}</p>
        <div class="cm-acts"><button class="cm-vote" data-cm="vote" data-arg="${t.id}|${p.id}" aria-pressed="${v.you}">${ic('check')}<span>Helpful</span><b>${v.humans}</b></button>${v.agents ? `<span class="cm-agents" title="Agents can surface a reply, never rank it">${v.agents} agent${v.agents > 1 ? 's' : ''} found this relevant</span>` : ''}
        ${mine && t.space === 'Questions' && !p.answer && !locked ? `<button class="pg-link" data-xa="markAnswer" data-arg="${t.id}|${p.id}">Mark as the answer</button>` : ''}<button class="pg-link" data-cm="flag" data-arg="${t.id}|${p.id}">Report</button></div></div></article>`; };
    return h.page(h.head({ obj: true, eyebrow: `<a data-go="community">Community</a> · ${esc(t.space)}`, title: t.title, sub: `${t.author.name}${t.author.kind === 'agent' ? ' (agent)' : ''} · ${STATE[t.state] || h.cap(t.state)} · ${h.plural(posts.length, 'reply', 'replies')}${reporters(t) > 1 ? ` · ${reporters(t)} people reported this` : ''}`, acts })
      + (t.fixedIn ? `<p class="cm-banner">${ic('check')}<span><b>Fixed in ${esc(t.fixedIn)}.</b> Update to get it.</span></p>` : '')
      + (dup ? `<p class="cm-banner">${ic('link')}<span>This is a duplicate. The answer is in <a data-cm="open" data-arg="${dup.id}">${esc(dup.title)}</a>.</span></p>` : '')
      + `<div class="pg-thread">${t.body ? `<article class="pg-post op">${h.avatar(t.author)}<div><header><b>${esc(t.author.name)}</b><small>${h.ago(t.lastActivityAt)} ago</small></header><p>${esc(t.body)}</p>${t.diag ? `<pre class="pg-diag">${esc(t.diag)}</pre>` : ''}</div></article>` : ''}
        ${posts.map(post).join('') || '<p class="pg-dim">No replies yet — the first one helps most.</p>'}
        ${locked ? '<p class="cm-banner">' + ic('lock') + '<span>Locked by a moderator — the thread stays readable, no new replies.</span></p>' : `<form class="pg-reply" data-reply="${t.id}"><textarea rows="3" placeholder="Write a reply" aria-label="Reply"></textarea><div><span class="pg-dim">Replies are public and permanent.</span><button class="pg-btn" type="submit">${ic('send')}<span>Reply</span></button></div></form>`}</div>`
      + h.foot('community:thread', `GET /api/forum/threads/${t.id}`));
  }
  function moderation() {
    const h = P(), Q = flags().filter((f) => !f.done), L = modlog();
    const q = Q.map((f) => { const t = th(f.thread), p = f.post && h.threadPosts(t).find((x) => x.id === f.post); return `<li class="cm-q"><div class="mk-row"><b><a data-cm="open" data-arg="${t.id}">${esc(t.title)}</a></b>${h.chip({ spam: 'Spam', harm: 'Harmful', off: 'Off-topic', dup: 'Duplicate', other: 'Other' }[f.why])}<span class="pg-dim">${h.ago(new Date(f.at).toISOString())} ago · by ${f.byAgent ? 'an agent' : 'a person'}</span></div>
      ${p ? `<blockquote>${esc(p.body)}</blockquote>` : ''}${f.note ? `<p class="pg-dim">“${esc(f.note)}”</p>` : ''}<div class="fd-acts">${h.btn('Keep', `data-cm="resolve" data-arg="${f.id}|keep"`, true)}${p ? h.btn('Hide reply', `data-cm="resolve" data-arg="${f.id}|hide"`, true) : ''}${h.btn('Lock thread', `data-cm="resolve" data-arg="${f.id}|lock"`, true)}${f.why === 'dup' ? h.btn('Mark duplicate', `data-cm="resolve" data-arg="${f.id}|dup"`, true) : ''}</div></li>`; }).join('');
    return h.page(h.head({ eyebrow: '<a data-go="community">Community</a>', title: 'Moderation', sub: 'Reports waiting for review, and every action moderators took — in public.' })
      + `<section class="pg-sec"><h3>Waiting for review</h3>${STAFF_() ? `<ul class="mk-sls">${q || '<li class="pg-dim">Nothing waiting. Reports from people and agents land here.</li>'}</ul>` : '<p class="pg-dim">Moderators review reports here.</p>'}<p class="pg-dim wf-note">Agents can report a post for review — never remove one.</p></section>
      <section class="pg-sec" id="cm-log"><h3>Moderation log</h3><ul class="mk-rcl cm-log">${L.map((x) => `<li><span>${new Date(x.at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span><span>${esc(x.what)}</span><b>${esc(x.who)}</b></li>`).join('')}</ul></section>`
      + h.foot('community', 'GET /api/forum/moderation'));
  }
  function myReports() {
    const h = P(), T = tickets(), pub = F().filter((t) => (t.author.name === ME || t.author.name === 'You') && (t.space === 'Feedback' || t.diag || t.reported));
    const st = (s) => TSTATE.find((x) => x[0] === s)?.[1] || s;
    return h.page(h.head({ eyebrow: '<a data-go="community">Community</a>', title: 'My reports', sub: 'Every problem and idea you sent — what happened to it, and the version it was fixed in.', acts: h.btn('Report a problem', 'data-xa="report"', false, 'plus') })
      + `<section class="pg-sec"><h3>Private tickets</h3><p class="pg-dim wf-note">Only you, the XENO team and that product’s developer agent can read these.</p><ul class="mk-owns">${T.map((t) => `<li class="mk-own${!t.seen && t.state === 'fixed' ? ' cm-new' : ''}"><span class="pg-thumb pg-thumb--ic sq">${ic(t.kind === 'feature' ? 'megaphone' : t.kind === 'feedback' ? 'chat' : 'edit')}</span><span class="mk-own-m"><a data-cm="ticket" data-arg="${t.n}"><b>#${t.n} · ${esc(t.title)}</b></a><small>${esc(h.cap(t.product))} · ${new Date(t.at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}${t.fixedIn ? ` · fixed in ${esc(t.fixedIn)}` : ''}</small></span>${h.chip(st(t.state))}</li>`).join('') || '<li class="pg-dim">No private tickets.</li>'}</ul></section>
      <section class="pg-sec"><h3>Posted in Community</h3><ul class="mk-owns">${pub.map((t) => `<li class="mk-own"><span class="mk-own-m"><a data-cm="open" data-arg="${t.id}"><b>${esc(t.title)}</b></a><small>${esc(t.space)}${reporters(t) > 1 ? ` · ${reporters(t)} people` : ''}</small></span>${h.chip(STATE[t.state] || t.state)}</li>`).join('') || '<li class="pg-dim">Nothing posted publicly.</li>'}</ul></section>`
      + h.foot('community', 'GET /api/forum/tickets/mine'));
  }
  function ticketPage(n) {
    const h = P(), T = tickets(), t = T.find((x) => String(x.n) === String(n)); if (!t) return null;
    if (!t.seen) { t.seen = true; setTickets(T); }
    const idx = TSTATE.findIndex((x) => x[0] === t.state);
    return h.page(h.head({ obj: true, eyebrow: '<a data-go="community">Community</a> · <a data-cm="mine">My reports</a>', title: `#${t.n} · ${t.title}`, sub: `Private ticket · ${h.cap(t.kind)} · ${h.cap(t.product)}`, acts: t.publishedAs ? h.btn('Open public thread', `data-cm="open" data-arg="${t.publishedAs}"`, true, 'link') : h.btn('Make public', `data-cm="publish" data-arg="${t.n}"`, true, 'community') })
      + `<ol class="cm-steps">${TSTATE.slice(0, 4).map(([k, l], i) => `<li class="${i < idx || t.state === 'closed' ? 'done' : i === idx ? 'on' : ''}"><i></i><span>${l}</span></li>`).join('')}</ol>`
      + (t.fixedIn ? `<p class="cm-banner">${ic('check')}<span><b>Fixed in ${esc(t.fixedIn)}.</b> Update to get it — or tell us here if it’s still happening.</span></p>` : '')
      + `<div class="pg-thread">${t.posts.map((p) => `<article class="pg-post${/XENO/.test(p.who) ? ' answer' : ''}"><div><header><b>${esc(p.who)}</b><small>${h.ago(new Date(p.at).toISOString())} ago</small></header><p>${esc(p.body)}</p></div></article>`).join('')}
        <form class="pg-reply" data-ticket="${t.n}"><textarea rows="3" placeholder="Add to this ticket" aria-label="Reply"></textarea><div><span class="pg-dim">Only you and the XENO team see this.</span><button class="pg-btn" type="submit">${ic('send')}<span>Send</span></button></div></form></div>`
      + h.foot('community', `GET /api/forum/tickets/${t.n}`));
  }
  function route(it) {
    if (it === 'Moderation') return moderation();
    if (it === 'My reports') return myReports();
    if (it?.startsWith('My reports/')) return ticketPage(it.slice(11));
    const t = it && byKey(it); return t ? threadPage(t) : null;
  }

  // ---------- report: one window, see what is sent, dedup, choose who reads it ----------
  async function report({ kind = 'bug', visibility = 'public', title = '' } = {}) {
    const diag = `XENO Workspace · ${location.hash || '#/'} · ${innerWidth}×${innerHeight} · ${navigator.language}`;
    const v = await D().form({ title: kind === 'feature' ? 'Suggest a feature' : title === 'Contact support' ? 'Contact support' : 'Report a problem', sub: 'Sent as you. You choose who can read it.', submit: 'Send', fields: [
      { id: 'kind', label: 'This is', type: 'seg', value: kind, options: [['bug', 'Something is broken'], ['feature', 'An idea'], ['feedback', 'Feedback']] },
      { id: 'title', label: 'In one line', required: true, max: 120, value: title === 'Contact support' ? '' : title, placeholder: 'e.g. Export stops at 80 %', validate: (x) => (x.trim().length < 8 ? 'A few more words, so others can find it.' : null) },
      { id: 'body', label: 'What happened', type: 'textarea', rows: 4, placeholder: 'What did you do, what did you expect, what happened instead?' },
      { id: 'vis', label: 'Who can read it', type: 'choice', cols: 2, value: title === 'Contact support' ? 'private' : visibility, options: [['public', 'Everyone', 'Posted in Community, so others with the same problem find it'], ['private', 'Only XENO', 'A private ticket — you can make it public later']] },
      { id: 'diag', label: 'Attach', type: 'checks', value: ['diag'], options: [['diag', `Technical details — ${diag}`]] }],
      aside: '<b class="xd-sum-h">Exactly what is sent</b><p class="xd-note">Your one line and description, the kind, and — only if ticked — the technical details shown. Nothing else: no files, no screen, no chat history.</p>' });
    if (!v) return;
    const t1 = v.title.trim();
    if (window.XENO_NET && !await window.XENO_NET.run({ op: 'report.submit', label: 'Sending your report' })) return;
    if (v.vis === 'public') {
      const dups = similar(t1);
      if (dups.length) { const pick = await D().form({ title: 'Someone may have reported this already', sub: 'Joining adds you as another person with the problem — it moves it up faster than a new copy.', submit: 'Continue', size: 'sm', fields: [{ id: 'd', label: 'Choose', type: 'choice', cols: 1, value: dups[0].id, options: [...dups.map((d) => [d.id, d.title, `${STATE[d.state] || d.state} · ${reporters(d)} reporter${reporters(d) > 1 ? 's' : ''}`]), ['new', 'None of these — post mine']] }] });
        if (!pick) return; if (pick.d !== 'new') { const d = th(pick.d); d.reporters = reporters(d) + 1; d.joined = true; const s = new Set(LS.get('forumSubs', []) || []); s.add(d.id); LS.set('forumSubs', [...s]); save(); X().go('global', { global: 'community', item: d.id }); return X().toast('Added you to it — you’re following it now'); } }
      const nt = { id: 'th_' + now().toString(36), title: t1, space: v.kind === 'bug' ? 'Questions' : 'Feedback', author: { name: ME, kind: 'human' }, replies: 0, state: 'open', lastActivityAt: new Date().toISOString(), body: v.body || '', diag: (v.diag || []).length ? diag : null, reported: true, kind: v.kind };
      F().unshift(nt); save(); X().go('global', { global: 'community', item: nt.id }); X().toast('Posted in Community');
    } else {
      const T = tickets(), n = Math.max(1040, ...T.map((t) => t.n)) + 1;
      T.unshift({ n, title: t1, kind: v.kind, product: 'workspace', at: now(), state: 'open', posts: [{ who: 'You', at: now(), body: v.body || t1 }], seen: true, diag: (v.diag || []).length ? diag : null }); setTickets(T);
      X().go('global', { global: 'community', item: 'My reports/' + n }); X().toast(`Ticket #${n} opened — replies come to your inbox`);
      // the write-back: the team looks at it, and the reporter sees each step
      setTimeout(() => { const T2 = tickets(), t = T2.find((x) => x.n === n); if (t && t.state === 'open') { t.state = 'triaged'; t.posts.push({ who: 'workspace-dev (agent)', at: now(), body: 'Thanks — I can reproduce this and have passed it to the team with the details you attached.' }); setTickets(T2); X().render(); } }, 2500);
    }
  }

  // ---------- actions ----------
  const done = (m) => (window.XENO_NET ? window.XENO_NET.end(() => { X().render(); if (m) X().toast(m); }) : (X().render(), m && X().toast(m), Promise.resolve(true)));
  const ACT = {
    open(id) { X().go('global', { global: 'community', item: id }); },
    mine() { X().go('global', { global: 'community', item: 'My reports' }); },
    ticket(n) { X().go('global', { global: 'community', item: 'My reports/' + n }); },
    openLog() { X().go('global', { global: 'community', item: 'Moderation' }); },
    vote(arg) { const [, pid] = arg.split('|'), v = V(); v[pid] = { you: !(v[pid]?.you) }; setV(v); done(); },
    async flag(arg) { const [tid, pid] = arg.split('|'); const v = await D().form({ title: pid ? 'Report this reply' : 'Report this thread', sub: 'Goes to the moderators for review. The author isn’t told who reported it.', submit: 'Send report', size: 'sm', fields: [{ id: 'w', label: 'Why', type: 'choice', cols: 1, required: true, options: [['spam', 'Spam or advertising'], ['harm', 'Harmful, hateful or harassing'], ['off', 'Off-topic'], ['dup', 'A duplicate of another thread'], ['other', 'Something else']] }, { id: 'n', label: 'Details (optional)', type: 'textarea', rows: 2 }] });
      if (!v) return; const f = flags(); f.unshift({ id: 'fl' + now().toString(36), thread: tid, post: pid || null, why: v.w, note: v.n || '', at: now() }); setFlags(f); done('Reported — a moderator will review it'); },
    async mod(tid) { const t = th(tid); const v = await D().form({ title: 'Moderate this thread', sub: 'Every action is recorded in the public moderation log.', submit: 'Apply', size: 'sm', fields: [{ id: 'a', label: 'Action', type: 'choice', cols: 1, required: true, options: [['lock', t.state === 'locked' ? 'Unlock' : 'Lock — readable, no new replies'], ['dup', 'Mark as a duplicate of…'], ['resolve', 'Mark resolved']] }, { id: 'of', label: 'Duplicate of (only for duplicates)', type: 'choice', cols: 1, options: F().filter((x) => x.id !== tid).slice(0, 6).map((x) => [x.id, x.title]) }, { id: 'r', label: 'Reason (shown in the log)', required: true }] });
      if (!v) return; applyMod(t, v.a, v.of, v.r); done('Done — recorded in the moderation log'); },
    resolve(arg) { const [fid, a] = arg.split('|'), f = flags(), x = f.find((y) => y.id === fid), t = th(x.thread);
      if (a === 'hide') { const p = P().threadPosts(t).find((y) => y.id === x.post); p.hidden = true; log(`Hid a reply in “${t.title}” — ${({ spam: 'spam', harm: 'harmful', off: 'off-topic', other: 'reported' })[x.why] || 'reported'}`); }
      else if (a === 'lock') applyMod(t, 'lock', null, 'reported');
      else if (a === 'dup') applyMod(t, 'dup', similar(t.title, { except: t.id })[0]?.id || F().find((y) => y.id !== t.id).id, 'duplicate');
      else log(`Kept “${t.title}” after a report — no rule broken`);
      x.done = true; setFlags(f); save(); done('Reviewed'); },
    async publish(n) { const T = tickets(), t = T.find((x) => String(x.n) === String(n));
      if (!await D().confirm({ title: 'Make this ticket public?', body: 'It is posted in Community as a new thread, with your one line and description. Replies from the team stay private. Public posts are permanent — this can’t be undone.', action: 'Make public', danger: false })) return;
      const nt = { id: 'th_' + now().toString(36), title: t.title, space: t.kind === 'bug' ? 'Questions' : 'Feedback', author: { name: ME, kind: 'human' }, replies: 0, state: t.state === 'fixed' ? 'fixed' : 'open', fixedIn: t.fixedIn, lastActivityAt: new Date().toISOString(), body: t.posts[0]?.body || '', reported: true };
      F().unshift(nt); t.publishedAs = nt.id; setTickets(T); save(); done('Posted in Community — the ticket stays yours'); },
  };
  function applyMod(t, a, of, why) {
    if (a === 'lock') { t.state = t.state === 'locked' ? 'open' : 'locked'; log(`${t.state === 'locked' ? 'Locked' : 'Unlocked'} “${t.title}” — ${why}`); }
    if (a === 'dup' && of) { const o = th(of); t.state = 'duplicate'; t.duplicateOf = of; o.reporters = reporters(o) + reporters(t); log(`Marked “${t.title}” as a duplicate of “${o.title}” — ${why}`); }
    if (a === 'resolve') { t.state = 'resolved'; log(`Marked “${t.title}” resolved — ${why}`); }
    save();
  }
  document.addEventListener('submit', (e) => { const f = e.target.closest('[data-ticket]'); if (!f) return; e.preventDefault(); e.stopPropagation();
    const ta = f.querySelector('textarea'), body = ta.value.trim(); if (!body) { ta.focus(); return X().toast('Write something first'); }
    const T = tickets(), t = T.find((x) => String(x.n) === f.dataset.ticket); t.posts.push({ who: 'You', at: now(), body }); if (t.state === 'fixed') t.state = 'open'; setTickets(T); done('Added to your ticket'); }, true);
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-cm]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); window.XENO_NET?.begin('community', t.dataset.cm, t); Promise.resolve(ACT[t.dataset.cm]?.(t.dataset.arg)).finally(() => window.XENO_NET?.clear(t)); }, true);
  // Ctrl+Alt+R is the secondary report key (R6); F1 is bound in app.js
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'r' && !document.querySelector('.xd')) { e.preventDefault(); report(); } });
  window.XA.report = report;
  window.XENO_COMM = { route, similar, tickets, unseen };
})();
