import { useId, useRef } from 'react'
import type {
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { useDialog } from '../useDialog.js'
import { IconButton } from '../controls/IconButton.js'
import { cx } from '../controls/util.js'
import X from '@xenosystem/elements/elements/x'

/**
 * `<Modal>` — the locked "floating window" (SPEC: dialog, not heavy chrome). One overlay pattern with
 * two placements via the `variant` axis: a `center` dialog and a `sheet` that slides up from the bottom
 * edge (rounding only its top corners). The card is `--xeno-elevated`, a 1px hairline border, a soft
 * (uncoloured) shadow, and `--xeno-radius-md` throughout — a header (title + a close `IconButton` drawn
 * from the `x` glyph), a scrollable body, and an optional right-aligned footer for actions.
 *
 * Controlled: `open` + `onClose`. It renders nothing when closed. While open it is `aria-modal` — Esc
 * closes it, a click on the scrim (never on the card) closes it, focus moves into the dialog and is
 * trapped on Tab, the page scroll is locked, and focus is restored to the opener on close.
 */
export type ModalVariant = 'center' | 'sheet'

/* Escape, the focus trap, focus restoration and the refcounted page-scroll lock all live in
   `useDialog` now. They came out of here because they are what a dialog DOES rather than how it looks,
   and a product with its own dialog design had no way to reach them without adopting this component's
   appearance as well. What is left in this file is the appearance. */

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'onClick'> {
  /** Whether the dialog is mounted + visible. Nothing renders when false. */
  readonly open: boolean
  /** Called on Esc, on a scrim click, and by the header close button. */
  readonly onClose: () => void
  /** Header heading. When present it labels the dialog via `aria-labelledby`. */
  readonly title?: ReactNode
  /** The scrollable body content. */
  readonly children?: ReactNode
  /** Optional actions, laid out right-aligned in a bordered footer. */
  readonly footer?: ReactNode
  /** `center` (default) floats mid-screen; `sheet` slides up from the bottom. */
  readonly variant?: ModalVariant
  /** Accessible label for the close button. */
  readonly closeLabel?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'center',
  closeLabel = 'Close',
  className,
  ...rest
}: ModalProps): ReactElement | null {
  const titleId = useId()
  const scrimArmed = useRef(false)
  const { panelProps } = useDialog<HTMLDivElement>({ open, onClose })

  if (!open) return null

  // Close only when both the press and the release land on the scrim itself — a drag that begins on the
  // card and releases outside must not dismiss.
  const onScrimMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    scrimArmed.current = e.target === e.currentTarget
  }
  const onScrimClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && scrimArmed.current) onClose()
    scrimArmed.current = false
  }

  return (
    <div
      className="xeno-modal-overlay"
      data-variant={variant}
      onMouseDown={onScrimMouseDown}
      onClick={onScrimClick}
    >
      <div
        {...rest}
        {...panelProps}
        role="dialog"
        aria-modal="true"
        {...(title !== undefined ? { 'aria-labelledby': titleId } : {})}
        className={cx('xeno-modal', className)}
        data-variant={variant}
      >
        <div className="xeno-modal-header">
          {title !== undefined ? (
            <h2 id={titleId} className="xeno-modal-title">
              {title}
            </h2>
          ) : null}
          <IconButton
            icon={X}
            aria-label={closeLabel}
            className="xeno-modal-close"
            onClick={onClose}
          />
        </div>
        <div className="xeno-modal-body">{children}</div>
        {footer !== undefined ? <div className="xeno-modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

/**
 * `<Sheet>` — the bottom-sheet placement of {@link Modal}, i.e. `Modal` pinned to `variant="sheet"`.
 * Same controlled contract, same a11y; it slides up from the bottom and rounds only its top corners.
 */
export type SheetProps = Omit<ModalProps, 'variant'>

export function Sheet(props: SheetProps): ReactElement | null {
  return <Modal {...props} variant="sheet" />
}
