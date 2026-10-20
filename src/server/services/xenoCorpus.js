/**
 * XENO Corpus on the platform -- the one service every surface calls (REST, XENO MCP corpus.*, the Corpus tab,
 * the Canvas verdict card). XENO CORPUS - SPEC.md; BUILD DECISIONS BD-10; D186 freshness; D211; D227/D228.
 *
 *   - A corpus is a SCOPE's body of verified truth: workspace, division or project. The workspace owns it
 *     (§8.11): access is the scope's own ReBAC relation, never a second store. Tenet and assay shape is
 *     corpus-v0's (orchestrator/corpus-v0/tenets/*.json): id/key, subject, claim, definition, assay {kind, run},
 *     expect, cadence/warnAfter/expireAfter, source, provenance.
 *   - Nesting is DERIVED from the live structure (database function corpus_ancestors). Doctrine inherits DOWN
 *     (a project reads its division's and workspace's doctrine as binding); facts aggregate UP by REFERENCE
 *     (an ancestor lists its descendants' tenets with their latest state, never a copy); and an ancestor may
 *     never assert about a descendant's subject -- refused by trigger, answered here with a named code.
 *   - Agents PROPOSE; people RATIFY. Nothing an agent sends becomes a tenet without a person's decision, and
 *     the database refuses both an agent-written tenet and an agent ratification.
 *   - A verdict is taken under a RUN ADMISSION of the person accountable for it (the assay run is an admitted
 *     run), is hash-chained per tenet, and is signed ES256 with the platform's OIDC key (/api/oauth2/jwks).
 *   - A project's `.xeno/corpus/` arrives through its DIRECTORY BINDING (ASN-07): the bound installation reads
 *     the files and sends them; the platform keeps them as a read mirror (origin 'imported'), re-synced from
 *     the directory, never edited here.
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { resolvePrincipal } from './agentIdentity.js';
import { withTransaction } from './chatProjectAuthority.js';
import { hostOf } from './projectDirectoryBindings.js';
import { registerSourceProvider } from './workspaceArchitect.js';

export class CorpusError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'CorpusError'; this.code = code; this.status = status; }
}
const fail = (message, code, status = 400) => { throw new CorpusError(message, code, status); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['workspace', 'division', 'project']);
const KEY = /^[A-Za-z0-9][A-Za-z0-9._#:/-]{0,199}$/;
const HOURS = /^[0-9]{1,5}h$/;
const notFound = () => new CorpusError('Corpus not found', 'corpus_not_found', 404);

/** Database refusals by trigger, mapped to an answer a caller can act on. */
const TRIGGER_CODES = {
  corpus_ancestor_asserts_descendant_subject: ['A wider scope may not assert about a narrower scope’s subject: propose it in that scope’s corpus.', 409],
  corpus_subject_owned_by_ancestor: ['A wider scope already asserts about this subject.', 409],
  corpus_subject_outside_scope: ['A tenet may only name its own scope as a scope subject.', 400],
  corpus_agent_cannot_write_tenet: ['An agent proposes; a person ratifies.', 403],
  corpus_ratification_requires_a_person: ['Only a person can ratify a proposal.', 403],
  corpus_verdict_admission_not_yours: ['That run admission is not yours.', 403],
  corpus_verdict_admission_revoked: ['That run admission was revoked.', 409],
  corpus_verdict_admission_other_workspace: ['That run admission is for another workspace.', 403],
  corpus_verdict_chain_broken: ['Another verdict was recorded at the same time; read and retry.', 409],
};
function mapDbError(e) {
  const msg = String(e?.message || '');
  for (const [code, [text, status]] of Object.entries(TRIGGER_CODES)) if (msg.includes(code)) return new CorpusError(text, code, status);
  if (e?.code === '23505' && /corpus_tenets_live_key/.test(msg + (e.constraint || ''))) return new CorpusError('A live tenet with that key already exists here', 'tenet_key_taken', 409);
  return e;
}
const guarded = async (fn) => { try { return await fn(); } catch (e) { throw mapDbError(e); } };

// ───────────────────────────── who is asking, and what they may do in a scope

async function principalOf(db, actor) {
  const p = await resolvePrincipal(db, actor.id);
  if (!p?.usable) fail('Not allowed', 'actor_unavailable', 403);
  const isAgent = p.kind === 'agent';
  const accountable = isAgent ? (p.ownerUserId || p.owner?.id || p.owner_user_id) : actor.id;
  if (!accountable) fail('Not allowed', 'actor_unavailable', 403);
  return { id: String(actor.id), kind: isAgent ? 'agent' : (p.kind === 'human' ? 'human' : p.kind), accountable: String(accountable) };
}
const allowed = async (db, userId, object, relation) => (await check(db, { object, relation, subject: `user:${userId}` })).allowed;

