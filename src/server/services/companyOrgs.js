/**
 * The backend of XENO Company's dashboard: everything `HttpCompanyClient` (xeno-company/packages/client) calls under /api/orgs.
 *
 * A company IS a workspace (xeno-company/SPEC.md §4.1). This file owns no second tenancy, so each answer is a VIEW of what
 * the platform already holds, written through the service that already owns it:
 *
 *   org, members, invites   workspaces, relationship_tuples, workspace_invites → workspaceLifecycle, workspaceMembershipOperations
 *   registration + evidence org_profiles, org_registrations, org_tax_identifiers, org_identifier_checks (the same rows Corpo › Company shows)
 *   employed agents         platformAgents; role in relationship_tuples (subject agent), Mind in org_agent_employments
 *   capabilities            the agent definition's requestedCapabilities, which run admission intersects, so they are enforced
 *   activity                workspace_audit, mapped onto the dashboard's closed set of kinds
 *   wallet, transactions    the ledger, read only. Company never writes money.
 *
 * Only issued invoices are new, and they are legal documents: built by the vendored @xenosystem/company-legal, numbered
 * inside the transaction that stores them so the series is gapless, immutable once out (a DB trigger), corrected only by a
 * credit note. Changing a company, issuing and crediting are a person's acts, as in companyEntity.js.
 *
 * A company can be registered in any country (owner, 2026-11-04). What it states is enough; a register, where one is
 * connected, confirms it. A country's rules are an add-on picked by `invoiceProfileFor`, and nothing here submits
 * anything to a tax authority.
 */
import * as company from './companyEntity.js';
import * as agents from './platformAgents.js';
import { resolvePrincipal } from './agentIdentity.js';
import { createAccountWorkspace, ensurePersonalWorkspace } from './workspaceLifecycle.js';
import { mutateWorkspaceMembership } from './workspaceMembershipOperations.js';
import { authorityTransaction } from './workspaceOperationReceipts.js';
import { ensureWorkspaceWallet, walletBalance } from './walletService.js';
import { listObjectTuples, writeTuples, ROLE_RANK } from '../utils/authzReBAC.js';
import { AnafConnector, InvoiceSeries, buildCreditNote, buildInvoice, checkRegistration, countryOf, invoiceBlocker, invoiceProfileFor, isCurrency, sellerParty, toUbl } from '../vendor/xeno-company/company-legal.mjs';

const { CompanyError, can, companyOf, manager } = company;
export { CompanyError };
const refuse = (message, code, status = 400) => new CompanyError(message, code, status);

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ROLE_OUT = { owner: 'owner', admin: 'admin', editor: 'member', member: 'member', viewer: 'viewer' };
const ROLE_ORDER = ['viewer', 'member', 'admin', 'owner'];
const iso = (d) => new Date(d).toISOString();
const credits = (micro) => Number(micro || 0) / 1e6;
/** Bounded so a slow register can never hold a person's founding or a worker. */
const REGISTER_TIMEOUT_MS = 10_000;
const defaultConnector = (jurisdiction) => (jurisdiction === 'RO'
  ? new AnafConnector({ fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS) }) })
  : null);

async function person(db, me) {
  if ((await resolvePrincipal(db, me.id)).kind !== 'human') throw refuse('A person does this, not an agent or a service.', 'person_only', 403);
}
/** The membership service refuses with typed errors; these are the words a person reads. */
const MEMBERSHIP_WORDS = {
  owner_transfer_required: ['Transfer ownership first: a company always has an owner.', 409],
  member_not_found: ['They aren’t a member.', 404],
  invite_not_found: ['There is no pending invitation.', 404],
  already_member: ['They’re already a member.', 409],
  invite_already_pending: ['They’re already invited.', 409],
  seat_limit: ['Every seat is taken.', 402],
  workspace_admin_required: ['Owners and admins manage the company.', 403],
  invalid_membership_request: ['That isn’t a valid request.', 400],
};
async function membership(pool, workspaceId, me, action, input) {
  try { return (await mutateWorkspaceMembership(pool, workspaceId, me.id, null, null, action, input, { legacy: true })).result; }
  catch (e) {
    if (!e.status) throw e;
    const [message, status] = MEMBERSHIP_WORDS[e.code] || ['That couldn’t be done.', e.status];
    throw refuse(message, e.code, status);
  }
}

