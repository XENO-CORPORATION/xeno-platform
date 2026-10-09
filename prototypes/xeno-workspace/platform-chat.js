/* XENO_CHAT — the real chat inside the workspace.
 * From disk this does nothing and the workspace keeps its still picture of the chat. Served by the platform it:
 *   1. shows the REAL chat (the platform's React chat: streaming, the queue, questions, the model list from
 *      /api/models, attachments, artifacts) in the main area, in place of the picture;
 *   2. fills the chat sidebar (Projects · Recents) with the person's real conversations;
 *   3. keeps the address in step: a conversation has a link, and reload, Back and Forward return to it.
 *
 * HOW. The chat is a React app and the workspace is plain scripts, so the chat runs in a same-origin frame
 * showing /overview/chat/…, where the app drops its own shell (src/lib/workspaceEmbed.ts). The frame is ONE
 * element that lives for the whole visit: the workspace rebuilds its main area on every navigation, and a frame
 * inside it would reload and lose a half-typed message or a running answer. So the frame sits above the page,
 * placed exactly over the chat's slot (`.live-chat-host[data-chat-frame]`), and is hidden, not removed, when
 * another page is showing.
 *
 * WHO OWNS HISTORY. The frame pushes an entry when the conversation changes; the workspace mirrors it into its
 * own address with replaceState. One entry per conversation, so Back steps through conversations once.
 *
 * Named stand-in, with its exit: the frame is how two runtimes share a page. It goes when the workspace moves
 * onto the XENO framework and mounts the chat as a component.
 *
 * Routes read here: GET /api/chat/conversations · GET /api/chat/projects. Everything else is the chat's own. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_CHAT = { served: false }; return; }
  const X = () => window.XW, api = P.api;
  const NEW = '/overview/chat/llm';
  const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
  const S = { status: 'loading', convs: [], projects: [], current: null, path: null, total: 0 };

  // ---------- the list ----------
  const DAY = 86400000;
  const group = (iso) => { const t = new Date(iso).getTime(), d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = d0.getTime(); if (!Number.isFinite(t)) return 'Earlier'; if (t >= start) return 'Today'; if (t >= start - DAY) return 'Yesterday'; if (t >= start - 7 * DAY) return 'Previous 7 days'; if (t >= start - 30 * DAY) return 'Previous 30 days'; return 'Earlier'; };
  const titleOf = (c) => String(c.title || '').trim() || 'New chat';
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const [cv, pj] = await Promise.all([api('GET', '/api/chat/conversations?limit=200').catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/projects').catch(() => ({ ok: false, d: {} }))]);
      if (!cv.ok || !Array.isArray(cv.d.conversations)) { S.status = 'error'; }
      else { S.convs = cv.d.conversations; S.total = Number(cv.d.total) || S.convs.length; S.projects = pj.ok && Array.isArray(pj.d.projects) ? pj.d.projects : []; S.status = 'ready'; }
      loading = null; repaint();
    })();
    return loading;
  }
  const repaint = () => { try { X()?.refreshPanel?.(); const c = document.querySelector('#main .crumbs'); if (c && X()?.crumbs) c.innerHTML = X().crumbs(); } catch {} };
  // the shape the sidebar draws: projects with their chats, then the rest by day
  function data() {
    const byProject = new Map(); const loose = [];
    for (const c of S.convs) { if (c.project_id) { if (!byProject.has(c.project_id)) byProject.set(c.project_id, []); byProject.get(c.project_id).push(c); } else loose.push(c); }
    const row = (c) => ({ t: titleOf(c), id: c.id });
    const projects = S.projects.filter((p) => !p.archived_at && !p.is_archived).map((p) => [String(p.name || 'Project'), p.id, (byProject.get(p.id) || []).map(row)]);
    const recents = []; for (const c of loose) { const g = group(c.last_message_at || c.updated_at || c.created_at); const last = recents[recents.length - 1]; if (last && last[0] === g) last[1].push(row(c)); else recents.push([g, [row(c)]]); }
    return { live: true, status: S.status, current: S.current, projects, pinned: [], recents, more: Math.max(0, S.total - S.convs.length) };
  }
  const title = (id) => { const c = S.convs.find((x) => x.id === id); return c ? titleOf(c) : id ? 'Chat' : null; };
  const projectId = (name) => S.projects.find((p) => p.name === name)?.id || null;

  // ---------- the frame ----------
  const style = document.createElement('style');
  style.textContent = '#xw-chat-frame{position:fixed;z-index:2;border:0;margin:0;padding:0;background:transparent;color-scheme:dark;visibility:hidden;pointer-events:none}'
    + '#xw-chat-frame.on{visibility:visible;pointer-events:auto}'
    + 'html.modal-open #xw-chat-frame{pointer-events:none}'
    + '.live-chat-host[data-chat-frame]{display:grid;place-items:center;color:var(--dim);font-size:13px}'
    // on the live chat the "areas still show sample data" note is untrue and would sit on the composer;
    // and the top bar's sample Share and More give way to the chat's own, which work
    + 'html.xw-chat-on #xp-note{display:none}html.xw-chat-on #main .topbar > .ib:not(.opener){display:none}';
  document.head.appendChild(style);
  let frame = null, loaded = false, slot = null, ro = null, hideT = 0;
  const pathFor = (id) => (id && ID.test(id) ? '/overview/c/' + encodeURIComponent(id) : NEW);
  const idIn = (path) => { const m = String(path || '').match(/\/(?:c|llm)\/([^/?#]+)$/); if (!m) return null; let v = m[1]; try { v = decodeURIComponent(v); } catch {} return ID.test(v) ? v : null; };
  function ensureFrame(path) {
    if (frame) return frame;
    frame = document.createElement('iframe'); frame.id = 'xw-chat-frame'; frame.title = 'Chat'; frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone');
    frame.addEventListener('load', () => { loaded = true; });
    frame.src = path; document.body.appendChild(frame);
    return frame;
  }
  // go to a conversation inside the running chat: no reload, the chat's own router picks it up
  function show(path, replace) {
    if (!frame) { ensureFrame(path); return; }
    let w = null; try { w = frame.contentWindow; if (!loaded || !w || !w.history || w.location.origin !== location.origin) w = null; } catch { w = null; }
    if (!w) { loaded = false; frame.src = path; return; }
    if (w.location.pathname === path) return;
    try { w.history[replace ? 'replaceState' : 'pushState']({}, '', path); w.dispatchEvent(new w.PopStateEvent('popstate', { state: {} })); } catch { loaded = false; frame.src = path; }
  }
  function place() {
    const el = document.querySelector('#main .live-chat-host[data-chat-frame]');
    if (!el) { if (slot) { slot = null; ro?.disconnect(); } clearTimeout(hideT); hideT = setTimeout(() => { if (!document.querySelector('#main .live-chat-host[data-chat-frame]')) { frame?.classList.remove('on'); document.documentElement.classList.remove('xw-chat-on'); } }, 160); return; }
    clearTimeout(hideT);
    if (el !== slot) { slot = el; ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(el); ro.observe(document.getElementById('main')); }
    const want = X()?.S?.item || null;
    if (!frame) ensureFrame(pathFor(want)); else if ((want || null) !== (S.current || null)) show(pathFor(want), true);   // the address changed (Back, a link): follow it
    S.current = want;
    fit(); frame.classList.add('on'); document.documentElement.classList.add('xw-chat-on');
  }
  function fit() {
    if (!slot || !frame) return; const r = slot.getBoundingClientRect(), main = document.getElementById('main');
    Object.assign(frame.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
    if (main) { const br = getComputedStyle(main).borderBottomLeftRadius; frame.style.borderRadius = `0 0 ${br} ${br}`; }
  }
  addEventListener('resize', fit);
  const watch = () => { const main = document.getElementById('main'); if (!main) return setTimeout(watch, 50); new MutationObserver(place).observe(main, { childList: true }); main.addEventListener('transitionend', fit); place(); };

  // ---------- the chat tells the workspace where it is ----------
  let reloadT = 0;
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const m = e.data; if (!m || m.source !== 'xeno-chat') return;
    if (m.type === 'location') {
      const id = idIn(m.path); S.path = m.path;
      if (id !== S.current) { S.current = id; X()?.setChatItem?.(id); }
      // a conversation that is not in the list yet was just started; and a title may have been written
      clearTimeout(reloadT); reloadT = setTimeout(load, id && !S.convs.some((c) => c.id === id) ? 600 : 2500);
      repaint();
    }
    if (m.type === 'changed') { clearTimeout(reloadT); reloadT = setTimeout(load, 300); }
  });
  addEventListener('focus', () => { if (S.status !== 'loading') load(); });

  // ---------- the sidebar's clicks ----------
  const toChat = (item) => { const x = X(); if (!x) return; if (!(x.S.view === 'product' && x.S.product === 'chat')) x.go('product', { product: 'chat', item: item || null }); else if ((x.S.item || null) !== (item || null)) x.setChatItem?.(item || null); };
  function open(id) { S.current = id || null; toChat(id || null); show(pathFor(id), false); repaint(); }
  function openProject(name) { const pid = projectId(name); if (!pid) return false; S.current = null; toChat(null); show('/overview/chat/projects/' + encodeURIComponent(pid), false); return true; }
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-chat-live]'); if (row) { e.preventDefault(); e.stopPropagation(); return open(row.dataset.chatLive); }
    if (e.target.closest('[data-chat-retry]')) { e.preventDefault(); e.stopPropagation(); S.status = 'loading'; repaint(); return void load(); }
    const fresh = e.target.closest('[data-newchat]'); if (fresh) { e.preventDefault(); e.stopPropagation(); return open(null); }
    const inP = e.target.closest('[data-newin]'); if (inP && openProject(inP.dataset.newin)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  window.XENO_CHAT = { served: true, data, title, open, load, host: () => '<div class="live-chat-host" data-chat-frame aria-label="Chat"></div>', state: () => ({ status: S.status, count: S.convs.length, current: S.current, path: S.path, shown: !!frame && frame.classList.contains('on') }) };
  Promise.resolve(P.ready).then((user) => { if (!user) return; P.first(load()); watch(); });
})();