/** Resolve a scope to its workspace, and check the reader. Anything not visible reads as absent. */
async function scopeFor(db, who, kind, id) {
  if (!KINDS.has(kind) || !UUID.test(String(id || ''))) throw notFound();
  const sid = String(id).toLowerCase();
  let workspaceId;
  if (kind === 'workspace') {
    if (!(await allowed(db, who.accountable, `workspace:${sid}`, 'viewer'))) throw notFound();
    workspaceId = sid;
  } else if (kind === 'division') {
    const d = (await db.query('SELECT workspace_id FROM workforce_divisions WHERE id=$1', [sid])).rows[0];
    if (!d || !(await allowed(db, who.accountable, `workspace:${d.workspace_id}`, 'viewer'))) throw notFound();
    workspaceId = String(d.workspace_id);
  } else {
    // a project with no workspace is in its owner's personal one (the rule workforce_project_divisions uses)
    const p = (await db.query(`SELECT COALESCE(p.workspace_id, (SELECT w.id FROM workspaces w WHERE w.owner_user_id = p.owner_user_id
      AND w.workspace_type = 'personal' ORDER BY w.created_at LIMIT 1)) AS workspace_id FROM chat_projects p WHERE p.id=$1`, [sid])).rows[0];
    if (!p || !p.workspace_id || !(await allowed(db, who.accountable, `project:${sid}`, 'viewer'))) throw notFound();
    workspaceId = String(p.workspace_id);
  }
  return { kind, id: sid, workspaceId, subject: `${kind}:${sid}` };
}

/** Manage = author tenets and decide proposals: a PERSON who administers the workspace (or edits the project). */
async function mayManage(db, who, scope) {
  if (who.kind !== 'human') return false;
  if (await allowed(db, who.id, `workspace:${scope.workspaceId}`, 'admin')) return true;
  return scope.kind === 'project' && allowed(db, who.id, `project:${scope.id}`, 'editor');
}

async function ensureCorpus(db, scope, userId) {
  await db.query(`INSERT INTO corpus_corpora (workspace_id, scope_kind, division_id, project_id, subject, created_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (subject) DO NOTHING`,
  [scope.workspaceId, scope.kind, scope.kind === 'division' ? scope.id : null, scope.kind === 'project' ? scope.id : null, scope.subject, userId]);
  return (await db.query('SELECT * FROM corpus_corpora WHERE subject=$1', [scope.subject])).rows[0];
}
/** The scope a corpus row belongs to, re-checked for this reader. */
async function scopeOfCorpus(db, who, corpusRow) {
  const kind = corpusRow.scope_kind;
  const id = kind === 'workspace' ? corpusRow.workspace_id : kind === 'division' ? corpusRow.division_id : corpusRow.project_id;
  return scopeFor(db, who, kind, String(id));
}

// ───────────────────────────── tenet shape (corpus-v0's), content hash, freshness (D186)

const canon = (v) => (v === null || typeof v !== 'object') ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const text = (v, max) => { const s = v == null ? '' : String(v).trim(); return s.length > max ? null : s; };

