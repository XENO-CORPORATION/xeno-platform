import React from 'react';
import {
  Play, Pause, Square, Move, RotateCw, Maximize2, Magnet, Sun, Camera,
  ChevronRight, ChevronDown, Eye, Search, Plus, Boxes, Sparkles, Layers,
  Folder, Music, Image as ImageIcon, Code2, Gauge,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Engine editor mockup — the hero's "representative content"
 * (NN/g: the hero visual must be the real product). Recreates the editor shell
 * from xeno-engine/src/renderer/editor: MenuBar + Toolbar (transform tools +
 * play/pause/stop), the Hierarchy scene-graph tree, the SceneView 3D viewport
 * with a transform gizmo + stats overlay, the Inspector (Transform / RigidBody /
 * Script components), and the ProjectBrowser asset grid.
 * Landing-v3 language: near-black panels, hairline borders, off-white text.
 * The accent (Play, active tool, selection, AI, profiler target) flows through
 * rgb(var(--acc)) / .acc-* so the theme switch recolors it. Gizmo axis colors
 * (X=red / Y=green / Z=blue) are fixed DCC-convention semantics, like a code
 * editor's syntax colors — never the theme accent. */

const V = 'rgb(var(--acc))';
/* fixed gizmo axis semantics — never the theme accent */
const AXIS = { x: '#e0716b', y: '#78c07a', z: '#6c92e0' };

/* ── an isometric crate, drawn as three SVG faces (top/left/right) ── */
function IsoCube({ s, top = '#4c5364', left = '#353a47', right = '#282c37' }: { s: number; top?: string; left?: string; right?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 100 100" style={{ display: 'block' }}>
      <polygon points="50,6 93,31 50,56 7,31" fill={top} stroke="rgba(255,255,255,0.10)" strokeWidth="0.8" />
      <polygon points="7,31 50,56 50,97 7,72" fill={left} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      <polygon points="93,31 50,56 50,97 93,72" fill={right} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
    </svg>
  );
}

/* ── translate gizmo (three axis arrows from an origin) ── */
function Gizmo() {
  return (
    <svg width="88" height="88" viewBox="0 0 100 100" className="pointer-events-none">
      {/* Y up */}
      <line x1="50" y1="50" x2="50" y2="12" stroke={AXIS.y} strokeWidth="2.2" />
      <polygon points="50,6 46,15 54,15" fill={AXIS.y} />
      {/* X right */}
      <line x1="50" y1="50" x2="88" y2="50" stroke={AXIS.x} strokeWidth="2.2" />
      <polygon points="94,50 85,46 85,54" fill={AXIS.x} />
      {/* Z toward viewer (down-left) */}
      <line x1="50" y1="50" x2="20" y2="76" stroke={AXIS.z} strokeWidth="2.2" />
      <polygon points="15,80 24,71 27,79" fill={AXIS.z} />
      <circle cx="50" cy="50" r="3.4" fill="#e7e2d9" />
    </svg>
  );
}

/* ── hierarchy row ── */
function Node({ label, icon, depth, open, leaf, sel, dim, badge }: {
  label: string; icon?: React.ReactNode; depth: number; open?: boolean; leaf?: boolean; sel?: boolean; dim?: boolean; badge?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 rounded-[5px] py-[3px] pr-2 ${sel ? 'acc-b12' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}>
      {leaf
        ? <span className="w-2.5" />
        : (open ? <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[#69635b]" /> : <ChevronRight className="h-2.5 w-2.5 shrink-0 text-[#69635b]" />)}
      <span className={`shrink-0 ${sel ? 'acc-fg-hi' : 'text-[#69635b]'}`}>{icon}</span>
      <span className={`truncate text-[10.5px] ${sel ? 'font-medium text-[#f3efe8]' : dim ? 'text-[#807970]' : 'text-[#cdc7be]'}`}>{label}</span>
      {badge && <span className="ml-auto shrink-0 rounded-[3px] bg-white/[0.05] px-1 text-[8px] text-[#69635b]">{badge}</span>}
      {!badge && <Eye className="ml-auto h-2.5 w-2.5 shrink-0 text-[#4f4a44]" />}
    </div>
  );
}

/* ── inspector field row ── */
function Vec3({ label, x, y, z, keyed }: { label: string; x: string; y: string; z: string; keyed?: boolean }) {
  return (
    <div className="flex items-center justify-between py-[3px] text-[9px]">
      <span className="flex items-center gap-1 text-[#827b71]">
        {keyed && <span className="h-1.5 w-1.5 rotate-45 rounded-[1px]" style={{ background: V }} />}{label}
      </span>
      <span className="flex items-center gap-1 font-mono tabular-nums">
        <span className="rounded-[3px] bg-white/[0.04] px-1 text-[#aaa39a]"><b style={{ color: AXIS.x }}>X</b> {x}</span>
        <span className="rounded-[3px] bg-white/[0.04] px-1 text-[#aaa39a]"><b style={{ color: AXIS.y }}>Y</b> {y}</span>
        <span className="rounded-[3px] bg-white/[0.04] px-1 text-[#aaa39a]"><b style={{ color: AXIS.z }}>Z</b> {z}</span>
      </span>
    </div>
  );
}

const ASSETS = [
  { icon: <Folder className="h-3.5 w-3.5" />, label: 'Materials', tint: 'linear-gradient(135deg,#3a4a63,#20283a)' },
  { icon: <Boxes className="h-3.5 w-3.5" />, label: 'player.gltf', tint: 'linear-gradient(135deg,#5a533f,#302c25)', tag: 'glTF' },
  { icon: <ImageIcon className="h-3.5 w-3.5" />, label: 'brick_albedo', tint: 'linear-gradient(135deg,#5a3f4a,#2f2530)', tag: 'PNG' },
  { icon: <Boxes className="h-3.5 w-3.5" />, label: 'village.usd', tint: 'linear-gradient(135deg,#3f5a4a,#25302a)', tag: 'USD' },
  { icon: <Music className="h-3.5 w-3.5" />, label: 'ambient_wind', tint: 'linear-gradient(135deg,#463f5a,#272530)', tag: 'OGG' },
  { icon: <Code2 className="h-3.5 w-3.5" />, label: 'PlayerCtrl.ts', tint: 'linear-gradient(135deg,#3a4f4f,#232f2f)', tag: 'TS' },
];

const EngineEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] font-semibold text-[#e7e2d9]">XENO Engine</span>
      <span className="hidden text-[10px] text-[#5d5850] sm:inline">— nightfall.xengine</span>
      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1 rounded-[5px] acc-b10 px-2 py-[3px] text-[9.5px] font-medium acc-fg-hi md:inline-flex"><Sparkles className="h-2.5 w-2.5" /> Generate</span>
        <span className="hidden text-[9.5px] text-[#69635b] lg:inline">WebGPU</span>
      </div>
    </div>

    {/* menu bar */}
    <div className="hidden items-center gap-3.5 border-b border-white/[0.05] bg-[#0a0a0c] px-3.5 py-1.5 sm:flex">
      {['File', 'Edit', 'Entity', 'Component', 'AI', 'Build', 'View', 'Window'].map((m) => (
        <span key={m} className={`text-[10px] ${m === 'AI' ? 'acc-fg-hi font-medium' : 'text-[#827b71]'}`}>{m}</span>
      ))}
    </div>

    {/* toolbar */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0c0c0e] px-2.5 py-1.5">
      {[{ I: Move, on: true }, { I: RotateCw }, { I: Maximize2 }].map(({ I, on }, i) => (
        <span key={i} className={`grid h-6 w-6 place-items-center rounded-[5px] ${on ? 'acc-b16 acc-fg-hi' : 'text-[#69635b]'}`}><I className="h-3 w-3" /></span>
      ))}
      <span className="mx-1 h-4 w-px bg-white/10" />
      <span className="grid h-6 w-6 place-items-center rounded-[5px] text-[#69635b]"><Magnet className="h-3 w-3" /></span>
      {/* transport — centered */}
      <div className="mx-auto flex items-center gap-1.5">
        <button className="grid h-6 w-6 place-items-center rounded-[5px] text-black" style={{ background: V }}><Play className="h-3 w-3 translate-x-[0.5px]" /></button>
        <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-white/[0.05] text-[#aaa39a]"><Pause className="h-3 w-3" /></span>
        <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-white/[0.05] text-[#aaa39a]"><Square className="h-2.5 w-2.5" /></span>
      </div>
      <span className="hidden items-center gap-1 text-[9.5px] text-[#69635b] md:flex"><Layers className="h-3 w-3" /> Deferred</span>
    </div>

    <div className="flex h-[clamp(430px,58vh,528px)] flex-col text-left">
      <div className="flex min-h-0 flex-1">
        {/* ── hierarchy ── */}
        <aside className="hidden w-[178px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] lg:flex">
          <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">Hierarchy</span>
            <Plus className="h-3 w-3 text-[#5d5850]" />
          </div>
          <div className="px-2 pb-1">
            <div className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.06] bg-white/[0.02] px-2 py-1">
              <Search className="h-2.5 w-2.5 text-[#5d5850]" /><span className="text-[9.5px] text-[#5d5850]">Search entities</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-px overflow-hidden px-1.5 pt-1">
            <Node depth={0} open label="Scene" icon={<Boxes className="h-3 w-3" />} />
            <Node depth={1} leaf label="Directional Light" icon={<Sun className="h-3 w-3" />} />
            <Node depth={1} open sel label="Player" icon={<Boxes className="h-3 w-3" />} />
            <Node depth={2} leaf label="Camera" icon={<Camera className="h-3 w-3" />} />
            <Node depth={2} leaf label="PlayerMesh" icon={<Boxes className="h-3 w-3" />} />
            <Node depth={2} leaf dim label="CharacterController" icon={<Code2 className="h-3 w-3" />} />
            <Node depth={1} leaf label="Terrain" icon={<Layers className="h-3 w-3" />} />
            <Node depth={1} open label="Enemies" icon={<Boxes className="h-3 w-3" />} badge="×12" />
            <Node depth={2} leaf dim label="Grunt" icon={<Boxes className="h-3 w-3" />} />
            <Node depth={2} leaf dim label="Grunt (1)" icon={<Boxes className="h-3 w-3" />} />
            <Node depth={1} leaf label="Environment" icon={<Boxes className="h-3 w-3" />} />
          </div>
        </aside>

        {/* ── viewport ── */}
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0d0d0f]">
          {/* view tabs */}
          <div className="absolute left-2.5 top-2 z-20 flex items-center gap-1 text-[9px]">
            <span className="rounded-[4px] acc-b16 px-1.5 py-0.5 font-medium acc-fg-hi">Scene</span>
            <span className="rounded-[4px] bg-white/[0.04] px-1.5 py-0.5 text-[#807970]">Game</span>
            <span className="ml-1 flex items-center gap-1 rounded-[4px] bg-white/[0.04] px-1.5 py-0.5 text-[#807970]">Lit <ChevronDown className="h-2 w-2" /></span>
          </div>
          {/* axis triad */}
          <div className="absolute right-2.5 top-2 z-20">
            <svg width="34" height="34" viewBox="0 0 100 100">
              <line x1="50" y1="50" x2="50" y2="16" stroke={AXIS.y} strokeWidth="4" /><circle cx="50" cy="12" r="7" fill={AXIS.y} />
              <line x1="50" y1="50" x2="84" y2="60" stroke={AXIS.x} strokeWidth="4" /><circle cx="88" cy="61" r="7" fill={AXIS.x} />
              <line x1="50" y1="50" x2="22" y2="66" stroke={AXIS.z} strokeWidth="4" /><circle cx="18" cy="68" r="7" fill={AXIS.z} />
            </svg>
          </div>

          {/* sky */}
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 50% at 30% 8%, rgba(220,190,150,0.10), transparent 60%), linear-gradient(180deg,#14161f 0%,#0e0f16 46%,#090a0e 100%)' }} />
          {/* sun */}
          <div className="absolute left-[18%] top-[12%] h-10 w-10 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,240,210,0.35), transparent 70%)' }} />
          {/* perspective floor grid */}
          <div className="absolute inset-0 overflow-hidden" style={{ perspective: '540px' }}>
            <div
              className="absolute bottom-[-16%] left-[-50%] right-[-50%] top-[44%]"
              style={{
                transform: 'rotateX(66deg)', transformOrigin: 'center top',
                backgroundImage: 'linear-gradient(rgba(150,160,190,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(150,160,190,0.16) 1px, transparent 1px)',
                backgroundSize: '34px 34px',
                maskImage: 'radial-gradient(ellipse 60% 80% at 50% 30%, #000 30%, transparent 78%)',
                WebkitMaskImage: 'radial-gradient(ellipse 60% 80% at 50% 30%, #000 30%, transparent 78%)',
              }}
            />
          </div>

          {/* scene props */}
          <div className="absolute left-[62%] top-[52%] opacity-95"><IsoCube s={58} /></div>
          <div className="absolute left-[72%] top-[62%] opacity-95"><IsoCube s={40} top="#565d70" left="#3b414f" right="#2c3140" /></div>
          <div className="absolute left-[24%] top-[64%] opacity-90"><IsoCube s={34} /></div>
          {/* a sphere prop */}
          <div className="absolute left-[40%] top-[70%] h-8 w-8 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #6a7288, #2a2e39 72%)', boxShadow: '0 10px 14px -6px rgba(0,0,0,0.6)' }} />

          {/* selected player capsule + selection box + gizmo */}
          <div className="absolute left-[43%] top-[36%]">
            <div className="relative">
              {/* selection bounds */}
              <div className="absolute -inset-2 rounded-[6px] border" style={{ borderColor: V, opacity: 0.9 }}>
                {[['-top-[3px] -left-[3px]', ''], ['-top-[3px] -right-[3px]', ''], ['-bottom-[3px] -left-[3px]', ''], ['-bottom-[3px] -right-[3px]', '']].map(([pos], i) => (
                  <span key={i} className={`absolute h-1.5 w-1.5 ${pos}`} style={{ background: V }} />
                ))}
              </div>
              {/* capsule */}
              <div className="h-[62px] w-[30px] rounded-full" style={{ background: 'linear-gradient(150deg,#7f88a2 0%,#4a5064 55%,#31353f 100%)', boxShadow: '0 14px 18px -8px rgba(0,0,0,0.65)' }} />
              {/* gizmo, centered on the object */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Gizmo /></div>
            </div>
          </div>

          {/* stats overlay */}
          <div className="absolute bottom-2.5 left-2.5 z-20 space-y-[3px] rounded-[7px] border border-white/[0.07] bg-black/45 px-2.5 py-2 font-mono text-[9px] backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="text-[#69635b]">FPS</span>
              <span className="font-semibold acc-fg-hi">60</span>
              <span className="flex items-end gap-[1.5px]">
                {[7, 8, 7, 9, 8, 9, 8, 9].map((h, i) => <span key={i} className="w-[2px] rounded-sm acc-b" style={{ height: h }} />)}
              </span>
            </div>
            <div className="text-[#827b71]">Entities <span className="text-[#cdc7be]">100,024</span></div>
            <div className="text-[#827b71]">Draw calls <span className="text-[#cdc7be]">342</span></div>
            <div className="text-[#827b71]">Tris <span className="text-[#cdc7be]">1.24M</span></div>
          </div>

          {/* AI generation toast */}
          <Reveal y={8} delay={120} className="absolute bottom-2.5 right-2.5 z-20 flex items-center gap-2 rounded-[7px] border acc-bd30 acc-b10 px-2.5 py-1.5 backdrop-blur-sm">
            <Sparkles className="h-3 w-3 acc-fg-hi" />
            <span className="text-[9.5px] text-[#cdc7be]">Level agent placed <span className="acc-fg-hi">24 props</span></span>
          </Reveal>
        </section>

        {/* ── inspector ── */}
        <aside className="hidden w-[196px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] md:flex">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#f3efe8]"><span className="h-2 w-2 rounded-full" style={{ background: V }} /> Player</span>
            <span className="rounded-[3px] bg-white/[0.05] px-1 text-[8px] text-[#807970]">Tag: Player</span>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-hidden px-3 py-2.5">
            {/* Transform */}
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold text-[#cdc7be]"><Move className="h-2.5 w-2.5 acc-fg-hi" /> Transform</div>
              <Vec3 label="Position" x="0.0" y="1.2" z="0.0" keyed />
              <Vec3 label="Rotation" x="0" y="45" z="0" />
              <Vec3 label="Scale" x="1.0" y="1.0" z="1.0" />
            </div>
            {/* RigidBody */}
            <div className="border-t border-white/[0.05] pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold text-[#cdc7be]"><Gauge className="h-2.5 w-2.5 text-[#807970]" /> RigidBody</div>
              {[['Body type', 'Dynamic'], ['Mass', '80 kg'], ['Collider', 'Capsule']].map(([k, val]) => (
                <div key={k} className="flex items-center justify-between py-[3px] text-[9px]">
                  <span className="text-[#827b71]">{k}</span>
                  <span className="rounded-[3px] bg-white/[0.04] px-1.5 font-mono text-[#aaa39a]">{val}</span>
                </div>
              ))}
            </div>
            {/* Script */}
            <div className="border-t border-white/[0.05] pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold text-[#cdc7be]"><Code2 className="h-2.5 w-2.5 text-[#807970]" /> PlayerController.ts</div>
              {[['moveSpeed', '6.0'], ['jumpForce', '12.0'], ['canDoubleJump', 'true']].map(([k, val]) => (
                <div key={k} className="flex items-center justify-between py-[3px] text-[9px]">
                  <span className="font-mono text-[#827b71]">{k}</span>
                  <span className="rounded-[3px] bg-white/[0.04] px-1.5 font-mono text-[#aaa39a]">{val}</span>
                </div>
              ))}
            </div>
            <button className="flex w-full items-center justify-center gap-1 rounded-[6px] border border-dashed border-white/[0.12] py-1.5 text-[9.5px] text-[#827b71]"><Plus className="h-2.5 w-2.5" /> Add Component</button>
          </div>
        </aside>
      </div>

      {/* ── project browser ── */}
      <div className="flex min-h-0 shrink-0 flex-col border-t border-white/[0.07] bg-[#0a0a0c]" style={{ height: '30%' }}>
        <div className="flex items-center gap-3 border-b border-white/[0.05] px-3 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] acc-fg-hi">Project</span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-[#5d5850]">Console</span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-[#5d5850]">Profiler</span>
          <span className="ml-auto flex items-center gap-1 text-[9px] text-[#5d5850]"><Search className="h-2.5 w-2.5" /> Assets · UUID-linked</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-hidden px-3 py-2.5 sm:grid-cols-6">
          {ASSETS.map((a) => (
            <div key={a.label} className="flex flex-col items-center gap-1">
              <div className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-[6px] border border-white/[0.06] text-[#cdc7be]/80" style={{ background: a.tint }}>
                {a.icon}
                {a.tag && <span className="absolute bottom-0.5 right-0.5 rounded-[2px] bg-black/50 px-1 text-[7px] font-medium text-[#cdc7be]">{a.tag}</span>}
              </div>
              <span className="w-full truncate text-center text-[8.5px] text-[#827b71]">{a.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* status bar */}
    <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[8.5px] text-[#5d5850]">
      <span className="flex items-center gap-2">
        <span>Rust · wgpu</span><span>·</span><span>Rapier physics 60Hz</span><span>·</span><span className="hidden sm:inline">V8 scripting</span>
      </span>
      <span className="flex items-center gap-2"><span className="acc-fg-hi">Play-in-editor ready</span><span>·</span><span>WASM + WebGPU export</span></span>
    </div>
  </div>
);

export default EngineEditor;
