/* Business setup (MODES SPEC §8c.4): "a setup for your business" for someone who has never used AI. No "AI", "agent",
 * "model" or "prompt" on these screens. What do you do? → your business name → here is your workspace → Set it up.
 *
 * The server does the work (services/modeApply.js): plan writes nothing and returns a hash; apply takes that hash, an
 * idempotency key and the admin's confirmation, and creates everything in one transaction; Undo archives what nobody
 * has touched since. Address: ?setup=business on any workspace page opens it (and a reload reopens it).
 * Controls: [data-xsu] — open, open-docs, docs, custom, trade, next, back, apply, undo, pick, propose, task-del, task-add, use.
 *
 * "Start from your documents or your idea" (services/workspaceArchitect.js): paste text and/or pick files you can open
 * → the server proposes the workspace, every part citing the passages it came from → you edit it → it is planned and
 * applied like any setup (pack `proposal:<id>`). Nothing is applied until you press Set it up.
 */
(() => {
  const P = window.XENO_PLATFORM, X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (m, u, b) => (P && P.api ? P.api(m, u, b) : Promise.resolve({ ok: false, status: 0, d: {} }));
  const PICS = { salon: '✂', club: '⚑', photographer: '◉' };
  let st = null;

  const where = () => { const w = (window.XENO_CUSTOM?.workspaces || []).filter((x) => x.admin); return w.find((x) => x.type === 'personal') || w[0] || null; };
  function setAddress(on) { try { const u = new URL(location.href); if (on) u.searchParams.set('setup', 'business'); else u.searchParams.delete('setup'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch {} }

  function view() {
    if (st.error) return `<p class="xsu-err" role="alert">${esc(st.error)}</p>`;
    if (st.step === 'trade') {
      const done = (st.applied || []).filter((a) => !a.revertedAt);
      return `<h3 class="xsu-h">What do you do?</h3><div class="xsu-grid" role="list">${st.packs.map((p) => `<button type="button" class="xsu-trade" role="listitem" data-xsu="trade" data-arg="${esc(p.id)}"><span class="xsu-pic" aria-hidden="true">${PICS[p.trade] || '◆'}</span><b>${esc(p.title)}</b><small>${esc(p.summary)}</small></button>`).join('')}
        <button type="button" class="xsu-trade" role="listitem" data-xsu="docs"><span class="xsu-pic" aria-hidden="true">▤</span><b>Start from your documents or your idea</b><small>Describe it, or pick your plans and notes. We propose the whole workspace.</small></button>
        <button type="button" class="xsu-trade" role="listitem" data-xsu="custom"><span class="xsu-pic" aria-hidden="true">＋</span><b>Something else</b><small>Pick the products yourself.</small></button></div>`
        + (done.length ? `<h4 class="xsu-h4">Already set up</h4>${done.map((a) => `<div class="xsu-row"><span>${esc(a.packId)} · ${esc(new Date(a.appliedAt).toLocaleDateString())}</span><button type="button" class="xd-btn ghost" data-xsu="undo" data-arg="${esc(a.applicationId)}">Undo</button></div>`).join('')}` : '');
    }
    if (st.step === 'docs') return `<h3 class="xsu-h">Start from your documents or your idea</h3>
      <label class="xsu-f"><span>Your idea, in your own words</span><textarea data-xsu-idea rows="5" maxlength="20000">${esc(st.idea || '')}</textarea></label>
      <h4 class="xsu-h4">Your files</h4>${st.files === null ? '<p class="xsu-p">Loading your files…</p>' : st.files.length ? `<div class="xsu-files">${st.files.map((f) => `<label class="xsu-file"><input type="checkbox" data-xsu="pick" data-arg="${esc(f.id)}" ${st.picked.has(f.id) ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div>` : '<p class="xsu-p">No files yet. Your idea is enough to start.</p>'}
      <p class="xsu-p">This reads only what you pick, and costs a few credits. Nothing is set up until you say so.</p>
      <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="propose">Propose my workspace</button></div>`;
    if (st.step === 'building') return '<p class="xsu-p" role="status">Reading what you gave and drafting your workspace…</p>';
    if (st.step === 'proposal') {
      const pr = st.proposal, x = pr.proposal, pk = pr.pack, cites = (c) => (c || []).map((r) => { const s = x.citations[r]; return `<span class="xsu-cite" title="${esc(s ? s.excerpt : '')}">${esc(s ? s.name : r)}</span>`; }).join(' ');
      const extra = ['divisions', 'teams', 'agents', 'projects', 'objectives', 'layout'].filter((k) => (x[k] || []).length);
      return `<h3 class="xsu-h">${esc(x.title || pk.mode.name)}</h3><p class="xsu-p">${esc(x.summary || '')}</p>
        ${x.diff ? `<p class="xsu-p" data-xsu-diff>This adds to “${esc(pk.mode.name)}”, already in your workspace: ${x.diff.tasksNew.length} new task${x.diff.tasksNew.length === 1 ? '' : 's'}. Your changes to it are kept.${x.diff.productsSuggestedAdd.length ? ` Suggested to add: ${esc(x.diff.productsSuggestedAdd.join(', '))}.` : ''}</p>` : `<label class="xsu-f"><span>Name</span><input data-xsu-mname maxlength="40" value="${esc(pk.mode.name)}"></label>`}
        <div class="xsu-rooms" aria-label="What you get">${pk.mode.products.map((p) => `<span class="xsu-room">${esc(X()?.PR?.[p]?.name || p)}</span>`).join('')}</div><small class="xsu-why">Because: ${cites(x.mode.cites)}</small>
        <h4 class="xsu-h4">First tasks</h4><ul class="xsu-tasks">${pk.tasks.map((t, i) => { const c = (x.tasks.find((y) => y.title === t.title) || {}).cites; return `<li><input data-xsu-task="${i}" value="${esc(t.title)}" maxlength="300"> <button type="button" class="xd-btn ghost" data-xsu="task-del" data-arg="${i}" aria-label="Remove">✕</button>${c ? `<small class="xsu-why">${cites(c)}</small>` : ''}</li>`; }).join('')}</ul>
        <button type="button" class="xd-btn ghost" data-xsu="task-add">Add a task</button>
        ${extra.map((k) => `<h4 class="xsu-h4">${esc(k[0].toUpperCase() + k.slice(1))} <small>${k === 'layout' ? '(a note for your building)' : '(set up with it, unless already there)'}</small></h4><ul class="xsu-tasks" data-xsu-sugg="${k}">${x[k].map((e) => `<li>${esc(e.name || e.title || e.area)}${e.purpose || e.role || e.goal || e.measure || e.placement ? ` — <small>${esc(e.purpose || e.role || e.goal || e.measure || e.placement)}</small>` : ''} <small class="xsu-why">${cites(e.cites)}</small></li>`).join('')}</ul>`).join('')}
        ${pr.sources.unavailable.length ? `<p class="xsu-p">${pr.sources.unavailable.length} item${pr.sources.unavailable.length === 1 ? ' was' : 's were'} not read (not yours to open, or not ready).</p>` : ''}
        <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="use">Next</button></div>`;
    }
    if (st.step === 'name') return `<h3 class="xsu-h">${esc(st.pack.title)}</h3>${st.pack.questions.map((q) => `<label class="xsu-f"><span>${esc(q.label)}</span><input data-q="${esc(q.id)}" maxlength="${q.max || 60}" value="${esc(st.answers[q.id] || '')}" ${q.required ? 'required' : ''}></label>`).join('')}
      <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="next">Next</button></div>`;
    if (st.step === 'plan') {
      const pl = st.plan, mode = pl.records.find((r) => r.type === 'mode') || st.pack.mode, tasks = pl.records.filter((r) => r.type === 'task');
      const PR = X()?.PR || {};
      return `<h3 class="xsu-h">Here is your workspace</h3><p class="xsu-p">${esc(st.answers.businessName || st.pack.title || '')} · in ${esc(pl.workspaceName)}</p>
        <div class="xsu-rooms" aria-label="What you get">${mode.products.map((p) => `<span class="xsu-room">${esc(PR[p]?.name || p)}</span>`).join('')}</div>
        ${[['division', 'Divisions'], ['team', 'Teams'], ['agent', 'Helpers'], ['project', 'Projects'], ['objective', 'Objectives']].map(([t, h]) => { const rs = pl.records.filter((r) => r.type === t && (r.key || t !== 'project')); return rs.length ? `<h4 class="xsu-h4">${h}</h4><ul class="xsu-tasks" data-xsu-plan="${t}">${rs.map((r) => `<li>${esc(r.name || r.title)}</li>`).join('')}</ul>` : ''; }).join('')}
        <h4 class="xsu-h4">Waiting for you first</h4><ul class="xsu-tasks">${tasks.map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul>
        <p class="xsu-p">Nothing is charged for this setup. You can undo it later; anything you change is kept.</p>
        ${pl.conflicts.length ? '<p class="xsu-err" role="alert">This setup is already in your workspace.</p>' : ''}
        <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="apply" ${pl.conflicts.length ? 'disabled' : ''}>Set it up</button></div>`;
    }
    return '<p class="xsu-p">Setting it up…</p>';
  }
  const paint = () => { if (st?.sh) st.sh.querySelector('.xsu').innerHTML = view(); };

  async function loadApplied() { const r = await api('GET', `/api/v2/workspaces/${st.ws.id}/modes/applications`); st.applied = r.ok ? r.d.applications : []; }
  async function loadFiles() {
    const r = await api('GET', '/api/library/assets?sort=updated&limit=100');
    st.files = r.ok && Array.isArray(r.d.items) ? r.d.items.filter((i) => (i.source || 'file') === 'file').map((i) => ({ id: i.id, name: i.name || i.original_name || i.filename || 'File' })) : [];
    paint();
  }
  function toDocs(idea) { st.step = 'docs'; st.idea = idea ?? st.idea ?? ''; st.picked = st.picked || new Set(); st.files = st.files ?? null; paint(); if (st.files === null) loadFiles(); }
  function readEdits() {
    if (st.step === 'docs') { const t = st.sh.querySelector('[data-xsu-idea]'); if (t) st.idea = t.value; }
    if (st.step === 'proposal') {
      const pk = st.proposal.pack, nm = st.sh.querySelector('[data-xsu-mname]');
      if (nm) pk.mode.name = nm.value.trim() || pk.mode.name;
      st.sh.querySelectorAll('[data-xsu-task]').forEach((i) => { pk.tasks[Number(i.dataset.xsuTask)].title = i.value.trim(); });
      pk.tasks = pk.tasks.filter((t) => t.title);
    }
  }
  async function open(opts = {}) {
    if (st) { if (opts.docs) toDocs(opts.idea); return; }
    if (!window.XENO_CUSTOM?.server) await window.XENO_CUSTOM?.hydrate?.();
    const ws = where();
    st = { step: 'trade', answers: {}, packs: [], ws, error: ws ? null : 'Only someone who runs a workspace can set it up.' };
    setAddress(true);
    D().info({ title: 'A setup for your business', sub: ws ? ws.name : '', size: 'md', html: '<div class="xsu" data-xsu-root></div>',
      onOpen: async (sh, sheet) => { st.sh = sh; st.sheet = sheet; paint();
        sh.addEventListener('click', onClick);
        if (!ws) return;
        const r = await api('GET', `/api/v2/workspaces/${ws.id}/modes/packs`); st.packs = r.ok ? r.d.packs : []; await loadApplied();
        if (opts.docs) toDocs(opts.idea); else paint(); } })
      .then(() => { st = null; setAddress(false); });
  }
  async function onClick(e) {
    const b = e.target.closest('[data-xsu]'); if (!b || !st) return;
    const a = b.dataset.xsu, arg = b.dataset.arg;
    if (a !== 'pick') readEdits();
    if (a === 'docs') return toDocs();
    if (a === 'pick') { if (b.checked) st.picked.add(arg); else st.picked.delete(arg); return; }
    if (a === 'propose') {
      const idea = (st.idea || '').trim();
      if (!idea && !st.picked.size) { X()?.toast?.('Write your idea or pick a file first'); return; }
      st.step = 'building'; paint();
      const r = await api('POST', `/api/v2/workspaces/${st.ws.id}/architect/proposals`, { idea, sources: [...st.picked].map((id) => ({ kind: 'file', id })) });
      if (!r.ok) { st.step = 'docs'; paint(); X()?.toast?.(r.status === 402 ? 'Not enough credits for this' : (r.d.message || 'It could not be drafted — try again')); return; }
      st.proposal = r.d.proposal; st.step = 'proposal'; return paint();
    }
    if (a === 'task-del') { st.proposal.pack.tasks.splice(Number(arg), 1); return paint(); }
    if (a === 'task-add') { st.proposal.pack.tasks.push({ title: 'New task', body: '' }); return paint(); }
    if (a === 'use') {
      const pk = st.proposal.pack;
      const e = await api('PATCH', `/api/v2/workspaces/${st.ws.id}/architect/proposals/${st.proposal.proposalId}`, { ...(pk.extends ? {} : { mode: { name: pk.mode.name } }), tasks: pk.tasks });
      if (!e.ok) { X()?.toast?.(e.d.message || 'That change could not be kept'); return; }
      st.proposal = e.d.proposal; st.pack = { id: st.proposal.packId, title: st.proposal.proposal.title, mode: st.proposal.pack.mode }; st.answers = {};
      const r = await api('POST', `/api/v2/workspaces/${st.ws.id}/modes/plan`, { packId: st.pack.id, answers: {} });
      if (!r.ok) { X()?.toast?.(r.d.message || 'It could not be planned'); return; }
      st.plan = r.d.plan; st.planHash = r.d.planHash; st.key = (crypto.randomUUID?.() || String(Date.now())) + '-setup'; st.step = 'plan'; return paint();
    }
    if (a === 'custom') { st.sheet.close('custom'); setTimeout(() => window.XA?.customMode?.(), 0); return; }
    if (a === 'trade') { st.pack = st.packs.find((p) => p.id === arg); st.step = 'name'; return paint(); }
    if (a === 'back') { st.step = { plan: st.proposal ? 'proposal' : 'name', proposal: 'docs' }[st.step] || 'trade'; return paint(); }
    if (a === 'next') {
      st.sh.querySelectorAll('[data-q]').forEach((i) => { st.answers[i.dataset.q] = i.value.trim(); });
      const r = await api('POST', `/api/v2/workspaces/${st.ws.id}/modes/plan`, { packId: st.pack.id, answers: st.answers });
      if (!r.ok) { X()?.toast?.(r.d.message || 'Fill in the name first'); return; }
      st.plan = r.d.plan; st.planHash = r.d.planHash; st.key = (crypto.randomUUID?.() || String(Date.now())) + '-setup'; st.step = 'plan'; return paint();
    }
    if (a === 'apply') {
      b.disabled = true;
      const r = await api('POST', `/api/v2/workspaces/${st.ws.id}/modes/apply`, { packId: st.pack.id, answers: st.answers, planHash: st.planHash, idempotencyKey: st.key, confirm: true });
      if (!r.ok) { b.disabled = false; X()?.toast?.(r.d.message || 'It could not be set up — try again'); return; }
      const mode = r.d.receipt.records.find((x) => x.type === 'mode') || st.pack.mode, n = r.d.receipt.records.filter((x) => x.type === 'task').length;
      await window.XENO_CUSTOM.hydrate();
      st.sheet.close('done');
      X()?.go?.('mode', { mode: mode.id });
      X()?.toast?.(`Your workspace is ready — ${n} first task${n === 1 ? ' is' : 's are'} waiting`);
      return;
    }
    if (a === 'undo') {
      const r = await api('POST', `/api/v2/workspaces/${st.ws.id}/modes/${arg}/revert`);
      if (!r.ok) { X()?.toast?.('It could not be undone — try again'); return; }
      const kept = r.d.receipt.revertReport?.kept?.length || 0;
      await window.XENO_CUSTOM.hydrate(); await loadApplied(); paint();
      X()?.toast?.(kept ? `Undone. ${kept} thing${kept === 1 ? '' : 's'} you changed ${kept === 1 ? 'was' : 'were'} kept.` : 'Undone');
    }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-xsu]'); if (b && b.dataset.xsu === 'open') { e.preventDefault(); open(); } if (b && b.dataset.xsu === 'open-docs') { e.preventDefault(); open({ docs: true, idea: b.dataset.idea || '' }); } });
  const css = document.createElement('style');
  css.textContent = '.xsu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.xsu-trade{display:grid;gap:4px;text-align:left;padding:12px;border-radius:10px;border:1px solid var(--line,#2a2a2a);background:var(--s2,#151515);color:inherit;font:inherit;cursor:pointer}.xsu-trade small{opacity:.7}.xsu-pic{font-size:22px}.xsu-h{margin:0 0 10px;font-size:16px}.xsu-h4{margin:14px 0 6px;font-size:13px;opacity:.8}.xsu-p{opacity:.8;margin:6px 0}.xsu-f{display:grid;gap:4px;margin:8px 0}.xsu-f input{padding:8px;border-radius:8px;border:1px solid var(--line,#2a2a2a);background:var(--s1,#101010);color:inherit;font:inherit;outline:none}.xsu-rooms{display:flex;flex-wrap:wrap;gap:6px}.xsu-room{padding:6px 10px;border-radius:8px;background:var(--s2,#151515)}.xsu-act{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.xsu-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0}.xsu-err{color:#e8e8e8}.xsu-f textarea{padding:8px;border-radius:8px;border:1px solid var(--line,#2a2a2a);background:var(--s1,#101010);color:inherit;font:inherit;outline:none;resize:vertical}.xsu-files{display:grid;gap:4px;max-height:180px;overflow:auto}.xsu-why{display:block;opacity:.6;margin-top:2px}.xsu-cite{padding:1px 6px;border-radius:6px;background:var(--s2,#151515)}.xsu-tasks input{background:transparent;border:0;color:inherit;font:inherit;outline:none;width:80%}';
  document.head.appendChild(css);
  window.XSETUP = { open };
  if (P && P.served && new URLSearchParams(location.search).get('setup') === 'business') P.ready.then((u) => { if (u) setTimeout(open, 0); });
})();
