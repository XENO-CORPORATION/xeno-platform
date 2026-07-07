import React from 'react';
import {
  Aperture, Sparkles, Star, Flag, Crop, SlidersHorizontal, ChevronDown, ChevronRight,
  Folder, Images, Download, Wand2, Compass, Grid3x3, Check, Maximize2,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Photo mockup — the hero's "representative content" (NN/g:
 * the hero visual must be the real product). Recreates the Develop module of a
 * Lightroom-class RAW workspace as described in ../xeno-photo (README/CLAUDE):
 * a catalog + presets rail, a non-destructively developed RAW with an AI sky
 * mask, the Basic develop sliders + a Masking panel, and a culling filmstrip.
 * Built in the landing-v3 language: near-black panels, hairline borders,
 * off-white text. Every accent element routes through .acc-* / rgb(var(--acc))
 * so the Shift+T theme switch recolors it — no hardcoded violet. */

const V = 'rgb(var(--acc))';

/* ── the "photograph": a color-managed RAW landscape (sky · peaks · water) ── */
function Photo({ flat }: { flat?: boolean }) {
  return (
    <div className="absolute inset-0" style={{ filter: flat ? 'saturate(0.55) contrast(0.82) brightness(0.94)' : 'none' }}>
      {/* sky */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#213a63 0%,#3f5c86 24%,#c98a6a 62%,#e9b485 78%,#efc9a0 88%)' }} />
      {/* sun glow */}
      <div className="absolute" style={{ left: '64%', top: '46%', width: 70, height: 70, background: 'radial-gradient(circle,#fde6c4,rgba(243,178,95,0.5) 55%,transparent 72%)' }} />
      {/* far range */}
      <div className="absolute inset-x-0" style={{ top: '48%', height: '20%', clipPath: 'polygon(0 100%,10% 44%,22% 70%,34% 30%,48% 62%,60% 24%,74% 58%,88% 34%,100% 66%,100% 100%)', background: 'linear-gradient(180deg,#6b5f74,#4a4258)' }} />
      {/* near range */}
      <div className="absolute inset-x-0" style={{ top: '54%', height: '24%', clipPath: 'polygon(0 100%,14% 40%,30% 74%,44% 26%,58% 60%,72% 22%,86% 56%,100% 30%,100% 100%)', background: 'linear-gradient(180deg,#3a3242,#241d2b)' }} />
      {/* water */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: '74%', background: 'linear-gradient(180deg,#c98a6a 0%,#7c5f6b 34%,#2c2333 100%)' }} />
      {/* water reflection streak */}
      <div className="absolute" style={{ left: '58%', top: '76%', width: 42, height: '22%', background: 'linear-gradient(180deg,rgba(253,230,196,0.7),transparent)' }} />
    </div>
  );
}

/* ── bipolar develop slider (center = 0), accent fill + handle ── */
function Slider({ label, val, pos }: { label: string; val: string; pos: number }) {
  const p = 50 + pos / 2;              // handle position 0..100
  const from = Math.min(50, p);
  const to = Math.max(50, p);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[54px] shrink-0 text-[9.5px] text-[#8f887e]">{label}</span>
      <div className="relative h-[3px] flex-1 rounded-full bg-white/[0.09]">
        <span className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/25" style={{ left: '50%' }} />
        <span className="absolute inset-y-0 rounded-full acc-b" style={{ left: `${from}%`, right: `${100 - to}%` }} />
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 acc-b" style={{ left: `${p}%` }} />
      </div>
      <span className="w-[22px] shrink-0 text-right text-[9.5px] tabular-nums text-[#b3aca2]">{val}</span>
    </div>
  );
}

