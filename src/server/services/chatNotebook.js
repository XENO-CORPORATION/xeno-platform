/**
 * A Chat project's notebook (xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md, agreed with XENO - CORPUS).
 *
 * Corpus OWNS the logic and the platform runs Corpus's own code, vendored byte for byte
 * (src/server/vendor/xeno-corpus-notebook, gate scripts/corpus-notebook-vendor.mjs):
 *   ingest   the sections the platform's extractor produced → passages with anchors and hashes
 *   retrieve passages the platform has ALREADY authorised → what the model is given, and in which mode
 *   cite     an answer's [n] marks, checked against what the model was given
 * The platform owns extraction, storage, authorisation at read time and the manifest of what the model was given.
 *
 * Where passages live: a SECOND ingestion of the same file (extractor_id 'corpus-notebook', extractor_version =
 * PASSAGE_VERSION), one library_asset_chunks row per passage. Every other reader of the ingestions table skips those
 * rows (gate scripts/notebook-ingestion-kind.test.mjs).
 */
import { check } from '../utils/authzReBAC.js';
import { requireResourceRelation } from './chatProjectAuthority.js';
import { ingest, retrieve, cite, PASSAGE_VERSION, tokensOf, TRUST } from '../vendor/xeno-corpus-notebook/corpus-notebook.mjs';

export const NOTEBOOK_EXTRACTOR_ID = 'corpus-notebook';
export { PASSAGE_VERSION };
/** More passages than this in one project is refused rather than half-read (a notebook never answers from a silent subset). */
export const MAX_PROJECT_PASSAGES = 20_000;

/**
 * Write a file's passages from the sections its platform extraction produced, in the caller's transaction.
 * A source with no readable text gets a FAILED notebook ingestion with Corpus's reason (D22: "nothing could be read"
 * is never "no results"). Never throws for the content: a notebook failure must not fail the file's own ingestion.
 */
