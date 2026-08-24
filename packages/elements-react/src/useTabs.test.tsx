import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { useTabs } from './useTabs.js'

/**
 * What these can and cannot reach.
 *
 * This package tests by rendering to static markup — there is no DOM and no event dispatch here — so
 * what is checked is the WIRING: the roles, the ids, that `aria-controls` names an element that exists,
 * and that exactly one tab is a Tab stop. That is the half of the bug this hook was written for: four
 * of the five tablists it replaced had every tab as a stop and no reference to any panel.
 *
 * The arrow keys are the other half and cannot be asserted from a string. They are verified by driving
 * a real browser instead — see the commit that adopts this.
 */
const SECTIONS = ['general', 'appearance', 'skills'] as const
type Section = (typeof SECTIONS)[number]

function Tabs({ active }: { readonly active: Section }) {
  const tabs = useTabs<Section>({ ids: SECTIONS, activeId: active, onChange: () => {} })
  return (
    <div>
      <div {...tabs.tablistProps} aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s} type="button" {...tabs.tabProps(s)}>
            {s}
          </button>
        ))}
      </div>
      <div {...tabs.panelProps}>body</div>
    </div>
  )
}

const idOf = (html: string, re: RegExp): string => (html.match(re)?.[1] ?? '')

describe('useTabs', () => {
  it('gives the tablist a role and an explicit orientation', () => {
    const out = renderToStaticMarkup(<Tabs active="general" />)
    expect(out).toContain('role="tablist"')
    expect(out).toContain('aria-orientation="horizontal"')
    expect(out).toContain('aria-label="Settings sections"')
  })

  it('marks exactly one tab selected and exactly one tab a Tab stop', () => {
    const out = renderToStaticMarkup(<Tabs active="appearance" />)
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1)
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(2) // the selected tab + the panel
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(2) // the other two tabs
  })

  it('points every tab at a panel that is actually in the document', () => {
    const out = renderToStaticMarkup(<Tabs active="general" />)
    const controls = [...out.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1])
    expect(controls.length).toBe(3)
    expect(new Set(controls).size).toBe(1) // one panel, so one target
    expect(out).toContain(`role="tabpanel" id="${controls[0]}"`)
  })

  it('has the panel name the tab that labels it, and follows the selection', () => {
    for (const active of SECTIONS) {
      const out = renderToStaticMarkup(<Tabs active={active} />)
      const labelledBy = idOf(out, /aria-labelledby="([^"]+)"/)
      expect(labelledBy).toBeTruthy()
      // the element with that id is the selected tab
      const re = new RegExp(`id="${labelledBy.replace(/[:$]/g, '\\$&')}"[^>]*aria-selected="true"`)
      expect(out).toMatch(re)
    }
  })

  it('scopes its ids per instance, so two tablists on one screen cannot collide', () => {
    const out = renderToStaticMarkup(
      <div>
        <Tabs active="general" />
        <Tabs active="general" />
      </div>,
    )
    const panels = [...out.matchAll(/role="tabpanel" id="([^"]+)"/g)].map((m) => m[1])
    expect(panels.length).toBe(2)
    expect(panels[0]).not.toBe(panels[1])
  })

  it('says vertical when it is vertical', () => {
    function V() {
      const t = useTabs({ ids: ['a', 'b'], activeId: 'a', onChange: () => {}, orientation: 'vertical' })
      return <div {...t.tablistProps} />
    }
    expect(renderToStaticMarkup(<V />)).toContain('aria-orientation="vertical"')
  })
})
