/* platform-stock.js — Studio › Libraries › Stock (XENO Stock), on /api/stock (services/stock.js).
 *
 *   /workspace/studio/spaces/libraries/stock              search: the catalogue, what you generated, and Generate with the same words
 *   /workspace/studio/spaces/libraries/stock/saved        what this workspace saved
 *   /workspace/studio/spaces/libraries/stock/<item id>    one item: its licence, who states it, a credit line, Save to Library
 *
 * platform-assets.js owns the area and hands these addresses to XENO_STOCK.body(). The second half of Stock is XENO's own Generate: this page
 * opens it with the words, and generating stays a person's choice on that page, at its own price.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const COLS = [['', 'All'], ['photo', 'Photos'], ['art', 'Art'], ['video', 'Video']];
  const S = { q: '', collection: '', key: null, status: 'idle', error: null, items: [], total: 0, mine: [], saved: null, savedKey: null, item: null, itemId: null, itemStatus: 'idle', busy: false };
  let seq = 0;

  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const withWs = (b) => { const w = wsId(); return { ...(b || {}), ...(w ? { workspace: w } : {}) }; };
  const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const sub = () => String((X()?.S || {}).item || '').replace(/^stock\/?/, '');
  const goto = (it) => X()?.go?.('zone', { zone: 'libraries', item: it });
  // a repaint replaces the search box, and an answer can arrive while someone is typing in it
  const paint = () => {
    const a = document.activeElement, typing = a && a.matches?.('[data-st-q]') ? a.selectionStart : null;
    try { const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'libraries') X().render(); } catch {}
    if (typing !== null) { const i = document.querySelector('#main [data-st-q]'); if (i) { i.focus(); i.setSelectionRange(typing, typing); } }
  };
  const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
  const label = (it) => { const s = String(it).replace(/^stock\/?/, ''); return !s ? 'Stock' : s === 'saved' ? 'Stock · Saved' : S.item?.id === s ? `Stock · ${S.item.title}` : 'Stock · Item'; };

  async function load(offset = 0) {
    const mine = ++seq, more = offset > 0;
    S.key = JSON.stringify([S.q, S.collection]);
    if (!more) S.status = 'loading';
    S.error = null;
    const r = await api('GET', '/api/stock/search' + qs({ q: S.q, collection: S.collection, offset: offset || '' })).catch(() => null);
    if (mine !== seq) return;
    if (!r || !r.ok) { S.status = 'error'; S.error = said(r, 'Stock couldn’t be reached.'); return paint(); }
    S.items = more ? [...S.items, ...r.d.items] : r.d.items; S.total = r.d.total; S.status = 'ready';
    paint();
    if (!more) loadMine(mine);
  }
  /** What the person already generated with these words. A failure here just leaves the row out: Stock's own results are the page. */
  async function loadMine(mine) {
    const words = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { S.mine = []; return; }
    const r = await api('GET', '/api/generations?type=image').catch(() => null);
    if (mine !== seq) return;
    if (!r || !r.ok || !Array.isArray(r.d?.generations)) { S.mine = []; return paint(); }
    S.mine = r.d.generations.filter((g) => g.state === 'succeeded' && (g.resultAssetIds || []).length && words.every((w) => String(g.request?.prompt || '').toLowerCase().includes(w))).slice(0, 8);
    paint();
  }
  async function loadSaved() {
    S.savedKey = wsId() || 'personal'; S.saved = null;
    const r = await api('GET', '/api/stock/saved' + qs({ workspace: wsId() })).catch(() => null);
    S.saved = r && r.ok ? r.d.saved : false; paint();
  }
  async function loadItem(id) {
    S.itemId = id; S.item = null; S.itemStatus = 'loading';
    const r = await api('GET', `/api/stock/items/${encodeURIComponent(id)}`).catch(() => null);
    if (S.itemId !== id) return;
    if (r && r.ok) { S.item = r.d.item; S.itemStatus = 'ready'; } else { S.itemStatus = 'error'; S.error = said(r, 'That couldn’t be loaded.'); }
    paint();
  }

  const card = (c) => `<a class="st-card" href="#" data-st-open="${esc(c.id)}" aria-label="${esc(c.title)}"><span class="st-img"><img src="${esc(c.previewUrl)}" alt="" loading="lazy">${c.kind === 'video' ? '<span class="st-play" aria-hidden="true">▶</span>' : ''}</span><b>${esc(c.title)}</b><small>${esc(c.creator)}</small></a>`;
  const tabs = (on) => `<div class="sc-actions"><button class="btn ghost${on === 'search' ? ' on' : ''}" data-st-tab="">Search</button><button class="btn ghost${on === 'saved' ? ' on' : ''}" data-st-tab="saved">Saved here</button></div>`;
  function searchView() {
    const h = H();
    if (S.key !== JSON.stringify([S.q, S.collection]) || S.status === 'idle') { if (S.status !== 'loading') load(); }
    const bar = `<div class="st-bar"><input class="in" data-st-q value="${esc(S.q)}" placeholder="Search photos, art and video" aria-label="Search Stock"><div class="ft-cats">${COLS.map(([v, l]) => `<button class="btn ghost${S.collection === v ? ' on' : ''}" data-st-col="${esc(v)}" aria-pressed="${S.collection === v}">${esc(l)}</button>`).join('')}</div></div>`;
    const gen = S.q.trim() ? `<div class="st-gen"><span>Want one made for you instead?</span>${h.btn(`Generate “${esc(S.q.trim().slice(0, 40))}”`, 'data-st-generate', true, 'spark')}</div>` : '';
    const mine = S.mine.length ? `<section class="bk-group"><h3>Made by you</h3><p class="pg-dim">Images you generated with these words. They stay yours and aren’t in Stock for anyone else.</p><div class="st-grid">${S.mine.map((g) => `<a class="st-card" href="/workspace/studio/generate/image/g/${esc(g.id)}"><span class="st-img"><img src="/api/library/assets/${esc(g.resultAssetIds[0])}/content?variant=thumbnail" alt="" loading="lazy"></span><small>${esc(String(g.request?.prompt || '').slice(0, 60))}</small></a>`).join('')}</div></section>` : '';
    let body;
    if (S.status === 'loading') body = h.box('refresh', 'Searching', '', '', 'sm');
    else if (S.status === 'error') body = h.box('x', 'Stock couldn’t be loaded', esc(S.error), h.btn('Try again', 'data-st-reload', true), 'sm');
    else if (!S.items.length) body = h.box('search', S.q.trim() ? 'Nothing in Stock matches' : 'Nothing here', S.q.trim() ? 'Try fewer words, or generate one.' : '', '', 'sm');
    else body = `<p class="pg-dim" data-st-count>${S.total} free of copyright (CC0)</p><div class="st-grid" data-st-list>${S.items.map(card).join('')}</div>${S.items.length < S.total ? `<div class="st-more">${h.btn('Show more', 'data-st-more', true)}</div>` : ''}`;
    return `${tabs('search')}${bar}${gen}${mine}${body}`;
  }
  function savedView() {
    const h = H();
    if (S.savedKey !== (wsId() || 'personal')) { loadSaved(); return `${tabs('saved')}${h.box('refresh', 'Loading', '', '', 'sm')}`; }
    if (S.saved === null) return `${tabs('saved')}${h.box('refresh', 'Loading', '', '', 'sm')}`;
    if (S.saved === false) return `${tabs('saved')}${h.box('x', 'What’s saved couldn’t be loaded', '', h.btn('Try again', 'data-st-resaved', true), 'sm')}`;
    if (!S.saved.length) return `${tabs('saved')}${h.box('lib', 'Nothing saved here yet', 'Save an item and it’s in this workspace’s Library for your apps and agents.', '', 'sm')}`;
    return `${tabs('saved')}<div class="st-grid">${S.saved.map(card).join('')}</div>`;
  }
  function itemView(id) {
    const h = H();
    if (S.itemId !== id) { loadItem(id); return h.box('refresh', 'Loading', '', '', 'sm'); }
    if (S.itemStatus === 'loading') return h.box('refresh', 'Loading', '', '', 'sm');
    if (S.itemStatus === 'error' || !S.item) return `${h.box('x', 'That isn’t in Stock', esc(S.error || ''), h.btn('Back to Stock', 'data-st-tab=""', true), 'sm')}`;
    const c = S.item;
    const media = c.kind === 'video' ? `<video controls preload="none" poster="${esc(c.previewUrl)}" src="${esc(c.fullUrl)}"></video>` : `<img src="${esc(c.previewUrl)}" alt="${esc(c.title)}">`;
    const facts = [['By', esc(c.creator)], ['Size', `${c.width} × ${c.height} · ${size(c.bytes)}`], ...(c.duration ? [['Length', `${c.duration} s`]] : []), ['Licence', `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">CC0 (public domain dedication)</a>`], ['Source', `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.sourceName)}</a>`], ['Checked', esc(c.checkedAt)]];
    return `<div class="st-item" data-st-item="${esc(c.id)}"><div class="st-media">${media}</div><div class="st-side"><h3>${esc(c.title)}</h3>
      <div class="st-acts">${h.btn(S.busy ? 'Saving…' : 'Save to Library', `data-st-save="${esc(c.id)}"${S.busy ? ' disabled' : ''}`, false, 'plus')}<a class="btn ghost" href="${esc(c.fullUrl)}" target="_blank" rel="noopener">Open full size</a></div>
      <dl class="st-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="pg-dim" data-st-rights>${esc(c.rights)}</p>
      <p class="st-credit"><small>Credit, if you’d like to give one</small><span data-st-credit>${esc(c.credit)}</span></p></div></div>`;
  }
  /** The body of the Stock tab; platform-assets.js draws the page around it. */
  function body() {
    const s = sub();
    return `<div class="st" data-st-page="${esc(s || 'search')}">${s === 'saved' ? savedView() : s ? itemView(s) : searchView()}</div>`;
  }

  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t.closest?.('#main [data-st-page]') || !('stQ' in t.dataset)) return;
    S.q = t.value; clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('#main [data-st-open],#main [data-st-tab],#main [data-st-col],#main [data-st-reload],#main [data-st-more],#main [data-st-generate],#main [data-st-save],#main [data-st-resaved]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset;
    if (d.stOpen) return goto(`stock/${d.stOpen}`);
    if ('stTab' in d) { if (d.stTab === 'saved') S.savedKey = null; return goto(d.stTab ? `stock/${d.stTab}` : 'stock'); }
    if ('stCol' in d) { S.collection = d.stCol; return load(); }
    if ('stReload' in d) return load();
    if ('stResaved' in d) return loadSaved();
    if ('stMore' in d) return load(S.items.length);
    if ('stGenerate' in d) { window.location.assign(`/workspace/studio/generate/image?prompt=${encodeURIComponent(S.q.trim().slice(0, 500))}`); return; }
    if (d.stSave) {
      if (S.busy) return;
      S.busy = true; paint();
      const r = await api('POST', '/api/stock/saved', withWs({ id: d.stSave })).catch(() => null);
      S.busy = false; S.savedKey = null; paint();
      return toast(r && r.ok ? (r.d.already ? 'It’s already in this workspace’s Library' : 'Saved to this workspace’s Library') : said(r, 'It couldn’t be saved.'));
    }
  }, true);
  window.XENO_STOCK = { served: true, body, label };
})();
