import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { radius, surface, text, status, easing, duration, stagger } from '@xenosystem/elements/tokens'

/**
 * Drift guard: the theme CSS custom properties must equal the token DATA. The tokens are the source of
 * truth (DESIGN_SYSTEM §2 + the locked radius scale); this proves the stylesheet did not fork from them.
 * (Size metrics are not tested here — the controls set them inline from the tokens, so they cannot drift.)
 */
const css = readFileSync(fileURLToPath(new URL('./xeno-theme.css', import.meta.url)), 'utf8')

// First occurrence = the dark `.xeno` block (light overrides come later in the file).
const cssVar = (name: string): string | undefined => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return m?.[1]?.trim()
}

describe('xeno-theme.css mirrors the tokens', () => {
  it('radius vars equal the radius scale', () => {
    expect(cssVar('xeno-radius-hair')).toBe(`${radius.hair}px`)
    expect(cssVar('xeno-radius-xs')).toBe(`${radius.xs}px`)
    expect(cssVar('xeno-radius-sm')).toBe(`${radius.sm}px`)
    expect(cssVar('xeno-radius-md')).toBe(`${radius.md}px`)
    expect(cssVar('xeno-radius-control')).toBe(`${radius.control}px`)
    expect(cssVar('xeno-radius-card')).toBe(`${radius.card}px`)
  })

  it('dark colour roles equal the DESIGN_SYSTEM tokens', () => {
    expect(cssVar('xeno-canvas')).toBe(surface.page)
    expect(cssVar('xeno-on-accent')).toBe(surface.page)
    expect(cssVar('xeno-text')).toBe(text.hover)
    expect(cssVar('xeno-muted')).toBe(text.idle)
    expect(cssVar('xeno-active')).toBe(text.active)
  })

  /**
   * The two surfaces the separated panel architecture stands on (§2 Layer 2 + Layer 3). They were the
   * tokens the theme had not exposed, which is the mechanical reason the panel had nowhere to put a
   * second surface and ended up merged behind a hairline instead.
   */
  it('the panel surface ladder equals the DESIGN_SYSTEM layers', () => {
    expect(cssVar('xeno-surface')).toBe(surface.panelBody)
    expect(cssVar('xeno-panel-header')).toBe(surface.panelHeader)
  })

  it('danger is the one hue allowed (status token)', () => {
    expect(cssVar('xeno-danger')).toBe(status.danger)
    expect(cssVar('xeno-danger-hover')).toBe(status.dangerHover)
  })

  /*
   * The chrome axis. Two constructions ship, and the failure mode is asymmetry: a token added to the
   * default and forgotten in `unified` inherits the default silently, so one chrome half-renders in a
   * way no unit test on a component can see. "The half that has no guard is the half that's missing."
   */
  describe('the chrome axis defines both constructions completely', () => {
    const block = (selector: string): string => {
      const m = css.match(new RegExp(`${selector.replace(/[.[\]'=]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`))
      const body = m?.[1]
      if (body === undefined) throw new Error(`xeno-theme.css has no ${selector} block`)
      return body
    }
    const chromeVars = (b: string): Map<string, string> =>
      new Map([...b.matchAll(/--(xeno-style-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))

    /*
     * The two constructions live in SEPARATE, SEPARATELY-OWNED files so two people can work in
     * parallel. This suite is the contract between them — it is the only place the two are compared.
     *
     * `:root`, NOT `.xeno`: the axis must not sit on a selector apps nest, or a nested scope
     * re-declares it and the whole axis goes inert. That bug shipped once.
     */
    const read = (f: string): string =>
      readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8')
    const blockIn = (src: string, selector: string): string => {
      const escaped = selector.replace(/[.[\]'=]/g, (c) => `\\${c}`)
      const m = src.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
      const body = m?.[1]
      if (body === undefined) throw new Error(`no ${selector} block`)
      return body
    }
    const base = chromeVars(blockIn(read('style-industrial.css'), ':root'))
    const unified = chromeVars(blockIn(read('style-soft.css'), "[data-style='soft']"))

    it('the axis is NOT declared on .xeno — a nested scope would reset it', () => {
      /* The bug this pins: `.xeno` is a scope marker an app nests, and a custom property resolves
         from the nearest declaring ancestor. While the axis lived on `.xeno`, every nested scope
         re-declared it at the default and `data-style` on the root reached nothing at all. */
      expect(chromeVars(block('.xeno')).size).toBe(0)
    })

    it('the default (separated) defines the full set', () => {
      // A floor: a wrong selector would otherwise scan an empty block and pass over nothing.
      expect(base.size).toBeGreaterThanOrEqual(9)
    })

    it('SOFT declares every token INDUSTRIAL does', () => {
      expect([...base.keys()].filter((k) => !unified.has(k))).toEqual([])
    })

    it('INDUSTRIAL declares every token SOFT does', () => {
      // The reverse direction matters just as much: a token only Soft declares leaves Industrial
      // inheriting nothing, and "the half that has no guard is the half that's missing".
      expect([...unified.keys()].filter((k) => !base.has(k))).toEqual([])
    })

    it('every override actually differs — a theme that changes nothing is a lie', () => {
      const same = [...unified].filter(([k, v]) => base.get(k) === v).map(([k]) => k)
      expect(same).toEqual([])
    })

    /**
     * `unified` is a PRESERVED look, not a designed one — it must render exactly as this set did
     * before the chrome axis existed. These are the pre-axis values, read off the baseline.
     *
     * This guard exists because the failure already happened: typography and box metrics were changed
     * in the BASE during the industrial pass, which silently altered `unified` too. Anything a
     * construction decides has to live on the axis or it leaks, and prose does not enforce that.
     */
    it('unified reproduces the pre-axis values exactly', () => {
      const baseline: Record<string, string> = {
        'xeno-style-border': 'var(--xeno-border)',
        'xeno-style-panel-header-pad': '11px 15px',
        'xeno-style-panel-body-pad': '15px',
        'xeno-style-title-size': '14px',
        'xeno-style-title-color': 'var(--xeno-text)',
        'xeno-style-title-transform': 'none',
        'xeno-style-dialog-header-pad': '16px 16px 12px 20px',
        'xeno-style-dialog-title-size': '16px',
        'xeno-style-dialog-body-pad': '4px 20px 20px',
        'xeno-style-dialog-body-size': '14px',
        'xeno-style-dialog-footer-pad': '12px 20px',
        'xeno-style-card-bg': 'var(--xeno-surface)',
        'xeno-style-card-elevated-bg': 'var(--xeno-elevated)',
        'xeno-style-card-radius': 'var(--xeno-radius-card)',
        'xeno-style-card-pad': '13px 15px',
      }
      for (const [k, v] of Object.entries(baseline)) {
        expect(`${k}=${unified.get(k)}`).toBe(`${k}=${v}`)
      }
    })
  })

  it('motion vars equal the motion tokens', () => {
    expect(cssVar('xeno-ease')).toBe(easing.base)
    expect(cssVar('xeno-ease-stagger')).toBe(easing.stagger)
    expect(cssVar('xeno-ease-drawer')).toBe(easing.drawer)
    expect(cssVar('xeno-ease-expo')).toBe(easing.expo)
    expect(cssVar('xeno-ease-overshoot')).toBe(easing.overshoot)
    expect(cssVar('xeno-dur')).toBe(`${duration.base}ms`)
    expect(cssVar('xeno-dur-fast')).toBe(`${duration.fast}ms`)
    expect(cssVar('xeno-dur-entrance')).toBe(`${duration.entrance}ms`)
    expect(cssVar('xeno-dur-modal')).toBe(`${duration.modal}ms`)
    expect(cssVar('xeno-stagger')).toBe(`${stagger}ms`)
  })
})
