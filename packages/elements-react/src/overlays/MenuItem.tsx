import type { ButtonHTMLAttributes, ReactElement } from 'react'
import type { ElementDeclaration, ElementState } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import Check from '@xenosystem/elements/elements/check'
import ChevronRight from '@xenosystem/elements/elements/chevron-right'

/**
 * `<MenuItem>` — a single `role="menuitem"` row inside a {@link Menu}. Grammar-consistent with the
 * controls: it honours the `availability` axis (`data-availability`, `disabled`) and — when it is a
 * selectable (checkable) item — the `selection` axis (`data-selection` + `aria-checked`).
 *
 * A row reads left→right as: an optional leading glyph (or the selection check), the label
 * (`children`), an optional right-aligned `value`, an optional right-aligned mono `shortcut`, and a
 * trailing chevron when the row leads somewhere (`submenu` beside, `expanded` below). `variant`
 * `danger` recolours the row to `--xeno-danger`. When `selected` is passed the item becomes a
 * `menuitemcheckbox` and shows a check glyph; the leading slot is reserved so labels stay aligned with
 * checked siblings.
 */
export type MenuItemVariant = 'default' | 'danger'

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  /** Fired on click / Enter / Space (unless the click was defaultPrevented). */
  readonly onSelect?: () => void
  /** A glyph before the label — imported per-id from `@xenosystem/elements`. */
  readonly leadingIcon?: ElementDeclaration
  /** A right-aligned keyboard hint, rendered in muted mono (e.g. `⌘C`). */
  readonly shortcut?: string
  /**
   * The row's CURRENT VALUE, right-aligned and muted — for a row that opens a submenu of choices and
   * wants to show which one is in force ("Type · All ›").
   *
   * Not `shortcut`, though the slot looks the same. `shortcut` is set in mono because it stands for
   * a key the reader will press; a value is a word the reader picked, and mono makes a word read as
   * a key. Products that only had `shortcut` used it for values anyway and got "All" in the same
   * typeface as "⌘C" — this is the slot that was missing, not a second way to write the first.
   */
  readonly value?: string
  /** When defined the row is a checkable `menuitemcheckbox`; `true` shows the check glyph. */
  readonly selected?: boolean
  /** Marks the row as opening a submenu — draws a trailing chevron and sets `aria-haspopup`. */
  readonly submenu?: boolean
  /**
   * Marks the row as a DISCLOSURE: it opens a region inside the menu rather than a menu beside it.
   * Draws the same trailing chevron, quarter-turned when open, and reports `aria-expanded`.
   *
   * Not `submenu`, and the two must not be confused. `submenu` promises a second menu somewhere
   * else on screen and says `aria-haspopup="menu"`; a disclosure grows the menu it is already in,
   * and a screen reader told to expect a popup that never arrives is worse off than one told
   * nothing. The chevron is shared because the gesture is: "there is more behind this row." Where
   * it points is the difference — sideways for a menu beside, downwards for a panel below.
   *
   * Pass `aria-controls` alongside it; this component does not invent the region's id.
   */
  readonly expanded?: boolean
  /** `danger` recolours the row to `--xeno-danger`. */
  readonly variant?: MenuItemVariant
  /**
   * The leading glyph's own STATE, for a glyph that has one.
   *
   * `leadingIcon` is a declaration and this component draws it, which left a caller no way to say
   * "that glyph, but on". Products fake it: a chat marking a pinned conversation put `fill-current`
   * on an icon it rendered itself, because it could not reach the row's glyph from outside.
   *
   * It never needed faking. `bookmark` already declares a `selection` axis whose `on` variant is the
   * same silhouette FILLED — the real thing, and one that MORPHS between the two rather than swapping,
   * because both variants are a single path of equal length. This prop is the door to it.
   *
   * Distinct from `selected`, and the difference is what the row MEANS. `selected` says the row is a
   * checkable option and this is the chosen one, so the component draws a check in the leading slot.
   * `iconState` says nothing about choosing — it is the state of the thing the row acts on. A pinned
   * chat is not a selected menu item, and a menu that conflated the two would draw a tick where the
   * pin should be.
   */
  readonly iconState?: Partial<ElementState>
}

export function MenuItem({
  onSelect,
  leadingIcon,
  shortcut,
  value,
  selected,
  submenu = false,
  expanded,
  variant = 'default',
  iconState,
  disabled = false,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: MenuItemProps): ReactElement {
  const selectable = selected !== undefined
  const showLead = selectable || leadingIcon !== undefined
  const leadGlyph = selected ? Check : leadingIcon

  return (
    <button
      type={type}
      role={selectable ? 'menuitemcheckbox' : 'menuitem'}
      tabIndex={-1}
      className={cx('xeno-menu-item', className)}
      data-variant={variant}
      data-availability={disabled ? 'disabled' : 'enabled'}
      data-selection={selectable ? (selected ? 'on' : 'off') : undefined}
      disabled={disabled}
      aria-checked={selectable ? selected : undefined}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={expanded}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onSelect?.()
      }}
      {...rest}
    >
      {showLead && (
        <span className="xeno-menu-item-lead" aria-hidden="true">
          {leadGlyph ? <XenoElement decl={leadGlyph} size={16} {...(iconState && !selected ? { state: iconState } : {})} /> : null}
        </span>
      )}
      <span className="xeno-menu-item-label">{children}</span>
      {value !== undefined && <span className="xeno-menu-item-value">{value}</span>}
      {shortcut !== undefined && <span className="xeno-menu-item-shortcut">{shortcut}</span>}
      {(submenu || expanded !== undefined) && (
        <span
          className="xeno-menu-item-chevron"
          data-state={expanded === undefined ? undefined : expanded ? 'open' : 'closed'}
          aria-hidden="true"
        >
          <XenoElement decl={ChevronRight} size={16} />
        </span>
      )}
    </button>
  )
}
