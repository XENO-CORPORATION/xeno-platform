import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useDialog } from '@xenosystem/elements-react';
import { Building, Check, Copy, Globe, Lock, X } from '@/lib/icons';
import {
  VISIBILITY_OPTIONS,
  buildSocialShareUrl,
  createShareLink,
  deleteShareLink,
  getActiveShareLink,
  type ShareLink,
  type SharePreviewMessage,
  type ShareVisibility,
  type SocialPlatform,
} from './chatShare';

type ShareStep = 'configure' | 'ready';

const CHECK_EASE = [0.22, 0.7, 0.2, 1] as const;

/**
 * The three visibility marks, from the library.
 *
 * They used to be hand-written SVGs with framer-motion driving each one: a lock whose keyhole punched
 * in, a building whose windows lit in a stagger, a globe that spun. Good animations — and three glyphs
 * drawn outside the system, at stroke-width 2 where the rest of the dialog is 1.75, which is why they
 * always sat a shade heavier than every other icon on the screen.
 *
 * The motion did not have to be thrown away to fix that. It moved into the library, where selection is
 * now a trigger alongside hover: a host carrying `data-selection="on"` plays its glyph's animation once,
 * at the moment it becomes selected. The keyhole and the windows are declared parts of `lock` and
 * `building`, so they still do what they did — they just do it from the declaration.
 *
 * One thing IS gone: clicking the already-selected public option used to re-spin the globe. That was a
 * counter threaded through three components to force a replay. Selection plays the animation when the
 * choice changes, which is when it means something; re-playing it on a click that changed nothing was
 * motion without news.
 */
const VISIBILITY_GLYPH = {
  private: Lock,
  team: Building,
  public: Globe,
} as const;

/** White square pops in; the check stroke draws after — Instant when motion is reduced. */
const DrawnCheckMark: React.FC<{ reduceMotion: boolean; optionId: string }> = ({
  reduceMotion,
  optionId,
}) => (
  <motion.span
    key={optionId}
    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-white text-black"
    aria-hidden="true"
    initial={reduceMotion ? false : { scale: 0.25, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={
      reduceMotion
        ? { duration: 0 }
        : { duration: 0.2, ease: CHECK_EASE }
    }
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <motion.path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: reduceMotion ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.28, delay: 0.06, ease: CHECK_EASE }
        }
      />
    </svg>
  </motion.span>
);

export type ChatShareModalProps = {
  conversationId: string;
  conversationTitle?: string;
  messages: SharePreviewMessage[];
  onClose: () => void;
  /** Theme class pair already used by chat modals, e.g. `chat-themed xeno-icon-hosts chat-theme-dark`. */
  themeClassName?: string;
  themeStyle?: React.CSSProperties;
  /** Enter/exit card motion (grows from Share control, top-right). */
  isOpen?: boolean;
  isShown?: boolean;
};

const SOCIAL_ACTIONS: { id: SocialPlatform; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'reddit', label: 'Reddit' },
];

const stripPreviewText = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

const SHARE_MODAL_MS = 420;
const SHARE_MODAL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SHARE_MODAL_KEYFRAMES = `
  @keyframes chat-share-modal-in {
    from { opacity: 0; transform: translate(18%, -12%) scale(0.42); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes chat-share-modal-out {
    from { opacity: 1; transform: translate(0, 0) scale(1); }
    to { opacity: 0; transform: translate(18%, -12%) scale(0.42); }
  }
`;

