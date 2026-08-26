import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@xenosystem/elements-react';
import {
  Bot,
  Code2,
  MessageSquare,
  Search,
  ArrowRightDecl,
  FolderUpDecl,
  LibraryDecl,
  PlusDecl,
  StoreDecl,
} from '@/lib/icons';
import ChatUpdateCarousel, { type ChatUpdate } from './ChatUpdateCarousel';
import {
  AGENT_HUB_MOCK_ACTIONS,
  CHAT_MODE_TABS,
  type AgentHubMockActionId,
  type ChatMode,
} from './chatModeConfig';
import {
  AGENT_CHAIN,
  chainDurationMs,
  reverseDelays,
  GOOEY_FILTER_ID,
  TAB_CHAIN,
  TAB_REVEAL,
  runGooey,
} from './composerGooey';

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
  /**
   * Rendered in the floating row, in the gap between the mode tabs and the model chip.
   * The scroll-to-bottom pill lives there while the row is up, because the row is out of
   * flow and would otherwise open straight on top of it.
   */
  scrollAffordance?: React.ReactNode;
  isTemporaryChat?: boolean;
  updates?: ChatUpdate[];
}

/**
 * Lets the composer's own control row (rendered as `children`, over in ChatWithLLM)
 * drive the reveal without threading props through the whole tree.
 */
interface ChatComposerRevealValue {
  isOpen: boolean;
  toggle: () => void;
  canAnalyzeDocument: boolean;
  onUploadFile: () => void;
}

const ChatComposerRevealContext = React.createContext<ChatComposerRevealValue | null>(null);

/**
 * The "+" that reveals the mode tabs / model chip, plus the Upload action that comes out
 * with it. Rendered by the composer's control row so both sit bottom-left in the box.
 */
