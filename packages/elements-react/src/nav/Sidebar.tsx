import { version as reactVersion } from 'react'
import type { HTMLAttributes, KeyboardEvent, ReactElement, ReactNode } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { TextInput } from '../controls/TextInput.js'
import { cx } from '../controls/util.js'
import Search from '@xenosystem/elements/elements/search'

/** Glyph px for a nav row — sits a hair under the 20px switch knob so labels lead. */
const ITEM_ICON = 18

/**
 * `inert`, spelled so it survives BOTH React versions in the peer range.
 *
 * The two versions genuinely disagree, and each one DROPS the other's spelling:
 *
 *   React 18  does not know `inert`, so `true` is refused as a non-boolean attribute value and the
 *             attribute never reaches the DOM. `''` renders as the custom attribute `inert=""`.
 *   React 19  knows it as a boolean: `true` renders `inert=""`, while `''` is read as FALSE (it warns
 *             "Received an empty string for a boolean attribute") and the attribute is dropped.
 *
 * There is no single value that works on both, so the value is chosen from the version actually
 * loaded. Getting it wrong is silent and costly: a CLOSED panel keeps every nav button and the search
 * field in the tab order, which is precisely what this is here to prevent.
 *
 * The cast exists only to satisfy React 19's typings, which narrow the prop to `boolean`.
 */
const INERT_VALUE: unknown = Number.parseInt(reactVersion, 10) >= 19 ? true : ''

const inertWhen = (on: boolean): { readonly inert?: boolean } =>
  on ? ({ inert: INERT_VALUE } as { readonly inert?: boolean }) : {}

/** One navigable row: a leading glyph (optional) + a label, keyed by a stable id. */
export interface SidebarItem {
  readonly id: string
  readonly label: string
  /** A glyph before the label — imported per-id from `@xenosystem/elements`. */
  readonly icon?: ElementDeclaration
}

/** A titled group of rows — e.g. `Pinned` / `Recents`. The heading is mono muted. */
export interface SidebarSection {
  /** Section heading (mono muted). Omit for an untitled group. */
  readonly heading?: string
  readonly items: readonly SidebarItem[]
}

export interface SidebarProps extends Omit<HTMLAttributes<HTMLElement>, 'onSelect' | 'children'> {
  /** Controlled open/closed. Closed slides the panel to `translateX(-100%)`. */
  readonly open: boolean
  /** Requests a state change — from Esc, or a backdrop tap on small screens. */
  readonly onOpenChange?: (open: boolean) => void
  /** The primary (untitled) nav section. */
  readonly items: readonly SidebarItem[]
  /** Optional titled groups rendered after `items` — Pinned / Recents / … */
  readonly sections?: readonly SidebarSection[]
  /** The id of the active row (→ `var(--xeno-control)`, `aria-current="page"`). */
  readonly activeId?: string
  /** A row was activated (click / Enter / Space). */
  readonly onSelect?: (id: string) => void
  /** Brand shown top-left of the header. Defaults to the wordmark `XENO`. */
  readonly brand?: ReactNode
  /** Show the header search field. Default `true`. */
  readonly searchable?: boolean
  /** Controlled search text. Leave unset for an uncontrolled field. */
  readonly searchValue?: string
  readonly onSearchChange?: (value: string) => void
  readonly searchPlaceholder?: string
  /** Override the search field glyph. Defaults to `xeno.search`. */
  readonly searchIcon?: ElementDeclaration
  /** Pinned to the bottom — account row, version, sign-out, … */
  readonly footer?: ReactNode
  /** Render a scrim behind the panel on small screens. Default `true`. */
  readonly backdrop?: boolean
  /** Accessible name for the inner nav landmark. Default `Primary`. */
  readonly navLabel?: string
}

/**
 * `<Sidebar>` — the slide-in left navigation panel.
 *
 * Locked geometry: SQUARE corners, flush to the viewport edge (`position: fixed; left: 0`), a fixed
 * ~260px column on `var(--xeno-surface)`. It is CONTROLLED (`open` / `onOpenChange`) and opens by
 * transforming `translateX(-100% → 0)` — the only animated property, guarded by reduced-motion.
 *
 * Structure: a header (brand + a search `TextInput` carrying the search glyph), a scrollable nav of
 * self-contained rows (leading glyph + label; the active row fills with `var(--xeno-control)`), any
 * number of titled `sections` (Pinned / Recents), and an optional pinned `footer`.
 *
 * Behaviour is hand-rolled: Esc closes; ↑/↓/Home/End rove focus across rows; a backdrop tap closes on
 * small screens. When closed the panel is `inert` + `aria-hidden`, so it leaves the tab order.
 */