const ChatShareModal: React.FC<ChatShareModalProps> = ({
  conversationId,
  conversationTitle,
  messages,
  onClose,
  themeClassName = 'chat-themed',
  themeStyle,
  isOpen = true,
  isShown = true,
}) => {
  // OS "prefers-reduced-motion" was true here and skipped every share-row
  // micro-animation (check draw, lock click, team windows, globe). Play them.
  const prefersReducedMotion = false;
  const existing = getActiveShareLink(conversationId);
  const [step, setStep] = useState<ShareStep>(existing ? 'ready' : 'configure');
  const [visibility, setVisibility] = useState<ShareVisibility>(
    existing?.visibility ?? 'private',
  );
  const [link, setLink] = useState<ShareLink | null>(existing);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewMessages = useMemo(() => {
    const usable = messages
      .filter((message) => message.text.trim().length > 0)
      .slice(-4);
    return usable;
  }, [messages]);

  /**
   * The behaviour of a dialog, from the library — while the look stays here.
   *
   * This one already closed on Escape and did nothing else a dialog has to do: measured before the swap,
   * focus stayed on `body` when it opened, Tab walked straight out into the page behind it, and closing
   * it left focus nowhere at all. `useDialog` moves focus in, keeps Tab inside, hands focus back to
   * whatever opened it, and locks the page scroll — none of which is visible, and all of which is what
   * separates a dialog from a div that sits above the page.
   *
   * `lockScroll` is off: this app already keeps the body unscrollable, and the hook's refcount would
   * capture and restore that state for no reason.
   */
  const { panelProps } = useDialog<HTMLDivElement>({ open: isOpen, onClose, lockScroll: false });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const next = await createShareLink({
        conversationId,
        visibility,
        messageCount: messages.length,
      });
      setLink(next);
      setStep('ready');
      setCopied(false);
    } catch {
      setError('Could not create a share link. Try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError('Could not copy the link.');
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteShareLink(conversationId);
      setLink(null);
      setStep('configure');
      setCopied(false);
    } catch {
      setError('Could not delete the link. Try again.');
    }
  };

  const openSocial = (platform: SocialPlatform) => {
    if (!link) return;
    const title = conversationTitle?.trim() || 'Shared conversation on XENO';
    const href = buildSocialShareUrl(platform, link.url, title);
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={`${themeClassName} fixed inset-0 z-[999] flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-4`}
      data-chat-share-dialog=""
      style={{
        backgroundColor: isShown
          ? 'color-mix(in srgb, var(--chat-canvas) 35%, rgba(0, 0, 0, 0.55))'
          : 'transparent',
        transition: `background-color ${SHARE_MODAL_MS}ms ${SHARE_MODAL_EASE}`,
        ...themeStyle,
      }}
      onClick={onClose}
    >
      <style>{SHARE_MODAL_KEYFRAMES}</style>
      <div
        {...panelProps}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-share-title"
        className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-t-2xl border border-b-0 will-change-transform sm:rounded-2xl sm:border"
        style={{
          maxHeight: 'calc(100dvh - 0.5rem)',
          backgroundColor: 'var(--chat-elevated)',
          borderColor: 'var(--chat-border)',
          color: 'var(--chat-text)',
          boxShadow:
            '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transformOrigin: 'top right',
          ...(isShown
            ? {
                animation: `chat-share-modal-in ${SHARE_MODAL_MS}ms ${SHARE_MODAL_EASE} forwards`,
              }
            : !isOpen
              ? {
                  animation: `chat-share-modal-out ${SHARE_MODAL_MS}ms ${SHARE_MODAL_EASE} forwards`,
                }
              : {
                  opacity: 0,
                  transform: 'translate(18%, -12%) scale(0.42)',
                }),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <h2
              id="chat-share-title"
              className="text-[1.05rem] font-semibold tracking-tight text-[var(--chat-text)] sm:text-[1.15rem]"
            >
              {step === 'configure' ? 'Share chat' : 'Shareable link'}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--chat-muted)]">
              {step === 'configure'
                ? 'Only messages up to this point will be shared.'
                : 'Public and team links can be reshared. Delete anytime.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] sm:h-8 sm:w-8"
            aria-label="Close share dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Preview — both steps, so the user always sees what leaves the room. */}
          <div
            className={`overflow-hidden rounded-xl border ${step === 'ready' ? 'mb-6' : 'mb-4'}`}
            style={{ borderColor: 'var(--chat-border)', backgroundColor: 'var(--chat-surface, var(--chat-elevated))' }}
            data-chat-share-preview=""
          >
            <div className="border-b px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--chat-muted)]"
              style={{ borderColor: 'var(--chat-border)' }}
            >
              Preview
              {conversationTitle ? (
                <span className="ml-2 normal-case tracking-normal text-[var(--chat-text)]">
                  {conversationTitle}
                </span>
              ) : null}
            </div>
            <div className="max-h-40 space-y-2 overflow-y-auto px-3 py-3">
              {previewMessages.length === 0 ? (
                <p className="text-sm text-[var(--chat-muted)]">No messages to share yet.</p>
              ) : (
                previewMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[92%] rounded-md px-3 py-2 text-[13px] leading-5 ${
                      message.sender === 'user'
                        ? 'ml-auto bg-white/[0.08] text-[var(--chat-text)]'
                        : 'mr-auto text-[var(--chat-muted)]'
                    }`}
                    style={
                      message.sender === 'ai'
                        ? { boxShadow: 'inset 0 0 0 1px var(--chat-border)' }
                        : undefined
                    }
                  >
                    <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--chat-muted)]">
                      {message.sender === 'user' ? 'You' : 'XENO'}
                    </span>
                    {stripPreviewText(message.text).slice(0, 180)}
                    {stripPreviewText(message.text).length > 180 ? '…' : ''}
                  </div>
                ))
              )}
            </div>
          </div>

          {step === 'configure' ? (
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: 'var(--chat-border)' }}
              role="radiogroup"
              aria-label="Who can view this share"
            >
              {VISIBILITY_OPTIONS.map((option, index) => {
                const selected = visibility === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setVisibility(option.id)}
                    data-selection={selected ? 'on' : 'off'}
                    className={`xeno-icon-hover flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--chat-hover)] ${
                      index > 0 ? 'border-t' : ''
                    }`}
                    style={{ borderColor: 'var(--chat-border)' }}
                  >
                    <span
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center transition-colors ${
                        selected ? 'text-[var(--chat-text)]' : 'text-[var(--chat-muted)]'
                      }`}
                    >
                      {(() => {
                        const Glyph = VISIBILITY_GLYPH[option.id];
                        return <Glyph size={18} aria-hidden="true" />;
                      })()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--chat-text)]">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[var(--chat-muted)]">
                        {option.description}
                      </span>
                    </span>
                    {selected ? (
                      <DrawnCheckMark
                        optionId={option.id}
                        reduceMotion={prefersReducedMotion}
                      />
                    ) : (
                      <span className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-6">
              <div
                className="flex h-11 items-stretch overflow-hidden rounded-lg border"
                style={{
                  borderColor: 'var(--chat-border)',
                  // Own surface so the field reads as an inner box, not flat on the modal.
                  backgroundColor: 'color-mix(in srgb, var(--chat-text) 6%, transparent)',
                }}
                data-chat-share-link-field=""
              >
                <a
                  href={link?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center truncate px-3 text-sm text-[var(--chat-text)] underline-offset-2 hover:underline"
                >
                  {link?.url}
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  data-selection={copied ? 'on' : 'off'}
                  className="flex flex-shrink-0 items-center gap-1.5 border-l px-3.5 text-sm font-medium text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
                  style={{
                    borderColor: 'var(--chat-border)',
                    backgroundColor: 'transparent',
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p className="text-[12px] leading-5 text-[var(--chat-muted)]">
                Visibility:{' '}
                <span className="text-[var(--chat-text)]">
                  {link?.visibility === 'private'
                    ? 'Private'
                    : link?.visibility === 'team'
                      ? 'Team'
                      : 'Public'}
                </span>
                . Snapshot of {link?.messageCount ?? 0} messages. Mock link — not stored on a server yet.
              </p>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--chat-muted)]">
                  Share to
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {SOCIAL_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => openSocial(action.id)}
                      aria-label={`Share on ${action.label}`}
                      className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-[11px] text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
                      style={{ boxShadow: 'inset 0 0 0 1px var(--chat-border)' }}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-xs font-semibold text-black">
                        {action.id === 'linkedin'
                          ? 'in'
                          : action.id === 'facebook'
                            ? 'f'
                            : action.id === 'reddit'
                              ? 'r/'
                              : 'X'}
                      </span>
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error ? (
            <p className="mt-3 text-[12px] text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div
          className="flex flex-shrink-0 flex-col gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          style={{ borderColor: 'var(--chat-border)' }}
        >
          <p className="text-[11px] leading-4 text-[var(--chat-muted)] sm:max-w-[55%]">
            Don&apos;t share personal information or third-party content without permission.
          </p>
          {step === 'configure' ? (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating || messages.length === 0}
              className="h-10 w-full rounded-xl px-4 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              style={{
                backgroundColor: 'var(--chat-text)',
                color: 'var(--chat-elevated)',
              }}
            >
              {isCreating ? 'Creating…' : 'Create share link'}
            </button>
          ) : (
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="h-10 flex-1 rounded-xl px-4 text-sm font-medium text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] sm:flex-none"
                style={{ boxShadow: 'inset 0 0 0 1px var(--chat-border)' }}
              >
                Delete link
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 flex-1 rounded-xl px-4 text-sm font-medium sm:flex-none"
                style={{
                  backgroundColor: 'var(--chat-text)',
                  color: 'var(--chat-elevated)',
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatShareModal;
