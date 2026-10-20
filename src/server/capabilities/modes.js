/**
 * Catalogue rows for custom modes and trade packs (XENO MODES - SPEC.md §8c.3), kept in their own file so they can be
 * reviewed and changed without touching the rest of catalogue.js. Format: catalogue.js ROWS — [canonical name, bound
 * category, bound tool, class, extras]; bound tools: services/modesMcp.js.
 *
 * modes.mode.apply / modes.mode.revert need a HUMAN workspace admin's confirmation. They stay `always` (an admin's own
 * client may call them), and the service refuses an agent principal with `human_admin_must_confirm`.
 * Scopes: setting a workspace up is a workspace-admin act (`workspace:admin`); reading packs and plans is `workspace:read`.
 */
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const RECEIPT = { type: 'object', description: 'applicationId, workspaceId, packId, packVersion, packHash, answers, planHash, records[] (type, id) it created, appliedBy, appliedAt, revertedAt, revertReport ({archived[], kept[] with reason}).' };

export const MODES_ROWS = [
  ['modes.pack.list', 'modes', 'list', 'safe', { scope: 'workspace:read', reply: obj({ packs: { type: 'array', description: 'id, version, trade, title, summary, status (draft|published), questions, the mode it adds and its starter tasks.' } }, ['packs']) }],
  ['modes.mode.plan', 'modes', 'plan', 'safe', { scope: 'workspace:read', preview: { supported: true }, reply: obj({ plan: { type: 'object', description: 'workspaceId, pack (id, version, hash), answers, records it would create, conflicts, cost.' }, planHash: { type: 'string', description: 'Pass to modes.mode.apply.' } }, ['plan', 'planHash']) }],
  ['modes.mode.apply', 'modes', 'apply', 'undoable', { scope: 'workspace:admin', idempotency: { strategy: 'key', key: 'request_key' }, reply: obj({ replayed: { type: 'boolean', description: 'true when this key was already applied: the same receipt.' }, receipt: RECEIPT }, ['receipt']) }],
  ['modes.mode.revert', 'modes', 'revert', 'undoable', { scope: 'workspace:admin', idempotency: { strategy: 'natural', note: 'reverting a reverted setup returns its receipt unchanged' }, reply: obj({ replayed: { type: 'boolean' }, receipt: RECEIPT }, ['receipt']) }],
  ['modes.mode.status', 'modes', 'status', 'safe', { scope: 'workspace:read', reply: obj({ workspaceId: { type: 'string' }, applications: { type: 'array', description: 'Each receipt, newest first.' } }, ['applications']) }],
  // workspace architect (services/workspaceArchitect.js): proposes from an idea / Storage / Corpus; applies nothing
  ['modes.architect.propose', 'modes', 'architect_propose', 'irreversible', { scope: 'workspace:read', provenance: 'untrusted', cost: { model: 'metered', note: 'one model call billed to the caller (an agent’s owner) by tokens; it applies nothing' }, idempotency: { strategy: 'none', note: 'no request key yet: a retried call makes and bills a second proposal' }, reply: obj({ proposal: { type: 'object', description: 'proposalId, packId (proposal:<id>), proposal (mode, tasks, divisions, teams, agents, projects, objectives, layout — each with cites; citations by passage; dropped; diff), sources (used, unavailable), pack.' } }, ['proposal']) }],
  ['modes.architect.get', 'modes', 'architect_get', 'safe', { scope: 'workspace:read', provenance: 'untrusted', reply: obj({ proposal: { type: 'object', description: 'The stored proposal, as architect_propose returned it, with any edit a person made to its pack.' } }, ['proposal']) }],
];
