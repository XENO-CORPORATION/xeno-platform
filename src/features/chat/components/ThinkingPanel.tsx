import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Collapsible reasoning / "thinking" stream shown above an assistant message.
 * Auto-expanded while the model is still streaming reasoning; collapsible after.
 */
const ThinkingPanel: React.FC<{ reasoning: string; streaming?: boolean }> = ({ reasoning, streaming }) => {
  const [open, setOpen] = useState(true);
  if (!reasoning?.trim()) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-white/55 transition-colors hover:text-white/80"
      >
        <Brain size={13} className="text-[#ece7df]" />
        <span>{streaming ? 'Thinking…' : 'Reasoning'}</span>
        <span className="ml-auto text-white/30">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="max-h-[320px] overflow-y-auto border-t border-white/8 px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-white/55">
            {reasoning}
            {streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[#ece7df]/70 align-middle" />}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;
