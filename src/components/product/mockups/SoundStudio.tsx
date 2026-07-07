import React from 'react';
import {
  SkipBack, Play, Square, Repeat, LayoutList, Grid3X3, Cpu,
  Plus, Power, GripVertical, Sparkles,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Sound mockup — the hero's representative content (NN/g:
 * the hero visual must be the real product). Recreates the DAW from
 * xeno-sound/src/renderer: MenuBar chrome, the Ableton/Logic-style TransportBar
 * (large BPM, transport group, Arrangement/Session toggle, BBT + sample-rate +
 * CPU), the Timeline (bar ruler, track headers with M/S + colored bars, waveform
 * & step-pattern clips), the EffectsRack (Parametric EQ / Compressor / Delay +
 * LUFS meter), and the Mixer strip (faders + stereo meters + master).
 *
 * The real app is deliberately monochromatic (white on near-black). Accent is
 * used only for the brand touch-points a DAW naturally lights up — the playhead,
 * the transport "playing" state, the selected clip, and the AI/LUFS readout —
 * all via rgb(var(--acc)) / .acc-* so the Shift+T theme switch recolors them. */

const V = 'rgb(var(--acc))';

// waveform peak arrays (0..1) — deterministic, drawn as thin bars like the canvas
const WAVE_A = [.2,.5,.8,.6,.9,.7,.4,.6,.85,.5,.3,.55,.75,.95,.6,.4,.7,.5,.3,.6,.8,.65,.45,.7,.9,.55,.35,.6,.8,.5,.7,.4,.6,.85,.5,.3,.55,.7,.5,.35];
const WAVE_B = [.3,.6,.45,.8,.55,.35,.7,.9,.5,.65,.4,.75,.6,.3,.5,.85,.6,.4,.7,.55,.35,.6,.8,.45,.65,.9,.5,.3,.55,.7,.6,.4,.75,.5,.35,.6,.8,.55,.4,.7];
const WAVE_C = [.15,.4,.65,.5,.75,.55,.3,.5,.7,.9,.6,.4,.6,.8,.5,.3,.55,.7,.45,.6,.85,.5,.35,.6,.75,.5,.3,.5,.7,.55,.4,.65,.85,.6,.4,.55,.7,.5,.35,.55];

function Wave({ peaks, tint }: { peaks: number[]; tint?: boolean }) {
  return (
    <div className="flex h-full w-full items-center gap-px overflow-hidden">
      {peaks.map((p, i) => (
        <div
          key={i}
          className="w-full shrink-0 rounded-[0.5px]"
          style={{ height: `${Math.max(8, p * 82)}%`, background: tint ? 'rgb(var(--acc) / 0.55)' : 'rgba(255,255,255,0.16)' }}
        />
      ))}
    </div>
  );
}

/* a pattern/step clip — the dotted step-sequencer viz drawn on pattern tracks */
function StepClip() {
  const rows = 4, cols = 16;
  const on = new Set([0, 4, 8, 12, 2, 6, 10, 19, 25, 33, 45, 50, 58, 3, 7, 11]);
  return (
    <div className="grid h-full w-full content-center gap-[2px] px-1 py-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows * cols }).map((_, i) => (
        <div key={i} className="h-[3px] rounded-[1px]" style={{ background: on.has(i) ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.05)' }} />
      ))}
    </div>
  );
}

type Track = { name: string; color: string; db: string; kind: 'wave' | 'steps'; peaks?: number[]; label?: string; left: string; width: string; sel?: boolean; mute?: boolean };
const TRACKS: Track[] = [
  { name: 'Drums',    color: '#b0935b', db: '-3.2', kind: 'wave',  peaks: WAVE_A, label: 'Break 01',  left: '2%',  width: '46%' },
  { name: 'Bassline', color: '#5b7fb0', db: '-6.0', kind: 'steps', label: '808 Pattern',              left: '2%',  width: '62%' },
  { name: 'Keys',     color: '#8a7fb0', db: '-4.8', kind: 'wave',  peaks: WAVE_C, label: 'Rhodes',     left: '18%', width: '54%', sel: true },
  { name: 'Vocals',   color: '#b8688f', db: '-2.1', kind: 'wave',  peaks: WAVE_B, label: 'Lead Vox',   left: '30%', width: '44%' },
];

