import React from 'react';
import { Sparkles, ChevronLeft, Phone, Video, Plus, Smile, Mic, CheckCheck } from 'lucide-react';

/* Gallery mockup — XENO Comms on mobile (the "desktop now, mobile next" story).
 * Hand-built real UI in the landing-v3 language, no AI-generated imagery.
 * A phone frame centered on a dark panel so it sits cleanly in the gallery grid. */

const V = 'rgb(var(--acc))';

const CommsMobile: React.FC = () => (
  <div className="flex w-full items-center justify-center rounded-[16px] border border-white/[0.07] py-8" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 20%, rgb(var(--acc) / 0.10), transparent 70%), #0a0a0b' }}>
    {/* phone */}
    <div className="w-[248px] overflow-hidden rounded-[30px] border border-white/[0.10] bg-[#0d0d0f] p-1.5 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]">
      <div className="overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#0d0d0f]">
        {/* status bar */}
        <div className="flex items-center justify-between px-5 pt-2.5 text-[9px] font-medium text-[#948d83]">
          <span>9:41</span>
          <span className="h-4 w-16 rounded-b-[10px] bg-black" />
          <span className="flex items-center gap-1"><span className="h-2 w-3.5 rounded-[2px] border border-white/30" /></span>
        </div>
        {/* conversation header */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
          <ChevronLeft className="h-4 w-4 text-[#69635b]" />
          <span className="grid h-7 w-7 place-items-center rounded-full text-[9px] font-semibold text-white/90" style={{ background: 'linear-gradient(135deg,#5fa088,#2f5d4c)' }}>DG</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-semibold text-[#f3efe8]">Design Guild</div>
            <div className="flex items-center gap-1 text-[9px] text-[#3fbf7f]"><span className="h-1.5 w-1.5 rounded-full bg-[#3fbf7f]" />3 online</div>
          </div>
          <Phone className="h-3.5 w-3.5 text-[#5d5850]" /><Video className="h-3.5 w-3.5 text-[#5d5850]" />
        </div>
        {/* messages */}
        <div className="flex flex-col gap-2 px-3 py-3">
          <div className="max-w-[82%] self-start rounded-[12px] rounded-bl-[3px] bg-white/[0.05] px-2.5 py-1.5 text-[11px] leading-snug text-[#aaa39a]">Can you review the new hero before standup?</div>
          <div className="max-w-[82%] self-end rounded-[12px] rounded-br-[3px] border border-white/[0.10] bg-white/[0.03] px-2.5 py-1.5 text-[11px] leading-snug text-[#cdc7be]">
            On it — adding the motion pass now.
            <span className="mt-0.5 flex items-center justify-end gap-1 text-[8px] text-[#69635b]">9:41 <CheckCheck className="h-2.5 w-2.5 text-[#aaa39a]" /></span>
          </div>
          <div className="flex items-end gap-1.5 self-start">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border acc-bd40 acc-b12 acc-fg-hi"><Sparkles className="h-2.5 w-2.5" /></span>
            <div className="max-w-[80%] rounded-[12px] rounded-bl-[3px] border acc-bd25 acc-b07 px-2.5 py-1.5 text-[11px] leading-snug text-[#aaa39a]">
              <span className="font-medium acc-fg-hi">Anima</span> summarized the 4 review threads ✓
            </div>
          </div>
        </div>
        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5">
          <Plus className="h-4 w-4 text-[#69635b]" />
          <div className="flex flex-1 items-center justify-between rounded-full border border-white/[0.07] bg-white/[0.02] px-3 py-1.5">
            <span className="text-[10.5px] text-[#5d5850]">Message</span>
            <Smile className="h-3.5 w-3.5 text-[#5d5850]" />
          </div>
          <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: V }}><Mic className="h-3.5 w-3.5" /></span>
        </div>
      </div>
    </div>
  </div>
);

export default CommsMobile;
