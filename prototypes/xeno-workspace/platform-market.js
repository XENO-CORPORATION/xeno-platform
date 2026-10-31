/**
 * The Marketplace, from the platform (routes/marketplaceRoutes.js). The picture sold sample listings, kept purchases, reviews
 * and a seller's earnings in this browser and "charged" nothing. Here every part is the real store:
 *
 *   the store      /workspace/market[/<Tools|Minds|…>]      GET /catalog
 *   a listing      /workspace/market/l/<slug>               GET /listings/:slug · POST …/purchase|subscribe|rent · …/reviews
 *   what you have  /workspace/market/Purchases              GET /me/entitlements
 *   rentals        /workspace/market/Rentals                GET /rental-bindings · /rental-partitions, export and delete your memory
 *   selling        /workspace/market/Seller console         GET /developer/me|listings|earnings · POST /developer/register|payouts · …/submit
 *
 * Paying spends credits, so it is always a person's yes on a dialog that names the price. The server decides who may buy and
 * what it costs: nothing about a price or a right is worked out here.
 */
(() => {
  const PF = window.XENO_PLATFORM;
  if (!PF || !PF.served) return;
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = PF.api, esc = (s) => H().esc(s), ic = (k) => X().ic(k);
  if (Array.isArray(window.XENO_PG_MARKET)) window.XENO_PG_MARKET.length = 0;
  const BASE = '/api/marketplace', toast = (m) => X()?.toast?.(m);
  const wsId = () => (window.XENO_SCOPE?.served && window.XENO_SCOPE.uuid?.()) || null;
  const said = (r, fallback) => (r && r.d && (r.d.message || (typeof r.d.error === 'string' ? r.d.error : ''))) || fallback;
  const TRUST = { official: ['Official', 'Built and signed by XENO.'], verified: ['Verified', 'Seller identity checked, with a full security review.'], community: ['Community · sandboxed', 'Runs in a sandbox, with only the rights you give it.'] };
  const GROUPS = { apps: new Set(['app-native', 'app-sandboxed', 'tool', 'panel', 'block', 'plugin', 'mcp', 'blueprint', 'skill', 'mode']), agents: new Set(['mind', 'swarm', 'team', 'model']) };
  const VIEWS = { 'All apps': ['apps'], Tools: ['apps', ['tool', 'app-native', 'app-sandboxed']], Blocks: ['apps', ['block', 'panel']], 'Plugins & MCP': ['apps', ['plugin', 'mcp']], Blueprints: ['apps', ['blueprint']], 'All agents': ['agents'], Minds: ['agents', ['mind']], Teams: ['agents', ['team', 'swarm']], Models: ['agents', ['model']] };
  const S = { store: { status: 'idle', list: [], q: '' }, listing: new Map(), mine: { status: 'idle', list: [] }, rent: { status: 'idle', bindings: [], partitions: [] }, seller: { status: 'idle' } };
  const paint = () => { try { const s = X()?.S; if (s?.view === 'global' && s.global === 'market') X().render(); } catch {} };
  const go = (item) => X().go('global', { global: 'market', item });

  const priceOf = (p) => (!p || p.model === 'free' || !p.priceCredits ? 'Free' : p.model === 'subscription' ? `${p.priceCredits} credits / ${p.period || 'month'}` : p.model === 'rental' ? `${p.priceCredits} credits${p.meterUnit ? ' / ' + p.meterUnit : ' to rent'}` : `${p.priceCredits} credits`);
  const priceLine = (l) => { const p = l.pricing || []; return p.length ? p.map(priceOf).join(' · ') : 'Free'; };
  const day = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  const stars = (n) => `<span class="mk-stars" aria-label="${n} of 5">${'★'.repeat(Math.round(n))}<i>${'★'.repeat(5 - Math.round(n))}</i></span>`;
  const glyph = (l) => (GROUPS.agents.has(l.kind) ? (l.kind === 'model' ? 'box' : 'bot') : l.kind === 'blueprint' ? 'layers' : 'grid');

  async function loadStore() {
    const T = S.store; T.status = 'loading'; const q = T.q;
    const r = await api('GET', `${BASE}/catalog?limit=100${q ? '&q=' + encodeURIComponent(q) : ''}`).catch(() => null);
    if (T.q !== q) return;
    if (r && r.ok) { T.list = r.d.listings || []; T.status = 'ready'; } else T.status = 'error';
    paint();
  }
  async function loadListing(slug) {
    S.listing.set(slug, { status: 'loading' });
    const r = await api('GET', `${BASE}/listings/${encodeURIComponent(slug)}`).catch(() => null);
    S.listing.set(slug, r && r.ok ? { status: 'ready', ...r.d } : { status: r && r.status === 404 ? 'gone' : 'error' });
    paint();
  }
  async function loadMine() {
    S.mine.status = 'loading';
    const r = await api('GET', `${BASE}/me/entitlements`).catch(() => null);
    if (r && r.ok) { S.mine.list = r.d.entitlements || []; S.mine.status = 'ready'; } else S.mine.status = 'error';
    paint();
  }
  async function loadRent() {
    S.rent.status = 'loading';
    const [b, p] = await Promise.all([api('GET', `${BASE}/rental-bindings`).catch(() => null), api('GET', `${BASE}/rental-partitions`).catch(() => null)]);
    if (b && b.ok && p && p.ok) { S.rent.bindings = b.d.bindings || []; S.rent.partitions = p.d.partitions || []; S.rent.status = 'ready'; } else S.rent.status = 'error';
    paint();
  }
  const TEAM_REFUSAL = { team_archived: 'That team is archived.', not_the_team_owner_manager: 'Only someone who manages this workspace can publish its teams.', team_not_found: 'That team is gone.' };
  async function loadSeller() {
    S.seller = { status: 'loading' };
    const me = await api('GET', `${BASE}/developer/me`).catch(() => null);
    if (me && me.status === 404) { S.seller = { status: 'none' }; return paint(); }
    if (!me || !me.ok) { S.seller = { status: 'error' }; return paint(); }
    const [l, e] = await Promise.all([api('GET', `${BASE}/developer/listings`).catch(() => null), api('GET', `${BASE}/developer/earnings`).catch(() => null)]);
    S.seller = l && l.ok && e && e.ok ? { status: 'ready', dev: me.d.developer, listings: l.d.listings || [], earnings: e.d.earnings, recent: e.d.recentTransactions || [] } : { status: 'error' };
    paint();
  }

  const h = () => H();
  const retry = (what, act) => h().box('alert', `${what} could not be loaded just now`, 'Nothing changed. Try again.', h().btn('Try again', `data-xmk="retry" data-id="${act}"`));
  const kindName = (k) => (k === 'mcp' ? 'MCP' : h().cap(String(k).replace(/-/g, ' ')));
  const card = (l) => `<div class="pg-card pg-card--lst" tabindex="0" data-xmk="open" data-id="${esc(l.slug)}"><div class="pg-card-top"><span class="pg-thumb pg-thumb--ic sq">${ic(glyph(l))}</span><span class="pg-tag">${esc(kindName(l.kind))}</span></div><b><a>${esc(l.title)}</a></b><small class="pg-clamp">${esc(l.summary || '')}</small><div class="pg-card-foot"><span>${esc(l.developerName || (l.isFirstParty ? 'XENO' : 'Seller'))} · ${esc((TRUST[l.trustTier] || TRUST.community)[0])}</span><b class="pg-price">${esc(priceLine(l))}</b></div></div>`;

  function store(view) {
    const T = S.store; if (T.status === 'idle') loadStore();
    const v = VIEWS[view] || ['all'], rows = T.list.filter((l) => (v[0] === 'all' || GROUPS[v[0]].has(l.kind)) && (!v[1] || v[1].includes(l.kind)));
    // the real tools (platform-tools.js): each opens where it runs, nothing to buy
    window.XENO_TOOLS_ENSURE?.();
    const toolRows = (v[0] === 'agents' || (v[1] && !v[1].includes('tool'))) ? [] : (window.XENO_PG_MARKET || []).filter((x) => x.toolId && (!T.q || (x.name + ' ' + x.blurb).toLowerCase().includes(T.q.toLowerCase())));
    const toolCard = (x) => `<div class="pg-card pg-card--lst" tabindex="0" data-xmk="tool" data-id="${esc(x.toolId)}"><div class="pg-card-top"><span class="pg-thumb pg-thumb--ic sq">${ic('grid')}</span><span class="pg-tag">Tool</span></div><b><a>${esc(x.name)}</a></b><small class="pg-clamp">${esc(x.blurb)}</small><div class="pg-card-foot"><span>XENO · Official</span><b class="pg-price">Free</b></div></div>`;
    const search = `<label class="pg-search">${ic('search')}<input data-xmk-q value="${esc(T.q)}" placeholder="Search the store" aria-label="Search the store" spellcheck="false"></label>`;
    const body = T.status === 'error' ? retry('The store', 'store') : T.status !== 'ready' ? h().box('market', 'Opening the store', '')
      : rows.length || toolRows.length ? `<div class="pg-grid pg-grid--market">${toolRows.map(toolCard).join('')}${rows.map(card).join('')}</div>` : h().box('market', T.q ? 'Nothing matches that' : 'Nothing is listed here yet', T.q ? 'Try other words.' : 'Listings appear here once they pass review.');
    return h().page(h().head({ eyebrow: 'Marketplace', title: VIEWS[view] ? view : 'Marketplace' }) + `<div class="pg-bar">${search}</div><div class="pg-body">${body}</div>`);
  }

  function nextStep(l, ent, x) {
    if (!ent) return '';
    if (l.kind === 'skill') return h().btn('Open in Skills', 'data-xmk="skills"', true, 'open');
    if (ent.type === 'rental') return h().btn('Open rentals', 'data-xmk="go" data-id="Rentals"', true, 'open');
    if (l.kind === 'team' && x.versions?.length) return h().btn('Bring it into this workspace', `data-xmk="import" data-id="${esc(l.slug)}"`, false, 'plus');
    return '<span class="pg-dim">Installed from XENO Hub on your computer.</span>';
  }
  function listingPage(slug) {
    const x = S.listing.get(slug); if (!x) { loadListing(slug); return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'Opening', '')); }
    if (x.status === 'loading') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'Opening', ''));
    if (x.status === 'gone') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'This listing is not here', 'It was removed, or it is not published.', h().btn('Back to the store', 'data-xmk="go" data-id=""')));
    if (x.status === 'error') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + retry('This listing', 'listing:' + slug));
    const l = x.listing, ent = x.entitlement, t = TRUST[l.trustTier] || TRUST.community, R = x.reviews || [];
    const buy = ent ? `<span class="pg-chip">You have this${ent.expiresAt ? ' until ' + esc(day(ent.expiresAt)) : ''}</span>` : (l.pricing || []).length ? l.pricing.map((p, i) => h().btn(p.model === 'free' || !p.priceCredits ? 'Get' : p.model === 'subscription' ? `Subscribe · ${priceOf(p)}` : p.model === 'rental' ? `Rent · ${priceOf(p)}` : `Buy · ${priceOf(p)}`, `data-xmk="buy" data-id="${esc(slug)}" data-i="${i}"`, false, 'plus')).join(' ') : h().btn('Get', `data-xmk="buy" data-id="${esc(slug)}" data-i="-1"`, false, 'plus');
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: l.title, acts: buy })
      + `<div class="mk-hero"><span class="pg-thumb pg-thumb--ic sq mk-big">${ic(glyph(l))}</span><div class="mk-hero-m"><h2 class="mk-title">${esc(l.title)}</h2>${l.summary ? `<p class="mk-p">${esc(l.summary)}</p>` : ''}<div class="mk-row"><b>${esc(l.developerName || (l.isFirstParty ? 'XENO' : 'Seller'))}</b>${h().chip(t[0])}<span class="pg-dim">${esc(kindName(l.kind))}</span></div>
        <div class="mk-row">${R.length ? `${stars(l.ratingAvg)} <span class="pg-dim">${Number(l.ratingAvg).toFixed(1)} · ${l.ratingCount} review${l.ratingCount === 1 ? '' : 's'}</span>` : '<span class="pg-dim">No reviews yet</span>'}</div></div><div class="mk-buy"><b class="mk-price">${esc(priceLine(l))}</b>${nextStep(l, ent, x)}</div></div>
      <div class="mk-cols"><div>
        <section class="pg-sec"><h3>About</h3><p class="mk-p">${esc(x.description || l.summary || 'No description.')}</p></section>
        <section class="pg-sec"><h3>Reviews</h3>${R.length ? `<ul class="mk-revs">${R.map((r) => `<li><div class="mk-row"><b>${esc(r.author || 'Someone')}</b>${stars(r.rating)}<span class="pg-dim">${esc(day(r.createdAt))}</span></div>${r.title ? `<b>${esc(r.title)}</b>` : ''}<p class="mk-p">${esc(r.text || '')}</p></li>`).join('')}</ul>` : '<p class="pg-dim">Nobody has reviewed this yet.</p>'}
          ${ent ? h().btn('Write a review', `data-xmk="review" data-id="${esc(slug)}"`, true, 'edit') : '<p class="pg-dim wf-note">Only people who have it can review it.</p>'}</section>
      </div><aside class="mk-side">
        <section class="pg-sec"><h3>Trust</h3><p class="mk-p"><b>${esc(t[0])}.</b> ${esc(t[1])}</p></section>
        ${l.currentVersion || l.license || l.publishedAt ? `<section class="pg-sec"><h3>Details</h3><dl class="mk-dl">${l.currentVersion ? `<dt>Version</dt><dd>${esc(l.currentVersion)}</dd>` : ''}${l.license ? `<dt>Licence</dt><dd>${esc(l.license)}</dd>` : ''}${l.publishedAt ? `<dt>Listed</dt><dd>${esc(day(l.publishedAt))}</dd>` : ''}</dl></section>` : ''}
        ${(x.versions || []).length ? `<section class="pg-sec"><h3>Versions</h3><ul class="mk-vers">${x.versions.map((v) => `<li><b>${esc(v.version)}</b><span>${esc(v.releaseNotes || '')}</span></li>`).join('')}</ul></section>` : ''}
        ${h().btn('Report this listing', 'data-xmk="report"', true, 'flag')}
      </aside></div>`);
  }
  function purchases() {
    const M = S.mine; if (M.status === 'idle') loadMine();
    const rows = M.list.filter((e) => e.entitlementType !== 'rental');
    const body = M.status === 'error' ? retry('What you have', 'mine') : M.status !== 'ready' ? h().box('market', 'Opening', '') : rows.length
      ? `<ul class="mk-rcl">${rows.map((e) => `<li><button class="pg-link" data-xmk="open" data-id="${esc(e.slug)}">${esc(e.title)}</button><span>${esc(h().cap(e.entitlementType))}</span><span class="pg-dim">Since ${esc(day(e.grantedAt))}${e.expiresAt ? ' · until ' + esc(day(e.expiresAt)) : ''}</span></li>`).join('')}</ul>`
      : h().box('market', 'Nothing here yet', 'What you get from the store shows up here.', h().btn('Browse the store', 'data-xmk="go" data-id=""'));
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Purchases' }) + `<div class="pg-body">${body}</div>`);
  }
  function rentalsPage() {
    const R = S.rent; if (R.status === 'idle') loadRent();
    const body = R.status === 'error' ? retry('Your rentals', 'rent') : R.status !== 'ready' ? h().box('market', 'Opening', '') : !R.bindings.length && !R.partitions.length
      ? h().box('market', 'No rentals yet', 'Agents you rent show up here, with what they remember for you.', h().btn('Browse the store', 'data-xmk="go" data-id="All agents"'))
      : `${R.bindings.length ? `<section class="pg-sec"><h3>Rented agents</h3><ul class="mk-rcl">${R.bindings.map((b) => `<li><b>${esc(b.title || 'Agent')}</b><span>${esc(h().cap(b.state || ''))}</span>${(b.state || 'active') === 'active' ? h().btn('End', `data-xmk="endrent" data-id="${esc(b.id)}"`, true) : ''}</li>`).join('')}</ul></section>` : ''}
        ${R.partitions.length ? `<section class="pg-sec"><h3>What they remember for you</h3><p class="pg-dim">This memory is yours. Its seller can’t read it.</p><ul class="mk-rcl">${R.partitions.map((p) => `<li><b>${p.target.kind === 'workspace' ? 'For a workspace' : 'For you'}</b><span>${p.items} item${p.items === 1 ? '' : 's'}</span>${h().btn('Export', `data-xmk="export" data-id="${esc(p.id)}"`, true)} ${h().btn('Delete', `data-xmk="forget" data-id="${esc(p.id)}"`, true)}</li>`).join('')}</ul></section>` : ''}`;
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Rentals' }) + `<div class="pg-body">${body}</div>`);
  }
  function sellerPage() {
    const C = S.seller; if (C.status === 'idle') loadSeller();
    const head = h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Seller console', acts: C.status === 'ready' ? h().btn('Publish a team', 'data-xmk="publishTeam"', true, 'people') + h().btn('Publish a skill', 'data-xmk="skills"', true, 'plus') : '' });
    const body = C.status === 'error' ? retry('The seller console', 'seller') : C.status === 'none' ? h().box('market', 'You are not selling anything yet', 'Start a seller profile. It sells as your workspace, and you answer for what it lists.', h().btn('Start selling', 'data-xmk="register"', false, 'plus')) : C.status !== 'ready' ? h().box('market', 'Opening', '')
      : `<section class="pg-sec"><h3>Earnings</h3><dl class="mk-dl"><dt>Available</dt><dd>${C.earnings.availableCredits ?? 0} credits</dd><dt>Pending</dt><dd>${C.earnings.pendingCredits ?? 0} credits</dd><dt>Paid out</dt><dd>${C.earnings.paidOutCredits ?? 0} credits</dd></dl>${Number(C.earnings.availableCredits) > 0 ? h().btn('Cash out', 'data-xmk="payout"', true) : ''}</section>
        <section class="pg-sec"><h3>Your listings</h3>${C.listings.length ? `<ul class="mk-rcl">${C.listings.map((l) => `<li>${l.status === 'published' ? `<button class="pg-link" data-xmk="open" data-id="${esc(l.slug)}">${esc(l.title)}</button>` : `<b>${esc(l.title)}</b>`}<span>${esc(h().cap(l.kind))}</span><span class="pg-dim">${esc(h().cap(l.status))}${l.lastSubmission ? ' · review ' + esc(l.lastSubmission.state) : ''}</span>${l.status === 'draft' && l.versions > 0 && (!l.lastSubmission || l.lastSubmission.state === 'rejected') ? h().btn('Send to review', `data-xmk="submit" data-id="${esc(l.id)}"`, true) : ''}</li>`).join('')}</ul>` : '<p class="pg-dim">Nothing listed yet. Skills publish from your Skills library.</p>'}</section>
        ${C.recent.length ? `<section class="pg-sec"><h3>Recent sales</h3><ul class="mk-rcl">${C.recent.map((t) => `<li><span>${esc(h().cap(t.type))}</span><b>${t.creatorNet} credits</b><span class="pg-dim">${t.gross} less ${t.platformFee} fee · ${esc(day(t.createdAt))}</span></li>`).join('')}</ul></section>` : ''}`;
    return h().page(head + `<div class="pg-body">${body}</div>`);
  }
  function route(view) {
    if (view && view.startsWith('l/')) return listingPage(view.slice(2));
    if (view === 'Purchases') return purchases();
    if (view === 'Rentals') return rentalsPage();
    if (view === 'Seller console') return sellerPage();
    return store(view);
  }

  const reloadListing = (slug) => loadListing(slug);
  const ACT = {
    open(slug) { go('l/' + slug); },
    go(item) { go(item || null); },
    skills() { X().go('global', { global: 'workspace', item: 'Skills' }); },
    tool(id) { X().go('global', { global: 'market', item: null }); window.XENO_TOOLS?.open?.(id); },
    retry(what) { if (what === 'store') loadStore(); else if (what === 'mine') loadMine(); else if (what === 'rent') loadRent(); else if (what === 'seller') loadSeller(); else if (what.startsWith('listing:')) loadListing(what.slice(8)); paint(); },
    report() { X().go('global', { global: 'support', item: 'new' }); },
    async buy(slug, t) {
      const x = S.listing.get(slug), l = x.listing, p = (l.pricing || [])[Number(t.dataset.i)] || { model: 'free' }, paid = p.model !== 'free' && p.priceCredits > 0;
      if (paid && !(await D().confirm({ title: `${p.model === 'subscription' ? 'Subscribe to' : p.model === 'rental' ? 'Rent' : 'Buy'} ${esc(l.title)}?`, body: `${esc(priceOf(p))} from your credits.${p.model === 'subscription' ? ' It renews until you cancel.' : ''}`, action: p.model === 'subscription' ? 'Subscribe' : p.model === 'rental' ? 'Rent' : 'Buy' }))) return;
      const path = p.model === 'subscription' ? 'subscribe' : p.model === 'rental' ? 'rent' : 'purchase';
      const r = await api('POST', `${BASE}/listings/${encodeURIComponent(l.id)}/${path}`, { model: p.model }).catch(() => null);
      if (!r || !r.ok) return toast(r && r.status === 402 ? 'You don’t have enough credits for this. Nothing was charged.' : said(r, 'That did not go through. Nothing was charged.'));
      if (p.model === 'rental') { const b = await api('POST', `${BASE}/listings/${encodeURIComponent(l.id)}/rental/bind`, { workspaceId: wsId() }).catch(() => null); if (!b || !b.ok) toast(said(b, 'It is rented, but it could not be added to this workspace. Try from Rentals.')); }
      toast(r.d.alreadyOwned ? 'You already have this' : `You have ${l.title}`);
      S.mine.status = 'idle'; S.rent.status = 'idle'; reloadListing(slug);
    },
    async review(slug) {
      const x = S.listing.get(slug), v = await D().form({ title: `Review ${x.listing.title}`, submit: 'Post review', fields: [{ id: 'rating', label: 'Rating', type: 'seg', value: '5', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] }, { id: 'text', label: 'What was it like?', type: 'textarea', rows: 4, max: 5000 }] });
      if (!v) return;
      const r = await api('POST', `${BASE}/listings/${encodeURIComponent(x.listing.id)}/reviews`, { rating: Number(v.rating), text: v.text }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That review could not be posted.'));
      toast('Review posted'); reloadListing(slug);
    },
    async import(slug) {
      const x = S.listing.get(slug), w = wsId(); if (!w) return toast('Open a company workspace first.');
      if (!(await D().confirm({ title: `Bring ${esc(x.listing.title)} into this workspace?`, body: 'It becomes a team here, under its licence. You can rename it or remove it later.', action: 'Bring it in' }))) return;
      const r = await api('POST', `${BASE}/listings/${encodeURIComponent(x.listing.id)}/import-team`, { versionId: x.versions[0].id, owner: { type: 'workspace', id: w }, acceptLicense: true }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It could not be brought in.'));
      toast('It is now a team in this workspace'); X().go('global', { global: 'workspace', item: 'Teams' });
    },
    async endrent(id) { if (!(await D().confirm({ title: 'End this rental?', body: 'It stops working for you. What it did stays on record.', action: 'End rental' }))) return; const r = await api('POST', `${BASE}/rental-bindings/${encodeURIComponent(id)}/revoke`, {}).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It could not be ended.')); toast('Rental ended'); loadRent(); },
    async export(id) { const r = await api('GET', `${BASE}/rental-partitions/${encodeURIComponent(id)}/export`).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It could not be exported.')); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.d.export, null, 2)], { type: 'application/json' })); a.download = `rental-memory-${id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Exported'); },
    async forget(id) { if (!(await D().confirm({ title: 'Delete what it remembers for you?', body: 'This can’t be undone. Anything kept by law is listed afterwards.', action: 'Delete', danger: true }))) return; const r = await api('DELETE', `${BASE}/rental-partitions/${encodeURIComponent(id)}/content`).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It could not be deleted.')); toast('Deleted'); loadRent(); },
    async register() { const v = await D().form({ title: 'Start selling', sub: 'People see this name on your listings.', submit: 'Start selling', fields: [{ id: 'name', label: 'Seller name', required: true, max: 120 }] }); if (!v) return; const r = await api('POST', `${BASE}/developer/register`, { displayName: v.name.trim() }).catch(() => null); if (!r || !r.ok) return toast(said(r, 'That could not be saved.')); loadSeller(); },
    // A team is packaged by the server from a real team: its setup and its agents' definitions, never its people. Nothing
    // goes on sale until review passes. Free now; a price needs the same review and comes with it.
    async publishTeam() {
      const w = wsId(); if (!w) return toast('Open a company workspace first: a team you sell comes from one.');
      const r0 = await api('GET', `/api/workspaces/${encodeURIComponent(w)}/teams`).catch(() => null);
      const teams = (r0 && r0.ok && (r0.d.teams || [])) || [];
      if (!teams.length) return toast('This workspace has no team to publish yet.');
      let done = null;
      const v = await D().form({ title: 'Publish a team', sub: 'People buy a copy of its setup and its agents’ definitions. Your people, and agents you can’t pass on, stay behind. It goes on sale once it passes review.', submit: 'Send to review', fields: [
        { id: 'team', label: 'Team', type: 'select', required: true, value: teams[0].id, options: teams.map((t) => [t.id, t.name]) },
        { id: 'title', label: 'Name in the Marketplace', required: true, max: 200, value: teams[0].name },
        { id: 'summary', label: 'What it’s for', type: 'textarea', rows: 2, required: true, max: 500 },
        { id: 'license', label: 'Licence', type: 'select', required: true, value: 'LicenseRef-XENO-Marketplace-Redistributable', hint: 'It has to let buyers copy the setup.', options: [['LicenseRef-XENO-Marketplace-Redistributable', 'XENO Marketplace'], ['MIT', 'MIT'], ['Apache-2.0', 'Apache 2.0'], ['CC-BY-4.0', 'CC BY 4.0'], ['CC0-1.0', 'CC0']] }],
        onSubmit: async (vals) => {
          const made = await api('POST', `${BASE}/listings`, { kind: 'team', title: vals.title.trim(), summary: vals.summary.trim(), license: vals.license, pricing: [{ model: 'free' }] }).catch(() => null);
          if (!made || !made.ok) return said(made, 'The listing could not be made.');
          const id = made.d.listing?.id;
          const ver = await api('POST', `${BASE}/listings/${encodeURIComponent(id)}/versions`, { version: '1.0.0', teamId: vals.team }).catch(() => null);
          if (!ver || !ver.ok) return (ver && ver.d && TEAM_REFUSAL[ver.d.error]) || said(ver, 'The team could not be packaged.');
          const sub = await api('POST', `${BASE}/listings/${encodeURIComponent(id)}/submit`, {}).catch(() => null);
          done = { excluded: ver.d.excluded || {}, submitted: !!(sub && sub.ok), why: sub && !sub.ok ? said(sub, '') : '' };
          return null;
        } });
      if (!v || !done) return;
      const left = (done.excluded.memberships || 0) + (done.excluded.agents || []).length;
      toast(done.submitted ? `Sent to review${left ? `. ${left} member${left === 1 ? '' : 's'} stayed behind` : ''}` : (done.why || 'Saved as a draft. Send it to review from your listings.'));
      S.seller = null; loadSeller();
    },
    async submit(id) { const r = await api('POST', `${BASE}/listings/${encodeURIComponent(id)}/submit`, {}).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It could not be sent to review.')); toast('Sent to review'); loadSeller(); },
    async payout() {
      const C = S.seller, v = await D().form({ title: 'Cash out', sub: `${C.earnings.availableCredits} credits available.`, submit: 'Ask to cash out', fields: [{ id: 'n', label: 'Credits', required: true, value: String(C.earnings.availableCredits), validate: (x) => (/^[1-9]\d*$/.test(x.trim()) ? null : 'A whole number of credits.') }] });
      if (!v) return;
      const r = await api('POST', `${BASE}/developer/payouts`, { amountCredits: Number(v.n) }).catch(() => null);
      toast(said(r, 'That could not be asked for.')); loadSeller();   // the server says plainly that cash-out is not on yet
    },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-xmk]'); if (!t) return; e.preventDefault(); ACT[t.dataset.xmk]?.(t.dataset.id || '', t); });
  document.addEventListener('keydown', (e) => { const i = e.target.closest?.('[data-xmk-q]'); if (i && e.key === 'Enter') { S.store.q = i.value.trim(); S.store.status = 'loading'; paint(); loadStore(); } });
  const label = (x) => { if (x === 'l') return null; for (const v of S.listing.values()) if (v.listing && v.listing.slug === x) return v.listing.title; return x; };
  window.XENO_MARKET = { served: true, route, label };
})();
