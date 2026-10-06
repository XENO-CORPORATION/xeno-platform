/* Dialogs — one system for every modal in the workspace (MODES SPEC §7f).
   Construction: a canvas-coloured shell carrying panel plates with 4 px gaps (the workspace in miniature),
   like the rail popovers and the Adaptive sheet. Behaviour: role="dialog" + aria-modal, focus moves in and
   is trapped, Esc / backdrop / Cancel close and return focus to what opened it, Enter submits a form,
   unsaved input is never thrown away silently. Layout: Cancel on the left, the action on the right.
   Pieces: XD.form (every create / rename / assign / invite), XD.confirm (destructive actions),
   XD.settings (Spawn's two-pane Settings, adapted), XD.menu (the "More" menu that leads to them). */
(() => {
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k);
  // same keys and format as the shell's store, read directly so preferences apply before the shell boots (no flash)
  const store = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  let stack = [];   // open dialogs, top last

  // ---------- the shell ----------
  function openShell({ size = 'md', label, html, onMount, onClose, dirty }) {
    const opener = document.activeElement;
    const root = document.createElement('div'); root.className = 'xd'; root.innerHTML = `<div class="xd-back"></div><div class="xd-sh xd-${size}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    document.body.appendChild(root); document.documentElement.classList.add('modal-open');
    const sh = root.querySelector('.xd-sh');
    const api = { root, sh, opener, dirty: dirty || (() => false), close: (why) => close(api, why), onClose };
    stack.push(api);
    requestAnimationFrame(() => root.classList.add('on'));
    root.querySelector('.xd-back').addEventListener('mousedown', () => tryClose(api));
    sh.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tryClose(api); }
      if (e.key === 'Tab') { const f = focusables(sh); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
    sh.addEventListener('click', (e) => { if (e.target.closest('[data-xd-close]')) tryClose(api); });
    onMount?.(api);
    const first = sh.querySelector('[autofocus]') || sh.querySelector('input,textarea,[role="radio"][aria-checked="true"],button:not([data-xd-close])');
    first?.focus({ preventScroll: true }); if (first?.select && first.tagName === 'INPUT') first.select();
    return api;
  }
  const focusables = (r) => [...r.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,[tabindex="0"]')].filter((n) => n.offsetParent !== null);
  // unsaved input: the first Esc or backdrop click asks; the second discards
  function tryClose(api) {
    if (api.dirty() && !api.sh.dataset.warned) { api.sh.dataset.warned = '1'; const w = api.sh.querySelector('.xd-warn'); if (w) { w.hidden = false; w.textContent = 'You have unsaved changes — press Esc again or Cancel to discard them.'; } api.sh.classList.remove('xd-shake'); void api.sh.offsetWidth; api.sh.classList.add('xd-shake'); return; }
    close(api, 'cancel');
  }
  function close(api, why) {
    stack = stack.filter((x) => x !== api);
    api.root.classList.remove('on'); api.root.classList.add('closing');
    setTimeout(() => { api.root.remove(); if (!stack.length) document.documentElement.classList.remove('modal-open'); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170);
    api.onClose?.(why); api.opener?.focus?.({ preventScroll: true });
  }

  // ---------- fields ----------
  const ICONS = ['folder', 'star', 'spark', 'layers', 'doc', 'film', 'image', 'chart', 'flow', 'bot', 'people', 'building', 'megaphone', 'calendar', 'code', 'globe', 'briefcase', 'palette', 'mail', 'box'];
  function field(f) {
    const id = 'xdf-' + f.id, hint = f.hint ? `<small class="xd-hint">${esc(f.hint)}</small>` : '';
    const lab = `<label class="xd-lab" for="${id}">${esc(f.label)}${f.required ? '' : '<em>Optional</em>'}</label>`;
    if (f.type === 'textarea') return `<div class="xd-f" data-f="${f.id}">${lab}<textarea id="${id}" rows="${f.rows || 3}" maxlength="${f.max || 500}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>${hint}<small class="xd-err" hidden></small></div>`;
    if (f.type === 'choice') return `<div class="xd-f" data-f="${f.id}"><span class="xd-lab" id="${id}">${esc(f.label)}</span><div class="xd-choice${f.cols ? ' c' + f.cols : ''}" role="radiogroup" aria-labelledby="${id}">${f.options.map(([v, l, sub, glyph]) => `<button type="button" role="radio" aria-checked="${v === f.value}" tabindex="${v === f.value ? 0 : -1}" data-v="${esc(v)}">${glyph || ''}<span><b>${esc(l)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`).join('')}</div>${hint}</div>`;
    if (f.type === 'seg') return `<div class="xd-f xd-f--row" data-f="${f.id}"><span class="xd-lab" id="${id}">${esc(f.label)}</span><div class="xd-seg" role="radiogroup" aria-labelledby="${id}">${f.options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === f.value}" tabindex="${v === f.value ? 0 : -1}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`;
    if (f.type === 'checks') return `<div class="xd-f" data-f="${f.id}"><span class="xd-lab">${esc(f.label)}</span><div class="xd-checks">${f.options.map(([v, l, sub, av]) => `<button type="button" role="checkbox" aria-checked="${(f.value || []).includes(v)}" data-v="${esc(v)}">${av || ''}<span><b>${esc(l)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><i class="xd-tick">${ic('check')}</i></button>`).join('')}</div>${hint}<small class="xd-err" hidden></small></div>`;
    if (f.type === 'icon') return `<div class="xd-f" data-f="${f.id}"><span class="xd-lab" id="${id}">${esc(f.label)}</span><div class="xd-icons" role="radiogroup" aria-labelledby="${id}">${ICONS.map((k) => `<button type="button" role="radio" aria-checked="${k === (f.value || 'folder')}" tabindex="${k === (f.value || 'folder') ? 0 : -1}" data-v="${k}" aria-label="${k}">${ic(k)}</button>`).join('')}</div></div>`;
    if (f.type === 'chips') return `<div class="xd-f" data-f="${f.id}">${lab}<div class="xd-chips" data-chips><span class="xd-chiplist"></span><input id="${id}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false"></div>${hint}<small class="xd-err" hidden></small></div>`;
    return `<div class="xd-f" data-f="${f.id}">${lab}<input id="${id}" value="${esc(f.value || '')}" maxlength="${f.max || 80}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false"${f.type === 'number' ? ' inputmode="decimal"' : ''}>${hint}<small class="xd-err" hidden></small></div>`;
  }
  // radio groups and segmented controls: arrow keys move, Space/Enter pick (WAI-ARIA radio group)
  function wireChoices(sh) {
    sh.addEventListener('click', (e) => {
      const r = e.target.closest('[role="radio"]'); if (r && r.closest('.xd-choice,.xd-seg,.xd-icons')) { const g = r.parentElement; g.querySelectorAll('[role="radio"]').forEach((x) => { x.setAttribute('aria-checked', String(x === r)); x.tabIndex = x === r ? 0 : -1; }); g.dispatchEvent(new Event('change', { bubbles: true })); return; }
      const c = e.target.closest('[role="checkbox"]'); if (c && c.closest('.xd-checks')) { c.setAttribute('aria-checked', String(c.getAttribute('aria-checked') !== 'true')); c.dispatchEvent(new Event('change', { bubbles: true })); }
      const x = e.target.closest('[data-chip-x]'); if (x) { x.parentElement.remove(); }
    });
    sh.addEventListener('keydown', (e) => {
      const r = e.target.closest?.('[role="radio"]'); if (!r || !/^Arrow/.test(e.key)) return; e.preventDefault();
      const all = [...r.parentElement.querySelectorAll('[role="radio"]')], i = all.indexOf(r), cols = r.parentElement.classList.contains('xd-icons') ? 10 : 1;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]; const n = all[(i + step + all.length) % all.length]; n.click(); n.focus();
    });
  }
  function wireChips(sh) {
    sh.querySelectorAll('[data-chips]').forEach((box) => {
      const input = box.querySelector('input'), list = box.querySelector('.xd-chiplist');
      const add = () => { const parts = input.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean); parts.forEach((v) => { const okv = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); list.insertAdjacentHTML('beforeend', `<span class="xd-chip${okv ? '' : ' bad'}" data-chip="${esc(v)}">${esc(v)}<button type="button" data-chip-x aria-label="Remove ${esc(v)}">${ic('x')}</button></span>`); }); input.value = ''; };
      input.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && input.value.trim()) { e.preventDefault(); e.stopPropagation(); add(); } if (e.key === 'Backspace' && !input.value) list.lastElementChild?.remove(); });
      input.addEventListener('blur', () => input.value.trim() && add());
      box.addEventListener('click', (e) => { if (e.target === box || e.target === list) input.focus(); });
    });
  }
  const valueOf = (sh, f) => { const w = sh.querySelector(`[data-f="${f.id}"]`);
    if (f.type === 'choice' || f.type === 'seg' || f.type === 'icon') return w.querySelector('[aria-checked="true"]')?.dataset.v ?? null;
    if (f.type === 'checks') return [...w.querySelectorAll('[aria-checked="true"]')].map((x) => x.dataset.v);
    if (f.type === 'chips') { const inp = w.querySelector('input'); return [...w.querySelectorAll('[data-chip]')].map((x) => x.dataset.chip).concat(inp.value.trim() ? inp.value.split(/[,;\s]+/).filter(Boolean) : []); }
    return w.querySelector('input,textarea').value.trim(); };

  // ---------- XD.form ----------
  function form({ title, sub, fields, submit = 'Save', danger = false, size = 'md', onSubmit, aside }) {
    const initial = {};
    const html = `<header class="xd-pl xd-head"><div><b id="xd-t">${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><button class="xd-ib" data-xd-close aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></header>
      <form class="xd-pl xd-body" novalidate>${fields.map(field).join('')}${aside ? `<div class="xd-aside">${aside}</div>` : ''}<p class="xd-warn" role="status" hidden></p></form>
      <footer class="xd-pl xd-foot"><button type="button" class="xd-btn ghost" data-xd-close>Cancel</button><span class="xd-sp"></span><button type="button" class="xd-btn${danger ? ' danger' : ''}" data-xd-submit>${esc(submit)}<kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ↵</kbd></button></footer>`;
    return new Promise((resolve) => {
      let done = false;
      const api = openShell({ size, label: title, html, dirty: () => fields.some((f) => JSON.stringify(valueOf(api.sh, f)) !== JSON.stringify(initial[f.id])), onClose: () => { if (!done) resolve(null); } });
      wireChoices(api.sh); wireChips(api.sh);
      fields.forEach((f) => { initial[f.id] = valueOf(api.sh, f); });
      const submitNow = async () => {
        api.sh.querySelectorAll('.xd-err').forEach((e) => { e.hidden = true; e.textContent = ''; }); api.sh.querySelectorAll('.xd-f.bad').forEach((x) => x.classList.remove('bad'));
        const vals = Object.fromEntries(fields.map((f) => [f.id, valueOf(api.sh, f)]));
        let bad = null;
        fields.forEach((f) => { if (bad) return; const v = vals[f.id]; let msg = null;
          if (f.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) msg = f.type === 'checks' ? 'Pick at least one.' : `${f.label} is required.`;
          else if (f.validate) msg = f.validate(v, vals);
          if (msg) { bad = f.id; const w = api.sh.querySelector(`[data-f="${f.id}"]`); w.classList.add('bad'); const e = w.querySelector('.xd-err'); if (e) { e.hidden = false; e.textContent = msg; } (w.querySelector('input,textarea,[role="radio"],[role="checkbox"]'))?.focus(); } });
        if (bad) return;
        const err = await onSubmit?.(vals); if (err) { const w = api.sh.querySelector('.xd-warn'); w.hidden = false; w.textContent = err; return; }
        done = true; resolve(vals); api.close('submit');
      };
      api.sh.querySelector('[data-xd-submit]').addEventListener('click', submitNow);
      api.sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (e.target.tagName === 'INPUT' && !e.target.closest('[data-chips]')))) { e.preventDefault(); submitNow(); } });
      api.sh.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitNow(); });
    });
  }

  // ---------- XD.confirm — says exactly what happens, the destructive word on the button ----------
  function confirm({ title, body, action = 'Delete', danger = true, typeToConfirm }) {
    const html = `<header class="xd-pl xd-head"><div><b>${esc(title)}</b></div><button class="xd-ib" data-xd-close aria-label="Close">${ic('x')}</button></header>
      <div class="xd-pl xd-body"><p class="xd-text">${body}</p>${typeToConfirm ? `<div class="xd-f"><label class="xd-lab" for="xd-type">Type <b>${esc(typeToConfirm)}</b> to confirm</label><input id="xd-type" autocomplete="off" spellcheck="false"></div>` : ''}</div>
      <footer class="xd-pl xd-foot"><button type="button" class="xd-btn ghost" data-xd-close>Cancel</button><span class="xd-sp"></span><button type="button" class="xd-btn${danger ? ' danger' : ''}" data-xd-ok${typeToConfirm ? ' disabled' : ''}>${esc(action)}</button></footer>`;
    return new Promise((resolve) => {
      let ok = false;
      const api = openShell({ size: 'sm', label: title, html, onClose: () => resolve(ok) });
      const b = api.sh.querySelector('[data-xd-ok]'), t = api.sh.querySelector('#xd-type');
      t?.addEventListener('input', () => { b.disabled = t.value.trim() !== typeToConfirm; });
      t?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !b.disabled) b.click(); });
      b.addEventListener('click', () => { ok = true; api.close('ok'); });
      if (!t) api.sh.querySelector('[data-xd-close].xd-btn')?.focus();   // destructive: focus lands on Cancel, never on Delete
    });
  }

  // ---------- XD.menu — a small action menu under a button ("More" on a page header) ----------
  function menu(btn, items) {
    // one menu system: the context-menu engine renders it, so a "…" menu and a right-click menu are the same object
    if (window.XCM) { const secs = [[]]; items.forEach((it) => (it === '-' ? secs.push([]) : secs[secs.length - 1].push({ label: it.label, icon: it.icon, kbd: it.kbd, danger: it.danger, run: it.run })));
      const r = btn.getBoundingClientRect(); return window.XCM.show(secs.filter((x) => x.length), { x: Math.max(8, r.right - 232), y: r.bottom + 6, opener: btn, keyboard: true, label: btn.getAttribute('aria-label') || 'Actions' }); }
    document.querySelector('.pg-ddm')?.remove();
    const m = document.createElement('div'); m.className = 'pg-ddm xd-menu'; m.setAttribute('role', 'menu'); m._btn = btn;
    m.innerHTML = items.map((it) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${esc(it.id)}" class="${it.danger ? 'danger' : ''}">${ic(it.icon)}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`).join('');
    document.body.appendChild(m); const r = btn.getBoundingClientRect(); m.style.minWidth = '200px'; m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 12)) + 'px'; m.style.top = r.bottom + 6 + 'px';
    btn.setAttribute('aria-expanded', 'true'); m.querySelector('button')?.focus();
    const shut = () => { m.remove(); btn.setAttribute('aria-expanded', 'false'); };
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; shut(); items.find((x) => x.id === b.dataset.i)?.run(); });
    m.addEventListener('keydown', (e) => { const all = [...m.querySelectorAll('button')], i = all.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); btn.focus(); } if (e.key === 'Tab') shut(); });
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!e.target.closest('.xd-menu')) { shut(); document.removeEventListener('mousedown', off, true); } }, true), 0);
  }

  // ---------- XD.settings — personal preferences, two panes (Spawn's Settings, adapted) ----------
  const PREF_DEF = { text: 'default', density: 'comfortable', motion: 'system', contrast: false, hints: true, startIn: 'last', links: 'same', ntDesktop: true, ntDigest: 'daily', ntSound: false, analytics: true, scope: 'all' };
  const prefs = () => ({ ...PREF_DEF, ...(store.get('prefs', {}) || {}) });
  function applyPrefs() { const p = prefs(), r = document.documentElement; r.dataset.text = p.text; r.dataset.density = p.density; r.dataset.motion = p.motion; r.dataset.contrast = p.contrast ? 'high' : 'normal'; r.dataset.hints = p.hints ? 'on' : 'off'; }
  const SECTIONS = [['general', 'General', 'gear'], ['appearance', 'Appearance', 'palette'], ['notifications', 'Notifications', 'bell'], ['modes', 'Modes', 'layers'], ['privacy', 'Privacy & data', 'globe'], ['keyboard', 'Keyboard', 'terminal'], ['account', 'Account', 'user']];
  function settings(section = 'general') {
    if (window.XENO_SETTINGS) return window.XENO_SETTINGS.open(section);   // one place: the full-page account centre (MODES §7j)
    let cur = section, q = '';
    const seg = (key, opts) => { const p = prefs(); return `<div class="xd-seg" role="radiogroup" data-pref="${key}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(p[key]) === String(v)}" tabindex="${String(p[key]) === String(v) ? 0 : -1}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`; };
    const sw = (key) => `<button type="button" class="xd-sw" role="switch" aria-checked="${!!prefs()[key]}" data-pref-sw="${key}"><i></i></button>`;
    const row = (t, sub, ctl, kw = '') => `<div class="xd-set" data-kw="${esc((t + ' ' + sub + ' ' + kw).toLowerCase())}"><span><b>${esc(t)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${ctl}</div>`;
    const modes = window.XENO_MODES, x = X();
    const body = {
      general: () => `<h3>General</h3>${row('When you sign in, open', 'Where XENO starts', seg('startIn', [['last', 'Where I left off'], ['overview', 'Overview'], ['default', 'My default mode']]), 'start page')}
        ${row('Default mode', 'Used by "My default mode" and new chats', `<div class="xd-seg grid3" role="radiogroup" data-primary>${modes.map((m) => `<button type="button" role="radio" aria-checked="${store.get('primary', 'studio') === m.id}" data-v="${m.id}">${esc(x.M[m.id].name)}</button>`).join('')}</div>`, 'studio office social corpo dev tools')}
        ${row('Open links from chats', '', seg('links', [['same', 'In XENO'], ['new', 'In a new tab']]))}`,
      appearance: () => `<h3>Appearance</h3>${row('Text size', 'Scales the whole interface', seg('text', [['compact', 'Compact'], ['default', 'Default'], ['large', 'Large']]), 'font zoom')}
        ${row('Density', 'Row height in lists and tables', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']]))}
        ${row('Motion', 'Animations and transitions', seg('motion', [['system', 'Follow system'], ['reduce', 'Reduced'], ['full', 'Full']]), 'reduced motion animation')}
        ${row('High contrast', 'Brighter secondary text and lines', sw('contrast'))}
        ${row('Keyboard hints in the status bar', 'The keys that work on each page', sw('hints'), 'shortcuts footer')}`,
      notifications: () => `<h3>Notifications</h3>${row('Desktop notifications', 'For things that need you — approvals, questions, handoffs', sw('ntDesktop'))}
        ${row('Email digest', 'A summary of what happened while you were away', seg('ntDigest', [['off', 'Off'], ['daily', 'Daily'], ['weekly', 'Weekly']]))}
        ${row('Sound', 'A short sound when something needs you', sw('ntSound'))}
        <p class="xd-note">Per-mode and per-product rules live in the Notifications popover → Settings.</p>`,
      modes: () => { const h = x.hiddenModes(); return `<h3>Modes</h3><p class="xd-note">Hidden modes leave the switcher and the logo cycle. Everything in them stays reachable from search.</p>${x.modeOrder().filter((id) => id !== 'overview').map((id) => row(x.M[id].name, (modes.find((m) => m.id === id) || {}).persona || '', `<button type="button" class="xd-sw" role="switch" aria-checked="${!h.has(id)}" data-mode-sw="${id}" aria-label="Show ${esc(x.M[id].name)}"><i></i></button>`)).join('')}`; },
      privacy: () => `<h3>Privacy & data</h3>${row('Adaptive', 'Lets one workspace reorder itself from what you use — off unless you turn it on', `<button type="button" class="xd-btn ghost sm" data-adaptive-settings>${store.get('adOn', false) ? 'Manage' : 'Turn on…'}</button>`, 'tracking personalisation')}
        ${row('Product analytics', 'Anonymous usage counts that help us fix what is slow or broken', sw('analytics'))}
        ${row('Download my data', 'Everything in your account, as a ZIP', '<button type="button" class="xd-btn ghost sm" data-export>Request export</button>', 'gdpr export')}
        ${row('Clear this device', 'Forgets layouts, pins and previews saved in this browser', '<button type="button" class="xd-btn ghost sm danger" data-clear-local>Clear…</button>', 'cache local storage reset')}`,
      keyboard: () => `<h3>Keyboard</h3>${[['Ctrl K', 'Find anything'], ['Ctrl \\', 'Show or hide the sidebar'], ['Alt 0–6', 'Overview and each mode'], ['Ctrl ,', 'Settings'], ['Ctrl /', 'All shortcuts'], ['/', 'Search this page'], ['F1', 'Report a problem']].map(([k, l]) => row(l, '', `<kbd class="xd-kbd">${esc(k)}</kbd>`, k)).join('')}<button type="button" class="xd-btn ghost" data-all-keys>Show every shortcut</button>`,
      account: () => `<h3>Account</h3>${row('Name', '', '<span class="xd-val">Emilian</span>')}${row('Email', '', '<span class="xd-val">emilian@xeno.test</span>')}${row('Plan', 'Credits and billing', '<button type="button" class="xd-btn ghost sm" data-plan>Plan & credits</button>')}
        <div class="xd-danger">${row('Sign out', 'Ends this session on this device', `<button type="button" class="xd-btn ghost sm" data-signout>${ic('leave')}Sign out</button>`)}</div>`,
    };
    const navHTML = () => SECTIONS.map(([id, l, i]) => `<button class="xd-nav${id === cur && !q ? ' on' : ''}" data-sec="${id}" aria-current="${id === cur && !q}">${ic(i)}<span>${l}</span></button>`).join('');
    const content = () => { if (!q) return body[cur](); const hits = SECTIONS.map(([id, l]) => { const t = document.createElement('template'); t.innerHTML = body[id](); const rows = [...t.content.querySelectorAll('.xd-set')].filter((r) => r.dataset.kw.includes(q)); return rows.length ? `<h3>${l}</h3>${rows.map((r) => r.outerHTML).join('')}` : ''; }).join(''); return hits || `<div class="xd-empty"><b>No settings match “${esc(q)}”</b><small>Try a shorter word.</small></div>`; };
    const html = `<aside class="xd-pl xd-side"><b class="xd-side-t" id="xd-t">Settings</b><label class="xd-search">${ic('search')}<input data-set-q placeholder="Search settings" aria-label="Search settings" spellcheck="false"></label><nav class="xd-navs">${navHTML()}</nav>
        <div class="xd-scope"><small>Applies to</small><div class="xd-seg col" role="radiogroup" data-pref="scope">${[['workspace', 'This workspace'], ['all', 'All workspaces']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${prefs().scope === v}" data-v="${v}">${l}</button>`).join('')}</div></div></aside>
      <section class="xd-pl xd-main"><button class="xd-ib xd-x" data-xd-close aria-label="Close settings" data-tip="Close  Esc">${ic('x')}</button><div class="xd-scroll" data-set-body>${content()}</div><p class="xd-saved" role="status" aria-live="polite"></p></section>`;
    const api = openShell({ size: 'lg', label: 'Settings', html });
    const sh = api.sh, paint = () => { sh.querySelector('.xd-navs').innerHTML = navHTML(); sh.querySelector('[data-set-body]').innerHTML = content(); };
    const saved = (msg = 'Saved') => { const s = sh.querySelector('.xd-saved'); s.textContent = msg; s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); };
    const setPref = (k, v) => { const p = prefs(); p[k] = v; store.set('prefs', p); applyPrefs(); saved(); };
    sh.addEventListener('click', async (e) => {
      const n = e.target.closest('[data-sec]'); if (n) { cur = n.dataset.sec; q = ''; sh.querySelector('[data-set-q]').value = ''; paint(); sh.querySelector('[data-set-body]').scrollTop = 0; return; }
      const r = e.target.closest('[role="radio"]'); if (r) { const g = r.parentElement; g.querySelectorAll('[role="radio"]').forEach((y) => { y.setAttribute('aria-checked', String(y === r)); y.tabIndex = y === r ? 0 : -1; });
        if (g.dataset.pref) setPref(g.dataset.pref, r.dataset.v); if (g.hasAttribute('data-primary')) { store.set('primary', r.dataset.v); saved(`${x.M[r.dataset.v].name} is your default mode`); } return; }
      const s = e.target.closest('[data-pref-sw]'); if (s) { const v = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', String(v)); return setPref(s.dataset.prefSw, v); }
      const ms = e.target.closest('[data-mode-sw]'); if (ms) { const shown = x.toggleHidden(ms.dataset.modeSw); ms.setAttribute('aria-checked', String(shown)); x.renderRail?.(); return saved(shown ? 'Shown in the switcher' : 'Hidden from the switcher'); }
      if (e.target.closest('[data-all-keys]')) { api.close('keys'); return x.openShortcuts(); }
      if (e.target.closest('[data-plan]')) { api.close('plan'); return x.openUsage(); }
      if (e.target.closest('[data-adaptive-settings]')) { api.close('adaptive'); return x.openAdConsent?.(); }
      if (e.target.closest('[data-export]')) { e.target.closest('[data-export]').disabled = true; e.target.closest('[data-export]').textContent = 'Requested'; return saved('Export requested — we will email you a link'); }
      if (e.target.closest('[data-clear-local]')) { if (await confirm({ title: 'Clear this device?', body: 'Layouts, pins, section order, previews and the setup checklist saved in this browser are forgotten. <b>Your work and account are not touched.</b>', action: 'Clear this device' })) { const keep = store.get('introSeen', {}); Object.keys(localStorage).filter((k) => k.startsWith('xw.') && !k.startsWith('xw.db.'))   /* your work is not device state */.forEach((k) => localStorage.removeItem(k)); store.set('introSeen', keep); applyPrefs(); api.close('cleared'); x.toast('This device was cleared'); x.render(); } return; }
      if (e.target.closest('[data-signout]')) { if (await confirm({ title: 'Sign out?', body: 'You will be signed out of XENO on this device. Running agents keep running.', action: 'Sign out', danger: false })) { api.close('signout'); window.XA.signOutNow(); } }
    });
    sh.querySelector('[data-set-q]').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); paint(); });
    sh.addEventListener('keydown', (e) => { const r = e.target.closest?.('[role="radio"]'); if (r && /^Arrow/.test(e.key)) { e.preventDefault(); const all = [...r.parentElement.querySelectorAll('[role="radio"]')], i = all.indexOf(r), n = all[(i + (/Right|Down/.test(e.key) ? 1 : -1) + all.length) % all.length]; n.click(); n.focus(); } });
    return api;
  }
  applyPrefs();
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); if (!document.querySelector('.xd .xd-lg')) settings(); } });

  // ---------- XD.info — a read-only sheet (What's new, Status): header, one body plate, a Close on the left ----------
  function info({ title, sub, html, size = 'sm', actions = [], onOpen }) {
    const body = `<header class="xd-pl xd-head"><div><b id="xd-t">${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><button class="xd-ib" data-xd-close aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></header>
      <div class="xd-pl xd-body xd-info">${html}</div><footer class="xd-pl xd-foot"><button type="button" class="xd-btn ghost" data-xd-close>Close<kbd>Esc</kbd></button><span class="xd-sp"></span>${actions.map((a, i) => `<button type="button" class="xd-btn${i < actions.length - 1 ? ' ghost' : ''}" data-xd-act="${i}">${esc(a.label)}</button>`).join('')}</footer>`;
    return new Promise((resolve) => { const api = openShell({ size, label: title, html: body, dirty: () => false, onClose: () => resolve() });
      api.sh.addEventListener('click', (e) => { const b = e.target.closest('[data-xd-act]'); if (!b) return; const a = actions[+b.dataset.xdAct]; if (a.close !== false) api.close('action'); a.run?.(); });
      onOpen?.(api.sh, api); });
  }
  window.XD = { form, confirm, info, settings, menu, openShell, prefs, applyPrefs, ICONS };
})();
