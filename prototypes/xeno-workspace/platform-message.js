/* platform-message.js — on the platform, Social › Message is XENO Comms, for real (owner, 2026-10-23: "for message we
 * already have xeno comms … that will power this").
 *
 * The platform keeps no messages. This screen reads and writes /api/message (routes/messageRoutes.js →
 * services/xenoComms.js), which calls XENO Comms server-to-server as you:
 *
 *   channels · DMs      GET /conversations         one channel per scope: the workspace, its divisions, your teams,
 *                                                  your projects; plus direct messages with co-members here
 *   open                GET /messages?key=|conversationId=     address: /workspace/social/spaces/message/<scope>
 *                                                  (<scope> = workspace | division/<id> | team/<id> | project/<id> | dm/<id>)
 *   a thread            ?thread=<message id>       address: …/message/<scope>/t/<message id>
 *   post · reply        POST /messages {key|conversationId, text, replyTo}
 *   New message         POST /direct {userId}      (the header's primary action, in a dialog)
 *   Hand to agent       POST /handoff              the chat's own @agent hand-off: a task delegated to the agent
 *   live                GET /realtime → the Comms gateway socket; the screen refetches as itself on each event
 *
 * Message text is shown as TEXT: escaped first, then only http(s) links become markup.
 * It registers XENO_ZONE_LIVE['social.message'], so the area never shows sample rows.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const S = { status: 'idle', ws: undefined, list: null, tab: 'channels', open: null, openRef: null, thread: null, threadRef: null, error: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const here = () => { const s = X()?.S; return !!(s && s.view === 'zone' && s.zone === 'message'); };
  const wq = () => (S.ws ? `workspace=${encodeURIComponent(S.ws)}` : '');
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };

  /** the address's item → what is open: { key } | { conversationId }, plus a thread */
  function addr() {
    const p = String(X()?.S?.item || '').split('/').filter(Boolean);
    let ref = null, i = 0;
    if (p[0] === 'workspace') { ref = { key: 'workspace' }; i = 1; }
    else if (['division', 'team', 'project'].includes(p[0]) && UUID.test(p[1] || '')) { ref = { key: `${p[0]}:${p[1].toLowerCase()}` }; i = 2; }
    else if (p[0] === 'dm' && UUID.test(p[1] || '')) { ref = { conversationId: p[1].toLowerCase() }; i = 2; }
    const thread = ref && p[i] === 't' && UUID.test(p[i + 1] || '') ? p[i + 1].toLowerCase() : null;
    return { ref, thread };
  }
  const itemOf = (ref, thread) => (!ref ? null : (ref.key ? ref.key.replace(':', '/') : `dm/${ref.conversationId}`) + (thread ? `/t/${thread}` : ''));
  const go = (ref, thread) => X()?.go?.('zone', { zone: 'message', item: itemOf(ref, thread) });
  const same = (a, b) => !!a && !!b && a.key === b.key && a.conversationId === b.conversationId;
  const refQ = (ref) => (ref.key ? `key=${encodeURIComponent(ref.key)}` : `conversationId=${encodeURIComponent(ref.conversationId)}`);
  const unread = () => (S.list ? [...S.list.channels, ...S.list.dms].filter((c) => c.unread).length : 0);

  // ─────────────────────────────── text → markup (escaped first)
  const text = (body) => esc(body).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');
  window.XENO_MESSAGE_TEXT = text;   // for the browser test

  // ─────────────────────────────── data
  async function load() {
    S.ws = wsId(); if (!S.list) S.status = 'loading'; S.error = null;
    const r = await api('GET', '/api/message/conversations?' + wq()).catch(() => null);
    if (!r || !r.ok) { S.status = r && r.d && r.d.code === 'message_not_configured' ? 'off' : 'error'; S.error = said(r, 'Messages could not be reached.'); return paint(); }
    S.list = r.d; S.status = r.d.configured === false ? 'off' : 'ready'; paint(); live();
  }
  async function openRef(ref) {
    S.openRef = ref; S.open = null; paint();
    const r = await api('GET', `/api/message/messages?${[wq(), refQ(ref)].filter(Boolean).join('&')}`).catch(() => null);
    if (!same(S.openRef, ref)) return;
    S.open = r && r.ok ? r.d : { error: said(r, 'This conversation could not be opened.') }; paint(); live();
  }
  async function openThread(ref, id) {
    S.threadRef = id;
    const r = await api('GET', `/api/message/messages?${[wq(), refQ(ref), 'thread=' + encodeURIComponent(id)].filter(Boolean).join('&')}`).catch(() => null);
    if (S.threadRef !== id) return;
    S.thread = r && r.ok ? r.d : { error: said(r, 'This thread could not be opened.') }; paint();
  }
  const refresh = async () => { await load(); if (S.openRef) { const keep = S.openRef; await openRef(keep); if (S.threadRef) await openThread(keep, S.threadRef); } };

  // live: the Comms gateway (Phoenix channels, JSON v2). The ticket is single-use, so each connect asks for a new one.
  let sock = null, sockTopic = null, hb = 0, ref = 0;
  async function live() {
    const conv = S.open && S.open.conversationId ? S.open.conversationId : null;
    if (sock && sock.readyState === 1) { if (conv && sockTopic !== conv) join(conv); return; }
    if (sock || typeof WebSocket === 'undefined') return;
    const t = await api('GET', '/api/message/realtime?' + wq()).catch(() => null);
    if (!t || !t.ok || !t.d.realtime) return;
    try { sock = new WebSocket(`${t.d.url}/websocket?vsn=2.0.0&token=${encodeURIComponent(t.d.token)}&device_id=${encodeURIComponent(t.d.deviceId)}`); } catch { sock = null; return; }
    sock.onopen = () => { hb = setInterval(() => send0('phoenix', 'heartbeat', {}), 30000); const c = S.open && S.open.conversationId; if (c) join(c); };
    sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } const [, , topic, event] = m; if (String(topic).startsWith('conversation:') && /^message\./.test(event)) { clearTimeout(live.t); live.t = setTimeout(refresh, 150); } };
    sock.onclose = () => { clearInterval(hb); sock = null; sockTopic = null; };
  }
  const send0 = (topic, event, payload, joinRef = null) => { if (sock && sock.readyState === 1) sock.send(JSON.stringify([joinRef, String(++ref), topic, event, payload])); };
  function join(conv) { if (sockTopic) send0(`conversation:${sockTopic}`, 'phx_leave', {}); sockTopic = conv; send0(`conversation:${conv}`, 'phx_join', {}, String(ref + 1)); }
  addEventListener('focus', () => { if (here() && S.status === 'ready') refresh(); });

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['social.message'] = {
    served: true, items: true,
    work: () => (S.status === 'ready' && S.list ? ['Conversations', [...S.list.channels.filter((c) => c.conversationId), ...S.list.dms].slice(0, 6).map((c) => [c.title ? '#' + c.title : c.with.name, c.unread ? 'New' : '', null, 'Message'])] : null),
    badge: () => (unread() || null),
    // the breadcrumb names the conversation by its title, never by its id (the id is only in the address)
    label: (item) => { const at = String(item).split('/t/')[0]; const c = S.list && S.list.channels.find((x) => itemOf({ key: x.key }) === at); const d = S.list && S.list.dms.find((x) => `dm/${x.conversationId}` === at); return c ? '#' + c.title : d ? d.with.name : 'Conversation'; },
    page: () => page(),
    state: () => ({ status: S.status, channels: S.list ? S.list.channels.length : 0, dms: S.list ? S.list.dms.length : 0, open: S.openRef, thread: S.threadRef, live: !!(sock && sock.readyState === 1) }),
    reload: () => load(),
  };

  // ─────────────────────────────── the page
  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const KIND = { workspace: 'Workspace', division: 'Division', team: 'Team', project: 'Project' };
  function page() {
    const h = window.XENO_PAGES.h;
    // the page's one header: Channels · Direct messages are header tabs, New message is the primary action on the right
    const head = h.head({ title: 'Message', sub: 'Channels for the workspace, divisions, teams and projects, and direct messages — through XENO Comms.', acts: S.status === 'ready' ? h.btn('New message', 'data-ms-new', false, 'plus') : '' });
    const tabs = h.tabs([['channels', 'Channels', S.list ? S.list.channels.length : ''], ['dms', 'Direct messages', S.list ? S.list.dms.length : '']], S.tab, 'data-ms-tab');
    const wrap = (body) => h.page(`${head}${tabs}<div class="wrap ms" data-ms-page="${esc(S.status)}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'off') return wrap('<div class="pj-empty" data-ms-state="not-configured">Message is not set up on this server yet.</div>');
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-ms-error>${esc(S.error)} ${btn('data-ms-reload', 'Try again')}</div>`);
    const a = addr();
    if (a.ref && !same(S.openRef, a.ref)) { S.thread = null; S.threadRef = null; if (a.ref.conversationId) S.tab = 'dms'; openRef(a.ref); }
    if (!a.ref && S.openRef) { S.openRef = null; S.open = null; }
    if (a.ref && a.thread && S.threadRef !== a.thread) openThread(a.ref, a.thread);
    if (!a.thread && S.threadRef) { S.threadRef = null; S.thread = null; }
    return wrap(`<div class="ms-wrap${S.threadRef ? ' with-thread' : ''}">${side()}<section class="ms-main">${main()}</section>${S.threadRef ? `<aside class="ms-thread" data-ms-thread-pane>${threadPane()}</aside>` : ''}</div>`);
  }
  function side() {
    const L = S.list;
    if (S.tab === 'dms') return `<aside class="ms-side"><ul class="ms-list" data-ms-dms>${L.dms.map((d) => `<li class="ms-ch${S.openRef && S.openRef.conversationId === d.conversationId ? ' on' : ''}"><a href="#" data-ms-dm="${esc(d.conversationId)}"><span>${esc(d.with.name)}</span>${d.unread ? '<b class="ms-n" data-ms-unread>•</b>' : ''}</a></li>`).join('') || '<li class="pj-empty">No direct messages yet. Start one with New message.</li>'}</ul></aside>`;
    const groups = ['workspace', 'division', 'team', 'project'].map((k) => [k, L.channels.filter((c) => c.kind === k)]).filter(([, cs]) => cs.length);
    return `<aside class="ms-side">${groups.map(([k, cs]) => `<div class="ms-sec">${esc(KIND[k])}${cs.length > 1 ? 's' : ''}</div><ul class="ms-list" data-ms-channels="${k}">${cs.map((c) => `<li class="ms-ch${S.openRef && S.openRef.key === c.key ? ' on' : ''}"><a href="#" data-ms-ch="${esc(c.key)}"><span># ${esc(c.title)}</span>${c.unread ? '<b class="ms-n" data-ms-unread>•</b>' : ''}</a></li>`).join('')}</ul>`).join('')}</aside>`;
  }
  function msg(m, { inThread = false } = {}) {
    const body = m.deleted ? '<i class="ms-gone">This message was deleted.</i>' : m.encrypted ? '<i class="ms-gone">End-to-end encrypted — open it in XENO Comms.</i>' : `<div class="ms-body" data-ms-body>${text(m.text)}</div>`;
    const acts = m.deleted ? '' : `${inThread ? '' : btn(`data-ms-reply="${esc(m.id)}"`, m.replies ? `${m.replies} ${m.replies === 1 ? 'reply' : 'replies'}` : 'Reply')}${btn(`data-ms-handoff="${esc(m.id)}"`, 'Hand to agent')}`;
    return `<li class="ms-msg" data-ms-msg="${esc(m.id)}"><div class="ms-meta"><b>${esc(m.author ? m.author.name : 'Someone')}</b>${m.author && m.author.kind === 'agent' ? ' <small class="ms-agent">agent</small>' : ''} <small>${esc(when(m.createdAt))}${m.editedAt ? ' · edited' : ''}</small></div>${body}<div class="ms-acts">${acts}</div></li>`;
  }
  const composer = (parentId) => `<div class="ms-compose" data-ms-compose="${parentId ? esc(parentId) : ''}"><textarea class="in" data-ms-text placeholder="${parentId ? 'Reply in thread' : 'Message'}" aria-label="${parentId ? 'Reply' : 'Message'}" rows="2" maxlength="8000"></textarea><div class="ms-row">${btn(`data-ms-send${parentId ? `="${esc(parentId)}"` : ''}`, 'Send', 'btn')}</div></div>`;
  function main() {
    if (!S.openRef) return '<div class="pj-empty">Choose a channel or a direct message.</div>';
    const o = S.open;
    if (!o) return '<div class="pj-empty">Opening…</div>';
    if (o.error) return `<div class="pj-empty" data-ms-open-error>${esc(o.error)}</div>`;
    const c = o.channel, dm = S.list && S.list.dms.find((d) => d.conversationId === o.conversationId);
    const title = c ? `# ${c.title}` : dm ? dm.with.name : 'Direct message';
    return `<div class="ms-head" data-ms-conversation="${esc(o.conversationId)}"><h2>${esc(title)}</h2>${c ? `<small>${esc(KIND[c.kind] || '')} · ${c.members} member${c.members === 1 ? '' : 's'}</small>` : ''}</div>
      <ul class="ms-msgs" data-ms-msgs>${o.messages.map((m) => msg(m)).join('') || '<li class="pj-empty">No messages yet. Say hello.</li>'}</ul>${composer(null)}`;
  }
  function threadPane() {
    const t = S.thread;
    if (!t) return '<div class="pj-empty">Opening…</div>';
    if (t.error) return `<div class="pj-empty">${esc(t.error)}</div>`;
    return `<div class="ms-head"><h3>Thread</h3>${btn('data-ms-close-thread aria-label="Close thread"', 'Close')}</div><ul class="ms-msgs">${msg(t.parent, { inThread: true })}</ul>
      <ul class="ms-msgs" data-ms-replies>${t.messages.map((m) => msg(m, { inThread: true })).join('') || '<li class="pj-empty">No replies yet.</li>'}</ul>${composer(t.parent.id)}`;
  }

  // ─────────────────────────────── actions
  async function call(method, path, body, okMsg) {
    const r = await api(method, path, body === undefined ? undefined : withWs(body)).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  // New message: a direct message with a co-member, chosen in the workspace dialog
  async function newMessage() {
    const r = await api('GET', '/api/message/directory?' + wq()).catch(() => null);
    const people = (r && r.ok && r.d.people) || [];
    if (!people.length) return toast('There is nobody else in this workspace yet.');
    window.XD.form({ title: 'New message', sub: 'A direct message with someone in this workspace.', submit: 'Start', size: 'sm',
      fields: [{ id: 'who', type: 'choice', label: 'To', required: true, value: people[0].id, options: people.map((p) => [p.id, p.name, p.handle ? '@' + p.handle : '']) }],
      onSubmit: async (v) => { const d = await call('POST', '/api/message/direct', { userId: v.who }); if (!d) return 'That did not open.'; await load(); S.tab = 'dms'; go({ conversationId: d.conversationId }); return null; } });
  }
  // Hand to agent: the chat's hand-off, from a message — a task delegated to the agent, noted in the thread
  async function handOff(messageId) {
    const r = await api('GET', '/api/agents' + (S.ws ? `?workspaceId=${encodeURIComponent(S.ws)}` : '')).catch(() => null);
    const list = ((r && r.ok && r.d.agents) || []).filter((x) => x && x.id);
    if (!list.length) return toast('You have no agents to hand this to yet.');
    const m = S.open && S.open.messages.find((x) => x.id === messageId);
    window.XD.form({ title: 'Hand to an agent', sub: 'It becomes a task delegated to the agent, filed where this channel lives.', submit: 'Hand off',
      fields: [{ id: 'agent', type: 'choice', label: 'Agent', required: true, value: list[0].id, options: list.map((x) => [x.id, x.name || x.displayName || 'Agent', x.description || '']) },
        { id: 'prompt', type: 'textarea', label: 'What should it do?', required: true, rows: 4, max: 20000, value: m ? m.text : '' }],
      onSubmit: async (v) => { const d = await call('POST', '/api/message/handoff', { ...S.openRef, messageId, agentId: v.agent, prompt: v.prompt }); if (!d) return 'That was not handed off.'; toast(d.note); await openRef(S.openRef); go(S.openRef, messageId); return null; } });
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-ms-reload],[data-ms-new],[data-ms-tab],[data-ms-ch],[data-ms-dm],[data-ms-send],[data-ms-reply],[data-ms-close-thread],[data-ms-handoff]');
    if (!t || !(t.closest('[data-ms-page]') || t.closest('#main .topbar') || t.closest('.pg-top-tabs'))) return;
    const d = t.dataset;
    e.preventDefault(); e.stopPropagation();
    if ('msReload' in d) return load();
    if ('msNew' in d) return newMessage();
    if (d.msTab) { S.tab = d.msTab; return paint(); }
    if (d.msCh) return go({ key: d.msCh });
    if (d.msDm) return go({ conversationId: d.msDm });
    if (d.msReply) return go(S.openRef, d.msReply);
    if ('msCloseThread' in d) return go(S.openRef);
    if (d.msHandoff) return handOff(d.msHandoff);
    if ('msSend' in d) {
      const box = t.closest('[data-ms-compose]'), ta = box.querySelector('[data-ms-text]'), parentId = d.msSend || null;
      if (!ta.value.trim()) return toast('Write something first');
      const r = await call('POST', '/api/message/messages', { ...S.openRef, text: ta.value, ...(parentId ? { replyTo: parentId } : {}), clientMessageId: crypto.randomUUID() });
      if (!r) return;
      ta.value = '';
      const keep = S.openRef; await openRef(keep); if (parentId) await openThread(keep, parentId);
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('[data-ms-text]')) { e.preventDefault(); e.target.closest('[data-ms-compose]').querySelector('[data-ms-send]')?.click(); }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
