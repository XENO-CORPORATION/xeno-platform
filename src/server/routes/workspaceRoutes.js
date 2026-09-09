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
import workspaceTeamRoutes from './workspaceTeamRoutes.js';

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
const router = express.Router();
router.use('/:id/teams', workspaceTeamRoutes);

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
router.patch('/:id/members/:memberId', wrapId(async (req, res) => {
  const { id: wsId, memberId } = req.params;
  const changed = await withTransaction(req.db, async (tx) => {
    const ws = (await tx.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [wsId])).rows[0];
    if (!ws) { res.status(404).json({ success: false, error: 'Workspace not found' }); return false; }
    if (!(await can(tx, wsId, req.user.id, 'admin'))) {
      res.status(403).json({ success: false, error: 'Admin required' }); return false;
    }
    const newRel = toRelation(req.body?.member_role);
    if (memberId === ws.owner_user_id) {
      res.status(400).json({ success: false, error: 'Use owner-transfer to change the owner' }); return false;
    }
    if (String(req.body?.member_role).toLowerCase() === 'owner') {
      res.status(400).json({ success: false, error: 'Use owner-transfer to assign ownership' }); return false;
    }
    const roles = await memberRoles(tx, wsId);
    if (!roles.has(memberId)) { res.status(404).json({ success: false, error: 'Not a member' }); return false; }
    const deletes = (await listObjectTuples(tx, WS(wsId)))
      .filter((t) => t.subject === USER(memberId))
      .map((t) => ({ object: WS(wsId), relation: t.relation, subject: USER(memberId) }));
    await writeTuples(tx, { deletes, writes: [{ object: WS(wsId), relation: newRel, subject: USER(memberId) }] });
    await auditStrict(tx, wsId, req.user.id, 'member.role_change', memberId, { from: roles.get(memberId), to: newRel });
    return true;
  });
  if (!changed) return;
  res.json({ success: true });
}));

// DELETE /api/workspaces/:id/members/:memberId  (admin removes; or self-leave)
router.delete('/:id/members/:memberId', wrapId(async (req, res) => {
  const { id: wsId, memberId } = req.params;
  const removed = await withTransaction(req.db, async (tx) => {
    const ws = (await tx.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [wsId])).rows[0];
    if (!ws) { res.status(404).json({ success: false, error: 'Workspace not found' }); return false; }
    const isSelf = memberId === req.user.id;
    if (!isSelf && !(await can(tx, wsId, req.user.id, 'admin'))) {
      res.status(403).json({ success: false, error: 'Admin required' }); return false;
    }
    if (memberId === ws.owner_user_id) {
      res.status(400).json({ success: false, error: 'Owner cannot be removed; transfer ownership first' }); return false;
    }
    const deletes = (await listObjectTuples(tx, WS(wsId)))
      .filter((t) => t.subject === USER(memberId))
      .map((t) => ({ object: WS(wsId), relation: t.relation, subject: USER(memberId) }));
    if (!deletes.length) { res.status(404).json({ success: false, error: 'Not a member' }); return false; }
    await writeTuples(tx, { deletes });
    await auditStrict(tx, wsId, req.user.id, isSelf ? 'member.leave' : 'member.remove', memberId, {});
    return true;
  });
  if (!removed) return;
  res.json({ success: true });
}));

