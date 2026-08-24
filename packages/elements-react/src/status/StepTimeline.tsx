import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import Check from '@xenosystem/elements/elements/check'

/**
 * `<StepTimeline>` — a vertical run of steps threaded by a single hairline spine (a 1.5px rounded
 * `--xeno-border` bar). Each step owns a square status MARK (radius-xs, never a circle) whose paint is
 * driven CSS-first by `data-status` on the step:
 *   - `pending` — an outline square in `--xeno-muted` (not yet reached);
 *   - `active`  — a filled square that BREATHES (a scale keyframe, silenced under reduced-motion);
 *   - `done`    — a filled `--xeno-text` square stamped with the `check` glyph (in `--xeno-on-accent`).
 * Beside the mark sit a label and an optional `time` (mono, muted). The list is static (no interaction),
 * so `data-status` is the only state seam; a visually-hidden word carries each step's status to a
 * screen reader while the decorative rail stays `aria-hidden`.
 */
export type StepStatus = 'pending' | 'active' | 'done'

export interface Step {
  /** The step's name. */
  readonly label: ReactNode
  /** Where the step sits in the run — drives the mark's paint via `data-status`. */
  readonly status: StepStatus
  /** Optional trailing timestamp/duration, rendered mono + muted. */
  readonly time?: string
}

export interface StepTimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, 'children'> {
  /** The steps, top to bottom. The spine threads every mark but the last. */
  readonly steps: readonly Step[]
}

/** Glyph px inside the ~16px done mark — small enough to breathe within the square. */
const GLYPH_PX = 11

/** The word a screen reader hears for each status (the mark itself is decorative). */
const STATUS_WORD: Record<StepStatus, string> = {
  pending: 'Pending',
  active: 'In progress',
  done: 'Done',
}

export function StepTimeline({ steps, className, ...rest }: StepTimelineProps): ReactElement {
  const lastIndex = steps.length - 1
  return (
    <ol className={cx('xeno-steptimeline', className)} {...rest}>
      {steps.map((step, i) => (
        <li key={i} className="xeno-steptimeline-step" data-status={step.status}>
          <span className="xeno-steptimeline-rail" aria-hidden="true">
            <span className="xeno-steptimeline-mark">
              {step.status === 'done' ? <XenoElement decl={Check} size={GLYPH_PX} /> : null}
            </span>
            {i !== lastIndex && <span className="xeno-steptimeline-spine" />}
          </span>
          <span className="xeno-steptimeline-body">
            <span className="xeno-steptimeline-label">
              {step.label}
              <span className="xeno-steptimeline-sr"> — {STATUS_WORD[step.status]}</span>
            </span>
            {step.time !== undefined && (
              <span className="xeno-steptimeline-time">{step.time}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
