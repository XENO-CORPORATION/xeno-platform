/* platform-home.js — on the platform, each area's home shows the person's own week and work.
 *
 * The picture's homes are drawn from samples: numbers ("128 renders this week", "Wallet €4,210", "€42,000 open
 * pipeline"), running jobs ("Launch trailer v3 — rendering 64%"), and a signature section per area (a render
 * filmstrip, an agent run board, a mail triage list, a revenue chart). Served by the platform they were shown as
 * the signed-in person's own. Here:
 *
 *   - the sample numbers are removed at once; "This week" is then filled from GET /api/workspace/summary with
 *     three facts per area: chats started, messages sent, scheduled runs done, each with its seven days;
 *   - the sample work rows under each area's sections (which also fed "Running now") are removed;
 *   - the signature section becomes "Your work in <area>": the chats, projects and files the person touched
 *     there most recently, from the same lists the sidebar reads. With none, it says so and offers a first step.
 *
 * What the platform cannot report is left out, not invented: no renders, mail, revenue, reach or agent runs.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_HOME_LIVE = { served: false }; return; }
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { status: 'loading', areas: {} };
  window.XENO_MODE_KPIS = {};
  // the picture's sample work rows live on the zones; without them nothing is "running" that is not real
  try { for (const zs of Object.values(window.XENO_MODE_ZONES || {})) for (const z of zs || []) delete z.work; } catch {}
  const LABELS = [['chats', 'Chats started'], ['messages', 'Messages sent'], ['runs', 'Scheduled runs']];
  const kpisOf = (week) => LABELS.map(([id, label]) => ({ id, label, value: week[id].reduce((a, b) => a + b, 0), unit: '', series: week[id].slice(), area: '' })).filter((k) => k.value > 0 || k.id !== 'runs');
  async function load() {
    const r = await api('GET', '/api/workspace/summary').catch(() => null);
    if (r && r.ok && r.d.areas && typeof r.d.areas === 'object') {
      const out = {}; for (const [id] of P.areas()) { const w = r.d.areas[id]; if (w && LABELS.some(([k]) => Array.isArray(w[k]) && w[k].some((n) => n > 0))) out[id] = kpisOf(w); }
      window.XENO_MODE_KPIS = out; H.areas = r.d.areas; H.status = 'ready';
    } else { window.XENO_MODE_KPIS = {}; H.status = 'error'; }
    try { const v = X()?.S?.view; if (v === 'mode' || v === 'dashboard') X()?.render?.(); } catch {}
  }
  // "Your work in <area>": what the person touched there, newest first
  function work(m) {
    const ic = (k) => X().ic(k), name = P.areaName(m.id), rows = (window.XENO_RECENT || []).filter((r) => r.m === m.id && r.kind).slice(0, 8);
    const attr = (r) => (r.kind === 'chat' ? 'data-recent-chat' : r.kind === 'project' ? 'data-recent-project' : 'data-recent-file') + '="' + esc(r.id) + '"';
    const kind = { chat: ['chat', 'Chat'], project: ['folder', 'Project'], file: ['lib', 'File'] };
    const body = rows.length
      ? rows.map((r) => `<button class="hm2-job" data-home-work="${r.kind}" ${attr(r)}><span class="sr-ic">${ic(kind[r.kind][0])}</span><span class="hm2-job-t"><b>${esc(r.t)}</b><small>${kind[r.kind][1]}${r.ago ? ' · ' + esc(r.ago) : ''}</small></span></button>`).join('')
      : `<div class="hm2-empty" data-home-work-empty><p>Nothing in ${esc(name)} yet. Chats, projects and files you make here show up on this page.</p><button class="us-ghost" data-newchat-home data-go="chat">${ic('plus')}Start a chat in ${esc(name)}</button></div>`;
    return `<section class="hm2-sec" data-home-work-sec><div class="hm2-h"><h2>Your work in ${esc(name)}</h2><span class="hm2-sub">newest first</span></div>${body}</section>`;
  }
  addEventListener('message', (e) => { if (e.origin !== location.origin) return; const m = e.data; if (m && m.source === 'xeno-chat' && m.type === 'changed') setTimeout(load, 900); });
  window.XENO_HOME_LIVE = { served: true, load, work, state: () => ({ status: H.status, areas: Object.keys(H.areas) }) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
