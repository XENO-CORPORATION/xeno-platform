/**
 * A streamed reply drawn whole words at a time, the newest words fading in (owner, 2026-11-14: "if the full word
 * is done it should appear the full word in its place, not letter by letter").
 *
 * The pacing and the fade are XENO Agent's own (`@xenosystem/agent-conversation`: `useSmoothedReply` and
 * `rehypeRevealTail`), so the chat and the Agent interface reveal a reply the same way from one implementation.
 * This component only holds the hook, so a frame redraws this one reply and not the whole chat.
 *
 * A reply that is not streaming when first drawn (history, a reload) is shown whole at once.
 */
import type { ReactNode } from 'react';
import { useSmoothedReply, type SmoothedReply as Smoothed } from '@xenosystem/agent-conversation/components/agent/transcript/smoothStream';
import { rehypeRevealTail } from '@xenosystem/agent-conversation/components/agent/transcript/revealTail';

export type { Smoothed };

/** The rehype step that fades the newest words in, or nothing when there are none. Put it after every other step. */
export function revealTailPlugins(smoothed: Smoothed): Array<[typeof rehypeRevealTail, { fresh: number }]> {
  return smoothed.fresh > 0 ? [[rehypeRevealTail, { fresh: smoothed.fresh }]] : [];
}

export function SmoothedReply({ text, streaming, children }: {
  text: string;
  streaming: boolean;
  children: (smoothed: Smoothed) => ReactNode;
}) {
  const smoothed = useSmoothedReply(text, streaming);
  return <>{children(smoothed)}</>;
}
