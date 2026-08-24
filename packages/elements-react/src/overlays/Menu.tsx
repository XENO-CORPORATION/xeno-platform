import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from 'react'
import { useRef } from 'react'
import { useGooPill } from '../useGooPill.js'
import { useMenu } from '../useMenu.js'
import { Popover } from './Popover.js'

/**
 * `<Menu>` — a {@link Popover} whose panel is a `role="menu"` list of {@link MenuItem} rows. It layers
 * the ARIA menu keyboard model onto Popover's anchoring + dismissal: on open, focus moves to the first
 * enabled item; Arrow Up/Down move focus between items (wrapping), Home/End jump to the ends, Tab and
 * Escape close it, and activating an item (click / Enter / Space) closes the menu. Disabled items are
 * skipped by the roving focus and never dismiss the menu.
 *
 * Controlled: `open` + `onOpenChange`. Wire the `trigger`'s `onClick` to toggle `open` (and set its
 * `aria-haspopup="menu"` + `aria-expanded`); Popover restores focus to it when the menu closes.
 */
export interface MenuProps {
  /** Whether the menu panel is open. */
  readonly open: boolean
  /** Called with the next open state (on select, Tab, Escape, and outside click). */
  readonly onOpenChange?: (open: boolean) => void
  /** The anchor button — wire its `onClick` to toggle `open`. */
  readonly trigger: ReactNode
  /** The {@link MenuItem} rows. */
  readonly children?: ReactNode
  /** Which trigger edge the panel aligns to. Default `start`. */
  readonly align?: 'start' | 'end'
  /** Accessible name for the menu list. */
  readonly 'aria-label'?: string
  /** Extra class on the Popover wrapper. */
  readonly className?: string
}

export function Menu({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  'aria-label': ariaLabel,
  className,
}: MenuProps): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The travelling highlight is a primitive (`useGooPill` + `goo.css`), not a menu feature: a menu is
  // simply the first list that needed it, and the sidebar, a command palette or a product's own
  // hand-rolled dropdown all want the same behaviour off the same two measurements.
  const { hostProps: gooProps, pill } = useGooPill<HTMLDivElement>({ hostRef: panelRef })

  /* Every key and every focus move now comes from `useMenu`. This component was where that behaviour
     was written, and it stayed here long enough for a product to need it and not be able to reach it —
     the same story `Modal` had before `useDialog`. The hook is handed the panel ref this component
     already owns, so the keyboard, the highlight and Popover's placement all address one element. */
  const { menuProps: keyboard } = useMenu<HTMLDivElement>({
    open,
    onClose: () => onOpenChange?.(false),
    menuRef: panelRef,
  })

  // `ref` is Popover's to place (`panelRef`), so the hook's copy of it is dropped here rather than
  // spread — the hook was handed that same ref, so both halves are looking at one element.
  const { ref: _gooRef, className: gooClass, ...gooHandlers } = gooProps
  const { ref: _menuRef, ...keyboardProps } = keyboard
  const panelProps: HTMLAttributes<HTMLDivElement> = {
    className: `xeno-menu ${gooClass}`,
    ...keyboardProps,
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
    ...gooHandlers,
  }

  return (
    <Popover
      open={open}
      {...(onOpenChange ? { onOpenChange } : {})}
      trigger={trigger}
      align={align}
      panelRef={panelRef}
      panelProps={panelProps}
      {...(className !== undefined ? { className } : {})}
    >
      {/* First child, so it paints behind the rows. */}
      {pill}
      {children}
    </Popover>
  )
}
