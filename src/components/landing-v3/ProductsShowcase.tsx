import React, { useState } from 'react';
import {
  ArrowUpRight, AudioLines, Box, Building2, ChevronDown, Cpu, FileText, Gamepad2,
  Image as ImageIcon, MessageSquare, Play, Sparkles, Terminal, Video, Workflow,
} from 'lucide-react';
import { Reveal, SectionHeading, T, cx } from './primitives';

type Kind =
  | 'gen' | 'image' | 'video' | 'audio' | 'threed' | 'cad'
  | 'game' | 'docs' | 'flow' | 'comms' | 'cli' | 'runtime';

interface Product {
  name: string;
  short: string;
  long: string;
  tags: string[];
  icon: React.ComponentType<{ className?: string }>;
  kind: Kind;
  tint: string;
}

/* 3 columns. The first item in each column is the flagship (expanded by default);
   the rest collapse/expand within that same column. */
const columns: Product[][] = [
  [
    { name: 'XENO Gen', short: 'Generate anything', tags: ['Image', 'Video', 'Audio'], icon: Sparkles, kind: 'gen',
      long: 'Generate images, video, voice and music from a single prompt — then switch between 20+ frontier models, blend references, and upscale to production quality, all on one canvas.',
      tint: 'radial-gradient(ellipse at 30% 30%, rgba(170,140,255,0.22), transparent 60%), linear-gradient(160deg,#1a1428,#0a0a0a 75%)' },
    { name: 'XENO Sound', short: 'Music, voice & sound', tags: ['Music', 'Voice', 'SFX'], icon: AudioLines, kind: 'audio',
      long: 'A complete AI-native DAW: compose music, design sound, and generate or clone voices — with mastering, stem separation and text-to-audio built in.',
      tint: 'radial-gradient(ellipse at 40% 55%, rgba(140,170,255,0.18), transparent 60%), linear-gradient(160deg,#11142a,#0a0a0a 72%)' },
    { name: 'XENO 3D', short: 'Modeling & rendering', tags: ['Model', 'Render', 'Texture'], icon: Box, kind: 'threed',
      long: 'Model, sculpt and render in 3D with AI assists — generate meshes and textures from prompts, auto-retopologize, and export to any engine.',
      tint: 'radial-gradient(ellipse at 50% 45%, rgba(190,170,255,0.18), transparent 60%), linear-gradient(160deg,#16142a,#0a0a0a 72%)' },
    { name: 'XENO Engine', short: 'AI-native game engine', tags: ['ECS', 'WebGPU', 'Physics'], icon: Gamepad2, kind: 'game',
      long: 'Build real-time interactive worlds with ECS, WebGPU and physics — and let agents generate scenes, materials and gameplay logic for you.',
      tint: 'radial-gradient(ellipse at 50% 55%, rgba(255,160,110,0.14), transparent 60%), linear-gradient(160deg,#1d1610,#0a0a0a 72%)' },
  ],
  [
    { name: 'XENO Pixel', short: 'AI image editing', tags: ['Edit', 'Compose', 'Upscale'], icon: ImageIcon, kind: 'image',
      long: 'A full AI-native image editor with layers, masking and compositing — use generative fill and one-click upscaling, or just describe the edit and let the agent do it.',
      tint: 'radial-gradient(ellipse at 60% 45%, rgba(180,90,255,0.20), transparent 60%), linear-gradient(160deg,#1d1334,#0a0a0a 72%)' },
    { name: 'XENO Architect', short: 'CAD, BIM & design', tags: ['CAD', 'BIM', 'Render'], icon: Building2, kind: 'cad',
      long: 'Parametric CAD and BIM for buildings and spaces — generate floor plans from a brief, run code checks, and produce photoreal renders in minutes.',
      tint: 'radial-gradient(ellipse at 55% 50%, rgba(120,140,200,0.18), transparent 60%), linear-gradient(160deg,#0e1422,#0a0a0a 72%)' },
    { name: 'XENO Office', short: 'Docs, sheets & slides', tags: ['Docs', 'Sheets', 'Slides'], icon: FileText, kind: 'docs',
      long: 'Docs, Sheets, Slides and Notes with an agent that drafts, analyzes and designs for you — all sharing one workspace and one set of brand assets.',
      tint: 'radial-gradient(ellipse at 50% 45%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(160deg,#1a1814,#0a0a0a 72%)' },
    { name: 'XENO Comms', short: 'Human + agent messaging', tags: ['Channels', 'Threads', 'Agents'], icon: MessageSquare, kind: 'comms',
      long: 'Channels, DMs and threads for humans and agents alike — where your AI teammates are first-class members that can take action, not just chat.',
      tint: 'radial-gradient(ellipse at 40% 50%, rgba(140,200,255,0.16), transparent 60%), linear-gradient(160deg,#10182a,#0a0a0a 72%)' },
  ],
  [
    { name: 'XENO Motion', short: 'Video & motion', tags: ['Edit', 'VFX', 'Render'], icon: Video, kind: 'video',
      long: 'Cut, grade and composite video with AI in the loop — auto-reframe, generate B-roll, remove backgrounds, and render motion-graphics pipelines in the cloud.',
      tint: 'radial-gradient(ellipse at 65% 50%, rgba(255,150,210,0.16), transparent 60%), linear-gradient(160deg,#1c1422,#0a0a0a 72%)' },
    { name: 'XENO Workflow', short: 'Visual automation', tags: ['Automate', 'Agents', 'Triggers'], icon: Workflow, kind: 'flow',
      long: 'Wire apps, models and agents into visual pipelines — trigger on anything, branch on logic, and let work run itself from idea to published output.',
      tint: 'radial-gradient(ellipse at 35% 55%, rgba(140,110,255,0.20), transparent 60%), linear-gradient(160deg,#15102a,#0a0a0a 72%)' },
    { name: 'XENO Agent CLI', short: 'Terminal AI agent', tags: ['Code', 'Automate', 'Ship'], icon: Terminal, kind: 'cli',
      long: 'A terminal-native agent that reads your repo, runs commands and ships changes — automate builds, refactors and ops without leaving the command line.',
      tint: 'radial-gradient(ellipse at 50% 55%, rgba(110,255,180,0.12), transparent 60%), linear-gradient(160deg,#0d1a18,#0a0a0a 72%)' },
    { name: 'XENO RT', short: 'Local model runtime', tags: ['Local', 'Private', 'API'], icon: Cpu, kind: 'runtime',
      long: 'Run frontier LLMs and task models locally behind an OpenAI-compatible API — private, GPU-accelerated, and the same runtime that powers every XENO app.',
      tint: 'radial-gradient(ellipse at 55% 50%, rgba(180,140,255,0.18), transparent 60%), linear-gradient(160deg,#15112a,#0a0a0a 72%)' },
  ],
];