// ---------- the org ----------
const noNulls = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) : o);
async function registrationOf(db, w) {
  // A company set up in Corpo › Company may hold a registration or a VAT number and no separate tax id, and that is enough.
  const [tinRow, profile, primary, vat] = await Promise.all([
    db.query(`SELECT id, number, jurisdiction FROM org_tax_identifiers WHERE workspace_id = $1 AND scheme = 'tin' ORDER BY created_at LIMIT 1`, [w.id]),
    db.query('SELECT legal_name, legal_form, registered_office, central_administration FROM org_profiles WHERE workspace_id = $1', [w.id]),
    db.query(`SELECT jurisdiction, register_name, national_number, euid FROM org_registrations WHERE workspace_id = $1 AND role = 'primary'`, [w.id]),
    db.query(`SELECT prefix, number, jurisdiction FROM org_tax_identifiers WHERE workspace_id = $1 AND scheme = 'vat' ORDER BY created_at`, [w.id]),
  ]);
  const tin = tinRow.rows[0];
  if (!tin && !primary.rows.length && !vat.rows.length) return {};
  const check = tin ? await db.query(`SELECT raw_response FROM org_identifier_checks WHERE tax_identifier_id = $1 AND result = 'valid' ORDER BY checked_at DESC LIMIT 1`, [tin.id]) : { rows: [] };
  const p = profile.rows[0] || {}, reg = primary.rows[0], j = tin?.jurisdiction ?? reg?.jurisdiction ?? vat.rows[0].jurisdiction;
  const registration = {
    jurisdiction: j,
    legalForm: p.legal_form || '',
    ...(p.legal_name ? { legalName: p.legal_name } : {}),
    ...(reg?.register_name ? { register: reg.register_name } : {}),
    identifiers: [
      ...(tin ? [{ kind: 'national', value: tin.number, jurisdiction: j }] : []),
      ...(reg ? [{ kind: 'registry', value: reg.national_number, jurisdiction: j }] : []),
      ...(reg?.euid ? [{ kind: 'euid', value: reg.euid, jurisdiction: j }] : []),
      ...vat.rows.map((v) => ({ kind: 'vat', value: `${v.prefix ?? ''}${v.number}`, jurisdiction: v.jurisdiction })),
    ],
    registeredOffice: noNulls(p.registered_office) || { line1: '', city: '', postalCode: '', country: countryOf(j) },
    ...(p.central_administration ? { centralAdministration: noNulls(p.central_administration) } : {}),
  };
  const evidence = check.rows[0]?.raw_response;
  return { registration, ...(evidence ? { registrationEvidence: evidence } : {}) };
}
const orgShape = async (db, w) => ({
  id: w.id, kind: w.workspace_type, name: w.name, slug: w.slug, status: w.status, ownerUserId: w.owner_user_id, createdAt: iso(w.created_at),
  ...(await registrationOf(db, w)),
});

export async function getOrg(db, me, id) { return orgShape(db, await companyOf(db, me, id)); }

export async function listOrgs(db, me) {
  if (!db.previewReadOnly) await ensurePersonalWorkspace(db, me.id);
  const rows = (await db.query(`SELECT DISTINCT w.id, w.name, w.slug, w.workspace_type, w.status, w.owner_user_id, w.created_at FROM workspaces w
     JOIN relationship_tuples rt ON rt.object_type = 'workspace' AND rt.object_id = w.id::text AND rt.subject_type = 'user' AND rt.subject_id = $1
    WHERE w.status = 'active' ORDER BY w.name`, [String(me.id)])).rows;
  return Promise.all(rows.map((w) => orgShape(db, w)));
}

function cleanRegistration(r) {
  if (r == null) return null;
  const v = checkRegistration(r);
  if (!v.ok) throw refuse(v.message, v.code);
  return v;
}

