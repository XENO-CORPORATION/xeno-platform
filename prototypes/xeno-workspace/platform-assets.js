/* platform-assets.js — Studio › Libraries: a workspace's brand kits (XENO Assets), on /api/brand-kits (services/brandKits.js).
 *
 *   kits       /workspace/studio/spaces/libraries                     every kit · New brand kit
 *   tokens     /workspace/studio/spaces/libraries/<id>                colors, sizes, type: the draft, saved as you change it
 *   brand      /workspace/studio/spaces/libraries/<id>/brand          logos and voice
 *   versions   /workspace/studio/spaces/libraries/<id>/versions       what was published; export any of them
 *
 * Publishing reaches everything that follows the kit, so it asks first. A logo is a file in this workspace's Library.
 * It registers XENO_ZONE_LIVE['studio.libraries'].
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const KINDS = [['color', 'Color'], ['number', 'Size or number'], ['typography', 'Type style'], ['shadow', 'Shadow'], ['string', 'Text'], ['alias', 'Alias of another token']];
  const FORMATS = [['dtcg', 'Design Tokens (W3C)'], ['css', 'CSS variables'], ['tailwind', 'Tailwind theme'], ['canvas', 'XENO Canvas tokens']];
  const GROUPS = { color: 'Colors', number: 'Sizes', typography: 'Type', shadow: 'Shadows', string: 'Text', alias: 'Aliases' };
  const S = { status: 'idle', ws: undefined, kits: [], kit: null, versions: null, error: null, loadedFor: null, undo: null, save: '' };

  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = (extra = {}) => { const p = new URLSearchParams(); if (S.ws) p.set('workspace', S.ws); for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const item = () => { const s = X()?.S; return s && s.view === 'zone' && s.zone === 'libraries' ? (s.item || '') : ''; };
  const route = () => { if (/^fonts(\/|$)/.test(item())) return { view: 'fonts' }; if (/^stock(\/|$)/.test(item())) return { view: 'stock' }; const m = item().match(/^([0-9a-f-]{36})(?:\/(brand|versions))?$/i); return m ? { view: m[2] || 'tokens', id: m[1] } : { view: 'list' }; };
  const goto = (it) => X()?.go?.('zone', { zone: 'libraries', item: it || null });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'libraries') X().render(); } catch {} };
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const K = (id, tail = '') => `/api/brand-kits/${encodeURIComponent(id)}${tail}`;

  async function load() {
    const r0 = route(), key = JSON.stringify([wsId(), r0]);
    S.ws = wsId(); S.status = 'loading'; S.error = null; S.loadedFor = key;
    if (r0.view === 'list') {
      const l = await api('GET', '/api/brand-kits' + q()).catch(() => null);
      if (S.loadedFor !== key) return;
      if (!l || !l.ok) { S.status = 'error'; S.error = said(l, 'Brand kits couldn’t be reached.'); return paint(); }
      S.kits = l.d.kits || []; S.status = 'ready'; return paint();
    }
    const [k, v] = await Promise.all([api('GET', K(r0.id) + q()).catch(() => null), r0.view === 'versions' ? api('GET', K(r0.id, '/versions') + q()).catch(() => null) : null]);
    if (S.loadedFor !== key) return;
    if (!k || !k.ok) { S.status = 'error'; S.error = said(k, 'That kit couldn’t be opened.'); return paint(); }
    S.kit = k.d.kit; S.versions = v && v.ok ? v.d.versions : null; S.status = 'ready'; paint();
  }
  const reloadKit = async () => { const k = await api('GET', K(S.kit.id) + q()).catch(() => null); if (k && k.ok) { S.kit = k.d.kit; paint(); } };

  // ─────────────────────────────── drawing
  const valueText = (v) => { switch (v.kind) { case 'number': return `${v.value}${v.unit || ''}`; case 'alias': return `→ ${v.path}`; case 'typography': return `${v.value.fontFamily} ${v.value.fontSize}/${v.value.lineHeight} · ${v.value.fontWeight}`; case 'shadow': return `${v.value.offsetX} ${v.value.offsetY} ${v.value.blur} ${v.value.spread} ${v.value.color}`; default: return v.value; } };
  const resolved = (kit, v) => { let cur = v; const seen = new Set(); while (cur && cur.kind === 'alias' && !seen.has(cur.path)) { seen.add(cur.path); cur = kit.items.find((x) => x.path === cur.path)?.value; } return cur; };
  const swatch = (kit, v) => { const r = resolved(kit, v); return r && r.kind === 'color' ? `<i class="bk-sw" style="background:${esc(r.value)}"></i>` : ''; };
  // color values passed the server's hex check, and esc() guards the attribute regardless
  const editor = (kit, t, mode) => {
    const v = mode ? t.valuesByMode?.[mode] : t.value, attrs = `data-bk-val="${esc(t.path)}"${mode ? ` data-bk-mode="${esc(mode)}"` : ''}`;
    if (!v) return `<button class="btn ghost" ${attrs} data-bk-addmode="1">Add</button>`;
    if (v.kind === 'color') return `<span class="bk-col">${swatch(kit, v)}<input class="in" ${attrs} value="${esc(v.value)}" maxlength="9" aria-label="${esc(t.path)}${mode ? ' ' + esc(mode) : ''}"></span>`;
    if (v.kind === 'number') return `<input class="in bk-num" ${attrs} value="${esc(valueText(v))}" aria-label="${esc(t.path)}${mode ? ' ' + esc(mode) : ''}">`;
    if (v.kind === 'string') return `<input class="in" ${attrs} value="${esc(v.value)}" aria-label="${esc(t.path)}${mode ? ' ' + esc(mode) : ''}">`;
    return `<span class="bk-col">${swatch(kit, v)}<small>${esc(valueText(v))}</small></span>`;
  };
  function tokensView(kit) {
    const h = H(), tokens = kit.items.filter((i) => i.kind !== 'logo');
    if (!tokens.length) return h.box('palette', 'No tokens yet', 'Add your colors, sizes and type, or import a Design Tokens file from Figma or Style Dictionary.', h.btn('Add a token', 'data-bk-add', false, 'plus'));
    const groups = Object.keys(GROUPS).filter((g) => tokens.some((t) => t.kind === g));
    const problems = kit.problems?.length ? `<div class="sc-card bk-problems" data-bk-problems><b>Fix these before publishing</b>${kit.problems.map((p) => `<small><code>${esc(p.path)}</code> ${esc(p.problem)}</small>`).join('')}</div>` : '';
    return problems + groups.map((g) => `<section class="bk-group"><h3>${esc(GROUPS[g])}</h3><div class="bk-rows">${tokens.filter((t) => t.kind === g).map((t) => `<div class="bk-row" data-bk-token="${esc(t.path)}"><span class="bk-path"><code>${esc(t.path)}</code>${t.agentDrafted ? '<small>Proposed by an agent</small>' : ''}</span>
      <span class="bk-vals">${editor(kit, t)}${kit.modes.map((m) => `<span class="bk-mode"><small>${esc(m)}</small>${editor(kit, t, m)}</span>`).join('')}</span>
      <button class="btn ghost" data-bk-del="${esc(t.path)}" aria-label="Remove ${esc(t.path)}">Remove</button></div>`).join('')}</div></section>`).join('');
  }
  function brandView(kit) {
    const h = H(), logos = kit.items.filter((i) => i.kind === 'logo');
    return `<section class="bk-group"><h3>Logos</h3><div class="sc-actions">${h.btn('Add a logo', 'data-bk-addlogo', true, 'plus')}</div>
      ${logos.length ? `<div class="bk-logos">${logos.map((l) => `<figure class="bk-logo" data-bk-logo="${esc(l.path)}"><div class="bk-logo-img"><img src="/api/library/assets/${esc(l.value.fileId)}/content" alt="${esc(l.path)}" loading="lazy"></div><figcaption><code>${esc(l.path.replace(/^logo\./, ''))}</code><small>${esc(l.value.fileName || '')}</small></figcaption><button class="btn ghost" data-bk-del="${esc(l.path)}">Remove</button></figure>`).join('')}</div>` : '<div class="pj-empty">No logos yet. Pick an image from this workspace’s Library.</div>'}</section>
      <section class="bk-group"><h3>Voice</h3><p class="pg-dim">How this brand sounds. Agents read this when they write for you.</p><textarea class="in bk-voice" data-bk-voice rows="8" maxlength="8000" aria-label="Voice">${esc(kit.voice)}</textarea></section>`;
  }
  function versionsView(kit) {
    const h = H(), vs = S.versions || [];
    if (!vs.length) return h.box('clock', 'Nothing published yet', 'Publish the kit to give apps and agents a version that never changes under them.');
    return h.table(['Version', 'Note', 'Items', 'Published', ''], vs.map((v) => h.tr(`data-bk-ver="${v.version}"`, [`<b class="pg-name">v${v.version}</b><small title="${esc(v.digest)}">${esc(v.digest.slice(0, 12))}</small>`, esc(v.note || ''), String(v.items), `<small>${esc(when(v.publishedAt))}${v.publishedBy ? ' · ' + esc(v.publishedBy) : ''}</small>`, FORMATS.map(([f, l]) => `<a class="btn ghost" href="${esc(K(kit.id, '/export') + q({ format: f, version: v.version }))}" data-bk-export="${f}" title="${esc(l)}">${esc(f.toUpperCase())}</a>`).join(' ')])));
  }
  function page() {
    const h = H(), r0 = route(), key = JSON.stringify([wsId(), r0]);
    const wrap = (inner) => h.page(`<div class="bk" data-bk-page="${esc(S.status)}" data-bk-view="${esc(r0.view)}">${inner}</div>`);
    const areaTabs = h.tabs([['kits', 'Brand kits'], ['fonts', 'Fonts'], ['stock', 'Stock']], r0.view === 'fonts' || r0.view === 'stock' ? r0.view : 'kits', 'data-bk-area');
    if (r0.view === 'fonts') return h.page(`<div class="bk">${h.head({ title: 'Libraries' })}${areaTabs}${window.XENO_FONTS.body()}</div>`);
    if (r0.view === 'stock') return h.page(`<div class="bk">${h.head({ title: 'Libraries' })}${areaTabs}${window.XENO_STOCK.body()}</div>`);
    const plain = h.head({ title: 'Libraries', acts: r0.view === 'list' ? h.btn('New brand kit', 'data-bk-new', false, 'plus') : '' }) + (r0.view === 'list' ? areaTabs : '');
    if (S.status === 'loading' || S.loadedFor !== key) { if (S.status !== 'loading' || S.loadedFor !== key) load(); return wrap(plain + h.box('refresh', 'Loading', '', '', 'sm')); }
    if (S.status === 'error') return wrap(plain + h.box('x', 'That couldn’t be loaded', esc(S.error), h.btn('Try again', 'data-bk-reload', true), 'sm'));
    if (r0.view === 'list') {
      const undo = S.undo ? `<div class="sc-undo" data-bk-undone>“${esc(S.undo.name)}” was deleted. ${h.btn('Undo', `data-bk-restore="${esc(S.undo.id)}"`, true)}</div>` : '';
      if (!S.kits.length) return wrap(plain + undo + h.box('palette', 'No brand kits yet', 'Make one, publish it, and every app and agent in this workspace can stay on brand.', h.btn('New brand kit', 'data-bk-new', false, 'plus')));
      return wrap(plain + undo + h.table(['Kit', 'Items', 'Published', 'Updated'], S.kits.map((k) => h.tr(`data-bk-open="${esc(k.id)}"`, [`<b class="pg-name">${esc(k.name)}</b>${k.description ? `<small>${esc(k.description)}</small>` : ''}`, String(k.items ?? 0), k.latestVersion ? `v${k.latestVersion}` : '<small>Not yet</small>', `<small>${esc(when(k.updatedAt))}</small>`]))));
    }
    const k = S.kit, line = k.latestVersion ? `v${k.latestVersion} is published${k.unpublished ? '. You have changes not published yet.' : ', and this draft matches it.'}` : 'Not published yet. Apps and agents can’t see it until you publish.';
    const acts = `<span class="fm-saved" data-bk-saved>${esc(S.save)}</span>` + (r0.view === 'tokens' ? h.btn('Add a token', 'data-bk-add', true, 'plus') + h.btn('Import', 'data-bk-import', true) : '') + h.btn('Modes', 'data-bk-modes', true) + h.btn('Publish', `data-bk-publish${k.unpublished ? '' : ' disabled'}`) + h.btn('Delete', 'data-bk-delete', true);
    const head = h.head({ title: k.name, acts }) + h.tabs([['tokens', 'Tokens'], ['brand', 'Logos and voice'], ['versions', 'Versions']], r0.view, 'data-bk-tab') + `<p class="pg-dim" data-bk-line>${esc(line)}</p>`;
    return wrap(head + (r0.view === 'brand' ? brandView(k) : r0.view === 'versions' ? versionsView(k) : tokensView(k)));
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['studio.libraries'] = {
    served: true, items: true,
    label: (it) => { if (/^fonts/.test(String(it))) return it === 'fonts/catalogue' ? 'Fonts · Catalogue' : 'Fonts'; if (/^stock/.test(String(it))) return window.XENO_STOCK ? window.XENO_STOCK.label(it) : 'Stock'; const [id, tab] = String(it).split('/'), name = S.kit?.id === id ? S.kit.name : 'Brand kit'; return tab === 'brand' ? `${name} · Logos and voice` : tab === 'versions' ? `${name} · Versions` : /^[0-9a-f-]{36}$/i.test(id) ? name : it; },
    work: () => (S.status === 'ready' && S.kits.length ? ['Brand kits', S.kits.slice(0, 6).map((k) => [k.name, k.latestVersion ? `v${k.latestVersion}` : 'Draft', null, 'Brand kits'])] : null),
    badge: () => null,
    page: () => page(),
    state: () => ({ status: S.status, kits: S.kits.length, route: route() }),
    reload: () => load(),
  };
  { const z = (window.XENO_MODE_ZONES?.studio || []).find((x) => x.id === 'libraries'); if (z) { z.blurb = 'Brand kits, fonts and stock'; z.work = null; } }

  // ─────────────────────────────── acting
  const newKit = () => D().form({ title: 'New brand kit', sub: 'You add its colors, type and logos next. Nothing follows it until you publish.', submit: 'Create kit',
    fields: [{ id: 'name', label: 'Name', required: true, max: 120, placeholder: 'Our brand' }],
    onSubmit: async (v) => { const r = await api('POST', '/api/brand-kits', withWs({ name: v.name })).catch(() => null); if (!r || !r.ok) return said(r, 'That didn’t save.'); S.created = r.d.kit.id; return null; },
  }).then((v) => { if (v && S.created) { const id = S.created; S.created = null; goto(id); } });
  const parseNumber = (s) => { const m = String(s).trim().match(/^(-?\d*\.?\d+)\s*(px|rem|%)?$/); return m ? { kind: 'number', value: Number(m[1]), ...(m[2] ? { unit: m[2] } : {}) } : null; };
  function valueFrom(kind, v) {
    switch (kind) {
      case 'color': return { kind, value: v.value };
      case 'number': return parseNumber(v.value) || { kind, value: v.value };
      case 'string': return { kind, value: v.value };
      case 'alias': return { kind, path: v.value };
      case 'shadow': { const [offsetX, offsetY, blur, spread, color] = String(v.value).trim().split(/\s+/); return { kind, value: { offsetX, offsetY, blur, spread, color } }; }
      case 'typography': { const m = String(v.value).match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(\d+)$/); return m ? { kind, value: { fontFamily: m[1], fontSize: m[2], lineHeight: m[3], fontWeight: m[4] } } : { kind, value: {} }; }
      default: return { kind };
    }
  }
  const HINT = { color: '#1a2b3c', number: '16px, 1.5rem or 4', string: 'Any text', alias: 'color.brand.primary', shadow: 'x y blur spread #color, like 0 2 8 0 #00000033', typography: 'Font size/line-height weight, like Inter 16/1.5 400' };
  const addToken = () => D().form({ title: 'Add a token', submit: 'Add', fields: [
    { id: 'kind', type: 'select', label: 'Kind', value: 'color', options: KINDS },
    { id: 'path', label: 'Name', required: true, max: 200, placeholder: 'color.brand.primary', hint: 'Lowercase words joined by dots.' },
    { id: 'value', label: 'Value', required: true, max: 400, placeholder: '#1a2b3c', hint: Object.entries(HINT).map(([k, t]) => `${(KINDS.find(([x]) => x === k) || [])[1]}: ${t}`).join(' · ') }],
  onSubmit: async (v) => { const r = await api('PUT', K(S.kit.id, '/tokens'), withWs({ path: v.path, value: valueFrom(v.kind, v) })).catch(() => null); return r && r.ok ? null : said(r, 'That didn’t save.'); },
  }).then((v) => { if (v) { toast('Token added'); reloadKit(); } });
  async function pickLogo() {
    const lib = await api('GET', '/api/library/assets' + q({ limit: 200, sort: 'updated', view: 'active', type: 'images' })).catch(() => null);
    const images = ((lib && lib.ok && lib.d.items) || []).filter((x) => x.source === 'file' && String(x.mime_type || '').startsWith('image/'));
    if (!images.length) return toast('No images in your Library yet. Upload one there first.');
    D().form({ title: 'Add a logo', sub: 'It must be in this workspace’s Library, so everyone here can see it.', submit: 'Add logo', fields: [
      { id: 'file', type: 'select', label: 'Image', value: images[0].source_id, options: images.map((x) => [x.source_id, x.name]) },
      { id: 'name', label: 'Name', required: true, max: 40, placeholder: 'primary', hint: 'Like primary, mark or on-dark.' }],
    onSubmit: async (v) => { const r = await api('POST', K(S.kit.id, '/logos'), withWs({ name: v.name, fileId: v.file })).catch(() => null); return r && r.ok ? null : said(r, 'That didn’t save.'); },
    }).then((v) => { if (v) { toast('Logo added'); reloadKit(); } });
  }
  const importTokens = () => D().form({ title: 'Import design tokens', sub: 'Paste a W3C Design Tokens file. You’ll see what changes before anything does.', submit: 'Check it', fields: [{ id: 'tokens', type: 'textarea', label: 'File contents', required: true, rows: 10, max: 400000 }],
    onSubmit: async (v) => { const r = await api('POST', K(S.kit.id, '/import'), withWs({ tokens: v.tokens })).catch(() => null); if (!r || !r.ok) return said(r, 'That couldn’t be read.'); S.pending = { tokens: v.tokens, plan: r.d }; return null; },
  }).then(async (v) => {
    if (!v || !S.pending) return;
    const { tokens, plan } = S.pending; S.pending = null;
    if (!plan.add.length && !plan.change.length) return toast(plan.refused.length ? `Nothing to import. ${plan.refused.length} couldn’t be read.` : 'Nothing to import. It all matches.');
    const yes = await D().confirm({ title: 'Import these tokens?', body: `${plan.add.length} new, ${plan.change.length} changed, ${plan.same} already the same${plan.refused.length ? `, ${plan.refused.length} can’t be read and will be left out` : ''}. It goes in the draft. Anything else in the kit stays.`, action: 'Import', danger: false });
    if (!yes) return;
    const r = await api('POST', K(S.kit.id, '/import'), withWs({ tokens, confirm: true })).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'That didn’t import.'));
    toast('Imported'); reloadKit();
  });
  const editModes = () => D().form({ title: 'Modes', sub: 'Like light and dark. A token can have its own value in each.', submit: 'Save', fields: [{ id: 'modes', label: 'Modes', value: S.kit.modes.join(', '), max: 200, placeholder: 'dark', hint: 'Separate them with commas. The default values need no mode.' }],
    onSubmit: async (v) => { const r = await api('PATCH', K(S.kit.id), withWs({ modes: String(v.modes || '').split(',').map((x) => x.trim()).filter(Boolean) })).catch(() => null); return r && r.ok ? null : said(r, 'That didn’t save.'); },
  }).then((v) => { if (v) reloadKit(); });
  const publish = () => D().form({ title: 'Publish this kit?', sub: 'It becomes a new version. Everything that follows the kit picks it up, and it can’t be changed afterwards.', submit: 'Publish', fields: [{ id: 'note', label: 'What changed', max: 1000, placeholder: 'New primary color' }],
    onSubmit: async (v) => { const r = await api('POST', K(S.kit.id, '/publish'), withWs({ note: v.note || '' })).catch(() => null); if (!r || !r.ok) return said(r, 'It couldn’t be published.'); S.published = r.d.version.version; return null; },
  }).then((v) => { if (v) { toast(`v${S.published} is published`); load(); } });
  const saveLine = (t) => { S.save = t; const n = document.querySelector('#main [data-bk-saved]'); if (n) n.textContent = t; };

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-bk-area],[data-bk-reload],[data-bk-new],[data-bk-open],[data-bk-tab],[data-bk-restore],[data-bk-add],[data-bk-import],[data-bk-modes],[data-bk-publish],[data-bk-delete],[data-bk-del],[data-bk-addlogo],[data-bk-addmode]');
    if (!t || !t.closest('#main')) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset, k = S.kit;
    if (d.bkArea) return goto(d.bkArea === 'kits' ? null : d.bkArea);
    if ('bkReload' in d) return load();
    if ('bkNew' in d) return newKit();
    if (d.bkOpen) return goto(d.bkOpen);
    if (d.bkTab) return goto(d.bkTab === 'tokens' ? k.id : `${k.id}/${d.bkTab}`);
    if (d.bkRestore) { const r = await api('POST', K(d.bkRestore, '/restore'), withWs({})).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be restored.')); S.undo = null; toast('Kit restored'); return goto(d.bkRestore); }
    if ('bkAdd' in d) return addToken();
    if ('bkImport' in d) return importTokens();
    if ('bkModes' in d) return editModes();
    if ('bkPublish' in d) return publish();
    if ('bkAddlogo' in d) return pickLogo();
    if ('bkDelete' in d) {
      if (!await D().confirm({ title: `Delete “${k.name}”?`, body: 'Apps and agents that follow it stop finding it. You can undo this from the list of kits.' })) return;
      const r = await api('DELETE', K(k.id) + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted.'));
      S.undo = { id: k.id, name: k.name }; toast('Kit deleted'); return goto(null);
    }
    if (d.bkDel) {
      const r = await api('DELETE', K(k.id, '/items') + q({ path: d.bkDel })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.'));
      toast('Removed from the draft'); return reloadKit();
    }
    if (d.bkAddmode) {
      const it = k.items.find((x) => x.path === d.bkVal);
      const r = await api('PUT', K(k.id, '/tokens'), withWs({ path: it.path, value: it.value, description: it.description, valuesByMode: { ...it.valuesByMode, [d.bkMode]: it.value } })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That didn’t save.'));
      return reloadKit();
    }
  }, true);
  // a value saves when you leave the field; the voice saves as you stop typing
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t.dataset?.bkVal || !t.closest('#main')) return;
    const k = S.kit, it = k.items.find((x) => x.path === t.dataset.bkVal); if (!it) return;
    const mode = t.dataset.bkMode, old = mode ? it.valuesByMode[mode] : it.value;
    const value = old.kind === 'number' ? (parseNumber(t.value) || { kind: 'number', value: t.value }) : { kind: old.kind, value: t.value };
    saveLine('Saving…');
    const r = await api('PUT', K(k.id, '/tokens'), withWs({ path: it.path, description: it.description, value: mode ? it.value : value, valuesByMode: mode ? { ...it.valuesByMode, [mode]: value } : it.valuesByMode })).catch(() => null);
    if (!r || !r.ok) { saveLine(`Not saved: ${said(r, 'XENO didn’t answer.')}`); return; }
    saveLine('Saved'); reloadKit();
  });
  let voiceTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!('bkVoice' in (t.dataset || {})) || !t.closest('#main')) return;
    S.kit.voice = t.value; saveLine('Saving…'); clearTimeout(voiceTimer);
    const id = S.kit.id, v = t.value;
    voiceTimer = setTimeout(async () => { const r = await api('PATCH', K(id), withWs({ voice: v })).catch(() => null); if (!r || !r.ok) return saveLine(`Not saved: ${said(r, 'XENO didn’t answer.')}`); S.kit.unpublished = true; saveLine('Saved'); }, 700);
  });

  P.lazyZone(window.XENO_ZONE_LIVE['studio.libraries'], () => { if (route().view === 'list') load(); });   // the first load waits until the area is shown
})();
