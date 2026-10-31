/**
 * Places, from the platform. The picture drew its building from sample people in this browser, with an "Arrange" that said
 * "Layout saved for everyone" and saved nothing. Here it is the workspace's real building, read from XENO Places' own service
 * (services/places.js), already filtered to what this viewer may see: a floor they have no scope for arrives with no name.
 *
 *   the building  /workspace/places                GET /api/places, then GET /api/places/:id
 *   a floor       /workspace/places/f/<division>   by id; the lobby is /workspace/places/Lobby
 *   who sits      /workspace/places/p/<principal>  the card beside the building
 *
 * This page is the list equivalent and the quick look. Walking the building and arranging it happen in XENO Places itself
 * (places.xenosystem.ai), which owns the layout; this page never writes one.
 */
(() => {
  const PF = window.XENO_PLATFORM;
  if (!PF || !PF.served) return;
  const X = () => window.XW, H = () => window.XENO_PAGES.h, api = PF.api, esc = (s) => H().esc(s), ic = (k) => X().ic(k);
  const HOST = 'https://places.xenosystem.ai';
  const NEEDS = new Set(['blocked', 'waiting_for_user', 'waiting_for_permission']);
  const wsId = () => (window.XENO_SCOPE?.served && window.XENO_SCOPE.uuid?.()) || null;
  const S = { key: undefined, status: 'idle', place: null, snap: null, list: false, loadedAt: 0 };
  const paint = () => { try { const s = X()?.S; if (s?.view === 'global' && s.global === 'places') X().render(); } catch {} };
  const go = (item) => X().go('global', { global: 'places', item });

  async function load(quiet) {
    const w = wsId(); S.key = w; if (!quiet) { S.status = 'loading'; }
    const l = await api('GET', '/api/places').catch(() => null);
    if (S.key !== w) return;
    if (!l || !l.ok || !l.d?.ok) { S.status = l && l.status === 403 ? 'denied' : 'error'; return paint(); }
    const items = l.d.result?.items || [];
    const mine = items.find((p) => (w ? String(p.workspaceId) === String(w) : p.workspaceType === 'personal'));
    if (!mine) { S.place = null; S.snap = null; S.status = 'none'; return paint(); }
    const g = await api('GET', '/api/places/' + encodeURIComponent(mine.id)).catch(() => null);
    if (S.key !== w) return;
    if (!g || !g.ok || !g.d?.ok) { S.status = g && g.status === 403 ? 'denied' : 'error'; return paint(); }
    S.place = g.d.result.place; S.snap = g.d.result.spec.snap; S.status = 'ready'; S.loadedAt = Date.now(); paint();
  }
  // the building moves while you look at it; a hidden page does not ask
  setInterval(() => { const s = X()?.S; if (S.status === 'ready' && s?.view === 'global' && s.global === 'places' && !document.hidden) load(true); }, 20000);

  // ---------- the model: every part from the snapshot ----------
  function model() {
    const n = S.snap, byId = new Map(n.divisions.map((d) => [d.id, d]));
    const root = (id) => { let d = byId.get(id); while (d && d.parentDivisionId && byId.has(d.parentDivisionId)) d = byId.get(d.parentDivisionId); return d ? d.id : null; };
    const people = new Map(n.principals.map((p) => [p.id, p]));
    const pod = (t) => ({ ...t, desks: n.memberships.filter((m) => m.teamId === t.id && people.has(m.principalId)) });
    const floors = n.divisions.filter((d) => !d.parentDivisionId).map((d) => ({ key: d.id, name: d.name, head: people.get(d.headPrincipalId)?.displayName || null, pods: n.teams.filter((t) => t.owningDivisionId && root(t.owningDivisionId) === d.id).map(pod) }));
    const lobby = { key: 'Lobby', name: 'Lobby', pods: n.teams.filter((t) => !t.owningDivisionId || !byId.has(t.owningDivisionId)).map(pod) };
    return { floors, lobby, closed: n.closedDivisionIds || [], people };
  }
  /** What a body shows, from its records: a run it is on, a run waiting on someone, or time off. */
  function stateOf(p) {
    const n = S.snap, runs = n.runs.filter((r) => r.principalId === p.id), wait = runs.find((r) => NEEDS.has(r.status)), run = runs[0];
    if (wait) return { k: 'hand', label: wait.title ? `Waiting on someone: ${wait.title}` : 'Waiting on someone' };
    if (run) return { k: 'work', label: run.title ? `Working: ${run.title}` : 'Working' };
    if (p.away) return { k: 'away', label: p.away === 'in_meeting' ? 'In a meeting' : p.away === 'outside_hours' ? 'Outside working hours' : 'Away' };
    if (String(p.id) === String(n.viewer.principalId)) return { k: 'you', label: 'You' };
    return { k: 'idle', label: p.isAgent ? 'At its desk' : 'Here' };
  }
  const initials = (name) => String(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const handoffLine = (M, h) => { const m = (id) => S.snap.memberships.find((x) => x.id === id), who = (id) => M.people.get(m(id)?.principalId)?.displayName || 'Someone'; return `<li>${ic('right')}<span><b>${esc(who(h.sourceMembershipId))}</b> is handing work to <b>${esc(who(h.targetMembershipId))}</b></span></li>`; };

  // ---------- the building ----------
  function desk(M, m, open, seen) {
    const p = M.people.get(m.principalId); if (!p) return '';
    // one body per building: its first desk holds it, the others say where it sits
    if (seen.has(p.id)) return `<button class="pl-desk pl-ghost${open === p.id ? ' on' : ''}" data-xpl="open" data-id="${esc(p.id)}"><span class="pl-mon" aria-hidden="true"></span><small>${esc(p.displayName)}</small><span class="pl-sr"> sits at another desk</span></button>`;
    seen.add(p.id);
    const s = stateOf(p);
    return `<button class="pl-desk pl-${s.k}${open === p.id ? ' on' : ''}" data-xpl="open" data-id="${esc(p.id)}"><span class="pl-mon" aria-hidden="true"></span><span class="pl-body ${p.isAgent ? 'pl-agent' : ''}" aria-hidden="true">${esc(initials(p.displayName))}</span><small>${esc(p.displayName)}</small><span class="pl-sr"> — ${esc(s.label)}${m.role ? ', ' + esc(m.role) : ''}</span>${s.k === 'hand' ? `<em class="pl-flag" aria-hidden="true">${ic('bell')}</em>` : ''}</button>`;
  }
  function floorHTML(M, f, open, seen) {
    const count = f.pods.reduce((a, t) => a + t.desks.length, 0);
    const head = f.key === 'Lobby' ? esc(f.name) : `<button class="pg-link" data-xpl="floor" data-id="${esc(f.key)}">${esc(f.name)}</button>`;
    return `<section class="pl-floor${!f.pods.length ? ' pl-vacant' : ''}" data-floor="${esc(f.key)}"><header><b>${head}</b><small>${f.pods.length ? `${f.pods.length} team${f.pods.length > 1 ? 's' : ''} · ${count} desk${count === 1 ? '' : 's'}` : 'Empty'}${f.head ? ' · led by ' + esc(f.head) : ''}</small></header>
      ${f.pods.length ? `<div class="pl-pods">${f.pods.map((t) => `<div class="pl-pod"><div class="pl-pod-h"><b>${esc(t.name)}</b><small>${t.desks.length}</small></div><div class="pl-desks">${t.desks.map((m) => desk(M, m, open, seen)).join('')}</div></div>`).join('')}</div>` : ''}</section>`;
  }
  const closedHTML = (M) => M.closed.map(() => `<section class="pl-floor pl-closed" aria-label="A floor you don’t have access to"><header><b>${ic('lock')} Closed</b><small>You don’t have access to this floor</small></header></section>`).join('');
  function peekHTML(M, id) {
    const p = M.people.get(id); if (!p) return '';
    const s = stateOf(p), h = H(), desks = S.snap.memberships.filter((m) => m.principalId === id), teams = desks.map((m) => [S.snap.teams.find((t) => t.id === m.teamId), m]).filter(([t]) => t), me = String(id) === String(S.snap.viewer.principalId);
    const canOpen = !String(id).startsWith('res:') && (!p.isAgent || p.publicId);
    return `<aside class="pl-peek" aria-label="${esc(p.displayName)}"><div class="pl-peek-h"><span class="pl-body ${p.isAgent ? 'pl-agent' : ''}" aria-hidden="true">${esc(initials(p.displayName))}</span><div><b>${esc(p.displayName)}</b><small>${p.isAgent ? 'Agent' : 'Person'}</small></div><button class="pg-ib" data-xpl="close" aria-label="Close">${ic('x')}</button></div>
      <p class="pl-state pl-${s.k}">${esc(s.label)}</p>
      ${teams.length ? `<dl class="mk-dl">${teams.map(([t, m]) => `<dt>${esc(t.name)}</dt><dd>${esc(h.cap(m.role || 'member'))}</dd>`).join('')}</dl>` : '<p class="pg-dim">Not on a team.</p>'}
      <div class="pl-peek-acts">${canOpen && !me ? h.btn(p.isAgent ? 'Open agent' : 'Profile', `data-xpl="profile" data-id="${esc(id)}"`, true, 'open') : ''}</div>
      <p class="pg-dim wf-note">The building only shows what you may see. Every action is the same one as in the Workspace pages, with the same rights.</p></aside>`;
  }
  function listHTML(M, floors) {
    const seen = new Set();
    const row = (m) => { const p = M.people.get(m.principalId); if (!p) return ''; const first = !seen.has(p.id); seen.add(p.id); return `<li><button class="pg-link" data-xpl="open" data-id="${esc(p.id)}">${esc(p.displayName)}</button><span>${esc(m.role || '')}</span><span class="pg-dim">${esc(first ? stateOf(p).label : 'Also on this team')}</span></li>`; };
    return floors.map((f) => `<section class="pg-sec"><h3>${esc(f.name)}</h3>${f.pods.length ? f.pods.map((t) => `<h4 class="mk-sub">${esc(t.name)}</h4><ul class="mk-rcl pl-list">${t.desks.map(row).join('')}</ul>`).join('') : '<p class="pg-dim">Empty</p>'}</section>`).join('') + M.closed.map(() => `<section class="pg-sec"><h3>${ic('lock')} Closed</h3><p class="pg-dim">You don’t have access to this floor.</p></section>`).join('');
  }
  function route(it) {
    if (S.key !== wsId() || S.status === 'idle') { load(); }
    const h = H();
    if (S.status === 'idle' || S.status === 'loading') return h.page(h.head({ eyebrow: 'Places', title: 'Places', sub: 'Your workspace as a building.' }) + h.box('building', 'Opening the building', ''));
    if (S.status === 'denied') return h.page(h.head({ eyebrow: 'Places', title: 'Places' }) + h.box('lock', 'You don’t have access to this building', 'Ask an admin of this workspace.'));
    if (S.status === 'error') return h.page(h.head({ eyebrow: 'Places', title: 'Places' }) + h.box('alert', 'The building could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xpl="retry"')));
    if (S.status === 'none') return h.page(h.head({ eyebrow: 'Places', title: 'Places' }) + h.box('building', 'This workspace has no building yet', 'One is made for every workspace. Try again in a moment.', h.btn('Try again', 'data-xpl="retry"')));
    const M = model(), open = it && it.startsWith('p/') ? it.slice(2) : null, floorKey = it && it.startsWith('f/') ? it.slice(2) : it === 'Lobby' ? 'Lobby' : null;
    const all = [M.lobby, ...M.floors], floors = floorKey ? all.filter((f) => f.key === floorKey) : null;
    if (floorKey && !floors.length) return h.page(h.head({ eyebrow: 'Places', title: 'Places' }) + h.box('lock', 'This floor is not here', 'It was removed, or you have no access to it.', h.btn('Whole building', 'data-xpl="floor" data-id=""')));
    const show = floors || [...M.floors.slice().reverse(), M.lobby], c = S.place.counts || {}, people = (c.humans || 0) + (c.agents || 0), seen = new Set();
    const acts = h.btn(S.list ? 'Building view' : 'List view', 'data-xpl="list"', true, S.list ? 'building' : 'grid') + `<a class="pg-btn ghost" href="${HOST}/p/${encodeURIComponent(S.place.id)}" target="_blank" rel="noopener"><span>Walk in</span></a>`;
    const sub = M.floors.length || M.closed.length ? `${M.floors.length + M.closed.length} floor${M.floors.length + M.closed.length > 1 ? 's' : ''} and a lobby · ${people} ${people === 1 ? 'person or agent' : 'people and agents'}${c.working ? ` · ${c.working} working` : ''}${c.needs ? ` · ${c.needs} waiting` : ''}` : `A lobby · ${people} ${people === 1 ? 'person or agent' : 'people and agents'}`;
    const walks = S.snap.handoffs.length ? `<ul class="pl-walks">${S.snap.handoffs.map((x) => handoffLine(M, x)).join('')}</ul>` : '';
    const nobody = !S.snap.teams.length && !M.floors.length && !M.closed.length;
    const body = S.list ? listHTML(M, floors || all) : `<div class="pl-wrap"><div class="pl-building">${show.map((f) => floorHTML(M, f, open, seen)).join('')}${floors ? '' : closedHTML(M)}${nobody ? `<p class="pl-empty">${ic('building')}<span>Floors are this workspace’s divisions and desks are its teams. <button class="pg-link" data-xpl="divs">Set them up</button></span></p>` : ''}</div>${open ? peekHTML(M, open) : ''}</div>`;
    return h.page(h.head({ eyebrow: 'Places', title: S.place.name, acts }) + `<p class="pg-dim pl-sum">${esc(sub)}</p>` + walks + body);
  }

  const ACT = {
    open(id) { const s = X().S; go(s.item === 'p/' + id ? null : 'p/' + id); },
    close() { go(null); },
    floor(id) { go(id ? 'f/' + id : null); },
    list() { S.list = !S.list; paint(); },
    retry() { load(); paint(); },
    divs() { X().go('global', { global: 'workspace', item: 'Divisions' }); },
    profile(id) { const p = S.snap.principals.find((x) => x.id === id); if (!p) return; X().go('global', { global: 'workspace', item: p.isAgent ? 'Agents/' + p.publicId : 'Members/' + p.id }); },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-xpl]'); if (!t) return; e.preventDefault(); ACT[t.dataset.xpl]?.(t.dataset.id); });
  document.addEventListener('keydown', (e) => { const s = X()?.S; if (e.key === 'Escape' && s?.view === 'global' && s.global === 'places' && s.item && s.item.startsWith('p/') && !document.querySelector('.xd')) go(null); });
  const label = (x) => { if (!S.snap) return x; if (/^f$|^p$/.test(x)) return null; const p = S.snap.principals.find((y) => y.id === x), d = S.snap.divisions.find((y) => y.id === x); return p ? p.displayName : d ? d.name : x; };
  window.XENO_PLACES = { served: true, route, label, floors: () => (S.snap ? S.snap.divisions.filter((d) => !d.parentDivisionId) : []), load };
})();
