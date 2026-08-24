import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react'
import { status } from '@xenosystem/elements/tokens'
import { cx } from '../controls/util.js'

/**
 * Badges — a family of inline, non-interactive markers (SPEC: containers/Badges).
 *
 * These are STATIC glyphs of text: they carry no availability/selection axis (nothing to press or
 * toggle), so the only `data-*` seam is `data-tone` on the tonal members. They stay inside the
 * monochrome shell — surface/border/muted greys — with ONE sanctioned exception: `StatusPill` may
 * carry a status hue. `success`/`warning` arrive as an inline `--xeno-pill-tone` var straight from
 * the status TOKEN (so the value can never drift from the data); `danger` resolves to the theme's
 * `--xeno-danger`. Grammar holds throughout: rounded squares, never circles.
 */

/* ── Badge ─────────────────────────────────────────────────────────────────────────── */

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The label. Rendered uppercase, mono, 10px. */
  readonly children: ReactNode
  /** Badge is the neutral base of the family; `StatusPill` adds the semantic tones. */
  readonly tone?: 'neutral'
}

/**
 * `<Badge>` — a mono uppercase micro-label on a surface chip (10px / .05em / radius-sm, hairline
 * border, muted foreground). The neutral base of the family.
 */
export function Badge({ children, tone = 'neutral', className, ...rest }: BadgeProps): ReactElement {
  return (
    <span className={cx('xeno-badge', className)} data-tone={tone} {...rest}>
      {children}
    </span>
  )
}

/* ── StatusPill ────────────────────────────────────────────────────────────────────── */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style'> {
  readonly children: ReactNode
  /** Colours the text + border. `neutral` stays greyscale; the rest carry a status hue. */
  readonly tone?: StatusTone
  /** Prepend a small rounded-square status dot echoing the tone (via `currentColor`). */
  readonly dot?: boolean
}

/**
 * `<StatusPill>` — like {@link Badge}, but a `tone` paints the text + border. `success`/`warning`
 * inject their status token as the inline `--xeno-pill-tone` var; `danger` uses `--xeno-danger`.
 * `data-tone` on the root is the state seam the CSS reads.
 */
export function StatusPill({
  children,
  tone = 'neutral',
  dot = false,
  className,
  ...rest
}: StatusPillProps): ReactElement {
  // success/warning are not theme vars — resolve them from the status TOKEN into an inline CSS var.
  // neutral/danger need no inline var (neutral = the base greys, danger = --xeno-danger in CSS).
  const toneStyle: CSSProperties | undefined =
    tone === 'success'
      ? ({ ['--xeno-pill-tone']: status.success } as CSSProperties)
      : tone === 'warning'
        ? ({ ['--xeno-pill-tone']: status.warning } as CSSProperties)
        : undefined

  return (
    <span
      className={cx('xeno-statuspill', className)}
      data-tone={tone}
      {...(toneStyle ? { style: toneStyle } : {})}
      {...rest}
    >
      {dot && <span className="xeno-statuspill-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

/* ── CountBadge ────────────────────────────────────────────────────────────────────── */

export interface CountBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The number to show. Hidden entirely when `<= 0` unless `showZero`. */
  readonly count: number
  /** Keep the badge (showing `0`) at a zero count. */
  readonly showZero?: boolean
  /** Cap the display — anything above renders as `{max}+`. Defaults to 99. */
  readonly max?: number
}

/**
 * `<CountBadge>` — a tiny numeric chip (min-width square, radius-sm, tabular figures) for counts and
 * unread indicators. Renders nothing at zero unless `showZero`, and caps large values at `{max}+`.
 */
export function CountBadge({
  count,
  showZero = false,
  max = 99,
  className,
  ...rest
}: CountBadgeProps): ReactElement | null {
  if (count <= 0 && !showZero) return null
  const label = count > max ? `${max}+` : String(count)
  return (
    <span className={cx('xeno-countbadge', className)} {...rest}>
      {label}
    </span>
  )
}

/* ── CitationBadge ─────────────────────────────────────────────────────────────────── */

export interface CitationBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The citation number. */
  readonly index: number
  /** The source label before the number — the `XS` in `[XS:n]`. Defaults to `XS`. */
  readonly label?: string
}

/**
 * `<CitationBadge>` — an inline monospace source marker in the `[XS:n]` shape, subtle by default
 * (surface chip, hairline border, muted brackets) with the index emphasised to text colour. Sized to
 * sit on a line of running text.
 */
export function CitationBadge({
  index,
  label = 'XS',
  className,
  ...rest
}: CitationBadgeProps): ReactElement {
  return (
    <span className={cx('xeno-citation', className)} {...rest}>
      [{label}:<span className="xeno-citation-index">{index}</span>]
    </span>
  )
}
