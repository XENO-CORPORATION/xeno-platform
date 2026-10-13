/* XENO_STORAGE — the Storage product (Corpo), on the real platform API.
 *
 * XENO Storage (codename Arca) is the account's one store: uploads, chat attachments, generated media and
 * documents all count toward one allowance set by the plan. The Library is its view of the files; this page
 * is the account of the space: how much is used, by what, and what is taking the most.
 *
 *   GET /api/library/storage                      → used, allowance, trash, by kind
 *   GET /api/library/assets?sort=size&limit=8     → the largest files
 *
 * Nothing is invented: from disk (no platform) the page says the meter needs the platform. Spec:
 * XENO STORAGE - SPEC.md in the workspace root. */
(() => {
  const P = window.XENO_PLATFORM;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = { status: 'idle', storage: null, largest: [] };
  const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };
  const KIND = { image: 'Images', video: 'Video', audio: 'Audio', '3d': '3D models', document: 'Documents' };
  const paint = () => { try { X()?.render?.(); } catch {} };

  async function load() {
    if (!P || !P.served) { S.status = 'offline'; return; }
    S.status = S.storage ? 'ready' : 'loading';
    const [meter, big] = await Promise.all([P.api('GET', '/api/library/storage').catch(() => null), P.api('GET', '/api/library/assets?sort=size&limit=8').catch(() => null)]);
    if (!meter || !meter.ok || !meter.d.storage) { S.status = 'error'; return paint(); }
    S.storage = meter.d.storage;
    S.largest = big && big.ok && Array.isArray(big.d.items) ? big.d.items.filter((i) => Number(i.size_bytes) > 0).slice(0, 8) : [];
    S.status = 'ready'; paint();
  }

  const style = () => {
    if (document.getElementById('xst-css')) return; const s = document.createElement('style'); s.id = 'xst-css';
    s.textContent = '.xst{max-width:920px;margin:0 auto;padding:28px 28px 60px}.xst h1{margin:0;font-size:clamp(22px,1.7vw,26px);font-weight:600;letter-spacing:-.022em}'
      + '.xst-sub{margin:6px 0 0;color:var(--muted);font-size:13.5px}.xst-meter{margin:26px 0 0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}'
      + '.xst-nums{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.xst-nums b{font-size:30px;font-weight:600;letter-spacing:-.02em}.xst-nums span{color:var(--muted);font-size:14px}.xst-nums em{margin-left:auto;font-style:normal;color:var(--muted);font-size:13px}'
      + '.xst-bar{display:flex;height:10px;margin-top:16px;border-radius:5px;overflow:hidden;background:var(--control)}.xst-bar i{display:block;height:100%;min-width:2px;transition:width .5s cubic-bezier(.2,.7,.2,1)}'
      + '.xst-bar i:nth-child(1){background:var(--text)}.xst-bar i:nth-child(2){background:#bdbdbd}.xst-bar i:nth-child(3){background:#8f8f8f}.xst-bar i:nth-child(4){background:#6b6b6b}.xst-bar i:nth-child(5){background:#4c4c4c}'
      + '.xst-note{margin:14px 0 0;font-size:13px;color:var(--muted)}.xst-note[data-full]{color:var(--text)}'
      + '.xst-h{margin:30px 0 8px;font-size:12px;color:var(--dim)}.xst-rows{border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}'
      + '.xst-row{display:grid;grid-template-columns:14px 1fr auto auto;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid var(--border);font-size:13.5px}.xst-row:first-child{border-top:0}'
      + '.xst-row .sw{width:10px;height:10px;border-radius:3px}.xst-row small{color:var(--muted);font-size:12.5px}.xst-row b{font-weight:500;font-variant-numeric:tabular-nums}'
      + '.xst-row.file{grid-template-columns:1fr auto;cursor:pointer}.xst-row.file:hover{background:var(--hover)}.xst-row.file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.xst-acts{display:flex;gap:8px;margin-top:18px}.xst-acts button{height:32px;padding:0 13px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);font:inherit;font-size:13px;cursor:pointer}.xst-acts button:hover{background:var(--hover)}'
      + '.xst-state{margin-top:26px;padding:22px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--muted);font-size:13.5px}';
    document.head.appendChild(s);
  };
  const SHADES = ['var(--text)', '#bdbdbd', '#8f8f8f', '#6b6b6b', '#4c4c4c'];

  function page() {
    style();
    if (S.status === 'idle') { S.status = 'loading'; setTimeout(load, 0); }
    const head = '<h1>Storage</h1><p class="xst-sub">Everything your account holds: uploads, chat attachments, generated media and documents. The Library shows the files; this is the space they take.</p>';
    if (S.status === 'offline') return `<div class="xst">${head}<div class="xst-state">The storage meter is read from the platform. Open the workspace on xenosystem.ai to see it.</div></div>`;
    if (S.status === 'error') return `<div class="xst">${head}<div class="xst-state">Your storage could not be read just now.<div class="xst-acts"><button type="button" data-xst="retry">Try again</button></div></div></div>`;
    const m = S.storage;
    if (!m) return `<div class="xst">${head}<div class="xst-state" role="status">Reading your storage</div></div>`;
    const limit = m.allowanceBytes, kinds = m.byKind || [], total = limit ?? Math.max(m.usedBytes, 1);
    const pct = limit ? Math.min(100, (m.usedBytes / limit) * 100) : 0;
    const bar = kinds.map((k) => `<i style="width:${Math.max(0.4, (k.bytes / total) * 100)}%" title="${esc(KIND[k.kind] || k.kind)} ${esc(size(k.bytes))}"></i>`).join('');
    const note = m.full ? '<p class="xst-note" data-full>Your storage is full. New uploads are refused until you free some space or change your plan. Nothing is deleted, and everything you have stays readable.</p>'
      : limit === null ? '<p class="xst-note">This account has no storage limit.</p>'
      : `<p class="xst-note">${esc(size(m.remainingBytes))} free. Generated results are always kept, even if the account is full.</p>`;
    const rows = kinds.length ? kinds.map((k, i) => `<div class="xst-row"><span class="sw" style="background:${SHADES[i % SHADES.length]}"></span><span>${esc(KIND[k.kind] || k.kind)}</span><small>${k.files} ${k.files === 1 ? 'file' : 'files'}</small><b>${esc(size(k.bytes))}</b></div>`).join('')
      : '<div class="xst-row"><span></span><span>Nothing stored yet</span><small></small><b></b></div>';
    const trash = m.trashBytes > 0 ? `<div class="xst-row"><span></span><span>In the trash</span><small>counts until it is deleted for good</small><b>${esc(size(m.trashBytes))}</b></div>` : '';
    const largest = S.largest.length ? `<div class="xst-h">Largest files</div><div class="xst-rows">${S.largest.map((f) => `<div class="xst-row file" data-xst="open" data-name="${esc(f.name)}"><span>${esc(f.name)}</span><b>${esc(size(f.size_bytes))}</b></div>`).join('')}</div>` : '';
    return `<div class="xst">${head}
      <div class="xst-meter"><div class="xst-nums"><b>${esc(size(m.usedBytes))}</b><span>${limit === null ? 'used' : `of ${esc(size(limit))} used`}</span><em>${m.files} ${m.files === 1 ? 'file' : 'files'}${limit ? ` · ${pct < 0.1 && m.usedBytes ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%` : ''}</em></div>
        <div class="xst-bar" role="img" aria-label="${esc(size(m.usedBytes))} used${limit ? ` of ${esc(size(limit))}` : ''}">${bar}</div>${note}</div>
      <div class="xst-h">What is using it</div><div class="xst-rows">${rows}${trash}</div>${largest}
      <div class="xst-acts"><button type="button" data-xst="library">Open Library</button><button type="button" data-xst="plan">Plan and billing</button></div></div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xst]'); if (!b) return;
    const act = b.dataset.xst;
    if (act === 'retry') { S.status = 'idle'; return paint(); }
    if (act === 'library') return X()?.go?.('global', { global: 'library', item: null });
    if (act === 'open') return X()?.go?.('global', { global: 'library', item: b.dataset.name });
    if (act === 'plan') { if (window.XENO_ADDR?.go) return window.XENO_ADDR.go('#/overview/g/settings/Plan'); }
  });
  // the sidebar's "Open Library" button: a real action, taken before the generic "new item" handler
  document.addEventListener('click', (e) => { if (!e.target.closest('#panel [data-xl-new="storage"]')) return; e.preventDefault(); e.stopImmediatePropagation(); X()?.go?.('global', { global: 'library', item: null }); }, true);
  window.XENO_STORAGE = { page, reload: () => { S.status = 'idle'; paint(); }, state: () => ({ status: S.status, storage: S.storage }) };
})();