export async function createOrg(pool, me, input = {}, { connector = defaultConnector } = {}) {
  await person(pool, me);
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 200) throw refuse('Give the company a name.', 'name_required');
  if (!SLUG.test(String(input.slug ?? ''))) throw refuse('The slug needs 3 to 40 lowercase letters, digits or hyphens.', 'invalid_slug');
  const reg = cleanRegistration(input.registration);
  let workspace;
  try {
    workspace = await authorityTransaction(pool, async (db) => {
      const w = await createAccountWorkspace(db, me.id, name, 'company', input.slug);
      if (reg) {
        await db.query('INSERT INTO org_profiles(workspace_id, legal_name, legal_form, registered_office) VALUES($1,$2,$3,$4)', [w.id, reg.legalName ?? null, reg.legalForm, reg.registeredOffice ?? null]);
        await db.query(`INSERT INTO org_tax_identifiers(workspace_id, scheme, number, jurisdiction) VALUES($1,'tin',$2,$3)`, [w.id, reg.nationalId, reg.jurisdiction]);
        // Through the service Corpo › Company uses, so its rules are the same ones.
        if (reg.registryNumber) await company.addRegistration(db, me, w.id, { jurisdiction: reg.jurisdiction, register: reg.register || `${reg.jurisdiction} register`, number: reg.registryNumber });
        if (reg.vatId) {
          const m = /^([A-Z]{2})(.+)$/.exec(reg.vatId);
          await company.addTax(db, me, w.id, { scheme: 'vat', jurisdiction: reg.jurisdiction, prefix: m?.[1] ?? countryOf(reg.jurisdiction), number: m?.[2] ?? reg.vatId });
        }
      }
      return w;
    });
  } catch (e) {
    if (e?.code === '23505') throw refuse(`The slug ${input.slug} is taken.`, 'slug_taken', 409);
    throw e;
  }
  // Confirming is best effort: a register being down means "not verified yet", and must never stop a company being founded.
  if (reg) { try { return await verifyRegistration(pool, me, workspace.id, { connector }); } catch { /* stays unverified */ } }
  return orgShape(pool, workspace);
}

export async function verifyRegistration(pool, me, id, { connector = defaultConnector } = {}) {
  const w = await manager(pool, me, id);
  const tin = (await pool.query(`SELECT id, number, jurisdiction FROM org_tax_identifiers WHERE workspace_id = $1 AND scheme = 'tin' ORDER BY created_at LIMIT 1`, [id])).rows[0];
  if (!tin) throw refuse('This company has no registration to verify.', 'no_registration');
  const register = connector(tin.jurisdiction);
  if (!register) throw refuse('No register is connected for this country, so what the company states stands.', 'no_register', 503);
  let r;
  try { r = await register.lookupEntity(tin.number); }
  catch { r = { status: 'unavailable', evidence: { checkedAt: new Date().toISOString(), asOf: new Date().toISOString().slice(0, 10), source: 'register' } }; }
  const found = r.status === 'found' && r.entity;
  const evidence = { ...r.evidence, ...(r.entity?.legalName ? { verifiedName: r.entity.legalName } : {}) };
  // What the register answered is kept whatever it was. not_found and unavailable are different facts and stay different.
  await pool.query(`INSERT INTO org_identifier_checks(tax_identifier_id, workspace_id, identifier, result, consultation_number, raw_response, checked_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [tin.id, id, tin.number, found ? 'valid' : r.status === 'not_found' ? 'invalid' : 'unverifiable', r.evidence?.reference ?? null, evidence, me.id]);
  if (!found) throw r.status === 'not_found' ? refuse(`${tin.number} isn’t in the ${tin.jurisdiction} register.`, 'not_in_register', 404) : refuse('The national register didn’t answer. Try again later.', 'register_unavailable', 503);
  await authorityTransaction(pool, async (db) => {
    const e = r.entity;
    await db.query(`INSERT INTO org_profiles(workspace_id, legal_name, registered_office) VALUES($1,$2,$3)
      ON CONFLICT (workspace_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, registered_office = COALESCE(EXCLUDED.registered_office, org_profiles.registered_office), updated_at = now()`,
    [id, e.legalName, e.address ?? null]);
    if (e.registryId) {
      await db.query(`INSERT INTO org_registrations(workspace_id, jurisdiction, register_name, national_number, role) VALUES($1,$2,$3,$4,'primary')
        ON CONFLICT (workspace_id) WHERE role = 'primary' DO UPDATE SET national_number = EXCLUDED.national_number`, [id, tin.jurisdiction, register.registerName ?? `${tin.jurisdiction} register`, e.registryId]);
    }
    // Only when the register says so: a company can hold a tax id and no VAT number (§4.2 rule 1).
    if (e.vatRegistered) {
      await db.query(`INSERT INTO org_tax_identifiers(workspace_id, scheme, prefix, number, jurisdiction) VALUES($1,'vat',$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, tin.jurisdiction, tin.number, tin.jurisdiction]);
    }
  });
  return orgShape(pool, w);
}

