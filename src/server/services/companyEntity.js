/**
 * XENO Company's legal entity (xeno-company/SPEC.md §4.2). A company IS a workspace; this adds what the law needs to know.
 *
 * Who may do what:
 * - Anyone in the workspace reads the entity: it is what they work for. A person's date of birth is for those who manage it.
 * - A person who administers the workspace changes it. An agent or a service never does: these are statements to authorities.
 * - An identifier check keeps what the register answered, forever, and an unreachable register is `unverifiable`, never invalid.
 *
 * There is deliberately no check for registers with no public API (rule 14), and no computing of one identifier from another (rule 1).
 */
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicUuid = (v) => UUID.test(String(v || ''));

export class CompanyError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
const can = async (db, userId, workspaceId, relation) => (await check(db, { object: `workspace:${workspaceId}`, relation, subject: `user:${userId}` })).allowed;
const text = (v, max, field, { optional = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && optional) return null;
  if (!s || s.length > max) throw new CompanyError(`${field} is needed, up to ${max} characters.`, 'bad_input');
  return s;
};
const JURISDICTION = /^[A-Z]{2}(-[A-Z0-9]{1,6})?$/;
const jurisdiction = (v) => { const j = String(v || '').trim().toUpperCase(); if (!JURISDICTION.test(j)) throw new CompanyError('Choose a country.', 'bad_input'); return j; };
const date = (v, field) => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new CompanyError(`${field} should be a date.`, 'bad_input'); return String(v); };
const address = (a, field) => {
  if (a == null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) throw new CompanyError(`${field} isn’t an address.`, 'bad_input');
  const line1 = text(a.line1, 200, `${field}: the street`), city = text(a.city, 120, `${field}: the city`), postalCode = text(a.postalCode, 20, `${field}: the postal code`), country = jurisdiction(a.country);
  return { line1, line2: text(a.line2, 200, field, { optional: true }), city, region: text(a.region, 120, field, { optional: true }), postalCode, country };
};

