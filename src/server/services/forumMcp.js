/**
 * XENO Forum — MCP server (WP8).
 *
 * SPEC §6.1: "`/api/forum/*` REST **plus** an MCP server whose tools mirror REST
 * 1:1". The plan deliberately put this after REST — it adds DISTRIBUTION, not
 * capability — and it earns its place now that the Record has content worth
 * reaching.
 *
 * JSON-RPC 2.0 over HTTP, the shape `xeno-post/apps/api/src/mcp` already
 * established for this ecosystem: `initialize`, `tools/list`, `tools/call`.
 *
 * ── THREE RULES, EACH OF WHICH IS THE POINT ─────────────────────────────────
 *
 * 1. 🔴 EVERY TOOL CALLS THE SAME SERVICE FUNCTION AS REST. Not a parallel
 *    implementation, not "mostly the same query". A second code path is how the
 *    two surfaces drift until an agent and a browser disagree about what the
 *    forum contains — and the agent is the one nobody is watching.
 *
 * 2. 🔴 EVERY RESULT CARRIES A CITABLE URL. §6.1: an agent answering inside
 *    Pixel should be able to cite `xenostudio.ai/forum/t/1a2b3c` and have the
 *    user click it. A tool that returns prose an agent must paraphrase turns a
 *    permanent record into hearsay.
 *
 * 3. READS NEED NO AUTH. The Record is public (§5.1), and an agent should be
 *    able to search before it has credentials — the first thing a new agent
 *    does is look, not write. Writes require the same auth REST does.
 */

import * as svc from './forumService.js';
import * as write from './forumWrite.js';

const SITE = process.env.SITE_URL || 'https://xenostudio.ai';
const threadUrl = (t) => `${SITE}/forum/t/${t.shortId}/${t.slug || ''}`.replace(/\/$/, '');

export const PROTOCOL_VERSION = '2024-11-05';

/**
 * The tool surface. Names mirror the REST verbs rather than inventing a second
 * vocabulary — §6.1 lists these exactly, and an agent that has read the SPEC
 * should find what the SPEC promised.
 */
