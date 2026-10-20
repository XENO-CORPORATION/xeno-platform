/* platform-services.js — a workspace admin manages the SERVICE ACCOUNTS in the workspace (D-3, owner 2026-10-20).
 *
 *   Service accounts      /workspace/workspace/Services              the service accounts in this workspace
 *   a service account     /workspace/workspace/Services/<uuid>       by id: its named grants and their history
 *
 * A service account has no owner, so it is denied on Tasks, Storage and Marketplace listings unless it holds a NAMED
 * grant. Granting or revoking one is recorded in the workspace's audit log.
 *
 *   GET /api/workspaces/:id/service-accounts[/:sid] · PUT|DELETE /api/workspaces/:id/service-accounts/:sid/capabilities/:name
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SERVICES = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k);
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.error || r.d.message)) || d;
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const wsId = () => { const s = window.XENO_SCOPE; const u = s && s.served && s.uuid && s.uuid(); if (u) return u; const w = window.XA?.currentWorkspace?.(); return w && UUID.test(String(w.id)) ? w.id : null; };
  const S = { key: null, status: 'idle', list: [], one: null, history: [], busy: false };
  const base = () => `/api/workspaces/${wsId()}/service-accounts`;

  async function load() {
    const at = S.key, id = at.split('@')[0].startsWith('one:') ? at.split('@')[0].slice(4) : null;
    if (!wsId()) { S.status = 'noscope'; return paint(); }
    const r = await api('GET', id ? `${base()}/${id}` : base());
    if (S.key !== at) return;
    if (r.status === 403) { S.status = 'denied'; return paint(); }
    if (r.status === 404) { S.status = 'missing'; return paint(); }
    if (!r.ok) { S.status = 'error'; return paint(); }
    if (id) { S.one = r.d.serviceAccount; S.history = r.d.history || []; } else S.list = r.d.serviceAccounts || [];
    S.status = 'ready'; paint();
  }

  const granted = (s) => s.capabilities.filter((c) => c.granted);
  function listPage() {
    const h = H();
    const head = h.head({ title: 'Service accounts', sub: 'Accounts that act for a program, not a person. They need a named grant for Tasks, Storage and Marketplace listings.' });
    if (!S.list.length) return h.page(head + h.box('key', 'No service accounts in this workspace', 'A service account added to this workspace appears here, and you can then grant it what it may use.'), 'xsv');
    return h.page(head + h.table(['Service account', 'May use'], S.list.map((s) => h.tr(`data-xsv="open" data-id="${esc(s.id)}"`,
      [`<b class="pg-name">${esc(s.name)}</b>${s.username ? ` <small class="pg-dim">@${esc(s.username)}</small>` : ''}`,
        granted(s).length ? esc(granted(s).map((c) => c.label).join(', ')) : '<small class="pg-dim">Nothing yet</small>'])))
      + `<p class="pg-rule">${ic('lock')}A service account has no owner to answer for it, so it may use only what is named here. Every change is recorded.</p>`, 'xsv');
  }

  function onePage() {
    const h = H(), s = S.one; if (!s) return null;
    const rows = s.capabilities.map((c) => `<label class="xsv-cap"><input type="checkbox" data-xsv-cap="${esc(c.name)}" ${c.granted ? 'checked' : ''} ${S.busy ? 'disabled' : ''}><span><b>${esc(c.label)}</b><small>${c.granted ? 'Granted' : 'Not granted'}</small></span></label>`).join('');
    const hist = S.history.length ? h.table(['Change', 'By', 'When'], S.history.map((x) => h.tr('', [`${x.action === 'service.grant' ? 'Granted' : 'Revoked'} ${esc((s.capabilities.find((c) => c.name === x.capability) || {}).label || x.capability || '')}`, esc(x.actor || 'Someone'), `<small class="pg-dim">${esc(new Date(x.at).toLocaleString())}</small>`])))
      : '<p class="pg-dim">No changes yet.</p>';
    return h.page(h.head({ obj: true, eyebrow: '<a data-xsv="list">Service accounts</a>', title: s.name, sub: s.username ? '@' + s.username : 'Service account' })
      + `<div class="pg-cols pg-cols--item"><div>
        <section class="pg-sec"><div class="pg-sec-h"><h3>What it may use</h3></div><div class="xsv-caps" data-xsv-caps>${rows}</div>
          <p class="pg-dim wf-note">A grant applies in this workspace only. Other workspaces decide for themselves.</p></section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>History</h3></div>${hist}</section>
      </div><aside><dl class="pg-props"><dt>Kind</dt><dd>Service</dd><dt>Created</dt><dd>${esc(new Date(s.createdAt).toLocaleDateString())}</dd><dt>Id</dt><dd><small>${esc(s.id.slice(0, 8))}…</small></dd></dl></aside></div>`, 'xsv');
  }

  function route(it) {
    if (it !== 'Services' && !(it || '').startsWith('Services/')) return null;
    style();
    const id = it.startsWith('Services/') ? it.slice(9) : null;
    const h = H();
    if (id && !UUID.test(id)) return h.page(h.head({ eyebrow: '<a data-xsv="list">Service accounts</a>', title: 'Service account not found' }) + h.box('key', 'This link is not valid', 'Service accounts are addressed by their id.', h.btn('All service accounts', 'data-xsv="list"', true)), 'xsv');
    const key = (id ? 'one:' + id.toLowerCase() : 'list') + '@' + (wsId() || '');
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xsv-skel" aria-busy="true"><i></i><i></i></div>', 'xsv');
    if (S.status === 'error') return h.page(h.box('alert', 'Service accounts could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xsv="retry"')), 'xsv');
    if (S.status === 'noscope') return h.page(h.box('key', 'Choose a workspace', 'Service accounts are managed per workspace.'), 'xsv');
    if (S.status === 'denied') return h.page(h.head({ title: 'Service accounts' }) + h.box('lock', 'Only a workspace admin manages service accounts', 'Ask an admin of this workspace.'), 'xsv');
    if (S.status === 'missing') return h.page(h.head({ eyebrow: '<a data-xsv="list">Service accounts</a>', title: 'Service account not found' }) + h.box('key', 'It is not in this workspace', 'It was removed, or it never belonged here.', h.btn('All service accounts', 'data-xsv="list"', true)), 'xsv');
    return id ? onePage() : listPage();
  }
  const nameOf = (id) => { const s = (S.one && S.one.id === id) ? S.one : S.list.find((x) => x.id === id); return s ? s.name : 'Service account'; };

  async function toggle(cap, on) {
    const s = S.one; if (!s || S.busy) return;
    const c = s.capabilities.find((x) => x.name === cap);
    if (!on && !(await D().confirm({ title: `Revoke ${esc(c ? c.label : cap)}?`, body: `${esc(s.name)} can no longer use ${esc(c ? c.label : cap)}. This is recorded.`, action: 'Revoke' }))) return paint();
    S.busy = true; paint();
    const r = await api(on ? 'PUT' : 'DELETE', `${base()}/${s.id}/capabilities/${encodeURIComponent(cap)}`);
    S.busy = false;
    if (!r.ok) { toast(why(r, 'That could not be changed.')); return paint(); }
    toast(on ? `Granted ${c ? c.label : cap}` : `Revoked ${c ? c.label : cap}`);
    const one = await api('GET', `${base()}/${s.id}`); if (one.ok) { S.one = one.d.serviceAccount; S.history = one.d.history || []; } else S.one = r.d.serviceAccount;
    paint();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xsv]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xsv;
    if (a === 'open') return go(`Services/${b.dataset.id}`);
    if (a === 'list') return go('Services');
    if (a === 'retry') { S.key = null; return paint(); }
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-xsv-cap]'); if (!c || !c.closest('#main')) return;
    toggle(c.dataset.xsvCap, c.checked);
  });

  const style = () => {
    if (document.getElementById('xsv-css')) return; const s = document.createElement('style'); s.id = 'xsv-css';
    s.textContent = '.xsv-caps{display:grid;gap:6px}.xsv-cap{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--panel);cursor:pointer}.xsv-cap span{display:grid}.xsv-cap small{color:var(--muted);font-size:12px}'
      + '.xsv-skel{display:grid;gap:8px;padding-top:60px;max-width:720px}.xsv-skel i{height:72px;border-radius:10px;background:var(--panel);animation:xsvs 1.2s ease-in-out infinite alternate}@keyframes xsvs{to{opacity:.5}}';
    document.head.appendChild(s);
  };

  window.XENO_SERVICES = { served: true, route, nameOf, isId: (s) => UUID.test(String(s || '')), reload: () => { S.key = null; paint(); } };
})();
