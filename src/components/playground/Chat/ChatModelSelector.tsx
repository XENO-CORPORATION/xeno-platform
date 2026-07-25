import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { GroupedModels, Model } from '@/services/modelService';

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

const INLINE_MODEL_STAGGER_MS = 35;
const INLINE_MODEL_MOTION_DURATION_MS = 180;

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

  const closeInlineTray = () => {
    if (isInlineTrayClosing) return;

    if (!isInlineTray) {
      updateOpen(false);
      return;
    }

    clearInlineTrayCloseTimer();
    setIsInlineTrayClosing(true);
    const visibleItemCount = activeInlineProviderGroup?.models.length ?? inlineProviderGroups.length;
    const closeDuration = INLINE_MODEL_MOTION_DURATION_MS + Math.max(visibleItemCount - 1, 0) * INLINE_MODEL_STAGGER_MS;

    inlineTrayCloseTimerRef.current = window.setTimeout(() => {
      inlineTrayCloseTimerRef.current = null;
      setIsInlineTrayClosing(false);
      updateOpen(false);
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
    const visibleItemCount = activeInlineProviderGroup?.models.length ?? inlineProviderGroups.length;
    const closeDuration = INLINE_MODEL_MOTION_DURATION_MS + Math.max(visibleItemCount - 1, 0) * INLINE_MODEL_STAGGER_MS;

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
    void onSelect(model);
    closeInlineTray();
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
    const settleTimer = window.setTimeout(
      () => {
        updateInlineRailScrollState();
        setIsInlineRailSettled(true);
      },
      INLINE_MODEL_MOTION_DURATION_MS + Math.max(visibleItemCount - 1, 0) * INLINE_MODEL_STAGGER_MS + 20,
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

    rail.scrollLeft = 0;
    updateInlineRailScrollState();
  }, [activeInlineProvider, isInlineTray, isInlineTrayClosing, isOpen]);

  const inlineItemAnimationClass = isInlineTrayClosing
    ? 'animate-model-tray-item-exit'
    : 'animate-model-tray-item-enter';
  const getInlineAnimationDelay = (index: number, itemCount: number) => `${
    (isInlineTrayClosing ? index : itemCount - 1 - index) * INLINE_MODEL_STAGGER_MS
  }ms`;

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
            className="flex min-w-0 items-center justify-start overflow-x-auto overscroll-contain py-0.5 scroll-smooth"
          >
            <div className="ml-auto flex min-w-max items-center gap-1">
              {inlineProviderGroups.length === 0 ? (
                <span className="whitespace-nowrap px-1 text-xs text-zinc-600">
                  {isLoading ? 'Loading models...' : 'No models available.'}
                </span>
              ) : activeInlineProviderGroup ? (
                <>
                <button
                  type="button"
                  data-inline-model-provider-back
                  disabled={isInlineTrayClosing}
                  onClick={() => transitionInlineProvider(null)}
                  style={{ animationDelay: getInlineAnimationDelay(0, activeInlineProviderGroup.models.length + 1) }}
                  className={`chat-inline-model-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/15 text-zinc-500 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass}`}
                  aria-label="Back to providers"
                >
                  <ArrowLeft size={14} />
                </button>
                {activeInlineProviderGroup.models.map((model, index) => {
                  const isSelected = selectedModel.id === model.id;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-inline-model-action
                      aria-current={isSelected ? 'true' : undefined}
                      disabled={isInlineTrayClosing}
                      onClick={() => handleSelect(model)}
                      style={{ animationDelay: getInlineAnimationDelay(index + 1, activeInlineProviderGroup.models.length + 1) }}
                      className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass} ${
                        isSelected
                          ? 'border-white/[0.18] bg-white/[0.08] text-white'
                          : 'border-white/[0.06] bg-black/15 text-zinc-400'
                      }`}
                      title={`${activeInlineProviderGroup.companyName} - ${model.name}`}
                    >
                      <span className="max-w-[11rem] truncate">{model.name}</span>
                      {isSelected && <Check size={12} className="text-zinc-200" />}
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
                    aria-current={isSelectedProvider ? 'true' : undefined}
                    disabled={isInlineTrayClosing}
                    onClick={() => transitionInlineProvider(group.companyName)}
                    style={{ animationDelay: getInlineAnimationDelay(index, inlineProviderGroups.length) }}
                    className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${inlineItemAnimationClass} ${
                      isSelectedProvider
                        ? 'border-white/[0.18] bg-white/[0.08] text-white'
                        : 'border-white/[0.06] bg-black/15 text-zinc-400'
                    }`}
                  >
                    <span>{group.companyName}</span>
                    <span className="tabular-nums text-zinc-600">{group.models.length}</span>
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
              <ChevronLeft data-inline-model-scroll-hint size={14} className="text-zinc-300" />
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
              <ChevronRight data-inline-model-scroll-hint size={14} className="text-zinc-300" />
            </button>
          )}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
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
        {!isMinimal && (
          isLoading ? (
            <Loader2 size={14} className="flex-shrink-0 animate-spin text-zinc-500" />
          ) : isReasoningActive ? (
            <BrainCircuit size={14} className="flex-shrink-0 text-zinc-300" />
          ) : (
            <Brain size={14} className="flex-shrink-0 text-zinc-500" />
          )
        )}
        <span className="truncate">{selectedModel.name}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-zinc-500 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {!isInlineTray && (
        <div
          data-model-tray
          role="dialog"
          aria-label="Choose a model"
          className={`absolute right-0 z-30 flex max-h-[min(28rem,60vh)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-white/[0.10] bg-[#121214] shadow-[0_18px_50px_rgba(0,0,0,0.48)] transition-[opacity,transform,visibility] duration-200 ease-out ${
            isMinimal ? 'top-full mt-2 origin-top-right' : 'bottom-full mb-2 origin-bottom-right'
          } ${
            isOpen ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-3 opacity-0'
          }`}
        >
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">Choose a model</p>
          </div>
          <div className="overflow-y-auto overscroll-contain p-2">
            {groupedModels.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">
                {isLoading ? 'Loading models...' : 'No models available.'}
              </div>
            ) : (
              groupedModels.map((group, groupIndex) => {
                const modelOffset = groupedModels
                  .slice(0, groupIndex)
                  .reduce((total, previousGroup) => total + previousGroup.models.length, 0);

                return (
                  <div key={group.companyName} className="border-b border-white/[0.06] px-1 py-2.5 last:border-b-0">
                    <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
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
                            className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-[background-color,border-color,color,transform] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-zinc-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/60 motion-reduce:animate-none ${
                              isOpen ? 'motion-safe:animate-model-tray-item-enter' : ''
                            } ${
                              isSelected
                                ? 'border-white/[0.18] bg-white/[0.08] text-white'
                                : 'border-white/[0.06] bg-white/[0.018] text-zinc-400'
                            }`}
                          >
                            <span className="min-w-0 truncate">{model.name}</span>
                            <span className="flex flex-shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-zinc-600">
                              {formatTokenCount(model.maxTokens)}
                              {isSelected && <Check size={12} className="text-zinc-200" />}
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