export const ComposerRevealControls: React.FC = () => {
  const reveal = useContext(ChatComposerRevealContext);

  if (!reveal) return null;

  return (
    <>
      {/* The turn is not a second icon: one plus, rotated 135° into a close. `.chat-icon-turn` reads
          the state off `aria-expanded`, which this button already sets — see chat-theme.css. */}
      <IconButton
        icon={PlusDecl}
        variant="quiet"
        size="sm"
        className="chat-icon-turn"
        data-composer-reveal-trigger
        aria-expanded={reveal.isOpen}
        aria-label={reveal.isOpen ? 'Hide chat modes' : 'Show chat modes'}
        title={reveal.isOpen ? 'Hide chat modes' : 'Show chat modes'}
        onClick={reveal.toggle}
      />

      <span
        className={`inline-flex overflow-hidden transition-[width,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] ${
          reveal.isOpen ? 'w-8 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <IconButton
          icon={FolderUpDecl}
          variant="quiet"
          size="sm"
          iconSize={15}
          /* Dropped when this became an IconButton, on a grep that only looked at `src/`.
             `scripts/test-chat-empty-state.mjs` is what reaches for it, and it had been red since. */
          data-composer-upload
          onClick={reveal.onUploadFile}
          disabled={!reveal.canAnalyzeDocument}
          aria-label="Upload file"
          title="Upload file"
          tabIndex={reveal.isOpen ? 0 : -1}
        />
      </span>
    </>
  );
};

const starterClassName =
  'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)]';

const modeIconById = {
  chat: MessageSquare,
  research: Search,
  code: Code2,
  agents: Bot,
} as const;

/* Declarations, not components: `Button` composes a glyph through its own renderer, so what a call
   site names is the declaration. The three of them are the same marks the components drew. */
const agentActionIconById = {
  'create-agent': PlusDecl,
  'my-agents': LibraryDecl,
  'agent-marketplace': StoreDecl,
} as const;

const TOOLBAR_POINTER_CLOSE_DELAY_MS = 1000;
/** Blocks hover-reopen after a tool closes the rail while the pointer is still over it. */
const TOOLBAR_HOVER_REOPEN_SUPPRESS_MS = 350;
/**
 * Upload now lives next to the "+" inside the box, so the left hover rail has nothing
 * left to show. Kept behind a flag rather than deleted — `renderToolPanel` is still part
 * of the public props and the panel plumbing is the only place that knows about it.
 */
const LEGACY_HOVER_TOOL_RAIL: boolean = false;
/** The strip plays its gooey chain backwards on close; wait it out before unmounting. */
const AGENT_ACTION_CLOSE_DURATION_MS = chainDurationMs(AGENT_HUB_MOCK_ACTIONS.length + 1, AGENT_CHAIN);

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
  scrollAffordance,
  isTemporaryChat = false,
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

  // ── Gooey reveal ────────────────────────────────────────────────────────────
  const revealRootRef = useRef<HTMLDivElement>(null);
  const skinRef = useRef<HTMLDivElement>(null);
  const revealRowRef = useRef<HTMLDivElement>(null);
  const [isRevealOpen, setIsRevealOpen] = useState(false);
  /** Stays true through the retract so the row can animate back down before it hides. */
  const [isRevealRowVisible, setIsRevealRowVisible] = useState(false);
  const [isMelting, setIsMelting] = useState(false);
  /** Where the Agents tab sat when it was clicked — its rail is born inside it. */
  const agentsOriginRef = useRef<DOMRect | null>(null);
  /**
   * Remounting the model selector is the only way to close its tray from out here — it
   * owns that state itself. Bumped when the reveal closes.
   */
  const [modelSelectorEpoch, setModelSelectorEpoch] = useState(0);
  /**
   * Read inside animation callbacks that fire long after the render that scheduled them.
   * Putting these in the effect's deps instead would restart the reveal on every mode change.
   */
  const latestRef = useRef({ activeMode, onModeChange });
  latestRef.current = { activeMode, onModeChange };

  const toggleReveal = useCallback(() => {
    setIsRevealOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (isRevealOpen) setIsRevealRowVisible(true);
  }, [isRevealOpen]);

  // The mode tabs + model chip climb straight out of the box, staggered left → right.
  // Layout effect, not a plain one: the row is already visible by the time effects run,
  // so anything deferred past paint shows the tabs at rest for a frame before they drop
  // back into the box to climb out again.
  useLayoutEffect(() => {
    if (!isRevealRowVisible) return;

    const skin = skinRef.current;
    const row = revealRowRef.current;
    if (!skin || !row) return;

    // Whatever is standing in the row right now, not just the mode tabs. Close the "+"
    // while the Agents rail is up and the tabs are not there at all — looking only for
    // them found nothing, bailed, and left the row stuck open with the agent actions in it.
    const items = Array.from(row.querySelectorAll<HTMLElement>('[data-gooey-tab], [data-gooey-chip]'));

    if (items.length === 0) {
      if (!isRevealOpen) setIsRevealRowVisible(false);
      return;
    }

    const direction = isRevealOpen ? 'in' : 'out';
    const delays = items.map((_, index) => (
      (direction === 'in' ? index : items.length - 1 - index) * TAB_REVEAL.staggerMs
    ));

    setIsMelting(true);
    const cancel = runGooey({
      skin,
      items,
      delays,
      durationMs: TAB_REVEAL.durationMs,
      chain: false,
      direction,
      onSettled: () => {
        setIsMelting(false);
        if (direction !== 'out') return;

        setIsRevealRowVisible(false);
        // Reopening starts fresh. Closing while a rail was up used to bring that same rail
        // straight back — the "+" should always offer the main buttons again. Done here,
        // after the retract, so the rail animates out before it is torn down.
        setIsModelTrayOpen(false);
        setModelSelectorEpoch((epoch) => epoch + 1);
        if (latestRef.current.activeMode === 'agents') latestRef.current.onModeChange('chat');
      },
    });

    return cancel;
  }, [isRevealOpen, isRevealRowVisible]);

  // The rails (agent actions, model chips) render themselves; watch for the DOM landing
  // and chain them out of whatever control opened them.
  useLayoutEffect(() => {
    if (!isRevealOpen) return;

    const skin = skinRef.current;
    const row = revealRowRef.current;
    if (!skin || !row || typeof window.MutationObserver === 'undefined') return;

    const cancels = new Map<HTMLElement, () => void>();

    const lastChips = new WeakMap<HTMLElement, HTMLElement[]>();

    /** The entrance clock for a rail: which chip moves when, and so who is born inside whom. */
    const entranceDelays = (rail: HTMLElement, count: number, staggerMs: number) => {
      const isRightToLeft = rail.dataset.gooeyDir === 'rtl';
      return Array.from({ length: count }, (_, index) => (
        (isRightToLeft ? count - 1 - index : index) * staggerMs
      ));
    };

    const runRail = (rail: HTMLElement, direction: 'in' | 'out' = 'in') => {
      const chips = Array.from(rail.querySelectorAll<HTMLElement>('[data-gooey-chip]'));
      if (chips.length === 0) return;

      // Closing plays the entrance backwards: same chain, same necks, reversed clock —
      // whatever arrived last melts away first, back into the chip it came out of.
      if (direction === 'out') {
        cancels.get(rail)?.();
        cancels.delete(rail);
        lastChips.delete(rail);

        const config = AGENT_CHAIN;
        const entrance = entranceDelays(rail, chips.length, config.staggerMs);
        const fromSelector = rail.dataset.gooeyFrom;

        cancels.set(rail, runGooey({
          skin,
          items: chips,
          delays: reverseDelays(entrance),
          orderDelays: entrance,
          durationMs: config.durationMs,
          chain: true,
          direction: 'out',
          fromEl: fromSelector ? row.querySelector<HTMLElement>(fromSelector) : null,
          clip: rail.closest<HTMLElement>('[data-gooey-clip]'),
          onSettled: () => cancels.delete(rail),
        }));
        return;
      }

      // React re-renders a rail for reasons that have nothing to do with its line-up (the
      // settle flag, a hover class), and replaying the chain then is both wrong and visible.
      // Compare node IDENTITY, not labels: reopening Agents yields the same three labels on
      // brand-new nodes, so a label-based check skipped that run entirely — which is exactly
      // why the agent actions sometimes appeared with no animation at all.
      const previous = lastChips.get(rail);
      if (previous?.length === chips.length && previous.every((node, i) => node === chips[i])) return;
      lastChips.set(rail, chips);

      cancels.get(rail)?.();
      cancels.delete(rail);

      const config = AGENT_CHAIN;
      const delays = entranceDelays(rail, chips.length, config.staggerMs);
      const fromSelector = rail.dataset.gooeyFrom;
      const fromEl = fromSelector ? row.querySelector<HTMLElement>(fromSelector) : null;

      cancels.set(rail, runGooey({
        skin,
        items: chips,
        delays,
        durationMs: config.durationMs,
        chain: true,
        fromEl,
        // The Agents tab is replaced by the rail it opens, so by now it is gone —
        // fall back to the rect captured just before the swap.
        fromRect: fromEl ? null : agentsOriginRef.current,
        clip: rail.closest<HTMLElement>('[data-gooey-clip]'),
        onSettled: () => cancels.delete(rail),
      }));
    };


    /** A rail marks itself `closing` before it unmounts; that is the cue to play it out. */
    const closingRailFrom = (node: Node): HTMLElement | null => {
      if (!(node instanceof HTMLElement)) return null;
      const state = node.dataset.agentActionsState;
      if (state !== 'closing') return null;
      return node.matches('[data-gooey-rail]') ? node : null;
    };

    const observer = new window.MutationObserver((records) => {
      const rails = new Set<HTMLElement>();
      records.forEach((record) => {
        if (record.type === 'attributes') {
          const closing = closingRailFrom(record.target);
          if (closing) runRail(closing, 'out');
          return;
        }
        // Only a change to a rail's OWN children counts. Searching the mutation target's
        // subtree instead would also match the rail's siblings — the scroll-hint buttons
        // appear once the rail settles, which restarted the chain in an endless loop.
        if (record.target instanceof HTMLElement) {
          const own = record.target.closest<HTMLElement>('[data-gooey-rail]');
          if (own) rails.add(own);
        }
        // A whole rail mounting arrives as an added node, so that subtree is worth a look.
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('[data-gooey-rail]')) rails.add(node);
          node.querySelectorAll<HTMLElement>('[data-gooey-rail]').forEach((rail) => rails.add(rail));
        });
      });
      // Synchronously, NOT on a timer. A MutationObserver callback runs at the microtask
      // checkpoint of the commit that made the change — still before paint. Deferring it
      // by even one task let the browser paint the chips at rest first: the whole rail
      // flashed into view fully formed, vanished, and only then animated.
      rails.forEach((rail) => runRail(rail));
    });

    observer.observe(row, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-agent-actions-state'],
    });
    row.querySelectorAll<HTMLElement>('[data-gooey-rail]').forEach((rail) => runRail(rail));

    return () => {
      observer.disconnect();
      cancels.forEach((cancel) => cancel());
    };
  }, [isRevealOpen]);

  // Coming BACK to the mode tabs — from the agent actions, or from the model tray. The
  // tabs must not simply reappear: they unfold one out of the next, the same way the
  // rails they are replacing did. A DOM watcher cannot drive this, because the model
  // tray only toggles a `hidden` class on the tabs and never touches the DOM.
  const rowContentRef = useRef<'tabs' | 'agents' | 'model'>('tabs');
  useLayoutEffect(() => {
    const content = areAgentActionsRendered ? 'agents' : isModelTrayOpen ? 'model' : 'tabs';
    const previous = rowContentRef.current;
    rowContentRef.current = content;
    if (!isRevealOpen || !isRevealRowVisible) return;
    if (content !== 'tabs' || previous === 'tabs') return;

    const skin = skinRef.current;
    const row = revealRowRef.current;
    if (!skin || !row) return;

    const tabs = Array.from(row.querySelectorAll<HTMLElement>('[data-chat-mode]'));
    if (tabs.length === 0) return;
    const cancelTabs = runGooey({
      skin,
      items: tabs,
      delays: tabs.map((_, index) => index * TAB_CHAIN.staggerMs),
      durationMs: TAB_CHAIN.durationMs,
      chain: true,
    });

    // The model chip sits at the far right; chaining it off the last tab would send it
    // gliding across the whole row. It climbs out of the box instead, last in the cascade.
    const modelChip = row.querySelector<HTMLElement>('[data-chat-model-trigger]');
    const cancelModel = modelChip && previous === 'agents'
      ? runGooey({
        skin,
        items: [modelChip],
        delays: [tabs.length * TAB_CHAIN.staggerMs],
        durationMs: TAB_CHAIN.durationMs,
        chain: false,
      })
      : null;

    return () => {
      cancelTabs();
      cancelModel?.();
    };
  }, [areAgentActionsRendered, isModelTrayOpen, isRevealOpen, isRevealRowVisible]);

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

  // Escape closes the reveal, matching every other transient surface in the composer.
  useEffect(() => {
    if (!isRevealOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isModelTrayOpen) return;
      setIsRevealOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isModelTrayOpen, isRevealOpen]);

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

  const showToolRail = LEGACY_HOVER_TOOL_RAIL && !isCompact && !hideToolRail;
  const isOuterExpanded = showToolRail && isRailOpen;
  const extensionPositionClass = activeTool && !isCompact
    ? 'left-[3.25rem] right-auto'
    : 'left-0 right-auto';
  const extensionSurfaceClass = activeTool
    ? 'rounded-[1.4rem] border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-none'
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

    if (mode === 'agents') {
      // Grab the tab's rect BEFORE it is replaced by the rail growing out of it.
      agentsOriginRef.current = revealRowRef.current
        ?.querySelector<HTMLElement>('[data-chat-mode="agents"]')
        ?.getBoundingClientRect() ?? null;
    }

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

  // The agent actions REPLACE the mode tabs (same idea as the model tray) rather than
  // sitting beside them. The floating row is exactly as wide as the box, and tabs +
  // three actions overflow it — "Agent Marketplace" ran off the right edge.
  const showAgentActionsInPlace = areAgentActionsRendered;

  const renderAgentActionButtons = () =>
    AGENT_HUB_MOCK_ACTIONS.map((action) => {
      return (
        /* Border and a `--chat-control` fill is `secondary`, which is what the shared class string
           spelled out and what the component now supplies — measured on the page: #fafafa on
           rgb(38,38,38) with a hairline, exactly the old chip.
           `size` is inert here, and that is worth knowing rather than hiding. index.css treats the
           tabs, the agent actions, the model chip and the model trigger as ONE family and pins the
           whole family with `!important` — 34px tall, 13px type, 10px radius, 0 13px padding — so
           whatever token this names, the row wins. `md` is the honest label for the box the class
           string described; it is simply not the box that renders.
           `data-gooey-chip` is load-bearing: index.css reaches for it to pour these out of the
           composer, and `chat-mode-action` is how the family rule finds them. */
        <Button
          key={`${action.id}-${agentActionsEpoch}`}
          variant="secondary"
          size="md"
          leadingIcon={agentActionIconById[action.id]}
          className="chat-mode-action whitespace-nowrap"
          data-mock-action="true"
          ref={(button) => {
            // React's component prop types reject arbitrary data attributes even though
            // Button forwards them. A commit-time ref still marks the node before the
            // MutationObserver microtask drives the rail entrance.
            if (button) button.dataset.gooeyChip = 'true';
          }}
          onClick={() => closeAgentActions(() => onAgentActionSelect(action.id))}
        >
          {action.label}
        </Button>
      );
    });

  const modeControls = (
    <div
      data-mode-controls
      className={`flex min-w-0 items-center justify-between gap-2 ${
        hideToolRail
          ? // Project workspace: hard-lock one control row so Agents / model never grow the shell.
            'h-9 flex-nowrap overflow-hidden'
          : 'min-h-[34px] flex-nowrap'
      }`}
    >
      <div
        className={`flex h-full min-w-0 items-center gap-1.5 ${
          isModelTrayOpen ? 'hidden' : ''
        } ${isCompact || hideToolRail ? 'min-w-0 flex-1' : 'flex-1'}`}
      >
        {showAgentActionsInPlace ? (
          <div
            role="toolbar"
            aria-label="Agent actions"
            data-agent-actions-state={areAgentActionsClosing ? 'closing' : 'open'}
            data-gooey-rail="agents"
            data-gooey-dir="ltr"
            data-gooey-from="[data-chat-mode='agents']"
            className="flex h-full min-w-max items-center gap-1.5"
          >
            <IconButton
              icon={ArrowRightDecl}
              className="chat-icon-flip-x"
              variant="quiet"
              size="md"
              iconSize={14}
              onClick={() => closeAgentActions(() => onModeChange('chat'))}
              aria-label="Back to chat modes"
            />
            {renderAgentActionButtons()}
          </div>
        ) : (
          <div
            role="tablist"
            aria-label="Chat mode"
            className="relative z-10 flex max-w-full min-w-max items-center gap-1.5 overflow-x-auto overscroll-contain hide-scrollbar"
          >
              {CHAT_MODE_TABS.map((mode, index) => {
                const Icon = modeIconById[mode.id];
                const isSelected = activeMode === mode.id;

                return (
                  /* Stays hand-written, and the blocker is a TOKEN rather than a shape. Unselected,
                     these sit on `--chat-overlay`, which is one of the few chat colours with no
                     `--xeno-` twin — the bridge in chat-theme.css carries eleven and this is not one
                     of them, so no variant can name the fill they rest on. Selected they take
                     `--chat-control` with a `--chat-muted` border, which is `secondary` with the
                     border brightened, and that half would convert cleanly.
                     The goo is the second half: `data-gooey-tab` drives a pill that travels between
                     tabs on a layer above them, and it is the product's, not the library's. */
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    data-chat-mode={mode.id}
                    data-gooey-tab
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    className={`chat-mode-tab ${starterClassName} ${
                      isSelected
                        ? 'chat-mode-tab-selected border-[var(--chat-muted)] bg-[var(--chat-control)] text-[var(--chat-text)]'
                        : 'border-[var(--chat-border)] bg-[var(--chat-overlay)] text-[var(--chat-muted)]'
                    }`}
                    onClick={() => handleModeSelect(mode.id)}
                    onKeyDown={(event) => handleModeKeyDown(event, index)}
                  >
                    <span className="flex items-center gap-1.5">
                      {/* `strokeWidth={1.8}` used to be here, and it reached the `<svg>`: measured on
                          the running chat, these four tabs drew at 1.8 while the other sixty-nine
                          glyphs on the page drew at 1.75. They are the most prominent chips in the
                          empty state, so the one place the drift showed was the first thing anyone
                          sees. The contract carries the weight; a call site should not restate it,
                          because a restated number is one that can be restated WRONG. */}
                      <Icon size={13} aria-hidden="true" />
                      <span>{mode.label}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {/* Sits in the gap between the tabs and the model chip, where flexbox centres it
            for free. It rides inside this group on purpose: the group is hidden while the
            model tray is open, and the tray fills the row edge to edge — there is no gap
            left to sit in, so the affordance steps aside with it. */}
        {scrollAffordance && (
          <div data-composer-reveal-affordance className="flex min-w-0 flex-1 items-center justify-center">
            {scrollAffordance}
          </div>
        )}
      </div>

      {activeMode !== 'agents' && modelSelector && (
        <div
          // The key remounts the selector when the reveal closes, which is what actually
          // shuts its tray — the open/closed state lives inside that component.
          key={modelSelectorEpoch}
          data-empty-state-model-selector
          className={`ml-auto flex h-full min-w-0 items-center justify-end ${
            // When the model tray opens it takes the row (inline chips) and the mode
            // tabs hide — the floating row keeps its height either way.
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
  /*
   * `data-rail-open` and `data-active-tool` below are Unread on purpose.
   *
   * Both mirror `LEGACY_HOVER_TOOL_RAIL`, which is a hardcoded `false`. So they are not unread STATE —
   * they are constants, and always have been: the first resolves to `'false'` and the second to `''`
   * on every render there has ever been.
   *
   * Deleting them is the wrong read of that. The `: boolean` annotation on the flag exists so
   * TypeScript will not narrow it to `false` and call the branch dead — that is someone parking a
   * feature deliberately, not forgetting one. Stripping its two state mirrors would leave the parked
   * rail needing them written again by whoever un-parks it. Whether the legacy rail goes at all is a
   * product call; until it is made, these stay and say why.
   */
  const composerShell = (
    <div
      data-chat-composer-shell
      data-composer-context={isActive ? 'empty' : 'conversation'}
      data-rail-open={showToolRail && isRailOpen ? 'true' : 'false'}
      data-active-tool={showToolRail ? (activeTool ?? '') : ''}
      className={`relative z-10 overflow-visible rounded-2xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] transition-[width,border-color] duration-200 ease-out ${
        showToolRail ? `self-end ${outerWidthClass}` : 'w-full'
      }`}
    >
      {showToolRail && (
        <>
          {/* Stays hand-written: a 16 × 48 grab target parked outside the composer's left edge, with
              no fill, no border, no label and no glyph of its own — it holds an indicator span and
              exists to be hovered. There is nothing here for a variant to decide. Same call as the
              five gradient scroll overlays. */}
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
            className={`absolute left-[-1.25rem] top-1/2 z-30 h-12 w-4 -translate-y-1/2 rounded-md transition-opacity duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)] ${isRailOpen ? 'pointer-events-none opacity-0 delay-0' : 'opacity-100 delay-300'}`}
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
                {/* `ghost`: no border at rest, muted ink, and hover brings both the fill and the
                    full text colour. The hand-written version also grew a border on hover; the
                    variant answers with the fill alone, which is the grammar the other seventy-odd
                    icon buttons in this chat already speak. */}
                <IconButton
                  icon={FolderUpDecl}
                  variant="ghost"
                  size="lg"
                  iconSize={16}
                  onClick={() => {
                    onUploadFile();
                    closeRail({ suppressHoverReopen: true });
                  }}
                  disabled={!canAnalyzeDocument}
                  aria-label="Upload file"
                  title="Upload file"
                />
              </div>
            )}
          </aside>
        </>
      )}

      {/* The inner field owns the padding now — the column would double it up. */}
      <div data-composer-column className="relative z-10 ml-auto flex w-full min-w-0 flex-col">
        <div className="w-full">{children}</div>
      </div>
    </div>
  );

  // The reveal root owns the stacking context the skin, the floating row and the box
  // all share — the skin has to be able to reach above the box to grow the tabs.
  const composerReveal = (
    <ChatComposerRevealContext.Provider
      value={{
        isOpen: isRevealOpen,
        toggle: toggleReveal,
        canAnalyzeDocument,
        onUploadFile,
      }}
    >
      <div
        ref={revealRootRef}
        data-composer-reveal
        data-melting={isMelting ? 'true' : 'false'}
        /* Anything sitting just above the composer needs to know the floating row is
           occupying that space — it is out of flow and reserves none of its own. */
        data-reveal-open={isRevealRowVisible ? 'true' : 'false'}
        /* z-20: the reveal root now owns the stacking the shell used to, so the composer
           (and its popovers) still paint above the updates carousel underneath. */
        className="relative z-20 w-full"
      >
        <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute pointer-events-none">
          <defs>
            {/* Clean metaball blend: blur and alpha crunch without artificial stroke overlay */}
            <filter id={GOOEY_FILTER_ID} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>

        {/* Scrim. The floating row opens over live conversation content — chips landing on
            top of body text and headings are unreadable. This fades the band out beneath
            them, and only while the row is actually up. */}
        <span data-composer-reveal-scrim aria-hidden="true" />

        <div ref={skinRef} aria-hidden="true" className="chat-gooey-skin">
          <span className="chat-gooey-body" />
        </div>

        <div
          ref={revealRowRef}
          data-composer-reveal-row
          data-reveal-state={isRevealRowVisible ? 'open' : 'closed'}
        >
          {modeControls}
        </div>

        {composerShell}
      </div>
    </ChatComposerRevealContext.Provider>
  );

  if (!isActive) {
    // Same containment model as the empty-state section: cqw is measured here,
    // not on the expanding shell — otherwise the rail paints over the prompt.
    return (
      <div
        data-conversation-composer-frame
        className="relative flex w-full flex-col overflow-visible [container-type:inline-size]"
      >
        {composerReveal}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="chat-empty-state-title"
      // The floating mode row is out of flow, so it reserves no space of its own and used
      // to open straight into the title. The gap here has to clear it: 34px of chips plus
      // the 16px it floats above the box, plus breathing room.
      className="relative flex w-full flex-col items-center gap-12 overflow-visible [container-type:inline-size] md:gap-14"
    >
      <div className="flex flex-col items-center">
        <div
          key={isTemporaryChat ? 'temporary-hero' : 'standard-hero'}
          className="chat-hero-text-enter flex flex-col items-center select-none"
        >
          <h1
            id="chat-empty-state-title"
            className="-translate-y-6 text-center font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--chat-text)] sm:text-[2.5rem]"
          >
            {isTemporaryChat ? 'Temporary Chat' : 'What would you like to explore?'}
          </h1>
          {isTemporaryChat && (
            <p className="-translate-y-2 text-center text-xs text-[var(--chat-muted)] max-w-md chat-hero-subtitle-enter">
              This chat won't appear in your history, use memories, or train models.
            </p>
          )}
        </div>
      </div>

      {composerReveal}

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
