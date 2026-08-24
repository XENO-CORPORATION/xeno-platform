import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<ThinkingCube>` — the LOCKED branded model avatar. A single rounded SQUARE (`radius.xs`, muted 1.5px
 * outline) that runs ONE continuous animation per state — never a set of discrete frames, never a circle:
 *
 * - `state="thinking"` — the cube *breathes*: `xeno-cube-life` rotates it 0→360° while the scale pulses
 *   1 → .52 → 1, looping forever. The outline stays muted and the fill stays on the canvas (an opaque
 *   outlined square, not a hollow gap).
 * - `state="settled"` — the answer landed: `xeno-cube-settle` runs ONCE, growing the scale .8 → 1.14 → 1
 *   while the SAME square's background fills opaque canvas → muted (both ends opaque, so there is never a
 *   dead invisible phase), then rests as a solid muted cube.
 *
 * The visual body is `aria-hidden`; the root is `role="img"` with a state-aware label so a screen reader
 * announces the model's status once. Honours `prefers-reduced-motion`: reduce → no spin, and `settled`
 * shows the filled square statically. `size` (default 24) is the pixel edge, forwarded as a CSS var.
 */
export type ThinkingCubeState = 'thinking' | 'settled'

export interface ThinkingCubeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Which continuous animation the cube runs. */
  readonly state: ThinkingCubeState
  /** Pixel edge length of the square. Default 24. */
  readonly size?: number
}

/** Default accessible label per state (a caller may override with an explicit `aria-label`). */
const CUBE_LABEL: Record<ThinkingCubeState, string> = {
  thinking: 'Model is thinking',
  settled: 'Answer ready',
}

export function ThinkingCube({
  state,
  size = 24,
  className,
  style,
  ...rest
}: ThinkingCubeProps): ReactElement {
  const rootStyle = { ['--xeno-cube-size']: `${size}px`, ...style } as CSSProperties

  return (
    <span
      className={cx('xeno-cube', className)}
      data-state={state}
      role="img"
      aria-label={CUBE_LABEL[state]}
      style={rootStyle}
      {...rest}
    >
      <span className="xeno-cube-body" aria-hidden="true" />
    </span>
  )
}
