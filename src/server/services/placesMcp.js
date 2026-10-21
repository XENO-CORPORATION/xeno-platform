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
      layout: { type: 'object', description: '{ bays?, style?, slots?: {membershipId: n}, pods?: {teamId: {x0, zc}}, fixtures?: {floorKey: [{kind, x, z, w?, d?, h?, rot?, label?, id?}]}, removed?: {floorKey: [fixtureId]} } — floorKey is a division id or "lobby"; metres.' } } } },
  { name: 'explore', title: 'Explore public places', annotations: RO,
    description: 'Public buildings anyone signed in may watch (as a visitor: watch only, no talk or edit). Floors outside your scope stay nameless.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'sessions', title: 'List live sessions', annotations: RO,
    description: 'Live hosted sessions you host, are invited to, have joined, or that are public. The code is shown only to the host.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'resolve_session', title: 'Look up a session code', annotations: RO,
    description: 'What a session code (or a link with ?session=) opens — place, host, floors shown, permissions — before you join it.',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string', description: 'ABCD-EF23, PLC-ABCD-EF23 or a link.' } } } },
  { name: 'join_session', title: 'Join a hosted session', annotations: RW,
    description: 'Join a live session with its code. A session only NARROWS: you see only the floors the host opened, with only watch/talk/handoff as granted.',
    inputSchema: { type: 'object', required: ['code', 'request_key'], properties: { code: { type: 'string' }, request_key: { type: 'string', description: '8–128 characters.' } } } },
  { name: 'invites', title: 'List my invitations', annotations: RO,
    description: 'Pending workspace invitations addressed to you.', inputSchema: { type: 'object', properties: {} } },
  { name: 'receipts', title: 'My recent Places changes', annotations: RO,
    description: 'The receipts of your last twelve Places changes (operation id, op, revision, time).', inputSchema: { type: 'object', properties: {} } },
  { name: 'needs', title: 'What needs you', annotations: RO,
    description: 'Tasks waiting on you: reviews you owe and blocked work of yours or your agents. Act on them with the Tasks tools.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'workforce', title: 'Workforce catalog', annotations: RO,
    description: 'Agents you own or manage, where each has a desk, and desk offers waiting for your decision (agents lent to buildings you administer).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'marketplace', title: 'Rentable agents and teams', annotations: RO,
    description: 'Marketplace agents and teams for rent, with the price per period and whether you already hold a rental.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'funding', title: 'Credits and budgets', annotations: RO,
    description: 'Your available credits, recent account history, and the monthly budget (approved ceiling and any proposal) of each building you administer.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'city', title: 'Read a XENO city', annotations: RO,
    description: 'A XENO city: districts, lots (leased or for lease, monthly price), the buildings standing on them with their facades, sponsor slots (always labelled Sponsored), your bookings and buildings not yet placed. Land is leased monthly, never sold.',
    inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'A city id (meridian, halcyon, lindgren, …); default: where your building stands.' } } } },
  { name: 'world', title: 'Read the XENO planet', annotations: RO,
    description: 'Polis: continents, real-geography regions (open · opening soon · opens on demand · locked) with real pledge counts, and XENO cities with their buildings, free lots and waitlists.',
    inputSchema: { type: 'object', properties: {} } },
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
    case 'explore': return ok(await run(db, actor, 'places.explore', {}));
    case 'sessions': return ok(await run(db, actor, 'sessions.list', {}));
    case 'resolve_session': return ok(await run(db, actor, 'sessions.resolve', { code: a.code }));
    case 'join_session': return ok(await run(db, actor, 'sessions.join', { code: a.code, requestId: a.request_key }));
    case 'invites': return ok(await run(db, actor, 'invites.list', {}));
    case 'receipts': return ok(await run(db, actor, 'receipts.list', {}));
    case 'needs': return ok(await run(db, actor, 'needs.list', {}));
    case 'workforce': return ok(await run(db, actor, 'workforce.catalog.list', {}));
    case 'marketplace': return ok(await run(db, actor, 'marketplace.list', {}));
    case 'funding': return ok(await run(db, actor, 'funding.get', {}));
    case 'city': return ok(await run(db, actor, 'city.get', a.city ? { cityId: a.city } : {}));
    case 'world': return ok(await run(db, actor, 'world.get', {}));
    default: throw new PlacesMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}
