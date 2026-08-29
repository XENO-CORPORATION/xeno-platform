import React from 'react';
import {
  FilePlus, FolderOpen, Save, Undo2, Redo2, Pilcrow, Heading1, Heading2,
  Bold, Italic, Underline, Code, List, ListOrdered, CheckSquare, Quote, Table,
  Link, BookOpen, Palette, PanelLeft, MessageSquare, History, Sparkles,
  RefreshCw, FileText, Expand, Languages, PenTool, ChevronDown, X, Cloud,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* High-fidelity XENO Docs editor mockup — the hero's representative content
 * (NN/g: the hero visual must be the real product). Recreated in the landing-v3
 * language: near-black chrome, hairline borders, off-white text, accent only for
 * the AI assistant / active state / selection / page marker. Mirrors the real
 * renderer in xeno-docs: Titlebar + Toolbar + OutlineSidebar + DocumentEditor +
 * StatusBar, with the floating AIWritingPanel. Pure JSX/Tailwind, theme-aware. */

const V = 'rgb(var(--acc))';

/** one 28×28 toolbar button */
function TB({ icon: Icon, active }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span
      className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[3px] ${
        active ? 'acc-b12 acc-fg-hi' : 'text-[#69635b]'
      }`}
    >
      <Icon size={13} />
    </span>
  );
}
function Sep() {
  return <span className="mx-0.5 h-[16px] w-px shrink-0 bg-white/[0.07]" />;
}

const outline = [
  { label: 'Q3 Strategy Memo', lvl: 0, active: true },
  { label: 'Executive Summary', lvl: 1 },
  { label: 'Market Opportunity', lvl: 1 },
  { label: 'Competitive Landscape', lvl: 2 },
  { label: 'Recommendation', lvl: 1 },
  { label: 'Appendix', lvl: 1 },
];

const DocsEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="mx-auto flex items-center gap-1.5 text-[11px] text-[#827b71]">
        <FileText size={11} className="text-[#5d5850]" />
        Q3 Strategy Memo.xdoc
      </span>
    </div>

    {/* toolbar */}
    <div className="flex items-center gap-0.5 overflow-hidden border-b border-white/[0.06] bg-[#111113] px-2 py-1.5">
      <TB icon={FilePlus} /><TB icon={FolderOpen} /><TB icon={Save} /><Sep />
      <TB icon={Undo2} /><TB icon={Redo2} /><Sep />
      <TB icon={Pilcrow} /><TB icon={Heading1} active /><TB icon={Heading2} /><Sep />
      <TB icon={Bold} /><TB icon={Italic} /><TB icon={Underline} /><TB icon={Code} /><Sep />
      <TB icon={List} /><TB icon={ListOrdered} /><TB icon={CheckSquare} /><Sep />
      <TB icon={Quote} /><TB icon={Table} /><TB icon={Link} /><Sep />
      <span className="hidden items-center gap-0.5 md:flex"><TB icon={BookOpen} /><TB icon={Palette} /><Sep /></span>
      <TB icon={PanelLeft} active /><TB icon={MessageSquare} /><TB icon={History} />
      <span className="ml-auto" /><TB icon={Sparkles} active />
    </div>

    <div className="relative flex h-[clamp(392px,52vh,468px)] text-left">
      {/* ── outline sidebar ── */}
      <aside className="hidden w-[168px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="px-3.5 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5d5850]">Outline</div>
        <div className="space-y-0.5 px-2">
          {outline.map((h) => (
            <div
              key={h.label}
              className={`flex items-center rounded-[5px] px-2 py-[5px] text-[11.5px] ${
                h.active ? 'acc-b10 acc-fg-hi' : 'text-[#827b71]'
              }`}
              style={{ paddingLeft: `${8 + h.lvl * 12}px` }}
            >
              <span className="truncate">{h.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-1.5 border-t border-white/[0.05] px-3.5 py-2.5 text-[10.5px] text-[#5d5850]">
          <BookOpen size={11} /> 4 citations · APA 7th
        </div>
      </aside>

      {/* ── document canvas ── */}
      <section className="relative min-w-0 flex-1 overflow-hidden bg-[#08080a]">
        {/* the "page" */}
        <div className="mx-auto mt-6 w-[clamp(300px,86%,440px)] rounded-t-[4px] border border-white/[0.06] border-b-0 bg-[#141416] px-[clamp(20px,4%,40px)] pt-8 pb-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
          <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-[#5d5850]">Confidential · Draft</div>
          <h1 className="mt-2 text-[22px] font-semibold leading-tight text-[#f3efe8]">Q3 Strategy Memo</h1>
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[#69635b]">
            <span>Amanda Lee</span><span className="h-1 w-1 rounded-full bg-white/15" /><span>Updated 2 min ago</span>
          </div>

          <h2 className="mt-6 text-[13.5px] font-semibold text-[#e7e2d9]">Executive Summary</h2>
          <p className="mt-2 text-[11.5px] leading-[1.75] text-[#aaa39a]">
            The launch remains on track for the quarter.{' '}
            <span className="rounded-[2px] acc-b20 px-0.5 acc-fg-hi">Our messaging-automation segment shows the strongest pull, with mid-market SaaS accounts converting fastest.</span>{' '}
            We recommend concentrating spend there through end of Q3.
          </p>

          {/* checklist */}
          <div className="mt-4 space-y-1.5 text-[11.5px] text-[#cdc7be]">
            <div className="flex items-center gap-2">
              <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] acc-b acc-bd" style={{ borderColor: V }}>
                <CheckSquare size={9} className="text-white/90" />
              </span>
              <span className="text-[#827b71] line-through">Finalize pricing tiers</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-[3px] border border-white/20" />
              <span>Confirm launch-week partners</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-[3px] border border-white/20" />
              <span>Draft the announcement post</span>
            </div>
          </div>

          {/* callout */}
          <div className="mt-4 flex gap-2.5 rounded-[6px] border-l-2 acc-bd acc-b06 px-3 py-2.5" style={{ borderLeftColor: V }}>
            <Sparkles size={13} className="mt-0.5 shrink-0 acc-fg-hi" />
            <p className="text-[11px] leading-relaxed text-[#cdc7be]">
              <span className="font-medium text-[#e7e2d9]">AI note:</span> tighten the summary to three sentences and translate the appendix to Spanish for the EU team.
            </p>
          </div>

          <p className="mt-4 text-[11.5px] leading-[1.75] text-[#69635b]">
            The market opportunity is estimated at $12.4B, growing 28% year over year&hellip;
          </p>
        </div>

        {/* ── floating AI Writing Assistant ── */}
        <div className="absolute right-3 top-4 w-[214px] overflow-hidden rounded-[6px] border acc-bd30 bg-[#18181b] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium acc-fg-hi"><Sparkles size={12} /> AI Writing Assistant</span>
            <X size={12} className="text-[#5d5850]" />
          </div>
          <div className="flex flex-col gap-1 p-2">
            <div className="flex gap-1">
              <span className="flex flex-1 items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-[11px] text-[#aaa39a]"><RefreshCw size={11} /> Rewrite</span>
              <span className="flex items-center gap-0.5 rounded-[3px] border border-white/[0.08] px-1.5 py-0.5 text-[9.5px] text-[#827b71]">Professional <ChevronDown size={9} /></span>
            </div>
            <span className="flex items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-[11px] text-[#aaa39a]"><FileText size={11} /> Summarize</span>
            <span className="flex items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-[11px] text-[#aaa39a]"><Expand size={11} /> Expand</span>
            <div className="flex gap-1">
              <span className="flex flex-1 items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-[11px] text-[#aaa39a]"><Languages size={11} /> Translate</span>
              <span className="flex items-center gap-0.5 rounded-[3px] border border-white/[0.08] px-1.5 py-0.5 text-[9.5px] text-[#827b71]">Spanish <ChevronDown size={9} /></span>
            </div>
            <div className="my-1 h-px bg-white/[0.06]" />
            <span className="flex items-center gap-1.5 px-2 text-[10.5px] text-[#69635b]"><PenTool size={11} /> Generate</span>
            <div className="flex gap-1 px-1">
              <span className="flex-1 rounded-[3px] border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-[10.5px] text-[#5d5850]">Describe what to write&hellip;</span>
              <span className="grid place-items-center rounded-[3px] px-2.5 text-[10.5px] font-semibold text-white" style={{ background: V }}>Go</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    {/* status bar */}
    <div className="flex items-center gap-4 border-t border-white/[0.06] bg-[#111113] px-3.5 py-1.5 text-[10px] text-[#69635b]">
      <span>1,248 words</span>
      <span className="hidden sm:inline">7,932 characters</span>
      <span>3 pages</span>
      <span className="hidden sm:inline">6 min read</span>
      <span className="flex items-center gap-1 text-[#5d5850]"><Cloud size={10} /> Saved</span>
      <span className="ml-auto hidden sm:inline">English</span>
      <span className="tabular-nums">100%</span>
    </div>
  </div>
);

export default DocsEditor;
