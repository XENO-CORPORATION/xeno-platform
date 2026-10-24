/* platform-skills.js — skills: your library, the global Marketplace, and the editor (docs/AGENT-IDENTITY-SKILLS-CORPUS.md;
 * /isg 2026-10-24: "a global library where everyone puts it on the marketplace").
 *
 *   Library        /workspace/workspace/Skills                       yours and your workspaces'
 *   Marketplace    /workspace/workspace/Skills/Marketplace           every published skill, by publisher
 *   a listing      /workspace/workspace/Skills/Marketplace/<uuid>    read it before getting it
 *   Review         /workspace/workspace/Skills/Review                admins: read and approve submitted skills
 *   new            /workspace/workspace/Skills/new                   the editor (also where an upload opens)
 *   a skill        /workspace/workspace/Skills/<skl_…>[/edit]         by its stable id, never its name
 *
 * A skill is the open Agent Skills format: SKILL.md (a name, WHEN to use it, the steps) plus files. Versions never change;
 * an agent pins one. The Marketplace is the same one that sells apps and agents (listing kind `skill`): publishing goes
 * through automated checks and a person's review, and installing never updates anything by itself.
 *
 * Files keep their exact bytes: text stays text (BOM and line endings kept), an image or a font is sent as its bytes and
 * stored once by digest, so a skill matches XENO Corpus's copy of it. A Corpus skills folder imports with its history.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_SKILLS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k);
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const why = (r, d) => (r && r.d && (r.d.error && typeof r.d.error === 'string' && !/^[a-z_]+$/.test(r.d.error) ? r.d.error : r.d.message || r.d.reason || d)) || d;
  const ID = /^skl_[0-9a-f]{32}$/, UUID = /^[0-9a-f-]{36}$/i;
  const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served && window.XENO_SCOPE.uuid && window.XENO_SCOPE.uuid()) || null;
  const scope = () => (window.XENO_SCOPE && window.XENO_SCOPE.served && window.XENO_SCOPE.current ? window.XENO_SCOPE.current() : null);
  const teamWs = () => { const sc = scope(); return wsId() && sc && !sc.personal ? sc : null; };
  const paint = () => { try { window.XENO_PG_SYNC_NAV?.(); X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const toast = (m) => X()?.toast?.(m);
  const S = { key: null, status: 'idle', list: [], one: null, q: '', mq: '', busy: false, loaded: false, market: null, listing: null, owned: new Set(), subs: null, mine: null, ed: null, showImport: false, corpus: null, found: null };

  // ───────────────────────── the format, on this side only to help the writer; the server decides
  const skillMd = (name, description, body) => `---\nname: ${name}\ndescription: ${String(description).replace(/\s*\n\s*/g, ' ').trim()}\n---\n\n${String(body || '').trim()}\n`;
  const splitMd = (text) => { const m = String(text || '').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!m) return { name: '', description: '', body: String(text || '') }; const fm = {}; for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([\w-]+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2'); } return { name: fm.name || '', description: fm.description || '', body: m[2].trim() }; };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  const EXEC = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|exe)$/i;
  const SECRETISH = /(sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const price = (pricing) => { const p = (pricing || [])[0]; if (!p || p.model === 'free' || !p.priceCredits) return 'Free'; return `${p.priceCredits} credits`; };

  // ───────────────────────── reading what a person drops in: a folder, or a .zip (stored or deflate)
  async function zipEntries(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This is not a .zip file');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This .zip is damaged');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), data = u8.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
      let bytes;
      if (method === 0) bytes = data;
      else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error(`${name} uses a compression this page cannot read`);
      out.push({ rel: name, size: bytes.length, read: async () => bytes });
    }
    return out;
  }
  // what a person picked, as paths relative to the folder they chose (its own name first) and a way to read each one
  const fromFolder = (list) => [...list].map((f) => ({ rel: f.webkitRelativePath || f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) }));
  // A file exactly as it arrived: text when its bytes are UTF-8 (a BOM and line endings kept, so the bytes come back
  // the same), otherwise its bytes as they are — an image or a font is stored by digest, never decoded into text.
  const b64 = (u8) => { let out = ''; for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(out); };
  function asFile(path, bytes) {
    let t = null; try { t = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { t = null; }
    if (t !== null && !t.includes('\0')) return { path, content: t };
    return { path, binary: true, size: bytes.length, base64: b64(bytes) };
  }
  const isBin = (f) => !!f && typeof f.content !== 'string';
  const sizeOf = (f) => (isBin(f) ? Number(f.size ?? f.bytes ?? 0) : new Blob([f.content]).size);
  const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const imgType = (path) => IMG[((String(path).match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase()] || null;
  // what goes to the server: text as text, new bytes as base64, a kept stored file by its digest
  const wire = (f) => (isBin(f) ? (f.base64 ? { path: f.path, base64: f.base64 } : { path: f.path, sha256: f.sha256 }) : { path: f.path, content: f.content });
  const fileUrl = (id, path, version) => `/api/skills/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}${version ? `&version=${encodeURIComponent(version)}` : ''}`;
  async function fetchFile(id, path, version) {
    const r = await fetch(fileUrl(id, path, version), { credentials: 'same-origin', headers: { 'x-xeno-surface': 'xeno-web' } }).catch(() => null);
    if (!r || !r.ok) throw new Error('That file could not be read');
    return new Uint8Array(await r.arrayBuffer());
  }
  async function download(id, path, version) {
    try { const u8 = await fetchFile(id, path, version); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8])); a.download = path.split('/').pop(); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    catch (e) { toast(e.message); }
  }
  // images are shown from their bytes with their real type (the server only ever answers with a download)
  const previews = new Map();
  function preview(key, get, type) {
    if (previews.has(key)) return previews.get(key);
    previews.set(key, null);
    Promise.resolve().then(get).then((u8) => { previews.set(key, URL.createObjectURL(new Blob([u8], { type }))); paint(); }).catch(() => {});
    return null;
  }
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // a dropped folder or zip usually wraps the skill in one top folder: the skill is what is inside it
  const unwrap = (files) => { const tops = new Set(files.map((f) => f.path.split('/')[0])); if (tops.size === 1 && files.every((f) => f.path.includes('/'))) { const t = [...tops][0] + '/'; return files.map((f) => ({ ...f, path: f.path.slice(t.length) })); } return files; };
  function openEditorWith(files, from) {
    const fs = unwrap(files).filter((f) => f.path).slice(0, 64);
    const top = fs.find((f) => f.path === 'SKILL.md');
    if (!top) { toast('That has no SKILL.md at its top level, so it is not a skill'); return; }
    if (isBin(top)) { toast('SKILL.md must be text'); return; }
    const m = splitMd(top.content);
    S.ed = { id: null, from, name: m.name, description: m.description, body: m.body, md0: { text: top.content, ...m }, files: fs.filter((f) => f !== top), sel: 'SKILL.md', where: teamWs() ? 'workspace' : 'personal' };
    go('Skills/new');
  }

  // ───────────────────────── loading
  async function loadList() {
    const r = await api('GET', '/api/skills');
    if (!r.ok) { S.status = r.status === 403 ? 'denied' : 'error'; return paint(); }
    S.list = r.d.skills || []; S.loaded = true;
  }
  async function loadMarket() {
    const [c, e] = await Promise.all([api('GET', `/api/marketplace/catalog?kind=skill&limit=100${S.mq ? '&q=' + encodeURIComponent(S.mq) : ''}`), api('GET', '/api/marketplace/me/entitlements')]);
    S.market = c.ok ? c.d.listings || [] : [];
    S.owned = new Set(e.ok ? (e.d.entitlements || []).filter((x) => x.status === 'active').map((x) => x.listingId) : []);
  }
  async function load() {
    const at = S.key;
    await loadList(); if (S.key !== at) return;
    const [kind, arg, sub] = at.split(':');
    if (kind === 'market') await loadMarket();
    if (kind === 'listing') {
      const [r] = await Promise.all([api('GET', `/api/marketplace/skills/${arg}/preview`), loadMarket()]);
      if (S.key !== at) return;
      if (r.status === 404) { S.status = 'missing'; return paint(); }
      if (!r.ok) { S.status = 'error'; return paint(); }
      S.listing = r.d;
    }
    if (kind === 'review') { const r = await api('GET', '/api/marketplace/submissions?state=in_review'); S.subs = r.ok ? (r.d.submissions || []).filter((x) => x.kind === 'skill') : null; }
    if (kind === 'one') {
      const [r, m] = await Promise.all([api('GET', `/api/skills/${arg}`), api('GET', '/api/marketplace/developer/skill-listings')]);
      if (S.key !== at) return;
      if (r.status === 404) { S.status = 'missing'; return paint(); }
      if (!r.ok) { S.status = 'error'; return paint(); }
      S.one = r.d.skill; S.mine = m.ok ? m.d : null;
      if (sub === 'edit') { const top = S.one.files.find((f) => f.path === 'SKILL.md') || {}; const md = splitMd(top.content); S.ed = { id: S.one.id, name: S.one.name, description: md.description, body: md.body, md0: { text: top.content, ...md }, files: S.one.files.filter((f) => f.path !== 'SKILL.md').map((f) => (isBin(f) ? { path: f.path, sha256: f.sha256, size: f.bytes, binary: true } : { ...f })), sel: 'SKILL.md', base: S.one.version }; }
    }
    S.status = 'ready'; paint();
  }
  async function call(method, path, body, fail) {
    if (S.busy) return null;
    S.busy = true; paint();
    const r = await api(method, path, body);
    S.busy = false;
    if (!r.ok) { toast(why(r, fail)); paint(); return null; }
    return r;
  }

  // A take-over pattern the person may overrule (GitHub push protection's model): show what was found, and only on their
  // explicit "Save anyway" send the same request again with acknowledge. A dangerous one is never offered.
  const findingsOf = (r) => ((r && r.d && r.d.details && r.d.details.findings) || []).map((x) => String(x).split('\n')[0]);
  const canAck = (r) => !!(r && r.d && r.d.code === 'skill_unsafe' && r.d.details && r.d.details.canAcknowledge);
  async function askAck(r, what) {
    return D().confirm({ title: 'Read this before saving', body: `XENO found instructions in ${esc(what)} that could steer an agent using it:<ul class="xsk-ack">${findingsOf(r).slice(0, 8).map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>Save it only if this is what you meant. It is kept with the version, marked as read by you.`, action: 'Save anyway' });
  }
  async function ackCall(method, path, body, fail, what) {
    if (S.busy) return null;
    S.busy = true; paint();
    let r = await api(method, path, body);
    if (!r.ok && canAck(r)) { S.busy = false; paint(); if (!(await askAck(r, what))) return null; S.busy = true; paint(); r = await api(method, path, { ...body, acknowledge: true }); }
    S.busy = false;
    if (!r.ok) { toast(why(r, fail)); paint(); return null; }
    return r;
  }

  // ───────────────────────── the editor: files, checks, what an agent sees, then create or publish a version
  const sameMd = (ed) => ed.md0 && ed.md0.name === ed.name && ed.md0.description === ed.description && ed.md0.body === ed.body;
  const edFiles = (ed) => [{ path: 'SKILL.md', content: sameMd(ed) ? ed.md0.text : skillMd(ed.name, ed.description, ed.body) }, ...ed.files];
  function checks(ed) {
    const fs = edFiles(ed), total = fs.reduce((n, f) => n + sizeOf(f), 0), text = fs.filter((f) => !isBin(f)).reduce((n, f) => n + sizeOf(f), 0), big = fs.filter((f) => (isBin(f) ? sizeOf(f) > 4 * 1024 * 1024 : sizeOf(f) > 256 * 1024)), out = [];
    out.push(NAME.test(ed.name) ? ['ok', `Name: ${ed.name}`] : ['bad', 'Name: lowercase words joined by hyphens, at most 64']);
    out.push(ed.description.trim().length >= 20 && ed.description.length <= 1024 ? ['ok', 'Says when to use it'] : ['bad', 'Say WHEN an agent should use it (20–1024 characters) — it is all the agent sees until it opens the skill']);
    out.push(ed.body.trim() ? ['ok', 'Has steps'] : ['bad', 'Write the steps']);
    out.push(fs.length <= 64 && total <= 8 * 1024 * 1024 && text <= 1024 * 1024 ? ['ok', `${fs.length} file${fs.length === 1 ? '' : 's'}, ${kb(total)}`] : ['bad', 'At most 64 files and 8 MB, of which 1 MB of text']);
    if (big.length) out.push(['bad', `Too large: ${big.map((f) => f.path).join(', ')} (a text file is at most 256 KB, any other file 4 MB)`]);
    const bad = fs.filter((f) => f.path !== 'SKILL.md' && (!f.path || f.path.startsWith('/') || f.path.split('/').some((s) => !s || s === '..')));
    if (bad.length) out.push(['bad', `Not a path inside the skill: ${bad.map((f) => f.path || '(empty)').join(', ')}`]);
    const sec = fs.filter((f) => !isBin(f) && SECRETISH.test(f.content));
    if (sec.length) out.push(['bad', `Looks like a secret in ${sec.map((f) => f.path).join(', ')} — remove it; every agent using the skill reads it`]);
    const scripts = fs.filter((f) => EXEC.test(f.path) || (!isBin(f) && /^#!/.test(f.content))).map((f) => f.path);
    if (scripts.length) out.push(['note', `Scripts: ${scripts.join(', ')}. An agent using this skill may run them with the tools it already has; people see this before installing.`]);
    return out;
  }
  function editorPage() {
    const h = H(), ed = S.ed;
    if (!ed) { go('Skills'); return h.page('', 'xsk'); }
    const fs = edFiles(ed), sel = fs.find((f) => f.path === ed.sel) || fs[0], cs = checks(ed), blocked = cs.some((c) => c[0] === 'bad');
    const tm = teamWs();
    const head = h.head({ obj: true, eyebrow: '<a data-xsk="list">Skills</a>', title: ed.id ? `Edit ${ed.name}` : ed.forAgent ? `New skill ${ed.from}` : ed.from ? `New skill from ${ed.from}` : 'New skill',
      sub: ed.id ? `Saving publishes a new version after ${ed.base}. ${ed.base} stays exactly as it is.` : 'A skill tells an agent how to do one kind of work. It is the SKILL.md format Claude Code, Codex and the XENO CLI read.',
      acts: h.btn('Cancel', `data-xsk="${ed.id ? 'open' : 'list'}" data-id="${esc(ed.id || '')}"`, true) + `<button type="button" class="pg-btn" data-xsk="ed-save"${blocked || S.busy ? ' disabled' : ''}>${ed.id ? 'Publish version' : 'Create skill'}</button>` });
    const tree = `<div class="xsk-tree" data-xsk-drop><div class="xsk-tree-h"><b>Files</b><button type="button" class="pg-link" data-xsk="ed-addfile">Add file</button></div>
      ${fs.map((f) => `<div class="xsk-file${f.path === sel.path ? ' on' : ''}"><button type="button" data-xsk="ed-sel" data-p="${esc(f.path)}"><span>${esc(f.path)}</span>${EXEC.test(f.path) || (!isBin(f) && /^#!/.test(f.content)) ? '<em>script</em>' : isBin(f) ? `<em>${imgType(f.path) ? 'image' : 'file'} · ${esc(kb(sizeOf(f)))}</em>` : ''}</button>${f.path !== 'SKILL.md' ? `<button type="button" class="xsk-x" aria-label="Remove ${esc(f.path)}" data-xsk="ed-rm" data-p="${esc(f.path)}">${ic('x')}</button>` : ''}</div>`).join('')}
      <p class="xsk-hint">Drop files here to add them.</p></div>`;
    const main = sel.path === 'SKILL.md' ? `<div class="xsk-edf">
        <label><span>Name</span><input data-xsk-ed="name" value="${esc(ed.name)}" maxlength="64" placeholder="ledger-review"${ed.id ? ' readonly title="A new version keeps the name; a different name is a different skill"' : ''}></label>
        <label><span>When to use it</span><textarea data-xsk-ed="description" rows="2" maxlength="1024" placeholder="Use when a change touches money: how to check it before sending it for review.">${esc(ed.description)}</textarea></label>
        <label class="grow"><span>Steps</span><textarea data-xsk-ed="body" spellcheck="false" placeholder="1. Run the ledger tests.&#10;2. Reconcile the totals.&#10;3. Report what changed, how you checked it, what you are unsure of.">${esc(ed.body)}</textarea></label></div>`
      : isBin(sel) ? binPanel(sel, ed)
      : `<div class="xsk-edf"><label><span>Path</span><input data-xsk-path="${esc(sel.path)}" value="${esc(sel.path)}" maxlength="200"></label><label class="grow"><span>Content</span><textarea data-xsk-file="${esc(sel.path)}" spellcheck="false">${esc(sel.content)}</textarea></label></div>`;
    const side = `<aside class="xsk-side"><section><h3>Checks</h3><ul class="xsk-checks">${cs.map(([k, t]) => `<li class="${k}"><i>${k === 'ok' ? ic('check') : k === 'bad' ? ic('x') : ic('alert')}</i><span>${esc(t)}</span></li>`).join('')}</ul>${ed.check ? `<ul class="xsk-checks xsk-server">${ed.check.level === 'clean' ? `<li class="ok"><i>${ic('check')}</i><span>XENO’s checks found nothing</span></li>` : [...ed.check.block.map((x) => ['bad', x]), ...ed.check.confirm.map((x) => ['note', x]), ...ed.check.review.map((x) => ['note', x])].slice(0, 8).map(([k, x]) => `<li class="${k}"><i>${k === 'bad' ? ic('x') : ic('alert')}</i><span>${k === 'bad' ? 'Refused' : x.level === 'confirm' ? 'Needs your yes' : 'Note'}: ${esc(x.says)} <code>${esc(x.file)}${x.line ? ':' + esc(x.line) : ''}</code></span></li>`).join('')}</ul>` : ''}
      <p class="xsk-hint">XENO checks every file when you save: secrets, instructions that try to take over an agent, and code that downloads and runs things, steals credentials or hides what it does. <button type="button" class="pg-link" data-xsk="ed-check"${S.busy ? ' disabled' : ''}>Check now</button></p></section>
      <section><h3>What an agent sees</h3><p class="xsk-hint">Always, in its brief:</p><pre class="xsk-pre">- ${esc(ed.name || 'name')}: ${esc(ed.description || 'when to use it')}</pre><p class="xsk-hint">When it decides to use it, the steps and, when they mention them, the files.</p></section>
      ${!ed.id && tm ? `<section><h3>Belongs to</h3><div class="pg-seg" role="radiogroup" aria-label="Belongs to"><button role="radio" aria-checked="${ed.where === 'workspace'}" data-xsk="ed-where" data-k="workspace">${esc(tm.name || 'Workspace')}</button><button role="radio" aria-checked="${ed.where !== 'workspace'}" data-xsk="ed-where" data-k="personal">Only me</button></div></section>` : ''}</aside>`;
    return h.page(head + `<div class="xsk-editor">${tree}<div class="xsk-ed-main">${main}</div>${side}</div>`, 'xsk');
  }
  // a binary file in the editor: its path can change; its bytes are kept exactly (an image is shown)
  function binPanel(f, ed) {
    const t = imgType(f.path);
    const src = t ? preview(f.base64 ? `new:${f.path}:${f.size}` : `${ed.id}:${ed.base}:${f.sha256}`, () => (f.base64 ? fromB64(f.base64) : fetchFile(ed.id, f.path, ed.base)), t) : null;
    return `<div class="xsk-edf"><label><span>Path</span><input data-xsk-path="${esc(f.path)}" value="${esc(f.path)}" maxlength="200"></label>
      <div class="xsk-bin">${t ? (src ? `<img src="${esc(src)}" alt="${esc(f.path)}">` : '<div class="xsk-bin-ph" aria-busy="true"></div>') : `<span class="xsk-ic">${ic('doc')}</span>`}
        <p><b>${esc(f.path.split('/').pop())}</b><small>${t ? 'Image' : 'A file that is not text'} · ${esc(kb(sizeOf(f)))}. Its bytes are kept exactly as they are; replace it by dropping a new one here.</small></p></div></div>`;
  }
  async function checkEditor() {
    const ed = S.ed; if (!ed) return;
    const r = await call('POST', '/api/skills/check', { files: edFiles(ed).map(wire) }, 'It could not be checked.');
    if (r) { ed.check = r.d; paint(); }
  }
  async function saveEditor() {
    const ed = S.ed; if (!ed) return;
    const files = edFiles(ed).map(wire);
    if (ed.id) {
      const r = await ackCall('POST', `/api/skills/${ed.id}/versions`, { files }, 'The version could not be published.', ed.name);
      if (r) { toast(`Published ${r.d.skill.version}`); S.ed = null; S.key = null; go(`Skills/${ed.id}`); }
      return;
    }
    const r = await ackCall('POST', '/api/skills', { files, workspaceId: ed.where === 'workspace' && teamWs() ? wsId() : null }, 'The skill could not be created.', ed.name || 'this skill');
    if (!r) return;
    toast(`Created ${r.d.skill.name}`); S.list.unshift(r.d.skill);
    // started from an agent's Identity tab: give it to that agent, then go back there
    if (ed.forAgent && window.XENO_AGENTS && window.XENO_AGENTS.addSkill) { S.ed = null; return window.XENO_AGENTS.addSkill(ed.forAgent, r.d.skill); }
    S.ed = null; go(`Skills/${r.d.skill.id}`);
  }
  async function addFile() {
    const v = await D().form({ title: 'Add a file', sub: 'A reference the steps point to, a template, or a script. To add an image or a font, drop it onto the file list.', submit: 'Add', size: 'sm', fields: [{ id: 'path', label: 'Path inside the skill', required: true, max: 200, placeholder: 'reference/checklist.md' }] });
    if (!v) return;
    const path = v.path.trim().replace(/\\/g, '/');
    if (path === 'SKILL.md' || S.ed.files.some((f) => f.path === path)) return toast('That file already exists');
    S.ed.files.push({ path, content: '' }); S.ed.sel = path; paint();
  }

  // ───────────────────────── publishing to the Marketplace and installing from it
  async function publish() {
    const s = S.one; if (!s) return;
    let mine = (await api('GET', '/api/marketplace/developer/skill-listings')).d || {};
    if (!mine.developer) {
      const v = await D().form({ title: 'Publish as…', sub: 'Your publisher name and handle are shown on everything you publish, as @handle/skill. Choose them once.', submit: 'Continue', size: 'sm', fields: [
        { id: 'name', label: 'Publisher name', required: true, max: 120, placeholder: 'Ada Labs' }, { id: 'handle', label: 'Handle', required: true, max: 60, placeholder: 'ada-labs', hint: 'Lowercase words joined by hyphens' }] });
      if (!v) return;
      const r = await call('POST', '/api/marketplace/developer/register', { displayName: v.name, slug: slug(v.handle) }, 'Your publisher profile could not be created.');
      if (!r) return;
      mine = (await api('GET', '/api/marketplace/developer/skill-listings')).d || {};
    }
    let listing = (mine.listings || []).find((l) => l.sourceSkill === s.id);
    if (!listing) {
      const v = await D().form({ title: `Publish ${s.name} to the Marketplace`, sub: `Everyone can find it as @${mine.developer.handle}/${s.name}. XENO checks it, a person reviews it, then it is published. Each version stays exactly as published; nobody is updated without installing.`, submit: 'Continue', size: 'md', fields: [
        { id: 'title', label: 'Title', required: true, max: 200, value: s.name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) },
        { id: 'summary', label: 'One line', required: true, max: 500, value: s.description.slice(0, 500) },
        { id: 'license', label: 'Licence', type: 'choice', cols: 1, required: true, value: 'MIT', options: [['MIT', 'MIT', 'Anyone may use, change and pass it on'], ['Apache-2.0', 'Apache 2.0', 'The same, with a patent grant'], ['CC-BY-4.0', 'CC BY 4.0', 'Use and change it, crediting you'], ['LicenseRef-XENO-Marketplace-Redistributable', 'XENO Marketplace', 'Use it on XENO; passing it on is allowed']] },
        { id: 'price', label: 'Price in credits', value: '0', max: 7, hint: '0 makes it free' }] });
      if (!v) return;
      const n = Math.max(0, Math.floor(Number(v.price) || 0));
      const r = await call('POST', '/api/marketplace/listings', { kind: 'skill', title: v.title, summary: v.summary, license: v.license, slug: `${mine.developer.handle}-${s.name}`, pricing: [n ? { model: 'one_time', priceCredits: n } : { model: 'free', priceCredits: 0 }] }, 'The listing could not be created.');
      if (!r) return;
      listing = { id: r.d.listing.id };
    }
    const ver = await call('POST', `/api/marketplace/listings/${listing.id}/versions`, { version: s.version, skillId: s.id, skillVersion: s.version }, 'This version could not be added.');
    if (!ver) return;
    const sub = await api('POST', `/api/marketplace/listings/${listing.id}/submit`, { versionId: ver.d.version.id });
    if (!sub.ok) return toast(why(sub, 'It did not pass the checks.'));
    toast(`${s.name} ${s.version} is in review — it is published once a person approves it`); S.key = null; paint();
  }
  async function getAndInstall() {
    const L = S.listing; if (!L) return;
    const id = L.listing.id;
    if (!S.owned.has(id)) {
      const paid = price(L.listing.pricing) !== 'Free';
      if (paid && !(await D().confirm({ title: `Buy ${esc(L.listing.title)}?`, body: `${esc(price(L.listing.pricing))} from your balance. You own it for good, including later versions.`, action: 'Buy' }))) return;
      const r = await call('POST', `/api/marketplace/listings/${id}/purchase`, {}, paid ? 'It could not be bought.' : 'It could not be added.');
      if (!r) return;
      S.owned.add(id);
    }
    const tm = teamWs();
    let workspaceId = null;
    if (tm) {
      const v = await D().form({ title: 'Install to…', submit: 'Install', size: 'sm', fields: [{ id: 'where', label: 'Library', type: 'choice', cols: 1, value: 'workspace', options: [['workspace', tm.name || 'This workspace', 'Its members can give it to their agents'], ['personal', 'Only me', 'Your own library']] }] });
      if (!v) return;
      workspaceId = v.where === 'workspace' ? wsId() : null;
    }
    const r = await api('POST', `/api/marketplace/listings/${id}/install-skill`, { workspaceId });
    if (!r.ok && r.d && r.d.code === 'skill_name_taken') {
      const v = await D().form({ title: 'Install under another name', sub: why(r, 'Your library already has a skill with that name.'), submit: 'Install', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 64, value: `${L.current.name}-2` }] });
      if (!v) return;
      const r2 = await call('POST', `/api/marketplace/listings/${id}/install-skill`, { workspaceId, name: slug(v.name) }, 'It could not be installed.');
      if (r2) { toast(`Installed ${r2.d.skill.name} ${r2.d.skill.version}`); await loadList(); go(`Skills/${r2.d.skill.id}`); }
      return;
    }
    if (!r.ok) return toast(why(r, 'It could not be installed.'));
    toast(r.d.skill.installed === 'already' ? 'It is already in your library' : `Installed ${r.d.skill.name} ${r.d.skill.version}`);
    await loadList(); go(`Skills/${r.d.skill.id}`);
  }
  async function updateFrom(listingId) {
    const r = await call('POST', `/api/marketplace/listings/${listingId}/install-skill`, {}, 'It could not be updated.');
    if (r) { toast(`Updated to ${r.d.skill.version}. Agents keep their version until you move them.`); S.key = null; paint(); }
  }
  async function decide(id, ok) {
    let notes = '';
    if (!ok) { const v = await D().form({ title: 'Send it back', sub: 'The publisher reads this.', submit: 'Reject', size: 'sm', fields: [{ id: 'notes', label: 'Why', type: 'textarea', required: true, max: 2000 }] }); if (!v) return; notes = v.notes; }
    const r = await call('POST', `/api/marketplace/submissions/${id}/${ok ? 'approve' : 'reject'}`, { notes }, ok ? 'It could not be approved.' : 'It could not be rejected.');
    if (r) { toast(ok ? `Published ${r.d.publishedVersion}` : 'Sent back'); S.key = null; paint(); }
  }
  async function importGitHub(form) {
    const url = form.url.value.trim(); if (!url) return;
    const r = await ackCall('POST', '/api/skills/import/github', { url, workspaceId: teamWs() ? wsId() : null }, 'It could not be imported.', 'this GitHub skill');
    if (r) { toast(`Imported ${r.d.skill.name} — read it before giving it to an agent`); S.list.unshift(r.d.skill); S.showImport = false; go(`Skills/${r.d.skill.id}`); }
  }

  // ───────────────────────── XENO Corpus: a skills folder (`<corpus>/skills`), imported skill by skill with its history
  // The folder is read here only to group what belongs to each skill; the server re-checks every byte with Corpus's
  // own rules and refuses on any problem. Only the store's own .lock and .tmp files are skipped — a skill may ship one.
  function corpusFrom(entries, store) {
    const root = store.dir ? store.dir + '/' : '';
    const at = new Map(entries.filter((e) => e.rel.startsWith(root)).map((e) => [e.rel.slice(root.length), e]));
    const items = store.sidecars.map((name) => ({ name, variant: name.includes('@'), state: 'ready', msg: '' })).sort((a, b) => a.name.localeCompare(b.name));
    return { root, at, items, workspace: teamWs() ? wsId() : null, running: false };
  }
  async function corpusBody(c, it) {
    const text = async (e) => (e ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(await e.read()) : '');
    const bytes = async (e) => b64(await e.read());
    const sidecar = await text(c.at.get(`${it.name}.skill.json`));
    const revisions = await text(c.at.get(`${it.name}.revisions.jsonl`));
    let rec = {}; try { rec = JSON.parse(sidecar); } catch { /* the server says why */ }
    const files = [];
    for (const f of Array.isArray(rec.files) ? rec.files : []) { const file = c.at.get(`${it.name}/${f.rel}`); if (file) files.push({ rel: f.rel, base64: await bytes(file) }); }
    const want = new Set();
    for (const line of revisions.split('\n')) { if (!line.trim()) continue; try { for (const m of JSON.parse(line).manifest || []) want.add(m.sha256); } catch { /* the server says why */ } }
    const objects = [];
    for (const d of want) { const file = c.at.get(`.objects/${String(d).replace(/^sha256:/, '')}`); if (file) objects.push({ sha256: d, base64: await bytes(file) }); }
    return { name: it.name, sidecar, revisions, files, objects, workspaceId: c.workspace };
  }
  async function importCorpusOne(it, as, acknowledge) {
    const c = S.corpus; if (!c || it.variant) return;
    it.state = 'importing'; it.msg = ''; paint();
    let r; try { r = await api('POST', '/api/skills/import/corpus', { ...(await corpusBody(c, it)), ...(as ? { as } : {}), ...(acknowledge ? { acknowledge: true } : {}) }); } catch { r = { ok: false, d: {} }; }
    if (!r.ok && canAck(r)) { it.state = 'unsafe'; it.ack = r; it.msg = why(r, 'It needs reading first.'); return paint(); }
    if (r.ok) {
      const k = r.d.skill;
      it.state = 'done'; it.id = k.id;
      it.msg = k.imported === 'new' ? `Imported as ${k.name} · ${k.version}` : k.imported === 'updated' ? `Added ${k.versionsAdded} version${k.versionsAdded === 1 ? '' : 's'} · now ${k.version}` : 'Already in your library';
    } else { it.state = r.d && r.d.code === 'skill_name_taken' ? 'taken' : 'refused'; it.msg = why(r, 'It could not be imported.'); }
    paint();
  }
  async function importCorpusAll() {
    const c = S.corpus; if (!c || c.running) return;
    c.running = true; paint();
    for (const it of c.items) if (!it.variant && (it.state === 'ready' || it.state === 'refused')) await importCorpusOne(it);
    c.running = false; await loadList(); paint();
    const done = c.items.filter((x) => x.state === 'done').length;
    toast(`${done} of ${c.items.filter((x) => !x.variant).length} skills imported from Corpus — read them before giving them to an agent`);
  }
  function corpusPanel() {
    const c = S.corpus; if (!c) return '';
    const h = H(), own = c.items.filter((x) => !x.variant), vars = c.items.length - own.length;
    const row = (it) => `<li class="xsk-cp-${it.state}"><b>${esc(it.name)}</b><small>${it.variant ? `Another tool’s copy of ${esc(it.name.split('@')[0])}: not imported yet` : it.state === 'importing' ? 'Checking every file…' : esc(it.msg || 'Ready')}</small>
      <span>${it.state === 'done' && it.id ? `<button type="button" class="pg-link" data-xsk="open" data-id="${esc(it.id)}">Open</button>` : it.state === 'taken' ? `<button type="button" class="pg-link" data-xsk="cp-as" data-n="${esc(it.name)}">Import under another name</button>` : it.state === 'unsafe' ? `<button type="button" class="pg-link" data-xsk="cp-ack" data-n="${esc(it.name)}">Read and decide</button>` : !it.variant && it.state !== 'importing' ? `<button type="button" class="pg-link" data-xsk="cp-one" data-n="${esc(it.name)}">${it.state === 'refused' ? 'Try again' : 'Import'}</button>` : ''}</span></li>`;
    return `<section class="xsk-cp" aria-label="Skills from XENO Corpus"><div class="xsk-cp-h"><div><b>From XENO Corpus</b><small>${own.length} skill${own.length === 1 ? '' : 's'}${vars ? ` · ${vars} cop${vars === 1 ? 'y' : 'ies'} from other tools, kept apart until you decide which one agents use` : ''}. Each comes with every version Corpus kept, checked byte for byte; nothing is saved from a skill that fails a check.</small></div>
      <div class="xsk-acts">${h.btn('Close', 'data-xsk="cp-close"', true)}<button type="button" class="pg-btn" data-xsk="cp-all"${c.running ? ' disabled' : ''}>${c.running ? 'Importing…' : 'Import all'}</button></div></div><ul class="xsk-cp-list">${c.items.map(row).join('')}</ul></section>`;
  }

  // ───────────────────────── any folder: a skill, a tool's skills (Claude Code, Codex, agy, XENO CLI, plugins), a project,
  // a repository, or a Corpus store. WHAT is in it is decided on the server by XENO Corpus's detectBundles — the same rules
  // Corpus applies on a disk (a skill is a folder whose SKILL.md names it and says when to use it; SKIP_DIRS; one level of
  // containers; its limits). The page sends paths, sizes and each SKILL.md's text; the files themselves stay here until saved.
  const TOOL = { claude: 'Claude Code', codex: 'Codex', agy: 'agy', workspace: 'Workspace', 'xeno-cli': 'XENO CLI', plugin: 'Plugin', unknown: '' };
  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const fileSha = async (u8) => 'sha256:' + hex(await crypto.subtle.digest('SHA-256', u8));
  async function importPicked(entries, label) {
    const at = new Map(entries.map((e) => [e.rel, e]));
    const sent = await Promise.all(entries.map(async (e) => (/(^|\/)SKILL\.md$/.test(e.rel) ? { rel: e.rel, bytes: e.size, text: new TextDecoder().decode(await e.read()) } : { rel: e.rel, bytes: e.size })));
    const dr = await api('POST', '/api/skills/detect', { entries: sent });
    if (!dr.ok) return toast(why(dr, 'That folder could not be read.'));
    const d = dr.d;
    if (d.layout === 'none') return toast('No skill found there. A skill is a folder with a SKILL.md in it.');
    S.showImport = false;
    if (d.layout === 'corpus-store') { S.corpus = corpusFrom(entries, d.store); return paint(); }
    // one skill — at the top, or the one folder that was picked (a folder pick and most zips wrap it in its own name)
    const one = d.bundles.length === 1 && d.bundles[0].state === 'ok' && (d.layout === 'single-bundle' || !d.bundles[0].dir.includes('/')) ? d.bundles[0] : null;
    if (one) return openEditorWith(await Promise.all(one.files.map(async (rel) => asFile(rel, await at.get((one.dir ? one.dir + '/' : '') + rel).read()))), label);
    const F = S.found = { label, at, workspace: teamWs() ? wsId() : null, running: false, skipped: d.skipped.length, roots: d.roots,
      items: d.bundles.map((b) => ({ key: b.dir, name: b.name, dir: b.dir, tool: b.tool, files: b.files, state: b.state === 'ok' ? 'checking' : 'refused', msg: b.state === 'ok' ? '' : b.reason })) };
    paint();
    // what each one is to THIS library — from file fingerprints; the bundle digest is Corpus's code on the server
    const ok = F.items.filter((i) => i.state === 'checking');
    const bundles = [];
    for (const it of ok) { const pre = it.dir ? it.dir + '/' : ''; bundles.push({ key: it.key, name: it.name, files: await Promise.all(it.files.map(async (rel) => ({ rel, sha256: await fileSha(await at.get(pre + rel).read()) }))) }); }
    const r = bundles.length ? await api('POST', '/api/skills/match', { workspaceId: F.workspace, bundles }) : { ok: true, d: { results: [] } };
    if (S.found !== F) return;
    if (!r.ok) { for (const it of ok) { it.state = 'refused'; it.msg = why(r, 'Could not be checked.'); } return paint(); }
    const byKey = new Map(r.d.results.map((x) => [x.key, x]));
    const seenDigest = new Map(), seenName = new Map();
    for (const it of ok) {
      const m = byKey.get(it.key) || { status: 'invalid' };
      it.digest = m.bundleDigest; it.skill = m.skill || null;
      const twin = it.digest && seenDigest.get(it.digest);
      if (twin) { it.state = 'twin'; it.msg = `The same skill as ${twin.name}${TOOL[twin.tool] ? ' from ' + TOOL[twin.tool] : ''}, byte for byte`; continue; }
      if (it.digest) seenDigest.set(it.digest, it);
      if (m.status === 'same') { it.state = 'same'; it.msg = `Already in your library as ${m.skill.name} · ${m.skill.version}`; continue; }
      if (m.status === 'invalid') { it.state = 'refused'; it.msg = 'Its files could not be read'; continue; }
      const first = seenName.get(it.name);
      if (first) { it.state = 'clash'; it.msg = `Another ${it.name}${TOOL[it.tool] ? ' (' + TOOL[it.tool] + ')' : ''} with different content`; continue; }
      seenName.set(it.name, it);
      if (m.status === 'changed') { it.state = 'changed'; it.msg = `Changed: adds a new version of ${m.skill.name} (now ${m.skill.version})`; continue; }
      if (m.status === 'taken') { it.state = 'clash'; it.msg = `${m.skill.name} in your library came from the Marketplace`; continue; }
      it.state = 'ready'; it.msg = 'New';
    }
    paint();
    // before anything is saved: secrets, instructions that steer an agent, and what the files would DO (XENO Corpus's
    // malicious-skill rules) — a refusal shows here, a "needs your yes" waits for the person, the rest can go in
    for (const it of F.items.filter((x) => x.state === 'ready' || x.state === 'changed')) {
      if (S.found !== F) return;
      await preflightItem(F, it); paint();
    }
  }
  const verdict = (xs) => xs.slice(0, 2).map((x) => `${x.says} (${x.file}${x.line ? ':' + x.line : ''})`).join('; ') + (xs.length > 2 ? ` and ${xs.length - 2} more` : '');
  async function preflightItem(F, it) {
    const pre = it.dir ? it.dir + '/' : '';
    let r; try { r = await api('POST', '/api/skills/check', { files: await Promise.all(it.files.map(async (rel) => ({ path: rel, base64: b64(await F.at.get(pre + rel).read()) }))) }); } catch { r = { ok: false, d: {} }; }
    if (!r.ok) { if (r.d && r.d.code === 'skill_has_secret') { it.state = 'refused'; it.msg = why(r, 'It contains a secret.'); } return; }
    it.check = r.d;
    if (r.d.level === 'block') { it.state = 'refused'; it.msg = `Refused: it ${verdict(r.d.block)}`; return; }
    if (r.d.level === 'confirm') {
      it.wasChanged = it.wasChanged || it.state === 'changed';
      it.state = 'unsafe'; it.msg = `Needs your yes: it ${verdict(r.d.confirm)}`;
      it.ack = { d: { code: 'skill_unsafe', details: { canAcknowledge: true, findings: r.d.confirm.map((x) => `${x.file}${x.line ? ':' + x.line : ''} — ${x.says}`) } } };
      return;
    }
    if (r.d.level === 'review') it.msg += ` · ${r.d.review.length} note${r.d.review.length === 1 ? '' : 's'} to read`;
  }
  async function importFound(it, opts = {}) {
    const F = S.found; if (!F) return;
    it.state = 'importing'; paint();
    const pre = it.dir ? it.dir + '/' : '';
    let r;
    try {
      const files = await Promise.all(it.files.map(async (rel) => ({ path: rel, base64: b64(await F.at.get(pre + rel).read()) })));
      const ack = opts.ack ? { acknowledge: true } : {};
      r = it.wasChanged && !opts.as
        ? await api('POST', `/api/skills/${it.skill.id}/versions`, { files, ...ack })
        : await api('POST', '/api/skills', { files, workspaceId: F.workspace, source: { kind: 'folder', tool: it.tool }, ...(opts.as ? { as: opts.as } : {}), ...ack });
    } catch { r = { ok: false, d: {} }; }
    if (r.ok) { it.state = 'done'; it.id = r.d.skill.id; it.msg = it.wasChanged && !opts.as ? `Added version ${r.d.skill.version}` : `Imported as ${r.d.skill.name} · ${r.d.skill.version}`; }
    else if (canAck(r)) { it.state = 'unsafe'; it.ack = r; it.msg = why(r, 'It needs reading first.'); }
    else if (r.d && r.d.code === 'skill_name_taken') { it.state = 'clash'; it.msg = why(r, 'That name is taken.'); }
    else { it.state = 'refused'; it.msg = why(r, 'It could not be imported.'); }
    paint();
  }
  async function importFoundAll() {
    const F = S.found; if (!F || F.running) return;
    F.running = true; paint();
    for (const it of F.items) { if (it.state === 'changed') it.wasChanged = true; if (it.state === 'ready' || it.state === 'changed') await importFound(it, {}); }
    F.running = false; await loadList(); paint();
    toast(`${F.items.filter((x) => x.state === 'done').length} skill${F.items.filter((x) => x.state === 'done').length === 1 ? '' : 's'} imported — read them before giving them to an agent`);
  }
  function foundPanel() {
    const F = S.found; if (!F) return '';
    const h = H(), n = (st) => F.items.filter((x) => st.includes(x.state)).length;
    const tools = [...new Set(F.items.map((x) => TOOL[x.tool]).filter(Boolean))];
    const act = (it) => it.state === 'done' && it.id ? `<button type="button" class="pg-link" data-xsk="open" data-id="${esc(it.id)}">Open</button>`
      : it.state === 'same' && it.skill ? `<button type="button" class="pg-link" data-xsk="open" data-id="${esc(it.skill.id)}">Open</button>`
      : it.state === 'ready' ? `<button type="button" class="pg-link" data-xsk="fd-one" data-k="${esc(it.key)}">Import</button>`
      : it.state === 'changed' ? `<button type="button" class="pg-link" data-xsk="fd-one" data-k="${esc(it.key)}">Add version</button>`
      : it.state === 'clash' ? `<button type="button" class="pg-link" data-xsk="fd-as" data-k="${esc(it.key)}">Import under another name</button>`
      : it.state === 'unsafe' ? `<button type="button" class="pg-link" data-xsk="fd-ack" data-k="${esc(it.key)}">Read and decide</button>` : '';
    const row = (it) => `<li class="xsk-cp-${it.state === 'done' || it.state === 'same' ? 'done' : it.state}"><b title="${esc(it.dir)}">${esc(it.name || it.dir)}</b><span class="xsk-tool">${esc(TOOL[it.tool] || '')}</span><small>${it.state === 'checking' ? 'Checking…' : it.state === 'importing' ? 'Checking every file…' : esc(it.msg)}</small><span>${act(it)}</span></li>`;
    return `<section class="xsk-cp" aria-label="Skills found"><div class="xsk-cp-h"><div><b>Found in ${esc(F.label)}</b><small>${F.items.length} skill${F.items.length === 1 ? '' : 's'}${tools.length ? ' from ' + esc(tools.join(', ')) : ''} · ${n(['ready'])} new, ${n(['changed'])} changed, ${n(['same', 'twin'])} already here${n(['unsafe']) ? `, ${n(['unsafe'])} need${n(['unsafe']) === 1 ? 's' : ''} your yes` : ''}${n(['refused']) ? `, ${n(['refused'])} refused` : ''}${F.skipped ? ` · ${F.skipped} folder${F.skipped === 1 ? '' : 's'} without a SKILL.md skipped` : ''}. Each is checked file by file when it is saved; nothing is saved from a skill that fails a check.</small></div>
      <div class="xsk-acts">${h.btn('Close', 'data-xsk="fd-close"', true)}<button type="button" class="pg-btn" data-xsk="fd-all"${F.running || !n(['ready', 'changed']) ? ' disabled' : ''}>${F.running ? 'Importing…' : `Import ${n(['ready', 'changed'])}`}</button></div></div><ul class="xsk-cp-list xsk-fd">${F.items.map(row).join('')}</ul></section>`;
  }

  // ───────────────────────── pages
  const tabs = (cur) => H().tabs([['', 'Library', S.loaded ? S.list.length : ''], ['Marketplace', 'Marketplace'], ...(P.isAdmin && P.isAdmin() ? [['Review', 'Review']] : [])], cur, 'data-xsk-tab');
  function listPage() {
    const h = H(), q = S.q.toLowerCase();
    const rows = S.list.filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q));
    const head = h.head({ title: 'Skills', sub: 'How your agents do one kind of work: written once, given to any agent, at a version that never changes under it.', acts: h.btn('Import', 'data-xsk="import"', true, 'download') + h.btn('New skill', 'data-xsk="new"', false, 'plus') });
    const imp = S.showImport ? `<section class="xsk-import" aria-label="Import a skill">
        <form class="xsk-imp" data-xsk-form="github"><b>From GitHub</b><small>A public skill folder, for example from github.com/anthropics/skills</small><div><input name="url" placeholder="https://github.com/owner/repo/tree/main/skills/name" aria-label="GitHub folder link"><button type="submit" class="pg-btn"${S.busy ? ' disabled' : ''}>Import</button></div></form>
        <label class="xsk-imp"><b>A folder</b><small>One skill, or many: your Claude Code, Codex or agy skills, a project, or your XENO Corpus</small><span class="pg-btn ghost">Choose folder</span><input type="file" data-xsk-in="folder" webkitdirectory multiple hidden></label>
        <label class="xsk-imp"><b>A .zip</b><small>The same, packed as a zip</small><span class="pg-btn ghost">Choose .zip</span><input type="file" data-xsk-in="zip" accept=".zip,application/zip" hidden></label>
        <p class="xsk-hint">XENO finds the skills in whatever you choose — <code>~/.claude/skills</code>, <code>~/.codex/skills</code>, <code>~/.gemini/config/skills</code>, a project’s <code>.claude/skills</code>, a whole repository, or <code>.xeno/corpus/skills</code> with every version Corpus kept — and says which are new, already here, or changed before anything is saved. One skill opens in the editor first.</p></section>` : '';
    const cp = corpusPanel() + foundPanel();
    if (!S.list.length) return h.page(head + tabs('') + imp + cp + `<div class="xsk-first"><h2>Teach your agents how you work</h2>
      <p>A skill is one kind of work, written down: when to use it, and the steps. Give it to any of your agents; they see its name and when to use it, and read the steps when it fits — in Claude Code, Codex, Spawn or the cloud. Write one, import one, or get one from the Marketplace.</p>
      <div class="xsk-acts">${h.btn('Write a skill', 'data-xsk="new"', false, 'plus')}${h.btn('Browse the Marketplace', 'data-xsk-tab="Marketplace"', true)}</div></div>`, 'xsk');
    return h.page(head + tabs('') + imp + cp + `<div class="pg-bar"><label class="pg-search">${ic('search')}<input data-xsk-q value="${esc(S.q)}" placeholder="Search your skills" aria-label="Search your skills"></label></div>`
      + (rows.length ? `<div class="xsk-rows">${rows.map((s) => `<div class="xsk-row"><button type="button" class="xsk-row-b" data-xsk="open" data-id="${esc(s.id)}"><span class="xsk-ic">${ic('doc')}</span><span class="xsk-b"><b>${esc(s.name)}</b><small>${esc(s.description)}</small></span></button>
          <span class="xsk-m">${s.origin ? `From the Marketplace · ` : s.owner.kind === 'workspace' ? 'Workspace · ' : ''}${esc(s.version || '')}${s.scripts && s.scripts.length ? ' · scripts' : ''}</span>
          ${s.origin && s.origin.latest && s.origin.latest !== s.version ? `<button type="button" class="pg-btn ghost xsk-sm" data-xsk="update" data-id="${esc(s.origin.listingId)}">Update to ${esc(s.origin.latest)}</button>` : '<span></span>'}</div>`).join('')}</div>`
        : h.box('search', `No skill matches “${esc(S.q)}”`, 'Try a shorter word.', h.btn('Clear search', 'data-xsk="clearq"', true))), 'xsk');
  }
  function marketPage() {
    const h = H(), L = S.market || [];
    const head = h.head({ title: 'Skills', sub: 'Every published skill, by its publisher. Each is checked by XENO and reviewed by a person before it appears.', acts: h.btn('New skill', 'data-xsk="new"', false, 'plus') });
    const bar = `<div class="pg-bar"><form class="pg-search" data-xsk-form="mq">${ic('search')}<input name="q" value="${esc(S.mq)}" placeholder="Search the Marketplace" aria-label="Search the Marketplace"></form></div>`;
    if (!L.length) return h.page(head + tabs('Marketplace') + bar + `<div class="xsk-first"><h2>${S.mq ? `Nothing found for “${esc(S.mq)}”` : 'Be the first to publish'}</h2><p>Publish a skill from your library: open it and choose Publish to Marketplace. It is checked, a person reviews it, and then anyone on XENO can give it to their agents.</p></div>`, 'xsk');
    return h.page(head + tabs('Marketplace') + bar + `<div class="xsk-grid">${L.map((l) => `<button type="button" class="xsk-card" data-xsk="listing" data-id="${esc(l.id)}">
        <span class="xsk-card-h"><b>${esc(l.title)}</b>${l.trustTier !== 'community' ? `<em>${esc(l.trustTier)}</em>` : ''}</span><small class="xsk-by">@${esc(l.developerSlug || 'publisher')}</small>
        <span class="xsk-sum">${esc(l.summary || '')}</span><span class="xsk-card-f"><span>${esc(price(l.pricing))}</span><span>${esc(l.currentVersion || '')} · ${Number(l.installCount || 0)} install${Number(l.installCount) === 1 ? '' : 's'}</span></span></button>`).join('')}</div>`, 'xsk');
  }
  function listingPage() {
    const h = H(), L = S.listing; if (!L || !L.current) return null;
    const c = L.current, owned = S.owned.has(L.listing.id), have = S.list.find((s) => s.origin && s.origin.listingId === L.listing.id);
    const cta = have ? (have.version !== c.version ? h.btn(`Update to ${c.version}`, `data-xsk="update" data-id="${esc(L.listing.id)}"`) : h.btn('In your library', `data-xsk="open" data-id="${esc(have.id)}"`, true)) : h.btn(owned || price(L.listing.pricing) === 'Free' ? 'Get' : `Buy · ${price(L.listing.pricing)}`, 'data-xsk="get"');
    return h.page(h.head({ obj: true, eyebrow: '<a data-xsk-tab="Marketplace">Marketplace</a>', title: L.listing.title, sub: L.listing.summary || c.description, acts: cta })
      + `<div class="pg-cols pg-cols--item"><div>
          ${c.scripts.length ? `<div class="xsk-warn" role="note"><b>${ic('alert')}This skill includes scripts</b><span>${c.scripts.map((x) => `<code>${esc(x)}</code>`).join(' ')} — an agent using it may run them with the tools it already has. Read them before you give it to an agent.</span></div>` : ''}
          <section class="pg-sec"><div class="pg-sec-h"><h3>When an agent uses it</h3></div><p class="xsk-when">${esc(c.description)}</p></section>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Steps</h3><small>SKILL.md · ${esc(c.version)}</small></div><pre class="xsk-md">${esc(splitMd(c.skillMd).body)}</pre></section>
          ${c.files.length > 1 ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Files</h3><small>${c.files.length}</small></div><div class="xsk-files">${c.files.map((f) => `<code>${esc(f)}${c.scripts.includes(f) ? ' · script' : ''}</code>`).join('')}</div></section>` : ''}
        </div><aside><dl class="pg-props"><dt>Publisher</dt><dd>@${esc(L.listing.publisher ? L.listing.publisher.handle : '—')}</dd><dt>Price</dt><dd>${esc(price(L.listing.pricing))}</dd><dt>Licence</dt><dd>${esc(L.listing.license || '—')}</dd><dt>Installs</dt><dd>${L.listing.installCount}</dd><dt>Version</dt><dd>${esc(c.version)}</dd><dt>Hash</dt><dd><code title="${esc(c.hash)}">${esc(c.hash.slice(0, 12))}…</code></dd></dl>
          <section class="pg-sec"><div class="pg-sec-h"><h3>Versions</h3></div><ol class="xsk-vers">${L.versions.map((v) => `<li${v.version === c.version ? ' class="cur"' : ''}><b>${esc(v.version)}</b><small>${esc(new Date(v.publishedAt).toLocaleDateString())}</small></li>`).join('')}</ol>
          <p class="xsk-note">A published version never changes. Installing gives your library the current one; later versions arrive only when you choose Update, and agents keep theirs until you move them.</p></section></aside></div>`, 'xsk');
  }
  function reviewPage() {
    const h = H(), xs = S.subs;
    const head = h.head({ title: 'Skills', sub: 'Skills waiting for a person to read them before they are published.' });
    if (xs === null) return h.page(head + tabs('Review') + h.box('lock', 'Only an administrator reviews skills', ''), 'xsk');
    if (!xs.length) return h.page(head + tabs('Review') + '<div class="xsk-first"><h2>Nothing waiting</h2><p>Submitted skills appear here after XENO’s checks pass.</p></div>', 'xsk');
    return h.page(head + tabs('Review') + xs.map((x) => `<section class="xsk-rev"><div class="xsk-rev-h"><div><b>${esc(x.title)}</b> <small>@${esc(x.developer_slug || x.developer || '')} · ${esc(x.version)}</small></div><div class="xsk-acts">${h.btn('Send back', `data-xsk="reject" data-id="${esc(x.id)}"`, true)}${h.btn('Approve and publish', `data-xsk="approve" data-id="${esc(x.id)}"`)}</div></div>
        <ul class="xsk-checks">${Object.entries(x.checks || {}).map(([k, c]) => `<li class="${c.pass ? 'ok' : 'bad'}"><i>${c.pass ? ic('check') : ic('x')}</i><span>${esc(c.detail)}</span></li>`).join('')}</ul>
        ${(x.skill_scripts || []).length ? `<div class="xsk-warn"><b>${ic('alert')}Scripts</b><span>${x.skill_scripts.map((s) => `<code>${esc(s)}</code>`).join(' ')}</span></div>` : ''}
        <details><summary>Read SKILL.md${(x.skill_files || []).length > 1 ? ` and ${(x.skill_files || []).length - 1} more file(s)` : ''}</summary><pre class="xsk-md">${esc(x.skill_md || '')}</pre></details></section>`).join(''), 'xsk');
  }
  function onePage() {
    const h = H(), s = S.one; if (!s) return null;
    const md = splitMd((s.files.find((f) => f.path === 'SKILL.md') || {}).content);
    const pub = S.mine && (S.mine.listings || []).find((l) => l.sourceSkill === s.id);
    const pubLine = pub ? `${pub.status === 'published' ? `Published${pub.currentVersion ? ' ' + esc(pub.currentVersion) : ''}` : pub.lastSubmission && pub.lastSubmission.state === 'in_review' ? `${esc(pub.lastSubmission.version)} in review` : pub.lastSubmission && pub.lastSubmission.state === 'rejected' ? `${esc(pub.lastSubmission.version)} sent back` : 'Draft'} on the Marketplace` : '';
    const acts = (s.canEdit && !s.origin ? h.btn('Publish to Marketplace', 'data-xsk="publish"', true, 'send') : '') + (s.canEdit ? h.btn('Archive', 'data-xsk="archive"', true) : '') + (s.canEdit && !s.origin ? h.btn('Edit', `data-xsk="edit" data-id="${esc(s.id)}"`, false, 'edit') : '');
    return h.page(h.head({ obj: true, eyebrow: '<a data-xsk="list">Skills</a>', title: s.name, sub: s.description, acts })
      + `<div class="pg-cols pg-cols--item"><div>
          ${s.origin && s.origin.latest && s.origin.latest !== s.version ? `<div class="xsk-warn"><b>${ic('alert')}${esc(s.origin.latest)} is available</b><span>Your library has ${esc(s.version)}. Updating adds ${esc(s.origin.latest)}; agents keep their version until you move them.</span>${h.btn(`Update to ${s.origin.latest}`, `data-xsk="update" data-id="${esc(s.origin.listingId)}"`)}</div>` : ''}
          ${s.scripts && s.scripts.length ? `<div class="xsk-warn" role="note"><b>${ic('alert')}Includes scripts</b><span>${s.scripts.map((x) => `<code>${esc(x)}</code>`).join(' ')} — an agent using it may run them with the tools it already has.</span></div>` : ''}
          ${s.review && s.review.review && s.review.review.length ? `<div class="xsk-warn" role="note"><b>${ic('alert')}Read before you give it to an agent</b><span>XENO’s checks found ${s.review.reviewCount} thing${s.review.reviewCount === 1 ? '' : 's'} a person should look at — nothing that blocked saving it: ${s.review.review.slice(0, 6).map((x) => `<code>${esc(x.file)}${x.line ? ':' + esc(x.line) : ''}</code> ${esc(String(x.rule).replace(/^instructions:/, 'instructions: '))}`).join(', ')}${s.review.reviewCount > 6 ? ` and ${s.review.reviewCount - 6} more` : ''}.</span></div>` : ''}
          <section class="pg-sec"><div class="pg-sec-h"><h3>Steps</h3><small>SKILL.md · version ${esc(s.version)}</small></div><pre class="xsk-md">${esc(md.body)}</pre></section>
          ${s.files.length > 1 ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Files</h3><small>${s.files.length}</small></div><ul class="xsk-flist">${s.files.map((f) => `<li><code>${esc(f.path)}</code><small>${esc(kb(isBin(f) ? Number(f.bytes) : new Blob([f.content]).size))}${isBin(f) ? ` · ${imgType(f.path) ? 'image' : 'file'}` : ''}</small><button type="button" class="pg-link" data-xsk="dl" data-p="${esc(f.path)}" aria-label="Download ${esc(f.path)}">Download</button></li>`).join('')}</ul></section>` : ''}
        </div><aside><dl class="pg-props"><dt>Belongs to</dt><dd>${s.owner.kind === 'workspace' ? 'This workspace' : 'You'}</dd><dt>Came from</dt><dd>${s.origin ? `<a data-xsk="listing" data-id="${esc(s.origin.listingId)}">the Marketplace</a>` : s.source && s.source.kind === 'corpus' ? `XENO Corpus · ${esc(s.source.name)}` : s.source && s.source.kind === 'github' ? 'GitHub' : 'Written here'}</dd>
          ${s.bundleDigest ? `<dt>Digest</dt><dd><code title="${esc(s.bundleDigest)}">${esc(s.bundleDigest.slice(7, 19))}…</code></dd>` : ''}<dt>Version</dt><dd>${esc(s.version)}</dd><dt>Hash</dt><dd><code title="${esc(s.hash)}">${esc(s.hash.slice(0, 12))}…</code></dd>
          <dt>Id</dt><dd><code>${esc(s.id.slice(0, 12))}…</code></dd></dl>${pubLine ? `<p class="xsk-note">${pubLine}.</p>` : ''}
          <section class="pg-sec"><div class="pg-sec-h"><h3>Versions</h3></div><ol class="xsk-vers">${s.versions.map((v) => `<li${v.version === s.version ? ' class="cur"' : ''}><b>${esc(v.version)}</b><small>${esc(new Date(v.createdAt).toLocaleDateString())}</small></li>`).join('')}</ol>
          <p class="xsk-note">A version never changes. Give a skill to an agent on the agent’s Identity tab.</p></section></aside></div>`, 'xsk');
  }

  function route(it) {
    if (it !== 'Skills' && !(it || '').startsWith('Skills/')) return null;
    style();
    const rest = it === 'Skills' ? [] : it.slice(7).split('/');
    const h = H();
    let key;
    if (!rest.length) key = 'list';
    else if (rest[0] === 'Marketplace' && rest.length === 1) key = 'market';
    else if (rest[0] === 'Marketplace' && UUID.test(rest[1] || '')) key = 'listing:' + rest[1];
    else if (rest[0] === 'Review') key = 'review';
    else if (rest[0] === 'new') { if (!S.ed || S.ed.id) S.ed = { id: null, name: '', description: '', body: '', files: [], sel: 'SKILL.md', where: teamWs() ? 'workspace' : 'personal' }; return editorPage(); }
    else if (ID.test(rest[0]) && (rest.length === 1 || rest[1] === 'edit')) key = 'one:' + rest[0] + (rest[1] === 'edit' ? ':edit' : '');
    else return h.page(h.head({ eyebrow: '<a data-xsk="list">Skills</a>', title: 'Skill not found' }) + h.box('doc', 'This skill link is not valid', 'Skills are addressed by their id. Open it from the library.', h.btn('All skills', 'data-xsk="list"', true)), 'xsk');
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; S.listing = null; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xsk-skel" aria-busy="true"><i></i><i></i></div>', 'xsk');
    if (S.status === 'error') return h.page(h.box('alert', 'Skills could not be loaded just now', 'Nothing changed. Try again.', h.btn('Try again', 'data-xsk="retry"')), 'xsk');
    if (S.status === 'missing') return h.page(h.head({ eyebrow: '<a data-xsk="list">Skills</a>', title: 'Skill not found' }) + h.box('doc', 'This skill is gone', 'It was archived, unpublished, or it is not yours.', h.btn('All skills', 'data-xsk="list"', true)), 'xsk');
    if (key === 'market') return marketPage();
    if (key.startsWith('listing:')) return listingPage();
    if (key === 'review') return reviewPage();
    if (key.endsWith(':edit')) return editorPage();
    if (key.startsWith('one:')) return onePage();
    return listPage();
  }

  // ───────────────────────── events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-xsk-tab]'); if (t && t.closest('#main')) { e.preventDefault(); return go(t.dataset.xskTab ? `Skills/${t.dataset.xskTab}` : 'Skills'); }
    const b = e.target.closest('[data-xsk]'); if (!b || !b.closest('#main')) return;
    const a = b.dataset.xsk;
    if (a === 'ed-where' || a === 'ed-sel' || a === 'ed-rm') e.preventDefault();
    if (a === 'open') return b.dataset.id ? go(`Skills/${b.dataset.id}`) : go('Skills');
    if (a === 'list') { S.ed = null; return go('Skills'); }
    if (a === 'listing') return go(`Skills/Marketplace/${b.dataset.id}`);
    if (a === 'new') { S.ed = null; return go('Skills/new'); }
    if (a === 'edit') return go(`Skills/${b.dataset.id}/edit`);
    if (a === 'import') { S.showImport = !S.showImport; return paint(); }
    if (a === 'archive') return archive();
    if (a === 'publish') return publish();
    if (a === 'get') return getAndInstall();
    if (a === 'update') return updateFrom(b.dataset.id);
    if (a === 'approve') return decide(b.dataset.id, true);
    if (a === 'reject') return decide(b.dataset.id, false);
    if (a === 'ed-save') return saveEditor();
    if (a === 'ed-check') return checkEditor();
    if (a === 'ed-addfile') return addFile();
    if (a === 'ed-sel') { S.ed.sel = b.dataset.p; return paint(); }
    if (a === 'ed-rm') { S.ed.files = S.ed.files.filter((f) => f.path !== b.dataset.p); S.ed.sel = 'SKILL.md'; return paint(); }
    if (a === 'ed-where') { S.ed.where = b.dataset.k; return paint(); }
    if (a === 'retry') { S.key = null; return paint(); }
    if (a === 'dl' && S.one) return download(S.one.id, b.dataset.p, S.one.version);
    if (a === 'cp-close') { S.corpus = null; return paint(); }
    if (a === 'fd-close') { S.found = null; return paint(); }
    if (a === 'fd-all') return importFoundAll();
    if ((a === 'fd-one' || a === 'fd-as' || a === 'fd-ack') && S.found) {
      const it = S.found.items.find((x) => x.key === b.dataset.k); if (!it) return;
      if (a === 'fd-one') { if (it.state === 'changed') it.wasChanged = true; return importFound(it).then(loadList).then(paint); }
      if (a === 'fd-ack') return askAck(it.ack, it.name).then((yes) => (yes ? importFound(it, { ack: true, ...(it.as ? { as: it.as } : {}) }).then(loadList).then(paint) : null));
      return D().form({ title: 'Import under another name', sub: it.msg, submit: 'Import', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 64, value: slug(`${it.name}-${it.tool !== 'unknown' ? it.tool : 'copy'}`) }] })
        .then((v) => { if (!v) return null; it.as = slug(v.name); it.wasChanged = false; return importFound(it, { as: it.as }).then(loadList).then(paint); });
    }
    if (a === 'cp-all') return importCorpusAll();
    if (a === 'cp-one' && S.corpus) { const it = S.corpus.items.find((x) => x.name === b.dataset.n); if (it) return importCorpusOne(it).then(loadList).then(paint); }
    if (a === 'cp-ack' && S.corpus) { const it = S.corpus.items.find((x) => x.name === b.dataset.n); if (!it || !it.ack) return;
      return askAck(it.ack, it.name).then((yes) => (yes ? importCorpusOne(it, null, true).then(loadList).then(paint) : null)); }
    if (a === 'cp-as' && S.corpus) { const it = S.corpus.items.find((x) => x.name === b.dataset.n); if (!it) return;
      return D().form({ title: 'Import under another name', sub: it.msg, submit: 'Import', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 64, value: `${slug(it.name)}-corpus` }] }).then((v) => (v ? importCorpusOne(it, slug(v.name)).then(loadList).then(paint) : null)); }
    if (a === 'clearq') { S.q = ''; return paint(); }
  });
  // typing in the editor keeps the text, re-renders the checks, and puts the caret back where it was
  const keepCaret = (sel) => { const el = document.activeElement, pos = el && el.selectionStart; paint(); const n = document.querySelector(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
  document.addEventListener('input', (e) => {
    const q = e.target.closest('.xsk [data-xsk-q]'); if (q) { S.q = q.value; return keepCaret('.xsk [data-xsk-q]'); }
    const f = e.target.closest('.xsk [data-xsk-ed]'); if (f && S.ed) { S.ed[f.dataset.xskEd] = f.value; return keepCaret(`.xsk [data-xsk-ed="${f.dataset.xskEd}"]`); }
    const c = e.target.closest('.xsk [data-xsk-file]'); if (c && S.ed) { const x = S.ed.files.find((y) => y.path === c.dataset.xskFile); if (x) x.content = c.value; return keepCaret(`.xsk [data-xsk-file="${CSS.escape(c.dataset.xskFile)}"]`); }
  });
  document.addEventListener('change', async (e) => {
    const p = e.target.closest('.xsk [data-xsk-path]');
    if (p && S.ed) { const x = S.ed.files.find((y) => y.path === p.dataset.xskPath); const np = p.value.trim().replace(/\\/g, '/'); if (x && np && np !== 'SKILL.md' && !S.ed.files.some((y) => y !== x && y.path === np)) { x.path = np; S.ed.sel = np; } paint(); return; }
    const inp = e.target.closest('.xsk [data-xsk-in]'); if (!inp || !inp.files || !inp.files.length) return;
    try {
      if (inp.dataset.xskIn === 'zip') { const f = inp.files[0]; await importPicked(await zipEntries(await f.arrayBuffer()), f.name); }
      else { const list = fromFolder(inp.files); await importPicked(list, (list[0] && list[0].rel.split('/')[0]) || 'a folder'); }
    } catch (err) { toast(err && err.message ? err.message : 'That could not be read'); }
    inp.value = '';
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('.xsk [data-xsk-form]'); if (!f) return; e.preventDefault();
    if (f.dataset.xskForm === 'github') return importGitHub(f);
    if (f.dataset.xskForm === 'mq') { S.mq = f.q.value.trim(); S.key = null; return paint(); }
  });
  // drop files onto the editor's file list
  document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('.xsk [data-xsk-drop]')) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    const z = e.target.closest && e.target.closest('.xsk [data-xsk-drop]'); if (!z || !S.ed) return; e.preventDefault();
    for (const f of [...(e.dataTransfer.files || [])].slice(0, 64)) { const path = f.name; if (path === 'SKILL.md') { const m = splitMd(await f.text()); Object.assign(S.ed, { name: m.name || S.ed.name, description: m.description || S.ed.description, body: m.body }); continue; } const file = asFile(path, new Uint8Array(await f.arrayBuffer())); S.ed.files = S.ed.files.filter((x) => x.path !== path).concat(file); S.ed.sel = path; }
    paint();
  });
  async function archive() {
    const s = S.one; if (!s) return;
    if (!(await D().confirm({ title: `Archive ${esc(s.name)}?`, body: 'It leaves the library. Agents that use a version of it keep working with that version.', action: 'Archive' }))) return;
    const r = await call('DELETE', `/api/skills/${s.id}`, undefined, 'It could not be archived.');
    if (r) { toast('Archived'); S.list = S.list.filter((x) => x.id !== s.id); go('Skills'); }
  }

  const style = () => {
    if (document.getElementById('xsk-css')) return; const s = document.createElement('style'); s.id = 'xsk-css';
    s.textContent = [
      '.xsk-bin{display:flex;gap:14px;align-items:flex-start;padding:14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xsk-bin img{max-width:min(100%,420px);max-height:320px;border:1px solid var(--border);border-radius:3px;background:var(--n24)}.xsk-bin-ph{width:160px;height:120px;border-radius:3px;background:var(--n24)}.xsk-bin p{margin:0;display:flex;flex-direction:column;gap:4px;font-size:12.5px}.xsk-bin small{color:var(--muted);line-height:1.5}',
      '.xsk-flist{list-style:none;margin:0;padding:0;border:1px solid var(--n31);border-radius:6px}.xsk-flist li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--border);font-size:12.5px}.xsk-flist li:last-child{border-bottom:0}.xsk-flist code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-flist small{color:var(--muted)}',
      '.xsk-cp-list.xsk-fd li{grid-template-columns:minmax(140px,220px) 92px minmax(0,1fr) auto}.xsk-tool{font-size:11.5px;color:var(--muted);white-space:nowrap}.xsk-cp-clash small,.xsk-cp-twin small,.xsk-cp-changed small{color:var(--text)}',
      '.xsk-ack{margin:8px 0;padding-left:18px;font-size:12px}.xsk-ack code{white-space:pre-wrap;word-break:break-word}.xsk-cp-unsafe small{color:var(--text)}',
      '.xsk-cp{margin:0 0 14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel)}.xsk-cp-h{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid var(--border)}.xsk-cp-h>div:first-child{display:flex;flex-direction:column;gap:4px}.xsk-cp-h small{font-size:12px;color:var(--muted);line-height:1.5;max-width:720px}.xsk-cp-list{list-style:none;margin:0;padding:0;max-height:360px;overflow:auto}.xsk-cp-list li{display:grid;grid-template-columns:minmax(140px,240px) minmax(0,1fr) auto;gap:12px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--border);font-size:12.5px}.xsk-cp-list li:last-child{border-bottom:0}.xsk-cp-list b{font:12px ui-monospace,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-cp-list small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-cp-done small{color:var(--text)}.xsk-cp-refused small,.xsk-cp-taken small{color:var(--danger,var(--text))}',
      '.xsk-first{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:640px;margin:28px 0}.xsk-first h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}.xsk-first p{margin:0;font-size:13.5px;line-height:1.6;color:var(--muted)}.xsk-acts{display:flex;gap:8px;flex-wrap:wrap}',
      '.xsk-rows{border:1px solid var(--n31);border-radius:6px;overflow:hidden}.xsk-row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding-right:12px;border-bottom:1px solid var(--border);background:var(--panel)}.xsk-row:last-child{border-bottom:0}.xsk-row:hover{background:var(--hover)}',
      '.xsk-row-b{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;padding:12px 14px;border:0;background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer;min-width:0}',
      '.xsk-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:4px;background:var(--n24)}.xsk-ic svg{width:15px;height:15px}.xsk-b{display:flex;flex-direction:column;gap:2px;min-width:0}.xsk-b b{font-size:13px;font-weight:600;font-family:ui-monospace,Consolas,monospace}.xsk-b small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-m{font-size:12px;color:var(--muted);white-space:nowrap}.xsk-sm{height:28px;font-size:12px}',
      '.xsk-import{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin:0 0 18px}.xsk-imp{display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel);cursor:pointer}.xsk-imp b{font-size:13px}.xsk-imp small{font-size:12px;color:var(--muted)}.xsk-imp>div{display:flex;gap:8px;margin-top:4px}.xsk-imp input[name=url]{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid var(--n31);border-radius:4px;background:var(--canvas);color:var(--text);font:inherit;font-size:12.5px;outline:none}.xsk-imp .pg-btn{align-self:flex-start;margin-top:4px}.xsk-import .xsk-hint{grid-column:1/-1}',
      '.xsk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.xsk-card{display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid var(--n31);border-radius:6px;background:var(--panel);color:var(--text);font:inherit;text-align:left;cursor:pointer}.xsk-card:hover{border-color:var(--muted)}.xsk-card-h{display:flex;align-items:center;gap:8px}.xsk-card-h b{font-size:14px;font-weight:600}.xsk-card-h em{font-style:normal;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border:1px solid var(--n31);border-radius:2px;color:var(--muted)}',
      '.xsk-by{font:12px ui-monospace,Consolas,monospace;color:var(--muted)}.xsk-sum{font-size:12.5px;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:38px}.xsk-card-f{display:flex;justify-content:space-between;gap:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}',
      '.xsk-md{margin:0;padding:14px 16px;border:1px solid var(--n31);border-radius:6px;background:var(--canvas);font:12.5px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:640px;overflow:auto}.xsk-when{margin:0;font-size:13.5px;line-height:1.6}',
      '.xsk-files{display:flex;flex-wrap:wrap;gap:6px}.xsk-files code{padding:3px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px}',
      '.xsk-warn{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:12px 14px;margin-bottom:16px;border:1px solid var(--muted);border-radius:6px;background:var(--panel);font-size:12.5px}.xsk-warn b{display:flex;align-items:center;gap:6px;font-size:13px}.xsk-warn b svg{width:14px;height:14px}.xsk-warn span{flex:1 1 300px;color:var(--muted);line-height:1.5}.xsk-warn code{font-size:12px;color:var(--text)}',
      '.xsk-vers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.xsk-vers li{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)}.xsk-vers li.cur{color:var(--text)}.xsk-note{margin:10px 0 0;font-size:12px;color:var(--muted);line-height:1.5}.xsk-hint{margin:6px 0 0;font-size:12px;color:var(--dim);line-height:1.5}',
      '.xsk-editor{display:grid;grid-template-columns:220px minmax(0,1fr) 300px;gap:14px;align-items:start;min-height:560px}.xsk-tree,.xsk-side section{border:1px solid var(--n31);border-radius:6px;background:var(--panel);padding:10px}.xsk-tree-h{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px}.xsk-tree-h b{font-size:12px;font-weight:600}',
      '.xsk-file{display:flex;align-items:center;border-radius:3px}.xsk-file.on{background:var(--n24)}.xsk-file>button:first-child{flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;border:0;background:none;color:var(--text);font:12px ui-monospace,Consolas,monospace;text-align:left;cursor:pointer}.xsk-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xsk-file em{font-style:normal;font-family:Inter,system-ui,sans-serif;font-size:10.5px;color:var(--muted)}.xsk-x{border:0;background:none;color:var(--muted);padding:4px;cursor:pointer}.xsk-x svg{width:12px;height:12px}',
      '.xsk-ed-main{display:flex;flex-direction:column;min-height:560px}.xsk-edf{display:flex;flex-direction:column;gap:12px;height:100%}.xsk-edf label{display:flex;flex-direction:column;gap:6px}.xsk-edf label.grow{flex:1}.xsk-edf span{font-size:12px;font-weight:500;color:var(--muted)}',
      '.xsk-edf input,.xsk-edf textarea{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--n31);border-radius:4px;background:var(--canvas);color:var(--text);font:inherit;font-size:13px;line-height:1.5;outline:none;resize:vertical}.xsk-edf input:focus,.xsk-edf textarea:focus{border-color:var(--muted)}.xsk-edf label.grow textarea{flex:1;min-height:380px;font:12.5px/1.6 ui-monospace,Consolas,monospace}.xsk-edf input[readonly]{color:var(--muted)}',
      '.xsk-side{display:flex;flex-direction:column;gap:12px}.xsk-side h3{margin:0 0 8px;font-size:12.5px;font-weight:600}.xsk-pre{margin:6px 0;padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--canvas);font:11.5px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}',
      '.xsk-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.xsk-checks li{display:flex;gap:8px;font-size:12.5px;line-height:1.45}.xsk-checks i{flex:none;width:16px;height:16px;display:grid;place-items:center;border-radius:2px}.xsk-checks i svg{width:12px;height:12px}.xsk-checks li.ok i{background:var(--text);color:var(--canvas)}.xsk-checks li.bad i{border:1.5px solid var(--text);box-sizing:border-box}.xsk-checks li.bad span{color:var(--text)}.xsk-checks li.note span,.xsk-checks li.ok span{color:var(--muted)}',
      '.xsk-rev{padding:14px;margin-bottom:12px;border:1px solid var(--n31);border-radius:6px;background:var(--panel);display:flex;flex-direction:column;gap:10px}.xsk-rev-h{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.xsk-rev-h small{color:var(--muted);font-size:12px}.xsk-rev summary{cursor:pointer;font-size:12.5px;color:var(--muted)}.xsk-rev details .xsk-md{margin-top:8px}',
      '.xsk-skel{display:grid;gap:10px;padding-top:60px}.xsk-skel i{height:56px;border-radius:6px;background:var(--panel);animation:xsks 1.2s ease-in-out infinite alternate}@keyframes xsks{to{opacity:.5}}',
      '@media (max-width:900px){.xsk-editor{grid-template-columns:1fr}.xsk-import{grid-template-columns:1fr}.xsk-row{grid-template-columns:1fr;padding:0 12px 10px}}',
    ].join('');
    document.head.appendChild(s);
  };

  setTimeout(() => { loadList().then(paint); }, 1800);
  window.XENO_SKILLS = { served: true, route, list: () => S.list, loaded: () => S.loaded, reload: () => loadList().then(paint),
    // used by an agent's Identity tab: write a new skill in the editor (it returns to the library), or reload the list
    create: ({ forAgent = null, agentName = '' } = {}) => { S.ed = { id: null, name: '', description: '', body: '', files: [], sel: 'SKILL.md', where: teamWs() ? 'workspace' : 'personal', forAgent, from: agentName ? `for ${agentName}` : '' }; go('Skills/new'); },
    // breadcrumb words for each part of a Skills address: names, never ids
    label: (x, i, parts) => (ID.test(x) ? ((S.one && S.one.id === x) ? S.one.name : (S.list.find((s) => s.id === x) || {}).name || 'Skill') : x === 'new' ? (S.ed && S.ed.forAgent ? 'New skill for an agent' : 'New skill') : x === 'edit' ? 'Edit' : UUID.test(x) ? ((S.listing && S.listing.listing.id === x) ? S.listing.listing.title : 'Skill') : x),
    count: () => (S.loaded ? S.list.length : null), nameOf: (id) => { const s = (S.one && S.one.id === id) ? S.one : S.list.find((x) => x.id === id); return s ? s.name : 'Skill'; }, isId: (s) => ID.test(String(s || '')) };
})();
