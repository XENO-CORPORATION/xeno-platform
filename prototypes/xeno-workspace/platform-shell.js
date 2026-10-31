/* XENO_SHELL — Cloud Shell: a terminal on your own XENO Compute machine, docked at the foot of the workspace and kept
 * while you move between pages (XENO WORKSPACE AGENT SURFACE - SPEC.md P4). Server: services/cloudShell.js.
 *
 *   rail button / Ctrl+`     open or hide the dock
 *   /workspace/shell/<id>    the same shell, full height, by its machine's id
 *
 * Opening asks POST /api/compute/cloud-shell: the platform finds or creates your one Cloud Shell machine, starts it,
 * and returns a one-use ticket; the terminal then connects through wss …/machines/<id>/ports/shell/ws. Inside, `xeno`
 * is preloaded and signed in as YOUR Cloud Shell agent (a key for this connection only, revoked when it closes) —
 * `xeno ws list` shows what it may do. The button appears only when Cloud Shell is open to your account.
 * Terminal: @xterm/xterm (vendor/xterm, MIT), loaded on first open. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SHELL = { served: false, available: false }; return; }
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, status: 0, d: {} }));
  const CLOSE = { 4401: 'The terminal could not sign in. Open it again.', 4403: 'Your access to this machine ended.', 4404: 'This machine has no terminal.',
    4409: 'Your Cloud Shell machine stopped.', 4502: 'The machine refused the terminal.', 4503: 'The terminal is not installed on this machine yet.' };
  const S = { enabled: false, machineId: null, state: 'idle', note: '', open: false, max: false, term: null, fit: null, ws: null, lib: null };
  // A terminal is dark in both themes (Cloud Shell, VS Code, Warp), so its surface is fixed here rather than in the
  // theme-derived stylesheet; monochrome, like the rest of XENO.
  const TERM = { bg: '#0c0c0d', fg: '#e6e3de', dim: '#948d83' };
  let dock = null;

  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  function lib() {
    if (!S.lib) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/xterm/xterm.css'; document.head.appendChild(css);
      S.lib = loadScript('vendor/xterm/xterm.js').then(() => loadScript('vendor/xterm/addon-fit.js'));
    }
    return S.lib;
  }

  function ensureDock() {
    if (dock) return dock;
    dock = document.createElement('section');
    dock.className = 'csh-dock'; dock.hidden = true; dock.setAttribute('aria-label', 'Cloud Shell');
    dock.innerHTML = `<div class="csh-grip" data-csh="grip" title="Drag to resize"></div>
      <div class="csh-head"><b>Cloud Shell</b><span class="csh-state" data-csh="state"><i></i><span></span></span><span class="csh-sp"></span>
        <button data-csh="page" title="Open on its own page" aria-label="Open on its own page">Open page</button>
        <button data-csh="max" title="Full height" aria-label="Full height">Full height</button>
        <button data-csh="restart" title="Start a new session" aria-label="New session">New session</button>
        <button data-csh="hide" title="Hide (Ctrl+\`)" aria-label="Hide Cloud Shell">Hide</button></div>
      <div class="csh-body" data-csh="body" style="background:${TERM.bg}"></div>`;
    document.body.appendChild(dock);
    dock.addEventListener('click', (e) => {
      const b = e.target.closest('[data-csh]'); if (!b) return;
      const k = b.dataset.csh;
      if (k === 'hide') hide();
      else if (k === 'max') { S.max = !S.max; dock.classList.toggle('max', S.max); refit(); }
      else if (k === 'restart') reconnect();
      else if (k === 'page' && S.machineId) X()?.go?.('global', { global: 'shell', item: S.machineId });
      else if (k === 'retry') reconnect();
    });
    // drag the top edge to resize
    dock.querySelector('[data-csh="grip"]').addEventListener('pointerdown', (e) => {
      const y0 = e.clientY, h0 = dock.getBoundingClientRect().height;
      const mv = (ev) => { dock.style.height = Math.max(180, Math.min(window.innerHeight - 60, h0 + (y0 - ev.clientY))) + 'px'; refit(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    new ResizeObserver(() => refit()).observe(dock);
    return dock;
  }

  function setState(state, note = '') {
    S.state = state; S.note = note;
    if (!dock) return;
    const el = dock.querySelector('[data-csh="state"]');
    el.classList.toggle('on', state === 'connected');
    el.querySelector('span').textContent = { idle: '', starting: 'Starting your machine…', connecting: 'Connecting…', connected: S.machineId ? `on ${S.machineId.slice(0, 12)}…` : 'Connected', ended: 'Ended' }[state] || '';
    if (state === 'ended' || state === 'error') {
      const body = dock.querySelector('[data-csh="body"]');
      body.querySelector('.csh-note')?.remove();
      const n = document.createElement('div'); n.className = 'csh-note'; n.style.color = TERM.dim;
      n.innerHTML = `<b style="color:${TERM.fg}">${state === 'error' ? 'Cloud Shell could not open' : 'The session ended'}</b><span>${esc(note)}</span><button class="btn" data-csh="retry">${state === 'error' ? 'Try again' : 'Start a new session'}</button>`;
      if (S.term) S.term.element?.parentElement && (S.term.element.style.display = 'none');
      body.appendChild(n);
    }
  }

  function refit() {
    if (!S.fit || !S.term || !S.open) return;
    try { S.fit.fit(); } catch { return; }
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'resize', cols: S.term.cols, rows: S.term.rows }));
  }

  async function connect() {
    ensureDock();
    const body = dock.querySelector('[data-csh="body"]');
    body.querySelector('.csh-note')?.remove();
    setState('starting');
    const [r] = await Promise.all([api('POST', '/api/compute/cloud-shell', {}), lib().catch(() => null)]);
    if (!window.Terminal || !window.FitAddon) return setState('error', 'The terminal could not load. Reload the page.');
    if (!r.ok) return setState('error', (r.d && r.d.error) || 'Cloud Shell is unavailable right now.');
    const sh = r.d.shell; S.machineId = sh.machineId;
    if (!S.term) {
      S.term = new window.Terminal({ fontFamily: '"DM Mono", ui-monospace, "Cascadia Mono", Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000,
        theme: { background: TERM.bg, foreground: TERM.fg, cursor: TERM.fg, cursorAccent: TERM.bg, selectionBackground: 'rgba(255,255,255,.22)' } });
      S.fit = new window.FitAddon.FitAddon(); S.term.loadAddon(S.fit);
      S.term.open(body);
      S.term.onData((d) => { if (S.ws && S.ws.readyState === 1) S.ws.send(new TextEncoder().encode(d)); });
    } else { S.term.element.style.display = ''; S.term.reset(); }
    setState('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${sh.connect.path}ws`, sh.connect.protocols);
    ws.binaryType = 'arraybuffer'; S.ws = ws;
    ws.onopen = () => { setState('connected'); refit(); S.term.focus(); };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return S.term.write(new Uint8Array(e.data));
      try { const m = JSON.parse(e.data); if (m.type === 'exit') setState('ended', `The shell exited (code ${m.code}).`); } catch { /* not ours */ }
    };
    ws.onclose = (e) => { if (S.ws !== ws) return; S.ws = null; if (S.state !== 'ended') setState('ended', CLOSE[e.code] || e.reason || 'The connection closed.'); };
  }

  function reconnect() { if (S.ws) { const w = S.ws; S.ws = null; try { w.close(); } catch {} } connect(); }
  function show({ max = false } = {}) {
    ensureDock(); S.open = true; dock.hidden = false;
    if (max) { S.max = true; dock.classList.add('max'); }
    if (!S.ws && S.state !== 'starting' && S.state !== 'connecting') connect(); else { refit(); S.term?.focus(); }
  }
  function hide() { if (dock) dock.hidden = true; S.open = false; }
  function toggle() { if (S.open) hide(); else show(); }

  // the rail button (data-go="shell") and Ctrl+` — taken here, before the workspace's own handlers
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go="shell"]'); if (!b) return; e.preventDefault(); e.stopPropagation(); toggle(); }, true);
  document.addEventListener('keydown', (e) => { if (S.enabled && e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '`') { e.preventDefault(); toggle(); } }, true);

  /** The page at /workspace/shell/<id>: opens the same dock full height. */
  function route(item) {
    if (!S.enabled) return `<div class="wrap"><div class="landing"><h1>Cloud Shell</h1><p>Cloud Shell is not open to your account yet.</p></div></div>`;
    setTimeout(() => show({ max: true }), 0);
    return `<div class="wrap csh-page"><h1>Cloud Shell</h1>
      <p>A terminal on your own XENO Compute machine${item ? ` (<code>${esc(item)}</code>)` : ''}, open below. Your home folder is kept between sessions.</p>
      <p><code>xeno</code> is ready and signed in as your Cloud Shell agent: run <code>xeno ws list</code> to see what it may do. It can read your workspace; to let it change things, grant it in Settings › Connected apps.</p></div>`;
  }

  window.XENO_SHELL = { served: true, get available() { return S.enabled; }, route, open: show, hide, toggle, label: (x) => (/^mch_/.test(x) ? 'Your machine' : x) };

  // Is Cloud Shell open to me? (the rail shows the button only then)
  api('GET', '/api/compute/cloud-shell').then((r) => {
    S.enabled = !!(r.ok && r.d.shell && r.d.shell.enabled);
    if (r.ok && r.d.shell && r.d.shell.machineId) S.machineId = r.d.shell.machineId;
    if (S.enabled) { try { X()?.renderRail?.(); } catch {} }
  });
})();
