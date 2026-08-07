import React from 'react';
import {
  Play, Save, Undo2, Redo2, Search, ChevronDown, Table2, BarChart3, Gauge,
  Plug, ListTree, Lock, Grid2x2, LayoutGrid, Workflow, Filter,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Apps mockup — the hero's "representative content". Sourced
 * from ../xeno-apps @ feat/phase-a: MenuBar.tsx (the FRONT/BACK tablist),
 * LibrarySidebar.tsx (the panel catalog), the shipped
 * examples/support-desk-dashboard.xapp composition, and BackCanvas.tsx.
 *
 * The point of the image is the ONE thing the page is selling: FRONT and BACK
 * are two projections of a single graph. So it shows both at once — the docked
 * workbench on the left, the same four panels as wired nodes on the right —
 * rather than a single view the visitor has to take on trust.
 *
 * Monochromatic per DESIGN_SYSTEM.md §2: white at varying opacity is the only
 * accent. The panel-category dots and the wires are white-alpha, NOT colored —
 * XENO Apps has no data-type color language of its own to be faithful to (its
 * wires are all kind:'data'), so there is nothing here that earns an exception
 * the way xeno-workflow's port colors do. */

const PANELS = [
  { icon: <Plug size={11} strokeWidth={1.5} />, name: 'Connectors' },
  { icon: <Table2 size={11} strokeWidth={1.5} />, name: 'Table' },
  { icon: <BarChart3 size={11} strokeWidth={1.5} />, name: 'Chart' },
  { icon: <Gauge size={11} strokeWidth={1.5} />, name: 'Metrics' },
  { icon: <ListTree size={11} strokeWidth={1.5} />, name: 'Tree' },
  { icon: <Filter size={11} strokeWidth={1.5} />, name: 'Fields' },
];

/* ── a node on the BACK canvas ────────────────────────────────────────── */
function BNode({
  x, y, w, title, ports,
}: {
  x: number; y: number; w: number; title: string;
  ports: { left?: string; right?: string }[];
}) {
  return (
    <div
      className="absolute"
      style={{
        left: x, top: y, width: w, borderRadius: 5,
        border: '1px solid rgba(255,255,255,0.10)',
        background: '#141418',
      }}
    >
      <div className="flex h-[22px] items-center gap-1.5 rounded-t-[4px] border-b border-black/40 bg-[#1f1f22] px-2">
        <span className="h-[5px] w-[5px] rounded-[1px] bg-white/25" />
        <span className="flex-1 truncate text-[9px] font-medium text-white/80">{title}</span>
      </div>
      <div className="py-1">
        {ports.map((p, i) => (
          <div key={i} className="flex h-[17px] items-center justify-between px-2 text-[8.5px] text-white/45">
            <span>{p.left}</span>
            <span>{p.right}</span>
          </div>
        ))}
      </div>
      {ports.map((p, i) => {
        const cy = 22 + 4 + i * 17 + 8.5;
        return (
          <React.Fragment key={`p${i}`}>
            {p.left && <span className="absolute h-[7px] w-[7px] rounded-[2px] bg-white/45" style={{ top: cy - 3.5, left: -3.5 }} />}
            {p.right && <span className="absolute h-[7px] w-[7px] rounded-[2px] bg-white/45" style={{ top: cy - 3.5, right: -3.5 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Wire({ a, b }: { a: [number, number]; b: [number, number] }) {
  const dx = Math.max(24, Math.abs(b[0] - a[0]) * 0.55);
  return (
    <path
      d={`M ${a[0]} ${a[1]} C ${a[0] + dx} ${a[1]}, ${b[0] - dx} ${b[1]}, ${b[0]} ${b[1]}`}
      fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} strokeLinecap="round"
    />
  );
}

/* ── a docked panel on the FRONT workbench ────────────────────────────── */
function Pane({ title, icon, children, className = '' }: { title: string; icon: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-white/[0.07] bg-[#141416] ${className}`}>
      <div className="flex h-[21px] shrink-0 items-center gap-1.5 border-b border-black/40 bg-[#1f1f22] px-2">
        <span className="text-white/30">{icon}</span>
        <span className="flex-1 truncate text-[9px] font-medium text-white/65">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

const AppsBuilder: React.FC = () => (
  <div className="mx-auto w-full max-w-[860px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-3 hidden text-[10.5px] font-medium text-[#cdc7be] sm:inline">XENO Apps</span>
      <span className="hidden text-[10.5px] text-[#5d5850] sm:inline">— support-desk-dashboard.xapp</span>
    </div>

    {/* menu bar + FRONT/BACK tablist */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0e0e10] px-2.5 py-1.5">
      <div className="flex items-center gap-0.5 rounded-[4px] bg-white/[0.05] p-0.5">
        <span className="rounded-[3px] bg-white/[0.16] px-2 py-[3px] text-[9.5px] font-semibold text-white">FRONT</span>
        <span className="rounded-[3px] px-2 py-[3px] text-[9.5px] font-medium text-white/35">BACK</span>
      </div>
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <button className="flex items-center gap-1.5 rounded-[4px] bg-white/[0.15] px-2.5 py-1 text-[10.5px] font-semibold text-white">
        <Play size={11} strokeWidth={2} /> Run
      </button>
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      {[Undo2, Redo2].map((I, i) => <span key={i} className="grid h-6 w-6 place-items-center text-white/25"><I size={12} strokeWidth={1.5} /></span>)}

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1 text-[9px] text-white/30 sm:flex"><Lock size={9} strokeWidth={1.5} /> 1 origin approved</span>
        <span className="hidden items-center gap-1 rounded-[3px] px-2 py-1 text-[10px] text-white/40 md:flex"><Save size={11} strokeWidth={1.5} /> Save</span>
      </div>
    </div>

    <div className="flex h-[clamp(400px,54vh,472px)] text-left">
      {/* ── left: panel library ── */}
      <aside className="hidden w-[142px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="border-b border-white/[0.06] px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-[3px] bg-white/[0.03] px-2 py-1">
            <Search size={11} strokeWidth={1.5} className="text-white/20" />
            <span className="text-[10px] text-white/20">Search panels…</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden py-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <ChevronDown size={10} className="text-white/25" />
            <LayoutGrid size={11} strokeWidth={1.5} className="text-white/40" />
            <span className="flex-1 text-[9px] font-medium tracking-[0.06em] text-white/45">PANELS</span>
            <span className="font-mono text-[8.5px] text-white/15">21</span>
          </div>
          {PANELS.map((p) => (
            <div key={p.name} className="flex items-center gap-1.5 py-[3px] pl-[26px] pr-2 text-[10px] text-white/45">
              <span className="text-white/30">{p.icon}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="h-1.5 w-1.5 rounded-[2px] bg-white/20" />
            </div>
          ))}
          <div className="mx-2.5 my-1 border-t border-white/[0.04]" />
          <div className="px-2.5 py-1 text-[8.5px] text-white/20">+ 15 more · drag onto a slot</div>
        </div>
      </aside>

      {/* ── center: FRONT workbench ── */}
      <section className="grid min-w-0 flex-1 gap-1 bg-[#0b0b0d] p-1.5"
        style={{ gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gridTemplateRows: 'auto minmax(0,1fr) minmax(0,0.85fr)' }}>
        {/* metrics row */}
        <div className="col-span-2 grid grid-cols-3 gap-1">
          {[['Open tickets', '128'], ['Median first reply', '41 m'], ['Breached SLA', '6']].map(([l, v]) => (
            <div key={l} className="rounded-[4px] border border-white/[0.07] bg-[#141416] px-2.5 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.06em] text-white/30">{l}</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-white/85">{v}</div>
            </div>
          ))}
        </div>

        {/* table */}
        <Pane title="Table" icon={<Table2 size={11} strokeWidth={1.5} />}>
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-2 py-1 text-[8px] uppercase tracking-[0.05em] text-white/25">
              <span className="w-9">ID</span><span className="flex-1">Subject</span><span className="w-12">Priority</span>
            </div>
            {[
              ['t-101', 'Billing export fails on Safari', 'High', true],
              ['t-102', 'SSO redirect loops', 'High', false],
              ['t-103', 'Rename a workspace', 'Low', false],
              ['t-104', 'Webhook retries duplicate', 'Med', false],
              ['t-105', 'Seat count off by one', 'Med', false],
            ].map(([id, subj, pri, sel]) => (
              <div key={id as string} className={`flex items-center gap-2 px-2 py-[3.5px] text-[9px] ${sel ? 'bg-white/[0.10]' : ''}`}>
                <span className="w-9 font-mono tabular-nums text-white/35">{id}</span>
                <span className="flex-1 truncate text-white/70">{subj}</span>
                <span className="w-12 text-white/40">{pri}</span>
              </div>
            ))}
          </div>
        </Pane>

        {/* chart */}
        <Pane title="Chart" icon={<BarChart3 size={11} strokeWidth={1.5} />}>
          <div className="flex h-full items-end gap-[3px] px-2 pb-2 pt-3">
            {[38, 52, 44, 61, 49, 72, 58, 66, 80, 63, 74, 91].map((h, i) => (
              <span key={i} className="flex-1 rounded-[1px]" style={{ height: `${h}%`, background: `rgba(255,255,255,${0.14 + i * 0.018})` }} />
            ))}
          </div>
        </Pane>

        {/* connectors */}
        <Pane title="Connectors" icon={<Plug size={11} strokeWidth={1.5} />} className="col-span-2">
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 rounded-[3px] border border-white/[0.07] bg-white/[0.03] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-[2px] bg-white/50" />
              <span className="text-[9px] text-white/60">tickets · HTTP</span>
              <span className="font-mono text-[8px] text-white/25">https://api.internal/tickets</span>
              <span className="ml-auto flex items-center gap-1 text-[8px] text-white/30"><Lock size={8} strokeWidth={1.5} /> approved</span>
            </div>
            <div className="mt-1 flex items-center gap-2 px-2 text-[8.5px] text-white/25">
              <span>128 rows</span><span className="h-2 w-px bg-white/10" /><span>$cred:api-token</span><span className="h-2 w-px bg-white/10" /><span>OS keystore</span>
            </div>
          </div>
        </Pane>
      </section>

      {/* ── right: BACK canvas (the same graph) ── */}
      <aside className="relative hidden w-[228px] shrink-0 overflow-hidden border-l border-white/[0.06] md:block"
        style={{ background: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '16px 16px', backgroundColor: '#08080a' }}>
        <div className="absolute left-2.5 top-2 flex items-center gap-1.5 text-[9px] text-white/30">
          <Workflow size={10} strokeWidth={1.5} className="text-white/35" />
          <span className="font-medium text-white/45">BACK</span>
          <span className="h-2 w-px bg-white/10" />
          <span>same graph</span>
        </div>

        <Reveal y={10}>
          <div className="absolute left-1/2 top-1/2" style={{ width: 208, height: 268, transform: 'translate(-50%, -46%)' }}>
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={208} height={268}>
              {/* Connectors.rows → Table.rows */}
              <Wire a={[96, 47]} b={[26, 105]} />
              {/* Table.selection → Filter (logic node) */}
              <Wire a={[122, 122]} b={[62, 175]} />
              {/* Filter.out → Chart.series */}
              <Wire a={[146, 192]} b={[62, 235]} />
            </svg>

            <BNode x={8} y={22} w={88} title="Connectors" ports={[{ right: 'rows' }]} />
            <BNode x={26} y={80} w={96} title="Table" ports={[{ left: 'rows' }, { right: 'selection' }]} />
            <BNode x={62} y={158} w={84} title="Filter" ports={[{ left: 'in', right: 'out' }]} />
            <BNode x={62} y={212} w={84} title="Chart" ports={[{ left: 'series' }]} />
          </div>
        </Reveal>

        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-[5px] border border-white/[0.07] bg-[#151518] px-2 py-1 text-[9px] tabular-nums text-white/35">
          <Grid2x2 size={9} strokeWidth={1.5} /> <span>84%</span>
        </div>
      </aside>
    </div>

    {/* ── status bar ── */}
    <div className="flex items-center gap-4 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-1.5 text-[9px] tabular-nums text-[#5d5850]">
      <span>local</span>
      <span className="hidden sm:inline">no AI in this build</span>
      <span className="ml-auto">4 panels</span>
      <span>3 wires</span>
      <span>1 trigger</span>
    </div>
  </div>
);

export default AppsBuilder;
