import React from 'react';
import {
  MousePointer2, Move, RotateCcw, Square, Layers, Triangle, DoorOpen, LayoutGrid,
  Footprints, Columns3, Ruler, Scissors, Sun, Box, Home, Building, Grid3x3,
  Image as ImageIcon, Sparkles, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Architect mockup — the hero's "representative content"
 * (NN/g: the hero visual must show the real product). Recreates the actual
 * Revit-style BIM shell from xeno-architect/src/renderer/src (MenuBar +
 * RibbonBar contextual tabs + 36px ToolsSidebar + 3D viewport + ProjectBrowser
 * + 232px PropertiesPanel + StatusBar), built in the landing-v3 language:
 * near-black panels (#0d0d0f / #0a0a0c), hairline borders, off-white text.
 * ALL accent color routes through rgb(var(--acc)) / .acc-* so the theme switch
 * recolors it — active tool, active tab, the selected wall + its handles, the
 * dimension string. The 3D massing is hand-built SVG so it stays crisp and
 * weightless. Mirrors the real IFC-native building model. */

const V = 'rgb(var(--acc))';

/* ── viewport 3D massing (axonometric SVG) ───────────────────────────── */
type Pt = [number, number];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const pts = (arr: Pt[]) => arr.map((p) => p.join(',')).join(' ');

// building box corners (roof + base), eyeballed for a clean 3-storey massing
const FLt: Pt = [96, 138], FRt: Pt = [286, 194], BRt: Pt = [402, 156], BLt: Pt = [212, 100];
const FLb: Pt = [96, 250], FRb: Pt = [286, 306], BRb: Pt = [402, 268];
// param point on the FRONT face: t across (0..1), f down floors (0..1)
const F = (t: number, f: number): Pt => lerp(lerp(FLt, FRt, t), lerp(FLb, FRb, t), f);
// param point on the SIDE (right) face
const S = (t: number, f: number): Pt => lerp(lerp(FRt, BRt, t), lerp(FRb, BRb, t), f);

const mullions = [0.14, 0.29, 0.44, 0.59, 0.74, 0.88];
const floors = [1 / 3, 2 / 3];
// selected wall bay — middle floor, one bay
const bay = pts([F(0.29, 0.35), F(0.44, 0.35), F(0.44, 0.66), F(0.29, 0.66)]);
const bayHandles: Pt[] = [F(0.29, 0.35), F(0.44, 0.35), F(0.44, 0.66), F(0.29, 0.66)];

function Scene() {
  return (
    <svg viewBox="0 0 480 340" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* ground grid */}
      <g stroke="rgba(255,255,255,0.05)" strokeWidth={1}>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = lerp([40, 268], [230, 324], i / 4);
          const b = lerp([230, 210], [420, 266], i / 4);
          return <line key={`g1${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const a = lerp([40, 268], [230, 210], i / 4);
          const b = lerp([230, 324], [420, 266], i / 4);
          return <line key={`g2${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
      </g>

      {/* side (right) face */}
      <polygon points={pts([FRt, BRt, BRb, FRb])} fill="#0b0b0e" />
      {floors.map((f, i) => (
        <line key={`sf${i}`} x1={S(0, f)[0]} y1={S(0, f)[1]} x2={S(1, f)[0]} y2={S(1, f)[1]} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      {[0.34, 0.68].map((t, i) => (
        <line key={`sm${i}`} x1={S(t, 0)[0]} y1={S(t, 0)[1]} x2={S(t, 1)[0]} y2={S(t, 1)[1]} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}

      {/* front face */}
      <polygon points={pts([FLt, FRt, FRb, FLb])} fill="#131317" />
      {/* glass tint columns */}
      {mullions.slice(0, -1).map((t, i) => (
        <polygon key={`gl${i}`} points={pts([F(t, 0), F(mullions[i + 1], 0), F(mullions[i + 1], 1), F(t, 1)])} fill="rgba(150,170,190,0.03)" />
      ))}
      {floors.map((f, i) => (
        <line key={`ff${i}`} x1={F(0, f)[0]} y1={F(0, f)[1]} x2={F(1, f)[0]} y2={F(1, f)[1]} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      ))}
      {mullions.map((t, i) => (
        <line key={`fm${i}`} x1={F(t, 0)[0]} y1={F(t, 0)[1]} x2={F(t, 1)[0]} y2={F(t, 1)[1]} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      ))}

      {/* roof top face */}
      <polygon points={pts([FLt, FRt, BRt, BLt])} fill="#1a1a1e" />

      {/* building outline */}
      <polygon points={pts([FLt, FRt, FRb, FLb])} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth={1.25} />
      <polygon points={pts([FRt, BRt, BRb, FRb])} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={1.25} />
      <polygon points={pts([FLt, FRt, BRt, BLt])} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.25} />

      {/* selected wall bay + handles (accent) */}
      <polygon points={bay} fill={V} fillOpacity={0.18} stroke={V} strokeWidth={1.5} />
      {bayHandles.map((p, i) => (
        <rect key={`h${i}`} x={p[0] - 3} y={p[1] - 3} width={6} height={6} rx={1} fill="#0d0d0f" stroke={V} strokeWidth={1.25} />
      ))}

      {/* dimension line under the front face */}
      <g>
        <line x1={FLb[0]} y1={FLb[1] + 18} x2={FRb[0]} y2={FRb[1] + 18} stroke={V} strokeWidth={1} />
        <line x1={FLb[0]} y1={FLb[1] + 12} x2={FLb[0]} y2={FLb[1] + 24} stroke={V} strokeWidth={1} />
        <line x1={FRb[0]} y1={FRb[1] + 12} x2={FRb[0]} y2={FRb[1] + 24} stroke={V} strokeWidth={1} />
        <rect x={168} y={252} width={46} height={15} rx={2} fill="#0a0a0c" />
        <text x={191} y={263} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill={V}>8400</text>
      </g>

      {/* room label */}
      <g>
        <rect x={150} y={196} width={92} height={16} rx={2} fill="rgba(10,10,12,0.82)" />
        <text x={158} y={207} fontSize={9.5} fill="#b3aca2">Office 142 · 84 m²</text>
      </g>
    </svg>
  );
}

/* ── ribbon tool button (icon over label) ────────────────────────────── */
function Ribbon({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <span className={`flex min-w-[38px] flex-col items-center justify-center rounded-[3px] px-1 py-1 ${active ? 'acc-b10 acc-fg-hi' : 'text-white/35'}`}>
      <span className="mb-0.5">{icon}</span>
      <span className="text-[8px] leading-none">{label}</span>
    </span>
  );
}
function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center gap-0.5 px-1">{children}</div>
      <div className="pb-0.5 text-center text-[7px] uppercase tracking-[0.06em] text-white/20">{label}</div>
    </div>
  );
}

/* ── tools-sidebar icon button ───────────────────────────────────────── */
function ToolBtn({ icon, active }: { icon: React.ReactNode; active?: boolean }) {
  return (
    <span className={`grid h-[26px] w-[26px] place-items-center rounded-[2px] ${active ? 'acc-b10 acc-fg-hi' : 'text-white/25'}`}>{icon}</span>
  );
}

/* ── properties rows ─────────────────────────────────────────────────── */
function PropInput({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex h-[21px] items-center">
      <span className="w-[64px] shrink-0 text-[10px] text-white/25">{label}</span>
      <span className="flex flex-1 items-center justify-end gap-1 rounded-[2px] border border-white/[0.06] bg-white/[0.03] px-1.5 py-[2px]">
        <span className="font-mono text-[10px] tabular-nums text-white/45">{value}</span>
        {unit && <span className="text-[8px] text-white/15">{unit}</span>}
      </span>
    </div>
  );
}
function TreeRow({ icon, label, badge, depth = 0, active }: { icon: React.ReactNode; label: string; badge?: string | number; depth?: number; active?: boolean }) {
  return (
    <div className={`flex h-[19px] items-center gap-1 pr-1.5 text-[10px] ${active ? 'acc-fg-hi acc-b10' : 'text-white/30'}`} style={{ paddingLeft: 6 + depth * 11 }}>
      {depth === 0 ? <ChevronDown size={9} className="text-white/15" /> : <span className="w-[9px]" />}
      <span className="text-white/20">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && <span className="text-[8px] tabular-nums text-white/15">{badge}</span>}
    </div>
  );
}
function Sec({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.05]">
      <div className="flex h-[22px] items-center px-3">
        <ChevronDown size={10} className="mr-1 text-white/15" />
        <span className="flex-1 text-[8px] uppercase tracking-[0.08em] text-white/20">{label}</span>
        {count !== undefined && <span className="text-[8px] tabular-nums text-white/10">{count}</span>}
      </div>
      <div className="px-3 pb-2 pt-0.5">{children}</div>
    </div>
  );
}

const iSz = 14;

const ArchitectEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[900px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── titlebar ── */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-3 hidden font-medium text-[10.5px] text-[#cdc7be] sm:inline">XENO Architect</span>
      <span className="hidden text-[10.5px] text-[#5d5850] sm:inline">— Riverside-Tower.xarchitect</span>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1 rounded-[5px] border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[9.5px] text-[#827b71] sm:flex"><Sun size={11} /> Sun 14h</span>
        <button className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[10.5px] font-semibold text-white" style={{ background: V }}><ImageIcon size={12} /> Render</button>
      </div>
    </div>

    {/* ── ribbon: tab strip ── */}
    <div className="flex items-center gap-0.5 border-b border-white/[0.04] bg-[#0c0c0e] px-1.5 py-[3px] text-[9px]">
      <span className="mr-1 flex items-center gap-1 rounded-[2px] px-2 py-0.5 text-white/25"><MousePointer2 size={11} /> Select</span>
      <span className="mx-0.5 h-2.5 w-px bg-white/[0.06]" />
      {['Architecture', 'Structure', 'MEP', 'Site', 'Annotate', 'Analyze', 'AI', 'Collaborate'].map((t) => (
        <span key={t} className={`rounded-[2px] px-2 py-0.5 uppercase tracking-[0.04em] ${t === 'Architecture' ? 'acc-fg-hi acc-b10' : 'text-white/20'}`}>{t}</span>
      ))}
    </div>

    {/* ── ribbon: panel row ── */}
    <div className="flex h-[52px] items-stretch gap-0 border-b border-white/[0.06] bg-[#0c0c0e] px-1">
      <RibbonGroup label="Build">
        <Ribbon icon={<Square size={iSz} strokeWidth={1.5} />} label="Wall" active />
        <Ribbon icon={<Layers size={iSz} strokeWidth={1.5} />} label="Floor" />
        <Ribbon icon={<Triangle size={iSz} strokeWidth={1.5} />} label="Roof" />
      </RibbonGroup>
      <div className="my-1.5 w-px bg-white/[0.04]" />
      <RibbonGroup label="Component">
        <Ribbon icon={<DoorOpen size={iSz} strokeWidth={1.5} />} label="Door" />
        <Ribbon icon={<LayoutGrid size={iSz} strokeWidth={1.5} />} label="Window" />
        <Ribbon icon={<Footprints size={iSz} strokeWidth={1.5} />} label="Stairs" />
        <Ribbon icon={<Columns3 size={iSz} strokeWidth={1.5} />} label="Column" />
      </RibbonGroup>
      <div className="my-1.5 hidden w-px bg-white/[0.04] md:block" />
      <div className="hidden md:block">
        <RibbonGroup label="Datum">
          <Ribbon icon={<Home size={iSz} strokeWidth={1.5} />} label="Room" />
          <Ribbon icon={<Sparkles size={iSz} strokeWidth={1.5} />} label="AI Plan" />
        </RibbonGroup>
      </div>
    </div>

    {/* ── main workspace ── */}
    <div className="flex h-[clamp(360px,50vh,440px)] text-left">
      {/* tools sidebar */}
      <aside className="hidden w-[34px] shrink-0 flex-col items-center gap-px border-r border-white/[0.06] bg-[#0c0c0e] py-1 sm:flex">
        <ToolBtn icon={<MousePointer2 size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<Move size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<RotateCcw size={15} strokeWidth={1.5} />} />
        <span className="my-1 w-[18px] border-t border-white/[0.05]" />
        <ToolBtn icon={<Square size={15} strokeWidth={1.5} />} active />
        <ToolBtn icon={<Layers size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<Triangle size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<DoorOpen size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<LayoutGrid size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<Footprints size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<Columns3 size={15} strokeWidth={1.5} />} />
        <span className="my-1 w-[18px] border-t border-white/[0.05]" />
        <ToolBtn icon={<Ruler size={15} strokeWidth={1.5} />} />
        <ToolBtn icon={<Scissors size={15} strokeWidth={1.5} />} />
      </aside>

      {/* center: viewport + project browser */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        {/* viewport toolbar */}
        <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-[7px]">
          {['3D', 'Plan', 'Section', 'Elev.'].map((v) => (
            <span key={v} className={`rounded-[3px] px-1.5 py-0.5 text-[9.5px] ${v === '3D' ? 'acc-fg-hi acc-b10' : 'text-[#69635b]'}`}>{v}</span>
          ))}
          <span className="ml-auto flex items-center gap-2 text-[9.5px] text-[#69635b]">
            <span>Realistic</span><span className="h-2.5 w-px bg-white/10" /><span className="tabular-nums">100%</span>
          </span>
        </header>

        {/* 3D viewport */}
        <div className="relative flex-1 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 8%, #14141a, #0a0a0c 76%)' }}>
          <Reveal y={10}><div className="absolute inset-0"><Scene /></div></Reveal>

          {/* level markers (left) */}
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-3 text-[8.5px] text-[#5d5850]">
            {[['L3', '+6.00'], ['L2', '+3.00'], ['L1', '±0.00']].map(([l, e], i) => (
              <div key={l} className={`flex items-center gap-1.5 ${i === 2 ? 'acc-fg-hi' : ''}`}>
                <span className="h-px w-4 bg-white/15" /><span className="font-medium">{l}</span><span className="tabular-nums opacity-70">{e}</span>
              </div>
            ))}
          </div>

          {/* ViewCube */}
          <div className="absolute right-3 top-3">
            <div className="grid h-9 w-9 place-items-center rounded-[3px] border border-white/[0.12] bg-white/[0.04] text-[7.5px] font-semibold uppercase tracking-[0.08em] text-white/45" style={{ transform: 'rotate(0deg)' }}>Top</div>
          </div>

          {/* nav pill */}
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[7px] border border-white/[0.08] bg-[#141416]/90 px-1.5 py-1 text-[#9a9aa2]">
            <RotateCcw size={13} strokeWidth={1.5} /><Move size={13} strokeWidth={1.5} /><span className="mx-0.5 h-4 w-px bg-white/10" /><Grid3x3 size={13} strokeWidth={1.5} /><Sun size={13} strokeWidth={1.5} />
          </div>
        </div>

        {/* project browser strip */}
        <div className="hidden shrink-0 flex-col border-t border-white/[0.06] bg-[#0a0a0c] lg:flex">
          <div className="flex h-[20px] items-center px-3">
            <span className="flex-1 text-[8px] uppercase tracking-[0.08em] text-white/25">Project Browser</span>
            <span className="text-[8px] tabular-nums text-white/12">247</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 pb-1.5">
            <div>
              <TreeRow icon={<Layers size={11} strokeWidth={1.5} />} label="Levels" badge={3} />
              <TreeRow icon={<Box size={11} strokeWidth={1.5} />} label="Ground Floor" badge="±0.00" depth={1} active />
              <TreeRow icon={<Box size={11} strokeWidth={1.5} />} label="Level 2" badge="+3.00" depth={1} />
            </div>
            <div>
              <TreeRow icon={<Building size={11} strokeWidth={1.5} />} label="Categories" badge={247} />
              <TreeRow icon={<Box size={11} strokeWidth={1.5} />} label="Walls" badge={84} depth={1} />
              <TreeRow icon={<Box size={11} strokeWidth={1.5} />} label="Windows" badge={42} depth={1} />
            </div>
          </div>
        </div>
      </section>

      {/* properties panel */}
      <aside className="hidden w-[210px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0c0c0e] md:flex">
        <div className="flex h-[22px] items-center border-b border-white/[0.06] px-3">
          <span className="text-[8px] uppercase tracking-[0.08em] text-white/25">Properties</span>
        </div>
        {/* info box */}
        <div className="border-b border-white/[0.06] bg-white/[0.01] px-3 py-1.5">
          <div className="text-[10px] text-white/50">Basic Wall · Exterior</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[8px] text-white/20">IfcWall</span>
            <span className="font-mono text-[8px] text-white/12">3xW9a2c1...</span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <Sec label="Instance Properties">
            <div className="flex flex-col gap-px">
              <PropInput label="Length" value="8400" unit="mm" />
              <PropInput label="Height" value="3000" unit="mm" />
              <PropInput label="Thickness" value="200" unit="mm" />
              <PropInput label="Rotation" value="0" unit="deg" />
            </div>
          </Sec>
          <Sec label="Computed">
            <div className="flex flex-col gap-px">
              <div className="flex h-[18px] items-center"><span className="w-[64px] text-[10px] text-white/25">Area</span><span className="flex-1 text-right font-mono text-[10px] text-white/40">25.20 <span className="text-white/15">m²</span></span></div>
              <div className="flex h-[18px] items-center"><span className="w-[64px] text-[10px] text-white/25">Volume</span><span className="flex-1 text-right font-mono text-[10px] text-white/40">5.040 <span className="text-white/15">m³</span></span></div>
            </div>
          </Sec>
          <Sec label="Type · Wall Layers" count={3}>
            <div className="flex flex-col gap-1">
              {[['Brick veneer', '#8a5a44', '90'], ['Air + insulation', '#6a7a8a', '75'], ['Concrete block', '#8a8880', '140']].map(([n, c, th]) => (
                <div key={n} className="flex items-center gap-1.5">
                  <span className="h-[7px] w-[7px] shrink-0 rounded-[1px]" style={{ background: c }} />
                  <span className="flex-1 truncate text-[9.5px] text-white/25">{n}</span>
                  <span className="font-mono text-[8px] tabular-nums text-white/15">{th}</span>
                </div>
              ))}
            </div>
          </Sec>
          <Sec label="Material">
            <div className="flex items-center gap-1.5 rounded-[3px] acc-b10 px-2 py-1">
              <span className="h-[9px] w-[9px] rounded-[1px]" style={{ background: '#8a5a44' }} />
              <span className="flex-1 text-[10px] acc-fg-hi">Brick, Sand Lime</span>
            </div>
          </Sec>
        </div>
      </aside>
    </div>

    {/* ── status bar ── */}
    <div className="flex items-center gap-0 border-t border-white/[0.06] bg-[#0a0a0c] px-2.5 py-1.5 text-[8px] tabular-nums text-white/18">
      <span className="text-white/30">Wall</span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" /><span>3D</span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" /><span>100%</span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" />
      <span className="flex items-center gap-1.5"><span className="uppercase tracking-[0.04em] text-white/30">Grid</span><span className="uppercase tracking-[0.04em] text-white/30">Snap</span><span className="uppercase tracking-[0.04em] text-white/10">Ortho</span></span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" /><span>Ground Floor</span>
      <div className="flex-1" />
      <span className="text-white/30">Sel: 1</span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" /><span>247 elem</span>
      <span className="mx-1.5 hidden h-2 w-px bg-white/[0.06] sm:block" /><span className="hidden sm:inline">12 rooms</span>
      <span className="mx-1.5 h-2 w-px bg-white/[0.06]" /><span className="font-mono">+12400, 0, +3000 mm</span>
    </div>
  </div>
);

export default ArchitectEditor;
