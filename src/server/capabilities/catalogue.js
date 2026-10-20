/**
 * The XENO platform capability catalogue (SPEC §19.3) — every declaration, one place.
 *
 * Each row is one capability. `bind` names the service row and tool that EXECUTE it, so there is one code path:
 * the generated /api/mcp tool, the grandfathered `tasks_create_task` alias and a person's screen all reach the same
 * service function. `input` is read from the bound tool, never retyped, so the schema cannot drift from the code
 * that parses it. Everything else here — class, cost, permission, idempotency, preview, reply — is the declaration.
 *
 * Adding a capability: add a row, run `npm run catalogue:write`, and decide its parity entry
 * (`npm run parity`). Format and field meanings: ./define.js.
 */
import { defineCapability } from './define.js';
import * as tasksMcp from '../services/tasksMcp.js';
import * as canvasMcp from '../services/canvasMcp.js';
import * as agentsMcp from '../services/agentsMcp.js';
import * as agentMediaMcp from '../services/agentMediaMcp.js';
import * as forumMcp from '../services/forumMcp.js';
import * as placesMcp from '../services/placesMcp.js';
import * as modesMcp from '../services/modesMcp.js';
import { MODES_ROWS } from './modes.js';
import * as storageMcp from '../services/storageMcp.js';
import * as supportMcp from '../services/supportMcp.js';
import * as publishMcp from '../services/publishMcp.js';
import * as analyticsMcp from '../services/analyticsMcp.js';
import * as docsMcp from '../services/docsMcp.js';
import * as workforceMcp from '../services/workforceMcp.js';

/** The tools each bound category executes, by category. */
export const BOUND_TOOLS = Object.freeze({
  tasks: tasksMcp.TOOLS, canvas: canvasMcp.TOOLS, agents: agentsMcp.TOOLS,
  image: agentMediaMcp.IMAGE.tools, video: agentMediaMcp.VIDEO.tools, library: agentMediaMcp.LIBRARY.tools, chat: agentMediaMcp.CHAT.tools,
  forum: forumMcp.TOOLS.map((t) => ({ ...t, name: t.name.replace(/^forum_/, '') })), places: placesMcp.TOOLS, storage: storageMcp.TOOLS, support: supportMcp.TOOLS, publish: publishMcp.TOOLS, analytics: analyticsMcp.TOOLS, docs: docsMcp.TOOLS, modes: modesMcp.TOOLS, workforce: workforceMcp.TOOLS,
});

const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const TASK = { type: 'object', description: 'The task: key (T-n), title, status, priority, people, project, and url (its link).' };
const TASK_REPLY = obj({ task: TASK, guidance: { type: 'string', description: 'Agents only: how this task should be worked (the project’s instructions).' } }, ['task']);
const CANVAS_REPLY = obj({ canvas: { type: 'object', description: 'id, name, revision, project, url, items[] (id, type, x, y, width, height and what it shows), connections[] (id, from, to, link?, label?).' } }, ['canvas']);
const FREE = { model: 'free' };
const NAT = (note) => ({ strategy: 'natural', note });
const NONE = (note) => ({ strategy: 'none', note });
const READ = NAT('reads change nothing');

