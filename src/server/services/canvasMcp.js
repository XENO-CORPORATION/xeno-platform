/**
 * XENO MCP rows for Canvases: an agent can lay work out on a canvas — read one, start one, put tasks and notes on
 * it, connect them, move them. Every tool calls services/canvases.js, the same code path as the screen, so the same
 * rights (project viewer reads, editor changes) and the same revision check apply. An edge between two tasks marked
 * as a link becomes a real task link, through Tasks' own rules.
 *
 * Edits are read-modify-write with the canvas revision: if a person moved something meanwhile, the save is refused
 * (canvas_changed) and the tool re-reads once and applies the same edit to the newer canvas, so an agent never
 * overwrites a person's work and never has to handle the race itself.
 */
import crypto from 'node:crypto';
import * as canvases from './canvases.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const nid = () => crypto.randomBytes(5).toString('hex');
const CANVAS = { type: 'string', description: 'A canvas id (see canvas_list).' };

/** What an agent reads: each item with what it is and what it shows, task titles and status read live. */
export function view(cv) {
  const t = cv.records.tasks || {};
  const items = cv.content.nodes.map((n) => ({
    id: n.id, type: n.type === 'xeno-ref' ? n.ref.kind : n.type, x: n.x, y: n.y, width: n.width, height: n.height,
    ...(n.type === 'xeno-ref' && n.ref.kind === 'task' ? { task: n.ref.id, ...(t[n.ref.id] && !t[n.ref.id].missing ? { title: t[n.ref.id].title, status: t[n.ref.id].status } : { missing: true }) } : {}),
    ...(n.type === 'xeno-ref' && n.ref.kind === 'file' ? { file: n.ref.id, ...((cv.records.files || {})[n.ref.id] || { missing: true }) } : {}),
    ...(n.type === 'xeno-ref' && n.ref.kind === 'chat' ? { chat: n.ref.id, ...((cv.records.chats || {})[n.ref.id] || { missing: true }) } : {}),
    ...(n.type === 'xeno-ref' && ['project', 'division', 'objective', 'run', 'tenet'].includes(n.ref.kind) ? { [n.ref.kind]: n.ref.id, ...((cv.records[n.ref.kind + 's'] || {})[n.ref.id] || { missing: true }) } : {}),
    ...(n.type === 'text' ? { text: n.text } : {}), ...(n.type === 'link' ? { url: n.url } : {}), ...(n.type === 'group' ? { label: n.label } : {}),
  }));
  const connections = cv.content.edges.map((e) => ({ id: e.id, from: e.fromNode, to: e.toNode, ...(e.xeno?.link ? { link: e.xeno.link } : {}), ...(e.label ? { label: e.label } : {}) }));
  return { id: cv.id, name: cv.name, revision: cv.revision, project: cv.project, url: `/workspace/tasks/canvas/${cv.id}`, items, connections };
}

/** Apply an edit to the CURRENT canvas; on a concurrent change, re-read and apply it once more. */
async function edit(db, actor, id, change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cv = await canvases.getCanvas(db, actor, id);
    const content = structuredClone(cv.content);
    const extra = change(content, cv) || {};
    try { return { canvas: view(await canvases.saveCanvas(db, actor, id, { content, revision: cv.revision })), ...extra }; }
    catch (e) { if (attempt === 0 && e instanceof canvases.CanvasError && e.code === 'canvas_changed') continue; throw e; }
  }
  throw new canvases.CanvasError('The canvas kept changing; try again', 'canvas_changed', 409);
}
/** The next free spot to the right of everything already on the canvas, so new items never land on old ones. */
function nextSpot(content, i) {
  const right = content.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const top = content.nodes.length ? Math.min(...content.nodes.map((n) => n.y)) : 0;
  return { x: (content.nodes.length ? right + 80 : 0) + (i % 4) * 300, y: top + Math.floor(i / 4) * 170 };
}

