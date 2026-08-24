/**
 * The XENO element contract.
 *
 * This file is the whole point of the repository. Everything else — every renderer on every
 * platform, every product that consumes an element, every agent that drives one — is an
 * interpretation of what is declared here.
 *
 * ## Two properties to preserve above all others
 *
 * **1. There is no "icon" type.** An icon is the degenerate {@link ElementDeclaration}: no
 * children, pure geometry. A button is the compound one: geometry plus a slot plus behaviour.
 * They share one schema and one release path, which is what makes "edit one icon" and "edit one
 * button" the identical operation. A refactor that gives icons their own type has thrown away
 * the reason this repo exists.
 *
 * **2. A declaration contains DATA, never code.** No functions, no expressions, no executable
 * animation — {@link Binding} is a description that a renderer interprets. This is an
 * architectural boundary with a legal edge: Apple permits downloading and running *interpreted*
 * content (the React Native shape, where JavaScript only calls into natives audited at
 * submission time), and 2026 enforcement fell on apps that generate and execute code to alter
 * their own behaviour. Data interpreted by a pre-reviewed renderer is inside the line. Shipping
 * animation functions would not be. See `docs/STATE-MODEL.md` §4.1.
 *
 * @module
 */

/* ── State: three orthogonal axes ──────────────────────────────────────────────────────────
 *
 * Deliberately NOT a single enum. An enum cannot express states that co-occur — a disabled
 * toggle that is `on`, a selected row being `pressed` — and those are ordinary, not edge cases.
 * It also conflates three different kinds of thing: what is possible, what is true, and what is
 * happening right now.
 */

/** Can this element be used at all? Persists. */
export type Availability = 'enabled' | 'disabled' | 'busy'

/**
 * Is it on? **Semantic and persistent** — it outlives the gesture that set it.
 *
 * The axis most systems forget, and the most common animated-element case in real products:
 * the bookmark, the like, the mute, the pin. `mixed` serves tri-state controls (a parent
 * checkbox over partially-selected children).
 */
export type Selection = 'off' | 'on' | 'mixed'

/**
 * What is the user doing right now? **Transient** — exists only while input is present.
 *
 * `engaged` is NOT "hover". It means hover on pointer devices and *nothing at all* on touch.
 * Naming it `hover` would bake a desktop assumption into a system that has to run on phones.
 */
export type Interaction = 'idle' | 'engaged' | 'pressed'

/** The complete discrete state of an element. Every axis always has a value; there is no "unset". */
export interface ElementState {
  readonly availability: Availability
  readonly selection: Selection
  readonly interaction: Interaction
}

export const DEFAULT_STATE: ElementState = {
  availability: 'enabled',
  selection: 'off',
  interaction: 'idle',
}

/** The axis names an element can declare that it honours. */
export type AxisName = keyof ElementState

/* ── Signals: continuous, optional ─────────────────────────────────────────────────────────
 *
 * A value, not a member of a set. This is the capability no shipping icon library has — they
 * are uniformly hover-and-click event libraries, and cannot express a half-completed swipe.
 *
 * Signals compose with axes: `enabled` + `off` + `pressed` + `progress: 0.4` is a user mid-swipe
 * on an unselected control, fully described.
 *
 * And a signal drives ANY element, not just an icon: swipe drives a row, drag drives a handle,
 * upload drives a button. One mechanism.
 */
export type SignalName =
  /** 0…1, determinate. Gesture scrub, drag, pull-to-refresh, swipe-to-reveal, upload. */
  | 'progress'
  /** Indeterminate. Spinner-class — work with no known endpoint. Visually a loop, not a fraction. */
  | 'activity'

export interface SignalValues {
  readonly progress?: number
  readonly activity?: boolean
}

/* ── Transitions: momentary effects ────────────────────────────────────────────────────────
 *
 * Fired, not held. You do not *dwell* in a click — what it needs is an acknowledgement, and
 * modelling it as a state forces every renderer to invent its own exit timing.
 */
export type TransitionName =
  /** Accepted — the tap/click acknowledgement. */
  | 'commit'
  /** Refused — invalid input, denied permission. */
  | 'reject'
  /** Selection flipped; fires alongside the selection change. */
  | 'toggle'

/* ── Bindings: state → appearance, declaratively ───────────────────────────────────────────── */

/**
 * What a binding may change. Deliberately small and geometric.
 *
 * `fill`/`stroke` accept ONLY design-system token references — never literal colours. A colour
 * that is not already in `DESIGN_SYSTEM.md` is a violation, not a feature; if a state has no
 * token, that is a question for the design system rather than a local decision.
 */
export type Channel =
  | 'opacity'
  | 'scale'
  | 'rotate'
  | 'translateX'
  | 'translateY'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'strokeDashoffset'
  /** Morph toward the geometry variant named by `to`. */
  | 'geometry'

/** A momentary effect a renderer plays, then returns to whatever the axes say. */
export type Effect = 'pulse' | 'shake' | 'flash'

/** Matches a subset of the discrete state. Omitted axes are wildcards. */
export type StateMatch = Partial<ElementState>

