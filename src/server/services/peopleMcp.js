/**
 * XENO MCP rows for People (services/workforcePeople.js) — the same code path as /api/people and the People screen.
 * An agent READS: the directory, a profile (public fields; private ones only about itself), the org chart, its own
 * work and whether someone is available. Every HR change (profile, time off, onboarding, offboarding) is a person's
 * act: the service refuses an agent principal with `human_only` / `admin_required`, whatever client it calls from.
 */
import * as people from './workforcePeople.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The workspace id (a UUID).' };
const WHO = { type: 'string', description: 'The person or agent (its user id, a UUID).' };

export class PeopleMcpError extends Error { constructor(message, code) { super(message); this.code = code; } }

export const TOOLS = [
  { name: 'directory', title: 'People directory', annotations: RO,
    description: 'Everyone in a workspace — people and agents — with title, division, team, manager, location, time zone and whether they are available now. Search with q.',
    inputSchema: { type: 'object', required: ['workspace'], properties: { workspace: WS, q: { type: 'string', description: 'Matches name, handle, title or location.' }, division: { type: 'string' }, team: { type: 'string' }, kind: { type: 'string', enum: ['human', 'agent'] } } } },
  { name: 'get', title: 'A person’s profile', annotations: RO,
    description: 'One profile, their manager chain and their reports. Private fields (contact, notes, time-off notes) are returned only to the person, an admin or a manager above them; otherwise `private` is null.',
    inputSchema: { type: 'object', required: ['workspace', 'person'], properties: { workspace: WS, person: WHO } } },
  { name: 'org_chart', title: 'Org chart', annotations: RO,
    description: 'The reporting lines of a workspace: nodes (people and agents), roots and who reports to whom.',
    inputSchema: { type: 'object', required: ['workspace'], properties: { workspace: WS } } },
  { name: 'my_work', title: 'My work', annotations: RO,
    description: 'Your own open tasks, reviews waiting on you, recent runs, assignments and reports in this workspace.',
    inputSchema: { type: 'object', required: ['workspace'], properties: { workspace: WS } } },
  { name: 'update_profile', title: 'Change an employee record', annotations: RW,
    description: 'Change a profile. People only: an agent is refused (human_only). Title, division, team, manager and dates need a workspace admin.',
    inputSchema: { type: 'object', required: ['workspace', 'person'], properties: { workspace: WS, person: WHO, fields: { type: 'object', description: 'title, divisionId, teamId, managerId, startDate, endDate, location, timezone, workingHours {days,start,end}, privatePhone, emergencyContact, privateNotes.' }, expected_revision: { type: 'integer' } } } },
  { name: 'add_time_off', title: 'Book time off', annotations: RW,
    description: 'Book time off. People only: an agent is refused (human_only).',
    inputSchema: { type: 'object', required: ['workspace', 'starts_at', 'ends_at'], properties: { workspace: WS, person: WHO, starts_at: { type: 'string' }, ends_at: { type: 'string' }, kind: { type: 'string', enum: ['vacation', 'sick', 'leave', 'holiday', 'other'] }, note: { type: 'string' } } } },
];

async function run(fn) {
  try { return ok(await fn()); } catch (e) { if (e instanceof people.PeopleError) throw new PeopleMcpError(e.message, e.code); throw e; }
}

export async function callTool(db, actor, name, a = {}) {
  const me = { id: actor.id };
  switch (name) {
    case 'directory': return run(() => people.directory(db, me, { workspaceId: a.workspace, q: a.q, divisionId: a.division, teamId: a.team, kind: a.kind }));
    case 'get': return run(() => people.getPerson(db, me, { workspaceId: a.workspace, principalId: a.person }));
    case 'org_chart': return run(() => people.orgChart(db, me, { workspaceId: a.workspace }));
    case 'my_work': return run(() => people.myWork(db, me, { workspaceId: a.workspace }));
    case 'update_profile': return run(() => people.updateProfile(db, me, { workspaceId: a.workspace, principalId: a.person, expectedRevision: a.expected_revision, ...(a.fields && typeof a.fields === 'object' ? a.fields : {}) }));
    case 'add_time_off': return run(() => people.addTimeOff(db, me, { workspaceId: a.workspace, principalId: a.person, startsAt: a.starts_at, endsAt: a.ends_at, kind: a.kind, note: a.note }));
    default: throw new PeopleMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