const FX = [
  { n: 'Parametric EQ', on: true, eq: true },
  { n: 'Compressor', on: true },
  { n: 'Stereo Delay', on: false },
];

/* a compact mixer channel strip (bottom rack) */
function Strip({ name, color, db, pan, l, r, master }: { name: string; color: string; db: string; pan: string; l: number; r: number; master?: boolean }) {
  return (
    <div className="flex w-[62px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.04] py-1.5">
      <div className="h-[2px] w-[calc(100%-8px)] rounded-full" style={{ background: master ? V : color, opacity: master ? 1 : 0.7 }} />
      <span className="w-full truncate px-1 text-center text-[8px] leading-none text-white/40">{name}</span>
      <span className="font-mono text-[7.5px] leading-none text-white/20">{pan}</span>
      {/* fader + stereo meter */}
      <div className="mt-0.5 flex items-end gap-1">
        <div className="flex gap-px">
          <div className="relative h-[46px] w-[3px] overflow-hidden rounded-[1px] bg-white/[0.04]"><div className="absolute bottom-0 w-full rounded-[1px]" style={{ height: `${l}%`, background: l > 90 ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.18)' }} /></div>
          <div className="relative h-[46px] w-[3px] overflow-hidden rounded-[1px] bg-white/[0.04]"><div className="absolute bottom-0 w-full rounded-[1px]" style={{ height: `${r}%`, background: r > 90 ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.18)' }} /></div>
        </div>
        <div className="relative h-[46px] w-[6px] rounded-[1px] bg-white/[0.04]">
          <div className="absolute bottom-0 w-full rounded-[1px]" style={{ height: `${Math.min(72, l)}%`, background: master ? 'rgb(var(--acc) / 0.35)' : 'rgba(255,255,255,0.10)' }} />
          <div className="absolute left-[-2px] w-[10px] rounded-[1px] bg-white/25" style={{ height: 8, bottom: `${Math.min(72, l)}%` }} />
        </div>
      </div>
      <span className="font-mono text-[7.5px] leading-none text-white/20">{db}</span>
      <div className="flex gap-0.5">
        <span className="grid h-[11px] w-[16px] place-items-center rounded-[2px] bg-white/[0.04] text-[7px] text-white/25">M</span>
        <span className="grid h-[11px] w-[16px] place-items-center rounded-[2px] bg-white/[0.04] text-[7px] text-white/25">S</span>
      </div>
    </div>
  );
}

const SoundStudio: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* window chrome / menu bar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 hidden font-mono text-[10.5px] text-[#5d5850] sm:inline">XENO Sound — untitled.xsound</span>
      <span className="ml-auto hidden items-center gap-3 text-[10px] text-white/25 md:flex">
        <span>File</span><span>Edit</span><span>Track</span><span>AI</span><span>View</span>
      </span>
    </div>

    {/* transport bar */}
    <div className="flex h-[42px] items-center justify-between border-b border-white/[0.06] bg-[#0e0e10] px-3">
      {/* left — BPM + time signature */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-start">
          <span className="text-[7.5px] uppercase tracking-[0.18em] leading-none text-white/20">BPM</span>
          <span className="font-mono text-[16px] leading-tight text-white/80" style={{ fontVariantNumeric: 'tabular-nums' }}>92.0</span>
        </div>
        <div className="h-6 w-px bg-white/[0.06]" />
        <div className="hidden flex-col items-start sm:flex">
          <span className="text-[7.5px] uppercase tracking-[0.18em] leading-none text-white/20">Sig</span>
          <span className="mt-0.5 font-mono text-[13px] leading-none text-white/60">4/4</span>
        </div>
      </div>

      {/* center — transport controls */}
      <div className="flex items-center gap-0.5">
        <span className="grid h-7 w-7 place-items-center rounded-[3px] text-white/40"><SkipBack className="h-4 w-4" /></span>
        <span className="grid h-7 w-7 place-items-center rounded-[3px] acc-b12 acc-bd30 border" style={{ color: V }}><Play className="h-4 w-4 fill-current" /></span>
        <span className="grid h-7 w-7 place-items-center rounded-[3px] text-white/40"><Square className="h-3.5 w-3.5" /></span>
        <span className="grid h-7 w-7 place-items-center rounded-[3px]"><span className="h-3 w-3 rounded-[2px] bg-red-400/30" /></span>
        <span className="mx-1 h-5 w-px bg-white/[0.06]" />
        <span className="rounded-[3px] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/20">Punch</span>
        <span className="grid h-7 w-7 place-items-center rounded-[3px] text-white/25"><Repeat className="h-3.5 w-3.5" /></span>
        <span className="mx-1 hidden h-5 w-px bg-white/[0.06] sm:block" />
        {/* Arrangement / Session toggle */}
        <div className="hidden items-center rounded-[4px] bg-white/[0.02] sm:flex">
          <span className="grid h-7 w-7 place-items-center rounded-[3px] bg-white/[0.08] text-white/60"><LayoutList className="h-3.5 w-3.5" /></span>
          <span className="grid h-7 w-7 place-items-center rounded-[3px] text-white/20"><Grid3X3 className="h-3.5 w-3.5" /></span>
        </div>
      </div>

      {/* right — BBT + rate + CPU */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 rounded-[4px] bg-white/[0.02] px-2 py-1">
          <span className="text-[7.5px] uppercase tracking-widest leading-none text-white/15">BBT</span>
          <span className="font-mono text-[13px] leading-none text-white/75" style={{ fontVariantNumeric: 'tabular-nums' }}>9. 1. 1</span>
        </div>
        <span className="hidden font-mono text-[9px] text-white/15 lg:inline">48k/24b</span>
        <span className="hidden items-center gap-1.5 lg:flex">
          <Cpu className="h-3 w-3 text-white/20" strokeWidth={1.5} />
          <span className="h-[6px] w-[30px] overflow-hidden rounded-[1px] bg-white/[0.04]"><span className="block h-full bg-white/15" style={{ width: '22%' }} /></span>
          <span className="font-mono text-[9px] text-white/20">9%</span>
        </span>
      </div>
    </div>

    {/* main area — timeline + effects rack */}
    <div className="flex h-[clamp(196px,26vh,238px)]">
      {/* timeline */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#0c0c0e]">
        {/* bar ruler */}
        <div className="flex h-[22px] shrink-0 border-b border-white/[0.06]">
          <div className="w-[132px] shrink-0 border-r border-white/[0.05] bg-[#0f0f12]" />
          <div className="relative flex flex-1 items-end bg-[#111114] pb-1">
            {['1', '5', '9', '13', '17', '21'].map((b, i) => (
              <span key={b} className="absolute font-mono text-[9px] text-white/30" style={{ left: `${i * 18 + 1}%` }}>{b}</span>
            ))}
          </div>
        </div>

        {/* track rows */}
        <div className="relative flex-1">
          {TRACKS.map((t, i) => (
            <Reveal key={t.name} y={6} delay={i * 55}>
              <div className="flex h-[48px] border-b border-white/[0.04]">
                {/* header */}
                <div className="relative flex w-[132px] shrink-0 flex-col justify-center border-r border-white/[0.05] bg-[#101014] pl-3 pr-2">
                  <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: t.color, opacity: 0.8 }} />
                  <span className="truncate text-[11px] text-white/55">{t.name}</span>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="grid h-[13px] w-[17px] place-items-center rounded-[2px] bg-white/[0.04] text-[7.5px] text-white/25">M</span>
                    <span className="grid h-[13px] w-[17px] place-items-center rounded-[2px] bg-white/[0.04] text-[7.5px] text-white/25">S</span>
                    <span className="ml-auto font-mono text-[8px] text-white/20">{t.db}</span>
                  </div>
                </div>
                {/* lane */}
                <div className="relative flex-1" style={{ background: i % 2 === 0 ? '#0d0d10' : '#0e0e12' }}>
                  <div
                    className={`absolute top-[5px] bottom-[5px] overflow-hidden rounded-[3px] border ${t.sel ? 'acc-bd40' : 'border-white/[0.08]'}`}
                    style={{ left: t.left, width: t.width, background: t.sel ? 'rgb(var(--acc) / 0.06)' : 'rgba(255,255,255,0.04)' }}
                  >
                    <div className="flex items-center gap-1 px-1.5 pt-0.5">
                      <span className={`truncate text-[8.5px] ${t.sel ? 'acc-fg-hi' : 'text-white/45'}`}>{t.label}</span>
                    </div>
                    <div className="absolute inset-x-1 bottom-1 top-[13px]">
                      {t.kind === 'wave' ? <Wave peaks={t.peaks!} tint={t.sel} /> : <StepClip />}
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
          {/* playhead */}
          <div className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: 'calc(132px + 34%)', background: 'rgb(var(--acc) / 0.9)' }}>
            <span className="absolute -left-[3px] top-0 h-[6px] w-[7px] rounded-b-[2px]" style={{ background: V }} />
          </div>
        </div>
      </div>

      {/* effects rack + LUFS meter */}
      <aside className="hidden w-[176px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] md:flex">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <span className="text-[9.5px] uppercase tracking-wider text-white/40">Effects</span>
          <span className="text-[9.5px] text-white/20">Keys</span>
        </div>
        <div className="flex-1 space-y-1 p-2">
          {FX.map((f, i) => (
            <div key={f.n} className="rounded-[3px] bg-white/[0.02]">
              <div className="flex items-center gap-1 px-1.5 py-1">
                <span className="w-2.5 text-center font-mono text-[8px] text-white/15">{i + 1}</span>
                <GripVertical className="h-3 w-3 text-white/10" />
                <span className="h-3 w-[3px] rounded-[1px]" style={{ background: f.on ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.05)' }} />
                <span className={`flex-1 truncate text-[10px] ${f.on ? 'text-white/50' : 'text-white/20 line-through'}`}>{f.n}</span>
                <Power className={`h-3 w-3 ${f.on ? 'text-white/35' : 'text-white/12'}`} />
              </div>
              {f.eq && (
                <div className="px-2 pb-1.5">
                  <svg viewBox="0 0 100 24" className="h-6 w-full">
                    <path d="M0,14 C14,13 20,6 30,7 C40,8 46,18 58,16 C70,14 78,5 88,8 C94,9.5 100,12 100,12" fill="none" stroke="rgb(var(--acc) / 0.5)" strokeWidth="1.2" />
                    <line x1="0" y1="12" x2="100" y2="12" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
                  </svg>
                </div>
              )}
            </div>
          ))}
          <button className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-white/[0.04] py-1.5 text-[10px] text-white/30">
            <Plus className="h-3 w-3" />Add Effect
          </button>
        </div>
        {/* AI master / LUFS readout */}
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" style={{ color: V }} />
            <span className="text-[9.5px] uppercase tracking-wider" style={{ color: V }}>AI Master</span>
            <span className="ml-auto font-mono text-[9px] text-white/30">-14 LUFS</span>
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[8.5px] text-white/25">
            <span>Integrated</span><span className="text-white/45">-14.2</span>
          </div>
          <div className="mt-1 h-[5px] overflow-hidden rounded-[1px] bg-white/[0.04]">
            <span className="block h-full" style={{ width: '78%', background: 'rgb(var(--acc) / 0.5)' }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[8.5px] text-white/25">
            <span>True Peak</span><span className="text-white/45">-1.0 dB</span>
          </div>
        </div>
      </aside>
    </div>

    {/* mixer strip */}
    <div className="flex h-[92px] items-stretch overflow-hidden border-t border-white/[0.06] bg-[#0c0c0e]">
      <Strip name="Drums" color="#b0935b" db="-3.2" pan="C" l={72} r={68} />
      <Strip name="Bass" color="#5b7fb0" db="-6.0" pan="L12" l={54} r={50} />
      <Strip name="Keys" color="#8a7fb0" db="-4.8" pan="R18" l={61} r={66} />
      <Strip name="Vocals" color="#b8688f" db="-2.1" pan="C" l={88} r={84} />
      <Strip name="FX Bus" color="#5fa088" db="-8.4" pan="C" l={38} r={41} />
      <div className="my-2 w-px shrink-0 bg-white/[0.08]" />
      <Strip name="Master" color="#8a847b" db="-0.4" pan="C" l={94} r={92} master />
    </div>
  </div>
);

export default SoundStudio;
