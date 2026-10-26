/**
 * XENO Compute as agent capabilities (compute.js — the same functions the Compute screen and /api/compute call).
 * An agent acts for its owner in the owner's workspace: it may create, start, stop and delete machines that work for it,
 * and every hour it runs is billed to its owner and attributed to the agent. There is deliberately NO tool that sets a
 * cap or a price: caps are set by people (pricing ledger §8b D7) and prices by XENO staff. An agent reads its caps.
 */
import * as compute from './compute.js';

export class ComputeMcpError extends Error { constructor(message, code) { super(message); this.name = 'ComputeMcpError'; this.code = code; } }
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'Workspace id. Default: your owner’s Personal workspace.' };
const MID = { type: 'string', description: 'Machine id (mch_…).' };

export const TOOLS = [
  { name: 'sizes', title: 'Machine sizes', annotations: RO,
    description: 'The machine sizes (cores, memory, disk) and the credits per hour each costs. A size that is not priced yet cannot run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_machines', title: 'List machines', annotations: RO,
    description: 'Machines in the workspace, newest first, with state, size, the agent each works for and the cost so far.',
    inputSchema: { type: 'object', properties: { workspace: WS, state: { type: 'string', enum: compute.STATES } }, additionalProperties: false } },
  { name: 'get_machine', title: 'Read a machine', annotations: RO,
    description: 'One machine with its timeline (started, billed, could not be funded, stopped and why).',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'create_machine', title: 'Create a machine', annotations: RW,
    description: 'Create a machine that works for you (stopped until started). Refused by the workspace’s caps: a machine limit or a largest size. Pass an idempotencyKey so a retry does not make a second one.',
    inputSchema: { type: 'object', required: ['name', 'size'], properties: { workspace: WS, name: { type: 'string' }, size: { type: 'string' }, purpose: { type: 'string' }, image: { type: 'string' }, idempotencyKey: { type: 'string' } }, additionalProperties: false } },
  { name: 'start_machine', title: 'Start a machine', annotations: RW,
    description: 'Start a machine. An hour is reserved on your owner’s credits and settled for the time used. Refused when the size is not priced, a cap would be exceeded, or the credits cannot cover the next hour.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'stop_machine', title: 'Stop a machine', annotations: RW,
    description: 'Stop a machine. Its disk is kept; billing stops at the second.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'delete_machine', title: 'Delete a machine', annotations: DEL,
    description: 'Delete a stopped machine and its disk. This cannot be undone.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'usage', title: 'Machine usage', annotations: RO,
    description: 'Machine time in the workspace for a period (default: this month), by machine and by agent, in credits.',
    inputSchema: { type: 'object', properties: { workspace: WS, from: { type: 'string', description: 'ISO date' }, to: { type: 'string', description: 'ISO date' } }, additionalProperties: false } },
  { name: 'budgets', title: 'Machine budgets', annotations: RO,
    description: 'The caps set on this workspace, its divisions and agents: machines, largest size, monthly credits. Only a person can change them.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}) {
  try {
    switch (name) {
      case 'sizes': return ok({ sizes: await compute.sizes(db, actor) });
      case 'list_machines': return ok({ machines: await compute.listMachines(db, actor, a) });
      case 'get_machine': return ok({ machine: await compute.getMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'create_machine': return ok({ machine: await compute.createMachine(db, actor, a) });
      case 'start_machine': return ok({ machine: await compute.startMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'stop_machine': return ok({ machine: await compute.stopMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'delete_machine': return ok({ machine: await compute.deleteMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'usage': return ok({ usage: await compute.usage(db, actor, a) });
      case 'budgets': return ok({ caps: await compute.listCaps(db, actor, a) });
      default: throw new ComputeMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof compute.ComputeError) throw new ComputeMcpError(e.message, e.code);
    throw e;
  }
}
