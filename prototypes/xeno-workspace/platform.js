/* XENO_PLATFORM — the workspace running on the platform instead of from disk.
 * Opened as a file (the prototype), this does nothing. Served under /workspace, it:
 *   1. holds the page until the platform confirms who is signed in (GET /api/auth/me, the session cookie) AND the
 *      first load of the account, workspaces, projects and library has landed, so the page appears once, complete,
 *      instead of repainting as each answer arrives (at most FIRST_PAINT_MS, then it shows whatever it has);
 *   2. sends a signed-out visitor to /login and brings them back here;
 *   3. replaces the sample profile with the real account;
 *   4. hides the prototype's network controls, and says plainly that the areas still show sample data.
 * window.XENO_PLATFORM = { served, user, ready, first }   ready resolves to the user, or null when the page is leaving.
 *   first(promise) registers a first load the page waits for before it is shown. */
(() => {
  const served = /^https?:$/.test(location.protocol) && /^\/workspace(\/|$)/.test(location.pathname);
  const P = window.XENO_PLATFORM = { served, user: null, ready: Promise.resolve(null), first: () => {} };
  if (!served) return;
  const FIRST_PAINT_MS = 6000, firsts = [];
  P.first = (p) => { firsts.push(Promise.resolve(p).catch(() => {})); };
  // ---------- the AREA: the place in the left rail the person is in (Studio, Office, Dev… or one they made) ----------
  // Each area has its own chats, projects and library; on Overview there is no area and everything shows (owner's
  // rule, 2026-10-03 and 2026-10-09). One definition here; platform-chat, platform-library and platform-work use it.
  P.area = () => { let k = null; try { k = window.XW?.ctxKey?.(); } catch {} return typeof k === 'string' && k !== 'overview' && k !== 'adaptive' && /^[a-z][a-z0-9_-]{0,39}$/.test(k) ? k : null; };
  P.areaName = (id) => { if (!id) return ''; try { const m = window.XW?.M?.[id]; if (m && m.name) return m.name; const c = (window.XENO_CUSTOM?.list?.() || []).find((x) => x.id === id); if (c) return c.name; } catch {} return id.charAt(0).toUpperCase() + id.slice(1); };
  P.areas = () => { const out = []; try { for (const m of window.XENO_MODES || []) out.push([m.id, P.areaName(m.id)]); for (const c of window.XENO_CUSTOM?.list?.() || []) if (/^[a-z][a-z0-9_-]{0,39}$/.test(c.id)) out.push([c.id, c.name]); } catch {} return out; };
  // one way to call the platform: the session cookie, the CSRF token on writes, and the surface name
  const csrf = () => { for (const n of ['__Host-xeno_csrf', 'xeno_csrf']) { const m = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(n + '=')); if (m) return decodeURIComponent(m.slice(n.length + 1)); } return null; };
  P.csrf = csrf;
  // STAFF is read from the role the session already has (GET /api/auth/me: role + kind), never by calling a staff
  // route to see whether it refuses (2026-10-24: every customer's Support and Releases pages drew 403s and 404s).
  // A label for what to SHOW; every staff route still decides for itself.
  P.isStaff = () => { const u = P.user; return !!u && (u.kind || 'human') === 'human' && (u.role === 'admin' || u.role === 'moderator'); };
  P.isAdmin = () => { const u = P.user; return !!u && (u.kind || 'human') === 'human' && u.role === 'admin'; };
  // ONE READ PER RESOURCE PER PAGE LOAD: the same GET asked by several adapters at once shares one request, and
  // while the page is loading an answer that arrived a moment ago is reused (a cold load once asked for some
  // resources three times, ~60-70 calls a load against a 200/min per-user limit, 2026-10-24). Once the page is
  // shown only requests still in flight are shared, so a read made later (a step-up check, a filter) is always
  // fresh. Any write forgets every remembered answer. Each caller parses its own copy of the answer.
  // A write anywhere on the page (an upload made with fetch directly too) forgets them, when it starts and when it ends.
  const READ_REUSE_MS = 3000, reads = new Map(), nativeFetch = window.fetch.bind(window);
  let reuseUntil = Infinity;   // the end of the first load: set when the page is shown
  window.fetch = (input, init) => {
    const m = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD') return nativeFetch(input, init);
    reads.clear(); const done = () => reads.clear();
    return nativeFetch(input, init).then((x) => { done(); return x; }, (e) => { done(); throw e; });
  };
  P.forgetReads = () => reads.clear();
  // LOAD WHEN SHOWN: an area's first load starts the first time the workspace asks the area for anything it draws
  // (its page, its rows, its rail badge), not on every page load. Overview never draws Customers, so a cold load of
  // Overview no longer reads Customers, Scheduling, Mail... (2026-10-24). Returns touch(), which starts it by hand.
  P.lazy = (fn) => { let on = false; return () => { if (on) return; on = true; Promise.resolve(P.ready).then((u) => { if (u) fn(); }); }; };
  // The Overview rail asks EVERY area for its badge (a closed category still signals news), so the badge never starts
  // the full load: an area whose badge carries a count passes `badgeFn`, the one cheap read that count needs.
  P.lazyZone = (zone, fn, badgeFn) => {
    const touch = P.lazy(fn), touchBadge = badgeFn ? P.lazy(badgeFn) : () => {};
    const wrap = (k, t) => { if (zone && typeof zone[k] === 'function') { const f = zone[k]; zone[k] = (...a) => { t(); return f(...a); }; } };
    for (const k of ['page', 'work', 'reload']) wrap(k, touch);
    wrap('badge', touchBadge);
    return touch;
  };
  const send = async (method, url, headers, body) => {
    const r = await window.fetch(url, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let text = ''; try { text = await r.text(); } catch {}
    return { status: r.status, okHttp: r.ok, text };
  };
  P.api = async (method, url, body, extra) => {
    const headers = { 'x-xeno-surface': 'xeno-web', ...(extra || {}) };
    // AREA: the area the person is in, so what this request stores (an upload) lands there. A label, never an authority.
    { const k = P.area(); if (k && !headers['x-xeno-area']) headers['x-xeno-area'] = k; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (!['GET', 'HEAD'].includes(method)) { const t = csrf(); if (t) headers['x-xeno-csrf'] = t; }
    let r;
    if (method === 'GET' && body === undefined) {
      const key = url + '\n' + JSON.stringify(headers), now = Date.now(), hit = reads.get(key);
      if (hit && (hit.pending || (now < reuseUntil && now - hit.at < READ_REUSE_MS))) r = await hit.p;
      else {
        const entry = { pending: true, at: now, p: null };
        entry.p = send(method, url, headers).then((x) => { entry.pending = false; entry.at = Date.now(); if (!x.okHttp && reads.get(key) === entry) reads.delete(key); return x; },
          (e) => { if (reads.get(key) === entry) reads.delete(key); throw e; });
        if (reads.size > 100) for (const [k, v] of reads) if (!v.pending && now - v.at >= READ_REUSE_MS) reads.delete(k);
        reads.set(key, entry); r = await entry.p;
      }
    } else r = await send(method, url, headers, body);
    let d = null; try { d = r.text ? JSON.parse(r.text) : null; } catch {}
    r = { status: r.status, ok: r.okHttp };
    // One route answering 401 is not proof the session ended (a route bug looped everyone to /login on 2026-10-20).
    // Go to sign-in only when the session itself says so.
    if (r.status === 401 && !P._toLogin) {
      P._toLogin = fetch('/api/auth/me', { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } })
        .then((m) => { if (m.status === 401) location.replace('/login?returnUrl=' + encodeURIComponent(location.pathname + location.search + location.hash)); else P._toLogin = null; })
        .catch(() => { P._toLogin = null; });
    }
    return { status: r.status, ok: r.ok && (!d || d.success !== false), d: d || {} };
  };
  const root = document.documentElement;
  root.classList.add('on-platform', 'xp-wait');
  const style = document.createElement('style');
  style.textContent = 'html.xp-wait body>*:not(#xp-state){visibility:hidden}html.on-platform #net-chip{display:none!important}'
    + '#xp-state{position:fixed;inset:0;display:grid;place-items:center;background:#0a0a0a;color:#e8e8e8;font:14px/1.5 Inter,system-ui,sans-serif;z-index:99999}'
    + '#xp-state{transition:opacity .42s cubic-bezier(.2,.7,.2,1)}#xp-state[data-leaving]{opacity:0;pointer-events:none}#xp-state .xp-mark{display:grid;place-items:center;color:#e8e8e8}'
    + '#xp-state div{max-width:360px;text-align:center}#xp-state button{margin-top:14px;padding:8px 14px;border-radius:8px;border:1px solid #3a3a3a;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}'
    // the note is fixed over the page, so every page reserves room for it at its foot: nothing is ever hidden under it
    + 'body:has(#xp-note) .pg{padding-bottom:64px}'
    + '#xp-note{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;border:1px solid #2e2e2e;background:#141414;color:#b8b8b8;font:12px/1.4 Inter,system-ui,sans-serif;z-index:9000}';
  document.head.appendChild(style);
  const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = '/favicon.svg'; document.head.appendChild(icon); // the platform's own icon; from disk there is none to point at
  let stopMark = null;
  const state = (html) => { let s = document.getElementById('xp-state'); if (!s) { s = document.createElement('div'); s.id = 'xp-state'; s.setAttribute('role', 'status'); (document.body || root).appendChild(s); } stopMark?.(); stopMark = null; s.innerHTML = `<div>${html}</div>`; return s; };
  // Opening: the XENO mark (particles form it, it turns, they scatter). The label is for screen readers.
  const opening = () => { const s = state(''); const m = document.createElement('div'); m.className = 'xp-mark'; s.firstChild.replaceWith(m); if (window.XENO_MARK_LOADER) stopMark = window.XENO_MARK_LOADER.mount(m, { size: 96, label: 'Opening your workspace' }); else m.textContent = 'Opening your workspace'; return s; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // where the visitor asked to go, read before the app has had a chance to rewrite the address (it sends an unknown
  // place to its default mode, and the sign-in check can answer after that)
  const ASKED = location.pathname + location.search + location.hash;
  const toLogin = () => { location.replace('/login?returnUrl=' + encodeURIComponent(ASKED)); return null; };

  function adopt(u) {
    P.user = u;
    try { // the account is the platform's; the workspace keeps only what the platform does not hold yet
      const a = JSON.parse(localStorage.getItem('xw.acct') || '{}') || {};
      a.profile = { ...(a.profile || {}), name: u.display_name || u.username || 'You', handle: u.username || '', email: u.email || '', verified: !!u.email_verified, photo: u.avatar_url || (a.profile && a.profile.photo) || null };
      localStorage.setItem('xw.acct', JSON.stringify(a));
    } catch {}
    // the adapters start their first loads when `ready` resolves, a moment after this returns; wait for them
    const lift = () => { if (!root.classList.contains('xp-wait')) return; reuseUntil = Date.now(); const s = document.getElementById('xp-state'); try { window.XW?.render?.(); } catch {} root.classList.remove('xp-wait'); if (s && !s.isConnected) document.body.appendChild(s); /* the first render rewrites the page; the mark stays on top and fades away over it */ if (s) { s.dataset.leaving = ''; setTimeout(() => { stopMark?.(); stopMark = null; s.remove(); }, 440); } };
    setTimeout(() => { Promise.race([Promise.all(firsts), new Promise((r) => setTimeout(r, FIRST_PAINT_MS))]).then(lift); }, 0);
    const n = document.createElement('div'); n.id = 'xp-note'; n.setAttribute('role', 'note'); n.textContent = previewNote(); document.body.appendChild(n);
    if (document.readyState !== 'complete') window.addEventListener('load', () => { n.textContent = previewNote(); }, { once: true });   // the areas register as their scripts load
    try { window.XW?.render?.(); } catch {}
    return u;
  }

  // Which areas still show sample data comes from the code (an area is real once a module registered it in
  // XENO_ZONE_LIVE), so this line cannot fall behind as areas get connected. An area's sidebar rows are already removed on
  // the platform (platform-home.js); what can still show sample rows is its table in XENO_PG_AREAS, plus the whole pages.
  function previewNote() {
    const live = window.XENO_ZONE_LIVE || {}, tables = window.XENO_PG_AREAS || {}, names = [];
    for (const [mode, zones] of Object.entries(window.XENO_MODE_ZONES || {})) {
      for (const z of zones) if (tables[`${mode}.${z.id}`] && !live[`${mode}.${z.id}`]) names.push(z.label);
    }
    const rest = [...new Set(names), 'Marketplace', 'Company', 'Anima', 'Places'];
    return `Preview. Your account, chats, projects, tasks, library, people, community and each area’s home are real. Still sample data: ${rest.join(', ')}.`;
  }

  async function notActivated() {
    try {
      const a = await fetch('/api/auth/activation-status', { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } });
      if (!a.ok) return false;
      const j = await a.json();
      return !!j && j.success !== false && j.activated === false;
    } catch { return false; }
  }

  async function check() {
    let r;
    try { r = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } }); }
    catch { state('The workspace could not reach XENO. Check your connection.<br><button type="button" id="xp-retry">Try again</button>'); document.getElementById('xp-retry').onclick = () => { opening(); P.ready = check(); }; return null; }
    if (r.status === 401 || r.status === 403) return toLogin();
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok || !d || !d.success || !d.user) { state(`XENO could not open your workspace (${esc(r.status)}).<br><button type="button" id="xp-retry">Try again</button>`); document.getElementById('xp-retry').onclick = () => { opening(); P.ready = check(); }; return null; }
    // An account that has not confirmed its email is refused by every platform route (account_not_activated), so
    // the workspace would open looking empty and say nothing (found live, 2026-10-23). Send it to the page that
    // explains and resends the code. Only an explicit `activated: false` does this: the server stays the gate.
    if (await notActivated()) { location.replace('/auth/activate'); return null; }
    return adopt(d.user);
  }
  const start = () => { opening(); P.ready = check(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