/** Applies while the state matches. */
export interface StateBinding {
  readonly when: StateMatch
  readonly channel: Channel
  readonly to: number | string
  /** Transition duration. Omitted means instant. */
  readonly ms?: number
  /** Easing token from the design system. Never a raw cubic-bezier. */
  readonly ease?: string
}

/** Maps a continuous signal onto a channel across a range. */
export interface SignalBinding {
  readonly signal: SignalName
  readonly channel: Channel
  readonly from: number | string
  readonly to: number | string
}

/** Plays once when a transition fires. */
export interface TransitionBinding {
  readonly on: TransitionName
  readonly effect: Effect
  readonly ms?: number
}

export type Binding = StateBinding | SignalBinding | TransitionBinding

/* ── Geometry: a closed, inert primitive vocabulary ──────────────────────────────────────────
 *
 * Geometry is DATA, must map to a NATIVE shape call on every renderer, be structurally diffable by
 * the contract checker, and interpolate per-part for the `geometry` morph channel. A list of typed
 * scalars does all four; an inner-SVG string does none (it is the web renderer's emit format and can
 * carry script/SMIL — the "declarations are data, never code" line, docs/STATE-MODEL.md §4.1); a
 * single flattened path forfeits sub-shape addressability and stroke. The XENO shape language is
 * rect-with-corner-radius everywhere (DESIGN_SYSTEM.md §3), so the vocabulary is deliberately just
 * `rect` + a bounded `path` escape hatch. No `circle`/`ellipse`/`line` — adding a kind later is
 * additive and backward-compatible. See `docs/rfcs/0001-geometry-primitive-vocabulary.md`.
 */

/**
 * An axis-aligned rounded rectangle in viewBox units. Maps 1:1 to `<rect rx>` (SVG),
 * RoundedRectangle / Path.addRoundedRect (SwiftUI), addRoundRect (Compose), and a rect op (PDF).
 */
export interface RectPrimitive {
  readonly kind: 'rect'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Corner radius, viewBox units. The XENO 0.4 corner cap lives here. Omitted = sharp. */
  readonly rx?: number
  /**
   * Fill role. Omitted = OUTLINE: the container paints it (`fill:none`; stroke = contract stroke).
   * A design-system token reference (never a literal colour, per {@link Channel}) = a SOLID part,
   * painted with that token and no stroke. This is the per-part fill flag the real glyphs use.
   */
  readonly fill?: string
}

/**
 * The bounded escape hatch for genuinely compound glyphs (e.g. `xeno.search`). Keeps the ONE string
 * grammar that is cross-platform native: SVG path `d`, parsed by Android PathParser and a small parser
 * on Apple. Any authoring-time transform is resolved INTO these coordinates, never carried. No markup,
 * no elements, no CSS — just M/L/C/Q/A/Z and numbers.
 */
export interface PathPrimitive {
  readonly kind: 'path'
  readonly d: string
  /** Same fill role as {@link RectPrimitive.fill}. Omitted = stroked outline. */
  readonly fill?: string
  /** Fill rule for compound paths with holes (e.g. the search lens ring). Omitted = nonzero. */
  readonly fillRule?: 'nonzero' | 'evenodd'
}

/** The closed primitive vocabulary. Extend by adding a kind; never by widening a field to a blob. */
export type Primitive = RectPrimitive | PathPrimitive

/**
 * Geometry for ONE variant. Backward-compatible union: a bare `string` is the LEGACY single path `d`,
 * exactly equivalent to `[{ kind: 'path', d }]`; renderers normalise a string to that one primitive.
 * New elements author a {@link Primitive} list. The string form is deprecated but never removed.
 */
export type VariantGeometry = string | readonly Primitive[]

/**
 * Geometry by variant. `base` is REQUIRED; further keys are `axis:value` (e.g. `selection:on` for a
 * filled bookmark) reachable via the `geometry` channel.
 */
export interface Geometry {
  readonly base: VariantGeometry
  readonly [variant: string]: VariantGeometry
}

/**
 * Can two variants morph, or must the renderer crossfade? Fails CLOSED: unequal length, a per-index kind
 * mismatch, or two paths whose command sequences differ → `false`. Deliberately NOT wired into
 * {@link checkCompatibility} — geometry stays a refinement there — so behaviour is unchanged; adopting
 * it into the checker is a separate decision.
 *
 * The command check is not pedantry, and it was learned the hard way. Matching KINDS is what an
 * interpolator needs to pair the shapes up; matching COMMANDS is what it needs to pair the numbers up.
 * `M4 12H19` and `M6.5 6.5L17.5 17.5` are both single paths of two points and this function used to call
 * them morphable — but one ends in a horizontal-line command and the other in a general line, so a
 * browser asked to interpolate them gives up and snaps to the end. Two of three strokes animated and the
 * third teleported, which looks like a bug in the drawing rather than in the check.
 */
