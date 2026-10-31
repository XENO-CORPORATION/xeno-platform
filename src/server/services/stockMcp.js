/**
 * XENO Stock as agent capabilities: find a free-of-copyright photo, artwork or video, read its licence, and save it to a workspace's Library.
 * Every tool calls the SAME function the Libraries screen calls (services/stock.js). Generating an image is a separate tool of its own.
 */
import * as S from './stock.js';

export class StockMcpError extends Error { constructor(message, code) { super(message); this.name = 'StockMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };

export const TOOLS = [
  { name: 'search', title: 'Search Stock', annotations: RO,
    description: 'Photos, art and video free of copyright (CC0), each with where its licence was read. CC0 speaks for copyright only: tell the person to check a person’s or a brand’s rights before advertising with one.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: ['image', 'video'] }, collection: { type: 'string', enum: ['photo', 'art', 'video'] }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'get_item', title: 'Read a Stock item', annotations: RO,
    description: 'One item: its licence, who states it, a credit line and its file addresses.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 40 } }, additionalProperties: false } },
  { name: 'list_saved', title: 'List saved Stock items', annotations: RO,
    description: 'What this workspace saved from Stock, with each file’s Library id.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'save', title: 'Save a Stock item', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Copy an item into this workspace’s Library, marked as saved by you. It counts against the workspace’s storage. Saving it again returns the same file.',
    inputSchema: { type: 'object', required: ['id'], properties: { workspace: WS, id: { type: 'string', maxLength: 40 } }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'search': return ok(await S.search(db, { q: a.q, kind: a.kind, collection: a.collection, offset: a.offset }));
      case 'get_item': return ok(await S.getItem(db, { id: a.id }));
      case 'list_saved': return ok(await S.listSaved(db, actor, { workspace: a.workspace }));
      case 'save': return ok(await S.save(db, actor, { workspace: a.workspace, id: a.id }));
      default: throw new StockMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof S.StockError) throw new StockMcpError(e.message, e.code);
    throw e;
  }
}