function Name({ label }: { label: string }) {
  if (label.startsWith('XENO ')) {
    return (<><span className="font-normal" style={{ color: T.label }}>XENO&nbsp;</span>{label.slice(5)}</>);
  }
  return <>{label}</>;
}

function ProductVisual({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'gen':
      return (
        <div className="absolute inset-0 flex flex-col gap-2 p-3.5">
          <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cx('rounded-[7px] border', i === 1 ? 'border-white/60 shadow-[0_0_22px_rgba(255, 255, 255,0.35)]' : 'border-white/[0.08]')}
                style={{ background: i === 1 ? 'radial-gradient(circle at 50% 45%, rgba(190,150,255,0.55), rgba(20,16,32,0.9) 70%)' : 'radial-gradient(circle at 50% 45%, rgba(255, 255, 255,0.16), rgba(12,10,18,0.92) 70%)' }} />
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-[6px] border border-white/[0.07] bg-black/30 px-2.5 py-1.5">
            <Sparkles className="h-3 w-3 shrink-0 text-white" />
            <span className="h-1 flex-1 rounded-[4px] bg-white/15" />
            <span className="rounded-[4px] bg-[#1a1029] px-2 py-0.5 text-[8.5px] font-semibold text-white">Generate</span>
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="absolute inset-0 flex gap-2 p-3.5">
          <div className="flex w-7 flex-col gap-1.5">
            {[0, 1, 2].map((i) => (<div key={i} className={cx('h-7 rounded-[5px] border', i === 0 ? 'border-white/50 bg-[#1a1029]/50' : 'border-white/[0.07] bg-white/[0.03]')} />))}
          </div>
          <div className="relative flex-1 overflow-hidden rounded-[8px] border border-white/[0.07]" style={{ background: 'radial-gradient(circle at 55% 50%, rgba(190,150,255,0.40), rgba(10,8,16,0.95) 70%)' }}>
            <div className="absolute left-1/2 top-1/2 h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-white/45 shadow-[0_0_28px_rgba(255, 255, 255,0.4)]" />
          </div>
        </div>
      );
    case 'video':
      return (
        <div className="absolute inset-0 flex flex-col gap-2 p-3.5">
          <div className="relative flex-1 overflow-hidden rounded-[7px] border border-white/[0.07]" style={{ background: 'linear-gradient(180deg, rgba(40,26,52,0.7), rgba(8,8,12,0.92))' }}>
            <div className="absolute inset-0 grid place-items-center"><div className="grid h-7 w-7 place-items-center rounded-[4px] bg-white/15 backdrop-blur-sm"><Play className="h-3 w-3 fill-white text-white" /></div></div>
          </div>
          <div className="relative space-y-1 rounded-[6px] border border-white/[0.06] bg-black/25 p-1.5">
            {[['w-1/2', 'w-1/4'], ['w-1/3', 'w-2/5'], ['w-1/5', 'w-1/3']].map((row, r) => (
              <div key={r} className="flex gap-1">{row.map((w, c) => <span key={c} className={cx('h-2 rounded-[2px]', w, c === 0 ? 'bg-white/55' : 'bg-white/12')} />)}</div>
            ))}
            <span className="pointer-events-none absolute inset-y-1 left-[42%] w-px bg-white/80" />
          </div>
        </div>
      );
    case 'audio':
      return (
        <div className="absolute inset-0 flex flex-col justify-center gap-3 p-3.5">
          <div className="flex h-1/2 items-center gap-[3px]">
            {Array.from({ length: 30 }).map((_, i) => (<span key={i} className="flex-1 rounded-[4px] bg-gradient-to-t from-[#7a4fd0]/40 to-white/90" style={{ height: `${22 + Math.abs(Math.sin(i * 0.5)) * 72}%` }} />))}
          </div>
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-white/15"><Play className="h-2.5 w-2.5 fill-white text-white" /></div>
            <span className="h-1 flex-1 overflow-hidden rounded-[4px] bg-white/12"><span className="block h-1 w-1/3 rounded-[4px] bg-white" /></span>
          </div>
        </div>
      );
    case 'threed':
      return (
        <div className="absolute inset-0 grid place-items-center p-3.5">
          <svg viewBox="0 0 100 100" className="h-[80%] w-[80%]">
            <circle cx="50" cy="50" r="33" fill="rgba(255, 255, 255,0.06)" stroke="rgba(255, 255, 255,0.5)" strokeWidth="1" />
            <ellipse cx="50" cy="50" rx="33" ry="11" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.7" />
            <ellipse cx="50" cy="50" rx="11" ry="33" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.7" />
            <ellipse cx="50" cy="50" rx="24" ry="33" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
            <rect x="48" y="48" width="4" height="4" rx="1" fill="#ffffff" />
          </svg>
        </div>
      );
    case 'cad':
      return (
        <div className="absolute inset-0 p-3.5">
          <div className="relative h-full w-full overflow-hidden rounded-[6px] border border-white/[0.07]" style={{ backgroundImage: 'linear-gradient(rgba(255, 255, 255,0.10) 1px,transparent 1px),linear-gradient(90deg,rgba(255, 255, 255,0.10) 1px,transparent 1px)', backgroundSize: '13px 13px' }}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 56" preserveAspectRatio="none">
              <path d="M12 12 H72 V36 H44 V46 H12 Z" fill="rgba(255, 255, 255,0.05)" stroke="rgba(255, 255, 255,0.85)" strokeWidth="1.1" />
              <line x1="44" y1="12" x2="44" y2="36" stroke="rgba(255,255,255,0.28)" strokeWidth="0.7" strokeDasharray="2 2" />
              <rect x="10.6" y="10.6" width="2.8" height="2.8" rx="0.7" fill="#ffffff" /><rect x="70.6" y="34.6" width="2.8" height="2.8" rx="0.7" fill="#ffffff" />
            </svg>
          </div>
        </div>
      );
    case 'game':
      return (
        <div className="absolute inset-0 flex gap-2 p-3.5">
          <div className="flex w-[34%] flex-col gap-1">
            {['Scene', 'Player', 'Terrain', 'Lights'].map((l, i) => (<div key={l} className={cx('truncate rounded-[3px] px-1.5 py-1 text-[7.5px]', i === 1 ? 'bg-[#1a1029]/60 text-white' : 'text-[#807970]')}>{i === 0 ? l : `▸ ${l}`}</div>))}
          </div>
          <div className="relative flex-1 overflow-hidden rounded-[6px] border border-white/[0.07]" style={{ background: 'radial-gradient(circle at 50% 62%, rgba(140,100,220,0.35), rgba(8,8,14,0.95) 70%)' }}>
            <svg viewBox="0 0 100 80" className="absolute inset-0 h-full w-full">
              <path d="M30 50 L50 40 L70 50 L50 60 Z" fill="none" stroke="rgba(255,160,110,0.7)" strokeWidth="1" />
              <path d="M30 50 L30 34 L50 24 L50 40 Z" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
              <path d="M70 50 L70 34 L50 24 L50 40 Z" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
            </svg>
          </div>
        </div>
      );
    case 'docs':
      return (
        <div className="absolute inset-0 p-3.5">
          <div className="flex h-full flex-col gap-2 rounded-[6px] border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="h-1.5 w-1/2 rounded-[4px] bg-white/30" />
            <div className="mt-1 space-y-1.5">{['w-full', 'w-[92%]', 'w-[78%]', 'w-full', 'w-[55%]'].map((w, i) => <div key={i} className={cx('h-1 rounded-[4px] bg-white/12', w)} />)}</div>
            <div className="mt-auto flex items-center gap-1.5"><span className="h-2.5 w-px bg-white" /><span className="h-1 w-1/4 rounded-[4px] bg-white/55" /></div>
          </div>
        </div>
      );
    case 'flow':
      return (
        <div className="absolute inset-0 flex items-center justify-center p-3.5">
          {['Input', 'Agent', 'Publish'].map((n, i) => (
            <React.Fragment key={n}>
              <div className={cx('rounded-[5px] border px-2 py-1.5 text-[8px] font-medium', i === 1 ? 'border-white/50 bg-[#1a1029]/55 text-white' : 'border-white/[0.08] bg-white/[0.02] text-[#948d83]')}>{n}</div>
              {i < 2 && <span className="mx-1.5 h-px w-5" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1.5px)', backgroundSize: '5px 1px' }} />}
            </React.Fragment>
          ))}
        </div>
      );
    case 'comms':
      return (
        <div className="absolute inset-0 flex flex-col justify-center gap-2 p-4">
          <div className="max-w-[72%] self-start rounded-[8px] rounded-bl-[2px] border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5"><div className="h-1 w-16 rounded-[4px] bg-white/25" /><div className="mt-1 h-1 w-10 rounded-[4px] bg-white/12" /></div>
          <div className="max-w-[72%] self-end rounded-[8px] rounded-br-[2px] border border-white/30 bg-[#1a1029]/55 px-2.5 py-1.5"><div className="h-1 w-20 rounded-[4px] bg-white/60" /><div className="mt-1 h-1 w-12 rounded-[4px] bg-white/30" /></div>
        </div>
      );
    case 'cli':
      return (
        <div className="absolute inset-0 p-3.5">
          <div className="flex h-full flex-col rounded-[6px] border border-white/[0.07] bg-black/45 p-2.5 font-mono text-[8.5px] leading-[1.7]">
            <span className="text-[#c2bbb2]"><span className="text-white">$</span> xeno build</span>
            <span className="text-[#807970]">→ analyzing project…</span>
            <span className="text-[#807970]">→ 3 agents dispatched</span>
            <span className="text-emerald-300/70">✓ ready in 4.2s</span>
            <span className="mt-auto flex items-center text-white">$<span className="ml-1 inline-block h-2.5 w-1 bg-white/60" /></span>
          </div>
        </div>
      );
    case 'runtime':
      return (
        <div className="absolute inset-0 p-3.5">
          <div className="flex h-full flex-col gap-1.5 rounded-[6px] border border-white/[0.07] bg-black/25 p-2.5">
            {[['xeno-pro', '98%'], ['xeno-vision', 'ready'], ['llama-3', 'ready'], ['flux-pro', 'ready']].map(([m, s], i) => (
              <div key={m} className="flex items-center gap-2 text-[8.5px]">
                <span className={cx('h-1.5 w-1.5 shrink-0 rounded-[2px]', i === 0 ? 'bg-emerald-400' : 'bg-white')} />
                <span className="font-mono text-[#c2bbb2]">{m}</span><span className="ml-auto text-[#756f66]">{s}</span>
              </div>
            ))}
            <div className="mt-auto h-1 w-full overflow-hidden rounded-[4px] bg-white/10"><span className="block h-1 w-2/3 rounded-[4px] bg-gradient-to-r from-[#7a4fd0] to-white" /></div>
          </div>
        </div>
      );
  }
}

