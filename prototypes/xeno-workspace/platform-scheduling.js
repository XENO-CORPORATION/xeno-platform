/* platform-scheduling.js — on the platform, Corpo › Scheduling is real: booking pages, availability, bookings.
 *
 * Reads /api/scheduling (routes/schedulingRoutes.js → services/scheduling.js) for the workspace you are in:
 *   pages         GET /pages · POST /pages {slug, title, durationMinutes, bufferMinutes} · DELETE /pages/:id (undo /restore)
 *   availability  GET|PUT /availability {timezone, weekly} · POST /time-off · DELETE /time-off/:id
 *   bookings      GET /bookings · POST /bookings/:id/cancel
 *   calendar      GET /events.ics (export) · POST /feed (a private feed URL, shown once)
 *
 * The public booking page a guest opens is served by the server (/api/scheduling/book/<slug>), not by this file.
 * It registers XENO_ZONE_LIVE['corpo.scheduling'], which is what tells the workspace this area is no longer a sample.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const said = (r, fallback) => (r && r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']];
  const S = { status: 'idle', ws: undefined, tab: 'pages', pages: [], avail: null, bookings: [], error: null, making: false, undo: null, feed: null };
  const wsId = () => (window.XENO_SCOPE && window.XENO_SCOPE.served ? window.XENO_SCOPE.uuid() : null);
  const q = () => (S.ws ? '?workspace=' + encodeURIComponent(S.ws) : '');
  const withWs = (b) => ({ ...(b || {}), ...(S.ws ? { workspace: S.ws } : {}) });
  const paint = () => { try { X()?.renderRail?.(); X()?.refreshPanel?.(); const s = X()?.S; if (s && s.view === 'zone' && s.zone === 'scheduling') X().render(); } catch {} };
  const fmt = (iso) => { const d = new Date(iso); return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  async function load() {
    S.ws = wsId(); S.status = 'loading'; S.error = null;
    const [p, a, b] = await Promise.all(['/pages', '/availability', '/bookings'].map((x) => api('GET', '/api/scheduling' + x + q()).catch(() => null)));
    if (!p || !p.ok) { S.status = 'error'; S.error = said(p, 'Scheduling could not be reached.'); return paint(); }
    S.pages = p.d.pages || []; S.avail = a && a.ok ? a.d : null; S.bookings = (b && b.ok && b.d.bookings) || [];
    S.status = 'ready'; paint();
  }

  window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  window.XENO_ZONE_LIVE['corpo.scheduling'] = {
    served: true,
    work: () => (S.status === 'ready' ? ['Upcoming', S.bookings.filter((x) => x.status === 'confirmed').slice(0, 6).map((x) => [`${x.pageTitle} · ${x.guestName}`, fmt(x.startsAt), null, 'Scheduling'])] : null),
    badge: () => null,
    page: () => page(),
    state: () => ({ status: S.status, pages: S.pages.length, bookings: S.bookings.length, tab: S.tab }),
    reload: () => load(),
  };

  const btn = (attrs, label, cls = 'btn ghost') => `<button class="${cls}" ${attrs}>${esc(label)}</button>`;
  function pagesTab() {
    const maker = S.making ? `<div class="sc-make" data-sc-make>
        <input class="in" data-sc-title placeholder="Title, e.g. Intro call" aria-label="Title" maxlength="200">
        <input class="in" data-sc-slug placeholder="link-name" aria-label="Link name" maxlength="63">
        <label>Length <select class="in" data-sc-dur aria-label="Length">${[15, 30, 45, 60, 90].map((m) => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label>Buffer <select class="in" data-sc-buf aria-label="Buffer">${[0, 5, 10, 15, 30].map((m) => `<option value="${m}">${m} min</option>`).join('')}</select></label>
        <div>${btn('data-sc-save', 'Create booking page', 'btn')} ${btn('data-sc-cancel', 'Cancel')}</div></div>` : btn('data-sc-new', 'New booking page', 'btn');
    const list = S.pages.length ? S.pages.map((p) => `<div class="sc-row" data-sc-pg="${esc(p.id)}"><div><b>${esc(p.title)}</b><small>${esc(p.durationMinutes)} min${p.bufferMinutes ? ` · ${esc(p.bufferMinutes)} min buffer` : ''}${p.active ? '' : ' · closed'}</small>
      <a class="sc-link" href="${esc(p.url)}" target="_blank" rel="noopener" data-sc-url>${esc(p.url)}</a></div><div>${btn(`data-sc-copy="${esc(p.url)}"`, 'Copy link')} ${btn(`data-sc-del="${esc(p.id)}"`, 'Delete')}</div></div>`).join('')
      : '<div class="pj-empty">No booking pages yet. Make one and share its link: guests pick a free time and it lands on your calendar.</div>';
    return `<div class="sc-actions">${maker}</div>${list}`;
  }
  function availTab() {
    const a = S.avail || { timezone: 'UTC', weekly: {}, timeOff: [] };
    const rows = DAYS.map(([k, n]) => { const iv = (a.weekly[k] || [])[0]; return `<div class="sc-day"><label><input type="checkbox" data-sc-on="${k}" ${iv ? 'checked' : ''}> ${n}</label>
      <input class="in" type="time" data-sc-from="${k}" value="${esc(iv ? iv[0] : '09:00')}" aria-label="${n} from"> – <input class="in" type="time" data-sc-to="${k}" value="${esc(iv ? (iv[1] === '24:00' ? '23:59' : iv[1]) : '17:00')}" aria-label="${n} to"></div>`; }).join('');
    const off = (a.timeOff || []).map((t) => `<div class="sc-row" data-sc-off="${esc(t.id)}"><div>${esc(fmt(t.startsAt))} → ${esc(fmt(t.endsAt))}<small>${esc(t.reason)}</small></div>${btn(`data-sc-offdel="${esc(t.id)}"`, 'Remove')}</div>`).join('');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return `<div class="sc-card"><b>Weekly hours</b><label>Time zone <input class="in" data-sc-tz value="${esc(a.saved ? a.timezone : tz)}" aria-label="Time zone"></label>${rows}
      <div>${btn('data-sc-savehours', 'Save hours', 'btn')}</div></div>
      <div class="sc-card"><b>Time off</b>${off || '<small>None planned.</small>'}
      <div class="sc-day"><input class="in" type="datetime-local" data-sc-offfrom aria-label="Time off from"> → <input class="in" type="datetime-local" data-sc-offto aria-label="Time off to">
      <input class="in" data-sc-offwhy placeholder="Reason (only you see it)" aria-label="Reason" maxlength="200"> ${btn('data-sc-addoff', 'Add')}</div></div>`;
  }
  function bookingsTab() {
    const up = S.bookings.filter((x) => x.status === 'confirmed');
    const list = up.length ? up.map((x) => `<div class="sc-row" data-sc-bk="${esc(x.id)}"><div><b>${esc(fmt(x.startsAt))}</b> · ${esc(x.pageTitle)}<small>${esc(x.guestName)} · ${esc(x.guestEmail)}${x.note ? ' · ' + esc(x.note) : ''}</small></div>${btn(`data-sc-bkcancel="${esc(x.id)}"`, 'Cancel booking')}</div>`).join('')
      : '<div class="pj-empty">No upcoming bookings.</div>';
    const feed = S.feed ? `<div class="sc-card" data-sc-feedurl>Subscribe in your calendar app (shown once): <code>${esc(S.feed)}</code></div>` : '';
    return `<div class="sc-actions"><a class="btn ghost" href="/api/scheduling/events.ics${q()}" data-sc-export>Export .ics</a> ${btn('data-sc-feed', S.feed ? 'New feed link' : 'Calendar feed link')}</div>${feed}${list}`;
  }
  function page() {
    const head = `<div class="pj-head"><div><small>Corpo</small><h1>Scheduling</h1></div></div><p class="hm-blurb">Booking pages people use to book time with you, your working hours, and what is booked.</p>`;
    const wrap = (body) => `<div class="wrap pj hm" data-sc-page="${esc(S.status)}">${head}${body}</div>`;
    if (S.status === 'idle' || S.status === 'loading' || S.ws !== wsId()) { if (S.status !== 'loading') load(); return wrap('<div class="pj-empty">Loading…</div>'); }
    if (S.status === 'error') return wrap(`<div class="pj-empty" data-sc-error>${esc(S.error)} ${btn('data-sc-reload', 'Try again')}</div>`);
    const tabs = [['pages', 'Booking pages'], ['availability', 'Availability'], ['bookings', 'Bookings']].map(([id, n]) => `<button class="btn ${S.tab === id ? '' : 'ghost'}" data-sc-tab="${id}" aria-pressed="${S.tab === id}">${n}</button>`).join(' ');
    const undo = S.undo ? `<div class="sc-undo" data-sc-undone>“${esc(S.undo.title)}” was deleted. ${btn(`data-sc-undo="${esc(S.undo.id)}"`, 'Undo')}</div>` : '';
    const body = S.tab === 'availability' ? availTab() : S.tab === 'bookings' ? bookingsTab() : pagesTab();
    return wrap(`${undo}<div class="sc-tabs">${tabs}</div>${body}`);
  }

  const localIso = (v) => (v ? new Date(v).toISOString() : '');
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sc-reload],[data-sc-tab],[data-sc-new],[data-sc-cancel],[data-sc-save],[data-sc-del],[data-sc-undo],[data-sc-copy],[data-sc-savehours],[data-sc-addoff],[data-sc-offdel],[data-sc-bkcancel],[data-sc-feed]');
    if (!t || !t.closest('[data-sc-page]')) return;
    e.preventDefault(); e.stopPropagation();
    const root = t.closest('[data-sc-page]'), d = t.dataset, val = (sel) => (root.querySelector(sel) || {}).value || '';
    if ('scReload' in d) return load();
    if (d.scTab) { S.tab = d.scTab; return paint(); }
    if ('scNew' in d) { S.making = true; return paint(); }
    if ('scCancel' in d) { S.making = false; return paint(); }
    if ('scSave' in d) {
      const title = val('[data-sc-title]').trim(), slug = val('[data-sc-slug]').trim().toLowerCase();
      if (!title) return toast('Give the page a title');
      const r = await api('POST', '/api/scheduling/pages', withWs({ title, slug, durationMinutes: Number(val('[data-sc-dur]') || 30), bufferMinutes: Number(val('[data-sc-buf]') || 0) })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not save.'));
      S.making = false; toast('Booking page created'); return load();
    }
    if (d.scCopy) { try { await navigator.clipboard.writeText(d.scCopy); toast('Link copied'); } catch { toast(d.scCopy); } return; }
    if (d.scDel) {
      const r = await api('DELETE', `/api/scheduling/pages/${encodeURIComponent(d.scDel)}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That did not delete.'));
      const was = S.pages.find((x) => x.id === d.scDel); S.undo = { id: d.scDel, title: was ? was.title : 'Page' }; toast('Booking page deleted'); return load();
    }
    if (d.scUndo) {
      const r = await api('POST', `/api/scheduling/pages/${encodeURIComponent(d.scUndo)}/restore`, withWs({})).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Could not restore it'));
      S.undo = null; toast('Booking page restored'); return load();
    }
    if ('scSavehours' in d) {
      const weekly = {};
      for (const [k] of DAYS) if (root.querySelector(`[data-sc-on="${k}"]`)?.checked) weekly[k] = [[val(`[data-sc-from="${k}"]`), val(`[data-sc-to="${k}"]`)]];
      const r = await api('PUT', '/api/scheduling/availability', withWs({ timezone: val('[data-sc-tz]').trim() || 'UTC', weekly })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Those hours did not save.'));
      S.avail = r.d; toast('Hours saved'); return paint();
    }
    if ('scAddoff' in d) {
      const r = await api('POST', '/api/scheduling/time-off', withWs({ startsAt: localIso(val('[data-sc-offfrom]')), endsAt: localIso(val('[data-sc-offto]')), reason: val('[data-sc-offwhy]') })).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'That time off did not save.'));
      toast('Time off added'); return load();
    }
    if (d.scOffdel) {
      const r = await api('DELETE', `/api/scheduling/time-off/${encodeURIComponent(d.scOffdel)}` + q()).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Could not remove it')); return load();
    }
    if (d.scBkcancel) {
      const r = await api('POST', `/api/scheduling/bookings/${encodeURIComponent(d.scBkcancel)}/cancel`, withWs({})).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Could not cancel it'));
      toast('Booking cancelled — the guest is told'); return load();
    }
    if ('scFeed' in d) {
      const r = await api('POST', '/api/scheduling/feed', withWs({})).catch(() => null);
      if (!r || !r.ok) return toast(said(r, 'Could not make a feed link'));
      S.feed = r.d.url; return paint();
    }
  }, true);

  P.ready.then((u) => { if (u) load(); });
})();
