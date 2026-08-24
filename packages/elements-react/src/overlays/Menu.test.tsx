import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Copy from '../../../elements/src/elements/copy'
import Trash from '../../../elements/src/elements/trash'
import { Popover } from './Popover.js'
import { Menu } from './Menu.js'
import { MenuItem } from './MenuItem.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => {}

describe('Popover', () => {
  it('renders the trigger but no panel when closed', () => {
    const out = html(
      <Popover open={false} onOpenChange={noop} trigger={<button>Open</button>}>
        <p>Panel body</p>
      </Popover>,
    )
    expect(out).toContain('class="xeno-popover"')
    expect(out).toContain('Open')
    expect(out).not.toContain('xeno-popover-panel')
    expect(out).not.toContain('Panel body')
  })

  it('renders an anchored panel with its content when open (default align start)', () => {
    const out = html(
      <Popover open onOpenChange={noop} trigger={<button>Open</button>}>
        <p>Panel body</p>
      </Popover>,
    )
    expect(out).toContain('class="xeno-popover-panel"')
    expect(out).toContain('data-align="start"')
    expect(out).toContain('Panel body')
  })

  it('honours the end alignment', () => {
    const out = html(
      <Popover open align="end" onOpenChange={noop} trigger={<button>Open</button>}>
        x
      </Popover>,
    )
    expect(out).toContain('data-align="end"')
  })

  it('spreads panelProps onto the panel (composition seam)', () => {
    const out = html(
      <Popover
        open
        onOpenChange={noop}
        trigger={<button>Open</button>}
        panelProps={{ role: 'menu', 'aria-label': 'Actions' }}
      >
        x
      </Popover>,
    )
    expect(out).toContain('role="menu"')
    expect(out).toContain('aria-label="Actions"')
  })
})

describe('Menu', () => {
  it('renders nothing in the panel when closed', () => {
    const out = html(
      <Menu open={false} onOpenChange={noop} trigger={<button>Actions</button>}>
        <MenuItem onSelect={noop}>Copy</MenuItem>
      </Menu>,
    )
    expect(out).toContain('class="xeno-popover"')
    expect(out).not.toContain('role="menu"')
    expect(out).not.toContain('xeno-menu-item')
  })

  it('is a role=menu list with a label and its items when open', () => {
    const out = html(
      <Menu open onOpenChange={noop} aria-label="Row actions" trigger={<button>Actions</button>}>
        <MenuItem onSelect={noop}>Copy</MenuItem>
        <MenuItem onSelect={noop} variant="danger">
          Delete
        </MenuItem>
      </Menu>,
    )
    expect(out).toContain('role="menu"')
    expect(out).toContain('xeno-popover-panel xeno-menu')
    expect(out).toContain('aria-orientation="vertical"')
    expect(out).toContain('aria-label="Row actions"')
    expect(out).toContain('tabindex="-1"')
    expect(out).toContain('Copy')
    expect(out).toContain('Delete')
  })
})

describe('MenuItem', () => {
  it('is a role=menuitem row with the default variant + enabled availability', () => {
    const out = html(<MenuItem onSelect={noop}>Rename</MenuItem>)
    expect(out).toContain('class="xeno-menu-item"')
    expect(out).toContain('role="menuitem"')
    expect(out).toContain('data-variant="default"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('class="xeno-menu-item-label"')
    expect(out).toContain('Rename')
  })

  it('maps disabled to the availability axis', () => {
    const out = html(
      <MenuItem onSelect={noop} disabled>
        Rename
      </MenuItem>,
    )
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('disabled')
  })

  it('recolours the danger variant', () => {
    expect(html(<MenuItem onSelect={noop} variant="danger">Delete</MenuItem>)).toContain(
      'data-variant="danger"',
    )
  })

  it('becomes a checkbox item carrying the selection axis when selected is set', () => {
    const on = html(
      <MenuItem onSelect={noop} selected>
        Show grid
      </MenuItem>,
    )
    expect(on).toContain('role="menuitemcheckbox"')
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('data-selection="on"')
    expect(on).toContain('<svg') // the check glyph
    expect(on).toContain('aria-label="Check"')

    const off = html(
      <MenuItem onSelect={noop} selected={false}>
        Show grid
      </MenuItem>,
    )
    expect(off).toContain('role="menuitemcheckbox"')
    expect(off).toContain('aria-checked="false"')
    expect(off).toContain('data-selection="off"')
  })

  it('renders a leading glyph via the shared renderer', () => {
    const out = html(
      <MenuItem onSelect={noop} leadingIcon={Copy}>
        Copy
      </MenuItem>,
    )
    expect(out).toContain('class="xeno-menu-item-lead"')
    expect(out).toContain('<svg')
    expect(out).toContain('aria-label="Copy"')
  })

  it('renders a trailing mono shortcut', () => {
    const out = html(
      <MenuItem onSelect={noop} leadingIcon={Trash} variant="danger" shortcut="Ctrl+Del">
        Delete
      </MenuItem>,
    )
    expect(out).toContain('class="xeno-menu-item-shortcut"')
    expect(out).toContain('Ctrl+Del')
  })

  it('renders a current value in its own slot, before the chevron', () => {
    const out = html(
      <MenuItem onSelect={noop} submenu value="Last activity">
        Sort by
      </MenuItem>,
    )
    expect(out).toContain('class="xeno-menu-item-value"')
    // Its own slot, not the shortcut's: a value is a word the reader chose, and the shortcut slot
    // sets its contents in mono, which would make that word read as a key to press.
    expect(out).not.toContain('xeno-menu-item-shortcut')
    expect(out.indexOf('xeno-menu-item-value')).toBeLessThan(out.indexOf('xeno-menu-item-chevron'))
  })

  it('turns the chevron on a disclosure row, and does not promise a popup', () => {
    const open = html(
      <MenuItem onSelect={noop} expanded aria-controls="theme-region">
        Theme
      </MenuItem>,
    )
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('data-state="open"')
    // a disclosure grows the menu it is in; there is no second menu to point a reader at
    expect(open).not.toContain('aria-haspopup')

    const shut = html(
      <MenuItem onSelect={noop} expanded={false}>
        Theme
      </MenuItem>,
    )
    expect(shut).toContain('aria-expanded="false"')
    expect(shut).toContain('data-state="closed"')
  })

  it('marks a submenu row with a chevron and aria-haspopup', () => {
    const out = html(
      <MenuItem onSelect={noop} submenu>
        Share
      </MenuItem>,
    )
    expect(out).toContain('class="xeno-menu-item-chevron"')
    expect(out).toContain('aria-haspopup="menu"')
    expect(out).toContain('aria-label="Chevron right"')
  })
})
