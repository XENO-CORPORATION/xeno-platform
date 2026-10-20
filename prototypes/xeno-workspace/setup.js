/* Business setup (MODES SPEC §8c.4): "a setup for your business" for someone who has never used AI. No "AI", "agent",
 * "model" or "prompt" on these screens. What do you do? → your business name → here is your workspace → Set it up.
 *
 * The server does the work (services/modeApply.js): plan writes nothing and returns a hash; apply takes that hash, an
 * idempotency key and the admin's confirmation, and creates everything in one transaction; Undo archives what nobody
 * has touched since. Address: ?setup=business on any workspace page opens it (and a reload reopens it).
 * Controls: [data-xsu] — open, custom, trade, next, back, apply, undo.
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
        <button type="button" class="xsu-trade" role="listitem" data-xsu="custom"><span class="xsu-pic" aria-hidden="true">＋</span><b>Something else</b><small>Pick the products yourself.</small></button></div>`
        + (done.length ? `<h4 class="xsu-h4">Already set up</h4>${done.map((a) => `<div class="xsu-row"><span>${esc(a.packId)} · ${esc(new Date(a.appliedAt).toLocaleDateString())}</span><button type="button" class="xd-btn ghost" data-xsu="undo" data-arg="${esc(a.applicationId)}">Undo</button></div>`).join('')}` : '');
    }
    if (st.step === 'name') return `<h3 class="xsu-h">${esc(st.pack.title)}</h3>${st.pack.questions.map((q) => `<label class="xsu-f"><span>${esc(q.label)}</span><input data-q="${esc(q.id)}" maxlength="${q.max || 60}" value="${esc(st.answers[q.id] || '')}" ${q.required ? 'required' : ''}></label>`).join('')}
      <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="next">Next</button></div>`;
    if (st.step === 'plan') {
      const pl = st.plan, mode = pl.records.find((r) => r.type === 'mode'), tasks = pl.records.filter((r) => r.type === 'task');
      const PR = X()?.PR || {};
      return `<h3 class="xsu-h">Here is your workspace</h3><p class="xsu-p">${esc(st.answers.businessName || '')} · in ${esc(pl.workspaceName)}</p>
        <div class="xsu-rooms" aria-label="What you get">${mode.products.map((p) => `<span class="xsu-room">${esc(PR[p]?.name || p)}</span>`).join('')}</div>
        <h4 class="xsu-h4">Waiting for you first</h4><ul class="xsu-tasks">${tasks.map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul>
        <p class="xsu-p">Nothing is charged for this setup. You can undo it later; anything you change is kept.</p>
        ${pl.conflicts.length ? '<p class="xsu-err" role="alert">This setup is already in your workspace.</p>' : ''}
        <div class="xsu-act"><button type="button" class="xd-btn ghost" data-xsu="back">Back</button><button type="button" class="xd-btn" data-xsu="apply" ${pl.conflicts.length ? 'disabled' : ''}>Set it up</button></div>`;
    }
    return '<p class="xsu-p">Setting it up…</p>';
  }
  const paint = () => { if (st?.sh) st.sh.querySelector('.xsu').innerHTML = view(); };

  async function loadApplied() { const r = await api('GET', `/api/v2/workspaces/${st.ws.id}/modes/applications`); st.applied = r.ok ? r.d.applications : []; }
  async function open() {
    if (st) return;
    if (!window.XENO_CUSTOM?.server) await window.XENO_CUSTOM?.hydrate?.();
    const ws = where();
    st = { step: 'trade', answers: {}, packs: [], ws, error: ws ? null : 'Only someone who runs a workspace can set it up.' };
    setAddress(true);
    D().info({ title: 'A setup for your business', sub: ws ? ws.name : '', size: 'md', html: '<div class="xsu" data-xsu-root></div>',
      onOpen: async (sh, sheet) => { st.sh = sh; st.sheet = sheet; paint();
        sh.addEventListener('click', onClick);
        if (!ws) return;
        const r = await api('GET', `/api/v2/workspaces/${ws.id}/modes/packs`); st.packs = r.ok ? r.d.packs : []; await loadApplied(); paint(); } })
      .then(() => { st = null; setAddress(false); });
  }
  async function onClick(e) {
    const b = e.target.closest('[data-xsu]'); if (!b || !st) return;
    const a = b.dataset.xsu, arg = b.dataset.arg;
    if (a === 'custom') { st.sheet.close('custom'); setTimeout(() => window.XA?.customMode?.(), 0); return; }
    if (a === 'trade') { st.pack = st.packs.find((p) => p.id === arg); st.step = 'name'; return paint(); }
    if (a === 'back') { st.step = st.step === 'plan' ? 'name' : 'trade'; return paint(); }
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
      const mode = r.d.receipt.records.find((x) => x.type === 'mode'), n = r.d.receipt.records.filter((x) => x.type === 'task').length;
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
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-xsu]'); if (b && b.dataset.xsu === 'open') { e.preventDefault(); open(); } });
  const css = document.createElement('style');
  css.textContent = '.xsu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.xsu-trade{display:grid;gap:4px;text-align:left;padding:12px;border-radius:10px;border:1px solid var(--line,#2a2a2a);background:var(--s2,#151515);color:inherit;font:inherit;cursor:pointer}.xsu-trade small{opacity:.7}.xsu-pic{font-size:22px}.xsu-h{margin:0 0 10px;font-size:16px}.xsu-h4{margin:14px 0 6px;font-size:13px;opacity:.8}.xsu-p{opacity:.8;margin:6px 0}.xsu-f{display:grid;gap:4px;margin:8px 0}.xsu-f input{padding:8px;border-radius:8px;border:1px solid var(--line,#2a2a2a);background:var(--s1,#101010);color:inherit;font:inherit;outline:none}.xsu-rooms{display:flex;flex-wrap:wrap;gap:6px}.xsu-room{padding:6px 10px;border-radius:8px;background:var(--s2,#151515)}.xsu-act{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.xsu-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0}.xsu-err{color:#e8e8e8}';
  document.head.appendChild(css);
  window.XSETUP = { open };
  if (P && P.served && new URLSearchParams(location.search).get('setup') === 'business') P.ready.then((u) => { if (u) setTimeout(open, 0); });
})();