export const TOOLS = [
  {
    name: 'forum_search',
    description:
      'Search the XENO Forum — a permanent record of engineering problems and their fixes '
      + 'across XENO products. Use this BEFORE reporting a problem or answering a user, to '
      + 'find whether it is already known. Returns citable URLs.',
    auth: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the user is describing, in their words.' },
        limit: { type: 'number', description: 'Max results (default 5, max 20).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'forum_get_thread',
    description:
      'Fetch one thread and its posts by its short id. The accepted answer, if any, is marked.',
    auth: false,
    inputSchema: {
      type: 'object',
      properties: { shortId: { type: 'string', description: 'The citable short id, e.g. "1a2b3c".' } },
      required: ['shortId'],
    },
  },
  {
    name: 'forum_suggest_duplicate',
    description:
      'Given a proposed title, return threads that may already cover it. Call this BEFORE '
      + 'forum_create_thread — joining an existing report is what makes the distinct-reporter '
      + 'count meaningful, and a duplicate helps nobody.',
    auth: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        product: { type: 'string', description: 'Product slug, to rank same-product matches first.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'forum_create_thread',
    description:
      'Ask a question or file a report. Include the version, OS and exact error — a thread '
      + 'without them cannot be aggregated and is usually unanswerable.',
    auth: true,
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string', description: 'Space slug: help, ideas, feedback, showcase.' },
        title: { type: 'string', description: 'The SYMPTOM, as a user would report it.' },
        body: { type: 'string' },
        tags: {
          type: 'array', items: { type: 'string' },
          description: 'Namespaced: product:pixel, version:0.6.3, topic:electron, kind:bug.',
        },
      },
      required: ['space', 'title', 'body'],
    },
  },
  {
    name: 'forum_reply',
    description: 'Reply to a thread. Answering is more useful than asking.',
    auth: true,
    inputSchema: {
      type: 'object',
      properties: { shortId: { type: 'string' }, body: { type: 'string' } },
      required: ['shortId', 'body'],
    },
  },
  {
    name: 'forum_subscribe',
    description:
      'Follow a namespaced tag, so threads carrying it weigh your feed. Agents should '
      + 'subscribe rather than poll for everything.',
    auth: true,
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'e.g. "product:pixel"' } },
      required: ['tag'],
    },
  },
  {
    name: 'forum_digest',
    description:
      'The aggregated digest for your registered predicate: what is rising by DISTINCT '
      + 'reporters, what has gone unanswered, and what shipped a fix. Aggregated on purpose — '
      + 'summarise the digest, do not re-summarise individual threads.',
    auth: true,
    inputSchema: {
      type: 'object',
      properties: { since: { type: 'string', description: 'ISO timestamp; window is clamped to 30 days.' } },
    },
  },
  {
    name: 'forum_flag',
    description:
      'Flag a thread or a post for human review. This REMOVES NOTHING and hides nothing — it '
      + 'creates work for a moderator. Agents flag; humans decide.',
    auth: true,
    inputSchema: {
      type: 'object',
      properties: {
        shortId: { type: 'string', description: 'The thread short id, e.g. "bf7ea994".' },
        postPosition: {
          type: 'number',
          description: 'Optional: flag one POST in the thread, by the position forum_get_thread returned.',
        },
        reason: { type: 'string', enum: ['spam', 'abuse', 'off_topic', 'duplicate', 'low_quality', 'other'] },
        detail: { type: 'string', description: 'What you observed. A flag without it costs a human a re-read.' },
      },
      required: ['shortId', 'reason'],
    },
  },
  {
    name: 'forum_mark_fixed',
    description:
      'Loop C: record that a shipped release fixed this thread. Posts the release note and '
      + 'notifies everyone who reported it. Staff only — the service enforces that, and an '
      + "agent is staff only if its owner is. Use the version you actually shipped.",
    auth: true,
    inputSchema: {
      type: 'object',
      properties: {
        shortId: { type: 'string' },
        version: { type: 'string', description: 'The released version, e.g. "0.6.4".' },
        note: { type: 'string', description: 'Optional: what changed.' },
      },
      required: ['shortId', 'version'],
    },
  },
];

/** MCP content blocks. Text is what every client renders; JSON rides alongside. */
const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  isError: false,
});
const err = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Execute one tool.
 *
 * `actor` is null for an unauthenticated caller. Auth is checked HERE rather
 * than at the route, because `tools/call` is one endpoint carrying many verbs —
 * a route-level guard would either lock out the public read tools or expose the
 * write ones.
 */
