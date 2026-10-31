/* platform-company.js — Corpo › Company on the real platform (services/companyEntity.js, /api/orgs; xeno-company/SPEC.md §4.2).
 *
 *   Company   /workspace/corpo/spaces/company     the current workspace's legal entity: registrations, identifiers, who may act for
 *                                                 it, and its wallet and seats, read from the workspace's own billing.
 *
 * Replaces company.js's sample record when served. It says what's true of the workspace you are in; a personal workspace has no
 * legal entity. Owners and admins change it. Moving money isn't here: the wallet is read, and credits go in through Billing.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) return;
  const X = () => window.XW, D = () => window.XD, H = () => window.XENO_PAGES.h, api = P.api;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { if (window.XENO_PAGES?.repaint && document.querySelector('#main .mview')) window.XENO_PAGES.repaint(); else X()?.render?.(); } catch {} };
  const why = (r, d) => (r && r.d && (r.d.error || r.d.code)) || d;
  const COUNTRIES = [['AE-DXB', 'United Arab Emirates (DIFC)'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DE', 'Germany'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['ES', 'Spain'], ['FI', 'Finland'], ['FR', 'France'], ['GB', 'United Kingdom'], ['GB-NIR', 'Northern Ireland'], ['GR', 'Greece'], ['HR', 'Croatia'], ['HU', 'Hungary'], ['IE', 'Ireland'], ['IS', 'Iceland'], ['IT', 'Italy'], ['LI', 'Liechtenstein'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['LV', 'Latvia'], ['MT', 'Malta'], ['NL', 'Netherlands'], ['NO', 'Norway'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SE', 'Sweden'], ['SI', 'Slovenia'], ['SK', 'Slovakia'], ['US', 'United States']];
  const country = (c) => (COUNTRIES.find((x) => x[0] === c) || [c, c])[1];
  // Rule 5: a VAT prefix is not a country code
  const VAT_PREFIX = { GR: 'EL', 'GB-NIR': 'XI' };
  const CHECK = { valid: 'Valid', invalid: 'Not valid', unverifiable: 'Couldn’t be checked' };
  const S = { status: 'idle', for: null, d: null, bill: null };
  async function load() {
    const ws = window.XENO_SCOPE?.uuid?.();
    S.for = ws;
    if (!ws) { S.status = 'noscope'; return paint(); }
    S.status = S.d ? 'ready' : 'loading';
    const [e, b] = await Promise.all([api('GET', `/api/orgs/${ws}`).catch(() => null), api('GET', `/api/workspaces/${ws}/billing`).catch(() => null)]);
    if (S.for !== ws) return;
    if (!e || !e.ok) { S.status = e && e.status === 404 ? 'missing' : 'error'; return paint(); }
    S.d = e.d; S.bill = b && b.ok ? b.d.billing : null; S.status = 'ready'; paint();
  }
  const row = (label, sub, ctl = '') => `<div class="set-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="set-ctl">${ctl}</span></div>`;
  const addr = (a) => (a ? [a.line1, a.line2, a.city, a.region, a.postalCode, country(a.country)].filter(Boolean).map(esc).join(', ') : '');
  function page() {
    const h = H(), ws = window.XENO_SCOPE?.uuid?.();
    if (S.for !== ws && S.status !== 'loading') load();
    const head = (acts = '', title = 'Company') => h.head({ title, sub: 'The legal entity behind this workspace: where it’s registered, its numbers, and who may act for it.', acts });
    if (S.status === 'loading' || S.status === 'idle' || S.status === 'noscope') return h.page(head() + h.box('refresh', 'Loading the company', '', '', 'sm'));
    if (S.status !== 'ready') return h.page(head() + h.box('x', 'The company couldn’t be loaded', 'Nothing was changed.', h.btn('Try again', 'data-co2="retry"', true), 'sm'));
    const d = S.d, c = d.canManage, btn = (label, a, arg = '', ghost = true) => (c ? h.btn(label, `data-co2="${a}" data-arg="${esc(arg)}"`, ghost) : '');
    if (d.org.kind === 'personal') return h.page(head() + h.box('building', 'This is your personal workspace', 'A company has its own people, wallet and legal entity. Create one, or switch to one you belong to.', h.btn('Create a company', 'data-xa="newCompany"', false, 'plus')));
    const p = d.profile, drop = (kind, id) => btn('Remove', 'remove', `${kind}|${id}`);
    const regs = d.registrations.map((r) => row(`${esc(country(r.jurisdiction))} ${r.role === 'primary' ? '<span class="set-tag on">Primary</span>' : '<span class="set-tag">Branch</span>'}`, `${esc(r.register)} · ${esc(r.number)}${r.euid ? ` · EUID ${esc(r.euid)}` : ''}`, drop('registrations', r.id))).join('') || '<p class="pg-dim set-p">Not registered anywhere yet.</p>';
    const tax = d.tax.map((t) => row(`${t.scheme === 'vat' ? esc(t.prefix) : ''}${esc(t.number)} <span class="set-tag">${t.scheme === 'vat' ? 'VAT' : t.scheme === 'oss' ? 'OSS' : 'Tax'}</span>${t.check ? ` <span class="set-tag${t.check.result === 'valid' ? ' on' : ''}">${esc(CHECK[t.check.result])}</span>` : ''}`,
      `${esc(country(t.jurisdiction))}${t.check ? ` · checked ${esc(new Date(t.check.at).toLocaleDateString())}${t.check.consultationNumber ? ` · consultation ${esc(t.check.consultationNumber)}` : ''}` : ''}`,
      `${t.scheme === 'vat' ? btn('Check with VIES', 'check', t.id) : ''} ${drop('tax', t.id)}`)).join('') || '<p class="pg-dim set-p">No tax numbers yet.</p>';
    const customs = d.customs.map((x) => row(esc(x.number), `EORI · ${esc(country(x.jurisdiction))}`, drop('customs', x.id))).join('') || '<p class="pg-dim set-p">None. Add an EORI when the company imports or exports.</p>';
    const fin = d.financial.map((x) => row(`${esc(x.number)} <span class="set-tag${x.status === 'ISSUED' ? ' on' : ''}">${esc(x.status)}</span>`, `LEI${x.nextRenewal ? ` · renews ${esc(x.nextRenewal)}` : ''}`, drop('financial', x.id))).join('') || '<p class="pg-dim set-p">None. Add an LEI when the company trades on financial markets.</p>';
    const mandates = d.mandates.map((m) => row(`${esc(m.name)} <span class="set-tag">${m.authority === 'sole' ? 'Acts alone' : 'Acts jointly'}</span>`, [esc(m.role), m.scope ? esc(m.scope) : '', m.validUntil ? `until ${esc(m.validUntil)}` : '', m.dateOfBirth ? `born ${esc(m.dateOfBirth)}` : ''].filter(Boolean).join(' · '), drop('mandates', m.id))).join('') || '<p class="pg-dim set-p">Nobody recorded yet.</p>';
    const b = S.bill;
    const money = b ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Wallet</h3></div><div class="pg-card-s" data-co2-wallet>${row(`${(b.wallet.available_credits || 0).toLocaleString()} credits`, `${b.wallet.pending_credits ? `${b.wallet.pending_credits.toLocaleString()} reserved for work running now · ` : ''}${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}${b.wallet.is_frozen ? ' · frozen' : ''}`)}</div></section>` : '';
    return h.page(head(btn('Edit details', 'profile', '', true), esc(p.legalName || d.org.name)) + `<div class="pg-cols"><div>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Legal entity</h3></div><div class="pg-card-s">
        ${row('Legal name', '', esc(p.legalName || '') || '<span class="pg-dim">Not set</span>')}
        ${row('Legal form', p.governingRegime ? `Under ${esc(p.governingRegime)}` : '', esc(p.legalForm || '') || '<span class="pg-dim">Not set</span>')}
        ${row('Registered office', '', addr(p.registeredOffice) || '<span class="pg-dim">Not set</span>')}
        ${row('Central administration', 'Where it’s actually run. It can differ from the registered office.', addr(p.centralAdministration) || '<span class="pg-dim">Not set</span>')}
      </div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Registrations</h3>${btn('Add', 'addReg')}</div><div class="pg-card-s">${regs}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Tax</h3>${btn('Add', 'addTax')}</div><div class="pg-card-s">${tax}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Customs</h3>${btn('Add', 'addCustoms')}</div><div class="pg-card-s">${customs}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Financial markets</h3>${btn('Add', 'addFin')}</div><div class="pg-card-s">${fin}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Who may act for the company</h3>${btn('Add', 'addMandate')}</div><div class="pg-card-s">${mandates}</div></section>
    </div><aside>${money}
      <section class="pg-sec"><div class="pg-sec-h"><h3>Staff</h3></div><div class="pg-card-s">
        ${row('People', '', '<button class="pg-link" data-pg-ws="Members">Open</button>')}
        ${row('Agents', 'Employing an agent gives it a seat and a title. Its Mind stays with whoever made it.', '<button class="pg-link" data-pg-ws="Agents">Open</button>')}
        ${row('Divisions', '', '<button class="pg-link" data-pg-ws="Divisions">Open</button>')}
      </div></section></aside></div>`);
  }
  const post = async (path, body, done) => {
    const r = await api('POST', `/api/orgs/${S.d.org.id}/${path}`, body).catch(() => null);
    if (!r || !r.ok) return why(r, 'That couldn’t be saved.');
    done && toast(done); await load(); return null;
  };
  const addrFields = (id, label, a) => [
    { id: `${id}1`, label: `${label}: street`, max: 200, value: a?.line1 || '' }, { id: `${id}C`, label: 'City', max: 120, value: a?.city || '' },
    { id: `${id}P`, label: 'Postal code', max: 20, value: a?.postalCode || '' }, { id: `${id}K`, label: 'Country', type: 'select', value: a?.country || 'RO', options: COUNTRIES }];
  const addrOf = (v, id) => (v[`${id}1`].trim() ? { line1: v[`${id}1`], city: v[`${id}C`], postalCode: v[`${id}P`], country: v[`${id}K`] } : null);
  const ACT = {
    retry: () => { S.status = 'idle'; S.d = null; load(); },
    async profile() {
      const p = S.d.profile;
      await D().form({ title: 'Company details', sub: 'As the register has them. They appear on what the company issues.', submit: 'Save', fields: [
        { id: 'name', label: 'Legal name', max: 300, value: p.legalName || '' }, { id: 'form', label: 'Legal form', max: 120, value: p.legalForm || '', placeholder: 'e.g. SRL, GmbH, FZ-LLC' }, { id: 'regime', label: 'Governing law', max: 120, value: p.governingRegime || '', placeholder: 'e.g. Romanian law' },
        ...addrFields('o', 'Registered office', p.registeredOffice), ...addrFields('a', 'Central administration', p.centralAdministration)],
      onSubmit: async (v) => { const r = await api('PUT', `/api/orgs/${S.d.org.id}/profile`, { legalName: v.name, legalForm: v.form, governingRegime: v.regime, registeredOffice: addrOf(v, 'o'), centralAdministration: addrOf(v, 'a') }).catch(() => null); if (!r || !r.ok) return why(r, 'That couldn’t be saved.'); await load(); return null; } });
    },
    async addReg() {
      const has = S.d.registrations.some((r) => r.role === 'primary');
      await D().form({ title: 'Add a registration', sub: 'One per register. A company with branches has several.', submit: 'Add', fields: [
        { id: 'j', label: 'Country', type: 'select', value: 'RO', options: COUNTRIES }, { id: 'reg', label: 'Register', required: true, max: 200, placeholder: 'e.g. ONRC, Handelsregister Berlin' }, { id: 'n', label: 'Number', required: true, max: 60, hint: 'Exactly as the register writes it.' }, { id: 'e', label: 'EUID', max: 80 },
        { id: 'r', label: 'Kind', type: 'select', value: has ? 'branch' : 'primary', options: [['primary', 'Primary'], ['branch', 'Branch']] }],
      onSubmit: (v) => post('registrations', { jurisdiction: v.j, register: v.reg, number: v.n, euid: v.e, role: v.r }, 'Registration added') });
    },
    async addTax() {
      await D().form({ title: 'Add a tax number', submit: 'Add', fields: [
        { id: 's', label: 'Kind', type: 'select', value: 'vat', options: [['vat', 'VAT number'], ['tin', 'Tax number (not VAT)'], ['oss', 'OSS / IOSS']] }, { id: 'j', label: 'Issued by', type: 'select', value: 'RO', options: COUNTRIES },
        { id: 'n', label: 'Number', required: true, max: 40, hint: 'For VAT, without the country prefix. XENO adds EL for Greece and XI for Northern Ireland.' }],
      onSubmit: (v) => post('tax', { scheme: v.s, jurisdiction: v.j, prefix: v.s === 'vat' ? (VAT_PREFIX[v.j] || v.j.slice(0, 2)) : undefined, number: v.n }, 'Number added') });
    },
    async addCustoms() { await D().form({ title: 'Add an EORI number', submit: 'Add', size: 'sm', fields: [{ id: 'j', label: 'Issued by', type: 'select', value: 'RO', options: COUNTRIES }, { id: 'n', label: 'Number', required: true, max: 40 }], onSubmit: (v) => post('customs', { jurisdiction: v.j, number: v.n }, 'Number added') }); },
    async addFin() { await D().form({ title: 'Add an LEI', submit: 'Add', size: 'sm', fields: [{ id: 'n', label: 'LEI', required: true, max: 20 }, { id: 'st', label: 'Status', type: 'select', value: 'ISSUED', options: [['ISSUED', 'Issued'], ['LAPSED', 'Lapsed'], ['PENDING_VALIDATION', 'Pending validation'], ['RETIRED', 'Retired'], ['CANCELLED', 'Cancelled'], ['TRANSFERRED', 'Transferred'], ['ANNULLED', 'Annulled'], ['DUPLICATE', 'Duplicate']] }, { id: 'r', label: 'Next renewal', max: 10, placeholder: 'YYYY-MM-DD' }], onSubmit: (v) => post('financial', { number: v.n, status: v.st, nextRenewal: v.r || null }, 'LEI added') }); },
    async addMandate() {
      await D().form({ title: 'Add who may act', sub: 'A director or anyone else with authority to act for the company.', submit: 'Add', fields: [
        { id: 'n', label: 'Name', required: true, max: 200 }, { id: 'role', label: 'Role', required: true, max: 120, placeholder: 'e.g. Director' }, { id: 'auth', label: 'Authority', type: 'select', value: 'sole', options: [['sole', 'Acts alone'], ['joint', 'Acts jointly with others']] },
        { id: 'scope', label: 'What for', type: 'textarea', rows: 2, max: 2000, placeholder: 'Leave empty if it covers everything' }, { id: 'dob', label: 'Date of birth', max: 10, placeholder: 'YYYY-MM-DD', hint: 'Registers ask for it. Only owners and admins see it here.' }, { id: 'until', label: 'Until', max: 10, placeholder: 'YYYY-MM-DD' }],
      onSubmit: (v) => post('mandates', { name: v.n, role: v.role, authority: v.auth, scope: v.scope, dateOfBirth: v.dob || null, validUntil: v.until || null }, 'Added') });
    },
    async remove(arg) {
      const [kind, id] = String(arg).split('|');
      if (!await D().confirm({ title: 'Remove this?', body: 'It comes off the company’s record. Checks already made with VIES are kept.', action: 'Remove' })) return;
      const r = await api('DELETE', `/api/orgs/${S.d.org.id}/${kind}/${id}`).catch(() => null);
      toast(r && r.ok ? 'Removed' : why(r, 'That couldn’t be removed.'));
      await load();
    },
    async check(id) {
      toast('Asking VIES');
      const r = await api('POST', `/api/orgs/${S.d.org.id}/tax/${id}/check`, {}).catch(() => null);
      if (!r || !r.ok) return toast(why(r, 'That couldn’t be checked.'));
      toast(r.d.result === 'valid' ? `Valid${r.d.name ? `: ${r.d.name}` : ''}` : r.d.result === 'invalid' ? 'VIES says this number isn’t valid' : 'The register couldn’t be reached, so this says nothing about the number. Try later.');
      await load();
    },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-co2]'); if (!b || !ACT[b.dataset.co2]) return;
    e.preventDefault(); e.stopPropagation(); ACT[b.dataset.co2](b.dataset.arg);
  }, true);
  const live = window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  live['corpo.company'] = { served: true, work: () => null, badge: () => null, page, state: () => ({ status: S.status }), reload: () => load() };
  P.lazyZone(live['corpo.company'], () => load());
  window.XENO_COMPANY = { served: true, route: (it) => (it === 'Company' ? page() : null) };
})();
