/* platform-docs.js — on the platform, Office › Write (documents) and Office › Notes are real.
 *
 * The picture listed sample rows ("Q4 planning", "Meeting notes"). Here both areas read and write
 * /api/workspace-docs (routes/workspaceDocsRoutes.js → services/workspaceDocs.js). A document IS a Storage file:
 * stable file id, versions, shares and trash are Storage's own.
 *
 *   list · search     GET /?kind=doc|note&q=          (search runs through the Library search)
 *   open              GET /:id → Markdown + backlinks  the address is #/office/z/<write|notes>/<file id>
 *   new · save        POST / · PUT /:id {title, markdown, expectedVersion} — a save is a new version
 *   versions          GET /:id/versions · POST /:id/versions/:v/restore
 *   delete · undo     POST /:id/trash · POST /:id/untrash
 *   share             POST /api/library/assets/file/:id/shares {with, role} (Storage's sharing, unchanged)
 *
 * The editor is a rich-text surface over MARKDOWN: what is stored is Markdown, rendered here by an escaping renderer,
 * so a document can never carry markup or script. A link to another document is [label](xeno-doc:<id>).
 *
 * It registers XENO_ZONE_LIVE['office.write'] and ['office.notes'], so neither area shows sample rows.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const ZONES = { write: { kind: 'doc', label: 'Write', noun: 'document', blurb: 'Documents, stored in Storage with every version kept.' }, notes: { kind: 'note', label: 'Notes', noun: 'note', blurb: 'Notes that link to each other, stored in Storage.' } };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const st = {};   // per zone: { status, ws, list, q, open, versions, error, undo, dirty }
  const Z = (z) => (st[z] = st[z] || { status: 'idle', ws: undefined, list: [], q: '', open: null, openId: null, versions: null, error: null, undo: null });
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const here = () => { const s = X()?.S; return s && s.view === 'zone' && ZONES[s.zone] ? s.zone : null; };
  const item = () => { const it = X()?.S?.item; return it && UUID.test(it) ? it : null; };
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); if (here()) X().render(); } catch {} };
  const go = (zone, id) => X()?.go?.('zone', { zone, item: id || null });

  // ─────────────────────────────── Markdown ⇄ the editor (escaping both ways)
  const SAFE = /^(https?:\/\/|mailto:)/i;
  function inline(src) {
    // escape first, then mark up; only the marks below can produce tags
    let s = esc(src);
    const codes = []; s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      const h = href.replace(/&amp;/g, '&');
      const m = /^xeno-doc:([0-9a-f-]{36})$/i.exec(h);
      if (m) return `<a href="#" data-doc-link="${m[1]}">${label}</a>`;
      return SAFE.test(h) ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/\\([\\`*_[\]()~#>-])/g, '$1');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }
  function render(md) {
    const lines = String(md || '').split('\n'), out = []; let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
      let m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote><p>${buf.map(inline).join('<br>')}</p></blockquote>`); continue; }
      if (/^[-*+]\s+/.test(l)) { const buf = []; while (i < lines.length && /^[-*+]\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^[-*+]\s+/, ''))}</li>`); out.push(`<ul>${buf.join('')}</ul>`); continue; }
      if (/^\d+\.\s+/.test(l)) { const buf = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\d+\.\s+/, ''))}</li>`); out.push(`<ol>${buf.join('')}</ol>`); continue; }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|[-*+]\s|\d+\.\s|```)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('') || '<p><br></p>';
  }
  const escMd = (t) => t.replace(/([\\`*[\]~])/g, '\\$1');
  function inlineMd(node) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += escMd(n.nodeValue.replace(/ /g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName, inner = () => inlineMd(n);
      if (t === 'BR') s += '\n';
      else if (t === 'STRONG' || t === 'B') s += `**${inner()}**`;
      else if (t === 'EM' || t === 'I') s += `*${inner()}*`;
      else if (t === 'S' || t === 'STRIKE' || t === 'DEL') s += `~~${inner()}~~`;
      else if (t === 'CODE') s += '`' + n.textContent.replace(/`/g, '') + '`';
      else if (t === 'A') { const d = n.dataset.docLink, h = n.getAttribute('href') || ''; s += d && UUID.test(d) ? `[${inner()}](xeno-doc:${d})` : SAFE.test(h) ? `[${inner()}](${h.replace(/[\s)]/g, encodeURIComponent)})` : inner(); }
      else s += inner();
    }
    return s;
  }
  function serialize(root) {
    const out = [];
    const lines = (txt, pre) => txt.split('\n').map((x) => pre + x).join('\n');
    for (const n of root.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push(escMd(n.nodeValue.trim())); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) out.push('#'.repeat(Math.min(3, Number(t[1]))) + ' ' + inlineMd(n).replace(/\n/g, ' '));
      else if (t === 'UL' || t === 'OL') out.push([...n.children].filter((li) => li.tagName === 'LI').map((li, k) => (t === 'UL' ? '- ' : `${k + 1}. `) + inlineMd(li).replace(/\n/g, ' ')).join('\n'));
      else if (t === 'BLOCKQUOTE') out.push(lines(serialize(n).replace(/\n\n/g, '\n'), '> '));
      else if (t === 'PRE') out.push('```\n' + n.textContent.replace(/```/g, '') + '\n```');
      else { const s = inlineMd(n).replace(/\n+$/, ''); if (s.trim()) out.push(s); }
    }
    return out.join('\n\n');
  }
  window.XENO_DOCS_MD = { render, serialize };   // for the browser test

  // ─────────────────────────────── data
  const q = (z) => { const p = new URLSearchParams({ kind: ZONES[z].kind }); if (Z(z).ws) p.set('workspace', Z(z).ws); if (Z(z).q) p.set('q', Z(z).q); return '?' + p; };
  async function load(z) {
    const S = Z(z); S.ws = wsId(); S.status = 'loading'; S.error = null;
    const r = await api('GET', '/api/workspace-docs' + q(z)).catch(() => null);
    if (!r || !r.ok) { S.status = 'error'; S.error = said(r, 'Documents could not be reached.'); return paint(); }
    S.list = r.d.docs || []; S.status = 'ready'; paint();
  }
  async function openDoc(z, id) {
    const S = Z(z); S.openId = id; S.open = null; S.versions = null;
    const r = await api('GET', `/api/workspace-docs/${encodeURIComponent(id)}`).catch(() => null);
    if (S.openId !== id) return;
    if (!r || !r.ok) { S.open = { error: said(r, 'This document could not be opened.') }; return paint(); }
    S.open = { ...r.d.doc, backlinks: r.d.backlinks || [] }; paint();
  }

  for (const [z, Zd] of Object.entries(ZONES)) {
    window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
    window.XENO_ZONE_LIVE['office.' + z] = {
      served: true, items: true,   // a document has its own address: #/office/z/<zone>/<file id>
      work: () => (Z(z).status === 'ready' && Z(z).list.length ? [Zd.label === 'Write' ? 'Documents' : 'Notes', Z(z).list.slice(0, 6).map((d) => [d.title, new Date(d.updatedAt).toLocaleDateString(), null, Zd.label])] : null),
      badge: () => null,
      page: () => page(z),
      state: () => ({ status: Z(z).status, docs: Z(z).list.length, open: Z(z).open && Z(z).open.id || null }),
      reload: () => load(z),
    };
  }

  // ─────────────────────────────── the page
  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function page(z) {
    const S = Z(z), Zd = ZONES[z];
    // the page's one header (XENO_PAGES): New document / New note sits right in the header bar and opens the dialog
    const h = window.XENO_PAGES.h, noun = Zd.noun;
    const head = h.head({ title: Zd.label, sub: Zd.blurb, acts: h.btn(`New ${noun}`, `data-dc-new="${z}"`, false, 'plus') });
    const wrap = (body) => h.page(`${head}<div class="wrap pj hm" data-dc-page="${esc(S.status)}" data-dc-zone="${z}">${body}</div>`);
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(z); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-dc-error>${esc(S.error)} ${btn('data-dc-reload', 'Try again')}</div>`);
    const want = item();
    if (want && S.openId !== want) openDoc(z, want);
    if (!want && S.openId) { S.openId = null; S.open = null; }
    const undo = S.undo ? `<div class="an-undo" data-dc-undone>“${esc(S.undo.title)}” was moved to the trash. ${btn(`data-dc-untrash="${esc(S.undo.id)}"`, 'Undo')}</div>` : '';
    const list = S.list.length ? S.list.map((d) => `<li class="dc-item ${S.openId === d.id ? 'on' : ''}"><a href="#" data-dc-open="${esc(d.id)}"><b>${esc(d.title)}</b><small>${esc(d.excerpt || 'Empty')}</small></a></li>`).join('')
      : `<li class="pj-empty" data-dc-none>${S.q ? 'Nothing matches.' : `No ${Zd.noun}s yet.`}</li>`;
    const side = `<aside class="dc-side">
      <input class="in" type="search" data-dc-search placeholder="Search ${Zd.label === 'Write' ? 'documents' : 'notes'}" aria-label="Search" value="${esc(S.q)}"><ul class="dc-list" data-dc-list>${list}</ul></aside>`;
    return wrap(`${undo}<div class="dc-wrap">${side}<section class="dc-main">${editor(z)}</section></div>`);
  }
  function editor(z) {
    const S = Z(z), d = S.open;
    if (!S.openId) return `<div class="pj-empty">Choose a ${ZONES[z].noun} or start a new one.</div>`;
    if (!d) return '<div class="pj-empty">Opening…</div>';
    if (d.error) return `<div class="pj-empty" data-dc-open-error>${esc(d.error)}</div>`;
    const ro = !d.canEdit;
    const tools = ro ? '<small class="dc-ro">Read only</small>' : [['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['p', 'Text'], ['bold', 'B'], ['italic', 'I'], ['strike', 'S'], ['code', 'Code'], ['ul', '• List'], ['ol', '1. List'], ['quote', 'Quote'], ['link', 'Link'], ['doclink', `Link a ${ZONES[z].noun}`]]
      .map(([k, l]) => `<button class="btn ghost dc-t" data-dc-fmt="${k}" title="${esc(l)}">${esc(l)}</button>`).join('');
    const picker = S.picking ? `<div class="dc-pick" data-dc-picker>${S.list.filter((x) => x.id !== d.id).map((x) => `<button class="btn ghost" data-dc-linkto="${esc(x.id)}" data-dc-linklabel="${esc(x.title)}">${esc(x.title)}</button>`).join('') || '<small>No other ' + ZONES[z].noun + 's yet.</small>'}</div>` : '';
    const back = d.backlinks.length ? d.backlinks.map((b) => `<li><a href="#" data-dc-open="${esc(b.id)}" data-dc-in="${b.kind === 'note' ? 'notes' : 'write'}">${esc(b.title)}</a></li>`).join('') : '<li class="pj-empty">Nothing links here yet.</li>';
    const vers = S.versions ? `<ul class="dc-vers" data-dc-versions>${S.versions.map((v, k) => `<li><span>${esc(new Date(v.createdAt).toLocaleString())}${v.current ? ' · current' : ''}</span>${v.current || ro ? '' : btn(`data-dc-restore="${esc(v.id)}"`, 'Restore')}</li>`).join('')}</ul>` : '';
    return `<div class="dc-doc" data-dc-doc="${esc(d.id)}" data-dc-version="${esc(d.versionId)}">
      <input class="in dc-title" data-dc-title value="${esc(d.title)}" aria-label="Title" maxlength="200" ${ro ? 'readonly' : ''}>
      <div class="dc-tools">${tools}</div>${picker}
      <div class="dc-body" data-dc-body ${ro ? '' : 'contenteditable="true"'} role="textbox" aria-multiline="true" aria-label="${esc(ZONES[z].noun)} text">${render(d.markdown)}</div>
      <div class="dc-acts">${ro ? '' : btn('data-dc-save', 'Save', 'btn')} ${btn('data-dc-history', S.versions ? 'Hide versions' : 'Versions')} ${ro ? '' : btn('data-dc-trash', 'Delete')}
        ${ro ? '' : `<span class="dc-share"><input class="in" data-dc-share-with placeholder="Share with (email or username)" aria-label="Share with"> <select class="in" data-dc-share-role aria-label="Access"><option value="viewer">Can view</option><option value="editor">Can edit</option></select> ${btn('data-dc-share', 'Share')}</span>`}</div>
      ${vers}<h3>Linked from</h3><ul class="dc-back" data-dc-backlinks>${back}</ul></div>`;
  }

  // ─────────────────────────────── actions
  function fmt(k, root) {
    const body = root.querySelector('[data-dc-body]'); body.focus();
    const ex = (c, v) => document.execCommand(c, false, v);
    if (/^h[1-3]$|^p$/.test(k)) return ex('formatBlock', k === 'p' ? 'P' : k.toUpperCase());
    if (k === 'bold') return ex('bold'); if (k === 'italic') return ex('italic'); if (k === 'strike') return ex('strikeThrough');
    if (k === 'ul') return ex('insertUnorderedList'); if (k === 'ol') return ex('insertOrderedList'); if (k === 'quote') return ex('formatBlock', 'BLOCKQUOTE');
    if (k === 'code') { const t = String(window.getSelection() || '') || 'code'; return ex('insertHTML', `<code>${esc(t)}</code>`); }
    if (k === 'link') { const u = window.prompt('Link address (https://…)'); if (u && SAFE.test(u.trim())) ex('createLink', u.trim()); else if (u) toast('Only https, http and mailto links'); }
  }
  // a re-render must not lose what is being typed: keep the editor's words in the open document first
  const keep = (root, S) => { const body = root.querySelector('[data-dc-body]'), ti = root.querySelector('[data-dc-title]'); if (body && S.open) S.open.markdown = serialize(body); if (ti && S.open) S.open.title = ti.value; };
  async function send(z, method, path, body, okMsg) {
    const r = await api(method, path, body).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That did not work.')); return null; }
    if (okMsg) toast(okMsg); return r.d;
  }
  document.addEventListener('click', async (e) => {
    const nw = e.target.closest('#main [data-dc-new]');
    if (nw) { e.preventDefault(); e.stopPropagation(); const z = nw.dataset.dcNew, S = Z(z);
      return window.XD.form({ title: `New ${ZONES[z].noun}`, submit: 'Create', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 200 }],
        onSubmit: async (v) => { const r = await send(z, 'POST', '/api/workspace-docs', { kind: ZONES[z].kind, title: v.title, markdown: '', ...(S.ws ? { workspace: S.ws } : {}) }, 'Created'); if (!r) return 'That did not save.'; S.made = r.doc.id; return null; },
      }).then(async (v) => { if (!v || !S.made) return; const id = S.made; S.made = null; await load(z); go(z, id); }); }
    const t = e.target.closest('[data-dc-reload],[data-dc-open],[data-dc-fmt],[data-dc-linkto],[data-dc-save],[data-dc-history],[data-dc-restore],[data-dc-trash],[data-dc-untrash],[data-dc-share],[data-doc-link]');
    if (!t || !t.closest('[data-dc-page]')) return;
    const root = t.closest('[data-dc-page]'), z = root.dataset.dcZone, S = Z(z), d = t.dataset;
    if ('docLink' in d && t.closest('[contenteditable="true"]')) return;   // editing text: a link is not followed
    e.preventDefault(); e.stopPropagation();
    if ('dcReload' in d) return load(z);
    if (d.dcOpen || d.docLink) { const id = d.dcOpen || d.docLink; const into = d.dcIn || (S.list.some((x) => x.id === id) ? z : (z === 'write' ? 'notes' : 'write')); return go(into, id); }
    if (d.dcFmt === 'doclink') { keep(root, S); S.picking = !S.picking; return paint(); }
    if (d.dcFmt) return fmt(d.dcFmt, root);
    if (d.dcLinkto) { const body = root.querySelector('[data-dc-body]'); body.focus(); const label = String(window.getSelection() || '') || d.dcLinklabel; document.execCommand('insertHTML', false, `<a href="#" data-doc-link="${esc(d.dcLinkto)}">${esc(label)}</a>&nbsp;`); S.picking = false; keep(root, S); return paint(); }
    if (d.dcUntrash) { const r = await send(z, 'POST', `/api/workspace-docs/${encodeURIComponent(d.dcUntrash)}/untrash`, {}, 'Restored'); if (r) { S.undo = null; await load(z); go(z, d.dcUntrash); } return; }
    const doc = root.querySelector('[data-dc-doc]'); if (!doc) return;
    const id = doc.dataset.dcDoc;
    if ('dcSave' in d) {
      const title = root.querySelector('[data-dc-title]').value, markdown = serialize(root.querySelector('[data-dc-body]'));
      const r = await api('PUT', `/api/workspace-docs/${encodeURIComponent(id)}`, { title, markdown, expectedVersion: doc.dataset.dcVersion }).catch(() => null);
      if (!r || !r.ok) return toast(r && r.d && r.d.code === 'version_conflict' ? 'Someone saved a newer version. Reopen it to see their changes.' : said(r, 'That did not save.'));
      toast('Saved'); S.open = { ...r.d.doc, backlinks: r.d.backlinks || [] }; if (S.versions) S.versions = null; return load(z);
    }
    if ('dcHistory' in d) { if (S.versions) { S.versions = null; return paint(); } const r = await send(z, 'GET', `/api/workspace-docs/${encodeURIComponent(id)}/versions`); if (r) { S.versions = r.versions; paint(); } return; }
    if (d.dcRestore) { const r = await send(z, 'POST', `/api/workspace-docs/${encodeURIComponent(id)}/versions/${encodeURIComponent(d.dcRestore)}/restore`, {}, 'Version restored'); if (r) { S.open = { ...r.doc, backlinks: r.backlinks || [] }; S.versions = null; load(z); } return; }
    if ('dcTrash' in d) { const r = await send(z, 'POST', `/api/workspace-docs/${encodeURIComponent(id)}/trash`, {}, 'Moved to the trash'); if (r) { S.undo = { id, title: S.open.title }; S.openId = null; S.open = null; await load(z); go(z, null); } return; }
    if ('dcShare' in d) {
      const who = (root.querySelector('[data-dc-share-with]') || {}).value || '', role = (root.querySelector('[data-dc-share-role]') || {}).value === 'editor' ? 'editor' : 'viewer';
      if (!who.trim()) return toast('Who should it be shared with?');
      if (await send(z, 'POST', `/api/library/assets/file/${encodeURIComponent(id)}/shares`, { with: who.trim(), role }, 'Shared')) root.querySelector('[data-dc-share-with]').value = '';
    }
  }, true);
  let searchTimer = 0;
  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-dc-search]'); if (!t || !t.closest('[data-dc-page]')) return;
    const z = t.closest('[data-dc-page]').dataset.dcZone; clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { Z(z).q = t.value.trim(); load(z).then(() => { const i = document.querySelector('[data-dc-search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250);
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.target.closest?.('[data-dc-doc]')) { e.preventDefault(); e.target.closest('[data-dc-page]').querySelector('[data-dc-save]')?.click(); }
  }, true);

  P.ready.then((u) => { if (u) { load('write'); load('notes'); } });
})();
