/**
 * /api/workspaces/* and /api/workspace-invites/* — multi-tenant workspaces/teams.
 *
 * Membership + roles are NOT stored in a bespoke table; they live in the existing
 * Zanzibar-style ReBAC store (relationship_tuples via utils/authzReBAC.js) as
 * `workspace:<id>#<role>@user:<id>`. This router owns the workspace ENTITY
 * (workspaces/workspace_invites/workspace_audit tables) and translates the
 * frontend accountService contract onto tuples + the role hierarchy
 * (owner > admin > editor > viewer). Every user gets a personal workspace lazily
 * on first list (Notion/Linear pattern).
 *
 * Mounted behind databaseMiddleware + authMiddleware (req.db = pool, req.user = row).
 * The authz functions are called server-side, so this works regardless of the
 * OIDC_ENABLED gate on the /api/v2/authz HTTP surface.
 */
import express from 'express';
import { siteOrigin } from '../config/hosts.js';
import crypto from 'crypto';
import { check, writeTuples, listObjectTuples, ROLE_RANK } from '../utils/authzReBAC.js';
import { sendEmail } from '../services/emailService.js';
import { ensureWorkspaceWallet, walletBalance, transferToWorkspace, setWorkspaceBudget } from '../services/walletService.js';
import { workspaceSeatInfo } from '../utils/workspaceContext.js';
import { createWorkspaceSeatCheckout } from '../services/billingService.js';
import { withTransaction } from '../services/chatProjectAuthority.js';
import { authorityTransaction, lockWorkspaceAuthority } from '../services/workspaceOperationReceipts.js';
import { decideWorkspaceInvite } from '../services/workspaceLifecycle.js';
import { mutateWorkspaceMembership } from '../services/workspaceMembershipOperations.js';
import { workspaceMembershipOperationRoutes } from './workspaceMembershipOperationRoutes.js';
import { accountWorkspaceOperationRoutes } from './accountWorkspaceOperationRoutes.js';
import workspaceTeamRoutes from './workspaceTeamRoutes.js';
import { workspaceKeyRoutes } from './workspaceKeyRoutes.js';
import { requireWorkspaceAuthority } from '../middleware/workspaceScopes.js';

