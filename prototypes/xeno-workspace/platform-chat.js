/* XENO_CHAT — the real chat inside the workspace.
 * From disk this does nothing and the workspace keeps its still picture of the chat. Served by the platform it:
 *   1. shows the REAL chat (the platform's React chat: streaming, the queue, questions, the model list from
 *      /api/models, attachments, artifacts) in the main area, in place of the picture;
 *   2. fills the chat sidebar (Projects · Recents) with the person's real conversations;
 *   3. keeps the address in step: a conversation has a link, and reload, Back and Forward return to it.
 *
 * HOW. The chat is a React app and the workspace is plain scripts, so the chat runs in a same-origin frame
 * showing /chat/…, where the app drops its own shell (src/lib/workspaceEmbed.ts). The frame is ONE
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
  const NEW = '/chat';
  const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
  const S = { status: 'loading', convs: [], projects: [], current: null, path: null, total: 0, picker: null, area: undefined, pins: [] };
  // ---------- the AREA: each has its own chats and projects; Overview shows everything ----------
  // Owner's rule (2026-10-03, 2026-10-09). The area is the place in the left rail the person is in (Studio, Office,
  // Dev… or one they made); on Overview there is none. The real chat reads this when it creates a chat or a project.
  const AREA_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;
  const area = () => P.area(), areaName = (id) => P.areaName(id), areas = () => P.areas();

  // ---------- the list ----------
  const DAY = 86400000;
  const group = (iso) => { const t = new Date(iso).getTime(), d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = d0.getTime(); if (!Number.isFinite(t)) return 'Earlier'; if (t >= start) return 'Today'; if (t >= start - DAY) return 'Yesterday'; if (t >= start - 7 * DAY) return 'Previous 7 days'; if (t >= start - 30 * DAY) return 'Previous 30 days'; return 'Earlier'; };
  const titleOf = (c) => String(c.title || '').trim() || 'New chat';
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const here = area(), q = here ? '&area=' + encodeURIComponent(here) : '';   // one area, or everything on Overview
      const [cv, pj, pn] = await Promise.all([api('GET', '/api/chat/conversations?limit=200' + q).catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/projects?limit=100' + q).catch(() => ({ ok: false, d: {} })), api('GET', '/api/workspace/pins').catch(() => ({ ok: false, d: {} }))]);
      if (here !== area()) { loading = null; return load(); }   // the person moved to another area while this was on its way
      S.area = here;
      if (!cv.ok || !Array.isArray(cv.d.conversations)) { S.status = 'error'; }
      else { S.convs = cv.d.conversations; S.total = Number(cv.d.total) || S.convs.length; S.projects = pj.ok && Array.isArray(pj.d.projects) ? pj.d.projects : []; S.pins = pn.ok && Array.isArray(pn.d.items) ? pn.d.items.filter((i) => i.kind === 'chat').map((i) => String(i.id)) : []; S.status = 'ready'; }
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
    const byProject = new Map(); const loose = [], pinnedIds = new Set(S.pins);
    for (const c of S.convs) { if (pinnedIds.has(String(c.id))) continue; if (c.project_id) { if (!byProject.has(c.project_id)) byProject.set(c.project_id, []); byProject.get(c.project_id).push(c); } else loose.push(c); }
    const all = !area();   // on Overview each row says where it lives
    const row = (c) => ({ t: titleOf(c), id: c.id, area: all && c.area ? areaName(c.area) : '' });
    const projects = S.projects.filter((p) => !p.archived_at && !p.is_archived).map((p) => [String(p.name || 'Project'), p.id, (byProject.get(p.id) || []).map(row)]);
    const recents = []; for (const c of loose) { const g = group(c.last_message_at || c.updated_at || c.created_at); const last = recents[recents.length - 1]; if (last && last[0] === g) last[1].push(row(c)); else recents.push([g, [row(c)]]); }
    const pinned = S.pins.map((id) => S.convs.find((c) => String(c.id) === id)).filter(Boolean).map(row);
    return { live: true, status: S.status, current: convOf(S.current), currentProject: projOf(S.current), projects, pinned, recents, more: Math.max(0, S.total - S.convs.length) };
  }
  const projectName = (pid) => { const p = S.projects.find((x) => String(x.id) === String(pid)); return p ? String(p.name || 'Project') : 'Project'; };
  const title = (item) => { const id = convOf(item); const c = id && S.convs.find((x) => x.id === id); return c ? titleOf(c) : id ? 'Chat' : projOf(item) ? projectName(projOf(item)) : item ? 'Chat' : null; };
  /** the trail after "Chat": [project, chat] for a chat in a project, [project] for its home, [chat] otherwise */
  const trail = (item) => { const p = projOf(item), id = convOf(item); const out = []; if (p) out.push(projectName(p)); if (id) out.push(title(id)); return out.length ? out : item ? [title(item)] : []; };
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
    + '#xw-chat-side{position:fixed;z-index:4;border:0;background:var(--panel);visibility:hidden}'
    + '#xw-chat-side-ui{display:none}#xw-chat-side-ui.on{display:block}'
    + '#xw-chat-side-ui .xw-split{position:fixed;z-index:5;cursor:col-resize;background:var(--panel-stroke,var(--border))}#xw-chat-side-ui .xw-split:hover,#xw-chat-side-ui .xw-split:focus-visible,html.xw-splitting #xw-chat-side-ui .xw-split{background:var(--muted);outline:none}'
    + 'html.xw-splitting iframe{pointer-events:none}'
    + '#xw-chat-side-ui .xw-side-bar{position:fixed;z-index:5;display:flex;align-items:center;gap:4px;padding:0 8px;box-sizing:border-box;background:var(--panel);border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)}'
    + '#xw-chat-side-ui .xw-side-l{flex:1}#xw-chat-side-ui .xw-side-bar button{height:26px;min-width:26px;padding:0 6px;border:0;border-radius:4px;background:none;color:var(--muted);font:inherit;cursor:pointer}'
    + '#xw-chat-side-ui .xw-side-bar button:hover,#xw-chat-side-ui .xw-side-bar button:focus-visible{background:var(--hover);color:var(--text);outline:none}'
    + '#xw-chat-side-ui .xw-side-main{display:none}#xw-chat-side-ui.narrow .xw-side-main{display:inline-block}#xw-chat-side-ui.narrow .xw-side-l{flex:1}'
    + 'html.xw-chat-on #xp-note{display:none}html.xw-chat-on #main .topbar > .ib[aria-label="More"]{display:none}';
  document.head.appendChild(style);
  let frame = null, loaded = false, slot = null, ro = null, hideT = 0;
  const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const projOf = (item) => { const m = String(item || '').match(/^projects\/([^/]+)/); return m && ID.test(m[1]) ? m[1] : null; };
  const convOf = (item) => { const s = String(item || ''); if (ID.test(s)) return s; const m = s.match(/(?:^|\/)c\/([^/]+)$/); return m && ID.test(m[1]) ? m[1] : null; };
  const pathFor = (item) => { const p = projOf(item), c = convOf(item); if (p) return '/chat/projects/' + encodeURIComponent(p) + (c ? '/c/' + encodeURIComponent(c) : ''); return c ? '/chat/c/' + encodeURIComponent(c) : NEW; };
  /** the chat's own path (any prefix) → the item the workspace address carries */
  const itemIn = (path) => { const s = String(path || '').split(/[?#]/)[0];
    let m = s.match(/\/chat\/projects\/([^/]+)\/c\/([^/]+)$/); if (m && ID.test(dec(m[1])) && ID.test(dec(m[2]))) return `projects/${dec(m[1])}/c/${dec(m[2])}`;
    m = s.match(/\/chat\/projects\/([^/]+)$/); if (m && ID.test(dec(m[1]))) return `projects/${dec(m[1])}`;
    m = s.match(/\/(?:c|llm)\/([^/]+)$/); return m && ID.test(dec(m[1])) ? dec(m[1]) : null; };
  /** a conversation's canonical item: inside its project when it has one */
  const itemFor = (id) => { if (!id) return null; const c = S.convs.find((x) => x.id === id); return c && c.project_id && ID.test(String(c.project_id)) ? `projects/${c.project_id}/c/${id}` : id; };
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
  // And never while the chat's own route notice is still LOADING: the app mounts its input box underneath that notice, so
  // "input box present" alone revealed the app's loading state instead of the chat (owner's report, 2026-10-14).
  const chatReady = () => { try { const d = frame && frame.contentDocument; return !!(loaded && d && !d.querySelector('[data-chat-route-notice$="loading"]') && d.querySelector('[data-chat-composer-shell], [data-chat-route-notice]')); } catch { return false; } };
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
    if (w.location.pathname + w.location.search === path) return;
    try { w.history[replace ? 'replaceState' : 'pushState']({}, '', path); w.dispatchEvent(new w.PopStateEvent('popstate', { state: {} })); } catch { loaded = false; frame.src = path; showLoading(); }
  }
  function place() {
    const el = document.querySelector('#main .live-chat-host[data-chat-frame]');
    if (!el) { if (slot) { slot = null; ro?.disconnect(); } clearTimeout(hideT); hideT = setTimeout(() => { if (!document.querySelector('#main .live-chat-host[data-chat-frame]')) { frame?.classList.remove('on'); side?.classList.remove('on'); sideUi?.classList.remove('on'); document.documentElement.classList.remove('xw-chat-on'); } }, 160); return; }
    clearTimeout(hideT);
    if (el !== slot) { slot = el; ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(el); ro.observe(document.getElementById('main')); }
    // moved to another area: its own list, not the last one's
    if (S.area !== undefined && S.area !== area() && !loading) { S.status = 'loading'; S.convs = []; S.projects = []; S.total = 0; load(); toChatFrame({ type: 'area', area: area() }); }
    const generation = window.XENO_GENERATIONS?.route?.();
    const want = generation ? `generation:${generation.type}:${generation.id || generation.shelf || ''}` : X()?.S?.item || null;
    const framePath = generation ? generation.framePath : pathFor(want);
    if (!frame) ensureFrame(framePath); else if ((want || null) !== (S.current || null)) show(framePath, true);   // the address changed (Back, a link): follow it
    S.current = want;
    frame.classList.add('on'); keepSideInAddress(); syncSide(); fit(); document.documentElement.classList.add('xw-chat-on'); paintViewer();
  }
  function fit() {
    if (!slot || !frame) return; const r = slot.getBoundingClientRect(), main = document.getElementById('main');
    // a side chat takes the right part of the slot (owner, 2026-10-25); below SIDE_MIN wide it takes the whole slot
    const split = sideItem() !== undefined && !!side && frame.classList.contains('on'), narrow = r.width < SIDE_MIN;
    const leftW = split ? (narrow ? 0 : Math.round((r.width - SPLIT_GAP) * ratio())) : r.width;
    Object.assign(frame.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, leftW) + 'px', height: Math.max(0, r.height) + 'px', visibility: split && narrow ? 'hidden' : '' });
    fitSide(r, split, narrow, leftW);
    if (main) { const br = getComputedStyle(main).borderBottomLeftRadius; frame.style.borderRadius = `0 0 ${br} ${br}`; }
    if (loadingEl) Object.assign(loadingEl.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
  }
  addEventListener('resize', fit);

  // ---------- the SIDE CHAT (owner, 2026-10-25): a second chat beside the first, in the same window ----------
  // Each pane is a whole chat — its own composer, model, streaming and queue — so one answering never blocks the
  // other (VS Code / Cursor editor groups, Arc Split View, Slack's thread pane; one composer for two panes confuses).
  // The side chat is in the ADDRESS (?side=<item>, or ?side=new), so refresh, Back and a shared link bring both back.
  // A divider resizes it (remembered per browser, arrow keys too), the bar swaps, pops out or closes it. Below SIDE_MIN
  // wide the side chat takes the whole slot, with "Main chat" to go back.
  const SIDE_MIN = 900, SPLIT_GAP = 6, NEW_SIDE = 'new', RATIO_KEY = 'xw-chat-split';
  let side = null, sideLoaded = false, sideUi = null, sideShown, menuFrame = null;
  const clampRatio = (v) => Math.min(0.75, Math.max(0.25, v));
  const ratio = () => { let v = 0.5; try { v = Number(localStorage.getItem(RATIO_KEY)) || 0.5; } catch {} return clampRatio(v); };
  const setRatio = (v) => { try { localStorage.setItem(RATIO_KEY, String(clampRatio(v))); } catch {} fit(); };
  /** the side chat's item from the address: undefined = no side chat, 'new' = a new chat, else a chat item */
  const sideItem = () => { const v = new URLSearchParams(location.search).get('side'); if (v === null) return undefined; if (v === NEW_SIDE) return NEW_SIDE; const it = itemIn('/chat/' + v) || (ID.test(v) ? v : null); return it || undefined; };
  const sidePath = (it) => (it === NEW_SIDE || !it ? NEW : pathFor(it));
  function setSideParam(it) {
    const u = new URL(location.href); if (it === undefined) u.searchParams.delete('side'); else u.searchParams.set('side', it);
    if (u.href !== location.href) history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  }
  function openSide(it) { setSideParam(it || NEW_SIDE); syncSide(true); fit(); try { side?.focus(); } catch {} }
  function closeSide() { setSideParam(undefined); syncSide(); fit(); try { frame?.focus(); } catch {} }
  function swapSides() {
    const right = sideItem(); if (right === undefined) return;
    const left = S.current || null, go = right === NEW_SIDE ? null : right;
    // move the left chat first (the workspace rewrites its address), then put the old left chat on the side
    S.current = go; toChat(go); show(sidePath(go), false);
    setSideParam(left || NEW_SIDE); syncSide(true); repaint(); fit();
  }
  function ensureSideUi() {
    if (sideUi) return sideUi;
    sideUi = document.createElement('div'); sideUi.id = 'xw-chat-side-ui';
    sideUi.innerHTML = '<div class="xw-split" role="separator" aria-orientation="vertical" aria-label="Resize the side chat" tabindex="0"></div>'
      + '<div class="xw-side-bar"><button type="button" class="xw-side-main" data-side="close">‹ Main chat</button><span class="xw-side-l">Side chat</span>'
      + '<button type="button" data-side="swap" title="Swap the two chats" aria-label="Swap the two chats">⇄</button>'
      + '<button type="button" data-side="tab" title="Open the side chat in a new tab" aria-label="Open the side chat in a new tab">↗</button>'
      + '<button type="button" data-side="close" title="Close the side chat" aria-label="Close the side chat">✕</button></div>';
    document.body.appendChild(sideUi);
    sideUi.addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (!b) return; const k = b.dataset.side;
      if (k === 'close') closeSide(); else if (k === 'swap') swapSides();
      else if (k === 'tab') { const it = sideItem(); window.open(chatUrl(it === NEW_SIDE ? null : it), '_blank', 'noopener'); } });
    const bar = sideUi.querySelector('.xw-split');
    bar.addEventListener('pointerdown', (e) => { if (!slot) return; e.preventDefault(); bar.setPointerCapture(e.pointerId); document.documentElement.classList.add('xw-splitting');
      const move = (ev) => { const r = slot.getBoundingClientRect(); setRatio((ev.clientX - r.left) / r.width); };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); document.documentElement.classList.remove('xw-splitting'); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); });
    bar.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); setRatio(ratio() + (e.key === 'ArrowLeft' ? -0.05 : 0.05)); });
    return sideUi;
  }
  /** make the side frame match the address: create it, point it at its chat, or take it away */
  function syncSide(force) {
    const it = sideItem();
    if (it === undefined) { if (side) { side.remove(); side = null; sideLoaded = false; } sideUi?.classList.remove('on'); sideShown = undefined; return; }
    ensureSideUi();
    const path = sidePath(it);
    if (!side) {
      side = document.createElement('iframe'); side.id = 'xw-chat-side'; side.title = 'Side chat'; side.setAttribute('allow', 'clipboard-read; clipboard-write; microphone');
      // the same composer design the main chat wears (dress), copied from it once the side chat has loaded
      side.addEventListener('load', () => { sideLoaded = true; try { const d = side.contentDocument, css = frame?.contentDocument?.getElementById('xw-composer')?.textContent; if (d && css) { let st = d.getElementById('xw-composer'); if (!st) { st = d.createElement('style'); st.id = 'xw-composer'; (d.head || d.documentElement).appendChild(st); } st.textContent = css; } } catch {} });
      side.src = path; document.body.appendChild(side);
    } else if (force && it !== sideShown) {
      let w = null; try { w = side.contentWindow; if (!sideLoaded || !w || w.location.origin !== location.origin) w = null; } catch { w = null; }
      if (it === NEW_SIDE || !w) { sideLoaded = false; side.src = path; }
      else { try { w.history.pushState({}, '', path); w.dispatchEvent(new w.PopStateEvent('popstate', { state: {} })); } catch { sideLoaded = false; side.src = path; } }
    }
    sideShown = it; side.classList.add('on'); sideUi.classList.add('on');
  }
  function fitSide(r, split, narrow, leftW) {
    if (!side || !sideUi) return;
    if (!split) { side.style.visibility = 'hidden'; sideUi.classList.remove('on'); return; }
    const x = narrow ? r.left : r.left + leftW + SPLIT_GAP, w = narrow ? r.width : r.width - leftW - SPLIT_GAP, barH = 34;
    Object.assign(side.style, { left: x + 'px', top: (r.top + barH) + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, r.height - barH) + 'px', visibility: 'visible' });
    sideUi.classList.add('on'); sideUi.classList.toggle('narrow', narrow);
    Object.assign(sideUi.querySelector('.xw-side-bar').style, { left: x + 'px', top: r.top + 'px', width: Math.max(0, w) + 'px', height: barH + 'px' });
    Object.assign(sideUi.querySelector('.xw-split').style, { left: (r.left + leftW) + 'px', top: r.top + 'px', width: SPLIT_GAP + 'px', height: r.height + 'px', display: narrow ? 'none' : '' });
  }
  // The workspace's own navigation writes its address without ?side=; the side chat is kept in memory and put back.
  // Back and Forward are the exception: there the address is the truth (a step without ?side= closes it).
  let popping = false;
  function keepSideInAddress() { if (!popping && sideShown !== undefined && sideItem() === undefined) setSideParam(sideShown); popping = false; }
  addEventListener('popstate', () => { popping = true; syncSide(true); fit(); setTimeout(() => { popping = false; }, 0); });
  /** a chat's address in this workspace — for "Open in new tab" */
  const chatUrl = (it) => window.XENO_ADDR.url('#/' + (X()?.inOv?.() ? 'overview' : X()?.S?.mode) + '/p/chat' + (it ? '/' + String(it).split('/').map(encodeURIComponent).join('/') : ''));
  window.XENO_CHAT_SIDE = { open: (it) => openSide(it), close: closeSide, swap: swapSides, item: sideItem };

  const watch = () => { const main = document.getElementById('main'); if (!main) return setTimeout(watch, 50); new MutationObserver(place).observe(main, { childList: true }); main.addEventListener('transitionend', fit); place(); };

  // Back/Forward between generations of one type: tell the mounted frame, do not rebuild it.
  addEventListener('popstate', () => {
    const g = window.XENO_GENERATIONS?.route?.();
    if (g && frame?.contentWindow && new URL(frame.src, location.origin).searchParams.get('generationType') === g.type) frame.contentWindow.postMessage({ source: 'xeno-workspace', type: 'generation-active', generationId: g.id }, location.origin);
  });

  // ---------- the chat tells the workspace where it is ----------
  let reloadT = 0;
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !frame) return;
    const from = e.source === frame.contentWindow ? frame : side && e.source === side.contentWindow ? side : null; if (!from) return;
    const m = e.data; if (!m || m.source !== 'xeno-chat') return;
    // the SIDE chat (owner, 2026-10-25): its place goes into ?side= of this page's address, its menus are drawn here and
    // answer IT. Everything else (Share, transcript, viewer, generations) belongs to the main chat.
    if (from === side) {
      if (m.type === 'location') { const item = itemIn(m.path); if ((item || NEW_SIDE) !== sideItem()) { setSideParam(item || NEW_SIDE); sideShown = item || NEW_SIDE; } clearTimeout(reloadT); reloadT = setTimeout(load, 1200); return; }
      if (m.type === 'changed') { clearTimeout(reloadT); reloadT = setTimeout(load, 300); return; }
      if (!['model-menu', 'model-menu-close', 'effort-menu', 'effort-menu-close'].includes(m.type)) return;
    }
    if (m.type === 'report-open') { if (!document.querySelector('dialog[open],.xd')) window.XENO_REPORT?.open().catch(error => console.warn(error.message)); return; }
    if (m.type === 'generation-view') { window.XENO_GENERATIONS?.showView?.(window.XENO_GENERATIONS.asView(m.view)); return; }
    if (m.type === 'generation-grid-size') { window.XENO_GENERATIONS?.showSize?.(m.size); return; }
    if (m.type === 'generation-open') { if (['image', 'video', 'audio', '3d', 'enhance-image', 'enhance-video', 'enhance-audio', 'enhance-3d'].includes(m.generationType) && window.XENO_GENERATIONS?.route?.()) { if (m.carry) window.XENO_GENERATIONS.carry(m.generationType, m.carry, frame); else window.XENO_GENERATIONS.open(m.generationType); } return; }
    if (m.type === 'generation-landed') { window.XENO_GENERATIONS?.land?.(m.rect, frame); return; }
    if (m.type === 'generation-location') {
      const types = ['image', 'video', 'audio', '3d', 'enhance-image', 'enhance-video', 'enhance-audio', 'enhance-3d'];
      if (String(m.generationType).startsWith('enhance-') && !m.generationId && window.XENO_GENERATIONS?.route?.()?.type === m.generationType) { history.replaceState(history.state, '', window.XENO_GENERATIONS.pathFor(m.generationType)); return; }
      if (types.includes(m.generationType) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.generationId || '') && window.XENO_GENERATIONS?.route?.()) {
        // Same type: change the address in place. A reload here closed whatever the person had open.
        const here = window.XENO_GENERATIONS.route();
        if (here.type !== m.generationType) window.XENO_GENERATIONS.open(m.generationType, m.generationId);
        // Scrolling through results in theater view replaces the address; a deliberate open adds a Back step.
        else if (here.id !== m.generationId) history[m.replace ? 'replaceState' : 'pushState'](history.state, '', window.XENO_GENERATIONS.pathFor(m.generationType, m.generationId));
      }
      return;
    }
    if (m.type === 'location') {
      dress();
      if (window.XENO_GENERATIONS?.route?.()) return;
      const item = itemIn(m.path), id = convOf(item); S.path = m.path;
      if (item !== S.current) { S.current = item; X()?.setChatItem?.(item); }
      keepSideInAddress();
      // a conversation that is not in the list yet was just started; and a title may have been written
      clearTimeout(reloadT); reloadT = setTimeout(load, id && !S.convs.some((c) => c.id === id) ? 600 : 2500);
      repaint();
    }
    if (m.type === 'changed') { clearTimeout(reloadT); reloadT = setTimeout(load, 300); }
    // the chat's model trigger was pressed: this page's own menu opens, with the chat's real list
    if (m.type === 'model-menu' && Array.isArray(m.models) && m.rect) {
      // pressing a trigger again closes its menu; the @ list is driven by typing and by Up/Down, so it is redrawn in place
      if (X()?.modelMenuOpen?.() && !(m.menu === 'gen-at' && S.picker?.menu === 'gen-at')) return void X().closeModelMenu();
      menuFrame = from;
      const f = from.getBoundingClientRect(), r = m.rect;   // the trigger's place, in this page's coordinates
      const box = { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height };
      // The same menu serves every list the composer offers (models, and in generate mode the type, the image models and
      // each setting): `menu` names which list it is and comes back with the pick; a row may carry a short `note` (where
      // "your key" sits), be `disabled` with a reason, or start a new group (`sep`). Text only; the page escapes it.
      const str = (v, n) => String(v == null ? '' : v).slice(0, n);
      S.picker = { menu: str(m.menu || 'model', 40) || 'model', title: str(m.title, 40), align: m.align === 'left' ? 'left' : 'right', find: m.find !== false, short: m.short !== false,
        models: m.models.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: str(x.id, 120), name: str(x.name || x.id, 80), description: str(x.description, 300), contextWindow: Number(x.contextWindow) || 0, ownKey: !!x.ownKey, note: str(x.note, 24), disabled: !!x.disabled, reason: str(x.reason, 120), sep: !!x.sep })),
        selected: String(m.selected || ''), anchor: { getBoundingClientRect: () => box } };
      X()?.openModelMenu?.(S.picker.anchor);
    }
    if (m.type === 'model-menu-close') X()?.closeModelMenu?.();
    if (m.type === 'viewer') { S.viewer = m.open && typeof m.name === 'string' && m.name ? { name: m.name.slice(0, 200), canExport: !!m.canExport } : null; paintViewer(); }
    if (m.type === 'viewer-copied' && S.viewer) X()?.toast?.('Link copied');
    // the chat's effort pill was pressed: this page's own effort menu opens, on the chat's real levels
    if (m.type === 'effort-menu' && Array.isArray(m.levels) && m.levels.length && m.rect) {
      menuFrame = from;
      const f = from.getBoundingClientRect(), r = m.rect;
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
  function open(id) { const item = itemFor(id); S.current = item; toChat(item); show(pathFor(item), false); repaint(); setTimeout(keepSideInAddress, 0); }
  // a project's home in the real chat, by id: its composer files the new conversation in the project
  function openProjectId(pid) { if (!/^[0-9a-f-]{36}$/i.test(String(pid || ''))) return false; const item = 'projects/' + pid; S.current = item; toChat(item); show(pathFor(item), false); repaint(); return true; }
  function openProject(name) { const pid = projectId(name); return pid ? openProjectId(pid) : false; }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) return;   // the row's menu button is the app's: it opens the menu registered below
    const row = e.target.closest('[data-chat-live]'); if (row) { e.preventDefault(); e.stopPropagation();
      // Ctrl/Cmd click: a new tab, as every web app does; Ctrl+Shift click: beside this chat
      const id = row.dataset.chatLive;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) return openSide(itemFor(id));
      if (e.ctrlKey || e.metaKey) return void window.open(chatUrl(itemFor(id)), '_blank', 'noopener');
      return open(id); }
    if (e.target.closest('[data-chat-retry]')) { e.preventDefault(); e.stopPropagation(); S.status = 'loading'; repaint(); return void load(); }
    const fresh = e.target.closest('[data-newchat]'); if (fresh) { e.preventDefault(); e.stopPropagation(); return open(null); }
    const inP = e.target.closest('[data-newin]'); if (inP && openProject(inP.dataset.newin)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // middle click on a chat row: a new tab
  document.addEventListener('auxclick', (e) => { if (e.button !== 1) return; const row = e.target.closest('[data-chat-live]'); if (!row) return; e.preventDefault(); window.open(chatUrl(itemFor(row.dataset.chatLive)), '_blank', 'noopener'); }, true);

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
    if (convOf(S.current) === id) open(null); else repaint();
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
  // ---------- an area's standing instruction for its chats ----------
  // The person's own words, kept in their account settings under areas.<id>.instructions; the real chat puts
  // them ahead of every turn it sends from this area (chatAreaDefaults.ts). Overview has none.
  const MAX_INSTRUCTIONS = 4000;
  async function instructions() {
    const here = area(); if (!here) return false;
    const got = await api('GET', '/api/user-data/settings').catch(() => null);
    if (!got || !got.ok) { X()?.toast?.('Your settings couldn’t be loaded. Nothing changed.'); return false; }
    const areasNow = (got.d.settings && typeof got.d.settings.areas === 'object' && got.d.settings.areas) || {};
    const was = typeof areasNow[here]?.instructions === 'string' ? areasNow[here].instructions : '';
    let saved = false;
    await window.XD.form({ title: 'Instructions for ' + areaName(here), submit: 'Save', fields: [{ id: 'text', type: 'textarea', label: 'What every chat in ' + areaName(here) + ' should know or do', rows: 7, max: MAX_INSTRUCTIONS, value: was,
      placeholder: 'For example: answer as a senior engineer; prefer TypeScript; keep answers short.', hint: 'Applies to chats started in ' + areaName(here) + ' only. Leave it empty for none.' }],
      onSubmit: async (v) => { const text = String(v.text || '').trim().slice(0, MAX_INSTRUCTIONS);
        const r = await api('PATCH', '/api/user-data/settings', { updates: [{ path: 'areas.' + here + '.instructions', value: text }] }).catch(() => null);
        if (!r || !r.ok) return say(r, 'The instructions couldn’t be saved. Nothing changed.');
        const areaMsg = { type: 'area-settings', areas: { ...areasNow, [here]: { ...(areasNow[here] || {}), instructions: text } } }; toChatFrame(areaMsg); if (side) toChatFrame(areaMsg, side);
        saved = true; X()?.toast?.(text ? 'Instructions saved for ' + areaName(here) : 'Instructions cleared for ' + areaName(here)); return null; } });
    return saved;
  }
  // Pin or unpin a conversation for this person. Shown at once; put back if the platform refuses.
  async function pin(id, on) {
    const key = String(id), was = S.pins.slice(); S.pins = on ? [...S.pins.filter((x) => x !== key), key] : S.pins.filter((x) => x !== key); repaint();
    const r = await api(on ? 'PUT' : 'DELETE', '/api/chat/conversations/' + encodeURIComponent(id) + '/pin').catch(() => null);
    if (!r || !r.ok) { S.pins = was; repaint(); X()?.toast?.(on ? 'That couldn’t be pinned.' : 'That couldn’t be unpinned.'); return false; }
    X()?.toast?.(on ? 'Pinned' : 'Unpinned'); try { window.XENO_RECENT_LIVE?.load?.(); } catch {} return true;
  }
  document.addEventListener('click', (e) => { const t = e.target.closest('#panel [data-chat-instructions]'); if (!t) return; e.preventDefault(); e.stopPropagation(); instructions(); }, true);
  const menu = () => { const C = window.XCM; if (!C || !C.register) return; C.register({ id: 'chat-live', sel: '[data-chat-live]', priority: 3, build: (n) => { const id = n.dataset.chatLive;
    return [[{ label: 'Open', icon: 'chat', run: () => open(id) }, { label: 'Open in new tab', icon: 'external', kbd: 'Ctrl click', run: () => window.open(chatUrl(itemFor(id)), '_blank', 'noopener') }, { label: 'Open beside', icon: 'sidebar', kbd: 'Ctrl Shift click', run: () => openSide(itemFor(id)) }, { label: 'Copy link', icon: 'link', run: () => C.H.copy(window.XENO_ADDR.url('#/' + (X().inOv() ? 'overview' : X().S.mode) + '/p/chat/' + encodeURIComponent(id)), 'Link copied') }],
      [{ label: 'Pinned', icon: 'pin', checked: S.pins.includes(String(id)), run: () => pin(id, !S.pins.includes(String(id))) }, { label: 'Rename', icon: 'edit', run: () => rename(id) }, { label: 'Move to…', icon: 'folder', run: () => move(id) }], [{ label: 'Delete', icon: 'trash', danger: true, run: () => remove(id) }]]; } }); };
  // the chat sidebar's own menu (its empty space and header): the generic one, plus new tab / beside / close the side chat
  const panelMenu = () => { const C = window.XCM; if (!C || !C.register) return; C.register({ id: 'chat-panel', sel: '#panel .pv', priority: 0, when: () => X()?.S?.view === 'product' && X()?.S?.product === 'chat', build: (n) => {
    const primary = n.querySelector('.pbody > .act.primary');
    return [[{ label: 'New chat', icon: 'plus', run: () => (primary ? primary.click() : open(null)) }, { label: 'New chat in new tab', icon: 'external', run: () => window.open(chatUrl(null), '_blank', 'noopener') }, { label: 'New chat beside', icon: 'sidebar', run: () => openSide(NEW_SIDE) }],
      [{ label: 'Expand all sections', icon: 'down', run: () => n.querySelectorAll('.sec').forEach((s) => s.classList.remove('closed')) },
        { label: 'Collapse all sections', icon: 'up', run: () => n.querySelectorAll('.sec').forEach((s) => s.classList.add('closed')) }],
      [...(sideItem() !== undefined ? [{ label: 'Close the side chat', icon: 'x', run: closeSide }] : []), { label: 'Hide sidebar', icon: 'sidebar', kbd: 'Ctrl \\', run: () => document.querySelector('[data-collapse]')?.click() }]];
  } }); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => { menu(); panelMenu(); }); else { menu(); panelMenu(); }

  const toChatFrame = (msg, to = frame) => { try { to.contentWindow.postMessage({ source: 'xeno-workspace', ...msg }, location.origin); } catch {} };
  // a menu's answer goes to the chat that opened it — the main one or the side one
  const toMenuFrame = (msg) => toChatFrame(msg, menuFrame && menuFrame.isConnected ? menuFrame : frame);
  const pickModel = (id) => toMenuFrame({ type: 'pick-model', id, menu: S.picker?.menu || 'model' });
  const pickerClosed = () => { if (S.effort) { S.effort = null; toMenuFrame({ type: 'effort-menu-closed' }); } if (S.picker) { S.picker = null; toMenuFrame({ type: 'model-menu-closed' }); } };
  const pickEffort = (id) => { if (S.effort) S.effort.selected = id; toMenuFrame({ type: 'pick-effort', id }); };
  window.XENO_CHAT = { served: true, openProjectId, trail, area, areaName, instructions, pin, pins: () => S.pins.slice(), get picker() { return S.picker; }, get effort() { return S.effort || null; }, pickModel, pickEffort, pickerClosed, data, title, open, load, rename, remove, dress, host: () => '<div class="live-chat-host" data-chat-frame aria-label="Chat"></div>', state: () => ({ area: area(), listed: S.area, viewer: S.viewer || null, ready: chatReady(), status: S.status, count: S.convs.length, current: convOf(S.current), item: S.current, path: S.path, shown: !!frame && frame.classList.contains('on') }) };
  Promise.resolve(P.ready).then((user) => { if (!user) return; P.first(load()); watch(); });
})();
