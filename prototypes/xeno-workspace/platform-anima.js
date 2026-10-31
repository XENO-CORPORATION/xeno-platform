/* platform-anima.js — Anima on the real platform. A Mind is given; a Soul is earned.
 *
 *   Anima   /workspace/anima        the agents you made, each with its authored Mind, opening at its own page
 *
 * Replaces anima.js's sample Minds when served. What the platform holds is the Mind: an agent's persona, rules and skills, in
 * mind.xeno form on its Identity tab. A Soul is earned where Anima runs, on the person's own computer, and stays there. Hosting
 * one is XENO ANIMA CLOUD - SPEC.md, a draft, so this page doesn't claim a memory, schedule or channel it doesn't have.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paint = () => { try { X()?.render?.(); } catch {} };
  const INSTALL = 'npm install -g @xenosystem/anima';
  const AGENT = /^agt_[a-z0-9]+$/i;
  const nav = (rows) => { window.XENO_GLOBAL_NAV.anima = ['Anima', 'Your agents', null, rows.length ? [['Agents', rows.map((a) => [a.name, '', null, a.id])]] : []]; };
  nav([]);
  if (window.XENO_PG_ANIMA) window.XENO_PG_ANIMA.minds = [];
  const S = { status: 'idle', list: [], scope: null };
  const wsQ = () => { const u = window.XENO_SCOPE?.uuid?.(); return u ? `?workspace=${encodeURIComponent(u)}` : ''; };
  async function load() {
    const q = wsQ(); S.scope = q; S.status = 'loading';
    const r = await api('GET', '/api/agents' + q).catch(() => null);
    if (S.scope !== q) return;
    S.status = r && r.ok ? 'ready' : 'error'; S.list = r && r.ok ? (r.d.agents || []) : [];
    nav(S.list); try { X()?.render?.(); } catch { paint(); }
  }
  function page() {
    const h = H();
    if (S.status === 'idle' || S.scope !== wsQ()) { setTimeout(load, 0); S.status = 'loading'; S.scope = wsQ(); }
    const head = h.head({ title: 'Anima', sub: 'Agents you make and keep. A Mind is given. A Soul is earned.', acts: h.btn('New agent', 'data-xan="agents"', true, 'plus') });
    const body = S.status === 'loading' ? h.box('refresh', 'Loading your agents', '', '', 'sm')
      : S.status === 'error' ? h.box('x', 'Your agents couldn’t be loaded', 'Nothing was changed.', h.btn('Try again', 'data-xan="retry"', true), 'sm')
        : !S.list.length ? h.box('bot', 'No agents yet', 'Give one a name and a purpose: that’s its Mind. It keeps its identity everywhere it runs.', h.btn('Create your first agent', 'data-xan="agents"', false, 'plus'))
          : h.table(['Agent', 'What it is for', ''], S.list.map((a) => h.tr(`data-xan="open" data-id="${esc(a.id)}"`, [`<b class="pg-name">${esc(a.name)}</b>`, `<small>${esc(a.description || 'No purpose written yet')}</small>`, '<small>Mind and skills</small>'])));
    return h.page(head + `<div class="pg-cols" data-xan-page><div>${body}</div><aside>
      <section class="pg-sec pg-card-s"><h3>Its Mind</h3><p class="pg-dim">Who it is: its purpose, rules and voice. Each agent’s Identity tab edits it, and imports or exports it as a mind.xeno file.</p></section>
      <section class="pg-sec pg-card-s"><h3>Its Soul</h3><p class="pg-dim">What it learns as it works. Today a Soul stays on the computer where Anima runs. Nothing it learned there reaches XENO.</p>
        <p><code>${esc(INSTALL)}</code></p>${h.btn('Copy', 'data-xan="copy"', true, 'copy')}</section>
      <section class="pg-sec pg-card-s"><h3>Find one</h3><p class="pg-dim">Other people’s Minds, to buy or rent, are in the Marketplace.</p>${h.btn('Open the Marketplace', 'data-xan="market"', true)}</section></aside></div>`);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xan]'); if (!b || !b.closest('#main')) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.xan;
    if (a === 'retry') { S.status = 'idle'; return paint(); }
    if (a === 'open') return X().go('global', { global: 'workspace', item: `Agents/${b.dataset.id}/Identity` });
    if (a === 'agents') return X().go('global', { global: 'workspace', item: 'Agents' });
    if (a === 'market') return X().go('global', { global: 'market', item: null });
    if (a === 'copy') navigator.clipboard?.writeText(INSTALL).then(() => X()?.toast?.('Copied'), () => X()?.toast?.(INSTALL));
  }, true);
  // a sidebar row is an agent's id: its Mind is on its own page
  const route = (item) => { if (item && AGENT.test(item)) setTimeout(() => X().go('global', { global: 'workspace', item: `Agents/${item}/Identity` }), 0); return page(); };
  window.XENO_ANIMA = { served: true, route, minds: () => [] };
})();
