import React from 'react';
import {
  Monitor, Boxes, ScanLine, Camera, AppWindow, MousePointer2, Keyboard,
  CornerDownLeft, Clock, Check, Play, SkipBack, Gauge, Loader2, ArrowLeft, ArrowRight, RotateCw, Star,
} from 'lucide-react';

/* Hero mockup — the XENO Use Inspector, the "web UI for live device control +
 * tape playback" named in SPEC §3 / §5. Recreated in the landing-v3 language:
 * near-black panels, hairline borders, off-white text. It shows a sandboxed
 * device viewport (with the accessibility-tree overlay + a click crosshair) on
 * the left and the live use.* action stream on the right — the two surfaces that
 * make xeno-use "the agent's hands." All accent color flows through rgb(var(--acc))
 * so the Shift+T theme switch recolors it — no hardcoded violet. */

const V = 'rgb(var(--acc))';

type Row = { verb: string; arg: string; icon: React.ComponentType<{ className?: string }>; state: 'done' | 'active' | 'pending' };
const stream: Row[] = [
  { verb: 'screenshot', arg: 'monitor: 0', icon: Camera, state: 'done' },
  { verb: 'launch', arg: 'firefox', icon: AppWindow, state: 'done' },
  { verb: 'click', arg: '{ x: 640, y: 360 }', icon: MousePointer2, state: 'active' },
  { verb: 'type', arg: '"xenostudio.ai"', icon: Keyboard, state: 'pending' },
  { verb: 'key', arg: 'Enter', icon: CornerDownLeft, state: 'pending' },
  { verb: 'wait', arg: 'until: domReady', icon: Clock, state: 'pending' },
  { verb: 'screenshot', arg: 'a11y: true', icon: Camera, state: 'pending' },
];

/* a dashed accessibility-tree bounding box with a tiny role label */
function A11yBox({ style, label }: { style: React.CSSProperties; label: string }) {
  return (
    <div className="pointer-events-none absolute rounded-[3px] border border-dashed" style={{ borderColor: `rgb(var(--acc) / 0.55)`, ...style }}>
      <span className="absolute -top-[13px] left-0 rounded-[2px] px-1 text-[7.5px] font-semibold text-black" style={{ background: V }}>{label}</span>
    </div>
  );
}

