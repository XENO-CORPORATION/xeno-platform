/**
 * Pinned projects block for the chat history sidebar.
 *
 * Props in, callbacks out: this file owns no project state and talks to no service. The host
 * decides how a pin is persisted (per-user, server side) and passes the ordered list down.
 *
 * Reorder is available three ways, because a drag-only list is not operable without a mouse:
 *  - pointer drag (mouse / pen) on any row, with a 4px threshold so a click still opens the project;
 *  - keyboard: focus a row and press Alt+ArrowUp / Alt+ArrowDown (announced through a live region);
 *  - Escape cancels a drag in flight.
 * Touch devices keep scrolling (no drag hijack); they unpin from the row, and reorder by keyboard.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { IconButton } from '@xenosystem/elements-react';
import { BookmarkDecl, Folder } from '@/lib/icons';

export interface PinnedProjectItem {
  id: string;
  name: string;
  /** Number of chats in the project, shown at the row end like the Projects list. */
  count: number;
}

export interface PinnedProjectsSectionProps {
  /** Pinned projects already in pin order. */
  projects: PinnedProjectItem[];
  activeProjectId: string | null;
  onOpen: (projectId: string) => void;
  onUnpin: (projectId: string) => void;
  /** Receives the COMPLETE new id order. */
  onReorder: (orderedIds: string[]) => void;
  /**
   * Show the "nothing pinned" hint instead of rendering nothing. The Projects tab turns this on
   * (that is where pinning is discovered); the chat list does not, so a person who never uses
   * projects never sees an empty block above their conversations.
   */
  showEmptyHint?: boolean;
}

const DRAG_THRESHOLD_PX = 4;

type DragState = { id: string; from: number; over: number; dy: number };

export const PinnedProjectsSection: React.FC<PinnedProjectsSectionProps> = ({
  projects,
  activeProjectId,
  onOpen,
  onUnpin,
  onReorder,
  showEmptyHint = false,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const pointerRef = useRef<{ id: string; startY: number; pointerId: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const focusAfterRenderRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    const id = focusAfterRenderRef.current;
    if (!id) return;
    focusAfterRenderRef.current = null;
    rowEls.current.get(id)?.querySelector<HTMLButtonElement>('[data-pinned-project-open]')?.focus();
  }, [projects]);

  useEffect(() => {
    if (!drag) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pointerRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const rowHeight = useCallback(() => {
    const first = projects[0] && rowEls.current.get(projects[0].id);
    return first ? first.getBoundingClientRect().height + 2 : 36;
  }, [projects]);

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= projects.length) return;
      const ids = projects.map((p) => p.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(target, 0, moved);
      focusAfterRenderRef.current = moved;
      setAnnouncement(`${projects[index].name} moved to position ${target + 1} of ${projects.length}`);
      onReorder(ids);
    },
    [onReorder, projects],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (event.pointerType === 'touch' || event.button !== 0 || projects.length < 2) return;
    if ((event.target as HTMLElement).closest('[data-pinned-project-unpin]')) return;
    pointerRef.current = { id, startY: event.clientY, pointerId: event.pointerId, active: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = pointerRef.current;
    if (!state) return;
    const dy = event.clientY - state.startY;
    if (!state.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      state.active = true;
      try {
        event.currentTarget.setPointerCapture(state.pointerId);
      } catch {
        /* capture is best effort */
      }
    }
    const from = projects.findIndex((p) => p.id === state.id);
    const over = Math.max(0, Math.min(projects.length - 1, from + Math.round(dy / rowHeight())));
    setDrag({ id: state.id, from, over, dy });
  };

  const finishPointer = (commit: boolean) => {
    const state = pointerRef.current;
    const current = dragRef.current;
    pointerRef.current = null;
    if (!state?.active) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    setDrag(null);
    if (commit && current && current.over !== current.from) {
      const ids = projects.map((p) => p.id);
      const [moved] = ids.splice(current.from, 1);
      ids.splice(current.over, 0, moved);
      onReorder(ids);
    }
  };

  if (projects.length === 0 && !showEmptyHint) return null;

  const height = rowHeight();
  const shiftFor = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return -height;
    if (drag.from > drag.over && index >= drag.over && index < drag.from) return height;
    return 0;
  };

  return (
    <div data-pinned-projects="" className="space-y-0.5">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1 px-2.5 pb-1 text-left text-[11px] font-semibold tracking-wide text-[var(--chat-text)] transition-colors"
      >
        <span>Pinned projects</span>
        <ChevronRight
          size={12}
          className={`flex-shrink-0 text-[var(--chat-muted)] transition-transform duration-200 ease-out ${
            isOpen ? 'rotate-90' : 'rotate-0'
          }`}
          aria-hidden="true"
        />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {isOpen && projects.length === 0 && (
        <p className="px-2.5 pb-1 text-[12px] leading-snug text-[var(--chat-muted)]">
          Pin a project to keep it here.
        </p>
      )}
      {isOpen &&
        projects.length > 0 && (
          <div role="list" aria-label="Pinned projects" className="space-y-0.5">
            {projects.map((project, index) => {
              const isDragging = drag?.id === project.id;
              const shift = isDragging ? drag.dy : shiftFor(index);
              const isActive = activeProjectId === project.id;
              return (
                <div
                  key={project.id}
                  role="listitem"
                  data-goo-row=""
                  data-pinned-project-row={project.id}
                  ref={(el) => {
                    if (el) rowEls.current.set(project.id, el);
                    else rowEls.current.delete(project.id);
                  }}
                  onPointerDown={(event) => onPointerDown(event, project.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => finishPointer(true)}
                  onPointerCancel={() => finishPointer(false)}
                  className={`group relative flex items-center rounded-lg ${
                    isActive ? 'bg-[var(--chat-hover)]' : ''
                  } ${isDragging ? 'z-10 shadow-sm' : drag ? 'transition-transform duration-150 ease-out' : ''}`}
                  style={{
                    transform: shift ? `translate3d(0, ${shift}px, 0)` : undefined,
                    touchAction: 'pan-y',
                    userSelect: drag ? 'none' : undefined,
                    backgroundColor: isDragging ? 'var(--chat-elevated)' : undefined,
                  }}
                >
                  <button
                    type="button"
                    data-pinned-project-open=""
                    title={project.name}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    aria-description={projects.length > 1 ? 'Alt plus arrow keys reorders this pinned project' : undefined}
                    onClick={() => {
                      if (suppressClickRef.current) return;
                      onOpen(project.id);
                    }}
                    onKeyDown={(event) => {
                      if (!event.altKey) return;
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        move(index, -1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        move(index, 1);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--chat-text)]"
                  >
                    <Folder size={15} className="flex-shrink-0 text-[var(--chat-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="text-[11px] text-[var(--chat-muted)] group-hover:hidden group-focus-within:hidden">
                      {project.count}
                    </span>
                  </button>
                  <IconButton
                    icon={BookmarkDecl}
                    iconState={{ selection: 'on' }}
                    variant="ghost"
                    size="xs"
                    iconSize={13}
                    data-pinned-project-unpin=""
                    aria-label={`Unpin ${project.name}`}
                    title="Unpin"
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      onUnpin(project.id);
                    }}
                    className="absolute right-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  />
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
};

export default PinnedProjectsSection;