// ── ref helpers ──────────────────────────────────────────────────────────────
const WS = (id) => `workspace:${id}`;
const USER = (id) => `user:${id}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Frontend role vocabulary (owner/admin/member/viewer) <-> ReBAC relation.
const RELATIONS = ['owner', 'admin', 'editor', 'viewer'];
// Roles an INVITE may grant. 'owner' is deliberately excluded: ownership moves ONLY
// through the owner-transfer flow — otherwise any admin could mint a co-owner
// (privilege escalation past the real owner). Enforced on BOTH create and accept.
const INVITABLE_RELATIONS = new Set(['admin', 'editor', 'viewer']);
const toRelation = (role) => {
  const r = String(role || '').toLowerCase();
  if (r === 'member') return 'editor';
  return RELATIONS.includes(r) ? r : 'viewer';
};
const toDisplayRole = (relation) => (relation === 'editor' ? 'member' : relation);

const slugify = (name) => {
  const base = String(name || 'workspace')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'workspace';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
};
const normalizeSlug = (value) => String(value || '').toLowerCase().trim()
  .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

// Wrap async handlers so a rejection becomes a clean 500 instead of a crash.
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[workspaces]', req.method, req.originalUrl, '-', e.message);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal error' });
});

function rejectIfNotWorkspaceId(res, id) {
  if (UUID_RE.test(String(id || ''))) return false;
  res.status(400).json({
    success: false,
    error: 'Invalid workspace id',
    code: 'invalid_workspace_id',
  });
  return true;
}

// :id handlers must reject junk (ws-team) BEFORE can() — otherwise ReBAC 403s
// a string that was never a workspace, and the client reports "forbidden".
const wrapId = (fn) => wrap(async (req, res) => {
  if (rejectIfNotWorkspaceId(res, req.params.id)) return;
  return fn(req, res);
});

// ── data helpers ─────────────────────────────────────────────────────────────
async function getWorkspace(db, id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const r = await db.query('SELECT * FROM workspaces WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function audit(db, wsId, actorId, action, target, metadata = {}) {
  try {
    await auditStrict(db, wsId, actorId, action, target, metadata);
  } catch (e) { console.warn('[workspaces] audit failed:', e.message); }
}

async function auditStrict(db, wsId, actorId, action, target, metadata = {}) {
  await db.query(
    'INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1,$2,$3,$4,$5)',
    [wsId, actorId || null, action, target != null ? String(target) : null, metadata],
  );
}

// Does `subject user` satisfy `relation` on the workspace (via role hierarchy)?
async function can(db, wsId, userId, relation) {
  const r = await check(db, { object: WS(wsId), relation, subject: USER(userId) });
  return r.allowed;
}

// All (userId -> highest relation) memberships on a workspace.
async function memberRoles(db, wsId) {
  const tuples = await listObjectTuples(db, WS(wsId));
  const byUser = new Map();
  for (const t of tuples) {
    if (!String(t.subject).startsWith('user:')) continue;
    const uid = t.subject.slice(5);
    const prev = byUser.get(uid);
    if (!prev || (ROLE_RANK[t.relation] || 0) > (ROLE_RANK[prev] || 0)) byUser.set(uid, t.relation);
  }
  return byUser; // Map<userId, relation>
}

async function shapeWorkspace(db, ws, userId) {
  const roles = await memberRoles(db, ws.id);
  return {
    id: ws.id,
    owner_user_id: ws.owner_user_id,
    workspace_type: ws.workspace_type,
    name: ws.name,
    slug: ws.slug,
    status: ws.status,
    created_at: ws.created_at,
    updated_at: ws.updated_at,
    metadata: ws.metadata || {},
    member_role: roles.has(userId) ? toDisplayRole(roles.get(userId)) : undefined,
    member_count: roles.size,
  };
}

const shapeInvite = (r) => ({
  id: r.id,
  workspace_id: r.workspace_id,
  invited_by_user_id: r.invited_by_user_id,
  invited_user_id: r.invited_user_id,
  invited_email: r.invited_email,
  role: toDisplayRole(r.role),
  status: r.status,
  created_at: r.created_at,
  expires_at: r.expires_at,
  workspace_name: r.workspace_name,
  invited_by_name: r.invited_by_name,
});

async function ensureOwnerTuple(db, wsId, userId) {
  await writeTuples(db, { writes: [{ object: WS(wsId), relation: 'owner', subject: USER(userId) }] });
}

// Lazily provision the caller's personal workspace (idempotent under races).
async function ensurePersonalWorkspace(db, user) {
  const found = await db.query(
    "SELECT * FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal' LIMIT 1",
    [user.id],
  );
  if (found.rows.length) {
    await ensureOwnerTuple(db, found.rows[0].id, user.id); // heal a missing tuple
    return found.rows[0];
  }
  const label = String(user.display_name || user.username || 'Personal').trim();
  const name = /workspace/i.test(label) ? label : `${label}'s Workspace`;
  try {
    return await withTransaction(db, async (tx) => {
      const workspace = (await tx.query(
        "INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'personal',$2,$3) RETURNING *",
        [user.id, name, slugify(label)],
      )).rows[0];
      await ensureOwnerTuple(tx, workspace.id, user.id);
      await auditStrict(tx, workspace.id, user.id, 'workspace.create', workspace.id, { type: 'personal' });
      return workspace;
    });
  } catch (e) {
    const again = await db.query(
      "SELECT * FROM workspaces WHERE owner_user_id = $1 AND workspace_type = 'personal' LIMIT 1",
      [user.id],
    );
    if (again.rows.length) return again.rows[0];
    throw e;
  }
}

