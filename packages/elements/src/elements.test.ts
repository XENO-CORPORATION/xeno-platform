import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { ElementDeclaration, Primitive, VariantGeometry } from './schema'

/**
 * Guards the promoted glyph declarations. Each must typecheck (compile-time) AND, at runtime, be a valid
 * icon whose geometry is in the primitive vocabulary and whose fills reference a TOKEN only — never a
 * literal colour or `currentColor`. That last check is the "declarations are DATA, not code" boundary.
 */

const dir = fileURLToPath(new URL('./elements', import.meta.url))
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

const declarations: { path: string; decl: ElementDeclaration }[] = []
for (const f of files) {
  const base = f.replace(/\.ts$/, '')
  const mod = (await import(`./elements/${base}.ts`)) as { default: ElementDeclaration }
  declarations.push({ path: f, decl: mod.default })
}

const KINDS = ['icon', 'control', 'container', 'composite']
const FILL_TOKENS = new Set(['foreground'])

const primitives = (g: VariantGeometry): readonly Primitive[] =>
  typeof g === 'string' ? [{ kind: 'path', d: g }] : g

describe('promoted glyph declarations', () => {
  // Counted from the directory rather than pinned to a number: the point of the check is that every
  // file loads and every id is unique, and a hard-coded total only means someone has to edit this line
  // each time a glyph is added — which is exactly the moment they stop reading what it asserts.
  it('imports every glyph in the directory with unique xeno.<name> ids', () => {
    expect(declarations.length).toBe(files.length)
    expect(declarations.length).toBeGreaterThan(40)
    const ids = declarations.map((d) => d.decl.id)
    expect(new Set(ids).size).toBe(declarations.length)
    for (const id of ids) expect(id).toMatch(/^xeno\.[a-z][a-z0-9-]*$/)
  })

  for (const { path, decl } of declarations) {
    describe(decl?.id ?? path, () => {
      it('is a valid icon declaration', () => {
        expect(KINDS).toContain(decl.kind)
        expect(decl.contract.viewBox).toBe('0 0 24 24')
        expect(decl.contract.weight).toBe('regular')
        expect(decl.contract.strokeFamily).toBeTruthy()
        expect(decl.a11y.role).toBeTruthy()
        expect(decl.a11y.label).toBeTruthy()
      })

      it('has a non-empty base geometry in the primitive vocabulary', () => {
        expect(decl.geometry.base).toBeDefined()
        const prims = primitives(decl.geometry.base)
        expect(prims.length).toBeGreaterThan(0)
        for (const p of prims) {
          expect(['rect', 'path']).toContain(p.kind)
          if (p.kind === 'rect') {
            for (const n of [p.x, p.y, p.w, p.h]) expect(Number.isFinite(n)).toBe(true)
          } else {
            expect(p.d.length).toBeGreaterThan(0)
          }
        }
      })

      it('carries no literal colour in ANY variant — fills reference a token only', () => {
        for (const variant of Object.values(decl.geometry)) {
          for (const p of primitives(variant)) {
            if (p.fill !== undefined) {
              expect(FILL_TOKENS.has(p.fill), `${decl.id}: fill='${p.fill}'`).toBe(true)
              expect(p.fill).not.toMatch(/#|rgb|currentcolor/i)
            }
          }
        }
      })

      it('declares only variant keys that address a real axis:value', () => {
        for (const key of Object.keys(decl.geometry)) {
          if (key === 'base') continue
          const [axis, value] = key.split(':')
          expect(decl.contract.axes, `${decl.id}: variant '${key}' but axis not declared`).toContain(axis)
          expect(value, `${decl.id}: variant '${key}' missing value`).toBeTruthy()
        }
      })
    })
  }
})
