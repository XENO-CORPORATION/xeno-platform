/**
 * The platform's own release record — ONE service for the staff console, the customer "What's new" page, the agent
 * tools (releasesMcp.js), the deploy recorder (scripts/record-deploy.js) and the history import.
 *
 *   deploys   every deploy of the platform (staff only)
 *   features  each feature: status, where it is enabled, its PRs / releases / tags / commits, proof (staff only)
 *   notes     plain-language "what's new" per feature. Drafted by staff or a staff agent; approved by a HUMAN on staff;
 *             a customer sees an approved note only for a LIVE feature enabled for them.
 *
 * Leak rules, held here and not in the screens:
 *   - every staff read refuses a non-staff caller with "not found" (nothing to probe);
 *   - the customer read path selects only the note's own words and date — never a PR, repo, slug, spec or test field;
 *   - a feature is invisible to customers until it is live AND enabled for them AND has an approved note.
 */
import { getEffectivePlan, workspacePlansFor } from './effectivePlan.js';

export class ReleaseError extends Error {
  constructor(message, code, statusCode = 400) { super(message); this.name = 'ReleaseError'; this.code = code; this.statusCode = statusCode; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ['admin', 'moderator'];
const kindOf = (u) => (u && u.kind === 'agent' ? 'agent' : u && u.kind === 'service' ? 'service' : 'human');
/** A human with an effective role of moderator or admin. An agent is never staff, whatever its role says. */
export const isStaff = (u) => !!u && kindOf(u) === 'human' && STAFF_ROLES.includes(u.role);
/** An agent acting for staff: its effective role is capped by its owner's, so this is "owned by staff". */
export const isStaffAgent = (u) => !!u && kindOf(u) === 'agent' && STAFF_ROLES.includes(u.role);
const canRead = (u) => isStaff(u) || isStaffAgent(u);
const notFound = () => new ReleaseError('Not found', 'not_found', 404);
const needRead = (u) => { if (!canRead(u)) throw notFound(); };
const needHumanStaff = (u) => {
  if (!canRead(u)) throw notFound();
  if (!isStaff(u)) throw new ReleaseError('Only a person on XENO staff may do this', 'human_staff_only', 403);
};
const text = (v, field, max, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new ReleaseError(`${field} is required`, `${field}_required`);
  if (s.length > max) throw new ReleaseError(`${field} is longer than ${max} characters`, `${field}_too_long`);
  return s;
};
const limitOf = (v, d = 50, max = 200) => Math.max(1, Math.min(max, Number.parseInt(v, 10) || d));
const iso = (d) => (d ? new Date(d).toISOString() : null);

export const SCOPES = ['none', 'all', 'plans', 'workspaces'];
export const STATUSES = ['built', 'live', 'retired'];

// ── deploys ───────────────────────────────────────────────────────────────────────────────────────────────────────
const deployShape = (r) => ({
  id: r.id, repo: r.repo, service: r.service, sha: r.sha, previousSha: r.previous_sha, mode: r.mode, status: r.status,
  startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), deployedBy: r.deployed_by, healthcheck: r.healthcheck,
  rollbackPoint: r.rollback_point, prs: r.prs || [], migrations: r.migrations || [], provenance: r.provenance, evidence: r.evidence,
});

/**
 * Record one deploy. Called by scripts/record-deploy.js on the box at the end of every deploy (OK or failed), and by
 * the history import. Idempotent on service|sha|startedAt. `previousSha` defaults to the last OK swap of the service.
 */
export async function recordDeploy(db, d) {
  const service = text(d.service, 'service', 40);
  const sha = text(d.sha, 'sha', 64);
  const mode = ['swap', 'build-only', 'rollback'].includes(d.mode) ? d.mode : 'swap';
  const status = ['ok', 'failed', 'interrupted'].includes(d.status) ? d.status : null;
  if (!status) throw new ReleaseError('status must be ok, failed or interrupted', 'invalid_status');
  const provenance = d.provenance === 'reconstructed' ? 'reconstructed' : 'recorded';
  if (provenance === 'reconstructed' && !d.evidence) throw new ReleaseError('a reconstructed deploy needs its evidence', 'evidence_required');
  const startedAt = d.startedAt ? new Date(d.startedAt) : null;
  if (startedAt && Number.isNaN(startedAt.getTime())) throw new ReleaseError('startedAt is not a date', 'invalid_date');
  let previous = d.previousSha || null;
  if (!previous && mode === 'swap') {
    const p = await db.query(
      `SELECT sha FROM release_deploys WHERE service = $1 AND mode = 'swap' AND status = 'ok' AND ($2::timestamptz IS NULL OR started_at < $2) ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [service, startedAt]);
    previous = p.rows[0]?.sha || null;
  }
  const key = `${service}|${sha}|${startedAt ? startedAt.toISOString() : 'unknown'}`;
  const prs = (Array.isArray(d.prs) ? d.prs : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const migrations = (Array.isArray(d.migrations) ? d.migrations : []).map(String).filter(Boolean).slice(0, 500);
  const r = await db.query(
    `INSERT INTO release_deploys (natural_key, repo, service, sha, previous_sha, mode, status, started_at, finished_at, deployed_by,
                                  healthcheck, rollback_point, prs, migrations, provenance, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (natural_key) DO UPDATE SET status = EXCLUDED.status, finished_at = COALESCE(EXCLUDED.finished_at, release_deploys.finished_at),
       healthcheck = COALESCE(EXCLUDED.healthcheck, release_deploys.healthcheck), rollback_point = COALESCE(EXCLUDED.rollback_point, release_deploys.rollback_point),
       prs = CASE WHEN cardinality(EXCLUDED.prs) > 0 THEN EXCLUDED.prs ELSE release_deploys.prs END,
       migrations = CASE WHEN cardinality(EXCLUDED.migrations) > 0 THEN EXCLUDED.migrations ELSE release_deploys.migrations END,
       deployed_by = COALESCE(EXCLUDED.deployed_by, release_deploys.deployed_by)
     RETURNING *, (xmax = 0) AS inserted`,
    [key, d.repo || 'xeno-platform', service, sha, previous, mode, status, startedAt, d.finishedAt ? new Date(d.finishedAt) : null,
      d.deployedBy || null, d.healthcheck || null, d.rollbackPoint || null, prs, migrations, provenance, d.evidence || null]);
  return { deploy: deployShape(r.rows[0]), inserted: r.rows[0].inserted };
}

export async function listDeploys(db, actor, { service, status, limit, before } = {}) {
  needRead(actor);
  const where = [], p = [];
  if (service) { p.push(service); where.push(`service = $${p.length}`); }
  if (status) { p.push(status); where.push(`status = $${p.length}`); }
  if (before) { p.push(new Date(before)); where.push(`started_at < $${p.length}`); }
  p.push(limitOf(limit));
  const r = await db.query(`SELECT * FROM release_deploys ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC NULLS LAST LIMIT $${p.length}`, p);
  return r.rows.map(deployShape);
}

export async function getDeploy(db, actor, id) {
  needRead(actor);
  if (!UUID.test(String(id))) throw notFound();
  const r = await db.query('SELECT * FROM release_deploys WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound();
  const d = deployShape(r.rows[0]);
  const prs = d.prs.length ? (await db.query(
    `SELECT external_id, title, url, at FROM release_changes WHERE repo = $1 AND kind = 'pr' AND external_id = ANY($2::text[]) ORDER BY at`,
    [d.repo, d.prs.map(String)])).rows.map((x) => ({ number: Number(x.external_id), title: x.title, url: x.url, mergedAt: iso(x.at) })) : [];
  return { ...d, pullRequests: prs };
}

// ── features ──────────────────────────────────────────────────────────────────────────────────────────────────────
const featureShape = (r) => ({
  id: r.id, slug: r.slug, title: r.title, repo: r.repo, area: r.area, status: r.status,
  enabled: { scope: r.enabled_scope, plans: r.enabled_plans || [], workspaces: r.workspace_ids || [] },
  specRef: r.spec_ref, testProof: r.test_proof, provenance: r.provenance, evidence: r.evidence,
  firstChangeAt: iso(r.first_change_at), lastChangeAt: iso(r.last_change_at),
  changes: r.change_count == null ? undefined : Number(r.change_count),
  notes: r.note_states || undefined,
});
const FEATURE_SELECT = `SELECT f.*, (SELECT COALESCE(array_agg(workspace_id::text), '{}') FROM release_feature_workspaces w WHERE w.feature_id = f.id) AS workspace_ids,
  (SELECT count(*) FROM release_changes c WHERE c.feature_id = f.id) AS change_count FROM release_features f`;

export async function listFeatures(db, actor, { repo, status, q, limit, offset } = {}) {
  needRead(actor);
  const where = [], p = [];
  if (repo) { p.push(repo); where.push(`f.repo = $${p.length}`); }
  if (status) { p.push(status); where.push(`f.status = $${p.length}`); }
  if (q) { p.push(`%${String(q).slice(0, 100)}%`); where.push(`(f.title ILIKE $${p.length} OR f.slug ILIKE $${p.length})`); }
  p.push(limitOf(limit)); const li = p.length; p.push(Math.max(0, Number.parseInt(offset, 10) || 0));
  const r = await db.query(`${FEATURE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.last_change_at DESC NULLS LAST, f.slug LIMIT $${li} OFFSET $${p.length}`, p);
  return r.rows.map(featureShape);
}

async function featureRow(db, idOrSlug) {
  const s = String(idOrSlug || '');
  const r = await db.query(`${FEATURE_SELECT} WHERE ${UUID.test(s) ? 'f.id = $1' : 'f.slug = $1'}`, [s]);
  return r.rows[0] || null;
}

export async function getFeature(db, actor, idOrSlug) {
  needRead(actor);
  const row = await featureRow(db, idOrSlug);
  if (!row) throw notFound();
  const changes = await db.query('SELECT kind, external_id, title, url, author, sha, at FROM release_changes WHERE feature_id = $1 ORDER BY at DESC NULLS LAST LIMIT 500', [row.id]);
  const notes = await db.query('SELECT * FROM release_notes WHERE feature_id = $1 ORDER BY created_at DESC', [row.id]);
  return { ...featureShape(row), changes: changes.rows.map((c) => ({ kind: c.kind, id: c.external_id, title: c.title, url: c.url, author: c.author, sha: c.sha, at: iso(c.at) })), notes: notes.rows.map(noteShape) };
}

/** Create or update a feature by slug (the import and staff). A person on staff only — an agent cannot enable anything. */
export async function upsertFeature(db, actor, f, { system = false } = {}) {
  if (!system) needHumanStaff(actor);
  const slug = text(f.slug, 'slug', 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(slug)) throw new ReleaseError('slug may use a-z, 0-9, . _ : -', 'invalid_slug');
  const r = await db.query(
    `INSERT INTO release_features (slug, title, repo, area, status, spec_ref, test_proof, provenance, evidence, first_change_at, last_change_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, area = COALESCE(EXCLUDED.area, release_features.area),
       status = CASE WHEN release_features.provenance = 'recorded' AND EXCLUDED.provenance = 'derived' THEN release_features.status ELSE EXCLUDED.status END,
       first_change_at = LEAST(release_features.first_change_at, EXCLUDED.first_change_at),
       last_change_at = GREATEST(release_features.last_change_at, EXCLUDED.last_change_at), updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [slug, text(f.title, 'title', 200), text(f.repo, 'repo', 80), f.area || null, STATUSES.includes(f.status) ? f.status : 'built',
      f.specRef || null, f.testProof || null, f.provenance === 'derived' ? 'derived' : 'recorded', f.evidence || null,
      f.firstChangeAt ? new Date(f.firstChangeAt) : null, f.lastChangeAt ? new Date(f.lastChangeAt) : null]);
  return { id: r.rows[0].id, inserted: r.rows[0].inserted };
}

/** Staff edits a feature: status, where it is enabled, its spec and proof. Human staff only. */
export async function updateFeature(db, actor, idOrSlug, patch = {}) {
  needHumanStaff(actor);
  const row = await featureRow(db, idOrSlug);
  if (!row) throw notFound();
  const sets = [], p = [];
  const set = (col, v) => { p.push(v); sets.push(`${col} = $${p.length}`); };
  if (patch.title !== undefined) set('title', text(patch.title, 'title', 200));
  if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) throw new ReleaseError('status must be built, live or retired', 'invalid_status'); set('status', patch.status); set('provenance', 'recorded'); }
  if (patch.specRef !== undefined) set('spec_ref', patch.specRef ? text(patch.specRef, 'specRef', 500) : null);
  if (patch.testProof !== undefined) set('test_proof', patch.testProof ? text(patch.testProof, 'testProof', 500) : null);
  if (patch.enabledScope !== undefined) {
    if (!SCOPES.includes(patch.enabledScope)) throw new ReleaseError('enabledScope must be none, all, plans or workspaces', 'invalid_scope');
    const plans = patch.enabledScope === 'plans' ? (Array.isArray(patch.enabledPlans) ? patch.enabledPlans.map(String).filter(Boolean) : []) : [];
    if (patch.enabledScope === 'plans' && !plans.length) throw new ReleaseError('name at least one plan', 'plans_required');
    set('enabled_scope', patch.enabledScope); set('enabled_plans', plans);
  }
  if (sets.length) { p.push(row.id); await db.query(`UPDATE release_features SET ${sets.join(', ')}, updated_at = now() WHERE id = $${p.length}`, p); }
  if (patch.enabledScope === 'workspaces' || Array.isArray(patch.workspaceIds)) {
    const ids = (patch.workspaceIds || []).map(String).filter((x) => UUID.test(x));
    if (patch.enabledScope === 'workspaces' && !ids.length) throw new ReleaseError('name at least one workspace', 'workspaces_required');
    await db.query('DELETE FROM release_feature_workspaces WHERE feature_id = $1', [row.id]);
    for (const w of ids) await db.query('INSERT INTO release_feature_workspaces (feature_id, workspace_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, w]);
  }
  return getFeature(db, actor, row.id);
}

/** One change (PR, release, tag or commit). Idempotent on repo|kind|externalId; `featureSlug` attaches it. */
export async function recordChange(db, c) {
  const kind = ['pr', 'release', 'tag', 'commit'].includes(c.kind) ? c.kind : null;
  if (!kind) throw new ReleaseError('kind must be pr, release, tag or commit', 'invalid_kind');
  let featureId = null;
  if (c.featureSlug) featureId = (await db.query('SELECT id FROM release_features WHERE slug = $1', [c.featureSlug])).rows[0]?.id || null;
  const r = await db.query(
    `INSERT INTO release_changes (repo, kind, external_id, title, url, author, sha, at, labels, feature_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (repo, kind, external_id) DO UPDATE SET title = EXCLUDED.title, url = COALESCE(EXCLUDED.url, release_changes.url),
       sha = COALESCE(EXCLUDED.sha, release_changes.sha), at = COALESCE(EXCLUDED.at, release_changes.at), labels = EXCLUDED.labels,
       feature_id = COALESCE(release_changes.feature_id, EXCLUDED.feature_id)
     RETURNING (xmax = 0) AS inserted`,
    [text(c.repo, 'repo', 80), kind, text(c.externalId, 'externalId', 200), String(c.title || '').slice(0, 500), c.url || null,
      c.author || null, c.sha || null, c.at ? new Date(c.at) : null, (c.labels || []).map(String).slice(0, 30), featureId]);
  return { inserted: r.rows[0].inserted };
}

// ── notes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const noteShape = (r) => ({
  id: r.id, featureId: r.feature_id, title: r.title, body: r.body, state: r.state, draftedBy: r.drafted_by, draftedByKind: r.drafted_by_kind,
  approvedBy: r.approved_by, approvedAt: iso(r.approved_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

/** Draft a customer note: plain language, outcomes not internals. Staff or a staff agent; it stays a draft. */
export async function draftNote(db, actor, featureIdOrSlug, { title, body } = {}) {
  needRead(actor);
  const f = await featureRow(db, featureIdOrSlug);
  if (!f) throw notFound();
  const r = await db.query(
    `INSERT INTO release_notes (feature_id, title, body, drafted_by, drafted_by_kind) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [f.id, text(title, 'title', 160), text(body, 'body', 4000), actor.id, kindOf(actor) === 'agent' ? 'agent' : 'human']);
  return noteShape(r.rows[0]);
}

async function noteRow(db, id) {
  if (!UUID.test(String(id))) return null;
  return (await db.query('SELECT * FROM release_notes WHERE id = $1', [id])).rows[0] || null;
}

/** Approve (optionally with edited words). A human on staff only — held here and by a trigger. */
export async function approveNote(db, actor, id, { title, body } = {}) {
  needHumanStaff(actor);
  const n = await noteRow(db, id);
  if (!n) throw notFound();
  if (n.state === 'approved') return noteShape(n);
  const r = await db.query(
    `UPDATE release_notes SET state = 'approved', approved_by = $2, approved_at = now(), updated_at = now(),
       title = COALESCE($3, title), body = COALESCE($4, body) WHERE id = $1 RETURNING *`,
    [n.id, actor.id, title ? text(title, 'title', 160) : null, body ? text(body, 'body', 4000) : null]);
  return noteShape(r.rows[0]);
}

export async function withdrawNote(db, actor, id) {
  needHumanStaff(actor);
  const n = await noteRow(db, id);
  if (!n) throw notFound();
  const r = await db.query(`UPDATE release_notes SET state = 'withdrawn', updated_at = now() WHERE id = $1 RETURNING *`, [n.id]);
  return noteShape(r.rows[0]);
}

export async function listNotes(db, actor, { state } = {}) {
  needRead(actor);
  const p = [], where = [];
  if (state) { p.push(state); where.push(`n.state = $${p.length}`); }
  const r = await db.query(
    `SELECT n.*, f.slug, f.title AS feature_title, f.status AS feature_status FROM release_notes n JOIN release_features f ON f.id = n.feature_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.updated_at DESC LIMIT 200`, p);
  return r.rows.map((x) => ({ ...noteShape(x), feature: { slug: x.slug, title: x.feature_title, status: x.feature_status } }));
}

/** Staff overview counts for the console header. */
export async function summary(db, actor) {
  needRead(actor);
  const r = await db.query(`SELECT
    (SELECT count(*) FROM release_deploys) AS deploys, (SELECT max(started_at) FROM release_deploys WHERE status = 'ok' AND mode = 'swap') AS last_deploy,
    (SELECT count(*) FROM release_features) AS features, (SELECT count(*) FROM release_changes) AS changes,
    (SELECT count(*) FROM release_notes WHERE state = 'draft') AS drafts`);
  const x = r.rows[0];
  const repos = await db.query('SELECT repo, count(*)::int AS changes FROM release_changes GROUP BY repo ORDER BY repo');
  return { deploys: Number(x.deploys), lastDeploy: iso(x.last_deploy), features: Number(x.features), changes: Number(x.changes), drafts: Number(x.drafts), repos: repos.rows };
}

// ── the customer's "What's new" ───────────────────────────────────────────────────────────────────────────────────
/**
 * Approved notes for LIVE features enabled for this person. Selects ONLY the note's words and its date: no PR, repo,
 * slug, spec, test, author or feature id leaves this function, so no screen can leak them by accident.
 */
export async function whatsNew(db, user, { limit } = {}) {
  if (!user || !user.id) throw new ReleaseError('Sign in to see what is new', 'unauthenticated', 401);
  const plans = new Set();
  try { const e = await getEffectivePlan(db, user.id); if (e && e.plan) plans.add(e.plan); } catch { /* fails closed: no plan-scoped notes */ }
  try { for (const w of await workspacePlansFor(db, user.id)) plans.add(w.plan); } catch { /* fails closed */ }
  const r = await db.query(
    `SELECT n.id, n.title, n.body, n.approved_at FROM release_notes n JOIN release_features f ON f.id = n.feature_id
      WHERE n.state = 'approved' AND f.status = 'live' AND (
        f.enabled_scope = 'all'
        OR (f.enabled_scope = 'plans' AND f.enabled_plans && $2::text[])
        OR (f.enabled_scope = 'workspaces' AND EXISTS (
              SELECT 1 FROM release_feature_workspaces fw JOIN relationship_tuples t
                ON t.object_type = 'workspace' AND t.object_id = fw.workspace_id::text AND t.subject_type = 'user' AND t.subject_id = $1
               WHERE fw.feature_id = f.id)))
      ORDER BY n.approved_at DESC LIMIT $3`,
    [String(user.id), [...plans], limitOf(limit, 30, 100)]);
  return r.rows.map((x) => ({ id: x.id, title: x.title, body: x.body, date: iso(x.approved_at) }));
}
