import React, { useMemo, useState } from 'react';
import { Copy, Check, Pencil, RefreshCw, Square, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { UIMessage } from '../types';
import Markdown from './Markdown';
import ThinkingPanel from './ThinkingPanel';
import ArtifactCard from './ArtifactCard';
import { splitSegments } from '../artifacts/parse';

interface MessageBubbleProps {
  message: UIMessage;
  canRegenerate: boolean;
  onCopy: (text: string) => void;
  onEdit: (id: string, newText: string) => void;
  onRegenerate: () => void;
  onSetVariant: (id: string, index: number) => void;
  onStop: () => void;
}

/** ChatGPT-style "‹ n/m ›" branch switcher, shown when a turn has sibling variants. */
function VariantSwitcher({
  message,
  onSetVariant,
  disabled,
}: {
  message: UIMessage;
  onSetVariant: (id: string, index: number) => void;
  disabled?: boolean;
}) {
  const total = message.variants?.length ?? 0;
  if (total < 2) return null;
  const active = message.activeVariant ?? 0;
  return (
    <div className="flex items-center gap-0.5 text-white/45" aria-label="Message versions">
      <button
        onClick={() => onSetVariant(message.id, active - 1)}
        disabled={disabled || active <= 0}
        title="Previous version"
        aria-label="Previous version"
        className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white/85 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="select-none text-[11px] font-medium tabular-nums">
        {active + 1}/{total}
      </span>
      <button
        onClick={() => onSetVariant(message.id, active + 1)}
        disabled={disabled || active >= total - 1}
        title="Next version"
        aria-label="Next version"
        className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white/85 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
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
  onSetVariant,
  onStop,
}) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  // Split the assistant reply into ordered prose + artifact-card segments, so a
  // substantial fenced artifact renders as a compact card (opening the side panel)
  // instead of being dumped inline. Cheap + memoized on the live content.
  const segments = useMemo(
    () => (message.role === 'assistant' ? splitSegments(message.content, message.id) : null),
    [message.role, message.content, message.id],
  );

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
            <div className="flex items-center gap-0.5">
              <VariantSwitcher message={message} onSetVariant={onSetVariant} />
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </ActionButton>
                <ActionButton label="Edit" onClick={() => { setDraft(message.content); setEditing(true); }}>
                  <Pencil size={14} />
                </ActionButton>
              </div>
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
          {(segments ?? [{ kind: 'markdown', text: message.content } as const]).map((seg, i) =>
            seg.kind === 'artifact' ? (
              <ArtifactCard
                key={`art-${i}-${seg.artifactId}`}
                artifactId={seg.artifactId}
                title={seg.title}
                artifactKind={seg.artifactKind}
                complete={seg.complete}
              />
            ) : (
              <Markdown key={`md-${i}`}>{seg.text}</Markdown>
            ),
          )}
          {message.streaming && (
            <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse rounded-sm bg-[#a760ff]" />
          )}
        </div>
      )}

      <div className="flex items-center gap-0.5 pt-0.5">
        {/* The version switcher stays visible (not hover-gated) so branches are discoverable. */}
        <VariantSwitcher message={message} onSetVariant={onSetVariant} disabled={message.streaming} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
    </div>
  );
};

export default MessageBubble;