async function sendInviteEmail(db, ws, invite, inviter) {
  try {
    const base = process.env.PUBLIC_APP_URL || process.env.APP_URL || siteOrigin();
    const acceptUrl = `${base}/invite/${invite.token}`;
    await sendEmail(db, 'workspace_invite', invite.invited_email, {
      workspace_name: ws.name,
      inviter_name: inviter.display_name || inviter.username,
      role: toDisplayRole(invite.role),
      accept_url: acceptUrl,
      expires_at: invite.expires_at,
    }, invite.invited_user_id || null);
  } catch (e) {
    // Best-effort: the invite row + accept link still exist even if email fails.
    console.warn('[workspaces] invite email not sent:', e.message);
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// /api/workspaces
// ════════════════════════════════════════════════════════════════════════════
// Legacy (non-identified) requests keep their existing URLs, bodies and response shapes,
// and now run the SAME transaction and business rules as an identified operation. They stay
// non-replayable -- no operation id -- which is exactly what distinguishes them.
async function legacyMembership(req, res, action, input) {
  let result;
  try {
    ({ result } = await mutateWorkspaceMembership(req.db, req.params.id, req.user.id, null, null, action, input, { legacy: true }));
  } catch (failure) {
    // The service refuses with a TYPED error carrying the status it means -- 402 for a seat
    // limit, 403 for insufficient authority, 404 for a member or invitation that is not
    // there, 409 for an invitation that already exists. `wrap` turns any rejection into a
    // 500, so without this every refusal these routes used to express would arrive as
    // "Internal error" -- the client cannot tell a full workspace from a broken server.
    // An error with no status IS unexpected and keeps the 500 deliberately.
    if (!failure.status) throw failure;
    return res.status(failure.status).json({ success: false, error: failure.code });
  }
  res.json({ success: true, ...(action === 'invite.create' ? { invite: shapeInvite(result.invite) } : {}) });
}

const router = express.Router();
router.use(requireWorkspaceAuthority);
router.use('/:id/teams', workspaceTeamRoutes);
router.use('/:id/api-keys', workspaceKeyRoutes);
router.use('/:id', workspaceMembershipOperationRoutes);

// GET /api/workspaces/:id — the workspace itself. Present on the preservation branch and
// never on main, so a workspace-scoped credential could reach /members but not the row it
// belongs to. Uses only helpers main already declares.
router.get('/:id', wrapId(async (req, res) => {
  const workspace = await getWorkspace(req.db, req.params.id);
  if (!workspace || !(await can(req.db, req.params.id, req.user.id, 'viewer'))) return res.status(403).json({ success: false, error: 'Not a member of this workspace' });
  res.json({ success: true, workspace: await shapeWorkspace(req.db, workspace, req.user.id) });
}));

// PATCH /api/workspaces/:id — owner/admin workspace identity update. The
// response is the post-write server record and the audit event preserves both
// before and after values.
router.patch('/:id', wrapId(async (req, res) => {
  if (!await can(req.db, req.params.id, req.user.id, 'admin')) {
    return res.status(403).json({ success: false, error: 'Workspace admin access required' });
  }
  const current = await getWorkspace(req.db, req.params.id);
  if (!current || current.status !== 'active') return res.status(404).json({ success: false, error: 'Workspace not found' });
  const name = req.body?.name === undefined ? current.name : String(req.body.name).trim().slice(0, 200);
  const slug = req.body?.slug === undefined ? current.slug : normalizeSlug(req.body.slug);
  if (!name) return res.status(400).json({ success: false, error: 'Workspace name is required' });
  if (!slug || slug.length < 3) return res.status(400).json({ success: false, error: 'Workspace slug must contain at least 3 letters, numbers, or dashes' });
  try {
    const workspace = await withTransaction(req.db, async (tx) => {
      const updated = (await tx.query(
        'UPDATE workspaces SET name=$1, slug=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
        [name, slug, req.params.id],
      )).rows[0];
      await auditStrict(tx, req.params.id, req.user.id, 'workspace.update', req.params.id, {
        from: { name: current.name, slug: current.slug }, to: { name, slug },
      });
      return updated;
    });
    res.json({ success: true, workspace: await shapeWorkspace(req.db, workspace, req.user.id) });
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'That workspace slug is already in use' });
    throw error;
  }
}));

// GET /api/workspaces — the caller's workspaces (auto-creates a personal one).
router.get('/', wrap(async (req, res) => {
  if (!req.db.previewReadOnly) await ensurePersonalWorkspace(req.db, req.user);
  const rows = (await req.db.query(
    `SELECT DISTINCT w.* FROM workspaces w
       JOIN relationship_tuples rt
         ON rt.object_type = 'workspace' AND rt.object_id = w.id::text
        AND rt.subject_type = 'user' AND rt.subject_id = $1
      WHERE w.status = 'active'
      ORDER BY w.created_at ASC`,
    [req.user.id],
  )).rows;
  const workspaces = [];
  for (const w of rows) workspaces.push(await shapeWorkspace(req.db, w, req.user.id));
  res.json({ success: true, workspaces });
}));

// POST /api/workspaces { name, workspace_type } — create a team workspace.
router.post('/', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'Workspace name is required' });
  const ins = await withTransaction(req.db, async (tx) => {
    const workspace = (await tx.query(
      "INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING *",
      [req.user.id, name.slice(0, 200), slugify(name)],
    )).rows[0];
    await ensureOwnerTuple(tx, workspace.id, req.user.id);
    await auditStrict(tx, workspace.id, req.user.id, 'workspace.create', workspace.id, { type: 'team' });
    return workspace;
  });
  res.json({ success: true, workspace: await shapeWorkspace(req.db, ins, req.user.id) });
}));

