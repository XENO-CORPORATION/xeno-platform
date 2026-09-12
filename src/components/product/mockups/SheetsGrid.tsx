import React from 'react';
import {
  Bold, Italic, AlignLeft, AlignCenter, Percent, Hash, Plus,
  BarChart3, Sparkles, Filter, Palette, Sigma, Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* High-fidelity XENO Sheets mockup — the hero's "representative content" (NN/g:
 * the hero visual must show the real product). Recreates the real Electron app
 * from xeno-sheets/src/renderer: the frameless titlebar, the formatting toolbar,
 * the formula bar showing a REAL evaluated formula, the canvas grid with headers
 * and a selected range, the sheet tabs, and the status bar with the selection
 * aggregate. The right rail mirrors the app's actual sidebar panels.
 *
 * Deliberately shows a formula in the formula bar and its computed result in the
 * cell: 0.2.0 is the first build whose evaluator actually works, and the 0.1.0
 * scaffold's defect was precisely that formulas did not evaluate. The hero should
 * show the thing that changed.
 *
 * The app is monochromatic by design; accent (rgb(var(--acc)) via .acc-fg/.acc-b*) is
 * reserved for the AI-native layer and the live selection, so the theme switch
 * recolors exactly what makes Sheets different. */

function TBtn({ icon: Icon, active }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span className={`grid h-6 w-6 place-items-center rounded ${active ? 'bg-white/[0.1] text-[#d8d2ca]' : 'text-[#5d5850]'}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

const COLS = ['A', 'B', 'C', 'D', 'E'];

/* Region · Units · Price · Revenue — the Revenue column is =B*C, and row 6 is the
 * SUMPRODUCT total that the formula bar is showing. */
const ROWS: { cells: string[]; align?: ('l' | 'r')[] }[] = [
  { cells: ['Region', 'Units', 'Price', 'Revenue', 'Share'] },
  { cells: ['North', '1,240', '€ 24.00', '€ 29,760', '31.4%'] },
  { cells: ['South', '980', '€ 24.00', '€ 23,520', '24.8%'] },
  { cells: ['East', '1,510', '€ 21.50', '€ 32,465', '34.2%'] },
  { cells: ['West', '410', '€ 21.50', '€ 8,815', '9.3%'] },
  { cells: ['Total', '4,140', '', '€ 94,560', '100%'] },
];

const SheetsGrid: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* frameless titlebar */}
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#08080a] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-white/40">
          <span className="text-[7px] leading-none text-white/40">▦</span>
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">XENO Sheets</span>
        <span className="ml-1 text-[10.5px] text-white/25">Q3-forecast.xsheet</span>
      </div>
      <div className="flex items-center gap-3.5 text-white/30">
        <span className="h-[1.5px] w-2.5 bg-current" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-current" />
        <span className="text-[11px] leading-none">✕</span>
      </div>
    </div>

    {/* formatting toolbar */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0a0a0c] px-2.5 py-1.5">
      <TBtn icon={Bold} /><TBtn icon={Italic} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={AlignLeft} active /><TBtn icon={AlignCenter} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={Percent} /><TBtn icon={Hash} /><TBtn icon={Palette} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={Filter} /><TBtn icon={BarChart3} />
      <span className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] acc-fg-hi acc-b10">
        <Sparkles className="h-3 w-3" strokeWidth={1.6} />Ask AI
      </span>
    </div>

    {/* formula bar — a REAL formula and its evaluated result */}
    <div className="flex items-stretch border-b border-white/[0.06] bg-[#0b0b0d] text-[11px]">
      <span className="grid w-[54px] shrink-0 place-items-center border-r border-white/[0.06] font-mono text-white/45">D6</span>
      <span className="grid w-7 shrink-0 place-items-center border-r border-white/[0.06] text-white/30">
        <Sigma className="h-3 w-3" strokeWidth={1.6} />
      </span>
      <span className="flex-1 px-2.5 py-1.5 font-mono text-[11px] text-white/65">
        =SUMPRODUCT(B2:B5,C2:C5)
      </span>
    </div>

    <div className="flex h-[clamp(300px,42vh,360px)] text-left">
      {/* ── the grid ── */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {/* column headers */}
        <div className="flex border-b border-white/[0.07] bg-[#0a0a0c] text-[10px] text-white/35">
          <span className="w-[34px] shrink-0 border-r border-white/[0.06] py-1 text-center" />
          {COLS.map((c, i) => (
            <span key={c} className={`flex-1 border-r border-white/[0.04] py-1 text-center ${i === 3 ? 'acc-fg-hi acc-b06' : ''}`}>{c}</span>
          ))}
        </div>

        {ROWS.map((r, ri) => (
          <div key={ri} className={`flex border-b border-white/[0.04] text-[11px] ${ri === 5 ? 'bg-white/[0.03] font-medium' : ''}`}>
            <span className="w-[34px] shrink-0 border-r border-white/[0.06] bg-[#0a0a0c] py-1.5 text-center text-[10px] text-white/30">{ri + 1}</span>
            {r.cells.map((cell, ci) => {
              const isHeader = ri === 0;
              const selected = ci === 3 && ri === 5;
              return (
                <span
                  key={ci}
                  className={[
                    'flex-1 truncate border-r border-white/[0.04] px-2 py-1.5',
                    ci === 0 ? 'text-left' : 'text-right',
                    isHeader ? 'bg-white/[0.035] text-[10.5px] uppercase tracking-[0.08em] text-white/40' : 'text-white/70',
                    selected ? 'acc-fg-hi acc-bd30 acc-b10 ring-1 ring-inset' : '',
                  ].join(' ')}
                >
                  {cell}
                </span>
              );
            })}
          </div>
        ))}

        {/* empty filler rows */}
        {[6, 7].map((n) => (
          <div key={n} className="flex border-b border-white/[0.03] text-[11px]">
            <span className="w-[34px] shrink-0 border-r border-white/[0.06] bg-[#0a0a0c] py-1.5 text-center text-[10px] text-white/20">{n + 1}</span>
            {COLS.map((c) => <span key={c} className="flex-1 border-r border-white/[0.03] py-1.5" />)}
          </div>
        ))}
      </div>

      {/* ── right rail: the app's real sidebar panels ── */}
      <aside className="hidden w-[clamp(168px,26%,196px)] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center gap-0.5 border-b border-white/[0.04] px-2 py-1.5">
          {[['Cell'], ['Chart'], ['AI', true]].map(([l, on]) => (
            <span key={l as string} className={`rounded px-2 py-1 text-[10.5px] ${on ? 'acc-fg-hi acc-b10' : 'text-white/35'}`}>{l}</span>
          ))}
        </div>

        <div className="space-y-2.5 p-2.5">
          <p className="text-[10.5px] leading-[1.5] text-white/40">
            Ask AI to analyze your data, write a formula, or explain a result.
          </p>
          <div className="rounded-md border border-white/[0.07] bg-white/[0.02] p-2">
            <p className="text-[10.5px] leading-[1.55] text-white/55">
              East is your strongest region at <span className="acc-fg-hi">34.2%</span> of revenue on the lower price point.
            </p>
          </div>
          <div className="rounded-md border border-white/[0.06] bg-white/[0.015] p-2">
            <div className="mb-1 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.1em] text-white/30">
              <Check className="h-2.5 w-2.5" strokeWidth={2} />Validation
            </div>
            <p className="font-mono text-[10px] text-white/45">C2:C5 · list</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10.5px] text-white/40">
            <Plus className="h-3 w-3" strokeWidth={1.5} />New chart from range
          </div>
        </div>
      </aside>
    </div>

    {/* sheet tabs + status bar */}
    <div className="flex items-center gap-1 border-t border-white/[0.06] bg-[#0a0a0c] px-2 py-1.5">
      {[['Forecast', true], ['Actuals'], ['Assumptions']].map(([l, on]) => (
        <span key={l as string} className={`rounded-t px-2.5 py-1 text-[10.5px] ${on ? 'bg-white/[0.07] text-white/70' : 'text-white/35'}`}>{l}</span>
      ))}
      <span className="grid h-5 w-5 place-items-center rounded text-white/30"><Plus className="h-3 w-3" strokeWidth={1.5} /></span>
      <span className="ml-auto font-mono text-[10px] text-white/35">Sum € 94,560 · Avg € 23,640 · Count 4</span>
    </div>
  </div>
);

export default SheetsGrid;
