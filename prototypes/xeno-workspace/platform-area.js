/* platform-area.js — on the platform, three things that were still the picture's own become the person's:
 *
 *   1. Scheduled. The picture kept two sample tasks ("Weekly competitor digest", "Morning brief") in this
 *      browser. Here the sheet lists, makes, pauses, moves and removes the person's real scheduled chats, per
 *      AREA: inside an area it shows that area's; on Overview, all of them, each naming its area.
 *   2. Needs you. Filled from what the platform knows is waiting: scheduled chats whose last run failed.
 *   3. Search. Ctrl K also asks the platform, so a chat is found by what was SAID in it, not only by its title,
 *      and work that is not loaded in this page is still found. Results in the area you are in come first.
 *
 * Routes: GET/POST /api/chat/scheduled · PUT/DELETE /api/chat/scheduled/:id · GET /api/workspace/needs ·
 *         GET /api/workspace/search?q=[&area=] · GET /api/chat/conversations · GET /api/chat/projects ·
 *         GET /api/library/assets · PUT …/area (the three ways an item is moved).
 *   4. Chats. The sheet that lists an area's chats also finds them by what was said in them.
 *   5. Sort into areas. Work made before areas existed lives on Overview only; one sheet lists it and moves the
 *      chosen items to an area. Nothing is placed by guesswork: the person says where each thing belongs.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_AREA_LIVE = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const areaLabel = (id) => (id ? P.areaName(id) : 'Overview');

  // ───────────────────────────── needs you
  const N = { status: 'loading', count: 0 };
  let needsLoading = null;
  function loadNeeds() {
    if (needsLoading) return needsLoading;
    needsLoading = (async () => {
      const r = await api('GET', '/api/workspace/needs').catch(() => null);
      if (r && r.ok && Array.isArray(r.d.items)) {
        window.XENO_NEEDS = r.d.items.map((i) => ({ id: String(i.id), kind: i.kind, t: String(i.title || 'Scheduled chat'), p: 'chat', m: i.area || 'overview', meta: 'Run failed', detail: String(i.detail || ''), at: i.at }));
        N.status = 'ready';
      } else { window.XENO_NEEDS = []; N.status = 'error'; }
      N.count = window.XENO_NEEDS.length; needsLoading = null;
      try { X()?.reloadData?.('notes'); X()?.refreshPanel?.(); } catch {}
    })();
    return needsLoading;
  }

  // ───────────────────────────── scheduled chats
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const pad = (n) => String(n).padStart(2, '0');
  const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** What the form's choice means to the platform. `now` is passed in so the rule can be checked at any hour. */
  function scheduleOf(rep, at, now = new Date()) {
    const [h, m] = at.split(':').map(Number), today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    const start = rep === 'Once' && today.getTime() <= now.getTime() ? new Date(today.getTime() + 86400000) : today;
    const base = { dtstart_local: `${localDay(start)}T${pad(h)}:${pad(m)}:00`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    if (rep === 'Once') return { ...base, cadence: 'once', schedule_kind: 'once', cadence_label: `Once · ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${at}` };
    if (rep === 'Daily') return { ...base, cadence: 'daily', schedule_kind: 'recurring', rrule: 'FREQ=DAILY', cadence_label: `Every day · ${at}` };
    if (rep === 'Weekdays') return { ...base, cadence: 'weekly', schedule_kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', cadence_label: `Weekdays · ${at}` };
    return { ...base, cadence: 'weekly', schedule_kind: 'recurring', rrule: `FREQ=WEEKLY;BYDAY=${DAYS[now.getDay()]}`, cadence_label: `${DAY_NAMES[now.getDay()]} · ${at}` };
  }
  const when = (iso) => { const t = new Date(iso); if (!Number.isFinite(t.getTime())) return ''; return t.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const SC = { status: 'loading', tasks: [], area: null };
  async function loadScheduled() {
    SC.area = P.area();
    const r = await api('GET', '/api/chat/scheduled?limit=100' + (SC.area ? '&area=' + encodeURIComponent(SC.area) : '')).catch(() => null);
    if (r && r.ok && Array.isArray(r.d.tasks)) { SC.tasks = r.d.tasks.filter((t) => t.status !== 'cancelled'); SC.status = 'ready'; } else { SC.tasks = []; SC.status = 'error'; }
  }
  async function newScheduled() {
    const here = P.area();
    const v = await D().form({ title: 'New scheduled chat', sub: here ? `Runs in ${areaLabel(here)}. XENO runs the prompt on schedule and keeps the answers in one chat.` : 'XENO runs the prompt on schedule and keeps the answers in one chat.', submit: 'Schedule', fields: [
      { id: 'name', label: 'Name', required: true, max: 60, placeholder: 'e.g. Friday wrap-up' },
      { id: 'prompt', label: 'What to do', type: 'textarea', rows: 3, required: true, max: 4000, placeholder: 'What should it look at, and what should it tell you?' },
      { id: 'rep', label: 'Repeat', type: 'seg', value: 'Weekdays', options: [['Daily', 'Every day'], ['Weekdays', 'Weekdays'], ['Weekly', 'Weekly'], ['Once', 'Once']] },
      { id: 'at', label: 'Time', required: true, value: '09:00', validate: (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(x.trim()) ? null : 'Use 24-hour time, like 09:00.') }] });
    if (!v) return false;
    const r = await api('POST', '/api/chat/scheduled', { title: v.name.trim(), prompt: v.prompt.trim(), ...scheduleOf(v.rep, v.at.trim()), area: here }).catch(() => null);
    if (!r || !r.ok) { toast((r && r.d && r.d.error) || 'That couldn’t be scheduled. Nothing was saved.'); return false; }
    toast(`Scheduled “${v.name.trim()}”${here ? ' in ' + areaLabel(here) : ''}`); return true;
  }
  /** The areas a scheduled chat can move to: every area, the one it is in ticked, and none. */
  function moveItems(t, done) {
    const move = async (to) => { const r = await api('PUT', '/api/chat/scheduled/' + t.id, { area: to }).catch(() => null);
      if (!r || !r.ok) return toast((r && r.d && r.d.error) || 'That couldn’t be moved. It is where it was.');
      toast(`Moved “${t.title}” to ${areaLabel(to)}`); done && done(); };
    return [P.areas().map(([id, name]) => ({ label: name, icon: 'grid', checked: t.area === id, run: () => move(id) })), [{ label: 'No area', hint: 'Overview only', icon: 'minus', checked: !t.area, run: () => move(null) }]];
  }
  function scheduled() {
    const ic = (k) => X().ic(k);
    const row = (t) => { const off = t.status !== 'active', failed = t.last_run_status === 'failed';
      const line = [t.cadence_label, off ? (t.status === 'needs_review' ? 'needs a look' : 'paused') : (t.next_run_at ? 'next ' + when(t.next_run_at) : ''), !SC.area ? areaLabel(t.area) : ''].filter(Boolean).join(' · ');
      return `<li${off ? ' class="off"' : ''} data-sc="${esc(t.id)}"><div><b>${esc(t.title)}</b><small>${esc(line)}</small>${failed ? `<small class="xd-sc-fail">Last run failed${t.last_run_error ? ': ' + esc(String(t.last_run_error).slice(0, 160)) : ''}</small>` : ''}<p>${esc(t.prompt)}</p></div>
        <span class="xd-list-acts"><button class="xd-btn ghost sm" data-sc-tog="${esc(t.id)}">${off ? 'Resume' : 'Pause'}</button>${t.project_id ? '' : `<button class="xd-ib" data-sc-move="${esc(t.id)}" aria-label="Move ${esc(t.title)} to another area" data-tip="Move to area">${ic('grid')}</button>`}<button class="xd-ib" data-sc-del="${esc(t.id)}" aria-label="Delete ${esc(t.title)}" data-tip="Delete">${ic('trash')}</button></span></li>`; };
    const paint = (sh) => { const b = sh.querySelector('.xd-info'); if (!b) return;
      b.innerHTML = SC.status === 'loading' ? '<p class="xd-note" data-sc-state="loading">Loading your scheduled chats…</p>'
        : SC.status === 'error' ? '<p class="xd-note" data-sc-state="error">Your scheduled chats couldn’t be loaded. <button class="xd-btn ghost sm" data-sc-retry>Try again</button></p>'
        : SC.tasks.length ? `<ul class="xd-list">${SC.tasks.map(row).join('')}</ul>`
        : `<p class="xd-note" data-sc-state="empty">Nothing scheduled${SC.area ? ' in ' + esc(areaLabel(SC.area)) : ''}. A scheduled chat runs a prompt for you — every morning, every Friday, or once.</p>`; };
    const reload = async (sh) => { await loadScheduled(); if (document.body.contains(sh)) paint(sh); loadNeeds(); };
    const here = P.area();
    D().info({ title: 'Scheduled', sub: here ? `Prompts XENO runs for you in ${areaLabel(here)}` : 'Prompts XENO runs for you, in every area', size: 'md', html: '',
      actions: [{ label: 'New scheduled chat', close: false, run: async () => { if (await newScheduled()) { const sh = document.querySelector('.xd'); if (sh) reload(sh); } } }],
      onOpen: (sh) => { SC.status = 'loading'; SC.area = here; paint(sh); reload(sh);
        sh.addEventListener('click', async (e) => {
          if (e.target.closest('[data-sc-retry]')) { SC.status = 'loading'; paint(sh); return reload(sh); }
          const tg = e.target.closest('[data-sc-tog]'), dl = e.target.closest('[data-sc-del]'), mv = e.target.closest('[data-sc-move]');
          const find = (id) => SC.tasks.find((x) => String(x.id) === id);
          if (tg) { const t = find(tg.dataset.scTog); if (!t) return; const to = t.status === 'active' ? 'paused' : 'active';
            const r = await api('PUT', '/api/chat/scheduled/' + t.id, { status: to }).catch(() => null);
            if (!r || !r.ok) return toast('That couldn’t be changed. It is as it was.');
            toast(to === 'active' ? `Resumed “${t.title}”` : `Paused “${t.title}”`); return reload(sh); }
          if (mv) { const t = find(mv.dataset.scMove); if (!t) return;
            const b = mv.getBoundingClientRect();
            return window.XCM.show(moveItems(t, () => reload(sh)), { x: Math.max(8, b.right - 232), y: b.bottom + 6, opener: mv, keyboard: true, label: 'Move to area' }); }
          if (dl) { const t = find(dl.dataset.scDel); if (!t) return;
            if (!(await D().confirm({ title: `Delete “${t.title}”?`, body: 'It stops running. The chat that holds its past answers is kept.', action: 'Delete' }))) return;
            const r = await api('DELETE', '/api/chat/scheduled/' + t.id).catch(() => null);
            if (!r || !r.ok) return toast('That couldn’t be deleted. It is still scheduled.');
            toast(`Deleted “${t.title}”`); return reload(sh); }
        }); } });
  }

  // ───────────────────────────── search
  const SR = { q: '', items: [], pending: false, timer: 0, seq: 0, cache: new Map() };
  const sIcon = (k) => `<span class="sr-ic">${X().ic(k)}</span>`;
  const toItems = (results) => { const here = P.area();
    const out = results.map((r) => { const where = areaLabel(r.area);
      if (r.kind === 'chat') return { k: r.matched === 'message' ? 'In conversations' : 'Chats', label: r.title, sub: r.snippet ? `${where} · ${r.snippet}` : `Chat · ${where}`, html: sIcon('chat'), id: 'chat:' + r.id, area: r.area, remote: true, run: () => X().go('product', { product: 'chat', item: r.id }) };
      if (r.kind === 'project') return { k: 'Projects', label: r.title, sub: `Project · ${where}`, html: sIcon('folder'), id: 'project:' + r.id, area: r.area, remote: true, run: () => X().go('global', { global: 'projects', item: r.title }) };
      return { k: 'Files', label: r.title, sub: `File · ${where}`, html: sIcon('lib'), id: 'file:' + r.id, area: r.area, remote: true, run: () => X().go('global', { global: 'library', item: r.id }) }; });
    return here ? [...out.filter((x) => x.area === here), ...out.filter((x) => x.area !== here)] : out; };
  /** What the platform found for `raw`. Answers at once from what it already knows; calls `again` when more arrives. */
  function find(raw, again) {
    const q = String(raw || '').trim();
    if (q.length < 2 || q.startsWith('>')) { clearTimeout(SR.timer); SR.q = q; SR.items = []; SR.pending = false; return { items: [], pending: false }; }
    if (SR.cache.has(q)) { SR.q = q; SR.items = SR.cache.get(q); SR.pending = false; clearTimeout(SR.timer); return { items: SR.items, pending: false }; }
    if (SR.q !== q || !SR.pending) {
      SR.q = q; SR.pending = true; clearTimeout(SR.timer); const seq = ++SR.seq;
      SR.timer = setTimeout(async () => {
        const r = await api('GET', '/api/workspace/search?q=' + encodeURIComponent(q)).catch(() => null);
        const items = r && r.ok && Array.isArray(r.d.results) ? toItems(r.d.results) : [];
        if (r && r.ok) { SR.cache.set(q, items); if (SR.cache.size > 40) SR.cache.delete(SR.cache.keys().next().value); }
        if (seq !== SR.seq) return;
        SR.items = items; SR.pending = false; try { again && again(); } catch {}
      }, 220);
    }
    return { items: [], pending: true };
  }
  /** The page's own results first; then what only the platform found (same title already listed = left out). */
  function merge(local, remote) {
    // "Recent" lists the person's own chats and projects too, so a title shown there counts as already listed
    const have = new Set(local.filter((x) => ['Recent', 'Chats', 'Projects', 'Files'].includes(x.k)).map((x) => String(x.label).toLowerCase()));
    const extra = remote.filter((x) => x.k === 'In conversations' || !have.has(String(x.label).toLowerCase())).slice(0, 10);
    const order = ['In conversations', 'Chats', 'Projects', 'Files'];
    return [...local, ...order.flatMap((k) => extra.filter((x) => x.k === k))];
  }
  window.XENO_SEARCH_LIVE = { served: true, find, merge, state: () => ({ q: SR.q, pending: SR.pending, count: SR.items.length }) };

  // ───────────────────────────── chats in this area, by title and by what was said
  function allChats() {
    const here = P.area(), ic = (k) => X().ic(k), q0 = here ? '&area=' + encodeURIComponent(here) : '';
    const C = { status: 'loading', rows: [], said: [], q: '', seq: 0, timer: 0 };
    const paint = (sh) => { const box = sh.querySelector('.xd-chats'); if (!box) return; const q = C.q.trim().toLowerCase();
      const hit = C.rows.filter((r) => !q || r.title.toLowerCase().includes(q));
      const row = (r, sub) => `<button class="xd-chat" data-ac-id="${esc(r.id)}"><span>${esc(r.title)}</span><small>${esc(sub)}</small></button>`;
      const titled = hit.map((r) => row(r, here ? r.when : areaLabel(r.area))).join('');
      const said = C.said.filter((r) => !hit.some((h) => h.id === r.id)).map((r) => row(r, r.snippet)).join('');
      box.innerHTML = C.status === 'loading' ? '<p class="xd-note" data-ac-state="loading">Loading chats…</p>' : C.status === 'error' ? '<p class="xd-note" data-ac-state="error">The chats couldn’t be loaded.</p>'
        : (titled + (said ? `<div class="xd-chats-h">Said in a chat</div>${said}` : '')) || (C.searching ? '<p class="xd-note" data-ac-state="searching">Searching what was said…</p>' : `<p class="xd-note" data-ac-state="none">${q ? `No chats match “${esc(C.q.trim())}”.` : 'No chats here yet.'}</p>`);
      sh.querySelector('.xd-chats-n').textContent = C.status === 'ready' ? `${hit.length} of ${C.rows.length}` : ''; };
    const ask = (sh) => { clearTimeout(C.timer); const q = C.q.trim(), seq = ++C.seq; if (q.length < 2) { C.said = []; C.searching = false; return; } C.searching = true;
      C.timer = setTimeout(async () => { const r = await api('GET', '/api/workspace/search?q=' + encodeURIComponent(q) + q0).catch(() => null); if (seq !== C.seq) return;
        C.said = r && r.ok && Array.isArray(r.d.results) ? r.d.results.filter((x) => x.kind === 'chat' && x.matched === 'message').map((x) => ({ id: String(x.id), title: String(x.title || 'New chat'), snippet: String(x.snippet || '') })) : [];
        C.searching = false; if (document.body.contains(sh)) paint(sh); }, 220); };
    D().info({ title: 'Chats', sub: here ? 'In ' + areaLabel(here) : 'In every area', size: 'md', html: `<div class="xd-search">${ic('search')}<input type="search" placeholder="Search titles and what was said" aria-label="Search chats"><span class="xd-chats-n"></span></div><div class="xd-chats"></div>`,
      onOpen: async (sh, shell) => { paint(sh); const i = sh.querySelector('input'); setTimeout(() => i.focus(), 30);
        i.addEventListener('input', () => { C.q = i.value; ask(sh); paint(sh); });
        sh.addEventListener('click', (e) => { const b = e.target.closest('[data-ac-id]'); if (!b) return; shell.close('pick'); X().go('product', { product: 'chat', item: b.dataset.acId }); });
        const r = await api('GET', '/api/chat/conversations?limit=200' + q0).catch(() => null);
        if (r && r.ok && Array.isArray(r.d.conversations)) { C.rows = r.d.conversations.map((c) => ({ id: String(c.id), title: String(c.title || '').trim() || 'New chat', area: c.area || null, when: when(c.last_message_at || c.updated_at) })); C.status = 'ready'; } else C.status = 'error';
        if (document.body.contains(sh)) paint(sh); } });
  }

  // ───────────────────────────── sort into areas: what lives on Overview only
  const U = { status: 'loading', count: 0, chats: [], projects: [], files: [], moreChats: 0, moreFiles: false };
  let unplacedLoading = null;
  function loadUnplaced() {
    if (unplacedLoading) return unplacedLoading;
    unplacedLoading = (async () => {
      const [cv, pj, lb] = await Promise.all([api('GET', '/api/chat/conversations?limit=200&area=none').catch(() => null), api('GET', '/api/chat/projects?limit=100&area=none').catch(() => null), api('GET', '/api/library/assets?limit=200&area=none').catch(() => null)]);
      if (cv && cv.ok && pj && pj.ok && lb && lb.ok) {
        U.chats = (cv.d.conversations || []).filter((c) => !c.project_id).map((c) => ({ kind: 'chat', id: String(c.id), title: String(c.title || '').trim() || 'New chat', meta: when(c.last_message_at || c.updated_at) }));
        U.projects = (pj.d.projects || []).filter((p) => !p.is_archived).map((p) => ({ kind: 'project', id: String(p.id), title: String(p.name || 'Project'), meta: 'Project and its chats' }));
        U.files = (lb.d.items || []).map((f) => ({ kind: 'file', id: String(f.id), title: String(f.name || 'Untitled'), meta: 'File', source: f.source, sourceId: f.source_id }));
        // one request holds 200: say when there is more, so a long list is not mistaken for the whole of it
        U.moreChats = Math.max(0, (Number(cv.d.total) || 0) - (cv.d.conversations || []).length); U.moreFiles = (lb.d.items || []).length >= 200;
        U.status = 'ready';
      } else { U.chats = []; U.projects = []; U.files = []; U.status = 'error'; }
      const was = U.count; U.count = U.chats.length + U.projects.length + U.files.length; unplacedLoading = null;
      if (was !== U.count) { try { X()?.refreshPanel?.(); } catch {} }
    })();
    return unplacedLoading;
  }
  const moveOne = (it, to) => (it.kind === 'chat' ? api('PUT', '/api/chat/conversations/' + encodeURIComponent(it.id), { area: to })
    : it.kind === 'project' ? api('PUT', '/api/chat/projects/' + encodeURIComponent(it.id), { area: to })
    : api('PUT', `/api/library/assets/${encodeURIComponent(it.source)}/${encodeURIComponent(it.sourceId)}/area`, { area: to })).catch(() => null);
  function sortAreas() {
    const picked = new Set(), key = (it) => it.kind + ':' + it.id, all = () => [...U.chats, ...U.projects, ...U.files];
    const paint = (sh) => { const b = sh.querySelector('.xd-info'); if (!b) return;
      const group = (name, items) => (items.length ? `<div class="xd-sort-h"><b>${name}</b><span>${items.length}</span><button class="xd-btn ghost sm" data-sort-all="${items[0].kind}">${items.every((it) => picked.has(key(it))) ? 'Clear' : 'Select all'}</button></div><ul class="xd-list xd-sort">${items.map((it) => `<li><label><input type="checkbox" data-sort-pick="${esc(key(it))}"${picked.has(key(it)) ? ' checked' : ''}><div><b>${esc(it.title)}</b><small>${esc(it.meta)}</small></div></label></li>`).join('')}</ul>` : '');
      b.innerHTML = U.status === 'loading' ? '<p class="xd-note" data-sort-state="loading">Looking for work that is in no area…</p>'
        : U.status === 'error' ? '<p class="xd-note" data-sort-state="error">That couldn’t be loaded. <button class="xd-btn ghost sm" data-sort-retry>Try again</button></p>'
        : !U.count ? '<p class="xd-note" data-sort-state="done">Everything is in an area. Nothing left to sort.</p>'
        : `<div class="xd-sort-to" role="group" aria-label="Move the selected items to"><span>${picked.size ? `Move ${picked.size} to` : 'Select items, then choose an area'}</span>${P.areas().map(([id, name]) => `<button class="xd-btn ghost sm" data-sort-to="${esc(id)}"${picked.size ? '' : ' disabled'}>${esc(name)}</button>`).join('')}</div>${group('Chats', U.chats)}${U.moreChats ? `<p class="xd-note" data-sort-more="chats">${U.moreChats} more chats are in no area. They are listed here as you move these.</p>` : ''}${group('Projects', U.projects)}${group('Files', U.files)}${U.moreFiles ? '<p class="xd-note" data-sort-more="files">More files are in no area. They are listed here as you move these.</p>' : ''}`; };
    D().info({ title: 'Sort into areas', sub: 'Work that lives on Overview only. Each item you move shows in its area from then on.', size: 'md', html: '',
      onOpen: async (sh) => { U.status = 'loading'; paint(sh); await loadUnplaced(); if (!document.body.contains(sh)) return; paint(sh);
        sh.addEventListener('change', (e) => { const c = e.target.closest('[data-sort-pick]'); if (!c) return; if (c.checked) picked.add(c.dataset.sortPick); else picked.delete(c.dataset.sortPick); paint(sh); });
        sh.addEventListener('click', async (e) => {
          if (e.target.closest('[data-sort-retry]')) { U.status = 'loading'; paint(sh); await loadUnplaced(); return paint(sh); }
          const sa = e.target.closest('[data-sort-all]'); if (sa) { const items = all().filter((it) => it.kind === sa.dataset.sortAll), on = items.every((it) => picked.has(key(it))); items.forEach((it) => (on ? picked.delete(key(it)) : picked.add(key(it)))); return paint(sh); }
          const to = e.target.closest('[data-sort-to]'); if (!to || to.disabled) return;
          const items = all().filter((it) => picked.has(key(it))); sh.querySelectorAll('[data-sort-to]').forEach((x) => { x.disabled = true; });
          const done = await Promise.all(items.map((it) => moveOne(it, to.dataset.sortTo))), moved = items.filter((_, i) => done[i] && done[i].ok), failed = items.length - moved.length;
          moved.forEach((it) => picked.delete(key(it)));
          toast(failed ? `Moved ${moved.length} to ${areaLabel(to.dataset.sortTo)}. ${failed} couldn’t be moved and stay where they were.` : `Moved ${moved.length} to ${areaLabel(to.dataset.sortTo)}`);
          await loadUnplaced(); if (document.body.contains(sh)) paint(sh);
          try { window.XENO_RECENT_LIVE?.load?.(); window.XENO_CHAT?.load?.(); } catch {}
        }); } });
  }

  if (window.XA) { window.XA.scheduled = scheduled; window.XA.newScheduled = newScheduled; window.XA.allChats = allChats; window.XA.sortAreas = sortAreas; }
  addEventListener('message', (e) => { if (e.origin !== location.origin) return; const m = e.data; if (m && m.source === 'xeno-chat' && m.type === 'changed') { SR.cache.clear(); setTimeout(loadUnplaced, 800); } });
  window.XENO_AREA_LIVE = { served: true, loadNeeds, loadUnplaced, unplaced: () => ({ status: U.status, count: U.count }), scheduleOf, moveItems: (id, done) => { const t = SC.tasks.find((x) => String(x.id) === id); return t ? moveItems(t, done) : []; }, scheduled: () => ({ status: SC.status, count: SC.tasks.length, area: SC.area }), needs: () => ({ status: N.status, count: N.count }) };
  Promise.resolve(P.ready).then((user) => { if (user) { loadNeeds(); loadUnplaced(); } });
})();
