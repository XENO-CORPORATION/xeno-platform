import React, { useEffect, useId, useRef } from 'react';

interface ScopeDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// NFR-08: the workforce dialog. Labelled by its title, modal to assistive
// tech, Escape closes it, Tab wraps inside it (focus trap), opening moves
// focus into it and closing restores focus to whatever opened it. Focus
// recovery is explicit: the opener is captured on open and re-focused on
// close, never left on document.body.
export const ScopeDialog: React.FC<ScopeDialogProps> = ({ open, title, onClose, children }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (focusables[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const opener = openerRef.current as HTMLElement | null;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="scope-dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="scope-dialog"
      >
        <h2 id={titleId}>{title}</h2>
        <div className="scope-dialog-body">{children}</div>
        <button type="button" onClick={onClose}>
          Close dialog
        </button>
      </div>
    </div>
  );
};
