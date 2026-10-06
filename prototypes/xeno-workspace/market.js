/* XENO_MARKET — the Marketplace past the grid (XENO MARKETPLACE - SPEC §4–§6, §11; RENTED-AGENT MEMORY DELTA M1–M5).
 *   Listing page: what it is, who sells it, the trust tier, what it will be able to do (consent), every price model,
 *   versions, reviews from people who own it, report. Entitlements: one record per thing you have — receipts, renewal,
 *   cancel, refund inside its window, the rental limit and YOUR memory partition (export / delete). Seller console:
 *   submissions through the checks, live listings, earnings with the fee and the hold, payouts behind verification,
 *   and the Soul review that decides what a rented Mind may remember.
 * Platform: /api/marketplace/listings/:id · /entitlements · /reviews · /seller · /payouts ; /api/marketplace/rentals/:id/partition
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), DAY = 864e5, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 5);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const L = () => window.XENO_PG_MARKET, byId = (id) => L().find((x) => x.id === id), byName = (n) => L().find((x) => x.name === n);
  const saveDb = () => window.XENO_DB?.save?.();
  const TRUST = { official: ['Official', 'Built and signed by XENO.'], verified: ['Verified', 'Seller identity checked; full security review.'], community: ['Community · sandboxed', 'Runs in a sandbox. No native code, no access beyond what you allow.'] };
  // decisions the spec left open (§12), recorded in XENO MODES - SPEC §7m
  const FEE = (x) => (x.trust === 'official' ? 0 : 0.2), HOLD_DAYS = 14, REFUND_DAYS = 14;
  const model = (x) => (x.price === 'Free' ? 'free' : /Rent|task/.test(x.price) ? 'per_use' : /month/.test(x.price) ? 'subscription' : 'one_time');
  const amount = (x) => +(x.price.match(/€([\d.]+)/)?.[1] || 0);
  const cr = (n) => `${Math.round(n).toLocaleString('en')} cr`, eur = (n) => `€${n.toFixed(2).replace(/\.00$/, '')}`;
  const day = (t) => new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- per-listing detail (deterministic sample, the shape GET /listings/:id returns) ----------
  function detail(x) {
    const seed = [...x.name].reduce((n, c) => n + c.charCodeAt(0), 0);
    const caps = x.mode === 'agents' ? ['Read the projects you add it to', 'Use your workspace knowledge with your permissions', 'Spend credits per task, up to your limit'] : x.kind === 'mcp' ? ['Connect to an outside service you sign in to', 'Read only what that service allows'] : x.kind === 'blueprint' ? ['Create the apps and flows it describes in a project you choose'] : ['Open files you choose', 'Save results to your Library'];
    const vers = [3, 2, 1].map((v, i) => ({ v: `1.${v}.0`, at: now() - (i * 21 + (seed % 9)) * DAY, notes: ['Faster on large files', 'Works in Canvas too', 'First release'][i] }));
    return { caps, vers, size: x.mode === 'agents' ? null : `${(seed % 40) + 2} MB`, learning: x.kind === 'mind' && model(x) === 'per_use' ? (seed % 2 ? 'promotable' : 'partition-only') : null, licence: x.kind === 'blueprint' ? 'Use in your own products; no resale' : 'Personal and workspace use' };
  }
  // ---------- reviews: only people who own it can write one (one each, editable) ----------
  function reviews(x) {
    const R = LS.get('mkReviews', null) || {};
    if (!R[x.id]) { const names = ['Nova', 'Mira Chen', 'Kit', 'Dana P.', 'Ana', 'Juno']; const seed = [...x.name].reduce((n, c) => n + c.charCodeAt(0), 0);
      R[x.id] = x.seller === 'You' ? [] : Array.from({ length: 2 + (seed % 3) }, (_, i) => ({ id: 'rv' + i, who: names[(seed + i) % names.length], stars: [5, 4, 5, 3, 4][(seed + i) % 5], text: ['Does exactly what it says, first try.', 'Saved me an afternoon. Wish it had a batch mode.', 'Solid. The sandbox notice put my team at ease.', 'Good, but slower on big files than I hoped.', 'Clear about what it touches — rare.'][(seed + i) % 5], at: now() - (i * 5 + 2) * DAY, reply: i === 1 ? 'Batch mode lands in the next version.' : '' }));
      LS.set('mkReviews', R); }
    return R[x.id];
  }
  const setReviews = (x, list) => { const R = LS.get('mkReviews', {}); R[x.id] = list; LS.set('mkReviews', R); };
  // ---------- entitlements: what you have, and its terms ----------
  function ents() {
    let E = LS.get('mkEnts', null);
    if (!E) { E = {}; L().filter((x) => x.owned && x.seller !== 'You').forEach((x, i) => { E[x.id] = mkEnt(x, now() - (10 + i * 7) * DAY, i === 0, 500); }); LS.set('mkEnts', E); }
    return E;
  }
  function mkEnt(x, since, used, cap) {
    const m = model(x), price = amount(x);
    return { model: m, state: 'active', since, used: !!used, renews: m === 'subscription' ? since + 30 * DAY : null, cap: m === 'per_use' ? cap : null, spent: m === 'per_use' ? 86 : 0,
      receipts: m === 'free' ? [] : m === 'per_use' ? [{ at: since + 2 * DAY, what: '43 tasks', amt: cr(86) }] : [{ at: since, what: m === 'subscription' ? 'First month' : 'Purchase', amt: eur(price) }],
      partition: m === 'per_use' && x.kind === 'mind' ? { memories: 12, at: since + 3 * DAY } : null };
  }
  const setEnts = (E) => LS.set('mkEnts', E);
  // ---------- seller ----------
  function seller() {
    let S = LS.get('mkSeller', null);
    if (!S) { S = { kyb: 'none', payouts: [], sales: [] }; LS.set('mkSeller', S); }
    // a published sample listing so the console is never a dead end on first look
    if (!L().some((x) => x.id === 'lst_mine')) { L().push({ id: 'lst_mine', name: 'Launch copy — writing Mind', mode: 'agents', kind: 'mind', seller: 'You', trust: 'community', price: 'Rent · 3 cr / task', blurb: 'Writes launch posts, emails and pages in your brand voice', owned: true, review: 'live', publishedAt: now() - 40 * DAY, soul: { reviewed: true, items: soulItems() } }); saveDb(); }
    if (!S.sales.length) { S.sales = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, listing: 'lst_mine', who: ['Acme', 'Lumen Studio', 'Northwind', 'Nova'][i % 4], gross: [60, 42, 90, 30, 75, 18, 54, 66, 24][i], at: now() - (i * 4 + 1) * DAY })); LS.set('mkSeller', S); }
    return S;
  }
  function soulItems() { return [['Brand voice rules for XENO launches', 'skill', 'public'], ['How to structure a launch thread', 'skill', 'public'], ['Acme’s unreleased pricing (from a client call)', 'memory', 'private'], ['Draft of the Q4 board memo', 'memory', 'private'], ['Subject-line patterns that open well', 'skill', 'public'], ['Lumen Studio contact details', 'memory', 'private']].map(([t, kind, scope], i) => ({ id: 'so' + i, t, kind, scope })); }
  const earnings = (S) => { const net = (s) => s.gross * (1 - FEE(byId(s.listing) || {})); const held = S.sales.filter((s) => now() - s.at < HOLD_DAYS * DAY).reduce((n, s) => n + net(s), 0); const total = S.sales.reduce((n, s) => n + net(s), 0); const paid = S.payouts.reduce((n, p) => n + p.amt, 0); return { gross: S.sales.reduce((n, s) => n + s.gross, 0), fee: S.sales.reduce((n, s) => n + s.gross - net(s), 0), held, avail: Math.max(0, total - held - paid), paid }; };

  const stars = (n) => `<span class="mk-stars" aria-label="${n} of 5">${'★'.repeat(Math.round(n))}<i>${'★'.repeat(5 - Math.round(n))}</i></span>`;
  const verb = (x) => ({ free: 'Get', one_time: `Buy · ${x.price}`, subscription: `Subscribe · ${x.price}`, per_use: 'Rent' }[model(x)]);

  // ---------- the listing page ----------
  function listingPage(x) {
    const h = P(), d = detail(x), R = reviews(x), E = ents()[x.id], mine = x.seller === 'You', avg = R.length ? R.reduce((n, r) => n + r.stars, 0) / R.length : 0;
    const youReviewed = R.find((r) => r.who === 'You');
    const ent = E && E.state !== 'refunded' && E.state !== 'ended' ? entCard(x, E) : '';
    const buy = mine ? h.btn('Manage in Seller console', 'data-go="market" data-mk="console"', true) : ent ? '' : h.btn(verb(x), `data-xa="getListing" data-arg="${x.id}"`, false, 'plus');
    const hist = { free: 'Free', one_time: `One payment of ${x.price}. Refundable within ${REFUND_DAYS} days if you haven’t opened it.`, subscription: `${x.price}, renews monthly. Cancel any time — it stays until the end of the month you paid for.`, per_use: `${x.price.replace('Rent · ', '')}, billed per task from your credits, up to the monthly limit you set. Nothing is copied to you: it runs on XENO’s side.` }[model(x)];
    return h.page(h.head({ eyebrow: '<a data-go="market">Marketplace</a> · ' + esc(x.mode === 'agents' ? 'Agents' : 'Apps'), title: x.name, sub: x.blurb })
      + `<div class="mk-hero"><span class="pg-thumb pg-thumb--ic sq mk-big">${ic(x.mode === 'agents' ? (x.kind === 'model' ? 'box' : 'bot') : x.kind === 'blueprint' ? 'layers' : 'grid')}</span>
        <div class="mk-hero-m"><div class="mk-row"><b>${esc(x.seller)}</b>${h.chip(TRUST[x.trust][0])}<span class="pg-dim">${esc(h.cap(x.kind === 'mcp' ? 'MCP' : x.kind))}</span>${x.review && x.review !== 'live' ? h.chip('In review') : ''}</div>
        <div class="mk-row">${R.length ? `${stars(avg)} <span class="pg-dim">${avg.toFixed(1)} · ${R.length} review${R.length > 1 ? 's' : ''}</span>` : '<span class="pg-dim">No reviews yet</span>'}</div></div>
        <div class="mk-buy"><b class="mk-price">${esc(x.price)}</b>${buy}</div></div>
      ${ent}
      <div class="mk-cols"><div>
        <section class="pg-sec"><h3>What it will be able to do</h3><ul class="mk-caps">${d.caps.map((c) => `<li>${ic('check')}${esc(c)}</li>`).join('')}</ul><p class="pg-dim wf-note">You agree to these before it first runs. It can’t ask for more later without asking you again.</p></section>
        ${d.learning ? `<section class="pg-sec"><h3>What it remembers</h3><p class="mk-p">It keeps a separate memory for you — your work, nobody else’s. Its owner’s private memory is never loaded when it works for you, and other renters never see yours.</p><p class="mk-p"><b>${d.learning === 'promotable' ? 'Its owner may keep general skills it learns with you' : 'What it learns with you stays with you'}</b> — ${d.learning === 'promotable' ? 'never your facts or files, and only after reviewing them by hand.' : 'nothing is copied into its owner’s agent.'} You can export or delete your memory at any time.</p></section>` : ''}
        <section class="pg-sec"><h3>Price</h3><p class="mk-p">${esc(hist)}</p>${FEE(x) ? '' : ''}</section>
        <section class="pg-sec"><h3>Reviews</h3>${R.length ? `<ul class="mk-revs">${R.map((r) => `<li><div class="mk-row"><b>${esc(r.who)}</b>${stars(r.stars)}<span class="pg-dim">${day(r.at)}</span>${r.who === 'You' ? h.btn('Edit', `data-mk="review" data-arg="${x.id}"`, true) : ''}${mine && !r.reply ? h.btn('Reply', `data-mk="reply" data-arg="${x.id}|${r.id}"`, true) : ''}</div><p>${esc(r.text)}</p>${r.reply ? `<p class="mk-reply"><b>${esc(x.seller)}:</b> ${esc(r.reply)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="pg-dim">Nobody has reviewed it yet.</p>`}
          ${E && E.state !== 'refunded' && !youReviewed && !mine ? h.btn('Write a review', `data-mk="review" data-arg="${x.id}"`, true, 'edit') : !E && !mine ? '<p class="pg-dim wf-note">Only people who have it can review it.</p>' : ''}</section>
      </div><aside class="mk-side">
        <section class="pg-sec"><h3>Trust</h3><p class="mk-p"><b>${TRUST[x.trust][0]}.</b> ${TRUST[x.trust][1]}</p><p class="pg-dim">Signed and checked every time it installs or runs.</p></section>
        <section class="pg-sec"><h3>Details</h3><dl class="mk-dl"><dt>Version</dt><dd>${d.vers[0].v}</dd>${d.size ? `<dt>Size</dt><dd>${d.size}</dd>` : ''}<dt>Licence</dt><dd>${esc(d.licence)}</dd><dt>Updated</dt><dd>${day(d.vers[0].at)}</dd></dl></section>
        <section class="pg-sec"><h3>Versions</h3><ul class="mk-vers">${d.vers.map((v) => `<li><b>${v.v}</b><span>${esc(v.notes)}</span><small>${day(v.at)}</small></li>`).join('')}</ul></section>
        ${mine ? '' : h.btn('Report this listing', `data-mk="report" data-arg="${x.id}"`, true, 'flag')}
      </aside></div>`
      + h.foot('market', `GET /api/marketplace/listings/${x.id}`));
  }
  function entCard(x, E) {
    const h = P(), rows = [];
    if (E.model === 'subscription') rows.push(E.state === 'cancelled' ? `Cancelled — yours until ${day(E.renews)}` : `Renews ${day(E.renews)}`);
    if (E.model === 'per_use') rows.push(`${cr(E.spent)} of your ${cr(E.cap)} monthly limit used`);
    if (E.model === 'one_time') rows.push(refundable(E) ? `Refundable until ${day(E.since + REFUND_DAYS * DAY)} — you haven’t opened it` : 'Yours to keep');
    if (E.model === 'free') rows.push('In your workspace');
    const acts = [h.btn('Open', `data-xa="openListing" data-arg="${x.id}"`, false, 'right'),
      E.model === 'per_use' ? h.btn('Change limit', `data-mk="cap" data-arg="${x.id}"`, true) : '',
      E.model === 'subscription' && E.state === 'active' ? h.btn('Cancel', `data-mk="cancel" data-arg="${x.id}"`, true) : E.model === 'subscription' ? h.btn('Resume', `data-mk="resume" data-arg="${x.id}"`, true) : '',
      E.model === 'per_use' ? h.btn('Stop renting', `data-mk="endRent" data-arg="${x.id}"`, true) : '',
      refundable(E) ? h.btn('Refund', `data-mk="refund" data-arg="${x.id}"`, true) : '',
      E.model === 'free' ? h.btn('Remove', `data-mk="remove" data-arg="${x.id}"`, true) : ''].join('');
    return `<section class="mk-ent"><div class="mk-ent-h"><b>${E.model === 'per_use' ? 'You rent this' : E.model === 'subscription' ? 'You subscribe to this' : 'You have this'}</b><span class="pg-dim">since ${day(E.since)}</span></div>
      <p>${rows.map(esc).join(' · ')}</p>
      ${E.partition ? `<div class="mk-part">${ic('lock')}<span><b>Your memory with it</b> — ${E.partition.memories} things it remembers about your work. Only you and it can see them.</span>${h.btn('Export', `data-mk="exportPart" data-arg="${x.id}"`, true)}${h.btn('Delete', `data-mk="deletePart" data-arg="${x.id}"`, true)}</div>` : ''}
      ${E.receipts.length ? `<details class="mk-rc"><summary>Receipts (${E.receipts.length})</summary><ul>${E.receipts.map((r) => `<li><span>${day(r.at)}</span><span>${esc(r.what)}</span><b>${esc(r.amt)}</b></li>`).join('')}</ul></details>` : ''}
      <div class="fd-acts">${acts}</div></section>`;
  }
  const refundable = (E) => E.model === 'one_time' && E.state === 'active' && !E.used && now() - E.since < REFUND_DAYS * DAY;

  // ---------- Purchases / Rentals: entitlements, not catalog cards ----------
  function owned(view) {
    const h = P(), E = ents(), rent = view === 'Rentals';
    const rows = Object.entries(E).map(([id, e]) => ({ x: byId(id), e })).filter((r) => r.x && (rent ? r.e.model === 'per_use' : r.e.model !== 'per_use'));
    const live = rows.filter((r) => !['refunded', 'ended'].includes(r.e.state)), past = rows.filter((r) => ['refunded', 'ended'].includes(r.e.state));
    const line = ({ x, e }) => `<li class="mk-own"><span class="pg-thumb pg-thumb--ic sq">${ic(x.mode === 'agents' ? 'bot' : 'grid')}</span><span class="mk-own-m"><a data-mk="open" data-arg="${x.id}"><b>${esc(x.name)}</b></a><small>${esc(x.seller)} · ${{ free: 'Free', one_time: 'Bought', subscription: e.state === 'cancelled' ? `Ends ${day(e.renews)}` : `Renews ${day(e.renews)}`, per_use: `${cr(e.spent)} of ${cr(e.cap)} this month` }[e.model]}${e.state === 'refunded' ? ' · Refunded' : e.state === 'ended' ? ' · Ended' : ''}</small></span>${h.btn('Manage', `data-mk="open" data-arg="${x.id}"`, true)}</li>`;
    const body = rows.length ? `<ul class="mk-owns">${live.map(line).join('')}</ul>${past.length ? `<h3 class="mk-sub">Ended</h3><ul class="mk-owns">${past.map(line).join('')}</ul>` : ''}` : h.box('market', `No ${view.toLowerCase()} yet`, 'What you buy or rent shows up here, with renewals and receipts.', '<button class="pg-btn ghost" data-pg-ws-market>Browse the store</button>');
    return h.page(h.head({ eyebrow: '<a data-go="market">Marketplace</a>', title: view, sub: rent ? 'Agents you rent — what each has used, its limit, and your memory with it.' : 'Everything you bought, subscribe to or added — receipts, renewals and refunds.' }) + `<div class="pg-body">${body}</div>` + h.foot('market', 'GET /api/marketplace/entitlements'));
  }

  // ---------- Seller console ----------
  function consolePage() {
    const h = P(), S = seller(), mine = L().filter((x) => x.seller === 'You'), e = earnings(S);
    const kyb = { none: ['Not verified', 'Verify your company to receive payouts. Earnings keep accruing meanwhile.', h.btn('Start verification', 'data-mk="kyb"', false, 'check')], pending: ['Checking', 'We’re checking your company details. This usually takes one to three days.', ''], verified: ['Verified', 'Payouts go to the bank account on file.', ''] }[S.kyb];
    const checks = (x) => (x.checks || ['Manifest is valid', 'Signature matches', 'Declares what it can do', 'No native code (community listings)', 'Runs in the sandbox']).map((c, i) => `<li class="${x.review === 'rejected' && i === 3 ? 'bad' : x.review === 'in review' && i > 2 ? 'wait' : 'ok'}">${ic(x.review === 'rejected' && i === 3 ? 'x' : x.review === 'in review' && i > 2 ? 'clock' : 'check')}${esc(c)}</li>`).join('');
    const lst = mine.map((x) => { const sold = S.sales.filter((s) => s.listing === x.id); return `<li class="mk-sl"><div class="mk-row"><a data-mk="open" data-arg="${x.id}"><b>${esc(x.name)}</b></a>${h.chip(x.review === 'live' ? 'Live' : x.review === 'rejected' ? 'Changes needed' : 'In review')}<span class="pg-dim">${esc(x.price)}</span></div>
      ${x.review === 'live' ? `<p class="pg-dim">${sold.length} sales · ${eur(sold.reduce((n, s) => n + s.gross, 0))} gross</p>` : `<ul class="mk-checks">${checks(x)}</ul>`}
      ${x.kind === 'mind' && /Rent/.test(x.price) ? `<div class="mk-part">${ic('lock')}<span><b>What renters’ runs may use</b> — ${(x.soul?.items || []).filter((s) => s.scope === 'public').length} of ${(x.soul?.items || []).length} memories and skills are shared; the rest stay private.</span>${h.btn('Review', `data-mk="soul" data-arg="${x.id}"`, true)}</div>` : ''}
      <div class="fd-acts">${x.review === 'rejected' ? h.btn('Fix and resubmit', `data-mk="resubmit" data-arg="${x.id}"`, false) : ''}${x.review === 'live' ? h.btn(x.paused ? 'List again' : 'Unlist', `data-mk="unlist" data-arg="${x.id}"`, true) : ''}</div></li>`; }).join('');
    return h.page(h.head({ eyebrow: '<a data-go="market">Marketplace</a> · Seller console', title: 'Seller console', sub: 'Sell apps, agents and blueprints to every XENO workspace.' })
      + `<div class="fd-sums mk-4">${[['Earned', e.gross - e.fee, `${eur(e.gross)} sales − ${eur(e.fee)} fee`], ['On hold', e.held, `${HOLD_DAYS} days, for refunds`], ['Ready to pay out', e.avail, ''], ['Paid out', e.paid, '']].map(([k, v, s]) => `<div class="fd-sum"><small>${k}</small><b>${eur(v)}</b>${s ? `<span>${s}</span>` : ''}</div>`).join('')}</div>
      <section class="pg-sec"><h3>Payouts</h3><div class="mk-kyb"><span>${h.chip(kyb[0])}</span><p>${kyb[1]}</p>${kyb[2]}${S.kyb === 'verified' && e.avail > 0 ? h.btn(`Pay out ${eur(e.avail)}`, 'data-mk="payout"', false) : ''}</div>
        ${S.payouts.length ? `<ul class="mk-rcl">${S.payouts.map((p) => `<li><span>${day(p.at)}</span><span>${p.state === 'sent' ? 'Sent to bank' : 'On its way'}</span><b>${eur(p.amt)}</b></li>`).join('')}</ul>` : ''}
        <p class="pg-dim wf-note">XENO keeps 20% of each sale (nothing on its own listings). Money from a sale is held ${HOLD_DAYS} days in case of a refund, then becomes ready to pay out.</p></section>
      <section class="pg-sec"><div class="mk-row"><h3>Your listings</h3>${h.btn('Create a listing', 'data-xa="newListing"', true, 'plus')}</div><ul class="mk-sls">${lst || '<li class="pg-dim">Nothing listed yet.</li>'}</ul></section>
      ${S.sales.length ? `<section class="pg-sec"><h3>Recent sales</h3><ul class="mk-rcl">${S.sales.slice(0, 6).map((s) => `<li><span>${day(s.at)}</span><span>${esc(s.who)} · ${esc(byId(s.listing)?.name || '')}</span><b>${eur(s.gross * (1 - FEE(byId(s.listing) || {})))}</b></li>`).join('')}</ul></section>` : ''}`
      + h.foot('market', 'GET /api/marketplace/seller'));
  }

  function route(view) {
    if (view === 'Seller console') return consolePage();
    if (view === 'Purchases' || view === 'Rentals') return owned(view);
    const x = view && byName(view); return x ? listingPage(x) : null;
  }

  // ---------- actions ----------
  const go = (x) => X().go('global', { global: 'market', item: x.name });
  const done = (msg) => { X().render(); if (msg) X().toast(msg); };
  const ACT = {
    open(id) { const x = byId(id); if (x) go(x); },
    console() { X().go('global', { global: 'market', item: 'Seller console' }); },
    async review(id) { const x = byId(id), R = reviews(x), mine = R.find((r) => r.who === 'You');
      const v = await D().form({ title: mine ? 'Edit your review' : `Review ${x.name}`, submit: 'Post review', size: 'sm', fields: [{ id: 's', label: 'Rating', type: 'seg', value: String(mine?.stars || 5), options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] }, { id: 't', label: 'What you think', type: 'textarea', rows: 3, required: true, value: mine?.text || '', max: 600 }] });
      if (!v) return; if (mine) Object.assign(mine, { stars: +v.s, text: v.t, at: now() }); else R.unshift({ id: 'rv' + rid(), who: 'You', stars: +v.s, text: v.t, at: now(), reply: '' }); setReviews(x, R); done('Review posted'); },
    async reply(arg) { const [id, rv] = arg.split('|'), x = byId(id), R = reviews(x), r = R.find((y) => y.id === rv); const v = await D().form({ title: `Reply to ${r.who}`, sub: 'One public reply per review.', submit: 'Reply', size: 'sm', fields: [{ id: 't', label: 'Reply', type: 'textarea', rows: 3, required: true, max: 400 }] }); if (!v) return; r.reply = v.t; setReviews(x, R); done('Reply posted'); },
    async report(id) { const x = byId(id); const v = await D().form({ title: `Report ${x.name}`, sub: 'Goes to Marketplace moderation. The seller isn’t told who reported it.', submit: 'Send report', size: 'sm', fields: [{ id: 'r', label: 'Why', type: 'choice', cols: 1, required: true, options: [['harm', 'It does something harmful or hidden'], ['ip', 'It copies someone else’s work'], ['broken', 'It doesn’t do what it says'], ['other', 'Something else']] }, { id: 'n', label: 'Details', type: 'textarea', rows: 2 }] }); if (!v) return; const Rp = LS.get('mkReports', []); Rp.push({ id: x.id, why: v.r, at: now() }); LS.set('mkReports', Rp); X().toast('Report sent — you’ll hear back in your inbox'); },
    async cap(id) { const E = ents(), e = E[id]; const v = await D().form({ title: 'Monthly limit', sub: `${cr(e.spent)} used this month.`, submit: 'Save', size: 'sm', fields: [{ id: 'c', label: 'Credits', type: 'number', required: true, value: String(e.cap), validate: (n) => (!/^\d+$/.test(n) ? 'A whole number.' : +n < e.spent ? `At least what’s used (${e.spent}).` : null) }] }); if (!v) return; e.cap = +v.c; setEnts(E); done(`Limit is ${cr(e.cap)} a month`); },
    async cancel(id) { const E = ents(), e = E[id], x = byId(id); if (!await D().confirm({ title: `Cancel ${x.name}?`, body: `It stays yours until ${day(e.renews)} — you already paid for this month. It won’t renew after that.`, action: 'Cancel subscription' })) return; e.state = 'cancelled'; setEnts(E); done(`Cancelled — yours until ${day(e.renews)}`); },
    resume(id) { const E = ents(); E[id].state = 'active'; setEnts(E); done('It will renew again'); },
    async endRent(id) { const E = ents(), e = E[id], x = byId(id); if (!await D().confirm({ title: `Stop renting ${x.name}?`, body: `Running tasks finish; nothing new starts. ${e.partition ? `Your memory with it is kept for 30 days so you can export it, then deleted.` : ''}`, action: 'Stop renting' })) return; e.state = 'ended'; e.endedAt = now(); byId(id).owned = false; saveDb(); setEnts(E); done('Rental ended'); },
    async refund(id) { const E = ents(), e = E[id], x = byId(id); if (!refundable(e)) return X().toast('Not refundable any more'); if (!await D().confirm({ title: `Refund ${x.name}?`, body: `You get ${e.receipts[0].amt} back to the card you paid with, and it’s removed from your workspace.`, action: 'Refund', danger: false })) return; e.state = 'refunded'; e.receipts.push({ at: now(), what: 'Refund', amt: '−' + e.receipts[0].amt }); x.owned = false; saveDb(); setEnts(E); done('Refunded'); },
    async remove(id) { const E = ents(), x = byId(id); if (!await D().confirm({ title: `Remove ${x.name}?`, body: 'You can add it again any time.', action: 'Remove' })) return; E[id].state = 'ended'; x.owned = false; saveDb(); setEnts(E); done('Removed'); },
    exportPart(id) { const e = ents()[id], x = byId(id); const blob = new Blob([JSON.stringify({ agent: x.name, memories: e.partition.memories, exportedAt: new Date().toISOString(), format: 'xanima-partition@1' }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${x.name.split(' — ')[0]}-my-memory.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); X().toast('Your memory is downloading'); },
    async deletePart(id) { const E = ents(), x = byId(id); if (!await D().confirm({ title: 'Delete your memory with it?', body: `${x.name.split(' — ')[0]} forgets everything about your work. This can’t be undone.`, action: 'Delete memory' })) return; E[id].partition = { memories: 0, at: now() }; setEnts(E); done('Deleted — it starts fresh with you'); },
    async soul(id) { const x = byId(id), items = x.soul.items;
      const v = await D().form({ title: 'What renters’ runs may use', sub: 'Private items are never loaded when it works for a renter. New memories start private.', submit: 'Save and sign', fields: items.map((s) => ({ id: s.id, label: `${s.t}  ·  ${s.kind}`, type: 'seg', value: s.scope, options: [['private', 'Private'], ['public', 'Shared']] })) });
      if (!v) return; items.forEach((s) => (s.scope = v[s.id])); x.soul.reviewed = true; x.soul.signedAt = now(); saveDb(); done(`${items.filter((s) => s.scope === 'public').length} shared, ${items.filter((s) => s.scope === 'private').length} private — signed`); },
    async kyb() { const v = await D().form({ title: 'Verify your company', sub: 'Needed before payouts. Your earnings keep accruing meanwhile.', submit: 'Submit for checking', fields: [{ id: 'n', label: 'Legal name', required: true }, { id: 'c', label: 'Country', type: 'choice', cols: 2, required: true, options: [['AE', 'United Arab Emirates'], ['RO', 'Romania'], ['US', 'United States'], ['GB', 'United Kingdom']] }, { id: 'r', label: 'Registration number', required: true }] });
      if (!v) return; const S = seller(); S.kyb = 'pending'; LS.set('mkSeller', S); done('Submitted — usually checked within three days');
      setTimeout(() => { const S2 = seller(); if (S2.kyb === 'pending') { S2.kyb = 'verified'; LS.set('mkSeller', S2); done('Your company is verified — payouts are on'); } }, 2500); },
    async payout() { const S = seller(), e = earnings(S); if (S.kyb !== 'verified' || e.avail <= 0) return; if (!await D().confirm({ title: `Pay out ${eur(e.avail)}?`, body: 'Sent to the bank account on file. Arrives in two to five working days.', action: 'Pay out', danger: false })) return; S.payouts.unshift({ at: now(), amt: e.avail, state: 'pending' }); LS.set('mkSeller', S); done(`${eur(e.avail)} is on its way`); },
    async resubmit(id) { const x = byId(id); x.review = 'in review'; saveDb(); done('Resubmitted'); setTimeout(() => { x.review = 'live'; x.publishedAt = now(); saveDb(); done(`“${x.name}” is live`); }, 2500); },
    unlist(id) { const x = byId(id); x.paused = !x.paused; saveDb(); done(x.paused ? 'Unlisted — people who have it keep it' : 'Listed again'); },
  };
  // a new submission moves through the checks: community + native code is refused server-side (D1)
  window.addEventListener('xw:listing-submitted', (e) => { const x = byId(e.detail); if (!x) return; setTimeout(() => { x.review = x.kind === 'plugin' ? 'rejected' : 'live'; x.publishedAt = now(); saveDb(); X().render(); X().toast(x.review === 'live' ? `“${x.name}” passed review and is live` : `“${x.name}” needs changes — see Seller console`); }, 3000); });
  // using something ends its no-questions refund window
  window.addEventListener('xw:listing-opened', (e) => { const E = ents(); if (E[e.detail]) { E[e.detail].used = true; setEnts(E); } });
  function entitle(id, cap) { const E = ents(), x = byId(id); E[id] = mkEnt(x, now(), false, cap || 500); if (model(x) === 'per_use') { E[id].spent = 0; E[id].receipts = []; if (x.kind === 'mind') E[id].partition = { memories: 0, at: now() }; } setEnts(E); }
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-mk]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); ACT[t.dataset.mk]?.(t.dataset.arg); }, true);
  window.XENO_MARKET = { route, entitle, ents, model };
})();
