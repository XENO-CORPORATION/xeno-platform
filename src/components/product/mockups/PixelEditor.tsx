import React from 'react';
import {
  MousePointer2, Lasso, Wand2, Crop, Pipette, Paintbrush, Eraser,
  PaintBucket, PenTool, Type, Hand, ZoomIn, Sparkles, Eye, Lock, Layers as LayersIcon,
  Sliders, Plus, SquareDashed, CircleDashed, ChevronDown, Check, ArrowUp,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Pixel editor mockup — the hero's "representative content"
 * (NN/g: the hero visual must be the real product). Recreates the real renderer
 * from ../xeno-pixel/src/renderer/src (App.tsx layout: menu bar → tool-options
 * strip → tools rail · canvas · right sidebar with an Agent panel + Layers).
 * Built in the landing-v3 language: near-black panels, hairline borders,
 * off-white text. Every accent element routes through .acc-* / rgb(var(--acc))
 * so the Shift+T theme switch recolors it — no hardcoded violet. */

const V = 'rgb(var(--acc))';

/* ── left tools rail ── */
const TOOLS = [
  { icon: MousePointer2, on: false },
  { icon: SquareDashed, on: false },
  { icon: Lasso, on: false },
  { icon: Wand2, on: true },        // Magic Wand — active (accent)
  { icon: Crop, on: false },
  { icon: Pipette, on: false },
  { icon: Paintbrush, on: false },
  { icon: Eraser, on: false },
  { icon: PaintBucket, on: false },
  { icon: PenTool, on: false },
  { icon: Type, on: false },
  { icon: Hand, on: false },
  { icon: ZoomIn, on: false },
];

/* ── layers, top → bottom (as shown in the panel) ── */
const LAYERS = [
  { name: 'Levels 1', kind: 'adj' as const, active: false, locked: false },
  { name: 'Subject', kind: 'raster' as const, active: true, locked: false, mask: true },
  { name: 'Background', kind: 'raster' as const, active: false, locked: true },
];

function MenuItem({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 text-[10.5px] text-[#8f887e] hover:text-[#d8d2ca]">{children}</span>;
}
function Opt({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap text-[9.5px] text-[#6b655c]">{children}</span>;
}

const PixelEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[780px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] text-[#5d5850]">XENO Pixel — dune-portrait.xpixel</span>
    </div>

    {/* menu bar */}
    <div className="flex items-center gap-0.5 border-b border-white/[0.05] bg-[#0a0a0c] px-3 py-1.5">
      {['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View'].map((m) => <MenuItem key={m}>{m}</MenuItem>)}
    </div>

    {/* tool options strip (context: Magic Wand) */}
    <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0c0c0e] px-3 py-1.5">
      <span className="flex items-center gap-1 text-[9.5px] font-medium text-[#c2bbb1]"><Wand2 className="h-3 w-3" strokeWidth={1.6} />Magic Wand</span>
      <span className="h-3 w-px bg-white/[0.08]" />
      <Opt>Tolerance 24</Opt>
      <span className="hidden h-3 w-px bg-white/[0.08] sm:block" />
      <Opt><span className="hidden sm:inline">Contiguous · Anti-alias</span></Opt>
      <span className="ml-auto flex items-center gap-1 rounded-[4px] border acc-bd30 acc-b12 px-1.5 py-[3px] text-[9.5px] font-medium acc-fg-hi">
        <Sparkles className="h-3 w-3" strokeWidth={1.8} />Select Subject
      </span>
    </div>

    <div className="flex h-[clamp(392px,52vh,478px)] text-left">
      {/* ── tools rail ── */}
      <aside className="flex w-[34px] shrink-0 flex-col items-center gap-0.5 border-r border-white/[0.06] bg-[#0a0a0c] py-1.5">
        {TOOLS.map((t, i) => {
          const Icon = t.icon;
          return (
            <React.Fragment key={i}>
              {(i === 6 || i === 11) && <span className="my-0.5 h-px w-4 bg-white/[0.06]" />}
              <span className={`grid h-6 w-6 place-items-center rounded-[4px] ${t.on ? 'acc-b16 acc-fg-hi' : 'text-[#5d5850]'}`}>
                <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
              </span>
            </React.Fragment>
          );
        })}
        {/* fg / bg swatches */}
        <div className="relative mt-auto mb-1 h-7 w-7">
          <span className="absolute bottom-0 right-0 h-[15px] w-[15px] rounded-[2px] border border-white/20 bg-[#0e0e10]" />
          <span className="absolute left-0 top-0 h-[15px] w-[15px] rounded-[2px] border border-white/30 bg-[#f3efe8]" />
        </div>
      </aside>

      {/* ── canvas viewport ── */}
      <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#070709] p-4"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
        {/* the "photograph" being edited */}
        <div className="relative aspect-[4/5] h-full max-h-[300px] overflow-hidden rounded-[3px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]"
          style={{ background: 'linear-gradient(200deg,#e8b06a 0%,#c9743f 34%,#7a3b32 66%,#2b1b28 100%)' }}>
          {/* subject silhouette */}
          <div className="absolute inset-x-0 bottom-0 mx-auto h-[64%] w-[52%]"
            style={{ background: 'radial-gradient(ellipse 60% 45% at 50% 22%, #3a2530 0%, transparent 62%), linear-gradient(180deg,#241722,#140c15)', borderRadius: '46% 46% 8% 8% / 60% 60% 8% 8%' }} />
          {/* sun */}
          <div className="absolute right-[18%] top-[16%] h-8 w-8 rounded-full" style={{ background: 'radial-gradient(circle,#fbe6b8,#f3b25f 70%,transparent)' }} />
          {/* AI subject selection — marching-ants marquee (accent) */}
          <div className="absolute bottom-0 left-1/2 h-[66%] w-[56%] -translate-x-1/2 rounded-[44%_44%_6%_6%/58%_58%_6%_6%] border-2 border-dashed acc-bd"
            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.35) inset' }} />
          {/* selection corner handle */}
          <span className="absolute bottom-[64%] left-1/2 h-2 w-2 -translate-x-1/2 rounded-[1px] border border-black/40 acc-b" />
        </div>

        {/* floating AI toast (bottom-left) */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-[6px] border acc-bd30 acc-b12 px-2 py-1 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full acc-b motion-safe:animate-pulse" />
          <span className="text-[9.5px] font-medium acc-fg-hi">Subject selected · SAM2 on-device</span>
        </div>
        {/* zoom readout (bottom-right) */}
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-[5px] border border-white/[0.07] bg-black/50 px-2 py-1 text-[9.5px] tabular-nums text-[#8f887e]">100%</div>
      </section>

      {/* ── right sidebar ── */}
      <aside className="hidden w-[196px] shrink-0 flex-col gap-[3px] border-l border-white/[0.06] bg-[#0a0a0c] p-[3px] md:flex">
        {/* Agent panel (top) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[7px] bg-[#0d0d0f]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.09em]">
            <span className="text-[#69635b]">Properties</span>
            <span className="flex items-center gap-1 acc-fg-hi"><Sparkles className="h-2.5 w-2.5" strokeWidth={2} />Agent</span>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-2.5 py-2.5">
            <Reveal y={6}>
              <div className="ml-auto max-w-[150px] rounded-[8px] rounded-tr-[3px] border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] leading-snug text-[#cdc7be]">
                Cut out the subject and upscale to 4K.
              </div>
            </Reveal>
            <Reveal y={6} delay={80}>
              <div className="flex items-start gap-1.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border acc-bd40 acc-b12 acc-fg-hi"><Sparkles className="h-2.5 w-2.5" /></span>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1 text-[9.5px]" style={{ color: '#aaa39a' }}>
                    <Check className="h-3 w-3" style={{ color: V }} />Remove Background <span className="text-[#5d5850]">· RMBG-2.0</span>
                  </div>
                  <div className="flex items-center gap-1 text-[9.5px]" style={{ color: '#aaa39a' }}>
                    <Check className="h-3 w-3" style={{ color: V }} />Upscale 4× <span className="text-[#5d5850]">· Real-ESRGAN</span>
                  </div>
                  <p className="text-[10px] leading-snug text-[#8f887e]">Done — new document is 4096×5120. Both edits are non-destructive.</p>
                </div>
              </div>
            </Reveal>
            {/* composer */}
            <div className="mt-1 flex items-center gap-1.5 rounded-[7px] border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
              <span className="flex-1 text-[9.5px] text-[#5d5850]">Ask the agent…</span>
              <span className="grid h-4 w-4 place-items-center rounded-[4px] text-white" style={{ background: V }}><ArrowUp className="h-2.5 w-2.5" /></span>
            </div>
          </div>
        </div>

        {/* Layers panel (bottom) */}
        <div className="flex flex-col overflow-hidden rounded-[7px] bg-[#0d0d0f]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-2.5 py-1.5">
            <span className="text-[9px] font-medium uppercase tracking-[0.09em] text-[#c2bbb1]">Layers</span>
            <div className="flex items-center gap-1.5 text-[9px] text-[#69635b]">
              <span>Normal</span><ChevronDown className="h-2.5 w-2.5" /><span className="tabular-nums">100%</span>
            </div>
          </div>
          <div className="space-y-px p-1">
            {LAYERS.map((l) => (
              <div key={l.name} className={`flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 ${l.active ? 'acc-b10' : ''}`}>
                <Eye className="h-3 w-3 shrink-0 text-[#69635b]" strokeWidth={1.6} />
                {/* thumbnail */}
                {l.kind === 'adj' ? (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] border border-white/[0.08] bg-white/[0.04]"><Sliders className="h-3 w-3 text-[#8f887e]" strokeWidth={1.6} /></span>
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded-[3px] border border-white/[0.08]"
                    style={{ background: l.name === 'Subject' ? 'linear-gradient(180deg,#7a3b32,#140c15)' : 'linear-gradient(200deg,#e8b06a,#7a3b32 70%,#2b1b28)' }} />
                )}
                {/* mask thumbnail */}
                {l.mask && <span className="h-6 w-6 shrink-0 rounded-[3px] border border-white/[0.1]" style={{ background: 'radial-gradient(ellipse 60% 70% at 50% 78%, #fff 0%, #fff 40%, #000 62%)' }} />}
                <span className={`min-w-0 flex-1 truncate text-[10.5px] ${l.active ? 'text-[#f3efe8]' : 'text-[#b3aca2]'}`}>{l.name}</span>
                {l.locked && <Lock className="h-2.5 w-2.5 shrink-0 text-[#5d5850]" strokeWidth={1.8} />}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-2.5 py-1.5 text-[#5d5850]">
            <LayersIcon className="h-3 w-3" strokeWidth={1.6} />
            <CircleDashed className="h-3 w-3" strokeWidth={1.6} />
            <Sliders className="h-3 w-3" strokeWidth={1.6} />
            <Plus className="ml-auto h-3 w-3" strokeWidth={1.8} />
          </div>
        </div>
      </aside>
    </div>

    {/* status bar */}
    <div className="flex items-center gap-3 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[9px] tabular-nums text-[#5d5850]">
      <span>4096 × 5120 px</span>
      <span>300 DPI</span>
      <span className="hidden sm:inline">RGB · 16-bit</span>
      <span className="hidden sm:inline">ACEScg</span>
      <span className="ml-auto capitalize">magic wand</span>
    </div>
  </div>
);

export default PixelEditor;
