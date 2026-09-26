import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './chatUserMessage.css';

/**
 * A user turn's body, collapsed when it is tall.
 *
 * A pasted transcript or a long console dump is a real user message — it must be KEPT in full and
 * re-sendable on edit — but shown whole it pushes the reply, and every message before it, off the
 * screen. ChatGPT and Claude both clamp a long user message to a few lines with a "Show more".
 *
 * This is chat policy, not a container primitive: the shared `<MessageBubble>` is a dumb body, and
 * "how much of a person's own words to show first" is a decision that belongs to the chat. So the
 * full text is always in the DOM (collapse is CSS `max-height`, never truncation — the bytes are
 * never cut, which matters because Copy and Edit read the message, not this view), and the toggle
 * appears ONLY when the text actually overflows the clamp at the current width.
 *
 * The overflow test is remeasured on width changes: rewrapping changes height, so a message that
 * fit on a wide window can overflow on a narrow one and vice-versa. Fail-open — if measurement is
 * unavailable the text renders expanded and uncollapsed, never hidden behind a control that cannot
 * appear.
 */
export function ChatUserMessage({ text }: { text: string }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Compare the full content height to the clamped box. While expanded the element is not
    // clamped, so scrollHeight === clientHeight and this reads false — guard with the flag so an
    // expanded message keeps its toggle instead of losing it the moment it opens.
    if (expanded) return;
    setOverflowing(el.scrollHeight - el.clientHeight > 2);
  }, [expanded]);

  // Before paint, so a long message never flashes fully open then snaps closed.
  useLayoutEffect(() => { measure(); }, [measure, text]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="chat-usermsg" data-expanded={expanded ? '' : undefined}>
      <div
        ref={bodyRef}
        className="chat-usermsg-text"
        data-clamped={!expanded && overflowing ? '' : undefined}
      >
        {text}
      </div>
      {overflowing && (
        <button
          type="button"
          className="chat-usermsg-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default ChatUserMessage;
