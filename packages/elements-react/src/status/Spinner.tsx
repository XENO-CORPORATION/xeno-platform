import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Spinner>` — the indeterminate loader, the `busy` signal made visible. A small rounded SQUARE
 * outline (never a circle): all four edges sit in `--xeno-muted` as the track, the top edge burns to
 * `--xeno-text` as the bright leading edge, and the whole square rotates. `size` drives both the edge
 * length and the stroke, emitted as inline `--xeno-spinner-size/-stroke` vars so the metrics can never
 * drift from the data. Motion lives behind `prefers-reduced-motion: no-preference`. Announces itself
 * with `role="status"` + `aria-label` (default `'Loading'`).
 */
export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Edge length of the square, in px. Stroke scales with it. Defaults to 16. */
  readonly size?: number
  /** The accessible label announced by assistive tech. Defaults to `'Loading'`. */
  readonly label?: string
}

export function Spinner({
  size = 16,
  label = 'Loading',
  className,
  style,
  ...rest
}: SpinnerProps): ReactElement {
  // Guard against a zero/negative/NaN size, then scale the stroke off the edge (min 2px).
  const edge = Number.isFinite(size) && size > 0 ? size : 16
  const stroke = Math.max(2, Math.round(edge / 8))
  const vars = {
    ['--xeno-spinner-size']: `${edge}px`,
    ['--xeno-spinner-stroke']: `${stroke}px`,
  } as CSSProperties

  return (
    <span
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cx('xeno-spinner', className)}
      style={{ ...vars, ...style }}
      {...rest}
    />
  )
}
