/**
 * The MANIFEST: a flat, sorted index of every element in a pack — the catalogue a foundry, a docs
 * site, or a consumer's build reads to know what exists WITHOUT importing 300 declaration modules.
 * Pure projection of the declarations; carries no geometry (that lives in the per-element artifacts).
 */
import type { ElementDeclaration } from '@xenosystem/elements/schema'

export interface ManifestEntry {
  readonly id: string
  readonly kind: ElementDeclaration['kind']
  readonly viewBox: string
  readonly weight: string
  /** Axes the element honours — empty for a degenerate icon. */
  readonly axes: readonly string[]
  readonly signals: readonly string[]
  /** Geometry variant keys beyond `base` (e.g. `selection:on`), sorted. */
  readonly variants: readonly string[]
  readonly tags: readonly string[]
  readonly since: string | null
  readonly role: string
  readonly label: string
}

export interface Manifest {
  readonly count: number
  readonly elements: readonly ManifestEntry[]
}

const byId = (a: ManifestEntry, b: ManifestEntry): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

export const toEntry = (d: ElementDeclaration): ManifestEntry => ({
  id: d.id,
  kind: d.kind,
  viewBox: d.contract.viewBox,
  weight: d.contract.weight,
  axes: d.contract.axes,
  signals: d.contract.signals,
  variants: Object.keys(d.geometry)
    .filter((k) => k !== 'base')
    .sort(),
  tags: d.meta?.tags ?? [],
  since: d.meta?.since ?? null,
  role: d.a11y.role,
  label: d.a11y.label,
})

export const buildManifest = (decls: readonly ElementDeclaration[]): Manifest => {
  const elements = decls.map(toEntry).sort(byId)
  return { count: elements.length, elements }
}