function SectionLabel({ children, open = true }: { children: React.ReactNode; open?: boolean }) {
  return (
    <div className="flex items-center gap-1 pb-1.5 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#69635b]">
      {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
      {children}
    </div>
  );
}

/* ── catalog + presets (left) ── */
const COLLECTIONS = [
  { name: '2026 Portfolio', count: '248', active: true },
  { name: 'Iceland — Day 3', count: '612' },
  { name: 'Vale Wedding', count: '1,204' },
  { name: 'Client — Marlow', count: '96' },
];
const PRESETS = [
  { name: 'Auto', ai: true },
  { name: 'Warm Film 04' },
  { name: 'B&W Contrast' },
  { name: 'Landscape Punch' },
];

/* ── culling filmstrip (bottom) ── */
const STRIP = [
  { g: 'linear-gradient(180deg,#3f5c86,#c98a6a)', pick: true },
  { g: 'linear-gradient(180deg,#213a63,#7c5f6b)', pick: true },
  { g: 'linear-gradient(160deg,#6b5f74,#241d2b)', active: true, pick: true },
  { g: 'linear-gradient(180deg,#c98a6a,#2c2333)', reject: true },
  { g: 'linear-gradient(200deg,#e9b485,#3a3242)', pick: true },
  { g: 'linear-gradient(180deg,#4a4258,#241722)', pick: true },
  { g: 'linear-gradient(160deg,#3f5c86,#2b1b28)', reject: true },
  { g: 'linear-gradient(180deg,#efc9a0,#7c5f6b)', pick: true },
  { g: 'linear-gradient(200deg,#5b7fb0,#33486b)' },
  { g: 'linear-gradient(180deg,#c98a6a,#4a4258)', pick: true },
];

const PhotoDevelop: React.FC = () => (
  <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] text-[#5d5850]">XENO Photo — 2026-portfolio.xphoto</span>
    </div>

    {/* module bar */}
    <div className="flex items-center gap-1 border-b border-white/[0.05] bg-[#0a0a0c] px-3 py-1.5 text-[10.5px]">
      {[
        { label: 'Library', icon: Images },
        { label: 'Develop', icon: SlidersHorizontal, active: true },
        { label: 'Map', icon: Compass },
        { label: 'Export', icon: Download },
      ].map((m) => {
        const Icon = m.icon;
        return (
          <span key={m.label} className={`flex items-center gap-1 rounded-[5px] px-2 py-1 ${m.active ? 'acc-b12 acc-fg-hi' : 'text-[#8f887e]'}`}>
            <Icon className="h-3 w-3" strokeWidth={1.7} />{m.label}
          </span>
        );
      })}
      <span className="ml-auto flex items-center gap-1 rounded-[5px] border acc-bd30 acc-b12 px-2 py-1 text-[9.5px] font-medium acc-fg-hi">
        <Sparkles className="h-3 w-3" strokeWidth={1.8} />Auto
      </span>
    </div>

    <div className="flex h-[clamp(392px,52vh,468px)] text-left">
      {/* ── catalog + presets rail ── */}
      <aside className="hidden w-[180px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] px-2.5 py-2 lg:flex">
        {/* navigator */}
        <SectionLabel>Navigator</SectionLabel>
        <div className="relative mb-3 h-[68px] overflow-hidden rounded-[4px] border border-white/[0.07]">
          <Photo />
          <span className="absolute inset-x-[10%] inset-y-[16%] rounded-[2px] border border-white/70" />
        </div>

        {/* collections */}
        <SectionLabel>Collections</SectionLabel>
        <div className="space-y-px">
          {COLLECTIONS.map((c) => (
            <div key={c.name} className={`flex items-center gap-1.5 rounded-[5px] px-1.5 py-[5px] ${c.active ? 'acc-b10' : ''}`}>
              <Folder className={`h-3 w-3 shrink-0 ${c.active ? 'acc-fg-hi' : 'text-[#69635b]'}`} strokeWidth={1.7} />
              <span className={`min-w-0 flex-1 truncate text-[10.5px] ${c.active ? 'text-[#f3efe8]' : 'text-[#b3aca2]'}`}>{c.name}</span>
              <span className="shrink-0 text-[9px] tabular-nums text-[#5d5850]">{c.count}</span>
            </div>
          ))}
        </div>

        {/* presets */}
        <div className="mt-3">
          <SectionLabel>Develop Presets</SectionLabel>
          <div className="space-y-px">
            {PRESETS.map((p) => (
              <div key={p.name} className={`flex items-center gap-1.5 rounded-[5px] px-1.5 py-[5px] ${p.ai ? 'acc-b10' : ''}`}>
                {p.ai
                  ? <Sparkles className="h-3 w-3 shrink-0 acc-fg-hi" strokeWidth={1.8} />
                  : <span className="grid h-3 w-3 shrink-0 place-items-center text-[#5d5850]"><Grid3x3 className="h-2.5 w-2.5" strokeWidth={1.7} /></span>}
                <span className={`min-w-0 flex-1 truncate text-[10.5px] ${p.ai ? 'text-[#f3efe8]' : 'text-[#b3aca2]'}`}>{p.name}</span>
                {p.ai && <span className="rounded-[3px] acc-b20 px-1 text-[8px] font-bold uppercase acc-fg-hi">AI</span>}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── loupe viewport ── */}
      <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#08080a] p-4">
        <div className="relative aspect-[3/2] w-full max-w-[420px] overflow-hidden rounded-[3px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
          {/* before | after split — left half is the flat RAW, right half developed */}
          <Photo flat />
          <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}><Photo /></div>
          {/* split handle */}
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70" />
          <span className="absolute left-1/2 top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-black/40 backdrop-blur-sm">
            <Maximize2 className="h-2.5 w-2.5 rotate-45 text-white/85" />
          </span>
          <span className="absolute left-2 top-2 rounded-[3px] bg-black/45 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-[0.1em] text-white/70">Before</span>
          <span className="absolute right-2 top-2 rounded-[3px] bg-black/45 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-[0.1em] text-white/70">After</span>

          {/* AI sky mask overlay (accent), on the developed half */}
          <div className="absolute left-1/2 right-0 top-0 h-[52%]" style={{ background: 'rgb(var(--acc) / 0.22)', maskImage: 'linear-gradient(180deg,#000 60%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 60%,transparent)' }} />
          <span className="absolute left-1/2 right-0 top-[52%] border-t border-dashed acc-bd" />
        </div>

        {/* AI mask toast */}
        <Reveal y={6}>
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-[6px] border acc-bd30 acc-b12 px-2 py-1 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full acc-b motion-safe:animate-pulse" />
            <span className="text-[9.5px] font-medium acc-fg-hi">Sky masked · on-device</span>
          </div>
        </Reveal>
        {/* zoom / fit readout */}
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-[5px] border border-white/[0.07] bg-black/50 px-2 py-1 text-[9.5px] tabular-nums text-[#8f887e]">Fit</div>
      </section>

      {/* ── develop panel (right) ── */}
      <aside className="hidden w-[204px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#0a0a0c] px-2.5 py-2 md:flex">
        {/* histogram */}
        <div className="relative mb-1 h-12 overflow-hidden rounded-[4px] border border-white/[0.06] bg-[#0b0b0d]">
          <div className="absolute inset-0" style={{ clipPath: 'polygon(0 100%,4% 74%,9% 82%,15% 52%,21% 64%,28% 30%,35% 46%,43% 20%,50% 36%,58% 16%,66% 42%,73% 26%,81% 54%,88% 40%,94% 68%,100% 58%,100% 100%)', background: 'linear-gradient(180deg,rgba(243,239,232,0.32),rgba(243,239,232,0.05))' }} />
          <div className="absolute inset-0" style={{ clipPath: 'polygon(46% 100%,52% 40%,58% 20%,64% 48%,70% 34%,76% 60%,82% 100%)', background: 'linear-gradient(180deg,rgb(var(--acc) / 0.5),transparent)' }} />
        </div>
        <div className="mb-2 flex items-center justify-between text-[9px] tabular-nums text-[#5d5850]">
          <span>ISO 100</span><span>f/8</span><span>1/250</span><span>24MP</span>
        </div>

        {/* Basic */}
        <SectionLabel>Basic</SectionLabel>
        <div className="space-y-[7px] pb-1">
          <Slider label="Temp" val="+12" pos={24} />
          <Slider label="Tint" val="-4" pos={-8} />
          <div className="my-1 h-px bg-white/[0.05]" />
          <Slider label="Exposure" val="+0.35" pos={14} />
          <Slider label="Contrast" val="+22" pos={22} />
          <Slider label="Highlights" val="-48" pos={-48} />
          <Slider label="Shadows" val="+36" pos={36} />
        </div>

        {/* Masking */}
        <div className="mt-2">
          <SectionLabel>Masking</SectionLabel>
          <div className="flex gap-1.5 pb-1.5">
            <span className="flex items-center gap-1 rounded-[5px] border acc-bd30 acc-b12 px-1.5 py-1 text-[9px] font-medium acc-fg-hi"><Wand2 className="h-2.5 w-2.5" strokeWidth={1.8} />Subject</span>
            <span className="flex items-center gap-1 rounded-[5px] border acc-bd30 acc-b12 px-1.5 py-1 text-[9px] font-medium acc-fg-hi"><Sparkles className="h-2.5 w-2.5" strokeWidth={1.8} />Sky</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-[5px] acc-b10 px-1.5 py-[5px]">
            <span className="h-4 w-4 shrink-0 rounded-[3px] border border-white/[0.12]" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 30%, rgb(var(--acc)) 0%, rgb(var(--acc) / 0.35) 45%, #000 66%)' }} />
            <span className="min-w-0 flex-1 truncate text-[10px] text-[#f3efe8]">Sky — AI</span>
            <Check className="h-3 w-3 shrink-0" style={{ color: V }} />
            <span className="shrink-0 text-[9px] tabular-nums text-[#5d5850]">92%</span>
          </div>
        </div>
      </aside>
    </div>

    {/* ── culling filmstrip ── */}
    <div className="flex items-center gap-1.5 overflow-hidden border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-2">
      {STRIP.map((s, i) => (
        <div key={i} className={`relative aspect-[3/2] h-[38px] shrink-0 overflow-hidden rounded-[3px] ${s.active ? 'ring-[1.5px] ring-offset-1 ring-offset-[#0a0a0c] acc-bd' : 'border border-white/[0.07]'} ${s.reject ? 'opacity-40' : ''}`}
          style={s.active ? { boxShadow: '0 0 0 1.5px rgb(var(--acc))' } : undefined}>
          <div className="absolute inset-0" style={{ background: s.g }} />
          {s.pick && <Flag className="absolute left-0.5 top-0.5 h-2.5 w-2.5" style={{ color: V, fill: V }} strokeWidth={1.5} />}
          {s.reject && <span className="absolute left-1 top-0.5 text-[9px] font-bold text-white/70">✕</span>}
          {i === 0 && (
            <span className="absolute bottom-0.5 left-0.5 flex gap-px">
              {[0, 1, 2, 3, 4].map((n) => <Star key={n} className="h-2 w-2" style={n < 4 ? { color: '#e7e2d9', fill: '#e7e2d9' } : { color: '#4f4a44' }} strokeWidth={1.5} />)}
            </span>
          )}
        </div>
      ))}
    </div>

    {/* status bar */}
    <div className="flex items-center gap-3 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[9px] tabular-nums text-[#5d5850]">
      <span className="flex items-center gap-1"><Aperture className="h-2.5 w-2.5" strokeWidth={1.7} />RAW · NEF</span>
      <span>6000 × 4000</span>
      <span className="hidden sm:inline">ProPhoto RGB</span>
      <span className="hidden sm:flex items-center gap-1"><Crop className="h-2.5 w-2.5" strokeWidth={1.7} />3:2</span>
      <span className="ml-auto flex items-center gap-1 acc-fg-hi"><Sparkles className="h-2.5 w-2.5" strokeWidth={1.8} />AI cull · 248 picks / 1,204</span>
    </div>
  </div>
);

export default PhotoDevelop;
