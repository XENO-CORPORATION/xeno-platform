import React from 'react';
import {
  Play, Save, Undo2, Redo2, PanelLeft, PanelRight, Terminal, Command,
  Search, ChevronDown, ChevronRight, Clock, Webhook, FolderSearch,
  Sparkles, Wand2, ImageDown, Brain, Bot, GitBranch, Repeat, Settings,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Workflow mockup — the hero's "representative content"
 * (NN/g: the hero must show the real product). Recreates the actual desktop
 * shell from xeno-workflow/src/renderer/src: Toolbar (Run / panel toggles) +
 * Node Palette + the node-graph canvas (WorkflowNode design/node-template.html
 * v3) + Node Inspector + Execution Log with its mini-Gantt timeline. Built in
 * the landing-v3 language — near-black panels (#0d0d0f / #0a0a0c), hairline
 * borders, off-white text.
 *
 * The runtime "brand" accent (Run button, running-node sweep + status,
 * selection ring, the live timeline bar) routes through rgb(var(--acc)) / V so
 * the Shift+T theme switch recolors it. The NODE-CATEGORY colors (trigger green
 * / action blue / transform purple / logic red) and the PORT-TYPE colors are
 * FIXED product semantics — the app's data-flow color language — exactly like a
 * terminal's syntax colors; they are intentionally not themed. */

const V = 'rgb(var(--acc))';

/* Node visualCategory → accent hex (xeno-workflow WorkflowNode.tsx ACCENT). */
const CAT = { trigger: '#52b97c', action: '#4886d6', logic: '#cf5b5b' } as const;
/* Port/wire color per data type (workflowNode.css --wfn-p-*). exec = white. */
const PORT: Record<string, string> = {
  string: '#4ec9b0', number: '#7ac86f', boolean: '#d77a98', image: '#d49a4a',
  any: '#8f8f98', exec: '#ffffff',
};
const ABBR: Record<string, string> = { string: 'str', image: 'img', boolean: 'bool', number: 'num' };

/* ── one graph node ──────────────────────────────────────────────────── */
type Pin = { kind: 'exec' | 'data'; type?: string; name?: string; open?: boolean };
type Rows = { left?: Pin; right?: Pin }[];

function Dot({ pin, side, y }: { pin: Pin; side: 'l' | 'r'; y: number }) {
  const color = pin.kind === 'exec' ? PORT.exec : PORT[pin.type ?? 'any'] ?? PORT.any;
  const sz = pin.kind === 'exec' ? 9 : 8;
  return (
    <span
      className="absolute"
      style={{
        top: y - sz / 2,
        left: side === 'l' ? -sz / 2 : undefined,
        right: side === 'r' ? -sz / 2 : undefined,
        width: sz, height: sz, borderRadius: 2,
        background: pin.open ? '#141418' : color,
        boxShadow: pin.open
          ? `inset 0 0 0 1.5px ${color}`
          : 'inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 1px rgba(0,0,0,0.5)',
      }}
    />
  );
}

function GNode({
  x, y, w, accent, icon, title, status, rows,
}: {
  x: number; y: number; w: number; accent: string; icon: React.ReactNode;
  title: string; status: 'idle' | 'running' | 'success'; rows: Rows;
}) {
  const statusBg = status === 'running' ? V : status === 'success' ? CAT.trigger : 'rgba(255,255,255,0.16)';
  return (
    <div
      className="absolute"
      style={{
        left: x, top: y, width: w,
        borderRadius: 5,
        border: '1px solid rgba(255,255,255,0.09)',
        background: 'linear-gradient(180deg,#17171b,#141418)',
        boxShadow: status === 'running'
          ? `0 0 0 1.5px ${V}, 0 10px 26px -8px rgba(0,0,0,0.7)`
          : '0 1px 2px rgba(0,0,0,0.55), 0 10px 26px -10px rgba(0,0,0,0.55)',
      }}
    >
      {/* running: accent sweep on the top edge */}
      {status === 'running' && (
        <span className="absolute left-0 top-0 h-[2px] w-2/5 rounded animate-pulse" style={{ background: `linear-gradient(90deg,transparent,${V},transparent)` }} />
      )}
      {/* header */}
      <div className="flex h-[26px] items-center gap-1.5 rounded-t-[5px] border-b border-black/30 bg-[#272727] px-2.5">
        <span className="grid h-3.5 w-3.5 place-items-center" style={{ color: accent }}>{icon}</span>
        <span className="flex-1 truncate text-[10px] font-medium tracking-[0.01em] text-white/90">{title}</span>
        <span className="h-[6px] w-[6px] rounded-[2px]" style={{ background: statusBg }} />
      </div>
      {/* body rows */}
      <div className="py-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex h-5 items-center justify-between px-2.5">
            <span className="flex items-center gap-1 text-[9px] text-white/50">
              {r.left?.name}
              {r.left && r.left.kind === 'data' && <span className="font-mono text-[7.5px] text-white/20">{ABBR[r.left.type ?? ''] ?? r.left.type}</span>}
            </span>
            <span className="flex items-center gap-1 text-[9px] text-white/50">
              {r.right && r.right.kind === 'data' && <span className="font-mono text-[7.5px] text-white/20">{ABBR[r.right.type ?? ''] ?? r.right.type}</span>}
              {r.right?.name}
            </span>
          </div>
        ))}
      </div>
      {/* edge port dots */}
      {rows.map((r, i) => {
        const cy = 26 + 6 + i * 20 + 10; // header + body-pad + row center
        return (
          <React.Fragment key={`d${i}`}>
            {r.left && <Dot pin={r.left} side="l" y={cy} />}
            {r.right && <Dot pin={r.right} side="r" y={cy} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── a bezier wire in its carried type's color ───────────────────────── */
function Wire({ a, b, color, data }: { a: [number, number]; b: [number, number]; color: string; data?: boolean }) {
  const dx = Math.max(30, Math.abs(b[0] - a[0]) * 0.6);
  return (
    <path
      d={`M ${a[0]} ${a[1]} C ${a[0] + dx} ${a[1]}, ${b[0] - dx} ${b[1]}, ${b[0]} ${b[1]}`}
      fill="none" stroke={color} strokeWidth={data ? 1.5 : 1.75}
      strokeOpacity={data ? 0.8 : 0.95} strokeLinecap="round"
    />
  );
}

/* palette row */
function PRow({ dot, icon, name }: { dot: string; icon: React.ReactNode; name: string }) {
  return (
    <div className="flex items-center gap-1.5 py-[3px] pl-[26px] pr-2 text-[10px] text-white/45">
      <span className="text-white/30">{icon}</span>
      <span className="flex-1 truncate">{name}</span>
      <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: dot }} />
    </div>
  );
}
function PCat({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5">
      <ChevronDown size={10} className="text-white/25" />
      <span className="text-white/40">{icon}</span>
      <span className="flex-1 text-[9px] font-medium tracking-[0.06em] text-white/45">{label}</span>
      <span className="font-mono text-[8.5px] text-white/15">{count}</span>
    </div>
  );
}

const WorkflowGraph: React.FC = () => (
  <div className="mx-auto w-full max-w-[860px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-3 hidden text-[10.5px] font-medium text-[#cdc7be] sm:inline">XENO Workflow</span>
      <span className="hidden text-[10.5px] text-[#5d5850] sm:inline">— nightly-content.xflow</span>
    </div>

    {/* toolbar */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0e0e10] px-2.5 py-1.5">
      <button className="flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[10.5px] font-semibold text-white" style={{ background: V }}>
        <Play size={11} strokeWidth={2} /> Run
      </button>
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      {[Undo2, Redo2].map((I, i) => <span key={i} className="grid h-6 w-6 place-items-center text-white/25"><I size={12} strokeWidth={1.5} /></span>)}
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <span className="grid h-6 w-6 place-items-center rounded-[3px] bg-white/[0.05] text-white/50"><PanelLeft size={12} strokeWidth={1.5} /></span>
      <span className="grid h-6 w-6 place-items-center rounded-[3px] bg-white/[0.05] text-white/50"><PanelRight size={12} strokeWidth={1.5} /></span>
      <span className="grid h-6 w-6 place-items-center rounded-[3px] bg-white/[0.05] text-white/50"><Terminal size={12} strokeWidth={1.5} /></span>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-[10px] text-white/55 sm:inline">Nightly Content Pipeline</span>
        <span className="hidden items-center gap-1 text-[9px] text-white/30 sm:flex"><span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: V }} /> running…</span>
      </div>
      <span className="mx-1 hidden h-4 w-px bg-white/[0.07] md:inline-block" />
      <span className="hidden items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-[9px] text-white/25 md:flex"><Command size={10} strokeWidth={1.5} /><span className="font-mono">Ctrl+K</span></span>
      <span className="hidden items-center gap-1 rounded-[3px] px-2 py-1 text-[10px] text-white/40 md:flex"><Save size={11} strokeWidth={1.5} /> Save</span>
    </div>

    <div className="flex h-[clamp(400px,54vh,472px)] text-left">
      {/* ── left: node palette ── */}
      <aside className="hidden w-[152px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="border-b border-white/[0.06] px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-[3px] bg-white/[0.03] px-2 py-1">
            <Search size={11} strokeWidth={1.5} className="text-white/20" />
            <span className="text-[10px] text-white/20">Search nodes…</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden py-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <Clock size={10} className="text-white/20" />
            <span className="text-[9px] font-medium tracking-[0.06em] text-white/30">RECENT</span>
          </div>
          <PRow dot={CAT.action} icon={<Wand2 size={11} strokeWidth={1.5} />} name="Background Removal" />
          <PRow dot={CAT.action} icon={<Sparkles size={11} strokeWidth={1.5} />} name="Upscale 4×" />
          <div className="mx-2.5 my-1 border-t border-white/[0.04]" />
          <PCat icon={<Repeat size={12} strokeWidth={1.5} />} label="TRIGGERS" count={8} />
          <PRow dot={CAT.trigger} icon={<FolderSearch size={11} strokeWidth={1.5} />} name="File Watcher" />
          <PRow dot={CAT.trigger} icon={<Clock size={11} strokeWidth={1.5} />} name="CRON Schedule" />
          <PRow dot={CAT.trigger} icon={<Webhook size={11} strokeWidth={1.5} />} name="Webhook" />
          <PCat icon={<Brain size={12} strokeWidth={1.5} />} label="XENO LIB (AI)" count={15} />
          <PRow dot={CAT.action} icon={<Wand2 size={11} strokeWidth={1.5} />} name="Background Removal" />
          <PRow dot={CAT.action} icon={<ImageDown size={11} strokeWidth={1.5} />} name="Denoise" />
          <PCat icon={<Bot size={12} strokeWidth={1.5} />} label="XENO AGENT" count={5} />
          <PRow dot={CAT.action} icon={<Bot size={11} strokeWidth={1.5} />} name="Prompt LLM" />
          <PCat icon={<GitBranch size={12} strokeWidth={1.5} />} label="LOGIC" count={10} />
          <PRow dot={CAT.logic} icon={<GitBranch size={11} strokeWidth={1.5} />} name="If / Else" />
        </div>
      </aside>

      {/* ── center: canvas ── */}
      <section className="relative min-w-0 flex-1 overflow-hidden"
        style={{ background: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '17px 17px', backgroundColor: '#0b0b0d' }}>
        <div className="absolute left-2.5 top-2 flex items-center gap-1.5 text-[9.5px] text-white/30">
          <span className="font-medium text-white/45">Canvas</span><span className="h-2 w-px bg-white/10" /><span>Nightly Content Pipeline</span>
        </div>

        <Reveal y={10}>
          <div className="absolute left-1/2 top-1/2" style={{ width: 456, height: 300, transform: 'translate(-50%, -44%)' }}>
            {/* wires (behind nodes) */}
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={456} height={300}>
              {/* File Watcher exec → Remove BG exec */}
              <Wire a={[124, 160]} b={[168, 92]} color={PORT.exec} />
              {/* File Watcher exec → If/Else exec (parallel branch) */}
              <Wire a={[124, 160]} b={[168, 238]} color={PORT.exec} />
              {/* File Watcher File Path (string) → Remove BG Path (string) */}
              <Wire a={[124, 180]} b={[168, 112]} color={PORT.string} data />
              {/* Remove BG exec → Save Image exec */}
              <Wire a={[302, 92]} b={[330, 154]} color={PORT.exec} />
              {/* Remove BG Image (image) → Save Image Image (image) */}
              <Wire a={[302, 112]} b={[330, 174]} color={PORT.image} data />
            </svg>

            {/* nodes */}
            <GNode x={6} y={118} w={118} accent={CAT.trigger} status="success"
              icon={<FolderSearch size={12} strokeWidth={1.6} />} title="File Watcher"
              rows={[
                { right: { kind: 'exec' } },
                { right: { kind: 'data', type: 'string', name: 'File Path' } },
              ]} />

            <GNode x={168} y={50} w={134} accent={CAT.action} status="running"
              icon={<Wand2 size={12} strokeWidth={1.6} />} title="Background Removal"
              rows={[
                { left: { kind: 'exec' }, right: { kind: 'exec' } },
                { left: { kind: 'data', type: 'string', name: 'Path' }, right: { kind: 'data', type: 'image', name: 'Image' } },
              ]} />

            <GNode x={168} y={196} w={120} accent={CAT.logic} status="idle"
              icon={<GitBranch size={12} strokeWidth={1.6} />} title="If / Else"
              rows={[
                { left: { kind: 'exec' }, right: { kind: 'exec', name: 'True' } },
                { left: { kind: 'data', type: 'boolean', name: 'Cond', open: true }, right: { kind: 'exec', name: 'False' } },
              ]} />

            <GNode x={330} y={112} w={120} accent={CAT.action} status="idle"
              icon={<ImageDown size={12} strokeWidth={1.6} />} title="Save Image"
              rows={[
                { left: { kind: 'exec' }, right: { kind: 'exec', name: 'Done' } },
                { left: { kind: 'data', type: 'image', name: 'Image' } },
              ]} />
          </div>
        </Reveal>

        {/* zoom chip */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-[5px] border border-white/[0.07] bg-[#151518] px-2 py-1 text-[9px] tabular-nums text-white/35">
          <span>72%</span>
        </div>
      </section>

      {/* ── right: inspector ── */}
      <aside className="hidden w-[186px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] md:flex">
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
          <Settings size={11} strokeWidth={1.5} className="text-white/30" />
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-white/35">Inspector</span>
        </div>
        {/* node id */}
        <div className="border-b border-white/[0.06] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-[2px] animate-pulse" style={{ background: V }} />
            <Wand2 size={12} strokeWidth={1.5} className="text-white/40" />
            <span className="flex-1 truncate text-[10.5px] font-medium text-white/70">Background Removal</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[9px] text-white/25">
            <span>XENO Lib (AI)</span><span className="text-white/10">|</span><span className="font-mono">background-removal</span>
          </div>
        </div>
        {/* config */}
        <div className="flex-1 overflow-hidden px-3 py-2">
          <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-white/25">Configuration</span>
          <div className="mt-2 space-y-2.5">
            {[
              { l: 'Model', v: 'isnet-general', sel: true },
              { l: 'Threshold', v: '0.55', mono: true },
              { l: 'Feather', v: '2 px', mono: true },
              { l: 'Output', v: 'PNG · alpha', sel: true },
            ].map((f) => (
              <div key={f.l}>
                <div className="mb-1 text-[9px] text-white/35">{f.l}</div>
                <div className="flex items-center justify-between rounded-[3px] border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                  <span className={`text-[10px] text-white/60 ${f.mono ? 'font-mono tabular-nums' : ''}`}>{f.v}</span>
                  {f.sel && <ChevronDown size={10} className="text-white/25" />}
                </div>
              </div>
            ))}
          </div>
          {/* ports */}
          <div className="mt-3 border-t border-white/[0.06] pt-2">
            <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.06em] text-white/25"><ChevronRight size={10} className="text-white/20" /> Ports</div>
          </div>
        </div>
        {/* actions */}
        <div className="flex items-center gap-1.5 border-t border-white/[0.06] px-3 py-2">
          <span className="flex items-center gap-1 rounded-[3px] bg-white/[0.05] px-2 py-1 text-[9.5px] text-white/50"><Play size={9} strokeWidth={1.5} /> Test</span>
          <span className="rounded-[3px] px-2 py-1 text-[9.5px] text-white/25">Delete</span>
        </div>
      </aside>
    </div>

    {/* ── bottom: execution log ── */}
    <div className="border-t border-white/[0.06] bg-[#0a0a0c]">
      <div className="flex items-center gap-3 border-b border-white/[0.05] px-3 py-1.5">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-white/35">Execution Log</span>
        <div className="flex items-center gap-0.5">
          {[['ALL', 12], ['INFO', 9], ['WARN', 1], ['ERR', 0]].map(([l, c], i) => (
            <span key={l as string} className={`rounded-[2px] px-1.5 py-0.5 text-[8.5px] ${i === 0 ? 'bg-white/[0.08] text-white/50' : 'text-white/20'}`}>
              {l}{(c as number) > 0 && <span className="ml-0.5 text-white/15">{c}</span>}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[8.5px] text-white/15">147 ms total</span>
      </div>
      {/* timeline (mini gantt) */}
      <div className="px-3 py-1.5">
        <div className="relative h-[14px] overflow-hidden rounded-[2px] bg-white/[0.02]">
          <span className="absolute top-[2px] h-[10px] rounded-[1px]" style={{ left: '2%', width: '20%', background: 'rgba(255,255,255,0.14)' }} />
          <span className="absolute top-[2px] h-[10px] rounded-[1px]" style={{ left: '24%', width: '44%', background: V, opacity: 0.85 }} />
          <span className="absolute top-[2px] h-[10px] rounded-[1px]" style={{ left: '24%', width: '18%', background: 'rgba(255,255,255,0.10)' }} />
          <span className="absolute top-[2px] h-[10px] rounded-[1px]" style={{ left: '70%', width: '14%', background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      {/* log rows */}
      <div className="px-3 pb-2 font-mono text-[9px]">
        {[
          { t: '09:41:02.114', lvl: 'info', node: 'File Watcher', msg: 'change detected · shot-042.png' },
          { t: '09:41:02.121', lvl: 'info', node: 'Background Removal', msg: 'running · isnet-general on GPU…' },
          { t: '09:41:02.196', lvl: 'warn', node: 'If / Else', msg: 'input "Cond" has no incoming connection' },
        ].map((r) => (
          <div key={r.t} className="flex items-center gap-3 py-[3px]">
            <span className="w-[74px] tabular-nums text-white/20">{r.t}</span>
            <span className="w-3">
              {r.lvl === 'warn'
                ? <AlertCircle size={10} strokeWidth={1.5} className="text-yellow-500/50" />
                : <CheckCircle2 size={10} strokeWidth={1.5} className="text-green-500/50" />}
            </span>
            <span className="w-[112px] truncate text-white/45">{r.node}</span>
            <span className={`flex-1 truncate ${r.lvl === 'warn' ? 'text-yellow-500/40' : 'text-white/25'}`}>{r.msg}</span>
          </div>
        ))}
      </div>
    </div>

    {/* ── status bar ── */}
    <div className="flex items-center gap-4 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[9px] tabular-nums text-[#5d5850]">
      <span>local engine</span>
      <span className="hidden sm:inline">1 warning</span>
      <span className="ml-auto">4 nodes</span>
      <span>5 connections</span>
      <span>72%</span>
    </div>
  </div>
);

export default WorkflowGraph;
