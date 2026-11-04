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
  ok(await refused(() => orgs.issueInvoice(pool, M, id, { buyer: BUYER, lines: [LINE] }), 'forbidden'), 'a member can’t issue an invoice');
  ok(await refused(() => orgs.issueInvoice(pool, B, id, { buyer: BUYER, lines: [LINE] }), 'person_only'), 'nor can an agent, even an admin one');
  ok(await refused(() => orgs.verifyRegistration(pool, M, id, { connector: register('found') }), 'forbidden'), 'a member can’t re-verify the company');

  // numbers are gapless
  const first = await orgs.issueInvoice(pool, O, id, { buyer: BUYER, lines: [LINE] });
  const n = (x) => Number(x.number.split('-').pop());
  ok(n(first) === 1, 'the first invoice is number 1');
  ok(first.invoice.seller.address.countrySubdivision === 'Cluj', 'the register’s county reaches the invoice, which RO e-invoicing requires');
  ok(first.invoice.seller.name === 'ACME TRADING SRL', 'it names the REGISTERED company, not the trading name');
  ok(await refused(() => orgs.issueInvoice(pool, O, id, { buyer: { ...BUYER, address: { ...BUYER.address, countrySubdivision: '' } }, lines: [LINE] }), 'invalid_invoice'), 'an invoice that fails Romanian rules is refused');
  const after = await orgs.issueInvoice(pool, O, id, { buyer: BUYER, lines: [LINE] });
  ok(n(after) === 2, 'and took no number: the next one is 2, with no gap');
  const race = await Promise.all(Array.from({ length: 8 }, () => orgs.issueInvoice(pool, O, id, { buyer: BUYER, lines: [LINE] })));
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
  ok(await refused(() => orgs.issueInvoice(pool, O, noReg.id, { buyer: BUYER, lines: [LINE] }), 'not_registered'), 'a company with no registration has nothing to put on a tax document');

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
