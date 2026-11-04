/* platform-company.js — Corpo › Company on the real platform (services/companyEntity.js, /api/orgs; xeno-company/SPEC.md §4.2).
 *
 *   /workspace/corpo/spaces/company                     the current workspace's legal entity: registrations, identifiers, who may
 *                                                       act for it, and its wallet and seats, read from the workspace's own billing.
 *   /workspace/corpo/spaces/company/invoices            what it has issued, and a new invoice
 *   /workspace/corpo/spaces/company/invoices/<number>   one issued document, to print; corrected only by a credit note
 *   /workspace/corpo/spaces/company/wallet              the wallet and its ledger, read only
 *   /workspace/corpo/spaces/company/activity            what happened in the company
 *
 * This IS XENO Company's surface (owner, 2026-11-04: "not /company but workspace and then company"). People, Agents and
 * Divisions keep their own workspace pages and are linked, never drawn twice. Invoices run on the same /api/orgs backend.
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
  const REGION_NAME = new Intl.DisplayNames(['en'], { type: 'region' });
  // Every country a company can be in, plus the two sub-jurisdictions that carry their own rules. Keep the codes in step with xeno-company's countries.ts.
  const VIEWS = [['overview', 'Overview'], ['invoices', 'Invoices'], ['wallet', 'Wallet'], ['activity', 'Activity']];
  const itemNow = () => String(X()?.S?.item || '');
  const viewOf = () => { const v = itemNow().split('/')[0].toLowerCase(); return VIEWS.some((x) => x[0] === v) ? v : 'overview'; };
  const goItem = (item) => X()?.go?.('zone', { zone: 'company', item });
  const CURRENCIES = (() => { try { return Intl.supportedValuesOf('currency'); } catch { return ['EUR', 'USD', 'GBP']; } })();
  const decimals = (c) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
  const money = (minor, c) => { const d = decimals(c); try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(minor / 10 ** d); } catch { return `${minor} ${c}`; } };
  // An amount as typed, to whole minor units, as text arithmetic: 19.99 * 100 is not 1999 in floating point.
  const toMinor = (text, c) => {
    const s = String(text).trim().replace(/,/g, ''), d = decimals(c), m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m || (m[2] || '').length > d) return null;
    return Number(m[1]) * 10 ** d + Number((m[2] || '').padEnd(d, '0') || 0);
  };
  const day = (t) => { try { return new Date(t).toLocaleDateString(); } catch { return ''; } };
  const COUNTRIES = [['AE-DXB', 'United Arab Emirates (DIFC)'], ['GB-NIR', 'Northern Ireland'], ...'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ').map((c) => [c, REGION_NAME.of(c) || c])].sort((a, b) => a[1].localeCompare(b[1]));
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
    S.d = e.d; S.bill = b && b.ok ? b.d.billing : null; S.inv = S.tx = S.act = S.rev = null; S.status = 'ready'; paint();
  }
  // Each tab reads when it's opened. A failed read says so on the tab, and never reads as an empty list.
  async function loadList(key, path) {
    S[key] = 'loading';
    const r = await api('GET', `/api/orgs/${S.for}/${path}`).catch(() => null);
    S[key] = r && r.ok && Array.isArray(r.d) ? r.d : { error: why(r, 'This couldn’t be loaded.') };
    paint();
  }
  async function loadRevenue() {
    S.rev = 'loading';
    const r = await api('GET', `/api/orgs/${S.for}/revenue`).catch(() => null);
    S.rev = r && r.ok ? r.d : { error: true };
    paint();
  }
  const row = (label, sub, ctl = '') => `<div class="set-row"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="set-ctl">${ctl}</span></div>`;
  const addr = (a) => (a ? [a.line1, a.line2, a.city, a.region, a.postalCode, country(a.country)].filter(Boolean).map(esc).join(', ') : '');
  function page() {
    const h = H(), ws = window.XENO_SCOPE?.uuid?.();
    if (S.for !== ws && S.status !== 'loading') load();
    const head = (acts = '', title = 'Company') => h.head({ title, sub: 'The legal entity behind this workspace: where it’s registered, its numbers, and who may act for it.', acts });
    const wait = h.box('refresh', 'Loading', '', '', 'sm');
    const list = (key, path, draw) => {
      if (S[key] === null) { loadList(key, path); return wait; }
      if (S[key] === 'loading') return wait;
      if (S[key].error) return h.box('x', 'This couldn’t be loaded', esc(S[key].error), h.btn('Try again', `data-co2="reread" data-arg="${key}"`, true), 'sm');
      return draw(S[key]);
    };
    if (S.status === 'noscope') return h.page(head() + h.box('building', 'No workspace to show', 'A company’s details belong to a workspace, and yours didn’t load.', h.btn('Try again', 'data-co2="retry"', true), 'sm'));
    if (S.status === 'loading' || S.status === 'idle') return h.page(head() + h.box('refresh', 'Loading the company', '', '', 'sm'));
    if (S.status !== 'ready') return h.page(head() + h.box('x', 'The company couldn’t be loaded', 'Nothing was changed.', h.btn('Try again', 'data-co2="retry"', true), 'sm'));
    const d = S.d, c = d.canManage, btn = (label, a, arg = '', ghost = true) => (c ? h.btn(label, `data-co2="${a}" data-arg="${esc(arg)}"`, ghost) : '');
    if (d.org.kind === 'personal') return h.page(head() + h.box('building', 'This is your personal workspace', 'A company has its own people, wallet and legal entity. Create one, or switch to one you belong to.', h.btn('Create a company', 'data-xa="newCompany"', false, 'plus')));
    const p = d.profile, solo = p.entityKind === 'sole_proprietor', noun = solo ? 'business' : 'company', drop = (kind, id) => btn('Remove', 'remove', `${kind}|${id}`), view = viewOf(), bar = h.tabs(VIEWS, view, 'data-co2-view'), name = p.legalName || d.org.name;
    if (view === 'invoices') return invoices(h, d, c, list, head, bar, name);
    if (view === 'activity') return h.page(head('', name) + bar + list('act', 'activity', (rows) => (rows.length ? h.table(['Who or what', 'What happened', 'When'], rows.map((a) => h.tr('', [esc([a.subject, a.detail].filter(Boolean).join(' · ')), esc(ACTIVITY[a.kind] || a.kind), esc(day(a.at))]))) : h.box('clock', 'Nothing yet', 'What happens in the company appears here.', '', 'sm'))));
    const regs = d.registrations.map((r) => row(`${esc(country(r.jurisdiction))} ${r.role === 'primary' ? '<span class="set-tag on">Primary</span>' : '<span class="set-tag">Branch</span>'}`, `${esc(r.register)} · ${esc(r.number)}${r.euid ? ` · EUID ${esc(r.euid)}` : ''}`, drop('registrations', r.id))).join('') || '<p class="pg-dim set-p">Not registered anywhere yet.</p>';
    const tax = d.tax.map((t) => row(`${t.scheme === 'vat' ? esc(t.prefix) : ''}${esc(t.number)} <span class="set-tag">${t.scheme === 'vat' ? 'VAT' : t.scheme === 'oss' ? 'OSS' : 'Tax'}</span>${t.check ? ` <span class="set-tag${t.check.result === 'valid' ? ' on' : ''}">${esc(CHECK[t.check.result])}</span>` : ''}`,
      `${esc(country(t.jurisdiction))}${t.check ? ` · checked ${esc(new Date(t.check.at).toLocaleDateString())}${t.check.consultationNumber ? ` · consultation ${esc(t.check.consultationNumber)}` : ''}` : ''}`,
      `${t.scheme === 'vat' ? btn('Check with VIES', 'check', t.id) : ''} ${drop('tax', t.id)}`)).join('') || '<p class="pg-dim set-p">No tax numbers yet.</p>';
    const customs = d.customs.map((x) => row(esc(x.number), `EORI · ${esc(country(x.jurisdiction))}`, drop('customs', x.id))).join('') || `<p class="pg-dim set-p">None. Add an EORI when the ${noun} imports or exports.</p>`;
    const fin = d.financial.map((x) => row(`${esc(x.number)} <span class="set-tag${x.status === 'ISSUED' ? ' on' : ''}">${esc(x.status)}</span>`, `LEI${x.nextRenewal ? ` · renews ${esc(x.nextRenewal)}` : ''}`, drop('financial', x.id))).join('') || `<p class="pg-dim set-p">None. Add an LEI when the ${noun} trades on financial markets.</p>`;
    const mandates = d.mandates.map((m) => row(`${esc(m.name)} <span class="set-tag">${m.authority === 'sole' ? 'Acts alone' : 'Acts jointly'}</span>`, [esc(m.role), m.scope ? esc(m.scope) : '', m.validUntil ? `until ${esc(m.validUntil)}` : '', m.dateOfBirth ? `born ${esc(m.dateOfBirth)}` : ''].filter(Boolean).join(' · '), drop('mandates', m.id))).join('') || '<p class="pg-dim set-p">Nobody recorded yet.</p>';
    const b = S.bill;
    const walletCard = b ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Wallet</h3></div><div class="pg-card-s" data-co2-wallet>${row(`${(b.wallet.available_credits || 0).toLocaleString()} credits`, `${b.wallet.pending_credits ? `${b.wallet.pending_credits.toLocaleString()} reserved for work running now · ` : ''}${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}${b.wallet.is_frozen ? ' · frozen' : ''}`)}</div></section>` : '';
    if (view === 'wallet') return h.page(head('', name) + bar + (walletCard || h.box('x', 'The wallet couldn’t be loaded', 'Nothing was changed.', '', 'sm')) + `<section class="pg-sec"><div class="pg-sec-h"><h3>Ledger</h3></div>${list('tx', 'transactions', (rows) => (rows.length ? h.table(['What', 'Kind', 'When', 'Credits'], rows.map((t) => h.tr('', [esc(t.description || ''), esc(t.kind), esc(day(t.at)), esc(`${t.kind === 'grant' ? '+' : '−'}${t.amount.toLocaleString()}`)]))) : '<p class="pg-dim set-p">No entries yet. Credits appear here as the company’s products spend them.</p>'))}</section>`);
    return h.page(head(btn('Edit details', 'profile', '', true), esc(name)) + bar + `<div class="pg-cols"><div>`
      + `
      <section class="pg-sec"><div class="pg-sec-h"><h3>${solo ? 'Business' : 'Legal entity'}</h3></div><div class="pg-card-s">
        ${row('What it is', solo ? 'You and the business are the same legal person, so its debts and contracts are yours.' : '', solo ? 'Sole proprietor' : 'Company')}
        ${row(solo ? 'Owner' : 'Legal name', '', esc(p.legalName || '') || '<span class="pg-dim">Not set</span>')}
        ${solo ? row('Trading as', '', esc(d.org.name)) : ''}
        ${row(solo ? 'Business type' : 'Legal form', p.governingRegime ? `Under ${esc(p.governingRegime)}` : '', esc(p.legalForm || '') || '<span class="pg-dim">Not set</span>')}
        ${row(solo ? 'Business address' : 'Registered office', '', addr(p.registeredOffice) || '<span class="pg-dim">Not set</span>')}
        ${solo ? '' : row('Central administration', 'Where it’s actually run. It can differ from the registered office.', addr(p.centralAdministration) || '<span class="pg-dim">Not set</span>')}
        ${row('Tax on invoices', p.taxStatus === 'small_business' ? esc(p.taxStatusNote || '') : '', p.taxStatus === 'small_business' ? 'Small business, no tax charged' : 'Charged per line')}
      </div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Getting paid</h3>${btn(p.paymentAccount ? 'Change' : 'Add', 'bank')}</div><div class="pg-card-s">${p.paymentAccount ? row(esc(p.paymentAccount.account), [p.paymentAccount.name, p.paymentAccount.bic].filter(Boolean).map(esc).join(' · ')) : '<p class="pg-dim set-p">No account yet. Add one and it goes on every invoice, so customers know where to pay.</p>'}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Registrations</h3>${btn('Add', 'addReg')}</div><div class="pg-card-s">${regs}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Tax</h3>${btn('Add', 'addTax')}</div><div class="pg-card-s">${tax}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Customs</h3>${btn('Add', 'addCustoms')}</div><div class="pg-card-s">${customs}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Financial markets</h3>${btn('Add', 'addFin')}</div><div class="pg-card-s">${fin}</div></section>
      <section class="pg-sec"><div class="pg-sec-h"><h3>Who may act for the ${noun}</h3>${btn('Add', 'addMandate')}</div><div class="pg-card-s">${mandates}</div></section>
    </div><aside>${walletCard}
      <section class="pg-sec"><div class="pg-sec-h"><h3>Staff</h3></div><div class="pg-card-s">
        ${row('People', '', '<button class="pg-link" data-pg-ws="Members">Open</button>')}
        ${row('Agents', 'Employing an agent gives it a seat and a title. Its Mind stays with whoever made it.', '<button class="pg-link" data-pg-ws="Agents">Open</button>')}
        ${row('Divisions', '', '<button class="pg-link" data-pg-ws="Divisions">Open</button>')}
      </div></section></aside></div>`);
  }
  const ACTIVITY = { 'company.created': 'Company created', 'member.invited': 'Invited', 'member.joined': 'Joined', 'member.removed': 'Removed', 'member.role_changed': 'Role changed', 'invite.revoked': 'Invitation withdrawn', 'agent.employed': 'Agent employed', 'agent.capabilities_changed': 'Agent’s capabilities changed', 'invoice.issued': 'Invoice issued', 'invoice.credited': 'Invoice credited', 'registration.verified': 'Registration confirmed' };
  const statusOf = (i) => (i.invoice.typeCode === '381' ? 'Credit note' : i.creditedBy ? 'Reversed' : 'Issued');
  /** Why this company can't issue yet, the same two facts the server refuses on. */
  function blocked(d) {
    const solo = d.profile.entityKind === 'sole_proprietor';
    if (!d.registration) return solo ? ['Add your tax number first', 'An invoice names who is selling by their tax number.', ['Add a tax number', 'data-co2="addTax"']] : ['Add a registration or a tax number first', 'An invoice names the company by its legal identity.', ['Add a registration', 'data-co2="addReg"']];
    const o = d.registration.registeredOffice;
    if (!o?.line1 || !o?.city || !/^[A-Z]{2}$/.test(o?.country || '')) return [`Add the ${solo ? 'business address' : 'registered office'} first`, 'It goes on every invoice.', ['Edit details', 'data-co2="profile"']];
    return null;
  }
  /** A small business's year so far, against the figure it set. Only what's invoiced here counts, and the page says so. */
  function limitCard(h, d, c) {
    if (d.profile.taxStatus !== 'small_business') return '';
    if (S.rev == null) { loadRevenue(); return ''; }
    if (S.rev === 'loading') return '';
    if (S.rev.error) return `<section class="pg-sec"><div class="pg-card-s">${row('This year’s total couldn’t be loaded', '', h.btn('Try again', 'data-co2="rereadRev"', true))}</div></section>`;
    const l = d.profile.revenueLimit, set = c ? h.btn(l ? 'Change limit' : 'Set a limit', 'data-co2="limit"', true) : '';
    const others = S.rev.byCurrency.filter((x) => !l || x.currency !== l.currency);
    const note = 'Only invoices issued here count. Add what you sold elsewhere yourself.';
    if (!l) return `<section class="pg-sec"><div class="pg-sec-h"><h3>Small-business limit</h3>${set}</div><div class="pg-card-s">${row('No limit set', others.length ? `${others.map((x) => esc(money(x.net, x.currency))).join(' · ')} invoiced in ${S.rev.year}. ${note}` : 'Set your country’s limit to see how close this year is.')}</div></section>`;
    const net = S.rev.byCurrency.find((x) => x.currency === l.currency)?.net || 0, share = Math.round(net / l.amount * 100);
    return `<section class="pg-sec"><div class="pg-sec-h"><h3>Small-business limit</h3>${set}</div><div class="pg-card-s" data-co2-limit>${row(`${esc(money(net, l.currency))} of ${esc(money(l.amount, l.currency))} ${share >= 80 ? `<span class="set-tag">${share}%</span>` : ''}`, `Invoiced in ${S.rev.year}, net. ${note}${others.length ? ` Also ${others.map((x) => esc(money(x.net, x.currency))).join(', ')}, not counted.` : ''}`)}</div></section>`;
  }
  function invoices(h, d, c, list, head, bar, name) {
    const number = itemNow().split('/')[1], stop = blocked(d), make = c && !stop ? h.btn('New invoice', 'data-co2="newInvoice"', false, 'plus') : '', solo = d.profile.entityKind === 'sole_proprietor', noun = solo ? 'business' : 'company', j = d.registration?.jurisdiction;
    if (!number) {
      const own = { RO: 'Romania’s', DE: 'Germany’s' }[j];
      const scope = !j ? 'Checked against the common invoice rules.' : own ? `Checked against the common invoice rules and ${own} own.` : `Checked against the common invoice rules. Local rules for ${esc(country(j))} weren’t checked.`;
      return h.page(head(make, name) + bar + limitCard(h, d, c) + list('inv', 'invoices', (rows) => {
        if (!rows.length) return h.box('doc', stop ? stop[0] : 'No invoices yet', stop ? stop[1] : `What the ${noun} issues appears here, numbered without gaps.`, stop && c ? h.btn(stop[2][0], stop[2][1], true) : make);
        return h.table(['Invoice', 'Customer', 'Issued', 'Amount', 'Status'], rows.map((i) => h.tr(`data-co2-open="${esc(i.number)}"`, [`<b>${esc(i.number)}</b>`, esc(i.invoice.buyer.name), esc(day(i.issuedAt)), esc(money(i.invoice.totals.payableAmount, i.invoice.currency)), esc(statusOf(i))])));
      }) + `<p class="pg-dim set-p">${scope} Meeting local tax law is the ${noun}’s responsibility, and XENO sends invoices to no tax authority.</p>`);
    }
    const body = list('inv', 'invoices', (rows) => {
      const i = rows.find((x) => x.number === number);
      if (!i) return h.page(head('', name) + bar + h.box('x', 'No such invoice', `This ${noun} has no invoice ${esc(number)}.`, h.btn('All invoices', 'data-co2-view="invoices"', true), 'sm'));
      const v = i.invoice, cur = v.currency, party = (x) => [x.name, x.tradingName && x.tradingName !== x.name ? `trading as ${x.tradingName}` : '', x.address?.line1, [x.address?.postalCode, x.address?.city].filter(Boolean).join(' '), x.address?.countrySubdivision, x.address?.country ? country(x.address.country) : '', x.vatId, x.taxRegistrationId ? `Tax number ${x.taxRegistrationId}` : '', x.legalRegistrationId].filter(Boolean).map(esc).join('<br>');
      const canCredit = c && v.typeCode !== '381' && !i.creditedBy;
      const acts = h.btn('Print or PDF', `data-co2="print" data-arg="${esc(number)}"`, false) + h.btn('Download UBL', `data-co2="ubl" data-arg="${esc(number)}"`, true) + (canCredit ? h.btn('Credit note', `data-co2="credit" data-arg="${esc(number)}"`, true) : '');
      return h.page(head(acts, number) + bar + `<div class="pg-cols"><div>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Lines</h3></div>${h.table(['Item', 'Quantity', 'Unit price', 'Tax', 'Amount'], v.lines.map((l) => h.tr('', [esc(l.itemName), esc(l.quantity), esc(money(l.unitPrice, cur)), esc(l.vatCategory === 'S' ? `${l.vatRate}%` : 'None'), esc(money(l.netAmount, cur))])))}</section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Totals</h3></div><div class="pg-card-s">
          ${row('Net', '', esc(money(v.totals.taxExclusiveAmount, cur)))}${row('Tax', v.vatBreakdown.map((b) => b.exemptionReason).filter(Boolean).map(esc).join(' · '), esc(money(v.totals.taxAmount, cur)))}${row('<b>To pay</b>', '', `<b>${esc(money(v.totals.payableAmount, cur))}</b>`)}
        </div></section>
        ${v.note ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Note</h3></div><p class="set-p">${esc(v.note)}</p></section>` : ''}
      </div><aside>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Status</h3></div><div class="pg-card-s">${row(esc(statusOf(i)), `Issued ${esc(day(i.issuedAt))}${v.dueDate ? ` · due ${esc(v.dueDate)}` : ''}`)}${v.deliveryDate ? row('Supplied', '', esc(v.deliveryDate)) : ''}${v.invoicingPeriod ? row('Supplied', '', esc([v.invoicingPeriod.start, v.invoicingPeriod.end].filter(Boolean).join(' to '))) : ''}${i.creditedBy ? row('Reversed by', '', `<button class="pg-link" data-co2-open="${esc(i.creditedBy)}">${esc(i.creditedBy)}</button>`) : ''}${v.precedingInvoice ? row('Reverses', '', `<button class="pg-link" data-co2-open="${esc(v.precedingInvoice.id)}">${esc(v.precedingInvoice.id)}</button>`) : ''}</div></section>
        ${v.payment ? `<section class="pg-sec"><div class="pg-sec-h"><h3>Paid to</h3></div><p class="set-p">${[v.payment.accountName, v.payment.accountId, v.payment.bic].filter(Boolean).map(esc).join('<br>')}</p></section>` : ''}
        <section class="pg-sec"><div class="pg-sec-h"><h3>Customer</h3></div><p class="set-p">${party(v.buyer)}</p></section>
        <section class="pg-sec"><div class="pg-sec-h"><h3>Seller</h3></div><p class="set-p">${party(v.seller)}</p></section>
      </aside></div>`);
    });
    return Array.isArray(S.inv) ? body : h.page(head('', number) + bar + body);
  }
  const post = async (path, body, done) => {
    const r = await api('POST', `/api/orgs/${S.d.org.id}/${path}`, body).catch(() => null);
    if (!r || !r.ok) return why(r, 'That couldn’t be saved.');
    done && toast(done); await load(); return null;
  };
  const addrFields = (id, label, a) => [
    { id: `${id}1`, label: `${label}: street`, max: 200, value: a?.line1 || '' }, { id: `${id}C`, label: 'City', max: 120, value: a?.city || '' },
    { id: `${id}R`, label: 'State or region', max: 120, value: a?.region || '' }, { id: `${id}P`, label: 'Postal code', max: 20, value: a?.postalCode || '' }, { id: `${id}K`, label: 'Country', type: 'select', value: a?.country || HOME() || '', options: PICK() }];
  const addrOf = (v, id) => (v[`${id}1`].trim() ? { line1: v[`${id}1`], city: v[`${id}C`], region: v[`${id}R`] || undefined, postalCode: v[`${id}P`] || '', country: v[`${id}K`] } : null);
  // No country is assumed: it follows what the company has already said about itself, and otherwise the person chooses.
  const HOME = () => S.d?.registration?.jurisdiction || S.d?.registrations?.[0]?.jurisdiction || S.d?.profile?.registeredOffice?.country || '';
  const PICK = () => [['', 'Choose…'], ...COUNTRIES];
  const ACT = {
    retry: () => { S.status = 'idle'; S.d = null; load(); },
    reread: (key) => { S[key] = null; paint(); },
    rereadRev: () => { S.rev = null; paint(); },
    async print(number) {
      // Opened before the wait: a tab opened after one is a popup to the browser.
      const w = window.open('', '_blank');
      const r = await api('GET', `/api/orgs/${S.d.org.id}/invoices/${encodeURIComponent(number)}/document`).catch(() => null);
      if (!r || !r.ok) { w?.close(); return toast(why(r, 'The invoice couldn’t be opened.')); }
      if (!w) return toast('Your browser blocked the new tab. Allow it for this site and try again.');
      w.document.open(); w.document.write(r.d.html); w.document.close(); w.focus(); w.print();
    },
    async bank() {
      const a = S.d.profile.paymentAccount;
      await D().form({ title: 'Where you get paid', sub: 'This goes on every invoice from now on. Invoices already issued stay as they are.', submit: 'Save', fields: [
        { id: 'acc', label: 'IBAN or account number', max: 45, value: a?.account || '', hint: 'Leave empty to take it off future invoices.' }, { id: 'bic', label: 'BIC', max: 11, value: a?.bic || '' }, { id: 'name', label: 'Account holder', max: 200, value: a?.name || '', placeholder: S.d.profile.legalName || '' }],
      onSubmit: async (v) => { const r = await api('PUT', `/api/orgs/${S.d.org.id}/payment-account`, { account: v.acc, bic: v.bic, name: v.name }).catch(() => null); if (!r || !r.ok) return why(r, 'That couldn’t be saved.'); toast('Saved'); await load(); return null; } });
    },
    async limit() {
      const l = S.d.profile.revenueLimit;
      await D().form({ title: 'Small-business limit', sub: 'The yearly figure you want to stay under. Every country sets its own, so check yours with your tax office or adviser.', submit: 'Save', size: 'sm', fields: [
        { id: 'cur', label: 'Currency', type: 'select', value: l?.currency || 'EUR', options: CURRENCIES.map((c) => [c, c]) }, { id: 'amt', label: 'Limit', max: 20, value: l ? (l.amount / 10 ** decimals(l.currency)).toFixed(decimals(l.currency)) : '', placeholder: '25000.00', hint: 'Leave empty to remove it.' }],
      onSubmit: async (v) => { const amount = v.amt ? toMinor(v.amt, v.cur) : null; if (v.amt && !amount) return `“${v.amt}” isn’t an amount in ${v.cur}.`; const r = await api('PUT', `/api/orgs/${S.d.org.id}/revenue-limit`, { amount, currency: v.cur }).catch(() => null); if (!r || !r.ok) return why(r, 'That couldn’t be saved.'); toast('Saved'); await load(); return null; } });
    },
    async newInvoice() {
      const o = S.d.registration?.registeredOffice?.country || '', last = Array.isArray(S.inv) && S.inv[0]?.invoice.currency, small = S.d.profile.taxStatus === 'small_business';
      const iso = (t) => new Date(t).toISOString().slice(0, 10), DATE = /^\d{4}-\d{2}-\d{2}$/, realDate = (x) => DATE.test(x) && !Number.isNaN(Date.parse(x)), said = /[.!?]$/.test(S.d.profile.taxStatusNote || '') ? S.d.profile.taxStatusNote : `${S.d.profile.taxStatusNote}.`;
      await D().form({ title: 'New invoice', sub: `${small ? `No tax is charged. It will say: ${said}` : `The seller is this ${S.d.profile.entityKind === 'sole_proprietor' ? 'business' : 'company'}.`} Once issued it can’t be changed, only reversed by a credit note.`, submit: 'Review', fields: [
        { id: 'b', label: 'Customer', required: true, max: 200 }, { id: 'bt', label: 'Customer’s tax number', max: 40 },
        { id: 'bs', label: 'Street and number', required: true, max: 200 }, { id: 'bp', label: 'Postal code', max: 20 },
        { id: 'bc', label: 'City', required: true, max: 120 }, { id: 'br', label: 'State or region', max: 120 },
        { id: 'bk', label: 'Country', type: 'select', value: o, options: [['', 'Choose…'], ...COUNTRIES.filter(([c]) => c.length === 2)], required: true },
        { id: 'cur', label: 'Currency', type: 'select', value: last || 'EUR', options: CURRENCIES.map((c) => [c, c]) },
        { id: 'item', label: 'Item', required: true, max: 200 }, { id: 'q', label: 'Quantity', value: '1', max: 12 }, { id: 'price', label: 'Unit price', required: true, max: 20, placeholder: '100.00' },
        ...(small ? [] : [{ id: 'rate', label: 'Tax rate %', value: '0', max: 6 }, { id: 'reason', label: 'If no tax: why', max: 200, hint: 'An invoice that charges no tax has to say why.' }]),
        { id: 'more', label: 'More lines', type: 'textarea', rows: 2, max: 2000, placeholder: small ? 'Item; quantity; unit price' : 'Item; quantity; unit price; tax %', hint: 'One per line.' },
        { id: 'sup', label: 'Date of supply', required: true, max: 10, value: iso(Date.now()), placeholder: 'YYYY-MM-DD', hint: 'When you delivered it. For work over a period, the first day.' }, { id: 'until', label: 'Supplied until', max: 10, placeholder: 'YYYY-MM-DD', hint: 'Only for a period.' },
        { id: 'due', label: 'Due date', required: true, max: 10, value: iso(Date.now() + 14 * 86400000), placeholder: 'YYYY-MM-DD' }, { id: 'note', label: 'Note', max: 500 },
      ], onSubmit: async (v) => {
        const cur = v.cur, lines = [], line = (item, q, price, rate) => {
          const unitPrice = toMinor(price, cur), quantity = Number(q), r = Number(rate || 0);
          if (unitPrice === null) return `“${price}” isn’t an amount in ${cur} (${decimals(cur)} decimals).`;
          if (!(quantity > 0)) return `“${q}” isn’t a quantity.`;
          if (!(r >= 0 && r <= 100)) return `“${rate}” isn’t a tax rate.`;
          if (small) { lines.push({ itemName: item, quantity, unitPrice }); return null; }
          if (r === 0 && !v.reason) return 'Say why no tax is charged.';
          lines.push({ itemName: item, quantity, unitPrice, ...(r > 0 ? { vatCategory: 'S', vatRate: r } : { vatCategory: 'O', exemptionReason: v.reason }) });
          return null;
        };
        const bad = line(v.item, v.q, v.price, v.rate) || v.more.split('\n').map((x) => x.trim()).filter(Boolean).reduce((e, x) => { if (e) return e; const [a, b, p, r] = x.split(';').map((y) => y.trim()); return a && b && p ? line(a, b, p, r) : `Write “${x}” as: item; quantity; unit price${small ? '' : '; tax %'}.`; }, null);
        if (bad) return bad;
        if (!realDate(v.sup)) return 'Write the date of supply as YYYY-MM-DD.';
        if (v.until && !realDate(v.until)) return 'Write the last day as YYYY-MM-DD.';
        if (v.until && v.until < v.sup) return 'The period can’t end before it starts.';
        if (!realDate(v.due)) return 'Write the due date as YYYY-MM-DD.';
        const total = lines.reduce((n, l) => { const net = Math.round(l.quantity * l.unitPrice); return n + net + Math.round(net * (l.vatRate || 0) / 100); }, 0);
        if (!await D().confirm({ title: `Issue this invoice for ${money(total, cur)}?`, body: `To ${v.b}. It takes the next number and can’t be changed afterwards.${S.d.profile.paymentAccount ? '' : ' It won’t say where to pay: add your account under Getting paid first if it should.'}`, action: 'Issue invoice', danger: false })) return 'Not issued.';
        const r = await api('POST', `/api/orgs/${S.d.org.id}/invoices`, { currency: cur, buyer: { name: v.b, ...(v.bt ? { vatId: v.bt } : {}), address: { line1: v.bs, city: v.bc, ...(v.bp ? { postalCode: v.bp } : {}), ...(v.br ? { countrySubdivision: v.br } : {}), country: v.bk } }, lines, dueDate: v.due, ...(v.until ? { invoicingPeriod: { start: v.sup, end: v.until } } : { deliveryDate: v.sup }), ...(v.note ? { note: v.note } : {}) }).catch(() => null);
        if (!r || !r.ok) return why(r, 'That invoice couldn’t be issued.');
        toast(`Issued ${r.d.number}`); S.inv = null; S.act = null; goItem(`invoices/${r.d.number}`); return null;
      } });
    },
    async credit(number) {
      if (!await D().confirm({ title: `Reverse ${number}?`, body: 'This issues a credit note for the whole invoice. The original isn’t changed, and both stay on record.', action: 'Issue credit note' })) return;
      const r = await api('POST', `/api/orgs/${S.d.org.id}/invoices/${encodeURIComponent(number)}/credit`, {}).catch(() => null);
      if (!r || !r.ok) return toast(why(r, 'That couldn’t be issued.'));
      toast(`Issued ${r.d.number}`); S.inv = null; S.act = null; goItem(`invoices/${r.d.number}`);
    },
    ubl(number) {
      const i = (Array.isArray(S.inv) ? S.inv : []).find((x) => x.number === number); if (!i) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([i.ubl], { type: 'application/xml' })); a.download = `${number}.xml`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async profile() {
      const p = S.d.profile;
      await D().form({ title: 'Details', sub: 'As the register or tax office has them. They appear on what this business issues.', submit: 'Save', fields: [
        { id: 'kind', label: 'What it is', type: 'choice', cols: 2, value: p.entityKind, options: [['company', 'Company', 'Its own legal person: an SRL, a GmbH, an LLC.'], ['sole_proprietor', 'Sole proprietor', 'One person trading: a PFA, a Kleingewerbe, a sole trader.']] },
        { id: 'name', label: 'Legal name', max: 300, value: p.legalName || '', hint: 'For a sole proprietor, the owner’s full name.' }, { id: 'form', label: 'Legal form', max: 120, value: p.legalForm || '', placeholder: 'e.g. SRL, GmbH, FZ-LLC, PFA, Kleingewerbe' }, { id: 'regime', label: 'Governing law', max: 120, value: p.governingRegime || '', placeholder: 'e.g. Romanian law' },
        { id: 'tax', label: 'Tax on invoices', type: 'choice', cols: 2, value: p.taxStatus, options: [['standard', 'Charged per line', 'Each line has its own rate.'], ['small_business', 'Small business, none', 'Exempt, with one note on every invoice.']], hint: 'Change this the day the business stops being exempt. Invoices already issued stay as they are.' },
        { id: 'note', label: 'What invoices say when no tax is charged', max: 300, value: p.taxStatusNote || '', placeholder: 'e.g. Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG', hint: 'Use your country’s own wording. Your tax office or adviser can confirm it.' },
        ...addrFields('o', p.entityKind === 'sole_proprietor' ? 'Business address' : 'Registered office', p.registeredOffice), ...addrFields('a', 'Central administration', p.centralAdministration)],
      onSubmit: async (v) => { if (v.tax === 'small_business' && !v.note.trim()) return 'Say what invoices should state about tax.'; const r = await api('PUT', `/api/orgs/${S.d.org.id}/profile`, { entityKind: v.kind, taxStatus: v.tax, taxStatusNote: v.note, legalName: v.name, legalForm: v.form, governingRegime: v.regime, registeredOffice: addrOf(v, 'o'), centralAdministration: addrOf(v, 'a') }).catch(() => null); if (!r || !r.ok) return why(r, 'That couldn’t be saved.'); await load(); return null; } });
    },
    async addReg() {
      const has = S.d.registrations.some((r) => r.role === 'primary');
      await D().form({ title: 'Add a registration', sub: 'One per register. A company with branches has several.', submit: 'Add', fields: [
        { id: 'j', label: 'Country', type: 'select', value: HOME(), options: PICK() }, { id: 'reg', label: 'Register', required: true, max: 200, placeholder: 'e.g. ONRC, Handelsregister Berlin' }, { id: 'n', label: 'Number', required: true, max: 60, hint: 'Exactly as the register writes it.' }, { id: 'e', label: 'EUID', max: 80 },
        { id: 'r', label: 'Kind', type: 'select', value: has ? 'branch' : 'primary', options: [['primary', 'Primary'], ['branch', 'Branch']] }],
      onSubmit: (v) => post('registrations', { jurisdiction: v.j, register: v.reg, number: v.n, euid: v.e, role: v.r }, 'Registration added') });
    },
    async addTax() {
      await D().form({ title: 'Add a tax number', submit: 'Add', fields: [
        { id: 's', label: 'Kind', type: 'select', value: 'vat', options: [['vat', 'VAT number'], ['tin', 'Tax number (not VAT)'], ['oss', 'OSS / IOSS']] }, { id: 'j', label: 'Issued by', type: 'select', value: HOME(), options: PICK() },
        { id: 'n', label: 'Number', required: true, max: 40, hint: 'For VAT, without the country prefix. XENO adds EL for Greece and XI for Northern Ireland.' }],
      onSubmit: (v) => post('tax', { scheme: v.s, jurisdiction: v.j, prefix: v.s === 'vat' ? (VAT_PREFIX[v.j] || v.j.slice(0, 2)) : undefined, number: v.n }, 'Number added') });
    },
    async addCustoms() { await D().form({ title: 'Add an EORI number', submit: 'Add', size: 'sm', fields: [{ id: 'j', label: 'Issued by', type: 'select', value: HOME(), options: PICK() }, { id: 'n', label: 'Number', required: true, max: 40 }], onSubmit: (v) => post('customs', { jurisdiction: v.j, number: v.n }, 'Number added') }); },
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
    const tab = e.target.closest('[data-co2-view]');
    if (tab) { e.preventDefault(); e.stopPropagation(); return goItem(tab.dataset.co2View === 'overview' ? '' : tab.dataset.co2View); }
    const row = e.target.closest('[data-co2-open]');
    if (row) { e.preventDefault(); e.stopPropagation(); return goItem(`invoices/${row.dataset.co2Open}`); }
    const b = e.target.closest('[data-co2]'); if (!b || !ACT[b.dataset.co2]) return;
    e.preventDefault(); e.stopPropagation(); ACT[b.dataset.co2](b.dataset.arg);
  }, true);
  document.addEventListener('keydown', (e) => { const row = e.key === 'Enter' && e.target.closest?.('[data-co2-open]'); if (row) goItem(`invoices/${row.dataset.co2Open}`); });
  const live = window.XENO_ZONE_LIVE = window.XENO_ZONE_LIVE || {};
  live['corpo.company'] = { served: true, items: true, label: (item) => { const n = String(item || '').split('/')[1]; return n ? `No. ${n.split('-').pop()}` : ''; }, work: () => null, badge: () => null, page, state: () => ({ status: S.status, view: viewOf() }), reload: () => load() };
  P.lazyZone(live['corpo.company'], () => load());
  window.XENO_COMPANY = { served: true, route: (it) => (it === 'Company' ? page() : null) };
})();
