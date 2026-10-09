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
  // one way to call the platform: the session cookie, the CSRF token on writes, and the surface name
  const csrf = () => { for (const n of ['__Host-xeno_csrf', 'xeno_csrf']) { const m = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(n + '=')); if (m) return decodeURIComponent(m.slice(n.length + 1)); } return null; };
  P.csrf = csrf;
  P.api = async (method, url, body, extra) => {
    const headers = { 'x-xeno-surface': 'xeno-web', ...(extra || {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (!['GET', 'HEAD'].includes(method)) { const t = csrf(); if (t) headers['x-xeno-csrf'] = t; }
    const r = await fetch(url, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch {}
    if (r.status === 401) location.replace('/login?returnUrl=' + encodeURIComponent(location.pathname + location.search + location.hash));
    return { status: r.status, ok: r.ok && (!d || d.success !== false), d: d || {} };
  };
  const root = document.documentElement;
  root.classList.add('on-platform', 'xp-wait');
  const style = document.createElement('style');
  style.textContent = 'html.xp-wait body>*:not(#xp-state){visibility:hidden}html.on-platform #net-chip{display:none!important}'
    + '#xp-state{position:fixed;inset:0;display:grid;place-items:center;background:#0a0a0a;color:#e8e8e8;font:14px/1.5 Inter,system-ui,sans-serif;z-index:99999}'
    + '#xp-state div{max-width:360px;text-align:center}#xp-state button{margin-top:14px;padding:8px 14px;border-radius:8px;border:1px solid #3a3a3a;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}'
    + '#xp-note{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;border:1px solid #2e2e2e;background:#141414;color:#b8b8b8;font:12px/1.4 Inter,system-ui,sans-serif;z-index:9000}';
  document.head.appendChild(style);
  const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = '/favicon.svg'; document.head.appendChild(icon); // the platform's own icon; from disk there is none to point at
  const state = (html) => { let s = document.getElementById('xp-state'); if (!s) { s = document.createElement('div'); s.id = 'xp-state'; s.setAttribute('role', 'status'); (document.body || root).appendChild(s); } s.innerHTML = `<div>${html}</div>`; return s; };
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
    const lift = () => { if (!root.classList.contains('xp-wait')) return; try { window.XW?.render?.(); } catch {} root.classList.remove('xp-wait'); document.getElementById('xp-state')?.remove(); };
    setTimeout(() => { Promise.race([Promise.all(firsts), new Promise((r) => setTimeout(r, FIRST_PAINT_MS))]).then(lift); }, 0);
    const n = document.createElement('div'); n.id = 'xp-note'; n.setAttribute('role', 'note'); n.textContent = 'Preview. Your account is real; the workspace areas still show sample data.'; document.body.appendChild(n);
    try { window.XW?.render?.(); } catch {}
    return u;
  }

  async function check() {
    let r;
    try { r = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } }); }
    catch { state('The workspace could not reach XENO. Check your connection.<br><button type="button" id="xp-retry">Try again</button>'); document.getElementById('xp-retry').onclick = () => { state('Opening your workspace'); P.ready = check(); }; return null; }
    if (r.status === 401 || r.status === 403) return toLogin();
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok || !d || !d.success || !d.user) { state(`XENO could not open your workspace (${esc(r.status)}).<br><button type="button" id="xp-retry">Try again</button>`); document.getElementById('xp-retry').onclick = () => { state('Opening your workspace'); P.ready = check(); }; return null; }
    return adopt(d.user);
  }
  const start = () => { state('Opening your workspace'); P.ready = check(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
