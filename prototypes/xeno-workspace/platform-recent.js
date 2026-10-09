/* platform-recent.js — "Recent" and "Needs you" on the platform are the person's own, or empty.
 *
 * The picture ships sample lists (window.XENO_RECENT: "Brand refresh — homepage"…; window.XENO_NEEDS: "Atlas
 * wants to run a migration"…) so its pages have something to show from disk. Served by the platform they were
 * still shown, as if they were the signed-in person's own work and approvals (owner's report, 2026-10-09).
 *
 * Here, on the platform:
 *   - the sample lists are emptied at once, before anything paints;
 *   - Recent is rebuilt from what the platform holds: the person's conversations and chat projects, newest
 *     first, each carrying the AREA it lives in (m), so Overview shows all of it and an area's home shows only
 *     its own (owner's rule: each area has its own work; only Overview shows everything);
 *   - Pinned (the Overview sidebar's sample pins: "Brand refresh — homepage", "Q4 planning"…) is emptied too:
 *     the platform keeps no pinned-work list yet;
 *   - Needs you stays empty: the platform has no approvals or questions feed to read yet, and an invented one
 *     is worse than none.
 *
 * A row keeps the shape the pages already read ({ t, p, m, ago }) plus `id` (what opens it) and `kind`.
 * Files are not listed yet: a library file has no single product to open in.
 *
 * Routes: GET /api/chat/conversations?limit=200 · GET /api/chat/projects?limit=100 (both with no area filter).
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_RECENT_LIVE = { served: false }; return; }
  window.XENO_RECENT = []; window.XENO_NEEDS = []; window.XENO_PINNED = [];
  const X = () => window.XW, api = P.api;
  const R = { status: 'loading', count: 0 };
  const ago = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + ' min'; if (s < 86400) return Math.floor(s / 3600) + ' h'; if (s < 172800) return 'Yesterday'; if (s < 30 * 86400) return Math.floor(s / 86400) + ' d';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const AREA = /^[a-z][a-z0-9_-]{0,39}$/;
  const home = (a) => (typeof a === 'string' && AREA.test(a) ? a : 'overview');
  let loading = null, again = false;
  function load() {
    if (loading) { again = true; return loading; }
    loading = (async () => {
      const [cv, pj] = await Promise.all([api('GET', '/api/chat/conversations?limit=200').catch(() => ({ ok: false, d: {} })), api('GET', '/api/chat/projects?limit=100').catch(() => ({ ok: false, d: {} }))]);
      if (cv.ok && Array.isArray(cv.d.conversations)) {
        const projects = pj.ok && Array.isArray(pj.d.projects) ? pj.d.projects.filter((p) => !p.is_archived) : [];
        const rows = [
          ...cv.d.conversations.map((c) => ({ kind: 'chat', id: String(c.id), t: String(c.title || '').trim() || 'New chat', p: 'chat', m: home(c.area), at: c.last_message_at || c.updated_at || c.created_at })),
          ...projects.map((p) => ({ kind: 'project', id: String(p.id), t: String(p.name || 'Project'), p: 'chat', m: home(p.area), at: p.updated_at || p.created_at })),
        ].filter((r) => Number.isFinite(Date.parse(r.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 60);
        rows.forEach((r) => { r.ago = ago(r.at); });
        window.XENO_RECENT = rows; R.status = 'ready'; R.count = rows.length;
      } else { window.XENO_RECENT = []; R.status = 'error'; R.count = 0; }
      loading = null;
      try { X()?.refreshPanel?.(); if (X()?.S?.view === 'dashboard' || X()?.S?.view === 'mode') X()?.render?.(); } catch {}
      if (again) { again = false; return load(); }
    })();
    return loading;
  }
  // the chat says when a conversation was made, renamed or removed; a project or a move reloads the chat list too
  addEventListener('message', (e) => { if (e.origin !== location.origin) return; const m = e.data; if (m && m.source === 'xeno-chat' && m.type === 'changed') setTimeout(load, 600); });
  window.XENO_RECENT_LIVE = { served: true, load, state: () => ({ status: R.status, count: R.count }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