// POST /api/workspaces/:id/select — mark active only after durable persistence.
router.post('/:id/select', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'viewer'))) {
    return res.status(403).json({ success: false, error: 'Not a member of this workspace' });
  }
  await req.db.query(
    "UPDATE users SET preferences = jsonb_set(COALESCE(preferences,'{}'::jsonb), '{active_workspace_id}', to_jsonb($1::text), true) WHERE id = $2",
    [wsId, req.user.id],
  );
  res.json({ success: true });
}));

// GET /api/workspaces/:id/members
router.get('/:id/members', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'viewer'))) {
    return res.status(403).json({ success: false, error: 'Not a member of this workspace' });
  }
  const ws = await getWorkspace(req.db, wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
  const roles = await memberRoles(req.db, wsId);
  const ids = [...roles.keys()];
  const users = ids.length
    ? (await req.db.query(
        'SELECT id, username, email, display_name, avatar_url FROM users WHERE id = ANY($1::uuid[])', [ids],
      )).rows
    : [];
  const umap = new Map(users.map((u) => [u.id, u]));
  const members = ids.map((uid) => {
    const u = umap.get(uid);
    return {
      id: uid,
      user_id: uid,
      member_role: toDisplayRole(roles.get(uid)),
      member_status: 'active',
      created_at: ws.created_at,
      user: u ? { username: u.username, email: u.email, display_name: u.display_name, avatar_url: u.avatar_url } : undefined,
    };
  }).sort((a, b) => (ROLE_RANK[toRelation(b.member_role)] || 0) - (ROLE_RANK[toRelation(a.member_role)] || 0));
  res.json({ success: true, workspace: await shapeWorkspace(req.db, ws, req.user.id), members });
}));

// PATCH /api/workspaces/:id/members/:memberId { member_role }
router.patch('/:id/members/:memberId', wrapId((req, res) => legacyMembership(req, res, 'member.role',
  { memberId: req.params.memberId, role: toDisplayRole(toRelation(req.body?.member_role)) })));

// DELETE /api/workspaces/:id/members/:memberId  (admin removes; or self-leave)
router.delete('/:id/members/:memberId', wrapId((req, res) => legacyMembership(req, res, 'member.remove',
  { memberId: req.params.memberId })));

// POST /api/workspaces/:id/owner-transfer { new_owner_user_id }
router.post('/:id/owner-transfer', wrapId((req, res) => legacyMembership(req, res, 'owner.transfer',
  { newOwnerId: req.body?.new_owner_user_id })));

// GET /api/workspaces/:id/invites
router.get('/:id/invites', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'admin'))) {
    return res.status(403).json({ success: false, error: 'Admin required' });
  }
  const rows = (await req.db.query(
    `SELECT i.*, w.name AS workspace_name, u.display_name AS invited_by_name
       FROM workspace_invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.invited_by_user_id
      WHERE i.workspace_id = $1 AND i.status = 'pending'
      ORDER BY i.created_at DESC`,
    [wsId],
  )).rows;
  res.json({ success: true, invites: rows.map(shapeInvite) });
}));

// POST /api/workspaces/:id/invites { email, role }
router.post('/:id/invites', wrapId((req, res) => legacyMembership(req, res, 'invite.create',
  { email: String(req.body?.email || '').trim().toLowerCase(), role: toDisplayRole(toRelation(req.body?.role)) })));

// DELETE /api/workspaces/:id/invites/:inviteId  (revoke)
router.delete('/:id/invites/:inviteId', wrapId((req, res) => legacyMembership(req, res, 'invite.revoke',
  { inviteId: req.params.inviteId })));

// POST /api/workspaces/:id/invites/:inviteId/resend
router.post('/:id/invites/:inviteId/resend', wrapId((req, res) => legacyMembership(req, res, 'invite.resend',
  { inviteId: req.params.inviteId })));