export async function writeNotebookPassages(tx, { assetId, contentSha256, mimeType, sections, extractor }) {
  let result;
  try {
    result = ingest({ sourceId: String(assetId), sections, extractor: { id: String(extractor.id), version: String(extractor.version) } });
  } catch (error) {
    result = { refusal: { code: 'NOTEBOOK_INGEST_ERROR', why: String(error?.message || error).slice(0, 300) } };
  }
  // one notebook ingestion per file: the newest replaces the rest (their chunks go with them)
  await tx.query(`DELETE FROM library_asset_ingestions WHERE asset_id = $1 AND extractor_id = '${NOTEBOOK_EXTRACTOR_ID}'`, [assetId]);
  const failed = Boolean(result.refusal);
  const row = (await tx.query(
    `INSERT INTO library_asset_ingestions(asset_id, content_sha256, mime_type, state, extractor_id, extractor_version,
       semantic_status, error_code, error_message, started_at, completed_at)
     VALUES ($1, $2, $3, $4, '${NOTEBOOK_EXTRACTOR_ID}', $5, 'disabled', $6, $7, NOW(), NOW())
     RETURNING id`,
    [assetId, contentSha256, mimeType, failed ? 'failed' : 'ready', PASSAGE_VERSION,
      failed ? 'no_passages' : null, failed ? `${result.refusal.code}: ${result.refusal.why}`.slice(0, 500) : null],
  )).rows[0];
  if (failed) return { ingestionId: row.id, passages: 0, refusal: result.refusal };
  for (const [ordinal, p] of result.passages.entries()) {
    await tx.query(
      `INSERT INTO library_asset_chunks(ingestion_id, asset_id, ordinal, content, token_count, source_locator)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [row.id, assetId, ordinal, p.text, tokensOf(p.text),
        JSON.stringify({ ...p.anchor, passageId: p.id, sha256: p.sha256, extractor: result.extractor })],
    );
  }
  return { ingestionId: row.id, passages: result.passages.length };
}

/** The state a notebook shows for a file, from its platform ingestion and its notebook ingestion. */
export function fileSourceState({ platform, notebook }) {
  if (!platform) return { state: 'queued', reason: null };
  if (platform.state === 'unsupported' || platform.state === 'failed') return { state: 'failed', reason: platform.error_code || platform.state };
  if (platform.state !== 'ready') return { state: 'queued', reason: null };
  if (!notebook) return { state: 'stale', reason: 'not_read_into_passages' };
  if (notebook.extractor_version !== PASSAGE_VERSION) return { state: 'stale', reason: 'older_passage_version' };
  if (notebook.content_sha256 !== platform.content_sha256) return { state: 'stale', reason: 'file_changed' };
  if (platform.completed_at && notebook.created_at && new Date(notebook.created_at) < new Date(platform.completed_at)) return { state: 'stale', reason: 'extraction_changed' };
  if (notebook.state === 'failed') return { state: 'failed', reason: notebook.error_message || 'no_passages' };
  return { state: 'indexed', reason: null };
}

/** The notebook's sources: the project's files and its corpus_sources, each with its state. Viewer of the project. */
export async function notebookSources(db, principal, projectId) {
  await requireResourceRelation(db, principal, 'project', projectId, 'viewer');
  const files = (await db.query(
    `SELECT f.id, COALESCE(f.original_name, f.filename) AS title, f.mime_type, pa.retrieval_enabled, pa.created_at,
            row_to_json(p) AS platform, row_to_json(n) AS notebook,
            (SELECT count(*)::int FROM library_asset_chunks c WHERE c.ingestion_id = n.id) AS passages
       FROM chat_project_assets pa
       JOIN user_files f ON f.id = pa.asset_id AND f.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT id, state, error_code, content_sha256, completed_at FROM library_asset_ingestions
          WHERE asset_id = f.id AND extractor_id IS DISTINCT FROM 'corpus-notebook' ORDER BY created_at DESC LIMIT 1) p ON TRUE
       LEFT JOIN LATERAL (SELECT id, state, error_message, content_sha256, extractor_version, created_at FROM library_asset_ingestions
          WHERE asset_id = f.id AND extractor_id = '${NOTEBOOK_EXTRACTOR_ID}' ORDER BY created_at DESC LIMIT 1) n ON TRUE
      WHERE pa.project_id = $1
      ORDER BY pa.created_at ASC`,
    [projectId],
  )).rows;
  const out = [];
  for (const f of files) {
    // a file the caller cannot open is not listed: the notebook never names what its reader may not see
    if (!(await check(db, { object: `library_asset:${f.id}`, relation: 'viewer', subject: `${principal.type}:${principal.id}` })).allowed) continue;
    const s = fileSourceState({ platform: f.platform, notebook: f.notebook });
    out.push({ id: String(f.id), kind: 'file', title: f.title, mimeType: f.mime_type, selected: Boolean(f.retrieval_enabled),
      state: s.state, reason: s.reason, passages: s.state === 'indexed' ? f.passages : 0, addedAt: f.created_at });
  }
  const others = (await db.query(
    `SELECT s.id, s.kind, s.title, s.url, s.selected, s.state, s.state_reason, s.created_at
       FROM corpus_sources s JOIN corpus_corpora c ON c.id = s.corpus_id
      WHERE c.scope_kind = 'project' AND c.project_id = $1 ORDER BY s.created_at ASC`,
    [projectId],
  )).rows;
  for (const s of others) out.push({ id: String(s.id), kind: s.kind, title: s.title, url: s.url || null, selected: s.selected,
    state: s.state, reason: s.state_reason, passages: 0, addedAt: s.created_at });
  return out;
}

/** Turn a file on or off for answers (chat_project_assets.retrieval_enabled). Editor of the project. */
export async function selectFileSource(db, principal, projectId, assetId, selected) {
  await requireResourceRelation(db, principal, 'project', projectId, 'editor');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(assetId))) throw Object.assign(new Error('Not a source of this notebook'), { code: 'notebook_source_not_found', status: 404 });
  const r = await db.query('UPDATE chat_project_assets SET retrieval_enabled = $3 WHERE project_id = $1 AND asset_id = $2', [projectId, assetId, Boolean(selected)]);
  if (!r.rowCount) throw Object.assign(new Error('Not a source of this notebook'), { code: 'notebook_source_not_found', status: 404 });
  return { id: String(assetId), selected: Boolean(selected) };
}

/** Every passage of the project's SELECTED, indexed files that the caller may read, in source order. */
export async function authorisedPassages(db, principal, projectId) {
  await requireResourceRelation(db, principal, 'project', projectId, 'viewer');
  const rows = (await db.query(
    `SELECT c.id AS chunk_id, c.asset_id, c.ordinal, c.content, c.source_locator,
            COALESCE(f.original_name, f.filename, 'Project source') AS display_name, f.mime_type
       FROM chat_project_assets pa
       JOIN relationship_tuples parent
         ON parent.object_type='library_asset' AND parent.object_id=pa.asset_id::text
        AND parent.relation='parent' AND parent.subject_type='project' AND parent.subject_id=pa.project_id::text
       JOIN user_files f ON f.id = pa.asset_id AND f.deleted_at IS NULL
       JOIN LATERAL (SELECT id, content_sha256, completed_at FROM library_asset_ingestions
          WHERE asset_id = pa.asset_id AND state = 'ready' AND extractor_id IS DISTINCT FROM 'corpus-notebook'
          ORDER BY created_at DESC LIMIT 1) p ON TRUE
       JOIN library_asset_ingestions n ON n.asset_id = pa.asset_id AND n.extractor_id = '${NOTEBOOK_EXTRACTOR_ID}'
        AND n.state = 'ready' AND n.extractor_version = $2 AND n.content_sha256 = p.content_sha256
        AND n.created_at >= COALESCE(p.completed_at, n.created_at)
       JOIN library_asset_chunks c ON c.ingestion_id = n.id
      WHERE pa.project_id = $1 AND pa.retrieval_enabled = TRUE
      ORDER BY pa.created_at ASC, pa.asset_id, c.ordinal
      LIMIT $3`,
    [projectId, PASSAGE_VERSION, MAX_PROJECT_PASSAGES + 1],
  )).rows;
  if (rows.length > MAX_PROJECT_PASSAGES) throw Object.assign(new Error('This notebook has more passages than one answer can rank'), { code: 'notebook_too_large', status: 413 });
  const allowed = new Map();
  const out = [];
  for (const r of rows) {
    const key = String(r.asset_id);
    if (!allowed.has(key)) allowed.set(key, (await check(db, { object: `library_asset:${key}`, relation: 'viewer', subject: `${principal.type}:${principal.id}` })).allowed);
    if (!allowed.get(key)) continue;
    const loc = r.source_locator || {};
    out.push({ id: String(loc.passageId || r.chunk_id), sourceId: key, text: r.content, anchor: anchorOf(loc),
      chunkId: String(r.chunk_id), displayName: r.display_name, mimeType: r.mime_type });
  }
  return out;
}

const anchorOf = (loc) => {
  const a = { section: loc.section ?? 0, offset: loc.offset ?? 0 };
  if (loc.page != null) a.page = loc.page;
  if (loc.heading) a.heading = loc.heading;
  return a;
};

/** Does any selected file of this project have notebook passages? (Then answers are grounded through the notebook.) */
export async function notebookActive(db, projectId) {
  return Boolean((await db.query(
    `SELECT 1 FROM chat_project_assets pa
       JOIN library_asset_ingestions n ON n.asset_id = pa.asset_id AND n.extractor_id = '${NOTEBOOK_EXTRACTOR_ID}' AND n.state = 'ready'
      WHERE pa.project_id = $1 AND pa.retrieval_enabled = TRUE LIMIT 1`,
    [projectId],
  )).rows[0]);
}

/**
 * What the model is given for one question: Corpus's retrieve() over the passages the caller may read. Returns the
 * content blocks (numbered from 1, in the order the model sees them) and the manifest entry that cite() checks against.
 */
export async function notebookContext(db, { principal, projectId, question, budget }) {
  const passages = await authorisedPassages(db, principal, projectId);
  if (!passages.length) return null;
  const byId = new Map(passages.map((p) => [p.id, p]));
  const r = retrieve({ question: String(question || '').trim() || 'overview', passages, budget: Math.max(1, Math.floor(budget)) });
  const given = r.passages.map((p, i) => {
    const full = byId.get(p.passageId);
    return { n: i + 1, passageId: p.passageId, sourceId: p.sourceId, anchor: p.anchor, chunkId: full?.chunkId || null,
      displayName: full?.displayName || 'Project source', mimeType: full?.mimeType || 'application/octet-stream', text: p.text, score: p.score, tokens: tokensOf(p.text) };
  });
  return {
    mode: r.mode,
    considered: r.considered,
    tokens: r.tokens,
    given,
    blocks: given.map((g) => ({
      type: 'untrusted_project_source',
      asset_id: g.sourceId,
      chunk_id: g.chunkId,
      passage_id: g.passageId,
      locator: g.anchor,
      content: JSON.stringify({ source_number: g.n, cite_as: `[${g.n}]`, source: g.displayName, anchor: g.anchor, trust: TRUST, content: g.text }),
    })),
    manifest: {
      passage_version: PASSAGE_VERSION,
      mode: r.mode,
      considered: r.considered,
      tokens: r.tokens,
      given: given.map((g) => ({ n: g.n, passage_id: g.passageId, asset_id: g.sourceId, chunk_id: g.chunkId, anchor: g.anchor, display_name: g.displayName })),
    },
    instruction: 'Answer from the numbered project sources. After each sentence that uses one, cite it as [n] with its source_number. Cite only numbers you were given; if the sources do not answer the question, say so.',
  };
}

/** An answer's citations, checked by Corpus's cite() against exactly what its manifest says the model was given. */
export function citationsFor(answerText, contextManifest) {
  const given = contextManifest?.notebook?.given;
  if (!Array.isArray(given) || !given.length || typeof answerText !== 'string') return null;
  const c = cite(answerText, given.map((g) => ({ passageId: g.passage_id, sourceId: g.asset_id, anchor: g.anchor })));
  const byN = new Map(given.map((g) => [g.n, g]));
  return {
    ok: c.ok,
    mode: contextManifest.notebook.mode,
    citations: c.citations.map((x) => ({ n: x.n, passageId: x.passageId, assetId: x.sourceId, anchor: x.anchor, source: byN.get(x.n)?.display_name || null })),
    refused: c.refused.map((x) => ({ mark: x.mark, why: x.why })),
  };
}
