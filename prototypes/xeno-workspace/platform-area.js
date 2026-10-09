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
 *         GET /api/workspace/search?q= · GET /api/user-data/settings (the model a new scheduled chat uses).
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
  async function modelFor(area) {
    const got = await api('GET', '/api/user-data/settings').catch(() => null), s = (got && got.ok && got.d.settings) || {};
    const own = area && s.areas && typeof s.areas === 'object' ? s.areas[area]?.model : null;
    return (typeof own === 'string' && own) || (typeof s.models?.defaultModel === 'string' && s.models.defaultModel) || null;
  }
  async function newScheduled() {
    const here = P.area();
    const v = await D().form({ title: 'New scheduled chat', sub: here ? `Runs in ${areaLabel(here)}. XENO runs the prompt on schedule and keeps the answers in one chat.` : 'XENO runs the prompt on schedule and keeps the answers in one chat.', submit: 'Schedule', fields: [
      { id: 'name', label: 'Name', required: true, max: 60, placeholder: 'e.g. Friday wrap-up' },
      { id: 'prompt', label: 'What to do', type: 'textarea', rows: 3, required: true, max: 4000, placeholder: 'What should it look at, and what should it tell you?' },
      { id: 'rep', label: 'Repeat', type: 'seg', value: 'Weekdays', options: [['Daily', 'Every day'], ['Weekdays', 'Weekdays'], ['Weekly', 'Weekly'], ['Once', 'Once']] },
      { id: 'at', label: 'Time', required: true, value: '09:00', validate: (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(x.trim()) ? null : 'Use 24-hour time, like 09:00.') }] });
    if (!v) return false;
    const model = await modelFor(here);
    const r = await api('POST', '/api/chat/scheduled', { title: v.name.trim(), prompt: v.prompt.trim(), ...scheduleOf(v.rep, v.at.trim()), ...(model ? { model_id: model } : {}), area: here }).catch(() => null);
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

  if (window.XA) { window.XA.scheduled = scheduled; window.XA.newScheduled = newScheduled; }
  addEventListener('message', (e) => { if (e.origin !== location.origin) return; const m = e.data; if (m && m.source === 'xeno-chat' && m.type === 'changed') SR.cache.clear(); });
  window.XENO_AREA_LIVE = { served: true, loadNeeds, scheduleOf, moveItems: (id, done) => { const t = SC.tasks.find((x) => String(x.id) === id); return t ? moveItems(t, done) : []; }, scheduled: () => ({ status: SC.status, count: SC.tasks.length, area: SC.area }), needs: () => ({ status: N.status, count: N.count }) };
  Promise.resolve(P.ready).then((user) => { if (user) loadNeeds(); });
})();
