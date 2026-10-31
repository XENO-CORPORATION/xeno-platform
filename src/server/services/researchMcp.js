/**
 * XENO MCP rows for XENO Research (services/xenoResearch.js, the same service as REST and the Research mode).
 * Reads see what the person sees. A run executes in XENO Box and is refused -- with the reason -- when Box is not
 * configured or not qualified for this workspace. Claiming a cell writes a Corpus tenet, which only a PERSON may do
 * (an agent's call is refused by Corpus); re-checking needs a run admission of the person accountable.
 */
import * as research from './xenoResearch.js';
import { CorpusError } from './xenoCorpus.js';

const RO = { readOnlyHint: true, openWorldHint: false };
const RUN = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const PROJECT = { type: 'string', description: 'The project id (UUID).' };
const NOTEBOOK = { type: 'string', description: 'The notebook id (nb_…).' };
const RUN_ID = { type: 'string', description: 'The research run id (rr_…).' };

export class ResearchMcpError extends Error { constructor(message, code) { super(message); this.code = code; } }

export const TOOLS = [
  { name: 'home', title: 'Research overview', annotations: RO,
    description: 'Recent notebooks, runs needing attention (failed, refused, changed, not reproduced, still running) and claims that do not currently hold, across the projects you can see.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'notebooks', title: 'List a project’s notebooks', annotations: RO,
    description: 'The research notebooks of a project, each with whether its environment is locked and its last run.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: PROJECT } } },
  { name: 'notebook', title: 'Read a notebook', annotations: RO,
    description: 'A notebook’s cells with the outputs of its latest finished run, whether its lock is stale, and its runs.',
    inputSchema: { type: 'object', required: ['notebook'], properties: { notebook: NOTEBOOK } } },
  { name: 'run', title: 'Run a notebook in XENO Box', annotations: RUN,
    description: 'Queue a run of the notebook in XENO Box (no network while it runs; the environment is rebuilt from its lock). It is asynchronous: read it with run_get. Refused, with the reason, when Box is not configured or not qualified for this workspace.',
    inputSchema: { type: 'object', required: ['notebook'], properties: { notebook: NOTEBOOK } } },
  { name: 'verify', title: 'Re-run and compare', annotations: RUN,
    description: 'Re-run a finished run in XENO Box and compare: reproduced, changed (with what moved: code, inputs, environment) or not-reproduced (same everything, different answer). Asynchronous.',
    inputSchema: { type: 'object', required: ['run'], properties: { run: RUN_ID } } },
  { name: 'run_get', title: 'Read a run', annotations: RO,
    description: 'A research run: status, per-cell status and output hashes, verdict for a verify, the refusal or failure reason, and its Ed25519 signature checked now.',
    inputSchema: { type: 'object', required: ['run'], properties: { run: RUN_ID } } },
  { name: 'claims', title: 'List a project’s claims', annotations: RO,
    description: 'The project’s claimed cells (each a Corpus tenet) and whether each holds, lapsed or is unobserved. Unobserved is never passing.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: PROJECT } } },
];

async function run(fn) {
  try { return ok(await fn()); } catch (e) {
    if (e instanceof research.ResearchError || e instanceof CorpusError) throw new ResearchMcpError(e.message, e.code);
    throw e;
  }
}

export async function callTool(db, actor, name, a = {}) {
  const me = { id: actor.id };
  switch (name) {
    case 'home': return run(() => research.home(db, me));
    case 'notebooks': return run(() => research.listNotebooks(db, me, a.project));
    case 'notebook': return run(() => research.getNotebook(db, me, a.notebook));
    case 'run': return run(() => research.requestRun(db, me, a.notebook));
    case 'verify': return run(() => research.requestVerify(db, me, a.run));
    case 'run_get': return run(() => research.getRun(db, me, a.run));
    case 'claims': return run(() => research.listClaims(db, me, a.project));
    default: throw new ResearchMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