export function geometryMorphable(a: VariantGeometry, b: VariantGeometry): boolean {
  const listOf = (g: VariantGeometry): readonly Primitive[] =>
    typeof g === 'string' ? [{ kind: 'path', d: g }] : g
  /** The command letters, in order — the only part of a path an interpolator cares about structurally. */
  const commands = (d: string): string => (d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).join('')
  const x = listOf(a)
  const y = listOf(b)
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    const p = x[i]!
    const q = y[i]!
    if (p.kind !== q.kind) return false
    if (p.kind === 'path' && q.kind === 'path' && commands(p.d) !== commands(q.d)) return false
  }
  return true
}

/* ── The contract ──────────────────────────────────────────────────────────────────────────── */

/**
 * The stable, machine-checkable promise an element makes to its consumers.
 *
 * A product pins **the contract, not the bytes**. That distinction is what npm structurally
 * cannot express — a package version cannot tell "we polished the glyph" from "we deleted the
 * glyph" — and it is what lets a refinement propagate automatically while a breaking change
 * cannot. See `SPEC.md` §7.1.
 */
export interface ElementContract {
  readonly viewBox: string
  /** Optical weight family. Elements of one weight must sit together without adjustment. */
  readonly weight: 'light' | 'regular' | 'bold'
  readonly strokeFamily: string
  /** Which axes this element honours. A decorative glyph declares none. */
  readonly axes: readonly AxisName[]
  /** Which continuous inputs it accepts. */
  readonly signals: readonly SignalName[]
}

export type ElementKind =
  /** Degenerate: no children, pure geometry. */
  | 'icon'
  /** Interactive leaf — a toggle, a handle. */
  | 'control'
  /** Holds other elements. */
  | 'container'
  /** Compound: geometry + slot + label + behaviour. A button. */
  | 'composite'

export interface ElementDeclaration {
  /**
   * Stable forever. This is the unit of change, the unit of pinning, and how every product,
   * saved file and agent refers to the element. **Renaming one is an ecosystem-wide breaking
   * change** — add a new id and deprecate instead.
   */
  readonly id: string
  readonly kind: ElementKind
  readonly contract: ElementContract
  /**
   * Geometry by variant — a {@link Geometry}. `base` is required; further keys are `axis:value`
   * variants (e.g. `selection:on` for a filled bookmark) reachable via the `geometry` channel. Each
   * variant is a {@link Primitive} list (or a legacy path `string`, normalised to one path primitive).
   */
  readonly geometry: Geometry
  readonly bindings: readonly Binding[]
  readonly a11y: {
    readonly role: string
    readonly label: string
  }
  readonly meta?: {
    readonly tags?: readonly string[]
    /** Version this element first appeared in. */
    readonly since?: string
    /** Set when superseded; names the replacement id. Never delete an element outright. */
    readonly deprecatedBy?: string
  }
}

/* ── Contract compatibility ────────────────────────────────────────────────────────────────
 *
 * The machine-checkable question behind automatic propagation: may this change reach a shipped
 * product without that product rebuilding?
 */

export interface CompatibilityResult {
  readonly compatible: boolean
  /** Human-readable reasons a change was refused. Empty when compatible. */
  readonly breaks: readonly string[]
}

/**
 * Decide whether `next` may replace `prev` for a consumer that pinned `prev`'s contract.
 *
 * Refinements pass: redrawn geometry, retuned timings, added variants, added elements.
 * Breaks are refused: a dropped axis, a dropped signal, a changed viewBox or weight, a removed
 * element.
 *
 * **Fails CLOSED.** Anything this function does not positively understand is a break. A
 * permissive contract checker is worse than none — it produces evidence of safety it has not
 * established, which is the failure mode this ecosystem has already hit three times.
 */
export function checkCompatibility(
  prev: ElementDeclaration,
  next: ElementDeclaration | undefined,
): CompatibilityResult {
  const breaks: string[] = []

  if (next === undefined) {
    return { compatible: false, breaks: [`${prev.id}: element removed`] }
  }
  if (next.id !== prev.id) {
    breaks.push(`${prev.id}: id changed to ${next.id} — ids are permanent`)
  }
  if (next.contract.viewBox !== prev.contract.viewBox) {
    breaks.push(
      `${prev.id}: viewBox ${prev.contract.viewBox} → ${next.contract.viewBox} — consumers size against it`,
    )
  }
  if (next.contract.weight !== prev.contract.weight) {
    breaks.push(`${prev.id}: weight ${prev.contract.weight} → ${next.contract.weight}`)
  }
  if (next.contract.strokeFamily !== prev.contract.strokeFamily) {
    breaks.push(
      `${prev.id}: strokeFamily ${prev.contract.strokeFamily} → ${next.contract.strokeFamily}`,
    )
  }
  for (const axis of prev.contract.axes) {
    if (!next.contract.axes.includes(axis)) {
      breaks.push(`${prev.id}: dropped axis "${axis}" — consumers may be driving it`)
    }
  }
  for (const signal of prev.contract.signals) {
    if (!next.contract.signals.includes(signal)) {
      breaks.push(`${prev.id}: dropped signal "${signal}"`)
    }
  }

  return { compatible: breaks.length === 0, breaks }
}
