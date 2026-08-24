import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { useMenu } from './useMenu.js'

/**
 * What these reach, and what they cannot.
 *
 * This package renders to static markup and has no DOM, so what is asserted here is the CONTRACT the
 * hook publishes: the role, the orientation, and the panel being focusable at all. That last one is
 * the half people leave out — a menu whose panel cannot hold focus has nowhere to put it in the
 * instant between opening and the first row taking it.
 *
 * The arrow keys, the wrap, Tab-to-close and choose-to-close need events, and are verified by driving
 * a browser against the product that adopts this. See the commit that does.
 */
function Dropdown({ open }: { readonly open: boolean }) {
  const { menuProps } = useMenu({ open, onClose: () => {} })
  return (
    <div {...menuProps} aria-label="Chat actions">
      <button type="button" role="menuitem">Rename</button>
      <button type="button" role="menuitem" disabled>Archive</button>
      <button type="button" role="menuitemcheckbox" aria-checked="true">Pin</button>
    </div>
  )
}

describe('useMenu', () => {
  it('publishes the menu contract', () => {
    const out = renderToStaticMarkup(<Dropdown open />)
    expect(out).toContain('role="menu"')
    expect(out).toContain('aria-orientation="vertical"')
    expect(out).toContain('aria-label="Chat actions"')
  })

  it('makes the panel focusable without putting it in the tab order', () => {
    expect(renderToStaticMarkup(<Dropdown open />)).toContain('tabindex="-1"')
  })

  it('leaves the caller\'s own rows exactly as written', () => {
    const out = renderToStaticMarkup(<Dropdown open />)
    // the hook owns the panel, never the items
    expect(out).toContain('<button type="button" role="menuitem">Rename</button>')
    expect(out).toContain('role="menuitemcheckbox" aria-checked="true"')
    expect(out).toContain('disabled')
  })

  /**
   * The close decision, without a DOM.
   *
   * `onClick` only ever reads three things off the row it finds, so a stand-in that answers those
   * three is enough to assert WHICH rows dismiss the menu — and that is the part worth pinning,
   * because getting it wrong makes a row look dead rather than look wrong.
   */
  const clickOn = (attrs: Record<string, string>, isDisabled = false) => {
    let closed = false
    let onClick: ((e: never) => void) | undefined
    function Capture() {
      onClick = useMenu<HTMLDivElement>({ open: true, onClose: () => { closed = true } }).menuProps
        .onClick as never
      return <div />
    }
    renderToStaticMarkup(<Capture />)
    const row = {
      hasAttribute: (n: string) => n in attrs || (n === 'disabled' && isDisabled),
      getAttribute: (n: string) => attrs[n] ?? null,
    }
    onClick?.({ target: { closest: () => row } } as never)
    return closed
  }

  it('closes on a plain row and stays open on a disclosure row', () => {
    expect(clickOn({ role: 'menuitem' })).toBe(true)
    expect(clickOn({ role: 'menuitem' }, true)).toBe(false) // disabled
    expect(clickOn({ role: 'menuitem', 'aria-disabled': 'true' })).toBe(false)
    // opens a region inside this menu — closing would destroy the panel it just asked for
    expect(clickOn({ role: 'menuitem', 'aria-expanded': 'false' })).toBe(false)
    expect(clickOn({ role: 'menuitem', 'aria-expanded': 'true' })).toBe(false)
  })

  it('renders the same closed — nothing here is conditional on open', () => {
    const openMarkup = renderToStaticMarkup(<Dropdown open />)
    const shutMarkup = renderToStaticMarkup(<Dropdown open={false} />)
    expect(shutMarkup).toBe(openMarkup)
  })
})