async function companyOf(db, me, workspaceId) {
  if (!publicUuid(workspaceId)) throw new CompanyError('Company not found', 'not_found', 404);
  const w = (await db.query('SELECT id, name, slug, workspace_type, status, owner_user_id, created_at FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
  if (!w || !await can(db, me.id, workspaceId, 'viewer')) throw new CompanyError('Company not found', 'not_found', 404);
  return w;
}
async function manager(db, me, workspaceId) {
  const w = await companyOf(db, me, workspaceId);
  if (w.workspace_type === 'personal') throw new CompanyError('A personal workspace has no legal entity.', 'not_a_company', 409);
  const p = await resolvePrincipal(db, me.id);
  if (p.kind !== 'human') throw new CompanyError('A person changes what the company says about itself.', 'person_only', 403);
  if (!await can(db, me.id, workspaceId, 'admin')) throw new CompanyError('Owners and admins manage the company.', 'forbidden', 403);
  return w;
}

export async function read(db, me, workspaceId) {
  const w = await companyOf(db, me, workspaceId);
  const manage = await can(db, me.id, workspaceId, 'admin');
  const [profile, regs, tax, customs, fin, mandates] = await Promise.all([
    db.query('SELECT * FROM org_profiles WHERE workspace_id = $1', [workspaceId]),
    db.query(`SELECT id, jurisdiction, register_name, national_number, euid, role, created_at FROM org_registrations WHERE workspace_id = $1 ORDER BY role = 'primary' DESC, created_at`, [workspaceId]),
    db.query(`SELECT t.id, t.scheme, t.prefix, t.number, t.jurisdiction, c.result, c.consultation_number, c.checked_at
        FROM org_tax_identifiers t
        LEFT JOIN LATERAL (SELECT result, consultation_number, checked_at FROM org_identifier_checks k WHERE k.tax_identifier_id = t.id ORDER BY k.checked_at DESC LIMIT 1) c ON true
       WHERE t.workspace_id = $1 ORDER BY t.created_at`, [workspaceId]),
    db.query('SELECT id, scheme, number, jurisdiction FROM org_customs_identifiers WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]),
    db.query('SELECT id, scheme, number, status, next_renewal_date FROM org_financial_identifiers WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]),
    db.query('SELECT id, person_name, date_of_birth, role, authority, scope, subject_agent_user_id, valid_from, valid_until FROM org_mandates WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]),
  ]);
  const p = profile.rows[0] || {};
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  return {
    org: { id: w.id, kind: w.workspace_type, name: w.name, slug: w.slug, status: w.status, ownerUserId: w.owner_user_id, createdAt: w.created_at },
    canManage: manage && w.workspace_type !== 'personal',
    profile: { legalName: p.legal_name || null, legalForm: p.legal_form || null, governingRegime: p.governing_regime || null, registeredOffice: p.registered_office || null, centralAdministration: p.central_administration || null },
    registrations: regs.rows.map((r) => ({ id: r.id, jurisdiction: r.jurisdiction, register: r.register_name, number: r.national_number, euid: r.euid, role: r.role })),
    tax: tax.rows.map((t) => ({ id: t.id, scheme: t.scheme, prefix: t.prefix, number: t.number, jurisdiction: t.jurisdiction, check: t.result ? { result: t.result, consultationNumber: t.consultation_number, at: t.checked_at } : null })),
    customs: customs.rows.map((c) => ({ id: c.id, scheme: c.scheme, number: c.number, jurisdiction: c.jurisdiction })),
    financial: fin.rows.map((f) => ({ id: f.id, scheme: f.scheme, number: f.number, status: f.status, nextRenewal: day(f.next_renewal_date) })),
    mandates: mandates.rows.map((m) => ({ id: m.id, name: m.person_name, role: m.role, authority: m.authority, scope: m.scope, agentUserId: m.subject_agent_user_id, validFrom: day(m.valid_from), validUntil: day(m.valid_until), ...(manage ? { dateOfBirth: day(m.date_of_birth) } : {}) })),
  };
}

export async function saveProfile(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  await db.query(`INSERT INTO org_profiles (workspace_id, legal_name, legal_form, governing_regime, registered_office, central_administration, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (workspace_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, legal_form = EXCLUDED.legal_form, governing_regime = EXCLUDED.governing_regime, registered_office = EXCLUDED.registered_office, central_administration = EXCLUDED.central_administration, updated_at = now()`,
  [workspaceId, text(body.legalName, 300, 'The legal name', { optional: true }), text(body.legalForm, 120, 'The legal form', { optional: true }), text(body.governingRegime, 120, 'The governing law', { optional: true }), address(body.registeredOffice, 'Registered office'), address(body.centralAdministration, 'Central administration')]);
  return read(db, me, workspaceId);
}

export async function addRegistration(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  const role = body.role === 'branch' ? 'branch' : 'primary';
  try {
    const r = await db.query(`INSERT INTO org_registrations (workspace_id, jurisdiction, register_name, national_number, euid, role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [workspaceId, jurisdiction(body.jurisdiction), text(body.register, 200, 'The register'), text(body.number, 60, 'The number'), text(body.euid, 80, 'The EUID', { optional: true }), role]);
    return { id: r.rows[0].id };
  } catch (e) {
    if (e.code === '23505') throw new CompanyError(/one_primary/.test(e.constraint || '') ? 'The company already has a primary registration. Add this as a branch.' : 'That registration is already here.', 'conflict', 409);
    throw e;
  }
}
const NAMESPACE = { registrations: 'org_registrations', tax: 'org_tax_identifiers', customs: 'org_customs_identifiers', financial: 'org_financial_identifiers', mandates: 'org_mandates' };
export async function remove(db, me, workspaceId, kind, id) {
  await manager(db, me, workspaceId);
  const table = NAMESPACE[kind];
  if (!table || !publicUuid(id)) throw new CompanyError('Not found', 'not_found', 404);
  const r = await db.query(`DELETE FROM ${table} WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
  if (!r.rowCount) throw new CompanyError('Not found', 'not_found', 404);
  return { removed: true };
}
export async function addTax(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  const scheme = ['vat', 'oss', 'tin'].includes(body.scheme) ? body.scheme : 'vat';
  const j = jurisdiction(body.jurisdiction), number = text(body.number, 40, 'The number').replace(/\s/g, '');
  let prefix = null;
  if (scheme === 'vat') {
    prefix = String(body.prefix || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(prefix)) throw new CompanyError('Give the VAT prefix.', 'bad_input');
    if (prefix === 'GR') throw new CompanyError('Greece’s VAT prefix is EL.', 'bad_prefix');
    if (prefix === 'GB') throw new CompanyError('GB is no longer in VIES. Northern Ireland’s prefix is XI.', 'bad_prefix');
    if (!/^[0-9A-Za-z+*.]{2,12}$/.test(number)) throw new CompanyError('A VAT number is 2 to 12 characters, without its prefix.', 'bad_number');
  }
  try { return { id: (await db.query('INSERT INTO org_tax_identifiers (workspace_id, scheme, prefix, number, jurisdiction) VALUES ($1,$2,$3,$4,$5) RETURNING id', [workspaceId, scheme, prefix, number, j])).rows[0].id }; }
  catch (e) { if (e.code === '23505') throw new CompanyError('That number is already here.', 'conflict', 409); throw e; }
}
export async function addCustoms(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  try { return { id: (await db.query('INSERT INTO org_customs_identifiers (workspace_id, number, jurisdiction) VALUES ($1,$2,$3) RETURNING id', [workspaceId, text(body.number, 40, 'The number').replace(/\s/g, ''), jurisdiction(body.jurisdiction)])).rows[0].id }; }
  catch (e) { if (e.code === '23505') throw new CompanyError('That number is already here.', 'conflict', 409); throw e; }
}
const LEI_STATUS = ['ISSUED', 'LAPSED', 'RETIRED', 'ANNULLED', 'DUPLICATE', 'PENDING_VALIDATION', 'PENDING_TRANSFER', 'PENDING_ARCHIVAL', 'CANCELLED', 'TRANSFERRED'];
export async function addFinancial(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  const number = String(body.number || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{20}$/.test(number)) throw new CompanyError('An LEI is 20 letters and digits.', 'bad_number');
  if (!LEI_STATUS.includes(body.status)) throw new CompanyError('Choose the LEI’s status.', 'bad_input');
  try { return { id: (await db.query('INSERT INTO org_financial_identifiers (workspace_id, number, status, next_renewal_date) VALUES ($1,$2,$3,$4) RETURNING id', [workspaceId, number, body.status, date(body.nextRenewal, 'The renewal')])).rows[0].id }; }
  catch (e) { if (e.code === '23505') throw new CompanyError('That number is already here.', 'conflict', 409); throw e; }
}
export async function addMandate(db, me, workspaceId, body = {}) {
  await manager(db, me, workspaceId);
  if (!['sole', 'joint'].includes(body.authority)) throw new CompanyError('Say whether they act alone or jointly.', 'bad_input');
  const from = date(body.validFrom, 'The start'), until = date(body.validUntil, 'The end');
  if (from && until && until < from) throw new CompanyError('The end is before the start.', 'bad_input');
  return { id: (await db.query(`INSERT INTO org_mandates (workspace_id, person_name, date_of_birth, role, authority, scope, valid_from, valid_until, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [workspaceId, text(body.name, 200, 'The name'), date(body.dateOfBirth, 'The date of birth'), text(body.role, 120, 'The role'), body.authority, text(body.scope, 2000, 'The scope', { optional: true }), from, until, me.id])).rows[0].id };
}

const VIES = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';
// A member state's own register being down is not an invalid number (rule 7).
const OUTAGE = new Set(['MS_UNAVAILABLE', 'MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'VAT_BLOCKED', 'IP_BLOCKED']);
/** Asks VIES about a VAT number, and keeps the answer whatever it was. */
export async function checkVat(db, me, workspaceId, identifierId, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  await manager(db, me, workspaceId);
  if (!publicUuid(identifierId)) throw new CompanyError('Not found', 'not_found', 404);
  const t = (await db.query('SELECT id, scheme, prefix, number FROM org_tax_identifiers WHERE id = $1 AND workspace_id = $2', [identifierId, workspaceId])).rows[0];
  if (!t) throw new CompanyError('Not found', 'not_found', 404);
  if (t.scheme !== 'vat') throw new CompanyError('Only a VAT number can be checked with VIES.', 'not_vat', 409);
  let result = 'unverifiable', raw = null;
  try {
    const r = await fetchImpl(`${VIES}/${encodeURIComponent(t.prefix)}/vat/${encodeURIComponent(t.number)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    raw = await r.json().catch(() => null);
    if (r.ok && raw && typeof raw.isValid === 'boolean' && !OUTAGE.has(raw.userError)) result = raw.isValid ? 'valid' : 'invalid';
  } catch { raw = { error: 'unreachable' }; }
  const row = (await db.query(`INSERT INTO org_identifier_checks (tax_identifier_id, workspace_id, identifier, result, consultation_number, raw_response, checked_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING checked_at`,
    [t.id, workspaceId, `${t.prefix}${t.number}`, result, (raw && raw.requestIdentifier) || null, raw ? JSON.stringify(raw) : null, me.id])).rows[0];
  return { result, at: row.checked_at, consultationNumber: (raw && raw.requestIdentifier) || null, name: result === 'valid' && raw && raw.name && raw.name !== '---' ? raw.name : null };
}