function AccordionItem({ product, isOpen, onOpen }: { product: Product; isOpen: boolean; onOpen: () => void }) {
  const reveal = 'grid transition-[grid-template-rows] duration-[380ms] ease-[cubic-bezier(0.22,0.7,0.2,1)]';
  return (
    <div className={cx('overflow-hidden rounded-[14px] transition-colors duration-200', isOpen ? 'bg-[#161616] ring-1 ring-inset ring-white/[0.05]' : 'bg-[#0f0f0f] hover:bg-[#151515]')}>
      {/* mock — nested rounded panel inside the card, revealed when open */}
      <div className={cx(reveal, isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="px-[clamp(12px,0.9vw,16px)] pt-[clamp(12px,0.9vw,16px)]">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[10px]" style={{ background: product.tint }}>
              <ProductVisual kind={product.kind} />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_22%,transparent_78%,rgba(0,0,0,0.42))]" />
            </div>
          </div>
        </div>
      </div>

      {/* header — always visible, the click target */}
      <button type="button" onClick={onOpen} aria-expanded={isOpen}
        className="group/row flex w-full items-center gap-3 p-[clamp(13px,1vw,18px)] text-left">
        <div className={cx('grid shrink-0 place-items-center rounded-[7px] transition-all duration-300', isOpen ? 'h-6 w-6 bg-transparent text-[#c2aef0]' : 'h-9 w-9 bg-white/[0.04] text-[#9990b8] group-hover/row:text-[#c2aef0]')}>
          <product.icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h3 className="shrink-0 text-[clamp(14px,0.98vw,16px)] font-semibold tracking-tight text-[#e3ded5]"><Name label={product.name} /></h3>
            {isOpen && (
              <div className="flex min-w-0 items-center gap-2.5" style={{ animation: 'xenoRevealRight 360ms cubic-bezier(0.22,0.7,0.2,1) both' }}>
                <span className="h-3.5 w-px shrink-0 bg-white/[0.18]" />
                <span className="truncate text-[clamp(11.5px,0.8vw,13px)] text-[#9b948a]">{product.short}</span>
              </div>
            )}
          </div>
          {!isOpen && <p className="mt-0.5 truncate text-[clamp(11.5px,0.8vw,13px)] text-[#827b71]">{product.short}</p>}
        </div>
        <ChevronDown className={cx('h-[18px] w-[18px] shrink-0 transition-transform duration-300', isOpen ? 'rotate-180 text-[#9990b8]' : 'text-[#5d5850] group-hover/row:text-[#9b948a]')} />
      </button>

      {/* description — revealed below the header when open */}
      <div className={cx(reveal, isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="-mt-0.5 px-[clamp(13px,1vw,18px)] pb-[clamp(10px,0.78vw,14px)]">
            <p className="text-[clamp(12.5px,0.88vw,14.5px)] leading-[1.6] text-[#9b948a]">{product.long}</p>
            <div className="mt-[clamp(24px,2.6vw,40px)] flex flex-wrap items-center gap-2">
              {product.tags.map((t) => (<span key={t} className="rounded-[6px] bg-white/[0.05] px-2.5 py-1 text-[10.5px] font-medium tracking-wide text-[#9b948a]">{t}</span>))}
              <a href="/download" className="group/open ml-auto inline-flex items-center gap-1.5 rounded-[7px] border border-white/[0.10] bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-[#d8d2ca] transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white">
                Open <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover/open:translate-x-0.5 group-hover/open:-translate-y-0.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ProductsShowcase: React.FC = () => {
  // one open item per column; default = the flagship at the top of each column
  const [open, setOpen] = useState<string[]>(columns.map((c) => c[0].name));
  const setColumnOpen = (ci: number, name: string) =>
    setOpen((prev) => prev.map((v, i) => (i === ci ? name : v)));

  return (
    <section className="page-gutter relative bg-[#060606] pt-[clamp(80px,11vh,150px)] pb-[clamp(64px,9vh,124px)]">
      <SectionHeading
        eyebrow="The suite"
        title={<>Everything you need to create. Connected.</>}
        sub="One workspace. Every discipline. Each app shares the same AI core, file formats and agents — so your work flows seamlessly from one to the next."
      />

      <div className="mx-auto mt-[clamp(36px,5vh,64px)] grid grid-cols-1 items-start gap-[clamp(14px,1vw,20px)] md:grid-cols-2 lg:grid-cols-3">
        {columns.map((col, ci) => (
          <Reveal key={ci} delay={ci * 80} className="flex flex-col gap-[clamp(10px,0.8vw,16px)]">
            {col.map((product) => (
              <AccordionItem
                key={product.name}
                product={product}
                isOpen={open[ci] === product.name}
                onOpen={() => setColumnOpen(ci, product.name)}
              />
            ))}
          </Reveal>
        ))}
      </div>

      <Reveal delay={80} className="mx-auto mt-[clamp(40px,5vh,64px)] flex flex-col items-center gap-4 text-center">
        <p className="text-[clamp(13px,0.95vw,15px)] text-[#8a847b]">
          <span className="font-semibold text-white">29 apps.</span> One workspace. One subscription.
        </p>
        <a href="/download" className="group inline-flex items-center gap-2 rounded-[8px] border border-white/[0.12] bg-white/[0.02] px-5 py-2.5 text-[clamp(12.5px,0.9vw,14px)] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.05]">
          Explore the full platform
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </Reveal>
    </section>
  );
};

export default ProductsShowcase;
