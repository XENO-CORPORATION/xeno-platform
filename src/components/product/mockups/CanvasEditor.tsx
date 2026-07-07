import React from 'react';
import {
  Frame as FrameIcon, Type, Square, Component as ComponentIcon, ChevronDown, ChevronRight,
  Eye, Lock, Plus, MousePointer2, Hand, PenTool, Minus, Circle, Hexagon,
  Image as ImageIcon, MessageSquare, Share2, Users,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Canvas editor mockup — the hero's "representative content"
 * (NN/g: the hero visual must show the real product). Recreates the actual
 * three-pane Figma-language shell from xeno-canvas/src/renderer/src (MenuBar +
 * Pages/Layers + canvas viewport + Properties/Dev-handoff), built in the
 * landing-v3 language: near-black panels (#0d0d0f / #0a0a0c), hairline borders,
 * off-white text. ALL accent color routes through rgb(var(--acc)) / .acc-* so
 * the theme switch recolors it — selection, presence, token binding, active
 * tool. Pure JSX/Tailwind so it stays crisp and weightless. */

const V = 'rgb(var(--acc))';

function Presence({ init, color }: { init: string; color: string }) {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-[#0a0a0c] text-[9px] font-semibold text-white/90" style={{ background: color }}>
      {init}
    </span>
  );
}

/* A single layers-panel row */
function Layer({ icon, name, depth = 0, selected, expandable, expanded }: {
  icon: React.ReactNode; name: string; depth?: number; selected?: boolean; expandable?: boolean; expanded?: boolean;
}) {
  return (
    <div
      className={`flex h-[22px] items-center gap-1 rounded-[3px] pr-1.5 ${selected ? 'acc-b10' : ''}`}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="grid h-3 w-3 place-items-center text-[#5d5850]">
        {expandable ? (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
      </span>
      <span className="shrink-0" style={{ color: selected ? V : '#69635b' }}>{icon}</span>
      <span className={`flex-1 truncate text-[10.5px] ${selected ? 'acc-fg-hi' : 'text-[#b3aca2]'}`}>{name}</span>
      {selected && <Lock size={9} className="text-[#5d5850] opacity-50" />}
      <Eye size={9} className="text-[#5d5850] opacity-50" />
    </div>
  );
}

/* Remote-cursor tag (multiplayer presence) */
function Cursor({ x, y, name, color, dim }: { x: number; y: number; name: string; color: string; dim?: boolean }) {
  return (
    <div className="pointer-events-none absolute z-20" style={{ left: x, top: y }}>
      <MousePointer2 className="h-3.5 w-3.5 drop-shadow" style={{ color, fill: color }} strokeWidth={1} />
      <span className="ml-2.5 -mt-1 inline-block rounded-[4px] px-1.5 py-[1px] text-[8.5px] font-semibold text-white" style={{ background: color, opacity: dim ? 0.9 : 1 }}>{name}</span>
    </div>
  );
}

function ToolBtn({ children, active, ghost }: { children: React.ReactNode; active?: boolean; ghost?: boolean }) {
  return (
    <span className={`grid h-7 w-7 place-items-center rounded-[5px] ${active ? 'acc-b16 acc-fg-hi' : ghost ? 'text-[#3a3a3d]' : 'text-[#9a9aa2]'}`}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[46px] shrink-0 text-[9px] uppercase tracking-[0.06em] text-[#5d5850]">{label}</span>
      {children}
    </div>
  );
}
function NumBox({ k, v, suffix }: { k: string; v: string; suffix?: string }) {
  return (
    <span className="flex h-6 flex-1 items-center gap-1 rounded-[3px] border border-white/[0.06] bg-white/[0.02] px-1.5">
      <span className="text-[9px] text-[#5d5850]">{k}</span>
      <span className="ml-auto text-[10.5px] tabular-nums text-[#cdc7be]">{v}{suffix}</span>
    </span>
  );
}

const CanvasEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[880px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── titlebar ── */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-3 hidden font-medium text-[10.5px] text-[#cdc7be] sm:inline">XENO Canvas</span>
      <span className="hidden text-[10.5px] text-[#5d5850] sm:inline">— Checkout.xcanvas</span>
      <div className="ml-auto flex items-center gap-2.5">
        <span className="flex items-center -space-x-1.5">
          <Presence init="AM" color="linear-gradient(135deg,#b8688f,#6d3f63)" />
          <Presence init="KO" color="linear-gradient(135deg,#5fa088,#2f5d4c)" />
          <Presence init="JD" color="linear-gradient(135deg,#5b7fb0,#33486b)" />
        </span>
        <button className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[10.5px] font-semibold text-white" style={{ background: V }}>
          <Share2 className="h-3 w-3" /> Share
        </button>
      </div>
    </div>

    {/* ── menu strip ── */}
    <div className="flex items-center gap-3.5 border-b border-white/[0.05] bg-[#0d0d0f] px-3.5 py-1.5 text-[10px] text-[#827b71]">
      <span className="font-semibold text-[#cdc7be]">◆</span>
      {['File', 'Edit', 'Object', 'View', 'Arrange'].map((m) => <span key={m}>{m}</span>)}
      <span className="ml-auto flex items-center gap-1 text-[9.5px] acc-fg-hi"><Users className="h-3 w-3" /> 3 editing</span>
    </div>

    <div className="flex h-[clamp(392px,54vh,468px)] text-left">
      {/* ── left rail: Pages + Layers ── */}
      <aside className="hidden w-[168px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        {/* pages */}
        <div className="border-b border-white/[0.05] px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5d5850]">Pages</span>
            <Plus className="h-3 w-3 text-[#5d5850]" />
          </div>
          <div className="flex h-[22px] items-center gap-1.5 rounded-[3px] acc-b10 px-2 text-[10.5px] acc-fg-hi">Checkout flow</div>
          <div className="flex h-[22px] items-center gap-1.5 rounded-[3px] px-2 text-[10.5px] text-[#827b71]">Components</div>
        </div>
        {/* layers */}
        <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
          <span className="text-[10px] font-semibold text-[#cdc7be]">Layers</span>
          <span className="h-2.5 w-px bg-white/10" />
          <span className="truncate text-[9.5px] text-[#69635b]">Checkout flow</span>
        </div>
        <div className="flex-1 space-y-px overflow-hidden px-1.5 pt-1">
          <Layer icon={<FrameIcon size={11} strokeWidth={1.5} />} name="Sign up" expandable expanded />
          <Layer icon={<Type size={11} strokeWidth={1.5} />} name="Create account" depth={1} />
          <Layer icon={<Square size={11} strokeWidth={1.5} />} name="Email field" depth={1} />
          <Layer icon={<Square size={11} strokeWidth={1.5} />} name="Password field" depth={1} />
          <Layer icon={<ComponentIcon size={11} strokeWidth={1.5} />} name="Button / Primary" depth={1} selected />
          <Layer icon={<ComponentIcon size={11} strokeWidth={1.5} />} name="Buttons" expandable />
        </div>
      </aside>

      {/* ── center: canvas ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <span className="text-[10.5px] font-semibold text-[#cdc7be]">Canvas</span>
          <span className="h-2.5 w-px bg-white/10" />
          <span className="text-[10px] text-[#69635b]">Checkout</span>
          <span className="ml-auto text-[9.5px] tabular-nums text-[#69635b]">100%</span>
        </header>

        {/* viewport */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{ background: 'radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)', backgroundSize: '18px 18px', backgroundColor: '#0b0b0d' }}
        >
          <Reveal y={10}>
            <div className="absolute left-[clamp(24px,7%,72px)] top-[34px]">
              {/* frame name tag */}
              <div className="mb-1.5 flex items-center gap-1 text-[9.5px]" style={{ color: V }}>
                <FrameIcon size={9} /> <span className="text-[#8a847b]">Sign up · 288×372</span>
              </div>
              {/* the frame */}
              <div className="w-[228px] rounded-[10px] border border-white/[0.09] bg-[#141416] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)]">
                <div className="text-[13px] font-semibold text-[#f3efe8]">Create account</div>
                <div className="mt-1 text-[9.5px] text-[#69635b]">Start your 14-day trial</div>
                <div className="mt-3 h-8 rounded-[6px] border border-white/[0.07] bg-white/[0.02]" />
                <div className="mt-2 h-8 rounded-[6px] border border-white/[0.07] bg-white/[0.02]" />
                {/* the selected button */}
                <div className="relative mt-3">
                  <div className="grid h-9 place-items-center rounded-[7px] text-[11px] font-semibold text-white" style={{ background: V }}>Get started</div>
                  {/* selection handles */}
                  <span className="pointer-events-none absolute -inset-[3px] rounded-[8px]" style={{ boxShadow: `0 0 0 1.5px ${V}` }} />
                  {[['-left-[3px] -top-[3px]', ''], ['-right-[3px] -top-[3px]', ''], ['-left-[3px] -bottom-[3px]', ''], ['-right-[3px] -bottom-[3px]', '']].map(([pos], i) => (
                    <span key={i} className={`pointer-events-none absolute h-1.5 w-1.5 rounded-[1px] border bg-[#0d0d0f] ${pos}`} style={{ borderColor: V }} />
                  ))}
                  {/* auto-layout spacing badge */}
                  <span className="pointer-events-none absolute -top-[15px] left-1/2 -translate-x-1/2 rounded-[3px] px-1 text-[8px] font-semibold text-white" style={{ background: V }}>12</span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* multiplayer cursors */}
          <Cursor x={188} y={120} name="Amara" color={V} />
          <Cursor x={96} y={232} name="Ken" color="#3fbf7f" dim />

          {/* floating toolbar */}
          <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[8px] border border-white/[0.08] bg-[#161618] px-1 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            <ToolBtn active><MousePointer2 className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn><Hand className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <ToolBtn><FrameIcon className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <ToolBtn><Square className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn><Circle className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn><Minus className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn ghost><Hexagon className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <ToolBtn><PenTool className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn><Type className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <ToolBtn ghost><ImageIcon className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <ToolBtn><MessageSquare className="h-4 w-4" strokeWidth={1.5} /></ToolBtn>
          </div>
        </div>
      </section>

      {/* ── right rail: Properties / Dev handoff ── */}
      <aside className="hidden w-[196px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] md:flex">
        {/* tabs */}
        <div className="flex border-b border-white/[0.06] text-[9px] font-medium uppercase tracking-[0.08em]">
          <span className="relative flex-1 py-2 text-center text-[#e7e2d9]">
            Properties
            <span className="absolute inset-x-3 bottom-0 h-[1.5px]" style={{ background: V }} />
          </span>
          <span className="flex-1 py-2 text-center text-[#69635b]">Actions</span>
          <span className="flex-1 py-2 text-center text-[#69635b]">Tokens</span>
        </div>

        <div className="flex-1 space-y-1.5 overflow-hidden p-1.5">
          {/* inspector */}
          <div className="rounded-[4px] border border-white/[0.06] bg-white/[0.015]">
            <div className="border-b border-white/[0.05] px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[#827b71]">Inspector</div>
            <div className="space-y-1.5 p-2">
              <div className="flex items-center gap-2"><span className="w-[46px] text-[9.5px] text-[#69635b]">Type</span><span className="text-[10.5px] text-[#cdc7be]">instance</span></div>
              <Row label="Position"><NumBox k="X" v="24" /><NumBox k="Y" v="232" /></Row>
              <Row label="Size"><NumBox k="W" v="288" /><NumBox k="H" v="48" /></Row>
              <Row label="Opacity"><NumBox k="●" v="100" suffix="%" /></Row>
              {/* variant */}
              <Row label="Variant">
                <span className="flex h-6 flex-1 items-center justify-between rounded-[3px] border border-white/[0.06] bg-white/[0.02] px-1.5 text-[10px] text-[#cdc7be]">Primary <ChevronDown className="h-3 w-3 text-[#5d5850]" /></span>
              </Row>
              {/* fill bound to token */}
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-[#5d5850]">Fill</div>
                <div className="flex items-center gap-1.5">
                  <span className="h-5 w-5 shrink-0 rounded-[3px] border acc-bd" style={{ background: V }} />
                  <span className="flex h-5 flex-1 items-center rounded-[3px] acc-b12 px-1.5 text-[10px] font-medium acc-fg-hi">brand/500</span>
                </div>
              </div>
            </div>
          </div>

          {/* auto layout (child) */}
          <div className="rounded-[4px] border border-white/[0.06] bg-white/[0.015]">
            <div className="border-b border-white/[0.05] px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[#827b71]">Auto Layout</div>
            <div className="space-y-1.5 p-2">
              <div className="text-[9.5px] text-[#69635b]">In an auto-layout frame.</div>
              <div className="flex gap-1">
                <span className="rounded-[3px] acc-b16 px-2 py-1 text-[9.5px] acc-fg-hi">Fill</span>
                <span className="rounded-[3px] border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9.5px] text-[#b3aca2]">Absolute</span>
              </div>
            </div>
          </div>

          {/* dev handoff */}
          <div className="rounded-[4px] border border-white/[0.06] bg-white/[0.015]">
            <div className="border-b border-white/[0.05] px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[#827b71]">Inspect / Dev handoff</div>
            <div className="space-y-1.5 p-2">
              <div className="flex items-center gap-1">
                <span className="rounded-[3px] acc-b16 px-2 py-0.5 text-[9.5px] acc-fg-hi">CSS</span>
                <span className="rounded-[3px] border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[9.5px] text-[#b3aca2]">Tailwind</span>
                <span className="ml-auto rounded-[3px] px-2 py-0.5 text-[9.5px] font-semibold text-white" style={{ background: V }}>Copy</span>
              </div>
              <pre className="overflow-hidden rounded-[3px] border border-white/[0.06] bg-black/40 p-1.5 font-mono text-[8.5px] leading-[1.55] text-[#aaa39a]">{`.button-primary {
  display: flex;
  padding: 12px 20px;
  background: var(--brand-500);
  border-radius: 8px;
}`}</pre>
            </div>
          </div>
        </div>
      </aside>
    </div>

    {/* ── status bar ── */}
    <div className="flex items-center gap-4 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[9px] tabular-nums text-[#5d5850]">
      <span>2 pages</span>
      <span>18 nodes</span>
      <span>1 selected</span>
      <span className="ml-auto">100%</span>
      <span className="capitalize">move</span>
    </div>
  </div>
);

export default CanvasEditor;
