/* platform-people.js — on the platform, the workspace's People page shows the real members.
 *
 * The picture ships a sample workspace ("XENO Corp": Mira, Nova, Rui, Ana, Sam, and the agents Atlas, Kit, Juno,
 * Echo), sample teams, knowledge, automations, activity and divisions. Served by the platform they were shown
 * as the signed-in person's own workspace. Here:
 *
 *   - the sample is emptied at once, and the sample teams and handoffs kept in this browser are cleared;
 *   - members are the people in the workspace the person is in (GET /api/workspaces/:id/members), plus the
 *     invites still pending when the person may see them (GET …/invites, admins only). In Personal it is just
 *     the person;
 *   - Invite, Change role and Remove go to the platform (POST …/invites, PATCH and DELETE …/members/:id,
 *     DELETE …/invites/:id). A refusal changes nothing and is said in the platform's own words.
 *
 * Left out, not invented: agents as members, teams, knowledge, automations, activity and divisions have no
 * platform source yet, so those lists are empty.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_PEOPLE = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const S = { status: 'loading', uuid: undefined, role: 'owner', count: 0 };
  const W = () => window.XENO_PG_WORKSPACE;
  const empty = () => { const w = W(); if (!w) return; Object.assign(w, { members: [], teams: [], knowledge: [], automations: [], activity: [], divisions: [] }); };
  empty();
  // the picture's sample teams, handoffs and decisions are kept in this browser by workforce.js: clear them once
  { const wf = LS.get('wf', null); if (!wf || !wf.real) { LS.set('wf', { v: 1, real: true, divisions: [], teams: [], handoffs: [], decisions: [] }); try { window.XENO_WF?.reload?.(); } catch {} } }
  const meName = () => (P.user && (P.user.display_name || P.user.username || P.user.email)) || 'You';
  const paint = () => { try { window.XENO_WF?.reload?.(); X()?.refreshPanel?.(); if (X()?.S?.view === 'global' && X().S.global === 'workspace') X().render(); } catch {} };
  const base = () => '/api/workspaces/' + encodeURIComponent(S.uuid);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || (r && r.d && r.d.error && typeof r.d.error.message === 'string' && r.d.error.message) || fallback;
  // Personal has a workspace row of its own on the platform, but nobody is invited to it: it is just the person
  const teamOf = (w) => (w && !w.personal && w.uuid) || null;
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      await null;   // let `loading` be assigned first: the Personal branch has no other wait, and would clear it before it was set
      const cur =window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.current() : null, uuid = teamOf(cur), w = W();
      S.uuid = uuid;
      if (!uuid) {
        w.name = 'Personal'; w.plan = ''; w.you = { role: 'owner', name: meName() }; S.role = 'owner';
        w.members = [{ id: 'me', uid: P.user ? String(P.user.id) : '', name: meName(), kind: 'human', role: 'owner', title: (P.user && P.user.email) || '', divisions: [], lastActiveAt: null, status: 'active', ownedBy: null }];
        S.status = 'ready';
      } else {
        const [mr, ir] = await Promise.all([api('GET', base() + '/members').catch(() => null), api('GET', base() + '/invites').catch(() => null)]);
        if (mr && mr.ok && Array.isArray(mr.d.members)) {
          const seen = new Set(), unique = (n, alt) => { let name = n; if (seen.has(name)) name = `${n} (${alt})`; seen.add(name); return name; };
          const mine = P.user ? String(P.user.id) : '';
          const members = mr.d.members.map((m) => { const u = m.user || {}; return { id: String(m.id), uid: String(m.user_id || m.id), name: unique(String(u.display_name || u.username || u.email || 'Member'), String(u.email || m.id)), kind: 'human', role: String(m.member_role || 'member'), title: String(u.email || ''), divisions: [], lastActiveAt: null, status: 'active', ownedBy: null }; });
          const invites = ir && ir.ok && Array.isArray(ir.d.invites) ? ir.d.invites.map((i) => ({ id: 'inv_' + i.id, inviteId: String(i.id), uid: '', name: unique(String(i.invited_email), 'invited'), kind: 'human', role: String(i.role || 'member'), title: 'Invited', divisions: [], lastActiveAt: null, status: 'invited', ownedBy: null })) : [];
          const you = members.find((m) => m.uid === mine);
          S.role = (you && you.role) || (mr.d.workspace && mr.d.workspace.member_role) || 'viewer';
          w.name = String((mr.d.workspace && mr.d.workspace.name) || (cur && cur.name) || 'Workspace'); w.plan = ''; w.you = { role: S.role, name: you ? you.name : meName() };
          w.members = [...members, ...invites]; S.status = 'ready';
        } else { w.members = []; S.status = 'error'; }
      }
      S.count = w.members.length; loading = null; paint();
      const now = window.XENO_SCOPE && window.XENO_SCOPE.served ? teamOf(window.XENO_SCOPE.current()) : null;
      if (now !== S.uuid) return load();   // the person switched workspace while this was on its way
    })();
    return loading;
  }
  const member = (name) => (W().members || []).find((m) => m.name === name);
  const canManage = () => S.role === 'owner' || S.role === 'admin';
  const personal = () => { if (S.uuid) return false; toast('This is your personal space. Create a workspace to invite people.'); return true; };

  async function invite() {
    if (personal()) return false;
    if (!canManage()) { toast('Only an owner or admin can invite people to this workspace.'); return false; }
    const v = await D().form({ title: 'Invite people', sub: W().name, submit: 'Send invites', fields: [
      { id: 'emails', label: 'Email addresses', type: 'chips', placeholder: 'name@company.com — Enter to add', validate: (x) => (x.length ? (x.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) ? 'One of these is not an email address.' : null) : 'Add an email address.') },
      { id: 'role', label: 'Role', type: 'seg', value: 'member', options: [['member', 'Member'], ['admin', 'Admin'], ['viewer', 'Viewer']] }] });
    if (!v) return false;
    const sent = [], failed = [];
    for (const email of v.emails) { const r = await api('POST', base() + '/invites', { email, role: v.role }).catch(() => null); if (r && r.ok) sent.push(email); else failed.push([email, said(r, 'not sent')]); }
    toast(failed.length ? `${sent.length} sent. ${failed.map(([e, why]) => `${e}: ${why}`).join(' · ')}` : `${sent.length} invite${sent.length === 1 ? '' : 's'} sent`);
    await load(); return sent.length > 0;
  }
  async function changeRole(name) {
    const m = member(name); if (!m || personal()) return false;
    if (m.status === 'invited') { toast('They have not joined yet. Remove the invite and send a new one with the other role.'); return false; }
    if (m.role === 'owner') { toast('The owner’s role is changed by transferring ownership, not here.'); return false; }
    if (!canManage()) { toast('Only an owner or admin can change roles.'); return false; }
    const v = await D().form({ title: `Change ${name}’s role`, submit: 'Change role', size: 'sm', fields: [{ id: 'role', label: 'Role', type: 'choice', cols: 1, value: m.role, options: [['admin', 'Admin', 'Manages people and settings'], ['member', 'Member', 'Works on everything shared with the workspace'], ['viewer', 'Viewer', 'Can open and read']] }] });
    if (!v || v.role === m.role) return false;
    const r = await api('PATCH', base() + '/members/' + encodeURIComponent(m.id), { member_role: v.role }).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'The role couldn’t be changed. It is as it was.')); return false; }
    toast(`${name} is now ${v.role === 'admin' ? 'an admin' : 'a ' + v.role}`); await load(); return true;
  }
  async function removeMember(name) {
    const m = member(name); if (!m || personal()) return false;
    const mine = P.user && m.uid === String(P.user.id), invited = m.status === 'invited';
    if (!mine && !canManage()) { toast('Only an owner or admin can remove people.'); return false; }
    if (m.role === 'owner' && !invited) { toast('The owner cannot be removed. Transfer ownership first.'); return false; }
    if (!(await D().confirm({ title: invited ? `Cancel the invite to ${name}?` : mine ? `Leave ${W().name}?` : `Remove ${name} from ${W().name}?`, body: invited ? 'The link they were sent stops working.' : mine ? 'You lose access to this workspace and what is shared in it.' : `${esc(name)} loses access to this workspace. What they made stays.`, action: invited ? 'Cancel invite' : mine ? 'Leave' : 'Remove' }))) return false;
    const r = await api('DELETE', invited ? base() + '/invites/' + encodeURIComponent(m.inviteId) : base() + '/members/' + encodeURIComponent(m.id)).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That couldn’t be done. Nothing changed.')); return false; }
    toast(invited ? 'Invite cancelled' : mine ? `You left ${W().name}` : `Removed ${name}`);
    if (mine) { LS.set('workspace', 'personal'); try { await window.XENO_SCOPE.load(); X()?.applyWorkspace?.(); } catch {} }
    await load(); try { X()?.go?.('global', { global: 'workspace', item: 'Members' }); } catch {} return true;
  }
  const leaveWorkspace = () => { const you = (W().members || []).find((m) => P.user && m.uid === String(P.user.id)); if (!S.uuid) { personal(); return false; } if (you && you.role === 'owner') { toast('You own this workspace. Transfer ownership before leaving.'); return false; } return you ? removeMember(you.name) : false; };
  const hook = () => { if (!window.XA) return; Object.assign(window.XA, { invite, changeRole, removeMember, leaveWorkspace }); if (window.XENO_WF) window.XENO_WF.removeWithSettlement = removeMember;
    // switching workspace shows that workspace's people, whichever page is open
    if (!window.XA.__peopleSwitch) { const sw = window.XA.switchWorkspace; window.XA.switchWorkspace = (...a2) => { const r = sw(...a2); sync(); return r; }; window.XA.__peopleSwitch = true; } };
  hook(); if (document.readyState === 'loading') addEventListener('DOMContentLoaded', hook);
  // the page asks on each paint: another workspace, its own people
  function sync() { const cur = window.XENO_SCOPE && window.XENO_SCOPE.served ? teamOf(window.XENO_SCOPE.current()) : null; if (S.uuid !== undefined && !loading && cur !== S.uuid) load(); }
  window.XENO_PEOPLE = { served: true, load, sync, state: () => ({ status: S.status, uuid: S.uuid || null, role: S.role, count: S.count }) };
  Promise.resolve(P.ready).then(async (user) => { if (!user) return; try { await window.XENO_SCOPE?.load?.(); } catch {} hook(); load(); });
})();
