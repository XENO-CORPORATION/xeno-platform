import React from 'react';
import {
  MousePointer2, Move, RotateCw, Maximize2, ArrowUpFromLine, Layers, GitBranch,
  Scissors, Paintbrush, Grid3x3, Box, Camera, Sun, ChevronDown, ChevronRight,
  Play, SkipBack, SkipForward, ChevronFirst, ChevronLast, Magnet, Sparkles,
  Palette, Zap,
} from 'lucide-react';

/* Hero mockup — a faithful XENO 3D window, recreated in the landing-v3 language
 * (near-black panels, hairline borders, off-white text). Mirrors the real app in
 * ../xeno-3d/src/renderer/src: TitleBar (File/Edit/View/Add/Object/Render menus),
 * ModeSelector (Object/Edit/Sculpt tabs + shading + stats), the 36px Blender-style
 * ToolsSidebar, the wgpu Viewport3D with a selected primitive + transform gizmo,
 * the SceneOutliner + Properties panel, the Timeline transport, and the StatusBar.
 * Accent (selection glow, active tool, playhead, AI badge) routes through
 * rgb(var(--acc)) so the theme switch recolors it. The XYZ gizmo axes stay
 * red/green/blue — fixed 3D-software semantics, like a terminal's tool colors. */

const V = 'rgb(var(--acc))';
const AX = { x: '#d6564e', y: '#5fbf6a', z: '#4c8cf0' }; // gizmo axis semantics

const menus = ['File', 'Edit', 'View', 'Add', 'Object', 'Render'];
const modes = ['Object', 'Edit', 'Sculpt', 'Weight', 'Vertex', 'Texture'];
const shading = [
  { icon: <Grid3x3 size={11} strokeWidth={1.5} />, on: false },
  { icon: <Box size={11} strokeWidth={1.5} />, on: true },
  { icon: <Maximize2 size={11} strokeWidth={1.5} />, on: false },
  { icon: <Layers size={11} strokeWidth={1.5} />, on: false },
];

const toolGroups: { icon: React.ReactNode; active?: boolean }[][] = [
  [{ icon: <MousePointer2 size={14} strokeWidth={1.5} /> }],
  [
    { icon: <Move size={14} strokeWidth={1.5} />, active: true },
    { icon: <RotateCw size={14} strokeWidth={1.5} /> },
    { icon: <Maximize2 size={14} strokeWidth={1.5} /> },
  ],
  [
    { icon: <ArrowUpFromLine size={14} strokeWidth={1.5} /> },
    { icon: <Layers size={14} strokeWidth={1.5} /> },
    { icon: <GitBranch size={14} strokeWidth={1.5} /> },
    { icon: <Scissors size={14} strokeWidth={1.5} /> },
  ],
  [{ icon: <Paintbrush size={14} strokeWidth={1.5} /> }],
  [{ icon: <Grid3x3 size={14} strokeWidth={1.5} /> }],
];

const propTabs = [
  <Box size={11} strokeWidth={1.5} key="o" />,
  <Layers size={11} strokeWidth={1.5} key="m" />,
  <Palette size={11} strokeWidth={1.5} key="p" />,
  <Sparkles size={11} strokeWidth={1.5} key="s" />,
  <Zap size={11} strokeWidth={1.5} key="z" />,
];

