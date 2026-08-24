/**
 * Surface tokens — `DESIGN_SYSTEM.md §2` (canonical). Opaque hex, dark-first.
 *
 * These are DATA: the value a renderer resolves a surface *role* to. A declaration never carries a
 * literal colour — it references a token; this is the resolution. Implement the locked design system
 * verbatim; never invent a surface value here.
 */
export const surface = {
  page: '#08080a',
  canvas: '#111111',
  panelBody: '#161618',
  panelHeader: '#1a1a1a',
  tabBar: '#272727',
  input: '#2b2b2b',
  dialog: '#111115',
  dropdown: '#101011',
} as const

export type SurfaceToken = keyof typeof surface