/** Parse a tenet as written in a corpus file or sent by a client. Never executes anything it reads (D211). */
export function parseTenet(input, scope) {
  const t = input || {};
  const key = String(t.key || t.id || '').trim();
  if (!KEY.test(key)) fail('A tenet needs a key: letters, digits and ._#:/- (at most 200)', 'invalid_tenet_key');
  const kind = t.kind === 'doctrine' ? 'doctrine' : 'tenet';
  const claim = text(t.claim, 4000);
  if (!claim) fail('A tenet needs a claim of at most 4000 characters', 'invalid_tenet_claim');
  const subject = text(t.subject || scope.subject, 200);
  if (!subject) fail('A tenet subject is at most 200 characters', 'invalid_tenet_subject');
  let assay = null, expect = null;
  if (kind === 'tenet') {
    const a = t.assay || {};
    if (!['shell', 'node', 'http', 'manual'].includes(a.kind) || typeof a.run !== 'string' || !a.run.trim() || a.run.length > 2000) {
      fail('A tenet needs the procedure that disproves it: assay {kind: shell|node|http|manual, run}', 'invalid_tenet_assay');
    }
    assay = { kind: a.kind, run: a.run.trim() };
    if (t.expect == null || String(t.expect).length > 1000) fail('A tenet needs the value its assay must return (expect)', 'invalid_tenet_expect');
    expect = String(t.expect);
  }
  for (const f of ['cadence', 'warnAfter', 'expireAfter']) if (t[f] != null && !HOURS.test(String(t[f]))) fail(`${f} is a number of hours, e.g. "24h"`, 'invalid_tenet_cadence');
  const definition = t.definition && typeof t.definition === 'object' && !Array.isArray(t.definition) ? t.definition : {};
  const provenance = t.provenance && typeof t.provenance === 'object' && !Array.isArray(t.provenance) ? t.provenance : {};
  if (JSON.stringify(definition).length > 20000 || JSON.stringify(provenance).length > 4000) fail('The tenet definition is too large', 'invalid_tenet_definition');
  const shaped = { key, kind, subject, claim, definition, assay, expect, cadence: t.cadence || null, warnAfter: t.warnAfter || null,
    expireAfter: t.expireAfter || null, source: text(t.source, 1000) || null, provenance };
  return { ...shaped, contentHash: sha(canon({ ...shaped, provenance: undefined })) };
}

const hoursOf = (h) => (h ? Number(String(h).slice(0, -1)) : null);
/** D186: a verdict ages. fresh -> due (cadence passed) -> warn -> expired; a tenet never assayed is 'never'. */
export function freshnessOf(tenet, latest, now = Date.now()) {
  if (tenet.kind === 'doctrine') return 'doctrine';
  if (!latest) return 'never';
  const age = (now - new Date(latest.at).getTime()) / 3_600_000;
  if (hoursOf(tenet.expire_after) != null && age > hoursOf(tenet.expire_after)) return 'expired';
  if (hoursOf(tenet.warn_after) != null && age > hoursOf(tenet.warn_after)) return 'warn';
  if (hoursOf(tenet.cadence) != null && age > hoursOf(tenet.cadence)) return 'due';
  return 'fresh';
}

const shapeVerdict = (v) => v && ({ id: String(v.id), state: v.state, observed: v.observed, instrument: v.instrument, at: v.at,
  admissionId: String(v.admission_id), hash: v.hash, prevHash: v.prev_hash, kid: v.signing_kid, signature: v.signature,
  stale: undefined });
function shapeTenet(t, latest, extra = {}) {
  const v = shapeVerdict(latest);
  if (v && t.content_hash !== latest.tenet_content_hash) v.stale = true;
  return {
    id: String(t.id), key: t.tenet_key, kind: t.kind, subject: t.subject, claim: t.claim, definition: t.definition,
    assay: t.assay, expect: t.expect, cadence: t.cadence, warnAfter: t.warn_after, expireAfter: t.expire_after,
    source: t.source, provenance: t.provenance, origin: t.origin, contentHash: t.content_hash, createdAt: t.created_at,
    supersededAt: t.superseded_at, latest: v, freshness: freshnessOf(t, latest), ...extra,
  };
}
async function latestVerdicts(db, tenetIds) {
  if (!tenetIds.length) return new Map();
  const rows = (await db.query(`SELECT DISTINCT ON (tenet_id) * FROM corpus_verdicts WHERE tenet_id = ANY($1::uuid[]) ORDER BY tenet_id, at DESC, id DESC`, [tenetIds])).rows;
  return new Map(rows.map((r) => [String(r.tenet_id), r]));
}
const shapeProposal = (p) => ({ id: String(p.id), action: p.action, targetTenetId: p.target_tenet_id ? String(p.target_tenet_id) : null,
  tenet: p.tenet, rationale: p.rationale, proposedBy: String(p.proposed_by_user_id), proposerKind: p.proposer_kind || null,
  state: p.state, decidedBy: p.decided_by_user_id ? String(p.decided_by_user_id) : null, decidedAt: p.decided_at, note: p.decision_note, createdAt: p.created_at });

// ───────────────────────────── read: the corpus of one scope

/**
 * The corpus of a scope as `actor` sees it: its own live tenets with the latest verdict and freshness, the
 * doctrine it inherits from its ancestors (binding here), its descendants' tenets BY REFERENCE (only those the
 * reader can open), and the proposals waiting for a person.
 */
