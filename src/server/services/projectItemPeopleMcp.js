/**
 * XENO MCP rows for who is on a project item: an agent reads and sets the person responsible for a file, a chat or a
 * picture in a project, through services/projectItemPeople.js — the same code the screen and the canvas use, so the same
 * rules hold (project editor sets it, the person must see the project, off unless PROJECT_ITEM_PEOPLE=true). An agent
 * acts for its person and never above them.
 */
import * as people from './projectItemPeople.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const ITEM = {
  project: { type: 'string', description: 'The project id (see tasks_list_projects).' },
  kind: { type: 'string', enum: ['file', 'chat', 'generation'], description: 'file (a Library file or document, any of its version ids), chat (a conversation), generation (a picture or video being made).' },
  item: { type: 'string', description: 'The file, conversation or generation id. On a canvas, canvas_get shows it on each item.' },
};

export const TOOLS = [
  { name: 'item_people', title: 'Who is on a project item', annotations: RO,
    description: 'Who is responsible for a file, a chat or a picture in a project, and who was before. Tasks keep their own assignee (tasks_get_task).',
    inputSchema: { type: 'object', required: ['project', 'kind', 'item'], properties: ITEM } },
  { name: 'set_item_person', title: 'Put someone on a project item', annotations: RW,
    description: 'Say who is responsible for a file, a chat or a picture in a project (one person; whoever was on it is replaced, and kept in its history). `person` null clears it. You must be able to edit the project; the person must already see it — share the project with them first. They are told.',
    inputSchema: { type: 'object', required: ['project', 'kind', 'item', 'person'], properties: { ...ITEM, person: { type: ['string', 'null'], description: 'A user id (a person or an agent), or null to clear.' } } } },
];

export async function callTool(db, actor, name, a = {}) {
  const at = { projectId: a.project, kind: a.kind, itemId: a.item };
  switch (name) {
    case 'item_people': return ok(await people.itemPeople(db, actor, at));
    case 'set_item_person': return ok(await people.setPerson(db, actor, { ...at, principalId: a.person ?? null }));
    default: throw new people.ItemPeopleError(`Unknown tool ${name}`, 'unknown_tool', 404);
  }
}
