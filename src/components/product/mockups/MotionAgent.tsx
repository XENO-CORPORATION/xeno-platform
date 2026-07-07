import React from 'react';
import { Sparkles, ArrowUp, Check, Cloud, ChevronDown } from 'lucide-react';

/* Gallery mockup — XENO Motion's Agent Sidebar (xeno-motion AgentSidebar).
 * The agent edits the timeline: transcribe → select → arrange → subtitle →
 * export, with tool rows and a permission-gated model picker. Accent (agent
 * mark, tool checks, send) via rgb(var(--acc)) / .acc-*. */

const V = 'rgb(var(--acc))';

function ToolRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[6px] border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <Check className="h-3 w-3 shrink-0" style={{ color: V }} />
      <span className="text-[10px] font-medium text-[#cdc7be]">{label}</span>
      <span className="ml-auto truncate text-[9px] text-[#69635b]">{detail}</span>
    </div>
  );
}

const MotionAgent: React.FC = () => (
  <div className="flex h-[clamp(300px,40vh,380px)] w-full flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0d0d0f]">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3 py-2">
      <span className="grid h-5 w-5 place-items-center rounded-[6px] border acc-bd40 acc-b12 acc-fg-hi"><Sparkles className="h-3 w-3" /></span>
      <span className="text-[10.5px] font-semibold text-[#e7e2d9]">Motion Agent</span>
      <span className="ml-auto flex items-center gap-1 rounded-[5px] border border-white/[0.08] px-1.5 py-[3px] text-[9px] text-[#aaa39a]"><Cloud className="h-2.5 w-2.5" /> claude-sonnet <ChevronDown className="h-2.5 w-2.5" /></span>
    </div>

    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden px-3 py-3">
      {/* user */}
      <div className="ml-auto max-w-[80%] rounded-[10px] rounded-tr-[3px] bg-white/[0.08] px-3 py-2 text-[11px] leading-snug text-[#e7e2d9]">
        Cut these 6 interview clips into a 90-second highlight, add subtitles, and reframe for vertical.
      </div>
      {/* agent */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border acc-bd40 acc-b12 acc-fg-hi"><Sparkles className="h-3 w-3" /></span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] leading-snug text-[#aaa39a]">On it — building the paper edit from the transcript, then assembling the timeline.</p>
          <ToolRow label="Transcribe" detail="Whisper · 6 clips" />
          <ToolRow label="Select quotes" detail="8 chosen" />
          <ToolRow label="Arrange + dissolves" detail="V1 · 1:29" />
          <ToolRow label="Subtitles" detail="burned-in" />
          <div className="flex items-center gap-2 rounded-[6px] border acc-bd30 acc-b06 px-2 py-1.5">
            <Sparkles className="h-3 w-3 shrink-0 acc-fg-hi" />
            <span className="text-[10px] font-medium text-[#cdc7be]">Auto-reframe → 9:16</span>
            <span className="ml-auto text-[9px] acc-fg-hi">Review edit ›</span>
          </div>
        </div>
      </div>
    </div>

    {/* composer */}
    <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5">
      <div className="flex flex-1 items-center rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[10.5px] text-[#5d5850]">Ask the agent to edit…</div>
      <button className="grid h-7 w-7 place-items-center rounded-[8px] text-white" style={{ background: V }}><ArrowUp className="h-3.5 w-3.5" /></button>
    </div>
  </div>
);

export default MotionAgent;
