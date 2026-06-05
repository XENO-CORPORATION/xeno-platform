import React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, Box, ChevronDown, ChevronsRight, Code2, Sparkles, Grid3x3, GitBranch, Image as ImageIcon,
  Layers, Maximize2, MessageSquare, Mic2, Monitor, Music2, Play, Plus, SendHorizontal, Settings2, ShieldCheck, SkipBack, SkipForward,
  Sliders, Subtitles, Terminal, Type as TypeIcon, Video, Volume2, X,
} from 'lucide-react';

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function Panel({
  label,
  icon: Icon,
  children,
  className = '',
  trailing,
  collapsed = false,
  redirectTo,
  redirectLabel,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
  className?: string;
  trailing?: React.ReactNode;
  collapsed?: boolean;
  /** If provided, replaces the close-X with a redirect arrow that links here. Auth-gated routes resolve in-app. */
  redirectTo?: string;
  redirectLabel?: string;
}) {
  return (
    <div className={`group/panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[8px] border border-white/[0.07] bg-[#0f0f0f] transition-colors duration-200 ease-out hover:border-white/[0.22] ${className}`}>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.05] px-4">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#948d83]">
          {Icon ? <Icon className="h-3 w-3 text-[#a760ff]" /> : <span className="h-1.5 w-1.5 rounded-[2px] bg-[#a760ff]" />}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2 text-[#5d5850]">
          {trailing}
          {redirectTo ? (
            <Link
              to={redirectTo}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={redirectLabel ?? `Open ${label}`}
              className="grid h-5 w-5 place-items-center rounded-[4px] text-[#756f66] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : collapsed ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </div>
      </div>
      {children}
    </div>
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
          ? 'border border-[#9f6fff]/45 bg-[#1a1029]/60 text-[#c8a8ff] shadow-[0_0_24px_rgba(141,98,255,0.20)]'
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
  { title: '1000 free credits', sub: 'Start building immediately, no payment required', icon: Sparkles },
];

/* ──────────────────────────────────────────────────────────────────────
 * Hero
 * ────────────────────────────────────────────────────────────────────── */

const HeroSection: React.FC = () => {
  return (
    <section className="relative isolate flex h-[100svh] min-h-[760px] flex-col overflow-hidden bg-[#060606] px-[0.6vw] pb-[0.6vw] pt-[56px] text-white">
      <div className="flex h-full w-full flex-col gap-[0.6vw]">
        {/* ─────────────────────────────────────────────────────────
         * Single row: sidebar | content card | (dashboard + features stacked)
         * ───────────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 gap-[0.6vw]">
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
              <div className="h-8 w-8 rounded-[7px] bg-[radial-gradient(circle_at_30%_30%,rgba(190,150,255,0.85),rgba(70,40,150,0.55)_55%,rgba(0,0,0,0.95))] shadow-[inset_0_0_10px_rgba(141,98,255,0.35)]" />
              <button className="grid h-6 w-6 place-items-center text-[#69635b] hover:text-[#aaa39a]">
                <ChevronsRight className="h-3 w-3" />
              </button>
            </div>
          </aside>

          {/* ─── Left content card (floating container) ───────── */}
          <section className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#151515] px-[2vw] pt-[clamp(28px,3.6vh,56px)] md:w-[clamp(360px,26vw,460px)] md:shrink-0">
            {/* Background image — smaller, anchored toward the bottom */}
            <img
              src="/landing-v3/xeno-hero-content-bg.png"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] w-full object-cover object-center opacity-90"
            />
            {/* Top fade so headline sits readably over the dark sky portion */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#151515_0%,#151515_18%,rgba(8,8,11,0.55)_36%,transparent_58%,transparent_75%,rgba(8,8,11,0.55)_94%)]" />
            <div className="relative z-10">
              <h1
                className="text-[clamp(2.6rem,3.6vw,5rem)] leading-[1.04] tracking-[0.02em] text-white"
                style={{ fontFamily: "'Moneta', 'Cormorant Garamond', 'Playfair Display', Georgia, serif", fontWeight: 400 }}
              >
                Where humans imagine,<br />AI builds.
              </h1>
              <div className="mt-[clamp(14px,2vh,28px)] flex items-center gap-2">
                <span className="h-px w-[20%] min-w-[60px] bg-gradient-to-r from-white/40 via-[#a760ff]/40 to-transparent" />
                <span className="h-1.5 w-1.5 rounded-[2px] bg-[#a760ff]" />
              </div>
              <p className="mt-[clamp(14px,2vh,28px)] max-w-[320px] text-[clamp(12.5px,0.95vw,15px)] leading-[1.6] text-[#948d83]">
                The complete AI workspace for creation, code, media, workflows, and intelligent agents.
              </p>
              <div className="mt-[clamp(18px,2.6vh,32px)] flex flex-col gap-2.5">
                <a
                  href="/auth"
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

          {/* ─── Right column: dashboard + bottom feature strip ─ */}
          <div className="flex h-full flex-1 flex-col gap-[0.6vw]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#151515]">
            {/* project bar */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
              <div className="flex items-center gap-3">
                <Box className="h-4 w-4 text-[#948d83]" />
                <div className="flex h-7 items-center gap-2 rounded-[6px] border border-white/[0.08] bg-white/[0.02] px-3">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[#756f66]">PROJECT</span>
                  <span className="text-[12px] text-[#d8d2ca]">XENO Command Center</span>
                  <ChevronDown className="h-3 w-3 text-[#756f66]" />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[#807970]">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-[2px] bg-[#a760ff]" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em]">AI Mode</span>
                  <ChevronDown className="h-3 w-3" />
                </div>
                <Sliders className="h-3.5 w-3.5" />
                <Settings2 className="h-3.5 w-3.5" />
                <Maximize2 className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Dashboard panel grid */}
            <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-3 gap-[0.6vw] p-[0.6vw]">
              {/* AI CHAT */}
              <Panel label="AI Chat" className="col-span-3 row-span-3" redirectTo="/overview" redirectLabel="Open AI Chat workspace">
                <div className="flex h-full flex-col gap-3 p-4">
                  <div className="self-end max-w-[80%] rounded-[10px] border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-[12px] leading-snug text-[#d8d2ca]">
                    Create a product launch plan with roadmap and marketing strategy.
                  </div>
                  <div className="self-start max-w-[80%] rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[12px] leading-snug text-[#aaa39a]">
                    Here's a complete plan with roadmap, milestones, and go-to-market strategy.
                  </div>
                  <div className="flex items-center gap-2.5 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="grid h-7 w-7 place-items-center rounded-[5px] bg-white/[0.05]">
                      <ImageIcon className="h-3.5 w-3.5 text-[#948d83]" />
                    </div>
                    <div className="leading-tight">
                      <div className="text-[11.5px] text-[#d8d2ca]">launch-plan.md</div>
                      <div className="text-[10px] text-[#756f66]">42.3 KB</div>
                    </div>
                  </div>
                  <label className="group/input mt-auto flex cursor-text items-center gap-2 rounded-[6px] border border-white/[0.07] bg-white/[0.02] pl-3 pr-1.5 py-2 transition-colors duration-150 ease-out hover:border-white/[0.16] hover:bg-white/[0.035]">
                    <input
                      type="text"
                      placeholder="Ask anything…"
                      className="flex-1 min-w-0 bg-transparent text-[12px] text-[#e6e1d9] placeholder:text-[#69635b] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      aria-label="Send message"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] bg-white/10 text-[#cdc7be] transition-colors hover:bg-white/15 hover:text-white active:bg-white/20"
                    >
                      <SendHorizontal className="h-4 w-4" />
                    </button>
                  </label>
                </div>
              </Panel>

              {/* IMAGE GENERATION */}
              <Panel label="Image Generation" className="col-span-4 row-span-2">
                <div className="flex h-full flex-col gap-2 p-3">
                  <div className="relative h-[58%] overflow-hidden rounded-[8px] bg-[radial-gradient(circle_at_50%_55%,rgba(178,139,255,0.42),transparent_42%),linear-gradient(180deg,#0a0814,#000_70%)]">
                    <div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-[#a760ff]/40 shadow-[0_0_60px_rgba(167,96,255,0.45),inset_0_0_40px_rgba(167,96,255,0.18)]" />
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.65))]" />
                  </div>
                  <div className="flex items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <span className="flex-1 truncate text-[11.5px] text-[#948d83]">futuristic landscape, monolithic portal, cinematic, ultra-detailed</span>
                    <button className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#9f6fff]/45 bg-[#1a1029]/40 px-3 py-1 text-[11px] font-medium text-[#bf85ff]">
                      <Sparkles className="h-3 w-3" />
                      Generate
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[0.4, 0.55, 1, 0.45].map((opacity, i) => (
                      <div
                        key={i}
                        className={`aspect-square rounded-[6px] border ${
                          opacity === 1 ? 'border-[#a760ff]/60' : 'border-white/[0.06]'
                        } bg-[radial-gradient(circle_at_50%_55%,rgba(167,96,255,${opacity * 0.35}),transparent_50%),#0a0810]`}
                      />
                    ))}
                  </div>
                </div>
              </Panel>

              {/* SDK / API */}
              <Panel label="SDK / API" className="col-span-3 row-span-2">
                <div className="flex h-full flex-col p-3">
                  <div className="flex items-center gap-4 border-b border-white/[0.05] pb-2 text-[11px] font-medium">
                    <span className="text-[#bf85ff]">REST</span>
                    <span className="text-[#756f66]">Python</span>
                    <span className="text-[#756f66]">JS</span>
                    <span className="text-[#756f66]">cURL</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px]">
                    <span className="rounded-[4px] bg-[#1a1029]/60 px-1.5 py-0.5 font-semibold text-[#bf85ff]">POST</span>
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
                  <button className="mt-3 inline-flex h-7 items-center gap-2 rounded-[5px] bg-white/10 px-3 text-[11px] font-medium text-[#d8d2ca] hover:bg-white/15">
                    Send Request
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </Panel>

              {/* MEDIA STUDIO */}
              <Panel label="Media Studio" className="col-span-2 row-span-3">
                <div className="flex h-full flex-col p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1.5 text-[#69635b]">
                      <Box className="h-3.5 w-3.5" />
                      <TypeIcon className="h-3.5 w-3.5" />
                      <Music2 className="h-3.5 w-3.5" />
                      <Grid3x3 className="h-3.5 w-3.5" />
                    </div>
                    <div className="relative flex-1 overflow-hidden rounded-[8px] bg-[radial-gradient(circle_at_50%_50%,rgba(178,139,255,0.45),transparent_45%),linear-gradient(180deg,#0a0814,#000_70%)]">
                      <div className="absolute left-1/2 top-1/2 h-[60%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-[#a760ff]/40 shadow-[0_0_50px_rgba(167,96,255,0.35),inset_0_0_30px_rgba(167,96,255,0.18)]" />
                      <div className="absolute inset-0 grid place-items-center">
                        <button className="grid h-9 w-9 place-items-center rounded-[8px] bg-white/15 backdrop-blur-md">
                          <Play className="h-3.5 w-3.5 fill-white text-white" />
                        </button>
                      </div>
                      <div className="absolute bottom-1.5 right-2 font-mono text-[10px] text-[#9e978d]">00:12 / 01:08</div>
                    </div>
                  </div>
                  <div className="my-2 flex items-center justify-center gap-3 text-[#948d83]">
                    <SkipBack className="h-3.5 w-3.5" />
                    <Play className="h-3.5 w-3.5" />
                    <SkipForward className="h-3.5 w-3.5" />
                  </div>
                  <div className="space-y-1.5 overflow-y-auto text-[10.5px]">
                    {[
                      { icon: Video, label: 'Video' },
                      { icon: Sparkles, label: 'AI Clips' },
                      { icon: Music2, label: 'Music' },
                      { icon: Mic2, label: 'Voiceover' },
                      { icon: Volume2, label: 'SFX' },
                      { icon: Subtitles, label: 'Captions' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <item.icon className="h-3 w-3 text-[#69635b]" />
                        <span className="w-14 text-[#948d83]">{item.label}</span>
                        <div className="flex h-3 flex-1 items-center gap-px overflow-hidden rounded-[2px] bg-white/[0.03]">
                          {Array.from({ length: 24 }).map((_, j) => (
                            <span
                              key={j}
                              className="block w-1 bg-[#a760ff]/60"
                              style={{ height: `${20 + Math.sin(j * 0.7) * 60 + 30}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* CODE / CLI */}
              <Panel label="Code / CLI" className="col-span-3 row-span-2">
                <pre className="h-full overflow-hidden p-4 font-mono text-[11px] leading-[1.65] text-[#b6afa5]">
{`$ xeno run workflow.launch
> Initializing...
> Connecting to AI models
> Building roadmap
> Generating assets
> Launch plan ready ✓

xeno@workspace ~ % `}<span className="inline-block h-2.5 w-1.5 -mb-0.5 bg-white/65 align-middle" />
                </pre>
              </Panel>

              {/* VISUAL WORKFLOW */}
              <Panel label="Visual Workflow" className="col-span-4 row-span-2" trailing={<><Play className="h-3 w-3" /><Plus className="h-3 w-3" /></>}>
                <div className="grid h-full grid-cols-4 grid-rows-2 gap-x-2 gap-y-3 p-4">
                  {[
                    { title: 'Idea', sub: 'Input', col: 'col-start-1 row-start-1' },
                    { title: 'Research Agent', sub: 'gpt-4o', col: 'col-start-2 row-start-1' },
                    { title: 'Content Plan', sub: 'Claude 3.5', col: 'col-start-3 row-start-1' },
                    { title: 'Create Assets', sub: 'Flux Pro', col: 'col-start-4 row-start-1' },
                    { title: 'Review & Edit', sub: 'Human', col: 'col-start-2 row-start-2' },
                    { title: 'Publish', sub: 'Channels', col: 'col-start-3 row-start-2' },
                  ].map((node) => (
                    <div key={node.title} className={`${node.col} flex flex-col justify-center rounded-[6px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5`}>
                      <div className="text-[10.5px] font-medium text-[#d8d2ca] leading-tight">{node.title}</div>
                      <div className="text-[9px] text-[#756f66] leading-tight">{node.sub}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* SHELL */}
              <Panel label="Shell" className="col-span-3 row-span-1" collapsed>
                <pre className="h-full overflow-hidden p-3 font-mono text-[10.5px] leading-[1.6] text-[#aaa39a]">
{`$ xeno models list
✓ xeno-pro      latest
✓ xeno-vision   latest
✓ xeno-code     latest
✓ xeno-audio    latest
$ `}
                </pre>
              </Panel>

              {/* COMMS */}
              <Panel label="Comms" className="col-span-3 row-span-1" collapsed>
                <div className="space-y-1.5 p-3 text-[11px] text-[#aaa39a]">
                  {[
                    { name: 'product-team', count: 12 },
                    { name: 'dev-updates', count: 8 },
                    { name: 'ai-agents', count: 6 },
                    { name: 'design-review', count: 4 },
                  ].map((c) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <span className="font-mono"># {c.name}</span>
                      <span className="text-[#756f66] tabular-nums">{c.count}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          {/* ─── Feature strip (nested inside right column, under dashboard) ─── */}
          <div className="shrink-0 rounded-[10px] border border-white/[0.07] bg-[#151515]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {dashboardFeatures.map((f, i) => (
                <div
                  key={f.title}
                  className={`flex items-center gap-[0.6vw] px-[1.2vw] py-[1.2vh] ${i > 0 ? 'lg:border-l lg:border-white/[0.06]' : ''}`}
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
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