export async function readCorpus(db, actor, { kind, id }) {
  const who = await principalOf(db, actor);
  const scope = await scopeFor(db, who, kind, id);
  const corpus = await ensureCorpus(db, scope, who.accountable);
  const own = (await db.query(`SELECT * FROM corpus_tenets WHERE corpus_id=$1 AND superseded_at IS NULL ORDER BY kind DESC, tenet_key`, [corpus.id])).rows;
  const ancestors = (await db.query(`SELECT c.id, c.subject, c.scope_kind, ord FROM unnest(corpus_ancestors($1)) WITH ORDINALITY AS a(cid, ord)
    JOIN corpus_corpora c ON c.id = a.cid ORDER BY ord`, [corpus.id])).rows;
  const doctrine = ancestors.length ? (await db.query(`SELECT t.*, c.subject AS corpus_subject FROM corpus_tenets t JOIN corpus_corpora c ON c.id = t.corpus_id
    WHERE t.corpus_id = ANY($1::uuid[]) AND t.kind='doctrine' AND t.superseded_at IS NULL ORDER BY t.tenet_key`, [ancestors.map((a) => a.id)])).rows : [];
  // descendants: every corpus in the workspace that names this one among its ancestors, filtered per reader
  const desc = (await db.query(`SELECT c.* FROM corpus_corpora c WHERE c.workspace_id=$1 AND c.id <> $2 AND $2 = ANY(corpus_ancestors(c.id))`, [scope.workspaceId, corpus.id])).rows;
  const visible = [];
  for (const d of desc) { try { await scopeOfCorpus(db, who, d); visible.push(d); } catch { /* closed: not listed */ } }
  const facts = visible.length ? (await db.query(`SELECT t.id, t.tenet_key, t.subject, t.claim, t.kind, t.cadence, t.warn_after, t.expire_after, t.content_hash, c.subject AS corpus_subject
    FROM corpus_tenets t JOIN corpus_corpora c ON c.id = t.corpus_id WHERE t.corpus_id = ANY($1::uuid[]) AND t.kind='tenet' AND t.superseded_at IS NULL ORDER BY c.subject, t.tenet_key`,
  [visible.map((d) => d.id)])).rows : [];
  const latest = await latestVerdicts(db, [...own, ...facts].map((t) => String(t.id)));
  const proposals = (await db.query(`SELECT p.*, CASE WHEN ai.user_id IS NULL THEN 'human' ELSE 'agent' END AS proposer_kind FROM corpus_proposals p
    LEFT JOIN agent_identities ai ON ai.user_id = p.proposed_by_user_id WHERE p.corpus_id=$1 ORDER BY (p.state='proposed') DESC, p.created_at DESC LIMIT 100`, [corpus.id])).rows;
  return {
    corpus: { id: String(corpus.id), scope: scope.kind, scopeId: scope.id, subject: scope.subject, workspaceId: scope.workspaceId },
    canManage: await mayManage(db, who, scope),
    tenets: own.map((t) => shapeTenet(t, latest.get(String(t.id)))),
    inheritedDoctrine: doctrine.map((t) => shapeTenet(t, null, { from: t.corpus_subject })),
    // by REFERENCE: id, key, where it lives and its latest state -- never a copy of the claim's content
    aggregated: facts.map((t) => { const l = latest.get(String(t.id)); return { id: String(t.id), key: t.tenet_key, subject: t.subject, from: t.corpus_subject,
      state: l ? l.state : null, at: l ? l.at : null, freshness: freshnessOf(t, l) }; }),
    proposals: proposals.map(shapeProposal),
  };
}

/** corpus.query: search the tenets a reader can see in a scope (own, inherited doctrine, aggregated references). */
export async function queryCorpus(db, actor, { kind, id, q = '' } = {}) {
  const c = await readCorpus(db, actor, { kind, id });
  const needle = String(q || '').trim().toLowerCase().slice(0, 200);
  const hit = (t) => !needle || [t.key, t.subject, t.claim].some((s) => String(s || '').toLowerCase().includes(needle));
  return { corpus: c.corpus, tenets: c.tenets.filter(hit), inheritedDoctrine: c.inheritedDoctrine.filter(hit), aggregated: c.aggregated.filter(hit) };
}

