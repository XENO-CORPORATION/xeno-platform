import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

/**
 * `useDialog()` — everything a dialog has to DO, for a dialog this library did not build.
 *
 * Escape closes it, focus moves in when it opens and returns to whatever opened it when it closes, Tab
 * stays inside, and the page behind stops scrolling. None of that is visual, and all of it is what
 * separates a dialog from a `<div>` that happens to sit above the page.
 *
 * It exists because {@link Modal} had all of this and nothing else could reach it. A product with its
 * own dialog design — its own scrim, its own card, its own entrance — had the choice of adopting the
 * component and its looks together or writing the behaviour again, and what actually happens is the
 * third thing: the behaviour never gets written. Measured on a real one before this existed — focus
 * stayed on `body` when it opened, Tab walked straight out into the page behind it, and closing it left
 * focus nowhere. The look was finished; the dialog was not.
 *
 * So the look stays with the product and the behaviour comes from here, one line at a time:
 *
 * ```tsx
 * const { panelProps } = useDialog({ open, onClose })
 * return open ? <div className="my-scrim"><div role="dialog" aria-modal="true" {...panelProps} /></div> : null
 * ```
 */
export interface UseDialogOptions<T extends HTMLElement> {
  /** Whether the dialog is open. Everything here is inert while false. */
  readonly open: boolean
  /** Called on Escape. Omit and the hook leaves the key alone. */
  readonly onClose?: () => void
  /** An existing ref for the panel, if the caller already has one. */
  readonly panelRef?: MutableRefObject<T | null>
  /** Lock the page scroll behind the dialog. Default `true`. */
  readonly lockScroll?: boolean
}

export interface UseDialogResult<T extends HTMLElement> {
  /** The dialog panel. `panelProps` already carries it. */
  readonly panelRef: MutableRefObject<T | null>
  /** Spread on the element that carries `role="dialog"`. */
  readonly panelProps: {
    /** A CALLBACK ref — it is what makes focus land the moment the panel exists. */
    readonly ref: (node: T | null) => void
    /** So the panel itself can hold focus before the user has tabbed to anything. */
    readonly tabIndex: -1
    readonly onKeyDown: (e: ReactKeyboardEvent<T>) => void
  }
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Page-scroll lock, REFCOUNTED across every open dialog.
 *
 * Each dialog saving and restoring `document.body.style.overflow` for itself is only correct while
 * exactly one exists. Two mounted as siblings both capture a value and both write one back, in tree
 * order: the first restores `''`, and the second then restores the `'hidden'` it captured — leaving the
 * page permanently unscrollable with nothing on screen. A count, and one saved value taken when the
 * count leaves zero, is the whole fix.
 */
let scrollLocks = 0
let scrollPrevious = ''

const lockPageScroll = (): void => {
  if (scrollLocks === 0) {
    scrollPrevious = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLocks += 1
}

const unlockPageScroll = (): void => {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = scrollPrevious
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  panelRef: providedRef,
  lockScroll = true,
}: UseDialogOptions<T>): UseDialogResult<T> {
  const ownRef = useRef<T | null>(null)
  const panelRef = providedRef ?? ownRef
  const restoreFocus = useRef<HTMLElement | null>(null)

  // Escape, bound on the DOCUMENT so it fires regardless of where focus sits inside the dialog.
  useEffect(() => {
    if (!open || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      /* `stopImmediatePropagation`, not `stopPropagation`. This listener is on `document`, the last node
         in the bubble path, so there is nothing left to propagate TO — and stopping propagation says
         nothing about other listeners on the same node. Only the immediate form reaches them. The case
         it is here for: a dialog opened from inside a menu or popover that keeps its own document-level
         Escape handler, where one press would otherwise close the dialog and the surface behind it. */
      e.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !lockScroll) return
    lockPageScroll()
    return unlockPageScroll
  }, [open, lockScroll])

  /**
   * Focus in when the panel APPEARS, not when `open` turns true.
   *
   * Those are the same moment only for a dialog that renders in the same commit as its flag. Real ones
   * often do not: a common shape is open-then-mount, where one state flag says the dialog is open and a
   * second, set by an effect that reacts to the first, is what actually renders the portal. An effect
   * that focuses `panelRef.current` finds null, and focusing on the next frame is a guess — sometimes the
   * panel is there and sometimes it is still two commits away. Measured on the chat's delete
   * confirmation: trap and Escape worked, and focus never moved at all.
   *
   * A callback ref has no timing to get wrong. It runs the instant the node attaches, whenever that is.
   *
   * It also captures the element to restore to, right there, because a callback ref fires during commit —
   * BEFORE effects — so an effect that read `document.activeElement` would already be reading the panel
   * we are about to focus, and "restore" would mean restoring to the dialog itself.
   */
  const focusedOnce = useRef(false)
  const openRef = useRef(open)
  openRef.current = open

  const setPanel = useCallback(
    (node: T | null): void => {
      panelRef.current = node
      if (!node || !openRef.current || focusedOnce.current) return
      restoreFocus.current = document.activeElement as HTMLElement | null
      focusedOnce.current = true
      node.focus()
    },
    [panelRef],
  )

  // Hand focus back to the opener on close. The cleanup of an effect that only runs while open IS the
  // close, and nothing else has to know when that happened.
  useEffect(() => {
    if (!open) return
    return () => {
      focusedOnce.current = false
      restoreFocus.current?.focus?.()
    }
  }, [open])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<T>): void => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      // `offsetParent === null` filters out anything hidden — a collapsed section's controls are in the
      // DOM and must not be tab stops.
      const list = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      )
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) {
        // Nothing focusable inside: hold focus on the panel rather than letting Tab walk out.
        e.preventDefault()
        panel.focus()
        return
      }
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [panelRef],
  )

  return {
    panelRef,
    panelProps: { ref: setPanel, tabIndex: -1, onKeyDown },
  }
}
