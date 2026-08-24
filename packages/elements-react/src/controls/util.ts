import { controlSize, type ControlSizeToken } from '@xenosystem/elements/tokens'

export type { ControlSizeToken }

/**
 * Name the control's size on the element; `size.css` turns that into the four metric variables the
 * control styles read (`--xeno-h/-padx/-gap/-font`).
 *
 * These used to be emitted here as INLINE custom properties. Inline is the one place nothing can
 * override, so a surface — a product rendering the same controls for touch rather than a mouse — had
 * no way to reach them. As an attribute they are ambient: a surface redefines the variables once at
 * the root and every control follows, with nothing changed at any call site.
 *
 * The attribute is namespaced so it cannot collide with a host application's own `data-size`.
 */
export const sizeAttr = (size: ControlSizeToken): { readonly 'data-xeno-size': ControlSizeToken } => ({
  'data-xeno-size': size,
})

/**
 * The same metrics as an object, for the rare caller that needs the NUMBERS rather than the styling —
 * a measurement, a canvas, a layout calculation. Not for styling: use {@link sizeAttr}.
 */
export const sizeMetrics = (size: ControlSizeToken) => controlSize[size]

/** Glyph px for a control size — so a button's leading icon scales with the button. */
export const iconPx = (size: ControlSizeToken): number => controlSize[size].icon

export const cx = (...parts: (string | false | undefined)[]): string => parts.filter(Boolean).join(' ')