export const TOOLS = [
  { name: 'list', title: 'List canvases', annotations: RO, description: 'The canvases you can see: yours, and those on projects you are on. With `project`, only that project’s.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } } },
  { name: 'get', title: 'Read a canvas', annotations: RO, description: 'A canvas: every item (task cards with their live title and status, notes, links, groups) with its position, and the connections between items.',
    inputSchema: { type: 'object', required: ['canvas'], properties: { canvas: CANVAS } } },
  { name: 'create', title: 'Start a canvas', annotations: RW, description: 'Start a canvas. With `project`, everyone on the project sees it (you must be able to edit the project); without, it is yours alone.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, project: { type: 'string' } } } },
  { name: 'add', title: 'Put items on a canvas', annotations: RW,
    description: 'Put items on a canvas: tasks (by key, e.g. T-12 — the card always shows the task as it is now), Library files, chats, projects, divisions, objectives, runs and Corpus tenets (by id, also live; a tenet card shows its latest signed verdict — a card shows the record’s status now; a canvas never changes the record), notes (markdown), links and groups. Without x/y they are laid out to the right of what is there. Returns each new item’s id.',
    inputSchema: { type: 'object', required: ['canvas', 'items'], properties: { canvas: CANVAS, items: { type: 'array', items: { type: 'object', required: ['type'], properties: {
      type: { type: 'string', enum: ['task', 'file', 'chat', 'project', 'division', 'objective', 'run', 'tenet', 'note', 'link', 'group'] },
      project: { type: 'string', description: 'For a project card: its id.' }, division: { type: 'string', description: 'For a division card: its id.' },
      objective: { type: 'string', description: 'For an objective card: its id.' }, run: { type: 'string', description: 'For a run card: its admission id.' }, tenet: { type: 'string', description: 'For a verdict card: a Corpus tenet id (see corpus_query).' }, task: { type: 'string', description: 'For a task card: its key, e.g. T-12.' },
      file: { type: 'string', description: 'For a file card: a Library file id (see library_list_files).' }, chat: { type: 'string', description: 'For a chat card: a conversation id.' },
      text: { type: 'string', description: 'For a note: markdown.' }, url: { type: 'string', description: 'For a link.' }, label: { type: 'string', description: 'For a group.' },
      x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } } } } } },
  { name: 'open_as', title: 'Open a project or division as a canvas', annotations: RW,
    description: 'Lay a project (its objectives, tasks, conversations and active runs) or a division (what is inside it, its objectives, projects and active runs) out on a canvas. Opening it again returns the same canvas. A division’s map holds only what you may see.',
    inputSchema: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['project', 'division'] }, id: { type: 'string', description: 'The project or division id.' } } } },
  { name: 'connect', title: 'Connect two items', annotations: RW,
    description: 'Draw a connection between two items. Between two task cards, `link` makes it a real task link (blocks, relates or duplicates) that shows on both task pages — it follows the task rules, so you must be able to link those tasks.',
    inputSchema: { type: 'object', required: ['canvas', 'from', 'to'], properties: { canvas: CANVAS, from: { type: 'string', description: 'An item id.' }, to: { type: 'string', description: 'An item id.' },
      link: { type: 'string', enum: ['blocks', 'relates', 'duplicates'] }, label: { type: 'string' } } } },
  { name: 'update', title: 'Move, edit or remove items', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Move or resize items, change a note’s text or a group’s label, or remove items or connections from the canvas. Removing a task card never deletes the task.',
    inputSchema: { type: 'object', required: ['canvas'], properties: { canvas: CANVAS,
      items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, text: { type: 'string' }, label: { type: 'string' } } } },
      remove: { type: 'array', items: { type: 'string' }, description: 'Item or connection ids to take off the canvas.' } } } },
];

export async function callTool(db, actor, name, a = {}) {
  switch (name) {
    case 'list': return ok({ canvases: await canvases.listCanvases(db, actor, { projectId: a.project }) });
    case 'get': return ok(view(await canvases.getCanvas(db, actor, a.canvas)));
    case 'create': return ok(view(await canvases.createCanvas(db, actor, { name: a.name, projectId: a.project })));
    case 'open_as': { const r = await canvases.openAsCanvas(db, actor, { kind: a.kind, id: a.id }); return ok({ canvas: view(r.canvas), created: r.created }); }
    case 'add': {
      if (!Array.isArray(a.items) || !a.items.length) throw new canvases.CanvasError('Give at least one item', 'invalid_content');
      return ok(await edit(db, actor, a.canvas, (content) => {
        const ids = [];
        a.items.slice(0, 200).forEach((it, i) => {
          const at = it.x != null && it.y != null ? { x: it.x, y: it.y } : nextSpot(content, i), id = nid();
          const base = { id, x: at.x, y: at.y };
          if (it.type === 'task') content.nodes.push({ ...base, type: 'xeno-ref', ref: { kind: 'task', id: String(it.task || '') }, width: it.width || 260, height: it.height || 120 });
          else if (['file', 'chat', 'project', 'division', 'objective', 'run', 'tenet'].includes(it.type)) content.nodes.push({ ...base, type: 'xeno-ref', ref: { kind: it.type, id: String(it[it.type] || '') }, width: it.width || 260, height: it.height || 100 });
          else if (it.type === 'note') content.nodes.push({ ...base, type: 'text', text: String(it.text || ''), width: it.width || 260, height: it.height || 150 });
          else if (it.type === 'link') content.nodes.push({ ...base, type: 'link', url: String(it.url || ''), width: it.width || 280, height: it.height || 80 });
          else if (it.type === 'group') content.nodes.unshift({ ...base, type: 'group', label: String(it.label || 'Group'), width: it.width || 600, height: it.height || 400 });
          else throw new canvases.CanvasError(`Unknown item type: ${String(it.type).slice(0, 20)}`, 'invalid_content');
          ids.push(id);
        });
        return { added: ids };
      }));
    }
    case 'connect': return ok(await edit(db, actor, a.canvas, (content) => {
      const id = nid();
      content.edges.push({ id, fromNode: String(a.from), toNode: String(a.to), toEnd: 'arrow', ...(a.label ? { label: String(a.label) } : {}), ...(a.link ? { xeno: { link: a.link } } : {}) });
      return { connection: id };
    }));
    case 'update': return ok(await edit(db, actor, a.canvas, (content) => {
      const byId = new Map(content.nodes.map((n) => [n.id, n]));
      for (const u of a.items || []) {
        const n = byId.get(String(u.id)); if (!n) throw new canvases.CanvasError(`No item ${String(u.id).slice(0, 40)} on this canvas`, 'item_not_found', 404);
        for (const k of ['x', 'y', 'width', 'height']) if (u[k] != null) n[k] = u[k];
        if (u.text != null && n.type === 'text') n.text = String(u.text);
        if (u.label != null && n.type === 'group') n.label = String(u.label);
      }
      const gone = new Set((a.remove || []).map(String));
      if (gone.size) {
        content.nodes = content.nodes.filter((n) => !gone.has(n.id));
        content.edges = content.edges.filter((e) => !gone.has(e.id) && !gone.has(e.fromNode) && !gone.has(e.toNode));
      }
      return {};
    }));
    default: throw new canvases.CanvasError(`Unknown tool ${name}`, 'unknown_tool', 404);
  }
}
