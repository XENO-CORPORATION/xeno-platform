/**
 * XENO Assets as agent capabilities. An agent reads a workspace's brand kits, so what it makes stays on brand, and may propose
 * tokens in a kit's draft. Every tool calls the SAME function the Libraries screen calls (services/brandKits.js). Publishing
 * reaches everything that follows a kit, so it's a person's act (held by the service and by a database trigger); removing,
 * deleting and importing are a person's too, so there is no tool for them.
 */
import * as K from './brandKits.js';

export class BrandKitsMcpError extends Error { constructor(message, code) { super(message); this.name = 'BrandKitsMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };
const KIT = { type: 'string', description: 'The kit id from list_kits.' };

export const TOOLS = [
  { name: 'list_kits', title: 'List brand kits', annotations: RO,
    description: 'The workspace’s brand kits: id, name, how many items, and the newest published version.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'get_brand', title: 'Read a brand', annotations: RO,
    description: 'A published version of a kit: its tokens, logos and voice. Use this to make work on brand. It is frozen, so a digest and version number identify exactly what you used. Defaults to the newest.',
    inputSchema: { type: 'object', required: ['kit'], properties: { workspace: WS, kit: KIT, version: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'export_tokens', title: 'Export tokens', annotations: RO,
    description: 'A published version as a file’s text: dtcg (W3C Design Tokens), css (custom properties), tailwind (a theme) or canvas (XENO Canvas tokens).',
    inputSchema: { type: 'object', required: ['kit'], properties: { workspace: WS, kit: KIT, format: { type: 'string', enum: K.EXPORT_FORMATS }, version: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'propose_token', title: 'Propose a token', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Add or change a token in a kit’s DRAFT, marked as yours. Nothing that follows the kit sees it until a person publishes.',
    inputSchema: { type: 'object', required: ['kit', 'path', 'value'], additionalProperties: false, properties: { workspace: WS, kit: KIT,
      path: { type: 'string', description: 'Lowercase words joined by dots, like color.brand.primary.' },
      value: { type: 'object', description: '{kind: "color", value: "#1a2b3c"} · {kind: "number", value, unit?: "px"|"rem"|"%"} · {kind: "string", value} · {kind: "shadow", value: {offsetX, offsetY, blur, spread, color}} · {kind: "typography", value: {fontFamily, fontSize, fontWeight, lineHeight}} · {kind: "alias", path}' },
      description: { type: 'string', maxLength: 1000 } } } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'list_kits': return ok(await K.listKits(db, actor, { workspace: a.workspace }));
      case 'get_brand': return ok(await K.readVersion(db, actor, { workspace: a.workspace, id: a.kit, version: a.version }));
      case 'export_tokens': { const r = await K.exportKit(db, actor, { workspace: a.workspace, id: a.kit, version: a.version, format: a.format || 'dtcg' }); return ok({ filename: r.filename, version: r.version, digest: r.digest, format: r.format, text: r.body }); }
      case 'propose_token': return ok(await K.putToken(db, actor, { workspace: a.workspace, id: a.kit, path: a.path, value: a.value, description: a.description }));
      default: throw new BrandKitsMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof K.BrandKitError) throw new BrandKitsMcpError(e.message, e.code);
    throw e;
  }
}
