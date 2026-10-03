import React from 'react';
import { Button } from '@xenosystem/elements-react';
import { ChevronRight, Folder, MessagesSquare, Plus } from '@/lib/icons';
import {
  buildChatConversationPath,
  buildProjectPath,
  buildProjectsPath,
  CHAT_ROOT_PATH,
} from './chatRoutes';

/**
 * Project-scoped navigation for the chat surface: the sidebar section shown while a project is the
 * context, the breadcrumb in the top bar, and the states for a route that cannot render yet (still
 * resolving) or never will (unknown project, unavailable chat).
 *
 * Every navigation target is a real `<a href>` to the canonical URL. A plain click is intercepted so
 * the app moves without a reload, but middle-click, "open in new tab", copy-link and a keyboard
 * Enter on the anchor all work, because the destination is an address and not just a handler.
 */

type LinkProps = {
  href: string;
  onNavigate: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  title?: string;
  'aria-current'?: 'page';
};

export function ChatNavLink({ href, onNavigate, children, ...rest }: LinkProps) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}

const LINK_CLASS =
  'min-w-0 truncate rounded px-1 text-[var(--chat-muted)] transition-colors hover:text-[var(--chat-text)] focus-visible:text-[var(--chat-text)]';

export type ProjectChatItem = { id: string; title: string };

type SidebarProps = {
  projectId: string;
  /** Null while the project list is still loading or when the project cannot be resolved. */
  projectName: string | null;
  projectsLoaded: boolean;
  chats: ProjectChatItem[];
  activeConversationId: string | null;
  /** The project home is the open page (no conversation). */
  isProjectHomeOpen: boolean;
  renderRow: (chatId: string) => React.ReactNode;
  onOpenProject: () => void;
  onNewChat: () => void;
  onAllProjects: () => void;
  onAllChats: () => void;
};

/**
 * "Back to the project" header, the project's own chats with the open one highlighted by the
 * existing history row, and the two ways out. It sits in the sidebar's list region in place of the
 * global Recents while a project is the context.
 */
