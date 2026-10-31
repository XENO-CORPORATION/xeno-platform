/**
 * A company's legal entity on real Postgres (xeno-company/SPEC.md §4.2).
 *
 *   - anyone in the workspace reads it; a stranger is told it doesn't exist; a date of birth is for those who manage it
 *   - only a person who administers the workspace changes it, never an agent
 *   - identifiers are separate lists; EL not GR, no GB, a VAT number is a short string; an LEI has a status
 *   - one primary registration, any number of branches, and the same number can be in two registers
 *   - VIES: an unreachable register is `unverifiable`, never invalid, and every answer is kept and can't be changed
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/company-entity.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as company from '../services/companyEntity.js';
import { writeTuples } from '../utils/authzReBAC.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `co${process.pid}`;
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`, s])).rows[0].id;
const refused = async (fn, code) => { try { await fn(); } catch (e) { assert.ok(e instanceof company.CompanyError, `expected a refusal, got ${e.message}`); assert.equal(e.code, code); return true; } throw new Error(`expected ${code}`); };
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), member = await user('member'), stranger = await user('stranger'), agent = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agent, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company','Acme',$2) RETURNING id`, [owner, `${tag}-acme`])).rows[0].id;
  const personal = (await pool.query(`SELECT id FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal'`, [member])).rows[0]?.id
    || (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'personal','Mine',$2) RETURNING id`, [member, `${tag}-mine`])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${ws}`, relation: 'owner', subject: `user:${owner}` }, { object: `workspace:${ws}`, relation: 'editor', subject: `user:${member}` }, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${agent}` },
    { object: `workspace:${personal}`, relation: 'owner', subject: `user:${member}` },
  ] });
  const O = { id: owner }, M = { id: member }, A = { id: agent };

  // who may do what
  ok(await refused(() => company.read(pool, { id: stranger }, ws), 'not_found'), 'someone not in the workspace is told it does not exist');
  ok((await company.read(pool, M, ws)).canManage === false, 'a member reads it');
  ok((await company.read(pool, O, ws)).canManage === true, 'the owner manages it');
  ok(await refused(() => company.saveProfile(pool, M, ws, { legalName: 'X' }), 'forbidden'), 'a member can’t change it');
  ok(await refused(() => company.saveProfile(pool, A, ws, { legalName: 'X' }), 'person_only'), 'nor can an agent, whatever its role');
  ok(await refused(() => company.addRegistration(pool, M, personal, { jurisdiction: 'RO', register: 'ONRC', number: 'J1' }), 'not_a_company'), 'a personal workspace has no legal entity');

  // the profile keeps two addresses and a pair
  const office = { line1: 'Str. A 1', city: 'Bucharest', postalCode: '010101', country: 'RO' }, hq = { line1: 'Unter den Linden 1', city: 'Berlin', postalCode: '10117', country: 'DE' };
  const saved = await company.saveProfile(pool, O, ws, { legalName: 'Acme SRL', legalForm: 'SRL', governingRegime: 'Romanian law', registeredOffice: office, centralAdministration: hq });
  ok(saved.profile.registeredOffice.city === 'Bucharest' && saved.profile.centralAdministration.city === 'Berlin', 'the registered office and where it’s run can differ');
  ok(saved.profile.legalForm === 'SRL' && saved.profile.governingRegime === 'Romanian law', 'legal form and governing law are kept as a pair');
  ok(await refused(() => company.saveProfile(pool, O, ws, { registeredOffice: { line1: 'x' } }), 'bad_input'), 'half an address is refused');

  // registrations
  await company.addRegistration(pool, O, ws, { jurisdiction: 'RO', register: 'ONRC', number: 'J40/1/2026', role: 'primary' });
  ok(await refused(() => company.addRegistration(pool, O, ws, { jurisdiction: 'DE', register: 'Berlin', number: 'HRB 1', role: 'primary' }), 'conflict'), 'one primary registration');
  await company.addRegistration(pool, O, ws, { jurisdiction: 'DE', register: 'AG Berlin', number: 'HRB 1', role: 'branch', euid: 'DEB1234.HRB1' });
  await company.addRegistration(pool, O, ws, { jurisdiction: 'DE', register: 'AG München', number: 'HRB 1', role: 'branch' });
  ok((await company.read(pool, O, ws)).registrations.length === 3, 'any number of branches, and the same number can be in two courts’ registers');
  ok(await refused(() => company.addRegistration(pool, O, ws, { jurisdiction: 'DE', register: 'AG Berlin', number: 'HRB 1', role: 'branch' }), 'conflict'), 'the same registration only once');

  // identifiers
  ok(await refused(() => company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'GR', number: '123456789', jurisdiction: 'GR' }), 'bad_prefix'), 'Greece’s prefix is EL, not GR');
  ok(await refused(() => company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'GB', number: '123456789', jurisdiction: 'GB' }), 'bad_prefix'), 'GB isn’t a VIES prefix any more');
  ok(await refused(() => company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'RO', number: 'way-too-long-for-a-vat', jurisdiction: 'RO' }), 'bad_number'), 'a VAT number is at most twelve characters');
  const nl = await company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'NL', number: '1234567 89B01', jurisdiction: 'NL' });
  ok(!!nl.id, 'letters are fine in a VAT number');
  const ro = await company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'RO', number: '123456', jurisdiction: 'RO' });
  const el = await company.addTax(pool, O, ws, { scheme: 'vat', prefix: 'EL', number: '123456789', jurisdiction: 'GR' });
  const tin = await company.addTax(pool, O, ws, { scheme: 'tin', number: '123456', jurisdiction: 'RO' });
  ok(!!el.id && !!tin.id, 'a tax number with no VAT is a different thing from a VAT number');
  await company.addCustoms(pool, O, ws, { number: 'RO123456', jurisdiction: 'RO' });
  ok(await refused(() => company.addFinancial(pool, O, ws, { number: 'SHORT', status: 'ISSUED' }), 'bad_number'), 'an LEI is twenty characters');
  ok(await refused(() => company.addFinancial(pool, O, ws, { number: '5493001KJTIIGC8Y1R12', status: 'YES' }), 'bad_input'), 'an LEI’s status is one of GLEIF’s');
  await company.addFinancial(pool, O, ws, { number: '5493001KJTIIGC8Y1R12', status: 'LAPSED', nextRenewal: '2027-01-01' });
  const read1 = await company.read(pool, O, ws);
  ok(read1.financial[0].status === 'LAPSED' && read1.financial[0].nextRenewal === '2027-01-01', 'a lapsed LEI says lapsed, with its renewal date');
  ok(read1.customs.length === 1 && read1.tax.length === 4, 'each namespace is its own list');

  // who may act
  await company.addMandate(pool, O, ws, { name: 'Ada', role: 'Director', authority: 'sole', dateOfBirth: '1815-12-10' });
  ok(await refused(() => company.addMandate(pool, O, ws, { name: 'B', role: 'Director', authority: 'maybe' }), 'bad_input'), 'authority is alone or jointly');
  ok(await refused(() => company.addMandate(pool, O, ws, { name: 'B', role: 'Director', authority: 'sole', validFrom: '2027-01-01', validUntil: '2026-01-01' }), 'bad_input'), 'a mandate can’t end before it starts');
  ok((await company.read(pool, O, ws)).mandates[0].dateOfBirth === '1815-12-10', 'those who manage the company see a date of birth');
  const asMember = await company.read(pool, M, ws);
  ok(asMember.mandates[0].name === 'Ada' && !('dateOfBirth' in asMember.mandates[0]), 'a member sees who may act, not when they were born');

  // VIES
  const v1 = await company.checkVat(pool, O, ws, ro.id, { fetchImpl: reply(200, { isValid: true, requestIdentifier: 'WAPI123', name: 'ACME SRL' }) });
  ok(v1.result === 'valid' && v1.consultationNumber === 'WAPI123' && v1.name === 'ACME SRL', 'a valid answer keeps its consultation number');
  const v2 = await company.checkVat(pool, O, ws, ro.id, { fetchImpl: reply(200, { isValid: false }) });
  ok(v2.result === 'invalid', 'an invalid answer is invalid');
  const v3 = await company.checkVat(pool, O, ws, ro.id, { fetchImpl: reply(200, { isValid: false, userError: 'MS_UNAVAILABLE' }) });
  ok(v3.result === 'unverifiable', 'a member state’s register being down is not an invalid number');
  const v4 = await company.checkVat(pool, O, ws, ro.id, { fetchImpl: reply(503, {}) });
  const v5 = await company.checkVat(pool, O, ws, ro.id, { fetchImpl: async () => { throw new Error('network'); } });
  ok(v4.result === 'unverifiable' && v5.result === 'unverifiable', 'nor is VIES being unreachable');
  const kept = (await pool.query('SELECT result FROM org_identifier_checks WHERE tax_identifier_id = $1 ORDER BY checked_at', [ro.id])).rows.map((r) => r.result);
  ok(kept.length === 5 && kept[0] === 'valid', 'every consultation is kept');
  await assert.rejects(() => pool.query(`UPDATE org_identifier_checks SET result = 'valid' WHERE tax_identifier_id = $1`, [ro.id]), /cannot be changed/);
  ok(true, 'and a record can’t be rewritten');
  ok((await company.read(pool, O, ws)).tax.find((t) => t.id === ro.id).check.result === 'unverifiable', 'the page shows the latest');
  ok(await refused(() => company.checkVat(pool, O, ws, tin.id, { fetchImpl: reply(200, { isValid: true }) }), 'not_vat'), 'only a VAT number goes to VIES');
  ok(await refused(() => company.checkVat(pool, M, ws, ro.id, { fetchImpl: reply(200, { isValid: true }) }), 'forbidden'), 'a member can’t run a check');

  // removing
  await company.remove(pool, O, ws, 'tax', ro.id);
  ok((await pool.query('SELECT 1 FROM org_identifier_checks WHERE identifier = $1', ['RO123456'])).rowCount === 5, 'removing a number keeps the checks made on it');
  ok(await refused(() => company.remove(pool, O, ws, 'users', el.id), 'not_found'), 'only the entity’s own lists');
  const other = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'company','Other',$2) RETURNING id`, [stranger, `${tag}-other`])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${other}`, relation: 'owner', subject: `user:${stranger}` }] });
  ok(await refused(() => company.remove(pool, { id: stranger }, other, 'tax', el.id), 'not_found'), 'another company’s number can’t be reached through yours');

  // the way back
  const migration = fs.readFileSync(new URL('../database/migrations/20261105090000-company-legal-entity.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- DOWN');
  await pool.query(down);
  ok((await pool.query("SELECT to_regclass('public.org_profiles') AS t")).rows[0].t === null, 'the migration can be taken back');
  await pool.query(up);
  ok((await company.read(pool, O, ws)).registrations.length === 0, 'and put back again');

  console.log(`\n${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
