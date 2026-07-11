import React, { useState } from 'react';
import { Copy, Check, Pencil, RefreshCw, Square, X } from 'lucide-react';
import type { UIMessage } from '../types';
import Markdown from './Markdown';
import ThinkingPanel from './ThinkingPanel';

interface MessageBubbleProps {
  message: UIMessage;
  canRegenerate: boolean;
  onCopy: (text: string) => void;
  onEdit: (id: string, newText: string) => void;
  onRegenerate: () => void;
  onStop: () => void;
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/85"
    >
      {children}
    </button>
  );
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  canRegenerate,
  onCopy,
  onEdit,
  onRegenerate,
  onStop,
}) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const copy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const saveEdit = () => {
    if (draft.trim() && draft.trim() !== message.content) onEdit(message.id, draft);
    setEditing(false);
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1 py-3">
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-[#a760ff]/40 bg-[#151515] p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[70px] w-full resize-y bg-transparent px-2 py-1 text-[15px] text-[#e7e2da] outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 px-1 pt-1">
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(message.content);
                }}
                className="rounded-md px-2.5 py-1 text-xs text-white/50 hover:text-white/80"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="rounded-md bg-[#a760ff] px-3 py-1 text-xs font-semibold text-white hover:bg-[#bf85ff]"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#1e1a24] px-4 py-2.5 text-[15px] leading-relaxed text-[#efeae2]">
              {message.content}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </ActionButton>
              <ActionButton label="Edit" onClick={() => { setDraft(message.content); setEditing(true); }}>
                <Pencil size={14} />
              </ActionButton>
            </div>
          </>
        )}
      </div>
    );
  }

  // Assistant
  return (
    <div className="group flex flex-col gap-1 py-3">
      {message.reasoning ? (
        <ThinkingPanel reasoning={message.reasoning} streaming={message.streaming} />
      ) : null}

      {message.error && !message.content ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          <X size={16} />
          <span>Generation failed. Try again or pick another model.</span>
        </div>
      ) : (
        <div className="min-w-0">
          <Markdown>{message.content}</Markdown>
          {message.streaming && (
            <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse rounded-sm bg-[#a760ff]" />
          )}
        </div>
      )}

      <div className="flex items-center gap-0.5 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {message.streaming ? (
          <ActionButton label="Stop" onClick={onStop}>
            <Square size={13} className="fill-current" />
          </ActionButton>
        ) : (
          <>
            <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </ActionButton>
            {canRegenerate && (
              <ActionButton label="Regenerate" onClick={onRegenerate}>
                <RefreshCw size={14} />
              </ActionButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
