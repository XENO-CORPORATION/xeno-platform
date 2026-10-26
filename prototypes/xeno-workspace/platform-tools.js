/**
 * Tools mode is real: the XENO tools from the tool registry (/api/tools → services/toolPackages.js), the same signed
 * packages Hub runs. A tool opens at its own address, /workspace/tools/spaces/<area>/<tool id>, in the tool page
 * (/tool-host.html, src/toolHost) inside a frame, where it gets the web ToolHost. A tool that needs something only
 * Hub has (local models, native conversion) is still listed and opens; the page says what it needs Hub for.
 * Product packages (XENO Image, the Agent) are products with their own pages, so they are not listed here.
 * It registers XENO_ZONE_LIVE['tools.<area>'] for every Tools area.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // which area a tool lives in; a tool the map does not know goes by its registry category, so a new tool is never lost
  const AREA_OF = {
    'asset-extractor': 'image', 'background-removal': 'image', 'capture-manager': 'image', compressor: 'image', converter: 'image', 'image-resize': 'image', upscaler: 'image',
    'font-finder': 'design', 'font-generator': 'design', 'hud-restyle': 'design', 'material-generator': 'design', 'ui-extractor': 'design', 'ui-asset-extractor': 'design',
    'motion-2d': 'video', whisper: 'audio', 'pdf-merge': 'documents', 'latex-compiler': 'documents',
  };
  const BY_CATEGORY = { ai: 'image', converter: 'image', capture: 'image', extractor: 'design', generator: 'design', utility: 'documents' };
  const AREAS = (window.XENO_MODE_ZONES && window.XENO_MODE_ZONES.tools || []).map((z) => z.id);
  const areaOf = (t) => { const a = AREA_OF[t.id] || BY_CATEGORY[t.category] || 'image'; return AREAS.includes(a) ? a : AREAS[0]; };
  const S = { status: 'idle', tools: [], error: null };

  async function load() {
    S.status = 'loading'; S.error = null;
    const r = await P.api('GET', '/api/tools').catch(() => null);
    if (!r || !r.ok) { S.status = 'error'; S.error = (r && r.d && r.d.error) || 'XENO tools could not be reached.'; return paint(); }
    S.tools = (r.d.tools || []).filter((t) => t.contract === 'tool@1');
    S.status = 'ready'; paint();
  }
  const here = (area) => { const s = X()?.S; return s && s.view === 'zone' && s.mode === 'tools' && (!area || s.zone === area); };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const inArea = (area) => S.tools.filter((t) => areaOf(t) === area);
  const needs = (t) => (t.web && t.web.needsHub && t.web.needsHub.length ? `Needs XENO Hub for ${t.web.needsHub.join(', ')}` : 'Runs here');

  function page(area, item) {
    const h = window.XENO_PAGES.h, z = (window.XENO_MODE_ZONES.tools || []).find((x) => x.id === area) || { label: area, blurb: '' };
    if (S.status === 'idle') load();
    if (S.status !== 'ready') return h.page(h.head({ title: z.label, sub: z.blurb }) + `<div class="wrap pj" data-tl-page="${esc(S.status)}"><div class="pj-empty">${S.status === 'error' ? esc(S.error) + ' <button class="btn ghost" data-tl-reload>Try again</button>' : 'Loading…'}</div></div>`);
    const t = item ? S.tools.find((x) => x.id === item) : null;
    if (item && !t) return h.page(h.head({ title: z.label, sub: z.blurb }) + `<div class="wrap pj" data-tl-page="ready"><div class="pj-empty" data-tl-missing>There is no tool called ${esc(item)} here.</div></div>`);
    if (t) {
      const note = t.web.needsHub.length ? `<p class="pg-dim" data-tl-needs-hub>${esc(needs(t))}. Everything else in it works here.</p>` : '';
      return h.page(h.head({ title: t.name, sub: t.description }) + `<div class="wrap pj" data-tl-page="ready" data-tl-tool="${esc(t.id)}" style="display:flex;flex-direction:column;height:100%">${note}
        <iframe data-tl-frame title="${esc(t.name)}" src="/tool-host.html?tool=${encodeURIComponent(t.id)}&v=${encodeURIComponent(t.version)}" allow="clipboard-read; clipboard-write; display-capture" style="flex:1;min-height:560px;width:100%;border:0;border-radius:12px;background:#0b0b0b"></iframe></div>`);
    }
    const list = inArea(area);
    const cards = list.map((x) => `<button class="cr-li" data-tl-open="${esc(x.id)}" data-tl-runs="${x.web.needsHub.length ? 'partly' : 'yes'}"><b>${esc(x.name)}</b><small>${esc(x.description)}</small><small>${esc(needs(x))}</small></button>`).join('');
    return h.page(h.head({ title: z.label, sub: z.blurb }) + `<div class="wrap pj" data-tl-page="ready" data-tl-area="${esc(area)}"><div class="cr-list" data-tl-list>${cards || '<p class="pg-dim" data-tl-empty>No tools here yet.</p>'}</div></div>`);
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  for (const area of AREAS) {
    window.XENO_ZONE_LIVE['tools.' + area] = {
      served: true,
      items: true,
      label: (item) => { const t = S.tools.find((x) => x.id === item); return t ? t.name : item; },
      work: () => (S.status === 'ready' ? ['Tools', inArea(area).map((t) => [t.name, t.web.needsHub.length ? 'Partly on the web' : 'Runs here', null, t.id])] : null),
      badge: () => null,
      page: () => page(area, String((X()?.S || {}).item || '')),
      state: () => ({ status: S.status, tools: inArea(area).length }),
      reload: () => load(),
    };
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tl-open],[data-tl-reload]');
    if (!t || !t.closest('[data-tl-page]')) return;
    e.preventDefault(); e.stopPropagation();
    if ('tlReload' in t.dataset) return load();
    X()?.go?.('zone', { zone: X().S.zone, item: t.dataset.tlOpen });
  });
  // a tool's own Close button returns to its area
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'xeno-tool:close') return;
    if (here()) X()?.go?.('zone', { zone: X().S.zone, item: '' });
  });
})();
