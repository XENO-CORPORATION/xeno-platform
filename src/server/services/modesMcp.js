/**
 * XENO MCP rows for custom modes and trade packs (XENO MODES - SPEC.md §8c.3). Every tool calls services/modeApply.js,
 * the same code path as the Setup screen. An agent can list, plan and read status for its owner's workspace; APPLY
 * and REVERT are refused for an agent (`human_admin_must_confirm`): a person who administers the workspace reads the
 * plan and confirms it, the same rule as Tasks, where an agent never accepts its own work.
 */
import * as modes from './modeApply.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The workspace id (a UUID) the setup is for.' };
const PACK = { type: 'string', description: 'A pack id from modes_list (e.g. "salon", or "listing:<version id>").' };
const ANSWERS = { type: 'object', description: 'Answers to the pack’s questions, by question id (e.g. {"businessName": "Studio Ana"}).' };

export class ModesMcpError extends Error { constructor(message, code) { super(message); this.code = code; } }

export const TOOLS = [
  { name: 'list', title: 'List business setups', annotations: RO,
    description: 'The setups ("trade packs") that can be applied to a workspace — salon, club, freelance photographer and any published on the Marketplace — with their questions and what each creates. Use modes_plan next.',
    inputSchema: { type: 'object', properties: { workspace: WS } } },
  { name: 'plan', title: 'Plan a business setup', annotations: RO,
    description: 'What applying a setup to a workspace would create (its mode, starter tasks), what it costs and any conflict, plus a planHash. Writes nothing. Show the plan to the person: only a human workspace admin can apply it.',
    inputSchema: { type: 'object', required: ['workspace', 'pack'], properties: { workspace: WS, pack: PACK, answers: ANSWERS } } },
  { name: 'apply', title: 'Apply a business setup', annotations: RW,
    description: 'Apply a planned setup in one step, with the planHash you read and your own request_key (a retry returns the same receipt). Refused for an agent: a person who administers the workspace must confirm the plan — ask them to apply it from Setup.',
    inputSchema: { type: 'object', required: ['workspace', 'pack', 'plan_hash', 'request_key', 'confirm'], properties: { workspace: WS, pack: PACK, answers: ANSWERS,
      plan_hash: { type: 'string', description: 'planHash from modes_plan.' }, request_key: { type: 'string', description: 'Your own key for this change, 8–128 characters.' },
      confirm: { type: 'boolean', description: 'true: the admin read the plan and confirms it.' } } } },
  { name: 'revert', title: 'Undo a business setup', annotations: RW,
    description: 'Undo an applied setup: archives what it created and nobody has touched since, keeps and lists everything a person edited. Human admins only.',
    inputSchema: { type: 'object', required: ['workspace', 'application'], properties: { workspace: WS, application: { type: 'string', description: 'The applicationId from the receipt.' } } } },
  { name: 'status', title: 'Setups applied to a workspace', annotations: RO,
    description: 'The setups applied to a workspace, newest first: pack, version, answers, every record each created, who applied it and whether it was undone.',
    inputSchema: { type: 'object', required: ['workspace'], properties: { workspace: WS } } },
];

async function run(fn) {
  try { return ok(await fn()); } catch (e) { if (e instanceof modes.ModeError) throw new ModesMcpError(e.message, e.code); throw e; }
}

export async function callTool(db, actor, name, a = {}) {
  const me = { id: actor.id };
  switch (name) {
    case 'list': return run(() => modes.listPacks(db));
    case 'plan': return run(() => modes.plan(db, me, { workspaceId: a.workspace, packId: a.pack, answers: a.answers }));
    case 'apply': return run(() => modes.apply(db, me, { workspaceId: a.workspace, packId: a.pack, answers: a.answers, planHash: a.plan_hash, idempotencyKey: a.request_key, confirm: a.confirm }));
    case 'revert': return run(() => modes.revert(db, me, { workspaceId: a.workspace, applicationId: a.application }));
    case 'status': return run(() => modes.status(db, me, { workspaceId: a.workspace }));
    default: throw new ModesMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
