import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Card>` — the base surface box (SPEC: containers). A monochrome pane on `--xeno-surface` with a
 * hairline border and card radius. It is NOT a control: it carries no availability/selection axis. Its
 * one stateful seam is `interactive` — the ONLY case XENO permits a hover-lift (the shell otherwise kills
 * hover motion; lifts are reserved for artifact-like affordances), exposed as `data-interactive` so the
 * lift lives entirely in CSS behind `prefers-reduced-motion`.
 */
export type CardVariant = 'flat' | 'elevated'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** `flat` sits on `--xeno-surface`; `elevated` swaps to `--xeno-elevated` + a soft shadow. */
  readonly variant?: CardVariant
  /** Opt in to the hover-lift (translateY + border brighten). Off by default — XENO kills hover motion. */
  readonly interactive?: boolean
  /** Lift strength when interactive: `subtle` (default, -1px) or `strong` (-3px + soft shadow, the
   * artifact-card affordance). */
  readonly lift?: 'subtle' | 'strong'
  /** Optional slot above the body, split by a hairline. */
  readonly header?: ReactNode
  /** Optional slot below the body, split by a hairline. */
  readonly footer?: ReactNode
  readonly children?: ReactNode
}

export function Card({
  variant = 'flat',
  interactive = false,
  lift = 'subtle',
  header,
  footer,
  className,
  children,
  ...rest
}: CardProps): ReactElement {
  return (
    <div
      className={cx('xeno-card', className)}
      data-variant={variant}
      data-interactive={interactive ? 'true' : 'false'}
      data-lift={lift}
      {...rest}
    >
      {header !== undefined && <div className="xeno-card-header">{header}</div>}
      <div className="xeno-card-body">{children}</div>
      {footer !== undefined && <div className="xeno-card-footer">{footer}</div>}
    </div>
  )
}
