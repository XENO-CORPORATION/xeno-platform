import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'

/**
 * `<Tile>` — a square icon tile (radius-md, `var(--xeno-surface)`) that centres a single glyph drawn by
 * the shared `<XenoElement>` renderer, so it inherits the monochrome ink and adds no colour of its own.
 * The chat's file/attachment affordance: a small surface square holding a file/folder/image glyph.
 *
 * `size` is the box edge in px (e.g. 24 / 32); the glyph defaults to half the edge and can be pinned
 * with `glyphSize`.
 */
export interface TileProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'style'> {
  /** The glyph to centre — imported per-id from `@xenosystem/elements`. */
  readonly icon: ElementDeclaration
  /** Box edge in px. Default 32. */
  readonly size?: number
  /** Glyph px. Defaults to half the box edge. */
  readonly glyphSize?: number
}

export function Tile({ icon, size = 32, glyphSize, className, ...rest }: TileProps): ReactElement {
  const glyph = glyphSize ?? Math.round(size * 0.5)
  return (
    <span
      className={cx('xeno-tile', className)}
      style={{ ['--xeno-tile-size']: `${size}px` } as CSSProperties}
      {...rest}
    >
      <XenoElement decl={icon} size={glyph} />
    </span>
  )
}