export function ProjectChatsSidebarSection({
  projectId,
  projectName,
  projectsLoaded,
  chats,
  activeConversationId,
  isProjectHomeOpen,
  renderRow,
  onOpenProject,
  onNewChat,
  onAllProjects,
  onAllChats,
}: SidebarProps) {
  const label = projectName ?? (projectsLoaded ? 'Unavailable project' : 'Loading project');
  return (
    <section className="space-y-2" aria-label={`Project: ${label}`} data-project-chats-section={projectId}>
      <div className="flex items-center gap-1 px-1.5 text-[11px] text-[var(--chat-muted)]">
        <ChatNavLink href={buildProjectsPath()} onNavigate={onAllProjects} className={LINK_CLASS}>
          Projects
        </ChatNavLink>
      </div>
      <ChatNavLink
        href={buildProjectPath(projectId)}
        onNavigate={onOpenProject}
        aria-current={isProjectHomeOpen ? 'page' : undefined}
        title={projectName ? `Back to ${projectName}` : 'Back to project'}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[var(--chat-text)] transition-colors hover:bg-[var(--chat-hover)] ${
          isProjectHomeOpen ? 'bg-[var(--chat-hover)]' : ''
        }`}
      >
        <Folder size={15} className="flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </ChatNavLink>
      <button
        type="button"
        onClick={onNewChat}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
      >
        <Plus size={14} className="flex-shrink-0" aria-hidden="true" />
        <span>New chat in project</span>
      </button>
      <p className="px-2.5 pt-1 text-[11px] font-semibold tracking-wide text-[var(--chat-text)]">Project chats</p>
      {chats.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] text-[var(--chat-muted)]">
          {projectsLoaded ? 'No chats in this project yet' : 'Loading chats'}
        </p>
      ) : (
        <div className="space-y-0.5" data-active-conversation={activeConversationId ?? ''}>
          {chats.map((chat) => (
            <React.Fragment key={chat.id}>{renderRow(chat.id)}</React.Fragment>
          ))}
        </div>
      )}
      <ChatNavLink
        href={CHAT_ROOT_PATH}
        onNavigate={onAllChats}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
      >
        <MessagesSquare size={14} className="flex-shrink-0" aria-hidden="true" />
        <span>All chats</span>
      </ChatNavLink>
    </section>
  );
}

type BreadcrumbProps = {
  projectId: string;
  projectName: string | null;
  chatTitle: string;
  onOpenProjects: () => void;
  onOpenProject: () => void;
};

/** `Projects / <project name> / <chat title>`; the first two are links, the last is the page. */
export function ChatBreadcrumb({ projectId, projectName, chatTitle, onOpenProjects, onOpenProject }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      data-chat-breadcrumb=""
      className="hidden min-w-0 max-w-[min(34rem,40vw)] items-center gap-0.5 text-[12.5px] md:flex"
    >
      <ChatNavLink href={buildProjectsPath()} onNavigate={onOpenProjects} className={`${LINK_CLASS} flex-shrink-0`}>
        Projects
      </ChatNavLink>
      <ChevronRight size={12} className="flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
      <ChatNavLink href={buildProjectPath(projectId)} onNavigate={onOpenProject} className={`${LINK_CLASS} max-w-[12rem]`}>
        {projectName ?? 'Project'}
      </ChatNavLink>
      <ChevronRight size={12} className="flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
      <span aria-current="page" className="min-w-0 truncate px-1 font-medium text-[var(--chat-text)]">
        {chatTitle || 'Conversation'}
      </span>
    </nav>
  );
}

export type ChatRouteNoticeKind = 'project-loading' | 'project-missing' | 'chat-loading' | 'chat-unavailable';

type NoticeProps = {
  kind: ChatRouteNoticeKind;
  /** Left inset so the notice clears the history sidebar, as the other full-page overlays do. */
  left: number;
  projectId?: string | null;
  projectName?: string | null;
  conversationId?: string | null;
  onRetry?: () => void;
  onOpenProject?: () => void;
  onOpenProjects: () => void;
  onAllChats: () => void;
};

/**
 * Covers the chat area while a route is resolving (so the global view never flashes under a
 * project URL) and explains a route that cannot resolve, always with a way back.
 */
export function ChatRouteNotice({
  kind,
  left,
  projectId,
  projectName,
  conversationId,
  onRetry,
  onOpenProject,
  onOpenProjects,
  onAllChats,
}: NoticeProps) {
  const loading = kind === 'project-loading' || kind === 'chat-loading';
  const title =
    kind === 'project-loading'
      ? 'Loading project'
      : kind === 'chat-loading'
        ? 'Loading chat'
        : kind === 'project-missing'
          ? 'Project not found'
          : 'This chat is unavailable';
  const body =
    kind === 'project-missing'
      ? 'The project was deleted, or you no longer have access to it.'
      : kind === 'chat-unavailable'
        ? 'It may have been deleted, or you may no longer have access. If you expected to see it, try again.'
        : null;
  return (
    <div
      className="absolute inset-0 z-[46] flex items-center justify-center overflow-hidden px-6"
      style={{ left, backgroundColor: 'var(--chat-canvas)', color: 'var(--chat-text)' }}
      role={loading ? 'status' : 'alert'}
      aria-live="polite"
      data-chat-route-notice={kind}
      data-chat-route-project={projectId ?? undefined}
      data-chat-route-conversation={conversationId ?? undefined}
    >
      <div className="flex max-w-[26rem] flex-col items-center gap-3 text-center">
        {loading ? (
          <span className="chat-skeleton h-3 w-[7rem]" aria-hidden="true">Loading</span>
        ) : null}
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {body ? <p className="text-[13px] leading-relaxed text-[var(--chat-muted)]">{body}</p> : null}
        {!loading ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {onRetry ? (
              <Button variant="quiet" size="md" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {projectId && projectName && onOpenProject ? (
              <Button variant="quiet" size="md" onClick={onOpenProject}>
                Back to {projectName}
              </Button>
            ) : null}
            <Button variant="quiet" size="md" onClick={onOpenProjects}>
              All projects
            </Button>
            <Button variant="quiet" size="md" onClick={onAllChats}>
              All chats
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { buildChatConversationPath };
