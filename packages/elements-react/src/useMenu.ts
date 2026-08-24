import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

/**
 * `useMenu()` — everything a menu has to DO, for a menu this library did not build.
 *
 * Focus lands on the first item when it opens, Arrow Up/Down walk the list and wrap, Home and End jump
 * to the ends, Tab leaves and closes, and choosing an item closes it. None of that is visual, and all
 * of it is what separates a menu from a floating list of buttons.
 *
 * It is the third hook of its kind and it exists for the third time for the same reason. {@link Menu}
 * has all of this and a product cannot reach it: adopting the component means adopting its `Popover`
 * placement and its looks in the same breath, so a product with its own dropdown design writes the
 * behaviour again — or, as measured on one, does not write it at all. Twelve menus in that chat, and
 * every row was its own Tab stop with the arrow keys doing nothing.
 *
 * ```tsx
 * const { menuProps } = useMenu({ open, onClose: () => setOpen(false) })
 * return open ? <div {...menuProps} className="my-dropdown">{rows}</div> : null
 * ```
 *
 * Composes with {@link useGooPill}: hand it the same ref and one element carries the highlight and the
 * keyboard.
 */
export interface UseMenuOptions<T extends HTMLElement> {
  /** Whether the menu is open. Everything here is inert while false. */
  readonly open: boolean
  /** Called when the menu should close — an item was chosen, or Tab left it. */
  readonly onClose?: () => void
  /** An existing ref for the panel, if the caller already has one (e.g. from `useGooPill`). */
  readonly menuRef?: MutableRefObject<T | null>
  /**
   * Which rows the keyboard walks. Default is the ARIA menu family — `menuitem`, `menuitemcheckbox`,
   * `menuitemradio` — and never a disabled one: a row you cannot choose is a row the arrows must skip
   * rather than land on and strand you.
   */
  readonly itemSelector?: string
}

export interface UseMenuResult<T extends HTMLElement> {
  readonly menuRef: MutableRefObject<T | null>
  /** Spread on the element that carries `role="menu"`. */
  readonly menuProps: {
    readonly role: 'menu'
    readonly 'aria-orientation': 'vertical'
    /** So the panel itself can hold focus for the instant before the first item takes it. */
    readonly tabIndex: -1
    readonly ref: (node: T | null) => void
    readonly onKeyDown: (e: ReactKeyboardEvent<T>) => void
    readonly onClick: (e: ReactMouseEvent<T>) => void
  }
}

const DEFAULT_ITEMS = 'button[role^="menuitem"]:not(:disabled), [role^="menuitem"]:not([aria-disabled="true"])'

export function useMenu<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  menuRef: providedRef,
  itemSelector = DEFAULT_ITEMS,
}: UseMenuOptions<T>): UseMenuResult<T> {
  const ownRef = useRef<T | null>(null)
  const menuRef = providedRef ?? ownRef
  const openRef = useRef(open)
  openRef.current = open

  const items = useCallback((): HTMLElement[] => {
    const root = menuRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(itemSelector))
  }, [menuRef, itemSelector])

  /**
   * Put focus on the first row, and the guard is what took three tries to get right.
   *
   * The obvious latch — focus once per opening — is wrong, and wrong in a way that only shows on a real
   * menu. Panels that animate their exit stay mounted and toggle `aria-hidden`, and several key their
   * root on the animation state, so React REMOUNTS them as they open. The sequence measured on one: the
   * effect focuses the first row, the key flips, React replaces the element the focus was on, and focus
   * falls back to the document. A latch that has already fired cannot recover from that.
   *
   * The honest condition is not "have I done this yet" but "is focus where it belongs": while the menu
   * is open, if nothing inside it has focus, put focus on the first row. That survives a remount, and it
   * also refuses to steal focus from a row the user has arrowed to, which a re-fire otherwise would.
   */
  const focusFirst = useCallback(
    (node: T | null): void => {
      if (!node || !openRef.current) return
      if (node.contains(document.activeElement)) return
      Array.from(node.querySelectorAll<HTMLElement>(itemSelector))[0]?.focus()
    },
    [itemSelector],
  )

  const setMenu = useCallback(
    (node: T | null): void => {
      menuRef.current = node
      focusFirst(node)
    },
    [menuRef, focusFirst],
  )

  /**
   * The other way a menu opens: ALREADY MOUNTED.
   *
   * The callback ref above covers the panel that is rendered only while open. Plenty are not — a menu
   * that animates its exit has to stay in the tree and toggle `aria-hidden`, and for those the ref
   * fires once, on first mount, while the menu is still shut. Measured on a real one: the arrow keys
   * worked and focus never entered.
   *
   * So both, guarded by the same latch. Whichever happens first wins and the other does nothing.
   */
  useEffect(() => {
    if (!open) return
    focusFirst(menuRef.current)
  }, [open, menuRef, focusFirst])

  const focusAt = useCallback(
    (index: number): void => {
      const list = items()
      if (list.length === 0) return
      // Wrap in both directions. A menu is a ring; stopping dead at the last row is a behaviour people
      // only notice as the control feeling stuck.
      list[((index % list.length) + list.length) % list.length]?.focus()
    },
    [items],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<T>): void => {
      const list = items()
      if (list.length === 0) return
      const current = list.findIndex((el) => el === document.activeElement)
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          focusAt(current < 0 ? 0 : current + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          focusAt(current < 0 ? list.length - 1 : current - 1)
          break
        case 'Home':
          e.preventDefault()
          focusAt(0)
          break
        case 'End':
          e.preventDefault()
          focusAt(list.length - 1)
          break
        case 'Tab':
          /* Tab CLOSES rather than moving on. A menu is a modal little world: leaving it by tabbing into
             the page behind, with the panel still open over that page, is the state nobody wants. */
          e.preventDefault()
          onClose?.()
          break
        default:
          break
      }
    },
    [items, focusAt, onClose],
  )

  const onClick = useCallback(
    (e: ReactMouseEvent<T>): void => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]')
      if (!item) return
      if (item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true') return
      // A DISCLOSURE row keeps the menu. Activating an item normally dismisses the menu, because the
      // item's job is elsewhere — but a row reporting `aria-expanded` opens a region INSIDE this
      // menu, and closing on it destroys the panel in the same tick it was asked for. The symptom is
      // a row that looks dead: click "Theme", the whole menu vanishes, and the accordion under it is
      // never seen.
      if (item.hasAttribute('aria-expanded')) return
      onClose?.()
    },
    [onClose],
  )

  return {
    menuRef,
    menuProps: {
      role: 'menu',
      'aria-orientation': 'vertical',
      tabIndex: -1,
      ref: setMenu,
      onKeyDown,
      onClick,
    },
  }
}
