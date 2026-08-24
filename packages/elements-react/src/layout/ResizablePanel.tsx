'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { cx } from '../controls/util.js'

/** Which edge the drag handle rides on (and therefore which direction grows the panel). */
export type ResizablePanelSide = 'left' | 'right'

export interface ResizablePanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  /** Edge the handle sits on. `right` grows rightward; `left` grows leftward. Default `right`. */
  readonly side?: ResizablePanelSide
  /** Starting width (px) when uncontrolled. Default `280`. */
  readonly defaultSize?: number
  /** Smallest allowed width (px). Default `160`. */
  readonly min?: number
  /** Largest allowed width (px). Default `480`. */
  readonly max?: number
  /** Controlled width (px). When set, the component defers to `onSizeChange` for updates. */
  readonly size?: number
  /** Fires with the next clamped width (px) on drag or keyboard resize. */
  readonly onSizeChange?: (size: number) => void
  /** Keyboard resize increment (px) for the arrow keys. Default `16`. */
  readonly step?: number
  /** When true the handle is inert (no drag, no keyboard, disabled cursor). */
  readonly disabled?: boolean
  /** Accessible name for the resize handle. Default `Resize panel`. */
  readonly handleLabel?: string
  /** Panel contents. */
  readonly children?: ReactNode
}

/** Keep a value inside `[lo, hi]` (tolerant of an inverted range). */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * `<ResizablePanel>` — a fixed-width panel with a draggable divider on one edge.
 *
 * The root is a flex row of the panel body (its `width` the only sized property) and a 4px handle
 * (`cursor: col-resize`) pinned to `side`. A pointer press on the handle registers `window`
 * `pointermove`/`pointerup` listeners (removed on release) and translates horizontal travel into width,
 * clamped to `[min, max]`. `side='right'` grows rightward, `side='left'` grows leftward.
 *
 * Width is CONTROLLED when `size` is supplied (updates flow through `onSizeChange`), otherwise
 * uncontrolled from `defaultSize`. The handle is a `role="separator"` with `aria-orientation="vertical"`
 * and live `aria-valuenow/min/max`; it is keyboard-operable — ←/→ nudge by `step` in the drag direction,
 * Home/End jump to `min`/`max`. Dragging is reflected as `data-dragging` on the root (drives the grab
 * cursor + a text-selection lock); `disabled` flows to `data-availability`.
 */
export function ResizablePanel({
  side = 'right',
  defaultSize = 280,
  min = 160,
  max = 480,
  size,
  onSizeChange,
  step = 16,
  disabled = false,
  handleLabel = 'Resize panel',
  children,
  className,
  ...rest
}: ResizablePanelProps): ReactElement {
  const isControlled = size !== undefined
  const [internalSize, setInternalSize] = useState<number>(defaultSize)
  const current = clamp(size ?? internalSize, min, max)

  // `right` handle: rightward pointer travel widens; `left` handle: leftward travel widens.
  const dirSign = side === 'right' ? 1 : -1

  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ x: number; size: number } | null>(null)
  const moveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upRef = useRef<((e: PointerEvent) => void) | null>(null)

  const panelId = useId()

  // Commit a proposed width: clamp, update internal state when uncontrolled, always notify.
  const commit = (next: number): void => {
    const clamped = clamp(next, min, max)
    if (!isControlled) setInternalSize(clamped)
    onSizeChange?.(clamped)
  }
  // Latest-commit ref so the long-lived pointermove listener never fires a stale closure.
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })

  /**
   * Tear down any live drag listeners — shared by pointerup, POINTERCANCEL and unmount.
   *
   * `pointercancel` is not optional. The browser fires it instead of `pointerup` whenever it takes the
   * pointer stream away — a touch turning into a scroll, a system gesture, the handle unmounting
   * mid-drag. Listening only for `pointerup` meant that in those cases the teardown never ran: the
   * `pointermove` listener stayed on `window`, `dragging` stayed true, and the panel went on resizing
   * itself under a pointer with no button held until some unrelated pointerup happened to land.
   */
  const endDrag = useCallback((): void => {
    if (moveRef.current) window.removeEventListener('pointermove', moveRef.current)
    if (upRef.current) {
      window.removeEventListener('pointerup', upRef.current)
      window.removeEventListener('pointercancel', upRef.current)
    }
    moveRef.current = null
    upRef.current = null
    dragStart.current = null
    setDragging(false)
  }, [])

  useEffect(() => endDrag, [endDrag])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    dragStart.current = { x: e.clientX, size: current }
    setDragging(true)

    const onMove = (ev: PointerEvent): void => {
      const start = dragStart.current
      if (!start) return
      const delta = (ev.clientX - start.x) * dirSign
      commitRef.current(start.size + delta)
    }
    const onUp = (): void => endDrag()

    moveRef.current = onMove
    upRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = current + dirSign * step
    else if (e.key === 'ArrowLeft') next = current - dirSign * step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    commit(next)
  }

  const availability = disabled ? 'disabled' : 'enabled'

  const handle = (
    <div
      className="xeno-resizable-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={handleLabel}
      aria-controls={panelId}
      aria-valuenow={Math.round(current)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-availability={availability}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )

  return (
    <div
      className={cx('xeno-resizable', className)}
      data-side={side}
      data-dragging={dragging ? 'true' : 'false'}
      data-availability={availability}
      {...rest}
    >
      {side === 'left' && handle}
      <div id={panelId} className="xeno-resizable-panel" style={{ width: `${current}px` }}>
        {children}
      </div>
      {side === 'right' && handle}
    </div>
  )
}
