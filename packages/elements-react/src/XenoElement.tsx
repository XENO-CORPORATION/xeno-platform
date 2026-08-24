import type { CSSProperties, ReactElement, SVGProps } from 'react'
import type { ElementDeclaration, ElementState } from '@xenosystem/elements/schema'
import { interpret, type ShapeNode } from '@xenosystem/generate'

/**
 * `<XenoElement>` — the XENO web renderer.
 *
 * It interprets a declaration (pure DATA) into SVG via the SHARED {@link interpret} core, so it draws
 * byte-for-byte what the reference `renderSvg` serializer draws (SPEC §6: two renderers must be
 * visually indistinguishable). It adds nothing of its own — no colours, no timings.
 *
 * ## Why there is no per-icon component (and no barrel)
 * This is ONE component parameterised by data, not 300 generated components. The failure mode the spec
 * pre-registers — lucide's 2.4 MB barrel — comes from a module that imports every icon. Here the glyph
 * is `decl`, imported per-id from `@xenosystem/elements` (which itself forbids barrelling
 * declarations), so a product pulls in exactly the elements it names and nothing else.
 *
 * ## CSS-first, 0 kb
 * State is not animated in JS. Every axis the element declares becomes a `data-<axis>` attribute on the
 * root; a stylesheet (`./xeno-element.css`) is where token-driven transitions attach. A geometry
 * variant swap (e.g. bookmark off↔on) is re-rendered from `state` — no animation runtime, ever.
 */
/**
 * Everything an `<svg>` accepts, plus the element's own four. The passthrough matters for one case
 * above all: a glyph rendered NEXT TO its own label is decorative, and a decorative icon must be
 * `aria-hidden` or a screen reader announces the same thing twice. The declaration cannot know which
 * it is — only the call site can — so the caller has to be able to say.
 */
export interface XenoElementProps
  extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'strokeWidth' | 'className'> {
  /** The element to render. Import it per-id from `@xenosystem/elements`. */
  readonly decl: ElementDeclaration
  /** Discrete state. Missing axes default to enabled / off / idle. */
  readonly state?: Partial<ElementState>
  /** Pixel width/height. Default 24; the viewBox is always the declared one. */
  readonly size?: number
  /** Override the weight-derived stroke width. */
  readonly strokeWidth?: number
  /** Extra class on the root `<svg>`. `xeno-element` is always present. */
  readonly className?: string
}

const Shape = (s: ShapeNode, i: number, morph: boolean) => {
  // A solid part is painted and explicitly un-stroked; an outline part omits both and inherits the
  // root's `fill:none; stroke:currentColor`.
  const paint = s.fill !== undefined ? { fill: s.fill, stroke: 'none' } : {}
  if (s.kind === 'rect') {
    return <rect key={i} className="xeno-part" data-part={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...paint} />
  }
  // A morphable path carries its `d` a SECOND time, as a custom property. The attribute stays the
  // fallback and stays authoritative wherever CSS `d` is unsupported; the property is the thing a
  // stylesheet can interpolate, because changing a custom property is a computed-value change and `d`
  // transitions. React swaps the value on re-render and the browser does the rest — still no runtime.
  const morphStyle = morph ? ({ '--part-d': `path('${s.d}')` } as CSSProperties) : undefined
  return <path key={i} className="xeno-part" data-part={i} d={s.d} fillRule={s.fillRule} style={morphStyle} {...paint} />
}

export function XenoElement({
  decl,
  state,
  size,
  strokeWidth,
  className,
  ...rest
}: XenoElementProps): ReactElement {
  const scene = interpret(decl, {
    ...(state !== undefined ? { state } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(className !== undefined ? { className } : {}),
  })

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={scene.size}
      height={scene.size}
      viewBox={scene.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={scene.strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="round"
      role={scene.role}
      aria-label={scene.label}
      data-glyph={scene.glyph}
      {...(scene.morph ? { 'data-morph': 'on' } : {})}
      data-xeno-element=""
      className={scene.className ? `xeno-element ${scene.className}` : 'xeno-element'}
      {...scene.data}
      /* LAST, so a call site can override what the declaration assumed. Chiefly `aria-hidden` and the
         `role`/`aria-label` pair: a glyph beside its own label is decoration, and the declaration has
         no way to know that. */
      {...rest}
    >
      {scene.shapes.map((s, i) => Shape(s, i, scene.morph))}
    </svg>
  )
}