// ---------- members: humans and agents in one list ----------
async function agentRows(db, workspaceId) {
  return (await db.query(`SELECT ai.public_id, ai.user_id, COALESCE(u.display_name, u.username) AS name, r.created_at, t.relation, e.mind_id, e.employed_at, v.content->'requestedCapabilities' AS capabilities
      FROM workforce_resources r
      JOIN agent_identities ai ON ai.workforce_resource_id = r.id AND ai.status <> 'retired'
      JOIN users u ON u.id = ai.user_id
      LEFT JOIN org_agent_employments e ON e.workspace_id = r.owner_workspace_id AND e.agent_user_id = ai.user_id
      LEFT JOIN relationship_tuples t ON t.object_type = 'workspace' AND t.object_id = r.owner_workspace_id::text AND t.subject_type = 'agent' AND t.subject_id = ai.user_id::text
      LEFT JOIN LATERAL (SELECT content FROM workforce_agent_versions WHERE resource_id = r.id ORDER BY version DESC LIMIT 1) v ON true
     WHERE r.owner_workspace_id = $1 AND r.kind = 'agent' AND r.status = 'active'`, [workspaceId])).rows;
}
/** An agent the workspace made itself has no employment row yet: it is staff all the same, as a member, running its own definition. */
const agentMember = (orgId, a) => ({
  orgId, kind: 'agent', subjectId: a.public_id, role: ROLE_OUT[a.relation] || 'member', displayName: a.name, joinedAt: iso(a.employed_at || a.created_at),
  employment: { mindId: a.mind_id || a.public_id, employedAt: iso(a.employed_at || a.created_at), capabilities: Array.isArray(a.capabilities) ? a.capabilities : [] },
});
async function humanRoles(db, workspaceId) {
  const best = new Map();
  for (const t of await listObjectTuples(db, `workspace:${workspaceId}`)) {
    if (!t.subject.startsWith('user:')) continue;
    const id = t.subject.slice(5), old = best.get(id);
    if (!old || (ROLE_RANK[t.relation] ?? 0) > (ROLE_RANK[old] ?? 0)) best.set(id, t.relation);
  }
  return best;
}
export async function listMembers(db, me, id) {
  const w = await companyOf(db, me, id);
  const roles = await humanRoles(db, id), ids = [...roles.keys()];
  const rows = await agentRows(db, id), agentIdentity = new Set(rows.map((a) => String(a.user_id)));
  const users = ids.length ? (await db.query(`SELECT u.id, COALESCE(u.display_name, u.username, u.email) AS name,
      (SELECT min(t.created_at) FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.object_id = $2 AND t.subject_type = 'user' AND t.subject_id = u.id::text) AS joined
    FROM users u WHERE u.id = ANY($1::uuid[])`, [ids, id])).rows : [];
  const humans = users.filter((u) => !agentIdentity.has(String(u.id))).map((u) => ({ orgId: id, kind: 'human', subjectId: u.id, role: ROLE_OUT[roles.get(u.id)] || 'viewer', displayName: u.name, joinedAt: iso(u.joined || w.created_at) }));
  return [...humans, ...rows.map((a) => agentMember(id, a))].sort((a, b) => ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role) || a.displayName.localeCompare(b.displayName));
}

