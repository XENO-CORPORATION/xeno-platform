import type { HTMLAttributes, ReactElement } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<ProgressBar>` — the determinate progress signal. A flat track (`--xeno-control`, `radius-sm`,
 * ~4px tall) holds a fill (`--xeno-text`) whose width is the clamped `value` (0..1) as a percentage.
 * The track carries `role="progressbar"` + `aria-valuenow/min/max` (0..100). An optional `label`
 * adds a header row (label + a tabular percent readout) that is `aria-hidden` — the progressbar
 * already announces its name and value, so the visible header would only double-read.
 */
export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Progress fraction, 0..1. Values outside the range are clamped; non-finite reads as 0. Pass `null`
   * for INDETERMINATE — work is happening but its extent is not known. That is a different statement
   * from `0`, which claims the work has measurably not started, and it is the one this component could
   * not make until now.
   */
  readonly value: number | null
  /** Optional caption; also becomes the progressbar's accessible name. */
  readonly label?: string
}

export function ProgressBar({ value, label, className, ...rest }: ProgressBarProps): ReactElement {
  const indeterminate = value === null
  const safe = value !== null && Number.isFinite(value) ? value : 0
  const fraction = Math.min(1, Math.max(0, safe))
  const pct = Math.round(fraction * 100)
  // Keep the fill width to 0.1% precision so the inline style stays clean of float noise.
  const widthPct = Math.round(fraction * 1000) / 10

  return (
    <div className={cx('xeno-progressbar', className)} {...rest}>
      {label !== undefined && (
        <div className="xeno-progressbar-header" aria-hidden="true">
          <span className="xeno-progressbar-label">{label}</span>
          {/* An em dash, not "0%" — the readout has to agree with the bar about what is unknown. */}
          <span className="xeno-progressbar-value">{indeterminate ? '—' : `${pct}%`}</span>
        </div>
      )}
      <span
        role="progressbar"
        /* Omitting `aria-valuenow` is the ARIA spelling of indeterminate; a screen reader announces
           "busy" rather than a number it was never given. */
        {...(indeterminate ? {} : { 'aria-valuenow': pct })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label !== undefined ? label : 'Progress'}
        className="xeno-progressbar-track"
        data-state={indeterminate ? 'indeterminate' : 'determinate'}
      >
        <span
          className="xeno-progressbar-fill"
          {...(indeterminate ? {} : { style: { width: `${widthPct}%` } })}
        />
      </span>
    </div>
  )
}
