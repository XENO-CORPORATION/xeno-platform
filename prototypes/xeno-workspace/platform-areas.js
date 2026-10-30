/**
 * Areas whose work already lives on the platform, shown as that work instead of the picture's sample rows:
 *
 *   Corpo > People      GET /api/people?workspace=      opens the person at Workspace > Directory/<id>
 *   Dev > Agents        GET /api/agents?workspace=      opens the agent at Workspace > Agents/<id>
 *   Studio > Generate   GET /api/generations            opens the generation at its own address
 *
 * Each registers XENO_ZONE_LIVE['<mode>.<zone>'], which is what tells the workspace the area is no longer a sample.
 * No second list: these read what the Directory, the Agents page and Generate read, and send you there to act.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api, H = () => window.XENO_PAGES.h;
  const wsQ = () => { const u = window.XENO_SCOPE?.served && window.XENO_SCOPE.uuid?.(); return u ? `?workspace=${encodeURIComponent(u)}` : ''; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone') X()?.render?.(); } catch {} };
  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};

  /**
   * One area: load its rows once a scope is known, again when the workspace changes, and draw them as a page.
   * spec: { key, noun, title, sub, cols, url, read(data) -> rows, cells(row) -> [..], attrs(row) -> string, emptyIcon,
   *         empty: [title, body], actions() -> html, work(row) -> sidebar row }
   */
  function area(spec) {
    const S = { status: 'idle', rows: [], scope: null };
    async function load() {
      const scope = wsQ();
      S.status = 'loading'; S.scope = scope;
      const r = await api('GET', spec.url(scope));
      if (S.scope !== scope) return;
      if (r.ok) { S.rows = spec.read(r.d) || []; S.status = 'ready'; }
      else { S.rows = []; S.status = r.status === 403 ? 'denied' : 'error'; }
      paint();
    }
    const page = () => {
      const h = H(), acts = spec.actions ? spec.actions() : '';
      if (S.status === 'ready' && S.scope !== wsQ()) load();
      const body = S.status === 'error' ? h.box('alert', `${spec.title} could not be loaded just now`, 'Nothing changed. Try again.', h.btn('Try again', `data-xarea-retry="${spec.key}"`))
        : S.status === 'denied' ? h.box('lock', `You don’t have access to ${spec.noun} here`, 'Ask an owner of this workspace.')
          : S.status !== 'ready' ? h.box('refresh', `Loading ${spec.noun}`, '', '', 'sm')
            : !S.rows.length ? h.box(spec.emptyIcon, spec.empty[0], spec.empty[1], acts)
              : h.table(spec.cols, S.rows.map((r) => h.tr(spec.attrs(r), spec.cells(r))));
      return h.page(h.head({ title: spec.title, sub: spec.sub, acts }) + `<div class="wrap pj hm" data-xarea="${spec.key}" data-xarea-state="${S.status}">${body}</div>`);
    };
    const live = window.XENO_ZONE_LIVE[spec.key] = {
      served: true,
      work: () => (S.status === 'ready' ? [spec.title, S.rows.slice(0, 6).map(spec.work)] : null),
      badge: () => null,
      page,
      state: () => ({ status: S.status, rows: S.rows.length }),
      reload: () => load(),
    };
    P.lazyZone(live, () => load());
    return load;
  }

  const esc = (s) => H().esc(s);
  const loaders = {
    'corpo.people': area({
      key: 'corpo.people', noun: 'people', title: 'People', sub: 'The humans and agents in this workspace.',
      cols: ['Name', 'Title', 'Kind'], emptyIcon: 'users',
      empty: ['Nobody listed yet', 'People appear here once they join this workspace.'],
      url: (q) => `/api/people${q}`, read: (d) => d.people,
      cells: (p) => [`<b class="pg-name">${esc(p.name)}</b>`, esc(p.title || ''), p.kind === 'agent' ? 'Agent' : 'Person'],
      attrs: (p) => `data-xarea-to="Directory/${esc(p.id)}"`,
      actions: () => H().btn('Directory', 'data-xarea-to="Directory"', true) + (window.XENO_PAY?.served ? H().btn('Pay', 'data-xarea-to="Directory/pay"', true) : ''),
      work: (p) => [p.name, p.kind === 'agent' ? 'Agent' : (p.title || 'Person')],
    }),
    'dev.agents': area({
      key: 'dev.agents', noun: 'agents', title: 'Agents', sub: 'The agents in this workspace, and what each is doing.',
      cols: ['Agent', 'Status'], emptyIcon: 'bot',
      empty: ['No agents yet', 'Create one under Workspace › Agents.'],
      url: (q) => `/api/agents${q}`, read: (d) => d.agents,
      cells: (a) => [`<b class="pg-name">${esc(a.name)}</b>`, esc(a.status || '')],
      attrs: (a) => `data-xarea-to="Agents/${esc(a.id)}"`,
      actions: () => H().btn('All agents', 'data-xarea-to="Agents"', true),
      work: (a) => [a.name, a.status || 'Agent'],
    }),
    'studio.generate': area({
      key: 'studio.generate', noun: 'generations', title: 'Generate', sub: 'What you made with images, video, audio and 3D.',
      cols: ['Prompt', 'Type', 'Status'], emptyIcon: 'spark',
      empty: ['Nothing generated yet', 'Open Image, Video, Audio or 3D in this area’s sidebar to start.'],
      url: () => '/api/generations', read: (d) => d.generations,
      cells: (g) => [`<b class="pg-name">${esc(promptOf(g))}</b>`, esc(H().cap(g.type || g.request?.type || '')), esc(H().cap(g.status || ''))],
      attrs: (g) => `data-xarea-href="${esc(window.XENO_GENERATIONS?.pathFor?.(g.type || g.request?.type, g.id) || '')}"`,
      work: (g) => [promptOf(g), H().cap(g.status || '')],
    }),
  };
  function promptOf(g) { const t = String(g.request?.prompt || g.prompt || '').trim(); return t.length > 80 ? t.slice(0, 79) + '…' : t || 'Untitled'; }

  document.addEventListener('click', (e) => {
    const retry = e.target.closest?.('[data-xarea-retry]');
    if (retry) { loaders[retry.getAttribute('data-xarea-retry')]?.(); return; }
    const to = e.target.closest?.('[data-xarea-to]');
    if (to) { X()?.go?.('global', { global: 'workspace', item: to.getAttribute('data-xarea-to') }); return; }
    const href = e.target.closest?.('[data-xarea-href]')?.getAttribute('data-xarea-href');
    if (href) window.location.assign(href);
  });
})();
