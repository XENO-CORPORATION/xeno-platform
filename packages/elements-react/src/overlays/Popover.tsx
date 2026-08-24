import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react'
import { useEffect, useRef } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Popover>` — a hand-rolled anchored overlay (no portal lib, SPEC §13). A `position:relative` wrapper
 * holds the `trigger`; while `open`, an absolutely-positioned panel (`--xeno-elevated`, a hairline
 * border, one soft uncoloured shadow, `--xeno-radius-md`) is placed below the trigger, aligned to its
 * `start` (default) or `end` edge. Nothing renders inside the panel until it is open.
 *
 * Controlled: `open` + `onOpenChange`. While open it wires two document listeners — a `mousedown`
 * outside the wrapper closes it, and `Escape` closes it — both cleaned up on close/unmount. Focus is
 * captured on open and restored to the opener on close.
 *
 * It is the composition seam for {@link Menu}: pass `panelProps` (spread onto the panel — `role`,
 * `aria-*`, `onKeyDown`, `onClick`, …) and `panelRef` (attached to the panel node) to layer a menu, a
 * listbox, or any anchored surface on top of the same anchoring + dismissal behaviour.
 */
export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Whether the panel is mounted + visible. Nothing renders in the panel when false. */
  readonly open: boolean
  /** Called with `false` on an outside click and on Escape. */
  readonly onOpenChange?: (open: boolean) => void
  /** The anchor — wire its `onClick` to toggle `open` (this is a controlled overlay). */
  readonly trigger: ReactNode
  /** The panel content. */
  readonly children?: ReactNode
  /** Which trigger edge the panel aligns to. Default `start`. */
  readonly align?: 'start' | 'end'
  /** Attached to the panel node (composition seam — e.g. {@link Menu} queries its items). */
  readonly panelRef?: Ref<HTMLDivElement>
  /** Spread onto the panel node — `role`, `aria-*`, `onKeyDown`, `onClick`, … (composition seam). */
  readonly panelProps?: HTMLAttributes<HTMLDivElement>
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  panelRef,
  panelProps,
  className,
  ...rest
}: PopoverProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  // Dismissal — bound on the document only while open, so nothing is listening when closed.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange?.(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange?.(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  // Capture the opener on open; restore focus to it on close.
  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement | null
    } else if (restoreFocus.current) {
      restoreFocus.current.focus?.()
      restoreFocus.current = null
    }
  }, [open])

  const { className: panelClassName, ...restPanel } = panelProps ?? {}

  return (
    <div ref={rootRef} className={cx('xeno-popover', className)} {...rest}>
      {trigger}
      {open && (
        <div
          ref={panelRef}
          className={cx('xeno-popover-panel', panelClassName)}
          data-align={align}
          {...restPanel}
        >
          {children}
        </div>
      )}
    </div>
  )
}
