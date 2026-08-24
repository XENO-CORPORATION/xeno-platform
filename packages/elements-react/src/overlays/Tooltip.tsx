import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type {
  FocusEvent as ReactFocusEvent,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Tooltip>` — a hover/focus hint. Behaviour is hand-rolled (no portal lib, no Base UI): a
 * `position: relative` wrapper holds the trigger (children) and an absolutely-positioned
 * `role="tooltip"` panel that sits on one `side`. The panel is ALWAYS in the DOM (present for SSR
 * and for the screen reader via `aria-describedby`); JS flips `data-state` to reveal it and the CSS
 * animates opacity/transform. Reveal is instant on keyboard focus and, on hover, waits `delay` ms;
 * per the ARIA tooltip pattern, Escape dismisses it while the pointer/focus stay put.
 *
 * Monochrome shell: an `--xeno-elevated` panel with a hairline border and muted 12px mono text.
 */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'content' | 'children'> {
  /** The hint — any node; rendered into the `role="tooltip"` panel. */
  readonly content: ReactNode
  /** The trigger. A single element is wired with `aria-describedby`; other nodes render as-is. */
  readonly children: ReactNode
  /** Which side of the trigger the panel sits on. Default `top`. */
  readonly side?: TooltipSide
  /** Milliseconds to wait before the hover reveal (keyboard focus is always instant). Default 150. */
  readonly delay?: number
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 150,
  className,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...rest
}: TooltipProps): ReactElement {
  const panelId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clear = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [])

  useEffect(() => clear, [clear])

  /* Every one of these CHAINS the caller's handler rather than replacing it. They used to be written
     after `{...rest}` in the JSX, which meant a caller's `onMouseEnter` / `onMouseLeave` / `onFocus` /
     `onBlur` was silently overridden — `onKeyDown` was already chained here, which is what shows the
     other four were an oversight rather than a decision. */
  const openHover = useCallback(
    (e: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseEnter?.(e)
      clear()
      if (delay > 0) {
        timer.current = setTimeout(() => setHovered(true), delay)
      } else {
        setHovered(true)
      }
    },
    [clear, delay, onMouseEnter],
  )

  const closeHover = useCallback(
    (e: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseLeave?.(e)
      clear()
      setHovered(false)
      setDismissed(false)
    },
    [clear, onMouseLeave],
  )

  const openFocus = useCallback(
    (e: ReactFocusEvent<HTMLSpanElement>) => {
      onFocus?.(e)
      setFocused(true)
    },
    [onFocus],
  )
  const closeFocus = useCallback(
    (e: ReactFocusEvent<HTMLSpanElement>) => {
      onBlur?.(e)
      setFocused(false)
      setDismissed(false)
    },
    [onBlur],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>) => {
      onKeyDown?.(e)
      if (e.key === 'Escape') setDismissed(true)
    },
    [onKeyDown],
  )

  const open = (hovered || focused) && !dismissed
  const state = open ? 'open' : 'closed'

  // Wire the description onto the interactive trigger when it is a single element (the correct
  // aria-describedby seam); fall back to rendering plain nodes as-is (the role still describes it).
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': panelId,
      })
    : children

  return (
    <span
      className={cx('xeno-tooltip', className)}
      data-side={side}
      data-state={state}
      {...rest}
      onMouseEnter={openHover}
      onMouseLeave={closeHover}
      onFocus={openFocus}
      onBlur={closeFocus}
      onKeyDown={handleKeyDown}
    >
      {trigger}
      <span
        className="xeno-tooltip-panel"
        role="tooltip"
        id={panelId}
        data-side={side}
        data-state={state}
      >
        {content}
        <span className="xeno-tooltip-arrow" aria-hidden="true" />
      </span>
    </span>
  )
}
