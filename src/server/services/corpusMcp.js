/**
 * XENO MCP rows for XENO Corpus (services/xenoCorpus.js, the same service as REST and the Corpus tab).
 * query and assess read; propose suggests a change that a PERSON ratifies -- nothing an agent sends becomes a
 * tenet on its own (D211), and the database refuses an agent-written tenet or ratification.
 */
import * as corpus from './xenoCorpus.js';
import { getSigningKey } from '../utils/oidcProvider.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const SCOPE = { type: 'string', enum: ['workspace', 'division', 'project'], description: 'Which corpus: a workspace’s, a division’s or a project’s.' };
const ID = { type: 'string', description: 'The id (UUID) of that workspace, division or project.' };

export class CorpusMcpError extends Error { constructor(message, code) { super(message); this.code = code; } }

export const TOOLS = [
  { name: 'query', title: 'Search a corpus', annotations: RO,
    description: 'The verified truth of a workspace, division or project: its tenets (a claim and the assay that would disprove it) with the latest signed verdict, the doctrine it inherits from wider scopes (binding here), and narrower scopes’ tenets by reference. Read this before asserting a fact about the scope; an empty answer is an answer. Optional q filters by key, subject or claim.',
    inputSchema: { type: 'object', required: ['scope', 'id'], properties: { scope: SCOPE, id: ID, q: { type: 'string', description: 'Text to match in key, subject or claim.' } } } },
  { name: 'assess', title: 'Assess a corpus', annotations: RO,
    description: 'Which tenets of a scope hold, lapsed, errored, are aging past their cadence, or were never assayed. Writes nothing. Use it to decide what to re-assay or what to propose.',
    inputSchema: { type: 'object', required: ['scope', 'id'], properties: { scope: SCOPE, id: ID } } },
  { name: 'propose', title: 'Propose a tenet change', annotations: RW,
    description: 'Suggest adding, superseding or retiring a tenet. It is NOT applied: a person who administers the scope reads it and ratifies or rejects it in the Corpus tab. A tenet must carry its assay {kind, run} and expect; doctrine (kind "doctrine") carries none. A wider scope may not assert about a narrower scope’s subject.',
    inputSchema: { type: 'object', required: ['scope', 'id', 'rationale'], properties: { scope: SCOPE, id: ID,
      action: { type: 'string', enum: ['add', 'supersede', 'retire'], description: 'Default add.' },
      tenet: { type: 'object', description: 'key, kind (tenet|doctrine), subject?, claim, definition?, assay {kind: shell|node|http|manual, run}, expect, cadence? ("24h"), warnAfter?, expireAfter?, source?.' },
      target_tenet_id: { type: 'string', description: 'For supersede or retire: the live tenet’s id.' },
      rationale: { type: 'string', description: 'Why: what you observed and where.' } } } },
  { name: 'history', title: 'Read a tenet’s verdicts', annotations: RO,
    description: 'Every signed verdict a tenet has had, newest first: state, what was observed, when, the run admission it was taken under, and the hash chain and signature, so it can be verified offline against the platform key.',
    inputSchema: { type: 'object', required: ['tenet'], properties: { tenet: { type: 'string', description: 'The tenet id (from corpus_query).' }, limit: { type: 'integer', description: 'At most 500; default 100.' } } } },
  { name: 'record_verdict', title: 'Record an assay verdict', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Record what an assay run observed for a tenet: held, lapsed or error. It must be taken under a live run admission of the person accountable for you (your owner), and it is kept forever, signed and chained; it cannot be edited. Run the tenet’s assay first; report what it returned, not what you expected.',
    inputSchema: { type: 'object', required: ['tenet', 'admission', 'state'], properties: { tenet: { type: 'string', description: 'The tenet id.' },
      admission: { type: 'string', description: 'The run admission id you are running under.' }, state: { type: 'string', enum: ['held', 'lapsed', 'error'] },
      observed: { type: 'string', description: 'What the assay returned.' }, instrument: { type: 'string', description: 'The command or procedure you ran.' } } } },
];

async function run(fn) {
  try { return ok(await fn()); } catch (e) { if (e instanceof corpus.CorpusError) throw new CorpusMcpError(e.message, e.code); throw e; }
}

export async function callTool(db, actor, name, a = {}) {
  const me = { id: actor.id };
  switch (name) {
    case 'query': return run(() => corpus.queryCorpus(db, me, { kind: a.scope, id: a.id, q: a.q }));
    case 'assess': return run(() => corpus.assessCorpus(db, me, { kind: a.scope, id: a.id }));
    case 'propose': return run(() => corpus.propose(db, me, { kind: a.scope, id: a.id }, { action: a.action || 'add', tenet: a.tenet, targetTenetId: a.target_tenet_id, rationale: a.rationale }));
    case 'history': return run(() => corpus.verdictHistory(db, me, a.tenet, { limit: a.limit }));
    case 'record_verdict': return run(async () => { const k = await getSigningKey(db);
      return corpus.recordVerdict(db, me, a.tenet, { admissionId: a.admission, state: a.state, observed: a.observed, instrument: a.instrument }, { signingKey: { kid: k.kid, privatePem: k.privatePem } }); });
    default: throw new CorpusMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
