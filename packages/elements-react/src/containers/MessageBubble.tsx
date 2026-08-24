import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<MessageBubble>` — the chat message container. One element renders both sides of a conversation and
 * the difference is the locked design, not a variant: a `user` turn is a right-aligned bubble (surface
 * fill, hairline border, card radius with the bottom-right corner squared back to `radius-xs`), while an
 * `assistant` turn is a bare left-aligned prose block — no bubble, monochrome shell, coloured content
 * lives inside `children`. The `actions` slot is a hover action bar that fades in on `:hover`/`:focus`
 * and stays hidden while the turn is `streaming`. The role rides the root as `data-role`.
 */
export type MessageRole = 'user' | 'assistant'

export interface MessageBubbleProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> {
  /** Which side of the conversation this turn is — drives `data-role` and the whole visual treatment. */
  readonly role: MessageRole
  /** The message body: plain text for a user turn, rendered prose for an assistant turn. */
  readonly children?: ReactNode
  /**
   * What was sent WITH the message — images, files — shown above the body and OUTSIDE the bubble.
   *
   * Not `children`. The body is the fill: a bubble with a photo inside it puts a hairline border and
   * 12px of surface around a picture that already has its own edges, and a turn that is only an image
   * renders as an empty bubble wearing one. Attachments are their own row, sharing the turn's
   * alignment and nothing else — which is also why a turn with attachments and no text draws no
   * bubble at all.
   */
  readonly attachments?: ReactNode
  /** A hover action bar (copy / regenerate / …) revealed on hover or focus; hidden while streaming. */
  readonly actions?: ReactNode
  /** A display timestamp shown in the meta row (e.g. `"2:14 PM"`). */
  readonly timestamp?: string
  /** While true the turn is still being written — the action bar is suppressed via `data-streaming`. */
  readonly streaming?: boolean
}

export function MessageBubble({
  role,
  children,
  attachments,
  actions,
  timestamp,
  streaming = false,
  className,
  ...rest
}: MessageBubbleProps): ReactElement {
  const hasMeta = actions !== undefined || timestamp !== undefined
  // An empty bubble is a border and a fill around nothing. A turn that is only an attachment has no
  // body, and should draw none — so the element itself is conditional, not just its contents.
  const hasBody =
    children !== undefined && children !== null && children !== false && children !== ''
  return (
    <div
      className={cx('xeno-message', className)}
      data-role={role}
      {...(streaming ? { 'data-streaming': '' } : {})}
      {...rest}
    >
      {attachments !== undefined && (
        <div className="xeno-message-attachments">{attachments}</div>
      )}
      {hasBody && <div className="xeno-message-body">{children}</div>}
      {hasMeta && (
        <div className="xeno-message-meta">
          {timestamp !== undefined && <time className="xeno-message-time">{timestamp}</time>}
          {actions !== undefined && (
            <div className="xeno-message-actions" role="group" aria-label="Message actions">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