function OutlinerRow({
  icon, name, depth = 0, selected, chevron, badge,
}: { icon: React.ReactNode; name: string; depth?: number; selected?: boolean; chevron?: boolean; badge?: string }) {
  return (
    <div
      className={`flex h-[21px] items-center gap-1.5 pr-2 ${selected ? 'acc-b10' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="w-[10px] shrink-0 text-[#5d5850]">{chevron ? <ChevronDown size={9} strokeWidth={1.5} /> : null}</span>
      <span className={selected ? 'acc-fg-hi' : 'text-[#69635b]'}>{icon}</span>
      <span className={`truncate text-[10px] ${selected ? 'text-[#f3efe8]' : 'text-[#948d83]'}`}>{name}</span>
      {badge && <span className="ml-auto rounded-[3px] border border-white/[0.08] px-1 text-[7.5px] text-[#69635b]">{badge}</span>}
    </div>
  );
}

function XYZ({ label, vals }: { label: string; vals: string[] }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-[36px] shrink-0 text-[8.5px] text-[#69635b]">{label}</span>
      {vals.map((v, i) => (
        <span key={i} className="flex-1 rounded-[2px] border border-white/[0.06] bg-white/[0.03] px-1 py-[2px] text-center text-[8.5px] tabular-nums text-[#b3aca2]">
          <span className="mr-0.5 text-[#5d5850]">{['X', 'Y', 'Z'][i]}</span>{v}
        </span>
      ))}
    </div>
  );
}

const Xeno3DEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── titlebar ── */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#08080a] px-3.5 py-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[11px] font-semibold text-[#cdc7be]">XENO&nbsp;3D</span>
      <div className="ml-2 hidden items-center gap-3 sm:flex">
        {menus.map((m) => (
          <span key={m} className="text-[10.5px] text-[#69635b]">{m}</span>
        ))}
      </div>
      <span className="ml-auto text-[10px] text-[#5d5850]">untitled&nbsp;·&nbsp;Scene</span>
    </div>

    {/* ── mode + shading bar ── */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0a0a0c] px-2 py-[5px]">
      <div className="flex items-center">
        {modes.map((m, i) => (
          <span
            key={m}
            className={`rounded-[3px] px-2 py-[3px] text-[10px] ${i === 0 ? 'bg-white/[0.08] text-[#e7e2d9]' : 'text-[#5d5850]'} ${i > 2 ? 'hidden md:inline' : ''}`}
          >
            {m}
          </span>
        ))}
      </div>
      <span className="mx-1 h-[13px] w-px bg-white/[0.07]" />
      <div className="flex items-center gap-0.5">
        {shading.map((s, i) => (
          <span key={i} className={`grid h-[18px] w-[18px] place-items-center rounded-[3px] ${s.on ? 'bg-white/[0.08] text-[#cdc7be]' : 'text-[#5d5850]'}`}>{s.icon}</span>
        ))}
      </div>
      <span className="mx-1 hidden h-[13px] w-px bg-white/[0.07] sm:block" />
      <span className="hidden items-center gap-1 text-[#5d5850] sm:flex"><Magnet size={11} strokeWidth={1.5} /></span>
      <div className="ml-auto hidden items-center gap-2.5 text-[9px] tabular-nums text-[#5d5850] md:flex">
        <span>Verts <span className="text-[#827b71]">8,024</span></span>
        <span>Faces <span className="text-[#827b71]">7,984</span></span>
        <span>Tris <span className="text-[#827b71]">15,872</span></span>
      </div>
    </div>

    {/* ── workspace ── */}
    <div className="flex h-[clamp(360px,50vh,440px)]">
      {/* tools sidebar */}
      <aside className="flex w-[34px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#0a0a0c] pt-1.5">
        {toolGroups.map((g, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span className="my-1 h-px w-[18px] bg-white/[0.06]" />}
            {g.map((t, ti) => (
              <span
                key={ti}
                className={`mb-px grid h-[26px] w-[26px] place-items-center rounded-[3px] ${t.active ? 'acc-b12 acc-fg-hi' : 'text-[#5d5850]'}`}
              >
                {t.icon}
              </span>
            ))}
          </React.Fragment>
        ))}
      </aside>

      {/* viewport */}
      <section className="relative min-w-0 flex-1 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #141419 0%, #0d0d11 45%, #08080b 100%)' }}>
        {/* receding grid floor */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute left-1/2 top-[54%] h-[280px] w-[1100px]"
            style={{
              transform: 'translateX(-50%) perspective(440px) rotateX(60deg)',
              transformOrigin: 'top center',
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 44px)',
              WebkitMaskImage: 'radial-gradient(ellipse 55% 68% at 50% 22%, #000 25%, transparent 78%)',
              maskImage: 'radial-gradient(ellipse 55% 68% at 50% 22%, #000 25%, transparent 78%)',
            }}
          />
        </div>

        {/* top-left HUD */}
        <div className="absolute left-3 top-2.5 text-[9.5px] leading-tight text-[#827b71]">
          <div className="text-[#b3aca2]">User Perspective</div>
          <div className="text-[#5d5850]">(1) Scene Collection · Icosphere</div>
        </div>

        {/* nav axis gizmo */}
        <div className="absolute right-3 top-2.5 h-[34px] w-[34px] rounded-full border border-white/[0.05]">
          <span className="absolute left-1/2 top-1/2 h-[3.5px] w-[3.5px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: '#5d5850' }} />
          <span className="absolute left-1/2 top-[3px] h-[6px] w-[6px] -translate-x-1/2 rounded-full" style={{ background: AX.z }} />
          <span className="absolute right-[3px] top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full" style={{ background: AX.x }} />
          <span className="absolute bottom-[6px] left-[7px] h-[5px] w-[5px] rounded-full" style={{ background: AX.y }} />
        </div>

        {/* selected object + gizmo */}
        <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-[128px] w-[128px]">
            {/* contact shadow */}
            <div className="absolute left-1/2 top-[112%] h-3 w-24 -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)', filter: 'blur(2px)' }} />
            {/* shaded sphere */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle at 36% 30%, #70707c 0%, #40404a 38%, #1c1c22 72%, #101014 100%)',
                boxShadow: 'inset -10px -14px 30px rgba(0,0,0,0.55), inset 7px 9px 20px rgba(255,255,255,0.06)',
              }}
            />
            {/* mesh wireframe hint */}
            <div className="absolute inset-0 rounded-full border border-white/[0.06]" />
            <div className="absolute inset-[6%] rounded-full border border-white/[0.05]" style={{ transform: 'rotateY(68deg)' }} />
            <div className="absolute inset-[6%] rounded-full border border-white/[0.05]" style={{ transform: 'rotateX(68deg)' }} />
            <div className="absolute inset-[26%] rounded-full border border-white/[0.04]" style={{ transform: 'rotateX(72deg)' }} />
            {/* accent selection outline */}
            <div className="absolute -inset-[3px] rounded-full" style={{ boxShadow: '0 0 0 1px rgb(var(--acc) / 0.85), 0 0 24px -4px rgb(var(--acc))' }} />

            {/* transform gizmo */}
            <div className="absolute left-1/2 top-1/2">
              <span className="absolute h-[2px] w-10" style={{ background: AX.x, left: 0, top: -1, transformOrigin: 'left center' }} />
              <span className="absolute h-[7px] w-[7px] rounded-[1px]" style={{ background: AX.x, left: 38, top: -4 }} />
              <span className="absolute w-[2px] h-10" style={{ background: AX.z, left: -1, bottom: 0 }} />
              <span className="absolute h-[7px] w-[7px] rounded-[1px]" style={{ background: AX.z, left: -4, top: -46 }} />
              <span className="absolute h-[2px] w-7" style={{ background: AX.y, left: 0, top: -1, transform: 'rotate(208deg)', transformOrigin: 'left center' }} />
            </div>
          </div>
        </div>

        {/* 3D cursor bottom-left */}
        <div className="absolute bottom-3 left-3 text-[9px] text-[#5d5850]">Global · Median</div>
      </section>

      {/* right panel: outliner + properties */}
      <aside className="hidden w-[172px] shrink-0 flex-col border-l border-white/[0.06] bg-[#09090b] md:flex">
        {/* outliner */}
        <div className="border-b border-white/[0.06]">
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5d5850]">Outliner</span>
          </div>
          <div className="pb-1.5">
            <OutlinerRow icon={<Box size={11} strokeWidth={1.5} />} name="Scene Collection" chevron />
            <OutlinerRow icon={<Camera size={11} strokeWidth={1.5} />} name="Camera" depth={1} />
            <OutlinerRow icon={<Sun size={11} strokeWidth={1.5} />} name="Light" depth={1} />
            <OutlinerRow icon={<Box size={11} strokeWidth={1.5} />} name="Icosphere" depth={1} selected badge="2 mod" />
          </div>
        </div>

        {/* properties */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-0.5 border-b border-white/[0.06] px-2 py-1.5">
            {propTabs.map((t, i) => (
              <span key={i} className={`grid h-[18px] w-[18px] place-items-center rounded-[3px] ${i === 0 ? 'acc-b12 acc-fg-hi' : 'text-[#5d5850]'}`}>{t}</span>
            ))}
          </div>
          <div className="space-y-2 overflow-hidden px-2.5 py-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#69635b]">Transform</div>
            <div className="space-y-1">
              <XYZ label="Location" vals={['0.00', '0.00', '0.00']} />
              <XYZ label="Rotation" vals={['0°', '0°', '0°']} />
              <XYZ label="Scale" vals={['1.00', '1.00', '1.00']} />
            </div>
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#69635b]">Modifiers</div>
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center gap-1.5 rounded-[4px] border border-white/[0.06] bg-white/[0.02] px-2 py-1">
                  <Layers size={10} strokeWidth={1.5} className="text-[#69635b]" />
                  <span className="text-[9.5px] text-[#b3aca2]">Subdivision</span>
                  <span className="ml-auto text-[8.5px] tabular-nums text-[#5d5850]">Lv 2</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-[4px] border border-white/[0.06] bg-white/[0.02] px-2 py-1">
                  <Layers size={10} strokeWidth={1.5} className="text-[#69635b]" />
                  <span className="text-[9.5px] text-[#b3aca2]">Mirror</span>
                  <span className="ml-auto text-[8.5px] text-[#5d5850]">X</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    {/* ── timeline ── */}
    <div className="flex items-center gap-1.5 border-t border-white/[0.06] bg-[#0a0a0c] px-2 py-[6px]">
      <div className="flex items-center gap-px text-[#5d5850]">
        <ChevronFirst size={12} strokeWidth={1.5} />
        <SkipBack size={11} strokeWidth={1.5} />
        <span className="grid h-[19px] w-[21px] place-items-center rounded-[3px] bg-white/[0.06] text-[#cdc7be]"><Play size={11} strokeWidth={1.5} /></span>
        <SkipForward size={11} strokeWidth={1.5} />
        <ChevronLast size={12} strokeWidth={1.5} />
      </div>
      <span className="h-[13px] w-px bg-white/[0.07]" />
      <div className="flex items-center gap-1">
        <span className="rounded-[2px] border border-white/[0.06] bg-white/[0.04] px-1.5 py-[2px] text-[9.5px] tabular-nums text-[#b3aca2]">1</span>
        <span className="text-[8.5px] tabular-nums text-[#5d5850]">/ 250</span>
      </div>
      {/* track */}
      <div className="relative mx-1 h-[15px] flex-1 overflow-hidden rounded-[2px] bg-white/[0.02]">
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} className="absolute bottom-0" style={{ left: `${(i / 10) * 100}%` }}>
            <div className="w-px bg-white/[0.08]" style={{ height: i % 5 === 0 ? 8 : 4 }} />
          </div>
        ))}
        {/* keyframe diamonds */}
        {[8, 34, 62].map((l) => (
          <span key={l} className="absolute top-1/2 h-[5px] w-[5px] -translate-y-1/2 rotate-45 border border-[#948d83] bg-[#69635b]" style={{ left: `${l}%` }} />
        ))}
        {/* playhead */}
        <div className="absolute inset-y-0 w-px" style={{ left: '4%', background: V }}>
          <div className="absolute -left-[3px] -top-px h-[5px] w-[7px]" style={{ background: V, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
        </div>
      </div>
    </div>

    {/* ── status bar ── */}
    <div className="flex items-center gap-3 border-t border-white/[0.05] bg-[#0a0a0c] px-3 py-[5px] text-[9px] text-[#5d5850]">
      <span className="text-[#827b71]">untitled *</span>
      <span className="text-white/[0.08]">|</span>
      <span>Object Mode</span>
      <span className="hidden text-white/[0.08] sm:inline">|</span>
      <span className="hidden tabular-nums sm:inline">1 selected</span>
      <span className="ml-auto hidden sm:inline">Auto-save on</span>
      <span className="hidden text-white/[0.08] sm:inline">|</span>
      <span className="tabular-nums">1920×1080</span>
      <span className="text-white/[0.08]">|</span>
      <span>Solid</span>
      <span className="text-white/[0.08]">|</span>
      <span className="acc-fg">wgpu</span>
    </div>
  </div>
);

export default Xeno3DEditor;
