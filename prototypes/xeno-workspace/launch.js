/* XL — how the workspace hands off to a product, and what it does for products that are not out yet.
 *
 *  Open in Hub   xeno://app/<id> — the scheme XENO Hub registers (xeno-hub/src/main/index.ts handleDeepLink). The browser
 *                never says whether it was handled, so Try again and Get XENO Hub stay in reach (Zoom / Teams launch pattern).
 *  Download      the product's download page on xenostudio.ai. Installers need a signed grant tied to a paid plan
 *                (xeno-platform productDownloadRoutes.js), which only the platform can mint — so the page is the door.
 *  Start / New   creates a real work item in that product (recent list + Library) and opens it.
 *  Notify me     a launch watch, kept per product, listed in Settings → Notifications, undoable.
 *                Platform: PUT/DELETE /api/v2/me/launch-watch/:product
 */
(() => {
  const X = () => window.XW, SITE = 'https://xenostudio.ai';
  const st = { get: (k, d) => { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const watched = () => new Set(st.get('launchWatch', []));
  const os = () => { const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase(); return /mac/.test(p) ? 'mac' : /linux/.test(p) ? 'linux' : 'win'; };
  const OSN = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

  // A browser cannot tell us whether a scheme was handled (focus heuristics misfire both ways), so — like Zoom's and
  // Teams' launch pages — we never guess: fire the link, and keep "Try again" and "Get XENO Hub" in reach.
  function fire(id) { try { const f = document.createElement('iframe'); f.style.display = 'none'; f.src = `xeno://app/${encodeURIComponent(id)}`; document.body.appendChild(f); setTimeout(() => f.remove(), 2000); } catch {} }
  function openInHub(id) {
    const p = X().PR[id]; fire(id);
    const t = document.getElementById('toast');
    t.innerHTML = `Opening ${p.name} in XENO Hub… <button class="pg-undo" data-xl-again>Try again</button><button class="pg-undo" data-xl-gethub>Get XENO Hub</button>`; t.classList.add('on');
    t.querySelector('[data-xl-again]').onclick = () => fire(id);
    t.querySelector('[data-xl-gethub]').onclick = () => { t.classList.remove('on'); window.open(`${SITE}/product/hub/download`, '_blank', 'noopener'); };
    clearTimeout(t._pgT); t._pgT = setTimeout(() => t.classList.remove('on'), 9000);
  }
  async function download(id) {
    const p = X().PR[id], cur = os();
    const v = await window.XD.form({ title: `Download ${p.name}`, sub: 'Installers come from xenostudio.ai and need an active paid plan — the site checks your plan and starts the download.', submit: 'Continue on xenostudio.ai', size: 'sm',
      fields: [{ id: 'os', label: 'For', type: 'seg', value: cur, options: Object.entries(OSN).map(([k, n]) => [k, k === cur ? `${n} (this computer)` : n]) }] });
    if (!v) return;
    window.open(`${SITE}/product/${encodeURIComponent(id)}/download/${v.os}`, '_blank', 'noopener');
  }
  // a new piece of work in a product: real item, in Recent and in the Library, then open it
  function create(id, noun) {
    const p = X().PR[id], n = (noun || p.name).replace(/^New\s+/i, ''), name = `Untitled ${n.toLowerCase()}`;
    const R = window.XENO_RECENT; let t = name, i = 2; while (R.some((r) => r.p === id && r.t === t)) t = `${name} ${i++}`;
    // the same shape every Recent entry has — the mode it belongs to is what Overview's "Continue" reads
    const now = new Date().toISOString(), mode = (window.XENO_MODES.find((m) => !m.custom && m.sections.some(([, ids]) => ids.includes(id))) || { id: 'studio' }).id;
    R.unshift({ t, p: id, m: mode, ago: 'just now' });
    window.XENO_PG_LIBRARY?.items.unshift({ id: 'lib_n' + Date.now(), name: t, kind: { image: 'image', motion: 'video', sound: 'audio', docs: 'document', sheets: 'sheet', slides: 'deck', canvas: 'design', post: 'post' }[id] || 'document', bytes: 0, createdAt: now, updatedAt: now, source: { product: id, mode, chat: null }, project: null, starred: false, sharedBy: null, media: null, duration: null, trashedAt: null });
    window.XENO_PG_SYNC_NAV?.();
    X().go('product', { product: id, item: t }); X().refreshPanel();
    X().toast(`Created “${t}”`);
  }
  function notify(ids, label) {
    ids = [].concat(ids); const w = watched(), on = ids.every((x) => w.has(x));
    ids.forEach((x) => (on ? w.delete(x) : w.add(x))); st.set('launchWatch', [...w]);
    const name = label || ids.map((x) => X().PR[x]?.name || x).join(', ');
    sync();
    const t = document.getElementById('toast');
    t.innerHTML = `${on ? `You won’t be told when ${name} launches` : `We’ll tell you when ${name} launches`} <button class="pg-undo">Undo</button>`; t.classList.add('on');
    t.querySelector('.pg-undo').onclick = () => { const w2 = watched(); ids.forEach((x) => (on ? w2.add(x) : w2.delete(x))); st.set('launchWatch', [...w2]); sync(); t.classList.remove('on'); };
    clearTimeout(t._pgT); t._pgT = setTimeout(() => t.classList.remove('on'), 5000);
  }
  // every Notify button on screen reflects the watch list (no re-render needed)
  function sync() {
    const w = watched();
    document.querySelectorAll('[data-xl-notify]').forEach((b) => {
      const ids = b.dataset.xlNotify.split(','), on = ids.every((x) => w.has(x)); if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      const lab = b.querySelector('[data-xl-l]'), txt = on ? 'Notifying you' : (b.dataset.xlOff || 'Notify me'); if (lab && lab.textContent !== txt) lab.textContent = txt;   // only write on change, or the observer below loops
    });
  }
  const notifyBtn = (ids, cls, offLabel = 'Notify me', icon = true) => { const on = [].concat(ids).every((x) => watched().has(x));
    return `<button class="${cls}" data-xl-notify="${[].concat(ids).join(',')}" data-xl-off="${offLabel}" aria-pressed="${on}">${icon ? X().ic(on ? 'check' : 'bell') : ''}<span data-xl-l>${on ? 'Notifying you' : offLabel}</span></button>`; };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xl-hub],[data-xl-download],[data-xl-new],[data-xl-notify]'); if (!b || b.closest('.xd')) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.xlHub) return openInHub(b.dataset.xlHub);
    if (b.dataset.xlDownload) return download(b.dataset.xlDownload);
    if (b.dataset.xlNew) return create(b.dataset.xlNew, b.dataset.xlNoun);
    if (b.dataset.xlNotify) return notify(b.dataset.xlNotify.split(','), b.dataset.xlName);
  }, true);
  new MutationObserver(() => { if (document.querySelector('[data-xl-notify]')) sync(); }).observe(document.documentElement, { childList: true, subtree: true });
  window.XL = { openInHub, download, create, notify, notifyBtn, watched, os };
})();