/** corpus.assess: which tenets hold, lapsed, are due, or were never assayed -- read only (D186). */
export async function assessCorpus(db, actor, { kind, id } = {}) {
  const c = await readCorpus(db, actor, { kind, id });
  const rows = [...c.tenets.filter((t) => t.kind === 'tenet').map((t) => ({ id: t.id, key: t.key, from: c.corpus.subject, state: t.latest?.state || null, freshness: t.freshness, stale: !!t.latest?.stale })),
    ...c.aggregated.map((t) => ({ id: t.id, key: t.key, from: t.from, state: t.state, freshness: t.freshness, stale: false }))];
  const count = (f) => rows.filter(f).length;
  return { corpus: c.corpus, summary: { tenets: rows.length, held: count((r) => r.state === 'held' && ['fresh', 'due'].includes(r.freshness) && !r.stale),
    lapsed: count((r) => r.state === 'lapsed'), error: count((r) => r.state === 'error'), never: count((r) => r.freshness === 'never'),
    aging: count((r) => ['warn', 'expired'].includes(r.freshness) || r.stale) }, tenets: rows };
}

// ───────────────────────────── write: authored tenets, proposals and ratification

/** A person who manages the scope writes a tenet directly. An agent cannot (it proposes). */
export async function authorTenet(db, actor, { kind, id }, input) {
  const who = await principalOf(db, actor);
  const scope = await scopeFor(db, who, kind, id);
  if (who.kind !== 'human') fail('An agent proposes; a person ratifies. Use corpus.propose.', 'agent_must_propose', 403);
  if (!(await mayManage(db, who, scope))) fail('Only a person who administers this scope writes its tenets', 'not_allowed', 403);
  const t = parseTenet(input, scope);
  return guarded(() => withTransaction(db, async (tx) => {
    const corpus = await ensureCorpus(tx, scope, who.id);
    const row = await insertTenet(tx, corpus.id, t, { origin: 'authored', createdBy: who.id });
    return shapeTenet(row, null);
  }));
}
async function insertTenet(tx, corpusId, t, { origin, createdBy, proposalId = null, bindingId = null }) {
  return (await tx.query(`INSERT INTO corpus_tenets (corpus_id, tenet_key, kind, subject, claim, definition, assay, expect, cadence, warn_after, expire_after,
      source, provenance, origin, proposal_id, binding_id, content_hash, created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
  [corpusId, t.key, t.kind, t.subject, t.claim, JSON.stringify(t.definition), t.assay ? JSON.stringify(t.assay) : null, t.expect, t.cadence, t.warnAfter, t.expireAfter,
    t.source, JSON.stringify(t.provenance), origin, proposalId, bindingId, t.contentHash, createdBy])).rows[0];
}

/** corpus.propose: anyone who can read the scope -- agent or person -- suggests a change. Never applied here. */
export async function propose(db, actor, { kind, id }, { action = 'add', tenet, targetTenetId, rationale } = {}) {
  const who = await principalOf(db, actor);
  const scope = await scopeFor(db, who, kind, id);
  if (!['add', 'supersede', 'retire'].includes(action)) fail('action is add, supersede or retire', 'invalid_action');
  const why = text(rationale, 4000);
  if (!why) fail('Say why: a rationale of at most 4000 characters', 'rationale_required');
  const parsed = action === 'retire' ? null : parseTenet(tenet, scope);
  return guarded(() => withTransaction(db, async (tx) => {
    const corpus = await ensureCorpus(tx, scope, who.accountable);
    let target = null;
    if (action !== 'add') {
      if (!UUID.test(String(targetTenetId || ''))) fail('Name the tenet to change (targetTenetId)', 'target_required');
      target = (await tx.query('SELECT * FROM corpus_tenets WHERE id=$1 AND corpus_id=$2 AND superseded_at IS NULL', [targetTenetId, corpus.id])).rows[0];
      if (!target) fail('That tenet is not live in this corpus', 'tenet_not_found', 404);
      if (target.origin === 'imported') fail('An imported tenet changes in its directory, not here', 'imported_tenet_read_only', 409);
    }
    const p = (await tx.query(`INSERT INTO corpus_proposals (corpus_id, action, target_tenet_id, tenet, rationale, proposed_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [corpus.id, action, target ? target.id : null, parsed ? JSON.stringify(parsed) : null, why, who.id])).rows[0];
    return { proposal: shapeProposal({ ...p, proposer_kind: who.kind }), note: 'A person who administers this scope reads it and ratifies or rejects it.' };
  }));
}

