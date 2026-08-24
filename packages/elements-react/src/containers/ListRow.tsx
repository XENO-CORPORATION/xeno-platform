import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import type { Availability } from '@xenosystem/elements/schema'
import { cx } from '../controls/util.js'

/**
 * `<ListRow>` — a selectable / actionable row in a list. It is the container counterpart to the Tier-1
 * controls: appearance is CSS-first, driven by the `data-selection` and `data-availability` axes, and
 * behaviour is hand-rolled (no Base UI). A row has three slots — a `leading` glyph/avatar, a middle
 * that stacks a `title` over an optional `subtitle` (both truncate), and a `trailing` slot for
 * meta / actions.
 *
 * ## Element & interaction
 * A row is a passive `div` by default. Give it an `onSelect` (or `as="button"`) and it becomes a
 * full-width `button`: hover paints `--xeno-hover`, and the `selection` axis (`data-selection="on"`)
 * paints `--xeno-control`. A native button already fires on Enter/Space; when a row is forced to a
 * `div` while still carrying an `onSelect` (`as="div"`) it gets `role="button"`, a tab stop, and a
 * hand-rolled Enter/Space handler so the keyboard path is identical. Set `option` for listbox rows —
 * the root then reports `role="option"` + `aria-selected`.
 */
export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onSelect' | 'children'> {
  /** Leading slot — a glyph, avatar, or any node. Presentational (aria-hidden). */
  readonly leading?: ReactNode
  /** The primary line. Truncates with an ellipsis. */
  readonly title: ReactNode
  /** An optional secondary line under the title. Truncates with an ellipsis. */
  readonly subtitle?: ReactNode
  /** Trailing slot — meta text or an actions cluster, pinned to the end. */
  readonly trailing?: ReactNode
  /** Persistent selection — paints `--xeno-control` and reflects on the `selection` axis. */
  readonly selected?: boolean
  /** Activate handler. Its presence makes the row a full-width button unless `as="div"`. */
  readonly onSelect?: () => void
  /** Force the rendered element. Defaults to `button` when `onSelect` is set, else `div`. */
  readonly as?: 'div' | 'button'
  /** Report the row as a listbox `option` (`role="option"` + `aria-selected`). */
  readonly option?: boolean
  /** Maps to the `disabled` availability; blocks activation and removes the tab stop. */
  readonly disabled?: boolean
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  selected = false,
  onSelect,
  as,
  option = false,
  disabled = false,
  className,
  onClick,
  onKeyDown,
  ...rest
}: ListRowProps): ReactElement {
  const interactive = onSelect !== undefined
  const tag: 'div' | 'button' = as ?? (interactive ? 'button' : 'div')
  const availability: Availability = disabled ? 'disabled' : 'enabled'

  const activate = (): void => {
    if (!disabled) onSelect?.()
  }

  const body: ReactNode = (
    <>
      {leading !== undefined && (
        <span className="xeno-list-row-leading" aria-hidden="true">
          {leading}
        </span>
      )}
      <span className="xeno-list-row-body">
        <span className="xeno-list-row-title">{title}</span>
        {subtitle !== undefined && <span className="xeno-list-row-subtitle">{subtitle}</span>}
      </span>
      {trailing !== undefined && <span className="xeno-list-row-trailing">{trailing}</span>}
    </>
  )

  if (tag === 'button') {
    // `onKeyDown` is destructured out of props, so unless it is handed back explicitly it is not in
    // `...rest` either and a caller's handler is silently swallowed — on the DEFAULT branch, since this
    // is the tag chosen whenever `onSelect` is given. A button needs no key handling of its own (Enter
    // and Space already click it), so it is simply passed through.
    return (
      <button
        type="button"
        className={cx('xeno-list-row', className)}
        data-selection={selected ? 'on' : 'off'}
        data-availability={availability}
        role={option ? 'option' : undefined}
        aria-selected={option ? selected : undefined}
        disabled={disabled}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          onClick?.(e)
          if (!e.defaultPrevented) activate()
        }}
        onKeyDown={onKeyDown as HTMLAttributes<HTMLButtonElement>['onKeyDown']}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {body}
      </button>
    )
  }

  return (
    <div
      className={cx('xeno-list-row', className)}
      data-selection={selected ? 'on' : 'off'}
      data-availability={availability}
      role={option ? 'option' : interactive ? 'button' : undefined}
      aria-selected={option ? selected : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
      onClick={
        interactive
          ? (e: MouseEvent<HTMLDivElement>) => {
              onClick?.(e)
              if (!e.defaultPrevented) activate()
            }
          : onClick
      }
      onKeyDown={
        interactive
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              onKeyDown?.(e)
              if (e.defaultPrevented) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }
          : onKeyDown
      }
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    >
      {body}
    </div>
  )
}