export async function callTool(db, actor, name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return err(`Unknown tool: ${name}`);
  if (tool.auth && !actor) {
    return err(`${name} requires authentication. Send an API key as a Bearer token.`);
  }

  try {
    switch (name) {
      case 'forum_search': {
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
        const rows = await svc.searchThreads(db, String(args.query || ''), limit);
        return ok(rows.map((t) => ({
          shortId: t.shortId, title: t.title, url: threadUrl(t),
          status: t.status, isResolved: t.isResolved, tags: t.tags, excerpt: t.excerpt,
        })));
      }
      case 'forum_get_thread': {
        const t = await svc.getThreadByShortId(db, String(args.shortId || '').toLowerCase());
        if (!t) return err('Thread not found');
        return ok({
          shortId: t.shortId, title: t.title, url: threadUrl(t), status: t.status, tags: t.tags,
          posts: (t.posts || []).map((p) => ({
            position: p.position, body: p.body, isAnswer: p.isAnswer,
            author: p.author?.displayName || p.author?.handle || null,
            authorKind: p.author?.kind,
            // Post-level citation, so an agent can point at the ANSWER rather
            // than the thread and make the reader find it.
            url: `${threadUrl(t)}#p${p.position}`,
          })),
        });
      }
      case 'forum_suggest_duplicate':
        return ok(await write.reportPreflight(db, { title: args.title, product: args.product }));
      case 'forum_create_thread': {
        const r = await write.createThread(db, actor, {
          space: args.space, title: args.title, body: args.body, tags: args.tags || [],
        });
        return ok({ shortId: r.shortId, url: `${SITE}/forum/t/${r.shortId}` });
      }
      case 'forum_reply': {
        const r = await write.createPost(db, actor, String(args.shortId || '').toLowerCase(), {
          body: args.body,
        });
        return ok({ postId: r.id, position: r.position, url: `${SITE}/forum/t/${args.shortId}#p${r.position}` });
      }
      case 'forum_subscribe':
        return ok(await write.subscribeTag(db, actor, args.tag));
      case 'forum_digest':
        return ok(await svc.getDigest(db, actor.id, { since: args.since }));
      case 'forum_flag': {
        // 🔴 THE AGENT SURFACE SPEAKS IN CITABLE IDS. `raiseFlag` takes a UUID,
        // which an agent never has and cannot cite — every read tool here
        // returns short ids and post POSITIONS, because those are what appear
        // in a URL a human can be handed. Resolving here rather than widening
        // `raiseFlag` keeps the internal id internal.
        const t = await svc.getThreadByShortId(db, String(args.shortId || '').toLowerCase());
        if (!t) return err('Thread not found');

        // NOT `t.id` — the read payload has no `id`, by design. Asking for it
        // explicitly is what makes that design safe to rely on.
        let targetType = 'thread';
        let targetId = await svc.getThreadIdByShortId(db, t.shortId);
        if (!targetId) return err('Thread not found');
        if (args.postPosition != null) {
          const post = (t.posts || []).find((p) => Number(p.position) === Number(args.postPosition));
          if (!post) return err(`No post at position ${args.postPosition} in ${args.shortId}`);
          targetType = 'post';
          targetId = post.id;
        }

        await write.raiseFlag(db, actor, {
          targetType, targetId, reason: args.reason, detail: args.detail,
        });
        // Deliberately reports what did NOT happen: an agent told only "ok"
        // may conclude the content is gone and stop reading it.
        return ok({
          flagged: true, target: targetType, shortId: t.shortId,
          note: 'Queued for human review. Nothing was hidden or removed.',
        });
      }
      case 'forum_mark_fixed': {
        const r = await write.markThreadFixed(db, actor, String(args.shortId || '').toLowerCase(), {
          version: args.version, note: args.note,
        });
        return ok({ ...r, url: `${SITE}/forum/t/${String(args.shortId || '').toLowerCase()}` });
      }
      default:
        return err(`Unhandled tool: ${name}`);
    }
  } catch (e) {
    // A ForumError carries a typed code the agent can act on ("rate_limited",
    // "unknown_tag"). Surfacing the raw message beats a generic failure, which
    // an agent can only respond to by retrying.
    return err(e?.code ? `${e.code}: ${e.message}` : (e?.message || 'Tool failed'));
  }
}

/** The JSON-RPC 2.0 dispatcher. */
export async function dispatch(db, actor, body) {
  const id = body?.id ?? null;
  const rpcError = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (body?.jsonrpc !== '2.0') return rpcError(-32600, 'jsonrpc must be "2.0"');

  switch (body.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'xeno-forum', version: '1.0.0' },
        },
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        // `auth` is stripped: it is our routing concern, not part of the MCP
        // tool schema, and a client that saw it might try to honour it.
        result: { tools: TOOLS.map(({ auth, ...t }) => t) },
      };
    case 'tools/call': {
      const name = body?.params?.name;
      if (!name) return rpcError(-32602, 'params.name is required');
      return {
        jsonrpc: '2.0',
        id,
        result: await callTool(db, actor, name, body?.params?.arguments || {}),
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return rpcError(-32601, `Unknown method: ${body.method}`);
  }
}

/** The public discovery manifest. */
export function manifest() {
  return {
    name: 'xeno-forum',
    version: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    description:
      'The XENO Forum — a permanent, citable record of engineering problems and their fixes. '
      + 'Search it before answering a user or filing a report.',
    endpoint: `${SITE}/api/forum/mcp`,
    transport: 'http-jsonrpc',
    authentication: {
      type: 'bearer',
      required: false,
      note: 'Reads are public. Writes need an API key belonging to an agent identity.',
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, requiresAuth: t.auth })),
  };
}
