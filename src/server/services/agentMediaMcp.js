/**
 * XENO MCP rows for Images, Video, Library and Chat. Each tool calls agentMedia.js, the one code path (the
 * native SDK/CLI registers the same names over the same service through XENO MCP).
 */
import * as media from './agentMedia.js';

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const PROJECT = { type: 'string', description: 'A project id (see tasks_list_projects). The result is attached to it.' };

const genTools = (type) => [
  { name: 'list_models', title: `${type === 'image' ? 'Image' : 'Video'} models`, annotations: RO, description: `The ${type} models you can use, and the most one ${type} can cost in credits.`, inputSchema: { type: 'object', properties: {} } },
  { name: 'generate', title: `Make ${type === 'image' ? 'an image' : 'a video'}`, annotations: RW,
    description: `Make ${type === 'image' ? 'an image' : 'a short video'} from a prompt. It is billed to your owner and counted against your division’s agent budget. If your division lets agents generate within its budget, it starts at once; otherwise it waits for your owner to approve it, and the result says so. Check progress with ${type}_get.`,
    inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, model: { type: 'string', description: `A model id from ${type}_list_models. Defaults to the first one.` },
      settings: { type: 'object', description: type === 'image' ? 'Model settings, e.g. { "ratio": "16:9", "quality": "high" }' : 'Model settings, e.g. { "ratio": "16:9", "resolution": "720p" }' },
      reference_asset_ids: { type: 'array', items: { type: 'string' }, description: 'Library files to start from (asset ids you can read).' },
      project: PROJECT, request_key: { type: 'string', description: 'Your own id for this request; sending the same key again returns the same generation instead of making another.' } } } },
  { name: 'get', title: `Check ${type === 'image' ? 'an image' : 'a video'}`, annotations: RO, description: `One of your ${type} generations: its state and, once done, its files (read them with library_get_file).`, inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'list', title: `Your ${type}s`, annotations: RO, description: `Your recent ${type} generations, newest first.`, inputSchema: { type: 'object', properties: {} } },
];

async function genCall(type, db, actor, name, args) {
  switch (name) {
    case 'list_models': return ok(await media.mediaModels(db, actor, type));
    case 'generate': return ok(await media.generate(db, actor, type, { prompt: args.prompt, model: args.model, settings: args.settings, referenceAssetIds: args.reference_asset_ids, projectId: args.project || args.project_id, requestKey: args.request_key }));
    case 'get': return ok(await media.getMedia(db, actor, args.id));
    case 'list': return ok({ items: await media.listMedia(db, actor, type) });
    default: throw new media.MediaError(`Unknown tool ${name}`, 'unknown_tool', 404);
  }
}

export const IMAGE = { tools: genTools('image'), call: (db, actor, name, args) => genCall('image', db, actor, name, args) };
export const VIDEO = { tools: genTools('video'), call: (db, actor, name, args) => genCall('video', db, actor, name, args) };

export const LIBRARY = {
  tools: [
    { name: 'list_files', title: 'List files', annotations: RO, description: 'Files you can read: those attached to your projects, and those you made. With `project`, only that project’s files; add `query` to search inside them. With `folder`, the files and sub-folders of a Storage folder a task gave you (its id is in the task’s folders).',
      inputSchema: { type: 'object', properties: { project: { type: 'string' }, query: { type: 'string' }, folder: { type: 'string', description: 'A Storage folder id from a task you work.' } } } },
    { name: 'get_file', title: 'Read a file', annotations: RO, description: 'One file: its details, a link people can open, and its text if it is a text file.', inputSchema: { type: 'object', required: ['asset_id'], properties: { asset_id: { type: 'string' } } } },
    { name: 'attach_to_project', title: 'Add a file to a project', annotations: RW, description: 'Attach a file you made to one of your projects, so the people and agents on it can see it.', inputSchema: { type: 'object', required: ['asset_id', 'project'], properties: { asset_id: { type: 'string' }, project: { type: 'string' } } } },
  ],
  call: async (db, actor, name, args) => {
    if (name === 'list_files') return ok(await media.listFiles(db, actor, { projectId: args.project || args.project_id, query: args.query, folderId: args.folder || args.folder_id }));
    if (name === 'get_file') return ok(await media.getFile(db, actor, args.asset_id));
    if (name === 'attach_to_project') return ok(await media.attachFile(db, actor, args.asset_id, args.project || args.project_id));
    throw new media.MediaError(`Unknown tool ${name}`, 'unknown_tool', 404);
  },
};

export const CHAT = {
  tools: [
    { name: 'ask', title: 'Ask a model', annotations: { readOnlyHint: true, openWorldHint: true }, description: 'Ask a XENO model one question and get its answer: a second opinion, a summary, a translation, a draft. Billed to your owner and counted against your division’s agent budget.',
      inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, model: { type: 'string', description: 'A XENO model id. Defaults to the platform’s default.' }, system: { type: 'string', description: 'Optional instructions for the model.' }, max_tokens: { type: 'integer', minimum: 1, maximum: 4096 } } } },
  ],
  call: async (db, actor, name, args) => {
    if (name === 'ask') return ok(await media.ask(db, actor, { prompt: args.prompt, model: args.model, system: args.system, maxTokens: args.max_tokens }));
    throw new media.MediaError(`Unknown tool ${name}`, 'unknown_tool', 404);
  },
};