// POST /api/workspaces/:id/owner-transfer { new_owner_user_id }
router.post('/:id/owner-transfer', wrapId(async (req, res) => {
  const wsId = req.params.id;
  const newOwner = req.body?.new_owner_user_id;
  if (!newOwner || !UUID_RE.test(String(newOwner))) {
    return res.status(400).json({ success: false, error: 'new_owner_user_id is required' });
  }
  const transferred = await withTransaction(req.db, async (tx) => {
    const ws = (await tx.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [wsId])).rows[0];
    if (!ws) { res.status(404).json({ success: false, error: 'Workspace not found' }); return false; }
    if (ws.owner_user_id !== req.user.id) {
      res.status(403).json({ success: false, error: 'Only the current owner can transfer ownership' }); return false;
    }
    const roles = await memberRoles(tx, wsId);
    if (!roles.has(newOwner)) { res.status(400).json({ success: false, error: 'New owner must already be a member' }); return false; }
    const tuples = await listObjectTuples(tx, WS(wsId));
    const deletes = tuples
      .filter((t) => t.subject === USER(req.user.id) || t.subject === USER(newOwner))
      .map((t) => ({ object: WS(wsId), relation: t.relation, subject: t.subject }));
    await writeTuples(tx, {
      deletes,
      writes: [
        { object: WS(wsId), relation: 'owner', subject: USER(newOwner) },
        { object: WS(wsId), relation: 'admin', subject: USER(req.user.id) },
      ],
    });
    await tx.query('UPDATE workspaces SET owner_user_id = $1, updated_at = now() WHERE id = $2', [newOwner, wsId]);
    await auditStrict(tx, wsId, req.user.id, 'owner.transfer', newOwner, { from: req.user.id });
    return true;
  });
  if (!transferred) return;
  res.json({ success: true });
}));

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
router.post('/:id/invites', wrapId(async (req, res) => {
  const wsId = req.params.id;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'A valid email is required' });
  }
  const role = toRelation(req.body?.role);
  if (!INVITABLE_RELATIONS.has(role)) {
    return res.status(403).json({ success: false, error: 'Invites cannot grant the owner role. Use owner-transfer instead.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const created = await withTransaction(req.db, async (tx) => {
    const ws = (await tx.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [wsId])).rows[0];
    if (!ws) { res.status(404).json({ success: false, error: 'Workspace not found' }); return null; }
    if (!(await can(tx, wsId, req.user.id, 'admin'))) {
      res.status(403).json({ success: false, error: 'Admin required' }); return null;
    }
    const roles = await memberRoles(tx, wsId);
    const existingUser = (await tx.query(
      'SELECT id, display_name FROM users WHERE lower(email) = $1 LIMIT 1', [email],
    )).rows[0];
    if (existingUser && roles.has(existingUser.id)) {
      res.status(409).json({ success: false, error: 'This user is already a member' }); return null;
    }
    // The workspace row lock serializes seat reservations across concurrent invites.
    const seatInfo = await workspaceSeatInfo(tx, wsId, roles.size);
    if (seatInfo.used >= seatInfo.limit) {
      res.status(402).json({
        success: false,
        error: `Seat limit reached (${seatInfo.limit} seats on the ${seatInfo.plan} plan). Upgrade the workspace to invite more members.`,
        seat_limit: seatInfo.limit, seats_used: seatInfo.used,
      });
      return null;
    }
    try {
      const invite = (await tx.query(
        `INSERT INTO workspace_invites (workspace_id, invited_by_user_id, invited_user_id, invited_email, role, token, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [wsId, req.user.id, existingUser?.id || null, email, role, token, expiresAt],
      )).rows[0];
      await auditStrict(tx, wsId, req.user.id, 'invite.create', email, { role });
      return { ws, invite };
    } catch (e) {
      if (e.code === '23505') { res.status(409).json({ success: false, error: 'An invite is already pending for this email' }); return null; }
      throw e;
    }
  });
  if (!created) return;
  await sendInviteEmail(req.db, created.ws, created.invite, req.user);
  const invite = created.invite;
  const ws = created.ws;
  res.json({ success: true, invite: shapeInvite({ ...invite, workspace_name: ws.name, invited_by_name: req.user.display_name }) });
}));

// DELETE /api/workspaces/:id/invites/:inviteId  (revoke)
router.delete('/:id/invites/:inviteId', wrapId(async (req, res) => {
  const { id: wsId, inviteId } = req.params;
  const revoked = await withTransaction(req.db, async (tx) => {
    await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [wsId]);
    if (!(await can(tx, wsId, req.user.id, 'admin'))) {
      res.status(403).json({ success: false, error: 'Admin required' }); return false;
    }
    const r = await tx.query(
      "UPDATE workspace_invites SET status = 'revoked' WHERE id = $1 AND workspace_id = $2 AND status = 'pending' RETURNING id",
      [inviteId, wsId],
    );
    if (!r.rows.length) { res.status(404).json({ success: false, error: 'Pending invite not found' }); return false; }
    await auditStrict(tx, wsId, req.user.id, 'invite.revoke', inviteId, {});
    return true;
  });
  if (!revoked) return;
  res.json({ success: true });
}));

// POST /api/workspaces/:id/invites/:inviteId/resend
router.post('/:id/invites/:inviteId/resend', wrapId(async (req, res) => {
  const { id: wsId, inviteId } = req.params;
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const resend = await withTransaction(req.db, async (tx) => {
    const ws = (await tx.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [wsId])).rows[0];
    if (!ws) { res.status(404).json({ success: false, error: 'Workspace not found' }); return null; }
    if (!(await can(tx, wsId, req.user.id, 'admin'))) {
      res.status(403).json({ success: false, error: 'Admin required' }); return null;
    }
    const inv = (await tx.query(
      "SELECT * FROM workspace_invites WHERE id = $1 AND workspace_id = $2 AND status = 'pending' FOR UPDATE", [inviteId, wsId],
    )).rows[0];
    if (!inv) { res.status(404).json({ success: false, error: 'Pending invite not found' }); return null; }
    await tx.query('UPDATE workspace_invites SET expires_at = $1 WHERE id = $2', [expiresAt, inv.id]);
    await auditStrict(tx, wsId, req.user.id, 'invite.resend', inv.id, {});
    return { ws, inv };
  });
  if (!resend) return;
  await sendInviteEmail(req.db, resend.ws, { ...resend.inv, expires_at: expiresAt }, req.user);
  res.json({ success: true });
}));

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

const inviteIsForMe = (inv, user) =>
  (inv.invited_user_id && inv.invited_user_id === user.id) ||
  (inv.invited_email && String(inv.invited_email).toLowerCase() === String(user.email || '').toLowerCase());

// GET /api/workspace-invites — my pending invites.
inviteRouter.get('/', wrap(async (req, res) => {
  const rows = (await req.db.query(
    `SELECT i.*, w.name AS workspace_name, u.display_name AS invited_by_name
       FROM workspace_invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.invited_by_user_id
      WHERE i.status = 'pending' AND (i.invited_user_id = $1 OR lower(i.invited_email) = lower($2))
      ORDER BY i.created_at DESC`,
    [req.user.id, req.user.email || ''],
  )).rows;
  res.json({ success: true, invites: rows.map(shapeInvite) });
}));

// POST /api/workspace-invites/:inviteId/accept
inviteRouter.post('/:inviteId/accept', wrap(async (req, res) => {
  const accepted = await withTransaction(req.db, async (tx) => {
    const inv = (await tx.query(
      "SELECT * FROM workspace_invites WHERE id = $1 AND status = 'pending' FOR UPDATE", [req.params.inviteId],
    )).rows[0];
    if (!inv) { res.status(404).json({ success: false, error: 'Invite not found' }); return false; }
    if (!inviteIsForMe(inv, req.user)) { res.status(403).json({ success: false, error: 'This invite is not for you' }); return false; }
    // Serialize accept/revoke/invite operations for seat and ownership correctness.
    await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [inv.workspace_id]);
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      await tx.query("UPDATE workspace_invites SET status = 'expired' WHERE id = $1", [inv.id]);
      await auditStrict(tx, inv.workspace_id, req.user.id, 'invite.expire', inv.id, {});
      return { expired: true };
    }
    // The pending invite reserved a seat; re-check because the paid limit can change.
    const acceptRoles = await memberRoles(tx, inv.workspace_id);
    const acceptSeats = await workspaceSeatInfo(tx, inv.workspace_id, acceptRoles.size);
    if (acceptRoles.size >= acceptSeats.limit && !acceptRoles.has(req.user.id)) {
      res.status(402).json({ success: false, error: `This workspace has reached its seat limit (${acceptSeats.limit}).` });
      return false;
    }
    const acceptRelation = toRelation(inv.role);
    if (!INVITABLE_RELATIONS.has(acceptRelation)) {
      res.status(403).json({ success: false, error: 'This invite grants a role that cannot be accepted. Ownership moves only via owner-transfer.' });
      return false;
    }
    await writeTuples(tx, { writes: [{ object: WS(inv.workspace_id), relation: acceptRelation, subject: USER(req.user.id) }] });
    await tx.query(
      "UPDATE workspace_invites SET status = 'accepted', accepted_at = now(), invited_user_id = $1 WHERE id = $2",
      [req.user.id, inv.id],
    );
    await auditStrict(tx, inv.workspace_id, req.user.id, 'invite.accept', req.user.id, { role: inv.role });
    return true;
  });
  if (accepted?.expired) return res.status(410).json({ success: false, error: 'This invite has expired' });
  if (!accepted) return;
  res.json({ success: true });
}));

// POST /api/workspace-invites/:inviteId/decline
inviteRouter.post('/:inviteId/decline', wrap(async (req, res) => {
  const declined = await withTransaction(req.db, async (tx) => {
    const inv = (await tx.query(
      "SELECT * FROM workspace_invites WHERE id = $1 AND status = 'pending' FOR UPDATE", [req.params.inviteId],
    )).rows[0];
    if (!inv) { res.status(404).json({ success: false, error: 'Invite not found' }); return false; }
    if (!inviteIsForMe(inv, req.user)) { res.status(403).json({ success: false, error: 'This invite is not for you' }); return false; }
    await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [inv.workspace_id]);
    await tx.query("UPDATE workspace_invites SET status = 'declined' WHERE id = $1", [inv.id]);
    await auditStrict(tx, inv.workspace_id, req.user.id, 'invite.decline', inv.id, {});
    return true;
  });
  if (!declined) return;
  res.json({ success: true });
}));

export { router as workspaceRoutes, inviteRouter as workspaceInviteRoutes };
export default router;