const inviteShape = (orgId, i) => ({ id: i.id, orgId, email: i.invited_email, role: ROLE_OUT[i.role] || i.role, status: i.status, invitedAt: iso(i.created_at), expiresAt: iso(i.expires_at) });
export async function inviteMember(pool, me, id, body = {}) {
  await companyOf(pool, me, id);
  const result = await membership(pool, id, me, 'invite.create', { email: body.email, role: body.role });
  return inviteShape(id, result.invite);
}
export async function listInvites(db, me, id) {
  await companyOf(db, me, id);
  // the addresses of people who haven't joined are for those who manage the company, as on GET /api/workspaces/:id/invites
  if (!await can(db, me.id, id, 'admin')) throw refuse('Owners and admins see invitations.', 'forbidden', 403);
  return (await db.query(`SELECT * FROM workspace_invites WHERE workspace_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at DESC`, [id])).rows.map((i) => inviteShape(id, i));
}
export async function revokeInvite(pool, me, id, inviteId) {
  await companyOf(pool, me, id);
  realId(inviteId, 'There is no pending invitation.', 'invite_not_found');
  await membership(pool, id, me, 'invite.revoke', { inviteId });
}

const isAgentId = (subject) => String(subject).startsWith('agt_');
// An id that can't exist reads the same as one that doesn't: not found, never a malformed-request hint.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const realId = (id, message, code) => { if (!UUID.test(String(id))) throw refuse(message, code, 404); return id; };
async function companyAgent(db, id, publicId) {
  const a = (await agentRows(db, id)).find((x) => x.public_id === publicId);
  if (!a) throw refuse('They aren’t a member.', 'member_not_found', 404);
  return a;
}
const audit = (db, id, me, action, target, metadata) => db.query('INSERT INTO workspace_audit(workspace_id, actor_user_id, action, target, metadata) VALUES($1,$2,$3,$4,$5)', [id, me.id, action, String(target).slice(0, 200), JSON.stringify(metadata)]);
const cleanCaps = (list) => {
  if (list != null && !Array.isArray(list)) throw refuse('Capabilities are a list.', 'invalid_capabilities');
  return [...new Set((list || []).map((c) => String(c).trim()).filter(Boolean))].sort();
};
/** D18: authority lives in ReBAC, so an agent's role is a tuple. ReBAC already keeps subject agent out of role escalation. */
const setAgentRole = async (db, id, agentUserId, role, from) => writeTuples(db, {
  deletes: from ? [{ object: `workspace:${id}`, relation: from, subject: `agent:${agentUserId}` }] : [],
  writes: [{ object: `workspace:${id}`, relation: role === 'member' ? 'editor' : role, subject: `agent:${agentUserId}` }],
});
// companyEntity.manager has just established this caller is a person.
const asPerson = (me) => ({ id: me.id, kind: 'human' });
const agentRefusal = (e) => (e instanceof agents.AgentError ? refuse(e.message, e.code, e.status) : e);

export async function employAgent(pool, me, id, body = {}) {
  await manager(pool, me, id);
  const mindId = String(body.mindId ?? '').trim(), displayName = String(body.displayName ?? '').trim();
  if (!mindId || mindId.length > 200) throw refuse('Choose the Mind to employ.', 'mind_required');
  if (!displayName) throw refuse('Give the agent a name.', 'name_required');
  // An agent cannot own the company, as the platform's ReBAC already rules.
  if (body.role === 'owner') throw refuse('An agent can’t be an owner.', 'agent_cannot_own', 403);
  if (!['admin', 'member', 'viewer'].includes(body.role)) throw refuse('Choose a role.', 'invalid_role');
  const capabilities = cleanCaps(body.capabilities);
  let made;
  try { made = await agents.create(pool, asPerson(me), { name: displayName, workspaceId: id, requestedCapabilities: capabilities }); }
  catch (e) { throw agentRefusal(e); }
  try {
    const user = (await pool.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [made.id])).rows[0];
    await pool.query('INSERT INTO org_agent_employments(workspace_id, agent_user_id, mind_id, created_by_user_id) VALUES($1,$2,$3,$4)', [id, user.user_id, mindId, me.id]);
    await setAgentRole(pool, id, user.user_id, body.role);
    await audit(pool, id, me, 'agent.employed', made.id, { name: displayName, mindId });
  } catch (e) { await agents.remove(pool, asPerson(me), made.id).catch(() => {}); throw e; }
  return agentMember(id, await companyAgent(pool, id, made.id));
}

