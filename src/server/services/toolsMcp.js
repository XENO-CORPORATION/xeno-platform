/**
 * XENO Tools as agent capabilities: find the right tool, and the address that opens it for a person.
 * The tools themselves run in the person's browser or in XENO Hub, in a signed package with the person's own files, so
 * there is no server-side run to hand an agent; this says plainly where each one runs. services/toolPackages.js answers.
 */
import * as tools from './toolPackages.js';

export class ToolsMcpError extends Error { constructor(message, code) { super(message); this.name = 'ToolsMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const OPEN_BASE = 'https://xenosystem.ai/tools/';
const shape = (t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, version: t.version, open: OPEN_BASE + encodeURIComponent(t.id), runsInBrowser: !!t.web?.runs, needsHubFor: t.web?.needsHub || [] });

export const TOOLS = [
  { name: 'list', title: 'List XENO tools', annotations: RO,
    description: 'Every XENO tool: what it does, its version, the address that opens it for a person, and whether it runs in a browser or needs XENO Hub for part of its work. Tools run on the person’s side, so give them the address; you cannot run one from here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'suggest', title: 'Suggest a XENO tool', annotations: RO,
    description: 'The tools that best fit what someone wants to do, best first. Use it when a person asks for something a tool may already do.',
    inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 500, description: 'What they want to do, in their words.' } }, additionalProperties: false } },
];

export async function callTool(_db, _actor, name, args) {
  const a = args || {};
  try {
    switch (name) {
      case 'list': return ok({ tools: (await tools.listTools()).filter((t) => t.contract === 'tool@1').map(shape) });
      case 'suggest': {
        if (typeof a.q !== 'string' || !a.q.trim()) throw new ToolsMcpError('Say what they want to do.', 'bad_input');
        return ok({ tools: (await tools.suggestTools(a.q.slice(0, 500))).map(shape) });
      }
      default: throw new ToolsMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof ToolsMcpError) throw e;
    throw new ToolsMcpError('XENO tools can’t be reached right now.', 'unavailable');
  }
}