/** A PERSON decides a proposal. Ratifying is the only path from a proposal to a tenet (D211). */
export async function decideProposal(db, actor, proposalId, { decision, note } = {}) {
  const who = await principalOf(db, actor);
  if (!UUID.test(String(proposalId || ''))) fail('Proposal not found', 'proposal_not_found', 404);
  if (!['ratify', 'reject'].includes(decision)) fail('decision is ratify or reject', 'invalid_decision');
  return guarded(() => withTransaction(db, async (tx) => {
    const p = (await tx.query('SELECT * FROM corpus_proposals WHERE id=$1 FOR UPDATE', [proposalId])).rows[0];
    if (!p) fail('Proposal not found', 'proposal_not_found', 404);
    const corpus = (await tx.query('SELECT * FROM corpus_corpora WHERE id=$1', [p.corpus_id])).rows[0];
    let scope; try { scope = await scopeOfCorpus(tx, who, corpus); } catch { fail('Proposal not found', 'proposal_not_found', 404); }
    if (who.kind !== 'human') fail('Only a person can ratify or reject a proposal', 'human_must_decide', 403);
    if (!(await mayManage(tx, who, scope))) fail('Only a person who administers this scope decides its proposals', 'not_allowed', 403);
    if (p.state !== 'proposed') fail('This proposal was already decided', 'proposal_decided', 409);
    let tenet = null;
    if (decision === 'ratify') {
      await tx.query(`UPDATE corpus_proposals SET state='ratified', decided_by_user_id=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [p.id, who.id, text(note, 4000) || null]);
      if (p.target_tenet_id) {
        const live = (await tx.query('SELECT 1 FROM corpus_tenets WHERE id=$1 AND superseded_at IS NULL FOR UPDATE', [p.target_tenet_id])).rowCount;
        if (!live) fail('The tenet this proposal changes is no longer live', 'tenet_changed', 409);
        await tx.query('UPDATE corpus_tenets SET superseded_at=now() WHERE id=$1', [p.target_tenet_id]);
      }
      if (p.tenet) {
        const t = parseTenet(p.tenet, scope);
        const row = await insertTenet(tx, corpus.id, t, { origin: 'ratified', createdBy: who.id, proposalId: p.id });
        if (p.target_tenet_id) await tx.query('UPDATE corpus_tenets SET superseded_by=$2 WHERE id=$1', [p.target_tenet_id, row.id]);
        tenet = shapeTenet(row, null);
      }
    } else {
      await tx.query(`UPDATE corpus_proposals SET state='rejected', decided_by_user_id=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [p.id, who.id, text(note, 4000) || null]);
    }
    const after = (await tx.query('SELECT * FROM corpus_proposals WHERE id=$1', [p.id])).rows[0];
    return { proposal: shapeProposal(after), tenet };
  }));
}

// ───────────────────────────── verdicts: admitted, chained, signed

async function tenetFor(db, who, tenetId, { lock = false } = {}) {
  if (!UUID.test(String(tenetId || ''))) fail('Tenet not found', 'tenet_not_found', 404);
  const t = (await db.query(`SELECT * FROM corpus_tenets WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [tenetId])).rows[0];
  if (!t) fail('Tenet not found', 'tenet_not_found', 404);
  const corpus = (await db.query('SELECT * FROM corpus_corpora WHERE id=$1', [t.corpus_id])).rows[0];
  try { return { t, corpus, scope: await scopeOfCorpus(db, who, corpus) }; } catch { fail('Tenet not found', 'tenet_not_found', 404); }
}

/**
 * Record what an assay run observed. The run is an ADMITTED run of the person accountable (an agent's runs are
 * its owner's); `state` is decided by the runner against `expect`, and the platform signs what it was told
 * with the time and the chain -- it attests WHO reported it under WHICH admission, not that the assay is right.
 */
export async function recordVerdict(db, actor, tenetId, { admissionId, state, observed, instrument } = {}, { signingKey } = {}) {
  const who = await principalOf(db, actor);
  if (!signingKey?.kid || !signingKey?.privatePem) fail('Verdict signing is unavailable', 'signing_unavailable', 503);
  if (!['held', 'lapsed', 'error'].includes(state)) fail('state is held, lapsed or error', 'invalid_state');
  if (!UUID.test(String(admissionId || ''))) fail('A verdict is taken under a run admission (admissionId)', 'admission_required');
  return guarded(() => withTransaction(db, async (tx) => {
    const { t } = await tenetFor(tx, who, tenetId, { lock: true });
    if (t.kind !== 'tenet' || t.superseded_at) fail('Only a live tenet takes verdicts', 'tenet_not_live', 409);
    const adm = (await tx.query('SELECT actor_user_id FROM workforce_run_admissions WHERE id=$1', [admissionId])).rows[0];
    if (!adm || String(adm.actor_user_id) !== who.accountable) fail('That run admission is not yours', 'corpus_verdict_admission_not_yours', 403);
    const prev = (await tx.query('SELECT hash FROM corpus_verdicts WHERE tenet_id=$1 ORDER BY at DESC, id DESC LIMIT 1', [t.id])).rows[0]?.hash || null;
    const at = new Date().toISOString();
    const body = { v: 1, tenet: String(t.id), key: t.tenet_key, contentHash: t.content_hash, state, observed: text(observed, 4000) ?? null,
      instrument: text(instrument, 1000) ?? null, admission: String(admissionId), recordedBy: who.accountable, reportedBy: who.id, at, prev };
    if (body.observed === null && observed != null) fail('observed is at most 4000 characters', 'invalid_observed');
    const hash = sha(canon(body));
    const signature = crypto.sign('sha256', Buffer.from(hash), { key: signingKey.privatePem, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const v = (await tx.query(`INSERT INTO corpus_verdicts (tenet_id, tenet_content_hash, state, observed, instrument, admission_id, recorded_by_user_id, reported_by_user_id, at, prev_hash, hash, signing_kid, signature)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [t.id, t.content_hash, state, body.observed, body.instrument, admissionId, who.accountable, who.id, at, prev, hash, signingKey.kid, signature])).rows[0];
    return { verdict: { ...shapeVerdict(v), signed: canon(body) } };
  }));
}

