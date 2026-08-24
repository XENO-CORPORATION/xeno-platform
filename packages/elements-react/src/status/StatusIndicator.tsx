import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react'
import { status } from '@xenosystem/elements/tokens'
import { cx } from '../controls/util.js'

/**
 * `<StatusIndicator>` — an inline square status MARK (radius-xs, never a circle) beside a label. The
 * `tone` colours the mark CSS-first via `data-tone`:
 *   - `neutral` — a `--xeno-muted` square (dormant);
 *   - `active`  — a `--xeno-active` square that BREATHES (scale keyframe, silenced under reduced-motion);
 *   - `success` — the `success` status TOKEN, injected as the inline `--xeno-status-tone` var so the
 *                 value can never drift from the data;
 *   - `danger`  — the theme's `--xeno-danger` (the one sanctioned hue that IS a theme var).
 * `neutral`/`active` stay inside the monochrome shell; `success`/`danger` are the status exceptions.
 */
export type StatusIndicatorTone = 'neutral' | 'active' | 'success' | 'danger'

export interface StatusIndicatorProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style'> {
  /** The label sitting after the mark. */
  readonly children: ReactNode
  /** Colours the mark. Defaults to `neutral`. */
  readonly tone?: StatusIndicatorTone
}

export function StatusIndicator({
  children,
  tone = 'neutral',
  className,
  ...rest
}: StatusIndicatorProps): ReactElement {
  // success is not a theme var — resolve it from the status TOKEN into an inline CSS var.
  // neutral/active/danger need no inline var (monochrome, or danger = --xeno-danger in CSS).
  const toneStyle: CSSProperties | undefined =
    tone === 'success'
      ? ({ ['--xeno-status-tone']: status.success } as CSSProperties)
      : undefined

  return (
    <span
      className={cx('xeno-statusindicator', className)}
      data-tone={tone}
      {...(toneStyle ? { style: toneStyle } : {})}
      {...rest}
    >
      <span className="xeno-statusindicator-mark" aria-hidden="true" />
      <span className="xeno-statusindicator-label">{children}</span>
    </span>
  )
}
