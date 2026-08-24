import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Search from '../../../elements/src/elements/search'
import Plus from '../../../elements/src/elements/plus'
import { Button } from './Button.js'
import { IconButton } from './IconButton.js'
import { ToggleButton } from './ToggleButton.js'
import { Switch } from './Switch.js'
import { TextInput } from './TextInput.js'
import { Textarea } from './Textarea.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Button', () => {
  it('applies variant, size vars, and default availability', () => {
    const out = html(<Button variant="primary">Send</Button>)
    expect(out).toContain('class="xeno-btn"')
    expect(out).toContain('data-variant="primary"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('data-xeno-size="md"') // md
    expect(out).toContain('Send')
  })

  it('maps disabled and busy to the availability axis', () => {
    expect(html(<Button disabled>x</Button>)).toContain('data-availability="disabled"')
    const busy = html(<Button busy>x</Button>)
    expect(busy).toContain('data-availability="busy"')
    expect(busy).toContain('aria-busy="true"')
  })

  it('composes an icon into its slot via the shared renderer', () => {
    const out = html(<Button leadingIcon={Search}>Find</Button>)
    expect(out).toContain('<svg') // the glyph is drawn by <XenoElement>
    expect(out).toContain('aria-label="Search"')
    expect(out).toContain('width="16"') // md icon px
  })

  it('smaller size emits smaller metrics (Send sits below its mic)', () => {
    expect(html(<Button size="sm">x</Button>)).toContain('data-xeno-size="sm"')
  })

  it('carries the quiet variant through to the axis', () => {
    expect(html(<Button variant="quiet">Share</Button>)).toContain('data-variant="quiet"')
  })
})

describe('IconButton', () => {
  it('is square, ghost by default, and labelled', () => {
    const out = html(<IconButton icon={Plus} aria-label="Add" />)
    expect(out).toContain('xeno-icon-btn')
    expect(out).toContain('data-variant="ghost"')
    expect(out).toContain('aria-label="Add"')
    expect(out).toContain('<svg')
  })
})

describe('ref forwarding', () => {
  // A popover positions against the button that opened it. On React 18 a plain function component
  // drops `ref` on the floor and the anchor lands at 0,0 with no error to say why.
  it('reaches the underlying <button> on both controls', () => {
    expect(Object.prototype.hasOwnProperty.call(Button, 'render')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(IconButton, 'render')).toBe(true)
  })
})

describe('ToggleButton', () => {
  it('reflects pressed through the selection axis', () => {
    expect(html(<ToggleButton pressed={false}>On</ToggleButton>)).toContain('data-selection="off"')
    const on = html(<ToggleButton pressed>On</ToggleButton>)
    expect(on).toContain('data-selection="on"')
    expect(on).toContain('aria-pressed="true"')
  })
})

describe('Switch', () => {
  it('is a role=switch square track+knob honouring selection', () => {
    const on = html(<Switch checked aria-label="Memory" />)
    expect(on).toContain('role="switch"')
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('data-selection="on"')
    expect(on).toContain('class="xeno-switch-knob"')
    expect(html(<Switch checked={false} aria-label="Memory" />)).toContain('data-selection="off"')
  })
})

describe('TextInput', () => {
  it('renders a field; a leading icon makes it a search input', () => {
    const out = html(<TextInput leadingIcon={Search} placeholder="Search" />)
    expect(out).toContain('class="xeno-input"')
    expect(out).toContain('class="xeno-input-field"')
    expect(out).toContain('placeholder="Search"')
    expect(out).toContain('<svg')
  })
})

describe('Textarea', () => {
  it('renders a card-radius multiline field with availability', () => {
    const out = html(<Textarea placeholder="Message" />)
    expect(out).toContain('class="xeno-textarea"')
    expect(out).toContain('data-availability="enabled"')
    expect(html(<Textarea disabled />)).toContain('data-availability="disabled"')
  })
})