export function Sidebar({
  open,
  onOpenChange,
  items,
  sections,
  activeId,
  onSelect,
  brand = 'XENO',
  searchable = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  searchIcon,
  footer,
  backdrop = true,
  navLabel = 'Primary',
  className,
  onKeyDown,
  ...rest
}: SidebarProps): ReactElement {
  const searchGlyph = searchIcon ?? Search

  const onRootKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    onKeyDown?.(e)
    if (!e.defaultPrevented && e.key === 'Escape') {
      onOpenChange?.(false)
    }
  }

  // Roving focus across the rows — arrows never leave the nav, Home/End jump to the ends.
  const onNavKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const rows = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-sidebar-item]:not([disabled])'),
    )
    if (rows.length === 0) return
    e.preventDefault()
    const active = typeof document !== 'undefined' ? document.activeElement : null
    const idx = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1
    let next = idx
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % rows.length
    else if (e.key === 'ArrowUp') next = idx <= 0 ? rows.length - 1 : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = rows.length - 1
    rows[next]?.focus()
  }

  const renderItem = (item: SidebarItem): ReactElement => {
    const isActive = item.id === activeId
    return (
      <button
        key={item.id}
        type="button"
        className="xeno-sidebar-item"
        data-sidebar-item=""
        data-selection={isActive ? 'on' : 'off'}
        data-availability="enabled"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect?.(item.id)}
      >
        {item.icon && (
          <span className="xeno-sidebar-item-icon" aria-hidden="true">
            {/* The row's selection reaches the glyph — but only a glyph that declares it can hold it.
                A row can be `on` while the `star` inside it renders `off`, and then an active
                "Starred" row shows a HOLLOW star: the row and its own icon disagreeing about the one
                thing they both describe. Glyphs without the axis (most of them) are untouched; for
                those the row's own colour is the whole signal, as before. */}
            <XenoElement
              decl={item.icon}
              size={ITEM_ICON}
              {...(item.icon.contract.axes.includes('selection')
                ? { state: { selection: isActive ? ('on' as const) : ('off' as const) } }
                : {})}
            />
          </span>
        )}
        <span className="xeno-sidebar-item-label">{item.label}</span>
      </button>
    )
  }

  /**
   * A group of rows plus the travelling pill that backs them. The pill is a real element and it is
   * rendered LAST so the rows keep their natural `:nth-child` numbering — the stylesheet drives it
   * purely with `.xeno-sidebar-item:nth-child(n):hover ~ .xeno-sidebar-goo`, no JS and no measuring.
   */
  const renderRows = (list: readonly SidebarItem[]): ReactElement => (
    <div className="xeno-sidebar-items">
      {list.map(renderItem)}
      <span className="xeno-sidebar-goo" aria-hidden="true" />
    </div>
  )

  const state = open ? 'open' : 'closed'

  return (
    <>
      {backdrop && (
        <div
          className="xeno-sidebar-backdrop"
          data-state={state}
          aria-hidden="true"
          onClick={() => onOpenChange?.(false)}
        />
      )}
      <aside
        className={cx('xeno-sidebar', className)}
        data-state={state}
        aria-hidden={!open || undefined}
        {...inertWhen(!open)}
        onKeyDown={onRootKeyDown}
        {...rest}
      >
        <header className="xeno-sidebar-header">
          <div className="xeno-sidebar-brand">{brand}</div>
          {searchable && (
            <TextInput
              className="xeno-sidebar-search"
              leadingIcon={searchGlyph}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(e) => onSearchChange?.(e.currentTarget.value)}
              {...(searchValue !== undefined ? { value: searchValue } : {})}
            />
          )}
        </header>

        <nav className="xeno-sidebar-nav" aria-label={navLabel} onKeyDown={onNavKeyDown}>
          <div className="xeno-sidebar-section">{renderRows(items)}</div>
          {sections?.map((section, i) => (
            <div className="xeno-sidebar-section" key={`section-${i}`}>
              {section.heading && (
                <div className="xeno-sidebar-heading" aria-hidden="true">
                  {section.heading}
                </div>
              )}
              {renderRows(section.items)}
            </div>
          ))}
        </nav>

        {footer && <footer className="xeno-sidebar-footer">{footer}</footer>}
      </aside>
    </>
  )
}
