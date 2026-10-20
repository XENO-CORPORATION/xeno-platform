/**
 * XENO Customers — the workspace CRM (corpo.customers). One service: the screens, /api/customers and the agent tools
 * (customersMcp.js) all call these functions.
 *
 * OWNERSHIP (XENO-WORKFORCE-01 §8.11): contacts, companies, deals and their timeline belong to the WORKSPACE.
 *   viewer  reads;  editor  writes;  admin (a HUMAN)  deletes and GDPR-erases.
 * An agent acts for its owner and never above them. It READS and DRAFTS: a note it writes and a deal it proposes are
 * drafts until a person keeps them; it cannot delete or erase. The database holds the draft rule too (CHECK + trigger).
 *
 * LINKS, NOT COPIES: a contact's support tickets come from supportTickets.js and its tasks from xenoTasks.js, each
 * read through its own service as the caller — a link never lets anyone see a record its owner would not show them.
 */
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import * as support from './supportTickets.js';
import * as xenoTasks from './xenoTasks.js';

export class CustomersError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'CustomersError'; this.code = code; this.statusCode = status; }
}

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting'];
export const DEFAULT_STAGES = [['Lead', 'open'], ['Qualified', 'open'], ['Proposal', 'open'], ['Won', 'won'], ['Lost', 'lost']];
export const IMPORT_MAX_ROWS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isAgent = (a) => a && a.kind === 'agent';

const text = (v, field, max, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new CustomersError(`${field} is required`, `${field}_required`);
  if (s.length > max) throw new CustomersError(`${field} is longer than ${max} characters`, `${field}_too_long`);
  return s || null;
};
const email = (v) => {
  const s = text(v, 'email', 320, false);
  if (s && !EMAIL.test(s)) throw new CustomersError('That email address does not look right', 'invalid_email');
  return s ? s.toLowerCase() : null;
};
const id = (v, field) => { if (!UUID.test(String(v || ''))) throw new CustomersError(`Invalid ${field}`, `invalid_${field}`); return String(v); };

// ─────────────────────────────────────────── who may do what, in which workspace
async function personOf(db, actor) {
  if (!actor || !actor.id) throw new CustomersError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'service') throw new CustomersError('A service account cannot use Customers', 'not_allowed', 403);
  if (!isAgent(actor)) return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new CustomersError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the workspace (default: the person's Personal one) and check the person holds `need` there. */
export async function workspaceFor(db, actor, workspaceId, need = 'viewer') {
  const who = await personOf(db, actor);
  if ((need === 'admin') && who.agentId) throw new CustomersError('Only a person can do that', 'human_only', 403);
  let ws = workspaceId ? String(workspaceId) : null;
  if (ws && !UUID.test(ws)) throw new CustomersError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const r = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!r.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new CustomersError('You are not a member of that workspace', 'not_a_member', 403);
    throw new CustomersError(need === 'admin' ? 'Only a workspace admin can do that' : 'Only editors and admins can do that', need === 'admin' ? 'admin_required' : 'editor_required', 403);
  }
  return { ...who, workspaceId: ws };
}

async function contactRow(db, ctx, contactId) {
  const r = (await db.query('SELECT * FROM crm_contacts WHERE id = $1 AND workspace_id = $2', [id(contactId, 'contact'), ctx.workspaceId])).rows[0];
  if (!r) throw new CustomersError('Contact not found', 'contact_not_found', 404);
  return r;
}
const shapeContact = (r) => r && ({ id: r.id, workspaceId: r.workspace_id, name: r.name, email: r.email, phone: r.phone, title: r.title,
  tags: r.tags || [], source: r.source, companyId: r.company_id, companyName: r.company_name || null, createdAt: r.created_at, updatedAt: r.updated_at,
  url: `/workspace/corpo/customers/contacts/${r.id}` });
const shapeCompany = (r) => r && ({ id: r.id, name: r.name, domain: r.domain, notes: r.notes, contacts: r.contacts != null ? Number(r.contacts) : undefined, createdAt: r.created_at });
const shapeDeal = (r) => r && ({ id: r.id, title: r.title, amountCents: Number(r.amount_cents), currency: r.currency, closeDate: r.close_date,
  stageId: r.stage_id, stageName: r.stage_name || null, outcome: r.outcome || null, state: r.state, contactId: r.contact_id, companyId: r.company_id, contactName: r.contact_name || null });
