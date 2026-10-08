/* XENO_ACCOUNT — the account pages on the real platform API.
 * From disk this does nothing and Settings keeps its sample account. Served by the platform it:
 *   1. loads the real profile, sessions, sign-in methods, plan, credit balance and usage, and puts them where
 *      Settings reads them (xw.acct), replacing every sample value;
 *   2. sends profile edits, session sign-outs, sign-in method removal and preferences to the API (XENO_NET.remote);
 *   3. shows a plain "not available yet" for the parts the platform has no API for. Nothing is invented:
 *      no sample key, device, invoice or gift is ever shown as the signed-in person's.
 * Routes used: GET /api/account/overview · GET+DELETE /api/account/sessions · GET+DELETE /api/auth/linked-accounts
 *   · PUT /api/auth/profile · GET /api/billing/overview · POST /api/billing/portal · GET /api/dashboard/stats
 *   · GET+PATCH /api/user-data/settings (bio and preferences).
 * Missing on the platform (each section says so): email change, passkeys, authenticator, recovery codes, adding a
 *   sign-in method, authorised apps, personal API keys, provider keys, gifts, data export, delayed deletion, spend cap. */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_ACCOUNT = { served: false, section: () => null }; return; }
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = P.api;
  const readJson = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };
  const acctNow = () => readJson(localStorage.getItem('xw.acct'));
  const title = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const ms = (t) => { const n = t ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : Date.now(); };

  const S = { status: 'loading', parts: {}, usage: null, plan: null };
  const LOCAL = new Set(['general', 'appearance', 'notifications', 'modes', 'keyboard', 'region']);
  const NOT_YET = {
    apps: ['Apps you’re signed into', 'The list of apps and devices signed in with your XENO account isn’t available here yet.'],
    keys: ['API keys', 'Personal API keys can’t be created or listed here yet.'],
    providers: ['Provider keys & inference', 'Bringing your own provider key, and choosing where each product’s AI comes from, isn’t available here yet.'],
    gifts: ['Gifts', 'Sending credits to another person isn’t available here yet.'],
    data: ['Export your data', 'Requesting an export of everything you made isn’t available here yet.'],
    danger: ['Delete your account', 'Deleting your account from here isn’t available yet. Write to support and we will do it for you.'],
    workspace: ['Workspace', 'Workspace settings aren’t connected to your real workspaces yet.'],
    connections: ['Connections', 'Connecting outside services isn’t available here yet.'],
  };
  const UNAVAILABLE = new Set(['changeEmail', 'addPasskey', 'removePasskey', 'totpOn', 'totpOff', 'codes', 'addMethod']);
  const WHY = 'Not available on XENO yet';

  async function load() {
    if (S.status !== 'ready') { S.status = 'loading'; paint(); } // a refresh after a save keeps what is on screen
    const urls = ['/api/account/overview', '/api/account/sessions', '/api/auth/linked-accounts', '/api/billing/overview', '/api/dashboard/stats', '/api/user-data/settings'];
    const got = await Promise.all(urls.map((u) => api('GET', u).catch(() => ({ ok: false, status: 0, d: {} }))));
    const [ov, ses, link, bill, dash, set] = got;
    if (!ov.ok || !ov.d.overview) { S.status = 'error'; paint(); return false; }
    const u = ov.d.overview.user || {}, saved = (set.ok && set.d.settings && set.d.settings.workspace) || {};
    const a = acctNow();
    a.profile = { name: u.display_name || u.username || 'You', handle: u.username || '', email: u.email || '', verified: !!u.email_verified, bio: typeof saved.bio === 'string' ? saved.bio : '', photo: u.avatar_url || null };
    S.parts.sessions = ses.ok && Array.isArray(ses.d.sessions);
    a.sessions = S.parts.sessions ? ses.d.sessions.map((s) => ({ id: s.id, device: [s.browser, s.os].filter(Boolean).join(' on ') || title(s.device_type) || 'Unknown device', where: s.ip_address ? 'IP ' + s.ip_address : 'Location unknown', last: ms(s.last_active_at || s.created_at), current: !!s.current })) : [];
    S.parts.methods = link.ok && Array.isArray(link.d.accounts);
    a.methods = S.parts.methods ? link.d.accounts.map((m) => ({ id: m.provider, kind: title(m.provider), who: m.email || m.username || '', added: ms(m.linkedAt) })) : [];
    // nothing below has a platform API yet: clear whatever a sample or an earlier visit left behind
    Object.assign(a, { passkeys: [], totp: false, codes: null, codesLeft: 0, apps: [], apiKeys: [], providers: [], route: {}, gifts: [], invoices: [], cap: null, exportJob: null, deletion: null });
    const sub = bill.ok && bill.d.overview ? bill.d.overview.subscription : null;
    const credits = (bill.ok && bill.d.overview && bill.d.overview.credits) || ov.d.overview.credits || {};
    S.parts.plan = bill.ok;
    S.plan = sub ? { free: false, name: sub.plan_name || 'Plan', price: Number(sub.monthly_price) > 0 ? `€${sub.monthly_price} / month` : '', renews: sub.next_billing_date ? ms(sub.next_billing_date) : null, status: sub.status || '' } : { free: true, name: 'Free', price: '', renews: null, status: '' };
    a.balance = Number(credits.balance) || 0;
    a.plan = { name: S.plan.name, price: S.plan.price, renews: S.plan.renews || Date.now(), allowance: 0, payg: true, card: '' };
    S.usage = dash.ok && dash.d.stats ? { available: !!dash.d.stats.usage_available, rows: (dash.d.stats.usage_by_surface || []).map((r) => ({ name: String(r.surface || 'other'), credits: Number(r.credits) || 0 })) } : null;
    if (saved.region && typeof saved.region === 'object') a.region = { ...(a.region || {}), ...saved.region };
    if (saved.prefs && typeof saved.prefs === 'object') { try { localStorage.setItem('xw.prefs', JSON.stringify(saved.prefs)); window.XD?.applyPrefs?.(); } catch {} }
    try { localStorage.setItem('xw.acct', JSON.stringify(a)); } catch {}
    S.status = 'ready'; paint(); return true;
  }
  // the name on the home page and in the account menu comes from the same record, so any page may need a repaint
  function paint() { try { X()?.render?.(); } catch {} }

  // ---------- what Settings shows in place of its sample sections ----------
  const retry = '<button class="pg-btn" data-acct="retry"><span>Try again</span></button>';
  function section(id, a, h) {
    if (LOCAL.has(id)) return null;
    if (S.status === 'loading') return h.card('', '<p class="pg-dim set-p" role="status">Loading your account</p>');
    if (S.status === 'error') return h.card('We couldn’t load your account', '<p class="set-p">XENO didn’t answer. Nothing here was changed.</p>', retry);
    if (NOT_YET[id]) return h.card(esc(NOT_YET[id][0]), `<p class="pg-dim set-p">${esc(NOT_YET[id][1])}</p>`);
    if (id === 'sessions' && !S.parts.sessions) return h.card('Signed-in devices', '<p class="set-p">XENO couldn’t load your devices.</p>', retry);
    if (id === 'plan') {
      if (!S.parts.plan) return h.card('Plan', '<p class="set-p">XENO couldn’t load your plan.</p>', retry);
      const p = S.plan || { free: true, name: 'Free' };
      const sub = p.free ? 'You’re on the free plan' : p.renews ? `Renews ${h.when(p.renews)}` : esc(p.status);
      const act = p.free ? '<button class="pg-btn" data-acct="plans"><span>See plans</span></button>' : '<button class="pg-btn" data-acct="portal"><span>Manage billing</span></button>';
      return h.card('Plan', h.row(`${esc(p.name)}${p.price ? ' ' + h.tag(p.price) : ''}`, sub, act))
        + (p.free ? '' : h.card('Invoices and payment method', '<p class="pg-dim set-p">Your invoices, payment method and cancellation are in the billing portal.</p>', '<button class="pg-btn ghost" data-acct="portal"><span>Open billing portal</span></button>'));
    }
    if (id === 'usage') {
      const rows = S.usage && S.usage.available ? S.usage.rows.filter((r) => r.credits > 0).sort((x, y) => y.credits - x.credits) : null;
      const top = rows && rows.length ? rows[0].credits : 0;
      const by = rows === null ? '<p class="pg-dim set-p">Usage isn’t available right now.</p>'
        : rows.length ? rows.map((r) => h.row(esc(r.name), '', `<span class="set-meter" style="--v:${Math.round((r.credits / top) * 100)}%"><i></i></span><b>${r.credits.toLocaleString()}</b>`)).join('')
          : '<p class="pg-dim set-p">No usage in the last 30 days.</p>';
      return h.card('Credits', h.row('Balance', 'Credits pay for AI, rendering and hosted agents', `<b class="set-big">${(a.balance || 0).toLocaleString()}</b> <button class="pg-btn" data-acct="plans"><span>Buy credits</span></button>`))
        + h.card('By product, last 30 days', by)
        + h.card('Monthly limit', h.row('Spend cap', 'A limit on what you spend each month isn’t available here yet', ''));
    }
    return null;
  }

  // ---------- controls with no API behind them are shown unavailable, with the reason ----------
  function mark() { document.querySelectorAll('.pg--set [data-set]').forEach((el) => { if (UNAVAILABLE.has(el.dataset.set) && !el.classList.contains('role-off')) { el.setAttribute('aria-disabled', 'true'); el.classList.add('role-off'); el.title = WHY; } }); }
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-acct]'); if (!t) return; e.preventDefault();
    const act = t.dataset.acct;
    if (act === 'retry') return load();
    if (act === 'plans') return window.open('/pricing', '_blank', 'noopener');
    if (act === 'portal') {
      t.disabled = true;
      try { const r = await api('POST', '/api/billing/portal', {}); if (r.ok && r.d.url) window.open(r.d.url, '_blank', 'noopener'); else X()?.toast?.(r.status === 503 ? 'Billing isn’t open yet.' : 'The billing portal couldn’t be opened.'); }
      catch { X()?.toast?.('XENO could not be reached.'); }
      t.disabled = false;
    }
  });

  // ---------- saves ----------
  const fail = (r, fallback) => ({ ok: false, code: r.status === 403 ? 'forbidden' : 'invalid', msg: (r.d && typeof r.d.error === 'string' && r.d.error) || fallback, final: r.status >= 400 && r.status < 500 });
  const removed = (before, key) => { const was = (readJson(before['xw.acct'])[key] || []), now = new Set((acctNow()[key] || []).map((x) => x.id)); return was.filter((x) => !now.has(x.id)); };
  const settle = (res) => { setTimeout(load, 0); return res; }; // reading the account again is the proof the change landed
  async function endSessions(before) {
    for (const s of removed(before, 'sessions')) { if (s.current) continue; const r = await api('DELETE', '/api/account/sessions/' + encodeURIComponent(s.id)); if (!r.ok && r.status !== 404) return settle(fail(r, 'That device couldn’t be signed out.')); }
    return settle({ ok: true });
  }
  const savePrefs = async () => { const r = await api('PATCH', '/api/user-data/settings', { updates: [{ path: 'workspace.prefs', value: readJson(localStorage.getItem('xw.prefs')) }, { path: 'workspace.region', value: acctNow().region || {} }] }); return r.ok ? { ok: true } : fail(r, 'Your preferences couldn’t be saved.'); };
  window.XENO_NET.wire('settings');
  window.XENO_NET.remote({
    'settings.editProfile': async ({ before }) => {
      const was = readJson(before['xw.acct']).profile || {}, now = acctNow().profile || {}, body = {};
      if (now.name !== was.name) body.display_name = now.name;
      if (now.handle !== was.handle) body.username = now.handle;
      if (Object.keys(body).length) { const r = await api('PUT', '/api/auth/profile', body); if (!r.ok) return fail(r, 'Your profile couldn’t be saved.'); }
      if ((now.bio || '') !== (was.bio || '')) { const r = await api('PATCH', '/api/user-data/settings', { path: 'workspace.bio', value: String(now.bio || '').slice(0, 2000) }); if (!r.ok) return settle(fail(r, 'Your name was saved, but your bio couldn’t be.')); }
      return settle({ ok: true });
    },
    'settings.endSession': ({ before }) => endSessions(before),
    'settings.endOthers': ({ before }) => endSessions(before),
    'settings.removeMethod': async ({ before }) => {
      for (const m of removed(before, 'methods')) { const r = await api('DELETE', '/api/auth/linked-accounts/' + encodeURIComponent(m.id)); if (!r.ok) return settle(fail(r, 'That sign-in method couldn’t be removed.')); }
      return settle({ ok: true });
    },
    'settings.pref': savePrefs,
    'settings.region': savePrefs,
  });

  window.XENO_ACCOUNT = { served: true, section, load, state: () => ({ status: S.status, parts: { ...S.parts } }), unavailable: () => [...UNAVAILABLE], notYet: () => Object.keys(NOT_YET) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
