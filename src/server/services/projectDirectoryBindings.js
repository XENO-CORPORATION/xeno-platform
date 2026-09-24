/**
 * Project directory bindings -- XENO-WORKFORCE-01 ASN-07 and ASN-08.
 *
 * A project's directory is a BINDING: (project, host installation, canonical root, revision). Not a
 * path on the project, and never matched by name or path string:
 *
 *   - The HOST is the authenticated installation -- the DPoP key thumbprint the request is bound
 *     to, the same identity Agent conversation mappings use. It is DERIVED from `req.auth.dpopJkt`
 *     and never read from a body, so an installation can bind roots only on itself.
 *   - The ROOT is what the host canonicalized. The Platform cannot resolve a path on another
 *     machine and does not pretend to: the database refuses a root that could not have come from
 *     canonicalization, and the host's own realpath/symlink enforcement stays authoritative.
 *   - ASN-08's reconciliation is by ID: the Interface keeps its own directory projection and asks
 *     the Platform "which project is bound to this root on me?" -- a lookup by (installation,
 *     canonical root), never by display name.
 *
 * AGENT EXECUTION ROOT. executionRootFor() is the one question an Agent host asks before running in
 * a project: a live binding on THIS installation, or null. Null is a real answer -- a research
 * project with no directory, or one not bound here -- and the caller must refuse execution rather
 * than fall back to some other directory.
 */
import { check } from '../utils/authzReBAC.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { withTransaction } from './chatProjectAuthority.js';

export class DirectoryBindingError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = 'DirectoryBindingError';
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status, message) => { throw new DirectoryBindingError(code, status, message); };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JKT_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The installation making the request. Only a DPoP-bound OIDC session HAS an installation: a bearer
 * token can be replayed from any machine, so a binding made with one would name no host at all.
 */
export function hostOf(auth, scope) {
  if (auth?.kind !== 'oidc' || !JKT_RE.test(String(auth.dpopJkt || ''))) {
    fail('sender_bound_installation_required', 401, 'A directory binding is made by a sender-bound installation.');
  }
  const granted = new Set(String(auth.scope || '').split(/\s+/).filter(Boolean));
  if (!granted.has(scope) || !(scopesForClient(auth.clientId) || []).includes(scope)) {
    fail('insufficient_scope', 403, `The ${scope} scope is required.`);
  }
  return { installationId: auth.dpopJkt, clientId: auth.clientId };
}

/**
 * Normalize nothing, refuse what is not canonical. The host's canonical form is authoritative; a
 * root the Platform would have to rewrite to accept was not canonicalized, and rewriting it here
 * would bind a path the host never resolved. The database enforces the same rules; these exist to
 * answer with a named reason instead of a constraint violation.
 */
export function canonicalRoot(family, root) {
  if (!['posix', 'windows'].includes(family)) fail('invalid_root_family', 400);
  if (typeof root !== 'string' || root.length < 1 || root.length > 4096 || /[\u0000-\u001f]/.test(root)) {
    fail('invalid_root', 400);
  }
  const sep = family === 'posix' ? '/' : '\\';
  const other = family === 'posix' ? '\\' : '/';
  const absolute = family === 'posix' ? root.startsWith('/') : /^[A-Za-z]:\\/.test(root) || /^\\\\[^\\]+\\[^\\]+/.test(root);
  const body = family === 'windows' && root.startsWith('\\\\') ? root.slice(2) : root;
  const segments = body.split(sep);
  const isVolumeRoot = family === 'posix' ? root === '/' : /^[A-Za-z]:\\$/.test(root);
  if (!absolute || root.includes(other) || body.includes(sep + sep)
      || segments.some((s) => s === '.' || s === '..') || (!isVolumeRoot && root.endsWith(sep))) {
    fail('root_not_canonical', 400, 'The root must be the host-canonicalized absolute path.');
  }
  return root;
}

/** May this principal manage this project's bindings? `editor` on the project, as linking assets needs. */
async function requireProjectEditor(db, userId, projectId) {
  if (!UUID_RE.test(String(projectId || ''))) fail('invalid_project_id', 400);
  const project = (await db.query('SELECT id, is_archived FROM chat_projects WHERE id=$1 FOR SHARE', [projectId])).rows[0];
  const verdict = project ? await check(db, { object: `project:${projectId}`, relation: 'editor', subject: `user:${userId}` }) : null;
  // Existence is not disclosed to someone who cannot edit it.
  if (!project || !verdict?.allowed) fail('project_not_found', 404);
  if (project.is_archived) fail('project_archived', 409, 'An archived project admits no new directory binding.');
  return project;
}

