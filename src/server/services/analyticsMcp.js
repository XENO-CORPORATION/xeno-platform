/**
 * XENO Analytics as agent capabilities. READ-ONLY by design: an agent may list the metrics, read one, and read the
 * workspace's saved dashboards. Every tool calls the SAME function the Analytics screen calls (services/analytics.js).
 * Saving, changing and deleting dashboards is a person's step on the screen; there is no tool for it.
 */
import * as A from './analytics.js';

export class AnalyticsMcpError extends Error { constructor(message, code) { super(message); this.name = 'AnalyticsMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };

export const TOOLS = [
  { name: 'list_metrics', title: 'List analytics metrics', annotations: RO,
    description: 'The metrics this workspace’s Analytics can show (id, title, whether a division can narrow it) and the workspace’s divisions. Use a metric id with query_metric.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'query_metric', title: 'Read a metric', annotations: RO,
    description: 'One metric’s value now: credits.spend, tasks.throughput, storage.usage, support.tickets or runs.agents, over the last `days` (1–365, default 30). Pass `division` to narrow tasks.throughput or runs.agents to one division.',
    inputSchema: { type: 'object', required: ['metric'], properties: { workspace: WS, metric: { type: 'string', enum: A.METRICS.map((m) => m.id) },
      days: { type: 'integer', minimum: 1, maximum: 365 }, division: { type: 'string', description: 'Optional division id from list_metrics.' } }, additionalProperties: false } },
  { name: 'list_dashboards', title: 'List saved dashboards', annotations: RO,
    description: 'The workspace’s saved dashboards: id, name, and widgets (each a metric id and a window in days). Read a widget’s value with query_metric.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'list_metrics': return ok(await A.listMetrics(db, actor, { workspace: a.workspace }));
      case 'query_metric': return ok(await A.queryMetric(db, actor, { workspace: a.workspace, metric: a.metric, days: a.days, division: a.division }));
      case 'list_dashboards': return ok(await A.listDashboards(db, actor, { workspace: a.workspace }));
      default: throw new AnalyticsMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof A.AnalyticsError) throw new AnalyticsMcpError(e.message, e.code);
    throw e;
  }
}