export async function removeMember(pool, me, id, subject) {
  if (!isAgentId(subject)) {
    await companyOf(pool, me, id);
    realId(subject, 'They aren’t a member.', 'member_not_found');
    await membership(pool, id, me, 'member.remove', { memberId: subject });
    return;
  }
  await manager(pool, me, id);
  const a = await companyAgent(pool, id, subject);
  try { await agents.remove(pool, asPerson(me), subject); } catch (e) { throw agentRefusal(e); }
  await pool.query('DELETE FROM org_agent_employments WHERE workspace_id = $1 AND agent_user_id = $2', [id, a.user_id]);
  await audit(pool, id, me, 'agent.removed', subject, { name: a.name });
}

export async function changeRole(pool, me, id, subject, role) {
  if (!ROLE_ORDER.includes(role)) throw refuse('Choose a role.', 'invalid_role');
  if (isAgentId(subject)) {
    await manager(pool, me, id);
    const a = await companyAgent(pool, id, subject);
    if (role === 'owner') throw refuse('An agent can’t be an owner.', 'agent_cannot_own', 403);
    const from = ROLE_OUT[a.relation] || 'member';
    if (from === role) return;
    await setAgentRole(pool, id, a.user_id, role, a.relation);
    await audit(pool, id, me, 'agent.role_changed', subject, { name: a.name, from, to: role });
    return;
  }
  await companyOf(pool, me, id);
  const current = (await humanRoles(pool, id)).get(subject);
  if (!current) throw refuse('They aren’t a member.', 'member_not_found', 404);
  if (ROLE_OUT[current] === role) return;
  // One owner, always a person: moving it is a transfer the owner makes, in Workspace › Members, never a role edit.
  if (role === 'owner') throw refuse('Transfer ownership first: a company has one owner.', 'owner_transfer_required', 409);
  await membership(pool, id, me, 'member.role', { memberId: subject, role });
}

export async function setAgentCapabilities(pool, me, id, publicId, list) {
  await manager(pool, me, id);
  if (!isAgentId(publicId)) {
    if ((await humanRoles(pool, id)).has(publicId)) throw refuse('Only an employed agent has capabilities.', 'not_an_agent');
    throw refuse('They aren’t a member.', 'member_not_found', 404);
  }
  const a = await companyAgent(pool, id, publicId);
  const next = cleanCaps(list), before = [...(a.capabilities || [])].sort();
  if (before.join() !== next.join()) {
    try { await agents.update(pool, asPerson(me), publicId, { requestedCapabilities: next }); } catch (e) { throw agentRefusal(e); }
    await audit(pool, id, me, 'agent.capabilities_changed', publicId, { name: a.name, from: before.length, to: next.length });
  }
  return agentMember(id, await companyAgent(pool, id, publicId));
}

// ---------- activity: what was recorded, in the dashboard's closed set of kinds ----------
const KIND = { 'workspace.create': 'company.created', 'invite.create': 'member.invited', 'invite.revoke': 'invite.revoked', 'member.remove': 'member.removed', 'agent.removed': 'member.removed',
  'member.role': 'member.role_changed', 'agent.role_changed': 'member.role_changed', 'agent.employed': 'agent.employed', 'agent.capabilities_changed': 'agent.capabilities_changed', 'invoice.issued': 'invoice.issued', 'invoice.credited': 'invoice.credited' };
export async function listActivity(db, me, id) {
  const w = await companyOf(db, me, id);
  const rows = (await db.query(`SELECT a.id, a.action, a.target, a.metadata, a.created_at, i.invited_email, i.role AS invited_role, COALESCE(u.display_name, u.username, u.email) AS person
      FROM workspace_audit a
      LEFT JOIN workspace_invites i ON a.action LIKE 'invite.%' AND i.id::text = a.target
      LEFT JOIN users u ON a.action LIKE 'member.%' AND u.id::text = a.target
     WHERE a.workspace_id = $1 AND a.action = ANY($2::text[]) ORDER BY a.created_at DESC, a.id DESC LIMIT 500`, [id, Object.keys(KIND)])).rows;
  return rows.map((r) => {
    const m = r.metadata || {}, kind = KIND[r.action];
    const subject = r.action === 'workspace.create' ? w.name : r.action.startsWith('invite.') ? (r.invited_email || 'An invitation') : r.action.startsWith('member.') ? (r.person || 'A former member') : r.action.startsWith('invoice.') ? r.target : (m.name || 'An agent');
    const detail = r.action === 'invite.create' ? (ROLE_OUT[r.invited_role] || r.invited_role)
      : kind === 'member.role_changed' ? `${ROLE_OUT[m.from] || m.from} → ${ROLE_OUT[m.to] || m.to}`
        : r.action === 'agent.employed' ? m.mindId
          : r.action === 'agent.capabilities_changed' ? `${m.from} → ${m.to}`
            : r.action.startsWith('invoice.') ? m.detail : undefined;
    return { id: String(r.id), orgId: id, kind, at: iso(r.created_at), subject, ...(detail != null ? { detail } : {}) };
  });
}

