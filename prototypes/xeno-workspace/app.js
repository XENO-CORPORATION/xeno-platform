/* XENO Workspace shell — one rail (globals, MODES §7), one panel slot whose content follows the
   active destination, one main area. Mode = a manifest (data.js); nothing below is per-mode code. */
(() => {
  const M = window.XENO_MODE_MARKS, PR = window.XENO_PRODUCTS, MODES = window.XENO_MODES;
  M.overview = { ...M.xeno, name: 'Overview' };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const root = document.documentElement;
  const store = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };

  // ---- icons (stroke 1.75, monochrome) ----
  const I = {
    flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    // menu verbs (ctx-menu.js) — drawn on the element grid: square corners, no circles
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 5.5V5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h.5"/>',
    duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 5.5V5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h.5"/><path d="M14 11.5v5M11.5 14h5"/>',
    paste: '<path d="M9 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5H15"/><rect x="9" y="3.5" width="6" height="3" rx="1"/>',
    cut: '<rect x="4" y="15" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/><path d="M8 15 17 4M16 15 7 4"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h9.5a4.5 4.5 0 0 1 0 9H12"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11H9.5a4.5 4.5 0 0 0 0 9H12"/>',
    refresh: '<path d="M19.5 9A8 8 0 0 0 5 8.5M4.5 15A8 8 0 0 0 19 15.5"/><path d="M19.5 4v5h-5M4.5 20v-5h5"/>',
    link: '<path d="M10 14 14 10"/><path d="M8.5 11.5 6.5 13.5a3.2 3.2 0 0 0 4.5 4.5l2-2M15.5 12.5l2-2A3.2 3.2 0 0 0 13 6l-2 2"/>',
    external: '<path d="M13 4.5h6.5V11"/><path d="M19.5 4.5 11 13"/><path d="M17 14v4.5A1.5 1.5 0 0 1 15.5 20h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
    reply: '<path d="M9.5 6 4.5 11l5 5"/><path d="M4.5 11H14a5.5 5.5 0 0 1 5.5 5.5V19"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    info: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 11v5.5M12 7.5v.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
    sidebar: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M9.5 5v14"/>',
    forward: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    minus: '<path d="M5 12h14"/>',
    leave: '<path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10"/><path d="M14.5 8l4 4-4 4"/><path d="M18.5 12H9.5"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
    search: '<path d="M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.2-4.2"/>',
    chat: '<path d="M20 15.5H8.5L4 19.5V5h16z"/><path d="M8 9.5h8M8 12.5h5"/>',
    anima: '<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
    community: '<path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5"/><path d="M15.5 11.5a2.5 2.5 0 1 0 0-5M17 14.5c1.8.4 3 1.7 3.5 4"/>',
    market: '<path d="M4 8h16l-1.3 11.5H5.3z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5h4"/>',
    help: '<path d="M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.2"/>',
    side: '<path d="M3.5 5h17v14h-17zM9.5 5v14"/>',
    back: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    lib: '<path d="M4.5 4.5h4v15h-4zM10.5 4.5h4v15h-4zM16.5 6l3.5 1-3 12.5"/>',
    clock: '<path d="M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2"/>',
    folder: '<path d="M3.5 6h6.5l2 2h8.5v10.5h-17z"/>',
    pin: '<path d="M9 4h6l-1 6 4 4H6l4-4zM12 14v6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
    share: '<path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 13v7h14v-7"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    archive: '<path d="M3.5 4.5h17v4h-17zM5 8.5v11h14v-11M10 12h4"/>',
    open: '<path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6"/>',
    hub: '<path d="M4 5h16v11H4zM9 20h6M12 16v4"/>',
    gear: '<path d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
    star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
    layers: '<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3.2 12.5 12 17.5l8.8-5"/>',
    create: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    spark: '<path d="M4 20 15 9M13 7l4 4"/><path d="M17 3.5v3M15.5 5h3M20 9v2M19 10h2M10 4v2M9 5h2"/>',
    film: '<path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4"/>',
    doc: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
    mail: '<path d="M3.5 6h17v12h-17z"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
    calendar: '<path d="M4 6h16v14H4zM4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
    megaphone: '<path d="M4 10v4h3l7 4V6L7 10z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/>',
    places: '<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M3 14l9 4.5 9-4.5"/><path d="M3 18.5 12 23l9-4.5" opacity=".5"/>',
    building: '<path d="M5 20.5V4.5h9v16M14 9.5h5v11M8 8h3M8 11.5h3M8 15h3M3.5 20.5h17"/>',
    people: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19.5c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5"/><path d="M16 11.5a2.5 2.5 0 1 0 0-5M17.5 14.6c1.7.5 2.7 2 3 4.4"/>',
    handshake: '<path d="M3.5 12.5 7 9l4 1.5 3-2 6.5 4"/><path d="M7 9 3.5 12.5l5 5 2-1 2 1.5 2-1.5 2.5.5 3.5-3.5"/>',
    chart: '<path d="M4 20h16M7 16.5V11M12 16.5V7M17 16.5v-4"/>',
    bot: '<path d="M5.5 8.5h13v10h-13zM12 4.5v4M9 13h.01M15 13h.01M9.5 16h5"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    flow: '<path d="M4 5h6v5H4zM14 14h6v5h-6zM7 10v4.5a2 2 0 0 0 2 2h5"/>',
    box: '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M4 8l8 4.5L20 8M12 12.5v8"/>',
    grid: '<path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    activity: '<path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    bolt: '<path d="M13 3.5 5.5 13.5h6l-1 7 7.5-10h-6z"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  };
  const ic = (k, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" data-glyph="${(window.XENO_ELEMENT_IDS || {})[k] ? 'xeno.' + window.XENO_ELEMENT_IDS[k] : ''}">${(window.XENO_ELEMENT_SVG || {})[k] || I[k] || ''}</svg>`;
  const noMark = () => '';
  // icons are held back for now — only the logo and the mode switcher carry marks
  const pIcon = () => '';
  const pIconFull = (p, size) => p.icon ? `<img src="${window.XENO_ICON_DIR}${p.icon}.svg" alt="" width="${size}" height="${size}">` : `<span class="code">${esc(p.code || p.name.slice(0, 2))}</span>`;
  const mark = (id, cls = 'mk') => `<span class="${cls}">${M[id].svg}</span>`;
  const modeOf = (id) => MODES.find((m) => m.id === id);
  const homeModeOf = (pid) => MODES.find((m) => m.sections.some(([, ids]) => ids.includes(pid)));

  // ---- state ----
  const S = {
    view: store.get('view', 'mode'), mode: ((m) => (MODES.some((x) => x.id === m) ? m : 'studio'))(store.get('mode', 'studio')) /* a remembered mode may have been deleted */, product: store.get('product', null), global: null,
    panel: store.get('panel', 'open'), pins: store.get('pins', {}), openProjects: new Set(['AWS certification']), pinnedProjects: new Set(['AWS certification', 'XENO launch']),
  };
  if (S.view === 'global' || S.view === 'zone') S.view = 'mode';
  const pinsFor = (m) => S.pins[m] || modeOf(m)?.pins || [];   // a mode can disappear (a deleted custom mode)
  const modeOrder = () => { const saved = store.get('order', null); const ids = ['overview', ...MODES.map((m) => m.id)];
    const ord = Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : []; ids.forEach((id) => { if (!ord.includes(id)) ord.push(id); }); return ord; };
  const hiddenModes = () => new Set(store.get('hidden', []));
  const entryOf = (id) => id === 'overview' ? { id: 'overview', sections: [], key: '0', persona: 'All modes' } : modeOf(id);
  const orderedModes = () => modeOrder().filter((id) => id !== 'overview').map(modeOf);
  const orderedEntries = () => modeOrder().filter((id) => !modeOf(id)?.custom).map(entryOf);
  const visibleModes = () => { const h = hiddenModes(); return orderedModes().filter((m) => !h.has(m.id)); };
  const setOrder = (ord) => store.set('order', ord);
  const toggleHidden = (id) => { const h = hiddenModes(); h.has(id) ? h.delete(id) : h.add(id); if (h.size >= MODES.length + 1) h.delete(id); store.set('hidden', [...h]); return !h.has(id); };

  // ---- RAIL mode zone ----
  const inOv = () => S.view === 'dashboard' || S.zoneOf === 'overview';
  const ctxKey = () => (S.view === 'adaptive' ? 'adaptive' : inOv() ? 'overview' : S.mode);
  const ctxName = () => (inOv() ? 'Overview' : M[S.mode].name);
  const zoneKey = ctxKey;
  const zonesFor = (k) => (window.XENO_MODE_ZONES || {})[k] || [];
  // Overview: one category per mode; the open one shows its areas beneath it. A mode with something
  // live or new carries the signal on its category even while closed.
  const ovOpen = () => { const v = store.get('ovOpen', null); return Array.isArray(v) ? v : []; };
  function ovCatsHTML() {
    if (S.view === 'zone' && zoneNow()?.of && S._ovArrived !== S.zone) { S._ovArrived = S.zone; if (!ovOpen().includes(zoneNow().of)) store.set('ovOpen', [...ovOpen(), zoneNow().of]); }
    const openSet = new Set(ovOpen());
    return '<span class="rsep"></span>' + visibleModes().map((m) => {
      const zs = zonesFor('overview').filter((z) => z.of === m.id), isOpen = openSet.has(m.id);
      const sig = zs.map((z) => (window.XENO_BADGES || {})['overview.' + z.id]).filter(Boolean);
      const hasCur = S.view === 'zone' && zs.some((z) => z.id === S.zone);
      const cat = `<button class="rbtn rcat" data-cat="${m.id}" aria-expanded="${isOpen}" aria-current="${hasCur && !isOpen}" aria-label="${M[m.id].name} — ${zs.length} areas"${isOpen || hasCur ? "" : ` data-tip="${M[m.id].name}"`}>${ic({ studio: 'image', office: 'doc', social: 'megaphone', corpo: 'briefcase', dev: 'code', tools: 'sliders' }[m.id] || 'grid')}<span class="rcat-l">${M[m.id].name}</span>${sig.length && !isOpen ? (sig.includes('live') ? '<span class="live"></span>' : '<span class="dotn"></span>') : ''}</button>`;
      const kids = isOpen ? `<div class="rcat-kids">${zs.map((z) => { const bd = (window.XENO_BADGES || {})['overview.' + z.id]; const lab = M[m.id].name + ' · ' + esc(z.label) + (bd ? (bd === 'live' ? ' — running' : ` — ${bd} new`) : ''); return `<button class="rbtn sm" data-zone="${z.id}" aria-label="${lab}" data-tip="${lab}" aria-current="${S.view === 'zone' && S.zone === z.id}">${ic(z.icon)}${bd ? (bd === 'live' ? '<span class="live"></span>' : `<span class="cnt">${bd > 9 ? '9+' : bd}</span>`) : ''}</button>`; }).join('')}</div>` : '';
      return cat + kids;
    }).join('');
  }
  // patch the Overview strip in place: flip states, swap ONLY the tray whose owner changed
  function ovPatch() {
    const el = $('#rzone'); if (!el) return;
    if (!el.querySelector('.rcat')) { el.innerHTML = zoneHTML(); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = ovCatsHTML();
    tmp.querySelectorAll('.rcat').forEach((n) => { const live = el.querySelector(`.rcat[data-cat="${n.dataset.cat}"]`); if (!live) return;
      ['aria-expanded', 'aria-current'].forEach((at) => live.setAttribute(at, n.getAttribute(at))); if (n.dataset.tip) live.dataset.tip = n.dataset.tip; else delete live.dataset.tip;
      live.querySelectorAll('.live, .dotn').forEach((s) => s.remove()); n.querySelectorAll('.live, .dotn').forEach((s) => live.appendChild(s)); });
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    tmp.querySelectorAll('.rcat').forEach((n) => {
      const cat = n.dataset.cat, want = n.nextElementSibling && n.nextElementSibling.classList.contains('rcat-kids') ? n.nextElementSibling : null;
      const anchor = el.querySelector(`.rcat[data-cat="${cat}"]`), have = anchor && anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('rcat-kids') && !anchor.nextElementSibling.classList.contains('closing') ? anchor.nextElementSibling : null;
      if (!anchor) return;
      if (have && !want) { if (still) have.remove(); else { have.style.height = have.offsetHeight + 'px'; have.classList.add('closing'); requestAnimationFrame(() => { have.style.height = '0px'; }); setTimeout(() => have.remove(), 210); } }
      else if (!have && want) { const node = want.cloneNode(true); anchor.after(node); if (!still) { const full = node.scrollHeight; node.style.height = '0px'; node.classList.add('unfolding'); requestAnimationFrame(() => { node.style.height = full + 'px'; }); setTimeout(() => { node.style.height = ''; node.classList.remove('unfolding'); }, 210); } }
      else if (have && want) want.querySelectorAll('[data-zone]').forEach((z) => { const live = have.querySelector(`[data-zone="${z.dataset.zone}"]`); if (live) live.setAttribute('aria-current', z.getAttribute('aria-current')); });
    });
  }
  function zoneHTML() {
    const k = zoneKey();
    if (k === 'overview') return ovCatsHTML();
    let lastOf = null;
    return '<span class="rsep"></span>' + zonesFor(k).map((z) => { const grpSep = z.of && lastOf && z.of !== lastOf ? '<span class="rsep sm"></span>' : ''; lastOf = z.of || lastOf; const bd = (window.XENO_BADGES || {})[k + '.' + z.id]; const lab = (z.of ? M[z.of].name + ' · ' : '') + esc(z.label) + (bd ? (bd === 'live' ? ' — running' : ` — ${bd} new`) : ''); return `<button class="rbtn${z.of ? ' sm' : ''}" data-zone="${z.id}" aria-label="${lab}" data-tip="${lab}" aria-current="${S.view === 'zone' && S.zone === z.id}">${ic(z.icon)}${bd ? (bd === 'live' ? '<span class="live"></span>' : `<span class="cnt">${bd > 9 ? '9+' : bd}</span>`) : ''}</button>`; }).join('');
  }
  function updateZone() {
    const el = $('#rzone'); if (!el) return;
    const k = zoneKey();
    if (el.dataset.for === k && k === 'overview') { ovPatch(); return; }
    if (el.dataset.for === k) { el.querySelectorAll('[data-zone]').forEach((b) => b.setAttribute('aria-current', String(S.view === 'zone' && S.zone === b.dataset.zone))); return; }
    // the mode changed: the zone's icons swap with a short slide, the rest of the rail stays still
    el.classList.add('out');
    setTimeout(() => { el.innerHTML = zoneHTML(); el.dataset.for = k; el.classList.remove('out'); el.classList.add('in'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('in'))); }, el.dataset.for ? 140 : 0);
  }
  // ---- RAIL ----
  function renderRail() {
    const onDash = inOv() || S.view === 'adaptive';   // the rail wears the CONTEXT: Overview stays Overview inside any product it opens
    const cur = (k) => (k === 'home' && S.view === 'mode') || (k === 'chat' && S.view === 'product' && S.product === 'chat') || (S.view === 'global' && S.global === k);
    const rb = (k, icon, label, kbd = '') => `<button class="rbtn" data-go="${k}" aria-label="${label}" data-tip="${label}" data-kbd="${kbd}" aria-current="${cur(k)}">${ic(icon)}${k === 'bell' ? '<span class="badge"></span>' : ''}</button>`;
    const pins = pinsFor(S.mode).map((id) => { const p = PR[id]; const on = S.view === 'product' && S.product === id; return `<button class="rbtn" data-product="${id}" data-tip="${esc(p.name)}" aria-label="${esc(p.name)}" aria-current="${on}">${pIcon(p, 22)}</button>`; }).join('');
    const rail = $('#rail'), logoMark = onDash ? 'xeno' : S.mode;
    const logoLabel = `${onDash ? 'Overview' : M[S.mode].name + ' mode'} — click for the next mode, right-click to choose`;
    const logoTip = `${onDash ? 'Overview' : M[S.mode].name} · click: next mode · right-click: all modes`;
    // The rail is built ONCE and then PATCHED in place. Rebuilding it replaced the logo element mid
    // animation, which is what made the mode change "refresh" after the morph.
    if (rail.firstElementChild) {
      const logo = $('#logo');
      logo.setAttribute('aria-label', logoLabel); logo.dataset.tip = logoTip;
      const st = logo.querySelector('.mk:not(.morph)');
      if (st && st.dataset.mode !== logoMark) { st.innerHTML = M[logoMark].svg; st.dataset.mode = logoMark; }
      rail.querySelectorAll('.rbtn[data-go]').forEach((b) => b.setAttribute('aria-current', String(cur(b.dataset.go))));
      updateZone();
      const home = rail.querySelector('[data-go="home"]'); home.setAttribute('aria-label', `${M[S.mode].name} home`); home.dataset.tip = `${M[S.mode].name} home`;
      return;
    }
    rail.innerHTML = `
      <button class="logo" id="logo" aria-label="${logoLabel}" aria-haspopup="menu" data-tip="${logoTip}" data-kbd="Alt 0–6"><span class="mk" data-mode="${logoMark}">${M[logoMark].svg}</span></button>
      <div class="rmid" id="rmid">
      ${rb('home', 'home', `${M[S.mode].name} home`)}
      ${rb('chat', 'chat', 'Chat')}
      ${rb('projects', 'folder', 'Projects')}
      ${rb('library', 'lib', 'Library — everything you made, account-wide')}
      ${rb('workspace', 'building', 'Workspace — agents, teams, knowledge, automations')}
      ${rb('places', 'places', 'Places — your workspace as a building')}
      <span class="rsep"></span>
      ${rb('anima', 'anima', 'Anima')}
      ${rb('community', 'community', 'Community')}
      ${rb('market', 'market', 'Marketplace')}

      <div class="rzone" id="rzone" data-for="">${zoneHTML()}</div>
      </div>
      ${rb('bell', 'bell', 'Notifications')}
      ${rb('help', 'help', 'Help & report', 'F1')}
      <button class="credits" data-go="usage" data-tip="Usage" aria-label="Usage">2.4k</button>
      <button class="avatar" data-go="account" data-tip="Account, settings, connected accounts, get the apps" aria-label="Account">E</button>`;
  }

  function railFit() {
    const m = document.getElementById('rmid'); if (!m) return;
    const upd = () => { m.classList.toggle('fade-top', m.scrollTop > 2); m.classList.toggle('fade-bot', m.scrollTop + m.clientHeight < m.scrollHeight - 2); };
    if (!m.dataset.fit) { m.dataset.fit = '1'; m.addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); }
    const cur = m.querySelector('[aria-current="true"]'); if (cur) { const r = cur.getBoundingClientRect(), b = m.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) cur.scrollIntoView({ block: 'nearest' }); }
    upd();
  }
  // ---- PANEL contents ----
  const row = (attrs, inner, cls = '') => `<button class="row ${cls}" ${attrs}>${inner}</button>`;
  const sec = (key, title, body, acts = '') => `<div class="sec" data-sec="${key}"><div class="sh"><button class="t" data-fold>${title}${ic('chev')}</button><div class="acts">${acts}</div></div><div class="sbody">${body}</div></div>`;
  const productRow = (id, extra = '') => { const p = PR[id]; const on = S.view === 'product' && S.product === id;
    return row(`data-product="${id}" data-ctx="product" aria-current="${on}"`, `${pIconFull(p, 16)}<span class="t">${esc(p.name)}</span>${p.status === 'soon' ? '<span class="tag">Soon</span>' : ''}${extra}<span class="more" data-more>${ic('more')}</span>`, p.status === 'soon' ? 'soon' : ''); };

  // ── PANELS v2 (2026-10-03) — one job per panel kind; content lives in nav.js ──────────────
  const N = () => window.XENO_NEEDS || [];
  const needRow = (n) => row(`data-item="${esc(n.t)}" data-item-p="${n.p}"`, `<span class="t">${esc(n.t)}</span><span class="need">${esc(n.meta)}</span>`, 'needrow');
  const recentRow = (r) => row(`data-item="${esc(r.t)}" data-item-p="${r.p}" data-ctx="product" data-product="${r.p}"`, `<span class="t">${esc(r.t)}</span><span class="meta">${esc(r.ago)}</span><span class="more" data-more>${ic('more')}</span>`);
  const SEC_GLYPH = { Channels: 'hash', Labels: 'hash', 'Direct messages': 'user', Members: 'user', Divisions: 'building', Projects: 'folder', Folders: 'folder', Workspaces: 'folder', Sessions: 'bot', Assigned: 'bot', Runs: 'play', Workflows: 'flow', Spaces: 'layers', Libraries: 'lib', Dashboards: 'chart', Lists: 'people', Teams: 'people', Minds: 'anima', Soul: 'star', Chats: 'chat', Conversations: 'chat', Today: 'activity', Open: 'handshake', Queue: 'send', 'Needs approval': 'clock', Renders: 'film', Generations: 'spark', Inbox: 'mail', Documents: 'doc', Sheets: 'grid', Decks: 'layers', Favorites: 'star', Files: 'file', Company: 'building', 'Your feed': 'activity', Pinned: 'pin' };  // destination lists (Marketplace shelves, feeds) keep the quiet square: one icon repeated down a list is noise, not meaning
  // a navigation row carries a leading glyph (Linear, Notion, Finder): the eye scans the column of shapes before it reads.
  // Rows that are ITEMS (a run, a doc) stay text-first; rows that are PLACES (a filter, a source) get their glyph.
  const PLACE_GLYPH = { 'All files': 'folder', Images: 'image', Video: 'film', Audio: 'activity', Documents: 'doc', 'Code & artifacts': 'code', 'From chats': 'chat', Starred: 'star', 'Shared with me': 'people', Trash: 'trash' };
  const placeLead = (t, sect) => sect === 'From' && M[t.toLowerCase()]?.svg ? mark(t.toLowerCase(), 'mk row-mk') : PLACE_GLYPH[t] ? ic(PLACE_GLYPH[t]) : '';
  const workRow = ([t, meta, p], sect) => row(p ? `data-item="${esc(t)}" data-item-p="${p}"` : `data-item="${esc(t)}"`, `${p ? '' : placeLead(t, sect)}<span class="t">${esc(t)}</span><span class="meta">${esc(meta || '')}</span>`);
  const viewRow = (v) => row(`data-item="${esc(v)}"`, `${ic({ Calendar: 'calendar', Queue: 'clock', Drafts: 'edit', Inbox: 'inbox', Analytics: 'chart', Mentions: 'bell', Calls: 'play', Sessions: 'bot', Runs: 'play', Checkpoints: 'check', Workflows: 'flow', Connections: 'share', Templates: 'grid', Recent: 'clock', 'Shared with me': 'people', Starred: 'star', Favorites: 'star', Library: 'lib', Voices: 'play', Members: 'people', 'Agent workforce': 'bot', Divisions: 'building', Wallet: 'chart', 'Seller account': 'market', Seats: 'grid', Roles: 'layers', Feed: 'activity', Spaces: 'community', Moderation: 'check', Sent: 'send', Archive: 'archive', 'Recent files': 'clock', Projects: 'folder' }[v] || 'right')}<span class="t">${esc(v)}</span>`);
  const head = (markId, title, sub) => `<div class="ph">${noMark(markId)}<div class="ttl msw-inline">${title}<span class="msw-bar"></span><span class="msw-count">${sub}</span></div><button class="ib" data-go="search" aria-label="Search" data-tip="Search" data-kbd="Ctrl K">${ic('search')}</button><button class="ib" data-collapse aria-label="Collapse sidebar" data-tip="Collapse" data-kbd="Ctrl \\">${ic('side')}</button></div>`;

  // Overview = the cross-mode home: what needs you, what you pinned, what you touched. No mode cards
  // (the switcher owns modes) and no products (modes own those).
  function panelDashboard() {
    const pinned = (window.XENO_PINNED || []).map(([t, p]) => workRow([t, '', p])).join('');
    return `${head('xeno', 'Overview', 'All modes')}
      <div class="pbody">
        <button class="act primary" data-go="chat">${ic('plus')}New chat<kbd>Ctrl ⇧ O</kbd></button>
        ${N().length ? sec('needs', `Needs you<span class="cnt-inline">${N().length}</span>`, N().map(needRow).join('')) : ''}
        ${pinned ? sec('pinned', 'Pinned', pinned) : ''}
        ${sec('recent', 'Recent', window.XENO_RECENT.slice(0, 8).map(recentRow).join(''))}
      </div>`;
  }
  // Mode = that mode's home (MODES §7 dashboard + sidebar): start, what needs you HERE, pinned
  // products, recent work here, and the sections as entries into their zones — not repeated lists.
  function panelMode() {
    const m = modeOf(S.mode), needs = N().filter((n) => n.m === m.id);
    const recent = window.XENO_RECENT.filter((r) => r.m === m.id).slice(0, 5).map(recentRow).join('');
    const zones = zonesFor(m.id);
    return `${head(m.id, M[m.id].name, `${m.sections.reduce((n, [, ids]) => n + ids.length, 0)} products`)}
      <div class="pbody">
        ${m.id === 'tools' ? `<button class="act primary" data-go="market">${ic('market')}Browse all tools<kbd>Marketplace</kbd></button>` : `<button class="act primary" data-product="${m.start}">${ic('plus')}New in ${M[m.id].name}<kbd>${esc(PR[m.start].name)}</kbd></button>`}
        ${needs.length ? sec('needs', `Needs you<span class="cnt-inline">${needs.length}</span>`, needs.map(needRow).join('')) : ''}
        ${sec('pinned', 'Pinned', pinsFor(m.id).map((id) => productRow(id)).join(''))}
        ${recent ? sec('recent', 'Recent', recent) : ''}
        ${sec('sections', 'Sections', zones.map((z) => row(`data-zone="${z.id}"`, `${ic(z.icon)}<span class="t">${esc(z.label)}</span><span class="meta">${(z.products || []).length <= 2 ? (z.products || []).map((id) => PR[id].name).filter((nm) => nm !== z.label).map(esc).join(' · ') : (z.products || []).length}</span>`)).join(''))}
      </div>
      <div class="pfoot"><button class="row" data-switch>${ic('layers')}<span class="t">More modes</span><span class="meta">${MODES.length - 1} more</span></button></div>`;
  }
  function backHeader(p, title) {
    return `<div class="ph"><button class="ib" data-back aria-label="Back to ${ctxName()}" data-tip="Back to ${ctxName()}">${ic('back')}</button><div class="ttl"><span class="crumb">${ctxName()} ${ic('right')} <b>${esc(title)}</b></span></div><button class="ib" data-go="search" aria-label="Search" data-tip="Search" data-kbd="Ctrl K">${ic('search')}</button><button class="ib" data-collapse aria-label="Collapse sidebar" data-tip="Collapse" data-kbd="Ctrl \\">${ic('side')}</button></div>`;
  }
  // a context with no chat list of its own (the adaptive view, a custom mode) shares the default list. The default is kept with the
  // others, so its moves are saved, survive a reload and can be undone; before, it lived only in memory
  const ctxChats = () => { const map = window.XENO_CHATS_BY_CTX || (window.XENO_CHATS_BY_CTX = {}); return map[ctxKey()] || map.default || (map.default = JSON.parse(JSON.stringify(window.XENO_CHATS))); };
  function panelChat() {
    // on the platform the list is the person's real conversations (platform-chat.js); each row carries its id.
    // Rename, move and delete are in the chat itself, so a real row has no menu of sample actions.
    const live = window.XENO_CHAT && window.XENO_CHAT.served ? window.XENO_CHAT.data() : null;
    const C = live || ctxChats();
    const chatRow = (c, proj) => (c && c.id
      ? row(`data-chat-live="${esc(c.id)}" data-ctx="chat-live" aria-current="${String(live.current === c.id)}"`, `<span class="t">${esc(c.t)}</span><span class="more" data-more>${ic('more')}</span>`)
      : row(`data-chat="${esc(c)}" data-ctx="chat"`, `<span class="t">${esc(c)}</span><span class="more" data-more>${ic('more')}</span>`));
    const liveState = !live ? '' : live.status === 'loading' ? '<div class="row sub" role="status">Loading your chats</div>' : live.status === 'error' ? `<div class="row sub">Your chats couldn’t be loaded.</div><button class="row sub" data-chat-retry>${ic('refresh')}<span class="t">Try again</span></button>` : !live.recents.length && !live.projects.some((p) => p[2].length) ? '<div class="row sub">No chats yet. Start one above.</div>' : '';
    const projects = C.projects.slice().sort((a, b) => S.pinnedProjects.has(b[0]) - S.pinnedProjects.has(a[0])).map(([name, , chats]) => {
      const open = S.openProjects.has(name), pinned = S.pinnedProjects.has(name);
      return `<div class="pj ${open ? 'open' : ''}">${row(`data-project="${esc(name)}" data-ctx="project"`, `<span class="tw">${ic('right')}</span>${ic('folder')}<span class="t">${esc(name)}</span>${pinned ? ic('pin', 'i pin') : ''}<span class="meta">${chats.length || ''}</span><span class="more" data-more>${ic('more')}</span>`)}
        <div class="kids">${chats.map((c) => chatRow(c, name)).join('') || '<div class="row sub">No chats yet</div>'}<button class="row sub" data-open-project="${esc(name)}">${ic('folder')}<span class="t">Open project</span></button><button class="row sub" data-newin="${esc(name)}">${ic('plus')}<span class="t">New chat in project</span></button></div></div>`;
    }).join('');
    return `${backHeader('chat', 'Chat')}
      ${live ? '' : `<div class="ctx-note">Chats in ${esc(ctxName())} — each mode keeps its own</div>`}
      <div class="pbody">
        <button class="act primary" data-newchat>${ic('plus')}New chat<kbd>Ctrl ⇧ O</kbd></button>
        <button class="act" data-go-library="From chats">${ic('lib')}Library<kbd>From chats</kbd></button>
        <button class="act" data-xa="scheduled">${ic('clock')}Scheduled</button>
        ${sec('projects', 'Projects', projects + `<button class="row sub" data-go="projects">${ic('folder')}<span class="t">All projects</span></button>`, `<button class="ib" data-xa="newProject" aria-label="New project" data-tip="New project">${ic('plus')}</button>`)}
        ${live ? '' : sec('pinned', 'Pinned', C.pinned.map((t) => chatRow(t)).join(''))}
        ${sec('recents', 'Recents', live ? (liveState || C.recents.map(([g, ts]) => `<div class="grp">${g}</div>` + ts.map((t) => chatRow(t)).join('')).join('') + (live.more ? `<div class="row sub">${live.more} older chats are in the chat’s own history</div>` : '')) : C.recents.map(([g, ts]) => `<div class="grp">${g}</div>` + ts.map((t) => chatRow(t)).join('')).join('') + `<button class="row sub" data-xa="allChats">${ic('chat')}<span class="t">All chats</span></button>`)}
      </div>`;
  }
  // Product = the product's OWN sidebar (its views + its objects). Desktop apps keep their nav in
  // the app, so their panel is Open in Hub + recent files + projects. Planned products say so.
  function panelProduct(id) {
    const p = PR[id];
    if (p.kind === 'chat') return panelChat();
    const nav = (window.XENO_PRODUCT_NAV || {})[id];
    const recents = window.XENO_RECENT.filter((r) => r.p === id);
    const fileIcon = `<img src="${window.XENO_FILE_ICON_DIR}${p.icon || 'xeno-tools'}-file.svg" alt="" width="20" height="20" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'code',textContent:'${esc(p.code || p.name.slice(0, 2))}'}))">`;
    const recentSec = recents.length ? sec('recent', p.kind === 'desktop' && !nav ? 'Recent files' : 'Recent', recents.map((r) => row(`data-item="${esc(r.t)}" data-item-p="${id}"`, `<span class="t">${esc(r.t)}</span><span class="meta">${esc(r.ago)}</span>`)).join('')) : '';
    if (p.status === 'soon') return `${backHeader(id, p.name)}
      <div class="pbody">
        ${window.XL.notifyBtn(id, 'act primary')}
        <div class="empty-note"><b>${esc(p.name)} is coming.</b><span>${esc(p.blurb)}. It is planned and not built yet — nothing here is real work.</span></div>
      </div>`;
    if (nav) return `${backHeader(id, p.name)}
      <div class="pbody">
        <button class="act primary" data-xl-new="${id}" data-xl-noun="${esc(nav.primary)}">${ic('plus')}${esc(nav.primary)}</button>
        ${(nav.views || []).length ? `<div class="views">${nav.views.map(viewRow).join('')}</div>` : ''}
        ${(nav.views || []).includes('Recent') ? '' : recentSec}
        ${(nav.sections || []).map(([t, rows]) => sec(t.toLowerCase().replace(/\W+/g, '-'), t, rows.map((r) => workRow(r, t)).join(''))).join('')}
      </div>`;
    return `${backHeader(id, p.name)}
      <div class="pbody">
        ${p.kind === 'desktop' ? `<button class="act primary" data-xl-hub="${id}">${ic('hub')}Open in Hub</button>` : `<button class="act primary" data-xl-new="${id}">${ic('plus')}New ${esc(p.name.toLowerCase())}</button>`}
        ${recentSec || `<div class="empty-note"><b>No ${esc(p.name)} work yet.</b><span>What you make here shows up in this list.</span></div>`}
        ${p.kind === 'desktop' ? sec('projects', 'Projects', row(`data-projects-of="${id}"`, `${ic('folder')}<span class="t">All ${esc(p.name)} projects</span>`)) : ''}
      </div>`;
  }
  // Globals = their real top level (MODES §4). Every row is a destination inside that global.
  function panelGlobal(k) {
    const [title, sub, primary0, groups0] = window.XENO_GLOBAL_NAV[k], [primary, groups] = window.XENO_VIS?.nav ? window.XENO_VIS.nav(k, primary0, groups0) : [primary0, groups0];
    return `<div class="ph"><div class="ttl msw-inline">${title}<span class="msw-bar"></span><span class="msw-count">${esc(sub)}</span></div><button class="ib" data-go="search" aria-label="Search" data-tip="Search" data-kbd="Ctrl K">${ic('search')}</button><button class="ib" data-collapse aria-label="Collapse sidebar" data-tip="Collapse" data-kbd="Ctrl \\">${ic('side')}</button></div>
      <div class="pbody">
        ${primary ? `<button class="act primary" ${{ 'New project': 'data-xa="newProject"', 'Invite people or agents': 'data-xa="invite"', 'New thread': 'data-xa="newThread"', Upload: 'data-xa="upload"', 'Mark all read': 'data-xa="markAllRead"', 'New chat with Anima': 'data-xa="animaChat"', Browse: 'data-go="market"' }[primary] || 'disabled'}>${ic(k === 'market' ? 'market' : k === 'library' ? 'upload' : k === 'workspace' ? 'user' : k === 'inbox' ? 'check' : 'plus')}${esc(primary)}</button>` : ''}
        ${groups.map(([t, rows]) => sec(t.toLowerCase().replace(/\W+/g, '-'), t, rows.map((r) => workRow(r, t)).join(''))).join('')}
      </div>`;
  }
  function panelSwitcher() {
    const curId = S.view === 'dashboard' ? 'xeno' : S.mode;
    const primary = store.get('primary', 'studio');
    const customs = window.XENO_CUSTOM.list();
    const count = (m) => m.sections.reduce((n, [, ids]) => n + ids.length, 0);
    const preview = (ids) => ids.slice(0, 5).map((id) => esc(PR[id].name)).join(' · ') + (ids.length > 5 ? ` · +${ids.length - 5}` : '');
    const row = (o) => `<button class="msw-row${o.hidden ? ' dim' : ''}" role="option" data-msw="${o.id}" ${o.attrs} aria-selected="${o.id === curId}">
        <span class="msw-mk">${o.mk}</span>
        <span class="msw-txt msw-line"><span class="msw-name">${o.name}</span><span class="msw-bar"></span><span class="msw-count">${o.sub}</span>${o.id === primary || (o.id === 'overview' && primary === 'overview') ? '<span class="msw-tag">Default</span>' : ''}${o.hidden ? '<span class="msw-tag">Hidden</span>' : ''}</span>
        <span class="msw-end">${o.id === curId ? `<span class="msw-check">${ic('check')}</span>` : ''}<kbd>${o.kbd || ''}</kbd></span>
      </button>`;
    return `<div class="msw" data-msw-root>
      <div class="ph msw-ph"><div class="ttl msw-inline">${S.view === 'adaptive' ? 'Adaptive' : curId === 'xeno' ? 'Overview' : M[curId].name}<span class="msw-bar"></span><span class="msw-count">${S.view === 'adaptive' ? 'Beta' : curId === 'xeno' ? 'All modes' : count(modeOf(curId)) + ' products'}</span></div><button class="ib" data-close-switch aria-label="Close" data-tip="Close" data-kbd="Esc">${ic('x')}</button></div>
      <div class="msw-list" role="listbox" aria-label="Modes">
        ${(() => { const hid = hiddenModes(), ents = [...orderedEntries().filter((x) => !hid.has(x.id)), ...orderedEntries().filter((x) => hid.has(x.id))];
          const cur = S.view === 'adaptive' ? null : curId === 'xeno' ? 'overview' : curId; // in Adaptive every mode is listed — none is current
          return ents.filter((x) => x.id !== cur).map((x) => { const ids = x.sections.flatMap(([, y]) => y);
            return row({ id: x.id, attrs: `data-mode="${x.id}" data-ctx="mode"`, mk: mark(x.id === 'overview' ? 'xeno' : x.id), name: M[x.id].name, sub: x.id === 'overview' ? 'All modes' : `${count(x)} products`, kbd: 'Alt ' + x.key, hidden: hid.has(x.id) }); }).join(''); })()}
        <button class="msw-row" role="option" data-adaptive aria-selected="${S.view === 'adaptive'}"><span class="msw-mk"><span class="ad-mk">${ic('spark')}</span></span><span class="msw-txt msw-line"><span class="msw-name">Adaptive</span><span class="msw-bar"></span><span class="msw-count">Shapes itself to you</span><span class="msw-tag">Beta</span></span><span class="msw-end">${S.view === 'adaptive' ? `<span class="msw-check">${ic('check')}</span>` : ''}</span></button>
        <div class="msw-grp">Your modes</div>
        ${customs.map((c) => row({ id: c.id, attrs: `data-mode="${c.id}" data-ctx="mode" data-find="${esc((c.name + ' ' + c.products.map((i) => PR[i]?.name || '').join(' ')).toLowerCase())}"`, mk: mark('xeno').replace('class="mk"', 'class="mk mono"'), name: esc(c.name), sub: `${c.products.length} products`, more: preview(c.products) })).join('')}
        <button class="msw-row add" data-xa="customMode"><span class="msw-mk add">${ic('plus')}</span><span class="msw-txt msw-line"><span class="msw-name">New custom mode</span></span></button>
        <div class="msw-empty" hidden>No mode or product matches</div>
      </div>
      <div class="msw-foot"><button class="msw-manage" data-manage>${ic('gear')}Manage modes</button></div>
    </div>`;
  }
  function panelManage() {
    const primary = store.get('primary', 'studio'), hidden = hiddenModes(), ord = modeOrder();
    const customs = window.XENO_CUSTOM.list();
    return `<div class="msw" data-msw-root>
      <div class="ph msw-ph"><button class="ib" data-manage-back aria-label="Back" data-tip="Back">${ic('back')}</button><div class="ttl">Manage modes</div><button class="ib" data-close-switch aria-label="Close" data-tip="Close" data-kbd="Esc">${ic('x')}</button></div>
      <div class="msw-list">
        <div class="msw-help">Choose your default, set the order, and hide modes you don't use — the logo cycle skips them.</div>
        ${ord.filter((id) => !modeOf(id)?.custom).map((id, i, ordB) => { const on = !hidden.has(id); return `<div class="mm-row ${on ? '' : 'dim'}" data-mm="${id}">
            <button class="mm-def" data-mm-default="${id}" aria-pressed="${id === primary}" aria-label="Make ${M[id].name} the default mode" data-tip="${id === primary ? 'Default mode' : 'Make default'}"><span></span></button>
            <span class="msw-mk">${mark(id === 'overview' ? 'xeno' : id)}</span><span class="mm-name">${M[id].name}</span>
            <span class="mm-acts">
              <button class="ib" data-mm-up="${id}" aria-label="Move ${M[id].name} up" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
              <button class="ib" data-mm-down="${id}" aria-label="Move ${M[id].name} down" ${i === ordB.length - 1 ? 'disabled' : ''}>${ic('chev')}</button>
              <button class="mm-switch" role="switch" data-mm-hide="${id}" aria-checked="${on}" aria-label="Show ${M[id].name} in the cycle" data-tip="${on ? 'Shown in cycle' : 'Hidden from cycle'}"><span></span></button>
            </span></div>`; }).join('')}
        <div class="msw-grp">Your modes</div>
        ${customs.map((c) => `<div class="mm-row"><span class="mm-def ghost"></span><span class="msw-mk">${mark('xeno').replace('class="mk"', 'class="mk mono"')}</span><span class="mm-name">${esc(c.name)}</span><span class="mm-acts"><button class="ib" data-xa="customMode" data-arg="${c.id}" aria-label="Edit ${esc(c.name)}" data-tip="Edit">${ic('edit')}</button><button class="ib" data-xa="deleteCustomMode" data-arg="${c.id}" aria-label="Delete ${esc(c.name)}" data-tip="Delete">${ic('trash')}</button></span></div>`).join('')}
        <button class="msw-row add" data-xa="customMode"><span class="msw-mk add">${ic('plus')}</span><span class="msw-txt msw-line"><span class="msw-name">New custom mode</span></span></button>
      </div>
    </div>`;
  }
  const zoneNow = () => zonesFor(zoneKey()).find((z) => z.id === S.zone) || zonesFor(zoneKey())[0];
  // Zone = one SECTION of the mode (MODES §3): its products, then the work living in them.
  // Overview's zones are workforce objects (WORKFORCE §11.2), so they carry work only.
  const listJoin = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  function zoneRows(z) {
    // honesty: a planned product has no work yet — never show sample "inbox"/"files" rows for it
    const prods = z.products || [], live = prods.filter((id) => PR[id] && PR[id].status !== 'soon');
    const rows = z.work ? z.work[1].filter((r) => (r[2] ? PR[r[2]] && PR[r[2]].status !== 'soon' : !prods.length || live.length)) : [];
    const coming = prods.length && !live.length;
    return [prods.length ? sec('products', 'Products', prods.map((id) => productRow(id)).join('')) : '',
      rows.length ? sec('work', z.work[0], rows.map((r) => workRow(r, z.work[0])).join('') + row(`data-item="All ${esc(z.work[0].toLowerCase())}"`, `${ic('right')}<span class="t">View all</span>`, 'sub')) : '',
      coming ? `<div class="empty-note"><b>Nothing here yet.</b><span>${listJoin(prods.map((id) => esc(PR[id].name)))} ${prods.length > 1 ? 'are' : 'is'} planned, not built — your ${esc(z.label.toLowerCase())} will appear here once ${prods.length > 1 ? 'they launch' : 'it launches'}.</span></div>` : ''].join('');
  }
  function panelZone() {
    const z = zoneNow(), k = zoneKey();
    const first = (z.products || []).find((id) => PR[id] && PR[id].status !== 'soon');
    const primary = z.action && first ? `<button class="act primary" data-xl-new="${first}" data-xl-noun="${esc(z.action)}">${ic('plus')}${esc(z.action)}</button>`
      : first ? `<button class="act primary" data-product="${first}">${ic('plus')}New in ${esc(PR[first].name)}</button>`
      : (z.products || []).length ? window.XL.notifyBtn(z.products, 'act primary', `Notify me when ${z.products.length > 1 ? 'they launch' : 'it launches'}`) : '';
    return `<div class="ph"><div class="ttl msw-inline">${esc(z.label)}<span class="msw-bar"></span><span class="msw-count">${z.of ? M[z.of].name : M[k].name}</span></div><button class="ib" data-go="search" aria-label="Search" data-tip="Search" data-kbd="Ctrl K">${ic('search')}</button><button class="ib" data-collapse aria-label="Collapse sidebar" data-tip="Collapse" data-kbd="Ctrl \\">${ic('side')}</button></div>
      <div class="pbody">${primary}<div class="msw-help" style="padding:2px 10px 8px">${esc(z.blurb)}</div>${zoneRows(z)}</div>${z.of ? `<div class="pfoot"><button class="row" data-mode="${z.of}">${ic('layers')}<span class="t">Open ${M[z.of].name} mode</span><span class="meta">all ${zonesFor(z.of).length} areas</span></button></div>` : ''}`;
  }
  // ── ADAPTIVE MODE (MODES SPEC §8b, Beta) — a mode manifest the system writes from usage ─────
  // Contract honoured here: changes land at a boundary (entering the mode), morph instead of
  // jumping, explain themselves, undo/pin/freeze in one step, pins always win, opt-in + delete.
  const AD = {
    on: () => store.get('adOn', false),
    usage: () => store.get('adUsage', null),
    pins: () => store.get('adPins', []) || [],
    hidden: () => store.get('adHidden', []) || [],
  };
  // first run: seed from recent work so the mode is not empty — labelled sample in the UI
  function adSeed() { const u = {}; window.XENO_RECENT.forEach((r, i) => { u[r.p] = { n: Math.max(1, 9 - i), last: Date.now() - i * 3600e3 }; }); store.set('adUsage', u); return u; }
  function adTrack(id) { if (!AD.on() || !PR[id] || id === 'chat') return; const u = AD.usage() || adSeed(); const e = u[id] || { n: 0, last: 0 }; e.n += 1; e.last = Date.now(); u[id] = e; store.set('adUsage', u); }
  // score = frequency, decayed by recency (half-life ~3 days)
  function adRank() {
    const u = AD.usage() || adSeed(), now = Date.now(), snz = store.get('adSnooze', {}) || {}, hid = new Set([...AD.hidden(), ...Object.keys(snz).filter((id) => snz[id] > now)]);
    const scored = Object.entries(u).filter(([id]) => PR[id] && !hid.has(id)).map(([id, e]) => [id, e.n * Math.pow(0.5, (now - e.last) / (3 * 864e5))]).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const pins = AD.pins().filter((id) => PR[id] && !hid.has(id));
    return [...pins, ...scored.filter((id) => !pins.includes(id))].slice(0, 8);
  }
  const adReason = (id) => { const e = (AD.usage() || {})[id]; if (AD.pins().includes(id)) return 'Pinned by you'; return e ? `Opened ${e.n}× this week` : ''; };
  // the boundary: recompute once on entering the mode, remember what moved so it can explain + undo
  function adRecompute() {
    const prev = store.get('adOrder', null), next = adRank();
    if (!prev) { store.set('adOrder', next); return; }
    if (prev.join() === next.join()) return;
    const moved = next.find((id, i) => prev.indexOf(id) > i || prev.indexOf(id) < 0);
    store.set('adPrev', prev); store.set('adOrder', next);
    if (moved) { const isNew = !prev.includes(moved);
      store.set('adTrace', { id: moved, t: `${isNew ? 'Added' : 'Moved'} ${PR[moved].name} ${isNew ? 'to your mode' : 'up'} — ${adReason(moved).toLowerCase() || 'you use it more'}`, at: Date.now() });
      const hist = (store.get('adHistory', []) || []); hist.unshift({ t: store.get('adTrace').t, at: Date.now() }); store.set('adHistory', hist.slice(0, 12)); }
  }
  // ---- Mode intro — the first time a mode opens (same two-sided sheet as Adaptive's consent) ----
  // It does a job instead of a tour: you leave with the mode set up — your products pinned (the same
  // pins the rail and sidebar read) and, if you want, this mode as the one XENO opens in. The preview
  // on the left IS this mode's sidebar, updating as you choose. Skip, Esc or ✕ keep the defaults.
  const MODE_INTRO = {
    studio: ['Everything you make, in one place.', 'Images, video, sound, 3D and design — the editors and the generators side by side, sharing one library.'],
    office: ['Your documents, numbers and mail.', 'Write, calculate, present and keep notes — with your mail and files next to the work they belong to.'],
    social: ['Reach people, and talk to them.', 'Publish to every channel from one queue, answer conversations, and run your community and audience.'],
    corpo: ['Run the business — with people and agents.', 'Your company, its wallet, its team, its customers and its numbers, in one view.'],
    dev: ['Build things that run.', 'Agent sessions, automations and the SDKs — with the runs that need you surfaced first.'],
    tools: ['A tool when you need one, not a product.', 'Resize, trim, transcribe, convert — open one, use it, close it.'],
  };
  const DEMO_LINE = { frame: 'Lay out pages, components and prototypes', photo: 'Edit and retouch images layer by layer', timeline: 'Cut, grade and animate on a timeline', wave: 'Record, mix and master audio', page: 'Write and format documents', grid: 'Model numbers with formulas and charts', slide: 'Build presentations', post: 'Write once, publish to every channel', chat: 'Talk to people and agents', term: 'Run agents that write and test code', flow: 'Automate steps between your tools' };
  function productDemo(pid) {
    const p = PR[pid]; if (!p) return '';
    const kind = (mini(pid).match(/mn--(w+)/) || [])[1] || 'page', soon = p.status === 'soon';
    return `<div class="mi-win${soon ? ' soon' : ''}" data-demo="${pid}">
      <div class="mi-win-bar"><i></i><i></i><i></i><span>${pIconFull(p, 14)}${esc(p.name)}</span><em>${soon ? 'Coming soon' : p.kind === 'web' ? 'Runs here' : p.kind === 'chat' ? 'In chat' : 'Desktop app'}</em></div>
      <div class="mi-win-body mi-demo">${mini(pid)}</div>
      <div class="mi-win-cap"><span class="mi-win-txt"><b>${esc(p.name)}</b><span>${esc(p.blurb || DEMO_LINE[kind] || '')}</span></span><span class="mi-win-pin"></span></div></div>`;
  }
  // the real home for a mode, rendered small and inert — the page you land on, not a picture of it
  function homeSnapshot(id) { const keep = S.mode; S.mode = id; let html = ''; try { html = mainMode(); } finally { S.mode = keep; } return html; }
  // the big sheets fill the viewport; their previews scale with the room they get (CSS cannot divide by a length)
  function fitSheet(d) {
    if (!d || !d.classList.contains('on')) return;
    const prev = d.querySelector('.adp'); if (!prev) return; const r = prev.getBoundingClientRect();
    // scale the preview to the space actually free: panel height minus its toggle row, caption and padding
    const body = d.querySelector('.adp-stage, .mi-v-sidebar .mi-panel'), top = prev.querySelector('.adp-top'), cap = prev.querySelector('.adp-cap');
    const free = prev.clientHeight - (top?.offsetHeight || 0) - (cap?.offsetHeight || 0) - 90, natural = body?.offsetHeight || 1;
    d.style.setProperty('--ps', Math.max(1, Math.min(1.45, free / natural, r.width / 520)).toFixed(3));
    const home = d.querySelector('.mi-home'); if (home) d.style.setProperty('--hs', (home.clientWidth / 1080).toFixed(3));
  }
  addEventListener('resize', () => { fitSheet(document.getElementById('modeIntro')); fitSheet(document.getElementById('adModal')); });
  let introOpener = null;
  const introSeen = () => store.get('introSeen', {}) || {};
  // One continuous scene, not three slides: a miniature of the whole workspace (rail · sidebar · main)
  // with a camera. Sidebar = the camera on your sidebar. Home = the camera pulls back, the sidebar
  // collapses the way Ctrl \ collapses it, and your real home slides into the main area. Product = a
  // cursor travels to the product — the rail if it is pinned (one click away), Ctrl K if it is not —
  // clicks, and the product window opens from that point. One element moves at a time; every step
  // can be interrupted by the next choice.
  const MW = { W: 1200, H: 760, RAIL: 56, SIDE: 300 };
  function sheetOpen(d) { clearTimeout(d._closeT); d.classList.remove('closing'); d.classList.add('on'); document.documentElement.classList.add('modal-open'); }
  function sheetClose(d, done) {
    if (!d || !d.classList.contains('on')) return done?.();
    clearTimeout(d._closeT); d.classList.add('closing');
    d._closeT = setTimeout(() => { d.classList.remove('on', 'closing'); document.documentElement.classList.remove('modal-open'); done?.(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 90 : 220);
  }
  function openModeIntro(id, opener) {
    const m = modeOf(id); if (!m || !MODE_INTRO[id]) return;
    introOpener = opener || document.activeElement; hidePops();
    let d = document.getElementById('modeIntro'); if (!d) { d = document.createElement('div'); d.id = 'modeIntro'; document.body.appendChild(d); }
    let pins = pinsFor(id).filter((x) => PR[x]).slice(0, 6), makeDefault = store.get('primary', 'studio') === id;
    const isDefault = makeDefault, zones = zonesFor(id), [title, lead] = MODE_INTRO[id];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const used = {}; window.XENO_RECENT.forEach((r) => { if (r.m === id && !used[r.p]) used[r.p] = r.ago; });
    const tile = (pid, sec) => { const p = PR[pid]; return `<button class="mi-chip mi-tile" data-mi-pin="${pid}" aria-pressed="${pins.includes(pid)}" title="${esc(p.name)} — ${esc(p.blurb || '')}"><span class="mi-tile-ic">${pIconFull(p, 18)}</span><span class="mi-tile-t"><b>${esc(p.name)}${used[pid] ? '<em>Recent</em>' : ''}${sec ? `<i class="mi-tsec">${esc(sec)}</i>` : ''}</b><small>${esc(used[pid] ? (/[0-9]/.test(used[pid]) ? `Used ${used[pid]} ago` : `Used ${used[pid].toLowerCase()}`) : p.blurb || '')}</small></span><i class="mi-tick">${ic('check')}</i></button>`; };
    const soonChip = (pid) => `<button class="mi-chip mi-soon" data-mi-pin="${pid}" aria-disabled="true" aria-pressed="false">${esc(PR[pid].name)}</button>`;
    const live = m.sections.map(([sec, ids]) => [sec, ids.filter((x) => PR[x] && PR[x].status !== 'soon')]).filter(([, x]) => x.length);
    const soonIds = m.sections.flatMap(([, ids]) => ids).filter((x) => PR[x] && PR[x].status === 'soon');
    const railBtnHTML = (icon, attr = '') => `<span class="mw-rb" ${attr}>${ic(icon)}</span>`;
    d.innerHTML = `<div class="adc-back" data-mi-skip></div>
      <div class="adc adx mi rp" role="dialog" aria-modal="true" aria-labelledby="mi-title" aria-describedby="mi-lead">
        <section class="pl adp mi-prev" aria-label="Preview of ${esc(M[id].name)}">
          <div class="adp-top"><div class="pl-seg mi-seg" role="tablist" aria-label="Preview" data-seg="mi-view" style="--i:0;--n:3"><button role="tab" aria-selected="true" aria-checked="true" data-mi-view="sidebar">Sidebar</button><button role="tab" aria-selected="false" aria-checked="false" data-mi-view="home">Home</button><button role="tab" aria-selected="false" aria-checked="false" data-mi-view="product">Product</button></div>
            <span class="mi-live" data-for="sidebar">Updates as you choose</span><span class="mi-live mi-hint" data-for="home">Your home, from your own work</span><span class="mi-live mi-hint" data-for="product">Point at a product to open it</span></div>
          <div class="mi-stage" data-view="sidebar"><div class="mw-cam"><div class="mw" data-state="sidebar" aria-hidden="true">
            <div class="mw-rail">${mark(id, 'mw-mark')}${railBtnHTML('home', 'data-r="home"')}${railBtnHTML('chat')}${railBtnHTML('folder')}${railBtnHTML('lib')}<i class="mw-sep"></i><span class="mw-pins"></span><span class="mw-sp"></span>${railBtnHTML('search', 'data-r="search"')}${railBtnHTML('bell')}<span class="mw-av">E</span></div>
            <div class="mw-side"><div class="mw-side-in">
              <div class="mi-ph"><b>${esc(M[id].name)}</b><span>${m.sections.reduce((n, [, x]) => n + x.length, 0)} products</span></div>
              <div class="mi-new" data-p="${m.start}">${ic(id === 'tools' ? 'market' : 'plus')}<span>${id === 'tools' ? 'Browse all tools' : `New in ${esc(M[id].name)}`}</span></div>
              <div class="mi-cap">Pinned <span class="mi-n"></span></div><div class="mi-pins"></div>
              <div class="mi-cap">Sections</div>${zones.map((z, i) => { const zp = (z.products || []).find((x) => PR[x]); return `<div class="mi-row mi-zone" style="--d:${i}" ${zp ? `data-p="${zp}"` : ''}>${ic(z.icon)}<span>${esc(z.label)}</span></div>`; }).join('')}
            </div></div>
            <div class="mw-main">
              <span class="mw-open" data-r="side" title="Open sidebar">${ic('side')}</span>
              <div class="mw-home mi-home"><div class="mw-home-in">${homeSnapshot(id)}</div></div>
              <div class="mw-prod"></div>
            </div>
            <div class="mw-kbar"><div class="mw-kq">${ic('search')}<span></span><kbd>Ctrl K</kbd></div><div class="mw-klist">${m.sections.flatMap(([, x]) => x).filter((x) => PR[x] && PR[x].status !== 'soon').slice(0, 6).map((x) => `<div class="mw-krow" data-p="${x}">${pIconFull(PR[x], 16)}<span>${esc(PR[x].name)}</span><em>${esc(PR[x].blurb || '')}</em></div>`).join('')}</div></div>
            <div class="mw-cursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.4L9.6 19z" fill="#fafafa" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/></svg><i></i></div>
          </div></div></div>
          <p class="adp-cap">Everything stays reachable from the switcher and Ctrl K — pinning only decides what is one click away.</p>
        </section>
        <section class="pl adx-copy mi-copy">
          <button class="pp-ib adx-close" data-mi-skip aria-label="Close" data-tip="Close  Esc">${ic('x')}</button>
          <span class="adx-eyebrow mi-eye">${mark(id, 'mi-mk')}${esc(M[id].name)} mode <span>First time here</span></span>
          <h2 id="mi-title">${esc(title)}</h2>
          <p id="mi-lead" class="adx-lead">${esc(lead)}</p>
          <div class="mi-pick">
            <div class="mi-pickh"><span class="mi-pickt"><b>Pin what you use</b><small>Pinned products sit in your rail and sidebar — one click away.</small></span><span class="mi-slots" aria-label="Pinned"><span class="mi-slotbar">${Array.from({ length: 6 }, (_, i) => `<i data-slot="${i}"></i>`).join('')}</span><span class="mi-count"></span></span></div>
            <div class="mi-grid">${live.every(([, x]) => x.length === 1) ? live.map(([sec, ids]) => tile(ids[0], sec)).join('') : live.map(([sec, ids]) => `<span class="mi-sec">${esc(sec)}</span>${ids.map((x) => tile(x)).join('')}`).join('')}</div>
            ${soonIds.length ? `<div class="mi-soonline"><span>Coming soon</span>${soonIds.map(soonChip).join('')}</div>` : ''}
          </div>
          <label class="mi-defcard"><input type="checkbox" data-mi-default ${makeDefault ? 'checked' : ''}><span class="mi-defic">${mark(id, 'mi-mk')}</span><span class="adx-st"><b>Open XENO in ${esc(M[id].name)}</b><small>${isDefault ? 'It already is your default mode' : 'Make it your default mode — change it any time in the switcher'}</small></span><span class="adx-sw"><i></i></span></label>
          <div class="adc-btns adx-btns"><button class="us-ghost" data-mi-skip>Keep defaults</button><button class="us-primary" data-mi-start>Start in ${esc(M[id].name)}<kbd>Enter</kbd></button></div>
        </section>
      </div>`;
    sheetOpen(d); d.dataset.mode = id;
    const dialog = d.querySelector('.mi'), stage = d.querySelector('.mi-stage'), cam = d.querySelector('.mw-cam'), mw = d.querySelector('.mw');
    const cursor = d.querySelector('.mw-cursor'), kbar = d.querySelector('.mw-kbar'), prod = d.querySelector('.mw-prod'), seg = d.querySelector('.mi-seg');
    let curPid = null, seq = 0, view = 'sidebar';
    // ---- the camera: sidebar = close on rail + sidebar; home / product = the whole workspace ----
    let firstCam = true;
    const camera = () => {
      if (firstCam) { firstCam = false; cam.classList.add('mw-settle'); requestAnimationFrame(() => requestAnimationFrame(() => cam.classList.remove('mw-settle'))); }
      const W = stage.clientWidth, H = stage.clientHeight, fit = Math.min(W / MW.W, H / MW.H);
      // sidebar: closer, with the rail + sidebar column centred and its top in view; the rest stays as context
      const near = view === 'sidebar', s = near ? Math.min(fit * 1.35, (H - 24) / 600) : fit;
      const tx = near ? W * 0.36 - ((MW.RAIL + MW.SIDE) / 2) * s : (W - MW.W * s) / 2, ty = near ? 12 : (H - MW.H * s) / 2;
      cam.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
      cam.dataset.s = s;
    };
    const paint = () => {
      d.querySelector('.mi-pins').innerHTML = pins.length ? pins.map((pid) => `<div class="mi-row mi-pinrow" data-p="${pid}">${pIconFull(PR[pid], 16)}<span>${esc(PR[pid].name)}</span></div>`).join('') : '<div class="mi-none">Nothing pinned — pick products on the right</div>';
      d.querySelector('.mw-pins').innerHTML = pins.map((pid) => `<span class="mw-rb mw-pin" data-p="${pid}">${pIconFull(PR[pid], 18)}</span>`).join('');
      const dw = [...prod.querySelectorAll('.mi-win')].pop(); if (dw) { const pid = dw.dataset.demo, soon = PR[pid]?.status === 'soon', on = pins.includes(pid); const t = dw.querySelector('.mi-win-pin'); t.className = 'mi-win-pin' + (on ? ' on' : ''); t.innerHTML = soon ? 'Not built yet' : on ? `${ic('check')}Pinned` : 'Not pinned · opened with Ctrl K'; }
      d.querySelector('.mi-n').textContent = pins.length; d.querySelector('.mi-count').textContent = `${pins.length} of 6`; d.querySelectorAll('.mi-slotbar i').forEach((s, i) => s.classList.toggle('on', i < pins.length));
      d.querySelectorAll('[data-mi-pin]').forEach((b) => { const on = pins.includes(b.dataset.miPin); b.setAttribute('aria-pressed', String(on)); if (!on && b.getAttribute('aria-disabled') !== 'true') b.classList.toggle('full', pins.length >= 6); else b.classList.remove('full'); });
    };
    paint();
    const setTabs = (v) => { view = v; stage.dataset.view = v; seg.style.setProperty('--i', ['sidebar', 'home', 'product'].indexOf(v)); seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.miView === v; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-checked', String(on)); }); d.querySelectorAll('.mi-live').forEach((x) => { x.hidden = x.dataset.for !== v; }); camera(); };
    const pause = (ms, t) => new Promise((r) => setTimeout(() => r(t === seq), reduce ? 0 : ms));
    const at = (el) => { const s = +cam.dataset.s || 1, a = el.getBoundingClientRect(), c = mw.getBoundingClientRect(); return { x: (a.left - c.left + a.width / 2) / s, y: (a.top - c.top + a.height / 2) / s }; };
    const closeProd = () => { prod.classList.remove('open'); curPid = null; };
    const hideCursor = () => { cursor.classList.remove('on', 'click'); kbar.classList.remove('on'); };
    async function playTo(state, pid, own) {
      const t = ++seq;
      if (state === 'sidebar') { mw.dataset.state = 'sidebar'; closeProd(); hideCursor(); setTabs('sidebar'); return; }
      if (state === 'home') { mw.dataset.state = 'home'; closeProd(); hideCursor(); setTabs('home'); return; }
      // product: arrive at home first (the sidebar collapses), then the cursor does what a person would
      if (curPid === pid && mw.dataset.state === 'product') return;
      setTabs('product');
      if (mw.dataset.state === 'sidebar') { mw.dataset.state = 'home'; if (!await pause(300, t)) return; }
      // switching while a product is open keeps the window where it is and swaps what is inside it;
      // only the first open grows out of the icon it came from
      const switching = prod.classList.contains('open');
      if (!switching) { mw.dataset.state = 'home'; prod.innerHTML = winHTML(pid); paint(); }
      if (own) { hideCursor(); if (switching) { swapWin(pid); curPid = pid; return; } const o = at(own); prod.style.transformOrigin = `${o.x - MW.RAIL}px ${o.y}px`; if (!await pause(40, t)) return; prod.classList.add('open'); curPid = pid; mw.dataset.state = 'product'; return; }
      const pinned = pins.includes(pid), target = pinned ? mw.querySelector(`.mw-pin[data-p="${pid}"]`) : mw.querySelector('[data-r="search"]');
      const p = target ? at(target) : { x: MW.W / 2, y: MW.H / 2 };
      if (!cursor.classList.contains('on')) { cursor.style.left = `${MW.W * 0.62}px`; cursor.style.top = `${MW.H * 0.58}px`; cursor.classList.add('on'); void cursor.offsetWidth; }
      cursor.style.left = `${p.x}px`; cursor.style.top = `${p.y}px`;
      if (!await pause(360, t)) return;
      cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click'); target?.classList.add('hit'); setTimeout(() => target?.classList.remove('hit'), 360);
      if (!pinned) { kbar.querySelector('.mw-kq span').textContent = PR[pid].name; kbar.classList.remove('list'); kbar.classList.add('on'); if (!await pause(700, t)) return; kbar.classList.remove('on'); }
      else if (!await pause(110, t)) return;
      if (switching) { swapWin(pid); curPid = pid; if (await pause(520, t)) cursor.classList.remove('on'); return; }
      prod.style.transformOrigin = `${p.x - MW.RAIL}px ${p.y}px`;
      prod.classList.add('open'); curPid = pid; mw.dataset.state = 'product';
      if (await pause(700, t)) cursor.classList.remove('on');
    }
    // the window, and the swap: the frame stays put, the old product glides out as the new one glides in
    function winHTML(pid) { const box = document.createElement('div'); box.innerHTML = productDemo(pid); box.querySelector('.mi-win-bar')?.insertAdjacentHTML('beforeend', `<span class="mw-x" data-r="close" title="Close">${ic('x')}</span>`); return box.innerHTML; }
    function swapWin(pid) {
      const old = [...prod.querySelectorAll('.mi-win')].pop(); if (old?.dataset.demo === pid) return;
      const box = document.createElement('div'); box.innerHTML = winHTML(pid); const nw = box.firstElementChild;
      const dir = old && pins.indexOf(pid) < pins.indexOf(old.dataset.demo) ? -1 : 1; // glide the way the rail runs
      nw.style.setProperty('--dir', dir); nw.classList.add('mw-in'); prod.appendChild(nw);
      if (old) { old.style.setProperty('--dir', dir); old.classList.add('mw-out'); setTimeout(() => old.remove(), 380); }
      requestAnimationFrame(() => requestAnimationFrame(() => nw.classList.remove('mw-in'))); paint();
    }
    mw.querySelectorAll('button, a, input, [tabindex]').forEach((n) => { n.tabIndex = -1; }); // mouse-only sandbox; keyboard users have the toggle and the chips
    mw.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (r === 'home') return playTo('home');
      if (r === 'side') return playTo('sidebar');
      if (r === 'close') { prod.style.transformOrigin = '50% 46%'; closeProd(); mw.dataset.state = 'home'; return setTabs('home'); }
      if (r === 'search') { seq++; hideCursor(); kbar.querySelector('.mw-kq span').textContent = ''; kbar.classList.add('on', 'list'); return; }
      const hit = e.target.closest('[data-p], [data-product], [data-item-p]');
      if (hit) { kbar.classList.remove('on', 'list'); const pid = hit.dataset.p || hit.dataset.product || hit.dataset.itemP; if (PR[pid]) return playTo('product', pid, hit); }
      if (kbar.classList.contains('on') && !e.target.closest('.mw-kbar')) kbar.classList.remove('on', 'list');
    }, true);
    setTabs('sidebar');
    // the right column fits ITS content: step density down only as far as needed — one-line tiles, then no
    // section headings, then three columns, and only as a last resort let the tile list scroll
    const copy = d.querySelector('.mi-copy'), LEVELS = ['mi-d1', 'mi-d2', 'mi-d3', 'mi-d4'];
    const fitCopy = () => { copy.classList.remove(...LEVELS); for (const lv of LEVELS) { if (copy.scrollHeight - copy.clientHeight <= 1) break; copy.classList.add(lv); } };
    fitCopy(); requestAnimationFrame(() => requestAnimationFrame(fitCopy)); document.fonts?.ready.then(() => { if (d.classList.contains('on')) fitCopy(); });
    const onResize = () => { if (d.classList.contains('on')) { camera(); fitCopy(); } }; addEventListener('resize', onResize);
    // a product previews when you point at it — debounced, so sweeping across the chips never thrashes
    let hoverT = 0; const preview = (pid) => { if (view !== 'product') return; clearTimeout(hoverT); hoverT = setTimeout(() => playTo('product', pid), 140); };
    d.addEventListener('mouseover', (e) => { const c = e.target.closest('[data-mi-pin]'); if (c) preview(c.dataset.miPin); });
    d.addEventListener('focusin', (e) => { const c = e.target.closest('[data-mi-pin]'); if (c) preview(c.dataset.miPin); });
    const finish = (save) => {
      seq++; clearTimeout(hoverT); removeEventListener('resize', onResize);
      if (save) { S.pins[id] = pins.slice(0, 6); store.set('pins', S.pins); if (d.querySelector('[data-mi-default]').checked) store.set('primary', id); }
      const seen = introSeen(); seen[id] = Date.now(); store.set('introSeen', seen);
      sheetClose(d); introOpener?.focus?.(); introOpener = null;
      if (save) { renderRail(); render(); toast(`${M[id].name} is set up`); }
    };
    d.onclick = (e) => {
      const v = e.target.closest('[data-mi-view]'); if (v) { clearTimeout(hoverT); return playTo(v.dataset.miView, v.dataset.miView === 'product' ? (curPid || pins[0] || m.start) : null); }
      const c = e.target.closest('[data-mi-pin]'); if (c && c.getAttribute('aria-disabled') === 'true') { if (view === 'product') playTo('product', c.dataset.miPin); return toast(`${PR[c.dataset.miPin].name} is not built yet — it appears here when it launches`); }
      if (c) { const pid = c.dataset.miPin, i = pins.indexOf(pid); if (i >= 0) pins.splice(i, 1); else if (pins.length < 6) pins.push(pid); else return toast('Six pins at most — unpin one first'); paint(); d.querySelector(`.mi-pinrow[data-p="${pid}"]`)?.classList.add('mi-in'); mw.querySelector(`.mw-pin[data-p="${pid}"]`)?.classList.add('mi-in'); return; }
      if (e.target.closest('[data-mi-start]')) return finish(true);
      if (e.target.closest('[data-mi-skip]')) return finish(false);
    };
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return finish(false); }
      if (e.key === 'Tab') { const f = [...dialog.querySelectorAll('button:not([disabled]),input')].filter((n) => n.offsetParent !== null && !n.closest('[inert]')); const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    dialog.querySelector('[data-mi-start]').focus({ preventScroll: true });
  }
  // leaving the mode (Back, the switcher, a link) closes its intro WITHOUT marking it seen — it returns next visit
  function dropStaleModeIntro() { const d = document.getElementById('modeIntro'); if (!d?.classList.contains('on')) return; if (S.view === 'mode' && S.mode === d.dataset.mode) return; sheetClose(d); }
  // the first time a mode home opens, its intro opens with it
  function maybeModeIntro(atLoad) {
    dropStaleModeIntro(); if (!(S.view === 'mode' && MODE_INTRO[S.mode] && !introSeen()[S.mode] && !document.getElementById('adModal')?.classList.contains('on'))) return;
    if (atLoad) return openModeIntro(S.mode);
    setTimeout(() => { if (S.view === 'mode' && !introSeen()[S.mode]) openModeIntro(S.mode); }, 220); }
  // ---- Adaptive consent (MODES §8b rule 7) ----
  // Informed, specific, unambiguous, and as easy to refuse or withdraw as to give (GDPR Art. 4(11),
  // 7(3); EDPB Guidelines 05/2020 and 03/2022). Two things make it informed rather than asserted:
  // it shows YOUR workspace rearranged from your own recent use, and it shows the literal record
  // that would be stored, changing as you tick each signal. Optional signals start unticked;
  // "Not now" is the same size as "Turn on"; only that button consents; a receipt is kept.
  const AD_CONSENT_VERSION = '2026-10-04';
  let adOpener = null, adPlayT = 0;
  // today's order = the current mode's shelf; Adaptive's order = frequency × recency from recent work
  function adPreviewOrders() {
    const m = modeOf(S.mode) || MODES[0];
    const today = m.sections.flatMap(([, ids]) => ids).filter((id) => PR[id] && PR[id].status !== 'soon' && id !== 'chat').slice(0, 6);
    const u = {}; window.XENO_RECENT.forEach((r, i) => { if (!PR[r.p] || r.p === 'chat') return; const e = u[r.p] || { n: 0, last: 0 }; e.n += Math.max(1, 9 - i); e.last = Math.max(e.last, Date.now() - i * 3600e3); u[r.p] = e; });
    const now = Date.now(), ranked = Object.entries(u).map(([id, e]) => [id, e.n * Math.pow(0.5, (now - e.last) / (3 * 864e5)), e.n]).sort((a, b) => b[1] - a[1]);
    // both orders are full permutations of the same ids, so every row has a real slot in each state
    const ids = [...new Set([...today, ...ranked.map((r) => r[0])])].slice(0, 7);
    const todayOrder = [...today.filter((id) => ids.includes(id)), ...ids.filter((id) => !today.includes(id))];
    const adaptive = [...ranked.map((r) => r[0]).filter((id) => ids.includes(id)), ...todayOrder.filter((id) => !u[id])];
    return { ids, today: todayOrder, shown: today.filter((id) => ids.includes(id)), adaptive, opens: Object.fromEntries(ranked.map((r) => [r[0], r[2]])), mode: m };
  }
  const adRecord = (sig) => [['product', '"motion"'], ['event', '"opened"'], ...(sig.time ? [['at', '"Tue 09:14"']] : []), ...(sig.actions ? [['action', '"export"']] : [])];
  function openAdConsent(opener) {
    adOpener = opener || document.activeElement;
    hidePops(); clearTimeout(adPlayT);
    let d = document.getElementById('adModal');
    if (!d) { d = document.createElement('div'); d.id = 'adModal'; document.body.appendChild(d); }
    const prev = store.get('adConsent', null), sig = { products: true, time: !!prev?.signals?.time, actions: !!prev?.signals?.actions };
    const P = adPreviewOrders(), H = 38;
    const why = (id) => (P.opens[id] ? `Opened ${P.opens[id]}× this week` : 'Kept from your mode');
    const rows = P.ids.map((id) => { const ti = P.today.indexOf(id), ai = P.adaptive.indexOf(id), add = !P.shown.includes(id), up = !add && ai < ti;
      return `<div class="adp-row${up ? ' up' : ''}${add ? ' add' : ''}" data-id="${id}" style="--t:${ti};--a:${ai}">${pIconFull(PR[id], 18)}<span class="adp-n">${esc(PR[id].name)}</span><span class="adp-why">${esc(why(id))}</span><span class="adp-move">${add ? 'New' : up ? `↑ ${ti - ai}` : ''}</span></div>`; }).join('');
    const sigRow = (key, title, sub, locked) => `<label class="adx-sig${locked ? ' locked' : ''}"><input type="checkbox" data-adc-sig="${key}" ${sig[key] ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="adx-sw"><i></i></span><span class="adx-st"><b>${title}</b><small>${sub}</small></span>${locked ? '<span class="adx-req">Required</span>' : ''}</label>`;
    d.innerHTML = `<div class="adc-back" data-adc-dismiss></div>
      <div class="adc adx rp" role="dialog" aria-modal="true" aria-labelledby="adc-title" aria-describedby="adc-lead">
        <section class="pl adp" aria-label="Preview of your workspace with Adaptive">
          <div class="adp-top"><span class="adp-k">Your ${esc(M[P.mode.id].name)} sidebar</span><div class="pl-seg adp-seg" role="radiogroup" aria-label="Preview" data-seg="adp" style="--i:0;--n:2"><button role="radio" aria-checked="true" data-adp="today">Today</button><button role="radio" aria-checked="false" data-adp="adaptive">With Adaptive</button></div></div>
          <div class="adp-stage" data-state="today">
            <div class="adp-panel"><div class="adp-ph"><span>${esc(M[P.mode.id].name)}</span><i></i><i></i></div><div class="adp-list" style="--h:${H}px;height:${P.ids.length * H}px">${rows}</div></div>
            <div class="adp-trace"><span class="adp-trace-ic">${ic('spark')}</span><span><b>Moved ${esc(PR[P.adaptive[0]]?.name || 'Motion')} up</b> — you open it most</span><em>Undo</em></div>
          </div>
          <p class="adp-cap">Built from your last week. Nothing changes until you turn it on — and then only when you arrive, never while you work.</p>
        </section>
        <section class="pl adx-copy">
          <button class="pp-ib adx-close" data-adc-dismiss aria-label="Close" data-tip="Close  Esc">${ic('x')}</button>
          <span class="adx-eyebrow">Adaptive <span>Beta</span></span>
          <h2 id="adc-title">A workspace that arranges itself around how you work.</h2>
          <p id="adc-lead" class="adx-lead">It learns from <b>how</b> you use XENO — never from <b>what</b> you make. Every change explains itself and can be undone, pinned or frozen.</p>
          <div class="adx-grid">
            <div class="adx-sigs"><div class="adx-k">What it reads</div>
              ${sigRow('products', 'Products you open, and how often', 'The core of Adaptive', true)}
              ${sigRow('time', 'When you use them', 'So mornings can look different from evenings', false)}
              ${sigRow('actions', 'Actions you take', 'Approve, export, publish — never their content', false)}
            </div>
            <div class="adx-rec"><div class="adx-k">What gets stored <span>one event</span></div><pre class="adx-code" aria-live="polite"></pre>
              <div class="adx-never"><b>Never stored</b>files, documents, images, messages, prompts, chats, or anything you type</div></div>
          </div>
          <dl class="adx-facts"><div><dt>Lives</dt><dd>with your account</dd></div><div><dt>Used for</dt><dd>your layout only</dd></div><div><dt>Export</dt><dd>included</dd></div><div><dt>Stop</dt><dd>one switch deletes it</dd></div></dl>
          <div class="adc-btns adx-btns"><button class="us-ghost" data-adc-dismiss data-fk="no">Not now</button><button class="us-primary" data-adc-accept data-fk="yes">Turn on Adaptive</button></div>
          <p class="adx-legal">Off until you turn it on. Change it any time from Adaptive's sidebar · <button class="adc-link" data-adc-privacy>Privacy notice</button></p>
        </section>
      </div>`;
    sheetOpen(d); fitSheet(d);
    const dialog = d.querySelector('.adc'), stage = d.querySelector('.adp-stage'), seg = d.querySelector('.adp-seg'), code = d.querySelector('.adx-code');
    const paintRec = () => { const s = { products: true, time: d.querySelector('[data-adc-sig="time"]').checked, actions: d.querySelector('[data-adc-sig="actions"]').checked };
      code.innerHTML = '<span class="adx-b">{</span>\n' + adRecord(s).map(([k, v], i, a) => `  <span class="adx-key">${k}</span>: <span class="adx-val">${v}</span>${i < a.length - 1 ? ',' : ''}`).join('\n') + '\n<span class="adx-b">}</span>'; };
    const show = (state) => { stage.dataset.state = state; seg.style.setProperty('--i', state === 'adaptive' ? 1 : 0); seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.adp === state))); };
    paintRec();
    // play the change once, so the first thing you see is what Adaptive would actually do
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) adPlayT = setTimeout(() => show('adaptive'), 900); else show('adaptive');
    d.onchange = (e) => { if (e.target.matches('[data-adc-sig]')) paintRec(); };
    d.onclick = (e) => {
      const st = e.target.closest('[data-adp]'); if (st) { clearTimeout(adPlayT); return show(st.dataset.adp); }
      if (e.target.closest('[data-adc-privacy]')) return window.XA.settings('privacy');
      if (e.target.closest('[data-adc-accept]')) {
        const signals = { products: true, time: !!d.querySelector('[data-adc-sig="time"]').checked, actions: !!d.querySelector('[data-adc-sig="actions"]').checked };
        store.set('adConsent', { version: AD_CONSENT_VERSION, at: Date.now(), signals }); // the receipt: what was agreed, when, to which text
        store.set('adOn', true); if (!AD.usage()) adSeed(); store.set('adOrder', adRank());
        closeAdConsent(); toast('Adaptive is on — change it any time from its sidebar'); render(); return;
      }
      if (e.target.closest('[data-adc-dismiss]')) { closeAdConsent(); toast('Adaptive stays off'); }
    };
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAdConsent(); return; }
      if (e.key === 'Tab') { const f = [...dialog.querySelectorAll('button,input:not([disabled])')].filter((n) => n.offsetParent !== null); const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    // focus the refusal first: accepting must be a deliberate act, never an Enter-press away
    dialog.querySelector('.adc-btns [data-adc-dismiss]').focus({ preventScroll: true });
  }
  function closeAdConsent() { clearTimeout(adPlayT); const d = document.getElementById('adModal'); if (!d) return; sheetClose(d); adOpener?.focus?.(); adOpener = null; }
  function panelAdaptive() {
    const headA = `<div class="ph">${noMark('xeno')}<div class="ttl msw-inline">Adaptive<span class="msw-bar"></span><span class="msw-count">Beta</span></div><button class="ib" data-go="search" aria-label="Search" data-tip="Search" data-kbd="Ctrl K">${ic('search')}</button><button class="ib" data-collapse aria-label="Collapse sidebar" data-tip="Collapse" data-kbd="Ctrl \\">${ic('side')}</button></div>`;
    if (!AD.on()) return `${headA}<div class="pbody"><div class="ad-consent">
        <b>A workspace that shapes itself around you</b>
        <p>Adaptive mode rearranges this mode — products, sections, what's suggested — from how you use XENO. Changes happen when you arrive, never under your hand, and every one can be undone.</p>
        <div class="ad-k">Uses</div><ul><li>Which products you open, and how often</li><li>When you use them</li><li>Actions you take (not their content)</li></ul>
        <div class="ad-k">Never uses</div><ul><li>The content of your work</li></ul>
        <p class="ad-fine">Off by default. One switch turns it off and deletes what it learned. It's part of your data export.</p>
        <button class="act primary" data-ad="on">${ic('check')}Turn on Adaptive</button>
        <button class="act" data-ad="later">Not now</button></div></div>`;
    const order = store.get('adOrder', null) || adRank(), tr = store.get('adTrace', null), pins = AD.pins();
    const topModes = new Set(order.slice(0, 5).map((id) => homeModeOf(id)?.id).filter(Boolean));
    const needs = (window.XENO_NEEDS || []).filter((n) => topModes.has(n.m));
    const recent = window.XENO_RECENT.filter((r) => order.includes(r.p)).slice(0, 5);
    const prow = (id) => `<div class="row ad-row" data-key="${id}" data-product="${id}" data-ctx="product" role="button" tabindex="0">${pIcon(PR[id], 20)}<span class="t">${esc(PR[id].name)}</span><span class="meta">${esc(adReason(id))}</span><button class="ib ad-pin${pins.includes(id) ? ' on' : ''}" data-adpin="${id}" aria-label="${pins.includes(id) ? 'Unpin' : 'Pin'} ${esc(PR[id].name)}" data-tip="${pins.includes(id) ? 'Unpin' : 'Pin — it stays put'}">${ic('pin')}</button><button class="ib ad-x" data-adhide="${id}" aria-label="Remove ${esc(PR[id].name)}" data-tip="Never suggest this">${ic('x')}</button></div>`;
    const learned = Object.entries(AD.usage() || {}).filter(([id]) => PR[id]).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
    return `${headA}<div class="pbody">
      ${tr && Date.now() - tr.at < 6e5 ? `<div class="ad-trace">${ic('spark')}<span>${esc(tr.t)}</span><button data-ad="undo">Undo</button><button class="ib" data-ad="dismiss" aria-label="Dismiss">${ic('x')}</button></div>` : ''}
      <button class="act primary" data-product="${order[0] || 'chat'}">${ic('plus')}Continue in ${esc(PR[order[0]]?.name || 'XENO')}</button>
      ${needs.length ? sec('needs', `Needs you<span class="cnt-inline">${needs.length}</span>`, needs.map((n) => row(`data-product="${n.p}" data-ctx="product"`, `${pIcon(PR[n.p], 20)}<span class="t">${esc(n.t)}</span><span class="need">${esc(n.meta)}</span>`)).join('')) : ''}
      ${sec('for-you', 'For you now', order.map(prow).join(''))}
      ${recent.length ? sec('recent', 'Recent', recent.map((r) => row(`data-product="${r.p}" data-ctx="product"`, `${pIcon(PR[r.p], 20)}<span class="t">${esc(r.t)}</span><span class="meta">${esc(r.ago)}</span>`)).join('')) : ''}
      ${sec('learned', 'What it learned', learned.map(([id, e]) => row(`data-product="${id}" data-ctx="product"`, `${pIconFull(PR[id], 16)}<span class="t">${esc(PR[id].name)}</span><span class="meta">${e.n}×</span>`)).join('') + ((store.get('adHistory', []) || []).length ? `<div class="grp">Recent changes</div>` + (store.get('adHistory', []) || []).slice(0, 4).map((h) => row('data-xa="adaptiveHistory"', `<span class="t">${esc(h.t)}</span>`, 'sub')).join('') : ''))}
    </div>
    <div class="pfoot ad-foot"><button class="row" data-ad="freeze">${ic('pin')}<span class="t">Freeze as custom mode</span></button><button class="row" data-ad="sim">${ic('play')}<span class="t">Simulate a day of use</span><span class="meta">prototype</span></button><button class="row" data-ad="off">${ic('x')}<span class="t">Turn off and delete history</span></button></div>`;
  }
  function mainAdaptive() { return `<div class="wrap"><div class="landing"><span class="ib" style="width:72px;height:72px;pointer-events:none">${ic('spark').replace('class="i"', 'class="i" style="width:40px;height:40px"')}</span><h1>Adaptive</h1><p>A mode XENO writes for you from how you work. It rearranges when you arrive — never under your hand — and every change can be undone, pinned or frozen.</p><div class="note">Beta · prototype. Usage is simulated from sample data.</div></div></div>`; }
  // morph: rows glide from their previous slot to the new one (contract rule 3)
  function adMorph() {
    const prev = store.get('adPrev', null); if (!prev || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = [...document.querySelectorAll('#panel > .pv .ad-row')]; if (!rows.length) return;
    const h = rows[0].getBoundingClientRect().height;
    rows.forEach((r, i) => { const was = prev.indexOf(r.dataset.key); const dy = was < 0 ? 0 : (was - i) * h;
      r.animate(was < 0 ? [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }] : [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' }); });
    store.set('adPrev', null);
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    const enter = t.closest('[data-adaptive]'); if (enter) { e.preventDefault(); e.stopPropagation(); go('adaptive'); if (!AD.on()) setTimeout(() => openAdConsent(enter.isConnected ? enter : document.querySelector('#logo')), 60); return; }
    const pin = t.closest('[data-adpin]'); if (pin) { e.preventDefault(); e.stopPropagation(); const id = pin.dataset.adpin, p = AD.pins(); store.set('adPins', p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); store.set('adOrder', adRank()); render(); return; }
    const hid = t.closest('[data-adhide]'); if (hid) { e.preventDefault(); e.stopPropagation(); store.set('adHidden', [...AD.hidden(), hid.dataset.adhide]); store.set('adOrder', adRank()); toast(`${PR[hid.dataset.adhide].name} won't be suggested`); render(); return; }
    const a = t.closest('[data-ad]'); if (!a) return; e.preventDefault(); e.stopPropagation();
    const k = a.dataset.ad;
    if (k === 'on') return openAdConsent(a);
    if (k === 'later') go('dashboard');
    if (k === 'off') { ['adOn', 'adUsage', 'adOrder', 'adPrev', 'adPins', 'adHidden', 'adTrace', 'adHistory', 'adSnooze', 'adUndo', 'adConsent'].forEach((x) => store.set(x, null)); store.set('adOn', false); toast('Adaptive is off — history deleted'); render(); }
    if (k === 'dismiss') { store.set('adTrace', null); render(); }
    if (k === 'undo') { const before = store.get('adUndo', null), tr = store.get('adTrace', null); if (tr && tr.id) { const s = store.get('adSnooze', {}) || {}; s[tr.id] = Date.now() + 7 * 864e5; store.set('adSnooze', s); } if (before) { store.set('adPrev', store.get('adOrder')); store.set('adOrder', before.filter((id) => !tr || id !== tr.id)); } store.set('adTrace', null); toast(tr && tr.id ? `Undone — ${PR[tr.id].name} won't be pushed for a week` : 'Undone'); render(); setTimeout(adMorph, 160); }
    if (k === 'freeze') { const c = { id: 'c-ad-' + Date.now(), name: 'My adaptive layout', products: (store.get('adOrder') || adRank()).slice(0, 6) }; window.XENO_CUSTOM.save(c); refreshSwitcher(); toast('Frozen as a custom mode — find it under Your modes'); }
    if (k === 'sim') { // a day of use, concentrated on a product low in the list, then arrive again (a boundary)
      const ord = store.get('adOrder') || adRank(), pool = Object.keys(PR).filter((id) => PR[id].status !== 'soon' && id !== 'chat' && !id.startsWith('tool-'));
      const pick = pool.filter((id) => !ord.slice(0, 2).includes(id))[Math.floor(Math.random() * 12)] || pool[0];
      for (let i = 0; i < 14; i++) adTrack(pick);
      store.set('adUndo', ord); adRecompute(); render(); setTimeout(adMorph, 160); }
  }, true);
  function panelHTML() {
    if (S.view === 'adaptive') return panelAdaptive();
    if (S.view === 'dashboard') return panelDashboard();
    if (S.view === 'product') return panelProduct(S.product);
    if (S.view === 'zone') return panelZone();
    if (S.view === 'global') return panelGlobal(S.global);
    return panelMode();
  }

  // ---- MAIN ----
  function hour() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  // ── MAIN PAGES v2 — built from the SAME data as the sidebar, so a page and its panel cannot disagree ──
  const H_li = (attrs, t, m) => `<button class="pj-li" ${attrs}><span>${esc(t)}</span><small>${esc(m || '')}</small></button>`;
  const H_list = (rows) => `<div class="pj-list">${rows.join('')}</div>`;
  const H_runningRows = (modeId) => Object.entries(window.XENO_MODE_ZONES).filter(([k]) => k !== 'overview' && (!modeId || k === modeId))
    .flatMap(([, zs]) => zs.flatMap((z) => (z.work ? z.work[1] : []).filter((r) => /running|rendering|waiting/i.test(r[1] || '')).map((r) => [r[0], r[1], r[2]])));
  // Overview — the global home: what needs you, what is running, every mode at a glance, recent work.
  // ── MODE HOMES v3 — show the real work, not cards about it ─────────────────────────────────────
  // One frame for every mode (greeting + a status sentence built from the mode's own data, Continue,
  // Needs you with the inbox's own actions), then ONE signature section that demonstrates the mode:
  // Studio's production lane, Office's desk, Social's week, Corpo's company, Dev's run board, Tools'
  // launcher. Everything comes from the same data the sidebar and inbox read — nothing is invented.
  const zoneWork = (m, z) => ((window.XENO_MODE_ZONES[m] || []).find((x) => x.id === z)?.work || [null, []])[1];
  const dayName = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // a monochrome miniature of what a product's file looks like — the work, drawn, instead of an icon
  function mini(pid) {
    const k = { canvas: 'frame', sites: 'frame', layout: 'frame', pixel: 'photo', photo: 'photo', image: 'photo', motion: 'timeline', video: 'timeline', sound: 'wave', audio: 'wave', docs: 'page', notes: 'page', sheets: 'grid', slides: 'slide', post: 'post', comms: 'chat', agent: 'term', workflow: 'flow' }[pid] || 'page';
    const bars = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
    const art = {
      frame: '<i class="mn-nav"></i><i class="mn-hero"></i><i class="mn-c1"></i><i class="mn-c2"></i><i class="mn-c3"></i>',
      photo: '<i class="mn-sky"></i><i class="mn-hill"></i><i class="mn-sun"></i><b class="mn-crop"></b>',
      timeline: `<i class="mn-view"></i><span class="mn-tracks">${bars(3, (r) => `<span>${bars(4, (c) => `<i style="flex:${[3, 2, 4, 2, 1, 3, 2, 3, 2, 4, 1, 2][r * 4 + c]}"></i>`)}</span>`)}</span><b class="mn-head"></b>`,
      wave: `<span class="mn-wave">${bars(34, (i) => `<i style="height:${18 + Math.round(Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)) * 70)}%"></i>`)}</span>`,
      page: `<span class="mn-page"><i class="h"></i>${bars(7, (i) => `<i style="width:${[92, 86, 95, 70, 88, 80, 54][i]}%"></i>`)}</span>`,
      grid: `<span class="mn-grid">${bars(24, (i) => `<i${[5, 9, 14, 19].includes(i) ? ' class="v"' : ''}></i>`)}</span>`,
      slide: '<span class="mn-slide"><i class="t"></i><i class="s"></i><i class="b"></i></span>',
      post: '<span class="mn-post"><i class="a"></i><i class="l1"></i><i class="l2"></i><i class="img"></i></span>',
      chat: '<span class="mn-chat"><i class="l"></i><i class="r"></i><i class="l s"></i></span>',
      term: `<span class="mn-term">${bars(5, (i) => `<i style="width:${[40, 72, 58, 84, 30][i]}%"></i>`)}</span>`,
      flow: '<span class="mn-flow"><i></i><b></b><i></i><b></b><i></i></span>',
    }[k];
    return `<span class="mn mn--${k}" aria-hidden="true">${art}</span>`; // the frame carries mn--kind; the drawing inside owns mn-kind
  }
  function homeNeeds(mId, seen) {
    if (homeState() === 'loading' && !homeNeeds.inGhost) { homeNeeds.inGhost = true; try { return ghosted('notes', () => homeNeeds(mId, seen)); } finally { homeNeeds.inGhost = false; } }
    if (!notesReady()) return DS.notes && DS.notes.err ? `<section class="hm2-sec"><div class="hm2-h"><h2>Needs you</h2></div>${errorPlate('notes', 'what needs you')}</section>` : ghosted('notes', () => homeNeeds(mId, seen));
    const st = NS(), items = ntAll().filter((n) => (!mId || n.m === mId) && n.g === 'needs' && viewOf(n, st) === 'inbox');
    if (!items.length) return '';
    return `<section class="hm2-sec"><div class="hm2-h"><h2>Needs you</h2><span class="hm2-count">${items.length}</span><button class="hm2-link" data-nt-viewall-page>Open inbox ${ic('right')}</button></div>
      <div class="hm2-needs">${items.map((n) => { const done = st.done[n.id];
        return `<div class="hm2-need${done ? ' done' : ''}" data-hmn="${n.id}"><span class="hm2-need-ic">${pIconFull(PR[n.p], 18)}</span><span class="hm2-need-t"><b>${esc(n.t)}</b><small>${seen && n.at > seen ? '<em class="hm2-new">New</em>' : ''}${mId ? '' : esc(M[n.m].name) + ' · '}${esc(PR[n.p].name)} · ${esc(agoShort(n.at))}</small></span>${done ? `<span class="nt2-done">${ic('check')}${esc(done)}</span>` : `<button class="nt2-act${INLINE[n.kind] ? ' primary' : ''}" data-hmn-do>${esc(n.act)}</button>`}</div>`; }).join('')}</div></section>`;
  }
  // ---- signature sections ----
  const SIG = {
    studio(m) {
      const live = zoneWork('studio', 'create').filter((r) => /Rendering/.test(r[1]));
      const work = [...zoneWork('studio', 'design'), ...zoneWork('studio', 'create').filter((r) => !/Rendering/.test(r[1])), ...zoneWork('studio', 'generate')].filter((r) => r[2] && PR[r[2]]).slice(0, 6);
      return `${live.length ? `<section class="hm2-sec"><div class="hm2-h"><h2>In production</h2></div>${live.map(([t, s, p]) => { const pct = parseInt(s.match(/\d+/)?.[0] || '0', 10);
        return `<button class="hm2-job" data-item-p="${p}" data-item="${esc(t)}">${mini(p)}<span class="hm2-job-t"><b>${esc(t)}</b><small>${esc(PR[p].name)} · rendering · about ${Math.max(1, Math.round((100 - pct) / 12))} min left</small><span class="hm2-prog"><i style="width:${pct}%"></i></span></span><span class="hm2-pct">${pct}%</span></button>`; }).join('')}</section>` : ''}
        <section class="hm2-sec"><div class="hm2-h"><h2>Your work</h2><span class="hm2-sub">across ${plural(new Set(work.map((r) => r[2])).size, 'product', 'products')}</span></div>
        <div class="hm2-tiles">${work.map(([t, s, p]) => `<button class="hm2-tile" data-item-p="${p}" data-item="${esc(t)}">${mini(p)}<span class="hm2-tile-t"><b>${esc(t)}</b><small>${pIconFull(PR[p], 14)}${esc(PR[p].name)} · ${esc(s)}</small></span></button>`).join('')}</div></section>`;
    },
    office() {
      const docs = [...zoneWork('office', 'write'), ...zoneWork('office', 'calculate'), ...zoneWork('office', 'present'), ...zoneWork('office', 'notes')].filter((r) => r[2] && PR[r[2]]).slice(0, 6);
      const mail = zoneWork('office', 'mail');
      return `<section class="hm2-sec"><div class="hm2-h"><h2>Your desk</h2><span class="hm2-sub">documents you touched recently</span></div>
        <div class="hm2-tiles hm2-desk">${docs.map(([t, s, p]) => `<button class="hm2-tile" data-item-p="${p}" data-item="${esc(t)}">${mini(p)}<span class="hm2-tile-t"><b>${esc(t)}</b><small>${pIconFull(PR[p], 14)}${esc(PR[p].name)} · ${esc(s)}</small></span></button>`).join('')}</div></section>
        ${mail.length ? `<section class="hm2-sec"><div class="hm2-h"><h2>Mail</h2><span class="hm2-count">${mail.length}</span></div><div class="hm2-list">${mail.map(([t, s, p], i) => `<button class="hm2-li${i === 0 ? ' unread' : ''}" data-item-p="${p}" data-item="${esc(t)}"><i class="hm2-dot"></i><span>${esc(t)}</span><small>${esc(s)}</small></button>`).join('')}</div></section>` : ''}`;
    },
    social() {
      const posts = zoneWork('social', 'publish'), conv = zoneWork('social', 'message');
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
      const slot = (when) => (/^Today/.test(when) ? 0 : /^Tomorrow/.test(when) ? 1 : (() => { const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }, k = when.slice(0, 3); if (!(k in map)) return -1; const diff = (map[k] - new Date().getDay() + 7) % 7; return diff; })());
      return `<section class="hm2-sec"><div class="hm2-h"><h2>This week</h2><span class="hm2-sub">${plural(posts.length, 'post', 'posts')} scheduled</span></div>
        <div class="hm2-week">${days.map((d, i) => { const here = posts.filter((p) => slot(p[1]) === i);
          return `<div class="hm2-day${i === 0 ? ' today' : ''}"><span class="hm2-dn"><b>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</b>${d.getDate()}</span>${here.map(([t, w, p]) => `<button class="hm2-post" data-item-p="${p}" data-item="${esc(t)}">${mini(p)}<b>${esc(t)}</b><small>${esc(w.replace(/^(Today|Tomorrow)\s*/, '') || 'Any time')}</small></button>`).join('') || '<span class="hm2-empty-day">—</span>'}</div>`; }).join('')}</div></section>
        <section class="hm2-sec"><div class="hm2-h"><h2>Conversations</h2></div><div class="hm2-list">${conv.map(([t, s, p], i) => `<button class="hm2-li${i === 1 ? ' unread' : ''}" data-item-p="${p}" data-item="${esc(t)}"><i class="hm2-dot"></i><span>${esc(t)}</span><small>${esc(s)}</small></button>`).join('')}</div></section>`;
    },
    corpo() {
      const co = zoneWork('corpo', 'company'), ppl = zoneWork('corpo', 'people'), cust = zoneWork('corpo', 'customers'), an = zoneWork('corpo', 'analytics');
      const stat = (label, value, sub) => `<div class="hm2-stat"><small>${esc(label)}</small><b>${esc(value)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
      return `<section class="hm2-sec"><div class="hm2-h"><h2>The company right now</h2></div>
        <div class="hm2-stats">${stat('Wallet', co[0]?.[1] || '—', 'company credits ledger')}${stat('Revenue', (an[0]?.[1] || '').replace(' this month', ''), 'this month')}${stat('Support', (an[1]?.[1] || '').replace(' open', ''), 'open tickets')}${stat('Divisions', co[2]?.[1] || '—', 'floors in the building')}</div></section>
        <div class="hm2-cols"><section class="hm2-sec"><div class="hm2-h"><h2>Team</h2><span class="hm2-sub">people and agents</span></div><div class="hm2-list">${ppl.map(([n, r]) => `<div class="hm2-li hm2-person"><span class="hm2-av${/Agent/.test(r) ? ' agent' : ''}">${esc(n[0])}</span><span>${esc(n)}</span><small>${esc(r)}</small></div>`).join('')}</div></section>
        <section class="hm2-sec"><div class="hm2-h"><h2>Customers</h2></div><div class="hm2-list">${cust.map(([t, s, p]) => `<button class="hm2-li" ${PR[p] ? `data-item-p="${p}" data-item="${esc(t)}"` : ''}><i class="hm2-dot"></i><span>${esc(t)}</span><small>${esc(s)}</small></button>`).join('')}</div></section></div>`;
    },
    dev() {
      const runs = zoneWork('dev', 'agents'), auto = zoneWork('dev', 'automate');
      const col = (title, f) => { const r = runs.filter((x) => f(x[1])); return `<div class="hm2-col"><span class="hm2-colh">${title}<i>${r.length}</i></span>${r.map(([t, s, p]) => `<button class="hm2-run${/Waiting/.test(s) ? ' wait' : /Running/.test(s) ? ' live' : ''}" data-item-p="${p}" data-item="${esc(t)}">${mini(p)}<b>${esc(t)}</b><small>${esc(s)}</small></button>`).join('') || '<span class="hm2-empty-day">Nothing here</span>'}</div>`; };
      return `<section class="hm2-sec"><div class="hm2-h"><h2>Agent runs</h2><span class="hm2-sub">today</span></div>
        <div class="hm2-board">${col('Running', (s) => /Running/.test(s))}${col('Waiting on you', (s) => /Waiting/.test(s))}${col('Done', (s) => /Done/.test(s))}</div></section>
        <section class="hm2-sec"><div class="hm2-h"><h2>Automations</h2></div><div class="hm2-list">${auto.map(([t, s, p]) => `<button class="hm2-li${/Failed/.test(s) ? ' failed' : ''}" data-item-p="${p}" data-item="${esc(t)}"><i class="hm2-dot"></i><span>${esc(t)}</span><small>${esc(s)}</small></button>`).join('')}</div></section>`;
    },
    tools(m) {
      const ids = m.sections.flatMap(([, x]) => x).filter((id) => PR[id]).slice(0, 12);
      return `<section class="hm2-sec"><div class="hm2-h"><h2>Pick a tool</h2><span class="hm2-sub">or drop a file and XENO suggests one</span></div>
        <div class="hm2-drop">${ic('upload')}<span><b>Drop a file here</b><small>Images, video, audio, documents — the right tools appear</small></span></div>
        <div class="hm2-toolgrid">${ids.map((id) => `<button class="hm2-tool" data-product="${id}">${pIconFull(PR[id], 22)}<b>${esc(PR[id].name)}</b><small>${esc(PR[id].blurb || '')}</small></button>`).join('')}</div></section>`;
    },
  };
  // ── HOMES v4 (Overview + every mode) — benchmarked on Linear Home, GitHub's dashboard, Vercel's overview
  // and Notion Home. One frame: greeting + a sentence built from live data · Continue · sections the person
  // can hide and reorder (never a free-form widget canvas — Jira's mistake) · every number in context
  // (trend + 7-day line + a link to what it measures) · "new since you were last here" · per-section
  // failure · a first-day checklist. Data-driven sections render as shapes while loading, never pop in.
  const homeState = () => (store.get('pgState', {}) || {}).home || 'normal';
  const SEEN = {};   // last visit, read once per session per home, then moved to now
  // the baseline is per browser tab (sessionStorage), so a refresh keeps the marks and the next real visit resets them
  function seenPrev(ctx) {
    if (!(ctx in SEEN)) { let base; try { const v = sessionStorage.getItem('xw.seenBase.' + ctx); base = v != null ? JSON.parse(v) : store.get('lastSeen.' + ctx, null); sessionStorage.setItem('xw.seenBase.' + ctx, JSON.stringify(base)); } catch { base = store.get('lastSeen.' + ctx, null); } SEEN[ctx] = base; }
    store.set('lastSeen.' + ctx, Date.now()); return SEEN[ctx];
  }
  const agoWhen = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString('en-GB', { weekday: 'long' }); };
  const kpis = (mId) => (window.XENO_MODE_KPIS || {})[mId] || [];
  const kFmt = (k) => { const v = k.value; const n = v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : v % 1 ? v.toFixed(1) : v.toLocaleString('en'); return k.unit === '€' ? '€' + n : k.unit === '%' ? n + '%' : k.unit ? `${n} ${k.unit}` : n; };
  const kTrend = (k) => { const s = k.series, prev = s.slice(0, -1).reduce((a, b) => a + b, 0) / (s.length - 1), d = prev ? (s[s.length - 1] - prev) / prev : 0; const up = d >= 0; return { d, up, txt: `${up ? '↑' : '↓'} ${Math.abs(Math.round(d * 100))}%` }; };
  const spark = (s) => { const w = 76, h = 24, mn = Math.min(...s), mx = Math.max(...s), r = mx - mn || 1; const pts = s.map((v, i) => [(i / (s.length - 1)) * (w - 4) + 2, h - 3 - ((v - mn) / r) * (h - 6)]); const L = pts[pts.length - 1];
    return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/><rect x="${(L[0] - 2).toFixed(1)}" y="${(L[1] - 2).toFixed(1)}" width="4" height="4"/></svg>`; };
  const kpiCard = (k, attrs) => { const t = kTrend(k), fmt = (v) => kFmt({ ...k, value: v }); return `<button class="kpi" ${attrs} aria-label="${esc(k.label)}: ${esc(kFmt(k))}, ${t.up ? 'up' : 'down'} ${Math.abs(Math.round(t.d * 100))}% on the 6-day average"><span class="kpi-top"><small>${esc(k.label)}</small><span class="kpi-d${t.up ? '' : ' down'}">${t.txt}</span></span><b class="kpi-v">${esc(kFmt(k))}</b>${window.XENO_SIG ? window.XENO_SIG.chart(k.series, { fmt, h: 44 }) : spark(k.series)}<small class="kpi-foot">vs 6-day average · hover for each day</small></button>`; };
  // the sections, in the person's order, minus the ones they hid
  let HOME_SECS = null;
  function homeSections(ctx, list) {
    HOME_SECS = { ctx, list: list.map(({ id, label }) => ({ id, label })) };
    const L = store.get('homeLayout.' + ctx, null) || {}, order = L.order || [], hidden = new Set(L.hidden || []);
    const rank = (id) => { const i = order.indexOf(id); return i < 0 ? 1000 + list.findIndex((x) => x.id === id) : i; };
    return [...list].sort((a, b) => rank(a.id) - rank(b.id)).filter((x) => !hidden.has(x.id)).map((x) => { const h = x.html(); return h ? h.replace(/^(\s*<(?:section|div) class="[^"]*")/, `$1 data-hsec="${x.id}"`) : ''; }).join('');
  }
  const sentenceOf = (parts, fallback) => { const s = parts.length ? parts.join(', ').replace(/, ([^,]*)$/, parts.length > 1 ? ', and $1' : '$1') + '.' : fallback; return s[0].toUpperCase() + s.slice(1); };
  const notesNow = () => (notesReady() ? ntAll() : PH.notes());   // the sentence counts from placeholders while loading — and is drawn as a shape
  function homeHero({ eye, sentence, acts, cont }) {
    return `<header class="hm2-hero"><div class="hm2-greet"><h1>${greet()}, ${window.XENO_ME.firstHtml()}.</h1><p class="${notesReady() ? '' : 'ghost-p'}">${esc(sentence)}</p><div class="hm2-acts">${acts}</div></div>${cont}</header>`;
  }
  const contCard = (last, label) => last ? `<button class="hm2-cont" data-item-p="${last.p}" data-item="${esc(last.t)}"><span class="hm2-cont-k">${esc(label)}</span>${mini(last.p)}<span class="hm2-cont-t"><b>${esc(last.t)}</b><small>${pIconFull(PR[last.p], 14)}${esc(PR[last.p].name)} · ${esc(last.ago)}</small></span><span class="hm2-cont-go">${ic('right')}</span></button>` : '';
  function kpiSection(mId) {
    const ks = kpis(mId); if (!ks.length) return '';
    if (homeState() === 'error') return `<section class="hm2-sec"><div class="hm2-h"><h2>This week</h2></div><div class="hm2-err">${ic('reset')}<span><b>Couldn't load your numbers.</b> Everything else on this page is current.</span><button class="us-ghost" data-home-retry>Try again</button></div></section>`;
    return `<section class="hm2-sec"><div class="hm2-h"><h2>This week</h2><span class="hm2-sub">last 7 days</span></div><div class="kpis">${ks.map((k) => kpiCard(k, `data-zone="${k.area}"`)).join('')}</div></section>`;
  }
  // first day: what this place is for and the next real step — not an empty grid of zeros
  function firstDay(ctx) {
    const m = ctx === 'overview' ? null : modeOf(ctx), sp = m && PR[m.start];
    const done = new Set(store.get('setup.' + ctx, []) || []);
    const steps = ctx === 'overview'
      ? [['modes', 'Choose the modes you work in', 'Each mode gives you its own home, sidebar and products.', 'Open the switcher', 'data-switch'], ['project', 'Start a project', 'One project holds the chats, files, tasks and teams for a goal — in every mode.', 'New project', 'data-go="projects"'], ['chat', 'Ask XENO something', 'Chat works across everything you have — it is the fastest way in.', 'New chat', 'data-go="chat"'], ['invite', 'Invite people or agents', 'Give each a role; agents always have a human owner.', 'Invite', 'data-go="workspace"']]
      : [['open', `Open ${sp ? sp.name : 'your first product'}`, sp ? sp.blurb : '', `Open ${sp ? sp.name : ''}`, sp ? `data-product="${sp.id}"` : ''], ['pins', 'Pin what you use', 'Pinned products sit on the rail, one click away.', 'Choose products', `data-intro="${ctx}"`], ['project', 'Start a project', 'Keep the work for one goal together.', 'New project', 'data-go="projects"'], ['invite', 'Invite people or agents', 'Work together in this mode.', 'Invite', 'data-go="workspace"']];
    const n = steps.filter(([id]) => done.has(id)).length;
    return `<div class="wrap hm2" data-home="${ctx}"><header class="hm2-hero"><div class="hm2-greet"><span class="hm2-eye">${esc(ctx === 'overview' ? 'Overview' : M[ctx].name)} · first day</span><h1>Welcome, ${window.XENO_ME.firstHtml()}.</h1><p>${ctx === 'overview' ? 'This is your home across every mode. Four steps and it fills with your own work.' : `This is ${esc(M[ctx].name)}. Four steps and this page shows your own work.`}</p></div></header>
      <section class="hm2-sec"><div class="hm2-h"><h2>Get started</h2><span class="hm2-sub">${n} of ${steps.length} done</span></div><div class="fd-meter"><i style="width:${(n / steps.length) * 100}%"></i></div>
      <ol class="fd-steps">${steps.map(([id, t, b, a, attrs], i) => `<li class="${done.has(id) ? 'done' : ''}"><span class="fd-n">${done.has(id) ? ic('check') : i + 1}</span><span class="fd-t"><b>${esc(t)}</b><small>${esc(b)}</small></span>${done.has(id) ? '<span class="fd-ok">Done</span>' : `<button class="us-ghost" ${attrs} data-fd-step="${ctx}:${id}">${esc(a)}</button>`}</li>`).join('')}</ol></section>
      <p class="note">This is the page a brand-new account sees. It turns into the normal home as soon as there is work to show.</p></div>`;
  }
  function mainDashboard() {
    if (homeState() === 'empty') return firstDay('overview');
    const seen = seenPrev('overview'), st = NS(), notes = notesNow().filter((n) => n.g === 'needs' && viewOf(n, st) === 'inbox');
    const running = H_runningRows().filter((r) => /running|rendering/i.test(r[1] || ''));
    const last = window.XENO_RECENT.find((r) => PR[r.p]);
    const projs = ((window.XENO_PG_PROJECTS || {}).items || []).filter((p) => p.status === 'active');
    const newN = seen ? notes.filter((n) => n.at > seen).length : 0;
    const sentence = sentenceOf([notes.length && plural(notes.length, 'thing needs you', 'things need you'), running.length && `${plural(running.length, 'job is', 'jobs are')} running`, projs.length && `${plural(projs.length, 'project is', 'projects are')} active`].filter(Boolean), 'Nothing is waiting anywhere — a good moment to start something.') + (newN ? ` ${newN === 1 ? 'One is' : newN + ' are'} new since you were last here, ${agoWhen(seen)}.` : '');
    const modeCard = (m) => { const n = notesNow().filter((x) => x.m === m.id && x.g === 'needs' && viewOf(x, st) === 'inbox').length, r = window.XENO_RECENT.find((x) => x.m === m.id && PR[x.p]), k = kpis(m.id)[0], t = k && kTrend(k);
      return `<button class="ov2-mode" data-mode="${m.id}"><span class="ov2-mode-h">${mark(m.id, 'ov2-mk')}<b>${M[m.id].name}</b>${n ? `<span class="hm2-count">${n}</span>` : ''}</span>${k ? `<span class="ov2-metric"><span class="kpi-row"><b>${esc(kFmt(k))}</b>${spark(k.series)}</span><small>${esc(k.label)} · ${t.txt}</small></span>` : ''}<small class="ov2-last">${r ? `Last: ${esc(r.t)}` : 'Nothing yet'}</small></button>`; };
    const health = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };
    const secs = homeSections('overview', [
      { id: 'needs', label: 'Needs you', html: () => homeState() === 'error' ? `<section class="hm2-sec"><div class="hm2-h"><h2>Needs you</h2></div><div class="hm2-err">${ic('reset')}<span><b>Couldn't load what needs you.</b> Your inbox is safe — nothing was changed.</span><button class="us-ghost" data-home-retry>Try again</button></div></section>` : homeNeeds(null, seen) },
      { id: 'running', label: 'Running now', html: () => running.length ? `<section class="hm2-sec"><div class="hm2-h"><h2>Running now</h2><span class="hm2-sub">across every mode</span></div>${running.map(([t, s, p]) => { const pct = parseInt((s.match(/\d+/) || [])[0] || '0', 10);
        return `<button class="hm2-job" ${p ? `data-item-p="${p}" data-item="${esc(t)}"` : ''}>${mini(p)}<span class="hm2-job-t"><b>${esc(t)}</b><small>${p ? esc(PR[p].name) + ' · ' : ''}${esc(s)}</small>${pct ? `<span class="hm2-prog"><i style="width:${pct}%"></i></span>` : '<span class="hm2-prog live"><i></i></span>'}</span>${pct ? `<span class="hm2-pct">${pct}%</span>` : '<span class="hm2-pct sm">Live</span>'}</button>`; }).join('')}</section>` : '' },
      { id: 'modes', label: 'Your modes', html: () => `<section class="hm2-sec"><div class="hm2-h"><h2>Your modes</h2><span class="hm2-sub">each one's headline number this week, and what is waiting there</span></div><div class="ov2-modes">${visibleModes().map(modeCard).join('')}</div></section>` },
      { id: 'projects', label: 'Projects', html: () => projs.length ? `<section class="hm2-sec"><div class="hm2-h"><h2>Projects</h2><button class="hm2-link" data-go="projects">All projects ${ic('right')}</button></div><div class="ov2-projs">${projs.slice(0, 4).map((p) => `<button class="ov2-proj" data-open-project-ov="${esc(p.name)}"><span class="ov2-proj-h"><small>${esc(p.mode)}</small>${p.needsYou ? `<span class="hm2-count">${p.needsYou}</span>` : ''}</span><b>${esc(p.name)}</b><span class="hm2-prog"><i style="width:${Math.round((p.tasks.done / Math.max(1, p.tasks.total)) * 100)}%"></i></span><small>${p.tasks.done}/${p.tasks.total} tasks · ${health[p.health] || ''} · ${esc(p.milestone.title)}</small></button>`).join('')}</div></section>` : '' },
      { id: 'recent', label: 'Recent work', html: () => `<section class="hm2-sec"><div class="hm2-h"><h2>Recent work</h2><span class="hm2-sub">everything you touched, every mode</span><button class="hm2-link" data-go="library">Library ${ic('right')}</button></div>
        ${window.XENO_SIG ? window.XENO_SIG.wall(window.XENO_SIG.libFor(null, 9)) : ''}</section>` },
    ]);
    return `<div class="wrap hm2${homeState() === 'loading' ? ' hm2--ghost' : ''}" data-home="overview">
      ${homeHero({ eye: `Overview · ${esc(dayName())}`, sentence, acts: `<button class="us-primary" data-go="chat">${ic('plus')}New chat</button><button class="us-ghost" data-go="search">${ic('search')}Find anything<kbd>Ctrl K</kbd></button>`, cont: contCard(last, `Continue · ${(M[last.m]?.name || PR[last.p]?.name || "")}`) })}
      ${secs}${secs ? '' : '<p class="hm2-allhidden">Every section is hidden. <button class="hm2-link" data-home-custom>Customize</button> to bring them back.</p>'}</div>`;
  }
  function mainMode() {
    const m = modeOf(S.mode);
    if (homeState() === 'empty') return firstDay(m.id);
    const seen = seenPrev(m.id), st = NS();
    const recent = window.XENO_RECENT.filter((r) => r.m === m.id && PR[r.p]);
    const last = recent[0], needs = notesNow().filter((n) => n.m === m.id && n.g === 'needs' && viewOf(n, st) === 'inbox');
    const running = H_runningRows(m.id).filter((r) => /running|rendering/i.test(r[1] || '')).length; // waiting on you is not running
    const newN = seen ? needs.filter((n) => n.at > seen).length : 0;
    const sentence = sentenceOf([needs.length && plural(needs.length, 'thing needs you', 'things need you'), running && `${plural(running, 'job is', 'jobs are')} running`, last && `you were last in ${PR[last.p].name}`].filter(Boolean), 'Nothing is waiting — a good moment to start something.') + (newN ? ` ${newN === 1 ? 'One is' : newN + ' are'} new since you were last here, ${agoWhen(seen)}.` : '');
    const sp = PR[m.start] || PR[last?.p];
    const SIGL = { studio: 'In production and your work', office: 'Your desk and mail', social: 'This week and conversations', corpo: 'The company and its people', dev: 'Agent runs and automations', tools: 'Tools' };
    const secs = homeSections(m.id, [
      { id: 'needs', label: 'Needs you', html: () => homeState() === 'error' ? `<section class="hm2-sec"><div class="hm2-h"><h2>Needs you</h2></div><div class="hm2-err">${ic('reset')}<span><b>Couldn't load what needs you.</b> Your inbox is safe — nothing was changed.</span><button class="us-ghost" data-home-retry>Try again</button></div></section>` : homeNeeds(m.id, seen) },
      { id: 'kpis', label: 'This week', html: () => kpiSection(m.id) },
      { id: 'sig', label: SIGL[m.id] || 'Your work', html: () => `<div class="hm2-sigwrap">${window.XENO_SIG?.[m.id] ? window.XENO_SIG[m.id](m) : (SIG[m.id] || SIG.studio)(m)}</div>` },
      { id: 'areas', label: 'Areas', html: () => `<section class="hm2-sec"><div class="hm2-h"><h2>Areas</h2></div><div class="hm2-areas">${zonesFor(m.id).map((z) => { const n = (z.products || []).filter((id) => PR[id] && PR[id].status !== 'soon').length; return `<button class="hm2-area" data-zone="${z.id}">${ic(z.icon)}<span><b>${esc(z.label)}</b><small>${n ? plural(n, 'product', 'products') : 'Coming soon'}</small></span></button>`; }).join('')}</div></section>` },
    ]);
    return `<div class="wrap hm2${homeState() === 'loading' ? ' hm2--ghost' : ''}" data-home="${m.id}">
      ${homeHero({ eye: `${esc(M[m.id].name)} · ${esc(dayName())}`, sentence, acts: `${sp ? `<button class="us-primary" data-product="${sp.id}">${ic('plus')}New in ${esc(sp.name)}</button>` : ''}<button class="us-ghost" data-go="search">${ic('search')}Find anything<kbd>Ctrl K</kbd></button>`, cont: contCard(last, 'Continue') })}
      ${secs}${secs ? '' : '<p class="hm2-allhidden">Every section is hidden. <button class="hm2-link" data-home-custom>Customize</button> to bring them back.</p>'}</div>`;
  }
  // Customize: show, hide and reorder the sections of this home (Notion Home's model). Saved per home.
  function openHomeCustom(btn) {
    let pop = document.querySelector('.hm-cust'); if (pop) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); if (pop._btn === btn) return; }
    if (!HOME_SECS) return;
    const ctx = HOME_SECS.ctx, key = 'homeLayout.' + ctx;
    const get = () => { const L = store.get(key, null) || {}; const ids = HOME_SECS.list.map((x) => x.id); const order = [...(L.order || []).filter((i) => ids.includes(i)), ...ids.filter((i) => !(L.order || []).includes(i))]; return { order, hidden: new Set(L.hidden || []) }; };
    pop = document.createElement('div'); pop.className = 'hm-cust'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Customize this home'); pop._btn = btn;
    const paint = (focusSel) => { const { order, hidden } = get(); const lab = (id) => HOME_SECS.list.find((x) => x.id === id)?.label || id;
      pop.innerHTML = `<header><b>Customize</b><small>${esc(ctx === 'overview' ? 'Overview' : M[ctx].name)} home</small></header><ol>${order.map((id, i) => `<li><button class="hm-cust-sw" role="switch" aria-checked="${!hidden.has(id)}" data-hc-tog="${id}"><i></i></button><span>${esc(lab(id))}</span><button class="hm-cust-mv" data-hc-mv="${id}" data-d="-1" aria-label="Move ${esc(lab(id))} up" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button><button class="hm-cust-mv" data-hc-mv="${id}" data-d="1" aria-label="Move ${esc(lab(id))} down" ${i === order.length - 1 ? 'disabled' : ''}>${ic('chev')}</button></li>`).join('')}</ol><footer><button class="us-ghost" data-hc-reset>Reset to default</button><button class="us-primary" data-hc-done>Done</button></footer>`;
      if (focusSel) pop.querySelector(focusSel)?.focus(); };
    const apply = (L, focusSel) => { store.set(key, { order: L.order, hidden: [...L.hidden] }); const mv = $('#main .mview'); if (mv) { const top = mv.scrollTop; mv.innerHTML = S.view === 'mode' ? mainMode() : mainDashboard(); mv.scrollTop = top; } paint(focusSel); };
    pop.addEventListener('click', (e) => { const L = get();
      const tg = e.target.closest('[data-hc-tog]'); if (tg) { const id = tg.dataset.hcTog; L.hidden.has(id) ? L.hidden.delete(id) : L.hidden.add(id); return apply(L, `[data-hc-tog="${id}"]`); }
      const mvb = e.target.closest('[data-hc-mv]'); if (mvb) { const id = mvb.dataset.hcMv, i = L.order.indexOf(id), j = i + +mvb.dataset.d; if (j < 0 || j >= L.order.length) return; [L.order[i], L.order[j]] = [L.order[j], L.order[i]]; return apply(L, `[data-hc-mv="${id}"][data-d="${mvb.dataset.d}"]:not([disabled]), [data-hc-tog="${id}"]`); }
      if (e.target.closest('[data-hc-reset]')) { store.set(key, null); return apply({ order: HOME_SECS.list.map((x) => x.id), hidden: new Set() }, '[data-hc-reset]'); }
      if (e.target.closest('[data-hc-done]')) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    document.body.appendChild(pop); paint(); const r = btn.getBoundingClientRect(); pop.style.top = r.bottom + 6 + 'px'; pop.style.left = Math.max(12, r.right - pop.offsetWidth) + 'px'; btn.setAttribute('aria-expanded', 'true'); pop.querySelector('[role=switch]')?.focus();
  }
  document.addEventListener('mousedown', (e) => { const p = document.querySelector('.hm-cust'); if (p && !e.target.closest('.hm-cust, [data-home-custom]')) { p.remove(); p._btn?.setAttribute('aria-expanded', 'false'); } }, true);
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-home-custom]'); if (c) { e.stopPropagation(); return openHomeCustom(document.querySelector('.topbar [data-home-custom]') || c); }
    const pv = e.target.closest('#main .mfoot [data-pg-preview]'); if (pv && window.XENO_PAGES_PREVIEW) { e.stopPropagation(); return window.XENO_PAGES_PREVIEW(pv); }
    if (e.target.closest('#main [data-home-retry]')) { e.stopPropagation(); const m = store.get('pgState', {}) || {}; m.home = 'normal'; store.set('pgState', m); return render(); }
    if (e.target.closest('#main [data-retry]')) { e.stopPropagation(); const k = e.target.closest('[data-retry]').dataset.retry; DS[k] && (DS[k].err = null); return load(k); }
    const fd = e.target.closest('[data-fd-step]'); if (fd) { const [ctx, id] = fd.dataset.fdStep.split(':'); const s = new Set(store.get('setup.' + ctx, []) || []); s.add(id); store.set('setup.' + ctx, [...s]); if (fd.dataset.intro) { e.stopPropagation(); openModeIntro(fd.dataset.intro, fd); } }
  }, true);
  // Needs-you actions on a home use the inbox's own model, so acting here clears it there too
  document.addEventListener('click', (e) => {
    const home = e.target.closest('.hm2'); if (!home || home.closest('#modeIntro')) return; // the intro's miniature routes its own clicks
    if (e.target.closest('[data-nt-viewall-page]')) { e.stopPropagation(); return go('global', { global: 'inbox', item: null }); }
    const card = e.target.closest('[data-hmn]'); if (!card) return; e.stopPropagation();
    const n = ntAll().find((x) => x.id === card.dataset.hmn); if (!n) return;
    if (e.target.closest('[data-hmn-do]') && INLINE[n.kind]) return ntInline(n, () => render());
    ntOpen(n);
  }, true);
  // Area page: the section's products as launch cards, then the work living in them. Planned
  // products say so; no sample work is shown for something that is not built.
  function mainZone() {
    const z = zoneNow(), prods = z.products || [], live = prods.filter((id) => PR[id] && PR[id].status !== 'soon');
    const work = z.work ? z.work[1].filter((r) => (r[2] ? PR[r[2]] && PR[r[2]].status !== 'soon' : !prods.length || live.length)) : [];
    const card = (id) => { const p = PR[id], soon = p.status === 'soon';
      return `<button class="hm-prod${soon ? ' soon' : ''}" data-product="${id}">${pIconFull(p, 28)}<div><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small></div><span class="hm-tag">${soon ? 'Coming soon' : p.kind === 'desktop' ? 'Desktop' : 'Web'}</span></button>`; };
    const ctxLine = z.of ? `${M[z.of].name} · seen from Overview` : M[zoneKey()].name;
    return `<div class="wrap pj hm"><div class="pj-head"><div><small>${esc(ctxLine)}</small><h1>${esc(z.label)}</h1></div>${live[0] ? `<button class="btn" data-product="${live[0]}">New in ${esc(PR[live[0]].name)}</button>` : ''}</div>
      <p class="hm-blurb">${esc(z.blurb)}</p>
      ${prods.length ? `<h3>Products</h3><div class="hm-prods">${prods.map(card).join('')}</div>` : ''}
      ${work.length ? `<h3>${esc(z.work[0])}</h3>${H_list(work.map(([t, m, p]) => H_li(p ? `data-item-p="${p}" data-item="${esc(t)}"` : `data-item="${esc(t)}"`, t, m)))}` : ''}
      ${prods.length && !live.length ? `<div class="pj-empty">${prods.map((id) => esc(PR[id].name)).join(', ')} ${prods.length > 1 ? 'are' : 'is'} planned, not built — this area fills in when ${prods.length > 1 ? 'they launch' : 'it launches'}.</div>` : ''}
      ${z.of ? `<div class="hm-switch"><button class="btn ghost" data-mode="${z.of}">Open ${M[z.of].name} mode</button></div>` : ''}
      <div class="note">Prototype — sample data.</div></div>`;
  }
  function mainProduct() {
    const p = PR[S.product];
    if (p.kind === 'chat' && window.XENO_CHAT && window.XENO_CHAT.served) return window.XENO_CHAT.host();
    if (p.kind === 'chat' && window.XENO_LIVE_CHAT) { const C = window.XENO_LIVE_CHAT; return `<div class="live-chat-host"><div class="live-chat chat-themed chat-theme-dark" style="${C.vars.replace(/"/g, '&quot;')}">${C.html}</div></div>`; }
    if (p.kind === 'chat') return `<div class="chat"><div class="thread"><div class="in"><div class="um">next one</div><div class="am"><p>Here is the next scenario. A company runs EC2 instances across three Availability Zones and needs a shared file system every instance can mount at once, with storage that grows automatically.</p><p>Which service fits best: <b>EFS</b>, <b>EBS Multi-Attach</b> or <b>FSx for Lustre</b>?</p></div></div></div>
      <div class="dock"><div class="in"><div class="shell"><textarea rows="1" placeholder="Ask anything — plan, explain, or rewrite"></textarea><div class="crow"><button class="icb" aria-label="Attach">${ic('plus')}</button><div class="grow"></div><div class="mgrp"><button><span class="model">GPT-5.6 Terra</span></button><button><span class="pill">Medium</span></button></div><button class="send" aria-label="Send">${ic('send')}</button></div></div></div></div></div>`;
    const btns = p.status === 'soon' ? window.XL.notifyBtn(S.product, 'btn', 'Notify me', false) : p.kind === 'desktop' ? `<button class="btn" data-xl-hub="${S.product}">Open in Hub</button><button class="btn ghost" data-xl-download="${S.product}">Download</button>` : `<button class="btn" data-xl-new="${S.product}">Start</button>`;
    return `<div class="wrap"><div class="landing">${pIcon(p, 72)}<h1>XENO ${esc(p.name)}</h1><p>${esc(p.blurb)}${p.status === 'soon' ? ' — coming soon.' : ''}</p><div class="row2">${btns}</div><div class="note">${esc(p.name)}’s own interface opens here when it is part of the workspace.</div></div></div>`;
  }
  function mainGlobal() {
    if (S.global === 'inbox') return mainInbox();
    const t = { places: ['Places', 'Your workspace as a building — floors, teams, desks and who is working.'], anima: ['Anima', 'Your own agent follows you into every mode.'], community: ['Community', 'Ask, answer and report — with people and agents.'], market: ['Marketplace', 'Apps, agents, tools, panels and blueprints.'], library: ['Library', 'Everything you made or uploaded — every mode, every product, one place.'], projects: ['Projects', 'Goals, tasks, chats, files and the teams on them — one project, every mode.'], workspace: ['Workspace', 'Members, agents, teams, knowledge and automations.'] }[S.global];
    return `<div class="wrap"><div class="landing"><span class="ib" style="width:72px;height:72px;pointer-events:none">${ic({ market: 'market', library: 'lib', projects: 'folder', workspace: 'building' }[S.global] || S.global).replace('class="i"', 'class="i" style="width:40px;height:40px"')}</span><h1>${t[0]}</h1><p>${t[1]}</p><div class="row2"><button class="btn ghost" data-back>Back</button></div></div></div>`;
  }
  function mainProject(name, tab) {
    const P = (window.XENO_PROJECTS || {})[name] || { mode: ctxName(), owner: 'You', goal: 'No goal yet.', milestone: '—', progress: 'New', tasks: [], chats: [], teams: [], resources: [], funding: [], activity: [] };
    const tabs = window.XENO_PROJECT_TABS, cur = tabs.includes(tab) ? tab : 'Overview';
    const list = (rows, empty) => rows.length ? `<div class="pj-list">${rows.map(([t, m]) => `<button class="pj-li" data-item="${esc(name)}/${esc(t)}"><span>${esc(t)}</span><small>${esc(m)}</small></button>`).join('')}</div>` : `<div class="pj-empty">${empty}</div>`;
    const body = {
      Overview: `<div class="pj-grid"><div class="pj-card"><small>Goal</small><b>${esc(P.goal)}</b></div><div class="pj-card"><small>Next milestone</small><b>${esc(P.milestone)}</b></div><div class="pj-card"><small>Progress</small><b>${esc(P.progress)}</b></div></div><h3>Recent activity</h3>${list(P.activity.slice(0, 3), 'Nothing yet.')}`,
      Tasks: list(P.tasks, 'No tasks yet — completion needs evidence and a reviewer (WORKFORCE §8.5).'),
      Conversations: list(P.chats, 'No conversations attached.'),
      'Team assignments': list(P.teams, 'No team assigned. Teams are referenced here, not copied into the project.'),
      Resources: list(P.resources, 'No files, repositories or libraries attached.'),
      Funding: P.funding.length ? list(P.funding, '') : '<div class="pj-empty">Funding is visible only to permitted managers and contributors.</div>',
      Activity: list(P.activity, 'Nothing yet.'),
    }[cur];
    return `<div class="wrap pj"><div class="pj-head"><div><small>${esc(P.mode)} · Owner ${esc(P.owner)}</small><h1>${esc(name)}</h1></div><button class="btn ghost" data-xa="assign" data-arg="${esc(name)}">Assign</button></div>
      <div class="pj-tabs" role="tablist">${tabs.map((t) => `<button role="tab" aria-selected="${t === cur}" data-ptab="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="pj-body">${body}</div><div class="note">Prototype — sample project data. Each tab has its own address.</div></div>`;
  }
  function mainItem() {
    if (S.view === 'global' && S.global === 'inbox') return mainInbox();
    if (S.view === 'global' && S.global === 'projects' && (window.XENO_PROJECTS || {})[S.item.split('/')[0]] !== undefined || (S.view === 'global' && S.global === 'projects' && !/^(Archived projects)$/.test(S.item))) { const [nm, tb] = S.item.split('/'); return mainProject(nm, tb); }
    const owner = S.view === 'product' ? PR[S.product].name : S.view === 'zone' ? zoneNow().label : { anima: 'Anima', community: 'Community', market: 'Marketplace', library: 'Library', projects: 'Projects', workspace: 'Workspace', inbox: 'Inbox', settings: 'Settings', places: 'Places' }[S.global] || '';
    return `<div class="wrap"><div class="landing"><span class="ib" style="width:72px;height:72px;pointer-events:none">${ic('doc').replace('class="i"', 'class="i" style="width:40px;height:40px"')}</span><h1>${esc(S.item)}</h1><p>${esc(owner)} · ${esc(ctxName())}</p><div class="row2"><button class="btn ghost" data-back>Back</button></div><div class="note">Couldn’t find “${esc(S.item)}” in ${esc(owner)}. It may have been renamed, moved or deleted — check Trash in your Library.</div></div></div>`;
  }
  function crumbs() {
    const liveChat = !!(window.XENO_CHAT && window.XENO_CHAT.served);
    if (S.view === 'zone') return `<span>${M[zoneKey()].name}</span><span class="sep">/</span>${zoneNow().of ? `<span>${M[zoneNow().of].name}</span><span class="sep">/</span>` : ''}${S.item ? `<span>${esc(zoneNow().label)}</span><span class="sep">/</span><b>${esc(S.item)}</b>` : `<b>${esc(zoneNow().label)}</b>`}`;
    const sep = '<span class="sep">/</span>';
    if (S.view === 'dashboard') return '<b>Overview</b>';
    if (S.view === 'adaptive') return '<b>Adaptive</b><span class="sep">·</span><span>Beta</span>';
    if (S.view === 'mode') return `<b>${M[S.mode].name}</b>`;
    if (S.view === 'global') { const gn = { anima: 'Anima', community: 'Community', market: 'Marketplace', library: 'Library', projects: 'Projects', workspace: 'Workspace', inbox: 'Inbox', settings: 'Settings', places: 'Places' }[S.global]; if (!S.item) return `<b>${gn}</b>`;
      // a path is a trail you can walk back up: every segment but the last is a link (GitHub, Finder)
      const parts = S.item.split('/'), lbl = (x, i) => (S.global === 'community' && /^th_/.test(x) ? window.XENO_PG_FORUM.find((t) => t.id === x)?.title || x : S.global === 'community' && i > 0 && parts[0] === 'My reports' ? '#' + x : x);
      return `<a data-crumb="">${gn}</a>` + parts.map((x, i) => sep + (i < parts.length - 1 ? `<a data-crumb="${esc(parts.slice(0, i + 1).join('/'))}">${esc(lbl(x, i))}</a>` : `<b>${esc(lbl(x, i))}</b>`)).join(''); }
    const p = PR[S.product];
    return `<span>${ctxName()}</span>${sep}${S.item ? `<span>${esc(p.name)}</span>${sep}<b>${esc(liveChat && S.product === 'chat' ? window.XENO_CHAT.title(S.item) : S.item)}</b>` : `<b>${esc(p.name)}</b>`}${S.product === 'chat' && !S.item ? `${sep}<span>${esc(liveChat ? 'New chat' : ctxChats().pinned[0] || 'New chat')}</span>` : ''}`;
  }
  function liveDashboard() {
    const D = window.XENO_LIVE_DASHBOARD;
    if (!D) return '';
    return `<div class="live-dash" data-overview-shell style="${D.vars.replace(/"/g, '&quot;')}"><button class="ib opener-float" data-expand aria-label="Open sidebar" data-tip="Open sidebar" data-kbd="Ctrl \\">${ic('side')}</button>${D.html}</div>`;
  }
  function mainHTML() {
    // full-page destinations (pages.js) get the three containers: header (path + the page's actions) · body · footer
    const pf = window.XENO_PAGES && window.XENO_PAGES.framed();
    if (pf) return `<div class="topbar pg-top"><button class="ib opener" data-expand aria-label="Open sidebar" data-tip="Open sidebar" data-kbd="Ctrl \\">${ic('side')}</button><div class="crumbs">${crumbs()}</div><div class="pg-top-sum">${pf.sum}</div><div class="pg-top-left">${pf.left}</div><div class="sp"></div><div class="pg-top-tools">${pf.tools}</div><div class="pg-top-acts">${pf.acts}</div></div><div class="mview pg-mview${pf.foot ? ' has-foot' : ''}">${pf.body}</div>${pf.foot ? `<footer class="mfoot">${pf.foot}</footer>` : ''}`;
    // a real conversation is the chat page showing that conversation, not a generic "item" page
    const liveChatItem = S.item && S.view === 'product' && S.product === 'chat' && window.XENO_CHAT && window.XENO_CHAT.served;
    if (S.item && !liveChatItem) return `<div class="topbar"><button class="ib opener" data-expand aria-label="Open sidebar" data-tip="Open sidebar" data-kbd="Ctrl \\">${ic('side')}</button><div class="crumbs">${crumbs()}</div><div class="sp"></div></div><div class="mview">${mainItem()}</div>`;
    const body = S.view === 'adaptive' ? mainAdaptive() : S.view === 'zone' ? mainZone() : S.view === 'dashboard' ? mainDashboard() : S.view === 'product' ? mainProduct() : S.view === 'global' ? mainGlobal() : mainMode();
    const isChat = S.view === 'product' && S.product === 'chat';
    if (S.view === 'mode' || S.view === 'dashboard') {
      // homes: the header bar carries the place and the date; the status bar carries the feed's freshness,
      // what is waiting and running here, the keys that work everywhere, and the tucked-away preview
      const hs = homeState(), d = DS.notes || {}, st = NS(), mine = (n) => S.view === 'dashboard' || n.m === S.mode;
      const needN = notesReady() ? ntAll().filter((n) => n.g === 'needs' && viewOf(n, st) === 'inbox' && mine(n)).length : null;
      const runN = H_runningRows(S.view === 'dashboard' ? undefined : S.mode).filter((r) => /running|rendering/i.test(r[1] || '')).length;
      const refresh = (label) => `<button class="sb-ib" data-retry="notes" aria-label="${label}" data-tip="${label}">${ic('reset')}</button>`;
      const fresh = hs === 'error' ? '<span class="sb-fresh bad"><i></i>Part of this page could not load</span>'
        : hs === 'loading' || (!d.val && !d.err) ? '<span class="sb-fresh live"><i></i>Loading…</span>'
        : d.err ? `<span class="sb-fresh bad"><i></i>Inbox offline</span>${refresh('Retry')}`
        : `<span class="sb-fresh ok"><i></i><span data-at="${d.at}">Updated ${agoTxt(d.at)}</span></span>${refresh('Refresh')}`;
      const info = hs !== 'normal' || needN == null ? '' : `${needN} need${needN === 1 ? 's' : ''} you · ${runN} running`;
      const keys = [['Ctrl K', 'Find'], ['Alt 0–6', 'Modes'], ['Ctrl \\', 'Sidebar']].map(([k, l]) => `<span><kbd>${k}</kbd>${l}</span>`).join('');
      const L = { normal: 'Normal', empty: 'First day', loading: 'Loading', error: 'Error' };
      return `<div class="topbar pg-top"><button class="ib opener" data-expand aria-label="Open sidebar" data-tip="Open sidebar" data-kbd="Ctrl \\">${ic('side')}</button><div class="crumbs">${crumbs()}</div><div class="pg-top-sum"><span>${esc(dayName())}</span></div><div class="sp"></div><div class="pg-top-acts">${hs === 'empty' ? '' : `<button class="pg-btn ghost" data-home-custom aria-haspopup="dialog" aria-expanded="false">${ic('sliders')}<span>Customize</span></button>`}</div></div><div class="mview pg-mview has-foot">${body}</div><footer class="mfoot"><div class="sb-l">${fresh}${info ? `<span class="sb-sep"></span><span class="sb-info">${info}</span>` : ''}</div><div class="sb-r"><span class="sb-keys">${keys}</span><button class="sb-prev" data-pg-preview="home" title="Prototype only — data in the shape of GET /api/v2/modes/:mode/metrics + the inbox feed" aria-haspopup="listbox" aria-expanded="false">Preview <b>${L[hs]}</b>${ic('chev')}</button></div></footer>`;
    }
    return `<div class="topbar"><button class="ib opener" data-expand aria-label="Open sidebar" data-tip="Open sidebar" data-kbd="Ctrl \\">${ic('side')}</button><div class="crumbs">${crumbs()}</div>${isChat && window.XENO_CHAT && window.XENO_CHAT.served ? `<button class="tb-mid" data-chat-transcript aria-live="polite" data-tip="Copy the whole conversation, with its diagnostics">${ic('copy')}<span>Copy transcript</span></button>` : ''}<div class="sp"></div>${isChat ? `<button class="ib" aria-label="Share" data-tip="Share">${ic('share')}</button><button class="ib" aria-label="More" data-tip="Copy transcript, rename, delete">${ic('more')}</button>` : ''}</div>${isChat ? body : `<div class="mview">${body}</div>`}`;
  }

  window.XW = { get S() { return S; }, go, setChatItem, openModelMenu: (anchor) => openModelMenu(anchor, 'model'), openEffortMenu: (anchor) => openModelMenu(anchor, 'effort'), closeModelMenu: () => closeAp(), modelMenuOpen: () => !!document.querySelector('#apmenu.show'), crumbs: () => crumbs(), esc, ic, PR, M, pIconFull, mini, toast: (s) => toast(s), store, ctxName, ctxKey, ctxChats, inOv, zoneNow, zoneKey, zonesFor, modeOf, mark, render: () => render(), hiddenModes, toggleHidden, modeOrder, renderRail: () => renderRail(), openShortcuts: (o) => openShortcuts(o), openUsage: () => openUsage(), openAdConsent: (o) => openAdConsent(o), hidePops: () => hidePops(), applyWorkspace: () => applyWorkspace(), markAllRead: () => markAllRead(() => render()), refreshSwitcher: () => refreshSwitcher(), search: (q) => { openPalette(); const i = document.querySelector('#palette input'); if (i && q) { i.value = q; i.dispatchEvent(new Event('input')); } }, refreshPanel: () => { const pv = $('#panel > .pv'); const top = pv?.querySelector('.pbody')?.scrollTop || 0; setPv($('#panel'), `<div class="pv">${panelHTML()}</div>`); const n = $('#panel > .pv .pbody'); if (n) n.scrollTop = top; } };
  // ---- render with crossfade ----
  let first = true;
  function render() {
    store.set('view', S.view === 'global' ? 'mode' : S.view); store.set('mode', S.mode); store.set('product', S.product);
    root.dataset.view = S.view;
    renderRail(); setTimeout(railFit, 200); setTimeout(() => { syncBell(); syncUsage(); }, 0);
    const panel = $('#panel'), main = $('#main');
    const swap = (host, html, cls) => {
      const old = cls === 'pv' ? host.querySelector(':scope > .pv') : host.firstElementChild;
      if (first || !old) { if (cls === 'pv') setPv(host, `<div class="pv">${html}</div>`); else host.innerHTML = html; return; }
      const doIt = () => { if (cls === 'pv') { const n = setPv(host, `<div class="pv" style="opacity:0;transform:translateY(4px)">${html}</div>`); restorePanelMem(n); requestAnimationFrame(() => { n.style.opacity = ''; n.style.transform = ''; }); } else host.innerHTML = html; };
      if (cls === 'pv') { old.classList.add('swap-out'); setTimeout(doIt, 90); } else doIt();
    };
    const soft = S._softPanel && panel.querySelector(':scope > .pv'); S._softPanel = false;
    if (!soft) swap(panel, panelHTML(), 'pv');
    const mv = main.querySelector('.mview, .chat, .live-dash, .live-chat-host');
    if (mv && !first) { mv.classList.add('swap-out'); setTimeout(() => { main.innerHTML = mainHTML(); }, 90); } else main.innerHTML = mainHTML();
    first = false;
  }
  // replace the panel's content node only — never the switcher layer that may sit above it
  function setPv(panel, html) {
    const tmp = document.createElement('div'); tmp.innerHTML = html; const n = tmp.firstElementChild;
    const old = panel.querySelector(':scope > .pv'); if (old) old.replaceWith(n); else panel.prepend(n);
    markItems(n);   // a panel built from a restored route (reload, Back, deep link) must show its selection too
    return n;
  }
  function markItems(scope = document.querySelector('#panel > .pv')) {
    scope?.querySelectorAll('[data-item]').forEach((r) => r.setAttribute('aria-current', String(!!S.item && r.dataset.item === S.item.split('/')[0] && (!r.dataset.itemP || r.dataset.itemP === S.product || S.view !== 'product'))));
  }
  function openSwitcher() {
    if (S.switching) return closeSwitcher();
    hidePops(); S.switching = true;
    const panel = $('#panel');
    panel.querySelector(':scope > .msw-layer')?.remove();
    const layer = document.createElement('div'); layer.className = 'msw-layer'; layer.innerHTML = panelSwitcher();
    panel.appendChild(layer);
    panel.inert = false; panel.setAttribute('aria-hidden', 'false');
    void layer.offsetWidth;                        // commit the closed state so the sweep animates
    root.setAttribute('data-switching', '');
    layer.classList.add('on');
    setTimeout(() => layer.querySelector('.msw-row')?.focus({ focusVisible: false }), 120);
    if (!store.get('tipCycle', false)) { store.set('tipCycle', true);
      const tip = document.createElement('div'); tip.className = 'msw-tip'; tip.innerHTML = `${ic('star')}<span><b>Tip</b> Click the logo to cycle through your modes.</span><button class="ib" aria-label="Dismiss">${ic('x')}</button>`;
      layer.querySelector('.msw-list')?.before(tip); tip.querySelector('button').onclick = (ev) => { ev.stopPropagation(); tip.remove(); }; }
  }
  function refreshSwitcher() { const layer = $('#panel > .msw-layer'); if (layer) layer.innerHTML = panelSwitcher(); if (S.view === 'dashboard') render(); }
  function layerShow(html) {
    const layer = $('#panel > .msw-layer'); if (!layer) return;
    const old = layer.firstElementChild; old?.classList.add('msw-out');
    setTimeout(() => { layer.innerHTML = html; const n = layer.firstElementChild; n.classList.add('msw-in'); requestAnimationFrame(() => n.classList.remove('msw-in')); }, 110);
  }
  function closeSwitcher(restore = true) {
    if (!S.switching) return;
    S.switching = false;
    const panel = $('#panel'), layer = panel.querySelector(':scope > .msw-layer');
    root.removeAttribute('data-switching');
    if (layer) { layer.classList.remove('on'); layer.classList.add('off'); setTimeout(() => layer.remove(), 260); }
    const closed = root.dataset.panel !== 'open';
    panel.inert = closed; panel.setAttribute('aria-hidden', String(closed));
  }
  function setPanel(state, persist = true) {
    root.removeAttribute('data-peek');
    root.dataset.panel = state;
    $('#panel').inert = state !== 'open'; $('#panel').setAttribute('aria-hidden', String(state !== 'open'));
    if (persist) store.set('panel', state);
  }

  // ---- navigation ----
  // ---- routes: every place has an address; Back/Forward and refresh work ----
  function stateToHash() {
    const base = inOv() ? 'overview' : S.mode, it = S.item ? '/' + encodeURIComponent(S.item) : '';
    if (S.view === 'dashboard') return '#/overview';
    if (S.view === 'adaptive') return '#/adaptive';
    if (S.view === 'zone') return `#/${base}/z/${S.zone}${it}`;
    if (S.view === 'product') return `#/${base}/p/${S.product}${it}`;
    if (S.view === 'global') return `#/${base}/g/${S.global}${it}`;
    return `#/${base}`;
  }
  function hashToState(h) {
    const [m, kind, id, ...rest] = String(h || '').split('?')[0].replace(/^#\/?/, '').split('/'); const rawItem = rest.join('/'); let item = null; try { item = rawItem ? decodeURIComponent(rawItem) : null; } catch { item = rawItem || null; }
    const modeOk = MODES.some((x) => x.id === m);
    if (m === 'adaptive') return { view: 'adaptive' };
    if (m === 'overview') { if (kind === 'z' && id && zonesFor('overview').some((z) => z.id === id)) return { view: 'zone', zone: id, zoneOf: 'overview', item };
      if (kind === 'p' && PR[id]) return { view: 'product', product: id, zoneOf: 'overview', item };
      if (kind === 'g' && ['anima', 'community', 'market', 'library', 'projects', 'workspace', 'inbox', 'settings', 'places'].includes(id)) return { view: 'global', global: id, zoneOf: 'overview', item };
      return { view: 'dashboard' }; }
    if (!modeOk) return null;
    if (kind === 'z' && zonesFor(m).some((z) => z.id === id)) return { view: 'zone', mode: m, zone: id, zoneOf: 'mode', item };
    if (kind === 'p' && PR[id]) return { view: 'product', mode: m, product: id, zoneOf: 'mode', item };
    if (kind === 'g' && ['anima', 'community', 'market', 'library', 'projects', 'workspace', 'inbox', 'settings', 'places'].includes(id)) return { view: 'global', mode: m, global: id, zoneOf: 'mode', item };
    return { view: 'mode', mode: m };
  }
  let applyingHash = false;
  function syncHash(replace) {
    const h = stateToHash(); if (location.hash.split('?')[0] === h) return;   // same place: keep its ?sel= (§7bb)
    try { replace ? history.replaceState(null, '', h) : history.pushState(null, '', h); } catch { location.hash = h; }
  }
  // the selection on a page lives in its URL as ?sel=a,b (§7bb) — replaced, never pushed: selecting adds no Back step
  const SELCODEC = window.XENO_SEL_CORE;   // the address codec lives in select-core.js, tested without a browser
  window.XENO_URLSEL = {
    get: () => { const v = SELCODEC.selRaw(location.hash.split('?')[1] || ''); return v ? SELCODEC.parseSel(v) : []; },
    set: (ids) => { const base = location.hash.split('?')[0] || '#/'; const next = ids && ids.length ? `${base}?sel=${SELCODEC.formatSel(ids)}` : base; if (next === location.hash) return; try { history.replaceState(history.state, '', next); } catch {} },
  };
  addEventListener('popstate', () => { const st = hashToState(location.hash); if (!st) return; applyingHash = true; go(st.view, st); applyingHash = false; });
  // ---- (2) return to where you were, per mode ----
  const lastPlace = store.get('last', {});
  // Adaptive is its own context (ctxKey 'adaptive'), never a place inside Overview or a mode —
  // remembering it there made choosing Overview (or that mode) land back in Adaptive
  for (const k of Object.keys(lastPlace)) if (lastPlace[k] && lastPlace[k].view === 'adaptive') delete lastPlace[k];
  function rememberPlace() {
    if (S.view === 'adaptive') return;
    const key = inOv() ? 'overview' : S.mode;
    if (S.view === 'mode' || S.view === 'dashboard') { delete lastPlace[key]; } else lastPlace[key] = { view: S.view, product: S.product, zone: S.zone, global: S.global, zoneOf: S.zoneOf, item: S.item };
    store.set('last', lastPlace);
  }
  const panelMem = store.get('panelMem', {});
  const panelKey = () => stateToHash();
  function savePanelMem() { const pb = $('#panel > .pv .pbody'); if (!pb) return; panelMem[panelKey()] = { scroll: pb.scrollTop, closed: [...document.querySelectorAll('#panel > .pv .sec.closed')].map((s) => s.dataset.sec) }; store.set('panelMem', panelMem); }
  function restorePanelMem(pv) { const m = panelMem[panelKey()]; if (!m || !pv) return; m.closed.forEach((k) => pv.querySelector(`.sec[data-sec="${CSS.escape(k)}"]`)?.classList.add('closed')); const pb = pv.querySelector('.pbody'); if (pb) pb.scrollTop = m.scroll || 0; }
  // the chat moved to another conversation by itself: the address follows, in place (the chat owns that history entry)
  function setChatItem(item) {
    if (S.view !== 'product' || S.product !== 'chat' || (S.item || null) === (item || null)) return;
    S.item = item || null; const c = $('#main .crumbs'); if (c) c.innerHTML = crumbs();
    rememberPlace(); syncHash(true);
  }
  function go(view, extra = {}) {
    savePanelMem();
    // the context is sticky: only going home to a mode or to Overview changes it
    // the context you are IN carries over (a restored Overview has view 'dashboard' and no zoneOf yet)
    const wasOv = inOv();
    if (view === 'dashboard') S.zoneOf = 'overview'; else if (view === 'mode') S.zoneOf = 'mode'; else if (extra.zoneOf === undefined) S.zoneOf = wasOv ? 'overview' : (S.zoneOf || 'mode');
    if (!('item' in extra)) S.item = null;
    if (view !== 'zone') S._ovArrived = null;   // leaving an area makes the next visit a new arrival
    if (S.switching) closeSwitcher(false);
    const pk = () => `${ctxKey()}|${S.view}|${S.view === 'product' ? S.product : ''}|${S.view === 'zone' ? S.zone : ''}|${S.view === 'global' ? S.global : ''}`;
    const pk0 = pk();
    Object.assign(S, { view }, extra);
    if (view === 'adaptive' && AD.on()) { store.set('adUndo', store.get('adOrder', null)); adRecompute(); }
    if (view === 'product') adTrack(S.product);
    if (root.dataset.panel === 'closed' && extra.openPanel) setPanel('open');
    S._softPanel = pk0 === pk() && !S.switching;
    // an in-app place change is announced before the new place renders, so a selection made in the old place is let go (F-02)
    if (!applyingHash && location.hash.split('?')[0] !== stateToHash()) window.dispatchEvent(new Event('xeno:place'));
    render(); hidePops();
    markItems(); setTimeout(() => markItems(), 140);
    if (view === 'adaptive') setTimeout(adMorph, 160);
    maybeModeIntro();
    rememberPlace();
    if (!applyingHash) syncHash(false);
  }
  // a product opens INSIDE the current context (mode is a lens) — it never switches the mode
  const openProduct = (id) => go('product', { product: id });
  const openMode = (id) => {
    const last = lastPlace[id];
    if (id === 'overview') { if (last && (last.view !== 'zone' || zonesFor('overview').some((z) => z.id === last.zone))) go(last.view, { ...last, zoneOf: 'overview' }); else go('dashboard'); toast('Overview'); return; }
    if (last && (last.view !== 'zone' || zonesFor(id).some((z) => z.id === last.zone))) go(last.view, { ...last, mode: id, zoneOf: 'mode' }); else go('mode', { mode: id });
    toast(`${M[id].name} mode`);
  };
  const goModeHome = () => go(inOv() ? 'dashboard' : 'mode');

  // ---- the logo: left click cycles the modes, right click opens the switcher ----
  function cycleMode() {
    const hid = hiddenModes(); const order = modeOrder().filter((id) => !hid.has(id));
    const cur = S.view === 'dashboard' ? 'overview' : S.mode;
    if (!order.includes(cur)) order.unshift(cur);
    const next = order[(order.indexOf(cur) + 1) % order.length];
    gridMorph(cur === 'overview' ? 'xeno' : cur, next === 'overview' ? 'xeno' : next, () => {
      openMode(next);
    });
  }
  // "1f Grid" — the mark morphs into four tiles and back (Xeno Mark Motion study, suite switching)
  const GA = [[475.75,222.25],[302.75,49.25],[80.75,49.25],[21.25,108.75],[21.25,332.25],[352.75,663.75],[475.75,540.75],[231.25,296.25],[195.64,260.64],[209.72,254.75],[221.25,254.75],[443.25,254.75]];
  const GB = [[511,21.25],[300,21.25],[80.75,21.25],[21.25,80.75],[21.25,300],[21.25,511],[511,511],[511,420],[511,330],[511,240],[511,150],[511,80]];
  const gIo = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const gPath = (m) => { const p = GA.map((v, k) => (v[0] + (GB[k][0] - v[0]) * m).toFixed(2) + ' ' + (v[1] + (GB[k][1] - v[1]) * m).toFixed(2));
    return `M ${p[0]} L ${p[1]} L ${p[2]} A 59.5 59.5 0 0 0 ${p[3]} L ${p[4]} L ${p[5]} L ${p[6]} L ${p[7]} C ${p[8]} ${p[9]} ${p[10]} L ${p[11]} Z`; };
  let morphing = false;
  // a wavy front in the tile's 100u space, in a frame rotated so the sweep runs along +x.
  // Returns the region BEHIND the front (x < front), as a closed path.
  const behind = (X, A, k, ph) => { let d = 'M -120 -120'; const n = 40;
    for (let j = 0; j <= n; j++) { const y = -120 + (j / n) * 340, x = X + A * Math.sin(k * y / 40 + ph) + A * 0.4 * Math.sin((k + 2.3) * y / 40 - ph * 1.6);
      d += ' L ' + x.toFixed(2) + ' ' + y.toFixed(2); }
    return d + ' L -120 220 Z'; };
  const band = (X, W, A, k, ph) => { const n = 40; let f = '', b = '';
    for (let j = 0; j <= n; j++) { const y = -120 + (j / n) * 340, w = A * Math.sin(k * y / 40 + ph) + A * 0.4 * Math.sin((k + 2.3) * y / 40 - ph * 1.6);
      f += (j ? ' L ' : 'M ') + (X + w).toFixed(2) + ' ' + y.toFixed(2); b = ' L ' + (X - W + w * 0.6).toFixed(2) + ' ' + y.toFixed(2) + b; }
    return f + b + ' Z'; };
  function gridMorph(fromId, toId, done) {
    const logo = document.getElementById('logo');
    if (morphing || !logo || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    morphing = true;
    const mk = logo.querySelector('.mk'); if (mk) mk.style.visibility = 'hidden';
    const uid = 'gm' + Date.now(), TILE = 'M 6 0 L 100 0 L 100 84 L 84 100 L 0 100 L 0 6 A 6 6 0 0 1 6 0 Z';
    const arms = (attr) => [0, 1, 2, 3].map((i) => `<path ${attr} transform="rotate(${90 * i} 541 541)"/>`).join('');
    const box = document.createElement('span'); box.className = 'mk morph';
    box.innerHTML = `<svg viewBox="-1 -1 102 102"><defs>
        <clipPath id="${uid}-badge"><path d="${TILE}"/></clipPath>
        <clipPath id="${uid}-wake"><path data-wake transform="rotate(-45 50 50)"/></clipPath>
      </defs>
      <path d="${TILE}" fill="#0B0B0B" stroke="#2E2E2E" stroke-width="1"/>
      <g data-mk transform="translate(15.650625 15.650625) scale(0.0635)"><g data-old>${arms('data-a')}</g></g>
      <g clip-path="url(#${uid}-wake)"><g data-mk transform="translate(15.650625 15.650625) scale(0.0635)"><g data-new>${arms('data-b')}</g></g></g>
      <g clip-path="url(#${uid}-badge)" data-fluid><g transform="rotate(-45 50 50)">
        <path data-l="0" opacity=".16"/><path data-l="1" opacity=".3"/><path data-l="2" opacity=".5"/>
      </g></g></svg>`;
    logo.appendChild(box);
    const A1 = box.querySelectorAll('[data-a]'), B1 = box.querySelectorAll('[data-b]'), mks = box.querySelectorAll('[data-mk]');
    const wake = box.querySelector('[data-wake]'), layers = box.querySelectorAll('[data-l]');
    const from = M[fromId].color, to = M[toId].color;
    A1.forEach((p) => p.setAttribute('fill', from)); B1.forEach((p) => p.setAttribute('fill', to)); layers.forEach((p) => p.setAttribute('fill', to));
    // ms: morph to tiles 0-280 · sweep 280-1060 · hold -1120 · morph back 1120-1420
    const T = 1420, t0 = performance.now(); let swapped = false;
    const START = -60, END = 175;   // front travels from outside one corner to past the opposite one (rotated frame spans ~ -21..121)
    const frame = (now) => {
      const ms = now - t0, host = document.getElementById('logo');
      if (host && !host.contains(box)) { const nm = host.querySelector('.mk'); if (nm) nm.style.visibility = 'hidden'; host.appendChild(box); }
      const m = ms < 280 ? gIo(ms / 280) : ms < 1120 ? 1 : 1 - gIo(Math.min(1, (ms - 1120) / 300));
      const d = gPath(m);
      A1.forEach((p) => p.setAttribute('d', d)); B1.forEach((p) => p.setAttribute('d', d));
      mks.forEach((g) => g.setAttribute('transform', `translate(15.650625 15.650625) scale(0.0635) rotate(${(-2.29 * m).toFixed(3)} 541 541)`));
      const p = Math.max(0, Math.min(1, (ms - 280) / 780));
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;   // in-out: gathers, flows, slows out
      const X = START + (END - START) * ease, ph = ms / 110, calm = 1 - 0.5 * ease;
      // the wake (tiles stained behind the slowest, solid layer)
      wake.setAttribute('d', behind(X - 10, 5.5 * calm, 3.1, ph));
      // three fluid layers riding ahead of the wake, over tiles AND gaps, clipped to the badge
      layers[0].setAttribute('d', band(X + 14, 26, 7 * calm, 2.4, ph * 1.15 + 1.3));
      layers[1].setAttribute('d', band(X + 5, 18, 6 * calm, 2.8, ph * 1.05 + 0.6));
      layers[2].setAttribute('d', band(X - 4, 11, 5.5 * calm, 3.1, ph));
      box.querySelector('[data-fluid]').style.opacity = ms < 280 || ms > 1080 ? '0' : '1';
      if (ms >= 1060 && !swapped) { swapped = true; done(); }
      if (ms < T) requestAnimationFrame(frame);
      else { const h = document.getElementById('logo'); h?.querySelector('.mk:not(.morph)')?.style.removeProperty('visibility'); box.remove(); morphing = false; }
    };
    requestAnimationFrame(frame);
  }
  // ---- mode switcher ----
  // ---- account: who you are, which workspace you are in, then the account itself ----
  // Benchmarked against Linear/Notion/Slack switchers: identity first, workspaces as the main choice
  // (current one marked, the rest one click away), account links after, sign-out kept apart at the end.
  function openAccount() {
    const ws = store.get('workspace', 'personal'), left = usageLeft();
    const W = window.XA.workspaces().map((w) => [w.id, w.name, w.sub, w.initial]);   // the ONE workspace list (actions.js)
    const links = [['settings', 'gear', 'Settings', '<kbd>Ctrl ,</kbd>'], ['plan', 'star', 'Plan & credits', `<span class="acc-meta">${left == null ? '' : fmt(left) + ' credits'}</span>`], ['accounts', 'flow', 'Connected accounts', '<span class="acc-meta">3</span>'], ['apps', 'download', 'Get the apps', '']];
    const m = railPopOpen('account', 'accm', `<header class="pl acc-id">
        <span class="acc-av">E</span>
        <span class="acc-who"><b>${window.XENO_ME.nameHtml()}</b><small>${window.XENO_ME.emailHtml()}</small></span>
        <span class="acc-plan">Pro</span>
      </header>
      <section class="pl pl-list"><div class="pl-cap"><span>Workspaces</span><span>${W.length}</span></div>
        ${W.map(([id, n, sub, i]) => `<button class="acc-ws${id === ws ? ' on' : ''}" data-ws="${id}" data-fk="w${id}" aria-current="${id === ws}"><span class="acc-wsav">${i}</span><span class="acc-who"><b>${esc(n)}</b><small>${esc(sub)}</small></span>${id === ws ? `<span class="acc-cur">${ic('check')}</span>` : `<span class="acc-go">Switch</span>`}</button>`).join('')}
        <button class="acc-ws acc-new" data-act="company" data-fk="wnew"><span class="acc-wsav">${ic('plus')}</span><span class="acc-who"><b>Create a company</b><small>Hire people and agents, share a wallet</small></span></button>
      </section>
      <section class="pl pl-list acc-links">${links.map(([id, i, t, r]) => `<button class="acc-li" data-act="${id}" data-fk="l${id}">${ic(i)}<span>${t}</span>${r}</button>`).join('')}</section>
      <footer class="pl pl-foot acc-foot"><button class="acc-close" data-acc-close data-fk="close">Close<kbd>Esc</kbd></button><button class="acc-out" data-act="signout" data-fk="out">${ic('leave')}Sign out</button></footer>`);
    m.onclick = (e) => {
      e.stopPropagation();
      const w = e.target.closest('[data-ws]'); if (w) { if (w.dataset.ws === ws) return; hidePops(); return window.XA.switchWorkspace(w.dataset.ws); }
      if (e.target.closest('[data-acc-close]')) return closeRailPop();
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'plan') { hidePops(); return openUsage(); } // the credits line opens the Usage popover — the real thing, not a toast
      if (b.dataset.act === 'settings') { hidePops(); return window.XD.settings(); }
      hidePops(); ({ settings: () => window.XA.settings('general'), accounts: () => window.XA.settings('account'), apps: () => window.open('https://xenostudio.ai/download', '_blank', 'noopener'), company: () => window.XA.newCompany(), signout: () => window.XA.signOut() }[b.dataset.act] || (() => {}))();
    };
    popKeys(m, '.acc-ws, .acc-li, .acc-close, .acc-out');
    m.querySelector('.acc-ws.on')?.focus({ preventScroll: true });
  }
  // ── RAIL POPOVERS v3: Notifications · Help · Usage (+ the full Inbox page and the shortcut sheet) ──
  // Benchmarked against Linear/GitHub/Slack (inbox · snooze · archive · undo · grouping · act-in-place),
  // Linear/Intercom/Figma help (search first, contextual, status) and Vercel/Claude usage (range, breakdown,
  // held, alerts). Data is read stale-while-revalidate: cached value shows at once with its age, then refreshes.
  const POP = { bell: ['Notifications', 380], help: ['Help', 320], usage: ['Usage', 320], account: ['Account', 300] };
  const MICRO = 1e6, fmt = (n) => Math.round(n).toLocaleString('en-US');
  const feat = (f) => f.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); // same labeller as /overview/usage-analytics
  window.__xw = window.__xw || { fail: null };
  const popOwner = () => { const m = $('#menu'); return m.classList.contains('on') ? m.dataset.owner || '' : ''; };
  const railBtn = (o) => document.querySelector(`#rail [data-go="${o}"]`);
  const iconBtn = (attr, icon, tip) => `<button class="pp-ib" ${attr} data-tip="${esc(tip)}" aria-label="${esc(tip)}">${ic(icon)}</button>`;
  const agoTxt = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

  // screen readers hear what changed without focus moving
  function announce(msg) { let r = document.getElementById('xw-live'); if (!r) { r = document.createElement('div'); r.id = 'xw-live'; r.className = 'sr-only'; r.setAttribute('aria-live', 'polite'); document.body.appendChild(r); } r.textContent = ''; setTimeout(() => { r.textContent = msg; }, 40); }
  // undo for anything done from a list (Gmail/Linear): a toast with the action, Ctrl Z while it is up
  // one undo/redo history for every area — history.js (§7v); this name stays so existing call sites need no change
  function undoToast(msg, fn) { window.XENO_HIST.record(msg, fn); announce(msg); }

  // ---- data: one cache, stale-while-revalidate, each source names where it will come from ----
  const SRC = {
    // notifications: no platform API yet (needs one — see the report); sample shaped like a feed
    notes: () => [
      ...(window.XENO_NEEDS || []).map((n, i) => ({ id: 'n' + i, t: n.t, m: n.m, p: n.p, kind: n.kind, act: n.meta, at: Date.now() - [2, 18, 60, 64, 180][i] * 60000, g: 'needs', mention: n.kind === 'question' })),
      { id: 'a1', t: 'Atlas finished a research brief', m: 'dev', p: 'agent', actor: 'Atlas', at: Date.now() - 4 * 60000, g: 'act' },
      { id: 'a2', t: 'Atlas updated the migration plan', m: 'dev', p: 'agent', actor: 'Atlas', at: Date.now() - 26 * 60000, g: 'act' },
      { id: 'a3', t: 'Atlas opened PR #412', m: 'dev', p: 'agent', actor: 'Atlas', at: Date.now() - 52 * 60000, g: 'act' },
      { id: 'a4', t: 'Nightly asset sync ran', m: 'tools', p: 'workflow', at: Date.now() - 2 * 3600000, g: 'act' },
      { id: 'a7', t: 'Weekly usage report sent', m: 'tools', p: 'workflow', at: Date.now() - 5 * 3600000, g: 'act' },
      { id: 'a5', t: '3 posts scheduled', m: 'social', p: 'post', at: Date.now() - 3 * 3600000, g: 'act' },
      { id: 'a6', t: 'Invoice paid', m: 'corpo', p: 'company', at: Date.now() - 26 * 3600000, g: 'act' },
    ],
    // usage: GET /api/v2/ledger/balance + GET /api/v2/ledger/usage?from&to&groupBy=surface|model + the page's Activity Feed
    usage: () => ({
      availableMicro: 2480e6, postedMicro: 2540e6, frozen: false,
      held: [['Launch trailer v3 — 4K render', 'Motion', 40], ['Atlas — migration plan', 'Agent', 20]],
      by: {
        surface: [['xeno_agent', 1180e6, 212], ['motion', 760e6, 38], ['xeno_api', 390e6, 941], ['xeno_post', 190e6, 93]],
        model: [['claude-opus-5-5', 1240e6, 188], ['gpt-5.5', 610e6, 402], ['grok-4.3', 380e6, 571], ['veo-3', 290e6, 123]],
      },
      activity: [['agent_run', 42, Date.now() - 9 * 60000], ['image_generation', 8, Date.now() - 24 * 60000], ['chat_completion', 3, Date.now() - 31 * 60000]],
    }),
  };
  const DS = {};
  // Loading placeholders are the REAL component rendered from placeholder records (the backend's last
  // known count and shape; sample records here) and drawn as shapes — so arriving data replaces the
  // shapes in place and nothing moves or resizes. Never a generic grey block (MODES SPEC §7d).
  const PH = { notes: () => SRC.notes(), usage: () => SRC.usage() };
  function ghosted(key, fn) { const d = (DS[key] = DS[key] || {}), had = d.val; d.val = PH[key](); try { return `<div class="ph-shape" aria-busy="true" aria-label="Loading">${fn()}</div>`; } finally { d.val = had; } }
  const notesReady = () => !!(DS.notes && DS.notes.val);
  function load(key) {
    const d = (DS[key] = DS[key] || {}); if (d.loading) return d.loading;
    d.loading = new Promise((res, rej) => setTimeout(() => (window.__xw.fail === key ? rej(new Error('offline')) : res(SRC[key]())), window.__xwLatency ?? 420))   // __xwLatency: QA hook to simulate a slow network
      .then((v) => { if (key === 'notes' && d.val) { const extra = d.val.filter((x) => x.live && !v.some((y) => y.id === x.id)); v = [...extra, ...v]; } d.val = v; d.at = Date.now(); d.err = null; }, (e) => { d.err = e; })
      .finally(() => { d.loading = null; dataChanged(key); });
    dataChanged(key); return d.loading;
  }
  const data = (key, maxAge = 30000) => { const d = DS[key] || {}; if (!d.loading && (!d.val || Date.now() - d.at > maxAge) && !d.err) load(key); return DS[key] || {}; };
  function dataChanged(key) {
    const o = popOwner();
    if (key === 'usage' && o === 'usage') openUsage(true);
    if (key === 'notes' && o === 'bell') openBell(true);
    if (key === 'notes' && S.view === 'global' && S.global === 'inbox') paintInboxPage();
    if (key === 'notes' && !S.item && (S.view === 'mode' || S.view === 'dashboard')) { const mv = $('#main .mview'); if (mv) { const top = mv.scrollTop; mv.innerHTML = S.view === 'mode' ? mainMode() : mainDashboard(); mv.scrollTop = top; const t = document.createElement('template'); t.innerHTML = mainHTML(); const nf = t.content.querySelector('.mfoot'); if (nf) $('#main .mfoot')?.replaceWith(nf); } }   // homes read the inbox, so they refresh with it — body and status bar
    syncBell(); syncUsage();
  }
  // a header line that says how old the numbers are, and offers a retry when the refresh failed
  const freshLine = (key) => { const d = DS[key] || {}; return d.loading ? (d.at ? `<span class="pl-fresh is-updating" data-at="${d.at}" aria-live="polite">Updated ${agoTxt(d.at)}</span>` : '<span class="pl-fresh ghost-p" aria-busy="true">Updated just now</span>') : d.err ? `<button class="pl-fresh err" data-retry="${key}">Couldn't refresh · Retry</button>` : d.at ? `<span class="pl-fresh" data-at="${d.at}">Updated ${agoTxt(d.at)}</span>` : ''; };
  setInterval(() => document.querySelectorAll('.pl-fresh[data-at]').forEach((n) => { n.textContent = 'Updated ' + agoTxt(+n.dataset.at); }), 10000);
  const skeleton = (rows) => `<section class="pl pl-skel" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, (_, i) => `<i style="width:${[78, 54, 66, 42][i % 4]}%"></i>`).join('')}</section>`;
  const errorPlate = (key, what) => `<section class="pl pp-empty pl-error">${ic('x')}<b>Couldn't load ${what}</b><small>Check your connection and try again.</small><button class="us-ghost" data-retry="${key}">Retry</button></section>`;

  // ---- the popover shell: dialog semantics, focus in, focus trapped, focus back to the rail button ----
  const segMemo = (root) => { const o = {}; root.querySelectorAll('[data-seg]').forEach((s) => { o[s.dataset.seg] = s.style.getPropertyValue('--i'); }); return o; };
  const segSlide = (root, memo) => root.querySelectorAll('[data-seg]').forEach((s) => { const was = memo[s.dataset.seg], now = s.style.getPropertyValue('--i'); if (was === undefined || was === '' || was === now) return; s.style.setProperty('--i', was); s.classList.add('seg-noanim'); void s.offsetWidth; s.classList.remove('seg-noanim'); requestAnimationFrame(() => s.style.setProperty('--i', now)); });
  function railPopOpen(owner, cls, html, keep) {
    const segs = keep ? segMemo($('#menu')) : {};
    const m = $('#menu'), fk = keep && m.contains(document.activeElement) ? document.activeElement.dataset.fk : null, sc = keep ? m.querySelector('.pl-stack')?.scrollTop : 0;
    if (!keep || popOwner() !== owner) hidePops();
    m.innerHTML = html; m.dataset.owner = owner; m.classList.add('on', 'acc', 'rp', cls);
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'false'); m.setAttribute('aria-label', POP[owner][0]);
    const b = railBtn(owner); if (b) { b.setAttribute('aria-expanded', 'true'); b.setAttribute('aria-haspopup', 'dialog'); }
    placeRailPop(m); segSlide(m, segs);
    if (keep) { const st = m.querySelector('.pl-stack'); if (st) st.scrollTop = sc || 0; if (fk) m.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true }); }
    return m;
  }
  function closeRailPop() { const o = popOwner(); hidePops(); if (o) railBtn(o)?.focus(); }
  const focusables = (root) => [...root.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')].filter((n) => n.offsetParent !== null);
  function popKeys(m, sel, onKey) {
    m.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeRailPop(); }
      if (e.key === 'Tab') { const f = focusables(m); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } return; }
      const r = [...m.querySelectorAll(sel)], i = r.indexOf(document.activeElement.closest(sel));
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.closest('input')) { e.preventDefault(); r[e.key === 'ArrowDown' ? Math.min(i + 1, r.length - 1) : Math.max(i - 1, 0)]?.focus(); return; }
      if (onKey) onKey(e, r[i]);
    };
  }

  // ---- notifications: model ----
  const NS = () => ({ read: new Set(store.get('readN', []) || []), arch: new Set(store.get('archN', []) || []), snooze: store.get('snoozeN', {}) || {}, done: store.get('doneN', {}) || {}, prefs: store.get('ntPrefs', { desktop: false, digest: 'daily', muted: [] }) });
  // per-area notification level (§7z): all = everything · needs = only what needs you (activity leaves the inbox) ·
  // off = nothing rings either. One store (ntPrefs.levels); the old muted list is kept in step for anything reading it.
  const NT_LEVELS = [['all', 'Everything'], ['needs', 'Needs me'], ['off', 'Off']];
  const ntLevel = (st, m) => st.prefs.levels?.[m] || (st.prefs.muted.includes(m) ? 'off' : 'all');
  function ntSetLevel(m, lv) { const st = NS(); const was = ntLevel(st, m); if (was === lv) return; st.prefs.levels = { ...(st.prefs.levels || {}), [m]: lv }; st.prefs.muted = MODES.map((x) => x.id).filter((id) => ntLevel(st, id) === 'off'); ntSave('ntPrefs', st.prefs); syncBell(); window.XENO_HIST?.record(`${M[m]?.name || m} notifications: ${NT_LEVELS.find((x) => x[0] === lv)[1]}`, null); }
  const ntSave = (k, v) => store.set(k, k === 'snoozeN' || k === 'doneN' || k === 'ntPrefs' ? v : [...v]);
  const ntAll = () => (DS.notes && DS.notes.val) || [];
  const viewOf = (n, st) => (st.arch.has(n.id) ? 'archive' : st.snooze[n.id] ? 'snoozed' : 'inbox');
  const isUnread = (n, st) => n.g === 'needs' && !st.read.has(n.id) && viewOf(n, st) === 'inbox';
  function ntFiltered(view, filter) {
    const st = NS();
    return ntAll().filter((n) => viewOf(n, st) === view && !(n.g === 'act' && ntLevel(st, n.m) !== 'all') && (filter === 'all' || (filter === 'mentions' ? n.mention : n.m === filter)));
  }
  const INLINE = { permission: 'Approved', handoff: 'Accepted' }; // these complete in place; the rest open their item
  // A row is two lines and three zones (Vercel/Linear inbox): WHAT on top with WHEN at the right edge,
  // WHERE below with the one ACTION at the right edge. Hover swaps the time for snooze/archive, so the
  // controls never compete with the text for width.
  function ntRow(n, st, view) {
    const un = isUnread(n, st), p = PR[n.p], done = st.done[n.id], snoozing = S.ntSnoozeOpen === n.id, muted = ntLevel(st, n.m) === 'off';
    const tools = view === 'snoozed' ? iconBtn(`data-nt-unsnooze data-fk="u${n.id}"`, 'reset', 'Back to inbox')
      : view === 'archive' ? iconBtn(`data-nt-arch data-fk="r${n.id}"`, 'reset', 'Move to inbox')
        : done ? '' : `${iconBtn(`data-nt-snz data-fk="s${n.id}"`, 'clock', 'Snooze  S')}${iconBtn(`data-nt-arch data-fk="a${n.id}"`, 'archive', 'Archive  E')}`;
    const action = view === 'snoozed' ? `<span class="nt2-wake">${ic('clock')}${esc(st.snooze[n.id])}</span>`
      : view === 'archive' ? ''
        : done ? `<span class="nt2-done">${ic('check')}${esc(done)}</span>`
          : n.act ? `<button class="nt2-act${INLINE[n.kind] ? ' primary' : ''}" data-nt-do data-fk="d${n.id}">${esc(n.act)}</button>` : '';
    const chooser = snoozing ? `<div class="nt2-snz" role="group" aria-label="Snooze until" data-nt="${n.id}"><span>Snooze until</span>${[['1 hour', 'In 1 hour'], ['Tomorrow', 'Tomorrow 9:00'], ['Next week', 'Mon 9:00']].map(([l, w]) => `<button data-nt-snooze="${esc(w)}" data-fk="z${n.id}${l}">${l}</button>`).join('')}<button class="pp-ib" data-nt-snz aria-label="Cancel">${ic('x')}</button></div>` : '';
    return `<div class="nt2${un ? ' unread' : ''}${done ? ' done' : ''}${n.live ? ' arrived' : ''}" tabindex="0" role="button" data-nt="${n.id}" data-fk="n${n.id}" aria-label="${esc(n.t)}${un ? ', unread' : ''}">
      <span class="nt2-mark"></span><span class="nt2-ic">${p ? pIconFull(p, 18) : ic('bell')}</span>
      <span class="nt2-main">
        <span class="nt2-top"><b title="${esc(n.t)}">${esc(n.t)}</b><time>${esc(agoShort(n.at))}</time>${tools ? `<span class="nt2-tools">${tools}</span>` : ''}</span>
        <span class="nt2-bot"><small>${n.mention ? '<em>@you</em>' : ''}${esc(M[n.m] ? M[n.m].name : '')}${muted ? ' · muted' : ''}</small>${action}</span>
      </span></div>${chooser}`;
  }
  const agoShort = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 2880 ? '1d' : `${Math.round(m / 1440)}d`; };
  // bursts from one actor collapse into one row (GitHub never did this and its inbox drowned)
  function ntGroupRows(items, st, view) {
    const out = [], seen = new Set();
    items.forEach((n) => {
      if (seen.has(n.id)) return;
      const key = ntGroupKey(n), who = n.actor || PR[n.p]?.name || n.p;
      const same = items.filter((x) => ntGroupKey(x) === key);
      if (same.length < 2) { out.push(ntRow(n, st, view)); seen.add(n.id); return; }
      same.forEach((x) => seen.add(x.id)); const open = (S.ntOpenGroups || []).includes(key);
      out.push(`<div class="nt2 nt2-grp${open ? ' open' : ''}" tabindex="0" role="button" aria-expanded="${open}" data-nt-grp="${esc(key)}" data-fk="g${esc(key)}"><span class="nt2-mark"></span><span class="nt2-ic nt2-stackic">${pIconFull(PR[n.p], 18)}<i>${same.length}</i></span>
        <span class="nt2-main"><span class="nt2-top"><b>${esc(who)}</b><time>${esc(agoShort(same[0].at))}</time></span><span class="nt2-bot"><small>${same.length} updates · latest: ${esc(same[0].t)}</small><span class="nt2-chev">${ic('chev')}</span></span></span></div>`
        + (open ? `<div class="nt2-kids">${same.map((x) => ntRow(x, st, view)).join('')}</div>` : ''));
    });
    return out.join('');
  }
  // one key for 'these belong together': a named actor, else — for activity — the product it came from (§7z).
  // The preview counts a group as one unit and keeps ALL of a chosen unit's items, wherever they fall in time;
  // cutting first and grouping after split groups and showed wrong counts.
  const ntGroupKey = (x) => x.actor || (x.g === 'act' ? 'p:' + x.p : x.id);
  const firstUnits = (items, n) => { const keys = new Set(); for (const x of items) { if (keys.size === n) break; keys.add(ntGroupKey(x)); } return items.filter((x) => keys.has(ntGroupKey(x))); };
  const ntCounts = () => { const st = NS(); return { inbox: ntAll().filter((n) => viewOf(n, st) === 'inbox').length, snoozed: ntAll().filter((n) => viewOf(n, st) === 'snoozed').length, archive: 0 }; };
  const TABS = [['inbox', 'Inbox'], ['snoozed', 'Snoozed'], ['archive', 'Archived']];
  // text tabs with a sliding underline — they ARE the header, so the popover needs no separate title row
  const ntTabs = (view) => { const c = ntCounts(), i = TABS.findIndex(([k]) => k === view); return `<div class="nt-tabs" role="tablist" aria-label="Notification views" data-seg="nt-tabs" style="--i:${i};--n:${TABS.length}">${TABS.map(([k, l]) => `<button role="tab" data-nt-tab="${k}" data-fk="t${k}" aria-selected="${view === k}">${l}${c[k] ? `<span>${c[k]}</span>` : ''}</button>`).join('')}</div>`; };
  function ntFilters(view, filter) {
    const st = NS(), modes = [...new Set(ntAll().filter((n) => viewOf(n, st) === view).map((n) => n.m))];
    return `<div class="pl pl-chips" role="group" aria-label="Filter">${[['all', 'All'], ['mentions', '@ Mentions'], ...modes.map((m) => [m, M[m] ? M[m].name : m])].map(([k, l]) => `<button data-nt-filter="${k}" data-fk="f${k}" aria-pressed="${filter === k}">${esc(l)}</button>`).join('')}</div>`;
  }
  function ntList(view, filter, compact) {
    const st = NS(), items = ntFiltered(view, filter).sort((a, b) => b.at - a.at);
    const day = (t) => (Date.now() - t < 20 * 3600000 ? 'Today' : 'Earlier');
    const groups = view === 'inbox'
      ? [['Needs you', items.filter((n) => n.g === 'needs'), true], ['Today', items.filter((n) => n.g !== 'needs' && day(n.at) === 'Today')], ['Earlier', items.filter((n) => n.g !== 'needs' && day(n.at) === 'Earlier')]]
      : [[view === 'snoozed' ? 'Snoozed' : 'Archived', items]];
    // the popover shows what needs you plus the latest few — sized to fit without scrolling; the Inbox page shows all
    let hidden = 0;
    const shown = compact && view === 'inbox'
      ? [[groups[0][0], groups[0][1].slice(0, 3), true, groups[0][1].length], ['Recent', firstUnits([...groups[1][1], ...groups[2][1]], 3), false, groups[1][1].length + groups[2][1].length]]
      : groups.map(([g, r, lead]) => [g, r, lead, r.length]);
    shown.forEach(([, r, , total]) => { hidden += total - r.length; });
    const plates = shown.filter(([, r]) => r.length).map(([g, r, lead, total], i, arr) => `<section class="pl pl-list${lead ? ' pl-lead' : ''}"><div class="pl-cap"><span>${g}</span>${lead ? `<span class="pl-count">${total}</span>` : `<span>${total}</span>`}</div>${ntGroupRows(r, st, view)}${hidden && i === arr.length - 1 ? `<button class="pl-more" data-nt-viewall data-fk="more">${hidden} more in the inbox ${ic('right')}</button>` : ''}</section>`).join('');
    const empty = {
      inbox: [filter === 'all' ? 'check' : 'inbox', filter === 'all' ? "You're all caught up" : 'Nothing here', filter === 'all' ? 'Approvals, hand-offs and finished work land here.' : 'No notifications match this filter.'],
      snoozed: ['clock', 'Nothing snoozed', 'Snoozed notifications come back to your inbox when they are due.'],
      archive: ['archive', 'Nothing archived', 'Archive a notification once it is handled. It stays here, searchable.'],
    }[view];
    return `<div class="pl-stack">${plates || `<section class="pl pp-empty"><span class="pp-empty-ic">${ic(empty[0])}</span><b>${empty[1]}</b><small>${empty[2]}</small></section>`}</div>`;
  }
  // the Inbox page keeps tabs + filters in a plate of their own
  const ntBody = (view, filter) => `<div class="pl pl-nav">${ntTabs(view)}</div>${ntFilters(view, filter)}${ntList(view, filter, false)}`;
  function ntSettings() {
    const st = NS(), p = st.prefs;
    return `<header class="pl pl-head">${iconBtn('data-nt-back data-fk="back"', 'back', 'Back to notifications')}<b>Notification settings</b></header>
      <div class="pl-stack">
        <section class="pl pl-list"><div class="pl-cap"><span>Delivery</span></div>
          <button class="us-toggle" role="switch" aria-checked="${p.desktop}" data-nt-pref="desktop" data-fk="pd"><span class="hp-t">Desktop notifications<small>Shown by your operating system when XENO is in the background</small></span><span class="sw"><i></i></span></button>
          <div class="nt-seg-row"><span class="hp-t">Email digest<small>A summary of what you missed</small></span><div class="pl-seg" role="radiogroup" aria-label="Email digest">${['off', 'daily', 'weekly'].map((k) => `<button role="radio" aria-checked="${p.digest === k}" data-nt-digest="${k}" data-fk="dg${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
        </section>
        <section class="pl pl-list"><div class="pl-cap"><span>Modes</span><span>What each mode tells you about</span></div>
          ${MODES.map((m) => { const lv = ntLevel(NS(), m.id); return `<div class="nt-seg-row"><span class="hp-t">${esc(M[m.id].name)}</span><div class="pl-seg" role="radiogroup" aria-label="${esc(M[m.id].name)} notifications">${NT_LEVELS.map(([k, l]) => `<button role="radio" aria-checked="${lv === k}" data-nt-level="${m.id}:${k}" data-fk="lv${m.id}${k}">${l}</button>`).join('')}</div></div>`; }).join('')}
        </section>
      </div>`;
  }

  // ---- notifications: actions, shared by the popover and the Inbox page ----
  function ntAct(e, repaint) {
    const st = NS();
    const tb = e.target.closest('[data-nt-tab]'); if (tb) { S.ntTab = tb.dataset.ntTab; S.ntSnoozeOpen = null; return repaint(); }
    const fl = e.target.closest('[data-nt-filter]'); if (fl) { S.ntFilter = fl.dataset.ntFilter; return repaint(); }
    if (e.target.closest('[data-nt-ftog]')) { S.ntFilterOpen = !(S.ntFilterOpen || (S.ntFilter && S.ntFilter !== 'all')); if (!S.ntFilterOpen) S.ntFilter = 'all'; return repaint(); }
    const rt = e.target.closest('[data-retry]'); if (rt) { DS[rt.dataset.retry] && (DS[rt.dataset.retry].err = null); load(rt.dataset.retry); return; }
    if (e.target.closest('[data-nt-all]')) return markAllRead(repaint);
    if (e.target.closest('[data-nt-set]')) { S.ntSettings = true; return repaint(); }
    if (e.target.closest('[data-nt-back]')) { S.ntSettings = false; return repaint(); }
    const pf = e.target.closest('[data-nt-pref]'); if (pf) { st.prefs[pf.dataset.ntPref] = !st.prefs[pf.dataset.ntPref]; ntSave('ntPrefs', st.prefs); return repaint(); }
    const dg = e.target.closest('[data-nt-digest]'); if (dg) { st.prefs.digest = dg.dataset.ntDigest; ntSave('ntPrefs', st.prefs); return repaint(); }
    const lvb = e.target.closest('[data-nt-level]'); if (lvb) { const [m, lv] = lvb.dataset.ntLevel.split(':'); ntSetLevel(m, lv); return repaint(); }
    if (e.target.closest('[data-nt-viewall]')) { hidePops(); return go('global', { global: 'inbox', item: null }); }
    const gr = e.target.closest('[data-nt-grp]'); if (gr) { const a = new Set(S.ntOpenGroups || []); a.has(gr.dataset.ntGrp) ? a.delete(gr.dataset.ntGrp) : a.add(gr.dataset.ntGrp); S.ntOpenGroups = [...a]; return repaint(); }
    const row = e.target.closest('[data-nt]'); if (!row) return;
    const n = ntAll().find((x) => x.id === row.dataset.nt); if (!n) return;
    if (e.target.closest('[data-nt-snz]')) { S.ntSnoozeOpen = S.ntSnoozeOpen === n.id ? null : n.id; return repaint(); }
    const sz = e.target.closest('[data-nt-snooze]'); if (sz) { st.snooze[n.id] = sz.dataset.ntSnooze; ntSave('snoozeN', st.snooze); S.ntSnoozeOpen = null; syncBell(); repaint(); return undoToast(`Snoozed until ${sz.dataset.ntSnooze}`, () => { const s = NS().snooze; delete s[n.id]; ntSave('snoozeN', s); syncBell(); repaint(); }); }
    if (e.target.closest('[data-nt-unsnooze]')) { delete st.snooze[n.id]; ntSave('snoozeN', st.snooze); syncBell(); return repaint(); }
    if (e.target.closest('[data-nt-arch]')) return ntArchive(n, repaint);
    if (e.target.closest('[data-nt-do]') && INLINE[n.kind]) return ntInline(n, repaint);
    ntOpen(n);
  }
  function markAllRead(repaint) { const st = NS(), ids = ntAll().filter((n) => isUnread(n, st)).map((n) => n.id); if (!ids.length) return toast('Nothing unread'); ids.forEach((i) => st.read.add(i)); ntSave('readN', st.read); syncBell(); repaint(); undoToast(`Marked ${ids.length} as read`, () => { const r = NS().read; ids.forEach((i) => r.delete(i)); ntSave('readN', r); syncBell(); repaint(); }); }
  // the Inbox page's sidebar primary action is the same command
  document.addEventListener('click', (e) => { if (S.view === 'global' && S.global === 'inbox' && e.target.closest('#panel .act.primary')) { e.stopPropagation(); markAllRead(paintInboxPage); } }, true);
  function ntArchive(n, repaint) {
    const st = NS(), was = st.arch.has(n.id); was ? st.arch.delete(n.id) : st.arch.add(n.id); st.read.add(n.id);
    ntSave('archN', st.arch); ntSave('readN', st.read); syncBell(); repaint();
    if (!was) undoToast('Archived', () => { const a = NS().arch; a.delete(n.id); ntSave('archN', a); syncBell(); repaint(); });
  }
  // act in place, optimistically: the row shows the result at once, rolls back if the server refuses
  function ntInline(n, repaint) {
    const st = NS(), label = INLINE[n.kind]; st.done[n.id] = label; st.read.add(n.id); ntSave('doneN', st.done); ntSave('readN', st.read); syncBell(); repaint();
    setTimeout(() => {
      if (window.__xw.fail === 'action') { const d = NS().done; delete d[n.id]; ntSave('doneN', d); repaint(); toast(`Couldn't ${n.act.toLowerCase()} — nothing changed. Try again.`); announce(`${n.act} failed`); return; }
      const s = NS(); s.arch.add(n.id); ntSave('archN', s.arch); syncBell(); repaint();
      undoToast(`${label}: ${n.t}`, () => { const x = NS(); delete x.done[n.id]; x.arch.delete(n.id); ntSave('doneN', x.done); ntSave('archN', x.arch); syncBell(); repaint(); });
    }, 700);
  }
  function ntOpen(n) { const st = NS(); st.read.add(n.id); ntSave('readN', st.read); syncBell(); hidePops(); go('product', { product: n.p, item: n.t }); }
  function ntKey(e, el, repaint) {
    if (!el || !el.dataset.nt) { if (el && el.dataset.ntGrp && e.key === 'Enter') { e.preventDefault(); el.click(); } return; }
    const n = ntAll().find((x) => x.id === el.dataset.nt); if (!n) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter' && e.target === el) { e.preventDefault(); return ntOpen(n); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'e') { e.preventDefault(); const list = [...el.closest('.rp, .rp-page').querySelectorAll('.nt2')], i = list.indexOf(el); ntArchive(n, repaint); const nl = document.querySelectorAll('.rp .nt2, .rp-page .nt2'); (nl[i] || nl[i - 1])?.focus(); }
    if (k === 's') { e.preventDefault(); S.ntSnoozeOpen = n.id; repaint(); document.querySelector(`[data-nt-snooze][data-fk^="z${n.id}"]`)?.focus(); }
  }

  // ---- notifications: the popover ----
  function openBell(keep) {
    const d = data('notes'), view = S.ntTab || 'inbox', filter = S.ntFilter || 'all';
    if (S.ntSettings) { const m = railPopOpen('bell', 'ntm', ntSettings(), keep); m.onclick = (e) => { e.stopPropagation(); ntAct(e, () => openBell(true)); }; popKeys(m, '.us-toggle, .pl-seg button'); if (!keep) m.querySelector('[data-nt-back]')?.focus({ preventScroll: true }); return; }
    const st = NS(), unread = (d.val ? ntAll() : d.err ? [] : PH.notes()).filter((n) => isUnread(n, st)).length, fOpen = !!S.ntFilterOpen || filter !== 'all';
    const body = d.val ? `${fOpen ? ntFilters(view, filter) : ''}${ntList(view, filter, true)}` : d.err ? errorPlate('notes', 'notifications') : ghosted('notes', () => ntList(view, filter, true));
    const m = railPopOpen('bell', 'ntm', `<header class="pl pl-head nt-head">${d.val ? ntTabs(view) : ghosted('notes', () => ntTabs(view))}<span class="pp-tools">${iconBtn(`data-nt-ftog data-fk="ftog" aria-pressed="${fOpen}"`, 'sliders', filter !== 'all' ? 'Filter · on' : 'Filter')}${unread ? iconBtn('data-nt-all data-fk="all"', 'check', 'Mark all read') : ''}${iconBtn('data-nt-set data-fk="set"', 'gear', 'Notification settings')}</span></header>
      ${body}
      <footer class="pl pl-foot">${freshLine('notes')}<button class="pl-link" data-nt-viewall data-fk="all-page">Open inbox ${ic('right')}</button></footer>`, keep);
    m.onclick = (e) => { e.stopPropagation(); ntAct(e, () => openBell(true)); };
    popKeys(m, '.nt2', (e, el) => ntKey(e, el, () => openBell(true)));
    if (!keep) (m.querySelector('.nt2') || m.querySelector('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
  }
  window.XENO_NT = { levels: NT_LEVELS, level: (m) => ntLevel(NS(), m), setLevel: ntSetLevel, modes: () => MODES.map((m) => [m.id, M[m.id].name]) };
  // the bell rings only for unread inbox items in areas that are not off
  function syncBell() {
    const st = NS(), un = ntAll().filter((n) => isUnread(n, st) && ntLevel(st, n.m) !== 'off').length;
    const bt = railBtn('bell'); const bd = bt?.querySelector('.badge'); if (bd) bd.style.display = un ? '' : 'none';
    if (bt) { bt.dataset.tip = un ? `Notifications — ${un} unread` : 'Notifications'; bt.setAttribute('aria-label', bt.dataset.tip); }
  }

  // ---- notifications: the full Inbox page (its own address: #/…/g/inbox) ----
  function mainInbox() {
    const view = { Snoozed: 'snoozed', Archived: 'archive' }[S.item] || S.ntTab || 'inbox', d = data('notes');
    S.ntTab = view;
    return `<div class="wrap rp-page"><div class="pj-head"><div><small>All modes</small><h1>Inbox</h1></div><div class="rp-page-tools">${freshLine('notes')}<button class="btn ghost" data-nt-all>Mark all read</button><button class="btn ghost" data-nt-set>Settings</button></div></div>
      <div class="rp-page-shell rp">${S.ntSettings ? ntSettings() : d.val ? ntBody(view, S.ntFilter || 'all') : d.err ? errorPlate('notes', 'notifications') : ghosted('notes', () => ntBody(view, S.ntFilter || 'all'))}</div></div>`;
  }
  function paintInboxPage() { const host = document.querySelector('.rp-page'); if (!host) return; const fk = host.contains(document.activeElement) ? document.activeElement.dataset.fk : null, segs = segMemo(host); host.outerHTML = mainInbox(); segSlide(document.querySelector('.rp-page'), segs); if (fk) document.querySelector(`.rp-page [data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true }); }
  document.addEventListener('click', (e) => { if (e.target.closest('.rp-page')) { e.stopPropagation(); ntAct(e, paintInboxPage); } }, true);
  document.addEventListener('keydown', (e) => { const el = e.target.closest?.('.rp-page .nt2'); if (!el) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const r = [...document.querySelectorAll('.rp-page .nt2')], i = r.indexOf(el); r[e.key === 'ArrowDown' ? Math.min(i + 1, r.length - 1) : Math.max(i - 1, 0)]?.focus(); return; } ntKey(e, el, paintInboxPage); });

  // ---- Help ----
  const MODE_TIPS = {
    studio: [['Start an edit by dropping footage', 'Motion'], ['Generate variations from a layer', 'Pixel']],
    dev: [['Approve agent requests in the inbox', 'Agent'], ['Attach a repo so agents can open PRs', 'Agent']],
    social: [['Approve a week of posts from the calendar', 'Post'], ['Connect a channel before scheduling', 'Post']],
    office: [['Turn a doc into slides', 'Docs'], ['Share a sheet as a live table', 'Sheets']],
    corpo: [['Accept hand-offs from the inbox', 'Company'], ['Invite agents as staff', 'Workspace']],
    overview: [['See what needs you across every mode', 'Overview'], ['Jump to a mode with Alt 1–6', 'Shortcuts']],
  };
  const DOCS = [
    ['Getting started with modes', 'Basics'], ['Switching modes and the Overview', 'Basics'], ['Credits, balance and usage', 'Billing'], ['Buying credits', 'Billing'],
    ['Approving agent permissions', 'Agents'], ['Hand-offs between agents and people', 'Agents'], ['Snoozing and archiving notifications', 'Notifications'],
    ['Keyboard shortcuts', 'Basics'], ['Connecting social channels', 'Post'], ['Exporting from Motion', 'Motion'], ['Reporting a problem', 'Support'], ['Projects and tasks', 'Projects'],
  ];
  function openHelp() {
    const seen = store.get('seenNew', '') === '2026-09-17', ctxId = inOv() ? 'overview' : S.mode, ctxName = inOv() ? 'Overview' : M[S.mode] ? M[S.mode].name : 'XENO';
    const m = railPopOpen('help', 'hpm', `<header class="pl pl-head pl-head-search help-hero"><b>How can we help?</b>
      <label class="pp-search">${ic('search')}<input type="text" placeholder="Search help and docs" aria-label="Search help and docs" aria-controls="hp-body" spellcheck="false" data-fk="q"><kbd>/</kbd></label></header>
      <div class="pl-stack" id="hp-body" aria-live="polite"></div>
      <footer class="pl pl-foot"><button class="pp-status" data-hp="status" data-tip="Connection and build"><span class="${navigator.onLine ? 'ok' : 'bad'}"></span>${navigator.onLine ? 'Connected' : 'Offline'}</button><span class="hp-links">${iconBtn('data-hp="docs" data-fk="fdocs"', 'doc', 'Documentation')}${iconBtn('data-hp="community" data-fk="fcomm"', 'community', 'Ask the community')}${iconBtn('data-hp="idea" data-fk="fidea"', 'megaphone', 'Suggest a feature')}</span></footer>`);
    const body = m.querySelector('#hp-body'), input = m.querySelector('input');
    const draw = () => {
      const q = input.value.trim().toLowerCase(), hit = (t) => !q || t.toLowerCase().includes(q);
      if (q) {
        const res = DOCS.filter(([t, s]) => (t + ' ' + s).toLowerCase().includes(q)).slice(0, 5);
        const mark = (t) => esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
        const acts = [['report', 'edit', 'Report a problem', 'F1'], ['support', 'mail', 'Contact support', ''], ['keys', 'terminal', 'Keyboard shortcuts', 'Ctrl /'], ['community', 'community', 'Ask the community', ''], ['idea', 'megaphone', 'Suggest a feature', '']].filter((r) => hit(r[2]));
        body.innerHTML = `<section class="pl pl-list"><div class="pl-cap"><span>Docs</span><span>${res.length || 'No'} result${res.length === 1 ? '' : 's'}</span></div>${res.map(([t, s], i) => `<button class="mi hp" data-hp="doc" data-doc="${esc(t)}" data-fk="doc${i}">${ic('doc')}<span class="hp-t">${mark(t)}<small>${esc(s)}</small></span></button>`).join('')}<button class="mi hp" data-hp="search" data-fk="docall">${ic('search')}<span class="hp-t">Search all docs for “${esc(input.value.trim())}”</span><kbd>Enter</kbd></button></section>`
          + (acts.length ? `<section class="pl pl-list"><div class="pl-cap"><span>Actions</span></div>${acts.map(([id, i, t, k]) => `<button class="mi hp" data-hp="${id}" data-fk="a${id}">${ic(i)}<span class="hp-t">${esc(t)}</span>${k ? `<kbd>${k}</kbd>` : ''}</button>`).join('')}</section>` : '');
        return;
      }
      body.innerHTML = `<div class="hp-quick">${[['report', 'edit', 'Report', 'a problem · F1'], ['support', 'mail', 'Support', 'private ticket'], ['keys', 'terminal', 'Shortcuts', 'Ctrl /']].map(([id, i, t, k]) => `<button class="pl hp-q mi hp" data-hp="${id}" data-fk="q${id}" aria-label="${esc(t)} ${esc(k)}"><span class="hp-q-ic">${ic(i)}</span><span class="hp-q-t"><b>${esc(t)}</b><small>${esc(k)}</small></span></button>`).join('')}</div>
        <button class="pl hp-news mi hp" data-hp="new" data-fk="new"><span class="hp-news-k">${!seen ? '<span class="hp-badge">New</span>' : ''}What's new<em>Sep 17</em></span><b>Canvas 0.39 ships the shared agent panel</b><small>Your agent conversation, docked inside Canvas.</small><span class="hp-go">${ic('right')}</span></button>
        <section class="pl pl-list"><div class="pl-cap"><span>Tips for ${esc(ctxName)}</span>${MODE_INTRO[ctxId] ? `<button class="pl-capbtn" data-hp="intro" data-fk="intro">Mode intro</button>` : ''}</div>${(MODE_TIPS[ctxId] || MODE_TIPS.overview).map(([t, s], i) => `<button class="mi hp hp-tip" data-hp="tip" data-doc="${esc(t)}" data-fk="tip${i}">${ic('spark')}<span class="hp-l" title="${esc(t)} · ${esc(s)}">${esc(t)}</span><span class="hp-tipgo">${ic('right')}</span></button>`).join('')}</section>`;
    };
    draw(); placeRailPop(m);
    m.style.height = m.offsetHeight + 'px'; // hold the opened height while filtering, so the field does not jump under the cursor
    input.oninput = draw;
    input.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); body.querySelector('.mi')?.focus(); } if (e.key === 'Enter') { e.preventDefault(); body.querySelector('.mi')?.click(); } };
    m.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-hp]'); if (!b) return; const id = b.dataset.hp;
      if (id === 'community') { hidePops(); return go('global', { global: 'community' }); }
      if (id === 'keys') { hidePops(); return openShortcuts(railBtn('help')); }
      if (id === 'intro') { hidePops(); return openModeIntro(ctxId, railBtn('help')); }
      if (id === 'new') store.set('seenNew', '2026-09-17');
      hidePops();
      hidePops(); ({ report: () => window.XA.report({ kind: 'bug' }), support: () => window.XA.report({ kind: 'bug', visibility: 'private', title: 'Contact support' }), idea: () => window.XA.report({ kind: 'feature' }), docs: () => window.open('https://xenostudio.ai/docs', '_blank', 'noopener'), new: () => window.XA.whatsNew(), status: () => window.XA.status(), search: () => window.open('https://xenostudio.ai/docs?q=' + encodeURIComponent(input.value.trim()), '_blank', 'noopener'), doc: () => window.XA.article(b.dataset.doc), tip: () => window.XA.article(b.dataset.doc) }[id] || (() => {}))();
    };
    popKeys(m, '.mi.hp', (e) => { if (e.key === 'ArrowUp' && document.activeElement === body.querySelector('.mi')) { e.preventDefault(); input.focus(); } });
    input.focus({ preventScroll: true });
  }

  // ---- Keyboard shortcuts sheet (Ctrl /) — lists the bindings this shell actually has ----
  let sheetOpener = null;
  function openShortcuts(opener) {
    sheetOpener = opener || document.activeElement;
    let s = document.getElementById('kbsheet');
    if (!s) { s = document.createElement('div'); s.id = 'kbsheet'; document.body.appendChild(s); s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-kb-close]')) closeShortcuts(); }); s.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeShortcuts(); } if (e.key === 'Tab') { e.preventDefault(); s.querySelector('[data-kb-close]').focus(); } }); }
    // drawn from the registry every module declares its keys into (keys.js, §7y) — never a hand-kept list
    const K = window.XENO_KEYS.list().map(([h, rows]) => [h, rows.map((r) => [r.keys, r.label])]);
    s.innerHTML = `<div class="kb-shell rp" role="dialog" aria-modal="true" aria-labelledby="kb-title"><header class="pl pl-head"><b id="kb-title">Keyboard shortcuts</b><span class="pp-tools">${iconBtn('data-kb-close', 'x', 'Close  Esc')}</span></header>
      <div class="kb-cols">${K.map(([h, rows]) => `<section class="pl pl-list"><div class="pl-cap"><span>${h}</span></div>${rows.map(([k, l]) => `<div class="kb-row"><span>${esc(l)}</span><span class="kb-keys">${k.split(' ').map((x) => (x === 'or' ? '<span class="kb-or">or</span>' : `<kbd>${esc(x)}</kbd>`)).join('')}</span></div>`).join('')}</section>`).join('')}</div></div>`;
    s.classList.add('on'); s.querySelector('[data-kb-close]').focus();
  }
  function closeShortcuts() { const s = document.getElementById('kbsheet'); if (!s) return; s.classList.remove('on'); sheetOpener?.focus?.(); sheetOpener = null; }
  { const K = window.XENO_KEYS; if (K) { [['Ctrl K', 'Search everything'], ['Ctrl \\', 'Show or hide the sidebar'], ['Ctrl / or ?', 'Keyboard shortcuts'], ['F1', 'Report a problem'], ['Esc', 'Close the open panel']].forEach(([k, l]) => K.add('General', k, l));
    [['Alt 0', 'Overview'], ['Alt 1–6', 'Switch mode']].forEach(([k, l]) => K.add('Moving around', k, l));
    [['↑ ↓', 'Move between notifications'], ['Enter', 'Open'], ['E', 'Archive'], ['S', 'Snooze']].forEach(([k, l]) => K.add('Notifications', k, l)); } }
  // ? opens the sheet too (Gmail, GitHub, Linear) — never while typing or with a dialog open
  document.addEventListener('keydown', (e) => { if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input,textarea,select,[contenteditable]') && !document.querySelector('.xd')) { e.preventDefault(); const s = document.getElementById('kbsheet'); if (s?.classList.contains('on')) closeShortcuts(); else { hidePops(); openShortcuts(); } } });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); const s = document.getElementById('kbsheet'); if (s?.classList.contains('on')) closeShortcuts(); else { hidePops(); openShortcuts(); } } });

  // ---- Usage ----
  const RANGES = { '24h': ['24 h', 0.045], '7d': ['7 d', 0.27], '30d': ['30 d', 1] };
  const SURFACE = { xeno_agent: 'Agent', motion: 'Motion', xeno_api: 'Chat & API', xeno_post: 'Post' };
  const usageLeft = () => { const u = DS.usage && DS.usage.val; return u ? u.availableMicro / MICRO : null; };
  function openUsage(keep) {
    const d = data('usage'), u = d.val, range = S.usRange || '30d', group = S.usGroup || 'surface';
    const alert = store.get('lowAlert', { on: true, at: 500 });
    let main;
    const ghostU = !u && !d.err;
    if (!u && d.err) main = errorPlate('usage', 'your usage');
    else {
      const u = d.val || PH.usage();
      const left = u.availableMicro / MICRO, held = (u.postedMicro - u.availableMicro) / MICRO, availPct = u.postedMicro ? (u.availableMicro / u.postedMicro) * 100 : 0;
      const f = RANGES[range][1], rows = u.by[group === 'recent' ? 'surface' : group].map(([k, c, ev]) => [k, (c / MICRO) * f, Math.round(ev * f)]);
      const total = rows.reduce((s, r) => s + r[1], 0), events = rows.reduce((s, r) => s + r[2], 0);
      const tone = ['#fafafa', '#a3a3a3', '#6f6f6f', '#3a3a3a'], name = (k) => (group === 'model' ? k : SURFACE[k] || feat(k));
      const low = alert.on && left < alert.at;
      main = `${low ? `<section class="pl us-warn" role="alert">${ic('bolt')}<span><b>Balance under ${fmt(alert.at)} credits.</b> Running jobs can stop when it reaches zero.</span></section>` : ''}
      <section class="pl us-bal">
        <div class="us-k"><span>Balance</span><button class="us-alert" role="switch" aria-checked="${alert.on}" data-us-alert data-fk="alert" data-tip="${alert.on ? 'Turn off the low-balance alert' : 'Alert me when credits run low'}">${ic('bell')}${alert.on ? `Alert under ${fmt(alert.at)}` : 'Alert off'}</button></div>
        <div class="us-hero"><span class="us-big">${fmt(left)}</span><span class="us-unit">credits available</span></div>
        <div class="us-comp" aria-hidden="true"><i class="a" style="width:${availPct}%"></i>${held > 0 ? `<i class="h" style="width:${100 - availPct}%"></i>` : ''}</div>
        <div class="us-legend"><span><i class="a"></i>${fmt(left)} available</span>${held > 0 ? `<button class="us-held" data-us-held aria-expanded="${!!S.usHeld}" data-fk="held"><i class="h"></i>${fmt(held)} held by ${u.held.length} jobs ${ic(S.usHeld ? 'up' : 'chev')}</button>` : '<span>Nothing held</span>'}</div>
        ${S.usHeld && held > 0 ? `<div class="us-jobs">${u.held.map(([t, p, c]) => `<div class="us-lg us-act"><span class="us-n">${esc(t)}</span><span class="us-t">${esc(p)}</span><span class="us-v">${c}</span></div>`).join('')}</div>` : ''}
      </section>
      <section class="pl us-spend">
        <div class="us-head"><span>Spending</span><div class="pl-seg" role="radiogroup" aria-label="Range" data-seg="range" style="--i:${Object.keys(RANGES).indexOf(range)};--n:3">${Object.entries(RANGES).map(([k, [l]]) => `<button role="radio" aria-checked="${range === k}" data-us-range="${k}" data-fk="r${k}">${l}</button>`).join('')}</div></div>
        <div class="us-stats">
          <div class="us-stat us-tile"><small>Total · ${RANGES[range][0]}</small><b>${fmt(total)}</b></div>
          <div class="us-stat"><small>Charges</small><b>${fmt(events)}</b></div>
          <div class="us-stat"><small>Avg / charge</small><b>${events ? (total / events).toFixed(1) : '—'}</b></div>
        </div>
        <div class="pl-seg us-view" role="tablist" aria-label="Show" data-seg="view" style="--i:${['surface', 'model', 'recent'].indexOf(group)};--n:3">${[['surface', 'By product'], ['model', 'By model'], ['recent', 'Recent']].map(([k, l]) => `<button role="tab" aria-selected="${group === k}" aria-checked="${group === k}" data-us-group="${k}" data-fk="g${k}">${l}</button>`).join('')}</div>
        <div class="us-list">${group === 'recent'
          ? u.activity.slice(0, 4).map(([f2, c, t]) => `<div class="us-lg us-act"><span class="us-n">${esc(feat(f2))}</span><span class="us-t">${esc(agoShort(t))} ago</span><span class="us-v">−${c}</span></div>`).join('')
          : `<div class="us-stack" aria-hidden="true">${rows.map(([k, c], i) => `<i style="width:${(c / total) * 100}%;background:${tone[i % 4]}"></i>`).join('')}</div>${rows.map(([k, c], i) => `<div class="us-lg"><i style="background:${tone[i % 4]}"></i><span class="us-n">${esc(name(k))}</span><span class="us-pc">${Math.round((c / total) * 100)}%</span><span class="us-v">${fmt(c)}</span></div>`).join('')}`}</div>
      </section>`;
      if (ghostU) main = `<div class="ph-shape" aria-busy="true" aria-label="Loading">${main}</div>`;
    }
    const m = railPopOpen('usage', 'usm', `<header class="pl pl-head"><b>Usage</b>${u && u.frozen ? '<span class="pl-pill">Frozen</span>' : ''}${freshLine('usage')}<span class="pp-tools">${iconBtn('data-retry="usage" data-fk="refresh"', 'reset', 'Refresh')}</span></header>
      <div class="pl-stack">${main}</div>
      <footer class="pl pl-foot us-actions"><button class="us-primary" data-us="buy" data-fk="buy">Buy credits</button><button class="us-ghost" data-us="page" data-fk="page">Usage analytics ${ic('open')}</button></footer>`, keep);
    m.onclick = (e) => {
      e.stopPropagation();
      const rt = e.target.closest('[data-retry]'); if (rt) { DS.usage && (DS.usage.err = null); load('usage'); return; }
      const r = e.target.closest('[data-us-range]'); if (r) { S.usRange = r.dataset.usRange; return openUsage(true); }
      const g = e.target.closest('[data-us-group]'); if (g) { S.usGroup = g.dataset.usGroup; return openUsage(true); }
      if (e.target.closest('[data-us-held]')) { S.usHeld = !S.usHeld; return openUsage(true); }
      if (e.target.closest('[data-us-alert]')) { store.set('lowAlert', { ...alert, on: !alert.on }); return openUsage(true); }
      const b = e.target.closest('[data-us]'); if (b) { hidePops(); if (b.dataset.us === 'buy') window.XA.buyCredits(); else window.open('https://xenostudio.ai/overview/usage-analytics', '_blank', 'noopener'); }
    };
    popKeys(m, '.pl-seg button, .us-alert, .us-held, .us-actions button', (e) => { if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.closest('.pl-seg')) { e.preventDefault(); const sib = e.key === 'ArrowRight' ? e.target.nextElementSibling : e.target.previousElementSibling; sib?.click(); } });
    if (!keep) m.querySelector('.us-primary')?.focus({ preventScroll: true });
  }
  function syncUsage() {
    const b = railBtn('usage'); if (!b) return; const left = usageLeft();
    if (left == null) { b.textContent = '—'; b.dataset.tip = 'Usage'; b.setAttribute('aria-label', 'Usage'); return; }
    const alert = store.get('lowAlert', { on: true, at: 500 });
    b.textContent = left >= 1000 ? (Math.floor(left / 100) / 10) + 'k' : fmt(left); b.classList.toggle('low', alert.on && left < alert.at);
    b.dataset.tip = `Usage — ${fmt(left)} credits available`; b.setAttribute('aria-label', `${b.textContent} credits — usage, ${fmt(left)} available`);
  }

  // ---- live: new events arrive on their own (stand-in for the platform's push channel) ----
  window.__xw.push = (kind) => {
    if (kind === 'charge' || !kind) { const u = DS.usage && DS.usage.val; if (u) { u.availableMicro -= 12e6; u.postedMicro -= 12e6; u.activity.unshift(['video_export', 12, Date.now()]); DS.usage.at = Date.now(); dataChanged('usage'); } }
    if (kind === 'note' || !kind) {
      const d = DS.notes; if (!d || !d.val) return;
      const n = { id: 'live' + Date.now(), t: 'Launch trailer v3 — 4K export finished', m: 'studio', p: 'motion', kind: 'done', act: 'Open', at: Date.now(), g: 'needs', live: true };
      d.val.unshift(n); d.at = Date.now(); dataChanged('notes');
      const bt = railBtn('bell'); bt?.classList.remove('ring'); void bt?.offsetWidth; bt?.classList.add('ring');
      announce(`New notification: ${n.t}`);
    }
  };
  window.__xw.setBalance = (credits) => { const u = DS.usage && DS.usage.val; if (!u) return; const held = u.postedMicro - u.availableMicro; u.availableMicro = credits * MICRO; u.postedMicro = u.availableMicro + held; dataChanged('usage'); };
  setTimeout(() => { load('notes'); load('usage'); }, 0);
  setTimeout(() => window.__xw.push(), 25000);

  // a second click on the button that opened a popover closes it (the outside-press closes it first, so remember who owned it)
  document.addEventListener('mousedown', (e) => { const t = e.target.closest('#rail [data-go="bell"], #rail [data-go="help"], #rail [data-go="usage"], #rail [data-go="account"]'); S._popWas = t && popOwner() === t.dataset.go ? t.dataset.go : null; }, true);
  // rail popovers sit like the panel: one gap from the rail, one from the window bottom — and they size and
  // place themselves in script, so a narrow or resized window can never squeeze or strand them
  function placeRailPop(m) {
    const cs = getComputedStyle(document.documentElement), gx = parseFloat(cs.getPropertyValue('--gap-x')) || 7, gb = parseFloat(cs.getPropertyValue('--gap-yb')) || 7, rw = parseFloat(cs.getPropertyValue('--rail-w')) || 56;
    const want = (POP[m.dataset.owner] || [0, 268])[1], left = rw + gx;
    m.style.left = left + 'px'; m.style.width = Math.max(Math.min(want, innerWidth - left - gx), Math.min(want, 260)) + 'px';
    m.style.maxHeight = (innerHeight - gb * 2) + 'px'; m.style.overflowY = 'auto';
    m.style.top = 'auto'; m.style.bottom = gb + 'px'; // anchored at the bottom: late growth (images, fonts, live rows) extends upward, never off-screen
  }
  addEventListener('resize', () => { const o = popOwner(); if (!o || !POP[o]) return; const m = $('#menu'); m.style.height = ''; placeRailPop(m); });
  function applyWorkspace() { const w = window.XA.currentWorkspace(); const av = document.querySelector('#rail .avatar'); if (av) { av.textContent = w.initial; av.dataset.tip = w.name + ' · account, workspaces, settings'; } }
  // ---- context menus ----
  // ---- context menus: every shell object registers ONE model with the shared engine (ctx-menu.js) ----
  // The "…" button opens the very same menu, anchored to the button.
  function openMenu(kind, target, x, y) { hidePops(); return window.XCM?.open(target, { x, y, fromButton: target.querySelector('[data-more]') || target }); }
  // the URL a state WOULD have — so "Open in new window" and "Copy link" are real links, not the current page
  function hashFor(view, extra = {}) {
    const keys = ['view', 'item', ...Object.keys(extra)], keep = {}; keys.forEach((k) => { keep[k] = S[k]; });
    Object.assign(S, { view, item: null }, extra); try { return stateToHash(); } finally { Object.assign(S, keep); }
  }
  function registerMenus() {
    const C = window.XCM; if (!C) return; const H = C.H;
    const chatsOf = () => ctxChats();
    const allProjects = () => (window.XENO_PG_PROJECTS?.items || []).filter((p) => p.status !== 'archived').map((p) => p.name);
    const homeHash = (view, extra) => hashFor(view, extra);

    // products — sidebar rows, rail pins, cards, store tiles
    C.register({ id: 'product', sel: '[data-product]', priority: 1, build: (n) => {
      const id = n.dataset.product, p = PR[id]; if (!p) return null;
      const pinned = pinsFor(S.mode).includes(id), h = homeHash('product', { product: id });
      return [H.nav(h, () => openProduct(id), `Open ${p.name}`),
        [{ label: 'Pinned to the rail', icon: 'pin', checked: pinned, run: () => { const cur = pinsFor(S.mode).slice(); const i = cur.indexOf(id); i >= 0 ? cur.splice(i, 1) : cur.push(id); S.pins[S.mode] = cur.slice(0, 6); store.set('pins', S.pins); renderRail(); toast(i >= 0 ? `Unpinned ${p.name}` : `Pinned ${p.name} to the rail`); } }],
        H.linkItems(h, p.name)];
    } });

    // chats — the chat sidebar (pinned, recents, inside projects)
    C.register({ id: 'chat', sel: '[data-chat]', priority: 2, build: (n) => {
      const t = n.dataset.chat, c = chatsOf(), pinned = (c.pinned || []).includes(t), h = homeHash('product', { product: 'chat' });
      const inProj = (c.projects || []).find((pj) => pj[2].includes(t))?.[0] || null;
      const moveTo = (name) => () => {
        (c.projects || []).forEach((pj) => { pj[2] = pj[2].filter((x) => x !== t); });
        (c.recents || []).forEach((g) => { g[1] = g[1].filter((x) => x !== t); });
        if (name) { let pj = c.projects.find((x) => x[0] === name); if (!pj) { pj = [name, null, []]; c.projects.push(pj); } pj[2].unshift(t); S.openProjects.add(name); }
        else (c.recents[0] || (c.recents[0] = ['Today', []]))[1].unshift(t);
        window.XW.refreshPanel(); if (window.XENO_DRAG?.busy) return; window.XENO_HIST?.record(name ? `Moved “${t}” to ${name}` : `Removed “${t}” from its project`, null);
      };
      return [H.nav(h, () => { go('product', { product: 'chat' }); }),
        [{ label: 'Pinned', icon: 'pin', checked: pinned, run: () => { c.pinned = pinned ? c.pinned.filter((x) => x !== t) : [t, ...(c.pinned || [])]; window.XW.refreshPanel(); toast(pinned ? 'Unpinned' : 'Pinned'); } },
          { label: 'Rename…', icon: 'edit', key: 'F2', kbd: 'F2', run: () => window.XA.renameChat(t) },
          { label: 'Move to project', icon: 'folder', sub: () => [[...allProjects().map((pn) => ({ label: pn, icon: 'folder', checked: pn === inProj, run: moveTo(pn) }))], [{ label: 'No project', icon: 'minus', checked: !inProj, run: moveTo(null) }]] }],
        [{ label: 'Copy name', icon: 'copy', run: () => H.copy(t, 'Name copied') }],
        [{ label: 'Delete…', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => window.XA.deleteChat(t) }]];
    } });

    // projects — sidebar, project cards and rows on every page
    C.register({ id: 'project', sel: '[data-project], [data-pg-go-project]', priority: 2, build: (n) => {
      const name = n.dataset.project || n.dataset.pgGoProject; if (!name) return null;
      const h = homeHash('global', { global: 'projects', item: name }), pinned = S.pinnedProjects.has(name);
      return [H.nav(h, () => go('global', { global: 'projects', item: name })),
        [{ label: 'New task…', icon: 'plus', run: () => window.XA.newTask(name) },
          { label: 'Assign people or agents…', icon: 'people', run: () => window.XA.assign(name) },
          { label: 'Set budget…', icon: 'chart', run: () => window.XA.budget(name) }],
        [{ label: 'Rename…', icon: 'edit', key: 'F2', kbd: 'F2', run: () => window.XA.renameProject(name) },
          { label: 'Change icon…', icon: 'palette', run: () => window.XA.iconProject(name) },
          { label: 'Pinned in the sidebar', icon: 'pin', checked: pinned, run: () => { pinned ? S.pinnedProjects.delete(name) : S.pinnedProjects.add(name); window.XW.refreshPanel(); toast(pinned ? 'Unpinned' : 'Pinned'); } },
          { label: 'Copy link', icon: 'link', run: () => H.copyLink(h) }],
        [{ label: 'Archive…', icon: 'archive', run: () => window.XA.archiveProject(name) },
          { label: 'Delete…', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => window.XA.deleteProject(name) }]];
    } });

    // modes — the switcher rows and mode buttons
    C.register({ id: 'mode', sel: '[data-mode]', priority: 1, build: (n) => {
      const id = n.dataset.mode; if (!M[id] || id === 'overview') return null;
      const isHidden = hiddenModes().has(id), isDef = store.get('primary', 'studio') === id, h = '#/' + id;
      return [H.nav(h, () => openMode(id), `Open ${M[id].name}`),
        [{ label: 'Default mode', icon: 'star', checked: isDef, run: () => { if (isDef) return; store.set('primary', id); refreshSwitcher(); toast(`${M[id].name} is your default mode`); } },
          { label: 'Move to top', icon: 'up', disabled: modeOrder()[0] === id ? 'Already first' : null, run: () => { const ord = modeOrder().filter((x) => x !== id); ord.unshift(id); setOrder(ord); refreshSwitcher(); renderRail(); toast(`${M[id].name} moved to the top`); } },
          { label: 'In the logo cycle', icon: 'refresh', checked: !isHidden, run: () => { const shown = toggleHidden(id); refreshSwitcher(); toast(`${M[id].name} ${shown ? 'shown in' : 'hidden from'} the cycle`); } }]];
    } });

    // areas (zones) — rail strip and sidebar "Sections"
    C.register({ id: 'zone', sel: '[data-zone]', priority: 1, build: (n) => {
      const id = n.dataset.zone, z = zonesFor(zoneKey()).concat(zonesFor('overview')).find((x) => x.id === id); if (!z) return null;
      const h = homeHash('zone', { zone: id });
      return [H.nav(h, () => go('zone', { zone: id, zoneOf: inOv() ? 'overview' : 'mode' }), `Open ${z.label}`), H.linkItems(h, z.label)];
    } });

    // Overview's rail categories — one per mode
    C.register({ id: 'rail-cat', sel: '#rail [data-cat]', priority: 2, build: (n) => {
      const id = n.dataset.cat; if (!M[id]) return null; const open = n.getAttribute('aria-expanded') === 'true';
      return [H.nav('#/' + id, () => openMode(id), `Open ${M[id].name}`), [{ label: open ? 'Hide its areas' : 'Show its areas', icon: open ? 'up' : 'down', run: () => n.click() }], [{ label: 'Copy link', icon: 'link', run: () => H.copyLink('#/' + id) }]];
    } });

    // the rail's global entries
    const GLOBAL_DEST = { projects: 1, library: 1, workspace: 1, anima: 1, community: 1, market: 1, places: 1 };
    C.register({ id: 'rail-global', sel: '#rail [data-go]', priority: 1, build: (n) => {
      const g = n.dataset.go, label = (n.dataset.tip || n.getAttribute('aria-label') || g).split(' — ')[0], click = () => n.click();
      if (GLOBAL_DEST[g]) { const h = homeHash('global', { global: g }); return [H.nav(h, click, `Open ${label}`), [{ label: 'Copy link', icon: 'link', run: () => H.copyLink(h) }]]; }
      if (g === 'chat') { const h = homeHash('product', { product: 'chat' }); return [H.nav(h, click, 'Open Chat'), [{ label: 'New chat', icon: 'plus', kbd: 'Ctrl ⇧ O', run: () => { go('product', { product: 'chat' }); } }]]; }
      if (g === 'home') return [H.nav(inOv() ? '#/overview' : '#/' + S.mode, click, 'Go home'), [{ label: 'Customize home…', icon: 'sliders', run: () => { click(); setTimeout(() => document.querySelector('[data-home-custom]')?.click(), 250); } }]];
      if (g === 'account') return [[{ label: 'Open account', icon: 'open', run: click }, { label: 'Settings…', icon: 'sliders', kbd: 'Ctrl ,', run: () => window.XA.settings() }]];
      if (g === 'help') return [[{ label: 'Open help', icon: 'open', run: click }, { label: 'Keyboard shortcuts', icon: 'grid', kbd: 'Ctrl /', run: () => openShortcuts() }, { label: 'Report a problem…', icon: 'info', kbd: 'F1', run: () => window.XA.report() }]];
      if (g === 'usage') return [[{ label: 'Open usage', icon: 'open', run: click }, { label: 'Plans & credits…', icon: 'chart', run: () => window.XA.plans() }]];
      return [[{ label: `Open ${label}`, icon: 'open', run: click }]];
    } });

    // anything that is an item in a list: recent work, a task, a run, a home tile
    C.register({ id: 'item', sel: '[data-item], [data-pg-item]', priority: 3, build: (n) => {
      const t = n.dataset.item || n.dataset.pgItem, p = n.dataset.itemP || n.dataset.pgItemP; if (!t) return null;
      const here = S.view === 'product' && S.product === p;
      const h = p && !here && S.view !== 'zone' ? homeHash('product', { product: p, item: t }) : homeHash(S.view, { item: t });
      const run = () => n.click();
      const need = n.querySelector('.need')?.textContent.trim();
      return [[...(need ? [{ label: need, icon: 'check', run }] : []), { label: need ? 'Open' : 'Open', icon: 'open', key: 'Enter', kbd: '↵', run }, { label: 'Open in new window', icon: 'hub', run: () => H.openWindow(h) },
        ...(p && PR[p] && !here ? [{ label: `Open in ${PR[p].name}`, icon: 'external', iconHTML: pIconFull(PR[p], 15), run: () => openProduct(p) }] : [])],
        H.linkItems(h, t)];
    } });

    // sidebar section headings
    C.register({ id: 'section', sel: '#panel .sec > .sh', priority: 2, build: (n) => {
      const sec = n.closest('.sec'), all = () => [...document.querySelectorAll('#panel .pv .sec')], closed = sec.classList.contains('closed');
      return [[{ label: closed ? 'Expand' : 'Collapse', icon: closed ? 'down' : 'up', run: () => sec.classList.toggle('closed') },
        { label: 'Collapse others', icon: 'minus', run: () => all().forEach((s) => s.classList.toggle('closed', s !== sec)) }],
      [{ label: 'Expand all', icon: 'down', run: () => all().forEach((s) => s.classList.remove('closed')) },
        { label: 'Collapse all', icon: 'up', run: () => all().forEach((s) => s.classList.add('closed')) }]];
    } });

    // the sidebar itself (its empty space, its header)
    C.register({ id: 'panel', sel: '#panel .pv', priority: -1, build: (n) => {
      const primary = n.querySelector('.pbody > .act.primary');
      return [[...(primary ? [{ label: primary.textContent.replace(/Ctrl.*$/, '').trim() || 'New', icon: 'plus', run: () => primary.click() }] : []), { label: 'Search', icon: 'search', kbd: 'Ctrl K', run: () => openPalette() }],
        [{ label: 'Expand all sections', icon: 'down', run: () => n.querySelectorAll('.sec').forEach((s) => s.classList.remove('closed')) },
          { label: 'Collapse all sections', icon: 'up', run: () => n.querySelectorAll('.sec').forEach((s) => s.classList.add('closed')) }],
        [{ label: 'Hide sidebar', icon: 'sidebar', kbd: 'Ctrl \\', run: () => setPanel('closed') }]];
    } });

    // home sections — hide or reorder in place (the same store Customize writes)
    C.register({ id: 'home-section', sel: '[data-hsec]', priority: 0, build: (n) => {
      if (!HOME_SECS) return null;
      const id = n.dataset.hsec, key = 'homeLayout.' + HOME_SECS.ctx, ids = HOME_SECS.list.map((x) => x.id);
      const get = () => { const L = store.get(key, null) || {}; return { order: [...(L.order || []).filter((i) => ids.includes(i)), ...ids.filter((i) => !(L.order || []).includes(i))], hidden: new Set(L.hidden || []) }; };
      const apply = (L) => { store.set(key, { order: L.order, hidden: [...L.hidden] }); const mv = $('#main .mview'); if (mv) { const top = mv.scrollTop; mv.innerHTML = S.view === 'mode' ? mainMode() : mainDashboard(); mv.scrollTop = top; } };
      // positions as the person SEES them — a section with nothing to show renders nothing and must not count
      const vis = [...document.querySelectorAll('#main [data-hsec]')].filter((x) => x.offsetHeight > 0).map((x) => x.dataset.hsec), i = vis.indexOf(id), label = HOME_SECS.list.find((x) => x.id === id)?.label || 'section';
      const move = (d) => () => { const L = get(); const a = L.order.indexOf(id), b = L.order.indexOf(vis[i + d]); [L.order[a], L.order[b]] = [L.order[b], L.order[a]]; apply(L); if (!window.XENO_DRAG?.busy) window.XENO_HIST?.record(`Moved “${label}”`, null); };
      return [[{ label: 'Move up', icon: 'up', disabled: i <= 0 ? 'Already at the top' : null, run: move(-1) },
        { label: 'Move down', icon: 'down', disabled: i >= vis.length - 1 ? 'Already at the bottom' : null, run: move(1) },
        { label: `Hide “${label}”`, icon: 'eye', run: () => { const L = get(); L.hidden.add(id); apply(L); undoToast(`Hid “${label}”`, () => { const L2 = get(); L2.hidden.delete(id); apply(L2); }); } }],
      [{ label: 'Customize home…', icon: 'sliders', run: () => document.querySelector('[data-home-custom]')?.click() }]];
    } });
    // drag (§7x): home sections reorder by dragging or Alt ↑/↓ — through the Move up/down above; a chat drops onto a
    // project in the sidebar — through its own "Move to project" item
    window.XENO_DRAG?.sort({ sel: '#main [data-hsec]', label: (n) => HOME_SECS?.list.find((x) => x.id === n.dataset.hsec)?.label || 'section' });
    window.XENO_DRAG?.move({ sel: '#panel [data-chat]', into: '#panel [data-project]', label: (n) => n.dataset.chat, verb: (t) => t.dataset.project });

    // a chat message — the captured live chat and the static thread
    C.register({ id: 'message', sel: '[data-message-id], .chat .um, .chat .am', priority: 2, build: (n) => {
      const user = n.dataset.role === 'user' || n.classList.contains('um');
      const body = n.querySelector('.chat-usermsg-text, .prose') || n, text = body.innerText.trim();
      const composer = () => document.querySelector('#main .live-chat textarea, #main .chat textarea');
      const put = (v) => { const ta = composer(); if (!ta) return toast('No composer here'); ta.focus(); ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.setSelectionRange(v.length, v.length); };
      return [[{ label: 'Copy message', icon: 'copy', run: () => H.copy(text, 'Message copied') },
        { label: 'Quote in reply', icon: 'reply', run: () => put(`> ${text.replace(/\n/g, '\n> ')}\n\n`) },
        ...(user ? [{ label: 'Edit and resend', icon: 'edit', run: () => put(text) }] : [])],
      [{ label: 'Select message text', icon: 'grid', run: () => { const r = document.createRange(); r.selectNodeContents(body); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }]];
    } });

    // links
    C.register({ id: 'link', sel: 'a[href]', priority: 4, build: (n) => {
      const href = n.href; if (!href || href.startsWith('javascript:')) return null;
      return [[{ label: 'Open link', icon: 'open', run: () => n.click() }, { label: 'Open in new tab', icon: 'external', run: () => window.open(href, '_blank', 'noopener') }],
        [{ label: 'Copy link address', icon: 'link', run: () => H.copy(href, 'Link copied') }]];
    } });

    // the last stop: the app itself (Finder's desktop menu)
    C.register({ id: 'app', sel: 'body', priority: -10, build: () => [
      [{ label: 'Back', icon: 'back', kbd: 'Alt ←', run: () => history.back() }, { label: 'Forward', icon: 'forward', kbd: 'Alt →', run: () => history.forward() }],
      [{ label: 'Copy link to this page', icon: 'link', run: () => H.copyLink(location.hash || '#/') }, { label: 'Open in new window', icon: 'hub', run: () => H.openWindow(location.hash || '#/') }],
      [{ label: 'Search', icon: 'search', kbd: 'Ctrl K', run: () => openPalette() },
        { label: root.dataset.panel === 'open' ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', kbd: 'Ctrl \\', run: () => setPanel(root.dataset.panel === 'open' ? 'closed' : 'open') },
        { label: 'Settings…', icon: 'sliders', kbd: 'Ctrl ,', run: () => window.XA.settings() },
        { label: 'Keyboard shortcuts', icon: 'grid', kbd: 'Ctrl /', run: () => openShortcuts() }]] });
  }

  registerMenus();

  // ---- search palette ----
  let palSel = 0, palItems = [];
  function openPalette() {
    hidePops();
    const pal = $('#palette');
    pal.innerHTML = `<div class="pin">${ic('search')}<input placeholder="Search everything — or type > for commands" aria-label="Search everything"><kbd style="font:11px Inter;color:var(--dim)">Esc</kbd></div><div class="res"></div>`;
    $('#scrim').classList.add('on'); pal.classList.add('on');
    const input = pal.querySelector('input');
    const all = [...MODES.map((m) => ({ k: 'Modes', label: M[m.id].name, sub: m.persona, html: noMark(m.id), run: () => openMode(m.id) })),
      ...Object.values(PR).map((p) => ({ k: 'Products', label: p.name, sub: (homeModeOf(p.id) ? M[homeModeOf(p.id).id].name : 'Global') + (p.status === 'soon' ? ' · soon' : ''), html: pIcon(p, 20), run: () => openProduct(p.id) })),
      ...window.XENO_RECENT.map((r) => ({ k: 'Recent', label: r.t, sub: PR[r.p].name, html: pIcon(PR[r.p], 20), run: () => openProduct(r.p) }))];
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      palItems = window.XENO_SEARCH ? window.XENO_SEARCH.rank(all, input.value) : all.filter((x) => !q || (x.label + ' ' + x.sub).toLowerCase().includes(q)).slice(0, 14);
      palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
      let last = '', html = '';
      palItems.forEach((x, i) => { if (x.k !== last) { html += `<div class="grp">${x.k}</div>`; last = x.k; } html += `<button class="row ${i === palSel ? 'sel' : ''}" data-pi="${i}">${x.html.replace('class="mk"', 'class="mk" style="width:20px;height:20px"')}<span class="t">${esc(x.label)}</span><span class="meta" style="display:block">${esc(x.sub)}</span></button>`; });
      pal.querySelector('.res').innerHTML = html || '<div class="row sub">No results</div>';
    };
    input.oninput = () => { palSel = 0; draw(); };
    input.onkeydown = (e) => { if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palItems.length - 1); draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); draw(); e.preventDefault(); } if (e.key === 'Enter' && palItems[palSel]) { window.XENO_SEARCH?.opened(palItems[palSel]); const r = palItems[palSel].run; closePalette(); r(); } };
    pal.querySelector('.res').onclick = (e) => { const b = e.target.closest('[data-pi]'); if (b) { window.XENO_SEARCH?.opened(palItems[+b.dataset.pi]); const r = palItems[+b.dataset.pi].run; closePalette(); r(); } };
    draw(); setTimeout(() => input.focus(), 20);
  }
  function closePalette() { $('#palette').classList.remove('on'); $('#scrim').classList.remove('on'); }
  // closing must not reshape the popover mid-fade: the real menu resets at once (out of sight, no transition)
  // while an inert copy of the last frame fades out exactly where it was
  function ghostMenu() {
    const m = $('#menu'); if (!m.classList.contains('on')) return;
    const r = m.getBoundingClientRect(), g = m.cloneNode(true);
    g.id = 'menu-ghost'; g.inert = true; g.setAttribute('aria-hidden', 'true'); g.removeAttribute('role'); g.classList.add('pop-ghost');
    Object.assign(g.style, { top: r.top + 'px', bottom: 'auto', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', maxHeight: 'none' });
    const st = m.querySelector('.pl-stack'), gst = g.querySelector('.pl-stack'); if (st && gst) gst.scrollTop = st.scrollTop;
    document.getElementById('menu-ghost')?.remove(); document.body.appendChild(g);
    if (st && gst) gst.scrollTop = st.scrollTop;
    requestAnimationFrame(() => g.classList.remove('on')); setTimeout(() => g.remove(), 260);
    m.style.transition = 'none'; requestAnimationFrame(() => requestAnimationFrame(() => { m.style.transition = ''; }));
  }
  function hidePops() { ghostMenu(); $('#switcher').classList.remove('on'); $('#menu').dataset.owner = ''; Object.assign($('#menu').style, { height: '', maxHeight: '', overflowY: '', width: '', bottom: '' }); $('#menu').setAttribute('role', 'menu'); $('#menu').removeAttribute('aria-label'); $('#menu').removeAttribute('aria-modal'); document.querySelectorAll('#rail [aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); S.ntSnoozeOpen = null; S.ntSettings = false; $('#menu').classList.remove('on', 'ntm', 'rp', 'hpm', 'usm', 'acc', 'models', 'cx', 'cx-list', 'cx-card', 'xs', 'xs-list', 'xs-cardwrap'); document.querySelectorAll('[data-menu-open]').forEach((n) => n.removeAttribute('data-menu-open')); }
  let tt = 0; function toast(s) { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1700); }

  // ---- events ----
  document.addEventListener('click', (e) => { const a = e.target.closest('.crumbs a[data-crumb]'); if (!a) return; e.preventDefault(); go('global', { global: S.global, item: a.dataset.crumb || null }); });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('#switcher, #menu') ) hidePops();
    if (S.switching && !t.closest('#panel, #logo, #menu')) { closeSwitcher(); }
    if (t.closest('#scrim')) return closePalette();
    const more = t.closest('[data-more]');
    if (more) { e.stopPropagation(); const r = more.closest('[data-ctx]'); const b = more.getBoundingClientRect(); return openMenu(r.dataset.ctx, r, b.right - 200, b.bottom + 4); }
    const logo = t.closest('#logo');
    if (logo) { cycleMode(); return; }
    const b = t.closest('button, .row'); if (!b || b.closest('#menu')) return;
    if (b.closest('#switcher')) { if (b.dataset.mode) openMode(b.dataset.mode); else if (b.hasAttribute('data-dashboard')) go('dashboard'); else if (b.dataset.toast) toast(b.dataset.toast); hidePops(); return; }
    if (b.dataset.zone) { if (S.view === 'zone' && S.zone === b.dataset.zone) return setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); return go('zone', { zone: b.dataset.zone, zoneOf: zoneKey() === 'overview' ? 'overview' : 'mode' }); }
    if (b.hasAttribute('data-close-switch')) return closeSwitcher();
    if (b.hasAttribute('data-dashboard')) return go('dashboard');
    if (b.hasAttribute('data-collapse')) return setPanel('closed');
    if (b.hasAttribute('data-expand')) return setPanel('open');
    if (b.hasAttribute('data-back')) return S.item ? go(S.view, { item: null }) : goModeHome();
    if (b.hasAttribute('data-switch')) return openSwitcher();
    if (b.hasAttribute('data-fold')) return b.closest('.sec').classList.toggle('closed');
    if (b.dataset.project) { const n = b.dataset.project; S.openProjects.has(n) ? S.openProjects.delete(n) : S.openProjects.add(n); b.closest('.pj').classList.toggle('open'); return; }
    if (b.dataset.chat) { document.querySelectorAll('[data-chat][aria-current]').forEach((n) => n.setAttribute('aria-current', 'false')); b.setAttribute('aria-current', 'true'); return; }
    if (b.hasAttribute('data-newchat') || b.dataset.newin) return toast(b.dataset.newin ? `New chat in ${b.dataset.newin}` : 'New chat');
    if (b.dataset.mode) return openMode(b.dataset.mode);
    if (b.dataset.item !== undefined) { const p = b.dataset.itemP; if (p && !(S.view === 'product' && S.product === p)) return go('product', { product: p, item: b.dataset.item }); return go(S.view, { item: b.dataset.item }); }
    if (b.dataset.ptab) return go('global', { global: 'projects', item: S.item.split('/')[0] + (b.dataset.ptab === 'Overview' ? '' : '/' + b.dataset.ptab) });
    if (b.dataset.openProjectOv) return go('global', { global: 'projects', item: b.dataset.openProjectOv });
    if (b.dataset.openProject) return go('global', { global: 'projects', item: b.dataset.openProject + '/Conversations' });
    if (b.dataset.cat) { const set = new Set(ovOpen()); set.has(b.dataset.cat) ? set.delete(b.dataset.cat) : set.add(b.dataset.cat); store.set('ovOpen', [...set]); const el = $('#rzone'), mid = $('#rmid'); if (el) { const y0 = b.getBoundingClientRect().top; ovPatch(); const hold = () => {};  /* holding the button under the pointer was measured to fight scroll-into-view; the fold itself is smooth */ const t0 = performance.now(); const loop = () => { hold(); if (performance.now() - t0 < 230) requestAnimationFrame(loop); else { const kids = el.querySelector('.rcat[aria-expanded="true"] + .rcat-kids'); if (kids) kids.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); railFit(); } }; requestAnimationFrame(loop); } return; }
    if (b.dataset.goLibrary) return go('global', { global: 'library', item: b.dataset.goLibrary });
    if (b.dataset.product) { const id = b.dataset.product; if (S.view === 'product' && S.product === id && b.closest('#rail')) return setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); return openProduct(id); }
    const g = b.dataset.go;
    if (g === 'search') return openPalette();
    if (g === 'home') { if ((S.view === 'mode' || S.view === 'dashboard') && b.closest('#rail')) return setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); return goModeHome(); }
    if (g === 'chat') { if (S.view === 'product' && S.product === 'chat' && b.closest('#rail')) return setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); return go('product', { product: 'chat' }); }
    if (['anima', 'community', 'market', 'library', 'projects', 'workspace', 'places'].includes(g)) { if (S.view === 'global' && S.global === g) return setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); return go('global', { global: g }); }
    if (['bell', 'help', 'usage', 'account'].includes(g)) { if (S._popWas === g) { S._popWas = null; return hidePops(); } return ({ bell: openBell, help: openHelp, usage: openUsage, account: openAccount })[g](); }
    if (b.dataset.projectsOf) { window.XENO_PAGES.query('projects', PR[b.dataset.projectsOf].name); return go('global', { global: 'projects', item: null }); }
    if (b.dataset.toast) return toast(b.dataset.toast);
  });
  document.addEventListener('contextmenu', (e) => { const lg = e.target.closest('#logo'); if (lg) { e.preventDefault(); hidePops(); openSwitcher(); return; } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.switching) closeSwitcher(); hidePops(); closePalette(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'Backslash') { e.preventDefault(); setPanel(root.dataset.panel === 'open' ? 'closed' : 'open'); }
    if (e.altKey && /^Digit[0-6]$/.test(e.code)) { e.preventDefault(); const n = +e.code.slice(5); n === 0 ? go('dashboard') : openMode(MODES[n - 1].id); }
    if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && document.activeElement?.id === 'logo') { e.preventDefault(); openSwitcher(); }
    if (e.key === 'F1' && !document.querySelector('.xd')) { e.preventDefault(); hidePops(); window.XA.report(); }
  });


  // switcher: manage view + its controls
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-manage]')) { e.stopPropagation(); return layerShow(panelManage()); }
    if (t.closest('[data-manage-back]')) { e.stopPropagation(); return layerShow(panelSwitcher()); }
    const def = t.closest('[data-mm-default]'); if (def) { e.stopPropagation(); store.set('primary', def.dataset.mmDefault); layerShow(panelManage()); return toast(`${M[def.dataset.mmDefault].name} is your default mode`); }
    const hide = t.closest('[data-mm-hide]'); if (hide) { e.stopPropagation(); const shown = toggleHidden(hide.dataset.mmHide); hide.setAttribute('aria-checked', String(shown)); hide.closest('.mm-row').classList.toggle('dim', !shown); return toast(`${M[hide.dataset.mmHide].name} ${shown ? 'shown in' : 'hidden from'} the cycle`); }
    const up = t.closest('[data-mm-up]'), dn = t.closest('[data-mm-down]');
    if (up || dn) { e.stopPropagation(); const id = (up || dn).dataset.mmUp || (up || dn).dataset.mmDown, ord = modeOrder(), i = ord.indexOf(id), j = i + (up ? -1 : 1);
      if (j < 0 || j >= ord.length) return; [ord[i], ord[j]] = [ord[j], ord[i]]; setOrder(ord); const layer = $('#panel > .msw-layer'); if (layer) layer.innerHTML = panelManage(); return; }
  }, true);
  // switcher keyboard: type to filter, arrows move, Enter opens, digits 0-6 jump
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-msw-filter]')) return;
    const q = e.target.value.trim().toLowerCase(); let any = false;
    document.querySelectorAll('[data-msw-root] .msw-row').forEach((r) => { const hit = !q || (r.dataset.find || r.textContent.toLowerCase()).includes(q) || r.textContent.toLowerCase().includes(q); r.hidden = !hit; if (hit) any = true; });
    document.querySelectorAll('[data-msw-root] .msw-grp').forEach((g) => { g.hidden = !!q; });
    const empty = document.querySelector('[data-msw-root] .msw-empty'); if (empty) empty.hidden = any;
    const first = document.querySelector('[data-msw-root] .msw-row:not([hidden])'); document.querySelectorAll('[data-msw-root] .msw-row.kb').forEach((r) => r.classList.remove('kb')); first?.classList.add('kb');
  });
  document.addEventListener('keydown', (e) => {
    if (!S.switching) return;
    const rows = [...document.querySelectorAll('[data-msw-root] .msw-row:not([hidden])')]; if (!rows.length) return;
    let i = rows.findIndex((r) => r.classList.contains('kb')); if (i < 0) i = Math.max(0, rows.findIndex((r) => r.getAttribute('aria-selected') === 'true'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows.forEach((r) => r.classList.remove('kb')); const n = rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]; n.classList.add('kb'); n.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); (rows[i] || rows[0]).click(); }
    else if (/^[0-6]$/.test(e.key) && !document.activeElement?.matches('[data-msw-filter]')) { e.preventDefault(); const n = +e.key; n === 0 ? go('dashboard') : openMode(MODES[n - 1].id); }
  });
  // tooltips
  const tip = $('#tip'); let tipT = 0;
  let tipWarmUntil = 0, tipMuted = null;
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-tip]'); clearTimeout(tipT); if (!b) { if (tip.classList.contains('on')) tipWarmUntil = performance.now() + 400; tip.classList.remove('on'); tipMuted = null; return; }
    if (b === tipMuted) return;
    const wait = performance.now() < tipWarmUntil || tip.classList.contains('on') ? 0 : 450;
    tipT = setTimeout(() => { const r = b.getBoundingClientRect(); tip.innerHTML = esc(b.dataset.tip) + (b.dataset.kbd ? `<kbd>${esc(b.dataset.kbd)}</kbd>` : ''); const inRail = !!b.closest('#rail');
      tip.style.left = (inRail ? r.right + 10 : r.left) + 'px'; tip.style.top = (inRail ? r.top + r.height / 2 - 13 : r.bottom + 6) + 'px'; tip.classList.add('on'); tipWarmUntil = performance.now() + 400; }, wait); });
  document.addEventListener('mousedown', (e) => { clearTimeout(tipT); tip.classList.remove('on'); tipMuted = e.target.closest('[data-tip]'); }, true);
  // hover-peek while collapsed (overlay only)
  let peekT = 0; const panelEl = $('#panel');
  const peek = (on) => { if (root.dataset.panel !== 'closed') return; clearTimeout(peekT);
    if (on) { root.setAttribute('data-peek', ''); panelEl.inert = false; } else peekT = setTimeout(() => { root.removeAttribute('data-peek'); panelEl.inert = true; }, 160); };
  $('#peekzone').addEventListener('mouseenter', () => { clearTimeout(peekT); peekT = setTimeout(() => peek(true), 120); });
  $('#peekzone').addEventListener('mouseleave', (e) => { if (!panelEl.contains(e.relatedTarget)) { clearTimeout(peekT); peek(false); } });
  panelEl.addEventListener('mouseenter', () => clearTimeout(peekT));
  panelEl.addEventListener('mouseleave', (e) => { if (e.relatedTarget !== $('#peekzone')) peek(false); });

  if (window.XENO_LIVE_CHAT) { const st = document.createElement('style'); st.id = 'live-chat-css'; st.textContent = window.XENO_LIVE_CHAT.css; document.head.appendChild(st); }
  if (window.XENO_LIVE_DASHBOARD) { const st = document.createElement('style'); st.id = 'live-dashboard-css'; st.textContent = window.XENO_LIVE_DASHBOARD.css; document.head.appendChild(st); }
  // the captured dashboard's buttons, wired to the shell (its React handlers are not in a capture)
  document.addEventListener('click', (e) => {
    const d = e.target.closest('.live-dash'); if (!d) return;
    const card = e.target.closest('.xeno-start-card');
    if (card) { const t = card.textContent; if (/Ask XENO/.test(t)) openProduct('chat'); else if (/automation/i.test(t)) openProduct('workflow'); else toast('Projects'); return; }
    if (e.target.closest('.xeno-dashboard-command')) return openPalette();
    if (e.target.closest('.xeno-primary-button')) return toast('Add credits');
    const sb = e.target.closest('.xeno-secondary-button, .xeno-icon-button'); if (sb) toast(sb.textContent.trim() || 'More options');
  });
  // ---- resizable sidebar: drag the edge, double-click to reset, remembered ----
  (() => {
    const W0 = 268, MIN = 220, MAX = 420;
    // a focusable separator reports where it is (WAI-ARIA window splitter): value, range and a spoken value
    const setW = (w) => { const v = Math.round(Math.max(MIN, Math.min(MAX, w))); root.style.setProperty('--panel-w', v + 'px'); const g = document.querySelector('#slot > .grip'); if (g) { g.setAttribute('aria-valuenow', v); g.setAttribute('aria-valuetext', `Sidebar ${v} pixels wide`); } };
    const saved = store.get('panelW', W0); if (saved !== W0) setW(saved);
    const grip = document.createElement('div'); grip.className = 'grip'; grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical'); grip.setAttribute('aria-label', 'Resize sidebar'); grip.setAttribute('aria-valuemin', MIN); grip.setAttribute('aria-valuemax', MAX); grip.tabIndex = 0;
    grip.dataset.tip = 'Drag to resize · double-click to reset';
    $('#slot').appendChild(grip);
    { const w = Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--panel-w')) || W0); grip.setAttribute('aria-valuenow', w); grip.setAttribute('aria-valuetext', `Sidebar ${w} pixels wide`); }
    let x0 = 0, w0 = 0;
    const cur = () => parseFloat(getComputedStyle(root).getPropertyValue('--panel-w')) || W0;
    grip.addEventListener('pointerdown', (e) => { if (root.dataset.panel !== 'open') return; x0 = e.clientX; w0 = cur(); grip.setPointerCapture(e.pointerId); root.classList.add('resizing'); });
    grip.addEventListener('pointermove', (e) => { if (!root.classList.contains('resizing')) return; setW(w0 + e.clientX - x0); });
    const end = () => { if (!root.classList.contains('resizing')) return; root.classList.remove('resizing'); store.set('panelW', cur()); };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => { root.classList.add('resizing'); setW(W0); store.set('panelW', W0); requestAnimationFrame(() => root.classList.remove('resizing')); toast('Sidebar width reset'); });
    grip.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setW(cur() + (e.key === 'ArrowRight' ? 16 : -16)); store.set('panelW', cur()); } });
  })();
  // the captured chat carries its own 'XENO' title + history toggle; the shell owns those
  function hideChatOwnHeader() {
    const btn = document.querySelector('.live-chat [aria-label="Open conversation history"]'); if (!btn) return;
    let n = btn.parentElement;
    while (n && !(n.textContent.trim().length < 40 && n.textContent.includes('XENO') && n.getBoundingClientRect().height < 90)) n = n.parentElement;
    (n || btn).style.display = 'none';
  }
  new MutationObserver(hideChatOwnHeader).observe(document.getElementById('main'), { childList: true, subtree: false });
  // ---- model + effort controls — ported from the approved XENO Agent Panel (menus + locked effort
  // slider: "the chosen cell opens up to hold the word", Ultra fuses into one bar with a lattice) —
  // with the platform's logic on top: "XENO picks" routing, how each model is paid, and the cost.
  const MODELS = window.XENO_MODELS || { list: [], recommended: [] };
  // On the platform the list, the current model and the pick belong to the REAL chat (platform-chat.js hands them
  // over when the chat's trigger is pressed). The menu below is the same design either way; with the real list it
  // shows only what is real: no "XENO picks" row (the chat has no router), no speed, depth or cost that nobody measured.
  const LP = () => (window.XENO_CHAT && window.XENO_CHAT.served && window.XENO_CHAT.picker) || null;
  const liveModel = (m) => ({ id: m.id, name: m.name, blurb: m.description || '', provider: m.ownKey ? 'own' : '', ctx: m.contextWindow || 0, ownKey: !!m.ownKey });
  const modelById = (id) => { const lp = LP(); if (lp) { const m = lp.models.find((x) => x.id === id); return m ? liveModel(m) : { id, name: 'Model', blurb: '' }; } return MODELS.list.find((m) => m.id === id) || MODELS.list[0]; };
  const EFFORT_PICTURE = ['Minimal', 'Low', 'Medium', 'High', 'Max', 'Ultra'];
  // On the platform the levels, the one in force and the pick belong to the REAL chat, as the model list does.
  // The menu is the same design; it shows the chat's real levels and no cost or seconds that nobody measured.
  const LE = () => (window.XENO_CHAT && window.XENO_CHAT.served && window.XENO_CHAT.effort) || null;
  const EFFORT = new Proxy(EFFORT_PICTURE, { get: (t, k) => { const le = LE(); const src = le ? le.levels.map((l) => l.label) : t; const v = src[k]; return typeof v === 'function' ? v.bind(src) : v; } });
  const MAIN_MODELS = ['gpt-5.6-terra', 'claude-opus-5.5', 'gemini-3.8-flash', 'claude-sonnet-5.5'];
  const routeOf = (m) => (LP() ? (m.ownKey ? 'your key' : '') : store.get('byok', ['anthropic']).includes(m.provider.toLowerCase()) ? 'your key' : '');
  const costFor = (m, lvl) => Math.max(1, Math.round((m.cost || 3) * [0.5, 0.75, 1, 1.5, 2.2, 3.2][lvl]));
  const META = window.XENO_MODEL_META || {}, HINT = window.XENO_EFFORT_HINT || [];
  const metaOf = (id) => META[id] || { speed: 3, depth: 3, ctx: '—', maxEffort: 5, secs: 5 };
  const pickFor = () => 'gpt-5.6-terra';   // what XENO picks would route the next message to (the router's verdict, sampled)
  const effModelId = () => (store.get('modelDefault', false) ? pickFor() : store.get('model', 'gpt-5.6-terra'));
  const maxEff = () => (LE() ? LE().levels.length - 1 : metaOf(effModelId()).maxEffort);
  const secsFor = (lvl) => Math.round(metaOf(effModelId()).secs * [0.5, 0.8, 1, 1.8, 3, 5][lvl]);
  const effIdx = () => { const le = LE(); if (le) return Math.max(0, le.levels.findIndex((l) => l.id === le.selected)); const v = store.get('effort', 'Medium'); const i = EFFORT.indexOf(v); return Math.min(i < 0 ? 2 : i, maxEff()); };
  const curModel = () => (LP() ? modelById(LP().selected) : store.get('modelDefault', false) ? { id: 'auto', name: 'XENO picks', effort: true, cost: 3, provider: 'auto' } : modelById(store.get('model', 'gpt-5.6-terra')));
  function paintModelTrigger() {
    const t = document.querySelector('.live-chat [data-chat-model-trigger]'); if (!t) return;
    const m = curModel(), open = document.querySelector('#apmenu.show')?.dataset.kind;
    t.classList.add('xm-model', 'apx');
    t.setAttribute('aria-label', `Model ${m.name}${m.effort ? ', effort ' + EFFORT[effIdx()] : ''}`);
    t.innerHTML = `<span class="ap-txt${open === 'model' ? ' open' : ''}" data-part="model" title="Which model answers"><span class="ap-model">${esc(m.name)}</span></span>`
      + (m.effort ? `<span class="ap-vr" aria-hidden="true"></span><span class="ap-txt ap-pillbtn${open === 'effort' ? ' open' : ''}" data-part="effort" title="How long the model thinks before it answers"><span class="ap-pill">${EFFORT[effIdx()]}</span></span>` : '');
  }
  function apMenu() { let m = document.getElementById('apmenu'); if (!m) { m = document.createElement('div'); m.id = 'apmenu'; m.className = 'apx ap-menu'; document.body.appendChild(m); } return m; }
  function closeAp() { const m = document.getElementById('apmenu'), was = !!(m && m.classList.contains('show')); if (m) { m.classList.remove('show'); m.dataset.kind = ''; } hideCard(); paintModelTrigger(); paintAnsweredBy(); if (was && (LP() || LE())) window.XENO_CHAT.pickerClosed(); }
  function placeAp(anchor) { const m = apMenu(), r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    // effort centres over the whole trigger (stable — the pill's text cannot move it); the model list right-aligns
    const want = m.dataset.kind === 'effort' ? r.left + r.width / 2 - w / 2 : r.right - w;
    m.style.left = Math.min(innerWidth - w - 12, Math.max(12, want)) + 'px'; m.style.top = Math.max(12, r.top - h - 8) + 'px'; syncCard(); }
  function openModelMenu(anchor, kind) {
    hidePops();
    const m = apMenu(); m.dataset.kind = kind; m.dataset.find = ''; m.dataset.q = ''; m.style.width = kind === 'effort' ? '268px' : '236px';
    if (kind === 'effort') renderEffort(m); else renderModels(m);
    m.classList.add('show'); paintModelTrigger(); placeAp(anchor);
    // anchor to the WHOLE trigger's right edge — the changing pill text cannot move it
    const live = document.querySelector('.live-chat [data-chat-model-trigger]'); if (live) placeAp(live);
    if (LE() && kind === 'effort') placeAp(anchor);   // the real chat's pill is in its frame: the place it handed over is the anchor
  }
  function renderModels(m) {
    const cur = curModel(), more = m.dataset.allModels === '1', lp = LP();
    // the real list keeps the order the platform gives it; the first four are the short list
    const all = lp ? lp.models.map((x) => x.id) : MODELS.list.map((x) => x.id), main = lp ? all.slice(0, 4) : MAIN_MODELS;
    const rest = all.filter((id) => !main.includes(id));
    const list = more ? [...main, ...rest] : main.concat(rest.includes(cur.id) ? [cur.id] : []);
    const row = (id, i) => { const x = modelById(id), on = cur.id === id;
      return `<button class="row${on ? ' on' : ''}" data-model="${id}"><span class="rail"></span><span>${esc(x.name)}</span>${routeOf(x) ? `<span class="key">${routeOf(x)}</span>` : ''}<span class="idx num">${i + 1}</span></button>`; };
    // SEARCH (owner, 2026-10-09): the magnifier at the right of the header turns the header itself, at its own
    // height, into the field. A search looks through EVERY model, whatever "More models" is showing.
    const finding = m.dataset.find === '1', q = (m.dataset.q || '').trim().toLowerCase();
    const shown = finding && q ? all.filter((id) => { const x = modelById(id); return (x.name + ' ' + id).toLowerCase().includes(q); }) : list;
    const glass = '<path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.7-4.7"/>';
    const head = finding
      ? `<div class="h ap-head finding"><svg class="ap-find-ic" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true">${glass}</svg><input class="ap-q" data-model-q type="text" placeholder="Search models" aria-label="Search models" autocomplete="off" spellcheck="false"></div>`
      : `<div class="h label ap-head"><span>Model</span><button type="button" class="ap-find" data-model-find aria-label="Search models" title="Search models"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true">${glass}</svg></button></div>`;
    const keep = m.querySelector('.ap-scroll') ? m.querySelector('.ap-scroll').scrollTop : null;
    const picks = lp || (finding && q) ? '' : `<button class="row tall${cur.id === 'auto' ? ' on' : ''}" data-model="auto"><span class="rail"></span><span class="col"><span>XENO picks</span><span class="sub">Now → ${esc(modelById(pickFor()).name)} for this message</span></span></button>`;
    const none = `<div class="row" aria-disabled="true"><span class="rail"></span><span>${finding && q ? 'No model matches' : 'No models are available'}</span></div>`;
    const foot = !(finding && q) && ((more && rest.length) || rest.some((id) => !list.includes(id))) ? `<div class="hr"></div>
      <button class="row" data-more-models><span class="rail"></span><span>${more ? 'Fewer models' : 'More models'}</span><span class="chev"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="${more ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'}"/></svg></span></button>` : '';
    m.innerHTML = `${head}<div class="ap-scroll" data-model-scroll>${picks}${shown.length ? shown.map(row).join('') : none}</div>${foot}`;
    // The list scrolls inside a fixed height (it used to grow to 23 rows, taller than the page). No bar: a fade at
    // whichever end has more says there is more, and goes when that end is reached.
    const sc = m.querySelector('.ap-scroll');
    const edges = () => { sc.classList.toggle('more-below', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1); sc.classList.toggle('more-above', sc.scrollTop > 1); };
    sc.addEventListener('scroll', edges, { passive: true });
    if (keep !== null && !finding) sc.scrollTop = keep; else { const on = sc.querySelector('.row.on'); if (on && !(finding && q)) sc.scrollTop = Math.max(0, on.offsetTop - sc.offsetTop - sc.clientHeight / 2 + on.offsetHeight / 2); }
    edges();
    const reanchor = () => { const a = (LP() && LP().anchor) || document.querySelector('.live-chat [data-part="model"]'); if (a) placeAp(a); };
    const input = m.querySelector('[data-model-q]');
    if (input) { input.value = m.dataset.q || ''; input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('input', () => { m.dataset.q = input.value; renderModels(m); reanchor(); }); }
  }
  // the card is a satellite of the menu: whenever the menu re-renders or moves, the card follows it,
  // or leaves if the row it described is gone (More/Fewer models re-lays the list under the pointer)
  let cardId = null;
  function syncCard() { const c = document.getElementById('apcard'); if (!c || !c.classList.contains('show')) return; const m = document.getElementById('apmenu'); if (m && m.dataset.kind === 'model' && m.querySelector('[data-model="' + cardId + '"]')) detailCard(cardId); else hideCard(); }
  function detailCard(id) {
    cardId = id;
    if (LP()) { // the real list: the name, what the platform says about it, and its context. Nothing estimated.
      const x = modelById(id); if (!x.blurb && !x.ctx) return hideCard();
      let c = document.getElementById('apcard'); if (!c) { c = document.createElement('div'); c.id = 'apcard'; c.className = 'apx ap-card'; document.body.appendChild(c); }
      const ctx = x.ctx >= 1000000 ? (x.ctx / 1000000).toFixed(x.ctx % 1000000 ? 1 : 0) + 'M' : x.ctx >= 1000 ? Math.round(x.ctx / 1000) + 'k' : String(x.ctx || '');
      c.innerHTML = `<div class="ct">${esc(x.name)}</div>${x.blurb ? `<div class="cs">${esc(x.blurb)}</div>` : ''}<div class="cf">${ctx ? `<span>${ctx} context</span>` : ''}<span>${x.ownKey ? 'Your key' : 'Credits'}</span></div>`;
      const m = document.getElementById('apmenu'), r = m.getBoundingClientRect(), w = 232; c.style.width = w + 'px'; c.style.left = (r.left - w - 8 >= 8 ? r.left - w - 8 : r.right + 8) + 'px';
      const row = m.querySelector(`[data-model="${CSS.escape(id)}"]`), rr = row ? row.getBoundingClientRect() : r; c.classList.add('show'); c.style.top = Math.max(r.top, Math.min(r.bottom - c.offsetHeight, rr.top - 8)) + 'px'; return;
    }
    let c = document.getElementById('apcard'); if (!c) { c = document.createElement('div'); c.id = 'apcard'; c.className = 'apx ap-card'; document.body.appendChild(c); }
    const isAuto = id === 'auto', mid = isAuto ? pickFor() : id, x = modelById(mid), mt = metaOf(mid);
    const bars = (n) => '<span class="bars">' + [1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('') + '</span>';
    c.innerHTML = `<div class="ct">${isAuto ? 'XENO picks' : esc(x.name)}</div>
      <div class="cs">${isAuto ? 'Routes every message to the best model for it. Right now: <b>' + esc(x.name) + '</b>.' : esc(x.blurb)}</div>
      <div class="cg"><span>Speed</span>${bars(mt.speed)}<span class="tps">${mt.tps ? mt.tps + ' tok/s' : ''}</span><span>Depth</span>${bars(mt.depth)}<span></span></div>
      <div class="cf"><span>${mt.ctx} context</span><span>≈ ${x.cost} cr / msg</span><span>${isAuto ? 'Credits' : (routeOf(x) ? 'Your key' : 'Credits')}</span></div>`;
    const m = document.getElementById('apmenu'), r = m.getBoundingClientRect(), w = 232;
    c.style.width = w + 'px';
    const left = r.left - w - 8 >= 8 ? r.left - w - 8 : r.right + 8;
    c.style.left = left + 'px';
    const row = m.querySelector(`[data-model="${id}"]`); const rr = row ? row.getBoundingClientRect() : r;
    c.classList.add('show');
    // follow the hovered row, but never drop below the menu's bottom edge (the composer sits there)
    c.style.top = Math.max(r.top, Math.min(r.bottom - c.offsetHeight, rr.top - 8)) + 'px';
  }
  function hideCard() { document.getElementById('apcard')?.classList.remove('show'); }
  document.addEventListener('mouseover', (e) => { const r = e.target.closest('#apmenu[data-kind="model"] .row[data-model]'); if (r) detailCard(r.dataset.model); });
  document.addEventListener('focusin', (e) => { const r = e.target.closest('#apmenu[data-kind="model"] .row[data-model]'); if (r) detailCard(r.dataset.model); });
  document.addEventListener('mouseout', (e) => { const m = document.getElementById('apmenu'); if (m && m.contains(e.target) && !m.contains(e.relatedTarget)) hideCard(); });
  // effort card v3 — XENO's own construction, not Codex's: a header plate and a body plate on a shell
  // (DESIGN_SYSTEM plate construction), six square cells instead of a knob on a pill (no circles),
  // level names printed under the cells, the model's cap shown as hatched cells, Ultra = lattice.
  function renderEffort(m) {
    m.style.width = (LE() ? Math.max(168, Math.min(288, EFFORT.length * 48)) : 288) + 'px';
    m.innerHTML = `<div class="ef3-plate ef3-body">
        <div class="ef3-cells" id="aptrack" tabindex="0" role="slider" aria-label="Effort" aria-valuemin="0" aria-valuemax="${EFFORT.length - 1}">
          ${EFFORT.map((l, k) => `<span class="ef3-cell" data-k="${k}"></span>`).join('')}
        </div>
        <div class="ef3-labels">${EFFORT.map((l, k) => `<span data-k="${k}">${l}</span>`).join('')}</div>
      </div>`;
    const t = m.querySelector('#aptrack');
    // Agent Panel drag: the level under the pointer is whichever CELL is under it — not an equal
    // sixth of the track, because the chosen cell is wider than the rest. In a gap, the nearest
    // cell wins. Press anywhere, drag across; the pointer is captured so it keeps working outside.
    const cells = [...t.querySelectorAll('.ef3-cell')];
    const fromX = (x) => {
      let best = 0, dist = Infinity;
      cells.forEach((c, i) => { const r = c.getBoundingClientRect(); const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0; if (d < dist) { dist = d; best = i; } });
      return best;
    };
    t.addEventListener('click', (e) => e.stopPropagation());
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); t.setPointerCapture(e.pointerId); t.focus({ focusVisible: false });
      setEffort(fromX(e.clientX));
      const move = (ev) => { const n = Math.min(maxEff(), fromX(ev.clientX)); hint(fromX(ev.clientX)); if (n !== effIdx()) setEffort(n); };
      const up = () => { t.removeEventListener('pointermove', move); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); hint(effIdx()); };
      t.addEventListener('pointermove', move); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
    });
    cells.forEach((c, i) => c.addEventListener('mouseenter', () => { hint(i); cells.forEach((x, j) => x.classList.toggle('pre', j <= i && j > effIdx() && j <= maxEff())); }));
    t.addEventListener('mouseleave', () => { hint(effIdx()); cells.forEach((x) => x.classList.remove('pre')); });
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setEffort(effIdx() + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setEffort(effIdx() - 1); }
    });
    paintEffort();
    setTimeout(() => t.focus({ focusVisible: false }), 30);
  }
  function paintEffort() {
    const t = document.getElementById('aptrack'); if (!t) return;
    const on = effIdx(), mx = maxEff(), ultra = on === EFFORT.length - 1 && EFFORT[on] === 'Ultra' && EFFORT.length === 6;
    // FLIP: remember every cell and label box, let the layout snap, then glide each one home
    const moving = [...t.querySelectorAll('.ef3-cell'), ...document.querySelectorAll('#apmenu .ef3-labels span')];
    const before = moving.map((c) => c.getBoundingClientRect());
    const moved = !t.querySelector('.ef3-cell.cur') || +t.querySelector('.ef3-cell.cur').dataset.k !== on;
    t.classList.toggle('ultra', ultra); document.querySelector('#apmenu .ef3-labels')?.classList.toggle('ultra', ultra);
    t.querySelectorAll('.ef3-cell').forEach((c) => {
      const k = +c.dataset.k;
      c.classList.toggle('fill', k <= on); c.classList.toggle('cur', k === on);
      c.classList.toggle('na', k > mx); c.classList.toggle('ultra', ultra && k <= on);
      c.disabled = k > mx;
    });
    document.querySelectorAll('#apmenu .ef3-labels span').forEach((s) => {
      const k = +s.dataset.k; s.classList.toggle('cur', k === on); s.classList.toggle('na', k > mx);
    });
    t.setAttribute('aria-valuenow', String(on)); t.setAttribute('aria-valuetext', EFFORT[on]);
    apLattice(t, ultra);
    if (moved && before[0].width > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      moving.forEach((c, i) => {
        const p = before[i], b = c.getBoundingClientRect();
        const dx = p.left - b.left, sx = p.width / b.width;
        if (Math.abs(dx) < 0.5 && Math.abs(sx - 1) < 0.01) return;
        c.animate([{ transform: 'translateX(' + dx + 'px) scaleX(' + sx + ')' }, { transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }
    const n = document.querySelector('#apmenu .ef3-name'); if (n) n.textContent = EFFORT[on];
    hint(on);
  }
  function hint(i) {
    const el = document.querySelector('#apmenu [data-hint]'); if (!el) return;
    if (LE()) { el.textContent = (LE().levels[i] && LE().levels[i].title) || ''; el.classList.remove('na'); return; }
    if (i > maxEff()) { el.textContent = `Not on ${modelById(effModelId()).name}`; el.classList.add('na'); return; }
    el.classList.remove('na');
    el.innerHTML = `${i === effIdx() ? '' : `<b>${EFFORT[i]}</b> · `}≈ ${costFor(modelById(effModelId()), i)} cr · ~${secsFor(i)}s`;
  }
  // Agent Panel's Ultra: the five cells below Ultra FUSE into one bar, and a fixed lattice of 2px
  // squares on a 3px pitch runs it. Nothing moves — a crest of brightness travels right-to-left,
  // stepping up through five bands toward Ultra, and every square twinkles on its own clock.
  function apLattice(t, want) {
    let f = t.querySelector('.ef3-flow');
    if (!want) { if (f) f.remove(); return; }
    if (f) return;
    f = document.createElement('span'); f.className = 'ef3-flow';
    const cells = t.querySelectorAll('.ef3-cell'), first = cells[0], last = cells[4];
    const x0 = first.offsetLeft, w = last.offsetLeft + last.offsetWidth - x0, h = first.offsetHeight;
    f.style.left = x0 + 'px'; f.style.width = w + 'px'; f.style.height = h + 'px';
    const cols = Math.ceil(w / 3), rows = Math.floor((h - 1) / 3), r = Math.random;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = col * 3 + 1, band = Math.min(4, Math.floor((x / w) * 5));
      const sq = document.createElement('i');
      sq.style.setProperty('--x', x + 'px'); sq.style.setProperty('--y', (row * 3 + 1) + 'px');
      sq.style.setProperty('--lo', (0.07 + band * 0.025).toFixed(3));
      sq.style.setProperty('--hi', (0.30 + band * 0.16).toFixed(2));
      sq.style.setProperty('--wd', -Math.round(x * 15 + r() * 80) + 'ms');
      sq.style.setProperty('--tt', Math.round(420 + r() * 900) + 'ms');
      sq.style.setProperty('--td', -Math.round(r() * 1300) + 'ms');
      f.appendChild(sq);
    }
    t.appendChild(f);
  }
  function setEffort(n) { n = Math.max(0, Math.min(maxEff(), n)); if (LE()) { if (n !== effIdx()) window.XENO_CHAT.pickEffort(LE().levels[n].id); paintEffort(); return; } store.set('effort', EFFORT[n]); paintEffort(); paintModelTrigger(); }   // pinned where it opened — re-anchoring made the card chase the pill's width
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.live-chat [data-chat-model-trigger]');
    if (t) { e.preventDefault(); e.stopPropagation(); const part = e.target.closest('[data-part]'); const kind = part?.dataset.part === 'effort' ? 'effort' : 'model';
      const m = document.getElementById('apmenu'); if (m?.classList.contains('show') && m.dataset.kind === kind) return closeAp(); return openModelMenu(part || t, kind); }
    const m = document.getElementById('apmenu'); if (!m?.classList.contains('show')) return;
    if (!m.contains(e.target)) return closeAp();
    if (e.target.closest('[data-model-find]')) { m.dataset.find = '1'; m.dataset.q = ''; renderModels(m); const a = (LP() && LP().anchor) || document.querySelector('.live-chat [data-part="model"]'); if (a) placeAp(a); return; }
    if (e.target.closest('[data-more-models]')) { m.dataset.allModels = m.dataset.allModels === '1' ? '' : '1'; renderModels(m); const a = (LP() && LP().anchor) || document.querySelector('.live-chat [data-part="model"]'); if (a) placeAp(a); return; }
    const r = e.target.closest('[data-model]'); if (r && LP()) { window.XENO_CHAT.pickModel(r.dataset.model); return closeAp(); }
    if (r) { if (r.dataset.model === 'auto') store.set('modelDefault', true); else { store.set('modelDefault', false); store.set('model', r.dataset.model); } closeAp(); }
  }, true);
  function paintAnsweredBy() {
    const msgs = document.querySelectorAll('.live-chat [aria-label*="Copy" i], .live-chat [title*="Copy" i]');
    const btn = msgs[msgs.length - 1]; if (!btn) return;
    let row = btn.parentElement; while (row && row.querySelectorAll("button").length < 3) row = row.parentElement; if (!row) return;
    let tag = row.parentElement.querySelector(':scope > .ap-answered'); if (!tag) { tag = document.createElement('div'); tag.className = 'ap-answered'; row.after(tag); }
    const auto = store.get('modelDefault', false), m = modelById(effModelId());
    tag.textContent = (auto ? 'XENO picked ' : '') + m.name + ' · ' + EFFORT[effIdx()] + ' · ' + costFor(m, effIdx()) + ' cr';
  }
  new MutationObserver(() => setTimeout(paintAnsweredBy, 50)).observe(document.getElementById('main'), { childList: true });
  document.addEventListener('keydown', (e) => {
    const m = document.getElementById('apmenu'); if (!m?.classList.contains('show')) return;
    if (e.key === 'Escape' && m.dataset.kind === 'model' && m.dataset.find === '1') { e.stopPropagation(); e.preventDefault(); m.dataset.find = ''; m.dataset.q = ''; renderModels(m); const a = (LP() && LP().anchor) || document.querySelector('.live-chat [data-part="model"]'); if (a) placeAp(a); return; }
    if (e.key === 'Escape') { e.stopPropagation(); return closeAp(); }
    if (m.dataset.kind === 'model' && m.dataset.find === '1' && e.key === 'Enter') { const r = m.querySelector('.ap-scroll .row[data-model]'); if (r) { e.preventDefault(); r.click(); } return; }
    if (m.dataset.kind === 'model' && m.dataset.find !== '1' && /^[1-9]$/.test(e.key)) { const rows = m.querySelectorAll('.row[data-model]:not([data-model="auto"])'); const r = rows[+e.key - 1]; if (r) { e.preventDefault(); r.click(); } }
  }, true);
  new MutationObserver(paintModelTrigger).observe(document.getElementById('main'), { childList: true });
  // ---- boot ----
  root.classList.add('noanim');
  setPanel(S.panel === 'closed' ? 'closed' : 'open', false);
  // PROTOTYPE ONLY — Ctrl Shift R (the browser's hard reload) brings the first-run sheets back, so we can
  // review them again. The key reaches the page just before the browser reloads; we leave a note in
  // sessionStorage and act on it here, on the fresh load. A plain F5 changes nothing.
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') { try { sessionStorage.setItem('xw.firstRun', '1'); } catch {} } }, true);
  let firstRunReset = false;
  try { if (sessionStorage.getItem('xw.firstRun')) { sessionStorage.removeItem('xw.firstRun'); ['introSeen', 'adConsent', 'adOn', 'adUsage', 'adOrder', 'adPrev', 'adTrace', 'adHistory', 'adUndo'].forEach((k) => store.set(k, null)); store.set('adOn', false); firstRunReset = true; } } catch {}
  { const st = hashToState(location.hash); if (st) Object.assign(S, st); }
  render();
  restorePanelMem($('#panel > .pv'));
  syncHash(true);
  applyWorkspace();
  maybeModeIntro(true);
  if (firstRunReset) setTimeout(() => toast('First-run sheets restored — each mode shows its intro again'), 400);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('noanim')));
})();

// the send square lights (Agent Panel --send) only once there is something to send
document.addEventListener('input', (e) => { if (!e.target.matches('.live-chat textarea')) return; const s = document.querySelector('.live-chat button[aria-label="Send message"]'); if (s) s.classList.toggle('xw-ready', e.target.value.trim().length > 0); });
