import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'

/**
 * `<Avatar>` — a person/agent tile. Grammar-consistent: a rounded SQUARE (`radius.xs`), NEVER a circle.
 * Content resolves by priority — an `<img>` when `src` is given (object-fit: cover), else a glyph
 * (declaration) drawn by the shared renderer when `icon` is given, else uppercase INITIALS derived from
 * `name` (muted ink on the control surface). The root is `role="img"` with an accessible label so a
 * screen reader announces the person once (ARIA hides the leaf content), whatever the visual fallback.
 */
export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Pixel edge length of the square. Default 24. */
  readonly size?: number
  /** Image source — highest priority; rendered object-fit: cover. */
  readonly src?: string
  /** Display name — initials fallback, and the accessible label when `alt` is absent. */
  readonly name?: string
  /** Glyph declaration — the middle fallback, drawn in muted ink. */
  readonly icon?: ElementDeclaration
  /** Accessible label / image alt. Falls back to `name`, then a generic label. */
  readonly alt?: string
}

/** First letters of the first and last word (uppercased); a single word yields its first two letters. */
const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) {
    const only = parts[0] ?? ''
    return only.slice(0, 2).toUpperCase()
  }
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  return (first.charAt(0) + last.charAt(0)).toUpperCase()
}

export function Avatar({
  size = 24,
  src,
  name,
  icon,
  alt,
  className,
  style,
  ...rest
}: AvatarProps): ReactElement {
  const variant = src !== undefined ? 'image' : icon !== undefined ? 'icon' : name !== undefined ? 'initials' : 'empty'
  const label = alt ?? name ?? 'Avatar'
  const rootStyle = { ['--xeno-avatar-size']: `${size}px`, ...style } as CSSProperties

  const content =
    src !== undefined ? (
      <img className="xeno-avatar-img" src={src} alt="" draggable={false} />
    ) : icon !== undefined ? (
      <XenoElement decl={icon} size={Math.round(size * 0.58)} />
    ) : name !== undefined ? (
      <span className="xeno-avatar-initials" aria-hidden="true">
        {initialsOf(name)}
      </span>
    ) : null

  return (
    <span
      className={cx('xeno-avatar', className)}
      data-variant={variant}
      role="img"
      aria-label={label}
      style={rootStyle}
      {...rest}
    >
      {content}
    </span>
  )
}

/** One entry in an {@link AvatarStack} — the same content priority as {@link Avatar}. */
export interface AvatarStackItem {
  readonly src?: string
  readonly name?: string
  readonly icon?: ElementDeclaration
}

/**
 * `<AvatarStack>` — overlapping avatar squares. Each tile is pulled left and carries a 2px `--xeno-canvas`
 * ring so the overlap reads as a stack; earlier tiles sit on top. When there are more items than `max`,
 * a trailing `+N` overflow tile stands in for the remainder.
 */
export interface AvatarStackProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** People/agents to stack. */
  readonly items: readonly AvatarStackItem[]
  /** Maximum tiles shown before collapsing into a `+N` overflow tile. Default 4. */
  readonly max?: number
  /** Pixel edge length of every tile. Default 24. */
  readonly size?: number
}

export function AvatarStack({
  items,
  max = 4,
  size = 24,
  className,
  style,
  ...rest
}: AvatarStackProps): ReactElement {
  const visible = items.slice(0, max)
  const overflow = items.length - visible.length
  const rootStyle = { ['--xeno-avatar-size']: `${size}px`, ...style } as CSSProperties

  return (
    <div className={cx('xeno-avatar-stack', className)} role="group" style={rootStyle} {...rest}>
      {visible.map((item, i) => (
        <Avatar
          key={i}
          size={size}
          style={{ zIndex: visible.length - i }}
          {...(item.src !== undefined ? { src: item.src } : {})}
          {...(item.name !== undefined ? { name: item.name } : {})}
          {...(item.icon !== undefined ? { icon: item.icon } : {})}
        />
      ))}
      {overflow > 0 ? (
        <span
          className="xeno-avatar xeno-avatar-more"
          data-variant="more"
          role="img"
          aria-label={`${overflow} more`}
          style={{ ['--xeno-avatar-size']: `${size}px`, zIndex: 0 } as CSSProperties}
        >
          <span className="xeno-avatar-initials" aria-hidden="true">
            +{overflow}
          </span>
        </span>
      ) : null}
    </div>
  )
}
