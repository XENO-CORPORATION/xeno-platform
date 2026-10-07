/* XENO_PLACES — the workspace as a building (xeno-places/SPEC §3, §5, §6, §7). A RENDERING of records, never a new one:
 *   building = the workspace · floor = a division · lobby = everything owned by no division · pod = a team on its owning
 *   division's floor · desk = a team membership · occupant = a person or an agent, one body per building
 *   Motion is meaning (§5): working = a run is going · hand up = it waits on a person · walking = a handoff offered
 *   §6.1 the building cannot grant anything: every verb is the same workforce command the list UI issues
 *   §6.4 a list equivalent of the whole building, always one click away
 *   §3 empty is a state: a workspace with no divisions is a lobby and no floors — never seeded to look busy
 *   Places owns only LAYOUT (pod order per floor, admin-edited) and your EPHEMERAL position (this tab only, never stored)
 * Platform: reads /api/v2/workspaces/:id/{divisions,teams,memberships,handoffs} + runs; writes /api/v2/places/:ws/layout
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, WF = () => window.XENO_WF, Wd = () => window.XENO_PG_WORKSPACE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const SS = { get(k) { try { return sessionStorage.getItem('xw.' + k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem('xw.' + k, v); } catch {} } };
  const cur = () => window.XA.currentWorkspace(), isAdmin = () => (!window.XENO_ROLE || window.XENO_ROLE.can('manage')) && cur().id === 'xeno' || cur().id === 'personal' || /owner|admin/i.test(cur().sub || '');
  let peek = null, listView = false, editing = false;

  const runs = () => Object.values(window.XENO_PG_AREAS || {}).flatMap((A) => { const ai = A.cols.indexOf('Agent'), si = A.cols.indexOf('Status'); return ai < 0 ? [] : A.rows.map((r) => ({ name: r[0], agent: r[ai], status: r[si] })); });
  function stateOf(m) {
    if (m.kind !== 'agent') return m.name === WF().you() ? { k: 'you', label: 'You' } : m.status === 'invited' ? { k: 'away', label: 'Invited — not here yet' } : { k: 'idle', label: 'Here' };
    const rs = runs().filter((r) => r.agent === m.name), wait = rs.find((r) => /Waiting|Needs/.test(r.status)), run = rs.find((r) => /Running/.test(r.status));
    return wait ? { k: 'hand', label: `Waiting on you — ${wait.name}`, run: wait.name } : run ? { k: 'work', label: `Working — ${run.name}`, run: run.name } : { k: 'idle', label: 'At its desk' };
  }
  const people = () => Wd().members.filter((m) => m.status !== 'departed');
  function layout() { const L = LS.get('placesLayout', {}); return L[cur().id] || {}; }
  function setLayout(k, order) { const L = LS.get('placesLayout', {}); L[cur().id] = { ...(L[cur().id] || {}), [k]: order }; LS.set('placesLayout', L); }
  function ordered(key, teams) { const o = layout()[key] || []; return teams.slice().sort((a, b) => ((o.indexOf(a.name) + 1 || 999) - (o.indexOf(b.name) + 1 || 999))); }

  // ---------- the model: derived from the workforce every render ----------
  function building() {
    const S = WF().st(), divs = WF().divs(), teams = S.teams.filter((t) => !t.archived);
    const floors = divs.map((d) => ({ key: d.id, name: d.name, head: d.head, teams: ordered(d.id, teams.filter((t) => t.ownDiv === d.id)) }));
    const lobbyTeams = ordered('lobby', teams.filter((t) => !t.ownDiv || !divs.some((d) => d.id === t.ownDiv)));
    const seated = new Set(teams.flatMap((t) => t.members.map((m) => m.name)));
    return { floors, lobby: { key: 'lobby', name: 'Lobby', teams: lobbyTeams, loose: people().filter((m) => !seated.has(m.name)) }, handoffs: S.handoffs.filter((h) => h.state === 'offered') };
  }
  const body = (name) => people().find((m) => m.name === name);
  function desk(name, fn, walking) {
    const m = body(name); if (!m) return '';
    const s = stateOf(m), init = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return `<button class="pl-desk pl-${s.k}${walking ? ' pl-walk' : ''}${peek === name ? ' on' : ''}" data-pl="peek" data-arg="${esc(name)}" aria-label="${esc(name)} — ${esc(s.label)}${fn ? ', ' + fn : ''}"><span class="pl-mon"></span><span class="pl-body ${m.kind === 'agent' ? 'ag' : ''}">${esc(init)}</span><small>${esc(name)}</small>${s.k === 'hand' ? `<em class="pl-flag">${ic('bell')}</em>` : ''}</button>`;
  }
  function pod(t, fk, i, n) {
    const walkers = new Set(building().handoffs.map((h) => h.from));
    return `<div class="pl-pod"><div class="pl-pod-h"><b>${esc(t.name)}</b><small>${t.members.length}</small>${editing ? `<span class="pl-move">${i > 0 ? `<button class="pg-link" data-pl="move" data-arg="${esc(fk)}|${esc(t.name)}|-1" aria-label="Move ${esc(t.name)} left">←</button>` : ''}${i < n - 1 ? `<button class="pg-link" data-pl="move" data-arg="${esc(fk)}|${esc(t.name)}|1" aria-label="Move ${esc(t.name)} right">→</button>` : ''}</span>` : ''}</div>
      <div class="pl-desks">${t.members.map((mm) => desk(mm.name, mm.fn, walkers.has(mm.name))).join('')}</div></div>`;
  }
  function floorHTML(f, here) {
    // VIEW-02: a floor the viewer has no scope for is a closed door — no name, no headcount, no activity
    if (window.XENO_ROLE?.role() === 'guest' && f.key !== 'lobby') return `<section class="pl-floor pl-closed" aria-label="A floor you don’t have access to"><header><b>${ic('lock')} Closed</b><small>You don’t have access to this floor</small></header></section>`;
    const busy = f.teams.flatMap((t) => t.members).map((x) => body(x.name)).filter(Boolean).map(stateOf);
    return `<section class="pl-floor${here ? ' here' : ''}" data-floor="${esc(f.key)}"><header><b>${esc(f.name)}</b><small>${f.teams.length ? `${f.teams.length} team${f.teams.length > 1 ? 's' : ''} · ${busy.filter((s) => s.k === 'work').length} working${busy.some((s) => s.k === 'hand') ? ` · ${busy.filter((s) => s.k === 'hand').length} waiting on you` : ''}` : 'No teams on this floor'}</small>${here ? '<span class="pl-here">You are here</span>' : `<button class="pg-link" data-pl="walk" data-arg="${esc(f.key)}">Walk here</button>`}</header>
      <div class="pl-pods">${f.teams.map((t, i) => pod(t, f.key, i, f.teams.length)).join('') || '<p class="pg-dim">Empty floor. Teams this division owns sit here.</p>'}${f.loose?.length ? `<div class="pl-pod pl-loose"><div class="pl-pod-h"><b>Not on a team</b><small>${f.loose.length}</small></div><div class="pl-desks">${f.loose.map((m) => desk(m.name)).join('')}</div></div>` : ''}</div></section>`;
  }
  function peekHTML() {
    const m = peek && body(peek); if (!m) return '';
    const s = stateOf(m), teams = WF().st().teams.filter((t) => t.members.some((x) => x.name === m.name)), carrying = building().handoffs.filter((h) => h.from === m.name || h.to === m.name), h = P();
    const isMind = (window.XENO_PG_ANIMA?.minds || []).some((x) => x.name === m.name);
    return `<aside class="pl-peek" aria-label="${esc(m.name)}"><div class="pl-peek-h">${h.avatar(m)}<div><b>${esc(m.name)}</b><small>${esc(m.kind === 'agent' ? (m.title || 'Agent') : m.title || 'Member')}</small></div><button class="ib" data-pl="close" aria-label="Close">${ic('x')}</button></div>
      <p class="pl-state pl-${s.k}">${esc(s.label)}</p>
      ${teams.length ? `<dl class="mk-dl">${teams.map((t) => `<dt>${esc(t.name)}</dt><dd>${esc(h.cap(t.members.find((x) => x.name === m.name).fn))}</dd>`).join('')}</dl>` : '<p class="pg-dim">Not on a team.</p>'}
      ${carrying.map((x) => `<p class="cm-banner">${ic('right')}<span>${x.from === m.name ? `Carrying <b>${esc(x.work)}</b> to ${esc(x.to)}` : `${esc(x.from)} is bringing <b>${esc(x.work)}</b>`}</span></p>`).join('')}
      <div class="pl-peek-acts">${m.name !== WF().you() ? h.btn(m.kind === 'agent' ? `Talk to ${m.name}` : `Message ${m.name}`, m.kind === 'agent' && isMind ? `data-xa="animaChat" data-arg="${esc(m.name)}"` : `data-pl="profile" data-arg="${esc(m.name)}"`, false, 'chat') : ''}
        ${s.run ? h.btn('Watch its work', `data-pl="watch" data-arg="${esc(s.run)}"`, true, 'open') : ''}
        ${m.name !== WF().you() ? h.btn('Hand off work', `data-pl="handoff" data-arg="${esc(m.name)}"`, true, 'right') : ''}
        ${h.btn('Profile', `data-pl="profile" data-arg="${esc(m.name)}"`, true)}</div>
      <p class="pg-dim wf-note">The building only shows what you may see. Every action here is the same one as in the Workspace pages, with the same rights.</p></aside>`;
  }
  function listHTML(B) {
    const row = (name, fn) => { const m = body(name); if (!m) return ''; const s = stateOf(m); return `<li><button class="pg-link" data-pl="peek" data-arg="${esc(name)}">${esc(name)}</button><span>${esc(fn ? P().cap(fn) : m.kind === 'agent' ? 'Agent' : 'Person')}</span><span>${esc(s.label)}</span></li>`; };
    const fl = (f) => `<section class="pg-sec"><h3>${esc(f.name)}</h3>${f.teams.map((t) => `<h4 class="mk-sub">${esc(t.name)}</h4><ul class="mk-rcl pl-list">${t.members.map((x) => row(x.name, x.fn)).join('')}</ul>`).join('')}${f.loose?.length ? `<h4 class="mk-sub">Not on a team</h4><ul class="mk-rcl pl-list">${f.loose.map((m) => row(m.name)).join('')}</ul>` : ''}</section>`;
    return [B.lobby, ...B.floors].map(fl).join('');
  }

  function page(it) {
    const h = P(), B = building(), here = SS.get('placesHere:' + cur().id) || 'lobby';
    const floors = it && it !== 'All floors' ? [B.lobby, ...B.floors].filter((f) => f.name === it) : null;
    if (it && it !== 'All floors' && !floors.length) return null;
    const show = floors || [...B.floors.slice().reverse(), B.lobby];
    const walks = B.handoffs.map((x) => `<li>${ic('right')}<span><b>${esc(x.from)}</b> is walking <b>${esc(x.work)}</b> over to <b>${esc(x.to)}</b></span>${x.to === WF().you() ? h.btn('Take it', `data-pl="accept" data-arg="${x.id}"`, false) : ''}</li>`).join('');
    const acts = h.btn(listView ? 'Building view' : 'List view', 'data-pl="list"', true, listView ? 'building' : 'grid') + (isAdmin() && !listView ? h.btn(editing ? 'Done arranging' : 'Arrange', 'data-pl="edit"', true, 'edit') : '');
    return h.page(h.head({ eyebrow: 'Places', title: cur().name, sub: B.floors.length ? `${B.floors.length} floor${B.floors.length > 1 ? 's' : ''} and a lobby · ${people().length} people and agents` : 'A lobby, no floors yet — floors appear when the workspace creates divisions', acts })
      + (walks ? `<ul class="pl-walks">${walks}</ul>` : '')
      + (listView ? listHTML(B) : `<div class="pl-wrap"><div class="pl-building">${show.map((f) => floorHTML(f, f.key === here)).join('')}${!B.floors.length && !floors ? `<p class="pl-empty">${ic('building')}<span>Floors are the workspace’s divisions. ${isAdmin() ? '<button class="pg-link" data-pl="divs">Create divisions</button>' : 'An admin can create them.'}</span></p>` : ''}</div>${peekHTML()}</div>`)
      + h.foot('places', 'GET /api/v2/workspaces/:id/workforce'));
  }

  const ACT = {
    peek(n) { peek = peek === n ? null : n; X().render(); },
    close() { peek = null; X().render(); },
    list() { listView = !listView; X().render(); },
    edit() { editing = !editing; X().render(); if (!editing) X().toast('Layout saved for everyone in the workspace'); },
    walk(k) { SS.set('placesHere:' + cur().id, k); X().render(); },
    move(arg) { const [fk, name, d] = arg.split('|'), B = building(), f = [B.lobby, ...B.floors].find((x) => x.key === fk), names = f.teams.map((t) => t.name), i = names.indexOf(name), j = i + +d; [names[i], names[j]] = [names[j], names[i]]; setLayout(fk, names); window.XENO_NET ? window.XENO_NET.end(() => X().render()) : X().render(); },
    profile(n) { const m = body(n); X().go('global', { global: 'workspace', item: (m?.kind === 'agent' ? 'Agents/' : 'Members/') + n }); },
    watch(run) { X().go('zone', { mode: 'dev', zone: 'agents', zoneOf: 'mode', item: run }); },
    handoff(n) { WF().handoff(n); },
    divs() { X().go('global', { global: 'workspace', item: 'Divisions' }); },
    accept(id) { const x = WF().st().handoffs.find((y) => y.id === id); if (!x) return; x.state = 'accepted'; x.rev.push({ at: Date.now(), by: WF().you(), what: 'Accepted in Places' }); WF().commit(`Accepted — ${x.from} sets ${x.work} down at your desk`); },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pl]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); window.XENO_NET?.begin('places', t.dataset.pl, t); Promise.resolve(ACT[t.dataset.pl]?.(t.dataset.arg)).finally(() => window.XENO_NET?.clear(t)); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && peek && !document.querySelector('.xd')) { peek = null; X().render(); } });
  window.XENO_PLACES = { route: page, building, stateOf };
})();
