import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Sparkles } from 'lucide-react';
import ChatUpdateDemoPanel from './ChatUpdateDemoPanel';
import { runPixelDissolve } from './pixelDissolve';

/** Body content that fills the shared Example-prompt showcase shell. */
export type ChatUpdateDemoBody =
  | {
      kind: 'code';
      text: string;
    }
  | {
      kind: 'document-prompt';
      fileName: string;
      text: string;
    }
  | {
      kind: 'composer-controls';
      activeMode?: string;
      modelLabel?: string;
      modes?: string[];
    }
  | {
      kind: 'flow-link';
      from: string;
      to: string;
      href: string;
      linkLabel: string;
      steps?: string[];
    };

/**
 * Per-notification showcase layout.
 * Same shell every time: header (+ optional Copy / meta) + body.
 */
export type ChatUpdateDemoLayout = {
  header: string;
  headerMeta?: string;
  copyValue?: string;
  body: ChatUpdateDemoBody;
};

/** @deprecated Use `ChatUpdateDemoLayout`. */
export type ChatUpdateDemo = ChatUpdateDemoLayout;

/** @deprecated Prefer `demo` with header/body layout. */
export type ChatUpdateAction =
  | { kind: 'copy'; label: string; value: string }
  | { kind: 'link'; href: string; label: string };

export interface ChatUpdate {
  /** Right-side showcase layout for this notification (Example-prompt shell). */
  demo?: ChatUpdateDemoLayout;
  /** @deprecated Use `demo` instead. */
  action?: ChatUpdateAction;
  description: string;
  id: string;
  label?: string;
  title: string;
}

const resolveDemo = (update: ChatUpdate): ChatUpdateDemoLayout | undefined => {
  if (update.demo) return update.demo;

  if (!update.action) return undefined;

  if (update.action.kind === 'copy') {
    return {
      header: update.action.label,
      copyValue: update.action.value,
      body: { kind: 'code', text: update.action.value },
    };
  }

  return {
    header: 'Open in XENO',
    body: {
      kind: 'flow-link',
      from: 'Chat',
      to: 'Workspace',
      href: update.action.href,
      linkLabel: update.action.label,
    },
  };
};

const MORPH_EASE = [0.22, 0.7, 0.2, 1] as const;

/** Morphs the next-arrow strokes into an X on the final update. */
const NextDismissMorphIcon: React.FC<{ isDismiss: boolean; reduceMotion: boolean }> = ({
  isDismiss,
  reduceMotion,
}) => {
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: MORPH_EASE };

  return (
    <svg
      data-update-nav-morph={isDismiss ? 'dismiss' : 'next'}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <motion.line
        animate={
          isDismiss
            ? { x1: 6, y1: 6, x2: 18, y2: 18, opacity: 1 }
            : { x1: 5, y1: 12, x2: 15, y2: 12, opacity: 1 }
        }
        transition={transition}
      />
      <motion.line
        animate={
          isDismiss
            ? { x1: 18, y1: 6, x2: 6, y2: 18, opacity: 1 }
            : { x1: 12, y1: 7, x2: 19, y2: 12, opacity: 1 }
        }
        transition={transition}
      />
      <motion.line
        animate={
          isDismiss
            ? { x1: 12, y1: 12, x2: 12, y2: 12, opacity: 0 }
            : { x1: 12, y1: 17, x2: 19, y2: 12, opacity: 1 }
        }
        transition={transition}
      />
    </svg>
  );
};

interface ChatUpdateCarouselProps {
  storageKey?: string;
  updates: ChatUpdate[];
}

const DEFAULT_STORAGE_KEY = 'xeno_chat_dismissed_updates_v1';
const MAX_VISIBLE_UPDATES = 3;
/** Hard cap for update description copy — keeps the left column stable. */
export const MAX_UPDATE_DESCRIPTION_CHARS = 82;

export const clampUpdateDescription = (description: string): string =>
  description.length <= MAX_UPDATE_DESCRIPTION_CHARS
    ? description
    : description.slice(0, MAX_UPDATE_DESCRIPTION_CHARS).trimEnd();

const FRAME_CLASS_NAME =
  'relative grid h-[14rem] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111113] sm:h-[10.5rem]';

