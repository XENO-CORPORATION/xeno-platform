/**
 * Catalogue rows for People (services/peopleMcp.js → services/workforcePeople.js). Format: catalogue.js ROWS.
 * Reads are safe for agents. The two HR writes are declared so a person's own client can call them; the service
 * refuses any agent principal (`human_only`), the same rule as modes.mode.apply.
 */
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const PERSON = { type: 'object', description: 'id, kind (human|agent), name, handle, role, title, division, team, managerId, startDate, endDate, location, timezone, workingHours, availability {available, reason}, private (null unless you are the person, an admin or their manager).' };

export const PEOPLE_ROWS = [
  ['people.person.list', 'people', 'directory', 'safe', { scope: 'workspace:read', provenance: 'untrusted', reply: obj({ people: { type: 'array', description: 'Each person, as in people.person.get.' }, canManage: { type: 'boolean' } }, ['people']) }],
  ['people.person.get', 'people', 'get', 'safe', { scope: 'workspace:read', provenance: 'untrusted', reply: obj({ person: PERSON, managerChain: { type: 'array' }, reports: { type: 'array' } }, ['person']) }],
  ['people.org.chart', 'people', 'org_chart', 'safe', { scope: 'workspace:read', reply: obj({ nodes: { type: 'array' }, roots: { type: 'array' }, reportsOf: { type: 'object' } }, ['nodes', 'roots']) }],
  ['people.work.mine', 'people', 'my_work', 'safe', { scope: 'workspace:read', provenance: 'untrusted', reply: obj({ tasks: { type: 'array' }, approvals: { type: 'array' }, runs: { type: 'array' }, assignments: { type: 'array' }, reports: { type: 'array' } }, ['tasks']) }],
  ['people.person.update', 'people', 'update_profile', 'undoable', { scope: 'workspace:admin', idempotency: { strategy: 'natural', note: 'setting the same fields again changes nothing; pass expected_revision to refuse a stale write' }, reply: obj({ person: PERSON }, ['person']) }],
  ['people.time_off.create', 'people', 'add_time_off', 'undoable', { scope: 'workspace:admin', idempotency: { strategy: 'none', note: 'no request key yet: a retried call books it twice (cancel one)' }, reply: obj({ id: { type: 'string' }, startsAt: { type: 'string' }, endsAt: { type: 'string' }, kind: { type: 'string' } }, ['id']) }],
];
