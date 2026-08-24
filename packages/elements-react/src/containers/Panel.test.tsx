import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Panel } from './Panel.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Panel', () => {
  it('renders a bare scrollable body when no header is given', () => {
    const out = html(<Panel>Content</Panel>)
    expect(out).toContain('class="xeno-panel"')
    expect(out).toContain('class="xeno-panel-body"')
    expect(out).not.toContain('xeno-panel-header')
    expect(out).toContain('Content')
  })

  it('renders a header with the title text', () => {
    const out = html(<Panel title="Research">body</Panel>)
    expect(out).toContain('class="xeno-panel-header"')
    expect(out).toContain('class="xeno-panel-title"')
    expect(out).toContain('Research')
  })

  it('renders an actions slot alongside the title', () => {
    const out = html(
      <Panel title="Files" actions={<button type="button">Add</button>}>
        body
      </Panel>,
    )
    expect(out).toContain('class="xeno-panel-actions"')
    expect(out).toContain('Add')
  })

  it('shows the header when only actions are provided (no title node)', () => {
    const out = html(<Panel actions={<button type="button">Add</button>}>body</Panel>)
    expect(out).toContain('class="xeno-panel-header"')
    expect(out).not.toContain('xeno-panel-title')
  })

  it('merges a custom className and forwards rest attributes', () => {
    const out = html(
      <Panel className="mine" aria-label="Trace">
        x
      </Panel>,
    )
    expect(out).toContain('xeno-panel mine')
    expect(out).toContain('aria-label="Trace"')
  })

  it('renders a footer slab only when one is given', () => {
    expect(html(<Panel>body</Panel>)).not.toContain('xeno-panel-footer')
    const out = html(<Panel footer={<button type="button">Discard</button>}>body</Panel>)
    expect(out).toContain('class="xeno-panel-footer"')
    expect(out).toContain('Discard')
  })

  it('orders the slabs heading → body → footer', () => {
    const out = html(
      <Panel title="Recover" footer={<button type="button">Discard</button>}>
        body
      </Panel>,
    )
    expect(out.indexOf('xeno-panel-header')).toBeLessThan(out.indexOf('xeno-panel-body'))
    expect(out.indexOf('xeno-panel-body')).toBeLessThan(out.indexOf('xeno-panel-footer'))
  })
})

/**
 * The separated architecture is a CSS fact, so markup assertions cannot see it — the class names are
 * identical either way. These read the stylesheet, and every one of them FAILS against the merged
 * implementation this replaced (wrapper painted at the card radius, header divided off by a hairline).
 * That is the point: the rule this encodes is a design-system rule, and it should have to be broken
 * deliberately.
 */
describe('panel.css is driven by the chrome axis, not by one look', () => {
  /**
   * Comments are stripped FIRST, and that is not tidiness. On its first run this suite failed because
   * the wrapper's own comment says "No background, no border" — the guard was reading prose as if it
   * were a declaration. `size.test.ts` was caught by the identical mistake. A guard that can be
   * satisfied or broken by a comment is not measuring the stylesheet.
   */
  const css = readFileSync(fileURLToPath(new URL('./panel.css', import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )

  /** Fails closed: a missing rule throws rather than yielding an empty string that passes `not.toMatch`. */
  const rule = (selector: string): string => {
    const m = css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))
    const body = m?.[1]
    if (body === undefined) throw new Error(`panel.css has no rule for ${selector}`)
    return body
  }

  /*
   * These assert the SEAM, not a look. Pinning `gap: 4px` or a literal surface would freeze one
   * construction and make the other impossible — the earlier version of this suite did exactly that
   * and had to be rewritten the moment a second chrome existed. What must stay true is that every
   * construction value is READ FROM A TOKEN, because that is what lets one DOM render both.
   */
  it('the wrapper takes its construction from the chrome axis', () => {
    const wrapper = rule('.xeno-panel')
    expect(wrapper).toMatch(/gap:\s*var\(--xeno-style-gap\)/)
    expect(wrapper).toMatch(/padding:\s*var\(--xeno-style-inset\)/)
    expect(wrapper).toMatch(/background:\s*var\(--xeno-style-shell\)/)
    expect(wrapper).toMatch(/border-radius:\s*var\(--xeno-style-radius\)/)
  })

  it('hardcodes no construction value the chrome axis owns', () => {
    const wrapper = rule('.xeno-panel')
    // A literal gap/padding here is the regression: it pins one chrome and silently breaks the other.
    expect(wrapper).not.toMatch(/gap:\s*\d/)
    expect(wrapper).not.toMatch(/padding:\s*\d/)
    /* `overflow` is deliberately NOT on the axis: the reference `Plate` clips in both constructions,
       and a token whose two values are identical is not an axis. */
  })

  it.each(['.xeno-panel-header', '.xeno-panel-body', '.xeno-panel-footer'])(
    '%s paints from a chrome plate token',
    (selector) => {
      expect(rule(selector)).toMatch(/background:\s*var\(--xeno-style-(plate|body)\)/)
    },
  )

  /*
   * §4: "a corner is rounded only where the surface meets nothing." A plate faces its neighbour
   * across the gap, so the facing corners are square — only the ends of the stack round off.
   *
   * The earlier version of this suite asserted a UNIFORM radius on every plate, which is the exact
   * thing §4 calls "the tell that an agent skipped this section". The guard was enforcing the bug.
   * Pinning the per-corner form is what stops that returning.
   */
  it('rounds only the ends of the stack — facing corners are square (§4)', () => {
    expect(rule('.xeno-panel > \\*')).toMatch(/border-radius:\s*0/)
    const first = rule('.xeno-panel > :first-child')
    expect(first).toMatch(/border-top-left-radius:\s*var\(--xeno-style-radius-plate\)/)
    expect(first).toMatch(/border-top-right-radius:\s*var\(--xeno-style-radius-plate\)/)
    const last = rule('.xeno-panel > :last-child')
    expect(last).toMatch(/border-bottom-left-radius:\s*var\(--xeno-style-radius-plate\)/)
    expect(last).toMatch(/border-bottom-right-radius:\s*var\(--xeno-style-radius-plate\)/)
  })

  it('no plate carries a uniform radius', () => {
    for (const s of ['.xeno-panel-header', '.xeno-panel-body', '.xeno-panel-footer']) {
      expect(rule(s)).not.toMatch(/border-radius:/)
    }
  })

  it('the divider is a token, so unified can draw one and separated cannot', () => {
    expect(rule('.xeno-panel-header')).toMatch(/border-bottom:\s*var\(--xeno-style-divider\)/)
    expect(rule('.xeno-panel-footer')).toMatch(/border-top:\s*var\(--xeno-style-divider\)/)
  })

  it('never reaches past the chrome axis to a raw radius role', () => {
    // The radius is the chrome's to choose — `separated` picks md/sm, `unified` picks card. A direct
    // `--xeno-radius-*` here would take that choice away from the axis.
    expect(css).not.toMatch(/border-radius:\s*var\(--xeno-radius-/)
  })

  it('the heading and footer are visually symmetric (§4)', () => {
    const padding = (selector: string): string | undefined =>
      rule(selector).match(/padding:\s*([^;]+);/)?.[1]?.trim()
    const header = padding('.xeno-panel-header')
    expect(header).toBeDefined()
    expect(padding('.xeno-panel-footer')).toBe(header)

    const minHeight = (selector: string): string | undefined =>
      rule(selector).match(/min-height:\s*([^;]+);/)?.[1]?.trim()
    expect(minHeight('.xeno-panel-footer')).toBe(minHeight('.xeno-panel-header'))
  })
})
