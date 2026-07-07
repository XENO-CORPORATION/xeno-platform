import React from 'react';
import {
  MousePointer2, Scissors, GripHorizontal, Move, Hand, ZoomIn, Magnet,
  Play, SkipBack, SkipForward, Diamond, Sparkles, Maximize2, ChevronDown,
  Volume2, Eye, Lock, Plus, Search,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Motion editor mockup — the hero's "representative content"
 * (NN/g: the hero visual must be the real product). Recreates the Dockview
 * workspace from xeno-motion/src/renderer: MenuBar, Program Monitor + transport,
 * the Inspector (Transform + Color), and the multi-track PixiJS timeline (tool rail,
 * ruler, V/A tracks, clips with waveforms, a cross-dissolve, keyframes, playhead).
 * Landing-v3 language: near-black panels, hairline borders, off-white text.
 * The accent (playhead, active tool, keyframes, Export, AI) flows through
 * rgb(var(--acc)) / .acc-* so the theme switch recolors it. Clip colors
 * (video=blue / audio=green / graphics=rose / image=gold) are fixed product
 * semantics, like a code editor's syntax colors. */

const V = 'rgb(var(--acc))';

/* fixed clip semantics — never the theme accent */
const CLIP = {
  video: { bar: '#5f82b5', bg: 'rgba(95,130,181,0.16)', wave: 'rgba(130,170,230,0.5)' },
  audio: { bar: '#5aa87a', bg: 'rgba(90,168,122,0.15)', wave: 'rgba(120,214,164,0.55)' },
  gfx: { bar: '#b06a86', bg: 'rgba(176,106,134,0.17)' },
  image: { bar: '#b0985a', bg: 'rgba(176,152,90,0.15)' },
};

const MENUS = ['File', 'Edit', 'Clip', 'Sequence', 'Effects', 'AI', 'View', 'Window'];
const TOOLS = [
  { I: MousePointer2, on: true }, { I: Scissors }, { I: GripHorizontal },
  { I: Move }, { I: Hand }, { I: ZoomIn },
];

/* ── timeline geometry (percent of the track lane) ── */
function Clip({ l, w, kind, label, sel, wave, dissolveR }: {
  l: number; w: number; kind: keyof typeof CLIP; label: string;
  sel?: boolean; wave?: boolean; dissolveR?: boolean;
}) {
  const c = CLIP[kind];
  return (
    <div
      className={`absolute top-[3px] bottom-[3px] overflow-hidden rounded-[4px] ${sel ? 'acc-bd' : 'border-black/40'}`}
      style={{ left: `${l}%`, width: `${w}%`, background: c.bg, borderWidth: 1, boxShadow: sel ? `0 0 0 1px ${V}` : undefined }}
    >
      <div className="h-[3px] w-full" style={{ background: c.bar }} />
      <div className="flex items-center gap-1 px-1.5 pt-[3px]">
        <span className="truncate text-[8.5px] font-medium text-[#d8d2ca]/85">{label}</span>
      </div>
      {wave && (
        <svg className="absolute inset-x-0 bottom-0 h-[52%] w-full" preserveAspectRatio="none" viewBox="0 0 100 24">
          <path
            d="M0 12 L3 8 L6 15 L9 5 L12 17 L15 9 L18 13 L21 4 L24 18 L27 10 L30 14 L33 6 L36 16 L39 8 L42 13 L45 5 L48 17 L51 9 L54 14 L57 7 L60 15 L63 10 L66 13 L69 6 L72 16 L75 9 L78 14 L81 5 L84 17 L87 10 L90 13 L93 8 L96 15 L99 11"
            fill="none" stroke={c.wave} strokeWidth="1.1"
          />
        </svg>
      )}
      {dissolveR && (
        <div className="absolute inset-y-0 right-0 w-[14px]" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.14))' }}>
          <div className="absolute right-0 top-0 h-full w-px bg-white/20" />
        </div>
      )}
    </div>
  );
}

