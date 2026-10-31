/**
 * XENO Fonts as agent capabilities. An agent finds open-licence fonts and what pairs with them, reads a workspace's fonts, and may add
 * a catalogue family. Every tool calls the SAME function the Libraries screen calls (services/fonts.js). Uploading means saying you hold
 * the rights to a font, which an agent can't do, so there's no tool for it, or for removing.
 */
import * as F from './fonts.js';

export class FontsMcpError extends Error { constructor(message, code) { super(message); this.name = 'FontsMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };

export const TOOLS = [
  { name: 'search_catalogue', title: 'Search open-licence fonts', annotations: RO,
    description: 'Fonts XENO hosts, all open-licence: name, category, weights, licence, and what pairs well with each.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 80 }, category: { type: 'string', enum: ['sans-serif', 'serif', 'monospace', 'display', 'handwriting'] } }, additionalProperties: false } },
  { name: 'list_workspace_fonts', title: 'List a workspace’s fonts', annotations: RO,
    description: 'The fonts this workspace uses: families from the catalogue and its own uploads. Use these when you make something for it.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'add_font', title: 'Add a catalogue font', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Add a family from the open catalogue to this workspace, marked as added by you.',
    inputSchema: { type: 'object', required: ['family'], properties: { workspace: WS, family: { type: 'string', description: 'A family id from search_catalogue.' } }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'search_catalogue': return ok(F.searchCatalogue({ q: a.q, category: a.category }));
      case 'list_workspace_fonts': return ok(await F.listWorkspaceFonts(db, actor, { workspace: a.workspace }));
      case 'add_font': return ok(await F.addFamily(db, actor, { workspace: a.workspace, family: a.family }));
      default: throw new FontsMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof F.FontError) throw new FontsMcpError(e.message, e.code);
    throw e;
  }
}
