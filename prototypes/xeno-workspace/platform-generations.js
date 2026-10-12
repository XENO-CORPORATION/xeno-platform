/* Studio generation addresses and lists. Parent owns workspace route/frame mounting. */
(() => {
  const P = window.XENO_PLATFORM;
  const TYPES = ['image', 'video', 'audio', '3d', 'enhance-image', 'enhance-video', 'enhance-audio', 'enhance-3d'];
  const enh = (type) => String(type).startsWith('enhance-');
  const pathFor = (type, id) => enh(type) ? '/workspace/studio/enhance/' + type.slice(8) + (id ? '/e/' + encodeURIComponent(id) : '') : '/workspace/studio/generate/' + type + (id ? '/g/' + encodeURIComponent(id) : '');
  const route = (path = location.pathname) => {
    const frameFor = (sub, id) => ({ type: 'enhance-' + sub, id: id || null, framePath: '/chat?generationType=enhance&enhanceType=' + sub + (id ? '&generationId=' + encodeURIComponent(id) : '') });
    const e = path.match(/^\/workspace\/studio\/enhance\/(image|video|audio|3d)(?:\/e\/([0-9a-f-]{36}))?\/?$/i);
    if (e) return frameFor(e[1].toLowerCase(), e[2]);
    // the addresses Enhance had before it was one page per type: they still open, and the bar is corrected in place
    const old = path.match(/^\/workspace\/studio\/(?:generate\/enhance(?:\/g\/([0-9a-f-]{36}))?|enhance(?:\/e\/([0-9a-f-]{36}))?)\/?$/i);
    if (old) { const id = old[1] || old[2]; if (path === location.pathname) history.replaceState(history.state, '', pathFor('enhance-image', id)); return frameFor('image', id); }
    const m = path.match(/^\/workspace\/studio\/generate\/(image|video|audio|3d)(?:\/g\/([0-9a-f-]{36}))?\/?$/i);
    return m ? { type: m[1].toLowerCase(), id: m[2] || null, framePath: '/chat?generationType=' + m[1].toLowerCase() + (m[2] ? '&generationId=' + encodeURIComponent(m[2]) : '') } : null;
  };
  const host = () => '<div class="live-chat-host" data-chat-frame data-generation-host></div>';
  const open = (type, id) => {
    if (!TYPES.includes(type)) throw new Error('Unsupported generation type');
    window.location.assign(pathFor(type, id));
  };
  async function list(type) {
    if (!P?.served || !TYPES.includes(type)) throw new Error('Generation history unavailable');
    const result = await P.api('GET', '/api/generations?type=' + encodeURIComponent(type));
    if (!result.ok || !Array.isArray(result.d?.generations)) throw new Error(result.d?.message || 'Generation history unavailable');
    return result.d.generations;
  }
  async function paintList(container, type) {
    container.replaceChildren(); const status = document.createElement('p'); status.textContent = 'Loading generations…'; container.append(status);
    try {
      const items = await list(type); if (!container.isConnected) return;
      container.replaceChildren();
      if (!items.length) { status.textContent = 'No generations yet.'; container.append(status); }
      for (const item of items) {
        const link = document.createElement('a'); link.href = pathFor(item.type, item.id); link.textContent = (item.request?.prompt || item.id) + ' · ' + String(item.state).replace(/_/g, ' '); container.append(link);
      }
    } catch(e) { status.textContent = e.message || 'Generation history unavailable'; const retry=document.createElement('button');retry.textContent='Reload history';retry.addEventListener('click',()=>void paintList(container,type));container.append(retry); }
  }
  // Feed or Theater. The choice is the viewer's own, so it lives in this browser; the frame reads the same key.
  const VIEW_KEY = 'xeno_studio_view';
  const is3d = () => route()?.type === '3d';
  const asView = (v) => v === 'theater' || v === 'grid' || (v === 'stage' && is3d()) ? v : 'feed';
  const view = () => { try { return asView((is3d() && localStorage.getItem(VIEW_KEY + '_3d')) || localStorage.getItem(VIEW_KEY)); } catch { return 'feed'; } };
  const SIZE_KEY = 'xeno_studio_grid';
  const size = () => { try { return Math.min(440, Math.max(110, Number(localStorage.getItem(SIZE_KEY)) || 220)); } catch { return 220; } };
  const viewSwitch = () => { const now = view(); /* Enhance has the same three views as Generate */
    const fav = enh(route()?.type || '') ? '' : '<button type="button" class="tb-fav" data-gen-fav aria-pressed="false" aria-label="Favorites only" data-tip="Favorites only"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z"/></svg></button>';
    return fav + '<input class="tb-size" type="range" min="110" max="440" step="2" value="' + size() + '" data-gen-size aria-label="Tile size" data-tip="Tile size"' + (now === 'grid' ? '' : ' hidden') + '><div class="tb-view" role="group" aria-label="View">'
    + '<button type="button" data-gen-view="feed" aria-label="Feed view" data-tip="Feed" aria-pressed="' + (now === 'feed') + '"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg></button>'
    + '<button type="button" data-gen-view="theater" aria-label="Theater view" data-tip="Theater" aria-pressed="' + (now === 'theater') + '"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10"/><rect x="4" y="8" width="16" height="12" rx="1.5"/></svg></button>'
    + '<button type="button" data-gen-view="grid" aria-label="Grid view" data-tip="Grid" aria-pressed="' + (now === 'grid') + '"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></button>'
    + (is3d() ? '<button type="button" data-gen-view="stage" aria-label="Stage view" data-tip="Stage" aria-pressed="' + (now === 'stage') + '"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/></svg></button>' : '') + '</div>'; };
  const showView = (next) => { for (const b of document.querySelectorAll('#main .topbar [data-gen-view]')) b.setAttribute('aria-pressed', String(b.dataset.genView === next)); const s = document.querySelector('#main .topbar [data-gen-size]'); if (s) s.hidden = next !== 'grid'; };
  const showSize = (value) => { const s = document.querySelector('#main .topbar [data-gen-size]'); if (s && Number(value)) s.value = String(value); };
  const style = document.createElement('style');
  style.textContent = '.topbar .tb-view{display:inline-flex;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border)}'
    + '.topbar .tb-size{-webkit-appearance:none;appearance:none;width:104px;height:14px;margin:0 12px 0 0;background:none;cursor:pointer;opacity:.8}.topbar .tb-size:hover{opacity:1}.topbar .tb-size[hidden]{display:none}'
    // drawn by hand: the browser's own thumb is a circle, and XENO shapes are squares with a small radius
    + '.topbar .tb-size::-webkit-slider-runnable-track{height:3px;border-radius:1px;background:var(--border)}.topbar .tb-size::-moz-range-track{height:3px;border-radius:1px;background:var(--border)}'
    + '.topbar .tb-size::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;margin-top:-4px;border:0;border-radius:2px;background:var(--text)}.topbar .tb-size::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:2px;background:var(--text)}'
    + '.topbar .tb-fav{width:28px;height:26px;margin-right:10px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;background:none;color:var(--muted);cursor:pointer;transition:background .14s,color .14s}.topbar .tb-fav:hover{color:var(--text)}.topbar .tb-fav[aria-pressed="true"]{background:var(--hover);color:var(--text)}.topbar .tb-fav[aria-pressed="true"] svg{fill:currentColor}.topbar .tb-fav svg.i{width:14px;height:14px}'
    + '.topbar .tb-view button{width:28px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer;transition:background .14s,color .14s}'
    + '.topbar .tb-view button:hover{color:var(--text)}.topbar .tb-view button[aria-pressed="true"]{background:var(--hover);color:var(--text)}.topbar .tb-view svg.i{width:14px;height:14px}';
  document.head.appendChild(style);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#main .topbar [data-gen-view]'); if (!b) return;
    const next = asView(b.dataset.genView);
    try { if (next === 'stage') localStorage.setItem(VIEW_KEY + '_3d', next); else { localStorage.setItem(VIEW_KEY, next); if (is3d()) localStorage.removeItem(VIEW_KEY + '_3d'); } } catch {}
    showView(next);
    const frame = document.getElementById('xw-chat-frame');
    try { frame?.contentWindow?.postMessage({ source: 'xeno-workspace', type: 'generation-view', view: next }, location.origin); } catch {}
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#main .topbar [data-gen-fav]'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on));
    try { document.getElementById('xw-chat-frame')?.contentWindow?.postMessage({ source: 'xeno-workspace', type: 'generation-filter', favorite: on }, location.origin); } catch {}
  });
  document.addEventListener('input', (e) => {
    const s = e.target.closest?.('#main .topbar [data-gen-size]'); if (!s) return;
    try { localStorage.setItem(SIZE_KEY, s.value); } catch {}
    try { document.getElementById('xw-chat-frame')?.contentWindow?.postMessage({ source: 'xeno-workspace', type: 'generation-grid-size', size: Number(s.value) }, location.origin); } catch {}
  });
  /* Interactive motion: a result sent to another page lifts off, stays in the air while the page behind it
     changes, and lands where it now belongs. It lives in the workspace (not in the page that is being
     replaced), which is what lets it outlast the change. Off, or with reduced motion: the plain page change. */
  const lively = () => document.documentElement.dataset.imotion !== 'off' && document.documentElement.dataset.motion !== 'reduce' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let carried = null, carrySheet = null, carrySheetFor = null;
  const drop = () => { const c = carried; carried = null; if (!c) return; clearTimeout(c.t); c.el.style.transition = 'opacity .2s ease'; c.el.style.opacity = '0'; setTimeout(() => c.el.remove(), 220); };
  function carry(type, from, frame) {
    if (!lively() || !from || !frame || !from.src || !(from.w > 0)) return open(type);
    drop();
    const f = frame.getBoundingClientRect(), el = document.createElement('div');
    el.className = 'xw-carry'; el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, { left: f.left + from.x + 'px', top: f.top + from.y + 'px', width: from.w + 'px', height: from.h + 'px' });
    // The whole container lifts, exactly as it looks: a copy of it, drawn with the page's own styles, held in the
    // workspace. If it cannot be copied, the picture alone lifts.
    let copy = null;
    try {
      const doc = frame.contentDocument, node = doc?.querySelector('[data-lifting]'), themed = node?.closest('.chat-themed');
      if (node && themed && from.box) {
        if (!carrySheet || carrySheetFor !== doc) {
          let css = ''; for (const sheet of doc.styleSheets) { try { for (const rule of sheet.cssRules) css += rule.cssText + '\n'; } catch { /* a sheet from elsewhere: skipped */ } }
          carrySheet = new CSSStyleSheet(); carrySheet.replaceSync(css.replace(/:root/g, ':host')); carrySheetFor = doc;
        }
        copy = node.cloneNode(true); copy.removeAttribute('data-lifting'); copy.removeAttribute('draggable');
        Object.assign(copy.style, { width: '100%', height: '100%', margin: '0', animation: 'none', opacity: '1', transform: 'none', filter: 'none', pointerEvents: 'none', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', maxWidth: 'none', flex: 'none' });
        // drawn things do not copy themselves: a waveform is redrawn from the original, a video shows the frame it was on
        const drawn = node.querySelectorAll('canvas'), blank = copy.querySelectorAll('canvas');
        drawn.forEach((c, i) => { try { blank[i].width = c.width; blank[i].height = c.height; blank[i].getContext('2d').drawImage(c, 0, 0); } catch { /* left empty */ } });
        const playing = node.querySelectorAll('video'), still = copy.querySelectorAll('video');
        playing.forEach((v, i) => { try { still[i].muted = true; still[i].currentTime = v.currentTime; } catch { /* starts from the first frame */ } });
        // inside the copy the picture area takes whatever room the container has, so the container can change shape
        const stage = copy.querySelector('.sgf-stage'); if (stage) Object.assign(stage.style, { flex: '1 1 auto', minHeight: '0', maxHeight: 'none', aspectRatio: 'auto', height: 'auto' });
        copy.querySelectorAll('.sgf-stage img, .sgf-stage video, .sgf-tile').forEach((m) => Object.assign(m.style, { maxHeight: 'none', height: '100%', objectFit: 'cover' }));
        const shell = document.createElement('div'); shell.className = themed.className; Object.assign(shell.style, { width: '100%', height: '100%', background: 'transparent', position: 'static', overflow: 'hidden' });
        shell.append(copy);
        const root = el.attachShadow({ mode: 'open' }); root.adoptedStyleSheets = [carrySheet]; root.append(shell);
        Object.assign(el.style, { left: f.left + from.box.x + 'px', top: f.top + from.box.y + 'px', width: from.box.w + 'px', height: from.box.h + 'px', borderRadius: getComputedStyle(node).borderRadius });
        node.style.visibility = 'hidden';
      }
    } catch { copy = null; }
    if (!copy) { const media = document.createElement(from.kind === 'video' ? 'video' : 'img'); media.src = from.src; if (from.kind === 'video') { media.muted = true; media.loop = true; media.playsInline = true; media.autoplay = true; } el.append(media); }
    document.body.append(el);
    carried = { el, copy, t: setTimeout(drop, 6000) };
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('up')));
    // the page changes under it once it has left the surface
    setTimeout(() => { if (window.XENO_ADDR?.go) window.XENO_ADDR.go('#/studio/p/' + type); else open(type); }, 240);
  }
  function land(to, frame) {
    const c = carried; if (!c || !to || !frame || !(to.w > 0)) return drop();
    clearTimeout(c.t);
    const f = frame.getBoundingClientRect(), s = c.el.style;
    c.el.classList.remove('up'); c.el.classList.add('down');
    // The container becomes the place it lands in: its outline takes that shape and corner, and what belonged
    // only to the card it left (its line of details, its border) fades away on the way.
    if (to.radius) s.borderRadius = to.radius;
    if (c.copy) {
      c.copy.style.transition = 'border-color .4s ease, background-color .4s ease, border-radius .62s cubic-bezier(.22,.9,.24,1)'; c.copy.style.borderColor = 'transparent'; c.copy.style.backgroundColor = 'transparent'; if (to.radius) c.copy.style.borderRadius = to.radius;
      c.copy.querySelectorAll('.sgf-foot, .sgg-cap, .sgf-expand').forEach((part) => { part.style.transition = 'opacity .28s ease, max-height .5s cubic-bezier(.22,.9,.24,1), padding .5s cubic-bezier(.22,.9,.24,1)'; part.style.opacity = '0'; part.style.maxHeight = part.offsetHeight + 'px'; part.style.overflow = 'hidden'; requestAnimationFrame(() => { part.style.maxHeight = '0px'; part.style.paddingTop = '0'; part.style.paddingBottom = '0'; }); });
    }
    s.left = f.left + to.x + 'px'; s.top = f.top + to.y + 'px'; s.width = to.w + 'px'; s.height = to.h + 'px';
    c.t = setTimeout(drop, 720);
  }
  const carryStyle = document.createElement('style');
  carryStyle.textContent = '.xw-carry{position:fixed;z-index:2147483000;pointer-events:none;overflow:hidden;border-radius:6px;box-shadow:0 0 0 rgb(0 0 0 / 0);transform:scale(1);transform-origin:50% 50%;'
    + 'transition:transform .26s cubic-bezier(.2,.8,.2,1),box-shadow .26s ease,left .62s cubic-bezier(.22,.9,.24,1),top .62s cubic-bezier(.22,.9,.24,1),width .62s cubic-bezier(.22,.9,.24,1),height .62s cubic-bezier(.22,.9,.24,1),border-radius .62s cubic-bezier(.22,.9,.24,1)}'
    + '.xw-carry img,.xw-carry video{width:100%;height:100%;object-fit:cover;display:block}'
    + '.xw-carry.up{transform:scale(1.045);box-shadow:0 24px 70px rgb(0 0 0 / .6),0 0 0 1px rgb(255 255 255 / .16)}'
    + '.xw-carry.down{transform:scale(1);box-shadow:0 0 0 rgb(0 0 0 / 0)}';
  document.head.appendChild(carryStyle);
  window.XENO_GENERATIONS = { served: Boolean(P?.served), pathFor, route, host, open, list, paintList, viewSwitch, showView, showSize, asView, carry, land };
})();