const UseInspector: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] font-medium text-[#69635b]">XENO Use · Inspector</span>
      <span className="ml-auto flex items-center gap-1.5 rounded-[4px] border acc-bd30 acc-b10 px-1.5 py-0.5 text-[9px] font-semibold acc-fg-hi">
        <span className="h-1.5 w-1.5 rounded-full acc-b motion-safe:animate-pulse" /> REC 00:42
      </span>
    </div>

    <div className="flex h-[clamp(392px,52vh,468px)] text-left">
      {/* ── device viewport ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* device descriptor strip */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2 text-[10px] text-[#69635b]">
          <span className="flex items-center gap-1.5 text-[#cdc7be]"><Monitor className="h-3.5 w-3.5" /> desktop · linux</span>
          <span className="flex items-center gap-1 rounded-[4px] border border-white/[0.08] px-1.5 py-0.5"><Boxes className="h-3 w-3" /> container</span>
          <span className="hidden sm:inline">1920×1080</span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[9px]"><span className="h-1.5 w-1.5 rounded-full bg-[#3fbf7f]" /> snapshot 7f3a…c1</span>
        </div>

        {/* the sandboxed screen being driven */}
        <div className="relative flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_30%_0%,#181a22,#0b0b0e_70%)]">
          {/* a browser window inside the sandbox */}
          <div className="absolute inset-[14px] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#101014] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
            {/* browser chrome */}
            <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0c0c10] px-2.5 py-1.5">
              <ArrowLeft className="h-3 w-3 text-[#4f4a44]" />
              <ArrowRight className="h-3 w-3 text-[#4f4a44]" />
              <RotateCw className="h-2.5 w-2.5 text-[#4f4a44]" />
              <div className="ml-1 flex flex-1 items-center gap-1.5 rounded-[5px] border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9.5px] text-[#69635b]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3fbf7f]" /> xenostudio.ai
              </div>
            </div>
            {/* page content */}
            <div className="relative px-4 py-4">
              <div className="flex items-center gap-3 text-[8.5px] text-[#5d5850]">
                <span className="font-semibold text-[#cdc7be]">XENO</span>
                <span>Products</span><span>Pricing</span><span>Docs</span>
              </div>
              <div className="mt-5 h-2 w-[62%] rounded-full bg-white/[0.10]" />
              <div className="mt-2 h-2 w-[44%] rounded-full bg-white/[0.06]" />
              <div className="mt-4 h-1.5 w-[70%] rounded-full bg-white/[0.04]" />
              <div className="mt-1.5 h-1.5 w-[52%] rounded-full bg-white/[0.04]" />

              {/* the click target — a CTA button */}
              <div className="relative mt-5 inline-flex">
                <span className="rounded-[5px] bg-white px-3 py-1.5 text-[9px] font-semibold text-black">Get started</span>
                <A11yBox label="button" style={{ inset: '-4px -6px' }} />
              </div>

              {/* a11y overlay on the nav */}
              <A11yBox label="link" style={{ top: '13px', left: '112px', width: '30px', height: '13px' }} />

              {/* click crosshair + coordinate label */}
              <div className="pointer-events-none absolute" style={{ top: '128px', left: '58px' }}>
                <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border" style={{ borderColor: V }} />
                <span className="absolute -left-[18px] -top-[18px] h-9 w-9 rounded-full border opacity-40 motion-safe:animate-ping" style={{ borderColor: V }} />
                <span className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: V }} />
                <span className="absolute left-4 top-2 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[8px] font-semibold text-black" style={{ background: V }}>click 640, 360</span>
              </div>
            </div>
          </div>

          {/* mode chip */}
          <div className="absolute bottom-2 left-3.5 flex items-center gap-1.5 rounded-[4px] border border-white/[0.08] bg-black/50 px-1.5 py-0.5 text-[8.5px] text-[#827b71] backdrop-blur-sm">
            <ScanLine className="h-3 w-3" /> find · hybrid (a11y + visual)
          </div>
        </div>

        {/* replay transport */}
        <div className="flex items-center gap-2.5 border-t border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
          <SkipBack className="h-3.5 w-3.5 text-[#69635b]" />
          <span className="grid h-6 w-6 place-items-center rounded-full text-black" style={{ background: V }}><Play className="h-3 w-3 translate-x-px" /></span>
          <div className="relative h-1 flex-1 rounded-full bg-white/[0.08]">
            <div className="absolute inset-y-0 left-0 w-[54%] rounded-full" style={{ background: V }} />
            <div className="absolute -top-1 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[#0a0a0c]" style={{ left: '54%', background: V }} />
          </div>
          <span className="font-mono text-[9px] text-[#69635b]">00:42 / 01:18</span>
          <span className="flex items-center gap-1 rounded-[4px] border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-[#827b71]"><Gauge className="h-3 w-3" /> 1×</span>
        </div>
      </section>

      {/* ── action stream ── */}
      <aside className="hidden w-[clamp(196px,32%,238px)] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#827b71]">Action stream</span>
          <span className="text-[9.5px] text-[#5d5850]">7 steps</span>
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden p-2">
          {stream.map((r, i) => {
            const Icon = r.icon;
            const active = r.state === 'active';
            return (
              <div key={i} className={`flex items-center gap-2 rounded-[7px] px-2 py-[7px] ${active ? 'acc-b10 acc-bd30 border' : ''}`}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] ${active ? 'acc-b16 acc-fg-hi' : 'bg-white/[0.04] text-[#69635b]'}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-[11px] font-medium ${r.state === 'pending' ? 'text-[#69635b]' : 'text-[#e7e2d9]'}`}>use.{r.verb}</span>
                  </div>
                  <div className="truncate font-mono text-[9px] text-[#5d5850]">{r.arg}</div>
                </div>
                {r.state === 'done' && <Check className="h-3 w-3 shrink-0 text-[#3fbf7f]" />}
                {active && <Loader2 className="h-3 w-3 shrink-0 acc-fg-hi motion-safe:animate-spin" />}
              </div>
            );
          })}
        </div>
        {/* labeling footer — the inspector marks steps correct/incorrect (SPEC §3) */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3.5 py-2.5 text-[10px] text-[#69635b]">
          <Star className="h-3.5 w-3.5" /> Recording to <span className="font-mono text-[#827b71]">.xuse</span>
        </div>
      </aside>
    </div>
  </div>
);

export default UseInspector;