function TrackHead({ label, kind }: { label: string; kind: 'V' | 'A' }) {
  return (
    <div className="flex h-full items-center justify-between px-2">
      <span className="text-[9px] font-semibold tracking-wide text-[#8a847b]">{label}</span>
      <span className="flex items-center gap-1 text-[#5d5850]">
        {kind === 'A' ? <Volume2 className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
        <Lock className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}

const MotionEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[780px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar + menu */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] font-semibold text-[#e7e2d9]">XENO Motion</span>
      <span className="hidden text-[10px] text-[#5d5850] sm:inline">— brand-launch.xmotion</span>
      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1 rounded-[5px] border border-white/[0.08] px-2 py-[3px] text-[9.5px] text-[#aaa39a] md:inline-flex">Editing <ChevronDown className="h-2.5 w-2.5" /></span>
        <button className="rounded-[5px] px-2.5 py-[4px] text-[9.5px] font-semibold text-white" style={{ background: V }}>Export</button>
      </div>
    </div>
    <div className="hidden items-center gap-3.5 border-b border-white/[0.05] bg-[#0a0a0c] px-3.5 py-1.5 sm:flex">
      {MENUS.map((m) => (
        <span key={m} className={`text-[10px] ${m === 'AI' ? 'acc-fg-hi font-medium' : 'text-[#827b71]'}`}>{m}</span>
      ))}
    </div>

    <div className="flex h-[clamp(420px,58vh,520px)] flex-col text-left">
      {/* ── top row: media bin · program monitor · inspector ── */}
      <div className="flex min-h-0 flex-[1.05]">
        {/* media bin */}
        <aside className="hidden w-[150px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] lg:flex">
          <div className="flex items-center justify-between px-2.5 pb-1.5 pt-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">Project</span>
            <Search className="h-3 w-3 text-[#5d5850]" />
          </div>
          <div className="grid grid-cols-2 gap-1.5 px-2.5">
            {[
              'linear-gradient(135deg,#3a4a63,#20283a)',
              'linear-gradient(135deg,#5a3f4a,#2f2530)',
              'linear-gradient(135deg,#3f5a4a,#25302a)',
              'linear-gradient(135deg,#5a533f,#302c25)',
            ].map((g, i) => (
              <div key={i} className="overflow-hidden rounded-[4px] border border-white/[0.06]">
                <div className="aspect-video w-full" style={{ background: g }} />
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 px-2.5 text-[9px] text-[#69635b]">
            <div className="flex justify-between"><span className="truncate">interview_a.mov</span><span className="text-[#4f4a44]">ProRes</span></div>
            <div className="flex justify-between"><span className="truncate">broll_city.mp4</span><span className="text-[#4f4a44]">H.265</span></div>
            <div className="flex justify-between"><span className="truncate">score.wav</span><span className="text-[#4f4a44]">48k</span></div>
          </div>
        </aside>

        {/* program monitor */}
        <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">Program</span>
            <span className="text-[9px] text-[#5d5850]">3840×2160 · 24fps</span>
          </div>
          <div className="relative mx-3 flex-1 overflow-hidden rounded-[6px] border border-white/[0.07]">
            {/* "video frame" — pure CSS, implies footage + a motion-graphics lower third */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 32% 26%, #6a5238 0%, #2c2536 46%, #10121c 100%)' }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,transparent 55%,rgba(0,0,0,0.55))' }} />
            {/* subject silhouette */}
            <div className="absolute bottom-0 left-1/2 h-[62%] w-[34%] -translate-x-1/2 rounded-t-[40px]" style={{ background: 'linear-gradient(180deg,#2a2330,#161320)' }} />
            {/* lower-third title (motion graphics) */}
            <div className="absolute bottom-[16%] left-[8%]">
              <div className="h-[3px] w-9 rounded-full" style={{ background: V }} />
              <div className="mt-1.5 text-[12px] font-semibold leading-none text-white">Maya Okonkwo</div>
              <div className="mt-1 text-[8.5px] tracking-wide text-white/60">FOUNDER · NORTHWIND</div>
            </div>
            {/* safe-frame + fullscreen */}
            <Maximize2 className="absolute right-2 top-2 h-3 w-3 text-white/40" />
          </div>
          {/* transport */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-mono text-[10px] tabular-nums" style={{ color: V }}>00:00:12:04</span>
            <div className="flex items-center gap-3 text-[#aaa39a]">
              <SkipBack className="h-3.5 w-3.5" />
              <span className="grid h-6 w-6 place-items-center rounded-full text-black" style={{ background: '#e7e2d9' }}><Play className="h-3 w-3 translate-x-[0.5px]" /></span>
              <SkipForward className="h-3.5 w-3.5" />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-[#5d5850]">00:01:38:00</span>
          </div>
        </section>

        {/* inspector */}
        <aside className="hidden w-[168px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] md:flex">
          <div className="px-3 pb-1.5 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">Inspector</div>
          <div className="space-y-2.5 px-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-medium text-[#cdc7be]"><Diamond className="h-2.5 w-2.5" style={{ color: V }} /> Transform</div>
              {[['Position', '960 · 540'], ['Scale', '108%'], ['Rotation', '0.0°']].map(([k, val], i) => (
                <div key={k} className="flex items-center justify-between py-[3px] text-[9px]">
                  <span className="text-[#827b71]">{k}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono tabular-nums text-[#aaa39a]">{val}</span>
                    <Diamond className="h-2 w-2" style={{ color: i === 0 ? V : '#4f4a44' }} />
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-white/[0.05] pt-2">
              <div className="mb-1 text-[9.5px] font-medium text-[#cdc7be]">Color</div>
              {[['Temperature', 62], ['Contrast', 44], ['Saturation', 58]].map(([k, val]) => (
                <div key={k as string} className="py-[3px]">
                  <div className="flex justify-between text-[8.5px]"><span className="text-[#827b71]">{k}</span><span className="font-mono text-[#69635b]">{val}</span></div>
                  <div className="mt-1 h-[3px] rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full" style={{ width: `${val}%`, background: V }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── timeline ── */}
      <Reveal y={10} className="flex min-h-0 flex-1 flex-col border-t border-white/[0.07] bg-[#0a0a0c]">
        {/* tool rail */}
        <div className="flex items-center gap-1 border-b border-white/[0.05] px-2 py-1.5">
          {TOOLS.map(({ I, on }, i) => (
            <span key={i} className={`grid h-5 w-5 place-items-center rounded-[4px] ${on ? 'acc-b16 acc-fg-hi' : 'text-[#69635b]'}`}>
              <I className="h-3 w-3" />
            </span>
          ))}
          <span className="mx-1 h-3.5 w-px bg-white/10" />
          <span className="grid h-5 w-5 place-items-center rounded-[4px] acc-fg-hi acc-b10"><Magnet className="h-3 w-3" /></span>
          <span className="ml-auto flex items-center gap-1 rounded-[4px] acc-b10 px-1.5 py-0.5 text-[8.5px] font-medium acc-fg-hi"><Sparkles className="h-2.5 w-2.5" /> Auto-reframe</span>
        </div>

        {/* ruler */}
        <div className="flex shrink-0">
          <div className="w-[128px] shrink-0 border-r border-white/[0.06]" />
          <div className="relative h-4 flex-1">
            {['00:00', '00:05', '00:10', '00:15', '00:20', '00:25'].map((t, i) => (
              <span key={t} className="absolute top-0.5 font-mono text-[7.5px] text-[#5d5850]" style={{ left: `${i * 18 + 1}%` }}>{t}</span>
            ))}
            {/* playhead head */}
            <div className="absolute top-0 h-full" style={{ left: '38%' }}>
              <div className="h-2.5 w-2.5 -translate-x-1/2 rounded-b-[3px]" style={{ background: V }} />
            </div>
          </div>
        </div>

        {/* tracks */}
        <div className="relative min-h-0 flex-1">
          {/* playhead line spanning tracks */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px" style={{ left: 'calc(128px + (100% - 128px) * 0.38)', background: V }} />
          {([
            { head: <TrackHead label="V2" kind="V" />, clips: <Clip l={30} w={26} kind="gfx" label="Lower Third" /> },
            { head: <TrackHead label="V1" kind="V" />, clips: <><Clip l={2} w={34} kind="video" label="interview_a" dissolveR /><Clip l={36} w={40} kind="video" label="broll_city" sel /><Clip l={76} w={20} kind="image" label="logo.png" /></> },
            { head: <TrackHead label="A1" kind="A" />, clips: <Clip l={2} w={74} kind="audio" label="dialogue" wave /> },
            { head: <TrackHead label="A2" kind="A" />, clips: <Clip l={10} w={86} kind="audio" label="score.wav" wave /> },
          ]).map((tr, i) => (
            <div key={i} className="flex min-h-0 border-b border-white/[0.04] last:border-0" style={{ height: '25%' }}>
              <div className="w-[128px] shrink-0 border-r border-white/[0.06] bg-[#0c0c0e]">{tr.head}</div>
              <div className="relative flex-1">{tr.clips}</div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>

    {/* status bar */}
    <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[8.5px] text-[#5d5850]">
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1"><Plus className="h-2.5 w-2.5" /> 3 clips selected</span>
        <span>·</span><span>WebGPU</span><span>·</span><span>NVENC ready</span>
      </span>
      <span className="flex items-center gap-2"><span className="acc-fg-hi">Render cache 100%</span><span>·</span><span>Proxy · ALL-Intra</span></span>
    </div>
  </div>
);

export default MotionEditor;
