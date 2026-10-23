/**
 * XENO Index governance core. CANONICAL SOURCE: xeno-index/packages/index/src/governance/ — a host vendors it
 * byte-identical (decision 0001); never edit a host copy.
 *
 * The INTERNAL release note — one per deploy, STAFF ONLY (owner, 2026-10-21). The one service the staff console,
 * /api/releases, the agent tools (releasesMcp.js), the deploy recorder (scripts/record-deploy.mjs) and the history
 * backfill (scripts/draft-internal-notes.mjs) call.
 *
 *   draft      written automatically at every deploy from the PRs it shipped — a deterministic template
 *              (releaseInternalNoteTemplate.js), no model call. The deploy redrafts its own note until someone edits it.
 *   edit       staff or a staff agent. Every version is kept (release_internal_note_revisions); editing a signed note
 *              puts it back to draft, because the signature covered words that no longer exist.
 *   sign off   a HUMAN on staff only — held here and by a database trigger.
 *
 * Leak rule: every read and write refuses anyone not on staff with "not found". Nothing here is ever joined into the
 * customer path (releaseRecord.whatsNew).
 */
import { ReleaseError, isStaff, isStaffAgent } from './releaseRecord.js';
import { buildInternalNote, downPathOf, SECTION_KEYS, SECTION_MAX } from './releaseInternalNoteTemplate.js';

export { SECTIONS } from './releaseInternalNoteTemplate.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d) => (d ? new Date(d).toISOString() : null);
// jsonb reorders keys, so compare section by section, not by JSON.stringify
const same = (x, y) => SECTION_KEYS.every((k) => String((x || {})[k] ?? '') === String((y || {})[k] ?? ''));
const notFound = () => new ReleaseError('Not found', 'not_found', 404);
const kindOf = (u) => (u && u.kind === 'agent' ? 'agent' : 'human');
const needRead = (u) => { if (!(isStaff(u) || isStaffAgent(u))) throw notFound(); };
const needHumanStaff = (u) => {
  needRead(u);
  if (!isStaff(u)) throw new ReleaseError('Only a person on XENO staff may sign off an internal release note', 'human_staff_only', 403);
};

const shape = (r, revisions) => ({
  id: r.id, deployId: r.deploy_id, content: r.content, provenance: r.provenance, state: r.state, version: r.version, edited: r.edited,
  signedBy: r.signed_by, signedByName: r.signed_by_name || null, signedAt: iso(r.signed_at), signedVersion: r.signed_version,
  sources: r.sources, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  ...(revisions ? { revisions } : {}),
});

/** Keep only what the template needs from the collected facts, bounded, so a huge PR body cannot bloat a row. */
function normalizeSources(s = {}) {
  const prs = (Array.isArray(s.prs) ? s.prs : []).filter((p) => p && Number.isInteger(Number(p.number))).slice(0, 300).map((p) => ({
    number: Number(p.number), title: String(p.title || '').slice(0, 300), body: String(p.body || '').slice(0, 20000),
    url: p.url ? String(p.url).slice(0, 300) : null, files: (Array.isArray(p.files) ? p.files : []).map(String).slice(0, 400),
  }));
  const migrations = (Array.isArray(s.migrations) ? s.migrations : []).slice(0, 200).map((m) => ({
    name: String(m.name || ''), down: m.down && typeof m.down === 'object' ? m.down : downPathOf(String(m.name || ''), m.text ?? null),
  })).filter((m) => m.name);
  const env = s.env && typeof s.env === 'object' ? { added: (s.env.added || []).map(String).slice(0, 100), removed: (s.env.removed || []).map(String).slice(0, 100) } : null;
  return { prs, migrations, env, collectedBy: s.collectedBy ? String(s.collectedBy).slice(0, 40) : null };
}

