/* XENO_ACCOUNT — the account pages on the real platform API.
 * From disk this does nothing and Settings keeps its sample account. Served by the platform it:
 *   1. loads the real profile, sessions, sign-in methods, plan, credit balance and usage, and puts them where
 *      Settings reads them (xw.acct), replacing every sample value;
 *   2. sends profile edits, session sign-outs, sign-in method removal and preferences to the API (XENO_NET.remote);
 *   2b. asks the server to confirm it's you before a sensitive change (password, or a mailed code for an account
 *      with no password), changes the sign-in email, signs out everywhere, lists, makes and revokes API keys,
 *      and requests, downloads and removes a copy of the person's data. API keys belong to the XENO API portal
 *      (api.xenosystem.ai): the platform asks the portal to list and make them for the signed-in person, so a key
 *      made here is the same as one made there, in a project with that project's limits;
 *   3. shows a plain "not available yet" for the parts the platform has no API for. Nothing is invented:
 *      no sample key, device, invoice or gift is ever shown as the signed-in person's.
 * Routes used: GET /api/account/overview · GET+DELETE /api/account/sessions · GET+DELETE /api/auth/linked-accounts
 *   · PUT /api/auth/profile · GET /api/billing/overview · POST /api/billing/portal · GET /api/dashboard/stats
 *   · GET+PATCH /api/user-data/settings (bio and preferences) · GET /api/account/security · POST /api/account/confirm
 *   · POST /api/account/confirm/code · POST+DELETE /api/account/email · POST /api/account/email/confirm
 *   · DELETE /api/account/sessions · GET+POST /api/account/api-keys · DELETE /api/account/api-keys/:id
 *   · GET+POST /api/account/exports · GET /api/account/exports/:id/download · DELETE /api/account/exports/:id.
 * Missing on the platform (each section says so): passkeys, authenticator, recovery codes, adding a sign-in method,
 *   authorised apps, provider keys, gifts, deleting the account from here, spend cap. */
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

  const S = { status: 'loading', parts: {}, usage: null, plan: null, security: null, keys: null, exports: null };
  let poll = 0;
  const LOCAL = new Set(['general', 'appearance', 'notifications', 'modes', 'keyboard', 'region']);
  const NOT_YET = {
    apps: ['Apps you’re signed into', 'The list of apps and devices signed in with your XENO account isn’t available here yet.'],
    providers: ['Provider keys & inference', 'Bringing your own provider key, and choosing where each product’s AI comes from, isn’t available here yet.'],
    gifts: ['Gifts', 'Sending credits to another person isn’t available here yet.'],
    danger: ['Delete your account', 'Deleting your account from here isn’t available yet. Write to support and we will do it for you.'],
    workspace: ['Workspace', 'Workspace settings aren’t connected to your real workspaces yet.'],
    connections: ['Connections', 'Connecting outside services isn’t available here yet.'],
  };
  const UNAVAILABLE = new Set(['addPasskey', 'removePasskey', 'totpOn', 'totpOff', 'codes', 'addMethod']);
  const WHY = 'Not available on XENO yet';

  async function load() {
    if (S.status !== 'ready') { S.status = 'loading'; paint(); } // a refresh after a save keeps what is on screen
    const urls = ['/api/account/overview', '/api/account/sessions', '/api/auth/linked-accounts', '/api/billing/overview', '/api/dashboard/stats', '/api/user-data/settings', '/api/account/security', '/api/account/api-keys', '/api/account/exports'];
    const got = await Promise.all(urls.map((u) => api('GET', u).catch(() => ({ ok: false, status: 0, d: {} }))));
    const [ov, ses, link, bill, dash, set, sec, keys, exps] = got;
    S.security = sec.ok && sec.d.security ? sec.d.security : null;
    S.keys = keys.ok && Array.isArray(keys.d.keys) ? keys.d.keys : null;
    S.exports = exps.ok && Array.isArray(exps.d.exports) ? exps.d.exports : null;
    // a copy being built is checked again until it is ready; nothing is polled otherwise
    clearTimeout(poll); if (S.exports && S.exports.some((x) => x.status === 'building')) poll = setTimeout(load, 4000);
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
    if (id === 'keys') return keysSection(h);
    if (id === 'data') return dataSection(h);
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

  // ---------- API keys ----------
  const btn = (label, act, arg = '', cls = 'ghost') => `<button class="pg-btn ${cls}" data-acct="${act}" data-arg="${esc(arg)}"><span>${esc(label)}</span></button>`;
  // the API portal lives on the api. host of whichever XENO domain this page is on
  const portal = () => `https://api.${/(^|\.)xenostudio\.ai$/.test(location.hostname) ? 'xenostudio.ai' : 'xenosystem.ai'}/dashboard/keys`;
  function keysSection(h) {
    if (!S.keys) return h.card('API keys', '<p class="set-p">XENO couldn’t load your keys.</p>', retry);
    const line = (k) => `<code>${esc(k.preview)}</code> · ${k.project_name ? esc(k.project_name) + ' · ' : ''}${k.revoked ? 'revoked' : k.expired ? 'expired' : k.expires_at ? 'expires ' + h.when(ms(k.expires_at)) : 'never expires'} · ${k.last_used_at ? 'used ' + h.ago(ms(k.last_used_at)) : 'never used'}`;
    const live = S.keys.filter((k) => k.is_active), dead = S.keys.filter((k) => !k.is_active);
    const open = `${btn('New API key', 'newKey', '', '')} <a class="pg-btn ghost" href="${portal()}" target="_blank" rel="noopener"><span>Projects and limits</span></a>`;
    return h.card('API keys', (live.length ? live.map((k) => h.row(esc(k.name), line(k), btn('Revoke', 'revokeKey', k.id))).join('') : '<p class="pg-dim set-p">No keys. A key lets the XENO CLI, a script or an automated build act as you.</p>'), open)
      + (dead.length ? h.card('Revoked and expired', dead.map((k) => h.row(esc(k.name), line(k), '')).join('')) : '')
      + `<p class="pg-rule">${h.ic('lock')}A key is shown once, when you create it. Each key belongs to a project on the XENO API portal, which sets its limits; a key made here goes into your default project.</p>`;
  }
  // ---------- a copy of your data ----------
  const size = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
  function dataSection(h) {
    if (!S.exports) return h.card('Export your data', '<p class="set-p">XENO couldn’t load your exports.</p>', retry);
    const j = S.exports.find((x) => x.status === 'building') || S.exports.find((x) => x.status === 'ready') || (S.exports[0] && S.exports[0].status === 'failed' ? S.exports[0] : null);
    const what = 'Your profile, settings, projects, chats, files and credit history as one archive. We prepare it in the background.';
    let ctl = btn('Request a copy', 'export', '', ''), note = '';
    if (j && j.status === 'building') { ctl = '<span class="set-tag">Preparing…</span>'; note = `Requested ${h.ago(ms(j.requested_at))}. You can leave this page; it will be here when it is ready.`; }
    else if (j && j.status === 'ready') {
      ctl = `<a class="pg-btn" href="/api/account/exports/${encodeURIComponent(j.id)}/download" download><span>Download (${size(j.size_bytes)})</span></a> ${btn('Remove', 'removeExport', j.id)}`;
      const missed = (j.summary && ((j.summary.errors || []).length + (j.summary.skipped_files || []).length)) || 0;
      note = `Ready. It is kept until ${h.when(ms(j.expires_at))}, then removed.${missed ? ` ${missed} item${missed > 1 ? 's' : ''} could not be included; the archive’s manifest.json names them.` : ''}`;
    } else if (j && j.status === 'failed') note = 'The last copy couldn’t be built. Ask for a new one.';
    return h.card('Export your data', h.row('Everything you own on XENO', what, ctl) + (note ? h.row('', esc(note), j && j.status === 'ready' ? btn('Request a new copy', 'export') : '') : ''))
      + '<p class="pg-rule">What a workspace owns belongs to the workspace and is not in your copy. The archive lists the workspaces you belong to.</p>';
  }

  // ---------- confirm it's you ----------
  const say = (r, fallback) => (r.d && typeof r.d.error === 'string' && r.d.error) || fallback;
  async function confirm(why) {
    const st = await api('GET', '/api/account/security').catch(() => ({ ok: false, d: {} }));
    if (!st.ok || !st.d.security) { X()?.toast?.('XENO could not be reached. Nothing was changed.'); return false; }
    S.security = st.d.security;
    if (S.security.confirmation && S.security.confirmation.confirmed) return true;
    if (S.security.confirmation && S.security.confirmation.available === false) { X()?.toast?.('This needs a signed-in browser session.'); return false; }
    const byCode = (S.security.methods || []).includes('email_code');
    let sentTo = '';
    if (byCode) {
      const r = await api('POST', '/api/account/confirm/code', {});
      if (!r.ok && !(r.d && r.d.code === 'code_recently_sent')) { X()?.toast?.(say(r, 'The code could not be sent.')); return false; }
      sentTo = (r.d && r.d.sent_to) || 'your email address';
    }
    const v = await window.XD.form({ title: 'Confirm it’s you', sub: byCode ? `${why} We sent a 6-digit code to ${sentTo}.` : why, submit: 'Confirm', size: 'sm',
      fields: [byCode ? { id: 'code', label: 'Code', type: 'code', required: true, max: 6, placeholder: '6 digits', validate: (x) => (/^\d{6}$/.test(x) ? null : 'Enter the 6-digit code.') }
        : { id: 'password', label: 'Your password', type: 'password', required: true, max: 200 }],
      onSubmit: async (vals) => { const r = await api('POST', '/api/account/confirm', byCode ? { code: vals.code } : { password: vals.password }); return r.ok ? null : say(r, 'That didn’t work.') + (r.d && typeof r.d.remaining === 'number' && r.d.remaining > 0 ? ` ${r.d.remaining} tr${r.d.remaining === 1 ? 'y' : 'ies'} left.` : ''); } });
    return !!v;
  }

  // ---------- email ----------
  async function emailCode(address) {
    const v = await window.XD.form({ title: 'Enter the code', sub: `We sent a 6-digit code to ${address}. Your email changes when you enter it, and every other device is signed out.`, submit: 'Change email', size: 'sm',
      fields: [{ id: 'code', label: 'Code', type: 'code', required: true, max: 6, placeholder: '6 digits', validate: (x) => (/^\d{6}$/.test(x) ? null : 'Enter the 6-digit code.') }],
      onSubmit: async (vals) => { const r = await api('POST', '/api/account/email/confirm', { code: vals.code }); return r.ok ? null : say(r, 'That didn’t work.'); } });
    if (v) { X()?.toast?.(`Your email is now ${address}`); await load(); }
    return !!v;
  }
  async function changeEmail() {
    const st = await api('GET', '/api/account/security').catch(() => ({ ok: false, d: {} }));
    const pending = st.ok && st.d.security ? st.d.security.pending_email : null;
    if (pending) {
      if (await window.XD.confirm({ title: 'Finish changing your email?', body: `A code was sent to ${esc(pending.new_email)}. Enter it to finish, or cancel to start again with another address.`, action: 'Enter the code', danger: false })) return emailCode(pending.new_email);
      await api('DELETE', '/api/account/email');
    }
    if (!await confirm('Changing your email signs you out on every other device.')) return false;
    let sent = null;
    const v = await window.XD.form({ title: 'Change email', sub: 'We send a code to the new address. Nothing changes until you enter it.', submit: 'Send code', size: 'sm',
      fields: [{ id: 'e', label: 'New email', required: true, max: 254, validate: (x) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.trim()) ? null : 'Enter an email address.') }],
      onSubmit: async (vals) => { const r = await api('POST', '/api/account/email', { new_email: vals.e }); if (!r.ok) return say(r, 'That address couldn’t be used.'); sent = r.d.pending_email.new_email; return null; } });
    if (!v || !sent) return false;
    return emailCode(sent);
  }

  // ---------- keys and exports: actions ----------
  async function newKey() {
    if (!await confirm('An API key can act as you.')) return;
    let made = null;
    const v = await window.XD.form({ title: 'New API key', sub: 'It goes into your default project on the XENO API portal.', submit: 'Create key', size: 'sm', fields: [{ id: 'name', label: 'Name', required: true, max: 100, placeholder: 'e.g. Laptop CLI' }],
      onSubmit: async (vals) => { const r = await api('POST', '/api/account/api-keys', { name: vals.name }); if (!r.ok) return say(r, 'The key couldn’t be created.'); made = r.d; return null; } });
    if (!v || !made) return;
    await load();
    const secret = made.secret; made = null;   // kept only for this dialog
    window.XD.info({ title: 'Copy your new key', sub: 'This is the only time it’s shown.', html: `<div class="set-secret"><code data-secret>${esc(secret)}</code></div><p class="xd-note">Store it in your password manager or your build’s secrets. If you lose it, revoke it and make a new one.</p>`, actions: [{ label: 'Copy key', close: false, run: () => window.XCM.H.copy(secret, 'Key copied') }] });
  }
  let job = null;
  const take = () => { const v = job; job = null; return v; };
  const run = (op, payload, label) => { job = payload; return window.XENO_NET.run({ op, label }); };
  async function revokeKey(id) {
    const k = (S.keys || []).find((x) => x.id === id); if (!k) return;
    if (!await window.XD.confirm({ title: `Revoke “${esc(k.name)}”?`, body: 'Anything using it stops working immediately. This can’t be undone.', action: 'Revoke key' })) return;
    if (await run('settings.revokeKey', id, 'Revoking the key')) X()?.toast?.(`Revoked ${k.name}`);
  }
  async function requestExport() {
    if (!await confirm('The copy holds everything in your account.')) return;
    if (await run('settings.export', {}, 'Requesting your copy')) X()?.toast?.('We’re preparing your copy. It will be here when it is ready.');
  }
  async function removeExport(id) {
    if (!await window.XD.confirm({ title: 'Remove this copy?', body: 'The archive is deleted from XENO now. You can ask for a new one.', action: 'Remove copy' })) return;
    if (await run('settings.removeExport', id, 'Removing the copy')) X()?.toast?.('Copy removed');
  }

  // ---------- controls with no API behind them are shown unavailable, with the reason ----------
  function mark() { document.querySelectorAll('.pg--set [data-set]').forEach((el) => { if (UNAVAILABLE.has(el.dataset.set) && !el.classList.contains('role-off')) { el.setAttribute('aria-disabled', 'true'); el.classList.add('role-off'); el.title = WHY; } }); }
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-acct]'); if (!t) return; e.preventDefault();   // download links carry no data-acct, so they stay links
    const act = t.dataset.acct;
    if (act === 'retry') return load();
    if (act === 'plans') return window.open('/pricing', '_blank', 'noopener');
    if (act === 'newKey') return newKey();
    if (act === 'revokeKey') return revokeKey(t.dataset.arg);
    if (act === 'export') return requestExport();
    if (act === 'removeExport') return removeExport(t.dataset.arg);
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
    // one call: every other browser session AND every app's refresh token. The per-device route cannot reach the apps.
    'settings.endOthers': async () => { const r = await api('DELETE', '/api/account/sessions'); return settle(r.ok ? { ok: true } : fail(r, 'The other devices couldn’t be signed out.')); },
    'settings.revokeKey': async () => { const r = await api('DELETE', '/api/account/api-keys/' + encodeURIComponent(take())); return settle(r.ok ? { ok: true } : fail(r, 'The key couldn’t be revoked.')); },
    'settings.export': async () => { take(); const r = await api('POST', '/api/account/exports', {}); if (!r.ok) return settle(fail(r, 'The copy couldn’t be requested.')); await load(); return { ok: true }; },
    'settings.removeExport': async () => { const r = await api('DELETE', '/api/account/exports/' + encodeURIComponent(take())); if (!r.ok) return settle(fail(r, 'The copy couldn’t be removed.')); await load(); return { ok: true }; },
    'settings.removeMethod': async ({ before }) => {
      for (const m of removed(before, 'methods')) { const r = await api('DELETE', '/api/auth/linked-accounts/' + encodeURIComponent(m.id)); if (!r.ok) return settle(fail(r, 'That sign-in method couldn’t be removed.')); }
      return settle({ ok: true });
    },
    'settings.pref': savePrefs,
    'settings.region': savePrefs,
  });

  window.XENO_ACCOUNT = { served: true, section, load, confirm, changeEmail, state: () => ({ status: S.status, parts: { ...S.parts } }), unavailable: () => [...UNAVAILABLE], notYet: () => Object.keys(NOT_YET) };
  Promise.resolve(P.ready).then((user) => { if (user) load(); });
})();