const readDismissedIds = (storageKey: string): Set<string> => {
  if (typeof window === 'undefined') return new Set();

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    return new Set(Array.isArray(parsedValue) ? parsedValue.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
};

const ChatUpdateCarousel: React.FC<ChatUpdateCarouselProps> = ({
  storageKey = DEFAULT_STORAGE_KEY,
  updates,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds(storageKey));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [copiedUpdateId, setCopiedUpdateId] = useState<string | null>(null);
  const [isDissolving, setIsDissolving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dissolveAbortRef = useRef<AbortController | null>(null);

  const configuredUpdates = useMemo(
    () => updates.slice(0, MAX_VISIBLE_UPDATES),
    [updates],
  );

  const availableUpdates = useMemo(
    () => configuredUpdates.filter((update) => !dismissedIds.has(update.id)),
    [configuredUpdates, dismissedIds],
  );

  useEffect(() => {
    if (availableUpdates.length === 0) {
      setCurrentIndex(0);
      return;
    }

    setCurrentIndex((index) => Math.min(index, availableUpdates.length - 1));
  }, [availableUpdates.length]);

  useEffect(
    () => () => {
      dissolveAbortRef.current?.abort();
    },
    [],
  );

  const currentUpdate = availableUpdates[currentIndex];

  useEffect(() => {
    setCopiedUpdateId(null);
  }, [currentUpdate?.id]);

  // After a dissolve leaves the frame hidden (`leaveHidden`), restore it when the next
  // update mounts on the same node — otherwise the carousel looks empty until refresh.
  useEffect(() => {
    if (isDissolving) return;
    const frame = frameRef.current;
    if (!frame) return;
    frame.style.opacity = '';
    frame.style.pointerEvents = '';
  }, [isDissolving, currentUpdate?.id]);

  const persistDismissedIds = (nextIds: Set<string>) => {
    try {
      if (nextIds.size === 0) {
        window.localStorage.removeItem(storageKey);
        return;
      }

      window.localStorage.setItem(storageKey, JSON.stringify([...nextIds]));
    } catch {
      // The carousel still updates for this page session when storage is unavailable.
    }
  };

  const restoreUpdates = () => {
    dissolveAbortRef.current?.abort();
    setIsDissolving(false);
    const nextDismissedIds = new Set<string>();
    setDirection(1);
    setCurrentIndex(0);
    setDismissedIds(nextDismissedIds);
    persistDismissedIds(nextDismissedIds);
  };

  if (configuredUpdates.length === 0) return null;

  if (!currentUpdate) {
    // Empty-state chrome uses transform (-translate-y-1/2), which traps position:fixed.
    // Portal into `.chat-themed` (not the transformed child) so:
    // 1) fixed still anchors to the page
    // 2) Light/Dark theme overrides still apply (body is outside the themed tree)
    if (typeof document === 'undefined') return null;

    const portalRoot =
      document.querySelector('.chat-themed') ?? document.body;

    return createPortal(
      <button
        type="button"
        data-update-carousel-restore
        onClick={restoreUpdates}
        aria-label="What's new"
        className="fixed bottom-5 right-5 z-[80] flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-white/80 transition-colors hover:border-white/20 hover:bg-black/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>What's new</span>
      </button>,
      portalRoot,
    );
  }

  const showPrevious = () => {
    if (isDissolving) return;
    setDirection(-1);
    setCurrentIndex((index) => (index - 1 + availableUpdates.length) % availableUpdates.length);
  };

  const showNext = () => {
    if (isDissolving) return;
    setDirection(1);
    setCurrentIndex((index) => (index + 1) % availableUpdates.length);
  };

  /**
   * React state can lag behind disk when a dissolve is aborted before `applyDismiss`.
   * Always treat localStorage as the source of truth when syncing UI after a dismiss.
   */
  const syncDismissedFromStorage = () => {
    const stored = readDismissedIds(storageKey);
    setDismissedIds(stored);
    setDirection(1);
    setCurrentIndex((index) => {
      const remaining = configuredUpdates.filter((update) => !stored.has(update.id)).length;
      if (remaining === 0) return 0;
      return Math.min(index, remaining - 1);
    });
  };

  const dismissCurrent = () => {
    if (isDissolving) return;

    const frame = frameRef.current;

    // X means "close What's new" — dismiss every remaining card, not only the one on
    // screen. Dismissing just the current id made the carousel come back as 2, then 1.
    const nextDismissedIds = new Set(readDismissedIds(storageKey));
    for (const update of availableUpdates) {
      nextDismissedIds.add(update.id);
    }
    persistDismissedIds(nextDismissedIds);

    // Instant exit when the user asks the OS to cut motion — the effect is the point of
    // the animation, not a requirement for the dismiss itself.
    if (prefersReducedMotion || !frame) {
      syncDismissedFromStorage();
      return;
    }

    setIsDissolving(true);
    dissolveAbortRef.current?.abort();
    const controller = new AbortController();
    dissolveAbortRef.current = controller;

    void (async () => {
      try {
        await runPixelDissolve(frame, {
          durationMs: 920,
          sampleStep: 3,
          // Extra headroom — dust drifts upward off the top edge.
          padPx: 72,
          signal: controller.signal,
          // As soon as the overlay owns the pixels, drop the cards from React so they
          // cannot flash back after the dust settles.
          onCaptured: () => {
            if (!controller.signal.aborted) {
              syncDismissedFromStorage();
            }
          },
        });
      } catch {
        // Snapshot failures still dismiss — never trap the user on a stuck card.
        syncDismissedFromStorage();
      } finally {
        // Re-sync even on abort: restoreUpdates clears storage first, so this stays empty.
        syncDismissedFromStorage();
        setIsDissolving(false);
      }
    })();
  };

  const copyUpdateValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedUpdateId(currentUpdate.id);
    } catch {
      setCopiedUpdateId(null);
    }
  };

  const currentDemo = resolveDemo(currentUpdate);
  const isLastUpdate = currentIndex >= availableUpdates.length - 1;
  const showNavigation = availableUpdates.length > 1;
  const showDismissInNav = availableUpdates.length === 1 || isLastUpdate;
  const navButtonClassName =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-500 transition-[background-color,border-color,color,transform] duration-150 hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70';

  const slideVariants = prefersReducedMotion
    ? {
        enter: { opacity: 1, x: 0 },
        center: { opacity: 1, x: 0 },
        exit: { opacity: 1, x: 0 },
      }
    : {
        enter: (slideDirection: 1 | -1) => ({ opacity: 0, x: slideDirection > 0 ? 44 : -44 }),
        center: { opacity: 1, x: 0 },
        exit: (slideDirection: 1 | -1) => ({ opacity: 0, x: slideDirection > 0 ? -44 : 44 }),
      };

  // Content falls into place after the slide arrives; arrows + dismiss stay outside this tree.
  const fallIn = (order: number) =>
    prefersReducedMotion
      ? {
          initial: { opacity: 1, y: 0 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0 },
        }
      : {
          initial: { opacity: 0, y: -16 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.32,
            delay: 0.06 + order * 0.07,
            ease: [0.22, 0.7, 0.2, 1] as const,
          },
        };

  let fallOrder = 0;
  const nextFallIn = () => fallIn(fallOrder++);

  const titleMotion = nextFallIn();
  const labelMotion = currentUpdate.label ? nextFallIn() : null;
  const descriptionMotion = nextFallIn();
  const demoMotion = currentDemo ? nextFallIn() : null;

  return (
    <section
      aria-label="What's new in XENO Chat"
      aria-roledescription="carousel"
      className="w-full"
      role="region"
    >
      <div
        ref={frameRef}
        data-update-carousel-frame
        className={FRAME_CLASS_NAME}
        aria-busy={isDissolving || undefined}
      >
        <AnimatePresence initial={false} custom={direction}>
          <motion.article
            key={currentUpdate.id}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: prefersReducedMotion || isDissolving ? 0 : 0.22, ease: [0.22, 0.7, 0.2, 1] }}
            aria-label={`${currentIndex + 1} of ${availableUpdates.length}`}
            aria-roledescription="slide"
            className="relative h-[14rem] overflow-y-auto [grid-area:1/1] text-left hide-scrollbar sm:h-[10.5rem]"
          >
            <div
              data-update-carousel-content
              className={`grid h-full gap-5 p-4 sm:p-5 ${
                showNavigation || availableUpdates.length === 1 ? 'pb-14 sm:pb-14' : ''
              } ${
                currentDemo ? 'sm:grid-cols-[minmax(0,0.9fr)_minmax(12rem,1.1fr)]' : 'sm:grid-cols-1'
              }`}
            >
              <div className="flex min-w-0 flex-col">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <motion.span
                    {...titleMotion}
                    className="text-sm font-semibold tracking-[-0.01em] text-zinc-100"
                  >
                    {currentUpdate.title}
                  </motion.span>
                  {currentUpdate.label && labelMotion && (
                    <motion.span
                      {...labelMotion}
                      className="rounded-md border border-white/[0.12] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400"
                    >
                      {currentUpdate.label}
                    </motion.span>
                  )}
                </div>
                <motion.p
                  {...descriptionMotion}
                  className="max-w-[48ch] text-sm leading-5 text-zinc-400"
                >
                  {clampUpdateDescription(currentUpdate.description)}
                </motion.p>
              </div>

              {currentDemo && demoMotion && (
                <motion.div
                  {...demoMotion}
                  className="flex h-full min-w-0 w-full flex-col justify-center sm:pr-1"
                >
                  <ChatUpdateDemoPanel
                    demo={currentDemo}
                    copied={copiedUpdateId === currentUpdate.id}
                    onCopy={(value) => void copyUpdateValue(value)}
                  />
                </motion.div>
              )}
            </div>
          </motion.article>
        </AnimatePresence>

        {(showNavigation || availableUpdates.length === 1) && (
          <div
            data-update-carousel-nav
            className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 sm:bottom-5 sm:left-5"
          >
            {showNavigation && (
              <>
                <button
                  type="button"
                  onClick={showPrevious}
                  disabled={isDissolving}
                  aria-label="Show previous update"
                  className={`${navButtonClassName} disabled:pointer-events-none disabled:opacity-50`}
                >
                  <ArrowLeft size={14} />
                </button>
                <span className="min-w-10 text-center text-[11px] tabular-nums text-zinc-500">
                  {currentIndex + 1} / {availableUpdates.length}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={showDismissInNav ? dismissCurrent : showNext}
              disabled={isDissolving}
              aria-label={
                showDismissInNav
                  ? `Dismiss ${currentUpdate.title}`
                  : 'Show next update'
              }
              {...(showDismissInNav ? { 'data-update-carousel-dismiss': true } : {})}
              className={`${navButtonClassName} disabled:pointer-events-none disabled:opacity-50`}
            >
              <NextDismissMorphIcon
                isDismiss={showDismissInNav}
                reduceMotion={Boolean(prefersReducedMotion)}
              />
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default ChatUpdateCarousel;
