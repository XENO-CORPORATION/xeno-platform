/* platform-publish.js — on the platform, Social › Publish is XENO Post (post.xenosystem.ai), for real.
 *
 * The picture's Publish area listed three sample posts ("Launch week thread", …) and a badge of 2. Here the area
 * reads and writes /api/publish (routes/publishRoutes.js → services/xenoPost.js), which calls xeno-post
 * server-to-server for the workspace you are in:
 *
 *   status · link (admins)   GET /status · PUT /link
 *   channels · connect       GET /channels · POST /channels/connect → xeno-post's sign-in page for that platform
 *   compose                  POST /posts {text, channelIds, media: Storage file ids} → a draft
 *   schedule                 POST /posts/:id/schedule {at}
 *   publish now · retract    POST /posts/:id/publish|retract {confirm:true} — two clicks: the first arms, the
 *                            second confirms, because both reach an audience and cannot be taken back
 *   approvals                GET /approvals · POST /approvals/:kind/:id {approve, confirm}
 *   inbox                    GET /inbox
 *
 * It registers XENO_ZONE_LIVE['social.publish'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const S = { status: 'idle', ws: undefined, info: null, channels: [], posts: [], approvals: [], inbox: [], files: [], armed: null, busy: false, error: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = () => (S.ws ? `workspace=${encodeURIComponent(S.ws)}` : '');
  const url = (path) => `/api/publish${path}${q() ? (path.includes('?') ? '&' : '?') + q() : ''}`;
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'publish') X().render(); } catch {} };

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const st = await api('GET', url('/status')).catch(() => null);
    if (!st || !st.ok) { S.status = 'error'; S.error = said(st, 'Publish could not be reached.'); return paint(); }
    S.info = st.d;
    if (!S.info.configured || !S.info.linked) { S.status = 'ready'; return paint(); }
    const [ch, po, ap, ib, fl] = await Promise.all(['/channels', '/posts', '/approvals', '/inbox'].map((p) => api('GET', url(p)).catch(() => null)).concat(api('GET', '/api/library/assets?kind=image&limit=40').catch(() => null)));
    if (!ch || !ch.ok) { S.status = 'error'; S.error = said(ch, 'XENO Post did not answer.'); return paint(); }
    S.channels = ch.d.channels || []; S.posts = (po && po.ok && po.d.posts) || []; S.approvals = (ap && ap.ok && ap.d.items) || []; S.inbox = (ib && ib.ok && ib.d.conversations) || [];
    S.files = ((fl && fl.ok && (fl.d.items || fl.d.assets)) || []).filter((f) => !f.mime_type || /^(image|video)\//.test(f.mime_type)).slice(0, 40);
    S.status = 'ready'; navOf(); paint();
  }
  // the Post product's own sidebar: the picture listed three "Connected" channels; here, the workspace's real ones
  function navOf() {
    const N = window.XENO_PRODUCT_NAV && window.XENO_PRODUCT_NAV.post; if (!N) return;
    N.sections = [['Channels', S.channels.map((c) => [c.name + (c.handle ? ' · ' + c.handle : ''), c.status === 'active' ? 'Connected' : c.status])],
      ['Needs approval', S.approvals.map((a) => [a.text || (a.kind === 'proposal' ? 'Proposed time' : 'Post ' + a.postId), a.proposedFor ? when(a.proposedFor) : 'Waiting'])]].filter(([, rows]) => rows.length);
  }
  if (window.XENO_PRODUCT_NAV && window.XENO_PRODUCT_NAV.post) window.XENO_PRODUCT_NAV.post.sections = [];   // never the picture's channels

  const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const STATE = { draft: 'Draft', queued: 'Scheduled', publishing: 'Publishing', published: 'Published', partial: 'Partly published', failed: 'Failed', cancelled: 'Cancelled', retracted: 'Retracted', 'pending-approval': 'Waiting for approval' };
  const rowsFor = () => S.posts.slice(0, 6).map((p) => [p.text.slice(0, 60) || '(no text)', p.proposedFor ? 'Proposed ' + when(p.proposedFor) : p.scheduledFor && p.state === 'queued' ? when(p.scheduledFor) : STATE[p.state] || p.state, null, 'Publish']);

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['social.publish'] = {
    served: true,
    work: () => (S.status === 'ready' && S.info && S.info.linked && S.posts.length ? ['Posts', rowsFor()] : null),
    badge: () => (S.approvals.length || null),
    page: () => page(),
    state: () => ({ status: S.status, linked: !!(S.info && S.info.linked), channels: S.channels.length, posts: S.posts.length, approvals: S.approvals.length }),
    reload: () => load(),
  };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  const armedBtn = (kind, id, label, armedLabel) => S.armed === `${kind}:${id}` ? btn(`data-pub-do="${kind}" data-pub-id="${esc(id)}" data-pub-confirm="1"`, armedLabel, 'btn') : btn(`data-pub-arm="${kind}" data-pub-id="${esc(id)}"`, label);
  function page() {
    const head = `<div class="pj-head"><div><small>Social</small><h1>Publish</h1></div></div><p class="hm-blurb">Schedule and publish to your channels, through XENO Post.</p>`;
    const wrap = (body) => `<div class="wrap pj hm" data-pub-page="${esc(S.status)}">${head}${body}</div>`;
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-pub-error>${esc(S.error)} ${btn('data-pub-reload', 'Try again')}</div>`);
    const I = S.info;
    if (!I.configured) return wrap('<div class="pj-empty" data-pub-state="not-configured">Publishing is not set up on this server yet.</div>');
    if (!I.linked) return wrap(`<div class="pj-empty" data-pub-state="not-linked"><b>This workspace is not linked to XENO Post yet.</b> A workspace admin links it once; after that everyone here publishes through it.
      <div class="pub-link"><input class="in" data-pub-linkid placeholder="XENO Post workspace id or slug" aria-label="XENO Post workspace id or slug"> ${btn('data-pub-link', 'Link workspace', 'btn')}</div></div>`);
    const chans = S.channels.length
      ? S.channels.map((c) => `<li class="pub-ch" data-pub-ch="${esc(c.id)}"><label><input type="checkbox" data-pub-pick="${esc(c.id)}"> <b>${esc(c.name)}</b> <small>${esc(c.platform)}${c.handle ? ' · ' + esc(c.handle) : ''}${c.status !== 'active' ? ' · ' + esc(c.status) : ''}</small></label></li>`).join('')
      : '<li class="pj-empty" data-pub-nochannels>No channels yet. An admin connects one below.</li>';
    const media = S.files.length ? `<details class="pub-media"><summary>Add images or videos from Storage</summary>${S.files.map((f) => `<label><input type="checkbox" data-pub-media="${esc(f.source_id || f.id)}"> ${esc(f.name || f.original_name || 'File')}</label>`).join('')}</details>` : '';
    const posts = S.posts.length ? S.posts.map((p) => `<li class="pub-post" data-pub-post="${esc(p.id)}" data-state="${esc(p.state)}"><div><b>${esc(p.text.slice(0, 140) || '(no text)')}</b><small>${esc(STATE[p.state] || p.state)}${p.scheduledFor ? ' · ' + esc(when(p.scheduledFor)) : ''}${p.proposedFor ? ' · proposed for ' + esc(when(p.proposedFor)) + ' — waiting for approval' : ''}${p.media ? ` · ${p.media} file${p.media > 1 ? 's' : ''}` : ''}</small></div><span class="pub-acts">
        ${p.state === 'draft' || p.state === 'failed' ? `<input type="datetime-local" class="in" data-pub-at="${esc(p.id)}" aria-label="When to publish"> ${btn(`data-pub-schedule="${esc(p.id)}"`, 'Schedule')} ${armedBtn('publish', p.id, 'Publish now', 'Confirm: publish now')}` : ''}
        ${p.state === 'published' || p.state === 'partial' ? armedBtn('retract', p.id, 'Retract', 'Confirm: remove from the platforms') : ''}</span></li>`).join('') : '<li class="pj-empty">No posts yet.</li>';
    const approvals = S.approvals.length ? S.approvals.map((a) => `<li class="pub-appr" data-pub-appr="${esc(a.kind)}:${esc(a.id)}"><div><b>${a.kind === 'proposal' ? 'An agent proposed a time' : 'Approval requested'}</b><small>${esc(a.text || 'Post ' + a.postId)}${a.proposedFor ? ' · ' + esc(when(a.proposedFor)) : ''}</small></div><span class="pub-acts">${armedBtn('approve', a.kind + ':' + a.id, 'Approve', 'Confirm: let it publish')} ${btn(`data-pub-reject="${esc(a.kind)}:${esc(a.id)}"`, 'Reject')}</span></li>`).join('') : '<li class="pj-empty" data-pub-noapprovals>Nothing is waiting for approval.</li>';
    const inbox = S.inbox.length ? S.inbox.map((c) => `<li><b>${esc(c.from)}</b><small>${esc(c.snippet)}${c.at ? ' · ' + esc(when(c.at)) : ''}</small></li>`).join('') : '<li class="pj-empty">No messages.</li>';
    return wrap(`
      <h3>Compose</h3><div class="pub-compose" data-pub-compose><textarea class="in" rows="4" data-pub-text placeholder="What do you want to say?" aria-label="Post text"></textarea>
        <ul class="pub-chs">${chans}</ul>${media}<div>${btn('data-pub-draft', S.busy ? 'Saving…' : 'Save draft', 'btn')}</div></div>
      <h3>Approvals</h3><ul class="pub-list" data-pub-approvals>${approvals}</ul>
      <h3>Posts</h3><ul class="pub-list" data-pub-posts>${posts}</ul>
      <h3>Inbox</h3><ul class="pub-list" data-pub-inbox>${inbox}</ul>
      <h3>Channels</h3><div class="pub-connect">${['x', 'linkedin', 'meta-instagram', 'threads', 'youtube'].map((p) => btn(`data-pub-connect="${p}"`, 'Connect ' + p)).join(' ')}<small> Only workspace admins connect channels.</small></div>`);
  }

  async function send(method, path, body, okMsg) {
    S.busy = true; paint();
    const r = await api(method, url(path), body === undefined ? undefined : withWs(body)).catch(() => null);
    S.busy = false; S.armed = null;
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); paint(); return null; }
    if (okMsg) toast(okMsg);
    await load(); return r.d;
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pub-reload],[data-pub-link],[data-pub-draft],[data-pub-schedule],[data-pub-arm],[data-pub-do],[data-pub-reject],[data-pub-connect]');
    if (!t || !t.closest('[data-pub-page]')) return;
    e.preventDefault(); e.stopPropagation();
    const root = t.closest('[data-pub-page]'), d = t.dataset;
    if ('pubReload' in d) return load();
    if ('pubLink' in d) return send('PUT', '/link', { postWorkspaceId: (root.querySelector('[data-pub-linkid]') || {}).value || '' }, 'Workspace linked to XENO Post');
    if ('pubDraft' in d) {
      const text = (root.querySelector('[data-pub-text]') || {}).value || '', channelIds = [...root.querySelectorAll('[data-pub-pick]:checked')].map((x) => x.dataset.pubPick), media = [...root.querySelectorAll('[data-pub-media]:checked')].map((x) => x.dataset.pubMedia);
      if (!text.trim()) return toast('Write something first');
      if (!channelIds.length) return toast('Choose at least one channel');
      return send('POST', '/posts', { text, channelIds, media, requestKey: 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, 'Draft saved');
    }
    if (d.pubSchedule) { const v = (root.querySelector(`[data-pub-at="${CSS.escape(d.pubSchedule)}"]`) || {}).value; if (!v) return toast('Pick a date and time'); return send('POST', `/posts/${encodeURIComponent(d.pubSchedule)}/schedule`, { at: new Date(v).toISOString() }, 'Scheduled'); }
    if (d.pubArm) { S.armed = `${d.pubArm}:${d.pubId}`; return paint(); }
    if (d.pubDo && d.pubConfirm === '1') {
      if (d.pubDo === 'publish') return send('POST', `/posts/${encodeURIComponent(d.pubId)}/publish`, { confirm: true }, 'Publishing');
      if (d.pubDo === 'retract') return send('POST', `/posts/${encodeURIComponent(d.pubId)}/retract`, { confirm: true }, 'Retracting');
      if (d.pubDo === 'approve') { const [kind, id] = d.pubId.split(':'); return send('POST', `/approvals/${kind}/${encodeURIComponent(id)}`, { approve: true, confirm: true }, 'Approved'); }
    }
    if (d.pubReject) { const [kind, id] = d.pubReject.split(':'); return send('POST', `/approvals/${kind}/${encodeURIComponent(id)}`, { approve: false }, 'Rejected'); }
    if (d.pubConnect) { const r = await send('POST', '/channels/connect', { platform: d.pubConnect }); if (r && r.url) location.assign(r.url); }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
