import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { buildManifest } from './manifest'

const dir = fileURLToPath(new URL('../../elements/src/elements', import.meta.url))
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

const decls: ElementDeclaration[] = []
for (const f of files) {
  const base = f.replace(/\.ts$/, '')
  const mod = (await import(`../../elements/src/elements/${base}.ts`)) as { default: ElementDeclaration }
  decls.push(mod.default)
}

describe('buildManifest', () => {
  const manifest = buildManifest(decls)
  const entry = (id: string) => {
    const e = manifest.elements.find((x) => x.id === id)
    if (!e) throw new Error(`no manifest entry: ${id}`)
    return e
  }

  // Counted from the input rather than pinned: what this guards is that the manifest indexes each
  // element exactly once and stays sorted, not how many there happen to be today. A hard-coded total
  // just has to be edited whenever a glyph is added, which is when people stop reading the assertion.
  it('indexes every element once, sorted by id', () => {
    expect(manifest.count).toBe(decls.length)
    expect(manifest.elements).toHaveLength(decls.length)
    const ids = manifest.elements.map((e) => e.id)
    expect([...ids].sort()).toEqual(ids) // already sorted
    expect(new Set(ids).size).toBe(decls.length)
  })

  it('projects the contract without geometry', () => {
    for (const e of manifest.elements) {
      expect(e.viewBox).toBe('0 0 24 24')
      expect(e.weight).toBe('regular')
      expect(e.role).toBeTruthy()
      expect(e.label).toBeTruthy()
      expect(e).not.toHaveProperty('geometry')
    }
  })

  it('surfaces axes and variant keys for stateful elements', () => {
    const bookmark = entry('xeno.bookmark')
    expect(bookmark.axes).toEqual(['selection'])
    expect(bookmark.variants).toEqual(['selection:on'])
  })

  it('leaves degenerate icons with no axes and no variants', () => {
    const menu = entry('xeno.menu')
    expect(menu.axes).toEqual([])
    expect(menu.variants).toEqual([])
  })
})
