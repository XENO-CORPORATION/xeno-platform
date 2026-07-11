import React, { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { useChatStore } from '../store';
import MessageBubble from './MessageBubble';

const SUGGESTIONS = [
  'Explain a concept simply',
  'Write and debug some code',
  'Draft an email or document',
  'Brainstorm ideas with me',
];

const EmptyState: React.FC = () => {
  const sendMessage = useChatStore((s) => s.sendMessage);
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#a760ff]/15">
        <Sparkles size={26} className="text-[#a760ff]" />
      </div>
      <h1 className="text-2xl font-semibold text-white">How can I help?</h1>
      <p className="mt-2 max-w-md text-[15px] text-white/45">
        Ask anything. Pick a model below and start the conversation.
      </p>
      <div className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => void sendMessage(s)}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-[14px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white/90"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
};

const MessageThread: React.FC = () => {
  const activeId = useChatStore((s) => s.activeId);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const loadingMessages = useChatStore((s) => s.loadingMessages);
  const regenerate = useChatStore((s) => s.regenerate);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const editUserMessage = useChatStore((s) => s.editUserMessage);

  const messages = (activeId && messagesByConv[activeId]) || [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Track whether the user is near the bottom; only auto-scroll if so.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming]);

  // Reset stickiness when switching conversations.
  useEffect(() => {
    stickToBottom.current = true;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [activeId]);

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === 'assistant') return i;
    return -1;
  })();

  if (!activeId || (messages.length === 0 && !loadingMessages)) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <EmptyState />
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-6">
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            canRegenerate={i === lastAssistantIndex && !isStreaming}
            onCopy={copy}
            onEdit={editUserMessage}
            onRegenerate={regenerate}
            onStop={stopStreaming}
          />
        ))}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
};

export default MessageThread;
