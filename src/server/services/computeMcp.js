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
const IDLE = { type: ['integer', 'null'], minimum: 5, maximum: 1440, description: 'Stop by itself after this many minutes with no command or file call (default 30). null = never; a server you start in the background is not seen as use.' };

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
    inputSchema: { type: 'object', required: ['name', 'size'], properties: { workspace: WS, name: { type: 'string' }, size: { type: 'string' }, purpose: { type: 'string' }, image: { type: 'string' }, idempotencyKey: { type: 'string' }, idleStopMinutes: IDLE }, additionalProperties: false } },
  { name: 'start_machine', title: 'Start a machine', annotations: RW,
    description: 'Start a machine. An hour is reserved on your owner’s credits and settled for the time used. Refused when the size is not priced, a cap would be exceeded, or the credits cannot cover the next hour.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'stop_machine', title: 'Stop a machine', annotations: RW,
    description: 'Stop a machine. Billing stops at the second. The home folder (/home/xeno, where relative paths go) is saved and put back on the next start; anything outside it, and running programs, are not kept.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'run_agent_task', title: 'Run a XENO Agent task on a machine', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: 'Have the XENO Agent do one task on a running machine and wait for it (up to 30 minutes). It works in a folder in the home folder (default "work"), which is kept across stops. access "listed" (default) lets it read and edit files and run only the listed commands; "full" turns permission checks off on that machine. Model use is billed to your owner’s credits.',
    inputSchema: { type: 'object', required: ['machineId', 'prompt'], properties: { workspace: WS, machineId: MID, prompt: { type: 'string', maxLength: 20000 }, access: { type: 'string', enum: ['listed', 'full'] }, commands: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 }, description: 'listed access only: command patterns it may run, like "python3 *" (default: python3, pip install, node, npm, npx, git, ls, cat, mkdir, pytest).' }, model: { type: 'string' }, folder: { type: 'string' }, timeoutMinutes: { type: 'integer', minimum: 1, maximum: 30 }, maxCredits: { type: 'number', exclusiveMinimum: 0 } }, additionalProperties: false } },
  { name: 'set_idle_stop', title: 'Set when a machine stops itself', annotations: RW,
    description: 'Set how many minutes a running machine may go without a command or file call before it stops itself and billing ends (5..1440), or null to never. Turn it off before leaving a background server running.',
    inputSchema: { type: 'object', required: ['machineId', 'idleStopMinutes'], properties: { workspace: WS, machineId: MID, idleStopMinutes: IDLE }, additionalProperties: false } },
  { name: 'delete_machine', title: 'Delete a machine', annotations: DEL,
    description: 'Delete a stopped machine and its disk. This cannot be undone.',
    inputSchema: { type: 'object', required: ['machineId'], properties: { workspace: WS, machineId: MID }, additionalProperties: false } },
  { name: 'exec', title: 'Run a command on a machine', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: 'Run one program on a running machine that works for you and wait for it: exit code, stdout and stderr (each up to 1 MB). argv is the program and its arguments, not a shell line; use ["sh","-c","…"] for shell syntax. timeoutMs defaults to 60000, at most 1800000.',
    inputSchema: { type: 'object', required: ['machineId', 'argv'], properties: { workspace: WS, machineId: MID, argv: { type: 'array', items: { type: 'string' }, minItems: 1 }, cwd: { type: 'string', description: 'Working folder; relative paths are from the home folder.' }, stdin: { type: 'string' }, env: { type: 'object', additionalProperties: { type: 'string' } }, timeoutMs: { type: 'integer', minimum: 1, maximum: 1800000 } }, additionalProperties: false } },
  { name: 'read_file', title: 'Read a file on a machine', annotations: RO,
    description: 'Read a file from a running machine (up to 25 MB). Text comes back as text; anything else as base64.',
    inputSchema: { type: 'object', required: ['machineId', 'path'], properties: { workspace: WS, machineId: MID, path: { type: 'string' } }, additionalProperties: false } },
  { name: 'write_file', title: 'Write a file on a machine', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Write a file on a running machine (up to 25 MB), creating folders as needed and replacing what was there. Pass text in content, or bytes in contentBase64.',
    inputSchema: { type: 'object', required: ['machineId', 'path'], properties: { workspace: WS, machineId: MID, path: { type: 'string' }, content: { type: 'string' }, contentBase64: { type: 'string' } }, additionalProperties: false } },
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
      case 'run_agent_task': return ok({ result: await compute.runAgentTask(db, actor, a.machineId, a) });
      case 'set_idle_stop': return ok({ machine: await compute.setIdleStop(db, actor, a.machineId, { idleStopMinutes: a.idleStopMinutes, workspace: a.workspace }) });
      case 'stop_machine': return ok({ machine: await compute.stopMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'delete_machine': return ok({ machine: await compute.deleteMachine(db, actor, a.machineId, { workspace: a.workspace }) });
      case 'exec': return ok({ result: await compute.execMachine(db, actor, a.machineId, a) });
      case 'read_file': {
        const buf = await compute.readMachineFile(db, actor, a.machineId, a);
        const text = buf.toString('utf8');
        return ok(Buffer.from(text, 'utf8').equals(buf) ? { path: a.path, bytes: buf.length, content: text } : { path: a.path, bytes: buf.length, contentBase64: buf.toString('base64') });
      }
      case 'write_file': return ok({ file: await compute.writeMachineFile(db, actor, a.machineId, { ...a, content: a.contentBase64 != null ? Buffer.from(a.contentBase64, 'base64') : a.content }) });
      case 'usage': return ok({ usage: await compute.usage(db, actor, a) });
      case 'budgets': return ok({ caps: await compute.listCaps(db, actor, a) });
      default: throw new ComputeMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof compute.ComputeError) throw new ComputeMcpError(e.message, e.code);
    throw e;
  }
}
