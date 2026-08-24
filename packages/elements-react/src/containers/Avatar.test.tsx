import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import User from '../../../elements/src/elements/user'
import { Avatar, AvatarStack } from './Avatar.js'

describe('Avatar', () => {
  it('renders the base square class and a scaled size var', () => {
    const html = renderToStaticMarkup(<Avatar name="Ada Lovelace" size={32} />)
    expect(html).toContain('xeno-avatar')
    expect(html).toContain('--xeno-avatar-size:32px')
    expect(html).toContain('role="img"')
  })

  it('resolves an image first: <img> with cover class + decorative alt, data-variant="image"', () => {
    const html = renderToStaticMarkup(<Avatar src="/a.png" name="Ada Lovelace" alt="Ada" />)
    expect(html).toContain('data-variant="image"')
    expect(html).toContain('class="xeno-avatar-img"')
    expect(html).toContain('src="/a.png"')
    expect(html).toContain('alt=""') // wrapper carries the label; the img is decorative
    expect(html).toContain('aria-label="Ada"') // alt wins for the accessible name
  })

  it('falls back to a glyph when no src: draws xeno-element, data-variant="icon"', () => {
    const html = renderToStaticMarkup(<Avatar icon={User} name="Team" />)
    expect(html).toContain('data-variant="icon"')
    expect(html).toContain('xeno-element')
    expect(html).toContain('aria-label="Team"') // name is the accessible name
  })

  it('falls back to uppercase initials from a full name', () => {
    const html = renderToStaticMarkup(<Avatar name="ada lovelace" />)
    expect(html).toContain('data-variant="initials"')
    expect(html).toContain('class="xeno-avatar-initials"')
    expect(html).toContain('AL')
    expect(html).toContain('aria-hidden="true"') // initials are decorative text
  })

  it('derives two letters from a single-word name', () => {
    const html = renderToStaticMarkup(<Avatar name="Xeno" />)
    expect(html).toContain('XE')
  })

  it('is an empty square when nothing is provided', () => {
    const html = renderToStaticMarkup(<Avatar />)
    expect(html).toContain('data-variant="empty"')
    expect(html).toContain('aria-label="Avatar"')
  })
})

describe('AvatarStack', () => {
  const people = [
    { name: 'Ada Lovelace' },
    { name: 'Grace Hopper' },
    { src: '/k.png', name: 'Katherine Johnson' },
    { icon: User, name: 'Agent' },
    { name: 'Edith Clarke' },
    { name: 'Hedy Lamarr' },
  ]

  it('renders the stack wrapper and a size var', () => {
    const html = renderToStaticMarkup(<AvatarStack items={people} size={28} />)
    expect(html).toContain('xeno-avatar-stack')
    expect(html).toContain('role="group"')
    expect(html).toContain('--xeno-avatar-size:28px')
  })

  it('caps at max and adds a +N overflow tile with an accessible label', () => {
    const html = renderToStaticMarkup(<AvatarStack items={people} max={4} />)
    expect(html).toContain('xeno-avatar-more')
    expect(html).toContain('+2') // 6 items, 4 shown → +2
    expect(html).toContain('aria-label="2 more"')
    // exactly 4 people tiles are rendered (initials/img/icon) plus the +N tile
    expect(html.match(/data-variant="(image|icon|initials)"/g)).toHaveLength(4)
  })

  it('omits the overflow tile when items fit within max', () => {
    const html = renderToStaticMarkup(<AvatarStack items={people.slice(0, 3)} max={4} />)
    expect(html).not.toContain('xeno-avatar-more')
    expect(html).not.toContain('data-variant="more"')
  })
})
