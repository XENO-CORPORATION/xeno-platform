/* platform-fonts.js — Studio › Libraries › Fonts (XENO Fonts), on /api/fonts (services/fonts.js).
 *
 *   /workspace/studio/spaces/libraries/fonts              this workspace's fonts · Upload a font
 *   /workspace/studio/spaces/libraries/fonts/catalogue    the open-licence catalogue, set in the fonts themselves, with pairings
 *
 * platform-assets.js owns the area and hands these addresses to XENO_FONTS.page(). An upload means saying you have the rights to the
 * font, so it asks first, and the server also reads what the font's own licence bits say.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const CATS = [['', 'All'], ['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Mono'], ['display', 'Display'], ['handwriting', 'Handwriting']];
  const S = { status: 'idle', ws: undefined, mine: null, cat: null, q: '', category: '', error: null, faces: new Set(), sample: 'The quick brown fox jumps over the lazy dog' };

  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const view = () => (String((X()?.S || {}).item || '') === 'fonts/catalogue' ? 'catalogue' : 'mine');
  const goto = (it) => X()?.go?.('zone', { zone: 'libraries', item: it || null });
  const paint = () => { try { const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'libraries') X().render(); } catch {} };

  // load only the regular weight of what's on screen, so a specimen shows without fetching forty families
  function loadFaces(ids) {
    const need = ids.filter((id) => !S.faces.has(id));
    if (!need.length) return;
    need.forEach((id) => S.faces.add(id));
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `/api/fonts/face.css?ids=${encodeURIComponent(need.join(','))}&weights=400`; document.head.appendChild(l);
  }
  const uploadFace = (u) => { const id = `xf-up-${u.id}`; if (document.getElementById(id)) return; const st = document.createElement('style'); st.id = id; st.textContent = `@font-face{font-family:"xf-${u.id}";src:url("${u.contentUrl}");font-weight:${Number(u.weight) || 400};font-style:${u.italic ? 'italic' : 'normal'}}`; document.head.appendChild(st); };
  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const [m, c] = await Promise.all([api('GET', '/api/fonts' + q()).catch(() => null), api('GET', '/api/fonts/catalogue').catch(() => null)]);
    if (!m || !m.ok) { S.status = 'error'; S.error = said(m, 'Fonts couldn’t be reached.'); return paint(); }
    S.mine = m.d; S.cat = c && c.ok ? c.d.families : []; S.status = 'ready'; paint();
  }

  const specimen = (family, face = family) => `<div class="ft-spec" style="font-family:'${esc(face).replace(/'/g, '')}',var(--font-sans,sans-serif)">${esc(S.sample)}</div>`;
  const added = (id) => (S.mine?.catalogue || []).some((f) => f.id === id);
  function mineView() {
    const h = H(), { catalogue: fams, uploads } = S.mine;
    if (!fams.length && !uploads.length) return h.box('type', 'No fonts in this workspace yet', 'Add open-licence fonts from the catalogue, or upload your own.', h.btn('Open the catalogue', 'data-ft-tab="catalogue"', false));
    loadFaces(fams.map((f) => f.id)); uploads.forEach(uploadFace);
    const groups = [...new Set(uploads.map((u) => u.family))];
    return `${fams.length ? `<section class="bk-group"><h3>From the catalogue</h3><div class="ft-grid">${fams.map((f) => `<article class="ft-card" data-ft-mine="${esc(f.id)}"><header><b>${esc(f.family)}</b><small>${esc(f.license.type)}${f.agentAdded ? ' · added by an agent' : ''}</small></header>${specimen(f.family)}
      ${f.pairsWith.length ? `<small class="ft-pairs">Pairs with ${f.pairsWith.slice(0, 3).map((p) => esc(p.family)).join(', ')}</small>` : ''}<div>${h.btn('Remove', `data-ft-remove="${esc(f.id)}"`, true)}</div></article>`).join('')}</div></section>` : ''}
      ${uploads.length ? `<section class="bk-group"><h3>Uploaded</h3><p class="pg-dim">Private to this workspace.</p><div class="ft-grid">${groups.map((g) => { const list = uploads.filter((u) => u.family === g), first = list[0]; return `<article class="ft-card" data-ft-upload="${esc(g)}"><header><b>${esc(g)}</b><small>${list.length} style${list.length === 1 ? '' : 's'}</small></header>${specimen(g, `xf-${first.id}`)}
        <small class="ft-pairs">Rights confirmed${first.rightsConfirmedBy ? ` by ${esc(first.rightsConfirmedBy)}` : ''}</small><div class="ft-styles">${list.map((u) => `<span>${esc(u.style)} ${h.btn('Remove', `data-ft-unup="${esc(u.id)}"`, true)}</span>`).join('')}</div></article>`; }).join('')}</div></section>` : ''}`;
  }
  function catalogueView() {
    const h = H(), needle = S.q.trim().toLowerCase();
    const list = (S.cat || []).filter((f) => (!needle || f.family.toLowerCase().includes(needle)) && (!S.category || f.category === S.category));
    loadFaces(list.slice(0, 40).map((f) => f.id));
    return `<div class="ft-bar"><input class="in" data-ft-q value="${esc(S.q)}" placeholder="Search fonts" aria-label="Search fonts"><input class="in ft-sample" data-ft-sample value="${esc(S.sample)}" aria-label="Sample text" maxlength="120">
      <div class="ft-cats">${CATS.map(([v, l]) => `<button class="btn ghost${S.category === v ? ' on' : ''}" data-ft-cat="${esc(v)}" aria-pressed="${S.category === v}">${esc(l)}</button>`).join('')}</div></div>
      ${list.length ? `<div class="ft-grid" data-ft-list>${list.map((f) => `<article class="ft-card" data-ft-family="${esc(f.id)}"><header><b>${esc(f.family)}</b><small>${esc(f.license.type)} · ${f.weights.length} weight${f.weights.length === 1 ? '' : 's'}</small></header>${specimen(f.family)}
        ${f.pairsWith.length ? `<small class="ft-pairs">Pairs with ${f.pairsWith.slice(0, 3).map((p) => esc(p.family)).join(', ')}</small>` : ''}<div class="ft-row"><a class="btn ghost" href="${esc(f.licenseUrl)}" target="_blank" rel="noopener">Licence</a>${added(f.id) ? '<small data-ft-added>In this workspace</small>' : h.btn('Add', `data-ft-add="${esc(f.id)}"`, true, 'plus')}</div></article>`).join('')}</div>` : h.box('search', 'No fonts match', 'Try a shorter word or another category.', '', 'sm')}`;
  }
  /** The body of the Fonts tab; platform-assets.js draws the page around it. */
  function body() {
    const h = H();
    if (S.status === 'idle' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return h.box('refresh', 'Loading fonts', '', '', 'sm'); }
    if (S.status === 'loading') return h.box('refresh', 'Loading fonts', '', '', 'sm');
    if (S.status === 'error') return h.box('x', 'Fonts couldn’t be loaded', esc(S.error), h.btn('Try again', 'data-ft-reload', true), 'sm');
    const sub = view();
    return `<div class="ft" data-ft-page="${esc(sub)}"><div class="sc-actions"><button class="btn ghost${sub === 'mine' ? ' on' : ''}" data-ft-tab="mine">In this workspace</button><button class="btn ghost${sub === 'catalogue' ? ' on' : ''}" data-ft-tab="catalogue">Catalogue</button>${h.btn('Upload a font', 'data-ft-upload-btn', true, 'plus')}</div>${sub === 'catalogue' ? catalogueView() : mineView()}</div>`;
  }

  async function uploadFile(file) {
    const yes = await D().confirm({ title: 'Do you have the rights to this font?', body: `${esc(file.name)} stays private to this workspace. XENO records that you confirmed the rights. If the font’s own licence forbids embedding, it’s refused.`, action: 'I have the rights', danger: false });
    if (!yes) return;
    const form = new FormData(); form.append('font', file); form.append('rightsConfirmed', 'true'); if (S.ws) form.append('workspace', S.ws);
    let r, d = null;
    try { r = await fetch('/api/fonts/uploads', { method: 'POST', credentials: 'same-origin', body: form }); d = await r.json().catch(() => null); } catch { /* reported below */ }
    if (!r || !r.ok) return toast((d && d.error) || 'The font couldn’t be uploaded.');
    toast(`${d.upload.family} uploaded`); load();
  }
  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t.closest?.('#main [data-ft-page]')) return;
    if ('ftSample' in t.dataset) { S.sample = t.value || ' '; document.querySelectorAll('#main .ft-spec').forEach((n) => { n.textContent = S.sample; }); return; }
    if ('ftQ' in t.dataset) { S.q = t.value; clearTimeout(timer); timer = setTimeout(() => { paint(); const i = document.querySelector('#main [data-ft-q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); }
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('#main [data-ft-reload],#main [data-ft-tab],#main [data-ft-cat],#main [data-ft-add],#main [data-ft-remove],#main [data-ft-unup],#main [data-ft-upload-btn]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset;
    if ('ftReload' in d) return load();
    if (d.ftTab) return goto(d.ftTab === 'catalogue' ? 'fonts/catalogue' : 'fonts');
    if ('ftCat' in d) { S.category = d.ftCat; return paint(); }
    if (d.ftAdd) { const r = await api('POST', '/api/fonts/families', withWs({ family: d.ftAdd })).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be added.')); toast('Added to this workspace'); return load(); }
    if (d.ftRemove) { const r = await api('DELETE', `/api/fonts/families/${encodeURIComponent(d.ftRemove)}` + q()).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.')); toast('Removed'); return load(); }
    if (d.ftUnup) { const r = await api('DELETE', `/api/fonts/uploads/${encodeURIComponent(d.ftUnup)}` + q()).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.')); toast('Removed. The file is still in your Library.'); return load(); }
    if ('ftUploadBtn' in d) { const i = document.createElement('input'); i.type = 'file'; i.accept = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf'; i.onchange = () => { if (i.files?.[0]) uploadFile(i.files[0]); }; i.click(); }
  }, true);
  window.XENO_FONTS = { served: true, body, reload: load, uploadFile };
})();