async function featuresFor(db, deploy) {
  if (!deploy.prs || !deploy.prs.length) return [];
  const r = await db.query(
    `SELECT DISTINCT f.slug, f.title, f.status FROM release_changes c JOIN release_features f ON f.id = c.feature_id
      WHERE c.repo = $1 AND c.kind = 'pr' AND c.external_id = ANY($2::text[]) ORDER BY f.slug`, [deploy.repo || 'xeno-platform', deploy.prs.map(String)]);
  return r.rows;
}

/**
 * Draft (or redraft) a deploy's internal note from the facts the deploy collected. System call — no actor. Idempotent:
 * a note nobody has edited is redrafted from the new facts; an edited or signed note is never touched.
 */
export async function draftForDeploy(db, deployId, sources, { provenance = 'drafted_at_deploy' } = {}) {
  if (!UUID.test(String(deployId))) throw notFound();
  const prov = provenance === 'drafted_from_history' ? 'drafted_from_history' : 'drafted_at_deploy';
  const dr = await db.query('SELECT * FROM release_deploys WHERE id = $1', [deployId]);
  const d = dr.rows[0]; if (!d) throw notFound();
  const deploy = { repo: d.repo, service: d.service, sha: d.sha, previousSha: d.previous_sha, mode: d.mode, status: d.status, prs: d.prs || [], migrations: d.migrations || [], rollbackPoint: d.rollback_point, healthcheck: d.healthcheck };
  const src = normalizeSources(sources);
  const content = buildInternalNote({ deploy, sources: src, features: await featuresFor(db, deploy) });
  const existing = (await db.query('SELECT * FROM release_internal_notes WHERE deploy_id = $1', [deployId])).rows[0];
  if (existing && (existing.edited || existing.state === 'signed')) return { note: shape(existing), action: 'kept' };
  if (existing) {
    if (same(existing.content, content)) return { note: shape(existing), action: 'unchanged' };
    const r = await db.query(`UPDATE release_internal_notes SET content = $2, sources = $3, updated_at = now() WHERE id = $1 RETURNING *`, [existing.id, content, src]);
    await db.query(`UPDATE release_internal_note_revisions SET content = $2 WHERE note_id = $1 AND version = 1 AND edited_by_kind = 'system'`, [existing.id, content]);
    return { note: shape(r.rows[0]), action: 'redrafted' };
  }
  const r = await db.query(
    `INSERT INTO release_internal_notes (deploy_id, content, sources, provenance) VALUES ($1,$2,$3,$4)
     ON CONFLICT (deploy_id) DO NOTHING RETURNING *`, [deployId, content, src, prov]);
  if (!r.rows[0]) return { note: shape((await db.query('SELECT * FROM release_internal_notes WHERE deploy_id = $1', [deployId])).rows[0]), action: 'kept' };
  await db.query(`INSERT INTO release_internal_note_revisions (note_id, version, content, edited_by_kind) VALUES ($1, 1, $2, 'system')`, [r.rows[0].id, content]);
  return { note: shape(r.rows[0]), action: 'drafted' };
}

async function noteRow(db, deployId) {
  if (!UUID.test(String(deployId))) return null;
  return (await db.query(
    `SELECT n.*, u.display_name AS signed_by_name FROM release_internal_notes n LEFT JOIN users u ON u.id = n.signed_by WHERE n.deploy_id = $1`, [deployId])).rows[0] || null;
}

/** A deploy's internal note with every revision. Staff or a staff agent. */
export async function getInternalNote(db, actor, deployId) {
  needRead(actor);
  const n = await noteRow(db, deployId);
  if (!n) throw notFound();
  const revs = await db.query(
    `SELECT r.version, r.content, r.edited_by, r.edited_by_kind, r.created_at, u.display_name FROM release_internal_note_revisions r
       LEFT JOIN users u ON u.id = r.edited_by WHERE r.note_id = $1 ORDER BY r.version DESC`, [n.id]);
  return shape(n, revs.rows.map((x) => ({ version: x.version, content: x.content, editedBy: x.edited_by, editedByName: x.display_name || null, editedByKind: x.edited_by_kind, at: iso(x.created_at) })));
}

