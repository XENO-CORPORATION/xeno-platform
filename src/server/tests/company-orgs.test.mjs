/**
 * XENO Company's backend on real Postgres (services/companyOrgs.js).
 *
 * What the dashboard should do is proved by xeno-company's own contract suite (scripts/real-stack/walk-company.mjs). This is
 * what that suite can't reach: the rules that must hold whoever asks, however they ask.
 *
 *   - a stranger is told a company doesn't exist; a member reads and can't change; an agent never issues or founds
 *   - invoice numbers are gapless: a refused invoice takes no number, and invoices issued at once get consecutive ones
 *   - an issued invoice can't be edited, deleted or truncated by anyone, and takes a credit note exactly once
 *   - a workspace that issued invoices can't be deleted out from under them
 *   - D18: an agent's role is a ReBAC tuple, the employment row holds no authority, and capabilities live on its definition
 *   - a register that is down leaves an `unverifiable` record and an unverified company, never an invalid one
 *   - the company's wallet is read, never written, by anything here
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/company-orgs.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as company from '../services/companyEntity.js';
import * as orgs from '../services/companyOrgs.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const tag = `co${process.pid}`;
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s])).rows[0].id;
const refused = async (fn, code) => { try { await fn(); } catch (e) { assert.ok(e instanceof orgs.CompanyError, `expected a refusal, got ${e.message}`); assert.equal(e.code, code); return true; } return false; };
const dbRefused = async (sql, params) => { try { await pool.query(sql, params); return false; } catch (e) { return e.code === '23514' || e.code === '23503'; } };

// A valid Romanian tax id, and a register answering as AnafConnector does (county in `region`).
const CUI = '14399840';
const entity = { legalName: 'ACME TRADING SRL', registryId: 'J40/1/2020', vatRegistered: true, active: true, address: { line1: 'Str. A 1', city: 'Cluj-Napoca', postalCode: '400001', region: 'Cluj', country: 'RO' } };
const evidence = { checkedAt: '2026-11-04T00:00:00.000Z', asOf: '2026-11-04', source: 'stub', reference: 'ref-1' };
const register = (status) => () => ({ lookupEntity: async () => (status === 'throws' ? (() => { throw new Error('socket hang up'); })() : status === 'found' ? { status, evidence, entity } : { status, evidence }) });
const BUYER = { name: 'Client SA', vatId: 'RO6860713', address: { line1: 'Str. B 2', city: 'Cluj-Napoca', postalCode: '400002', countrySubdivision: 'Cluj', country: 'RO' } };
const DUE = '2026-12-01';
const LINE = { quantity: 2, unitPrice: 5000, itemName: 'Consulting', vatCategory: 'S', vatRate: 21 };

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), member = await user('member'), stranger = await user('stranger'), bot = await user('bot');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [bot, owner]);
  const O = { id: owner }, M = { id: member }, B = { id: bot }, S = { id: stranger };

  // founding
  ok(await refused(() => orgs.createOrg(pool, B, { name: 'Bot Co', slug: `${tag}-bot` }), 'person_only'), 'an agent can’t found a company');
  ok(await refused(() => orgs.createOrg(pool, O, { name: 'X', slug: `${tag}-bad`, registration: { jurisdiction: 'RO', legalForm: 'SRL', nationalId: '14399841' } }), 'invalid_national_id'), 'a tax id that fails its checksum is refused');
  ok((await pool.query('SELECT count(*)::int n FROM workspaces WHERE slug = $1', [`${tag}-bad`])).rows[0].n === 0, 'and nothing was created');

  const down = await orgs.createOrg(pool, O, { name: 'Down Co', slug: `${tag}-down`, registration: { jurisdiction: 'RO', legalForm: 'SRL', nationalId: CUI } }, { connector: register('throws') });
  ok(down.registration.identifiers[0].value === CUI && !down.registrationEvidence, 'a register that is down still founds the company, unverified');
  const kept = (await pool.query('SELECT result FROM org_identifier_checks WHERE workspace_id = $1', [down.id])).rows.map((r) => r.result);
  ok(kept.length === 1 && kept[0] === 'unverifiable', 'and the failed check is on record as unverifiable, never invalid');

  const org = await orgs.createOrg(pool, O, { name: 'Acme', slug: `${tag}-acme`, registration: { jurisdiction: 'RO', legalForm: 'SRL', nationalId: CUI } }, { connector: register('found') });
  const id = org.id;
  ok(org.registrationEvidence.verifiedName === 'ACME TRADING SRL' && org.registration.identifiers.some((i) => i.kind === 'vat' && i.value === `RO${CUI}`), 'a found company takes its name and VAT number from the register');
  ok(org.registration.registeredOffice.region === 'Cluj', 'and its registered office');
  const shown = await pool.query(`SELECT scheme FROM org_tax_identifiers WHERE workspace_id = $1 ORDER BY scheme`, [id]);
  ok(shown.rows.map((r) => r.scheme).join() === 'tin,vat', 'in the same rows Corpo › Company shows, not a second store');
  await pool.query(`INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id) VALUES('workspace',$1,'editor','user',$2),('workspace',$1,'admin','user',$3)`, [id, member, bot]);

  // who may do what
  ok(await refused(() => orgs.getOrg(pool, S, id), 'not_found'), 'a stranger is told the company doesn’t exist');
  for (const [name, fn] of [['members', () => orgs.listMembers(pool, S, id)], ['the wallet', () => orgs.getWallet(pool, S, id)], ['transactions', () => orgs.listTransactions(pool, S, id)], ['invoices', () => orgs.listInvoices(pool, S, id)], ['activity', () => orgs.listActivity(pool, S, id)]]) ok(await refused(fn, 'not_found'), `nor can they read ${name}`);
  ok((await orgs.listMembers(pool, M, id)).length >= 2, 'a member reads the roster');
  ok(await refused(() => orgs.listInvites(pool, M, id), 'forbidden'), 'but the addresses of people invited are for those who manage it');
  ok(await refused(() => orgs.issueInvoice(pool, M, id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE }), 'forbidden'), 'a member can’t issue an invoice');
  ok(await refused(() => orgs.issueInvoice(pool, B, id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE }), 'person_only'), 'nor can an agent, even an admin one');
  ok(await refused(() => orgs.verifyRegistration(pool, M, id, { connector: register('found') }), 'forbidden'), 'a member can’t re-verify the company');

  // numbers are gapless
  const first = await orgs.issueInvoice(pool, O, id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE });
  const n = (x) => Number(x.number.split('-').pop());
  ok(n(first) === 1, 'the first invoice is number 1');
  ok(first.invoice.seller.address.countrySubdivision === 'Cluj', 'the register’s county reaches the invoice, which RO e-invoicing requires');
  ok(first.invoice.seller.name === 'ACME TRADING SRL', 'it names the REGISTERED company, not the trading name');
  ok(await refused(() => orgs.issueInvoice(pool, O, id, { currency: 'RON', buyer: { ...BUYER, address: { ...BUYER.address, countrySubdivision: '' } }, lines: [LINE], dueDate: DUE }), 'invalid_invoice'), 'an invoice that fails Romanian rules is refused');
  const after = await orgs.issueInvoice(pool, O, id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE });
  ok(n(after) === 2, 'and took no number: the next one is 2, with no gap');
  const race = await Promise.all(Array.from({ length: 8 }, () => orgs.issueInvoice(pool, O, id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE })));
  ok(race.map(n).sort((a, b) => a - b).join() === '3,4,5,6,7,8,9,10', 'eight invoices issued at once get eight consecutive numbers');

  // an issued invoice is a legal document
  const row = first.number;
  ok(await dbRefused(`UPDATE org_issued_invoices SET document = '{}' WHERE number = $1`, [row]), 'nobody can edit an issued invoice, even in the database');
  ok(await dbRefused(`UPDATE org_issued_invoices SET ubl = 'x' WHERE number = $1`, [row]), 'nor its UBL');
  ok(await dbRefused(`DELETE FROM org_issued_invoices WHERE number = $1`, [row]), 'nor delete one');
  ok(await dbRefused('TRUNCATE org_issued_invoices'), 'nor truncate them');
  ok(await dbRefused('DELETE FROM workspaces WHERE id = $1', [id]), 'and a workspace can’t be deleted out from under its invoices');
  const cn = await orgs.creditInvoice(pool, O, id, first.number, 'wrong amount');
  ok(n(cn) === 11, 'a credit note takes the next number in the same series');
  const list = await orgs.listInvoices(pool, O, id);
  ok(list.find((i) => i.number === first.number).creditedBy === cn.number, 'the original records what reversed it');
  ok(JSON.stringify(list.find((i) => i.number === first.number).invoice) === JSON.stringify(first.invoice), 'and its document is untouched');
  ok(await refused(() => orgs.creditInvoice(pool, O, id, first.number), 'already_credited'), 'an invoice is credited once');
  ok(await refused(() => orgs.creditInvoice(pool, O, id, cn.number), 'not_an_invoice'), 'a credit note can’t be credited');
  ok(await dbRefused(`UPDATE org_issued_invoices SET credited_by = 'OTHER' WHERE number = $1`, [first.number]), 'and what credited it can’t be rewritten');
  const noReg = await orgs.createOrg(pool, O, { name: 'Plain', slug: `${tag}-plain` });
  ok(await refused(() => orgs.issueInvoice(pool, O, noReg.id, { currency: 'RON', buyer: BUYER, lines: [LINE], dueDate: DUE }), 'not_registered'), 'a company with no registration has nothing to put on a tax document');

  // a company anywhere: what it states is enough, in its own currency, and nothing Romanian reaches it
  const office = (country, region) => ({ line1: '1 Main Street', city: 'Capital', postalCode: '10001', ...(region ? { region } : {}), country });
  const buyerIn = (country) => ({ name: 'A Client', address: { city: 'Elsewhere', country } });
  const NO_TAX = { quantity: 2, unitPrice: 5000, itemName: 'Design', vatCategory: 'O', exemptionReason: 'No sales tax on this service' };
  const us = await orgs.createOrg(pool, O, { name: 'Northwind', slug: `${tag}-us`, registration: { jurisdiction: 'US', legalForm: 'LLC', nationalId: '12-3456789', legalName: 'Northwind Holdings LLC', registryNumber: '7654321', register: 'Delaware Division of Corporations', registeredOffice: office('US', 'DE') } });
  ok(us.registration.jurisdiction === 'US' && !us.registrationEvidence, 'a company in the United States is founded on what it states');
  ok(await refused(() => orgs.verifyRegistration(pool, O, us.id), 'no_register'), 'there is no register to ask, and that isn’t a failure of the company');
  const usd = await orgs.issueInvoice(pool, O, us.id, { currency: 'USD', buyer: buyerIn('US'), lines: [NO_TAX], dueDate: DUE });
  ok(usd.invoice.currency === 'USD' && usd.invoice.specificationId === 'urn:cen.eu:en16931:2017', 'it invoices in dollars under the common rules, declaring no Romanian profile');
  ok(usd.invoice.seller.name === 'Northwind Holdings LLC' && usd.invoice.seller.tradingName === 'Northwind', 'the seller is the legal name it stated');
  ok(usd.invoice.seller.legalRegistrationScheme === 'Delaware Division of Corporations' && usd.invoice.seller.legalRegistrationId === '7654321', 'and its register is its own, not ONRC');
  ok(usd.invoice.seller.address.countrySubdivision === 'DE' && usd.invoice.seller.address.country === 'US', 'at its own address');
  ok(usd.ubl.includes('<cbc:TaxExemptionReason>No sales tax on this service</cbc:TaxExemptionReason>') || usd.invoice.vatBreakdown[0].exemptionReason === 'No sales tax on this service', 'an invoice charging no tax says why');
  const usCredit = await orgs.creditInvoice(pool, O, us.id, usd.number);
  ok(usCredit.invoice.currency === 'USD' && usCredit.invoice.totals.payableAmount === -usd.invoice.totals.payableAmount, 'and a credit note reverses it exactly');
  const jp = await orgs.createOrg(pool, O, { name: 'Hikari', slug: `${tag}-jp`, registration: { jurisdiction: 'JP', legalForm: 'KK', nationalId: '1234567890123', registeredOffice: office('JP') } });
  const yen = await orgs.issueInvoice(pool, O, jp.id, { currency: 'JPY', buyer: buyerIn('JP'), lines: [{ quantity: 2, unitPrice: 5000, itemName: 'Design', vatCategory: 'S', vatRate: 10 }], dueDate: DUE });
  ok(yen.ubl.includes('<cbc:PayableAmount currencyID="JPY">11000</cbc:PayableAmount>'), 'yen have no decimals, so 11000 is written as 11000');
  const uk = await orgs.createOrg(pool, O, { name: 'Albion', slug: `${tag}-uk`, registration: { jurisdiction: 'GB', legalForm: 'Ltd', nationalId: '01234567', vatId: 'GB123456789', registeredOffice: office('GB') } });
  ok(uk.registration.identifiers.some((i) => i.kind === 'vat' && i.value === 'GB123456789'), 'a UK company records its own VAT number');
  const dxb = await orgs.createOrg(pool, O, { name: 'Gulf', slug: `${tag}-dxb`, registration: { jurisdiction: 'AE-DXB', legalForm: 'LLC', nationalId: '123', registeredOffice: office('AE') } });
  ok(dxb.registration.jurisdiction === 'AE-DXB' && dxb.registration.registeredOffice.country === 'AE', 'a free zone keeps its jurisdiction, and its address the country');
  ok(await refused(() => orgs.createOrg(pool, O, { name: 'Nowhere', slug: `${tag}-zz`, registration: { jurisdiction: 'ZZ', legalForm: 'LLC', nationalId: '1' } }), 'invalid_jurisdiction'), 'a country that doesn’t exist is refused');
  ok(await refused(() => orgs.createOrg(pool, O, { name: 'Greek', slug: `${tag}-gr`, registration: { jurisdiction: 'GR', legalForm: 'AE', nationalId: '1', vatId: 'GR123456789' } }), 'bad_prefix'), 'the identifier rules hold at founding too');
  ok((await pool.query('SELECT count(*)::int n FROM workspaces WHERE slug = $1', [`${tag}-gr`])).rows[0].n === 0, 'and a refused founding leaves nothing behind');
  const corpo = await orgs.createOrg(pool, O, { name: 'Set Up In Corpo', slug: `${tag}-corpo` });
  await company.saveProfile(pool, O, corpo.id, { legalName: 'Corpo Ltd', legalForm: 'Ltd', registeredOffice: office('NZ') });
  await company.addTax(pool, O, corpo.id, { scheme: 'vat', prefix: 'NZ', number: '123456789', jurisdiction: 'NZ' });
  const corpoInv = await orgs.issueInvoice(pool, O, corpo.id, { currency: 'NZD', buyer: buyerIn('NZ'), lines: [NO_TAX], dueDate: DUE });
  ok(corpoInv.invoice.seller.name === 'Corpo Ltd' && corpoInv.invoice.seller.vatId === 'NZ123456789', 'a company set up in the workspace’s own screen invoices with no separate tax id');
  const bare = await orgs.createOrg(pool, O, { name: 'No Office', slug: `${tag}-bare`, registration: { jurisdiction: 'DE', legalForm: 'GmbH', nationalId: '123' } });
  ok(await refused(() => orgs.issueInvoice(pool, O, bare.id, { currency: 'EUR', buyer: buyerIn('DE'), lines: [NO_TAX], dueDate: DUE }), 'no_registered_office'), 'an invoice needs the registered office, whatever the country');
  const beforeBad = await orgs.listInvoices(pool, O, us.id);
  ok(await refused(() => orgs.issueInvoice(pool, O, us.id, { buyer: buyerIn('US'), lines: [NO_TAX], dueDate: DUE }), 'invalid_currency'), 'a currency is never guessed');
  ok(await refused(() => orgs.issueInvoice(pool, O, us.id, { currency: 'NOPE', buyer: buyerIn('US'), lines: [NO_TAX], dueDate: DUE }), 'invalid_currency'), 'nor made up');
  ok((await orgs.listInvoices(pool, O, us.id)).length === beforeBad.length, 'and neither takes a number');
  ok(await refused(() => orgs.issueInvoice(pool, O, id, { currency: 'RON', buyer: BUYER, lines: [{ ...LINE, vatRate: 7 }], dueDate: DUE }), 'invalid_invoice'), 'a Romanian company still gets Romania’s rules');
  ok((await orgs.issueInvoice(pool, O, us.id, { currency: 'USD', buyer: buyerIn('US'), lines: [{ ...LINE, vatRate: 7 }], dueDate: DUE })).invoice.vatBreakdown[0].rate === 7, 'and nobody else does');

  // one person is a business too: a Kleingewerbe, a PFA, a sole trader
  const solo = await orgs.createOrg(pool, O, { name: 'Northwind Media', slug: `${tag}-solo` });
  await company.saveProfile(pool, O, solo.id, { entityKind: 'sole_proprietor', legalName: 'Erika Mustermann', legalForm: 'Kleingewerbe', registeredOffice: office('DE') });
  ok((await company.read(pool, O, solo.id)).profile.entityKind === 'sole_proprietor', 'a business can be one person');
  ok(await refused(() => company.saveProfile(pool, O, solo.id, { entityKind: 'trust' }), 'bad_input'), 'and it’s one of the kinds we know');
  ok(await refused(() => company.saveProfile(pool, O, solo.id, { taxStatus: 'small_business' }), 'bad_input'), 'a small business has to say what its invoices say');
  await company.addTax(pool, O, solo.id, { scheme: 'tin', jurisdiction: 'DE', number: '12/345/67890' });
  const NOTE = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';
  await company.saveProfile(pool, O, solo.id, { entityKind: 'sole_proprietor', taxStatus: 'small_business', taxStatusNote: NOTE, legalName: 'Erika Mustermann', legalForm: 'Kleingewerbe', registeredOffice: office('DE') });
  const SOLD = { quantity: 1, unitPrice: 10000, itemName: 'Editing' };
  ok(await refused(() => orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: buyerIn('DE'), lines: [{ ...SOLD, vatCategory: 'S', vatRate: 19 }], dueDate: DUE }), 'small_business_no_tax'), 'a small business can’t charge tax by mistake');
  const soloInv = await orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: buyerIn('DE'), lines: [SOLD], dueDate: DUE });
  ok(soloInv.invoice.seller.name === 'Erika Mustermann' && soloInv.invoice.seller.tradingName === 'Northwind Media', 'the seller is the person, trading under the business’s name');
  ok(soloInv.invoice.seller.taxRegistrationId === '12/345/67890' && !soloInv.invoice.seller.vatId, 'with their tax number, never written as a VAT id');
  ok(soloInv.invoice.vatBreakdown[0].category === 'E' && soloInv.invoice.vatBreakdown[0].exemptionReason === NOTE, 'and the note is on the invoice without being typed');
  ok(soloInv.invoice.totals.payableAmount === 10000, 'with no tax added');
  await company.saveProfile(pool, O, solo.id, { taxStatus: 'standard', legalName: 'Erika Mustermann', legalForm: 'Kleingewerbe', registeredOffice: office('DE') });
  const after19 = await company.read(pool, O, solo.id);
  ok(after19.profile.taxStatus === 'standard' && !after19.profile.taxStatusNote && after19.profile.entityKind === 'sole_proprietor', 'it can stop being a small business, and stays a sole proprietor');
  const taxed = await orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: buyerIn('DE'), lines: [{ ...SOLD, vatCategory: 'S', vatRate: 19 }], dueDate: DUE });
  ok(taxed.invoice.totals.payableAmount === 11900, 'then it charges tax');
  ok((await orgs.listInvoices(pool, O, solo.id)).find((i) => i.number === soloInv.number).invoice.vatBreakdown[0].exemptionReason === NOTE, 'and the invoice from before still says what it said');

  // an invoice a customer can use
  const IBAN = 'DE89370400440532013000', FULL = { name: 'A Client GmbH', address: { line1: 'Hafenstraße 2', city: 'Hamburg', postalCode: '20095', country: 'DE' } };
  const BIG = { quantity: 1, unitPrice: 50000, itemName: 'Film', vatCategory: 'S', vatRate: 19 };
  ok(await refused(() => company.savePaymentAccount(pool, O, solo.id, { account: 'DE89 3704 0044 0532 0130 01' }), 'bad_input'), 'a mistyped IBAN is refused before it can go on an invoice');
  ok(await refused(() => company.savePaymentAccount(pool, S, solo.id, { account: IBAN }), 'not_found'), 'and a stranger can’t set where a business is paid');
  await company.savePaymentAccount(pool, O, solo.id, { account: 'de89 3704 0044 0532 0130 00', bic: 'cobadeffxxx' });
  const paid = (await company.read(pool, O, solo.id)).profile.paymentAccount;
  ok(paid.account === IBAN && paid.bic === 'COBADEFFXXX', 'an account is kept in one form');
  const issuedSoFar = await orgs.listInvoices(pool, O, solo.id);
  ok(await refused(() => orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: buyerIn('DE'), lines: [BIG], dueDate: DUE, deliveryDate: '2026-11-03' }), 'invalid_invoice'), 'over 250 euros, a German invoice needs the customer’s full address');
  ok(await refused(() => orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: FULL, lines: [BIG], dueDate: DUE }), 'invalid_invoice'), 'and the date of supply');
  ok(await refused(() => orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: FULL, lines: [BIG], deliveryDate: '2026-11-03' }), 'invalid_invoice'), 'and any invoice with money owed says when');
  ok((await orgs.listInvoices(pool, O, solo.id)).length === issuedSoFar.length, 'and none of those took a number');
  const full = await orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: FULL, lines: [BIG], dueDate: DUE, deliveryDate: '2026-11-03' });
  ok(full.invoice.deliveryDate === '2026-11-03' && full.ubl.includes('<cbc:ActualDeliveryDate>2026-11-03</cbc:ActualDeliveryDate>'), 'the date of supply is on it');
  ok(full.invoice.payment.accountId === IBAN && full.invoice.payment.meansCode === '58' && full.invoice.payment.accountName === 'Erika Mustermann' && full.invoice.payment.remittance === full.number, 'and where to pay, without being typed');
  ok(full.ubl.includes(`<cbc:ID>${IBAN}</cbc:ID>`), 'in the UBL too');
  const period = await orgs.issueInvoice(pool, O, solo.id, { currency: 'EUR', buyer: FULL, lines: [BIG], dueDate: DUE, invoicingPeriod: { start: '2026-10-01', end: '2026-10-31' } });
  ok(period.invoice.invoicingPeriod.end === '2026-10-31', 'a supply can be a period');
  ok(!issuedSoFar.find((i) => i.number === soloInv.number).invoice.payment, 'and invoices from before the account stay as they were');
  await company.savePaymentAccount(pool, O, solo.id, { account: '' });
  ok(!(await company.read(pool, O, solo.id)).profile.paymentAccount, 'an account can be taken off');
  await orgs.issueInvoice(pool, O, solo.id, { currency: 'USD', buyer: FULL, lines: [BIG], dueDate: DUE, deliveryDate: '2026-11-03' });

  const printed = await orgs.invoiceDocument(pool, O, solo.id, full.number);
  ok(printed.language === 'de' && printed.html.includes('Rechnung') && printed.html.includes('A Client GmbH') && printed.html.includes(IBAN), 'an invoice opens as a page, in the customer’s language');
  ok((await orgs.invoiceDocument(pool, O, solo.id, full.number, 'en')).html.includes('<h1>Invoice</h1>'), 'or in English');
  ok(await refused(() => orgs.invoiceDocument(pool, S, solo.id, full.number), 'not_found'), 'and a stranger can’t open one');
  ok(await refused(() => orgs.invoiceDocument(pool, O, solo.id, 'NOPE-1'), 'invoice_not_found'), 'nor can anyone open one that doesn’t exist');

  ok((await orgs.revenue(pool, O, solo.id)).limit === null, 'a business starts with no limit');
  ok(await refused(() => company.saveRevenueLimit(pool, O, solo.id, { amount: 2500000, currency: 'NOPE' }), 'bad_input'), 'a limit has a real currency');
  ok(await refused(() => company.saveRevenueLimit(pool, O, solo.id, { amount: -1, currency: 'EUR' }), 'bad_input'), 'and a real amount');
  ok(await refused(() => company.saveRevenueLimit(pool, S, solo.id, { amount: 2500000, currency: 'EUR' }), 'not_found'), 'and only its own people set one');
  await company.saveRevenueLimit(pool, O, solo.id, { amount: 2500000, currency: 'EUR' });
  const year = new Date().getUTCFullYear(), euros = (r) => r.byCurrency.find((x) => x.currency === 'EUR').net;
  const sold = await orgs.revenue(pool, O, solo.id);
  ok(sold.limit.amount === 2500000 && sold.limit.currency === 'EUR', 'a limit is the figure the business set');
  ok(euros(sold) === 10000 + 10000 + 50000 + 50000, 'the year counts every euro invoice, net of tax');
  ok(sold.byCurrency.find((x) => x.currency === 'USD').net === 50000, 'other currencies stay apart');
  await orgs.creditInvoice(pool, O, solo.id, period.number);
  ok(euros(await orgs.revenue(pool, O, solo.id)) === 70000, 'a credit note takes its amount back off');
  ok((await orgs.revenue(pool, O, solo.id, year - 1)).byCurrency.length === 0, 'and another year is another year');
  ok(await refused(() => orgs.revenue(pool, S, solo.id), 'not_found'), 'a stranger can’t read a business’s revenue');
  ok(await refused(() => orgs.revenue(pool, O, solo.id, 'all'), 'bad_input'), 'and a year is a year');
  await company.saveRevenueLimit(pool, O, solo.id, { amount: null });
  ok(!(await company.read(pool, O, solo.id)).profile.revenueLimit, 'a limit can be removed');

  const [upSql, downSql] = fs.readFileSync(new URL('../database/migrations/20261116090000-company-invoice-details.sql', import.meta.url), 'utf8').split('-- DOWN');
  await pool.query(downSql);
  ok((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'org_profiles' AND (column_name LIKE 'payment%' OR column_name LIKE 'revenue%')`)).rows[0].n === 0, 'taking the invoice details back removes all of them');
  await pool.query(upSql);
  ok((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'org_profiles' AND (column_name LIKE 'payment%' OR column_name LIKE 'revenue%')`)).rows[0].n === 5, 'and they go back on');

  // D18: employment is an admission plus a title
  const agent = await orgs.employAgent(pool, O, id, { mindId: 'mind-1', displayName: 'Clerk', role: 'admin', capabilities: ['files.read', 'files.read', ' tasks.write '] });
  ok(agent.role === 'admin' && agent.employment.mindId === 'mind-1', 'an agent is employed with a role and a Mind');
  const uid = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [agent.subjectId])).rows[0].user_id;
  ok((await pool.query(`SELECT relation FROM relationship_tuples WHERE object_type = 'workspace' AND object_id = $1 AND subject_type = 'agent' AND subject_id = $2`, [id, String(uid)])).rows[0]?.relation === 'admin', 'its role is a ReBAC tuple');
  const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'org_agent_employments'`)).rows.map((r) => r.column_name);
  ok(!columns.includes('role') && !columns.some((c) => /capab|scope|grant|permission/.test(c)), 'and the employment row has no column that could hold authority (D18)');
  const def = (await pool.query(`SELECT v.content FROM workforce_agent_versions v JOIN agent_identities a ON a.workforce_resource_id = v.resource_id WHERE a.user_id = $1 ORDER BY v.version DESC LIMIT 1`, [uid])).rows[0].content;
  ok(def.requestedCapabilities.join() === 'files.read,tasks.write', 'its capabilities are on its definition, which run admission intersects');
  await orgs.setAgentCapabilities(pool, O, id, agent.subjectId, ['files.read']);
  const defNext = (await pool.query(`SELECT v.content, v.version FROM workforce_agent_versions v JOIN agent_identities a ON a.workforce_resource_id = v.resource_id WHERE a.user_id = $1 ORDER BY v.version DESC LIMIT 1`, [uid])).rows[0];
  ok(defNext.content.requestedCapabilities.join() === 'files.read' && defNext.version === 2, 'and changing them makes a new version of it');
  ok(await refused(() => orgs.changeRole(pool, O, id, agent.subjectId, 'owner'), 'agent_cannot_own'), 'an agent can’t become an owner');
  await orgs.changeRole(pool, O, id, agent.subjectId, 'viewer');
  ok((await orgs.listMembers(pool, O, id)).find((m) => m.subjectId === agent.subjectId).role === 'viewer', 'its role changes in ReBAC');
  await orgs.removeMember(pool, O, id, agent.subjectId);
  ok(!(await orgs.listMembers(pool, O, id)).some((m) => m.subjectId === agent.subjectId), 'removing it takes it off the roster');
  ok((await pool.query(`SELECT count(*)::int n FROM relationship_tuples WHERE subject_type = 'agent' AND subject_id = $1`, [String(uid)])).rows[0].n === 0, 'and its authority with it');

  // the record
  const kinds = new Set((await orgs.listActivity(pool, O, id)).map((a) => a.kind));
  for (const k of ['company.created', 'invoice.issued', 'invoice.credited', 'agent.employed', 'agent.capabilities_changed', 'member.role_changed', 'member.removed']) ok(kinds.has(k), `activity records ${k}`);

  // the wallet is read only
  const before = (await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [id])).rows[0];
  const wallet = await orgs.getWallet(pool, O, id);
  ok(wallet.balance === 0 && wallet.held === 0 && wallet.currency === 'credits', 'a new company has an empty wallet');
  ok(String((await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [id])).rows[0].balance) === String(before.balance), 'reading it changes nothing');
  ok((await pool.query(`SELECT count(*)::int n FROM credit_transactions t JOIN credit_accounts a ON a.id = t.account_id WHERE a.user_id = $1`, [id])).rows[0].n === 0, 'and issuing invoices never touched the ledger');

  // the way back
  const migration = fs.readFileSync(new URL('../database/migrations/20261113090000-org-employments-and-invoices.sql', import.meta.url), 'utf8');
  const [up, undo] = migration.replace('-- UP', '').split('-- DOWN');
  ok(await pool.query(undo).then(() => false, (e) => e.code === '23514'), 'the migration can’t be taken back while invoices exist');
  await pool.query(up);
  ok((await orgs.listInvoices(pool, O, id)).length === 11, 'and re-running it is safe');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
