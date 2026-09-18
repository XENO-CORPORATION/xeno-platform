/**
 * The head of an assistant turn in this chat: the clock line, the thought, the rail of steps —
 * rendered by the CANONICAL transcript (`TranscriptTurn`, `@xenosystem/agent-conversation`,
 * D10 of `XENO AGENT PANEL - SPEC.md`), not by a copy of it (D7d).
 *
 * The chat hands the transcript an EMPTY reply (see `chatTurnTranscript.ts`), so this component
 * renders exactly the part the chat did not have — "Working for 4s" while the turn runs, each
 * search as it lands, the fold to "Worked for 17s ›" — and the chat keeps rendering the reply,
 * the images and its own action row beneath it. Two step modes, from the user's preference:
 * `expanded` draws the rail as the turn works; `collapsed` keeps it folded and carries the
 * current step on the clock line.
 */
import React, { useMemo } from 'react';
import { TranscriptTurn, type TranscriptActions } from '@xenosystem/agent-conversation/components/agent/transcript/Transcript';
import { toTranscriptMessage, type ChatTurnRecord, type StepsMode, chatFaviconUrl } from './chatTurnTranscript';

/** This surface has no asks (no tool needs a grant in Chat), so every ask action is a refusal. */
const NO_ASKS: TranscriptActions['ask'] = {
  grant: () => {},
  grantAlways: () => {},
  deny: () => {},
  denyAlways: () => {},
  answer: async () => 'This surface cannot answer an agent question.',
  cancelQuestion: () => {},
  canAnswer: false,
};

const copyText = async (text: string): Promise<void> => {
  try { await navigator.clipboard.writeText(text); } catch { /* the transcript reports the failure */ }
};

const openExternal = (url: string): void => {
  if (!/^https?:\/\//.test(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
};

export interface ChatTurnHeadProps {
  messageId: string;
  thinking?: string;
  streaming?: boolean;
  replyStarted?: boolean;
  timestamp?: number;
  model?: string;
  turn?: ChatTurnRecord;
  stepsMode: StepsMode;
  /** The transcript measured how long the thought took; keep it on the record. */
  onThinkingTime?: (messageId: string, ms: number) => void;
}

export const ChatTurnHead: React.FC<ChatTurnHeadProps> = ({
  messageId, thinking, streaming, replyStarted, timestamp, model, turn, stepsMode, onThinkingTime,
}) => {
  const msg = useMemo(
    () => toTranscriptMessage({ id: messageId, thinking, streaming, replyStarted, timestamp, model, turn }),
    [messageId, thinking, streaming, replyStarted, timestamp, model, turn],
  );
  const actions = useMemo<TranscriptActions>(() => ({
    ask: NO_ASKS,
    copy: copyText,
    openExternal,
    ...(onThinkingTime ? { rememberThinkingTime: (ms: number) => onThinkingTime(messageId, ms) } : {}),
  }), [messageId, onThinkingTime]);

  return (
    <div className="xa-transcript chat-turn-head" data-chat-turn-head={messageId} data-steps-mode={stepsMode}>
      {/* `clock="always"`: every turn is working from the moment the request goes out, so the
          chat shows the clock on every turn — "Working for 4s" over the streaming reply, then a
          bare "Worked for 4s" resting above it — with the rail underneath only when there are
          steps. D10's `auto` (no steps → no clock line) stays the agent panel's default; on a chat
          where most turns have no steps it read as the clock being lost (2026-09-18). */}
      <TranscriptTurn
        msg={msg}
        stepsMode={stepsMode}
        actions={actions}
        renderMarkdown={() => null}
        model={model}
        clock="always"
        faviconUrl={chatFaviconUrl}
      />
    </div>
  );
};

export default ChatTurnHead;
