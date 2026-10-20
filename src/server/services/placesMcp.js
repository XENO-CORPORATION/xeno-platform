/**
 * XENO MCP rows for Places: an agent can see the buildings it may enter and read one — floors (divisions), pods
 * (teams), desks (memberships), who sits where and what their monitors show — already filtered to its own scope, and
 * an admin's agent can save a layout. Every tool calls services/places.js `call`, the same code path as the screen.
 */
import * as places from './places.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const PLACE = { type: 'string', description: 'A place id (see places_list).' };

export class PlacesMcpError extends Error { constructor(message, code) { super(message); this.code = code; } }

export const TOOLS = [
  { name: 'list', title: 'List places', annotations: RO,
    description: 'The buildings you can enter: one per workspace you belong to (your own personal workspace’s included) and any you joined as a guest. Each has its city, floors (closed floors have no name) and counts. Use places_get to read one.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'get', title: 'Read a place', annotations: RO,
    description: 'One building as you are allowed to see it: floors = divisions, pods = teams, desks = team memberships, occupants with whether each is an agent, live runs on the monitors, and the saved layout. Floors outside your scope arrive as ids with no name. Do not use it to change who sits where: that is a workforce membership change, not a layout.',
    inputSchema: { type: 'object', required: ['place'], properties: { place: PLACE } } },
  { name: 'save_layout', title: 'Save a building layout', annotations: RW,
    description: 'Save a building’s layout — bays (4–8), style, desk slot per membership, pod positions and fixtures per floor. Coordinates only: it never moves anyone between teams. Owners and admins only; pass the revision you read (expected_revision) and a request_key so a retry is answered, not applied twice.',
    inputSchema: { type: 'object', required: ['place', 'layout', 'expected_revision', 'request_key'], properties: {
      place: PLACE, expected_revision: { type: 'integer', description: 'The layout revision you read (place.revision).' },
      request_key: { type: 'string', description: 'Your own key for this change, 8–128 characters.' },
      layout: { type: 'object', description: '{ bays?, style?, slots?: {membershipId: n}, pods?: {teamId: {x, z, level?}}, fixtures?: {level: [{kind, x, z, rot?}]} }' } } } },
];

async function run(db, actor, op, input) {
  const r = await places.call(db, { id: actor.id, kind: actor.kind, name: actor.name }, op, input);
  if (!r.ok) throw new PlacesMcpError(r.error.message, r.error.reason);
  return { ...r.result, ...(r.receipt ? { receipt: r.receipt } : {}) };
}

export async function callTool(db, actor, name, a = {}) {
  switch (name) {
    case 'list': return ok(await run(db, actor, 'places.list', {}));
    case 'get': return ok(await run(db, actor, 'places.get', { placeId: a.place }));
    case 'save_layout': return ok(await run(db, actor, 'places.layout.save', { placeId: a.place, layout: a.layout, expectedRevision: a.expected_revision, requestId: a.request_key }));
    default: throw new PlacesMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