/** [canonical name, bound category, bound tool, class, extras] */
const ROWS = [
  // ── modes (custom modes + trade packs; rows in ./modes.js)
  ...MODES_ROWS,
  // ── tasks
  ['tasks.project.list', 'tasks', 'list_projects', 'safe', { reply: obj({ projects: { type: 'array', description: 'id, name, area of each project you can work in.' }, hint: { type: 'string', description: 'Set when you have none: what to ask the person for.' } }) }],
  ['tasks.task.list_mine', 'tasks', 'list_my_tasks', 'safe', { reply: obj({ tasks: { type: 'array', description: 'key, title, status, priority, project, url of each open task assigned (person) or delegated (agent) to you.' }, unassigned: { type: 'array', description: 'With a project: up to 50 open tasks nobody holds that you could take.' }, hint: { type: 'string' } }, ['tasks']) }],
  ['tasks.task.get', 'tasks', 'get_task', 'safe', { reply: TASK_REPLY, provenance: 'untrusted' }],
  ['tasks.event.list', 'tasks', 'list_events', 'safe', { reply: obj({ events: { type: 'array', description: 'What you were told, oldest first: type, task key, actor, at.' }, cursor: { type: 'string', description: 'Pass as `after` next time.' } }), provenance: 'untrusted' }],
  ['tasks.task.create', 'tasks', 'create_task', 'undoable', { reply: TASK_REPLY, idempotency: NONE('no request key yet: a retried call raises a second task') }],
  ['tasks.task.claim', 'tasks', 'claim_task', 'undoable', { reply: TASK_REPLY, idempotency: NAT('claiming a task you already hold with the same run_id returns it unchanged') }],
  ['tasks.lease.renew', 'tasks', 'heartbeat', 'undoable', { reply: obj({ leaseExpiresAt: { type: 'string', description: 'When the lease ends without another renewal.' } }), idempotency: NAT('renewing twice only moves the expiry') }],
  ['tasks.lease.release', 'tasks', 'release', 'undoable', { reply: obj({ released: { type: 'boolean', description: 'false when your run held no lease.' }, task: TASK }), idempotency: NAT('releasing a released lease answers released: false') }],
  ['tasks.task.move', 'tasks', 'move_task', 'undoable', { reply: TASK_REPLY, idempotency: NAT('pass `from`: a repeat after it moved is refused rather than applied twice') }],
  ['tasks.comment.create', 'tasks', 'comment', 'undoable', { reply: TASK_REPLY, idempotency: NONE('no request key yet: a retried call posts the comment twice') }],
  ['tasks.activity.report', 'tasks', 'report_activity', 'undoable', { reply: TASK_REPLY, idempotency: NONE('no request key yet: a retried call records the activity twice') }],
  ['tasks.task.update', 'tasks', 'update_task', 'undoable', { reply: TASK_REPLY, idempotency: NAT('setting the same fields again changes nothing') }],
  // ── canvas
  ['canvas.canvas.list', 'canvas', 'list', 'safe', { reply: obj({ canvases: { type: 'array', description: 'id, name, project, updatedAt of each canvas you can see.' } }) }],
  ['canvas.canvas.get', 'canvas', 'get', 'safe', { reply: CANVAS_REPLY, provenance: 'untrusted' }],
  ['canvas.canvas.create', 'canvas', 'create', 'undoable', { reply: CANVAS_REPLY, idempotency: NONE('no request key yet: a retried call starts a second canvas') }],
  ['canvas.item.add', 'canvas', 'add', 'undoable', { reply: obj({ canvas: CANVAS_REPLY.properties.canvas, added: { type: 'array', description: 'The new items’ ids, in the order given.' } }), idempotency: NONE('no request key yet: a retried call adds the items twice') }],
  ['canvas.canvas.open_as', 'canvas', 'open_as', 'undoable', { reply: obj({ canvas: CANVAS_REPLY.properties.canvas, created: { type: 'boolean', description: 'true when this call made the map; false when it already existed.' } }, ['canvas']), idempotency: NAT('opening the same project or division again returns the same canvas') }],
  ['canvas.connection.create', 'canvas', 'connect', 'undoable', { reply: CANVAS_REPLY, idempotency: NONE('no request key yet: a retried call adds a second connection') }],
  ['canvas.item.update', 'canvas', 'update', 'irreversible', { reply: CANVAS_REPLY, idempotency: NAT('moves and edits set absolute values; removing a removed item is a no-op') }],
  // ── places (the building of each workspace; a projection of workforce records, scope-filtered on the server)
  ['places.place.list', 'places', 'list', 'safe', { reply: obj({ items: { type: 'array', description: 'id, name, workspace, city (plot), floors (closed floors carry no name), counts and your access of each building you can enter.' } }, ['items']) }],
  ['places.place.get', 'places', 'get', 'safe', { provenance: 'untrusted', reply: obj({ place: { type: 'object', description: 'The building summary and your access.' }, spec: { type: 'object', description: 'snap (divisions, teams, memberships, principals, runs, closedDivisionIds) and record (the saved layout).' }, access: { type: 'object', description: 'role, permissions (watch talk handoff edit host), scope.' } }, ['place', 'spec', 'access']) }],
  ['places.layout.save', 'places', 'save_layout', 'undoable', { idempotency: { strategy: 'key', key: 'request_key' }, reply: obj({ placeId: { type: 'string' }, placeRevision: { type: 'integer', description: 'The new layout revision.' }, receipt: { type: 'object', description: 'operationId, revision, at; replayed: true when this key was already applied.' } }, ['placeId', 'placeRevision']) }],
  // ── agents (self)
  ['agents.self.get', 'agents', 'whoami', 'safe', { agentsOnly: true, reply: obj({ agent: { type: 'object', description: 'id (agt_), name, handle, status, workspace, division, owner, accountable, projects, budget (null when the division has none).' } }, ['agent']) }],
  // ── studio (media generation)
  ...['image', 'video'].flatMap((t) => [
    [`studio.${t}_model.list`, t, 'list_models', 'safe', { agentsOnly: true, reply: obj({ models: { type: 'array', description: `id, name and the most one ${t} can cost in credits.` } }) }],
    [`studio.${t}.generate`, t, 'generate', 'irreversible', { agentsOnly: true, cost: { model: 'quoted', note: `billed to the owner, counted against the division budget; the price is quoted before it starts` }, idempotency: { strategy: 'key', key: 'request_key' }, reply: obj({ generation: { type: 'object', description: 'id, state (queued|running|awaiting_approval|done|failed), model, cost, files once done.' } }) }],
    [`studio.${t}.get`, t, 'get', 'safe', { agentsOnly: true, reply: obj({ generation: { type: 'object', description: 'id, state, model, cost, files (asset ids, read with library.file.get).' } }) }],
    [`studio.${t}.list`, t, 'list', 'safe', { agentsOnly: true, reply: obj({ items: { type: 'array', description: 'Your recent generations, newest first.' } }) }],
  ]),
  // ── library
  ['library.file.list', 'library', 'list_files', 'safe', { agentsOnly: true, reply: obj({ files: { type: 'array', description: 'asset id, name, type, size, project of each file you can read.' }, folders: { type: 'array', description: 'With `folder`: its sub-folders.' } }) }],
  ['library.file.get', 'library', 'get_file', 'safe', { agentsOnly: true, provenance: 'untrusted', reply: obj({ file: { type: 'object', description: 'details, a link people can open, and `text` when it is a text file (untrusted content).' } }) }],
  ['library.file.attach_to_project', 'library', 'attach_to_project', 'undoable', { agentsOnly: true, idempotency: NAT('attaching an attached file changes nothing'), reply: obj({ attached: { type: 'boolean' }, project: { type: 'string' } }) }],
  // ── chat
  ['chat.model.ask', 'chat', 'ask', 'irreversible', { agentsOnly: true, provenance: 'untrusted', cost: { model: 'metered', note: 'billed to the owner by tokens, counted against the division budget' }, idempotency: NONE('no request key yet: a retried call is billed again'), reply: obj({ answer: { type: 'string', description: 'The model’s reply (untrusted).' }, model: { type: 'string' }, usage: { type: 'object', description: 'tokens and credits charged.' } }) }],
  // ── storage (XENO WORKSPACE AGENT SURFACE - SPEC.md P1: the first division). An agent works in its OWNER'S Storage.
  ['storage.folder.list', 'storage', 'list_folders', 'safe', { reply: obj({ folders: { type: 'array', description: 'id, name, parentId, workspaceId, items, folders of each folder in that place.' } }, ['folders']) }],
  ['storage.folder.create', 'storage', 'create_folder', 'undoable', { idempotency: NAT('a name already used in the same place is refused (folder_exists), so a retry cannot make a second folder'), reply: obj({ folder: { type: 'object', description: 'id, name, parentId, workspaceId.' } }, ['folder']) }],
  ['storage.file.upload', 'storage', 'upload_file', 'undoable', { idempotency: { strategy: 'key', key: 'request_key' }, cost: { model: 'free', note: 'counts against the owner’s storage allowance' }, reply: obj({ file: { type: 'object', description: 'id, name, size, type, folderId, state (quarantined until scanned).' }, replayed: { type: 'boolean', description: 'true when this request_key was already applied.' } }, ['file']) }],
  ['storage.link.create', 'storage', 'create_signin_link', 'undoable', { scope: 'share:create', idempotency: NONE('no request key yet: a retried call makes a second link (each is revocable)'), reply: obj({ link: { type: 'object', description: 'id, folderId, label, expiresAt.' }, url: { type: 'string', description: 'The sign-in link, shown once. Opening it needs a XENO account.' } }, ['link', 'url']) }],
  // ── workforce (XENO-WORKFORCE-01 §11.1 agent.* + division/objective/funding/run; WORKSPACE AGENT SURFACE, after Storage)
  ...[
    ['agent.resource.create', 'resource_create', 'irreversible'], ['agent.resource.create_and_assign', 'resource_create_and_assign', 'irreversible'],
    ['agent.resource.operation_get', 'resource_operation_get', 'safe'], ['agent.resource.get', 'resource_get', 'safe'],
    ['agent.resource.update', 'resource_update', 'irreversible'], ['agent.resource.revision_get', 'resource_revision_get', 'safe'],
    ['agent.catalog.list', 'catalog_list', 'safe'],
    ['run.admission.create', 'admission_create', 'irreversible', { cost: { model: 'quoted', note: 'commits the payer’s budget; the reservation is in the reply' } }],
    ['run.admission.get', 'admission_get', 'safe'], ['run.admission.list', 'admission_list', 'safe'], ['run.admission.operation_get', 'admission_operation_get', 'safe'],
    ['run.pin.get', 'pin_get', 'safe'], ['run.admission.revoke', 'admission_revoke', 'irreversible'], ['run.authority.get', 'authority_get', 'safe'],
    ['division.division.list', 'division_list', 'safe'], ['division.division.get', 'division_get', 'safe'], ['division.division.home', 'division_home', 'safe'], ['division.division.create', 'division_create', 'undoable'],
    ['division.division.update', 'division_update', 'undoable'], ['division.division.archive', 'division_archive', 'irreversible'],
    ['objective.objective.create', 'objective_create', 'undoable'], ['objective.objective.get', 'objective_get', 'safe'], ['objective.objective.update', 'objective_update', 'undoable'],
    ['objective.objective.complete', 'objective_complete', 'irreversible'], ['objective.goal.link', 'objective_link_goal', 'undoable'],
    ['funding.budget.price', 'funding_price', 'safe'], ['funding.budget.propose', 'funding_budget_propose', 'undoable'], ['funding.budget.get', 'funding_budget_get', 'safe'],
    ['funding.offer.get', 'funding_offer_get', 'safe'],
    ['funding.contribution.create', 'funding_contribute', 'irreversible', { cost: { model: 'quoted', note: 'moves the owner’s credits into the project; the amount is in the body' } }],
    ['funding.contribution.get', 'funding_contribution_get', 'safe'], ['funding.contribution.return', 'funding_contribution_return', 'irreversible'],
  ].map(([name, tool, cls, extra = {}]) => [name, 'workforce', tool, cls, { provenance: cls === 'safe' ? 'untrusted' : 'trusted',
    reply: obj({}, undefined), ...(cls === 'safe' ? {} : { idempotency: NAT('the service keys a mutation by its operationId (or its natural target); a repeat reads the same result back') }), ...extra }]),
  // ── publish (XENO Post, server-to-server). Drafts and PROPOSED times only: publish, retract and approve reach an
  //    audience and cannot be taken back, so they are a person's confirmed step on the Publish screen, never a tool.
  ['publish.channel.list', 'publish', 'list_channels', 'safe', { provenance: 'untrusted', reply: obj({ channels: { type: 'array', description: 'id, platform, name, handle, status of each channel.' } }, ['channels']) }],
  ['publish.post.list', 'publish', 'list_posts', 'safe', { provenance: 'untrusted', reply: obj({ posts: { type: 'array', description: 'id, state, text, media count, scheduledFor, targets, proposedFor (a time waiting for a person).' } }, ['posts']) }],
  ['publish.post.draft', 'publish', 'draft_post', 'undoable', { idempotency: { strategy: 'key', key: 'request_key' }, reply: obj({ post: { type: 'object', description: 'The draft: id, state (draft), text, media, targets.' } }, ['post']) }],
  ['publish.post.propose_schedule', 'publish', 'propose_schedule', 'undoable', { idempotency: NAT('one pending proposal per post; proposing again replaces the time'), reply: obj({ needsConfirmation: { type: 'boolean', description: 'Always true: a person confirms before anything is scheduled.' }, confirmationId: { type: 'string' }, proposedFor: { type: 'string' } }, ['needsConfirmation']) }],
  ['publish.approval.list', 'publish', 'list_approvals', 'safe', { provenance: 'untrusted', reply: obj({ items: { type: 'array', description: 'kind (approval|proposal), id, postId, proposedFor, requestedAt.' } }, ['items']) }],
  // ── support (Help ▸ Contact support). Sending a reply to a customer is a person's act: there is no capability for it.
  ['support.ticket.create', 'support', 'create_ticket', 'undoable', { provenance: 'trusted', idempotency: NONE('no request key yet: a retried call raises a second request (rate-limited per hour)'), reply: obj({ ticket: { type: 'object', description: 'key (T-n), kind, title, status, priority, sla, url.' } }, ['ticket']) }],
  ['support.ticket.list', 'support', 'list_tickets', 'safe', { reply: obj({ tickets: { type: 'array', description: 'key, title, kind, status, priority, sla, updatedAt of each request.' } }, ['tickets']) }],
  ['support.ticket.get', 'support', 'get_ticket', 'safe', { provenance: 'untrusted', reply: obj({ ticket: { type: 'object', description: 'The request and its messages (the customer’s words are untrusted); internal notes and drafts only for XENO’s side.' } }, ['ticket']) }],
  ['support.ticket.reply_draft', 'support', 'reply_draft', 'undoable', { idempotency: NONE('no request key yet: a retried call adds a second draft'), reply: obj({ message: { type: 'object', description: 'id, state ("draft" until a person sends it, or "sent" on your owner’s own request), visibility.' } }, ['message']) }],
  ['support.ticket.triage', 'support', 'triage', 'undoable', { idempotency: NAT('setting the same kind and priority again changes nothing'), reply: obj({ ticket: { type: 'object' } }, ['ticket']) }],
  // ── docs (Office › Write and Notes, services/workspaceDocs.js). A document is a Storage file; writes are reversible.
  ['docs.doc.list', 'docs', 'list_docs', 'safe', { provenance: 'untrusted', reply: obj({ docs: { type: 'array', description: 'id, versionId, kind, title, excerpt, updatedAt — written by people.' } }, ['docs']) }],
  ['docs.doc.get', 'docs', 'get_doc', 'safe', { provenance: 'untrusted', reply: obj({ doc: { type: 'object', description: 'id, versionId, kind, title, markdown, canEdit, links.' }, backlinks: { type: 'array', description: 'Documents that link to this one.' } }, ['doc']) }],
  ['docs.doc.create', 'docs', 'create_doc', 'undoable', { idempotency: NAT('each call creates one document; undo with docs.doc.trash'), reply: obj({ doc: { type: 'object' } }, ['doc']) }],
  ['docs.doc.save', 'docs', 'save_doc', 'undoable', { idempotency: { strategy: 'key', key: 'expected_version' }, reply: obj({ doc: { type: 'object' }, previousVersion: { type: 'string', description: 'Restore it to undo this save.' } }, ['doc']) }],
  ['docs.version.list', 'docs', 'list_versions', 'safe', { provenance: 'trusted', reply: obj({ versions: { type: 'array', description: 'id, sizeBytes, createdAt, current.' } }, ['versions']) }],
  ['docs.version.restore', 'docs', 'restore_version', 'undoable', { idempotency: NAT('restoring adds a new newest version; restoring the previous one undoes it'), reply: obj({ doc: { type: 'object' }, previousVersion: { type: 'string' } }, ['doc']) }],
  ['docs.doc.trash', 'docs', 'trash_doc', 'undoable', { idempotency: NAT('a document already in the trash is refused with already_in_trash'), reply: obj({ trashed: { type: 'boolean' }, id: { type: 'string' } }, ['trashed']) }],
  ['docs.doc.untrash', 'docs', 'untrash_doc', 'undoable', { idempotency: NAT('a document not in the trash is refused with not_in_trash'), reply: obj({ doc: { type: 'object' } }, ['doc']) }],
  // ── analytics (Corpo › Analytics, services/analytics.js). Read-only for agents: a person saves dashboards.
  ['analytics.metric.list', 'analytics', 'list_metrics', 'safe', { provenance: 'trusted', reply: obj({ metrics: { type: 'array', description: 'id, title, scope (workspace|division), description of each metric.' }, divisions: { type: 'array', description: 'id, name of the workspace’s active divisions.' } }, ['metrics']) }],
  ['analytics.metric.query', 'analytics', 'query_metric', 'safe', { provenance: 'trusted', reply: obj({ metric: { type: 'string' }, scope: { type: 'string', description: 'workspace or division.' }, days: { type: 'integer' }, value: { type: 'object', description: 'The metric’s value; its shape is the metric’s (series of {day, value}, totals, medians).' } }, ['metric', 'value']) }],
  ['analytics.dashboard.list', 'analytics', 'list_dashboards', 'safe', { provenance: 'untrusted', reply: obj({ dashboards: { type: 'array', description: 'id, name, widgets [{metric, days}] — names are written by people.' } }, ['dashboards']) }],
  // ── forum (also served by its own MCP at /api/forum/mcp, kept until no client calls it — SPEC §19.3 rule 5)
  ...[
    ['forum.thread.search', 'forum_search', 'safe'], ['forum.thread.get', 'forum_get_thread', 'safe'], ['forum.thread.suggest_duplicate', 'forum_suggest_duplicate', 'safe'],
    ['forum.thread.create', 'forum_create_thread', 'undoable'], ['forum.post.reply', 'forum_reply', 'undoable'], ['forum.subscription.create', 'forum_subscribe', 'undoable'],
    ['forum.digest.get', 'forum_digest', 'safe'], ['forum.post.flag', 'forum_flag', 'undoable'], ['forum.thread.mark_fixed', 'forum_mark_fixed', 'undoable'],
  ].map(([name, tool, cls]) => [name, 'forum', tool.replace(/^forum_/, ''), cls, { surfaces: ['mcp', 'rest', 'forum-mcp'], provenance: cls === 'safe' ? 'untrusted' : 'trusted', reply: obj({ result: { type: 'object', description: 'The forum record the tool returns, with its citable url.' } }), ...(cls === 'safe' ? {} : { idempotency: NONE('no request key yet') }) }]),
];

function build([name, category, tool, cls, extra = {}]) {
  const bound = (BOUND_TOOLS[category] || []).find((t) => t.name === tool);
  if (!bound) throw new Error(`catalogue: ${name} binds ${category}/${tool}, which does not exist`);
  return defineCapability({
    name, version: '1.0.0', division: name.split('.')[0], title: bound.title || bound.name, description: bound.description,
    input: bound.inputSchema, class: cls, cost: FREE, idempotency: cls === 'safe' ? READ : NONE('not declared'),
    aliases: [`${category}_${tool}`], bind: { category, tool }, ...extra,
  });
}

export const CATALOGUE = Object.freeze(ROWS.map(build));
export const byName = new Map(CATALOGUE.map((c) => [c.name, c]));
/** Declarations generated into /api/mcp, by bound category. */
export const restCapabilities = () => CATALOGUE.filter((c) => c.surfaces.includes('rest'));
export const mcpCapabilities = (category) => CATALOGUE.filter((c) => c.surfaces.includes('mcp') && c.bind.category === category);
