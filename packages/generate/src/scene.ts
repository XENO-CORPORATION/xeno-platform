/**
 * The one INTERPRETATION of a declaration, shared by every web-side renderer. It resolves the axis
 * state to a geometry variant, turns each primitive into a neutral draw node, and resolves fill
 * TOKENS to paint — all the fail-closed decisions live here, exactly once. A serializer (SVG string,
 * {@link ./svg.ts}) and a framework renderer (`elements-react`) each consume this Scene and map it to
 * their own attribute dialect (`stroke-width` vs `strokeWidth`), so the two can never drift on what
 * to draw — only on how to spell it.
 */
import type {
  AxisName,
  ElementDeclaration,
  ElementState,
  Primitive,
  VariantGeometry,
} from '@xenosystem/elements/schema'
import { geometryMorphable } from '@xenosystem/elements/schema'

type Weight = ElementDeclaration['contract']['weight']

/**
 * The state a renderer shows when an axis is unspecified — the same values as the contract's
 * `DEFAULT_STATE`, kept local so the interpreter stays a pure emitter with no runtime import from the
 * contract package (type-only imports keep the shipped code platform-free).
 */
const DEFAULT_STATE: ElementState = {
  availability: 'enabled',
  selection: 'off',
  interaction: 'idle',
}

/**
 * Weight → stroke width, in viewBox units. A RENDERER decision (the declaration names a `weight`
 * family, not a number), so it lives here and is revisable without touching a single declaration.
 * `regular` = 1.75 matches the value the foundry workbench shipped and the design approved.
 */
const WEIGHT_STROKE: Record<Weight, number> = { light: 1.25, regular: 1.75, bold: 2.25 }

/**
 * Fill token → CSS paint. The XENO grammar is monochrome: the single ink is `currentColor`, so it
 * inherits the surrounding text colour on every surface. Extend this map when the design system adds
 * a painted role — never by letting a literal colour through.
 */
const FILL_PAINT: Record<string, string> = { foreground: 'currentColor' }

/**
 * When more than one axis has a matching `<axis>:<value>` geometry variant, the more TRANSIENT axis
 * wins — a press should read over a selection, a selection over mere availability. Rarely collides
 * (most elements vary on one axis), but the order must be defined, not incidental.
 */
const AXIS_PRECEDENCE: readonly AxisName[] = ['availability', 'selection', 'interaction']

export interface SceneOptions {
  /** Discrete state to render. Missing axes fall back to the default (enabled / off / idle). */
  readonly state?: Partial<ElementState>
  /** Pixel width/height on the root. Default 24. The viewBox is always the declared one. */
  readonly size?: number
  /** Override the weight-derived stroke width. */
  readonly strokeWidth?: number
  /** Extra class on the root element. */
  readonly className?: string
}

/**
 * A resolved draw node. `fill` is the RESOLVED paint (`currentColor`) for a solid part, or `undefined`
 * for an outline part that inherits the root's `stroke:currentColor; fill:none`.
 */
export interface RectNode {
  readonly kind: 'rect'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly rx?: number
  readonly fill?: string
}
export interface PathNode {
  readonly kind: 'path'
  readonly d: string
  readonly fill?: string
  readonly fillRule?: 'nonzero' | 'evenodd'
}
export type ShapeNode = RectNode | PathNode

/** The fully-resolved thing to draw. Neutral: no attribute-name dialect committed to yet. */
export interface Scene {
  readonly viewBox: string
  readonly size: number
  readonly strokeWidth: number
  readonly role: string
  readonly label: string
  /** Short glyph name (id without the `xeno.` prefix) — emitted as `data-glyph`, the hook the
   * animated-icon stylesheet targets so each glyph can carry its own motion. */
  readonly glyph: string
  /** `data-<axis>` values for the axes the element DECLARES it honours (empty for a degenerate icon). */
  readonly data: Readonly<Record<`data-${string}`, string>>
  readonly className: string | undefined
  /**
   * Whether what is being drawn can be interpolated back to `base` — same primitive count, same kind at
   * every index.
   *
   * The interpreter does not animate anything; it says only that an animation is POSSIBLE, which is the
   * whole point. A scene that reports `morph` lets a stylesheet interpolate the path data, one that does
   * not lets it swap, and neither needs an animation runtime to decide which. `geometryMorphable` has sat
   * in the schema since the start as a check nothing consumed; this is what consumes it.
   *
   * `base` itself counts as morphable, because a control that morphs has to morph BACK — and the state
   * it returns to is base. Answering `false` there would animate the outbound half and snap the return.
   */
  readonly morph: boolean
  readonly shapes: readonly ShapeNode[]
}

const finite = (n: number): number => {
  if (!Number.isFinite(n)) throw new Error(`interpret: non-finite coordinate ${String(n)}`)
  return n
}

const paintFor = (token: string): string => {
  if (token === 'none') return 'none'
  const paint = FILL_PAINT[token]
  if (paint === undefined) {
    throw new Error(
      `interpret: unknown fill token '${token}'. A fill must reference a design-system token, ` +
        `never a literal colour (SPEC §14.2 — the guard fails closed).`,
    )
  }
  return paint
}

const listOf = (g: VariantGeometry): readonly Primitive[] =>
  typeof g === 'string' ? [{ kind: 'path', d: g }] : g

/** Pick the geometry variant the state addresses: `base`, overridden by any matching `<axis>:<value>`. */
const activeGeometry = (decl: ElementDeclaration, state: ElementState): VariantGeometry => {
  let geometry = decl.geometry.base
  for (const axis of AXIS_PRECEDENCE) {
    const variant = decl.geometry[`${axis}:${state[axis]}`]
    if (variant !== undefined) geometry = variant
  }
  return geometry
}

const shapeOf = (p: Primitive): ShapeNode => {
  if (p.kind === 'rect') {
    const base = {
      kind: 'rect' as const,
      x: finite(p.x),
      y: finite(p.y),
      w: finite(p.w),
      h: finite(p.h),
    }
    return {
      ...base,
      ...(p.rx !== undefined ? { rx: finite(p.rx) } : {}),
      ...(p.fill !== undefined ? { fill: paintFor(p.fill) } : {}),
    }
  }
  return {
    kind: 'path',
    d: p.d,
    ...(p.fill !== undefined ? { fill: paintFor(p.fill) } : {}),
    ...(p.fillRule ? { fillRule: p.fillRule } : {}),
  }
}

/** Interpret a declaration + state into a neutral, fully-resolved {@link Scene}. Fails closed. */
export const interpret = (decl: ElementDeclaration, opts: SceneOptions = {}): Scene => {
  const state: ElementState = { ...DEFAULT_STATE, ...opts.state }
  const data: Record<`data-${string}`, string> = {}
  for (const axis of decl.contract.axes) data[`data-${axis}`] = state[axis]
  const active = activeGeometry(decl, state)

  return {
    viewBox: decl.contract.viewBox,
    size: opts.size ?? 24,
    strokeWidth: opts.strokeWidth ?? WEIGHT_STROKE[decl.contract.weight],
    role: decl.a11y.role,
    label: decl.a11y.label,
    glyph: decl.id.replace(/^xeno\./, ''),
    data,
    className: opts.className,
    // A declaration with only `base` has nowhere to morph TO. It would trivially pass the check, and
    // marking it would put a `d` transition on every path of every icon in the set to animate nothing.
    morph: Object.keys(decl.geometry).length > 1 && geometryMorphable(decl.geometry.base, active),
    shapes: listOf(active).map(shapeOf),
  }
}
