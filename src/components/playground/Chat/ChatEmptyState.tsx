import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Code2,
  FileClock,
  FolderUp,
  Library,
  MessageSquare,
  Plus,
  Search,
  Store,
} from 'lucide-react';
import ChatUpdateCarousel, { type ChatUpdate } from './ChatUpdateCarousel';
import {
  AGENT_HUB_MOCK_ACTIONS,
  CHAT_MODE_TABS,
  type AgentHubMockActionId,
  type ChatMode,
} from './chatModeConfig';

export type ChatEmptyStateTool = 'recent-files';

interface ChatEmptyStateProps {
  children: React.ReactNode;
  isActive: boolean;
  isCompact?: boolean;
  /** Hide the hover tool rail entirely (e.g. the project workspace composer). */
  hideToolRail?: boolean;
  activeMode: ChatMode;
  canAnalyzeDocument: boolean;
  modelSelector?: (options: { isInlineTray: boolean; onOpenChange: (isOpen: boolean) => void }) => React.ReactNode;
  onAgentActionSelect: (actionId: AgentHubMockActionId) => void;
  onModeChange: (mode: ChatMode) => void;
  onUploadFile: () => void;
  renderToolPanel?: (tool: ChatEmptyStateTool, close: () => void) => React.ReactNode;
  updates?: ChatUpdate[];
}

const starterClassName =
  'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.055] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70';

const modeIconById = {
  chat: MessageSquare,
  research: Search,
  code: Code2,
  agents: Bot,
} as const;

const agentActionIconById = {
  'create-agent': Plus,
  'my-agents': Library,
  'agent-marketplace': Store,
} as const;

const railButtonClassName =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.10] hover:bg-white/[0.06] hover:text-zinc-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-35';

const TOOLBAR_POINTER_CLOSE_DELAY_MS = 1000;
/** Blocks hover-reopen after a tool closes the rail while the pointer is still over it. */
const TOOLBAR_HOVER_REOPEN_SUPPRESS_MS = 350;
/** Cascade like the model tray, but slower + longer travel so 3 chips read as one-by-one from the right. */
const AGENT_ACTION_STAGGER_MS = 55;
const AGENT_ACTION_MOTION_DURATION_MS = 280;
const AGENT_ACTION_CLOSE_DURATION_MS = AGENT_ACTION_MOTION_DURATION_MS + AGENT_ACTION_STAGGER_MS * (AGENT_HUB_MOCK_ACTIONS.length - 1);

const agentActionButtonClassName =
  'chat-mode-action flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.018] px-2 text-[11px] font-medium text-zinc-400 transition-[background-color,border-color,color] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70';

