import React from 'react';
import { Sparkles, CheckCheck, Smile, AtSign, Plus, SendHorizontal, UserPlus, PencilLine, CalendarClock, ChevronRight, Hash } from 'lucide-react';

/* Gallery mockup — an AI agent doing real work in a thread: it posts a summary +
 * actionable next steps (assign / draft / schedule). Hand-built real UI in the
 * landing-v3 language (no AI-generated imagery). Landscape, pairs with CommsMobile. */

const V = 'rgb(var(--acc))';
const Avatar = ({ init, grad, online }: { init: string; grad: string; online?: boolean }) => (
  <span className="relative shrink-0">
    <span className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-semibold text-white/90" style={{ background: grad }}>{init}</span>
    {online && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-[#0d0d0f] bg-[#3fbf7f]" />}
  </span>
);
const Agent = () => <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border acc-bd40 acc-b12 acc-fg-hi"><Sparkles className="h-3 w-3" /></span>;

const actions = [
  { icon: UserPlus, label: 'Assign', hint: 'Choose owner' },
  { icon: PencilLine, label: 'Draft reply', hint: 'Create a message' },
  { icon: CalendarClock, label: 'Schedule', hint: 'Add to calendar' },
];

const CommsAgentActions: React.FC = () => (
  <div className="w-full overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_40px_100px_-40px_rgba(0,0,0,0.85)]">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
    </div>
    <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
      <Hash className="h-3.5 w-3.5 text-[#807970]" />
      <span className="text-[13px] font-semibold text-[#f3efe8]">client-onboarding</span>
      <span className="text-[10.5px] text-[#69635b]">· Acme · 5 online</span>
    </div>
    <div className="flex flex-col gap-3.5 px-4 py-4">
      {/* human */}
      <div className="flex items-start gap-2.5">
        <Avatar init="MA" grad="linear-gradient(135deg,#b8688f,#6d3f63)" online />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">Maya</span><span className="text-[9.5px] text-[#5d5850]">9:15 AM</span></div>
          <p className="mt-1 text-[12px] leading-snug text-[#aaa39a]">Where are we on the Acme onboarding — anything blocking the kickoff?</p>
        </div>
      </div>
      {/* agent card with actions */}
      <div className="flex items-start gap-2.5">
        <Agent />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">XENO AI</span><span className="rounded-[3px] acc-b20 px-1 text-[8px] font-bold uppercase acc-fg-hi">AI</span><span className="text-[9.5px] text-[#5d5850]">9:16 AM</span></div>
          <div className="mt-1 grid gap-3 rounded-[10px] rounded-tl-[3px] border acc-bd30 acc-b06 p-3 md:grid-cols-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#827b71]">Summary</div>
              <ul className="mt-1.5 space-y-1 text-[11.5px] text-[#aaa39a]">
                <li className="flex gap-1.5"><span style={{ color: V }}>•</span> Acme signed off on the SOW + security docs</li>
                <li className="flex gap-1.5"><span style={{ color: V }}>•</span> Kickoff set for Thu, 10:00 PT</li>
                <li className="flex gap-1.5"><span style={{ color: V }}>•</span> No blockers identified</li>
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#827b71]">Next steps</div>
              <div className="mt-1.5 space-y-1.5">
                {actions.map((a) => (
                  <div key={a.label} className="flex items-center justify-between rounded-[7px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5">
                    <span className="flex items-center gap-2 text-[11.5px] text-[#d8d2ca]"><a.icon className="h-3.5 w-3.5 acc-fg-hi" />{a.label}</span>
                    <span className="flex items-center gap-1 text-[10px] text-[#69635b]">{a.hint}<ChevronRight className="h-3 w-3" /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* human confirm */}
      <div className="flex items-start gap-2.5">
        <Avatar init="JO" grad="linear-gradient(135deg,#5b7fb0,#33486b)" online />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">Jordan</span><span className="text-[9.5px] text-[#5d5850]">9:18 AM</span><CheckCheck className="h-3 w-3 text-[#69635b]" /></div>
          <p className="mt-1 text-[12px] leading-snug text-[#aaa39a]">Looks good — assign it to <span className="rounded-[3px] acc-b15 px-1 font-medium acc-fg-hi">@Maya</span> and schedule the kickoff.</p>
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
      <Plus className="h-4 w-4 text-[#69635b]" />
      <div className="flex flex-1 items-center justify-between rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 py-2">
        <span className="text-[11.5px] text-[#5d5850]">Message #client-onboarding</span>
        <span className="flex items-center gap-2.5 text-[#5d5850]"><Smile className="h-3.5 w-3.5" /><AtSign className="h-3.5 w-3.5" /></span>
      </div>
      <button className="grid h-8 w-8 place-items-center rounded-[8px] text-white" style={{ background: V }}><SendHorizontal className="h-4 w-4" /></button>
    </div>
  </div>
);

export default CommsAgentActions;
