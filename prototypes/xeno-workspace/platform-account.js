/* XENO_ACCOUNT — the account pages on the real platform API.
 * From disk this does nothing and Settings keeps its sample account. Served by the platform it:
 *   1. loads the real profile, sessions, sign-in methods, plan, credit balance and usage, and puts them where
 *      Settings reads them (xw.acct), replacing every sample value;
 *   2. sends profile edits, session sign-outs, sign-in method removal and preferences to the API (XENO_NET.remote);
 *   2b. asks the server to confirm it's you before a sensitive change (password, or a mailed code for an account
 *      with no password), changes the sign-in email, signs out everywhere, and requests, downloads and removes a
 *      copy of the person's data. API keys are NOT managed here. They live on the XENO API portal
 *      (api.xenosystem.ai) with projects, limits and usage, the way OpenAI keeps keys on its developer platform and
 *      Anthropic in its Console, apart from the consumer app. This page has one row that opens the portal;
 *   3. reads and changes the apps signed in with this account, the person's provider keys and where each product's AI
 *      comes from, their monthly limit, and shows their connected services and gifts. Each loads when its section opens;
 *   4. shows a plain "not available yet" for the parts the platform has no API for. Nothing is invented:
 *      no sample key, device, invoice or gift is ever shown as the signed-in person's.
 * Routes used: GET /api/account/overview · GET+DELETE /api/account/sessions · GET+DELETE /api/auth/linked-accounts
 *   · PUT /api/auth/profile · GET /api/billing/overview · POST /api/billing/portal · GET /api/dashboard/stats
 *   · GET+PATCH /api/user-data/settings (bio and preferences) · GET /api/account/security · POST /api/account/confirm
 *   · POST /api/account/confirm/code · POST+DELETE /api/account/email · POST /api/account/email/confirm
 *   · DELETE /api/account/sessions
 *   · GET+POST /api/account/exports · GET /api/account/exports/:id/download · DELETE /api/account/exports/:id
 *   · GET+DELETE /api/account/apps · /api/v2/inference/{providers,credentials,products,routes} · GET+PUT+DELETE /api/v2/ledger/caps
 *   · /api/storage/connect/workspaces/:id/connections · /api/mcp/connections · POST /api/places/ops/funding.{get,gift}.
 *   · /api/account/two-step (authenticator, passkeys, recovery codes) · POST /api/account/confirm/passkey/options
 *   · /api/auth/<provider>?link=1 (connecting Google, GitHub or X to this account). */
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

  const S = { status: 'loading', full: false, parts: {}, usage: null, plan: null, security: null, exports: null, browsers: null };
  let poll = 0;
  const LOCAL = new Set(['general', 'appearance', 'notifications', 'modes', 'keyboard', 'region', 'workspace']);
  const UNAVAILABLE = new Set();
  const WHY = 'Not available on XENO yet';

  // A page load needs only the name and the saved preferences (the home page and the account menu show them). The rest
  // (devices, sign-in methods, plan, usage, security, copies, browsers) is Settings only, and is asked for the first
  // time Settings shows an account section — it was seven reads on every load (2026-10-24).
  let full = false;
  async function load() {
    if (S.status !== 'ready') { S.status = 'loading'; paint(); } // a refresh after a save keeps what is on screen
    const all = full, none = { ok: false, status: 0, d: {} };
    const urls = all ? ['/api/account/overview', '/api/account/sessions', '/api/auth/linked-accounts', '/api/billing/overview', '/api/dashboard/stats', '/api/user-data/settings', '/api/account/security', '/api/account/exports', '/api/account/browsers', '/api/account/two-step', '/api/account/corpus-pcs'] : ['/api/account/overview', '/api/user-data/settings'];
    const got = await Promise.all(urls.map((u) => api('GET', u).catch(() => none)));
    const [ov, ses, link, bill, dash, set, sec, exps, brs, two, pcs] = all ? got : [got[0], none, none, none, none, got[1], none, none, none, none, none];
    S.browsers = brs.ok && Array.isArray(brs.d.browsers) ? brs.d.browsers : null;
    S.pcs = pcs.ok && Array.isArray(pcs.d.pcs) ? pcs.d.pcs : null;
    S.security = sec.ok && sec.d.security ? sec.d.security : null;
    S.exports = exps.ok && Array.isArray(exps.d.exports) ? exps.d.exports : null;
    // a copy being built is checked again until it is ready; nothing is polled otherwise
    clearTimeout(poll); if (S.exports && S.exports.some((x) => x.status === 'building')) poll = setTimeout(load, 4000);
    if (!ov.ok || !ov.d.overview) { S.status = 'error'; paint(); return false; }
    const u = ov.d.overview.user || {}, saved = (set.ok && set.d.settings && set.d.settings.workspace) || {};
    const a = acctNow();
    a.profile = { name: u.display_name || u.username || 'You', handle: u.username || '', email: u.email || '', verified: !!u.email_verified, bio: typeof saved.bio === 'string' ? saved.bio : '', photo: u.avatar_url || null };
    if (saved.region && typeof saved.region === 'object') a.region = { ...(a.region || {}), ...saved.region };
    if (saved.prefs && typeof saved.prefs === 'object') { try { localStorage.setItem('xw.prefs', JSON.stringify(saved.prefs)); window.XD?.applyPrefs?.(); } catch {} }
    if (!all) { try { localStorage.setItem('xw.acct', JSON.stringify(a)); } catch {} S.status = 'ready'; paint(); return true; }
    S.full = true;
    S.parts.sessions = ses.ok && Array.isArray(ses.d.sessions);
    a.sessions = S.parts.sessions ? ses.d.sessions.map((s) => ({ id: s.id, device: [s.browser, s.os].filter(Boolean).join(' on ') || title(s.device_type) || 'Unknown device', where: s.ip_address ? 'IP ' + s.ip_address : 'Location unknown', last: ms(s.last_active_at || s.created_at), current: !!s.current })) : [];
    S.parts.methods = link.ok && Array.isArray(link.d.accounts);
    a.methods = S.parts.methods ? link.d.accounts.map((m) => ({ id: m.provider, kind: m.provider === 'twitter' ? 'X' : m.provider === 'github' ? 'GitHub' : title(m.provider), who: m.email || m.username || '', added: ms(m.linkedAt) })) : [];
    // what lives in its own section is read there: clear whatever a sample or an earlier visit left behind
    Object.assign(a, { apps: [], apiKeys: [], providers: [], route: {}, gifts: [], invoices: [], cap: null, exportJob: null });
    const ts = two.ok && two.d.twoStep ? two.d.twoStep : { totp: false, passkeys: [], recoveryLeft: 0, recoveryTotal: 0 };
    S.twoStepKnown = two.ok;
    Object.assign(a, { totp: ts.totp, passkeys: ts.passkeys.map((k) => ({ id: k.id, name: k.name, added: ms(k.addedAt), used: k.lastUsedAt ? ms(k.lastUsedAt) : null })), codes: ts.recoveryTotal > 0 ? true : null, codesLeft: ts.recoveryLeft });
    const del = await api('GET', '/api/account/deletion').catch(() => null);
    a.deletion = del && del.ok && del.d.deletion ? { at: ms(del.d.deletion.requestedAt) } : null;
    const sub = bill.ok && bill.d.overview ? bill.d.overview.subscription : null;
    const credits = (bill.ok && bill.d.overview && bill.d.overview.credits) || ov.d.overview.credits || {};
    S.parts.plan = bill.ok;
    S.plan = sub ? { free: false, name: sub.plan_name || 'Plan', price: Number(sub.monthly_price) > 0 ? `€${sub.monthly_price} / month` : '', renews: sub.next_billing_date ? ms(sub.next_billing_date) : null, status: sub.status || '' } : { free: true, name: 'Free', price: '', renews: null, status: '' };
    a.balance = Number(credits.balance) || 0;
    a.plan = { name: S.plan.name, price: S.plan.price, renews: S.plan.renews || Date.now(), allowance: 0, payg: true, card: '' };
    S.usage = dash.ok && dash.d.stats ? { available: !!dash.d.stats.usage_available, rows: (dash.d.stats.usage_by_surface || []).map((r) => ({ name: String(r.surface || 'other'), credits: Number(r.credits) || 0 })) } : null;
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
    if (id === 'keys') return keysSection(h);
    if (id === 'apps') return appsSection(h);
    if (id === 'providers') return providersSection(h);
    if (id === 'connections') return connectionsSection(h);
    if (id === 'gifts') return giftsSection(h);
    if (!S.full) { if (!full) { full = true; setTimeout(load, 0); } return h.card('', '<p class="pg-dim set-p" role="status">Loading your account</p>'); }
    if (id === 'browsers') return browsersSection(h);
    if (id === 'pcs') return pcsSection(h);
    if (id === 'data') return dataSection(h);
    if (id === 'security' && !S.twoStepKnown) return h.card('Sign-in & security', '<p class="set-p">XENO couldn’t load your sign-in settings. Nothing was changed.</p>', retry);
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
        + capCard(h);
    }
    return null;
  }

  // ---------- API keys ----------
  const btn = (label, act, arg = '', cls = 'ghost') => `<button class="pg-btn ${cls}" data-acct="${act}" data-arg="${esc(arg)}"><span>${esc(label)}</span></button>`;
  // the API portal lives on the api. host of whichever XENO domain this page is on
  const portal = () => `https://api.${/(^|\.)xenostudio\.ai$/.test(location.hostname) ? 'xenostudio.ai' : 'xenosystem.ai'}/dashboard/keys`;
  function keysSection(h) {
    const open = `<a class="pg-btn" href="${portal()}" target="_blank" rel="noopener"><span>Open the API portal</span></a>`;
    return h.card('API keys', h.row('Your keys live on the XENO API portal', 'Create, view and revoke keys there, next to your projects, limits and usage. You sign in with this same account.', open));
  }
  // ---------- what loads when its section opens ----------
  const L = {};
  function lazy(key, read) {
    if (L[key]) return L[key];
    const e = L[key] = { status: 'loading', d: null };
    read().then((d) => { e.status = 'ready'; e.d = d; paint(); }, () => { e.status = 'error'; paint(); });
    return e;
  }
  const again = (key) => { delete L[key]; paint(); };
  const loadingCard = (h) => h.card('', '<p class="pg-dim set-p" role="status">Loading</p>');
  const failedCard = (h, title, key) => h.card(esc(title), '<p class="set-p">XENO couldn’t load this. Nothing was changed.</p>', btn('Try again', 'reload', key, ''));
  const words = (r, fallback) => (r.d && r.d.error && (r.d.error.message || (typeof r.d.error === 'string' && r.d.error))) || fallback;
  const none = { ok: false, status: 0, d: {} };
  const need = (r) => { if (!r.ok) throw new Error('unavailable'); return r.d; };
  const creditsOf = (micro) => Math.floor(Number(micro) / 1e6);

  // ---------- apps signed in with this account ----------
  function appsSection(h) {
    const e = lazy('apps', async () => need(await api('GET', '/api/account/apps')).apps || []);
    const pointers = h.card('Sign-in methods', '<p class="pg-dim set-p">Google and GitHub sign-in are managed in <a data-set="go" data-arg="security">Sign-in & security</a>.</p>')
      + h.card('Connections', '<p class="pg-dim set-p">Services your workspace connects to live in <a data-set="go" data-arg="connections">Connections</a>.</p>');
    if (e.status === 'loading') return loadingCard(h);
    if (e.status === 'error') return failedCard(h, 'Apps you’re signed into', 'apps') + pointers;
    const rows = e.d.map((x) => {
      const can = x.can.length ? `Can ${esc(x.can.join(', '))}` : 'Knows it’s you';
      const where = x.sessions > 1 ? `${x.sessions} sign-ins` : '';
      return h.row(`${esc(x.name)}${x.firstParty ? '' : ' ' + h.tag('Not made by XENO')}`, [can, where, `signed in ${h.ago(ms(x.lastUsedAt))}`].filter(Boolean).join(' · '), btn('Remove access', 'removeApp', x.clientId));
    }).join('');
    return h.card('Apps you’re signed into', rows || '<p class="pg-dim set-p">No apps are signed in with your account.</p>') + pointers;
  }
  async function removeApp(clientId) {
    const x = (L.apps?.d || []).find((y) => y.clientId === clientId); if (!x) return;
    if (!await window.XD.confirm({ title: `Remove ${esc(x.name)}’s access?`, body: 'It’s signed out everywhere and has to ask again before it can use your account. It can keep what it already saved on your device.', action: 'Remove access' })) return;
    const r = await api('DELETE', '/api/account/apps/' + encodeURIComponent(clientId)).catch(() => none);
    X()?.toast?.(r.ok ? `${x.name} no longer has access` : r.status === 404 ? `${x.name} no longer has access` : words(r, 'That app couldn’t be removed.'));
    again('apps');
  }

  // ---------- provider keys, and where each product's AI comes from ----------
  const PROVIDERS = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', openrouter: 'OpenRouter', 'azure-openai': 'Azure OpenAI', compatible: 'OpenAI-compatible' };
  const ENDPOINT = new Set(['azure-openai', 'compatible']), LISTED = new Set(['azure-openai', 'compatible', 'openrouter']);
  const providerName = (p) => PROVIDERS[p] || title(p);
  function providersSection(h) {
    const e = lazy('providers', async () => {
      const [p, c, pr, rt] = await Promise.all(['providers', 'credentials', 'products', 'routes'].map((x) => api('GET', '/api/v2/inference/' + x)));
      return { enabled: !!need(p).enabled, providers: p.d.providers || [], keys: need(c).credentials || [], products: need(pr).products || [], routes: need(rt).routes || [] };
    });
    if (e.status === 'loading') return loadingCard(h);
    if (e.status === 'error') return failedCard(h, 'Your provider keys', 'providers');
    if (!e.d.enabled) return h.card('Your provider keys', '<p class="pg-dim set-p">Provider keys aren’t turned on for your account yet. Your products use XENO credits.</p>');
    const keys = e.d.keys.filter((k) => k.status !== 'deleted');
    const rows = keys.map((k) => {
      const used = k.routed_surfaces ? ` · used by ${k.routed_surfaces} product${k.routed_surfaces === 1 ? '' : 's'}` : '';
      const sub = `${esc(providerName(k.provider))} · ending ${esc(k.key_last4 || '')} · added ${h.when(ms(k.created_at))}${used}${LISTED.has(k.provider) && !(k.models || []).length ? ' · no models chosen, so it serves nothing yet' : ''}`;
      return h.row(`${esc(k.label || providerName(k.provider))}${k.status === 'active' ? '' : ' ' + h.tag(title(k.status))}`, sub, `${btn('Models', 'keyModels', k.id)} ${btn('Remove', 'removeKey', k.id)}`);
    }).join('');
    const usable = keys.filter((k) => k.status === 'active');
    const choice = (cur, inherit) => `${inherit ? `<option value="inherit"${cur === 'inherit' ? ' selected' : ''}>Same as your default</option>` : ''}<option value="premium"${cur === 'premium' ? ' selected' : ''}>XENO credits</option>${usable.map((k) => `<option value="byok:${esc(k.id)}"${cur === 'byok:' + k.id ? ' selected' : ''}>Your key: ${esc(k.label || providerName(k.provider))}</option>`).join('')}<option value="inhouse" disabled${cur === 'inhouse' ? ' selected' : ''}>In-house: runs through XENO Hub for now</option>`;
    const cur = (path, cred) => (path === 'byok' && cred ? 'byok:' + cred : path || 'inherit');
    const def = e.d.routes.find((r) => r.surface === '*');
    const pick = (surface, value, inherit, label) => `<select class="set-sel" aria-label="${esc(label)}" data-acct-route="${esc(surface)}">${choice(value, inherit)}</select>`;
    const products = e.d.products.map((p) => h.row(esc(p.name), p.last_signed_in ? `Last signed in ${h.ago(ms(p.last_signed_in))}` : 'Never signed in', pick(p.client_id, cur(p.path, p.credential_id), true, p.name))).join('');
    return h.card('Your provider keys', rows || '<p class="pg-dim set-p">Add your own key to pay that provider directly. XENO checks it works, then stores it encrypted.</p>', btn('Add a key', 'addKey', '', ''))
      + h.card('Where each product’s AI comes from', h.row('Your default', 'What every product uses unless you choose otherwise below', pick('*', def ? cur(def.path, def.credential_id) : 'premium', false, 'Your default')) + products)
      + `<p class="pg-rule">${h.ic('lock')}Your keys are stored encrypted and never shown again, only their last characters. A product set to your key never spends credits, and it won’t quietly fall back to them.</p>`;
  }
  async function addKey() {
    const e = L.providers; if (!e || !e.d) return;
    if (!await confirm('A key’s endpoint receives the prompts of every product you route to it.')) return;
    let made = null;
    const v = await window.XD.form({ title: 'Add a provider key', sub: 'XENO checks it with the provider before saving it.', submit: 'Add key', fields: [
      { id: 'provider', label: 'Provider', type: 'select', value: e.d.providers[0], options: e.d.providers.map((p) => [p, providerName(p)]) },
      { id: 'label', label: 'Name', required: true, max: 60, placeholder: 'e.g. Work OpenAI' },
      { id: 'secret', label: 'Key', type: 'password', required: true, max: 2000 },
      { id: 'baseUrl', label: 'Endpoint', max: 500, placeholder: 'https://…', hint: 'Only for Azure and OpenAI-compatible providers.', validate: (x, all) => (ENDPOINT.has(all.provider) && !String(x || '').trim() ? 'This provider needs its endpoint.' : null) }],
      onSubmit: async (vals) => {
        const r = await api('POST', '/api/v2/inference/credentials', { provider: vals.provider, label: vals.label.trim(), secret: vals.secret.trim(), ...(ENDPOINT.has(vals.provider) ? { baseUrl: vals.baseUrl.trim() } : {}) }).catch(() => none);
        if (!r.ok) return words(r, 'That key couldn’t be added.');
        made = r.d.credential; return null;
      } });
    if (!v || !made) return;
    X()?.toast?.(`${made.label || providerName(made.provider)} added`);
    again('providers');
    if (LISTED.has(made.provider)) keyModels(made.id, made);
  }
  async function keyModels(id, given) {
    const k = given || (L.providers?.d?.keys || []).find((x) => x.id === id); if (!k) return;
    const found = await api('GET', `/api/v2/inference/credentials/${encodeURIComponent(id)}/models`).catch(() => none);
    const known = found.ok && Array.isArray(found.d.models) ? found.d.models.map((m) => m.id) : [];
    const v = await window.XD.form({ title: `Models for ${esc(k.label || providerName(k.provider))}`, sub: LISTED.has(k.provider) ? 'This key answers only for the models you list.' : 'Leave empty to allow every model this provider has.', submit: 'Save', fields: [
      { id: 'models', label: 'Model names', type: 'textarea', rows: 4, max: 4000, value: (k.models || []).join(', '), hint: known.length ? `It offers: ${known.slice(0, 12).join(', ')}${known.length > 12 ? ' and more' : ''}` : 'Separate them with commas.' }],
      onSubmit: async (vals) => { const list = vals.models.split(/[\s,]+/).filter(Boolean); const r = await api('PUT', `/api/v2/inference/credentials/${encodeURIComponent(id)}/models`, { models: list.length ? list : null }).catch(() => none); return r.ok ? null : words(r, 'Those models couldn’t be saved.'); } });
    if (v) { X()?.toast?.('Models saved'); again('providers'); }
  }
  async function removeKey(id) {
    const k = (L.providers?.d?.keys || []).find((x) => x.id === id); if (!k) return;
    if (!await window.XD.confirm({ title: `Remove ${esc(k.label || providerName(k.provider))}?`, body: 'XENO deletes it. You’d have to enter it again to use it here.', action: 'Remove key' })) return;
    const r = await api('DELETE', '/api/v2/inference/credentials/' + encodeURIComponent(id)).catch(() => none);
    if (!r.ok && r.status === 409) {
      const names = (r.d.surfaces || []).map((s) => (s === '*' ? 'your default' : (L.providers.d.products.find((p) => p.client_id === s)?.name || s)));
      X()?.toast?.(`Still used by ${names.join(', ')}. Choose something else for ${names.length === 1 ? 'it' : 'them'} first.`);
    } else X()?.toast?.(r.ok ? 'Key removed' : words(r, 'That key couldn’t be removed.'));
    if (r.ok) again('providers');
  }
  async function setRoute(surface, value) {
    const [path, credentialId] = String(value).split(':');
    const r = path === 'inherit' ? await api('DELETE', '/api/v2/inference/routes/' + encodeURIComponent(surface)).catch(() => none)
      : await api('PUT', '/api/v2/inference/routes/' + encodeURIComponent(surface), { path, ...(credentialId ? { credentialId } : {}) }).catch(() => none);
    X()?.toast?.(r.ok ? 'Saved' : words(r, 'That couldn’t be saved.'));
    again('providers');
  }

  // ---------- your monthly limit ----------
  const MONTH = 30 * 86400;
  function capCard(h) {
    const e = lazy('caps', async () => need(await api('GET', '/api/v2/ledger/caps')).caps || []);
    if (e.status === 'loading') return h.card('Monthly limit', '<p class="pg-dim set-p" role="status">Loading</p>');
    if (e.status === 'error') return failedCard(h, 'Monthly limit', 'caps');
    const c = e.d.find((x) => x.windowSec === MONTH);
    return h.card('Monthly limit', c
      ? h.row('Spend limit', `${creditsOf(c.spentMicro).toLocaleString()} of ${creditsOf(c.limitMicro).toLocaleString()} credits used in the last 30 days. Work that would go past it is refused.`, `${btn('Change', 'cap')} ${btn('Remove limit', 'capOff')}`)
      : h.row('Spend limit', 'No limit. Set one and work that would go past it is refused.', btn('Set a limit', 'cap', '', '')));
  }
  async function setCap() {
    const c = (L.caps?.d || []).find((x) => x.windowSec === MONTH);
    const v = await window.XD.form({ title: 'Monthly spend limit', sub: 'Counts everything you spent in the last 30 days, and what’s reserved for work running now.', submit: 'Save limit', size: 'sm', fields: [
      { id: 'n', label: 'Credits', type: 'number', required: true, value: String(c ? creditsOf(c.limitMicro) : 5000), validate: (x) => (/^\d+$/.test(x) && +x > 0 ? null : 'Enter a whole number above zero.') }],
      onSubmit: async (vals) => { const r = await api('PUT', '/api/v2/ledger/caps', { windowSec: MONTH, limitMicro: +vals.n * 1e6 }).catch(() => none); return r.ok ? null : words(r, 'That limit couldn’t be saved.'); } });
    if (v) { X()?.toast?.(`Limit set to ${(+v.n).toLocaleString()} credits`); again('caps'); }
  }
  async function capOff() {
    if (!await window.XD.confirm({ title: 'Remove your spend limit?', body: 'Nothing will stop work at a monthly amount any more.', action: 'Remove limit' })) return;
    const r = await api('DELETE', `/api/v2/ledger/caps/${MONTH}`).catch(() => none);
    X()?.toast?.(r.ok ? 'Spend limit removed' : words(r, 'That limit couldn’t be removed.'));
    again('caps');
  }

  // ---------- connected services: where each one is managed ----------
  const goPath = (p) => window.XENO_ADDR.go(window.XENO_ADDR.toHash(p));
  async function workspaceId() {
    const cur = window.XENO_SCOPE?.uuid?.();
    if (cur) return cur;
    const r = await api('GET', '/api/workspaces').catch(() => none);
    return ((r.ok && r.d.workspaces) || []).find((w) => w.workspace_type === 'personal')?.id || null;
  }
  function connectionsSection(h) {
    const e = lazy('connections', async () => {
      const ws = await workspaceId();
      const [clouds, mcp] = await Promise.all([ws ? api('GET', `/api/storage/connect/workspaces/${ws}/connections`).catch(() => none) : none, api('GET', '/api/mcp/connections').catch(() => none)]);
      return { clouds: clouds.ok && Array.isArray(clouds.d) ? clouds.d : null, agents: mcp.ok ? (mcp.d.connections || []) : null };
    });
    if (e.status === 'loading') return loadingCard(h);
    if (e.status === 'error') return failedCard(h, 'Connections', 'connections');
    const open = (to) => `<button class="pg-btn ghost" data-acct="goto" data-arg="${esc(to)}"><span>Open</span></button>`;
    const clouds = e.d.clouds === null ? '<p class="set-p">Connected clouds could not be read just now.</p>'
      : e.d.clouds.length ? e.d.clouds.map((c) => h.row(esc(c.displayName || 'Google Drive'), `Google Drive · ${c.status === 'active' ? 'connected' : esc(c.status)}`, open(`/workspace/corpo/apps/storage/connections/${c.id}`))).join('')
        : '<p class="pg-dim set-p">No cloud account is connected to this workspace.</p>';
    const agents = e.d.agents === null ? '<p class="set-p">XENO MCP connections could not be read just now.</p>'
      : e.d.agents.length ? e.d.agents.map((c) => h.row(esc(c.client?.name || 'Agent'), c.lastUsedAt ? `Used ${h.ago(ms(c.lastUsedAt))}` : 'Not used yet', open(`/workspace/dev/apps/mcp/c/${c.id}`))).join('')
        : '<p class="pg-dim set-p">No agent is connected over XENO MCP.</p>';
    return h.card('Cloud accounts', clouds, `<button class="pg-btn" data-acct="goto" data-arg="/workspace/corpo/apps/storage/connections"><span>${e.d.clouds && e.d.clouds.length ? 'Manage' : 'Connect Google Drive'}</span></button>`)
      + h.card('Agents connected over XENO MCP', agents, '<button class="pg-btn ghost" data-acct="goto" data-arg="/workspace/dev/apps/mcp"><span>Manage</span></button>');
  }

  // ---------- gifts ----------
  const placesOp = async (op, body) => { const r = await api('POST', '/api/places/ops/' + op, body || {}).catch(() => none); return r; };
  function giftsSection(h) {
    const e = lazy('gifts', async () => { const r = await placesOp('funding.get'); if (!r.ok || !r.d.ok) throw new Error('unavailable'); return r.d.result; });
    if (e.status === 'loading') return loadingCard(h);
    if (e.status === 'error') return failedCard(h, 'Gifts', 'gifts');
    const hist = (e.d.ledger || []).filter((x) => /gift/i.test(String(x.kind)));
    const rows = hist.map((x) => h.row(`${creditsOf(Math.abs(x.amountMicro)).toLocaleString()} credits ${x.direction === 'in' ? 'from' : 'to'} ${esc(x.memo || 'someone')}`, h.when(ms(x.at)), x.status ? h.tag(title(x.status)) : '')).join('');
    return h.card('Send credits', e.d.giftsOpen ? '<p class="pg-dim set-p">Give credits from your balance to someone on XENO.</p>' : '<p class="pg-dim set-p">Sending credits isn’t open yet. Gifts you send or receive will show here once it is.</p>', e.d.giftsOpen ? btn('Send a gift', 'gift', '', '') : '')
      + h.card('History', rows || '<p class="pg-dim set-p">No gifts yet.</p>');
  }
  async function sendGift() {
    const balance = creditsOf(L.gifts?.d?.balanceMicro || 0);
    const requestId = crypto.randomUUID();
    const v = await window.XD.form({ title: 'Send credits', sub: `You have ${balance.toLocaleString()} credits. This moves them now.`, submit: 'Send gift', size: 'sm', fields: [
      { id: 'to', label: 'To', required: true, max: 60, placeholder: '@handle' },
      { id: 'n', label: 'Credits', type: 'number', required: true, value: '100', validate: (x) => (!/^\d+$/.test(x) || +x <= 0 ? 'Enter a whole number above zero.' : +x > balance ? 'That’s more than you have.' : null) }],
      onSubmit: async (vals) => { const r = await placesOp('funding.gift', { recipient: vals.to.trim(), amount: +vals.n, confirmed: true, requestId }); return r.ok && r.d.ok ? null : (r.d?.error?.message || 'That gift couldn’t be sent. No credits moved.'); } });
    if (v) { X()?.toast?.('Gift sent'); again('gifts'); }
  }

  // ---------- Corpus on your PCs (XENO Corpus desktop) ----------
  // Rows come from /api/account/corpus-pcs. The projects are turned on in XENO Corpus on that PC; this is the off switch from anywhere.
  function pcsSection(h) {
    if (!S.pcs) return h.card('Corpus on your PCs', '<p class="set-p">XENO couldn’t load your PCs.</p>', retry);
    const rule = '<p class="pg-rule">Apps you connect to XENO MCP can read the projects you turned on, read-only, while that PC is connected, once you turn on Corpus on your PC for that app. Answers aren’t kept on XENO’s servers.</p><button class="pg-btn ghost" data-acct="goto" data-arg="/workspace/dev/apps/mcp"><span>Choose apps in XENO MCP</span></button>';
    if (!S.pcs.length) return h.card('Corpus on your PCs', '<p class="pg-dim set-p">No PC is connected. In XENO Corpus on your PC, turn a project on for agents.</p>') + rule;
    const rows = S.pcs.map((p) => {
      const seen = !p.enabled ? 'Turned off' : p.connected ? 'Connected now' : p.lastSeenAt ? `Last seen ${h.ago(ms(p.lastSeenAt))}` : 'Not connected yet';
      const names = (p.projects || []).map((x) => esc(x.name)).join(', ');
      const sub = `${esc(seen)}${names ? ` · ${names}` : ''}`;
      const toggle = btn(p.enabled ? 'Turn off' : 'Turn on', 'pcEnable', `${p.id}|${p.enabled ? 'off' : 'on'}`, 'ghost');
      return h.row(esc(p.label), sub, `${toggle} ${btn('Remove', 'pcRemove', p.id)}`);
    }).join('');
    return h.card('Corpus on your PCs', rows) + rule;
  }
  async function pcEnable(arg) {
    const [id, to] = String(arg || '').split('|');
    const r = await api('PATCH', '/api/account/corpus-pcs/' + encodeURIComponent(id), { enabled: to === 'on' }).catch(() => ({ ok: false, status: 0, d: {} }));
    if (!r.ok) X()?.toast?.('That PC couldn’t be changed.');
    return load();
  }
  async function pcRemove(id) {
    const yes = await window.XD?.confirm?.({ title: 'Remove this PC?', body: 'It stops connecting, and XENO forgets its list of projects. To connect it again, turn a project on in XENO Corpus on that PC.', action: 'Remove PC', danger: true });
    if (!yes) return;
    const r = await api('DELETE', '/api/account/corpus-pcs/' + encodeURIComponent(id)).catch(() => ({ ok: false, status: 0, d: {} }));
    if (!r.ok && r.status !== 404) X()?.toast?.('That PC couldn’t be removed.');
    return load();
  }

  // ---------- connected browsers (XENO Extension) ----------
  // Rows come from /api/account/browsers. Turning chats off takes effect now (the browser's socket is closed and any
  // waiting step fails); Remove disconnects it for good — the extension has to sign in again to come back.
  function browsersSection(h) {
    if (!S.browsers) return h.card('Connected browsers', '<p class="set-p">XENO couldn’t load your browsers.</p>', retry);
    const get = '<a class="pg-btn ghost" href="/product/extension" target="_blank" rel="noopener"><span>Get XENO Extension</span></a>';
    if (!S.browsers.length) return h.card('Connected browsers', '<p class="pg-dim set-p">No browser is connected. Install XENO Extension and sign in with this account, then allow chats to use it here.</p>', get);
    const rows = S.browsers.map((b) => {
      const what = [b.browser, b.os].filter(Boolean).map(title).join(' on ') || 'Browser';
      const seen = b.connected ? 'Connected now' : b.lastSeenAt ? `Last seen ${h.ago(ms(b.lastSeenAt))}` : 'Not connected yet';
      const sub = `${esc(what)} · ${esc(seen)}${b.tools ? ` · ${b.tools} tool${b.tools === 1 ? '' : 's'}` : ''}`;
      const toggle = btn(b.enabled ? 'Stop chats using it' : 'Allow chats to use it', 'browserEnable', `${b.id}|${b.enabled ? 'off' : 'on'}`, b.enabled ? 'ghost' : '');
      return h.row(`${esc(b.label)}${b.enabled ? ' ' + h.tag('Chats allowed') : ''}`, sub, `${toggle} ${btn('Remove', 'browserRemove', b.id)}`);
    }).join('');
    return h.card('Connected browsers', rows)
      + '<p class="pg-rule">A chat acts in the browser you allow, through the extension. Steps that change something ask for your approval in that browser, never here.</p>';
  }
  async function browserEnable(arg) {
    const [id, to] = String(arg || '').split('|');
    const r = await api('PATCH', '/api/account/browsers/' + encodeURIComponent(id), { enabled: to === 'on' }).catch(() => ({ ok: false, status: 0, d: {} }));
    if (!r.ok) X()?.toast?.('That browser couldn’t be changed.');
    return load();
  }
  async function browserRemove(id) {
    const r = await api('DELETE', '/api/account/browsers/' + encodeURIComponent(id)).catch(() => ({ ok: false, status: 0, d: {} }));
    if (!r.ok && r.status !== 404) X()?.toast?.('That browser couldn’t be removed.');
    return load();
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
  const SECOND = { authenticator: 'Authenticator app', passkey: 'Passkey', recovery_code: 'Recovery code' };
  /** factor: this change touches two-step itself, so only the second step will do. */
  async function confirm(why, { factor = false } = {}) {
    const st = await api('GET', '/api/account/security').catch(() => ({ ok: false, d: {} }));
    if (!st.ok || !st.d.security) { X()?.toast?.('XENO could not be reached. Nothing was changed.'); return false; }
    S.security = st.d.security;
    const methods = S.security.methods || [], seconds = methods.filter((m) => SECOND[m]), con = S.security.confirmation || {};
    if (con.confirmed && (!factor || !seconds.length || SECOND[con.method])) return true;
    if (con.available === false) { X()?.toast?.('This needs a signed-in browser session.'); return false; }
    const allowed = factor && seconds.length ? seconds : methods;
    let how = allowed[0];
    if (allowed.length > 1) {
      const pick = await window.XD.form({ title: 'Confirm it’s you', sub: why, submit: 'Continue', size: 'sm', fields: [{ id: 'how', label: 'With', type: 'select', value: how, options: allowed.map((m) => [m, SECOND[m] || (m === 'password' ? 'Your password' : 'A code by email')]) }] });
      if (!pick) return false;
      how = pick.how;
    }
    if (SECOND[how]) return confirmSecond(why, how);
    const byCode = how === 'email_code';
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

  async function confirmSecond(why, how) {
    if (how === 'passkey') {
      const o = await api('POST', '/api/account/confirm/passkey/options', {}).catch(() => ({ ok: false, d: {} }));
      if (!o.ok) { X()?.toast?.(say(o, 'Passkeys aren’t available right now.')); return false; }
      let response; try { response = await passkeyGet(o.d.options); } catch { X()?.toast?.('The passkey wasn’t used. Nothing was changed.'); return false; }
      const r = await api('POST', '/api/account/confirm', { passkey: { ceremonyId: o.d.ceremonyId, response } }).catch(() => ({ ok: false, d: {} }));
      if (!r.ok) X()?.toast?.(say(r, 'That passkey didn’t work.'));
      return r.ok;
    }
    const recovery = how === 'recovery_code';
    const v = await window.XD.form({ title: 'Confirm it’s you', sub: why, submit: 'Confirm', size: 'sm', fields: [{ id: 'code', label: recovery ? 'Recovery code' : 'Code from your app', required: true, max: 24, placeholder: recovery ? 'xxxx-xxxx-xxxx-xxxx' : '6 digits' }],
      onSubmit: async (vals) => { const r = await api('POST', '/api/account/confirm', recovery ? { recovery_code: vals.code } : { authenticator: vals.code }).catch(() => ({ ok: false, d: {} })); return r.ok ? null : say(r, 'That didn’t work.'); } });
    return !!v;
  }

  // ---------- two-step sign-in ----------
  const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const toB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function passkeyGet(options) {
    const c = await navigator.credentials.get({ publicKey: { ...options, challenge: fromB64(options.challenge), allowCredentials: (options.allowCredentials || []).map((x) => ({ ...x, id: fromB64(x.id) })) } });
    if (!c) throw new Error('cancelled');
    return { id: c.id, rawId: toB64(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), response: { clientDataJSON: toB64(c.response.clientDataJSON), authenticatorData: toB64(c.response.authenticatorData), signature: toB64(c.response.signature), userHandle: c.response.userHandle ? toB64(c.response.userHandle) : undefined } };
  }
  async function passkeyCreate(options) {
    const c = await navigator.credentials.create({ publicKey: { ...options, challenge: fromB64(options.challenge), user: { ...options.user, id: fromB64(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map((x) => ({ ...x, id: fromB64(x.id) })) } });
    if (!c) throw new Error('cancelled');
    return { id: c.id, rawId: toB64(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), response: { clientDataJSON: toB64(c.response.clientDataJSON), attestationObject: toB64(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } };
  }
  function showCodes(list) {
    const handle = acctNow().profile?.handle || '';
    return window.XD.info({ title: 'Your recovery codes', sub: 'Each works once if you lose your other ways in. Keep them somewhere safe: they’re shown only now.', html: `<ol class="set-codes">${list.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>`, actions: [
      { label: 'Copy', close: false, run: () => window.XCM.H.copy(list.join('\n'), 'Codes copied') },
      { label: 'Download', close: false, run: () => { const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([`XENO recovery codes for @${handle}\n\n${list.join('\n')}\n`], { type: 'text/plain' })); a2.download = 'xeno-recovery-codes.txt'; a2.click(); } }] });
  }
  // ---------- connecting a sign-in method ----------
  const PROVIDER = { google: 'Google', github: 'GitHub', twitter: 'X' };
  async function addMethod() {
    const v = await window.XD.form({ title: 'Connect a sign-in method', sub: 'You’ll sign in with it once, and can use it from then on.', submit: 'Continue', size: 'sm', fields: [{ id: 'k', label: 'Sign in with', type: 'select', value: 'google', options: Object.entries(PROVIDER) }] });
    if (!v) return;
    if (!await confirm('Connecting a sign-in method changes how you sign in.')) return;
    location.href = `/api/auth/${encodeURIComponent(v.k)}?link=1`;
  }
  // coming back from the provider
  { const q = new URLSearchParams(location.search), linked = q.get('linked'), bad = q.get('link_error');
    if (linked || bad) {
      const WORD = { taken: 'That account is already connected to someone else on XENO.', has_one: 'You already have one of those connected. Remove it first.', confirm: 'Confirm it’s you first, then try again.', sign_in: 'Sign in first, then try again.' };
      setTimeout(() => { X()?.toast?.(linked ? `${PROVIDER[linked] || 'That account'} connected` : (WORD[bad] || 'That couldn’t be connected.')); q.delete('linked'); q.delete('link_error'); history.replaceState(history.state, '', location.pathname + (q.size ? '?' + q : '')); }, 800);
    }
  }

  const TWO = '/api/account/two-step';
  const twoStep = {
    async addPasskey() {
      if (!window.PublicKeyCredential) return X()?.toast?.('This browser can’t use passkeys.');
      if (!await confirm('Adding a passkey changes how you sign in.')) return;
      const v = await window.XD.form({ title: 'Add a passkey', sub: 'Your device will ask for your fingerprint, face or PIN.', submit: 'Create passkey', size: 'sm', fields: [{ id: 'n', label: 'Name it', required: true, value: navigator.userAgentData?.platform ? navigator.userAgentData.platform + ' computer' : 'This device', max: 60 }] });
      if (!v) return;
      const o = await api('POST', TWO + '/passkeys/options', {}).catch(() => ({ ok: false, d: {} }));
      if (!o.ok) return X()?.toast?.(say(o, 'A passkey couldn’t be added.'));
      let response; try { response = await passkeyCreate(o.d.options); } catch { return X()?.toast?.('The passkey wasn’t created. Nothing was changed.'); }
      const r = await api('POST', TWO + '/passkeys', { ceremonyId: o.d.ceremonyId, response, name: v.n.trim() }).catch(() => ({ ok: false, d: {} }));
      if (!r.ok) return X()?.toast?.(say(r, 'That passkey couldn’t be added.'));
      X()?.toast?.('Passkey added'); await load();
      if (r.d.recoveryCodes) showCodes(r.d.recoveryCodes);
    },
    async renamePasskey(id) {
      const k = (acctNow().passkeys || []).find((x) => x.id === id); if (!k) return;
      const v = await window.XD.form({ title: 'Rename this passkey', submit: 'Save', size: 'sm', fields: [{ id: 'n', label: 'Name', required: true, value: k.name, max: 60 }],
        onSubmit: async (vals) => { const r = await api('PATCH', `${TWO}/passkeys/${encodeURIComponent(id)}`, { name: vals.n.trim() }).catch(() => ({ ok: false, d: {} })); return r.ok ? null : say(r, 'That couldn’t be saved.'); } });
      if (v) await load();
    },
    async removePasskey(id) {
      const a = acctNow(), k = (a.passkeys || []).find((x) => x.id === id); if (!k) return;
      const last = a.passkeys.length === 1 && !a.totp;
      if (!await window.XD.confirm({ title: `Remove “${esc(k.name)}”?`, body: last ? 'It’s your last second step, so two-step sign-in turns off and your recovery codes stop working.' : 'You won’t be able to sign in with it any more.', action: 'Remove' })) return;
      if (!await confirm('Removing a passkey changes how you sign in.', { factor: true })) return;
      const r = await api('DELETE', `${TWO}/passkeys/${encodeURIComponent(id)}`).catch(() => ({ ok: false, d: {} }));
      X()?.toast?.(r.ok ? 'Passkey removed' : say(r, 'That passkey couldn’t be removed.'));
      await load();
    },
    async totpOn() {
      if (!await confirm('Turning on an authenticator changes how you sign in.')) return;
      const b = await api('POST', TWO + '/totp', {}).catch(() => ({ ok: false, d: {} }));
      if (!b.ok) return X()?.toast?.(say(b, 'That couldn’t be started.'));
      let codes = null;
      const v = await window.XD.form({ title: 'Set up an authenticator app', sub: 'Scan this in your authenticator app, or type the key, then enter the 6-digit code it shows.', submit: 'Turn on', size: 'sm',
        aside: `<div class="set-secret"><div class="set-qr" style="background:#fff">${b.d.qrSvg}</div><code>${esc(b.d.key.match(/.{1,4}/g).join(' '))}</code></div>`,
        fields: [{ id: 'code', label: 'Code from the app', required: true, max: 8, placeholder: '6 digits', validate: (x) => (/^\d{6}$/.test(x.trim()) ? null : 'Enter the 6-digit code.') }],
        onSubmit: async (vals) => { const r = await api('POST', TWO + '/totp/confirm', { code: vals.code.trim() }).catch(() => ({ ok: false, d: {} })); if (!r.ok) return say(r, 'That code isn’t right.'); codes = r.d.recoveryCodes; return null; } });
      if (!v) return;
      X()?.toast?.('Authenticator app on'); await load();
      if (codes) showCodes(codes);
    },
    async totpOff() {
      if (!await window.XD.confirm({ title: 'Turn off the authenticator app?', body: 'You’ll no longer be asked for its codes. If it’s your last second step, your recovery codes stop working too.', action: 'Turn off', danger: false })) return;
      if (!await confirm('Turning off two-step sign-in makes your account easier to take over.', { factor: true })) return;
      const r = await api('DELETE', TWO + '/totp').catch(() => ({ ok: false, d: {} }));
      X()?.toast?.(r.ok ? 'Authenticator turned off' : say(r, 'That couldn’t be turned off.'));
      await load();
    },
    async codes() {
      if (!await confirm('New recovery codes replace the old ones.', { factor: true })) return;
      const r = await api('POST', TWO + '/recovery-codes', {}).catch(() => ({ ok: false, d: {} }));
      if (!r.ok) return X()?.toast?.(say(r, 'New codes couldn’t be made.'));
      await load(); showCodes(r.d.recoveryCodes);
    },
  };

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
  let job = null;
  const take = () => { const v = job; job = null; return v; };
  const run = (op, payload, label) => { job = payload; return window.XENO_NET.run({ op, label }); };
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
    if (act === 'reload') return again(t.dataset.arg);
    if (act === 'removeApp') return removeApp(t.dataset.arg);
    if (act === 'addKey') return addKey();
    if (act === 'keyModels') return keyModels(t.dataset.arg);
    if (act === 'removeKey') return removeKey(t.dataset.arg);
    if (act === 'cap') return setCap();
    if (act === 'capOff') return capOff();
    if (act === 'gift') return sendGift();
    if (act === 'goto') return goPath(t.dataset.arg);
    if (act === 'plans') return window.open('/pricing', '_blank', 'noopener');
    if (act === 'export') return requestExport();
    if (act === 'removeExport') return removeExport(t.dataset.arg);
    if (act === 'pcEnable') return pcEnable(t.dataset.arg);
    if (act === 'pcRemove') return pcRemove(t.dataset.arg);
    if (act === 'browserEnable') return browserEnable(t.dataset.arg);
    if (act === 'browserRemove') return browserRemove(t.dataset.arg);
    if (act === 'portal') {
      t.disabled = true;
      try { const r = await api('POST', '/api/billing/portal', {}); if (r.ok && r.d.url) window.open(r.d.url, '_blank', 'noopener'); else X()?.toast?.(r.status === 503 ? 'Billing isn’t open yet.' : 'The billing portal couldn’t be opened.'); }
      catch { X()?.toast?.('XENO could not be reached.'); }
      t.disabled = false;
    }
  });

  document.addEventListener('change', (e) => { const s = e.target.closest('[data-acct-route]'); if (s) setRoute(s.dataset.acctRoute, s.value); });

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
    'settings.export': async () => { take(); const r = await api('POST', '/api/account/exports', {}); if (!r.ok) return settle(fail(r, 'The copy couldn’t be requested.')); await load(); return { ok: true }; },
    'settings.removeExport': async () => { const r = await api('DELETE', '/api/account/exports/' + encodeURIComponent(take())); if (!r.ok) return settle(fail(r, 'The copy couldn’t be removed.')); await load(); return { ok: true }; },
    'settings.removeMethod': async ({ before }) => {
      for (const m of removed(before, 'methods')) { const r = await api('DELETE', '/api/auth/linked-accounts/' + encodeURIComponent(m.id)); if (!r.ok) return settle(fail(r, 'That sign-in method couldn’t be removed.')); }
      return settle({ ok: true });
    },
    // the screen has asked and confirmed; the server still decides. A refusal says what to do first.
    'settings.delete': async () => { const r = await api('POST', '/api/account/deletion', {}); if (!r.ok) return settle(fail(r, 'Your account couldn’t be scheduled for deletion.')); await load(); return { ok: true }; },
    'settings.undelete': async () => { const r = await api('DELETE', '/api/account/deletion'); if (!r.ok) return settle(fail(r, 'That couldn’t be changed. Your account is still being deleted.')); await load(); return { ok: true }; },
    'settings.pref': savePrefs,
    'settings.region': savePrefs,
  });

  window.XENO_ACCOUNT = { served: true, section, load, confirm, changeEmail, twoStep, addMethod, state: () => ({ status: S.status, parts: { ...S.parts } }), unavailable: () => [...UNAVAILABLE] };
  Promise.resolve(P.ready).then((user) => { if (user) P.first(load()); });   // the page waits for this first load before it shows
})();
