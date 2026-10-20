/**
 * Custom modes and trade packs — THE one service (XENO MODES - SPEC.md §8, §8c; decisions D-CM1..7 DECIDED
 * 2026-10-20). REST (routes/modesRoutes.js), the hosted MCP (services/modesMcp.js → `modes_*`) and the workspace
 * screens all call these functions; nothing queries the tables on its own.
 *
 *   custom modes   a manifest (name + products) owned by a person (account) or a workspace
 *   plan           what applying a pack would create, and its hash. Writes nothing.
 *   apply          every record in ONE transaction, keyed by (workspace, idempotency key): a retry returns the same
 *                  receipt; a changed plan is refused. A human workspace admin must confirm it (§8.11, §8c.3).
 *   receipt        workspace_mode_applications (append-only) + a workspace_audit row
 *   revert         archives what the receipt created AND nobody has touched since; anything a person edited is kept
 *                  and listed (never delete authored work)
 *
 * The pack's author gets no access to the workspace by any of this. Nothing here prices anything (D-CM3).
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal, DEFAULT_AGENT_CAP } from './agentIdentity.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { createTask } from './xenoTasks.js';
import { createAuthorizedProject } from './chatProjectAuthority.js';
import { MODE_PACKS, packById as tradePackById } from '../data/modePacks.js';
import { COMPANY_BLUEPRINTS } from '../data/companyBlueprints.js';
import * as divisionsSvc from './workforceDivisions.js';
import * as platformAgents from './platformAgents.js';
import { createWorkforceResource } from './workforceResources.js';

/** A first-party pack: a trade pack, or a company blueprint (its `company` section is first-party only). */
const packById = (id) => tradePackById(id) || COMPANY_BLUEPRINTS.find((b) => b.id === id) || null;

