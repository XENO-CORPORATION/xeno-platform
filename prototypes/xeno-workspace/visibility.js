/* XENO_VIS — what each role may SEE (XENO-WORKFORCE-01 VIEW-02: no leak through names, counts or "not allowed" pages).
 *   Guest  — sees only what was shared with them: shared projects and their files, the Places lobby, plus everything that is
 *            theirs account-wide (Anima, personal settings, Community, browsing the Marketplace). The workspace's members,
 *            agents, divisions, decisions, settings and company are not shown; a project that wasn't shared reads exactly
 *            like one that doesn't exist.
 *   Member — sees the workspace and the company's name, legal entity and staff; the wallet, its ledger and the identifiers
 *            are for owners and admins.
 * The server is the real gate; this layer makes the screen honest about it. Platform: every list route filters by the
 * caller's scope (VIEW-01..04); a project or file outside it answers 404, never 403.
 */
(() => {
  const X = () => window.XW, P = () => window.XENO_PAGES.h, R = () => window.XENO_ROLE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const role = () => R()?.role() || 'owner', guest = () => role() === 'guest';
  const sharedProjects = () => (window.XENO_PG_PROJECTS?.items || []).filter((p) => p.status === 'shared').map((p) => p.name);
  const project = (p) => !guest() || p.status === 'shared';
  const file = (f) => !guest() || !!f.sharedBy || sharedProjects().includes(f.project);
  // a project you can't see is not "forbidden" — it is simply not there (404, not 403)
  const notThere = (name) => { const h = P(); return h.page(h.head({ eyebrow: '<a data-go="projects">Projects</a>', title: 'Project not found', sub: '' }) + h.box('folder', 'There’s no project here', 'It may have been renamed, or it isn’t shared with you. Ask whoever sent you the link.', '<button class="pg-btn ghost" data-go="projects"><span>All projects</span></button>') + h.foot('projects', 'GET /api/v2/projects/:id → 404')); };
  function workspaceAsGuest() {
    const h = P(), w = window.XA.currentWorkspace(), ps = (window.XENO_PG_PROJECTS?.items || []).filter(project), fs = (window.XENO_PG_LIBRARY?.items || []).filter((f) => !f.trashedAt && file(f));
    return h.page(h.head({ eyebrow: 'Workspace', title: w.name, sub: 'You’re a guest here — you see only what was shared with you.' })
      + `<p class="cm-banner">${X().ic('user')}<span><b>You’re a guest here.</b> You see only what was shared with you in ${esc(w.name)}.</span></p>`
      + `<section class="pg-sec"><h3>Shared with you</h3><ul class="mk-owns">${ps.map((p) => `<li class="mk-own"><span class="pg-thumb pg-thumb--ic sq">${X().ic('folder')}</span><span class="mk-own-m"><a data-go="projects" data-vis-project="${esc(p.name)}"><b>${esc(p.name)}</b></a><small>Project · shared by ${esc(p.owner.name)}</small></span></li>`).join('') || '<li class="pg-dim">Nothing is shared with you yet.</li>'}</ul></section>`
      + `<section class="pg-sec"><h3>Files</h3><p class="pg-dim">${fs.length ? `${fs.length} file${fs.length > 1 ? 's' : ''} in your Library.` : 'No files shared with you.'}</p></section>`
      + `<p class="pg-rule">${X().ic('lock')}Members, agents, teams and settings are visible to the workspace’s members.</p>` + h.foot('workspace', 'GET /api/v2/workspaces/:id → guest scope'));
  }
  function route(global, it) {
    if (global === 'workspace' && guest()) { if (it && sharedProjects().includes(it)) setTimeout(() => X().go('global', { global: 'projects', item: it }), 0); return workspaceAsGuest(); }
    if (global === 'projects' && guest() && it) { const name = it.split('/')[0]; if (name !== 'Archived projects' && !sharedProjects().includes(name)) return notThere(name); }
    return null;
  }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-vis-project]'); if (!a) return; e.preventDefault(); e.stopPropagation(); X().go('global', { global: 'projects', item: a.dataset.visProject }); }, true);

  // actions that change the workspace — the rest of the gates live with their areas
  R()?.gate('xa', ['invite', 'setCap', 'allowRun', 'retryRun', 'resolveNeed', 'removeMember', 'changeRole', 'assignMember', 'knowledgeAccess', 'reindex', 'removeKnowledge', 'budget'], 'manage', 'Owners and admins do this for the workspace');
  R()?.gate('xa', ['getListing'], 'buy', 'Owners and admins add things to the workspace — open the listing to ask them');
  R()?.gate('xa', ['newProject', 'newTask', 'projectMenu', 'upload', 'assign', 'newProjectChat'], 'contribute', 'Guests can’t change this workspace');
  R()?.gate('fd', ['cap', 'grant', 'approve', 'addMs', 'editMs', 'campaign'], 'manage', 'Owners and admins manage this project’s funding');
  // the sidebar is part of the page: a guest's lists show only what was shared, with no workspace counts
  function nav(k, primary, groups) {
    if (!guest()) return [primary, groups];
    if (k === 'workspace') return [null, [['Shared with you', (window.XENO_PG_PROJECTS?.items || []).filter(project).map((p) => [p.name, 'Project'])]]];
    if (k === 'projects') return [null, groups.filter(([t]) => t === 'Shared with me')];
    if (k === 'places') return [null, [['Building', [['Lobby', '']]]]];
    return [primary, groups];
  }
  window.XENO_VIS = { project, file, route, guest, nav };
})();
