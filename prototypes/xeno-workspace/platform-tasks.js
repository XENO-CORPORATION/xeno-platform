/* platform-tasks.js — XENO Tasks (codename Telos) in the workspace. Product spec: XENO-CORPORATION/xeno-tasks.
 *
 * One page, in every area and on Overview (#/<area>/g/tasks, #/overview/g/tasks):
 *   Board          the tasks of this area (Overview: all): search, filters, sort, board or list, saved views;
 *                  drag a card to move it; select several (x, Ctrl/Shift-click) to change them at once
 *   My tasks · Needs triage · In review     the lists people use every day
 *   T-123          one task: actions, a markdown description with checklists and inline images, sub-tasks, links,
 *                  images, activity (with what changed, from what, to what) and comments; its properties on the right,
 *                  one row each, changed in place. Watch it to hear about it.
 * and a project's Tasks tab (XENO_TASKS.projectTab), and the New task window (newTask).
 *
 * Refreshing is LOCAL: every page draws one region (`[data-tk-root]`), and an action, a poll or another person's
 * change re-draws only that region, never the workspace around it. Drafts survive it.
 * Right-click, the ⋯ button and Shift+F10 give a task's menu through XCM. Every change can be undone (XENO_HIST).
 * The platform decides who may do what; the page offers only what each task's `can` allows.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_TASKS = { served: false }; return; }
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k) => X().ic(k), toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const COLS = [['raised', 'Triage'], ['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['in_review', 'In review'], ['done', 'Done']];
  const LABEL = { raised: 'Triage', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', wont_do: 'Won’t do' };
  const MOVE = { todo: 'Accept', in_progress: 'Start', blocked: 'Blocked', in_review: 'Send to review', done: 'Done', wont_do: 'Won’t do', raised: 'Reopen' };
  const KIND = { task: ['check', 'Task'], bug: ['bolt', 'Bug'], feature: ['spark', 'Feature'], question: ['help', 'Question'] };
  const PRI = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' };
  const PRI_ORDER = ['urgent', 'high', 'medium', 'low', 'none'];
  const LINKS = [['blocks', 'Blocks'], ['blocked_by', 'Blocked by'], ['relates', 'Relates to'], ['duplicates', 'Duplicates'], ['duplicated_by', 'Duplicated by']];
  const CLOSED = ['done', 'wont_do'];
  const POLL_MS = 12000, INBOX_MS = 45000, MAX_IMG = 8 * 1024 * 1024;
  const F0 = () => ({ q: '', assignee: [], priority: [], label: [], project: [], kind: [], due: '', sort: 'priority', layout: 'board' });
  const store = { get: (k, d) => { try { const v = localStorage.getItem('xw-tasks:' + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('xw-tasks:' + k, JSON.stringify(v)); } catch {} } };
  const T = { list: null, area: undefined, loading: null, task: new Map(), status: 'loading', byProject: new Map(), people: new Map(), f: { ...F0(), ...store.get('filters', {}) }, sel: new Set(), editing: null, editComment: null, views: null, viewId: null };
  const me = () => (P.user ? String(P.user.id) : '');
  const myName = () => (P.user && (P.user.display_name || P.user.username)) || 'Me';
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const face = (p, sm) => (p ? `<span class="tk-face${sm ? ' tk-face--sm' : ''}${p.kind === 'agent' ? ' tk-face--agent' : ''}" title="${esc(p.name)}${p.kind === 'agent' ? ' (agent)' : ''}">${p.kind === 'agent' ? ic('bot') : esc(initials(p.name))}</span>` : `<span class="tk-face tk-face--none${sm ? ' tk-face--sm' : ''}" title="Unassigned">${ic('user')}</span>`);
  const when = (iso) => { const a = H().ago(iso); return a === 'just now' ? a : a + ' ago'; };
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const imgUrl = (key, id) => `/api/tasks/${encodeURIComponent(key)}/attachments/${encodeURIComponent(id)}`;
  const allLists = () => [T.list, ...T.byProject.values()].filter(Array.isArray);
  const findTask = (key) => T.task.get(key) || allLists().flat().find((x) => x.key === key) || null;
  const pkey = (t) => (t && t.project ? t.project.id : 'personal');
  const late = (t) => t.dueAt && !CLOSED.includes(t.status) && Date.parse(t.dueAt) < Date.now();
  const hist = (label, undo) => { try { window.XENO_HIST?.record(label, undo); } catch { toast(label); } };

  // ───────────────────────── data
  function load() {
    const here = P.area();
    if (T.loading && T.loadingFor === here) return T.loading;
    T.loadingFor = here;
    T.loading = (async () => {
      const r = await api('GET', '/api/tasks' + (here ? '?area=' + encodeURIComponent(here) : '')).catch(() => null);
      if (here !== P.area()) { T.loading = null; return load(); }
      T.area = here; T.loading = null;
      if (r && r.ok && Array.isArray(r.d.tasks)) { T.list = r.d.tasks; T.status = 'ready'; } else if (!T.list) T.status = 'error';
      patch();
    })();
    return T.loading;
  }
  async function loadTask(key) {
    const r = await api('GET', '/api/tasks/' + encodeURIComponent(key)).catch(() => null);
    const had = T.task.get(key);
    T.task.set(key, r && r.ok ? r.d.task : (had && !had.missing && r && r.status !== 404 ? had : { missing: true, error: !r || r.status !== 404 }));
    patch();
  }
  async function loadProject(id) {
    const r = await api('GET', '/api/tasks?projectId=' + encodeURIComponent(id)).catch(() => null);
    T.byProject.set(id, r && r.ok ? r.d.tasks : (Array.isArray(T.byProject.get(id)) ? T.byProject.get(id) : 'error'));
    patch();
  }
  async function people(projectId) {
    const k = projectId || 'personal';
    if (T.people.has(k)) return T.people.get(k);
    const r = await api('GET', '/api/tasks/assignees' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : '')).catch(() => null);
    const list = r && r.ok ? r.d.assignees : [];
    T.people.set(k, list); return list;
  }
  async function loadViews() { const r = await api('GET', '/api/tasks/views').catch(() => null); T.views = r && r.ok ? r.d.views : []; patch(); }
  const sync = () => { if (T.area !== undefined && !T.loading && P.area() !== T.area) { T.list = null; T.status = 'loading'; T.sel.clear(); load(); } };
  async function markRead(ids) { if (!ids || !ids.length) return; await api('POST', '/api/notifications/read', { ids }).catch(() => null); try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {} }

  // ───────────────────────── local refresh
  // Only the region redraws. Drafts (comment, description, search), the focused field and the scroll survive it.
  function swap(root, html) {
    if (root.__html === html) return;
    const main = document.getElementById('main'), top = main ? main.scrollTop : 0;
    const a = document.activeElement, keepId = a && root.contains(a) ? a.dataset.tkKeep : null;
    const drafts = [...root.querySelectorAll('[data-tk-keep]')].map((el) => [el.dataset.tkKeep, el.value, el.selectionStart, el.selectionEnd]);
    root.innerHTML = html; root.__html = html;
    for (const [k, v, s, e] of drafts) { const el = root.querySelector(`[data-tk-keep="${CSS.escape(k)}"]`); if (el && v != null && el.value !== v && (v || el.dataset.tkKeepEmpty !== undefined)) el.value = v; if (el && k === keepId) { el.focus(); try { el.setSelectionRange(s, e); } catch {} } }
    if (keepId && !root.contains(document.activeElement)) root.querySelector(`[data-tk-keep="${CSS.escape(keepId)}"]`)?.focus();
    if (main) main.scrollTop = top;
  }
  function patch() {
    let done = false;
    for (const root of document.querySelectorAll('#main [data-tk-root]')) { swap(root, region(root.dataset.tkRoot)); done = true; }
    for (const root of document.querySelectorAll('#main [data-tk-proot]')) { swap(root, projectRegion(root.dataset.tkProot)); done = true; }
    const open = document.querySelector('#main [data-tk-root^="task:"]');
    if (open) { const t = T.task.get(open.dataset.tkRoot.slice(5)); const b = document.querySelector('.crumbs b'); if (t && !t.missing && b && b.textContent !== `${t.key} · ${t.title}`) b.textContent = `${t.key} · ${t.title}`; }
    return done;
  }
  let polling = false;
  async function poll() {
    if (polling || document.visibilityState !== 'visible') return;
    const roots = [...document.querySelectorAll('#main [data-tk-root], #main [data-tk-proot]')];
    if (!roots.length) return;
    polling = true;
    try {
      for (const r of roots) {
        if (r.dataset.tkProot) { await loadProject(r.dataset.tkProot); continue; }
        const v = r.dataset.tkRoot || '';
        if (v.startsWith('task:')) { const k = v.slice(5), before = T.task.get(k)?.updatedAt; const res = await api('GET', '/api/tasks/' + encodeURIComponent(k)).catch(() => null); if (res && res.ok && res.d.task.updatedAt !== before) { T.task.set(k, res.d.task); patch(); } }
        else await load();
      }
    } finally { polling = false; }
  }
  setInterval(() => { poll().catch(() => {}); }, POLL_MS);
  setInterval(() => { if (document.visibilityState === 'visible') { try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {} } }, INBOX_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll().catch(() => {}); });

  // ───────────────────────── markdown (a safe subset: everything is escaped first; links are http(s) only)
  const CHECK = /^(\s*)[-*] \[( |x|X)\] (.*)$/;
  function inline(src, key) {
    const keep = []; const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
    let x = String(src).replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
    x = x.replace(/!\[([^\]\n]*)\]\(attachment:([0-9a-f-]{36})\)/gi, (_, alt, id) => hold(key ? `<a class="tk-md-imgl" href="${imgUrl(key, id)}" target="_blank" rel="noopener"><img class="tk-md-img" src="${imgUrl(key, id)}" alt="${esc(alt)}" loading="lazy"></a>` : `<span class="tk-dim">[image]</span>`));
    x = x.replace(/!\[([^\]\n]*)\]\(pending:(\d+)\)/g, (_, alt, n) => hold(`<span class="tk-chip">${ic('image')}${esc(alt || 'image ' + n)}</span>`));
    x = x.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, u) => hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`));
    x = x.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre, u) => pre + hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
    x = esc(x);
    x = x.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    x = x.replace(/(^|[^\w-])(T-\d{1,9})\b/g, '$1<a class="tk-ref" data-tk="open" data-arg="$2">$2</a>');
    x = x.replace(/(^|[^\w@.&;-])@([A-Za-z0-9][A-Za-z0-9_.-]{0,48}[A-Za-z0-9_])/g, '$1<span class="tk-mention">@$2</span>');
    return x.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  }
  function md(src, key, { checks = false } = {}) {
    const lines = String(src || '').split('\n'); let out = '', list = null, code = null, para = [], ci = 0;
    const flushP = () => { if (para.length) { out += `<p>${para.map((l) => inline(l, key)).join('<br>')}</p>`; para = []; } };
    const flushL = () => { if (list) { out += `<${list.tag}${list.tag === 'ul' && list.check ? ' class="tk-md-checks"' : ''}>${list.items.join('')}</${list.tag}>`; list = null; } };
    for (const line of lines) {
      if (code) { if (/^```/.test(line)) { out += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; } else code.push(line); continue; }
      if (/^```/.test(line)) { flushP(); flushL(); code = []; continue; }
      let m;
      if ((m = CHECK.exec(line))) { flushP(); const on = m[2] !== ' ', i = ci++; if (!list || list.tag !== 'ul' || !list.check) { flushL(); list = { tag: 'ul', check: true, items: [] }; }
        list.items.push(`<li class="tk-md-check${on ? ' on' : ''}"><button class="tk-md-box" ${checks ? `data-tk="check" data-arg="${esc(key)}|${i}"` : 'disabled'} role="checkbox" aria-checked="${on}" aria-label="${on ? 'Done' : 'Not done'}">${on ? ic('check') : ''}</button><span>${inline(m[3], key)}</span></li>`); continue; }
      if ((m = /^\s*[-*] (.*)$/.exec(line))) { flushP(); if (!list || list.tag !== 'ul' || list.check) { flushL(); list = { tag: 'ul', items: [] }; } list.items.push(`<li>${inline(m[1], key)}</li>`); continue; }
      if ((m = /^\s*\d+[.)] (.*)$/.exec(line))) { flushP(); if (!list || list.tag !== 'ol') { flushL(); list = { tag: 'ol', items: [] }; } list.items.push(`<li>${inline(m[1], key)}</li>`); continue; }
      flushL();
      if ((m = /^(#{1,3}) (.*)$/.exec(line))) { flushP(); out += `<h${m[1].length + 3}>${inline(m[2], key)}</h${m[1].length + 3}>`; continue; }
      if ((m = /^> ?(.*)$/.exec(line))) { flushP(); out += `<blockquote>${inline(m[1], key)}</blockquote>`; continue; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushP(); out += '<hr>'; continue; }
      if (!line.trim()) { flushP(); continue; }
      para.push(line);
    }
    if (code) out += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    flushP(); flushL();
    return out;
  }
  const checkCount = (src) => { let n = 0, d = 0, inCode = false; for (const l of String(src || '').split('\n')) { if (/^```/.test(l)) inCode = !inCode; else if (!inCode) { const m = CHECK.exec(l); if (m) { n++; if (m[2] !== ' ') d++; } } } return { n, d }; };
  function toggleCheck(src, idx) {
    let i = 0, inCode = false;
    return String(src || '').split('\n').map((l) => { if (/^```/.test(l)) { inCode = !inCode; return l; } if (inCode) return l; const m = CHECK.exec(l); if (!m) return l; if (i++ !== idx) return l; return `${m[1]}- [${m[2] === ' ' ? 'x' : ' '}] ${m[3]}`; }).join('\n');
  }

  // the markdown editor, used for a task's description, a comment, and the New task window
  const FMT = [['bold', 'B', 'Bold (Ctrl+B)'], ['italic', 'I', 'Italic (Ctrl+I)'], ['code', '‹›', 'Code'], ['h', 'H', 'Heading'], ['ul', '•', 'List'], ['check', '☐', 'Checklist'], ['link', '↗', 'Link'], ['image', 'img', 'Add an image']];
  const editor = ({ keep, value = '', placeholder, rows = 6, project, foot = '' }) => `<div class="tk-editor"><div class="tk-ed-bar" role="toolbar" aria-label="Formatting">${FMT.map(([k, l, t]) => `<button type="button" class="tk-ed-b" data-tk-fmt="${k}" title="${t}" aria-label="${t}">${k === 'image' ? ic('image') : esc(l)}</button>`).join('')}</div><textarea rows="${rows}" data-tk-keep="${esc(keep)}" data-tk-mention="${esc(project || '')}" data-tk-ed placeholder="${esc(placeholder || '')}" spellcheck="true">${esc(value)}</textarea>${foot}</div>`;
  function insertAt(ta, before, after = '', fallback = '') {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || fallback;
    ta.setRangeText(before + sel + after, s, e, 'end');
    if (!ta.value.slice(s, e).length && fallback) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; }
    ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
  }
  function linePrefix(ta, prefix) {
    const s = ta.selectionStart, start = ta.value.lastIndexOf('\n', s - 1) + 1, e = ta.selectionEnd;
    const block = ta.value.slice(start, e) || '';
    const lines = (block || '').split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l));
    ta.setRangeText(lines.join('\n'), start, e, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
  }
  function format(ta, k) {
    if (k === 'bold') insertAt(ta, '**', '**', 'bold');
    else if (k === 'italic') insertAt(ta, '_', '_', 'italic');
    else if (k === 'code') insertAt(ta, '`', '`', 'code');
    else if (k === 'h') linePrefix(ta, '## ');
    else if (k === 'ul') linePrefix(ta, '- ');
    else if (k === 'check') linePrefix(ta, '- [ ] ');
    else if (k === 'link') { const u = (prompt('Link address (https://…)') || '').trim(); if (/^https?:\/\//.test(u)) insertAt(ta, '[', `](${u})`, 'link'); }
    else if (k === 'image') ta.dispatchEvent(new CustomEvent('tk-image-pick', { bubbles: true }));
  }

  // @mention suggestions under any editor textarea
  const pop = document.createElement('div'); pop.className = 'tk-mpop'; pop.setAttribute('role', 'listbox'); pop.hidden = true; document.body.appendChild(pop);
  let popFor = null, popItems = [], popIdx = 0;
  const closePop = () => { pop.hidden = true; popFor = null; };
  async function mentionCheck(ta) {
    const upto = ta.value.slice(0, ta.selectionStart), m = /(^|[\s(])@([A-Za-z0-9_.-]{0,40})$/.exec(upto);
    if (!m) return closePop();
    const list = await people(ta.dataset.tkMention || null);
    const q = m[2].toLowerCase();
    popItems = list.filter((p) => p.username && (p.username.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))).slice(0, 7);
    if (!popItems.length) return closePop();
    popFor = ta; popIdx = 0;
    pop.innerHTML = popItems.map((p, i) => `<button type="button" class="tk-mpop-i${i === 0 ? ' on' : ''}" role="option" data-i="${i}">${face(p, true)}<b>${esc(p.name)}</b><small>@${esc(p.username)}${p.kind === 'agent' ? ' · agent' : ''}</small></button>`).join('');
    const r = ta.getBoundingClientRect(); pop.style.left = `${Math.round(r.left + 8)}px`; pop.style.top = `${Math.round(Math.min(r.bottom + 4, innerHeight - 260))}px`; pop.style.width = `${Math.min(300, r.width - 16)}px`; pop.hidden = false;
  }
  function mentionPick(i) {
    const ta = popFor, p = popItems[i]; if (!ta || !p) return closePop();
    const s = ta.selectionStart, upto = ta.value.slice(0, s), at = upto.lastIndexOf('@');
    ta.setRangeText(`@${p.username} `, at, s, 'end'); closePop(); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  pop.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); mentionPick(+b.dataset.i); } });
  document.addEventListener('input', (e) => { if (e.target.matches?.('textarea[data-tk-ed], textarea[data-tk-mention]')) mentionCheck(e.target).catch(() => {}); }, true);
  document.addEventListener('keydown', (e) => {
    if (pop.hidden || e.target !== popFor) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); popIdx = (popIdx + (e.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length; pop.querySelectorAll('.tk-mpop-i').forEach((b, i) => b.classList.toggle('on', i === popIdx)); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); mentionPick(popIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePop(); }
  }, true);
  document.addEventListener('focusout', (e) => { if (e.target === popFor) setTimeout(() => { if (document.activeElement !== popFor) closePop(); }, 120); }, true);

  // ───────────────────────── filters, sort, views
  const saveF = () => store.set('filters', T.f);
  const activeCount = () => ['assignee', 'priority', 'label', 'project', 'kind'].reduce((n, k) => n + T.f[k].length, 0) + (T.f.due ? 1 : 0) + (T.f.q ? 1 : 0);
  function applyF(list) {
    const f = T.f, q = f.q.trim().toLowerCase(), now = Date.now(), week = now + 7 * 864e5;
    let out = list.filter((t) => {
      if (q && !(`${t.key} ${t.title} ${(t.labels || []).join(' ')}`.toLowerCase().includes(q))) return false;
      if (f.assignee.length && !f.assignee.some((a) => (a === 'me' ? t.assignee && t.assignee.id === me() : a === 'none' ? !t.assignee : a === 'agents' ? t.assignee && t.assignee.kind === 'agent' : t.assignee && t.assignee.id === a))) return false;
      if (f.priority.length && !f.priority.includes(t.priority)) return false;
      if (f.kind.length && !f.kind.includes(t.kind)) return false;
      if (f.label.length && !f.label.some((l) => (t.labels || []).includes(l))) return false;
      if (f.project.length && !f.project.includes(pkey(t))) return false;
      if (f.due === 'overdue' && !late(t)) return false;
      if (f.due === 'week' && !(t.dueAt && Date.parse(t.dueAt) <= week && !CLOSED.includes(t.status))) return false;
      if (f.due === 'none' && t.dueAt) return false;
      return true;
    });
    const pr = (t) => PRI_ORDER.indexOf(t.priority);
    const by = { priority: (a, b) => pr(a) - pr(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt), due: (a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity), updated: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt), created: (a, b) => b.number - a.number, title: (a, b) => a.title.localeCompare(b.title) }[f.sort] || (() => 0);
    return out.sort(by);
  }
  function filterMenu(anchor) {
    const L = T.list || [], toggle = (k, v) => () => { const a = T.f[k]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); T.viewId = null; saveF(); patch(); };
    const ppl = new Map(); for (const t of L) if (t.assignee) ppl.set(t.assignee.id, t.assignee);
    const labels = [...new Set(L.flatMap((t) => t.labels || []))].sort();
    const projs = new Map(); for (const t of L) projs.set(pkey(t), t.project ? t.project.name : 'Personal');
    const r = anchor.getBoundingClientRect();
    window.XCM?.show([[
      { label: 'Assignee', icon: 'people', sub: [['me', 'Me'], ['none', 'Unassigned'], ['agents', 'Any agent'], ...[...ppl.values()].filter((p) => p.id !== me()).map((p) => [p.id, p.name])].map(([v, l]) => ({ label: l, checked: T.f.assignee.includes(v), run: toggle('assignee', v) })) },
      { label: 'Priority', icon: 'up', sub: PRI_ORDER.map((p) => ({ label: PRI[p], checked: T.f.priority.includes(p), run: toggle('priority', p) })) },
      { label: 'Type', icon: 'check', sub: Object.entries(KIND).map(([k, [i, l]]) => ({ label: l, icon: i, checked: T.f.kind.includes(k), run: toggle('kind', k) })) },
      { label: 'Label', icon: 'hash', ...(labels.length ? { sub: labels.map((l) => ({ label: l, checked: T.f.label.includes(l), run: toggle('label', l) })) } : { disabled: 'No labels yet' }) },
      { label: 'Project', icon: 'folder', sub: [...projs].map(([v, l]) => ({ label: l, checked: T.f.project.includes(v), run: toggle('project', v) })) },
      { label: 'Due', icon: 'calendar', sub: [['overdue', 'Overdue'], ['week', 'Due within a week'], ['none', 'No due date']].map(([v, l]) => ({ label: l, checked: T.f.due === v, run: () => { T.f.due = T.f.due === v ? '' : v; T.viewId = null; saveF(); patch(); } })) },
    ], activeCount() ? [{ label: 'Clear all filters', icon: 'x', run: () => { T.f = { ...F0(), sort: T.f.sort, layout: T.f.layout }; T.viewId = null; saveF(); patch(); } }] : []], { x: r.left, y: r.bottom + 4, opener: anchor });
  }
  function sortMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    window.XCM?.show([[['priority', 'Priority'], ['due', 'Due date'], ['updated', 'Last updated'], ['created', 'Newest first'], ['title', 'Title']].map(([v, l]) => ({ label: l, checked: T.f.sort === v, run: () => { T.f.sort = v; saveF(); patch(); } }))], { x: r.left, y: r.bottom + 4, opener: anchor });
  }
  function chipsHtml() {
    const f = T.f, chips = [];
    const name = (id) => (id === 'me' ? 'Me' : id === 'none' ? 'Unassigned' : id === 'agents' ? 'Any agent' : ((T.list || []).find((t) => t.assignee && t.assignee.id === id) || {}).assignee?.name || 'Someone');
    for (const v of f.assignee) chips.push(['assignee', v, `Assignee: ${name(v)}`]);
    for (const v of f.priority) chips.push(['priority', v, `Priority: ${PRI[v]}`]);
    for (const v of f.kind) chips.push(['kind', v, `Type: ${KIND[v][1]}`]);
    for (const v of f.label) chips.push(['label', v, `Label: ${v}`]);
    for (const v of f.project) chips.push(['project', v, `Project: ${v === 'personal' ? 'Personal' : ((T.list || []).find((t) => pkey(t) === v) || {}).project?.name || 'Project'}`]);
    if (f.due) chips.push(['due', f.due, { overdue: 'Overdue', week: 'Due this week', none: 'No due date' }[f.due]]);
    return chips.map(([k, v, l]) => `<button class="tk-fchip" data-tk="unfilter" data-arg="${k}|${esc(v)}" title="Remove this filter">${esc(l)}${ic('x')}</button>`).join('');
  }
  async function saveViewNow() {
    const v = await D().form({ title: 'Save this view', sub: 'Keeps the search, filters, sort and layout. Only you see your views.', submit: 'Save view', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 80, placeholder: 'e.g. My open bugs' }] });
    if (!v) return;
    const r = await api('POST', '/api/tasks/views', { name: v.name.trim(), area: P.area() || null, filters: T.f }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The view couldn’t be saved.'));
    T.views = r.d.views; T.viewId = (T.views.at(-1) || {}).id || null; patch(); toast('View saved');
  }
  function applyView(id) { const v = (T.views || []).find((x) => x.id === id); if (!v) return; T.f = { ...F0(), ...v.filters, assignee: [].concat(v.filters.assignee || []), priority: [].concat(v.filters.priority || []), label: [].concat(v.filters.label || []), project: [].concat(v.filters.project || []), kind: [].concat(v.filters.kind || []) }; T.viewId = id; saveF(); patch(); }
  async function deleteView(id) { const r = await api('DELETE', `/api/tasks/views/${encodeURIComponent(id)}`).catch(() => null); if (!r || !r.ok) return toast(said(r, 'It couldn’t be deleted.')); T.views = r.d.views; if (T.viewId === id) T.viewId = null; patch(); toast('View deleted'); }

  // ───────────────────────── regions
  const where = () => (P.area() ? P.areaName(P.area()) : 'every area');
  const head = (title, sub) => H().head({ eyebrow: '<a data-tk="board">Tasks</a>', title, sub, acts: H().btn('New task', 'data-tk="new"', false, 'plus') });
  const shell = (view, title, sub) => H().page(head(title, sub) + `<div data-tk-root="${esc(view)}">${region(view)}</div>` + H().foot('tasks', 'GET /api/tasks'));
  const loadingOrError = (status, list) => (!list ? (status === 'error' ? `<p class="tk-msg" data-tk-state="error">Tasks couldn’t be loaded. <button class="pg-link" data-tk="retry">Try again</button></p>` : '<p class="tk-msg" data-tk-state="loading">Loading tasks…</p>') : null);
  const dueChip = (t) => (t.dueAt ? `<small class="tk-due${late(t) ? ' tk-due--late' : ''}" title="Due ${esc(new Date(t.dueAt).toLocaleDateString())}">${ic('calendar')}${esc(day(t.dueAt))}</small>` : '');
  const subChip = (t) => (t.subtasks && t.subtasks.total ? `<small class="tk-subc" title="${t.subtasks.done} of ${t.subtasks.total} sub-tasks done">${ic('layers')}${t.subtasks.done}/${t.subtasks.total}</small>` : '');
  const selBox = (t) => `<button class="tk-sel${T.sel.has(t.key) ? ' on' : ''}" data-tk="select" data-arg="${esc(t.key)}" role="checkbox" aria-checked="${T.sel.has(t.key)}" aria-label="Select ${esc(t.key)}">${T.sel.has(t.key) ? ic('check') : ''}</button>`;
  function card(t) {
    const k = KIND[t.kind] || KIND.task;
    return `<div class="tk-card${T.sel.has(t.key) ? ' tk-card--sel' : ''}" role="button" tabindex="0" draggable="${t.can && t.can.moves.length ? 'true' : 'false'}" data-tk="open" data-arg="${esc(t.key)}" data-tk-card="${esc(t.key)}">
      <div class="tk-card-top">${selBox(t)}<span class="tk-kind" title="${k[1]}">${ic(k[0])}</span><small>${esc(t.key)}</small>${t.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>` : ''}<span class="tk-sp"></span><button class="tk-more" data-tk="menu" data-arg="${esc(t.key)}" aria-label="Actions for ${esc(t.key)}">${ic('more')}</button></div>
      ${t.parent ? `<small class="tk-card-parent" title="Sub-task of ${esc(t.parent.key)}">↳ ${esc(t.parent.key)} ${esc(t.parent.title)}</small>` : ''}
      <b class="tk-card-t">${esc(t.title)}</b>
      <div class="tk-card-f">${t.project ? `<small class="tk-chip">${esc(t.project.name)}</small>` : ''}${(t.labels || []).slice(0, 2).map((l) => `<small class="tk-chip">${esc(l)}</small>`).join('')}${subChip(t)}${dueChip(t)}<span class="tk-sp"></span>${face(t.assignee, true)}</div></div>`;
  }
  const row = (t) => `<div class="tk-row${T.sel.has(t.key) ? ' tk-row--sel' : ''}" role="button" tabindex="0" data-tk="open" data-arg="${esc(t.key)}" data-tk-rowkey="${esc(t.key)}">${selBox(t)}<span class="tk-kind">${ic((KIND[t.kind] || KIND.task)[0])}</span><small class="tk-key">${esc(t.key)}</small><b>${esc(t.title)}</b><span class="tk-row-x">${(t.labels || []).slice(0, 2).map((l) => `<small class="tk-chip">${esc(l)}</small>`).join('')}${subChip(t)}${dueChip(t)}</span><span class="tk-status"><span class="tk-dot tk-dot--${esc(t.status)}"></span>${esc(LABEL[t.status])}</span>${t.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>` : '<span></span>'}${face(t.assignee, true)}<button class="tk-more" data-tk="menu" data-arg="${esc(t.key)}" aria-label="Actions for ${esc(t.key)}">${ic('more')}</button></div>`;
  function boardOf(list, small) {
    return `<div class="tk-board${small ? ' tk-board--sm' : ''}" data-tk-board>${COLS.map(([k, l]) => { const cs = list.filter((t) => t.status === k);
      return `<section class="tk-col" data-tk-col="${k}"><h3><span class="tk-dot tk-dot--${k}"></span>${l}<em>${cs.length}</em></h3><div class="tk-col-b">${cs.map(card).join('') || '<p class="tk-empty">No tasks</p>'}</div></section>`; }).join('')}</div>`;
  }
  function listOf(list) {
    const groups = [...COLS, ['wont_do', 'Won’t do']].map(([k, l]) => [k, l, list.filter((t) => t.status === k)]).filter(([, , g]) => g.length);
    return groups.length ? `<div class="tk-list" data-tk-list>${groups.map(([k, l, g]) => `<div class="tk-list-h" data-tk-col="${k}"><span class="tk-dot tk-dot--${k}"></span>${l}<em>${g.length}</em></div>${g.map(row).join('')}`).join('')}</div>` : '';
  }
  function bulkBar(scope) {
    const keys = [...T.sel].filter((k) => scope.some((t) => t.key === k)); if (!keys.length) return '';
    return `<div class="tk-bulk" role="toolbar" aria-label="Selected tasks"><b>${keys.length} selected</b><button class="tk-bulk-b" data-tk="bulk" data-arg="move">${ic('flow')}Move</button><button class="tk-bulk-b" data-tk="bulk" data-arg="assign">${ic('people')}Assign</button><button class="tk-bulk-b" data-tk="bulk" data-arg="priority">${ic('up')}Priority</button><button class="tk-bulk-b tk-bulk-b--danger" data-tk="bulk" data-arg="delete">${ic('trash')}Delete</button><span class="tk-sp"></span><button class="tk-bulk-b" data-tk="unselect">Clear <kbd>Esc</kbd></button></div>`;
  }
  function toolbar(L, shown) {
    const n = activeCount() - (T.f.q ? 1 : 0);
    return `<div class="tk-bar">
      <label class="tk-search">${ic('search')}<input type="search" data-tk-keep="q" data-tk-keep-empty data-tk-search placeholder="Search tasks  /" value="${esc(T.f.q)}" aria-label="Search tasks"></label>
      <button class="tk-tool${n ? ' on' : ''}" data-tk="filters">${ic('sliders')}Filter${n ? `<em>${n}</em>` : ''}</button>
      <button class="tk-tool" data-tk="sort">${ic('up')}${esc({ priority: 'Priority', due: 'Due date', updated: 'Updated', created: 'Newest', title: 'Title' }[T.f.sort])}</button>
      <span class="tk-seg" role="group" aria-label="Layout"><button class="${T.f.layout === 'board' ? 'on' : ''}" data-tk="layout" data-arg="board" aria-pressed="${T.f.layout === 'board'}">${ic('grid')}Board</button><button class="${T.f.layout === 'list' ? 'on' : ''}" data-tk="layout" data-arg="list" aria-pressed="${T.f.layout === 'list'}">${ic('layers')}List</button></span>
      <span class="tk-sp"></span><small class="tk-dim">${shown} of ${L.length}</small>${activeCount() ? `<button class="tk-tool" data-tk="save-view">${ic('star')}Save view</button>` : ''}</div>
      ${(T.views && T.views.length) || chipsHtml() ? `<div class="tk-bar tk-bar--2">${(T.views || []).filter((v) => !v.area || v.area === (P.area() || null) || !P.area()).map((v) => `<button class="tk-view${T.viewId === v.id ? ' on' : ''}" data-tk="view" data-arg="${esc(v.id)}" data-tk-view="${esc(v.id)}">${ic('star')}${esc(v.name)}</button>`).join('')}${chipsHtml()}</div>` : ''}`;
  }
  function region(view) {
    if (view.startsWith('task:')) return taskRegion(view.slice(5));
    const s = loadingOrError(T.status, T.list); if (s) return s;
    const L = T.list;
    if (T.views === null) { T.views = []; loadViews(); }
    if (view === 'board') {
      if (!L.length) return `<div class="tk-first" data-tk-state="empty"><p>No tasks in ${esc(where())} yet. Raise one for yourself, or add tasks to a project so the people and agents on it can pick them up.</p>${H().btn('New task', 'data-tk="new"', false, 'plus')}<p class="tk-dim tk-keys-hint">Press <kbd>C</kbd> anywhere in Tasks to create one, <kbd>?</kbd> for all shortcuts.</p></div>`;
      const shown = applyF(L);
      const body = shown.length ? (T.f.layout === 'list' ? listOf(shown) : boardOf(shown)) : `<p class="tk-msg" data-tk-state="filtered">No task matches. <button class="pg-link" data-tk="clear-filters">Clear the filters</button></p>`;
      return toolbar(L, shown.length) + body + bulkBar(shown);
    }
    const pick = { mine: (t) => t.assignee && t.assignee.id === me() && !CLOSED.includes(t.status), triage: (t) => t.status === 'raised', review: (t) => t.status === 'in_review' }[view] || (() => true);
    const rows = L.filter(pick);
    return rows.length ? `<div class="tk-list" data-tk-list>${rows.map(row).join('')}</div>${bulkBar(rows)}` : '<p class="tk-msg" data-tk-state="empty">Nothing here.</p>';
  }

  // the readable history: who changed what, from what, to what
  function activity(t) {
    const out = []; let run = null;
    for (const e of t.events || []) {
      if (e.kind === 'status' && !e.note && run && run.actor?.id === e.actor?.id && Date.parse(e.at) - Date.parse(run.last) < 600000) { run.path.push(e.to); run.last = e.at; continue; }
      if (e.kind === 'status' && !e.note) { run = { kind: 'run', actor: e.actor, path: [e.from, e.to], at: e.at, last: e.at }; out.push(run); continue; }
      run = null; out.push(e);
    }
    const who = (a) => `<b>${esc(a ? a.name : 'XENO')}</b>${a && a.kind === 'agent' ? '<em class="pg-kind">Agent</em>' : ''}`;
    const st = (s) => `<span class="tk-st"><span class="tk-dot tk-dot--${esc(s)}"></span>${esc(LABEL[s] || s)}</span>`;
    const val = (f, v) => (v == null || v === '' ? '<span class="tk-dim">none</span>' : `<b>${esc(f === 'priority' ? PRI[v] || v : f === 'kind' ? (KIND[v] || [0, v])[1] : f === 'due' ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : String(v).slice(0, 120))}</b>`);
    const edited = (e) => {
      if (e.field === 'description') return 'edited the description';
      if (e.field === 'title') return `renamed it from ${val('title', e.from)}`;
      if (e.field === 'reviewer') return e.to ? `made <b>${esc(e.toName || 'someone')}</b> the reviewer` : 'removed the reviewer';
      if (e.field === 'parent') return e.to ? `made it a sub-task of <a class="tk-ref" data-tk="open" data-arg="${esc(e.to)}">${esc(e.to)}</a>` : 'made it a top-level task';
      if (e.field === 'labels') return e.to ? `set the labels to ${val('labels', e.to)}` : 'removed the labels';
      if (e.field) return `changed ${esc(e.field === 'kind' ? 'the type' : e.field === 'due' ? 'the due date' : 'the ' + e.field)} from ${val(e.field, e.from)} to ${val(e.field, e.to)}`;
      return `changed the ${esc(e.from || 'task')}`;
    };
    return out.map((e) => {
      if (e.kind === 'comment') {
        if (e.removed) return `<p class="tk-ev tk-ev--removed" data-tk-ev="comment-removed"><span class="tk-ev-dot"></span><span>${who(e.actor)} removed a comment</span><small>${when(e.at)}</small></p>`;
        const mine = e.actor && e.actor.id === me();
        if (T.editComment === e.id) return `<article class="tk-comment" data-tk-ev="comment">${face(e.actor, true)}<form class="tk-cedit" data-tk-cedit="${esc(t.key)}|${esc(e.id)}">${editor({ keep: 'cedit:' + e.id, value: e.note, rows: 3, project: t.project && t.project.id, foot: `<div class="tk-ed-f"><small class="tk-dim">Ctrl+Enter to save · Esc to cancel</small><span class="tk-sp"></span><button type="button" class="tk-btn" data-tk="cedit-cancel">Cancel</button><button type="submit" class="tk-btn tk-btn--main">Save</button></div>` })}</form></article>`;
        return `<article class="tk-comment" data-tk-ev="comment" data-tk-comment-id="${esc(e.id)}">${face(e.actor, true)}<div class="tk-comment-b"><header>${who(e.actor)}<small>${when(e.at)}${e.editedAt ? ' · edited' : ''}</small>${mine || (t.can && t.can.edit) ? `<span class="tk-sp"></span><button class="tk-more tk-more--sm" data-tk="cmenu" data-arg="${esc(t.key)}|${esc(e.id)}" aria-label="Comment actions">${ic('more')}</button>` : ''}</header><div class="tk-md">${md(e.note, t.key)}</div></div></article>`;
      }
      const what = e.kind === 'run' ? `moved it ${e.path.map(st).join(' → ')}`
        : e.kind === 'status' ? `moved it ${st(e.from)} → ${st(e.to)}${e.note ? ` — “${esc(e.note)}”` : ''}`
        : e.kind === 'created' ? 'raised this task'
        : e.kind === 'claimed' ? 'took it'
        : e.kind === 'assigned' ? (e.to ? (e.to === e.actor?.id ? 'assigned it to themselves' : `assigned it to <b>${esc(e.toName || 'someone')}</b>`) : `unassigned <b>${esc(e.fromName || 'it')}</b>`)
        : e.kind === 'edited' ? edited(e)
        : e.kind === 'attached' ? `added <i>${esc(e.note || 'an image')}</i>` : e.kind === 'detached' ? `removed <i>${esc(e.note || 'an image')}</i>`
        : e.kind === 'linked' ? `linked it: ${esc((LINKS.find(([k]) => k === e.from) || [0, e.from])[1].toLowerCase())} <a class="tk-ref" data-tk="open" data-arg="${esc(e.to)}">${esc(e.to)}</a>`
        : e.kind === 'unlinked' ? `removed the link to <a class="tk-ref" data-tk="open" data-arg="${esc(e.to)}">${esc(e.to)}</a>`
        : e.kind === 'parent' ? `added the sub-task <a class="tk-ref" data-tk="open" data-arg="${esc(e.to)}">${esc(e.to)}</a>`
        : e.kind === 'restored' ? 'restored it' : e.kind === 'deleted' ? 'deleted it' : esc(e.kind);
      return `<p class="tk-ev" data-tk-ev="${esc(e.kind === 'run' ? 'status' : e.kind)}"><span class="tk-ev-dot"></span><span>${who(e.actor)} ${what}</span><small>${when(e.at)}</small></p>`;
    }).join('');
  }
  function taskRegion(key) {
    const t = T.task.get(key);
    if (!t) { loadTask(key); return '<p class="tk-msg" data-tk-state="loading">Loading the task…</p>'; }
    if (t.missing) return `<p class="tk-msg" data-tk-state="missing">${t.error ? `The task couldn’t be loaded. <button class="pg-link" data-tk="refresh" data-arg="${esc(key)}">Try again</button>` : 'This task doesn’t exist, was deleted, or belongs to someone else.'}</p>`;
    const can = t.can || { moves: [] }, k = KIND[t.kind] || KIND.task;
    const mineIt = !!(t.assignee && t.assignee.id === me()), editAny = can.edit || mineIt;
    const canClaim = !t.assignee && !CLOSED.includes(t.status);
    const acts = can.moves.map((m, i) => `<button class="tk-act${i === 0 ? ' tk-act--main' : ''}" data-tk="move" data-arg="${esc(t.key)}|${m}|${t.status}" data-tk-move="${m}">${m === 'done' ? ic('check') : ''}${esc(MOVE[m] || LABEL[m])}</button>`).join('')
      + (canClaim ? `<button class="tk-act" data-tk="claim" data-arg="${esc(t.key)}">${ic('user')}Take it</button>` : '');
    const prop = (id, label, value, editable, kbd) => `<div class="tk-prop"><span class="tk-prop-l">${label}</span>${editable ? `<button class="tk-prop-v" data-tk="prop" data-arg="${esc(t.key)}|${id}" data-tk-prop="${id}"${kbd ? ` title="${label} (${kbd})"` : ''}>${value}</button>` : `<span class="tk-prop-v tk-prop-v--ro">${value}</span>`}</div>`;
    const person = (p) => (p ? `${face(p, true)}<span>${esc(p.name)}</span>` : '<span class="tk-dim">None</span>');
    const imgs = t.attachments || [], cc = checkCount(t.body), kids = t.children || [], kd = kids.filter((c) => CLOSED.includes(c.status)).length;
    const desc = T.editing === t.key
      ? `<form class="tk-dedit" data-tk-dedit="${esc(t.key)}">${editor({ keep: 'desc:' + t.key, value: t.body, rows: 10, placeholder: 'What needs doing, and how will we know it is done? Markdown, checklists (- [ ]), @mentions, paste images.', project: t.project && t.project.id, foot: `<div class="tk-ed-f"><small class="tk-dim">Markdown · paste or drop images · @ to mention · Ctrl+Enter saves · Esc cancels</small><span class="tk-sp"></span><button type="button" class="tk-btn" data-tk="desc-cancel">Cancel</button><button type="submit" class="tk-btn tk-btn--main">Save</button></div>` })}</form>`
      : t.body ? `<div class="tk-md tk-desc${can.edit ? ' tk-desc--edit' : ''}" ${can.edit ? `data-tk-desc="${esc(t.key)}" title="Click to edit (E)"` : ''}>${md(t.body, t.key, { checks: editAny })}</div>${cc.n ? `<div class="tk-prog" title="${cc.d} of ${cc.n} done"><span style="width:${Math.round((cc.d / cc.n) * 100)}%"></span></div><small class="tk-dim">${cc.d} of ${cc.n} checklist items done</small>` : ''}`
      : can.edit ? `<button class="tk-add" data-tk="describe" data-arg="${esc(t.key)}">Add a description…</button>` : '<p class="tk-dim">No description.</p>';
    const linkGroups = {}; for (const l of t.links || []) (linkGroups[l.label] = linkGroups[l.label] || []).push(l);
    return `<div class="tk-page">
      <div class="tk-main">
        ${t.parent ? `<a class="tk-parent" data-tk="open" data-arg="${esc(t.parent.key)}">↳ Sub-task of <b>${esc(t.parent.key)}</b> ${esc(t.parent.title)}</a>` : ''}
        <div class="tk-titlerow"><span class="tk-kind" title="${k[1]}">${ic(k[0])}</span><small class="tk-key">${esc(t.key)}</small><span class="tk-status" data-tk-status="${esc(t.status)}"><span class="tk-dot tk-dot--${esc(t.status)}"></span>${esc(LABEL[t.status])}</span><span class="tk-sp"></span>
          <button class="tk-watch${t.watching ? ' on' : ''}" data-tk="watch" data-arg="${esc(t.key)}" aria-pressed="${!!t.watching}" title="${t.watching ? 'You hear about every change. Click to stop.' : 'Hear about every change'} (W)">${ic('bell')}${t.watching ? 'Watching' : 'Watch'}${(t.watchers || []).length ? `<em>${t.watchers.length}</em>` : ''}</button>
          <button class="tk-watch" data-tk="prompt" data-arg="${esc(t.key)}" title="Copy a handoff brief for an agent CLI (Claude Code, xeno agent…) to the clipboard">${ic('bot')}Copy for agent</button>
          <button class="tk-ib" data-tk="refresh" data-arg="${esc(t.key)}" title="Refresh" aria-label="Refresh">${ic('reset')}</button><button class="tk-ib" data-tk="menu" data-arg="${esc(t.key)}" title="More actions" aria-label="More actions">${ic('more')}</button></div>
        ${can.edit ? `<h2 class="tk-title tk-title--edit" role="button" tabindex="0" data-tk="rename" data-arg="${esc(t.key)}" title="Rename (F2)">${esc(t.title)}</h2>` : `<h2 class="tk-title">${esc(t.title)}</h2>`}
        ${acts ? `<div class="tk-acts" data-tk-acts>${acts}</div>` : ''}
        <section class="tk-sec">${desc}</section>
        <section class="tk-sec" data-tk-subtasks><h3>Sub-tasks${kids.length ? `<em>${kd}/${kids.length}</em>` : ''}</h3>
          ${kids.length ? `<div class="tk-kids">${kids.map((c) => `<div class="tk-kid" role="button" tabindex="0" data-tk="open" data-arg="${esc(c.key)}" data-tk-rowkey="${esc(c.key)}"><span class="tk-dot tk-dot--${esc(c.status)}"></span><small class="tk-key">${esc(c.key)}</small><span class="tk-kid-t${CLOSED.includes(c.status) ? ' tk-kid-t--done' : ''}">${esc(c.title)}</span>${c.priority !== 'none' ? `<em class="tk-pri tk-pri--${esc(c.priority)}">${esc(PRI[c.priority])}</em>` : ''}${face(c.assignee, true)}</div>`).join('')}</div>` : ''}
          ${editAny || can.edit ? `<form class="tk-kid-add" data-tk-kidadd="${esc(t.key)}">${ic('plus')}<input data-tk-keep="kid:${esc(t.key)}" placeholder="Add a sub-task — Enter to create" maxlength="300" aria-label="New sub-task title"></form>` : (kids.length ? '' : '<p class="tk-dim">None.</p>')}</section>
        <section class="tk-sec" data-tk-links><h3>Links<span class="tk-sp"></span>${t.canLink ? `<button class="tk-link" data-tk="add-link" data-arg="${esc(t.key)}">${ic('plus')}Link a task</button>` : ''}</h3>
          ${Object.keys(linkGroups).length ? Object.entries(linkGroups).map(([label, ls]) => `<div class="tk-links"><small class="tk-links-l">${esc(label)}</small><div>${ls.map((l) => `<span class="tk-linkc"><a data-tk="open" data-arg="${esc(l.task.key)}"><span class="tk-dot tk-dot--${esc(l.task.status)}"></span><small>${esc(l.task.key)}</small>${esc(l.task.title)}</a>${t.canLink ? `<button class="tk-linkx" data-tk="unlink" data-arg="${esc(t.key)}|${esc(l.id)}" aria-label="Remove this link">${ic('x')}</button>` : ''}</span>`).join('')}</div></div>`).join('') : '<p class="tk-dim">No linked tasks.</p>'}</section>
        <section class="tk-sec" data-tk-images="${esc(t.key)}"><h3>Images<em>${imgs.length}</em><span class="tk-sp"></span>${can.attach ? `<button class="tk-link" data-tk="attach" data-arg="${esc(t.key)}">${ic('upload')}Add</button>` : ''}</h3>
          ${imgs.length ? `<div class="tk-imgs">${imgs.map((a) => `<figure class="tk-img" data-tk-img="${esc(a.id)}"><a href="${imgUrl(t.key, a.id)}" target="_blank" rel="noopener" title="${esc(a.filename)}"><img src="${imgUrl(t.key, a.id)}" alt="${esc(a.filename)}" loading="lazy"></a><figcaption>${esc(a.filename)}</figcaption>${can.edit || (a.uploader && a.uploader.id === me()) ? `<button class="tk-img-x" data-tk="unattach" data-arg="${esc(t.key)}|${esc(a.id)}" aria-label="Remove ${esc(a.filename)}">${ic('x')}</button>` : ''}</figure>`).join('')}</div>` : ''}
          ${can.attach ? `<div class="tk-drop" data-tk="attach" data-arg="${esc(t.key)}" role="button" tabindex="0">${ic('image')}<span>Drop images here, paste them, or <u>choose files</u></span><small>PNG, JPEG, GIF or WebP · up to 8 MB each</small></div>` : (imgs.length ? '' : '<p class="tk-dim">No images.</p>')}</section>
        <section class="tk-sec"><h3>Activity</h3><div class="tk-activity" data-tk-history>${activity(t)}</div>
          <form class="tk-compose" data-tk-comment="${esc(t.key)}">${face({ name: myName() }, true)}<div class="tk-compose-b"><textarea rows="2" data-tk-keep="comment:${esc(t.key)}" data-tk-mention="${esc(t.project ? t.project.id : '')}" placeholder="Leave a comment — @ to mention, paste images, Ctrl+Enter to send" aria-label="Comment"></textarea><div class="tk-compose-f"><small class="tk-dim">Markdown works. Everyone on the task sees this.</small><span class="tk-sp"></span><button class="pg-btn" type="submit">${ic('send')}<span>Comment</span></button></div></div></form></section>
      </div>
      <aside class="tk-props" aria-label="Properties">
        ${prop('status', 'Status', `<span class="tk-dot tk-dot--${esc(t.status)}"></span><span>${esc(LABEL[t.status])}</span>`, can.moves.length > 0, 'S')}
        ${prop('assignee', 'Assignee', person(t.assignee), editAny, 'I')}
        ${prop('reviewer', 'Reviewer', person(t.reviewer) + (t.reviewRequired ? '<small class="tk-req">required</small>' : ''), can.edit)}
        ${prop('priority', 'Priority', t.priority === 'none' ? '<span class="tk-dim">No priority</span>' : `<em class="tk-pri tk-pri--${esc(t.priority)}">${esc(PRI[t.priority])}</em>`, editAny, 'P')}
        ${prop('kind', 'Type', `${ic(k[0])}<span>${k[1]}</span>`, editAny)}
        ${prop('due', 'Due date', t.dueAt ? `<span class="${late(t) ? 'tk-late' : ''}">${esc(new Date(t.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}${late(t) ? ' · overdue' : ''}</span>` : '<span class="tk-dim">None</span>', editAny, 'D')}
        ${prop('labels', 'Labels', (t.labels || []).length ? t.labels.map((l) => `<small class="tk-chip">${esc(l)}</small>`).join('') : '<span class="tk-dim">None</span>', editAny, 'L')}
        ${prop('parent', 'Parent', t.parent ? `<span>${esc(t.parent.key)}</span>` : '<span class="tk-dim">None</span>', editAny)}
        <div class="tk-props-sep"></div>
        ${prop('project', 'Project', t.project ? esc(t.project.name) : 'Personal', false)}
        ${prop('area', 'Area', esc(t.area ? P.areaName(t.area) : 'Overview'), false)}
        ${prop('reporter', 'Reported by', person(t.reporter), false)}
        ${prop('watchers', 'Watching', (t.watchers || []).length ? esc(t.watchers.map((w) => w.name).slice(0, 3).join(', ') + (t.watchers.length > 3 ? ` +${t.watchers.length - 3}` : '')) : '<span class="tk-dim">Nobody</span>', false)}
        ${prop('created', 'Created', esc(when(t.createdAt)), false)}
        ${prop('updated', 'Updated', esc(when(t.updatedAt)), false)}
        <p class="tk-props-hint"><kbd>?</kbd> shortcuts</p>
      </aside></div>`;
  }
  function route(it) {
    if (T.list === null && T.status !== 'error' && !T.loading) load();
    if (!it || it === 'Board') return shell('board', 'Tasks', `${where()} · raised, accepted, worked on, reviewed and done — by people and agents`);
    if (it === 'My tasks') return shell('mine', 'My tasks', 'Assigned to you and still open');
    if (it === 'Needs triage') return shell('triage', 'Needs triage', 'Raised and not yet accepted');
    if (it === 'In review') return shell('review', 'In review', 'Waiting for a reviewer');
    if (/^T-\d+$/i.test(it)) { const key = it.toUpperCase(); return H().page(head(key) + `<div data-tk-root="task:${esc(key)}">${taskRegion(key)}</div>` + H().foot('tasks:task', `GET /api/tasks/${esc(key)}`)); }
    return shell('board', 'Tasks', where());
  }
  function projectRegion(id) {
    const got = T.byProject.get(id);
    const top = `<div class="tk-bar">${H().btn('New task in this project', `data-tk="new" data-arg="${esc(id)}"`, false, 'plus')}<span class="tk-sp"></span><small class="tk-dim">Drag a card to move it · right-click for more</small></div>`;
    if (!got || got === 'loading') return top + '<p class="tk-msg" data-tk-state="loading">Loading tasks…</p>';
    if (got === 'error') return top + `<p class="tk-msg" data-tk-state="error">The tasks couldn’t be loaded. <button class="pg-link" data-tk="retry-project" data-arg="${esc(id)}">Try again</button></p>`;
    return top + (got.length ? boardOf(got, true) + bulkBar(got) : '<p class="tk-msg" data-tk-state="empty">No tasks in this project yet.</p>');
  }
  function projectTab(rec) {
    if (!rec || !rec.id) return null;
    if (!T.byProject.has(rec.id)) { T.byProject.set(rec.id, 'loading'); loadProject(rec.id); }
    return `<div data-tk-proot="${esc(rec.id)}">${projectRegion(rec.id)}</div>`;
  }

  // ───────────────────────── actions
  const go = (item) => X().go('global', { global: 'tasks', item });
  const fresh = (t) => { if (!t || !t.key) return; T.task.set(t.key, t); for (const arr of allLists()) { const i = arr.findIndex((x) => x.key === t.key); if (i >= 0) arr[i] = { ...arr[i], ...t }; } patch(); };
  async function after(key, task) {
    if (task) fresh(task);
    try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {}
    await Promise.all([task ? null : loadTask(key), load(), ...[...T.byProject.keys()].map(loadProject)]);
  }
  const INVERSE = { title: 'title', body: 'body', priority: 'priority', kind: 'kind', dueAt: 'dueAt', labels: 'labels' };
  async function patchTask(key, body, ok, { undo = true } = {}) {
    const before = findTask(key);
    const r = await api('PATCH', `/api/tasks/${encodeURIComponent(key)}`, body).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That couldn’t be saved. The task is as it was.')); return loadTask(key); }
    await after(key, r.d.task);
    if (undo && before) {
      const inv = {};
      for (const k of Object.keys(body)) {
        if (INVERSE[k]) inv[k] = before[INVERSE[k]] ?? (k === 'labels' ? [] : null);
        else if (k === 'assigneeId') inv.assigneeId = before.assignee ? before.assignee.id : null;
        else if (k === 'reviewerId') { inv.reviewerId = before.reviewer ? before.reviewer.id : null; inv.reviewRequired = !!before.reviewRequired; }
        else if (k === 'parentKey') inv.parentKey = before.parent ? before.parent.key : null;
      }
      if (Object.keys(inv).length) hist(`${ok || 'Changed'} · ${key}`, () => patchTask(key, inv, 'Undone', { undo: false }));
      else if (ok) toast(ok);
    } else if (ok) toast(ok);
  }
  async function move(key, to, from, { undo = true } = {}) {
    let note;
    if (to === 'blocked' || to === 'wont_do') { const v = await D().form({ title: to === 'blocked' ? 'What is it waiting on?' : 'Why won’t it be done?', submit: LABEL[to], size: 'sm', fields: [{ id: 'note', label: 'Note', type: 'textarea', rows: 3, max: 2000 }] }); if (!v) return false; note = v.note || undefined; }
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/transition`, { to, from, note }).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'That move couldn’t be made.')); await after(key); return false; }
    await after(key, r.d.task);
    const back = r.d.task.can && r.d.task.can.moves.includes(from);
    if (undo && back) hist(`${key} → ${LABEL[to]}`, () => move(key, from, to, { undo: false })); else toast(`${key} → ${LABEL[to]}`);
    return true;
  }
  async function claim(key) {
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/claim`).catch(() => null);
    if (!r || !r.ok) { toast(said(r, 'It couldn’t be taken.')); return after(key); }
    await after(key, r.d.task);
    hist(`You took ${key}`, () => patchTask(key, { assigneeId: null }, 'Undone', { undo: false }));
  }
  async function remove(key, { confirm = true } = {}) {
    const t = findTask(key);
    if (confirm && !(await D().confirm({ title: `Delete ${key}?`, body: `<b>${esc(t ? t.title : key)}</b> disappears from every board. You can undo this, and its history is kept.`, action: 'Delete task' }))) return false;
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}`).catch(() => null);
    if (!r || !r.ok) { toast(said(r, `${key} couldn’t be deleted.`)); return false; }
    T.task.delete(key); T.sel.delete(key); if (T.list) T.list = T.list.filter((x) => x.key !== key);
    for (const [id, arr] of T.byProject) if (Array.isArray(arr)) T.byProject.set(id, arr.filter((x) => x.key !== key));
    if (document.querySelector(`#main [data-tk-root="task:${CSS.escape(key)}"]`)) go(null); else patch();
    try { window.XENO_AREA_LIVE?.loadNeeds?.(); } catch {}
    hist(`Deleted ${key}`, () => restore(key));
    return true;
  }
  async function restore(key) {
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/restore`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, `${key} couldn’t be restored.`));
    await after(key, r.d.task); toast(`Restored ${key}`);
  }
  async function rename(key) {
    const t = findTask(key); if (!t) return;
    const v = await D().form({ title: `Rename ${key}`, submit: 'Save', size: 'sm', fields: [{ id: 'title', label: 'Title', required: true, max: 300, value: t.title }] });
    if (v && v.title.trim() !== t.title) patchTask(key, { title: v.title.trim() }, 'Renamed');
  }
  function editDescription(key) { T.editing = key; patch(); setTimeout(() => { const ta = document.querySelector(`[data-tk-dedit="${CSS.escape(key)}"] textarea`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0); }
  async function labels(key) {
    const t = findTask(key); if (!t) return;
    const known = [...new Set(allLists().flat().flatMap((x) => x.labels || []))].sort().slice(0, 30);
    const v = await D().form({ title: `Labels on ${key}`, sub: known.length ? `In use: ${known.join(', ')}` : 'Short words that group tasks, like “launch” or “ui”.', submit: 'Save', size: 'sm', fields: [{ id: 'labels', label: 'Labels', type: 'chips', value: t.labels || [], placeholder: 'Type a label, Enter to add' }] });
    if (v) patchTask(key, { labels: v.labels || [] }, 'Labels saved');
  }
  async function pickDate(key) {
    const t = findTask(key);
    const v = await D().form({ title: `Due date for ${key}`, submit: 'Set', size: 'sm', fields: [{ id: 'd', label: 'Date (YYYY-MM-DD)', required: true, max: 10, value: t && t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : '', placeholder: '2026-12-31' }] });
    if (!v) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.d) || Number.isNaN(Date.parse(v.d))) return toast('Use a date like 2026-12-31');
    patchTask(key, { dueAt: new Date(v.d + 'T17:00:00').toISOString() }, 'Due date set');
  }
  async function pickParent(key) {
    const t = findTask(key); if (!t) return;
    const cands = allLists().flat().filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i && x.key !== key && pkey(x) === pkey(t) && !(x.parent && x.parent.key === key)).slice(0, 40);
    if (!cands.length && !t.parent) return toast('No other task in this place to put it under');
    const v = await D().form({ title: `Parent of ${key}`, sub: 'A sub-task lives under its parent, in the same project.', submit: 'Set parent', fields: [{ id: 'p', label: 'Parent task', type: 'choice', cols: 1, value: t.parent ? t.parent.key : 'none', options: [['none', 'None — a top-level task'], ...cands.map((c) => [c.key, `${c.key} · ${c.title}`])] }] });
    if (v) patchTask(key, { parentKey: v.p === 'none' ? null : v.p }, v.p === 'none' ? 'Now a top-level task' : `Now under ${v.p}`);
  }
  async function addLink(key) {
    const t = findTask(key); if (!t) return;
    const cands = allLists().flat().filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i && x.key !== key).slice(0, 60);
    const v = await D().form({ title: `Link ${key} to another task`, submit: 'Link', fields: [
      { id: 'kind', label: 'This task…', type: 'seg', value: 'relates', options: LINKS.map(([k, l]) => [k, l]) },
      { id: 'to', label: 'Task (key like T-12, or pick below)', max: 20, placeholder: 'T-12' },
      ...(cands.length ? [{ id: 'pick', label: 'Or pick', type: 'choice', cols: 1, value: '', options: [['', '—'], ...cands.map((c) => [c.key, `${c.key} · ${c.title}`])] }] : [])] });
    if (!v) return;
    const to = (v.to || v.pick || '').trim().toUpperCase(); if (!/^T-\d+$/.test(to)) return toast('Name a task like T-12');
    const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/links`, { kind: v.kind, to }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The link couldn’t be added.'));
    await after(key, r.d.task); toast('Linked');
  }
  async function unlink(key, id) {
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}/links/${encodeURIComponent(id)}`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.'));
    await after(key, r.d.task); toast('Link removed');
  }
  async function watchToggle(key) {
    const t = findTask(key); const on = !(t && t.watching);
    const r = await api(on ? 'PUT' : 'DELETE', `/api/tasks/${encodeURIComponent(key)}/watch`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'That couldn’t be changed.'));
    await after(key, r.d.task); toast(on ? 'You’ll hear about every change' : 'You won’t hear about this task any more');
  }
  async function addSubtask(key, title) {
    const r = await api('POST', '/api/tasks', { title, parentKey: key }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The sub-task couldn’t be created.'));
    await after(key); toast(`Added ${r.d.task.key}`);
  }
  async function toggleChecklist(key, idx) {
    const t = findTask(key); if (!t) return;
    const next = toggleCheck(t.body, idx); if (next === t.body) return;
    fresh({ ...t, body: next });
    patchTask(key, { body: next }, null, { undo: false });
  }
  async function editComment(key, id, body) {
    const r = await api('PATCH', `/api/tasks/${encodeURIComponent(key)}/comments/${encodeURIComponent(id)}`, { body }).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'The comment couldn’t be saved.'));
    T.editComment = null; await after(key, r.d.task);
  }
  async function removeComment(key, id) {
    if (!(await D().confirm({ title: 'Remove this comment?', body: 'Its words are removed for everyone. The thread shows that a comment was removed.', action: 'Remove comment' }))) return;
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}/comments/${encodeURIComponent(id)}`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.'));
    await after(key, r.d.task); toast('Comment removed');
  }
  /** Upload images to a task. Returns the attachments that were added, in order. */
  async function uploadFiles(key, files, { quiet = false } = {}) {
    const imgs = [...files].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!imgs.length) { toast('Only PNG, JPEG, GIF and WebP images can be added'); return []; }
    const ok = imgs.filter((f) => f.size <= MAX_IMG), big = imgs.length - ok.length;
    if (big) toast(`${big} image${big > 1 ? 's are' : ' is'} over 8 MB and ${big > 1 ? 'were' : 'was'} skipped`);
    if (!ok.length) return [];
    if (!quiet) toast(ok.length > 1 ? `Uploading ${ok.length} images…` : 'Uploading the image…');
    let last = null; const added = [];
    for (const f of ok) {
      const headers = { 'content-type': 'application/octet-stream', 'x-xeno-surface': 'xeno-web' }; const c = P.csrf && P.csrf(); if (c) headers['x-xeno-csrf'] = c;
      const name = f.name && f.name !== 'image.png' ? f.name : `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${f.type.split('/')[1]}`;
      const res = await fetch(`/api/tasks/${encodeURIComponent(key)}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', credentials: 'same-origin', headers, body: f }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok && d.task) { const was = new Set((last || findTask(key) || {}).attachments?.map((a) => a.id) || []); last = d.task; const a = d.task.attachments.filter((x) => !was.has(x.id)).at(-1) || d.task.attachments.at(-1); if (a) added.push(a); }
      else toast(d.error || 'An image couldn’t be added.');
    }
    if (last) { await after(key, last); if (!quiet) toast(added.length > 1 ? 'Images added' : 'Image added'); }
    return added;
  }
  const pickFiles = () => new Promise((res) => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp'; inp.multiple = true; inp.onchange = () => res([...inp.files]); inp.click(); });
  const chooseFiles = async (key) => { const f = await pickFiles(); if (f.length) uploadFiles(key, f); };
  /** Images pasted or dropped into an editor: uploaded to the task, then placed at the cursor as markdown. */
  async function imagesIntoEditor(key, ta, files) {
    const marker = `![uploading…]()`; insertAt(ta, marker);
    const added = await uploadFiles(key, files, { quiet: true });
    const at = ta.value.indexOf(marker);
    const md_ = added.map((a) => `![${a.filename.replace(/[\[\]]/g, '')}](attachment:${a.id})`).join('\n');
    if (at >= 0) { ta.setRangeText(md_, at, at + marker.length, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (added.length) toast(added.length > 1 ? 'Images added' : 'Image added');
  }
  async function unattach(key, id) {
    const r = await api('DELETE', `/api/tasks/${encodeURIComponent(key)}/attachments/${encodeURIComponent(id)}`).catch(() => null);
    if (!r || !r.ok) return toast(said(r, 'It couldn’t be removed.'));
    await after(key, r.d.task); toast('Image removed');
  }

  // a handoff brief for an agent CLI: everything needed to do the task, as markdown, on the clipboard
  async function copyPrompt(key) {
    let t = T.task.get(key);
    if (!t || t.missing || !t.events) { await loadTask(key); t = T.task.get(key); }
    if (!t || t.missing) return toast('The task couldn’t be loaded');
    const site = location.origin, link = `${site}/workspace/#/${t.area || 'overview'}/g/tasks/${t.key}`;
    const abs = (s) => String(s || '').replace(/\(attachment:([0-9a-f-]{36})\)/gi, (_, id) => `(${site}${imgUrl(t.key, id)})`);
    const who = (p) => (p ? `${p.name}${p.kind === 'agent' ? ' (agent)' : ''}` : 'nobody');
    const open = [], done = [];
    { let inCode = false; for (const l of String(t.body || '').split('\n')) { if (/^```/.test(l)) inCode = !inCode; else if (!inCode) { const m = CHECK.exec(l); if (m) (m[2] === ' ' ? open : done).push(m[3]); } } }
    const comments = (t.events || []).filter((e) => e.kind === 'comment' && !e.removed && e.note).slice(-10);
    const lines = [
      `# ${t.key}: ${t.title}`, '',
      `You are picking up a task from XENO Tasks. Do the work it describes, verify it, then report back as described at the end.`, '',
      '## The task',
      `- **Key:** ${t.key} — ${link}`,
      `- **Status:** ${LABEL[t.status]} · **Type:** ${(KIND[t.kind] || KIND.task)[1]} · **Priority:** ${PRI[t.priority]}${t.dueAt ? ` · **Due:** ${new Date(t.dueAt).toISOString().slice(0, 10)}` : ''}`,
      `- **Where:** ${t.project ? `project “${t.project.name}”` : 'personal task'}, area ${t.area ? P.areaName(t.area) : 'Overview'}`,
      `- **Reported by:** ${who(t.reporter)} · **Assignee:** ${who(t.assignee)} · **Reviewer:** ${who(t.reviewer)}${t.reviewRequired ? ' (review required)' : ''}`,
      ...((t.labels || []).length ? [`- **Labels:** ${t.labels.join(', ')}`] : []),
      ...(t.parent ? [`- **Part of:** ${t.parent.key} — ${t.parent.title}`] : []),
      ...((t.links || []).length ? [`- **Linked:** ${t.links.map((l) => `${l.label} ${l.task.key} (${l.task.title}, ${LABEL[l.task.status]})`).join('; ')}`] : []),
      '', '## Description', t.body ? abs(t.body) : '_No description was written. Ask for one if the title is not enough._',
      ...((t.children || []).length ? ['', '## Sub-tasks', ...t.children.map((c) => `- [${CLOSED.includes(c.status) ? 'x' : ' '}] ${c.key} — ${c.title} (${LABEL[c.status]})`)] : []),
      ...((t.attachments || []).length ? ['', '## Images', ...t.attachments.map((a) => `- ${a.filename}: ${site}${imgUrl(t.key, a.id)}`), '_Opening these needs a signed-in XENO session._'] : []),
      ...(comments.length ? ['', '## Discussion so far', ...comments.map((e) => `- **${e.actor ? e.actor.name : 'Someone'}** (${new Date(e.at).toISOString().slice(0, 10)}): ${abs(e.note).replace(/\n+/g, ' ')}`)] : []),
      '', '## Done means',
      ...(open.length ? open.map((x) => `- [ ] ${x}`) : ['- What the description asks for works, and you have checked it yourself.']),
      ...(done.length ? [`- (already done: ${done.join('; ')})`] : []),
      ...(t.reviewRequired && t.reviewer ? [`- It goes to ${who(t.reviewer)} for review. You do not mark it done yourself.`] : []),
      '', '## When you finish',
      `Report: what you changed, how you verified it, and anything left open. Post that report as a comment on ${t.key} (${link})${t.reviewRequired ? ' and move it to In review' : ''}.`,
    ];
    await window.XCM.H.copy(lines.join('\n'), `Copied ${t.key} as an agent prompt`);
  }

  // several at once
  const selected = () => [...T.sel].map(findTask).filter(Boolean);
  async function bulk(what, anchor) {
    const ts = selected(); if (!ts.length) return;
    const r = anchor.getBoundingClientRect(), at = { x: r.left, y: r.top - 8, opener: anchor };
    const run = async (label, fn) => { let ok = 0, no = 0; for (const t of ts) { (await fn(t)) ? ok++ : no++; } T.sel.clear(); patch(); toast(no ? `${label}: ${ok} done, ${no} not allowed` : `${label}: ${ok} done`); };
    const asPatch = async (t, body) => { const res = await api('PATCH', `/api/tasks/${encodeURIComponent(t.key)}`, body).catch(() => null); if (res && res.ok) { fresh(res.d.task); return true; } return false; };
    if (what === 'move') {
      const opts = [...new Set(ts.flatMap((t) => (t.can && t.can.moves) || []))];
      if (!opts.length) return toast('None of these can be moved by you');
      window.XCM?.show([opts.map((m) => ({ label: `${LABEL[m]}${ts.every((t) => t.can.moves.includes(m)) ? '' : ' (where allowed)'}`, run: () => run(`Moved to ${LABEL[m]}`, async (t) => { if (!t.can.moves.includes(m) || m === 'blocked' || m === 'wont_do') return false; const res = await api('POST', `/api/tasks/${encodeURIComponent(t.key)}/transition`, { to: m, from: t.status }).catch(() => null); if (res && res.ok) { fresh(res.d.task); return true; } return false; }).then(() => after(ts[0].key)) }))], at);
    } else if (what === 'priority') {
      window.XCM?.show([PRI_ORDER.map((p) => ({ label: PRI[p], run: () => run(`Priority ${PRI[p]}`, (t) => asPatch(t, { priority: p })) }))], at);
    } else if (what === 'assign') {
      const list = await people(ts[0].project ? ts[0].project.id : null);
      window.XCM?.show([[{ label: 'Unassigned', icon: 'x', run: () => run('Unassigned', (t) => asPatch(t, { assigneeId: null })) }, ...list.filter((p) => !p.needsShare).map((p) => ({ label: p.name + (p.me ? ' (me)' : '') + (p.kind === 'agent' ? ' · agent' : ''), icon: p.kind === 'agent' ? 'bot' : 'user', run: () => run(`Assigned to ${p.name}`, (t) => asPatch(t, { assigneeId: p.id })) }))]], at);
    } else if (what === 'delete') {
      if (!(await D().confirm({ title: `Delete ${ts.length} task${ts.length > 1 ? 's' : ''}?`, body: `${ts.map((t) => `<b>${esc(t.key)}</b>`).join(', ')} disappear from every board. Each can be restored, and their history is kept.`, action: 'Delete' }))) return;
      const done = []; let no = 0;
      for (const t of ts) { if (await remove(t.key, { confirm: false })) done.push(t.key); else no++; }
      T.sel.clear(); patch();
      if (done.length) hist(`Deleted ${done.length} task${done.length > 1 ? 's' : ''}`, async () => { for (const k of done) await restore(k); });
      if (no) toast(`${no} couldn’t be deleted by you`);
    }
  }

  // ───────────────────────── menus
  function assignItems(t, field) {
    const cached = T.people.get(pkey(t)), current = t[field] ? t[field].id : null;
    const set = (id) => (field === 'assignee' ? patchTask(t.key, { assigneeId: id }, id ? 'Assigned' : 'Unassigned') : patchTask(t.key, { reviewerId: id, reviewRequired: !!id }, id ? 'Reviewer set' : 'Review removed'));
    if (!cached) { people(t.project ? t.project.id : null); return [{ label: 'Loading people…', disabled: 'Loading' }]; }
    const mineIt = t.assignee && t.assignee.id === me();
    if (field === 'assignee' && !(t.can && t.can.edit)) return mineIt ? [{ label: 'Unassign me', icon: 'x', run: () => set(null) }] : [];
    const list = cached.filter((p) => !(field === 'reviewer' && t.assignee && p.id === t.assignee.id));
    return [{ label: field === 'assignee' ? 'Unassigned' : 'No review', icon: 'x', checked: !current, run: () => set(null) },
      ...list.map((p) => ({ label: p.name + (p.me ? ' (me)' : '') + (p.kind === 'agent' ? ' · agent' : ''), icon: p.kind === 'agent' ? 'bot' : 'user', checked: p.id === current, ...(p.needsShare ? { disabled: 'Share the project with this agent first' } : { run: () => set(p.id) }) }))];
  }
  function menuFor(key) {
    const t = findTask(key); if (!t) return [[{ label: 'Open', icon: 'open', run: () => go(key) }]];
    const can = t.can || { moves: [] }, H2 = window.XCM.H, hash = `#/${P.area() || 'overview'}/g/tasks/${key}`;
    const mineIt = !!(t.assignee && t.assignee.id === me()), editAny = can.edit || mineIt;
    if (!T.people.has(pkey(t))) people(t.project ? t.project.id : null);
    return [
      [{ label: 'Open', icon: 'open', key: 'Enter', kbd: '↵', run: () => go(key) }, { label: 'Open in new window', icon: 'hub', run: () => H2.openWindow(hash) }],
      [!t.assignee && !CLOSED.includes(t.status) ? { label: 'Take it', icon: 'user', run: () => claim(key) } : null,
        can.moves.length ? { label: 'Move to', icon: 'flow', sub: can.moves.map((m) => ({ label: LABEL[m], run: () => move(key, m, t.status) })) } : { label: 'Move to', icon: 'flow', disabled: 'You can’t move this task' },
        editAny ? { label: 'Assign to', icon: 'people', sub: assignItems(t, 'assignee') } : { label: 'Assign to', icon: 'people', disabled: 'Only someone who manages the project can assign it' },
        can.edit ? { label: 'Reviewer', icon: 'check', sub: assignItems(t, 'reviewer') } : { label: 'Reviewer', icon: 'check', disabled: 'Only someone who manages the project can set the review' },
        editAny ? { label: 'Priority', icon: 'up', sub: PRI_ORDER.map((p) => ({ label: PRI[p], checked: t.priority === p, run: () => patchTask(key, { priority: p }, 'Priority set') })) } : { label: 'Priority', icon: 'up', disabled: 'Only the assignee or a manager can change it' }],
      [can.edit ? { label: 'Rename', icon: 'edit', key: 'F2', kbd: 'F2', run: () => rename(key) } : { label: 'Rename', icon: 'edit', disabled: 'Only someone who manages the project can rename it' },
        editAny ? { label: 'Add sub-task', icon: 'layers', run: () => newTask(t.project ? t.project.id : null, { parentKey: key }) } : null,
        t.canLink !== false && (can.edit || mineIt) ? { label: 'Link a task…', icon: 'share', run: () => { if (!T.task.get(key)) loadTask(key).then(() => addLink(key)); else addLink(key); } } : null,
        can.attach ? { label: 'Add images…', icon: 'image', run: () => chooseFiles(key) } : null,
        { label: T.sel.has(key) ? 'Deselect' : 'Select', icon: 'check', key: 'x', kbd: 'X', run: () => { T.sel.has(key) ? T.sel.delete(key) : T.sel.add(key); patch(); } },
        { label: 'Refresh', icon: 'reset', run: () => { T.task.delete(key); loadTask(key); load(); } }],
      [{ label: 'Copy as agent prompt', icon: 'bot', run: () => copyPrompt(key) }, { label: 'Copy link', icon: 'share', run: () => H2.copyLink(hash) }, { label: 'Copy key', icon: 'hash', run: () => H2.copy(key, 'Key copied') }],
      [can.delete ? { label: 'Delete task', icon: 'trash', danger: true, key: 'Delete', kbd: 'Del', run: () => remove(key) } : { label: 'Delete task', icon: 'trash', danger: true, disabled: 'Only a project admin, or the reporter while it is in Triage, can delete it' }],
    ];
  }
  if (window.XCM) window.XCM.register({ id: 'tasks', priority: 5, sel: '[data-tk-card], [data-tk-rowkey], [data-tk-root^="task:"]', build: (n) => menuFor(n.dataset.tkCard || n.dataset.tkRowkey || n.dataset.tkRoot.slice(5)) });
  function propMenu(key, field, anchor) {
    const t = findTask(key); if (!t || !window.XCM) return;
    const r = anchor.getBoundingClientRect(), at = { x: r.left, y: r.bottom + 4, opener: anchor };
    const end = (d) => { const x = new Date(Date.now() + d * 86400000); x.setHours(17, 0, 0, 0); return x.toISOString(); };
    const needPeople = () => { if (T.people.has(pkey(t))) return false; people(t.project ? t.project.id : null).then(() => { if (document.body.contains(anchor)) propMenu(key, field, anchor); }); return true; };
    const S = {
      status: () => [t.can.moves.map((m) => ({ label: LABEL[m], run: () => move(key, m, t.status) }))],
      assignee: () => (needPeople() ? [[{ label: 'Loading people…', disabled: 'Loading' }]] : [assignItems(t, 'assignee')]),
      reviewer: () => (needPeople() ? [[{ label: 'Loading people…', disabled: 'Loading' }]] : [assignItems(t, 'reviewer')]),
      priority: () => [PRI_ORDER.map((p) => ({ label: PRI[p], checked: t.priority === p, run: () => patchTask(key, { priority: p }, 'Priority set') }))],
      kind: () => [Object.entries(KIND).map(([k, [icon, l]]) => ({ label: l, icon, checked: t.kind === k, run: () => patchTask(key, { kind: k }, 'Type set') }))],
      due: () => [[{ label: 'Today', run: () => patchTask(key, { dueAt: end(0) }, 'Due today') }, { label: 'Tomorrow', run: () => patchTask(key, { dueAt: end(1) }, 'Due tomorrow') }, { label: 'In a week', run: () => patchTask(key, { dueAt: end(7) }, 'Due in a week') }, { label: 'In two weeks', run: () => patchTask(key, { dueAt: end(14) }, 'Due in two weeks') }],
        [{ label: 'Pick a date…', icon: 'calendar', run: () => pickDate(key) }, ...(t.dueAt ? [{ label: 'Clear', icon: 'x', run: () => patchTask(key, { dueAt: null }, 'Due date cleared') }] : [])]],
      labels: () => { labels(key); return null; },
      parent: () => { pickParent(key); return null; },
    };
    const s = S[field] && S[field](); if (s && s.flat().length) window.XCM.show(s, at);
  }

  // ───────────────────────── the New task window (the platform's plate construction, MODES SPEC §7f)
  async function newTask(projectId, preset = {}) {
    if (document.querySelector('.xd [data-tk-new]')) return;
    const here = P.area(), projects = ((window.XENO_PG_PROJECTS || {}).items || []).filter((p) => p.id && p.status !== 'archived' && (!here || p.area === here));
    const N = { kind: 'task', priority: 'none', assignee: null, reviewer: null, dueAt: null, labels: [], projectId: projectId || null, parentKey: preset.parentKey || null, files: [], seq: 0 };
    const parentT = N.parentKey ? findTask(N.parentKey) : null;
    if (parentT) N.projectId = parentT.project ? parentT.project.id : null;
    const projName = () => (N.projectId ? ((projects.find((p) => p.id === N.projectId) || {}).realName || (projects.find((p) => p.id === N.projectId) || {}).name || (parentT && parentT.project && parentT.project.name) || 'Project') : 'Personal');
    const chip = (id, icon, label, on) => `<button type="button" class="tk-nchip${on ? ' on' : ''}" data-n-chip="${id}">${ic(icon)}<span>${label}</span></button>`;
    const chips = () => [
      chip('kind', KIND[N.kind][0], KIND[N.kind][1], N.kind !== 'task'),
      chip('priority', 'up', N.priority === 'none' ? 'Priority' : PRI[N.priority], N.priority !== 'none'),
      chip('assignee', N.assignee && N.assignee.kind === 'agent' ? 'bot' : 'user', N.assignee ? esc(N.assignee.name) : 'Assignee', !!N.assignee),
      chip('reviewer', 'check', N.reviewer ? `Review: ${esc(N.reviewer.name)}` : 'Reviewer', !!N.reviewer),
      chip('due', 'calendar', N.dueAt ? esc(day(N.dueAt)) : 'Due date', !!N.dueAt),
      chip('labels', 'hash', N.labels.length ? esc(N.labels.join(', ')) : 'Labels', N.labels.length > 0),
      ...(parentT ? [] : [chip('project', 'folder', esc(projName()), !!N.projectId)]),
    ].join('');
    const thumbs = () => N.files.map((f) => `<figure class="tk-nimg" data-n-file="${f.n}"><img src="${f.url}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption><button type="button" class="tk-img-x" data-n-unfile="${f.n}" aria-label="Remove ${esc(f.name)}">${ic('x')}</button></figure>`).join('');
    const ctx = parentT ? `Sub-task of <b>${esc(parentT.key)}</b> ${esc(parentT.title)}` : `New task in <b>${esc(N.projectId ? projName() : where())}</b>`;
    const html = `<header class="xd-pl xd-head tk-nh" data-tk-new><div><b>New task</b><small>${ctx} · it lands in Triage until someone accepts it</small></div><button class="xd-ib" data-xd-close aria-label="Close">${ic('x')}</button></header>
      <div class="xd-pl xd-body tk-nb">
        <input class="tk-ntitle" data-n-title maxlength="300" placeholder="Task title" aria-label="Task title" autocomplete="off">
        ${editor({ keep: 'new-desc', rows: 7, placeholder: 'Add a description — what needs doing and how we’ll know it’s done. Markdown, checklists (- [ ]), @mentions. Paste or drop images.', project: N.projectId || '' })}
        <div class="tk-nimgs" data-n-imgs>${thumbs()}</div>
        <div class="tk-nchips" data-n-chips>${chips()}</div>
      </div>
      <footer class="xd-pl xd-foot tk-nf"><button type="button" class="xd-btn ghost sm" data-n-attach>${ic('image')}Add images</button><span class="xd-sp"></span><label class="tk-nmore"><input type="checkbox" data-n-more> Create more</label><button type="button" class="xd-btn ghost" data-xd-close>Cancel</button><button type="button" class="xd-btn" data-n-create>Create task <kbd>Ctrl ↵</kbd></button></footer>`;
    let sh = null, busy = false;
    const dlg = D().openShell({ size: 'md tk-nwin', label: 'New task', html, dirty: () => !!(sh && (sh.querySelector('[data-n-title]').value.trim() || sh.querySelector('textarea').value.trim() || N.files.length)), onMount: (a) => { sh = a.sh; setTimeout(() => sh.querySelector('[data-n-title]').focus(), 30); }, onClose: () => { for (const f of N.files) URL.revokeObjectURL(f.url); } });
    const ta = () => sh.querySelector('textarea[data-tk-ed]');
    const repaintChips = () => { const was = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.nChip : null; sh.querySelector('[data-n-chips]').innerHTML = chips(); sh.querySelector('textarea[data-tk-ed]').dataset.tkMention = N.projectId || ''; const back = sh.querySelector(`[data-n-chip="${was || lastChip}"]`); if (back) back.focus(); };
    let lastChip = null;
    const addFiles = (files, inline) => {
      const ok = [...files].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type) && f.size <= MAX_IMG);
      if (ok.length < files.length) toast('Only PNG, JPEG, GIF or WebP images up to 8 MB can be added');
      for (const f of ok) { const n = ++N.seq; const name = f.name && f.name !== 'image.png' ? f.name : `pasted-${n}.${f.type.split('/')[1]}`; N.files.push({ n, file: f, name, url: URL.createObjectURL(f) }); if (inline) insertAt(ta(), `![${name.replace(/[\[\]]/g, '')}](pending:${n})\n`); }
      sh.querySelector('[data-n-imgs]').innerHTML = thumbs();
    };
    const menu = async (id, el) => {
      const r = el.getBoundingClientRect(), at = { x: r.left, y: r.bottom + 4, opener: el };
      const end = (d) => { const x = new Date(Date.now() + d * 86400000); x.setHours(17, 0, 0, 0); return x.toISOString(); };
      const set = (k, v) => () => { N[k] = v; repaintChips(); };
      if (id === 'kind') return window.XCM.show([Object.entries(KIND).map(([k, [i, l]]) => ({ label: l, icon: i, checked: N.kind === k, run: set('kind', k) }))], at);
      if (id === 'priority') return window.XCM.show([PRI_ORDER.map((p) => ({ label: PRI[p], checked: N.priority === p, run: set('priority', p) }))], at);
      if (id === 'due') return window.XCM.show([[['Today', 0], ['Tomorrow', 1], ['In a week', 7], ['In two weeks', 14]].map(([l, d]) => ({ label: l, run: set('dueAt', end(d)) })), N.dueAt ? [{ label: 'No due date', icon: 'x', run: set('dueAt', null) }] : []], at);
      if (id === 'project') return window.XCM.show([[{ label: 'Personal — just me', checked: !N.projectId, run: () => { N.projectId = null; N.assignee = N.assignee && N.assignee.me ? N.assignee : null; N.reviewer = null; repaintChips(); } }, ...projects.map((p) => ({ label: p.realName || p.name, checked: N.projectId === p.id, run: () => { N.projectId = p.id; N.assignee = null; N.reviewer = null; repaintChips(); } }))]], at);
      if (id === 'labels') { const v = await D().form({ title: 'Labels', submit: 'Done', size: 'sm', fields: [{ id: 'labels', label: 'Labels', type: 'chips', value: N.labels, placeholder: 'Type a label, Enter to add' }] }); if (v) { N.labels = v.labels || []; repaintChips(); } return; }
      if (id === 'assignee' || id === 'reviewer') {
        const list = await people(N.projectId);
        return window.XCM.show([[{ label: id === 'assignee' ? 'Unassigned' : 'No review', icon: 'x', checked: !N[id], run: set(id, null) }, ...list.filter((p) => !(id === 'reviewer' && N.assignee && p.id === N.assignee.id)).map((p) => ({ label: p.name + (p.me ? ' (me)' : '') + (p.kind === 'agent' ? ' · agent' : ''), icon: p.kind === 'agent' ? 'bot' : 'user', checked: N[id] && N[id].id === p.id, ...(p.needsShare ? { disabled: 'Share the project with this agent first' } : { run: set(id, p) }) }))]], at);
      }
    };
    const create = async () => {
      if (busy) return;
      const title = sh.querySelector('[data-n-title]').value.trim(), body = ta().value;
      if (!title) { sh.querySelector('[data-n-title]').focus(); return toast('Give the task a title'); }
      busy = true; const btn = sh.querySelector('[data-n-create]'); btn.disabled = true; btn.firstChild.textContent = 'Creating…';
      const payload = { title, body, kind: N.kind, priority: N.priority, labels: N.labels, ...(N.parentKey ? { parentKey: N.parentKey } : N.projectId ? { projectId: N.projectId } : { area: here }), ...(N.assignee ? { assigneeId: N.assignee.id } : {}), ...(N.reviewer ? { reviewerId: N.reviewer.id, reviewRequired: true } : {}), ...(N.dueAt ? { dueAt: N.dueAt } : {}) };
      const r = await api('POST', '/api/tasks', payload).catch(() => null);
      if (!r || !r.ok) { busy = false; btn.disabled = false; btn.firstChild.textContent = 'Create task '; return toast(said(r, 'The task couldn’t be created. Nothing was saved.')); }
      const t = r.d.task; T.task.set(t.key, t);
      if (N.files.length) {
        const added = await uploadFiles(t.key, N.files.map((f) => new File([f.file], f.name, { type: f.file.type })), { quiet: true });
        let nb = body; N.files.forEach((f, i) => { const a = added[i]; nb = nb.split(`(pending:${f.n})`).join(a ? `(attachment:${a.id})` : '()'); });
        if (nb !== body) await api('PATCH', `/api/tasks/${encodeURIComponent(t.key)}`, { body: nb }).catch(() => null);
        T.task.delete(t.key);
      }
      const more = sh.querySelector('[data-n-more]').checked;
      toast(`Created ${t.key}${N.files.length ? ` with ${N.files.length} image${N.files.length > 1 ? 's' : ''}` : ''}`);
      if (N.parentKey) T.task.delete(N.parentKey);
      load(); for (const id of T.byProject.keys()) loadProject(id); if (N.parentKey) loadTask(N.parentKey);
      if (more) { busy = false; btn.disabled = false; btn.firstChild.textContent = 'Create task '; sh.querySelector('[data-n-title]').value = ''; ta().value = ''; for (const f of N.files) URL.revokeObjectURL(f.url); N.files = []; sh.querySelector('[data-n-imgs]').innerHTML = ''; sh.querySelector('[data-n-title]').focus(); return; }
      const fromProject = !!projectId && !N.parentKey;
      dlg.close('created');
      if (!fromProject && !N.parentKey) go(t.key);
    };
    sh.addEventListener('click', (e) => {
      const c = e.target.closest('[data-n-chip]'); if (c) { e.preventDefault(); lastChip = c.dataset.nChip; return menu(c.dataset.nChip, c); }
      const fx = e.target.closest('[data-tk-fmt]'); if (fx) { e.preventDefault(); return format(ta(), fx.dataset.tkFmt); }
      if (e.target.closest('[data-n-attach]')) { e.preventDefault(); return pickFiles().then((f) => addFiles(f, false)); }
      const un = e.target.closest('[data-n-unfile]'); if (un) { e.preventDefault(); const n = +un.dataset.nUnfile; const f = N.files.find((x) => x.n === n); if (f) URL.revokeObjectURL(f.url); N.files = N.files.filter((x) => x.n !== n); ta().value = ta().value.split(new RegExp(`!\\[[^\\]]*\\]\\(pending:${n}\\)\\n?`)).join(''); sh.querySelector('[data-n-imgs]').innerHTML = thumbs(); return; }
      if (e.target.closest('[data-n-create]')) { e.preventDefault(); return create(); }
    });
    sh.addEventListener('tk-image-pick', () => pickFiles().then((f) => addFiles(f, true)));
    // Ctrl+Enter creates from anywhere while this window is the top one (focus can sit on the page after a menu closes)
    const onKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && document.body.contains(sh) && !window.XCM?.isOpen?.() && [...document.querySelectorAll('.xd')].at(-1) === sh.closest('.xd')) { e.preventDefault(); e.stopPropagation(); create(); } };
    document.addEventListener('keydown', onKey, true);
    new MutationObserver((_, mo) => { if (!document.body.contains(sh)) { document.removeEventListener('keydown', onKey, true); mo.disconnect(); } }).observe(document.body, { childList: true });
    sh.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-n-title]')) { e.preventDefault(); ta().focus(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i') && e.target === ta()) { e.preventDefault(); format(ta(), e.key === 'b' ? 'bold' : 'italic'); }
    });
    sh.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); e.stopPropagation(); addFiles(f, e.target === ta()); } });
    sh.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); sh.classList.add('tk-ndrop'); } });
    sh.addEventListener('dragleave', (e) => { if (!sh.contains(e.relatedTarget)) sh.classList.remove('tk-ndrop'); });
    sh.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); sh.classList.remove('tk-ndrop'); addFiles(e.dataTransfer.files, e.target === ta()); } });
  }

  // ───────────────────────── keyboard
  const typing = (el) => !!el && (el.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  const inTasks = () => !!document.querySelector('#main [data-tk-root], #main [data-tk-proot]');
  function shortcuts() {
    const rows = [['C', 'New task'], ['/', 'Search the board'], ['J / K', 'Next / previous task'], ['Enter', 'Open the focused task'], ['X', 'Select the focused task'], ['Esc', 'Clear the selection · close'], ['S', 'Status (on a task)'], ['I', 'Assignee'], ['P', 'Priority'], ['D', 'Due date'], ['L', 'Labels'], ['E', 'Edit the description'], ['M', 'Write a comment'], ['W', 'Watch / stop watching'], ['F2', 'Rename'], ['Ctrl+Z', 'Undo the last change']];
    D().info({ title: 'Task shortcuts', html: `<div class="tk-keys">${rows.map(([k, l]) => `<div><kbd>${esc(k)}</kbd><span>${esc(l)}</span></div>`).join('')}</div>` });
  }
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('.xd') || window.XCM?.isOpen?.() || !inTasks()) return;
    const k = e.key, open = document.querySelector('#main [data-tk-root^="task:"]'), key = open ? open.dataset.tkRoot.slice(5) : null;
    const fire = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (k === 'c' || k === 'C') return fire(() => { const pr = document.querySelector('#main [data-tk-proot]'); newTask(pr ? pr.dataset.tkProot : (key && findTask(key) && findTask(key).project ? findTask(key).project.id : null)); });
    if (k === '?') return fire(shortcuts);
    if (k === '/') { const s = document.querySelector('#main [data-tk-search]'); if (s) return fire(() => s.focus()); }
    if (k === 'Escape' && T.sel.size) return fire(() => { T.sel.clear(); patch(); });
    if (key) {
      const b = (f) => document.querySelector(`#main [data-tk-prop="${f}"]`);
      const map = { s: 'status', i: 'assignee', p: 'priority', d: 'due', l: 'labels' };
      if (map[k.toLowerCase()] && b(map[k.toLowerCase()])) return fire(() => b(map[k.toLowerCase()]).click());
      if (k === 'e' || k === 'E') { const t = findTask(key); if (t && t.can && t.can.edit) return fire(() => editDescription(key)); }
      if (k === 'm' || k === 'M') return fire(() => document.querySelector('#main [data-tk-comment] textarea')?.focus());
      if (k === 'w' || k === 'W') return fire(() => watchToggle(key));
    }
    const items = [...document.querySelectorAll('#main [data-tk-card], #main [data-tk-rowkey]')];
    if ((k === 'j' || k === 'k' || k === 'ArrowDown' || k === 'ArrowUp') && items.length && !key) {
      const i = items.indexOf(document.activeElement); const n = k === 'j' || k === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      return fire(() => items[n].focus());
    }
    if ((k === 'x' || k === 'X') && document.activeElement?.matches?.('[data-tk-card], [data-tk-rowkey]')) { const kk = document.activeElement.dataset.tkCard || document.activeElement.dataset.tkRowkey; return fire(() => { T.sel.has(kk) ? T.sel.delete(kk) : T.sel.add(kk); patch(); document.querySelector(`#main [data-tk-card="${CSS.escape(kk)}"], #main [data-tk-rowkey="${CSS.escape(kk)}"]`)?.focus(); }); }
  });

  // ───────────────────────── events
  const ACT = {
    board: () => go(null), retry: () => { T.status = 'loading'; patch(); load(); }, 'retry-project': (id) => { T.byProject.set(id, 'loading'); patch(); loadProject(id); },
    open: (k) => go(k), new: (pid) => newTask(pid || null), rename, describe: (k) => editDescription(k), claim, attach: (k) => chooseFiles(k),
    refresh: (k) => { T.task.delete(k); patch(); loadTask(k); },
    menu: (k, el) => { const r = el.getBoundingClientRect(); window.XCM?.show(menuFor(k), { x: r.left, y: r.bottom + 4, opener: el }); },
    prop: (arg, el) => { const [k, f] = arg.split('|'); propMenu(k, f, el); },
    move: (arg) => { const [k, to, from] = arg.split('|'); return move(k, to, from); },
    unattach: (arg) => { const [k, id] = arg.split('|'); return unattach(k, id); },
    select: (k) => { T.sel.has(k) ? T.sel.delete(k) : T.sel.add(k); patch(); }, unselect: () => { T.sel.clear(); patch(); },
    bulk: (what, el) => bulk(what, el),
    filters: (_, el) => filterMenu(el), sort: (_, el) => sortMenu(el),
    layout: (v) => { T.f.layout = v; saveF(); patch(); },
    unfilter: (arg) => { const [k, v] = arg.split('|'); if (k === 'due') T.f.due = ''; else T.f[k] = T.f[k].filter((x) => x !== v); T.viewId = null; saveF(); patch(); },
    'clear-filters': () => { T.f = { ...F0(), sort: T.f.sort, layout: T.f.layout }; T.viewId = null; saveF(); patch(); },
    'save-view': () => saveViewNow(),
    view: (id) => (T.viewId === id ? ACT['clear-filters']() : applyView(id)),
    watch: (k) => watchToggle(k), prompt: (k) => copyPrompt(k), 'add-link': (k) => addLink(k), unlink: (arg) => { const [k, id] = arg.split('|'); return unlink(k, id); },
    check: (arg) => { const [k, i] = arg.split('|'); return toggleChecklist(k, +i); },
    'desc-cancel': () => { T.editing = null; patch(); },
    'cedit-cancel': () => { T.editComment = null; patch(); },
    cmenu: (arg, el) => { const [k, id] = arg.split('|'); const t = findTask(k); const e = t && (t.events || []).find((x) => x.id === id); const mine = e && e.actor && e.actor.id === me(); const r = el.getBoundingClientRect();
      window.XCM?.show([[mine ? { label: 'Edit comment', icon: 'edit', run: () => { T.editComment = id; patch(); setTimeout(() => document.querySelector(`[data-tk-cedit$="|${CSS.escape(id)}"] textarea`)?.focus(), 0); } } : null, { label: 'Copy text', icon: 'doc', run: () => window.XCM.H.copy(e ? e.note : '', 'Copied') }].filter(Boolean), [{ label: 'Remove comment', icon: 'trash', danger: true, run: () => removeComment(k, id) }]], { x: r.left, y: r.bottom + 4, opener: el }); },
  };
  addEventListener('contextmenu', (e) => { const v = e.target.closest?.('[data-tk-view]'); if (!v || e.shiftKey) return; e.preventDefault(); e.stopImmediatePropagation(); const id = v.dataset.tkView; window.XCM?.show([[{ label: 'Apply', run: () => applyView(id) }, { label: 'Delete view', icon: 'trash', danger: true, run: () => deleteView(id) }]], { x: e.clientX, y: e.clientY, opener: v }); }, true);
  addEventListener('click', (e) => {
    if (e.button !== 0 || e.target.closest('.xd, .xcm')) return;
    if (e.target.closest('.tk-img a, .tk-md a[href], .tk-md-imgl')) return;
    const fx = e.target.closest('#main [data-tk-fmt]'); if (fx) { e.preventDefault(); const ta = fx.closest('.tk-editor').querySelector('textarea'); if (fx.dataset.tkFmt === 'image') { const key = (ta.dataset.tkKeep || '').split(':').slice(1).join(':'); const k2 = (document.querySelector('#main [data-tk-root^="task:"]') || {}).dataset?.tkRoot?.slice(5); pickFiles().then((f) => f.length && imagesIntoEditor(k2 || key, ta, f)); } else format(ta, fx.dataset.tkFmt); return; }
    const desc = e.target.closest('[data-tk-desc]'); if (desc && !e.target.closest('a, button')) { e.preventDefault(); return editDescription(desc.dataset.tkDesc); }
    // Ctrl/Shift-click selects instead of opening (Linear, Finder)
    const sel = e.target.closest('[data-tk-card], [data-tk-rowkey]');
    if (sel && (e.ctrlKey || e.metaKey || e.shiftKey) && !e.target.closest('[data-tk="menu"]')) { e.preventDefault(); e.stopImmediatePropagation(); const k = sel.dataset.tkCard || sel.dataset.tkRowkey; T.sel.has(k) ? T.sel.delete(k) : T.sel.add(k); patch(); return; }
    const el = e.target.closest('[data-tk="menu"], [data-tk="unattach"], [data-tk="select"], [data-tk="check"], [data-tk="cmenu"], [data-tk="unlink"], .tk-md [data-tk="open"]') || e.target.closest('[data-tk]'); if (!el) return;
    const k = el.dataset.tk; if (!ACT[k]) return;
    e.preventDefault(); e.stopImmediatePropagation();
    Promise.resolve(ACT[k](el.dataset.arg, el)).catch(() => toast('Something went wrong. Nothing changed.'));
  }, true);
  addEventListener('input', (e) => { const s = e.target.closest?.('#main [data-tk-search]'); if (!s) return; T.f.q = s.value; T.viewId = null; saveF(); clearTimeout(s.__t); s.__t = setTimeout(patch, 120); }, true);
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest?.('[data-tk-comment] textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); t.form.requestSubmit(); return; }
    if (t.closest?.('#main .tk-editor textarea')) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); t.form?.requestSubmit(); return; }
      if (e.key === 'Escape' && pop.hidden) { e.preventDefault(); if (t.closest('[data-tk-dedit]')) ACT['desc-cancel'](); else if (t.closest('[data-tk-cedit]')) ACT['cedit-cancel'](); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); format(t, e.key === 'b' ? 'bold' : 'italic'); return; }
    }
    if (t.matches?.('#main [data-tk-search]') && e.key === 'Escape') { e.preventDefault(); t.value = ''; T.f.q = ''; saveF(); patch(); t.blur(); return; }
    const el = t.closest?.('[data-tk][role="button"]');
    if (el && el === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
  }, true);
  addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.matches('[data-tk-comment]')) {
      e.preventDefault(); e.stopImmediatePropagation();
      const ta = f.querySelector('textarea'), body = ta.value.trim(), key = f.dataset.tkComment; if (!body) { ta.focus(); return toast('Write something first'); }
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
      const r = await api('POST', `/api/tasks/${encodeURIComponent(key)}/comments`, { body }).catch(() => null);
      btn.disabled = false;
      if (!r || !r.ok) return toast(said(r, 'The comment couldn’t be sent. Your words are still in the box.'));
      ta.value = ''; await after(key, r.d.task); return;
    }
    if (f.matches('[data-tk-dedit]')) {
      e.preventDefault(); e.stopImmediatePropagation();
      const key = f.dataset.tkDedit, v = f.querySelector('textarea').value, t = findTask(key);
      T.editing = null; if (t && v !== (t.body || '')) await patchTask(key, { body: v }, 'Description saved'); else patch(); return;
    }
    if (f.matches('[data-tk-cedit]')) { e.preventDefault(); e.stopImmediatePropagation(); const [key, id] = f.dataset.tkCedit.split('|'); const v = f.querySelector('textarea').value.trim(); if (!v) return toast('A comment can’t be empty — remove it instead'); return editComment(key, id, v); }
    if (f.matches('[data-tk-kidadd]')) { e.preventDefault(); e.stopImmediatePropagation(); const inp = f.querySelector('input'), v = inp.value.trim(); if (!v) return; inp.value = ''; return addSubtask(f.dataset.tkKidadd, v); }
  }, true);
  // images: into the editor or comment box being typed in; otherwise onto the task's gallery
  const openKey = () => { const r = document.querySelector('#main [data-tk-root^="task:"]'); const t = r && T.task.get(r.dataset.tkRoot.slice(5)); return t && !t.missing && t.can && t.can.attach ? t.key : null; };
  addEventListener('paste', (e) => {
    if (e.target.closest?.('.xd')) return;
    const key = openKey(); if (!key) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const ta = e.target.closest?.('#main .tk-editor textarea, #main [data-tk-comment] textarea');
    if (ta) imagesIntoEditor(key, ta, files); else uploadFiles(key, files);
  });
  const clearOver = () => document.querySelectorAll('.tk-col.over').forEach((c) => c.classList.remove('over'));
  addEventListener('dragover', (e) => {
    if (document.querySelector('[data-tk-dragging]')) { const col = e.target.closest?.('[data-tk-col]'); if (col) { e.preventDefault(); if (!col.classList.contains('over')) { clearOver(); col.classList.add('over'); } } return; }
    if (openKey() && [...(e.dataTransfer?.types || [])].includes('Files') && !e.target.closest?.('.xd')) { e.preventDefault(); document.querySelector('#main .tk-page')?.classList.add('tk-page--drop'); }
  });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget || !document.getElementById('main')?.contains(e.relatedTarget)) { document.querySelector('#main .tk-page')?.classList.remove('tk-page--drop'); clearOver(); } });
  addEventListener('drop', (e) => {
    if (e.target.closest?.('.xd')) return;
    document.querySelector('#main .tk-page')?.classList.remove('tk-page--drop');
    const card = document.querySelector('[data-tk-dragging]');
    if (card) {
      e.preventDefault(); clearOver();
      const col = e.target.closest?.('[data-tk-col]'), key = card.dataset.tkCard, t = findTask(key);
      if (!col || !t || col.dataset.tkCol === t.status) return;
      if (!(t.can && t.can.moves.includes(col.dataset.tkCol))) return toast(t.can && t.can.moves.length ? `${key} can’t go from ${LABEL[t.status]} to ${LABEL[col.dataset.tkCol]}` : `You can’t move ${key}`);
      move(key, col.dataset.tkCol, t.status); return;
    }
    const key = openKey(); if (!key || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const ta = e.target.closest?.('#main .tk-editor textarea, #main [data-tk-comment] textarea');
    if (ta) imagesIntoEditor(key, ta, e.dataTransfer.files); else uploadFiles(key, e.dataTransfer.files);
  });
  addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-tk-card]'); if (!c) return; c.setAttribute('data-tk-dragging', ''); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.tkCard); });
  addEventListener('dragend', (e) => { e.target.closest?.('[data-tk-card]')?.removeAttribute('data-tk-dragging'); clearOver(); });

  const label = (x) => { const t = findTask(x); return t && !t.missing ? `${t.key} · ${t.title}` : x; };
  window.XENO_TASKS = { served: true, label, route, projectTab, load, sync, patch, poll, newTask, markRead, md, state: () => ({ status: T.status, area: T.area === undefined ? undefined : T.area, count: (T.list || []).length, selected: T.sel.size }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
