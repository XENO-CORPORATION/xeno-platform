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
 * THE COMPOSER IS THE ONE DESIGNED IN THIS WORKSPACE. The chat's input box is restyled by this page's own rules
 * (index.html, every rule whose selector names `.live-chat`): the 6px box with a hairline, 13px text, the compact
 * 24px controls, no inner top bar. Those rules were written against a still picture of the chat. The real chat has
 * the same markup, so the SAME rules are handed to it (`dress`): read from this page's stylesheets, re-aimed at the
 * chat's root, and injected into the frame with the theme colours they use. One source for the design; nothing is
 * copied into the chat's own code. What the box DOES is the real chat's: send, stop, the queue, questions, models.
 *
 * Routes used here: GET /api/chat/conversations · GET /api/chat/projects · PUT and DELETE /api/chat/conversations/:id
 * (rename and delete from the sidebar, since the chat's own top bar is not shown). Everything else is the chat's own. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_CHAT = { served: false }; return; }
  const X = () => window.XW, api = P.api;
  const NEW = '/overview/chat/llm';
  const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
  const S = { status: 'loading', convs: [], projects: [], current: null, path: null, total: 0, picker: null, area: undefined };
  // ---------- the AREA: each has its own chats and projects; Overview shows everything ----------
  // Owner's rule (2026-10-03, 2026-10-09). The area is the place in the left rail the person is in (Studio, Office,
  // Dev… or one they made); on Overview there is none. The real chat reads this when it creates a chat or a project.
  const AREA_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;
  const area = () => { let k = null; try { k = X()?.ctxKey?.(); } catch {} return typeof k === 'string' && k !== 'overview' && k !== 'adaptive' && AREA_SHAPE.test(k) ? k : null; };
  const areaName = (id) => { if (!id) return ''; try { const m = X()?.M?.[id]; if (m && m.name) return m.name; const c = (window.XENO_CUSTOM?.list?.() || []).find((x) => x.id === id); if (c) return c.name; } catch {} return id.charAt(0).toUpperCase() + id.slice(1); };
  const areas = () => { const out = []; try { for (const m of window.XENO_MODES || []) out.push([m.id, areaName(m.id)]); for (const c of window.XENO_CUSTOM?.list?.() || []) if (AREA_SHAPE.test(c.id)) out.push([c.id, c.name]); } catch {} return out; };

  // ---------- the list ----------
  const DAY = 86400000;
  const group = (iso) => { const t = new Date(iso).getTime(), d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = d0.getTime(); if (!Number.isFinite(t)) return 'Earlier'; if (t >= start) return 'Today'; if (t >= start - DAY) return 'Yesterday'; if (t >= start - 7 * DAY) return 'Previous 7 days'; if (t >= start - 30 * DAY) return 'Previous 30 days'; return 'Earlier'; };
  const titleOf = (c) => String(c.title || '').trim() || 'New chat';
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const here = area(), q = here ? '&area=' + encodeURIComponent(here) : '';   // one area, or everything on Overview
      const [cv, pj] = await Promise.all([api('GET', '/api/chat/conversations?limit=200' + q).catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/projects?limit=100' + q).catch(() => ({ ok: false, d: {} }))]);
      if (here !== area()) { loading = null; return load(); }   // the person moved to another area while this was on its way
      S.area = here;
      if (!cv.ok || !Array.isArray(cv.d.conversations)) { S.status = 'error'; }
      else { S.convs = cv.d.conversations; S.total = Number(cv.d.total) || S.convs.length; S.projects = pj.ok && Array.isArray(pj.d.projects) ? pj.d.projects : []; S.status = 'ready'; }
      loading = null; repaint();
    })();
    return loading;
  }
  const repaint = () => { try { X()?.refreshPanel?.(); const c = document.querySelector('#main .crumbs'); if (c && X()?.crumbs) c.innerHTML = X().crumbs(); } catch {} paintViewer(); };
  // ---------- a file preview inside the chat: this page's header is its header ----------
  // The trail gains the file's name (the step before it walks back out of the preview), and the bar shows the
  // preview's three actions in place of the conversation's. The chat draws no header of its own here.
  function paintViewer() {
    const bar = document.querySelector('#main .topbar'); if (!bar) return;
    const v = S.viewer, esc = X()?.esc || ((s) => String(s)), ic = X()?.ic || (() => '');
    bar.classList.toggle('viewing', !!v);
    let box = bar.querySelector('.tb-viewer');
    const c = bar.querySelector('.crumbs');
    if (c && c.querySelector('[data-viewer-name]')) { try { if (X()?.crumbs) c.innerHTML = X().crumbs(); } catch {} }
    if (!v) { if (box) box.remove(); return; }
    if (c) { const last = c.querySelector('b:last-of-type'); if (last) { const a = document.createElement('a'); a.setAttribute('data-viewer-close', ''); a.textContent = last.textContent; last.replaceWith(a); }
      c.insertAdjacentHTML('beforeend', '<span class="sep">/</span><b data-viewer-name>' + esc(v.name) + '</b>'); }
    if (!box) { box = document.createElement('span'); box.className = 'tb-viewer'; bar.appendChild(box); }
    const dis = v.canExport ? '' : ' disabled';
    box.innerHTML = '<button class="ib" data-viewer-copy aria-label="Copy share link" data-tip="Copy share link"' + dis + '>' + ic('link') + '</button>'
      + '<button class="ib" data-viewer-download aria-label="Download" data-tip="Download"' + dis + '>' + ic('download') + '</button>'
      + '<button class="ib" data-viewer-close aria-label="Close preview" data-tip="Close preview" data-kbd="Esc">' + ic('x') + '</button>';
  }
  document.addEventListener('click', (e) => {
    if (!S.viewer) return; const t = e.target.closest('#main .topbar [data-viewer-close], #main .topbar [data-viewer-copy], #main .topbar [data-viewer-download]'); if (!t || t.disabled) return;
    e.preventDefault(); e.stopPropagation();
    toChatFrame({ type: t.hasAttribute('data-viewer-copy') ? 'viewer-copy' : t.hasAttribute('data-viewer-download') ? 'viewer-download' : 'viewer-close' });
  }, true);
  // the shape the sidebar draws: projects with their chats, then the rest by day
  function data() {
    const byProject = new Map(); const loose = [];
    for (const c of S.convs) { if (c.project_id) { if (!byProject.has(c.project_id)) byProject.set(c.project_id, []); byProject.get(c.project_id).push(c); } else loose.push(c); }
    const all = !area();   // on Overview each row says where it lives
    const row = (c) => ({ t: titleOf(c), id: c.id, area: all && c.area ? areaName(c.area) : '' });
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
    + '#main .topbar.viewing [data-chat-transcript],#main .topbar.viewing > .ib[aria-label="Share"],#main .topbar.viewing > .ib[aria-label="More"]{display:none}'
    + '#main .topbar .tb-viewer{display:inline-flex;align-items:center;gap:2px}#main .topbar .tb-viewer .ib:disabled{opacity:.3;cursor:not-allowed}#main .topbar .crumbs a[data-viewer-close]{cursor:pointer}'
    // While the chat is loading, the frame is kept clear and the XENO mark loader stands in its place: the chat's
    // own loading screen is never the one seen here (owner, 2026-10-09). Both fade over 200ms when it is ready.
    + '#xw-chat-frame{opacity:0;transition:opacity .2s ease-out}#xw-chat-frame.ready{opacity:1}'
    + '#xw-chat-loading{position:fixed;z-index:3;display:grid;place-items:center;pointer-events:none;color:var(--text);opacity:0;visibility:hidden;transition:opacity .2s ease-out,visibility 0s .2s}'
    + '#xw-chat-loading.show{opacity:1;visibility:visible;transition:opacity .2s ease-out}'
    + 'html.modal-open #xw-chat-frame{pointer-events:none}'
    + '.live-chat-host[data-chat-frame]{display:grid;place-items:center;color:var(--dim);font-size:13px}'
    // on the live chat the "areas still show sample data" note is untrue and would sit on the composer;
    // and the top bar's sample Share and More give way to the chat's own, which work
    // Copy transcript sits in the middle of the top bar, whatever the path on its left and the actions on its right take
    + '.topbar .tb-mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;white-space:nowrap;cursor:pointer}'
    + '.topbar .tb-mid:hover{color:var(--text);background:var(--hover)}.topbar .tb-mid:focus-visible{outline:1px solid var(--text);outline-offset:2px}.topbar .tb-mid svg.i{width:13px;height:13px}.topbar .tb-mid.done{color:var(--text)}'
    + '@media (max-width:1100px){.topbar .tb-mid span{display:none}.topbar .tb-mid{padding:0 8px}}'
    + 'html.xw-chat-on #xp-note{display:none}html.xw-chat-on #main .topbar > .ib[aria-label="More"]{display:none}';
  document.head.appendChild(style);
  let frame = null, loaded = false, slot = null, ro = null, hideT = 0;
  const pathFor = (id) => (id && ID.test(id) ? '/overview/c/' + encodeURIComponent(id) : NEW);
  const idIn = (path) => { const m = String(path || '').match(/\/(?:c|llm)\/([^/?#]+)$/); if (!m) return null; let v = m[1]; try { v = decodeURIComponent(v); } catch {} return ID.test(v) ? v : null; };
  // ---------- the composer design, handed to the real chat ----------
  // every rule this page wrote for `.live-chat`, re-aimed at the chat's own root. Rules about the slot the picture
  // sat in (`.live-chat-host`, `.main …`) are this page's layout and stay here.
  const BARE = /^(html body )?\.live-chat(\s+|\s*>\s*)(\*|[a-z][a-z0-9]*)?(::?[a-z-]+(\([^)]*\))?)*$/i;
  function composerRules() {
    const out = [];
    const take = (rules) => { for (const r of rules) {
      if (r.cssRules && r.media) { const inner = []; const keep = out.length; take(r.cssRules); const got = out.splice(keep); if (got.length) out.push(`@media ${r.media.mediaText}{${got.join('')}}`); continue; }
      const sel = r.selectorText; if (!sel || !sel.includes('.live-chat') || sel.includes('.live-chat-host') || /(^|,)\s*(html body )?\.main /.test(sel)) continue;
      // Not the picture's element-wide resets ("every button has no padding", "every list has no bullets"): the
      // real chat has its own, and these, one class heavier, flattened its own components (the queue's header
      // bar lost its padding: 20px tall instead of 42, 2026-10-09). Only rules that name something are handed over.
      // (Rules about the text field alone stay: those are the composer's design, not a reset.)
      { const parts = sel.split(',').map((part) => part.trim().match(BARE));
        if (parts.every(Boolean) && !parts.every((m) => /^(textarea|input)$/i.test(m[3] || ''))) continue; }
      out.push(r.cssText.replace(sel, sel.split('.live-chat').join('.chat-themed'))); } };
    // `live-chat-css` is the picture's frozen COPY of the chat's whole stylesheet. The real chat has the current
    // one; handing the old copy back, one class heavier, overrode it (the answer's first paragraph gained a 17px
    // top margin under "Worked for", 2026-10-09). Only this page's own rules for the composer are handed over.
    for (const sheet of document.styleSheets) { if (sheet.ownerNode && sheet.ownerNode.id === 'live-chat-css') continue; let rules = null; try { rules = sheet.cssRules; } catch { continue; } if (rules) take(rules); }
    // the send button: the picture marked it ready with a class; the real one is simply not disabled
    // (the attribute is repeated to outweigh the idle rule above, which repeats its own three times)
    out.push('html body .chat-themed button[data-composer-send-button][data-composer-send-button][data-composer-send-button][data-composer-send-button]:not(:disabled){background:var(--n233)!important;color:var(--n9)!important}');
    // the chat's own history panel is not shown here (this page's sidebar is the history), so neither is its opener
    out.push('html body .chat-themed button[aria-label="Open conversation history"]{display:none!important}');
    // the app's own page-loading bar is never the loading state seen here: this page's loader is
    out.push('html body .route-loading{display:none!important}');
    return out.join('\n');
  }
  function dress() {
    let d = null; try { d = frame && frame.contentDocument; } catch {} if (!d || !d.documentElement) return;
    const css = composerRules();
    // the colours those rules name are this page's theme colours: hand over each one they use, as it is now
    const cs = getComputedStyle(document.documentElement), names = new Set(css.match(/--[a-z0-9-]+/gi) || []);
    for (let grew = true; grew;) { grew = false; for (const n of [...names]) for (const m of (cs.getPropertyValue(n).match(/--[a-z0-9-]+/gi) || [])) if (!names.has(m)) { names.add(m); grew = true; } }
    const vars = [...names].map((n) => { const v = cs.getPropertyValue(n).trim(); return v ? `${n}:${v}` : ''; }).filter(Boolean).join(';');
    let s = d.getElementById('xw-composer'); if (!s) { s = d.createElement('style'); s.id = 'xw-composer'; (d.head || d.documentElement).appendChild(s); }
    const text = `:root{${vars}}\n${css}`; if (s.textContent !== text) s.textContent = text;
  }
  addEventListener('xeno_platform_theme_change', () => setTimeout(dress, 0));
  addEventListener('storage', (e) => { if (e.key === 'xeno_platform_theme' || e.key === 'xeno_platform_theme_brightness') setTimeout(dress, 0); });
  // ---------- the loading moment: the XENO mark loader, from the first instant until the chat is on the page ----------
  let loadingEl = null, stopLoader = null, readyT = 0;
  // READY means the chat's own input box is on the page. Not `.chat-themed` alone: the app's page-loading state (a thin
  // bar across the top, `.route-loading`) carries that class too, so the loader left early and revealed that bar
  // (owner's report, 2026-10-09).
  const chatReady = () => { try { const d = frame && frame.contentDocument; return !!(loaded && d && d.querySelector('[data-chat-composer-shell], [data-chat-route-notice]:not([data-chat-route-notice$="loading"])')); } catch { return false; } };
  function showLoading() {
    if (!frame) return;
    frame.classList.remove('ready');
    if (!loadingEl) { loadingEl = document.createElement('div'); loadingEl.id = 'xw-chat-loading'; loadingEl.setAttribute('role', 'status'); loadingEl.setAttribute('aria-label', 'Loading chat'); document.body.appendChild(loadingEl); }
    if (!stopLoader && window.XENO_MARK_LOADER) stopLoader = window.XENO_MARK_LOADER.mount(loadingEl, { size: 88, label: 'Loading chat' });
    loadingEl.classList.toggle('show', frame.classList.contains('on')); fit();
    clearInterval(readyT); readyT = setInterval(() => { if (chatReady()) hideLoading(); else if (loadingEl) loadingEl.classList.toggle('show', frame.classList.contains('on')); }, 60);
  }
  function hideLoading() {
    clearInterval(readyT); readyT = 0; if (frame) frame.classList.add('ready');
    if (loadingEl) { loadingEl.classList.remove('show'); const stop = stopLoader; stopLoader = null; setTimeout(() => { if (stop && !stopLoader) stop(); else if (stop) stop(); }, 220); }
  }
  function ensureFrame(path) {
    if (frame) return frame;
    frame = document.createElement('iframe'); frame.id = 'xw-chat-frame'; frame.title = 'Chat'; frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone');
    frame.addEventListener('load', () => { loaded = true; dress(); });
    frame.src = path; document.body.appendChild(frame); showLoading();
    return frame;
  }
  // go to a conversation inside the running chat: no reload, the chat's own router picks it up
  function show(path, replace) {
    if (!frame) { ensureFrame(path); return; }
    let w = null; try { w = frame.contentWindow; if (!loaded || !w || !w.history || w.location.origin !== location.origin) w = null; } catch { w = null; }
    if (!w) { loaded = false; frame.src = path; showLoading(); return; }
    if (w.location.pathname === path) return;
    try { w.history[replace ? 'replaceState' : 'pushState']({}, '', path); w.dispatchEvent(new w.PopStateEvent('popstate', { state: {} })); } catch { loaded = false; frame.src = path; showLoading(); }
  }
  function place() {
    const el = document.querySelector('#main .live-chat-host[data-chat-frame]');
    if (!el) { if (slot) { slot = null; ro?.disconnect(); } clearTimeout(hideT); hideT = setTimeout(() => { if (!document.querySelector('#main .live-chat-host[data-chat-frame]')) { frame?.classList.remove('on'); document.documentElement.classList.remove('xw-chat-on'); } }, 160); return; }
    clearTimeout(hideT);
    if (el !== slot) { slot = el; ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(el); ro.observe(document.getElementById('main')); }
    // moved to another area: its own list, not the last one's
    if (S.area !== undefined && S.area !== area() && !loading) { S.status = 'loading'; S.convs = []; S.projects = []; S.total = 0; load(); }
    const want = X()?.S?.item || null;
    if (!frame) ensureFrame(pathFor(want)); else if ((want || null) !== (S.current || null)) show(pathFor(want), true);   // the address changed (Back, a link): follow it
    S.current = want;
    fit(); frame.classList.add('on'); document.documentElement.classList.add('xw-chat-on'); paintViewer();
  }
  function fit() {
    if (!slot || !frame) return; const r = slot.getBoundingClientRect(), main = document.getElementById('main');
    Object.assign(frame.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
    if (main) { const br = getComputedStyle(main).borderBottomLeftRadius; frame.style.borderRadius = `0 0 ${br} ${br}`; }
    if (loadingEl) Object.assign(loadingEl.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
  }
  addEventListener('resize', fit);
  const watch = () => { const main = document.getElementById('main'); if (!main) return setTimeout(watch, 50); new MutationObserver(place).observe(main, { childList: true }); main.addEventListener('transitionend', fit); place(); };

  // ---------- the chat tells the workspace where it is ----------
  let reloadT = 0;
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const m = e.data; if (!m || m.source !== 'xeno-chat') return;
    if (m.type === 'location') {
      dress();
      const id = idIn(m.path); S.path = m.path;
      if (id !== S.current) { S.current = id; X()?.setChatItem?.(id); }
      // a conversation that is not in the list yet was just started; and a title may have been written
      clearTimeout(reloadT); reloadT = setTimeout(load, id && !S.convs.some((c) => c.id === id) ? 600 : 2500);
      repaint();
    }
    if (m.type === 'changed') { clearTimeout(reloadT); reloadT = setTimeout(load, 300); }
    // the chat's model trigger was pressed: this page's own menu opens, with the chat's real list
    if (m.type === 'model-menu' && Array.isArray(m.models) && m.rect) {
      if (X()?.modelMenuOpen?.()) return void X().closeModelMenu();
      const f = frame.getBoundingClientRect(), r = m.rect;   // the trigger's place, in this page's coordinates
      const box = { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height };
      S.picker = { models: m.models.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, name: String(x.name || x.id), description: String(x.description || ''), contextWindow: Number(x.contextWindow) || 0, ownKey: !!x.ownKey })), selected: String(m.selected || ''), anchor: { getBoundingClientRect: () => box } };
      X()?.openModelMenu?.(S.picker.anchor);
    }
    if (m.type === 'model-menu-close') X()?.closeModelMenu?.();
    if (m.type === 'viewer') { S.viewer = m.open && typeof m.name === 'string' && m.name ? { name: m.name.slice(0, 200), canExport: !!m.canExport } : null; paintViewer(); }
    if (m.type === 'viewer-copied' && S.viewer) X()?.toast?.('Link copied');
    // the chat's effort pill was pressed: this page's own effort menu opens, on the chat's real levels
    if (m.type === 'effort-menu' && Array.isArray(m.levels) && m.levels.length && m.rect) {
      const f = frame.getBoundingClientRect(), r = m.rect;
      const box = { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height };
      S.effort = { levels: m.levels.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, label: String(x.label || x.id), title: String(x.title || '') })), selected: String(m.selected || ''), anchor: { getBoundingClientRect: () => box } };
      X()?.openEffortMenu?.(S.effort.anchor);
    }
    if (m.type === 'effort-menu-close' && S.effort) X()?.closeModelMenu?.();
    if (m.type === 'transcript' && typeof m.text === 'string' && askedTranscript) copied(m.text);
  });
  addEventListener('focus', () => { if (S.status !== 'loading') load(); });

  // ---------- the sidebar's clicks ----------
  const toChat = (item) => { const x = X(); if (!x) return; if (!(x.S.view === 'product' && x.S.product === 'chat')) x.go('product', { product: 'chat', item: item || null }); else if ((x.S.item || null) !== (item || null)) x.setChatItem?.(item || null); };
  function open(id) { S.current = id || null; toChat(id || null); show(pathFor(id), false); repaint(); }
  function openProject(name) { const pid = projectId(name); if (!pid) return false; S.current = null; toChat(null); show('/overview/chat/projects/' + encodeURIComponent(pid), false); return true; }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) return;   // the row's menu button is the app's: it opens the menu registered below
    const row = e.target.closest('[data-chat-live]'); if (row) { e.preventDefault(); e.stopPropagation(); return open(row.dataset.chatLive); }
    if (e.target.closest('[data-chat-retry]')) { e.preventDefault(); e.stopPropagation(); S.status = 'loading'; repaint(); return void load(); }
    const fresh = e.target.closest('[data-newchat]'); if (fresh) { e.preventDefault(); e.stopPropagation(); return open(null); }
    const inP = e.target.closest('[data-newin]'); if (inP && openProject(inP.dataset.newin)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Share, in this page's top bar, is the chat's own Share: the chat's top bar is not shown, its button still works
  document.addEventListener('click', (e) => {
    const share = e.target.closest('#main .topbar > .ib[aria-label="Share"]'); if (!share || !document.documentElement.classList.contains('xw-chat-on')) return;
    e.preventDefault(); e.stopPropagation();
    let b = null; try { b = frame.contentDocument.querySelector('.chat-top-bar [aria-label*="Share" i], .chat-top-bar [title*="Share" i]'); } catch {}
    if (b) b.click(); else X()?.toast?.(S.current ? 'Sharing isn’t available for this chat yet' : 'Send a message first, then share the chat');
  }, true);

  // ---------- Copy transcript, in this page's top bar ----------
  // The chat builds the transcript (its own button's logic, the button itself is not shown); this page asked for it
  // from a press here, so this page writes the clipboard and says what happened.
  let askedTranscript = 0, transcriptT = 0;
  const mark = (text, done) => { const b = document.querySelector('#main .topbar [data-chat-transcript]'); if (!b) return; const s = b.querySelector('span'); if (s) s.textContent = text; b.classList.toggle('done', !!done); };
  async function copied(text) {
    clearTimeout(transcriptT); askedTranscript = 0;
    try { await navigator.clipboard.writeText(text); mark('Copied', true); } catch { mark('Copy transcript', false); return void X()?.toast?.('The transcript couldn’t be copied. Your browser blocked the clipboard.'); }
    setTimeout(() => mark('Copy transcript', false), 2200);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#main .topbar [data-chat-transcript]'); if (!b) return; e.preventDefault(); e.stopPropagation();
    let real = null; try { real = frame.contentDocument.querySelector('[aria-label="Copy Session Transcript"]'); } catch {}
    if (!real) return void X()?.toast?.('The chat is still opening. Try again in a moment.');
    askedTranscript = 1; clearTimeout(transcriptT); transcriptT = setTimeout(() => { if (askedTranscript) { askedTranscript = 0; X()?.toast?.('The transcript couldn’t be copied.'); } }, 4000);
    real.click();
  }, true);

  // ---------- rename and delete, from the sidebar ----------
  const say = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  async function rename(id) {
    const c = S.convs.find((x) => x.id === id); if (!c) return;
    await window.XD.form({ title: 'Rename chat', submit: 'Rename', size: 'sm', fields: [{ id: 'name', label: 'Name', value: titleOf(c), required: true, max: 200 }],
      onSubmit: async (v) => { const r = await api('PUT', '/api/chat/conversations/' + encodeURIComponent(id), { title: String(v.name).trim() }).catch(() => null); if (!r || !r.ok) return say(r, 'The chat couldn’t be renamed.'); c.title = String(v.name).trim(); repaint(); return null; } });
    load();
  }
  async function remove(id) {
    const c = S.convs.find((x) => x.id === id); if (!c) return;
    const yes = await window.XD.confirm({ title: `Delete “${titleOf(c)}”?`, body: 'The chat and its messages are deleted. This can’t be undone.', action: 'Delete chat', danger: true }); if (!yes) return;
    const r = await api('DELETE', '/api/chat/conversations/' + encodeURIComponent(id)).catch(() => null);
    if (!r || !r.ok) return void X()?.toast?.(say(r, 'The chat couldn’t be deleted. Nothing changed.'));
    S.convs = S.convs.filter((x) => x.id !== id); S.total = Math.max(0, S.total - 1);
    if (S.current === id) open(null); else repaint();
    X()?.toast?.('Chat deleted'); load();
  }
  // move a chat to another area, or to none (then it shows on Overview only)
  async function move(id) {
    const c = S.convs.find((x) => x.id === id); if (!c) return;
    if (c.project_id) return void X()?.toast?.('This chat is in a project and lives where the project lives. Move the project instead.');
    const options = [['none', 'No area', 'Shown on Overview only'], ...areas().map(([v, l]) => [v, l, ''])];
    await window.XD.form({ title: 'Move chat', submit: 'Move', size: 'sm', fields: [{ id: 'area', type: 'choice', label: 'Area', value: c.area || 'none', options, cols: 2 }],
      onSubmit: async (v) => { const to = v.area === 'none' ? null : v.area; const r = await api('PUT', '/api/chat/conversations/' + encodeURIComponent(id), { area: to }).catch(() => null); if (!r || !r.ok) return say(r, 'The chat couldn’t be moved. Nothing changed.');
        c.area = to; if (area() && to !== area()) { S.convs = S.convs.filter((x) => x.id !== id); S.total = Math.max(0, S.total - 1); } repaint(); X()?.toast?.(to ? 'Moved to ' + areaName(to) : 'Moved out of every area'); return null; } });
    load();
  }
  const menu = () => { const C = window.XCM; if (!C || !C.register) return; C.register({ id: 'chat-live', sel: '[data-chat-live]', priority: 3, build: (n) => { const id = n.dataset.chatLive;
    return [[{ label: 'Open', icon: 'chat', run: () => open(id) }, { label: 'Copy link', icon: 'link', run: () => C.H.copy(location.origin + location.pathname + '#/' + (X().inOv() ? 'overview' : X().S.mode) + '/p/chat/' + encodeURIComponent(id), 'Link copied') }],
      [{ label: 'Rename', icon: 'edit', run: () => rename(id) }, { label: 'Move to…', icon: 'folder', run: () => move(id) }], [{ label: 'Delete', icon: 'trash', danger: true, run: () => remove(id) }]]; } }); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', menu); else menu();

  const toChatFrame = (msg) => { try { frame.contentWindow.postMessage({ source: 'xeno-workspace', ...msg }, location.origin); } catch {} };
  const pickModel = (id) => toChatFrame({ type: 'pick-model', id });
  const pickerClosed = () => { if (S.effort) { S.effort = null; toChatFrame({ type: 'effort-menu-closed' }); } if (S.picker) { S.picker = null; toChatFrame({ type: 'model-menu-closed' }); } };
  const pickEffort = (id) => { if (S.effort) S.effort.selected = id; toChatFrame({ type: 'pick-effort', id }); };
  window.XENO_CHAT = { served: true, area, get picker() { return S.picker; }, get effort() { return S.effort || null; }, pickModel, pickEffort, pickerClosed, data, title, open, load, rename, remove, dress, host: () => '<div class="live-chat-host" data-chat-frame aria-label="Chat"></div>', state: () => ({ area: area(), listed: S.area, viewer: S.viewer || null, ready: chatReady(), status: S.status, count: S.convs.length, current: S.current, path: S.path, shown: !!frame && frame.classList.contains('on') }) };
  Promise.resolve(P.ready).then((user) => { if (!user) return; P.first(load()); watch(); });
})();