/** A tenet's full verdict history, newest first, with each signed body so a reader can verify it offline. */
export async function verdictHistory(db, actor, tenetId, { limit = 100 } = {}) {
  const who = await principalOf(db, actor);
  const { t, scope } = await tenetFor(db, who, tenetId);
  const rows = (await db.query('SELECT * FROM corpus_verdicts WHERE tenet_id=$1 ORDER BY at DESC, id DESC LIMIT $2', [t.id, Math.min(500, Math.max(1, Number(limit) || 100))])).rows;
  return { tenet: shapeTenet(t, rows[0] || null, { scope: scope.subject }), verdicts: rows.map(shapeVerdict) };
}

/** Verify a verdict's signature and recompute its hash from its fields. */
export function verifyVerdict(verdictRow, tenetRow, publicKey) {
  const body = { v: 1, tenet: String(tenetRow.id), key: tenetRow.tenet_key, contentHash: verdictRow.tenet_content_hash, state: verdictRow.state,
    observed: verdictRow.observed ?? null, instrument: verdictRow.instrument ?? null, admission: String(verdictRow.admission_id),
    recordedBy: String(verdictRow.recorded_by_user_id), reportedBy: String(verdictRow.reported_by_user_id),
    at: new Date(verdictRow.at).toISOString(), prev: verdictRow.prev_hash };
  return sha(canon(body)) === verdictRow.hash
    && crypto.verify('sha256', Buffer.from(verdictRow.hash), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(verdictRow.signature, 'base64url'));
}

/** Live cards for the Canvas: each tenet id resolves as THIS reader; one they cannot open is `missing`, never named. */
export async function resolveTenetCards(db, actor, ids) {
  const out = {};
  if (!ids.length) return out;
  let who; try { who = await principalOf(db, actor); } catch { for (const id of ids) out[id] = { missing: true }; return out; }
  for (const id of ids) {
    try {
      const { t, scope } = await tenetFor(db, who, id);
      const l = (await latestVerdicts(db, [String(t.id)])).get(String(t.id));
      out[id] = { key: t.tenet_key, claim: t.claim, scope: scope.subject, state: l ? l.state : null, at: l ? l.at : null, freshness: freshnessOf(t, l), superseded: !!t.superseded_at };
    } catch { out[id] = { missing: true }; }
  }
  return out;
}

// ───────────────────────────── import a project's `.xeno/corpus/` through its directory binding (ASN-07)

/**
 * The bound installation read `<root>/.xeno/corpus/` and sends what it found. Only that installation, on a live
 * binding of THIS project, may sync it. The platform keeps a read mirror: unchanged tenets stay, changed ones
 * are superseded by the new content, ones gone from the directory are retired. A tenet the nesting rules refuse
 * is reported, not forced.
 */
