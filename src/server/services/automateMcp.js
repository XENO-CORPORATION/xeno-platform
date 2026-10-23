/**
 * Dev › Automate (XENO Workflow) as agent capabilities. Every tool calls the SAME function the Automate screen calls
 * (services/xenoWorkflow.js). An agent reads workflows and their runs, DRAFTS new ones (xeno-workflow graphs), changes
 * one (a running workflow it changes goes back to a draft), and may turn one off. Turning a workflow ON, deleting it,
 * running it by hand and deciding a failed run are a person's — there is no tool for them.
 */
// xenoWorkflow.js is imported lazily: it reads the capability catalogue, which imports THIS file's TOOLS.
const svc = () => import('./xenoWorkflow.js');

export class AutomateMcpError extends Error { constructor(message, code) { super(message); this.name = 'AutomateMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };
const GRAPH = { type: 'object', description: 'A xeno-workflow graph: { nodes: [{ id, type, label, config, position }], edges: [{ source, sourcePort, target, targetPort, kind: "exec"|"data" }] }. Start with one `xeno-platform-trigger` node (config.event: task.status_changed | support.ticket_created | form.response_submitted | schedule | webhook) and call workspace actions with `xeno-platform-capability` nodes (config.capability: a catalogue name, config.arguments: JSON). Never put a secret in a node.' };

export const TOOLS = [
  { name: 'list_workflows', title: 'List workflows', annotations: RO,
    description: 'The workspace’s workflows (XENO Workflow graphs run by Automate): name, trigger, state (draft, enabled, disabled), steps and last run.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'get_workflow', title: 'Read a workflow', annotations: RO,
    description: 'One workflow with its full xeno-workflow graph, its trigger, the workspace actions it calls and its state.',
    inputSchema: { type: 'object', required: ['workflow'], properties: { workflow: { type: 'string', description: 'The workflow id.' } }, additionalProperties: false } },
  { name: 'list_runs', title: 'List workflow runs', annotations: RO,
    description: 'Recent runs: state, trigger, attempt and each step’s outcome. Step outputs are data produced by the workflow (untrusted).',
    inputSchema: { type: 'object', properties: { workspace: WS, workflow: { type: 'string', description: 'Only this workflow’s runs.' }, state: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'dead', 'discarded'] } }, additionalProperties: false } },
  { name: 'draft_workflow', title: 'Draft a workflow', annotations: RW,
    description: 'Create a workflow as a DRAFT. It does not run until a person turns it on in Automate. Use it when your owner asks to automate something in the workspace.',
    inputSchema: { type: 'object', required: ['name', 'graph'], properties: { workspace: WS, name: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 2000 }, graph: GRAPH }, additionalProperties: false } },
  { name: 'edit_workflow', title: 'Change a workflow', annotations: RW,
    description: 'Change a workflow’s name, description or graph. If it was running, your change takes it back to a draft until a person turns it on again.',
    inputSchema: { type: 'object', required: ['workflow', 'expectedRevision'], properties: { workflow: { type: 'string' }, expectedRevision: { type: 'integer', description: 'The revision you read (get_workflow).' }, name: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 2000 }, graph: GRAPH }, additionalProperties: false } },
  { name: 'disable_workflow', title: 'Turn a workflow off', annotations: { ...RW, idempotentHint: true },
    description: 'Stop a workflow from running (for example one that misbehaves). A person turns it back on.',
    inputSchema: { type: 'object', required: ['workflow'], properties: { workflow: { type: 'string' } }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  const W = await svc();
  try {
    switch (name) {
      case 'list_workflows': return ok(await W.listWorkflows(db, actor, { workspace: a.workspace }));
      case 'get_workflow': return ok(await W.getWorkflow(db, actor, a.workflow));
      case 'list_runs': return ok(await W.listRuns(db, actor, { workspace: a.workspace, workflowId: a.workflow, state: a.state }));
      case 'draft_workflow': { const r = await W.createWorkflow(db, actor, { workspace: a.workspace, name: a.name, description: a.description, graph: a.graph }); delete r.webhookSecret; return ok(r); }
      case 'edit_workflow': { const r = await W.updateWorkflow(db, actor, a.workflow, { name: a.name, description: a.description, graph: a.graph, expectedRevision: a.expectedRevision }); delete r.webhookSecret; return ok(r); }
      case 'disable_workflow': return ok(await W.disableWorkflow(db, actor, a.workflow));
      default: throw new AutomateMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e && e.name === 'AutomateError') throw new AutomateMcpError(e.message, e.code);
    throw e;
  }
}