export class ModeError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (message, code, status) => { throw new ModeError(message, code, status); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODE_ID = /^c-[a-z0-9][a-z0-9-]{0,39}$/;
const PRODUCT = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;

/** Stable JSON: object keys sorted, so a hash means the content and not the key order. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const sha256 = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex');

/** A mode manifest as stored: id, name, products. Refuses anything else. */
export function validateMode(input, { requireId = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A mode is an object', 'invalid_mode');
  const id = input.id == null ? null : String(input.id);
  if (requireId && (!id || !MODE_ID.test(id))) fail('A mode id is c- followed by lowercase letters, digits or dashes', 'invalid_mode_id');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 40) fail('A mode needs a name of 1–40 characters', 'invalid_mode_name');
  const products = Array.isArray(input.products) ? [...new Set(input.products.map(String))] : [];
  if (!products.length || products.length > 40 || products.some((p) => !PRODUCT.test(p))) fail('A mode needs 1–40 products', 'invalid_mode_products');
  return { id, name, products };
}
const shapeMode = (r) => ({ id: r.mode_id, name: r.name, products: r.products, workspaceId: r.owner_workspace_id || null,
  applicationId: r.source_application_id || null, edited: !!r.edited_at, updatedAt: r.updated_at });

async function principal(db, actor) {
  const p = await resolvePrincipal(db, actor.id);
  if (!p?.usable) fail('Not allowed', 'actor_unavailable', 403);
  return p;
}
/** Is this person (or, for an agent, its owner) an admin of the workspace? Direct or by role — never via a share. */
async function adminOf(db, userId, workspaceId) {
  const v = await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` });
  return v.allowed && ['direct', 'role-hierarchy'].includes(v.via);
}
async function workspaceFor(db, actor, workspaceId, { lock = false } = {}) {
  if (!UUID.test(String(workspaceId || ''))) fail('Workspace not found', 'workspace_not_found', 404);
  const w = (await db.query(`SELECT id, name, workspace_type, status FROM workspaces WHERE id = $1 ${lock ? 'FOR SHARE' : ''}`, [workspaceId])).rows[0];
  const p = await principal(db, actor);
  const accountable = p.kind === 'agent' ? p.ownerUserId || p.owner?.id || p.owner_user_id : actor.id;
  if (!w || w.status !== 'active' || !accountable || !(await adminOf(db, accountable, w.id))) fail('Workspace not found', 'workspace_not_found', 404);
  return { w, p };
}
/** §8.11 / §8c.3: applying, reverting and editing a workspace's setup is a HUMAN admin's act. An agent may plan. */
function humanOnly(p) {
  if (p.kind !== 'human') fail('A person who administers this workspace has to confirm this. Show them the plan; they apply it from Setup.', 'human_admin_must_confirm', 403);
}

// ───────────────────────────── the person's own modes (account) + the workspaces' modes they can see

export async function listMine(db, actor) {
  const p = await principal(db, actor); humanOnly(p);
  if (!db.previewReadOnly) await ensurePersonalWorkspace(db, actor.id).catch(() => null);
  const own = (await db.query(`SELECT * FROM custom_modes WHERE owner_user_id = $1 AND archived_at IS NULL ORDER BY position, created_at`, [actor.id])).rows.map(shapeMode);
  const ws = (await db.query(`SELECT DISTINCT w.id, w.name, w.workspace_type, w.created_at FROM workspaces w JOIN relationship_tuples rt
      ON rt.object_type = 'workspace' AND rt.object_id = w.id::text AND rt.subject_type = 'user' AND rt.subject_id = $1
     WHERE w.status = 'active' ORDER BY w.created_at`, [String(actor.id)])).rows;
  const workspaces = [];
  for (const w of ws) workspaces.push({ id: w.id, name: w.name, type: w.workspace_type, admin: await adminOf(db, actor.id, w.id) });
  const shared = ws.length ? (await db.query(`SELECT * FROM custom_modes WHERE owner_workspace_id = ANY($1::uuid[]) AND archived_at IS NULL ORDER BY position, created_at`, [ws.map((w) => w.id)])).rows.map(shapeMode) : [];
  return { modes: own, workspaceModes: shared, workspaces };
}
export async function createMine(db, actor, input) {
  const p = await principal(db, actor); humanOnly(p);
  const m = validateMode(input);
  const n = Number((await db.query(`SELECT count(*) n FROM custom_modes WHERE owner_user_id = $1 AND archived_at IS NULL`, [actor.id])).rows[0].n);
  if (n >= 50) fail('You have the most custom modes an account can hold (50)', 'mode_limit', 409);
  try {
    const r = (await db.query(`INSERT INTO custom_modes (mode_id, owner_user_id, name, products, position, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$2) RETURNING *`,
      [m.id, actor.id, m.name, JSON.stringify(m.products), Number.isInteger(input.position) ? input.position : n])).rows[0];
    return { mode: shapeMode(r) };
  } catch (e) { if (e.code === '23505') fail('You already have a mode with this id', 'mode_exists', 409); throw e; }
}
export async function updateMine(db, actor, modeId, input) {
  const p = await principal(db, actor); humanOnly(p);
  const m = validateMode({ ...input, id: modeId });
  const r = (await db.query(`UPDATE custom_modes SET name = $3, products = $4, updated_at = now(), edited_at = now() WHERE owner_user_id = $1 AND mode_id = $2 AND archived_at IS NULL RETURNING *`,
    [actor.id, m.id, m.name, JSON.stringify(m.products)])).rows[0];
  if (!r) fail('Mode not found', 'mode_not_found', 404);
  return { mode: shapeMode(r) };
}
export async function removeMine(db, actor, modeId) {
  const p = await principal(db, actor); humanOnly(p);
  const r = (await db.query(`UPDATE custom_modes SET archived_at = now() WHERE owner_user_id = $1 AND mode_id = $2 AND archived_at IS NULL RETURNING mode_id`, [actor.id, String(modeId)])).rows[0];
  if (!r) fail('Mode not found', 'mode_not_found', 404);
  return { id: r.mode_id, removed: true };
}
/** A workspace's mode, changed by a human admin. Marks it as a person's edit, so Undo of its pack keeps it. */
export async function updateWorkspaceMode(db, actor, workspaceId, modeId, input) {
  const { p } = await workspaceFor(db, actor, workspaceId); humanOnly(p);
  const m = validateMode({ ...input, id: modeId });
  const r = (await db.query(`UPDATE custom_modes SET name = $3, products = $4, updated_at = now(), edited_at = now() WHERE owner_workspace_id = $1 AND mode_id = $2 AND archived_at IS NULL RETURNING *`,
    [workspaceId, m.id, m.name, JSON.stringify(m.products)])).rows[0];
  if (!r) fail('Mode not found', 'mode_not_found', 404);
  return { mode: shapeMode(r) };
}

// ───────────────────────────── packs

const publicPack = (pk) => ({ id: pk.id, version: pk.version, trade: pk.trade, title: pk.title, summary: pk.summary, status: pk.status,
  questions: pk.questions || [], mode: pk.mode, tasks: (pk.tasks || []).map((t) => ({ title: t.title })), source: pk.source || 'first-party' });

/** First-party draft packs, then published `mode` listings. */
export async function listPacks(db) {
  const listed = (await db.query(`SELECT l.slug, v.id AS version_id, v.version, v.mode_pack FROM marketplace_listing_versions v JOIN marketplace_listings l ON l.id = v.listing_id
     WHERE l.kind = 'mode' AND l.status = 'published' AND v.published_at IS NOT NULL AND v.mode_pack IS NOT NULL ORDER BY v.published_at DESC LIMIT 100`).catch(() => ({ rows: [] }))).rows;
  return { blueprints: COMPANY_BLUEPRINTS.map((b) => ({ ...publicPack(b), counts: companyCounts(b) })), packs: [...MODE_PACKS.map(publicPack), ...listed.map((r) => publicPack({ ...r.mode_pack, id: `listing:${r.version_id}`, version: r.version, status: 'published', source: 'marketplace' }))] };
}
async function resolvePack(db, { packId, listingVersionId }) {
  const lv = listingVersionId || (String(packId || '').startsWith('listing:') ? String(packId).slice(8) : null);
  if (lv) {
    if (!UUID.test(lv)) fail('Pack not found', 'pack_not_found', 404);
    const r = (await db.query(`SELECT v.id, v.version, v.mode_pack, v.mode_pack_hash FROM marketplace_listing_versions v JOIN marketplace_listings l ON l.id = v.listing_id
       WHERE v.id = $1 AND l.kind = 'mode' AND l.status = 'published' AND v.published_at IS NOT NULL`, [lv])).rows[0];
    if (!r?.mode_pack) fail('Pack not found', 'pack_not_found', 404);
    // a published listing never carries a company structure: making divisions, teams and agents is first-party only
    const { company: _company, ...mp } = r.mode_pack;
    return { pack: { ...mp, id: `listing:${r.id}`, version: r.version }, hash: r.mode_pack_hash, listingVersionId: r.id };
  }
  const pk = packById(String(packId || ''));
  if (!pk) fail('Pack not found', 'pack_not_found', 404);
  return { pack: pk, hash: sha256(pk), listingVersionId: null };
}
function answersFor(pack, raw) {
  const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const q of pack.questions || []) {
    const v = String(a[q.id] ?? '').trim();
    if (q.required && !v) fail(`${q.label} is required`, 'answer_required');
    if (v.length > (q.max || 200)) fail(`${q.label} is too long`, 'answer_too_long');
    if (v) out[q.id] = v;
  }
  return out;
}

/** Counts of what a company section would create. */
export function companyCounts(pack, answers = {}) {
  const withAgents = String(answers.agents || 'yes').toLowerCase() !== 'no';
  const ds = pack?.company?.divisions || [];
  const teams = ds.flatMap((d) => d.teams || []);
  return { divisions: ds.length, teams: teams.length, agents: withAgents ? teams.filter((t) => t.agent).length : 0, profiles: pack?.company ? 1 : 0 };
}
/** The company section's records, in apply order. Names only — ids are what apply returns. */
function companyRecords(pack, w, answers = {}) {
  const withAgents = String(answers.agents || 'yes').toLowerCase() !== 'no';
  if (!pack.company) return [];
  const out = [{ type: 'profile', principal: 'you', title: String(pack.company.headTitle || '').slice(0, 120) }];
  for (const d of pack.company.divisions || []) {
    out.push({ type: 'division', name: String(d.name).slice(0, 200), head: 'you' });
    for (const t of d.teams || []) {
      out.push({ type: 'team', name: String(t.name).slice(0, 200), division: d.name });
      if (t.agent && withAgents) out.push({ type: 'agent', name: String(t.agent.name).slice(0, 60), team: t.name, division: d.name, role: 'delegate' });
    }
  }
  out.push({ type: 'place', note: `The building of ${w.name}: floors are its divisions, pods its teams (derived by Places, nothing written).` });
  return out;
}

/** What applying would create. Writes nothing; its hash is what apply must be given. */
export async function plan(db, actor, { workspaceId, packId, listingVersionId, answers } = {}) {
  const { w } = await workspaceFor(db, actor, workspaceId);
  const { pack, hash, listingVersionId: lvId } = await resolvePack(db, { packId, listingVersionId });
  const a = answersFor(pack, answers);
  const mode = validateMode(pack.mode);
  const conflicts = (await db.query(`SELECT mode_id FROM custom_modes WHERE owner_workspace_id = $1 AND mode_id = $2 AND archived_at IS NULL`, [w.id, mode.id])).rows.map((r) => `mode:${r.mode_id}`);
  const records = [{ type: 'mode', id: mode.id, name: mode.name, products: mode.products },
    ...((pack.tasks || []).length ? [{ type: 'project', name: `${mode.name} — getting started`.slice(0, 200), workspaceId: w.id }] : []),
    ...(pack.tasks || []).map((t) => ({ type: 'task', title: String(t.title).slice(0, 300), in: 'project', assignee: 'you' })),
    ...companyRecords(pack, w, a)];
  if (pack.company) {
    if (w.workspace_type === 'personal') conflicts.push('workspace:personal (a company structure goes in a company or team workspace)');
    const names = (pack.company.divisions || []).map((d) => String(d.name).slice(0, 200));
    const taken = (await db.query(`SELECT name FROM workforce_divisions WHERE workspace_id = $1 AND lifecycle = 'active' AND name = ANY($2::text[])`, [w.id, names])).rows;
    conflicts.push(...taken.map((r) => `division:${r.name}`));
    // agents count against the applier's own limit (agentIdentity.createAgent); say so in the plan, never mid-apply
    const need = companyCounts(pack, a).agents;
    if (need) {
      const have = Number((await db.query(`SELECT count(*)::int AS n FROM agent_identities WHERE owner_user_id = $1 AND status <> 'deleted'`, [actor.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
      if (have + need > DEFAULT_AGENT_CAP) conflicts.push(`agents:needs ${need}, this account has ${have} of ${DEFAULT_AGENT_CAP}`);
    }
  }
  const body = { workspaceId: w.id, pack: { id: pack.id, version: pack.version, hash, listingVersionId: lvId }, answers: a, records, conflicts };
  return { plan: { ...body, workspaceName: w.name, ...(pack.company ? { counts: companyCounts(pack, a) } : {}), packTitle: pack.title, status: pack.status || 'published',
    cost: { credits: 0, seats: 0, note: 'Nothing here is billed yet. A paid pack is priced in the Pricing §6 ledger before it ships.' } },
  planHash: sha256(body) };
}

const shapeReceipt = (r) => ({ applicationId: r.id, workspaceId: r.workspace_id, packId: r.pack_id, packVersion: r.pack_version, packHash: r.pack_hash,
  listingVersionId: r.listing_version_id, answers: r.answers, planHash: r.plan_hash, records: r.created_records, appliedBy: r.applied_by_user_id,
  appliedAt: r.applied_at, revertedAt: r.reverted_at, revertedBy: r.reverted_by_user_id, revertReport: r.revert_report });

async function inTransaction(pool, fn) {
  if (typeof pool.connect !== 'function' || typeof pool.release === 'function') return fn(pool);
  const c = await pool.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Apply a planned pack: one transaction, one receipt. The same key again returns that receipt. */
export function apply(pool, actor, { workspaceId, packId, listingVersionId, answers, planHash, idempotencyKey, confirm } = {}) {
  if (!KEY.test(String(idempotencyKey || ''))) fail('idempotencyKey is 8–128 letters, digits, . _ : or -', 'invalid_idempotency_key');
  if (!/^[0-9a-f]{64}$/.test(String(planHash || ''))) fail('Pass the planHash from modes plan', 'plan_hash_required');
  return inTransaction(pool, async (db) => {
    const { w, p } = await workspaceFor(db, actor, workspaceId, { lock: true });
    humanOnly(p);
    if (confirm !== true) fail('Applying needs confirm: true from the admin who read the plan', 'confirmation_required', 409);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`mode-apply:${w.id}:${idempotencyKey}`]);
    const prior = (await db.query(`SELECT * FROM workspace_mode_applications WHERE workspace_id = $1 AND idempotency_key = $2`, [w.id, idempotencyKey])).rows[0];
    if (prior) {
      // a key names ONE request: the same plan, the same pack and the same answers — anything else is not a retry
      const { pack: asked } = await resolvePack(db, { packId, listingVersionId });
      if (prior.plan_hash !== planHash || prior.pack_id !== asked.id || canonical(prior.answers) !== canonical(answersFor(asked, answers))) fail('This idempotency key was used for a different plan', 'idempotency_key_reused', 409);
      return { replayed: true, receipt: shapeReceipt(prior) };
    }
    const now = await plan(db, actor, { workspaceId: w.id, packId, listingVersionId, answers });
    if (now.planHash !== planHash) fail('The plan changed since it was read. Plan again.', 'plan_changed', 409);
    if (now.plan.conflicts.some((c) => c.startsWith('agents:'))) fail('The company needs more agents than this account may own. Apply it with agents: no, or raise the limit first.', 'agent_cap_reached', 409);
    if (now.plan.conflicts.length) fail('This setup is already in the workspace', 'already_applied', 409);
    const appId = crypto.randomUUID();
    const created = [];
    const m = now.plan.records[0];
    const row = (await db.query(`INSERT INTO custom_modes (mode_id, owner_workspace_id, name, products, source_application_id, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING row_id`,
      [m.id, w.id, m.name, JSON.stringify(m.products), appId, actor.id])).rows[0];
    created.push({ type: 'mode', id: m.id, rowId: row.row_id });
    const me = { id: actor.id, kind: 'human', name: p.displayName || p.handle || 'Someone' };
    const { pack } = await resolvePack(db, { packId, listingVersionId });
    // §8.11 D-1: the WORKSPACE owns what a setup creates. Starter tasks live in a project of the target workspace
    // (never the applier's personal tasks); the applier is their assignee. The project is made through the one
    // project creator, joined to THIS transaction (its own BEGIN/COMMIT become no-ops here).
    if ((pack.tasks || []).length) {
      const joined = { query: (sql, a) => (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) ? Promise.resolve({ rows: [] }) : db.query(sql, a)) };
      const project = await createAuthorizedProject(joined, { principal: { type: 'user', id: String(actor.id) }, workspaceId: w.id,
        name: `${m.name} — getting started`.slice(0, 200), settings: { source: 'mode-setup', applicationId: appId } });
      created.push({ type: 'project', id: project.id });
      for (const t of pack.tasks) {
        const task = await createTask(db, me, { title: t.title, body: t.body || '', projectId: project.id, assigneeId: actor.id });
        created.push({ type: 'task', id: task.id, key: task.key, projectId: project.id });
      }
    }
    if (pack.trade && /^[a-z][a-z0-9-]{0,39}$/.test(pack.trade)) {
      await db.query(`INSERT INTO user_onboarding (user_id, trade) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET trade = EXCLUDED.trade, updated_at = now()`, [actor.id, pack.trade]);
    }
    if (pack.company) created.push(...(await applyCompany(db, { id: String(actor.id), kind: 'human' }, w, pack.company, now.plan.answers)));
    const r = (await db.query(`INSERT INTO workspace_mode_applications (id, workspace_id, pack_id, pack_version, pack_hash, listing_version_id, answers, plan_hash, idempotency_key, created_records, applied_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [appId, w.id, now.plan.pack.id, now.plan.pack.version, now.plan.pack.hash, now.plan.pack.listingVersionId, JSON.stringify(now.plan.answers), planHash, idempotencyKey, JSON.stringify(created), actor.id])).rows[0];
    await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1,$2,'mode.applied',$3,$4)`,
      [w.id, actor.id, `mode_application:${appId}`, JSON.stringify({ schemaVersion: 1, packId: r.pack_id, packVersion: r.pack_version, planHash })]);
    return { replayed: false, receipt: shapeReceipt(r) };
  });
}

/**
 * The company section, inside apply's ONE transaction, through the owning services: divisions (workforceDivisions),
 * teams (the workforce resource command), agents (platformAgents, made inside the company). Those services open their
 * own transaction from a pool; `joined` hands them this one, so everything commits or rolls back together.
 */
async function applyCompany(db, me, w, company, answers = {}) {
  const withAgents = String(answers.agents || 'yes').toLowerCase() !== 'no';
  const noTx = (sql, a) => (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) ? Promise.resolve({ rows: [] }) : db.query(sql, a));
  const joined = { query: noTx, connect: async () => ({ query: noTx, release: () => {} }) };
  const created = [];
  await db.query(`INSERT INTO workforce_employee_profiles (workspace_id, principal_id, title, updated_by_user_id) VALUES ($1,$2,$3,$2)
      ON CONFLICT (workspace_id, principal_id) DO UPDATE SET title = EXCLUDED.title, revision = workforce_employee_profiles.revision + 1, updated_at = now()`,
  [w.id, me.id, String(company.headTitle || '').slice(0, 120)]);
  created.push({ type: 'profile', principalId: me.id });
  for (const d of company.divisions || []) {
    const div = await divisionsSvc.create(joined, me, { workspaceId: w.id, name: d.name });
    await divisionsSvc.update(joined, me, div.id, { headId: me.id, reason: 'company blueprint' });
    created.push({ type: 'division', id: div.id, name: div.name });
    for (const t of d.teams || []) {
      const made = await createWorkforceResource(joined, { actorUserId: me.id, clientId: 'xeno-modes' },
        { operationId: crypto.randomUUID(), owner: { type: 'workspace', id: w.id }, kind: 'team', name: t.name });
      const teamId = made.resource.id;
      await db.query(`INSERT INTO workforce_division_ownership (resource_id, resource_kind, division_id, created_by_user_id) VALUES ($1, 'team', $2, $3)`, [teamId, div.id, me.id]);
      created.push({ type: 'team', id: teamId, name: t.name, divisionId: div.id });
      if (t.agent && withAgents) {
        const agent = await platformAgents.create(joined, me, { name: t.agent.name, instructions: t.agent.instructions, divisionId: div.id, workspaceId: w.id });
        created.push({ type: 'agent', id: agent.id, name: agent.name, teamId, divisionId: div.id });
      }
    }
  }
  return created;
}

/** Undo: archive what the receipt created and nobody has touched since; keep (and list) every edited record. */
export function revert(pool, actor, { workspaceId, applicationId } = {}) {
  if (!UUID.test(String(applicationId || ''))) fail('Setup not found', 'application_not_found', 404);
  return inTransaction(pool, async (db) => {
    const { w, p } = await workspaceFor(db, actor, workspaceId, { lock: true });
    humanOnly(p);
    const r = (await db.query(`SELECT * FROM workspace_mode_applications WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [applicationId, w.id])).rows[0];
    if (!r) fail('Setup not found', 'application_not_found', 404);
    if (r.reverted_at) return { replayed: true, receipt: shapeReceipt(r) };
    const archived = [], kept = [], projects = [];
    for (const rec of r.created_records) {
      if (rec.type === 'mode') {
        const m = (await db.query(`SELECT edited_at, archived_at FROM custom_modes WHERE row_id = $1 FOR UPDATE`, [rec.rowId])).rows[0];
        if (!m || m.archived_at) continue;
        if (m.edited_at) { kept.push({ ...rec, reason: 'edited by a person' }); continue; }
        await db.query(`UPDATE custom_modes SET archived_at = now() WHERE row_id = $1`, [rec.rowId]);
        archived.push(rec);
      } else if (rec.type === 'task') {
        const t = (await db.query(`SELECT id, created_at, updated_at, deleted_at, status FROM tasks WHERE id = $1 FOR UPDATE`, [rec.id])).rows[0];
        if (!t || t.deleted_at) continue;
        // the setup's own events (created, and the assignment made with it) are not a person's work
        const touched = t.updated_at.getTime() !== t.created_at.getTime() || t.status !== 'raised'
          || Number((await db.query(`SELECT count(*) n FROM task_events WHERE task_id = $1 AND (created_at > (SELECT created_at FROM tasks WHERE id = $1) OR kind NOT IN ('created','assigned'))`, [t.id])).rows[0].n) > 0;
        if (touched) { kept.push({ ...rec, reason: 'worked on by a person' }); continue; }
        await db.query(`UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = $1`, [t.id]);
        await db.query(`INSERT INTO task_events (task_id, actor_id, actor_kind, kind, from_value) VALUES ($1,$2,'human','deleted',$3)`, [t.id, actor.id, t.status]);
        archived.push(rec);
      } else if (rec.type === 'project') projects.push(rec);
      // a company's structure is never torn down by undoing a setup: people are already working in it
      else if (['division', 'team', 'agent', 'profile'].includes(rec.type)) kept.push({ ...rec, reason: 'company structure: archive it from Divisions, Teams or Agents' });
    }
    // the setup's project is archived only when nothing a person keeps is left in it
    for (const rec of projects) {
      const live = Number((await db.query(`SELECT count(*) n FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`, [rec.id])).rows[0].n);
      if (live) { kept.push({ ...rec, reason: 'holds work a person kept' }); continue; }
      const a = await db.query(`UPDATE chat_projects SET is_archived = true WHERE id = $1 AND workspace_id = $2 AND NOT is_archived`, [rec.id, w.id]);
      if (a.rowCount) archived.push(rec);
    }
    const report = { archived, kept };
    const out = (await db.query(`UPDATE workspace_mode_applications SET reverted_at = now(), reverted_by_user_id = $2, revert_report = $3 WHERE id = $1 RETURNING *`,
      [r.id, actor.id, JSON.stringify(report)])).rows[0];
    await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1,$2,'mode.reverted',$3,$4)`,
      [w.id, actor.id, `mode_application:${r.id}`, JSON.stringify({ schemaVersion: 1, archived: archived.length, kept: kept.length })]);
    return { replayed: false, receipt: shapeReceipt(out) };
  });
}

/** The setups applied to a workspace, newest first (the Setup page). */
export async function status(db, actor, { workspaceId } = {}) {
  const { w } = await workspaceFor(db, actor, workspaceId);
  const rows = (await db.query(`SELECT * FROM workspace_mode_applications WHERE workspace_id = $1 ORDER BY applied_at DESC LIMIT 100`, [w.id])).rows;
  return { workspaceId: w.id, applications: rows.map(shapeReceipt) };
}
