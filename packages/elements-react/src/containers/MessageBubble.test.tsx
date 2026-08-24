import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { MessageBubble } from './MessageBubble.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('MessageBubble', () => {
  it('renders a user turn: the container class, the role axis, and its body content', () => {
    const out = html(<MessageBubble role="user">Hello there</MessageBubble>)
    expect(out).toContain('class="xeno-message"')
    expect(out).toContain('data-role="user"')
    expect(out).toContain('class="xeno-message-body"')
    expect(out).toContain('Hello there')
  })

  it('renders an assistant turn on the same container with the other role', () => {
    const out = html(<MessageBubble role="assistant">An answer</MessageBubble>)
    expect(out).toContain('data-role="assistant"')
    expect(out).toContain('An answer')
  })

  it('shows a timestamp in a <time> and a labelled action group when both are given', () => {
    const out = html(
      <MessageBubble
        role="assistant"
        timestamp="2:14 PM"
        actions={<button type="button">Copy</button>}
      >
        Answer
      </MessageBubble>,
    )
    expect(out).toContain('class="xeno-message-meta"')
    expect(out).toContain('<time class="xeno-message-time">2:14 PM</time>')
    expect(out).toContain('class="xeno-message-actions"')
    expect(out).toContain('role="group"')
    expect(out).toContain('aria-label="Message actions"')
    expect(out).toContain('Copy')
  })

  it('omits the meta row entirely when there is no timestamp and no actions', () => {
    const out = html(<MessageBubble role="assistant">Bare</MessageBubble>)
    expect(out).not.toContain('xeno-message-meta')
  })

  it('flags the streaming state on the root so the action bar can stay hidden', () => {
    const out = html(
      <MessageBubble role="assistant" streaming actions={<button type="button">Copy</button>}>
        Streaming…
      </MessageBubble>,
    )
    expect(out).toContain('data-streaming=""')
    expect(out).toContain('data-role="assistant"')
  })

  it('puts attachments above the body and outside the bubble', () => {
    const out = html(
      <MessageBubble role="user" attachments={<img src="a.png" alt="A chart" />}>
        Look at this
      </MessageBubble>,
    )
    expect(out).toContain('class="xeno-message-attachments"')
    // above: the attachment row opens before the body does
    expect(out.indexOf('xeno-message-attachments')).toBeLessThan(out.indexOf('xeno-message-body'))
    // outside: the image is not inside the element that carries the fill and the border
    const body = out.slice(out.indexOf('xeno-message-body'))
    expect(body).not.toContain('a.png')
  })

  it('draws no body at all for a turn that is only an attachment', () => {
    // an empty bubble is a border and a fill around nothing
    const out = html(<MessageBubble role="user" attachments={<img src="a.png" alt="A chart" />} />)
    expect(out).toContain('xeno-message-attachments')
    expect(out).not.toContain('xeno-message-body')
    expect(html(<MessageBubble role="user">{''}</MessageBubble>)).not.toContain('xeno-message-body')
  })

  it('merges a caller className onto the root', () => {
    const out = html(
      <MessageBubble role="user" className="mine">
        Hi
      </MessageBubble>,
    )
    expect(out).toContain('class="xeno-message mine"')
  })
})