const ChatEmptyState: React.FC<ChatEmptyStateProps> = ({
  children,
  isActive,
  isCompact = false,
  hideToolRail = false,
  activeMode,
  canAnalyzeDocument,
  modelSelector,
  onAgentActionSelect,
  onModeChange,
  onUploadFile,
  renderToolPanel,
  updates = [],
}) => {
  const railRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const agentActionsCloseTimerRef = useRef<number | null>(null);
  /** Blocks hover/focus from reopening the rail right after an intentional close (e.g. Upload). */
  const suppressHoverOpenRef = useRef(false);
  const [isRailOpen, setIsRailOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ChatEmptyStateTool | null>(null);
  const [areAgentActionsRendered, setAreAgentActionsRendered] = useState(activeMode === 'agents');
  const [areAgentActionsClosing, setAreAgentActionsClosing] = useState(false);
  /** Bumps on each open so CSS enter keyframes remount (browser won't replay the same animation name). */
  const [agentActionsEpoch, setAgentActionsEpoch] = useState(0);
  const [isModelTrayOpen, setIsModelTrayOpen] = useState(false);
  const previousModeRef = useRef(activeMode);

  const clearAgentActionsCloseTimer = useCallback(() => {
    if (agentActionsCloseTimerRef.current !== null) {
      window.clearTimeout(agentActionsCloseTimerRef.current);
      agentActionsCloseTimerRef.current = null;
    }
  }, []);

  const openAgentActions = useCallback(() => {
    clearAgentActionsCloseTimer();
    setAreAgentActionsClosing(false);
    setAreAgentActionsRendered(true);
    setAgentActionsEpoch((epoch) => epoch + 1);
  }, [clearAgentActionsCloseTimer]);

  const closeAgentActions = useCallback((afterClose: () => void) => {
    clearAgentActionsCloseTimer();
    setAreAgentActionsClosing(true);

    agentActionsCloseTimerRef.current = window.setTimeout(() => {
      agentActionsCloseTimerRef.current = null;
      setAreAgentActionsRendered(false);
      setAreAgentActionsClosing(false);
      afterClose();
    }, AGENT_ACTION_CLOSE_DURATION_MS);
  }, [clearAgentActionsCloseTimer]);

  const closeRail = useCallback((options?: { suppressHoverReopen?: boolean }) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    // Tool actions close while the pointer is often still over the rail. Without this,
    // the collapsed handle re-fires mouseenter and the toolbar pops open again.
    if (options?.suppressHoverReopen) {
      suppressHoverOpenRef.current = true;
      window.setTimeout(() => {
        suppressHoverOpenRef.current = false;
      }, TOOLBAR_HOVER_REOPEN_SUPPRESS_MS);
    }
    setIsRailOpen(false);
    setActiveTool(null);
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      ((railRef.current?.contains(active) ?? false) || (handleRef.current?.contains(active) ?? false))
    ) {
      active.blur();
    }
  }, []);

  const keepRailOpen = () => {
    if (suppressHoverOpenRef.current) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsRailOpen(true);
  };

  const schedulePointerClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      const stillHovered = (railRef.current?.matches(':hover') ?? false) ||
        (handleRef.current?.matches(':hover') ?? false);
      const stillFocused = (railRef.current?.contains(document.activeElement) ?? false) ||
        (handleRef.current?.contains(document.activeElement) ?? false);
      if (!stillHovered && !stillFocused) closeRail();
    }, TOOLBAR_POINTER_CLOSE_DELAY_MS);
  };

  const handleInteractionBlur = () => {
    window.requestAnimationFrame(() => {
      const rail = railRef.current;
      if (rail?.dataset.activeTool && document.activeElement === document.body) {
        rail.querySelector<HTMLButtonElement>('[data-tool-panel-close]')?.focus();
        return;
      }

      const focusIsStillInTools = (rail?.contains(document.activeElement) ?? false) ||
        (handleRef.current?.contains(document.activeElement) ?? false);
      if (!focusIsStillInTools) closeRail();
    });
  };

  useEffect(() => {
    if (!isRailOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeRail({ suppressHoverReopen: true });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeRail, isRailOpen]);

  useEffect(() => {
    if (!activeTool) return;

    const frame = window.requestAnimationFrame(() => {
      railRef.current?.querySelector<HTMLButtonElement>('[data-tool-panel-close]')?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTool]);

  useEffect(() => {
    const wasAgents = previousModeRef.current === 'agents';
    previousModeRef.current = activeMode;

    if (activeMode === 'agents') {
      // Only open on a real mode enter. Do not re-assert while already on Agents —
      // that would clear an in-progress close timer and drop afterClose (e.g. action select).
      if (!wasAgents) {
        openAgentActions();
      }
      return;
    }

    clearAgentActionsCloseTimer();
    setAreAgentActionsRendered(false);
    setAreAgentActionsClosing(false);
  }, [activeMode, clearAgentActionsCloseTimer, openAgentActions]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (agentActionsCloseTimerRef.current !== null) window.clearTimeout(agentActionsCloseTimerRef.current);
  }, []);

  // Close the rail when switching empty ↔ conversation so it doesn't stay stuck open.
  useEffect(() => {
    setIsRailOpen(false);
    setActiveTool(null);
  }, [isActive]);

  const openTool = (tool: ChatEmptyStateTool) => {
    setIsRailOpen(true);
    setActiveTool(tool);
  };

  // Same hover tool rail on empty state and in conversation (upload / recent files).
  const showToolRail = !isCompact && !hideToolRail;
  const isOuterExpanded = showToolRail && isRailOpen;
  const extensionPositionClass = activeTool && !isCompact
    ? 'left-[3.25rem] right-auto'
    : 'left-0 right-auto';
  const extensionSurfaceClass = activeTool
    ? 'rounded-[1.4rem] border border-white/[0.10] bg-[#141416] shadow-none'
    : 'border border-transparent bg-transparent shadow-none';
  const outerWidthClass = isOuterExpanded ? 'w-[calc(100%_+_3.25rem)] delay-0' : 'w-full delay-100';
  const railExpandedWidthClass = activeTool === 'recent-files'
    ? 'w-[min(18rem,88%)] md:w-[18rem]'
    : 'w-[min(15rem,88%)] md:w-[15rem]';

  const handleModeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % CHAT_MODE_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + CHAT_MODE_TABS.length) % CHAT_MODE_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = CHAT_MODE_TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = CHAT_MODE_TABS[nextIndex].id;
    onModeChange(nextMode);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-chat-mode="${nextMode}"]`)?.focus();
    });
  };

  const handleModeSelect = (mode: ChatMode) => {
    if (isModelTrayOpen) setIsModelTrayOpen(false);

    if (mode === 'agents' && activeMode === 'agents') {
      if (areAgentActionsClosing) {
        openAgentActions();
        return;
      }

      if (areAgentActionsRendered) {
        closeAgentActions(() => onModeChange('chat'));
        return;
      }
    }

    onModeChange(mode);
  };

  // In the narrow project workspace: when Agents opens, replace the mode tabs with the
  // agent actions (same idea as the model tray). Keeps one fixed-height row; nothing overflows.
  const showAgentActionsInPlace = hideToolRail && areAgentActionsRendered;

  const renderAgentActionButtons = () =>
    AGENT_HUB_MOCK_ACTIONS.map((action) => {
      const Icon = agentActionIconById[action.id];
      const actionIndex = AGENT_HUB_MOCK_ACTIONS.indexOf(action);
      // Enter: from behind the mode tabs, left → right (Create first). Exit: reverse.
      const animationDelay = areAgentActionsClosing
        ? (AGENT_HUB_MOCK_ACTIONS.length - 1 - actionIndex) * AGENT_ACTION_STAGGER_MS
        : actionIndex * AGENT_ACTION_STAGGER_MS;

      return (
        <button
          key={`${action.id}-${agentActionsEpoch}`}
          type="button"
          data-mock-action="true"
          className={`${agentActionButtonClassName} ${
            areAgentActionsClosing ? 'animate-agent-action-exit' : 'animate-agent-action-enter'
          }`}
          style={{ animationDelay: `${animationDelay}ms` }}
          onClick={() => closeAgentActions(() => onAgentActionSelect(action.id))}
        >
          <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
          <span>{action.label}</span>
        </button>
      );
    });

  const modeControls = (
    <div
      data-mode-controls
      className={`flex min-w-0 items-center justify-between gap-2 ${
        hideToolRail
          ? // Project workspace: hard-lock one control row so Agents / model never grow the shell.
            'h-9 flex-nowrap overflow-hidden'
          : `flex-wrap ${isActive ? 'min-h-[42px]' : 'min-h-[30px]'}`
      }`}
    >
      <div
        key={isModelTrayOpen ? 'model-tray-open' : 'mode-controls-visible'}
        className={`flex h-full min-w-0 items-center gap-1.5 ${
          isModelTrayOpen
            ? 'hidden'
            : 'motion-safe:animate-mode-controls-enter motion-reduce:animate-none'
        } ${isCompact || hideToolRail ? 'min-w-0 flex-1 overflow-x-auto hide-scrollbar' : 'flex-1'}`}
      >
        {showAgentActionsInPlace ? (
          <div
            role="toolbar"
            aria-label="Agent actions"
            data-agent-actions-state={areAgentActionsClosing ? 'closing' : 'open'}
            className="flex h-full min-w-max items-center gap-1"
          >
            <button
              type="button"
              onClick={() => closeAgentActions(() => onModeChange('chat'))}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.018] text-zinc-500 transition-[background-color,border-color,color] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${
                areAgentActionsClosing ? 'animate-agent-action-exit' : 'animate-agent-action-enter'
              }`}
              style={{
                animationDelay: `${
                  areAgentActionsClosing
                    ? AGENT_HUB_MOCK_ACTIONS.length * AGENT_ACTION_STAGGER_MS
                    : 0
                }ms`,
              }}
              aria-label="Back to chat modes"
              title="Back"
            >
              <ArrowLeft size={14} aria-hidden="true" />
            </button>
            {renderAgentActionButtons()}
          </div>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Chat mode"
              className="chat-mode-surface relative z-10 flex min-w-max items-center gap-1 rounded-xl border border-white/[0.06] bg-black/15 p-1"
            >
              {CHAT_MODE_TABS.map((mode, index) => {
                const Icon = modeIconById[mode.id];
                const isSelected = activeMode === mode.id;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    data-chat-mode={mode.id}
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    className={`chat-mode-tab ${starterClassName} ${
                      isSelected
                        ? 'chat-mode-tab-selected border-white/[0.13] bg-white/[0.085] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                        : 'border-transparent bg-transparent text-zinc-500'
                    }`}
                    onClick={() => handleModeSelect(mode.id)}
                    onKeyDown={(event) => handleModeKeyDown(event, index)}
                  >
                    <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                    <span>{mode.label}</span>
                  </button>
                );
              })}
            </div>

            {areAgentActionsRendered && (
              <div
                role="toolbar"
                aria-label="Agent actions"
                data-agent-actions-state={areAgentActionsClosing ? 'closing' : 'open'}
                className="relative z-0 -ml-1 flex min-w-max items-center gap-1"
              >
                {renderAgentActionButtons()}
              </div>
            )}
          </>
        )}
      </div>

      {activeMode !== 'agents' && modelSelector && (
        <div
          data-empty-state-model-selector
          className={`ml-auto mr-2 flex h-full min-w-0 items-center justify-end ${
            // Same as new/existing chat: when the model tray opens it takes the row
            // (inline chips), mode tabs hide — shell height stays fixed.
            isModelTrayOpen ? 'min-w-0 flex-1' : 'flex-shrink-0'
          }`}
        >
          {modelSelector({
            isInlineTray: isModelTrayOpen,
            onOpenChange: setIsModelTrayOpen,
          })}
        </div>
      )}
    </div>
  );

  // Shell geometry must match empty + conversation:
  // parent owns container-type (stable cqw); shell grows left with self-end + outerWidthClass;
  // composer column stays ~100cqw so the rail sits beside content, never on top of it.
  const composerShell = (
    <div
      data-chat-composer-shell
      data-composer-context={isActive ? 'empty' : 'conversation'}
      data-rail-open={showToolRail && isRailOpen ? 'true' : 'false'}
      data-active-tool={showToolRail ? (activeTool ?? '') : ''}
      className={`relative z-20 overflow-visible rounded-2xl border border-white/[0.10] bg-[#141416] transition-[width] duration-200 ease-out ${
        showToolRail ? `self-end ${outerWidthClass}` : 'w-full'
      }`}
    >
      {showToolRail && (
        <>
          <button
            ref={handleRef}
            type="button"
            data-tool-rail-handle
            aria-label={isRailOpen ? 'Close composer tools' : 'Open composer tools'}
            aria-expanded={isRailOpen}
            onClick={() => {
              if (isRailOpen) {
                closeRail({ suppressHoverReopen: true });
                return;
              }
              suppressHoverOpenRef.current = false;
              setIsRailOpen(true);
            }}
            onMouseEnter={keepRailOpen}
            onMouseLeave={schedulePointerClose}
            onFocus={keepRailOpen}
            onBlur={handleInteractionBlur}
            className={`absolute left-[-1.25rem] top-1/2 z-30 h-12 w-4 -translate-y-1/2 rounded-md transition-opacity duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${isRailOpen ? 'pointer-events-none opacity-0 delay-0' : 'opacity-100 delay-300'}`}
          >
            <span
              data-tool-rail-indicator
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 block h-8 w-px -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
            <span
              data-tool-rail-echo="medium"
              aria-hidden="true"
              className="absolute left-[3px] top-1/2 block h-4 w-px -translate-y-1/2 rounded-full"
            />
          </button>

          <aside
            ref={railRef}
            data-toolbar-extension
            data-active-tool={activeTool ?? ''}
            aria-label="Composer tools"
            aria-hidden={!isRailOpen}
            onMouseEnter={keepRailOpen}
            onMouseLeave={schedulePointerClose}
            onFocusCapture={keepRailOpen}
            onBlurCapture={handleInteractionBlur}
            className={`absolute inset-y-[-1px] z-20 flex overflow-hidden transition-opacity duration-100 ease-out ${extensionPositionClass} ${extensionSurfaceClass} ${
              activeTool
                ? railExpandedWidthClass
                : 'w-[3.25rem]'
            } ${
              isRailOpen
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
          >
            {activeTool ? (
              <div className="h-full min-h-0 w-full p-3">
                {renderToolPanel?.(activeTool, () => closeRail({ suppressHoverReopen: true }))}
              </div>
            ) : (
              <div className={`flex w-[3.25rem] flex-shrink-0 flex-col items-center justify-center gap-1.5 py-3 transition-opacity duration-100 ${isRailOpen ? 'opacity-100 delay-100' : 'opacity-0 delay-0'}`}>
                <button
                  type="button"
                  className={railButtonClassName}
                  onClick={() => {
                    onUploadFile();
                    closeRail({ suppressHoverReopen: true });
                  }}
                  disabled={!canAnalyzeDocument}
                  aria-label="Upload file"
                  title="Upload file"
                >
                  <FolderUp size={16} />
                </button>
                <button
                  type="button"
                  className={railButtonClassName}
                  onClick={() => openTool('recent-files')}
                  aria-label="Recent files"
                  title="Recent files"
                >
                  <FileClock size={16} />
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      <div
        data-composer-column
        className={`relative z-10 ml-auto flex w-full min-w-0 flex-col ${
          showToolRail
            ? `${isActive ? 'gap-2.5 p-3' : 'gap-1.5 p-2'} pl-7 [width:calc(100cqw_-_2px)] md:pl-3`
            : 'gap-1.5 p-2'
        }`}
      >
        {modeControls}
        <div className="w-full">{children}</div>
      </div>
    </div>
  );

  if (!isActive) {
    // Same containment model as the empty-state section: cqw is measured here,
    // not on the expanding shell — otherwise the rail paints over the prompt.
    return (
      <div
        data-conversation-composer-frame
        className="relative flex w-full flex-col overflow-visible [container-type:inline-size]"
      >
        {composerShell}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="chat-empty-state-title"
      className="relative flex w-full flex-col items-center gap-4 overflow-visible [container-type:inline-size] md:gap-5"
    >
      <h1
        id="chat-empty-state-title"
        className="-translate-y-6 text-center font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-zinc-100 sm:text-[2.5rem]"
      >
        What would you like to explore?
      </h1>

      {composerShell}

      {/* Out of flow: updates must not change the centered title/composer height. */}
      {updates.length > 0 && (
        <div
          data-update-carousel-slot
          className="pointer-events-none absolute left-0 right-0 top-full z-0 mt-4 w-full"
        >
          <div className="pointer-events-auto w-full">
            <ChatUpdateCarousel updates={updates} />
          </div>
        </div>
      )}
    </section>
  );
};

export default ChatEmptyState;
