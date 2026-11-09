/**
 * XENO Sites as agent capabilities: read which sites a workspace has published, which version is live and what was done
 * to it. Every tool calls the SAME functions /api/sites calls (services/siteRecords.js). Publishing happens in the app that
 * built the site, and making one live is a person's, so there is no tool that changes a site.
 */
import * as S from './siteRecords.js';

export class SitesMcpError extends Error { constructor(message, code) { super(message); this.name = 'SitesMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };

export const TOOLS = [
  { name: 'list_sites', title: 'List sites', annotations: RO,
    description: 'The workspace’s published sites: name, address, which version is live and since when, and custom domains.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'get_site', title: 'Read a site', annotations: RO,
    description: 'One site: every version that was published (each with its own preview address), which one is live, and who did what when.',
    inputSchema: { type: 'object', required: ['site'], properties: { workspace: WS, site: { type: 'string', description: 'The site id from list_sites.' } }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'list_sites': return ok(await S.listSites(db, actor, { workspace: a.workspace }));
      case 'get_site': return ok(await S.getSite(db, actor, { workspace: a.workspace, id: a.site }));
      default: throw new SitesMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof S.SiteRecordError) throw new SitesMcpError(e.message, e.code);
    throw e;
  }
}