/** Edit the words. Staff or a staff agent. `expectedVersion` refuses an edit made over someone else's newer one. */
export async function editInternalNote(db, actor, deployId, { content, expectedVersion } = {}) {
  needRead(actor);
  const n = await noteRow(db, deployId);
  if (!n) throw notFound();
  if (!content || typeof content !== 'object') throw new ReleaseError('content is required', 'content_required');
  if (expectedVersion != null && Number(expectedVersion) !== n.version) throw new ReleaseError('Someone changed this note since you opened it — reload to see their version', 'version_conflict', 409);
  const next = { ...n.content };
  for (const k of Object.keys(content)) {
    if (!SECTION_KEYS.includes(k)) throw new ReleaseError(`unknown section ${k}`, 'invalid_section');
    const v = String(content[k] ?? '');
    if (v.length > SECTION_MAX) throw new ReleaseError(`${k} is longer than ${SECTION_MAX} characters`, 'section_too_long');
    next[k] = v;
  }
  if (same(next, n.content)) return getInternalNote(db, actor, deployId);
  const r = await db.query(
    `UPDATE release_internal_notes SET content = $2, version = version + 1, edited = TRUE, state = 'draft', signed_by = NULL, signed_at = NULL, signed_version = NULL, updated_at = now()
      WHERE id = $1 AND version = $3 RETURNING version`, [n.id, next, n.version]);
  if (!r.rows[0]) throw new ReleaseError('Someone changed this note since you opened it — reload to see their version', 'version_conflict', 409);
  await db.query(`INSERT INTO release_internal_note_revisions (note_id, version, content, edited_by, edited_by_kind) VALUES ($1,$2,$3,$4,$5)`,
    [n.id, r.rows[0].version, next, actor.id, kindOf(actor)]);
  return getInternalNote(db, actor, deployId);
}

/** Sign off the current version. A human on staff only — held here and by the database. */
export async function signInternalNote(db, actor, deployId, { expectedVersion } = {}) {
  needHumanStaff(actor);
  const n = await noteRow(db, deployId);
  if (!n) throw notFound();
  if (expectedVersion != null && Number(expectedVersion) !== n.version) throw new ReleaseError('The note changed since you read it — read it again before signing', 'version_conflict', 409);
  if (n.state !== 'signed') {
    await db.query(`UPDATE release_internal_notes SET state = 'signed', signed_by = $2, signed_at = now(), signed_version = version, updated_at = now() WHERE id = $1`, [n.id, actor.id]);
  }
  return getInternalNote(db, actor, deployId);
}

/** {deployId: {state, version, provenance}} for the deploy list. Staff only. */
export async function noteStates(db, actor, deployIds) {
  needRead(actor);
  const ids = (deployIds || []).filter((x) => UUID.test(String(x)));
  if (!ids.length) return {};
  const r = await db.query('SELECT deploy_id, state, version, provenance FROM release_internal_notes WHERE deploy_id = ANY($1::uuid[])', [ids]);
  return Object.fromEntries(r.rows.map((x) => [x.deploy_id, { state: x.state, version: x.version, provenance: x.provenance }]));
}

/** Deploys that have no internal note yet (the backfill). System call. */
export async function deploysWithoutNote(db) {
  const r = await db.query(
    `SELECT d.* FROM release_deploys d WHERE NOT EXISTS (SELECT 1 FROM release_internal_notes n WHERE n.deploy_id = d.id) ORDER BY d.started_at NULLS FIRST`);
  return r.rows.map((d) => ({ id: d.id, repo: d.repo, service: d.service, sha: d.sha, previousSha: d.previous_sha, mode: d.mode, status: d.status, prs: d.prs || [], migrations: d.migrations || [], provenance: d.provenance, startedAt: iso(d.started_at) }));
}