// GET /api/workspaces/:id/billing — the workspace's OWN wallet (Phase 4).
router.get('/:id/billing', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'viewer'))) {
    return res.status(403).json({ success: false, error: 'Not a member of this workspace' });
  }
  const ws = await getWorkspace(req.db, wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
  await ensureWorkspaceWallet(req.db, wsId);
  const wallet = await walletBalance(req.db, wsId);
  const roles = await memberRoles(req.db, wsId);
  res.json({
    success: true,
    billing: {
      scope: 'workspace-wallet',
      workspace_id: wsId,
      billing_mode: ws.metadata?.billing_mode || 'personal',
      wallet: {
        credits: wallet.credits,
        available_credits: Math.floor(wallet.availableMicro / 1e6),
        pending_credits: Math.floor(wallet.pendingMicro / 1e6),
        is_frozen: wallet.is_frozen,
      },
      budget: ws.metadata?.budget || null,
      seats: roles.size,
    },
  });
}));

// PATCH /api/workspaces/:id/budget — store the budget AND enforce it as a real
// rolling spend cap on the workspace wallet (recordUsageV2 checks caps on every spend).
router.patch('/:id/budget', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'admin'))) {
    return res.status(403).json({ success: false, error: 'Admin required' });
  }
  const budget = (req.body && typeof req.body === 'object') ? req.body : {};
  await req.db.query(
    "UPDATE workspaces SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{budget}', $1::jsonb, true), updated_at = now() WHERE id = $2",
    [JSON.stringify(budget), wsId],
  );
  const monthly = Number(budget.monthly_credits ?? budget.credits ?? budget.limit);
  if (Number.isFinite(monthly) && monthly >= 0) {
    await setWorkspaceBudget(req.db, wsId, { credits: monthly, windowSec: Number(budget.window_sec) || 2592000 });
  }
  await audit(req.db, wsId, req.user.id, 'budget.update', wsId, budget);
  res.json({ success: true });
}));

// POST /api/workspaces/:id/billing/transfer { credits } — fund the workspace wallet
// from the caller's personal wallet (admin+). Atomic saga (debit → grant → refund on fail).
router.post('/:id/billing/transfer', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'admin'))) {
    return res.status(403).json({ success: false, error: 'Admin required' });
  }
  if (!(await getWorkspace(req.db, wsId))) return res.status(404).json({ success: false, error: 'Workspace not found' });
  const result = await transferToWorkspace(req.db, req.user.id, wsId, Number(req.body?.credits));
  if (!result.ok) {
    return res.status(result.status || 400).json({ success: false, error: result.error, currentCredits: result.currentCredits });
  }
  await audit(req.db, wsId, req.user.id, 'billing.transfer', wsId, { credits: result.transferred });
  res.json({ success: true, workspace: result.workspace, personal: result.personal });
}));

// PATCH /api/workspaces/:id/billing/mode { mode: 'personal'|'pooled' } — owner sets
// whether member spends bill the shared workspace wallet (see walletService.resolveBillingAccountId).
router.patch('/:id/billing/mode', wrapId(async (req, res) => {
  const wsId = req.params.id;
  const ws = await getWorkspace(req.db, wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
  if (ws.owner_user_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Only the owner can change billing mode' });
  }
  const mode = req.body?.mode === 'pooled' ? 'pooled' : 'personal';
  if (mode === 'pooled') await ensureWorkspaceWallet(req.db, wsId);
  await req.db.query(
    "UPDATE workspaces SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{billing_mode}', to_jsonb($1::text), true), updated_at = now() WHERE id = $2",
    [mode, wsId],
  );
  await audit(req.db, wsId, req.user.id, 'billing.mode', wsId, { mode });
  res.json({ success: true, billing_mode: mode });
}));

// POST /api/workspaces/:id/billing/subscribe { itemId, seats, consentId, downloadIntent }
// — owner starts a per-seat Team subscription. seats defaults to the current
// member count; consent remains mandatory at the billing-service boundary.
router.post('/:id/billing/subscribe', wrapId(async (req, res) => {
  const wsId = req.params.id;
  const ws = await getWorkspace(req.db, wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found' });
  if (ws.owner_user_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Only the owner can manage the subscription' });
  }
  const memberCount = (await memberRoles(req.db, wsId)).size;
  const seats = Math.max(memberCount, Math.floor(Number(req.body?.seats) || memberCount || 1));
  try {
    /* Carry a download intent if the owner reached this from a Download
     * button, so a Team purchase returns to the download and is attributable
     * to it. Opaque token only — the return URL is built server-side. */
    const downloadIntent = typeof req.body?.downloadIntent === 'string' ? req.body.downloadIntent : null;
    const consentId = typeof req.body?.consentId === 'string' ? req.body.consentId : null;
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : 'team_seat';
    const out = await createWorkspaceSeatCheckout(req.db, req.user, {
      workspaceId: wsId, seats, origin: req.headers.origin, itemId, downloadIntent, consentId,
    });
    await audit(req.db, wsId, req.user.id, 'billing.subscribe', wsId, { seats, itemId });
    res.json({ success: true, url: out.url });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.message, code: e.code || 'checkout_failed' });
  }
}));

