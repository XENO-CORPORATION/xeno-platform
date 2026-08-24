import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  ReactElement,
  RefObject,
} from 'react'
import { useCallback, useRef } from 'react'

/**
 * `useGooPill()` — the travelling hover pill (`goo.css`) for a list this hook does not own.
 *
 * The pill is CSS; the two numbers CSS cannot work out are where the hovered row starts and how tall it
 * is. This hook reads them off the row and writes them to the host as custom properties. Everything
 * between those numbers — the travel, the stretch, the fade — stays in the stylesheet.
 *
 * MEASURED rather than computed, and that is the whole reason it exists. A component that owns its rows
 * (the sidebar maps an `items` array) can do this in pure CSS: every row is the same height, so the
 * offset is `index x stride`. A host that takes arbitrary children cannot — someone will put a
 * separator, a heading or a two-line row in there, and a stride from a constant lands the pill between
 * two rows with nothing to say why.
 *
 * Usage — spread `hostProps` on the list and render `pill` as its FIRST child:
 *
 * ```tsx
 * const { hostProps, pill } = useGooPill<HTMLDivElement>()
 * return (
 *   <div role="menu" {...hostProps} className={`${hostProps.className} my-panel`}>
 *     {pill}
 *     <button role="menuitem">…</button>
 *   </div>
 * )
 * ```
 *
 * The host must stop painting a hover background on its rows: the pill IS the filled surface, and two
 * of them read as two highlights.
 */
export interface UseGooPillOptions<T extends HTMLElement> {
  /**
   * Which descendants count as rows. Default: enabled `role="menuitem*"` buttons.
   *
   * Rows outside the host's own layout tree are ignored even when they match — a nested submenu is
   * somebody else's list, and its rows are not this pill's to land on.
   */
  readonly rowSelector?: string
  /** An existing ref for the host, if the caller already has one. */
  readonly hostRef?: MutableRefObject<T | null>
}

export interface UseGooPillResult<T extends HTMLElement> {
  /** The host element, for callers that need it themselves. `hostProps` already carries it. */
  readonly hostRef: MutableRefObject<T | null>
  /** Spread on the list element. Carries the `xeno-goo-host` class and the pointer/focus handlers. */
  readonly hostProps: {
    readonly ref: RefObject<T>
    readonly className: string
    readonly onMouseOver: (e: ReactMouseEvent<T>) => void
    readonly onMouseLeave: () => void
    readonly onFocus: (e: ReactFocusEvent<T>) => void
  }
  /** Render as the host's first child. */
  readonly pill: ReactElement
  /** Put the pill on a row, or pass `null` to take it away. Exposed for keyboard-driven hosts. */
  readonly moveGoo: (row: HTMLElement | null) => void
}

const DEFAULT_ROW_SELECTOR = 'button[role^="menuitem"]:not(:disabled)'

/**
 * Where a row starts inside the host, in LAYOUT pixels.
 *
 * Offsets rather than `getBoundingClientRect()` because hosts animate in: a panel that scales or
 * translates on entrance reports transformed rects, and a pill positioned from those would be off by
 * whatever the entrance was doing on that frame. Offsets are untransformed.
 *
 * Walking the offset chain (rather than reading `row.offsetTop` once) does two jobs at once: it survives
 * a row wrapped in a positioned div, and it returns `null` for a row that lives in a nested list —
 * exactly the row this pill should refuse.
 */
function offsetWithin(row: HTMLElement, host: HTMLElement): number | null {
  let top = 0
  let node: HTMLElement | null = row
  while (node && node !== host) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return node === host ? top : null
}

export function useGooPill<T extends HTMLElement = HTMLDivElement>(
  options: UseGooPillOptions<T> = {},
): UseGooPillResult<T> {
  const { rowSelector = DEFAULT_ROW_SELECTOR } = options
  const ownRef = useRef<T | null>(null)
  const hostRef = options.hostRef ?? ownRef

  const rows = useCallback((): HTMLElement[] => {
    const host = hostRef.current
    if (!host) return []
    return Array.from(host.querySelectorAll<HTMLElement>(rowSelector))
  }, [hostRef, rowSelector])

  /**
   * Written straight to the DOM rather than through state: this fires on every row the pointer crosses,
   * and re-rendering a list to move a highlight is work for nothing.
   */
  const moveGoo = useCallback(
    (row: HTMLElement | null): void => {
      const host = hostRef.current
      if (!host) return
      if (!row) {
        host.removeAttribute('data-goo')
        return
      }
      const top = offsetWithin(row, host)
      if (top === null) return
      host.style.setProperty('--xeno-goo-y', `${top}px`)
      host.style.setProperty('--xeno-goo-h', `${row.offsetHeight}px`)
      // The index only exists to give the stretch a distinct animation name per row; a browser will not
      // replay an animation whose name did not change, so without it the pill would deform once and then
      // glide silently for the rest of the list.
      const index = rows().indexOf(row)
      host.setAttribute('data-goo-index', String(Math.max(0, Math.min(9, index))))
      host.setAttribute('data-goo', 'on')
    },
    [hostRef, rows],
  )

  const rowFrom = useCallback(
    (target: EventTarget | null): HTMLElement | null =>
      (target as HTMLElement | null)?.closest<HTMLElement>(rowSelector) ?? null,
    [rowSelector],
  )

  const onMouseOver = useCallback(
    (e: ReactMouseEvent<T>): void => moveGoo(rowFrom(e.target)),
    [moveGoo, rowFrom],
  )
  const onMouseLeave = useCallback((): void => moveGoo(null), [moveGoo])
  // Keyboard too: a list like this is a keyboard surface first, and a highlight that only answers a
  // mouse is half a highlight.
  const onFocus = useCallback(
    (e: ReactFocusEvent<T>): void => moveGoo(rowFrom(e.target)),
    [moveGoo, rowFrom],
  )

  return {
    hostRef,
    hostProps: {
      ref: hostRef as RefObject<T>,
      className: 'xeno-goo-host',
      onMouseOver,
      onMouseLeave,
      onFocus,
    },
    pill: <span className="xeno-goo-pill" aria-hidden="true" />,
    moveGoo,
  }
}
