/**
 * The Marketplace, from the platform (routes/marketplaceRoutes.js). The picture sold sample listings, kept purchases, reviews
 * and a seller's earnings in this browser and "charged" nothing. Here every part is the real store:
 *
 *   the store      /workspace/market[/<Tools|Minds|…>]      GET /catalog
 *   a listing      /workspace/market/l/<slug>               GET /listings/:slug · POST …/purchase|subscribe|rent · …/reviews
 *   what you have  /workspace/market/Purchases              GET /me/entitlements
 *   rentals        /workspace/market/Rentals                GET /rental-bindings · /rental-partitions, export and delete your memory
 *   selling        /workspace/market/Seller console         GET /developer/me|listings|earnings · POST /developer/register|payouts · …/submit
 *   reviewing      /workspace/market/Review                 GET /submissions · POST /submissions/:id/approve|reject (XENO staff; skills review in Skills)
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
  const S = { store: { status: 'idle', list: [], q: '' }, listing: new Map(), mine: { status: 'idle', list: [] }, rent: { status: 'idle', bindings: [], partitions: [] }, seller: { status: 'idle' }, review: { status: 'idle', list: [] }, asks: new Map() };
  const paint = () => { try { const s = X()?.S; if (s?.view === 'global' && s.global === 'market') X().render(); } catch {} };
  const go = (item) => X().go('global', { global: 'market', item });

  const priceOf = (p) => (!p || p.model === 'free' || !p.priceCredits ? 'Free' : p.model === 'subscription' ? `${p.priceCredits} credits / ${p.period || 'month'}` : p.model === 'rental' ? `${p.priceCredits} credits${p.meterUnit ? ' / ' + p.meterUnit : ` for ${RENTAL_DAYS[p.period || 'month'] ?? 30} days`}` : `${p.priceCredits} credits`);
  const RENTAL_DAYS = { day: 1, week: 7, month: 30, year: 365 };
  const LICENCE_NAME = { 'LicenseRef-XENO-Marketplace-Agent': 'Use it, not sell it on', 'LicenseRef-XENO-Marketplace-Redistributable': 'Use it and pass it on', 'Apache-2.0': 'Apache 2.0' };
  const licenceName = (id) => LICENCE_NAME[id] || id;
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
  const ASK_POLL_MS = window.XENO_MARKET_ASK_POLL_MS || 3000;
  const AGENT_REFUSAL = { definition_has_secret: 'This agent’s instructions hold something that looks like a key or password. Take it out first: buyers would see it.', definition_unsafe: 'This agent’s instructions try to take over whoever runs them, so they can’t go on sale.', not_redistributable: 'You got this agent under terms that don’t let you sell it on.', agent_has_no_definition: 'This agent has no role or instructions yet, so there’s nothing to sell.', agent_not_found: 'That agent is gone, or you don’t manage it.', agent_archived: 'That agent is archived.' };
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

  async function loadReview() {
    S.review.status = 'loading';
    const r = await api('GET', `${BASE}/submissions?state=in_review`).catch(() => null);
    if (r && r.ok) { S.review.list = (r.d.submissions || []).filter((x) => x.kind !== 'skill'); S.review.status = 'ready'; } else S.review.status = 'error';
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
    if (l.kind === 'mind' && x.versions?.[0]?.agent) return h().btn('Add it to this workspace', `data-xmk="importAgent" data-id="${esc(l.slug)}"`, false, 'plus');
    return '<span class="pg-dim">Installed from XENO Hub on your computer.</span>';
  }
  function listingPage(slug) {
    const x = S.listing.get(slug); if (!x) { loadListing(slug); return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'Opening', '')); }
    if (x.status === 'loading') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'Opening', ''));
    if (x.status === 'gone') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + h().box('market', 'This listing is not here', 'It was removed, or it is not published.', h().btn('Back to the store', 'data-xmk="go" data-id=""')));
    if (x.status === 'error') return h().page(h().head({ eyebrow: 'Marketplace', title: 'Marketplace' }) + retry('This listing', 'listing:' + slug));
    const l = x.listing, ent = x.entitlement, t = TRUST[l.trustTier] || TRUST.community, R = x.reviews || [];
    const buy = ent ? `<span class="pg-chip">You have this${ent.expiresAt ? ' until ' + esc(day(ent.expiresAt)) : ''}</span>` : (l.pricing || []).length ? l.pricing.map((p, i) => h().btn(p.model === 'rental' ? `Rent · ${priceOf(p)}` : l.kind === 'mind' ? (p.priceCredits ? `Buy a copy · ${priceOf(p)}` : 'Get a copy') : p.model === 'free' || !p.priceCredits ? 'Get' : p.model === 'subscription' ? `Subscribe · ${priceOf(p)}` : p.model === 'rental' ? `Rent · ${priceOf(p)}` : `Buy · ${priceOf(p)}`, `data-xmk="buy" data-id="${esc(slug)}" data-i="${i}"`, false, 'plus')).join(' ') : h().btn('Get', `data-xmk="buy" data-id="${esc(slug)}" data-i="-1"`, false, 'plus');
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: l.title, acts: buy })
      + `<div class="mk-hero"><span class="pg-thumb pg-thumb--ic sq mk-big">${ic(glyph(l))}</span><div class="mk-hero-m"><h2 class="mk-title">${esc(l.title)}</h2>${l.summary ? `<p class="mk-p">${esc(l.summary)}</p>` : ''}<div class="mk-row"><b>${esc(l.developerName || (l.isFirstParty ? 'XENO' : 'Seller'))}</b>${h().chip(t[0])}<span class="pg-dim">${esc(kindName(l.kind))}</span></div>
        <div class="mk-row">${R.length ? `${stars(l.ratingAvg)} <span class="pg-dim">${Number(l.ratingAvg).toFixed(1)} · ${l.ratingCount} review${l.ratingCount === 1 ? '' : 's'}</span>` : '<span class="pg-dim">No reviews yet</span>'}</div></div><div class="mk-buy"><b class="mk-price">${esc(priceLine(l))}</b>${nextStep(l, ent, x)}</div></div>
      <div class="mk-cols"><div>
        <section class="pg-sec"><h3>About</h3><p class="mk-p">${esc(x.description || l.summary || 'No description.')}</p></section>
        <section class="pg-sec"><h3>Reviews</h3>${R.length ? `<ul class="mk-revs">${R.map((r) => `<li><div class="mk-row"><b>${esc(r.author || 'Someone')}</b>${stars(r.rating)}<span class="pg-dim">${esc(day(r.createdAt))}</span></div>${r.title ? `<b>${esc(r.title)}</b>` : ''}<p class="mk-p">${esc(r.text || '')}</p></li>`).join('')}</ul>` : '<p class="pg-dim">Nobody has reviewed this yet.</p>'}
          ${ent ? h().btn('Write a review', `data-xmk="review" data-id="${esc(slug)}"`, true, 'edit') : '<p class="pg-dim wf-note">Only people who have it can review it.</p>'}</section>
      </div><aside class="mk-side">
        <section class="pg-sec"><h3>Trust</h3><p class="mk-p"><b>${esc(t[0])}.</b> ${esc(t[1])}</p></section>
        ${l.currentVersion || l.license || l.publishedAt ? `<section class="pg-sec"><h3>Details</h3><dl class="mk-dl">${l.currentVersion ? `<dt>Version</dt><dd>${esc(l.currentVersion)}</dd>` : ''}${l.license ? `<dt>Licence</dt><dd>${esc(licenceName(l.license))}</dd>` : ''}${l.publishedAt ? `<dt>Listed</dt><dd>${esc(day(l.publishedAt))}</dd>` : ''}</dl></section>` : ''}
        ${x.versions?.[0]?.agent ? (() => { const a = x.versions[0].agent; return `<section class="pg-sec" data-xmk-agent><h3>What this agent is</h3><dl class="mk-dl">${a.role ? `<dt>Role</dt><dd>${esc(a.role)}</dd>` : ''}<dt>Asks to use</dt><dd>${a.capabilities.length ? esc(a.capabilities.join(', ')) : 'Nothing beyond chat'}</dd>${a.secretNames.length ? `<dt>You’d provide</dt><dd>${esc(a.secretNames.join(', '))}</dd>` : ''}${a.skills ? `<dt>Skills</dt><dd>${a.skills} to add yourself</dd>` : ''}</dl><p class="pg-dim">You see its instructions once you have a copy. If you rent it, the seller’s instructions stay private and what it remembers for you stays yours.</p></section>`; })() : ''}
        ${x.versions?.[0]?.team?.members?.length ? (() => { const t = x.versions[0].team; const need = [...new Set(t.members.flatMap((m) => m.secretNames || []))]; return `<section class="pg-sec" data-xmk-team><h3>Who comes with it</h3><dl class="mk-dl">${t.members.map((m) => `<dt>${esc(m.name)}</dt><dd>${esc({ manager: 'Manager', worker: 'Worker', observer: 'Observer' }[m.role] || m.role || '')}</dd>`).join('')}${need.length ? `<dt>You’d provide</dt><dd>${esc(need.join(', '))}</dd>` : ''}</dl><p class="pg-dim">You get a copy of each agent’s setup, starting with no access. The seller’s people and anything they can’t pass on stay behind.</p></section>`; })() : ''}
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
      : `${R.bindings.length ? `<section class="pg-sec"><h3>Rented agents</h3><ul class="mk-rcl">${R.bindings.map((b) => { const a = S.asks.get(b.id); return `<li data-xmk-binding="${esc(b.id)}"><b>${esc(b.title || 'Agent')}</b><span>${esc(h().cap(b.state || ''))}</span>${(b.state || 'active') === 'active' ? `<span class="mk-acts">${h().btn(a?.busy ? 'Working…' : 'Ask', `data-xmk="ask" data-id="${esc(b.id)}"${a?.busy ? ' disabled' : ''}`)}${h().btn('End', `data-xmk="endrent" data-id="${esc(b.id)}"`, true)}</span>` : ''}${a?.text ? `<p class="mk-p" data-xmk-answer>${esc(a.text)}</p>` : ''}</li>`; }).join('')}</ul></section>` : ''}
        ${R.partitions.length ? `<section class="pg-sec"><h3>What they remember for you</h3><p class="pg-dim">This memory is yours. Its seller can’t read it.</p><ul class="mk-rcl">${R.partitions.map((p) => `<li><b>${p.target.kind === 'workspace' ? 'For a workspace' : 'For you'}</b><span>${p.items} item${p.items === 1 ? '' : 's'}</span>${h().btn('Export', `data-xmk="export" data-id="${esc(p.id)}"`, true)} ${h().btn('Delete', `data-xmk="forget" data-id="${esc(p.id)}"`, true)}</li>`).join('')}</ul></section>` : ''}`;
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Rentals' }) + `<div class="pg-body">${body}</div>`);
  }
  function sellerPage() {
    const C = S.seller; if (C.status === 'idle') loadSeller();
    const head = h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Seller console', acts: (PF.isAdmin?.() ? h().btn('Review queue', 'data-xmk="go" data-id="Review"', true, 'check') : '') + (C.status === 'ready' ? h().btn('Publish an agent', 'data-xmk="publishAgent"', true, 'bot') + h().btn('Publish a team', 'data-xmk="publishTeam"', true, 'people') + h().btn('Publish a skill', 'data-xmk="skills"', true, 'plus') : '') });
    const body = C.status === 'error' ? retry('The seller console', 'seller') : C.status === 'none' ? h().box('market', 'You are not selling anything yet', 'Start a seller profile. It sells as your workspace, and you answer for what it lists.', h().btn('Start selling', 'data-xmk="register"', false, 'plus')) : C.status !== 'ready' ? h().box('market', 'Opening', '')
      : `<section class="pg-sec"><h3>Earnings</h3><dl class="mk-dl"><dt>Available</dt><dd>${C.earnings.availableCredits ?? 0} credits</dd><dt>Pending</dt><dd>${C.earnings.pendingCredits ?? 0} credits</dd><dt>Paid out</dt><dd>${C.earnings.paidOutCredits ?? 0} credits</dd></dl>${Number(C.earnings.availableCredits) > 0 ? h().btn('Cash out', 'data-xmk="payout"', true) : ''}</section>
        <section class="pg-sec"><h3>Your listings</h3>${C.listings.length ? `<ul class="mk-rcl">${C.listings.map((l) => `<li>${l.status === 'published' ? `<button class="pg-link" data-xmk="open" data-id="${esc(l.slug)}">${esc(l.title)}</button>` : `<b>${esc(l.title)}</b>`}<span>${esc(h().cap(l.kind))}</span><span class="pg-dim">${esc(h().cap(l.status))}${l.lastSubmission ? ' · review ' + esc(l.lastSubmission.state) : ''}</span>${l.status === 'draft' && l.versions > 0 && (!l.lastSubmission || l.lastSubmission.state === 'rejected') ? h().btn('Send to review', `data-xmk="submit" data-id="${esc(l.id)}"`, true) : ''}</li>`).join('')}</ul>` : '<p class="pg-dim">Nothing listed yet. Skills publish from your Skills library.</p>'}</section>
        ${C.recent.length ? `<section class="pg-sec"><h3>Recent sales</h3><ul class="mk-rcl">${C.recent.map((t) => `<li><span>${esc(h().cap(t.type))}</span><b>${t.creatorNet} credits</b><span class="pg-dim">${t.gross} less ${t.platformFee} fee · ${esc(day(t.createdAt))}</span></li>`).join('')}</ul></section>` : ''}`;
    return h().page(head + `<div class="pg-body">${body}</div>`);
  }
  /** A reviewer reads what would go on sale and what a rental would run, and decides. The checks only say it's well formed. */
  function reviewPage() {
    const Q = S.review; if (Q.status === 'idle') loadReview();
    // What a buyer's agent will be told: who it is and its instructions. A reviewer reads all of it, for one agent or each
    // agent in a team (a team card used to show only the names, so a team's instructions reached strangers unread).
    const reads = (name, persona, def, fn) => `<p class="pg-dim">Agent: ${esc(name || '')}${fn ? ' · ' + esc(fn) : ''}${persona?.role ? ' · ' + esc(persona.role) : ''}</p>${persona?.body ? `<h4>Who it is</h4><pre class="mk-read">${esc(persona.body)}</pre>` : ''}<h4>Its instructions</h4><pre class="mk-read">${esc(def?.instructions || '(none)')}</pre><p class="pg-dim">Asks to use: ${esc((def?.requestedCapabilities || []).join(', ') || 'nothing')} · Buyers provide: ${esc((def?.secretNames || []).join(', ') || 'nothing')} · Skills: ${(def?.skills || []).length}</p>`;
    const one = (s) => { const d = s.agent_definition, m = s.team_members; return `<li class="mk-rev" data-xmk-review="${esc(s.id)}"><div class="mk-row"><b>${esc(s.title)}</b>${h().chip(kindName(s.kind))}<span class="pg-dim">${esc(s.developer || '')} · ${esc(s.version || '')} · ${esc(s.license ? licenceName(s.license) : 'no licence')}</span></div>
      ${d ? reads(d.agent?.name, d.persona, d.definition) : ''}
      ${m ? `<p class="pg-dim">Team of ${m.length}: ${esc(m.map((x) => x.name).join(', '))}</p>${m.map((x) => reads(x.name, x.persona, x.definition, x.role)).join('')}` : ''}
      <div class="mk-row">${h().btn('Approve and publish', `data-xmk="approve" data-id="${esc(s.id)}"`)} ${h().btn('Send back', `data-xmk="sendBack" data-id="${esc(s.id)}"`, true)}</div></li>`; };
    const body = Q.status === 'error' ? retry('The review queue', 'review') : Q.status !== 'ready' ? h().box('market', 'Opening', '') : Q.list.length ? `<ul class="mk-rcl mk-revq">${Q.list.map(one).join('')}</ul>` : h().box('market', 'Nothing waiting for review', 'Skills are reviewed in Skills.');
    return h().page(h().head({ eyebrow: '<a data-xmk="go" data-id="">Marketplace</a>', title: 'Review queue' }) + `<div class="pg-body">${body}</div>`);
  }
  function route(view) {
    if (view === 'Review') return reviewPage();
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
    retry(what) { if (what === 'store') loadStore(); else if (what === 'mine') loadMine(); else if (what === 'rent') loadRent(); else if (what === 'seller') loadSeller(); else if (what === 'review') loadReview(); else if (what.startsWith('listing:')) loadListing(what.slice(8)); paint(); },
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
      const x = S.listing.get(slug), v = x.versions[0], w = wsId(); if (!w) return toast('Open a company workspace first.');
      // The server takes the licence by NAME (marketplaceTeamPackages.importTeamPackage), so the person is shown which one
      // they accept. This sent `true`, which the server refuses, so no team could ever be brought in (dogfooding 2026-11-03).
      if (!(await D().confirm({ title: `Bring ${esc(x.listing.title)} into this workspace?`, body: `It becomes a team here, under these terms: ${esc(licenceName(v.license || ''))}. You can rename it or remove it later.`, action: 'Bring it in' }))) return;
      const r = await api('POST', `${BASE}/listings/${encodeURIComponent(x.listing.id)}/import-team`, { versionId: v.id, owner: { type: 'workspace', id: w }, acceptLicense: v.license }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It could not be brought in.'));
      toast('It is now a team in this workspace'); X().go('global', { global: 'workspace', item: 'Teams' });
    },
    async importAgent(slug) {
      const x = S.listing.get(slug), v = x.versions[0], w = wsId();
      if (!(await D().confirm({ title: `Add ${esc(x.listing.title)} to this workspace?`, body: `It becomes your own agent, a copy you can read and change, under these terms: ${esc(licenceName(v.license || ''))}. It starts with no access: you give it what it needs.`, action: 'Add agent' }))) return;
      const r = await api('POST', `${BASE}/listings/${encodeURIComponent(x.listing.id)}/import-agent`, { versionId: v.id, workspaceId: w, acceptLicense: v.license }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It could not be added.'));
      const i = r.d.import, needs = [i.requiredSecrets?.length ? `${i.requiredSecrets.join(', ')} to provide` : '', i.skillsLeftOut ? `${i.skillsLeftOut} skill${i.skillsLeftOut === 1 ? '' : 's'} to add` : ''].filter(Boolean).join(' and ');
      toast(r.d.import && needs ? `Added. It still needs ${needs}.` : 'Added to this workspace');
      X().go('global', { global: 'workspace', item: `Agents/${i.agentId}` });
    },
    /** One question to a rented agent. Credits come from the person asking, and the answer stays in their own memory for it. */
    async ask(id) {
      const b = S.rent.bindings.find((x) => x.id === id); if (!b) return;
      const v = await D().form({ title: `Ask ${esc(b.title || 'this agent')}`, sub: 'It runs on your credits. What it answers stays yours: its seller can’t read it.', submit: 'Ask', fields: [{ id: 'prompt', label: 'What should it do?', type: 'textarea', rows: 5, required: true, max: 20000 }] });
      if (!v) return;
      S.asks.set(id, { busy: true }); paint();
      const finish = (text) => { S.asks.set(id, { busy: false, text }); paint(); };
      const first = await api('POST', `${BASE}/invoke/${encodeURIComponent(b.listingId)}`, { prompt: v.prompt, bindingId: id }).catch(() => null);
      if (!first?.d?.invocation) return finish(first?.status === 503 ? 'XENO can’t run hosted agents right now. Nothing was charged.' : first?.status === 402 ? 'You don’t have enough credits for this. Nothing was charged.' : said(first, 'It could not start. Nothing was charged.'));
      const invocationId = first.d.invocation.id;
      for (let i = 0; i < 100; i++) {
        await new Promise((res) => setTimeout(res, ASK_POLL_MS));
        const r = await api('GET', `${BASE}/invocations/${encodeURIComponent(invocationId)}`).catch(() => null);
        const inv = r?.d?.invocation;
        if (inv?.state === 'finished') return finish(inv.output || (inv.runStatus === 'completed' ? 'It finished with nothing to say.' : `It stopped: ${inv.runStatusReason || inv.runStatus || 'no reason given'}.`));
        if (inv?.state === 'refused') return finish('It could not run. Nothing was charged.');
      }
      finish('It’s still working. Open Rentals again later: what it answers is kept in your memory for it.');
    },
    async approve(id) {
      if (!(await D().confirm({ title: 'Approve and publish this?', body: 'It goes on sale, and if it’s rented, these instructions are what it runs.', action: 'Publish' }))) return;
      const r = await api('POST', `${BASE}/submissions/${encodeURIComponent(id)}/approve`, {}).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It could not be published.'));
      toast(`Published ${r.d.publishedVersion || ''}`); S.store.status = 'idle'; loadReview();
    },
    async sendBack(id) {
      const v = await D().form({ title: 'Send it back', sub: 'The seller reads this.', submit: 'Send back', fields: [{ id: 'notes', label: 'Why', type: 'textarea', rows: 3, required: true, max: 2000 }] });
      if (!v) return;
      const r = await api('POST', `${BASE}/submissions/${encodeURIComponent(id)}/reject`, { notes: v.notes }).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It could not be sent back.'));
      toast('Sent back'); loadReview();
    },
    // One of your agents, on sale. The server builds the definition: its persona and instructions, never its memory, credentials or people.
    async publishAgent() {
      const w = wsId(), r0 = await api('GET', `/api/agents${w ? '?workspace=' + encodeURIComponent(w) : ''}`).catch(() => null);
      const mine = (r0 && r0.ok && (r0.d.agents || [])) || [];
      if (!mine.length) return toast('You have no agent to publish in this workspace yet.');
      let done = null;
      const v = await D().form({ title: 'Publish an agent', sub: 'Its role and instructions go on sale. Its memory, credentials and history stay here. It goes on sale once it passes review.', submit: 'Send to review', fields: [
        { id: 'agent', label: 'Agent', type: 'select', required: true, value: mine[0].id, options: mine.map((a) => [a.id, a.name]) },
        { id: 'title', label: 'Name in the Marketplace', required: true, max: 200, value: mine[0].name },
        { id: 'summary', label: 'What it’s for', type: 'textarea', rows: 2, required: true, max: 500 },
        { id: 'how', label: 'How people get it', type: 'select', required: true, value: 'rent', hint: 'Renting keeps your instructions private: XENO runs it for them. A copy is theirs to read and change.', options: [['rent', 'Rent it'], ['copy', 'Get a copy'], ['both', 'Either']] },
        { id: 'rent', label: 'Rent for 30 days, credits', type: 'number', value: '0', hint: 'They also pay for what it uses when it runs. 0 is free to rent.' },
        { id: 'copy', label: 'Copy, credits once', type: 'number', value: '0', hint: '0 is free.' },
        { id: 'license', label: 'What copies may do', type: 'select', required: true, value: 'LicenseRef-XENO-Marketplace-Agent', options: [['LicenseRef-XENO-Marketplace-Agent', 'Use it, not sell it on'], ['LicenseRef-XENO-Marketplace-Redistributable', 'Use it and pass it on'], ['Apache-2.0', 'Apache 2.0']] },
      ], onSubmit: async (vals) => {
        const pricing = [];
        if (vals.how !== 'copy') pricing.push({ model: 'rental', priceCredits: Math.max(0, Math.floor(Number(vals.rent) || 0)), period: 'month' });
        if (vals.how !== 'rent') pricing.push(Number(vals.copy) > 0 ? { model: 'one_time', priceCredits: Math.floor(Number(vals.copy)) } : { model: 'free' });
        const made = await api('POST', `${BASE}/listings`, { kind: 'mind', title: vals.title.trim(), summary: vals.summary.trim(), license: vals.license, pricing, rentalLicense: { personal: true, workspace: true, maxWorkspaces: 5 } }).catch(() => null);
        if (!made || !made.ok) return said(made, 'The listing could not be made.');
        const ver = await api('POST', `${BASE}/listings/${encodeURIComponent(made.d.listing?.id)}/versions`, { version: '1.0.0', agentId: vals.agent }).catch(() => null);
        if (!ver || !ver.ok) return (ver && ver.d && AGENT_REFUSAL[ver.d.error]) || said(ver, 'The agent could not be packaged.');
        const sub = await api('POST', `${BASE}/listings/${encodeURIComponent(made.d.listing?.id)}/submit`, {}).catch(() => null);
        done = { submitted: !!(sub && sub.ok), why: sub && !sub.ok ? said(sub, '') : '' };
        return null;
      } });
      if (!v || !done) return;
      toast(done.submitted ? 'Sent to review' : (done.why || 'Saved as a draft. Send it to review from your listings.'));
      S.seller = { status: 'idle' }; loadSeller();
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
