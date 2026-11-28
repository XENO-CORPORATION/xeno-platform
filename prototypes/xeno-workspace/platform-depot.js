/**
 * XENO Depot on the web (xeno-depot docs/design/0006-web-ui.md; addresses in decision 0001 §1, amended 2026-11-27).
 *
 * Where it runs: depot.xenosystem.ai. Depot's Worker keeps /api/v1, /mcp and /health and sends every other path to the
 * platform's depot-web server block (nginx/default.conf), which serves /workspace/depot.html. The address IS the screen
 * (address.js: on this host a path is the product item, unchanged):
 *   /                                   → the signed-in person's current workspace, /w/<ws>/repos
 *   /w/<ws>/repos                       → the repos they can read there      (GET /api/v1/w/<ws>/repos)
 *   /w/<ws>/repos/<repo id>             → the repo home: its branches and tips (GET /api/v1/repos/<id>/branches)
 * The workspace door, /workspace/dev/apps/depot/repos/<repo id>/…?ws=<id> (and the old /workspace/depot/…), opens the
 * same screen on depot.xenosystem.ai: Depot's API is same-origin there only.
 *
 * Depot's API is called with a five-minute, read-only `xeno-depot` token from this page's own browser session
 * (POST /api/auth/depot-token; services/depotAuthority.js browserDepotToken). It is kept in memory only, never in
 * storage, and asked for again before it ends; signing out ends it on the server. A repo the person cannot read answers
 * exactly like one that does not exist (404), so this page never says which it is.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ON_HOST = window.XENO_ADDR?.product === 'depot';
  const HOST = 'https://depot.xenosystem.ai';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const REPO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

  // ── the token: memory only, refreshed a minute before it ends ─────────────────────────────────────────────────
  let token = null, until = 0, asking = null, closed = null;
  async function bearer() {
    if (token && Date.now() < until - 60000) return token;
    if (!asking) asking = P.api('POST', '/api/auth/depot-token', {}).then((r) => {
      asking = null;
      if (r.ok && r.d.access_token) { token = r.d.access_token; until = Date.now() + (Number(r.d.expires_in) || 300) * 1000; closed = null; return token; }
      token = null; closed = r.status === 403 ? (r.d.message || 'XENO Depot is not open to this account yet.') : null;
      return null;
    }, () => { asking = null; return null; });
    return asking;
  }
  async function depot(path) {
    const t = await bearer();
    if (!t) return { ok: false, status: closed ? 403 : 401, d: { message: closed || 'Sign in again to open Depot.' } };
    const r = await P.api('GET', path, undefined, { authorization: 'Bearer ' + t });
    return r;
  }

  // ── what the address names ──────────────────────────────────────────────────────────────────────────────────
  /** the product item → { ws, repo, rest } (both the host form w/<ws>/repos/… and the door's repos/…) */
  function parse(item) {
    const parts = String(item || '').split('/').filter(Boolean);
    let ws = null;
    if (parts[0] === 'w' && UUID.test(parts[1] || '')) { ws = parts[1].toLowerCase(); parts.splice(0, 2); }
    if (parts[0] === 'repos') parts.shift();
    const repo = parts[0] && REPO.test(parts[0]) ? parts[0] : null;
    return { ws, repo, rest: repo ? parts.slice(1) : [], bad: !!parts[0] && !repo };
  }
  const scopeWs = () => { const q = new URLSearchParams(location.search).get('ws'); return q && UUID.test(q) ? q.toLowerCase() : window.XENO_SCOPE?.uuid?.() || null; };
  const hostPath = (ws, repo, rest = []) => `/w/${ws}/repos${repo ? '/' + encodeURIComponent(repo) + (rest.length ? '/' + rest.map(encodeURIComponent).join('/') : '') : ''}`;
  const go = (path) => X()?.go?.('product', { product: 'depot', item: path.replace(/^\//, '') });

  // ── state per screen ────────────────────────────────────────────────────────────────────────────────────────
  const lists = new Map(), homes = new Map();   // ws → { status, repos, error } · repo id → { status, branches, error }
  const repaint = () => { try { const s = X()?.S; if (s && s.view === 'product' && s.product === 'depot') X().render(); } catch {} };
  function loadList(ws) {
    const e = { status: 'loading', repos: [], error: null }; lists.set(ws, e);
    depot(`/api/v1/w/${encodeURIComponent(ws)}/repos`).then((r) => {
      if (r.ok) { e.status = 'ready'; e.repos = Array.isArray(r.d.repos) ? r.d.repos : []; } else { e.status = 'error'; e.code = r.status; e.error = r.d.message || r.d.error || 'Depot could not be reached.'; }
      repaint();
    });
  }
  function loadHome(repo) {
    const e = { status: 'loading', branches: [], error: null }; homes.set(repo, e);
    depot(`/api/v1/repos/${encodeURIComponent(repo)}/branches`).then((r) => {
      if (r.ok) { e.status = 'ready'; e.branches = Array.isArray(r.d.branches) ? r.d.branches : []; } else { e.status = 'error'; e.code = r.status; e.error = r.d.message || r.d.error || 'Depot could not be reached.'; }
      repaint();
    });
  }

  // ── screens ─────────────────────────────────────────────────────────────────────────────────────────────────
  const shell = (title, sub, body, state) => { const h = window.XENO_PAGES.h; return h.page(h.head({ title, sub }) + `<div class="wrap pj" data-dp-page="${esc(state)}">${body}</div>`); };
  const empty = (html, attr = '') => `<div class="pj-empty" ${attr}>${html}</div>`;
  const notFound = () => shell('Not found', '', empty('There is no repository at this address, or you cannot open it.', 'data-dp-missing'), 'missing');
  const failed = (e, retry) => (e.code === 404 ? notFound()
    : shell('Depot', '', empty(`${esc(e.error)} <button class="btn ghost" data-dp-retry="${esc(retry)}">Try again</button>`, 'data-dp-error'), 'error'));

  function listPage(ws) {
    const e = lists.get(ws); if (!e) { loadList(ws); return shell('Repositories', '', empty('Loading…'), 'loading'); }
    if (e.status === 'loading') return shell('Repositories', '', empty('Loading…'), 'loading');
    if (e.status === 'error') return failed(e, 'list');
    const rows = e.repos.map((r) => { const id = String(r.id || r.repoId || ''); return REPO.test(id)
      ? `<button class="row" data-dp-repo="${esc(id)}"><b>${esc(r.name || id)}</b><small class="pg-dim">${esc(id)}</small></button>` : ''; }).join('');
    return shell('Repositories', 'The repositories you can open in this workspace', rows ? `<div class="list" data-dp-list>${rows}</div>` : empty('No repositories you can open in this workspace yet.', 'data-dp-none'), 'ready');
  }
  function homePage(ws, repo) {
    const e = homes.get(repo); if (!e) { loadHome(repo); return shell(repo, '', empty('Loading…'), 'loading'); }
    if (e.status === 'loading') return shell(repo, '', empty('Loading…'), 'loading');
    if (e.status === 'error') return failed(e, 'home');
    const rows = e.branches.map((b) => `<div class="row" data-dp-branch="${esc(b.id || '')}"><b>${esc(b.name || b.id || '')}</b><small class="pg-dim mono" title="Tip revision">${esc(String(b.tip || '').slice(0, 12))}</small></div>`).join('');
    return shell(repo, `<a href="${esc(hostPath(ws))}" data-dp-back>Repositories</a>`, rows ? `<div class="list" data-dp-branches>${rows}</div>` : empty('This repository has no branches yet.', 'data-dp-none'), 'ready');
  }

  function page() {
    const s = X()?.S || {}, it = parse(s.item);
    if (it.bad) return notFound();
    const ws = it.ws || scopeWs();
    // the workspace door: the same screen on Depot's own host, where its API is same-origin
    if (!ON_HOST) { if (ws) location.assign(HOST + hostPath(ws, it.repo, it.rest)); return shell('Depot', '', empty('Opening Depot…'), 'leaving'); }
    if (!ws) return shell('Depot', '', empty('Loading…'), 'loading');
    if (!it.ws) { queueMicrotask(() => window.XENO_ADDR?.replace?.('#/overview/p/depot/' + hostPath(ws, it.repo, it.rest).slice(1))); }
    if (closed) return shell('Depot', '', empty(esc(closed), 'data-dp-closed'), 'closed');
    return it.repo ? homePage(ws, it.repo) : listPage(ws);
  }

  document.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-dp-repo]'); if (r) { const ws = parse(X()?.S?.item).ws || scopeWs(); return go(hostPath(ws, r.dataset.dpRepo)); }
    const back = ev.target.closest('[data-dp-back]'); if (back) { ev.preventDefault(); return go(back.getAttribute('href')); }
    const t = ev.target.closest('[data-dp-retry]'); if (t) { const it = parse(X()?.S?.item); if (t.dataset.dpRetry === 'home' && it.repo) homes.delete(it.repo); else lists.delete(it.ws || scopeWs()); repaint(); }
  });

  window.XENO_DEPOT = { page, parse, state: () => ({ token: !!token, closed: !!closed, lists: lists.size, homes: homes.size }) };
})();
