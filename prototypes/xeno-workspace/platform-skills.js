/* platform-skills.js — the skills library (services/skills.js; docs/AGENT-IDENTITY-SKILLS-CORPUS.md, owner 2026-10-24).
 *
 *   Skills          /workspace/workspace/Skills              every skill you can use: yours and your workspaces'
 *   a skill         /workspace/workspace/Skills/<skl_…>      by its stable id, never its name
 *
 * A skill is the open Agent Skills format every agent CLI reads: a SKILL.md with a name, WHEN to use it, and the steps.
 * Each version is immutable; an agent pins one (its Identity tab) and only that version ever reaches it.
 *
 *   GET|POST /api/skills · GET|DELETE /api/skills/:id · POST /api/skills/:id/versions
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SKILLS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k);
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.error || r.d.message)) || d;
  const ID = /^skl_[0-9a-f]{32}$/;
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served && window.XENO_SCOPE.uuid && window.XENO_SCOPE.uuid()) || null;
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const toast = (m) => X()?.toast?.(m);
  const S = { key: null, status: 'idle', list: [], one: null, q: '', busy: false, loaded: false };

  /** SKILL.md from the three things a person writes: its name, when to use it, and the steps. */
  const skillMd = (name, description, body) => `---\nname: ${name}\ndescription: ${String(description).replace(/\n+/g, ' ').trim()}\n---\n\n${String(body || '').trim()}\n`;
  const splitMd = (text) => { const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!m) return { name: '', description: '', body: text || '' }; const fm = {}; for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([\w-]+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2'); } return { name: fm.name || '', description: fm.description || '', body: m[2].trim() }; };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

  async function loadList() {
    const r = await api('GET', '/api/skills');
    if (!r.ok) { S.status = r.status === 403 ? 'denied' : 'error'; return paint(); }
    S.list = r.d.skills || []; S.loaded = true;
  }
  async function load() {
    const at = S.key;
    await loadList(); if (S.key !== at) return;
    const id = at.startsWith('one:') ? at.slice(4) : null;
    if (id) {
      const r = await api('GET', `/api/skills/${id}`);
      if (S.key !== at) return;
      if (r.status === 404) { S.status = 'missing'; return paint(); }
      if (!r.ok) { S.status = 'error'; return paint(); }
      S.one = r.d.skill;
    }
    S.status = 'ready'; paint();
  }

  async function call(method, path, body, fail) {
    if (S.busy) return null;
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) { toast(why(r, fail)); paint(); return null; }
    return r;
  }

  /** New skill: name, when to use it, the steps. Returns the skill, or null. Used here and on an agent's Identity tab. */
  async function create({ open = true } = {}) {
    const ws = wsId(), scope = window.XENO_SCOPE && window.XENO_SCOPE.served && window.XENO_SCOPE.current ? window.XENO_SCOPE.current() : null;
    const team = ws && scope && !scope.personal;
    const v = await D().form({ title: 'New skill', sub: 'A skill tells an agent HOW to do one kind of work. Agents see its name and when to use it, and read the steps when it fits. It is the same SKILL.md format Claude Code, Codex and the XENO CLI read.', submit: 'Create skill', size: 'md', fields: [
      { id: 'name', label: 'Name', required: true, max: 64, placeholder: 'ledger-review', hint: 'Lowercase words joined by hyphens' },
      { id: 'description', label: 'When to use it', type: 'textarea', required: true, rows: 2, max: 1024, placeholder: 'Use when a change touches money: how to check it before sending it for review.' },
      { id: 'body', label: 'Steps', type: 'textarea', required: true, rows: 10, max: 200000, placeholder: '1. Run the ledger tests.\n2. Reconcile the totals.\n3. Report what changed, how you checked it, and what you are unsure of.' },
      ...(team ? [{ id: 'where', label: 'Belongs to', type: 'choice', cols: 1, value: 'workspace', options: [['workspace', scope.name || 'This workspace', 'Its members can use it; its editors change it'], ['personal', 'Only me', 'Yours alone']] }] : [])] });
    if (!v) return null;
    const name = slug(v.name);
    const r = await call('POST', '/api/skills', { skillMd: skillMd(name, v.description, v.body), workspaceId: team && v.where !== 'personal' ? ws : null }, 'The skill could not be created.');
    if (!r) return null;
    toast(`Created ${r.d.skill.name}`); S.list.unshift(r.d.skill);
    if (open) go(`Skills/${r.d.skill.id}`); else paint();
    return r.d.skill;
  }
  async function newVersion() {
    const s = S.one; if (!s) return;
    const cur = splitMd((s.files.find((f) => f.path === 'SKILL.md') || {}).content);
    const v = await D().form({ title: `New version of ${s.name}`, sub: `Version ${s.version} stays exactly as it is, and every agent that uses it keeps it until someone moves it to the new one.`, submit: 'Publish version', size: 'md', fields: [
      { id: 'description', label: 'When to use it', type: 'textarea', required: true, rows: 2, max: 1024, value: cur.description },
      { id: 'body', label: 'Steps', type: 'textarea', required: true, rows: 12, max: 200000, value: cur.body }] });
    if (!v) return;
    const files = [{ path: 'SKILL.md', content: skillMd(s.name, v.description, v.body) }, ...s.files.filter((f) => f.path !== 'SKILL.md')];
    const r = await call('POST', `/api/skills/${s.id}/versions`, { files }, 'The version could not be published.');
    if (r) { toast(`Published ${r.d.skill.version}`); S.key = null; paint(); }
  }
  async function archive() {
    const s = S.one; if (!s) return;
    if (!(await D().confirm({ title: `Archive ${esc(s.name)}?`, body: 'It leaves the library. Agents that use a version of it keep working with that version.', action: 'Archive' }))) return;
    const r = await call('DELETE', `/api/skills/${s.id}`, undefined, 'It could not be archived.');
    if (r) { toast('Archived'); S.list = S.list.filter((x) => x.id !== s.id); go('Skills'); }
  }

  // ───────────────────────── pages
  function listPage() {
    const h = H(), q = S.q.toLowerCase();
    const rows = S.list.filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q));
    const head = h.head({ title: 'Skills', sub: S.list.length ? `${h.plural(S.list.length, 'skill', 'skills')} you can give your agents` : 'How your agents do one kind of work, written once and used by every agent you give it to.', acts: h.btn('New skill', 'data-xsk="new"', false, 'plus') });
    if (!S.list.length) return h.page(head + `<div class="xsk-first"><h2>Teach your agents how you work</h2>
      <p>A skill is one kind of work, written down: when to use it, and the steps. Give it to any of your agents; they see its name and when to use it, and read the steps when it fits — in Claude Code, Codex, Spawn or the cloud. Each version is fixed, so an agent never changes under you.</p>
      ${h.btn('Create your first skill', 'data-xsk="new"', false, 'plus')}</div>`, 'xsk');
    return h.page(head + `<div class="pg-bar"><label class="pg-search">${ic('search')}<input data-xsk-q value="${esc(S.q)}" placeholder="Search skills" aria-label="Search skills"></label></div>`
      + (rows.length ? `<div class="xsk-rows">${rows.map((s) => `<button type="button" class="xsk-row" data-xsk="open" data-id="${esc(s.id)}"><span class="xsk-ic">${ic('doc')}</span><span class="xsk-b"><b>${esc(s.name)}</b><small>${esc(s.description)}</small></span><span class="xsk-m">${s.owner.kind === 'workspace' ? 'Workspace' : 'Yours'} · ${esc(s.version || '')}</span></button>`).join('')}</div>`
        : h.box('search', `No skill matches “${esc(S.q)}”`, 'Try a shorter word.', h.btn('Clear search', 'data-xsk="clearq"', true))), 'xsk');
  }
  function onePage() {
    const h = H(), s = S.one; if (!s) return null;
    const md = splitMd((s.files.find((f) => f.path === 'SKILL.md') || {}).content);
    const acts = s.canEdit ? h.btn('Archive', 'data-xsk="archive"', true) + h.btn('New version', 'data-xsk="version"', false, 'plus') : '';
    return h.page(h.head({ obj: true, eyebrow: '<a data-xsk="list">Skills</a>', title: s.name, sub: s.description, acts })
      + `<div class="pg-cols pg-cols--item"><div>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Steps</h3><small>SKILL.md · version ${esc(s.version)}</small></div><pre class="xsk-md">${esc(md.body)}</pre></section>
          ${s.files.length > 1 ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Files</h3><small>${s.files.length}</small></div><div class="xsk-files">${s.files.map((f) => `<code>${esc(f.path)}</code>`).join('')}</div></section>` : ''}
        </div><aside><dl class="pg-props"><dt>Belongs to</dt><dd>${s.owner.kind === 'workspace' ? 'This workspace' : 'You'}</dd><dt>Version</dt><dd>${esc(s.version)}</dd><dt>Hash</dt><dd><code title="${esc(s.hash)}">${esc(s.hash.slice(0, 12))}…</code></dd>
          <dt>Id</dt><dd><code>${esc(s.id.slice(0, 12))}…</code></dd></dl>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Versions</h3></div><ol class="xsk-vers">${s.versions.map((v) => `<li${v.version === s.version ? ' class="cur"' : ''}><b>${esc(v.version)}</b><small>${esc(new Date(v.createdAt).toLocaleDateString())}</small></li>`).join('')}</ol>
          <p class="xsk-note">A version never changes. Give a skill to an agent on the agent’s Identity tab.</p></section></aside></div>`, 'xsk');
  }

  function route(it) {
    if (it !== 'Skills' && !(it || '').startsWith('Skills/')) return null;
    style();
    const id = it.startsWith('Skills/') ? it.slice(7) : null;
    const h = H();
    if (id && !ID.test(id)) return h.page(h.head({ eyebrow: '<a data-xsk="list">Skills</a>', title: 'Skill not found' }) + h.box('doc', 'This skill link is not valid', 'Skills are addressed by their id. Open it from the library.', h.btn('All skills', 'data-xsk="list"', true)), 'xsk');
    const key = id ? 'one:' + id : 'list';
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xsk-skel" aria-busy="true"><i></i><i></i></div>', 'xsk');
    if (S.status === 'error') return h.page(h.box('alert', 'Your skills could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xsk="retry"')), 'xsk');
    if (S.status === 'missing') return h.page(h.head({ eyebrow: '<a data-xsk="list">Skills</a>', title: 'Skill not found' }) + h.box('doc', 'This skill is gone', 'It was archived, or it is not yours.', h.btn('All skills', 'data-xsk="list"', true)), 'xsk');
    return id ? onePage() : listPage();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xsk]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xsk;
    if (a === 'open') return go(`Skills/${b.dataset.id}`);
    if (a === 'list') return go('Skills');
    if (a === 'new') return create();
    if (a === 'version') return newVersion();
    if (a === 'archive') return archive();
    if (a === 'retry') { S.key = null; return paint(); }
    if (a === 'clearq') { S.q = ''; return paint(); }
  });
  document.addEventListener('input', (e) => { const q = e.target.closest('.xsk [data-xsk-q]'); if (!q) return; S.q = q.value; const pos = q.selectionStart; paint(); const n = document.querySelector('.xsk [data-xsk-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });

  const style = () => {
    if (document.getElementById('xsk-css')) return; const s = document.createElement('style'); s.id = 'xsk-css';
    s.textContent = [
      '.xsk-first{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:620px;margin:32px 0}.xsk-first h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}.xsk-first p{margin:0;font-size:13.5px;line-height:1.6;color:var(--muted)}',
      '.xsk-rows{border:1px solid var(--n31);border-radius:6px;overflow:hidden}.xsk-row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;text-align:left;cursor:pointer}.xsk-row:last-child{border-bottom:0}.xsk-row:hover{background:var(--hover)}',
      '.xsk-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:4px;background:var(--n24)}.xsk-ic svg{width:15px;height:15px}.xsk-b{display:flex;flex-direction:column;gap:2px;min-width:0}.xsk-b b{font-size:13px;font-weight:600;font-family:ui-monospace,Consolas,monospace}.xsk-b small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-m{font-size:12px;color:var(--muted);white-space:nowrap}',
      '.xsk-md{margin:0;padding:14px 16px;border:1px solid var(--n31);border-radius:6px;background:var(--canvas);font:12.5px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:640px;overflow:auto}',
      '.xsk-files{display:flex;flex-wrap:wrap;gap:6px}.xsk-files code{padding:3px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px}',
      '.xsk-vers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.xsk-vers li{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)}.xsk-vers li.cur{color:var(--text)}.xsk-note{margin:10px 0 0;font-size:12px;color:var(--muted);line-height:1.5}',
      '.xsk-skel{display:grid;gap:10px;padding-top:60px}.xsk-skel i{height:56px;border-radius:6px;background:var(--panel);animation:xsks 1.2s ease-in-out infinite alternate}@keyframes xsks{to{opacity:.5}}',
    ].join('');
    document.head.appendChild(s);
  };

  // the library in the background, for the sidebar count and an agent's Identity tab
  setTimeout(() => { loadList().then(paint); }, 1800);
  window.XENO_SKILLS = { served: true, route, create, list: () => S.list, loaded: () => S.loaded, reload: () => loadList().then(paint),
    count: () => (S.loaded ? S.list.length : null), nameOf: (id) => { const s = (S.one && S.one.id === id) ? S.one : S.list.find((x) => x.id === id); return s ? s.name : 'Skill'; }, isId: (s) => ID.test(String(s || '')) };
})();
