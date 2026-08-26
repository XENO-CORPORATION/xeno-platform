import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Spinner } from '@xenosystem/elements-react';
import { Brain, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, ArrowRightDecl, Search, X } from '@/lib/icons';
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
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileProviderFilter, setMobileProviderFilter] = useState('all');

  const filteredMobileGroups = useMemo(() => {
    return groupedModels
      .filter((group) => mobileProviderFilter === 'all' || group.companyName === mobileProviderFilter)
      .map((group) => ({
        ...group,
        models: group.models.filter((m) => {
          if (!mobileSearchQuery.trim()) return true;
          const q = mobileSearchQuery.toLowerCase();
          return m.name.toLowerCase().includes(q) || group.companyName.toLowerCase().includes(q);
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [groupedModels, mobileProviderFilter, mobileSearchQuery]);
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

  const inlineTrayExitMs = () => {
    const chipCount = inlineRailRef.current?.querySelectorAll('[data-gooey-chip]').length ?? 0;
    return chainDurationMs(chipCount, MODEL_CHAIN);
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
    inlineTrayCloseTimerRef.current = window.setTimeout(() => {
      inlineTrayCloseTimerRef.current = null;
      setIsInlineTrayClosing(false);
      updateOpen(false);
      afterClose?.();
    }, inlineTrayExitMs());
  };

  const transitionInlineProvider = (nextProvider: string | null) => {
    if (isInlineTrayClosing) return;

    if (!isInlineTray) {
      setActiveInlineProvider(nextProvider);
      return;
    }

    clearInlineTrayCloseTimer();
    setIsInlineTrayClosing(true);
    inlineTrayCloseTimerRef.current = window.setTimeout(() => {
      inlineTrayCloseTimerRef.current = null;
      setActiveInlineProvider(nextProvider);
      setIsInlineTrayClosing(false);
    }, inlineTrayExitMs());
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
    // Tell the parent only once the liquid exit has finished so the selected-state update
    // cannot replace the rail in the middle of its transition.
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

  useLayoutEffect(() => {
    if (!isInlineTray || !isOpen || isInlineTrayClosing) {
      setInlineRailScrollState({ canScrollLeft: false, canScrollRight: false });
      setIsInlineRailSettled(false);
      return;
    }

    const rail = inlineRailRef.current;
    if (!rail) return;

    // Align before paint. Doing this in a passive effect exposed one frame with the
    // opposite end of the rail visible, followed by a hard horizontal jump.
    rail.scrollLeft = rail.scrollWidth;
    updateInlineRailScrollState();
    setIsInlineRailSettled(true);
  }, [activeInlineProvider, groupedModels, isInlineTray, isInlineTrayClosing, isOpen]);

  useEffect(() => {
    if (!isInlineTray || !isOpen || isInlineTrayClosing) return;

    const rail = inlineRailRef.current;
    if (!rail) return;

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateInlineRailScrollState);

    rail.addEventListener('scroll', updateInlineRailScrollState, { passive: true });
    resizeObserver?.observe(rail);

    return () => {
      rail.removeEventListener('scroll', updateInlineRailScrollState);
      resizeObserver?.disconnect();
    };
  }, [activeInlineProvider, groupedModels, isInlineTray, isInlineTrayClosing, isOpen]);

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
            className="chat-inline-model-actions flex min-w-0 items-center justify-start overflow-x-auto overscroll-contain scroll-smooth hide-scrollbar"
          >
            <div
              key={activeInlineProvider ?? 'providers'}
              data-inline-model-rail
              data-gooey-rail="model"
              data-gooey-dir="rtl"
              data-gooey-from="[data-chat-model-trigger]"
              data-gooey-preserve-geometry="true"
              className="chat-inline-model-rail flex min-w-max items-center gap-1.5 px-0.5"
            >
              {inlineProviderGroups.length === 0 ? (
                <span className="whitespace-nowrap px-1 text-xs text-[var(--chat-muted)]">
                  {isLoading ? 'Loading models...' : 'No models available.'}
                </span>
              ) : activeInlineProviderGroup ? (
                <>
                <IconButton
                  icon={ArrowRightDecl}
                  className="chat-icon-flip-x !rounded-[10px]"
                  variant="quiet"
                  size="md"
                  iconSize={14}
                  data-inline-model-provider-back
                  data-inline-model-chip
                  data-gooey-chip
                  disabled={isInlineTrayClosing}
                  onClick={() => transitionInlineProvider(null)}
                  aria-label="Back to providers"
                />
                {activeInlineProviderGroup.models.map((model) => {
                  const isSelected = selectedModel.id === model.id;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-inline-model-action
                      data-inline-model-chip
                      data-gooey-chip
                      aria-current={isSelected ? 'true' : undefined}
                      disabled={isInlineTrayClosing}
                      onClick={() => handleSelect(model)}
                      className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)] ${
                        isSelected
                          ? 'border-[var(--chat-muted)] bg-[var(--chat-control)] text-[var(--chat-text)]'
                          : 'border-[var(--chat-border)] bg-[var(--chat-overlay)] text-[var(--chat-muted)]'
                      }`}
                      aria-label={`${activeInlineProviderGroup.companyName} ${model.name}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="max-w-[11rem] truncate">{model.name}</span>
                        {isSelected && <Check size={12} className="text-[var(--chat-text)]" />}
                      </span>
                    </button>
                  );
                })}
                </>
              ) : (
                inlineProviderGroups.map((group) => {
                const isSelectedProvider = group.companyName === selectedProviderName;

                return (
                  <button
                    key={group.companyName}
                    type="button"
                    data-inline-model-provider={group.companyName}
                    data-inline-model-chip
                    data-gooey-chip
                    aria-current={isSelectedProvider ? 'true' : undefined}
                    disabled={isInlineTrayClosing}
                    onClick={() => transitionInlineProvider(group.companyName)}
                    className={`chat-inline-model-action flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-2 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)] ${
                      isSelectedProvider
                        ? 'border-[var(--chat-muted)] bg-[var(--chat-control)] text-[var(--chat-text)]'
                        : 'border-[var(--chat-border)] bg-[var(--chat-overlay)] text-[var(--chat-muted)]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{group.companyName}</span>
                      <span className="tabular-nums text-[var(--chat-muted)]">{group.models.length}</span>
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
              className="group absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-start bg-gradient-to-r from-[var(--chat-canvas,#0a0a0b)] via-[var(--chat-canvas,#0a0a0b)]/85 to-transparent pl-1 focus-visible:outline-none"
              aria-label="Show previous models"
            >
              <ChevronLeft data-inline-model-scroll-hint size={14} className="text-[var(--chat-muted)]" />
            </button>
          )}

          {isInlineRailSettled && inlineRailScrollState.canScrollRight && (
            <button
              type="button"
              data-inline-model-scroll="right"
              onClick={() => scrollInlineRail('right')}
              className="group absolute inset-y-0 right-0 z-10 flex w-9 items-center justify-end bg-gradient-to-l from-[var(--chat-canvas,#0a0a0b)] via-[var(--chat-canvas,#0a0a0b)]/85 to-transparent pr-1 focus-visible:outline-none"
              aria-label="Show more models"
            >
              <ChevronRight data-inline-model-scroll-hint size={14} className="text-[var(--chat-muted)]" />
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
        className={`chat-model-trigger flex items-center justify-center gap-1.5 border text-xs font-medium text-[var(--chat-text)] transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)] ${
          isMinimal
            ? 'h-8 rounded-[10px] border-[var(--chat-border)] bg-[var(--chat-overlay)] px-3'
            : 'h-9 rounded-[10px] border-[var(--chat-border)] bg-transparent px-2.5'
        } ${
          isCompact ? 'max-w-[6.5rem]' : 'max-w-[7.5rem]'
        }`}
      >
        {/* One wrapper so the gooey reveal can fade the whole label as a unit. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {!isMinimal && (
            isLoading ? (
              <Spinner size={14} className="flex-shrink-0" />
            ) : isReasoningActive ? (
              <BrainCircuit size={14} className="flex-shrink-0 text-[var(--chat-muted)]" />
            ) : (
              <Brain size={14} className="flex-shrink-0 text-[var(--chat-muted)]" />
            )
          )}
          <span className="truncate">{selectedModel.name}</span>
          <ChevronDown
            size={13}
            className={`flex-shrink-0 text-[var(--chat-muted)] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
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

                        /* Stays hand-written, on three counts rather than one. Its selected fill is
                           `--chat-control-strong`, a second unmapped surface — the variants have one
                           control fill, not two, so selected and unselected would come out the same
                           weight and only the check would separate them. It is laid out
                           `justify-between`, a name on the left and a token count on the right,
                           where a button centres its content. And it carries a per-item
                           `animationDelay`, which `Button` omits from its props by design.
                           A row, in other words, not a button. */
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

      {/* ── Mobile Model Selector Bottom Sheet Drawer (Platform Design) ───────── */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[300] md:hidden flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
            onClick={() => closeInlineTray()}
          />

          {/* Bottom Sheet Drawer */}
          <div className="relative z-10 flex flex-col h-[85dvh] max-h-[85dvh] w-full rounded-t-3xl border-t border-x border-white/15 bg-[#0a0a0c]/95 backdrop-blur-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Drag Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white border border-white/10">
                  {isReasoningActive ? <BrainCircuit size={18} /> : <Brain size={18} />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Select Model</div>
                  <div className="text-[11px] text-white/50">Choose AI model intelligence</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => closeInlineTray()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:text-white active:scale-95 transition-all"
                aria-label="Close model selector"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search Input */}
            <div className="px-5 py-3 border-b border-white/10">
              <div className="relative flex items-center">
                <Search size={15} className="absolute left-3 text-white/40 pointer-events-none" />
                <input
                  type="text"
                  value={mobileSearchQuery}
                  onChange={(e) => setMobileSearchQuery(e.target.value)}
                  placeholder="Search models or providers..."
                  className="w-full h-10 pl-9 pr-8 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                />
                {mobileSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setMobileSearchQuery('')}
                    className="absolute right-2.5 p-1 text-white/40 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Provider Filter Chips */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-white/10 overflow-x-auto hide-scrollbar">
              <button
                type="button"
                onClick={() => setMobileProviderFilter('all')}
                className={`flex-shrink-0 h-8 px-3.5 rounded-xl text-xs font-medium border transition-all ${
                  mobileProviderFilter === 'all'
                    ? 'bg-white/20 text-white border-white/25 shadow-sm font-semibold'
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                All Models
              </button>
              {groupedModels.map((group) => (
                <button
                  key={group.companyName}
                  type="button"
                  onClick={() => setMobileProviderFilter(group.companyName)}
                  className={`flex-shrink-0 h-8 px-3.5 rounded-xl text-xs font-medium border transition-all flex items-center gap-1.5 ${
                    mobileProviderFilter === group.companyName
                      ? 'bg-white/20 text-white border-white/25 shadow-sm font-semibold'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span>{group.companyName}</span>
                  <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-md ${
                    mobileProviderFilter === group.companyName ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'
                  }`}>
                    {group.models.length}
                  </span>
                </button>
              ))}
            </div>

            {/* Models List */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3 space-y-3 pb-10">
              {filteredMobileGroups.length === 0 ? (
                <div className="py-16 text-center text-xs text-white/40">
                  No models match your search.
                </div>
              ) : (
                filteredMobileGroups.map((group) => (
                  <div key={group.companyName} className="space-y-2">
                    <div className="text-[11px] font-semibold tracking-wider uppercase text-white/40 px-1 pt-1">
                      {group.companyName}
                    </div>
                    <div className="space-y-2">
                      {group.models.map((model) => {
                        const isSelected = selectedModel.id === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              handleSelect(model);
                              closeInlineTray();
                            }}
                            className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all active:scale-[0.99] ${
                              isSelected
                                ? 'bg-white/[0.08] border-white/25 shadow-lg'
                                : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors ${
                                isSelected
                                  ? 'bg-white text-black border-white shadow'
                                  : 'bg-white/5 text-white/60 border-white/10'
                              }`}>
                                <Brain size={18} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-white truncate">{model.name}</span>
                                  {isSelected && (
                                    <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-xs text-white/50">
                                  <span>{group.companyName}</span>
                                  <span>•</span>
                                  <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-[11px] font-mono text-white/70 border border-white/5 tabular-nums">
                                    {formatTokenCount(model.maxTokens)} context
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center pl-2 flex-shrink-0">
                              <div className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all ${
                                isSelected
                                  ? 'bg-white text-black border-white'
                                  : 'border-white/20 text-transparent'
                              }`}>
                                {isSelected && <Check size={12} strokeWidth={2.5} />}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ChatModelSelector;
