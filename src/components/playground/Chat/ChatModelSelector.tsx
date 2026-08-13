import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { GroupedModels, Model } from '@/services/modelService';
import { chainDurationMs, MODEL_CHAIN } from './composerGooey';

interface ChatModelSelectorProps {
  groupedModels: GroupedModels[];
  isCompact?: boolean;
  isInlineTray?: boolean;
  isMinimal?: boolean;
  isLoading: boolean;
  isReasoningActive: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  onSelect: (model: Model) => void | Promise<void>;
  selectedModel: Model;
}

// Closing replays the gooey chain backwards (driven from the reveal root off the
// data-inline-model-actions-state flag), so the chips must stay mounted that long.
const inlineTrayCloseDuration = (visibleItemCount: number) => chainDurationMs(visibleItemCount, MODEL_CHAIN);

const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }

  return tokens.toString();
};

const ChatModelSelector: React.FC<ChatModelSelectorProps> = ({
  groupedModels,
  isCompact = false,
  isInlineTray = false,
  isMinimal = false,
  isLoading,
  isReasoningActive,
  onOpenChange,
  onSelect,
  selectedModel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isInlineTrayClosing, setIsInlineTrayClosing] = useState(false);
  const [activeInlineProvider, setActiveInlineProvider] = useState<string | null>(null);
  const [inlineRailScrollState, setInlineRailScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const [isInlineRailSettled, setIsInlineRailSettled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inlineRailRef = useRef<HTMLDivElement>(null);
  const inlineTrayCloseTimerRef = useRef<number | null>(null);
  const updateOpen = (nextIsOpen: boolean) => {
    setIsOpen(nextIsOpen);
    if (!nextIsOpen) {
      setActiveInlineProvider(null);
    }
    onOpenChange?.(nextIsOpen);
  };

  const clearInlineTrayCloseTimer = () => {
    if (inlineTrayCloseTimerRef.current !== null) {
      window.clearTimeout(inlineTrayCloseTimerRef.current);
      inlineTrayCloseTimerRef.current = null;
    }
  };

  const closeInlineTray = (afterClose?: () => void) => {
    if (isInlineTrayClosing) return;

    if (!isInlineTray) {
      updateOpen(false);
      afterClose?.();
      return;
    }

    clearInlineTrayCloseTimer();
    setIsInlineTrayClosing(true);
    // +1 for the Back arrow: inside a provider it is a chip in the chain too, and
    // undercounting cut the last chip's retreat off.
    const visibleItemCount = activeInlineProviderGroup ? activeInlineProviderGroup.models.length + 1 : inlineProviderGroups.length;
    const closeDuration = inlineTrayCloseDuration(visibleItemCount);

    inlineTrayCloseTimerRef.current = window.setTimeout(() => {
      inlineTrayCloseTimerRef.current = null;
      setIsInlineTrayClosing(false);
      updateOpen(false);
      afterClose?.();
    }, closeDuration);
  };

  const transitionInlineProvider = (nextProvider: string | null) => {
    if (isInlineTrayClosing) return;

    if (!isInlineTray) {
      setActiveInlineProvider(nextProvider);
      return;
    }

    clearInlineTrayCloseTimer();
    setIsInlineTrayClosing(true);
    // +1 for the Back arrow: inside a provider it is a chip in the chain too, and
    // undercounting cut the last chip's retreat off.
    const visibleItemCount = activeInlineProviderGroup ? activeInlineProviderGroup.models.length + 1 : inlineProviderGroups.length;
    const closeDuration = inlineTrayCloseDuration(visibleItemCount);

    inlineTrayCloseTimerRef.current = window.setTimeout(() => {
      inlineTrayCloseTimerRef.current = null;
      setActiveInlineProvider(nextProvider);
      setIsInlineTrayClosing(false);
    }, closeDuration);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeInlineTray();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      closeInlineTray();
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  useEffect(() => () => clearInlineTrayCloseTimer(), []);

  const handleSelect = (model: Model) => {
    // Tell the parent only once the tray has finished closing. Announcing it up front
    // re-rendered these very chips mid-exit (a different one is "current" now), and React
    // rewrites `className` on that pass — which wiped the runtime gooey classes off them.
    // They snapped back to full size, then vanished again when the tray unmounted: the
    // chips appeared to close, come back, and close a second time.
    closeInlineTray(() => {
      void onSelect(model);
    });
  };

  const updateInlineRailScrollState = () => {
    const rail = inlineRailRef.current;

    if (!rail) return;

    const railBounds = rail.getBoundingClientRect();
    const overflowTolerance = 4;
    const visibleActions = [...rail.querySelectorAll<HTMLButtonElement>('button')];
    const nextState = {
      canScrollLeft: visibleActions.some(
        (action) => action.getBoundingClientRect().left < railBounds.left - overflowTolerance,
      ),
      canScrollRight: visibleActions.some(
        (action) => action.getBoundingClientRect().right > railBounds.right + overflowTolerance,
      ),
    };

    setInlineRailScrollState((currentState) => (
      currentState.canScrollLeft === nextState.canScrollLeft
      && currentState.canScrollRight === nextState.canScrollRight
        ? currentState
        : nextState
    ));
  };

  const scrollInlineRail = (direction: 'left' | 'right') => {
    const rail = inlineRailRef.current;

    if (!rail) return;

    const maxScrollLeft = Math.max(rail.scrollWidth - rail.clientWidth, 0);
    const distance = Math.max(Math.min(rail.clientWidth * 0.65, 240), 160);
    const targetScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, rail.scrollLeft + (direction === 'right' ? distance : -distance)),
    );

    if (typeof rail.scrollTo === 'function') {
      rail.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    } else {
      rail.scrollLeft = targetScrollLeft;
    }

    window.setTimeout(updateInlineRailScrollState, 180);
  };

  const inlineProviderGroups = groupedModels.filter((group) => group.models.length > 0);
  const activeInlineProviderGroup = inlineProviderGroups.find(
    (group) => group.companyName === activeInlineProvider,
  );
  const selectedProviderName = inlineProviderGroups.find((group) =>
    group.models.some((model) => model.id === selectedModel.id),
  )?.companyName;

  useEffect(() => {
    if (!isInlineTray || !isOpen || isInlineTrayClosing) {
      setInlineRailScrollState({ canScrollLeft: false, canScrollRight: false });
      setIsInlineRailSettled(false);
      return;
    }

    const rail = inlineRailRef.current;
    if (!rail) return;

    setInlineRailScrollState({ canScrollLeft: false, canScrollRight: false });
    setIsInlineRailSettled(false);
    const visibleItemCount = activeInlineProviderGroup?.models.length ?? inlineProviderGroups.length;
    // The entrance is the gooey chain, so the rail is only settled once that has run.
    const settleTimer = window.setTimeout(
      () => {
        updateInlineRailScrollState();
        setIsInlineRailSettled(true);
      },
      MODEL_CHAIN.durationMs + Math.max(visibleItemCount - 1, 0) * MODEL_CHAIN.staggerMs + 60,
    );
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateInlineRailScrollState);

    rail.addEventListener('scroll', updateInlineRailScrollState, { passive: true });
    resizeObserver?.observe(rail);

    return () => {
      window.clearTimeout(settleTimer);
      rail.removeEventListener('scroll', updateInlineRailScrollState);
      resizeObserver?.disconnect();
    };
  }, [activeInlineProvider, activeInlineProviderGroup, groupedModels, inlineProviderGroups.length, isInlineTray, isInlineTrayClosing, isOpen]);

  useEffect(() => {
    if (!isInlineTray || !isOpen || isInlineTrayClosing) return;

    const rail = inlineRailRef.current;
    if (!rail) return;

    // Anchored right, not left: the chain is born in the model trigger and unfolds
    // leftwards, so the chip nearest the trigger has to be the one on screen.
    rail.scrollLeft = rail.scrollWidth;
    updateInlineRailScrollState();
  }, [activeInlineProvider, isInlineTray, isInlineTrayClosing, isOpen]);

  // Both directions are the gooey chain now (see composerGooey.ts) — the entrance, and the
  // exit as that same chain run backwards. No keyframe of its own, or the two fight.
  const inlineItemAnimationClass = '';
  const getInlineAnimationDelay = (_index: number) => undefined;

  return (
    <div
      ref={rootRef}
      data-inline-model-selector={isInlineTray ? 'true' : 'false'}
      className={isInlineTray ? 'flex min-w-0 flex-1 items-center gap-1' : 'relative flex-shrink-0'}
    >
      {isInlineTray && isOpen && (
        <div className="relative min-w-0 flex-1">
          <div
            ref={inlineRailRef}
            data-inline-model-actions
            role="toolbar"
            aria-label="Available models"
            data-inline-model-actions-state={isInlineTrayClosing ? 'closing' : 'open'}
            data-gooey-clip
            /* No vertical padding: the floating row is locked to the chip height, and any
               padding here made the row taller, which shoved it (model trigger included)
               upward — the row is anchored by its bottom edge. The gooey travel gets its
               room from .chat-gooey-clip--open instead. */
            className="flex min-w-0 items-center justify-start overflow-x-auto overscroll-contain scroll-smooth hide-scrollbar"
          >
            <div
              data-gooey-rail="model"
              data-gooey-dir="rtl"
              data-gooey-from="[data-chat-model-trigger]"
              className="ml-auto flex min-w-max items-center gap-1.5"
            >
              {inlineProviderGroups.length === 0 ? (
                <span className="whitespace-nowrap px-1 text-xs text-zinc-600">
                  {isLoading ? 'Loading models...' : 'No models available.'}
                </span>
              ) : activeInlineProviderGroup ? (
                <>
                <button
                  type="button"
                  data-inline-model-provider-back
                  data-gooey-chip
                  disabled={isInlineTrayClosing}
                  onClick={() => transitionInlineProvider(null)}
                  style={{ animationDelay: getInlineAnimationDelay(0) }}
                  className={`chat-inline-model-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/15 text-zinc-500 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass}`}
                  aria-label="Back to providers"
                >
                  <span className="flex items-center justify-center">
                    <ArrowLeft size={14} />
                  </span>
                </button>
                {activeInlineProviderGroup.models.map((model, index) => {
                  const isSelected = selectedModel.id === model.id;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-inline-model-action
                      data-gooey-chip
                      aria-current={isSelected ? 'true' : undefined}
                      disabled={isInlineTrayClosing}
                      onClick={() => handleSelect(model)}
                      style={{ animationDelay: getInlineAnimationDelay(index + 1) }}
                      className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass} ${
                        isSelected
                          ? 'border-white/[0.18] bg-white/[0.08] text-white'
                          : 'border-white/[0.06] bg-black/15 text-zinc-400'
                      }`}
                      // No `title`: selecting a model unmounts this chip, and a native
                      // tooltip outlives it — a stray black box left hanging over the
                      // closing tray. The provider is already the rail you drilled into.
                      aria-label={`${activeInlineProviderGroup.companyName} ${model.name}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="max-w-[11rem] truncate">{model.name}</span>
                        {isSelected && <Check size={12} className="text-zinc-200" />}
                      </span>
                    </button>
                  );
                })}
                </>
              ) : (
                inlineProviderGroups.map((group, index) => {
                const isSelectedProvider = group.companyName === selectedProviderName;

                return (
                  <button
                    key={group.companyName}
                    type="button"
                    data-inline-model-provider={group.companyName}
                    data-gooey-chip
                    aria-current={isSelectedProvider ? 'true' : undefined}
                    disabled={isInlineTrayClosing}
                    onClick={() => transitionInlineProvider(group.companyName)}
                    style={{ animationDelay: getInlineAnimationDelay(index) }}
                    className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass} ${
                      isSelectedProvider
                        ? 'border-white/[0.18] bg-white/[0.08] text-white'
                        : 'border-white/[0.06] bg-black/15 text-zinc-400'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{group.companyName}</span>
                      <span className="tabular-nums text-zinc-600">{group.models.length}</span>
                    </span>
                  </button>
                );
                })
              )}
            </div>
          </div>

          {isInlineRailSettled && inlineRailScrollState.canScrollLeft && (
            <button
              type="button"
              data-inline-model-scroll="left"
              onClick={() => scrollInlineRail('left')}
              className="group absolute inset-y-0 left-0 z-10 flex w-10 items-center justify-start bg-gradient-to-r from-[#0f0f11] via-[#0f0f11]/90 to-transparent pl-1 focus-visible:outline-none"
              aria-label="Show previous models"
            >
              <ChevronLeft data-inline-model-scroll-hint size={14} className="text-zinc-500" />
            </button>
          )}

          {isInlineRailSettled && inlineRailScrollState.canScrollRight && (
            <button
              type="button"
              data-inline-model-scroll="right"
              onClick={() => scrollInlineRail('right')}
              className="group absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-end bg-gradient-to-l from-[#0f0f11] via-[#0f0f11]/90 to-transparent pr-1 focus-visible:outline-none"
              aria-label="Show more models"
            >
              <ChevronRight data-inline-model-scroll-hint size={14} className="text-zinc-500" />
            </button>
          )}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        data-chat-model-trigger
        data-gooey-tab
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Select model. Current model: ${selectedModel.name}`}
        onClick={() => {
          if (isOpen) {
            closeInlineTray();
            return;
          }

          clearInlineTrayCloseTimer();
          setIsInlineTrayClosing(false);
          updateOpen(true);
        }}
        className={`chat-model-trigger flex items-center justify-center gap-1.5 border text-xs font-medium text-zinc-300 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${
          isMinimal
            ? 'h-8 rounded-lg border-white/[0.06] bg-black/15 px-3'
            : 'h-9 rounded-lg border-white/[0.08] bg-transparent px-2.5'
        } ${
          isCompact ? 'max-w-[6.5rem]' : 'max-w-[7.5rem]'
        }`}
      >
        {/* One wrapper so the gooey reveal can fade the whole label as a unit. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {!isMinimal && (
            isLoading ? (
              <Loader2 size={14} className="flex-shrink-0 animate-spin text-zinc-500" />
            ) : isReasoningActive ? (
              <BrainCircuit size={14} className="flex-shrink-0 text-zinc-500" />
            ) : (
              <Brain size={14} className="flex-shrink-0 text-zinc-500" />
            )
          )}
          <span className="truncate">{selectedModel.name}</span>
          <ChevronDown
            size={13}
            className={`flex-shrink-0 text-zinc-500 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {!isInlineTray && (
        <div
          data-model-tray
          role="dialog"
          aria-label="Choose a model"
          className={`absolute right-0 z-30 flex max-h-[min(28rem,60vh)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-[0_18px_50px_color-mix(in_srgb,var(--chat-text)_18%,transparent)] transition-[opacity,transform,visibility] duration-200 ease-out ${
            isMinimal ? 'top-full mt-2 origin-top-right' : 'bottom-full mb-2 origin-bottom-right'
          } ${
            isOpen ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-3 opacity-0'
          }`}
        >
          <div className="border-b border-[var(--chat-border)] px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--chat-muted)]">Choose a model</p>
          </div>
          <div className="overflow-y-auto overscroll-contain p-2">
            {groupedModels.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--chat-muted)]">
                {isLoading ? 'Loading models...' : 'No models available.'}
              </div>
            ) : (
              groupedModels.map((group, groupIndex) => {
                const modelOffset = groupedModels
                  .slice(0, groupIndex)
                  .reduce((total, previousGroup) => total + previousGroup.models.length, 0);

                return (
                  <div key={group.companyName} className="border-b border-[var(--chat-border)] px-1 py-2.5 last:border-b-0">
                    <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--chat-muted)]">
                      {group.companyName}
                    </p>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {group.models.map((model, modelIndex) => {
                        const isSelected = selectedModel.id === model.id;

                        return (
                          <button
                            key={model.id}
                            type="button"
                            data-model-tray-option
                            aria-current={isSelected ? 'true' : undefined}
                            onClick={() => handleSelect(model)}
                            style={{ animationDelay: `${(modelOffset + modelIndex) * 35}ms` }}
                            className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-border)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--chat-accent)] motion-reduce:animate-none ${
                              isOpen ? 'motion-safe:animate-model-tray-item-enter' : ''
                            } ${
                              isSelected
                                ? 'border-[var(--chat-border)] bg-[var(--chat-control-strong)] text-[var(--chat-text)]'
                                : 'border-[var(--chat-border)] bg-[var(--chat-control)] text-[var(--chat-muted)]'
                            }`}
                          >
                            <span className="min-w-0 truncate">{model.name}</span>
                            <span className="flex flex-shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-[var(--chat-muted)]">
                              {formatTokenCount(model.maxTokens)}
                              {isSelected && <Check size={12} className="text-[var(--chat-accent)]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatModelSelector;
