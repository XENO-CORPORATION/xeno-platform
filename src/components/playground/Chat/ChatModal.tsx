import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '@xenosystem/elements-react';
import { usePlatformTheme } from '../../../platform/platformTheme';
import './chatModal.css';

/**
 * The ONE dialog primitive for every chat and project dialog.
 *
 * Why it exists: each dialog used to hand-roll its own scrim. Some were offset by the sidebar width
 * (so the backdrop covered only part of the screen), some sat inside a transformed container (a fixed
 * element inside a transformed ancestor is positioned against THAT ancestor, not the viewport), and
 * each had a different blur. Here the overlay is portaled to document.body unconditionally, is
 * `position: fixed; inset: 0` (the entire viewport) and the card is centred on the viewport.
 *
 * Construction follows DESIGN_SYSTEM.md "Modals / Overlays" + the chrome playbook 2.3-2.6: a shell
 * carrying the page background, with SEPARATE header / body / footer plates, no shadow, no blur.
 *
 * Behaviour owned here: Esc closes only the TOPMOST modal; backdrop click closes only when the
 * gesture began on the scrim; focus trap, initial focus and focus restore + a reference-counted page
 * scroll lock (useDialog); role/aria-modal/aria-labelledby are structural; `onClose` omitted makes
 * the dialog non-dismissable.
 */
export type ChatModalSize = 'sm' | 'md' | 'lg' | 'wide';

export type ChatModalProps = {
  /** Omitted = non-dismissable (no Esc, no scrim click, no close button). */
  onClose?: () => void;
  /** Layered Escape (e.g. step back inside a dialog before closing it). Defaults to onClose. */
  onEscape?: () => void;
  size?: ChatModalSize;
  /** Header title (left); the close button is rendered on the right when onClose is set. */
  title?: React.ReactNode;
  /** Accessible name when there is no visible `title`. */
  ariaLabel?: string;
  /** Footer plate. Every modal has one: when omitted and dismissable, a Close button is supplied. */
  footer?: React.ReactNode;
  /** The body plate's content. */
  children?: React.ReactNode;
  /** Extra class on the card shell. */
  className?: string;
  /** Class on the body plate (e.g. to drop its padding). */
  bodyClassName?: string;
  /** Extra attributes for the dialog element, e.g. { 'data-create-project-dialog': '' }. */
  dialogProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  /** Style applied to the portal root (rarely needed; e.g. a theme preview override). */
  rootStyle?: React.CSSProperties;
  /** Render the body without its plate padding/wrapper chrome (the body still scrolls). */
  bare?: boolean;
};

// Module-level stack: only the topmost modal answers Escape.
const modalStack: symbol[] = [];

export function ChatModalHeader({ children, onClose, id }: { children?: React.ReactNode; onClose?: () => void; id?: string }) {
  return (
    <div className="chat-modal-header" data-chat-modal-header="">
      <h2 id={id} className="chat-modal-title">{children}</h2>
      {onClose ? (
        <button type="button" className="chat-modal-close" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function ChatModalBody({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <div className={`chat-modal-body ${className}`.trim()} data-chat-modal-body="">{children}</div>;
}

export function ChatModalFooter({ children }: { children?: React.ReactNode }) {
  return <div className="chat-modal-footer" data-chat-modal-footer="">{children}</div>;
}

function ChatModalRoot({
  onClose, onEscape, size = 'md', title, ariaLabel, footer, children, className = '', bodyClassName = '', dialogProps, rootStyle, bare = false,
}: ChatModalProps) {
  const { resolvedTheme, preference, themeStyle } = usePlatformTheme();
  const titleId = useId();
  const token = useRef(Symbol('chat-modal'));
  const downOnScrim = useRef(false);
  // Esc is owned here (topmost-only); useDialog supplies the trap, focus and the refcounted scroll lock.
  const { panelProps } = useDialog<HTMLDivElement>({ open: true, lockScroll: true });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const id = token.current;
    modalStack.push(id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      if (onEscapeRef.current) onEscapeRef.current();
      else onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const at = modalStack.indexOf(id);
      if (at >= 0) modalStack.splice(at, 1);
    };
  }, []);

  const onScrimDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    downOnScrim.current = event.target === event.currentTarget;
  }, []);
  const onScrimUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const began = downOnScrim.current;
    downOnScrim.current = false;
    if (began && event.target === event.currentTarget) onCloseRef.current?.();
  }, []);

  if (typeof document === 'undefined') return null;

  const { className: panelClass, ...restDialog } = (dialogProps ?? {}) as React.HTMLAttributes<HTMLDivElement>;
  const hasTitle = title !== undefined && title !== null;
  const footerNode = footer !== undefined
    ? footer
    : onClose
      ? (
        <button type="button" className="chat-modal-btn" onClick={onClose}>Close</button>
      )
      : null;

  return createPortal(
    <div
      className={`chat-themed xeno-icon-hosts chat-theme-${resolvedTheme} chat-modal-scrim`}
      data-chat-theme-preference={preference}
      data-chat-modal-scrim=""
      style={{ ...themeStyle, ...rootStyle }}
      onMouseDown={onScrimDown}
      onMouseUp={onScrimUp}
    >
      <div
        {...restDialog}
        {...panelProps}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : ariaLabel}
        data-chat-modal=""
        data-size={size}
        className={`chat-modal chat-modal-${size} ${className} ${panelClass ?? ''}`.trim()}
      >
        {hasTitle ? <ChatModalHeader id={titleId} onClose={onClose}>{title}</ChatModalHeader> : null}
        {bare ? (
          <div className={`chat-modal-body chat-modal-body-bare ${bodyClassName}`.trim()} data-chat-modal-body="">{children}</div>
        ) : (
          <ChatModalBody className={bodyClassName}>{children}</ChatModalBody>
        )}
        {footerNode ? <ChatModalFooter>{footerNode}</ChatModalFooter> : null}
      </div>
    </div>,
    document.body,
  );
}

const ChatModal = Object.assign(ChatModalRoot, {
  Header: ChatModalHeader,
  Body: ChatModalBody,
  Footer: ChatModalFooter,
});

export default ChatModal;