// GET /api/workspaces/:id/audit?limit=N
router.get('/:id/audit', wrapId(async (req, res) => {
  const wsId = req.params.id;
  if (!(await can(req.db, wsId, req.user.id, 'viewer'))) {
    return res.status(403).json({ success: false, error: 'Not a member of this workspace' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const rows = (await req.db.query(
    `SELECT a.id, a.action, a.target, a.metadata, a.created_at, a.actor_user_id, u.display_name AS actor_name
       FROM workspace_audit a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.workspace_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
    [wsId, limit],
  )).rows;
  res.json({
    success: true,
    events: rows.map((r) => ({
      id: String(r.id), action: r.action, target: r.target,
      actor_user_id: r.actor_user_id, actor_name: r.actor_name,
      metadata: r.metadata, created_at: r.created_at,
    })),
  });
}));

// ════════════════════════════════════════════════════════════════════════════
// /api/workspace-invites  (the invitee's side)
// ════════════════════════════════════════════════════════════════════════════
const inviteRouter = express.Router();
inviteRouter.use(requireWorkspaceAuthority);
inviteRouter.use('/operations', accountWorkspaceOperationRoutes);

// GET /api/workspace-invites — my pending invites.
inviteRouter.get('/', wrap(async (req, res) => {
  const rows = (await req.db.query(
    `SELECT i.*, w.name AS workspace_name, u.display_name AS invited_by_name
       FROM workspace_invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.invited_by_user_id
      -- A PINNED invitation has exactly one recipient. Only an unpinned invitation is
      -- addressed by email, so the pin takes PRECEDENCE rather than adding an alternative
      -- -- an OR here shows somebody else's invitation to whoever shares the address.
      WHERE i.status = 'pending'
        AND (CASE WHEN i.invited_user_id IS NOT NULL
                  THEN i.invited_user_id = $1
                  ELSE lower(i.invited_email) = lower($2) END)
      ORDER BY i.created_at DESC`,
    [req.user.id, req.user.email || ''],
  )).rows;
  res.json({ success: true, invites: rows.map(shapeInvite) });
}));

// POST /api/workspace-invites/:inviteId/{accept,decline}
//
// Shims over the canonical invite-decision service -- the same code path the receipted
// `/operations` surface uses. They carried their own inline copy until now, and the copy
// had drifted in two ways that mattered:
//
//   * the recipient test ORed the two clauses, so an invitation PINNED to a user
//     (`invited_user_id`) was still acceptable by anyone whose address matched
//     `invited_email`. The service tests the pin FIRST and reads the address only when
//     there is no pin, so a pinned invitation has exactly one legitimate recipient.
//   * `decline` took the invitation row lock but never the workspace authority gate, so
//     it could interleave with a seat change. Every membership writer takes the same
//     gate, in the same order, or the ordering is not an ordering.
//
// No operation ID means no promise of replay: the commit completes before the ACK and a
// lost ACK is re-driven by asking again. Clients needing replay use `/operations`.
for (const action of ['accept', 'decline']) {
  inviteRouter.post(`/:inviteId/${action}`, wrap(async (req, res) => {
    let result;
    try {
      result = await authorityTransaction(req.db, db =>
        decideWorkspaceInvite(db, req.user.id, req.params.inviteId, action));
    } catch (failure) {
      // The service refuses with a TYPED error carrying the status it means -- 402 for a
      // seat limit, 404 for an invitation that is not this account's, 403 for an archived
      // workspace. Letting those reach the generic handler turns every refusal into a 500,
      // which is indistinguishable from the server being broken. An error without a status
      // IS unexpected and keeps that treatment deliberately.
      if (!failure.status) throw failure;
      return res.status(failure.status).json({ success: false, error: failure.code });
    }
    // A rejection is a COMMITTED terminal outcome (expiry writes its transition), not a
    // failure to act -- so it answers 410 rather than rolling the transaction back.
    if (result.rejection) return res.status(410).json({ success: false, error: result.rejection });
    res.json({ success: true });
  }));
}

export { router as workspaceRoutes, inviteRouter as workspaceInviteRoutes };
export default router;
