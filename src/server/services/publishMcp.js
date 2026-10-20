/**
 * XENO Publish (= XENO Post) as agent capabilities. Every tool calls the SAME function the person's Publish screen
 * calls (services/xenoPost.js), so there is one code path.
 *
 * What an agent may do: read channels, posts and the approvals queue, write DRAFTS, and PROPOSE a time. It cannot
 * publish, retract or approve: those reach an audience and cannot be taken back, so they are a person's step-up on
 * the screen (`confirm: true`), and there is deliberately no tool for them here. A proposed time waits in the
 * workspace's Publish approvals until a person confirms it.
 */
import * as Post from './xenoPost.js';

export class PublishMcpError extends Error { constructor(message, code) { super(message); this.name = 'PublishMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: true }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const WS = { type: 'string', description: 'The XENO workspace id (a UUID). Omit for your owner’s Personal workspace.' };

export const TOOLS = [
  { name: 'list_channels', title: 'List publishing channels', annotations: RO,
    description: 'The social channels (X, LinkedIn, Instagram, …) this workspace publishes to through XENO Post: id, platform, name, status. Use the ids when drafting. Connecting a channel is done by a workspace admin, not by you.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
  { name: 'list_posts', title: 'List posts', annotations: RO,
    description: 'The workspace’s posts in XENO Post, newest first: id, state (draft, queued, published, …), text, scheduledFor, and proposedFor when a time you proposed is waiting for a person.',
    inputSchema: { type: 'object', properties: { workspace: WS, state: { type: 'string', description: 'Optional: only posts in this state.' } }, additionalProperties: false } },
  { name: 'draft_post', title: 'Draft a post', annotations: RW,
    description: 'Write a DRAFT post for one or more channels, with optional images or videos from your owner’s Storage (asset ids). A draft is never published by itself. Pass `request_key` so a retry returns the same draft instead of a second one.',
    inputSchema: { type: 'object', required: ['text', 'channel_ids', 'request_key'], properties: {
      workspace: WS, text: { type: 'string', description: 'The post text.' },
      channel_ids: { type: 'array', items: { type: 'string' }, description: 'Channel ids from list_channels.' },
      media: { type: 'array', items: { type: 'string' }, description: 'Optional: up to 10 Storage file ids (images or videos).' },
      request_key: { type: 'string', description: 'Your own key for this draft, 8–120 characters.' } }, additionalProperties: false } },
  { name: 'propose_schedule', title: 'Propose a time for a post', annotations: RW,
    description: 'Propose when a draft should go out. It does NOT schedule it: the time waits in the workspace’s Publish approvals until a person confirms it, because a scheduled post reaches an audience by itself. Proposing again replaces your earlier time.',
    inputSchema: { type: 'object', required: ['post_id', 'at'], properties: { workspace: WS, post_id: { type: 'string', description: 'The post id.' }, at: { type: 'string', description: 'ISO 8601 date-time, at least a minute ahead.' } }, additionalProperties: false } },
  { name: 'list_approvals', title: 'List what waits for approval', annotations: RO,
    description: 'What in this workspace’s Publish is waiting for a person: XENO Post approval requests and proposed times. You cannot decide them; tell the person what is waiting.',
    inputSchema: { type: 'object', properties: { workspace: WS }, additionalProperties: false } },
];

export async function callTool(db, actor, name, a = {}, { fetchImpl } = {}) {
  try {
    switch (name) {
      case 'list_channels': return ok(await Post.listChannels(db, actor, { workspace: a.workspace, fetchImpl }));
      case 'list_posts': return ok(await Post.listPosts(db, actor, { workspace: a.workspace, state: a.state, fetchImpl }));
      case 'draft_post': {
        if (!/^.{8,120}$/.test(String(a.request_key || ''))) throw new PublishMcpError('request_key must be 8–120 characters', 'invalid_request_key');
        return ok(await Post.createDraft(db, actor, { workspace: a.workspace, text: a.text, channelIds: a.channel_ids, media: a.media || [], requestKey: a.request_key, fetchImpl }));
      }
      case 'propose_schedule': {
        const r = await Post.schedulePost(db, actor, { workspace: a.workspace, postId: a.post_id, at: a.at, proposeOnly: true, fetchImpl });
        return ok(r);
      }
      case 'list_approvals': return ok(await Post.listApprovals(db, actor, { workspace: a.workspace, fetchImpl }));
      default: throw new PublishMcpError(`Unknown tool ${name}`, 'unknown_tool');
    }
  } catch (e) {
    if (e instanceof Post.PublishError) throw new PublishMcpError(e.message, e.code);
    throw e;
  }
}