export function publicBinding(row) {
  return {
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    host: { installationId: row.host_installation_id, clientId: row.host_client_id },
    rootFamily: row.root_family,
    canonicalRoot: row.canonical_root,
    label: row.label,
    state: row.state,
    revision: String(row.revision),
    boundAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

/** Bind a root on the CALLING installation to a project. Idempotent for the same (project, host, root). */
export async function bindProjectDirectory(pool, { userId, auth, projectId, rootFamily, root, label = null }) {
  const host = hostOf(auth, 'projects:write');
  const canonical = canonicalRoot(rootFamily, root);
  if (label !== null && (typeof label !== 'string' || !label.trim() || label.length > 200)) fail('invalid_label', 400);
  return withTransaction(pool, async (tx) => {
    await requireProjectEditor(tx, userId, projectId);
    // The same root on this host, already live, answers with the existing binding when it is this
    // project's, and is refused when it belongs to another: one directory is one resource per host.
    const existing = (await tx.query(
      `SELECT * FROM project_directory_bindings WHERE host_installation_id=$1 AND state='active'
         AND (CASE WHEN root_family='windows' THEN lower(canonical_root) ELSE canonical_root END)
           = (CASE WHEN $2='windows' THEN lower($3) ELSE $3 END)
       FOR UPDATE`, [host.installationId, rootFamily, canonical])).rows[0];
    if (existing) {
      if (existing.project_id !== projectId) fail('root_bound_to_another_project', 409,
        'This directory is already bound to another project on this installation.');
      return { binding: publicBinding(existing), replayed: true };
    }
    const row = (await tx.query(
      `INSERT INTO project_directory_bindings(project_id, host_installation_id, host_owner_user_id, host_client_id,
         root_family, canonical_root, label, bound_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$3) RETURNING *`,
      [projectId, host.installationId, userId, host.clientId, rootFamily, canonical, label ? label.trim() : null])).rows[0];
    return { binding: publicBinding(row), replayed: false };
  });
}

/** Revoke a binding. Only on the installation that made it, by an editor of the project. */
export async function revokeProjectDirectory(pool, { userId, auth, bindingId, expectedRevision }) {
  const host = hostOf(auth, 'projects:write');
  if (!UUID_RE.test(String(bindingId || ''))) fail('invalid_binding_id', 400);
  return withTransaction(pool, async (tx) => {
    const row = (await tx.query('SELECT * FROM project_directory_bindings WHERE id=$1 FOR UPDATE', [bindingId])).rows[0];
    if (!row || row.host_installation_id !== host.installationId) fail('binding_not_found', 404);
    const verdict = await check(tx, { object: `project:${row.project_id}`, relation: 'editor', subject: `user:${userId}` });
    if (!verdict.allowed) fail('binding_not_found', 404);
    if (row.state === 'revoked') return { binding: publicBinding(row), replayed: true };
    if (expectedRevision !== undefined && String(row.revision) !== String(expectedRevision)) fail('binding_revision_changed', 409);
    const updated = (await tx.query(
      `UPDATE project_directory_bindings SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(),
         revoked_by_user_id=$2 WHERE id=$1 RETURNING *`, [bindingId, userId])).rows[0];
    return { binding: publicBinding(updated), replayed: false };
  });
}

/**
 * ASN-08's reconciliation lookup: which project is this root bound to ON THIS INSTALLATION? The
 * Interface asks this instead of matching its projection to a project by name or by path string.
 */
export async function projectForRoot(db, { userId, auth, rootFamily, root }) {
  const host = hostOf(auth, 'projects:read');
  const canonical = canonicalRoot(rootFamily, root);
  const row = (await db.query(
    `SELECT b.* FROM project_directory_bindings b JOIN chat_projects p ON p.id=b.project_id AND NOT p.is_archived
      WHERE b.host_installation_id=$1 AND b.state='active'
        AND (CASE WHEN b.root_family='windows' THEN lower(b.canonical_root) ELSE b.canonical_root END)
          = (CASE WHEN $2='windows' THEN lower($3) ELSE $3 END)`, [host.installationId, rootFamily, canonical])).rows[0];
  if (!row) return { binding: null };
  const verdict = await check(db, { object: `project:${row.project_id}`, relation: 'viewer', subject: `user:${userId}` });
  return { binding: verdict.allowed ? publicBinding(row) : null };
}

/**
 * The authorized execution root for Agent work in a project, on the calling installation, or null.
 * A caller that gets null must refuse to execute -- never substitute another directory.
 */
export async function executionRootFor(db, { userId, auth, projectId }) {
  const host = hostOf(auth, 'projects:read');
  if (!UUID_RE.test(String(projectId || ''))) fail('invalid_project_id', 400);
  const verdict = await check(db, { object: `project:${projectId}`, relation: 'editor', subject: `user:${userId}` });
  if (!verdict.allowed) fail('project_not_found', 404);
  const root = (await db.query('SELECT * FROM chat_project_execution_root($1,$2) LIMIT 1', [projectId, host.installationId])).rows[0];
  return root
    ? { executionRoot: { bindingId: root.binding_id, rootFamily: root.root_family, canonicalRoot: root.canonical_root, revision: String(root.revision) } }
    : { executionRoot: null, reason: 'no_authorized_root_on_this_installation' };
}

/** A project's bindings across every host, for its editors: which machines have it, where. */
export async function listProjectDirectories(db, { userId, projectId }) {
  if (!UUID_RE.test(String(projectId || ''))) fail('invalid_project_id', 400);
  const verdict = await check(db, { object: `project:${projectId}`, relation: 'viewer', subject: `user:${userId}` });
  if (!verdict.allowed) fail('project_not_found', 404);
  const rows = (await db.query(
    `SELECT * FROM project_directory_bindings WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200`, [projectId])).rows;
  return { bindings: rows.map(publicBinding) };
}