export async function importFromDirectory(db, auth, projectId, { bindingId, tenets } = {}) {
  const host = hostOf(auth, 'projects:write');
  if (!UUID.test(String(projectId || '')) || !UUID.test(String(bindingId || ''))) fail('Binding not found', 'binding_not_found', 404);
  if (!Array.isArray(tenets) || tenets.length > 500) fail('tenets is a list of at most 500', 'invalid_tenets');
  return withTransaction(db, async (tx) => {
    const b = (await tx.query(`SELECT * FROM project_directory_bindings WHERE id=$1 FOR SHARE`, [bindingId])).rows[0];
    if (!b || b.state !== 'active' || String(b.project_id) !== String(projectId) || b.host_installation_id !== host.installationId) fail('Binding not found', 'binding_not_found', 404);
    const userId = String(b.host_owner_user_id);
    if (!(await allowed(tx, userId, `project:${projectId}`, 'editor'))) fail('Binding not found', 'binding_not_found', 404);
    const who = { id: userId, kind: 'human', accountable: userId };
    const scope = await scopeFor(tx, who, 'project', projectId);
    const corpus = await ensureCorpus(tx, scope, userId);
    const current = new Map((await tx.query(`SELECT * FROM corpus_tenets WHERE corpus_id=$1 AND binding_id=$2 AND superseded_at IS NULL`, [corpus.id, b.id])).rows.map((r) => [r.tenet_key, r]));
    const report = { imported: [], unchanged: [], retired: [], refused: [] };
    const seen = new Set();
    for (const raw of tenets) {
      let t; try { t = parseTenet(raw, scope); } catch (e) { report.refused.push({ key: String(raw?.id || raw?.key || ''), code: e.code }); continue; }
      if (seen.has(t.key)) { report.refused.push({ key: t.key, code: 'duplicate_key' }); continue; }
      seen.add(t.key);
      const was = current.get(t.key);
      if (was && was.content_hash === t.contentHash) { report.unchanged.push(t.key); continue; }
      await tx.query('SAVEPOINT corpus_import');
      try {
        if (was) await tx.query('UPDATE corpus_tenets SET superseded_at=now() WHERE id=$1', [was.id]);
        const row = await insertTenet(tx, corpus.id, t, { origin: 'imported', createdBy: userId, bindingId: b.id });
        if (was) await tx.query('UPDATE corpus_tenets SET superseded_by=$2 WHERE id=$1', [was.id, row.id]);
        await tx.query('RELEASE SAVEPOINT corpus_import');
        report.imported.push(t.key);
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT corpus_import');
        const m = mapDbError(e);
        if (!(m instanceof CorpusError)) throw e;
        report.refused.push({ key: t.key, code: m.code });
      }
    }
    for (const [key, r] of current) if (!seen.has(key)) { await tx.query('UPDATE corpus_tenets SET superseded_at=now() WHERE id=$1', [r.id]); report.retired.push(key); }
    return { corpus: { id: String(corpus.id), subject: scope.subject }, ...report };
  });
}

// ───────────────────────────── the Workspace architect reads a corpus as a source (services/workspaceArchitect.js)

/**
 * A source `{ kind: 'corpus', scope: 'workspace'|'division'|'project', id }`: the tenets and doctrine the caller can
 * read in that scope, one passage each, cited by TENET ID (chunkId). Narrower scopes' tenets arrive by reference
 * (key + state), never their content. A scope the caller cannot read yields no passages (reported unavailable).
 */
export async function corpusPassages(db, actor, source = {}) {
  let c; try { c = await readCorpus(db, { id: actor.id }, { kind: String(source.scope || 'project'), id: String(source.id || '') }); } catch { return { passages: [] }; }
  const line = (t) => `${t.kind === 'doctrine' ? 'Doctrine' : 'Tenet'} ${t.key}: ${t.claim}${t.kind === 'tenet' ? ` (latest verdict: ${t.latest?.state || 'never assayed'})` : ''}`;
  const passages = [
    ...c.tenets.map((t) => ({ chunkId: t.id, name: `Corpus ${t.key}`, text: line(t) })),
    ...c.inheritedDoctrine.map((t) => ({ chunkId: t.id, name: `Corpus ${t.key}`, text: line(t) + ` (from ${t.from})` })),
    ...c.aggregated.map((t) => ({ chunkId: t.id, name: `Corpus ${t.key}`, text: `Tenet ${t.key} in ${t.from}: latest verdict ${t.state || 'never assayed'}` })),
  ];
  return { passages };
}
registerSourceProvider('corpus', corpusPassages);
