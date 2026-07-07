import React from 'react';
import { Palette, Activity, ChevronDown } from 'lucide-react';

/* Gallery mockup — XENO Motion's color page: a graded Program Monitor, the
 * Lift/Gamma/Gain color wheels, and the WFM + Vectorscope video scopes
 * (xeno-motion ColorPanel + scopes/*). WebGPU 3D-LUT + ACES 2.0 pipeline.
 * Accent (wheel dots, active labels) via rgb(var(--acc)); scope traces are
 * fixed instrument colors. */

const V = 'rgb(var(--acc))';

function Wheel({ label, hue }: { label: string; hue: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[54px] w-[54px] rounded-full border border-white/[0.08]"
        style={{ background: `radial-gradient(circle at 50% 50%, #15151a 30%, ${hue} 140%)` }}>
        <div className="absolute inset-[30%] rounded-full border border-white/10" />
        {/* control dot, nudged off-center */}
        <div className="absolute h-2 w-2 rounded-full border border-black/50" style={{ background: V, left: '58%', top: '42%' }} />
      </div>
      <span className="text-[8.5px] font-medium text-[#aaa39a]">{label}</span>
      <div className="h-[3px] w-[54px] rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: '52%', background: V }} />
      </div>
    </div>
  );
}

const MotionColor: React.FC = () => (
  <div className="h-[clamp(300px,40vh,380px)] w-full overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0d0d0f]">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3 py-2">
      <Palette className="h-3.5 w-3.5" style={{ color: V }} />
      <span className="text-[10.5px] font-semibold text-[#e7e2d9]">Color</span>
      <span className="ml-auto flex items-center gap-1 text-[9px] text-[#69635b]">ACES 2.0 · Rec.709 <ChevronDown className="h-2.5 w-2.5" /></span>
    </div>

    <div className="flex h-[calc(100%-37px)] flex-col p-3">
      {/* graded monitor */}
      <div className="relative flex-1 overflow-hidden rounded-[6px] border border-white/[0.07]">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 34% 30%, #7d5a3a 0%, #33283a 48%, #0e1018 100%)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,transparent 60%,rgba(0,0,0,0.5))' }} />
        <div className="absolute bottom-0 left-1/2 h-[58%] w-[30%] -translate-x-1/2 rounded-t-[36px]" style={{ background: 'linear-gradient(180deg,#2c2432,#161320)' }} />
        <span className="absolute left-2 top-2 rounded-[3px] bg-black/40 px-1.5 py-0.5 text-[8px] font-medium text-white/70">Node 2 · 3D LUT</span>
      </div>

      {/* wheels + scopes */}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex gap-2.5">
          <Wheel label="Lift" hue="#3a4a63" />
          <Wheel label="Gamma" hue="#5a4a3a" />
          <Wheel label="Gain" hue="#3a5a4a" />
        </div>
        {/* scopes */}
        <div className="hidden gap-2 sm:flex">
          <div className="w-[76px]">
            <div className="mb-1 flex items-center gap-1 text-[8px] text-[#69635b]"><Activity className="h-2.5 w-2.5" /> Waveform</div>
            <div className="relative h-[54px] overflow-hidden rounded-[4px] border border-white/[0.07] bg-[#08080a]">
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 76 54">
                <path d="M4 40 C 18 22, 30 30, 40 18 S 64 26, 72 14" fill="none" stroke="rgba(120,214,164,0.55)" strokeWidth="1" />
                <path d="M4 46 C 18 30, 30 36, 40 26 S 64 34, 72 22" fill="none" stroke="rgba(130,170,230,0.5)" strokeWidth="1" />
              </svg>
            </div>
          </div>
          <div className="w-[54px]">
            <div className="mb-1 text-[8px] text-[#69635b]">Vector</div>
            <div className="relative h-[54px] overflow-hidden rounded-[4px] border border-white/[0.07] bg-[#08080a]">
              <div className="absolute inset-[18%] rounded-full border border-white/10" />
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
              <div className="absolute h-[2px] w-[2px] rounded-full" style={{ background: V, left: '62%', top: '40%' }} />
              <div className="absolute h-[2px] w-[2px] rounded-full bg-[#e6a05a]" style={{ left: '66%', top: '52%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default MotionColor;
