import React, { useEffect, useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Activity, ArrowRight, ArrowUpRight, Box, Brush, Check, ChevronDown, ChevronsRight, Code2, Eye, Sparkles, Grid3x3, GitBranch, Image as ImageIcon,
  Layers, Loader2, Maximize2, MessageSquare, Mic2, Monitor, Music2, Paperclip, Pipette, Play, Plus, SendHorizontal, Settings2, ShieldCheck, SkipBack, SkipForward,
  Sliders, Star, Subtitles, Terminal, Type as TypeIcon, Video, Volume2, X,
} from 'lucide-react';

/* Lazy-loaded real apps — mounted only when a hero panel is launched */
const ChatApp = lazy(() => import('../playground/Chat/MultiChatContainer'));
const ImageApp = lazy(() => import('../playground/Generation/ImageGenerationInterface2'));
const StudioApp = lazy(() => import('../playground/Studio/ImageStudio'));

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function Panel({
  label,
  icon: Icon,
  children,
  className = '',
  trailing,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
  className?: string;
  trailing?: React.ReactNode;
  /** legacy props kept optional so existing usages don't break */
  collapsed?: boolean;
  redirectTo?: string;
  redirectLabel?: string;
}) {
  return (
    <div
      data-panel={label}
      role="button"
      tabIndex={0}
      aria-label={`Launch ${label}`}
      className={`group/panel relative flex min-h-0 min-w-0 cursor-pointer flex-col overflow-hidden rounded-[8px] border border-white/[0.07] bg-[#0f0f0f] transition-colors duration-200 ease-out hover:border-white/[0.30] hover:bg-[#141417] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${className}`}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.05] px-4">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#948d83]">
          {Icon ? <Icon className="h-3 w-3 text-[#9b948a]" /> : <span className="h-1.5 w-1.5 rounded-[2px] bg-white/40" />}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2 text-[#5d5850]">
          {trailing}
          <Maximize2 className="h-3 w-3 transition-colors group-hover/panel:text-[#cdc7be]" />
        </div>
      </div>
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Dashboard app catalog — each panel's preview mock + the customize picker
 * ────────────────────────────────────────────────────────────────────── */

/* Scripted, looping AI-chat demo: prompt arrives → thinking → reply → file → reset */
function ChatDemo() {
  const [hovered, setHovered] = useState(false);
  const [phase, setPhase] = useState(4); // resting = full conversation
  useEffect(() => {
    if (!hovered) { setPhase(4); return; }
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPhase(4); return; }
    const seq = [700, 1300, 1200, 1900, 1900]; // ask · think · reply · file+hold
    let i = 0;
    let t: number;
    const run = () => {
      setPhase(i);
      t = window.setTimeout(() => { i = (i + 1) % seq.length; run(); }, seq[i]);
    };
    run();
    return () => clearTimeout(t);
  }, [hovered]);

  const reveal = (on: boolean) => `transition-all duration-500 ease-out ${on ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'}`;
  const showUser = phase >= 1;
  const thinking = phase === 2;
  const showReply = phase >= 3;
  const showCode = phase >= 4;

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5 self-start rounded-[7px] border border-white/[0.08] bg-white/[0.03] px-2 py-1">
        <Sparkles className="h-3 w-3 text-[#cdc7be]" />
        <span className="text-[10px] font-medium text-[#d8d2ca]">claude-3.7-sonnet</span>
        <ChevronDown className="h-2.5 w-2.5 text-[#69635b]" />
      </div>
      <div className={`max-w-[80%] self-end rounded-[10px] rounded-tr-[3px] border border-white/[0.06] bg-white/[0.05] px-3 py-2 text-[12px] leading-snug text-[#d8d2ca] ${reveal(showUser)}`}>
        Create a product launch plan with roadmap and marketing strategy.
      </div>
      <div className={`flex items-center gap-1 self-start rounded-[10px] rounded-tl-[3px] border border-white/[0.06] bg-white/[0.02] px-3 py-3 ${thinking ? 'opacity-100' : 'hidden'}`}>
        {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 rounded-[2px] bg-[#aaa39a]" style={{ animation: `xenoTypingDot 1.1s ease-in-out ${d * 0.16}s infinite` }} />)}
      </div>
      <div className={`max-w-[86%] self-start rounded-[10px] rounded-tl-[3px] border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] leading-snug text-[#aaa39a] ${showReply && !thinking ? reveal(true) : 'hidden'}`}>
        Here's the full plan — roadmap, milestones and GTM:
        <span className={`mt-1.5 block rounded-[6px] border border-white/[0.07] bg-black/40 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-[#c4bdb2] transition-opacity duration-500 ${showCode ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[#807970]"># </span>Phase 1 · <span className="text-[#e3ded5]">Discovery</span> → Build → Launch
        </span>
      </div>
      <div className="mt-auto flex items-center gap-2 rounded-[6px] border border-white/[0.07] bg-white/[0.02] py-2 pl-2.5 pr-1.5">
        <Paperclip className="h-4 w-4 shrink-0 text-[#69635b]" />
        <span className="flex-1 truncate text-[12px] text-[#69635b]">Ask anything…<span className="chat-caret ml-px inline-block h-3 w-px -translate-y-px bg-[#69635b] align-middle" /></span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] bg-white/10 text-[#cdc7be]"><SendHorizontal className="h-4 w-4" /></span>
      </div>
    </div>
  );
}

/* Scripted image-gen demo (mirrors the real interface: 4-up square generation) */
function ImageDemo() {
  const [hovered, setHovered] = useState(false);
  const [phase, setPhase] = useState(2); // resting = result shown
  useEffect(() => {
    if (!hovered) { setPhase(2); return; }
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPhase(2); return; }
    const seq = [700, 1900, 2600]; // idle · generating · result+hold
    let i = 0;
    let t: number;
    const run = () => { setPhase(i); t = window.setTimeout(() => { i = (i + 1) % seq.length; run(); }, seq[i]); };
    run();
    return () => clearTimeout(t);
  }, [hovered]);
  const generating = phase === 1;
  const done = phase >= 2;
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-[6px] border border-white/[0.10] bg-white/[0.03] px-1.5 py-1 text-[10px] font-medium text-[#d8d2ca]"><Sparkles className="h-3 w-3 text-[#cdc7be]" />Flux 2 Max</span>
        <span className="ml-auto rounded-[4px] border border-white/[0.08] px-1.5 py-0.5 text-[8.5px] text-[#807970]">1:1</span>
        <span className="rounded-[4px] border border-white/[0.08] px-1.5 py-0.5 text-[8.5px] text-[#807970]">4K</span>
      </div>
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`relative overflow-hidden rounded-[7px] border bg-[#0c0c0e] transition-colors duration-500 ${done && i === 0 ? 'border-white/35' : 'border-white/[0.06]'}`}>
            <img
              src={`/landing-v3/gen/img-${i + 1}.png`}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-[800ms] ease-out"
              style={{ opacity: done ? 1 : 0, transitionDelay: `${i * 140}ms` }}
            />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_30%,transparent_75%,rgba(0,0,0,0.35))]" />
            {done && i === 0 && <div className="pointer-events-none absolute inset-0 rounded-[7px] ring-1 ring-inset ring-white/40" />}
            {done && i === 0 && <Star className="pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 fill-white/90 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
            {generating && (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-y-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.14),transparent)]" style={{ animation: `xenoScanSweep 1.15s ease-in-out ${i * 0.1}s infinite` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <span className="flex-1 truncate text-[11.5px] text-[#948d83]">mountain range at dawn, cinematic</span>
        <span className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-[11px] font-semibold transition-colors ${generating ? 'bg-white/[0.12] text-[#cdc7be]' : 'bg-white text-black'}`}>
          {generating ? <><span className="h-2.5 w-2.5 animate-spin rounded-[2px] border border-white/30 border-t-white" />Generating</> : <><Sparkles className="h-3 w-3" />Generate</>}
        </span>
      </div>
    </div>
  );
}

const MOCKS: Record<string, () => React.ReactNode> = {
  chat: () => <ChatDemo />,
  image: () => <ImageDemo />,
  video: () => (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex min-h-0 flex-1 gap-2">
        {/* settings rail */}
        <div className="flex w-[42%] flex-col gap-2">
          <div className="flex items-center gap-1.5 rounded-[7px] border border-white/[0.10] bg-white/[0.04] px-2 py-1.5">
            <Video className="h-3 w-3 text-[#cdc7be]" />
            <span className="text-[10.5px] font-medium text-[#d8d2ca]">Luma</span>
            <ChevronDown className="ml-auto h-2.5 w-2.5 text-[#69635b]" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-[7px] border border-white/[0.05] bg-white/[0.02] p-2">
            <span className="flex-1 text-[10px] leading-snug text-[#69635b]">drone shot over a neon city at night, cinematic…</span>
            <span className="mt-1 flex items-center gap-1 text-[8.5px] text-[#5d5850]"><ImageIcon className="h-2.5 w-2.5" /> add image</span>
          </div>
          <div className="flex gap-1">
            {['16:9', '9:16', '1:1'].map((a, i) => (<span key={a} className={`flex-1 rounded-[4px] border py-[3px] text-center text-[8.5px] ${i === 0 ? 'border-white/25 bg-white/[0.08] text-[#e3ded5]' : 'border-white/[0.06] text-[#807970]'}`}>{a}</span>))}
          </div>
          <div>
            <div className="flex items-center justify-between text-[8.5px]"><span className="text-[#69635b]">Duration</span><span className="text-[#9b948a]">3s</span></div>
            <span className="mt-1 block h-1 rounded-[4px] bg-white/12"><span className="block h-1 w-1/3 rounded-[4px] bg-white/55" /></span>
          </div>
          <span className="rounded-[7px] bg-white py-1.5 text-center text-[10px] font-semibold text-black">Generate Video</span>
        </div>
        {/* preview */}
        <div className="relative flex-1 overflow-hidden rounded-[8px] border border-white/[0.07]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#26262b,#0b0b0d_74%)]" />
          <div className="absolute inset-x-0 bottom-0 flex h-[42%] items-end gap-[3px] px-2.5 opacity-90">
            {[40, 72, 54, 90, 46, 78, 60, 86, 50, 70, 58].map((h, i) => (<span key={i} className="flex-1 rounded-t-[1px] bg-[#0f0f13]" style={{ height: `${h}%` }} />))}
          </div>
          <div className="absolute inset-0 grid place-items-center"><span className="grid h-10 w-10 place-items-center rounded-[4px] bg-white/15 backdrop-blur-md"><Play className="h-4 w-4 fill-white text-white" /></span></div>
          <div className="absolute bottom-1.5 right-2 font-mono text-[10px] text-[#cdc7be]">00:08</div>
          <span className="pointer-events-none absolute inset-x-2 bottom-1 block h-0.5 rounded-[4px] bg-white/15"><span className="block h-0.5 rounded-[4px] bg-white/70 motion-safe:group-hover/panel:[animation:xenoProgress_3s_ease-in-out_infinite]" style={{ width: '15%' }} /></span>
        </div>
      </div>
      {/* recent filmstrip */}
      <div className="flex shrink-0 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative aspect-video flex-1 overflow-hidden rounded-[4px] border border-white/[0.06] bg-[linear-gradient(180deg,#1c1c20,#0b0b0d)]">
            <div className="absolute inset-x-0 bottom-0 flex h-1/2 items-end gap-px px-1 opacity-70">
              {[50, 80, 60, 90, 55, 75].map((h, j) => (<span key={j} className="flex-1 bg-[#0c0c0e]" style={{ height: `${h}%` }} />))}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  audio: () => (
    <div className="flex h-full flex-col p-4">
      {/* top: model/voice pill + prompt */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1.5 rounded-[4px] border border-white/[0.10] bg-white/[0.03] px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-[#d8d2ca]" />
          <span className="text-[10px] font-medium text-[#d8d2ca]">ElevenLabs</span>
          <span className="text-[9px] text-[#69635b]">· Rachel</span>
        </div>
        <div className="max-w-full truncate text-[10.5px] text-[#69635b]">“Calm lofi piano, 90 bpm, rainy night”</div>
      </div>
      {/* middle: player fills available space */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[4px] border border-white/20 bg-white/[0.06]"><Play className="ml-0.5 h-4 w-4 fill-white text-white" /></span>
        <div className="flex h-12 w-full items-center gap-[2px]">
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} className="flex-1 origin-bottom rounded-[4px] bg-[linear-gradient(to_top,rgba(255,255,255,0.20),rgba(255,255,255,0.82))] motion-safe:group-hover/panel:[animation:xenoBarPulse_0.9s_ease-in-out_infinite]" style={{ height: `${16 + Math.abs(Math.sin(i * 0.42)) * 80}%`, animationDelay: `${i * 0.025}s` }} />
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#807970]"><span className="font-mono text-[#9b948a]">0:30</span><span>·</span><span>MP3</span></div>
      </div>
      {/* bottom: recent clips */}
      <div className="space-y-1.5 border-t border-white/[0.05] pt-2.5">
        {[{ t: 'Cinematic riser', d: '0:12' }, { t: 'Voiceover — intro', d: '0:24' }].map((r) => (
          <div key={r.t} className="flex items-center gap-2 text-[10px]">
            <Play className="h-2.5 w-2.5 shrink-0 fill-[#9b948a] text-[#9b948a]" />
            <span className="flex h-3 w-10 shrink-0 items-end gap-px">
              {Array.from({ length: 12 }).map((_, j) => (<span key={j} className="flex-1 rounded-[4px] bg-white/30" style={{ height: `${30 + Math.abs(Math.sin(j)) * 60}%` }} />))}
            </span>
            <span className="flex-1 truncate text-[#9b948a]">{r.t}</span>
            <span className="font-mono text-[#69635b]">{r.d}</span>
          </div>
        ))}
      </div>
    </div>
  ),
  studio: () => (
    <div className="flex h-full gap-2 p-3">
      {/* tool rail */}
      <div className="flex flex-col items-center gap-2.5 pt-1">
        <Brush className="h-3.5 w-3.5 text-[#e3ded5]" />
        <Box className="h-3.5 w-3.5 text-[#807970]" />
        <TypeIcon className="h-3.5 w-3.5 text-[#807970]" />
        <Pipette className="h-3.5 w-3.5 text-[#807970]" />
        <Sliders className="h-3.5 w-3.5 text-[#807970]" />
      </div>
      {/* canvas */}
      <div className="relative flex-1 overflow-hidden rounded-[7px] border border-white/[0.08]">
        <div className="absolute inset-0" style={{ background: 'repeating-conic-gradient(#17171b 0% 25%, #0c0c0e 0% 50%) 0 / 13px 13px' }} />
        <img src="/landing-v3/gen/img-1.png" alt="" aria-hidden="true" className="absolute inset-1.5 rounded-[3px] object-cover" style={{ width: 'calc(100% - 12px)', height: 'calc(100% - 12px)' }} />
        <span className="pointer-events-none absolute inset-y-1.5 left-1.5 z-10 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)] motion-safe:group-hover/panel:[animation:xenoScanSweep_1.5s_ease-in-out_infinite]" style={{ transform: 'translateX(-160%)' }} />
      </div>
      {/* layers panel */}
      <div className="flex w-[37%] flex-col gap-1">
        <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#69635b]">Layers</div>
        {[{ name: 'Subject', on: true }, { name: 'Sky', on: true }, { name: 'BG', on: false }].map((l, i) => (
          <div key={l.name} className={`flex items-center gap-1.5 rounded-[4px] border px-1.5 py-[5px] ${i === 0 ? 'border-white/20 bg-white/[0.06]' : 'border-white/[0.05] bg-white/[0.02]'}`}>
            <Eye className={`h-2.5 w-2.5 shrink-0 ${l.on ? 'text-[#cdc7be]' : 'text-[#5d5850]'}`} />
            <span className="h-4 w-5 shrink-0 rounded-[2px] bg-[linear-gradient(135deg,#2c2c32,#0c0c0e)]" />
            <span className="truncate text-[9.5px] text-[#9b948a]">{l.name}</span>
          </div>
        ))}
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[8px] text-[#69635b]">Opacity</span>
          <span className="h-1 flex-1 rounded-[4px] bg-white/12"><span className="block h-1 w-3/4 rounded-[4px] bg-white/50" /></span>
        </div>
      </div>
    </div>
  ),
  code: () => (
    <div className="flex h-full flex-col gap-[3px] overflow-hidden p-4 font-mono text-[11px] leading-[1.6] text-[#b6afa5]">
      <div className="shrink-0 truncate motion-safe:group-hover/panel:[animation:xenoMsgIn_0.4s_ease-out_both]" style={{ animationDelay: '0s' }}><span className="text-[#69635b]">$</span> <span className="text-[#e3ded5]">xeno run launch.flow</span></div>
      <div className="shrink-0 truncate motion-safe:group-hover/panel:[animation:xenoMsgIn_0.4s_ease-out_both]" style={{ animationDelay: '0.14s' }}><span className="text-[#69635b]">▸</span> <span className="text-[#cdc7be]">read_file</span> <span className="text-[#756f66]">roadmap.md</span></div>
      <div className="shrink-0 truncate motion-safe:group-hover/panel:[animation:xenoMsgIn_0.4s_ease-out_both]" style={{ animationDelay: '0.28s' }}><span className="text-[#69635b]">▸</span> <span className="text-[#cdc7be]">generate</span> <span className="text-[#756f66]">assets ×4</span></div>
      <div className="my-1 shrink-0 rounded-[6px] border border-white/[0.06] bg-black/30 px-2 py-1.5 leading-[1.7] motion-safe:group-hover/panel:[animation:xenoMsgIn_0.4s_ease-out_both]" style={{ animationDelay: '0.42s' }}>
        <div className="truncate text-[#69635b]">launch-plan.md</div>
        <div className="truncate text-[#9b948a]"><span className="text-[#5d5850]">+ </span>## Phase 1 — Discovery</div>
        <div className="truncate text-[#9b948a]"><span className="text-[#5d5850]">+ </span>## Phase 2 — Build &amp; ship</div>
      </div>
      <div className="shrink-0 truncate text-[#d8d2ca] motion-safe:group-hover/panel:[animation:xenoMsgIn_0.4s_ease-out_both]" style={{ animationDelay: '0.56s' }}><span className="text-[#69635b]">✓</span> 6 steps · 4 assets · ready</div>
      <div className="mt-auto flex shrink-0 items-center gap-1.5 pt-1.5">
        <span className="truncate text-[#69635b]">xeno@workspace ~ %</span>
        <span className="chat-caret inline-block h-3 w-1.5 shrink-0 bg-white/65" />
      </div>
    </div>
  ),
  workflow: () => (
    <div className="relative h-full overflow-hidden p-3" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.5px)', backgroundSize: '13px 13px' }}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
        {['M50 13 L50 38', 'M50 38 C42 52,26 52,26 65', 'M50 38 C58 52,74 52,74 65', 'M26 65 C26 80,42 80,50 90', 'M74 65 C74 80,58 80,50 90'].map((d, i) => (
          <path key={i} d={d} stroke="rgba(255,255,255,0.24)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="motion-safe:group-hover/panel:[animation:xenoDash_0.7s_linear_infinite]" />
        ))}
      </svg>
      {[
        { label: 'Trigger', sub: 'Schedule', icon: Activity, x: '50%', y: '13%', active: false },
        { label: 'AI Agent', sub: 'GPT-4o', icon: Sparkles, x: '50%', y: '38%', active: true },
        { label: 'Image', sub: 'Flux', icon: ImageIcon, x: '26%', y: '65%', active: false },
        { label: 'Copy', sub: 'Claude', icon: TypeIcon, x: '74%', y: '65%', active: false },
        { label: 'Publish', sub: 'Channels', icon: SendHorizontal, x: '50%', y: '90%', active: false },
      ].map((n) => (
        <div key={n.label} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: n.x, top: n.y }}>
          <div className={`relative flex items-center gap-1.5 rounded-[7px] border px-2 py-1.5 ${n.active ? 'border-white/30 bg-[#19191c]' : 'border-white/[0.12] bg-[#121214]'}`}>
            <n.icon className={`h-3 w-3 shrink-0 ${n.active ? 'text-[#e3ded5]' : 'text-[#8a847b]'}`} />
            <div className="leading-none">
              <div className={`text-[9.5px] font-medium ${n.active ? 'text-[#e3ded5]' : 'text-[#cdc7be]'}`}>{n.label}</div>
              <div className="mt-0.5 text-[8px] text-[#69635b]">{n.sub}</div>
            </div>
            {n.active && <span className="pointer-events-none absolute inset-0 rounded-[7px] motion-safe:group-hover/panel:[animation:xenoNodePulse_1.6s_ease-in-out_infinite]" />}
          </div>
        </div>
      ))}
    </div>
  ),
  comms: () => (
    <div className="flex h-full flex-col gap-2 p-3.5">
      {/* header */}
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          <span className="grid h-7 w-7 place-items-center rounded-[4px] border border-[#0f0f10] bg-white/[0.10] text-[10px] font-semibold text-[#cdc7be]">AK</span>
          <span className="grid h-7 w-7 place-items-center rounded-[4px] border border-[#0f0f10] bg-white/[0.06] text-[9px] font-semibold text-[#9b948a]">MR</span>
        </div>
        <div className="leading-tight">
          <div className="text-[11.5px] font-medium text-[#d8d2ca]"># product-team</div>
          <div className="flex items-center gap-1 text-[9.5px] text-[#69635b]"><span className="h-1.5 w-1.5 rounded-[2px] bg-[#cdc7be]" />3 online</div>
        </div>
      </div>
      {/* messages fill the available space */}
      <div className="flex flex-1 flex-col justify-center gap-2">
        <div className="max-w-[88%] self-start rounded-[8px] rounded-tl-[2px] bg-white/[0.05] px-2.5 py-1.5 text-[11px] leading-snug text-[#aaa39a] motion-safe:group-hover/panel:[animation:xenoMsgIn_0.45s_ease-out_both]" style={{ animationDelay: '0.1s' }}>
          Roadmap looks great — ship the launch plan Friday?
        </div>
        <div className="max-w-[88%] self-end rounded-[8px] rounded-tr-[2px] border border-white/[0.10] bg-white/[0.03] px-2.5 py-1.5 text-[11px] leading-snug text-[#cdc7be] motion-safe:group-hover/panel:[animation:xenoMsgIn_0.45s_ease-out_both]" style={{ animationDelay: '0.4s' }}>
          On it — drafting the timeline now.
        </div>
        <div className="flex max-w-[94%] items-start gap-1.5 self-start motion-safe:group-hover/panel:[animation:xenoMsgIn_0.45s_ease-out_both]" style={{ animationDelay: '0.7s' }}>
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border border-white/15 bg-white/[0.04]"><Sparkles className="h-2.5 w-2.5 text-[#cdc7be]" /></span>
          <div className="rounded-[8px] rounded-tl-[2px] border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[11px] leading-snug text-[#9b948a]">
            <span className="font-medium text-[#cdc7be]">Launch Agent</span> drafted 3 posts + the timeline ✓
          </div>
        </div>
      </div>
      {/* channels */}
      <div className="space-y-1 border-t border-white/[0.05] pt-2 text-[10.5px]">
        {[['dev-updates', 8], ['ai-agents', 6], ['design-review', 4]].map(([n, c]) => (
          <div key={n as string} className="flex items-center justify-between text-[#807970]">
            <span className="font-mono"># {n}</span>
            <span className="grid h-4 min-w-[16px] place-items-center rounded-[4px] bg-white/[0.08] px-1 text-[9px] font-semibold text-[#cdc7be]">{c}</span>
          </div>
        ))}
      </div>
    </div>
  ),
  sdk: () => (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center gap-4 border-b border-white/[0.05] pb-2 text-[11px] font-medium">
        <span className="text-[#e3ded5]">REST</span>
        <span className="text-[#756f66]">Python</span>
        <span className="text-[#756f66]">JS</span>
        <span className="text-[#756f66]">cURL</span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px]">
        <span className="rounded-[4px] bg-white/[0.08] px-1.5 py-0.5 font-semibold text-[#e3ded5]">POST</span>
        <span className="font-mono text-[#c2bbb2]">/v1/generate</span>
      </div>
      <pre className="mt-2 overflow-hidden rounded-[6px] border border-white/[0.05] bg-[#060606]/40 p-2.5 font-mono text-[10.5px] leading-[1.6] text-[#aaa39a]">
{`{
  "model": "xeno-pro",
  "prompt": "Design a
   futuristic command
   center",
  "stream": true
}`}
      </pre>
    </div>
  ),
  shell: () => (
    <pre className="h-full overflow-hidden p-3 font-mono text-[10.5px] leading-[1.6] text-[#aaa39a]">
{`$ xeno models list
✓ xeno-pro      latest
✓ xeno-vision   latest
✓ xeno-code     latest
✓ xeno-audio    latest
$ `}
    </pre>
  ),
};

type CatalogApp = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; trailing?: React.ReactNode };

const CATALOG: CatalogApp[] = [
  { id: 'chat', label: 'AI Chat', icon: MessageSquare },
  { id: 'image', label: 'Image Generation', icon: ImageIcon },
  { id: 'video', label: 'Video Generation', icon: Video },
  { id: 'studio', label: 'Media Studio', icon: Layers },
  { id: 'code', label: 'Code / CLI', icon: Terminal },
  { id: 'workflow', label: 'Visual Workflow', icon: GitBranch, trailing: <><Play className="h-3 w-3" /><Plus className="h-3 w-3" /></> },
  { id: 'comms', label: 'Comms', icon: Activity },
  { id: 'audio', label: 'Audio Generation', icon: Music2 },
  { id: 'sdk', label: 'SDK / API', icon: Code2 },
  { id: 'shell', label: 'Shell', icon: Monitor },
];

const DEFAULT_PANELS = ['chat', 'image', 'video', 'studio', 'code', 'workflow', 'comms', 'audio'];
const PANELS_KEY = 'xeno_hero_panels_v1';

function usePanelPrefs() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(PANELS_KEY);
      if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a.filter((x: string) => CATALOG.some((c) => c.id === x)); }
    } catch { /* ignore */ }
    return DEFAULT_PANELS;
  });
  const persist = (next: string[]) => { setIds(next); try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  const toggle = (id: string) => persist(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const reset = () => persist(DEFAULT_PANELS);
  return { ids, toggle, reset };
}

function PanelPicker({ ids, onToggle, onReset, onClose }: { ids: string[]; onToggle: (id: string) => void; onReset: () => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[40]" onClick={onClose} />
      <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[252px] rounded-[12px] border border-white/[0.10] bg-[#161616] p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#827b71]">Your panels</div>
        <div className="max-h-[300px] overflow-y-auto">
          {CATALOG.map((app) => {
            const on = ids.includes(app.id);
            return (
              <button key={app.id} type="button" onClick={() => onToggle(app.id)} className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-white/[0.05] text-[#cdc7be]"><app.icon className="h-3.5 w-3.5" /></span>
                <span className="flex-1 text-[12.5px] text-[#d8d2ca]">{app.label}</span>
                <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors ${on ? 'border-white bg-white text-black' : 'border-white/20 text-transparent'}`}><Check className="h-3 w-3" strokeWidth={3} /></span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onReset} className="mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[#948d83] transition-colors hover:bg-white/[0.04] hover:text-[#d8d2ca]">Reset to default</button>
      </div>
    </>
  );
}

function SidebarIcon({
  icon: Icon,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
}) {
  return (
    <button
      className={`grid h-8 w-8 place-items-center rounded-[7px] transition-colors ${
        active
          ? 'border border-white/20 bg-white/[0.07] text-white shadow-[0_0_22px_rgba(255,255,255,0.10)]'
          : 'text-[#807970] hover:bg-white/[0.04] hover:text-[#cdc7be]'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

const dashboardFeatures = [
  { title: '20+ AI models',    sub: 'Leading frontier models in one workspace', icon: Layers },
  { title: 'Private by design', sub: 'Your data is encrypted and never used to train', icon: ShieldCheck },
  { title: 'Local + cloud',    sub: 'Run anywhere with complete flexibility', icon: Monitor },
  { title: 'Free workspace',    sub: 'Start building immediately, no payment required', icon: Sparkles },
];

/* ──────────────────────────────────────────────────────────────────────
 * Fullscreen app launcher — click a panel, it expands to a live app
 * ────────────────────────────────────────────────────────────────────── */

type LaunchEntry = { title: string; render?: () => React.ReactNode; blurb?: string };

/* keyed by the panel's `label` so a single delegated click can resolve it */
const LAUNCH: Record<string, LaunchEntry> = {
  'AI Chat': { title: 'AI Chat', render: () => <ChatApp isStandalone /> },
  'Image Generation': { title: 'Image Generation', render: () => <ImageApp /> },
  'Media Studio': { title: 'Media Studio', render: () => <StudioApp /> },
  'Video Generation': { title: 'Video Generation', blurb: 'AI video generation is coming soon.' },
  'Audio Generation': { title: 'Audio Generation', blurb: 'AI music & voice generation is coming soon.' },
  'SDK / API': { title: 'SDK / API', blurb: 'The XENO SDK & API console is coming soon.' },
  'Code / CLI': { title: 'Code / CLI', blurb: 'The in-browser code editor and CLI are coming soon.' },
  'Visual Workflow': { title: 'Visual Workflow', blurb: 'The visual workflow builder is coming soon.' },
  'Shell': { title: 'Shell', blurb: 'The XENO shell is coming soon.' },
  'Comms': { title: 'Comms', blurb: 'XENO Comms — human + agent messaging — is coming soon.' },
};

class AppErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

function ComingSoon({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-[#0a0a0b] px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-[14px] border border-white/15 bg-white/[0.05] text-[#e3ded5]">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <div className="text-[22px] font-semibold text-white">{title}</div>
        {blurb && <p className="mx-auto mt-2.5 max-w-[400px] text-[14px] leading-relaxed text-[#948d83]">{blurb}</p>}
      </div>
      <a href="/signup" className="rounded-[8px] bg-white px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90">
        Get notified — sign up free
      </a>
    </div>
  );
}

function LaunchOverlay({ entry, rect, onClose }: { entry: LaunchEntry; rect: DOMRect; onClose: () => void }) {
  const [open, setOpen] = useState(false);

  const close = React.useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, 380);
  }, [onClose]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close]);

  const frame: React.CSSProperties = open
    ? { top: 0, left: 0, width: '100vw', height: '100dvh', borderRadius: 0 }
    : { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: 8 };

  return createPortal(
    <div className="fixed inset-0 z-[200]">
      <div
        className={`absolute inset-0 bg-black/75 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className="absolute overflow-hidden border border-white/10 bg-[#0a0a0b] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.85)] transition-all duration-[400ms] ease-[cubic-bezier(0.22,0.7,0.2,1)]"
        style={frame}
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-[20] grid h-9 w-9 place-items-center rounded-[4px] bg-black/40 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className={`h-full w-full transition-opacity duration-300 ${open ? 'opacity-100 delay-100' : 'opacity-0'}`}>
          {entry.render ? (
            <AppErrorBoundary fallback={<ComingSoon title={entry.title} blurb="This app couldn't load in preview — it's available in the full workspace." />}>
              <Suspense fallback={<div className="grid h-full w-full place-items-center bg-[#0a0a0b] text-[#948d83]"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
                {entry.render()}
              </Suspense>
            </AppErrorBoundary>
          ) : (
            <ComingSoon title={entry.title} blurb={entry.blurb} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Hero
 * ────────────────────────────────────────────────────────────────────── */

const HeroSection: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [launch, setLaunch] = useState<{ entry: LaunchEntry; rect: DOMRect } | null>(null);
  const { ids, toggle, reset } = usePanelPrefs();
  const [pickerOpen, setPickerOpen] = useState(false);
  const panels = CATALOG.filter((a) => ids.includes(a.id));

  const onPanelClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-panel]') as HTMLElement | null;
    if (!el) return;
    const entry = LAUNCH[el.getAttribute('data-panel') || ''];
    if (entry) setLaunch({ entry, rect: el.getBoundingClientRect() });
  };

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#060606] px-3 pb-3 pt-[64px] text-white md:h-[100svh] md:min-h-[760px] md:px-[0.6vw] md:pb-[0.6vw] md:pt-[56px]">
      <div className="flex h-full w-full flex-col gap-3 md:gap-[0.6vw]">
        {/* ─────────────────────────────────────────────────────────
         * Single row: sidebar | content card | (dashboard + features stacked)
         * On mobile this stacks vertically (marketing copy first, dashboard below).
         * ───────────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-[0.6vw]">
          {/* ─── Sidebar (floating container) ─────────────────── */}
          <aside className="hidden h-full w-[clamp(44px,3.2vw,60px)] shrink-0 flex-col items-center justify-between rounded-[10px] border border-white/[0.07] bg-[#151515] py-[0.8vh] md:flex">
            <div className="flex flex-col items-center gap-2">
              <SidebarIcon icon={Grid3x3} />
              <SidebarIcon icon={Box} />
              <SidebarIcon icon={GitBranch} />
              <SidebarIcon icon={Terminal} />
              <SidebarIcon icon={Code2} />
              <SidebarIcon icon={Monitor} />
              <SidebarIcon icon={MessageSquare} />
              <SidebarIcon icon={Activity} />
            </div>
            <div className="flex flex-col items-center gap-2">
              <button className="grid h-8 w-8 place-items-center rounded-[7px] border border-white/15 text-[#948d83] transition-colors hover:border-white/30 hover:text-[#d8d2ca]">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <div className="h-8 w-8 rounded-[7px] bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.85),rgba(120,120,128,0.5)_55%,rgba(0,0,0,0.95))] shadow-[inset_0_0_10px_rgba(255,255,255,0.25)]" />
              <button className="grid h-6 w-6 place-items-center text-[#69635b] hover:text-[#aaa39a]">
                <ChevronsRight className="h-3 w-3" />
              </button>
            </div>
          </aside>

          {/* ─── Left content card — marketing copy, hidden once signed in ─── */}
          {!isAuthenticated && (
          <section className="relative flex min-h-[440px] w-full flex-col justify-between overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#09090b] px-6 pb-10 pt-[clamp(28px,3.6vh,56px)] md:h-full md:min-h-0 md:w-[clamp(360px,26vw,460px)] md:shrink-0 md:px-[2vw] md:pb-0">
            {/* Background image — smaller, anchored toward the bottom */}
            <img
              src="/landing-v3/xeno-hero-content-bg.png"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] w-full object-cover object-center opacity-90"
            />
            {/* Top fade so headline sits readably over the dark sky portion */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#09090b_0%,#09090b_18%,rgba(9,9,11,0.55)_36%,transparent_58%,transparent_75%,rgba(9,9,11,0.55)_94%)]" />
            <div className="relative z-10">
              <h1
                className="text-[clamp(2.6rem,3.6vw,5rem)] leading-[1.04] tracking-[0.02em] text-white"
                style={{ fontFamily: "'Moneta', 'Cormorant Garamond', 'Playfair Display', Georgia, serif", fontWeight: 400 }}
              >
                Where humans imagine,<br />AI builds.
              </h1>
              <div className="mt-[clamp(14px,2vh,28px)] flex items-center gap-2">
                <span className="h-px w-[20%] min-w-[60px] bg-gradient-to-r from-white/50 via-white/25 to-transparent" />
                <span className="h-1.5 w-1.5 rounded-[2px] bg-white/40" />
              </div>
              <p className="mt-[clamp(14px,2vh,28px)] max-w-[320px] text-[clamp(12.5px,0.95vw,15px)] leading-[1.6] text-[#948d83]">
                The complete AI workspace for creation, code, media, workflows, and intelligent agents.
              </p>
              <div className="mt-[clamp(18px,2.6vh,32px)] flex flex-col gap-2.5">
                <a
                  href="/signup"
                  className="group inline-flex h-[clamp(44px,5vh,56px)] w-full items-center justify-center gap-2 rounded-[5px] bg-white px-5 text-[clamp(12.5px,0.9vw,15px)] font-semibold text-black transition-colors hover:bg-white/95"
                >
                  Get Started Free
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#explore"
                  className="inline-flex h-[clamp(44px,5vh,56px)] w-full items-center justify-center rounded-[5px] border border-white/[0.08] bg-[#0f0f0f] px-5 text-[clamp(12.5px,0.9vw,15px)] font-medium text-[#d8d2ca] transition-colors hover:border-white/[0.18] hover:bg-[#1c1c1c]"
                >
                  Explore XENO
                </a>
              </div>
            </div>

          </section>
          )}

          {/* ─── Right column: dashboard + bottom feature strip ─ */}
          <div className="flex flex-1 flex-col gap-3 md:h-full md:gap-[0.6vw]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#151515]">
            {/* project bar */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <Box className="h-4 w-4 shrink-0 text-[#948d83]" />
                <div className="flex h-7 min-w-0 items-center gap-2 rounded-[6px] border border-white/[0.08] bg-white/[0.02] px-3">
                  <span className="hidden text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[#756f66] sm:inline">PROJECT</span>
                  <span className="truncate text-[12px] text-[#d8d2ca]">XENO Command Center</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-[#756f66]" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[#807970]">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-[2px] bg-white/40" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em]">AI Mode</span>
                  <ChevronDown className="h-3 w-3" />
                </div>
                {isAuthenticated && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPickerOpen((v) => !v)}
                      className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.10] bg-white/[0.02] px-2.5 py-1 text-[10.5px] font-medium text-[#b6afa5] transition-colors hover:border-white/25 hover:text-white"
                    >
                      <Settings2 className="h-3 w-3" />
                      Customize
                    </button>
                    {pickerOpen && <PanelPicker ids={ids} onToggle={toggle} onReset={reset} onClose={() => setPickerOpen(false)} />}
                  </div>
                )}
                <Sliders className="hidden h-3.5 w-3.5 sm:block" />
                <Maximize2 className="hidden h-3.5 w-3.5 sm:block" />
              </div>
            </div>

            {/* Dashboard panel grid — data-driven & customizable */}
            <div onClick={onPanelClick} className="grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 md:auto-rows-fr md:gap-[0.6vw] md:p-[0.6vw]">
              {panels.map((app) => (
                <Panel key={app.id} label={app.label} icon={app.icon} trailing={app.trailing} className="col-span-12 min-h-[236px] sm:col-span-6 md:min-h-0 lg:col-span-3">
                  {MOCKS[app.id]?.()}
                </Panel>
              ))}
            </div>
          </div>

          {/* ─── Feature strip — marketing, hidden once signed in ─── */}
          {!isAuthenticated && (
          <div className="shrink-0 rounded-[10px] border border-white/[0.07] bg-[#151515]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {dashboardFeatures.map((f, i) => (
                <div
                  key={f.title}
                  className={`flex items-center gap-3.5 px-4 py-3.5 md:gap-[0.6vw] md:px-[1.2vw] md:py-[1.2vh] ${i > 0 ? 'lg:border-l lg:border-white/[0.06]' : ''}`}
                >
                  <div className="grid h-[clamp(36px,3vw,48px)] w-[clamp(36px,3vw,48px)] shrink-0 place-items-center rounded-[8px] border border-white/15 text-[#b6afa5]">
                    <f.icon className="h-[42%] w-[42%]" />
                  </div>
                  <div>
                    <div className="text-[clamp(12.5px,0.9vw,15px)] font-semibold text-white">{f.title}</div>
                    <div className="mt-0.5 max-w-[210px] text-[clamp(10.5px,0.7vw,12px)] leading-[1.45] text-[#8a847b]">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
          </div>
        </div>
      </div>

      {launch && <LaunchOverlay entry={launch.entry} rect={launch.rect} onClose={() => setLaunch(null)} />}
    </section>
  );
};

export default HeroSection;
