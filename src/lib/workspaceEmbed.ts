/**
 * The chat shown inside the XENO workspace (/workspace/).
 *
 * The workspace is plain scripts; the chat is this React app. Until the workspace moves onto the
 * XENO framework, the workspace shows the REAL chat by loading this app in a same-origin frame.
 * Inside that frame the app must not bring a second shell: the workspace already has the rail, the
 * sidebar and the top bar. This module is the one place that decides "am I that frame", and the one
 * channel the two sides talk over.
 *
 * Embedded means: this window has a parent, the parent is the same origin, and the parent is the
 * workspace page. A page framed by anything else is NOT embedded (nginx sends
 * X-Frame-Options: SAMEORIGIN, so another origin cannot frame it at all).
 *
 * Messages to the workspace are same-origin `postMessage`s, and the workspace checks the origin:
 *   { source: 'xeno-chat', type: 'location', path, title }   the chat is now showing `path`
 *   { source: 'xeno-chat', type: 'changed' }                 the list of conversations may have changed
 *   { source: 'xeno-chat', type: 'model-menu', … }           open the workspace's model menu with this list
 *   { source: 'xeno-chat', type: 'model-menu-close' }        close it
 *   { source: 'xeno-chat', type: 'effort-menu', rect, selected, levels }   the effort pill was pressed (same idea)
 *   { source: 'xeno-chat', type: 'effort-menu-close' }       close it
 *   { source: 'xeno-chat', type: 'viewer', open, name, canExport }   a file preview opened or closed: the workspace's
 *                                                            header carries its name and its actions (no second header)
 *   { source: 'xeno-chat', type: 'viewer-copied' }           the preview's link was copied
 * And from the workspace back to the chat (WorkspaceModelTrigger.tsx):
 *   { source: 'xeno-workspace', type: 'pick-model', id }     the person chose this model
 *   { source: 'xeno-workspace', type: 'model-menu-closed' }  the menu is no longer showing
 *   { source: 'xeno-workspace', type: 'pick-effort', id }    an effort level was chosen in that menu
 *   { source: 'xeno-workspace', type: 'effort-menu-closed' } the effort menu is no longer showing
 *   { source: 'xeno-workspace', type: 'viewer-close' | 'viewer-copy' | 'viewer-download' }   the header's preview actions
 */
const WORKSPACE_PATH = /^\/workspace(\/|$)/;

let cached: boolean | null = null;

export function isWorkspaceEmbed(): boolean {
  if (cached !== null) return cached;
  cached = false;
  try {
    if (typeof window === 'undefined' || window.parent === window) return cached;
    // Reading a cross-origin parent's location throws; that is the "not embedded" answer.
    const parent = window.parent.location;
    cached = parent.origin === window.location.origin && WORKSPACE_PATH.test(parent.pathname);
  } catch {
    cached = false;
  }
  // The chat paints the workspace's panel colour so it reads as part of that panel. Both sides derive it
  // from the SAME platform theme (chat-theme.css: --xw-surface; workspace theme.js: --panel), so it follows
  // a theme change live with nothing passed between the two.
  if (cached) document.documentElement.classList.add('xw-embed');
  return cached;
}

/** Paths the embedded chat may show. Anything else belongs to the workspace, which owns the page. */
const CHAT_PATH = /^\/(overview\/(chat|c)(\/|$)|c(\/|$)|chat(\/|$)|projects(\/|$)|library(\/|$)|artifacts(\/|$)|scheduled(\/|$)|customize(\/|$))/;

export function isEmbeddedChatPath(pathname: string): boolean {
  return CHAT_PATH.test(pathname);
}

export type WorkspaceChatMessage =
  | { source: 'xeno-chat'; type: 'location'; path: string; title: string }
  | { source: 'xeno-chat'; type: 'changed' }
  /** Open the workspace's model menu at `rect` (this frame's coordinates) with the chat's real list. */
  | { source: 'xeno-chat'; type: 'model-menu'; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; selected: string; models: Array<{ id: string; name: string; description: string; contextWindow: number; ownKey: boolean }> }
  | { source: 'xeno-chat'; type: 'model-menu-close' }
  | { source: 'xeno-chat'; type: 'effort-menu'; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; selected: string; levels: Array<{ id: string; label: string; title?: string }> }
  | { source: 'xeno-chat'; type: 'effort-menu-close' }
  | { source: 'xeno-chat'; type: 'viewer'; open: boolean; name?: string; canExport?: boolean }
  | { source: 'xeno-chat'; type: 'viewer-copied' }
  /** The session transcript, built by the chat. The workspace owns the button, so it does the copy. */
  | { source: 'xeno-chat'; type: 'transcript'; text: string };

/**
 * The AREA of the workspace this chat is being shown in (Studio, Office, Dev… or one the person made), or null
 * on Overview and outside the workspace. A chat or project started here lives in that area (owner's rule:
 * each area has its own chats; only Overview shows everything).
 *
 * Read from the workspace page at the moment it is needed, not sent as a message: the two documents are the
 * same origin, and a value read when the chat is created cannot be stale or arrive late.
 */
export function embedArea(): string | null {
  if (!isWorkspaceEmbed()) return null;
  try {
    const area = (window.parent as unknown as { XENO_CHAT?: { area?: () => unknown } }).XENO_CHAT?.area?.();
    return typeof area === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(area) && area !== 'overview' ? area : null;
  } catch {
    return null;
  }
}

export function tellWorkspace(message: WorkspaceChatMessage): void {
  if (!isWorkspaceEmbed()) return;
  try {
    window.parent.postMessage(message, window.location.origin);
  } catch {
    // The workspace went away mid-navigation; there is nobody to tell.
  }
}

/** A link out of the chat (billing, settings, a product page) opens in the whole tab, not in the frame. */
export function leaveEmbed(pathAndQuery: string): void {
  try {
    window.parent.location.assign(pathAndQuery);
  } catch {
    window.location.assign(pathAndQuery);
  }
}
