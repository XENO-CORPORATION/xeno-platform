import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import type { Availability, ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx } from '../controls/util.js'
import X from '@xenosystem/elements/elements/x'

/**
 * `<Chip>` — a small SQUARE token (radius-control, 1px border) that carries a label with an optional
 * leading glyph and an optional remove `x`. It honours the `selection` axis via `data-selection`
 * (`on` fills with `var(--xeno-control)`) — the SAME axis the bookmark icon and ToggleButton use.
 *
 * Two shapes fall out of one element:
 *   - a display/removable token — the body is a plain `<span>`; `onRemove` adds a bare `x` button;
 *   - a filter/toggle chip — supply `onSelectedChange` and the body becomes a `role`-correct toggle
 *     `<button aria-pressed>` (native Enter/Space), with the remove `x` a SIBLING button so no
 *     interactive element is ever nested inside another.
 *
 * Sizes come from the design tokens (`sizeAttr` + `size.css`), so a chip's metrics can never drift
 * from the data.
 */
export type ChipSize = 'sm' | 'md'

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'style' | 'children'> {
  /** The chip label. */
  readonly children?: ReactNode
  /** A glyph before the label — imported per-id from `@xenosystem/elements`. */
  readonly leadingIcon?: ElementDeclaration
  /** Presentational selection — drives `data-selection`. */
  readonly selected?: boolean
  /** Provide to make the chip a controlled toggle (the body becomes a `button aria-pressed`). */
  readonly onSelectedChange?: (selected: boolean) => void
  /** Provide to render a trailing remove `x`. */
  readonly onRemove?: () => void
  /** Accessible name for the remove button. */
  readonly removeLabel?: string
  readonly size?: ChipSize
  readonly disabled?: boolean
}

export function Chip({
  children,
  leadingIcon,
  selected = false,
  onSelectedChange,
  onRemove,
  removeLabel = 'Remove',
  size = 'md',
  disabled = false,
  className,
  ...rest
}: ChipProps): ReactElement {
  const availability: Availability = disabled ? 'disabled' : 'enabled'
  const glyph = iconPx(size)
  const selectable = onSelectedChange !== undefined

  const inner = (
    <>
      {leadingIcon && <XenoElement decl={leadingIcon} size={glyph} />}
      {children != null && <span className="xeno-chip-label">{children}</span>}
    </>
  )

  return (
    <span
      className={cx('xeno-chip', className)}
      data-selection={selected ? 'on' : 'off'}
      data-availability={availability}
      data-removable={onRemove ? 'true' : undefined}
      {...sizeAttr(size)}
      {...rest}
    >
      {selectable ? (
        <button
          type="button"
          className="xeno-chip-body xeno-chip-select"
          aria-pressed={selected}
          disabled={disabled}
          onClick={(e) => {
            if (!e.defaultPrevented) onSelectedChange?.(!selected)
          }}
        >
          {inner}
        </button>
      ) : (
        <span className="xeno-chip-body">{inner}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="xeno-chip-remove"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.()
          }}
        >
          <XenoElement decl={X} size={Math.max(12, glyph - 2)} />
        </button>
      )}
    </span>
  )
}
