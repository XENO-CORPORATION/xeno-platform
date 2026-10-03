/**
 * The chat surface's URL scheme, in ONE pure module.
 *
 *   /overview/chat/llm                                  new chat
 *   /overview/chat/llm/:conversationId                  a conversation that belongs to no project
 *   /overview/chat/projects                             the project list
 *   /overview/chat/projects/:projectId                  a project's home (chats, instructions, files, composer)
 *   /overview/chat/projects/:projectId/c/:conversationId   a conversation INSIDE its project
 *
 * The compact forms (`/c/:id`, `/projects`, `/projects/:id`, `/projects/:id/c/:cid`, `/chat/c/:id`)
 * and the `/overview/c/:id` form parse to the same locations, so an old link, a pushed URL and a
 * reload all agree on what they mean. The URL is the source of truth for "which project and which
 * conversation": nothing here reads storage.
 *
 * Why a module rather than regexes at each call site: the chat used to parse `/projects/...` and
 * `/overview/chat/projects/...` by hand in a route effect and again in a popstate handler, and the
 * conversation regex had no idea a project could be part of the path - so opening a project's chat
 * dropped the project.
 */

export type ChatLocationView =
  /** `/overview/chat/llm`, `/c`, `/chat`: a blank new chat. */
  | 'chat'
  | 'projects'
  | 'project'
  | 'project-conversation'
  | 'conversation'
  /** Not a chat location this module owns (scheduled, library, settings, anything else). */
  | 'other';

export type ChatLocation = {
  view: ChatLocationView;
  projectId: string | null;
  conversationId: string | null;
};

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

const OTHER: ChatLocation = { view: 'other', projectId: null, conversationId: null };

function safeDecode(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return ID_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Removes a query/hash and any run of trailing slashes; always starts with `/`. */
export function normalizeChatPathname(input: string): string {
  let path = String(input ?? '');
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  path = path.replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

/**
 * Where a path sits relative to the chat root. `/overview/chat/<rest>` and `/overview/<rest>` and the
 * bare compact `/<rest>` are one namespace - returns the segments after whichever prefix matched.
 */
function chatSegments(pathname: string): string[] | null {
  const segments: string[] = normalizeChatPathname(pathname).split('/').filter(Boolean);
  const first = (): string | undefined => segments[0];
  if (first() === 'overview') {
    segments.shift();
    if (first() === 'chat') {
      segments.shift();
      return segments;
    }
    // `/overview/projects[/:id]` is the ACCOUNT projects page, a different surface; only the
    // conversation forms (`/overview/c/:id`) are shared with the chat namespace.
    return first() === 'c' ? segments : null;
  }
  if (first() === 'chat') {
    segments.shift();
    return segments;
  }
  return segments;
}

export function parseChatLocation(pathname: string): ChatLocation {
  const segments = chatSegments(pathname);
  if (!segments) return OTHER;
  const [head, a, b, c, ...rest] = segments;

  if (segments.length === 0 || (segments.length === 1 && head === 'llm')) {
    return { view: 'chat', projectId: null, conversationId: null };
  }
  // /c, /c/:id and /chat/c/:id (the `chat` prefix is already stripped)
  if (head === 'c') {
    if (a === undefined) return { view: 'chat', projectId: null, conversationId: null };
    const conversationId = safeDecode(a);
    if (!conversationId || b !== undefined) return OTHER;
    return { view: 'conversation', projectId: null, conversationId };
  }
  if (head === 'llm') {
    const conversationId = safeDecode(a ?? '');
    if (!conversationId || b !== undefined) return OTHER;
    return { view: 'conversation', projectId: null, conversationId };
  }
  if (head === 'projects') {
    if (a === undefined) return { view: 'projects', projectId: null, conversationId: null };
    const projectId = safeDecode(a);
    // A malformed project id is the projects list, not a project named "undefined".
    if (!projectId) return { view: 'projects', projectId: null, conversationId: null };
    if (b === undefined) return { view: 'project', projectId, conversationId: null };
    if (b === 'c' && c !== undefined && rest.length === 0) {
      const conversationId = safeDecode(c);
      if (conversationId) return { view: 'project-conversation', projectId, conversationId };
    }
    return { view: 'project', projectId, conversationId: null };
  }
  return OTHER;
}

const enc = encodeURIComponent;

export const CHAT_ROOT_PATH = '/overview/chat/llm';
export const buildProjectsPath = (): string => '/overview/chat/projects';
export const buildProjectPath = (projectId: string): string => `/overview/chat/projects/${enc(projectId)}`;
export const buildProjectConversationPath = (projectId: string, conversationId: string): string =>
  `${buildProjectPath(projectId)}/c/${enc(conversationId)}`;
export const buildConversationPath = (conversationId: string): string => `${CHAT_ROOT_PATH}/${enc(conversationId)}`;

/** The one URL a conversation lives at: project-scoped when it has a project, plain otherwise. */
export function buildChatConversationPath(projectId: string | null | undefined, conversationId: string): string {
  return projectId ? buildProjectConversationPath(projectId, conversationId) : buildConversationPath(conversationId);
}

/** True when two locations name the same place. */
export function sameChatLocation(a: ChatLocation, b: ChatLocation): boolean {
  return a.view === b.view && a.projectId === b.projectId && a.conversationId === b.conversationId;
}

/**
 * The correction to apply when a conversation is open at a URL that names the wrong project (or no
 * project): the URL it should have, or null when it is already right or the open URL is not a
 * conversation URL at all (a project home must not be rewritten into a conversation).
 */
export function conversationUrlCorrection(
  currentPathname: string,
  conversationId: string,
  conversationProjectId: string | null | undefined,
): string | null {
  const current = parseChatLocation(currentPathname);
  if (current.view !== 'conversation' && current.view !== 'project-conversation') return null;
  if (current.conversationId !== conversationId) return null;
  const want = conversationProjectId ?? null;
  if (current.projectId === want) return null;
  return buildChatConversationPath(want, conversationId);
}