// ---------- the wallet: read only, always ----------
const walletSubject = (w) => (w.workspace_type === 'personal' ? w.owner_user_id : w.id);
export async function getWallet(pool, me, id) {
  const w = await companyOf(pool, me, id);
  if (w.workspace_type !== 'personal') {
    try { await ensureWorkspaceWallet(pool, id); }
    catch { throw refuse('This company’s wallet is registered as a personal one.', 'WALLET_KIND_CONFLICT', 409); }
  }
  const b = await walletBalance(pool, walletSubject(w));
  return { orgId: id, balance: credits(b.postedMicro), held: credits(b.pendingMicro), currency: 'credits', frozen: !!b.is_frozen };
}
/** Newest first: the journal, plus each open hold. Direction is the kind, amounts are always positive. */
export async function listTransactions(db, me, id) {
  const w = await companyOf(db, me, id), subject = walletSubject(w);
  const [journal, holds] = await Promise.all([
    db.query(`SELECT t.id, t.type, t.amount, t.description, t.reference_type, t.created_at FROM credit_transactions t JOIN credit_accounts a ON a.id = t.account_id
       WHERE a.user_id = $1 AND t.amount <> 0 ORDER BY t.created_at DESC LIMIT 500`, [subject]),
    db.query(`SELECT id, operation, surface, amount_micro, settled_micro, created_at FROM credit_holds WHERE user_id = $1 AND state = 'held' ORDER BY created_at DESC LIMIT 500`, [subject]),
  ]);
  const entries = [
    ...journal.rows.map((t) => ({ id: String(t.id), orgId: id, at: iso(t.created_at), kind: Number(t.amount) > 0 ? 'grant' : 'spend', amount: Math.abs(credits(t.amount)), description: t.description || t.type, ...(t.reference_type ? { source: t.reference_type } : {}) })),
    ...holds.rows.map((h) => ({ id: String(h.id), orgId: id, at: iso(h.created_at), kind: 'hold', amount: credits(Number(h.amount_micro) - Number(h.settled_micro)), description: h.operation, source: h.surface })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- invoices: legal documents ----------
/** The next number, taken under the series row's lock in the caller's transaction: a rollback gives it back. */
async function nextNumber(db, org, issuedAt) {
  const series = `${org.slug.toUpperCase().slice(0, 8)}-${new Date(issuedAt).getUTCFullYear()}`;
  const n = (await db.query(`INSERT INTO org_invoice_series(workspace_id, series, last_number) VALUES($1,$2,1)
    ON CONFLICT (workspace_id, series) DO UPDATE SET last_number = org_invoice_series.last_number + 1 RETURNING last_number`, [org.id, series])).rows[0].last_number;
  return new InvoiceSeries(series, n).issue();
}
const invoiceShape = (orgId, r) => ({ number: r.number, orgId, issuedAt: iso(r.issued_at), invoice: r.document, ubl: r.ubl, ...(r.credited_by ? { creditedBy: r.credited_by } : {}) });

export async function issueInvoice(pool, me, id, input = {}) {
  const w = await manager(pool, me, id);
  const org = await orgShape(pool, w);
  const blocked = invoiceBlocker(org.registration);
  if (blocked) throw refuse(blocked, org.registration ? 'no_registered_office' : 'not_registered');
  if (!Array.isArray(input.lines) || !input.lines.length) throw refuse('An invoice needs at least one line.', 'no_lines');
  if (!isCurrency(input.currency)) throw refuse('Choose the invoice’s currency.', 'invalid_currency');
  const profile = invoiceProfileFor(org.registration.jurisdiction);
  // A small business charges no tax on anything, for one reason it has stated once. Category E, because O forbids a seller VAT id.
  const tax = (await pool.query('SELECT tax_status, tax_status_note FROM org_profiles WHERE workspace_id = $1', [id])).rows[0];
  const small = tax?.tax_status === 'small_business';
  if (small && input.lines.some((l) => Number(l.vatRate) > 0)) throw refuse('This business is set as a small business, which charges no tax. Change that in its details first.', 'small_business_no_tax');
  const lines = small ? input.lines.map(({ vatRate, ...l }) => ({ ...l, vatCategory: 'E', exemptionReason: tax.tax_status_note })) : input.lines;
  return authorityTransaction(pool, async (db) => {
    const issuedAt = new Date().toISOString();
    const number = await nextNumber(db, org, issuedAt);
    let invoice;
    try {
      invoice = buildInvoice({ specificationId: profile.specificationId, id: number, issueDate: issuedAt.slice(0, 10), currency: input.currency, seller: sellerParty(org), buyer: input.buyer, lines,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}), ...(input.paymentTerms ? { paymentTerms: input.paymentTerms } : {}), ...(input.note ? { note: input.note } : {}), ...(input.orderReference ? { orderReference: input.orderReference } : {}) });
    } catch (e) { throw refuse(e instanceof Error ? e.message : 'That invoice isn’t valid.', 'invalid_invoice'); }
    // Checked before it is stored. Refusing here rolls the number back, so an invalid invoice never leaves a gap.
    const check = profile.validate(invoice);
    if (!check.valid) throw refuse(`The invoice fails validation: ${check.violations.map((v) => `${v.rule} ${v.message}`).join('; ')}`, 'invalid_invoice');
    const row = (await db.query(`INSERT INTO org_issued_invoices(workspace_id, number, kind, document, ubl, issued_at, issued_by_user_id) VALUES($1,$2,'invoice',$3,$4,$5,$6) RETURNING *`,
      [id, number, invoice, toUbl(invoice), issuedAt, me.id])).rows[0];
    await audit(db, id, me, 'invoice.issued', number, { detail: input.buyer?.name });
    return invoiceShape(id, row);
  });
}

export async function listInvoices(db, me, id) {
  await companyOf(db, me, id);
  return (await db.query('SELECT * FROM org_issued_invoices WHERE workspace_id = $1 ORDER BY issued_at DESC, number DESC', [id])).rows.map((r) => invoiceShape(id, r));
}

export async function creditInvoice(pool, me, id, number, reason) {
  const w = await manager(pool, me, id);
  return authorityTransaction(pool, async (db) => {
    const original = (await db.query('SELECT * FROM org_issued_invoices WHERE workspace_id = $1 AND number = $2 FOR UPDATE', [id, number])).rows[0];
    if (!original) throw refuse(`There is no invoice ${number}.`, 'invoice_not_found', 404);
    if (original.kind !== 'invoice') throw refuse('A credit note can’t be credited.', 'not_an_invoice', 409);
    if (original.credited_by) throw refuse(`${number} was already credited by ${original.credited_by}.`, 'already_credited', 409);
    const issuedAt = new Date().toISOString();
    const cnNumber = await nextNumber(db, w, issuedAt);
    const note = buildCreditNote(original.document, { id: cnNumber, issueDate: issuedAt.slice(0, 10), ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {}) });
    const row = (await db.query(`INSERT INTO org_issued_invoices(workspace_id, number, kind, document, ubl, credits_number, issued_at, issued_by_user_id) VALUES($1,$2,'credit_note',$3,$4,$5,$6,$7) RETURNING *`,
      [id, cnNumber, note, toUbl(note), number, issuedAt, me.id])).rows[0];
    await db.query('UPDATE org_issued_invoices SET credited_by = $3 WHERE workspace_id = $1 AND number = $2', [id, number, cnNumber]);
    await audit(db, id, me, 'invoice.credited', number, { detail: cnNumber });
    return invoiceShape(id, row);
  });
}
