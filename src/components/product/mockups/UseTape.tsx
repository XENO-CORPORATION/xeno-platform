import React from 'react';
import {
  FileArchive, Camera, MousePointer2, Keyboard, CornerDownLeft, Check,
  ThumbsUp, ThumbsDown, GitCompareArrows, ShieldCheck,
} from 'lucide-react';

/* Gallery mockup — the .xuse tape inspector (SPEC §3.7 "record format" + §3
 * "scrub through what an agent did, mark steps correct/incorrect, export
 * labeled datasets"). Shows the filmstrip of recorded frames, the selected
 * step's action detail + result, and the integrity/signature line. Same
 * landing-v3 language; accent flows through rgb(var(--acc)) only. */

const V = 'rgb(var(--acc))';

const frames = [
  { icon: Camera, sel: false },
  { icon: MousePointer2, sel: false },
  { icon: Keyboard, sel: true },
  { icon: CornerDownLeft, sel: false },
  { icon: Camera, sel: false },
];

const UseTape: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 flex items-center gap-1.5 text-[10.5px] font-medium text-[#69635b]">
        <FileArchive className="h-3.5 w-3.5" /> session-2026-05-23.xuse
      </span>
      <span className="ml-auto text-[9.5px] text-[#5d5850]">18 actions · 20 frames</span>
    </div>

    <div className="flex h-[clamp(300px,40vh,360px)] flex-col">
      {/* filmstrip of recorded frames */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-3">
        {frames.map((f, i) => {
          const Icon = f.icon;
          return (
            <div key={i} className={`relative grid h-12 flex-1 place-items-center overflow-hidden rounded-[6px] border ${f.sel ? 'acc-bd' : 'border-white/[0.07]'}`}
              style={{ background: 'radial-gradient(ellipse at 40% 0%,#181a22,#0b0b0e 75%)' }}>
              <Icon className={`h-3.5 w-3.5 ${f.sel ? 'acc-fg-hi' : 'text-[#5d5850]'}`} />
              <span className="absolute bottom-0.5 left-1 font-mono text-[7px] text-[#5d5850]">{String(i + 6).padStart(2, '0')}</span>
              {f.sel && <span className="absolute inset-x-0 bottom-0 h-0.5 acc-b" />}
            </div>
          );
        })}
      </div>

      {/* selected step detail */}
      <div className="grid flex-1 grid-cols-1 sm:grid-cols-[1fr_0.9fr]">
        {/* frame preview */}
        <div className="relative hidden overflow-hidden border-r border-white/[0.06] sm:block" style={{ background: 'radial-gradient(ellipse at 30% 0%,#171922,#0b0b0e 72%)' }}>
          <div className="absolute inset-[16px] rounded-[7px] border border-white/[0.08] bg-[#101014] p-3">
            <div className="h-1.5 w-[60%] rounded-full bg-white/[0.10]" />
            <div className="mt-2 h-1.5 w-[40%] rounded-full bg-white/[0.05]" />
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[8.5px] text-[#cdc7be]">
              <span className="h-1 w-1 rounded-full acc-b motion-safe:animate-pulse" /> xenostudio.ai
              <span className="ml-0.5 h-2.5 w-px" style={{ background: V }} />
            </div>
          </div>
          <span className="absolute bottom-2 left-4 rounded-[3px] border border-white/[0.08] bg-black/50 px-1.5 py-0.5 font-mono text-[8px] text-[#827b71] backdrop-blur-sm">frame 08 · post-action</span>
        </div>

        {/* action json + result */}
        <div className="flex flex-col justify-between p-3.5">
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#e7e2d9]"><Keyboard className="h-3.5 w-3.5 acc-fg-hi" /> use.type</span>
              <span className="font-mono text-[9px] text-[#5d5850]">t+2.14s</span>
            </div>
            <div className="mt-2 rounded-[7px] border border-white/[0.06] bg-[#0a0a0c] p-2.5 font-mono text-[10px] leading-relaxed">
              <div className="text-[#69635b]">{'{'}</div>
              <div className="pl-3"><span className="text-[#827b71]">"text"</span>: <span className="acc-fg-hi">"xenostudio.ai"</span>,</div>
              <div className="pl-3"><span className="text-[#827b71]">"target"</span>: <span className="text-[#aaa39a]">"url-bar"</span></div>
              <div className="text-[#69635b]">{'}'}</div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#827b71]">
              <Check className="h-3 w-3 text-[#3fbf7f]" /> ok · a11y tree captured (34 nodes)
            </div>
          </div>

          {/* label controls */}
          <div className="mt-3 flex items-center gap-2">
            <button className="flex items-center gap-1 rounded-[5px] acc-bd30 acc-b10 border px-2 py-1 text-[9.5px] font-medium acc-fg-hi"><ThumbsUp className="h-3 w-3" /> Correct</button>
            <button className="flex items-center gap-1 rounded-[5px] border border-white/[0.08] px-2 py-1 text-[9.5px] text-[#827b71]"><ThumbsDown className="h-3 w-3" /> Flag</button>
            <button className="ml-auto flex items-center gap-1 text-[9.5px] text-[#69635b]"><GitCompareArrows className="h-3 w-3" /> Diff run</button>
          </div>
        </div>
      </div>

      {/* integrity footer */}
      <div className="flex items-center gap-1.5 border-t border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2 text-[9.5px] text-[#69635b]">
        <ShieldCheck className="h-3.5 w-3.5" /> Ed25519-signed · snapshot 7f3a…c1 · replay verified
      </div>
    </div>
  </div>
);

export default UseTape;