const shapeActivity = (r) => ({ id: r.id, kind: r.kind, body: r.body, state: r.state, agentDrafted: r.agent_drafted, authorName: r.author_name || null,
  contactId: r.contact_id, dealId: r.deal_id, createdAt: r.created_at });

// ─────────────────────────────────────────── contacts
export async function listContacts(db, actor, { workspace, q, companyId, tag, limit = 200 } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const args = [ctx.workspaceId], where = ['c.workspace_id = $1'];
  if (q) { args.push(`%${String(q).slice(0, 100).toLowerCase()}%`); where.push(`(lower(c.name) LIKE $${args.length} OR lower(COALESCE(c.email,'')) LIKE $${args.length})`); }
  if (companyId) { args.push(id(companyId, 'company')); where.push(`c.company_id = $${args.length}`); }
  if (tag) { args.push(String(tag)); where.push(`$${args.length} = ANY(c.tags)`); }
  args.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const rows = (await db.query(`SELECT c.*, co.name AS company_name FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
    WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT $${args.length}`, args)).rows;
  return rows.map(shapeContact);
}

async function companyIn(db, ctx, companyId) {
  if (!companyId) return null;
  const r = (await db.query('SELECT id FROM crm_companies WHERE id = $1 AND workspace_id = $2', [id(companyId, 'company'), ctx.workspaceId])).rows[0];
  if (!r) throw new CustomersError('Company not found', 'company_not_found', 404);
  return r.id;
}
const tagsOf = (v) => Array.isArray(v) ? [...new Set(v.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : [];

export async function createContact(db, actor, input = {}) {
  const ctx = await workspaceFor(db, actor, input.workspace, 'editor');
  const name = text(input.name, 'name', 200), mail = email(input.email);
  const companyId = await companyIn(db, ctx, input.companyId);
  if (mail) {
    const dup = (await db.query('SELECT id FROM crm_contacts WHERE workspace_id = $1 AND lower(email) = $2', [ctx.workspaceId, mail])).rows[0];
    if (dup) { const e = new CustomersError('A contact with that email already exists', 'duplicate_contact', 409); e.existingId = dup.id; throw e; }
  }
  const source = ctx.agentId ? 'agent' : (['import', 'form'].includes(input.source) ? input.source : 'manual');
  const r = (await db.query(`INSERT INTO crm_contacts (workspace_id, company_id, name, email, phone, title, tags, source, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [ctx.workspaceId, companyId, name, mail, text(input.phone, 'phone', 60, false), text(input.title, 'title', 200, false), tagsOf(input.tags), source, ctx.agentId || ctx.userId])).rows[0];
  return shapeContact(r);
}

export async function updateContact(db, actor, contactId, input = {}) {
  const ctx = await workspaceFor(db, actor, input.workspace, 'editor');
  const c = await contactRow(db, ctx, contactId);
  const next = {
    name: input.name !== undefined ? text(input.name, 'name', 200) : c.name,
    email: input.email !== undefined ? email(input.email) : c.email,
    phone: input.phone !== undefined ? text(input.phone, 'phone', 60, false) : c.phone,
    title: input.title !== undefined ? text(input.title, 'title', 200, false) : c.title,
    tags: input.tags !== undefined ? tagsOf(input.tags) : c.tags,
    company: input.companyId !== undefined ? await companyIn(db, ctx, input.companyId) : c.company_id,
  };
  if (next.email && next.email !== c.email) {
    const dup = (await db.query('SELECT id FROM crm_contacts WHERE workspace_id = $1 AND lower(email) = $2 AND id <> $3', [ctx.workspaceId, next.email, c.id])).rows[0];
    if (dup) throw new CustomersError('A contact with that email already exists', 'duplicate_contact', 409);
  }
  const r = (await db.query(`UPDATE crm_contacts SET name=$2, email=$3, phone=$4, title=$5, tags=$6, company_id=$7, updated_at=now() WHERE id=$1 RETURNING *`,
    [c.id, next.name, next.email, next.phone, next.title, next.tags, next.company])).rows[0];
  return shapeContact(r);
}

/** Delete is a person's act (admin). Erase is the GDPR form of it: everything about the person goes, a tombstone stays. */
export async function deleteContact(db, actor, contactId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  const c = await contactRow(db, ctx, contactId);
  await db.query('DELETE FROM crm_contacts WHERE id = $1', [c.id]);
  return { deleted: true, id: c.id };
}

export async function eraseContact(db, actor, contactId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  const c = await contactRow(db, ctx, contactId);
  // activities and links cascade; deals keep their amount but lose the person
  await db.query('DELETE FROM crm_contacts WHERE id = $1', [c.id]);
  await db.query('INSERT INTO crm_erasures (workspace_id, contact_id, erased_by) VALUES ($1,$2,$3)', [ctx.workspaceId, c.id, ctx.userId]);
  return { erased: true, id: c.id };
}

/** GDPR access/portability: everything this workspace holds about one contact, as data. */
export async function exportContact(db, actor, contactId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId) throw new CustomersError('Only a person can export a contact', 'human_only', 403);
  const c = await contactRow(db, ctx, contactId);
  const company = c.company_id ? (await db.query('SELECT name, domain FROM crm_companies WHERE id = $1', [c.company_id])).rows[0] : null;
  const deals = (await db.query('SELECT d.title, d.amount_cents, d.currency, d.close_date, s.name AS stage FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.contact_id = $1', [c.id])).rows;
  const activities = (await db.query("SELECT kind, body, created_at FROM crm_activities WHERE contact_id = $1 AND state = 'kept' ORDER BY created_at", [c.id])).rows;
  const links = (await db.query('SELECT target_kind, target_key FROM crm_links WHERE contact_id = $1', [c.id])).rows;
  return { format: 'xeno-customers-export@1', exportedAt: new Date().toISOString(),
    contact: { name: c.name, email: c.email, phone: c.phone, title: c.title, tags: c.tags, source: c.source, createdAt: c.created_at },
    company, deals, activities, links };
}

/** One contact with its company, deals, timeline and linked tickets/tasks (each link read through its own owner). */
export async function getContact(db, actor, contactId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const c = (await db.query('SELECT c.*, co.name AS company_name FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = $1 AND c.workspace_id = $2',
    [id(contactId, 'contact'), ctx.workspaceId])).rows[0];
  if (!c) throw new CustomersError('Contact not found', 'contact_not_found', 404);
  const deals = (await db.query(`SELECT d.*, s.name AS stage_name, s.outcome FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.contact_id = $1 ORDER BY d.created_at DESC`, [c.id])).rows.map(shapeDeal);
  const activities = (await db.query(`SELECT a.*, COALESCE(u.display_name, u.username) AS author_name FROM crm_activities a LEFT JOIN users u ON u.id = a.author_id
    WHERE a.contact_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [c.id])).rows.map(shapeActivity);
  const links = (await db.query('SELECT * FROM crm_links WHERE contact_id = $1 ORDER BY created_at', [c.id])).rows;
  const tickets = [], tasks = [];
  const seen = new Set();
  // tickets: explicit links, plus any support request raised from this workspace by a person with this email
  const auto = c.email ? (await db.query(`SELECT 'T-' || t.number AS key FROM support_tickets t JOIN users u ON u.id = t.requester_id
    WHERE t.workspace_id = $1 AND lower(u.email) = $2 ORDER BY t.created_at DESC LIMIT 50`, [ctx.workspaceId, c.email])).rows.map((r) => r.key) : [];
  for (const key of [...links.filter((l) => l.target_kind === 'support_ticket').map((l) => l.target_key), ...auto]) {
    if (seen.has(key)) continue; seen.add(key);
    try { const t = await support.getTicket(db, actor, key); tickets.push({ key: t.key, title: t.title, status: t.status, priority: t.priority, url: t.url, linked: links.some((l) => l.target_key === key) }); }
    catch { /* not readable by this caller: the link stays, the content does not show */ }
  }
  for (const l of links.filter((x) => x.target_kind === 'task')) {
    try { const t = await xenoTasks.getTask(db, actor, l.target_key); tasks.push({ key: l.target_key, title: t.title, status: t.status }); }
    catch { tasks.push({ key: l.target_key, title: null, status: null, hidden: true }); }
  }
  return { ...shapeContact(c), deals, activities, tickets, tasks };
}

// ─────────────────────────────────────────── companies
export async function listCompanies(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  return (await db.query(`SELECT co.*, (SELECT count(*) FROM crm_contacts c WHERE c.company_id = co.id) AS contacts FROM crm_companies co
    WHERE co.workspace_id = $1 ORDER BY co.name`, [ctx.workspaceId])).rows.map(shapeCompany);
}
export async function createCompany(db, actor, input = {}) {
  const ctx = await workspaceFor(db, actor, input.workspace, 'editor');
  const domain = text(input.domain, 'domain', 200, false);
  const d = domain ? domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  if (d && (await db.query('SELECT 1 FROM crm_companies WHERE workspace_id = $1 AND lower(domain) = $2', [ctx.workspaceId, d])).rowCount) throw new CustomersError('A company with that domain already exists', 'duplicate_company', 409);
  const r = (await db.query('INSERT INTO crm_companies (workspace_id, name, domain, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [ctx.workspaceId, text(input.name, 'name', 200), d, text(input.notes, 'notes', 20000, false) || '', ctx.agentId || ctx.userId])).rows[0];
  return shapeCompany(r);
}
export async function deleteCompany(db, actor, companyId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  const r = await db.query('DELETE FROM crm_companies WHERE id = $1 AND workspace_id = $2', [id(companyId, 'company'), ctx.workspaceId]);
  if (!r.rowCount) throw new CustomersError('Company not found', 'company_not_found', 404);
  return { deleted: true, id: companyId };
}

// ─────────────────────────────────────────── pipeline
async function ensureStages(db, workspaceId) {
  const n = (await db.query('SELECT count(*)::int AS n FROM crm_stages WHERE workspace_id = $1', [workspaceId])).rows[0].n;
  if (!n) for (const [i, [name, outcome]] of DEFAULT_STAGES.entries()) {
    await db.query('INSERT INTO crm_stages (workspace_id, name, position, outcome) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [workspaceId, name, i, outcome]);
  }
}
export async function pipeline(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  await ensureStages(db, ctx.workspaceId);
  const stages = (await db.query('SELECT * FROM crm_stages WHERE workspace_id = $1 ORDER BY position', [ctx.workspaceId])).rows;
  const deals = (await db.query(`SELECT d.*, s.name AS stage_name, s.outcome, c.name AS contact_name FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
    LEFT JOIN crm_contacts c ON c.id = d.contact_id WHERE d.workspace_id = $1 ORDER BY d.updated_at DESC`, [ctx.workspaceId])).rows.map(shapeDeal);
  return { stages: stages.map((s) => ({ id: s.id, name: s.name, position: s.position, outcome: s.outcome,
    deals: deals.filter((d) => d.stageId === s.id), totalCents: deals.filter((d) => d.stageId === s.id && d.state === 'active').reduce((a, d) => a + d.amountCents, 0) })) };
}
export async function createStage(db, actor, { workspace, name, outcome = 'open' } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  if (!['open', 'won', 'lost'].includes(outcome)) throw new CustomersError('Unknown outcome', 'invalid_outcome');
  const pos = (await db.query('SELECT COALESCE(max(position),-1)+1 AS p FROM crm_stages WHERE workspace_id = $1', [ctx.workspaceId])).rows[0].p;
  try {
    const r = (await db.query('INSERT INTO crm_stages (workspace_id, name, position, outcome) VALUES ($1,$2,$3,$4) RETURNING *', [ctx.workspaceId, text(name, 'name', 60), pos, outcome])).rows[0];
    return { id: r.id, name: r.name, position: r.position, outcome: r.outcome };
  } catch (e) { if (e.code === '23505') throw new CustomersError('A stage with that name exists', 'duplicate_stage', 409); throw e; }
}
async function stageIn(db, ctx, stageId) {
  await ensureStages(db, ctx.workspaceId);
  if (!stageId) return (await db.query('SELECT id FROM crm_stages WHERE workspace_id = $1 ORDER BY position LIMIT 1', [ctx.workspaceId])).rows[0].id;
  const r = (await db.query('SELECT id FROM crm_stages WHERE id = $1 AND workspace_id = $2', [id(stageId, 'stage'), ctx.workspaceId])).rows[0];
  if (!r) throw new CustomersError('Stage not found', 'stage_not_found', 404);
  return r.id;
}
async function dealRow(db, ctx, dealId) {
  const r = (await db.query('SELECT d.*, s.name AS stage_name, s.outcome FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.id = $1 AND d.workspace_id = $2', [id(dealId, 'deal'), ctx.workspaceId])).rows[0];
  if (!r) throw new CustomersError('Deal not found', 'deal_not_found', 404);
  return r;
}
/** An agent's deal is a DRAFT; a person confirms it (confirmDeal). */
export async function createDeal(db, actor, input = {}) {
  const ctx = await workspaceFor(db, actor, input.workspace, 'editor');
  const amount = Math.round(Number(input.amountCents ?? 0));
  if (!Number.isFinite(amount) || amount < 0) throw new CustomersError('Amount must be zero or more', 'invalid_amount');
  const currency = String(input.currency || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new CustomersError('Currency is a 3-letter code', 'invalid_currency');
  const contactId = input.contactId ? (await contactRow(db, ctx, input.contactId)).id : null;
  const r = (await db.query(`INSERT INTO crm_deals (workspace_id, contact_id, company_id, stage_id, title, amount_cents, currency, close_date, state, drafted_by_agent, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [ctx.workspaceId, contactId, await companyIn(db, ctx, input.companyId), await stageIn(db, ctx, input.stageId),
    text(input.title, 'title', 200), amount, currency, input.closeDate || null, ctx.agentId ? 'draft' : 'active', ctx.agentId, ctx.agentId || ctx.userId])).rows[0];
  return shapeDeal(await dealRow(db, ctx, r.id));
}
export async function moveDeal(db, actor, dealId, { workspace, stageId } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId) throw new CustomersError('Agents draft; a person moves a deal', 'human_only', 403);
  const d = await dealRow(db, ctx, dealId), to = await stageIn(db, ctx, stageId);
  await db.query('UPDATE crm_deals SET stage_id = $2, updated_at = now() WHERE id = $1', [d.id, to]);
  const moved = await dealRow(db, ctx, d.id);
  await db.query("INSERT INTO crm_activities (workspace_id, contact_id, deal_id, kind, body, author_id) VALUES ($1,$2,$3,'stage',$4,$5)",
    [ctx.workspaceId, d.contact_id, d.id, `${d.title}: ${d.stage_name} → ${moved.stage_name}`, ctx.userId]);
  return shapeDeal(moved);
}
export async function confirmDeal(db, actor, dealId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId) throw new CustomersError('Only a person confirms a drafted deal', 'human_only', 403);
  const d = await dealRow(db, ctx, dealId);
  await db.query("UPDATE crm_deals SET state = 'active', updated_at = now() WHERE id = $1", [d.id]);
  return shapeDeal(await dealRow(db, ctx, d.id));
}
export async function deleteDeal(db, actor, dealId, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  const d = await dealRow(db, ctx, dealId);
  await db.query('DELETE FROM crm_deals WHERE id = $1', [d.id]);
  return { deleted: true, id: d.id };
}

// ─────────────────────────────────────────── timeline
/** A person's note is kept at once; an agent's is a draft a person keeps (keepActivity) or discards. */
export async function addActivity(db, actor, contactId, { workspace, kind = 'note', body } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (!ACTIVITY_KINDS.includes(kind)) throw new CustomersError('Unknown activity kind', 'invalid_kind');
  const c = await contactRow(db, ctx, contactId);
  const r = (await db.query(`INSERT INTO crm_activities (workspace_id, contact_id, kind, body, state, author_id, agent_drafted) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ctx.workspaceId, c.id, kind, text(body, 'body', 20000), ctx.agentId ? 'draft' : 'kept', ctx.agentId || ctx.userId, !!ctx.agentId])).rows[0];
  await db.query('UPDATE crm_contacts SET updated_at = now() WHERE id = $1', [c.id]);
  return shapeActivity(r);
}
export async function keepActivity(db, actor, activityId, { workspace, discard = false } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId) throw new CustomersError('Only a person keeps an agent’s draft', 'human_only', 403);
  const a = (await db.query("SELECT * FROM crm_activities WHERE id = $1 AND workspace_id = $2 AND state = 'draft'", [id(activityId, 'activity'), ctx.workspaceId])).rows[0];
  if (!a) throw new CustomersError('Draft not found', 'draft_not_found', 404);
  if (discard) { await db.query('DELETE FROM crm_activities WHERE id = $1', [a.id]); return { discarded: true, id: a.id }; }
  const r = (await db.query("UPDATE crm_activities SET state = 'kept', kept_by = $2 WHERE id = $1 RETURNING *", [a.id, ctx.userId])).rows[0];
  return shapeActivity(r);
}

// ─────────────────────────────────────────── links to tickets and tasks
export async function link(db, actor, contactId, { workspace, kind, key } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const c = await contactRow(db, ctx, contactId);
  const k = String(key || '').trim().toUpperCase();
  if (kind === 'support_ticket') { await support.getTicket(db, actor, k).catch(() => { throw new CustomersError('Ticket not found', 'ticket_not_found', 404); }); }
  else if (kind === 'task') { await xenoTasks.getTask(db, actor, k).catch(() => { throw new CustomersError('Task not found', 'task_not_found', 404); }); }
  else throw new CustomersError('Link a support_ticket or a task', 'invalid_link_kind');
  await db.query('INSERT INTO crm_links (workspace_id, contact_id, target_kind, target_key, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [ctx.workspaceId, c.id, kind, k, ctx.agentId || ctx.userId]);
  await db.query("INSERT INTO crm_activities (workspace_id, contact_id, kind, body, author_id) VALUES ($1,$2,'link',$3,$4)", [ctx.workspaceId, c.id, `Linked ${kind === 'task' ? 'task' : 'ticket'} ${k}`, ctx.userId]);
  return { linked: true, kind, key: k };
}
export async function unlink(db, actor, contactId, { workspace, kind, key } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const c = await contactRow(db, ctx, contactId);
  await db.query('DELETE FROM crm_links WHERE contact_id = $1 AND target_kind = $2 AND target_key = $3', [c.id, kind, String(key || '').toUpperCase()]);
  return { unlinked: true };
}
/** Raise a XENO Tasks task about this contact and link it — there is no second tracker. */
export async function createTaskFor(db, actor, contactId, { workspace, title, projectId } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const c = await contactRow(db, ctx, contactId);
  const t = await xenoTasks.createTask(db, actor, { title: text(title, "title", 200), body: `Customer: ${c.name}${c.email ? ` <${c.email}>` : ''}`, projectId: projectId || undefined });
  await link(db, actor, c.id, { workspace: ctx.workspaceId, kind: 'task', key: t.key });
  return t;
}

// ─────────────────────────────────────────── import + dedupe
/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, CRLF. */
export function parseCsv(src) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(src || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
/**
 * Import contacts from CSV (header row: name, email, phone, title, company, tags). Dry-run by default: it reports
 * what WOULD happen. An existing email is never overwritten: `onDuplicate: 'skip'` (default) or 'merge' (fills blanks).
 */
export async function importCsv(db, actor, { workspace, csv, confirm = false, onDuplicate = 'skip' } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId && confirm) throw new CustomersError('An agent may preview an import; a person runs it', 'human_only', 403);
  const rows = parseCsv(csv);
  if (!rows.length) throw new CustomersError('The file is empty', 'empty_import');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  if (col('name') < 0) throw new CustomersError('The first row must name a "name" column', 'name_column_required');
  const body = rows.slice(1);
  if (body.length > IMPORT_MAX_ROWS) throw new CustomersError(`At most ${IMPORT_MAX_ROWS} rows per import`, 'import_too_large');
  const report = { rows: body.length, created: 0, merged: 0, skipped: 0, invalid: [], confirm: !!confirm };
  const seenInFile = new Set();
  for (const [i, r] of body.entries()) {
    const get = (n) => (col(n) >= 0 ? String(r[col(n)] ?? '').trim() : '');
    const name = get('name'), mail = get('email').toLowerCase();
    if (!name || name.length > 200 || (mail && !EMAIL.test(mail))) { report.invalid.push({ row: i + 2, reason: !name ? 'no name' : 'bad email' }); continue; }
    if (mail && seenInFile.has(mail)) { report.skipped++; continue; }
    if (mail) seenInFile.add(mail);
    const dup = mail ? (await db.query('SELECT * FROM crm_contacts WHERE workspace_id = $1 AND lower(email) = $2', [ctx.workspaceId, mail])).rows[0] : null;
    if (dup && onDuplicate !== 'merge') { report.skipped++; continue; }
    if (!confirm) { dup ? report.merged++ : report.created++; continue; }
    let companyId = null;
    const cname = get('company');
    if (cname) {
      const co = (await db.query('SELECT id FROM crm_companies WHERE workspace_id = $1 AND lower(name) = lower($2)', [ctx.workspaceId, cname])).rows[0];
      companyId = co ? co.id : (await db.query('INSERT INTO crm_companies (workspace_id, name, created_by) VALUES ($1,$2,$3) RETURNING id', [ctx.workspaceId, cname.slice(0, 200), ctx.userId])).rows[0].id;
    }
    const tags = get('tags') ? tagsOf(get('tags').split(/[;|]/)) : [];
    if (dup) {
      await db.query(`UPDATE crm_contacts SET phone = COALESCE(phone, NULLIF($2,'')), title = COALESCE(title, NULLIF($3,'')), company_id = COALESCE(company_id, $4),
        tags = ARRAY(SELECT DISTINCT unnest(tags || $5::text[])), updated_at = now() WHERE id = $1`, [dup.id, get('phone').slice(0, 60), get('title').slice(0, 200), companyId, tags]);
      report.merged++;
    } else {
      await db.query(`INSERT INTO crm_contacts (workspace_id, company_id, name, email, phone, title, tags, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'import',$8)`,
        [ctx.workspaceId, companyId, name, mail || null, get('phone').slice(0, 60) || null, get('title').slice(0, 200) || null, tags, ctx.userId]);
      report.created++;
    }
  }
  return report;
}

/** Likely duplicates the unique-email rule cannot catch: same name, or same email local part at the same domain. */
export async function findDuplicates(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const rows = (await db.query(`SELECT a.id AS a_id, a.name AS a_name, a.email AS a_email, b.id AS b_id, b.name AS b_name, b.email AS b_email
    FROM crm_contacts a JOIN crm_contacts b ON a.workspace_id = b.workspace_id AND a.id < b.id
    WHERE a.workspace_id = $1 AND (lower(trim(a.name)) = lower(trim(b.name)) OR (a.phone IS NOT NULL AND a.phone = b.phone)) LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.map((r) => ({ a: { id: r.a_id, name: r.a_name, email: r.a_email }, b: { id: r.b_id, name: r.b_name, email: r.b_email } }));
}
/** Merge `from` into `into`: the timeline, deals and links move; blanks fill; `from` is removed. A person's act. */
export async function mergeContacts(db, actor, { workspace, into, from } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (ctx.agentId) throw new CustomersError('Only a person merges contacts', 'human_only', 403);
  const a = await contactRow(db, ctx, into), b = await contactRow(db, ctx, from);
  if (a.id === b.id) throw new CustomersError('Pick two different contacts', 'same_contact');
  await db.query('UPDATE crm_activities SET contact_id = $1 WHERE contact_id = $2', [a.id, b.id]);
  await db.query('UPDATE crm_deals SET contact_id = $1 WHERE contact_id = $2', [a.id, b.id]);
  await db.query('UPDATE crm_links SET contact_id = $1 WHERE contact_id = $2 AND NOT EXISTS (SELECT 1 FROM crm_links x WHERE x.contact_id = $1 AND x.target_kind = crm_links.target_kind AND x.target_key = crm_links.target_key)', [a.id, b.id]);
  await db.query('DELETE FROM crm_contacts WHERE id = $1', [b.id]);
  await db.query(`UPDATE crm_contacts SET email = COALESCE(email, $2), phone = COALESCE(phone, $3), title = COALESCE(title, $4), company_id = COALESCE(company_id, $5),
    tags = ARRAY(SELECT DISTINCT unnest(tags || $6::text[])), updated_at = now() WHERE id = $1`, [a.id, b.email, b.phone, b.title, b.company_id, b.tags || []]);
  await db.query("INSERT INTO crm_activities (workspace_id, contact_id, kind, body, author_id) VALUES ($1,$2,'system',$3,$4)", [ctx.workspaceId, a.id, `Merged ${b.name} into this contact`, ctx.userId]);
  return getContact(db, actor, a.id, { workspace: ctx.workspaceId });
}

export async function summary(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const r = (await db.query(`SELECT (SELECT count(*) FROM crm_contacts WHERE workspace_id = $1)::int AS contacts,
    (SELECT count(*) FROM crm_companies WHERE workspace_id = $1)::int AS companies,
    (SELECT count(*) FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.workspace_id = $1 AND s.outcome = 'open')::int AS open_deals,
    (SELECT COALESCE(sum(amount_cents),0) FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.workspace_id = $1 AND s.outcome = 'open' AND d.state = 'active')::bigint AS open_cents,
    (SELECT count(*) FROM crm_activities WHERE workspace_id = $1 AND state = 'draft')::int AS drafts`, [ctx.workspaceId])).rows[0];
  return { workspaceId: ctx.workspaceId, contacts: r.contacts, companies: r.companies, openDeals: r.open_deals, openCents: Number(r.open_cents), drafts: r.drafts };
}
